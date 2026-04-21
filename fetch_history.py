#!/usr/bin/env python3
"""
Market Stress Dashboard — Indicator HISTORY Fetcher
Pulls 15 years of historical data at native cadence for all 25 indicators.
Writes public/indicator_history.json consumed by the React chart.

Output shape:
  {
    "vix":       {"freq":"D","unit":"index","points":[["2011-01-03",17.75], ...]},
    "hy_ig":     {"freq":"D", ...},
    ...
  }

Run standalone:
    python3 fetch_history.py
Or with explicit API key:
    FRED_API_KEY=... python3 fetch_history.py

Release cadence per indicator mirrors IND_FREQ in src/App.jsx:
  Daily (10):     vix, hy_ig, eq_cr_corr, yield_curve, move, real_rates,
                  copper_gold, bkx_spx, usd, skew
  Weekly (8):     anfci, stlfsi, cpff, loan_syn, bank_credit, jobless,
                  cmdi, term_premium
  Monthly (3):    cape, ism, jolts_quits
  Quarterly (4):  sloos_ci, sloos_cre, bank_unreal, credit_3y

Notes:
- ^MOVE is not on Yahoo; we proxy via MOVE's near-equivalent at ICE or skip.
  For this scanner, we synthesize MOVE from 3M swaption vol unavailable publicly
  — we fall back to a static anchor series if Yahoo lookup fails.
- CAPE (Shiller): no free daily series; we use multpl.com-style monthly anchor.
- ISM: FRED series NAPMPI (we use the older ISMMAN_PMI mnemonic via series lookup).
- bank_unreal: FDIC quarterly; no free time-series API, we keep the hand-curated
  overrides already in App.jsx.
- sloos_cre FRED id: DRTSCLCC (net % tightening CRE)
- sloos_ci  FRED id: DRTSCILM (net % tightening C&I)
- cpff: (DCPF3M - DFF) in bps; weekly effective
"""

import os
import sys
import json
import warnings
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

try:
    from fredapi import Fred
    import yfinance as yf
    import pandas as pd
    import numpy as np
except ImportError as e:
    print(f"Missing library: {e}")
    print("Run: pip install --break-system-packages fredapi yfinance pandas numpy")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(BASE_DIR, "public", "indicator_history.json")
FRED_API_KEY = os.environ.get("FRED_API_KEY", "e1696db1c3f8bb036993f40c61aad0d5")

# 20y back-window captures 2007-2009 GFC, 2011 Euro crisis, 2015-16 oil crash,
# 2018 Vol-mageddon, 2020 COVID, 2022 hiking cycle, 2023 SVB, 2025 Liberation Day.
# File grows to ~1.2 MB which is still fine over the wire.
START = "2006-01-01"

# Stats computation window. We compute mean/sd over a TRAILING 15y of data
# (not the full 20y) so regime bands reflect the recent regime — the GFC
# is preserved in the chart for context but excluded from the stats cut-off
# so it doesn't inflate SD and mask current stress.
STATS_WINDOW_YEARS = 15

# Indicator "bad-direction" mapping — which tail of the distribution is
# unhealthy. Drives the SD-score → regime-band color:
#   hw = "high is worse" (VIX up = bad)
#   lw = "low is worse"  (ISM down = bad; bank_credit down = bad)
#   nw = "near zero is worse" (yield curve inversion or flat = bad both sides)
DIRECTION = {
    "vix":"hw","hy_ig":"hw","eq_cr_corr":"hw","yield_curve":"nw",
    "move":"hw","anfci":"hw","stlfsi":"hw","real_rates":"hw",
    "sloos_ci":"hw","cape":"hw","ism":"lw","copper_gold":"lw",
    "bkx_spx":"lw","bank_unreal":"hw","credit_3y":"hw","term_premium":"hw",
    "cmdi":"hw","loan_syn":"hw","usd":"hw","cpff":"hw","skew":"hw",
    "sloos_cre":"hw","bank_credit":"lw","jobless":"hw","jolts_quits":"lw",
}

fred = Fred(api_key=FRED_API_KEY)


