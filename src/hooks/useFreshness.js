// useFreshness.js — site-wide data-freshness hook.
//
// Grading: TWO CLOCKS, binary (FRESHNESS_CHIP_SPEC v2 — Joe 2026-06-17)
// ─────────────────────────────────────────────────────────────────────
// A chip is GREEN only if BOTH clocks pass:
//   • Pull clock — the producing job ran successfully on schedule
//     (pipeline_health.last_good_at vs its pull SLA). Catches a fetch job that
//     broke or stopped.
//   • Data clock — a NEW data point actually arrived within its cadence window
//     (pipeline_health.data_as_of vs the manifest data_max_age_hours). Catches a
//     vendor that went dark while the cron keeps "succeeding" (the fake-green
//     hole the one-clock rule left open).
// If either clock fails → RED, and the reason names which clock. Both clocks are
// calendar-aware (weekend/holiday hours never count). The data window is sized to
// each element's real publication cadence + lag, so a legitimately-laggy monthly
// or quarterly series stays GREEN between releases (no false-reds), while a daily
// feed that freezes reds within ~2 trading sessions.
//
// Binary green / red — no amber. An UNtracked element (no manifest entry, no
// tracking row) is RED, never green (spec v2 §1; Hard Rule 0.1: fake green
// forbidden; the goal is zero untracked). A registered but static/event-driven
// row with no SLA and no window is "reference" (grey) — exempt, not red.
// One shared function, gradeTwoClock (freshnessClock), mirrored server-side so
// chips, the watchdog, and alerts grade identically.
//
// Calendar-aware: the last-pull clock skips weekend/holiday hours for the job's
// run calendar, so a Friday pull is never "stale" on Monday morning
// (Joe's "no red chips over weekends" rule).
//
// Other behaviour
// ───────────────
// - Manifest (public/data_manifest.json) supplies freshness_sla_hours,
//   release_calendar, source_vendor, cadence, scheduled_fetch_time_et.
// - Aggregate rollup: when the element has dependencies, the worst-case status
//   wins and the tooltip names the failing input.
// - Reads public.pipeline_health for last_good_at + data_as_of + last_error per
//   element. Shared in-module subscription so 100 chips hit the DB once; 60s
//   refresh + tab-focus refresh.

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { formatRelativeAge, ageHoursAgainstCalendar, calendarDaysSince, gradeTwoClock } from "../lib/freshnessClock";
import {
  getElement,
  getAllElements,
  getSLAHours,
  getReleaseCalendar,
  getDependencies,
  subscribeManifest,
  isManifestLoaded,
} from "../lib/manifest";

const REFRESH_MS = 60_000;

// Returns the more recent of two ISO date / datetime strings; either may be
// null. Lets a genuinely-fresh data file override a lagging pipeline_health
// row instead of being dragged stale by it.
function mostRecentIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  const parse = (s) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime();
  const ta = parse(a);
  const tb = parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
}

let cachedRows = null;        // Map<indicator_id, pipeline_health row>
let lastFetchAt = 0;
let inflight = null;
let cachedGeneratedAt = null;   // indicator_history.json __meta__.generated_at_utc = the REAL build time
let metaInflight = null;
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

async function fetchRows() {
  if (!isSupabaseConfigured) {
    cachedRows = new Map();
    lastFetchAt = Date.now();
    return cachedRows;
  }
  const { data, error } = await supabase
    .from("pipeline_health")
    .select(
      "indicator_id, label, source, cadence, expected_cadence_minutes, " +
      "last_good_at, last_check_at, last_value, last_error, status, updated_at, " +
      // Phase 2 of the Data Steward overhaul (2026-05-12). The chips that
      // consume this hook now anchor their displayed "as of" timestamp to
      // data_as_of (the trading day the value represents) rather than
      // last_good_at (the cron run time). coverage_pct is exposed so
      // consumers can surface "16% of expected" alongside red status.
      // expected_next_run lets us render "next refresh at <time>".
      "data_as_of, expected_next_run, coverage_pct"
    );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[useFreshness] supabase error:", error.message);
    return cachedRows || new Map();
  }
  const map = new Map();
  for (const row of data || []) map.set(row.indicator_id, row);
  cachedRows = map;
  lastFetchAt = Date.now();
  return cachedRows;
}

