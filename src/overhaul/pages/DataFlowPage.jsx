/* DataFlowPage — end-to-end data lineage dashboard, MANIFEST-DERIVED.

   Rebuilt 2026-06-16. Everything on this page is computed at runtime from
   public/data_manifest.json (loaded once, guarded) — NOT hand-typed. There
   are no hardcoded tile lists, vendor tables, indicator counts, or prose
   drawers. The four-column data-flow concept is kept (Sources → Indicators
   → Engines & models → Surfaces & workflows) but each column is grouped out
   of the manifest:

     - Sources      = the distinct external `source_vendor`s in the manifest
                      (in-house / computed vendors are excluded — they live in
                      the Engines column). Cost is read from VENDOR_MONTHLY_COST
                      (canonical) with the manifest's monthly_cost_usd as a
                      fallback.
     - Indicators   = every `category:"indicator"` element, grouped into the
                      five-domain families the rest of the site uses (Rates,
                      Credit, Equities, Commodities, FX, Financial Conditions &
                      Economy). NOTE: these are the indicators we TRACK — ~60%
                      are straight vendor pulls, not series we derive — so the
                      column is called "Indicators", not "Derived indicators".
                      The family for each indicator comes from the shared
                      indicator registry (IND[name][2] → FAMILY_LABEL); a small
                      fallback map covers the handful of computed v11 series
                      that aren't in the registry.
     - Engines      = in-house computed outputs (the indicator-history
                      compiler) — vendor is "n/a"/"MacroTilt".
                      Internal infrastructure (category:"ops" — bug tracker,
                      admin tables, api usage log, pipeline_health — plus the
                      static methodology changelog) is plumbing, NOT a data
                      feed, and is EXCLUDED from the flow entirely.
     - Surfaces &   = the distinct consumer-surface tabs the manifest declares,
       workflows      plus the portfolio / news / commentary elements. Feeds
                      that update on-change / on-demand / are static (portfolio
                      accounts, options chain, per-ticker news) show their
                      nature rather than a daily-SLA freshness chip.

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

   Cream rebrand Phase B (2026-07-07): the page mounts on the home-v12 CREAM
   system (root `home-v12 data-v12`; all page styles + responsive rules live in
   data-v12.css, which also bridges the --mt-* tokens the shared FreshnessChip /
   Tip read to the v12 palette). RESKIN ONLY — zero freshness-logic, grading,
   data or copy changes.
*/

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useDataHealth, VENDOR_MONTHLY_COST, VENDOR_BLAST_RADIUS } from '../../hooks/useDataHealth';
import { IND } from '../../data/indicatorRegistry';
import FreshnessChip from '../components/FreshnessChip';
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';
import '../styles/data-v12.css';
import Tip from '../components/Tip';
import { useFreshness } from '../../hooks/useFreshness';
import { gradeTwoClock } from '../../lib/freshnessClock';

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
  // cftc-cot is NOT folded into the Equities family — it gets its own
  // "CFTC COT positioning" tile that lists all 28 per-market signals (see
  // COT_ELEMENT_NAMES / buildCotMembers). Leaving it here made it a single
  // lone "Cftc Cot" row in Equities, hiding the 28 signals behind it.
  fra_ois: 'Credit',
  sofr_ois: 'Credit',
  real_fedfunds: 'Credit',
  bkx_spx_v11: 'Credit',
  credit_positioning: 'Credit',
  ic4wsa: 'Financial Conditions & Economy',
  ism_mfg: 'Financial Conditions & Economy',
  ism_svc: 'Financial Conditions & Economy',
};

// ─── CFTC COT positioning — the 28 per-market signals ────────────────────────
// The manifest declares ONE cftc-cot element, but the weekly producer writes 28
// per-market positioning signals into public/cot_positioning.json. We pull the
// cftc-cot element OUT of the generic indicator families and give it a dedicated
// tile whose members are those 28 markets, read live from that file. All 28 are
// produced by the one weekly CFTC job, so each row grades off the single real
// cftc-cot pipeline_health stamp (no per-market tracking rows exist; we never
// fabricate one). The element is matched by either manifest name.
const COT_ELEMENT_NAMES = new Set(['cftc-cot', 'cftc_cot']);
const COT_TILE_ID = 'cot:positioning';
const COT_HEALTH_ID = 'cftc-cot'; // the real pipeline_health row all 28 share

function isCotElement(el) {
  return !!el && (COT_ELEMENT_NAMES.has(el.name) || el.id === 'indicator-cftc-cot-weekly');
}

// Build the 28 COT member rows from cot_positioning.json. Each becomes an
// element-shaped object the detail table can render, carrying the market's real
// speculator/commercial percentile + its own as-of date. `_cot` marks it so the
// row renderer shows the positioning figures and grades freshness off the shared
// cftc-cot stamp rather than looking up a (non-existent) per-market health row.
function buildCotMembers(cotData) {
  const domains = cotData && typeof cotData === 'object' ? cotData.domains : null;
  if (!domains || typeof domains !== 'object') return [];
  const out = [];
  Object.entries(domains).forEach(([domain, obj]) => {
    // The Credit domain (IG/HY bond positioning) is NY-Fed dealer-inventory data,
    // NOT CFTC COT — it is tracked separately as the `credit_positioning` element.
    // Exclude it here so the COT tile counts only the CFTC futures markets;
    // the Credit domain is surfaced as its own Credit positioning tile.
    if (domain === 'Credit') return;
    const markets = obj && Array.isArray(obj.markets) ? obj.markets : [];
    markets.forEach((m) => {
      if (!m || !m.market) return;
      out.push({
        id: `cot:${domain}:${m.market}`,
        name: m.market,
        _cot: true,
        cotDomain: domain,
        cotSpec: typeof m.spec === 'number' ? m.spec : null,
        cotComm: typeof m.comm === 'number' ? m.comm : null,
        cotDiv: !!m.div,
        source_vendor: 'CFTC',
        cadence: 'weekly',
        scheduled_fetch_time_et: '07:00 (Sat)',
        data_as_of: m.asof || cotData.as_of || null,
        freshness_sla_hours: 192,
      });
    });
  });
  return out;
}

// ─── Credit positioning — NY-Fed primary-dealer IG/HY inventory (2 signals) ──
// Separate source from CFTC COT: the weekly producer writes primary-dealer net
// inventory positioning for investment-grade and high-yield corporate bonds into
// cot_positioning.json domains.Credit. Surfaced as its own tile (Joe 2026-06-22)
// next to the COT tile. Both signals share the one credit_positioning stamp.
const CREDIT_ELEMENT_NAMES = new Set(['credit_positioning']);
const CREDIT_TILE_ID = 'credit:positioning';
const CREDIT_HEALTH_ID = 'credit_positioning';
function isCreditPosElement(el) {
  return !!el && (CREDIT_ELEMENT_NAMES.has(el.name) || el.id === 'indicator-credit_positioning-weekly');
}
function buildCreditMembers(cotData) {
  const domains = cotData && typeof cotData === 'object' ? cotData.domains : null;
  const obj = domains && domains.Credit ? domains.Credit : null;
  const markets = obj && Array.isArray(obj.markets) ? obj.markets : [];
  return markets.filter((m) => m && m.market).map((m) => ({
    id: `credit:${m.market}`,
    name: m.market,
    _cot: true,
    healthId: CREDIT_HEALTH_ID,
    cotDomain: 'Credit',
    cotVendor: 'NY Fed',
    cotPctLabel: 'Dealer',
    cotSpec: typeof m.spec === 'number' ? m.spec : null,
    cotComm: typeof m.comm === 'number' ? m.comm : null,
    cotDiv: !!m.div,
    source_vendor: 'NY Fed primary-dealer statistics',
    cadence: 'weekly',
    scheduled_fetch_time_et: '07:00 (Sat)',
    data_as_of: m.asof || cotData.as_of || null,
    freshness_sla_hours: 192,
  }));
}

