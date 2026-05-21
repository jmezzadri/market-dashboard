import React from 'react';
import { useFreshness } from '../../hooks/useFreshness';

// Cadence-aware freshness stamp.
//
// Daily / weekly indicators read as an age ("2d ago") — recency is what
// matters for fast-moving series. Monthly / quarterly indicators read as the
// period the value is FOR ("Mar 2026", "Q1 2026"): for an economic release
// the reference period is the honest freshness concept — a March print
// dated 2026-03-01 is current, not "80 days stale", and must not read that
// way. A date in the future is never rendered as "just now"; it is shown as
// the literal date so a bad upstream stamp stays visible instead of hiding.
function fmtStamp(iso, freq) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const f = (freq || '').toUpperCase();
  if (f === 'M') {
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (f === 'Q') {
    return `Q${Math.floor(dt.getUTCMonth() / 3) + 1} ${dt.getUTCFullYear()}`;
  }
  // Daily / weekly → relative age.
  const min = (Date.now() - dt.getTime()) / 60000;
  if (min < -1440) {
    // More than a day in the future — a bad stamp. Show it, don't hide it.
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 8) return `${Math.round(day)}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function FreshnessChip({ elementId, fallback, label, freq }) {
  const f = useFreshness(elementId, fallback);
  const isStale = f?.status === 'red';
  const ts = f?.lastRunAt || f?.asOfIso || fallback;
  const display = label || fmtStamp(ts, freq);
  return <span className={`v2-fchip ${isStale ? 'red' : ''}`}>{display}</span>;
}
