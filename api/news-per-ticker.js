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

// Resolve a Google News redirect URL to its final destination. Used to
// display the actual publisher domain (seekingalpha.com, zerohedge.com,
// etc.) instead of the title-derived label which can disagree with what
// the link actually opens. Best-effort: 2s timeout per item; on failure
// returns null and the caller falls back to the title-derived source.
async function resolveFinalUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (MacroTilt/1.0)" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return r.url || null;
  } catch (_) {
    return null;
  }
}

// Friendlier display names for common publisher hostnames.
const HOST_DISPLAY = {
  "seekingalpha.com":   "Seeking Alpha",
  "zerohedge.com":      "ZeroHedge",
  "bloomberg.com":      "Bloomberg",
  "reuters.com":        "Reuters",
  "wsj.com":            "Wall Street Journal",
  "ft.com":             "Financial Times",
  "cnbc.com":           "CNBC",
  "marketwatch.com":    "MarketWatch",
  "fool.com":           "The Motley Fool",
  "barrons.com":        "Barron's",
  "forbes.com":         "Forbes",
  "businessinsider.com":"Business Insider",
  "yahoo.com":          "Yahoo Finance",
  "investors.com":      "Investor's Business Daily",
  "benzinga.com":       "Benzinga",
};

function hostnameToDisplay(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    // Strip subdomain like 'finance.yahoo.com' → 'yahoo.com' for the lookup
    const parts = host.split(".");
    const root = parts.length >= 2 ? parts.slice(-2).join(".") : host;
    return { host, display: HOST_DISPLAY[root] || HOST_DISPLAY[host] || root };
  } catch (_) {
    return { host: "", display: "" };
  }
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
  const candidates = [];
  for (const it of raw) {
    if (!it.headline || !it._sourceKey) continue;
    if (!WHITELIST_SET.has(it._sourceKey)) continue;
    const key = dedupeKey(it.headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(it);
    if (candidates.length >= 10) break;
  }

  // Resolve final URLs in parallel — bounded fan-out; total wall clock ≤ 2s.
  // This makes source attribution match the actual destination domain.
  const resolved = await Promise.all(candidates.map(it => resolveFinalUrl(it.url)));
  const filtered = candidates.map((it, i) => {
    const finalUrl = resolved[i] || it.url;
    const { host, display } = hostnameToDisplay(finalUrl);
    // Pick the displayed source HONESTLY:
    //   - If the resolved host is news.google.com (GN serves the article
    //     inline; redirect to the publisher only fires client-side), the
    //     server cannot know the real destination. Use the title-derived
    //     publisher name with '(via Google News)' suffix so the user
    //     knows the link is a GN redirect.
    //   - If the resolved host is a real publisher domain, use the
    //     destination-derived source — this matches what the user lands
    //     on.
    //   - Fall back to '(via Google News)' or just 'via Google News'
    //     when nothing better is available.
    const isStillGN = host === "news.google.com" || host === "google.com";
    let displaySource;
    if (resolved[i] && display && !isStillGN) {
      displaySource = display;
    } else if (it.source) {
      displaySource = it.source + " (via Google News)";
    } else if (display && !isStillGN) {
      displaySource = display;
    } else {
      displaySource = "via Google News";
    }
    return {
      headline:    it.headline,
      source:      displaySource,
      source_host: host,
      url:         finalUrl,
      published:   it.published,
      description: it.description,
    };
  });

  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
  return res.status(200).json({ source: "google_news", items: filtered });
}
