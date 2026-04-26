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
  loading: "#9a9387",   // visible on parchment AND dark
  unknown: "#9a9387",
};

// Cadence (D/W/M/Q) → minutes until amber and red, including release-time
// tolerances calibrated to FRED/FDIC release schedules. These mirror the
// edge function's `expected_cadence_minutes + CADENCE_TOLERANCE_MINUTES`.
const CADENCE_LIMITS = {
  D: 1440 + 360,    // 1d + 6h grace
  W: 10080 + 2880,  // 7d + 48h
  M: 43200 + 14400, // 30d + 10d
  Q: 129600 + 43200,// 90d + 30d
};

// ── Bug #1037 — US market-calendar awareness for daily cadence ──────────────
// Anchors `daily` series to the actual NYSE close (4pm ET, or 1pm ET on
// half-days), not midnight UTC. This keeps the dot green over normal weekend
// mornings and around US market holidays. Holiday list is hand-baked through
// 2028; refresh annually before the new-year roll.
const NYSE_HOLIDAYS = new Set([
  // 2024
  "2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27",
  "2024-06-19","2024-07-04","2024-09-02","2024-11-28","2024-12-25",
  // 2025
  "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-04-18",
  "2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25",
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
  // 2028
  "2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19",
  "2028-07-04","2028-09-04","2028-11-23","2028-12-25",
]);
// Half-day closes — NYSE closes at 1pm ET (instead of 4pm ET).
const NYSE_EARLY_CLOSES = new Set([
  "2024-07-03","2024-11-29","2024-12-24",
  "2025-07-03","2025-11-28","2025-12-24",
  "2026-11-27","2026-12-24",
  "2027-07-02","2027-11-26","2027-12-23",
]);
function _isWeekendUTC(d) {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}
function _inUSDST(d) {
  // 2nd Sunday in March → 1st Sunday in November (US DST window)
  const y = d.getUTCFullYear();
  const start = new Date(Date.UTC(y, 2, 1));
  while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCDate(start.getUTCDate() + 7);
  const end = new Date(Date.UTC(y, 10, 1));
  while (end.getUTCDay() !== 0) end.setUTCDate(end.getUTCDate() + 1);
  return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
}
function _isoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function _tradingCloseMs(d) {
  // Returns the close-time millis for date d if d is a trading day, else null.
  // 4pm ET → 20:00 UTC standard / 21:00 UTC during DST.
  // 1pm ET → 17:00 UTC standard / 18:00 UTC during DST.
  if (_isWeekendUTC(d)) return null;
  const iso = _isoDate(d);
  if (NYSE_HOLIDAYS.has(iso)) return null;
  const dst = _inUSDST(d);
  const earlyClose = NYSE_EARLY_CLOSES.has(iso);
  const utcHour = earlyClose ? (dst ? 18 : 17) : (dst ? 21 : 20);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utcHour, 0, 0);
}
function _nextTradingClose(afterMs) {
  let d = new Date(afterMs);
  for (let i = 0; i < 14; i++) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    const c = _tradingCloseMs(d);
    if (c != null) return c;
  }
  return null;
}

