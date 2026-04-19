# Bug Triage — Daily Scheduled Task

This document is the spec for the Cowork scheduled task that owns the bug
triage loop. The task prompt lives in Cowork (`/schedule` skill); this file
is the source of truth for what the task does and why.

## Schedule
- **Cadence:** Daily at 07:00 America/New_York
- **Also runs on demand:** Joe can kick it off any time from Cowork

## Inputs (no request body)
Reads from:
- Supabase `bug_reports` table (via service-role key)
- Storage bucket `bug-screenshots`
- The `market-dashboard` git repo
- Upstream `origin/main` (to detect merged fix branches)

## What the task does

### Pass 1 — new reports (status='received')

For each row where `status='received'`:
1. Pull the full row + any screenshot(s) in `bug-screenshots/{id}/*.png`.
2. Read the relevant code paths. Use `url_hash`, `console_errors`, and the
   description to narrow scope.
3. Reproduce if possible (sandbox shell, local dev server).
4. Classify:
   - **Fixable:** write a fix + minimal guard, commit to a new branch
     `bugfix/<slug>-<report_number>`, push. Update row:
     `status='fix-proposed'`, `branch_name=...`, `triage_notes=<what I did>`.
   - **Needs more info:** update row: `status='needs-info'`,
     `triage_notes=<what to ask>`. Surface to Joe for him to email the
     reporter (don't auto-reply — user may have asked follow-up
     questions embedded in the original report).
   - **Won't fix / out of scope / duplicate:** update accordingly with a
     clear note. Surface to Joe.

### Pass 2 — resolved branches

For each row where `status='fix-proposed'` and `branch_name` is set:
1. `git fetch origin main`
2. Check if `branch_name` is an ancestor of `origin/main` (i.e., merged).
3. If merged: call the `resolve-bug-report` edge function with
   `{ report_id, resolution_note: <one-line summary from triage_notes> }`.
   The edge function sends the resolution email and marks `status='resolved'`.

### Pass 3 — 36-hour nudge

Call the `nudge-stale-bugs` edge function. It scans reports >36h old that
are still open and haven't been nudged, and sends the holding-email to each.

## What the task does NOT do
- **Never push directly to `main`.** Fixes always land on a branch — Joe
  approves the merge in GitHub.
- **Never delete reports.** If a report is wrongly filed, Joe can update the
  status (e.g. to `duplicate`) via Supabase.
- **Never email without a triage step.** Ack emails fire from the client
  path (via `submit-bug-report`); resolution emails fire only after Joe
  merges a fix.

## Output
The task writes a summary message when it finishes:
- Number of new reports triaged (by category)
- Number of fixes pushed (with branch names)
- Number of resolutions sent (auto-emailed)
- Number of nudges sent
- Any reports needing Joe's attention (won't-fix, needs-info, stuck)

## Secrets required
- `SUPABASE_URL` — standard
- `SUPABASE_SERVICE_ROLE_KEY` — to read/write bug_reports bypassing RLS
- `RESEND_API_KEY` — set in Supabase function secrets (not needed by the
  Cowork task directly; only the edge functions read it)

## SLA invariant
The 48-hour commitment we make to reporters depends on:
- Task running daily (ideally ≤ 24h gap between runs)
- Joe reviewing + merging fix branches within ~24h of push
- Nudge email fires at 36h as a safety net if the above slips
