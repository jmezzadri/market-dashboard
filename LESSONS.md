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

---

## 2026-05-02 — Engineering jargon in `AskUserQuestion` popups violates plain-English rule

**What happened:** During the freshness-chip closeout, the popup for the
"massive-universe red" decision used phrases like "ON CONFLICT DO UPDATE",
"schema change", "rate limit", "pipeline_runs table", "ingested_at column"
without translating any of them. Joe pushed back: "you need to speak
english. This is a fucking LESSON.md. READ It." The existing
"Joe is a consultant, not a developer" rule already covers this — popup
content is part of "addressing Joe" and binds the same as chat narration.

**What you should do instead:** Before sending an `AskUserQuestion` popup,
re-read every option's `label` and `description` like Joe would. Strip or
inline-define any term that wouldn't show up in a Wall Street Journal
explainer: column names, table names, SQL clauses, schema/migration,
HTTP codes, edge functions, cron syntax, JSON paths. Use analogies for
mechanism ("like a milk carton that only updates its expiration date when
you POUR milk in"). Keep the Background / Context / Impact framing per
the 2026-05-01 rule. If you'd hesitate to say a phrase out loud at a
Manhattan dinner table, it doesn't belong in the popup.

---

## 2026-05-03 — Red chips are reserved for actual breakage; weekend / unregistered = green

**What happened:** Phase 4 PR #16 made every site chip two-state (green/red,
no amber). The hook `useFreshness` defaulted UNREGISTERED elements (no
manifest entry AND no pipeline_health row AND no asOfIso fallback) to RED
with reason "no successful refresh on record." On Sunday morning May 3
Joe loaded macrotilt.com and saw the Trading Opportunities tile and
Portfolio Insights tile both red — the chips were bound to
`latest_scan_data` and `portfolio_history` and the App.jsx prop names
(`scanData?.date_iso || scanData?.date`) referenced fields that don't
exist in the JSON (the actual field is `scan_time`), so the asOfIso
fallback was always null. Joe pushed back: "I only want to know when
something breaks!!!!! I dont want red chips over weekends/holidays!!!"
Separately, several FRED daily series (hy_ig, real_rates) flipped red on
Sunday because the daily SLA was set at 25h biz-day-aware — which still
breaches on Sunday morning when 28h of biz-day time has elapsed since
Thursday's data point.

**What you should do instead:** Three binding rules going forward.

1. **The chip default for unregistered elements is GREEN, not RED.** In
   `useFreshness`, before any other status decision: if there is no
   manifest entry AND no pipeline_health row AND no asOfIso fallback, the
   element is "freshness tracking not yet configured" — render green,
   not red. A chip that lights red because we forgot to register it is
   indistinguishable from a chip that lights red because the data is
   genuinely stale; train the user to ignore reds and the alerting is
   dead.

2. **Daily-cadence SLAs absorb T+1 publish lag plus a weekend.** FRED
   publishes most daily series the next business day — so the as_of
   stays at "yesterday's data date" for a full day after the data was
   published. The SLA must be at least 49 hours of business-day-aware
   time (1 biz day for the publish lag + 1 biz day of operational
   grace + a small buffer for clock drift). The previous 25h value
   broke Joe's "no reds on weekends" rule and produced false alarms
   every Sunday morning.

3. **Every FreshnessDot consumer is registered before merge.** Adding a
   `<FreshnessDot indicatorId="X" .../>` to a tile without registering
   `X` in `data_manifest.json` AND seeding `pipeline_health` /
   `pipeline_runs` for it is a bug. The PR template's Data Steward
   sign-off must explicitly call out new chip wires; the safety net
   above is for accidents, not a license to skip registration.

---

## 2026-05-03 (b) — Monthly/quarterly SLAs absorb FRED publish lag

**What happened:** After the daily-SLA bump (25h→49h), three monthly chips
(cfnai_3ma, m2_yoy) and one daily-mis-classified series (term_premium)
were still red on Sunday May 3. Investigation: FRED publishes most monthly
series ~3-4 weeks AFTER period end. So a Mar 1 data point appears at FRED
around Apr 22-24 and stays unchanged until Apr 1 data publishes ~May 22.
Our `as_of` is the data_date (Mar 1), so the chip's calendar-aware age
hits ~50 biz days by early May while FRED is still operating on schedule.
The 816h (34 biz days) monthly SLA flipped these to red even though the
pipeline was working fine. Same pattern for quarterly: SLOOS / JOLTS
quarterly can land 8-10 weeks after quarter end. term_premium was
classified daily but FRED's THREEFYTP10 is a weekly Fed Board release.

**What you should do instead:** SLAs floor at the worst-case publish lag
plus one full cadence cycle plus operational grace. New floors:

- daily       → 49h  (covers T+1 publish + weekend)
- weekly      → 192h (covers Mon-publish weekly + ~1 day slack); 384h for
                     series with longer FRED-side lag like Kim-Wright
                     term_premium.
- monthly     → 1200h (50 biz days; covers data point lasting ~21 biz days
                       at FRED + ~8 biz days release-window slack + 21 biz
                       days of next-period accumulation before refresh)
- quarterly   → 3600h (150 biz days = ~7 months; SLOOS/JOLTS sometimes
                       land 10 weeks after quarter end + 1 quarter cycle
                       + grace)

When in doubt, check FRED's CSV for the series and look at the typical
gap between (data_date) and (when that data point first appears as the
latest). The SLA must be at least that gap + 1 cadence cycle, otherwise
the chip will lie red for the entire interval between releases.

**Deeper fix (not in this PR):** the data_date-vs-publish-date convention
for `as_of` is inverted relative to what the chip wants. The chip is
asking "did the pipeline last run successfully and recently?" but is
reading "what's the data point's date?" Migrating monthly/quarterly
elements to read pipeline_runs.last_run_at (same way massive-* now does)
would let SLAs return to their cadence-of-data values without needing to
pad them by typical FRED lag. Filed as a follow-up.

<!-- redeploy-tickle -->
