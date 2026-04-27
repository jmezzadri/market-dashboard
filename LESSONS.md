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

**Corollary — only show pick options the proposal actually offers.**
On 2026-04-25 the first iteration of this rule shipped an unconditional
**Approve · Both** button. Most A/B proposals on this site are mutually
exclusive ("close this row OR re-triage", "wrap with a tooltip OR spell
it out"), and "Both" is nonsense in those cases. The detector now uses
two helpers: `isDecisionGated()` decides whether to swap the single
Approve for the picker at all, and `allowsBoth()` decides whether the
picker includes the Both button. Both is shown only when the proposal
explicitly invites it: "or Both", "ship both", "apply both", "do both",
or "both options". Default is to hide Both. If a future proposal needs
a third option (C) or different shape, extend both helpers — never
pre-bake choices that aren't on the table.

---

## 7. Always describe an ETF when you cite its ticker

**The rule.** Whenever you quote an ETF ticker in chat, briefly describe
what it tracks. "SOXX" alone is meaningless to Joe. "SOXX (iShares
Semiconductor — chip makers like NVDA, AVGO, AMD)" is useful. The same
applies to industry-group ETFs, sector ETFs, defensive ETFs, anything
that isn't a stock you'd see on the news every day.

**Why.** 2026-04-25, in the v8 back-test diagnostic discussion: the
analysis of why the strategy lagged in 2016, 2021, 2024 referenced
SOXX, IGV, IBB, XLF, XLV, XLI, XLE, XLY, XLP, XLU, XLB, IYR, IYZ, MGK,
QQQ, XLG, XLK, etc. without explaining what any of them held. Joe is a
non-coder consultant, not an ETF analyst. He shouldn't have to mentally
look up every ticker to follow a sector-allocation analysis. He flagged
it.

**How to apply.**

1. First mention of any ETF in a response gets a one-line description.
   Format: "TICKER (issuer + what it tracks — example holdings)".
   Examples:
   - "SOXX (iShares Semiconductor — chip makers, NVDA AVGO AMD top
     holdings)"
   - "XLF (SPDR Financials — JPMorgan, BofA, Berkshire, Visa)"
   - "IYR (iShares US Real Estate — REITs across office, residential,
     data center)"
   - "MGK (Vanguard Mega-Cap Growth — top US growth names by cap,
     heavily Mag 7)"
2. **In long responses (anything longer than ~500 words or with multiple
   tables), re-describe the ticker on EVERY reference, not just the first.**
   Joe shouldn't have to scroll back to find what a ticker was. Format:
   "MGK (Vanguard Mega-Cap Growth — Apple, Microsoft, Nvidia, etc.)" each
   time it appears. Yes it's repetitive; that's the point.
3. In short responses (a single paragraph), first-mention-only is fine.
4. When reporting a new run or starting a new conversation, re-introduce
   the tickers — don't assume context carries over.
5. This applies to defensive ETFs too. "BIL" alone means nothing. "BIL
   (1-3 month US Treasury bills, cash proxy)" is useful.
6. Tables of sector exposures should have a description column or a
   separate legend. A table that just lists ticker + return + weight
   forces the reader to look up every row.

This rule survives across versions. Every back-test diagnostic, every
allocation report, every methodology memo — describe the ticker the
first time you cite it.

---

## 8. New tabs — audit TAB_IDS and HASH_ALIASES on ship

**The rule.** When shipping a new top-level tab (or any URL hash route),
audit BOTH `TAB_IDS` and `HASH_ALIASES` in `src/App.jsx` as part of the
PR. Adding the nav item, the import, and the render condition is not
enough.

