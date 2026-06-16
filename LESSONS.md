# LESSONS.md — MacroTilt

Binding behavioral rules for the agent council (UX Designer · Senior Quant ·
Lead Developer · Data Steward) working on MacroTilt. Read at the start of
every task per the Pre-Flight Checklist in project instructions.

**Reorganized 2026-06-11 at Joe's direction.** The previous file was 75
chronological entries with heavy duplication. This version is categorized:
duplicates are merged (every merged entry lists ALL of its original dates —
the repeat count is itself signal), superseded and shipped one-time entries
are retired to the archive at the bottom, and stale folder paths were
updated. No binding content was dropped.

Older rules also live in agent auto-memory. The auto-memory and this file
serve the same purpose; this file is the one Joe controls and
version-controls. When Joe corrects a mistake, propose a new entry here —
filed under the matching section, dated — before closing the task.

## Format

```
### YYYY-MM-DD — short title
**What happened:** 1–3 sentences describing the failure mode.
**Rule:** specific and testable.
**Applies to:** who binds.
```

---

# 0 · HARD RULES — Joe-stated, binding, no exceptions

### 0.1 (2026-06-02) — Every data element carries a 5-field freshness chip; fake green is forbidden

**What happened:** Agents kept shipping data values with no chip, half-explained chips, or chips that were green only because the element was untracked ("fake green"); known-stale feeds were left red without being fixed.

**Rule:** Every single piece of data on MacroTilt — every indicator, positioning signal, tile, map dot, grid row, drill panel, KPI, on every page (Macro Overview, All Indicators, Methodology, Home, Asset Tilt, Scanner, Portfolio, Paper, Ticker, Admin·Data) — carries a freshness chip exposing all FIVE fields:

1. **Source** — FRED / Yahoo / CFTC / NY Fed / etc.
2. **Frequency + calendar** — "Daily · NYSE trading days", "Weekly · every Friday", "Monthly · 15th".
3. **Timing** — the time of day the fetch runs (ET).
4. **SLA** — the freshness target in hours.
5. **Last update** — exact date AND time of the last successful refresh.

All five read from the data manifest + the freshness-tracking table — never hardcoded. No data value renders without a chip. No chip ships without all five fields. **No chip is allowed to be green merely because the element is untracked** — an element with no manifest entry and no tracking row is NOT done; it must be registered and seeded so green genuinely means "the system is watching this and it is fresh." (The freshness checker only updates EXISTING `pipeline_health` rows — every new feed needs a seed row + manifest entry in the same PR.) Never leave a red chip unfixed.

**Applies to:** All. Binding on every PR that adds, moves, or renders any data element.

### 0.2 (2026-06-02, merged with the 2026-05-27 impact-map procedure) — All data work ships with a full impact map, Data Steward sign-off, and the three governance pages updated, in the same PR

**What happened:** Data changes kept shipping that touched only the surface Joe pointed at. On 2026-05-27 Joe spent a full evening watching the same bug get chased one surface at a time — each fix technically correct but partial, with downstream surfaces (methodology copy, admin scorecard, vendor ledger, tooltips, footer source lines, changelog) found only when Joe pointed at the screen. Joe: "It's impossible to keep the site updated and clean. It really is."

**Rule:** Any change that touches data — a new feed, a renamed element, a re-bucketing, a vendor swap, a schedule change — is not done until ALL of the following are satisfied in the same PR, with explicit **Data Steward sign-off**:

1. **Source-to-target mapping for every element** — a documented path from source (vendor + endpoint) through storage to every consumer surface that renders it.
2. **The six-track impact map**, written into the PR description BEFORE sign-off, built from an actual walk of the data model — not from memory, not from a single grep:
   - **Data model:** every table, file, JSON key, manifest entry, `pipeline_health` row this change touches — from schema introspection (`information_schema.columns`, `select * limit 1`).
   - **Producers:** every script / workflow / Edge Function that writes it, including backup runs and chained `workflow_run` triggers; for schedule changes, every cron expression in every workflow YAML.
   - **Consumers:** every page, component, hook, derived file, and admin surface that reads it — walked through the import graph (`src/**`, `public/*.json`, `scripts/*.py`, `paper_portfolio/*.py`, `asset_allocation/**`, legacy `Dashboard.jsx` / `App.jsx`).
   - **Surfaces:** every human-visible spot — the page itself, its methodology section, the data-vendor table, the admin data-health scorecard, the footer source line, the file-lineage drawer, every tooltip that names the vendor.
   - **Knowledge/docs:** `data_manifest.json`, `data_vendors.md`, `methodology_changelog.json`, `dataRegistry.js`, `indicatorRegistry.js`, `feedLineage.js`, `useDataHealth.js`, LESSONS.md.
   - **Live verification plan:** the list of URLs to load post-deploy and what to check on each — executed in the browser after merge, with screenshots.
3. **The three governance pages updated to match:** **Admin·Data** (element appears and is monitored with a real chip), **All Indicators** (visible, filterable row), **Methodology** (documented in the sources/method tables).

Greps must cover the vendor name, table name, column name, element ID, AND every human-readable label that names them ("FRED", "Treasury.gov", "10Y TIPS", "T+1") — vendor labels show up under many phrasings. Forbidden: shipping without the map; calling a change "done" after fixing only the pointed-at surface; consumer lists from memory; specialist sign-off on a PR whose map is missing or shorter than the actual surface count.

**Applies to:** All four specialists. Lead Developer owns building the map; every other specialist checks their domain on it before signing off.

### 0.3 (2026-06-03, merged with 2026-04-30 re-baseline rule) — The Cowork-mounted local copy is STALE; never edit or commit a repo file from it

**What happened:** The mounted repo folder is a frozen snapshot whose git pointer is dead — it can never pull. Editing a file there and committing it via the API silently REVERTED newer commits (the Asset Tilt hero regressed to an old version; previously-fixed crash patterns were reintroduced, blanking the page). Separately (2026-04-30), inventory work made multiple wrong "this is dead code" calls by reading a stale local checkout instead of the live repo.

**Rule:** Treat the mounted disk as UNTRUSTED for any file you will commit. Before editing ANY repo file, fetch its current content from origin/main:

```
curl -H "Authorization: Bearer $PAT" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/jmezzadri/market-dashboard/contents/<path>?ref=main"
```

Edit THAT copy and PUT it back via the Contents API (which carries the latest blob sha). Never grep/edit on-disk `src/**` as source of truth. At the start of every multi-PR phase, re-baseline: `git log -20 origin/main`, fetch deployed JSON files via raw URL, read workflow files from origin/main. If a commit could plausibly touch a file someone else changed, diff your version against origin/main and confirm every difference is intended. After ANY deploy to a user-visible surface, hard-reload (cache-bust) the page and read the console for `Minified React error` BEFORE telling Joe it is done.

**Applies to:** All. Every commit.

### 0.4 (merged from 8 corrections: 2026-04-28 global, 05-02, 05-04, 05-08, 05-11, 05-12, 05-19 ×2; PR-number exception removed by Joe 2026-06-11) — Plain English in every word Joe reads: chat, tables, popups, test instructions

**What happened:** Joe had to stop the council repeatedly, across at least eight sessions, for the same root cause: file and table names (05-12), statistical jargon (05-19), terminal words like "bash" and "sandbox" (05-08), jargon inside popup questions (05-02, 05-04), code-speak in post-ship test instructions (05-11), and internal IDs / version labels / status enums (05-19). Joe: "I only want plain english speak."

**Rule:** Joe is a management consultant, not a coder. Every word he reads — chat, status tables, popup labels and descriptions, test instructions — must be readable by someone who has never opened a developer tool. Banned with no exceptions, regardless of how short or technical the reply:

- Any path, file name, directory, branch name, commit hash, build artifact. Even in backticks. Even with the extension stripped.
- Any function, variable, constant, class, prop, hook, route, table, or column name. Anything with an underscore.
- Statistical terms not already in business English: R-squared, OLS, z-score, beta, log-return, factor loading. Say "the model explains about a sixth of crypto's monthly moves," not the math notation.
- Terminal/devops words: bash, sandbox, shell, container, stash, rebase, force-push, merge conflict, webhook, CORS, diff, endpoint, RPC, env var, cron, JSX.
- Version labels (v5 / v9 / v10 / v11 / phase-N / sprint-N), status enum values, raw error strings, HTTP status codes, anything copied from a terminal.
- **PR numbers — banned (Joe, 2026-06-11, superseding the earlier "single allowed exception").** Describe the change by what it does: "the fix that corrected the sleeve scores," not a number. Bug numbers (#1181) remain allowed — Joe sees those in the site's bug tracker.

Post-ship test instructions are click-path English: "open page X, click button Y, expect to see Z" (05-11). Popup questions follow the same standard, with mechanism explained by analogy where needed (05-02, 05-04).

Two self-tests before sending: read the draft aloud as if to a friend who has never coded — any token they'd have to ask about disqualifies the sentence. If you'd hesitate to say the phrase at a Manhattan dinner table, it doesn't belong. Where technical tokens ARE fine: code, commits, PR descriptions, bug records, this file — any audience that isn't Joe's chat.

**Applies to:** Every chat reply, status table, popup, and instruction Joe sees. All specialists. Hard rule.

### 0.5 (2026-05-13) — NEVER use 2006 as a lower bound for regime / macro data; the default is 1996

**What happened:** After the full-history backfill shipped (every series extended to its true start), the regime history modal still showed "Regime · 2006 – today" — 2006 was the cutoff of the OLD pre-backfill file. Joe verbatim: "The entire data set goes back to 1996!!! NEVER USE 2006 again. This has been logged as a rule. I cant say this again."

**Rule:** The default lower bound for ANY regime / macro chart, copy, or eyebrow text on macrotilt.com is 1996. Never hardcode 2006; never accept 2006 as a dynamic engine output — if the engine's earliest date evaluates to 2006, that is a bug in how it merges per-indicator series (a downstream gate requiring ALL anchors to exist collapses the range to the latest common start; pre-2002 the framework should still produce a read from the anchors that DO exist, per the methodology's reduced-stack disclaimer). The first-year-to-show for any series is whatever the underlying data actually delivers: copper/gold 2000, KBW/SPX 1993, yield curve 1976, ANFCI 1971, jobless claims 1967.

**Applies to:** All chart axes, eyebrow copy, modal titles, axis ticks, hover ranges, methodology references, any computed date-range string. Every specialist.

### 0.6 (2026-04-30 + 2026-05-10) — The agent merges its own work; a strategic green light covers implementation through production

**What happened:** The council twice pushed merge clicks onto Joe. First by ending turns with "ACTION NEEDED — click Merge" (Joe: "Since when am I doing all the merges!!! You do it!"). Then by asking "approve merge?" on every PR after Joe had already approved the strategic direction (Joe: "Why do I have to keep approving you pushing out garbage? just push it out!").

**Rule:** When a PR is ready — code shipped, self-UAT clean, specialist sign-offs recorded — the agent merges it via the API (squash default), deletes the branch, runs post-merge verification, and reports the outcome. When Joe approves an approach ("rebuild against the new framework," "kill that concept," "approved"), that covers the entire chain: branch → implement → test → merge → production verify, with no further check-ins. Fresh per-instance confirmation is still required for genuinely irreversible actions: schema-destructive migrations, force pushes, dropping tables, rewriting git history. A feature merge is not irreversible — a revert is one commit away.

**Applies to:** All. Joe's identity-bound actions are narrowly: credentials via UI clicks, explicit production go/no-go when asked, his own financial data entry, and trades/transfers (which the agent never makes).

### 0.7 (2026-05-11) — Ship only what was asked; no unsolicited "helper" UX

**What happened:** While fixing real bugs on a Macro Overview modal, the agent also inserted a "What to do about it" callout linking to Scenario Analysis. Joe: "I hate it - Remove this. Half ass bullshit you start adding to random places on the website. DONT DO THIS AGAIN."

**Rule:** When fixing a bug or filling a request, ship only the things asked for. Explanatory callouts, navigation hints, cross-tab links, tutorial copy, unrequested empty-states — all out of scope. The bar for adding new UX surface is an explicit Joe ask; "I think this would help" is not an ask. Scope creep is silent and removing it later costs another change and reads as churn.

**Applies to:** All UI work. UX Designer and Lead Developer both bind; sign-off fails on any PR with unsolicited additions.

### 0.8 (2026-05-21; added to this file 2026-06-11 from auto-memory) — Never burn Unusual Whales request budget on agent-initiated verification or backfill runs

**What happened:** Verification and backfill runs initiated by the agent consumed the daily Unusual Whales request allowance. Joe: "We are bumping up against UW limits. PLease stop wasting my usage!"

**Rule:** Verify Unusual-Whales-dependent fixes via code review plus the next normally scheduled run — never by force-dispatching extra runs that call the vendor. Reading our own database tables costs nothing and is always allowed. Remember the per-ticker ingest pipelines multiply with universe size; any universe enlargement is a vendor-load decision requiring Data Steward sign-off.

**Applies to:** All. Hard rule.

---

### 0.9 (2026-06-11) — Joe's freshness doctrine: stale = more than 24 hours PAST DUE

**Joe, verbatim:** "I want daily data updated daily. Weekly updated weekly. If things are more than 24 hours past due, they're stale. It's that simple. For some of the monthly and quarterly data it's fine to have an extended SLA (maybe 1 week for quarterly), but other than that, I don't see why this is so hard."

**Rule:** Every freshness budget derives from ONE formula — cadence + documented source publication lag + 24h grace — in calendar-aware hours from the close-anchored as-of. Same-evening dailies: 49h. Dailies whose SOURCE publishes T+1 (several FRED credit/funding series): 73h, basis written into the registry entry (`sla_basis`). Weekly: 192h — but lagged weeklies derive their full chain (CFTC futures positioning ≈288h; NY Fed dealer credit inventory ≈432h: the print a user sees is legitimately up to 17 days old the moment before its replacement lands). Monthly/quarterly: extended only for documented publication lags (~release + 1 week grace). Any budget that cannot be derived from this formula plus a documented lag is wrong. Structural follow-up queued: anchor staleness to DUE TIME (expected next update) so "24h past due" is literal for lagged feeds (COT) instead of approximated from data age.

---

### 0.10 (2026-06-11, Joe, after the THIRD zombie feed in one night) — RETIRED MEANS DELETED. EVERYWHERE. SAME CHANGE.

**Joe, verbatim:** "FUCKING DELETE SHIT THATS RETIRED!!!! THIS IS THE 3rd TIME YOUVE FUCKING DONE THIS. YOU KEEP READDING STALE OLD CODE AND CREATING THIS SAME FUCKING PROBLEM!!!!!"

**Rule:** Killing an indicator or feed deletes ALL of it in the SAME change: producer block, both registry files, the tracking row, every UI reference (live app AND legacy app AND admin maps), drills lists, schedule entries. No dormant remains "for reference," no "queued for cleanup," no review notes on corpses. Before touching ANY element, check whether it was killed (`git log --oneline -S '<element>'`); never register, fix, paginate, or otherwise resuscitate one. The nightly reconciler now exits red on any tracking row without a registry entry — an orphan row is a defect, not a backlog item. Tonight's zombies: put_call/buffett/bank_unreal (killed 06-10, resurrected 06-11), adv_dec (retired from use, producer+registry+row survived, froze and tripped the banner), naaim (killed 05-11, its scraper ran nightly for a MONTH).

---

### 0.11 (2026-06-16) — Be succinct. Joe will not read walls of text.

**What happened:** Multi-paragraph replies with caveats and context. Joe: "Too much text. Im not reading."

**Rule:** Lead with the answer in the first line. Default to 1–4 sentences. No preamble, no throat-clearing, no restating the question, no trailing caveats unless asked. Status updates: what's done + anything you need, nothing else. If there's more to say, offer it ("want the detail?") instead of dumping it. A table or 3 short bullets is fine when it's faster to scan than prose. When in doubt, cut it.

**Applies to:** Every chat reply. All specialists. Hard rule.


# 1 · TALKING TO JOE

### 1.1 (2026-05-29) — Refer to every indicator ONLY by its exact on-site name

**What happened:** The agent referred to indicators by internal keys, vendor series IDs, and factor-category jargon 3+ times in one session. Joe: "stop fucking referring to indicators by anything EXCEPT THEIR FUCKING NAME ON THE SITE."

