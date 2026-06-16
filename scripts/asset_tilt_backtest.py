"""asset_tilt_backtest.py — Asset Tilt calibration + validation harness.

Implements ASSET_TILT_METHODOLOGY.md (v1):
  * 4 sleeves: macro-regime 45 / momentum 25 / relative-strength 20 / valuation 10
  * cross-sectional z-ranking -> dollar-neutral active tilts clipped [-4%, +6%]
  * weekly (Friday) rebalance, 5 bps/side cost
  * macro-regime sleeve has TWO distinct beta uses (never conflated):
      - BACKTEST betas: per-sector point-in-time, EXPANDING window, re-estimated
        at most ANNUALLY (once per calendar year, using only data <= that Jan 1)
        with a point-in-time sign-stability gate (split the available history
        <= the estimation date into two halves; keep beta only if its sign
        agrees across both halves, else 0). The most-recent annual estimate
        <= each rebalance Friday is applied. NO future data sizes any tilt.
      - CALIBRATION betas: full-sample sign-stable (deployed model parameters,
        gated across disjoint sub-periods 1996-2007/2008-2015/2016-2026). These
        are written to the calibration JSON; they do NOT drive the validation.
  * 2-axis engine: stress = MOVE-alone vs blend(MOVE,VIX,credit) chosen by
    forward-drawdown AUC; Risk-On/Watch/Risk-Off cut-points refit on 1996+;
    rate-regime defensive sleeve (cash/gold/short-vs-long Treasuries).
    The engine is independent of the macro betas above and is unchanged.
  * per-sleeve + per-factor AUC at 1/3/6/12m (0.55 gate); sleeve correlation
  * benchmarks: SPY and equal-weight sectors; tilted-sector AND full engine

NO look-ahead: macro factors publication-lagged; z-scores trailing/expanding
(past-only); BACKTEST betas use ONLY data with index <= the annual estimation
date (expanding, point-in-time sign gate); weekly weights use only data through
that Friday and trade the next bar. The full-sample betas are a separate
calibration artifact and are never used to compute the validation numbers.
"""
import os, re, json, io, sys, time, math
import urllib.request
from datetime import datetime
import numpy as np
import pandas as pd

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
COST_BPS = 5.0
TILT_MIN, TILT_MAX = -0.04, 0.06
SLEEVE_W = {"macro": 0.45, "momentum": 0.25, "relstr": 0.20, "valuation": 0.10}
START = "1996-01-01"

SECTOR_ETFS = ["XLK","XLF","XLE","XLI","XLY","XLP","XLV","XLU","XLB","XLRE","XLC"]
DEFENSIVES = ["TLT","IEF","SHY","BIL","GLD"]
BENCH = ["SPY"]

SPY_SECTOR_WEIGHTS = {
    "XLK": 0.315, "XLF": 0.130, "XLV": 0.105, "XLY": 0.103, "XLC": 0.095,
    "XLI": 0.082, "XLP": 0.058, "XLE": 0.036, "XLU": 0.025, "XLRE": 0.022, "XLB": 0.019,
}

FRED_LAG = {"DGS10":1,"T10Y2Y":1,"DFII10":1,"T10YIE":1,"ANFCI":7,"BAA10Y":1}
MACRO_FACTORS = ["tenY","curve","realrate","breakeven","anfci","credit","dollar","coppergold","oil"]

# --------------------------- data loading ---------------------------
def mgmt(sql, t=180):
    U = os.environ["SUPABASE_URL"]; TOK = os.environ["SUPABASE_ACCESS_TOKEN"]
    ref = re.sub(r'^https?://','',U).split('.')[0]
    rq = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(), method="POST",
        headers={"Authorization":"Bearer "+TOK,"Content-Type":"application/json","User-Agent":UA})
    with urllib.request.urlopen(rq, timeout=t) as x:
        return json.loads(x.read().decode())

def pull_prices_supabase(tickers, batch=12):
    """Production path: adjusted EOD closes from public.prices_eod (Supabase)."""
    frames = []
    for i in range(0, len(tickers), batch):
        chunk = tickers[i:i+batch]
        arr = "ARRAY[" + ",".join("'"+t.replace("'","''")+"'" for t in chunk) + "]"
        sql = (f"set statement_timeout='120s';"
               f"select ticker, to_char(trade_date,'YYYY-MM-DD') d, close::float8 c "
               f"from public.prices_eod where ticker = ANY({arr}) "
               f"and trade_date >= '{START}' and close is not null order by ticker, trade_date")
        rows = []
        for _t in range(3):
            try: rows = mgmt(sql); break
            except Exception as e:
                if _t==2: print("  prices batch FAILED", chunk, repr(e)[:120])
                else: time.sleep(4)
        for r in rows:
            frames.append((r["ticker"], r["d"], float(r["c"])))
    if not frames: return pd.DataFrame()
    df = pd.DataFrame(frames, columns=["ticker","date","close"])
    px = df.pivot_table(index="date", columns="ticker", values="close")
    px.index = pd.to_datetime(px.index)
    return px.sort_index()

def pull_prices_yf(tickers):
    """Local-run path: yfinance adjusted daily closes (same split/div-adjusted
    series prices_eod stores). Used when Supabase env is absent."""
    import yfinance as yf
    df = yf.download(list(tickers), start=START, auto_adjust=True,
                     progress=False, threads=True)
    if df is None or len(df)==0: return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        lvl0 = df.columns.get_level_values(0)
        close = df["Close"] if "Close" in lvl0 else df.xs("Adj Close", axis=1, level=0)
    else:
        # single ticker -> flat columns
        col = "Close" if "Close" in df.columns else df.columns[0]
        close = df[[col]].rename(columns={col: tickers[0]})
    close.index = pd.to_datetime(close.index)
    keep = [c for c in close.columns if c in set(tickers)]
    return close[keep].sort_index()