async function fetchGeneratedAt() {
  // Real "last refreshed" time for file-backed indicators. The pipeline_health
  // last_good_at is an unreliable/synthetic value (it showed market-close 4PM,
  // making "Data as of" and "Last refreshed" identical). The indicator file's
  // __meta__.generated_at_utc is the actual moment the data was last written.
  try {
    const r = await fetch("/indicator_history.json", { cache: "no-cache" });
    if (r.ok) {
      const j = await r.json();
      cachedGeneratedAt = j?.__meta__?.generated_at_utc || null;
    }
  } catch {
    /* non-fatal — falls back to pipeline_health last_good_at */
  }
}

function ensureFresh() {
  const now = Date.now();
  if (!cachedGeneratedAt && !metaInflight) {
    metaInflight = fetchGeneratedAt().finally(() => { metaInflight = null; notify(); });
  }
  if (cachedRows && now - lastFetchAt < REFRESH_MS) return;
  if (inflight) return;
  inflight = fetchRows().finally(() => {
    inflight = null;
    notify();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastFetchAt = 0;
      ensureFresh();
    }
  });
}

// ─── Element-level status (atomic; no dep walk) ─────────────────────────────
// Returns the status object the chip needs to render itself for ONE element.
// Used recursively by the rollup walker, and directly by leaf chips.
function statusForElement(elementId, fallback) {
  // 2. Manifest gives us SLA + release_calendar + dependencies.
  //    Look up the manifest first because manifest entries are keyed by both
  //    short name (e.g. "vix") AND full id (e.g. "indicator-vix-daily").
  //    pipeline_health is keyed only by short name — so resolve to the short
  //    name before reading pipeline_health.
  const manifestEl = getElement(elementId);
  // Try in order:
  //   (a) manifest's name field (canonical),
  //   (b) the short-name middle slug of an "indicator-XXX-cadence" elementId
  //       (rescues rows where the manifest entry has the wrong cadence
  //       suffix or isn't registered at all — e.g. tga, loan_syn 2026-05-27),
  //   (c) the elementId itself (last resort).
  const slugMatch = /^indicator-([a-z0-9_]+)-(daily|weekly|monthly|quarterly)$/i.exec(elementId);
  // Resolve the pipeline_health key by trying every candidate and picking the
  // one that actually has a row. Most rows are keyed by the manifest short
  // NAME, but some are keyed by the full element ID (e.g. the
  // "equity-options_flow-daily" / "equity-short_interest-daily" rows whose
  // manifest name is "options_flow_alerts" / "short_interest_uw_finra").
  // Looking up by name alone missed those rows and rendered the chip red
  // ("No successful refresh on record") even though the row was green. Order
  // = name, full id, slug, elementId (name still wins when present).
  const phCandidates = [manifestEl?.name, manifestEl?.id, slugMatch && slugMatch[1], elementId].filter(Boolean);
  let phKey = phCandidates[0] || elementId;
  if (cachedRows) {
    for (const cand of phCandidates) { if (cachedRows.has(cand)) { phKey = cand; break; } }
  }

  // 1. Pipeline-health row gives us last_good_at + last_error + label.
  const phRow = (cachedRows && cachedRows.get(phKey)) || null;
  // SLA hours: manifest first; fallback to passed-in cadence-derived if absent.
  const slaHours = manifestEl ? Number(manifestEl.freshness_sla_hours) || 0 : 0;
  const calendar =
    (manifestEl && manifestEl.release_calendar) ||
    (fallback?.calendar) ||
    "wall-clock";

  // 3. Two dates, two different jobs:
  //    - dataDate = the trading day the value on the page actually
  //      represents (the `as_of` inside the live data file, passed as
  //      asOfIso, and/or pipeline_health.data_as_of). THIS is what
  //      "is it stale?" measures — a cron can run green every night and
  //      still emit a stale file, so the cron-run time must not drive the
  //      staleness call.
  //    - lastGoodAt = the cron-run time. Kept only to detect "this pipeline
  //      has never produced a successful run".
  //    Take the most recent signal for each so a frozen pipeline_health row
  //    cannot drag a genuinely-fresh data file stale. (Fix 2026-05-21.)
  // When a consumer tells us the as-of of the value it is actually rendering
  // (fallback.asOfIso — e.g. the last point of the chart the user is looking
  // at), THAT is authoritative for staleness. A pipeline_health row that
  // recorded a later successful run than the data the page is showing must not
  // make a stale on-screen value look fresh — the user sees the published
  // file, not the cron log. (Joe 2026-05-28: freshness chips were green while
  // the plotted series was days old because the chip trusted pipeline_health
  // over the file.) When no consumer as-of is supplied, fall back to
  // pipeline_health's data_as_of as before.
  // Honest-stamp rule (2026-06-11): a data_as_of stored at exactly midnight
  // UTC is date-only INTENT (the business date). Normalize it to a plain
  // date string so display and session math treat it as a date — not as
  // "8:00 PM the previous evening" in New York (the bug Joe caught: chips
  // showing "Data as of Jun 10 · Last refreshed Jun 9").
  let phAsOf = phRow?.data_as_of || null;
  if (phAsOf && /T00:00:00(\.0+)?(\+00:00|Z)$/.test(String(phAsOf))) {
    phAsOf = String(phAsOf).slice(0, 10);
  }
  const dataDate = fallback?.asOfIso || phAsOf || null;
  const lastGoodAt = phRow?.last_good_at || null;
  const lastError = phRow?.last_error || null;

  // 4. Pull-clock input (TWO-CLOCK grade, spec v2). Last Pull = the producing
  // job's real last successful run time. last_good_at is that run time (an honest
  // wall-clock stamp); for file-backed indicators whose row may lag, the indicator
  // file's own build time is an equally-real fallback. The data's as-of feeds the
  // hard invariant (data can never be dated after the pull that fetched it) AND the
  // data clock (a new point must have arrived within its window). Two clocks
  // together kill BOTH failure modes: a dead job stops advancing last_good_at
  // (pull clock reds), and a vendor going dark stops advancing data_as_of while the
  // cron still "succeeds" (data clock reds — the one-clock fake-green hole).
  // Last Pull = the job's own real last successful run time (per element).
  // Prefer pipeline_health.last_good_at — an honest wall-clock run stamp since
  // the 2026-06-11 honest-stamp fix — and fall back to the indicator file's
  // build time only for a file-backed element that has no row stamp yet. We
  // DISPLAY the same value we grade on, so a per-element pull (e.g. the 4:45 PM
  // commodity job) never shows the earlier shared indicator-file build time and
  // read as an impossible "data newer than its last pull" pair.
  const lastPullIso =
    lastGoodAt ||
    (String(manifestEl?.output_destination || "").includes("indicator_history.json")
      ? cachedGeneratedAt
      : null) ||
    null;
  const lastRefreshedAt = lastPullIso;

  // Grade against the JOB's run calendar so weekend/holiday hours are not
  // counted (no Monday false-reds on weekday-only jobs). Every chip element
  // carries a valid release_calendar in the manifest; coerce anything else to
  // the business-day calendar the scheduled jobs actually run on.
  const gradeCalendar =
    (calendar === "nyse-trading-day" || calendar === "us-business-day" || calendar === "wall-clock")
      ? calendar
      : "us-business-day";

  // Data-clock inputs (FRESHNESS doctrine v2 — two-clock, Joe 2026-06-17). The
  // data clock checks that a NEW data point actually arrived within its cadence
  // window — catching a vendor that goes dark while the pull job keeps
  // "succeeding". Window + calendar come from the manifest (data_max_age_hours /
  // data_calendar). A window of 0 = exempt (static reference, event-driven rows),
  // so those grade on the pull clock alone, exactly as before.
  const maxDataAgeHours = manifestEl ? Number(manifestEl.data_max_age_hours) || 0 : 0;
  const dataCalendar =
    (manifestEl &&
      (manifestEl.data_calendar === "nyse-trading-day" ||
        manifestEl.data_calendar === "us-business-day" ||
        manifestEl.data_calendar === "wall-clock"))
      ? manifestEl.data_calendar
      : gradeCalendar;

  const isUntracked = !manifestEl && !phRow && !dataDate && !lastGoodAt;
  // Registered but not time-graded: a static reference row or an event-driven
  // catalog row with neither a pull SLA nor a data window. Spec v2 §3: static is
  // exempt, labeled "reference" — no freshness grade, and NOT red.
  const isReferenceExempt = !!manifestEl && slaHours <= 0 && maxDataAgeHours <= 0;

  let status;
  let reason;
  if (isUntracked) {
    // No manifest entry, no tracking row, no dates. Untracked is RED, never green
    // (spec v2 §1; Hard Rule 0.1: fake green forbidden). The goal is zero untracked.
    status = "red";
    reason = "Not registered — freshness is not tracked for this element";
  } else if (isReferenceExempt) {
    status = "unknown";
    reason = "Reference / event-driven — no freshness target";
  } else {
    // TWO-CLOCK grade: green only if BOTH the pull clock (the job ran on schedule,
    // no error, invariant holds) AND the data clock (a new point arrived within its
    // window) pass. Binary green/red — no amber. gradeTwoClock calls gradeByLastPull
    // for the pull clock, then checks the data clock.
    const graded = gradeTwoClock({
      lastPullIso,
      asOfIso: dataDate,
      dataAsOfIso: dataDate,
      slaHours,
      calendar: gradeCalendar,
      lastError,
      maxDataAgeHours,
      dataCalendar,
    });
    status = graded.status;
    reason = graded.reason;
  }

  return {
    elementId,
    status,
    lastGoodAt,
    lastError,
    slaHours,
    // Data-clock budget (two-clock): how old the newest data point may be before
    // the chip reds. This — not the pull SLA — is the user-meaningful staleness
    // budget the chip's SLA line should show. 0 = exempt (reference/event-driven).
    maxDataAgeHours,
    dataCalendar,
    calendar,
    lastRefreshedAt,
    label: manifestEl?.name || phRow?.label || elementId,
    description: manifestEl?.description || null,
    sourceVendor: manifestEl?.source_vendor || phRow?.source || null,
    // Frequency + scheduled fetch time — so every chip can show all five
    // governance fields (Source, Frequency+calendar, Timing ET, SLA, Last update).
    cadence: manifestEl?.cadence || phRow?.cadence || null,
    // Plain-English display override for the chip's Frequency line. Lets a
    // daily-but-lagged feed read honestly, e.g. "Daily T+3" (the Fed posts the
    // value 3 business days late) instead of a bare "Daily" that looks broken
    // beside a 3-day-old date. Drives display only — the cadence above still
    // drives logic. (Joe 2026-06-17: "We need to be transparent.")
    cadenceLabel: manifestEl?.cadence_label || null,
    scheduledFetchET: manifestEl?.scheduled_fetch_time_et || null,
    asOfCutoffEt: manifestEl?.as_of_cutoff_et || null,
    reason,
    // Phase 2 of the Data Steward overhaul. dataAsOf is the trading day the
    // value represents — the chip's "Last close: <date>" copy uses this,
    // not lastGoodAt (cron run time). coveragePct and expectedNextRun ride
    // along so tooltips can show "16% of expected universe" and "next
    // refresh at <time>".
    // dataAsOf — the trading day the value represents. Prefer the live
    // file's as_of over a lagging tracking row; fall back to the cron time.
    dataAsOf: dataDate || lastGoodAt || null,
    // Calendar-aware age (hours) of the displayed value. Weekends + holidays
    // are not counted, so the relative-age text the chip shows ("1d ago")
    // matches the same trading/business calendar the staleness call uses —
    // a value from the last trading session never reads "2d ago" next to a
    // green dot just because a weekend or midnight-rounding sat in between.
    calendarAgeHours: (dataDate || lastGoodAt)
      ? ageHoursAgainstCalendar(dataDate || lastGoodAt, calendar)
      : null,
    // Whole ET-session-days since the displayed value's date — drives the
    // "Nd ago" label so it never disagrees with the dot (see calendarDaysSince).
    calendarDaysAgo: (dataDate || lastGoodAt)
      ? calendarDaysSince(dataDate || lastGoodAt, calendar)
      : null,
    coveragePct: phRow?.coverage_pct != null ? Number(phRow.coverage_pct) : null,
    expectedNextRun: phRow?.expected_next_run || null,
    missingFromManifest: !manifestEl,
    missingFromPipelineHealth: !phRow,
  };
}