**Why.** 2026-04-25, Asset Allocation tab (v9) shipped in PR #140. I
added the React component, the import, the `NAV_ITEMS` entry, and the
`{tab==="allocation"&&<AssetAllocation/>}` render condition. I did NOT
update `TAB_IDS` (the hash resolver's whitelist of valid tab IDs) and
I did NOT update `HASH_ALIASES["asset-allocation"]` which was still
pointing at "home" as a placeholder from when the tab was in
development. Result: clicking the new nav item set the URL hash to
`#allocation`, the resolver bounced it back to "home" because
"allocation" wasn't in TAB_IDS, and the tab appeared to do nothing.
Joe flagged it. Hotfix was PR #141.

**How to apply.**

1. Every PR that adds a new tab or URL route includes BOTH:
   - Adding the new ID to the `TAB_IDS` array (the resolver whitelist).
   - Removing or repointing any matching entry in `HASH_ALIASES` —
     placeholder aliases like `"new-feature":"home"` are common in
     pre-ship periods and become bugs at ship time.
2. Self-UAT for new tabs MUST include clicking the live nav item on
   the deployed site and verifying the page renders. JSON pipeline
   working is not enough — the routing layer is where this kind of
   bug hides.
3. Also test typing the alias hash directly in the URL bar
   (e.g. `/#asset-allocation`). Aliases get used in bookmarks,
   shared links, and email links — they need to resolve to the new
   tab when the feature ships, not stay on home.


---

## 9. Auto-UAT must close or fix — never email Joe noise

**The rule.** When the auto-UAT scheduled task runs the Chrome-driven
checklist against a deployed bug, there are exactly two valid outcomes
per row: (a) every bullet passes and the row is closed as
`verified_closed`, or (b) a real defect was found and the auto-UAT
runner ships the fix (commit, PR, merge, redeploy, re-UAT) before
sending Joe an email. Emailing Joe with "checklist failed but the
shipped fix actually looks correct, please manually close" is the
wrong outcome — it's noise, not signal.

**Why.** 2026-04-26 auto-UAT sweep on bugs #1069 (bare β tooltip on
`/#sectors`), #1070 (bare AUC on `/#overview`), and #1071 (hash
routing). For #1069 and #1070 the team had shipped Option B (spell
out "Beta" / "Model accuracy") per the proposal — but the auto-UAT
checklist was written before Joe picked an option, so its hover-the-β
bullets couldn't be performed against text that no longer existed.
For #1071 the URL preservation was correct but the scroll-to-section
behavior the proposal had promised wasn't actually delivered. The
auto-UAT runner emailed all three as failures with "manual override
required." Joe's response: "Things either pass UAT or you fucking
fix them." He's right. Emailing him three failures where two were
correctly shipped and one was actually a real defect that should have
been fixed in the same sweep is exactly the noise this workflow was
supposed to eliminate.

**How to apply.**

1. **Two valid outcomes per auto-UAT row.** Either close as
   `verified_closed` after every bullet passes, or ship a fix and
   re-run UAT until every bullet passes. No third "leave it for
   manual review" outcome.
2. **Checklist-vs-shipped-option mismatches are PASSES, not
   failures.** When the proposal allowed Option A or Option B and the
   shipped code clearly implements one of them, the auto-UAT runner
   reads the deployed DOM, infers which option was shipped, and
   passes the bullets that are option-agnostic plus the bullet that
   explicitly accommodates either option. The option-specific bullets
   that test behavior the chosen option doesn't implement are not
   failures — they're not applicable. Close as `verified_closed`.
3. **Real defects get fixed in the same sweep.** When the auto-UAT
   finds a real gap between the proposal and the deployed code, the
   runner builds the fix on a `feature/dev-*` branch, merges it, and
   re-runs UAT against the new deployed bundle before deciding the
   row's outcome. Only after the redeploy fails UAT a second time do
   we email Joe — and only for the genuine repeat failure.
4. **Email Joe only when there's a decision he needs to make.**
   "Three things failed, here are details" is not a decision he
   needs to make. "Auto-UAT shipped a fix and it still fails — here's
   the diff and the screen recording, please advise" is.

---

## 9. Data pipeline before UI — always, no exceptions

**The rule.** Before any UI design work begins for a new product or
feature, audit every data point the design will reference against the
backend's actual outputs. If a single field is missing, the UI work
does not start until the backend produces it. The order is:
**data architecture → backend implementation → schema validation → UI design**.
Never the reverse, never in parallel.

