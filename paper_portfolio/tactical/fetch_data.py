"""Download the engine's inputs: 25y of dividend-adjusted ETF prices (Yahoo)
and the VIX series from the site's own indicator feed. Writes ./data/*.pkl next
to this file. Run: python3 -m paper_portfolio.tactical.fetch_data"""
import io, json, time, datetime as dt, urllib.request
from pathlib import Path
import pandas as pd
from paper_portfolio.tactical.engine import RISK_ASSETS, CASH

DATA = Path(__file__).resolve().parent / "data"

def _yahoo(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=25y&interval=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r: j = json.loads(r.read())
    res = j["chart"]["result"][0]
    ts, adj = res["timestamp"], res["indicators"]["adjclose"][0]["adjclose"]
    s = pd.Series(adj, index=pd.to_datetime([dt.date.fromtimestamp(t) for t in ts]), name=sym)
    return s[~s.index.duplicated()].dropna()

def main():
    DATA.mkdir(exist_ok=True)
    cols = {}
    for sym in RISK_ASSETS + [CASH]:
        for attempt in (1, 2, 3):
            try: cols[sym] = _yahoo(sym); break
            except Exception:
                if attempt == 3: raise
                time.sleep(2)
        time.sleep(0.6)
    pd.DataFrame(cols).sort_index().to_pickle(DATA / "prices.pkl")
    req = urllib.request.Request("https://macrotilt.com/indicator_history.json",
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r: j = json.loads(r.read())
    vix = pd.Series({pd.Timestamp(d): v for d, v in j["vix"]["points"] if v is not None},
                    name="vix").sort_index()
    pd.DataFrame({"vix": vix}).to_pickle(DATA / "stress.pkl")
    print("data written to", DATA)

if __name__ == "__main__":
    main()