// ─── Vendor canonicalisation ─────────────────────────────────────────────────
// Manifest source_vendor strings are free-text ("Polygon (Massive)",
// "Treasury.gov (computed)", "SEC EDGAR"). Reduce each to a
// canonical vendor name that matches the VENDOR_MONTHLY_COST / blast-radius
// tables in useDataHealth so cost + description aren't hand-typed here.
const VENDOR_CANON = {
  polygon: 'Polygon Massive',
  'sec edgar': 'SEC EDGAR',
  fred: 'FRED',
  'treasury.gov': 'U.S. Treasury',
  'yahoo finance': 'Yahoo Finance',
  yahoo: 'Yahoo Finance',
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
  'n/a', 'n', 'self', 'macrotilt', 'macrotilt engine', 'macrotilt producers', 'tbd', '',
]);

function vendorBase(raw) {
  if (!raw) return '';
  // Take the text before the first '(', '+', or '/' and lowercase it, so
  // "Polygon (Massive)", "FINRA" and "Shiller / multpl.com"
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
  const r = String(raw || '').trim().toLowerCase();
  if (r === '' || r.startsWith('n/a')) return true; // "n/a (user-generated)" etc. — in-house, never an external source
  return INHOUSE_VENDOR.has(vendorBase(raw));
}
// Some computed feeds list MULTIPLE upstream vendors in one string
// ("Yahoo + ZeroHedge RSS + Wikipedia + iShares"). canonVendor
// returns only the first; this returns EVERY canonical vendor named in the
// string so an engine node can trace back to all the sources it is built from.
function allCanonVendors(raw) {
  if (!raw) return [];
  const out = [];
  String(raw).split('+').forEach((tok) => {
    const v = canonVendor(tok);
    if (v && !out.includes(v)) out.push(v);
  });
  return out;
}

// Manifest element `name`s that are engine outputs regardless of category.
const ENGINE_NAMES = new Set([
  'indicator_history',
]);

// The Trading scanner engine — the in-house computed scan outputs that blend the
// vendor feeds into the daily MT Score + the filtered universe they score. These
// are grouped into ONE engine tile (like the indicator-history compiler) so the
// scanner subsystem reads as sources → engine → surface, instead of feeds
// jumping straight to the Trading Scanner surface with no lines into it.
// (Joe 2026-06-23.)
const SCANNER_ENGINE_NAMES = new Set(['latest_scan', 'scanner-v5-daily', 'wide_universe']);
const SCANNER_ENGINE_ID = 'eng:trading-scanner';
const SCANNER_SURFACE_TABS = new Set(['scanner']); // canonTab('portopps') === 'scanner'

// Consumer-surface tab aliases → one canonical tab, so a single surface tile
// represents each real page. The manifest uses several names for the same
// page: macro/overview = Macro Overview; portopps/scanner = Trading Scanner;
// readme/methodology = Methodology. Without this the page drew two tiles
// both labelled "Methodology".
const SURFACE_ALIAS = {
  macro: 'overview',
  portopps: 'scanner',
  methodology: 'readme',
};
function canonTab(tab) {
  return SURFACE_ALIAS[tab] || tab;
}

// ─── Internal infrastructure to EXCLUDE from the data-flow entirely ──────────
// These are plumbing, not data feeds: the bug tracker, admin/auth tables, the
// api-usage log, and the freshness monitor's own pipeline_health
// table. They have no scheduled-data SLA, so showing
// them with a "no successful run on record" / stale chip was alarming and
// wrong. Anything with category:"ops" is infrastructure (bug_reports, bug_status_log, bug_screenshots,
// admin_users, user_preferences, api_usage_log, pipeline_health are all `ops`.)
function isInfrastructure(el) {
  if (!el) return true;
  if (el.category === 'ops') return true;
  return false;
}

// ─── Cadence nature (manifest cadence string → how a feed updates) ───────────
// Manifest cadences are free-text ("daily (08:15 ET business days)",
// "event-driven", "on-demand (per modal open)", "static", "during scan").
// Classify each into either a SCHEDULED feed (has a real daily/weekly/…/SLA and
// should grade green/amber/red) or one of the non-scheduled natures, which have
// NO daily SLA — a red/stale chip is wrong for them, so we show their nature
// instead. Returns { scheduled:bool, label:string|null }.
function cadenceNature(cadence) {
  const c = String(cadence || '').toLowerCase().trim();
  if (!c) return { scheduled: false, label: 'On demand' };
  // The LEADING cadence token wins. A feed described as "daily (with scan) +
  // on-demand (per add-to-watchlist)" is a daily scheduled feed that also has
  // an on-demand path — its primary cadence (and its SLA) is daily, so it
  // grades on a schedule. Only feeds whose primary cadence is a non-scheduled
  // nature (pure event-driven / on-demand / static) skip the SLA grade.
  if (/^(daily|weekly|bi[- ]?weekly|bi[- ]?monthly|monthly|quarterly|annual|hourly|\d+x|every |during scan)\b/.test(c)) {
    return { scheduled: true, label: null };
  }
  // Event / on-change feeds — portfolio accounts, positions, watchlist,
  // transactions, user preferences (when present).
  if (/^event[- ]driven|^on[- ]change|^per (workflow|add-to-watchlist|save)/.test(c)) {
    return { scheduled: false, label: 'Updates on change' };
  }
  // On-demand / on-request feeds — per-ticker Google News, per-modal pulls.
  if (/^on[- ]demand|^per modal|^on[- ]request/.test(c)) {
    return { scheduled: false, label: 'On demand' };
  }
  // Static reference data.
  if (/^static\b/.test(c)) {
    return { scheduled: false, label: 'Static' };
  }
  // Fallbacks for cadence strings that don't lead with a known token.
  if (/\b(daily|weekly|monthly|quarterly|hourly|\d+x|every )\b|scan/.test(c)) {
    return { scheduled: true, label: null };
  }
  if (/event[- ]driven|on[- ]change/.test(c)) return { scheduled: false, label: 'Updates on change' };
  if (/on[- ]demand/.test(c)) return { scheduled: false, label: 'On demand' };
  if (/\bstatic\b/.test(c)) return { scheduled: false, label: 'Static' };
  // Unknown → treat as non-scheduled so we never fabricate a red SLA chip.
  return { scheduled: false, label: 'On demand' };
}