def compute_stats(points, direction="hw", winsorize=True, window_years=STATS_WINDOW_YEARS):
    """Compute {mean, sd, window, winsorize, n} for a points list.

    Args:
        points: list of [iso_date_str, value_float]
        direction: 'hw' | 'lw' | 'nw' (written into output; consumed by React)
        winsorize: if True, trim 1st/99th percentile before stats (kills outliers
            like the 2020 COVID jobless spike without deleting them from the chart)
        window_years: trailing window in years; older data excluded from stats
    """
    if not points or len(points) < 10:
        return None
    dates = [pd.Timestamp(p[0]) for p in points]
    values = [p[1] for p in points]
    s = pd.Series(values, index=dates).sort_index()
    cutoff = s.index.max() - pd.Timedelta(days=365 * window_years)
    s = s[s.index >= cutoff]
    if len(s) < 10:
        return None
    if winsorize and len(s) > 20:
        p1, p99 = s.quantile(0.01), s.quantile(0.99)
        s = s.clip(lower=p1, upper=p99)
    return {
        "mean": round(float(s.mean()), 4),
        "sd": round(float(s.std()), 4),
        "window": f"{window_years}y",
        "winsorize": "1%-99%" if winsorize else "none",
        "n": int(len(s)),
        "direction": direction,
    }


def attach_stats_and_as_of(result):
    """Post-process: attach `stats` block and `as_of` date to every indicator."""
    for ind_id, entry in list(result.items()):
        if ind_id.startswith("__"):
            continue
        pts = entry.get("points", [])
        if not pts:
            continue
        entry["as_of"] = pts[-1][0]
        direction = DIRECTION.get(ind_id, "hw")
        stats = compute_stats(pts, direction=direction, winsorize=True)
        if stats:
            entry["stats"] = stats
    return result


def series_to_points(s, *, round_dp=4):
    """pandas Series of floats indexed by date → list of [iso_date, float]."""
    out = []
    for idx, v in s.items():
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            continue
        # Strip tz / time — chart only needs day resolution
        d = pd.Timestamp(idx).strftime("%Y-%m-%d")
        out.append([d, round(float(v), round_dp)])
    return out


def safe_fred(series_id, start=START, transform=None, retries=3):
    import time
    last_err = None
    for attempt in range(retries):
        try:
            s = fred.get_series(series_id, observation_start=start).dropna()
            if transform:
                s = transform(s)
            s = s.dropna()
            return s
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    print(f"  FRED {series_id} FAILED after {retries}: {last_err}")
    return None


def safe_yf(ticker, start=START):
    try:
        h = yf.Ticker(ticker).history(start=start, auto_adjust=False)["Close"].dropna()
        # Drop tz
        h.index = h.index.tz_localize(None) if h.index.tz is not None else h.index
        return h
    except Exception as e:
        print(f"  Yahoo {ticker} FAILED: {e}")
        return None


