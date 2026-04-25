// FreshnessDot.jsx — 6px RAG dot that tells you whether the data you're
// looking at is fresh, overdue, or stale. Click → jumps to the Methodology
// README's "Data freshness" section.
//
// MacroTilt brand notes (UX Designer sign-off 2026-04-24)
//   • 6px circle. Ornamental weight — doesn't dominate.
//   • Semantic hues match the rest of the app (reuse --tm-calm / --tm-elevated
//     / --tm-stressed token values where possible, local hex as fallback).
//   • Hover → plain-English tooltip with cadence + last-update + source.
//   • Click → calls onExplain() which the host wires to nav-to-readme.
//   • On mobile / no-hover devices the tooltip renders on tap before nav.
//
// No acronyms in user-facing copy — "updates daily", "last refreshed 2 days
// ago", never "1x cadence" / "RAG".
//
import { useState } from "react";
import { useFreshness } from "../hooks/useFreshness";

const HUES = {
  green:   "#1f9d60",   // var(--tm-calm)
  amber:   "#b8811c",   // var(--tm-elevated)
  red:     "#d23040",   // var(--tm-stressed)
  loading: "#bbb4a3",   // parchment-compatible loading grey
  unknown: "#bbb4a3",
};

const CADENCE_ENGLISH = {
  D: "updates daily",
  W: "updates weekly",
  M: "updates monthly",
  Q: "updates quarterly",
};

function formatRelative(iso) {
  if (!iso) return "never";
  const then = new Date(iso);
  if (Number.isNaN(+then)) return "never";
  const diffMs = Date.now() - then.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function buildTooltip(f) {
  if (f.loading)  return "Checking data freshness…";
  if (f.missing)  return `Freshness status not yet tracked for this indicator.`;
  const cad     = CADENCE_ENGLISH[f.cadence] || "updates on a variable schedule";
  const lastGood = formatRelative(f.lastGoodAt);
  const source   = f.source ? ` · ${f.source}` : "";
  switch (f.status) {
    case "green":
      return `Fresh — ${cad}, last refreshed ${lastGood}${source}. Click for details.`;
    case "amber":
      return `Overdue — ${cad}, last refreshed ${lastGood}${source}. May be a release-schedule lag. Click for details.`;
    case "red":
      return `Stale — ${cad}, last refreshed ${lastGood}${source}.${f.lastError ? ` Error: ${f.lastError}` : ""} Click for details.`;
    default:
      return `${cad}, last refreshed ${lastGood}${source}.`;
  }
}

export default function FreshnessDot({
  indicatorId,
  onExplain,
  size = 6,
  style,
  title,            // optional override of the computed tooltip
  showRing = false, // subtle halo for emphasis on composite cards
}) {
  const fresh = useFreshness(indicatorId);
  const [hover, setHover] = useState(false);

  const color = HUES[fresh.status] || HUES.unknown;
  const tip   = title || buildTooltip(fresh);
  const clickable = typeof onExplain === "function";

  const handleClick = (e) => {
    if (!clickable) return;
    e.stopPropagation();
    onExplain(fresh);
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
      aria-label={`Data freshness: ${fresh.status}. ${tip}`}
      title={tip}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        cursor: clickable ? "pointer" : "help",
        // Subtle halo on hover / composite emphasis
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

// Convenience export — renders a dot + plain-English status label
// (e.g. "Fresh · 2 minutes ago"). Used on composite dial cards on Today's
// Macro where a bare dot would be cryptic.
export function FreshnessDotLabel({ indicatorId, onExplain }) {
  const fresh = useFreshness(indicatorId);
  const word = {
    green: "Fresh", amber: "Overdue", red: "Stale",
    loading: "Checking", unknown: "—",
  }[fresh.status] || "—";
  const rel = fresh.lastGoodAt ? formatRelative(fresh.lastGoodAt) : "";
  const color = HUES[fresh.status] || HUES.unknown;

  return (
    <span
      role={onExplain ? "button" : undefined}
      onClick={onExplain ? () => onExplain(fresh) : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontFamily: "var(--font-mono, monospace)",
        color: "var(--text-muted, #888)",
        cursor: onExplain ? "pointer" : "default",
      }}
      title={buildTooltip(fresh)}
    >
      <FreshnessDot indicatorId={indicatorId} onExplain={onExplain} />
      <span style={{ color }}>{word}</span>
      {rel && <span>· {rel}</span>}
    </span>
  );
}
