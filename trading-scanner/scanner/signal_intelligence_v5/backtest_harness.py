"""
Signal Intelligence v5 — Phase 3 walk-forward backtest harness.

Loops scan_dates × universe, assembles point-in-time inputs from Supabase
in bulk per scan date, calls each of the six v5 pure-function scorers in
memory, blends them with `compute_composite`, joins forward 21-day total
returns, and writes one row per (scan_date, ticker) attempt to parquet.

Architecture (Phase 1 doc, V4_HARNESS_DATA_LAYER_NOTES sec.4):
  bulk-fetch per scan date with O(scan_dates) SQL round-trips, not
  O(scan_dates × universe). Each scan-date queries:

    1. historical_marketcap         — point-in-time market_cap per ticker
    2. prices_eod                   — 365-day rolling window (technicals,
                                      analyst spot, SI 50-SMA)
    3. insider_history              — 425-day rolling window (insider +
                                      first-buy gate)
    4. options_flow_daily           — latest snapshot per ticker on/before
                                      scan date (composite v5 reads "most
                                      recent")
    5. congress_trades_daily        — 90-day rolling window
    6. analyst_ratings_daily        — 90-day rolling window
    7. short_interest (FINRA)       — latest 6 settlements per ticker
    8. short_interest_daily         — 60-day rolling window
    9. forward_returns_21d          — per-ticker on as_of_date

For each (ticker, scan_date) we call the v5 pure functions:
  - compute_insider_signal (via the v5 wrapper logic — first-buy gate,
    10b5-1 exclusion, magnitude bps)
  - compute_options_signal
  - compute_congress_signal
  - compute_technicals_signal
  - compute_analyst_signal
  - compute_short_interest_signal

Then compose with `composite.compute_composite()` which handles cap-discount
and None-aware weighting. Output schema (Joe's spec):

    (scan_date, ticker, market_cap, mt_score, band, sub_scores,
     weights_used, fwd_return_21d, skip_reason)

Sub-scores and weights are emitted as JSON strings inside the parquet
columns so Phase 3 analysis can ungroup per-signal performance.

Joe's Run definitions:
  Run A : equal-weight v5 (default), record everything; analysis filters
          to bullish bands (Watch Buy + Strong Buy).
  Run B : same equal-weight v5 (same parquet rows); analysis filters to
          bearish bands (Watch Sell + Strong Sell).
  Run C : re-weighted v5 — weights derived from Run A+B per-signal
          analysis. Re-runs the full walk-forward with the new weights.
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable

import pandas as pd
import requests

from scanner.signal_intelligence_v5 import composite as v5_composite
from scanner.signal_intelligence_v5.analyst_score import compute_analyst_signal
from scanner.signal_intelligence_v5.congress_score import compute_congress_signal
from scanner.signal_intelligence_v5.options_score import compute_options_signal
from scanner.signal_intelligence_v5.short_interest_score import compute_short_interest_signal
from scanner.signal_intelligence_v5.technicals_score import compute_technicals_signal
from scanner.signal_intelligence_v2.insider import compute_insider_signal


PROJECT_REF = "yqaqqzseepebrocgibcw"
PRICE_SOURCES = ("massive", "yfinance-v4-backfill", "yfinance-bootstrap")

# Lookback windows (must cover the longest each scorer needs).
PRICE_LOOKBACK_DAYS = 280
INSIDER_LOOKBACK_DAYS = 425       # 30 (gate) + 365 (first-buy) + buffer
INSIDER_WINDOW_DAYS = 30          # primary scoring window
FIRST_BUY_LOOKBACK_DAYS = 365
CONGRESS_LOOKBACK_DAYS = 90
ANALYST_LOOKBACK_DAYS = 90
SI_FINRA_SETTLEMENTS = 6          # most recent N settlements
SI_DAILY_LOOKBACK_DAYS = 60
EARNINGS_PROXIMITY_DAYS = 14
TRAILING_CLOSES_REQUIRED = 51

# Cap-bucket thresholds (S&P, per Joe).
CAP_BUCKETS = [
    ("Small Cap",   300_000_000,   8_100_000_000),
    ("Mid Cap",   8_100_000_000,  23_500_000_000),
    ("Large Cap", 23_500_000_000, 200_000_000_000),
    ("Mega Cap", 200_000_000_000, float("inf")),
]


def cap_bucket(cap: float | None) -> str:
    if cap is None:
        return "Unknown"
    for label, lo, hi in CAP_BUCKETS:
        if lo <= cap < hi:
            return label
    return "Unknown"


def _q(sql: str, token: str | None = None, retries: int = 3) -> list[dict]:
    tok = token or os.environ["SUPABASE_ACCESS_TOKEN"]
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.post(
                f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
                headers={"Authorization": f"Bearer {tok}",
                         "Content-Type": "application/json"},
                json={"query": sql},
                timeout=180,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Supabase query failed after {retries} retries: {last_err}")


def _qlist(values: Iterable[str]) -> str:
    cleaned = [str(v).replace("'", "''") for v in values]
    return ",".join(f"'{v}'" for v in cleaned)


# ─────────────────────────────────────────────────────────────────────────────
# Full-backtest-window pre-fetcher (cached to pickle on disk).
# Collapses N_scan_dates × 9 queries -> ~9 queries total, then slices in
# memory per scan date.
# ─────────────────────────────────────────────────────────────────────────────


def prefetch_full_window(
    full_universe: list[str],
    earliest_scan_date: date,
    latest_scan_date: date,
    cache_path: str | None = None,
) -> dict[str, Any]:
    """One-time bulk pull of every input across the full backtest span.

    Returns a dict with per-table data ready for in-memory slicing:
        {
          "caps_by_date":      {as_of_date: {ticker: market_cap}},
          "prices_by_ticker":  {ticker: [(date, close, vol), ...]},
          "insiders_by_ticker":{ticker: [row, ...]},
          "options_by_ticker": {ticker: [(as_of_date, row), ...]},
          "congress_by_ticker":{ticker: [row, ...]},
          "analyst_by_ticker": {ticker: [row, ...]},
          "si_finra_by_ticker":{ticker: [row, ...]},
          "si_daily_by_ticker":{ticker: [row, ...]},
          "fwd_returns":       {(ticker, as_of_date): fwd_21d},
        }

    Reads/writes pickle cache if cache_path is provided.
    """
    import pickle
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    px_start = earliest_scan_date - timedelta(days=PRICE_LOOKBACK_DAYS + 7)
    ins_start = earliest_scan_date - timedelta(days=INSIDER_LOOKBACK_DAYS + 7)
    cong_start = earliest_scan_date - timedelta(days=CONGRESS_LOOKBACK_DAYS + 7)
    ana_start = earliest_scan_date - timedelta(days=ANALYST_LOOKBACK_DAYS + 7)
    sid_start = earliest_scan_date - timedelta(days=SI_DAILY_LOOKBACK_DAYS + 7)

    # 1) Historical marketcap — pull ALL rows for these tickers in the
    #    period spanning earliest..latest. Index by (ticker, as_of_date).
    sql = f"""
      SELECT ticker, as_of_date, market_cap
      FROM historical_marketcap
      WHERE ticker IN ({_qlist(full_universe)})
        AND as_of_date BETWEEN '{earliest_scan_date - timedelta(days=14)}'
                           AND '{latest_scan_date}';
    """
    caps_rows = _q(sql)
    # caps_by_ticker[ticker] = sorted [(date, cap)] asc
    caps_by_ticker: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for r in caps_rows:
        try:
            d = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
            caps_by_ticker[r["ticker"]].append((d, float(r["market_cap"])))
        except (TypeError, ValueError):
            continue
    for v in caps_by_ticker.values():
        v.sort()

    # 2) Prices — one big pull, indexed by ticker
    sql = f"""
      SELECT ticker, trade_date, close, volume
      FROM prices_eod
      WHERE ticker IN ({_qlist(full_universe)})
        AND trade_date BETWEEN '{px_start}' AND '{latest_scan_date}'
        AND source IN ({_qlist(PRICE_SOURCES)})
      ORDER BY ticker, trade_date ASC;
    """
    px_rows = _q(sql)
    prices_by_ticker: dict[str, list[tuple[date, float, float]]] = defaultdict(list)
    for r in px_rows:
        try:
            d = datetime.strptime(r["trade_date"], "%Y-%m-%d").date()
            c = float(r["close"]) if r["close"] is not None else None
            v = float(r["volume"]) if r["volume"] is not None else None
            if c is None or v is None:
                continue
            prices_by_ticker[r["ticker"]].append((d, c, v))
        except (TypeError, ValueError):
            continue

    # 3) Insider history (one big pull)
    sql = f"""
      SELECT ticker, transaction_date, owner_name, owner_name_lower,
             transaction_code, amount, stock_price, is_officer,
             is_director, is_ten_percent_owner, is_10b5_1, marketcap
      FROM insider_history
      WHERE ticker IN ({_qlist(full_universe)})
        AND transaction_date BETWEEN '{ins_start}' AND '{latest_scan_date}';
    """
    rows = _q(sql)
    insiders_by_ticker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["transaction_date"], "%Y-%m-%d").date()
            r["__d"] = d
            insiders_by_ticker[r["ticker"]].append(r)
        except (TypeError, ValueError):
            continue

    # 4) Options flow (most options data is just 2026-05-10 anyway; do one pull)
    sql = f"""
      SELECT ticker, as_of_date, call_premium, put_premium,
             ask_side_premium, bid_side_premium, sweep_count, unusual_count
      FROM options_flow_daily
      WHERE ticker IN ({_qlist(full_universe)});
    """
    rows = _q(sql)
    options_by_ticker: dict[str, list[tuple[date, dict[str, Any]]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
            options_by_ticker[r["ticker"]].append((d, r))
        except (TypeError, ValueError):
            continue
    for v in options_by_ticker.values():
        v.sort(reverse=True)  # most-recent first

    # 5) Congress
    sql = f"""
      SELECT ticker, transaction_date, member_name, chamber,
             transaction_type, amount_bucket
      FROM congress_trades_daily
      WHERE ticker IN ({_qlist(full_universe)})
        AND transaction_date BETWEEN '{cong_start}' AND '{latest_scan_date}';
    """
    rows = _q(sql)
    congress_by_ticker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["transaction_date"], "%Y-%m-%d").date()
            r["__d"] = d
            congress_by_ticker[r["ticker"]].append(r)
        except (TypeError, ValueError):
            continue

    # 6) Analyst
    sql = f"""
      SELECT ticker, action_date, firm, action, recommendation,
             target_price, prev_target, broker_tier
      FROM analyst_ratings_daily
      WHERE ticker IN ({_qlist(full_universe)})
        AND action_date BETWEEN '{ana_start}' AND '{latest_scan_date}';
    """
    rows = _q(sql)
    analyst_by_ticker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["action_date"], "%Y-%m-%d").date()
            r["__d"] = d
            analyst_by_ticker[r["ticker"]].append(r)
        except (TypeError, ValueError):
            continue

    # 7) Short interest FINRA — pull all rows
    sql = f"""
      SELECT ticker, as_of_date, short_interest_float_pct,
             short_interest_shares, avg_daily_volume
      FROM short_interest
      WHERE ticker IN ({_qlist(full_universe)})
        AND source = 'finra'
      ORDER BY ticker, as_of_date DESC;
    """
    rows = _q(sql)
    si_finra_by_ticker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
            r["__d"] = d
            si_finra_by_ticker[r["ticker"]].append(r)
        except (TypeError, ValueError):
            continue

    # 8) Short interest daily
    sql = f"""
      SELECT ticker, as_of_date, cost_to_borrow_pct, borrow_shares_available,
             ftd_quantity, short_volume_ratio
      FROM short_interest_daily
      WHERE ticker IN ({_qlist(full_universe)})
        AND as_of_date BETWEEN '{sid_start}' AND '{latest_scan_date}';
    """
    rows = _q(sql)
    si_daily_by_ticker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
            r["__d"] = d
            si_daily_by_ticker[r["ticker"]].append(r)
        except (TypeError, ValueError):
            continue
    for v in si_daily_by_ticker.values():
        v.sort(key=lambda r: r["__d"], reverse=True)

    # 9) Forward returns
    sql = f"""
      SELECT ticker, as_of_date, fwd_return_21d
      FROM forward_returns_21d
      WHERE ticker IN ({_qlist(full_universe)})
        AND as_of_date BETWEEN '{earliest_scan_date - timedelta(days=14)}'
                           AND '{latest_scan_date}';
    """
    rows = _q(sql)
    fwd_returns: dict[tuple[str, date], float] = {}
    for r in rows:
        try:
            d = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
            fwd_returns[(r["ticker"], d)] = float(r["fwd_return_21d"])
        except (TypeError, ValueError):
            continue

    cache = {
        "caps_by_ticker": dict(caps_by_ticker),
        "prices_by_ticker": dict(prices_by_ticker),
        "insiders_by_ticker": dict(insiders_by_ticker),
        "options_by_ticker": dict(options_by_ticker),
        "congress_by_ticker": dict(congress_by_ticker),
        "analyst_by_ticker": dict(analyst_by_ticker),
        "si_finra_by_ticker": dict(si_finra_by_ticker),
        "si_daily_by_ticker": dict(si_daily_by_ticker),
        "fwd_returns": fwd_returns,
    }
    if cache_path:
        with open(cache_path, "wb") as f:
            pickle.dump(cache, f, protocol=pickle.HIGHEST_PROTOCOL)
    return cache


def slice_marketcap_at(cache: dict, ticker: str, eff_date: date) -> float | None:
    rows = cache["caps_by_ticker"].get(ticker, [])
    last_v: float | None = None
    for d, v in rows:
        if d <= eff_date:
            last_v = v
        else:
            break
    return last_v


# ─────────────────────────────────────────────────────────────────────────────
# Bulk per-scan-date input fetchers — ONE query each
# ─────────────────────────────────────────────────────────────────────────────

def fetch_marketcap_at_date(tickers: list[str], eff_date: date) -> dict[str, float]:
    """Latest market_cap per ticker on/before eff_date."""
    if not tickers:
        return {}
    sql = f"""
      SELECT DISTINCT ON (ticker) ticker, market_cap
      FROM historical_marketcap
      WHERE ticker IN ({_qlist(tickers)}) AND as_of_date <= '{eff_date}'
      ORDER BY ticker, as_of_date DESC;
    """
    rows = _q(sql)
    out: dict[str, float] = {}
    for r in rows:
        try:
            out[r["ticker"]] = float(r["market_cap"])
        except (TypeError, ValueError):
            continue
    return out


def fetch_prices_for_window(
    tickers: list[str], window_start: date, window_end: date,
) -> dict[str, list[tuple[date, float, float]]]:
    """{ticker: [(date, close, volume), ...]} sorted asc."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, trade_date, close, volume
      FROM prices_eod
      WHERE ticker IN ({_qlist(tickers)})
        AND trade_date BETWEEN '{window_start}' AND '{window_end}'
        AND source IN ({_qlist(PRICE_SOURCES)})
      ORDER BY ticker, trade_date ASC;
    """
    rows = _q(sql)
    out: dict[str, list[tuple[date, float, float]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["trade_date"], "%Y-%m-%d").date()
            c = float(r["close"]) if r["close"] is not None else None
            v = float(r["volume"]) if r["volume"] is not None else None
        except (TypeError, ValueError):
            continue
        if c is None or v is None:
            continue
        out[r["ticker"]].append((d, c, v))
    return out


def fetch_insider_history_for_window(
    tickers: list[str], window_start: date, window_end: date,
) -> dict[str, list[dict[str, Any]]]:
    """All insider events for tickers in [start, end]."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, transaction_date, owner_name, owner_name_lower,
             transaction_code, amount, stock_price, is_officer,
             is_director, is_ten_percent_owner, is_10b5_1, marketcap
      FROM insider_history
      WHERE ticker IN ({_qlist(tickers)})
        AND transaction_date BETWEEN '{window_start}' AND '{window_end}';
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["transaction_date"], "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        r["__d"] = d
        out[r["ticker"]].append(r)
    return out


