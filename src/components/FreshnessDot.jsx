// FreshnessDot.jsx — 6-px chip that grades every data element on MacroTilt.
//
// Phase 4 PR #16 rebuild. Lead Developer + UX Designer + Data Steward
// + Senior Quant sign-off.
//
// What this is, post-PR-16
// ────────────────────────
// A tiny 6-px dot. GREEN when the element is operating within the SLA
// recorded in data_manifest.json. RED otherwise (stale, vendor pull
// errored, or any aggregate dependency rolled up red).
//
// Two states only — Joe sign-off 2026-05-01: "I dont trust the system
// yet, I want to see if the data is stale (RED), or if its operating
// within SLA (Green)." Amber is gone.
//
// Aggregate rollup is automatic. Pass an aggregate's name (e.g.
// "composite_rl") and the chip walks the manifest's dependencies array,
// returns red if any input is red, and the tooltip names the failing
// element.
//
// Tooltip copy
// ────────────
//   Green (atomic):    "Data feeds are operating within defined SLAs.
//                       Last refresh: 2026-05-01 16:30 ET"
//   Green (aggregate): same
//   Red (atomic):      "Stale: <element> hasn't refreshed since
//                       <ts> (X hours past due)."
//   Red (aggregate):   "Stale: this composite is red because of <input> —
//                       last refresh <ts>, X hours past due."
//   Red (calc-failed): "Stale: <element> hasn't recalculated since
//                       <ts> (last attempt errored: <reason>)."
//
// Backward-compatible API. Existing consumers pass:
//   <FreshnessDot indicatorId="vix" asOfIso={..} cadence="D"/>
// The cadence prop is now ignored — the manifest owns SLA + calendar.
// asOfIso is still honored as a fallback when pipeline_health doesn't
// have a row yet (first deploy / cold start).

import { useState } from "react";
import { useFreshness } from "../hooks/useFreshness";

const HUES = {
  green:   "#1f9d60",   // var(--tm-calm)
  red:     "#d23040",   // var(--tm-stressed)
  loading: "#9a9387",
};

