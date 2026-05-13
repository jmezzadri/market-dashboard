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
// 2. Canonical vendor names ("Polygon Massive", "Unusual Whales", "FRED"
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
  { test: (s) => /^Unusual Whales\b/i.test(s),      vendor: "Unusual Whales" },
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
  "Unusual Whales":
    "Options flow, insider buys, congress trades, analyst ratings, screener universe. Powers the v5 scanner, the Trading Opps composites, the Portfolio Insights option marks.",
  "FRED":
    "30+ macro series (rates, spreads, credit, claims, M2, balance sheet). Powers Macro Overview, the Cycle Mechanism Board, indicator drilldowns, scenario analysis.",
  "Yahoo Finance":
    "VIX, MOVE, SKEW, KBE/SPY ratio, LQD/HYG ratio, DX-Y dollar index. Powers macro indicators + portfolio price marks where Polygon coverage is incomplete.",
  "ISM":
    "Manufacturing + Services PMI. Monthly. Powers the cycle mechanism Growth pillar.",
  "New York Fed":
    "Corporate Market Distress Index (CMDI). Powers the Credit mechanism.",
  "Federal Reserve Board":
    "Kansas City Financial Stress Index. Powers the Liquidity & Policy mechanism.",
  "Shiller dataset":
    "Long-history CAPE, real yields, real prices. Powers the Valuation mechanism + the long-term back-test panels.",
  "CME":
    "Copper/gold ratio (HG1/GC1). Powers the Growth mechanism.",
  "FDIC":
    "Quarterly Bank Performance reports. Powers bank-sector stress indicators.",
  "ZeroHedge":
    "Premium commentary feed. Powers the weekly commentary section.",
  "State Street SPDR":
    "SPY sector weights (XLE/XLF/XLK/etc). Powers Asset Tilt benchmark + sector overlays.",
  "GitHub public roster":
    "Members of Congress roster JSON (unitedstates/congress-legislators). Powers the congress trades drill names.",
  "Nasdaq / FINRA":
    "Short interest reports. Powers the v5 scanner short interest score.",
  "MacroTilt in-house":
    "Composite scorers + back-test artefacts computed daily from the external vendor feeds above. Powers v5/v9/v10/v11 scoring, scenario stress runs, Cycle Board snapshots.",
};

// Monthly cost per canonical vendor — matches data_vendors.md. "Free" for
// public APIs that only require an API key. "—" for derived (in-house)
// rollups that have no separate cost line item.
export const VENDOR_MONTHLY_COST = {
  "Polygon Massive":         "$79",
  "Unusual Whales":          "$150",
  "FRED":                    "Free",
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
  "Nasdaq / FINRA":          "Free (via UW)",
  "MacroTilt in-house":      "—",
};

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
    return cachedRows || [];
  }
  cachedRows = data || [];
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