def fetch_options_flow_snapshots(
    tickers: list[str], eff_date: date,
) -> dict[str, dict[str, Any]]:
    """Latest options_flow_daily snapshot per ticker on/before eff_date."""
    if not tickers:
        return {}
    sql = f"""
      SELECT DISTINCT ON (ticker) ticker, as_of_date,
             call_premium, put_premium,
             ask_side_premium, bid_side_premium,
             sweep_count, unusual_count
      FROM options_flow_daily
      WHERE ticker IN ({_qlist(tickers)}) AND as_of_date <= '{eff_date}'
      ORDER BY ticker, as_of_date DESC;
    """
    rows = _q(sql)
    return {r["ticker"]: r for r in rows}


def fetch_congress_for_window(
    tickers: list[str], window_start: date, window_end: date,
) -> dict[str, list[dict[str, Any]]]:
    """{ticker: [congress_trades_daily rows]} in window."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, transaction_date, member_name, chamber,
             transaction_type, amount_bucket
      FROM congress_trades_daily
      WHERE ticker IN ({_qlist(tickers)})
        AND transaction_date BETWEEN '{window_start}' AND '{window_end}';
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        out[r["ticker"]].append(r)
    return out


def fetch_analyst_for_window(
    tickers: list[str], window_start: date, window_end: date,
) -> dict[str, list[dict[str, Any]]]:
    """{ticker: [analyst_ratings_daily rows]} in window."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, action_date, firm, action, recommendation,
             target_price, prev_target, broker_tier
      FROM analyst_ratings_daily
      WHERE ticker IN ({_qlist(tickers)})
        AND action_date BETWEEN '{window_start}' AND '{window_end}';
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        out[r["ticker"]].append(r)
    return out


