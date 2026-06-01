#!/usr/bin/env python3
"""compute_risk_proxies.py — Portfolio trailing-risk proxy feed (Senior Quant + Data Steward).

Publishes public/risk_proxies.json: ~3 years of aligned DAILY RETURNS for a small
set of liquid proxy instruments, plus the current risk-free rate. The Portfolio
page combines these market series with the user's LIVE weights (client-side) to
compute volatility, Sharpe, Sortino, max drawdown, value-at-risk and factor betas
for the actual book — so the stats always reflect current positions with no
per-user storage.

Why proxies: the user's funds (a high-yield bond mutual fund, a 529 international
fund, two index funds) lack clean daily history. Each maps to a liquid look-alike
with a long record. The page labels the result a proxy-based estimate.

Proxy map (holding -> instrument):
  High-yield bond fund (JHYUX)      -> HYG  (iShares iBoxx $ HY Corp Bond)
  529 international (NHXINT906)      -> EFA  (iShares MSCI EAFE)
  US large-blend index (FXAIX)      -> SPY  (S&P 500)
  US total-market index (FSKAX)     -> VTI  (Total US market)
  Gold (GLD) / Silver (SLV)         -> GLD / SLV (themselves)
  Bitcoin ETF (FBTC)                -> BTC-USD
  Ethereum (ETHE)                   -> ETH-USD
  Single stocks (PLSE, RCAT)        -> themselves
  Index put (QQQ)                   -> QQQ (the option enters as delta-equivalent short QQQ)
  Rates factor                      -> IEF  (7-10y Treasuries)
  Market factor                     -> SPY
Risk-free rate: 13-week T-bill yield (^IRX), latest close / 100.
"""
import json, sys, datetime as dt
import numpy as np
import pandas as pd
import yfinance as yf

PROXIES = ["HYG", "EFA", "SPY", "VTI", "GLD", "SLV", "BTC-USD", "ETH-USD", "PLSE", "RCAT", "QQQ", "IEF"]
WINDOW_YEARS = 3
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/risk_proxies.json"


def fetch_close(ticker, start):
    df = yf.Ticker(ticker).history(start=start, auto_adjust=True)
    if df is None or df.empty:
        return None
    s = df["Close"].copy()
    s.index = pd.to_datetime(s.index).tz_localize(None).normalize()
    return s[~s.index.duplicated(keep="last")]


def main():
    start = (dt.date.today() - dt.timedelta(days=int(365.25 * WINDOW_YEARS) + 7)).isoformat()
    closes = {}
    for t in PROXIES:
        s = fetch_close(t, start)
        if s is None or len(s) < 60:
            print(f"WARN: {t} insufficient history ({0 if s is None else len(s)})", file=sys.stderr)
            continue
        closes[t] = s
    if "SPY" not in closes:
        print("FATAL: SPY (the trading-day calendar anchor) missing", file=sys.stderr); sys.exit(1)

    # Align every series to SPY's NYSE trading days, forward-fill (covers crypto
    # weekends + the odd missing print), then daily simple returns.
    cal = closes["SPY"].index
    rets, vols = {}, {}
    for t, s in closes.items():
        a = s.reindex(cal).ffill().bfill()
        r = a.pct_change().fillna(0.0)
        rets[t] = [round(float(x), 6) for x in r.values]
        vols[t] = float(r.iloc[1:].std() * np.sqrt(252))

    # risk-free: 13-week T-bill yield, latest
    rf = 0.043
    try:
        irx = yf.Ticker("^IRX").history(period="1mo")["Close"].dropna()
        if len(irx):
            rf = round(float(irx.iloc[-1]) / 100.0, 4)
    except Exception as e:
        print(f"WARN: ^IRX fetch failed, rf defaults to {rf}: {e}", file=sys.stderr)

    out = {
        "as_of": cal[-1].date().isoformat(),
        "window_start": cal[0].date().isoformat(),
        "window_years": WINDOW_YEARS,
        "trading_days": len(cal),
        "rf_annual": rf,
        "dates": [d.date().isoformat() for d in cal],
        "returns": rets,
        "proxy_annual_vol": {k: round(v, 4) for k, v in vols.items()},
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(cal)} days {out['window_start']}..{out['as_of']}, rf={rf:.3%}")
    print("proxy annualized vol:", {k: f"{v:.1%}" for k, v in out["proxy_annual_vol"].items()})


if __name__ == "__main__":
    main()
