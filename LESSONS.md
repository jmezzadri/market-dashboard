# LESSONS.md — MacroTilt

Binding behavioral rules for the agent council (UX Designer · Senior Quant ·
Lead Developer · Data Steward) working on MacroTilt. Read at the start of
every task per the Pre-Flight Checklist in project instructions.

## Format

Each rule is dated and structured:

```
## YYYY-MM-DD — short title

**What happened:** one sentence describing the failure mode.

**What you should do instead:** one sentence, specific and testable.
```

Older rules also live in agent auto-memory. The auto-memory and this file
serve the same purpose; this file is the one Joe controls and version-controls.
When Joe corrects a mistake, propose a new entry here before closing the task.

---

## 2026-04-30 — Self-monitor context window; offer a handoff before bogging down

**What happened:** Long multi-turn sessions accumulate context, which
slows responses and degrades quality (re-reading files, repeating proposed
fixes, longer / more diagnostic / less-actionable replies). The agent did
not proactively surface a handoff suggestion; Joe noticed the slowdown
himself and asked for one. The "should we hand off?" decision should not
require Joe to notice — it's the agent's job to monitor and offer.

**What you should do instead:** At the **start** of constructing each
response, check for these six bog signals:

1. Thrashing on the same problem for 4+ tool calls (stuck loop).
2. Responses getting longer / more diagnostic / less actionable (context heavy).
3. Re-reading files already read this session (working memory failing).
4. Proposing fixes already proposed and rejected (context truncating).
5. A turn takes >2 minutes when earlier turns were fast (response slowdown).
6. UAT-by-claim diverges from UAT-by-look — claiming code works, then
   actually loading the result and finding it doesn't (context-stale assumptions).

