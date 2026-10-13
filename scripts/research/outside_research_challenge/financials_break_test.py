"""2026-10-13 — do financials breaking down while the S&P sits near its high forecast the S&P?
Outside-research challenge, question from the late-cycle read. Data: prices_eod via
theme_sweep/pull_prices.py (XLF, KBE, SPY). Independent episodes, n sessions apart;
baseline = every day over the same sample. Run from /tmp/w (see theme_sweep/README.md)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'theme_sweep'))
from lib import *
spy = etf('SPY'); sv = dict(spy)
def state(t, drop, near, look=63):
    s = etf(t); d = [x for x, _ in s]; v = [x for _, x in s]
    sp = [(x, sv[x]) for x in d if x in sv]; spd = {x: i for i, (x, _) in enumerate(sp)}; spv = [x for _, x in sp]
    out = []
    for i in range(look, len(s)):
        j = spd.get(d[i])
        if j is None or j < 252: continue
        if v[i] / v[i - look] - 1 <= -drop and spv[j] >= (1 - near) * max(spv[j - 252:j + 1]): out.append(d[i])
    return out
def show(name, sd, ts, n, eps=False):
    r = evalsig(sd, ts, n)
    if not r: print(f"{name:58s} {n:3d} fewer than 6 episodes ({len(sd)} state days)"); return
    print(f"{name:58s} {n:3d} n={r['n']:2d} mean={r['mean']:+6.1f} med={r['med']:+6.1f} win={r['win']:.0%} worst={r['worst']:+6.1f} | base={r['base']:+5.1f} bwin={r['basewin']:.0%} t={r['t']:+.1f} h1={r['h1']:+.1f} h2={r['h2']:+.1f}")
    if eps: print('     ', r['eps'])
for t in ('XLF', 'KBE'):
    s = etf(t); v = [x for _, x in s]
    print(t, 'today: 63-session change %.1f%%' % ((v[-1] / v[-64] - 1) * 100))
spv = [x for _, x in spy]; print('SPY vs 252-session high: %.1f%%' % ((spv[-1] / max(spv[-252:]) - 1) * 100))
for t in ('XLF', 'KBE'):
    for drop in (0.05, 0.08, 0.10):
        for near in (0.03, 0.05):
            sd = state(t, drop, near)
            for n in (63, 126):
                show(f'{t} down {drop:.0%}+ in 63 sessions, SPY within {near:.0%} of high: SPY', sd, spy, n, eps=(drop == 0.08 and near == 0.05 and n == 126))
            show(f'   same state: {t}/SPY', sd, ratio(etf(t), spy), 126)
