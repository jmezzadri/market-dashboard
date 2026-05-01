// manifest.js — runtime accessor for /public/data_manifest.json.
//
// Phase 4 PR #16. Loads the manifest once per session, caches it in a
// module-level Map keyed by element name (e.g. "vix"), and exposes a few
// targeted lookups the freshness chip uses:
//   - getElement(name)        : the full row, or null
//   - getSLAHours(name)        : freshness_sla_hours, or null
//   - getReleaseCalendar(name) : "nyse-trading-day" | "us-business-day" | "wall-clock"
//   - getDependencies(name)    : array of upstream element names (empty for atomic)
//
// Cache strategy:
//   - One in-flight fetch shared across all consumers.
//   - 24-hour TTL — manifest is small (~90 KB) and rarely changes; a daily
//     re-fetch is plenty fresh for a runtime that ships per Vercel deploy.
//   - subscribe() lets hooks re-render once the manifest lands.

const MANIFEST_URL = "/data_manifest.json";
const TTL_MS = 24 * 60 * 60 * 1000;

let cache = null;            // Map<name, element>
let lastLoadedAt = 0;
let inflight = null;
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

async function fetchManifest() {
  // Cache-bust gently with the build-time hash if available; falls back to
  // the natural HTTP cache (max-age=300 on raw GH content, similar on Vercel).
  let resp;
  try {
    resp = await fetch(MANIFEST_URL, { cache: "default" });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[manifest] fetch failed:", e?.message || e);
    return cache || new Map();
  }
  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.warn("[manifest] non-200:", resp.status);
    return cache || new Map();
  }
  let data;
  try { data = await resp.json(); }
  catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[manifest] JSON parse failed:", e?.message || e);
    return cache || new Map();
  }
  const map = new Map();
  const els = Array.isArray(data?.elements) ? data.elements : [];
  for (const el of els) {
    if (el && typeof el === "object" && typeof el.name === "string") {
      map.set(el.name, el);
      // Also index by `id` for future callers that pass full IDs.
      if (typeof el.id === "string") map.set(el.id, el);
    }
  }
  cache = map;
  lastLoadedAt = Date.now();
  return cache;
}

function ensureLoaded() {
  const now = Date.now();
  if (cache && now - lastLoadedAt < TTL_MS) return;
  if (inflight) return;
  inflight = fetchManifest().finally(() => {
    inflight = null;
    notify();
  });
}

// Eagerly kick off the load on module import so the first chip render
// usually has the data ready. Browsers swallow background fetches so this
// is cheap.
if (typeof window !== "undefined") ensureLoaded();

// ─── Public lookups ────────────────────────────────────────────────────────
export function getElement(nameOrId) {
  ensureLoaded();
  if (!cache) return null;
  return cache.get(nameOrId) || null;
}

export function getSLAHours(nameOrId) {
  const el = getElement(nameOrId);
  if (!el) return null;
  const v = el.freshness_sla_hours;
  return Number.isFinite(v) ? v : null;
}

export function getReleaseCalendar(nameOrId) {
  const el = getElement(nameOrId);
  if (!el) return null;
  const c = el.release_calendar;
  if (c === "nyse-trading-day" || c === "us-business-day" || c === "wall-clock") return c;
  return null;
}

export function getDependencies(nameOrId) {
  const el = getElement(nameOrId);
  if (!el) return [];
  return Array.isArray(el.dependencies) ? el.dependencies : [];
}

// ─── Hook-friendly subscription ─────────────────────────────────────────────
// Returns an unsubscribe function. Call notify-back with no args; the hook
// triggers a re-render via setState in its useEffect.
export function subscribeManifest(fn) {
  listeners.add(fn);
  ensureLoaded();
  return () => listeners.delete(fn);
}

// Returns whether the manifest is loaded yet — for tests + dev guards.
export function isManifestLoaded() {
  return cache !== null;
}
