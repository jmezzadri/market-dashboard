"""Challenge test 2026-11-10: a macro letter says a Nasdaq-100 close under its 200-day average
'confirms' the bearish case. Does a first close below the 200-day, after at least 63 sessions above it,
forecast lower prices? QQQ daily closes 1999-2026 (prices_eod via pull_prices.py), independent episodes,
next 21/63/126 sessions vs the unconditional return over the same sample; split by whether the
200-day itself is rising or falling at the cross; and the same test for SPY."""
import sys, json, statistics as st, math
def load(t): return json.load(open(f'/tmp/w/px/{t}.json  (pull with scripts/research/theme_sweep/pull_prices.py QQQ SPY)'))
def test(t):
    px=load(t); d=[x[0] for x in px]; v=[x[1] for x in px]
    ma=[None]*len(v)
    for i in range(200,len(v)): ma[i]=sum(v[i-200:i])/200
    eps=[]
    for i in range(263,len(v)):
        if v[i]<ma[i] and all(v[j]>=ma[j] for j in range(i-63,i)):
            eps.append(i)
    print(f"\n{t}: first close below the 200-day after >=63 sessions above it — {len(eps)} episodes since {d[263]}")
    print("  last episode:", d[eps[-1]] if eps else None, "| today:", d[-1], v[-1], "200d", round(ma[-1],2), "below?" , v[-1]<ma[-1])
    for n in (21,63,126):
        r=[(v[i+n]/v[i]-1)*100 for i in eps if i+n<len(v)]
        base=[(v[i+n]/v[i]-1)*100 for i in range(263,len(v)-n)]
        rising=[(v[i+n]/v[i]-1)*100 for i in eps if i+n<len(v) and ma[i]>ma[i-21]]
        falling=[(v[i+n]/v[i]-1)*100 for i in eps if i+n<len(v) and ma[i]<=ma[i-21]]
        half=len(r)//2
        print(f"  {n:3d} sessions: n={len(r)} mean {st.mean(r):+.1f}% median {st.median(r):+.1f}% win {sum(x>0 for x in r)/len(r):.0%} worst {min(r):+.1f} | baseline mean {st.mean(base):+.1f}% median {st.median(base):+.1f}% win {sum(x>0 for x in base)/len(base):.0%} | halves {st.mean(r[:half]):+.1f}/{st.mean(r[half:]):+.1f} | 200d rising n={len(rising)} mean {st.mean(rising) if rising else float('nan'):+.1f} | falling n={len(falling)} mean {st.mean(falling) if falling else float('nan'):+.1f}")
    print("  episodes:", [d[i][:7] for i in eps])
for t in ('QQQ','SPY'): test(t)
