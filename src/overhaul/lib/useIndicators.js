/* useIndicators — fetches and unifies the indicator registry, history,
   and manifest the same way the v2 IndicatorsPage does. Single source of
   truth for the overhaul's macro/indicator surfaces (All Indicators page retired 2026-07-07; Macro Overview is the inventory).

   Returns:
     {
       loading,
       indicators: [{
         id, name, familyId, familyLabel, domain,    // 5-domain rollup
         unit, decimals, value, asOf, points, stats, freq,
         pct,                                         // percentile rank
         direction, state,                            // 'extreme' | 'elevated' | 'calm'
         narrative, description,
         tier, sourceVendor, sourceEndpoint,
         deprecated,
       }, ...]
     }
*/

import { useEffect, useMemo, useState } from 'react';
import { IND, DIRECTION } from '../../data/indicatorRegistry';
import jsonOnce from './jsonOnce';

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
const FAMILY_FULL = {
  equity: 'Equity / Volatility',
  credit: 'Credit Risk',
  rates: 'Rates Curve',
  fincond: 'Financial conditions',
  bank: 'Credit & Banking',
  labor: 'Economy',
  commodities: 'Commodities',
  fx: 'Currencies',
};

// Percentile of today's value within the indicator's own TRAILING 3-YEAR
// window — the same basis the positioning signals use (156 weeks) and the
// basis every line of on-page copy promises ("its own 3-year range").
// Until 2026-06-10 this ranked against the FULL history file (~20y for most
// series), so the pill color and the page copy disagreed. Joe directive
// 2026-06-10: the 3-year basis is canonical site-wide; chart band shading in
// IndicatorDetail derives from this same window so pill and chart agree.
export const PILL_WINDOW_DAYS = 3 * 365;
function pctRank(value, points) {
  if (value == null || !points?.length) return null;
  const lastIso = String(points[points.length - 1][0]).slice(0, 10);
  const lastT = Date.parse(lastIso + 'T00:00:00Z');
  if (!Number.isFinite(lastT)) return null;
  const cutT = lastT - PILL_WINDOW_DAYS * 86400000;
  const vs = [];
  for (const p of points) {
    const t = Date.parse(String(p[0]).slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(t) && t >= cutT && typeof p[1] === 'number') vs.push(p[1]);
  }
  // Not enough in-window history to rank — return null so the UI shows '—'
  // instead of a meaningless percentile. Floor of 12 admits quarterly series
  // (12 obs in 3y) while still rejecting near-empty series (e.g. uranium with
  // a handful of weekly points).
  if (vs.length < 12) return null;
  const below = vs.filter((v) => v < value).length;
  return Math.round((below / vs.length) * 100);
}

/* ── movePctile — "was the latest move big for THIS indicator?" ────────────
   Joe, 2026-09-01: "What about the most recent 1 day move (for daily
   indicators), or 1 week move for weekly, or 1 month for monthly. I'd like to
   know if the most recent move was sizeable."

   The naive version — rank |Δ| against 3 years of |Δ| — is badly behaved. Run
   over the last 250 observations of every indicator it fires on 44% of days
   for silver and 2% for the 10-year: it measures which VOLATILITY REGIME a
   series is in, not whether today was unusual. Commodities have been getting
   noisier (older, calmer changes drag the threshold down, so everything
   clears it) while rates have been calming (the threshold sits above every
   recent move).

   So the change is scaled by the volatility prevailing WHEN IT HAPPENED
   before it is ranked:

     1. Δ  = |latest value − prior value|, at the indicator's own frequency
             (1 day daily, 1 week weekly, 1 month monthly).
     2. x  = Δ ÷ median(|Δ|) over the trailing 60 observations (26 weekly,
             6 monthly) — "how many times a normal move is this, lately".
     3. rank x against the same x computed at every point in the last 3 years.
     4. ≥ 90th percentile ⇒ a big move for this indicator, in this regime.

   Calibration over the last 250 observations of 58 indicators, 16.7k
   indicator-observations:

     method                     pooled   per-indicator mean   sd
     |Δ| vs 3y of |Δ|            10.6%          10.7%        8.4pp   (1%–44%)
     |Δ| vs 1y of |Δ|            11.0%          11.0%        4.9pp
     Δ ÷ local vol, ranked       11.3%          11.3%        2.4pp   (3%–16%)  <-

   The last row is why this is the one that shipped: the badge means the same
   thing on every row. Without step 2 it does not.                            */
const MOVE_WIN = { D: 756, W: 156, M: 36, Q: 12 };   // ~3 years
const MOVE_SPAN = { D: 60, W: 26, M: 6, Q: 4 };      // "lately"
export const MOVE_FLAG_PCTILE = 90;

