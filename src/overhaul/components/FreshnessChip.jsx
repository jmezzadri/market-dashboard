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
function fmtStamp(iso, calendarDaysAgo) {
  if (!iso) return '—';
  const dateOnly = iso.length === 10;   // 'YYYY-MM-DD' — no time-of-day component
  const dt = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const wallMin = (Date.now() - dt.getTime()) / 60000;
  if (wallMin < -1440) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  // A date-only stamp carries NO time-of-day, so "24h ago" is meaningless and
  // contradicts the date (the bug: "24h ago" shown for today's June 1 data).
  // Measure it in WHOLE UTC calendar days and label accordingly: same date =
  // "today", else "Nd ago" / the date. Never hours.
  if (dateOnly && calendarDaysAgo == null) {
    const todayUTC = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const stampUTC = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    const days = Math.round((todayUTC - stampUTC) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 8) return `${days}d ago`;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  // Same ET session-date as today: show intraday wall-clock freshness.
  if (calendarDaysAgo != null && calendarDaysAgo <= 0) {
    if (wallMin < 1) return 'just now';
    if (wallMin < 60) return `${Math.round(wallMin)}m ago`;
    const hr = wallMin / 60;
    if (hr < 24) return `${Math.round(hr)}h ago`;
    return 'today';
  }
  // One or more whole ET sessions back. This integer is calendar-aware
  // (weekends/holidays not counted), so it always agrees with the dot.
  if (calendarDaysAgo != null) {
    if (calendarDaysAgo < 8) return `${calendarDaysAgo}d ago`;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  // Fallback (no day count supplied): plain wall-clock.
  if (wallMin < 1) return 'just now';
  if (wallMin < 60) return `${Math.round(wallMin)}m ago`;
  const wallHr = wallMin / 60;
  if (wallHr < 24) return `${Math.round(wallHr)}h ago`;
  const day = Math.floor(wallHr / 24);
  if (day < 8) return `${day}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtExact(iso) {
  if (!iso) return null;
  const dateOnly = iso.length === 10;
  const dt = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(dt.getTime())) return null;
  // A date-only value (a session date like "2026-05-29") has no meaningful
  // time-of-day. Showing it in ET turned "May 29" into a misleading
  // "May 28, 8:00 PM EDT". Render date-only values as just the date in UTC.
  if (dateOnly) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
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

function fmtAsOf(iso, cutoffEt) {
  if (!iso) return '—';
  const dateOnly = iso.length === 10;
  if (!dateOnly) {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
  }
  const dt = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return '—';
  const dstr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (cutoffEt && /^\d{1,2}:\d{2}$/.test(cutoffEt)) {
    const [hh, mm] = cutoffEt.split(':').map(Number);
    const ap = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${dstr} \u00b7 ${h12}:${String(mm).padStart(2, '0')} ${ap} ET`;
  }
  return dstr; // date-only series carry no real intraday time — never fabricate one
}

function fmtFetched(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
}

/* Plain-English Frequency, e.g. "Daily, trading days". */
function freqLabel(cadence, calendar) {
  const cal = calendar === 'nyse-trading-day' ? 'trading days'
    : calendar === 'us-business-day' ? 'business days' : null;
  const cad = cadence ? cadence.charAt(0).toUpperCase() + cadence.slice(1) : null;
  if (cad && cal) return `${cad}, ${cal}`;
  return cad || cal || '—';
}

/* Plain-English ET fetch time, e.g. "15:30" or "18:00 (UTC 22:00)" → "3:30 PM". */
function etLabel(raw) {
  if (!raw) return '—';
  const t = String(raw).split('(')[0].trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = Number(m[1]);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
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
  const asOf = fmtStamp(f?.dataAsOf || f?.lastGoodAt, f?.calendarDaysAgo);
  const asOfExact = fmtAsOf(f?.dataAsOf, f?.asOfCutoffEt);
  const fetchedExact = fmtFetched(f?.lastGoodAt);

  const onEnter = () => {
    setHover(true);
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      // Clamp center so the tooltip (maxWidth 320 → ~168px half-width incl.
      // margin) never overflows the viewport edge — fixes the chip tooltip
      // running off the right side of the screen.
      const HALF = 168;
      const cx = Math.max(HALF, Math.min(window.innerWidth - HALF, r.left + r.width / 2));
      // Flip the tooltip BELOW the chip whenever there isn't a full tooltip's
      // height of room above it (the 5-field chip is ~150px tall). Without this
      // the tooltip rendered above a modal-header chip ran off the top of the
      // screen and was unreadable (Joe 2026-06-03, Natural Gas modal).
      const below = r.top < 170;
      setTipXY({ x: cx, y: below ? r.bottom : r.top, below });
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
            {/* Exactly the five fields, plain English, nothing else
                (Joe directive 2026-06-02). */}
            <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--mt-ink-2)', lineHeight: 1.6 }}>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Source:</span> {f?.sourceVendor || '—'}</li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Updates:</span> {freqLabel(f?.cadence, f?.calendar)}</li>
              <li style={{ marginTop: 2 }}><span style={{ color: 'var(--mt-ink-0)', fontWeight: 600 }}>Data as of:</span>{' '}<span style={{ color: 'var(--mt-ink-0)', fontWeight: 600 }}>{asOfExact}</span></li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Last refreshed:</span> {fetchedExact}</li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>SLA:</span> {f?.slaHours > 0 ? `within ${f.slaHours} hours` : '—'}</li>
            </ol>
          </div>,
          document.body,
        )}
    </span>
  );
}

/* One labelled line in the chip tooltip. Shows an em-dash when the value is
   missing so every chip visibly carries all five governance fields. */
function TipRow({ label, value }) {
  return (
    <div style={{ color: 'var(--mt-ink-2)' }}>
      <span style={{ color: 'var(--mt-ink-1)' }}>{label}:</span>{' '}
      {value || '—'}
    </div>
  );
}
