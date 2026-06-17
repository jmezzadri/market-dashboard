/* DataFlowPage — end-to-end data lineage dashboard, MANIFEST-DERIVED.

   Rebuilt 2026-06-16. Everything on this page is computed at runtime from
   public/data_manifest.json (loaded once, guarded) — NOT hand-typed. There
   are no hardcoded tile lists, vendor tables, indicator counts, or prose
   drawers. The four-column data-flow concept is kept (Sources → Derived
   indicators → Engines & models → Surfaces & workflows) but each column is
   grouped out of the manifest:

     - Sources      = the distinct external `source_vendor`s in the manifest
                      (in-house / computed vendors are excluded — they live in
                      the Engines column). Cost is read from VENDOR_MONTHLY_COST
                      (canonical) with the manifest's monthly_cost_usd as a
                      fallback.
     - Derived      = every `category:"indicator"` element, grouped into the
                      five-domain families the rest of the site uses (Rates,
                      Credit, Equities, Commodities, FX, Financial Conditions &
                      Economy). The family for each indicator comes from the
                      shared indicator registry (IND[name][2] → FAMILY_LABEL);
                      a small fallback map covers the handful of computed v11
                      series that aren't in the registry.
     - Engines      = in-house computed outputs (scenario category, the cycle
                      board, the indicator-history compiler, the allocation
                      engine, pipeline_health) — vendor is "n/a" / "MacroTilt".
     - Surfaces &   = the distinct consumer-surface tabs the manifest declares,
       workflows      plus the ops / portfolio / news / commentary elements.

   THE KEY ASK — per-tile indicator-by-indicator detail. Selecting any tile
   opens a right-hand detail panel that lists EVERY underlying element with,
   per row: display name, source vendor, cadence + scheduled fetch time, the
   data as-of date, the last successful pull time, the freshness state (a real
   per-row <FreshnessChip>, which resolves status from the manifest +
   pipeline_health via useFreshness), and the SLA. This replaces the old
   bottom prose drawer.

   Theming uses --mt-* tokens only (no hardcoded hex), so the page picks up the
   light / dark / navy themes via data-mt-theme on <html>. Every value carries
   a freshness chip.
*/

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useDataHealth, VENDOR_MONTHLY_COST, VENDOR_BLAST_RADIUS } from '../../hooks/useDataHealth';
import { IND } from '../../data/indicatorRegistry';
import FreshnessChip from '../components/FreshnessChip';
import { useFreshness } from '../../hooks/useFreshness';

// ─── Five-domain family rollup (matches useIndicators.FAMILY_LABEL) ──────────
// The registry tags each indicator with a fine-grained family_id; the site
// rolls those up into the five user-facing domains. Kept here so the Derived
// column groups indicators exactly the way the Indicators / Macro pages do.
const FAMILY_LABEL = {
  equity: 'Equities',
  credit: 'Credit',
  rates: 'Rates',
  fincond: 'Financial Conditions & Economy',
  bank: 'Credit',
  labor: 'Financial Conditions & Economy',
  commodities: 'Commodities',
  fx: 'FX',
};

// Fixed display order for the Derived column so the layout is stable run to run.
const FAMILY_ORDER = ['Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Financial Conditions & Economy'];

// A handful of computed v11 / derived series are not in the indicator
// registry (they are engine-internal preferred variants). Map them to the
// right domain so they still appear under the correct family rather than an
// "Other" bucket. Keys are manifest element `name`s.
const FALLBACK_FAMILY = {
  erp: 'Equities',
  cftc_cot: 'Equities',
  'cftc-cot': 'Equities',
  fra_ois: 'Credit',
  sofr_ois: 'Credit',
  real_fedfunds: 'Credit',
  bkx_spx_v11: 'Credit',
  ic4wsa: 'Financial Conditions & Economy',
  ism_mfg: 'Financial Conditions & Economy',
  ism_svc: 'Financial Conditions & Economy',
};

// ─── Vendor canonicalisation ─────────────────────────────────────────────────
// Manifest source_vendor strings are free-text ("Polygon (Massive)",
// "Treasury.gov (computed)", "Unusual Whales + FINRA"). Reduce each to a
// canonical vendor name that matches the VENDOR_MONTHLY_COST / blast-radius
// tables in useDataHealth so cost + description aren't hand-typed here.
const VENDOR_CANON = {
  polygon: 'Polygon Massive',
  'unusual whales': 'Unusual Whales',
  fred: 'FRED',
  'treasury.gov': 'U.S. Treasury',
  'yahoo finance': 'Yahoo Finance',
  ism: 'ISM',
  shiller: 'Shiller dataset',
  cme: 'CME',
  fdic: 'FDIC',
  zerohedge: 'ZeroHedge',
  'state street': 'State Street SPDR',
  cftc: 'CFTC',
  numerco: 'Numerco',
  alpaca: 'Alpaca (paper)',
  anthropic: 'Anthropic (Claude)',
  'google news rss': 'Google News',
  tradingeconomics: 'TradingEconomics',
  nasdaq: 'Nasdaq / FINRA',
  finra: 'Nasdaq / FINRA',
  wikipedia: 'Wikipedia + iShares',
  invesco: 'Invesco QQQ holdings',
};

