// ingest-massive-universe — daily refresh of public.universe_master from
// Massive Reference Tickers.
//
// Cadence:    1× daily (cron via pg_cron + trigger-workflow OR direct
//             Supabase scheduled function).
// API cost:   1 paginated call (Reference Tickers, limit=1000, ~10 pages).
//             Inside the 5 calls/min Basic-tier limit because the shared
//             client throttles automatically.
// Side effects:
//   - UPSERTs into public.universe_master (additive; never deletes).
//   - Marks tickers no longer returned as active=false (soft-delist).
//   - Updates public.pipeline_health row 'massive-universe' with last_good_at.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { listAllTickers } from "../_shared/massive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  await sb.from("pipeline_health").update(patch).eq("indicator_id", "massive-universe");
}

serve(async (_req) => {
  const startedAt = Date.now();
  try {
    console.log("[ingest-massive-universe] start");

    // 1) Pull every active US-market stock ticker from Massive.
    const stocks = await listAllTickers({ market: "stocks", active: true });
    console.log(`[ingest-massive-universe] fetched ${stocks.length} stock rows`);

    // 2) Upsert into universe_master.  We chunk to keep request bodies
    //    bounded on PostgREST.
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const rows = stocks.map((t: Record<string, unknown>) => ({
      ticker:           t.ticker,
      name:             t.name ?? null,
      market:           t.market ?? "stocks",
      locale:           t.locale ?? "us",
      primary_exchange: t.primary_exchange ?? null,
      type:             t.type ?? null,
      active:           true,
      currency_name:    t.currency_name ?? "usd",
      cik:              t.cik ?? null,
      composite_figi:   t.composite_figi ?? null,
      share_class_figi: t.share_class_figi ?? null,
      last_updated_utc: t.last_updated_utc ?? null,
      ingested_at:      new Date().toISOString(),
    }));

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await sb.from("universe_master").upsert(slice, {
        onConflict: "ticker",
      });
      if (error) throw new Error(`upsert chunk ${i}: ${error.message}`);
    }

    // 3) Soft-delist anything no longer returned by Massive.
    const liveSet = new Set(rows.map((r) => r.ticker));
    const { data: existing, error: e2 } = await sb
      .from("universe_master")
      .select("ticker")
      .eq("active", true);
    if (e2) throw new Error(`select active: ${e2.message}`);
    const stale = (existing ?? [])
      .map((r: { ticker: string }) => r.ticker)
      .filter((t: string) => !liveSet.has(t));
    if (stale.length > 0) {
      const { error: e3 } = await sb
        .from("universe_master")
        .update({ active: false })
        .in("ticker", stale);
      if (e3) throw new Error(`soft-delist: ${e3.message}`);
    }
    console.log(
      `[ingest-massive-universe] upserted ${rows.length}, soft-delisted ${stale.length}`,
    );

    await setHealth("green", null);
    return json({
      ok: true,
      ingested: rows.length,
      soft_delisted: stale.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-massive-universe] FAIL:", msg);
    await setHealth("red", msg).catch(() => {});
    return json({ ok: false, error: msg, duration_ms: Date.now() - startedAt }, 500);
  }
});
