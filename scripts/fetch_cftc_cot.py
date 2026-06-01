#!/usr/bin/env python3
"""
fetch_cftc_cot.py — MacroTilt weekly COT "Market Crowding" producer
===================================================================

WHAT THIS DOES (plain English)
------------------------------
Every Friday the CFTC publishes who is holding futures positions, as of the
prior Tuesday. Reading the raw long/short SIGN is misleading because several
groups sit in permanent structural positions (hedge funds are almost always
net-short the S&P / yen / VIX; asset managers net-long; both sides of
Treasuries are just the cash-vs-futures basis trade). So this engine throws
the sign away and asks ONE question per market: where does the watch-group's
net position (as a share of open interest) sit inside its OWN trailing
3-year range? 0th percentile = most bearish in 3 years, 100th = most bullish.

That percentile (plus a z-score) is the only signal. Nothing here feeds a
score — observation mode only, until a forward-return backtest passes.

INTEGRATION
-----------
Read-modify-write MERGE of 7 keys into public/indicator_history.json (never
overwrite the file — every other indicator's data must survive). Each key
carries a weekly `points` series ([date, net %OI]) so the existing sparkline
and 3M/6M/1Y columns work, plus a `stats` block with the trailing-3yr
percentile / z that the page displays verbatim. Also stamps the served
data_manifest.json freshness fields for the single registered feed element.

USAGE
-----
  python3 scripts/fetch_cftc_cot.py            # live pull + merge + stamp
  python3 scripts/fetch_cftc_cot.py --selftest # offline math check, no network
"""

from __future__ import annotations
import sys, os, json, datetime as dt
import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# CONFIG
# --------------------------------------------------------------------------
API = "https://publicreporting.cftc.gov/resource"

# Repo-root-relative outputs (workflow checks out the repo root and runs us).
HISTORY_PATH  = os.environ.get("COT_HISTORY_PATH",  "public/indicator_history.json")
MANIFEST_PATH = os.environ.get("COT_MANIFEST_PATH", "public/data_manifest.json")
MANIFEST_ELEMENT_ID = "indicator-cftc-cot-weekly"

DATASETS = {
    "TFF":    "gpe5-46if",   # Traders in Financial Futures (futures only)
    "DISAGG": "72hh-3qpy",   # Disaggregated (commodities, futures only)
    "LEGACY": "6dca-aqww",   # Legacy (only for the US Dollar Index)
}

# (long column, short column) for each trader group inside each report.
GROUPS = {
    "TFF": {
        "lev": ("lev_money_positions_long", "lev_money_positions_short"),
        "am":  ("asset_mgr_positions_long", "asset_mgr_positions_short"),
    },
    "DISAGG": {
        "mm": ("m_money_positions_long_all", "m_money_positions_short_all"),
    },
    "LEGACY": {
        "noncomm": ("noncomm_positions_long_all", "noncomm_positions_short_all"),
    },
}

# The 7 published rows. history_key MUST match the indicator-registry id so the
# page can find both the registry meta and the history series.
#   (history_key, label, report, name_pattern, group, contract_code)
TARGETS = [
    ("cot_spx_lev",     "S&P 500 · Hedge Funds",   "TFF",    "E-MINI S&P 500",                    "lev",     "13874A"),
    ("cot_spx_am",      "S&P 500 · Asset Mgrs",    "TFF",    "E-MINI S&P 500",                    "am",      "13874A"),
    ("cot_jpy_lev",     "Japanese Yen · Hedge Funds","TFF",  "JAPANESE YEN",                      "lev",     "097741"),
    ("cot_vix_lev",     "VIX · Hedge Funds",       "TFF",    "VIX FUTURES",                       "lev",     "1170E1"),
    ("cot_gold_mm",     "Gold · Managed Money",    "DISAGG", "GOLD",                              "mm",      "088691"),
    ("cot_wti_mm",      "WTI Crude · Managed Money","DISAGG","CRUDE OIL, LIGHT SWEET - NEW YORK",  "mm",      "067651"),
    ("cot_dxy_noncomm", "US Dollar · Speculators", "LEGACY", "U.S. DOLLAR INDEX",                 "noncomm", "098662"),
]

WINDOW = 156          # 3 years of weekly reports
HISTORY_YEARS = 5     # pull extra so the 3-year window is always full
TAIL_LOW, TAIL_HIGH = 10.0, 90.0   # crowding tail thresholds (percentile)


# --------------------------------------------------------------------------
# MATH (pure — verified by --selftest)
# --------------------------------------------------------------------------
def net_pct_series(df: pd.DataFrame, long_col: str, short_col: str) -> pd.Series:
    oi    = pd.to_numeric(df["open_interest_all"], errors="coerce")
    long  = pd.to_numeric(df[long_col],  errors="coerce")
    short = pd.to_numeric(df[short_col], errors="coerce")
    return (long - short) / oi