**Triggers:** if 2+ signals fire, OR signal #5 alone, the agent must offer
a handoff. Offer it **inline** in the response, not as a meta-comment —
produce a self-contained markdown block, copy-pastable, containing:

  - (a) What we were just trying to do
  - (b) Current branch + last 5 commits on main
  - (c) What's working / what's broken
  - (d) The immediate next action for the new session
  - (e) Any decisions made this session not yet in LESSONS.md
  - (f) Any pending merges (PRs awaiting Joe's approval)
  - (g) Any uncommitted state in `/tmp` worktrees (branch + what's pending)

**Frequency cap:** if Joe declined a handoff offer last turn, do not offer
again next turn unless a NEW signal fires.

**When NOT to offer:** mid-irreversible-action — workflow dispatched and
polling for completion, production deploy in flight, migration applying.
Finish the action first. A fresh session cannot pick up cleanly mid-action.

---

## 2026-04-30 — Agent merges autonomously; never ask Joe to click merge

**What happened:** Lead Developer opened PR #357 then PR #358 and ended both
turns with "🛑 ACTION NEEDED — Click Merge on PR #N" to push the merge click
onto Joe. Joe pushed back: "Since when am I doing all the merges!!! You do
it!" The earlier rule that "Joe approves merges" was an over-application of
the identity-bound-actions rule — merging is not identity-bound. Asking Joe
to merge every PR turns the agent into a ticket-handler instead of a
delivery system.

**What you should do instead:** When a PR is ready to merge — code shipped,
self-UAT clean, sign-offs in PR body — the agent merges it via the GitHub
API (`PUT /repos/.../pulls/{n}/merge`, squash method default). No ACTION
NEEDED block. No "click merge" prompt. After merge: delete the source
branch, run any post-merge verification (deploy monitor, scan dispatch),
report the outcome. Joe's identity-bound actions are now narrowly scoped to
(a) credentials/secrets via UI clicks, (b) explicit production-deploy
go/no-go when asked, (c) financial-data entry, (d) trades/transfers (which
the agent is forbidden from making anyway). Everything else: agent does it.

---

## 2026-04-30 — Modern SPA auth needs bundle inspection BEFORE planning a REST flow

**What happened:** PR #10 (ZH Premium scrape) initially planned as a
"~6 hour cookie-based form login build" based on the assumption that ZH
served a server-side login form. Probe v1 revealed ZH is a Next.js SPA with
Firebase auth + reCAPTCHA — none of which the original plan accounted for.
Three probe iterations were needed (instead of one) to land on the right
build approach (Path 2 manual cookie). Wasted ~1 hour on the wrong mental
model.

**What you should do instead:** Before promising a build estimate for any
"login + scrape" task against a third-party site, run a 5-minute
bundle-inspection probe FIRST: fetch the login page, grep for `<form` /
`<input type="password"` / `firebase` / `recaptcha` / `signInWith` / SPA
markers (`<div id="__next">`, `<div id="root">`, `<noscript>JavaScript`).
If the bundle uses Firebase / Auth0 / Cognito / Okta or similar managed
auth, plan against headless browser + manual cookie paths from the start —
direct REST is almost certainly blocked by reCAPTCHA / device check. The
build estimate should reflect this; surface the auth mechanism in the
opening status table.

---

## 2026-04-30 — Re-baseline against origin/main + deployed surfaces at the start of every phase

**What happened:** Phase 1 inventory of MacroTilt code made multiple wrong
"this is dead code" calls (HistoricalChart, useStockRiskMetrics,
useRiskMetricsBatch, the Insights tab, generate-commentary edge fn) because
the agent read its local checkout instead of `origin/main` and the deployed
artifacts. By the time PR #10 started, this had compounded into the agent
having a stale model of which workflows pass which env vars (caught only
when UAT-by-look found 0 premium items in production despite the smoke test
passing).

**What you should do instead:** At the start of every multi-PR phase or
non-trivial task, run a re-baseline pass: `git log -20 origin/main`, fetch
the deployed `latest_scan_data.json` / `composite_history_daily.json` etc.
via raw URL, query the deployed Supabase edge fn(s), and read the actual
GH Actions workflow files from `origin/main` — not from a local checkout
that may be days stale. "I read this file" is true only at the moment of
fetching from `origin/main`. Local copies and prior-session reads can be
silently stale.

---

## 2026-04-30 — Polygon Basic (Massive) tier silently caps historical aggs at ~2 years

**What happened:** PR #9 backfill UAT discovered Polygon's `/v2/aggs`
endpoint returns ~501 trading days of data per ticker on the Basic tier,
regardless of the requested start date. There is no error response and no
documentation surfacing the cap — the API silently truncates. This blocks
any v9-style optimizer that needs 5+ years of history from running off
Polygon alone.

**What you should do instead:** When proposing or estimating a Polygon
(Massive) backfill, assume the Basic tier returns ≤2 years per ticker
unless we've verified otherwise. Three viable patterns: (a) stay on
yfinance for historical bootstrap, (b) upgrade Polygon ($29-79/mo for full
history), (c) hybrid — one-shot yfinance bootstrap into Supabase
`prices_eod` + Massive forward-only refresh. Pattern (c) is what shipped
for v9 — see PR #353/#354. Don't propose a Polygon-only backfill without
explicit tier confirmation.

---

## 2026-05-01 — Questions to Joe carry Background + Context + Impact, popup-first

**What happened:** Phase 4 Freshness UX spec was delivered with three open
questions tucked at the bottom of the markdown file — no popup, no impact
framing per option. Joe pushed back: this is the same anti-pattern as the
existing "popup, never buried text" rule, with the added problem that even
when questions DO get asked, options arrive as bare labels ("strict 7 days,
or 7 × SLA?") with no statement of what changes for the product if Joe
picks A vs B.

**What you should do instead:** Every question to Joe — without exception
— goes through `AskUserQuestion` (popup). When a question genuinely needs
more context than the popup format can carry, ask inline in chat, but the
framing requirement still binds. Every question, popup or inline, includes
(a) **background**, (b) **context** for why this question is on the table
now, and (c) the **impact** of each option (what changes for Joe / the
product if he picks it). Option `description` fields in the popup carry
the impact text directly. Questions buried in spec docs, status tables, or
trailing prose are forbidden — Joe will not scan for them.
