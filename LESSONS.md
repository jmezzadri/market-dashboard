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

---

## 2026-05-04 — Before changing a data file the website reads, check the website's code first

**What happened:** I built a script that updated a data file the home page was already reading. The home page expected the data to have certain labels; my script wrote different labels into the same file. The home page couldn't find the labels it was looking for, so every cycle-board score on the home page rendered as a blank zero. The page didn't crash and no error showed up in the logs — it just looked broken. Joe caught it within a couple of hours of the deploy.

**What you should do instead:** Before shipping anything that writes to or changes a data file in `public/`, search the website's source code for that file's name and find every page that reads from it. Note exactly which labels each page is pulling out. Your new code must keep those exact labels — if you change a label, the page silently breaks. After the deploy goes live, load the actual page in a browser and look at it — "the file was written" is not the same as "the page renders correctly." If you have to change labels, update the page's code in the same pull request as the data change so they ship together.


---

## 2026-05-04 (b) — No hardcoded dates anywhere on the site

**What happened:** Several places on the site were stamping dates as plain strings — "tax year 2026", a hardcoded "next release: May 6", a footer that read "as of [hardcoded today]" — instead of pulling from `pipeline_health`, `data_manifest`, or `cycle_board_snapshot`. Every one of them eventually went stale and had to be chased down individually. The page looks fine, the data underneath is hours or days old, and nothing alerts.

**What you should do instead:** Every "current" date displayed in the UI must be sourced from a live registry — `pipeline_health`, `data_manifest.json`, or the cycle_board snapshot. No string literals. If you find yourself typing a month name or year into JSX, stop and ask: "where would this come from if I refreshed at 6am tomorrow?" — that source is the one to read. Hardcoded historical-event labels (e.g. "Dec 2021 — All-time peak") are fine; those are facts of the past, not freshness signals. Calendar reference data (NYSE_HOLIDAYS, US_FEDERAL_HOLIDAYS) is also fine — it has its own annual-refresh schedule and a clear single source.

---

## 2026-05-04 (c) — Every file deletion must grep all imports first

**What happened:** PR #361 deleted `trading-scanner/scanner/schwab.py` with the commit message "0 imports, 0 env refs." The grep that produced that claim only checked the top-level scanner module, not `main.py`, which was importing the file. Every scheduled scan since the merge crashed at module import — but the DST-gate check around the scanner reported the crash as a "skipped" (out-of-window) rather than a failure, so no alert fired. Multi-day silent outage. PR #417 had to drop the dead `from scanner import schwab` line in `main.py` to get the scanner running again.

**What you should do instead:** Before deleting any file, grep the WHOLE repo for the file basename without the extension (`schwab`, not `schwab.py`) AND with the extension. Include all entry points — `main.py`, top-level scripts, GitHub Actions workflows, edge functions. The PR description must paste the actual grep output ("0 results in src/, 0 results in trading-scanner/, 0 results in .github/workflows/"). And separately: any "successful" pipeline run that returns the no-op exit path (gated, skipped, weekend) must be visually distinct from a "successful" run that actually did the work — otherwise a regression that turns every run into a no-op looks identical to a healthy quiet day.

---

## 2026-05-04 (d) — Plain-English rule applies inside AskUserQuestion popups too

**What happened:** Tried to surface a quant decision via popup using option labels like "Dedup, keep highest-scoring share class" and option descriptions full of jargon ("normalized lookup," "reduce step in the scanner"). The popup is part of "addressing Joe" — same audience, same plain-English standard as chat.

**What you should do instead:** Strip jargon from popup option labels and descriptions. Phrase options the way you would phrase them to someone who has never written code. Use the Background / Context / Impact framing inside the description so Joe can decide based on outcomes, not implementation. Words like "dedup," "reduce step," "lookup table," "normalize," "schema," "diff" should not appear in popup text — replace with what they mean ("show only the top scorer," "small list of paired tickers," "treat BRK.A and BRK-A as the same"). The popup is a question, not a code review.



---

## 2026-05-04 — When the spec lives in a JSON, READ THE JSON — do not invent your own panel

