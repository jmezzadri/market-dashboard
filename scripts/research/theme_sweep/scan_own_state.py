import sys; sys.path.insert(0,__import__("os").path.dirname(__file__))
from lib import *
spy=etf('SPY')
T={}
for t in 'XLE XLF XLK XLV XLI XLY XLP XLU XLB KRE XHB SMH XBI XME GDX IYT XRT QQQ IGV IYR KIE VLO MPC XAR XOP OIH'.split(): T[t+'/SPY']=ratio(etf(t),spy)
T['Val/Gro sectors']=ratio(basket(['XLE','XLF','XLI','XLB','XLP','XLU','XLV']),basket(['XLK','XLY']))
T['ex-tech 8 / SPY']=ratio(basket(['XLE','XLF','XLI','XLB','XLP','XLU','XLV','XLY']),spy)
T['XLP/XLY']=ratio(etf('XLP'),etf('XLY')); T['XLK/XLE']=ratio(etf('XLK'),etf('XLE'))
hdr,rows=ffread('/tmp/w/ff/F-F_Research_Data_Factors_daily.csv'); T['FF_HML']=cum([(d,r[hdr.index('HML')]) for d,r in rows]); T['FF_SMB']=cum([(d,r[hdr.index('SMB')]) for d,r in rows])
h6,r6=ffread('/tmp/w/ff/6_Portfolios_2x3_Daily.csv'); T['FF_BigV-BigG']=cum([(d,r[5]-r[3]) for d,r in r6])
def trail(s,n=126): return [(s[i][0],(s[i][1]/s[i-n][1]-1)*100) for i in range(n,len(s))]
out=[]
for k,s in T.items():
    tr=trail(s)
    cur=tr[-1][1]; allv=sorted(x for _,x in tr); curp=bisect.bisect_right(allv,cur)/len(allv)*100
    for lab,thr,hi in (('LOW5',5,False),('LOW10',10,False),('HIGH95',95,True),('HIGH90',90,True)):
        sd=exp_pct_days(tr,thr,minh=1260,hi=hi)
        for n in (63,126):
            r=evalsig(sd,s,n)
            if r: out.append((k,lab,n,r,curp))
for k,lab,n,r,curp in out:
    live=(lab.startswith('LOW') and curp<=float(lab[3:])) or (lab.startswith('HIGH') and curp>=float(lab[4:]))
    if not live: continue
    print(f"{k:16s} now={curp:5.1f}pct {lab:6s} {n:3d} n={r['n']:2d} mean={r['mean']:+6.1f} med={r['med']:+6.1f} win={r['win']:.0%} worst={r['worst']:+6.1f} | base={r['base']:+5.1f} bwin={r['basewin']:.0%} t={r['t']:+.1f} h1={r['h1']:+.1f} h2={r['h2']:+.1f}")
json.dump([(k,lab,n,r,curp) for k,lab,n,r,curp in out],open('s3.json','w'))
