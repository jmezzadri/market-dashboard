// useFreshness.js — site-wide data-freshness hook (PR #16 rebuild).
//
// What changed in PR #16
// ──────────────────────
// 1. Two-state semantics. The chip is GREEN or RED — no amber. Joe sign-off
//    2026-05-01: "I dont trust the system yet, I want to see if the data
//    is stale (RED), or if its operating within SLA (Green)."
//
// 2. Manifest-driven thresholds. Per-element freshness_sla_hours +
//    release_calendar come from public/data_manifest.json (PR #13). The
//    legacy CADENCE_TOLERANCE_MINUTES math is gone.
//
// 3. Aggregate rollup. When the queried element has dependencies, the
//    hook walks them and OR-reds. Tooltip names the specific failing
//    dependency, or — if the aggregate's own calc is stale — the calc
//    itself.
//
// 4. Trading-calendar awareness comes via the freshnessClock utility
//    (PR #14). isStaleAgainstSLA(asOf, sla, calendar) skips weekends +
//    NYSE/business-day holidays as Joe's "Sunday-night-not-stale"
//    requirement demands.
//
// What stayed the same
// ────────────────────
// - Reads public.pipeline_health for last_good_at + last_check_at +
//   last_error per indicator. Edge function still owns the "did it
//   refresh" data; chip owns the "is it stale" decision.
// - Shared in-module subscription so 100 chips on one page hit Supabase
//   exactly once. 60s refresh cadence + tab-focus refresh.
//
// Status semantics (post-PR-16)
// ─────────────────────────────
//   green  — within SLA per manifest AND no upstream pull error AND every
//            dependency rolls up green
//   red    — anything else: stale, missing, error, or any input red.

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { isStaleAgainstSLA, formatRelativeAge, ageHoursAgainstCalendar, calendarDaysSince, dailySessionGrade } from "../lib/freshnessClock";
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
  const phKey =
    manifestEl?.name
    || (slugMatch && slugMatch[1])
    || elementId;

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

  // 4. Two-state decision.
  // Joe directive 2026-05-03: "I only want to know when something breaks."
  // Red is reserved for: an upstream pull error, an element that has never
  // refreshed, or an element whose DATA is past its freshness SLA on the
  // calendar. An element with NO manifest entry, NO pipeline_health row and
  // NO date at all is "freshness tracking not configured yet" — render green
  // and let the tooltip explain, rather than train the user to ignore a chip
  // that just says "no record".
  // GREEN only when a value is affirmatively graded within its SLA. Anything
  // we cannot confirm is "unknown" (never green) — Joe 2026-06-02: untracked is
  // never green; no fake-green anywhere on the site.
  let status = "unknown";
  let reason = null;

  const isUntracked = !manifestEl && !phRow && !dataDate && !lastGoodAt;

  if (isUntracked) {
    status = "unknown";
    reason = "Freshness not tracked for this element";
  } else if (lastError) {
    status = "red";
    reason = `Upstream error: ${lastError}`;
  } else if (!dataDate && !lastGoodAt) {
    status = "red";
    reason = "No successful refresh on record";
  } else if (String(manifestEl?.cadence || "").toLowerCase().startsWith("daily")) {
    // Session-frontier doctrine (Joe 2026-06-12): dailies are graded in
    // trading sessions against their publication frontier, not wall-clock
    // hour budgets. The hour budgets tolerated 49-73h of true staleness on
    // DAILY elements — long enough to hide a dead feed until the weekend.
    // Green = at the frontier (the newest session the source can have
    // published by its fetch deadline); amber = exactly one session behind
    // (today's pull missed or late); red = two or more behind. Deadlines
    // exist only on business days, so weekends/holidays never count.
    const g = dailySessionGrade(dataDate || lastGoodAt, {
      fetchTimeET: manifestEl?.scheduled_fetch_time_et,
      graceHours: Number(manifestEl?.fetch_grace_hours) || 3,
      lagSessions: Number(manifestEl?.lag_sessions) || 0,
    });
    status = g.grade;
    reason =
      g.grade === "amber" ? `1 session behind — expected data through ${g.expectedDate}` :
      g.grade === "red" ? `${g.behind} sessions behind — expected data through ${g.expectedDate}` :
      null;
  } else if (slaHours > 0) {
    status = isStaleAgainstSLA(dataDate || lastGoodAt, slaHours, calendar)
      ? "red"
      : "green";
    reason = status === "red" ? "Past freshness SLA" : null;
  } else {
    // Have a date but no SLA to grade against — cannot confirm fresh.
    status = "unknown";
    reason = "No freshness target configured — cannot confirm";
  }

  // Real fetch time: prefer the indicator file's true build timestamp for
  // file-backed indicators; fall back to pipeline_health for everything else.
  const lastRefreshedAt =
    (String(manifestEl?.output_destination || "").includes("indicator_history.json")
      ? cachedGeneratedAt
      : null) || lastGoodAt;

  // Impossible-pair guard (2026-06-11): data can never be newer than the
  // refresh that produced it. If it reads that way, a producer wrote a
  // fabricated stamp — surface red with the reason instead of rendering an
  // impossible tooltip. Date-only as-ofs compare by ET session date.
  if (status !== "red" && dataDate && lastRefreshedAt) {
    const refMs = new Date(lastRefreshedAt).getTime();
    let impossible = false;
    if (String(dataDate).length === 10) {
      const refEtDate = Number.isFinite(refMs)
        ? new Date(refMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        : null;
      impossible = !!refEtDate && String(dataDate) > refEtDate;
    } else {
      const asOfMs = new Date(dataDate).getTime();
      impossible = Number.isFinite(asOfMs) && Number.isFinite(refMs) && asOfMs > refMs + 5 * 60 * 1000;
    }
    if (impossible) {
      status = "red";
      reason = "Timestamps inconsistent — the data reports newer than its last refresh (stamp fabrication; flagged for repair)";
    }
  }

  return {
    elementId,
    status,
    lastGoodAt,
    lastError,
    slaHours,
    calendar,
    lastRefreshedAt,
    label: manifestEl?.name || phRow?.label || elementId,
    description: manifestEl?.description || null,
    sourceVendor: manifestEl?.source_vendor || phRow?.source || null,
    // Frequency + scheduled fetch time — so every chip can show all five
    // governance fields (Source, Frequency+calendar, Timing ET, SLA, Last update).
    cadence: manifestEl?.cadence || phRow?.cadence || null,
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
    calendar: rolled.calendar,
    cadence: rolled.cadence,
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
    const id = el?.id || el?.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let r;
    try { r = rollupStatus(el.id || el.name); } catch { continue; }
    const label = r.label || el.name || id;
    if (r.status === "red") red.push({ id, label, reason: r.reason || r.lastError || null });
    else if (r.status === "amber") amber.push({ id, label });
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