def fetch_si_finra(
    tickers: list[str], eff_date: date, max_per_ticker: int = SI_FINRA_SETTLEMENTS,
) -> dict[str, list[dict[str, Any]]]:
    """Most recent N FINRA short_interest rows per ticker, most-recent-first."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, as_of_date, short_interest_float_pct,
             short_interest_shares, avg_daily_volume
      FROM short_interest
      WHERE ticker IN ({_qlist(tickers)}) AND as_of_date <= '{eff_date}'
        AND source = 'finra'
      ORDER BY ticker, as_of_date DESC;
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if len(out[r["ticker"]]) < max_per_ticker:
            out[r["ticker"]].append(r)
    return out


def fetch_si_daily(
    tickers: list[str], window_start: date, window_end: date,
) -> dict[str, list[dict[str, Any]]]:
    """{ticker: [short_interest_daily rows]} sorted desc."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, as_of_date, cost_to_borrow_pct, borrow_shares_available,
             ftd_quantity, short_volume_ratio
      FROM short_interest_daily
      WHERE ticker IN ({_qlist(tickers)})
        AND as_of_date BETWEEN '{window_start}' AND '{window_end}'
      ORDER BY ticker, as_of_date DESC;
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        out[r["ticker"]].append(r)
    return out


def fetch_forward_returns(tickers: list[str], eff_date: date) -> dict[str, float]:
    """21-day forward total return per ticker on as_of_date=eff_date."""
    if not tickers:
        return {}
    sql = f"""
      SELECT ticker, fwd_return_21d
      FROM forward_returns_21d
      WHERE ticker IN ({_qlist(tickers)}) AND as_of_date = '{eff_date}';
    """
    rows = _q(sql)
    out: dict[str, float] = {}
    for r in rows:
        try:
            out[r["ticker"]] = float(r["fwd_return_21d"])
        except (TypeError, ValueError):
            continue
    return out


