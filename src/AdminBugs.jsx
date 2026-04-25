// AdminBugs — admin-only bug triage dashboard.
//
// Phase 1 (this file): READ-ONLY. Shows every row in public.bug_reports
// with summary counts, filter pills, sortable-ish table, and a side panel
// with full detail (description, console errors, screenshot, proposed fix,
// triage notes, activity log).
//
// Phase 2 (later): interactive approve / reject / set complexity / add
// notes. Phase 3: webhook-driven deployed_at auto-fill, reopen action.
//
// Data: public.bug_reports (RLS gated on public.is_admin(), migration 013).
// Screenshots: storage bucket `bug-screenshots` via signed URL.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { useBugReports, useBugStatusLog } from "./hooks/useBugReports";
import { useBugActions } from "./hooks/useBugActions";
import WorkflowTimeline from "./components/WorkflowTimeline";

// ── Status model (migration 013) ───────────────────────────────────────────
// Main pipeline: new → triaged → awaiting_approval → approved → merged
//                → deployed → verified_closed ↔ reopened
// Side branches: wontfix, duplicate, needs_info
//
// Legacy aliases (still valid until migration 014 tightens the CHECK) are
// mapped to their v2 equivalents for display / filtering so the UI stays
// clean even if an edge function writes the old value.
const LEGACY_ALIAS = {
  received:      "new",
  investigating: "triaged",
  "fix-proposed":"awaiting_approval",
  skipped:       "new",
  dismissed:     "wontfix",
  "wont-fix":    "wontfix",
  "needs-info":  "needs_info",
  fixed:         "verified_closed",
  resolved:      "verified_closed",
};
function normStatus(s) { return LEGACY_ALIAS[s] || s || "new"; }

const STATUS_META = {
  new:               { label: "New",               color: "#60a5fa", group: "open" },
  triaged:           { label: "Triaged",           color: "#a78bfa", group: "open" },
  awaiting_approval: { label: "Awaiting approval", color: "#B8860B", group: "awaiting_approval" },
  approved:          { label: "Approved",          color: "#f59e0b", group: "in_flight" },
  merged:            { label: "Merged",            color: "#34d399", group: "in_flight" },
  deployed:          { label: "Deployed",          color: "#10b981", group: "in_flight" },
  verified_closed:   { label: "Closed",            color: "#6b7280", group: "closed" },
  reopened:          { label: "Reopened",          color: "#ef4444", group: "open" },
  wontfix:           { label: "Won't fix",         color: "#475569", group: "wontfix" },
  duplicate:         { label: "Duplicate",         color: "#475569", group: "wontfix" },
  needs_info:        { label: "Needs info",        color: "#475569", group: "wontfix" },
};
function statusLabel(raw) { const m = STATUS_META[normStatus(raw)]; return m?.label || raw; }
function statusColor(raw) { const m = STATUS_META[normStatus(raw)]; return m?.color || "#9ca3af"; }
function statusGroup(raw) { const m = STATUS_META[normStatus(raw)]; return m?.group || "open"; }

// Detect "state desync" — the row's authoritative status disagrees with
// what the denormalised lifecycle stamps imply. Surfaced as a small amber
// chip next to the status badge so the next #1020-style incident is
// obvious from the bug list instead of requiring a click into the panel.
// Logic: each status has an EXPECTED set of stamps that must be
// present (and a set that must NOT be present). A violation = desync.
const STAMP_EXPECT = {
  new:               { must: [],                                         mustNot: ["triaged_at", "awaiting_approval_at", "approved_at", "merged_at", "deployed_at", "verified_at"] },
  triaged:           { must: ["triaged_at"],                              mustNot: ["awaiting_approval_at", "approved_at", "merged_at", "deployed_at", "verified_at"] },
  awaiting_approval: { must: ["awaiting_approval_at"],                    mustNot: ["approved_at", "merged_at", "deployed_at", "verified_at"] },
  approved:          { must: ["approved_at"],                             mustNot: ["merged_at", "deployed_at", "verified_at"] },
  merged:            { must: ["merged_at"],                               mustNot: ["deployed_at", "verified_at"] },
  deployed:          { must: ["deployed_at"],                             mustNot: ["verified_at"] },
  verified_closed:   { must: ["verified_at"],                             mustNot: [] },
  // reopened + terminal side-branches don't warrant desync alarms —
  // their stamp shape is by-design heterogeneous.
};
function desyncReasons(row) {
  const s = normStatus(row.status);
  const rule = STAMP_EXPECT[s];
  if (!rule) return null;
  const problems = [];
  // merged_at has a legacy fallback on fixed_at; verified_at on resolved_at.
  const stampFor = (k) => {
    if (k === "merged_at")   return row.merged_at   || row.fixed_at;
    if (k === "verified_at") return row.verified_at || row.resolved_at;
    if (k === "triaged_at")  return row.triaged_at  || row.last_triaged_at;
    return row[k];
  };
  for (const k of rule.must) {
    if (!stampFor(k)) problems.push(`missing ${k}`);
  }
  for (const k of rule.mustNot) {
    if (stampFor(k)) problems.push(`unexpected ${k}`);
  }
  return problems.length ? problems : null;
}

