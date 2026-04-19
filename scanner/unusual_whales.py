"""Unusual Whales API client — all HTTP calls for signal data."""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from config import (
    CONGRESS_LOOKBACK_DAYS,
    DARKPOOL_LOOKBACK_DAYS,
    FLOW_LOOKBACK_DAYS,
    INSIDER_LOOKBACK_DAYS,
    MIN_PREMIUM_UNUSUAL,
    UW_BASE_URL,
    UW_CLIENT_API_ID,
    UNUSUAL_WHALES_API_KEY,
)

logger = logging.getLogger(__name__)

# Per-process cache for /api/stock/{ticker}/info (cleared at each scan run).
_COMPANY_NAME_CACHE: dict[str, str] = {}

# Rate-limiting for per-ticker screener fallback calls.
# 18 rapid-fire calls in < 1s was triggering UW 429s and poisoning the options chain pre-fetch.
_SCREENER_LAST_CALL: float = 0.0
_SCREENER_MIN_INTERVAL: float = 0.35  # seconds between per-ticker /api/screener/stocks calls


def clear_company_name_cache() -> None:
    """Reset company-name lookups so a new scan run does not reuse stale strings."""
    _COMPANY_NAME_CACHE.clear()


def get_company_name(ticker: str) -> str:
    """
    Full company name via GET /api/stock/{ticker}/info (full_name), then yfinance, else symbol.
    Cached until clear_company_name_cache().
    """
    sym = ticker.strip().upper()
    if not sym:
        return ticker
    if sym in _COMPANY_NAME_CACHE:
        return _COMPANY_NAME_CACHE[sym]
    try:
        resp = _get(f"/api/stock/{sym}/info")
        data = resp.get("data")
        name: str | None = None
        if isinstance(data, dict):
            name = (
                data.get("full_name")
                or data.get("name")
                or data.get("company_name")
            )
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            name = (
                data[0].get("full_name")
                or data[0].get("name")
                or data[0].get("company_name")
            )
        if name and str(name).strip() and str(name).strip().upper() != sym:
            out = str(name).strip()
            _COMPANY_NAME_CACHE[sym] = out
            return out
    except Exception:
        pass

    try:
        import yfinance as yf

        info = yf.Ticker(sym).info
        yn = info.get("longName") or info.get("shortName")
        if yn and str(yn).strip():
            out = str(yn).strip()
            _COMPANY_NAME_CACHE[sym] = out
            return out
    except Exception:
        pass

    _COMPANY_NAME_CACHE[sym] = sym
    return sym


def _headers() -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {UNUSUAL_WHALES_API_KEY}",
        "Accept": "application/json",
        "UW-CLIENT-API-ID": UW_CLIENT_API_ID,
    }
    return h


def _get(path: str, params: dict[str, Any] | None = None, *, _retries: int = 3) -> dict[str, Any]:
    if not UNUSUAL_WHALES_API_KEY:
        raise RuntimeError(
            "UNUSUAL_WHALES_API_KEY is not set. Copy .env.example to .env and add your key."
        )
    url = f"{UW_BASE_URL.rstrip('/')}{path}"
    for attempt in range(_retries + 1):
        r = requests.get(url, headers=_headers(), params=params or {}, timeout=60)
        if r.status_code == 429 and attempt < _retries:
            wait = 2.0 ** attempt  # 1s → 2s → 4s
            logger.warning(
                "UW API rate limited (429) on %s — retry %d/%d after %.0fs",
                path, attempt + 1, _retries, wait,
            )
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    # Should not reach here, but satisfy type checker
    r.raise_for_status()
    return r.json()


def _iso_date_days_ago(days: int) -> str:
    d = date.today() - timedelta(days=days)
    return d.isoformat()


def _parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    s = str(val).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _row_within_utc_hours(row: dict[str, Any], hours: float, *keys: str) -> bool:
    """Keep row if any known timestamp is within the last `hours`, or if no timestamp (assume API is recent)."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    for k in keys:
        dt = _parse_dt(row.get(k))
        if dt is not None:
            return dt >= cutoff
    return True


def get_congress_trades(days_back: int = CONGRESS_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/congress/recent-trades
    Buys only; rows with null ticker excluded.
    """
    raw = _get(
        "/api/congress/recent-trades",
        {"limit": 200, "date_from": _iso_date_days_ago(days_back)},
    )
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("txn_type") or "").strip() != "Buy":
            continue
        ticker = row.get("ticker")
        if not ticker:
            continue
        out.append(dict(row))
    return out


