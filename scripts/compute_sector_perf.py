"""Compute per-sector 1M / 3M / TTM returns + TTM annualized realized vol.

Source: Supabase `public.prices_eod` (Massive / Polygon EOD feed + the
2003+ yfinance bootstrap residing in the same table). This producer was
formerly a yfinance call but Yahoo rate-limited every request from the
GitHub Actions runners as of 2026-05-12, leaving every row null and
breaking bug #1186 (Asset Tilt — 1M / 3M / TTM / Vol blank for every
sector row). Swap to the Supabase feed per the v9 pattern (LESSONS rule
2026-04-30, Polygon Basic cap): yfinance never runs in the live pipeline.

Methodology — plain English:
  - Each sector is represented by its primary Select Sector SPDR ETF
    (Tech -> XLK, Financials -> XLF, etc.).
  - Returns are price-only close-to-close from the prices_eod feed.
  - 1M / 3M / TTM use trailing 21 / 63 / 252 trading days.
  - Vol is the trailing 252-day daily-log-return standard deviation,
    annualized by sqrt(252). Industry-standard realized-vol convention.
"""
from __future__ import annotations
import json
import math
import os
import datetime as dt
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SECTOR_PROXY = {
    "Information Technology":   "XLK",
    "Communication Services":   "XLC",
    "Financials":               "XLF",
    "Health Care":              "XLV",
    "Consumer Discretionary":   "XLY",
    "Consumer Staples":         "XLP",
    "Industrials":              "XLI",
    "Energy":                   "XLE",
    "Materials":                "XLB",
    "Real Estate":              "XLRE",
    "Utilities":                "XLU",
    # Defensive sleeve buckets - same proxy ETFs the engine uses.
    "BIL":                      "BIL",
    "TLT":                      "TLT",
    "GLD":                      "GLD",
    "LQD":                      "LQD",
}

# 24 GICS Industry Groups. Each maps to its primary proxy ETF (the first
# entry in compute_v10_allocation.py INDUSTRY_GROUPS[i]['tickers']).
# Joe directive 2026-05-12: surface IG-level perf in the Recommended
# Allocations drill-down so the rows aren't blank.
INDUSTRY_GROUP_PROXY = {
    "semis":     "SOXX",
    "software":  "IGV",
    "hardware":  "IYW",
    "intmedia":  "XLC",
    "telecom":   "IYZ",
    "banks":     "KBE",
    "insurance": "KIE",
    "divfin":    "IAI",
    "capgoods":  "XLI",
    "transport": "IYT",
    "defense":   "ITA",
    "pharma":    "PPH",
    "devices":   "IHI",
    "biotech":   "IBB",
    "foodbev":   "PBJ",
    "household": "XLP",
    "retail":    "XRT",
    "autos":     "CARZ",
    "oilgas":    "XOP",
    "oilfield":  "OIH",
    "mining":    "XME",
    "chemicals": "PYZ",
    "reits":     "VNQ",
    "electric":  "XLU",
}

WINDOWS = {"perf_1m": 21, "perf_3m": 63, "perf_ttm": 252}


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(f"missing env var: {name}")
    return v


