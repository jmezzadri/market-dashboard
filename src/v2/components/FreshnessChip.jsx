import React from 'react';
import { useFreshness } from '../../hooks/useFreshness';

function fmtRelative(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  const min = (Date.now() - dt.getTime()) / 60000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 7) return `${Math.round(day)}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function FreshnessChip({ elementId, fallback, label }) {
  const f = useFreshness(elementId, fallback);
  const isStale = f?.status === 'red';
  const ts = f?.lastRunAt || f?.asOfIso || fallback;
  const display = label || fmtRelative(ts);
  return <span className={`v2-fchip ${isStale ? 'red' : ''}`}>{display}</span>;
}