def pull_prices(tickers, batch=12):
    """Prefer prices_eod (Supabase) when configured; otherwise yfinance.
    yfinance closes are split/dividend-adjusted, matching prices_eod."""
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ACCESS_TOKEN"):
        print("  price source: prices_eod (Supabase)")
        px = pull_prices_supabase(tickers, batch)
        if not px.empty: return px
        print("  Supabase returned no rows; falling back to yfinance")
    print("  price source: yfinance (adjusted closes, == prices_eod)")
    return pull_prices_yf(tickers)

def _http_get(url, timeout=30, tries=4):
    """Resilient GET. urllib/requests and default curl can hang on this host's
    egress (IPv6/HTTP-2 negotiation stalls), so fetch via curl forced to IPv4
    with retries. Returns response bytes. Pure transport — does not alter the
    data source (same FRED public csv / macrotilt.com json)."""
    import subprocess
    last=None
    for k in range(tries):
        try:
            p=subprocess.run(["curl","-s4","--http1.1","-m",str(timeout),
                              "-A","curl/8","-L",url],
                             capture_output=True)
            if p.returncode==0 and p.stdout:
                return p.stdout
            last=f"rc={p.returncode} stderr={p.stderr.decode('utf-8','replace')[:80]}"
        except Exception as e:
            last=repr(e)[:120]
        time.sleep(2+2*k)
    raise RuntimeError(f"GET failed after {tries} tries: {url} :: {last}")

def _fred(series_id):
    raw = _http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}", timeout=30).decode("utf-8","replace")
    df = pd.read_csv(io.StringIO(raw)); df.columns = ["date","v"]
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["v"] = pd.to_numeric(df["v"], errors="coerce")
    return df.dropna(subset=["date"]).set_index("date")["v"].sort_index()

def _site_series(key):
    if not hasattr(_site_series, "_cache"):
        _site_series._cache = json.loads(_http_get("https://macrotilt.com/indicator_history.json", timeout=60).decode("utf-8","replace"))
    d = _site_series._cache.get(key)
    if d is None: return pd.Series(dtype=float)
    pts = d.get("points", []) if isinstance(d, dict) else d
    if not pts: return pd.Series(dtype=float)
    idx = pd.to_datetime([p[0] for p in pts])
    vals = pd.to_numeric([p[1] for p in pts], errors="coerce")
    return pd.Series(vals, index=idx).sort_index()

def apply_lag(s, biz_days):
    if s is None or s.empty: return pd.Series(dtype=float)
    s = s[~s.index.duplicated(keep="last")]
    bidx = pd.bdate_range(s.index.min(), pd.Timestamp.today())
    return s.reindex(bidx).ffill().shift(biz_days)

def expanding_z(s, min_obs=252):
    s = s.astype(float)
    mu = s.expanding(min_periods=min_obs).mean()
    sd = s.expanding(min_periods=min_obs).std()
    z = (s - mu) / sd.replace(0, np.nan)
    return z.clip(-4, 4)

def load_macro():
    raw = {}
    raw["tenY"]      = apply_lag(_fred("DGS10"),  FRED_LAG["DGS10"])
    raw["curve"]     = apply_lag(_fred("T10Y2Y"), FRED_LAG["T10Y2Y"])
    raw["realrate"]  = apply_lag(_fred("DFII10"), FRED_LAG["DFII10"])
    raw["breakeven"] = apply_lag(_fred("T10YIE"), FRED_LAG["T10YIE"])
    raw["anfci"]     = apply_lag(_fred("ANFCI"),  FRED_LAG["ANFCI"])
    raw["credit"]    = apply_lag(_fred("BAA10Y"), FRED_LAG["BAA10Y"])
    d_new = _fred("DTWEXBGS"); d_old = _fred("DTWEXB")
    overlap = d_old.index.intersection(d_new.index)
    ratio = float((d_new.reindex(overlap)/d_old.reindex(overlap)).median()) if len(overlap)>20 else 1.0
    pre = (d_old*ratio)[(d_old*ratio).index < d_new.index.min()]
    dollar = pd.concat([pre, d_new]).sort_index()
    dollar = dollar[~dollar.index.duplicated(keep="last")]
    raw["dollar"] = apply_lag(dollar, 1)
    print(f"  dollar splice ratio={ratio:.4f} deep from {dollar.index.min().date()}")
    cg = _site_series("copper_gold")
    if cg.empty:
        cu=_site_series("cmdty_copper"); au=_site_series("cmdty_gold")
        if not cu.empty and not au.empty: cg=(cu/au).dropna()
    raw["coppergold"] = apply_lag(cg, 1)
    raw["oil"]        = apply_lag(_site_series("cmdty_oil"), 1)
    factors = {}
    for k,s in raw.items():
        if s is None or s.empty: print(f"  WARN factor {k} empty"); continue
        factors[k] = expanding_z(s)
        nz = factors[k].dropna()
        if len(nz): print(f"  factor {k}: z {nz.index.min().date()}->{nz.index.max().date()} n={len(nz)}")
    return factors

def load_stress():
    out = {"move": expanding_z(apply_lag(_site_series("move"),1)),
           "vix":  expanding_z(apply_lag(_fred("VIXCLS"),1)),
           "credit": expanding_z(apply_lag(_fred("BAA10Y"),1))}
    for k,s in out.items():
        nz=s.dropna()
        if len(nz): print(f"  stress {k}: from {nz.index.min().date()} n={len(nz)}")
    return out

# --------------------------- metrics ---------------------------
def auc(scores, labels):
    scores=np.asarray(scores,float); labels=np.asarray(labels,float)
    m=np.isfinite(scores)&np.isfinite(labels); scores,labels=scores[m],labels[m]
    pos=labels==1; neg=labels==0; npos=pos.sum(); nneg=neg.sum()
    if npos==0 or nneg==0: return np.nan
    uniq,inv,counts=np.unique(scores,return_inverse=True,return_counts=True)
    csum=np.cumsum(counts); start=csum-counts; avg=(start+csum+1)/2.0
    ranks=avg[inv]; sum_pos=ranks[pos].sum()
    return (sum_pos - npos*(npos+1)/2.0)/(npos*nneg)