def fetch_closes(supabase_url: str, key: str, ticker: str):
    """Return list of (date_iso, close) tuples sorted ascending."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    qs = urlencode({
        "ticker": f"eq.{ticker}",
        "select": "trade_date,close",
        "order": "trade_date.desc",
        "limit": 300,
    })
    url = f"{supabase_url.rstrip('/')}/rest/v1/prices_eod?{qs}"
    req = Request(url, method="GET")
    for k, v in headers.items():
        req.add_header(k, v)
    with urlopen(req, timeout=30) as r:
        rows = json.loads(r.read().decode("utf-8"))
    rows.sort(key=lambda x: x["trade_date"])
    return [(r["trade_date"], float(r["close"])) for r in rows if r.get("close") is not None]


def metrics_from_closes(closes_only):
    if len(closes_only) < 25:
        return {"perf_1m": None, "perf_3m": None, "perf_ttm": None, "vol_ttm": None}
    last = closes_only[-1]
    out = {}
    for k, n in WINDOWS.items():
        if len(closes_only) > n:
            out[k] = round((last / closes_only[-1 - n] - 1.0) * 100, 2)
        else:
            out[k] = None
    n_vol = min(252, len(closes_only) - 1)
    log_rets = [
        math.log(closes_only[i] / closes_only[i - 1])
        for i in range(len(closes_only) - n_vol, len(closes_only))
        if closes_only[i - 1] > 0
    ]
    if len(log_rets) >= 30:
        mean = sum(log_rets) / len(log_rets)
        var = sum((x - mean) ** 2 for x in log_rets) / (len(log_rets) - 1)
        out["vol_ttm"] = round(math.sqrt(var) * math.sqrt(252) * 100, 1)
    else:
        out["vol_ttm"] = None
    return out


def main():
    supabase_url = env("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip() or env("SUPABASE_ANON_KEY")

    out = {
        "as_of": dt.datetime.utcnow().isoformat(timespec="seconds") + "+00:00",
        "version": "v2",
        "method": {
            "proxy": "Primary Select Sector SPDR ETF per GICS sector.",
            "returns": "Price-only close-to-close from Supabase public.prices_eod. 1M = trailing 21 trading days, 3M = trailing 63, TTM = trailing 252.",
            "volatility": "Annualized realized vol = stdev of daily log returns over the trailing 252 trading days x sqrt(252).",
            "source": "Supabase public.prices_eod (Massive/Polygon EOD feed + 2003+ yfinance bootstrap residing in the same table).",
        },
        "sectors": {},
    }
    insufficient = []
    for sector, ticker in SECTOR_PROXY.items():
        try:
            pairs = fetch_closes(supabase_url, key, ticker)
        except (HTTPError, Exception) as e:
            print(f"  {sector:24s} {ticker:5s}  FETCH ERR  {type(e).__name__}: {str(e)[:80]}")
            out["sectors"][sector] = {
                "proxy": ticker, "perf_1m": None, "perf_3m": None, "perf_ttm": None,
                "vol_ttm": None, "last_close": None, "last_date": None,
            }
            continue
        if not pairs:
            print(f"  {sector:24s} {ticker:5s}  NO DATA in prices_eod")
            out["sectors"][sector] = {
                "proxy": ticker, "perf_1m": None, "perf_3m": None, "perf_ttm": None,
                "vol_ttm": None, "last_close": None, "last_date": None,
            }
            continue
        closes_only = [c for _, c in pairs]
        m = metrics_from_closes(closes_only)
        m["proxy"] = ticker
        m["last_close"] = round(closes_only[-1], 2)
        m["last_date"] = pairs[-1][0]
        out["sectors"][sector] = m
        if len(closes_only) < 252:
            insufficient.append(f"{ticker} (n={len(closes_only)})")
        print(f"  {sector:24s} {ticker:5s}  n={len(closes_only):3d}  1M {str(m['perf_1m']):>7}  3M {str(m['perf_3m']):>7}  TTM {str(m['perf_ttm']):>7}  vol {str(m['vol_ttm']):>5}")

    # IG-level perf — same windows, same source, keyed by IG id.
    out["industry_groups"] = {}
    for ig_id, ticker in INDUSTRY_GROUP_PROXY.items():
        try:
            pairs = fetch_closes(supabase_url, key, ticker)
        except Exception as e:
            print(f"  IG {ig_id:11s} {ticker:5s}  FETCH ERR  {type(e).__name__}")
            out["industry_groups"][ig_id] = {
                "proxy": ticker, "perf_1m": None, "perf_3m": None, "perf_ttm": None,
                "vol_ttm": None, "last_close": None, "last_date": None,
            }
            continue
        if not pairs:
            out["industry_groups"][ig_id] = {
                "proxy": ticker, "perf_1m": None, "perf_3m": None, "perf_ttm": None,
                "vol_ttm": None, "last_close": None, "last_date": None,
            }
            continue
        closes_only = [c for _, c in pairs]
        m = metrics_from_closes(closes_only)
        m["proxy"] = ticker
        m["last_close"] = round(closes_only[-1], 2)
        m["last_date"] = pairs[-1][0]
        out["industry_groups"][ig_id] = m
        print(f"  IG {ig_id:11s} {ticker:5s}  n={len(closes_only):3d}  1M {str(m['perf_1m']):>7}  3M {str(m['perf_3m']):>7}  TTM {str(m['perf_ttm']):>7}  vol {str(m['vol_ttm']):>5}")

    Path("public/sector_perf.json").write_text(json.dumps(out, indent=2) + "\n")
    if insufficient:
        print()
        print(f"  Note: {len(insufficient)} sector(s) have < 252 days in prices_eod; 3M/TTM/Vol will be null until backfilled:")
        for s in insufficient:
            print(f"    - {s}")
        print("  Trigger V9-YFINANCE-BOOTSTRAP (or its successor) once Yahoo recovers to backfill XLK/XLC/XLRE.")
    print()
    print(f"Wrote public/sector_perf.json")


if __name__ == "__main__":
    main()