def fetch_all():
    result = {}

    # ── DAILY ──────────────────────────────────────────────────────────────
    print("VIX ...")
    s = safe_yf("^VIX")
    if s is not None:
        result["vix"] = {"freq": "D", "unit": "index",
                         "points": series_to_points(s, round_dp=2)}

    print("HY OAS (hy_ig proxy) ...")
    s = safe_fred("BAMLH0A0HYM2")
    if s is not None:
        # Convert decimal → bps (FRED reports in %; 4.5% → 450 bps)
        bps = s * 100.0
        # FRED ICE BofA feed was trimmed to 2023+ in recent license changes.
        # Back-fill with curated monthly anchors to restore 2011-2023 window.
        if len(bps) > 0 and pd.Timestamp(bps.index[0]).year >= 2022:
            anchor = _hy_ig_pre2023_anchor()
            anchor_s = pd.Series({pd.Timestamp(d): v for d, v in anchor})
            bps = pd.concat([anchor_s, bps[bps.index >= anchor_s.index[-1]]]).sort_index()
            bps = bps[~bps.index.duplicated(keep="last")]
        result["hy_ig"] = {"freq": "D", "unit": "bps",
                           "points": series_to_points(bps, round_dp=1)}

    print("EQ-Credit Corr (SPY/HYG 63d rolling) ...")
    spy = safe_yf("SPY")
    hyg = safe_yf("HYG")
    if spy is not None and hyg is not None:
        df = pd.concat(
            [spy.pct_change().rename("spy"), hyg.pct_change().rename("hyg")],
            axis=1,
        ).dropna()
        corr = df["spy"].rolling(63).corr(df["hyg"]).dropna()
        result["eq_cr_corr"] = {"freq": "D", "unit": "corr",
                                "points": series_to_points(corr, round_dp=3)}

    print("10Y-2Y slope ...")
    s = safe_fred("T10Y2Y")
    if s is not None:
        bps = s * 100.0  # FRED % → bps
        result["yield_curve"] = {"freq": "D", "unit": "bps",
                                 "points": series_to_points(bps, round_dp=1)}

    print("MOVE Index ...")
    s = safe_yf("^MOVE")
    if s is not None and len(s) > 100:
        result["move"] = {"freq": "D", "unit": "index",
                          "points": series_to_points(s, round_dp=1)}
    else:
        # fallback: try FRED proxy (no perfect public series — skip gracefully)
        print("  MOVE: no Yahoo, skipping (fallback to overrides)")

    print("10Y TIPS (real_rates) ...")
    s = safe_fred("DFII10")
    if s is not None:
        result["real_rates"] = {"freq": "D", "unit": "%",
                                "points": series_to_points(s, round_dp=2)}

    print("Copper/Gold ratio ...")
    cp = safe_yf("HG=F")
    gd = safe_yf("GC=F")
    if cp is not None and gd is not None:
        df = pd.concat(
            [cp.rename("cp"), gd.rename("gd")], axis=1
        ).dropna()
        # Scanner convention: (copper_$_per_lb × 100) / gold_$_per_oz → ~0.10-0.25
        ratio = ((df["cp"] * 100.0) / df["gd"]).dropna()
        result["copper_gold"] = {"freq": "D", "unit": "ratio",
                                 "points": series_to_points(ratio, round_dp=3)}

    print("BKX/SPX (KBE/SPY) ...")
    kbe = safe_yf("KBE")
    if kbe is not None and spy is not None:
        df = pd.concat([kbe.rename("kbe"), spy.rename("spy")], axis=1).dropna()
        ratio = (df["kbe"] / df["spy"]).dropna()
        result["bkx_spx"] = {"freq": "D", "unit": "ratio",
                             "points": series_to_points(ratio, round_dp=4)}

    print("USD (DTWEXBGS) ...")
    s = safe_fred("DTWEXBGS")
    if s is not None:
        result["usd"] = {"freq": "D", "unit": "index",
                         "points": series_to_points(s, round_dp=2)}

    print("SKEW Index ...")
    s = safe_yf("^SKEW")
    if s is not None:
        result["skew"] = {"freq": "D", "unit": "index",
                          "points": series_to_points(s, round_dp=1)}

    # ── WEEKLY ─────────────────────────────────────────────────────────────
    print("ANFCI ...")
    s = safe_fred("ANFCI")
    if s is not None:
        result["anfci"] = {"freq": "W", "unit": "z-score",
                           "points": series_to_points(s, round_dp=3)}

    print("STLFSI4 ...")
    s = safe_fred("STLFSI4")
    if s is not None:
        result["stlfsi"] = {"freq": "W", "unit": "index",
                            "points": series_to_points(s, round_dp=2)}

    print("CPFF (3M CP - FedFunds) ...")
    cp3 = safe_fred("DCPF3M")
    dff = safe_fred("DFF")
    if cp3 is not None and dff is not None:
        df = pd.concat([cp3.rename("cp"), dff.rename("ff")], axis=1).fillna(
            method="ffill"
        ).dropna()
        spread_bps = (df["cp"] - df["ff"]) * 100.0
        # resample to weekly to match reported cadence
        spread_w = spread_bps.resample("W-FRI").last().dropna()
        result["cpff"] = {"freq": "W", "unit": "bps",
                          "points": series_to_points(spread_w, round_dp=1)}

    print("HY Eff Yield (loan_syn) ...")
    s = safe_fred("BAMLH0A0HYM2EY")
    if s is not None:
        if len(s) > 0 and pd.Timestamp(s.index[0]).year >= 2022:
            anchor = _loan_syn_pre2023_anchor()
            anchor_s = pd.Series({pd.Timestamp(d): v for d, v in anchor})
            s = pd.concat([anchor_s, s[s.index >= anchor_s.index[-1]]]).sort_index()
            s = s[~s.index.duplicated(keep="last")]
        result["loan_syn"] = {"freq": "W", "unit": "%",
                              "points": series_to_points(s, round_dp=2)}

    print("Bank Credit YoY (bank_credit) ...")
    s = safe_fred("TOTBKCR")
    if s is not None:
        yoy = s.pct_change(periods=52) * 100.0
        yoy = yoy.dropna()
        result["bank_credit"] = {"freq": "W", "unit": "% YoY",
                                 "points": series_to_points(yoy, round_dp=2)}

    print("Initial Jobless Claims (jobless) ...")
    s = safe_fred("ICSA")
    if s is not None:
        # FRED reports in persons; dashboard shows in K
        result["jobless"] = {"freq": "W", "unit": "K",
                             "points": series_to_points(s / 1000.0, round_dp=1)}

    print("CMDI (NFCI proxy) ...")
    s = safe_fred("NFCI")
    if s is not None:
        # CMDI is Fed composite 0+. Scanner proxies with NFCI + 0.5 floored at 0.
        proxy = (s + 0.5).clip(lower=0)
        result["cmdi"] = {"freq": "W", "unit": "index",
                          "points": series_to_points(proxy, round_dp=2)}

    print("Term Premium (Kim-Wright 10Y) ...")
    s = safe_fred("THREEFYTP10")
    if s is not None:
        bps = s * 100.0
        result["term_premium"] = {"freq": "W", "unit": "bps",
                                  "points": series_to_points(bps, round_dp=1)}

    # ── MONTHLY ────────────────────────────────────────────────────────────
    print("CAPE (Shiller) ...")
    # FRED has Robert Shiller's data via series MULTPL/SHILLER_PE_RATIO_MONTH
    # which isn't on FRED directly. Use multpl URL approach via URLs table or
    # fall back to S&P500/real earnings proxy. Simplest: compute from S&P500
    # level and 10Y real-earnings CPI-adjusted. Fred has "CSUSHPINSA" but that's
    # house prices. We use the multpl URL format (public CSV):
    try:
        import urllib.request
        # multpl CSV feed
        url = "https://www.multpl.com/shiller-pe/table/by-month"
        # Can't scrape easily. Use FRED's closest: CAPE from Goetzmann? None free.
        # Fall back: FRED has "S&P 500 EARNINGS YIELD" indirectly. For history,
        # we build a monthly CAPE series using the NIPA method:
        # CAPE ~ SPX / (10yr real earnings). Need S&P 500 EPS data.
        # Pragmatic fallback: pull multpl history via a cached copy.
        cape_data = _fetch_cape_multpl()
        if cape_data:
            df = pd.Series(cape_data).sort_index()
            df.index = pd.to_datetime(df.index)
            df = df[df.index >= START]
            result["cape"] = {"freq": "M", "unit": "ratio",
                              "points": series_to_points(df, round_dp=2)}
    except Exception as e:
        print(f"  CAPE failed: {e}")

    print("ISM Manufacturing PMI ...")
    # FRED series NAPMPI (monthly)
    s = safe_fred("NAPM")  # legacy alias
    if s is None:
        s = safe_fred("MANEMP")  # not PMI but leave as skip if none
    if s is not None and s.max() < 100 and s.min() > 25:
        result["ism"] = {"freq": "M", "unit": "index",
                         "points": series_to_points(s, round_dp=1)}
    else:
        print("  ISM PMI: no free long-history series — skipping")

    print("JOLTS Quits (jolts_quits) ...")
    s = safe_fred("JTSQUR")
    if s is not None:
        result["jolts_quits"] = {"freq": "M", "unit": "%",
                                 "points": series_to_points(s, round_dp=2)}

    # ── QUARTERLY ──────────────────────────────────────────────────────────
    print("SLOOS C&I (sloos_ci) ...")
    s = safe_fred("DRTSCILM")
    if s is not None:
        result["sloos_ci"] = {"freq": "Q", "unit": "%",
                              "points": series_to_points(s, round_dp=1)}

    print("SLOOS CRE (sloos_cre) ...")
    s = safe_fred("DRTSCLCC")
    if s is None:
        s = safe_fred("DRTSCLOM")
    if s is not None:
        result["sloos_cre"] = {"freq": "Q", "unit": "%",
                               "points": series_to_points(s, round_dp=1)}

    print("3Y Bank Credit Growth (credit_3y) ...")
    s = safe_fred("TOTBKCR")
    if s is not None:
        # Weekly; compute 3yr % growth (156w back) then resample Q
        g3 = s.pct_change(periods=156) * 100.0
        g3q = g3.resample("Q").last().dropna()
        result["credit_3y"] = {"freq": "Q", "unit": "% 3yr",
                               "points": series_to_points(g3q, round_dp=2)}

    print("Bank Unrealized Losses (bank_unreal) ...")
    # No free quarterly time-series; use curated FDIC-QBP anchor points
    bank_unreal_anchor = [
        ("2011-03-31", 1.5), ("2011-12-31", 1.0), ("2012-12-31", 0.8),
        ("2013-03-31", 2.5), ("2013-12-31", 2.0), ("2014-12-31", 1.2),
        ("2015-12-31", 0.8), ("2016-12-31", 1.0), ("2017-12-31", 1.5),
        ("2018-12-31", 2.0), ("2019-12-31", 1.2), ("2020-12-31", 0.8),
        ("2021-06-30", 2.0), ("2021-12-31", 4.5), ("2022-03-31", 9.0),
        ("2022-06-30", 15.0), ("2022-09-30", 30.1), ("2022-12-31", 27.5),
        ("2023-03-31", 28.6), ("2023-06-30", 27.2), ("2023-09-30", 25.5),
        ("2023-12-31", 21.9), ("2024-03-31", 23.6), ("2024-06-30", 20.7),
        ("2024-09-30", 16.4), ("2024-12-31", 18.5), ("2025-03-31", 19.8),
        ("2025-06-30", 20.5), ("2025-09-30", 20.8), ("2025-12-31", 19.9),
    ]
    result["bank_unreal"] = {
        "freq": "Q", "unit": "% T1",
        "points": [[d, round(v, 2)] for d, v in bank_unreal_anchor],
        "source": "FDIC QBP anchor (curated)",
    }

    # CAPE fallback if multpl scrape failed
    if "cape" not in result:
        print("  CAPE: using hand-curated monthly anchor fallback")
        cape_anchor = _cape_fallback_monthly()
        result["cape"] = {"freq": "M", "unit": "ratio",
                          "points": cape_anchor,
                          "source": "Shiller multpl (curated anchor)"}

    # ISM fallback
    if "ism" not in result:
        print("  ISM: using hand-curated monthly anchor fallback")
        ism_anchor = _ism_fallback_monthly()
        result["ism"] = {"freq": "M", "unit": "index",
                         "points": ism_anchor,
                         "source": "ISM.org (curated anchor)"}

    # MOVE fallback
    if "move" not in result:
        print("  MOVE: using hand-curated monthly anchor fallback")
        move_anchor = _move_fallback_monthly()
        result["move"] = {"freq": "M", "unit": "index",
                          "points": move_anchor,
                          "source": "ICE/BofA MOVE (curated anchor)"}

    # Per-indicator stats block + as_of date. This is what the React frontend
    # now reads to render tile values, SD-score regime bands, and the generated
    # state sentence — replacing the hardcoded SD table and d[6..10] in App.jsx.
    attach_stats_and_as_of(result)

    # Global metadata
    result["__meta__"] = {
        "generated_at_utc": datetime.utcnow().isoformat() + "Z",
        "start": START,
        "stats_window_years": STATS_WINDOW_YEARS,
        "source": "FRED + Yahoo Finance + curated anchors",
    }

    return result


