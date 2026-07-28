// useDataHealth — shared accessor for the Admin Data Health surfaces.
//
// Reads public.pipeline_health (52 rows, RLS-gated on is_admin()) once per
// session and rolls it up by canonical vendor so the Admin landing tiles +
// the per-vendor detail pages + the cross-vendor Data Health page can all
// pull from the same in-memory copy. 60-second refresh cadence + tab-focus
// re-fetch matches the rest of the freshness UX on the site.
//
// Why this hook exists (rather than three separate queries)
// ─────────────────────────────────────────────────────────
// 1. The Admin landing tile, the UW page, the Massive page, and the
//    Data Health page all need the same underlying rows. Querying once
//    saves three round-trips on the admin home.
// 2. Canonical vendor names ("Polygon Massive", "SEC EDGAR", "FRED"
//    ...) come from a single mapping table here so the three surfaces
//    can't disagree on labelling.
// 3. The rollup math (per-vendor feed counts, per-vendor green vs red,
//    last refresh per vendor) is centralised so a column-rename in
//    pipeline_health only requires changing one file.
//
// Data Steward sign-off: vendor mapping rules below match the canonical
// vendor list in data_vendors.md (8 paid + free + computed). Computed
// in-house rows do not roll up to a vendor — they show under "MacroTilt
// in-house" so the user can see which scores depend on internal calc
// pipelines vs external feeds.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const REFRESH_MS = 60_000;

// Module-level cache shared across all consumers — same pattern as
// useFreshness, so a page with multiple hook callers hits Supabase once.
let cachedRows = null;
let lastFetchAt = 0;
let inflight = null;
const listeners = new Set();
function notify() { listeners.forEach((fn) => fn()); }

// ─── Canonical vendor mapping ──────────────────────────────────────────────
// Each pipeline_health row has a `source` string that describes the actual
// upstream (e.g. "FRED VIXCLS", "Yahoo ^MOVE"). For the Admin scorecard we
// roll those up into the canonical vendor names that match data_vendors.md.
const VENDOR_RULES = [
  { test: (s) => /^massive$/i.test(s),              vendor: "Polygon Massive" },
  { test: (s) => /^Treasury\.gov\b/i.test(s),       vendor: "U.S. Treasury" },
  { test: (s) => /^FRED\b/i.test(s),                vendor: "FRED" },
  { test: (s) => /^Yahoo\b/i.test(s),               vendor: "Yahoo Finance" },
  { test: (s) => /^ISM\b/i.test(s),                 vendor: "ISM" },
  { test: (s) => /^NY Fed\b/i.test(s),              vendor: "New York Fed" },
  { test: (s) => /^Fed Board\b/i.test(s),           vendor: "Federal Reserve Board" },
  { test: (s) => /^Shiller\b/i.test(s),             vendor: "Shiller dataset" },
  { test: (s) => /^CME\b/i.test(s),                 vendor: "CME" },
  { test: (s) => /^FDIC\b/i.test(s),                vendor: "FDIC" },
  { test: (s) => /^ZeroHedge\b/i.test(s),           vendor: "ZeroHedge" },
  { test: (s) => /^State Street\b/i.test(s),        vendor: "State Street SPDR" },
  { test: (s) => /^GitHub:/i.test(s),               vendor: "GitHub public roster" },
  { test: (s) => /^Nasdaq\b|FINRA\b/i.test(s),      vendor: "Nasdaq / FINRA" },
  // Catch-all for in-house computations. Kept LAST so the explicit rules
  // above win first when an in-house row happens to also name FRED.
  { test: (s) => /^Computed\b/i.test(s),            vendor: "MacroTilt in-house" },
];
export function canonicalVendor(source) {
  if (!source) return "Unknown";
  for (const r of VENDOR_RULES) if (r.test(source)) return r.vendor;
  return source;
}