function movePctile(points, freq) {
  if (!Array.isArray(points) || points.length < 80) return null;
  const vals = points.map((p) => p[1]).filter((v) => Number.isFinite(v));
  if (vals.length < 80) return null;
  const diffs = [];
  for (let i = 1; i < vals.length; i += 1) diffs.push(Math.abs(vals[i] - vals[i - 1]));
  const span = MOVE_SPAN[freq] || MOVE_SPAN.D;
  const win = MOVE_WIN[freq] || MOVE_WIN.D;
  const scaled = (j) => {
    const base = diffs.slice(Math.max(0, j - span), j).slice().sort((a, b) => a - b);
    if (base.length < 10) return null;
    const med = base[Math.floor(base.length / 2)];
    return med > 0 ? diffs[j] / med : null;
  };
  const cur = scaled(diffs.length - 1);
  if (cur == null) return null;
  const hist = [];
  for (let j = Math.max(0, diffs.length - 1 - win); j < diffs.length - 1; j += 1) {
    const x = scaled(j);
    if (x != null) hist.push(x);
  }
  if (hist.length < 20) return null;
  let le = 0;
  for (let i = 0; i < hist.length; i += 1) if (hist[i] <= cur) le += 1;
  return { pct: Math.round((100 * le) / hist.length), x: cur };
}

function stateFor(pct, direction) {
  if (pct == null) return 'calm';
  // direction: 'hw' = high warns, 'lw' = low warns, 'bw' = bidirectional
  if (direction === 'bw') {
    if (pct >= 85 || pct <= 15) return 'extreme';
    if (pct >= 75 || pct <= 25) return 'elevated';
    return 'calm';
  }
  if (direction === 'lw') {
    if (pct <= 15) return 'extreme';
    if (pct <= 25) return 'elevated';
    return 'calm';
  }
  // Default: high warns
  if (pct >= 85) return 'extreme';
  if (pct >= 75) return 'elevated';
  return 'calm';
}

const DEF = {
  vix: 'Equity Volatility', skew: 'Options-Implied Tail Risk', eq_cr_corr: 'SPY-HYG correlation', cape: 'CAPE Shiller',
  hy_ig: 'High-Yield Credit Spread', ig_oas: 'Investment-Grade Credit Spread', loan_syn: 'High-yield effective yield',
  cmdi: 'Corp-bond distress (NFCI proxy)', cpff: '3m commercial paper - Fed funds',
  sloos_ci: 'SLOOS, C&I net tightening', sloos_cre: 'SLOOS, CRE net tightening',
  bank_credit: 'Bank credit, YoY (H.8)', credit_3y: 'Bank credit, 3-yr growth',
  bank_unreal: 'Unrealized losses / Tier-1', bkx_spx: 'KBW banks / S&P 500',
  yield_curve: '10-yr minus 2-yr Treasury', move: 'Rates Volatility', real_rates: '10-yr TIPS yield',
  term_premium: 'Kim-Wright 10-yr term premium', breakeven_10y: '10-yr UST minus 10-yr TIPS',
  anfci: 'Chicago Fed Financial Conditions', stlfsi: 'St. Louis Fed Financial Stress',
  ism: 'ISM Manufacturing PMI', jobless: 'Initial jobless claims', copper_gold: 'Copper / gold ratio',
  usd: 'Dollar Strength',
};