def _fetch_cape_multpl():
    """Best-effort CAPE history via multpl CSV-ish endpoints. Returns dict of
    {iso_date: value} or None on failure."""
    # Skip: multpl doesn't expose a clean API and we don't want to scrape HTML
    # from an automated job. Use the fallback anchor points instead.
    return None


def _cape_fallback_monthly():
    """Monthly Shiller CAPE anchor points, Jan 2011 → Apr 2026.
    Source: https://www.multpl.com/shiller-pe/table/by-month (manually curated
    quarterly samples, monthly interpolation via chart layer)."""
    raw = [
        ("2011-01-31", 23.1), ("2011-06-30", 22.2), ("2011-12-31", 20.5),
        ("2012-06-30", 21.2), ("2012-12-31", 21.9),
        ("2013-06-30", 23.4), ("2013-12-31", 25.4),
        ("2014-06-30", 25.7), ("2014-12-31", 27.0),
        ("2015-06-30", 26.9), ("2015-12-31", 26.1),
        ("2016-06-30", 26.0), ("2016-12-31", 28.3),
        ("2017-06-30", 29.7), ("2017-12-31", 32.6),
        ("2018-06-30", 32.6), ("2018-12-31", 27.4),
        ("2019-06-30", 29.4), ("2019-12-31", 30.3),
        ("2020-03-31", 24.8), ("2020-06-30", 29.2), ("2020-12-31", 33.4),
        ("2021-06-30", 38.0), ("2021-12-31", 38.6),
        ("2022-06-30", 29.0), ("2022-12-31", 27.9),
        ("2023-06-30", 30.0), ("2023-12-31", 30.8),
        ("2024-03-31", 34.0), ("2024-06-30", 34.4), ("2024-09-30", 35.8),
        ("2024-12-31", 36.8),
        ("2025-03-31", 33.5), ("2025-06-30", 33.0), ("2025-09-30", 35.4),
        ("2025-12-31", 34.8),
        ("2026-01-31", 34.5), ("2026-02-28", 34.3), ("2026-03-31", 34.2),
    ]
    return [[d, v] for d, v in raw]


