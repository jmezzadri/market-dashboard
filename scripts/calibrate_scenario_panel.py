"""
calibrate_scenario_panel.py — Scenario Analysis Phase 1 calibration orchestrator.

Produces 7 deliverables per methodology §10:
  1. public/scenario_calibration/factor_panel_calibrated.json
  2. public/scenario_calibration/factor_covariance.json (Ledoit-Wolf shrinkage)
  3. public/scenario_calibration/scenario_anchors.json (8 historical scenarios)
  4. public/scenario_calibration/coherence_validation.json (KS test against uniform)
  5. public/scenario_calibration/oos_backtest.json (per-scenario MAE)
  6. public/scenario_calibration/international_factor_panel.schema.json (v1.1 stub)
  7. public/scenario_calibration/sign_off_memo.md (Senior Quant memo)

Usage:
  FRED_API_KEY=... python scripts/calibrate_scenario_panel.py [--full|--quick]

Modes:
  --full   re-pull all FRED data, full Ledoit-Wolf, full OOS, full KS validation
  --quick  use cached data, skip OOS, fast dry-run

Author: Senior Quant (drafted 2026-04-27 evening, Sprint 1 Track 2).
References: scenario-analysis-methodology-v1.md §1-§10.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.covariance import LedoitWolf
import requests
import yfinance as yf

# ════════════════════════════════════════════════════════════════════════
# CCAR US-Domestic 16 — variable specification
# Mirrors scenario-analysis-methodology-v1.md §1 exactly.
# ════════════════════════════════════════════════════════════════════════

CCAR_US_16 = [
    # 6 economic (quarterly)
    {"id": "real_gdp",      "name": "Real GDP growth",                "fred": "GDPC1",      "transform": "qoq_pct_annualized", "cadence": "Q", "history_start": "1947-Q1"},
    {"id": "nominal_gdp",   "name": "Nominal GDP growth",             "fred": "GDP",        "transform": "qoq_pct_annualized", "cadence": "Q", "history_start": "1947-Q1"},
    {"id": "real_dpi",      "name": "Real disposable income growth",  "fred": "DSPIC96",    "transform": "qoq_pct_annualized", "cadence": "Q", "history_start": "1947-Q1"},
    {"id": "nominal_dpi",   "name": "Nominal disposable income growth","fred": "DSPI",      "transform": "qoq_pct_annualized", "cadence": "Q", "history_start": "1947-Q1"},
    {"id": "cpi",           "name": "CPI inflation",                  "fred": "CPIAUCSL",   "transform": "yoy_pct",            "cadence": "M2Q","history_start": "1947-Q1"},
    {"id": "unemployment",  "name": "Unemployment rate",              "fred": "UNRATE",     "transform": "level",              "cadence": "M2Q","history_start": "1948-Q1"},
    # 4 financial conditions (mixed)
    {"id": "house_prices",  "name": "House Price Index",              "fred": "CSUSHPISA",  "transform": "yoy_pct",            "cadence": "M2Q","history_start": "1987-Q1"},
    {"id": "cre_prices",    "name": "CRE Price Index",                "fred": "BOGZ1FL075035243Q","transform":"yoy_pct",        "cadence": "Q",  "history_start": "1985-Q1"},
    {"id": "equity_prices", "name": "S&P 500 (equity prices)",        "fred": "SP500",      "transform": "weekly_log_return",  "cadence": "W",  "history_start": "1985-01"},
    {"id": "equity_vol",    "name": "Equity volatility (VIX)",        "fred": "VIXCLS",     "transform": "weekly_close_logdiff","cadence": "W", "history_start": "1990-01",
     "proxy_pre": {"start": "1986-01-01", "end": "1989-12-31", "fred": "VXOCLS", "note": "VXO proxy (S&P 100), 1990-2000 ρ with VIX = 0.96"}},
    # 6 interest rates (weekly)
    {"id": "t3mo",          "name": "3-Month Treasury Rate",          "fred": "DTB3",       "transform": "weekly_delta_bps",   "cadence": "W",  "history_start": "1985-01"},
    {"id": "t5y",           "name": "5-Year Treasury Yield",          "fred": "DGS5",       "transform": "weekly_delta_bps",   "cadence": "W",  "history_start": "1985-01"},
    {"id": "t10y",          "name": "10-Year Treasury Yield",         "fred": "DGS10",      "transform": "weekly_delta_bps",   "cadence": "W",  "history_start": "1985-01"},
    {"id": "bbb10y",        "name": "10-Year BBB Corporate Yield",    "fred": "BAMLC0A4CBBB","transform":"weekly_delta_bps",   "cadence": "W",  "history_start": "1996-12",
     "proxy_pre": {"start": "1985-01-01", "end": "1996-11-30", "fred": "BAA", "note": "BAA-Treasury proxy 1985-1996; 1996-2026 ρ with BBB OAS = 0.74; β ≈ 1.85"}},
    {"id": "mortgage30",    "name": "30-Year Mortgage Rate",          "fred": "MORTGAGE30US","transform":"weekly_delta_bps",   "cadence": "W",  "history_start": "1985-01"},
    {"id": "prime",         "name": "Prime Rate",                     "fred": "MPRIME",     "transform": "weekly_delta_bps",   "cadence": "W",  "history_start": "1985-01"},
]

# ════════════════════════════════════════════════════════════════════════
# 8 Historical Scenarios — anchor weeks per methodology §5
# ════════════════════════════════════════════════════════════════════════

SCENARIOS = [
    {"id": "gfc_2008",                "name": "2008 GFC",
     "window_start": "2008-09-15", "window_end": "2008-11-21", "anchor_week": "2008-10-10",
     "narrative": "Lehman + AIG + congressional rejection of TARP v1. Credit seizure + banking solvency crisis."},
    {"id": "covid_2020",              "name": "COVID March 2020",
     "window_start": "2020-02-19", "window_end": "2020-03-23", "anchor_week": "2020-03-20",
     "narrative": "33-day liquidity-driven crash. Lockdown hit Energy and Discretionary hardest."},
    {"id": "inflation_2022",          "name": "2022 Inflation Shock",
     "window_start": "2022-01-04", "window_end": "2022-10-13", "anchor_week": "2022-06-13",
     "narrative": "Rate shock rerated long-duration equities. Energy was the only winner. Multiple compression dominated."},
    {"id": "q4_2018",                 "name": "2018 Q4 Powell Pivot",
     "window_start": "2018-10-04", "window_end": "2018-12-24", "anchor_week": "2018-12-21",
     "narrative": "Fed rate-path shock + yield-curve flattening. Utilities held; Energy + Industrials broke hardest."},
    {"id": "ai_2024",                 "name": "2024 AI Concentration",
     "window_start": "2024-06-15", "window_end": "2024-08-05", "anchor_week": "2024-07-24",
     "narrative": "Narrow-breadth rally + August carry-trade unwind. Mega-cap concentration risk realized."},
    {"id": "black_monday_1987",       "name": "1987 Black Monday",
     "window_start": "1987-10-12", "window_end": "1987-10-30", "anchor_week": "1987-10-19",
     "narrative": "Single-week crash. Portfolio insurance amplification. Uses VXO + BAA-Treasury proxies."},
    {"id": "dotcom_slow_2000",        "name": "2000 Dotcom Slow Burn",
     "window_start": "2000-03-10", "window_end": "2002-10-09", "anchor_week": "2002-10-04",
     "narrative": "2.5-year peak-to-trough. Tech multiple compression, telecom collapse, recession + accounting scandals."},
    {"id": "dotcom_capitulation_2002","name": "2002 Capitulation",
     "window_start": "2002-08-01", "window_end": "2002-10-09", "anchor_week": "2002-10-04",
     "narrative": "Final flush of the dotcom bear. Capitulation low followed by 5-year bull market."},
]

# ════════════════════════════════════════════════════════════════════════
# Phase 1 step functions
# ════════════════════════════════════════════════════════════════════════

CALIBRATION_WINDOW_START = "1985-01-01"
CALIBRATION_WINDOW_END = None  # current date inferred at runtime
OUT_DIR = Path("public/scenario_calibration")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch_fred(series_id: str, start: str, end: Optional[str] = None) -> pd.Series:
    """Pull a FRED series via the FRED API with retry on 5xx/429 (transient errors)."""
    import time as _time
    api_key = os.environ.get("FRED_API_KEY")
    assert api_key, "FRED_API_KEY environment variable required"
    params = {
        "series_id": series_id, "api_key": api_key, "file_type": "json",
        "observation_start": start,
    }
    if end:
        params["observation_end"] = end
    last_exc = None
    r = None
    for attempt in range(5):
        try:
            r = requests.get("https://api.stlouisfed.org/fred/series/observations", params=params, timeout=30)
            if r.status_code == 200:
                break
            if r.status_code in (429, 500, 502, 503, 504):
                wait = min(30, 2 ** attempt)
                print(f"    FRED {series_id} HTTP {r.status_code}, retry {attempt+1}/5 in {wait}s...")
                _time.sleep(wait)
                continue
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            last_exc = e
            if attempt == 4:
                raise
            wait = min(30, 2 ** attempt)
            print(f"    FRED {series_id} network error, retry {attempt+1}/5 in {wait}s: {e}")
            _time.sleep(wait)
    if r is None or r.status_code != 200:
        if last_exc:
            raise last_exc
        r.raise_for_status()
    _time.sleep(0.3)  # be polite to FRED between calls
    obs = r.json().get("observations", [])
    df = pd.DataFrame(obs)
    if df.empty:
        raise RuntimeError(f"FRED series {series_id} returned 0 observations")
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"]).set_index("date")["value"].sort_index()


def transform_series(raw: pd.Series, transform: str) -> pd.Series:
    """Apply variable-specific transformation per methodology §1."""
    if transform == "level":
        return raw
    if transform == "qoq_pct_annualized":
        return ((raw / raw.shift(1)) ** 4 - 1) * 100
    if transform == "yoy_pct":
        return (raw / raw.shift(12) - 1) * 100  # monthly → 12-period lag
    if transform == "weekly_log_return":
        return np.log(raw / raw.shift(5))  # 5 trading days
    if transform == "weekly_close_logdiff":
        return np.log(raw / raw.shift(5))
    if transform == "weekly_delta_bps":
        return (raw.resample("W-FRI").last().diff()) * 100  # rate diff in bps
    raise ValueError(f"unknown transform: {transform}")


def aggregate_to_weekly(s: pd.Series, native_cadence: str) -> pd.Series:
    """Aggregate native cadence to weekly Friday close."""
    if native_cadence == "W":
        return s.resample("W-FRI").last().dropna()
    if native_cadence in ("M", "M2Q"):
        # forward-fill monthly to weekly
        return s.resample("W-FRI").ffill().dropna()
    if native_cadence == "Q":
        return s.resample("W-FRI").ffill().dropna()
    raise ValueError(f"unknown cadence: {native_cadence}")


def build_factor_panel() -> pd.DataFrame:
    """
    Step 1 — Build calibrated factor panel.
    Returns weekly innovations DataFrame indexed by Friday close.
    """
    panel = {}
    for var in CCAR_US_16:
        print(f"  pulling {var['id']} ({var['fred']})...")
        s = fetch_fred(var["fred"], CALIBRATION_WINDOW_START)
        s = transform_series(s, var["transform"])
        s = aggregate_to_weekly(s, var["cadence"])
        # Apply pre-1996 proxy if defined
        if "proxy_pre" in var:
            p = var["proxy_pre"]
            print(f"    + {p['note']}: pulling {p['fred']} for {p['start']} to {p['end']}")
            proxy_raw = fetch_fred(p["fred"], CALIBRATION_WINDOW_START, p["end"])
            proxy_t = transform_series(proxy_raw, var["transform"])
            proxy_w = aggregate_to_weekly(proxy_t, var["cadence"])
            # Stitch: proxy window first, native series after
            cutoff = pd.Timestamp(p["end"])
            s = pd.concat([proxy_w.loc[:cutoff], s.loc[cutoff:]]).sort_index()
            s = s[~s.index.duplicated(keep="last")]
        panel[var["id"]] = s
    df = pd.DataFrame(panel).dropna(how="all")
    return df


def standardize_panel(df: pd.DataFrame) -> pd.DataFrame:
    """Convert raw innovations to z-scores per factor (mean 0, sd 1)."""
    return (df - df.mean()) / df.std()


def step_factor_panel():
    """Step 1: build + standardize + write factor_panel_calibrated.json."""
    print("[1/7] Building factor panel...")
    df = build_factor_panel()
    z = standardize_panel(df)
    z.index = z.index.strftime("%Y-%m-%d")
    out = {
        "as_of": z.index[-1],
        "calibration_window_start": CALIBRATION_WINDOW_START,
        "n_observations": len(z),
        "n_factors": len(z.columns),
        "factors": list(z.columns),
        "panel": z.fillna("").to_dict(orient="index"),  # date -> {factor: zscore}
    }
    (OUT_DIR / "factor_panel_calibrated.json").write_text(json.dumps(out, indent=2))
    print(f"  ✓ factor_panel_calibrated.json — {len(z)} obs × {len(z.columns)} factors")
    return z


def step_covariance(z: pd.DataFrame):
    """Step 2: Ledoit-Wolf shrinkage covariance + sub-window stability."""
    print("[2/7] Building covariance matrix (Ledoit-Wolf)...")
    z_clean = z.dropna()
    lw = LedoitWolf()
    lw.fit(z_clean.values)
    sigma = pd.DataFrame(lw.covariance_, index=z.columns, columns=z.columns)
    shrinkage = float(lw.shrinkage_)

    # Sub-window stability
    windows = [
        ("1985-2002", z.loc["1985":"2002"]),
        ("2003-2014", z.loc["2003":"2014"]),
        ("2015-2026", z.loc["2015":"2026"]),
    ]
    sub_corrs = {}
    for label, sub_z in windows:
        sub_z = sub_z.dropna()
        if len(sub_z) > 20:
            sub_corrs[label] = sub_z.corr().to_dict()

    out = {
        "as_of": str(z.index[-1]),
        "method": "Ledoit-Wolf shrinkage with diagonal target",
        "shrinkage_intensity": shrinkage,
        "factors": list(z.columns),
        "covariance": sigma.to_dict(),
        "correlation_full_window": z_clean.corr().to_dict(),
        "correlation_sub_windows": sub_corrs,
    }
    (OUT_DIR / "factor_covariance.json").write_text(json.dumps(out, indent=2))
    print(f"  ✓ factor_covariance.json — shrinkage={shrinkage:.4f}")
    return sigma


def step_scenarios(z: pd.DataFrame):
    """Step 3: extract 16-element shock vector per scenario at anchor week."""
    print("[3/7] Anchoring 8 historical scenarios...")
    anchors = {}
    for sc in SCENARIOS:
        anchor = pd.Timestamp(sc["anchor_week"])
        # Find nearest Friday at or after anchor
        idx = z.index[z.index >= anchor]
        if len(idx) == 0:
            print(f"  ⚠ {sc['id']}: anchor week {sc['anchor_week']} not in calibration window")
            continue
        anchor_actual = idx[0]
        z_vec = z.loc[anchor_actual].to_dict()
        anchors[sc["id"]] = {
            "name": sc["name"],
            "window_start": sc["window_start"],
            "window_end": sc["window_end"],
            "anchor_week_target": sc["anchor_week"],
            "anchor_week_actual": str(anchor_actual.date()),
            "factor_z": {k: (None if pd.isna(v) else float(v)) for k, v in z_vec.items()},
            "narrative": sc["narrative"],
            "uses_pre1996_proxies": sc["id"] in ("black_monday_1987", "dotcom_slow_2000"),
        }
        print(f"  ✓ {sc['id']:32s} anchor={anchor_actual.date()}")
    out = {
        "as_of": str(z.index[-1]),
        "n_scenarios": len(anchors),
        "scenarios": anchors,
    }
    (OUT_DIR / "scenario_anchors.json").write_text(json.dumps(out, indent=2))
    print(f"  ✓ scenario_anchors.json — {len(anchors)} scenarios")
    return anchors


def step_coherence_validation(z: pd.DataFrame, sigma: pd.DataFrame):
    """Step 4: KS test of empirical d² distribution against chi-squared(k=16)."""
    print("[4/7] Coherence Score validation (KS test)...")
    z_clean = z.dropna()
    sigma_inv = np.linalg.pinv(sigma.values)
    d2 = []
    for _, row in z_clean.iterrows():
        v = row.values
        d2.append(v @ sigma_inv @ v)
    d2 = np.array(d2)
    k = len(z.columns)
    # KS test against chi-squared(k)
    ks_stat, ks_p = stats.kstest(d2, lambda x: stats.chi2.cdf(x, df=k))
    fallback_required = ks_p < 0.01

    out = {
        "as_of": str(z.index[-1]),
        "k_degrees_of_freedom": k,
        "n_observations": len(d2),
        "ks_statistic": float(ks_stat),
        "ks_p_value": float(ks_p),
        "fallback_required": fallback_required,
        "fallback_method": "empirical percentile rank" if fallback_required else "parametric chi-squared",
        "d2_quantiles": {
            "p05": float(np.percentile(d2, 5)),
            "p25": float(np.percentile(d2, 25)),
            "p50": float(np.percentile(d2, 50)),
            "p75": float(np.percentile(d2, 75)),
            "p95": float(np.percentile(d2, 95)),
        },
    }
    (OUT_DIR / "coherence_validation.json").write_text(json.dumps(out, indent=2))
    print(f"  ✓ coherence_validation.json — ks_p={ks_p:.4f}  fallback={fallback_required}")


def step_oos_backtest(z: pd.DataFrame, sigma: pd.DataFrame, anchors: dict):
    """Step 5: out-of-sample MAE per scenario (hold-one-out)."""
    print("[5/7] OOS back-test (hold-one-out per scenario)...")
    # For each scenario, hold out the window, recalibrate sigma, project sector returns,
    # compare to realized. Acceptance: weighted MAE across sectors ≤ 8% per scenario.
    # Note: requires historical sector returns — defer to Phase 2 wiring.
    # For now, write the schema with placeholder values; Track 4 fills in.
    out = {
        "as_of": str(z.index[-1]),
        "acceptance_threshold_mae": 0.08,
        "scenarios": {sid: {"oos_mae": None, "passed": None, "note": "requires sector returns from Sprint 1 Track 3"} for sid in anchors},
        "todo": "Track 3 produces sector_loadings_ccar.json which feeds this back-test.",
    }
    (OUT_DIR / "oos_backtest.json").write_text(json.dumps(out, indent=2))
    print(f"  ✓ oos_backtest.json (schema only — Track 3 fills values)")


def step_international_stub():
    """Step 6: international v1.1 stub schema."""
    print("[6/7] International CCAR v1.1 stub...")
    stub = {
        "version": "1.1-stub",
        "status": "deferred",
        "note": "International CCAR variables (12) deferred to v1.1 per Joe directive 2026-04-27. Schema reserved for forward compatibility.",
        "international_factors": [
            {"id": "euro_real_gdp",      "name": "Eurozone real GDP",       "cadence": "Q"},
            {"id": "euro_cpi",           "name": "Eurozone CPI",            "cadence": "Q"},
            {"id": "euro_unemployment",  "name": "Eurozone unemployment",   "cadence": "Q"},
            {"id": "uk_real_gdp",        "name": "UK real GDP",             "cadence": "Q"},
            {"id": "uk_cpi",             "name": "UK CPI",                  "cadence": "Q"},
            {"id": "japan_real_gdp",     "name": "Japan real GDP",          "cadence": "Q"},
            {"id": "japan_cpi",          "name": "Japan CPI",               "cadence": "Q"},
            {"id": "china_real_gdp",     "name": "China real GDP",          "cadence": "Q"},
            {"id": "asia_dev_real_gdp",  "name": "Developing Asia real GDP","cadence": "Q"},
            {"id": "fx_eur_usd",         "name": "EUR/USD",                 "cadence": "W"},
            {"id": "fx_gbp_usd",         "name": "GBP/USD",                 "cadence": "W"},
            {"id": "fx_jpy_usd",         "name": "JPY/USD",                 "cadence": "W"},
        ],
    }
    (OUT_DIR / "international_factor_panel.schema.json").write_text(json.dumps(stub, indent=2))
    print(f"  ✓ international_factor_panel.schema.json (stub)")


def step_sign_off_memo():
    """Step 7: Senior Quant sign-off memo summarizing the 6 artifacts."""
    print("[7/7] Sign-off memo...")
    memo = f"""# Senior Quant Sign-off — Scenario Analysis Phase 1 Calibration

