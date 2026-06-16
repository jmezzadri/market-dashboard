#!/usr/bin/env python3
"""engine_compare.py — head-to-head: OLD MacroTilt engine vs NEW reworked engine.

Both run through the SAME harness, SAME window, SAME price basis (prices_eod),
SAME costs, on the SAME equity base (SPY) so the ONLY difference is the
de-risking overlay (stress signal + cut-points + defensive sleeve). This
isolates "did the engine rework earn the swap?".

OLD (scripts/compute_macrotilt_engine.py, "validated 1986-2026"):
  stress = trailing 5y percentile of MOVE level, weekly Friday:
     <75th -> RiskOn 100% | 75-85th -> Watch 80% | >=85th -> RiskOff 50%
  yield regime = trailing 5y pctile of 3m 10Y change: >=70 Infl | <=30 Defl | else Neutral
  sleeves: Infl 50%cash/30%GLD/20%SHY/0%TLT | Defl 25%cash/25%GLD/0%SHY/50%TLT | Neutral 50%cash/25%GLD/0%SHY/25%TLT
NEW (asset_tilt_calibration.json):
  stress = blend(MOVE,VIX,credit) z, cut-points refit on 1996+ (risk_on_max / watch_max)
  same yield-regime thresholds; sleeves Infl 50%BIL/30%GLD/20%SHY | Defl 20%BIL/30%GLD/50%TLT | Neutral 34%BIL/33%GLD/33%IEF
"cash" earns the 3-month T-bill (FRED DTB3) for BOTH engines (fair).
"""
import os, json, time
import numpy as np, pandas as pd
import asset_tilt_backtest as bt

COST_BPS = 5.0
DEFTKRS = ["TLT", "SHY", "IEF", "GLD", "BIL"]


def perf(daily):
    d = daily.dropna()
    if len(d) < 60: return {}
    cum = (1 + d).prod()
    yrs = len(d) / 252.0
    cagr = cum ** (1 / yrs) - 1
    sharpe = (d.mean() / d.std()) * np.sqrt(252) if d.std() > 0 else 0.0
    eq = (1 + d).cumprod()
    mdd = (eq / eq.cummax() - 1).min()
    return {"cagr": round(float(cagr), 4), "sharpe": round(float(sharpe), 3),
            "maxdd": round(float(mdd), 4), "n": int(len(d))}


def cal_year_dd(daily, y):
    d = daily[(daily.index >= f"{y}-01-01") & (daily.index <= f"{y}-12-31")].dropna()
    if len(d) < 20: return None
    eq = (1 + d).cumprod()
    return round(float((eq / eq.cummax() - 1).min()), 4)


def weekly_state(level_or_z, fridays, pct_lo, pct_hi, win=261, minw=52, mode="pctile"):
    """Map a weekly series to equity% via trailing-5y percentile (OLD) thresholds."""
    s = level_or_z.reindex(fridays).ffill()
    out = {}
    for i, d in enumerate(s.index):
        v = s.iloc[i]
        if not np.isfinite(v): out[d] = 1.0; continue
        w = s.iloc[max(0, i - win + 1):i + 1].dropna()
        if len(w) < minw: out[d] = 1.0; continue
        p = (w <= v).mean()
        out[d] = 0.5 if p >= pct_hi else (0.8 if p >= pct_lo else 1.0)
    return pd.Series(out)


def yield_regime(tenY, fridays, win=261, minw=52, lo=0.30, hi=0.70):
    s = tenY.reindex(fridays).ffill()
    chg = s - s.shift(13)   # ~3 months in weeks
    out = {}
    for i, d in enumerate(chg.index):
        v = chg.iloc[i]
        if not np.isfinite(v): out[d] = "Neutral"; continue
        w = chg.iloc[max(0, i - win + 1):i + 1].dropna()
        if len(w) < minw: out[d] = "Neutral"; continue
        p = (w <= v).mean()
        out[d] = "Inflationary" if p >= hi else ("Deflationary" if p <= lo else "Neutral")
    return pd.Series(out)


def engine_returns(eq_w, reg_w, sleeves, sret, defret, rf):
    """Daily engine return: equity% * SPY + (1-equity%) * regime sleeve, weekly
    weights applied next bar (shift), 5bps/side cost on weight changes."""
    idx = sret.index
    eqd = eq_w.reindex(idx, method="ffill").shift(1)
    regd = reg_w.reindex(idx, method="ffill").shift(1)
    # sleeve daily return per regime
    sl_ret = pd.Series(0.0, index=idx)
    prev_w = None; cost = pd.Series(0.0, index=idx)
    comps = {}
    for rg, comp in sleeves.items():
        r = pd.Series(0.0, index=idx)
        for k, wt in comp.items():
            if wt == 0: continue
            r = r + wt * (rf if k == "cash" else defret[k].reindex(idx).fillna(0.0))
        comps[rg] = r
    for rg in sleeves:
        sl_ret = sl_ret.where(regd != rg, comps[rg])
    eng = eqd * sret + (1 - eqd) * sl_ret
    # turnover cost: change in equity% (proxy for rebalancing both legs)
    dw = eqd.diff().abs().fillna(0.0)
    eng = eng - dw * (COST_BPS / 10000.0)
    return eng, float(eqd.mean())


