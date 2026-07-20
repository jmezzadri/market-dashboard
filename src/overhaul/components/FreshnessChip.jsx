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

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFreshness, registerMountedChip, unregisterMountedChip } from '../../hooks/useFreshness';
import { formatSlaDaysHours } from '../../lib/freshnessClock';

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
  // Report this chip's on-screen grade to the site-wide header rollup, so the
  // header can never say "All feeds current" over a visible red chip. The key
  // is stable per mount (elementId + a per-instance id).
  const instanceId = useRef(null);
  if (instanceId.current == null) instanceId.current = `${elementId}#${Math.random().toString(36).slice(2, 8)}`; // synthetic-ok: per-mount registry key, never rendered as data
  useEffect(() => {
    if (f && !f.loading && (f.status === 'red' || f.status === 'amber' || f.status === 'green')) {
      registerMountedChip(instanceId.current, {
        elementId,
        status: f.status,
        label: f.label || elementId,
        reason: f.reason || null,
      });
    }
    return undefined;
  });
  useEffect(() => () => unregisterMountedChip(instanceId.current), []);
  const [hover, setHover] = useState(false);
  const [tipXY, setTipXY] = useState(null);
  const ref = useRef(null);

  const status = f?.status === 'loading' ? 'checking'
    : f?.status === 'red' ? 'stale'
    : f?.status === 'amber' ? 'lagging'
    : f?.status === 'green' ? 'fresh'
    : 'unknown';

  const color =
    status === 'stale'
      ? 'var(--mt-down)'
      : status === 'lagging'
        ? 'var(--mt-amber)'
        : status === 'fresh'
          ? 'var(--mt-up)'
          : 'var(--mt-ink-3)';

  // Joe directive 2026-05-27 — drop the "Fresh"/"Stale"/"Checking" word.
  // The colored dot already carries the status; the relative time is what's
  // useful. The word was redundant clutter. Kept for screen-reader aria-label
  // and the tooltip header only.
  const word = status === 'stale' ? 'Stale' : status === 'lagging' ? 'Lagging' : status === 'fresh' ? 'Fresh' : status === 'checking' ? 'Checking' : 'Not tracked';
  // Session-frontier display (Joe 2026-06-12): a green daily can honestly sit
  // 2+ sessions back only when that IS the source's publication frontier
  // (e.g. credit spreads publish next-morning). "2d ago" beside a green dot
  // read as a contradiction — show the factual coverage date instead.
  const frontierLabel =
    status === 'fresh' && (f?.calendarDaysAgo ?? 0) >= 2 && f?.dataAsOf
      ? `thru ${new Date(String(f.dataAsOf).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
      : null;
  const asOf = frontierLabel || fmtStamp(f?.dataAsOf || f?.lastGoodAt, f?.calendarDaysAgo);
  // Joe 2026-06-23: data can never be more current than the pull that fetched
  // it. If a producer stamps the as-of ahead of its own run time (a forward-
  // dated reference calendar, or a midnight-UTC next-day stamp on an evening
  // pull), cap the displayed as-of at the last pull so the two timestamps never
  // read as an impossible pair.
  const _pullMs = Date.parse(f?.lastRefreshedAt || f?.lastGoodAt || '');
  const _asOfMs = (() => {
    const iso = f?.dataAsOf;
    if (!iso) return NaN;
    const str = String(iso);
    return Date.parse(str.length === 10 ? `${str}T20:00:00Z` : str);
  })();
  const asOfForDisplay =
    Number.isFinite(_pullMs) && Number.isFinite(_asOfMs) && _asOfMs > _pullMs
      ? (f?.lastRefreshedAt || f?.lastGoodAt)
      : f?.dataAsOf;
  const asOfExact = fmtAsOf(asOfForDisplay, f?.asOfCutoffEt);
  const fetchedExact = fmtFetched(f?.lastRefreshedAt || f?.lastGoodAt);

  // Plain SLA line (Joe 2026-06-23: "just put what the SLA is"). The freshness
  // budget is the pull-clock SLA — how long after the job's last successful run
  // the chip allows before it reds. No "turns red if" phrasing; the chip is the
  // status, the line is the budget.
  const slaText = f?.slaHours > 0
    ? formatSlaDaysHours(f.slaHours)
    : (f?.status === 'unknown' ? 'reference \u2014 not time-graded' : '\u2014');

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
        {/* Joe 2026-06-22: no time-text next to freshness chips, site-wide.
            The colored dot carries status; full detail is in the hover tooltip. */}
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
              : status === 'lagging'
                ? 'color-mix(in oklab, var(--mt-amber) 14%, transparent)'
                : status === 'fresh'
                  ? 'color-mix(in oklab, var(--mt-up) 12%, transparent)'
                  : 'color-mix(in oklab, var(--mt-ink-3) 14%, transparent)',
          color,
          letterSpacing: '0.04em',
          fontWeight: 500,
        }}
      >
        {dot}
        {label && <span>{label}</span>}
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
            {/* The five governance fields, in the spec's order and plain
                English. "As of" is the data's own date; "Last pull" is when the
                job actually ran — two different real timestamps, and As-of is
                never shown later than Last pull. "SLA" states the freshness
                budget (how long after the last successful pull the chip allows
                before it reds); the reason line below names what fired when red. */}
            <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--mt-ink-2)', lineHeight: 1.6 }}>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Source:</span> {f?.sourceVendor || '—'}</li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Frequency:</span> {f?.cadenceLabel || freqLabel(f?.cadence, f?.calendar)}{' '}· fetch ~{etLabel(f?.scheduledFetchET)} ET</li>
              <li style={{ marginTop: 2 }}><span style={{ color: 'var(--mt-ink-1)' }}>As of:</span>{' '}<span style={{ color: 'var(--mt-ink-0)', fontWeight: 600 }}>{asOfExact}</span></li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>Last pull:</span>{' '}<span style={{ color: 'var(--mt-ink-0)', fontWeight: 600 }}>{fetchedExact}</span></li>
              <li><span style={{ color: 'var(--mt-ink-1)' }}>SLA:</span> {slaText}</li>
            </ol>
            {/* When red, say why right under the five fields (spec: "shows the
                reason if red"). Reason comes from the shared grade function. */}
            {status === 'stale' && f?.reason && (
              <div style={{
                marginTop: 7,
                paddingTop: 7,
                borderTop: '1px solid var(--mt-line-1)',
                color: 'var(--mt-down)',
                fontSize: 11,
                lineHeight: 1.4,
              }}>
                {f.reason}
              </div>
            )}
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