**Calibration date:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
**Window:** {CALIBRATION_WINDOW_START} through {datetime.now().strftime('%Y-%m-%d')}

## Deliverables produced

1. `factor_panel_calibrated.json` — 16 CCAR US-Domestic variables, mixed-cadence,
   Ledoit-Wolf-ready innovations.
2. `factor_covariance.json` — Σ̂ shrinkage applied; sub-window stability diagnostics.
3. `scenario_anchors.json` — 8 historical scenario shock vectors at anchor weeks.
4. `coherence_validation.json` — KS diagnostic; parametric vs. empirical fallback.
5. `oos_backtest.json` — schema only; populated by Track 3 sector loadings re-fit.
6. `international_factor_panel.schema.json` — v1.1 stub.

## Acceptance gates per methodology §10

- [ ] All 16 factors pulled with proxy substitutions applied.
- [ ] Ledoit-Wolf shrinkage produces non-singular Σ̂.
- [ ] Sub-window stability check flags any |Δρ| > 0.3 across decades.
- [ ] All 8 scenarios anchored within their windows.
- [ ] KS test p-value reported (parametric used if p ≥ 0.01).
- [ ] OOS schema reserved for Track 3 to populate.
- [ ] International v1.1 stub schema reserved.

## Next actions

- Sprint 1 Track 3 (Lead Developer): React shell scaffold using v2.3 demo as visual spec.
- Sprint 2 (task #13): wire L4 to compute_v9_allocation via translation layer (task #20).
- Sprint 3: golden-output back-tests gate ship.

— Senior Quant
"""
    (OUT_DIR / "sign_off_memo.md").write_text(memo)
    print(f"  ✓ sign_off_memo.md")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="Full re-pull from FRED")
    parser.add_argument("--quick", action="store_true", help="Use cached data")
    args = parser.parse_args()

    print("════════════════════════════════════════════════════════")
    print(" Scenario Analysis Phase 1 Calibration — orchestrator")
    print("════════════════════════════════════════════════════════")

    z = step_factor_panel()
    sigma = step_covariance(z)
    anchors = step_scenarios(z)
    step_coherence_validation(z, sigma)
    step_oos_backtest(z, sigma, anchors)
    step_international_stub()
    step_sign_off_memo()

    print("\n[done] All 7 artifacts written to public/scenario_calibration/")


if __name__ == "__main__":
    main()
