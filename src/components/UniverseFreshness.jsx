// UniverseFreshness — small caption showing when the 3x/weekday data feeds
// were last refreshed. Drop it into section headers (Positions, Trading
// Opportunities, Ticker Detail) so the user can tell at a glance that
// prices / options flow / IV rank / news / insider / etc. are current, not
// yesterday's close.
//
// Two data streams — both show here when timestamps are present:
//   • Prices (universe snapshot)       — `ts` or `pricesTs` prop
//   • Events (news/insider/congress/DP) — `eventsTs` prop (Task #24)
//
// Backward-compat: the legacy single-arg form `<UniverseFreshness ts={...} />`
// still works and renders prices-only. New code should prefer the explicit
// `pricesTs` / `eventsTs` form.
//
// Signed-out users see no snapshot (RLS returns 0 rows → both ts fields null),
// so this component renders nothing — no placeholder, no nag.
//
// Both streams fire 3x per weekday at 10:00, 13:00, and 15:45 ET, so each
// timestamp is within ~3 hours during US market hours. Off-hours and weekends
// show the last weekday's 15:45 ET run — that's the intended behavior (no
// weekend refresh is needed; markets are closed).

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
 * @param {string|null|undefined} props.ts         Legacy prices timestamp (kept for backward-compat callers).
 * @param {string|null|undefined} props.pricesTs   ISO timestamp from scanData.universe_snapshot_ts (preferred).
 * @param {string|null|undefined} props.eventsTs   ISO timestamp from scanData.ticker_events_ts. When present, appends an Events segment (Task #24).
 * @param {React.CSSProperties}   [props.style]   Caller-supplied overrides merged on top of default caption style.
 * @param {boolean}               [props.compact] Drops the leading "Prices:" / "Events:" labels for tight headers.
 */
export default function UniverseFreshness({ ts, pricesTs, eventsTs, style, compact = false }) {
  // Accept either legacy `ts` or new `pricesTs` — pricesTs wins if both are set.
  const priceIso = pricesTs != null ? pricesTs : ts;
  const priceTime = formatET(priceIso);
  const eventTime = formatET(eventsTs);

  // If neither stream has a timestamp, render nothing (matches pre-Task-#24 behavior).
  if (!priceTime && !eventTime) return null;

  const segments = [];
  if (priceTime) {
    segments.push(compact ? `Prices ${priceTime} ET` : `Prices: 3x/day · Updated ${priceTime} ET`);
  }
  if (eventTime) {
    segments.push(compact ? `Events ${eventTime} ET` : `Events: 3x/day · Updated ${eventTime} ET`);
  }
  const caption = segments.join(" · ");

  const priceDate = formatETDate(priceIso);
  const eventDate = formatETDate(eventsTs);
  const titleParts = [];
  if (priceTime) {
    titleParts.push(
      priceDate
        ? `Universe snapshot — ${priceDate} ${priceTime} ET.`
        : `Universe snapshot — ${priceTime} ET.`
    );
  }
  if (eventTime) {
    titleParts.push(
      eventDate
        ? `Ticker events — ${eventDate} ${eventTime} ET.`
        : `Ticker events — ${eventTime} ET.`
    );
  }
  titleParts.push("Both refresh at 10:00, 13:00, and 15:45 ET on US trading days.");
  const title = titleParts.join(" ");

  return (
    <span
      title={title}
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
