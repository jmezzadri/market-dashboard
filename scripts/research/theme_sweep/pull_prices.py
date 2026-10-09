import json, urllib.request, sys
K="sb_publishable__q_l32rEdPZlC4Bxs6dFnA__NqouiGk"
def pull(t):
    out=[];off=0
    while True:
        u=f"https://yqaqqzseepebrocgibcw.supabase.co/rest/v1/prices_eod?select=trade_date,close&ticker=eq.{t}&order=trade_date.asc&limit=1000&offset={off}"
        r=urllib.request.Request(u,headers={"apikey":K,"Authorization":"Bearer "+K})
        rows=json.load(urllib.request.urlopen(r,timeout=60))
        out+=rows; off+=1000
        if len(rows)<1000: break
    return [[x['trade_date'],float(x['close'])] for x in out]
for t in sys.argv[1:]:
    d=pull(t); json.dump(d,open(f'px/{t}.json','w')); print(t,len(d),d[0] if d else None,d[-1] if d else None)
