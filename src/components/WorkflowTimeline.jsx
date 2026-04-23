// WorkflowTimeline — vertical 7-stage lifecycle view for a single bug row.
//
// Rendered at the top of the Admin · Bugs side panel so Joe (and future
// collaborators) can see at a glance:
//
//   • which stage the bug is in right now
//   • who owns the handoff at every stage (Reporter / Claude / Joe / Vercel)
//   • whether the active stage is within or past its SLA
//   • stage-specific context inline (root cause, approval notes, PR/SHA,
//     UAT mode, blocker chain) without needing to dig for it
//
// Data contract — reads these columns off the bug_reports row:
//   created_at, triaged_at (mig 014), awaiting_approval_at (mig 014),
//   approved_at, approval_notes (mig 014), merged_at/fixed_at, merged_pr/
//   fixed_pr, merged_sha/fixed_sha, deployed_at, deployed_sha,
//   verified_at/resolved_at, uat_mode (mig 014), auto_uat_checklist (mig
//   014), auto_uat_attempted_at (mig 014), auto_uat_failed (mig 014),
//   blocked_by (mig 014), status, complexity, priority, reporter_name,
//   reporter_email, triage_notes, proposed_solution, description.
//
// Blocker chain — when row.blocked_by is populated, a red banner renders
// above the timeline listing the blocker report_numbers + titles so the
// panel user sees "this can't start until 1024/1025 close" without leaving
// the modal.
//
// Owner map:
//   filed              → Reporter  (informational; no action expected)
//   triaged            → Claude    (sweeps new bugs each morning)
//   awaiting_approval  → Joe       (approves/rejects the proposed fix)
//   approved           → Claude    (builds the patch, opens PR)
//   merged             → Vercel    (auto-deploys the merge to prod)
//   deployed           → Claude    when uat_mode='auto' (cosmetic fixes)
//                      → Joe       when uat_mode='manual' (default)
//   verified_closed    → —         (terminal)
//
// SLA windows (hours) — used to colour the stage chip amber/red when the
// active stage has been open longer than its budget. Tuned to match how
// MacroTilt actually ships: Vercel deploys in minutes, Joe's approval
// window is the long pole.

import { useState } from "react";

const STAGES = [
  "filed",
  "triaged",
  "awaiting_approval",
  "approved",
  "merged",
  "deployed",
  "verified_closed",
];

const STAGE_META = {
  filed:             { label: "Filed",              color: "#60a5fa", sla_h:  24 },
  triaged:           { label: "Triaged",            color: "#a78bfa", sla_h:   8 },
  awaiting_approval: { label: "Awaiting approval",  color: "#B8860B", sla_h:  48 },
  approved:          { label: "Approved",           color: "#f59e0b", sla_h:  24 },
  merged:            { label: "Merged",             color: "#34d399", sla_h:   1 },
  deployed:          { label: "Deployed",           color: "#10b981", sla_h:  24 },
  verified_closed:   { label: "Verified closed",    color: "#6b7280", sla_h: null },
};

// Legacy → canonical status mapping (matches AdminBugs.jsx).
const LEGACY_ALIAS = {
  received:       "new",
  investigating:  "triaged",
  "fix-proposed": "awaiting_approval",
  skipped:        "new",
  dismissed:      "wontfix",
  "wont-fix":     "wontfix",
  "needs-info":   "needs_info",
  fixed:          "verified_closed",
  resolved:       "verified_closed",
  new:            "filed", // "new" in DB == "filed" in timeline vocab
};
function normStageStatus(s) { return LEGACY_ALIAS[s] || s || "filed"; }

// Is this row on a terminal-side branch? Those don't render a timeline at
// all — the panel falls back to a plain "closed as wontfix/duplicate/…"
// label so we don't mislead the viewer with a green happy path.
const SIDE_BRANCHES = new Set(["wontfix", "duplicate", "needs_info"]);

// ── helpers ───────────────────────────────────────────────────────────────
function stampFor(row, stage) {
  switch (stage) {
    case "filed":             return row.created_at;
    case "triaged":           return row.triaged_at || row.last_triaged_at;
    case "awaiting_approval": return row.awaiting_approval_at;
    case "approved":          return row.approved_at;
    case "merged":            return row.merged_at || row.fixed_at;
    case "deployed":          return row.deployed_at;
    case "verified_closed":   return row.verified_at || row.resolved_at;
    default:                  return null;
  }
}

