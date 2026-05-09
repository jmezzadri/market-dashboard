#!/usr/bin/env python3
"""
compute_ig_factor_loadings.py — Phase 2F producer (v1, pre-defined loadings).

WHY THIS METHODOLOGY (NOT REGRESSION):
The scope doc originally specified a multi-factor weekly OLS regression with
an OOS R² > 0.55 gate. Empirical reality on IG ETF returns: that gate is
unachievable. In-sample R² lands in the 0.05–0.45 range; OOS R² goes
deeply negative because the model overfits a 5-year window. This is
well-documented in factor-investing literature for sector / IG returns.
Joe directive 2026-05-09: ship Phase 2F using pre-defined parent-sector
loadings inherited per IG, gated by directional regime alignment instead
of OOS R². The regression methodology stays on the backlog as a follow-up
once the loadings can be regularized (ridge / lasso) and the data
horizon extended.

WHAT THIS PRODUCER DOES:
For each industry group:
  • Inherit the 12-factor loading vector from its parent GICS sector
    (defined in src/pages/ScenarioAnalysis.jsx as SECTORS_RAW.loadings)
  • Tag the loading source as 'parent_sector_inherit' for traceability
  • Compute the IG's predicted stress for each of the 8 historical
    scenarios using the same dot-product math the live engine uses:
        predicted_stress = Σ loading_j × scenario.factor_j
  • Pull the IG primary proxy ETF's realized total return over each
    scenario's peak window from yfinance
  • Flag predicted_stress sign vs realized_return sign per
    (IG × scenario) pair
  • Aggregate the directional-correctness rate across observable pairs

OUTPUTS:
  public/ig_factor_loadings.json — keyed by IG id, value is:
    {
      "name", "sector", "proxy_ticker",
      "loadings": {factor_id: float, …},   # 12-factor vector
      "loading_source": "parent_sector_inherit",
      "directional_test": {
        "n_observable":  …,
        "n_correct":     …,
        "rate":          0.xx,
        "passes_gate":   bool,
        "scenarios": {
          scenario_id: {
            "predicted_sign": ±,
            "realized_return": …,
            "realized_sign": ±,
            "match": bool,
          }, …
        }
      },
      "as_of":   today,
    }

PHASE 2 SIGN-OFF GATE (post-decision 2026-05-09):
  Directional alignment ≥ 75% across observable (IG × scenario) pairs.
  Per-scenario / per-IG details in dist/ig_directional_test/SUMMARY.md.

FACTORS (matches sectorShocks() in src/pages/ScenarioAnalysis.jsx):
    vix · move · real_rates · term_premium · dxy · copper_gold
    hy · stlfsi · anfci · aaii · putcall · breadth
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
V10_ALLOC = REPO_ROOT / "public" / "v10_allocation.json"
SCENARIO_FILE = REPO_ROOT / "src" / "pages" / "ScenarioAnalysis.jsx"
OUT_PATH = REPO_ROOT / "public" / "ig_factor_loadings.json"
EVIDENCE_DIR = REPO_ROOT / "dist" / "ig_directional_test"

DIRECTIONAL_GATE = 0.75
FACTOR_ORDER = [
    "vix", "move", "real_rates", "term_premium", "dxy", "copper_gold",
    "hy", "stlfsi", "anfci", "aaii", "putcall", "breadth",
]


# ───── parse SECTORS_RAW loadings + SCENARIOS factors out of the JSX ─────
def parse_sector_loadings(jsx_src: str) -> Dict[str, Dict[str, float]]:
    """Pull each sector's `loadings: {…}` out of SECTORS_RAW. Returns
    {sector_name: {factor: float}}."""
    out: Dict[str, Dict[str, float]] = {}
    # Match: { id:"XLK", name:"Technology", …, loadings:{ vix:+0.85, … }, …
    pattern = re.compile(
        r'\{\s*id:\s*"(?P<id>[^"]+)"\s*,\s*name:\s*"(?P<name>[^"]+)"[^{]*?'
        r'loadings:\s*\{(?P<loadings>[^}]+)\}', re.S
    )
    kv = re.compile(r'(\w+)\s*:\s*([+\-]?\d+(?:\.\d+)?)')
    for m in pattern.finditer(jsx_src):
        name = m.group("name")
        loadings = {k: float(v) for k, v in kv.findall(m.group("loadings"))}
        out[name] = loadings
    return out


def parse_scenarios(jsx_src: str) -> Dict[str, Dict[str, float]]:
    """Pull each scenario's `factors: {…}` from SCENARIOS. Returns
    {scenario_id: {factor: float}}."""
    out: Dict[str, Dict[str, float]] = {}
    # SCENARIOS = { black_monday_1987: { name:"…", window:"…", factors:{…},
    pattern = re.compile(
        r'(\w+):\s*\{\s*name:\s*"[^"]+",\s*window:\s*"[^"]+",\s*'
        r'factors:\s*\{(?P<factors>[^}]+)\}', re.S
    )
    kv = re.compile(r'(\w+)\s*:\s*([+\-]?\d+(?:\.\d+)?)')
    for m in pattern.finditer(jsx_src):
        sid = m.group(1)
        factors = {k: float(v) for k, v in kv.findall(m.group("factors"))}
        if "vix" in factors:  # sanity check it's a scenario factor block
            out[sid] = factors
    return out


def parse_scenario_windows(jsx_src: str) -> Dict[str, Tuple[str, str]]:
    """Pull each scenario's display window (e.g. 'Sep–Nov 2008'). Returns
    {scenario_id: (start, end)} as ISO dates — best-effort parsed from
    public/scenario_stress_calibration.json's peak_window for accuracy."""
    calib_path = REPO_ROOT / "public" / "scenario_stress_calibration.json"
    out: Dict[str, Tuple[str, str]] = {}
    if not calib_path.exists():
        return out
    calib = json.loads(calib_path.read_text())
    iso_re = re.compile(r"(\d{4}-\d{2}-\d{2})")
    for sid, s in calib.get("scenarios", {}).items():
        pw = s.get("peak_window", "")
        m = iso_re.findall(pw)
        if len(m) >= 2:
            out[sid] = (m[0], m[1])
        elif len(m) == 1:
            out[sid] = (m[0], m[0])
    return out


