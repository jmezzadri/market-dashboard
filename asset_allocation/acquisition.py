"""
asset_allocation/acquisition.py — Layer 1: data acquisition.

Pulls all macro factors (FRED + Yahoo), all ETF prices (yfinance), SPY
holdings (SSGA daily disclosure), and loads the static industry-group
reference data. Outputs schema-validated JSON files to a run directory.

This module is INTENTIONALLY pure-acquisition — no validation logic
beyond what's necessary to confirm a successful pull. Validation lives
in validation.py (Layer 2).

Outputs (in {run_dir}/):
  factor_panel.json    — unified macro factor data
  price_panel.json     — daily ETF prices for the v10 universe
  spy_holdings.json    — current SPY composition aggregated to GICS sector
  reference_groups.json (copy of industry_groups.json for the run)
  acquisition_run.json — run metadata, success/failure log, source URLs

Usage:
  python -m asset_allocation.acquisition --run-dir /tmp/aa_run/2026-04-26
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import sys
import uuid
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Universe + factor catalog
# ──────────────────────────────────────────────────────────────────────────

EQUITY_TICKERS = [
    "IGV", "SOXX", "IBB", "XLF", "XLV", "XLI", "XLE", "XLY",
    "XLP", "XLU", "XLB", "IYR", "IYZ", "MGK",
]
DEFENSIVE_TICKERS = ["BIL", "TLT", "GLD", "LQD"]
BENCHMARK_TICKERS = ["SPY", "AGG"]
ALL_TICKERS = EQUITY_TICKERS + DEFENSIVE_TICKERS + BENCHMARK_TICKERS

# FRED series (no API key needed — fredgraph CSV)
FRED_FACTORS = {
    "yield_curve":      {"series_id": "T10Y3M",         "cadence": "D", "unit": "bps",  "min": -300, "max": 500,  "expected_lag_days": 2},
    "real_rates":       {"series_id": "DFII10",         "cadence": "D", "unit": "%",    "min": -3,   "max": 6,    "expected_lag_days": 2},
    "term_premium":     {"series_id": "THREEFYTP10",    "cadence": "D", "unit": "%",    "min": -2,   "max": 5,    "expected_lag_days": 5},
    "breakeven_10y":    {"series_id": "T10YIE",         "cadence": "D", "unit": "%",    "min": 0,    "max": 6,    "expected_lag_days": 2},
    "usd":              {"series_id": "DTWEXBGS",       "cadence": "D", "unit": "index","min": 70,   "max": 200,  "expected_lag_days": 5},
    "anfci":            {"series_id": "NFCI",           "cadence": "W", "unit": "index","min": -2,   "max": 5,    "expected_lag_days": 7},
    "stlfsi":           {"series_id": "STLFSI4",        "cadence": "W", "unit": "index","min": -3,   "max": 8,    "expected_lag_days": 7},
    "cpff":             {"series_id": "DCPF3M",         "cadence": "D", "unit": "%",    "min": 0,    "max": 12,   "expected_lag_days": 2},
    "fed_funds":        {"series_id": "DFF",            "cadence": "D", "unit": "%",    "min": 0,    "max": 25,   "expected_lag_days": 2},
    "fed_bs":           {"series_id": "WALCL",          "cadence": "W", "unit": "$ billions", "min": 500, "max": 12000, "expected_lag_days": 7},
    "jobless":          {"series_id": "ICSA",           "cadence": "W", "unit": "thousands", "min": 100,  "max": 8000,  "expected_lag_days": 7},
    "industrial_prod":  {"series_id": "INDPRO",         "cadence": "M", "unit": "index","min": 70,   "max": 130,  "expected_lag_days": 35},
    "capacity_util":    {"series_id": "TCU",            "cadence": "M", "unit": "%",    "min": 60,   "max": 90,   "expected_lag_days": 35},
    "umich_sentiment":  {"series_id": "UMCSENT",        "cadence": "M", "unit": "index","min": 40,   "max": 120,  "expected_lag_days": 35},
    "retail_sales":     {"series_id": "RSXFS",          "cadence": "M", "unit": "$ M",  "min": 200000, "max": 1000000, "expected_lag_days": 45},
    "real_pce":         {"series_id": "PCEC96",         "cadence": "M", "unit": "$ B",  "min": 8000, "max": 25000, "expected_lag_days": 45},
    "manuf_orders":     {"series_id": "DGORDER",        "cadence": "M", "unit": "$ M",  "min": 100000, "max": 400000, "expected_lag_days": 45},
    "housing_starts":   {"series_id": "HOUST",          "cadence": "M", "unit": "thousands", "min": 200, "max": 3000, "expected_lag_days": 35},
    "mortgage_30y":     {"series_id": "MORTGAGE30US",   "cadence": "W", "unit": "%",    "min": 2,    "max": 20,   "expected_lag_days": 7},
    "bank_credit":      {"series_id": "TOTBKCR",        "cadence": "W", "unit": "$ B",  "min": 5000, "max": 25000, "expected_lag_days": 14},
    "m2_yoy":           {"series_id": "M2SL",           "cadence": "M", "unit": "% YoY","min": -10,  "max": 30,   "expected_lag_days": 45, "computed": "yoy"},
    "wti_crude":        {"series_id": "DCOILWTICO",     "cadence": "D", "unit": "$/bbl","min": 10,   "max": 250,  "expected_lag_days": 5},
    "natgas_henry":     {"series_id": "DHHNGSP",        "cadence": "D", "unit": "$/MMBtu","min": 1,  "max": 20,   "expected_lag_days": 5},
    "sloos_ci":         {"series_id": "DRTSCILM",       "cadence": "Q", "unit": "%",    "min": -50,  "max": 100,  "expected_lag_days": 100},
    "sloos_cre":        {"series_id": "DRTSCLCC",       "cadence": "Q", "unit": "%",    "min": -50,  "max": 100,  "expected_lag_days": 100},
}

# Yahoo factors
YAHOO_FACTORS = {
    "vix":          {"ticker": "^VIX",  "cadence": "D", "unit": "index", "min": 5,   "max": 100, "expected_lag_days": 1},
    "skew":         {"ticker": "^SKEW", "cadence": "D", "unit": "index", "min": 100, "max": 200, "expected_lag_days": 1},
}

# Computed factors (e.g., copper-gold ratio)
COMPUTED_FACTORS = {
    "copper_gold": {
        "formula": "HG=F/GC=F",
        "cadence": "D",
        "unit": "ratio",
        "min": 0.01,
        "max": 1.0,
        "expected_lag_days": 1,
    },
}

# SPY holdings source
SPY_HOLDINGS_URL = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"

PRICE_HISTORY_START = "2001-01-01"
FACTOR_HISTORY_START = "2001-01-01"


# ──────────────────────────────────────────────────────────────────────────
# Run metadata
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class AcquisitionRun:
    run_id: str
    start_time: str
    run_dir: Path
    successes: list = None
    warnings: list = None
    failures: list = None

    def __post_init__(self):
        if self.successes is None: self.successes = []
        if self.warnings is None: self.warnings = []
        if self.failures is None: self.failures = []

    def log_success(self, layer: str, name: str, detail: str = ""):
        self.successes.append({"layer": layer, "name": name, "detail": detail})
        logger.info(f"✓ {layer}.{name} {detail}")

    def log_warning(self, layer: str, name: str, detail: str):
        self.warnings.append({"layer": layer, "name": name, "detail": detail})
        logger.warning(f"⚠ {layer}.{name} {detail}")

    def log_failure(self, layer: str, name: str, detail: str):
        self.failures.append({"layer": layer, "name": name, "detail": detail})
        logger.error(f"✗ {layer}.{name} {detail}")

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "start_time": self.start_time,
            "end_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "successes": self.successes,
            "warnings": self.warnings,
            "failures": self.failures,
            "exit_status": "success" if not self.failures else "partial" if self.successes else "failure",
        }


# ──────────────────────────────────────────────────────────────────────────
# Pull helpers
# ──────────────────────────────────────────────────────────────────────────


def pull_fred_csv(series_id: str, start: str = FACTOR_HISTORY_START) -> pd.Series:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}"
    df = pd.read_csv(url)
    df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df["value"].dropna()


def pull_yahoo(ticker: str, start: str = FACTOR_HISTORY_START) -> pd.Series:
    df = yf.download(ticker, start=start, progress=False, auto_adjust=True, threads=False)
    if df.empty:
        return pd.Series(dtype=float)
    if isinstance(df.columns, pd.MultiIndex):
        df = df["Close"]
    if "Close" in df.columns:
        return df["Close"]
    return df.iloc[:, 0]


def compute_yoy(s: pd.Series) -> pd.Series:
    """Compute year-over-year percent change."""
    return (s.pct_change(periods=12) * 100).dropna()


def series_to_points(s: pd.Series) -> list:
    """Convert pandas Series to [[YYYY-MM-DD, value], ...] list."""
    return [[d.strftime("%Y-%m-%d"), float(v)] for d, v in s.items() if pd.notna(v)]


# ──────────────────────────────────────────────────────────────────────────
# Acquisition orchestrators
# ──────────────────────────────────────────────────────────────────────────


def acquire_factor_panel(run: AcquisitionRun) -> dict:
    """Pull all FRED + Yahoo + computed factors. Return schema-conforming dict."""
    factors = {}

    # FRED
    for label, meta in FRED_FACTORS.items():
        try:
            s = pull_fred_csv(meta["series_id"])
            if meta.get("computed") == "yoy":
                s = compute_yoy(s)
            if len(s) == 0:
                run.log_warning("acquisition", f"factor:{label}", f"empty series for FRED:{meta['series_id']}")
                continue
            factors[label] = {
                "source": f"FRED:{meta['series_id']}",
                "cadence": meta["cadence"],
                "unit": meta["unit"],
                "min_value": meta["min"],
                "max_value": meta["max"],
                "max_mom_zscore": 5.0,
                "expected_lag_days": meta["expected_lag_days"],
                "points": series_to_points(s),
            }
            run.log_success("acquisition", f"factor:{label}",
                            f"{len(s)} obs, last={s.index[-1].date()}")
        except Exception as e:
            run.log_failure("acquisition", f"factor:{label}", f"{type(e).__name__}: {e}")

    # Yahoo
    for label, meta in YAHOO_FACTORS.items():
        try:
            s = pull_yahoo(meta["ticker"])
            if len(s) == 0:
                run.log_warning("acquisition", f"factor:{label}", f"empty series for Yahoo:{meta['ticker']}")
                continue
            factors[label] = {
                "source": f"Yahoo:{meta['ticker']}",
                "cadence": meta["cadence"],
                "unit": meta["unit"],
                "min_value": meta["min"],
                "max_value": meta["max"],
                "max_mom_zscore": 5.0,
                "expected_lag_days": meta["expected_lag_days"],
                "points": series_to_points(s),
            }
            run.log_success("acquisition", f"factor:{label}",
                            f"{len(s)} obs, last={s.index[-1].date()}")
        except Exception as e:
            run.log_failure("acquisition", f"factor:{label}", f"{type(e).__name__}: {e}")

    # Computed: copper_gold
    try:
        copper = pull_yahoo("HG=F")
        gold = pull_yahoo("GC=F")
        cg = (copper / gold).dropna()
        meta = COMPUTED_FACTORS["copper_gold"]
        factors["copper_gold"] = {
            "source": "Computed:HG=F/GC=F",
            "cadence": meta["cadence"],
            "unit": meta["unit"],
            "min_value": meta["min"],
            "max_value": meta["max"],
            "max_mom_zscore": 5.0,
            "expected_lag_days": meta["expected_lag_days"],
            "points": series_to_points(cg),
        }
        run.log_success("acquisition", "factor:copper_gold",
                        f"{len(cg)} obs, last={cg.index[-1].date()}")
    except Exception as e:
        run.log_failure("acquisition", "factor:copper_gold", f"{type(e).__name__}: {e}")

    return {
        "schema_version": "v10.0",
        "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_run_id": run.run_id,
        "factors": factors,
    }


def acquire_price_panel(run: AcquisitionRun) -> dict:
    """Pull daily prices for all 20 tickers via yfinance."""
    df = yf.download(ALL_TICKERS, start=PRICE_HISTORY_START, progress=False,
                     auto_adjust=True, threads=True)
    if isinstance(df.columns, pd.MultiIndex):
        df = df["Close"]

    tickers = {}
    for ticker in ALL_TICKERS:
        if ticker not in df.columns:
            run.log_failure("acquisition", f"price:{ticker}", "missing from yfinance response")
            continue
        s = df[ticker].dropna()
        if len(s) < 60:
            run.log_warning("acquisition", f"price:{ticker}",
                            f"only {len(s)} observations (< 60)")
            continue
        tickers[ticker] = {
            "source": f"Yahoo:{ticker}",
            "first_observation": s.index[0].strftime("%Y-%m-%d"),
            "last_observation": s.index[-1].strftime("%Y-%m-%d"),
            "n_observations": len(s),
            "points": [[d.strftime("%Y-%m-%d"), float(v)] for d, v in s.items()],
        }
        run.log_success("acquisition", f"price:{ticker}",
                        f"{len(s)} obs, {s.index[0].date()} → {s.index[-1].date()}")

    return {
        "schema_version": "v10.0",
        "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_run_id": run.run_id,
        "tickers": tickers,
    }


def acquire_spy_holdings(run: AcquisitionRun) -> dict | None:
    """Pull SSGA's daily SPY holdings disclosure and aggregate to GICS sector.

    Returns None if pull fails — operator can use last-known-good fallback.
    """
    try:
        with urlopen(SPY_HOLDINGS_URL, timeout=30) as resp:
            data = resp.read()
    except (URLError, TimeoutError) as e:
        run.log_warning("acquisition", "spy_holdings", f"SSGA pull failed: {e}; operator should use fallback")
        return None

    try:
        # SSGA workbook has metadata in the top rows + holdings starting around row 5
        df = pd.read_excel(io.BytesIO(data), header=None)
        # Find the header row dynamically — SSGA tends to use "Name" or "Ticker" as a column
        header_idx = None
        for i, row in df.iterrows():
            cells = [str(c).lower() for c in row.values]
            if any("ticker" in c for c in cells) and any("weight" in c for c in cells):
                header_idx = i
                break
        if header_idx is None:
            run.log_failure("acquisition", "spy_holdings", "could not locate header row in SSGA workbook")
            return None

        df_h = pd.read_excel(io.BytesIO(data), header=header_idx)
        df_h.columns = [str(c).strip() for c in df_h.columns]

        # Locate the relevant columns by name
        col_ticker = next((c for c in df_h.columns if "ticker" in c.lower()), None)
        col_name = next((c for c in df_h.columns if "name" in c.lower()), None)
        col_weight = next((c for c in df_h.columns if "weight" in c.lower()), None)
        col_sector = next((c for c in df_h.columns if "sector" in c.lower()), None)
        if not all([col_ticker, col_name, col_weight, col_sector]):
            run.log_failure("acquisition", "spy_holdings",
                            f"missing required columns. Got: {list(df_h.columns)}")
            return None

        # Drop summary rows (Cash, Receivables, etc.) that don't have a ticker
        df_h = df_h[df_h[col_ticker].notna()].copy()
        df_h[col_weight] = pd.to_numeric(df_h[col_weight], errors="coerce")
        df_h = df_h[df_h[col_weight].notna()]

        # Convert percent if needed (sometimes 30 means 30%, sometimes 0.30)
        total = df_h[col_weight].sum()
        if total > 5:  # e.g., 99.8 — values are in percent
            df_h[col_weight] = df_h[col_weight] / 100
            total = df_h[col_weight].sum()

        sector_weights = df_h.groupby(col_sector)[col_weight].sum().sort_values(ascending=False).to_dict()
        top_holdings = (
            df_h.sort_values(col_weight, ascending=False).head(10)
            .apply(lambda r: {
                "name": str(r[col_name]),
                "ticker": str(r[col_ticker]),
                "weight": float(r[col_weight]),
                "sector": str(r[col_sector]),
            }, axis=1).tolist()
        )

        out = {
            "schema_version": "v10.0",
            "as_of": datetime.now().strftime("%Y-%m-%d"),
            "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": SPY_HOLDINGS_URL,
            "sector_weights": {k: float(v) for k, v in sector_weights.items()},
            "top_holdings": top_holdings,
            "total_weight_check": float(total),
        }
        run.log_success("acquisition", "spy_holdings",
                        f"{len(df_h)} holdings across {len(sector_weights)} sectors, total={total:.4f}")
        return out
    except Exception as e:
        run.log_failure("acquisition", "spy_holdings", f"{type(e).__name__}: {e}")
        return None


def load_industry_groups() -> dict:
    """Load static industry-group reference data."""
    path = Path(__file__).parent / "industry_groups.json"
    return json.loads(path.read_text())


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", required=True, help="Output directory for run artifacts")
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = ap.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    run = AcquisitionRun(
        run_id=str(uuid.uuid4())[:8],
        start_time=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        run_dir=run_dir,
    )
    logger.info(f"=== Acquisition run {run.run_id} → {run_dir} ===")

    factor_panel = acquire_factor_panel(run)
    (run_dir / "factor_panel.json").write_text(json.dumps(factor_panel, indent=2))

    price_panel = acquire_price_panel(run)
    (run_dir / "price_panel.json").write_text(json.dumps(price_panel, indent=2))

    spy_holdings = acquire_spy_holdings(run)
    if spy_holdings is not None:
        (run_dir / "spy_holdings.json").write_text(json.dumps(spy_holdings, indent=2))
    else:
        run.log_warning("acquisition", "spy_holdings",
                        "no spy_holdings.json written — downstream uses last-known-good")

    reference = load_industry_groups()
    (run_dir / "reference_groups.json").write_text(json.dumps(reference, indent=2))
    run.log_success("acquisition", "reference_groups", f"{len(reference['groups'])} groups loaded")

    # Always write the run report, success or failure
    (run_dir / "acquisition_run.json").write_text(json.dumps(run.to_dict(), indent=2))
    logger.info(f"=== Run complete: {run.to_dict()['exit_status']} "
                f"({len(run.successes)} ok, {len(run.warnings)} warn, {len(run.failures)} fail) ===")

    return 0 if not run.failures else 1


if __name__ == "__main__":
    sys.exit(main())
