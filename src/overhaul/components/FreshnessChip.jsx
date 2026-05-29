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

// Relative-age label. When the hook supplies a calendar-aware age (weekends +
// holidays already removed for trading/business-day series), the day bucket
// uses THAT and floors it — so a value from the last trading session reads
// "1d ago", never "2d ago", regardless of weekends or midnight rounding. The
// label then always agrees with the green/red dot beside it. (Joe 2026-05-28:
// "daily, green chip, 2d ago — that's an oxymoron.")
function fmtStamp(iso, calendarAgeHours) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const wallMin = (Date.now() - dt.getTime()) / 60000;
  if (wallMin < -1440) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (wallMin < 1) return 'just now';
  if (wallMin < 60) return `${Math.round(wallMin)}m ago`;
  const wallHr = wallMin / 60;
  if (wallHr < 24) return `${Math.round(wallHr)}h ago`;
  // Day bucket: prefer the calendar-aware age so the words match the dot.
  const ageHr = Number.isFinite(calendarAgeHours) ? calendarAgeHours : wallHr;
  const day = Math.max(1, Math.floor(ageHr / 24));
  if (day < 8) return `${day}d ago`;
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

  // Joe directive 2026-05-27 — drop the "Fresh"/"Stale"/"Checking" word.
  // The colored dot already carries the status; the relative time is what's
  // useful. The word was redundant clutter. Kept for screen-reader aria-label
  // and the tooltip header only.
  const word = status === 'stale' ? 'Stale' : status === 'checking' ? 'Checking' : 'Fresh';
  const asOf = fmtStamp(f?.dataAsOf || f?.lastGoodAt, f?.calendarAgeHours);
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
        {asOf && <span>{asOf}</span>}
      </span>
    );
  } else {
    // pill — show the explicit label if a caller passed one (e.g. "29
    // indicators"), otherwise just the dot + relative time.
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
        {label && <span>{label}</span>}
        {asOf && <span style={{ opacity: label ? 0.7 : 1 }}>{label ? `· ${asOf}` : asOf}</span>}
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