function DesyncChip({ reasons }) {
  if (!reasons || !reasons.length) return null;
  const tip = `Status/stamp desync:\n· ${reasons.join("\n· ")}\n\nThe 'status' column is authoritative. Lifecycle stamps should be re-aligned either by re-firing the correct action on this bug or with a direct SQL update.`;
  return (
    <span
      title={tip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 10, fontFamily: "monospace", fontWeight: 700,
        color: "#B8860B", padding: "1px 5px", borderRadius: 3,
        border: "1px solid #B8860B", background: "rgba(184,134,11,0.10)",
        textTransform: "uppercase", letterSpacing: "0.08em",
        marginLeft: 6, cursor: "help",
      }}>
      ⚠ desync
    </span>
  );
}

// ── Bucket logic (row-level, not status-level) ────────────────────────────
// The old "merged" tab lumped together three very different things: Claude's
// in-flight pipeline AND bugs already deployed that are waiting for Joe to
// click Close. Those are TWO queues, not one. Split them here based on
// uat_mode:
//   - deployed + uat_mode='manual' → "needs_uat"  (Joe's queue)
//   - everything else in the in_flight group      → "in_flight"  (automated)
function bugBucket(row) {
  const s = normStatus(row?.status);
  if (s === "deployed" && (row?.uat_mode || "manual") === "manual") return "needs_uat";
  return statusGroup(s);
}

const FILTER_PILLS = [
  { id: "all",                label: "All" },
  { id: "open",               label: "Open" },
  { id: "awaiting_approval",  label: "Awaiting approval" },
  { id: "needs_uat",          label: "Needs your UAT" },
  { id: "in_flight",          label: "In flight" },
  { id: "closed",             label: "Closed" },
  { id: "wontfix",            label: "Wont fix" },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function etDateShort(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
  } catch { return ""; }
}
function etDateTime(iso) {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    return `${date} · ${time} ET`;
  } catch { return ""; }
}
function ageText(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "0m";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const mons = Math.floor(days / 30);
  return `${mons}mo`;
}
function shortTitle(r) {
  const raw = (r.title || r.description || "").trim();
  if (!raw) return "(no description)";
  const first = raw.split(/\r?\n/)[0];
  return first.length > 80 ? first.slice(0, 80) + "…" : first;
}
function whereText(r) {
  if (r.url_hash) return r.url_hash;
  try {
    const u = new URL(r.url_full || "");
    return u.hash || u.pathname;
  } catch { return "—"; }
}
function complexityColor(c) {
  if (c === "H") return "#ef4444";
  if (c === "M") return "#B8860B";
  if (c === "L") return "#34d399";
  return "var(--text-muted)";
}

// ── Small UI atoms ─────────────────────────────────────────────────────────
// KpiTile doubles as a filter button — clicking selects its bucket. When
// `active` is true, the tile gets an accent border + tinted background so
// the current filter is unambiguous. The separate filter-pill row below the
// strip was removed on the tile-first redesign (2026-04-24).
function KpiTile({ label, value, sub, tone, active, onClick }) {
  const toneColor = tone === "good" ? "#34d399" : tone === "warn" ? "#B8860B" : tone === "bad" ? "#ef4444" : "var(--text)";
  const borderColor = active ? "var(--accent, #2563eb)" : "var(--border)";
  const bg = active ? "rgba(37, 99, 235, 0.06)" : "var(--surface)";
  return (
    <button
      type="button"
      onClick={onClick}
      title={onClick ? `Filter to ${label}` : undefined}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        boxShadow: active ? "0 0 0 1px var(--accent, #2563eb)" : "none",
        transition: "background 120ms, border-color 120ms, box-shadow 120ms",
        fontFamily: "inherit",
        color: "inherit",
        width: "100%",
      }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: toneColor, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>}
    </button>
  );
}

function StatusBadge({ status }) {
  const color = statusColor(status);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color, display: "inline-block" }} />
      {statusLabel(status)}
    </span>
  );
}

function ComplexityBadge({ value }) {
  if (!value) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  return (
    <span style={{ display: "inline-block", minWidth: 18, textAlign: "center", padding: "1px 6px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", borderRadius: 4, border: `1px solid ${complexityColor(value)}`, color: complexityColor(value), background: "transparent" }}>
      {value}
    </span>
  );
}

// Whose-queue badge — surfaces uat_mode so it's obvious who owns the next
// step on a deployed bug. Manual = Joe (must click through + Close). Auto =
// Claude-in-Chrome auto-UAT. Only rendered once a bug is deployed; before
// that the workflow stamps already tell the story.
function UatModeBadge({ row }) {
  const s = normStatus(row?.status);
  if (s !== "deployed") return null;
  const mode = (row?.uat_mode || "manual").toLowerCase();
  const isManual = mode === "manual";
  const color = isManual ? "#B8860B" : "#60a5fa";
  const label = isManual ? "UAT: you" : "UAT: auto";
  return (
    <span
      title={isManual
        ? "Deployed to prod. Waiting for you to click through + hit Close."
        : "Deployed to prod. Auto-UAT will verify and close this on its next sweep."}
      style={{
        display: "inline-block",
        padding: "1px 6px",
        marginLeft: 6,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "monospace",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        background: "transparent",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        verticalAlign: "middle",
      }}>
      {label}
    </span>
  );
}