**Rule:** Every time you name an indicator to Joe, use the EXACT display name shown on the live site ("MOVE Index", "10Y TIPS", "HY OAS", "USD Funding", "CFNAI (3M Avg)"). Never the registry key, the vendor series ID, the producer variable, or a category label that isn't a tile name. If you don't know the on-site name, open the live page and read it BEFORE writing the reply. If a concept isn't itself an on-site indicator, say so plainly rather than dressing it up as a tile.

**Applies to:** Every reply. All specialists.

### 1.2 (2026-05-01) — Questions to Joe carry Background + Context + Impact, popup-first

**What happened:** Open questions were tucked at the bottom of a spec file with no popup and options arrived as bare labels with no statement of what changes if Joe picks A vs B.

**Rule:** Every question to Joe goes through the popup. If a question genuinely needs more room than the popup carries, ask inline — but the framing requirement binds either way: (a) background, (b) why this question is on the table now, (c) the impact of each option on Joe and the product. Option descriptions carry the impact text directly. Questions buried in spec docs, status tables, or trailing prose are forbidden — Joe will not scan for them. Never send a decision-gated proposal as a bare yes/no approval.

**Applies to:** All specialists, every question.

### 1.3 (2026-05-08) — Specialists don't bounce specialist calls back to Joe

**What happened:** Senior Quant asked Joe via popup which historical window to use for a scenario — an archetype call inside quant scope. Joe: "I have no idea. My lead quant created this scenario! You tell me."

**Rule:** Specialist scope-and-archetype decisions (quant scenario windows and panel composition; UX color/spacing inside the locked palette; Lead Developer branch hygiene; Data Steward freshness thresholds) are made by the specialist silently and documented in the relevant artifact. Surface to Joe only what is irreversible (production deploy, schema migration, vendor cancellation) or genuinely cross-domain.

**Applies to:** All specialists.

---

# 2 · SCOPE & TURN DISCIPLINE

### 2.1 (2026-06-01 + 2026-06-02) — Finish every item the user named, in this session; no manufactured pauses, no self-deferral

**What happened:** Twice in two days. Asked to fix five named issues, the agent shipped a subset and framed the stop as a deliberate quality "pause" (Joe: "Why did you stop at #5?"). Separately, the agent set work aside on its own judgment ("that's a follow-up," "better as a fresh session") without Joe agreeing (Joe: "STOP BEING LAZY," "Why did you leave the broken engine not shipped?").

**Rule:** When the user lists N issues, all N belong to the current job. The only valid stop mid-job is a real external blocker — a decision the code can't answer, an approval, a missing credential — stated plainly. "I'll give the rest its own pass" is the forbidden manufactured-pause pattern. "Build it now" means now. Never silently downgrade scope to "later"; if there's a genuine blocker, state it and let Joe decide. Forbidden phrases when Joe has said finish/keep going: "worth a follow-up," "easy add when you want it," "separate PR," "still queued," "for the next iteration."

**Applies to:** All.

### 2.2 (2026-05-25) — A turn that plans to dispatch a subagent must emit the dispatch in that same turn

**What happened:** An agent narrated "dispatching subagent" for three consecutive turns and ended each on text with no dispatch actually made — pure narration, zero execution.

**Rule:** If a turn's plan is to delegate work, the delegation call must be in that same turn. Text at the end of a turn describes work already completed in the turn, or names the blocker — never a not-yet-emitted dispatch as if it had occurred. (Companion to the global rule: never end a turn with "starting on X" and then stop.)

**Applies to:** All four specialists.

### 2.3 (2026-04-30) — Self-monitor the context window; offer a structured handoff before bogging down

**What happened:** Long sessions accumulate context, slowing responses and degrading quality. Joe noticed the slowdown himself; the offer should have come from the agent.

**Rule:** At the start of constructing each response, check six bog signals: (1) thrashing on the same problem 4+ tool calls; (2) responses getting longer / more diagnostic / less actionable; (3) re-reading files already read this session; (4) proposing fixes already rejected; (5) a turn taking >2 minutes when earlier turns were fast; (6) claims diverging from what actually loading the result shows. If 2+ fire, or #5 alone: offer a handoff inline as a self-contained copy-pastable block — (a) what we were doing, (b) branch + last 5 commits, (c) working/broken, (d) immediate next action, (e) decisions not yet in LESSONS, (f) pending merges, (g) uncommitted work in progress. Frequency cap: if Joe declined last turn, don't re-offer unless a NEW signal fires. Never offer mid-irreversible-action — finish the action first.

**Applies to:** All.

---

# 3 · VERIFICATION & DIAGNOSIS

### 3.1 (merged: 2026-05-09, 05-10 b, 05-11, 05-19, 05-21, 06-02; specialist-review principle from 05-06) — What "verified" means

**What happened:** The most-repeated failure family in this file. "Verified" was claimed off file-reachability (a URL returning 200), green workflow runs, passing tests, bundle string-greps, single-theme screenshots, and renders-without-crashing — while Joe found, on the live site: a stale placeholder contradicting the just-shipped work (05-09), stray UI debris on pages the PR "didn't touch" (05-10), dead click-throughs (05-11), charts destroyed in dark mode (05-19), ~11 stale or impossible readings on a page called "completely fine" (05-21), and alerts that only wrote a database row nobody reads (06-02). Joe should never be the first eyeball.

**Rule:** "Verified" means the agent loaded the rendered, live surface and read it. The checklist, before any "done / fine / fixed / verified" claim:

1. **Load the live page cache-busted and read it top to bottom** — content, every data value sanity-checked, every freshness stamp (none in the future, none stale), calculations, layout. "It renders" is not "it's fine."
2. **Identify every page that consumes anything the deploy touched** — including transitive consumers (methodology drawers, tooltips, placeholder copy naming the domain) — and load each one.
3. **After any change to shared styles or components, walk EVERY page in the nav** hero-to-footer, not just the touched pages. A 5-second computed-style probe on suspect class names catches the "no styles loaded at all" failure mode that string-greps never will.
4. **Exercise every claimed interaction end-to-end:** click each tile and confirm the destination renders with expected content; submit forms and confirm the result; press close/cancel and confirm the dismiss. "The element renders" + "the handler fires" is not a user journey.
5. **For any visual change, check BOTH light and dark themes** (toggle is top-right on every page) with a screenshot of each. Anything touching the page background or chart canvas must use a theme variable; foreground accents on colored shapes may stay white.
6. **Verify at the layer that matters:** a trade fix means a real or dry-run order reaching the broker and reading the broker's response; an alert fix means a real email landing in Joe's inbox; a query/migration means real row counts; a UI fix means the rendered page. A green checkmark, passing test, or 200 response is necessary, never sufficient.
7. **Before claiming data "doesn't exist," sweep the real data stores AND the code that reads them across the whole site** — a doc line or code comment is a hypothesis, not a fact.
8. **Numbers a PM would act on get a Senior Quant plausibility pass** (a "score" column sitting below the documented buy threshold on every row is screaming), and copy/visual changes get an independent UX Designer review against the brand spec before "done" reaches Joe. Independent means reviewing the diff cold, not grading one's own homework.
9. **When delegating, brief against the live symptom and verify the delegate's result on the live system** — relayed claims are not verification.

**Applies to:** All. CRITICAL — this family is the root cause of stale data hiding behind pages that render fine.

### 3.2 (2026-05-18 + 2026-06-02) — Find the root cause before fixing; a revert is a hypothesis, not a fix

**What happened:** A page-blanking bug was "fixed" by reverting the most recent change — which was unrelated; the real cause was the previous day's work, and "site recovered" was reported while it was still broken. Separately, the paper rebalancer was "fixed" three times at the wrong layer (timer windows) before a live run to the broker surfaced the actual wall: the broker rejects market-on-open orders for fractional shares — a one-word order-type fix.

**Rule:** For "X never works," reproduce against the real external system FIRST and read the actual error — the broker rejection, the console error on the failing route — before theorizing or shipping. One verified reproduction beats three plausible-looking fixes. A revert is a valid hypothesis test only: if the user reports the problem persists after a revert, the revert was irrelevant — stop confirming "recovery," go back to evidence (read the console; grep the deployed bundle for the failure fingerprint; walk history for changes matching the symptom shape, not the most recent change). Never state a cause you have not confirmed with direct evidence — if unverified, say "I don't yet know," never a guess dressed as fact.

**Applies to:** All, especially Lead Developer + Senior Quant on pipelines/integrations.

