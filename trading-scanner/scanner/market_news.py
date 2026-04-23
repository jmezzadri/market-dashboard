"""
Market news feeds — non-ticker-specific macro / market headlines that
complement the ticker-level UW news shown in the dashboard modal.

Home feed sources (2026-04-23 expansion):
    ZeroHedge — direct RSS (cms.zerohedge.com fullrss2.xml)
    CNBC Markets — direct RSS
    Bloomberg — Google News RSS proxy (publisher killed public RSS)
    Reuters — Google News RSS proxy
    Financial Times — Google News RSS proxy
    Wall Street Journal — Google News RSS proxy

Why Google News for four of six:
    Bloomberg / Reuters / FT / WSJ no longer ship public RSS. Google
    News RSS is the cleanest substitute — well-formed XML, correct
    pubDate, stable uptime. Tradeoff: the item <link> is a
    news.google.com URL that JS-redirects to the publisher when opened
    in a browser. One extra hop on click; title + description + date
    are correct and attributable.

Design:
    - Every fetcher returns items tagged with a `source` name and
      `source_tier="public"` so the frontend can render them without
      gating and a dedupe pass upstream sees every item.
    - `fetch_zerohedge_premium(creds)` is a stub today. Joe has a ZH
      Premium subscription he'd like to use, but premium content cannot
      be redistributed to other dashboard users without violating ZH's
      ToS + his subscription agreement. Premium path, when wired up,
      should write to a user-scoped Supabase row so only he sees those
      items. Current implementation: reads creds from env, logs a
      "not implemented" warning, and returns [].
    - Per-source HTTP is sequential with a tight timeout. If a source
      is down the others still ship.

Output shape (per item):
    {
        "source":      "Bloomberg",         # display name
        "source_tier": "public" | "premium",
        "headline":    str,                  # publisher suffix stripped
        "description": str,                  # first 1–2 sentences or RSS <description>
        "url":         str,                  # Google News redirect for GN sources
        "published":   str ISO8601 UTC,
        "categories":  list[str],
    }

None of these fields is free-form from untrusted user input: values
come straight from the publisher's feed. Strings are trimmed and capped
so a malformed feed can't bloat the JSON artifact.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import timezone
from typing import Any
from xml.etree import ElementTree as ET

import requests

logger = logging.getLogger(__name__)

# HTTP timeout per source so a slow feed can't stall the whole scan.
_HTTP_TIMEOUT = 8

# Caps on items and description length — defensive against a malformed
# feed dumping 10MB of HTML into the scan artifact.
_MAX_ITEMS_PER_SOURCE = 25
_MAX_DESCRIPTION_CHARS = 360

_UA = "Mozilla/5.0 (MacroTilt/1.0; +macrotilt.com)"
_HDRS = {"User-Agent": _UA}

# ── Direct-RSS sources ───────────────────────────────────────────────────
# URLs are env-overridable so we can rotate without a code redeploy if a
# publisher changes their feed path.
ZH_PUBLIC_RSS_URL = os.environ.get(
    "ZEROHEDGE_PUBLIC_RSS_URL",
    # The www.zerohedge.com host returns 404 for RSS — the actual feed
    # is served from the CMS subdomain. Discovered 2026-04-19 by
    # inspecting the homepage HTML for inline feed URLs.
    "https://cms.zerohedge.com/fullrss2.xml",
)

# CNBC Markets section. More on-topic than their Top News feed (which
# mixes in international / politics / consumer stories).
CNBC_MARKETS_RSS_URL = os.environ.get(
    "CNBC_MARKETS_RSS_URL",
    "https://www.cnbc.com/id/10001147/device/rss/rss.html",
)

# ── Google News RSS proxy sources ────────────────────────────────────────
_GN_BASE = "https://news.google.com/rss/search"

# Per-source queries. `when:1d` caps the lookback to the last 24h so the
# feed stays fresh. Site filters are deliberately narrow to publisher
# URL paths that index real articles (avoids print-edition stubs,
# crossword puzzles, corrections, etc.).
_GN_QUERIES: dict[str, str] = {
    "Bloomberg": "site:bloomberg.com/news+when:1d",
    "Reuters":   "(site:reuters.com/markets+OR+site:reuters.com/business+OR+site:reuters.com/world)+when:1d",
    "FT":        "site:ft.com/content+when:1d",
    "WSJ":       "(site:wsj.com/finance+OR+site:wsj.com/economy+OR+site:wsj.com/business)+when:1d",
}

# Google News titles arrive with a trailing " - Publisher" suffix
# ("Headline - Bloomberg.com"). Strip before display + before dedupe.
# Each pattern is anchored to end-of-string and matches the dash-space
# separator GN uses (hyphen, en-dash, or em-dash).
_TITLE_SUFFIX_RE = re.compile(
    r"\s*[-–—]\s*(?:"
    r"Bloomberg(?:\.com)?|"
    r"Reuters|"
    r"Financial\s+Times|FT\.com|"
    r"WSJ|The\s+Wall\s+Street\s+Journal|"
    r"CNBC|"
    r"ZeroHedge"
    r")\s*$",
    re.IGNORECASE,
)


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
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def _clean_title(title: str) -> str:
    """Strip Google-News-style ' - Publisher' suffixes so the UI source
    column doesn't duplicate the tag and dedupe lines up across sources."""
    if not title:
        return ""
    return _TITLE_SUFFIX_RE.sub("", title.strip()).strip()