// NB: the old <FilterPills/> component was removed on 2026-04-24 — the KPI
// tiles above now double as the filter UI (click a tile to filter, click
// "All" to clear). FILTER_PILLS is still used below for label lookup in
// the active-filter readout.

// ── Bug row table ─────────────────────────────────────────────────────────
function BugTable({ rows, selectedId, onSelect }) {
  if (!rows?.length) {
    return (
      <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}>
        No bugs in this filter.
      </div>
    );
  }
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "70px 90px 180px 1fr 110px 60px 140px 110px 60px", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        <div>#</div>
        <div>Raised</div>
        <div>Reporter</div>
        <div>Title</div>
        <div>Where</div>
        <div>Compl.</div>
        <div>Status</div>
        <div>PR / Branch</div>
        <div style={{ textAlign: "right" }}>Age</div>
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto" }}>
        {rows.map(r => {
          const isSel = r.id === selectedId;
          const pr = r.merged_pr || r.fixed_pr;
          const branch = r.branch_name || r.triage_branch;
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r)}
              style={{
                display: "grid",
                gridTemplateColumns: "70px 90px 180px 1fr 110px 60px 140px 110px 60px",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
                cursor: "pointer",
                background: isSel ? "var(--hover, rgba(96,165,250,0.08))" : "transparent",
              }}>
              <div style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>#{r.report_number || "—"}</div>
              <div style={{ fontFamily: "monospace", color: "var(--text-2)" }}>{etDateShort(r.created_at)}</div>
              <div style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reporter_email || ""}>{r.reporter_name || r.reporter_email || "—"}</div>
              <div style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortTitle(r)}</div>
              <div style={{ fontFamily: "monospace", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url_full || ""}>{whereText(r)}</div>
              <div><ComplexityBadge value={r.complexity} /></div>
              <div style={{ display: "inline-flex", alignItems: "center" }}>
                <StatusBadge status={r.status} />
                <DesyncChip reasons={desyncReasons(r)} />
                <UatModeBadge row={r} />
              </div>
              <div style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={branch || ""}>
                {pr ? `#${pr}` : branch || "—"}
              </div>
              <div style={{ textAlign: "right", fontFamily: "monospace", color: "var(--text-muted)" }}>{ageText(r.created_at)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Screenshot panel (signed URL) ─────────────────────────────────────────
function Screenshot({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    if (!path) { setUrl(null); return; }
    supabase.storage.from("bug-screenshots").createSignedUrl(path, 300).then(({ data, error }) => {
      if (!mounted) return;
      if (error) { setErr(error.message); setUrl(null); }
      else { setUrl(data?.signedUrl || null); setErr(null); }
    });
    return () => { mounted = false; };
  }, [path]);

  if (!path) return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No screenshot.</div>;
  if (err) return <div style={{ fontSize: 12, color: "#ef4444" }}>Screenshot load failed: {err}</div>;
  if (!url) return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading screenshot…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
      <img src={url} alt="bug screenshot" style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 6 }} />
    </a>
  );
}