// ─── Aggregate rollup ───────────────────────────────────────────────────────
// Walks dependencies and returns the worst-case status across the element
// itself + every input. Includes a `cause` chain so the tooltip can name
// the specific upstream that fired the red.
function rollupStatus(elementId, fallback, visited = new Set()) {
  if (visited.has(elementId)) {
    // Cycle guard. Shouldn't happen with our manifest, but fail closed.
    return { elementId, status: "red", reason: "dependency cycle", cause: null, label: elementId };
  }
  visited.add(elementId);

  const own = statusForElement(elementId, fallback);
  const deps = getDependencies(elementId);

  if (!deps.length) {
    return { ...own, cause: null, redInputs: [] };
  }

  // Walk every dependency. Collect any that are red.
  const childResults = deps.map((depId) => rollupStatus(depId, null, visited));
  const redChildren = childResults.filter((c) => c.status === "red");

  if (own.status === "red" && redChildren.length === 0) {
    // The aggregate's own calc is stale or errored, but every input is fine.
    // The chip's tooltip should name the calc itself, not an input.
    return { ...own, cause: { kind: "self", element: own }, redInputs: [] };
  }
  if (redChildren.length > 0) {
    // Sort red children by oldest last_good_at first — that's the most-stale
    // and most-likely root cause.
    redChildren.sort((a, b) => {
      const ta = a.lastGoodAt ? new Date(a.lastGoodAt).getTime() : 0;
      const tb = b.lastGoodAt ? new Date(b.lastGoodAt).getTime() : 0;
      return ta - tb;
    });
    return {
      ...own,
      status: "red",
      reason: own.status === "red" ? own.reason : "Upstream input is stale",
      cause: { kind: "input", element: redChildren[0] },
      redInputs: redChildren,
    };
  }
  return { ...own, cause: null, redInputs: [] };
}

