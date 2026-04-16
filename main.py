"""
Trading Signal Scanner — entry point.

Runs the full Unusual Whales → score → covered call → report pipeline.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from config import (
    CC_MIN_IV_RANK,
    CONGRESS_LOOKBACK_DAYS,
    DARKPOOL_LOOKBACK_DAYS,
    FLOW_LOOKBACK_DAYS,
    INSIDER_LOOKBACK_DAYS,
    INSIDER_REVERSAL_LOOKBACK,
    MAX_STOCK_PRICE,
    MIN_MARKET_CAP,
    MIN_STOCK_PRICE,
    SCORE_BUY_ALERT,
    SCORE_WATCH_ALERT,
)
from scanner import notifier, reporter, schwab, unusual_whales as uw
from scanner.price_history import clear_ohlcv_cache, clear_price_changes_cache
from scanner.technicals import clear_tech_cache, get_technicals
from scanner.covered_calls import find_covered_call
from scanner.portfolio_io import load_covered_calls, load_portfolio_positions
from scanner.scan_state import load_last_scores, save_last_scores
from scanner.scorer import score_ticker
from scanner.sell_signals import check_covered_call_alerts, check_position_alerts

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _parse_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def extract_all_tickers(signals: dict[str, Any]) -> list[str]:
    """Union of tickers appearing in any signal source."""
    s: set[str] = set()
    for row in signals.get("congress_buys") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    for row in signals.get("congress_sells") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    for row in signals.get("insider_buys") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    for row in signals.get("insider_buys_90d") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    for row in signals.get("flow_alerts") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    for row in signals.get("darkpool") or []:
        t = row.get("ticker")
        if t:
            s.add(str(t).upper())
    sc = signals.get("screener") or {}
    if isinstance(sc, dict):
        for k in sc:
            if k:
                s.add(str(k).upper())
    return sorted(s)


def _market_cap_for_ticker(ticker: str, signals: dict[str, Any]) -> float | None:
    sym = ticker.upper()
    sc = signals.get("screener") or {}
    if isinstance(sc, dict) and sym in sc:
        v = _parse_float(sc[sym].get("marketcap"))
        if v is not None:
            return v
    for row in signals.get("flow_alerts") or []:
        if (row.get("ticker") or "").upper() == sym:
            v = _parse_float(row.get("marketcap"))
            if v is not None:
                return v
    return None


def filter_tickers_with_reasons(
    tickers: list[str], signals: dict[str, Any]
) -> tuple[list[str], list[tuple[str, str]]]:
    """
    Price band + market cap (when known).
    Returns (passed_tickers, rejected as (ticker, reason)).
    """
    passed: list[str] = []
    rejected: list[tuple[str, str]] = []
    for t in tickers:
        price = uw.get_current_price(t, signals)
        if price is None:
            logger.debug("Skipping %s: no price", t)
            rejected.append((t, "no_price"))
            continue
        if not (MIN_STOCK_PRICE <= price <= MAX_STOCK_PRICE):
            logger.debug("Skipping %s: price %s out of band", t, price)
            rejected.append((t, f"price_out_of_band (price={price:.2f})"))
            continue
        mcap = _market_cap_for_ticker(t, signals)
        if mcap is not None and mcap < MIN_MARKET_CAP:
            logger.debug("Skipping %s: market cap %s below minimum", t, mcap)
            rejected.append((t, f"mcap_below_min (mcap={mcap:,.0f})"))
            continue
        passed.append(t)
    return passed, rejected


def apply_stock_filters(tickers: list[str], signals: dict[str, Any]) -> list[str]:
    """Price band + market cap (when known)."""
    passed, _ = filter_tickers_with_reasons(tickers, signals)
    return passed


def run_scan(scan_type: str = "intraday", *, debug: bool = False) -> None:
    """
    scan_type options: "premarket", "intraday", "postmarket", "weekly"
    """
    uw.clear_company_name_cache()
    clear_ohlcv_cache()
    clear_price_changes_cache()
    clear_tech_cache()
    print(f"Starting {scan_type} scan...")

    signals: dict[str, Any] = {
        "congress_buys": uw.get_congress_trades(),
        "congress_sells": uw.get_congress_sells(),
        "insider_buys": uw.get_insider_transactions(),
        "insider_buys_90d": uw.get_insider_transactions(INSIDER_REVERSAL_LOOKBACK),
        "insider_sales": uw.get_insider_sales(),
        "flow_alerts": uw.get_options_flow_alerts(),
        "put_flow_alerts": uw.get_put_flow_alerts(),
        "darkpool": uw.get_darkpool_trades(),
        "screener": uw.get_stock_screener(),
    }

    if debug:
        print("\n--- DEBUG: raw signal counts ---")
        print(
            f"  congress rows: {len(signals.get('congress_buys') or [])}  "
            f"(date_from ≈ last {CONGRESS_LOOKBACK_DAYS} calendar days)"
        )
        print(
            f"  insider rows:  {len(signals.get('insider_buys') or [])}  "
            f"(date_from ≈ last {INSIDER_LOOKBACK_DAYS} calendar days)"
        )
        print(
            f"  flow alerts:   {len(signals.get('flow_alerts') or [])}  "
            f"(filtered to ~last {FLOW_LOOKBACK_DAYS} day(s) when timestamps exist)"
        )
        print(
            f"  dark pool:     {len(signals.get('darkpool') or [])}  "
            f"(filtered to ~last {DARKPOOL_LOOKBACK_DAYS} day(s) when executed_at exists)"
        )
        sc = signals.get("screener") or {}
        print(f"  screener keys: {len(sc) if isinstance(sc, dict) else 0}")

    all_tickers = extract_all_tickers(signals)
    filtered, rejected = filter_tickers_with_reasons(all_tickers, signals)
    signals["_filtered_tickers"] = filtered
    signals["_stocks_scanned_count"] = len(filtered)

    if debug:
        print(f"\n--- DEBUG: universe ---")
        print(f"  unique tickers (union of sources): {len(all_tickers)}")
        print(f"  after price (${MIN_STOCK_PRICE}-${MAX_STOCK_PRICE}) + mcap (if known ≥ ${MIN_MARKET_CAP:,.0f}): {len(filtered)}")
        if rejected:
            print(f"  rejected by filters: {len(rejected)} (showing up to 25)")
            for t, why in rejected[:25]:
                print(f"    {t}: {why}")
            if len(rejected) > 25:
                print(f"    … +{len(rejected) - 25} more")

    # Score every ticker that passed stock filters
    all_scores: list[tuple[str, int]] = [
        (ticker, score_ticker(ticker, signals)) for ticker in filtered
    ]
    all_scores.sort(key=lambda x: x[1], reverse=True)
    signals["_score_by_ticker"] = dict(all_scores)
    signals["_technicals"] = {t: get_technicals(t) for t in filtered}

    if debug:
        print(f"\n--- DEBUG: top 10 scores (buy ≥{SCORE_BUY_ALERT}, watch {SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1}) ---")
        for t, s in all_scores[:10]:
            if s >= SCORE_BUY_ALERT:
                tier = "BUY"
            elif s >= SCORE_WATCH_ALERT:
                tier = "WATCH"
            else:
                tier = "—"
            print(f"  {t:6}  {s:3}/100  [{tier}]")
        print(
            f"\n--- DEBUG: all {len(all_scores)} filtered tickers (watch floor {SCORE_WATCH_ALERT}) ---"
        )
        for t, s in all_scores[:50]:
            flagged = "≥ watch" if s >= SCORE_WATCH_ALERT else "below watch"
            print(f"  {t:6}  {s:3}/100  ({flagged})")
        if len(all_scores) > 50:
            print(f"  … +{len(all_scores) - 50} more not shown")
        n_buy = sum(1 for _, s in all_scores if s >= SCORE_BUY_ALERT)
        n_watch = sum(
            1 for _, s in all_scores if SCORE_WATCH_ALERT <= s < SCORE_BUY_ALERT
        )
        print(f"  → buy-tier: {n_buy}, watch-tier: {n_watch}\n")

    watch_and_above = [(t, s) for t, s in all_scores if s >= SCORE_WATCH_ALERT]
    buy_scored = [(t, s) for t, s in watch_and_above if s >= SCORE_BUY_ALERT]
    watch_scored = [
        (t, s) for t, s in watch_and_above if SCORE_WATCH_ALERT <= s < SCORE_BUY_ALERT
    ]

    # Pre-fetch options chains once for every buy+watch ticker and cache in signals.
    # This prevents the reporter from making redundant second API calls per ticker,
    # which caused silent failures (e.g. rate-limited MSFT showing "No options data").
    signals["_chain_cache"] = {}
    for _t, _ in watch_and_above:
        _sym = _t.upper()
        try:
            signals["_chain_cache"][_sym] = uw.get_options_chain(_t)
        except Exception as _e:
            logger.warning("Options chain pre-fetch failed for %s: %s", _t, _e)
            signals["_chain_cache"][_sym] = []

    buy_opportunities: list[dict[str, Any]] = []
    for ticker, sc in buy_scored:
        price = uw.get_current_price(ticker, signals)
        chain: list[dict[str, Any]] = signals["_chain_cache"].get(ticker.upper(), [])

        sc_row = (signals.get("screener") or {}).get(ticker.upper()) or {}
        ivr = _parse_float(sc_row.get("iv_rank"))
        earn = sc_row.get("next_earnings_date")
        earn_s = str(earn).strip()[:10] if earn is not None and str(earn).strip() else None

        cc = None
        cc_note = None
        if price is not None and chain:
            cc = find_covered_call(
                ticker,
                price,
                chain,
                iv_rank=ivr,
                next_earnings_date=earn_s,
            )
            if (
                cc is None
                and ivr is not None
                and ivr < CC_MIN_IV_RANK
            ):
                cc_note = (
                    "Not recommended — IV rank below minimum; wait for IV expansion or revisit strikes later."
                )

        buy_opportunities.append(
            {
                "ticker": ticker,
                "score": sc,
                "covered_call": cc,
                "current_price": price,
                "cc_note": cc_note,
            }
        )

    watch_items: list[dict[str, Any]] = [
        {
            "ticker": t,
            "score": s,
            "current_price": uw.get_current_price(t, signals),
        }
        for t, s in watch_scored
    ]

    positions = schwab.get_positions()
    cash = schwab.get_cash_balance()
    open_calls = schwab.get_open_options()

    portfolio_positions = load_portfolio_positions()
    portfolio_cc = load_covered_calls()
    buy_score_map = {t: s for t, s in buy_scored}
    watch_score_map = {t: s for t, s in watch_scored}
    prev_scores = load_last_scores()
    current_score_map = {t: s for t, s in all_scores}
    sell_alerts = check_position_alerts(
        portfolio_positions,
        signals,
        signals.get("screener") or {},
        buy_score_map,
        watch_score_map,
        prev_scores=prev_scores,
        current_scores=current_score_map,
    )
    sell_alerts.extend(check_covered_call_alerts(portfolio_cc, signals))
    save_last_scores(current_score_map)

    reporter.generate_report(
        scan_type,
        buy_opportunities,
        watch_items,
        positions,
        cash,
        open_calls,
        signals,
        portfolio_positions=portfolio_positions,
        portfolio_covered_calls=portfolio_cc,
        sell_alerts=sell_alerts,
    )

    if notifier.should_send(buy_opportunities, watch_items, sell_alerts):
        subj, html_b, text_b = reporter.build_email_content(
            scan_type,
            buy_opportunities,
            watch_items,
            sell_alerts,
            signals,
            portfolio_positions=portfolio_positions,
        )
        notifier.send_alert_email(subj, html_b, text_b)

    print(
        f"Scan complete. Buy tier (≥{SCORE_BUY_ALERT}): {len(buy_opportunities)}, "
        f"Watch tier ({SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1}): {len(watch_items)}, "
        f"portfolio alerts: {len(sell_alerts)}."
    )


if __name__ == "__main__":
    raw = [a for a in sys.argv[1:] if a != "--debug"]
    debug = "--debug" in sys.argv[1:]
    scan = raw[0] if raw else "intraday"
    run_scan(scan, debug=debug)