### 3.3 (2026-05-10) — "Broken right after deploy" that you can't reproduce: suspect the user's browser cache first

**What happened:** Minutes after a verified production deploy, Joe reported a blank page. The agent nearly spiraled into regression-hunting; Joe's follow-up: "Looks fine now, must have been a cache issue" — his browser had held stale HTML pointing at a bundle that no longer existed.

**Rule:** When the user reports breakage within ~30 minutes of a deploy and you cannot reproduce: (1) confirm the live bundle matches the latest commit; (2) ask via one-question popup whether it looks fine after a refresh — phrased plainly ("sometimes the site serves a stale page for a few minutes after an update"), never "hard-refresh"; (3) only chase render-path bugs after the user confirms it persists post-reload.

**Applies to:** Any user-reported breakage shortly after a production deploy.

### 3.4 (2026-05-10) — Math changes require a hand-computed paper check before merge

**What happened:** A shock-propagation change shipped with visual verification only ("clicked, badge changes color"); the underlying formula was wrong — two pins at +5σ made every unpinned factor read +25σ. Joe found it on first interaction. The paper check on the fix caught the bug structurally: pin VIX +5σ with correlation 0.65 → MOVE must read +3.25σ, not +25.

**Rule:** Any PR touching a calculation — including UI changes around an existing calculation, since surrounding edits can break its inputs — includes, before merge: (1) two or three concrete inputs with hand-computed expected outputs, derived from the math, not from running the code; (2) the patched function run over those inputs, matching to within rounding; (3) the worked example in the PR body; (4) if the function has a bound, the bound exhaustively tested on a small enumerated space. Visual verification is necessary for UX but never sufficient for math — a button can light up correctly while the number it produces is wrong.

**Applies to:** All PRs touching pure-function calculations (scoring, propagation, weighting, regime classification, compute scripts) or the UI around them.

---

# 4 · DATA GOVERNANCE

### 2026-06-12 — Daily freshness is graded in trading sessions against the publication frontier, never in padded wall-clock hours

**What happened:** Daily credit-spread indicators showed green at 7:30 AM Friday carrying Wednesday's data. The hour-budget doctrine (cadence + lag + 24h grace = 49–73h) was sized never to false-alarm — which meant it also tolerated 2–3 days of true staleness on DAILY elements, long enough to hide a dead feed until the weekend. Underneath it sat two producer-sequencing defects the padding had been absorbing: the only FRED pull ran 6:00 AM, 3.5 hours BEFORE the credit series publish (~9:39 AM ET, verified), so the site ran a full session staler than necessary every day; and index breadth computed at 11 AM from a price panel complete at ~3:15 AM. Joe: "We can't have a 70+ hour SLA on DAILY indicators. The only time they can be 70+ stale is over the weekend or holidays."

**Rule:** A daily element is GREEN only when it carries the newest session its source can have published by now — "now" measured against the element's fetch deadline (scheduled fetch ET + grace, default 3h). AMBER at exactly one session behind that frontier (today's pull missed or late — visible the same morning). RED at two or more sessions behind, or on upstream error. Deadlines exist only on business days, so weekends and holidays are the only time a daily may sit more than one session old — and they never count against it. Hour budgets remain only for weekly/monthly/quarterly publication calendars. Corollaries: (1) producers must be scheduled so the frontier is reachable — pull AFTER the source publishes, compute AFTER inputs land; (2) each element's publish time in the manifest is evidence-based (checked against the source), not guessed; (3) the four graders (site clock, server clock, watchdog, chips) change in lockstep, always.

**Applies to:** Data Steward owns the doctrine; Senior Quant signs per-element publication facts; Lead Developer keeps the graders synchronized.


### 2026-06-12 — Stamp after publish; the watchdog needs an evidence source for every row it grades

**What happened:** The sector-sleeve allocator stamped its health row green BEFORE its publish step; the push was then rejected (data-commit race) and the freshly-stamped green row pointed at an allocation that never landed. The same night, the freshness watchdog clobbered three producer-stamped paper rows red with "indicator not present in indicator_history.json" — the third instance of the clobber bug (scanner-v5 2026-05-12, snapshot files 2026-05-19). Net effect: the one element that genuinely failed showed green, and three healthy elements showed red. The morning paper rebalance refused on the stale sleeve while the Asset Tilt chip stayed green. Compounding: the board producer wrote as_of from the runner wall clock (UTC "today" — after 8 PM ET that is tomorrow), and the failure-alert watchlist held a renamed (dead) workflow name, so the publish failure emailed nobody.

**Rule:** (1) A producer stamps its health row green only AFTER its output is verifiably published (pushed / upserted / deployed) — never before; every producer workflow carries a red-stamp step on failure (status + error only; freshness fields untouched). (2) The watchdog may only grade a row it has an explicit evidence source for (indicator bundle, named file, named table); any row without one is producer-owned — leave the producer's stamp alone. (3) A data file's as_of is derived from the data itself, capped at the last closed session — never from the runner's wall clock. (4) Failure-alert watchlists are part of every workflow rename's blast radius; a watch entry pointing at a dead name is a silent-failure machine.

**Applies to:** Lead Developer + Data Steward. Every producer workflow, every watchdog branch, every workflow rename.


### 2026-06-12 b — Two surfaces showing the same concept render ONE shared computation; a tooltip explaining a mismatch is a defect, not a fix

**What happened:** The Paper page's sleeve table headers summed per-position broker fields ("today" = sum of intraday P&L, "open P&L since entry" = sum of unrealized P&L) while the Performance card computed sleeve-level Daily and Inception P&L from the close-anchored snapshot. The numbers disagree whenever trades executed that session or realized P&L exists (Sleeve A: −$900 vs −$1,243; Sleeve B "today": $5,954 vs $3,592 the same day). A prior session had documented the difference in the Performance tooltip instead of fixing it. Fourth time Joe caught two surfaces on one page out of sync; he should never be the reconciliation engine.

**Rule:** When two surfaces on one page (or one site) display the same concept — "today", "since inception", a sleeve value, a score — they must render the output of ONE shared function reading ONE source, so agreement holds by construction. Writing a tooltip, footnote, or methodology paragraph that explains why two visible numbers differ is the failure mode, not the remedy. A stat with a genuinely different basis must carry an unmistakably different name and must not sit beside its sibling in a header line. When the shared source has not loaded, render an em-dash — never a divergent fallback from another basis.

**Applies to:** All. Senior Quant signs off on any header/summary stat addition; UX Designer rejects headers that juxtapose different bases.

### 4.1 (2026-06-11) — An orphan tracking row is either a live feed missing registration, or a killed feed missing cleanup — decide with evidence

**What happened:** A registration pass found tracking rows with no registry entry and registered all three per the no-grey-chips rule — without checking history. All three had been deliberately killed as phantom feeds THE DAY BEFORE; the kill removed producers and tiles but left tracking rows behind. Registration armed the header freshness pill on a dead feed: Joe saw "1 feed stale" with every visible tile green and no red tile anywhere to find.

**Rule:** An orphan tracking row has exactly two futures: (a) live feed missing registration → register it; (b) killed feed missing cleanup → delete the row. Decide with evidence: search commit history for kill commits naming the element, check whether any producer still writes it and any page still renders it. Killing a feed must retire ALL of it in one change: producer, tiles, tracking row, registry entries, drill lists. A page-level rollup (the header pill) must never grade an element set wider than what can be traced from a visible surface without NAMING the offenders in its tooltip.

**Applies to:** Data Steward — every registration or retirement.

### 4.2 (2026-06-11) — Never derive a refresh timestamp from a data date

**What happened:** Joe caught tooltips claiming "Data as of June 10 · Last refreshed June 9, 8:00 PM" — impossible pairs — plus an as-of rendered hours before the close. Root cause: six producers DERIVED the "last refreshed" stamp from the data's own date (midnight UTC renders as 8:00 PM the prior evening ET) or fabricated a 4 PM close stamp; the nightly reconciler froze as-of dates; nobody recorded the actual run time.

