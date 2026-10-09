import sys; sys.path.insert(0,__import__("os").path.dirname(__file__))
from lib import *
import sys
# ---- themes
T={}
hdr,rows=ffread('/tmp/w/ff/F-F_Research_Data_Factors_daily.csv')
for k in ('SMB','HML','Mkt-RF'):
    j=hdr.index(k); T['FF_'+k]=cum([(d,r[j]) for d,r in rows])
h6,r6=ffread('/tmp/w/ff/6_Portfolios_2x3_Daily.csv')
print('6p hdr',h6, len(r6), r6[-1][0])
jl,jh=h6.index('BIG LoBM'),h6.index('BIG HiBM')
T['FF_BigValue-BigGrowth']=cum([(d,r[jh]-r[jl]) for d,r in r6])
sl,sh=h6.index('SMALL LoBM'),h6.index('SMALL HiBM')
T['FF_SmallValue-SmallGrowth']=cum([(d,r[sh]-r[sl]) for d,r in r6])
T['FF_BigValue_abs']=cum([(d,r[jh]) for d,r in r6]); T['FF_BigGrowth_abs']=cum([(d,r[jl]) for d,r in r6])
hm,rm=ffread('/tmp/w/ff/F-F_Momentum_Factor_daily.csv'); T['FF_MOM']=cum([(d,r[0]) for d,r in rm])
spy=etf('SPY')
for t in 'XLE XLF XLK XLV XLI XLY XLP XLU XLB XOP OIH KRE KBE XHB ITB SMH XBI XME GDX IYT XRT QQQ IBB IGV IYR KIE VLO MPC XAR TAN'.split():
    T[t+'/SPY']=ratio(etf(t),spy)
T['XLK/XLE']=ratio(etf('XLK'),etf('XLE')); T['SMH/IGV']=ratio(etf('SMH'),etf('IGV')); T['GDX/GLD']=ratio(etf('GDX'),etf('GLD'))
T['XLP/XLY']=ratio(etf('XLP'),etf('XLY')); T['HYG/IEF']=ratio(etf('HYG'),etf('IEF'))
T['Cyc/Def']=ratio(basket(['XLI','XLB','XLY','XLF']),basket(['XLP','XLU','XLV']))
T['ValueSect/GrowthSect']=ratio(basket(['XLE','XLF','XLI','XLB','XLP','XLU','XLV']),basket(['XLK','XLY']))
for t in ('SPY','TLT','GLD','QQQ','XLE'): T[t+'_abs']=etf(t)
# ---- signals
S={}
y=fred('DGS10'); yv=[v for _,v in y]
S['y10_surge']=[y[i][0] for i in range(252,len(y)) if yv[i]-yv[i-63]>=0.5 and yv[i]>=max(yv[i-252:i+1])-0.10]
S['y10_5yr_high']=[y[i][0] for i in range(1260,len(y)) if yv[i]>=max(yv[i-1260:i+1])-0.05]
S['real10_exp95']=exp_pct_days(fred('DFII10'),95)
o=fred('DCOILWTICO'); ov=[v for _,v in o]
S['oil_3y90_and_up20']=[o[i][0] for i in range(756,len(o)) if ov[i-126]>0 and ov[i]/ov[i-126]>=1.2 and sum(1 for x in ov[i-756:i+1] if x<=ov[i])/757>=0.9]
S['oil_yoy30']=[o[i][0] for i in range(252,len(o)) if ov[i-252]>0 and ov[i]/ov[i-252]>=1.3]
S['diesel_crack_exp95']=exp_pct_days(ind('cmdty_diesel_crack'),95)
c=dict(fred('T10Y2Y'))
S['bear_steepen']=[y[i][0] for i in range(63,len(y)) if yv[i]-yv[i-63]>=0.4 and y[i][0] in c and y[i-63][0] in c and c[y[i][0]]-c[y[i-63][0]]>=0.2]
S['usd_1y_high']=roll_pct_days(ind('usd'),98,252)
sp=dict(ind('spx_index')); spl=ind('spx_index'); spv=[v for _,v in spl]; hi={spl[i][0]:max(spv[max(0,i-252):i+1]) for i in range(len(spl))}
S['breadth_div']=[d for d,v in ind('spx_above_50ema') if d in sp and sp[d]>=0.98*hi[d] and v<40]
tp=fred('THREEFYTP10'); S['termprem_exp95']=exp_pct_days(tp,95,minh=2520)
vx=dict(fred('VIXCLS')); mv=ind('move'); mvv=[v for _,v in mv]
S['lowVIX_highMOVE']=[mv[i][0] for i in range(252,len(mv)) if mv[i][0] in vx and vx[mv[i][0]]<16 and sum(1 for x in mvv[i-252:i+1] if x<=mvv[i])/253>=0.9]
a=set(S['y10_surge']); S['y10surge_AND_oilhigh']=[d for d in S['oil_3y90_and_up20'] if d in a]
b=set(S['oil_yoy30']); S['y10_5yrhigh_AND_oil_yoy30']=[d for d in S['y10_5yr_high'] if d in b]
for k,v in S.items(): print('SIG',k,len(v),v[0] if v else None,v[-1] if v else None)
res=[]
for sk,sd in S.items():
    for tk,ts in T.items():
        for n in (63,126):
            r=evalsig(sd,ts,n)
            if r: res.append((sk,tk,n,r))
json.dump([(a,b,c,d) for a,b,c,d in res],open('scan.json','w'))
res.sort(key=lambda x:-abs(x[3]['t']))
print(len(res),'tests')
for sk,tk,n,r in res[:70]:
    print(f"{sk:28s} {tk:26s} {n:3d} n={r['n']:2d} mean={r['mean']:+6.1f} med={r['med']:+6.1f} win={r['win']:.0%} worst={r['worst']:+6.1f} | base={r['base']:+5.1f} bwin={r['basewin']:.0%} t={r['t']:+.1f} h1={r['h1']:+.1f} h2={r['h2']:+.1f}")