**Why.** 2026-04-25, Asset Allocation tab: I shipped a v1 React
component, then on receiving Joe's storyboard for the proper page,
discovered that ~80% of the data points the new design referenced
were not produced by the backend — sector ratings for all 14 buckets,
per-bucket rationale narratives, MoM/QoQ rating deltas, themes,
historical rating series, SPY sector weights, risk scenarios, none
of it. The current `compute_v9_allocation.py` produces 5 picks plus
4 defensives plus headline numbers. Designing wireframes against the
proper storyboard was impossible without first rebuilding the backend.
Surfacing this gap as a discovery instead of running the audit before
the wireframe work is a process failure that wasted Joe's time and
forced a redesign of the redesign.

**How to apply.**

1. When the user describes a new product or page, the FIRST deliverable
   is a data audit document: every UI element the description implies
   → mapped against current backend outputs → gaps explicitly listed.
   Not implicit, not in code review. Written up as a doc.
2. The audit happens BEFORE any wireframe sketch, BEFORE any React
   component, BEFORE any HTML mockup. There is no exception to this
   ordering.
3. If gaps exist, the work plan starts with the backend rebuild and
   ends with the UI. Never the reverse.
4. If a gap is discovered mid-design, stop the design work, surface
   the gap to the user immediately, and re-plan from the data layer up.
5. Schema validation: the backend produces a JSON schema. CI fails
   if the schema breaks. UI consumes the schema. Type safety is a
   non-negotiable layer between backend and UI.

This rule survives across versions. Every new tab, every new page,
every new feature. Data first, always.

---

## 10. Don't offer the user a choice between doing it right and cutting corners

**The rule.** When proposing a path forward, "do it correctly and
bulletproof" is the only option. Never present a "compromise path"
or "phased ship" or "MVP version" alongside it as if they were
equivalent. Joe doesn't want a menu of quality levels. He wants the
work done right.

**Why.** This pattern has shown up across the project: I keep
proposing "Path 1 — do it right (slow) / Path 2 — ship a compromise
(fast)" and asking Joe to pick. Joe correctly pointed out 2026-04-25
that this is an absurd question. He hired the partner-level Lead
Developer / Senior Quant / UX Designer council to do bulletproof
work. The compromise path is never on the table for him. Continuing
to offer it forces him to keep saying "do it right" — which he
shouldn't have to do because that's the assumed default.

**How to apply.**

1. When scoping work, scope the bulletproof version. That's the only
   plan you propose.
