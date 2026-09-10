"""Round 2: fix the 'stuck in cash for two years' failure of level-percentile gates.
Spike-in / reversion-out rules, a max-duration cap, and the Macro engine's own weekly spec."""
import numpy as np, pandas as pd, itertools, sys
exec(open("overlay_test.py").read().split("rows = []")[0])

def states_generic(on_mask: pd.Series, off_mask: pd.Series, confirm: int, max_days: int | None = None) -> pd.Series:
    st, cur, run, age = np.zeros(len(on_mask), dtype=bool), False, 0, 0
    onv, offv = on_mask.fillna(False).values, off_mask.fillna(False).values
    for i in range(len(onv)):
        if not cur:
            run = run + 1 if onv[i] else 0
            if run >= confirm: cur, age = True, 0
        else:
            age += 1
            if offv[i] or (max_days and age >= max_days and not onv[i]): cur, run = False, 0
        st[i] = cur
    return pd.Series(st, index=on_mask.index)

move_d = move.reindex(idx).ffill(); vix_d = vix.reindex(idx).ffill()
p5, p3 = pct_rank(move, W5).reindex(idx).ffill(), pct_rank(move, W3).reindex(idx).ffill()
v3 = pct_rank(vix, W3).reindex(idx).ffill()
ma63_m = move.rolling(63).mean().reindex(idx).ffill(); ma21_m = move.rolling(21).mean().reindex(idx).ffill()
ma63_v = vix.rolling(63).mean().reindex(idx).ffill()

rows = [row("NO BRAKE", simulate(pd.Series(False, index=idx), 1.0))]
# A. level-in (percentile), reversion-out (MOVE back below its 63d average)
for win, pw in (("5y", p5), ("3y", p3)):
    for on, conf, scale in itertools.product((0.85, 0.90, 0.95), (1, 2, 5), (0.5, 0.0)):
        st = states_generic(pw > on, move_d < ma63_m, conf)
        rows.append(row(f"A MOVE{win} pct>{on:.2f} in / <63dma out conf{conf} s{scale}", simulate(st, scale), st))
# B. level-in, percentile-out, but capped duration (auto-restore after N days unless still above ON)
for on, off, cap, scale in itertools.product((0.90, 0.95), (0.70, 0.80), (42, 63, 126), (0.5, 0.0)):
    st = states_generic(p5 > on, p5 < off, 2, max_days=cap)
    rows.append(row(f"B MOVE5y on{on:.2f}/off{off:.2f} conf2 cap{cap} s{scale}", simulate(st, scale), st))
# C. spike-in: MOVE >= k x its 63d average AND 3y pct > 0.90 ; out below 63dma
for k, conf, scale in itertools.product((1.15, 1.25, 1.40), (1, 2), (0.5, 0.0)):
    st = states_generic((move_d >= k * ma63_m) & (p3 > 0.90), move_d < ma63_m, conf)
    rows.append(row(f"C MOVE spike>={k:.2f}x63dma & pct3y>0.90 conf{conf} s{scale}", simulate(st, scale), st))
    stv = states_generic((vix_d >= k * ma63_v) & (v3 > 0.90), vix_d < ma63_v, conf)
    rows.append(row(f"C VIX spike>={k:.2f}x63dma & pct3y>0.90 conf{conf} s{scale}", simulate(stv, scale), stv))
# D. the Macro engine's own spec: weekly Friday closes, 5y pct, ON >= 0.85 two consecutive Fridays, OFF < 0.75 immediately, 50% equity
wk = move.resample("W-FRI").last().dropna()
pw = pct_rank(wk, 260)   # 5y of weeks
st_w, cur, run = [], False, 0
for x in pw.values:
    if np.isnan(x): st_w.append(cur); continue
    if not cur:
        run = run + 1 if x >= 0.85 else 0
        if run >= 2: cur = True
    else:
        if x < 0.75: cur, run = False, 0
    st_w.append(cur)
st_w = pd.Series(st_w, index=pw.index).reindex(idx, method="ffill").fillna(False)
for scale in (0.5, 0.0):
    rows.append(row(f"D engine spec weekly 5y 0.85x2/0.75 s{scale}", simulate(st_w, scale), st_w))
# E. reference: best round-1 cell
st1 = states(p5, 0.95, 0.70, 2); rows.append(row("E r1 best MOVE5y 0.95/0.70 conf2 s0.0", simulate(st1, 0.0), st1))

df = pd.DataFrame(rows); df.to_csv(f"overlay_round2_{TAG}.csv", index=False)
b = df.iloc[0]
fmt = df.copy()
for c in ["CAGR", "Vol", "MaxDD", "CAGR_H1", "CAGR_H2", "worst_yr", "y2018", "y2020", "y2022", "pct_on"]: fmt[c] = (fmt[c] * 100).round(1)
for c in ["Sharpe", "Sortino", "Sh_H1", "Sh_H2"]: fmt[c] = fmt[c].round(3)
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 500)
cols = ["variant", "CAGR", "Sharpe", "MaxDD", "Sh_H1", "Sh_H2", "worst_yr", "y2020", "y2022", "pct_on", "episodes"]
ok = df[(df.Sh_H1 >= b.Sh_H1) & (df.Sh_H2 >= b.Sh_H2) & (df.Sharpe > b.Sharpe)]
print(f"{len(ok)} of {len(df)-1} beat NO BRAKE everywhere\n")
print(fmt.loc[ok.sort_values("Sharpe", ascending=False).index][cols].head(30).to_string(index=False))
print("\nfamilies A/C/D all cells:")
print(fmt[fmt.variant.str.match(r"^(A|C|D|E|NO)")][cols].to_string(index=False))