def perf_stats(daily_ret):
    r=pd.Series(daily_ret).dropna()
    if len(r)<30: return dict(cagr=float("nan"),sharpe=float("nan"),maxdd=float("nan"),n=len(r))
    eq=(1+r).cumprod(); yrs=len(r)/252.0
    cagr=eq.iloc[-1]**(1/yrs)-1
    sharpe=(r.mean()/r.std())*math.sqrt(252) if r.std()>0 else float("nan")
    dd=(eq/eq.cummax()-1).min()
    return dict(cagr=float(cagr),sharpe=float(sharpe),maxdd=float(dd),n=int(len(r)))

def spearman(a,b):
    a=pd.Series(a); b=pd.Series(b); m=a.notna()&b.notna()
    return float(a[m].rank().corr(b[m].rank())) if m.sum()>=10 else float("nan")

def forward_excess(px_sectors, spy, fwd_days):
    ex = np.log(px_sectors).diff().sub(np.log(spy).diff(), axis=0)
    return ex.rolling(fwd_days).sum().shift(-fwd_days)

# --------------------------- beta sign-stability ---------------------------
def sign_stability_gate(px_sectors, spy, factors, sectors, fwd_days=63):
    subs=[("1996-2007","1996-01-01","2007-12-31"),
          ("2008-2015","2008-01-01","2015-12-31"),
          ("2016-2026","2016-01-01","2026-12-31")]
    fwd=forward_excess(px_sectors,spy,fwd_days)
    fac_df=pd.DataFrame({k:v for k,v in factors.items()})
    sub_betas={n:{} for n,_,_ in subs}
    for name,a,b in subs:
        for s in sectors:
            if s not in fwd.columns: continue
            sub=pd.concat([fwd[s].rename("y"),fac_df],axis=1)
            sub=sub[(sub.index>=a)&(sub.index<=b)].dropna()
            if len(sub)<150: continue
            for f in factors:
                if f not in sub.columns or np.std(sub[f].values)<1e-9: continue
                bb=np.cov(sub[f].values,sub["y"].values,ddof=0)[0,1]/np.var(sub[f].values)
                sub_betas[name].setdefault(s,{})[f]=float(bb)
    full={}
    for s in sectors:
        if s not in fwd.columns: continue
        sub=pd.concat([fwd[s].rename("y"),fac_df],axis=1).dropna()
        for f in factors:
            if f not in sub.columns or np.std(sub[f].values)<1e-9: continue
            full.setdefault(s,{})[f]=float(np.cov(sub[f].values,sub["y"].values,ddof=0)[0,1]/np.var(sub[f].values))
    gated={}; kept=dropped=total=0; examples=[]
    for s in sectors:
        gated[s]={}
        for f in factors:
            signs=[]
            for name,_,_ in subs:
                v=sub_betas[name].get(s,{}).get(f)
                if v is not None and abs(v)>1e-9: signs.append(np.sign(v))
            total+=1
            if len(signs)>=2 and len(set(signs))==1 and s in full and f in full[s]:
                gated[s][f]=full[s][f]; kept+=1; examples.append((s,f,full[s][f]))
            else: dropped+=1
    return gated, {"kept":kept,"dropped":dropped,"total":total,"sub_betas":sub_betas,"examples":examples}

# --------------- point-in-time betas for the BACKTEST (no look-ahead) ---------------
def _pit_gated_betas(fwd, fac_df, factors, sectors, asof_ts,
                     fwd_days=63, min_obs=504, min_half=150):
    """Betas estimated using ONLY information knowable at asof_ts (expanding
    window), with a point-in-time sign-stability gate: split the available
    (past) history into two equal halves and keep the beta only if its sign
    agrees in BOTH halves; otherwise 0. Sectors/factors with too little accrued
    history -> 0. The forward-excess label at date t embeds returns through
    t+fwd_days, so a row is only usable once its forward window has completed;
    we therefore require t + fwd_days business days <= asof_ts (no peeking past
    the estimation date). Returns (gated_dict, n_kept)."""
    out={}; kept=0
    # latest label-date whose 63d forward window has fully completed by asof
    label_cutoff = asof_ts - pd.tseries.offsets.BDay(fwd_days)
    avail=pd.concat([fwd.add_suffix("__y"), fac_df], axis=1)
    avail=avail[avail.index<=label_cutoff]
    for s in sectors:
        ycol=f"{s}__y"
        if ycol not in avail.columns: continue
        sec=avail[[ycol]+[f for f in factors if f in avail.columns]].dropna()
        n=len(sec)
        if n<min_obs: continue            # not enough accrued history yet
        mid=n//2
        h1=sec.iloc[:mid]; h2=sec.iloc[mid:]
        y_full=sec[ycol].values
        for f in factors:
            if f not in sec.columns: continue
            xf=sec[f].values
            if np.std(xf)<1e-9: continue
            b_full=np.cov(xf,y_full,ddof=0)[0,1]/np.var(xf)
            # point-in-time sign gate across the two halves of PAST history
            ok=True
            for h in (h1,h2):
                if len(h)<min_half: ok=False; break
                xh=h[f].values; yh=h[ycol].values
                if np.std(xh)<1e-9: ok=False; break
                bh=np.cov(xh,yh,ddof=0)[0,1]/np.var(xh)
                if abs(bh)<=1e-9 or np.sign(bh)!=np.sign(b_full): ok=False; break
            if ok:
                out.setdefault(s,{})[f]=float(b_full); kept+=1
    return out, kept

