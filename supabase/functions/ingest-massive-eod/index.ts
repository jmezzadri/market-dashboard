// ingest-massive-eod — daily refresh of public.prices_eod from Massive
// Daily Market Summary.  ONE API call returns OHLCV for every US stock.
//
// Cadence:    1× daily after market close (cron schedule TBD in Phase 2).
// API cost:   1 single non-paginated call.
// Side effects:
//   - UPSERTs into public.prices_eod for the requested trade_date
//     (defaults to most recent trading day inferable from the response).
//   - Updates public.pipeline_health row 'massive-eod'.
//
// Request body (optional): { date: "YYYY-MM-DD" }
//   - If omitted, defaults to "yesterday" (today - 1 day).  Massive
//     returns 404 if you ask for today before close, so the caller is
//     responsible for waiting until ~16:30 ET.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { getDailyMarketSummary } from "../_shared/massive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultDate(): string {
  // "Yesterday" in UTC.  Caller can override with explicit date in body.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function setHealth(
  status: "green" | "amber" | "red",
  lastError: string | null,
): Promise<void> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_check_at: now,
    status,
    last_error: lastError,
  };
  if (status === "green") patch.last_good_at = now;
  await sb.from("pipeline_health").update(patch).eq("indicator_id", "massive-eod");
}

serve(async (req) => {
  const startedAt = Date.now();
  let date = defaultDate();
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        date = body.date;
      }
    }
    console.log(`[ingest-massive-eod] start trade_date=${date}`);

    // 1) Pull the full-market daily bar set.
    const bars = await getDailyMarketSummary(date, { adjusted: true });
    console.log(`[ingest-massive-eod] fetched ${bars.length} bars`);

    if (bars.length === 0) {
      // Could be a weekend/holiday or a too-early call.  Don't fail loudly —
      // mark amber so the freshness dot reflects that we tried.
      await setHealth("amber", `no bars returned for ${date}`);
      return json({ ok: true, ingested: 0, trade_date: date, note: "no bars returned (market closed or pre-close)" });
    }

    const rows = bars.map((b: Record<string, unknown>) => ({
      ticker:       b.T,                    // Polygon shorthand: T = ticker
      trade_date:   date,
      open:         b.o ?? null,
      high:         b.h ?? null,
      low:          b.l ?? null,
      close:        b.c ?? null,
      volume:       b.v ?? null,
      vwap:         b.vw ?? null,
      transactions: b.n ?? null,
      source:       "massive",
      ingested_at:  new Date().toISOString(),
    })).filter((r: { ticker: unknown }) => typeof r.ticker === "string" && r.ticker);

    // 2) Chunked upsert.
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await sb.from("prices_eod").upsert(slice, {
        onConflict: "ticker,trade_date",
      });
      if (error) throw new Error(`upsert chunk ${i}: ${error.message}`);
    }

    await setHealth("green", null);
    console.log(`[ingest-massive-eod] upserted ${rows.length} rows for ${date}`);
    return json({
      ok: true,
      ingested: rows.length,
      trade_date: date,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-massive-eod] FAIL:", msg);
    await setHealth("red", msg).catch(() => {});
    return json({ ok: false, error: msg, trade_date: date, duration_ms: Date.now() - startedAt }, 500);
  }
});