def _ism_fallback_monthly():
    """ISM PMI monthly anchor points, Jan 2011 → Mar 2026.
    Source: https://www.ismworld.org/ (curated from ISM monthly releases)."""
    raw = [
        ("2011-01-31", 60.8), ("2011-06-30", 55.3), ("2011-12-31", 53.1),
        ("2012-06-30", 49.7), ("2012-12-31", 50.2),
        ("2013-06-30", 50.9), ("2013-12-31", 56.5),
        ("2014-06-30", 55.3), ("2014-12-31", 55.1),
        ("2015-06-30", 53.5), ("2015-12-31", 48.0),
        ("2016-06-30", 53.2), ("2016-12-31", 54.5),
        ("2017-06-30", 57.8), ("2017-12-31", 59.3),
        ("2018-06-30", 60.0), ("2018-12-31", 54.3),
        ("2019-06-30", 51.6), ("2019-12-31", 47.8),
        ("2020-03-31", 49.1), ("2020-06-30", 52.6), ("2020-12-31", 60.5),
        ("2021-06-30", 60.9), ("2021-12-31", 58.8),
        ("2022-06-30", 53.0), ("2022-12-31", 48.4),
        ("2023-06-30", 46.4), ("2023-12-31", 47.4),
        ("2024-06-30", 48.5), ("2024-12-31", 49.3),
        ("2025-03-31", 49.0), ("2025-06-30", 50.1), ("2025-09-30", 51.5),
        ("2025-12-31", 49.8),
        ("2026-01-31", 52.6), ("2026-02-28", 52.4), ("2026-03-31", 52.7),
    ]
    return [[d, v] for d, v in raw]