// Client-side RAG derivation for the case where pipeline_health hasn't been
// populated yet (first deploy, edge fn cold start, missing migration). Uses
// the AS_OF date already on the page and the indicator's release cadence.
// Returns null if we can't derive (no asOf or no cadence).
function deriveStatusFromAsOf(asOfIso, cadence) {
  if (!asOfIso || !cadence) return null;
  // Bug #1037 — daily cadence: anchor to the NYSE close on the asOf date,
  // not midnight UTC. Compare current time against the *next expected*
  // trading-day close + grace, so weekend mornings and holiday closures
  // don't paint amber when the data is as fresh as it can be.
  if (cadence === "D") {
    const datePart = asOfIso.slice(0, 10);
    const parts = datePart.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [y, m, d] = parts;
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const lastClose = _tradingCloseMs(dateObj);
    if (lastClose == null) return null;
    const nextClose = _nextTradingClose(lastClose);
    if (nextClose == null) return null;
    const grace = 4 * 60 * 60 * 1000; // 4h after next close — vendor delivery window
    const now = Date.now();
    const ageMin = Math.max(0, Math.round((now - lastClose) / 60000));
    if (now <= nextClose + grace) return { status: "green", ageMin };
    const nextNext = _nextTradingClose(nextClose);
    if (nextNext != null && now <= nextNext + grace) return { status: "amber", ageMin };
    return { status: "red", ageMin };
  }
  const t = new Date(asOfIso + (asOfIso.length === 10 ? "T00:00:00Z" : "")).getTime();
  if (Number.isNaN(t)) return null;
  const ageMin = Math.max(0, Math.round((Date.now() - t) / 60000));
  const limit = CADENCE_LIMITS[cadence];
  if (!limit) return null;
  if (ageMin <= limit)         return { status: "green", ageMin };
  if (ageMin <= limit * 2)     return { status: "amber", ageMin };
  return { status: "red", ageMin };
}

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

// Default click action — jump to the README's freshness section.
// Hosts can override via the onExplain prop (e.g. open a sheet).
//
// Why this is more elaborate than a one-shot setTimeout:
// React's tab swap re-renders the page, the Methodology page mounts heavy
// children, and during that mount window scrollY can get reset to 0 by
// competing layout effects. We schedule THREE scroll attempts at 80 / 350 /
// 800 ms — once each time the explainer has rendered. Uses "auto" (instant)
// to avoid the smooth-scroll-being-cancelled class of bug.
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
  // Three timed attempts cover: synchronous render, post-effect, post-paint.
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
  showRing = false, // subtle halo for emphasis on composite cards
  asOfIso,          // client-side fallback: ISO date string when pipeline_health is empty
  cadence,          // client-side fallback: D/W/M/Q
  source,           // optional: shown in tooltip when fallback is active
  label,            // optional: shown in tooltip when fallback is active
}) {
  const fresh = useFreshness(indicatorId);
  const [hover, setHover] = useState(false);

  // Prefer whichever side sees FRESHER data.
  //   • If pipeline_health has no row, or is loading → fall back to client-side.
  //   • If pipeline_health exists but the client's asOfIso is strictly MORE
  //     recent than the server's last_good_at, trust the client (this is what
  //     fires on a preview deploy whose JSON is newer than prod, or on any
  //     surface where a recent refresh hasn't been picked up by the edge fn
  //     on its 30-min cadence yet).
  //   • Otherwise, the server row wins (authoritative for silent-failure
  //     detection across users).
  let derived = fresh;
  if (asOfIso && cadence) {
    const serverTs = fresh.lastGoodAt ? new Date(fresh.lastGoodAt).getTime() : 0;
    const clientTs = new Date(asOfIso + (asOfIso.length === 10 ? "T00:00:00Z" : "")).getTime();
    const clientIsFresher =
      !fresh.lastGoodAt || (Number.isFinite(clientTs) && clientTs > serverTs);
    const needsFallback =
      fresh.status === "loading" ||
      fresh.status === "unknown" ||
      clientIsFresher;
    if (needsFallback) {
      const fb = deriveStatusFromAsOf(asOfIso, cadence);
      if (fb) {
        derived = {
          ...fresh,
          status: fb.status,
          loading: false,
          missing: false,
          lastGoodAt: asOfIso,
          cadence,
          cadenceMinutes: CADENCE_LIMITS[cadence],
          source: source || fresh.source,
          label: label || fresh.label,
        };
      }
    }
  }

  const color = HUES[derived.status] || HUES.unknown;
  const tip   = title || buildTooltip(derived);
  const explain = typeof onExplain === "function" ? onExplain : defaultExplain;
  const clickable = true;

  const handleClick = (e) => {
    e.stopPropagation();
    explain(derived);
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
      aria-label={`Data freshness: ${derived.status}. ${tip}`}
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