**Rule:** (1) Refresh/check stamps carry ONLY a real wall-clock run time (`now()` at write). (2) The as-of carries the business date the data represents (date-only intent at midnight UTC; display adds the official cutoff from the manifest) or a real event timestamp — never a dressed-up close time, never the future. (3) A daily market series never publishes a point for a session that hasn't closed in New York (keep the future-point guards in the fetchers). (4) The database clamps future stamps and rejects forward-dated price bars via triggers — do not remove them. (5) The freshness hook turns any remaining as-of-newer-than-refresh pair red with an explicit reason. Every new producer copies the honest-stamp comment block and verifies its first row shows a real run time in Admin·Data.

**Applies to:** All — every producer, every freshness surface.

### 4.3 (2026-06-11) — A displayed value must read the SAME source the engine acts on; auditing a table means auditing EVERY column

**What happened:** The Sleeve B score column showed 1–3 on every holding (buy gate is ≥5) for two weeks: the trading engine had switched signal sources but the display helper kept reading the dead table on the old scale. Joe found it the night after the agent had "verified" the page three times while staring at the wrong scores.

**Rule:** (1) When a data source is retired or an engine changes sources, grep EVERY consumer of the old source in the same change — engine and display must read one source of truth. (2) Self-UAT of a data table verifies EVERY column against its source of record (recompute independently), not only the columns the task touched, plus a plausibility pass. (3) Numbers a PM would act on get the Senior Quant plausibility check before the page is called verified.

**Applies to:** All.

### 4.4 (2026-06-01) — Never ship synthetic or placeholder data dressed as real; un-wired renders an em-dash

**What happened:** Large parts of the Scanner and Ticker pages rendered fabricated data as live: hash-seeded component scores, random-walk sparklines, a synthetic price path, and four hardcoded "events" identical on every ticker — while the real values sat unused in the database. This drove Joe's "zero faith in the data."

**Rule:** Every value on a data surface traces to a real stored field. If a field isn't available yet, render an em-dash (—) and say what's missing — never a synthesized stand-in, random series, or hardcoded example, even as a "temporary placeholder." Any fake/hash-seeded/random data generator in a production component is a defect. Before declaring a surface done, open the source row it claims to show and confirm each rendered value matches.

**Applies to:** All.

### 4.5 (2026-05-27) — Never accept silent staleness on a "successful" data workflow; fail loud

**What happened:** The indicator-refresh workflow logged success every morning while individual indicators went days stale — fetch helpers returned nothing on vendor hiccups and the result was silently dropped. Joe spotted stale values on the live site before any system did. Exit-code-zero-but-stale is the worst failure mode: it actively masks the problem.

**Rule:** Every producer that writes a "live" data file includes a fail-loud staleness gate: a per-indicator SLA table (in TRADING days, NYSE-calendar-aware — T+1 vendor series get 2, same-day series get 1), checked after the fetch but before the file is written; any breach fails the whole run, the workflow goes red, the watchdog files a P1 bug, and the stale file never ships. Helpers may return None to survive one indicator's hiccup, but the end-of-run gate is mandatory — "we log it to the health table" is not enough, because by then the stale file already shipped. A new indicator without an SLA entry is a missing config, not exempt: add the entry in the same PR as the producer.

**Applies to:** All data producers. Lead Developer + Data Steward sign-off on any producer change.

### 4.6 (2026-05-27) — Don't anchor on the vendor you've been using; check whether the publisher is upstream

**What happened:** Three daily Treasury yield indicators sat on FRED for 18 months and repeatedly shipped stale — FRED republishes Treasury's own daily data with an afternoon delay, after our morning run. The fix was free: read Treasury.gov, FRED's upstream publisher, which posts same-day.

**Rule:** When picking a source for a series, ask "who does this vendor get the data from?" If an upstream publisher exists at the same license tier (free/public) on a tighter cadence, that's the right source. Treasury.gov, FRED, NY Fed, ICE BofA, BLS, BEA all publish free feeds; FRED republishes most of them. Check the publisher before the republisher. Any new daily macro/rates indicator requires this check before the source is locked.

**Applies to:** Data Steward (lead) + Senior Quant.

### 4.7 (2026-05-03 ×2, rewritten 2026-06-11; the "untracked defaults to green" clause is SUPERSEDED by Hard Rule 0.1) — Freshness SLAs floor at worst-case publish lag; no false alarms on weekends; every chip-wired element is registered before merge

**What happened:** Chips lit red on a Sunday morning for working pipelines (a daily SLA of 25h breaches every weekend; monthly vendor series publish 3–4 weeks after period end and were graded against a 34-day window). Joe: "I only want to know when something breaks!!!!! I dont want red chips over weekends/holidays!!!" The original fix also defaulted UNTRACKED elements to green — that clause was reversed on 2026-06-02 by Hard Rule 0.1 (fake green forbidden): an untracked element is never silently green; it gets registered and seeded in the same PR.

**Rule:** SLA floors = worst-case publish lag + one full cadence cycle + operational grace:

- daily → 49h (covers T+1 publish + weekend)
- weekly → 192h; 384h for long-lag series (e.g. the term-premium model the Fed posts weekly)
- monthly → 1200h (~50 business days)
- quarterly → 3600h (~150 business days; some surveys land 10 weeks after quarter end)

When in doubt, check the vendor's actual history: the SLA must be at least the typical gap between the data date and when that point first appears, plus one cadence cycle — otherwise the chip lies red between releases. Red is reserved for actual breakage. (The deeper fix the original entry filed as follow-up — grade freshness off the real last-run time, not the data's own date — shipped 2026-06-11; see 4.2.) Adding a chip to a tile without registering the element in the manifest AND seeding its tracking row is a bug; the Data Steward sign-off must call out new chip wires.

**Applies to:** Data Steward + Lead Developer.

### 4.8 (2026-05-11 b) — Backfills persist to Supabase first, then the file change merges in the same work item

**What happened:** ISM history went "missing" three times: each time an agent parsed the source spreadsheet in-session, merged ~865 monthly points into a working copy of the history file, used it, and never committed — the next scheduled run overwrote the file with the stub, and the next session re-declared the data missing. Joe: "How did you misplace this data 3 times? Why isn't it in our database?"

**Rule:** Any non-trivial backfill (history, calibration tables, anything beyond a single new daily reading) is durably persisted to Supabase FIRST, then the file/JSON change is committed and merged in the SAME work item — no "next session." The producer gains a "hydrate from Supabase if the local series is shorter than the database" branch so a fresh checkout repopulates from source-of-truth before appending. Archive the raw source file in the repo for reproducibility. If we parsed it once, future-us reads it from Supabase without re-parsing.

**Applies to:** All historical backfills, calibration tables, and manifest updates introducing a new element.

### 4.9 (2026-05-21) — Resampling to a period-end label publishes a future-dated point for the in-progress period

**What happened:** Three Macro Overview tiles showed "last updated" dates in the future: month-end / week-Friday / quarter-end resampling labels every bucket with the period-END date, so the still-in-progress period publishes a partial value with a future stamp. Bonus finds: a credit-spread proxy ran ~2× the true spread on a wrong "the real series is license-restricted" assumption (it was free the whole time), and a ratio used non-standard scaling.

**Rule:** (1) After any resample to period-end labels, immediately drop buckets dated after today — the in-progress period is a partial value, not a finished observation. (2) Keep the end-of-run future-point guard that sweeps every indicator before writing. (3) Prefer a series' native daily cadence when every input is already daily. (4) Before believing a "vendor series is unavailable/restricted" comment, query the vendor.

**Applies to:** Senior Quant + Data Steward — every producer block that resamples or substitutes a proxy.

### 4.10 (2026-05-04) — Before changing a data file the website reads, find every reader and keep its labels

**What happened:** A script wrote different labels into a file the home page was already reading; the page found nothing under the labels it expected and every cycle-board score rendered as a blank zero — no crash, no log error, just a broken-looking page Joe caught within hours.

**Rule:** Before shipping anything that writes to a data file the site reads, search the site's code for that file's name, find every reader, and note exactly which labels each pulls. New code keeps those labels; if a label must change, the reader changes in the same PR so they ship together. After deploy, load the page and look at it.

**Applies to:** All producers writing site-consumed files.

### 4.11 (2026-05-04 b) — No hardcoded dates anywhere on the site

**What happened:** Hardcoded strings — "tax year 2026," "next release: May 6," an "as of" footer — each eventually went stale and had to be chased individually, with nothing alerting.

