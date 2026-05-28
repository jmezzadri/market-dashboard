#!/usr/bin/env python3
"""
Market Stress Dashboard — Indicator Fetcher v2
Pulls live data from FRED API + Yahoo Finance
Updates src/App.jsx (and market-dashboard-v10.jsx if present) with fresh values.

Daily automation (macOS): scripts/install-launchagent.sh
  (fills __HOME__/__REPO__ in launchd/com.joemezzadri.market-dashboard.fetch.plist and bootstraps the agent)

Optional env:
  FRED_API_KEY   — override key in this file (recommended for security)
  SKIP_GIT_PUSH=1 — fetch + patch files only, no commit/push
  GITHUB_TOKEN or GH_TOKEN — PAT for `git push` when using an https://github.com remote from
    launchd (SSH agent is often unavailable; use fine-grained token with Contents read-write)
  MARKET_DASHBOARD_PYTHON — absolute path to python3 (default: Apple CLT python if present)

Two indicators require manual monthly updates (no free API):
  - CAPE (Shiller): https://www.multpl.com/shiller-pe
  - ISM PMI: https://www.ismworld.org
"""

import re
import os
import sys
import subprocess
from datetime import datetime
import warnings
warnings.filterwarnings("ignore")


def _ensure_user_site_on_path() -> None:
    """pip install --user puts packages in ~/Library/Python/...; launchd often omits user site."""
    try:
        import site

        usp = site.getusersitepackages()
        paths = (usp,) if isinstance(usp, str) else tuple(usp)
        for p in paths:
            if p and os.path.isdir(p) and p not in sys.path:
                sys.path.insert(0, p)
    except Exception:
        pass


_ensure_user_site_on_path()

from dashboard_env import load_market_dashboard_env

load_market_dashboard_env()

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRED_API_KEY = os.environ.get("FRED_API_KEY", "e1696db1c3f8bb036993f40c61aad0d5")

def dashboard_paths():
    paths = [os.path.join(BASE_DIR, "src", "App.jsx")]
    legacy = os.path.join(BASE_DIR, "market-dashboard-v10.jsx")
    if os.path.isfile(legacy):
        paths.append(legacy)
    return paths

# ── MANUAL MONTHLY VALUES ─────────────────────────────────────────────────────
# Update these once per month — takes 2 minutes
# CAPE is now scraped live from multpl.com (was: CAPE_VALUE/CAPE_AS_OF hardcoded
# constants, manually edited monthly per Joe's old workflow). Joe directive
# 2026-04-30 (Phase 3 PR #3b): swap to live source so Mech 1 Valuation tile
# is auto-current. Senior Quant pick: multpl scrape (vs robust-shiller library
# or FRED proxy). multpl.com publishes Shiller's monthly update in HTML; we
# parse it with safe_multpl_cape() defined below.
# ISM PMI is now pulled live from FRED NAPMPI (was: ISM_VALUE/ISM_AS_OF
# hardcoded constants, manually edited monthly per Joe's old workflow).
# Joe directive 2026-04-30 (Phase 3 PR #3a): swap to live FRED feed so the
# Mech 4 Growth tile is auto-current on each FRED release. Senior Quant
# decided the source pick (FRED NAPMPI vs ISM-direct paid feed); FRED proxy
# tracks new-orders directionally per methodology-v11.md Section 5.4.
# Bank Unrealized Losses: https://www.fdic.gov/analysis/quarterly-banking-profile
BANK_UNREAL_VALUE = 19.9
BANK_UNREAL_AS_OF = "Q4 2025"

# ── IMPORTS ───────────────────────────────────────────────────────────────────
try:
    from fredapi import Fred
    import yfinance as yf
    import pandas as pd
except ImportError as e:
    print(f"Missing library: {e}")
    print("Run: pip3 install fredapi yfinance pandas")
    exit(1)

fred = Fred(api_key=FRED_API_KEY)

