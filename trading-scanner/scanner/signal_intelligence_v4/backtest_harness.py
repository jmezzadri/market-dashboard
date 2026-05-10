"""
v4.1 Walk-forward backtest harness — Phase 2 scaffold.

Loops scan_dates × universe, assembles point-in-time inputs from Supabase,
calls score_ticker(), joins forward 21d returns, writes one row per
(scan_date, ticker) attempt to a parquet file.

Reads from Phase 1 deliverables:
  - prices_eod          (deepened via yfinance backfill)
  - historical_marketcap (point-in-time cap, single-shares-snapshot approx)
  - forward_returns_21d (close-to-close 21-trading-day forward return)
  - insider_history     (P/S codes, owner, amount, stock_price, is_officer)

Per the operating manual (V4_HARNESS_DATA_LAYER_NOTES.md sec.4): bulk-fetch
inputs PER SCAN DATE in 4 queries (not per-ticker), then walk the universe
in memory. This keeps SQL round-trips O(scan_dates) not O(scan_dates x universe).
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable

import pandas as pd
import requests

from scanner.signal_intelligence_v4.score import score_ticker

# Config
PROJECT_REF = "yqaqqzseepebrocgibcw"
PRICE_SOURCES = ("massive", "yfinance-v4-backfill", "yfinance-bootstrap")

TRAILING_CLOSES_REQUIRED = 51  # score_ticker needs >=51 closes for SMA50+RSI14
INSIDER_LOOKBACK_DAYS = 425    # 30-day gate window + 365-day first-buy + 30 buffer


def _q(sql: str, token: str | None = None, retries: int = 3) -> list[dict]:
    """POST a SQL query to the Supabase Management API. Retry on transient errors."""
    tok = token or os.environ["SUPABASE_ACCESS_TOKEN"]
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.post(
                f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
                headers={"Authorization": f"Bearer {tok}",
                         "Content-Type": "application/json"},
                json={"query": sql},
                timeout=120,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Supabase query failed after {retries} retries: {last_err}")


def _qlist(values: Iterable[str]) -> str:
    """Format a python iterable into a SQL IN-list of single-quoted strings."""
    cleaned = [str(v).replace("'", "''") for v in values]
    return ",".join(f"'{v}'" for v in cleaned)


# Bulk per-scan-date input fetchers

def fetch_prices_for_window(
    tickers: list[str],
    window_start: date,
    window_end: date,
) -> dict[str, list[tuple[date, float, float]]]:
    """All (trade_date, close, volume) rows for tickers between window_start and
    window_end in ONE query. Returns {ticker: [(d, close, volume), ...]} sorted asc."""
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
        d = datetime.strptime(r["trade_date"], "%Y-%m-%d").date()
        try:
            close = float(r["close"]) if r["close"] is not None else None
            volume = float(r["volume"]) if r["volume"] is not None else None
        except (TypeError, ValueError):
            continue
        if close is None or volume is None:
            continue
        out[r["ticker"]].append((d, close, volume))
    return out


def fetch_marketcap_at_date(
    tickers: list[str],
    eff_date: date,
) -> dict[str, float]:
    """Latest market_cap per ticker on/before eff_date. ONE query."""
    if not tickers:
        return {}
    sql = f"""
        SELECT DISTINCT ON (ticker) ticker, market_cap
        FROM historical_marketcap
        WHERE ticker IN ({_qlist(tickers)})
          AND as_of_date <= '{eff_date}'
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


def fetch_insider_history_for_window(
    tickers: list[str],
    window_start: date,
    window_end: date,
) -> dict[str, list[dict[str, Any]]]:
    """All insider events for tickers in [window_start, window_end]. ONE query."""
    if not tickers:
        return {}
    sql = f"""
        SELECT ticker, transaction_date AS date, owner_name AS owner,
               transaction_code, amount, stock_price, is_officer
        FROM insider_history
        WHERE ticker IN ({_qlist(tickers)})
          AND transaction_date BETWEEN '{window_start}' AND '{window_end}';
    """
    rows = _q(sql)
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        try:
            d = datetime.strptime(r["date"], "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        out[r["ticker"]].append({
            "date": d,
            "owner": r.get("owner") or "",
            "transaction_code": r.get("transaction_code") or "",
            "amount": int(r.get("amount") or 0),
            "stock_price": float(r.get("stock_price") or 0.0),
            "is_officer": bool(r.get("is_officer")),
        })
    return out