def pctrank_latest(s: pd.Series, window: int) -> float:
    s = s.dropna()
    w = s.iloc[-window:] if len(s) >= window else s
    cur = w.iloc[-1]
    return float((w <= cur).mean() * 100.0)


def zscore_latest(s: pd.Series, window: int) -> float:
    s = s.dropna()
    w = s.iloc[-window:] if len(s) >= window else s
    cur = w.iloc[-1]
    mu, sd = w.mean(), w.std(ddof=0)
    return float((cur - mu) / sd) if sd and not np.isnan(sd) else float("nan")


def read_for(pct: float) -> str:
    """One-sentence 'so what' from the percentile alone.

    Sign-neutral on purpose: a low percentile means 'near the most bearish this
    group has been in 3 years' relative to its OWN history, NOT that the book is
    net-short in absolute terms (some watch groups are structurally net-long).
    So the copy talks about position-in-range and fragility, never long/short.
    """
    if pct <= TAIL_LOW:
        return "Near the bottom of its 3-year range — positioning stretched; fragile to a reversal."
    if pct >= TAIL_HIGH:
        return "Near the top of its 3-year range — positioning stretched; fragile to a reversal."
    if pct <= 25:
        return "Toward the low end of its 3-year range."
    if pct >= 75:
        return "Toward the high end of its 3-year range; not yet extreme."
    return "Mid-range within its 3-year history."


# --------------------------------------------------------------------------
# DATA (network — lazy-imports requests)
# --------------------------------------------------------------------------
def socrata(dataset: str, where: str, select: str | None = None,
            order: str = "report_date_as_yyyy_mm_dd", page: int = 1000) -> pd.DataFrame:
    import requests
    base, out, offset = f"{API}/{dataset}.json", [], 0
    while True:
        params = {"$where": where, "$order": order, "$limit": page, "$offset": offset}
        if select:
            params["$select"] = select
        r = requests.get(base, params=params, timeout=60)
        r.raise_for_status()
        chunk = r.json()
        out.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return pd.DataFrame(out)


def build_row(history_key, label, report, pattern, group, code, start):
    ds = DATASETS[report]
    where = (f"cftc_contract_market_code='{code}' "
             f"and report_date_as_yyyy_mm_dd >= '{start}'")
    df = socrata(ds, where)
    if df.empty:
        raise RuntimeError(f"no history for {label} ({code})")
    df = df.sort_values("report_date_as_yyyy_mm_dd").reset_index(drop=True)
    lc, sc = GROUPS[report][group]
    if lc not in df.columns:
        raise RuntimeError(f"column {lc} missing for {label}")
    s = net_pct_series(df, lc, sc)
    dates = pd.to_datetime(df["report_date_as_yyyy_mm_dd"]).dt.strftime("%Y-%m-%d")
    points = [[d, round(float(v) * 100, 2)]
              for d, v in zip(dates, s) if pd.notna(v)]
    pct = round(pctrank_latest(s, WINDOW), 1)
    z   = round(zscore_latest(s, WINDOW), 2)
    net = round(float(s.dropna().iloc[-1]) * 100, 2)
    as_of = points[-1][0]
    return history_key, {
        "freq":  "W",
        "unit":  "% OI",
        "as_of": as_of,
        "points": points,
        "stats": {
            "direction":  "bw",        # both tails matter for crowding
            "pctile_3yr": pct,
            "z_3yr":      z,
            "net_pct_oi": net,
            "weeks_in_window": int(min(WINDOW, len(points))),
            "is_extreme": bool(pct <= TAIL_LOW or pct >= TAIL_HIGH),
            "read": read_for(pct),
            "label": label,
        },
    }


def merge_history(updates: dict) -> int:
    """Read-modify-write: merge COT keys into the existing history file."""
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            hist = json.load(f)
    else:
        hist = {}
    before = set(hist.keys())
    hist.update(updates)
    # Guard: we must never lose a pre-existing key.
    lost = before - set(hist.keys())
    if lost:
        raise RuntimeError(f"REFUSING to write — would drop keys: {sorted(lost)}")
    with open(HISTORY_PATH, "w") as f:
        json.dump(hist, f, separators=(",", ":"))
    return len(hist)


