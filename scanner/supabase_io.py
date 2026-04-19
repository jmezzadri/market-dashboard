"""Supabase I/O for the multi-user watchlist supplement.

The scanner's public artifact (latest_scan_data.json) is intentionally scoped
to the base universe with watchlist tickers stripped (see reporter.py). This
module is how the scanner privately supplies per-user scan data for tickers
that live in each user's watchlist but aren't in the public universe.

Contract
--------
    load_all_watchlists() -> {user_id_uuid: [ticker, ...]}
        Pulls the full set of user watchlists from public.watchlist. Union
        of all tickers returned here is what main.py appends to its tech /
        screener / enrichment universe.

    write_user_scan_rows(user_watchlists, signals) -> None
        After main.py has computed technicals + screener + analyst_ratings +
        info + news for every watchlist ticker, call this with the per-user
        mapping. Upserts one row per (user, ticker) into public.user_scan_data.
        Also deletes stale rows (tickers the user has removed from their
        watchlist since the prior run).

Auth: uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env. Service role
bypasses RLS, which is exactly what the scanner needs — it writes on behalf
of every user. The frontend still reads through RLS (user-scoped) and cannot
see other users' rows.

Failure mode: every function returns safely (empty dict / no-op) and logs at
WARNING if credentials are missing. The scanner must still ship the public
artifact even if Supabase is down.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Client helper
# ---------------------------------------------------------------------------

def _get_client():
    """Lazy-import supabase-py. Returns None if creds missing or lib absent."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.warning(
            "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — "
            "user-scan supplement disabled this run."
        )
        return None
    try:
        from supabase import create_client  # type: ignore
    except ImportError:
        logger.warning(
            "supabase-py not installed — user-scan supplement disabled. "
            "Add `supabase` to requirements.txt."
        )
        return None
    try:
        return create_client(url, key)
    except Exception as e:  # pragma: no cover
        logger.warning("Supabase client init failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def load_all_watchlists() -> dict[str, list[str]]:
    """Return {user_id: [ticker, ...]} across every signed-in user.

    Tickers are upper-cased and de-duplicated per user. Users with empty
    watchlists are omitted from the result.
    """
    client = _get_client()
    if client is None:
        return {}
    try:
        # Fetch everything — the watchlist table is small (~dozens of rows
        # total across users in the near term). No pagination needed yet.
        resp = client.table("watchlist").select("user_id,ticker").execute()
        rows = getattr(resp, "data", None) or []
    except Exception as e:
        logger.warning("watchlist fetch failed: %s", e)
        return {}

    out: dict[str, set[str]] = {}
    for row in rows:
        uid = str(row.get("user_id") or "").strip()
        tkr = str(row.get("ticker") or "").strip().upper()
        if not uid or not tkr:
            continue
        out.setdefault(uid, set()).add(tkr)
    return {uid: sorted(tickers) for uid, tickers in out.items() if tickers}


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

def _row_for_user_ticker(
    user_id: str,
    ticker: str,
    signals: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the per-(user, ticker) payload from the scan's in-memory signals.

    Mirrors the shapes the frontend expects after merging with the public
    artifact's signals map:
      technicals_json  ← signals._technicals[ticker]
      screener_json    ← signals.screener[ticker]
      composite_json   ← {analyst_ratings, info, news}  (other per-ticker enrichment)
    """
    T = ticker.upper()
    tech = (signals.get("_technicals") or {}).get(T)
    screener = (signals.get("screener") or {}).get(T)
    analyst = (signals.get("_analyst_ratings") or {}).get(T)
    info = (signals.get("_info") or {}).get(T)
    news = (signals.get("_news") or {}).get(T)

    # composite_json is a catch-all for the rest of the per-ticker enrichment
    # so the frontend can merge it into signals.analyst_ratings / info / news.
    # Using None keys so the server stores jsonb null where there's no data.
    composite_blob: dict[str, Any] | None = None
    if analyst or info or news:
        composite_blob = {
            "analyst_ratings": analyst or [],
            "info": info or None,
            "news": news or [],
        }

    return {
        "user_id": user_id,
        "ticker": T,
        "technicals_json": tech or None,
        "screener_json": screener or None,
        "composite_json": composite_blob,
    }


def write_user_scan_rows(
    user_watchlists: dict[str, list[str]],
    signals: dict[str, Any],
) -> dict[str, int]:
    """Upsert one row per (user, watchlist-ticker) and prune stale rows.

    Returns a summary dict {"upserted": N, "pruned": M} for logging.
    """
    summary = {"upserted": 0, "pruned": 0}
    if not user_watchlists:
        return summary
    client = _get_client()
    if client is None:
        return summary

    # ─ Upsert ────────────────────────────────────────────────────────────
    all_rows: list[dict[str, Any]] = []
    for uid, tickers in user_watchlists.items():
        for t in tickers:
            all_rows.append(_row_for_user_ticker(uid, t, signals))

    if all_rows:
        try:
            # on_conflict on the composite PK so re-running overwrites in place.
            client.table("user_scan_data").upsert(
                all_rows, on_conflict="user_id,ticker"
            ).execute()
            summary["upserted"] = len(all_rows)
        except Exception as e:
            logger.warning("user_scan_data upsert failed: %s", e)

    # ─ Prune stale rows ──────────────────────────────────────────────────
    # For each user, delete rows whose ticker is no longer in their current
    # watchlist. Done per-user so we never touch another user's data.
    for uid, tickers in user_watchlists.items():
        try:
            # Supabase python client: `not in` via .not_.in_(...)
            if tickers:
                resp = (
                    client.table("user_scan_data")
                    .delete()
                    .eq("user_id", uid)
                    .not_.in_("ticker", tickers)
                    .execute()
                )
            else:
                # Empty watchlist after a clear: delete every row for this user.
                resp = (
                    client.table("user_scan_data")
                    .delete()
                    .eq("user_id", uid)
                    .execute()
                )
            summary["pruned"] += len(getattr(resp, "data", None) or [])
        except Exception as e:
            logger.warning("user_scan_data prune failed for %s: %s", uid, e)

    logger.info(
        "user_scan_data sync: users=%d, upserted=%d, pruned=%d",
        len(user_watchlists), summary["upserted"], summary["pruned"],
    )
    return summary
