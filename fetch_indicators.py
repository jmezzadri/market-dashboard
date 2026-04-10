#!/usr/bin/env python3
"""
Market Stress Dashboard — Indicator Fetcher v2
Pulls live data from FRED API + Yahoo Finance
Updates market-dashboard-v10.jsx with fresh values

Run daily via cron:
  0 7 * * 1-5 cd ~/Documents/market-dashboard && python3 fetch_indicators.py

Two indicators require manual monthly updates (no free API):
  - CAPE (Shiller): https://www.multpl.com/shiller-pe
  - ISM PMI: https://www.ismworld.org
"""

import re
import os
from datetime import datetime
import warnings
warnings.filterwarnings("ignore")

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
FRED_API_KEY = "e1696db1c3f8bb036993f40c61aad0d5"
DASHBOARD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "market-dashboard-v10.jsx")

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
def update_dashboard(results):
    if not os.path.exists(DASHBOARD_FILE):
        print(f"\n⚠ File not found: {DASHBOARD_FILE}")
        return False

    with open(DASHBOARD_FILE, "r") as f:
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
        backup = DASHBOARD_FILE.replace(".jsx", f"_backup_{datetime.now().strftime('%Y%m%d_%H%M')}.jsx")
        with open(backup, "w") as f: f.write(original)
        with open(DASHBOARD_FILE, "w") as f: f.write(content)
        print(f"\n✓ Updated {updated} indicators")
        print(f"✓ Backup: {os.path.basename(backup)}")
    else:
        print("\n⚠ No changes written.")
    return True

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

    update_dashboard(results)

    # Auto-push to GitHub so Vercel redeploys with fresh data
    print("\n── Pushing to GitHub ─────────────────────────────────")
    ret = os.system("cd ~/Documents/market-dashboard && git add market-dashboard-v10.jsx && git commit -m 'Daily data update' && git push")
    if ret == 0:
        print("✓ Pushed to GitHub — Vercel will redeploy in ~60 seconds")
    else:
        print("⚠ Git push failed — check your internet connection")

    print("\n── Manual updates needed monthly ─────────────────────")
    print(f"  CAPE ({CAPE_VALUE}): https://www.multpl.com/shiller-pe")
    print(f"  ISM  ({ISM_VALUE}): https://www.ismworld.org")
    print(f"  Bank Unrealized Losses ({BANK_UNREAL_VALUE}): https://www.fdic.gov/analysis/quarterly-banking-profile")
    print("\nEdit the values at the top of this script to update them.")
    print("=" * 55)