def stamp_manifest(as_of: str) -> None:
    """Stamp the single registered feed element's freshness fields."""
    if not os.path.exists(MANIFEST_PATH):
        print(f"  note: {MANIFEST_PATH} not found; skipping stamp")
        return
    with open(MANIFEST_PATH) as f:
        man = json.load(f)
    els = man.get("elements") if isinstance(man, dict) else man
    if not isinstance(els, list):
        print("  note: manifest has no elements array; skipping stamp")
        return
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    # Next CFTC release is the coming Friday 3:30pm ET; our catch runs Saturday.
    nxt = next_saturday_utc()
    hit = False
    for e in els:
        if e.get("id") == MANIFEST_ELEMENT_ID:
            e["last_success_utc"] = now
            e["data_as_of"] = as_of
            e["next_expected_utc"] = nxt
            e["current_status"] = "live"
            hit = True
            break
    if hit:
        with open(MANIFEST_PATH, "w") as f:
            json.dump(man, f, indent=2)
        print(f"  stamped {MANIFEST_ELEMENT_ID}: as_of={as_of}")
    else:
        print(f"  note: {MANIFEST_ELEMENT_ID} not in manifest yet; skipping stamp")


def next_saturday_utc() -> str:
    today = dt.datetime.now(dt.timezone.utc)
    days = (5 - today.weekday()) % 7 or 7   # weekday(): Mon=0 .. Sat=5
    target = (today + dt.timedelta(days=days)).replace(
        hour=9, minute=0, second=0, microsecond=0)
    return target.isoformat()


# --------------------------------------------------------------------------
# RUN
# --------------------------------------------------------------------------
def run() -> None:
    start = (dt.date.today() - dt.timedelta(days=365 * HISTORY_YEARS)).isoformat()
    updates, latest_as_of = {}, None
    for history_key, label, report, pattern, group, code in TARGETS:
        try:
            k, payload = build_row(history_key, label, report, pattern, group, code, start)
            updates[k] = payload
            latest_as_of = payload["as_of"]
            st = payload["stats"]
            flag = "  <-- TAIL" if st["is_extreme"] else ""
            print(f"  {label:28s} net {st['net_pct_oi']:+6.1f}%OI  "
                  f"{st['pctile_3yr']:5.1f}%ile  z={st['z_3yr']:+.2f}{flag}")
        except Exception as e:
            print(f"  WARNING {label}: {e}")
    if not updates:
        print("No COT rows produced; leaving files untouched.")
        sys.exit(1)
    total = merge_history(updates)
    print(f"\nMerged {len(updates)} COT keys into history ({total} keys total).")
    if latest_as_of:
        stamp_manifest(latest_as_of)


# --------------------------------------------------------------------------
# SELFTEST (offline)
# --------------------------------------------------------------------------
def selftest() -> bool:
    ok = True
    fixtures = [
        ("S&P lev",  2093621, 149287,  607067, -21.87),
        ("S&P am",   2093621, 1204894, 201287,  47.94),
        ("Yen lev",  427294,  87395,   157903, -16.50),
        ("VIX lev",  384562,  65926,   115262, -12.83),
        ("Gold mm",  353489,  124277,  26831,   27.57),
    ]
    for name, oi, lo, sh, exp in fixtures:
        df = pd.DataFrame({"open_interest_all": [oi], "L": [lo], "S": [sh]})
        got = round(float(net_pct_series(df, "L", "S").iloc[0]) * 100, 2)
        flag = "OK  " if abs(got - exp) < 0.05 else "FAIL"
        ok &= flag.strip() == "OK"
        print(f"  {flag} {name}: net%OI = {got:+.2f}  (expected {exp:+.2f})")

    s = pd.Series(np.arange(1, 201, dtype=float))
    p = pctrank_latest(s, WINDOW)
    flag = "OK  " if abs(p - 100.0) < 1e-9 else "FAIL"
    ok &= flag.strip() == "OK"
    print(f"  {flag} pctrank(latest of 1..200) = {p:.1f}  (expected 100.0)")

    z = zscore_latest(s, WINDOW)
    flag = "OK  " if z > 1.5 else "FAIL"
    ok &= flag.strip() == "OK"
    print(f"  {flag} zscore(latest of 1..200) = {z:+.2f}  (expected > +1.5)")

    # merge guard: a merge must never drop a pre-existing key
    import tempfile
    global HISTORY_PATH
    with tempfile.TemporaryDirectory() as d:
        HISTORY_PATH = os.path.join(d, "h.json")
        json.dump({"vix": {"keep": 1}}, open(HISTORY_PATH, "w"))
        merge_history({"cot_spx_lev": {"new": 2}})
        back = json.load(open(HISTORY_PATH))
        merge_ok = "vix" in back and "cot_spx_lev" in back
        ok &= merge_ok
        print(f"  {'OK  ' if merge_ok else 'FAIL'} merge preserves existing keys")

    print("\nSELFTEST", "PASSED" if ok else "FAILED")
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    run()