def pit_beta_panels(px_sectors, spy, factors, sectors, fwd_days=63):
    """Build one gated beta panel per calendar year, each estimated on data
    <= that year's Jan 1 (expanding, point-in-time sign gate). Returns a list
    of (asof_timestamp, gated_betas, n_kept) sorted ascending by date. The
    weekly builder picks the most-recent panel <= each rebalance Friday."""
    fwd=forward_excess(px_sectors,spy,fwd_days)
    fac_df=pd.DataFrame({k:v for k,v in factors.items()})
    yr0=int(max(px_sectors.index.min().year, pd.Timestamp(START).year))
    yr1=int(px_sectors.index.max().year)
    panels=[]
    for y in range(yr0, yr1+1):
        asof=pd.Timestamp(f"{y}-01-01")
        gated, kept = _pit_gated_betas(fwd, fac_df, factors, sectors, asof, fwd_days=fwd_days)
        panels.append((asof, gated, kept))
    return panels

def select_panel(panels, fri):
    """Most-recent annual panel with asof <= fri (None if none yet)."""
    chosen=None
    for asof, gated, kept in panels:
        if asof<=fri: chosen=gated
        else: break
    return chosen if chosen is not None else {}

# --------------------------- sleeve scoring (weekly, PIT) ---------------------------
def zscore_xs(d):
    v=d.astype(float); mu=v.mean(); sd=v.std(ddof=0)
    return v*0.0 if (not np.isfinite(sd) or sd==0) else (v-mu)/sd

def build_weekly(px_all, spy, factors, beta_panels, sectors):
    """Weekly dollar-neutral tilts. The macro sleeve uses POINT-IN-TIME betas:
    at each Friday the most-recent annual beta panel with asof <= Friday is
    applied (each panel estimated only on data knowable by its asof). All other
    sleeves, z-scoring, weights, clipping and dollar-neutralisation are
    unchanged from the prior (full-sample-beta) build."""
    px=px_all[sectors].copy()
    ret_12_1=px.shift(21)/px.shift(252)-1.0
    dist200=px/px.rolling(200).mean()-1.0
    r3=px/px.shift(63)-1.0; r6=px/px.shift(126)-1.0
    s3=spy/spy.shift(63)-1.0; s6=spy/spy.shift(126)-1.0
    rs3=r3.sub(s3,axis=0); rs6=r6.sub(s6,axis=0)
    fac_df=pd.DataFrame({k:v for k,v in factors.items()})
    fridays=[f for f in pd.bdate_range(px.index.min(),px.index.max(),freq="W-FRI") if f>=pd.Timestamp("1996-06-01")]
    rows={}
    w=SLEEVE_W.copy(); val_w=w.pop("valuation"); tot=w["macro"]+w["momentum"]+w["relstr"]
    w={k:v+val_w*v/tot for k,v in w.items()}
    for fri in fridays:
        def asof(df):
            sub=df[df.index<=fri]; return sub.iloc[-1] if len(sub) else None
        mo_a=asof(ret_12_1); mo_b=asof(dist200); rs_a=asof(rs3); rs_b=asof(rs6); fz=asof(fac_df)
        if mo_a is None or rs_a is None or fz is None: continue
        gated_betas=select_panel(beta_panels, fri)   # point-in-time: most-recent annual panel <= fri
        macro_raw={}
        for s in sectors:
            bs=gated_betas.get(s,{}); val=0.0; any_f=False
            for f,b in bs.items():
                z=fz.get(f,np.nan)
                if np.isfinite(z): val+=b*z; any_f=True
            macro_raw[s]=val if any_f else np.nan
        macro_z=zscore_xs(pd.Series(macro_raw).reindex(sectors))
        mom_raw=(zscore_xs(mo_a.reindex(sectors))+zscore_xs(mo_b.reindex(sectors)))/2.0
        rs_raw=(zscore_xs(rs_a.reindex(sectors))+zscore_xs(rs_b.reindex(sectors)))/2.0
        comp=(w["macro"]*macro_z.fillna(0.0)+w["momentum"]*mom_raw.fillna(0.0)+w["relstr"]*rs_raw.fillna(0.0))
        c=comp-comp.mean()
        tilt=(c*0.03).clip(TILT_MIN,TILT_MAX)
        tilt=tilt-tilt.mean()
        rows[fri]=tilt
    return pd.DataFrame(rows).T.reindex(columns=sectors)

# --------------------------- stress signal + engine ---------------------------
def _fwd_dd(spy, hd):
    fdd=pd.Series(index=spy.index,dtype=float); arr=spy.values
    for i in range(len(arr)-hd):
        win=arr[i:i+hd+1]; run=np.maximum.accumulate(win)
        fdd.iloc[i]=(win/run-1).min()
    return fdd

def choose_stress(stress, spy):
    move=stress["move"]
    blend=pd.concat([stress["move"],stress["vix"],stress["credit"]],axis=1).mean(axis=1); blend.name="blend"
    horizons={"h1":21,"h3":63,"h6":126,"h12":252}
    auc_tab={"MOVE_only":{}, "blend":{}}
    for hn,hd in horizons.items():
        fdd=_fwd_dd(spy,hd); med=fdd.median(); label=(fdd<med).astype(float)
        for nm,sig in (("MOVE_only",move),("blend",blend)):
            al=pd.concat([sig.rename("s"),label.rename("l")],axis=1).dropna()
            auc_tab[nm][hn]=round(float(auc(al["s"],al["l"])),4)
    mm=np.nanmean(list(auc_tab["MOVE_only"].values())); mb=np.nanmean(list(auc_tab["blend"].values()))
    chosen="blend" if mb>mm else "MOVE_only"; sig=blend if chosen=="blend" else move
    fdd3=_fwd_dd(spy,63)
    al=pd.concat([sig.rename("s"),fdd3.rename("dd")],axis=1).dropna()
    best=None
    for ron in np.arange(0.45,0.75,0.05):
        for roff in np.arange(0.80,0.96,0.03):
            if roff<=ron: continue
            lo=al["s"].quantile(ron); hi=al["s"].quantile(roff)
            on=al[al["s"]<=lo]["dd"].mean(); watch=al[(al["s"]>lo)&(al["s"]<=hi)]["dd"].mean(); off=al[al["s"]>hi]["dd"].mean()
            monotone=(on>=watch>=off); score=(on-off)+(0.02 if monotone else 0)
            if best is None or score>best[0]: best=(score,float(lo),float(hi),float(ron),float(roff))
    _,lo,hi,ron,roff=best
    return chosen,sig,{"risk_on_max":lo,"watch_max":hi,"risk_on_pct":round(ron,3),"watch_pct":round(roff,3)},auc_tab