_SPY_FWD_CACHE: dict[date, float] = {}


def _populate_spy_fwd_cache() -> None:
    """Pull SPY history once via yfinance, compute 21-trading-day forward
    close-to-close returns, populate _SPY_FWD_CACHE keyed by as_of date."""
    if _SPY_FWD_CACHE:
        return
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        return
    df = yf.download("SPY", start="2025-04-01", end="2026-06-30",
                     auto_adjust=False, progress=False)
    if df is None or df.empty:
        return
    closes = df["Close"]
    # closes is a DataFrame with one column (named 'SPY') in newer yfinance.
    if hasattr(closes, "columns"):
        closes = closes.iloc[:, 0]
    closes = closes.dropna()
    dates = [d.date() if hasattr(d, "date") else d for d in closes.index]
    prices = closes.tolist()
    for i, d in enumerate(dates):
        j = i + 21
        if j < len(prices) and prices[i] not in (0, None):
            ret = (prices[j] - prices[i]) / prices[i]
            _SPY_FWD_CACHE[d] = float(ret)


def fetch_spy_forward(eff_date: date) -> float | None:
    """Return SPY's 21-day forward return on eff_date, from the in-memory
    cache (populated lazily via yfinance)."""
    if not _SPY_FWD_CACHE:
        _populate_spy_fwd_cache()
    return _SPY_FWD_CACHE.get(eff_date)


