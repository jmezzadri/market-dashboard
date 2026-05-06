// DataFreshness — single-line consolidated freshness for surfaces that read
// multiple feeds. Replaces the historical mix of "Daily scan · Last run …",
// the section-header UniverseFreshness chip, the inline scanLabel, and the
// orange "VERY STALE" banner with one honest line:
//
//   Data freshness · Scan: today 10:49 AM ET · Prices: today 4:03 PM ET · Events: today 4:07 PM ET
//
// Stale streams render in red with the trading-day reason instead of a
// time-of-day, e.g.:
//
//   Scan: Mon, May 4 (2 trading days ago — daily scan may have failed)
//
// If any stream is stale, the line is amber-tinted; otherwise muted.
// Each stream is optional — pass null/undefined to hide that segment.
//
// Calendar age uses NYSE trading-day math from freshnessClock so weekends
// and NYSE holidays don't false-alarm a Monday morning view of Friday's data.
//
// Joe directive 2026-05-06: Trading Opps had four overlapping freshness
// labels (this component replaces all four on that surface).

import React from "react";
import { ageHoursAgainstCalendar } from "../lib/freshnessClock";

const STREAM_DEFAULTS = {
  scan:   { label: "Scan",   staleHours: 24, staleReason: "daily scan may have failed" },
  prices: { label: "Prices", staleHours: 24, staleReason: "prices feed may have failed" },
  events: { label: "Events", staleHours: 24, staleReason: "events feed may have failed" },
};

function fmtETTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch { return null; }
}
function fmtETDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short", month: "short", day: "numeric",
    });
  } catch { return null; }
}
function etDateKey(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA gives the YYYY-MM-DD form natively for a stable key.
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch { return null; }
}

export default function DataFreshness({ scanTs, pricesTs, eventsTs, style }) {
  const streams = [
    { key: "scan",   ts: scanTs },
    { key: "prices", ts: pricesTs },
    { key: "events", ts: eventsTs },
  ].filter(s => s.ts);

  if (!streams.length) return null;

  const todayKey = etDateKey(new Date().toISOString());
  const items = streams.map(({ key, ts }) => {
    const cfg = STREAM_DEFAULTS[key];
    const ageH = ageHoursAgainstCalendar(ts, "nyse-trading-day");
    const isStale = ageH != null && ageH >= cfg.staleHours;
    const sameDay = etDateKey(ts) === todayKey;

    let detail;
    if (isStale) {
      const days = Math.floor(ageH / 24);
      const dayLabel = fmtETDate(ts) || "—";
      const ago = days <= 0
        ? `${Math.round(ageH)} trading hours ago`
        : `${days} trading day${days === 1 ? "" : "s"} ago`;
      detail = `${dayLabel} (${ago} — ${cfg.staleReason})`;
    } else if (sameDay) {
      detail = `today ${fmtETTime(ts) || ""} ET`;
    } else {
      detail = `${fmtETDate(ts) || ""} ${fmtETTime(ts) || ""} ET`;
    }
    return { label: cfg.label, detail, isStale };
  });

  const anyStale = items.some(x => x.isStale);

  return (
    <div
      data-testid="data-freshness"
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        padding: "8px 12px",
        borderRadius: 6,
        border: anyStale
          ? "1px solid rgba(255,159,10,0.35)"
          : "1px solid var(--border-faint)",
        background: anyStale ? "rgba(255,159,10,0.06)" : "transparent",
        color: anyStale ? "var(--orange-text)" : "var(--text-muted)",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: 4,
        columnGap: 8,
        ...style,
      }}
    >
      <span style={{ color: "var(--text-dim)", fontWeight: 700, letterSpacing: "0.08em" }}>
        DATA FRESHNESS
      </span>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>·</span>
          <span style={{ color: it.isStale ? "var(--orange-text)" : "var(--text)" }}>
            <strong style={{ fontWeight: 700 }}>{it.label}:</strong>{" "}
            <span style={{ fontWeight: 400 }}>{it.detail}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
