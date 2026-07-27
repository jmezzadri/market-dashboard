// eod-backfill-history — on-demand deep-history backfill for prices_eod
// (built 2026-07-27, after Joe: "why does the HUT chart only go back to
// Feb 2025 on Max?").
//
// Why: the bulk universe was backfilled through Polygon Basic, which
// silently caps history (~18 months at the time it ran — LESSONS 7.2), so
// most tickers' prices_eod starts 2025-02-03 while curated names (SPY,
// AAPL, benchmarks) carry deep 1996+ history from the one-shot Yahoo
// bootstrap. This function extends any ticker the user actually views to
// full depth using the SAME free Yahoo chart source the site already
// trusts for same-day closes (eod-same-day producer) — persisted straight
// into prices_eod per LESSONS 4.8 (backfills go to Supabase first).
//
// Basis safety (LESSONS 4.20 — one share basis per series, no fake seams):
//   • Yahoo's v8 chart "close" is split-adjusted to the CURRENT basis
//     (not dividend-adjusted) — the same basis prices_eod holds after the
//     nightly retro-split adjuster.
//   • Before writing anything we compare every overlapping session's close;
//     any date off by more than 1% aborts the whole backfill with an error.
//     No partial writes, no mixed-basis seams (4.5 fail-loud).
//   • Only rows STRICTLY OLDER than the ticker's current earliest row are
//     inserted (on-conflict do-nothing) — the Massive nightly pipeline's
//     rows are never touched.
//
// Lower bound: 1996-01-01 (Hard Rule 0.5 — never 2006; 1996 is the site
// floor). A ticker younger than that simply gets its full listed history.
//
// Idempotent + cheap: once a ticker is deep, the min-date check makes every
// later call a no-op without a vendor fetch. One Yahoo call per backfill.
//
// Request:  { ticker: "HUT" }
// Response: { ok, ticker, inserted, firstRow, skipped? , error? }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const FLOOR_ISO = "1996-01-01"; // Hard Rule 0.5
// Already-deep threshold: ~4.7 years of rows means the Max chart is honest.
const DEEP_DAYS = Math.round(4.7 * 365);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

function sb(pathAndQuery: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
}

async function sbJson(pathAndQuery: string) {
  const r = await sb(pathAndQuery, { headers: { Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`supabase ${pathAndQuery.split("?")[0]} HTTP ${r.status}`);
  return await r.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { ticker?: string } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const ticker = String(body.ticker || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return json({ ok: false, error: "ticker required" }, 400);

  try {
    // Current depth + a seam-comparison window (newest 10 rows).
    const minRow = await sbJson(`prices_eod?select=trade_date&ticker=eq.${ticker}&order=trade_date.asc&limit=1`);
    if (!minRow.length) return json({ ok: false, ticker, error: "unknown ticker (no rows in the price table)" }, 404);
    const firstExisting = String(minRow[0].trade_date);
    const ageDays = (Date.now() - Date.parse(firstExisting)) / 86400000;
    if (ageDays >= DEEP_DAYS) {
      return json({ ok: true, ticker, inserted: 0, firstRow: firstExisting, skipped: "already deep" });
    }
    const recent = await sbJson(`prices_eod?select=trade_date,close&ticker=eq.${ticker}&order=trade_date.desc&limit=10`);

    // Yahoo pull: floor → today (raw close = current split basis, no dividend adjustment).
    const p1 = Math.floor(Date.parse(FLOOR_ISO) / 1000);
    const p2 = Math.floor(Date.now() / 1000);
    const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=false`;
    const yr = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MacroTilt History Backfill/1.0)", Accept: "application/json" },
    });
    if (!yr.ok) return json({ ok: false, ticker, error: `yahoo HTTP ${yr.status}` }, 502);
    const y = await yr.json();
    const res = y?.chart?.result?.[0];
    const ts: number[] = res?.timestamp || [];
    const q = res?.indicators?.quote?.[0] || {};
    if (!ts.length || !q.close) return json({ ok: false, ticker, error: "yahoo returned no history" }, 502);

    // Session date in ET (Yahoo stamps the session open; date derived in
    // America/New_York so late-UTC stamps never roll to the next day).
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
    const bars = new Map<string, { open: number | null; high: number | null; low: number | null; close: number; volume: number | null }>();
    for (let i = 0; i < ts.length; i++) {
      const c = Number(q.close[i]);
      if (!Number.isFinite(c) || c <= 0) continue;
      const d = fmt.format(new Date(ts[i] * 1000));
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
      bars.set(d, { open: n(q.open?.[i]), high: n(q.high?.[i]), low: n(q.low?.[i]), close: c, volume: n(q.volume?.[i]) });
    }

    // SEAM CHECK (4.20): every overlapping session must agree within 1%.
    let compared = 0;
    for (const r of recent) {
      const yb = bars.get(String(r.trade_date));
      if (!yb || r.close == null) continue;
      compared++;
      const drift = Math.abs(yb.close / Number(r.close) - 1);
      if (drift > 0.01) {
        return json({
          ok: false, ticker,
          error: `basis mismatch on ${r.trade_date}: yahoo ${yb.close} vs stored ${r.close} (${(drift * 100).toFixed(2)}%) — nothing written`,
        }, 409);
      }
    }
    if (compared < 3) return json({ ok: false, ticker, error: `only ${compared} overlapping sessions to verify the price basis — nothing written` }, 409);

    // Insert only rows strictly OLDER than the current earliest.
    const rows = [...bars.entries()]
      .filter(([d]) => d < firstExisting)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([d, b]) => ({
        ticker, trade_date: d, open: b.open, high: b.high, low: b.low, close: b.close,
        volume: b.volume, source: "yahoo-backfill",
      }));
    if (!rows.length) {
      return json({ ok: true, ticker, inserted: 0, firstRow: firstExisting, skipped: "no older history at the source" });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const w = await sb("prices_eod?on_conflict=ticker,trade_date", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + 1000)),
      });
      if (!w.ok) throw new Error(`insert HTTP ${w.status}: ${(await w.text()).slice(0, 200)}`);
    }
    return json({ ok: true, ticker, inserted: rows.length, firstRow: rows[0].trade_date });
  } catch (e) {
    return json({ ok: false, ticker, error: String(e).slice(0, 300) }, 500);
  }
});