// ─── Display-name helper ─────────────────────────────────────────────────────
// Never render code-y element ids/names to the user. Prefer the registry's
// human display name; fall back to a humanised version of the manifest name.
const REG_DISPLAY = {};
Object.entries(IND).forEach(([k, meta]) => { if (meta && meta[0]) REG_DISPLAY[k] = meta[0]; });
const REG_FAMILY = {};
Object.entries(IND).forEach(([k, meta]) => { if (meta && meta[2]) REG_FAMILY[k] = meta[2]; });
// Registry "deprecated" flag (schema index 11). A deprecated registry entry is a
// retired cycle-engine factor that is NOT shown as an indicator on Macro
// Overview (the Shiller P/E, ISM, the copper/gold ratio, banks-vs-market, and
// 3-year credit growth). Kept in the registry for engine math, hidden from the
// indicator grids.
const REG_DEPRECATED = {};
Object.entries(IND).forEach(([k, meta]) => { REG_DEPRECATED[k] = !!(meta && meta[11]); });

// A LIVE Macro Overview indicator = a registry entry that is not deprecated.
// This is exactly the set the Macro Overview and All Indicators pages display
// (50 of them). The manifest's category:"indicator" is deliberately broader — it
// also tracks, for freshness, the engine-input derived spreads/ratios (FRA-OIS,
// SOFR-OIS, real Fed funds, the bank-vs-market v11 ratio, the equity risk
// premium, copper/gold), the survey sub-series (the ISM head plus its
// manufacturing/services splits, the 4-week jobless-claims average), registry
// reference-only series (CAPE, 3-year credit growth), the NY-Fed credit
// positioning signal, and the single CFTC COT element. None of those are Macro
// Overview indicators, so the Indicators column and its headline count include
// ONLY the live registry indicators — and tie out to the 50 on Macro Overview.
function isLiveIndicator(name) {
  return Object.prototype.hasOwnProperty.call(IND, name) && !REG_DEPRECATED[name];
}