# ───── yfinance pull: 5y monthly beta vs SPY (batched) ─────
def fetch_betas_batch(tickers: List[str], end: dt.date) -> Dict[str, float]:
    """Compute 5y monthly log-return beta vs SPY for every ticker in one
    yfinance call. Monthly horizon balances signal vs noise; daily would
    take 24× longer with the same answer to two decimal places.
    Returns {ticker: beta} for tickers that produced enough data; missing
    tickers are simply not in the dict."""
    try:
        import yfinance as yf
    except ImportError:
        return {}
    start = end - dt.timedelta(days=365 * 5 + 60)
    syms = list(dict.fromkeys(list(tickers) + ["SPY"]))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df = yf.download(syms, start=start.isoformat(), end=end.isoformat(),
                         interval="1mo", progress=False, auto_adjust=False)
    if df is None or "Adj Close" not in df.columns.get_level_values(0):
        return {}
    adj = df["Adj Close"].dropna(how="all")
    if "SPY" not in adj.columns or len(adj) < 24:
        return {}
    log_r = (adj.shift(-1) / adj - 1).dropna(how="all")
    spy = log_r["SPY"].dropna()
    betas: Dict[str, float] = {}
    for t in tickers:
        if t not in log_r.columns:
            continue
        s = log_r[t].dropna()
        common = s.index.intersection(spy.index)
        if len(common) < 24:
            continue
        a = s.loc[common].values.astype(float)
        b = spy.loc[common].values.astype(float)
        import numpy as _np
        var_b = float(_np.var(b))
        if var_b <= 0:
            continue
        cov = float(_np.mean((a - a.mean()) * (b - b.mean())))
        betas[t] = round(cov / var_b, 3)
    return betas


# ───── yfinance pull for scenario-window IG returns ─────
def fetch_window_return(ticker: str, start: str, end: str) -> Optional[float]:
    try:
        import yfinance as yf
    except ImportError:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # Pull a small window AROUND the target span for safety.
            start_dt = dt.date.fromisoformat(start) - dt.timedelta(days=10)
            end_dt = dt.date.fromisoformat(end) + dt.timedelta(days=10)
            df = yf.download(ticker, start=start_dt.isoformat(), end=end_dt.isoformat(),
                             interval="1d", progress=False, auto_adjust=False)
        if df is None or len(df) < 2:
            return None
        col = df["Adj Close"][ticker] if df.columns.nlevels == 2 else df["Adj Close"]
        col = col.dropna()
        if len(col) < 2:
            return None
        # First close on or after start, last close on or before end
        sd = dt.date.fromisoformat(start)
        ed = dt.date.fromisoformat(end)
        before = col[col.index.date <= sd]
        after = col[col.index.date >= ed]
        # If those are empty, fall back to first / last available
        s_val = before.iloc[-1] if len(before) else col.iloc[0]
        e_val = after.iloc[0] if len(after) else col.iloc[-1]
        if s_val == 0:
            return None
        return float((e_val - s_val) / s_val)
    except Exception as e:
        print(f"    [fetch] {ticker} {start}→{end} failed: {e}", file=sys.stderr)
        return None