def rate_regime():
    tenY=apply_lag(_fred("DGS10"),1); chg=tenY-tenY.shift(63)
    pct=chg.rolling(252*5,min_periods=252).apply(lambda w:(w[-1]>=w).mean(),raw=True)
    reg=pd.Series(index=pct.index,dtype=object)
    reg[pct>=0.70]="inflationary"; reg[pct<=0.30]="deflationary"; reg[(pct>0.30)&(pct<0.70)]="neutral"
    bands={"inflationary":{"BIL":0.5,"GLD":0.3,"SHY":0.2},
           "deflationary":{"BIL":0.2,"GLD":0.3,"TLT":0.5},
           "neutral":{"BIL":0.34,"GLD":0.33,"IEF":0.33}}
    return reg.ffill(), bands

def daily_from_weekly_tilts(tilts, px_sectors, spy):
    base=pd.Series(SPY_SECTOR_WEIGHTS).reindex(px_sectors.columns).fillna(0); base=base/base.sum()
    sret=px_sectors.pct_change()
    tilts2=tilts.reindex(sret.index,method="ffill").shift(1)
    full_w=tilts2.add(base,axis=1); full_w=full_w.div(full_w.sum(axis=1),axis=0)
    gross=(full_w*sret).sum(axis=1)
    dt=tilts.diff().abs().sum(axis=1); turnover_weekly=float(dt.mean())
    cost=pd.Series(0.0,index=gross.index)
    for fri,tval in dt.items():
        nxt=gross.index[gross.index>fri]
        if len(nxt): cost.loc[nxt[0]]+=(tval*COST_BPS/1e4)
    return gross, gross-cost, turnover_weekly

def equal_weight_bench(px_sectors):
    return px_sectors.pct_change().mean(axis=1)

def engine_overlay(stress_sig, cut, reg, bands, px_all, tilted_net):
    s=stress_sig.reindex(px_all.index,method="ffill").shift(1)
    eqpct=pd.Series(0.8,index=s.index)
    eqpct[s<=cut["risk_on_max"]]=1.00; eqpct[s>cut["watch_max"]]=0.50
    eqpct=eqpct.reindex(tilted_net.index).ffill().fillna(0.8)
    dret=px_all.pct_change(); regd=reg.reindex(px_all.index,method="ffill").shift(1)
    defret=pd.Series(0.0,index=px_all.index)
    for r,comp in bands.items():
        mask=regd==r; sub=pd.Series(0.0,index=px_all.index)
        for tk,wt in comp.items():
            if tk in dret.columns: sub=sub.add(dret[tk].fillna(0)*wt,fill_value=0)
        defret[mask]=sub[mask]
    defret=defret.reindex(tilted_net.index).fillna(0)
    return eqpct*tilted_net+(1-eqpct)*defret, eqpct

# --------------------------- per-sleeve AUC ---------------------------
def sleeve_auc(px_all, spy, factors, gated_betas, sectors):
    px=px_all[sectors]
    logex=np.log(px).diff().sub(np.log(spy).diff(),axis=0)
    horizons={"h1":21,"h3":63,"h6":126,"h12":252}
    ret_12_1=px.shift(21)/px.shift(252)-1.0; dist200=px/px.rolling(200).mean()-1.0
    r3=px/px.shift(63)-1.0; r6=px/px.shift(126)-1.0
    s3=spy/spy.shift(63)-1.0; s6=spy/spy.shift(126)-1.0
    rs=(r3.sub(s3,axis=0)+r6.sub(s6,axis=0))/2.0; mom=(ret_12_1+dist200)/2.0
    fac_df=pd.DataFrame({k:v for k,v in factors.items()}); facz=fac_df.reindex(px.index).ffill()
    macro=pd.DataFrame(index=px.index,columns=sectors,dtype=float)
    for s in sectors:
        bs=gated_betas.get(s,{})
        if not bs: continue
        acc=pd.Series(0.0,index=px.index); any_f=False
        for f,b in bs.items():
            if f in facz.columns: acc=acc.add(b*facz[f].fillna(0),fill_value=0); any_f=True
        if any_f: macro[s]=acc
    def xs_z(df): return df.sub(df.mean(axis=1),axis=0).div(df.std(axis=1).replace(0,np.nan),axis=0)
    sleeves={"macro":xs_z(macro),"momentum":xs_z(mom),"relstr":xs_z(rs)}
    res={}
    for name,sc in sleeves.items():
        res[name]={}
        for hn,hd in horizons.items():
            fwd=logex.rolling(hd).sum().shift(-hd); sc_al,fwd_al=sc.align(fwd,join="inner")
            res[name][hn]=round(float(auc(sc_al.values.flatten(),(fwd_al.values.flatten()>0).astype(float))),4)
    fac_res={}
    for f in factors:
        if f not in facz.columns: continue
        fac_res[f]={}
        for hn,hd in horizons.items():
            fwd=logex.rolling(hd).sum().shift(-hd); sc_cols={}
            for s in sectors:
                b=gated_betas.get(s,{}).get(f)
                if b is None: continue
                sc_cols[s]=np.sign(b)*facz[f]
            if not sc_cols: fac_res[f][hn]=None; continue
            scdf=pd.DataFrame(sc_cols); sc_al,fwd_al=scdf.align(fwd[list(sc_cols)],join="inner")
            a=auc(sc_al.values.flatten(),(fwd_al.values.flatten()>0).astype(float))
            fac_res[f][hn]=round(float(a),4) if np.isfinite(a) else None
    flat={n:xs_z(df).values.flatten() for n,df in {"macro":macro,"momentum":mom,"relstr":rs}.items()}
    corr={}; names=list(flat)
    for i in range(len(names)):
        for j in range(i+1,len(names)):
            a,b=flat[names[i]],flat[names[j]]; m=np.isfinite(a)&np.isfinite(b)
            if m.sum()<50: continue
            corr[f"{names[i]}~{names[j]}"]={"pearson":round(float(np.corrcoef(a[m],b[m])[0,1]),3),"spearman":round(spearman(a[m],b[m]),3)}
    return res, fac_res, corr

