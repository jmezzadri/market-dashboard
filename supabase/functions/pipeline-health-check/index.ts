// pipeline-health-check — 30-minute scheduled edge function.
//
// Reads the public indicator & composite data that the site actually
// serves (indicator_history.json + composite_history_daily.json) plus the
// Massive ingestion tables (universe_master / prices_eod / dividends /
// ticker_reference) in Supabase, computes a per-indicator RAG status
// against the cadence thresholds in public.pipeline_health, and upserts
// the row.
//
// Fires a Resend email to Joe on green→red transitions, debounced at one
// alert per indicator per 24h unless the row recovers (goes green) and
// then breaks again.
//
// Scheduling
// ──────────
//   pg_cron row added in migration 021 calls supabase.functions.invoke
//   every 30 min. Manual invoke: POST with {}; optional header
//   `x-freshness-skip-alerts: 1` to compute status without sending email
//   (used by the trigger-freshness-check helper for dry runs).
//
// Why read the site, not the DB / the upstream APIs
// ─────────────────────────────────────────────────
//   The site's JSON is the ground truth for what users actually see. If
//   the scanner workflow fails silently (Yahoo throttles / FRED returns
//   empty), the JSON goes stale — and that's exactly the symptom we want
//   to alert on. Reading the JSON catches pipeline breaks that a direct
//   FRED/Yahoo poll would miss.
//
// Response shape
// ──────────────
//   { ok: true, checked: 37, green: 30, amber: 4, red: 3, alertsSent: 1 }
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendEmail } from "../_shared/email.ts";

const SITE_BASE = Deno.env.get("MACROTILT_SITE_BASE") || "https://www.macrotilt.com";
const ALERT_TO  = Deno.env.get("FRESHNESS_ALERT_TO")   || "josephmezzadri@gmail.com";
const ALERT_DEBOUNCE_HOURS = 24;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type CadenceCode = "D" | "W" | "M" | "Q";

type HealthRow = {
  indicator_id: string;
  label: string;
  source: string;
  cadence: CadenceCode;
  expected_cadence_minutes: number;
  last_good_at: string | null;
  last_check_at: string | null;
  last_value: unknown;
  last_error: string | null;
  status: "green" | "amber" | "red";
  prev_status: "green" | "amber" | "red" | null;
  last_alerted_at: string | null;
};

// ─── Release-schedule tolerances ────────────────────────────────────────────
// A weekly series like Initial Claims actually publishes on Thursday 8:30am ET.
// If it's Friday and we last saw Thursday data, we're "fresh"; if it's Tuesday
// and we still have last-Thursday, we're waiting for the next release, not
// stale. These offsets widen the green window for cadences where the release
// schedule is predictable.
// ────────────────────────────────────────────────────────────────────────────
const CADENCE_TOLERANCE_MINUTES: Record<CadenceCode, number> = {
  D: 360,    //  6h  — markets closed weekends; small grace for FRED release time
  W: 2880,   // 48h  — release days vary (Thu/Wed/Mon)
  M: 14400,  // 10d  — FRED monthly releases land 4-6 weeks after month-end
  Q: 43200,  // 30d  — SLOOS/JOLTS quarterly can land 6-10 weeks after q-end
};

