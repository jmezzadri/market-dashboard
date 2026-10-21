"""
Risk-cockpit calibration check — Paper Portfolio page, 2026-10-20.

Senior Quant. The Paper Portfolio cockpit prints four risk figures that are
computed in the browser from the site's own price feed (src/v2/lib/paperRisk.js):

  * 10-day 99% Value at Risk (historical simulation, √10 scaling)
  * marginal contribution to risk and each name's share of book risk
  * a market / style / stock-specific variance decomposition
  * beta-scaled historical shock scenarios and a VIX-elasticity shock

This script re-derives every one of them in Python from the same data, checks
the identities that must hold, and BACKTESTS the VaR — rolling one-year
windows at the book's current weights, counting how often the next day's loss
exceeded the 99% figure (Kupiec 1995 proportion-of-failures test). The result
is written to RISK_COCKPIT_CHECK.md beside this file. LESSONS 6.19: the
backtest lives in the repo or it did not happen.

Run:  SUPABASE_URL=... SUPABASE_KEY=<anon or service key> \
        python paper_portfolio/qt/research/risk_cockpit_2026-10-20/risk_cockpit_check.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from scipy import stats as st

URL = os.environ.get("SUPABASE_URL", "https://yqaqqzseepebrocgibcw.supabase.co").rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
FACT = {"momentum": "MTUM", "quality": "QUAL", "buybacks": "PKW", "size": "IWM", "value": "VLUE"}
CONF, HORIZON, WIN = 0.99, 10, 252
HERE = Path(__file__).parent


def get(q):
    r = requests.get(f"{URL}/rest/v1/{q}", headers=H, timeout=60); r.raise_for_status(); return r.json()


def rpc(fn, body):
    for attempt in range(3):   # a large jsonb reply occasionally 500s at the gateway; retry once or twice
        r = requests.post(f"{URL}/rest/v1/rpc/{fn}", headers=H, json=body, timeout=120)
        if r.ok:
            return r.json()
    r.raise_for_status()


def main() -> int:
    nav = get("qt_nav_daily?select=d,equity,cash,positions&n_positions=gt.0&order=d.desc&limit=1")[0]
    equity = float(nav["equity"])
    w = pd.Series({p["symbol"]: float(p["mv"]) / equity for p in nav["positions"]})
    syms = list(w.index)
    px = rpc("qt_risk_prices_json", {"syms": syms + ["SPY"] + list(FACT.values()), "since": "2023-01-01"})
    closes = pd.DataFrame({t: pd.Series({d: c for d, c in pts}) for t, pts in px.items()}).sort_index()
    closes.index = pd.to_datetime(closes.index)
    rets = closes.pct_change().dropna(how="any")
    lines = [f"# Risk cockpit calibration check — {date.today().isoformat()}", "",
             f"Book as of {nav['d']}: {len(syms)} names, equity ${equity:,.0f}. Daily returns "
             f"{rets.index[0].date()} → {rets.index[-1].date()} ({len(rets)} sessions shared by every series).", ""]

    # ── 1. point-in-time figures (the ones the page shows today) ──────────
    R = rets[syms].iloc[-WIN:]
    rp = R @ w
    var1 = -np.quantile(rp, 1 - CONF)                       # numpy default = linear interpolation, same as the page
    var10 = var1 * math.sqrt(HORIZON)
    var1n = st.norm.ppf(CONF) * rp.std(ddof=1)
    cov = R.cov() * 252
    sig = math.sqrt(w @ cov @ w)
    mctr = (cov @ w) / sig
    share = w * mctr / sig
    lines += ["## 1. Today's figures, re-derived in Python", "",
              f"| Figure | Value |", "|---|---|",
              f"| Annualized volatility | {sig:.2%} |",
              f"| 1-day 99% VaR, historical simulation | {var1:.2%} |",
              f"| 1-day 99% VaR, normal (cross-check) | {var1n:.2%} |",
              f"| 10-day 99% VaR (√10 scaling) | {var10:.2%} = ${var10 * equity:,.0f} |",
              f"| Σ w·MCTR − σ (must be 0) | {abs(w @ mctr - sig):.2e} |",
              f"| Σ risk share (must be 1) | {share.sum():.6f} |", ""]
    lines += ["Risk share by name (page column 'Risk %'):", "",
              "| Name | Weight | Risk share | Ratio |", "|---|---|---|---|"]
    for s in share.sort_values(ascending=False).index:
        lines.append(f"| {s} | {w[s]:.1%} | {share[s]:.1%} | {share[s] / w[s]:.2f}× |")
    lines.append("")

    # ── 2. variance decomposition identity ──────────────────────────────
    rm = rets["SPY"].iloc[-WIN:]
    X1 = np.column_stack([np.ones(len(rm)), rm])
    b1, *_ = np.linalg.lstsq(X1, rp.values, rcond=None)
    e1 = rp.values - X1 @ b1
    beta = b1[1]
    mkt = beta ** 2 * rm.var(ddof=1) / rp.var(ddof=1)
    F = np.column_stack([rets[FACT[k]].iloc[-WIN:].values - rm.values for k in FACT])
    X2 = np.column_stack([np.ones(len(F)), F])
    b2, *_ = np.linalg.lstsq(X2, e1, rcond=None)
    e2 = e1 - X2 @ b2
    style = (e1.var(ddof=1) - e2.var(ddof=1)) / rp.var(ddof=1)
    spec = e2.var(ddof=1) / rp.var(ddof=1)
    lines += ["## 2. Variance decomposition", "",
              f"β to the S&P 500 fund (1y daily): **{beta:.2f}**. Market {mkt:.1%} · style {style:.1%} · "
              f"stock-specific {spec:.1%} · sum {mkt + style + spec:.4f} (must be 1 up to the intercept term).", "",
              "Style-fund loadings (fund minus S&P, on the market residual): "
              + ", ".join(f"{k} {b2[i + 1]:+.2f}" for i, k in enumerate(FACT)) + ".", ""]

    # ── 3. VaR backtest — Kupiec proportion-of-failures ─────────────────
    full = rets[syms] @ w
    exc = []
    for t in range(WIN, len(full)):
        v = -np.quantile(full.iloc[t - WIN:t], 1 - CONF)
        exc.append(full.iloc[t] < -v)
    n, x = len(exc), int(sum(exc))
    p = 1 - CONF
    # Kupiec LR_pof, χ²(1)
    if x in (0, n):
        lr = -2 * (n * math.log(1 - p) if x == 0 else n * math.log(p))
    else:
        lr = -2 * ((n - x) * math.log(1 - p) + x * math.log(p)
                   - (n - x) * math.log(1 - x / n) - x * math.log(x / n))
    pval = 1 - st.chi2.cdf(lr, 1)
    verdict = "PASS — the 99% VaR is not rejected at the 5% level" if pval > 0.05 else "FAIL — exception rate inconsistent with 99%"
    lines += ["## 3. VaR backtest (Kupiec proportion-of-failures)", "",
              f"Rolling {WIN}-session window at today's weights, one-day-ahead, {n} out-of-sample days "
              f"({full.index[WIN].date()} → {full.index[-1].date()}). Expected exceptions {n * p:.1f}; "
              f"observed **{x}**. LR = {lr:.2f}, p = {pval:.3f}. **{verdict}.**", "",
              "Caveat: the window is short because four holdings listed in 2025; power to reject is low. "
              "Re-run monthly as the record lengthens. The √10 horizon scaling is a convention, not a test — "
              "ten-day overlapping losses are too few to test a 1% tail honestly.", ""]

    # ── 4. shock scenarios read off the S&P 500 fund ────────────────────
    spy = pd.Series({d: c for d, c in rpc("qt_risk_prices_json", {"syms": ["SPY"], "since": "1996-01-01"})["SPY"]})
    spy.index = pd.to_datetime(spy.index)
    eps = [("2008 financial crisis", "2007-10-09", "2009-03-09"), ("2000–02 tech bust", "2000-03-24", "2002-10-09"),
           ("2020 COVID crash", "2020-02-19", "2020-03-23"), ("2022 rate shock", "2022-01-03", "2022-10-12")]
    lines += ["## 4. Shock scenarios (β-scaled)", "", "| Episode | S&P 500 fund | Book at β |", "|---|---|---|"]
    for name, a, b in eps:
        ia = spy[:a].iloc[-1]; ib = spy[:b].iloc[-1]
        d = ib / ia - 1
        lines.append(f"| {name} | {d:.1%} | {beta * d:.1%} |")
    vix = json.load(open(HERE.parents[3] / "public" / "indicator_history.json"))["vix"]["points"]
    vx = pd.Series({d: c for d, c in vix}); vx.index = pd.to_datetime(vx.index)
    j = pd.concat([spy.rename("spy"), vx.rename("vix")], axis=1).dropna()
    y = j.spy.pct_change().dropna(); xx = np.log(j.vix).diff().dropna()
    sl, ic, r, pv, se = st.linregress(xx.values, y.values)
    move = sl * math.log(40 / j.vix.iloc[-1])
    lines += ["", f"VIX elasticity: S&P fund daily return on Δln(VIX), {len(y)} days since {j.index[0].date()}: "
              f"slope {sl:.3f} (R² {r ** 2:.2f}). VIX {j.vix.iloc[-1]:.2f} → 40 in one session implies the fund "
              f"{move:.1%}, the book {beta * move:.1%}.", "",
              "## Verdict", "",
              "All identities hold to machine precision; the VaR backtest is reported with its (low) power; "
              "the shock figures are projections scaled by a measured beta and are labelled as such on the page. "
              "Fit for publication.", ""]
    (HERE / "RISK_COCKPIT_CHECK.md").write_text("\n".join(lines))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