2. If timeline matters and the bulletproof version takes longer than
   the user might expect, say so explicitly in the plan ("this is
   3-4 weeks of work to do correctly") — but don't offer a faster
   half-version as an alternative. The user can decide to defer the
   work; they don't get to pick an inferior version of it.
3. The exception is when the user explicitly asks for a phased
   approach. Then Phase 1 / Phase 2 are real plans. But never offer
   phasing unprompted.
4. "MVP" in this project means "the minimum scope that meets the
   bar." It does not mean "skipping engineering rigor to ship faster."
   Tests, error handling, monitoring, schema validation, fallback
   behavior — all of these are part of MVP.
5. Industrialization is the default — automated tests, idempotent
   runs, schema-validated outputs, monitoring, runbook for failures,
   versioned data, rollback paths. None of this is optional.

This rule pairs with rule 9. Together they mean: when starting any
new feature, the work plan is "data first, bulletproof everywhere,
no menu of quality levels."


---

## 11. When .git lock files won't unlink, fall back to a fresh shallow clone — don't keep retrying the worktree pattern

**The rule.** The build-and-ship sweep documents the worktree pattern
(create a fresh worktree from origin/main, edit, commit, push, PR). On the
sandbox-mounted Mac repo, that pattern can fail in a way that's not the
"stale .git/index.lock" footgun rule #2 of the SKILL warns about — the lock
file exists, is owned by the right user, but the sandbox cannot `unlink`
it. Every commit then errors with "Another git process seems to be
running" and the branch ends up pushed pointing at the same SHA as
origin/main (no commit landed). When you see this, abandon the worktree
pattern entirely and `git clone --depth=1 -b main https://${PAT}@github
.com/jmezzadri/market-dashboard.git /tmp/clone-<branch>` instead.

**Why.** During the 2026-04-25 hourly bugs-build sweep, the first three
PRs (#1069, #1070, #1071) all "succeeded" their `git push` step but
actually pushed at the unchanged main SHA — every commit had been silently
dropped earlier with the EPERM-on-unlink error. The sweep only caught the
miss because the next step verified the branch SHA against the head SHA.
The recovery cost was a full second run from fresh clones in `/tmp/`,
which has no host-mount permission complications. Both `.git/index.lock`
in the shared repo AND `.git/worktrees/<wt>/HEAD.lock` in each new worktree
are affected.

**How to apply.**

1. The first time a `git commit` or `git add` from a worktree returns
   "Another git process seems to be running," check `ls .git/index.lock`
   and `ls .git/worktrees/*/HEAD.lock`.
2. If the locks exist and `rm -f` fails with "Operation not permitted,"
   stop using worktrees against that repo for this run. Don't keep
   retrying — the locks are unremovable from the sandbox.
3. Switch to fresh shallow clones in `/tmp/clone-<descriptor>/`. The clone
   has its own `.git`, lives entirely on the sandbox filesystem, and has
   no shared-object or shared-lock contention.
4. After the sweep, the `/tmp/clone-*` directories can be deleted; the
   worktree leftovers in the shared repo's `.git/worktrees/` will need
   cleanup from the host (Mac terminal) on a future run, but they won't
   block subsequent clones.
5. This is a sandbox/Mac-mount issue, not a git issue — branches pushed
   from the shallow clone integrate fine with the rest of the repo, and
   the resulting PR is indistinguishable from a worktree-pattern PR.

---

## 12. Lead Developer ships PRs autonomously — no per-PR Joe-approval gate

**The rule.** Lead Developer drives the full chain end-to-end: branch →
edit → commit → push → open PR → wait for Vercel green → merge →
production deploy → UAT verify → update bug-report row to `deployed`.
Joe's role is to approve the *fix proposals* in the bug queue, not the
individual PRs that implement them. Once a bug is `status='approved'` with
a clear proposal, Lead Developer ships without asking again.

**Specialist sign-offs are still required** — UX Designer must clear any
PR touching `.tsx` / `.jsx` / `/components/` / `/styles/`, and Senior
Quant must clear any PR touching calculations / indicators / models /
scoring logic. Those sign-offs go in the PR body or in chat as part of the
ship message. They do not gate on Joe.

**Why.** Joe has flagged this preference repeatedly across many sessions:
*"you have the API keys, you do everything, I only approve the fixes."*
On 2026-04-25 the build-and-ship operator opened PR #137 (rule #11) and
held it open for "Joe approval per the all-PRs-need-approval rule," which
contradicted Joe's actual collaboration model and introduced friction he
explicitly does not want. The earlier project-instructions phrasing —
"All PRs require my approval before merging" — was carrying weight it
shouldn't, so this rule supersedes that line for routine PRs.

**How to apply.**

1. **Routine PRs ship autonomously.** Bug fixes, copy fixes, refactors,
   tooling, LESSONS.md additions documenting operational discoveries
   (like rule #11) — Lead Developer merges as soon as Vercel is green and
   the relevant specialist has signed off in the PR body.
2. **Stop and confirm only for irreversible actions.** Production
   deploys are auto via Vercel — those are fine. The ones that need an
   explicit Joe-confirm in chat before proceeding are: force pushes that
   rewrite shared history, rebasing main, dropping database tables,
   destructive schema migrations (column drops, data deletes), deleting
   branches anyone else is on, or anything else that can't be undone with
   a normal commit revert.
3. **Specialist consultation is visible in the response.** Even when
   shipping autonomously, the response that announces the merge names
   which specialist roles consulted and what they each contributed —
   this preserves the multi-agent council protocol from the project
   instructions.
4. **Bug-proposal approval still gates work.** A bug at
   `status='awaiting_approval'` does not get touched by Lead Developer
   until Joe moves it to `status='approved'`. The autonomy is on
   *implementation*, not on *what to implement*.
5. **If in doubt, ship and report.** Joe prefers a finished merge plus a
   short plain-English status note over an open PR sitting on his queue.
   He will say so in chat if a specific PR needed his eyes first; that
   becomes a one-off, not a new gate.

---

## 13. Plain-English rule applies to chat replies too — not only the website surface

**The rule.** Rule 5's no-acronyms / spell-out / define-on-first-use
discipline applies to **every reply, status note, or chat message
operators send to Joe**, not just to the website's labels and tiles.
Quant or engineering acronyms in a chat message get spelled out or
defined inline on first use, same as on the site.

**Why.** Joe directive 2026-04-25 evening, after I used "DP" in a chat
status report on bug #1076 without defining it. He pushed back: "What
is DP blank mean? You really have to stop using acronyms." Rule 5 was
written in terms of "labels, headers, and prose" on the site, which
operators (including me) were reading as "the site, not chat." That
reading is wrong — chat replies to Joe are user-facing copy too. The
existing memory entry "🚫 No acronyms in user-facing copy" was already
in place; this rule is the explicit, file-of-record version so no
operator can fall back to the narrow-reading excuse again.

**How to apply.**

1. Every acronym, abbreviation, or symbol used in a chat reply gets
   spelled out on first use *in that reply*. "DP (dark pool)," not
   "DP." "RLS (the database's row-level access rules)," not "RLS."
   "RPC (a stored function the database can call directly)," not
   "RPC." "LTTB (a chart down-sampling algorithm — picks the
   visually-meaningful points)," not "LTTB."
2. Column-header style abbreviations on the site (INS, OPT, CON, ANL,
   OVR, DP, IV, β, σ) — when a reply *refers back to those columns*,
   spell them out in the reply: "the Insider score column (labeled
   INS on the site)," not just "INS."
3. Bug numbers (#1067) and PR numbers (#135) are fine as-is — those
   are explicit identifiers Joe uses every day, not jargon.
4. Code identifiers (`composite_history_daily.json`,
   `useSortableTable`, `yForBottom`) are fine when discussing code
   internals, but the surrounding sentence should make their meaning
   plain. A reply that's mostly code identifiers is a reply that
   needs a plain-English summary at the top.
5. If unsure whether a term needs definition, define it. Reply length
   is not a constraint — Joe explicitly asks for clarity over
   brevity, and a one-clause inline definition costs nothing.

---

## 14. Use MacroTilt brand language — "Tilt", not "Active bet"

**The rule.** When a label, prose line, or chat message refers to the
model's recommended over- or under-weight vs the benchmark, call it
**Tilt** (or "MacroTilt"). The product brand IS the recommended portfolio
tilt. Never use generic finance-speak like "Active bet," "active weight,"
or "active position" in user-facing copy.

**Why.** Joe directive 2026-04-26: *"Please stop using the term 'Active
bet' it's fucking stupid - the website is called MacroTilt!!"* The phrase
is technically correct in academic literature but it obscures the brand
and feels impersonal. "Tilt" is short, branded, and obvious to anyone in
the audience (portfolio managers, risk managers, investors). It's also
the unit the back-test publishes — every recommendation is literally
"how much we tilt vs S&P 500."

**How to apply.**

1. UI labels: use **"Tilt"** for the over/underweight metric. Example
   card label: "Tilt: +5.3 pts overweight" — not "Active bet: +530bp."
2. The internal variable name in code can stay technical (`active_bp`,
   `active_bet`) — the rule applies to surfaces the user reads, not to
   the code identifiers Senior Quant works with.
3. Tier names ("Strong Overweight," "Overweight," "Market Weight,"
   "Underweight," "Strong Underweight") stay industry-standard.
4. Drawer copy, tooltips, chat replies, PR descriptions, alert email
   bodies — all use Tilt.
5. Any new metric introduced by Senior Quant that overlaps with the
   tilt concept inherits the Tilt name on the surface; UX Designer and
   Senior Quant both verify naming on PRs that introduce new finance
   terms.

---

## 15. Verify external facts before propagating — never let "canonical knowledge" through a subagent become "verified"

**The rule.** When a subagent or tool fails to retrieve an external
source (a PDF that came back binary-only, a webpage blocked, an API
returning nothing useful), and falls back to "I'll answer from
canonical knowledge instead" — that fallback is unverified. Operators
must flag it explicitly to Joe, and never characterize the resulting
output as "verified against the source."

**Why.** 2026-04-26 — Joe sent the S&P GICS Mapbook brochure as the
authoritative reference for our GICS counts. The subagent that
handled the PDF reported it was binary-only with no extractable text,
then fell back to canonical knowledge and produced the post-March-2023
counts (11 / 25 / 74 / 163). I propagated those figures into the
wireframe and the PR description as if they had been verified
against Joe's brochure. They had not. Joe's brochure cites the
pre-March-2023 counts (11 / 24 / 68 / 157). Both sets are real GICS
counts, just at different effective dates — but the moment I called
them "canonical" without flagging the source gap, I was claiming a
verification I had not performed.

**How to apply.**

1. If a subagent/tool reports it could not extract from the source
   (binary PDF, blocked URL, empty API response), treat any followup
   answer as "best-guess from training data" and label it as such in
   the chat reply: "Couldn't read the source; falling back to model
   knowledge — please verify."
2. Do not write phrases like "verified against [source]" / "per the
   brochure" / "matching the official structure" if the subagent
   never actually saw the source.
3. When the user is the one holding the source (Joe sent the link),
   defer to their citation by default. They have the document open
   and we don't.
4. For external taxonomies that change over time (GICS, ICB, NAICS,
   SIC, ISO codes), always include the effective date or version
   when displaying counts or hierarchies. "11 / 24 / 68 / 157 GICS
   structure" is ambiguous; "11 / 24 / 68 / 157 (pre-March 2023
   GICS)" is unambiguous.
5. If Joe corrects an external fact, push a fix and a LESSONS entry
   in the same PR — do not just patch silently.

## 16. Bug reporter is the specialist who found the bug — not the user

**The rule.** When any specialist (UX Designer, Senior Quant, Lead Developer,
or any future agent) files a row in the `bug_reports` table, the
`reporter_email` field MUST identify that specialist's role, not Joe's
personal email. Use the canonical strings:

- `ux-designer@macrotilt-bot`
- `senior-quant@macrotilt-bot`
- `lead-developer@macrotilt-bot`

Joe's email (`josephmezzadri@gmail.com`) is reserved for bugs Joe himself
filed via the Report Bug button on the live site, OR bugs he raised
verbally in chat.

**Why.** On 2026-04-26 night, after the post-deploy audit of the new
Asset Allocation tab, I filed eight bugs (#1085–#1092) and put Joe's
email in `reporter_email` for all of them. Joe didn't find any of them —
the UX Designer agent found four (#1086, #1089, #1091, #1092), the
Senior Quant agent found three (#1087, #1088, #1090), and Lead Developer
caught one from production console (#1085). Misattributing to Joe
destroys the audit trail: the Bug Tracker UI then says Joe is the most
prolific bug reporter on the site, when in fact most bugs come from
specialist self-audits. That undermines triage, root-cause review, and
quality metrics.

**How to apply.**

1. Before inserting a `bug_reports` row, ask: who actually surfaced
   this defect? If the answer is a specialist agent doing audit work,
   set `reporter_email` to that specialist's bot address.
2. If a specialist agent is surfacing a bug AND Joe is asking the
   question that prompted the audit (e.g. "is this rendering right?"),
   the reporter is still the specialist — Joe is the catalyst, not
   the reporter.
3. The Lead Developer reviews bug-filing batches before submission
   and challenges any row where `reporter_email = josephmezzadri@gmail.com`
   that didn't actually come from Joe.
4. Triage Sweep can use `reporter_email` to weight responses — bugs
   from `lead-developer@macrotilt-bot` may be self-fix-and-close
   candidates; bugs from `senior-quant@macrotilt-bot` always need
   Quant sign-off before close.