def _norm_title_key(title: str) -> str:
    """Normalized key for cross-source dedupe. Lowercase, strip
    non-alphanumerics, take the first 80 chars. Catches wire duplicates
    like Reuters / Bloomberg reprinting the same headline with minor
    punctuation differences."""
    key = re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()
    return key[:80]


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
        raw_title = (item.findtext("title") or "").strip()
        title = _clean_title(raw_title)
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


def _fetch(url: str, source: str) -> list[dict[str, Any]]:
    """HTTP + RSS parse helper. Tags every item with the source name and
    public tier. Returns [] on any error so the overall aggregation
    keeps running."""
    try:
        resp = requests.get(url, timeout=_HTTP_TIMEOUT, headers=_HDRS)
        resp.raise_for_status()
    except Exception as e:
        logger.warning("market_news: %s fetch failed (%s): %s", source, url, e)
        return []
    items = _parse_rss(resp.content)
    for it in items:
        it["source"] = source
        it["source_tier"] = "public"
    return items


def fetch_zerohedge_public() -> list[dict[str, Any]]:
    """ZeroHedge public RSS. No auth — headlines every visitor would see."""
    return _fetch(ZH_PUBLIC_RSS_URL, "ZeroHedge")


def fetch_cnbc_public() -> list[dict[str, Any]]:
    """CNBC Markets section RSS. Direct publisher feed, no proxy."""
    return _fetch(CNBC_MARKETS_RSS_URL, "CNBC")


def fetch_google_news(source: str) -> list[dict[str, Any]]:
    """Google News RSS proxy for publishers without public RSS.
    `source` must be a key in _GN_QUERIES."""
    q = _GN_QUERIES.get(source)
    if not q:
        logger.warning("market_news: no Google News query for %s", source)
        return []
    url = f"{_GN_BASE}?q={q}&hl=en-US&gl=US&ceid=US:en"
    return _fetch(url, source)


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
    if not os.environ.get("ZEROHEDGE_USER"):
        # No creds configured — silent no-op, not a warning, so scan logs stay clean.
        return []
    logger.info(
        "market_news: ZH premium creds detected but premium fetch not yet "
        "implemented. Skipping. See scanner/market_news.py docstring for the "
        "follow-up plan (cookie login + premium listing scrape)."
    )
    return []


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop duplicate headlines across sources, keeping the first
    occurrence. Wire services often republish each other — this trims
    the obvious collisions without needing a semantic diff."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for it in items:
        key = _norm_title_key(it.get("headline"))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def get_market_news() -> dict[str, Any]:
    """
    Aggregate every public market-news source into a single dict.

    Returns:
        {
          "items":             [...]  # flat list across all sources,
                                       # deduped, newest-first. New path
                                       # used by the 2026-04-23 multi-
                                       # source frontend.
          "zerohedge_public":  [...]  # legacy key — ZH-only subset.
                                       # Retained for back-compat with
                                       # older frontend bundles; safe to
                                       # remove once every deployed bundle
                                       # reads `items`.
          "zerohedge_premium": [...]  # stubbed; always [] today.
        }

    Empty lists are allowed so the frontend can render a blank section
    without hitting undefined.
    """
    all_items: list[dict[str, Any]] = []
    all_items += fetch_zerohedge_public()
    all_items += fetch_cnbc_public()
    all_items += fetch_google_news("Bloomberg")
    all_items += fetch_google_news("Reuters")
    all_items += fetch_google_news("FT")
    all_items += fetch_google_news("WSJ")

    all_items = _dedupe(all_items)
    # Newest first. Missing dates sort to the bottom.
    all_items.sort(key=lambda x: x.get("published") or "", reverse=True)

    return {
        "items": all_items,
        "zerohedge_public":  [it for it in all_items if it.get("source") == "ZeroHedge"],
        "zerohedge_premium": fetch_zerohedge_premium(),
    }
