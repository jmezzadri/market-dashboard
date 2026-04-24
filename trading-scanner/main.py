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
    SCORE_WATCH_ALERT,
    WIDE_UNIVERSE_ENABLED,
)
from scanner import notifier, reporter, schwab, unusual_whales as uw
from scanner.market_news import get_market_news
from scanner.price_history import clear_ohlcv_cache, clear_price_changes_cache
from scanner.signal_composite import (
    SCORE_BUY_ALERT_COMPOSITE,
    SCORE_WATCH_ALERT_COMPOSITE,
    compute_composite,
)
from scanner.technicals import clear_tech_cache, get_technicals
from scanner.universe_builder import build_wide_universe, direction_for_ticker
from scanner.covered_calls import find_covered_call
from scanner.portfolio_io import load_covered_calls, load_portfolio_positions, load_watchlist
from scanner.scan_state import load_last_scores, save_last_scores
from scanner.scorer import score_ticker
from scanner.sell_signals import check_covered_call_alerts, check_position_alerts
from scanner.supabase_io import load_all_watchlists, write_user_scan_rows
from scanner.api_usage_helper import log_run_summary
import uuid
from datetime import datetime, timezone

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

    # Multi-user watchlists from Supabase. The scanner needs the union of every
    # signed-in user's watchlist so it can compute technicals / screener /
    # analyst / etc. for those tickers — but the per-user mapping is kept OUT
    # of the public artifact and persisted to public.user_scan_data (RLS-scoped
    # owner-only). See scanner/supabase_io.py. Degrades gracefully to empty if
    # Supabase creds are missing or the table is unreachable.
    user_watchlists = load_all_watchlists()
    all_user_watchlist_tickers = sorted({
        t for tickers in user_watchlists.values() for t in tickers
    })
    if user_watchlists:
        logger.info(
            "Loaded %d user watchlist(s) from Supabase (%d unique tickers).",
            len(user_watchlists), len(all_user_watchlist_tickers),
        )

    # ── Wide-universe pre-filter (run first, contributes to scored universe) ──
    # Gate pass over S&P 500 + Nasdaq 100 + Dow 30 + Russell 2000 (env-toggle).
    # Survivors join the scored universe below so Buy Alerts / Near Trigger can
    # surface index names with strong technical setups even when UW signals are
    # weak — provided the fundamentals floor in score_ticker is also cleared.
    # Warm SPY OHLCV first so the wide-universe RS gate has a denominator.
    try:
        from scanner.price_history import get_ohlcv as _warm_ohlcv
        _warm_ohlcv("SPY")
    except Exception as _e:
        logger.debug("SPY warm-cache failed (composite RS will degrade gracefully): %s", _e)

    wide_long: list[str] = []
    wide_short: list[str] = []
    wide_direction_map: dict[str, str] = {}
    wu: dict[str, Any] = {}
    if WIDE_UNIVERSE_ENABLED:
        try:
            wu = build_wide_universe()
            wide_long = wu.get("long", []) or []
            wide_short = wu.get("short", []) or []
            wide_direction_map = direction_for_ticker(wu)
            if debug:
                print(f"\n--- DEBUG: wide universe ---")
                print(f"  long: {len(wide_long)}  short: {len(wide_short)}")
                print(f"  dropped: {wu.get('stats', {}).get('dropped_by_reason', {})}")
        except Exception as e:
            logger.warning("Wide-universe pass failed — continuing with UW-sourced universe: %s", e)

    # Wide-universe survivors that pass the price band. They've already cleared
    # liquidity ($10M ADV), trend, RS, and RSI gates, so we don't re-run them
    # through filter_tickers_with_reasons — that path needs a UW screener row
    # per ticker (a throttled REST call), which would cost ~14 minutes for the
    # ~2,500 R2000 names. Index membership implies large-enough mcap in
    # practice. _ETF_BLACKLIST is applied defensively in case wikipedia/iShares
    # tables include a sleeve we missed.
    wu_details = wu.get("details", {}) if isinstance(wu, dict) else {}
    wide_priced: list[str] = []
    for _sym in (wide_long + wide_short):
        _p = (wu_details.get(_sym) or {}).get("price")
        if _p is None:
            continue
        if not (MIN_STOCK_PRICE <= float(_p) <= MAX_STOCK_PRICE):
            continue
        if _sym in _ETF_BLACKLIST:
            continue
        wide_priced.append(_sym)

    # Public scannable universe — union of:
    #   (1) UW signal sources (congress + insider + flow + darkpool), filtered
    #       by price band / market cap via filter_tickers_with_reasons.
    #   (2) Wide-universe gate survivors (index members with strong technicals).
    # No personal tickers mixed in — public artifact stays user-agnostic.
    uw_sourced = extract_all_tickers(signals)
    filtered_uw, rejected = filter_tickers_with_reasons(uw_sourced, signals)
    filtered = sorted({*filtered_uw, *wide_priced})
    signals["_filtered_tickers"] = filtered
    signals["_stocks_scanned_count"] = len(filtered)

    # Direction tags exposed on the artifact so the dashboard's Technicals tab
    # can drive the Long/Short/All filter. UW-sourced tickers without a wide-
    # universe verdict appear as direction=null (they render under "All").
    signals["_wide_universe"] = {
        "long": wide_long,
        "short": wide_short,
        "direction_by_ticker": wide_direction_map,
    }

    # Personal-tickers metadata kept on `signals` ONLY for the email + report
    # renderers (which run in-process and need these for sell alerts / "your
    # positions today" sections). The reporter's JSON-artifact writer MUST strip
    # these keys before shipping — see scanner/reporter.py::_write_scan_data_json.
    signals["_personal_tickers"] = personal_tickers
    signals["_personal_watchlist_entries"] = watchlist_entries
    signals["_personal_portfolio_positions"] = portfolio_positions_for_universe

    if debug:
        print(f"\n--- DEBUG: universe ---")
        print(f"  UW-sourced (union of signals): {len(uw_sourced)}")
        print(f"  UW-sourced after price/mcap filter: {len(filtered_uw)}")
        print(f"  Wide-universe survivors added: {len(wide_priced)}")
        print(f"  Total scored set: {len(filtered)}")
        if rejected:
            print(f"  UW-sourced rejected by filters: {len(rejected)} (showing up to 25)")
            for t, why in rejected[:25]:
                print(f"    {t}: {why}")
            if len(rejected) > 25:
                print(f"    … +{len(rejected) - 25} more")

    # Score every ticker in the unified universe. Wide-universe survivors with
    # zero UW signals will fail the fundamentals floor in score_ticker (10 pts)
    # and won't reach Watch (35) — exactly the intent: tech alone can't flag.
    all_scores: list[tuple[str, int]] = [
        (ticker, score_ticker(ticker, signals)) for ticker in filtered
    ]
    all_scores.sort(key=lambda x: x[1], reverse=True)
    signals["_score_by_ticker"] = dict(all_scores)

    # Compute technicals for the public universe AND Joe's personal tickers.
    # Wide-universe OHLCV is already cached by _batch_fetch so get_technicals
    # is a cache hit for those survivors. Personal-ticker technicals are used
    # for the email (sell alerts, "your positions today") and get filtered OUT
    # of the public artifact in reporter.py::_write_scan_data_json.
    portfolio_positions_early = portfolio_positions_for_universe
    portfolio_tickers = portfolio_tickers_for_universe
    all_tech_tickers = list({
        *filtered, *portfolio_tickers, *watchlist_tickers,
        *all_user_watchlist_tickers,
    })
    signals["_technicals"] = {t: get_technicals(t) for t in all_tech_tickers}

    # Ensure screener data exists for every ticker the dashboard renders rows
    # for. Coverage scope is intentionally tighter now that the wide universe
    # includes Russell 2000 (~2,500 names): per-ticker /api/screener/stocks is
    # throttled to 0.35s/call, so blanket coverage of all wide-universe
    # survivors would cost ~14 min — over the 10-min workflow budget.
    #
    # We cover:
    #   - Personal tickers (portfolio, watchlist, multi-user watchlists)
    #   - All UW-sourced filtered tickers (typically ~200 names)
    #   - Wide-universe survivors that scored ≥ Watch (these surface on Buy /
    #     Near Trigger panels and need full screener data for IV rank, earnings,
    #     etc.). Wide-universe survivors that scored below Watch only appear on
    #     the Technicals tab, which reads price from the OHLCV cache.
    screener = signals.get("screener") or {}
    scored_watch_plus = {t.upper() for t, s in all_scores if s >= SCORE_WATCH_ALERT}
    coverage_tickers = (
        {*portfolio_tickers, *watchlist_tickers, *filtered_uw, *all_user_watchlist_tickers}
        | scored_watch_plus
    )
    for sym in coverage_tickers:
        if sym and sym not in screener:
            row = uw.fetch_screener_row_for_ticker(sym, signals)
            if row:
                screener[sym] = row
    signals["screener"] = screener

    # Legacy-tier bucket used ONLY to scope enrichment (chain cache, options
    # analyst ratings, etc.). The authoritative Buy Alert / Near Trigger tiers
    # are rebuilt on the Signal Composite further down — see `buy_scored` /
    # `watch_scored`.
    legacy_watch_and_above = [(t, s) for t, s in all_scores if s >= SCORE_WATCH_ALERT]

    if debug:
        print(f"\n--- DEBUG: top 10 legacy scores (watch floor {SCORE_WATCH_ALERT}) ---")
        for t, s in all_scores[:10]:
            tier = "WATCH+" if s >= SCORE_WATCH_ALERT else "—"
            print(f"  {t:6}  {s:3}/100  [{tier}]")
        print(
            f"\n--- DEBUG: all {len(all_scores)} filtered tickers (watch floor {SCORE_WATCH_ALERT}) ---"
        )
        for t, s in all_scores[:50]:
            flagged = "≥ watch" if s >= SCORE_WATCH_ALERT else "below watch"
            print(f"  {t:6}  {s:3}/100  ({flagged})")
        if len(all_scores) > 50:
            print(f"  … +{len(all_scores) - 50} more not shown")

    # Pre-fetch options chains once for every legacy-watch+ ticker and cache in
    # signals. This prevents the reporter from making redundant second API
    # calls per ticker, which caused silent failures (e.g. rate-limited MSFT
    # showing "No options data"). Chain cache is scoped to legacy-watch+ (not
    # composite-tier) because composite tiering depends on the analyst
    # enrichment that happens below, and we want options chains ready for any
    # ticker that MIGHT surface on the final Buy Alert / Near Trigger panels.
    signals["_chain_cache"] = {}
    for _t, _ in legacy_watch_and_above:
        _sym = _t.upper()
        try:
            signals["_chain_cache"][_sym] = uw.get_options_chain(_t)
        except Exception as _e:
            logger.warning("Options chain pre-fetch failed for %s: %s", _t, _e)
            signals["_chain_cache"][_sym] = []

    # Modal enrichment: static-ish UW data for the dashboard's ticker-detail
    # modal. Fetched once per relevant ticker (held + watchlist + legacy-watch+)
    # so the Vercel frontend has everything it needs at build time (no backend).
    # Three UW endpoints: /api/stock/{t}/info, /api/news/headlines,
    # /api/screener/analysts.
    enrich_tickers: set[str] = {
        *(t.upper() for t, _ in legacy_watch_and_above),
        *(t.upper() for t in portfolio_tickers),
        *(t.upper() for t in watchlist_tickers),
        *all_user_watchlist_tickers,
    }
    # Market-wide news (non-ticker-specific). Public sources go into the shared
    # artifact for every dashboard user; premium sources are stubbed today and
    # will be Joe-only via user-scoped Supabase row when implemented.
    try:
        signals["_market_news"] = get_market_news()
        _zh_pub = len(signals["_market_news"].get("zerohedge_public") or [])
        logger.info("Market news: ZH public=%d", _zh_pub)
    except Exception as _e:
        logger.warning("market news fetch failed: %s", _e)
        signals["_market_news"] = {}

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

    # ── Signal Composite tiering ─────────────────────────────────────────────
    # Compute the bidirectional composite (−100..+100) for every filtered
    # ticker using the enriched signals (screener, technicals, analyst ratings,
    # insider, congress, flow, dark pool). The composite is the SAME scoring
    # engine the dashboard modal uses (ported from sectionComposites.js), so
    # the Buy Alert / Near Trigger panels can no longer disagree with the
    # modal's verdict — they all run off the same number.
    #
    # Tier bands:
    #   STRONG BULL (≥60) → Buy Alert
    #   BULLISH    (≥30)  → Near Trigger
    #   below 30          → not surfaced
    composite_by_ticker: dict[str, int] = {}
    for _t in filtered:
        try:
            comp = compute_composite(_t, signals)
        except Exception as _e:
            logger.debug("composite compute failed for %s: %s", _t, _e)
            comp = None
        if comp is not None:
            composite_by_ticker[_t.upper()] = comp
    signals["_composite_by_ticker"] = composite_by_ticker

    buy_scored: list[tuple[str, int]] = []
    watch_scored: list[tuple[str, int]] = []
    for _t in filtered:
        comp = composite_by_ticker.get(_t.upper())
        if comp is None:
            continue
        if comp >= SCORE_BUY_ALERT_COMPOSITE:
            buy_scored.append((_t, comp))
        elif comp >= SCORE_WATCH_ALERT_COMPOSITE:
            watch_scored.append((_t, comp))
    # Sort each tier descending by composite score.
    buy_scored.sort(key=lambda x: x[1], reverse=True)
    watch_scored.sort(key=lambda x: x[1], reverse=True)

    if debug:
        print(
            f"\n--- DEBUG: composite tiers "
            f"(Buy Alert ≥{SCORE_BUY_ALERT_COMPOSITE}, "
            f"Near Trigger {SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1}) ---"
        )
        print(f"  → Buy Alert: {len(buy_scored)}, Near Trigger: {len(watch_scored)}")
        for t, c in buy_scored[:20]:
            legacy = signals["_score_by_ticker"].get(t, 0)
            print(f"  {t:6}  composite={c:+4d}  legacy={legacy:3d}/100  [BUY]")
        for t, c in watch_scored[:20]:
            legacy = signals["_score_by_ticker"].get(t, 0)
            print(f"  {t:6}  composite={c:+4d}  legacy={legacy:3d}/100  [NEAR]")

    buy_opportunities: list[dict[str, Any]] = []
    legacy_scores = signals.get("_score_by_ticker") or {}
    for ticker, comp in buy_scored:
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
                # Keep `score` field = legacy 0–100 for dashboard sort/display
                # backward-compat. Composite rides alongside on `composite`.
                "score": int(legacy_scores.get(ticker, 0)),
                "composite": comp,
                "covered_call": cc,
                "current_price": price,
                "cc_note": cc_note,
            }
        )

    watch_items: list[dict[str, Any]] = [
        {
            "ticker": t,
            "score": int(legacy_scores.get(t, 0)),
            "composite": c,
            "current_price": uw.get_current_price(t, signals),
        }
        for t, c in watch_scored
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

    # Multi-user watchlist supplement. Writes one row per (user, ticker) to
    # public.user_scan_data in Supabase so the dashboard can merge user-private
    # tech/screener/analyst data into the public signals map client-side. Safe
    # to call with empty creds — the module logs and returns a no-op.
    if user_watchlists:
        try:
            write_user_scan_rows(user_watchlists, signals)
        except Exception as e:  # pragma: no cover
            logger.warning("user_scan_data write failed: %s", e)

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
        f"Scan complete. Buy Alert (composite ≥{SCORE_BUY_ALERT_COMPOSITE}): "
        f"{len(buy_opportunities)}, "
        f"Near Trigger ({SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1}): "
        f"{len(watch_items)}, "
        f"portfolio alerts: {len(sell_alerts)}."
    )


if __name__ == "__main__":
    raw = [a for a in sys.argv[1:] if a != "--debug"]
    debug = "--debug" in sys.argv[1:]
    scan = raw[0] if raw else "intraday"
    _run_id = uuid.uuid4()
    _started_at = datetime.now(timezone.utc)
    try:
        run_scan(scan, debug=debug)
        # Bug #1032: one row per successful daily scanner run into
        # api_usage_log so the Admin API Usage bar chart has historical
        # per-day coverage for this workflow source (UW calls via
        # scanner.unusual_whales._get are not currently counted).
        log_run_summary(
            source="daily_scanner",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            status="success",
            notes={"scan_type": scan},
        )
    except Exception as _exc:
        log_run_summary(
            source="daily_scanner",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            status="failed",
            notes={"scan_type": scan, "error": str(_exc)[:500]},
        )
        raise
