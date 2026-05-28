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
    # New series added 2026-04-24 (PR feat/all-indicators-redesign-plus-new-data):
    "m2_yoy":"hw","fed_bs":"lw","rrp":"hw","bank_reserves":"lw","tga":"hw",
    "breakeven_10y":"hw","cfnai":"lw","cfnai_3ma":"lw","hy_ig_etf":"hw",
}

fred = Fred(api_key=FRED_API_KEY)


# ── Fail-loud staleness gate (Joe directive 2026-05-27) ──────────────────────
# These are the daily indicators the All Indicators page shows as "Daily" in
# the FREQ column. If any of them is more than its SLA worth of trading days
# behind today, the workflow fails loudly instead of writing a stale file.
# SLA = max trading days behind we tolerate before raising.
#   FRED daily series legitimately publish T+1 (BAMLH0A0HYM2, BAMLC0A0CM,
#   THREEFYTP10), so they get SLA=2.
#   Treasury.gov + Yahoo are same-day, so SLA=1.
DAILY_FRESHNESS_SLA = {
    "vix":           1,  # Yahoo ^VIX
    "move":          1,  # Yahoo ^MOVE
    "skew":          1,  # Yahoo ^SKEW
    "usd":           1,  # Yahoo DX-Y.NYB
    "copper_gold":   1,  # Yahoo HG=F / GC=F
    "bkx_spx":       1,  # Yahoo KBE / SPY
    "eq_cr_corr":    1,  # Yahoo SPY / HYG
    "hy_ig_etf":     1,  # Yahoo LQD / HYG
    "yield_curve":   1,  # Treasury.gov (was FRED T10Y2Y)
    "real_rates":    1,  # Treasury.gov (was FRED DFII10)
    "breakeven_10y": 1,  # Treasury.gov computed (was FRED T10YIE)
    "hy_ig":         2,  # FRED BAMLH0A0HYM2 (T+1 publication)
    "ig_oas":        2,  # FRED BAMLC0A0CM   (T+1 publication)
    # FRED Kim-Wright THREEFYTP10 frequently lags 3-5 days in practice
    # (Federal Reserve research series, not a market series). Lag-bucket
    # indicator, so 5 trading days is acceptable. Bumped from 2 → 5 on
    # 2026-05-27 after observing the actual publication cadence.
    "term_premium":  5,
    "rrp":           2,  # FRED RRPONTSYD    (T+1 publication)
}


class StalenessError(RuntimeError):
    """Raised when a daily indicator is older than its SLA. Fails the workflow."""


# Standard NYSE holidays for 2026 — used to compute trading-day gap.
NYSE_HOLIDAYS_2026 = {
    "2026-01-01",  # New Year's Day
    "2026-01-19",  # MLK Day
    "2026-02-16",  # Presidents Day
    "2026-04-03",  # Good Friday
    "2026-05-25",  # Memorial Day
    "2026-06-19",  # Juneteenth
    "2026-07-03",  # July 4 observed (Sat 4th)
    "2026-09-07",  # Labor Day
    "2026-11-26",  # Thanksgiving
    "2026-12-25",  # Christmas
}


def _trading_days_behind(last_date_iso, today=None):
    """Count weekday-and-non-holiday days between last_date and today.
    Returns 0 if last_date is today or later, 1 if today is the next trading
    day, etc."""
    from datetime import date, timedelta
    if today is None:
        today = date.today()
    last = date.fromisoformat(last_date_iso)
    if last >= today:
        return 0
    n = 0
    d = last + timedelta(days=1)
    while d <= today:
        if d.weekday() < 5 and d.isoformat() not in NYSE_HOLIDAYS_2026:
            n += 1
        d += timedelta(days=1)
    return n


def _check_daily_freshness_or_raise(data):
    """Audit every daily indicator against its SLA. Raise StalenessError listing
    every violation in one message — easier to fix five at once than to chase
    one error per workflow run."""
    violations = []
    for ind_id, sla in DAILY_FRESHNESS_SLA.items():
        entry = data.get(ind_id)
        if not entry:
            violations.append(f"  {ind_id}: missing entirely from fetch result")
            continue
        pts = entry.get("points") or []
        if not pts:
            violations.append(f"  {ind_id}: zero points")
            continue
        last_iso = pts[-1][0]
        behind = _trading_days_behind(last_iso)
        if behind > sla:
            src = entry.get("source", "?")
            violations.append(
                f"  {ind_id}: last={last_iso}, {behind} trading days behind "
                f"(SLA {sla}); source: {src}"
            )
    if violations:
        msg = (
            f"{len(violations)} daily indicator(s) exceeded freshness SLA:\n"
            + "\n".join(violations)
        )
        raise StalenessError(msg)


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


def _drop_future_points(result):
    """Drop any point dated after today from every indicator.

    A resample to a period-end label — resample("ME") / ("W-FRI") / ("QE") —
    stamps the current, still-in-progress period with a FUTURE period-end
    date (e.g. an in-progress May labelled 2026-05-31, an in-progress week
    labelled with next Friday). This belt-and-suspenders pass guarantees no
    future-dated observation ever reaches public/indicator_history.json,
    whatever any individual indicator block does upstream.
    """
    from datetime import date as _date
    today = _date.today().isoformat()
    for ind_id, entry in result.items():
        if ind_id.startswith("__") or not isinstance(entry, dict):
            continue
        pts = entry.get("points")
        if not pts:
            continue
        kept = [p for p in pts if p[0] <= today]
        if len(kept) != len(pts):
            print(f"  future-date guard: dropped {len(pts) - len(kept)} "
                  f"future-dated point(s) from {ind_id}")
            entry["points"] = kept
    return result



