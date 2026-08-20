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
//   { ok: true, checked: 37, green: 33, red: 3, unknown: 1, alertsSent: 1 }
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendEmail } from "../_shared/email.ts";
import { gradeTwoClock, type ReleaseCalendar } from "../_shared/freshnessClock.ts";

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
  status: "green" | "red" | "unknown" | "amber";
  prev_status: "green" | "red" | "unknown" | "amber" | null;
  last_alerted_at: string | null;
  last_7day_alert_at?: string | null;
};

// ─── Release-schedule tolerances ────────────────────────────────────────────
// A weekly series like Initial Claims actually publishes on Thursday 8:30am ET.
// If it's Friday and we last saw Thursday data, we're "fresh"; if it's Tuesday
// and we still have last-Thursday, we're waiting for the next release, not
// stale. These offsets widen the green window for cadences where the release
// schedule is predictable.
// ────────────────────────────────────────────────────────────────────────────
// Human label per cadence code. The old inline ternary only handled D/W/M and
// silently called EVERYTHING else "quarterly" — an hourly live feed was emailed
// to Joe as "Expected cadence: quarterly" (2026-07-30).
const CADENCE_LABEL: Record<string, string> = {
  H: "hourly", D: "daily", W: "weekly", M: "monthly", Q: "quarterly",
};

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
  "massive-dividends":          "dividends",
  "massive-splits":             "splits",
  "massive-ticker-details":     "ticker_reference",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


// PR (timestamp-semantics fix, 2026-05-01): when as_of comes through as a
// date-only string ("2026-04-30") for a DAILY indicator, anchor the time to
// 20:00 UTC — that's ~ NYSE close (4pm ET during DST) and the moment FRED
// daily series have published. Without this, the chip computes age from
// midnight UTC, which is up to 21 hours BEFORE the data actually appeared,
// pushing daily chips to red as soon as the next day starts in UTC. Slower
// cadences leave date-only at 00:00 UTC — their SLA budgets absorb the offset.
function asOfToMs(iso: string | null | undefined, cadence: CadenceCode | undefined): number | null {
  if (!iso) return null;
  // 2026-06-11: stamps stored at exactly midnight UTC are date-only INTENT
  // (the honest-stamp rule writes business dates that way) — anchor them like
  // date-only strings so daily age math doesn't run 20h hot.
  const isoDateOnly = iso.length === 10
    ? iso
    : (/T00:00:00(\.0+)?(\+00:00|Z)$/.test(iso) ? iso.slice(0, 10) : null);
  if (isoDateOnly) {
    const time = cadence === "D" ? "T20:00:00Z" : "T00:00:00Z";
    const ms = new Date(isoDateOnly + time).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function ageMinutesFromIso(iso: string | null | undefined, cadence?: CadenceCode): number | null {
  const ms = asOfToMs(iso, cadence);
  if (ms == null) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 60000));
}

