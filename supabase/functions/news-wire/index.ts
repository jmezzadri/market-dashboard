// news-wire — time-stamped market headlines for the scheduled brief writers.
//
// Why this exists (2026-11-12): the Morning Brief, Midday Update, Market Close
// and Trade Idea sessions need headlines that carry a publication time ("every
// claim carries its time", HARD ACCURACY CONTRACT). Their sandbox cannot open
// most news sites and web-search snippets carry no timestamp. The Bigdata.com
// connector filled that gap from 2026-10-07 until its free credit ran out on
// 2026-11-12 11:57 ET; Joe will not pay for it. This function replaces it at
// $0: it reads the publishers' own public RSS feeds server-side (the sandbox
// reaches this host, as it does brief-latest) and returns one merged list.
//
// The one rule: A TIMESTAMP IS NEVER MADE UP. `published_at` is the feed's own
// publication time, parsed only when the feed states it with an explicit time
// zone. An item whose time is missing, unparseable, zone-less or in the future
// is DROPPED and counted in `dropped_no_timestamp` — it is never stamped with
// the fetch time. A feed that fails is reported in `sources` with ok:false; if
// every feed fails the caller gets ok:false and an empty list, and the edition
// must say its news is untimed (see scripts/brief_agent_playbook.md).
//
//   GET /functions/v1/news-wire?hours=12            last 12 hours (default; max 96)
//   GET /functions/v1/news-wire?since=2026-11-12T10:03:00Z
//   GET /functions/v1/news-wire?q=fed,treasury,oil  keep items matching ANY term
//   GET /functions/v1/news-wire?source=cnbc,fed     keep only these source ids
//   GET /functions/v1/news-wire?limit=200           default 150, max 400
//
// Public, read-only, fixed feed list (no caller-supplied URL is ever fetched).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Feed = { id: string; source: string; kind: "news" | "official" | "company"; url: string };

// Publishers' own syndication feeds. Verified 2026-11-12: each answered 200
// with zone-carrying publication times. Feeds that stamp times without a zone
// (investing.com) are deliberately left out — we do not guess a zone.
const FEEDS: Feed[] = [
  { id: "cnbc", source: "CNBC", kind: "news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  { id: "cnbc-economy", source: "CNBC", kind: "news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
  { id: "cnbc-earnings", source: "CNBC", kind: "news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135" },
  { id: "cnbc-markets", source: "CNBC", kind: "news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20409666" },
  { id: "marketwatch", source: "MarketWatch", kind: "news", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "marketwatch-bulletins", source: "MarketWatch", kind: "news", url: "https://feeds.content.dowjones.io/public/rss/mw_bulletins" },
  { id: "investinglive", source: "investingLive", kind: "news", url: "https://investinglive.com/feed/" },
  { id: "seekingalpha", source: "Seeking Alpha", kind: "news", url: "https://seekingalpha.com/market_currents.xml" },
  { id: "benzinga", source: "Benzinga", kind: "news", url: "https://www.benzinga.com/feed" },
  { id: "oilprice", source: "OilPrice.com", kind: "news", url: "https://oilprice.com/rss/main" },
  { id: "prnewswire-earnings", source: "PR Newswire (company releases)", kind: "company", url: "https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss" },
  { id: "fed", source: "Federal Reserve", kind: "official", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { id: "ecb", source: "European Central Bank", kind: "official", url: "https://www.ecb.europa.eu/rss/press.html" },
  { id: "boe", source: "Bank of England", kind: "official", url: "https://www.bankofengland.co.uk/rss/news" },
  { id: "bls", source: "Bureau of Labor Statistics", kind: "official", url: "https://www.bls.gov/feed/bls_latest.rss" },
];

const UA = "Mozilla/5.0 (compatible; MacroTiltNewsWire/1.0; +https://macrotilt.com)";
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m && m[1].trim()) return m[1];
  }
  return null;
}
function link(block: string): string | null {
  const t = tag(block, ["link"]);
  if (t && /^https?:/i.test(decode(t))) return decode(t);
  const a = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (a) return decode(a[1]);
  const g = tag(block, ["guid", "id"]);
  if (g && /^https?:/i.test(decode(g))) return decode(g);
  return null;
}