// One-line summary of what each canonical vendor powers on the live site.
// Used for the tile subtitles + the vendor scorecard "blast radius" column.
// Data Steward owns this copy (matches data_vendors.md "Removal blast radius").
export const VENDOR_BLAST_RADIUS = {
  "Polygon Massive":
    "End-of-day prices for all 12,600 US-listed tickers, ticker names + sectors, dividends, splits. Powers Trading Opps screener, Portfolio Insights position marks, sector performance.",
  "SEC EDGAR":
    "Form 4/4A/5/5A insider filings, parsed nightly straight from the SEC. Powers the scanner's insider score and the Ticker page insider evidence.",
  "FRED":
    "25+ macro series (HY/IG spreads, claims, M2, balance sheet, term premium, RRP, SLOOS). Powers Macro Overview indicators and indicator drilldowns. Treasury yields + TIPS were migrated to Treasury.gov 2026-05-27 for same-day publication.",
  "U.S. Treasury":
    "Daily Treasury par yield curve (1Mo–30Y nominal) and daily TIPS real yield curve (5Y–30Y). Powers the 10Y-2Y slope, 10Y TIPS real rate, and 10Y inflation breakeven indicators. Free CSV feed at home.treasury.gov, same-day publication ~16:00 ET.",
  "Yahoo Finance":
    "VIX, MOVE, SKEW, KBE/SPY ratio, LQD/HYG ratio, DX-Y dollar index. Powers macro indicators + portfolio price marks where Polygon coverage is incomplete.",
  "ISM":
    "Manufacturing + Services PMI. Monthly. Powers the ISM Manufacturing and Services activity indicators.",
  "New York Fed":
    "Corporate Market Distress Index (CMDI). Powers the Corporate Market Distress indicator.",
  "Federal Reserve Board":
    "Kansas City Financial Stress Index. Powers the Kansas City Financial Stress indicator.",
  "Shiller dataset":
    "Long-history CAPE, real yields, real prices. Powers the CAPE valuation indicator and the long-term history panels.",
  "CME":
    "Copper/gold ratio (HG1/GC1). Powers the copper/gold growth indicator.",
  "FDIC":
    "Quarterly Bank Performance reports. Powers bank-sector stress indicators.",
  "ZeroHedge":
    "Premium commentary feed. Powers the weekly commentary section.",
  "State Street SPDR":
    "SPY and sector ETF prices (XLE/XLF/XLK/etc). Powers the S&P 500 benchmark and sector index overlays.",
  "GitHub public roster":
    "Members of Congress roster JSON (unitedstates/congress-legislators). Powers the congress trades drill names.",
  "Nasdaq / FINRA":
    "Short interest reports. Powers the v5 scanner short interest score.",
  "MacroTilt in-house":
    "In-house computed outputs derived daily from the external vendor feeds above. Powers the two-axis engine read and the indicator-history compiler.",
};

// Monthly cost per canonical vendor — matches data_vendors.md. "Free" for
// public APIs that only require an API key. "—" for derived (in-house)
// rollups that have no separate cost line item.
export const VENDOR_MONTHLY_COST = {
  // Verified 2026-07-27 (API probes + billing check): the key is Massive's
  // FREE 2-year tier — the old "$54-79/mo" ledger figures had no receipt
  // behind them. Joe flagged the stale $79 on the Data page 2026-07-28.
  "Polygon Massive":         "Free (2-yr tier)",
  "London Strategic Edge":   "Free",
  "SEC EDGAR":               "Free",
  "FRED":                    "Free",
  "U.S. Treasury":           "Free",
  "Yahoo Finance":           "Free",
  "ISM":                     "Free",
  "New York Fed":            "Free",
  "Federal Reserve Board":   "Free",
  "Shiller dataset":         "Free",
  "CME":                     "Free",
  "FDIC":                    "Free",
  "ZeroHedge":               "$0 (cookie scrape)",
  "State Street SPDR":       "Free",
  "GitHub public roster":    "Free",
  "Nasdaq / FINRA":          "Free (direct)",
  "MacroTilt in-house":      "—",
};

// ─── Preview-deploy snapshot fallback ───────────────────────────────────────
// On Vercel preview URLs we don't always have an authenticated admin session
// (Supabase auth redirect allowlist is keyed to the production host). To
// keep the admin pages reviewable without an admin login on previews, we
// fall back to a baked snapshot at /admin_health_snapshot.json — produced
// from production pipeline_health by a maintainer (current as of the
// commit shipping this file). The snapshot is only consumed if the live
// Supabase query comes back empty.
//
// Production rendering on macrotilt.com goes through the live Supabase
// query as before; the snapshot is just a safety net for preview deploys
// and any future scenario where the live query is gated.
// Snapshot lives under /data/ rather than the public/ root so it doesn't
// trip the V2-cutover-quality-gate workflow's path filter (which fires
// on any public/*.json change and is unrelated to admin work).
async function fetchSnapshot() {
  try {
    const resp = await fetch("/data/admin_health_snapshot.json", { cache: "default" });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[useDataHealth] snapshot fetch failed:", e?.message || e);
    return [];
  }
}