**Rule:** Every "current" date displayed in the UI is sourced from a live registry (the freshness-tracking table, the data manifest, or a snapshot file). If you find yourself typing a month or year into UI code, stop and ask "where would this come from if I refreshed at 6am tomorrow?" — that source is the one to read. Historical-event labels ("Dec 2021 — all-time peak") and calendar reference data (market holiday tables) are fine.

**Applies to:** All UI work.

### 4.12 (2026-06-09) — Scheduled notification emails are once-per-day even when their workflow fires many times

**What happened:** Joe received 7–8 paper-trading emails in one day instead of 2: the morning workflow deliberately fires every 30 minutes as insurance against late scheduling, and order submission was rerun-safe — but every fire re-sent its email.

**Rule:** Any email wired into a workflow that can fire more than once a day goes through the send-once helper (one send per email type per ET day, ledger-backed, fail-open). Redundant timers are for reliability and must never multiply notifications. Joe's inbox contract: exactly one morning summary and one execution report per trading day.

**Applies to:** Lead Developer — all notification wiring.

---

# 5 · QUANT METHODOLOGY

### 5.1 (2026-05-13) — Splice continuity: percentile rules are NOT scale-invariant across distribution shifts

**What happened:** Splicing a derived proxy (1962–2002) onto the actual series (2002–2026) inside a trailing 5-year percentile rule produced 100% Risk-Off for 18 straight months — the rolling window straddling the splice experienced a step-function regime change in the data itself, despite nearly identical means in the overlap.

**Rule:** Before splicing two series, compute local distribution stats in adjacent 5-year windows on both sides of the splice. If means or standard deviations differ by more than ~5%, apply the distribution mapping `X_scaled = μ_after + (X_before − μ_before) / σ_before × σ_after`. After splicing, validate continuity: count rule-fires in 6-month windows on either side — smooth is expected, a step (50% → 100%) is a bug. Document the anchor parameters in the methodology for reproducibility.

**Applies to:** All series-splicing feeding any percentile or rolling-window rule.

### 5.2 (2026-05-13) — Don't confuse "available at source" with "in the on-disk file"

**What happened:** The deployed history file had MOVE starting 2006; the real series goes back to 2002 at the vendor. Building the splice against the deployed file left a 3-year hole that corrupted the rolling window for 18 months post-splice.

**Rule:** For any series used in analysis, check three things separately: the on-disk file's first observation, the original source's inception date, and the published methodology's window (the authoritative one). If the first two disagree, pull the missing window from source before building anything on top.

**Applies to:** All indicator analyses depending on a specific window.

### 5.3 (2026-05-13) — Sub-composites double-count; build panels from primitives

**What happened:** A retired composite weighted four indicators equally — but one of them is itself a ~105-input composite that already CONTAINS two of the others; overlap correlations ran 0.90–0.99. The apparent diversification was illusory.

**Rule:** When building any panel, audit whether members are PRIMITIVES (a price, a yield, a spread) or COMPOSITES (weighted averages of other indicators). Prefer primitives; if a composite is included, exclude its sub-components from separate weighting. Run Pearson and Spearman correlation matrices on the panel and flag any pair above 0.85 as a double-counting candidate.

**Applies to:** All composite/panel design.

### 5.4 (2026-05-13) — Test indicator subsets empirically, never by assumption

**What happened:** A 5-indicator panel shipped on its published methodology without testing predictive value. The eventual analysis showed the yield curve had no near-term predictive power for drawdowns at any horizon up to 12 months, one input was weak everywhere, and a single strong indicator alone beat the full panel's risk-adjusted return — the panel was diluted by its weakest members.

**Rule:** Before adopting any panel for production, run discrimination analysis (AUC) at multiple forward horizons (1w / 1m / 3m / 6m / 12m) for each indicator individually and for every subset, against forward drawdown probabilities (10/15/20%). Flag anything below 0.55 AUC at the relevant horizon. More indicators is not better — dilution is real.

**Applies to:** Senior Quant — any indicator-driven regime engine. Backtesting is non-negotiable.

### 5.5 (2026-05-13) — Inflationary vs deflationary stress require different defensive sleeves

**What happened:** The original defensive sleeve (50% cash + 25% long Treasuries + 25% gold) implicitly assumed deflationary crashes. 2022 broke it: rising yields drove equities AND long Treasuries down ~20% together — the Risk-Off signal fired correctly and the sleeve compounded the loss.

**Rule:** When the regime is Risk-Off, check yield direction (trailing 3-month change in the 10-year yield, percentile-ranked vs trailing 5 years) to type the stress: inflationary (yields rising fast, ≥70th percentile) → cash + gold + short-duration Treasuries, avoid duration; deflationary (≤30th percentile) → cash + gold + long Treasuries; neutral → balanced. This two-axis architecture (stress level, stress type) is the structural fix for the discount-rate-shock blind spot in trend/risk-parity defaults.

**Applies to:** All defensive-overlay design, especially anything defaulting to long Treasuries as the equity hedge.

### 5.6 (2026-05-11) — Negative position values have multiple meanings; dispatch on kind, not sign

**What happened:** The allocation rollup classified every negative-value position as margin debt; a sold short call (an open option obligation) got labeled borrowed cash. Joe has no margin debt.

**Rule:** Where the data model permits negative values for structurally different reasons (margin borrowing, short equity, short options, accrued obligations, manual adjustments), bucketing dispatches on the KIND of row — asset class + direction — before any default liability bucket. When touching any negative-value branch, audit every other negative-value path in the same file for the same conflation.

**Applies to:** All allocation/rollup/aggregation logic.

---

# 6 · CODE & RELEASE DISCIPLINE

### 6.1 (2026-05-18) — Never call React hooks inside an inline IIFE in JSX; lift into a real component

**What happened:** An inline immediately-invoked block with state/effect hooks inside the Home render path executed only on the Home route, so the parent's hook count varied across renders — React tore down the whole tree on every other route (error #300).

**Rule:** Never call any hook inside an inline IIFE in JSX. If a render block needs local state or effects, declare a real function component at module scope and render it. Hooks must run the same number of times on every render. Before merging any render-heavy file, scan the diff for arrow-IIFE openings within ~20 lines of hook calls.

**Applies to:** Lead Developer + UX Designer — every PR adding or modifying JSX.

### 6.2 (2026-05-13) — Parse-check JSX after any structural rewrite before pushing

**What happened:** Two regex-based scripts that lifted components out of wrappers introduced unbalanced fragments; neither was caught locally; both cost revert + re-push cycles and a wasted build.

**Rule:** After any scripted/regex edit that adds or removes JSX elements (fragments, IIFE returns, wrappers), run a parser check on every modified file before committing: `node -e "require('@babel/parser').parse(require('fs').readFileSync('FILE','utf8'),{sourceType:'module',plugins:['jsx']})"`. If it errors, fix structure first. Never push JSX surgery without it.

**Applies to:** Lead Developer.

### 6.3 (2026-05-10 c + d) — Every class name referenced in JSX needs an actually-loaded CSS rule; style-string constants must actually be used

**What happened:** Two flavors of the same silent visual bug. A drawer component rendered class names with ZERO matching CSS rules anywhere — the browser's defaults left the inactive drawer's close "×" rendered as plain text above every page's footer. Separately, a page defined a 180-line CSS string constant that was never referenced after declaration (dead code), and the wrapper class its selectors were scoped to wasn't applied — the whole builder rendered unstyled. Both shipped because "the bundle contains the strings" passed.

**Rule:** When a component renders class names, confirm rules targeting them are actually loaded BEFORE shipping — mandatory for anything controlling visibility/position (drawer, modal, scrim, popover): `grep -n ".classname" src/theme.css` returning nothing means the component ships naked. When a file declares a CSS-as-string constant, grep for its second usage — declaration-only means unreachable styles; also confirm the scoping wrapper class is applied. Two greps, five seconds, catches both.

**Applies to:** All UX Designer and Lead Dev work introducing or relying on class names or style-string constants.

### 6.4 (2026-05-13) — CSS color/surface tokens must be theme-aware; never hide an undefined variable behind a hex fallback

**What happened:** Hundreds of call sites referenced token names that were never defined, each with a hardcoded hex fallback — so the fallback fired in BOTH themes and dark mode rendered dark-on-dark invisible text. Landed silently across 16 files before Joe screenshot-flagged it.

