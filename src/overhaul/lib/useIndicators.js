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
        prior_1m: meta[7],
        prior_3m: meta[8],
        prior_6m: meta[9],
        prior_1y: meta[10],
        deprecated: meta[11] === true,
        description: meta[12] || '',
        narrative: meta[13] || '',
        tier: src.tier || 'free',
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
