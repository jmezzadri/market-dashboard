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
    WIDE_UNIVERSE_ENABLED,
)
from scanner import notifier, reporter, schwab, unusual_whales as uw
from scanner.price_history import clear_ohlcv_cache, clear_price_changes_cache
from scanner.technicals import clear_tech_cache, get_technicals
from scanner.universe_builder import build_wide_universe, direction_for_ticker
from scanner.covered_calls import find_covered_call
from scanner.portfolio_io import load_covered_calls, load_portfolio_positions, load_watchlist
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


# Tickers to exclude from the scored universe. Index/ETF products show up heavily
# in options flow and dark pool prints but they're not scannable names — they have
# no meaningful per-name fundamentals, and their options flow reflects macro
# positioning rather than ticker-specific intelligence. Dropping them cleans up
# the Flow tab and stops them from bloating the technicals universe.
_ETF_BLACKLIST: frozenset[str] = frozenset({
    # Broad market
    "SPY", "SPX", "SPXW", "SPXL", "SPXU", "SSO", "SDS",
    "QQQ", "QQQM", "TQQQ", "SQQQ", "PSQ",
    "IWM", "TNA", "TZA",
    "DIA", "UDOW", "SDOW",
    "VOO", "VTI", "VEA", "VWO", "VXUS", "IVV",
    # Sector / thematic ETFs
    "XLF", "XLK", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    "SMH", "SOXL", "SOXS", "SOXX",
    "XBI", "LABU", "LABD",
    "KRE", "KBE", "FAS", "FAZ",
    "XOP", "OIH",
    # Bonds / rates
    "TLT", "TBT", "TMF", "TMV", "IEF", "SHY", "HYG", "JNK", "LQD", "AGG", "BND",
    "TLH", "TIP", "BIL", "GOVT", "SGOV", "MUB", "EMB",
    # Volatility
    "VXX", "UVXY", "VIXY", "VIX", "SVXY",
    # Commodities
    "GLD", "IAU", "SLV", "GDX", "GDXJ", "NUGT", "DUST",
    "USO", "UCO", "SCO", "UNG", "BOIL", "KOLD",
    "DBA", "DBC",
    # International / EM
    "EEM", "EFA", "FXI", "MCHI", "YINN", "YANG", "INDA", "EWJ", "EWZ", "KWEB",
    # Crypto / misc derivatives
    "BITO", "GBTC", "IBIT", "ETHA",
    # Ticker anomalies from UW (non-equities that sneak in)
    "STATE",
})


