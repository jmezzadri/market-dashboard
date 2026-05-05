// TableFootnote — compact caption under a price-reading table.
//
// As-of-2026-05-04: Joe directive. The "Prices: Updated 4:06 PM ET"
// stamp this used to show was misleading — it reflected scan time or
// page-load time, not the actual price data date. Now displays:
//
//   Prices as of May 1 2026 (Fri) · 3 days ago · Source: ...
//   [GREEN/AMBER/RED chip based on age vs latest weekday]
//
// The age chip rules (by weekday-only diff between today and the data
// date — weekends don't count):
//   GREEN  : age 0 weekdays (data is from the most recent trading day)
//   AMBER  : age 1 weekday (data is one trading day stale — usually
//            the case during market hours before Polygon publishes
//            today's close at midnight ET)
//   RED    : age >= 2 weekdays (data is meaningfully stale — pipeline
//            problem)

import React from "react";

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

// Count weekdays (Mon-Fri) strictly between two dates, excluding both endpoints.
// Returns the number of trading days between the data date and "now" so a
// price from Friday viewed on Monday is 0 (no trading days passed) until
// Tuesday morning, when it becomes 1, etc.
function weekdaysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to <= from) return 0;
  let count = 0;
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d < to) {
    const day = d.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function todayLocalDateStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatTradeDate(isoDate) {
  if (!isoDate) return null;
  try {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", weekday: "short" });
  } catch {
    return isoDate;
  }
}

/**
 * @param {object} props
 * @param {string|null} [props.pricesAsOfDate]  YYYY-MM-DD trade_date from prices_eod max — the actual data date, NOT scan time
 * @param {string|null} [props.pricesTs]         (Legacy) ISO timestamp of last scan; used as fallback when pricesAsOfDate not supplied
 * @param {string|null} [props.eventsTs]         ISO timestamp of last events scan
 * @param {string}      [props.source]
 * @param {React.CSSProperties} [props.style]
 */
export default function TableFootnote({ pricesAsOfDate, pricesTs, eventsTs, source, style }) {
  const eventTime = formatET(eventsTs);

  // Compute freshness chip when we have an actual price data date.
  let chip = null;
  let pricesSegment = null;
  if (pricesAsOfDate) {
    const ageDays = weekdaysBetween(pricesAsOfDate, todayLocalDateStr());
    let chipColor, chipBg, chipLabel;
    if (ageDays == null || ageDays === 0) {
      chipColor = "#137333"; chipBg = "#13733314"; chipLabel = "FRESH";
    } else if (ageDays === 1) {
      chipColor = "#a85d00"; chipBg = "#a85d0014"; chipLabel = "1 DAY OLD";
    } else {
      chipColor = "#9a1f1f"; chipBg = "#9a1f1f14"; chipLabel = ageDays + " DAYS OLD";
    }
    chip = (
      <span style={{ display: "inline-block", padding: "1px 6px", marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: chipColor, background: chipBg, border: "1px solid " + chipColor + "44", borderRadius: 3 }}>
        {chipLabel}
      </span>
    );
    pricesSegment = "Prices as of " + formatTradeDate(pricesAsOfDate);
  } else if (pricesTs) {
    const t = formatET(pricesTs);
    if (t) pricesSegment = "Prices: Updated " + t + " ET";
  }

  if (!pricesSegment && !eventTime && !source) return null;

  const segments = [];
  if (pricesSegment) segments.push(pricesSegment);
  if (eventTime) segments.push("Events: Updated " + eventTime + " ET");
  if (source)    segments.push("Source: " + source);

  return (
    <div
      data-testid="table-footnote"
      style={{
        fontSize: 10,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        padding: "8px 4px 2px 4px",
        lineHeight: 1.5,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        ...style,
      }}
    >
      <span>{segments.join(" · ")}</span>
      {chip}
    </div>
  );
}
