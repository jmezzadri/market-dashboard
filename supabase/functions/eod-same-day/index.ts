// eod-same-day — Yahoo Finance fallback for "today's close" when Polygon
// Basic tier won't serve same-day grouped EOD.
//
// Why this exists:
//   Polygon's grouped Daily Market Summary endpoint returns HTTP 403
//   for today's date on the Basic plan ("Attempted to request today's
//   data before end of day"). Today's close only becomes available on
//   T+1. Until then, prices_eod sits a trading day behind, and the
//   drawer headline reads yesterday's close next to a chart that has
//   already updated. Yahoo's free chart endpoint publishes today's
//   close within minutes of the 4:00 PM ET bell, so we use it as a
//   per-ticker fallback for the names the user actually looks at —
//   positions, watchlist, today's scored scan universe.
//
// Cadence:
//   - Server-side: called from MASSIVE-DAILY after Polygon 403s.
//   - Client-side: fire-and-forget on watchlist add, position add, and
//     drawer open when the latest prices_eod row for the ticker is
//     older than today's NYSE trading session.
//
// Idempotent:
//   - Upserts by (ticker, trade_date). When Polygon's T+1 morning ingest
//     lands tomorrow with the canonical Massive bar for the same date,
//     it overwrites the yahoo-sameday row via the same upsert key.
//     Source field flips from 'yahoo-sameday' → 'massive' at that point.
//
// Request body:
//   { ticker: "ONDS" }                       -- single-ticker fetch
//   { tickers: ["ONDS","AAPL","TSLA"] }      -- batch fetch (concurrency
//                                                capped at 6 per the
//                                                gentle Yahoo rate-limit)
//
// Response:
//   { ok, requested, written, rows: [{ ticker, trade_date, close, source }], errors: [] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Pull today's bar (and yesterday's as a defensive backstop) for a single
// ticker from Yahoo's free public chart endpoint. Returns the bar matching
// the most recent NYSE trading session — that is the row we want to write.
async function fetchYahooLatest(ticker: string): Promise<{
  trade_date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
} | null> {
  // Pull a 5-day window so we always have at least 2 trading sessions
  // even after a weekend or holiday.
  const now = Math.floor(Date.now() / 1000);
  const start = now - 5 * 86400;
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${start}&period2=${now}&interval=1d&includeAdjustedClose=false`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; MacroTilt EOD-Same-Day Fallback/1.0)",
      "Accept":     "application/json",
    },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const ts: number[] = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  if (ts.length === 0 || !q.close) return null;

  // Pick the last bar with a non-null close — that's the most recent
  // session Yahoo has published.
  let idx = ts.length - 1;
  while (idx >= 0 && (q.close[idx] == null)) idx -= 1;
  if (idx < 0) return null;

  // Convert Yahoo's bar timestamp to its UTC calendar date — that maps
  // 1:1 to the trading session date on US listings.
  const dt = new Date(ts[idx] * 1000);
  const y  = dt.getUTCFullYear();
  const m  = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");

  return {
    trade_date: `${y}-${m}-${dd}`,
    open:   q.open?.[idx]   ?? null,
    high:   q.high?.[idx]   ?? null,
    low:    q.low?.[idx]    ?? null,
    close:  Number(q.close[idx]),
    volume: q.volume?.[idx] ?? null,
  };
}

// Run async tasks with a fixed concurrency cap to stay gentle on Yahoo.
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const my = i++;
      if (my >= items.length) return;
      out[my] = await fn(items[my]);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return json({ ok: false, error: "method not allowed" }, 405);

  let body: { ticker?: string; tickers?: string[] };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid JSON body" }, 400); }

  // Normalize input — single ticker or batch.
  const raw = body.tickers ?? (body.ticker ? [body.ticker] : []);
  const tickers = Array.from(new Set(
    raw
      .map((t) => String(t || "").trim().toUpperCase())
      .filter((t) => /^[A-Z0-9.\-^]{1,10}$/.test(t))
  ));
  if (tickers.length === 0) return json({ ok: false, error: "no valid ticker(s)" }, 400);

  console.log(`[eod-same-day] start tickers=${tickers.length}`);

  // Fetch from Yahoo with concurrency = 6.
  const results = await runConcurrent(tickers, 6, async (t) => {
    try {
      const bar = await fetchYahooLatest(t);
      if (!bar) return { ticker: t, ok: false, error: "no bar from Yahoo" };
      return { ticker: t, ok: true, bar };
    } catch (e) {
      return { ticker: t, ok: false, error: String((e as Error)?.message || e) };
    }
  });

  const rows = results
    .filter((r) => r.ok && r.bar)
    .map((r) => ({
      ticker:     r.ticker,
      trade_date: r.bar!.trade_date,
      open:       r.bar!.open,
      high:       r.bar!.high,
      low:        r.bar!.low,
      close:      r.bar!.close,
      volume:     r.bar!.volume,
      source:     "yahoo-sameday",
      ingested_at: new Date().toISOString(),
    }));

  const errors = results.filter((r) => !r.ok).map((r) => ({ ticker: r.ticker, error: r.error }));

  let written = 0;
  let positionsRefreshed = 0;
  if (rows.length > 0) {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await sb
      .from("prices_eod")
      .upsert(rows, { onConflict: "ticker,trade_date" })
      .select("ticker");
    if (error) {
      console.error(`[eod-same-day] upsert error: ${error.message}`);
      return json({ ok: false, error: error.message, errors }, 502);
    }
    written = data?.length ?? rows.length;

    // Critical: keep positions.price in lockstep with prices_eod so the
    // positions table and the drawer headline never disagree on the
    // same ticker. The refresh_positions_from_eod RPC is idempotent;
    // calling it after every write costs a few ms and prevents the
    // cached-vs-live drift Joe surfaced on 2026-05-14.
    const { data: rpcData, error: rpcError } = await sb.rpc("refresh_positions_from_eod");
    if (rpcError) {
      console.warn(`[eod-same-day] positions refresh failed (non-fatal): ${rpcError.message}`);
    } else if (Array.isArray(rpcData) && rpcData[0]) {
      positionsRefreshed = Number(rpcData[0]?.rows_updated) || 0;
    }
  }

  console.log(`[eod-same-day] done requested=${tickers.length} written=${written} positions_refreshed=${positionsRefreshed} errors=${errors.length}`);
  return json({ ok: true, requested: tickers.length, written, positions_refreshed: positionsRefreshed, rows, errors });
});