# ───── main ─────
def main() -> int:
    if not V10_ALLOC.exists():
        print(f"FATAL: {V10_ALLOC} missing", file=sys.stderr); return 2
    if not SCENARIO_FILE.exists():
        print(f"FATAL: {SCENARIO_FILE} missing", file=sys.stderr); return 2

    jsx_src = SCENARIO_FILE.read_text()
    sector_loadings = parse_sector_loadings(jsx_src)
    scenarios = parse_scenarios(jsx_src)
    scenario_windows = parse_scenario_windows(jsx_src)
    print(f"Parsed {len(sector_loadings)} sector loading vectors, "
          f"{len(scenarios)} scenarios, {len(scenario_windows)} scenario windows")

    v10 = json.loads(V10_ALLOC.read_text())
    igs = v10.get("industry_groups") or []
    print(f"Industry groups in v10_allocation.json: {len(igs)}\n")

    out_rows: List[dict] = []
    total_correct = 0
    total_observable = 0
    end = dt.date.today()

    # Batch-fetch betas for all IG proxies in one yfinance call.
    proxy_set = [(ig.get("tickers") or [None])[0] for ig in igs]
    proxy_set = [p for p in proxy_set if p]
    print(f"Fetching betas for {len(proxy_set)} proxy ETFs in batch...")
    beta_by_ticker = fetch_betas_batch(proxy_set, end)
    print(f"  betas resolved: {len(beta_by_ticker)} of {len(proxy_set)}\n")

    for ig in igs:
        ig_id = ig.get("id")
        proxy = (ig.get("tickers") or [None])[0]
        sector = ig.get("sector")
        # Resolve parent-sector name to the SECTORS_RAW key. v10 uses GICS-like
        # names (e.g. "Information Technology") while SECTORS_RAW uses shorter
        # display names ("Technology"). Build a tolerant alias map.
        sector_alias = {
            "Information Technology": "Technology",
            "Communication Services": "Communication Services",
            "Financials": "Financials",
            "Industrials": "Industrials",
            "Health Care": "Healthcare",
            "Consumer Staples": "Staples",
            "Consumer Discretionary": "Discretionary",
            "Energy": "Energy",
            "Materials": "Materials",
            "Real Estate": "Real Estate",
            "Utilities": "Utilities",
        }
        load_key = sector_alias.get(sector, sector)
        loadings = sector_loadings.get(load_key)
        if not loadings:
            print(f"  [{ig_id}] no parent-sector loadings for '{sector}' — skipping")
            continue
        # Pad to FACTOR_ORDER (defaults 0 for any factor missing)
        loadings_full = {f: float(loadings.get(f, 0.0)) for f in FACTOR_ORDER}

        # Per-IG beta vs SPY pulled from the batched fetch above.
        beta = beta_by_ticker.get(proxy) if proxy else None

        # Directional test against each scenario
        scenario_results: Dict[str, dict] = {}
        for sid, factors in scenarios.items():
            window = scenario_windows.get(sid)
            if not window:
                scenario_results[sid] = {"reason": "no peak_window in calibration"}
                continue
            predicted = sum(loadings_full[f] * factors.get(f, 0.0) for f in FACTOR_ORDER)
            # Loadings ON the bullish side (positive number) MEANS more stress when
            # factor goes up. Predicted >0 = stress UP = realized return DOWN expected.
            # So expected sign of realized return = -sign(predicted).
            realized = fetch_window_return(proxy, window[0], window[1]) if proxy else None
            if realized is None:
                scenario_results[sid] = {
                    "predicted_stress": round(predicted, 3),
                    "realized_return": None,
                    "match": None,
                    "reason": "yfinance returned no price data for this window",
                }
                continue
            pred_sign = 1 if predicted > 0.05 else -1 if predicted < -0.05 else 0
            real_sign = 1 if realized > 0.005 else -1 if realized < -0.005 else 0
            # Predicted-stress UP should map to realized-return DOWN (i.e., opposite signs).
            expected_real_sign = -pred_sign
            match = (real_sign == expected_real_sign) if (pred_sign != 0 and real_sign != 0) else None
            scenario_results[sid] = {
                "predicted_stress": round(predicted, 3),
                "realized_return": round(realized, 4),
                "match": match,
                "reason": None if match is not None else "near-zero predicted or realized",
            }
            if match is True:
                total_correct += 1
                total_observable += 1
            elif match is False:
                total_observable += 1

        per_ig_obs = sum(1 for r in scenario_results.values() if r.get("match") in (True, False))
        per_ig_correct = sum(1 for r in scenario_results.values() if r.get("match") is True)
        rate = per_ig_correct / per_ig_obs if per_ig_obs else None
        passes = rate is not None and rate >= DIRECTIONAL_GATE
        print(f"  [{ig_id:<12}] proxy={proxy:<6} parent={load_key:<22} "
              f"directional={per_ig_correct}/{per_ig_obs} "
              f"({(rate*100):.0f}%)" if rate is not None else
              f"  [{ig_id:<12}] proxy={proxy:<6} parent={load_key:<22} "
              f"directional=N/A (no observable scenarios)")

        out_rows.append({
            "id": ig_id,
            "name": ig.get("name"),
            "sector": sector,
            "proxy_ticker": proxy,
            "loadings": loadings_full,
            "beta_vs_spy": round(beta, 3) if beta is not None else None,
            "loading_source": "parent_sector_inherit",
            "loading_source_note": (
                f"v1: inherits parent-sector loadings for '{load_key}' verbatim. "
                "Per-IG adjustments to be added in Phase 2F.1 follow-ups based on "
                "IG-specific factor sensitivities."
            ),
            "directional_test": {
                "n_observable": per_ig_obs,
                "n_correct": per_ig_correct,
                "rate": round(rate, 3) if rate is not None else None,
                "passes_gate": passes,
                "scenarios": scenario_results,
            },
            "as_of": end.isoformat(),
        })

    overall_rate = total_correct / total_observable if total_observable else None
    overall_passes = overall_rate is not None and overall_rate >= DIRECTIONAL_GATE

    out = {
        "_doc": (
            "Per-IG factor loadings (v1) inherited from parent GICS sector "
            "loadings defined in src/pages/ScenarioAnalysis.jsx SECTORS_RAW. "
            "Sign-off gate: directional alignment with historical scenarios "
            f">= {DIRECTIONAL_GATE*100:.0f}%. The original OOS R² > 0.55 gate "
            "from the Phase 2F scope doc was empirically unachievable on "
            "IG ETF returns (see scripts/compute_ig_factor_loadings.py "
            "module docstring). Refreshed weekly via that script."
        ),
        "as_of": end.isoformat(),
        "methodology_version": "v1-parent-inherit",
        "factor_order": FACTOR_ORDER,
        "directional_gate": DIRECTIONAL_GATE,
        "ig_count": len(out_rows),
        "directional_overall_rate": round(overall_rate, 3) if overall_rate is not None else None,
        "directional_overall_passes": overall_passes,
        "industry_groups": out_rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")

    # Markdown evidence
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    md = [f"# IG directional regime test — {end.isoformat()}", "",
          f"Sign-off gate: directional alignment ≥ **{DIRECTIONAL_GATE*100:.0f}%**.", ""]
    md.append("| IG | proxy | parent sector | observable | correct | rate | gate |")
    md.append("|---|---|---|---|---|---|---|")
    for r in out_rows:
        d = r["directional_test"]
        rate = d.get("rate")
        rate_str = f"{rate*100:.0f}%" if rate is not None else "—"
        gate_str = "✓ pass" if d.get("passes_gate") else ("✗ fail" if rate is not None else "n/a")
        md.append(f"| {r['id']} | {r['proxy_ticker']} | {r['sector']} | "
                  f"{d['n_observable']} | {d['n_correct']} | {rate_str} | {gate_str} |")
    md.append("")
    md.append(f"**Overall directional alignment:** "
              f"{total_correct}/{total_observable} = "
              f"{(overall_rate*100):.0f}%" if overall_rate else "n/a")
    md.append(f"**Phase 2 sign-off gate:** {'✓ PASS' if overall_passes else '✗ FAIL'}")
    (EVIDENCE_DIR / "SUMMARY.md").write_text("\n".join(md) + "\n")

    print()
    print(f"Wrote {OUT_PATH}")
    print(f"Wrote {EVIDENCE_DIR}/SUMMARY.md")
    print(f"\nOverall directional alignment: "
          f"{total_correct}/{total_observable} = "
          f"{(overall_rate*100):.0f}%  {'PASS' if overall_passes else 'FAIL'} "
          f"(gate {DIRECTIONAL_GATE*100:.0f}%)")
    return 0 if overall_passes else 1


if __name__ == "__main__":
    raise SystemExit(main())
