"""Outside-research challenge test, 2026-10-27: low-grade credit near the bottom of its 63-session range while the S&P sits near the top of its.
Credit series: HYG price (daily 2007-), robustness HYG/IEF; also HY OAS weekly (2011-) +50bp in ~6 weeks variant.
Signal: RP(HYG)<=0.15 and RP(SPY)>=0.90. First trigger in any 21 sessions. Forward 15/63/126 SPY vs all days. Also max drawdown within 63."""
import sys; sys.path.insert(0,'/tmp/w/scripts')  # theme_sweep/lib.py copied to /tmp/w/scripts; prices under /tmp/w/px (pull_prices.py)
from lib import *
spy=etf('SPY'); hyg=etf('HYG'); ief=etf('IEF'); hi=ratio(hyg,ief)
def rp(s,i,w=63):
    v=[x for _,x in s[i-w:i+1]]; lo,hi_=min(v),max(v); return (s[i][1]-lo)/(hi_-lo) if hi_>lo else 0.5
sd=dict(spy); sc=[d for d,_ in spy]
def signal(cred,thr_c=0.15,thr_s=0.90):
    out=[]
    for i in range(63,len(cred)):
        d=cred[i][0]
        if d not in sd: continue
        j=sc.index(d)
        if j<63: continue
        if rp(cred,i)<=thr_c and rp(spy,j)>=thr_s: out.append(d)
    return out
def mdd(i,n):
    v=[x for _,x in spy[i:i+n+1]]; pk=v[0]; m=0
    for x in v:
        pk=max(pk,x); m=min(m,x/pk-1)
    return m*100
for lab,cred in (('HYG price',hyg),('HYG/IEF',hi)):
    for tc,ts in ((0.15,0.90),(0.25,0.85),(0.10,0.95)):
        days=signal(cred,tc,ts)
        eps=[i for i in episodes(days,sc,21) if i+126<len(spy)]
        if len(eps)<4: print(lab,tc,ts,'episodes',len(eps)); continue
        for n in (15,63,126):
            r=[(spy[i+n][1]/spy[i][1]-1)*100 for i in eps]
            base=[(spy[i+n][1]/spy[i][1]-1)*100 for i in range(2000,len(spy)-n)]
            dd=[mdd(i,n) for i in eps]; bdd=[mdd(i,n) for i in range(2000,len(spy)-n,5)]
            print(f"{lab:9} c<={tc} s>={ts} fwd{n:3d} n={len(r):2d} mean={st.mean(r):+5.1f} med={st.median(r):+5.1f} win={sum(x>0 for x in r)/len(r):.0%} worst={min(r):+5.1f} | base mean={st.mean(base):+5.1f} win={sum(x>0 for x in base)/len(base):.0%} | P(dd<=-5%)={sum(x<=-5 for x in dd)/len(dd):.0%} vs {sum(x<=-5 for x in bdd)/len(bdd):.0%}  eps={[sc[i] for i in eps][-6:]}")
# today's state
i=len(hyg)-1; j=len(spy)-1
print('TODAY rp(HYG)=',round(rp(hyg,i),2),'rp(HYG/IEF)=',round(rp(hi,len(hi)-1),2),'rp(SPY)=',round(rp(spy,j),2), hyg[-1], spy[-1])
