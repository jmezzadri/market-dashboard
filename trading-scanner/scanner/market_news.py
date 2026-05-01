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
    - `fetch_zerohedge_premium()` is LIVE as of 2026-04-30 (PR #10). Path 2
      implementation: reads ZEROHEDGE_COOKIE env var (an entire browser
      Cookie-header string Joe pasted from a logged-in session in Chrome
      DevTools), sets it on the request, parses the home page's __NEXT_DATA__
      JSON to find premium-tagged articles. ZH login uses Firebase + reCAPTCHA
      so direct REST is not viable from CI; the Path 2 cookie gets refreshed
      manually when ZH expires the session (Drupal default ~3 weeks).
      Premium content is rendered in the modal user-scoped to Joe — never
      redistributed to other dashboard users (ZH ToS + sub agreement).
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

import json
import logging
import os
import re
from datetime import timezone
from typing import Any
from xml.etree import ElementTree as ET

import requests

# Premium fetch — home page anchor URL. Joe's cookie unlocks the rendered
# article list; we then walk __NEXT_DATA__ to find premium-tagged entries.
ZH_HOME_URL = "https://www.zerohedge.com/"
# Premium articles tend to live under these path prefixes (the-market-ear
# is the flagship premium contributor; "premium" is sometimes a section).
_ZH_PREMIUM_PATH_HINTS = ("/the-market-ear", "/premium", "/members-only")

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


def _normalize_zh_url(path: str | None) -> str:
    """Resolve a ZH article path / partial URL into an absolute www.zerohedge.com URL."""
    if not path:
        return ""
    p = path.strip()
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if not p.startswith("/"):
        p = "/" + p
    return f"https://www.zerohedge.com{p}"


def _looks_premium(node: dict) -> bool:
    """Heuristic: is this Next.js node a premium article?
    Checks explicit premium flags first, then path-prefix hints."""
    if not isinstance(node, dict):
        return False
    # Explicit flags any reasonable Drupal/Next.js shape might use
    for k in ("is_premium", "premium", "isPremium", "field_premium"):
        v = node.get(k)
        if v in (True, "true", 1, "1"):
            return True
    # Content-type field
    ct = str(node.get("content_type") or node.get("type") or "").lower()
    if "premium" in ct:
        return True
    # Path / URL hints
    raw_path = str(node.get("url") or node.get("path") or node.get("alias") or "")
    if any(hint in raw_path for hint in _ZH_PREMIUM_PATH_HINTS):
        return True
    return False


def _extract_premium_items_from_next_data(data: Any) -> list[dict[str, Any]]:
    """Walk the __NEXT_DATA__ tree, harvest article-shaped nodes, keep premium ones.

    An "article-shaped" node has at least a title-like field plus a URL/path-like
    field. ZH's exact schema isn't documented; this is intentionally permissive
    so a small CMS schema change doesn't silently drop everything."""
    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    def _is_article_shaped(node: dict) -> bool:
        has_title = any(k in node for k in ("title", "name", "headline"))
        has_url = any(k in node for k in ("url", "path", "alias", "nid", "node_id"))
        return has_title and has_url

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            if _is_article_shaped(node) and _looks_premium(node):
                title = str(
                    node.get("title")
                    or node.get("name")
                    or node.get("headline")
                    or ""
                ).strip()
                url = _normalize_zh_url(
                    node.get("url") or node.get("path") or node.get("alias")
                )
                if title and url and url not in seen_urls:
                    seen_urls.add(url)
                    body_excerpt = ""
                    for body_key in ("teaser", "summary", "body", "field_summary", "excerpt"):
                        bv = node.get(body_key)
                        if isinstance(bv, str) and bv.strip():
                            body_excerpt = _strip_html(bv)
                            break
                        # Drupal sometimes nests body under {value: ...}
                        if isinstance(bv, dict) and isinstance(bv.get("value"), str):
                            body_excerpt = _strip_html(bv["value"])
                            break
                    pub_raw = (
                        node.get("created")
                        or node.get("published_at")
                        or node.get("publish_date")
                        or node.get("date")
                        or ""
                    )
                    out.append({
                        "title": title,
                        "url": url,
                        "body_excerpt": _truncate(body_excerpt, _MAX_DESCRIPTION_CHARS),
                        "published": str(pub_raw) if pub_raw else "",
                        "categories": (
                            node.get("categories")
                            or node.get("tags")
                            or []
                        ) if isinstance(
                            node.get("categories") or node.get("tags") or [], list
                        ) else [],
                    })
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(data)
    return out


def fetch_zerohedge_premium() -> list[dict[str, Any]]:
    """
    Fetch ZH premium articles via the cookie Joe pasted as ZEROHEDGE_COOKIE.

    Path 2 design (see PR #10 / 2026-04-30): direct REST login is blocked by
    ZH's reCAPTCHA-gated /api/v1/user/login endpoint. Instead we ride a
    real browser session: Joe pastes his entire Cookie header from
    DevTools as a GH secret; this function sets it on every request, parses
    the home page's __NEXT_DATA__ JSON for premium-tagged articles, and
    returns them tagged source_tier="premium". When ZH expires the session
    we get back a logged-out home page and silently log a warning so the
    next refresh prompt surfaces in the daily logs.

    Returns [] on missing cookie, expired cookie, fetch failure, or no
    premium articles found — never raises.
    """
    cookie = os.environ.get("ZEROHEDGE_COOKIE", "").strip()
    if not cookie:
        # No cookie configured — silent no-op, scan logs stay clean.
        return []

    sess = requests.Session()
    sess.headers.update({
        "User-Agent": _UA,
        "Cookie": cookie,
        "Accept": "text/html,application/xhtml+xml",
    })

    try:
        resp = sess.get(ZH_HOME_URL, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        logger.warning("market_news: ZH premium home fetch failed: %s", e)
        return []

    html = resp.text

    # Cookie-expired sniff: ZH home renders a "Join Premium" CTA prominently
    # only for non-premium / logged-out visitors. If we see no premium markers
    # in the HTML at all, treat the cookie as expired.
    has_premium_marker = ("zh_is_p" in html) or ("ust-p" in html)
    if not has_premium_marker:
        logger.warning(
            "market_news: ZH premium — no premium markers in home HTML. "
            "ZEROHEDGE_COOKIE likely expired. Refresh from Chrome DevTools "
            "(www.zerohedge.com → Network → request → Cookie header)."
        )
        return []

    # Pull __NEXT_DATA__ JSON (Next.js inlines initial page state here).
    m = re.search(
        r'<script\s+id="__NEXT_DATA__"[^>]*>(.+?)</script>',
        html,
        re.S,
    )
    if not m:
        logger.warning(
            "market_news: ZH premium — no __NEXT_DATA__ script tag found in home HTML. "
            "ZH may have changed their bundle structure."
        )
        return []

    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        logger.warning("market_news: ZH premium — __NEXT_DATA__ JSON parse failed: %s", e)
        return []

    raw_items = _extract_premium_items_from_next_data(data)
    if not raw_items:
        logger.info(
            "market_news: ZH premium — __NEXT_DATA__ parsed but no premium items "
            "matched our heuristic (looks_premium). Could be a slow news day or "
            "a schema change."
        )
        return []

    # Normalize to the shared item shape, cap to MAX, sort newest-first.
    out: list[dict[str, Any]] = []
    for it in raw_items[:_MAX_ITEMS_PER_SOURCE]:
        out.append({
            "source": "ZeroHedge Premium",
            "source_tier": "premium",
            "headline": it["title"][:300],
            "description": it["body_excerpt"],
            "url": it["url"],
            "published": it["published"],
            "categories": it["categories"][:4] if isinstance(it["categories"], list) else [],
        })
    out.sort(key=lambda x: x.get("published") or "", reverse=True)
    logger.info("market_news: ZH premium — fetched %d items via cookie session", len(out))
    return out


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
    # Premium items merge into the main flat list so the modal renders them
    # alongside public headlines (frontend gates display by source_tier="premium"
    # to a user-scoped row per ZH ToS — see PR #10 + the premium-rendering work
    # on the frontend).
    premium_items = fetch_zerohedge_premium()
    all_items += premium_items

    all_items = _dedupe(all_items)
    # Newest first. Missing dates sort to the bottom.
    all_items.sort(key=lambda x: x.get("published") or "", reverse=True)

    return {
        "items": all_items,
        "zerohedge_public":  [it for it in all_items if it.get("source") == "ZeroHedge"],
        # Legacy key kept for back-compat with older frontend bundles. New
        # frontends should read premium items from `items` (filter by
        # source_tier == "premium").
        "zerohedge_premium": premium_items,
    }