def fetch_forward_returns(
    tickers: list[str],
    eff_date: date,
) -> dict[str, float]:
    """21-day forward return per ticker on as_of_date=eff_date. ONE query."""
    if not tickers:
        return {}
    sql = f"""
        SELECT ticker, fwd_return_21d
        FROM forward_returns_21d
        WHERE ticker IN ({_qlist(tickers)})
          AND as_of_date = '{eff_date}';
    """
    rows = _q(sql)
    out: dict[str, float] = {}
    for r in rows:
        try:
            out[r["ticker"]] = float(r["fwd_return_21d"])
        except (TypeError, ValueError):
            continue
    return out


@dataclass
class _ScanRow:
    scan_date: str
    ticker: str
    market_cap: float | None
    score: int | None
    band: str | None
    gate_pass: bool | None
    hc_eligible: bool | None
    insider_total_dollar: float | None
    fwd_return_21d: float | None
    skip_reason: str | None


def _process_scan_date(
    scan_date_iso: str,
    eff_date_iso: str,
    universe: list[str],
    cap_min: float,
    cap_max: float,
    require_first_buy: bool,
    magnitude_mode: str = "capnorm",
) -> tuple[list[_ScanRow], dict[str, int]]:
    """Score every ticker in universe on scan_date_iso. Returns (rows, skip_counts)."""
    eff_date = datetime.strptime(eff_date_iso, "%Y-%m-%d").date()

    # 1) Market cap on eff_date
    caps = fetch_marketcap_at_date(universe, eff_date)
    in_band: list[str] = [
        t for t in universe
        if t in caps and cap_min <= caps[t] <= cap_max
    ]
    skipped_no_cap = sum(1 for t in universe if t not in caps)
    skipped_out_of_band = sum(
        1 for t in universe
        if t in caps and not (cap_min <= caps[t] <= cap_max)
    )

    # 2) Prices
    price_window_start = eff_date - timedelta(days=120)
    prices = fetch_prices_for_window(in_band, price_window_start, eff_date)

    # 3) Insider history
    ins_window_start = eff_date - timedelta(days=INSIDER_LOOKBACK_DAYS)
    ins = fetch_insider_history_for_window(in_band, ins_window_start, eff_date)

    # 4) Forward returns
    fwd = fetch_forward_returns(in_band, eff_date)

    rows: list[_ScanRow] = []
    skips: dict[str, int] = defaultdict(int)
    skips["out_of_universe_cap_band"] += skipped_out_of_band
    skips["no_marketcap_row"] += skipped_no_cap

    for ticker in in_band:
        market_cap = caps[ticker]
        prx = prices.get(ticker, [])
        if not prx:
            rows.append(_ScanRow(scan_date_iso, ticker, market_cap, None, None,
                                 None, None, None, None, "no_prices"))
            skips["no_prices"] += 1
            continue
        prx_to_eff = [p for p in prx if p[0] <= eff_date]
        if len(prx_to_eff) < TRAILING_CLOSES_REQUIRED:
            rows.append(_ScanRow(scan_date_iso, ticker, market_cap, None, None,
                                 None, None, None, None, "lt_51_closes"))
            skips["lt_51_closes"] += 1
            continue
        latest = prx_to_eff[-1]
        if latest[0] != eff_date:
            if (eff_date - latest[0]).days > 5:
                rows.append(_ScanRow(scan_date_iso, ticker, market_cap, None, None,
                                     None, None, None, None, "stale_prices"))
                skips["stale_prices"] += 1
                continue

        closes_for_indicators = [p[1] for p in prx_to_eff[-TRAILING_CLOSES_REQUIRED:]]
        today_close = closes_for_indicators[-1]
        volume_today = prx_to_eff[-1][2]

        if len(prx_to_eff) < 22:
            avg_volume_22d = None
        else:
            vols_22 = [p[2] for p in prx_to_eff[-22:]]
            avg_volume_22d = sum(vols_22) / 22.0
        if avg_volume_22d is None or avg_volume_22d <= 0:
            rows.append(_ScanRow(scan_date_iso, ticker, market_cap, None, None,
                                 None, None, None, None, "no_avg_volume"))
            skips["no_avg_volume"] += 1
            continue

        insider_history = ins.get(ticker, [])
        fwd_ret = fwd.get(ticker)

        try:
            sr = score_ticker(
                ticker=ticker,
                score_date=eff_date,
                today_close=today_close,
                volume_today=volume_today,
                avg_volume_22d=avg_volume_22d,
                closes_for_indicators=closes_for_indicators,
                insider_history=insider_history,
                require_first_buy=require_first_buy,
                data_source="memory",
                market_cap=market_cap,
                magnitude_mode=magnitude_mode,
            )
        except Exception as e:  # noqa: BLE001
            rows.append(_ScanRow(scan_date_iso, ticker, market_cap, None, None,
                                 None, None, None, fwd_ret, f"score_error:{type(e).__name__}"))
            skips["score_error"] += 1
            continue

        rows.append(_ScanRow(
            scan_date=scan_date_iso,
            ticker=ticker,
            market_cap=market_cap,
            score=sr.score,
            band=sr.band.value,
            gate_pass=sr.gate_pass,
            hc_eligible=sr.hc_eligible,
            insider_total_dollar=sr.insider_dollar_tiebreaker,
            fwd_return_21d=fwd_ret,
            skip_reason=None,
        ))
        skips["scored_ok"] += 1

    return rows, dict(skips)