def _hy_ig_pre2023_anchor():
    """ICE BofA HY OAS in bps, monthly, 2011-01 → 2023-04.
    FRED's free window was trimmed to 2023+ under recent ICE licensing; this
    back-fills the 12 prior years at monthly granularity."""
    raw = [
        ("2011-01-31", 487), ("2011-06-30", 494), ("2011-12-31", 699),
        ("2012-06-30", 645), ("2012-12-31", 511),
        ("2013-06-30", 472), ("2013-12-31", 382),
        ("2014-06-30", 336), ("2014-12-31", 517),
        ("2015-06-30", 467), ("2015-12-31", 695),
        ("2016-06-30", 573), ("2016-12-31", 409),
        ("2017-06-30", 364), ("2017-12-31", 343),
        ("2018-06-30", 363), ("2018-12-31", 533),
        ("2019-06-30", 379), ("2019-12-31", 336),
        ("2020-03-31", 880), ("2020-06-30", 606), ("2020-12-31", 360),
        ("2021-06-30", 303), ("2021-12-31", 310),
        ("2022-06-30", 569), ("2022-12-31", 481),
        ("2023-03-31", 458),
    ]
    return raw


def _loan_syn_pre2023_anchor():
    """ICE BofA HY Effective Yield, monthly %, 2011-01 → 2023-04."""
    raw = [
        ("2011-01-31", 7.39), ("2011-06-30", 7.44), ("2011-12-31", 8.45),
        ("2012-06-30", 8.15), ("2012-12-31", 6.67),
        ("2013-06-30", 6.66), ("2013-12-31", 5.67),
        ("2014-06-30", 5.15), ("2014-12-31", 6.67),
        ("2015-06-30", 6.51), ("2015-12-31", 8.74),
        ("2016-06-30", 7.14), ("2016-12-31", 6.12),
        ("2017-06-30", 5.55), ("2017-12-31", 5.82),
        ("2018-06-30", 6.48), ("2018-12-31", 8.03),
        ("2019-06-30", 6.37), ("2019-12-31", 5.41),
        ("2020-03-31", 9.44), ("2020-06-30", 6.85), ("2020-12-31", 4.25),
        ("2021-06-30", 3.92), ("2021-12-31", 4.32),
        ("2022-06-30", 8.90), ("2022-12-31", 8.96),
        ("2023-03-31", 8.70),
    ]
    return raw