// A publication time counts only when the feed states its own time zone.
const ZONE = /(?:\bGMT\b|\bUTC?\b|\bZ$|Z$|[+-]\d{2}:?\d{2}$|\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b)/i;
function parseStamp(raw: string | null, nowMs: number): number | null {
  if (!raw) return null;
  let s = decode(raw);
  if (!s || !ZONE.test(s)) return null;
  s = s.replace(/\s+Z$/, " GMT").replace(/\bUT$/i, "GMT");
  // "Thu, 12 Nov 2026 17:10 GMT" (no seconds) -> add them for strict parsers.
  s = s.replace(/(\d{1,2}:\d{2})(\s+(?:GMT|UTC|[A-Z]{3}|[+-]\d{2}:?\d{2}))$/i, (m, hm, z) => /:\d{2}:\d{2}/.test(m) ? m : `${hm}:00${z}`);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  if (t > nowMs + 5 * 60_000) return null; // a time in the future is not a publication time
  return t;
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
function etWords(ms: number): string { return ET.format(new Date(ms)).replace(/ /g, " ") + " ET"; }

type Item = { title: string; source: string; source_id: string; kind: string; published_at: string; published_et: string; url: string | null; summary: string | null };

async function pull(f: Feed, nowMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(f.url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) return { feed: f, ok: false, error: `HTTP ${r.status}`, items: [] as Item[], dropped: 0 };
    const xml = await r.text();
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    const items: Item[] = [];
    let dropped = 0;
    for (const b of blocks) {
      const title = decode(tag(b, ["title"]) || "");
      if (!title) continue;
      const t = parseStamp(tag(b, ["pubDate", "published", "updated", "dc:date"]), nowMs);
      if (t == null) { dropped++; continue; }
      const sum = decode(tag(b, ["description", "summary"]) || "");
      items.push({
        title, source: f.source, source_id: f.id, kind: f.kind,
        published_at: new Date(t).toISOString(), published_et: etWords(t),
        url: link(b),
        summary: sum && sum.toLowerCase() !== title.toLowerCase() ? (sum.length > 240 ? sum.slice(0, 237).trimEnd() + "…" : sum) : null,
      });
    }
    return { feed: f, ok: true, error: blocks.length ? null : "feed answered with no items", items, dropped };
  } catch (e) {
    return { feed: f, ok: false, error: String((e as Error)?.message || e).slice(0, 160), items: [] as Item[], dropped: 0 };
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const nowMs = Date.now();
  let hours = Number(u.searchParams.get("hours") || 12);
  if (!Number.isFinite(hours) || hours <= 0) hours = 12;
  hours = Math.min(hours, 96);
  let sinceMs = nowMs - hours * 3600_000;
  const sinceRaw = u.searchParams.get("since");
  if (sinceRaw) {
    const s = Date.parse(sinceRaw);
    if (!Number.isFinite(s)) return new Response(JSON.stringify({ ok: false, error: "since must be an ISO time with a zone, e.g. 2026-11-12T10:03:00Z" }), { status: 400, headers: CORS });
    sinceMs = Math.max(s, nowMs - 96 * 3600_000);
  }
  const terms = (u.searchParams.get("q") || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const only = (u.searchParams.get("source") || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  let limit = Number(u.searchParams.get("limit") || 150);
  if (!Number.isFinite(limit) || limit <= 0) limit = 150;
  limit = Math.min(limit, 400);

  const feeds = only.length ? FEEDS.filter((f) => only.some((o) => f.id === o || f.id.startsWith(o + "-"))) : FEEDS;
  const results = await Promise.all(feeds.map((f) => pull(f, nowMs)));

  const seen = new Set<string>();
  let items: Item[] = [];
  let dropped = 0;
  for (const r of results) {
    dropped += r.dropped;
    for (const it of r.items) {
      if (Date.parse(it.published_at) < sinceMs) continue;
      if (terms.length) {
        const hay = (it.title + " " + (it.summary || "")).toLowerCase();
        if (!terms.some((t) => hay.includes(t))) continue;
      }
      const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  items.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  const total = items.length;
  items = items.slice(0, limit);
  const okCount = results.filter((r) => r.ok).length;

  return new Response(JSON.stringify({
    ok: okCount > 0,
    generated_at: new Date(nowMs).toISOString(),
    generated_et: etWords(nowMs),
    window: { since: new Date(sinceMs).toISOString(), since_et: etWords(sinceMs) },
    timestamp_rule: "published_at is the publisher's own stated publication time. Items without one were dropped, never stamped with the fetch time.",
    sources_ok: okCount,
    sources_failed: results.length - okCount,
    dropped_no_timestamp: dropped,
    count: items.length,
    truncated: total > items.length,
    sources: results.map((r) => ({ id: r.feed.id, source: r.feed.source, kind: r.feed.kind, ok: r.ok, items_in_feed: r.items.length, error: r.error })),
    items,
  }), { headers: CORS });
});
