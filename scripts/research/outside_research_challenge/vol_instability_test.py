"""Outside-research challenge, 2026-11-17.

Question: a volatility letter argues that when implied volatility sits BELOW
realized volatility and the VIX curve is flat (spot VIX about equal to the
three-month), the calm is unstable and a drawdown follows. Does it, on our data?

Signal (all from macrotilt.com/indicator_history.json, 2006-07 on):
  VIX minus 21-session realized volatility of the S&P 500 (annualized) <= 0
  AND VIX / VIX3M >= 0.98
Outcome: S&P 500 return and worst close-to-close drawdown over the next 5, 10,
21 and 63 sessions, against every start in the same sample. Independent
episodes (a new episode needs the hold to have elapsed). Split into halves,
and split by whether the index was above its 200-day average.
"""
import json, math, statistics as st, sys
IH = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/d/indicator_history.json'))
def ser(k): return {d: v for d, v in IH[k]['points'] if v is not None}
spx, vix, ts = ser('spx_index'), ser('vix'), ser('vix_ts')
days = sorted(d for d in spx if d in vix and d in ts)
px = [spx[d] for d in days]
def rv(i):
    r = [math.log(px[j] / px[j - 1]) for j in range(i - 20, i + 1)]
    return 100 * st.pstdev(r) * math.sqrt(252)
def ma(i, n=200): return sum(px[i - n + 1:i + 1]) / n
sig = [i for i in range(200, len(days)) if vix[days[i]] - rv(i) <= 0 and ts[days[i]] >= 0.98]
print('sample', days[0], days[-1], 'sessions', len(days), 'signal days', len(sig))
print('today', days[-1], 'VIX', vix[days[-1]], 'realized', round(rv(len(days) - 1), 1), 'curve', ts[days[-1]],
      'above 200d' , px[-1] > ma(len(px) - 1))
def fwd(i, h): return 100 * (px[i + h] / px[i] - 1)
def dd(i, h): return 100 * (min(px[i + 1:i + h + 1]) / px[i] - 1)
for h in (5, 10, 21, 63):
    eps, last = [], -10**9
    for i in sig:
        if i - last >= h and i + h < len(px): eps.append(i); last = i
    base = range(200, len(px) - h)
    def line(name, idx):
        if not idx: return f'{name}: none'
        r = [fwd(i, h) for i in idx]; d = [dd(i, h) for i in idx]
        return (f'{name}: n={len(idx)} mean {st.mean(r):+.2f} median {st.median(r):+.2f} up {100*sum(x>0 for x in r)/len(r):.0f}% '
                f'| median worst drawdown {st.median(d):+.2f} | share with a 5%+ drawdown {100*sum(x<=-5 for x in d)/len(d):.0f}%')
    print(f'--- hold {h} sessions')
    print(' ', line('signal', eps)); print(' ', line('any start', list(base)))
    half = len(eps) // 2
    print(' ', line('first half', eps[:half])); print(' ', line('second half', eps[half:]))
    print(' ', line('index above 200-day', [i for i in eps if px[i] > ma(i)]))
    print(' ', line('index below 200-day', [i for i in eps if px[i] <= ma(i)]))
    if h == 21: print('  episodes:', [(days[i], round(fwd(i, h), 1)) for i in eps][-16:])
