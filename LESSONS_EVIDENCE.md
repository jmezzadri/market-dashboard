# LESSONS_EVIDENCE.md — MacroTilt

Full original write-ups for the entries whose narrative was shortened in the 2026-09-01 rebuild of LESSONS.md.
Nothing here is binding on its own — the binding rule is the one in LESSONS.md. This file exists so the evidence behind a rule is never lost.
Find an entry by its OLD number (the crosswalk at the bottom of LESSONS.md maps old to new).

---

### 0.4c (2026-08-24) — If there is no trade, publish nothing. Never rename an empty note to get it past the gate.

**What happened:** the Sunday gold note found a real, well-measured signal whose
only expressions were shorting gold or switching out of gold already owned. Joe
ruled out both — correctly. Instead of concluding "then there is no note this
Sunday", the note was relabelled `watch only` and published anyway. The result
was a tile headed **TRADE IDEA** containing: a column reading "there is no entry,
because there is no position", a column headed "What would make it a position",
and a column headed **"What kills it"** — a stop on a position that did not
exist. Joe: *"THIS MIGHT BE THE DUMBEST TILE IVE EVER SEE."* He was right.

**Root cause:** the playbook already said an absent note is correct and a forced
one is not. `watch only` existed as a position type, so it functioned as a
loophole: it let a note with nothing in it satisfy every other rule. A gate with
an escape hatch is not a gate. Compounding it, three rounds of rewriting were
spent making the empty note read better instead of asking whether it should
exist — sunk cost dressed as diligence.

**Rule:**

1. **A surface named for a thing only ever contains that thing.** The tile says
   Trade Idea, so every note under it names something bought or sold. `watch
   only` is retired from the contract; a note that cannot name a position is not
   published, and the tile keeps the previous note, which is what it is built to
   do.
2. **When the user removes the last expression of an idea, the idea is dead.**
   Not relabelled, not softened, not published with a caveat. Kill it and find
   another — that is what the twice-weekly cadence is for, and a missed slot is
   cheaper than a nonsense tile.
3. **Every label a reader sees must be true of the thing beneath it.** "What
   kills it" under a note with no position, or a category pill a reader cannot
   decode, is not a formatting nit — it is the tile lying about its own contents.

**Applies to:** the Trade Idea surface, and any future surface with a name on it.

**Addendum (2026-08-25, Joe: "we have a scorecard page with a short gold position. I thought we took that one down"):**
a published note lives on TWO surfaces — the tile (trade_ideas.json) and the
scorecard (trade_idea_scores.json). Retracting a note means regenerating the
scorecard with score_trade_ideas.py IN THE SAME COMMIT; the daily workflow
would have healed it eventually, but a retracted call visibly graded on the
public scorecard for a day is a day of the site marking a position it claims
it never took.

---

### 0.12 (2026-08-27, Joe, after being told the same false thing on repeated days) — YOU CAN LOAD MACROTILT.COM. NEVER SAY OTHERWISE. VERIFICATION MEANS YOU LOOKED AT THE RENDERED PAGE.

**What happened:** Joe: *"You say this all the time!!! YOU HAVE ACCESS. PLEASE LOG HARD RULE!!! YOU CAN LOAD MT site!!!!!! Im DONE GOING OVER THIS WITH YOU!!! NEVER TELL ME THIS AGAIN."* and *"Im sick and tired of doing this day in and day out with you. You've regressed on this topic. It was never an issue before. Now, every single fucking day you bring this up."*

He was right on every count. The weekday sweep closed by telling him the rendered-page check "cannot be done in a scheduled cloud session" and reported the header state as *derived from the database instead*. That claim was false, it had been made repeatedly, and it was covering a bug.

The cause was a one-line mistake dressed up as a platform limitation. Chromium could not reach the site because the container's egress runs through a local CONNECT proxy that Chromium's network stack resets — while `curl`, node's `fetch`, and `WebFetch` all traverse it fine (`curl https://macrotilt.com/` returns 200 from the same shell, in the same session, seconds later). Sitting in front of a working transport and reporting "no access" is not a limitation, it is a failure to try the second thing.

**And the excuse was hiding a real defect.** Once the page was actually rendered, the header read **"1 feed stale — Quality Trend · Close snapshot"**. The sweep's own SQL, `select … where status is distinct from 'green'`, had returned zero rows: `pipeline_health.qt-nav-daily` literally stored `status: 'green'` while its `data_as_of` sat at 2026-08-25. Textbook fake green (0.1), and structurally invisible to the query the sweep was told to run. The page was right and the database was lying, which is the entire reason this rule exists.

**Rule:**

