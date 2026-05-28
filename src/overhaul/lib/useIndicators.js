/* useIndicators — fetches and unifies the indicator registry, history,
   and manifest the same way the v2 IndicatorsPage does. Single source of
   truth for the overhaul's macro/indicators surfaces.

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
import { IND } from '../../data/indicatorRegistry';

const FAMILY_LABEL = {
  equity: 'Equities',
  credit: 'Credit',
  rates: 'Rates',
  fincond: 'Money',
  bank: 'Money',
  labor: 'Economy',
};
const FAMILY_FULL = {
  equity: 'Equity / Volatility',
  credit: 'Credit Risk',
  rates: 'Rates Curve',
  fincond: 'Financial conditions',
  bank: 'Bank & Money',
  labor: 'Labor & Growth',
};

function pctRank(value, points) {
  if (value == null || !points?.length) return null;
  const vs = points.map((p) => p[1]).filter((v) => typeof v === 'number');
  if (!vs.length) return null;
  const below = vs.filter((v) => v < value).length;
  return Math.round((below / vs.length) * 100);
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

export default function useIndicators() {
  const [hist, setHist] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setHist(d); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'history load failed'); });
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
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
      };
    });
    return out;
  }, [manifest]);

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
      const direction = h.stats?.direction || 'hw';
      const state = stateFor(pct, direction);
      const familyId = meta[2];
      const src = sourceFor[id] || {};
      const registryTier = Number(meta[3]) || 0; // 1=lead 2=coincident 3=lag
      const typeLabel = registryTier === 1 ? 'LEAD' : registryTier === 3 ? 'LAG' : 'COINC';
      // Prefer live-computed priors from the points array. Fall back to the
      // registry meta slot only when points are missing (curated anchor-only
      // series like CAPE / bank_unreal).
      const livePts = h.points || [];
      const liveP1m = livePts.length ? priorAt(livePts, 30) : null;
      const liveP3m = livePts.length ? priorAt(livePts, 91) : null;
      const liveP6m = livePts.length ? priorAt(livePts, 183) : null;
      const liveP1y = livePts.length ? priorAt(livePts, 365) : null;
      out.push({
        id,
        name: meta[0],
        familyId,
        familyLabel: FAMILY_LABEL[familyId] || familyId,
        familyFull: FAMILY_FULL[familyId] || familyId,
        domain: FAMILY_LABEL[familyId] || familyId,
        unit: h.unit || meta[4] || '',
        decimals: meta[5],
        value,
        asOf: last?.[0] || h.as_of,
        points: h.points || [],
        stats: h.stats || {},
        freq: h.freq || meta[3] || '',
        pct,
        direction,
        state,
        prior_1m: liveP1m != null ? liveP1m : meta[7],
        prior_3m: liveP3m != null ? liveP3m : meta[8],
        prior_6m: liveP6m != null ? liveP6m : meta[9],
        prior_1y: liveP1y != null ? liveP1y : meta[10],
        deprecated: meta[11] === true,
        description: meta[12] || '',
        narrative: meta[13] || '',
        registryTier,            // 1 / 2 / 3
        typeLabel,               // 'LEAD' | 'COINC' | 'LAG'
        // Indicator manifest id used by useFreshness lookups: matches
        // the manifest's `id` field (e.g., "indicator-vix-daily").
        manifestId: `indicator-${id}-daily`,
        licenseTier: src.tier || 'free',
        sourceVendor: src.vendor,
        sourceEndpoint: src.endpoint,
      });
    });
    return out;
  }, [hist, sourceFor]);

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
    loading: hist == null,
    error: err,
  };
}

export { FAMILY_LABEL };