function formatLastRefresh(iso) {
  if (!iso) return "never";
  // A date-only value (a data file's "as_of": "2026-05-20") is a calendar
  // day, NOT a timestamp — render it as a plain date with no timezone
  // conversion. Converting its implicit midnight-UTC into ET previously
  // rolled the displayed date back a day ("May 20" data showed as
  // "May 19 8:00 PM ET", which read as stale to the user). Fix 2026-05-21.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, mo, dy] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, dy)).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
  }
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "never";
  // Full timestamps keep NY-time formatting. Joe is in ET; this is the
  // user-facing display, not a wire format.
  const datePart = d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    timeZone: "America/New_York",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${datePart} ${timePart} ET`;
}

function relativeAge(iso) {
  if (!iso) return "never";
  const t = iso.length === 10 ? `${iso}T00:00:00Z` : iso;
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "just now";
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) {
    const mins = Math.max(1, Math.floor(ms / 60000));
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function hoursPastDue(lastGoodAt, slaHours, calendar) {
  if (!lastGoodAt || !slaHours) return null;
  // We measure the wall-clock elapsed and let the chip's tooltip use that as
  // the user-facing "X hours past due." (The internal STALE decision uses
  // the calendar-aware version — this number is the human-readable
  // wall-clock delta the user expects to see.)
  const t = lastGoodAt.length === 10 ? `${lastGoodAt}T00:00:00Z` : lastGoodAt;
  const elapsedH = (Date.now() - new Date(t).getTime()) / 3600000;
  if (!Number.isFinite(elapsedH)) return null;
  const past = elapsedH - slaHours;
  return past > 0 ? Math.round(past) : null;
}

// 2026-05-12 — Joe directive: tooltip copy answers the user's question
// plainly. NO internal element IDs (e.g. "v10_allocation"), NO jargon
// like "SLA" or "aggregate". The tooltip says one of three things:
//
//   - "Data is fresh — last updated <date>"
//   - "Data is stale — last updated <date> (X days ago)"
//   - "Data freshness unknown" (when the element isn't registered yet)
//
// The hook prefers dataAsOf (the actual trading day of the value); falls
// back to lastGoodAt (last successful cron run) when dataAsOf isn't set.
function buildTooltip(f) {
  if (f.loading) return "Checking data freshness…";
  // Prefer the actual data-as-of trading day; fall back to last successful
  // pipeline run. Either way the user gets a real timestamp, not an
  // internal element ID.
  const asOf = f.dataAsOf || f.lastGoodAt;
  if (f.missing && !asOf) {
    // Genuinely untracked. Don't expose the internal element name.
    return "Data freshness not yet tracked.";
  }
  if (f.status === "green") {
    if (!asOf) return "Data is fresh.";
    return `Data is fresh. Last updated ${formatLastRefresh(asOf)}.`;
  }
  // RED — the answer is "data is stale". Detail how stale + why if useful,
  // but keep the lead simple. Strip aggregate/input internals from the
  // user-facing line; we keep the dependency name only because it tells
  // the user which underlying feed broke.
  if (!asOf) {
    return "Data is stale. No successful refresh on record yet.";
  }
  const past = hoursPastDue(f.lastGoodAt || asOf, f.slaHours, f.calendar);
  // Pretty-print the age in days when it's > 24h; hours otherwise.
  const ageStr = past != null
    ? (past >= 48
        ? ` (${Math.round(past / 24)} days overdue)`
        : ` (${past} hours overdue)`)
    : "";
  if (f.cause?.kind === "input" && f.cause.element?.label) {
    return `Data is stale. Underlying ${f.cause.element.label} feed last updated ${formatLastRefresh(f.cause.element.lastGoodAt)}${ageStr}.`;
  }
  return `Data is stale. Last updated ${formatLastRefresh(asOf)}${ageStr}.`;
}

// Default click action: jump to the methodology README's freshness section,
// preserved from PR #14 era. Hosts can override via onExplain.
function defaultExplain() {
  if (typeof window === "undefined") return;
  window.location.hash = "readme";
  const scrollOnce = () => {
    const el = document.getElementById("freshness-explainer");
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "auto", block: "start" });
      return true;
    }
    return false;
  };
  setTimeout(scrollOnce, 80);
  setTimeout(scrollOnce, 350);
  setTimeout(scrollOnce, 800);
}

export default function FreshnessDot({
  indicatorId,
  onExplain,
  size = 6,
  style,
  title,            // optional override of the computed tooltip
  showRing = false,
  asOfIso,          // backward-compat fallback when pipeline_health is empty
  cadence,          // legacy — ignored; manifest owns SLA + calendar
  source,           // optional
  label,            // optional
}) {
  const f = useFreshness(indicatorId, { asOfIso });
  const [hover, setHover] = useState(false);

  // Two-state visual. Loading + missing fall back to neutral grey.
  const visualKey = f.status === "green" || f.status === "red" ? f.status : "loading";
  const color = HUES[visualKey];
  const tip = title || buildTooltip(f);
  const explain = typeof onExplain === "function" ? onExplain : defaultExplain;
  const clickable = true;

  const handleClick = (e) => {
    e.stopPropagation();
    explain(f);
  };

  return (
    <span
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(e); }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`Data freshness: ${f.status}. ${tip}`}
      title={tip}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        cursor: clickable ? "pointer" : "help",
        boxShadow:
          showRing || hover
            ? `0 0 0 ${Math.max(1.5, size * 0.35)}px ${color}28`
            : "none",
        transition: "box-shadow 0.12s ease-out",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// Convenience export — dot + plain-English status label.
export function FreshnessDotLabel({ indicatorId, onExplain }) {
  const f = useFreshness(indicatorId);
  const word = {
    green: "Fresh", red: "Stale", loading: "Checking", missing: "—",
  }[f.status] || "—";
  const rel = f.lastGoodAt ? relativeAge(f.lastGoodAt) : "";
  const color = HUES[f.status === "green" || f.status === "red" ? f.status : "loading"];

  return (
    <span
      role={onExplain ? "button" : undefined}
      onClick={onExplain ? () => onExplain(f) : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontFamily: "var(--font-mono, monospace)",
        color: "var(--text-muted)",
        cursor: onExplain ? "pointer" : "default",
      }}
      title={buildTooltip(f)}
    >
      <FreshnessDot indicatorId={indicatorId} onExplain={onExplain} />
      <span style={{ color }}>{word}</span>
      {rel && <span>· {rel}</span>}
    </span>
  );
}
