"""
paper_portfolio.qt.data — every input the Quality Trend v3 scorer needs.

Four sources, all free:
  universe()      Alpaca /v2/assets      — tradable US equities, funds removed
  prices()        Alpaca market data     — daily bars, survivorship-free
  fundamentals()  Supabase qt_fundamentals (seeded from SEC XBRL by sec_refresh)
  insiders()      Supabase insider_history_edgar (SEC Form 4, daily ingest)

POINT-IN-TIME RULE
------------------
Fundamentals are keyed on the SEC ACCEPTANCE DATE (`filed`), never the period
end. A 10-K for the year ending 31 Dec is not knowable until it is filed in
late February. Every read here filters `filed <= as_of`. Breaking that rule is
the single easiest way to manufacture a backtest that cannot be traded.
"""
from __future__ import annotations

import io
import os
import time
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

ALPACA_DATA = "https://data.alpaca.markets"
ALPACA_TRADE = "https://paper-api.alpaca.markets"
SB_URL = os.environ.get("SUPABASE_URL", "https://yqaqqzseepebrocgibcw.supabase.co")

# Name fragments that mark a fund/trust/note rather than an operating company.
# The first v2 book came back half iShares/Avantis/First Trust because this
# filter did not exist.
_FUND_WORDS = (
    " etf", "etf ", " fund", "index trust", " trust", "ishares", "spdr",
    "vanguard", "invesco", "proshares", "direxion", "avantis", "first trust",
    "wisdomtree", "schwab strategic", "global x", "vaneck", "janus henderson",
    " etn", "exchange traded", "portfolio", " depositary", "royalty trust",
)