# ─────────────────────────────────────────────────────────────────────────────
# Insider helper — pure logic mirroring v5 insider_score.score() but on
# pre-fetched rows.
# ─────────────────────────────────────────────────────────────────────────────

def _insider_compute_from_rows(
    rows_in_window: list[dict[str, Any]],
    all_ticker_rows: list[dict[str, Any]],
    eff_date: date,
) -> int | None:
    """Pure logic replicating insider_score.score() with pre-fetched rows."""
    buys = [r for r in rows_in_window
            if (r.get("transaction_code") or "").upper() == "P"]
    sells = [r for r in rows_in_window
             if (r.get("transaction_code") or "").upper() == "S"]

    gate_start = eff_date - timedelta(days=INSIDER_WINDOW_DAYS)
    first_buy_fires = False
    if buys:
        opp_buyers = {(r.get("owner_name") or "").strip().lower()
                      for r in buys
                      if not bool(r.get("is_10b5_1", False))}
        look_lo = gate_start - timedelta(days=FIRST_BUY_LOOKBACK_DAYS)
        # Build a set of (owner, code='P') from all_ticker_rows in the prior window
        prior_buyers = set()
        for r in all_ticker_rows:
            d = r.get("__d")
            if d is None:
                continue
            if look_lo <= d < gate_start and (r.get("transaction_code") or "").upper() == "P":
                prior_buyers.add((r.get("owner_name") or "").strip().lower())
        for owner in opp_buyers:
            if owner and owner not in prior_buyers:
                first_buy_fires = True
                break

    def row_to_v2(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "amount": int(r.get("amount") or 0),
            "stock_price": float(r.get("stock_price") or 0.0),
            "owner_name": r.get("owner_name") or "",
            "is_officer": bool(r.get("is_officer", False)),
            "is_routine": bool(r.get("is_10b5_1", False)),
        }

    v2_buys = [row_to_v2(r) for r in buys]
    v2_sells = [row_to_v2(r) for r in sells]
    v2_sig = compute_insider_signal(v2_buys, v2_sells)
    if v2_sig is None:
        return None
    boosted = v2_sig + (10 if (first_buy_fires and v2_sig > 0) else 0)
    return max(-100, min(100, boosted))


# ─────────────────────────────────────────────────────────────────────────────
# Result row
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class V5ScanRow:
    scan_date: str
    ticker: str
    market_cap: float | None
    cap_bucket: str | None
    mt_score: float | None
    band: str | None
    sub_scores: str  # JSON
    weights_used: str  # JSON
    cap_discount_applied: float | None
    fwd_return_21d: float | None
    spy_fwd_return_21d: float | None
    alpha_vs_spy: float | None
    skip_reason: str | None


# ─────────────────────────────────────────────────────────────────────────────
# Per-scan-date driver
# ─────────────────────────────────────────────────────────────────────────────

