// UniverseFreshness — small caption showing when the 3x/weekday universe
// snapshot was last refreshed. Drop it into section headers (Positions,
// Trading Opportunities, Ticker Detail) so the user can tell at a glance that
// prices / options flow / IV rank / etc. are current, not yesterday's close.
//
// Signed-out users see no snapshot (RLS returns 0 rows → universeSnapshotTs
// is null), so this component renders nothing — no placeholder, no nag.
//
// The snapshot fires 3x per weekday at 10:00, 13:00, and 15:45 ET, so the
// timestamp is always within ~3 hours during US market hours. Off-hours and
// weekends, it'll show the last weekday's 15:45 ET snapshot — that's the
// intended behavior (no weekend refresh is needed; markets are closed).

import React from "react";

// Format an ISO timestamp as "HH:MM AM/PM ET" in America/New_York. We render
// exchange-time (ET) intentionally so the caption means the same thing for
// every user regardless of their browser locale — Joe in NY and a colleague
// in London should both see the same 15:45 ET snapshot time.
function formatET(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
}

// Same treatment for the date — used only in the tooltip since the caption
// stays compact. Helps the user verify which weekday's 15:45 ET snapshot is
// showing after a weekend.
function formatETDate(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * @param {object} props
 * @param {string|null|undefined} props.ts          ISO timestamp from scanData.universe_snapshot_ts or the hook.
 * @param {React.CSSProperties}   [props.style]    Caller-supplied overrides merged on top of default caption style.
 * @param {boolean}               [props.compact]  Drops the leading "Prices: 3x/day · " prefix for tight headers.
 */
export default function UniverseFreshness({ ts, style, compact = false }) {
  const timeStr = formatET(ts);
  if (!timeStr) return null;
  const dateStr = formatETDate(ts);
  const caption = compact
    ? `Updated ${timeStr} ET`
    : `Prices: 3x/day · Updated ${timeStr} ET`;
  return (
    <span
      title={
        dateStr
          ? `Universe snapshot — ${dateStr} ${timeStr} ET. Refreshed at 10:00, 13:00, and 15:45 ET on US trading days.`
          : "Universe snapshot refreshed 3x/weekday (10:00 / 13:00 / 15:45 ET)."
      }
      style={{
        fontSize: 10,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {caption}
    </span>
  );
}
