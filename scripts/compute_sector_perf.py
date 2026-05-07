"""Compute per-sector 1M / 3M / TTM returns + TTM annualized realized vol.

Pulls EOD prices for the primary Select Sector SPDR ETF for each GICS
sector from Yahoo Finance (price-only adjusted close), computes returns
over standard windows, and TTM volatility.

Methodology — plain English:
  - Each sector is represented by its primary Select Sector SPDR ETF
    (Tech → XLK, Financials → XLF, etc.).
  - Returns are price-only, close-to-close (Yahoo's adjusted close, which
    handles splits but is not total-return). The dividend gap vs total-
    return is small for sector ETFs and is disclosed in the page tooltip.
  - 1M / 3M / TTM use trailing 21 / 63 / 252 trading days.
  - Vol is the trailing 252-day daily-log-return standard deviation,
    annualized by sqrt(252). Industry-standard realized-vol convention.
"""
from __future__ import annotations
import json, math, datetime as dt
from pathlib import Path
import yfinance as yf

SECTOR_PROXY = {
    "Information Technology":   "XLK",
    "Communication Services":   "XLC",
    "Financials":               "XLF",
    "Health Care":              "XLV",
    "Consumer Discretionary":   "XLY",
    "Industrials":              "XLI",
    "Consumer Staples":         "XLP",
    "Energy":                   "XLE",
    "Materials":                "XLB",
    "Real Estate":              "XLRE",
    "Utilities":                "XLU",
}
WINDOWS = {"perf_1m": 21, "perf_3m": 63, "perf_ttm": 252}

def metrics_from_closes(closes):
    if len(closes) < 25:
        return {"perf_1m": None, "perf_3m": None, "perf_ttm": None, "vol_ttm": None}
    last = closes[-1]
    out = {}
    for k, n in WINDOWS.items():
        if len(closes) > n:
            out[k] = round((last / closes[-1-n] - 1.0) * 100, 2)
        else:
            out[k] = None
    n_vol = min(252, len(closes) - 1)
    log_rets = [math.log(closes[i] / closes[i-1]) for i in range(len(closes) - n_vol, len(closes)) if closes[i-1] > 0]
    if len(log_rets) >= 30:
        mean = sum(log_rets) / len(log_rets)
        var = sum((x - mean) ** 2 for x in log_rets) / (len(log_rets) - 1)
        out["vol_ttm"] = round(math.sqrt(var) * math.sqrt(252) * 100, 1)
    else:
        out["vol_ttm"] = None
    return out

def main():
    out = {
        "as_of": dt.datetime.utcnow().isoformat(timespec="seconds") + "+00:00",
        "version": "v1",
        "method": {
            "proxy": "Primary Select Sector SPDR ETF per GICS sector — Tech → XLK, Communication Services → XLC, Financials → XLF, Health Care → XLV, Consumer Discretionary → XLY, Industrials → XLI, Consumer Staples → XLP, Energy → XLE, Materials → XLB, Real Estate → XLRE, Utilities → XLU.",
            "returns": "Price-only adjusted close, close-to-close. 1M = trailing 21 trading days, 3M = trailing 63, TTM = trailing 252.",
            "volatility": "Annualized realized vol = stdev of daily log returns over the trailing 252 trading days × sqrt(252). Standard realized-vol convention.",
            "source": "Yahoo Finance daily adjusted close.",
        },
        "sectors": {},
    }
    for sector, ticker in SECTOR_PROXY.items():
        hist = yf.Ticker(ticker).history(period="2y", auto_adjust=True)
        if hist is None or hist.empty:
            print(f"  {sector:24s} {ticker:5s}  NO DATA")
            out["sectors"][sector] = {"proxy": ticker, "perf_1m": None, "perf_3m": None, "perf_ttm": None, "vol_ttm": None, "last_close": None, "last_date": None}
            continue
        closes = hist["Close"].dropna().tolist()
        m = metrics_from_closes(closes)
        m["proxy"] = ticker
        m["last_close"] = round(float(closes[-1]), 2)
        m["last_date"] = str(hist.index[-1].date())
        out["sectors"][sector] = m
        print(f"  {sector:24s} {ticker:5s}  1M {str(m['perf_1m']):>7}  3M {str(m['perf_3m']):>7}  TTM {str(m['perf_ttm']):>7}  vol {str(m['vol_ttm']):>5}")
    Path("public/sector_perf.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote public/sector_perf.json")

if __name__ == "__main__":
    main()