def main():
    t0 = time.time()
    cal = json.load(open("public/asset_tilt_calibration.json"))
    cut = cal["stress_cutpoints"]
    new_sleeves = {k.capitalize() if k != "neutral" else "Neutral": v
                   for k, v in {"inflationary": cal["rate_regime_bands"]["composition"]["inflationary"],
                                "deflationary": cal["rate_regime_bands"]["composition"]["deflationary"],
                                "neutral": cal["rate_regime_bands"]["composition"]["neutral"]}.items()}
    old_sleeves = {
        "Inflationary": {"cash": 0.50, "GLD": 0.30, "SHY": 0.20},
        "Deflationary": {"cash": 0.25, "GLD": 0.25, "TLT": 0.50},
        "Neutral": {"cash": 0.50, "GLD": 0.25, "TLT": 0.25}}

    print("[1] prices + signals")
    px = bt.pull_prices(["SPY"] + DEFTKRS)
    spy = px["SPY"]; sret = spy.pct_change()
    defret = {k: px[k].pct_change() for k in DEFTKRS if k in px.columns}
    rf_lvl = bt._fred("DTB3") / 100.0
    rf = (rf_lvl / 252.0).reindex(sret.index, method="ffill").fillna(0.0)   # daily T-bill

    move = bt._site_series("move")                       # OLD stress (level)
    stress = bt.load_stress()                            # NEW blend legs (z)
    blend = pd.concat([stress["move"], stress["vix"], stress["credit"]], axis=1).mean(axis=1)
    tenY = bt._fred("DGS10")

    fridays = pd.bdate_range(sret.index.min(), sret.index.max(), freq="W-FRI")

    # OLD engine
    old_eq = weekly_state(move, fridays, 0.75, 0.85)
    reg = yield_regime(tenY, fridays)
    old_eng, old_avg = engine_returns(old_eq, reg, old_sleeves, sret, defret, rf)

    # NEW engine (blend z cut-points: <=risk_on_max ->100%, <=watch_max ->80%, else 50%)
    bw = blend.reindex(fridays).ffill()
    new_eq = bw.apply(lambda v: 1.0 if v <= cut["risk_on_max"] else (0.8 if v <= cut["watch_max"] else 0.5))
    new_eng, new_avg = engine_returns(new_eq, reg, new_sleeves, sret, defret, rf)

    # common window where BOTH equity signals are defined
    start = max(old_eq.dropna().index.min(), new_eq.dropna().index.min(), pd.Timestamp("2002-01-01"))
    # require trailing 5y for the OLD percentile to be meaningful -> first valid old non-default
    start = max(start, old_eq.index.min())
    win = (sret.index >= start)
    oe = old_eng[win]; ne = new_eng[win]; sp = sret[win]
    # align to first date all three are live
    common = oe.dropna().index.intersection(ne.dropna().index).intersection(sp.dropna().index)
    oe, ne, sp = oe.reindex(common), ne.reindex(common), sp.reindex(common)

    print("\n================  ENGINE HEAD-TO-HEAD  ================")
    print(f"window: {common.min().date()} -> {common.max().date()}  ({len(common)} days)")
    print(f"basis: SPY equity base + defensive sleeves, prices_eod, {COST_BPS}bps/side, weekly")
    for name, r, avg in [("OLD engine (MOVE 5y-pctile)", oe, old_avg),
                         ("NEW engine (blend + refit)", ne, new_avg),
                         ("SPY buy & hold", sp, 1.0)]:
        s = perf(r)
        dds = {y: cal_year_dd(r, y) for y in (2008, 2020, 2022)}
        print(f"  {name:32s} CAGR {s.get('cagr'):+.4f}  Sharpe {s.get('sharpe'):.3f}  "
              f"maxDD {s.get('maxdd'):+.4f}  avgEq {avg:.2f}  | 2008 {dds[2008]} 2020 {dds[2020]} 2022 {dds[2022]}")

    out = {"window": [str(common.min().date()), str(common.max().date())], "basis": "SPY base + sleeves, prices_eod, 5bps/side, weekly",
           "old_engine": perf(oe) | {"avg_equity": round(old_avg, 3), "dd_2008": cal_year_dd(oe, 2008), "dd_2020": cal_year_dd(oe, 2020), "dd_2022": cal_year_dd(oe, 2022)},
           "new_engine": perf(ne) | {"avg_equity": round(new_avg, 3), "dd_2008": cal_year_dd(ne, 2008), "dd_2020": cal_year_dd(ne, 2020), "dd_2022": cal_year_dd(ne, 2022)},
           "spy": perf(sp) | {"dd_2008": cal_year_dd(sp, 2008), "dd_2020": cal_year_dd(sp, 2020), "dd_2022": cal_year_dd(sp, 2022)}}
    os.makedirs("public", exist_ok=True)
    json.dump(out, open("public/engine_compare.json", "w"), indent=2)
    print(f"\nWrote public/engine_compare.json. Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
