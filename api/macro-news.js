// Macro market-news feed — multi-source RSS, fetched on demand.
//
// Powers the Home "Market News · Macro" tile. Pulls non-ticker-specific
// market / macro headlines live from six public feeds, dedupes by
// normalized title, and returns them newest-first.
//
// Why on-demand instead of baked into the daily scan: the scanner runs
// once per weekday afternoon, so headlines were up to a day stale — and
// froze entirely on 2026-05-19 when a scheduled-job typo stopped the
// scan. This endpoint is hit on page load and CDN-cached ~10 minutes, so
// the tile is never more than ~10 minutes behind the wire and there is no
// scheduled job that can silently break.
//
// Source list mirrors trading-scanner/scanner/market_news.py (the
// canonical source-of-truth doc for the feed list). Keep the two in sync.
//
// Response: { source: "macro_rss", items: [...], counts: {...} }

// ── Direct-RSS sources ──────────────────────────────────────────────────
const ZH_RSS   = "https://cms.zerohedge.com/fullrss2.xml";
const CNBC_RSS = "https://www.cnbc.com/id/10001147/device/rss/rss.html";

// ── Google News RSS proxy (Bloomberg / Reuters / FT / WSJ killed their
//    public RSS). when:1d caps the lookback to the last 24h. ───────────
const GN_BASE = "https://news.google.com/rss/search";
const GN_QUERIES = {
  Bloomberg: "site:bloomberg.com/news when:1d",
  Reuters:   "(site:reuters.com/markets OR site:reuters.com/business OR site:reuters.com/world) when:1d",
  FT:        "site:ft.com/content when:1d",
  WSJ:       "(site:wsj.com/finance OR site:wsj.com/economy OR site:wsj.com/business) when:1d",
};

const HTTP_TIMEOUT_MS   = 6000;
const MAX_ITEMS_PER_SRC = 25;
const MAX_TOTAL_ITEMS   = 90;
const MAX_DESC_CHARS    = 360;

// Google News appends " - Publisher" to every title. Strip the trailing
// known-publisher suffix before display + dedupe.
const TITLE_SUFFIX_RE =
  /\s*[-–—]\s*(?:Bloomberg(?:\.com)?|Reuters|Financial Times|FT\.com|WSJ|The Wall Street Journal|CNBC|ZeroHedge)\s*$/i;

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripHtml(s) {
  return decodeEntities((s || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Truncate at a word boundary, append an ellipsis.
function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[ ,.;:]+$/, "") + "…";
}

// Parse a standard RSS 2.0 body into raw item rows.
function parseRss(xml) {
  if (!xml) return [];
  const rows = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">");
      const mm = block.match(r);
      return mm ? stripHtml(mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    const cats = [];
    const catRe = /<category\b[^>]*>([\s\S]*?)<\/category>/g;
    let cm;
    while ((cm = catRe.exec(block)) !== null && cats.length < 4) {
      const c = stripHtml(cm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
      if (c) cats.push(c);
    }
    rows.push({
      title:       pick("title"),
      link:        pick("link"),
      pubDate:     pick("pubDate"),
      description: pick("description"),
      categories:  cats,
    });
  }
  return rows;
}

// Normalize a headline for dedupe: lowercase, strip punctuation, collapse
// whitespace, keep the first ~80 chars so slight rewordings collapse.
function dedupeKey(headline) {
  return (headline || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// RFC-822 RSS pubDate → ISO 8601 string. Empty string on failure.
function isoDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

// Fetch one feed with a hard timeout. Returns the body text, or "" on any
// failure so a single dead feed never sinks the whole response.
async function fetchFeed(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (MacroTilt/1.0; +macrotilt.com)",
        "Accept": "application/rss+xml, text/xml, */*",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return "";
    return await r.text();
  } catch (_) {
    return "";
  }
}

// Fetch + normalize one source into the shared item shape.
async function loadSource(url, sourceName, isGoogleNews) {
  const xml = await fetchFeed(url);
  return parseRss(xml)
    .slice(0, MAX_ITEMS_PER_SRC)
    .map((r) => {
      let headline = r.title;
      if (isGoogleNews) headline = headline.replace(TITLE_SUFFIX_RE, "").trim();
      return {
        source:      sourceName,
        source_tier: "public",
        headline,
        description: truncate(stripHtml(r.description), MAX_DESC_CHARS),
        url:         r.link,
        published:   isoDate(r.pubDate),
        categories:  r.categories.slice(0, 4),
      };
    })
    .filter((it) => it.headline && it.url);
}

export default async function handler(req, res) {
  const tasks = [
    loadSource(ZH_RSS,   "ZeroHedge", false),
    loadSource(CNBC_RSS, "CNBC",      false),
  ];
  for (const [name, q] of Object.entries(GN_QUERIES)) {
    const u = new URL(GN_BASE);
    u.searchParams.set("q", q);
    u.searchParams.set("hl", "en-US");
    u.searchParams.set("gl", "US");
    u.searchParams.set("ceid", "US:en");
    tasks.push(loadSource(u.toString(), name, true));
  }

  let results;
  try {
    results = await Promise.all(tasks);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ source: "macro_rss", items: [], counts: {}, warning: String((e && e.message) || e) });
  }

  // Flatten, count per source.
  const counts = {};
  let all = [];
  for (const list of results) {
    if (!Array.isArray(list)) continue;
    for (const it of list) counts[it.source] = (counts[it.source] || 0) + 1;
    all = all.concat(list);
  }

  // Dedupe by normalized title, keep first occurrence.
  const seen = new Set();
  const deduped = [];
  for (const it of all) {
    const k = dedupeKey(it.headline);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }

  // Newest first; items with no parseable date sink to the bottom.
  deduped.sort((a, b) => {
    const ta = a.published ? Date.parse(a.published) : 0;
    const tb = b.published ? Date.parse(b.published) : 0;
    return tb - ta;
  });

  const items = deduped.slice(0, MAX_TOTAL_ITEMS);

  // ~10-min CDN cache. stale-while-revalidate keeps the tile instant while
  // a fresh copy is fetched in the background.
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
  return res.status(200).json({ source: "macro_rss", items, counts });
}
