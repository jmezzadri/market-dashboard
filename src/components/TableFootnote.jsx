// TableFootnote — caption that sits UNDER a price-reading table.
//
// Joe directive 2026-05-04: the footnote must indicate WHEN THE DATA IS FROM,
// not when a script ran. A timestamp like "Updated 4:06 PM ET" reads as
// "the prices are current as of 4:06 PM" — but in reality post-close data is
// always "today's 4:00 PM ET close, refreshed sometime after that," and
// post-midnight data may be a Yahoo one-shot stand-in until the upstream
// vendor publishes (Polygon's Basic tier publishes today's data at midnight
// ET, ~8 hours after close). Rather than expose that mechanic, the caption
// states the trading session the data represents.
//
// Caption shape (matches UniverseFreshness wording in the section header):
//
//   Prices: latest close · Mon, May 4, 2026 · Source: Yahoo Finance + Unusual Whales
//
// Degradations:
//   - If neither caption is set and no source is provided, renders null.
//   - Caller is responsible for computing the trading-session label using
//     the latestTradingSessionDate() / formatTradingDayLabel() helpers in
//     freshnessClock — the footnote does not invent dates.

import React from "react";

/**
 * @param {object} props
 * @param {string|null|undefined} props.priceCaption  Full caption for the prices segment
 *   (e.g. "Prices: latest close · Mon, May 4, 2026"). Caller computes; the
 *   footnote does not interpret. Pass `null` to omit the segment.
 * @param {string|null|undefined} props.eventsCaption Full caption for the events segment.
 *   Pass `null` to omit (e.g. when the table does not surface event data).
 * @param {string}                [props.source]    Upstream data source label.
 * @param {React.CSSProperties}   [props.style]     Caller overrides merged on top of default style.
 */
export default function TableFootnote({ priceCaption, eventsCaption, source, style }) {
  if (!priceCaption && !eventsCaption && !source) return null;

  const segments = [];
  if (priceCaption)  segments.push(priceCaption);
  if (eventsCaption) segments.push(eventsCaption);
  if (source)        segments.push(`Source: ${source}`);
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