def _process_scan_date(
    scan_date_iso: str,
    eff_date_iso: str,
    universe: list[str],
    weights: dict[str, float] | None = None,
    universe_cap_min: float = 300_000_000.0,
    universe_cap_max: float = float("inf"),
) -> tuple[list[V5ScanRow], dict[str, int]]:
    eff_date = datetime.strptime(eff_date_iso, "%Y-%m-%d").date()

    # 1) Market cap PIT
    caps = fetch_marketcap_at_date(universe, eff_date)
    in_band = [t for t in universe
               if t in caps and universe_cap_min <= caps[t] <= universe_cap_max]
    skip_no_cap = sum(1 for t in universe if t not in caps)
    skip_out_band = sum(1 for t in universe
                        if t in caps and not (universe_cap_min <= caps[t] <= universe_cap_max))

    # 2) Prices
    price_start = eff_date - timedelta(days=PRICE_LOOKBACK_DAYS)
    prices = fetch_prices_for_window(in_band, price_start, eff_date)

    # 3) Insider 425d
    ins_start = eff_date - timedelta(days=INSIDER_LOOKBACK_DAYS)
    insiders = fetch_insider_history_for_window(in_band, ins_start, eff_date)

    # 4) Options snapshot (most-recent on/before scan date)
    options = fetch_options_flow_snapshots(in_band, eff_date)

    # 5) Congress 90d
    cong_start = eff_date - timedelta(days=CONGRESS_LOOKBACK_DAYS)
    congress = fetch_congress_for_window(in_band, cong_start, eff_date)

    # 6) Analyst 90d
    ana_start = eff_date - timedelta(days=ANALYST_LOOKBACK_DAYS)
    analyst = fetch_analyst_for_window(in_band, ana_start, eff_date)

    # 7+8) Short interest
    si_finra = fetch_si_finra(in_band, eff_date)
    si_daily_start = eff_date - timedelta(days=SI_DAILY_LOOKBACK_DAYS)
    si_daily = fetch_si_daily(in_band, si_daily_start, eff_date)

    # 9) Forward returns
    fwd = fetch_forward_returns(in_band, eff_date)
    spy_fwd = fetch_spy_forward(eff_date)

    rows: list[V5ScanRow] = []
    skips: dict[str, int] = defaultdict(int)
    skips["out_of_universe_cap_band"] += skip_out_band
    skips["no_marketcap_row"] += skip_no_cap

    insider_window_start = eff_date - timedelta(days=INSIDER_WINDOW_DAYS)

    for ticker in in_band:
        mcap = caps[ticker]
        bucket = cap_bucket(mcap)
        prx = prices.get(ticker, [])
        prx_to_eff = [p for p in prx if p[0] <= eff_date]
        if len(prx_to_eff) < TRAILING_CLOSES_REQUIRED:
            rows.append(V5ScanRow(scan_date_iso, ticker, mcap, bucket, None, None,
                                   "{}", "{}", None,
                                   fwd.get(ticker), spy_fwd, None, "lt_51_closes"))
            skips["lt_51_closes"] += 1
            continue
        closes_chrono = [p[1] for p in prx_to_eff]
        volumes_chrono = [p[2] for p in prx_to_eff]

        # ── Compute each sub_score ────────────────────────────────────────
        # Insider
        all_ins = insiders.get(ticker, [])
        ins_in_window = [r for r in all_ins
                         if r.get("__d") is not None and insider_window_start <= r["__d"] <= eff_date]
        try:
            insider_sub = _insider_compute_from_rows(ins_in_window, all_ins, eff_date)
        except Exception:
            insider_sub = None

        # Options
        opt_snap = options.get(ticker)
        try:
            options_sub, _ = compute_options_signal(opt_snap)
        except Exception:
            options_sub = None

        # Congress
        try:
            congress_sub, _ = compute_congress_signal(congress.get(ticker, []))
        except Exception:
            congress_sub = None

        # Technicals
        try:
            tech_sub, _ = compute_technicals_signal(closes_chrono, volumes_chrono)
        except Exception:
            tech_sub = None

        # Analyst — needs spot
        spot = closes_chrono[-1] if closes_chrono else None
        try:
            analyst_sub, _ = compute_analyst_signal(analyst.get(ticker, []), spot)
        except Exception:
            analyst_sub = None

        # Short Interest
        try:
            si_sub, _ = compute_short_interest_signal(
                si_finra.get(ticker, []),
                si_daily.get(ticker, []),
                closes_chrono,
                days_to_earnings=None,  # earnings calendar not in scope for Phase 3
            )
        except Exception:
            si_sub = None

        sub_scores = {
            "insider":        insider_sub,
            "options":        options_sub,
            "congress":       congress_sub,
            "technicals":     tech_sub,
            "analyst":        analyst_sub,
            "short_interest": si_sub,
        }

        composite_result = v5_composite.compute_composite(
            sub_scores, market_cap=mcap, weights=weights
        )
        mt_score = composite_result["mt_score"]
        band = composite_result["band"]
        weights_used = composite_result["weights_used"]
        cap_factor = composite_result["cap_discount_applied"]

        fr = fwd.get(ticker)
        alpha = (fr - spy_fwd) if (fr is not None and spy_fwd is not None) else None

        rows.append(V5ScanRow(
            scan_date=scan_date_iso,
            ticker=ticker,
            market_cap=mcap,
            cap_bucket=bucket,
            mt_score=mt_score,
            band=band,
            sub_scores=json.dumps(sub_scores),
            weights_used=json.dumps(weights_used),
            cap_discount_applied=cap_factor,
            fwd_return_21d=fr,
            spy_fwd_return_21d=spy_fwd,
            alpha_vs_spy=alpha,
            skip_reason=None,
        ))
        if mt_score is None:
            skips["no_data_all_signals_none"] += 1
        else:
            skips["scored_ok"] += 1

    return rows, dict(skips)


# ─────────────────────────────────────────────────────────────────────────────
# Top-level runner
# ─────────────────────────────────────────────────────────────────────────────

def load_phase1_artifacts(
    scan_dates_path: str, universe_path: str,
) -> tuple[list[str], dict[str, list[str]], dict[str, str]]:
    """Reuses Phase 1 artifacts from the v4.1 harness."""
    with open(scan_dates_path) as f:
        scan_dates = [ln.strip() for ln in f if ln.strip()]
    with open(universe_path) as f:
        bundle = json.load(f)
    return scan_dates, bundle["universe_per_scan_date"], bundle.get("scan_date_to_effective_date", {})