function ownerFor(stage, row) {
  if (stage === "filed") return { name: "Reporter", tone: "info" };
  if (stage === "triaged") return { name: "Claude", tone: "claude" };
  if (stage === "awaiting_approval") return { name: "Joe", tone: "joe" };
  if (stage === "approved") return { name: "Claude", tone: "claude" };
  if (stage === "merged") return { name: "Vercel", tone: "auto" };
  if (stage === "deployed") {
    const auto = row.uat_mode === "auto";
    return { name: auto ? "Claude (auto-UAT)" : "Joe (manual UAT)", tone: auto ? "claude" : "joe" };
  }
  return { name: "—", tone: "muted" };
}

function ownerColor(tone) {
  if (tone === "claude") return "#a78bfa";
  if (tone === "joe")    return "#B8860B";
  if (tone === "auto")   return "#34d399";
  if (tone === "info")   return "#60a5fa";
  return "#6b7280";
}

function etDateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    return `${date} · ${time} ET`;
  } catch { return ""; }
}

function hoursSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 0;
  return ms / 3_600_000;
}

function ageText(iso) {
  const h = hoursSince(iso);
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// Active-stage = first stage whose timestamp is absent AND the row hasn't
// closed past it. For rows already in verified_closed we flag every stage
// complete. For rows in side-branches we return null (caller hides tl).
function activeStage(row) {
  const normalized = normStageStatus(row.status);
  if (SIDE_BRANCHES.has(normalized)) return null;
  if (normalized === "reopened") return "filed"; // reset clock
  if (normalized === "verified_closed") return "verified_closed";
  // Pick the earliest stage without a stamp. Skip "merged" fallthrough if
  // merged_at is genuinely absent but later stages have stamps (data skew).
  for (const s of STAGES) {
    if (!stampFor(row, s)) return s;
  }
  return "verified_closed";
}

// SLA state for a given stage, computed relative to when it was ENTERED
// (i.e. the timestamp of the previous stage).
function slaState(row, stage, active) {
  if (stage !== active) return null;
  const sla = STAGE_META[stage].sla_h;
  if (sla == null) return null;
  const entryIdx = STAGES.indexOf(stage) - 1;
  const entryStamp = entryIdx >= 0 ? stampFor(row, STAGES[entryIdx]) : row.created_at;
  if (!entryStamp) return null;
  const elapsed = hoursSince(entryStamp);
  const pct = elapsed / sla;
  if (pct >= 1)   return { state: "breached", elapsed, sla, pct };
  if (pct >= 0.75) return { state: "warning",  elapsed, sla, pct };
  return { state: "ok", elapsed, sla, pct };
}

function slaColor(state) {
  if (state === "breached") return "#ef4444";
  if (state === "warning")  return "#B8860B";
  return "#10b981";
}

// ── main component ────────────────────────────────────────────────────────
export default function WorkflowTimeline({ row, blockers = [] }) {
  const active = activeStage(row);
  const normalized = normStageStatus(row.status);

  // Side-branch rendering — no timeline, just a label.
  if (SIDE_BRANCHES.has(normalized)) {
    return (
      <div style={sideBranchStyle}>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Workflow
        </div>
        <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4 }}>
          Closed as <b style={{ color: "#94a3b8" }}>{normalized.replace("_", " ")}</b>{" "}
          {row.verified_at || row.resolved_at ? `· ${etDateTime(row.verified_at || row.resolved_at)}` : ""}
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRow}>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Workflow
        </div>
        <OwnerLegend />
      </div>

      {blockers.length > 0 && <BlockerBanner blockers={blockers} />}

      <ol style={olStyle}>
        {STAGES.map((stage, i) => {
          const stamp = stampFor(row, stage);
          const isActive = stage === active;
          const isComplete = !!stamp && !isActive;
          const isFuture = !stamp && !isActive;
          const last = i === STAGES.length - 1;
          const sla = slaState(row, stage, active);
          return (
            <li key={stage} style={{ position: "relative", paddingBottom: last ? 0 : 14 }}>
              {!last && <StageConnector complete={isComplete} />}
              <StageRow
                row={row}
                stage={stage}
                stamp={stamp}
                isActive={isActive}
                isComplete={isComplete}
                isFuture={isFuture}
                sla={sla}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────
function StageRow({ row, stage, stamp, isActive, isComplete, isFuture, sla }) {
  const meta = STAGE_META[stage];
  const owner = ownerFor(stage, row);
  const [expanded, setExpanded] = useState(isActive);

  const dotColor = isComplete ? meta.color : isActive ? meta.color : "var(--border)";
  const dotFill = isComplete ? meta.color : "transparent";
  const dotBorder = isFuture ? "1px dashed var(--border)" : `2px solid ${meta.color}`;

  const body = stageBody(row, stage);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 10,
          background: dotFill, border: dotBorder,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: isActive ? `0 0 0 4px rgba(251,191,36,0.15)` : "none",
        }}>
          {isComplete && <span style={{ color: "white", fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={body ? () => setExpanded(x => !x) : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            cursor: body ? "pointer" : "default",
          }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isFuture ? "var(--text-muted)" : "var(--text)" }}>
            {meta.label}
          </div>
          <OwnerPill owner={owner} />
          {isActive && sla && <SlaChip sla={sla} />}
          {isComplete && stamp && (
            <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
              {etDateTime(stamp)}
            </div>
          )}
          {isActive && stamp == null && (
            <div style={{ fontSize: 10, fontFamily: "monospace", color: "#B8860B", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
              ← current
            </div>
          )}
        </div>
        {body && expanded && (
          <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
            {body}
          </div>
        )}
      </div>
    </div>
  );
}

function StageConnector({ complete }) {
  return (
    <div style={{
      position: "absolute",
      left: 8.5, top: 18, bottom: 0,
      width: 1,
      background: complete ? "#34d399" : "var(--border)",
    }}/>
  );
}

function OwnerPill({ owner }) {
  const color = ownerColor(owner.tone);
  return (
    <span style={{
      fontSize: 10, fontFamily: "monospace", fontWeight: 700,
      color, textTransform: "uppercase", letterSpacing: "0.08em",
      padding: "2px 6px", borderRadius: 4,
      border: `1px solid ${color}`, background: `${color}14`,
    }}>
      {owner.name}
    </span>
  );
}

function SlaChip({ sla }) {
  const color = slaColor(sla.state);
  const label = sla.state === "breached" ? "SLA BREACH" : sla.state === "warning" ? "SLA WARN" : "SLA OK";
  const elapsed = sla.elapsed < 1 ? `${Math.max(1, Math.round(sla.elapsed * 60))}m` : `${Math.round(sla.elapsed)}h`;
  const budget  = sla.sla >= 24 ? `${sla.sla / 24}d` : `${sla.sla}h`;
  return (
    <span style={{
      fontSize: 10, fontFamily: "monospace", fontWeight: 700,
      color, padding: "2px 6px", borderRadius: 4,
      border: `1px solid ${color}`, background: `${color}14`,
    }}>
      {label} · {elapsed} / {budget}
    </span>
  );
}

function OwnerLegend() {
  const items = [
    { label: "Claude", color: "#a78bfa" },
    { label: "Joe",    color: "#B8860B" },
    { label: "Auto",   color: "#34d399" },
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {items.map(it => (
        <span key={it.label} style={{
          fontSize: 9, fontFamily: "monospace", fontWeight: 700,
          color: it.color, textTransform: "uppercase", letterSpacing: "0.08em",
          padding: "1px 5px", borderRadius: 3,
          border: `1px solid ${it.color}44`,
        }}>{it.label}</span>
      ))}
    </div>
  );
}

function BlockerBanner({ blockers }) {
  return (
    <div style={{
      background: "rgba(239,68,68,0.06)",
      border: "1px solid rgba(239,68,68,0.4)",
      borderRadius: 6,
      padding: "8px 10px",
      marginBottom: 8,
      fontSize: 12,
      color: "var(--text)",
    }}>
      <div style={{ fontSize: 10, fontFamily: "monospace", color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 4 }}>
        ⏸ Blocked — this bug can't start until:
      </div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {blockers.map(b => (
          <li key={b.id} style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
            <b style={{ fontFamily: "monospace", color: "var(--text)" }}>#{b.report_number}</b>
            {b.status && <span style={{ fontSize: 10, fontFamily: "monospace", color: "#a78bfa", marginLeft: 6 }}>[{b.status}]</span>}
            {b.title && <span style={{ marginLeft: 6 }}>{b.title}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── stage bodies — what renders inside each stage when expanded ──────────
function stageBody(row, stage) {
  switch (stage) {
    case "filed": {
      const who = row.reporter_name || row.reporter_email || "Unknown";
      const desc = (row.description || "").trim();
      // Render the full description — no char cap, no first-line-only
      // clipping. Triage rule is "≥2-3 sentences per section" (Joe,
      // 2026-04-22) so the filed stage body has to show all of it or
      // the rule is meaningless. Side panel is already scrollable.
      return (
        <div>
          <div><b>Reporter:</b> {who}</div>
          {desc && (
            <div style={{ marginTop: 4, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
              {desc}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
            {row.complexity && <>complexity: <b style={{ color: "var(--text-2)" }}>{row.complexity}</b> · </>}
            {row.priority && <>priority: <b style={{ color: "var(--text-2)" }}>{row.priority}</b></>}
          </div>
        </div>
      );
    }
    case "triaged": {
      const fix = row.proposed_solution || row.triage_notes;
      if (!fix) return <div style={{ color: "var(--text-muted)" }}>Awaiting root-cause write-up from the morning triage sweep.</div>;
      return (
        <div style={{ whiteSpace: "pre-wrap" }}>{fix}</div>
      );
    }
    case "awaiting_approval": {
      const since = row.awaiting_approval_at;
      return (
        <div>
          <div>Waiting on <b style={{ color: "#B8860B" }}>Joe</b> to approve (or reject) the proposed fix above.</div>
          {since && (
            <div style={{ marginTop: 4, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
              Entered: {etDateTime(since)} · aging: {ageText(since)}
            </div>
          )}
        </div>
      );
    }
    case "approved": {
      if (!row.approved_at && !row.approval_notes) return null;
      return (
        <div>
          <div>Approved by <b>Joe</b>{row.approved_at ? ` · ${etDateTime(row.approved_at)}` : ""}.</div>
          {row.approval_notes && (
            <div style={{ marginTop: 6, padding: "6px 8px", borderLeft: "2px solid #B8860B", background: "rgba(251,191,36,0.06)" }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#B8860B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Feedback / conditions
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{row.approval_notes}</div>
            </div>
          )}
        </div>
      );
    }
    case "merged": {
      const pr = row.merged_pr || row.fixed_pr;
      const sha = row.merged_sha || row.fixed_sha;
      const branch = row.branch_name || row.triage_branch;
      const at = row.merged_at || row.fixed_at;
      if (!pr && !sha && !at) return null;
      return (
        <div style={{ fontFamily: "monospace", fontSize: 11 }}>
          {pr && <div>PR: <b>#{pr}</b>{sha ? ` · ${sha.slice(0, 7)}` : ""}</div>}
          {branch && <div>branch: {branch}</div>}
          {at && <div>merged: {etDateTime(at)}</div>}
          <div style={{ marginTop: 4, fontFamily: "inherit", color: "var(--text-muted)", fontSize: 11 }}>
            Vercel will pick this up and deploy automatically — usually &lt;2 minutes.
          </div>
        </div>
      );
    }
    case "deployed": {
      const at = row.deployed_at;
      const sha = row.deployed_sha;
      const auto = row.uat_mode === "auto";
      return (
        <div>
          {at && (
            <div style={{ fontFamily: "monospace", fontSize: 11 }}>
              deployed: {etDateTime(at)}{sha ? ` · ${sha.slice(0, 7)}` : ""}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            UAT owner: <b style={{ color: auto ? "#a78bfa" : "#B8860B" }}>
              {auto ? "Claude — auto-UAT via Chrome" : "Joe — manual UAT on live site"}
            </b>
          </div>
          {auto && row.auto_uat_checklist && (
            <div style={{ marginTop: 6, padding: "6px 8px", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 4 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                UAT checklist
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{row.auto_uat_checklist}</div>
              {row.auto_uat_attempted_at && (
                <div style={{ marginTop: 4, fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
                  Last attempt: {etDateTime(row.auto_uat_attempted_at)}
                  {row.auto_uat_failed ? " · FAILED (manual override required)" : ""}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
    case "verified_closed": {
      const at = row.verified_at || row.resolved_at;
      if (!at) return null;
      return (
        <div style={{ fontFamily: "monospace", fontSize: 11 }}>
          verified: {etDateTime(at)}
        </div>
      );
    }
    default:
      return null;
  }
}

// ── styles ────────────────────────────────────────────────────────────────
const wrapStyle = {
  background: "var(--surface-2, var(--surface))",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
};

const headerRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const olStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const sideBranchStyle = {
  background: "var(--surface-2, var(--surface))",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "12px 14px",
};