# ── HELPERS ───────────────────────────────────────────────────────────────────

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

def safe_fred(series_id):
    """Bug #1067/#1068 — retry once with 5-second backoff on empty/exception.
    Log to pipeline_health when no fresh observation lands so the dial's
    FreshnessDot can surface the cause on hover."""
    import time
    last_err = None
    for attempt in range(2):
        try:
            data = fred.get_series(series_id, observation_start="2020-01-01").dropna()
            if data.empty:
                last_err = "FRED returned no observations"
                if attempt == 0:
                    time.sleep(5)
                    continue
                break
            return float(data.iloc[-1]), data.index[-1].strftime("%b %d %Y")
        except Exception as e:
            last_err = str(e)
            print(f"  ⚠ FRED {series_id} attempt {attempt+1}: {e}")
            if attempt == 0:
                time.sleep(5)
                continue
    _log_pipeline_health(series_id, f"no fresh observation from FRED ({last_err})")
    return None


# Per-process cache so multiple tenor reads from the same (kind, year) CSV
# share one HTTP call.
_TREASURY_CURRENT_CACHE = {}

def safe_treasury(series_kind, tenor_label):
    """Return (latest_value, as_of_str) from the Treasury.gov daily yield-curve CSV.

    Replaces FRED for daily Treasury and TIPS yields — same data, but Treasury.gov
    publishes same-day instead of FRED's late-afternoon T+1 delay.

    Args:
        series_kind: 'nominal' (par yields) or 'tips' (real yields).
        tenor_label: CSV column header — e.g. '10 Yr' for nominal, '10 YR' for TIPS.
    """
    import time, urllib.request, io
    from datetime import datetime as _dt
    KIND = {
        "nominal": "daily_treasury_yield_curve",
        "tips":    "daily_treasury_real_yield_curve",
    }
    year = _dt.utcnow().year
    cache_key = (series_kind, year)
    df = _TREASURY_CURRENT_CACHE.get(cache_key)
    last_err = None
    if df is None:
        for attempt in range(2):
            try:
                url = (
                    "https://home.treasury.gov/resource-center/data-chart-center/"
                    f"interest-rates/daily-treasury-rates.csv/{year}/all"
                    f"?type={KIND[series_kind]}&field_tdr_date_value={year}"
                    "&page&_format=csv"
                )
                req = urllib.request.Request(url, headers={
                    "User-Agent": "macrotilt-data-steward/1.0 (+https://macrotilt.com)"
                })
                with urllib.request.urlopen(req, timeout=12) as r:
                    body = r.read().decode("utf-8", errors="replace")
                df = pd.read_csv(io.StringIO(body))
                df["Date"] = pd.to_datetime(df["Date"], format="%m/%d/%Y", errors="coerce")
                df = df.dropna(subset=["Date"]).sort_values("Date")
                _TREASURY_CURRENT_CACHE[cache_key] = df
                break
            except Exception as e:
                last_err = str(e)
                print(f"  ⚠ Treasury.gov {series_kind} attempt {attempt+1}: {e}")
                if attempt == 0:
                    time.sleep(3)
                    continue
    if df is None:
        _log_pipeline_health(
            f"Treasury.gov {series_kind}",
            f"no observation from Treasury.gov ({last_err})",
        )
        return None
    if tenor_label not in df.columns:
        _log_pipeline_health(
            f"Treasury.gov {series_kind} {tenor_label}",
            f"missing column {tenor_label!r}",
        )
        return None
    val = pd.to_numeric(df[tenor_label], errors="coerce").dropna()
    if val.empty:
        return None
    last_dt = df.loc[val.index[-1], "Date"]
    return float(val.iloc[-1]), last_dt.strftime("%b %d %Y")