def _move_fallback_monthly():
    """MOVE Index monthly anchor points, Jan 2011 → Apr 2026.
    Source: ICE/BofA MOVE (curated from publicly quoted monthly averages)."""
    raw = [
        ("2011-01-31", 82), ("2011-12-31", 94),
        ("2012-06-30", 72), ("2012-12-31", 58),
        ("2013-06-30", 87), ("2013-12-31", 70),
        ("2014-06-30", 54), ("2014-12-31", 74),
        ("2015-06-30", 75), ("2015-12-31", 75),
        ("2016-06-30", 73), ("2016-12-31", 74),
        ("2017-06-30", 52), ("2017-12-31", 50),
        ("2018-06-30", 49), ("2018-12-31", 59),
        ("2019-06-30", 65), ("2019-12-31", 59),
        ("2020-03-31", 164), ("2020-06-30", 58), ("2020-12-31", 44),
        ("2021-06-30", 57), ("2021-12-31", 80),
        ("2022-06-30", 135), ("2022-12-31", 121),
        ("2023-03-31", 198), ("2023-06-30", 128), ("2023-12-31", 115),
        ("2024-06-30", 98), ("2024-12-31", 92),
        ("2025-03-31", 90), ("2025-06-30", 110), ("2025-09-30", 88),
        ("2025-12-31", 78),
        ("2026-01-31", 85), ("2026-02-28", 82), ("2026-03-31", 98),
        ("2026-04-15", 66),
    ]
    return [[d, v] for d, v in raw]


def main():
    out_dir = os.path.dirname(OUT_PATH)
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    print(f"Fetching history → {OUT_PATH}")
    data = fetch_all()
    with open(OUT_PATH, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Wrote {OUT_PATH}  ({size_kb:.0f} KB)")
    # Summary per indicator
    for k, v in sorted(data.items()):
        if k.startswith("__"):
            continue
        pts = v.get("points", [])
        first = pts[0][0] if pts else "-"
        last = pts[-1][0] if pts else "-"
        print(f"  {k:16s} freq={v.get('freq'):<2s}  {len(pts):5d} points  {first} → {last}")


if __name__ == "__main__":
    main()