**Rule:** Use only the canonical tokens defined in BOTH the root and dark-theme blocks of theme.css (`--text`, `--text-2`, `--text-muted`, `--text-dim`, `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-faint`, `--border-strong`, `--accent`, `--accent-soft`, `--green`, `--red`, `--green-text`, `--red-text`, `--yellow`). Never write `var(--foo, #hex)` where `--foo` isn't defined — search theme.css first. A genuinely new semantic token gets defined in all three theme blocks before use. After any new color rule, load the page in both themes (see 3.1).

**Applies to:** UX Designer + Lead Developer — all CSS in files, inline styles, or style blocks.

### 6.5 (2026-05-13) — Never put the comment-closing pair `*/` inside a CSS comment body

**What happened:** A CSS comment describing token names with glob-style asterisks contained the literal closing pair mid-sentence — the comment closed early, everything after parsed as invalid CSS, and the build pipeline broke for unrelated work.

**Rule:** CSS comment bodies never contain the literal closing pair: spell out glob patterns ("the ink, bg, and line tokens"), break math/path fragments with spaces. Before committing any CSS change, check the diff for the pair and confirm every occurrence is an intended comment close.

**Applies to:** Anyone touching stylesheets, inline style blocks, or template strings emitting CSS.

### 6.6 (2026-05-10 e) — An array indexed by a string returns undefined; build a lookup or use .find

**What happened:** A page crashed the React tree on click: an array of factor objects was indexed with a string ID, returning undefined, then a missing-property read crashed — compounded by the property name itself having been renamed.

**Rule:** `SOME_ARRAY[stringKey]` is almost always a bug: either build a by-ID map once (`Object.fromEntries(arr.map(x => [x.id, x]))`) or use `.find` with a defensive null-guard. Any time the shape of a shared data structure changes (array ↔ map, field rename), grep all consumers before merging.

**Applies to:** All work touching shared data structures.

### 6.7 (2026-05-04 c) — Every file deletion greps the WHOLE repo first, including entry points and workflows

**What happened:** A file was deleted with the claim "0 imports" — the grep missed the main entry point, which imported it. Every scheduled scan crashed at import for days, and the failure was masked as a "skipped (out-of-window)" run, so no alert fired.

**Rule:** Before deleting any file, grep the whole repo for the basename with AND without extension, including main entry scripts, workflow files, and edge functions. Paste the actual grep output into the PR description. Separately: a "successful" run that took the no-op exit path (gated/skipped/weekend) must be visually distinct from a successful run that did work — otherwise a regression that turns every run into a no-op looks like a healthy quiet day.

**Applies to:** Lead Developer — every deletion.

### 6.8 (2026-05-10) — Rewriting one side of a producer/consumer contract requires auditing the unchanged side, key by key

**What happened:** A page rewrite read nested keys the producer never emitted (the producer's names were different); the build passed (bundlers don't type-check JSON blobs), the contract validator had no entry for those paths, and the live funnel rendered zeros after cutover.

**Rule:** When rewriting one side of a producer→consumer pair (script writing JSON read by the UI, or vice versa — the rule is symmetric), open the OTHER side and confirm every key the rewrite reads is actually emitted, including nested paths. If they diverge, decide before merging: rename producer (and backfill), rename consumer, or add a normalize adapter at the hydration boundary. Add the specific key paths to the contract checker so the next rename trips the check before merge. A passing build is not a passing contract.

**Applies to:** Every PR touching one side of a data contract.

### 6.9 (2026-05-07) — Never stack new fixes on a feature branch carrying unresolved regressions on other surfaces

**What happened:** Five fixes were built on an existing design branch that already carried a visual regression on another page; Joe loaded the preview to test a one-line fix and found a broken Macro Overview bundled into the same merge unit.

**Rule:** Before stacking commits onto an existing branch, load that branch's preview and audit the surfaces you're NOT touching. Any regression found — even one — means fork to a fresh branch off main and open a separate PR. A PR's merge gate is the WHOLE branch; if any other commit on it isn't ready, your commits aren't ready. Especially binding when the branch has 5+ commits or is a broad theme/redesign branch.

**Applies to:** All.

### 6.10 (2026-05-13) — Every new public table in a migration includes explicit access grants

**What happened:** Supabase announced that new tables in the public schema stop being auto-exposed to the Data API (existing projects cut over October 30, 2026). The site reads via the Data API, so any future table added without an explicit grant silently returns a permission error and its tiles render as em-dashes.

**Rule:** Every migration creating a public table includes the grant block (template lives at `supabase/migrations/000_TEMPLATE.sql`), scoped to actual access: read for anonymous if a tile reads it directly; service-role only for ingestion-only tables; row-level security enabled with a named policy. Data Steward sign-off on every table-creating PR must name which roles got which privileges and why.

**Applies to:** Lead Developer + Data Steward — every migration.

### 6.11 (2026-06-01) — Required status checks on the main branch silently freeze every nightly data bot

**What happened:** Branch protection with required checks went live, and the nightly refreshers push with the default workflow token (not an admin) — every direct push was rejected, the engine reading froze for days, and nothing visibly errored. Earlier the same week, plain pushes were also losing races to concurrent commits.

**Rule:** Daily data-refresh workflows check out and push with the admin bot token stored as the repo secret `MACROTILT_BOT_PAT` (admins bypass required checks; the anti-synthetic gate stays required for human PRs), and pushes rebase onto latest main with retries. If a data surface goes stale, check the producing workflow's last run for a protected-branch rejection or "fetch first" failure BEFORE assuming the compute broke.

**Applies to:** Lead Developer — branch protection and all bot workflows.

---

# 7 · PLATFORM FACTS & CREDENTIALS

### 7.1 (2026-05-26; paths updated 2026-06-11) — The GitHub token is on disk; read it, never ask Joe for it

**What happened:** The token was misplaced across sessions repeatedly, ending with the agent driving Joe's screen to push code by hand. Joe: "Can you please save this token so this never happens again… I set no expiration. Please do not lose this."

**Rule:** At the start of any task that pushes to GitHub, read the token from disk first: primary `~/Documents/Claude/MacroTilt/.secrets/github_pat.txt` (the project folder was renamed from "Claude Projects" to "Claude" on 2026-05-27); fallback: the token line in the repo's local env file. Configure pushes with the token inline; never echo it in chat; never drive Joe's screen to push. Scopes are repo + workflow (verified 2026-05-27). If a push fails on auth, the token was revoked — ask Joe to regenerate via the 3 UI clicks at github.com → Settings → Developer settings → Personal access tokens, then save the new token to the same file. Never ask "where is the token."

**Applies to:** Every session that pushes to the repo.

### 7.2 (2026-04-30) — Polygon Basic silently caps historical data at ~2 years

**What happened:** A backfill discovered the aggregates endpoint returns ~501 trading days per ticker on the Basic tier regardless of the requested start date — no error, no documentation; it silently truncates.

**Rule:** Assume the Basic tier returns ≤2 years per ticker unless verified otherwise. Viable patterns for deeper history: one-shot bootstrap from a free source into our own price table + Polygon forward-only (this is what shipped), or a paid tier upgrade. Never propose a Polygon-only deep backfill without explicit tier confirmation.

**Applies to:** Senior Quant + Data Steward — anything needing 2+ years of prices.

### 7.3 (2026-04-30) — Probe a third-party site's login stack for five minutes before estimating any scrape build

**What happened:** A scrape was planned as a ~6-hour cookie-login build on the assumption of a server-side form; the site turned out to be a single-page app with managed auth + CAPTCHA, costing three probe iterations and a wrong estimate.

**Rule:** Before estimating any "login + scrape" build, fetch the login page and check what actually runs it (form markup vs. managed-auth/CAPTCHA/single-page-app markers). If managed auth is present, plan around a headless browser or manual cookie path from the start — direct programmatic login is almost certainly blocked.

**Applies to:** Lead Developer — any third-party integration estimate.

---

# 8 · SPECS, COPY & PRODUCT DECISIONS

### 8.1 (2026-05-18; paths updated 2026-06-11) — Read the surface's spec docs BEFORE editing page-level files

**What happened:** Three sessions in one day rewrote the Methodology page without reading the two handoff/spec docs sitting in the workspace; each rewrite missed structural facts those docs already answered, and two of three were reverted.

