import sys; sys.path.insert(0,'/tmp/md/scripts/research/theme_sweep')
from lib import *
spy=etf('SPY'); sd_=dict(spy)
# (E) challenge-log test: LQD/IEF ratio down >=2% over 21 sessions while SPY within 5% of its 252-day high
lq=ratio(etf('LQD'),etf('IEF')); ld=[d for d,_ in lq]; lv=[v for _,v in lq]
spl=[(d,v) for d,v in spy if d>=ld[0]]; spd=[d for d,_ in spl]; spv=[v for _,v in spl]; hi={spd[i]:max(spv[max(0,i-252):i+1]) for i in range(len(spd))}
sig=[ld[i] for i in range(21,len(lq)) if lv[i]/lv[i-21]-1<=-0.02 and ld[i] in hi and sd_[ld[i]]>=0.95*hi[ld[i]]]
print("LQD/IEF -2%/21s with SPY within 5% of high: days",len(sig), sorted(set(d[:7] for d in sig)))
cur=lv[-1]/lv[-22]-1; print("today LQD/IEF 21-session change", round(cur*100,2),"%  SPY vs 1y high", round(sd_[spd[-1]]/hi[spd[-1]]-1,4))
for n in (15,63,126):
    r=evalsig(sig,spy,n)
    if r: print(f"SPY {n}: n={r['n']} mean={r['mean']:+.1f} med={r['med']:+.1f} win={r['win']:.0%} worst={r['worst']:+.1f} | base={r['base']:+.1f} bwin={r['basewin']:.0%} t={r['t']:+.1f} h1={r['h1']:+.1f} h2={r['h2']:+.1f} eps={r['eps']}")
    else: print("SPY",n,"too few")
# (F) SMH: drawdown >=25% from a 252-day high reached within the last 110 sessions -> forward abs and rel
sm=etf('SMH'); smd=[d for d,_ in sm]; smv=[v for _,v in sm]
sig=[]
for i in range(252,len(sm)):
    hi_i=max(range(i-110,i+1), key=lambda j:smv[j])
    if smv[hi_i]>=max(smv[i-252:i+1]) and smv[i]/smv[hi_i]-1<=-0.25: sig.append(smd[i])
print("\nSMH -25% from a 1y high set within 110 sessions:",len(sig), sorted(set(d[:7] for d in sig)))
print("today SMH vs its high:", round(smv[-1]/max(smv[-110:])-1,3))
for n in (63,126):
    for nm,s in (('SMH',sm),('SMH/SPY',ratio(sm,spy))):
        r=evalsig(sig,s,n)
        if r: print(f"{nm} {n}: n={r['n']} mean={r['mean']:+.1f} med={r['med']:+.1f} win={r['win']:.0%} worst={r['worst']:+.1f} | base={r['base']:+.1f} bwin={r['basewin']:.0%} t={r['t']:+.1f} h1={r['h1']:+.1f} h2={r['h2']:+.1f} eps={r['eps']}")
# (G) gold -25% from an all-time high set within 200 sessions
g=ind('cmdty_gold'); gd=[d for d,_ in g]; gv=[v for _,v in g]
sig=[]
for i in range(200,len(g)):
    hi_i=max(range(i-200,i+1), key=lambda j:gv[j])
    if gv[hi_i]>=max(gv[:i+1]) and gv[i]/gv[hi_i]-1<=-0.25: sig.append(gd[i])
print("\nGold -25% from an ATH set within 200 sessions:",len(sig), sorted(set(d[:7] for d in sig)))
for n in (63,126):
    r=evalsig(sig,g,n)
    if r: print(f"gold {n}: n={r['n']} mean={r['mean']:+.1f} med={r['med']:+.1f} win={r['win']:.0%} | base={r['base']:+.1f} eps={r['eps']}")
    else: print("gold",n,"too few episodes:", len(episodes(sig,gd,n)))