def run_walkforward(
    scan_dates: list,
    universe_per_date: dict,
    *,
    scan_date_to_effective_date: dict | None = None,
    weights: dict[str, float] | None = None,
    output_path: str = "v5_backtest.parquet",
    universe_cap_min: float = 300_000_000.0,
    universe_cap_max: float = float("inf"),
    progress_callback=None,
) -> dict:
    iso_dates = [d if isinstance(d, str) else d.isoformat() for d in scan_dates]
    eff_map = scan_date_to_effective_date or {}

    all_rows: list[V5ScanRow] = []
    skip_totals: dict[str, int] = defaultdict(int)
    t0 = time.time()

    for i, scan_iso in enumerate(iso_dates, start=1):
        eff_iso = eff_map.get(scan_iso, scan_iso)
        universe = universe_per_date.get(scan_iso, [])
        if not universe:
            skip_totals["no_universe_for_date"] += 1
            continue
        rows, skips = _process_scan_date(
            scan_date_iso=scan_iso,
            eff_date_iso=eff_iso,
            universe=universe,
            weights=weights,
            universe_cap_min=universe_cap_min,
            universe_cap_max=universe_cap_max,
        )
        all_rows.extend(rows)
        for k, v in skips.items():
            skip_totals[k] += v
        if progress_callback:
            progress_callback(scan_iso, i, len(iso_dates))

    walltime = time.time() - t0

    df = pd.DataFrame([r.__dict__ for r in all_rows])
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
        df.to_parquet(output_path, engine="fastparquet", index=False)

    scored = df[df["skip_reason"].isna() & df["mt_score"].notna()] if not df.empty else df
    band_counts = scored["band"].value_counts().to_dict() if not scored.empty else {}

    return {
        "total_rows": int(len(df)),
        "scored_rows": int(len(scored)),
        "skip_reasons": dict(skip_totals),
        "band_distribution": band_counts,
        "mean_mt_score": float(scored["mt_score"].mean()) if not scored.empty else 0.0,
        "walltime_seconds": round(walltime, 2),
        "rows_per_second": round(len(df) / walltime, 1) if walltime > 0 else 0.0,
        "scan_dates_processed": len(iso_dates),
        "output_path": output_path,
        "weights_used": weights or dict(v5_composite.DEFAULT_WEIGHTS),
        "universe_cap_min": universe_cap_min,
        "universe_cap_max": universe_cap_max,
    }

# ─────────────────────────────────────────────────────────────────────────────
# In-memory slice helpers
# ─────────────────────────────────────────────────────────────────────────────

def _slice_window(rows: list[dict[str, Any]], lo: date, hi: date) -> list[dict[str, Any]]:
    """Filter rows by __d field in [lo, hi]."""
    return [r for r in rows if r.get("__d") is not None and lo <= r["__d"] <= hi]


def _process_scan_date_cached(
    scan_date_iso: str,
    eff_date_iso: str,
    universe: list[str],
    cache: dict,
    weights: dict[str, float] | None = None,
    universe_cap_min: float = 300_000_000.0,
    universe_cap_max: float = float("inf"),
    spy_fwd_cache: dict | None = None,
) -> tuple[list[V5ScanRow], dict[str, int]]:
    """In-memory equivalent of _process_scan_date — uses the pre-fetched
    cache produced by prefetch_full_window()."""
    eff_date = datetime.strptime(eff_date_iso, "%Y-%m-%d").date()
    insider_window_start = eff_date - timedelta(days=INSIDER_WINDOW_DAYS)
    insider_first_buy_start = eff_date - timedelta(days=INSIDER_LOOKBACK_DAYS)
    congress_window_start = eff_date - timedelta(days=CONGRESS_LOOKBACK_DAYS)
    analyst_window_start = eff_date - timedelta(days=ANALYST_LOOKBACK_DAYS)
    si_daily_start = eff_date - timedelta(days=SI_DAILY_LOOKBACK_DAYS)

    rows_out: list[V5ScanRow] = []
    skips: dict[str, int] = defaultdict(int)

    spy_fwd = (spy_fwd_cache or {}).get(eff_date)

    for ticker in universe:
        mcap = slice_marketcap_at(cache, ticker, eff_date)
        if mcap is None:
            skips["no_marketcap_row"] += 1
            continue
        if not (universe_cap_min <= mcap <= universe_cap_max):
            skips["out_of_universe_cap_band"] += 1
            continue
        bucket = cap_bucket(mcap)

        # Prices — slice up to eff_date, take last PRICE_LOOKBACK_DAYS worth
        all_prx = cache["prices_by_ticker"].get(ticker, [])
        prx_to_eff = [p for p in all_prx if p[0] <= eff_date]
        if len(prx_to_eff) < TRAILING_CLOSES_REQUIRED:
            rows_out.append(V5ScanRow(
                scan_date_iso, ticker, mcap, bucket, None, None, "{}", "{}", None,
                cache["fwd_returns"].get((ticker, eff_date)), spy_fwd, None, "lt_51_closes"
            ))
            skips["lt_51_closes"] += 1
            continue
        closes_chrono = [p[1] for p in prx_to_eff]
        volumes_chrono = [p[2] for p in prx_to_eff]

        # Insider
        all_ins = cache["insiders_by_ticker"].get(ticker, [])
        ins_in_window = [r for r in all_ins
                         if r.get("__d") is not None and insider_window_start <= r["__d"] <= eff_date]
        # Pass all_ins for first-buy lookback
        try:
            insider_sub = _insider_compute_from_rows(ins_in_window, all_ins, eff_date)
        except Exception:
            insider_sub = None

        # Options — most recent on/before eff_date
        opt_list = cache["options_by_ticker"].get(ticker, [])
        opt_snap = next((r for d, r in opt_list if d <= eff_date), None)
        try:
            options_sub, _ = compute_options_signal(opt_snap)
        except Exception:
            options_sub = None

        # Congress
        cong_rows = _slice_window(cache["congress_by_ticker"].get(ticker, []),
                                  congress_window_start, eff_date)
        try:
            congress_sub, _ = compute_congress_signal(cong_rows)
        except Exception:
            congress_sub = None

        # Technicals
        try:
            tech_sub, _ = compute_technicals_signal(closes_chrono, volumes_chrono)
        except Exception:
            tech_sub = None

        # Analyst
        ana_rows = _slice_window(cache["analyst_by_ticker"].get(ticker, []),
                                 analyst_window_start, eff_date)
        spot = closes_chrono[-1] if closes_chrono else None
        try:
            analyst_sub, _ = compute_analyst_signal(ana_rows, spot)
        except Exception:
            analyst_sub = None

        # Short Interest
        all_finra = cache["si_finra_by_ticker"].get(ticker, [])
        finra_on_or_before = [r for r in all_finra
                              if r.get("__d") is not None and r["__d"] <= eff_date][:SI_FINRA_SETTLEMENTS]
        all_sid = cache["si_daily_by_ticker"].get(ticker, [])
        sid_in_window = [r for r in all_sid
                         if r.get("__d") is not None and si_daily_start <= r["__d"] <= eff_date]
        try:
            si_sub, _ = compute_short_interest_signal(
                finra_on_or_before, sid_in_window, closes_chrono, days_to_earnings=None,
            )
        except Exception:
            si_sub = None

        sub_scores = {
            "insider":        insider_sub,
            "options":        options_sub,
            "congress":       congress_sub,
            "technicals":     tech_sub,
            "analyst":        analyst_sub,
            "short_interest": si_sub,
        }
        composite_result = v5_composite.compute_composite(
            sub_scores, market_cap=mcap, weights=weights,
        )
        mt_score = composite_result["mt_score"]
        band = composite_result["band"]
        wu = composite_result["weights_used"]
        cf = composite_result["cap_discount_applied"]

        fr = cache["fwd_returns"].get((ticker, eff_date))
        alpha = (fr - spy_fwd) if (fr is not None and spy_fwd is not None) else None

        rows_out.append(V5ScanRow(
            scan_date=scan_date_iso, ticker=ticker, market_cap=mcap, cap_bucket=bucket,
            mt_score=mt_score, band=band,
            sub_scores=json.dumps(sub_scores), weights_used=json.dumps(wu),
            cap_discount_applied=cf, fwd_return_21d=fr,
            spy_fwd_return_21d=spy_fwd, alpha_vs_spy=alpha, skip_reason=None,
        ))
        if mt_score is None:
            skips["no_data_all_signals_none"] += 1
        else:
            skips["scored_ok"] += 1

    return rows_out, dict(skips)


