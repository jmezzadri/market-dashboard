"""Kill-tests run 2026-10-03: sterling spec-short fade, T-bond TFF standoff.
Method matches trend_vs_positioning.py. Data: cot_extra_2026-10-03.json.
Results and interpretation: results_2026-10-03.md."""
import json, os, bisect, statistics as st
HERE=os.path.dirname(os.path.abspath(__file__))
D=json.load(open(os.path.join(HERE,"cot_extra_2026-10-03.json")))
H=json.load(open(os.path.join(HERE,"..","..","..","public","indicator_history.json")))
FWD=63; LAG=3; MINW=156
def pct(w,x): return 100*sum(1 for y in w if y<=x)/len(w)
def series(key):
    px=[(p[0][:10],p[1]) for p in H[key]["points"] if p[1] is not None]
    return [d for d,_ in px],[x for _,x in px]
def episodes(rows, sel, gap=13):
    out=[]; last=None
    for k,r in enumerate(rows):
        if sel(r):
            if last is None or k-last>=gap: out.append(r)
            last=k
    return out
def run_gbp():
    cot=[(d,v) for d,v in D["gbp_noncomm_net_pct_oi"]]
    dates,v=series("fx_gbp"); rows=[]
    for i,(d,net) in enumerate(cot):
        if i<MINW: continue
        p=pct([n for _,n in cot[:i+1]],net)
        j=bisect.bisect_right(dates,d)+LAG
        if j<200 or j+FWD>=len(v): continue
        rows.append((d,p,v[j]>sum(v[j-200:j])/200,v[j+FWD]/v[j]-1))
    eps=episodes(rows,lambda r:r[1]<=15); base=[r[3] for r in rows]
    print("GBP <=15th -> long: n=%d mean %+.2f%% vs uncond %+.2f%%"%(len(eps),st.mean([e[3] for e in eps])*100,st.mean(base)*100))
def run_tbond():
    cot=D["tbond_tff"]["rows"]
    dates,v=series("ust_30y"); rows=[]
    for i,(d,hf,am) in enumerate(cot):
        if i<MINW: continue
        ph=pct([x[1] for x in cot[:i+1]],hf); pa=pct([x[2] for x in cot[:i+1]],am)
        j=bisect.bisect_right(dates,d)+LAG
        if j<200 or j+FWD>=len(v): continue
        rows.append((d,ph,pa,v[j+FWD]-v[j]))
    base=[r[3] for r in rows]
    for lbl,sel in [("HF>=85",lambda r:r[1]>=85),("AM<=15",lambda r:r[2]<=15),("standoff",lambda r:r[1]>=85 and r[2]<=15)]:
        eps=episodes(rows,sel)
        m=st.mean([e[3] for e in eps])*100 if eps else float("nan")
        print("T-bond %s: n=%d mean %+.0fbp vs uncond %+.0fbp"%(lbl,len(eps),m,st.mean(base)*100))
if __name__=="__main__":
    run_gbp(); run_tbond()