def run_walkforward(
    scan_dates: list,
    universe_per_date: dict,
    universe_cap_min: float,
    universe_cap_max: float,
    require_first_buy: bool = True,
    output_path: str = "backtest_results.parquet",
    *,
    scan_date_to_effective_date: dict | None = None,
    magnitude_mode: str = "capnorm",
    progress_callback=None,
) -> dict:
    """Loop scan_dates x universe; assemble Phase 1 inputs; call score_ticker;
    join forward 21d return; write one row per attempt to parquet."""
    iso_dates: list[str] = [
        d if isinstance(d, str) else d.isoformat() for d in scan_dates
    ]
    eff_map = scan_date_to_effective_date or {}

    all_rows: list[_ScanRow] = []
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
            cap_min=universe_cap_min,
            cap_max=universe_cap_max,
            require_first_buy=require_first_buy,
            magnitude_mode=magnitude_mode,
        )
        all_rows.extend(rows)
        for k, v in skips.items():
            skip_totals[k] += v
        if progress_callback:
            progress_callback(scan_iso, i, len(iso_dates))

    walltime_s = time.time() - t0

    df = pd.DataFrame([r.__dict__ for r in all_rows])
    if output_path:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        df.to_parquet(output_path, engine="fastparquet", index=False)

    scored = df[df["skip_reason"].isna()] if not df.empty else df
    band_counts = (
        scored["band"].value_counts().to_dict() if not scored.empty else {}
    )
    signals_fired = int(
        ((scored["band"] == "Watch") | (scored["band"] == "High Conviction")).sum()
    ) if not scored.empty else 0

    return {
        "total_rows": int(len(df)),
        "scored_rows": int(len(scored)),
        "skip_reasons": dict(skip_totals),
        "signals_fired": signals_fired,
        "mean_score_when_scored": float(scored["score"].mean()) if not scored.empty else 0.0,
        "band_distribution": band_counts,
        "walltime_seconds": round(walltime_s, 2),
        "rows_per_second": round(len(df) / walltime_s, 1) if walltime_s > 0 else 0.0,
        "scan_dates_processed": len(iso_dates),
        "output_path": output_path,
        "require_first_buy": require_first_buy,
        "magnitude_mode": magnitude_mode,
        "cap_band": {"min": universe_cap_min, "max": universe_cap_max},
    }


def load_phase1_artifacts(
    scan_dates_path: str,
    universe_path: str,
) -> tuple[list[str], dict[str, list[str]], dict[str, str]]:
    """Read the Phase 1 scan_dates txt + universe json. Returns (dates, universe_map, eff_map)."""
    with open(scan_dates_path) as f:
        scan_dates = [ln.strip() for ln in f if ln.strip()]
    with open(universe_path) as f:
        bundle = json.load(f)
    universe = bundle["universe_per_scan_date"]
    eff_map = bundle.get("scan_date_to_effective_date", {})
    return scan_dates, universe, eff_map
