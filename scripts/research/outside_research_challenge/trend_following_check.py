"""Is "trade with the trend" an edge on MacroTilt's own series?

Asked 2026-10-02 after reading a trend-following shop's book. Signal: the sign
of the 12-month return, skipping the latest month. Outcome: the next 63
sessions in the signal's direction, sampled every 21 sessions, against simply
holding the series. Front-month commodity series carry roll gaps (LESSONS 4.37).
"""
import json, os, statistics as st
HERE=os.path.dirname(os.path.abspath(__file__))
H=json.load(open(os.path.join(HERE,"..","..","..","public","indicator_history.json")))
A=['spx_index','ndx_index','dji_index','fx_eur','fx_jpy','fx_gbp','usd','cmdty_gold','cmdty_silver','cmdty_copper','cmdty_oil','cmdty_brent','cmdty_natgas','cmdty_corn','cmdty_soybeans','cmdty_wheat']
pool=[]
for k in A:
    v=[x[1] for x in H[k]["points"] if x[1] and x[1]>0]; o=[]; b=[]
    for i in range(252,len(v)-63,21):
        sig=1 if v[i-21]/v[i-252]-1>0 else -1
        r=v[i+63]/v[i]-1; o.append(sig*r); b.append(r)
    pool+=o
    print(f"{k:16} n={len(o):4}  with-trend {100*st.mean(o):+.2f}%  win {100*sum(x>0 for x in o)/len(o):.0f}%   just holding {100*st.mean(b):+.2f}%")
print(f"pooled: with-trend {100*st.mean(pool):+.2f}%  win {100*sum(x>0 for x in pool)/len(pool):.0f}%  n={len(pool)}")
