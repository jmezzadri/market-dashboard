"""
Backtest driver (run as: python3 -m paper_portfolio.tactical.backtest,
after python3 -m paper_portfolio.tactical.fetch_data) for the MacroTilt Tactical engine. 2008 -> today, net of costs.

Discipline rules, so the number can be trusted:
- Signals use data through the PRIOR close; trades execute at the NEXT close.
  Nothing in a weight ever saw the return it is charged against.
- Dividend-adjusted prices (total return). Costs 5 bps per side on turnover.
- Assets enter the universe only once they have a full year of history —
  SCHD simply does not exist to the engine before late 2012.
- One configuration, reported as-run. No parameter search happened; the
  parameters are the ones written in engine.py before the first run.
  (Any change after seeing results must be disclosed in the PR.)
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np, pandas as pd
from paper_portfolio.tactical.engine import (RISK_ASSETS, CASH, VOL_TARGET, COST_PER_SIDE,
                             target_book, stress_series, stress_state)

START = "2008-01-01"

def run(prices: pd.DataFrame, vix: pd.Series, use_overlay=True):
    px = prices.copy()
    rets = px.pct_change()
    dates = px.loc[START:].index
    comp = stress_series(vix.reindex(px.index).ffill(), px["HYG"])
    s_on = stress_state(comp)

    # rebalance on first trading day of each month; risk check every Friday
    月 = pd.Series(dates, index=dates).groupby([dates.year, dates.month]).first()
    rebal_days = set(月.values)
    fridays = set(d for d in dates if d.weekday() == 4)

    w = pd.Series(dtype=float)      # risk-asset weights, POST-scaling
    cash_w = 1.0
    nav = 1.0
    navs, exposures, states = [], [], []
    turnover_total = 0.0
    scale_applied = 1.0

    for i, d in enumerate(dates):
        # 1) accrue today's return with yesterday's weights
        if i > 0:
            r_assets = sum(w.get(a, 0.0) * (rets.at[d, a] if pd.notna(rets.at[d, a]) else 0.0)
                           for a in w.index)
            r_cash = cash_w * (rets.at[d, CASH] if pd.notna(rets.at[d, CASH]) else 0.0)
            nav *= (1 + r_assets + r_cash)

        # 2) trade at today's close using data through YESTERDAY
        sig_date = dates[i - 1] if i > 0 else d
        new_w = None
        if d in rebal_days:
            base_w, book_vol = target_book(px, sig_date)
            if len(base_w) and book_vol > 0:
                tgt = VOL_TARGET * (0.5 if (use_overlay and s_on.get(sig_date, False)) else 1.0)
                scale_applied = min(1.0, tgt / book_vol)
                new_w = base_w * scale_applied
            else:
                new_w = pd.Series(dtype=float); scale_applied = 0.0
            base_book = base_w if len(base_w) else pd.Series(dtype=float)
            base_vol = book_vol
        elif use_overlay and d in fridays and len(w) > 0:
            # overlay-only check: rescale the existing book if state changed
            want = VOL_TARGET * (0.5 if s_on.get(sig_date, False) else 1.0)
            if base_vol > 0:
                want_scale = min(1.0, want / base_vol)
                if abs(want_scale - scale_applied) > 0.05:
                    new_w = base_book * want_scale
                    scale_applied = want_scale
        if new_w is not None:
            all_a = set(w.index) | set(new_w.index)
            turn = sum(abs(new_w.get(a, 0.0) - w.get(a, 0.0)) for a in all_a)
            nav *= (1 - turn * COST_PER_SIDE)
            turnover_total += turn
            w = new_w[new_w > 0]
            cash_w = max(0.0, 1.0 - float(w.sum()))

        navs.append(nav); exposures.append(float(w.sum())); states.append(bool(s_on.get(d, False)))

    out = pd.DataFrame({"nav": navs, "exposure": exposures, "stress": states}, index=dates)
    out.attrs["turnover_per_year"] = turnover_total / (len(dates) / 252)
    return out

def bench(prices, spec):     # spec: {asset: weight}, monthly rebalanced
    px = prices; rets = px.pct_change(); dates = px.loc[START:].index
    月 = pd.Series(dates, index=dates).groupby([dates.year, dates.month]).first()
    rebal = set(月.values)
    w = {}; nav = 1.0; navs = []
    for i, d in enumerate(dates):
        if i > 0:
            nav *= 1 + sum(w.get(a, 0) * (rets.at[d, a] if pd.notna(rets.at[d, a]) else 0) for a in w)
        if d in rebal: w = dict(spec)
        navs.append(nav)
    return pd.Series(navs, index=dates)

def metrics(nav: pd.Series, cash_ret: pd.Series):
    r = nav.pct_change().dropna()
    yrs = len(r) / 252
    cagr = nav.iloc[-1] ** (1 / yrs) - 1
    vol = r.std() * np.sqrt(252)
    rf = cash_ret.reindex(r.index).fillna(0)
    sharpe = ((r - rf).mean() / r.std()) * np.sqrt(252) if r.std() > 0 else 0
    dd = (nav / nav.cummax() - 1).min()
    ann = nav.resample("YE").last().pct_change().dropna()
    y2022 = ann[ann.index.year == 2022]
    return dict(cagr=float(cagr), vol=float(vol), sharpe=float(sharpe),
                maxdd=float(dd), worst_year=float(ann.min()),
                y2022=float(y2022.iloc[0]) if len(y2022) else None)

if __name__ == "__main__":
    DATA = Path(__file__).resolve().parent / "data"
    px = pd.read_pickle(DATA / "prices.pkl")
    stress_in = pd.read_pickle(DATA / "stress.pkl")
    vix = stress_in["vix"]
    cash_r = px[CASH].pct_change()

    eng  = run(px, vix, use_overlay=True)
    eng0 = run(px, vix, use_overlay=False)
    spy  = bench(px, {"SPY": 1.0})
    s6040 = bench(px, {"SPY": 0.6, "IEF": 0.4})

    res = {
        "MacroTilt Tactical":        metrics(eng["nav"], cash_r),
        "  same, overlay off":       metrics(eng0["nav"], cash_r),
        "S&P 500 (SPY)":             metrics(spy, cash_r),
        "60/40 (SPY/IEF)":           metrics(s6040, cash_r),
    }
    res["MacroTilt Tactical"]["turnover_per_year"] = round(eng.attrs["turnover_per_year"], 2)
    for k, v in res.items():
        print(f"{k:24s} CAGR {v['cagr']*100:6.2f}%  vol {v['vol']*100:5.2f}%  "
              f"Sharpe {v['sharpe']:5.2f}  MaxDD {v['maxdd']*100:6.1f}%  "
              f"worst yr {v['worst_year']*100:6.1f}%  2022 {'' if v['y2022'] is None else f'{v[chr(121)+chr(50)+chr(48)+chr(50)+chr(50)]*100:6.1f}%'}")
    eng.to_pickle(DATA / "engine_run.pkl"); eng0.to_pickle(DATA / "engine_run_no_overlay.pkl")
    spy.to_pickle(DATA / "spy.pkl"); s6040.to_pickle(DATA / "b6040.pkl")
    json.dump(res, open(DATA / "results.json", "w"), indent=1)