def safe_yahoo(ticker):
    try:
        hist = yf.Ticker(ticker).history(period="5d")["Close"].dropna()
        if hist.empty:
            return None
        as_of = hist.index[-1].strftime("%b %d %Y")
        return round(float(hist.iloc[-1]), 4), as_of
    except Exception as e:
        print(f"  ⚠ Yahoo {ticker}: {e}")
        return None

# ── FETCH ─────────────────────────────────────────────────────────────────────
def safe_multpl_cape():
    """Scrape Shiller CAPE monthly from multpl.com. Mirrors safe_fred / safe_yahoo
    contract — returns (value: float, as_of: str) or None on persistent failure.

    Why a scrape and not a library: multpl is the canonical free source for
    Shiller's Cyclically-Adjusted P/E. The robust-shiller python library is a
    wrapper over the same data and adds an unnecessary dep. FRED carries
    SHILLER_PE_RATIO_MONTH but lags multpl by ~1 month.

    Source: https://www.multpl.com/shiller-pe (HTML scrape).
    Updated: monthly, by Robert Shiller / multpl maintainers.
    Failure mode: same as safe_fred — log to pipeline_health, return None.
    """
    import time, re
    URL = "https://www.multpl.com/shiller-pe"
    UA  = "Mozilla/5.0 (compatible; MacroTilt/1.0; +https://macrotilt.com/)"
    last_err = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            # Anchor on <div id="current">...Shiller PE Ratio</span>:</b> [number]
            # Verified against live multpl.com HTML 2026-04-30.
            m = re.search(
                r'<div\s+id=["\']current["\'][^>]*>.*?Shiller PE Ratio.*?</b>\s*([0-9]+\.[0-9]+)',
                html, re.DOTALL | re.IGNORECASE,
            )
            if not m:
                last_err = "no CAPE number matched in #current div on multpl.com"
                if attempt == 0:
                    time.sleep(5); continue
                break
            value = float(m.group(1))
            # As-of: multpl shows a real-time timestamp like "4:00 PM EDT, Wed Apr 29".
            # We surface just the day for the indicator chip.
            ma = re.search(
                r'<div\s+id=["\']timestamp["\'][^>]*>\s*([^<]+?)\s*</div>',
                html, re.DOTALL | re.IGNORECASE,
            )
            as_of = ma.group(1).strip() if ma else "live"
            return value, as_of
        except Exception as e:
            last_err = str(e)
            print(f"  ⚠ multpl CAPE attempt {attempt+1}: {e}")
            if attempt == 0:
                time.sleep(5); continue
    _log_pipeline_health("CAPE", f"no fresh CAPE from multpl ({last_err})")
    return None


