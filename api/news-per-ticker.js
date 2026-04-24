// Per-ticker news feed — Google News RSS with reputable-source whitelist.
//
// Bug #1017 — the UW /api/news/headlines endpoint is substring-matched and
// frequently returns the same story multiple times with low-quality coverage.
// This endpoint pulls per-ticker headlines from Google News RSS (which itself
// aggregates across publishers), filters to a reputable-source whitelist
// (WSJ, Reuters, Bloomberg, FT, CNBC, Fox Business, Zero Hedge, plus a few
// adjacent financials), dedupes by normalized title, and surfaces the source
// name so the reader can see provenance at a glance.
//
// This endpoint is designed to be additive: the Ticker Detail modal merges
// the response with the existing UW signals.news[ticker] array so UW remains
// a supplementary source (flow-related items UW is good at still show up).
//
// Query: ?ticker=NVDA                  → symbol-only search
// Query: ?ticker=NVDA&company=NVIDIA   → symbol + company name, tighter match
//
// Response: { source: "google_news", items: [...] }

const GN_BASE = "https://news.google.com/rss/search";

// Whitelist of publishers we'll accept for a given ticker. Matching is
// case-insensitive and done against the "- Publisher" suffix Google News
// attaches to every title ("Headline - Bloomberg.com"), as well as a few
// known aliases.
const WHITELIST = [
  // Tier-1 financial press
  "bloomberg", "bloomberg.com",
  "reuters",
  "wall street journal", "wsj", "wsj.com",
  "financial times", "ft", "ft.com",
  "cnbc",
  "fox business",
  "zerohedge", "zero hedge",
  // Tier-2 — high signal, permissible for Option B scope
  "barron's", "barrons",
  "marketwatch",
  "seeking alpha",
  "the motley fool", "motley fool",
  "yahoo finance",
  "investor's business daily", "investors business daily",
];
const WHITELIST_SET = new Set(WHITELIST.map((s) => s.toLowerCase()));

// Map raw publisher names (as emitted by Google News) to their display form.
// Falls through to the raw name if no override.
const DISPLAY_NAME = {
  "bloomberg.com": "Bloomberg",
  "wsj": "Wall Street Journal",
  "wsj.com": "Wall Street Journal",
  "ft": "Financial Times",
  "ft.com": "Financial Times",
  "cnbc.com": "CNBC",
  "zero hedge": "ZeroHedge",
  "barron's": "Barron's",
  "barrons": "Barron's",
  "the motley fool": "The Motley Fool",
  "motley fool": "The Motley Fool",
};

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
  return decodeEntities((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Google News titles land as "Headline - Bloomberg.com". Split on the last
// " - " separator so we pick up the publisher even when the headline itself
// contains a dash.
function splitTitle(raw) {
  if (!raw) return { headline: "", source: "" };
  const t = raw.trim();
  const m = t.match(/^(.*)\s[-–—]\s([^-–—]+)$/);
  if (!m) return { headline: t, source: "" };
  return { headline: m[1].trim(), source: m[2].trim() };
}

// Normalize a headline for dedupe purposes: strip punctuation, collapse
// whitespace, lowercase. Keeps the first ~80 chars so slight rewordings
// don't look like distinct stories.
function dedupeKey(headline) {
  return (headline || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function parseRssItems(xml) {
  if (!xml) return [];
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">");
      const mm = block.match(r);
      return mm ? stripHtml(mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    items.push({
      _rawTitle: pick("title"),
      link:      pick("link"),
      pubDate:   pick("pubDate"),
      source:    pick("source"),   // GN sometimes includes <source url="...">Publisher</source>
      description: pick("description"),
    });
  }
  return items;
}

function shape(raw) {
  const split = splitTitle(raw._rawTitle);
  const publisher = (raw.source || split.source || "").trim();
  return {
    headline:    split.headline || raw._rawTitle || "",
    source:      DISPLAY_NAME[publisher.toLowerCase()] || publisher,
    _sourceKey:  publisher.toLowerCase(),
    url:         raw.link,
    published:   raw.pubDate,
    description: raw.description,
  };
}

export default async function handler(req, res) {
  const ticker = String(req.query?.ticker || "").trim().toUpperCase();
  const company = String(req.query?.company || "").trim();
  if (!ticker || !/^[A-Z.\-]{1,8}$/.test(ticker)) {
    return res.status(400).json({ error: "ticker required (1-8 chars)" });
  }

  // Build the GN search query: ticker + optional company + finance markers +
  // when:7d cap. Encoding is conservative — we only allow alnum/space/dots
  // in `company` to avoid feeding arbitrary input into the URL.
  const safeCompany = company.replace(/[^A-Za-z0-9 .&]/g, "");
  const q = [`"${ticker}"`, safeCompany ? `"${safeCompany}"` : "", "(stock OR shares OR earnings)"]
    .filter(Boolean)
    .join(" ") + " when:7d";
  const url = new URL(GN_BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  let xml = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (MacroTilt/1.0; +macrotilt.com)",
        "Accept": "application/rss+xml, text/xml, */*",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      return res.status(200).json({ source: "google_news", items: [], warning: `GN ${r.status}` });
    }
    xml = await r.text();
  } catch (e) {
    return res.status(200).json({ source: "google_news", items: [], warning: String(e && e.message || e) });
  }

  const raw = parseRssItems(xml).map(shape);
  const seen = new Set();
  const filtered = [];
  for (const it of raw) {
    if (!it.headline || !it._sourceKey) continue;
    if (!WHITELIST_SET.has(it._sourceKey)) continue;
    const key = dedupeKey(it.headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    filtered.push({
      headline:    it.headline,
      source:      it.source,
      url:         it.url,
      published:   it.published,
      description: it.description,
    });
    if (filtered.length >= 20) break;
  }

  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
  return res.status(200).json({ source: "google_news", items: filtered });
}