// ── Activity log (bug_status_log) ─────────────────────────────────────────
function ActivityLog({ bugId }) {
  const { rows, loading } = useBugStatusLog(bugId);
  if (loading) return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading activity…</div>;
  if (!rows?.length) return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No status changes logged.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(l => (
        <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "baseline" }}>
          <div style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 11, minWidth: 110 }}>{etDateTime(l.changed_at)}</div>
          <div>
            <StatusBadge status={l.from_status || "new"} /> <span style={{ color: "var(--text-muted)" }}>→</span> <StatusBadge status={l.to_status} />
            {l.note && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{l.note}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Proposed Fix card — prominent top-of-panel treatment for awaiting_approval
//
// Bug #1074: when the build operator proposes two options ("Option A" /
// "Option B" / "Reply A or B"), the single Approve button used to let
// Joe through without recording the pick. The build operator then
// skipped the row and emailed back asking for a re-approval with the
// pick — burning a sweep cycle. Now the card detects decision-gated
// proposals and replaces the single Approve with three explicit picks
// (Approve · Option A / Option B / Both). Each pick writes "A" / "B"
// / "Both" verbatim into approval_notes so the build operator's regex
// recognises it without further parsing. Non-gated rows keep the
// single Approve button.
//
// Trigger phrases match what the build operator's pre-flight check
// looks for: "Option A" AND "Option B", "Reply A or B", "Reply **A**
// or **B**", "pick A or B", "pick option", or "decision pending".
function isDecisionGated(text) {
  if (!text) return false;
  const t = String(text);
  if (/Reply\s*(\*\*)?A(\*\*)?\s*or\s*(\*\*)?B(\*\*)?/i.test(t)) return true;
  if (/pick\s*(option|A\s*or\s*B)/i.test(t)) return true;
  if (/decision pending/i.test(t)) return true;
  if (/Option\s*A/i.test(t) && /Option\s*B/i.test(t)) return true;
  return false;
}

function ProposedFixCard({ row, onApprove, onReject, pending }) {
  const branch = row.branch_name || row.triage_branch;
  const [note, setNote] = useState("");
  const isPending = pending?.bugId === row.id;
  const proposedText = row.proposed_solution || row.triage_notes || "";
  const gated = isDecisionGated(proposedText);

  // Build the approval_notes payload: pick (when gated) plus any free-form
  // note. Pick comes first so the build operator's regex on approval_notes
  // hits "A"/"B"/"Both" without scanning the rest of the string.
  const buildNote = (pick) => {
    const trimmed = (note || "").trim();
    if (!pick) return trimmed;
    return trimmed ? `${pick} · ${trimmed}` : pick;
  };

  return (
    <div style={{
      background: "rgba(251, 191, 36, 0.06)",
      border: "1px solid rgba(251, 191, 36, 0.45)",
      borderRadius: 8,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: "#B8860B" }} />
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#B8860B", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Proposed fix — awaiting your approval
        </div>
        {gated && (
          <div style={{
            marginLeft: "auto",
            fontSize: 10,
            fontFamily: "monospace",
            color: "#B8860B",
            background: "rgba(251, 191, 36, 0.15)",
            border: "1px solid rgba(251, 191, 36, 0.45)",
            borderRadius: 4,
            padding: "2px 8px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            Pick required
          </div>
        )}
      </div>
      {/* Fallback to triage_notes: the stage-bug-triage edge fn writes its
          root-cause + Fix: narrative into triage_notes rather than the
          narrower proposed_solution column. Show whichever is populated so
          awaiting_approval bugs aren't stuck with an empty-state card. */}
      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        {proposedText || "(No proposed solution attached. The triage agent hasn't drafted a fix yet.)"}
      </pre>
      {branch && (
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
          Branch: <span style={{ color: "var(--text-2)" }}>{branch}</span>
        </div>
      )}
      {gated && (
        <div style={{
          fontSize: 12,
          color: "var(--text-muted)",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          lineHeight: 1.5,
        }}>
          This proposal asks you to pick between two options. Use the buttons
          below — your choice is written to the approval note automatically so
          the build operator knows which path to ship.
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (saved to audit log)"
        rows={2}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {gated ? (
          <>
            <button
              onClick={() => onApprove(row.id, buildNote("A"))}
              disabled={isPending}
              style={{
                background: "#10b981",
                border: "none",
                borderRadius: 6,
                padding: "9px 14px",
                color: "white",
                fontSize: 13,
                fontWeight: 700,
                cursor: isPending ? "wait" : "pointer",
                opacity: isPending ? 0.6 : 1,
              }}>
              {isPending && pending?.action === "approve" ? "Approving…" : "✓ Approve · Option A"}
            </button>
            <button
              onClick={() => onApprove(row.id, buildNote("B"))}
              disabled={isPending}
              style={{
                background: "#10b981",
                border: "none",
                borderRadius: 6,
                padding: "9px 14px",
                color: "white",
                fontSize: 13,
                fontWeight: 700,
                cursor: isPending ? "wait" : "pointer",
                opacity: isPending ? 0.6 : 1,
              }}>
              {isPending && pending?.action === "approve" ? "Approving…" : "✓ Approve · Option B"}
            </button>
            <button
              onClick={() => onApprove(row.id, buildNote("Both"))}
              disabled={isPending}
              style={{
                background: "#0f766e",
                border: "none",
                borderRadius: 6,
                padding: "9px 14px",
                color: "white",
                fontSize: 13,
                fontWeight: 700,
                cursor: isPending ? "wait" : "pointer",
                opacity: isPending ? 0.6 : 1,
              }}>
              {isPending && pending?.action === "approve" ? "Approving…" : "✓ Approve · Both"}
            </button>
          </>
        ) : (
          <button
            onClick={() => onApprove(row.id, buildNote(""))}
            disabled={isPending}
            style={{
              background: "#10b981",
              border: "none",
              borderRadius: 6,
              padding: "9px 16px",
              color: "white",
              fontSize: 13,
              fontWeight: 700,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}>
            {isPending && pending?.action === "approve" ? "Approving…" : "✓ Approve & build"}
          </button>
        )}
        <button
          onClick={() => onReject(row.id, note)}
          disabled={isPending}
          style={{
            background: "transparent",
            border: "1px solid #ef4444",
            borderRadius: 6,
            padding: "9px 14px",
            color: "#ef4444",
            fontSize: 13,
            fontWeight: 600,
            cursor: isPending ? "wait" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}>
          {isPending && pending?.action === "rejectFix" ? "Rejecting…" : "✗ Reject"}
        </button>
      </div>
    </div>
  );
}

// ── Action row — status-appropriate buttons for non-awaiting_approval bugs.
// Reopen is two-step: clicking ⟲ Reopen swaps the button row for a note
// textarea + Confirm / Cancel. The note is REQUIRED (UAT failure context
// lives or dies on this — if Joe has to re-open a fix, the fix-builder
// needs to know what specifically is still broken). Flows through the
// existing useBugActions.reopen(bugId, note) → bug_status_log.note.
function ActionRow({ row, onMarkDeployed, onCloseBug, onReopen, onDismiss, pending }) {
  const g = statusGroup(row.status);
  const s = normStatus(row.status);
  const isPending = pending?.bugId === row.id;

  const [reopenMode, setReopenMode] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  // Reset inline-reopen state whenever the selected row changes, so closing
  // + re-opening the side panel (or jumping to a different bug) doesn't
  // resurface a half-filled textarea.
  useEffect(() => {
    setReopenMode(false);
    setReopenNote("");
  }, [row.id]);

  if (reopenMode) {
    const trimmed = reopenNote.trim();
    const canSubmit = trimmed.length > 0 && !isPending;
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "rgba(239, 68, 68, 0.06)",
        border: "1px solid rgba(239, 68, 68, 0.45)",
        borderRadius: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#ef4444" }} />
          <div style={{ fontSize: 11, fontFamily: "monospace", color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
            Reopen — tell the fix-builder what's still broken
          </div>
        </div>
        <textarea
          value={reopenNote}
          onChange={(e) => setReopenNote(e.target.value)}
          placeholder="e.g. FXAIX current price is still $1 after refresh — fix didn't take on Safari desktop."
          rows={3}
          autoFocus
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => { if (canSubmit) onReopen(row.id, trimmed); }}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "#ef4444" : "transparent",
              color: canSubmit ? "white" : "var(--text-muted)",
              border: canSubmit ? "none" : "1px solid var(--border)",
              borderRadius: 6,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: isPending ? 0.6 : 1,
            }}>
            {isPending && pending?.action === "reopen" ? "Reopening…" : "⟲ Confirm reopen"}
          </button>
          <button
            type="button"
            onClick={() => { setReopenMode(false); setReopenNote(""); }}
            disabled={isPending}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "9px 14px",
              color: "var(--text-2)",
              fontSize: 13,
              fontWeight: 600,
              cursor: isPending ? "wait" : "pointer",
            }}>
            Cancel
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginLeft: "auto" }}>
            {trimmed.length ? `${trimmed.length} chars` : "note required"}
          </span>
        </div>
      </div>
    );
  }

  const buttons = [];
  if (s === "merged")          buttons.push({ id: "markDeployed", label: "Mark deployed", tone: "primary", onClick: () => onMarkDeployed(row.id, null) });
  if (s === "deployed")        buttons.push({ id: "close",         label: "✓ Close (UAT passed)", tone: "good", onClick: () => onCloseBug(row.id) });
  if (s === "deployed")        buttons.push({ id: "reopen",        label: "⟲ Reopen", tone: "bad",  onClick: () => setReopenMode(true) });
  if (s === "verified_closed") buttons.push({ id: "reopen",        label: "⟲ Reopen", tone: "bad",  onClick: () => setReopenMode(true) });
  if (g === "open" && s !== "awaiting_approval") {
    buttons.push({ id: "dismiss_wontfix",   label: "Won't fix",   tone: "muted", onClick: () => onDismiss(row.id, "wontfix") });
    buttons.push({ id: "dismiss_duplicate", label: "Duplicate",   tone: "muted", onClick: () => onDismiss(row.id, "duplicate") });
    buttons.push({ id: "dismiss_needs_info",label: "Needs info",  tone: "muted", onClick: () => onDismiss(row.id, "needs_info") });
  }
  if (!buttons.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
      {buttons.map(b => {
        const style = actionBtnStyle(b.tone, isPending);
        return (
          <button key={b.id} onClick={b.onClick} disabled={isPending} style={style}>
            {isPending && pending?.action && b.id.startsWith(pending.action) ? "…" : b.label}
          </button>
        );
      })}
    </div>
  );
}
function actionBtnStyle(tone, disabled) {
  const base = { borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1 };
  if (tone === "good")    return { ...base, background: "#10b981", color: "white", border: "none" };
  if (tone === "bad")     return { ...base, background: "transparent", color: "#ef4444", border: "1px solid #ef4444" };
  if (tone === "primary") return { ...base, background: "var(--accent, #2563eb)", color: "white", border: "none" };
  return { ...base, background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" };
}

// Lightweight blocker fetch — resolves each uuid in row.blocked_by into a
// { id, report_number, status, title } row so the WorkflowTimeline can
// render the blocker banner with clickable detail. One query per panel
// open, cached in component state. RLS already gates bug_reports read.
function useBlockerRows(ids) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Array.isArray(ids) || ids.length === 0) { setRows([]); return; }
      const { data, error } = await supabase
        .from("bug_reports")
        .select("id, report_number, status, title")
        .in("id", ids);
      if (!cancelled && !error && data) setRows(data);
    })();
    return () => { cancelled = true; };
  // blocked_by is a stable array reference at the row level; JSON-stringify
  // to avoid re-fetching on reference-only changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ids || [])]);
  return rows;
}