export default function useIndicators() {
  const [hist, setHist] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // jsonOnce, not fetch: Home mounts this alongside useMarketLevels and both
    // want the same ~4.9 MB history file (2026-08-18).
    jsonOnce('/indicator_history.json')
      .then((d) => { if (!cancelled) setHist(d); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'history load failed'); });
    jsonOnce('/data_manifest.json')
      .then((d) => { if (!cancelled) setManifest(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const sourceFor = useMemo(() => {
    const out = {};
    const els = manifest?.elements;
    if (!Array.isArray(els)) return out;
    els.forEach((e) => {
      if (e.category !== 'indicator' || !e.name) return;
      out[e.name] = {
        vendor: (e.source_vendor || '').split(/[(]/)[0].trim() || null,
        endpoint: e.source_endpoint || null,
        tier: String(e.license_tier || '').toLowerCase().startsWith('paid')
          ? 'paid'
          : (e.license_tier || 'free'),
        // The manifest is the single source of truth for how often a series
        // refreshes. The frequency shown on the page and the freshness SLA
        // both derive from this, NOT from the history file's freq field —
        // those two had drifted (e.g. term_premium / Kim-Wright is a weekly
        // Fed release but the history file marked it daily, and ig_oas was
        // tagged monthly though it is a daily FRED series).
        cadence: String(e.cadence || '').toLowerCase() || null,
        // Plain-English display override for the Freq column + chip — lets a
        // lagged feed read honestly (e.g. "Daily T+3") instead of a bare cadence.
        cadenceLabel: e.cadence_label || null,
        // How the displayed series relates to the raw vendor feed.
        sourcingMode: e.sourcing_mode || null,
        sla: Number(e.freshness_sla_hours) || null,
      };
    });
    return out;
  }, [manifest]);

  // Map a manifest cadence to the single-letter freq code the UI uses.
  const cadenceToFreq = (cad) => {
    switch (cad) {
      case 'daily': return 'D';
      case 'weekly': return 'W';
      case 'monthly': return 'M';
      case 'quarterly': return 'Q';
      default: return null;
    }
  };

  const indicators = useMemo(() => {
    if (!hist) return [];
    const out = [];
    // Compute a historical value at a given calendar offset back from the
    // latest point. Walks back through the points list looking for the first
    // dated entry on or before (latest_date - daysBack). Used to populate the
    // 3M / 6M / 1Y columns directly from the live history file — previously
    // these read from hardcoded indicatorRegistry meta slots, which were
    // null for every indicator added after 2026-04 and caused the All
    // Indicators page to show em-dashes on perfectly valid columns
    // (Joe spotted 2026-05-27 evening).
    const priorAt = (points, daysBack) => {
      if (!Array.isArray(points) || points.length === 0) return null;
      const lastIso = points[points.length - 1][0];
      const lastT = Date.parse(lastIso + 'T00:00:00Z');
      if (!Number.isFinite(lastT)) return null;
      const targetT = lastT - daysBack * 86400_000;
      // Binary search would be nicer; linear back-walk is fine for ~5k pts.
      for (let i = points.length - 1; i >= 0; i--) {
        const t = Date.parse(points[i][0] + 'T00:00:00Z');
        if (Number.isFinite(t) && t <= targetT) {
          return Number.isFinite(points[i][1]) ? points[i][1] : null;
        }
      }
      // Asked for further-back than the series goes — return earliest point
      // rather than nothing, so a 6mo-old indicator still renders 6M/1Y
      // sensibly. Caller can decide whether to display.
      return Number.isFinite(points[0][1]) ? points[0][1] : null;
    };
    Object.entries(IND).forEach(([id, meta]) => {
      const h = hist[id];
      if (!h) return;
      const last = h.points?.length ? h.points[h.points.length - 1] : null;
      const value = last?.[1];
      const pct = pctRank(value, h.points);
      // The REGISTRY decides which tail warns, not the feed. Until 2026-09-03
      // this read stats.direction and fell back to 'hw', so every low-end
      // warning (ERP, breadth, payrolls, 2s10s, reserves) went unflagged.
      // scripts/check_directions.mjs fails the build on a missing entry.
      const direction = DIRECTION[id] || h.stats?.direction || 'hw';
      const state = stateFor(pct, direction);
      const familyId = meta[2];
      const src = sourceFor[id] || {};
      // Manifest cadence wins for the displayed frequency + SLA lookup; the
      // history file's freq is only a fallback for series not yet registered.
      const freqCode = cadenceToFreq(src.cadence) || h.freq || meta[3] || '';
      const registryTier = Number(meta[3]) || 0; // 1=lead 2=coincident 3=lag
      const typeLabel = registryTier === 1 ? 'LEAD' : registryTier === 3 ? 'LAG' : 'COINC';
      // Prefer live-computed priors from the points array. Fall back to the
      // registry meta slot only when points are missing (curated anchor-only
      // series like CAPE / bank_unreal).
      const livePts = h.points || [];
      const mv = movePctile(h.points, freqCode || h.freq);   // computed once, not per-field
      const liveP1m = livePts.length ? priorAt(livePts, 30) : null;
      const liveP3m = livePts.length ? priorAt(livePts, 91) : null;
      const liveP6m = livePts.length ? priorAt(livePts, 183) : null;
      const liveP1y = livePts.length ? priorAt(livePts, 365) : null;
      out.push({
        id,
        name: meta[0],
        familyId,
        familyLabel: FAMILY_LABEL[familyId] || familyId,
        familyFull: DEF[id] || FAMILY_FULL[familyId] || familyId,
        domain: FAMILY_LABEL[familyId] || familyId,
        unit: h.unit || meta[4] || '',
        decimals: meta[5],
        value,
        asOf: last?.[0] || h.as_of,
        points: h.points || [],
        stats: h.stats || {},
        freq: freqCode,
        cadenceLabel: src.cadenceLabel || null,
        pct,
        direction,
        state,
        // How big was the latest move, for THIS indicator, in THIS regime?
        movePct: mv ? mv.pct : null,
        moveX: mv ? mv.x : null,
        prior_1m: liveP1m != null ? liveP1m : meta[7],
        prior_3m: liveP3m != null ? liveP3m : meta[8],
        prior_6m: liveP6m != null ? liveP6m : meta[9],
        prior_1y: liveP1y != null ? liveP1y : meta[10],
        deprecated: meta[11] === true,
        description: meta[12] || '',
        methodology: meta[13] || '',  // 'How it's measured' text; falls back to description when empty
        registryTier,            // 1 / 2 / 3
        typeLabel,               // 'LEAD' | 'COINC' | 'LAG'
        // Indicator manifest id used by useFreshness lookups: matches
        // the manifest's `id` field (e.g., "indicator-vix-daily").
        // 2026-05-27 fix: was hardcoded "daily" for every indicator, which
        // meant weekly/monthly/quarterly indicators (ANFCI, STLFSI, SLOOS,
        // Bank Credit, JOLTS, CMDI, CPFF, Init Claims, etc.) never matched
        // their manifest entries. The chip then rendered "—" for the Last
        // Refresh time on every one of those rows. Now: pick the suffix from
        // the indicator's actual frequency.
        slaHours: src.sla || ({ D: 49, W: 192, M: 1200, Q: 3600 }[freqCode] || 1200),
        manifestId: `indicator-${id}-${
          freqCode === 'W' ? 'weekly'
          : freqCode === 'M' ? 'monthly'
          : freqCode === 'Q' ? 'quarterly'
          : 'daily'
        }`,
        licenseTier: src.tier || 'free',
        sourceVendor: src.vendor,
        sourceEndpoint: src.endpoint,
        sourcingMode: src.sourcingMode,
      });
    });
    // Δ percentile vs the previous print, for the bars view. The prior
    // observation is ranked in ITS OWN trailing-3y window (ending at that
    // observation), so the delta reflects the data moving, not the window
    // sliding. Shown only for elements whose latest print is current (within
    // 2 calendar days of the freshest series on the page) — a weekly or
    // monthly series stops carrying a Δ once its print is old news.
    const maxAsOf = out.reduce((m, i) => (i.asOf && String(i.asOf) > m ? String(i.asOf) : m), '');
    const freshCutT = maxAsOf ? Date.parse(maxAsOf.slice(0, 10) + 'T00:00:00Z') - 2 * 86400000 : null;
    out.forEach((i) => {
      i.deltaPct = null;
      if (!i.points || i.points.length < 2 || i.pct == null || freshCutT == null) return;
      const ownT = Date.parse(String(i.asOf).slice(0, 10) + 'T00:00:00Z');
      if (!Number.isFinite(ownT) || ownT < freshCutT) return;
      const prevPct = pctRank(i.points[i.points.length - 2][1], i.points.slice(0, -1));
      if (prevPct != null) i.deltaPct = i.pct - prevPct;
    });
    return out;
  }, [hist, sourceFor]);

  // Major-index overlay series for the detail charts (S&P 500 / Nasdaq /
  // Dow). These live in the history file but are NOT registry indicators —
  // no pill, no composite. Defined here once so Macro Overview and All
  // Indicators consume identical series, colors, and freshness ids.
  const indexSeries = useMemo(() => {
    const DEFS = [
      { key: 'spx_index', label: 'S&P 500', color: 'var(--mt-accent)', elementId: 'market-spx_index-daily' },
      { key: 'ndx_index', label: 'Nasdaq', color: 'var(--mt-ink-1)', elementId: 'market-ndx_index-daily' },
      { key: 'dji_index', label: 'Dow', color: 'var(--mt-ink-3)', elementId: 'market-dji_index-daily' },
    ];
    if (!hist) return [];
    return DEFS.map((c) => {
      const h = hist[c.key];
      if (!h?.points?.length) return null;
      return { ...c, points: h.points, asOf: h.as_of || h.points[h.points.length - 1][0] };
    }).filter(Boolean);
  }, [hist]);

  // The brief promises "indicators across five domains". Deprecated entries
  // are kept in the registry for historical reference but should NOT be
  // surfaced as part of the active framework on Home / Macro / Indicators
  // (Joe directive 2026-05-27 — page kept saying 35 while the framework is
  // smaller). Consumers that need the historical set can read `indicators`;
  // page-facing surfaces should read `active`.
  const active = useMemo(() => indicators.filter((i) => !i.deprecated), [indicators]);

  return {
    indicators,        // raw set including deprecated — for the All Indicators table
    active,            // non-deprecated only — what the brief's counts mean
    indexSeries,       // S&P 500 / Nasdaq / Dow overlay series for detail charts
    loading: hist == null,
    error: err,
  };
}

export { FAMILY_LABEL };
