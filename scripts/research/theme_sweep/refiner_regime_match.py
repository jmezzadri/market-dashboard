import sys; sys.path.insert(0,__import__("os").path.dirname(__file__))
from lib import *
spy=etf('SPY')
dc=set(exp_pct_days(ind('cmdty_diesel_crack'),95))
for t in ('VLO','MPC'):
    s=etf(t); r=ratio(s,spy)
    tr=[(s[i][0],(s[i][1]/s[i-63][1]-1)*100) for i in range(63,len(s))]
    print(t,'63d abs now',round(tr[-1][1],1))
    for thr in (20,30,40):
        ran=set(d for d,x in tr if x>=thr)
        for lab,sd in ((f'crack95 & {t} up>={thr}% in 63d',sorted(dc&ran)),(f'{t} up>={thr}% in 63d (any crack)',sorted(ran))):
            for n in (63,126):
                for nm,ser in (('abs',s),('vsSPY',r)):
                    e=evalsig(sd,ser,n) if len(sd) else None
                    if e: print(f"  {lab:38s} {nm:5s} {n} n={e['n']} mean={e['mean']:+.1f} med={e['med']:+.1f} win={e['win']:.0%} worst={e['worst']:+.1f} | base={e['base']:+.1f} bwin={e['basewin']:.0%}", e['eps'] if nm=='abs' and n==63 else '')
                    elif nm=='abs' and n==63: print(f"  {lab:38s} episodes<6: days={len(sd)} first={sd[:1]} ")
