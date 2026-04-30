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
//
// Staleness (bug #1028): when the ingestion pipeline stalls, the caption used
// to silently show an old timestamp and blend in with a fresh one. We now:
//   • include the date on each segment whenever the stamp is not from today
//   • render the whole caption red with a "stale" badge when any stream is
//     more than one scheduled slot (~3h) older than its expected latest slot
// So a frozen feed is now visually unmistakable.

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

// Same treatment for the date — used in the tooltip (always) and the caption
// itself when the stamp is not from today (bug #1028, so a frozen feed is
// visually obvious). Helps the user verify which weekday's 15:45 ET snapshot
// is showing after a weekend.
function formatETDate(isoString, opts) {
  if (!isoString) return null;
  const short = !!(opts && opts.short);
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", Object.assign({
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }, short ? {} : { year: "numeric" }));
  } catch {
    return null;
  }
}

// Return the calendar date portion ("YYYY-MM-DD") for a given ISO timestamp,
// evaluated in America/New_York. Used to decide whether the caption should
// print a date alongside the time (bug #1028 — "include the date whenever the
// last update is not today").
function etDateKey(isoOrDate) {
  if (!isoOrDate) return null;
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA gives the YYYY-MM-DD form natively for a stable key.
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch {
    return null;
  }
}

// Compute the timestamp of the most recent scheduled slot that *should* have
// fired by `now`. Slots fire at 10:00, 13:00, and 15:45 America/New_York on
// weekdays. Weekends and pre-market hours fall back to the previous weekday's
// 15:45 slot (the "last weekday's 15:45 ET run" called out in the preamble).
//
// Implementation note: we can't construct a Date directly in America/New_York
// from raw numeric parts without a timezone library, so instead we pick a
// candidate slot and walk backwards one calendar day at a time (in ET) until
// we find the latest slot that is at or before `now`. That keeps the whole
// helper self-contained while still being correct across DST transitions.
function expectedLatestSlotMs(now) {
  const _now = now || new Date();
  // ET offset for `_now`: difference between ET wall clock and UTC wall clock.
  const etNow = new Date(_now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utcNow = new Date(_now.toLocaleString("en-US", { timeZone: "UTC" }));
  const etOffsetMs = etNow.getTime() - utcNow.getTime(); // negative for ET

  const slotsHHMM = [
    { h: 15, m: 45 },
    { h: 13, m: 0 },
    { h: 10, m: 0 },
  ];
  const anchor = new Date(etNow.getTime()); // ET wall-clock anchor
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const probe = new Date(anchor.getTime());
    probe.setDate(probe.getDate() - dayOffset);
    const dow = probe.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    for (const s of slotsHHMM) {
      const etWall = new Date(
        probe.getFullYear(), probe.getMonth(), probe.getDate(),
        s.h, s.m, 0, 0
      );
      const utcMs = etWall.getTime() - etOffsetMs;
      if (utcMs <= _now.getTime()) return utcMs;
    }
  }
  return _now.getTime();
}

// A stream is stale when its stamp is more than two scheduled-slot widths
// (~6 hours) older than the expected latest slot. Bug #1133-10 — Joe saw
// "stale" badges on weekends when the data was correctly Friday's 15:45 ET
// snapshot but cron timing variance pushed the comparison over the original
// 3h threshold. Widening to ~6h keeps genuine multi-hour stalls flagged
// (the FRED + universe crons fire at most every 3h during market hours,
// so a >6h gap still indicates a real outage) while absorbing normal
// scheduling drift.
var SLOT_TOLERANCE_MS = 6 * 60 * 60 * 1000;

function isStreamStale(iso, now) {
  if (!iso) return false;
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return false;
  const expected = expectedLatestSlotMs(now || new Date());
  return expected - stamp > SLOT_TOLERANCE_MS;
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

  // Bug #1028 — date on caption when stamp is not from today, and red +
  // "stale" badge when any stream is more than one scheduled slot late.
  const now = new Date();
  const todayKey = etDateKey(now);
  const priceDateShort = (priceIso && etDateKey(priceIso) !== todayKey) ? formatETDate(priceIso, { short: true }) : null;
  const eventDateShort = (eventsTs && etDateKey(eventsTs) !== todayKey) ? formatETDate(eventsTs, { short: true }) : null;

  const priceStale = isStreamStale(priceIso, now);
  const eventStale = isStreamStale(eventsTs, now);
  const anyStale = priceStale || eventStale;

  // Bug #1079 — collapse the dual "Prices: 3x/day ... Events: 3x/day ..."
  // labels into a single "All data refreshed 3x daily · Updated HH:MM ET"
  // tagline. Both streams share the same 3x/weekday cadence, so showing them
  // separately was visual noise. Use the most recent stamp as the displayed
  // "Updated" time. Compact callers keep the per-stream pills.
  const segments = [];
  if (compact) {
    if (priceTime) {
      const datePart = priceDateShort ? priceDateShort + " · " : "";
      segments.push("Prices " + datePart + priceTime + " ET");
    }
    if (eventTime) {
      const datePart = eventDateShort ? eventDateShort + " · " : "";
      segments.push("Events " + datePart + eventTime + " ET");
    }
  } else {
    const priceMs = priceIso ? new Date(priceIso).getTime() : 0;
    const eventMs = eventsTs ? new Date(eventsTs).getTime() : 0;
    const latestIso = (eventMs > priceMs) ? eventsTs : priceIso;
    const latestTime = formatET(latestIso);
    const latestKey = etDateKey(latestIso);
    const latestDateShort = (latestKey && latestKey !== todayKey) ? formatETDate(latestIso, { short: true }) : null;
    const datePart = latestDateShort ? latestDateShort + " · " : "";
    segments.push("All data refreshed 3x daily · " + datePart + "Updated " + latestTime + " ET");
  }
  const caption = segments.join(" · ");

  const priceDate = formatETDate(priceIso);
  const eventDate = formatETDate(eventsTs);
  const titleParts = [];
  if (priceTime) {
    titleParts.push(priceDate
      ? ("Universe snapshot — " + priceDate + " " + priceTime + " ET.")
      : ("Universe snapshot — " + priceTime + " ET."));
  }
  if (eventTime) {
    titleParts.push(eventDate
      ? ("Ticker events — " + eventDate + " " + eventTime + " ET.")
      : ("Ticker events — " + eventTime + " ET."));
  }
  titleParts.push("Both refresh at 10:00, 13:00, and 15:45 ET on US trading days.");
  if (anyStale) {
    const which = (priceStale && eventStale) ? "both streams are" : priceStale ? "the prices stream is" : "the events stream is";
    titleParts.push("Stale: " + which + " more than one scheduled slot (~3h) late.");
  }
  const title = titleParts.join(" ");

  const staleColor = "var(--accent-red, #c0392b)";
  const badgeBg = "rgba(192, 57, 43, 0.12)";
  const badgeBorder = "rgba(192, 57, 43, 0.35)";

  return (
    <span
      title={title}
      style={{
        fontSize: 10,
        color: anyStale ? staleColor : "var(--text-muted)",
        fontWeight: anyStale ? 600 : undefined,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...style,
      }}
    >
      <span>{caption}</span>
      {anyStale && (
        <span
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "1px 5px",
            border: "1px solid " + badgeBorder,
            background: badgeBg,
            color: staleColor,
            borderRadius: 3,
            fontWeight: 700,
          }}
        >
          stale
        </span>
      )}
    </span>
  );
}
