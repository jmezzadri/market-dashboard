"""Pull Alpaca daily bars (adjustment=all, SIP) for the survivorship-free universe.
Writes prices_raw/*.parquet per batch, resumable."""
import json, os, re, sys, time
import pandas as pd, requests

H = {"APCA-API-KEY-ID": os.environ["ALPACA_PAPER_KEY_ID"], "APCA-API-SECRET-KEY": os.environ["ALPACA_PAPER_SECRET"]}
START, END = "2016-01-01", "2026-09-08"
os.makedirs("prices_raw", exist_ok=True)

a = json.load(open("universe_assets.json"))
syms = sorted({x["symbol"].replace("_DELISTED", "") for x in a if re.fullmatch(r"[A-Z]{1,5}", x["symbol"].replace("_DELISTED", ""))})
print("symbols", len(syms), flush=True)

def fetch(chunk):
    frames, page = [], None
    while True:
        p = {"symbols": ",".join(chunk), "timeframe": "1Day", "start": START, "end": END,
             "limit": 10000, "adjustment": "all", "feed": "sip"}
        if page: p["page_token"] = page
        for attempt in range(6):
            try:
                r = requests.get("https://data.alpaca.markets/v2/stocks/bars", headers=H, params=p, timeout=120)
            except Exception as e:
                time.sleep(2 + attempt * 3); continue
            if r.status_code == 429:
                time.sleep(5 + attempt * 5); continue
            break
        if r.status_code == 400:
            return None  # caller splits
        if r.status_code != 200:
            print("HTTP", r.status_code, r.text[:120], flush=True); time.sleep(10); continue
        j = r.json()
        for sym, bars in (j.get("bars") or {}).items():
            if bars:
                b = pd.DataFrame(bars)[["t", "o", "c", "v"]]
                b["symbol"] = sym
                frames.append(b)
        page = j.get("next_page_token")
        if not page: break
    return frames

B = 100
for i in range(0, len(syms), B):
    out = f"prices_raw/b{i:05d}.parquet"
    if os.path.exists(out): continue
    chunk = syms[i:i + B]
    frames = fetch(chunk)
    if frames is None:
        frames = []
        for s in chunk:
            f = fetch([s])
            if f: frames.extend(f)
    if frames:
        df = pd.concat(frames, ignore_index=True)
        df["d"] = pd.to_datetime(df.t).dt.tz_localize(None).dt.normalize()
        df[["symbol", "d", "o", "c", "v"]].to_parquet(out, index=False)
    else:
        pd.DataFrame(columns=["symbol", "d", "o", "c", "v"]).to_parquet(out, index=False)
    print(f"{i + B}/{len(syms)} rows={sum(len(f) for f in frames)}", flush=True)
print("DONE", flush=True)