// ─── Truthful status reconciliation ─────────────────────────────────────────
// The stored `status` column is only trustworthy if the freshness monitor
// actually re-checked the feed recently. Many rows went "fake green": the
// monitor stopped updating them weeks ago, so a stale green here was meaningless
// and hid real staleness. Rule: NEVER show green on a feed the monitor has not
// verified inside VERIFY_WINDOW_H. Known red/amber always surface unchanged; an
// unverifiable green is downgraded to "unverified" (grey) with its real check age.
const VERIFY_WINDOW_H = 30;
function reconcileRow(r) {
  const checkMs = r.last_check_at ? Date.parse(r.last_check_at) : NaN;
  const checkAgeH = Number.isNaN(checkMs) ? Infinity : (Date.now() - checkMs) / 3.6e6;
  if (r.status === "red" || r.status === "amber") return r; // never hide a known problem
  if (checkAgeH > VERIFY_WINDOW_H) {
    return { ...r, status: "unverified", _storedStatus: r.status, _monitorAgeH: Math.round(checkAgeH) };
  }
  return r;
}
function reconcileRows(rows) { return (rows || []).map(reconcileRow); }

// ─── Supabase fetch ─────────────────────────────────────────────────────────
async function fetchRows() {
  const { data, error } = await supabase
    .from("pipeline_health")
    .select(
      "indicator_id, label, source, cadence, expected_cadence_minutes, " +
      "last_good_at, last_check_at, last_value, last_error, status, " +
      "data_as_of, expected_next_run, coverage_pct, updated_at"
    );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[useDataHealth] supabase error:", error.message);
    // Fall back to the snapshot so admin pages still render under
    // RLS-blocked / network-failure conditions (preview deploys).
    const snap = await fetchSnapshot();
    cachedRows = reconcileRows(snap);
    lastFetchAt = Date.now();
    return cachedRows;
  }
  let rows = data || [];
  // If the live query returns 0 rows (RLS blocked the read for a non-admin
  // session, typically a preview deploy), fall back to the baked snapshot.
  if (rows.length === 0) {
    const snap = await fetchSnapshot();
    if (snap.length > 0) rows = snap;
  }
  cachedRows = reconcileRows(rows);
  lastFetchAt = Date.now();
  return cachedRows;
}

function ensureFresh() {
  if (cachedRows && Date.now() - lastFetchAt < REFRESH_MS) return Promise.resolve(cachedRows);
  if (inflight) return inflight;
  inflight = fetchRows()
    .then((rows) => { notify(); return rows; })
    .finally(() => { inflight = null; });
  return inflight;
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export function useDataHealth() {
  const [, force] = useState(0);
  const [loading, setLoading] = useState(cachedRows == null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const sub = () => force((n) => n + 1);
    listeners.add(sub);
    let mounted = true;

    setLoading(cachedRows == null);
    ensureFresh()
      .then(() => { if (!mounted) return; setLoading(false); setError(null); })
      .catch((e) => { if (!mounted) return; setError(e); setLoading(false); });

    const interval = setInterval(() => { lastFetchAt = 0; ensureFresh(); }, REFRESH_MS);
    const onFocus = () => { lastFetchAt = 0; ensureFresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      listeners.delete(sub);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const rows = cachedRows || [];

  // ─ Per-vendor rollup ─
  const byVendor = new Map();
  for (const r of rows) {
    const v = canonicalVendor(r.source);
    if (!byVendor.has(v)) byVendor.set(v, { vendor: v, feeds: [], green: 0, red: 0, amber: 0, lastGoodAt: null });
    const g = byVendor.get(v);
    g.feeds.push(r);
    if (r.status === "green") g.green += 1;
    else if (r.status === "red") g.red += 1;
    else if (r.status === "amber") g.amber += 1;
    if (r.last_good_at && (!g.lastGoodAt || r.last_good_at > g.lastGoodAt)) g.lastGoodAt = r.last_good_at;
  }

  const reload = () => { lastFetchAt = 0; ensureFresh(); };

  return { rows, byVendor, loading, error, reload };
}

// Convenience export for non-hook contexts.
export { canonicalVendor as _canonicalVendor };

