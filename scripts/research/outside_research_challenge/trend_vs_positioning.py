"""Does the TREND change what a positioning extreme is worth?

Why this exists (Joe, 2026-10-02): outside research is there to challenge our
own work, not to be compared with it. Macro Ops trade WITH price: they buy
breakouts and sit in trends. Our published calls mostly FADE a positioning
extreme. Three of our seven calls were stopped or closed at a loss while they
were on the other side. So the question worth a backtest is not "who was
right" but: is our positioning edge conditional on the trend?

Method (fixed before looking at results)
- Weekly CFTC reports, full history (cot_history.json, from fetch_cot.py).
- Percentile of net position / open interest on an EXPANDING window (no
  look-ahead), minimum 156 weeks. Also the trailing 3-year percentile, because
  that is what the live site and the brief quote.
- Fade signals as published in the Trade Idea playbook: grains managed money
  >= 85th -> short; euro speculators <= 15th -> long.
- Trend at the signal: price against its own 200-session average.
  "With trend" = the fade points the same way as the trend.
- Outcome: position return over the next 63 sessions, measured from the first
  close AFTER the report date + 3 sessions (reports cover Tuesday, publish
  Friday). Episodes are de-overlapped: a new episode needs 13 clear weeks.
- Baseline: the same position's unconditional 63-session return, all weeks.
Prices are MacroTilt's own series (front-month futures for grains: roll gaps
are in there, LESSONS 4.37 — a known limit, stated, not hidden).
"""
import json, os, bisect, statistics as st
HERE=os.path.dirname(os.path.abspath(__file__))
H=json.load(open(os.path.join(HERE,"..","..","..","public","indicator_history.json")))
COT=json.load(open(os.path.join(HERE,"cot_history.json")))
CFG={"wheat":("cmdty_wheat",-1,"hi"),"corn":("cmdty_corn",-1,"hi"),"soybeans":("cmdty_soybeans",-1,"hi"),"euro":("fx_eur",+1,"lo")}
FWD=63; LAG=3
def pct(window,x): return 100*sum(1 for w in window if w<=x)/len(window)
def run(name, mode):
    key,side,tail=CFG[name]
    px=[(d,v) for d,v in H[key]["points"] if v]
    dates=[d for d,_ in px]; v=[x for _,x in px]
    rows=[]
    cot=COT[name]
    for i,(d,net) in enumerate(cot):
        if i<156: continue
        hist=[n for _,n in cot[:i+1]] if mode=="full" else [n for _,n in cot[max(0,i-155):i+1]]
        p=pct(hist,net)
        j=bisect.bisect_right(dates,d)+LAG
        if j<200 or j+FWD>=len(v): continue
        ma=sum(v[j-200:j])/200
        up=v[j]>ma
        r=side*(v[j+FWD]/v[j]-1)
        sig=(p>=85) if tail=="hi" else (p<=15)
        with_trend=(up and side>0) or ((not up) and side<0)
        rows.append((d,p,sig,with_trend,r))
    base=[r for *_,r in rows]
    def episodes(sel):
        out=[];last=None
        for k,row in enumerate(rows):
            if sel(row):
                if last is None or k-last>=13: out.append(row)
                last=k
        return out
    def line(label,eps):
        if not eps: return f"    {label:28} n=0"
        rs=[e[4] for e in eps]
        return f"    {label:28} n={len(rs):3}  mean {100*st.mean(rs):+6.2f}%  median {100*st.median(rs):+6.2f}%  win {100*sum(x>0 for x in rs)/len(rs):3.0f}%  worst {100*min(rs):+.1f}%"
    print(f"  [{mode} history] baseline (all weeks, same side): mean {100*st.mean(base):+.2f}%  median {100*st.median(base):+.2f}%  win {100*sum(x>0 for x in base)/len(base):.0f}%  weeks={len(base)}")
    print(line("fade, all episodes",episodes(lambda r:r[2])))
    print(line("fade WITH the trend",episodes(lambda r:r[2] and r[3])))
    print(line("fade AGAINST the trend",episodes(lambda r:r[2] and not r[3])))
    return rows
if __name__=="__main__":
    for name in CFG:
        key,side,tail=CFG[name]
        print(f"\n{name.upper()} — {'short' if side<0 else 'long'} when positioning {'>=85th' if tail=='hi' else '<=15th'} pctile, {FWD} sessions")
        for mode in ("full","3y"):
            rows=run(name,mode)
        cot=COT[name]; net=cot[-1][1]
        print(f"  NOW ({cot[-1][0]}): net {100*net:+.1f}% of open interest — {pct([n for _,n in cot],net):.0f}th pctile of full history, {pct([n for _,n in cot[-156:]],net):.0f}th of 3 years")
