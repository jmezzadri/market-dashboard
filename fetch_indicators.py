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
import subprocess
from datetime import datetime
import warnings
warnings.filterwarnings("ignore")

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
# CAPE: https://www.multpl.com/shiller-pe
CAPE_VALUE = 34.2
CAPE_AS_OF = "Mar 2026"
# ISM PMI: https://www.ismworld.org (released 1st business day of month)
ISM_VALUE = 52.7
ISM_AS_OF = "Mar 2026"
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
def safe_fred(series_id):
    try:
        data = fred.get_series(series_id, observation_start="2020-01-01").dropna()
        if data.empty:
            return None
        return float(data.iloc[-1]), data.index[-1].strftime("%b %d %Y")
    except Exception as e:
        print(f"  ⚠ FRED {series_id}: {e}")
        return None

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
        vix_s = yf.Ticker("^VIX").history(period="6mo")["Close"].dropna()
        vix_s.index = vix_s.index.tz_localize(None)
        hy_s = fred.get_series("BAMLH0A0HYM2", observation_start="2024-01-01").dropna() * 100
        df = pd.DataFrame({"vix": vix_s, "hy": hy_s}).dropna()
        if len(df) >= 30:
            corr = round(float(df["vix"].tail(63).corr(df["hy"].tail(63))), 2)
            results["eq_cr_corr"] = (corr, datetime.now().strftime("%b %d %Y"))
    except Exception as e:
        print(f"    ⚠ {e}")

    print("  Yield Curve (10Y-2Y)...")
    r = safe_fred("T10Y2Y")
    if r: results["yield_curve"] = (round(r[0] * 100, 0), r[1])

    print("  MOVE Index...")
    r = safe_yahoo("^MOVE")
    if r: results["move"] = (round(r[0], 0), r[1])

    print("  ANFCI...")
    r = safe_fred("ANFCI")
    if r: results["anfci"] = (round(r[0], 2), r[1])

    print("  STLFSI...")
    r = safe_fred("STLFSI4")
    if r: results["stlfsi"] = (round(r[0], 2), r[1])

    print("  Real Rates (10Y TIPS)...")
    r = safe_fred("DFII10")
    if r: results["real_rates"] = (round(r[0], 2), r[1])

    print("  SLOOS C&I...")
    r = safe_fred("DRTSCILM")
    if r: results["sloos_ci"] = (round(r[0], 1), r[1])

    print("  CAPE (manual monthly)...")
    results["cape"] = (CAPE_VALUE, CAPE_AS_OF)

    print("  ISM PMI (manual monthly)...")
    results["ism"] = (ISM_VALUE, ISM_AS_OF)

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

    try:
        from daily_analysis_email import run_if_configured

        run_if_configured(results)
    except Exception as e:
        print(f"\n⚠ Daily AI email skipped: {e}")

    print("\n── Manual updates needed monthly ─────────────────────")
    print(f"  CAPE ({CAPE_VALUE}): https://www.multpl.com/shiller-pe")
    print(f"  ISM  ({ISM_VALUE}): https://www.ismworld.org")
    print(f"  Bank Unrealized Losses ({BANK_UNREAL_VALUE}): https://www.fdic.gov/analysis/quarterly-banking-profile")
    print("\nEdit the values at the top of this script to update them.")
    print("=" * 55)