def fetch_all():
    results = {}
    print("\n── Fetching indicators ───────────────────────────────")

    print("  VIX...")
    r = safe_yahoo("^VIX")
    if r: results["vix"] = (round(r[0], 1), r[1])

    print("  HY-IG Spread...")
    hy = safe_fred("BAMLH0A0HYM2")
    ig = safe_fred("BAMLC0A0CM")
    if hy and ig:
        results["hy_ig"] = (round(hy[0] * 100 - ig[0] * 100, 0), hy[1])

    print("  EQ-Credit Correlation...")
    try:
        # Bug #2 fix: was correlating VIX *levels* with HY-spread *levels*, which
        # measures slow trend co-movement rather than risk-off synchronization.
        # New methodology: 63-day rolling Pearson correlation of SPY and HYG
        # DAILY RETURNS — the standard measure of whether equities and HY credit
        # are moving as a single risk factor. Empirical 11y range ~0.38-0.96,
        # mean ~0.75, sd ~0.09. See macro_compute.py SD["eq_cr_corr"].
        spy_s = yf.Ticker("SPY").history(period="12mo")["Close"].dropna().pct_change()
        hyg_s = yf.Ticker("HYG").history(period="12mo")["Close"].dropna().pct_change()
        spy_s.index = spy_s.index.tz_localize(None)
        hyg_s.index = hyg_s.index.tz_localize(None)
        df = pd.DataFrame({"spy": spy_s, "hyg": hyg_s}).dropna()
        if len(df) >= 63:
            corr = round(float(df["spy"].tail(63).corr(df["hyg"].tail(63))), 2)
            # As-of is the SPY price date (most recent trading day), not wall time
            last_date = df.index[-1].strftime("%b %d %Y")
            results["eq_cr_corr"] = (corr, last_date)
    except Exception as e:
        print(f"    ⚠ {e}")

    print("  Yield Curve (10Y-2Y) — Treasury.gov ...")
    # Source migration 2026-05-27 (Joe directive): dropped FRED T10Y2Y in favor
    # of Treasury.gov same-day pull and computing 10Y − 2Y inline.
    t10 = safe_treasury("nominal", "10 Yr")
    t2  = safe_treasury("nominal", "2 Yr")
    if t10 and t2:
        results["yield_curve"] = (round((t10[0] - t2[0]) * 100, 0), t10[1])

    print("  MOVE Index...")
    r = safe_yahoo("^MOVE")
    if r: results["move"] = (round(r[0], 0), r[1])

    print("  ANFCI...")
    r = safe_fred("ANFCI")
    if r: results["anfci"] = (round(r[0], 2), r[1])

    print("  STLFSI...")
    r = safe_fred("STLFSI4")
    if r: results["stlfsi"] = (round(r[0], 2), r[1])

    print("  Real Rates (10Y TIPS) — Treasury.gov ...")
    # Source migration 2026-05-27 (Joe directive): dropped FRED DFII10 in favor
    # of Treasury.gov's daily TIPS curve. FRED DFII10 publishes around 20:00 UTC
    # (the source of repeated "Stale · 6d" labels); Treasury.gov posts same-day.
    r = safe_treasury("tips", "10 YR")
    if r: results["real_rates"] = (round(r[0], 2), r[1])

    print("  SLOOS C&I...")
    r = safe_fred("DRTSCILM")
    if r: results["sloos_ci"] = (round(r[0], 1), r[1])

    print("  CAPE (Shiller, multpl.com scrape)...")
    r = safe_multpl_cape()
    if r: results["cape"] = (round(r[0], 2), r[1])

    print("  ISM Manufacturing PMI (FRED NAPMPI)...")
    r = safe_fred("NAPMPI")
    if r: results["ism"] = (round(r[0], 1), r[1])

    # Copper/Gold: (copper USD/lb * 100) / gold USD/oz → ~0.10-0.25 range
    print("  Copper/Gold Ratio...")
    copper = safe_yahoo("HG=F")
    gold = safe_yahoo("GC=F")
    if copper and gold and gold[0] > 0:
        results["copper_gold"] = (round((copper[0] * 100) / gold[0], 3), copper[1])

    # BKX/SPX: KBE ETF / SPY ETF → ~0.07-0.12 range
    print("  BKX/SPX (KBE/SPY)...")
    kbe = safe_yahoo("KBE")
    spy = safe_yahoo("SPY")
    if kbe and spy and spy[0] > 0:
        results["bkx_spx"] = (round(kbe[0] / spy[0], 3), kbe[1])

    print("  Bank Unrealized Losses (manual quarterly)...")
    results["bank_unreal"] = (BANK_UNREAL_VALUE, BANK_UNREAL_AS_OF)

    print("  3Y Bank Credit Growth...")
    try:
        bc = fred.get_series("TOTBKCR", observation_start="2018-01-01").dropna()
        if len(bc) >= 36:
            g = round((float(bc.iloc[-1]) / float(bc.iloc[-37]) - 1) * 100, 1)
            results["credit_3y"] = (g, bc.index[-1].strftime("%b %Y"))
    except Exception as e:
        print(f"    ⚠ {e}")

    print("  Term Premium (Kim-Wright)...")
    r = safe_fred("THREEFYTP10")
    if r: results["term_premium"] = (round(r[0] * 100, 0), r[1])

    # CMDI proxy: NFCI converted to 0+ scale (NFCI + 0.5, floored at 0)
    print("  CMDI (NFCI proxy)...")
    r = safe_fred("NFCI")
    if r: results["cmdi"] = (round(max(0.0, r[0] + 0.5), 2), r[1])

    print("  HY Effective Yield...")
    r = safe_fred("BAMLH0A0HYM2EY")
    if r: results["loan_syn"] = (round(r[0], 2), r[1])

    print("  USD Index...")
    r = safe_yahoo("DX-Y.NYB")
    if r: results["usd"] = (round(r[0], 1), r[1])

    print("  CP/FF Spread...")
    cp = safe_fred("DCPF3M")
    ff = safe_fred("DFF")
    if cp and ff:
        results["cpff"] = (round((cp[0] - ff[0]) * 100, 0), cp[1])

    print("  SKEW Index...")
    r = safe_yahoo("^SKEW")
    if r: results["skew"] = (round(r[0], 0), r[1])

    print("  SLOOS CRE...")
    r = safe_fred("DRTSCIS")
    if not r: r = safe_fred("DRTSCLCC")
    if r: results["sloos_cre"] = (round(r[0], 1), r[1])

    print("  Bank Credit YoY...")
    try:
        bc = fred.get_series("TOTBKCR", observation_start="2023-01-01").dropna()
        if len(bc) >= 52:
            g = round((float(bc.iloc[-1]) / float(bc.iloc[-53]) - 1) * 100, 1)
            results["bank_credit"] = (g, bc.index[-1].strftime("%b %d %Y"))
    except Exception as e:
        print(f"    ⚠ {e}")

    print("  Jobless Claims...")
    r = safe_fred("ICSA")
    if r: results["jobless"] = (round(r[0] / 1000, 0), r[1])

    print("  JOLTS Quits...")
    r = safe_fred("JTSQUR")
    if r: results["jolts_quits"] = (round(r[0], 1), r[1])

    return results

