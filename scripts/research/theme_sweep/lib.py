import json, csv, bisect, statistics as st, math, datetime as dt, os
def fred(s):
    out=[]
    for i,r in enumerate(csv.reader(open(f'/tmp/w/fred/{s}.csv'))):
        if i==0: continue
        try: out.append((r[0],float(r[1])))
        except: pass
    return out
H=json.load(open('/tmp/d/indicator_history.json'))
def ind(k): return [(d,float(v)) for d,v in H[k]['points'] if v is not None]
def etf(t): return [(d,v) for d,v in json.load(open(f'/tmp/w/px/{t}.json'))]
def ffread(fn, cols=None):
    rows=[];hdr=None
    for line in open(fn, errors='ignore'):
        p=[x.strip() for x in line.strip().split(',')]
        if len(p)>1 and p[0]=='' and hdr is None: hdr=p[1:]; continue
        if hdr and len(p[0])==8 and p[0].isdigit():
            rows.append((f'{p[0][:4]}-{p[0][4:6]}-{p[0][6:]}',[float(x) for x in p[1:]]))
        elif hdr and rows and not p[0].isdigit(): break
    return hdr,rows
def cum(dates_rets):
    out=[];v=100.0
    for d,r in dates_rets: v*=1+r/100; out.append((d,v))
    return out
def ratio(a,b):
    db=dict(b); return [(d,v/db[d]) for d,v in a if d in db]
def basket(ts):
    ss=[dict(etf(t)) for t in ts]; days=sorted(set.intersection(*[set(s) for s in ss]))
    out=[];v=100.0;prev=None
    for d in days:
        if prev: v*=1+sum(s[d]/s[prev]-1 for s in ss)/len(ss)
        out.append((d,v)); prev=d
    return out
def episodes(state_days, cal, gap):
    idx={d:i for i,d in enumerate(cal)}; out=[];last=-10**9
    for d in state_days:
        i=idx.get(d)
        if i is None:
            j=bisect.bisect_left(cal,d)
            if j>=len(cal): continue
            i=j
        if i-last>=gap: out.append(i); last=i
    return out
def evalsig(state_days, series, n, start=None):
    cal=[d for d,_ in series]; val=[v for _,v in series]
    sd=[d for d in state_days if d>=cal[0] and (not start or d>=start)]
    if not sd: return None
    first=sd[0]
    eps=[i for i in episodes(sd,cal,n) if i+n<len(val)]
    if len(eps)<6: return None
    r=[(val[i+n]/val[i]-1)*100 for i in eps]
    i0=bisect.bisect_left(cal,first)
    base=[(val[i+n]/val[i]-1)*100 for i in range(i0,len(val)-n)]
    m=st.mean(r); b=st.mean(base); s=st.stdev(r)
    half=len(r)//2
    return dict(n=len(r),mean=m,med=st.median(r),win=sum(x>0 for x in r)/len(r),worst=min(r),best=max(r),base=b,basemed=st.median(base),basewin=sum(x>0 for x in base)/len(base),t=(m-b)/(s/math.sqrt(len(r))) if s else 0,h1=st.mean(r[:half]),h2=st.mean(r[half:]),eps=[(cal[i],round(x,1)) for i,x in zip(eps,r)])
def roll_pct_days(series,thr,w,hi=True):
    out=[];vals=[v for _,v in series]
    for i in range(w,len(series)):
        win=vals[i-w:i+1]; q=sum(1 for x in win if x<=vals[i])/len(win)*100
        if (q>=thr if hi else q<=thr): out.append(series[i][0])
    return out
def exp_pct_days(series,thr,minh=756,hi=True):
    srt=[];out=[]
    for d,v in series:
        bisect.insort(srt,v)
        if len(srt)>=minh:
            q=bisect.bisect_right(srt,v)/len(srt)*100
            if (q>=thr if hi else q<=thr): out.append(d)
    return out
