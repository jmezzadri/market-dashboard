# MacroTilt LESSONS.md

A running list of operating principles for the MacroTilt multi-agent team
(UX Designer, Senior Quant, Lead Developer, and any future agents). When a
mistake or pattern is worth capturing once and applying forever, it lands
here.

Each entry has the same shape: **the rule**, **why** (the incident or
constraint that motivated it), and **how to apply** (when to invoke it).

---

## 1. Plain-English status reports — no Git jargon

**The rule.** When you report on Git/repo work to Joe, describe it in plain
English. Commit hashes are reference-only, never load-bearing.

**Why.** Joe is a non-coder. The project instructions explicitly require
plain English. On 2026-04-24, the first agent status report leaned on
phrases like "fast-forward from 2de15b0 to 7ff62ed," "pushed to
origin/main," and treated raw hashes as if Joe would interpret them. He
flagged it. This was the first entry in this file.

**How to apply.** Translate before sending:

| Don't say | Say |
|---|---|
| "fast-forward" / "ff-only" / "rebased" | "the change is now live on the main branch on GitHub" |
| "origin/main" | "the main branch on GitHub" (or just "main") |
| "HEAD" / "pushed commit 7ff62ed" | "live on GitHub" (hash in parens only if it adds value) |
| "stash," "worktree," "cherry-pick" | describe the effect, not the mechanic |

The same principle extends to all technical jargon: webhook, idempotent,
CORS, diff, rebase, JSX, bundler, hydration. Plain English, or a one-line
plain-English definition the first time it appears.

---

## 2. Bugs are filed formally — never just mentioned in chat

**The rule.** Any time any team member (UX Designer, Senior Quant, Lead
Developer, or me) spots a bug — in production, in a PR preview, in a
methodology review, anywhere — it must be filed in the `bug_reports`
table so it has a ticket number and is picked up by the next Triage Sweep.
Mentioning the bug in chat is not enough. Filing the bug is part of
finding it.

**Why.** On 2026-04-24, in the closing message for PR #120 (freshness
retrofit), I noted that the three composite dials on Today's Macro were
painting red because `composite_history_daily.json` had gone 3 days stale.
Joe correctly pushed back: that's a bug, and the way bugs become work is
they enter the system. Otherwise we have no record, no triage, no owner,
and nothing to merge a fix against. The Triage Sweep already exists
(`stage-bug-triage` edge function + the daily Cowork task) and only sees
rows in `bug_reports`.

**How to apply.**

1. The moment you describe a defect — in a PR body, a status update, a
   review comment, a Slack-style message to Joe — file the row.
2. Use the same insert path the website's "Report Bug" button uses:
   `INSERT INTO public.bug_reports (...)` via the Supabase service-role key
   from the sandbox, or call the `submit-bug-report` function path.
3. Required fields: `reporter_email`, `description`, `url_hash` (or
   `url_full`), `status='new'`. Add a `title` and `build_sha` when you
   know them.
4. Include the report number in the chat update so Joe can reference it
   ("filed as #1036").
5. If the bug is the *direct consequence* of work in flight (e.g. a UAT
   finding from the PR you're shipping), still file it — link the PR
   number in the description so the Triage Sweep can deduplicate or
   merge-fix in one pass.

This rule also applies to bugs Claude itself surfaces while doing
unrelated work — they don't get to live in chat as a footnote.