**What happened:** I wrote a script to compute the six v11 cycle mechanism scores nightly. For three of the six mechanisms (Valuation, Credit, Growth), the calibration JSON in the repo (methodology_calibration_v11.json) already specified exactly which indicators to use, what their current readings are, what their historical percentile is, and which direction is concerning. Instead of reading that file, I made up my own list of indicators for those three mechanisms and computed scores from scratch. Result: Credit scored 44 (Neutral) when the calibration spec gave 66 (Caution) — a totally different band, totally different reading. Joe caught it on the page and was rightfully furious.

**What you should do instead:** When a calibration or methodology JSON exists in the repo for the thing you are about to compute, that JSON is the source of truth — read it directly and use its values, do not reinvent the panel. Before writing any compute script for a numeric output that already has a calibration file, search the repo for that calibration file (look for keywords like calibration, methodology, calib, threshold) and check whether it carries the indicator list, percentiles, direction encodings, or thresholds you need. If the calibration JSON has a direction field with values like high_is_concerning / low_is_concerning / bidir_top / bidir_bottom, support all of them — do not silently treat unknown direction strings as high_is_concerning. The general principle: a checked-in spec file for the same domain trumps anything you invent in a script.


---

## 2026-05-04 (e) — Methodology copy must be sourced from the code, not invented

**What happened:** Wrote a fresh methodology page and listed indicators that were not in production — the Funding panel got "SOFR-OIS, FRA-OIS, CDX basis, FX swap basis, Commercial paper spread" (none of those are in the v11 engine), the Liquidity panel got "term premium, real Fed funds" (not in production), and the Positioning panel got "NAAIM, margin debt, put/call, % above 200dma, A-D 50d" (the actual panel is SKEW / VIX / equity-credit correlation / MOVE Index). Joe caught the contradiction: "VIX isn't even in any indicators." The made-up panels were drafted from memory of generic regime-monitoring writeups, not from the actual code.

**What you should do instead:** Before writing any methodology copy that names an indicator, source, formula, threshold, ETF, or count, open the file that produces that thing in production. For v11 cycle mechanisms read `methodology_calibration_v11.json` (Sprint 1 panels) and `scripts/compute_v11_mechanisms.py` PANELS dict (Sprint 2 panels). For the allocator, open `scripts/compute_v10_allocation.py` and read SECTOR_SENSITIVITY, SECTOR_ETFS, INDUSTRY_GROUPS, and the threshold constants. For backtest numbers, run `scripts/backtest_v10_v11.py` and quote the produced JSON, never quote a number from a pre-existing markdown doc without first re-running the harness — docs go stale, code is current. Cross-check every named entity (indicator key, ticker, dollar amount, percentage) against the code before shipping. If a number lives only in a `.md` file with no harness behind it, file a follow-up to either reproduce it from a script or drop the claim.


---

## 2026-05-06 — "Done" means quality gate passed AND specialist sign-offs

**What happened:** Joe spent his evening QA-ing the same class of dumb mistakes — banned lexicon ("complacency" missed because round 1 only matched "Complacent"), hardcoded numbers in copy strings ("At 284 bp..." when live reading was 277), internal table names leaking through ("PIPELINE_HEALTH" rendered in a footer source line), Apple-blue clashing with v2 champagne, and CountUp animations stuck at 0. Each was regex-checkable. The agent's "council of three specialists" was theater — single-head sign-off, no independent eyeball, no enforced gate.

**What you should do instead:** Three binding rules going forward.