# ── Bug #1067/#1068 — pipeline_health honesty logger ─────────────────────────
def _log_pipeline_health(series_id, message):
    """Update public.pipeline_health with the latest fetcher result so
    FreshnessDot can show the explanation on hover. No-ops silently if
    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't in the environment.
    Matches rows by `source` ilike `FRED <series_id>` so this works whether
    the row's indicator_id is `real_rates` (DFII10) or `bank_credit` (TOTBKCR).
    """
    try:
        import urllib.request, urllib.parse, json as _json
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return
        # Find the matching row(s) by source
        params = urllib.parse.urlencode({
            "source": f"ilike.FRED {series_id}*",
            "select": "indicator_id",
        })
        req = urllib.request.Request(
            f"{url}/rest/v1/pipeline_health?{params}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            rows = _json.loads(resp.read().decode("utf-8"))
        if not rows:
            return
        for row in rows:
            indicator_id = row.get("indicator_id")
            if not indicator_id:
                continue
            from datetime import datetime, timezone
            now_iso = datetime.now(timezone.utc).isoformat()
            patch = {
                "last_error": message,
                "last_check_at": now_iso,
            }
            params2 = urllib.parse.urlencode({"indicator_id": f"eq.{indicator_id}"})
            req2 = urllib.request.Request(
                f"{url}/rest/v1/pipeline_health?{params2}",
                data=_json.dumps(patch).encode("utf-8"),
                method="PATCH",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
            )
            try:
                urllib.request.urlopen(req2, timeout=10)
            except Exception:
                pass
    except Exception:
        # Honesty logging must never break the pipeline.
        pass


def _supabase_query(query_string: str) -> list:
    """Run a PostgREST query against Supabase. Returns list of rows or [] on
    failure. Used by the v11 Positioning & Breadth derivations that aggregate
    across UW universe_snapshots + Polygon prices_eod tables we already pay for.
    """
    try:
        import urllib.request, urllib.parse, json as _json
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return []
        req = urllib.request.Request(
            f"{url}/rest/v1/{query_string}",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  Supabase query failed ({query_string[:60]}...): {e}")
        return []


def _supabase_rpc(rpc_name: str, params: dict) -> list:
    """Run a Supabase RPC (postgres function) with JSON body."""
    try:
        import urllib.request, urllib.parse, json as _json
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return []
        req = urllib.request.Request(
            f"{url}/rest/v1/rpc/{rpc_name}",
            data=_json.dumps(params).encode("utf-8"),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  Supabase RPC failed ({rpc_name}): {e}")
        return []

def safe_fred(series_id, start=START, transform=None, retries=3):
    """Bug #1067/#1068 — log to pipeline_health when no fresh observation
    lands. Existing 1.5s × N exponential backoff is preserved; we add a final
    5-second backoff before the last attempt to absorb FRED hiccups."""
    import time
    last_err = None
    for attempt in range(retries):
        try:
            s = fred.get_series(series_id, observation_start=start).dropna()
            if transform:
                s = transform(s)
            s = s.dropna()
            if s.empty:
                last_err = "FRED returned no observations"
            else:
                return s
        except Exception as e:
            last_err = e
        # Final attempt gets the 5-second floor
        if attempt < retries - 1:
            time.sleep(max(1.5 * (attempt + 1), 5.0 if attempt == retries - 2 else 1.5 * (attempt + 1)))
    print(f"  FRED {series_id} FAILED after {retries}: {last_err}")
    _log_pipeline_health(series_id, f"no fresh observation from FRED ({last_err})")
    return None


# Per-process cache: maps (kind, year) -> full pandas DataFrame of that year's
# Treasury.gov daily yield curve. Multiple safe_treasury(kind, tenor) calls
# share one fetch — without this, fetch_history pulled the same year-CSV
# three or four times because yield_curve, real_rates, and breakeven_10y all
# read overlapping tenors from the same kind.
_TREASURY_YEAR_CACHE = {}

def _fetch_treasury_year(series_kind, year, retries=3):
    """Pull one (kind, year) Treasury.gov CSV and return it as a DataFrame.
    Cached per-process so multiple tenor reads share one HTTP call."""
    import time, urllib.request, io
    cache_key = (series_kind, year)
    if cache_key in _TREASURY_YEAR_CACHE:
        return _TREASURY_YEAR_CACHE[cache_key]

    KIND_PARAM = {
        "nominal": "daily_treasury_yield_curve",
        "tips":    "daily_treasury_real_yield_curve",
    }
    if series_kind not in KIND_PARAM:
        raise ValueError(f"safe_treasury: unknown kind {series_kind!r}")

    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/"
        f"interest-rates/daily-treasury-rates.csv/{year}/all"
        f"?type={KIND_PARAM[series_kind]}&field_tdr_date_value={year}"
        "&page&_format=csv"
    )
    last_err = None
    body = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "macrotilt-data-steward/1.0 (+https://macrotilt.com)"
            })
            with urllib.request.urlopen(req, timeout=12) as r:
                body = r.read().decode("utf-8", errors="replace")
            if "Date," in body[:200]:
                break
            last_err = f"unexpected body head: {body[:80]!r}"
        except Exception as e:
            last_err = str(e)
        if attempt < retries - 1:
            time.sleep(1.0 * (attempt + 1))
    if body is None or "Date," not in body[:200]:
        print(f"  Treasury.gov {series_kind} {year} FAILED: {last_err}")
        _TREASURY_YEAR_CACHE[cache_key] = None
        return None
    try:
        df = pd.read_csv(io.StringIO(body))
    except Exception as e:
        print(f"  Treasury.gov {series_kind} {year} parse FAILED: {e}")
        _TREASURY_YEAR_CACHE[cache_key] = None
        return None
    df["Date"] = pd.to_datetime(df["Date"], format="%m/%d/%Y", errors="coerce")
    df = df.dropna(subset=["Date"]).sort_values("Date")
    _TREASURY_YEAR_CACHE[cache_key] = df
    return df