# --------------------------- MAIN ---------------------------
def main():
    t0=time.time()
    print("="*70); print("ASSET TILT BACKTEST — calibration + validation"); print("="*70)

    print("\n[1] Loading prices (prices_eod if Supabase configured, else yfinance adjusted) ...")
    universe=sorted(set(SECTOR_ETFS+DEFENSIVES+BENCH))
    px_all=pull_prices(universe)
    if px_all.empty: print("FATAL: no prices"); sys.exit(1)
    for t in universe:
        if t in px_all.columns and px_all[t].notna().any():
            print(f"    {t:6s} n={int(px_all[t].notna().sum()):5d} from {px_all[t].dropna().index.min().date()}")
        else: print(f"    {t:6s} MISSING")
    sectors=[s for s in SECTOR_ETFS if s in px_all.columns and px_all[s].notna().sum()>500]
    print(f"  usable sectors ({len(sectors)}): {sectors}")
    spy=px_all["SPY"].dropna()

    print("\n[2] Loading macro factors (FRED deep + stored, lagged, expanding-z) ...")
    factors=load_macro()

    print("\n[3] CALIBRATION betas: full-sample sign-stability gate (3 sub-periods) ...")
    print("    [deployed model parameters -> calibration JSON; NOT used for validation]")
    gated,report=sign_stability_gate(px_all,spy,factors,sectors)
    print(f"  betas kept (sign-stable): {report['kept']}/{report['total']}  dropped: {report['dropped']}")
    notable=[f"{s}:{f}={b:+.4f}" for s,f,b in sorted(report["examples"],key=lambda x:-abs(x[2]))[:14]]
    print("  strongest surviving betas:", ", ".join(notable))
    for (s,f) in [("XLE","oil"),("XLK","realrate"),("XLF","curve"),("XLU","tenY"),("XLB","coppergold")]:
        b=gated.get(s,{}).get(f)
        print(f"    prior-check {s}~{f}: {('%+.4f'%b) if b is not None else 'dropped (sign-unstable)'}")

    print("\n[3b] BACKTEST betas: point-in-time, expanding, annually re-estimated ...")
    print("    [each panel uses only data <= its Jan-1 asof; PIT two-half sign gate]")
    beta_panels=pit_beta_panels(px_all,spy,factors,sectors)
    pit_kept_final=beta_panels[-1][2] if beta_panels else 0
    pit_asof_final=beta_panels[-1][0] if beta_panels else None
    n_total=len(sectors)*len(factors)
    first_live=next(((a,k) for a,g,k in beta_panels if k>0), (None,0))
    print(f"  annual panels built: {len(beta_panels)} ({beta_panels[0][0].date()}..{beta_panels[-1][0].date()})")
    print(f"  betas first become non-zero at asof {first_live[0].date() if first_live[0] is not None else 'n/a'} (kept={first_live[1]})")
    print(f"  most-recent PIT panel (asof {pit_asof_final.date()}): {pit_kept_final}/{n_total} betas survive the point-in-time sign gate")
    print("  PIT survivor count by panel:", {str(a.year):k for a,g,k in beta_panels})

    print("\n[4] Building weekly dollar-neutral tilts (point-in-time betas) ...")
    tilts=build_weekly(px_all,spy,factors,beta_panels,sectors).dropna(how="all")
    print(f"  weekly tilt matrix: {tilts.shape[0]} Fridays {tilts.index.min().date()}->{tilts.index.max().date()}")
    print(f"  mean |tilt|: {tilts.abs().mean().mean():.4f}; max {tilts.max().max():+.4f} min {tilts.min().min():+.4f}")

    print("\n[5] Tilted-sector portfolio vs benchmarks ...")
    gross,net,turn=daily_from_weekly_tilts(tilts,px_all[sectors],spy)
    start_eval=tilts.index.min(); spy_ret=spy.pct_change(); ew_ret=equal_weight_bench(px_all[sectors])
    idx=net.dropna().index; idx=idx[idx>=start_eval]
    clip=lambda s:s.reindex(idx).dropna()
    ps_gross=perf_stats(clip(gross)); ps_net=perf_stats(clip(net)); ps_spy=perf_stats(clip(spy_ret)); ps_ew=perf_stats(clip(ew_ret))
    cost_drag=ps_gross["cagr"]-ps_net["cagr"]
    print(f"  eval window: {idx.min().date()} -> {idx.max().date()} ({len(idx)} days)")
    print(f"  TILTED gross : CAGR {ps_gross['cagr']:+.4f}  Sharpe {ps_gross['sharpe']:.3f}  maxDD {ps_gross['maxdd']:.4f}")
    print(f"  TILTED net   : CAGR {ps_net['cagr']:+.4f}  Sharpe {ps_net['sharpe']:.3f}  maxDD {ps_net['maxdd']:.4f}")
    print(f"  SPY          : CAGR {ps_spy['cagr']:+.4f}  Sharpe {ps_spy['sharpe']:.3f}  maxDD {ps_spy['maxdd']:.4f}")
    print(f"  EqualWeight  : CAGR {ps_ew['cagr']:+.4f}  Sharpe {ps_ew['sharpe']:.3f}  maxDD {ps_ew['maxdd']:.4f}")
    print(f"  weekly turnover: {turn:.4f}   annual cost drag: {cost_drag:.4f}")

    print("\n[6] Stress signal: MOVE-alone vs blend ...")
    stress=load_stress(); chosen,sig,cut,auc_tab=choose_stress(stress,spy)
    print(f"  AUC MOVE_only: {auc_tab['MOVE_only']}")
    print(f"  AUC blend    : {auc_tab['blend']}")
    print(f"  CHOSEN stress signal: {chosen}")
    print(f"  refit cut-points: risk_on_max={cut['risk_on_max']:.3f} watch_max={cut['watch_max']:.3f} (pct {cut['risk_on_pct']}/{cut['watch_pct']})")

    print("\n[7] Rate-regime defensive sleeve (2022 stress test) ...")
    reg,bands=rate_regime(); eng,eqpct=engine_overlay(sig,cut,reg,bands,px_all,net)
    d2022=(idx>=pd.Timestamp("2022-01-01"))&(idx<=pd.Timestamp("2022-12-31"))
    if d2022.any():
        dret=px_all.pct_change(); regd=reg.reindex(px_all.index,method="ffill").shift(1)
        def_2022=pd.Series(0.0,index=px_all.index)
        for r,comp in bands.items():
            mask=regd==r; sub=pd.Series(0.0,index=px_all.index)
            for tk,wt in comp.items():
                if tk in dret.columns: sub=sub.add(dret[tk].fillna(0)*wt,fill_value=0)
            def_2022[mask]=sub[mask]
        def_2022=def_2022.reindex(idx)[d2022]
        tlt_2022=px_all["TLT"].pct_change().reindex(idx)[d2022] if "TLT" in px_all else pd.Series(dtype=float)
        reg_mix=reg.reindex(idx)[d2022].value_counts().to_dict()
        defensive_2022_total=float((1+def_2022.fillna(0)).prod()-1)
        tlt_2022_total=float((1+tlt_2022.fillna(0)).prod()-1) if len(tlt_2022) else float("nan")
        print(f"  2022 regime mix: {reg_mix}")
        print(f"  2022 defensive-sleeve total: {defensive_2022_total:+.4f}  (naive long-TLT: {tlt_2022_total:+.4f})")
        survived_2022=defensive_2022_total>tlt_2022_total
    else:
        defensive_2022_total=tlt_2022_total=float("nan"); survived_2022=None; print("  (no 2022 data)")

    print("\n[8] Full engine vs benchmarks ...")
    ps_eng=perf_stats(clip(eng))
    print(f"  ENGINE net   : CAGR {ps_eng['cagr']:+.4f}  Sharpe {ps_eng['sharpe']:.3f}  maxDD {ps_eng['maxdd']:.4f}")
    print(f"  avg equity %: {float(eqpct.reindex(idx).mean()):.3f}")

    print("\n[9] Per-sleeve + per-factor AUC (0.55 gate), correlation audit ...")
    sl_auc,fac_auc,corr=sleeve_auc(px_all,spy,factors,gated,sectors)
    for name,h in sl_auc.items():
        mx=max([v for v in h.values() if np.isfinite(v)] or [0])
        print(f"  sleeve {name:9s} AUC {h}{'' if mx>0.55 else '  <-- FAILS 0.55'}")
    print("  per-factor AUC (directional):")
    for f,h in fac_auc.items():
        vals=[v for v in h.values() if v is not None]; mx=max(vals) if vals else 0
        print(f"    {f:11s} {h}{'' if mx>0.55 else '  <-- weak'}")
    print("  sleeve correlation (flag >0.85):")
    for pair,c in corr.items():
        print(f"    {pair:22s} pearson {c['pearson']:+.3f} spearman {c['spearman']:+.3f}{'  <-- HIGH' if abs(c['pearson'])>0.85 else ''}")

    print("\n"+"="*70); print("GATE SUMMARY"); print("="*70)
    g_ss=ps_net["sharpe"]>ps_spy["sharpe"]; g_se=ps_net["sharpe"]>ps_ew["sharpe"]
    g_dd=ps_net["maxdd"]>=ps_spy["maxdd"]; g_es=ps_eng["sharpe"]>ps_spy["sharpe"]; g_ed=ps_eng["maxdd"]>=ps_spy["maxdd"]
    sleeves_pass={n:(max([v for v in h.values() if np.isfinite(v)] or [0])>0.55) for n,h in sl_auc.items()}
    print(f"  [{'PASS' if g_ss else 'FAIL'}] tilted Sharpe > SPY        ({ps_net['sharpe']:.3f} vs {ps_spy['sharpe']:.3f})")
    print(f"  [{'PASS' if g_se else 'FAIL'}] tilted Sharpe > EqualWeight({ps_net['sharpe']:.3f} vs {ps_ew['sharpe']:.3f})")
    print(f"  [{'PASS' if g_dd else 'FAIL'}] tilted maxDD <= SPY        ({ps_net['maxdd']:.4f} vs {ps_spy['maxdd']:.4f})")
    print(f"  [{'PASS' if g_es else 'FAIL'}] engine Sharpe > SPY        ({ps_eng['sharpe']:.3f} vs {ps_spy['sharpe']:.3f})")
    print(f"  [{'PASS' if g_ed else 'FAIL'}] engine maxDD <= SPY        ({ps_eng['maxdd']:.4f} vs {ps_spy['maxdd']:.4f})")
    print(f"  [{'PASS' if all(sleeves_pass.values()) else 'PARTIAL'}] sleeves clear AUC 0.55: {sleeves_pass}")
    print(f"  [{'PASS' if survived_2022 else ('FAIL' if survived_2022 is not None else 'N/A')}] defensive beat naive long-Treasury 2022")
    print(f"  calibration betas sign-stable (full-sample): {report['kept']}/{report['total']}")
    print(f"  backtest betas surviving PIT sign gate (latest panel {pit_asof_final.date() if pit_asof_final is not None else 'n/a'}): {pit_kept_final}/{len(sectors)*len(factors)}")

    out={
      "_meta":{"generated_utc":datetime.utcnow().isoformat()+"Z","methodology":"ASSET_TILT_METHODOLOGY.md v1",
        "eval_window":{"start":str(idx.min().date()),"end":str(idx.max().date()),"days":len(idx)},
        "sectors":sectors,
        "backtest_betas":"point-in-time expanding, annually re-estimated",
        "calibration_betas":"full-sample sign-stable",
        "beta_usage":("Two distinct beta sets, never conflated. 'sector_macro_betas' below are the "
            "FULL-SAMPLE sign-stable CALIBRATION betas (deployed model parameters). The 'validation' "
            "numbers are produced by the BACKTEST, which uses POINT-IN-TIME betas: an expanding-window "
            "panel re-estimated annually (each panel uses only data <= its Jan-1 asof, with a "
            "point-in-time two-half sign gate), applied as the most-recent panel <= each rebalance "
            "Friday. The full-sample betas are NOT used to compute the validation."),
        "no_lookahead":("factors publication-lagged; expanding past-only z; BACKTEST betas use only data "
            "knowable at the annual asof (forward-window completed; point-in-time sign gate); weekly "
            "weights use only data<=Friday and trade the next bar"),
        "valuation_sleeve":"inactive in backtest (no historical forward-EY); weight redistributed pro-rata per spec",
        "cap_weight_reference":"fixed current SPY GICS weights (dollar-neutral baseline)",
        "data_notes":"prices from yfinance adjusted closes (== prices_eod) on the local run, prices_eod in production; HY OAS vendor-capped on FRED (2023+); deep stress credit leg uses BAA10Y; VIX deep via FRED VIXCLS(1990+); dollar spliced DTWEXB->DTWEXBGS"},
      "sector_macro_betas":{s:{f:round(b,6) for f,b in gated.get(s,{}).items()} for s in sectors},
      "sector_macro_betas_note":"FULL-SAMPLE sign-stable CALIBRATION betas (deployed). Backtest uses point-in-time betas; see backtest_beta_panels.",
      "backtest_beta_panels":{
        "method":"expanding window, re-estimated annually (asof = Jan 1 each year), point-in-time two-half sign gate",
        "panels":[{"asof":str(a.date()),"betas_kept":int(k)} for a,g,k in beta_panels],
        "most_recent_asof":str(pit_asof_final.date()) if pit_asof_final is not None else None,
        "most_recent_kept":int(pit_kept_final),
        "total_sector_factor_pairs":int(len(sectors)*len(factors)),
        "first_nonzero_asof":(str(first_live[0].date()) if first_live[0] is not None else None)},
      "stress_signal":chosen,
      "stress_cutpoints":{"risk_on_max":round(cut["risk_on_max"],4),"watch_max":round(cut["watch_max"],4),"risk_on_pct":cut["risk_on_pct"],"watch_pct":cut["watch_pct"]},
      "stress_auc":auc_tab,
      "rate_regime_bands":{"inflationary_pct":70,"deflationary_pct":30,"composition":bands},
      "sleeve_weights":SLEEVE_W,"tilt_clip":{"min":TILT_MIN,"max":TILT_MAX},
      "validation":{"_betas_used":"point-in-time expanding (annually re-estimated); NOT full-sample",
        "tilted_gross":ps_gross,"tilted_net":ps_net,"engine_net":ps_eng,"spy":ps_spy,"equal_weight":ps_ew,
        "weekly_turnover":round(turn,4),"cost_drag_annual":round(cost_drag,5),"avg_equity_pct":round(float(eqpct.reindex(idx).mean()),4),
        "defensive_2022_total":(round(defensive_2022_total,4) if np.isfinite(defensive_2022_total) else None),
        "naive_tlt_2022_total":(round(tlt_2022_total,4) if np.isfinite(tlt_2022_total) else None),
        "defensive_survived_2022":(bool(survived_2022) if survived_2022 is not None else None),
        "gates":{"tilted_sharpe_gt_spy":bool(g_ss),"tilted_sharpe_gt_ew":bool(g_se),"tilted_maxdd_le_spy":bool(g_dd),
          "engine_sharpe_gt_spy":bool(g_es),"engine_maxdd_le_spy":bool(g_ed),
          "calibration_betas_sign_stable_kept":report["kept"],"calibration_betas_total":report["total"],
          "backtest_betas_pit_kept_latest":int(pit_kept_final)}},
      "per_sleeve_auc":sl_auc,"per_sleeve_auc_note":"AUC computed on the full-sample deployed (calibration) betas — a diagnostic of the deployed model's factor loadings, not a tradable backtest.",
      "per_factor_auc":fac_auc,"sleeve_correlation":corr,
      "beta_sign_stability":{"calibration_full_sample":{"kept":report["kept"],"dropped":report["dropped"],"total":report["total"]},
        "backtest_point_in_time_latest":{"kept":int(pit_kept_final),"total":int(len(sectors)*len(factors)),"asof":str(pit_asof_final.date()) if pit_asof_final is not None else None}},
    }
    os.makedirs("public",exist_ok=True)
    json.dump(out,open("public/asset_tilt_calibration.json","w"),indent=2,default=str)
    print(f"\nWrote public/asset_tilt_calibration.json ({os.path.getsize('public/asset_tilt_calibration.json')} bytes)")
    print(f"Done in {time.time()-t0:.1f}s")

if __name__=="__main__":
    main()
