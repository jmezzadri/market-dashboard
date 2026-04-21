"""
Market news feeds — non-ticker-specific macro / market headlines that
complement the ticker-level UW news shown in the dashboard modal.

Design:
- `fetch_zerohedge_public()` returns headlines from ZH's public RSS.
  Any user of the dashboard sees these (baked into the public
  latest_scan_data.json artifact).
- `fetch_zerohedge_premium(creds)` is a stub today. Joe has a ZH Premium
  subscription he'd like to use, but premium content cannot be
  redistributed to other dashboard users without violating ZH's ToS +
  his subscription agreement. The premium path exists for his account
  only — when wired up, it should write to a user-scoped Supabase
  row (user_id = Joe's UID, RLS-protected) so only he sees premium items.
  Current implementation: reads creds from env, logs a "not implemented"
  warning, and returns []. Follow-up work: verify ZH offers a
  credential-scoped RSS or API; otherwise a cookie-based login flow +
  scraping premium-article listings is the fallback.

Output shape (per item):
    {
        "source":      "ZeroHedge",
        "source_tier": "public" | "premium",
        "headline":    str,
        "description": str,       # first 1–2 sentences, or RSS <description>
        "url":         str,
        "published":   str ISO8601,
        "categories":  list[str],
    }

None of these fields is free-form from untrusted user input: values come
straight from the publisher's feed. Strings are trimmed and capped at a
reasonable length so a malformed feed can't bloat the JSON artifact.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

import requests

logger = logging.getLogger(__name__)

# Public RSS endpoint. Overridable via env for easy rotation if ZH changes
# their feed path without having to redeploy code.
ZH_PUBLIC_RSS_URL = os.environ.get(
    "ZEROHEDGE_PUBLIC_RSS_URL",
    # The www.zerohedge.com host returns 404 for RSS — the actual feed is
    # served from the CMS subdomain. Discovered 2026-04-19 by inspecting
    # the homepage HTML for inline feed URLs.
    "https://cms.zerohedge.com/fullrss2.xml",
)

# HTTP timeout so a slow feed can't stall the whole scan.
_HTTP_TIMEOUT = 10

# Cap on items per source and per description length — defensive against
# a malformed feed dumping 10MB of HTML into the scan artifact.
_MAX_ITEMS_PER_SOURCE = 25
_MAX_DESCRIPTION_CHARS = 360


def _strip_html(html: str) -> str:
    """Remove HTML tags from an RSS description blob and collapse whitespace."""
    if not html:
        return ""
    # Drop scripts + styles entirely (their content is noise for us).
    html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    # Drop all remaining tags.
    text = re.sub(r"<[^>]+>", " ", html)
    # Decode common HTML entities we care about.
    text = (text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">"))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    # Truncate at the last word boundary before the limit.
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,.;:") + "…"


def _parse_rss_date(raw: str | None) -> str:
    """Parse RFC 822 RSS pubDate into ISO 8601 UTC. Empty string on failure."""
    if not raw:
        return ""
    # RSS pubDate is RFC 822 (e.g. "Sat, 18 Apr 2026 14:32:00 +0000").
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def _parse_rss(xml_bytes: bytes) -> list[dict[str, Any]]:
    """
    Parse a standard RSS 2.0 feed body into normalized news items.
    Silently drops entries missing a title or link.
    """
    items: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning("market_news: RSS parse failed: %s", e)
        return items

    # RSS 2.0: <rss><channel><item>…</item></channel></rss>
    channel = root.find("channel")
    if channel is None:
        return items

    for item in channel.findall("item")[:_MAX_ITEMS_PER_SOURCE]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        raw_desc = item.findtext("description") or ""
        desc = _truncate(_strip_html(raw_desc), _MAX_DESCRIPTION_CHARS)
        pub = _parse_rss_date(item.findtext("pubDate"))
        categories = [
            (c.text or "").strip()
            for c in item.findall("category")
            if (c.text or "").strip()
        ][:4]
        items.append({
            "headline":    title,
            "description": desc,
            "url":         link,
            "published":   pub,
            "categories":  categories,
        })
    return items


def fetch_zerohedge_public() -> list[dict[str, Any]]:
    """
    Pull ZeroHedge's public RSS feed. No auth — headlines every visitor
    to zerohedge.com would also see. Items tagged source_tier="public"
    so the frontend can render them without access gating.
    """
    try:
        resp = requests.get(
            ZH_PUBLIC_RSS_URL,
            timeout=_HTTP_TIMEOUT,
            headers={"User-Agent": "MacroTilt/1.0 (+macrotilt.com)"},
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning("market_news: ZH public RSS fetch failed (%s): %s",
                       ZH_PUBLIC_RSS_URL, e)
        return []
    items = _parse_rss(resp.content)
    for it in items:
        it["source"] = "ZeroHedge"
        it["source_tier"] = "public"
    return items


def fetch_zerohedge_premium() -> list[dict[str, Any]]:
    """
    Fetch ZH premium articles using Joe's credentials. Currently stubbed —
    see module docstring. When implemented:
      1. Read ZEROHEDGE_USER / ZEROHEDGE_PASS from env (GitHub Actions secrets)
      2. Establish a cookie-jar session via ZH's login endpoint
      3. Fetch the premium listing / feed
      4. Normalize and tag source_tier="premium"
    Frontend should render these only for Joe (user-scoped Supabase row,
    RLS-protected). Until wired up, returns [] so the pipeline is a no-op.
    """
    user = os.environ.get("ZEROHEDGE_USER")
    if not user:
        # No creds configured — silent no-op, not a warning, so scan logs stay clean.
        return []
    logger.info(
        "market_news: ZH premium creds detected but premium fetch not yet "
        "implemented. Skipping. See scanner/market_news.py docstring for the "
        "follow-up plan (cookie login + premium listing scrape)."
    )
    return []


def get_market_news() -> dict[str, list[dict[str, Any]]]:
    """
    Aggregate all market news sources into a single dict, keyed by source
    + tier. Empty lists are allowed so the frontend can render a blank
    section without hitting undefined.
    """
    return {
        "zerohedge_public":  fetch_zerohedge_public(),
        "zerohedge_premium": fetch_zerohedge_premium(),
    }