def _warm_treasury_cache(series_kind, start_year, end_year, max_workers=8):
    """Pre-fetch every (kind, year) CSV in parallel and populate the cache.
    Without this, fetch_history.py spent ~10 minutes hitting Treasury.gov
    year-by-year (21 years × ~25s worst case = 525s). With 8-way parallelism
    the wall-clock collapses to ~5-15 seconds total."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    pending_years = [
        y for y in range(start_year, end_year + 1)
        if (series_kind, y) not in _TREASURY_YEAR_CACHE
    ]
    if not pending_years:
        return
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_fetch_treasury_year, series_kind, y): y for y in pending_years}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"  Treasury.gov {series_kind} {futures[fut]} parallel fetch error: {e}")


def safe_treasury(series_kind, tenor_label, start=START, retries=3):
    """Pull a daily Treasury yield curve series directly from Treasury.gov.

    Replaces FRED for daily Treasury yields and TIPS yields. Treasury.gov is the
    upstream publisher — same data FRED republishes, but available same-day
    instead of FRED's late-afternoon T+1 cadence.

    Args:
        series_kind: 'nominal' (Treasury par yields) or 'tips' (real yields)
        tenor_label: column header on the Treasury.gov CSV, e.g. '10 Yr', '2 Yr',
                     '10 YR' (TIPS uses 'YR', nominal uses 'Yr' — annoying but
                     that's how the CSV ships).
        start: ISO date string; we paginate across years from this point.

    Returns:
        pandas Series indexed by date, values in % (matches FRED scale).
    """
    start_year = int(start[:4])
    end_year = datetime.utcnow().year
    # Warm the cache for every year in parallel before the sequential pass.
    # First call for each (kind) pays the network cost once; subsequent tenor
    # reads for the same kind read straight from cache.
    _warm_treasury_cache(series_kind, start_year, end_year)
    frames = []
    last_err = None
    for year in range(start_year, end_year + 1):
        df = _fetch_treasury_year(series_kind, year, retries=retries)
        if df is None:
            last_err = f"year {year} failed"
            continue
        if tenor_label not in df.columns:
            print(f"  Treasury.gov {series_kind} {year}: missing column "
                  f"{tenor_label!r} (have: {list(df.columns)})")
            last_err = f"missing column {tenor_label}"
            continue
        col = df[["Date", tenor_label]].rename(columns={tenor_label: "value"}).copy()
        col["value"] = pd.to_numeric(col["value"], errors="coerce")
        col = col.dropna(subset=["value"])
        if not col.empty:
            frames.append(col.set_index("Date")["value"].sort_index())
    if not frames:
        print(f"  Treasury.gov {series_kind}/{tenor_label}: no data fetched")
        _log_pipeline_health(
            f"Treasury.gov {series_kind} {tenor_label}",
            f"no observations from Treasury.gov ({last_err})",
        )
        return None
    s = pd.concat(frames).sort_index()
    s = s[~s.index.duplicated(keep="last")]
    return s


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

    print("10Y-2Y slope (Treasury.gov nominal curve) ...")
    # Source migration 2026-05-27 (Joe directive): dropped FRED T10Y2Y in favor
    # of computing the spread directly from Treasury.gov daily yields. Same
    # underlying data — Treasury.gov is FRED's upstream publisher — but lands
    # same-day instead of FRED's late-afternoon T+1 cadence.
    t10y = safe_treasury("nominal", "10 Yr")
    t2y  = safe_treasury("nominal", "2 Yr")
    if t10y is not None and t2y is not None:
        df = pd.concat([t10y.rename("t10"), t2y.rename("t2")], axis=1).dropna()
        bps = ((df["t10"] - df["t2"]) * 100.0).dropna()  # % → bps
        result["yield_curve"] = {"freq": "D", "unit": "bps",
                                 "points": series_to_points(bps, round_dp=1),
                                 "source": "Treasury.gov daily yield curve (10Y − 2Y)"}
    else:
        print("  yield_curve: Treasury.gov fetch failed — leaving prior value")

    print("MOVE Index ...")
    s = safe_yf("^MOVE", start="2002-11-12")  # spliced pre-2006 window per FINAL_LOCKED_ENGINE_2026-05-13
    if s is not None and len(s) > 100:
        result["move"] = {"freq": "D", "unit": "index",
                          "points": series_to_points(s, round_dp=1)}
    else:
        # fallback: try FRED proxy (no perfect public series — skip gracefully)
        print("  MOVE: no Yahoo, skipping (fallback to overrides)")

    print("10Y TIPS / real_rates (Treasury.gov TIPS curve) ...")
    # Source migration 2026-05-27 (Joe directive): dropped FRED DFII10 in favor
    # of Treasury.gov's daily real yield curve. DFII10 was the indicator that
    # most often shipped stale because FRED publishes it around 20:00 UTC,
    # after our 10:00-UTC morning workflow. Treasury.gov posts it same-day
    # (typically 15:00-16:00 ET), so our 22:00-UTC afternoon run captures it.
    s = safe_treasury("tips", "10 YR")
    if s is not None:
        result["real_rates"] = {"freq": "D", "unit": "%",
                                "points": series_to_points(s, round_dp=2),
                                "source": "Treasury.gov daily TIPS yield curve (10Y)"}
    else:
        print("  real_rates: Treasury.gov fetch failed — leaving prior value")

    print("Copper/Gold ratio ...")
    cp = safe_yf("HG=F")
    gd = safe_yf("GC=F")
    if cp is not None and gd is not None:
        df = pd.concat(
            [cp.rename("cp"), gd.rename("gd")], axis=1
        ).dropna()
        # Conventional copper/gold ratio = (copper $/lb ÷ gold $/oz) × 1000.
        # HG=F is quoted in $/lb (~6.3) and GC=F in $/oz (~4500), so the raw
        # price ratio is ~0.0014; the ×1000 scaling gives the desk-standard
        # reading of ~1.4. The previous ×100 scaling produced ~0.14 — a
        # factor of 10 below the convention every trading desk references.
        ratio = ((df["cp"] / df["gd"]) * 1000.0).dropna()
        result["copper_gold"] = {"freq": "D", "unit": "ratio",
                                 "points": series_to_points(ratio, round_dp=3)}

    print("BKX/SPX (KBE/SPY) ...")
    kbe = safe_yf("KBE")
    if kbe is not None and spy is not None:
        df = pd.concat([kbe.rename("kbe"), spy.rename("spy")], axis=1).dropna()
        ratio = (df["kbe"] / df["spy"]).dropna()
        result["bkx_spx"] = {"freq": "D", "unit": "ratio",
                             "points": series_to_points(ratio, round_dp=4)}

    # Methodology-v11.md specifies the index-based ^BKX/^GSPC for the v11 Growth
    # mechanism (KBW Bank Index vs S&P 500 index, not ETFs). Senior Quant deferral
    # 2026-04-30: pull both, let v11 calibration pick the right one.
    print("BKX/SPX v11 (^BKX / ^GSPC index ratio) ...")
    bkx_idx = safe_yf("^BKX")
    spx_idx = safe_yf("^GSPC")
    if bkx_idx is not None and spx_idx is not None:
        df = pd.concat([bkx_idx.rename("bkx"), spx_idx.rename("spx")], axis=1).dropna()
        ratio = (df["bkx"] / df["spx"]).dropna()
        result["bkx_spx_v11"] = {"freq": "D", "unit": "ratio",
                                  "points": series_to_points(ratio, round_dp=4)}

    # USD: Yahoo DX-Y.NYB (ICE US Dollar Index futures) — was FRED DTWEXBGS,
    # which has a 7-day publication lag and lives on a different scale
    # (broad trade-weighted ~110-130 vs ICE's 6-currency basket ~95-105).
    # PR #1.5 (Joe 2026-04-24): standardize on DXY for three reasons:
    #   1. The daily fetcher (fetch_indicators.py) was already pulling
    #      DX-Y.NYB while history was still on DTWEXBGS — z-scores were
    #      being computed against the wrong scale.
    #   2. SD calibration in App.jsx (mean=99, sd=7) is DXY-scale.
    #   3. DXY is the dollar index every trading desk references intraday.
    print("USD (DX-Y.NYB) ...")
    s = safe_yf("DX-Y.NYB")
    if s is not None:
        result["usd"] = {"freq": "D", "unit": "index",
                         "points": series_to_points(s, round_dp=2),
                         "source": "Yahoo DX-Y.NYB"}

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
        df = pd.concat([cp3.rename("cp"), dff.rename("ff")], axis=1).ffill().dropna()
        spread_bps = (df["cp"] - df["ff"]) * 100.0
        # Resample to weekly to match reported cadence. resample("W-FRI")
        # labels each bucket with its FRIDAY date — for the current,
        # in-progress week that Friday is in the future, so drop any bucket
        # whose label is past today (the in-progress week is a partial value,
        # not a completed weekly observation).
        spread_w = spread_bps.resample("W-FRI").last().dropna()
        spread_w = spread_w.loc[spread_w.index <= pd.Timestamp.today().normalize()]
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

    print("Initial Jobless Claims (jobless raw + ic4wsa 4-week) — methodology-v11.md: IC4WSA ...")
    # Methodology v11 specifies IC4WSA (4-week MA). Phase 1 used ICSA raw.
    # Pull both and let consumers pick. Senior Quant deferral retained.
    s_ic4 = safe_fred("IC4WSA")
    if s_ic4 is not None:
        s_ic4 = (s_ic4 / 1000.0)  # FRED reports in persons; convert to K
        result["ic4wsa"] = {"freq": "W", "unit": "K",
                            "points": series_to_points(s_ic4, round_dp=0)}
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
        # THREEFYTP10 is a DAILY FRED series — the freq label was previously
        # "W", which made the freshness chip mis-state the cadence.
        result["term_premium"] = {"freq": "D", "unit": "bps",
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

    print("ISM Manufacturing PMI — TradingEconomics latest scrape + hardcoded historical anchors ...")
    # PR θ (2026-05-02): FRED removed all ISM data in 2024 (per FRED notice page).
    # Joe approved scrape from a free public source. TradingEconomics displays the
    # current month\'s PMI on its US Business Confidence page; we extract that
    # one value and append/replace into the existing hardcoded historical anchors.
    # If scrape fails, the chip will go stale (red) on next pipeline-health-check
    # tick — exactly the freshness behavior we want.
    ism_data = []
    try:
        import urllib.request, re as _re
        from datetime import datetime
        te_url = "https://tradingeconomics.com/united-states/business-confidence"
        te_req = urllib.request.Request(te_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; macrotilt-data-steward/1.0; +macrotilt.com)"
        })
        with urllib.request.urlopen(te_req, timeout=20) as r:
            te_html = r.read().decode("utf-8", errors="replace")
        # Match "(remained unchanged|increased|decreased|fell|rose|at) X.X points in <Month> [YYYY]"
        m_te = _re.search(
            r"(?:remained.{0,30}|increased.{0,30}|decreased.{0,30}|fell.{0,30}|rose.{0,30}|at)\s+([0-9]+\.?[0-9]*)\s*points?\s*in\s+([A-Z][a-z]+)(?:\s+(\d{4}))?",
            te_html
        )
        if m_te:
            val = float(m_te.group(1))
            month_str = m_te.group(2)
            year_str = m_te.group(3) or str(datetime.utcnow().year)
            iso = datetime.strptime(f"{month_str} {year_str}", "%B %Y").strftime("%Y-%m-%d")
            # Replace the day-of-month with end-of-month
            from calendar import monthrange
            dt = datetime.strptime(iso, "%Y-%m-%d")
            last_day = monthrange(dt.year, dt.month)[1]
            iso = dt.replace(day=last_day).strftime("%Y-%m-%d")
            ism_data.append((iso, val))
            print(f"  ISM live: {val} for {month_str} {year_str} (TradingEconomics)")
    except Exception as e:
        print(f"  ISM TradingEconomics scrape FAILED: {e}")
        # No raise — chip will detect staleness and fire alert.

    # Merge live scrape with historical anchors. Live value wins for matching month.
    fallback_pts = _ism_fallback_monthly()
    fallback_dict = {d: v for d, v in fallback_pts}
    for d, v in ism_data:
        fallback_dict[d] = v  # live overrides historical anchor for any matching date
    merged = sorted(fallback_dict.items(), key=lambda x: x[0])
    result["ism"] = {"freq": "M", "unit": "index",
                      "points": [[d, v] for d, v in merged],
                      "source": "TradingEconomics latest + historical anchors"}
    if False:  # original gated block kept for git-blame readability
        s = None
        result["ism"] = {"freq": "M", "unit": "index",
                         "points": ism_anchor,
                         "source": "ISM.org (curated anchor)"}

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
        # Weekly; compute 3yr % growth (156w back) then resample Q.
        # resample("QE").last() labels each bin with the quarter-end date. When
        # the source series extends into an in-progress quarter (e.g. weekly
        # data lands in April while we're still inside Q2), pandas emits a row
        # labeled with the FUTURE quarter-end (e.g. 2026-06-30) that's really
        # just a partial-quarter snapshot. Drop anything whose quarter-end
        # label is strictly after today so the chart right-edge doesn't show
        # a "future data point."
        # ("Q" was dropped in pandas 3.0 in favor of "QE"; see PR #XX.)
        today = pd.Timestamp.today().normalize()
        g3 = s.pct_change(periods=156) * 100.0
        g3q = g3.resample("QE").last().dropna()
        g3q = g3q.loc[g3q.index <= today]
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


    # ── NEW SERIES (2026-04-24) — Joe-validated FRED series + ETF proxy ─────
    print("M2 Money Supply YoY (m2_yoy) ...")
    s = safe_fred("M2SL")
    if s is not None:
        yoy = (s.pct_change(periods=12) * 100.0).dropna()
        result["m2_yoy"] = {"freq": "M", "unit": "% YoY",
                            "points": series_to_points(yoy, round_dp=2)}

    print("Fed Balance Sheet YoY (fed_bs) ...")
    s = safe_fred("WALCL")
    if s is not None:
        yoy = (s.pct_change(periods=52) * 100.0).dropna()
        result["fed_bs"] = {"freq": "W", "unit": "% YoY",
                            "points": series_to_points(yoy, round_dp=2)}

    print("Reverse Repo (rrp) ...")
    s = safe_fred("RRPONTSYD")
    if s is not None:
        # FRED RRPONTSYD is already reported in $bn (units_short = "Bil. of US $").
        # The task's "divide by 1000" spec was based on a misread of FRED units —
        # leaving the raw series intact yields $2.6T peak (Dec 2022) as expected.
        result["rrp"] = {"freq": "D", "unit": "$bn",
                         "points": series_to_points(s, round_dp=1)}

    print("Bank Reserves at Fed (bank_reserves) ...")
    s = safe_fred("WRESBAL")
    if s is not None:
        s_b = s / 1000.0
        result["bank_reserves"] = {"freq": "W", "unit": "$bn",
                                   "points": series_to_points(s_b, round_dp=1)}

    print("Treasury General Account (tga) ...")
    s = safe_fred("WTREGEN")
    if s is not None:
        s_b = s / 1000.0
        result["tga"] = {"freq": "W", "unit": "$bn",
                        "points": series_to_points(s_b, round_dp=1)}

    print("10Y Inflation Breakeven (Treasury.gov 10Y nominal − 10Y TIPS) ...")
    # Source migration 2026-05-27 (Joe directive): replaced FRED T10YIE with
    # the explicit arithmetic Treasury uses. T10YIE is just (DGS10 − DFII10),
    # and we now have both series direct from Treasury.gov same-day.
    t10n = safe_treasury("nominal", "10 Yr")
    t10r = safe_treasury("tips",    "10 YR")
    if t10n is not None and t10r is not None:
        df = pd.concat([t10n.rename("nom"), t10r.rename("real")], axis=1).dropna()
        be = (df["nom"] - df["real"]).dropna()
        result["breakeven_10y"] = {"freq": "D", "unit": "%",
                                   "points": series_to_points(be, round_dp=2),
                                   "source": "Treasury.gov daily curve (10Y nominal − 10Y TIPS)"}
    else:
        print("  breakeven_10y: Treasury.gov fetch failed — leaving prior value")

    print("CFNAI raw + CFNAI 3-month MA (methodology-v11.md: FRED CFNAIMA3 direct) ...")
    s_cfnai = safe_fred("CFNAI")
    if s_cfnai is not None:
        result["cfnai"] = {"freq": "M", "unit": "index",
                            "points": series_to_points(s_cfnai, round_dp=2)}
    s_cfnai_3ma = safe_fred("CFNAIMA3")
    if s_cfnai_3ma is not None:
        result["cfnai_3ma"] = {"freq": "M", "unit": "index",
                                "points": series_to_points(s_cfnai_3ma, round_dp=2)}
    print("HY-IG ETF Spread Proxy (hy_ig_etf = LQD/HYG) ...")
    lqd = safe_yf("LQD")
    hyg_etf = safe_yf("HYG")
    if lqd is not None and hyg_etf is not None:
        df = pd.concat([lqd.rename("lqd"), hyg_etf.rename("hyg")], axis=1).dropna()
        # LQD / HYG ratio — high when HY is underperforming IG (proxy for wider spreads).
        # Senior Quant kept this as a SEPARATE series (NOT overwriting hy_ig) so the
        # FRED OAS audit trail stays intact. See _hy_ig_pre2023_anchor() for the
        # curated monthly anchor that backfills the FRED-licensed window.
        ratio = (df["lqd"] / df["hyg"]).dropna()
        result["hy_ig_etf"] = {"freq": "D", "unit": "ratio",
                               "points": series_to_points(ratio, round_dp=4),
                               "source": "Yahoo LQD / HYG (proxy)"}

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


    # ── PR #2B (2026-05-01) — wire 11 v11 mechanism inputs that were
    # showing hardcoded mock values in public/MacroTilt_Macro_Overview_Page_v11.html.
    # Each pulls from a free public source per G16 in data_manifest.json. ─────────────────────
    
    print("Buffett Indicator (buffett, NCBCEL / GDP) — methodology-v11.md ...")
    # Per methodology-v11.md: nonfinancial corporate equity market cap as a percentage of GDP.
    # IMPORTANT — unit fix 2026-05-09 (bug surfaced by Phase 2D backtest harness):
    # FRED NCBCEL is reported in MILLIONS of $; FRED GDP is reported in BILLIONS of $.
    # The previous formula assumed both were in $bn and produced values 1000× too high
    # (e.g. Q4 2018 stored as 133,514 instead of the correct ~133.5% of GDP). Convert
    # NCBCEL to $bn first by dividing by 1000, then take the ratio. Matches the
    # canonical formula in compute_v11_sprint1_calibration.py line 687.
    ncbcel = safe_fred("NCBCEL")  # Millions of U.S. Dollars
    gdp = safe_fred("GDP")          # Billions of U.S. Dollars
    if ncbcel is not None and gdp is not None:
        df = pd.concat([ncbcel.rename("e"), gdp.rename("g")], axis=1).ffill().dropna()
        ratio = (df["e"] / 1000.0 / df["g"]) * 100.0  # NCBCEL ($M → $B) / GDP ($B) × 100
        result["buffett"] = {"freq": "Q", "unit": "%",
                              "points": series_to_points(ratio, round_dp=1)}

    print("Investment-Grade OAS (ig_oas) — ICE BofA US Corporate Index OAS ...")
    # BAMLC0A0CM (the canonical ICE BofA US Corporate Index OAS) IS available
    # on FRED's free tier — verified 2026-05-21. The earlier assumption that
    # it was "license-restricted" was wrong; the BAA - DGS10 proxy it forced
    # ran roughly 2x the true spread (e.g. 136 bp vs the real ~75 bp) and the
    # monthly resample stamped the in-progress month with a future date.
    # Switching to the daily series fixes the value, the cadence, AND the
    # future-dated stamp in one move, and matches the page's own methodology
    # copy ("ICE BofA US Corporate Index OAS, daily close").
    ig = safe_fred("BAMLC0A0CM")
    if ig is not None:
        ig_bps = ig * 100.0  # FRED reports %; 0.75% -> 75 bps
        result["ig_oas"] = {"freq": "D", "unit": "bps",
                            "points": series_to_points(ig_bps, round_dp=1)}
        # HY/IG spread ratio (relative credit-risk premium). Both legs are
        # daily ICE BofA OAS — computing on the daily series (no monthly
        # resample) keeps the cadence honest and removes the future bucket.
        hy = safe_fred("BAMLH0A0HYM2")
        if hy is not None:
            df = pd.concat([(hy * 100.0).rename("hy"),
                            ig_bps.rename("ig")], axis=1).dropna()
            ratio = (df["hy"] / df["ig"]).dropna()
            result["hy_ig_ratio"] = {"freq": "D", "unit": "ratio",
                                     "points": series_to_points(ratio, round_dp=2)}

    print("FRA-OIS (fra_ois) — modern proxy: SOFR - Fed Funds ...")
    sofr = safe_fred("SOFR")
    dff = safe_fred("DFF")
    if sofr is not None and dff is not None:
        df = pd.concat([sofr.rename("s"), dff.rename("f")], axis=1).ffill().dropna()
        spread_bps = (df["s"] - df["f"]) * 100.0
        result["fra_ois"] = {"freq": "D", "unit": "bps",
                              "points": series_to_points(spread_bps, round_dp=1)}
        # PR #2C — sofr_ois is the same overnight basis. fra_ois is a 3-month forward
        # version. Both write the same series; chip differentiates by name + label.
        # When/if a true 3m FRA-OIS source becomes available, fra_ois flips to that.
        result["sofr_ois"] = {"freq": "D", "unit": "bps",
                               "points": series_to_points(spread_bps, round_dp=1)}

    print("Real Fed Funds Rate (real_fedfunds) ...")
    pce = safe_fred("PCEPILFE")  # Core PCE, monthly
    if dff is not None and pce is not None:
        pce_yoy = (pce.pct_change(periods=12) * 100.0).dropna()
        # Resample DFF monthly avg
        dff_m = dff.resample("ME").mean().dropna()
        df = pd.concat([dff_m.rename("ff"), pce_yoy.rename("pce")], axis=1).ffill().dropna()
        real = df["ff"] - df["pce"]
        result["real_fedfunds"] = {"freq": "M", "unit": "%",
                                    "points": series_to_points(real, round_dp=2)}

    print("Equity Risk Premium (erp) — methodology-v11.md: (1/CAPE) - DGS10 ...")
    # Per methodology-v11.md: ERP is derived as (1/CAPE) - DGS10. Uses the existing cape series.
    # No new vendor required.
    cape_pts = result.get("cape", {}).get("points", [])
    dgs10_for_erp = safe_fred("DGS10")
    if cape_pts and dgs10_for_erp is not None:
        cape_s = pd.Series({pd.Timestamp(d): float(v) for d, v in cape_pts if v}).dropna()
        ey = 100.0 / cape_s  # earnings yield as %
        dgs_m = dgs10_for_erp.resample("ME").mean().dropna()
        ey_m = ey.resample("ME").last().dropna()
        df = pd.concat([ey_m.rename("ey"), dgs_m.rename("y10")], axis=1).ffill().dropna()
        erp_s = df["ey"] - df["y10"]
        result["erp"] = {"freq": "M", "unit": "%",
                          "points": series_to_points(erp_s, round_dp=2)}

    print("NAAIM Exposure Index (naaim) — naaim.org weekly survey scrape ...")
    # PR ι (2026-05-02): scrape NAAIM\'s public exposure index page. The page
    # renders an HTML table at /programs/naaim-exposure-index/ with rows like:
    #   <td>MM/DD/YYYY</td><td>NN.NN</td>...
    # Weekly survey of active investment managers, free, no API.
    try:
        import urllib.request, re as _re
        from datetime import datetime
        n_url = "https://www.naaim.org/programs/naaim-exposure-index/"
        n_req = urllib.request.Request(n_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; macrotilt-data-steward/1.0; +macrotilt.com)"
        })
        with urllib.request.urlopen(n_req, timeout=20) as r:
            n_html = r.read().decode("utf-8", errors="replace")
        # Pattern: <td>MM/DD/YYYY</td>\s*<td>NN.NN</td>
        n_rows = _re.findall(
            r"<td>(\d{2}/\d{2}/\d{4})</td>\s*<td>([0-9]+\.?[0-9]*)</td>",
            n_html
        )
        if n_rows:
            naaim_pts = []
            for date_str, val_str in n_rows:
                try:
                    iso = datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
                    naaim_pts.append([iso, float(val_str)])
                except Exception:
                    continue
            # Dedupe by date (latest wins) + sort
            seen = {}
            for d, v in naaim_pts:
                seen[d] = v
            naaim_pts = sorted([[d, v] for d, v in seen.items()])
            if naaim_pts:
                result["naaim"] = {"freq": "W", "unit": "% exposure",
                                    "points": naaim_pts,
                                    "source": "naaim.org weekly survey scrape"}
                print(f"  NAAIM: {len(naaim_pts)} weekly points scraped")
        else:
            print(f"  NAAIM: no rows matched — page structure may have changed")
    except Exception as e:
        print(f"  NAAIM scrape failed: {e}")

    print("Equity Put/Call Ratio (put_call) — UW universe_snapshots aggregate ...")
    # PR ζ (2026-05-02): replaced the broken CBOE CSV scrape with an aggregation
    # from data we already pay for. UW universe_snapshots holds per-ticker
    # call_volume / put_volume × 3 snapshots/weekday × ~1700 tickers. Sum across
    # the universe → market-aggregate put/call ratio. Same risk signal as
    # CBOE's aggregate, computed from our covered universe.
    pcr_rows = _supabase_query(
        "universe_snapshots?"
        "select=snapshot_ts,call_volume,put_volume"
        "&snapshot_ts=gte.2024-01-01"
        "&limit=200000"
    )
    if pcr_rows:
        # Group by date, sum calls + puts, compute ratio
        import collections
        agg = collections.defaultdict(lambda: [0.0, 0.0])
        for r in pcr_rows:
            ts = r.get("snapshot_ts","")
            d = ts[:10] if len(ts) >= 10 else None
            if not d: continue
            cv = float(r.get("call_volume") or 0)
            pv = float(r.get("put_volume") or 0)
            agg[d][0] += cv
            agg[d][1] += pv
        pcr_pts = []
        for d in sorted(agg.keys()):
            cv, pv = agg[d]
            if cv > 0:
                pcr_pts.append([d, round(pv / cv, 3)])
        if pcr_pts:
            result["put_call"] = {"freq": "D", "unit": "ratio",
                                   "points": pcr_pts}
            print(f"  put_call: {len(pcr_pts)} daily points from UW universe_snapshots")


    print("FINRA Margin Debt YoY (margin_debt) — finra.org monthly statistics page scrape ...")
    # PR ζ (2026-05-02): scrape FINRA's public margin statistics page.
    # FINRA publishes a public HTML table at this URL with month-by-month
    # debit balances. Smart parsing: pull every month's debit balance row,
    # compute YoY % change, write monthly series.
    try:
        import urllib.request, re
        url = "https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; macrotilt-data-steward/1.0; +macrotilt.com)"
        })
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", errors="replace")
        # FINRA's page renders rows like: Year-Month | Debit Balances ... | Free Credit ...
        # Parse via tabula-style table extraction. The HTML structure is stable enough
        # to grep for "<td>YYYY-MM" patterns.
        rows = re.findall(
            r"<tr[^>]*>\s*<td[^>]*>(\d{4}-\d{2}|\d{4}-[A-Z][a-z]{2})</td>\s*<td[^>]*>\s*\$?([0-9,]+)\s*</td>",
            html,
        )
        if rows:
            from datetime import datetime
            md_data = {}
            for ym_str, val_str in rows:
                try:
                    # FINRA format: "Mar-26" → 2026-03-01
                    d = datetime.strptime(ym_str, "%b-%y").strftime("%Y-%m-01")
                    md_data[d] = float(val_str.replace(",", ""))
                except Exception:
                    continue
            if md_data:
                # Compute YoY %
                series = pd.Series(md_data).sort_index()
                series.index = pd.to_datetime(series.index)
                yoy = (series.pct_change(12) * 100.0).dropna()
                result["margin_debt"] = {"freq": "M", "unit": "% YoY",
                                          "points": series_to_points(yoy, round_dp=1)}
                print(f"  margin_debt: {len(yoy)} monthly YoY points scraped from FINRA")
        else:
            print(f"  FINRA margin_debt: no rows matched — page structure may have changed")
    except Exception as e:
        print(f"  margin_debt scrape failed: {e}")


    # spx_200dma (S&P 500 vs 200-day average) retired 2026-05-25 per bug #1193 —
    # killed from the indicator framework on 2026-05-11; no longer produced.


    print("Advance-Decline 50d cumulative (adv_dec) — Polygon prices_eod count up vs down ...")
    # PR ζ (2026-05-02): real breadth from prices_eod. Count tickers up vs down
    # each day across the liquid US equity universe (~3-4k tickers after $1B+ filter).
    # 50-day cumulative net = sum of daily (advancers − decliners) over trailing 50 days.
    ad_rows = _supabase_rpc("compute_advance_decline_50d", {})
    if ad_rows and isinstance(ad_rows, list):
        pts = [[r.get("trade_date"), int(r.get("net_50d"))]
               for r in ad_rows if r.get("trade_date") and r.get("net_50d") is not None]
        if pts:
            result["adv_dec"] = {"freq": "D", "unit": "issues",
                                  "points": pts}
            print(f"  adv_dec: {len(pts)} daily points from Polygon prices_eod")


    # Belt-and-suspenders: strip any future-dated point before stats/as_of are
    # computed, so a resample-to-period-end label can never publish a stamp
    # dated in the future (the IG OAS / HY-IG / CP-spread class of bug).
    _drop_future_points(result)

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
    """Live CAPE history scraped from multpl.com/shiller-pe/table/by-month.
    Returns dict of {iso_date: value} or None on failure.
    
    PR β (2026-05-02): item #3 of approved 12-PR sequence — replace hardcoded
    CAPE constant with a live source. Joe directive 2026-04-30 (data_triage.html
    row 19): WIRE — Senior Quant picks between multpl scrape, robust-shiller
    library, or FRED proxy. multpl scrape is the lowest-friction option and
    returns 1864 rows of monthly Shiller history going back to 1871.
    """
    import urllib.request, re
    from datetime import datetime
    try:
        url = "https://www.multpl.com/shiller-pe/table/by-month"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; macrotilt-data-steward/1.0; +macrotilt.com)"
        })
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", errors="replace")
        rows = re.findall(
            r"<td[^>]*>([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})</td>\s*<td[^>]*>\s*(?:&#x2002;)?\s*([\d.]+)\s*</td>",
            html,
        )
        if not rows:
            return None
        out = {}
        for date_str, val_str in rows:
            try:
                d = datetime.strptime(date_str, "%b %d, %Y").strftime("%Y-%m-%d")
                out[d] = float(val_str)
            except (ValueError, TypeError):
                continue
        return out if out else None
    except Exception as e:
        print(f"  multpl CAPE scrape failed: {e}")
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


# Bug #1032: write one row per indicator-refresh run to api_usage_log so
# the Admin API Usage bar chart has per-day historical coverage for this
# workflow source. Import is inlined and guarded so a missing module
# can never fail the refresh.
def _log_run_to_api_usage(status, started_at, completed_at, notes):
    import os, sys, uuid as _uuid
    try:
        # trading-scanner is a sibling of this file; add it to sys.path so
        # scanner.api_usage_helper is importable regardless of cwd.
        here = os.path.dirname(os.path.abspath(__file__))
        ts_dir = os.path.join(here, "trading-scanner")
        if os.path.isdir(ts_dir) and ts_dir not in sys.path:
            sys.path.insert(0, ts_dir)
        from scanner.api_usage_helper import log_run_summary
        log_run_summary(
            source="indicator_refresh",
            run_id=_uuid.uuid4(),
            started_at=started_at,
            completed_at=completed_at,
            status=status,
            notes=notes or {},
        )
    except Exception as _exc:
        # Never let logging failure take down the refresh.
        import logging as _lg
        _lg.getLogger(__name__).warning("api_usage_helper not available: %s", _exc)


def main():
    from datetime import datetime, timezone
    started_at = datetime.now(timezone.utc)
    try:
        out_dir = os.path.dirname(OUT_PATH)
        if not os.path.isdir(out_dir):
            os.makedirs(out_dir, exist_ok=True)
        print(f"Fetching history → {OUT_PATH}")
        data = fetch_all()
        # ── Carry forward prior values for missing indicators ────────────────
        # A transient Yahoo rate-limit ("Too Many Requests") used to wipe the
        # affected indicator out of the new JSON entirely. Now: if an indicator
        # is in the existing on-disk file but missing from the fresh fetch,
        # copy the prior entry forward and tag it. The freshness gate still
        # raises if the carried-forward value is past its SLA, so we don't
        # mask staleness — we just don't blow away the prior good value for
        # one bad HTTP call.
        try:
            if os.path.isfile(OUT_PATH):
                with open(OUT_PATH) as _f:
                    prior = json.load(_f)
                carried = []
                for ind_id, entry in prior.items():
                    if ind_id.startswith("__"):
                        continue
                    if ind_id not in data and isinstance(entry, dict) and entry.get("points"):
                        data[ind_id] = entry
                        carried.append(ind_id)
                if carried:
                    print(f"  Carried forward {len(carried)} indicator(s) from prior "
                          f"file (fresh fetch failed): {', '.join(carried)}")
        except Exception as _ce:
            print(f"  carry-forward step skipped: {_ce}")
        # ── Fail-loud staleness gate (Joe directive 2026-05-27) ───────────────
        # Before this gate existed, individual safe_fred() / safe_yf() / safe_treasury()
        # failures returned None and were quietly dropped. The workflow logged
        # "success" while the on-disk JSON went days stale. Now: any daily
        # indicator that is more than N trading days behind today fails the
        # whole run with a visible exception, so the workflow goes red on
        # GitHub Actions and an issue is auto-filed by the watchdog.
        try:
            _check_daily_freshness_or_raise(data)
        except StalenessError as _se:
            print(f"\nFRESHNESS GATE FAILED: {_se}")
            raise
        with open(OUT_PATH, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        size_kb = os.path.getsize(OUT_PATH) / 1024
        print(f"Wrote {OUT_PATH}  ({size_kb:.0f} KB)")
        # Summary per indicator
        n_indicators = 0
        for k, v in sorted(data.items()):
            if k.startswith("__"):
                continue
            n_indicators += 1
            pts = v.get("points", [])
            first = pts[0][0] if pts else "-"
            last = pts[-1][0] if pts else "-"
            print(f"  {k:16s} freq={v.get('freq'):<2s}  {len(pts):5d} points  {first} → {last}")
        _log_run_to_api_usage(
            status="success",
            started_at=started_at,
            completed_at=datetime.now(timezone.utc),
            notes={
                "indicators": n_indicators,
                "out_path": OUT_PATH,
                "size_kb": round(size_kb, 1),
            },
        )
    except Exception as exc:
        _log_run_to_api_usage(
            status="failed",
            started_at=started_at,
            completed_at=datetime.now(timezone.utc),
            notes={"error": str(exc)[:500]},
        )
        raise


if __name__ == "__main__":
    main()
