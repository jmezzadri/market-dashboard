// useBugActions — admin-only mutation hook for the Admin · Bugs side panel.
//
// Every action is a single UPDATE on public.bug_reports. The bug_status_log
// trigger from migration 013 auto-writes an audit row with auth.uid(); if the
// caller wants a note attached to the transition, we write it to the log
// table in a follow-up insert (same transaction logically, not worth a SQL
// function for Phase 2).
//
// RLS on bug_reports UPDATE is gated on public.is_admin(), so a non-admin
// session would be rejected before reaching the table.
//
// All action methods return { error } | { data } — callers should refresh
// via the parent useBugReports reload() after a successful mutation.

import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

// Helper: write a note to bug_status_log AFTER the trigger has logged the
// transition. The trigger inserts with `note=null` on UPDATE, so we find
// the freshly-inserted row by (bug_id, to_status, most recent) and patch
// its note column. Non-fatal on failure.
async function attachNote(bugId, toStatus, note) {
  if (!note || !note.trim()) return;
  try {
    const { data } = await supabase
      .from("bug_status_log")
      .select("id")
      .eq("bug_id", bugId)
      .eq("to_status", toStatus)
      .order("changed_at", { ascending: false })
      .limit(1);
    const logId = data?.[0]?.id;
    if (logId) {
      await supabase.from("bug_status_log").update({ note }).eq("id", logId);
    }
  } catch (_) { /* swallow — audit-note is best-effort */ }
}

export function useBugActions() {
  const [pending, setPending] = useState(null); // { action, bugId } or null
  const [error, setError] = useState(null);

  // Generic action runner. `patch` is the column set to SET on bug_reports.
  const run = useCallback(async (bugId, action, patch, note) => {
    setPending({ action, bugId });
    setError(null);
    const { data, error: err } = await supabase
      .from("bug_reports")
      .update(patch)
      .eq("id", bugId)
      .select("id, status")
      .single();
    if (err) {
      setError(err);
      setPending(null);
      return { error: err };
    }
    await attachNote(bugId, data.status, note);
    setPending(null);
    return { data };
  }, []);

  // Action-specific wrappers. Each sets `status` + its matching lifecycle
  // stamp. The bug_status_log trigger captures auth.uid() for the audit
  // trail, so we skip explicit *_by writes here — saves an extra round-trip
  // to supabase.auth.getUser().
  // Approve: persist the note to bug_reports.approval_notes (mig 014) so
  // the timeline's Approved-stage body can surface Joe's feedback /
  // conditions inline — not just bury it in the audit log. Still also
  // attaches to bug_status_log.note via attachNote() below for the trail.
  const approve = (bugId, note) => run(
    bugId, "approve",
    {
      status: "approved",
      approved_at: new Date().toISOString(),
      ...(note && note.trim() ? { approval_notes: note.trim() } : {}),
    },
    note,
  );
  const rejectFix    = (bugId, note) => run(bugId, "rejectFix",    { status: "wontfix" }, note);
  const markDeployed = (bugId, sha, note) => run(bugId, "markDeployed", { status: "deployed", deployed_at: new Date().toISOString(), ...(sha ? { deployed_sha: sha } : {}) }, note);
  const close        = (bugId, note) => run(bugId, "close",        { status: "verified_closed", verified_at: new Date().toISOString() }, note);
  const reopen       = (bugId, note) => run(bugId, "reopen",       { status: "reopened" }, note);
  const dismissAs    = (bugId, terminal, note) => run(bugId, "dismissAs", { status: terminal }, note); // terminal ∈ { wontfix, duplicate, needs_info }

  return { approve, rejectFix, markDeployed, close, reopen, dismissAs, pending, error };
}
