"""Challenge test 2026-11-24: a macro letter stays short the Nasdaq-100 under its 200-day after the
S&P 500's 8.6% week (Nov 16-20) and Monday's 4.7% rebound; the street's reflex is to buy the dip.
Question for our own work: after an S&P week of -8% or worse, is the first bounce a sale, a purchase,
or neither once a stop is applied? SPY 1996-2026, QQQ 1999-2026, XLU/XLK/XLP 1998-2026 (prices_eod
via scripts/research/theme_sweep/pull_prices.py into /tmp/w/px). Signal: 5-session return <= -8%,
episodes 63 sessions apart. Entry at the NEXT close (what a morning note can do), 62 sessions held,
against every start in the same sample. Then the same trades with (a) a 5% / 7.5% / 10% stop on the
position and (b) an exit on the first S&P close below the signal-day close."""
import json, statistics as st
def load(t): return [(d, float(v)) for d, v in json.load(open(f'/tmp/w/px/{t}.json'))]
spy = load('SPY'); cal = [d for d, _ in spy]; sv = [v for _, v in spy]; sd = dict(spy)
def chg(v, i, n): return (v[i] / v[i - n] - 1) * 100
def indep(ix, gap):
    out, last = [], -10**9
    for i in ix:
        if i - last >= gap: out.append(i); last = i
    return out
SIG = indep([i for i in range(200, len(sv)) if chg(sv, i, 5) <= -8], 63)
print('signal dates:', [cal[i] for i in SIG])
print('\nA. Did the low hold? sessions to the first S&P close below the signal-day close (next 62)')
n_retest = 0
for i in SIG:
    if i + 63 >= len(sv): print(' ', cal[i], 'pending'); continue
    k = next((j - i for j in range(i + 1, i + 63) if sv[j] < sv[i]), None); n_retest += k is not None
    print(f"  {cal[i]} next day {chg(sv, i + 1, 1):+.1f}%  retest after {k} sessions  lowest {(min(sv[i+1:i+63])/sv[i]-1)*100:+.1f}%  63 sessions {(sv[i+63]/sv[i]-1)*100:+.1f}%")
print('  closed below the crash-week low first in', n_retest, 'of', sum(1 for i in SIG if i + 63 < len(sv)))
def sim(longt, shortt=None, hold=62, lag=1, pos_stop=None, spx_exit=False):
    a = dict(load(longt)); b = dict(load(shortt)) if shortt else None
    days = [d for d in cal if d in a and (b is None or d in b)]; di = {d: i for i, d in enumerate(days)}
    res = []
    for i in SIG:
        d = cal[i]
        if d not in di or di[d] + lag + hold >= len(days): continue
        j = di[d] + lag; e = days[j]; out = None; stopped = False
        for k in range(j + 1, j + hold + 1):
            x = days[k]; pr = ((a[x] / a[e] - 1) - ((b[x] / b[e] - 1) if b else 0)) * 100
            if pos_stop is not None and pr <= -pos_stop: out = pr; stopped = True; break
            if spx_exit and sd[x] < sd[d]: out = pr; stopped = True; break
        res.append((d, pr if out is None else out, stopped))
    r = [x[1] for x in res]; i0 = di[cal[SIG[0]]] if cal[SIG[0]] in di else 0
    base = [((a[days[j + hold]] / a[days[j]] - 1) - ((b[days[j + hold]] / b[days[j]] - 1) if b else 0)) * 100 for j in range(max(i0, 0), len(days) - hold, 5)]
    h = len(r) // 2
    name = longt + ('' if not shortt else ' long / ' + shortt + ' short')
    rule = 'no stop' if pos_stop is None and not spx_exit else (f'{pos_stop}% stop' if pos_stop else 'exit on S&P close below the low')
    print(f"  {name:26s} {rule:34s} n={len(r):2d} mean {st.mean(r):+5.1f} median {st.median(r):+5.1f} up {sum(x > 0 for x in r):2d}/{len(r)} stopped {sum(x[2] for x in res):2d} worst {min(r):+6.1f} | any start mean {st.mean(base):+.1f} median {st.median(base):+.1f} up {sum(x > 0 for x in base) / len(base):.0%} | halves {st.mean(r[:h]):+.1f}/{st.mean(r[h:]):+.1f}")
print('\nB. Entry at the next close, 62 sessions, with and without a stop')
for L, S in (('SPY', None), ('QQQ', None), ('QQQ', 'XLU'), ('XLK', 'XLU'), ('XLK', 'XLP')):
    sim(L, S)
    for ps in (5, 7.5, 10): sim(L, S, pos_stop=ps)
    sim(L, S, spx_exit=True)
