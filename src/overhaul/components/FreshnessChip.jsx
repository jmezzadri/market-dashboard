/* FreshnessChip — the most-used atom across the redesign.
   Two states (Green / Red) by manifest SLA, three render variants
   (dot / label / pill). Hover shows an instant portal tooltip with the
   element name, last successful fetch, expected next fetch, SLA, and the
   reason if red.

   Wires to the existing useFreshness(elementId) hook (PR #16 rebuild)
   which is backed by data_manifest.json + pipeline_health. NEVER accepts a
   hard-coded freshness string — per site-overhaul brief.
   Site-overhaul Data Steward sign-off: every value on every page renders
   one of these.
*/

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFreshness } from '../../hooks/useFreshness';

function fmtStamp(iso) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const min = (Date.now() - dt.getTime()) / 60000;
  if (min < -1440) {
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

function fmtExact(iso) {
  if (!iso) return null;
  const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });
}

export default function FreshnessChip({
  elementId,
  fallback,
  variant = 'dot', // 'dot' | 'label' | 'pill'
  label,
  style,
}) {
  const f = useFreshness(elementId, fallback);
  const [hover, setHover] = useState(false);
  const [tipXY, setTipXY] = useState(null);
  const ref = useRef(null);

  const status = f?.status === 'loading' ? 'checking'
    : f?.status === 'red' ? 'stale'
    : 'fresh';

  const color =
    status === 'stale'
      ? 'var(--mt-down)'
      : status === 'checking'
        ? 'var(--mt-ink-3)'
        : 'var(--mt-up)';

  const word = status === 'stale' ? 'Stale' : status === 'checking' ? 'Checking' : 'Fresh';
  const asOf = fmtStamp(f?.dataAsOf || f?.lastGoodAt);
  const exactStamp = fmtExact(f?.dataAsOf || f?.lastGoodAt);

  const onEnter = () => {
    setHover(true);
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setTipXY({ x: r.left + r.width / 2, y: r.top, below: r.top < 80 });
    }
  };
  const onLeave = () => {
    setHover(false);
    setTipXY(null);
  };

  const dot = (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        verticalAlign: 'middle',
        boxShadow: hover ? `0 0 0 3px ${color}28` : 'none',
        transition: 'box-shadow 120ms ease-out',
      }}
    />
  );

  let inner;
  if (variant === 'dot') {
    inner = dot;
  } else if (variant === 'label') {
    inner = (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontFamily: 'var(--mt-font-ui)',
          color: 'var(--mt-ink-2)',
        }}
      >
        {dot}
        <span style={{ color }}>{word}</span>
        {asOf && <span>· {asOf}</span>}
      </span>
    );
  } else {
    // pill
    inner = (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10.5,
          fontFamily: 'var(--mt-font-ui)',
          padding: '3px 8px',
          borderRadius: 999,
          background:
            status === 'stale'
              ? 'color-mix(in oklab, var(--mt-down) 14%, transparent)'
              : 'color-mix(in oklab, var(--mt-up) 12%, transparent)',
          color,
          letterSpacing: '0.04em',
          fontWeight: 500,
        }}
      >
        {dot}
        {label || word}
        {asOf && <span style={{ opacity: 0.7 }}>· {asOf}</span>}
      </span>
    );
  }

  return (
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      style={{ cursor: 'help', display: 'inline-flex', ...style }}
      aria-label={`Freshness: ${word}${asOf ? `, as of ${asOf}` : ''}`}
    >
      {inner}
      {hover && tipXY &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: tipXY.x,
              top: tipXY.y + (tipXY.below ? 10 : -10),
              transform: tipXY.below ? 'translate(-50%,0)' : 'translate(-50%,-100%)',
              background: 'var(--mt-surface)',
              color: 'var(--mt-ink-0)',
              border: '1px solid var(--mt-line-1)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 11.5,
              lineHeight: 1.45,
              maxWidth: 320,
              fontFamily: 'var(--mt-font-ui)',
              boxShadow: '0 8px 24px rgba(0,0,0,.18)',
              pointerEvents: 'none',
              zIndex: 100000,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {f?.label || elementId}
            </div>
            <div style={{ color: 'var(--mt-ink-2)' }}>
              {status === 'stale'
                ? (f?.reason || 'Past freshness SLA')
                : status === 'checking'
                  ? 'Checking data freshness…'
                  : 'Within freshness SLA.'}
            </div>
            {exactStamp && (
              <div style={{ marginTop: 6, color: 'var(--mt-ink-2)' }}>
                <span style={{ color: 'var(--mt-ink-1)' }}>Last update:</span>{' '}
                {exactStamp}
              </div>
            )}
            {f?.slaHours > 0 && (
              <div style={{ color: 'var(--mt-ink-2)' }}>
                <span style={{ color: 'var(--mt-ink-1)' }}>SLA:</span>{' '}
                {f.slaHours}h
                {f?.calendar ? ` · ${f.calendar}` : ''}
              </div>
            )}
            {f?.sourceVendor && (
              <div style={{ color: 'var(--mt-ink-2)' }}>
                <span style={{ color: 'var(--mt-ink-1)' }}>Source:</span>{' '}
                {f.sourceVendor}
              </div>
            )}
            {f?.cause?.element && f.cause.kind === 'input' && (
              <div style={{ marginTop: 6, color: 'var(--mt-down)' }}>
                Upstream failing: <b>{f.cause.element.label || f.cause.element.elementId}</b>
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