// ─── Public hook ────────────────────────────────────────────────────────────
// Same call shape as before:
//   const fresh = useFreshness("vix");
//   const fresh = useFreshness("composite_rl");  // walks deps automatically
// fallback is optional: { asOfIso, calendar } — used only when pipeline_health
// has no row yet (first deploy) and the manifest can't tell us either.
export function useFreshness(elementId, fallback) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    const unsubManifest = subscribeManifest(fn);
    ensureFresh();
    const id = setInterval(ensureFresh, REFRESH_MS);
    return () => {
      listeners.delete(fn);
      unsubManifest();
      clearInterval(id);
    };
  }, []);

  if (!cachedRows || !isManifestLoaded()) {
    return { status: "loading", loading: true, missing: false, indicatorId: elementId, elementId };
  }

  // Build the rolled-up result for this element.
  const rolled = rollupStatus(elementId, fallback);
  return {
    status: rolled.status,             // "green" | "red"
    loading: false,
    missing: rolled.missingFromManifest && rolled.missingFromPipelineHealth,
    indicatorId: elementId,            // legacy field name
    elementId,                          // new field name; same value
    lastGoodAt: rolled.lastGoodAt,
    lastRefreshedAt: rolled.lastRefreshedAt,
    lastError: rolled.lastError,
    label: rolled.label,
    description: rolled.description,
    sourceVendor: rolled.sourceVendor,
    slaHours: rolled.slaHours,
    maxDataAgeHours: rolled.maxDataAgeHours,
    dataCalendar: rolled.dataCalendar,
    calendar: rolled.calendar,
    cadence: rolled.cadence,
    cadenceLabel: rolled.cadenceLabel,
    scheduledFetchET: rolled.scheduledFetchET,
    asOfCutoffEt: rolled.asOfCutoffEt,
    // Phase 2 — exposed to chips/tooltips so they can render the actual
    // trading day the value is from, the coverage ratio, and the next
    // expected refresh time.
    dataAsOf: rolled.dataAsOf,
    calendarAgeHours: rolled.calendarAgeHours,
    calendarDaysAgo: rolled.calendarDaysAgo,
    coveragePct: rolled.coveragePct,
    expectedNextRun: rolled.expectedNextRun,
    reason: rolled.reason,
    cause: rolled.cause,
    redInputs: rolled.redInputs || [],
    formatRelativeAge: () => formatRelativeAge(rolled.lastGoodAt),
  };
}