def _alpaca_headers() -> dict[str, str]:
    kid = os.environ.get("ALPACA_PAPER_KEY_ID", "")
    sec = os.environ.get("ALPACA_PAPER_SECRET", "")
    if not kid or not sec:
        raise RuntimeError(
            "ALPACA_PAPER_KEY_ID / ALPACA_PAPER_SECRET missing from the environment."
        )
    return {"APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec, "accept": "application/json"}


def _sb_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing from the environment.")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


# ─────────────────────────────── universe ────────────────────────────────
def is_fund(name: str) -> bool:
    n = f" {str(name).lower()} "
    return any(w in n for w in _FUND_WORDS)


def universe() -> pd.DataFrame:
    """Tradable US equities on Alpaca, operating companies only.

    Returns columns: symbol, name, exchange, query_symbol.
    `query_symbol` strips the _DELISTED suffix Alpaca appends to dead names —
    the market-data endpoint does not recognise the suffixed form.
    """
    r = requests.get(
        f"{ALPACA_TRADE}/v2/assets",
        headers=_alpaca_headers(),
        params={"status": "active", "asset_class": "us_equity"},
        timeout=120,
    )
    r.raise_for_status()
    df = pd.DataFrame(r.json())
    df = df[df.tradable.fillna(False)]
    df["query_symbol"] = df.symbol.str.replace("_DELISTED", "", regex=False)
    df["fund"] = df.name.map(is_fund)
    out = df.loc[~df.fund, ["symbol", "name", "exchange", "query_symbol"]].copy()
    return out.drop_duplicates("query_symbol").reset_index(drop=True)


# ──────────────────────────────── prices ─────────────────────────────────
def prices(symbols: list[str], start: str, end: str, batch: int = 150,
           sleep: float = 0.05) -> pd.DataFrame:
    """Daily adjusted bars. Long format: symbol, d, c, v.

    Alpaca's free SIP feed rejects `end` dates inside the last ~2 sessions with
    a 403 (subscription-tier check). Callers must pass an `end` at least two
    trading days back, or accept the truncation.
    """
    H = _alpaca_headers()
    frames: list[pd.DataFrame] = []
    for i in range(0, len(symbols), batch):
        chunk = symbols[i:i + batch]
        page = None
        while True:
            p = {
                "symbols": ",".join(chunk), "timeframe": "1Day",
                "start": start, "end": end, "limit": 10000,
                "adjustment": "all", "feed": "sip",
            }
            if page:
                p["page_token"] = page
            r = requests.get(f"{ALPACA_DATA}/v2/stocks/bars", headers=H, params=p, timeout=120)
            if r.status_code != 200:
                break
            j = r.json()
            for sym, bars in (j.get("bars") or {}).items():
                if bars:
                    b = pd.DataFrame(bars)[["t", "c", "v"]]
                    b["symbol"] = sym
                    frames.append(b)
            page = j.get("next_page_token")
            if not page:
                break
            time.sleep(sleep)
    if not frames:
        return pd.DataFrame(columns=["symbol", "d", "c", "v"])
    df = pd.concat(frames, ignore_index=True)
    df["d"] = pd.to_datetime(df.t).dt.tz_localize(None).dt.normalize()
    return df[["symbol", "d", "c", "v"]]


def latest_trades(symbols: list[str], batch: int = 200) -> pd.Series:
    """Most recent trade price per symbol — used to size orders, not to score.

    The free plan cannot query RECENT sip ("subscription does not permit
    querying recent SIP data"), which returned an empty dict and silently sized
    every order off the stale reference price. `delayed_sip` is 15 minutes
    behind but covers the whole market; `iex` is live but one venue only.
    """
    H, out = _alpaca_headers(), {}
    for feed in ("delayed_sip", "iex"):
        missing = [s for s in symbols if s not in out]
        if not missing:
            break
        for i in range(0, len(missing), batch):
            chunk = missing[i:i + batch]
            r = requests.get(f"{ALPACA_DATA}/v2/stocks/trades/latest", headers=H,
                             params={"symbols": ",".join(chunk), "feed": feed}, timeout=60)
            if r.status_code == 200:
                for sym, t in (r.json().get("trades") or {}).items():
                    p = float(t.get("p") or 0)
                    if p > 0:
                        out[sym] = p
    return pd.Series(out, dtype=float)


# ───────────────────────────── fundamentals ──────────────────────────────
# Tags the v3 scorer consumes. Anything else is noise and is not stored.
SEC_TAGS = [
    "GrossProfit", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
    "CostOfRevenue", "CostOfGoodsAndServicesSold", "Assets",
    "NetCashProvidedByUsedInOperatingActivities",
    "WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding",
]


def _sb_select(table: str, params: dict, page: int = 1000) -> pd.DataFrame:
    """PostgREST read, fully paged.

    PostgREST caps a single response at 1,000 rows regardless of what Range asks
    for. The first version of this function stopped as soon as it got a short
    page, which silently truncated every read to the first 1,000 rows — the
    production scorer saw 366 companies instead of 4,669 and built an empty
    book. Page until a request comes back empty, never on a short page.
    """
    rows, off = [], 0
    while True:
        p = dict(params)
        p["limit"], p["offset"] = page, off
        r = requests.get(f"{SB_URL}/rest/v1/{table}", headers=_sb_headers(),
                         params=p, timeout=180)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        off += len(batch)
        if len(batch) < page and off > 0:
            # Short page from a server-side cap is normal; only an EMPTY page
            # means the end. Probe once more.
            probe = dict(params)
            probe["limit"], probe["offset"] = 1, off
            if not requests.get(f"{SB_URL}/rest/v1/{table}", headers=_sb_headers(),
                                params=probe, timeout=60).json():
                break
    return pd.DataFrame(rows)


def fundamentals(as_of: str) -> pd.DataFrame:
    """Point-in-time company quality, one row per symbol, as known on `as_of`.

    Columns: gp_a (gross profit / assets), ocf_a (operating cash flow / assets),
    iss (negative share-count growth, so buybacks score positive).

    Computed by the qt_quality(date) Postgres function rather than here: the
    source table is ~400k rows, and the flow-vs-stock distinction (annual
    figures only for gross profit / revenue / cash flow) is easy to lose in a
    client-side rewrite. See the migration for the reasoning.
    """
    # qt_quality_json, not qt_quality: PostgREST truncates ANY response at 1,000
    # rows, set-returning functions included. Returning one jsonb value avoids it.
    r = requests.post(f"{SB_URL}/rest/v1/rpc/qt_quality_json", headers=_sb_headers(),
                      json={"as_of": as_of}, timeout=180)
    r.raise_for_status()
    q = pd.DataFrame(r.json())
    if q.empty:
        return pd.DataFrame(columns=["gp_a", "ocf_a", "iss"])
    q = q.set_index("symbol")
    for c in ("gp_a", "ocf_a", "iss"):
        q[c] = pd.to_numeric(q[c], errors="coerce")
    return q.replace([np.inf, -np.inf], np.nan)


# ─────────────────────────────── insiders ────────────────────────────────
def insiders(as_of: str, window_days: int = 180) -> pd.Series:
    """Meaningful-insider-buy conviction per ticker, 0..1, as known on `as_of`.

    The raw Form 4 buy signal is NEGATIVE (-2.07% vs market over six months).
    What makes it work is throwing almost all of it away. Measured on 2016-2026
    Form 4 data, forward 3-month excess return:

        all open-market buys .............  -2.07%
        10% owners only ..................  -1.95%
        officers + directors only ........  +0.54%
        stake increase >= 50% ............  +7.94%
        stake increase >= 100% ...........  +10.80%
        doubled stake AND buy < $250k ....  +14.51%

    Dollar size runs the OTHER WAY (buys over $1M: -3.01%), which is why a big
    ticket is halved rather than rewarded. A $300k top-up by a 10% holder is
    rebalancing, not conviction.
    """
    start = (pd.Timestamp(as_of) - timedelta(days=window_days)).date().isoformat()
    df = _sb_select("insider_history_edgar", {
        "select": "ticker,filing_date,transaction_code,amount,stock_price,"
                  "is_officer,is_director,is_ten_percent_owner,is_10b5_1,"
                  "owner_name_lower,shares_owned_before,shares_owned_after",
        "filing_date": f"gte.{start}",
        "transaction_code": "eq.P",
    })
    if df.empty:
        return pd.Series(dtype=float)
    df = df[df.filing_date <= as_of]
    # Officer or director only. A pure 10% owner never counts, however large.
    df = df[(df.is_officer.fillna(False)) | (df.is_director.fillna(False))]
    df = df[~df.is_10b5_1.fillna(False)]          # scheduled plans are not decisions
    if df.empty:
        return pd.Series(dtype=float)

    for c in ("amount", "stock_price", "shares_owned_before", "shares_owned_after"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df.amount > 0]

    before = df.shares_owned_before
    if before.isna().all():
        before = (df.shares_owned_after - df.amount)
    else:
        before = before.fillna(df.shares_owned_after - df.amount)
    # Stake increase is the whole signal: shares bought / shares already held.
    stake = np.where(before > 0, df.amount / before, np.nan)
    df["stake"] = np.clip(pd.to_numeric(stake, errors="coerce"), 0, 5.0)
    df = df.dropna(subset=["stake"])
    if df.empty:
        return pd.Series(dtype=float)

    usd = (df.amount * df.stock_price.fillna(0)).fillna(0)
    df["w"] = df.stake * np.where(usd > 250_000, 0.5, 1.0)

    per = df.groupby("ticker").agg(conv=("w", "sum"), n=("owner_name_lower", "nunique"))
    per["conv"] = per.conv * (1 + 0.25 * np.minimum(per.n - 1, 3))   # cluster bonus
    s = per.conv.clip(lower=0)
    return (s / s.max()) if s.max() > 0 else s * 0.0
