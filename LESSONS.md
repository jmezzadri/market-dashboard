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

---

## 3. Tooltips are zero-latency — no hover delay, no fade-in

**The rule.** Every tooltip on macrotilt.com must appear the instant the
cursor enters the trigger and disappear the instant it leaves. No enter
delay, no exit delay, no opacity transition that feels like a delay.

**Why.** Joe directive 2026-04-25. MacroTilt is information-dense and
users skim — they hover-scan a tile to read three definitions in two
seconds. Browser default tooltips (the `title=` attribute, ~750 ms
delay) and most off-the-shelf tooltip libraries (200–400 ms enter
animation) both kill that workflow. A tooltip that doesn't appear by
the time the user has moved on is a tooltip the user never reads, which
defeats the entire reason for tooltips on this site (rule 5 below).

**How to apply.**

1. Use a single shared tooltip primitive across the site. Do not roll
   one-offs per component. Any new component with hover hints routes
   through that primitive.
2. The primitive's enter delay is `0 ms`, exit delay is `0 ms`, and any
   opacity transition is ≤ 50 ms. No "graceful" 200 ms fade.
3. Never use the bare `title=` HTML attribute for anything user-facing —
   the browser default is too slow and unstyleable. `title=` is fine for
   accessibility-only fallback if a styled tooltip is also present.
4. UX Designer signs off on the tooltip primitive's behavior whenever
   it's edited. Lead Developer ensures every consumer in the codebase
   uses it.

---

## 4. Every table is sortable — click any column header

**The rule.** Every data table on macrotilt.com must support
click-to-sort on every column header. Sort cycles
ascending → descending → unsorted → ascending. The active sort column
shows a visible direction indicator (arrow), and headers communicate
clickability (cursor, hover state).

**Why.** Joe directive 2026-04-25. MacroTilt's audience is portfolio
managers, risk managers, and senior business stakeholders who rebuild
the same table in their head dozens of times a day to find the largest
mover, the worst contributor, the highest weight. A static table forces
them to scan every row to answer a one-second question. Click-sort
collapses that to a single click. Static tables on this site are a
usability defect, not a stylistic choice.

**How to apply.**

1. Adopt one shared sortable-table component (or hook). New tiles that
   ship a table default to sortable; the UX Designer blocks merge if a
   static table sneaks through.
2. Sort must be stable, must respect data type (numeric columns sort
   numerically, dates sort chronologically, percent strings parse to
   numbers), and must handle nulls predictably (nulls last on ascending,
   first on descending — or hidden if the column is "rank").
3. Existing static tables get retrofitted opportunistically. When a
   static table is found, file a bug per occurrence (rule 2) so the
   Triage Sweep picks it up; do not silently fix without a ticket.
4. Senior Quant signs off if the column sort affects a calculated
   metric whose ordering has business meaning (e.g., risk rank, beta).

---

## 5. Plain-English UI copy — define every quant term with a tooltip

**The rule.** User-facing copy is for laymen. Avoid opaque quant
acronyms and symbols in labels, headers, and prose. When brevity forces
one (a column header, a dense tile), the term must carry a hover
tooltip the first time it appears on a page that defines it in one
plain-English sentence.

**Why.** Joe directive 2026-04-25, reinforcing the existing standing
rule "no acronyms in user-facing copy." MacroTilt is sold to portfolio
managers AND risk managers AND business stakeholders, and Joe (a
non-coder partner who also uses the site daily) wants the surface
readable by anyone in the room. Acronyms like IV, SD, OVR, VaR, OAS,
DV01, Z-score, CDS, and Greek symbols (β, σ, μ, α) are jargon to most
readers. Code variable names can stay compact; the rule applies to
anything the user reads.

**How to apply.**

1. Default to the spelled-out form. "Implied volatility," not "IV."
   "Standard deviation," not "SD." "Overall rank," not "OVR." "Value at
   risk," not "VaR."
2. Where space forces an acronym or symbol, attach a hover tooltip on
   first occurrence per page that defines the term in one sentence,
   plain English. The tooltip uses the zero-latency primitive from
   rule 3.
3. Senior Quant is the authority on definitions — they write the
   one-sentence tooltip copy for any quant term. UX Designer signs off
   on placement, length, and tone.
4. This rule cascades: any new metric, indicator, or score introduced
   by Senior Quant ships with its plain-English tooltip definition in
   the same PR. No separate "we'll add tooltips later" tickets.

---

## 6. Decision-gated proposals — the UI must enforce the pick

**The rule.** Whenever the build operator's proposed_solution gives Joe two
options to choose between (Option A vs Option B, "Reply A or B", "pick option",
"decision pending"), the AdminBugs panel detects the gate and replaces the
single Approve button with three explicit picks: **Approve · Option A**,
**Approve · Option B**, **Approve · Both**. Each pick writes the chosen letter
verbatim into approval_notes ("A", "B", or "Both"), so the build operator's
regex on approval_notes recognises it without further parsing.

**Why.** Joe directive 2026-04-25 (#1074). Decision-gated rows shipped to
"approved" with empty approval_notes burned a build-sweep cycle every time —
the operator skipped them and emailed back asking for a re-approval with the
pick. #1037, #1047, #1069, #1070 all hit this pattern in the last 24 hours.
The policy on the operator side stays exactly as written: skip with reason
"decision-gated approved without a pick", reset to awaiting_approval. The UI
change makes that policy unreachable in the normal flow because the single
Approve button never appears for gated rows.

**How to apply.**

1. Trigger phrases for the gate detector are mirrored from the build
   operator's pre-flight check — keep them in sync if either side adds a
   new pattern. Currently: "Reply A or B" (with optional `**` markers),
   "pick option", "pick A or B", "decision pending", or "Option A" AND
   "Option B" both present.
2. The picks must write "A", "B", or "Both" into approval_notes verbatim
   — the build operator's regex looks for those exact tokens. Any free-form
   note from the textarea is appended after a separator (`A · note text`).
3. Three-option proposals are not yet handled in the UI. If a future
   triage proposal lands with Option A/B/C, file a follow-on bug to extend
   the picker — do not silently coerce a third option to "Both".
4. UX Designer signs off on the visual treatment whenever the gated-card
   layout is touched. Lead Developer keeps the pickled-vs-non-gated path
   tested with a one-line case in the regex helper.