def run_walkforward_cached(
    scan_dates: list,
    universe_per_date: dict,
    cache: dict,
    *,
    scan_date_to_effective_date: dict | None = None,
    weights: dict[str, float] | None = None,
    output_path: str = "v5_backtest.parquet",
    universe_cap_min: float = 300_000_000.0,
    universe_cap_max: float = float("inf"),
    progress_callback=None,
) -> dict:
    """Like run_walkforward but uses pre-fetched cache → no SQL during the loop."""
    _populate_spy_fwd_cache()
    iso_dates = [d if isinstance(d, str) else d.isoformat() for d in scan_dates]
    eff_map = scan_date_to_effective_date or {}
    all_rows: list[V5ScanRow] = []
    skip_totals: dict[str, int] = defaultdict(int)
    t0 = time.time()

    for i, scan_iso in enumerate(iso_dates, start=1):
        eff_iso = eff_map.get(scan_iso, scan_iso)
        universe = universe_per_date.get(scan_iso, [])
        if not universe:
            skip_totals["no_universe_for_date"] += 1
            continue
        rows, skips = _process_scan_date_cached(
            scan_date_iso=scan_iso, eff_date_iso=eff_iso, universe=universe,
            cache=cache, weights=weights,
            universe_cap_min=universe_cap_min, universe_cap_max=universe_cap_max,
            spy_fwd_cache=_SPY_FWD_CACHE,
        )
        all_rows.extend(rows)
        for k, v in skips.items():
            skip_totals[k] += v
        if progress_callback:
            progress_callback(scan_iso, i, len(iso_dates))

    walltime = time.time() - t0
    df = pd.DataFrame([r.__dict__ for r in all_rows])
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
        df.to_parquet(output_path, engine="fastparquet", index=False)

    scored = df[df["skip_reason"].isna() & df["mt_score"].notna()] if not df.empty else df
    band_counts = scored["band"].value_counts().to_dict() if not scored.empty else {}
    return {
        "total_rows": int(len(df)),
        "scored_rows": int(len(scored)),
        "skip_reasons": dict(skip_totals),
        "band_distribution": band_counts,
        "mean_mt_score": float(scored["mt_score"].mean()) if not scored.empty else 0.0,
        "walltime_seconds": round(walltime, 2),
        "rows_per_second": round(len(df) / walltime, 1) if walltime > 0 else 0.0,
        "scan_dates_processed": len(iso_dates),
        "output_path": output_path,
        "weights_used": weights or dict(v5_composite.DEFAULT_WEIGHTS),
        "universe_cap_min": universe_cap_min,
        "universe_cap_max": universe_cap_max,
    }