def get_congress_sells(days_back: int = CONGRESS_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/congress/recent-trades — Sell disclosures only (for reversal vs prior buys).
    """
    raw = _get(
        "/api/congress/recent-trades",
        {"limit": 200, "date_from": _iso_date_days_ago(days_back)},
    )
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("txn_type") or "").strip() != "Sell":
            continue
        ticker = row.get("ticker")
        if not ticker:
            continue
        out.append(dict(row))
    return out


def _is_10b5_1_plan(row: dict[str, Any]) -> bool:
    """True if the API marks this transaction as a Rule 10b5-1 automatic plan (no informational value)."""
    v = row.get("is_10b5_1")
    if v is True:
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "1", "yes"):
        return True
    return False


def get_insider_transactions(days_back: int = INSIDER_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/insider/transactions
    Open-market purchases only: transaction_code == 'P' and amount > 0.
    Excludes Rule 10b5-1 plan purchases (is_10b5_1).
    """
    raw = _get(
        "/api/insider/transactions",
        {"limit": 200, "date_from": _iso_date_days_ago(days_back)},
    )
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("transaction_code") or "").strip().upper() != "P":
            continue
        if _is_10b5_1_plan(row):
            continue
        try:
            amt = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        if amt <= 0:
            continue
        out.append(dict(row))
    return out


def get_insider_sales(days_back: int = 30) -> list[dict[str, Any]]:
    """
    GET /api/insider/transactions — open-market sales (Form 4 code S).
    Used for thesis-reversal checks vs insider buys.
    """
    raw = _get(
        "/api/insider/transactions",
        {"limit": 200, "date_from": _iso_date_days_ago(days_back)},
    )
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("transaction_code") or "").strip().upper() != "S":
            continue
        if _is_10b5_1_plan(row):
            continue
        out.append(dict(row))
    return out