// ─── Massive ingestion sources ──────────────────────────────────────────────
// Massive (Polygon) ingestion writes directly to Supabase tables, not to the
// public site JSON files. The freshness check for these rows reads
// max(ingested_at) from the corresponding table. Bug #1129.
// ────────────────────────────────────────────────────────────────────────────
const MASSIVE_TABLE_MAP: Record<string, string> = {
  "massive-universe":          "universe_master",
  "massive-eod":                "prices_eod",
  "massive-corporate-actions":  "dividends",
  "massive-ticker-details":     "ticker_reference",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusFor(ageMinutes: number, row: HealthRow): "green" | "amber" | "red" {
  const limit = row.expected_cadence_minutes + CADENCE_TOLERANCE_MINUTES[row.cadence];
  if (ageMinutes <= limit)         return "green";
  if (ageMinutes <= limit * 2)     return "amber";
  return "red";
}

function ageMinutesFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

// ─── Data fetchers ──────────────────────────────────────────────────────────
async function fetchIndicatorHistory(): Promise<Record<string, { as_of?: string }>> {
  const url = `${SITE_BASE}/indicator_history.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`indicator_history.json ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

async function fetchCompositeHistory(): Promise<Array<Record<string, unknown>>> {
  const url = `${SITE_BASE}/composite_history_daily.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`composite_history_daily.json ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

// ─── Main handler ───────────────────────────────────────────────────────────
async function handle(req: Request): Promise<Response> {
  const skipAlerts = req.headers.get("x-freshness-skip-alerts") === "1";
  const now = new Date();

  // 1) Load existing health rows to preserve prev_status for transition detection
  const { data: rowsData, error: selErr } = await supabase
    .from("pipeline_health")
    .select(
      "indicator_id, label, source, cadence, expected_cadence_minutes, " +
      "last_good_at, last_check_at, last_value, last_error, status, " +
      "prev_status, last_alerted_at"
    );
  if (selErr) return json({ ok: false, error: `select: ${selErr.message}` }, 500);
  const rows = (rowsData || []) as HealthRow[];
  if (rows.length === 0) {
    return json({ ok: false, error: "pipeline_health is empty — run migration 020 seed" }, 500);
  }

  // 2) Pull the two canonical site files
  let indicators: Record<string, { as_of?: string }> = {};
  let composites: Array<Record<string, unknown>> = [];
  try {
    [indicators, composites] = await Promise.all([
      fetchIndicatorHistory(),
      fetchCompositeHistory(),
    ]);
  } catch (e) {
    // If the site itself is down, mark everything amber, don't alert — this is
    // a fetch-side failure, not a pipeline failure.
    return json({ ok: false, error: `site fetch: ${(e as Error).message}` }, 502);
  }

  const compositeLatestIso = composites.length > 0
    ? String((composites[composites.length - 1] as { d: string }).d || "")
    : null;

  // 3) Compute new status + upsert each row
  const updates: Array<Partial<HealthRow> & { indicator_id: string }> = [];
  const alerts: Array<{ row: HealthRow; ageMinutes: number | null }> = [];

  for (const row of rows) {
    let asOf: string | null = null;
    // For sources that already produce a full ISO timestamp (Massive tables),
    // we bypass the date-only "T00:00:00Z" append below by setting this.
    let lastGoodIso: string | null = null;
    let lastError: string | null = null;

    if (row.source === "massive") {
      // Massive rows are sourced from Supabase tables, not site JSON.
      // Read max(ingested_at) from the corresponding table. Bug #1129.
      const tableName = MASSIVE_TABLE_MAP[row.indicator_id];
      if (!tableName) {
        lastError = `unknown massive indicator_id: ${row.indicator_id}`;
      } else {
        const { data, error } = await supabase
          .from(tableName)
          .select("ingested_at")
          .order("ingested_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          lastError = `massive query (${tableName}): ${error.message}`;
        } else if (!data) {
          // Phase 3 backfill not started yet for ticker_reference is the
          // expected case here. Stays red until rows arrive.
          lastError = `${tableName} has no rows yet`;
        } else {
          lastGoodIso = data.ingested_at as string;
          asOf = lastGoodIso;
        }
      }
    } else if (row.indicator_id.startsWith("composite_")) {
      asOf = compositeLatestIso;
      if (!asOf) lastError = "composite_history_daily.json has no rows";
    } else {
      const rec = indicators[row.indicator_id];
      if (!rec) {
        lastError = "indicator not present in indicator_history.json";
      } else {
        asOf = rec.as_of ?? null;
        if (!asOf) lastError = "no as_of field";
      }
    }

    const ageMin = ageMinutesFromIso(asOf);
    let newStatus: "green" | "amber" | "red";
    if (ageMin == null) newStatus = "red";
    else newStatus = statusFor(ageMin, row);

    // Debounced alert on a green→red transition
    const wasGreen = row.status === "green";
    const nowRed   = newStatus === "red";
    const lastAlertAge = row.last_alerted_at
      ? (Date.now() - new Date(row.last_alerted_at).getTime()) / 3600_000
      : Infinity;
    const shouldAlert =
      !skipAlerts && wasGreen && nowRed && lastAlertAge >= ALERT_DEBOUNCE_HOURS;

    // Include all NOT NULL columns (label, source, cadence, expected_cadence_minutes)
    // — Supabase's upsert reuses INSERT semantics on conflict, so partial rows
    // trip the column constraints even though the row already exists.
    updates.push({
      indicator_id: row.indicator_id,
      label: row.label,
      source: row.source,
      cadence: row.cadence,
      expected_cadence_minutes: row.expected_cadence_minutes,
      last_check_at: now.toISOString(),
      last_good_at: lastGoodIso
        ? lastGoodIso
        : (asOf ? new Date(asOf + "T00:00:00Z").toISOString() : row.last_good_at),
      last_error: lastError,
      status: newStatus,
      prev_status: row.status,
      last_alerted_at: shouldAlert ? now.toISOString() : row.last_alerted_at,
    });

    if (shouldAlert) alerts.push({ row, ageMinutes: ageMin });
  }

  // 4) Upsert in a single batch
  const { error: upErr } = await supabase
    .from("pipeline_health")
    .upsert(updates, { onConflict: "indicator_id" });
  if (upErr) return json({ ok: false, error: `upsert: ${upErr.message}` }, 500);

  // 5) Fire alerts after the DB write (so last_alerted_at is persisted even if
  //    Resend is down — we won't spam retries)
  let alertsSent = 0;
  for (const { row, ageMinutes } of alerts) {
    try {
      await sendEmail({
        to: ALERT_TO,
        subject: `[MacroTilt] Data stale — ${row.label}`,
        html: `
          <p>Hi Joe,</p>
          <p>The <strong>${row.label}</strong> indicator appears stale on the site.</p>
          <ul>
            <li><strong>Indicator</strong>: ${row.indicator_id}</li>
            <li><strong>Source</strong>: ${row.source}</li>
            <li><strong>Expected cadence</strong>: ${row.cadence === "D" ? "daily" : row.cadence === "W" ? "weekly" : row.cadence === "M" ? "monthly" : "quarterly"}</li>
            <li><strong>Age</strong>: ${ageMinutes != null ? Math.round(ageMinutes / 60 / 24) : "?"} days</li>
            <li><strong>Last error</strong>: ${row.last_error || "—"}</li>
          </ul>
          <p>Check the scheduled workflow on GitHub Actions. This alert repeats at most once per ${ALERT_DEBOUNCE_HOURS}h.</p>
        `,
      });
      alertsSent++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[pipeline-health-check] Resend error:", (e as Error).message);
    }
  }

  // 6) Summary
  const green = updates.filter((u) => u.status === "green").length;
  const amber = updates.filter((u) => u.status === "amber").length;
  const red   = updates.filter((u) => u.status === "red").length;

  // 7) Editorial-narrative gap check (#1078)
  //    The Home page editorial blurb relies on macro_commentary and
  //    sector_commentary having one row per trading day. Closes the
  //    case where the nightly generate-commentary fn was scheduled
  //    out from underneath us (Friday 2026-04-24 was missed for 3
  //    days because no health check looked here).
  //
  //    Rule: if today is a weekday, expect today's row OR yesterday's
  //    row (depending on time of day). If today is Mon, expect Fri's
  //    row. We check that the most-recent row in each table is at
  //    most 1 trading-day stale; otherwise flag and alert (debounced
  //    against the same last_alerted_at field on a synthetic
  //    pipeline_health row id "narrative_macro" / "narrative_sector").
  let narrativeAlertsSent = 0;
  try {
    const expectedDate = lastTradingDayUtcDate(now);
    for (const tbl of ["macro_commentary", "sector_commentary"] as const) {
      const { data: latest, error: nErr } = await supabase
        .from(tbl)
        .select("generated_date,generated_at")
        .order("generated_date", { ascending: false })
        .limit(1);
      if (nErr) continue;
      const haveDate = (latest && latest[0]?.generated_date) || null;
      const isStale  = !haveDate || haveDate < expectedDate;
      if (!isStale) continue;

      // Synthetic health-row id for this surface, so debounce works.
      const synthId = tbl === "macro_commentary" ? "narrative_macro" : "narrative_sector";
      const { data: prev } = await supabase
        .from("pipeline_health")
        .select("last_alerted_at")
        .eq("indicator_id", synthId)
        .maybeSingle();
      const lastAlertAge = prev?.last_alerted_at
        ? (Date.now() - new Date(prev.last_alerted_at).getTime()) / 3600_000
        : Infinity;
      if (skipAlerts || lastAlertAge < ALERT_DEBOUNCE_HOURS) continue;

      try {
        await sendEmail({
          to: ALERT_TO,
          subject: `[MacroTilt] Editorial blurb missing for ${expectedDate}`,
          html: `
            <p>Hi Joe,</p>
            <p>The <strong>${tbl === "macro_commentary" ? "macro" : "sector"}</strong> editorial blurb for the last trading day (${expectedDate}) was never generated.</p>
            <ul>
              <li><strong>Most recent row</strong>: ${haveDate || "(none in table)"}</li>
              <li><strong>Expected for</strong>: ${expectedDate}</li>
              <li><strong>Trigger</strong>: invoke <code>generate-commentary</code> manually or check that the nightly schedule is wired.</li>
            </ul>
            <p>This alert repeats at most once per ${ALERT_DEBOUNCE_HOURS}h.</p>
          `,
        });
        narrativeAlertsSent++;
        // Persist debounce timestamp on synthetic row (insert-on-conflict).
        await supabase.from("pipeline_health").upsert([{
          indicator_id: synthId,
          label: tbl === "macro_commentary" ? "Macro narrative blurb" : "Sector narrative blurb",
          source: "macro_commentary table",
          cadence: "D",
          expected_cadence_minutes: 1440,
          last_check_at: now.toISOString(),
          last_alerted_at: now.toISOString(),
          status: "red",
        }], { onConflict: "indicator_id" });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[pipeline-health-check] Narrative-gap email error:", (e as Error).message);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pipeline-health-check] Narrative-gap check failed:", (e as Error).message);
  }

  return json({ ok: true, checked: updates.length, green, amber, red, alertsSent, narrativeAlertsSent });
}

// Returns YYYY-MM-DD for the most recent UTC weekday.
// If today is Monday, returns last Friday. If today is Sun, returns Fri.
// Otherwise returns yesterday.
function lastTradingDayUtcDate(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Step back one day, then back further across weekends.
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 /* Sun */ || d.getUTCDay() === 6 /* Sat */) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

serve(handle);