// Vendor strings that mean "computed in-house" — these are NOT external
// sources; their elements belong in the Engines column.
const INHOUSE_VENDOR = new Set([
  'n/a', 'self', 'macrotilt', 'macrotilt engine', 'macrotilt producers', 'tbd', '',
]);

function vendorBase(raw) {
  if (!raw) return '';
  // Take the text before the first '(', '+', or '/' and lowercase it, so
  // "Polygon (Massive)", "Unusual Whales + FINRA" and "Shiller / multpl.com"
  // all reduce to a single canonical key.
  return String(raw).split(/[(+/]/)[0].trim().toLowerCase();
}
function canonVendor(raw) {
  const base = vendorBase(raw);
  if (!base || INHOUSE_VENDOR.has(base)) return null; // in-house → not a source
  if (VENDOR_CANON[base]) return VENDOR_CANON[base];
  // Prefix match — "zerohedge premium" → "zerohedge", "shiller …" → "shiller".
  for (const key of Object.keys(VENDOR_CANON)) {
    if (base.startsWith(key)) return VENDOR_CANON[key];
  }
  // Title-case the cleaned base as a last resort.
  const clean = String(raw).split(/[(+/]/)[0].trim();
  return clean || null;
}
function isInhouseVendor(raw) {
  return INHOUSE_VENDOR.has(vendorBase(raw));
}

// Manifest element `name`s that are engine outputs regardless of category.
const ENGINE_NAMES = new Set([
  'cycle_board', 'indicator_history', 'v10_allocation', 'v10_sector_history',
  'scenarios', 'pipeline_health',
]);

// ─── Display-name helper ─────────────────────────────────────────────────────
// Never render code-y element ids/names to the user. Prefer the registry's
// human display name; fall back to a humanised version of the manifest name.
const REG_DISPLAY = {};
Object.entries(IND).forEach(([k, meta]) => { if (meta && meta[0]) REG_DISPLAY[k] = meta[0]; });
const REG_FAMILY = {};
Object.entries(IND).forEach(([k, meta]) => { if (meta && meta[2]) REG_FAMILY[k] = meta[2]; });

function humanise(name) {
  if (!name) return '';
  return String(name)
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function displayName(el) {
  if (!el) return '';
  const n = el.name;
  if (REG_DISPLAY[n]) return REG_DISPLAY[n];
  // Spell out the commonest non-registry families nicely.
  return humanise(n);
}

// Domain for an indicator element: registry family → 5-domain label, else
// the explicit fallback map, else a catch-all.
function domainForIndicator(name) {
  const fid = REG_FAMILY[name];
  if (fid && FAMILY_LABEL[fid]) return FAMILY_LABEL[fid];
  if (FALLBACK_FAMILY[name]) return FALLBACK_FAMILY[name];
  return 'Financial Conditions & Economy';
}

// ─── Plain-English helpers (manifest → label) ────────────────────────────────
function prettyCadence(cad) {
  if (!cad) return '—';
  const c = String(cad);
  // Keep parenthetical schedule notes short; surface the leading cadence word.
  const head = c.split('(')[0].trim();
  return head ? head.charAt(0).toUpperCase() + head.slice(1) : c;
}
function prettyFetchET(raw) {
  if (!raw) return null;
  const t = String(raw).split('(')[0].trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = Number(m[1]);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap} ET`;
}
function prettySla(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return '—';
  if (h < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
}
function tabLabel(tab) {
  const MAP = {
    home: 'Home',
    overview: 'Macro Overview',
    macro: 'Macro Overview',
    indicators: 'All Indicators',
    allocation: 'Asset Tilt',
    scanner: 'Trading Opps',
    portopps: 'Trading Opps',
    paper: 'Paper Portfolio',
    ticker: 'Ticker Detail',
    readme: 'Methodology',
    methodology: 'Methodology',
    admin: 'Admin · Data',
  };
  return MAP[tab] || humanise(tab);
}

// ─── Per-row freshness cells (driven by useFreshness on the element id) ──────
// One small hook-component per element row so each row resolves its own live
// status, as-of, and last-pull from the manifest + pipeline_health. The chip
// itself renders the dot + relative age + the five-field tooltip; the extra
// cells show the exact as-of and last-pull alongside it so the table reads
// indicator-by-indicator without needing to hover.
function fmtDate(iso) {
  if (!iso) return '—';
  const dateOnly = String(iso).length === 10;
  const dt = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  // Date-only stamps carry no real intraday time — show date only.
  if (String(iso).length === 10) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return dt.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function ElementRow({ el }) {
  // Resolve live freshness for this element. useFreshness accepts the manifest
  // id OR short name; we pass the id which is the canonical key.
  const f = useFreshness(el.id);
  const vendor = el.source_vendor && !isInhouseVendor(el.source_vendor)
    ? (canonVendor(el.source_vendor) || el.source_vendor)
    : 'MacroTilt (computed)';
  const cad = prettyCadence(el.cadence);
  const fetchAt = prettyFetchET(el.scheduled_fetch_time_et);
  const asOf = fmtDate(f?.dataAsOf || el.data_as_of);
  const lastPull = fmtDateTime(f?.lastRefreshedAt || f?.lastGoodAt);
  const sla = prettySla(el.freshness_sla_hours);

  return (
    <div className="df-row">
      <div className="df-row-main">
        <div className="df-row-name">{displayName(el)}</div>
        <div className="df-row-vendor">{vendor}</div>
      </div>
      <div className="df-row-cad">
        {cad}{fetchAt ? <span className="df-row-cad-t"> · {fetchAt}</span> : null}
      </div>
      <div className="df-row-asof"><span className="df-row-k">As of</span>{asOf}</div>
      <div className="df-row-pull"><span className="df-row-k">Last pull</span>{lastPull}</div>
      <div className="df-row-sla"><span className="df-row-k">SLA</span>{sla}</div>
      <div className="df-row-chip">
        <FreshnessChip elementId={el.id} variant="label" />
      </div>
    </div>
  );
}

// Column headers for the per-element table (rendered once above the rows).
function ElementTableHead() {
  return (
    <div className="df-row df-row--head" aria-hidden>
      <div className="df-row-main">Element · source</div>
      <div className="df-row-cad">Cadence · fetch</div>
      <div className="df-row-asof">As of</div>
      <div className="df-row-pull">Last pull</div>
      <div className="df-row-sla">SLA</div>
      <div className="df-row-chip">Freshness</div>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────
function Tile({ id, role, name, sub, count, selected, lit, dim, status, onClick }) {
  const cls = [
    'df-tile',
    `df-tile--${role}`,
    selected ? 'df-tile--selected' : '',
    lit ? 'df-tile--lit' : '',
    dim ? 'df-tile--dim' : '',
  ].filter(Boolean).join(' ');
  const dotCls = `df-dot df-dot--${status || 'u'}`;
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => { e.stopPropagation(); onClick(id); }}
      data-id={id}
    >
      <span className={dotCls} aria-hidden />
      <span className="df-tile-name">{name}</span>
      <span className="df-tile-cd">{sub}</span>
      {count != null && <span className="df-tile-count">{count}</span>}
    </button>
  );
}

// ─── Status rollup (own + worst upstream), driven by live freshness ──────────
function worse(a, b) {
  if (a === 'r' || b === 'r') return 'r';
  if (a === 'a' || b === 'a') return 'a';
  return 'g';
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DataFlowPage() {
  // ALL useState first — declared before any useMemo that references them, so
  // there is no temporal-dead-zone trap (the prior blank-page bug).
  const [manifest, setManifest] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const flowRef = useRef(null);
  const svgRef = useRef(null);

  // Live pipeline health for the tile dots (real per-row freshness lives in the
  // detail panel via FreshnessChip). 60s cache + focus refresh. `rows` is the
  // raw pipeline_health set, keyed in statusByElement by element name/id.
  const { rows: healthRows } = useDataHealth();

  // Load the manifest once. Same fetch pattern as useIndicators.
  useEffect(() => {
    let cancelled = false;
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setManifest(d); })
      .catch((e) => { if (!cancelled) setLoadErr(e?.message || 'manifest load failed'); });
    return () => { cancelled = true; };
  }, []);

  const elements = useMemo(() => {
    const els = manifest?.elements;
    return Array.isArray(els) ? els.filter((e) => e && typeof e === 'object' && e.name) : [];
  }, [manifest]);

  const elementById = useMemo(() => {
    const out = {};
    elements.forEach((e) => { out[e.id || e.name] = e; });
    return out;
  }, [elements]);

  // ── Classify every element into one of the four columns ──
  const classified = useMemo(() => {
    const out = {};
    elements.forEach((e) => {
      const cat = e.category;
      const base = vendorBase(e.source_vendor);
      if (cat === 'scenario' || ENGINE_NAMES.has(e.name)) {
        out[e.name] = 'engine';
      } else if (cat === 'indicator') {
        out[e.name] = 'derived';
      } else if (cat === 'ops' || cat === 'portfolio' || cat === 'news' || cat === 'commentary') {
        out[e.name] = 'workflow';
      } else if (!isInhouseVendor(e.source_vendor) && canonVendor(e.source_vendor)) {
        // equity / market elements with a real external vendor are source-fed,
        // but their *home* on this page is the surface/workflow they feed; we
        // still surface their vendor in the Sources column member list.
        out[e.name] = 'sourcefed';
      } else if (base) {
        out[e.name] = 'workflow';
      } else {
        out[e.name] = 'workflow';
      }
    });
    return out;
  }, [elements]);

  // ── Column 1: Source tiles, grouped by canonical vendor ──
  const sourceTiles = useMemo(() => {
    const byVendor = new Map();
    elements.forEach((e) => {
      const v = canonVendor(e.source_vendor);
      if (!v) return; // in-house elements are not sources
      if (!byVendor.has(v)) byVendor.set(v, []);
      byVendor.get(v).push(e);
    });
    const tiles = [];
    byVendor.forEach((els, vendor) => {
      // Cost: canonical table first, then the manifest's own per-element value.
      let cost = VENDOR_MONTHLY_COST[vendor] || null;
      if (!cost) {
        const withCost = els.find((e) => Number(e.monthly_cost_usd) > 0);
        cost = withCost ? `$${withCost.monthly_cost_usd}` : 'Free';
      }
      // Cadence summary = the most-common cadence head among this vendor's els.
      const cadCounts = {};
      els.forEach((e) => {
        const c = prettyCadence(e.cadence);
        cadCounts[c] = (cadCounts[c] || 0) + 1;
      });
      const topCad = Object.entries(cadCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
      tiles.push({
        id: `src:${vendor}`,
        vendor,
        name: vendor,
        sub: `${topCad} · ${cost}`,
        count: els.length,
        members: els,
      });
    });
    // Order: most elements first (FRED / Yahoo lead), stable.
    tiles.sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));
    return tiles;
  }, [elements]);

  // ── Column 2: Derived-indicator tiles, grouped by 5-domain family ──
  const derivedTiles = useMemo(() => {
    const byFam = new Map();
    elements.forEach((e) => {
      if (classified[e.name] !== 'derived') return;
      const dom = domainForIndicator(e.name);
      if (!byFam.has(dom)) byFam.set(dom, []);
      byFam.get(dom).push(e);
    });
    const tiles = [];
    FAMILY_ORDER.forEach((dom) => {
      if (!byFam.has(dom)) return;
      const els = byFam.get(dom);
      tiles.push({
        id: `dom:${dom}`,
        name: dom,
        sub: `${els.length} indicator${els.length === 1 ? '' : 's'}`,
        count: els.length,
        members: els,
      });
    });
    // Any family not in the fixed order (shouldn't happen) appended.
    byFam.forEach((els, dom) => {
      if (FAMILY_ORDER.includes(dom)) return;
      tiles.push({ id: `dom:${dom}`, name: dom, sub: `${els.length} indicators`, count: els.length, members: els });
    });
    return tiles;
  }, [elements, classified]);

  // ── Column 3: Engine / model tiles (one per engine output) ──
  const engineTiles = useMemo(() => {
    const els = elements.filter((e) => classified[e.name] === 'engine');
    // De-dupe by display name (the manifest has two v10_allocation rows).
    const seen = new Map();
    els.forEach((e) => {
      const key = displayName(e);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(e);
    });
    const tiles = [];
    seen.forEach((group, key) => {
      const primary = group[0];
      tiles.push({
        id: `eng:${primary.name}`,
        name: key,
        sub: prettyCadence(primary.cadence),
        members: group,
      });
    });
    tiles.sort((a, b) => a.name.localeCompare(b.name));
    return tiles;
  }, [elements, classified]);

  // ── Column 4: Surface tiles (one per consumer-surface tab) + workflow tiles ──
  const { surfaceTiles, workflowTiles } = useMemo(() => {
    // Surfaces: collect, per tab, every element that declares a consumer
    // surface on that tab. consumer_surfaces entries can be dicts or strings.
    const byTab = new Map();
    elements.forEach((e) => {
      const css = Array.isArray(e.consumer_surfaces) ? e.consumer_surfaces : [];
      const tabs = new Set();
      css.forEach((cs) => {
        if (cs && typeof cs === 'object' && cs.tab) tabs.add(cs.tab);
        // string-shaped entries carry no clean tab — skip for grouping.
      });
      tabs.forEach((tab) => {
        if (!byTab.has(tab)) byTab.set(tab, []);
        byTab.get(tab).push(e);
      });
    });
    // Merge the two Macro-Overview tab aliases (overview + macro) into one.
    if (byTab.has('macro')) {
      const merged = byTab.get('overview') || [];
      byTab.get('macro').forEach((e) => { if (!merged.includes(e)) merged.push(e); });
      byTab.set('overview', merged);
      byTab.delete('macro');
    }
    if (byTab.has('portopps')) {
      const merged = byTab.get('scanner') || [];
      byTab.get('portopps').forEach((e) => { if (!merged.includes(e)) merged.push(e); });
      byTab.set('scanner', merged);
      byTab.delete('portopps');
    }
    const SURFACE_ORDER = ['home', 'overview', 'allocation', 'scanner', 'paper', 'indicators', 'readme', 'ticker', 'admin'];
    const sTiles = [];
    const pushTab = (tab) => {
      if (!byTab.has(tab)) return;
      const els = byTab.get(tab);
      sTiles.push({
        id: `surf:${tab}`,
        name: tabLabel(tab),
        sub: `${els.length} feed${els.length === 1 ? '' : 's'}`,
        count: els.length,
        members: els,
      });
    };
    SURFACE_ORDER.forEach(pushTab);
    byTab.forEach((_els, tab) => { if (!SURFACE_ORDER.includes(tab)) pushTab(tab); });

    // Workflows: ops / portfolio / news / commentary elements grouped by category.
    const CAT_LABEL = {
      ops: 'Operations & scanner jobs',
      portfolio: 'Portfolio & accounts',
      news: 'News & commentary feeds',
      commentary: 'Editorial commentary',
    };
    const byCat = new Map();
    elements.forEach((e) => {
      if (classified[e.name] !== 'workflow') return;
      const cat = e.category || 'other';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(e);
    });
    const wTiles = [];
    ['ops', 'portfolio', 'news', 'commentary'].forEach((cat) => {
      if (!byCat.has(cat)) return;
      const els = byCat.get(cat);
      wTiles.push({
        id: `wf:${cat}`,
        name: CAT_LABEL[cat] || humanise(cat),
        sub: `${els.length} job${els.length === 1 ? '' : 's'}`,
        count: els.length,
        members: els,
      });
    });
    // Anything else classified workflow (rare) into a catch-all tile.
    byCat.forEach((els, cat) => {
      if (['ops', 'portfolio', 'news', 'commentary'].includes(cat)) return;
      wTiles.push({ id: `wf:${cat}`, name: CAT_LABEL[cat] || humanise(cat), sub: `${els.length} jobs`, count: els.length, members: els });
    });
    return { surfaceTiles: sTiles, workflowTiles: wTiles };
  }, [elements, classified]);

  // ── Index every tile by id, and build the lineage edge list at runtime ──
  const allTiles = useMemo(
    () => [...sourceTiles, ...derivedTiles, ...engineTiles, ...surfaceTiles, ...workflowTiles],
    [sourceTiles, derivedTiles, engineTiles, surfaceTiles, workflowTiles],
  );
  const tileById = useMemo(() => {
    const out = {};
    allTiles.forEach((t) => { out[t.id] = t; });
    return out;
  }, [allTiles]);

  // Edges (derived, not hardcoded):
  //   vendor → family    : a source feeds every family it has an indicator in
  //   vendor → engine     : a source feeds an engine it is a member of (rare)
  //   family → engines    : every family rolls into the cycle board + compiler
  //   engines → surfaces  : the indicator compiler / cycle board feed the
  //                         macro/indicator/allocation surfaces
  //   member → surface    : every element feeds the surface tabs it declares
  const edges = useMemo(() => {
    const E = [];
    const famTileFor = {};
    derivedTiles.forEach((t) => { famTileFor[t.name] = t.id; });
    const engById = {};
    engineTiles.forEach((t) => { t.members.forEach((m) => { engById[m.name] = t.id; }); });
    const surfTileForTab = {};
    surfaceTiles.forEach((t) => { surfTileForTab[t.id.replace('surf:', '')] = t.id; });

    // vendor → family / engine / surface (via each member element)
    sourceTiles.forEach((src) => {
      const fams = new Set();
      const engs = new Set();
      const surfs = new Set();
      src.members.forEach((m) => {
        if (classified[m.name] === 'derived') {
          const dom = domainForIndicator(m.name);
          if (famTileFor[dom]) fams.add(famTileFor[dom]);
        }
        if (classified[m.name] === 'engine' && engById[m.name]) engs.add(engById[m.name]);
        const css = Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : [];
        css.forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = cs.tab === 'macro' ? 'overview' : cs.tab === 'portopps' ? 'scanner' : cs.tab;
            if (surfTileForTab[tab]) surfs.add(surfTileForTab[tab]);
          }
        });
      });
      fams.forEach((f) => E.push([src.id, f]));
      engs.forEach((g) => E.push([src.id, g]));
      // sources that feed a surface directly (equity/market feeds) — only when
      // they don't already route through a family (keeps the graph readable).
      if (fams.size === 0) surfs.forEach((s) => E.push([src.id, s]));
    });

    // family → cycle board + indicator compiler
    const cycleId = engineTiles.find((t) => /cycle/i.test(t.name))?.id;
    const compilerId = engineTiles.find((t) => /history|compiler|indicator history/i.test(t.name))?.id;
    derivedTiles.forEach((t) => {
      if (cycleId) E.push([t.id, cycleId]);
      if (compilerId) E.push([t.id, compilerId]);
    });

    // engines → surfaces (via the surfaces each engine's members declare)
    engineTiles.forEach((eng) => {
      const surfs = new Set();
      eng.members.forEach((m) => {
        const css = Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : [];
        css.forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = cs.tab === 'macro' ? 'overview' : cs.tab === 'portopps' ? 'scanner' : cs.tab;
            if (surfTileForTab[tab]) surfs.add(surfTileForTab[tab]);
          }
        });
      });
      surfs.forEach((s) => E.push([eng.id, s]));
    });

    // de-dupe
    const seen = new Set();
    return E.filter(([a, b]) => {
      const k = `${a}>${b}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [sourceTiles, derivedTiles, engineTiles, surfaceTiles, classified]);

  const bfs = useCallback((start, dir) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const [a, b] of edges) {
        let next = null;
        if (dir === 'down' && a === n) next = b;
        if (dir === 'up' && b === n) next = a;
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    seen.delete(start);
    return Array.from(seen);
  }, [edges]);

  // ── Live freshness for the tile dots. Each tile's OWN dot is the worst
  //    status across its member elements, looked up in pipeline_health by the
  //    same keys the chips grade on (short name, then full id). A member with
  //    no tracking row contributes "unknown" — NEVER silently green
  //    (fake-green is forbidden). We then propagate the worst status upstream
  //    so a red source paints every tile downstream of it. Per-row truth still
  //    lives in the detail panel via <FreshnessChip>; the dot is a summary. ──
  const statusByElement = useMemo(() => {
    // pipeline_health.status → dot letter. "unverified" (a green the monitor
    // could not re-confirm) and missing rows are neutral grey, not green.
    const byKey = new Map();
    (healthRows || []).forEach((r) => {
      if (r && r.indicator_id) byKey.set(r.indicator_id, r.status);
    });
    const lookup = (el) => {
      const cand = [el.name, el.id].filter(Boolean);
      for (const c of cand) if (byKey.has(c)) return byKey.get(c);
      return null;
    };
    const out = {};
    elements.forEach((el) => {
      const s = lookup(el);
      out[el.name] = s === 'red' ? 'r' : s === 'amber' ? 'a' : s === 'green' ? 'g' : 'u';
    });
    return out;
  }, [healthRows, elements]);

  const statusByTile = useMemo(() => {
    // worst-of-members, where 'u' (untracked) is neutral and does not turn a
    // tile green on its own; a tile with only untracked members stays neutral.
    const rank = { r: 3, a: 2, g: 1, u: 0 };
    const rollMembers = (members) => {
      let best = 'u';
      let sawTracked = false;
      (members || []).forEach((m) => {
        const s = statusByElement[m.name] || 'u';
        if (s !== 'u') sawTracked = true;
        if (rank[s] > rank[best]) best = s;
      });
      // If a tile has any red/amber, that wins; else if any tracked-green, green;
      // else neutral. (best already encodes this via rank.)
      if (!sawTracked) return 'u';
      return best === 'u' ? 'u' : best;
    };

    const own = {};
    allTiles.forEach((t) => { own[t.id] = rollMembers(t.members); });

    // Propagate worst status upstream: a red/amber source colours everything
    // it feeds. 'u' never overrides a real status.
    const out = {};
    allTiles.forEach((t) => {
      let s = own[t.id];
      bfs(t.id, 'up').forEach((uid) => {
        const us = own[uid];
        if (us && us !== 'u') s = worse(s === 'u' ? 'g' : s, us);
      });
      out[t.id] = s;
    });
    return out;
  }, [allTiles, statusByElement, bfs]);

  // Lineage drawing on the SVG connector layer.
  const drawLineage = useCallback((id) => {
    const svg = svgRef.current;
    const flow = flowRef.current;
    if (!svg || !flow) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!id) return;
    const upstream = bfs(id, 'up');
    const downstream = bfs(id, 'down');
    const connected = new Set([id, ...upstream, ...downstream]);
    const fr = flow.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
    edges.forEach(([from, to]) => {
      if (!connected.has(from) || !connected.has(to)) return;
      const a = flow.querySelector(`[data-id="${CSS.escape(from)}"]`);
      const b = flow.querySelector(`[data-id="${CSS.escape(to)}"]`);
      if (!a || !b) return;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const x1 = ar.right - fr.left;
      const y1 = ar.top + ar.height / 2 - fr.top;
      const x2 = br.left - fr.left;
      const y2 = br.top + br.height / 2 - fr.top;
      const dx = (x2 - x1) / 2;
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
  }, [edges, bfs]);

  useEffect(() => {
    drawLineage(selectedId);
    const onResize = () => drawLineage(selectedId);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedId, drawLineage, allTiles]);

  // Default the selection to the first source tile once the manifest lands.
  useEffect(() => {
    if (!selectedId && sourceTiles.length) setSelectedId(sourceTiles[0].id);
  }, [sourceTiles, selectedId]);

  const handleTileClick = (id) => setSelectedId((prev) => (prev === id ? null : id));

  // lit / dim sets for the current selection
  const litSet = new Set();
  const dimSet = new Set();
  if (selectedId) {
    const connected = new Set([selectedId, ...bfs(selectedId, 'up'), ...bfs(selectedId, 'down')]);
    allTiles.forEach((t) => {
      if (t.id === selectedId) return;
      if (connected.has(t.id)) litSet.add(t.id); else dimSet.add(t.id);
    });
  }

  const renderTile = (t, role) => (
    <Tile
      key={t.id}
      id={t.id}
      role={role}
      name={t.name}
      sub={t.sub}
      count={t.count}
      selected={selectedId === t.id}
      lit={litSet.has(t.id)}
      dim={dimSet.has(t.id)}
      status={statusByTile[t.id]}
      onClick={handleTileClick}
    />
  );

  const selectedTile = selectedId ? tileById[selectedId] : null;
  const selectedRole = selectedId
    ? (selectedId.startsWith('src:') ? 'Source vendor'
      : selectedId.startsWith('dom:') ? 'Derived indicator family'
        : selectedId.startsWith('eng:') ? 'Engine / model'
          : selectedId.startsWith('surf:') ? 'Live surface'
            : 'Workflow')
    : null;

  // Member elements for the detail panel, sorted by display name.
  const detailMembers = useMemo(() => {
    if (!selectedTile) return [];
    return [...(selectedTile.members || [])].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [selectedTile]);

  // Vendor extras for the detail header (cost + blast radius), when a source.
  const vendorCost = selectedTile && selectedTile.vendor ? VENDOR_MONTHLY_COST[selectedTile.vendor] : null;
  const vendorBlast = selectedTile && selectedTile.vendor ? VENDOR_BLAST_RADIUS[selectedTile.vendor] : null;

  // Totals for the hero strip — computed, never literal.
  const totals = useMemo(() => ({
    elements: elements.length,
    vendors: sourceTiles.length,
    indicators: elements.filter((e) => classified[e.name] === 'derived').length,
    engines: engineTiles.length,
    surfaces: surfaceTiles.length,
  }), [elements, sourceTiles, engineTiles, surfaceTiles, classified]);

  return (
    <div className="mt-pagebody mt-fade df-page">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Data</div>
          <h1 className="mt-h1">
            End-to-end <i>data flow</i>.
          </h1>
          <p className="mt-deck">
            Every source, every derived indicator, every engine, every surface — read straight from the
            data manifest. Click any tile to see, indicator-by-indicator, exactly what is in it and how
            fresh each feed is.
          </p>
        </div>
      </section>

      {loadErr && (
        <div className="df-banner df-banner--err">Could not load the data manifest: {loadErr}</div>
      )}
      {!manifest && !loadErr && (
        <div className="df-banner">Loading the data manifest…</div>
      )}

      {manifest && (
        <>
          <div className="df-totals" role="note" aria-label="Manifest totals">
            <span><b>{totals.elements}</b> tracked elements</span>
            <span><b>{totals.vendors}</b> external sources</span>
            <span><b>{totals.indicators}</b> derived indicators</span>
            <span><b>{totals.engines}</b> engines &amp; models</span>
            <span><b>{totals.surfaces}</b> live surfaces</span>
          </div>

          <div className="df-legend-top" role="note" aria-label="Legend">
            <span className="df-legend-grp-h">Freshness on every row</span>
            <span><span className="df-dot df-dot--inline df-dot--g" />Within target</span>
            <span><span className="df-dot df-dot--inline df-dot--a" />Lagging</span>
            <span><span className="df-dot df-dot--inline df-dot--r" />Stale or failed</span>
            <span className="df-legend-hint">Click a tile to list its feeds · click again to clear</span>
          </div>

          <div className="df-layout">
            {/* LEFT: the four-column flow */}
            <div className="df-flow" ref={flowRef} onClick={() => setSelectedId(null)}>
              <svg className="df-svg" ref={svgRef} />
              <div className="df-cols" onClick={(e) => e.stopPropagation()}>

                <div className="df-col">
                  <div className="df-col-h">External sources</div>
                  <div className="df-stack">{sourceTiles.map((t) => renderTile(t, 'source'))}</div>
                </div>

                <div className="df-col">
                  <div className="df-col-h">Derived indicators</div>
                  <div className="df-stack">{derivedTiles.map((t) => renderTile(t, 'derived'))}</div>
                </div>

                <div className="df-col">
                  <div className="df-col-h">Engines &amp; models</div>
                  <div className="df-stack">{engineTiles.map((t) => renderTile(t, 'engine'))}</div>
                </div>

                <div className="df-col">
                  <div className="df-col-h">Surfaces &amp; workflows</div>
                  <div className="df-sub-h">Live surfaces</div>
                  <div className="df-stack">{surfaceTiles.map((t) => renderTile(t, 'surface'))}</div>
                  {workflowTiles.length > 0 && <div className="df-sub-h">Workflows</div>}
                  <div className="df-stack">{workflowTiles.map((t) => renderTile(t, 'workflow'))}</div>
                </div>

              </div>
            </div>

            {/* RIGHT: per-tile, indicator-by-indicator detail */}
            <aside className="df-detail" onClick={(e) => e.stopPropagation()}>
              {!selectedTile && (
                <div className="df-detail-empty">Select a tile to list every feed inside it.</div>
              )}
              {selectedTile && (
                <>
                  <div className="df-detail-head">
                    <div className="df-detail-role">{selectedRole}</div>
                    <h3 className="df-detail-title">{selectedTile.name}</h3>
                    <div className="df-detail-sub">
                      {detailMembers.length} feed{detailMembers.length === 1 ? '' : 's'}
                      {vendorCost ? <span className="df-detail-cost"> · {vendorCost}/mo</span> : null}
                    </div>
                    {vendorBlast && <p className="df-detail-blast">{vendorBlast}</p>}
                  </div>

                  <div className="df-table">
                    <ElementTableHead />
                    {detailMembers.map((el) => (
                      <ElementRow key={el.id || el.name} el={el} />
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}

      <style>{`
        .df-page { padding-bottom: 40px; }

        .df-banner { margin: 12px 0; padding: 12px 16px; background: var(--mt-surface-2);
          border: 1px solid var(--mt-line-0); border-radius: var(--mt-r-sm); color: var(--mt-ink-2); font-size: 13px; }
        .df-banner--err { color: var(--mt-down); border-color: var(--mt-down); }

        .df-totals { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0 0 14px; padding: 11px 16px;
          background: var(--mt-surface); border: 1px solid var(--mt-line-0); border-radius: var(--mt-r-sm);
          font-size: 12.5px; color: var(--mt-ink-2); }
        .df-totals b { color: var(--mt-ink-0); font-weight: 700; }

        .df-legend-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px;
          margin: 0 0 16px; padding: 9px 14px; background: var(--mt-surface-2);
          border: 1px solid var(--mt-line-0); border-radius: var(--mt-r-sm); font-size: 11.5px; color: var(--mt-ink-1); }
        .df-legend-top > span { display: inline-flex; align-items: center; }
        .df-legend-grp-h { font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; }
        .df-legend-hint { color: var(--mt-ink-3); font-style: italic; font-size: 10.5px; margin-left: auto; }

        /* Two-pane layout: flow on the left, detail panel on the right. */
        .df-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr); gap: 18px; align-items: start; }

        .df-flow { position: relative; padding: 4px 0; }
        .df-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; color: var(--mt-accent); }
        .df-svg path { fill: none; stroke: currentColor; stroke-width: 1.3; opacity: 0.5; }
        .df-cols { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; position: relative; z-index: 2; }
        .df-col { min-width: 0; }
        .df-col-h { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--mt-line-0); }
        .df-sub-h { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; margin: 12px 0 6px 2px; }
        .df-stack { display: flex; flex-direction: column; gap: 6px; }

        .df-tile { all: unset; box-sizing: border-box; cursor: pointer; display: block; position: relative;
          background: var(--mt-surface); border: 1px solid var(--mt-line-0); border-left: 3px solid var(--mt-accent);
          border-radius: var(--mt-r-sm); padding: 7px 30px 7px 11px; min-height: 40px;
          transition: opacity 0.18s var(--mt-ease), background 0.15s var(--mt-ease), border-color 0.15s var(--mt-ease), transform 0.12s var(--mt-ease); }
        .df-tile:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
        .df-tile:hover { background: var(--mt-accent-soft); transform: translateY(-1px); }
        .df-tile--derived { border-left-color: var(--mt-ink-3); }
        .df-tile--engine { border-left-color: var(--mt-accent); background: var(--mt-surface-2); }
        .df-tile--surface { border-left-color: var(--mt-up); background: var(--mt-surface-2); }
        .df-tile--workflow { border-left-color: var(--mt-warn); background: var(--mt-surface-2); }
        .df-tile--selected { background: var(--mt-accent-soft); box-shadow: 0 0 0 2px var(--mt-accent); }
        .df-tile--lit { border-color: var(--mt-accent); background: var(--mt-accent-soft); }
        .df-tile--dim { opacity: 0.22; }

        .df-tile-name { display: block; font-size: 12px; font-weight: 600; color: var(--mt-ink-0); line-height: 1.25; }
        .df-tile-cd { display: block; font-size: 10px; color: var(--mt-ink-2); margin-top: 2px; line-height: 1.25; }
        .df-tile-count { position: absolute; top: 7px; right: 9px; font-size: 10px; font-weight: 700; color: var(--mt-ink-1);
          background: var(--mt-surface); border: 1px solid var(--mt-line-0); border-radius: 9px; padding: 0 6px; min-width: 14px; text-align: center; line-height: 16px; }
        .df-dot { position: absolute; bottom: 9px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--mt-up); }
        .df-dot--g { background: var(--mt-up); }
        .df-dot--a { background: var(--mt-warn); }
        .df-dot--r { background: var(--mt-down); }
        .df-dot--u { background: var(--mt-ink-3); opacity: 0.55; }
        .df-dot--inline { position: static; display: inline-block; vertical-align: 1px; margin-right: 6px; }

        /* ── Detail panel ── */
        .df-detail { position: sticky; top: 12px; background: var(--mt-surface); border: 1px solid var(--mt-line-0);
          border-radius: var(--mt-r-md); padding: 16px 18px; max-height: calc(100vh - 40px); overflow: auto; }
        .df-detail-empty { color: var(--mt-ink-3); font-size: 12.5px; font-style: italic; padding: 8px 0; }
        .df-detail-head { padding-bottom: 12px; margin-bottom: 10px; border-bottom: 1px solid var(--mt-line-0); }
        .df-detail-role { font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; }
        .df-detail-title { font-size: 16px; font-weight: 700; margin: 3px 0 4px; color: var(--mt-ink-0); }
        .df-detail-sub { font-size: 12px; color: var(--mt-ink-2); }
        .df-detail-cost { color: var(--mt-ink-1); font-weight: 600; }
        .df-detail-blast { font-size: 11.5px; color: var(--mt-ink-2); line-height: 1.5; margin: 8px 0 0; }

        /* ── Per-element table (indicator-by-indicator) ── */
        .df-table { display: flex; flex-direction: column; }
        .df-row { display: grid; grid-template-columns: minmax(0, 1.5fr) 1fr 0.8fr 0.95fr 0.5fr auto;
          gap: 8px; align-items: center; padding: 9px 4px; border-bottom: 1px solid var(--mt-line-0); font-size: 11.5px; }
        .df-row:last-child { border-bottom: none; }
        .df-row--head { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mt-ink-3);
          font-weight: 600; padding: 6px 4px; border-bottom: 1px solid var(--mt-line-1); }
        .df-row--head .df-row-k { display: none; }
        .df-row-main { min-width: 0; }
        .df-row-name { font-weight: 600; color: var(--mt-ink-0); font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .df-row-vendor { color: var(--mt-ink-2); font-size: 10.5px; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .df-row-cad { color: var(--mt-ink-1); }
        .df-row-cad-t { color: var(--mt-ink-3); }
        .df-row-asof, .df-row-pull, .df-row-sla { color: var(--mt-ink-1); }
        .df-row-k { display: none; }
        .df-row-chip { justify-self: end; }

        @media (max-width: 1180px) {
          .df-layout { grid-template-columns: 1fr; }
          .df-detail { position: static; max-height: none; }
          .df-svg { display: none; }
          .df-cols { grid-template-columns: 1fr 1fr; }
        }
        /* On narrow detail panels, stack the row into a card with labels. */
        @media (max-width: 1180px) {
          .df-row { grid-template-columns: 1fr auto; grid-template-areas:
            "main chip" "cad cad" "asof pull" "sla sla"; row-gap: 4px; }
          .df-row--head { display: none; }
          .df-row-main { grid-area: main; }
          .df-row-chip { grid-area: chip; }
          .df-row-cad { grid-area: cad; }
          .df-row-asof { grid-area: asof; }
          .df-row-pull { grid-area: pull; }
          .df-row-sla { grid-area: sla; }
          .df-row-k { display: inline; color: var(--mt-ink-3); margin-right: 5px; font-size: 10px; }
        }
      `}</style>
    </div>
  );
}