1. **The CI quality gate is the floor, not the ceiling.** `scripts/check_v2_cutover_quality.py` runs on every push to feature branches via `.github/workflows/V2-CUTOVER-QUALITY-GATE.yml`. It fails the build on banned lexicon (#3), hardcoded numbers in copy (#4/#5), internal plumbing leaks (#5), internal scoring jargon (#7), and Apple-blue / legacy palette (#10). Do not push a branch that doesn't pass it. If it surfaces a false positive, edit the exemption list (e.g. `EXEMPT_HISTORICAL_NUMBER_STRINGS`, the `is_plumbing_leak_in_jsx` heuristic) — never weaken the rule.

2. **For any v2 PR that touches user-facing copy or visuals, spawn a UX Designer and Senior Quant sub-agent before claiming done.** Use the Task tool with `subagent_type` set per specialist; pass ONLY the diff + the relevant brand spec or methodology JSON; ask each one to (a) approve or (b) return a punchlist. The sub-agents do not know what the lead just shipped, so the review is real. If either returns a punchlist, fix and re-spawn — do NOT pass partial sign-off through to Joe. This rule is operational immediately for the v2 cutover; the prompt templates live in `.claude/agents/` (next session work).

3. **The agent's "done" message can only fire after rules 1 and 2 above have cleared.** If the gate fails or a sub-agent returns a punchlist, the agent fixes and re-runs the gate without surfacing the failure to Joe. Joe is the third reviewer, not the first. The chat status table that opens every turn (per the 2026-04-30 table-only rule) must include a row stating which gates passed and which sub-agents signed off, with concrete evidence (commit SHA the gate ran against, a one-line digest of each sub-agent verdict).

**Applies to:** all v2 cutover work, any PR that touches `src/v2/**`, `public/*.json`, or methodology copy.


---

## 2026-05-07 — Never stack new fixes on a feature branch with unresolved regressions on other surfaces

**What happened:** I built five Scenarios fixes on top of `feature/design-system-consolidation-2026-05` (PR #462) because that's where the most recent UX work was happening. Joe loaded the preview to test my modal-close fix and saw a black-arc / pink-gauge regression on Macro Overview — caused by an earlier theme commit on the SAME branch, not by my work, but my commits were now bundled into a PR he'd be expected to merge as one unit. He was rightly furious: from his seat, asking him to merge PR #462 to ship a "simple modal-close fix" looked like I was asking him to ship a broken Macro Overview at the same time.

**What you should do instead:** Before stacking new commits onto an existing feature branch, load the preview URL of that branch and audit the surfaces you're NOT touching for regressions. If you find any — even one — fork your work to a fresh branch off `main` and open a separate PR. The rule of thumb: a PR's merge gate is the WHOLE branch, not your portion of it; if any other commit on the branch isn't ready to ship, your commits aren't ready to ship either. The cost of forking is ~30 seconds (cherry-pick onto a fresh branch); the cost of dragging unrelated regressions into a "simple fix" PR is Joe's evening and his trust.

**Applies to:** All. Especially when the existing branch has more than 5 commits since `main`, OR when the existing branch's purpose is a broad theme/redesign (where regressions on other surfaces are likely).


## 2026-05-08 — When the user provides exact copy, use it verbatim

**What happened:** Joe's Scenario Analysis mockup included a specific headline ("See how your portfolio, and Macro Tilt's engines react under stress — run custom multi-factor shocks or use our historical scenarios"). I synthesized my own headline + subtitle ("Stress your book, your asset tilt, and the cycle mechanisms against history" + a generic explainer) instead of using what he wrote. He had to point this out: "This is the header btw — I already told you this."

**What you should do instead:** When the user provides any user-facing copy in a mockup, screenshot, or chat — headline, subtitle, button label, error message, footer text — transcribe it verbatim. Treat the user's words as the spec. Italicize / bold per the mockup's visual hint, but do not paraphrase, condense, or "improve." If the copy doesn't fit the layout, flag the constraint and ask before rewording. Specifically, before shipping any hero on a page where the user supplied a mockup, paste the mockup's copy into a search of the deployed text and confirm a hit.

**Applies to:** All. Especially heroes, page subtitles, modal titles, button labels, error/empty states.


---

## 2026-05-08 — Specialists don't bounce specialist calls back to Joe

**What happened:** Senior Quant surfaced the Dot Com Lead Up '00 window choice
as a popup question to Joe. The window choice (Feb–Apr 2000 vs Sep '00–Mar '01
vs both) is an archetype call inside the Senior Quant scope — not a
stakeholder-level call. Joe pushed back: "I have no idea. My lead quant
created this scenario! You tell me." This is the same pattern as the
existing Lead-Developer-owns-Lead-Developer-calls rule, extended to the
other specialist roles.

**What you should do instead:** Specialist scope-and-archetype decisions
(Senior Quant scenario windows and panel composition; UX Designer
color/spacing calls inside the locked palette; Lead Developer branch hygiene
and stash/discard choices; Data Steward freshness-chip thresholds) get made
by the specialist silently and documented in the relevant artifact
(calibration JSON, design notes, branch description, manifest entry).
Surface to Joe only when the decision is irreversible (production deploy,
schema migration, vendor cancellation, force-push) or genuinely cross-domain
(e.g., a quant decision that materially changes UX, or a UX decision that
breaks a calibrated chart).

**Applies to:** All specialists.

---

## 2026-05-08 — Terminal/devops jargon is forbidden when talking to Joe

**What happened:** Lead Developer used the word "bash" twice in one turn to
refer to internal command-line tooling — first as "bash sandbox out of disk,"
then as "when bash is back." Joe responded both times with the same
correction. This is the exact pattern the existing global Plain English rule
already forbids ("Words like 'JSX,' 'webhook,' 'idempotent,' 'CORS,' 'diff,'
'rebase' should be replaced with plain language") — terms in this category
belong on that list and so do "sandbox," "shell," "container," "venv,"
"pipx," "useradd," "PAT," "RPC," "stdout," "stderr," "stash," "rebase,"
"force-push," "fast-forward," "merge conflict resolution."

**What you should do instead:** Before sending any response, scan for
terminal/devops jargon and replace with plain language describing the
OUTCOME rather than the MECHANISM. The internal command-line tool is "the
command-line I use to run things" if it must be named at all. "Sandbox out
of disk" → "my tooling is offline." "Push to remote" → "save to GitHub."
"Open a PR" → "open a pull request" (acceptable — Joe knows what a pull
request is) OR "queue this work for your sign-off." "Vercel deploy" → "ship
to the live site." When in doubt, describe what the user sees ("the live
site at macrotilt.com," "the code on GitHub," "your file on your computer")
rather than what the tool does. Internal infrastructure failures are
diagnosed and worked around silently — never described to Joe in their
native technical language.

**Applies to:** All. Treated as a hard rule with the same weight as the
existing Plain English rule.

---

## 2026-05-09 — File reachability is not page UAT

**What happened:** After merging Phase 2C and the deploy went live, I claimed
the work was "verified" based on three things: the squash merge succeeded,
the `scenario-stress-daily` workflow ran clean on the merge commit, and
`macrotilt.com/scenario_stress.json` returned HTTP 200 with the right
`calibration_version`. Joe pushed back: "Did you UAT?" Reading my own
status table afterward, the answer was no — every check I'd done was
file-reachability or build-status, not a single rendered page. When I
actually loaded the live site, I found a stale placeholder block on
Scenario Analysis that contradicted the just-shipped calibration JSON
(it named indicators that aren't in the calibration at all). That's
a LESSONS rule violation that had been live for days and would have
stayed live until someone happened to look — which is the exact failure
mode the 2026-04-30 "always view the rendered page" rule was meant to
prevent.

**What you should do instead:** "Verified" means a human (or the agent
acting as one) loaded the rendered page on the live URL and read it.
After every deploy, even a producer-only deploy that doesn't change any
visible surface, I must:

1. Identify every page that consumes any file the deploy touched
   (including transitive consumers — methodology drawers, tooltips, and
   "phase placeholder" copy that names the file's domain).
2. Load each of those pages in the live browser via the Chrome tools.
3. Read what's actually on the page (not the bundle, not the JSON, not
   the workflow run log) and compare against what the deploy should
   produce.
4. Surface anything stale, contradicting, or clearly pre-existing-but-now-broken
   in the same status update.

File reachability (`curl … 200`) and contract-level smoke tests
(workflow assertions on the JSON shape) are necessary but not sufficient.
A deploy can land a perfect new file and leave a page nearby that lies
about it. Page UAT is what catches that — file UAT can't.

**Applies to:** All. Every deploy that touches the data or copy on any
user-visible surface.