// ─── useFreshnessRollup — site-wide rollup for the global header pill ───────
// Grades EVERY registered element with the exact same rollupStatus() the
// per-element chips use, so the header count can never disagree with the
// chips on the page (the old header read only indicator_history.json + COT,
// so it stayed "All feeds current" while a scanner/equity chip was red).
// Returns the list of genuinely-stale (red) feeds; amber is surfaced
// separately as "lagging" and grey/unknown is ignored (untracked is not a
// breakage). Joe 2026-06-15: "the header should read everything."
export function useFreshnessRollup() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    const unsubManifest = subscribeManifest(fn);
    ensureFresh();
    const id = setInterval(ensureFresh, REFRESH_MS);
    return () => {
      listeners.delete(fn);
      unsubManifest();
      clearInterval(id);
    };
  }, []);

  if (!cachedRows || !isManifestLoaded()) {
    return { loading: true, red: [], amber: [], greenCount: 0 };
  }

  const els = getAllElements() || [];
  const seen = new Set();
  const red = [];
  const amber = [];
  let greenCount = 0;
  for (const el of els) {
    const name = el?.name;
    const id = el?.id || name;
    if (!name && !id) continue;
    // Only count ACTIVELY-TRACKED feeds: ones with a pipeline_health row.
    // The manifest is also a data catalog and registers backend tables
    // (accounts, transactions, bug_reports, …) that
    // are not user-facing freshness-chipped feeds and have no tracking row;
    // grading those would report "no successful refresh" red and balloon the
    // count (38 vs the real handful). pipeline_health is keyed by the short
    // name, so a row keyed by name (or id) means it's a real tracked feed.
    const phKey = cachedRows.has(name) ? name : (cachedRows.has(id) ? id : null);
    if (!phKey || seen.has(phKey)) continue;
    seen.add(phKey);
    let r;
    try { r = rollupStatus(name || id); } catch { continue; }
    // Prefer the friendly pipeline_health label ("Indicator history") over
    // the manifest short-code ("indicator_history"), so the header tooltip
    // reads in plain English.
    const phRow = cachedRows.get(phKey);
    const label = (phRow && phRow.label) || r.label || name || id;
    if (r.status === "red") red.push({ id: phKey, label, reason: r.reason || r.lastError || null });
    else if (r.status === "amber") amber.push({ id: phKey, label });
    else if (r.status === "green") greenCount += 1;
    // "unknown"/"loading" are not counted — untracked is not a breakage.
  }
  red.sort((a, b) => a.label.localeCompare(b.label));
  return { loading: false, red, amber, greenCount };
}

// ─── useFetchLog (from PR #15, kept) ───────────────────────────────────────
export function useFetchLog(elementId, limit = 7) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!elementId) { setRows([]); return; }
    if (!isSupabaseConfigured) { setRows([]); return; }
    let cancelled = false;
    setRows(null);
    setError(null);
    supabase
      .from("pipeline_fetch_log")
      .select("id, indicator_id, check_at, status, age_minutes, error_message, run_kind, run_duration_ms, meta, source")
      .eq("indicator_id", elementId)
      .order("check_at", { ascending: false })
      .limit(Math.max(1, Math.min(50, limit)))
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRows([]);
          return;
        }
        setRows(data || []);
      });
    return () => { cancelled = true; };
  }, [elementId, limit]);

  return { rows: rows ?? [], loading: rows === null, error };
}

// ─── Snapshot peek for non-React contexts ──────────────────────────────────
export function peekFreshness(elementId) {
  if (!cachedRows) return null;
  return cachedRows.get(elementId) || null;
}
