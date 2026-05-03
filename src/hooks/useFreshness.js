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
import { isStaleAgainstSLA, formatRelativeAge } from "../lib/freshnessClock";
import {
  getElement,
  getSLAHours,
  getReleaseCalendar,
  getDependencies,
  subscribeManifest,
  isManifestLoaded,
} from "../lib/manifest";

const REFRESH_MS = 60_000;

let cachedRows = null;        // Map<indicator_id, pipeline_health row>
let lastFetchAt = 0;
let inflight = null;
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
      "last_good_at, last_check_at, last_value, last_error, status, updated_at"
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

function ensureFresh() {
  const now = Date.now();
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
  const phKey = manifestEl?.name || elementId;

  // 1. Pipeline-health row gives us last_good_at + last_error + label.
  const phRow = (cachedRows && cachedRows.get(phKey)) || null;
  // SLA hours: manifest first; fallback to passed-in cadence-derived if absent.
  const slaHours = manifestEl ? Number(manifestEl.freshness_sla_hours) || 0 : 0;
  const calendar =
    (manifestEl && manifestEl.release_calendar) ||
    (fallback?.calendar) ||
    "wall-clock";

  // 3. Decide last_good_at: prefer pipeline_health, else fall back to caller's
  //    asOfIso (which the chip passes when pipeline_health hasn't backfilled).
  const lastGoodAt = phRow?.last_good_at || fallback?.asOfIso || null;
  const lastError = phRow?.last_error || null;

  // 4. Two-state decision.
  // Joe directive 2026-05-03: "I only want to know when something breaks."
  // Concretely, this means red is reserved for:
  //   - Upstream pull errored (lastError set)
  //   - Element is registered (manifest entry OR pipeline_health row) AND
  //     last_good_at is past SLA on the calendar
  // An element with NO manifest entry AND NO pipeline_health row AND NO
  // asOfIso fallback is "freshness tracking not configured yet" — render
  // green and let the tooltip explain. Surfacing a chip that just says
  // "no record" trains the user to ignore reds.
  let status = "green";
  let reason = null;

  const isUntracked = !manifestEl && !phRow && !lastGoodAt;

  if (isUntracked) {
    status = "green";
    reason = "Freshness tracking not yet configured for this element";
  } else if (lastError) {
    status = "red";
    reason = `Upstream error: ${lastError}`;
  } else if (!lastGoodAt) {
    status = "red";
    reason = "No successful refresh on record";
  } else if (slaHours > 0) {
    if (isStaleAgainstSLA(lastGoodAt, slaHours, calendar)) {
      status = "red";
      reason = "Past freshness SLA";
    }
  }

  return {
    elementId,
    status,
    lastGoodAt,
    lastError,
    slaHours,
    calendar,
    label: manifestEl?.name || phRow?.label || elementId,
    description: manifestEl?.description || null,
    sourceVendor: manifestEl?.source_vendor || phRow?.source || null,
    reason,
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
    lastError: rolled.lastError,
    label: rolled.label,
    description: rolled.description,
    sourceVendor: rolled.sourceVendor,
    slaHours: rolled.slaHours,
    calendar: rolled.calendar,
    reason: rolled.reason,
    cause: rolled.cause,
    redInputs: rolled.redInputs || [],
    formatRelativeAge: () => formatRelativeAge(rolled.lastGoodAt),
  };
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
