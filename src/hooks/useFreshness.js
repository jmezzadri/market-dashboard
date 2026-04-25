// useFreshness.js — site-wide data-freshness hook.
//
// Reads public.pipeline_health (populated every 30 min by the
// pipeline-health-check edge function) and returns a RAG status + context
// for a given indicator.
//
// Usage
// ─────
//   const fresh = useFreshness("vix");
//   // fresh: { status, lastGoodAt, lastCheckAt, source, cadence,
//   //          cadenceMinutes, lastError, loading, missing }
//
//   <FreshnessDot fresh={fresh} onExplain={openReadme}/>
//
// Status semantics
// ────────────────
//   green  — last_good_at is within 1× expected cadence → data is current
//   amber  — 1–2× cadence — overdue but within the soft threshold
//   red    — >2× cadence, missing, or last fetch errored
//
// Caching
// ───────
//   The hook uses ONE in-module subscription to pipeline_health that all
//   consumers share — a hundred FreshnessDots on one page hit Supabase
//   exactly once. The data refreshes every 60s or on visibility change.
//
// Fallback
// ────────
//   When pipeline_health has no row for an indicator (e.g. first deploy,
//   edge fn cold start, or a newly-added series), the hook returns
//   `{ status: "unknown", missing: true }` and the FreshnessDot renders
//   a neutral grey circle instead of a colored one.
//
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

// ─── Shared cache ───────────────────────────────────────────────────────────
// A single promise + timestamp so every mount of the hook on a page gets the
// same snapshot. Refreshed every REFRESH_MS or when the tab regains focus.
// ────────────────────────────────────────────────────────────────────────────
const REFRESH_MS = 60_000;

let cachedRows = null;        // Map<indicator_id, row>
let lastFetchAt = 0;
let inflight = null;          // Promise<Map>
const listeners = new Set();  // Set<() => void>

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
    // Leave the cache alone on error — we keep the last good snapshot.
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

// Refresh on tab focus — common "did my data update?" moment for Joe.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastFetchAt = 0; // force
      ensureFresh();
    }
  });
}

// ─── Public hook ────────────────────────────────────────────────────────────
export function useFreshness(indicatorId) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    ensureFresh();
    const id = setInterval(ensureFresh, REFRESH_MS);
    return () => {
      listeners.delete(fn);
      clearInterval(id);
    };
  }, []);

  if (!cachedRows) {
    return { status: "loading", loading: true, missing: false, indicatorId };
  }
  const row = cachedRows.get(indicatorId);
  if (!row) {
    return { status: "unknown", loading: false, missing: true, indicatorId };
  }
  return {
    status: row.status,
    lastGoodAt: row.last_good_at,
    lastCheckAt: row.last_check_at,
    lastError: row.last_error,
    lastValue: row.last_value,
    source: row.source,
    label: row.label,
    cadence: row.cadence,
    cadenceMinutes: row.expected_cadence_minutes,
    loading: false,
    missing: false,
    indicatorId,
  };
}

// ─── Direct, component-less query — for rare cases where you need a snapshot
// outside the React lifecycle (e.g. imperative tooltip text). Always returns
// the cached snapshot; may return null on first call.
// ────────────────────────────────────────────────────────────────────────────
export function peekFreshness(indicatorId) {
  if (!cachedRows) return null;
  return cachedRows.get(indicatorId) || null;
}