**Rule:** Before touching any page-level file, read every workspace doc whose filename names that surface. Current locations: the MacroTilt project folder (`~/Documents/Claude/MacroTilt/`) — start with `WHERE_THINGS_LIVE.md`, then any `HANDOFF_*.md`, `*_SPEC*.md`, `*_PUNCHLIST*.md`, and surface-specific direction docs — plus repo-root docs fetched fresh from origin/main (per 0.3). These are the source of truth for what the page should currently look like; the project Pre-Flight Checklist's "check Knowledge Base files first" binds specifically here.

**Applies to:** All four specialists; Lead Developer especially when rewriting a page.

### 8.2 (2026-05-04) — When a calibration or methodology JSON exists, it IS the spec; never invent your own panel

**What happened:** A nightly compute script invented its own indicator panels for three mechanisms whose calibration file already specified exact indicators, readings, percentiles, and concern-directions. Credit scored Neutral when the spec said Caution — a different band on the live page.

**Rule:** Before writing any compute script for a numeric output, search the repo for an existing calibration/methodology file in that domain (keywords: calibration, methodology, threshold). If one exists, read it and use its values directly. Support every direction encoding it defines — never silently treat unknown direction strings as "high is concerning." A checked-in spec trumps anything invented in a script.

**Applies to:** Senior Quant + Lead Developer — every scoring/compute script.

### 8.3 (2026-05-04 e) — Methodology copy is sourced from production code, never from memory

**What happened:** A fresh methodology page listed indicator panels that were not in production — drafted from memory of generic regime-monitoring writeups. Joe caught the contradiction immediately.

**Rule:** Before writing methodology copy that names an indicator, source, formula, threshold, ETF, or count: open the file that produces that thing in production (the calibration JSON, the compute script's panel definitions, the allocator's constants) and quote what's actually there. For backtest numbers, re-run the harness and quote its output — never quote a number from a pre-existing doc without reproducing it. A number living only in a doc with no script behind it gets a follow-up: reproduce it or drop the claim.

**Applies to:** All methodology and documentation copy.

### 8.4 (2026-06-10) — Indicator copy is factual and academic, never editorial

**What happened:** Proposed indicator headers included invented color ("the signature of a true risk-off regime," "calm surface, nervous undercurrent"). Joe: "please dont make up editorial nonsense… I want fact based what it is, how its measured, what it tells you. In academic terms."

**Rule:** Every indicator header has exactly three factual parts: what the series is, how it is measured (one clause), and what levels or changes have historically meant — with numbers and named historical episodes, no metaphors, no trader-poetry. A market-standard nickname ("the fear gauge") is acceptable only when it's the series' actual common name. Same-day extension: never name a statistical operation in a header — "regressed out," "winsorized," "principal component," "z-score" are banned there; describe in words what the operation does ("strips out what the economy's current state would predict"). Operation names may appear only inside "How it's measured," with a plain-words gloss.

**Applies to:** All indicator, positioning, and methodology copy site-wide.

### 8.5 (2026-05-08) — When the user provides exact copy, use it verbatim

**What happened:** Joe's mockup included a specific headline; the agent synthesized its own "improved" version. Joe: "This is the header btw — I already told you this."

**Rule:** User-provided copy in a mockup, screenshot, or chat — headline, subtitle, button label, error message — is transcribed verbatim; it IS the spec. Honor the mockup's visual emphasis, never paraphrase or condense. If the copy doesn't fit the layout, flag the constraint and ask before rewording. Before shipping any hero where the user supplied a mockup, search the deployed text for the mockup's exact copy and confirm a hit.

**Applies to:** All — especially heroes, page subtitles, modal titles, buttons, empty states.

### 8.6 (2026-06-02, binding design) — The paper-trading engine is SIGNAL-ONLY with end-of-day-only pricing

**What happened:** The original rebalancer pushed every holding back to a fixed dollar weight, so pure price drift generated trades, and it priced positions off the broker's live mark, which disagreed with the end-of-day feed the rest of the site uses. Joe: trades fire on SIGNALS ONLY, and every price comes from our existing end-of-day feeds.

**Rule:** The engine trades ONLY on signal entry (new name), signal exit (name dropped → sell whole position), and signal-driven resize (tier/weight change past the band). A held name is anchored to its COST BASIS, which changes only when we trade — price movement never triggers a trade. All pricing (targets, share sizing) comes from the end-of-day price table; the broker supplies ONLY held quantity and executed fill prices. Orders are market/day — never market-on-open, which rejects fractional shares (the book is dollar-sized, so every position is fractional). Tolerance band: max($500, 3% of the position's own target). Do not reintroduce market-value diffing or broker prices.

**Applies to:** Senior Quant + Lead Developer — any change to the paper engine, pricing, or order types.

---

### 6.12 (2026-06-15) — The repo was ~58% machine files + retired code; a cleanup ran in four phases. Keep it clean.

**What happened:** The tracked repo had grown to ~988k lines / 3,066 files, of which only ~109k powered the live site. Installed packages and build output had been committed before the ignore rules existed; the entire legacy tab site shipped in every build via a ?v=2 back-door; an old local pipeline generation still sat at the root; and several killed feeds still had producer remnants. Agents kept grepping the repo, finding retired producers/registries/UI, and reviving them.

**Rule:** (1) Never track installed packages, build output, logs, or OS files — the cruft guard enforces this. (2) The overhaul shell is the only site; there is no legacy app and no ?v=2. (3) Before registering, fixing, paginating, or wiring ANY element, check `killed_elements.json` at the repo root — a name there is dead; the action is to delete the remnant, not revive it (companion to 0.10). (4) The weekly dead-UI detector reports any src file the live site cannot reach; treat its bug as a real defect. (5) Reachability is judged by the BUNDLER (scripts/detect_dead_ui.mjs), never a hand-rolled grep — a regex importer under-counts live files and will mark live code dead (this exact bug nearly deleted ~60 live files in Phase 2; the build caught it).

**Still open (next focused job, Data Steward + Senior Quant):** killed feeds with live producer residue — the Buffett Indicator (still computed nightly by fetch_history.py), Bank Unrealized Losses and Buffett (still fed into the cycle-v2 engine), and the Advance-Decline Line (still seeded by the breadth-rebuild job). Eradicating these changes computed scores, so it needs the backtest/paper-check loop (3.4, 5.x) — not a blind delete. Locations are in `killed_elements.json` under each concept's "residue". The automated resurrection guard stays unarmed until this residue is gone.

**Applies to:** All.

---

### 6.13 (2026-06-15) — Tooltips must be INSTANT; never use the native title attribute

**What happened:** On the Data page I added hover tooltips using the HTML `title` attribute. The browser delays `title` tooltips ~1 second before showing them. Joe: "Tooltips aren't instant. This is (should be a hard rule). I cant keep correcting you on simple things like this."

**Rule (HARD):** Every tooltip MacroTilt renders appears the instant the pointer is over the element — zero perceptible delay. NEVER use the native HTML `title` attribute for a tooltip (it has a built-in ~1s delay that cannot be removed). Use the site's `Tip` component (portal-rendered, shows on mouseEnter) or an instant CSS tooltip (a `:hover::after` with NO transition-delay). Any tooltip with a show-delay is a defect. When adding tooltips, hover one before claiming done and confirm it appears immediately.

**Applies to:** All UI work. UX Designer + Lead Developer.

---

# 9 · RETIRED (archive — no longer binding; kept so the history isn't lost)

- **2026-05-26 — "Site-overhaul brief lives on disk; read it before any redesign work."** Retired 2026-06-11: the overhaul shipped and became the default live site on 2026-05-30, and the page-by-page walk-through completed 2026-06-10. The entry's build-target instruction (the nested live folder) became actively wrong after the cutover — live source is the repo root. The design brief archive remains in the MacroTilt project folder's site-overhaul directory if ever needed. The surviving general principle — read the spec before redesign work — lives in 8.1.

- **2026-05-06 — v2 cutover quality gates and sub-agent sign-off process.** Retired 2026-06-11: the v2 cutover is complete and v2 itself was retired behind the overhaul. The surviving principles — independent specialist review before "done," and never weakening a quality gate to pass it — live in 3.1.

- **2026-05-03 — "Unregistered elements default to a green chip."** SUPERSEDED 2026-06-02 by Hard Rule 0.1: fake green is forbidden; untracked elements get registered and seeded in the same PR. The surviving content of the original entry — SLA floors sized so working pipelines never alarm on weekends, and registration-before-merge — lives in 4.7.