// ─── Data fetchers ──────────────────────────────────────────────────────────
async function fetchIndicatorHistory(): Promise<Record<string, { as_of?: string }> & { __meta__?: { generated_at_utc?: string } }> {
  const url = `${SITE_BASE}/indicator_history.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`indicator_history.json ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

async function fetchCompositeHistory(): Promise<Array<Record<string, unknown>>> {
  const url = `${SITE_BASE}/composite_history_daily.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (resp.status === 404) {
    // PR λ (2026-05-02) retired composite_history_daily.json. Composite-derived
    // indicators (composite_rl/gr/ir) read this; they were also dropped in
    // that PR. Returning [] here keeps the rest of the freshness check alive
    // for the 40+ indicators that don't depend on composites.
    console.log("composite_history_daily.json 404 — composite kill (PR λ); continuing with empty composites array");
    return [];
  }
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
      "prev_status, last_alerted_at, last_7day_alert_at"
    );
  if (selErr) return json({ ok: false, error: `select: ${selErr.message}` }, 500);
  const rows = (rowsData || []) as HealthRow[];
  if (rows.length === 0) {
    return json({ ok: false, error: "pipeline_health is empty — run migration 020 seed" }, 500);
  }

  // 2) Pull the two canonical site files + the data manifest
  let indicators: Record<string, { as_of?: string }> = {};
  let composites: Array<Record<string, unknown>> = [];
  let manifestByName: Record<string, { freshness_sla_hours?: number; release_calendar?: string; name?: string; data_max_age_hours?: number; data_calendar?: string; market_hours_only?: boolean }> = {};
  try {
    [indicators, composites] = await Promise.all([
      fetchIndicatorHistory(),
      fetchCompositeHistory(),
    ]);
  } catch (e) {
    // If the site itself is down, bail without touching any row — this is a
    // fetch-side failure, not a pipeline failure. We never blanket-flip rows to
    // a "can't tell" state; the next run re-grades cleanly once the site is back.
    return json({ ok: false, error: `site fetch: ${(e as Error).message}` }, 502);
  }
  try {
    const mr = await fetch(`${SITE_BASE}/data_manifest.json`, { cache: "no-store" });
    if (mr.ok) {
      const m = await mr.json();
      for (const e of (m.elements || []) as Array<Record<string, unknown>>) {
        const el = e as { freshness_sla_hours?: number; release_calendar?: string; name?: string; data_max_age_hours?: number; data_calendar?: string; market_hours_only?: boolean };
        if (e.name) manifestByName[e.name as string] = el;
        if (e.id)   manifestByName[e.id as string] = el;
      }
    }
  } catch (e) {
    // Manifest fetch failure is non-fatal — we just can't run the manifest-aware
    // stuck-red check. Legacy status logic still works.
    console.warn("[pipeline-health-check] manifest fetch failed:", (e as Error).message);
  }

  const compositeLatestIso = composites.length > 0
    ? String((composites[composites.length - 1] as { d: string }).d || "")
    : null;

  // 3) Compute new status + upsert each row + append a row to pipeline_fetch_log
  //    (PR #15 — gives the pipeline panel its "last 7 attempts" history)
  const updates: Array<Partial<HealthRow> & { indicator_id: string }> = [];
  const alerts: Array<{ row: HealthRow; ageMinutes: number | null }> = [];
  const escalations: Array<{ row: HealthRow; ageMinutes: number | null; daysStuck: number }> = [];
  const logRows: Array<{
    indicator_id: string;
    check_at: string;
    status: "green" | "red" | "unknown" | "amber";
    age_minutes: number | null;
    last_value: unknown;
    error_message: string | null;
    source: string | null;
    run_kind: "atomic";
    run_duration_ms: number | null;
  }> = [];
  const runStartedAt = Date.now();

  for (const row of rows) {
    let asOf: string | null = null;
    // For sources that already produce a full ISO timestamp (Massive tables),
    // we bypass the date-only "T00:00:00Z" append below by setting this.
    let lastGoodIso: string | null = null;
    let lastError: string | null = null;

    if (row.source === "massive") {
      // Massive rows: freshness reflects "did the producer pipeline run
      // successfully today", NOT "did new rows land in the data table".
      // The producer (backfill_massive_initial.py) writes to pipeline_runs
      // on every successful run; we read last_run_at from there.
      // Migration 040 introduced this contract; before that, this block
      // read max(ingested_at) from the data table, which lied red whenever
      // the universe was stable for 2+ days. (May 2 2026 incident.)
      const { data: runRow, error: runErr } = await supabase
        .from("pipeline_runs")
        .select("last_run_at, last_run_status, last_error")
        .eq("pipeline_name", row.indicator_id)
        .maybeSingle();
      if (runErr) {
        lastError = `pipeline_runs query: ${runErr.message}`;
      } else if (!runRow) {
        // Never seeded — fall back to data-table read so chip isn't
        // permanently dark on a fresh deploy.
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
            lastError = `${tableName} has no rows yet`;
          } else {
            lastGoodIso = data.ingested_at as string;
            asOf = lastGoodIso;
          }
        }
      } else {
        lastGoodIso = runRow.last_run_at as string;
        asOf = lastGoodIso;
        if (runRow.last_run_status === "failure") {
          lastError = runRow.last_error || "last run failed";
        }
      }
    } else if (row.indicator_id.startsWith("composite_")) {
      asOf = compositeLatestIso;
      if (!asOf) lastError = "composite_history_daily.json has no rows";
    } else if (row.indicator_id === "scanner-v5-daily") {
      // 2026-05-12 — producer-owned. The V5_SCAN_DAILY workflow writes
      // data_as_of + last_good_at + coverage_pct to this row on every
      // successful run. Use those values directly — don't look in
      // indicator_history.json (the v5 scanner publishes to
      // signal_intel_v5_daily, not the legacy history file). This stops
      // this function from clobbering a green row with "indicator not
      // present in indicator_history.json" + status=red minutes after a
      // healthy scan finishes.
      asOf = (row as unknown as { data_as_of?: string }).data_as_of
        || row.last_good_at
        || null;
      if (!asOf) lastError = "scanner-v5-daily has not run yet";
    } else if (row.indicator_id.startsWith("paper-")) {
      // 2026-06-12 — producer-owned (THIRD instance of the clobber bug:
      // scanner-v5 2026-05-12, snapshot files #1148 2026-05-19, now the
      // paper rows after the 2026-06-11 registration sweep seeded them).
      // The paper close/EOD runs stamp these rows nightly; they are not
      // indicators in indicator_history.json and serve no public JSON file.
      // Grade the producer's own stamp — never clobber red with
      // "indicator not present".
      asOf = (row as unknown as { data_as_of?: string }).data_as_of
        || row.last_good_at
        || null;
      if (!asOf) lastError = `${row.indicator_id} has not run yet`;
    } else if (
      row.indicator_id === "cycle_board" ||
      row.indicator_id === "v10_allocation" ||
      row.indicator_id === "indicator_history" ||
      row.indicator_id === "cftc-cot" ||
      row.indicator_id === "credit_positioning" ||
      row.indicator_id === "trade_ideas"
    ) {
      // 2026-05-19 (#1148 fix) — these rows used to fall into the generic
      // indicator_history lookup and always RED because they are not
      // indicators in that bundle; they are snapshot JSON files served
      // alongside it. Read the file's own freshness stamp instead.
      //
      // 2026-08-20 (weekday health sweep — LESSONS 4.52): trade_ideas is the
      // FOURTH instance of this exact shape, and it was registered on 8/13
      // without ever being added here. The failure mode is quiet by design:
      // this watchdog has no mapping for it, so it hit the terminal else, got
      // `lastError = "indicator not present in indicator_history.json"`, and
      // took the anti-clobber `continue` further down — which deliberately
      // leaves the row alone on the theory that "another producer owns it".
      // No producer does. The editorial session commits public/trade_ideas.json
      // through ops-code-commit and never touches pipeline_health, so the row
      // sat frozen at its 8/13 seed while notes published on 8/14, 8/16 and
      // 8/17 — and macrotilt.com's header read "1 feed stale" for seven days
      // about a feed that was fine. Anti-clobber protects a row that someone
      // else stamps; a row nobody stamps just rots. The file carries its own
      // `generated_at`, so grade it the same way as its four siblings and it
      // self-heals every run.
      const FILE_MAP: Record<string, { path: string; field: string }> = {
        cycle_board:        { path: "/cycle_board_snapshot.json", field: "as_of" },
        v10_allocation:     { path: "/v10_allocation.json",       field: "as_of" },
        "cftc-cot":         { path: "/cot_positioning.json",      field: "as_of" },
        "credit_positioning":{ path: "/cot_positioning.json",     field: "as_of" },
        indicator_history:  { path: "/indicator_history.json",    field: "__meta__.generated_at_utc" },
        trade_ideas:        { path: "/trade_ideas.json",          field: "generated_at" },
      };
      const cfg = FILE_MAP[row.indicator_id];
      try {
        const r = await fetch(`${SITE_BASE}${cfg.path}`, { cache: "no-store" });
        if (!r.ok) {
          lastError = `${cfg.path} ${r.status}`;
        } else {
          const j = await r.json();
          // cftc-cot bundles CFTC speculator data AND NY-Fed credit positioning
          // under one feed. Grade off the OLDEST market as_of (not the file's
          // top-level/newest date) so a stale sub-feed (e.g. credit positioning
          // stuck weeks back) turns the chip RED instead of hiding under the
          // freshest market. (Joe 2026-06-19 — the header lied "all current".)
          let v: unknown;
          if (row.indicator_id === "cftc-cot" || row.indicator_id === "credit_positioning") {
            // cftc-cot = CFTC domains only; credit_positioning = the NY-Fed Credit domain.
            let minA: string | null = null;
            const doms = (j && (j as Record<string, unknown>).domains) as Record<string, { markets?: Array<{ asof?: string }> }> | undefined;
            const wantCredit = row.indicator_id === "credit_positioning";
            for (const [dname, d] of Object.entries(doms || {})) {
              if ((dname === "Credit") !== wantCredit) continue;
              for (const mk of (d?.markets || [])) {
                if (mk?.asof && (minA === null || mk.asof < minA)) minA = mk.asof;
              }
            }
            v = minA || (j as Record<string, unknown>).as_of;
          } else {
            const parts = cfg.field.split(".");
            v = j;
            for (const p of parts) { v = v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined; }
          }
          if (typeof v === "string" && v.length > 0) {
            asOf = v;
            // Honest last_good_at (kills the frozen-stamp impossible-pair red).
            // If the file's stamp is a real wall-clock timestamp, that IS the
            // build/run time -> use it. If it is date-only (no run time in the
            // file), record the watchdog's own check time: a real timestamp
            // meaning "verified current as of now" (never derived from the
            // data date, never a fabricated close). Staleness is still judged
            // off data_as_of, so this can't mask a dead feed.
            lastGoodIso = /\dT\d\d:\d\d/.test(asOf) ? asOf : (row.last_good_at || now.toISOString());
          } else {
            lastError = `${cfg.path} missing ${cfg.field}`;
          }
        }
      } catch (e) {
        lastError = `${cfg.path} fetch error: ${(e as Error).message}`;
      }
    } else if (
      row.indicator_id === "uw-universe-snapshots" ||
      row.indicator_id === "uw-ticker-events" ||
      row.indicator_id === "latest_scan" ||
      row.indicator_id === "zerohedge_public" ||
      row.indicator_id === "zerohedge_premium" ||
      row.indicator_id === "options_chain" ||
      row.indicator_id === "wide_universe" ||
      row.indicator_id === "user_scan_data" ||
      row.indicator_id === "index_membership" ||
      row.indicator_id === "equity-options_flow-daily" ||
      row.indicator_id === "equity-short_interest-daily"
    ) {
      // 2026-05-19 (#1148 fix) — these rows monitor Supabase tables, not
      // public JSON files. Read max ingested_at / as_of_date from the
      // table directly.
      const TABLE_MAP: Record<string, { table: string; col: string; runTsCol?: string }> = {
        "uw-universe-snapshots": { table: "universe_snapshots", col: "snapshot_ts" },
        "uw-ticker-events": { table: "ticker_events", col: "ingested_ts" },
        // 2026-06-15 — latest_scan graded off its source table, not the
        // committed file. Before this change the watchdog read the file's
        // scan_time into data_as_of and NEVER wrote last_good_at, so
        // last_good_at froze at the last manual one-shot repair run while
        // data_as_of marched forward each day — producing the impossible
        // "data newer than its last refresh" pair (Data as of Jun 12, last
        // refresh Jun 11) that turned the scanner chip red. trading_opps_signals
        // carries BOTH honest stamps: scan_date (the session the scan covers
        // -> data_as_of) and scan_run_ts (the real wall-clock time the scan
        // wrote -> last_good_at). Reading both every watchdog run keeps the
        // pair honest and self-heals with no dependency on REPAIR-HEALTH-STAMPS.
        "latest_scan":           { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        // 2026-06-23 — the daily scan also FEEDS six derived facets that were
        // registered later (2026-06-18) but never added here, so they had no
        // honest last_good_at writer: data_as_of marched forward off scan_date
        // while last_good_at stayed frozen at their seed time, tripping the
        // "data newer than last pull" impossible pair and showing 6 false-stale
        // chips. They are all produced by the SAME scan, so they read the same
        // two honest stamps (scan_date -> data_as_of, scan_run_ts -> last_good_at)
        // exactly like latest_scan, and self-heal every 30-minute run. (Joe.)
        "zerohedge_public":      { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        "zerohedge_premium":     { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        "options_chain":         { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        "wide_universe":         { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        "user_scan_data":        { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        "index_membership":      { table: "trading_opps_signals", col: "scan_date", runTsCol: "scan_run_ts" },
        // 2026-06-15 — options flow + short interest were graded against
        // indicator_history.json, where they do not exist, so they were
        // permanently RED ("indicator not present"). They are Supabase
        // tables: as_of_date is the session the data covers (-> data_as_of),
        // ingested_at is the real ingest run time (-> last_good_at).
        "equity-options_flow-daily":   { table: "options_flow_daily",   col: "as_of_date", runTsCol: "ingested_at" },
        "equity-short_interest-daily": { table: "short_interest_daily", col: "as_of_date", runTsCol: "ingested_at" },
      };
      const cfg = TABLE_MAP[row.indicator_id];
      const sel = cfg.runTsCol ? `${cfg.col},${cfg.runTsCol}` : cfg.col;
      const { data, error } = await supabase
        .from(cfg.table)
        .select(sel)
        .order(cfg.col, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        lastError = `${cfg.table} query: ${error.message}`;
      } else if (!data) {
        lastError = `${cfg.table} has no rows`;
      } else {
        asOf = (data as Record<string, string>)[cfg.col];
        // Honest last_good_at (kills the frozen-stamp impossible-pair red).
        // Prefer an explicit real run-time column (e.g. ingested_at,
        // scan_run_ts); else if the as-of column is itself a real timestamp
        // use it; else record the watchdog's own verified-current check time.
        const rt = cfg.runTsCol ? (data as Record<string, string>)[cfg.runTsCol] : null;
        if (rt) lastGoodIso = rt;
        else if (asOf && /\dT\d\d:\d\d/.test(String(asOf))) lastGoodIso = asOf;
        else lastGoodIso = row.last_good_at || now.toISOString();
      }
    } else {
      const rec = indicators[row.indicator_id];
      if (!rec) {
        lastError = "indicator not present in indicator_history.json";
      } else {
        // Bug #1207 (2026-05-25) — staleness must reflect the AGE OF THE DATA,
        // not "did the fetch script run". Each indicator in
        // indicator_history.json carries its own per-item data date in
        // `rec.as_of` (the date of the most recent published observation).
        //
        // This branch previously used the top-level
        // `__meta__.generated_at_utc` — a "fetch_history.py ran" timestamp
        // re-stamped on every successful run. When an upstream feed (FRED /
        // Yahoo) went stale but the fetch script still completed, that
        // meta-stamp stayed fresh, so every one of the ~40 generic
        // indicators computed a near-zero age and reported green even
        // though their actual data was days old. That defeated the entire
        // purpose of the watchdog (the symptom: 48/48 green while ~43 feeds
        // were 5-6 days stale).
        //
        // Fix: read each indicator's own `rec.as_of`. The release-calendar
        // tolerances and per-row cadence windows below
        // (CADENCE_TOLERANCE_MINUTES + expected_cadence_minutes) are
        // unchanged — they already absorb the legitimate T+1..T+3 publish
        // lag for series whose pipeline_health row is calibrated for it.
        // If the per-indicator fetch errored inside an otherwise-successful
        // run, the producer still writes last_error to this row via
        // _log_pipeline_health; that surfaces in the chip tooltip.
        asOf = rec.as_of || null;
        if (!asOf) lastError = "no as_of field in indicator_history.json";
      }
    }

    const ageMin = ageMinutesFromIso(asOf, row.cadence);  // kept only for the fetch-log age column

    // TWO-CLOCK grade (FRESHNESS_CHIP_SPEC v2 — Joe 2026-06-17): green only if BOTH
    // the pull clock (the job's real last successful run, lastGoodIso, vs the
    // manifest pull SLA) AND the data clock (data_as_of vs the manifest data
    // window) pass — calendar-aware. Identical to the site chips (shared clock
    // function), so the stored status, the green->red alert, and every chip agree.
    // The pull clock fires on a job that stopped; the data clock fires on a vendor
    // that went dark while the cron still "succeeds" (the one-clock fake-green hole).
    const mfGrade = manifestByName[row.indicator_id];
    const slaH = Number(mfGrade?.freshness_sla_hours) || 0;
    const winH = Number(mfGrade?.data_max_age_hours) || 0;
    const graded = gradeTwoClock({
      lastPullIso: lastGoodIso ?? row.last_good_at,
      asOfIso: asOf,
      dataAsOfIso: asOf,
      slaHours: slaH,
      calendar: (mfGrade?.release_calendar as ReleaseCalendar) || "us-business-day",
      lastError,
      maxDataAgeHours: winH,
      dataCalendar: (mfGrade?.data_calendar as ReleaseCalendar) || (mfGrade?.release_calendar as ReleaseCalendar) || "us-business-day",
      marketHoursOnly: !!mfGrade?.market_hours_only,
    });
    // Config gap (neither a pull SLA nor a data window configured): a reference /
    // static / event-driven row with no freshness target. Grade it "unknown"
    // (neutral grey) — the SAME state the site chips show for a reference-exempt
    // element. NEVER amber: the binary doctrine has exactly two graded states
    // (green / red) plus grey for untracked/reference. There is no "lagging"
    // state anywhere on the site.
    const isConfigGap = slaH <= 0 && winH <= 0;
    // 2026-07-29 (9-day watchdog outage post-mortem): a row that is NOT in the
    // public manifest at all is one this watchdog cannot grade — it was either
    // deliberately unlisted (the UW teardown #1411 kept 4 health rows live but
    // removed their public manifest entries) or is producer-owned. Writing
    // "unknown" for those rows tripped the pipeline_health_status_check
    // constraint (green/amber/red only at the time), which killed the SINGLE
    // batch upsert below and 500'd the whole function on every run from
    // 7/20 to 7/29 — no narrative-blurb stamping, no stale alerts, while the
    // header showed "2 feeds stale" every day. Anti-clobber doctrine applies:
    // leave the producer's own stamp untouched and skip the row entirely.
    // (Migration 089 also widened the constraints to allow 'unknown' as a
    // backstop for any future config-gap row that IS manifest-listed.)
    if (isConfigGap && !mfGrade) {
      continue;
    }
    const newStatus: "green" | "red" | "unknown" =
      isConfigGap ? "unknown" : (graded.status === "green" ? "green" : "red");

    // Debounced alert on a green→red transition
    const wasGreen = row.status === "green";
    const nowRed   = newStatus === "red";
    const lastAlertAge = row.last_alerted_at
      ? (Date.now() - new Date(row.last_alerted_at).getTime()) / 3600_000
      : Infinity;
    const shouldAlert =
      !skipAlerts && wasGreen && nowRed && lastAlertAge >= ALERT_DEBOUNCE_HOURS;

    // ─── 7-day stuck-red escalation (Joe directive 2026-05-03) ────────────
    // Re-evaluate "is this red?" against manifest SLA + calendar (matches the
    // frontend chip). The legacy newStatus above uses cadence + tolerance and
    // does not account for calendar awareness; using it for stuck-red would
    // fire false alarms on weekend FRED dailies.
    // Stuck-red gate uses the SAME two-clock grade as the chip + stored status.
    const manifestStale = !isConfigGap && graded.status === "red";

    // Rolling: when did this row first go red? Use last_alerted_at as proxy
    // (set on every green→red transition, including the very first one).
    const firstRedAt = row.last_alerted_at;
    const elapsedRedHours = firstRedAt
      ? (Date.now() - new Date(firstRedAt).getTime()) / 3600_000
      : 0;
    const last7Age = row.last_7day_alert_at
      ? (Date.now() - new Date(row.last_7day_alert_at).getTime()) / 3600_000
      : Infinity;

    const STUCK_HOURS = 168; // 7 days
    const shouldEscalate7Day =
      !skipAlerts &&
      manifestStale &&                           // manifest agrees it is stale (no false alarms)
      firstRedAt != null &&                      // we have a starting point
      elapsedRedHours >= STUCK_HOURS &&          // red for 7+ days
      last7Age >= STUCK_HOURS;                   // havent escalated in last 7 days

    // Reset 7-day timer when the chip just transitioned green→red. Lets the
    // counter restart fresh after every recovery.
    let next7DayAlertAt: string | null = row.last_7day_alert_at ?? null;
    if (wasGreen && nowRed) next7DayAlertAt = null;
    if (shouldEscalate7Day) next7DayAlertAt = now.toISOString();


    // Anti-clobber (LESSONS 4.2 — this clobber recurred again 2026-06-18): if this
    // watchdog has NO source mapping for the row (not an indicator_history.json
    // series, not a massive/table/file feed it knows how to read), it must NOT
    // overwrite the row red. Another producer or the 6-hourly
    // reconcile_pipeline_health.py job owns these (commentary, ZeroHedge, the
    // scan-embedded feeds, allocation outputs, earnings). Leave the existing stamp
    // untouched so the watchdog never fabricates a red on a feed it cannot grade.
    if (lastError === "indicator not present in indicator_history.json") {
      continue;
    }

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
      // Honest-stamp rule (2026-06-11): last_good_at only ever carries REAL
      // run evidence (pipeline_runs). Deriving it from the data's as-of
      // fabricated 4 PM closes — future stamps whenever the data was current.
      // With no evidence, leave the producer's own stamp untouched.
      last_good_at: lastGoodIso ?? row.last_good_at,
      // 2026-05-27 — write the trading-day data date the watchdog just
      // observed into data_as_of. The chip layer (useFreshness.js,
      // post-2026-05-12 Phase 2) anchors staleness off data_as_of, not
      // last_good_at. Until this line, data_as_of was a producer-write-only
      // column — for the ~40 FRED/Yahoo indicators that have no producer-
      // side health-row writer, it stayed frozen at whatever value seeded
      // it (2026-05-11 / 2026-05-12 in production), which made every chip
      // render red across the site even though the watchdog's own status
      // call (computed from asOf) was correctly going green. Now that the
      // watchdog has just computed asOf, persist it.
      data_as_of: asOf || row.data_as_of,
      last_error: lastError,
      status: newStatus,
      prev_status: row.status,
      last_alerted_at: shouldAlert ? now.toISOString() : row.last_alerted_at,
      last_7day_alert_at: next7DayAlertAt,
    });

    if (shouldAlert) alerts.push({ row, ageMinutes: ageMin });
    if (shouldEscalate7Day) escalations.push({ row, ageMinutes: ageMin, daysStuck: Math.round(elapsedRedHours / 24) });

    // PR #15 — append a row to pipeline_fetch_log so the pipeline panel
    // can show the "last 7 attempts" history. We do this whether the
    // status changed or not — the panel cares about every check, not
    // just transitions.
    logRows.push({
      indicator_id: row.indicator_id,
      check_at: now.toISOString(),
      status: newStatus,
      age_minutes: ageMin,
      last_value: null,
      error_message: lastError,
      source: row.source,
      run_kind: "atomic",
      run_duration_ms: null,
    });
  }

  // 4) Upsert in a single batch — with a per-row fallback so ONE poisoned row
  //    can never take down the whole watchdog again (2026-07-29 post-mortem:
  //    a single constraint-violating row 500'd every run for 9 days, silently
  //    killing all stale alerts AND the narrative-blurb green stamps).
  const failedRows: string[] = [];
  const { error: upErr } = await supabase
    .from("pipeline_health")
    .upsert(updates, { onConflict: "indicator_id" });
  if (upErr) {
    console.error("[pipeline-health-check] batch upsert failed, falling back to per-row:", upErr.message);
    for (const u of updates) {
      const { error: rowErr } = await supabase
        .from("pipeline_health")
        .upsert([u], { onConflict: "indicator_id" });
      if (rowErr) {
        failedRows.push(u.indicator_id);
        console.error(`[pipeline-health-check] row upsert failed (${u.indicator_id}):`, rowErr.message);
      }
    }
  }

  // 4b) Append the run to pipeline_fetch_log. Compute the per-row run duration
  //     by attributing the total elapsed time evenly across all rows in the
  //     batch — close enough for monitoring, and avoids a per-row stopwatch.
  const runDurationMs = Date.now() - runStartedAt;
  const perRowMs = logRows.length ? Math.round(runDurationMs / logRows.length) : 0;
  const stamped = logRows.map((r) => ({ ...r, run_duration_ms: perRowMs }));
  const { error: logErr } = await supabase.from("pipeline_fetch_log").insert(stamped);
  if (logErr) {
    // Don't fail the whole request — the chip already updated correctly via
    // pipeline_health. The fetch log is for the panel only. Log + continue.
    console.warn("[pipeline-health-check] pipeline_fetch_log insert failed:", logErr.message);
  }

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
            <li><strong>Expected cadence</strong>: ${CADENCE_LABEL[row.cadence] || "unknown"}</li>
            <li><strong>Age</strong>: ${ageMinutes == null ? "?" : ageMinutes < 1440 ? `${Math.round(ageMinutes / 60)} hours` : `${Math.round(ageMinutes / 60 / 24)} days`}</li>
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

  // 5b) 7-day stuck-red escalation emails — separate digest per indicator.
  let escalationsSent = 0;
  for (const { row, ageMinutes, daysStuck } of escalations) {
    try {
      await sendEmail({
        to: ALERT_TO,
        subject: `[MacroTilt] Stuck red ${daysStuck}d — ${row.label}`,
        html: `
          <p>Hi Joe,</p>
          <p>The <strong>${row.label}</strong> chip has been red for <strong>${daysStuck} days</strong>. The original alert went out when it first turned red; this is the 7-day escalation.</p>
          <ul>
            <li><strong>Indicator</strong>: ${row.indicator_id}</li>
            <li><strong>Source</strong>: ${row.source}</li>
            <li><strong>Last good</strong>: ${row.last_good_at || "never"}</li>
            <li><strong>Last error</strong>: ${row.last_error || "—"}</li>
          </ul>
          <p><strong>Likely causes</strong>: upstream vendor (FRED / BLS / etc.) is unusually slow, or our pipeline never picked up the next refresh. Check the source's public site (e.g., fred.stlouisfed.org for FRED series) to compare its latest data point with what we have.</p>
          <p>This escalation repeats once every 7 days while the chip stays red. It resets on the next green recovery.</p>
        `,
      });
      escalationsSent++;
    } catch (e) {
      console.error("[pipeline-health-check] 7d escalation Resend error:", (e as Error).message);
    }
  }

  // 6) Summary
  const green = updates.filter((u) => u.status === "green").length;
  const unknown = updates.filter((u) => u.status === "unknown").length;
  const red   = updates.filter((u) => u.status === "red").length;
  // (escalationsSent surfaced in the response below)

  // 7) [RETIRED 2026-07-29] The editorial-narrative gap check (#1078) is gone.
  //    generate-commentary wrote daily macro/sector blurbs that NO site surface
  //    or email has read since the Home brief moved to /daily_brief.json (the
  //    DAILY-BRIEF-WRITER pipeline). Joe approved killing the whole chain:
  //    pg_cron job unscheduled, manifest elements removed, health rows deleted,
  //    names added to killed_elements.json + reconciler RETIRED_FEEDS. Do NOT
  //    re-add a narrative_macro / narrative_sector / macro_commentary row or
  //    check here — that is the zombie loop killed_elements.json exists to stop.
  return json({ ok: true, checked: updates.length, green, red, unknown, alertsSent, failedRows });
}

serve(handle);


// deploy marker 2026-07-29: watchdog outage fix (see LESSONS 2026-07-29)
