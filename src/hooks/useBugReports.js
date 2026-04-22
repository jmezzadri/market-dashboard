// useBugReports — admin-only hook that reads public.bug_reports.
//
// Read access is RLS-gated on public.is_admin() (migration 013); a
// non-admin session gets an empty array. The Admin · Bugs page also
// soft-gates via useIsAdmin() for a friendly "Not authorized" screen.
//
// Returns rows sorted newest-first, capped at 500. Phase 1 is read-only;
// Phase 2 will add a reload/mutate path for approve/reject actions.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const SELECT_COLS = [
  "id",
  "report_number",
  "created_at",
  "updated_at",
  "user_id",
  "reporter_email",
  "reporter_name",
  "title",
  "description",
  "url_hash",
  "url_full",
  "user_agent",
  "viewport",
  "build_sha",
  "console_errors",
  "screenshot_path",
  "status",
  "complexity",
  "priority",
  "proposed_solution",
  "triage_notes",
  "branch_name",
  "triage_branch",
  "approved_at",
  "approved_by",
  "merged_at",
  "merged_pr",
  "merged_sha",
  "deployed_at",
  "deployed_sha",
  "verified_at",
  "verified_by",
  "fixed_at",
  "fixed_pr",
  "fixed_sha",
  "resolved_at",
  "ack_email_sent_at",
  "nudge_email_sent_at",
  "resolution_email_sent_at",
  "resurface_at",
  "last_triaged_at",
].join(", ");

export function useBugReports({ limit = 500 } = {}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase
      .from("bug_reports")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) { setError(error); setRows([]); }
        else { setError(null); setRows(data || []); }
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [limit, reloadTick]);

  return { rows, error, loading, reload: () => setReloadTick(x => x + 1) };
}

// useBugStatusLog — admin-only hook that reads public.bug_status_log for a
// single bug. Populates the "Activity" tab of the side panel. Returns null
// until a bugId is provided.
export function useBugStatusLog(bugId) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bugId) { setRows(null); return; }
    let mounted = true;
    setLoading(true);
    supabase
      .from("bug_status_log")
      .select("id, from_status, to_status, changed_by, changed_at, note")
      .eq("bug_id", bugId)
      .order("changed_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!mounted) return;
        setRows(data || []);
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [bugId]);

  return { rows, loading };
}