# ── UPDATE JSX ────────────────────────────────────────────────────────────────
def update_dashboard(path, results):
    if not os.path.exists(path):
        print(f"\n⚠ File not found: {path}")
        return False

    with open(path, "r") as f:
        content = f.read()
    original = content
    updated = 0

    for ind_id, (new_val, as_of) in results.items():
        pattern = rf'({re.escape(ind_id)}:\["[^"]+","[^"]+","[^"]+",\d+,"[^"]*",\d+,)\s*[\d.+-]+'
        new_content = re.sub(pattern, rf'\g<1>{new_val}', content)
        if new_content != content:
            updated += 1
        content = new_content
        content = re.sub(
            rf'({re.escape(ind_id)}:")([^"]+)(")',
            rf'\g<1>{as_of}\g<3>',
            content
        )

    if content != original:
        backup = path.replace(".jsx", f"_backup_{datetime.now().strftime('%Y%m%d_%H%M')}.jsx")
        with open(backup, "w") as f:
            f.write(original)
        with open(path, "w") as f:
            f.write(content)
        print(f"\n✓ {os.path.basename(path)}: patched {updated} indicator value(s)")
        print(f"  Backup: {os.path.basename(backup)}")
    else:
        print(f"\n⚠ {os.path.basename(path)}: no changes written.")
    return True


def update_all_dashboards(results):
    ok = True
    for p in dashboard_paths():
        if not update_dashboard(p, results):
            ok = False
    return ok


