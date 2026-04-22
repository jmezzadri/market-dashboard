// TableFootnote — a compact caption that sits UNDER a price-reading table.
// Task #25, natural follow-on to the Task #24 DataFreshness chip. The chip in
// the section HEADER is fine for short viewports, but a 20-row Positions
// table can push the header off-screen; users scrolling the table lose the
// "prices from HH:MM ET" context. This footnote keeps that context attached
// to the table itself.
//
// Shape of the caption (matches the UniverseFreshness wording so header and
// footnote read consistently):
//
//   Prices: Updated 3:45 PM ET · Events: Updated 3:45 PM ET · Source: Unusual Whales + Yahoo Finance
//
// Degradations:
//   - If neither timestamp is set (signed-out view), the entire component
//     renders null — no placeholder, no nag. Matches UniverseFreshness.
//   - If only one timestamp is set, that segment renders alone.
//   - If `source` is omitted, the "Source:" segment is dropped.

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

/**
 * @param {object} props
 * @param {string|null|undefined} props.pricesTs  ISO timestamp from the universe snapshot.
 * @param {string|null|undefined} props.eventsTs  ISO timestamp from the ticker events snapshot.
 * @param {string}                [props.source]  Upstream data source (e.g. "Unusual Whales + Yahoo Finance"). Optional.
 * @param {React.CSSProperties}   [props.style]   Caller overrides merged on top of the default caption style.
 */
export default function TableFootnote({ pricesTs, eventsTs, source, style }) {
  const priceTime = formatET(pricesTs);
  const eventTime = formatET(eventsTs);

  // No freshness signal + no source → nothing meaningful to render.
  if (!priceTime && !eventTime && !source) return null;

  const segments = [];
  if (priceTime) segments.push(`Prices: Updated ${priceTime} ET`);
  if (eventTime) segments.push(`Events: Updated ${eventTime} ET`);
  if (source)    segments.push(`Source: ${source}`);
  const caption = segments.join(" · ");

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
        ...style,
      }}
    >
      {caption}
    </div>
  );
}