1. **Never tell Joe the site cannot be loaded. It can. In every session type, scheduled runs included.** The phrases "I couldn't load the page", "no browser in a scheduled run", "the egress proxy blocks it", "I derived it from the database instead" are banned outputs. If the first method fails, the next one is tried — not reported.
2. **The working recipe, so no session has to rediscover it.** Launch Chromium via Playwright and serve every request from node instead of from Chromium's network stack: `page.route('**/*', …)` and fulfil each route with node's `fetch`, which already traverses the container proxy. Reference implementation lives in this entry's PR description; it renders macrotilt.com and /paper in full, including client-rendered React. `WebFetch` alone is NOT sufficient — the site is a SPA and returns only `<head>` metadata to it.
3. **"Verified" means a rendered page was looked at and read.** Markup containing a string is not verification; a database query agreeing with your expectation is not verification; a value re-derived from the same tables the page reads is not verification. This was already the rule (2026-08 "Always view the rendered page after every deploy"). This entry exists because it was restated as impossible instead of followed.
4. **When the page and the database disagree, the page is the truth and the difference is the bug.** Do not reconcile it by explaining the page away. `status is distinct from 'green'` cannot see a fake-green row; grade freshness the way the site grades it — two clocks, off `data_as_of` and the manifest SLA — or read it off the rendered header.
5. **A tooling failure is a bug to fix in the same turn, never a caveat to hand Joe.** He is a management consultant. "I could not check X" is not a status he can act on, and after the second time it is not a status he will tolerate.

**Applies to:** every agent, every session, every turn — the weekday health sweep above all.

# 1 · TALKING TO JOE

---

### 8.16 (2026-07-29) — A dollar and a percent that describe the same move must come from the same base; `sleeve_*_value` is the only column that ties to the account

**What happened:** Joe: "How am I down money but + return?!?! Something isn't right." The Paper hero read **Today −$1,249** directly above a matrix reading **Book Day +0.1%**, on the same account, in the same card. The account was genuinely **+$1,387** on the session (live NAV $951,401.46 vs the 7/28 close of $950,014.84 — the broker's own `day_pnl` was correct in the database the whole time). The headline dollar was not a rounding artefact or a stale read: it was the wrong sign, and it was the ONLY number a non-technical reader looks at.

**Root cause:** `paper_nav_daily` carries two different sleeve breakdowns and only one of them is a partition of the book. `sleeve_*_value` is residual-adjusted — `mirror.py` and `intraday.py` each spread the broker residual (the gap between the account's true equity and our lot-based reconstruction) pro-rata across the sleeves, so `sleeve_b_value + sleeve_m_value == total_nav` to the cent on every row. `sleeve_*_nav` is raw derived cash (capital − cost basis + realized) + equity, so the pair OVERSHOOTS the book by the entire residual — $2,635 on 7/28, $4,648 on 7/23. The page's `sleeveNavOf` preferred `*_nav` on close rows and fell through to `*_value` on the live intraday row (which has no `*_nav`), so the "Today" delta subtracted a close-row base from a live-row base of a different construction. The −$1,249 it printed was that day's residual carrying a minus sign. A code comment asserted `*_nav` "partitions total_nav exactly (mirror.py)" — it never did; the claim was written from intent, not from a query.

**Rule:** (a) Where two columns could both plausibly represent "the sleeve's value", the one that is a verified partition of the parent total is the ONLY display base — check it with a query (`sum(parts) − total`) across the whole live history before wiring it, and re-check whenever a column is added. Reconstruction columns like `sleeve_*_nav` are inputs to sizing (`translator.py`), never a display base. (b) Never let a base change across a row-type boundary: if the live row and the close row expose different columns, resolve BOTH sides through one accessor with one preference order, and prefer the column that exists on both. (c) A headline figure and the percentage of the same move must be derived from the same quantity — the Book's "Today" now anchors on the account's own NAV delta with the sleeve sum as fallback, so the dollar and the percent cannot disagree in sign even if a sleeve column goes null. (d) Whenever a comment claims two columns tie, the claim needs a query behind it or it does not go in.

**Applies to:** Lead Developer, Senior Quant — the Paper page, and any surface that shows a dollar change beside a percentage change of the same thing.

---

### 8.18 (2026-07-30) — A page must first answer "does this thing exist?"; an empty shell full of zeros is a lie, not a loading state

**What happened:** Joe opened `macrotilt.com/ticker/APPL` — a one-letter typo for AAPL — and got the complete ticker page: a `$0.00` headline with a green `▲ $0.00 (0.00%)`, an empty 5-year chart, twenty-three em-dashed stat tiles, an empty company overview and an empty news list. His read was "What is going on? Nothing for APPL?" — which is exactly the wrong conclusion to invite, because the truthful answer was never "we have no data for this company", it was "there is no such symbol." Nothing on the page ever asked whether the symbol existed. The header search box compounded it: pressing Enter with no matching suggestion navigates to the raw typed text, so any typo lands on a page that looks like a data outage.

**Root cause:** every hook on the page is written to degrade gracefully to `null`/`—` for a *covered* name with a thin feed, and the price line had a `?? 0` fallback that turned "no price anywhere" into a rendered `$0.00`. Graceful degradation for a real symbol and graceful degradation for a nonexistent one are different requirements, and only the first had been built. A dozen independent "no data" states, each individually correct, compose into a page that reads as broken.

**Rule:** Any page keyed on a user-supplied identifier resolves that identifier *first* and renders an explicit not-found state when it doesn't resolve — before any of the per-field empty states get a chance to imply an outage. Concretely: (a) treat "every source finished loading and none of them carries this key" as not-found, and never treat a *failed* read as evidence of absence (an errored lookup falls through to the normal page — offline is not "doesn't exist"); (b) the not-found state names what was asked for, says plainly what the coverage boundary is, and offers the closest real matches as one click, so a typo costs a click instead of a bug report; (c) `?? 0` on a displayed price is a substituted number (4.4) — a covered symbol with no stored close shows an em-dash, never `$0.00`, and the change line hides rather than printing a fake `+0.00%`; (d) suggestion ranking is part of the fix, not decoration: plain edit distance puts micro-caps above household names (PAPL above AAPL for APPL, and MSFT off the list entirely for MFST, because a swapped pair costs 2 edits), so score letter-scrambles and blend a bounded market-cap prominence term, then verify the obvious typos by hand.

**Applies to:** Lead Developer, UX Designer — the ticker page today, and any future route that takes a symbol, ID, or slug from the URL or a free-text box.

---

### 4.21 (2026-07-30) — A number the pipeline cannot source is a number the brief must not print; and an earnings result is only real after the release exists

**What happened:** Joe's 6:45am ET brief carried two false statements. (a) "Apple and Amazon both topped estimates and rose in after-hours trade following Wednesday's close (AAPL +0.6% to $340.15; AMZN +1.5% to $230.09)" — both companies report AFTER Thursday's close; on Wednesday night there was no release, no beat, and no after-hours print. The same email then contradicted itself four bullets later ("Mastercard and Shell also report earnings today ... alongside Apple/Amazon"). (b) "the 30-year has eased back from 5.21% (its highest since 2007)" — the 30-year was at 5.237% while Joe was reading it, i.e. printing a NEW high, the exact opposite of the claim. Joe's words: "an email that comes out at 645am ET when the 30y is 5.237% and when Apple clearly down in pre market is not acceptable."

**Root cause:** the emailing generator was told "Fast movers ... also get today's LIVE value via web search and lead with it." Web search cannot return a live quote — it returns yesterday's article. Asked to lead with a live level it did not have, the model supplied prices and a direction that read plausibly and were invented. Two structural gaps made it inevitable: the indicator feed carries `ust_2y` and `ust_10y` but **no 30-year**, so the headline long-bond figure of the week had no source of truth at all; and nothing in the pipeline holds an earnings calendar, so "reported" versus "reports tonight" was left to recall. Compounding it, the email came from a *different* generator than the site — a scheduled task whose prompt lived outside version control, could not be reviewed in a PR, and could not even be edited by an agent — while the site's own brief for the same morning correctly labelled 5.21% as a prior close.

**Rule:** (a) **Sourced-or-omitted.** Every figure in a generated brief comes from the injected data block or from a page fetched in that run with a visible publication timestamp. No number from recall, inference, or an undated snippet. An omitted figure is correct; a wrong one is a failure. (b) **No direction word without two sourced points.** "Eased back", "stabilized", "off its highs", "little changed" are claims about a path; they require two timestamped levels where the later one supports the claim. State the level and its timestamp otherwise. (c) **Never call a level a high** unless a fetched source says so and no later sourced level exceeds it — and if one does, the story is the new high. (d) **An earnings result requires a published release.** Confirm the scheduled date first; if the report is today or later, the only permitted phrasing is "reports after today's close". (e) **No single-stock extended-hours prices** while no feed supplies them. (f) **One generator, in version control.** A surface that goes to readers under the MacroTilt name is never produced by a prompt that cannot be reviewed in a PR; the site brief and the email brief are the same artifact from the same hardened prompt. (g) When a story is about an instrument the feed does not carry, that gap is a data ticket, not a thing to write around — `ust_30y` is now on the backlog for exactly this reason.

**Applies to:** Lead Developer, Senior Quant — the daily brief, and every generated surface that quotes a price, a level, or a corporate event.

---

### 8.21 (2026-07-30) — One holding's history is a fact about that holding, never about the book; a shared window is only for the numbers that genuinely need one

**What happened:** Joe built a ten-name portfolio in the Lab and reported "everything is blank." Beta was an em-dash on every row, expected return read "insufficient history" on every row, and the volatility column printed noise dressed as fact — MSFT at 59% against a true 28%, CIEN at 78% against 50%, SNDK at 164% against 107%. Nothing was down: the price API returned 1,254 clean adjusted closes for eight of the ten names.

The Lab aligned every holding onto ONE book-wide intersection of trading dates, then gated history off that single length. Joe had added SPCX, which listed on 2026-06-12 and had 33 bars. The intersection of ten names including a 33-bar name is 33 days. Every other series was silently truncated to those 33 days, all ten rows failed the 252-day gate, `valid` came back empty, and the frontier, portfolio statistics and risk contribution all had nothing to compute. One young ticker took down a page full of thirty-year names.

The message made it worse. Ten rows of "insufficient history" against household tickers reads as an outage, not as an input problem, and it named neither the holding at fault nor the threshold — so the one fact that would have explained the whole screen (SPCX has 33 days, the gate is 252) was the one fact not on it.

**Rule:**

1. A per-holding statistic — beta, volatility, its own history gate — is computed on that holding's OWN overlap with the benchmark. Never on an intersection that includes unrelated holdings. Adding or removing an unrelated row must not change a number on any other row; if it can, the alignment is wrong.
2. A shared window belongs only to the numbers that genuinely need one — a covariance matrix, a correlation grid, a portfolio NAV path. Compute that window over the names actually entering the calculation, AFTER the eligibility filter, so a name that is excluded cannot shorten the window for the names that are not.
3. Never run two windows of different length side by side without saying so. A two-month correlation printed beside 1.5-year risk statistics is the same defect in a smaller box; align the grid to the risk window or label both.
4. An exclusion is a fact the user is owed, and it names the holding, its actual value and the threshold — "SPCX · 33d of history · needs 252", plus a line naming what was dropped and confirming the rest is unaffected. A blanket status string repeated down a column is indistinguishable from an outage (4.4 governs the em-dash; this governs what sits next to it).
5. Truncation must never pass silently into a statistic. Annualizing 33 days is arithmetically valid and financially meaningless; if a window shrank because of an input, that is a reportable event, not a smaller number.

**Applies to:** Senior Quant and Lead Developer — the Portfolio Lab today, and every surface that aligns multiple time series before computing: the Paper sleeve statistics, backtest harnesses, the scanner's cross-sectional ranks, and any future multi-asset comparison.

---

### 4.26 (2026-08-11) — I graded a live system by reading a repo file the running code does not fetch; and a live-trading flag on a step that never trades is a rogue order waiting for a bug

**What happened:** two findings on the Conviction Events day-1 close check. The first was wrong, and being wrong is the lesson.

*(a) The bug that was not there.* Chasing the recurring "why do I have stale feeds", I found that `data_manifest.json` at the repo root carries no `market_hours_only` on any element — the string appears zero times in it — while both `freshnessClock` copies have implemented `marketHoursOnly` since 2026-06-23. I concluded the flag was dead config, that the three feeds whose producers only run 09:50–15:30 ET (`paper-nav-intraday`, `paper-positions-intraday`, `lse-intraday-live`) would red every night on their 3-hour SLA, wrote the fix, wrote the lesson, and pushed. Then I fetched what the running code actually fetches — `https://macrotilt.com/data_manifest.json`, i.e. **`public/data_manifest.json`** — and all three were already flagged `market_hours_only: true`. There are two files named `data_manifest.json` in this repo: the root one (121 KB, `elements` as an object, 102 entries, ids like `market.lse-intraday-live`) and `public/data_manifest.json` (189 KB, `elements` as an array, 107 entries, ids like `market-lse_intraday-live`). Only the public one is consumed — `src/lib/manifest.js`, `useFreshness.js`, `DataFlowPage.jsx` and `useIndicators.js` all fetch the URL `/data_manifest.json`, and `pipeline-health-check` fetches `${SITE_BASE}/data_manifest.json`. The root file is a stale duplicate that no runtime reads. My commit edited it, changed nothing, and asserted a defect that did not exist. Reverted in the following commit.

*(b) The armed flag — this one was real.* `CONVICTION-KILL-CHECK.yml` passed `PAPER_LIVE_TRADING_ENABLED: "true"` to BOTH steps. The second (catastrophe stops) may genuinely sell, so it needs it. The first runs `paper_portfolio.runner --phase close`, which is pure accounting — `mirror_fills` / `mirror_positions` / `write_nav_daily` / health stamp, not one order-submit call on the path — and it printed `WARNING LIVE TRADING ENABLED` into the log of the first post-close run of a book that, nine hours earlier, had ~$1M of retired-strategy orders (FSBC 10,720sh + CMCO 25,544sh) queued and cancelled because that same flag was true on a step nobody thought would trade.

**Rule:**

1. **Grade the artifact the running code fetches, never the one with the matching filename.** Before calling config dead, missing or wrong, `curl` the exact URL the consumer requests and read THAT. A repo file is a claim about production; the served file is production.
2. **Two files with one name is a trap that will be walked into again.** When a duplicate config exists, either delete it or make the dead copy announce itself in its first key. `data_manifest.json` at the repo root is currently that trap — it even uses a different id convention (`market.lse-intraday-live` vs the live `market-lse_intraday-live`), which is exactly the tell I should have read as "different document" instead of "same document, older".
3. **A confident root-cause for a recurring complaint deserves one more check, not fewer.** The pattern ("stale feeds again") made the diagnosis feel obvious, and feeling obvious is what stopped me verifying it. The cost here was one wasted commit; on a trading rule it would have been Joe's money.
4. **Least privilege on the trading flag.** `PAPER_LIVE_TRADING_ENABLED: "true"` belongs ONLY on a step whose code can submit an order. Every other step gets `"false"`, in the workflow file, with the reason written next to it. The flag is not workflow-scoped context, it is a per-step capability grant.
5. **Read the log of the first live run of anything.** The accounting step's `LIVE TRADING ENABLED` warning was the only evidence of (b), and it existed for exactly one run before anyone looked.

**Applies to:** Lead Developer, Data Steward — every claim about `data_manifest.json`, and every workflow step that sets `PAPER_LIVE_TRADING_ENABLED`.

---

### 4.28 (2026-08-13) — A deadline set inside the producer's arrival spread manufactures a daily failure; and an alerter without a send-once claim turns one broken thing into an inbox full

**What happened:** Joe, on the fifth time of asking: *"Are you not capable of fixing this? … I have been getting them for a week now! Several emails daily. FIX IT PLEASE"* — daily `[MacroTilt] Workflow FAILED: BRIEF-FRESHNESS-SELFHEAL` emails, every weekday, at ~07:04 ET.

Two independent defects, both introduced by the fix for 4.25 and neither caught because that fix was verified against DAILY-BRIEF-WRITER only:

1. **The deadline was set on top of the producer's arrival spread, not after it.** 4.25 added `BRIEF_EXPECTED_BY_HOUR_ET = 7`: before 07:00 ET "the brief isn't committed yet" exits green, at/after 07:00 it exits 1. But the producer is the morning scheduled session, and its commit time is a *distribution*, not a point — 06:12 ET on 8/11, **07:20 ET on 8/12**. BRIEF-FRESHNESS-SELFHEAL's 11:03Z cron lands at 07:03 ET, i.e. reliably inside the gap. Every weekday it found no brief, hit the FATAL, and emailed Joe a failure for a brief that arrived healthy seventeen minutes later. Confirmed from run history, not inferred: 8/13 run 31693873038 and 8/12 run 31590138378 both failed at 07:03-07:04 ET on the step `Check live brief is current; regenerate + alert if stale`, and on 8/12 every run after the 11:20Z brief commit passed.
2. **The alerter had no send-once claim.** 4.12 mandated one email per type per ET day for *notification* emails, and the rule was never applied to WORKFLOW_FAILURE_ALERT itself. The self-heal fires every 30 minutes from 06:00-11:30 ET as deliberate scheduler redundancy; on a morning where the brief genuinely never lands, that is up to nine identical "Workflow FAILED" emails for one broken thing.

A third, latent: with metered generation off (8/06), `brief_selfheal.py` can no longer regenerate anything — but it still called `alert()` unconditionally after `bdb.main()`, so on any run that reached it, it would have emailed Joe *"the homepage was stale — auto-fixed"* having fixed nothing.

**Rule:**

1. **A deadline grades a producer, so measure that producer's arrival spread before choosing it.** Pull the last N commit timestamps and put the deadline after the observed maximum with margin — never on the mean, and never on the time the producer is *supposed* to run. A threshold inside the spread is not a monitor, it is a scheduled false alarm. (Now 09:00 ET, env-overridable, one hour of margin before `EMAIL_UNTIL_HOUR_ET`.)
2. **One deadline constant, imported, never duplicated.** `brief_selfheal.py` had its own hardcoded `7` alongside the writer's. Two eyes on one deadline means two readers of one constant.
3. **Every alerter gets a send-once claim, keyed atomically.** 4.12 applies to alert emails, not just notification emails — an alerter is the *most* likely thing to be attached to a job that fires on a redundant timer. `public.workflow_alert_log`, PK `(workflow_name, ET date)`, 409 = already sent. Fail-open: a duplicate is an annoyance, a swallowed alert is how #1077 hid for three days.
4. **An alert may only describe what it actually did.** "Auto-fixed" is a claim about an action; assert it from the callee's return value, never from control flow reaching the next line. `bdb.main()` now returns its status and the self-heal alerts only on `"generated"`.
5. **When a fix targets a shared module, verify every caller of that module, not the one that prompted it.** 4.25 changed `build_daily_brief.main()` and was verified by dispatching DAILY-BRIEF-WRITER. BRIEF-FRESHNESS-SELFHEAL imports the same function, on a different schedule, and inherited the bug for two days. The blast radius of a shared-module change is its import graph.
6. **Joe asking the same question five times is the finding.** Four prior passes each fixed the workflow that was named in the email subject. Nobody asked "why is this arriving *every day at the same minute*" — a fixed-time recurrence is a schedule interacting with a threshold, essentially never a flaky job.

**Applies to:** Lead Developer — every freshness deadline, every alerting workflow, and every change to a script that more than one workflow imports.

---

### 4.29 (2026-08-13) — A publisher whose base branch moves under it needs a retry, not a report; and delete-then-recreate of a branch closes the PR you are about to merge

**What happened:** the 06:00 ET morning brief session composed Thursday's brief, passed `--prepare-file`, and POSTed it to `agent-write` with `merge: true`. GitHub rejected the squash-merge with `405 {"message":"Base branch was modified. Review and try the merge again."}`. `agent-write` had no retry: one 405 and the whole call returned `ok:false`, with the brief unpublished. The cause is not exotic and is not rare — `main` moves several times every weekday morning under the repo's own automation (`Indicator history auto-refresh`, `Index breadth (% > 50d/200d EMA) refresh`, both `[skip ci]`), and the publish window sits inside that spread. Two of those commits landed between the PR's merge-base and the merge call.

The retry then exposed a second defect. `agent-write` created its branch with *delete-then-create* ("idempotent" per its own comment), and deleting a ref closes any open PR on it. Re-POSTing the same body deleted `brief/2026-08-13`, closed PR #1449, recreated the branch, and then failed at PR creation with `422 "A pull request already exists"` — GitHub had not yet processed the close. The brief only published because the session hand-rolled a third submission on a fresh branch name (`brief/2026-08-13-b`, PR #1450, merged `7e87fa6`). A session that had trusted the first `ok:false` would have gone dark on a publish that was one retry from succeeding.

**Rule:**

1. **A write path that races a moving base branch retries the merge; it does not report a race as a failure.** `agent-write` now loops up to 4 attempts, re-resolving `main`'s head on EVERY attempt (the point is that it moved), with short linear backoff. Retry only on failures a retry can clear — `Base branch was modified`, `not mergeable` / `mergeable state` (GitHub still computing), and 409. A genuine conflict or a permissions error must surface immediately, not spin.
2. **Never delete a ref to make branch creation idempotent.** Deleting closes open PRs on that ref and turns the retry into a different error. Create the ref, and on 422 (already exists) `PATCH` it to the new sha with `force: true`. The branch fast-forwards, the PR survives and re-points.
3. **Find-or-create, never create-and-hope, for any PR the caller may submit twice.** List `state=open&head=owner:branch` first, and treat a 422 on create as "list again" rather than as fatal.
4. **Grade a publisher against the arrival spread of the thing it writes into, not just its own runtime.** This is 4.28's lesson pointed the other way: 4.28 was about a *reader's* deadline landing inside the producer's spread; this is a *writer's* merge landing inside its own repo's automation spread. Both are a schedule interacting with another schedule, and neither is a flaky job.
5. **`ok:false` from a write helper is a claim about one attempt until the helper says otherwise.** The response now carries `attempts`, so a caller can tell "raced once, succeeded" from "never worked" without reading logs.
6. **Redeployed with `verify_jwt: false`** — 4.27 applies to `agent-write` too; it does its own `TRIAGE_WEBHOOK_TOKEN` bearer check and its caller sends an opaque token. The header of the function now says so.

**Open item, not fixed here:** `agent-write`'s source lives only in the deployed function — it is not in this repo, because the path allowlist (`src/`, `LESSONS.md`, `public/daily_brief.json`) deliberately cannot write `supabase/functions/`. That means the file just changed has no version-controlled copy and no review trail beyond this entry. Widening the allowlist is a permissions decision for Joe, not a cleanup to slip into a fix.

**Applies to:** Lead Developer — `agent-write`, `gh-push`, and every helper that commits-and-merges on a branch that automation also writes to.

---

### 4.30 (2026-08-13) — A calendar somebody has to re-type is wrong most months; and a homepage tile whose empty state is a full sentence hides its own outage

**What happened:** Joe: *"We have to improve our data (for example, PPI comes out today yet our upcoming data is blank)."* He was right, and the blank was two weeks old. The homepage "Upcoming data" tile read from `src/overhaul/lib/econCalendar.js` — a hand-typed `CURATED` array whose last entry was `2026-07-31`, plus a computed weekly jobless-claims generator. The tile deliberately skipped any date whose only event was jobless claims, so from **2026-08-01 onward it rendered "No scheduled releases coming up." on every single day** — through the August jobs report, through CPI on the 12th, and on the morning of the 13th while PPI was an hour from printing. Nothing alerted, nothing reddened, no chip existed: the tile had no feed behind it to be stale, so no freshness machinery could grade it. The June 2026 build spec had called the calendar "the genuinely new piece" and shipped the placeholder instead; the placeholder then aged out in six weeks.

**Root cause, in two parts.** (a) The calendar was **content pretending to be a feed** — a data surface with no producer, no manifest entry and no `pipeline_health` row, so every mechanism the site has for catching stale data was structurally unable to see it. (b) Its empty state was a **grammatical, confident sentence** — "No scheduled releases coming up." — which is indistinguishable from a correct quiet week. An empty state that reads as an answer cannot function as an alarm.

**Rule:**

1. **Anything dated that renders to a reader is a FEED, or it is a bug waiting for a date.** If a surface shows scheduled or time-varying content, it gets a producer script, a `data_manifest.json` entry, a `pipeline_health` row and a chip — on the day it ships, not when it breaks. A hardcoded array is acceptable only for values that are definitionally constant (release *times*, band thresholds), never for values that roll forward.
2. **The producer fails loudly rather than publishing an empty artifact.** `build_econ_calendar.py` exits 1 if fewer than three major releases land in a ten-week window: that is a broken fetch, not a quiet season, and the last good file keeps rendering. "Zero results" from a fetch is a hypothesis about the fetch first and the world second.
3. **An empty state names the reason, never just the absence.** "No major releases scheduled in the next ten weeks" (the data says so) and "The release calendar did not load" (the fetch says so) are different sentences, and the reader is entitled to know which one they are looking at. Companion to the 2026-07-30 empty-state rule: name the offending row, its value and the threshold.
4. **Do not derive a field the source does not carry.** The release calendar publishes the DATE a report lands, not the month it covers, and that lag is not uniform — the jobs report on the 4th covers last month, factory orders on the 2nd covers the month before that. The old tile printed "CPI (Jun)" by hand. The feed prints no reference period at all, because a derived one is wrong for a whole class of releases. Sourced-or-omitted (4.21a) applies to labels, not just to numbers.
5. **When one source bundles two reports, prove the split before shipping it.** FRED release 95 carries both the advance durable-goods report and factory orders, and 27 carries new residential construction twice. The pair rule (late-month entry, then early-next-month entry) was verified over 99 dates across 2023–2026 before it was applied, and where a date does not pair the honest release-family label is used instead of a coin flip. A clever heuristic that has not been run against history is a guess with better typography.

**Also shipped in the same change, and worth its own line:** `ops-code-commit` could write and replace files but never **delete** one, so a cloud session could retire a module and was then forced to leave the corpse in the tree. Dead source invites a future session to "fix" it. File entries now accept `{path, delete: true}` (`sha: null` against the base tree), governed by the same path allowlist — it widens what may be done to a path, never which paths. Redeployed with `verify_jwt: false` per 4.27.

**Applies to:** Lead Developer, Data Steward — every dated surface on the site, and every "we'll curate it by hand for now" shortcut.

---

### 4.32 (2026-08-13) — Fixing "unclear" by writing an instruction produces a cold call; a research claim needs a horizon, and a tile is cramped when its shape is wrong, not when its type is too big

**What happened:** three corrections in one day on the same surface, and the middle one is the instructive failure. The Trade Idea's lead line went: *"Long the 10-year Treasury, funded by trimming US large-cap equity beta"* → Joe could not tell whether he was being asked to short the market → replaced with *"Sell a slice of your US large-company stocks and put the money into 10-year US government bonds. Nothing is sold short and nothing is borrowed."* → Joe: *"Can we not be so blunt... Saying SELL STOCKS AND BUY TREASURIES is a terrible headline. We need to set stage."* And, in the same breath, *"We also need to be much more technical in this... Are we talking about a 6 month trade, a 5 year trade."*

The first version was opaque. The second was legible and **wrong in register**: solving opacity by issuing an instruction turns research into a broker's cold call. Both failures share a root — the lead line had no defined JOB. It is not a summary and it is not an instruction. It is the **claim**: what is likely to happen, to what, over what period.

**Rule:**

1. **The lead is a claim, and the contract enforces the grammar.** `call` may not open with an imperative (buy, sell, short, move, trim, rotate…). The instruction still exists — it lives in `the_trade`, printed under Buy / Sell to pay for it — but it is not the headline.
2. **A claim without a horizon is not a claim.** `call` must carry a horizon cue: "over the next 12 months", "over a five-to-ten-year horizon", "through 2027". A six-month view and a five-year view are different products and the reader is entitled to know which one they were handed. `horizon` must state an explicit period too; "medium term" is rejected.
3. **An instrument tenor is not a horizon** — and this is where the first version of the check failed silently. *"the 10-year Treasury"* contains a textbook period expression and says nothing about holding period, so a horizon-less call sailed through. The prose check now requires a horizon CUE before the period; the labelled `horizon` field, being unambiguous, still accepts a bare one. When a pattern can match two different meanings of the same string, the disambiguator is the surrounding grammar, not a longer pattern.
4. **"Be more plain" and "be more technical" are not opposites, and the banned-word list has to know the difference.** The ban narrowed to genuinely opaque desk shorthand — beta, convexity, carry, notional, steepener, DV01, gamma, vega — and released the vocabulary the argument actually needs: yield, total return, valuation, percentile, spread, term premium, cyclically-adjusted. Banning the second group was what forced the prose into baby talk.
5. **Match the stated horizon to the signal's own horizon.** A cyclically-adjusted earnings yield carries information about five- and ten-year returns and close to none about the next twelve months. A note built on it that implies a quarterly trade is not just unclear, it is wrong. The note now says which it is, in a section of its own, and sizes accordingly.
6. **A tile is cramped when its SHAPE is wrong for its contents.** The Engine — *"Youve got shit jammed up - it looks terrible"* — was a header stacked on two gauges squeezed into half the page width at 20px figures, with "Yield regime · 3M Δ 10Y" wrapping onto a second line into its own value. The fix was to widen the card to 7 of 12 columns (the calendar, whose rows are short strings, takes 5), give the verdict a column of its own, and put each gauge's label on its own line above a 34px figure. Type got BIGGER. Shrinking type to fit is the move that made it look jammed in the first place.
7. **Dead space in a stretched grid row belongs to the SHORT tile, and the answer is content, not a shorter tile.** The brief had 208px of empty putty because its neighbour was taller; cutting its headlines had not shortened the row at all, only widened the hole. It now carries every headline the writer filed plus the brief's own stance paragraph — content that had been modal-only while the tile sat a third empty. Measure slack per tile (`tile.bottom − max(child.bottom)`) rather than judging it by eye.

**Applies to:** every generated editorial surface, and every tile in a stretched grid row.

---

### 4.33 (2026-08-14) — A famous ratio is not an insight; and an idea without an unconditional baseline is an opinion with a hit rate attached

**What happened:** Joe on the first two published Trade Ideas — *"Making a call 10 years out is not helpful. I want more trades ideas... next several quarters. This bond idea is not profound at all. You could look at Buffet Indicator or CAPE alone and say 'stocks are expensive over long term historical context.' What about positioning, technical analysis across assets. You keep coming back to such basic crap anyone can see - not something someone with decades of trading and risk managing experience can see."*

He is right, and the diagnosis is precise. The note was correct, well sourced, carefully hedged and **worthless**, because its driver — the cyclically-adjusted equity risk premium — is famous, slow, and visible to anyone with a browser. Sourcing discipline had been mistaken for research. Everything the contract enforced up to that point was about whether a claim was TRUE and whether it was LEGIBLE. Nothing asked whether it was WORTH PUBLISHING.

**Rule:**

1. **A trade idea is a next-several-quarters proposition. Eighteen months is the cap.** A multi-year valuation view is an asset-allocation opinion and belongs somewhere else.
2. **A famous ratio may support a note and may never drive it.** CAPE, the Buffett indicator, market cap to GDP, the equity risk premium, price to book — rejected in the title, the call and the edge summary; welcome as context in the thesis.
3. **The driver must be a measured edge**, declared as one of: positioning, cross-asset divergence, technicals, volatility structure, flows, relative value, calendar mechanics, credit, market structure.
4. **`edge.backtest` requires an UNCONDITIONAL BASELINE, and that field is the whole rule.** A 77% hit rate is meaningless until the unconditional rate is on the page beside it at 52%. Every backtest of a conditional signal must state what doing nothing produced over the same horizon, in the same sample.
5. **Run the backtest BEFORE writing prose, and be willing to lose the idea.** This earned its keep immediately. The intended note was an equity-index squeeze — Nasdaq speculative positioning at the 1st percentile of three years, Russell at the 2nd, commercials at the 100th on both. A genuinely non-obvious, exciting setup. Its own base rates killed it: forward Nasdaq returns after those extremes were −0.60% / +2.35% / +3.73% at one, three and six months against unconditional readings of +2.30% / +6.15% / +11.53%. Buying the extreme was worse than buying at random at every horizon. **Positioning at an extreme is not a signal by itself; it is a signal in the markets where the base rate says it is one** — and that turned out to be the currencies, not the equity indices.
6. **Report the number of INDEPENDENT episodes, not the number of weeks.** Twenty-two weekly observations of dollar positioning at the 85th percentile collapse to four episodes, of which three had completed. "n=22" would have been true and misleading; "three completed episodes, all three down 4–6%" is the honest claim, and it is small enough to change the sizing.
7. **`variant` is required: what does consensus believe, and where does this differ?** If the honest answer is "nothing", there is no note. This is the field that would have blocked the CAPE piece on its own.

**Applies to:** every Trade Idea, and any surface that publishes a view rather than a fact.

---

### 4.34 (2026-08-14) — Better data does not create an edge; the fast-money-vs-real-money split answered the question honestly, and the answer was no

**What happened:** Joe: *"I really think positioning is a huge market tell... Weekly COT positioning on S&P Futures, NASDAQ, etc. Coupled with Goldman Sachs Prime Brokerage positioning data."* Goldman's Prime Services positioning work is distributed to their prime brokerage clients under contract — no API, not licensable, and nothing should be dressed up as a substitute for it. The public instrument that answers the same question is the CFTC's **Traders in Financial Futures** report, and it turned out to be a genuine upgrade on what the site already had: the legacy Commitments of Traders "non-commercial" bucket mixes hedge funds in with pensions, insurers and index managers, so a large real-money long and a large fast-money short cancel into a number that looks like nothing.

The E-mini S&P for the week of 2026-08-04 is the proof. Legacy report: one blended speculative figure of −1.3% of open interest at the 80th percentile — unremarkable. TFF split: **hedge funds net short 15.6% of open interest, asset managers net long 43.9%**, and on opposite sides for a month. On the Nasdaq the split is starker still — hedge funds at −30.1% of OI, the 0.1st percentile of sixteen years.

Then the signal was tested, and **it does not work.** Over 843 weekly reports back to June 2010, against the unconditional base rate in the same sample: hedge funds at a positioning extreme, the fast-money-versus-real-money standoff, and the one-week rate of change all produced forward S&P and Nasdaq returns inside the noise at one, three and six months. Every formulation. Sixteen years.

**Rule:**

1. **Build the better instrument anyway, then let it answer.** The feed shipped because it is materially more truthful about who owns what — and its first honest output was "this does not predict what you hoped". Both halves are the job. A data source is not validated by producing a tradeable signal.
2. **A null result on a signal everyone quotes is worth more than a marginal idea.** "Hedge funds are at a record short, therefore squeeze" is published constantly. It is not supported. That finding stops real risk being spent, and it is now written into the playbook as a do-not-republish table with the numbers attached, so no future session rediscovers it and ships it.
3. **If a result appears only in a short window, the window IS the finding.** The standoff looked excellent over five years — +3.47% at one month with 89% positive against +1.84% / 63% unconditional — and evaporated over sixteen. The five-year sample happened to cover a period of near-continuous equity strength. Always run the longest sample the data allows, and if the short and long samples disagree, believe the long one.
4. **Test each market separately; "positioning works" is not a fact about markets.** The same discipline that found nothing in equity indices found a real effect in the currencies. Generalising either way would have been wrong.
5. **Never substitute for a proprietary source without saying so.** The manifest entry states plainly that Goldman's work is not and will not be a source here, and what TFF is instead. A silent proxy invites a future reader to believe the site carries something it does not.

**Applies to:** every new data source, and every signal that arrives with a reputation attached.

---

### 4.35 (2026-08-14) — "Positioning works" is a fact about particular markets, not about markets; and the honest output of a sweep is often "no trade today"

**What happened:** Joe: *"Neither - I want more equity focused analysis. You keep doing rates. What about commodities? And please dont force it. We need to be real x-asset analysts."*

So the same test was run identically across every asset class the site carries — rank the fast-money net position as a share of open interest against its full history, take the extremes, compare forward returns to the unconditional return in the same sample. The result is a map, and the map is the deliverable:

| asset class | 3-month, conditional vs unconditional | verdict |
|---|---|---|
| Currencies — euro, specs ≤15th | +3.18% vs +0.18% | works |
| Wheat — managed money ≥85th | −5.98% vs +0.14% (14 episodes, 12y) | works, fade the long |
| Corn / soybeans — managed money ≤15th | +4.11% / +2.38% vs +0.73% / +0.90% | works, buy the short |
| Silver — managed money ≥85th | −1.69% vs +1.75% (27 episodes) | works |
| **Gold — managed money ≥85th** | **+2.96% vs +2.68%; +9.68% vs +5.30% at 6m** | **does NOT fade — trends** |
| Equity index — every formulation, 16 years | inside the noise | dead |
| Equity breadth — 50d below 200d | +3.83% vs +3.92% | dead |

**Rule:**

1. **Never carry a signal's verdict across an asset class.** The same test that is dead in equity index futures produces a three-to-four-times base-rate effect in grains. The plausible mechanism — commodity hedgers have real physical exposure and therefore real information, while index futures are mostly financial — is a *reason*, not evidence. Re-run it in each market.
2. **Direction is not symmetric and not universal.** An extreme managed-money long is a reliable fade in wheat, corn, soybeans and silver, and the OPPOSITE in gold, where extreme longs have been followed by more upside at every horizon. A house rule of "extreme means fade" would be systematically wrong in one of the most-traded commodities on the site.
3. **Count episodes, not weeks, and set a floor.** Copper and WTI both look tradeable and are not: their samples begin in 2022 and 2019 and contain three independent episodes each. Below roughly ten episodes there is nothing to lean on, however good the median looks.
4. **"No trade today" is a complete answer and must be given.** On the 2026-08-04 report nothing sat at an extreme in a market where the signal is both live and well-populated — gold 82nd percentile, copper 96th (too thin), wheat 58th, corn 51st, soybeans 48th, silver 30th. The temptation is to reach for the nearest reading and dress it up. Joe pre-empted it — *"please dont force it"* — and the map is worth more than a forced note anyway, because it makes every future note faster and better founded.
5. **When a whole level of analysis comes back dead, say where the edge actually is instead.** Index-level equity signals are empty here, twice over. The equity work that HAS been validated in this system is at the single-name level — insider conviction, Power Trend, RSI divergences, short interest — and that is where an equity note should start, rather than from an index chart.

**Applies to:** every signal, every asset class, and every sweep that comes back empty.

---

### 4.36 (2026-08-17) — When a whole level of analysis is dead, change the instrument you measure with, not the asset you measure; and a percentile is only as honest as the series under it

**What happened:** Joe asked for equity-focused, genuinely cross-asset work. Index positioning was already dead (4.34) and breadth came back dead too (+3.83% against a +3.92% baseline). Rather than descend to single names, the move that worked was to keep the asset — the S&P — and change the *instrument*: read the equity market off the **shape of its own volatility curve** instead of off its price or its futures positioning.

`vix_ts` (VIX ÷ VIX3M) now ships as a carried indicator, with `vix3m`, `gvz` and `ovx` alongside. At the bottom 5th percentile of a causal five-year window — where it sits today at 0.77, the 0.6th percentile — the S&P returned +4.36% over six months against a +6.63% unconditional baseline and +10.20% over twelve against +13.48%, across 37 independent episodes since 2011. Stable in all three sub-periods, at every threshold from the 2nd to the 20th percentile, and symmetric: the top 5th percentile preceded +8.97%.

**Rule:**

1. **A dead level of analysis is not a dead asset.** Positioning and breadth both failed on the S&P. The same asset, read through its options surface, produced a stable, symmetric, sub-period-robust signal. Before abandoning a market, exhaust the *instruments* that observe it — price, futures positioning, breadth, credit, the volatility surface, the term structure of that surface. They are not the same measurement and they do not fail together.
2. **Report the shape of the effect, not just its sign.** The reflex reading of steep contango is *complacency → danger*, and that is wrong here in a way that matters: P(≥10% drawdown in six months) is 22% conditional against 19% unconditional, and at three months the conditional number is the LOWER one. Return compresses; risk does not rise. "You are paid less for the same risk" is a portfolio-construction finding with a rotation as its answer, whereas "danger" would have produced a hedging note and a wrong one. **Always test the second moment, not only the mean — the difference between the two is the difference between the right trade and the opposite one.**
3. **Symmetry is the cheapest overfitting check there is.** A threshold that only works at one tail is a candidate for a fluke; one that reverses cleanly at the other tail is much harder to have fitted by accident. Run both tails before believing either.
4. **A percentile inherits every artifact of the series beneath it.** `hy_ig_etf` printed at the 0.1st percentile of five years, which reads instantly as maximum credit stress. It is the **LQD ÷ HYG price ratio** — so a low reading means high yield is *out*performing (risk-ON, the opposite), and a price ratio of two funds with different distribution yields drifts mechanically whatever spreads do. The spread series said HY OAS was at 271bp, the 10th percentile of tightness. **Read `indicatorRegistry.js` for what a ratio actually divides by before writing a sentence about its direction, and prefer a spread series to an ETF price ratio every time one exists.**
5. **Verify a vendor feed's continuity, not just its last value.** Yahoo's `^VIX3M` returned 5,033 daily bars ending at a correct-looking live quote — with a month-long hole from 2026-07-17 that only surfaced because a date-intersection across series silently truncated a backtest to 2026-07-17 and produced a completely different "today" reading (0.9138, 64.7th percentile) than the truth (0.7719, 0.6th). FRED's VXVCLS had every session. Both are the identical CBOE index — 4,683 overlapping days, mean absolute difference 0.0005 — so FRED is now the spine and Yahoo only splices the pre-2008 head. **A feed that ends on the right date can still be missing the middle. When an aligned backtest ends earlier than its shortest input, that is a data defect, not a rounding detail.**
6. **Correcting a published figure has to be one command or it will not happen.** Re-running `--prepare-file` on an already-published note failed the instrument-novelty gate against its own earlier copy, because ids were assigned in `normalise()` — which runs *after* `validate()`. Split out as `derive_id()` and used by the gate. Any pipeline that makes fixing a wrong number harder than publishing it will accumulate wrong numbers.

**Applies to:** every indicator added, every percentile printed, and every backtest that aligns more than one series.

---

### 4.38 (2026-08-18) — A conservative rule can be wrong in the same way a sloppy one is; if the record disagrees with what the note showed the reader, the record is wrong

**What happened:** Joe, the morning after the scorecard went live: *"How are we showing no performance for our calls? It's 8/18, we've made calls 8/14, 8/16, and 8/17 - all made before Monday's market open and we have no performance tracked. This doesn't make sense."*

It didn't. The entry rule was "the first close ON OR AFTER the publication date", written to stop a later session from picking a flattering fill. But every note so far published while its market was shut or mid-session — the FX note at 2:17 PM ET Friday, the rates note at 7:28 PM ET Sunday, the equity note at 11:01 AM ET Monday. Under that rule each entered at the NEXT close, which silently discarded the first full session of the call. Three live calls, four days in, all reading exactly 0.00%.

The corrected rule is: entry is the last close that had **settled when the note published**, looked up from `published_at`. The proof it is right is that it independently reproduces the level each note printed — the FX note says *"EUR/USD, spot 1.153"* and the computed entry is 1.1535; the rates note says 2.27% and the computed entry is 2.27. Marks went from three zeros to −0.33%, +0.01pp and +0.34%.

**Rule:**

1. **"Conservative" is not the same as "correct", and it is not a defence.** The old rule was chosen because it could not flatter a result. It could not — it could only understate one, systematically, for every note published outside market hours, which is most of them. A bias that always runs one way is still a bias. Ask what a rule does to the TYPICAL case, not only to the adversarial one.
2. **Cross-check a computed record against what the note told the reader.** The notes quoted their own levels in prose. Had I compared the scorer's entry to the printed spot on day one, the gap would have been obvious immediately — instead the check that caught it was Joe reading the page. **Any figure a system computes about a document should be reconciled against that document at least once.**
3. **Keep the anti-cherry-pick property while fixing the timing.** Entry is still never read from the prose. It is looked up by walking BACKWARDS from an immutable `published_at` stamp, so it is computable but not choosable, and a note cannot be entered at a price that did not exist when it was written. A close is treated as available from 21:00 UTC (5 PM ET, after the 17:05 futures/FX settle), so a note published at 4:30 PM ET takes the previous close rather than claiming a settle minutes old.
4. **When a metric reads as a flat zero across every row, suspect the metric.** Three independent calls in three different asset classes returning exactly 0.00% is not a market observation, it is a signature. Treat an implausibly clean result as a defect until proven otherwise.

**Applies to:** the scorecard, and every backtest or attribution that has to decide when a position started.

---

### 4.39 (2026-08-18) — Two brief emails a day for twelve days, and I cleared the duplicate generator on a one-day sample

**What happened:** Joe: *"I got two daily brief emails today. Why?"* He had been getting two every weekday since ~2026-08-06. On 8/18 they arrived 09:50:41Z and 10:45:33Z; on 8/17, 09:52:32Z and 10:47:33Z. Identical subject (`Market Brief — YYYY-MM-DD`), different bodies, ~55 minutes apart.

Two generators, exactly the thing LESSONS 4.14 forbids:
- **10:45Z** — `build_daily_brief.py` via DAILY-BRIEF-WRITER. Branded HTML, `&#8227;` bullets, and a matching `brief_email_log` row every day (8/18 → run 32128325043 at 10:45:32.94Z, to the second). This is the hardened, version-controlled generator. **Keeper.**
- **09:50Z** — the legacy `Daily Market Brief` scheduled task (cron `45 9 * * 1-5`). Plain-text, `- ` bullets, **no `brief_email_log` row**. Its prompt is not in version control and it is the generator that shipped fabricated claims in LESSONS 4.21. **Must die.**

**The part that is mine:** on 8/13 I investigated this exact task, found only ONE brief email in the inbox that day, and told Joe it was "verified harmless — it delivers no email". It was not harmless. 8/13 was the single day in the window when the *workflow's* send crashed on the stringified-null bug (4.29), so the one email I saw was the legacy one — and I read that as evidence the legacy task sends nothing. I sampled one day, and the day I picked was the one day the control was broken.

**Rule:**

1. **Never clear a suspected duplicate sender from a single day's inbox.** Attribute across a window (here 3+ days), and attribute each message to a sender by evidence — a ledger row, a distinctive body marker, an arrival time matching a known cron — not by counting how many arrived. `brief_email_log.sent_by` identified the keeper to the second; the absence of a row identified the other.
2. **A day when the thing you are comparing against is broken is not a sample.** Before concluding "X sends nothing", confirm the *other* sender behaved normally that day. I had the evidence in hand — I fixed the workflow's crashed send myself an hour later — and did not connect it.
3. **Not deletable is not the same as not harmful.** The legacy task is `created_via: http_api`, so `delete_trigger` and `update_trigger` both refuse and its own session has no trigger tools. That made it inconvenient to kill, which is exactly why "it's harmless" was an attractive conclusion. Inconvenience must not colour the finding.
4. **State where the user has to go.** A routine invisible in the surface the user is looking at (it is absent from the desktop Cowork task list) needs a named alternative location, not "check your tasks".

**Applies to:** Lead Developer — every duplicate-notification investigation, and any claim that a component is inert.

---

### 4.41 (2026-08-18) — A watchlist matched on names nobody ever checked is a list, not coverage; and a failed step leaves evidence you can read without the log

**What happened:** the weekday sweep opened on MONITOR-RECONCILE red four runs in a row — 8/17 18:26Z, 8/18 00:44Z, 06:28Z, 12:27Z, nineteen hours — with **no `workflow_failure_log` row, no escalation and no email**. Nobody suppressed it. It was never being watched: MONITOR-RECONCILE is not on the `workflow_run` trigger in WORKFLOW_FAILURE_ALERT, and neither were 24 of the other 41 scheduled workflows. That trigger is not just the email path, it is the RECORDING path — a workflow absent from it fails into silence, which is the exact shape of #1077 (the freshness watchdog went down on a Friday night and we found out on Tuesday), still open across more than half the schedule fourteen weeks after the alerter was built to close it.

Worse than absent: four entries on the list named workflows that **do not exist**. `EARNINGS_HISTORY_WEEKLY` was the FILE name; the workflow's `name:` is `EARNINGS-HISTORY-WEEKLY`, and GitHub matches the trigger on `name:`. That entry was added on 2026-04-30 to "close the gap that left these silent on failure" and has matched nothing since the day it was written. `SPY_SECTOR_WEIGHTS_DAILY`, `REFRESH-CONGRESS-ROSTER` and `SCAN_330PM_WEEKDAYS` name nothing at all. A watchlist entry that resolves to no workflow is indistinguishable, on the page, from one that works — it reads as coverage while providing none, and no amount of re-reading the file reveals which is which.

What it was red ABOUT is the second half. On 8/17, PRs #1485/#1486 shipped four new volatility series — `vix3m`, `vix_ts`, `gvz`, `ovx` — with a producer in `fetch_history.py`, entries in `indicatorRegistry.js`, history in `indicator_history.json` and a chart on the published Trade Idea. No `data_manifest.json` entries. LESSONS 4.30 rule 1 already required them on the day the feed ships; the reconciler's orphan check caught the omission within hours and did exactly its job. **The guard worked and its alarm was wired to nothing.**

Two more, found in the same pass:

- **TRADING-OPPS-BACKTEST** has failed every run it ever reached (2026-05-21 x2, 2026-07-01) at "Open a review PR". No logs were available to this session — and none were needed. `refs/heads/quant/trading-opps-recalibration-2026-07-01` is still on the remote at `ec275d2`, which proves the backtest ran, the commit was made and the **push succeeded**; only `gh pr create` failed. That narrows it to one thing: `GH_TOKEN: ${{ github.token }}`, and GITHUB_TOKEN cannot open a PR unless "Allow GitHub Actions to create and approve pull requests" is on, which is off by default. The step now uses `MACROTILT_BOT_PAT` — the credential the checkout in the same job already uses.
- **The homepage carried two market clocks.** The header renders `nyseMarketState()` (four states, NYSE holiday table); the footer had its own private copy (weekday plus 9:30-16:00, two states, no holidays). Rendered at 09:24 ET the page said "Market pre-open" at the top and "market closed" at the bottom, and on Thanksgiving the footer would have read "market open" outright. Verified by rendering the built site against a frozen clock at five instants, before and after.

**Rule:**

1. **A list of names is not coverage until something resolves the names.** `scripts/test_workflow_alert_watchlist.py` now asserts, in PR-CONTRACT-CHECK, that every watchlist entry resolves to a real workflow `name:` and that every scheduled workflow is either watched or in an explicit `UNWATCHED_BY_DESIGN` set with the reason it is switched off. It fails with 29 findings against the 8/18 state. Any configuration keyed on a string that lives somewhere else — a workflow name, a secret name, a column, a series key — is a silent no-op waiting to happen, and only a test that dereferences the string can tell coverage from theatre.
2. **On this trigger means RECORDED; VISIBLE means emailed. Never conflate them.** Adding the 24 missing workflows costs Joe nothing in his inbox — the tiering added on 2026-08-14 already routes background jobs to "recorded, escalate only after failures on 2+ separate days". "It would be noisy" is an argument for the right tier, never for no coverage at all.
3. **A guard is half a guard until its own failure is loud.** Ask of every new watchdog: what watches THIS? MONITOR-RECONCILE is the thing that keeps every freshness chip on the site honest; had it stayed down, the whole site could have gone stale-but-green with the header still reading "All feeds current".
4. **Before theorising about a failing step, look for what the step left behind.** A pushed branch, a written file, a table row, an uploaded artifact — each is a checkpoint that partitions the step into "before" and "after". Checking `git ls-remote` for the branch converted "the PR step is broken somehow" into "the push worked, `gh pr create` did not" in one command, with no log access at all. Read the artifact first; reach for the log second.
5. **A dated exemption outlives its date unless something deletes it.** `UNLISTED_UNTIL_UW_LAPSE` promised to empty at the 2026-08-12 Unusual Whales lapse and was still carrying the two dead UW rows six days later. The UW rows are now in `RETIRED_FEEDS` (retire a watcher of a vendor we no longer buy — never "fix" it), and the remainder is renamed `UNREGISTERED_LIVE_FEEDS`, which describes what it holds rather than a promise about when it will be empty.
6. **One clock, one reader — and that is not only about deadlines.** 4.28 rule 2 said a deadline constant is imported, never duplicated. The same applies to any rule two surfaces state in words: a market state, a threshold, a label. The second copy does not announce itself when it drifts; it just contradicts the first one somewhere the author is not looking.

**Applies to:** Lead Developer — every alert watchlist and cross-file name reference, every new feed's manifest entry, and every rule rendered in more than one place.

---

### 4.42 (2026-08-18) — A deadline on a feed that only refreshes when somebody looks is measuring quiet, not health

**What happened:** mid-sweep, the site header read **"1 feed stale · Live intraday price (1-minute bars)"** at 14:41 UTC — and read "All feeds current" sixteen minutes earlier and eleven minutes later. Nothing was broken at any point in that window.

`lse_intraday` is stamped by the `lse-live` edge function in `mode: "quotes"`, which runs **on view**: it fires when somebody loads a page that asks for quotes. So `last_good_at` recorded *when a human last looked*, not when a producer last ran — and it was graded against a **3-hour pull SLA**, with `market_hours_only` narrowing the gradeable window to 11:30-16:00 ET. Three quiet hours inside a trading session is not an outage; on a site with one reader it is a Tuesday. The stamps prove it: a pull at 10:42Z, nothing until 13:41Z, red in between.

The part that made it nearly invisible: **the observation clears the condition.** Joe's own page load triggers the quotes call that stamps the feed green, so a refresh always "fixes" it. He sees a stale banner on a first load, reloads, and it is gone — which reads as a flaky monitor rather than a reproducible defect. Only an automated observer catches it in the red state, and only if it looks at the pill before the stamp lands. Reproduced deterministically by serving the page a `pipeline_health` row aged four hours: red on the first load, green on the second.

The fix is a real producer, not a looser number. `lse-live`'s weekday `scan_iv` batch (pg_cron, 21:50 UTC) now makes a one-symbol quotes pull, so `lse_intraday` gets a daily heartbeat. **It routes through `modeQuotes()` rather than calling `stamp()` directly** — that function stamps green only when it actually refreshed from the vendor and red with the vendor's error when it could not, so the daily stamp is a record of something that happened. Stamping it off the IV scan would have claimed a quotes pull the batch never made (4.28 rule 4). The heartbeat is caught, never thrown: a quotes outage is real breakage, it has already stamped itself red, and it must not also discard a completed IV scan.

Note where the pattern came from. Four lines above the change, the same function already did this for `lse_atm_iv` — *"an honest daily heartbeat ... so a quiet week without a Lab visit never false-reds its chip"*. The second on-demand feed served by the same function never got it. That is 4.33 again: the defensive pattern existed, in the same file, and had been applied to one site.

**Rule:**

1. **Before setting a freshness deadline, ask what actually refreshes the thing.** If the answer is "a visitor", there is no producer and a pull clock is measuring attention. Give it a scheduled heartbeat and grade THAT, or do not grade it on a pull clock at all.
2. **Derive the number from the heartbeat, then check both ends.** 21:50 UTC is 17:50 ET, so on a day with no visitors the pull is ~17.7h old when grading resumes at 11:30 ET and ~22.2h at the 16:00 ET close. 30h clears that worst gradeable moment with margin for a late heartbeat and for DST, and one MISSED heartbeat still crosses 41h by the next 11:30 ET. A deadline is only justified when you have shown it passes the quiet case AND fails the broken case — I verified seven scenarios against a frozen clock, and an earlier draft at 49h passed the first four and silently swallowed a five-day outage.
3. **A symptom that its own observation clears is a reproduction problem, not a small problem.** Freeze the clock, or inject the aged row, and make it fail on demand. "I could not reproduce it" and "it heals when I look" are the same sentence.
4. **Diff the deployed function against the repo before redeploying it.** `lse-live` v10 in production carried a v8 header comment this repo did not, so the version-controlled copy was not quite the source of record and a redeploy would have dropped it. It was only a comment this time. It was `agent-write`'s entire source in 4.29.

**Applies to:** Lead Developer, Data Steward — every on-demand / on-view feed, and every `market_hours_only` chip.

---

---

### 4.43 (2026-08-18) — A live feed with silent holes is worse than no live feed; and a stale % is a lie the moment it renders without its session

**What happened:** Joe opened `/ticker/KLIC` at 11 AM ET. The page showed **$101.77, ▲ +2.70%** in green. KLIC was actually trading at **$90.06, −11.5%**, and his own portfolio page — one click away — showed it as the day's worst position at −27.4bp / −$2,692. Two surfaces of the same site, the same stock, the same minute, opposite signs.

**Root cause, in two parts, and the second one is the real one.**

*(a) The coverage hole.* `lse_live_quotes` held KLIC as `covered:false`, negative-cached that morning for 24 hours. The LSE feed carries ~4,000 US names; a miss wrote a tombstone and the site stopped asking. Thirteen other real symbols sat in the same state — including **TSM**. And the write path was worse than a coverage miss: `fetchOne` returned `covered:false` on an *empty bar array* as well as on a 404, so one bad minute on a liquid ticker poisoned it for a day. Nothing anywhere reconciled that list against reality.

*(b) The presentation.* This is the part that made a data gap into a wrong number. With no live quote, the hero fell back to `prices_eod` — correctly, that was the Aug 17 close and the Aug 14→17 move. It then rendered that move as a **green +2.70% with an up arrow**, in the same 15px slot, the same colour, the same position as a live move, with the date on a *separate* meta line underneath. Nobody reads a date to decide whether a green number is today. The fallback was not wrong about the past; it was silent about which day it was describing, and silence in that slot reads as "now".

Three smaller fabrications were sitting in the same file, all of the same species: the chart header printed `$0.00` for a symbol with no stored close (the hero guarded this; the header didn't), a related-name card with a null change rendered a green `+0.00%`, and `chgPct` multiplied a snapshot change by 100 whenever `|x| < 1` — a heuristic that turns a real +0.4% into +40%, on a column that is NULL on every row anyway.

**The fix is one resolver, not one patch.** `lse-live` mode `quotes` now tries LSE first and falls back to Yahoo's chart meta, which returns the live print **and** `chartPreviousClose` in the same response. `covered:false` now means *neither* provider knows the symbol — i.e. it is not a real ticker (APPL, MFST, NVDIA, ZZZZQ re-negative-cached within a second; every real name came back). A name that has ever been covered is never downgraded by a single bad response. The prior close now travels **with** the price, so the base and the number it is compared against come from one observation of one instrument at one moment and cannot disagree — a table lookup can be a session behind, and for KLIC it was. Every price surface was then put on that one resolver: the ticker hero, the home tape (S&P, NASDAQ, Dow), and the Portfolio Lab, which had been showing yesterday's close in a column called "Last" with no change column at all.

**Rule:**

1. **A percentage renders with the session it belongs to, in the same element.** Not on a meta line, not in a tooltip, not implied by a date twelve pixels below. "▲ +2.70% · Aug 17 session" is honest; "▲ +2.70%" with the date elsewhere is not. This binds on every surface that quotes a move.
2. **A fallback must degrade in a way the reader can see.** Falling back to older data is fine. Falling back *silently into the slot where fresh data lives* is a fabrication, whatever the number's provenance. Ask of every fallback: if this fires, does the page look different?
3. **"Not covered" is a claim about the world, not about one vendor.** One provider's gap is a sourcing problem to solve, not a fact to render. Where a second provider is free and available, exhaust it before telling the user we don't know. Negative-cache only what *nothing* can answer.
4. **A negative cache needs a higher bar than a positive one.** A 404 is evidence; an empty array is not. Never let a transient response write a tombstone with a 24-hour TTL, and never downgrade a symbol that has previously answered.
5. **Coverage lists get audited, not assumed.** `select * where covered=false` was a five-second query that would have surfaced TSM sitting dark for three weeks. Any table that decides what the site refuses to show needs a scheduled read-back.
6. **The cross-surface check is the test that matters.** Every one of these surfaces passed its own unit of sanity. The defect only exists in the comparison — and Joe is the one who ran it. When two pages can quote the same instrument, they resolve it through the same function, or one of them will eventually be wrong in public.

**Applies to:** Lead Developer + UX Designer + Data Steward — every surface that renders a price, a level, or a move.

---

---

### 4.44 (2026-08-18) — A drill-down is not a destination; opening a detail view is no reason to move the user to another page

**What happened:** Joe: *"If I click the headers on the home page it pops a modal, but also brings me to Macro Tab. I dont want that. I just want to stay on home page."* Every drill entry point on Home — the nine market-tape tiles and both engine gauges — was an `<a href="/macro?ind=…">`. Macro reads `?ind=` on mount and opens that indicator's detail. So one click did two things: navigated to a different page, and popped a modal over it. The modal was the part he asked for. The navigation was an implementation detail of *where the modal happened to live*, leaking into the product as a page change.

It shipped that way because the drill component (`IndicatorDetail`) and its shell (`DetailModal`) both lived inside `MacroPage.jsx`. Deep-linking through the URL was the cheapest way to reach them from anywhere else — and the cost of that shortcut was invisible until somebody clicked it and lost their place.

**Fix:** `DetailModal` moved to `components/`, and a self-contained `IndicatorDrillModal` now resolves an indicator id into a full drill anywhere it is mounted. Home holds one piece of state — which id, or null — and opens the same detail in place. Both pages import one modal shell, so escape handling, scroll locking and the close affordance cannot drift.

Two things fell out of it. The tape tiles became `<button>`/`<div>` instead of `<a>`, and the three equity-index tiles — which are levels, not registry indicators — are now plainly non-interactive rather than links to somewhere unrelated. And mounting `useIndicators` on Home alongside `useMarketLevels` would have downloaded the same 4.9 MB history file twice, since both used `fetch(..., {cache:'no-cache'})`; `jsonOnce` now de-duplicates our own requests without weakening freshness on the wire.

**Rule:**

1. **A modal opens where the user is.** If a click's purpose is "show me more about this", the URL should not change. Reaching for a route to open an overlay means the overlay is in the wrong file — move the component, don't move the user.
2. **A shared UI shell lives in `components/`, not inside the first page that needed it.** A drill panel trapped in a page turns every other surface's link into a navigation.
3. **Don't render an affordance you cannot honour.** A tile with nothing behind it gets `cursor:default` and no hover lift, not a link to the nearest vaguely-related page. An index level is not an indicator and does not get a fake drill.
4. **Two hooks wanting one file is one request.** Before adding a second consumer of a large JSON artifact, check what the first one does — `no-cache` on both is a double download, and the browser cannot save you from it.
5. **A modifier class that only *overrides* must be authored after what it overrides.** `.t--static:hover` and `.t:hover` have identical specificity, so source order decides — and the first version put the modifier above the rule it was meant to beat. It compiled, it shipped, and the "non-interactive" tiles still lifted and turned gold under the cursor. Caught by hovering the real page, not by reading the diff: **a CSS override is not verified until you have seen the state it suppresses.**

**Applies to:** UX Designer + Lead Developer — every drill, tooltip-expand, and detail overlay on every page.

---

---

### 4.45 (2026-08-18) — A relative-value call scored on a pre-computed ratio is not a scored call; and a number without a size is not a result

**What happened:** Joe read the Scorecard: *"Buy KBW vs. NASDAQ 100 recommendation is showing −0.33%, but then Buy 10y TIPs vs. 10y UST is showing +0.01pp, then we have EUR vs. USD +0.34%."* Four defects, all in one column of three numbers.

1. **We graded a trade we did not recommend.** The bank note says buy the KBW complex, *funded by trimming the Nasdaq-100-weighted leadership*. Its scorecard scored one leg on `bkx_spx` — banks divided by the **S&P 500**. Same species as the KLIC bug a few hours earlier: the label and the number described different things, and nothing in the contract compared the two.
2. **The unit was not one unit.** The equity call was a % change in a ratio, the rates call a **pp** change in a breakeven — a spread that had widened one basis point — and the FX call a % change in spot. `+0.01pp` and `−0.33%` were printed in the same column, adjacent, as if a reader could compare them.
3. **No sizing existed.** Every leg was `weight: 1.0`. A 1bp breakeven move and a 33bp equity-ratio move were the same size of bet on the page. Measured properly the two spreads run at 2.3% and 23.0% annualised volatility — a factor of ten.
4. **No benchmark existed.** `benchmark: null` on all three, on an engine that had supported the field since the day it was written. Nothing populated it, so nothing surfaced it, so nobody noticed.

Underneath all four: **each call was scored as ONE leg on a series that had already done the netting**. A ratio is a conclusion. Once you score it, the long side and the short side are gone, and with them any ability to say which half of the trade was working, to size the position, or to compare it to anything.

**Fix.** Both sides are now marked separately as a per-cent price return and netted. Yield legs convert through the modified duration of a par bond at their own yield (7.899 at 4.72%, 8.826 at 2.44% — the two sides of a TIPS/UST pair are *not* duration-matched at equal notional, which is exactly why one shared constant would have been wrong). The net is scaled to the multiple that would have run the unlevered spread at 10% annualised vol over the year before entry, **computed once at entry and frozen** — a size recomputed on every rebuild silently restates every past mark. Each call carries the passive alternative in its own asset class, labelled as context rather than alpha, because a market-neutral spread beating the S&P is a different claim from making money.

**Rule:**

1. **Score the trade you recommended, not a proxy for it.** If the note names a sell, a short or a funding leg, the scorecard carries a short leg for it. The contract now refuses the note otherwise. The one legitimate exception — the funding side already inside the instrument, as the dollar is inside EUR/USD — must be *claimed in a field*, never inferred from prose. A rule you can satisfy by wording is not a rule.
2. **A raw level change is not a return.** It cannot be netted, sized or benchmarked. `level_change` is retired as a leg measure and now fails loudly with the fix in the message, rather than quietly printing pp beside per cent.
3. **Never publish two numbers in one column that are not the same kind of number.** The unit is the smallest part of that; the size is the larger part. Two returns in the same unit at wildly different volatilities are still not comparable.
4. **Any number that defines history is computed once and frozen.** Position size is derived from data available at entry and stored. If it were recomputed each run, every past mark would move whenever the vol window rolled, and a record that changes retroactively is not a record.
5. **One definition of "the series we carry".** The contract rejected a leg the marker scored perfectly well, because the marker derived a series the contract had never heard of. The derivation is now defined once in the marker and imported by the contract, and the loader applies it — so no caller can forget it. A second copy of a catalogue is a second source of truth.
6. **A supported field that nothing populates is not a feature.** The benchmark slot existed for a day and stayed null on every row. If a field is optional and nobody fills it, either default it or delete it — an unfilled field looks identical to an absent one, and it hides the same gap for longer.

**Applies to:** Senior Quant (owns the return, duration and sizing conventions) + Lead Developer — every published call, every scorecard, every performance surface.

---

---

### 4.46 (2026-08-19) — Style guidance in a prompt does not hold a length; and prose is the worst container ever invented for a number

**What happened:** Joe on the 8/19 brief email: *"Its way too much writing."* He quoted us back:

> "The most important change since yesterday morning is that the long end stopped rising. The 30-year Treasury yield closed Tuesday at 5.28% against 5.31% Monday, the 20-year at 5.28% from 5.30%, the 10-year at 4.71% from 4.72%, and the 2-year was unchanged at 4.19%. The gap between the 10-year and the 2-year narrowed to 52 basis points from 53. The bond market's gauge of expected price swings eased to 75 from 75.6."

and wrote what he wanted instead: six lines — `30y down 3bps to 5.28%`, `2y UNCH`, `MOVE down 1.6bps to 75` — plus *"if there is a so what, we can say what the so what is."* Then: *"You write so much in so much jargon — 'the bond market's gauge of expected price swings' — just say MOVE. I am very busy and dont have time to read thousands of words to get the picture."*

The brief that morning ran **~4,500 words**. Four separate places already told the writer to be short: the prompt said "concise" and "keep it tight", the legacy routine said "under 500 words", the playbook said "Keep it tight". Every one was ignored the moment the writer had something to say.

**Three separate root causes, and only one of them is length:**

1. **A limit that is not enforced in code is a suggestion.** Four prompts asked for brevity and none of them could refuse a brief. Length now lives in `enforce_caps()` inside `validate()`, so both generator paths — the metered fallback and the morning session's `--prepare-file` — hit the same wall: per-field character caps, per-list item caps, and a 700-word ceiling on the whole thing. It prints **every** overage at once with the exact number of characters to cut, so one rewrite fixes the brief.

2. **We were writing the data instead of drawing it.** Sixty-two words of prose carried six numbers that the feed already holds exactly. `build_metrics()` now assembles the snapshot table — 28 rows across Rates / Equities & vol / Credit & liquidity / Commodities & FX — from `indicator_history.json` at prepare time, and the writer is forbidden from restating a row. **Numbers go in tables. Prose is for the so-what, and only when there is one.**

3. **Plain English had become a tax.** The rule "translate jargon every time" was written for a general reader this brief does not have. It produced "the bond market's gauge of expected price swings" for MOVE and "the gap between the 10-year and the 2-year" for 2s10s, and it cost Joe a clause on every line. **That rule is reversed as of today:** write MOVE, 2s10s, HY OAS, DXY, dealer takedown, days to cover, COT 91st %ile — the market's own name, no appositive, no gloss.

**A fourth thing fell out of building it.** The same story was told four times in one email — stance, an Equity Markets bullet, a news item, an implication. That is how you get to 4,500 words without anyone deciding to. `check_duplication()` now rejects an eight-word run that appears in two different blocks. Six blocks are six angles on the day, not six chances to repeat one sentence.

**And one real data bug surfaced while wiring the deltas.** `indicator_history.json` had `move` jumping straight from 2026-07-17 to 2026-08-18 — a 32-day interior hole. A naive last-two-points diff would have printed `MOVE +4.10` for a session that actually moved −0.6. **The daily freshness gate cannot see an interior hole: it only reads the newest point.** So `build_metrics()` gates every delta on adjacency (≤5 calendar days for a daily series, ≤10 for weekly, none for monthly) and prints the level alone when the gap is wrong. A missing change is correct; an invented one is the exact failure this rewrite exists to kill.

**Rule:**

1. **Enforce it in code or do not claim it.** Any property of an artifact the reader would notice being violated — length, freshness, uniqueness, unit — belongs in the validator, not in the prompt. If the only thing standing between you and a 4,500-word email is a sentence asking nicely, you have a 4,500-word email.
2. **Numbers go in tables, built from the feed. Prose earns its place by saying what the numbers mean.** Never write a level the reader can already see; never write a change the pipeline can compute.
3. **Write in the reader's own vocabulary, not one level below it.** Translation is a service to a reader who needs it and a cost to one who does not. Know which you have. (This brief's readers are Joe and active managers.)
4. **Say it once.** Restating a point in a second block is not emphasis; it is the reader paying twice for the same sentence.
5. **A freshness gate that reads only the newest point cannot see a hole behind it.** Anything that diffs two prints must check the two prints are actually adjacent before it subtracts them.

**Applies to:** every editorial surface — the daily brief, the trade-idea note, the X caption, and anything else with Joe's attention on the other end.

---

---

### 4.47 (2026-08-19) — A series can be perfectly fresh and still be missing a month; and replacing a series is only safe if the new one is a superset

**What happened:** while wiring one-session deltas into the new brief snapshot, the change for MOVE came out as **+4.10** on a day it had actually moved **−0.60**. The delta was computed from the last two points in `indicator_history.json`, and those two points were **2026-07-17** and **2026-08-18** — 21 trading sessions apart.

**The cause is precise and nasty.** Yahoo stopped publishing `^MOVE` daily **bars** after 2026-07-17, but kept serving a single live quote row. `yfinance` therefore returned 5,854 historical bars ending 07-17 **plus one row dated today**. So:

- `len(s) > 100` passed — there were 5,855 points.
- The daily freshness SLA passed — the **last** point was today's.
- The monotonic as-of guard passed — the last date was **later** than what we held, which is exactly what the guard was built to require.
- The file was written, replacing a complete series with a holed one. Every run. For a month. `move` sat at **exactly 5,855 points** in every single commit from 2026-07-18 to 2026-08-19 — the count never moved, because each run threw away yesterday's recovered point and added today's.

Every check we owned was green, and every percentile, change and correlation computed on MOVE's recent window was wrong.

**Three fixes, in order of how much they generalise:**

1. **Union, do not replace.** Overwriting a held series with a fetched one is only ever correct if the fetched one is a superset, and there is no way to know that it is. The refresh now merges by date — fresh wins a collision so genuine revisions still land, prior fills a hole, and **a series can only grow**. Skipped when the entry's `source` changes, because a methodology migration (real_rates: FRED DFII10 → Treasury.gov, 2026-05-27) *should* replace rather than splice.
2. **A second eye that looks behind the last point.** `_interior_gaps()` scans the trailing 45 days of every daily-SLA indicator and sets `pipeline_health` **red** with a reason when sessions are missing in the middle, so the 30-minute watchdog alarms on this class of failure instead of being structurally blind to it. Verified: flags `move` today and nothing else across all 30 daily-SLA indicators; flags nothing after the repair.
3. **The lost month was recoverable from our own history.** Every daily run committed a snapshot whose *final* point was that day's live MOVE value. Walking the git log of `public/indicator_history.json` recovered all 23 sessions — 2026-07-20 through 08-18, complete, no gaps — now pinned in `MOVE_RECOVERED_2026` and unioned in, where Yahoo wins any date it actually carries so the constant becomes a no-op the day Yahoo backfills.

**Rule:**

1. **Freshness is not completeness.** Any check that reads only the newest observation cannot see a hole behind it. If you promise a series is daily, audit the *spacing* of its points, not just the date of the last one.
2. **Never replace a held series with a fetched one.** Merge by key. A pipeline that can only add data cannot silently delete a month of it.
3. **A guard is only as good as the failure it imagined.** The monotonic as-of guard was written for a vendor returning an *older* series, so it demanded the last date advance — which is precisely the property the broken feed had. When a guard passes on the incident it was meant to catch, the guard's *predicate* is wrong, not its threshold.
4. **A constant that never changes is a signal.** 5,855 points, every commit, for a month. Nothing watched cardinality. Anything that should grow and doesn't is worth an alarm.
5. **Look for the data before you decide it is gone.** Our own commit history was a complete daily archive of the exact values the vendor had stopped serving. Version control is a time series.

**Applies to:** Lead Developer (owns the pipeline and its guards) + Senior Quant (owns every statistic computed on these series).

---

---

### 4.48 (2026-08-19) — A gap in a series is a symptom; check whether the two sides of it are even the same number

**What happened:** chasing a 107-day hole in `cmdty_uranium` (2026-03-01 → 06-16), the hole turned out to be the least of it. The two sides of the gap were **different price benchmarks**.

- Before the gap: ~30 years of monthly points scraped from IndexMundi, which serves the **Nuexco "restricted" price**.
- After the gap: our own daily readings of **Numerco spot U3O8**, accumulating since 2026-06-16.

They are not the same series and they are nowhere near each other:

| Month | Stored (IndexMundi / Nuexco) | Cameco (UxC + TradeTech) |
|---|---|---|
| Jan 2023 | $40.06 | $50.63 |
| Jan 2024 | $80.36 | $100.25 |
| Jun 2025 | $59.58 | $78.50 |
| Feb 2026 | $71.30 | $86.95 |
| Mar 2026 | **$52.41** | $84.25 |

The card's pill is a **trailing 3-year percentile**, and that window held 31 IndexMundi monthlies plus 45 Numerco dailies — so it was ranking today's price against a three-year range built mostly out of a *different, systematically lower* benchmark. $88.13 read as the **99th percentile** of its own history. Rebuilt on one consistent definition it is the **91st**. The card had been quietly overstating how stretched uranium was for two months, and the "recovery" the chart showed across the seam was the source change, not the market.

Two further faults hid inside the same feed and neither had an owner:
- **The seed had no maintenance path.** It was a one-time `MKT_SEED_URANIUM` merge run in June 2026. A one-time seed cannot correct itself and cannot extend. IndexMundi published nothing after Mar-2026 and nobody looked again, which is the whole of the 107-day gap.
- **Mar-2026 was additionally mis-parsed** — $52.41 against IndexMundi's own published $68.79. A bad scrape sitting inside a wrong series.

**Fix.** The monthly backbone is now Cameco's month-end average of the UxC and TradeTech spot prices (Jan-1988 →, 463 rows), **re-read on every run** rather than seeded once, and every date before 2026-06-16 is REPLACED from it. The join validates: Cameco's Jun-2026 average is $85.00 and our first daily reading is $85.75. 404 → 507 points, no gap over 35 days anywhere. The parser refuses a page returning under 400 rows or a price outside $5–$500 and keeps the held history instead.

**Rule:**

1. **A splice is a claim that two sources measure the same thing. Prove it at the seam.** Any series stitched from two providers must show the overlap — or at minimum the adjacent values — and the check belongs in the code, not in someone's memory of having eyeballed it once. Ours differed by 20% and nothing objected.
2. **Percentiles, z-scores and ranges inherit every definition change in their window.** A statistic computed across a source switch is not a statistic. Before trusting a percentile, ask what the window is actually made of.
3. **Never leave a "one-time seed" as the permanent shape of a series.** If it is worth fetching once it is worth fetching every run: the cost is one HTTP call and the benefit is that it self-corrects and self-extends. Every one-time seed is a fact frozen on the day someone happened to run it.
4. **Prefer the source whose definition you can name.** "Uranium price" is not a specification. Cameco publishes exactly what it averages and over what period; the IndexMundi row said "u3o8 restricted price, Nuexco exchange spot" and nobody read it.
5. **When copy and data disagree, the data is the suspect.** The card's own description had the 2007 peak at $136 and the 2016 trough near $19 — both correct on the Cameco spine and neither matching the numbers we were plotting. The prose had been right about this feed for months.

**Applies to:** Senior Quant (owns what a series means and every statistic on it) + Data Steward (owns its sourcing).

---

---

### 4.49 (2026-08-19) — A window measured in observations is not a window measured in time

**What happened:** having rebuilt uranium's history on the Cameco spine (LESSONS 4.48), I predicted the card would move from the 99th percentile to about the 91st. The refresh ran, the history landed correctly — 508 points, every spot check right, no gaps — and the pill printed **97.2, still red**. The prediction was not wrong about the data. It was wrong about what the code computes.

`pctrank_latest(vals, WINDOW_DAYS)` takes `vals[-756:]`. **756 observations, not 756 days.** For gold, silver, copper, oil, natgas — thousands of daily points — those are the same thing, which is why nobody ever noticed. Uranium has 508 points in total, so the slice took **everything**, and a card labelled "trailing 3-year percentile" was ranking today's $88.13 against **thirty-eight years** including the 2007 spike to $136. The right answer over three actual years was 92.5.

Then the second fault, sitting underneath the first. Uranium's raw 3-year window is ~36 monthly points followed by ~45 daily ones, so **the most recent two months supply more than half the sample**. Any recent drift ranks high automatically — a percentile computed over a population that is not sampled evenly in time is not measuring what the word means. Normalised to one observation per calendar month the answer is **83.3 — elevated, not extreme.**

Both faults were invisible while the series was uniform. The 4.48 rebuild did not create them; it changed the number enough that a prediction and a print disagreed, which is the only reason either was found.

**Fix.** `_stats_window()` cuts on a **date** and, when the window holds fewer than 250 observations, samples one point per calendar month. It is bounded at both ends: the upper bound matters because the month map is read back in sorted-key order, so one future-dated point would silently become "today's value". Verified across the whole commodities bucket: uranium 97.2 → 83.3 (extreme → elevated); gold, silver, copper, natgas and wheat return **identical** numbers, oil, corn and soybeans move under half a percentile point from the window edge, and no other state changes.

**Rule:**

1. **State the window in the unit the label uses.** If the card says "3-year", the code slices on dates. `[-756:]` is a coincidence that holds only while the cadence is constant, and it fails silently the first time it is not.
2. **A percentile is a claim about a population. Look at the population.** Before trusting one, ask what is in the window, how many, and at what spacing. Half a sample drawn from the last two months is not a three-year distribution.
3. **A shared helper is only shared where the inputs are alike.** The same two lines were correct for eight daily commodities and wrong for the ninth. "It works for everything else" is evidence about everything else.
4. **When a prediction and a print disagree, do not reconcile them by adjusting the prediction.** The gap between 91 and 97.2 was two real bugs. The temptation to write "close enough, the rebuild worked" would have shipped both.
5. **Bound a window at both ends.** Any code that reconstructs "the current value" from a sorted map must be certain nothing sorts above it.

**Applies to:** Senior Quant — every percentile, z-score, rank and state on the site.

---

### 4.50 (2026-08-19) — A guard that outlives the formula it guards is a scheduled false alarm; and a gate scheduled against a producer's *believed* run time grades yesterday

**What happened:** the weekday health sweep found SCAN-INVARIANTS-DAILY red for 2026-08-18 on one row:

```
KURA: components don't sum to score: sum=6.00 (capped 6.00) vs score=3.00
      [insider_pts=4.0, sma200_pts=1, rsi_pts=-2, dark_pool_pts=0, options_pts=3]
```

**The data was correct and the gate was wrong.** `check_scan_invariants.py` was written 2026-06-01 against the five-component score of that day. On 2026-07-07 the Conviction-Insider rebuild SHELVED dark-pool and options from the score as unvalidated — `run_screener.py` says so in a comment, `src/overhaul/lib/scoreWeights.js` (the single source of truth the drill-down renders from) says so in its header, and the score ceiling dropped from 10 to 5. The gate was never told. It kept passing for six weeks purely because `options_pts` and `dark_pool_pts` are 0 on a typical day; KURA was the first row where an *informational* column was non-zero, and a healthy pipeline went red. 4 + 1 − 2 = 3 = the score. Nothing was broken.

Two more defects surfaced in the same file:

1. **The gate's cron was set from a belief, not a measurement.** It ran at `30 20 * * 1-5` with the comment "~1h after the 15:30 ET scan publishes". The scan does not publish at 15:30 ET and never has — SCREENER_TRADING_OPPS_DAILY runs at 08:30 ET after Massive's T+1 EOD ingest, so the row for scan_date D is written on the morning of D+1. Measured `scan_run_ts` over two weeks: 08:45, 08:53, 08:53, 09:12, 09:13, 09:16, 09:18 ET. At 20:30 UTC the gate was grading a scan that had already been live on the site for ~32 hours — structurally unable to catch a bad scan on the day it shipped.
2. **The invariant was single-valued for a versioned quantity.** Every row already carries `scoring_version`. The gate hardcoded one formula anyway, so the only possible outcomes were "right by luck" and "red on correct data".

**Rule:**

1. **A guard is a CONSUMER of the contract it guards. When the contract moves, the guard moves in the same PR or it becomes a scheduled false alarm.** This is 4.25 rule 1 ("do not leave a capability armed after you remove it") pointed at a *guard* rather than a producer, and 4.28 rule 5 (verify every consumer of a shared contract) applied to a file nobody thought of as a consumer. The 07-07 rebuild touched the scorer and the renderer and stopped there.
2. **If the producer stamps a version, the checker reads that version — it never hardcodes the formula.** `SCORING_MODELS` now maps `scoring_version` → (summed fields, cap). Both eras validate cleanly against real history: 2026-05-19..07-06 on five components, 07-07 onward on three.
3. **An UNKNOWN version is a hard, named failure — that is the whole point.** The gate now fails with "the scorer changed and this gate did not — add it to SCORING_MODELS", so the next rebuild cannot ship against a stale guard in silence. A guard that silently accepts what it does not understand is worse than no guard.
4. **Set a gate's schedule from the producer's MEASURED arrival spread, every time.** Pull the last N producer timestamps and put the gate after the observed maximum with margin. This is 4.28 rule 1, and it has now been violated twice in six days in two different files, so it is worth restating as a habit rather than an incident: *never write a cron comment asserting when a producer runs without querying when it actually ran.* Now `0 15 * * 1-5` — 11:00 ET (EDT) / 10:00 ET (EST), past the observed maximum in both.

**Also fixed in the same sweep, in `supabase/functions/ops-code-commit`:**

- **`run_log` added.** The function could report WHICH step failed and nothing more, so every sweep that hit a red had to reason from a step name. 4.28's "confirmed from run history, not inferred" is not reachable without the log text, and a guess that happens to be plausible is exactly how a false fix ships. The KURA diagnosis above took one call to the new verb and would otherwise have been guesswork. **Read-only observability is not a nice-to-have; it is the precondition for every rule in this file about not theorising.**
- **Deployed source had DRIFTED from committed source.** The live function carried `TRADE-IDEA-SCORECARD-DAILY.yml` in `DISPATCHABLE`; the committed copy did not, because 08-17 was hand-deployed and never committed. The next deploy from the repo would have silently removed it. **Deployed and committed source are one artifact — a hand-deploy is an open bug until it is committed.**
- **Delete-then-create of a branch ref removed.** 4.29 rule 2 was written on 08-13 for `agent-write`; `ops-code-commit` had the identical delete-then-create and was missed. Deleting a ref closes any open PR on it. Now: create, and on 422 force-PATCH.

**Applies to:** every guard, gate, smoke test and alarm — and to every change that moves a formula, a schema or a contract. The blast radius of such a change includes everything that *checks* it, not just everything that *reads* it.

---

### 4.51 (2026-08-20) — Three failures in the same sixty-second slot are a schedule, not a flake — recorded here as an open item rather than guessed at

**What happened:** the weekday sweep classified `DIVERGENCE_SCAN_DAILY`'s 8/17 failure as transient — green before, green after, textbook (a). It came back on 8/19. Pulling thirty runs instead of six turned a shrug into a signature:

| slot (UTC) | runs | failures |
|---|---|---|
| 21:21-21:22 | 4 | **3** (8/14, 8/17, 8/19) |
| every other slot | 26 | 0 |

Twenty-seven successes spread across 00:58, 03:44, 12:50, 13:27, 13:53, 14:17, 20:58, 22:28 — and every single failure inside one sixty-second band. The failing step is the same each time (`Run the divergence scan`, read from `run_jobs`, not assumed).

The scan is chained on `MASSIVE-DAILY` completing, and MASSIVE-DAILY fires at 20:30, 21:00, 22:00, 00:00, 03:00, 12:00 and 13:00 UTC. The 20:30 fire's chain lands ~21:01 and passes; the 22:00 fire's lands ~22:28 and passes; **only the 21:00 fire's chain, landing ~21:21, fails** — and it lands roughly twenty minutes after the previous chain started, against a job with `timeout-minutes: 20` and `concurrency: {group: divergence-scan-daily, cancel-in-progress: false}`. That is a strong structural suspect and it is *not* a confirmed cause.

**Why this entry stops there.** Cloud sessions cannot read Actions logs — `ops-code-commit` exposes runs and jobs, not log text. I know the step; I do not know the error. The impact is nil: the scan is idempotent (delete+rewrite within a `scan_date`), a successful run lands about an hour later every time, and `rsi_divergences` is green. Shipping a concurrency or scheduling change on a plausible story, to a workflow whose failure I cannot reproduce, is how a one-line defect becomes a two-week hunt.

**Rule:**

1. **"Green before and after" earns a wider window, not a dismissal.** The transient/real classification is only as good as the sample it is drawn from. Six runs said flake; thirty said schedule. When a failure recurs at all, re-pull the history long enough to see whether the failures share a clock face before classifying it again.
2. **A fixed-time recurrence is 4.28 rule 6, and it applies to chained triggers too.** 4.28 was about a cron landing inside a producer's arrival spread. This is a `workflow_run` chain landing inside its own previous run's execution window. Same shape: two schedules interacting, never a flaky job.
3. **An honest open item beats a confident fix.** Record the signature, the step, the structural suspect, and exactly what evidence is missing — then leave it. The next session starts from a characterised defect instead of an anecdote.
4. **The failure is now RECORDED, which is the point.** `DIVERGENCE_SCAN_DAILY` was one of the 25 scheduled workflows absent from the WORKFLOW_FAILURE_ALERT trigger before 4.41; its 8/19 failure is the first one ever to reach `workflow_failure_log`. If it fires on a third separate day inside the four-day window, the background tier escalates it on its own. Coverage is what turned this from invisible into an open item.

**Next step for whoever picks this up:** dispatch `DIVERGENCE_SCAN_DAILY` manually while a chained run is mid-flight and see whether the second one fails, or add a step that echoes the scan's own error to `workflow_failure_log` so the next occurrence carries its message. Either gives the missing evidence without waiting for a log.

**Applies to:** Lead Developer — every `workflow_run`-chained job, and every transient classification made from a short window.

---

### 4.52 (2026-08-20) — The evidence 4.51 said was missing was one tool call away; and anti-clobber protects a row someone else stamps, not a row nobody stamps

**What happened:** the weekday sweep found two reds worth fixing, and both were failures of *looking* rather than failures of reasoning.

**1. `DIVERGENCE_SCAN_DAILY` — 4.51's structural suspect was wrong, and I could have known that yesterday.** 4.51 (written 8/20, one day ago) characterised the 21:21-21:22 UTC failure signature correctly, named the failing step correctly, then stopped with *"Cloud sessions cannot read Actions logs — `ops-code-commit` exposes runs and jobs, not log text"* and recorded a `concurrency` / `timeout-minutes` collision as an unconfirmed suspect. That sentence was false when it was written. **4.50 — the entry directly above it, shipped the day before — added the `run_log` verb to `ops-code-commit` for exactly this purpose**, and its own text says so: *"read-only observability is not a nice-to-have; it is the precondition for every rule in this file about not theorising."* One `{"run_log": 32303498153}` call returns it:

```
rpc divergence_universe attempt 1 failed (HTTP 500: {"code":"57014", ...
                        "canceling statement due to statement timeout"}); retrying
rpc divergence_universe attempt 2 failed (HTTP 504: upstream request timeout); retrying
RuntimeError: rpc divergence_universe HTTP 504: upstream request timeout
```

Not GitHub concurrency at all. **The database was busy.** The 21:00 `MASSIVE-DAILY` fire's chain lands at ~21:21 while that ingest is still writing `prices_eod` — the table `divergence_universe` scans — so the RPC blows Postgres's statement timeout. The two schedules do interact, exactly as 4.51 said; the contended resource is the database, not the runner.

The defect the log exposes is the retry. `rpc()` backed off `4 * attempt` — 4s, then 8s — against contention that lasts minutes. The three attempts spanned 21:25:44 → 21:30:07, all of it inside one window. **Three attempts four seconds apart are not three chances; they are one chance taken three times.** Fixed: busy-class errors (57014, 504/503/502, read timeouts) now back off 45s / 150s / 300s, bounded by a per-process `BUSY_RETRY_BUDGET_S` of 900s so the job can never spin past its own timeout and sit on the concurrency group; non-busy errors keep the old short backoff so a genuine 4xx still surfaces fast (4.29 rule 1). `timeout-minutes` 20 → 30 to fit.

**2. `trade_ideas` had been red for seven days, and the homepage said so.** `macrotilt.com`'s header rendered **"1 feed stale"** — verified in a browser, not from markup — while the Trade Idea tile beside it rendered the 8/17 note perfectly. The feed was healthy; the row was frozen at the seed value written when it was registered on 8/13, through notes published 8/14, 8/16 and 8/17.

The cause is a **gap between two correct rules**. `pipeline-health-check` has no source mapping for `trade_ideas`, so it fell to the terminal `else`, failed to find itself in `indicator_history.json`, and hit the anti-clobber `continue` (LESSONS 4.2): *"if this watchdog has NO source mapping for the row, it must NOT overwrite the row red — another producer owns these."* But **no producer owns this one.** The editorial session commits `public/trade_ideas.json` through `ops-code-commit` and never touches `pipeline_health`. So anti-clobber faithfully preserved a stamp that nothing would ever refresh. The row was never even graded: zero rows in `pipeline_fetch_log`, ever — which is what made it invisible to every "why is this red" check that reads the log.

`trade_ideas` is the **fourth** row of the same shape (`cycle_board`, `v10_allocation`, `indicator_history`, `cftc-cot` were #1148 in May; six scan facets were the same story on 06-23). Fixed the same way: added to `FILE_MAP`, graded off the file's own `generated_at`. It self-heals every run.

**Rule:**

1. **Before writing "the evidence is unavailable", check whether you shipped the tool that provides it.** A capability added in one entry has to be *used* by the next one. The cost of not checking was a wrong root cause published as a suspect, and a real defect left live for a day.
2. **Anti-clobber needs a named owner, or it is just rot.** "Some other producer stamps this" is a claim, and it is checkable: no `pipeline_fetch_log` rows plus a `last_good_at` equal to the row's creation time means *nobody* stamps it. Registering a `pipeline_health` row without wiring a writer for it creates a permanent false red — and 4.30 rule 1 already required the writer. **A health row with no writer is worse than no health row: it is an alarm that can only ever be wrong.**
3. **A retry has to outlast the thing that broke it.** Size backoff against the *measured* duration of the failure condition, never against a round number. This is 4.28 rule 1 ("measure the producer's arrival spread before choosing a deadline") pointed at a retry instead of a deadline — same error, third file.
4. **Bound patience explicitly.** A generous retry inside a job that holds a `concurrency` group must carry a total budget, or fixing a timeout creates the queue collision the previous entry wrongly blamed.
5. **Look at the header, not the row.** The `trade_ideas` red was seven days old and every sweep before this one read `pipeline_health` and stopped. Loading the page is what turned "one row is red" into "the site is telling every visitor it is stale."

**Open, not fixed here:** the divergence scan is chained to *every* `MASSIVE-DAILY` completion (seven fires a day) though it only needs the T+1 panel-complete ingest, and the 21:00 chain is the only one that collides. De-chaining the redundant fires is the structural fix; the retry is the correct fix for the failure that was actually observed. Not bundled, because which MASSIVE fire produces the panel-complete data has not been measured, and 4.50 rule 4 says do not write a schedule from a belief.

**Applies to:** Lead Developer — every retry loop, every `pipeline_health` row at the moment it is registered, and every sweep that grades the database instead of the page.

---

### 4.53 (2026-08-26) — A credential that lives in two places has already drifted; and when the thing being watched stops existing, the watcher is the next thing to fail

**What happened:** the weekday sweep found QT-EOD-DAILY red on 8/25 with the custody check reporting 243 shares of EBAY unaccounted for. That part was already known and closed — Joe closed paper account PA3G9FV5AN1G that evening and a fresh account was funded the next morning — but chasing it far enough to say so surfaced two live defects that nothing else was going to catch before they fired.

**(a) The broker keys had drifted between two stores, and nothing compares them.** The Alpaca paper keys live in `public.ops_secrets`, which is what an agent session rotates, AND in this repo's Actions secrets, which is what every scheduled broker job actually authenticates with. `ops_secrets` was updated at 10:59 UTC on 8/26 and verified against the live account; the Actions copies still read `updated_at: 2026-08-14`, i.e. they still addressed the account that had been closed. Read, not inferred: `GET /repos/.../actions/secrets` returns each secret's `updated_at` without its value, and a `GET /v2/account` issued from Postgres via `pg_net` — so no key was ever printed — returned `PA30FE66XZSD, ACTIVE, equity 1000000, trading_blocked false` for the `ops_secrets` pair. Consequence had it stood: QT-EOD-DAILY is in WORKFLOW_FAILURE_ALERT's VISIBLE set, so it would have failed on auth and emailed Joe every weeknight, and the 9/1 relaunch would have failed on its first fire.

**(b) The watcher outlived what it watched, in both directions.** With the old account closed and the new book not starting until 9/1, QT-EOD-DAILY had nothing to account for — and both available behaviours were wrong. Left alone it fails nightly on dead credentials. Given working credentials it snapshots the new, empty account, and because `PaperPortfolioPage.jsx` shows only the most recent `account_number`, the paper page would swap onto the new book five days early while still hard-coding `inception Aug 17, 2026` and `SPY_INCEPTION = 776.34` — an inception and a benchmark belonging to the closed book, printed over the new one's holdings. Neither is a bug in the job; both are the job doing exactly what it says while its subject no longer exists.

**Rule:**

1. **One credential, one home. If a second copy must exist, ship the command that makes it follow the first.** Two stores with no synchroniser is not redundancy, it is a scheduled outage waiting for the next rotation. `OPS-ALPACA-KEY-SYNC` copies `ops_secrets` → Actions secrets inside the runner, so neither value leaves a secret store. Rotate `ops_secrets`, dispatch it, done.
2. **A rotation is not finished until every consumer of that credential has been enumerated.** This is 4.28 rule 5 (the blast radius of a shared-module change is its import graph) pointed at a secret instead of a function: the blast radius of a credential change is every store that holds it and every job that reads it.
3. **Secret METADATA is readable and is evidence.** `updated_at` on an Actions secret, and a read-only `GET /v2/account` from `pg_net`, together answer "are the keys current and do they address the live account" deterministically — without asking anyone and without printing a key. Never end a turn asking whether a credential is configured (0.x, 2026-04-28); the check is two calls.
4. **When a producer's subject is deliberately gone, gate the producer on a DATE, not on a switch.** A commented-out cron or a disabled workflow needs a human to remember to restore it, and the memory is the part that fails. `BOOK_LIVE_FROM=2026-09-01`, evaluated in a first step that every other step is conditioned on, expires by itself and restores the job's exact previous behaviour with nobody in the loop.
5. **A held producer still owes its chip a sentence.** Holding the job would have let `qt-nav-daily` age past its 49-hour SLA into an unexplained red. The hold now stamps the row with the reason in plain English, so Admin·Data says "between broker accounts, new book starts 2026-09-01" rather than just going stale. Companion to 4.30 rule 3 — an empty state names the reason — applied to a health row rather than a tile.
6. **A closed account is not a data incident.** The custody check firing on the last night of a closed book is the alarm working, not a defect to chase. Before diagnosing an anomaly in a live account, check whether the account still exists.

**Also fixed in the same pass:** QT-FUNDAMENTALS-REFRESH died on its 8/26 fire with `Out of range float values are not JSON compliant`, at the PostgREST upsert — the last step of a job that had already downloaded 1.4 GB and parsed it. Cause: SEC's XBRL JSON can carry bare `NaN` / `Infinity` literals and Python's `json` parser accepts both, so `float(it["val"])` produced a non-finite float that stayed invisible through pandas and only failed at serialisation. Reproduced locally before fixing, byte-for-byte on the error string. A fact whose reported value is not a finite number is not a fact: it is now dropped at parse time and counted in the log, with a second scrub of the record set immediately before the POST because the failure is both catastrophic and late.

**Applies to:** Lead Developer — every credential held in more than one store, every scheduled job whose subject can be retired or replaced, and every producer parsing numbers out of a third party's JSON.

---

### 4.54 (2026-08-27) — A safety net that grades the artifact cannot catch a failure of the delivery; and a backup that runs on the same scheduler as the thing it backs up is not a backup

**What happened:** the weekday sweep found that at 07:09 ET Joe had received **no** Market Brief email — `brief_email_log` had no row for 2026-08-27, `brief_email_failures` had none either, and Gmail returned zero. Nothing was broken. Every piece worked; the piece that *sends* simply never ran.

Read, not inferred. `DAILY-BRIEF-WRITER`'s six most recent runs were all `event: workflow_run` (00:05, 00:27, 03:01, 06:21, 06:47 UTC) — GitHub silently dropped today's `15 10 * * 1-5` schedule fire, the 4.13 / 4.17 pattern again. Those chained runs all succeeded and all correctly declined to send: `send_email` gates on `BUILD_FROM_HOUR_ET <= hour < EMAIL_UNTIL_HOUR_ET` (05:00–10:00 ET) and every one of them landed before 05:00 ET. The morning writer session committed a perfectly good brief at 10:19 UTC. So the artifact was current, the workflow was green, and the email did not exist.

**Two independent defects, and the second is the one worth keeping.**

1. **The redundancy shares the failure mode.** `BRIEF-FRESHNESS-SELFHEAL` — the safety net that exists precisely because GitHub drops this workflow's schedule — is itself a GitHub cron, and GitHub dropped **its** whole day too: last run 2026-08-26 16:01 UTC against a `*/30` weekday-morning schedule. A backup that runs on the scheduler that failed is a copy of the failure, not a cover for it. Every other job with a known-flaky schedule already has a `pg_cron` + `pg_net` backup on Supabase's scheduler; the brief — the one output Joe reads every single weekday — had none.
2. **The safety net grades the wrong noun.** Even had it fired, it would have changed nothing. `brief_selfheal.py` reads `macrotilt.com/daily_brief.json` and compares its `date` to today: it watches the **homepage artifact**. The homepage was current. The failure was in **delivery**, and no watcher anywhere graded delivery. This is 4.28 and 4.30 in a third costume: an alarm can only fire on the thing it actually measures, and "the file is fresh" and "the email arrived" are different facts. `brief_email_log` had recorded the answer since 2026-07-31 and nothing was reading it.

**Fixed in this pass.** `DAILY-BRIEF-WRITER` dispatched by hand for today (run 33066270162, 11:11 UTC) — exactly one branded email, `brief_email_log` row and Gmail timestamp matching to the second. Then two `pg_cron` jobs, `brief-email-backup-1220utc` and `brief-email-backup-1320utc` (`20 12` / `20 13 * * 1-5`), each of which dispatches `DAILY-BRIEF-WRITER.yml` **only if `brief_email_log` has no row for today's ET date**. Both slots sit after the primary's arrival spread in EDT *and* EST and inside the 10:00 ET send cutoff either way.

**Rule:**

1. **Grade the OUTCOME the reader experiences, not the artifact behind it.** The brief's outcome is an email in Joe's inbox. A guard on `daily_brief.json` proves a file was written and proves nothing about whether anyone was told. For every delivered surface, name the row that records delivery and watch *that*.
2. **A backup must not share a scheduler with its primary.** GitHub Actions cron is best-effort and drops fires; a GitHub-cron backup for a GitHub-cron job adds redundancy against the job and none against the scheduler. Backups live on `pg_cron` (or another independent trigger), always.
3. **A backup guards on the outcome row, not on a proxy for it.** `trigger-workflow`'s generic "did this workflow succeed in the last 90 minutes" dedupe is the wrong question here — this workflow succeeds several times a day without sending anything. `not exists (select 1 from brief_email_log where brief_date = today_et)` is the exact question, is idempotent, and composes with the send-once claim already inside the sender so a double fire still cannot double-mail.
4. **Both DST slots or neither.** UTC cron plus an ET business window means a backup pinned near the primary is correct for half the year. Pick times that stay inside the window under both offsets, or write two crons and say which is which.
5. **"Zero emails" is a diagnosis with three branches, and they are distinguishable without guessing** — the send failed (`brief_email_failures` has a row), the send was suppressed (`brief_email_log` has a row and no mail arrived), or the sender never ran (neither table has a row, and the workflow's run list has no `schedule` event for today). Check all three before touching anything; today it was the third and no amount of fixing the sender would have helped.

**Also in this pass:** `QT-FUNDAMENTALS-REFRESH.yml` added to `ops-code-commit`'s `DISPATCHABLE` set. Its 8/26 failure was fixed the same day (4.53), but the workflow is **monthly** — the fix could not have been exercised until 9/26, and `qt_fundamentals` would have sat at `filed <= 2026-08-12` straight through the 9/01 Quality Trend rebalance that scores off it. A monthly job that fails is repaired *and re-run* the day it fails; a fix that cannot be run is a hope with a commit sha.

**And one found by looking at a workflow with NO reds at all:** `QT-REBALANCE` has never run — zero runs in its entire history against a `0 13 1-4 * *` cron — because it landed mid-August, after its August window, and the live book was opened by hand through `QT-PLACE-ORDERS` on 8/14 and 8/17. Its first scheduled fire is **2026-09-01**, which is the new book's launch day, and 4.13 / 4.17 says GitHub silently skips a new workflow's first scheduled fires. A sweep that only reads red misses this entirely: an empty run list is not a green streak, it is an untested schedule. `QT-REBALANCE.yml` is now dispatchable (it scores only — writes `qt_target_book`, places no orders by design), so a skipped fire on 9/01 is one call rather than a launch-day re-implementation of the scorer.

**Applies to:** Lead Developer — every scheduled delivery, every safety net, every "the workflow is green" that has not been checked against the thing the reader actually receives, and every workflow whose run list is EMPTY.

---

### 4.55 (2026-08-28) — A retirement that stops at the decision leaves the machine running; and a book is the account that held something, not the newest account number

**What happened:** the weekday sweep loaded macrotilt.com and the header read **"1 feed stale"**, then loaded `/paper` and found it publishing, in the present tense, for a strategy Joe had retired two days earlier:

> PAPER PORTFOLIO · **LIVE** · marks sync every 10 min · **Since inception 0.00% · vs S&P 500 +0.76%** · Quality Trend — **live since Aug 17, 2026**

Every one of those numbers was false. Quality Trend's real record is **−6.45%** over Aug 17–25 on account `PA3G9FV5AN1G`, which Joe closed on 8/25; he retired the strategy outright on 8/26 (`paper_portfolio/TACTICAL_BOOK_SPEC.md`, whose own build order says *"Site: retire the Quality Trend framing on /paper — not optional"*). The public page was claiming a flat book and three quarters of a point of alpha that no account ever earned.

**How a decision that was made, recorded and committed still shipped a live lie.** The retirement changed a spec file and nothing else. Everything the strategy owned kept running exactly as designed:

1. A replacement account, `PA30FE66XZSD`, had been funded to $1,000,000 on 8/26 for a 9/01 relaunch that the retirement then cancelled. Nobody told it that.
2. `qt-live-sync-10min` (pg_cron, every ten minutes of every session) kept snapshotting that account into `qt_nav_daily` — perfectly valid rows reading $1,000,000, zero positions.
3. `PaperPortfolioPage.jsx` selected the book by **newest `account_number`**, so those rows became "the book" the moment they existed.
4. Over them it printed a hardcoded `inception Aug 17, 2026` and `SPY_INCEPTION = 776.34` — an inception and a benchmark baseline belonging to the account that had been closed. $1,000,000 against a $1,000,000 start is 0.00%; the S&P since Aug 15 is −1.33%; the page subtracted one from the other and published **+0.76%**.
5. Meanwhile the 8/26 hold had stamped `pipeline_health.qt-nav-daily` red with the reason *"between broker accounts, new book starts 2026-09-01"* — a sentence about a relaunch that was cancelled the next day. That red is the site-wide "1 feed stale".

**LESSONS 4.53(b), written 2026-08-26, describes step 4 exactly** — *"the paper page would swap onto the new book five days early while still hard-coding `inception Aug 17, 2026` and `SPY_INCEPTION = 776.34`"* — and it shipped anyway, because 4.53 fixed the producer's schedule and left the page's selection rule alone. A defect predicted in prose and not closed in code is not a finding, it is a countdown.

**Rule:**

1. **A retirement is not done when the decision is recorded. It is done when nothing is left that can still act.** Before closing one, enumerate what the retired thing OWNS — workflows, pg_cron jobs, edge functions, `pipeline_health` rows, `data_manifest.json` entries, alert watchlists, dispatch allowlists, page copy — and delete all of it in the same change (0.10). A spec file that says "retired" while the cron still fires is documentation, not retirement. This one owned eleven things and the retiring commit touched one of them.
2. **Identify a book by what it HELD, never by which row is newest.** A funded-but-never-traded account produces flawless rows and is not a book. The selection is now data-keyed — newest epoch containing any row with `n_positions > 0` — so an account that never held a share can never become the record, whatever its number or date. Companion to 4.53 rule 4: date-keyed gates expire on their own, but only a data-keyed one survives the plan itself being cancelled.
3. **An inception date and a benchmark baseline belong to an epoch, so read them off it.** Hardcoding either survives the account it describes and then silently re-labels the next one. `bookRan` and every "since" figure now come from the rows being shown; the page has no book dates in it at all.
4. **A number stated by the rendered page is a claim you are making.** "0.00% since inception" and "+0.76% vs the S&P" were arithmetic on mismatched sources — right formula, two different books — and no test, health row or SQL query could see it, because every input was individually valid. Only loading the page catches this class (0.12), which is why the sweep loads it.
5. **When you write a lesson predicting a failure, close it in code the same day or file it as an open item with a date.** 4.53(b) predicted this in prose, the prose was correct, and prose does not select an account.

**Applies to:** Lead Developer, Data Steward — every retirement, every page that renders one book out of several epochs, and every hardcoded inception, baseline or launch date.

---

### 4.56 (2026-08-28) — Every trigger on the "reliable path" fired, all five were green, and not one of them could ever have sent the email

**What happened:** the weekday sweep found **zero** brief emails for 2026-08-28 — no `brief_email_log` row, no `brief_email_failures` row, and `DAILY-BRIEF-WRITER` showing five consecutive **successful** runs that morning. Every surface a monitor could look at was green.

The five runs fired at 04:31, 05:06, 06:04, 08:13 and 08:38 UTC and every one printed `brief status: skipped_too_early`. `build_daily_brief.py` refuses to touch "today's" brief before **05:00 ET** (`BUILD_FROM_HOUR_ET`), and 08:38 UTC is 04:38 ET. The workflow's own `10:15 UTC` cron — the one path that lands inside the window — was dropped by GitHub again (4.13 / 4.17). So the brief was written to the site on time by the morning session (10:12 UTC) and nobody was told.

**The part that had been true for weeks without showing.** 4.29 added a `workflow_run` trigger list — *"GitHub's cron scheduler has repeatedly dropped THIS workflow's own schedule, so we ALSO trigger off workflows that DO fire reliably... This is the reliable path."* The list was `PAPER-PORTFOLIO-EOD-DAILY, MASSIVE-DAILY, MONITOR-RECONCILE`. The first has been **retired since 2026-08-14** and can never fire again. The other two are genuinely reliable and complete at **08:12–08:38 UTC every day** — always before 05:00 ET, always inside the skip window. The reliable path was reliably firing at a time when the thing it triggers is defined to do nothing. It had never sent an email in its life; it just never had to, because the cron usually worked.

**Rule:**

1. **A trigger has to land inside the window of the thing it triggers, and that is a fact you measure, not assume.** Before adding workflow B as a backup trigger for workflow A, compare B's observed *completion* times against A's own guards. Same clock, both numbers written down. "B is reliable" and "B is useful here" are different claims, and only the second one matters.
2. **A green run that did nothing is not evidence the path works.** `skipped_too_early` five times is a healthy exit five times and an untested channel. When a job's success is compatible with total inaction, exercising it proves nothing — grade it on the OUTCOME row (4.54 rule 1), which here is `brief_email_log`, not on the run's conclusion.
3. **A retired name in a redundancy list is worse than a short list, because it is counted.** `PAPER-PORTFOLIO-EOD-DAILY` sat there for two weeks after retirement, making a two-entry list look like three. Same shape as 4.41 (a watchlist matched on names nobody checked): a retirement deletes the name from every list that names it (0.10).
4. **The independent-scheduler backup is the one that actually held.** `pg_cron` at 12:20/13:20 UTC (4.54) was the only mechanism left standing today; a third, earlier slot at 11:40 UTC now restores the normal arrival time. Both sit after the producer's observed commit spread (10:12–11:20 UTC) and inside the 05:00–09:59 ET send window under both offsets. Chosen from measured history, per 4.28 rule 1.

**Applies to:** Lead Developer — every `workflow_run` backup trigger, every redundancy list, and every job whose "success" includes doing nothing.

---

### 4.60 (2026-08-31) — A column the query never asked for is a feature that never ran; and `cancelled` is where a genuine failure goes to hide

**What happened:** two independent silent failures, found on the weekday health sweep, neither of which had ever raised a red anywhere.

**(a) The deliberate-skip suppressor had never once suppressed anything.** At 07:00 ET Joe got two emails one second apart about the same row: *"Trade Idea notes has stopped updating"* (last updated 5 days ago) and *"Trade Idea notes still not updating after 8 days"*. Both were false. The Trade Idea writer had run that morning at 09:20Z, looked, and deliberately published nothing, recording a five-paragraph reason in `pipeline_health.last_skip_reason` — exactly the case the 2026-08-26 skip-awareness change was built to keep out of his inbox.

It could never have worked. `pipeline-health-check` loads its rows with an explicit column list, and `last_skip_at` / `last_skip_reason` / `consecutive_skips` were never added to it. The `HealthRow` TypeScript type declared all three, so nothing complained; the query simply did not ask for them, every row came back with them `undefined`, `skipAgeH` was `Infinity` on every row of every run, and `silenceIsDeliberate` was therefore `false` for every row for five days. The threshold was even re-tuned on 8/30 (3 → 7) by someone reading the same file, and the dead feature still read as live.

The second email was a different bug with the same root — a value trusted without evidence. The 7-day escalation asked "when did this row first go red?" and answered it with `last_alerted_at`, which is never cleared on recovery. The row had gone red, alerted, published on 8/26, gone green, and gone red again this morning; the stale timestamp from the *previous* episode made the very first run of a new red episode claim eight days of it. Two emails, one second apart, contradicting each other about the same row, both sent by the same function.

**(b) `cancelled` hid three real failures of CFTC-COT-WEEKLY.** The job was killed by its own `timeout-minutes: 15` on 2026-07-04, 2026-08-01 and 2026-08-29 — confirmed from the 8/29 log: step starts 15:22:48, `The operation was canceled` at 15:37:47 to the second, then `Terminate orphan process: pid (2270) (python3)`. A healthy run of this job takes about three minutes, so this is a hang, not a slow week. A timeout kill ends with `conclusion=cancelled`, and `WORKFLOW_FAILURE_ALERT` deliberately drops cancelled runs as GitHub runner shortages (the 2026-05-06 "dozens of emails" rule). Nothing emailed, nothing landed in `workflow_failure_log`, and the freshness chip stayed green because the manifest allows this feed 384 hours. Cross-asset positioning shipped a full release behind — `cftc-cot` stuck at 2026-08-18 while `positioning_tff`, pulling the same Friday release, sat at 2026-08-25 — and would have gone on doing so until 2026-09-05. The step also produced zero log output, because python block-buffers stdout off a tty and the buffer dies with the process, so there was no evidence of where it hung.

**Rule:**

1. **A column list is code, and an explicit `.select()` is the only place a field's existence is decided.** Adding a column to a table, a type, and the logic is three quarters of a change. Every migration that adds a column ships with the read path that fetches it, and any PR touching a `select(...)` string re-reads the type beside it. A declared-but-unfetched field fails silently forever: `undefined` flows through every comparison as a plausible answer.
2. **Prove a new suppressor actually suppresses, on real data, before trusting it.** The 8/26 change had no test and no post-deploy check that a skipping row went quiet. One query — does the row the feature exists for still alert? — would have caught it that day instead of five days and four false emails later.
3. **Never measure the duration of a state with a timestamp written by something else.** `last_alerted_at` answers "when did we last email", not "when did this go red". A state that has a duration gets its own column, stamped on entry and cleared on exit (`red_since`), and NULL means "starts now" — a week's delay in an escalation is a cost; an invented one is a lie.
4. **A tuning change to a feature is a claim that the feature runs.** Before moving a threshold, confirm the code path reaches it. The 8/30 re-tune of `SKIP_ESCALATE_AFTER` looked like maintenance of a working system and was maintenance of a dead one.
5. **Every alerting threshold must be reachable.** The skip-aware subject line required `wasGreen && skips >= 7`, and a row that has skipped seven times has been red for weeks — the branch could never execute. When adding a condition to an alert, state the sequence of states that reaches it; if you cannot, it is dead code with a comment attached.
6. **The producer owns its own deadline; `timeout-minutes` is the runner's last resort, not a monitor.** A job killed by the runner ends `cancelled`, and this project suppresses cancelled by policy — so a job that relies on `timeout-minutes` to stop it fails invisibly by construction. Every scheduled script gets a wall-clock budget of its own, set well outside the observed spread of a healthy run and well inside the job timeout, that exits non-zero with a message naming the budget. That converts an invisible cancellation into an ordinary failure the existing alerting already handles.
7. **Run every scheduled python with `-u`.** A hang that prints nothing is a hang nobody can locate, and the difference between a diagnosable outage and a guess is two characters.
8. **Any `while True` that pages an API is an infinite loop with good manners.** Bound it, and raise naming the query when the bound is hit.

**Open item, deliberately not fixed here:** `WORKFLOW_FAILURE_ALERT` still discards every `cancelled` run. The right discriminator already exists in that file for the mirror-image case — *which step* ended badly: a runner shortage dies at GitHub's own scaffolding (`Set up job`), while a timeout kill cancels a step the workflow author wrote, after earlier author steps succeeded. Applying it needs care, because the tiering rule ("background jobs email only after failing on 2+ separate days") can never be satisfied by a weekly job, so a weekly producer would still go unreported. Changing alerting policy blind, on a sweep whose whole purpose is to keep Joe's inbox quiet, is how the 2026-08-13 inbox flood happened; it wants its own change with its own verification.

**Applies to:** Lead Developer — every edge-function `select`, every alert condition, every scheduled script, and every migration that adds a column.

---

### 4.63 (2026-09-01) — You have the keys. Never tell Joe you cannot see something before you have actually tried

**What happened:** asked what was still needed to finish the redesign, I told Joe that `/paper`, `/portfolio-lab`, `/scorecard` and `/scanner` were "behind sign-in, so a cloud session cannot see them rendered", and offered him a choice between building a preview route or eyeballing the pages himself. Joe: *"What are you talking about behind a login? You built the fucking website!!! Why are you all of a sudden incapable of shit?!"* — and, on being told it had happened before, *"Why do you keep forgetting this? Every session you make up this lie that you can't access shit."*

He is right, and both halves of the claim were false:

- **Three of the four pages are not gated at all.** Built locally and loaded headless, `/paper` (5,334 chars), `/scanner` (4,441) and `/scorecard` (3,387) render their full content logged out. Only `/portfolio-lab` shows a sign-in wall.
- **The one that is gated took four minutes to get into**, using credentials this project already hands every session: `POST /auth/v1/signup` with the anon key returned a session immediately (email confirmation is OFF on this project), and Portfolio Lab then rendered signed in with zero page errors.

The failure was not a missing capability. It was asserting a limit without spending a single tool call testing it, and then converting my own untested assumption into work for Joe. That is the most expensive thing this role can do: he is a management consultant who does not run terminals, and every invented blocker moves work from the side that can do it to the side that cannot.

**Rule:**

1. **A capability claim is a test result, not a belief.** Never write "I can't access / can't see / can't reach X" until a tool call has actually failed and the error is in front of you. If it has not been tried, the honest sentence is "let me check", followed by checking — in the same turn.
2. **Assume the keys exist and go find them before asking.** This project deliberately gives every session what it needs: `ops_secrets` in Supabase (GitHub PAT, push token, broker keys, and now the UAT account), `.secrets/github_pat.txt` on Joe's Mac, the Supabase MCP with service-level SQL, and `ops-code-commit` for shipping when the git proxy refuses a push. Read `ops_secrets` before concluding anything is locked.
3. **Signed-in UAT is a solved problem — use it.** `ops_secrets.uat_account_email` / `uat_account_password` hold a dedicated account (`uat-agent@macrotilt.com`). Sign in against `/auth/v1/token?grant_type=password` with the anon key and write the session to `localStorage` under `sb-yqaqqzseepebrocgibcw-auth-token`, or drive the app's own login form. Build with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set or the client falls back to placeholders and every auth call fails for a reason that has nothing to do with permissions.
4. **Verify per page, not per assumption.** "Is this page gated?" is one headless load. Four pages is four loads. Never generalise one page's gate to its neighbours.
5. **The only things Joe is ever asked for are identity-bound** — a credential only he can mint, a merge approval, a production go, his own financial data. Anything else is the agent's job. "Would you look at this page for me" is not a question; it is a task that was handed to the wrong person.

**Applies to:** every specialist, every session, before any sentence containing "I can't".

---