def git_commit_and_push() -> int:
    """Stage dashboard files, commit if needed, push. Uses GITHUB_TOKEN for HTTPS GitHub when set."""
    chk = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=BASE_DIR,
        capture_output=True,
    )
    if chk.returncode != 0:
        print(f"⚠ git: not a repository at {BASE_DIR} — run from a git clone of market-dashboard")
        return 1

    paths = [os.path.relpath(p, BASE_DIR) for p in dashboard_paths() if os.path.isfile(p)]
    if not paths:
        print("⚠ No dashboard files to add")
        return 1

    env = os.environ.copy()
    r = subprocess.run(["git", "add", *paths], cwd=BASE_DIR, env=env)
    if r.returncode != 0:
        return r.returncode

    r = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=BASE_DIR, env=env)
    if r.returncode == 0:
        print("No changes to commit — skipping push (dashboard already up to date)")
        return 0

    r = subprocess.run(["git", "commit", "-m", "Daily data update"], cwd=BASE_DIR, env=env)
    if r.returncode != 0:
        print("⚠ git commit failed")
        return r.returncode

    pushed = False
    token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    origin_url = ""
    u = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=BASE_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if u.returncode == 0:
        origin_url = (u.stdout or "").strip()

    if token and origin_url.startswith("https://github.com"):
        push_cmd = [
            "git",
            "-c",
            "http.https://github.com/.extraheader=AUTHORIZATION: bearer " + token,
            "push",
        ]
    else:
        push_cmd = ["git", "push"]

    r = subprocess.run(push_cmd, cwd=BASE_DIR, env=env, capture_output=True, text=True)
    if r.returncode == 0:
        pushed = True
    else:
        err_tail = ((r.stderr or "") + (r.stdout or "")).strip()
        if err_tail:
            tail = err_tail[-800:] if len(err_tail) > 800 else err_tail
            print(f"git push stderr: {tail}")
        if origin_url.startswith("git@github.com") or origin_url.startswith("ssh://"):
            print(
                "⚠ git push failed over SSH — ensure ssh-agent (run-daily-fetch sets SSH_AUTH_SOCK) "
                "or set GITHUB_TOKEN and use an https://github.com remote"
            )
        elif origin_url.startswith("https://github.com") and not token:
            print(
                "⚠ git push failed — set GITHUB_TOKEN in ~/.config/market-dashboard.env "
                "(PAT with repo scope) or fix SSH auth"
            )
        else:
            print("⚠ git push failed — check remote URL, auth, and network")
    if pushed:
        print("✓ Pushed to GitHub — Vercel will redeploy in ~60 seconds")
    return r.returncode


# ── MAIN ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  Market Stress Dashboard — Data Fetcher v2")
    print(f"  {datetime.now().strftime('%A %B %d, %Y %I:%M %p')}")
    print("=" * 55)

    results = fetch_all()

    print("\n── Results ───────────────────────────────────────────")
    print(f"{'Indicator':<20} {'Value':<12} {'As Of'}")
    print("-" * 50)
    for k, (v, d) in results.items():
        print(f"{k:<20} {str(v):<12} {d}")
    print(f"\n✓ {len(results)}/25 indicators fetched")

    update_all_dashboards(results)

    if os.environ.get("SKIP_GIT_PUSH") == "1":
        print("\n── Git ───────────────────────────────────────────────")
        print("SKIP_GIT_PUSH=1 — skipping commit/push")
    else:
        print("\n── Pushing to GitHub ─────────────────────────────────")
        git_commit_and_push()

    # Daily AI email is disabled — consolidated into the 3:30 PM trading scanner email.
    # To re-enable: uncomment the block below.
    # try:
    #     from daily_analysis_email import run_if_configured
    #     run_if_configured(results)
    # except Exception as e:
    #     print(f"\n⚠ Daily AI email skipped: {e}")

    print("\n── Manual updates needed monthly ─────────────────────")
    # CAPE now sourced live from multpl.com (PR #3b 2026-04-30).
    # ISM PMI now sourced live from FRED NAPMPI (PR #3a 2026-04-30).
    print(f"  Bank Unrealized Losses ({BANK_UNREAL_VALUE}): https://www.fdic.gov/analysis/quarterly-banking-profile")
    print("\nEdit the values at the top of this script to update them.")
    print("=" * 55)