// ── Side panel ────────────────────────────────────────────────────────────
function SidePanel({ row, onClose, onActed }) {
  const actions = useBugActions();
  const blockers = useBlockerRows(row?.blocked_by);
  if (!row) return null;
  // PR + branch are now rendered inside the WorkflowTimeline's "Merged"
  // stage body, so we don't destructure them here anymore.
  const isAwaitingApproval = normStatus(row.status) === "awaiting_approval";

  // Run an action then refresh the parent list + clear selection.
  const runAndRefresh = async (fn) => {
    const res = await fn();
    if (!res?.error) onActed?.();
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>#{row.report_number} · {etDateTime(row.created_at)}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 3 }}>{row.title || shortTitle(row)}</div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>Close</button>
      </div>

      {/* Meta strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 10, fontSize: 12 }}>
        <MetaField label="Status" value={<span style={{ display: "inline-flex", alignItems: "center" }}><StatusBadge status={row.status} /><DesyncChip reasons={desyncReasons(row)} /><UatModeBadge row={row} /></span>} />
        <MetaField label="Complexity" value={<ComplexityBadge value={row.complexity} />} />
        <MetaField label="Priority" value={row.priority || "—"} mono />
        <MetaField label="Reporter" value={row.reporter_name || row.reporter_email || "—"} />
        <MetaField label="Where" value={whereText(row)} mono />
      </div>

      {/* Workflow timeline — 7-stage lifecycle with owner + SLA per stage.
          Sits above the action row so whoever opens the panel sees at a
          glance who owns the next step and whether it's within SLA. */}
      <WorkflowTimeline row={row} blockers={blockers} />

      {/* Verify-before-reopen card — only when the row is deployed + awaiting
          Joe's manual UAT. Renders What-you-reported / What-was-approved /
          What-actually-shipped side-by-side so reopen is an informed action
          instead of a "still doesn't work" black box. Memory of bug #1019. */}
      {normStatus(row.status) === "deployed" && (row.uat_mode ?? "manual") === "manual" && (
        <VerifyShippedPanel row={row} />
      )}

      {/* Proposed Fix — prominent for awaiting_approval; plain section otherwise */}
      {isAwaitingApproval ? (
        <ProposedFixCard
          row={row}
          pending={actions.pending}
          onApprove={(id, note) => runAndRefresh(() => actions.approve(id, note))}
          onReject={(id, note)  => runAndRefresh(() => actions.rejectFix(id, note))}
        />
      ) : (
        <ActionRow
          row={row}
          pending={actions.pending}
          onMarkDeployed={(id, sha) => runAndRefresh(() => actions.markDeployed(id, sha))}
          onCloseBug={(id)          => runAndRefresh(() => actions.close(id))}
          onReopen={(id, note)      => runAndRefresh(() => actions.reopen(id, note))}
          onDismiss={(id, terminal) => runAndRefresh(() => actions.dismissAs(id, terminal))}
        />
      )}

      {actions.error && (
        <div style={{ fontSize: 12, color: "#ef4444", fontFamily: "monospace", padding: "6px 10px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6 }}>
          Action failed: {actions.error.message || String(actions.error)}
        </div>
      )}

      {/* Description */}
      <Section title="Description">
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
          {row.description || "(empty)"}
        </pre>
      </Section>

      {/* Proposed fix — plain block for non-awaiting_approval statuses so the
          fix narrative is still visible after a bug has been approved/merged/
          deployed. Falls back to triage_notes when proposed_solution is null
          (the stage-bug-triage edge fn writes its Root-cause/Fix: narrative
          into triage_notes rather than the narrower proposed_solution col). */}
      {(row.proposed_solution || row.triage_notes) && !isAwaitingApproval && (
        <Section title="Proposed fix">
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
            {row.proposed_solution || row.triage_notes}
          </pre>
        </Section>
      )}

      {/* Triage notes — only render when proposed_solution is ALSO populated
          (i.e. triage has extra detail beyond the fix narrative). When
          proposed_solution is null, triage_notes has already been surfaced
          above — either by the amber Proposed-Fix card or by the Proposed
          fix Section — and rendering it again here would double the block. */}
      {row.triage_notes && row.proposed_solution && (
        <Section title="Triage notes">
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
            {row.triage_notes}
          </pre>
        </Section>
      )}

      {/* Lifecycle housekeeping — the WorkflowTimeline above owns the main
          stage stamps + PR/branch. This block only surfaces the two
          infrequent stamps (ack-email, resurface) that don't map to a
          pipeline stage, and only when at least one is populated. */}
      {(row.ack_email_sent_at || row.resurface_at) && (
        <Section title="Housekeeping">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", rowGap: 4, columnGap: 14, fontSize: 12 }}>
            {row.ack_email_sent_at && <StampRow label="Ack email"    iso={row.ack_email_sent_at} />}
            {row.resurface_at     && <StampRow label="Resurface at" iso={row.resurface_at} />}
          </div>
        </Section>
      )}

      {/* Console errors */}
      {Array.isArray(row.console_errors) && row.console_errors.length > 0 && (
        <Section title={`Console errors (${row.console_errors.length})`}>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace", fontSize: 11, color: "#ef4444", lineHeight: 1.45, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, padding: 10, maxHeight: 160, overflow: "auto" }}>
            {row.console_errors.map((e, i) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n")}
          </pre>
        </Section>
      )}

      {/* Screenshot */}
      <Section title="Screenshot">
        <Screenshot path={row.screenshot_path} />
      </Section>

      {/* Activity */}
      <Section title="Activity">
        <ActivityLog bugId={row.id} />
      </Section>

      {/* Client context */}
      <Section title="Client context">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", rowGap: 4, columnGap: 14, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
          <div>viewport: {row.viewport || "—"}</div>
          <div>build: {row.build_sha ? row.build_sha.slice(0, 7) : "—"}</div>
          <div style={{ gridColumn: "1 / -1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.user_agent || ""}>ua: {row.user_agent || "—"}</div>
          <div style={{ gridColumn: "1 / -1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.url_full || ""}>url: {row.url_full || "—"}</div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function MetaField({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--text)", fontFamily: mono ? "monospace" : "inherit", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}
function StampRow({ label, iso }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 86 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 11, color: iso ? "var(--text-2)" : "var(--text-muted)" }}>{iso ? etDateTime(iso) : "—"}</div>
    </div>
  );
}

// ── VerifyShippedPanel ─────────────────────────────────────────────────────
// Three-column "what you reported / what was approved / what shipped" card
// that renders on deployed + manual-UAT rows so reopen becomes a comparison,
// not a guess. Memory of bug #1019: reopened without a note because the
// reporter had no context on what the shipped PR actually changed.
const GH_REPO_URL = "https://github.com/jmezzadri/market-dashboard";
function VerifyShippedPanel({ row }) {
  const prUrl = row.fixed_pr
    ? `${GH_REPO_URL}/pull/${row.fixed_pr}`
    : row.merged_pr ? `${GH_REPO_URL}/pull/${row.merged_pr}` : null;
  const sha = row.deployed_sha || row.merged_sha || row.fixed_sha;
  const commitUrl = sha ? `${GH_REPO_URL}/commit/${sha}` : null;
  const shortSha = sha ? sha.slice(0, 7) : null;

  const columnStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  };
  const labelStyle = {
    fontSize: 10,
    fontFamily: "monospace",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };
  const bodyStyle = {
    fontSize: 12,
    color: "var(--text)",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 180,
    overflow: "auto",
  };

  return (
    <div style={{
      background: "rgba(16, 185, 129, 0.05)",
      border: "1px solid rgba(16, 185, 129, 0.35)",
      borderRadius: 8,
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: "#10b981" }} />
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#059669", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Verify before reopening — does what shipped match what you asked for?
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
        <div style={columnStyle}>
          <div style={labelStyle}>1. What you reported</div>
          <div style={bodyStyle}>{row.description || "(empty)"}</div>
        </div>
        <div style={columnStyle}>
          <div style={labelStyle}>2. What was approved</div>
          <div style={bodyStyle}>{row.proposed_solution || row.triage_notes || "(no proposed_solution captured)"}</div>
        </div>
        <div style={columnStyle}>
          <div style={labelStyle}>3. What shipped</div>
          <div style={{ ...bodyStyle, fontFamily: "monospace", fontSize: 11 }}>
            {prUrl && (
              <div style={{ marginBottom: 4 }}>
                <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#059669", textDecoration: "underline" }}>
                  PR #{row.fixed_pr || row.merged_pr}
                </a>
              </div>
            )}
            {commitUrl && (
              <div style={{ marginBottom: 4 }}>
                commit <a href={commitUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#059669", textDecoration: "underline" }}>{shortSha}</a>
              </div>
            )}
            {row.deployed_at && (
              <div style={{ marginBottom: 4, color: "var(--text-2)" }}>
                deployed {etDateTime(row.deployed_at)}
              </div>
            )}
            {row.branch_name && (
              <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                branch: {row.branch_name}
              </div>
            )}
            {!prUrl && !commitUrl && !row.deployed_at && (
              <div style={{ color: "var(--text-muted)" }}>(no ship trail recorded)</div>
            )}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        If column 3 covers column 2 but you still see a problem, it's a new bug — file it separately so the audit trail stays clean. If column 3 misses something in column 2, reopen with a specific repro and the fix-builder will take another pass.
      </div>
    </div>
  );
}

// ── Top-level component ────────────────────────────────────────────────────
export default function AdminBugs() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const { rows, error, loading, reload } = useBugReports({ limit: 500 });
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  // ⚠️ HOOKS ORDER: every hook in this function must run on every render.
  // Early returns below MUST come AFTER all hook calls — otherwise the hook
  // count changes between render 1 (adminLoading=true) and render 2
  // (adminLoading=false), which triggers React #310 and blanks the page.
  // Reference: feedback_grep_all_hooks_when_310.md.

  // Derived counts + filtered rows — bucket uses row (not just status) so
  // deployed+uat_mode=manual gets routed to the "needs_uat" queue instead of
  // the automated "in_flight" pipeline.
  const { counts, filtered } = useMemo(() => {
    const all = rows || [];
    const counts = { all: all.length };
    for (const r of all) {
      const b = bugBucket(r);
      counts[b] = (counts[b] || 0) + 1;
    }
    const filteredRows = filter === "all" ? all : all.filter(r => bugBucket(r) === filter);
    return { counts, filtered: filteredRows };
  }, [rows, filter]);

  // Oldest item in Joe's manual-UAT queue — used in KPI sub-copy. Uses
  // deployed_at as the age marker (that's when the ball landed in his court).
  const oldestNeedsUat = useMemo(() => {
    const cands = (rows || []).filter(r => bugBucket(r) === "needs_uat");
    if (!cands.length) return null;
    return cands.reduce((oldest, r) => {
      const ts = r.deployed_at || r.created_at;
      if (!oldest || new Date(ts) < new Date(oldest)) return ts;
      return oldest;
    }, null);
  }, [rows]);

  if (adminLoading) {
    return <div style={{ padding: "40px 20px", color: "var(--text-muted)", textAlign: "center" }}>Checking access…</div>;
  }
  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 20px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Not authorized</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            This page is visible only to MacroTilt admins. If you think this is a mistake, sign in with the admin account.
          </div>
        </div>
      </div>
    );
  }

  // "Open" = rows still in initial triage (new/triaged/reopened). Does NOT
  // include awaiting_approval — that has its own dedicated tile next to this
  // one, and summing them here was double-counting the same row across two
  // tiles (Joe's UX feedback, 2026-04-24 "1 awaiting approval in open bucket.
  // It's the same issue in two buckets.").
  const open = counts.open || 0;
  const needsUat = counts.needs_uat || 0;
  const inFlight = counts.in_flight || 0;
  // Anything older than 36h in Joe's manual-UAT queue is a red flag — most
  // items should be closed within a day.
  const needsUatAgeMs = oldestNeedsUat ? (Date.now() - new Date(oldestNeedsUat).getTime()) : 0;
  const needsUatStale = needsUatAgeMs > 36 * 3600 * 1000;

  // One-tile-per-bucket filter strip. Clicking a tile sets the active filter;
  // the `All` tile resets. The separate filter-pill row below was removed in
  // favour of this tile-first UX (2026-04-24) so there's a single, unified
  // hierarchy: the same tile that shows the count IS the filter.
  const wontFix = counts.wontfix || 0;
  const all = counts.all || 0;

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1400, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      {/* KPI strip (clickable = filter) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
        <KpiTile
          label="All"
          value={all}
          sub="every report"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <KpiTile
          label="Open"
          value={open}
          sub={open > 0 ? "needs first look" : "nothing waiting"}
          tone={open > 0 ? "warn" : "good"}
          active={filter === "open"}
          onClick={() => setFilter("open")}
        />
        <KpiTile
          label="Awaiting approval"
          value={counts.awaiting_approval || 0}
          sub="your decision needed"
          tone={counts.awaiting_approval > 0 ? "warn" : undefined}
          active={filter === "awaiting_approval"}
          onClick={() => setFilter("awaiting_approval")}
        />
        <KpiTile
          label="Needs your UAT"
          value={needsUat}
          sub={needsUat ? `oldest: ${ageText(oldestNeedsUat)}${needsUatStale ? " — stale" : ""}` : "nothing pending"}
          tone={needsUat === 0 ? "good" : needsUatStale ? "bad" : "warn"}
          active={filter === "needs_uat"}
          onClick={() => setFilter("needs_uat")}
        />
        <KpiTile
          label="In flight"
          value={inFlight}
          sub="automated pipeline"
          active={filter === "in_flight"}
          onClick={() => setFilter("in_flight")}
        />
        <KpiTile
          label="Closed"
          value={counts.closed || 0}
          sub="verified fixed"
          tone="good"
          active={filter === "closed"}
          onClick={() => setFilter("closed")}
        />
        <KpiTile
          label="Wont fix"
          value={wontFix}
          sub="won't fix · duplicate · needs info"
          active={filter === "wontfix"}
          onClick={() => setFilter("wontfix")}
        />
      </div>

      {error && (
        <div style={{ background: "var(--surface)", border: "1px solid #ef4444", borderRadius: 8, padding: "12px 14px", color: "#ef4444", fontSize: 12, marginBottom: 12, fontFamily: "monospace" }}>
          Query failed: {error.message || String(error)}
        </div>
      )}
      {loading && !rows && (
        <div style={{ padding: "40px 20px", color: "var(--text-muted)", textAlign: "center" }}>Loading bugs…</div>
      )}

      {/* Shown-count strip — the filter itself now lives on the KPI tiles
          above, so we only need the "N of M shown" readout + a Clear button
          when the current filter is not `all`. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
          {filter === "all"
            ? `${rows?.length || 0} total`
            : <>Filter: <span style={{ color: "var(--text-2)" }}>{FILTER_PILLS.find(p => p.id === filter)?.label || filter}</span> · {filtered.length} of {rows?.length || 0}</>}
        </div>
        {filter !== "all" && (
          <button
            type="button"
            onClick={() => setFilter("all")}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", color: "var(--text-2)", fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}>
            Clear filter
          </button>
        )}
      </div>

      {/* Body: table + side panel */}
      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1.3fr) minmax(420px, 1fr)" : "1fr", gap: 16, alignItems: "start" }}>
        <BugTable rows={filtered} selectedId={selected?.id} onSelect={setSelected} />
        {selected && <SidePanel row={(rows || []).find(r => r.id === selected.id) || selected} onClose={() => setSelected(null)} onActed={() => { reload(); setSelected(null); }} />}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 11, color: "var(--text-muted)" }}>
        <div>Read-only (Phase 1) · RLS-gated via <code style={{ fontFamily: "monospace" }}>public.is_admin()</code> · v2 vocab (migration 013).</div>
        <button onClick={reload} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", color: "var(--text-2)", fontSize: 11, cursor: "pointer" }}>Reload</button>
      </div>
    </main>
  );
}