def _get_flow_alerts_by_type(option_type: str, limit: int = 100, lookback_days: int = FLOW_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    Internal helper: fetch flow alerts filtered to a specific option type ("call" or "put").
    Minimum premium threshold applied. Restricts to recent prints when timestamps exist.
    """
    raw = _get("/api/option-trades/flow-alerts", {"limit": limit})
    rows = raw.get("data") or []
    hours = max(lookback_days, 1) * 24.0
    out: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("type") or "").strip().lower() != option_type:
            continue
        try:
            prem = float(row.get("total_premium") or 0)
        except (TypeError, ValueError):
            prem = 0.0
        if prem < MIN_PREMIUM_UNUSUAL:
            continue
        r = dict(row)
        if not _row_within_utc_hours(
            r,
            hours,
            "executed_at",
            "created_at",
            "updated_at",
            "start_time",
            "time",
            "alert_time",
        ):
            continue
        out.append(r)
    return out


def get_options_flow_alerts(limit: int = 100, lookback_days: int = FLOW_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/option-trades/flow-alerts — calls only (used for scoring).
    """
    return _get_flow_alerts_by_type("call", limit=limit, lookback_days=lookback_days)


def get_put_flow_alerts(limit: int = 100, lookback_days: int = FLOW_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/option-trades/flow-alerts — puts only (for dashboard display, not scoring).
    """
    return _get_flow_alerts_by_type("put", limit=limit, lookback_days=lookback_days)


def get_darkpool_trades(limit: int = 100, lookback_days: int = DARKPOOL_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    """
    GET /api/darkpool/recent
    Minimum $500k print (premium field).
    Restrict to recent prints (see DARKPOOL_LOOKBACK_DAYS) when executed_at exists.
    """
    raw = _get("/api/darkpool/recent", {"limit": limit})
    rows = raw.get("data") or []
    hours = max(lookback_days, 1) * 24.0
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            prem = float(row.get("premium") or 0)
        except (TypeError, ValueError):
            prem = 0.0
        if prem < 500_000:
            continue
        r = dict(row)
        if not _row_within_utc_hours(r, hours, "executed_at", "created_at", "updated_at"):
            continue
        out.append(r)
    return out


def fetch_screener_row_for_ticker(sym: str, signals: dict[str, Any]) -> dict[str, Any] | None:
    """
    GET /api/screener/stocks?ticker={ticker}
    Per-ticker quote when the symbol is not in the top-N bulk screener list.
    (Query param is ``ticker`` — ``tickers`` can return an unrelated leaderboard row.)
    Cached on `signals` for the duration of the scan.
    """
    global _SCREENER_LAST_CALL
    sym = sym.strip().upper()
    cache: dict[str, Any | None] = signals.setdefault("_uw_quote_cache", {})
    if sym in cache:
        return cache[sym]

    # Throttle per-ticker screener calls to avoid triggering UW rate limits.
    # Without this, 18+ calls fire in < 1s and 429s cascade into the options chain pre-fetch.
    elapsed = time.monotonic() - _SCREENER_LAST_CALL
    if elapsed < _SCREENER_MIN_INTERVAL:
        time.sleep(_SCREENER_MIN_INTERVAL - elapsed)
    _SCREENER_LAST_CALL = time.monotonic()

    try:
        raw = _get(
            "/api/screener/stocks",
            {"ticker": sym, "limit": 50, "order_by": "relative_volume"},
        )
    except Exception as e:
        logger.warning("Screener quote request failed for %s: %s", sym, e)
        cache[sym] = None
        return None
    rows = raw.get("data") or []
    for row in rows:
        if str(row.get("ticker") or "").upper() == sym:
            r = dict(row)
            cache[sym] = r
            return r
    cache[sym] = None
    return None


def get_stock_screener(limit: int = 100, order_by: str = "relative_volume") -> dict[str, dict[str, Any]]:
    """
    GET /api/screener/stocks
    Returns a map ticker -> row for fast lookup in scoring and filters.
    """
    raw = _get(
        "/api/screener/stocks",
        {"limit": limit, "order_by": order_by},
    )
    rows = raw.get("data") or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        t = row.get("ticker")
        if not t:
            continue
        out[str(t).upper()] = dict(row)
    return out


def _parse_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _parse_occ_symbol(symbol: str) -> dict[str, Any] | None:
    """
    Parse an OCC option symbol like MSFT260516C00300000.
    Returns {"type": "call"|"put", "strike": float, "expiry": "YYYY-MM-DD"} or None.
    Inline duplicate of covered_calls.parse_option_symbol to avoid circular imports.
    """
    import re as _re
    from datetime import datetime as _dt
    s = str(symbol).strip().upper()
    m = _re.match(r"^([A-Z]{1,6})(\d{6})([CP])(\d{8})$", s)
    if not m:
        return None
    _, date_str, cp, strike_str = m.groups()
    try:
        expiry = _dt.strptime(date_str, "%y%m%d")
    except ValueError:
        return None
    return {
        "type": "call" if cp == "C" else "put",
        "strike": int(strike_str) / 1000.0,
        "expiry": expiry.strftime("%Y-%m-%d"),
    }


def normalize_option_contract(row: dict[str, Any]) -> dict[str, Any] | None:
    """
    Map API contract row to covered_calls.find_covered_call shape.
    The /api/stock/{ticker}/option-contracts endpoint does NOT return explicit
    strike/expiry/type fields — they are encoded in the OCC option_symbol string.
    This function parses the OCC symbol as a fallback for any missing fields.
    """
    opt_sym_str = str(row.get("option_symbol") or row.get("symbol") or "")
    parsed_sym = _parse_occ_symbol(opt_sym_str) if opt_sym_str else None

    opt_type = (row.get("option_type") or row.get("type") or "").strip().lower()
    if opt_type not in ("call", "c"):
        if parsed_sym:
            opt_type = parsed_sym["type"]
        elif "C" in opt_sym_str and not opt_type:
            opt_type = "call"
        else:
            return None
    if opt_type == "c":
        opt_type = "call"
    if opt_type != "call":
        return None

    strike = _parse_float(row.get("strike"))
    if strike is None and parsed_sym:
        strike = float(parsed_sym["strike"])
    if strike is None:
        return None

    expiry_raw = row.get("expiry") or row.get("expires") or row.get("expiration_date")
    if not expiry_raw and parsed_sym:
        expiry_raw = parsed_sym["expiry"]
    if not expiry_raw:
        return None
    expiry_s = str(expiry_raw).strip()[:10]

    bid = _parse_float(row.get("nbbo_bid") or row.get("bid"))
    if bid is None:
        bid = 0.0
    ask = _parse_float(row.get("nbbo_ask") or row.get("ask") or row.get("last"))
    if ask is None:
        ask = 0.0

    oi = row.get("open_interest") or row.get("oi")
    try:
        oi_i = int(oi) if oi is not None else None
    except (TypeError, ValueError):
        oi_i = None

    iv = row.get("iv") or row.get("implied_volatility") or row.get("implied_vol")
    iv_f = _parse_float(iv)

    return {
        "type": "call",
        "strike": strike,
        "expiry": expiry_s,
        "nbbo_bid": bid,
        "nbbo_ask": ask,
        "ask": ask,
        "iv": iv_f,
        "implied_volatility": iv_f,
        "open_interest": oi_i,
        "option_symbol": str(row.get("option_symbol") or row.get("symbol") or ""),
        "_raw": row,
    }


def get_options_chain(ticker: str) -> list[dict[str, Any]]:
    """
    GET /api/stock/{ticker}/option-contracts
    (Spec referenced /api/options/chain/{ticker}; live API uses option-contracts.)

    Returns normalized call contracts for covered call screening.
    """
    t = ticker.strip().upper()
    raw = _get(
        f"/api/stock/{t}/option-contracts",
        {
            "option_type": "call",
            "limit": 500,
            "exclude_zero_dte": "true",  # lowercase string; Python True serializes as "True"
        },
    )
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        norm = normalize_option_contract(row if isinstance(row, dict) else {})
        if norm:
            out.append(norm)
    logger.info(
        "options chain %s: %d raw rows from API, %d passed normalization",
        t, len(rows), len(out),
    )
    if rows and not out:
        # All rows failed normalization — log a sample to aid debugging
        sample = rows[0] if rows else {}
        logger.warning(
            "options chain %s: all %d rows failed normalize — sample keys: %s",
            t, len(rows), list(sample.keys())[:10],
        )
    return out


def get_current_price(ticker: str, signals: dict[str, Any]) -> float | None:
    """
    Best-effort price: screener prev_close, then flow underlying, then dark pool price.
    """
    sym = ticker.strip().upper()
    sc = signals.get("screener") or {}
    if isinstance(sc, dict) and sym in sc:
        p = _parse_float(sc[sym].get("prev_close"))
        if p is not None and p > 0:
            return p

    best: float | None = None
    for row in signals.get("flow_alerts") or []:
        if (row.get("ticker") or "").upper() != sym:
            continue
        u = _parse_float(row.get("underlying_price"))
        if u and u > 0:
            best = max(best or 0, u) if best else u
    if best:
        return best

    prices: list[float] = []
    for row in signals.get("darkpool") or []:
        if (row.get("ticker") or "").upper() != sym:
            continue
        p = _parse_float(row.get("price"))
        if p and p > 0:
            prices.append(p)
    if prices:
        return sum(prices) / len(prices)

    row = fetch_screener_row_for_ticker(sym, signals)
    if row:
        if isinstance(signals.get("screener"), dict):
            signals["screener"][sym] = row
        p = _parse_float(row.get("prev_close") or row.get("close"))
        if p is not None and p > 0:
            return p

    return None


# ───────────────────────────────────────────────────────────────────────────
# Modal-enrichment endpoints: static-ish per-ticker data for the dashboard
# ticker-detail modal (sector/description/tags, news, analyst ratings).
# Each scan run fetches these once per relevant ticker and bakes them into
# the output JSON — the Vercel frontend has no backend and can't hit UW.
# ───────────────────────────────────────────────────────────────────────────


def get_stock_info(ticker: str) -> dict[str, Any] | None:
    """
    GET /api/stock/{ticker}/info — company profile fields used by the modal.
    Returns a compact dict (None on failure) with the subset we actually render.
    """
    sym = ticker.strip().upper()
    if not sym:
        return None
    try:
        raw = _get(f"/api/stock/{sym}/info")
    except Exception as e:
        logger.warning("info fetch failed for %s: %s", sym, e)
        return None
    data = raw.get("data")
    if isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, dict):
        return None

    tags = data.get("uw_tags")
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    if not isinstance(tags, list):
        tags = []

    # UW's `short_description` is already truncated at the source (ends with "...").
    # Fetch yfinance `longBusinessSummary` as a full fallback so the dashboard's
    # "more" toggle has something real to reveal. Failure is tolerated — we still
    # ship the short description.
    long_description = None
    try:
        import yfinance as yf
        yf_info = yf.Ticker(sym).info or {}
        lbs = yf_info.get("longBusinessSummary")
        if isinstance(lbs, str) and len(lbs.strip()) > 0:
            long_description = lbs.strip()
    except Exception as e:
        logger.debug("yfinance longBusinessSummary fetch failed for %s: %s", sym, e)

    return {
        "sector": data.get("sector"),
        "tags": tags,  # renamed from uw_tags for dashboard-facing clarity
        "short_description": data.get("short_description"),
        "long_description": long_description,
        "full_name": data.get("full_name") or data.get("name"),
        "short_name": data.get("short_name"),
        "next_earnings_date": data.get("next_earnings_date"),
        "announce_time": data.get("announce_time"),  # "premarket" | "postmarket" | null
        "marketcap": data.get("marketcap"),
        "marketcap_size": data.get("marketcap_size"),
        "beta": data.get("beta"),
        "issue_type": data.get("issue_type"),
        "has_options": data.get("has_options"),
        "has_dividend": data.get("has_dividend"),
        "logo": data.get("logo"),
    }


def get_news_for_ticker(
    ticker: str, limit: int = 10, major_only: bool = False
) -> list[dict[str, Any]]:
    """
    GET /api/news/headlines?ticker={ticker}&limit={limit}
    Returns normalized list of recent headlines. `limit` caps at 100 per UW.
    Headlines can mention multiple tickers; we surface what UW attaches.
    """
    sym = ticker.strip().upper()
    if not sym:
        return []
    params: dict[str, Any] = {"ticker": sym, "limit": min(max(int(limit), 1), 100)}
    if major_only:
        params["major_only"] = "true"
    try:
        raw = _get("/api/news/headlines", params)
    except Exception as e:
        logger.warning("news fetch failed for %s: %s", sym, e)
        return []
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append({
            "headline": row.get("headline"),
            "source": row.get("source"),
            "sentiment": row.get("sentiment"),
            "is_major": bool(row.get("is_major")),
            "created_at": row.get("created_at"),
            "tickers": row.get("tickers") or [],
            "tags": row.get("tags") or [],
        })
    return out


def get_analyst_ratings_for_ticker(
    ticker: str, limit: int = 10
) -> list[dict[str, Any]]:
    """
    GET /api/screener/analysts?ticker={ticker}&limit={limit}
    Returns recent analyst actions (most recent first per UW ordering).

    IMPORTANT: param is `ticker` (singular). `tickers` (plural) is silently
    ignored by UW and returns the unfiltered leaderboard.
    """
    sym = ticker.strip().upper()
    if not sym:
        return []
    try:
        raw = _get(
            "/api/screener/analysts",
            {"ticker": sym, "limit": min(max(int(limit), 1), 100)},
        )
    except Exception as e:
        logger.warning("analyst ratings fetch failed for %s: %s", sym, e)
        return []
    rows = raw.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        # UW returns rows even when the ticker param doesn't match the row
        # ticker in some edge cases — guard with a client-side filter.
        row_ticker = str(row.get("ticker") or "").upper()
        if row_ticker and row_ticker != sym:
            continue
        out.append({
            "timestamp": row.get("timestamp"),
            "firm": row.get("firm"),
            "analyst_name": row.get("analyst_name"),
            "action": row.get("action"),  # maintained | initiated | upgraded | downgraded | reiterated | ...
            "recommendation": row.get("recommendation"),  # buy | hold | sell (lowercase)
            "target": row.get("target"),
        })
    return out
