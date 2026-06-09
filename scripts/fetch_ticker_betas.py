#!/usr/bin/env python3
"""Pull a beta for every held + watchlisted ticker so the Scenario Analysis
page can beta-adjust each position's scenario shock.

Source priority (Joe 2026-06-05):
  1. Yahoo Finance (yfinance) beta - free, already a MacroTilt vendor.
  2. Computed from our own prices_eod history (regress daily returns on SPY,
     ~1yr trailing) when Yahoo has no beta (e.g. recent IPOs).
  3. High-beta default (1.6) for speculative names with neither.

Writes public/ticker_betas.json and self-upserts the ticker-betas
pipeline_health row.
"""
import json, os, sys, datetime as dt, urllib.request, urllib.parse

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
DEFAULT_BETA = 1.6
PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


def _sb(path, params=None):
    if not (SUPABASE_URL and SUPABASE_KEY):
        return []
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}{qs}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  supabase {path}: {e}"); return []


def held_tickers():
    tks = set()
    for row in _sb("positions", {"select": "ticker", "closed_at": "is.null"}):
        t = (row.get("ticker") or "").strip().upper()
        if t: tks.add(t)
    for row in _sb("watchlist", {"select": "ticker"}):
        t = (row.get("ticker") or "").strip().upper()
        if t: tks.add(t)
    return sorted(tks)


def yahoo_beta(ticker, yf):
    try:
        info = yf.Ticker(ticker).get_info()
        b = info.get("beta") or info.get("beta3Year")
        if b is not None and -5 < float(b) < 10:
            return float(b)
    except Exception:
        pass
    return None


def spy_daily_returns():
    start = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    rows = _sb("prices_eod", {"select": "trade_date,close", "ticker": "eq.SPY",
        "trade_date": f"gte.{start}", "order": "trade_date.asc"})
    closes = [(r["trade_date"], float(r["close"])) for r in rows if r.get("close")]
    out, prev = {}, None
    for d, c in closes:
        if prev is not None: out[d] = c / prev - 1.0
        prev = c
    return out


def computed_beta(ticker, spy_returns):
    start = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    rows = _sb("prices_eod", {"select": "trade_date,close", "ticker": f"eq.{ticker}",
        "trade_date": f"gte.{start}", "order": "trade_date.asc"})
    closes = {r["trade_date"]: float(r["close"]) for r in rows if r.get("close")}
    rets, srets, prev = [], [], None
    for d in sorted(closes):
        if prev is not None and d in spy_returns:
            rets.append(closes[d] / prev - 1.0); srets.append(spy_returns[d])
        prev = closes[d]
    n = min(len(rets), len(srets))
    if n < 60: return None
    rets, srets = rets[-n:], srets[-n:]
    mx = sum(srets)/n; my = sum(rets)/n
    cov = sum((srets[i]-mx)*(rets[i]-my) for i in range(n))/n
    var = sum((srets[i]-mx)**2 for i in range(n))/n
    if var <= 0: return None
    b = cov/var
    return round(b, 2) if -5 < b < 10 else None


def sync_pipeline_health(as_of, n):
    if not (SUPABASE_URL and SUPABASE_KEY): return
    das = f"{as_of}T06:00:00+00:00"
    row = {"indicator_id": "ticker-betas", "label": "Per-name betas", "source": "Yahoo + prices_eod",
        "cadence": "D", "expected_cadence_minutes": 1440, "data_as_of": das, "last_good_at": das,
        "status": "green", "last_error": None, "coverage_pct": 100.0}
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/pipeline_health?on_conflict=indicator_id",
        data=json.dumps(row).encode(), method="POST",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal,resolution=merge-duplicates"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r: r.read(); print(f"  pipeline_health: ticker-betas upserted ({n})")
    except Exception as e: print(f"  pipeline_health upsert: {e}")


def main():
    try:
        import yfinance as yf
    except Exception:
        yf = None; print("yfinance unavailable - using computed/default only.")
    tickers = held_tickers()
    if not tickers:
        print("No held/watchlist tickers found."); return
    print(f"Resolving beta for {len(tickers)} tickers: {', '.join(tickers)}")
    spy_rets = spy_daily_returns()
    betas = {}
    for t in tickers:
        b, src = None, None
        if yf is not None:
            b = yahoo_beta(t, yf)
            if b is not None: src = "yahoo"
        if b is None:
            b = computed_beta(t, spy_rets)
            if b is not None: src = "computed"
        if b is None:
            b, src = DEFAULT_BETA, "default"
        betas[t] = {"beta": round(float(b), 2), "source": src}
        print(f"  {t:<8} beta {betas[t]['beta']:>5}  [{src}]")
    as_of = dt.datetime.now(dt.timezone.utc).date().isoformat()
    out = {"as_of": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "window": "yahoo ~3y monthly; computed = prices_eod 1y daily vs SPY; default 1.6",
        "betas": betas}
    os.makedirs(PUBLIC, exist_ok=True)
    with open(os.path.join(PUBLIC, "ticker_betas.json"), "w") as f:
        f.write(json.dumps(out, indent=2) + "\n")
    print(f"[done] wrote public/ticker_betas.json ({len(betas)} names)")
    sync_pipeline_health(as_of, len(betas))


if __name__ == "__main__":
    sys.exit(main())
