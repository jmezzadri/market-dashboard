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
3. **The three governance pages updated to match:** **Admin·Data** (element appears and is monitored with a real chip), **Macro Overview** (visible row in its category grid; the standalone All Indicators page was retired 2026-07-07 by Joe - Macro is the indicator inventory surface), **Methodology** (documented in the sources/method tables).

Greps must cover the vendor name, table name, column name, element ID, AND every human-readable label that names them ("FRED", "Treasury.gov", "10Y TIPS", "T+1") — vendor labels show up under many phrasings. Forbidden: shipping without the map; calling a change "done" after fixing only the pointed-at surface; consumer lists from memory; specialist sign-off on a PR whose map is missing or shorter than the actual surface count.

**Applies to:** All four specialists. Lead Developer owns building the map; every other specialist checks their domain on it before signing off.

### 0.3 (2026-06-03, merged with 2026-04-30 re-baseline rule) — The Cowork-mounted local copy is STALE; never edit or commit a repo file from it

**What happened:** The mounted repo folder is a frozen snapshot whose git pointer is dead — it can never pull. Editing a file there and committing it via the API silently REVERTED newer commits (the Asset Tilt hero regressed to an old version; previously-fixed crash patterns were reintroduced, blanking the page). Separately (2026-04-30), inventory work made multiple wrong "this is dead code" calls by reading a stale local checkout instead of the live repo.

**Rule:** Treat the mounted disk as UNTRUSTED for any file you will commit. Before editing ANY repo file, fetch its current content from origin/main:

```
curl -H "Authorization: Bearer $PAT" -H "Accept: application/vnd.github.raw"   "https://api.github.com/repos/jmezzadri/market-dashboard/contents/<path>?ref=main"
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

### 2026-06-19 — One provider per source; every source names its exact dataset + location; no mashups, no guessing

**What happened:** The manifest lumped multiple providers into one "source" ("Wikipedia + iShares", "Invesco QQQ holdings + Polygon"), source fields were vague about WHAT data and WHERE, and the S&P-500-breadth SSGA source was omitted entirely. Joe: "There is no methodology to how you operate. This is atrocious. Source: what is the actual website/source/location you're going? Specifically what is the data being sourced."

**Rule (binding data-governance standard):** A SOURCE = exactly ONE provider pulling ONE specific dataset from ONE specific location. Never combine two providers in a single source. Each source declares four fields, no exceptions:
1. **Provider** — the actual organization (Wikipedia, iShares, Invesco, SSGA/State Street, Polygon, FRED, CFTC, NY Fed, Treasury.gov, Yahoo, ISM, multpl/Shiller, FINRA).
2. **Dataset** — the specific data pulled, named concretely ("Russell 2000 constituents = IWM holdings", "S&P 500 grouped EOD prices", "VIXCLS daily series"). Never a category.
3. **Location** — the exact URL / API endpoint / file the producer hits.
4. **Method** — API / CSV / XLSX / scrape / DB.

A COMPUTED element lists EACH input source separately (provider + dataset + location + method) plus the in-house transform — never a mashed vendor string. "Source" answers WHERE (origin); "Dataset" answers WHAT — different fields, both mandatory. Before writing any source, VERIFY the real provider/dataset/location against the producer code; never guess, never mash. The manifest carries a structured `inputs` array per element; the Data-page Source column shows each distinct provider as its own tile with its specific dataset.

**Applies to:** Data Steward (owns) + all. Every manifest entry, every Data-page source tile. Hard rule.


### 2026-06-16 — Freshness is ONE clock: grade off the LAST PULL, never the age of the data (binding; FRESHNESS_CHIP_SPEC.md is the acceptance test)

**What happened:** The two-clock design (data-age SLA on most chips + a session-frontier grade on dailies) drifted into the three contradictions Joe kept catching: fake-green (Uranium read green while its feed was effectively dead), false-red (lagged monthly/quarterly series red between releases), and "refresh older than data" impossible pairs. Joe wrote FRESHNESS_CHIP_SPEC.md as the binding contract and acceptance test for all 50 indicator + 28 positioning chips.

**Rule:** Every chip grades green/red off the **LAST PULL** — the producing job's real last successful run time (`pipeline_health.last_good_at`) — versus an SLA **sized to the JOB's run cadence + grace, NOT the data's publication lag**. Calendar-aware so weekend/holiday hours never count (no Monday false-reds). Red only when: now − last pull > SLA, OR the run errored, OR the data is dated after its last pull (**hard invariant: last pull ≥ as-of**). A lagged data series stays GREEN while its job keeps pulling — a monthly series read by the daily job carries a 49h SLA, not an 1800h one. Two-state (green/red); an untracked element is grey, never silently green. The grade is ONE shared function (`gradeByLastPull`) used by every chip, the hook, and the watchdog, mirrored client/server — one edit moves all of them, so the fix is executed and verified as a single focused pass, never hand-patched per-surface. The chip shows five fields: Source · Frequency+pull-time · As of (data date) · Last pull (job run time) · SLA in days & hours. Producers stamp `last_good_at` = the real run time (honest stamp); the watchdog must NEVER fabricate it (preserve the producer's stamp, never `now()` as a fallback — that was the COT-chip fake-green). **This SUPERSEDES, for the GRADE, the session-frontier doctrine (2026-06-12) and the publication-lag SLA floors (4.7: daily 49h/weekly 192h/monthly 1200h/quarterly 3600h sized to DATA age); those SLA numbers are retired — the SLA now measures the JOB, so weekly/monthly/quarterly series read by the daily job are 49h.** The honest-stamp rule (4.2: refresh time = real run time) and the no-fake-green rule (0.1) remain and are reinforced.

**Applies to:** Data Steward (owns) + Senior Quant + Lead Developer + UX Designer. Every freshness surface, every producer, every grader.


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

### 4.17 (2026-07-06) — GitHub can drop an entire cron block; a GitHub-cron backup for a GitHub-cron primary is not redundancy

**What happened:** On Mon 2026-07-06 GitHub's scheduler silently dropped this repo's whole morning block (~08:00-11:30 UTC): the 06:15 ET brief writer, every BRIEF-FRESHNESS-SELFHEAL sweep fire, the screener, and all 7 pre-open fires of PAPER-PORTFOLIO-EOD-DAILY. The homepage showed Saturday's brief past 07:15 ET on Monday, and NO rebalance orders were queued for the open until a manual dispatch at 07:28 ET. The self-heal never fired because it rides the SAME scheduler that failed. MONITOR-RECONCILE (cron `0 */6 * * *`) was the only morning schedule that fired.

**The rule:** Every workflow whose morning outcome Joe depends on (homepage brief, pre-open orders) must be reachable by BOTH: (a) a `workflow_run` chain off MONITOR-RECONCILE (different cadence, empirically survives block drops), and (b) the Vercel morning-ensure cron (`api/brief-ensure.js`, `45 10 * * 1-5`), which checks the LIVE outcome on a non-GitHub scheduler and dispatches whatever is missing. New morning-critical workflows get added to both paths at creation time. Redundant off-hour fires must be provably safe: in-runner window/calendar guards + idempotent effects + send-once email helper (per 4.12).

**Applies to:** Lead Developer + Data Steward — all schedule work.

---

### 2026-07-13 — Stale-feeds incident: a dead dispatcher, a silent breadth skip, and a health row that could only go red

**What happened:** Four feeds plus the sector-narrative health row were stale at once, each from an independent, silent failure.
(a) `trigger-workflow` — the edge function every Supabase-cron backup job calls to fire a GitHub Actions run — returned 503 BOOT_ERROR on every call; the deployed bundle was un-bootable (the management API could not even retrieve it). Every backup dispatch silently no-opped, so the two Paper intraday feeds went stale the first time GitHub also dropped the workflow's own schedule. A second latent bug hid behind the boot error: `PAPER-PORTFOLIO-INTRADAY.yml` was never in the dispatcher's allowlist, so even a booting dispatcher would have returned `workflow_not_allowed`.
(b) The index-breadth producer (`BREADTH-DAILY`) wrapped each index in a per-index `try/except` that printed "FAILED" and let the job commit an S&P-only file and exit green. When both Nasdaq-100 membership sources broke at once (Invesco holdings CSV -> HTTP 406, Wikipedia dropped its parseable Ticker column), the NDX leg silently skipped and `ndx_above_50ema/200ema` froze at Jul 8 while the S&P pair advanced — no error, coverage still 100%.
(c) `narrative_sector` was red with `last_good_at = null` forever. The health check's narrative-gap block only ever wrote the synthetic row with `status=red` on staleness and never stamped a green recovery, and its `source` label was hardcoded to `macro_commentary` for both surfaces — even though the sector blurb is written to `sector_commentary` daily.

**Rule:**
- A dispatcher whose failure silently disables a whole class of backup jobs must never boot-crash: read secrets lazily inside the handler (a missing secret returns a clean 500, not a dead isolate) and use the built-in `Deno.serve` so no module is fetched over the network at boot. Its allowlist is part of the contract — every workflow any pg_cron job dispatches through it must be listed; re-check `cron.job` whenever a workflow is renamed or added.
- A multi-part producer NEVER publishes a partial file. If any part fails, or the parts disagree on the latest session, the whole run exits non-zero and commits nothing — a per-part `try/except` that lets the run "succeed" on a subset is the silent-staleness bug (4.5) in a new place. Index-membership sources are fragile and change without notice: keep a primary plus fallbacks and hard-fail if none yields a full universe (Nasdaq-100 now: Slickcharts primary, Invesco + Wikipedia fallback).
- A health/watchdog row must be able to recover on its own. A check that only ever writes `red` (and skips the row when healthy) can never return to green — stamp the row every run: green with an honest `last_good_at` when the evidence exists, red when it does not. A row's `source` label names the ACTUAL table/file it reads, per surface — never a copy-paste of a sibling's source.

**Applies to:** Lead Developer + Data Steward own; Senior Quant on the breadth membership + fail-loud. Every dispatcher, every multi-part producer, every synthetic health row.


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


### 8.11 (2026-07-07) — No invented display copy; section names and headlines are the feed's, not the writer's

**What happened:** The cream-rebrand mockups shipped with made-up section headlines ("Six dials that matter," "Four markets where the crowd has left," "Movers land after the close"). Joe: "PLEASE dont try and get cute with wording. You're only confusing me and readers."

**Rule:** Every section heading on a data surface is the section's real name (the same name the feed/registry uses). Display-size text carries real content only: the engine's actual read, the brief's actual headline, real values. Explanatory footnotes state the selection rule factually ("every market at a 3-year extreme is listed"). Banned: metaphor headlines, editorial slogans, invented phrasings of data states. Companion to 8.4 (indicator copy factual) and the 2026-06-26 washed-out/crowded copy ban.

**Applies to:** UX Designer + anyone writing UI copy. Every page.


# 9 · RETIRED (archive — no longer binding; kept so the history isn't lost)

- **2026-05-26 — "Site-overhaul brief lives on disk; read it before any redesign work."** Retired 2026-06-11: the overhaul shipped and became the default live site on 2026-05-30, and the page-by-page walk-through completed 2026-06-10. The entry's build-target instruction (the nested live folder) became actively wrong after the cutover — live source is the repo root. The design brief archive remains in the MacroTilt project folder's site-overhaul directory if ever needed. The surviving general principle — read the spec before redesign work — lives in 8.1.

- **2026-05-06 — v2 cutover quality gates and sub-agent sign-off process.** Retired 2026-06-11: the v2 cutover is complete and v2 itself was retired behind the overhaul. The surviving principles — independent specialist review before "done," and never weakening a quality gate to pass it — live in 3.1.

- **2026-05-03 — "Unregistered elements default to a green chip."** SUPERSEDED 2026-06-02 by Hard Rule 0.1: fake green is forbidden; untracked elements get registered and seeded in the same PR. The surviving content of the original entry — SLA floors sized so working pipelines never alarm on weekends, and registration-before-merge — lives in 4.7.

---

### 8.7 (2026-06-25) — A redesign that adds new layout classes MUST extend responsive.css the same day; and the Paper Score column reads the LIVE scanner score, never the sizing integer

**What happened:** Two regressions surfaced together. (1) The Phase-2 glass redesign (shipped 6/24) introduced new `.home-v11` layout classes (shell / ribbon / layout + per-page scanner/paper/ticker grids), but `responsive.css` only knew the OLD class names — so on a phone none of the new multi-column grids collapsed, the layout forced the viewport wide, and everything rendered tiny/broken. The mobile top-nav also never listed the Data tab and pointed "Portfolio" at a dead `/portfolio` route. (2) The Paper Portfolio Score column showed `paper_positions.current_score` — a rounded INTEGER snapshot written with `max(score)` over all history — so it showed a name's best-ever score, not its current one (held names that had dropped out still showed 5; RDN showed 4 vs the scanner's live 3.25; NVRI 5 vs 4.75). Joe: "you continue to regress back… I can't keep calling out small nitpicks like this."

**Rule:** (a) Any redesign/PR that introduces a new design-system class scope (e.g. a new `.home-vNN`) is not done until `responsive.css` (imported last) collapses every new multi-column grid at ≤900px/≤640px AND the mobile top-nav (TopNav.jsx) is reconciled against the sidebar (same destinations, same real routes). Verify the mobile breakpoint, not just desktop. (b) Any score shown ANYWHERE on the site reads from the single canonical source the Scanner uses (`trading_opps_signals`, latest `scan_date`) and is formatted with the identical trimmed-decimal formatter. The integer score is for POSITION SIZING only (historically Score × $20K; as of 2026-07-07 sizing is a FIXED $100K equal-weight, no leverage, hold-until-score<3) and must never be the displayed Score — display and sizing are different concerns. This guarantees Scanner and Paper can never disagree on a name's score again.

**Applies to:** UX Designer + Lead Developer (responsive coverage on every redesign); Senior Quant + Lead Developer (score display source-of-truth).


---

### 8.8 (2026-06-29) — Never ask Joe to merge a PR or click anything in GitHub; the agent merges its own work

**What happened:** After fixing the frozen homepage, the turn ended by asking Joe to click "Merge" on PR #1317. Joe: "I dont merge. How is this not a hard lesson/rule?!" Joe is a management consultant, not a developer — he does not merge PRs, click GitHub buttons, or operate the repo. Asking him to merge is the same anti-pattern as asking him to run a terminal command or "verify with `file`" (8.x / 2026-04-28).

**Rule (HARD):** The agent merges its OWN PRs to `main` itself, via the GitHub API with the repo PAT, once the required specialist sign-offs (per each domain's authority) are written into the PR description. Never ask Joe to merge, approve a merge, or click anything in GitHub. After merging, monitor the Vercel deployment, confirm it succeeded, view the rendered page, then report. The only things Joe is ever asked for are (a) an identity-bound credential supplied through a service UI he is already logged into, and (b) a plain-English go / no-go decision in chat when the call is genuinely his (e.g., a product/scope choice). Forbidden asks: "merge this PR," "approve the merge," "click Merge," "can you merge," or routing any GitHub button-click to Joe.

**Applies to:** All.


---

### 4.13 (2026-06-30) — A disabled-then-re-enabled scheduled workflow does NOT resume its cron until a commit re-arms it; and the brief generator must never crash on an omitted optional key

**What happened:** The homepage froze a SECOND day running. Two independent faults, same symptom. (1) DAILY-BRIEF-WRITER was manually disabled during the 2026-06-29 incident and re-enabled — but GitHub did not resume its 06:15 ET schedule. Every run in its history was a manual dispatch; the cron silently never fired for three straight weekdays (Jun 26 / 29 / 30) while the rest of the repo's scheduled jobs ran normally that morning. (2) When force-dispatched to recover, the generator crashed: the model returned a valid brief but omitted the optional `movers` key, and `validate()` hard-required `movers` and aborted the whole publish — even though `main()` already had a `movers` fallback one line later. Because the self-heal reuses the same generator, the safety net would have crashed too.

**Rule:** (a) A scheduled workflow that has been disabled does not reliably resume on re-enable — you MUST push a commit that touches the workflow file on the default branch to re-register the cron, then confirm the next scheduled run actually fires (look for an `event=schedule` run in the run list, not just `workflow_dispatch`). Treat "every run in history is workflow_dispatch" as proof the schedule is dead. Prefer never disabling a critical producer; if you must, re-arm by commit in the same change. (b) A content generator for a user-visible surface splits its output keys into HARD (cannot render without) and SOFT (default to empty); a single omitted optional field must never abort the publish and freeze the page. Validate hard keys only, default the soft keys, and add one model retry. (c) A safety net that reuses the primary generator does NOT protect against a bug inside that generator — the freshness self-heal guards against a missing run, not a crashing run; both failure modes need coverage.

**Applies to:** Data Steward (schedule re-arm + freshness), Lead Developer (generator robustness).


---

### 4.14 (2026-06-30) — Exactly ONE generator emails the daily brief (homepage writer is email-off); and NO automation may depend on Joe's laptop or a scheduled task

**What happened:** After re-arming the brief writer and dispatching it to un-freeze the homepage, Joe got a SECOND "Market Brief" email. Two generators were emailing him daily: the established legacy routine (~06:45 ET to gmail + EY, subject "Market Brief - Month DD, YYYY") and the newer cloud DAILY-BRIEF-WRITER (subject "Market Brief - YYYY-MM-DD", gmail only). The writer's real job is to refresh the homepage file `public/daily_brief.json`; it was never meant to add a second email. The writer's dual EDT/EST sibling crons plus the self-heal could also each fire a send (the once-per-day-email trap, 4.12). Joe: "I dont want two emails daily." He also set a hard rule: "We never use scheduled tasks. NOTHING RELIES ON MY MACBOOK BEING OPEN."

**Rule:** (a) Exactly ONE generator sends the daily brief email. The homepage writer is EMAIL-OFF by default (`BRIEF_SEND_EMAIL` unset) and only updates the homepage file; the legacy routine remains Joe's single daily email. If the writer is ever promoted to sole emailer, the legacy routine is retired in the SAME change - never both live. (b) The writer is idempotent per day: if the published brief is already today's it does nothing (no model call, no commit, no email), so any number of runs collapse to one. (c) HARD RULE: MacroTilt automation runs ONLY in the cloud - GitHub Actions, Vercel cron, Supabase, Google Apps Script. NEVER a Cowork/Claude scheduled task, and NOTHING may depend on Joe's laptop being open. Anything needing a reliable clock uses a cloud scheduler.

**Applies to:** Data Steward + Lead Developer. All.

**Amendment (2026-07-22, Joe-approved):** The "never a Cowork/Claude scheduled task" clause has ONE approved exception: the "MacroTilt Daily X Chart" scheduled task, which runs entirely in Anthropic's cloud (Joe's laptop closed or open makes no difference) and produces a chart + caption Joe posts to X manually. The rationale of the rule — nothing depends on Joe's MacBook — is preserved. Site/data automation remains cloud-scheduler-only; no other Cowork scheduled tasks without Joe's explicit approval.

---

### 4.15 (2026-06-30) — `supabase_get_all` raises `SystemExit`, not `Exception`; and `except Exception` silently swallows the contract

**What happened:** `MASSIVE-TICKER-REFERENCE-BACKFILL` was failing for 12 days. Root cause: `fetch_priority_overlay()` iterated `("positions", "watchlist")`, but both tables had been renamed/removed. `supabase_get_all` raises `SystemExit(f"select {table} offset {offset}: HTTP {status} {body}")` on non-2xx responses. The function doc said "Falls through silently if either table read fails — priority is a nice-to-have, not load-bearing" — but `SystemExit` is a subclass of `BaseException`, not `Exception`, so `except Exception as e:` never caught it. The script exited 1 on every run, leaving `massive-ticker-details` red (7-day SLA) for 12 days without a failure alert triggering the stuck-red escalation.

**Rule:** Any error boundary that calls `supabase_get_all` (or any function that raises `SystemExit` as an error signal) MUST use `except BaseException as e:` (or `except (Exception, SystemExit) as e:`) if the intent is truly "silently fall through." `except Exception` does NOT catch `SystemExit`. Additionally: when renaming or removing a DB table, grep the entire codebase for the old name before merging — table references live in scripts, workflows, AND the PostgREST string literals that are invisible to type-checkers.

**Applies to:** Data Steward, Lead Developer.

---

### 4.16 (2026-07-03) — A weekday cron is NOT a trading-day calendar; every order-submitting job asks the exchange calendar first

**What happened:** July 4 2026 fell on a Saturday, so the exchange observed the holiday on Friday July 3 — a weekday. The paper rebalancer's Mon–Fri crons fired; its only guards were a time-of-day window and a signal-freshness check (both passed on a holiday, correctly by their own contracts), and it queued 11 at-the-open orders at the broker on a day with no session — parking them for Monday's open and emailing a "rebalance queued" summary on a market holiday. The CLOSE snapshot phase and the INTRADAY mirror both already had market-closed guards; the one phase that SUBMITS ORDERS was the only one without. A prior weekday holiday (Juneteenth 2026-06-19) masked the gap because the diff produced zero intents that morning.

**Rule:** Any job that submits, modifies, or cancels orders confirms TODAY (ET) is a trading session per the broker's calendar (`is_trading_session`, Alpaca `/v2/calendar`) before doing ANYTHING — before intent computation, before DB writes, before emails. Holiday/weekend → quiet no-op (INFO log only; Joe's inbox contract is per TRADING day, so a holiday sends nothing). Calendar unreachable → BLOCK and file a P1 (fail-safe matches the freshness gate). A `1-5` cron field is a weekday filter, never a market-calendar filter; the two are not interchangeable. When adding a market-closed guard to one phase of a multi-phase pipeline, audit the OTHER phases for the same gap in the same PR — this shipped because close/intraday got guards and the submit phase didn't.

**Applies to:** Lead Developer + Data Steward; every workflow that touches broker orders.

### 8.9 (2026-06-30) — `data_max_age_hours` in the manifest is a hard freshness gate; set it against the ACTUAL upstream publication lag, not a round number

**What happened:** `term_premium` (`THREEFYTP10`, ACM 10Y Term Premium, NY Fed / FRED) turned red because `data_max_age_hours` was set to 144 (6 calendar-day equivalent). THREEFYTP10 has a known 5-8 trading-day publication lag; on day 7 post-last-data-date the business-calendar age crossed 144h and the data clock failed, producing a false red. No data was actually stale — the NY Fed simply had not published yet.

**Rule:** Before setting `data_max_age_hours` for a lagging series, look up the upstream publication cadence and lag. For THREEFYTP10: lag ≤ 8 trading days = ~192h; use 288h (12 trading days) as the gate to absorb normal variance. General pattern: `data_max_age_hours = (max_observed_lag_trading_days + 4_day_buffer) × 24`. A window that is too tight produces false reds that erode trust in the freshness system; a window that is too loose masks a genuinely dead feed. Pick the tightest window that does not fire on a normally-lagging healthy series.

**Applies to:** Data Steward.
---

### 8.10 (2026-07-04) — 8.7 wasn't enough: EVERY new multi-column layout ships with a 390px check, and inline grid styles are a responsive trap

**What happened:** Joe reported the site "looks terrible" on his iPhone, two weeks after 8.7's responsive pass. Audit at 390px found two severe breaks that 8.7's rule ("new design-system class scope must extend responsive.css") never caught, because neither introduced a new class scope: (1) MacroPage's category tiles used an INLINE `gridTemplateColumns:'repeat(3,1fr)'` — no stylesheet rule can override an inline style without `!important`, and since the div had no class there was nothing for responsive.css to target; at phone width the six tiles rendered 3-across with value/percentile text printing on top of indicator names. (2) The Paper performance matrix (`.pmx`, benchmark rows shipped 7/3) used `table-layout:fixed` + per-cell ellipsis — 7 columns crushed into 390px, every value truncated to "$9…". Also: Indicators' filter pills (`inline-flex`, no wrap) clipped three categories off-screen, and Methodology's section grid track was blown to 433px by a table's intrinsic width, clipping content at the card edge (fixed with `min-width:0` on grid children + scrolling the table).

**Rule:** (a) Any PR that adds a NEW multi-column grid, table, or fixed-width layout — regardless of whether it adds a class scope — is verified at 390px before merge (headless browser screenshot is sufficient; the harness lives in this session's playbook: playwright chromium at 390×844). (b) Never author layout grids as inline `style={{gridTemplateColumns}}` on classless divs; give the element a class so responsive.css can reach it. If an inline grid must stay, the collapsing rule needs `!important`. (c) Data tables on phone width scroll inside their card at natural column widths (the positions/scanner pattern) — never `table-layout:fixed` + ellipsis, which silently destroys every value. (d) Grid children that contain tables need `min-width:0`, or the table's intrinsic width blows out the track and clips every sibling.

**Applies to:** UX Designer + Lead Developer.


## NEVER GUESS · NEVER TAKE SHORTCUTS · ALWAYS VERIFY ON THE LIVE RENDERED SYSTEM (2026-07-08, Joe, emphatic)
**What happened:** After the scoring rebuild I (a) left the paper-engine buy line at Score ≥ 5 when 5 had become the MAX score — so "buy" required a perfect score; (b) told Joe the blast radius was updated while the Scanner-page intro, methodology, tables and manifest still described the old 4-pillar / 0–10 / Score×$20K model; (c) repeatedly "fixed" things from source assumptions and said "let me stop guessing" and then guessed anyway.
**Hard rule — binding:**
1. **Never guess. Never say "let me stop guessing" and then infer.** Before asserting or fixing anything user-facing, INSPECT the live artifact — the rendered DOM (Chrome MCP / screenshot in the user's actual theme), the live DB row, the deployed file — and read what is actually there.
2. **When a change alters a scale, threshold, or composition, recompute EVERY dependent number and update EVERY surface that shows it.** Enumerate them by grepping the WHOLE repo (score dial max, appear/buy/exit lines, funnel bands, methodology page, scanner intro copy, column set, drill-down, data_manifest consumers, vendor blast radius) — never from memory. A threshold like "buy ≥ N" must always sit strictly below the max.
3. **After every deploy, load the rendered page and READ it** in the user's theme. "The source looks right" and "the DOM query says clean" are necessary but not sufficient — look at the pixels.
4. **No shortcuts. A task is not done until the live rendered result is verified.**
**Applies to:** All.

### 4.18 (2026-07-13) — PostgREST silently truncates at 1,000 rows, and Range-header paging on RPC calls is NOT honored: page in SQL, and treat a cap-sized response as a red flag

**What happened:** The RSI divergence scanner's first production run "succeeded" while scanning only 1,000 of its 1,486-name universe. The producer called a set-returning database function through the REST layer, which caps any single response at max-rows (1,000 here) and gives no error, no header hint you can rely on, nothing — the truncation is silent, and the fail-loud minimum-universe gate (≥500) sailed right past it. The first fix attempt paged with `Range` headers, which our PostgREST config ignores on RPC calls: every "page" returned the same first 1,000 rows and the pager looped until the job was cancelled. The validation run hadn't caught any of this because it staged data server-side (SQL INSERT…SELECT), which has no response cap — the validation path and the production fetch path were not the same transport.

**Rule:** (a) Any REST/PostgREST fetch that can return ≥1,000 rows MUST page with EXPLICIT `p_limit`/`p_offset` SQL parameters on the function itself (with a stable ORDER BY), looping until a short page — never Range headers on RPC, never a single trusting call. (b) A response of exactly the cap size (1,000) from an unpaged call is presumptively truncated — fail loud, never process it as complete. (c) Sanity gates sized as "at least N" don't catch truncation at a cap above N; when the expected cardinality is known (a universe, a panel), assert against a server-side count, not a floor. (d) If validation used a different transport than production (server-side SQL vs REST), the transport itself is untested — do one full production-path run and diff its counts against the validation run before calling the port done.

**Applies to:** Lead Developer + Data Steward.

### 4.19 (2026-07-15) — Sleeve attribution comes from the FILLS LEDGER, never from ticker heuristics; one sleeve key end-to-end

**What happened:** The two-sleeve book went live and the Paper page showed Momentum's 49 names (~$484K) inside the Insider sleeve ("52 holdings") while Insider's idle cash showed under Momentum. Root cause: the positions and NAV writers bucketed sleeves by TICKER through the retired Sleeve-A/`v10_allocation.json` lookup, which can only answer A-or-B — while the true sleeve of every share was already recorded on `paper_orders`/`paper_fills`. The intraday table's own CHECK constraint didn't even allow 'M'. Downstream, per-sleeve inception, "Today" P&L and the cash split were all wrong or blank.

**Rule:** (a) The sleeve of a position is provenance, not a property of the ticker: every writer that buckets positions, cash, NAV or P&L by sleeve derives it from the fills ledger (net shares per ticker+sleeve; proportional split when two sleeves own the same name). (b) One canonical sleeve key ('B' Insider, 'M' Momentum) across paper_orders, paper_fills, paper_positions, paper_intraday_positions, and the nav tables' column families — adding a sleeve means widening every CHECK constraint and every writer in the SAME change. (c) An order ledger must be closed-loop: whatever mirrors fills also flips the originating order's status (submitted → filled/cancelled/rejected) in the same run — a status that nothing ever advances is a bug, not a marker.

**Applies to:** Lead Developer + Data Steward + Senior Quant.

### 8.13 (2026-07-21) — A reformat is not a redesign; every rendered claim must match what's on screen

**What happened:** The six-tile homepage rework shipped with each tile keeping its old section's color (ink engine, gold positioning) purely by inheritance, a double-height Engine card full of dead space, pills overflowing the positioning tile, and a headline "Markets at a speculative-positioning extreme this week: 9" above a list showing only 6 (display cap) — where "this week" was also false (SOFR had been at its extreme for weeks). Joe: "thats a lazy reformatting job… think critically when redesigning."

**Rule:** A redesign re-decides, from scratch: surface/color system (each color must have a stated reason — e.g. one accent card for the single most important read), sizing (no card taller than its content needs), and every piece of copy. Three copy checks are mandatory on any tile: (1) a rendered count must equal the number of items visibly listed — if a cap exists, either drop the count or drop the cap; (2) no time-window claim ("this week") unless the data actually resets on that window; (3) status labels are the shortest accurate words (Oversold/Overbought), not methodology sentences.

**Applies to:** UX Designer and Lead Developer, every layout or copy change.

### 8.12 (2026-07-15) — "Make X look like Y" means component-level parity, not container-level
Joe's Scanner feedback escalated twice in one night because the first pass matched the CARDS (same tile, width, header) but not the COMPONENTS inside them: the Momentum table kept its own ticker typography, row rhythm, and a bespoke drawer while the Insider table had 16px gold tickers and the ScanDrill drawer. Container parity without component parity reads as "not the same damn thing" to the user, every time.
**Rule:** when two surfaces are supposed to match, diff every layer before calling it done: (1) container (card, width, padding, radius), (2) header furniture (kicker, title, description, meta), (3) table anatomy (header style, row padding, ticker cell font/size/color, value alignment), (4) interaction (what click does, hover, chevrons), (5) the expanded/drawer state's full visual language (background, grid, typography, buttons). Reuse the existing component's exact markup patterns and classes instead of approximating them. Also: body copy in tiles is never smaller than 14px, never lighter than ink-soft, and never width-capped below the tile's content width.

### 4.20 (2026-07-20) — prices_eod must sit on ONE share basis: a split with no retro-adjustment is a fake crash in every return window that crosses it

**What happened:** Joe cross-checked his ThinkOrSwim watchlist columns against our scanner math and the numbers disagreed on CRWD: TOS said +91% 3-month return, prices_eod computed −51%. Root cause: the daily ingest writes each day's close at that day's share basis and NEVER re-adjusts history, so CRWD's 4:1 split (2026-07-01) left pre-split rows at 763 next to post-split rows at 193 — a fake −75% "crash" inside every ROC/momentum/RSI window that crossed the seam. A sweep found ~40 corrupted tickers over 3.5 months (CRWD, HON, MLI, DD + leveraged ETFs). The 7/14 Power Trend list happened to survive (CRWD failed the 1.3× volume gate on clean data too), but only by luck. Also caught: (a) NOT every big overnight gap is a split — PRIM/CAR/WGS/MXL had near-exact-half gaps that the splits vendor confirms were REAL price moves; blanket ratio-based adjustment would have corrupted good data; (b) seams are per-ticker quirky — HON had exactly ONE raw-basis day (6/26) between two adjusted segments, so "adjust everything before the gap" is wrong without walking the series; (c) our own splits table had records the vendor's current API no longer corroborates and vice versa — corroborate ratio-vs-observed-gap before applying anything.

**Rule:** (a) prices_eod doctrine: the entire stored series per ticker is on the CURRENT post-split basis; any ingest that can write a new basis must re-base history in the same run (MASSIVE-DAILY now runs scripts/adjust_splits_retroactive.py — seam detection + RPC apply_split_adjustment, migration 084). (b) Never adjust on a ratio heuristic alone: require a corroborating split record AND an observed gap matching the split factor within tolerance; the residual is the stock's real move that day. (c) When validating any return/momentum computation, cross-check at least one split-affected name against an independent adjusted source (TOS, vendor charts) — parity on non-split names proves nothing about basis handling. (d) An external per-ticker check (Joe's TOS columns) caught what our internal consistency checks could not; treat independent-source parity as a standing UAT tool.

**Applies to:** Lead Developer + Data Steward + Senior Quant.

### 8.14 (2026-07-21) — Multi-stat tile rows get ONE shared-grid header and one figure font; never per-row labels or right-jammed mixed type
The first cut of the scanner-tile detail put a tiny label over every number, pushed all stats against the right edge, and mixed serif display figures with sans small figures in the same row. Joe: "Why would you jam all numbers to the right? Use same fonts. It looks sloppy." When a tile row carries more than one stat, render a single muted header row that shares the row's grid template, spread the columns across the full row width, and set every value in the same sans tabular font — color and weight carry the hierarchy, not typeface changes.

### 2026-07-21 — A feed cutover is not done until its tracking row and self-stamp ship in the same change

**What happened:** The 2026-07-20 UW→EDGAR insider cutover registered the new feed in the data manifest and deployed the nightly ingest, but never seeded its `pipeline_health` row and never gave the workflow green/red stamp steps — repeating Hard Rule 0.1's exact failure mode. Result on Admin·Data: the SEC EDGAR vendor card graded RED (tile grader synthesised red from the absent row), the detail row said grey "Not yet tracked," and the header pill said "All feeds current" (it skipped feeds with no health row) — three contradictory answers in one viewport, over a feed that was actually running fine.

**Rule:** (1) Cutover/new-feed checklist is atomic: manifest entry + `pipeline_health` seed row (honest timestamps from the real first run) + workflow green-after-publish and red-on-failure stamp steps, all in the same change. (2) All surfaces treat "no health row" identically: neutral grey "not yet tracked" — never a synthesized red, never green. (3) The header pill counts scheduled, SLA-carrying feeds that have no health row and reads "N feeds not tracked" (grey) — it must never read "All feeds current" while such a feed exists. (4) The `pipeline_health` key is the PUBLIC manifest's short `name` (e.g. `insider_history_edgar`) — the root registry's dotted ids do not resolve in the freshness hook.

**Applies to:** Data Steward (owns) + Lead Developer. Every new feed, every vendor cutover.

### 2026-07-28 — During market hours the live price is the headline; never lead with yesterday's close

**What happened:** The Ticker page hero showed the prior session's close in 44px with the live price in a small footnote line underneath ("close Jul 27 $8.02" big, "LIVE $7.72" small). Joe: "Who displays stock quotes like this?" No quote surface anywhere leads with a stale close while the market is trading.

**Rule:** When the market is open AND the live feed covers the name, the live price is the big number, the day's move ($ and %) computes against the last completed close, and the official close demotes to the small reference line. Closed market / uncovered names keep the close-first layout. Prices always render full decimals ($7.70, never $7.7). Any new price-quoting surface follows the same hierarchy.

**Applies to:** UX Designer + Lead Developer. Every surface that quotes a price.

### 2026-07-29 — One ungradable row must never take down the whole health watchdog; deregistering a feed's manifest entry while its health row stays live is a poison pill

**What happened:** The 7/20 UW teardown (#1411) deleted 6 elements from the public manifest but deliberately kept 4 of their `pipeline_health` rows live until the 8/12 lapse (uw-universe-snapshots, uw-ticker-events, earnings_history, scanner-v5-daily). The watchdog grades a row with no manifest SLA as `unknown` — but the `pipeline_health` CHECK constraints only allowed green/amber/red, so the watchdog's SINGLE batch upsert failed and the whole function 500'd on every 30-minute run for 9 days. Blast radius of one bad row: (a) the narrative-blurb green-stamper (section 7) never ran, so `narrative_macro`/`narrative_sector` sat red and the header said "2 feeds stale" on every page every day; (b) ALL stale-feed email alerts were dead for 9 days; (c) `pipeline_fetch_log` recorded nothing. Nobody noticed because the failure mode was silent 500s inside a cron.

**Rule:** (1) The watchdog writes per-row on batch failure — one poisoned row is skipped and reported (`failedRows` in the response), never allowed to kill stamping + alerting for everything else. (2) A health row the watchdog cannot grade (no manifest entry at all) is SKIPPED per the anti-clobber doctrine — its producer's own stamp stands. (3) DB status constraints must accept every status the code can emit (`unknown` added, migration 089); a constraint narrower than the code's type is a time bomb. (4) Teardown checklist gains the mirror of the 7/21 cutover rule: removing a feed's manifest entry requires deciding its health row's fate in the same change — retire the row or keep it producer-owned, never leave it for the watchdog to grade against a manifest entry that no longer exists. (5) A recurring 500 in any scheduled edge function is an incident, not noise: the fetch-log gap (last row 7/20) was visible for 9 days and no check looked.

**Applies to:** Lead Developer (owns) + Data Steward. Every feed teardown, every scheduled function.

### 8.15 (2026-07-28) — When a nav page is renamed, every surface that names pages is in the blast radius (Methodology TOC, eyebrows, TAB_LABEL, manifest tab ids)

**What happened:** The nav's pages were renamed across the v12 redesigns (Macro Overview→Macro, Trading Scanner→Scanner, Paper Portfolio→Paper; All Indicators retired into Macro), but the Methodology page's Sections TOC, its section eyebrows, its §01 copy, and the vendor table's TAB_LABEL map kept the old names — and TAB_LABEL never covered several manifest tab ids at all (macro, portfolio, asset-tilt, portopps, admin), so raw slugs like "macro" and "portopps" rendered in Where-it-shows-up. Joe caught it: "the Sections table of contents don't match our site pages."

**Rule:** A page rename or retirement is a data change with a blast radius (companion to 2.x). Grep the whole repo for the OLD page name and update every hit the same day: NAV_ITEMS, the Methodology SECTIONS list and eyebrows, body copy naming the page, TAB_LABEL, and any doc. TAB_LABEL must cover EVERY tab id in BOTH data_manifest.json files (repo root AND public/ — the page fetches public/); an unmapped id renders as a raw slug, which is a bug. Section/TOC labels are the nav's real page names (8.11) — never a former or invented name.

**Update (2026-07-28, Joe):** The Methodology TOC is ONE entry per nav page, named EXACTLY as the nav names it — no concept-level entries ("The Engine", "Data freshness contract"). Concepts fold inside their page's section with in-page anchors kept for deep links.

**Applies to:** UX Designer, Lead Developer — any nav, page-name, or manifest-surface change.

### 2026-07-29 — A regime gate with no entry confirmation sells the bottom; and any signal is judged by the history the user can SEE

**What happened:** Joe spot-checked the visible regime strip on the Macro engine card and found the engine went Risk Off on 4 April 2025 — the exact bottom of a 10% S&P drawdown — and back to Risk On on 18 April, after the rebound. His verdict: "the only history on this indicator visible to users proves to them that the indicator is garbage." Both halves of that were right. The gate fired off a single Friday above the 75th-percentile line, and the card showed only the trailing two years, which contained that whipsaw and none of the 2008 / 2020 / 2022 episodes the engine was built for.

**What the review found:** across 1986–2026 the unfiltered gate produced 69 de-risk episodes, 48 of them four weeks or shorter, and only 26 of 69 beat simply staying invested. Requiring the percentile to hold at or above the line for two consecutive Fridays before a de-risk STARTS (exit unchanged) cut that to 45 episodes and improved return, Sharpe and maximum drawdown together — 12.01%/yr, 0.606, −33.3% against 11.60%, 0.584, −34.9%. Two weeks beat one, three and four; it held in both halves of the sample and at every threshold pair tested.

**Rule:** (a) Any threshold-crossing regime signal that trades on a single observation is presumed to whipsaw until an entry-confirmation variant has been tested against it — test confirmation length as an interior optimum (k−1, k, k+1) and in both sample halves before adopting. Asymmetry is the point: confirm on the way in, exit immediately. (b) A signal's on-page history window is part of the signal's credibility. Never show a window so short that it contains the misses and none of the saves — if the full record is defensible, show the full record, and give the user a way to see it against what the market actually did.

**Also:** when re-deriving a locked backtest artifact, first reproduce the locked numbers exactly with the OLD rule as a control. Reverse-engineering the artifact's own conventions (years = weeks/52, Sharpe = (CAGR − 3.25%)/vol, state applied to the FOLLOWING week's return) caught a one-week lag error that would otherwise have silently shifted every published figure. `scripts/apply_gate_to_backtest.py` runs that control.

**Applies to:** the macro engine, the paper sleeves, the scanners, and any future rules-based signal with a threshold.
### 4.19 (2026-07-29) — A daily brief with no memory of yesterday repeats itself; novelty is a data field, not a writing instruction

**What happened:** Joe: "my daily market brief email feels like the same email every day... we've even called out TSM as an equity with insider buys for like a week straight." He was right and it was worse than a week. Across the 13 briefs 7/17-7/29, TSM was the featured single name 9 times and JEF 7. Root causes, all structural: (1) the screener the brief draws single names from is nearly frozen - TSM sat on it 34 CONSECUTIVE sessions, and its scores are coarse integers (3.0 / 5.0) so ties never break and the order is identical every morning; (2) COT and price-percentile extremes are weekly-to-quarterly data narrated as if fresh daily - the yen has been pinned at its 3-year extreme for 63 straight sessions, copper for 90, 3M SOFR for 14 weeks, and these kept appearing as "what to watch today"; (3) nothing in the chain knew what yesterday's brief said; (4) 14-24 tickers file fresh insider buys EVERY DAY and the brief used none of them; (5) the `crowding` block of `brief-positioning` read `v.pctile_3yr` when the percentile lives under `v.stats` - it had returned an empty array on every call since it was written, so a whole rotating input was silently dead.

**Rule:** For any recurring, same-audience output (daily brief, weekly digest, alert), novelty is a DATA field the producer computes, not an instruction the writer is asked to remember. Every candidate item ships with its age - `days_on_list`, `weeks_at_extreme`, `trading_days_at_extreme`, filing age - and the feed splits candidates into `featurable[]` and `already_covered[]` so the writer physically cannot re-nominate a stale one. The writer must also read its own PRIOR output (here: `macrotilt.com/daily_brief.json`, which at the 05:45 run still holds the prior session) and treat it as already said. "Nothing qualifies today" is a valid outcome - an omitted line beats a recycled one. And when a recurring output starts feeling repetitive, measure it before theorising: dump the last N published artifacts and count how often each entity recurs.

**Corollary:** the deterministic banned-copy scrub in `scripts/build_daily_brief.py` protects the HOMEPAGE only. The EMAIL comes from a separate Claude routine whose prompt is not in git - it shipped "crowded equity longs" on 2026-07-29. Any copy rule Joe sets must be applied to BOTH generators in the same change. The routine prompt is now mirrored in `docs/DAILY_BRIEF_ROUTINE_PROMPT.md`; the routine itself can only be edited through the browser (the trigger API refuses agent updates to UI-created routines).

### 8.16 (2026-07-29) — A dollar and a percent that describe the same move must come from the same base; `sleeve_*_value` is the only column that ties to the account

**What happened:** Joe: "How am I down money but + return?!?! Something isn't right." The Paper hero read **Today −$1,249** directly above a matrix reading **Book Day +0.1%**, on the same account, in the same card. The account was genuinely **+$1,387** on the session (live NAV $951,401.46 vs the 7/28 close of $950,014.84 — the broker's own `day_pnl` was correct in the database the whole time). The headline dollar was not a rounding artefact or a stale read: it was the wrong sign, and it was the ONLY number a non-technical reader looks at.

**Root cause:** `paper_nav_daily` carries two different sleeve breakdowns and only one of them is a partition of the book. `sleeve_*_value` is residual-adjusted — `mirror.py` and `intraday.py` each spread the broker residual (the gap between the account's true equity and our lot-based reconstruction) pro-rata across the sleeves, so `sleeve_b_value + sleeve_m_value == total_nav` to the cent on every row. `sleeve_*_nav` is raw derived cash (capital − cost basis + realized) + equity, so the pair OVERSHOOTS the book by the entire residual — $2,635 on 7/28, $4,648 on 7/23. The page's `sleeveNavOf` preferred `*_nav` on close rows and fell through to `*_value` on the live intraday row (which has no `*_nav`), so the "Today" delta subtracted a close-row base from a live-row base of a different construction. The −$1,249 it printed was that day's residual carrying a minus sign. A code comment asserted `*_nav` "partitions total_nav exactly (mirror.py)" — it never did; the claim was written from intent, not from a query.

**Rule:** (a) Where two columns could both plausibly represent "the sleeve's value", the one that is a verified partition of the parent total is the ONLY display base — check it with a query (`sum(parts) − total`) across the whole live history before wiring it, and re-check whenever a column is added. Reconstruction columns like `sleeve_*_nav` are inputs to sizing (`translator.py`), never a display base. (b) Never let a base change across a row-type boundary: if the live row and the close row expose different columns, resolve BOTH sides through one accessor with one preference order, and prefer the column that exists on both. (c) A headline figure and the percentage of the same move must be derived from the same quantity — the Book's "Today" now anchors on the account's own NAV delta with the sleeve sum as fallback, so the dollar and the percent cannot disagree in sign even if a sleeve column goes null. (d) Whenever a comment claims two columns tie, the claim needs a query behind it or it does not go in.

**Applies to:** Lead Developer, Senior Quant — the Paper page, and any surface that shows a dollar change beside a percentage change of the same thing.

### 8.17 (2026-07-29, same day as 8.16) — Every visible part must add to its visible whole, rounding included; a reader checking your arithmetic is the last line of QA

**What happened:** an hour after 8.16 shipped, Joe checked the page the way any reader would — by adding it up. "Insider is down 7100, momentum is up 1150, top of page says down 6731. How is simple arithmetic so hard?" He was right again, and 8.16 had only fixed the top of the page. Three different bases were still on screen at once:

1. **Sleeve headline values didn't sum to the book.** `splitBook` used each sleeve's RAW reconstructed cash (capital − cost basis + realized), which sits above the broker's real cash by the reconciliation residual. The two sleeve cards read $475,535 + $470,742 = $946,277 against a $943,284 book, and the two Cash (idle) lines claimed $8,445 of idle cash in an account holding $5,810.
2. **Each table's Total Day was the bare sum of the name rows.** Position-level day P&L can never equal a sleeve's change on the day: it omits P&L realized on anything sold that session, any cash movement, and the gap between the broker's `lastday_price` and our own official closing snapshot (−$394 Insider, −$318 Momentum on the day in question). Two totals that each silently drop a different remainder cannot add to the headline.
3. **Independent rounding.** Even with the bases fixed, rounding the whole and both parts separately leaves the parts a dollar short of the whole. In a table of dollars that dollar reads as a broken page.

**Rule:** When a page shows a whole and its parts, the parts must add to the whole *as rendered*, not merely in the floats behind it.
- Derive every part from the one partition proven to sum to the whole (8.16), and derive each part's residual bucket — here, cash — as `part total − its itemized rows`, so the reconciliation lands somewhere visible instead of vanishing.
- A column whose items cannot sum to its total needs the remainder shown as its own row with a plain-English tooltip, never absorbed into the Total. "The names don't explain the whole move" is information the reader is entitled to.
- For a whole split N ways, round the whole and the first N−1 parts, then make the last part the remainder. Never round all N+1 independently.
- Self-UAT for any numeric surface means literally adding the rendered columns yourself before declaring it done. 8.16 was verified by checking that two numbers agreed in sign; it shipped with four more that didn't add up. Check every total on the page, not the one the user complained about.

**Applies to:** Lead Developer, Senior Quant — the Paper page and every table, tile row, or breakdown that shows components beside a total.

### 8.18 (2026-07-30) — A page must first answer "does this thing exist?"; an empty shell full of zeros is a lie, not a loading state

**What happened:** Joe opened `macrotilt.com/ticker/APPL` — a one-letter typo for AAPL — and got the complete ticker page: a `$0.00` headline with a green `▲ $0.00 (0.00%)`, an empty 5-year chart, twenty-three em-dashed stat tiles, an empty company overview and an empty news list. His read was "What is going on? Nothing for APPL?" — which is exactly the wrong conclusion to invite, because the truthful answer was never "we have no data for this company", it was "there is no such symbol." Nothing on the page ever asked whether the symbol existed. The header search box compounded it: pressing Enter with no matching suggestion navigates to the raw typed text, so any typo lands on a page that looks like a data outage.

**Root cause:** every hook on the page is written to degrade gracefully to `null`/`—` for a *covered* name with a thin feed, and the price line had a `?? 0` fallback that turned "no price anywhere" into a rendered `$0.00`. Graceful degradation for a real symbol and graceful degradation for a nonexistent one are different requirements, and only the first had been built. A dozen independent "no data" states, each individually correct, compose into a page that reads as broken.

**Rule:** Any page keyed on a user-supplied identifier resolves that identifier *first* and renders an explicit not-found state when it doesn't resolve — before any of the per-field empty states get a chance to imply an outage. Concretely: (a) treat "every source finished loading and none of them carries this key" as not-found, and never treat a *failed* read as evidence of absence (an errored lookup falls through to the normal page — offline is not "doesn't exist"); (b) the not-found state names what was asked for, says plainly what the coverage boundary is, and offers the closest real matches as one click, so a typo costs a click instead of a bug report; (c) `?? 0` on a displayed price is a substituted number (4.4) — a covered symbol with no stored close shows an em-dash, never `$0.00`, and the change line hides rather than printing a fake `+0.00%`; (d) suggestion ranking is part of the fix, not decoration: plain edit distance puts micro-caps above household names (PAPL above AAPL for APPL, and MSFT off the list entirely for MFST, because a swapped pair costs 2 edits), so score letter-scrambles and blend a bounded market-cap prominence term, then verify the obvious typos by hand.

**Applies to:** Lead Developer, UX Designer — the ticker page today, and any future route that takes a symbol, ID, or slug from the URL or a free-text box.

### 8.19 (2026-07-30, same report) — A hard `max-width` on body copy inside a full-bleed card wastes most of the row

**What happened:** in the same message Joe added "can we please not wrap the text on the company overview, it wastes so much space." The company description was capped at `74ch` inside a ~1,450px card, so Apple's four-sentence profile ran as a narrow 500px column with two-thirds of the row empty beside it, pushing everything below it down the page.

**Rule:** A measure cap is a typographic default, not a layout decision — when body copy sits inside a card that is already width-constrained by the page grid, let it use the card. Check any `max-width: Nch` against the actual rendered card width at 1,600px before keeping it; if the cap is doing nothing but stranding whitespace, drop it. This applies to descriptions, methodology prose, and tooltip bodies inside cards, not to the site's genuinely full-bleed editorial columns where the cap is the point.

**Applies to:** UX Designer — every card that renders a paragraph.

### 4.21 (2026-07-30) — A number the pipeline cannot source is a number the brief must not print; and an earnings result is only real after the release exists

**What happened:** Joe's 6:45am ET brief carried two false statements. (a) "Apple and Amazon both topped estimates and rose in after-hours trade following Wednesday's close (AAPL +0.6% to $340.15; AMZN +1.5% to $230.09)" — both companies report AFTER Thursday's close; on Wednesday night there was no release, no beat, and no after-hours print. The same email then contradicted itself four bullets later ("Mastercard and Shell also report earnings today ... alongside Apple/Amazon"). (b) "the 30-year has eased back from 5.21% (its highest since 2007)" — the 30-year was at 5.237% while Joe was reading it, i.e. printing a NEW high, the exact opposite of the claim. Joe's words: "an email that comes out at 645am ET when the 30y is 5.237% and when Apple clearly down in pre market is not acceptable."

**Root cause:** the emailing generator was told "Fast movers ... also get today's LIVE value via web search and lead with it." Web search cannot return a live quote — it returns yesterday's article. Asked to lead with a live level it did not have, the model supplied prices and a direction that read plausibly and were invented. Two structural gaps made it inevitable: the indicator feed carries `ust_2y` and `ust_10y` but **no 30-year**, so the headline long-bond figure of the week had no source of truth at all; and nothing in the pipeline holds an earnings calendar, so "reported" versus "reports tonight" was left to recall. Compounding it, the email came from a *different* generator than the site — a scheduled task whose prompt lived outside version control, could not be reviewed in a PR, and could not even be edited by an agent — while the site's own brief for the same morning correctly labelled 5.21% as a prior close.

**Rule:** (a) **Sourced-or-omitted.** Every figure in a generated brief comes from the injected data block or from a page fetched in that run with a visible publication timestamp. No number from recall, inference, or an undated snippet. An omitted figure is correct; a wrong one is a failure. (b) **No direction word without two sourced points.** "Eased back", "stabilized", "off its highs", "little changed" are claims about a path; they require two timestamped levels where the later one supports the claim. State the level and its timestamp otherwise. (c) **Never call a level a high** unless a fetched source says so and no later sourced level exceeds it — and if one does, the story is the new high. (d) **An earnings result requires a published release.** Confirm the scheduled date first; if the report is today or later, the only permitted phrasing is "reports after today's close". (e) **No single-stock extended-hours prices** while no feed supplies them. (f) **One generator, in version control.** A surface that goes to readers under the MacroTilt name is never produced by a prompt that cannot be reviewed in a PR; the site brief and the email brief are the same artifact from the same hardened prompt. (g) When a story is about an instrument the feed does not carry, that gap is a data ticket, not a thing to write around — `ust_30y` is now on the backlog for exactly this reason.

**Applies to:** Lead Developer, Senior Quant — the daily brief, and every generated surface that quotes a price, a level, or a corporate event.

### 8.20 (2026-07-30) — A monitor must be able to tell "nothing to do" from "nothing happened"; if it can't, it is not a monitor, it is a false alarm on a timer

The paper-portfolio watchdog filed a P1 "Paper rebalance did not complete
today" whenever it saw zero orders for the session. But the two-sleeve engine
correctly produces zero orders on any day the target book already matches the
holdings — most days. The alert text itself admitted the ambiguity ("the
producer did not run OR found no signals") and then filed a P1 anyway. Result:
the same bug reappeared on 6/15, 6/22, 7/23 and 7/29, was "closed" each time
(there was nothing on the trading side to fix), and came straight back — while
a real silent failure would have been indistinguishable from the noise.

Rules:
1. Before a monitor can call an absence a failure, it must hold evidence that
   the work was EXPECTED. Here that evidence already existed and was ignored:
   `paper_signal_capture.triggered_orders_count` records, every morning, how
   many orders the engine intends to place. Expected==actual on every day of
   7/16-7/30, including the zero days. Alert on expected != actual, never on
   actual == 0.
2. A monitor needs a separate liveness signal from its outcome signal. "Engine
   ran" (heartbeat rows written) and "engine traded" are different facts;
   collapsing them into one count is what created the ambiguity.
3. If an alert's own message contains "or" between two opposite diagnoses, the
   check is not finished — do not ship it.
4. Session-scoped work is windowed on the ET session date, not a rolling
   "last 12 hours" from whenever the job happened to fire.
5. A bug that returns after being closed is a defect in the DETECTOR until
   proven otherwise. Re-closing it is the wrong move.

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

### 4.22 (2026-08-01) — A producer fired by other pipelines has no clock of its own; the day a file-writer becomes a sender, every trigger path becomes a send path

**What happened:** the morning brief emailed Joe at **2:00am ET on a Saturday**, recapping Thursday's close. The day before it had emailed him **twice**, at 2:18:29am and 2:20:15am ET. Joe: "I got a brief email at 2am Saturday morning about Thursday close information. Cmon man."

**Root cause:** DAILY-BRIEF-WRITER fires on its own 06:15 ET cron **and** on `workflow_run` completion of three other pipelines — added because GitHub's scheduler kept dropping this workflow's cron. One of those three, MONITOR-RECONCILE, runs `0 */6 * * *`, i.e. 06:00 UTC = **2:00am ET**, every day including weekends. For as long as the writer only wrote `public/daily_brief.json`, a 2am Saturday run was invisible: it rewrote a file. On 2026-07-30 that same script was made the emailer (`BRIEF_SEND_EMAIL=true`) to fix a separate accuracy incident — and every one of those trigger paths silently became a *send* path. Nothing in the script knew what day it was or what time it was. The duplicate pair had a second cause: the only guard against re-generating was "is the committed brief already dated today?", which two concurrent runs both answer "no" before either has pushed — harmless when the result was a duplicate commit, two emails once the result was an email.

**Rule:** (a) **Promoting a job to a sender is a re-scoping of every trigger that fires it.** Before adding a side effect that reaches a human, enumerate every path that can fire the job — cron, `workflow_run`, dispatch, self-heal — and ask what that side effect does on the worst one. A trigger list is part of the blast radius. (b) **A time-of-day artifact must assert its own calendar and clock.** A pre-market brief may only be built on an NYSE trading day and inside the morning window; it does not inherit correctness from the schedule that was *supposed* to fire it. Gate it in the code, not the cron, because the cron is not the only caller. (c) **A "force" flag used by a safety net must not bypass the calendar** — the self-heal sets `BRIEF_FORCE_REBUILD` on every run, so the calendar escape hatch is a separate flag (`BRIEF_IGNORE_CALENDAR`) reserved for manual dispatch. (d) **Idempotency by reading shared state is not a mutex.** "Has someone already done this?" answered by reading a file two runners are racing to write is a check-then-act bug; when the act is irreversible (an email, an order, a payment) the claim must be atomic — here a `brief_email_log` table whose primary key is the date. (e) A deliberate skip must be **distinguishable from a failure** to every downstream step, or the weekend no-op becomes a red build and its own alert email. (f) A day-of-week label is a calendar fact — compute it; the 8/1 brief called Friday July 31 "Thu Jul 31".

**Applies to:** Lead Developer — the daily brief, and every scheduled job that emails, posts, trades, or otherwise reaches the outside world.

### 4.23 (2026-08-06) — A runner shortage has two shapes; the alert suppressor only knew one, so a GitHub outage emailed Joe "Workflow FAILED"

**What happened:** Joe got `[MacroTilt] Workflow FAILED: PAPER-PORTFOLIO-EOD-DAILY` (run 31116873789, 15:39Z). Nothing in MacroTilt was broken. GitHub was having a platform-wide Actions/Pages outage that afternoon, and dozens of our runs across eight different workflows died without ever executing a line of our code.

The 2026-05-06 suppressor was written for the shape we had seen: no runner is ever assigned, GitHub cancels the job, `conclusion=cancelled` — suppress. That afternoon produced a second shape: a runner IS assigned, `Set up job` hangs waiting for the image, and after ~3-5 minutes GitHub marks **that step** failed and ends the job with `conclusion=failure`. At the job level this is byte-identical to a genuine code failure, so `any(job.conclusion=='failure')` waved it straight through. Two of the day's runs took that path and both emailed. The runs that failed *inside the pre-open trading window* all succeeded — the three failures were 11:10, 11:39 and 11:59 ET, outside the 03:00-09:25 ET accept window, so there was never any trading impact. The alert did not say that, and could not: it reports the workflow name and a link, nothing about what actually broke.

**Rule:**

1. **A job-level conclusion is not a diagnosis.** `conclusion=failure` answers "did this job end badly," not "did our code fail." The discriminating fact is *which step* failed: if the only failed steps are GitHub's own scaffolding (`Set up job`, `Set up runner`, `Complete job`), the runner never came up and nothing of ours ran. A genuine failure always fails a step a MacroTilt author wrote. Classification lives in `.github/scripts/classify_run_failure.py` with real captured payloads as fixtures in `tests/test_classify_run_failure.py` — extend it there, not with another inline `python3 -c` one-liner in YAML.
2. **A suppression rule written against one observed failure shape will meet another.** When suppressing infra noise, enumerate the shapes the platform can actually produce (cancelled / setup-failed / timed-out / mixed) and classify on the invariant — "did an author-written step run and fail" — rather than on the symptom that happened to be in front of you. Anything the classifier cannot place returns `ambiguous` and still alerts: over-alerting is recoverable, a silenced real failure is not (0.1, 4.14).
3. **An alert whose payload cannot distinguish its own false positives will be ignored.** Joe learned in May to distrust these emails because they cried wolf; that is exactly how a real red goes unread for days (the bug this alert was built for). Any future change to this alert must state, in the email, *which step* failed — not just the workflow name and a link.
4. **An out-of-window no-op that dies on infra is not an incident.** Before escalating any alert on the paper-portfolio chain, check the ET clock against the phase's accept window. A failure at 11:39 ET on a workflow that only acts between 03:00 and 09:25 ET has zero blast radius, and saying so is most of the answer.

**Applies to:** Lead Developer — `WORKFLOW_FAILURE_ALERT.yml` and every watchdog that grades a third party's status field as if it were our own.

### 4.24 (2026-08-06) — A metered vendor account is a data feed; its balance is the freshness. And a watchlist alarm covers exactly what someone remembered to list

**What happened:** the Anthropic API account ran out of credits. Every AI-generated surface died on the same day-window with the same invisible error: `generate-commentary` stopped writing the macro/sector tiles after 7/28, and DAILY-BRIEF-WRITER failed every trading morning from 8/3 — 90+ failed runs across three days — so the homepage carried the Jul 31 brief through Aug 6. Nobody was told, three ways at once: (a) urllib printed `HTTP Error 400: Bad Request` and swallowed the response body, which said in plain English "Your credit balance is too low"; (b) DAILY-BRIEF-WRITER, BRIEF-FRESHNESS-SELFHEAL, CFTC-COT-WEEKLY and PIPELINE-FRESHNESS-WATCHDOG were never on WORKFLOW_FAILURE_ALERT's watchlist, so 90+ reds emailed nothing; (c) every redundancy layer (cron sibling, three workflow_run piggybacks, the Vercel brief-ensure backstop, the self-heal) re-fired the same broken API call — redundant *triggers* are not redundant *capability*. Separately, CFTC-COT-WEEKLY hung on 8/1, hit its 15-minute job timeout, and a weekly job has no retry — one cancelled run bought 12 days of red on two positioning chips.

**Rule:**

1. **Every metered external account gets a balance probe.** A daily one-token ping (the ANTHROPIC-API-DIAG shape) that alerts on the *body* of the refusal, before the first production call of the morning needs it. Credits, API quotas, SMTP send limits — all of them.
2. **Print the refusal.** An HTTP error without its response body is a diagnosis withheld; this outage was one `e.read()` away from naming itself on day one.
3. **Alert coverage is an inventory, not a habit.** Any workflow whose failure can stale a user-visible surface goes on the watchlist the day it ships. The gap list found today is the price of doing this by memory.
4. **N triggers into one broken call is one failure, N times.** When adding a redundant path, ask what failure mode it is redundant *against*; if all paths share a dependency, the dependency needs its own monitor (rule 1).
5. **A weekly job that fails waits a week to disagree with you.** Weekly fetchers get a next-morning retry on failure/cancellation, or their miss cost is a full cadence.

**Applies to:** Lead Developer, Senior Quant — every generator that calls a paid API, every weekly fetcher, and WORKFLOW_FAILURE_ALERT's watchlist.

### 4.25 (2026-08-11) — When generation moves out of a pipeline, the pipeline's old generator becomes a daily false alarm; "the input hasn't arrived yet" is a schedule, not a failure

**What happened:** Joe: *"Why am I getting these emails every day now?! I get two emails saying the daily brief writer failed and then I get the daily brief email."* On 2026-08-06 brief generation moved off the metered Anthropic API and into the weekday morning scheduled Cowork session, which commits the brief to `main` around 06:10 ET. DAILY-BRIEF-WRITER kept its old job description: if the committed brief is not today's, call the API. The workflow fires 2–3 times every morning off its `workflow_run` piggybacks (05:31, 06:04, …) — every one of those runs happens BEFORE the session's commit lands, falls through to the dead API call, exits 1, and mails a `Workflow FAILED` alert. Then the real brief email arrives at 06:25 and proves nothing was wrong. Two red emails a day, every trading day, for a pipeline that was working.

**Rule:**

1. **When you move a capability out of a pipeline, remove the capability — do not leave it armed.** A code path kept "just in case" against a dependency that is deliberately switched off is not a fallback, it is a scheduled failure. Gate it behind an explicit opt-in env flag (`BRIEF_ALLOW_METERED_API`) that defaults to off.
2. **A consumer that runs before its producer is early, not broken.** Give it a deadline (`BRIEF_EXPECTED_BY_HOUR_ET`), exit green before it, red after it. "Not here yet" and "never came" are different events and must produce different colours.
3. **An alert that fires on a healthy day trains Joe to ignore the channel.** Any alarm that has fired on a day nothing was wrong is a bug in the alarm — fix the alarm the same day, do not filter the mail.

**Applies to:** Lead Developer, Data Steward — every workflow that consumes an artifact another process produces on a schedule.

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

### 4.27 (2026-08-11) — Redeploying an edge function resets its platform auth gate; a function that does its own auth must be redeployed with `verify_jwt: false`, every time

**What happened:** to give the Conviction book a backup dispatch path, I added two workflows to `trigger-workflow`'s allowlist and redeployed it. The deploy succeeded and returned `"verify_jwt": true` — the tool's default. That function authenticates its callers itself, with a `TRIAGE_WEBHOOK_TOKEN` bearer check, because its callers are pg_cron jobs sending an opaque token rather than a JWT. With the platform gate on, the Supabase gateway rejected the very next call with `401 UNAUTHORIZED_INVALID_JWT_FORMAT` before a line of the function ran. For roughly two minutes, every pg_cron backup that routes through it was disarmed at once — paper intraday, indicator refresh, universe snapshots, MASSIVE-DAILY, LSE-ARCHIVE-IV, the EDGAR insider ingest, and the two Conviction jobs I was in the middle of adding. Caught because I tested the path instead of trusting the deploy: `net._http_response` showed 401, and the three calls immediately before mine (20:35, 20:45, 20:50 UTC) showed 200, which dated the regression to my own deploy. Redeployed with `verify_jwt: false`; both paths verified 200 again.

**Rule:**

1. **`verify_jwt` is not remembered — it is re-declared on every deploy.** Any function whose callers are pg_cron, a webhook, or anything else without a Supabase JWT must be redeployed with `verify_jwt: false` explicitly. The safe default is wrong for this class of function, and it fails at the gateway where the function's own logs never see it.
2. **Say so in the function's header.** `trigger-workflow` now carries a DEPLOY WITH verify_jwt=false note at the top, because the next person to touch it will hit the same default.
3. **After deploying anything a cron calls, call it the way the cron calls it.** A 200 from the deploy API says the bundle uploaded, nothing about whether the caller can still reach it. One `net.http_post` and one read of `net._http_response` is the whole test.
4. **When you find a break, look at the rows just before yours.** The three 200s at 20:35/20:45/20:50 turned "something is wrong" into "I broke this ninety seconds ago" without guesswork.

**Applies to:** Lead Developer — every `deploy_edge_function` call on `trigger-workflow`, `gh-push`, `submit-bug-report`, or any other function with its own auth.

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

### 4.31 (2026-08-13) — A note whose central claim has to be decoded has failed, however good its evidence is; and a chart drawn from typed-in numbers is a second source of truth

**What happened:** the first Trade Idea published under the new contract passed every rule it had — twelve sourced evidence rows, a concrete invalidation, a real counter-argument, five negative tests green. Joe read it and asked: *"Are we saying to buy treasuries and short stocks? Im confused what the trade is..."* The note led with `instrument`: **"Long the 10-year Treasury, funded by trimming US large-cap equity beta."** That sentence is correct and it is normal desk English. It is also unreadable to anyone outside a trading seat, and its most natural plain reading — *short the stock market* — is the opposite of what the note meant. The idea was an allocation shift inside a long-only book: sell some S&P exposure, buy 10-year Treasuries, nothing sold short, nothing borrowed.

The accuracy contract had no opinion about this, because every rule in it was about whether a claim was TRUE. None was about whether it was LEGIBLE. A surface can be fully sourced and still fail its reader.

**Rule:**

1. **State the position type as data, not prose.** `position_type` is a required enum — allocation shift / outright long / outright short / long/short spread / hedge / watch only — rendered as a badge, so "is anything being sold short?" is answered before the reader meets a single number. `outright short` and `long/short spread` cannot validate without naming what is shorted.
2. **A plain-English sentence is a required field, and it is enforced, not requested.** 40–260 characters, and the validator REJECTS it if it contains beta, duration, convexity, carry, basis point, bp, curve, spread, percentile, steepener, flattener, notional, overweight, underweight, risk premium, term premium or vol. "Write plainly" as an instruction in a prompt is a hope; a jargon list in the contract is a guarantee. The technical phrasing keeps its place in `instrument` and the thesis, where it belongs.
3. **The summary leads. Everything else follows it.** The plain sentence sits directly under the title on the tile and at the top of the note. A reader must never have to reach the fourth paragraph to learn what is being proposed.
4. **Charts are DECLARATIVE — a chart names a series, it never carries values.** `charts[]` entries name a key in `indicator_history.json` plus a window and a caption; the site draws it. The alternative — a chart built from numbers typed into the note — creates a second source of truth that can silently drift from the evidence block beside it. The validator resolves every named series against the real file and rejects one that is missing, too short, or plotted twice.
5. **One series per chart. Two measures are two charts.** The brand's gold against its muted ink measures ΔE 6.5 for normal vision in dark mode against a floor of 15 — two lines on one plot were not a style choice to weigh, they were a fail. Single-series emphasis (ink line, accent spent only on the current reading) also puts the legibility where the argument is. No dual axis, ever.
6. **A caption is part of the chart.** A plot without the sentence that says what crossing the line means is decoration. It ships with the figure, including on the compact tile variant.
7. **Render it and look at it.** The colour validator checks colour; it says nothing about layout. The CAPE chart ends at its own maximum, which put the endpoint label directly beneath the floating hover readout — a value covered by another value, invisible to every DOM assertion and obvious in the PNG. The readout moved into the chart header, where nothing can cover it. Picking a better corner would only have moved the collision to a different series.

**Applies to:** every generated reader-facing surface, and every chart on the site. The accuracy contract answers "is this true?"; these rules answer "can it be read?" — and a surface has to pass both.

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

### 4.37 (2026-08-17) — A track record has to be designed before the first call is scored, not after; and a page that needs another page's stylesheet will look wrong in a way no assertion catches

**What happened:** Joe: *"Can we somehow track our trade ideas and how they performed? I'd like to start collecting historical data on our calls."*

The hard part was not arithmetic. It was that a note says *"US bank equities — the KBW-style bank complex, held outright"*, which is a good sentence and a useless instruction to a scorer. So `scorecard` became a required contract field: legs, side, measure, horizon, and the invalidation level as a NUMBER — written at publication, when it can still be written honestly.

**Rule:**

1. **Design the scoring before the first result exists.** Every rule that makes a record trustworthy is one nobody wants to adopt after seeing an outcome: entry at the first close on or after publication (not the level quoted in the prose); the stop honoured, so a call that craters through it and later rallies is marked at the stop; the horizon closing the call, so a post-horizon spike is not counted; every note scored, including the ones that cannot be, listed with the reason. Each of these costs nothing today and is unarguable later. Adopted after a bad call, every one of them looks like special pleading.
2. **"Nothing happened yet" is not "something is broken."** The first run reported all three live notes as `unscoreable` — they had simply been published before the next close printed. Conflating the two made a healthy pipeline look broken on the day it shipped, and worse, it would have trained us to ignore the word. `pending_entry` and `unscoreable` are now different states with different reasons.
3. **Withhold the statistic until the sample can carry it — and note that this is what lets the page be public.** Below ten closed calls the marker refuses to compute a hit rate and prints why. At n=3 a single outcome moves the headline by more than thirty points, so the number would mislead more than it informs — and the note contract already bans claiming a record we do not have. The individual calls are all listed regardless; it is the aggregate that is withheld. The page was gated for exactly one commit on the theory that a three-call record should not be visible, and Joe then made it public the same day. He was right, and the reason is worth keeping: **the honesty belongs in the marker, not in the door.** If the rules are sound — stop honoured, losers listed, aggregate withheld until it means something — the page can be public from call one, and gating it would only have hidden work that was already trustworthy. If the rules were not sound, a login would not have fixed them.
4. **Test the logic that has not fired yet.** Every live note was awaiting entry, so running the scorer against real data proved nothing about the stop, the horizon or the excursions. `scripts/test_score_trade_ideas.py` covers all of it on synthetic history — 21 cases, including the one that matters most: price craters through the stop and then rallies to +30%, and the call is marked at −20%. A scorer first exercised months later, by the first call that goes wrong, is a scorer nobody should trust.
5. **A page that needs another page's stylesheet must say so in code, not in a comment.** `cream-system.css` declares the palette on `.home-v12`, not `:root`. The scorecard imported it but did not carry the class, so every token fell back and the "no hit rate" callout rendered with a blue accent that appears nowhere on the site — inherited from an unrelated page's scope. The build passed, no assertion failed, and only looking at the render caught it. Scope tokens in the page's own stylesheet, put the required class on the root element, and **assert the computed colour** in the render check rather than trusting that it looks fine.
6. **When a gate moves, the copy describing the gate moves in the same commit.** The sign-in screen still read *"Only the Portfolio & Insights tab requires sign-in"* — stale twice over. It now names what is actually gated, with a comment pointing at `RequireAuth` so the next change catches it.

7. **A record has to resurface the CALL, not just the outcome.** Joe, looking at the finished page: *"I can't see what your call was on 8/14 — 'The most one-sided trade in the market is not on any chart'? What was our call?"* The row had a title, a status and a mark, and every one of those is about the note without being the note. A title is a hook; a mark is an outcome; neither tells you what was claimed. The fix was not to write a scorecard-flavoured summary — a paraphrase authored for the grading page is a second version of the note that can drift from the published one, which is precisely how a record stops being a record. The Home tile's note reader moved to `components/TradeIdeaNote.jsx` and BOTH surfaces import it, so the call, the trade, the measured edge and the charts read identically whether you arrive from the tile or from the ledger. **Whenever you build a page that grades earlier work, the first thing on it must be that work, in its own words.**

**Applies to:** the scorecard, and any future surface that reports our own results back to us.

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

### 4.40 (2026-08-18) — A bare `git push` in a repo that commits hourly is a scheduled failure

**What happened:** `macrotilt-engine-daily` failed 2026-08-17 (run 32063212545) at `Commit snapshot + history if changed`, and emailed Joe. Compute, contract check and history check were all green — the only thing that broke was `git push`, because another workflow landed a commit between our checkout and our push. This repo commits several times an hour from data pipelines, so the race is not an edge case, it is the expected condition.

Four workflows still had an unguarded bare `git push`: `macrotilt-engine-daily`, `BRIEF-FRESHNESS-SELFHEAL`, `CONVICTION-OPEN-DAILY`, `REPO-TREE-DUMP`. Others already carried `git pull --rebase origin main` before pushing — the pattern existed and had simply never been applied everywhere.

**Rule:** every workflow that pushes retries: rebase onto whatever landed, push, and repeat up to 5 times before calling it a real failure. `pull --rebase` alone is better than nothing but still races between the rebase and the push — the loop is the fix. When a defensive pattern already exists in the repo, applying it to ONE new site is half a fix; grep for every other site in the same change.

**Applies to:** Lead Developer — every workflow step that writes to the repo.

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