function humanise(name) {
  if (!name) return '';
  return String(name)
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
// Explicit display names for engine-internal elements that are NOT in the
// indicator registry and whose humanised id reads code-y.
const ENGINE_DISPLAY = {
  indicator_history: 'Indicator history compiler',
};

function displayName(el) {
  if (!el) return '';
  const n = el.name;
  if (ENGINE_DISPLAY[n]) return ENGINE_DISPLAY[n];
  if (REG_DISPLAY[n]) return REG_DISPLAY[n];
  // Manifest-supplied plain-English name (added 2026-07-28 — Joe: internal
  // ids like "Lse Archive Iv" are useless on a human surface; every
  // non-registry element now carries display_name in the manifest).
  if (el.display_name) return el.display_name;
  // Last resort for anything unregistered — title-cased id, better than raw.
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
    scanner: 'Trading Scanner',
    portopps: 'Trading Scanner',
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

// As-of, capped at the last pull and rendered in the SAME ET basis as the
// Last-pull column. Data can never be more current than the pull that fetched
// it (Joe 2026-06-23): a forward-dated / midnight-UTC stamp on a late-evening
// pull must not render a day AHEAD of a Last-pull shown in ET. When the as-of
// anchored to its session close is after the pull, show the pull's own ET date.
function fmtAsOfClamped(asOfIso, lastPullIso) {
  if (!asOfIso) return '—';
  if (lastPullIso) {
    const a = String(asOfIso);
    const aMs = Date.parse(a.length === 10 ? `${a}T20:00:00Z` : a);
    const pMs = Date.parse(lastPullIso);
    if (Number.isFinite(aMs) && Number.isFinite(pMs) && aMs > pMs) {
      return new Date(pMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    }
  }
  return fmtDate(asOfIso);
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
  const lastPullIso = f?.lastRefreshedAt || f?.lastGoodAt;
  const asOf = fmtAsOfClamped(f?.dataAsOf || el.data_as_of, lastPullIso);
  const lastPull = fmtDateTime(lastPullIso);
  const sla = prettySla(el.freshness_sla_hours);

  // How does this feed update? Scheduled feeds grade green/amber/red against an
  // SLA; on-change / on-demand / static feeds have NO daily SLA, so a red/stale
  // chip would be wrong — show their NATURE instead.
  const nature = cadenceNature(el.cadence);
  // A scheduled feed with no pipeline_health row isn't broken — it's just not
  // being tracked yet. The grader synthesises a red ("No successful pull on
  // record") purely because the row is absent, so when there is no successful
  // run on record we show a neutral grey "Not yet tracked" chip instead (never
  // green, never the "no successful run" alarm). A feed that HAS recorded a
  // successful run grades normally (so a feed that ran then went stale still
  // reads red). Detection: useFreshness exposes missingFromPipelineHealth on
  // some builds; the always-reliable signal is the absence of BOTH a last-good
  // and last-refreshed timestamp — a producer that has never recorded a pull.
  const noRunOnRecord = !f?.lastGoodAt && !f?.lastRefreshedAt;
  const notTracked = nature.scheduled && f && !f.loading
    && (f.missingFromPipelineHealth || noRunOnRecord);

  let freshnessCell;
  if (!nature.scheduled) {
    // On-change / on-demand / static — state the nature, not a freshness grade.
    freshnessCell = <span className="df-row-nature">{nature.label}</span>;
  } else if (notTracked) {
    freshnessCell = (
      <span className="df-row-untracked">
        <span className="df-dot df-dot--inline df-dot--u" />Not yet tracked
      </span>
    );
  } else {
    freshnessCell = <FreshnessChip elementId={el.id} variant="label" />;
  }

  // For non-scheduled feeds the As-of / Last-pull / SLA columns carry no
  // meaningful schedule figures — keep them quiet rather than showing stale or
  // em-dash noise; the nature label already says how the feed behaves.
  const showSchedule = nature.scheduled;

  return (
    <div className="df-row">
      <div className="df-row-main">
        <div className="df-row-name">{displayName(el)}</div>
        <div className="df-row-vendor">{vendor}</div>
      </div>
      <div className="df-row-cad">
        {el.cadence_display
          /* One coherent "how this updates" line per element (2026-07-28 —
             Joe: a row must not mix three clocks. Sourced from the ACTUAL
             producer schedules, kept in the manifest, never hand-typed here). */
          ? el.cadence_display
          : <>{cad}{fetchAt ? <span className="df-row-cad-t"> · {fetchAt}</span> : null}</>}
      </div>
      <div className="df-row-asof"><span className="df-row-k">As of</span>{showSchedule ? asOf : '—'}</div>
      <div className="df-row-pull"><span className="df-row-k">Last pull</span>{showSchedule ? lastPull : '—'}</div>
      <div className="df-row-sla"><span className="df-row-k">SLA</span>{showSchedule ? sla : '—'}</div>
      <div className="df-row-chip">
        {freshnessCell}
      </div>
    </div>
  );
}

// One COT market row. The 28 CFTC positioning signals are all produced by the
// single weekly CFTC job, so freshness is resolved ONCE from the shared
// cftc-cot pipeline_health stamp (every row carries the same honest chip) while
// each row shows that market's own speculator/commercial percentile and its own
// CFTC report date. Percentiles are the market's net position ranked in its own
// trailing 3-year range (0 = most short on record, 100 = most long).
function CotRow({ el }) {
  const f = useFreshness(el.healthId || COT_HEALTH_ID);
  const lastPullIso = f?.lastRefreshedAt || f?.lastGoodAt;
  const asOf = fmtAsOfClamped(el.data_as_of || f?.dataAsOf, lastPullIso);
  const lastPull = fmtDateTime(lastPullIso);
  const pct = (v) => (v == null ? '—' : `${v}`);
  return (
    <div className="df-row df-row--cot">
      <div className="df-row-main">
        <div className="df-row-name">
          {el.name}
          {el.cotDiv ? <span className="df-cot-div" title="Speculators and commercials are stretched on opposite sides">· divergent</span> : null}
        </div>
        <div className="df-row-vendor">{el.cotVendor || 'CFTC'} · {el.cotDomain}</div>
      </div>
      <div className="df-row-cad">
        {el.cotComm == null ? (
          <span className="df-cot-pct">{el.cotPctLabel || 'Spec'} <b>{pct(el.cotSpec)}</b></span>
        ) : (
          <>
            <span className="df-cot-pct">Spec <b>{pct(el.cotSpec)}</b></span>
            <span className="df-cot-pct">Comm <b>{pct(el.cotComm)}</b></span>
          </>
        )}
        <span className="df-row-cad-t">%-ile, 3y</span>
      </div>
      <div className="df-row-asof"><span className="df-row-k">As of</span>{asOf}</div>
      <div className="df-row-pull"><span className="df-row-k">Last pull</span>{lastPull}</div>
      <div className="df-row-sla"><span className="df-row-k">SLA</span>{prettySla(el.freshness_sla_hours)}</div>
      <div className="df-row-chip">
        <FreshnessChip elementId={el.healthId || COT_HEALTH_ID} variant="label" />
      </div>
    </div>
  );
}

// Column headers for the per-element table (rendered once above the rows).
function ElementTableHead() {
  return (
    <div className="df-row df-row--head" aria-hidden>
      <div className="df-row-main">Element · source</div>
      <div className="df-row-cad">How it updates</div>
      <div className="df-row-asof">As of</div>
      <div className="df-row-pull">Last pull</div>
      <div className="df-row-sla">SLA</div>
      <div className="df-row-chip">Freshness</div>
    </div>
  );
}

// Header for the COT positioning table — the middle column shows the positioning
// percentiles rather than a cadence.
function CotTableHead() {
  return (
    <div className="df-row df-row--head df-row--cot" aria-hidden>
      <div className="df-row-main">Market · class</div>
      <div className="df-row-cad">Positioning (3y %-ile)</div>
      <div className="df-row-asof">As of</div>
      <div className="df-row-pull">Last pull</div>
      <div className="df-row-sla">SLA</div>
      <div className="df-row-chip">Freshness</div>
    </div>
  );
}

/* (Reveal wrapper removed 2026-07-22 with the hero header — it was used on
   the hero ONLY; the flow board is measured with getBoundingClientRect for
   the lineage lines, so it must never sit mid-transform.) */

// ─── Tile ─────────────────────────────────────────────────────────────────────
// The status dot carries an INSTANT tooltip (the site's portal-rendered <Tip>,
// which shows on hover/focus with zero delay — never the native title attr,
// which has a ~1s delay). The tip explains what the dot colour means and, for
// amber/red tiles, names the specific lagging/stale member feed(s). `dotTip` is
// the pre-built JSX passed down from the page's status rollup.
function Tile({ id, role, name, sub, count, selected, lit, dim, status, dotTip, onClick }) {
  const cls = [
    'df-tile',
    `df-tile--${role}`,
    selected ? 'df-tile--selected' : '',
    lit ? 'df-tile--lit' : '',
    dim ? 'df-tile--dim' : '',
  ].filter(Boolean).join(' ');
  const dotCls = `df-dot df-dot--static df-dot--${status || 'u'}`;
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => { e.stopPropagation(); onClick(id); }}
      data-id={id}
    >
      <span className="df-dot-tip">
        <Tip content={dotTip} side="left" bare>
          <span className={dotCls} aria-label="feed freshness" />
        </Tip>
      </span>
      <span className="df-tile-name">{name}</span>
      <span className="df-tile-cd">{sub}</span>
      {count != null && <span className="df-tile-count">{count}</span>}
    </button>
  );
}

// Build the dot tooltip content for a tile: a plain-English meaning of the dot
// colour, plus — for a red tile — the named stale/failed member feed(s) and why.
// `worst` is the list of stale members [{ name, status, lastRan, reason }].
function buildDotTip(status, worst) {
  const meaning =
    status === 'g' ? 'Green — every feed in this tile is within its freshness target.'
      : status === 'r' ? 'Red — at least one feed is stale or its last run failed.'
        : 'Grey — these feeds aren’t on a daily schedule (they update on change / on demand), or aren’t tracked yet.';
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 600, color: 'var(--mt-ink-0)', marginBottom: (worst && worst.length) ? 6 : 0 }}>
        {meaning}
      </div>
      {worst && worst.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--mt-ink-2)', lineHeight: 1.5 }}>
          {worst.slice(0, 4).map((w) => (
            <li key={w.name}>
              <span style={{ color: 'var(--mt-ink-0)', fontWeight: 600 }}>{w.name}</span>
              {w.detail ? <span> — {w.detail}</span> : null}
            </li>
          ))}
          {worst.length > 4 && (
            <li style={{ color: 'var(--mt-ink-3)' }}>+{worst.length - 4} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DataFlowPage() {
  // ALL useState first — declared before any useMemo that references them, so
  // there is no temporal-dead-zone trap (the prior blank-page bug).
  const [manifest, setManifest] = useState(null);
  const [cotData, setCotData] = useState(null); // public/cot_positioning.json — the 28 CFTC COT signals
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

  // Load the CFTC COT positioning file once. The manifest carries ONE cftc-cot
  // element, but the weekly producer (build_cot_positioning.py) actually writes
  // 28 per-market positioning signals into public/cot_positioning.json
  // (domains: Rates / Equities / FX / Commodities / Credit). We surface those 28
  // here as their own tile, each row from its real source — never fabricated.
  // All 28 share the single cftc-cot pipeline_health stamp (one weekly job), so
  // each row grades off that real stamp.
  useEffect(() => {
    let cancelled = false;
    fetch('/cot_positioning.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setCotData(d); })
      .catch(() => { /* non-fatal — the cftc-cot row still shows without the 28 */ });
    return () => { cancelled = true; };
  }, []);

  const elements = useMemo(() => {
    const els = manifest?.elements;
    if (!Array.isArray(els)) return [];
    // Keep every NON-INFRASTRUCTURE element (ops tables + the static changelog
    // stay excluded). The earlier rule dropped any element with no
    // pipeline_health row outright — but that silently deleted real feeds the
    // rest of this page is built to show honestly:
    // portfolio accounts/positions/transactions/watchlist (event-driven),
    // the per-ticker news + commentary feeds, and several scanner inputs. Each
    // of those under-counted a tile and left panels thin or empty.
    //
    // It is also unnecessary: a scheduled element with no tracking row renders
    // a neutral grey "Not yet tracked" per row (never green, never the red
    // "no successful run" alarm — see ElementRow's notTracked guard), and a
    // non-scheduled feed (on-change / on-demand / static) shows its NATURE.
    // Tile dots roll up worst-of-members where untracked is neutral grey, so
    // an untracked element can never turn a tile fake-green or fake-red. So the
    // honest, complete behaviour is to keep them all and let the per-row /
    // per-tile freshness machinery state the truth.
    return els.filter((e) => e && typeof e === 'object' && e.name && !isInfrastructure(e));
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
      // Engines: explicit engine outputs + the computed scan composite.
      // (ops is already filtered out upstream.)
      if (ENGINE_NAMES.has(e.name) || SCANNER_ENGINE_NAMES.has(e.name)) {
        out[e.name] = 'engine';
      } else if (cat === 'indicator') {
        out[e.name] = 'derived';
      } else if (cat === 'portfolio' || cat === 'news' || cat === 'commentary') {
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
      // Computed engine outputs (e.g. the scan composite) are NOT vendor pulls —
      // they belong to the engine that produces them, not a source tile.
      if (classified[e.name] === 'engine') return;
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
  }, [elements, classified]);

  // ── Column 2: Derived-indicator tiles, grouped by 5-domain family ──
  // The CFTC COT element is pulled out of the family rollup and given its own
  // tile listing all 28 per-market positioning signals (built from
  // cot_positioning.json). Without this it was a single lone "Cftc Cot" row.
  const cotMembers = useMemo(() => buildCotMembers(cotData), [cotData]);
  const creditMembers = useMemo(() => buildCreditMembers(cotData), [cotData]);
  const derivedTiles = useMemo(() => {
    const byFam = new Map();
    elements.forEach((e) => {
      if (classified[e.name] !== 'derived') return;
      if (isCotElement(e)) return; // COT gets its own tile, not a family row
      if (isCreditPosElement(e)) return; // credit positioning gets its own tile
      // Only the 50 live Macro Overview indicators are counted/grouped here.
      // Derived engine inputs, survey sub-series, reference-only and positioning
      // elements stay tracked (and visible under their source vendor tile) but
      // are not indicators — so this column ties to Macro Overview's 50.
      if (!isLiveIndicator(e.name)) return;
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
    // Dedicated CFTC COT positioning tile — the 28 per-market signals from the
    // weekly CFTC job. Only shown once the file has loaded and the cftc-cot
    // element is actually tracked on this page (so it disappears in lockstep
    // with the rest of the page if the manifest ever drops it).
    const cotTracked = elements.some(isCotElement);
    if (cotTracked && cotMembers.length) {
      tiles.push({
        id: COT_TILE_ID,
        name: 'CFTC COT positioning',
        sub: `${cotMembers.length} positioning signals`,
        count: cotMembers.length,
        members: cotMembers,
        isCot: true,
      });
    }
    // Dedicated Credit positioning tile — IG/HY primary-dealer inventory (the 2
    // signals from cot_positioning.json domains.Credit). Own tile next to the COT
    // tile (Joe 2026-06-22). Both signals share the credit_positioning stamp.
    const creditTracked = elements.some(isCreditPosElement);
    if (creditTracked && creditMembers.length) {
      tiles.push({
        id: CREDIT_TILE_ID,
        name: 'Credit positioning',
        sub: `${creditMembers.length} positioning signals`,
        count: creditMembers.length,
        members: creditMembers,
        isCot: true,
        isCredit: true,
      });
    }
    return tiles;
  }, [elements, classified, cotMembers, creditMembers]);

  // ── Column 3: Engine / model tiles ──
  // Engine-internal computed outputs — one tile per engine element.
  const engineTiles = useMemo(() => {
    const tiles = [];
    // Single-element engines (the indicator-history compiler).
    elements
      .filter((e) => classified[e.name] === 'engine' && !SCANNER_ENGINE_NAMES.has(e.name))
      .forEach((e) => {
        tiles.push({
          id: `eng:${e.name}`,
          name: displayName(e),
          sub: prettyCadence(e.cadence),
          members: [e],
        });
      });
    // Trading scanner engine — the in-house computed scan outputs grouped into
    // one node (the daily composite MT Score + its filtered universe).
    const scanMembers = elements.filter((e) => SCANNER_ENGINE_NAMES.has(e.name));
    if (scanMembers.length) {
      tiles.push({
        id: SCANNER_ENGINE_ID,
        name: 'Trading scanner',
        sub: 'Daily composite MT Score',
        members: scanMembers,
      });
    }
    tiles.sort((a, b) => a.name.localeCompare(b.name));
    return tiles;
  }, [elements, classified]);

  // ── Column 4: Surface tiles (one per consumer-surface tab) + workflow tiles ──
  const { surfaceTiles, workflowTiles } = useMemo(() => {
    // Surfaces: collect, per tab, every element that declares a consumer
    // surface on that tab. consumer_surfaces entries can be dicts or strings.
    // Tab names are canonicalised (macro→overview, portopps→scanner,
    // methodology→readme) so each real page is ONE tile.
    const byTab = new Map();
    elements.forEach((e) => {
      // Portfolio / news / commentary feeds are shown in the Workflows section
      // below (grouped by category). They also declare a consumer surface (the
      // Portfolio feeds carry a "portopps" tab), which was double-listing them
      // under a page-surface tile — e.g. the watchlist / accounts / positions /
      // transactions feeds showing under "Trading Scanner". A feed lives in
      // exactly one place: Workflows OR Surfaces, never both. (Joe 2026-06-17.)
      // Workflow feeds live in the Workflows section; engine outputs (the scan
      // composite) feed surfaces THROUGH their engine node, not as direct
      // surface members — so neither is counted as a surface feed here.
      if (classified[e.name] === 'workflow' || classified[e.name] === 'engine') return;
      const css = Array.isArray(e.consumer_surfaces) ? e.consumer_surfaces : [];
      const tabs = new Set();
      css.forEach((cs) => {
        if (cs && typeof cs === 'object' && cs.tab) tabs.add(canonTab(cs.tab));
        // string-shaped entries carry no clean tab — skip for grouping.
      });
      tabs.forEach((tab) => {
        if (!byTab.has(tab)) byTab.set(tab, []);
        byTab.get(tab).push(e);
      });
    });
    const SURFACE_ORDER = ['home', 'overview', 'scanner', 'paper', 'indicators', 'readme', 'ticker', 'admin'];
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

    // Workflows: portfolio / news / commentary elements grouped by category.
    // (Internal ops plumbing was already excluded upstream.)
    const CAT_LABEL = {
      portfolio: 'Portfolio & accounts',
      news: 'News & commentary feeds',
      commentary: 'Editorial commentary',
      equity: 'Equity / scanner data',
    };
    const byCat = new Map();
    elements.forEach((e) => {
      if (classified[e.name] !== 'workflow') return;
      const cat = e.category || 'other';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(e);
    });
    const wTiles = [];
    ['portfolio', 'news', 'commentary'].forEach((cat) => {
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
      if (['portfolio', 'news', 'commentary'].includes(cat)) return;
      wTiles.push({ id: `wf:${cat}`, name: CAT_LABEL[cat] || humanise(cat), sub: `${els.length} job${els.length === 1 ? '' : 's'}`, count: els.length, members: els });
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
  //   family → engines    : every family rolls into the indicator compiler
  //   engines → surfaces  : each engine feeds ONLY the surfaces its manifest
  //                         consumer_surfaces declare.
  //   member → surface    : every element feeds the surface tabs it declares
  const edges = useMemo(() => {
    const E = [];
    const famTileFor = {};
    derivedTiles.forEach((t) => { famTileFor[t.name] = t.id; });
    const engById = {};
    engineTiles.forEach((t) => { t.members.forEach((m) => { engById[m.name] = t.id; }); });
    const surfTileForTab = {};
    surfaceTiles.forEach((t) => { surfTileForTab[t.id.replace('surf:', '')] = t.id; });
    const srcTileForVendor = {};
    sourceTiles.forEach((stile) => { if (stile.vendor) srcTileForVendor[stile.vendor] = stile.id; });

    // vendor → family / engine / surface (via each member element)
    sourceTiles.forEach((src) => {
      const fams = new Set();
      const engs = new Set();
      const surfs = new Set();
      src.members.forEach((m) => {
        if (isCotElement(m)) {
          // CFTC feeds the dedicated COT tile, not a generic family.
          fams.add(COT_TILE_ID);
          return;
        }
        if (isCreditPosElement(m)) {
          // NY-Fed dealer feed → the dedicated Credit positioning tile.
          fams.add(CREDIT_TILE_ID);
          return;
        }
        if (classified[m.name] === 'derived' && isLiveIndicator(m.name)) {
          const dom = domainForIndicator(m.name);
          if (famTileFor[dom]) fams.add(famTileFor[dom]);
        }
        if (classified[m.name] === 'engine' && engById[m.name]) engs.add(engById[m.name]);
        const css = Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : [];
        css.forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = canonTab(cs.tab);
            // A feed the scanner consumes flows IN through the Trading scanner
            // engine, not straight to the surface — so the chain reads
            // source → engine → Trading Scanner (and the surface, when selected,
            // shows its real upstream instead of a bare feed count).
            if (SCANNER_SURFACE_TABS.has(tab)) engs.add(SCANNER_ENGINE_ID);
            else if (surfTileForTab[tab]) surfs.add(surfTileForTab[tab]);
          }
        });
      });
      fams.forEach((f) => E.push([src.id, f]));
      engs.forEach((g) => E.push([src.id, g]));
      // sources that feed a surface directly (equity/market feeds) — only when
      // they don't already route through a family (keeps the graph readable).
      if (fams.size === 0) surfs.forEach((s) => E.push([src.id, s]));
    });

    // family → indicator compiler. The COT tile is NOT an input to the
    // compiler — it feeds the Macro Overview cross-asset positioning rollup
    // directly (see below), so exclude it here.
    const compilerId = engineTiles.find((t) => /history|compiler|indicator history/i.test(t.name))?.id;
    derivedTiles.forEach((t) => {
      if (t.id === COT_TILE_ID || t.id === CREDIT_TILE_ID) return;
      if (compilerId) E.push([t.id, compilerId]);
    });

    // family -> surfaces (THE missing link): a family feeds every surface that
    // renders any of its member indicators, read from each member's
    // consumer_surfaces. Without this, surfaces that render indicators directly
    // (Home, Macro Overview, All Indicators) showed almost no upstream and the
    // value chain was broken in the middle. Now clicking a surface traces back
    // through its indicator families to their sources, and clicking a
    // source/family lights every surface its data reaches.
    derivedTiles.forEach((t) => {
      if (t.id === COT_TILE_ID || t.id === CREDIT_TILE_ID) return;
      const fsurfs = new Set();
      t.members.forEach((m) => {
        (Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : []).forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = canonTab(cs.tab);
            if (surfTileForTab[tab]) fsurfs.add(surfTileForTab[tab]);
          }
        });
      });
      fsurfs.forEach((sid) => E.push([t.id, sid]));
    });

    // COT tile → Macro Overview (its manifest consumer surface is the macro tab
    // "Cross-asset positioning rollup"). Drawn explicitly because the tile's
    // members are synthetic per-market rows, not manifest elements.
    const overviewSurfId = surfTileForTab['overview'];
    if (overviewSurfId && derivedTiles.some((t) => t.id === COT_TILE_ID)) {
      E.push([COT_TILE_ID, overviewSurfId]);
    }
    if (overviewSurfId && derivedTiles.some((t) => t.id === CREDIT_TILE_ID)) {
      E.push([CREDIT_TILE_ID, overviewSurfId]);
    }

    // engines: sources → engine (upstream) and engine → surfaces (downstream).
    // Upstream is drawn from every vendor named in each member's (possibly
    // multi-vendor) source string PLUS each member's declared dependencies'
    // vendors — so the Trading scanner engine traces back to all the feeds it is
    // built from, not just the first one. Downstream is each member's declared
    // consumer surfaces.
    engineTiles.forEach((eng) => {
      const surfs = new Set();
      const ups = new Set();
      eng.members.forEach((m) => {
        allCanonVendors(m.source_vendor).forEach((v) => { if (srcTileForVendor[v]) ups.add(srcTileForVendor[v]); });
        (Array.isArray(m.dependencies) ? m.dependencies : []).forEach((depId) => {
          const dep = elementById[depId];
          if (!dep) return;
          allCanonVendors(dep.source_vendor).forEach((v) => { if (srcTileForVendor[v]) ups.add(srcTileForVendor[v]); });
        });
        const css = Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : [];
        css.forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = canonTab(cs.tab);
            if (surfTileForTab[tab]) surfs.add(surfTileForTab[tab]);
          }
        });
      });
      ups.forEach((u) => E.push([u, eng.id]));
      surfs.forEach((s) => E.push([eng.id, s]));
    });

    // workflow tiles <-> sources/surfaces: a workflow (Portfolio, News, Commentary)
    // is fed by its members' source vendors and feeds the surfaces its members
    // declare. Without this the workflow tiles drew no connectors at all.
    // (srcTileForVendor is built once in the lookups block above.)
    workflowTiles.forEach((wt) => {
      (wt.members || []).forEach((m) => {
        const v = canonVendor(m.source_vendor);
        if (v && srcTileForVendor[v]) E.push([srcTileForVendor[v], wt.id]);
        // Computed workflow elements (e.g. the wide scan universe) carry no
        // external vendor of their own, so the vendor edge above draws nothing
        // and the tile dangled with a single downstream line and no upstream.
        // Draw the lineage from each declared dependency's OWN source vendor, so
        // an in-house intermediate still traces back to the external data it is
        // built from. (Joe 2026-06-23.)
        (Array.isArray(m.dependencies) ? m.dependencies : []).forEach((depId) => {
          const dep = elementById[depId];
          if (!dep) return;
          const dv = canonVendor(dep.source_vendor);
          if (dv && srcTileForVendor[dv]) E.push([srcTileForVendor[dv], wt.id]);
        });
        (Array.isArray(m.consumer_surfaces) ? m.consumer_surfaces : []).forEach((cs) => {
          if (cs && typeof cs === 'object' && cs.tab) {
            const tab = canonTab(cs.tab);
            if (surfTileForTab[tab]) E.push([wt.id, surfTileForTab[tab]]);
          }
        });
      });
    });

    // de-dupe
    const seen = new Set();
    return E.filter(([a, b]) => {
      const k = `${a}>${b}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [sourceTiles, derivedTiles, engineTiles, surfaceTiles, workflowTiles, classified, elementById]);

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
  const { statusByElement, detailByElement } = useMemo(() => {
    // pipeline_health row → dot letter + the run detail the dot tooltip names.
    // "unverified" (a green the monitor could not re-confirm) and missing rows
    // are neutral grey, not green.
    const byKey = new Map();
    (healthRows || []).forEach((r) => {
      if (r && r.indicator_id) byKey.set(r.indicator_id, r);
    });
    const lookup = (el) => {
      const cand = [el.name, el.id].filter(Boolean);
      for (const c of cand) if (byKey.has(c)) return byKey.get(c);
      return null;
    };
    const coerceCal = (c) => (c === 'nyse-trading-day' || c === 'us-business-day' || c === 'wall-clock') ? c : 'us-business-day';
    const out = {};
    const detail = {};
    elements.forEach((el) => {
      const r = lookup(el);
      // Grade each element with the SAME two-clock function the per-row chips
      // use, off the SAME inputs: the manifest pull SLA + data window, and the
      // row's honest last_good_at / data_as_of / last_error. One shared grader
      // (gradeTwoClock) means a tile dot can never disagree with the chips inside
      // it. Binary green/red — no amber, ever. We do NOT read the stored
      // pipeline_health.status here (that was the source of dots disagreeing with
      // chips when the nightly watchdog and the chip used different SLAs).
      const slaHours = Number(el.freshness_sla_hours) || 0;
      const maxDataAgeHours = Number(el.data_max_age_hours) || 0;
      let s;
      if (!r) {
        // No pipeline_health row at all — "not yet tracked". The per-element
        // row already renders this as a neutral grey chip (never red), so the
        // tile dot must agree: grading an absent row through gradeTwoClock
        // synthesised a red that contradicted the grey row AND the header
        // pill in the same viewport (Joe 2026-07-21, EDGAR cutover). The
        // header pill now surfaces untracked scheduled feeds explicitly, so
        // nothing is silently swallowed by this grey.
        s = 'u';
      } else if (slaHours <= 0 && maxDataAgeHours <= 0) {
        // Reference / event-driven / not-time-graded: no freshness target → a
        // neutral grey, never green (fake-green forbidden) and never red on a
        // tile rollup (an untracked member must not paint a tile red).
        s = 'u';
      } else {
        let dataAsOf = r?.data_as_of || null;
        if (dataAsOf && /T00:00:00(\.0+)?(\+00:00|Z)$/.test(String(dataAsOf))) dataAsOf = String(dataAsOf).slice(0, 10);
        const graded = gradeTwoClock({
          lastPullIso: r?.last_good_at || null,
          asOfIso: dataAsOf,
          dataAsOfIso: dataAsOf,
          slaHours,
          calendar: coerceCal(el.release_calendar),
          lastError: r?.last_error || null,
          maxDataAgeHours,
          dataCalendar: coerceCal(el.data_calendar || el.release_calendar),
          // Live feeds that only update while the market is open pause their
          // clock after the close — same flag the per-row chips use, so the
          // tile dot never reds while the chips inside it are green. (Joe 2026-06-23.)
          marketHoursOnly: !!el.market_hours_only,
        });
        s = graded.status === 'green' ? 'g' : graded.status === 'red' ? 'r' : 'u';
      }
      out[el.name] = s;
      detail[el.name] = {
        lastGoodAt: r?.last_good_at || null,
        lastError: r?.last_error || null,
        dataAsOf: r?.data_as_of || null,
      };
    });
    return { statusByElement: out, detailByElement: detail };
  }, [healthRows, elements]);

  // Plain-English "why" for a lagging/stale member feed, named in the dot tip.
  const memberDetailText = useCallback((el) => {
    const st = statusByElement[el.name] || 'u';
    const d = detailByElement[el.name] || {};
    const ran = d.lastGoodAt
      ? `last ran ${fmtDate(d.lastGoodAt)}`
      : 'no successful run recorded';
    if (st === 'r') {
      if (d.lastError) return `failed (${String(d.lastError).slice(0, 60)})`;
      return `${ran}, past its window`;
    }
    if (st === 'a') return `${ran}, lagging its schedule`;
    return ran;
  }, [statusByElement, detailByElement]);

  const statusByTile = useMemo(() => {
    // worst-of-members, where 'u' (untracked) is neutral and does not turn a
    // tile green on its own; a tile with only untracked members stays neutral.
    const rank = { r: 3, a: 2, g: 1, u: 0 };
    const rollMembers = (members) => {
      let best = 'u';
      let sawTracked = false;
      (members || []).forEach((m) => {
        // The 28 COT signals share the single cftc-cot stamp.
        const key = m._cot ? (m.healthId || COT_HEALTH_ID) : m.name;
        const s = statusByElement[key] || 'u';
        if (s !== 'u') sawTracked = true;
        if (rank[s] > rank[best]) best = s;
      });
      // If a tile has any red/amber, that wins; else if any tracked-green, green;
      // else neutral. (best already encodes this via rank.)
      if (!sawTracked) return 'u';
      return best === 'u' ? 'u' : best;
    };

    // Each tile's dot is the worst of its OWN members only — NO upstream
    // propagation. A stale feed reds ONLY its own tile, never the whole board
    // (the old "red sea" where one stale feed painted every engine and surface
    // it touched). The lineage lines still show that feed's downstream impact
    // when you click its tile; the dot just stops lying about tiles whose own
    // feeds are all fresh.
    const out = {};
    allTiles.forEach((t) => { out[t.id] = rollMembers(t.members); });
    return out;
  }, [allTiles, statusByElement]);

  // ── Per-tile worst-member detail for the dot tooltip. Names the specific
  //    member feed(s) that are lagging/stale and why. Includes the tile's OWN
  //    amber/red members, plus — when the tile is only amber/red because an
  //    upstream source is — the worst upstream member feed (so a surface tile
  //    that is red because a vendor is stale names that vendor's feed). ──
  const tileWorst = useMemo(() => {
    const rank = { r: 3, a: 2, g: 1, u: 0 };
    const out = {};
    allTiles.forEach((t) => {
      const items = [];
      const seenNames = new Set();
      const addBad = (members) => {
        (members || []).forEach((m) => {
          const st = statusByElement[m.name] || 'u';
          if ((st === 'r' || st === 'a') && !seenNames.has(m.name)) {
            seenNames.add(m.name);
            items.push({ name: displayName(m), status: st, detail: memberDetailText(m) });
          }
        });
      };
      addBad(t.members);
      // If this tile shows amber/red but none of its OWN members are bad, the
      // colour came from upstream — name the worst upstream member feed(s).
      const tileStatus = statusByTile[t.id];
      if ((tileStatus === 'r' || tileStatus === 'a') && items.length === 0) {
        bfs(t.id, 'up').forEach((uid) => {
          const ut = tileById[uid];
          if (ut) addBad(ut.members);
        });
      }
      // Worst first.
      items.sort((a, b) => rank[b.status] - rank[a.status]);
      out[t.id] = items;
    });
    return out;
  }, [allTiles, statusByElement, statusByTile, memberDetailText, bfs, tileById]);

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

  // The page loads with NOTHING selected — no tile lit, no lineage lines, and the
  // detail panel showing its "select a tile" prompt. (Joe 2026-06-23.) There is
  // no auto-select; selectedId starts null and only a click sets it.

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
      dotTip={buildDotTip(statusByTile[t.id], tileWorst[t.id])}
      onClick={handleTileClick}
    />
  );

  const selectedTile = selectedId ? tileById[selectedId] : null;
  const selectedRole = selectedId
    ? ((selectedId === COT_TILE_ID || selectedId === CREDIT_TILE_ID) ? 'Indicator family'
      : selectedId.startsWith('src:') ? 'Source vendor'
        : selectedId.startsWith('dom:') ? 'Indicator family'
          : selectedId.startsWith('eng:') ? 'Engine / model'
            : selectedId.startsWith('surf:') ? 'Live surface'
              : 'Workflow')
    : null;

  // Member elements for the detail panel. COT signals sort by domain then
  // market (so the 28 read in asset-class order); everything else by name.
  const detailMembers = useMemo(() => {
    if (!selectedTile) return [];
    const ms = [...(selectedTile.members || [])];
    if (selectedTile.isCot) {
      const order = { Rates: 0, Equities: 1, FX: 2, Commodities: 3, Credit: 4 };
      return ms.sort((a, b) =>
        (order[a.cotDomain] ?? 9) - (order[b.cotDomain] ?? 9)
        || String(a.name).localeCompare(String(b.name)));
    }
    return ms.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [selectedTile]);

  // Vendor extras for the detail header (cost + blast radius), when a source.
  const vendorCost = selectedTile && selectedTile.vendor ? VENDOR_MONTHLY_COST[selectedTile.vendor] : null;
  const vendorBlast = selectedTile && selectedTile.vendor ? VENDOR_BLAST_RADIUS[selectedTile.vendor] : null;

  // Plain-English "what it is / what it does" for the selected tile (engines +
  // single-element tiles), straight from the manifest description (gold source).
  const selectedDesc = useMemo(() => {
    if (!selectedTile || selectedTile.isCot) return null;
    const ms = selectedTile.members || [];
    const isEngine = !!selectedId && selectedId.startsWith('eng:');
    if (isEngine || ms.length === 1) {
      const m = ms.find((x) => x && x.description) || ms[0];
      return m && m.description ? m.description : null;
    }
    return null;
  }, [selectedTile, selectedId]);

  // Totals for the hero strip — computed, never literal.
  const totals = useMemo(() => ({
    elements: elements.length,
    vendors: sourceTiles.length,
    indicators: elements.filter((e) => classified[e.name] === 'derived' && isLiveIndicator(e.name)).length,
    engines: engineTiles.length,
    surfaces: surfaceTiles.length,
  }), [elements, sourceTiles, engineTiles, surfaceTiles, classified]);

  return (
    <div className="home-v12 v13 data-v12">
      {/* Hero header removed 2026-07-22 (Joe: too much space; it also sat
          indented relative to the wider stage below). */}
      <section className="wrap df-stage">

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
            <span><b>{totals.indicators}</b> indicators</span>
            <span><b>{totals.engines}</b> engines &amp; models</span>
            <span><b>{totals.surfaces}</b> live surfaces</span>
          </div>

          <div className="df-legend-top" role="note" aria-label="Legend">
            <span className="df-legend-grp-h">Freshness on every row</span>
            <span><span className="df-dot df-dot--inline df-dot--g" />Within target</span>
            <span><span className="df-dot df-dot--inline df-dot--r" />Stale or failed</span>
            <span><span className="df-dot df-dot--inline df-dot--u" />On change / not yet tracked</span>
            <span className="df-legend-hint">Hover a tile’s dot for detail · click a tile to list its feeds</span>
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
                  <div className="df-col-h">Indicators</div>
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
                      {detailMembers.length} {selectedTile.isCot ? 'positioning signal' : 'feed'}{detailMembers.length === 1 ? '' : 's'}
                      {vendorCost ? <span className="df-detail-cost"> · {vendorCost}/mo</span> : null}
                    </div>
                    {vendorBlast && <p className="df-detail-blast">{vendorBlast}</p>}
                    {selectedDesc && <p className="df-detail-desc">{selectedDesc}</p>}
                    {selectedTile.isCot && !selectedTile.isCredit && (
                      <p className="df-detail-blast">
                        Weekly Commitments-of-Traders futures positioning from the CFTC. Each market’s net
                        speculator and commercial-hedger position is ranked in its own trailing 3-year range
                        (0 = most short on record, 100 = most long). One weekly job publishes all of these, so
                        every signal shares the same freshness. Feeds the Macro Overview cross-asset positioning rollup.
                      </p>
                    )}
                    {selectedTile.isCredit && (
                      <p className="df-detail-blast">
                        Weekly primary-dealer net inventory of investment-grade and high-yield corporate
                        bonds (NY Fed primary-dealer statistics) — a separate source from the CFTC speculator
                        data. Each bond class’s dealer net position is ranked in its own trailing 3-year range
                        (0 = lightest inventory on record, 100 = heaviest). Heavy dealer inventory leaves less
                        balance-sheet room to absorb client selling. One weekly job publishes both signals, so
                        they share the same freshness. Feeds the Macro Overview cross-asset positioning rollup.
                      </p>
                    )}
                  </div>

                  <div className="df-table">
                    {selectedTile.isCot ? <CotTableHead /> : <ElementTableHead />}
                    {detailMembers.map((el) => (
                      selectedTile.isCot
                        ? <CotRow key={el.id} el={el} />
                        : <ElementRow key={el.id || el.name} el={el} />
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      </section>{/* /.df-stage */}
    </div>
  );
}