def extract_all_tickers(signals: dict[str, Any]) -> list[str]:
    """
    Union of tickers appearing in any *scannable* signal source.

    Intentionally excludes:
      - UW bulk screener (it's a day-curated promotion list, not a signal)
      - insider_buys_90d (long-lookback — for reversal detection, not universe)
      - index/ETF products (see _ETF_BLACKLIST — they're macro tape, not tickers)

    Sources: Congress trades, insider buys/sales, options flow alerts, and dark
    pool prints. This is the public scannable universe — the same data any
    visitor to the site sees whether signed in or not.
    """
    s: set[str] = set()

    def _add(t: Any) -> None:
        if not t:
            return
        sym = str(t).upper().strip()
        if not sym or sym in _ETF_BLACKLIST:
            return
        s.add(sym)

    for row in signals.get("congress_buys") or []:
        _add(row.get("ticker"))
    for row in signals.get("congress_sells") or []:
        _add(row.get("ticker"))
    for row in signals.get("insider_buys") or []:
        _add(row.get("ticker"))
    for row in signals.get("insider_sales") or []:
        _add(row.get("ticker"))
    for row in signals.get("flow_alerts") or []:
        _add(row.get("ticker"))
    for row in signals.get("put_flow_alerts") or []:
        _add(row.get("ticker"))
    for row in signals.get("darkpool") or []:
        _add(row.get("ticker"))

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

    # Load Joe's personal book — used for the email (sell alerts, position
    # enrichment) and for his local technicals compute, but NOT as a driver
    # of the public scanned universe. This keeps the public artifact free of
    # any user data and makes signed-out/signed-in identical from a data-
    # provenance standpoint (see TRACK_B_MULTIUSER_SCOPE.md — per-user state
    # lives in Supabase on the dashboard side).
    watchlist_entries = load_watchlist()
    watchlist_tickers = [w["ticker"] for w in watchlist_entries if w.get("ticker")]
    portfolio_positions_for_universe = load_portfolio_positions()
    portfolio_tickers_for_universe = [
        (p.get("ticker") or "").upper()
        for p in portfolio_positions_for_universe
        if (p.get("ticker") or "").strip()
    ]
    personal_tickers = list({*watchlist_tickers, *portfolio_tickers_for_universe})

    # Public scannable universe — union of congress + insider + flow + darkpool,
    # filtered by price band / market cap. No personal tickers mixed in.
    all_tickers = extract_all_tickers(signals)
    filtered, rejected = filter_tickers_with_reasons(all_tickers, signals)
    signals["_filtered_tickers"] = filtered
    signals["_stocks_scanned_count"] = len(filtered)

    # Personal-tickers metadata kept on `signals` ONLY for the email + report
    # renderers (which run in-process and need these for sell alerts / "your
    # positions today" sections). The reporter's JSON-artifact writer MUST strip
    # these keys before shipping — see scanner/reporter.py::_write_scan_data_json.
    signals["_personal_tickers"] = personal_tickers
    signals["_personal_watchlist_entries"] = watchlist_entries
    signals["_personal_portfolio_positions"] = portfolio_positions_for_universe

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

    # Warm the SPY OHLCV cache once up front so per-ticker composite calls
    # (which subtract SPY returns for relative-strength) don't each pay a
    # fetch on their first call. Cheap — one yfinance call, cached thereafter.
    try:
        from scanner.price_history import get_ohlcv as _warm_ohlcv
        _warm_ohlcv("SPY")
    except Exception as _e:
        logger.debug("SPY warm-cache failed (composite RS will degrade gracefully): %s", _e)

    # Compute technicals for the public universe AND Joe's personal tickers.
    # The personal-ticker technicals are used for the email (sell alerts, "your
    # positions today"); they get filtered OUT of the public artifact in
    # reporter.py::_write_scan_data_json so no user data ships.
    portfolio_positions_early = portfolio_positions_for_universe
    portfolio_tickers = portfolio_tickers_for_universe
    all_tech_tickers = list({*filtered, *portfolio_tickers, *watchlist_tickers})
    signals["_technicals"] = {t: get_technicals(t) for t in all_tech_tickers}

    # ── Wide-universe pre-filter ──────────────────────────────────────────────
    # Gate pass over S&P 500 + Nasdaq 100 + Dow 30 (+ optional R2000). Gate
    # survivors get the full composite computed so the Technicals tab surfaces
    # names that have a technical setup even if no UW signal fired on them.
    # Direction (long/short) is captured so the dashboard can filter by bias.
    wide_long: list[str] = []
    wide_short: list[str] = []
    wide_direction_map: dict[str, str] = {}
    if WIDE_UNIVERSE_ENABLED:
        try:
            wu = build_wide_universe()
            wide_long = wu.get("long", []) or []
            wide_short = wu.get("short", []) or []
            wide_direction_map = direction_for_ticker(wu)
            # Compute composite for each survivor. _batch_fetch already warmed
            # the OHLCV cache, so get_technicals() is a cache hit → cheap.
            survivors = [s for s in (wide_long + wide_short)
                         if s not in signals["_technicals"]]
            for sym in survivors:
                signals["_technicals"][sym] = get_technicals(sym)
            if debug:
                print(f"\n--- DEBUG: wide universe ---")
                print(f"  long: {len(wide_long)}  short: {len(wide_short)}")
                print(f"  dropped: {wu.get('stats', {}).get('dropped_by_reason', {})}")
        except Exception as e:
            logger.warning("Wide-universe pass failed — continuing with UW-sourced universe: %s", e)

    # Direction tags are needed by the dashboard to drive the Technicals tab's
    # Long/Short/All filter. UW-sourced tickers without a wide-universe verdict
    # appear as direction=null on the artifact (they render under "All").
    signals["_wide_universe"] = {
        "long": wide_long,
        "short": wide_short,
        "direction_by_ticker": wide_direction_map,
    }

    # Ensure portfolio + watchlist tickers have screener data even if absent
    # from the bulk UW screener payload. Email/report-only — the public artifact
    # strips these rows back to the scannable universe.
    screener = signals.get("screener") or {}
    for sym in {*portfolio_tickers, *watchlist_tickers}:
        if sym not in screener:
            row = uw.fetch_screener_row_for_ticker(sym, signals)
            if row:
                screener[sym] = row
    signals["screener"] = screener

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

    # Modal enrichment: static-ish UW data for the dashboard's ticker-detail
    # modal. Fetched once per relevant ticker (held + watchlist + buy + watch)
    # so the Vercel frontend has everything it needs at build time (no backend).
    # Three UW endpoints: /api/stock/{t}/info, /api/news/headlines,
    # /api/screener/analysts.
    enrich_tickers: set[str] = {
        *(t.upper() for t, _ in watch_and_above),
        *(t.upper() for t in portfolio_tickers),
        *(t.upper() for t in watchlist_tickers),
    }
    signals["_info"] = {}
    signals["_news"] = {}
    signals["_analyst_ratings"] = {}
    logger.info("Enriching %d tickers for modal (info/news/analyst_ratings)", len(enrich_tickers))
    for _sym in sorted(enrich_tickers):
        try:
            signals["_info"][_sym] = uw.get_stock_info(_sym)
        except Exception as _e:
            logger.warning("info enrich failed for %s: %s", _sym, _e)
            signals["_info"][_sym] = None
        try:
            signals["_news"][_sym] = uw.get_news_for_ticker(_sym, limit=10)
        except Exception as _e:
            logger.warning("news enrich failed for %s: %s", _sym, _e)
            signals["_news"][_sym] = []
        try:
            signals["_analyst_ratings"][_sym] = uw.get_analyst_ratings_for_ticker(_sym, limit=10)
        except Exception as _e:
            logger.warning("analyst_ratings enrich failed for %s: %s", _sym, _e)
            signals["_analyst_ratings"][_sym] = []

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
