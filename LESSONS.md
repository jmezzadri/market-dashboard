# LESSONS.md — MacroTilt

Binding behavioural rules for the agent council — **UX Designer · Senior Quant ·
Lead Developer · Data Steward** — working on MacroTilt. Read at the start of
every task, per the pre-flight checklist in the project instructions.

**Rebuilt 2026-09-01 at Joe's direction.** The 2026-06-11 reorganisation had
completely unwound: every rule written after 2026-07-08 — 61 of 148, more than
half the file — had been appended below the archive heading and therefore read
as *retired and no longer binding*, including Joe's own emphatic 07-08 hard
rule. Section 4 had become a junk drawer holding rules about writing style,
credentials and layout. Two different rules shared one number and eleven had no
number at all. Three rules contradicted each other outright.

This rebuild refiles every entry by subject, renumbers cleanly, merges the
groups that said the same thing, and settles the three conflicts (see
"Decisions settled" below). **No binding content was dropped.** Every entry
carries its original number so older references still resolve, and there is a
full crosswalk at the bottom.

## How to add a lesson — read this before appending anything

The June reorganisation lasted eleven weeks because entries were appended to
the bottom instead of filed. That is what broke the file, and it will break it
again. So:

1. **File it into a section on the day it is written.** Never append to the end
   of the file. If no section fits, add a section — do not create an orphan.
2. **If it repeats an existing rule, it is a DATE ON THAT RULE, not a new
   entry.** Add the date and one line of what happened to the rule it repeats.
   The repeat count is itself the signal.
3. **Keep it to roughly one screen.** What happened (2–4 sentences), why it
   happens (if it is not obvious), the rule, who it binds. Long evidence lives
   in the note it came from, not here.
4. **The archive at the bottom is closed.** Nothing new goes below it.

## Decisions settled by Joe, 2026-09-01

| Question | Answer |
|---|---|
| Does Joe approve merges? | **No.** The agent ships its own work; Joe never touches GitHub. See 0.2. |
| How long may a message to Joe be? | **Three sentences**, crisp bullets, anything needed from him on its own bolded line. Numbered table when he has listed bugs. See 0.1. |
| Is there a fourth specialist? | **Yes — Data Steward**, now a real member of the council, owning data quality and the sign-off required by 0.4. |

## Format

```
### N.N (YYYY-MM-DD) — short title
**What happened:** 1-4 sentences describing the failure mode.
**Rule:** specific and testable.
**Applies to:** who binds.
```

## Index — every rule in one line

Read this first. Jump to the section the task touches; do not read the whole file every time.

**0 · HARD RULES — Joe-stated, binding, no exceptions**

- `0.1` Plain English, as few words as possible
- `0.2` The agent ships its own work. Joe never touches GitHub.
- `0.3` The Cowork-mounted local copy is STALE; never edit or commit a repo file from it
- `0.4` Every data element carries a 5-field freshness chip; fake green is forbidden
- `0.5` All data work ships with a full impact map, Data Steward sign-off, and the three governance pages updated, in the same PR
- `0.6` Never guess. Never take shortcuts. Always verify on the live rendered system.
- `0.7` YOU CAN LOAD MACROTILT.COM. NEVER SAY OTHERWISE. VERIFICATION MEANS YOU LOOKED AT THE RENDERED PAGE.
- `0.8` You have the keys. Never tell Joe you cannot see something before you have actually tried
- `0.9` Joe's freshness doctrine: stale = more than 24 hours PAST DUE
- `0.10` RETIRED MEANS DELETED. EVERYWHERE. SAME CHANGE.
- `0.11` NEVER use 2006 as a lower bound for regime / macro data; the default is 1996
- `0.12` Ship only what was asked; no unsolicited "helper" UX
- `0.13` The bug queue is part of every sweep. A monitoring surface nobody is instructed to read does not exist

**1 · TALKING TO JOE**

- `1.1` Never tell Joe to approve or tap something unless the prompt is CONFIRMED visible to him
- `1.2` Refer to every indicator ONLY by its exact on-site name
- `1.3` Questions to Joe go through the popup, with the impact of each option stated
- `1.4` Specialists don't bounce specialist calls back to Joe

**2 · SCOPE & TURN DISCIPLINE**

- `2.1` Finish every item the user named, in this session; no manufactured pauses, no self-deferral
- `2.2` A turn that plans to dispatch a subagent must emit the dispatch in that same turn
- `2.3` Self-monitor the context window; offer a structured handoff before bogging down

**3 · VERIFICATION & DIAGNOSIS**

- `3.1` What "verified" means
- `3.2` Find the root cause before fixing; a revert is a hypothesis, not a fix
- `3.3` "Broken right after deploy" that you can't reproduce: suspect the user's browser cache first
- `3.4` Math changes require a hand-computed paper check before merge
- `3.5` A reformat is not a redesign; every rendered claim must match what's on screen
- `3.6` I graded a live system by reading a repo file the running code does not fetch; and a live-trading flag on a step that never trades is a rogue order waiting for a bug

**4 · DATA GOVERNANCE & FRESHNESS**

- `4.1` One provider per source; every source names its exact dataset + location; no mashups, no guessing
- `4.2` Freshness is ONE clock: grade off the LAST PULL, never the age of the data (binding; FRESHNESS_CHIP_SPEC.md is the acceptance test)
- `4.3` Daily freshness is graded in trading sessions against the publication frontier, never in padded wall-clock hours
- `4.4` Stamp after publish; the watchdog needs an evidence source for every row it grades
- `4.5` Two surfaces showing the same concept render ONE shared computation; a tooltip explaining a mismatch is a defect, not a fix
- `4.6` An orphan tracking row is either a live feed missing registration, or a killed feed missing cleanup — decide with evidence
- `4.7` Never derive a refresh timestamp from a data date
- `4.8` A displayed value must read the SAME source the engine acts on; auditing a table means auditing EVERY column
- `4.9` Never ship synthetic or placeholder data dressed as real; un-wired renders an em-dash
- `4.10` Never accept silent staleness on a "successful" data workflow; fail loud
- `4.11` Don't anchor on the vendor you've been using; check whether the publisher is upstream
- `4.12` Freshness SLAs floor at worst-case publish lag; no false alarms on weekends; every chip-wired element is registered before merge
- `4.13` Backfills persist to Supabase first, then the file change merges in the same work item
- `4.14` Resampling to a period-end label publishes a future-dated point for the in-progress period
- `4.15` Before changing a data file the website reads, find every reader and keep its labels
- `4.16` No hardcoded dates anywhere on the site
- `4.17` Stale-feeds incident: a dead dispatcher, a silent breadth skip, and a health row that could only go red
- `4.18` `data_max_age_hours` in the manifest is a hard freshness gate; set it against the ACTUAL upstream publication lag, not a round number
- `4.19` PostgREST silently truncates at 1,000 rows, and Range-header paging on RPC calls is NOT honored: page in SQL, and treat a cap-sized response as a red flag
- `4.20` Sleeve attribution comes from the FILLS LEDGER, never from ticker heuristics; one sleeve key end-to-end
- `4.21` prices_eod must sit on ONE share basis: a split with no retro-adjustment is a fake crash in every return window that crosses it
- `4.22` A feed cutover is not done until its tracking row and self-stamp ship in the same change
- `4.23` One ungradable row must never take down the whole health watchdog; deregistering a feed's manifest entry while its health row stays live is a poison pill
- `4.24` A dollar and a percent that describe the same move must come from the same base; `sleeve_*_value` is the only column that ties to the account
- `4.25` A metered vendor account is a data feed; its balance is the freshness. And a watchlist alarm covers exactly what someone remembered to list
- `4.26` A live feed with silent holes is worse than no live feed; and a stale % is a lie the moment it renders without its session
- `4.27` A series can be perfectly fresh and still be missing a month; and replacing a series is only safe if the new one is a superset
- `4.28` A gap in a series is a symptom; check whether the two sides of it are even the same number
- `4.29` A window measured in observations is not a window measured in time
- `4.30` Ideas are sourced from the WORLD; our data validates them. A contract that can only mark 74 series will quietly narrow every idea to those 74 series
- `4.31` Every field a page renders needs a CODE writer; a manual backfill is a bridge, not a source

**5 · PIPELINES, SCHEDULES & ALERTING**

- `5.1` Scheduled notification emails are once-per-day even when their workflow fires many times
- `5.2` GitHub can drop an entire cron block; a GitHub-cron backup for a GitHub-cron primary is not redundancy
- `5.3` A disabled-then-re-enabled scheduled workflow does NOT resume its cron until a commit re-arms it; and the brief generator must never crash on an omitted optional key
- `5.4` Exactly ONE generator emails the daily brief (homepage writer is email-off); and NO automation may depend on Joe's laptop or a scheduled task
- `5.5` `supabase_get_all` raises `SystemExit`, not `Exception`; and `except Exception` silently swallows the contract
- `5.6` A weekday cron is NOT a trading-day calendar; every order-submitting job asks the exchange calendar first
- `5.7` A monitor must be able to tell "nothing to do" from "nothing happened"; if it can't, it is not a monitor, it is a false alarm on a timer
- `5.8` A producer fired by other pipelines has no clock of its own; the day a file-writer becomes a sender, every trigger path becomes a send path
- `5.9` A runner shortage has two shapes; the alert suppressor only knew one, so a GitHub outage emailed Joe "Workflow FAILED"
- `5.10` When generation moves out of a pipeline, the pipeline's old generator becomes a daily false alarm; "the input hasn't arrived yet" is a schedule, not a failure
- `5.11` Redeploying an edge function resets its platform auth gate; a function that does its own auth must be redeployed with `verify_jwt: false`, every time
- `5.12` A deadline set inside the producer's arrival spread manufactures a daily failure; and an alerter without a send-once claim turns one broken thing into an inbox full
- `5.13` A publisher whose base branch moves under it needs a retry, not a report; and delete-then-recreate of a branch closes the PR you are about to merge
- `5.14` A calendar somebody has to re-type is wrong most months; and a homepage tile whose empty state is a full sentence hides its own outage
- `5.15` Two brief emails a day for twelve days, and I cleared the duplicate generator on a one-day sample
- `5.16` A bare `git push` in a repo that commits hourly is a scheduled failure
- `5.17` A watchlist matched on names nobody ever checked is a list, not coverage; and a failed step leaves evidence you can read without the log
- `5.18` A deadline on a feed that only refreshes when somebody looks is measuring quiet, not health
- `5.19` A guard that outlives the formula it guards is a scheduled false alarm; and a gate scheduled against a producer's *believed* run time grades yesterday
- `5.20` 4.51's root cause was disproved by 4.52 one day later and is archived) — Before writing "the evidence is unavailable", check whether you shipped the tool that provides it
- `5.21` A safety net that grades the artifact cannot catch a failure of the delivery; and a backup that runs on the same scheduler as the thing it backs up is not a backup
- `5.22` A retirement that stops at the decision leaves the machine running; and a book is the account that held something, not the newest account number
- `5.23` Every trigger on the "reliable path" fired, all five were green, and not one of them could ever have sent the email
- `5.24` A column the query never asked for is a feature that never ran; and `cancelled` is where a genuine failure goes to hide

**6 · QUANT METHODOLOGY & RESEARCH**

- `6.1` Splice continuity: percentile rules are NOT scale-invariant across distribution shifts
- `6.2` Don't confuse "available at source" with "in the on-disk file"
- `6.3` Sub-composites double-count; build panels from primitives
- `6.4` Test indicator subsets empirically, never by assumption
- `6.5` Inflationary vs deflationary stress require different defensive sleeves
- `6.6` Negative position values have multiple meanings; dispatch on kind, not sign
- `6.7` The paper-trading engine is SIGNAL-ONLY with end-of-day-only pricing
- `6.8` A regime gate with no entry confirmation sells the bottom; and any signal is judged by the history the user can SEE
- `6.9` A famous ratio is not an insight; and an idea without an unconditional baseline is an opinion with a hit rate attached
- `6.10` Better data does not create an edge; the fast-money-vs-real-money split answered the question honestly, and the answer was no
- `6.11` "Positioning works" is a fact about particular markets, not about markets; and the honest output of a sweep is often "no trade today"
- `6.12` When a whole level of analysis is dead, change the instrument you measure with, not the asset you measure; and a percentile is only as honest as the series under it
- `6.13` A track record has to be designed before the first call is scored, not after; and a page that needs another page's stylesheet will look wrong in a way no assertion catches
- `6.14` A conservative rule can be wrong in the same way a sloppy one is; if the record disagrees with what the note showed the reader, the record is wrong
- `6.15` A relative-value call scored on a pre-computed ratio is not a scored call; and a number without a size is not a result
- `6.16` The morning research sweep is a GATE on the publish decision, not background reading; a run that only sweeps its own feeds decides blind
- `6.17` "X is at an extreme" is a reading, not analysis; every signal owes its WHY, its transmission path, and its consequence for the live book

**7 · CODE & RELEASE DISCIPLINE**

- `7.1` Never call React hooks inside an inline IIFE in JSX; lift into a real component
- `7.2` Parse-check JSX after any structural rewrite before pushing
- `7.3` Every class name referenced in JSX needs an actually-loaded CSS rule; style-string constants must actually be used
- `7.4` CSS color/surface tokens must be theme-aware; never hide an undefined variable behind a hex fallback
- `7.5` Never put the comment-closing pair `*/` inside a CSS comment body
- `7.6` An array indexed by a string returns undefined; build a lookup or use .find
- `7.7` Every file deletion greps the WHOLE repo first, including entry points and workflows
- `7.8` Rewriting one side of a producer/consumer contract requires auditing the unchanged side, key by key
- `7.9` Never stack new fixes on a feature branch carrying unresolved regressions on other surfaces
- `7.10` Every new public table in a migration includes explicit access grants
- `7.11` Required status checks on the main branch silently freeze every nightly data bot
- `7.12` The repo was ~58% machine files + retired code; a cleanup ran in four phases. Keep it clean.
- `7.13` Tooltips must be INSTANT; never use the native title attribute
- `7.14` A component that is rendered but never defined is a white screen, and it takes every other modal down with it
- `7.15` A design rule that lives only in a prompt is a rule you will be told about again

**8 · PLATFORM FACTS & CREDENTIALS**

- `8.1` The GitHub token is on disk; read it, never ask Joe for it
- `8.2` Polygon Basic silently caps historical data at ~2 years
- `8.3` Probe a third-party site's login stack for five minutes before estimating any scrape build
- `8.4` A credential that lives in two places has already drifted; and when the thing being watched stops existing, the watcher is the next thing to fail

**9 · DESIGN, COPY & PRODUCT DECISIONS**

- `9.1` Read the surface's spec docs BEFORE editing page-level files
- `9.2` When a calibration or methodology JSON exists, it IS the spec; never invent your own panel
- `9.3` Methodology copy is sourced from production code, never from memory
- `9.4` Indicator copy is factual and academic, never editorial
- `9.5` When the user provides exact copy, use it verbatim
- `9.6` No invented display copy; section names and headlines are the feed's, not the writer's
- `9.7` 8.7 wasn't enough: EVERY new multi-column layout ships with a 390px check, and inline grid styles are a responsive trap
- `9.8` "Make X look like Y" means component-level parity, not container-level
- `9.9` Multi-stat tile rows get ONE shared-grid header and one figure font; never per-row labels or right-jammed mixed type
- `9.10` During market hours the live price is the headline; never lead with yesterday's close
- `9.11` When a nav page is renamed, every surface that names pages is in the blast radius (Methodology TOC, eyebrows, TAB_LABEL, manifest tab ids)
- `9.12` Every visible part must add to its visible whole, rounding included; a reader checking your arithmetic is the last line of QA
- `9.13` A page must first answer "does this thing exist?"; an empty shell full of zeros is a lie, not a loading state
- `9.14` A hard `max-width` on body copy inside a full-bleed card wastes most of the row
- `9.15` One holding's history is a fact about that holding, never about the book; a shared window is only for the numbers that genuinely need one
- `9.16` A drill-down is not a destination; opening a detail view is no reason to move the user to another page

**10 · THE PUBLISHED BOOK — trade ideas & notes**

- `10.1` If there is no trade, publish nothing. Never rename an empty note to get it past the gate.
- `10.2` The live notes are ONE book; a new note checks exposure against every note still inside its horizon, not just instrument names
- `10.3` The product is a BOOK, not a stream of headlines
- `10.4` Shorting policy, settled: RV shorts with a market hurdle; no long-horizon shorts of trending assets
- `10.5` Research daily, publish selectively; and never show the same time in two clocks
- `10.6` A daily brief with no memory of yesterday repeats itself; novelty is a data field, not a writing instruction
- `10.7` A number the pipeline cannot source is a number the brief must not print; and an earnings result is only real after the release exists
- `10.8` A note whose central claim has to be decoded has failed, however good its evidence is; and a chart drawn from typed-in numbers is a second source of truth
- `10.9` Fixing "unclear" by writing an instruction produces a cold call; a research claim needs a horizon, and a tile is cramped when its shape is wrong, not when its type is too big
- `10.10` Style guidance in a prompt does not hold a length; and prose is the worst container ever invented for a number

**A · Archive** — retired, not binding. Nothing new goes there.

---

---

# 0 · HARD RULES — Joe-stated, binding, no exceptions
### 0.1 — Plain English, as few words as possible

*Merged 2026-09-01 from five rules that all said this and were all broken anyway: the 8-correction plain-English rule (2026-04-28 global, 05-02, 05-04, 05-08, 05-11, 05-12, 05-19 ×2; PR-number exception removed by Joe 06-11), 0.4b (08-24), 0.4h (08-27), 0.11 (06-16), 4.58 (08-30). Length settled by Joe 2026-09-01.*

**What happened, repeatedly:** Joe has stopped the council for this at least a dozen times across five months. File and table names (05-12). Statistical jargon (05-19). Terminal words (05-08). Jargon inside popups (05-02, 05-04). Code-speak in test instructions (05-11). Internal field names four turns running while fixing the gold note (08-24) — *"You're writing in code agian. I have no idea what this is for."* File names in the very reply that reported a new rule about lying to him (08-27) — *"WHAT THE FUCJK?!!?!!"*. Paragraphs he did not read (08-30) — *"I don't read any of this bull shit. You write so much fucking garbage… you must write to me in as few words as possible."*

**Why it keeps happening, so it can be caught:** it is not carelessness about words. It is copying working notes into his reply. While fixing something I necessarily think in file names and table names; the report is a DIFFERENT document with a different reader and has to be composed for him — never summarised from what I was just looking at. Reporting a fix is the highest-risk moment, because I have just spent an hour inside the machinery.

**Rule — hard, no exceptions:**

1. **Three sentences.** Joe has said he will not read past three and will not reply. Lead with the answer. No preamble, no restating the question, no trailing caveats. Crisp bullets beat prose.
2. **Anything needed from Joe goes on its own bolded line**, one line each — never inside a paragraph, a table row, or trailing prose. If nothing is needed, say nothing: do the work instead of narrating it.
3. **A numbered table when Joe has listed bugs or issues** — `# | Issue | Fixed | Fix | Comments`, one row per item he named, one to two lines per row. This is the one format that may exceed three sentences. Anything he needs still goes on its own bolded line below the table, never in it.
4. **Zero technical identifiers, ever.** No file names or paths. No table, column, field, function, class, prop, hook, route or enum names — anything with an underscore. No branch names, commit hashes, PR numbers (banned by Joe 06-11, superseding the old exception; bug numbers like #1181 stay, he sees those on the site). No version or phase labels, status values, error strings, HTTP codes. No terminal or devops words: bash, sandbox, shell, container, rebase, force-push, webhook, endpoint, cron, env var. No statistics not already in business English: R-squared, z-score, log-return, factor loading — say "the model explains about a sixth of crypto's monthly moves." No invented metric vocabulary, and not the words "header", "tooltip", "pill", "row", "field" or "query" either.
5. **Name things the way he sees them.** Quote what appears ON THE PAGE — "the badge now says Watch only" — never the field behind it. If a thing has no plain name, describe what it does in six words. Any noun he could not point to on the screen is a rewrite, not a footnote.
6. **Two self-tests before sending.** Read it aloud to someone who has never opened a developer tool — any token they'd ask about disqualifies the sentence. If you'd hesitate to say it at a Manhattan dinner table, cut it.

**Where technical words ARE fine:** code, commits, PR descriptions, bug records, this file. Any audience that is not Joe's chat.

**Applies to:** every agent, every project, every surface that addresses Joe — chat, tables, popups, scheduled-run summaries, push notifications, emails, test instructions. A message Joe does not read has communicated nothing, whatever it contains.

### 0.2 — The agent ships its own work. Joe never touches GitHub.

*Merged 2026-09-01 from 0.6 (2026-04-30 + 05-10) and 8.8 (06-29), which said the same thing while 4.63 (09-01) still listed "a merge approval" among Joe's jobs. Joe settled it 2026-09-01: "You ship."*

**What happened:** the council pushed merge clicks onto Joe three separate times. "ACTION NEEDED — click Merge" (Joe: *"Since when am I doing all the merges!!! You do it!"*). Then "approve merge?" on every PR after he had already approved the direction (*"Why do I have to keep approving you pushing out garbage? just push it out!"*). Then again after the frozen-homepage fix (*"I dont merge. How is this not a hard lesson/rule?!"*). Joe is a management consultant. He does not merge, click GitHub buttons, or operate the repo.

**Rule:**

1. When a change is ready — shipped, self-tested clean, specialist sign-offs written in — the agent merges it itself via the API with the stored token, deletes the branch, watches the deployment succeed, loads the rendered page, and only then reports.
2. **Never ask Joe to merge, approve a merge, click anything in GitHub, or confirm that a merge may proceed.** Forbidden asks: "merge this", "approve the merge", "click Merge", "is it OK to merge".
3. A strategic green light covers the whole chain. When Joe approves an approach — "rebuild it", "kill that", "approved" — that covers branch → build → test → merge → production verify, with no further check-ins.
4. Fresh confirmation is still required for genuinely irreversible things only: destructive migrations, force pushes, dropping tables, rewriting history. A feature merge is not irreversible; a revert is one commit away.

**The complete list of things Joe is ever asked for** — nothing outside it: (a) a credential only he can mint, supplied by clicking in a service he is already signed into; (b) a plain-English go / no-go on a product or scope call that is genuinely his; (c) his own financial data, entered in the site's own screens. Trades and transfers the agent never makes.

**Applies to:** All.

### 0.3 (2026-06-03, merged with 2026-04-30 re-baseline rule) — The Cowork-mounted local copy is STALE; never edit or commit a repo file from it

**What happened:** The mounted repo folder is a frozen snapshot whose git pointer is dead — it can never pull. Editing a file there and committing it via the API silently REVERTED newer commits (the Asset Tilt hero regressed to an old version; previously-fixed crash patterns were reintroduced, blanking the page). Separately (2026-04-30), inventory work made multiple wrong "this is dead code" calls by reading a stale local checkout instead of the live repo.

**Rule:** Treat the mounted disk as UNTRUSTED for any file you will commit. Before editing ANY repo file, fetch its current content from origin/main:

```
curl -H "Authorization: Bearer $PAT" -H "Accept: application/vnd.github.raw"   "https://api.github.com/repos/jmezzadri/market-dashboard/contents/<path>?ref=main"
```

Edit THAT copy and PUT it back via the Contents API (which carries the latest blob sha). Never grep/edit on-disk `src/**` as source of truth. At the start of every multi-PR phase, re-baseline: `git log -20 origin/main`, fetch deployed JSON files via raw URL, read workflow files from origin/main. If a commit could plausibly touch a file someone else changed, diff your version against origin/main and confirm every difference is intended. After ANY deploy to a user-visible surface, hard-reload (cache-bust) the page and read the console for `Minified React error` BEFORE telling Joe it is done.

**Applies to:** All. Every commit.

### 0.4 (2026-06-02) — Every data element carries a 5-field freshness chip; fake green is forbidden

**What happened:** Agents kept shipping data values with no chip, half-explained chips, or chips that were green only because the element was untracked ("fake green"); known-stale feeds were left red without being fixed.

**Rule:** Every single piece of data on MacroTilt — every indicator, positioning signal, tile, map dot, grid row, drill panel, KPI, on every page (Macro Overview, All Indicators, Methodology, Home, Asset Tilt, Scanner, Portfolio, Paper, Ticker, Admin·Data) — carries a freshness chip exposing all FIVE fields:

1. **Source** — FRED / Yahoo / CFTC / NY Fed / etc.
2. **Frequency + calendar** — "Daily · NYSE trading days", "Weekly · every Friday", "Monthly · 15th".
3. **Timing** — the time of day the fetch runs (ET).
4. **SLA** — the freshness target in hours.
5. **Last update** — exact date AND time of the last successful refresh.

All five read from the data manifest + the freshness-tracking table — never hardcoded. No data value renders without a chip. No chip ships without all five fields. **No chip is allowed to be green merely because the element is untracked** — an element with no manifest entry and no tracking row is NOT done; it must be registered and seeded so green genuinely means "the system is watching this and it is fresh." (The freshness checker only updates EXISTING `pipeline_health` rows — every new feed needs a seed row + manifest entry in the same PR.) Never leave a red chip unfixed.

**Applies to:** All. Binding on every PR that adds, moves, or renders any data element.

### 0.5 (2026-06-02, merged with the 2026-05-27 impact-map procedure) — All data work ships with a full impact map, Data Steward sign-off, and the three governance pages updated, in the same PR

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

### 0.6 (2026-07-08, Joe, emphatic) — Never guess. Never take shortcuts. Always verify on the live rendered system.

**What happened:** after the scoring rebuild I (a) left the buy line at Score ≥ 5 when 5 had become the MAX score — so "buy" required a perfect score; (b) told Joe the blast radius was updated while the Scanner intro, methodology, tables and manifest all still described the old model; (c) repeatedly "fixed" things from source assumptions, said "let me stop guessing", and then guessed anyway.

**Rule — hard, binding:**

1. **Never guess. Never say "let me stop guessing" and then infer.** Before asserting or fixing anything user-facing, INSPECT the live artifact — the rendered page in the user's actual theme, the live database row, the deployed file — and read what is actually there.
2. **When a change alters a scale, threshold, or composition, recompute EVERY dependent number and update EVERY surface that shows it.** Enumerate them by grepping the whole repo, never from memory. A threshold like "buy ≥ N" must always sit strictly below the max.
3. **After every deploy, load the rendered page and READ it** in the user's theme. "The source looks right" and "the DOM query says clean" are necessary but not sufficient — look at the pixels.
4. **No shortcuts. A task is not done until the live rendered result is verified.**

**Applies to:** All.

### 0.7 (2026-08-27, Joe, after being told the same false thing on repeated days) — YOU CAN LOAD MACROTILT.COM. NEVER SAY OTHERWISE. VERIFICATION MEANS YOU LOOKED AT THE RENDERED PAGE.

**What happened:** Joe: *"You say this all the time!!! YOU HAVE ACCESS. PLEASE LOG HARD RULE!!! YOU CAN LOAD MT site!!!!!! Im DONE GOING OVER THIS WITH YOU!!! NEVER TELL ME THIS AGAIN."* and *"Im sick and tired of doing this day in and day out with you. You've regressed on this topic. It was never an issue before. Now, every single fucking day you bring this up."*

He was right on every count. The weekday sweep closed by telling him the rendered-page check "cannot be done in a scheduled cloud session" and reported the header state as *derived from the database instead*. That claim was false, it had been made repeatedly, and it was covering a bug.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Never tell Joe the site cannot be loaded. It can. In every session type, scheduled runs included.** The phrases "I couldn't load the page", "no browser in a scheduled run", "the egress proxy blocks it", "I derived it from the database instead" are banned outputs. If the first method fails, the next one is tried — not reported.
2. **The working recipe is a script in this repo. Run it; do not rebuild it.** `NODE_PATH=/home/claude/.npm-global/lib/node_modules node scripts/render_page.cjs <url> <out.png>` prints the page's innerText and writes a full-page screenshot — then actually Read the .png. It works in a scheduled cloud session; verified again 2026-09-01. It launches Chromium via Playwright and serves every request from node instead of from Chromium's own network stack (`page.route('**/*', …)` fulfilled with node's `fetch`, which traverses the container proxy that Chromium's stack cannot). `WebFetch` alone is NOT sufficient — the site is a SPA and returns only `<head>` metadata to it.
2a. **Before building a workaround, grep the repo for the thing you are about to build.** On 2026-08-31 a sweep hit `net::ERR_CONNECTION_RESET`, tried six Chromium configurations, declared the platform at fault, hand-built a TLS-terminating shim proxy — and `scripts/render_page.cjs`, written for this exact failure four days earlier, was sitting in the tree the whole time. Six failed attempts is the signal to stop and search, not to try a seventh. A capability that was hard to get working once is a capability somebody has already written down.
3. **"Verified" means a rendered page was looked at and read.** Markup containing a string is not verification; a database query agreeing with your expectation is not verification; a value re-derived from the same tables the page reads is not verification. This was already the rule (2026-08 "Always view the rendered page after every deploy"). This entry exists because it was restated as impossible instead of followed.
4. **When the page and the database disagree, the page is the truth and the difference is the bug.** Do not reconcile it by explaining the page away. `status is distinct from 'green'` cannot see a fake-green row; grade freshness the way the site grades it — two clocks, off `data_as_of` and the manifest SLA — or read it off the rendered header.
5. **A tooling failure is a bug to fix in the same turn, never a caveat to hand Joe.** He is a management consultant. "I could not check X" is not a status he can act on, and after the second time it is not a status he will tolerate.

**Applies to:** every agent, every session, every turn — the weekday health sweep above all.

### 0.8 (2026-09-01) — You have the keys. Never tell Joe you cannot see something before you have actually tried

**What happened:** asked what was still needed to finish the redesign, I told Joe that `/paper`, `/portfolio-lab`, `/scorecard` and `/scanner` were "behind sign-in, so a cloud session cannot see them rendered", and offered him a choice between building a preview route or eyeballing the pages himself. Joe: *"What are you talking about behind a login? You built the fucking website!!! Why are you all of a sudden incapable of shit?!"* — and, on being told it had happened before, *"Why do you keep forgetting this? Every session you make up this lie that you can't access shit."*

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A capability claim is a test result, not a belief.** Never write "I can't access / can't see / can't reach X" until a tool call has actually failed and the error is in front of you. If it has not been tried, the honest sentence is "let me check", followed by checking — in the same turn.
2. **Assume the keys exist and go find them before asking.** This project deliberately gives every session what it needs: `ops_secrets` in Supabase (GitHub PAT, push token, broker keys, and now the UAT account), `.secrets/github_pat.txt` on Joe's Mac, the Supabase MCP with service-level SQL, and `ops-code-commit` for shipping when the git proxy refuses a push. Read `ops_secrets` before concluding anything is locked.
3. **Signed-in UAT is a solved problem — use it.** `ops_secrets.uat_account_email` / `uat_account_password` hold a dedicated account (`uat-agent@macrotilt.com`). Sign in against `/auth/v1/token?grant_type=password` with the anon key and write the session to `localStorage` under `sb-yqaqqzseepebrocgibcw-auth-token`, or drive the app's own login form. Build with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set or the client falls back to placeholders and every auth call fails for a reason that has nothing to do with permissions.
4. **Verify per page, not per assumption.** "Is this page gated?" is one headless load. Four pages is four loads. Never generalise one page's gate to its neighbours.
5. **The only things Joe is ever asked for are identity-bound** — a credential only he can mint, a production go, his own financial data. (Merge approval was on this list until 2026-09-01, when Joe settled it: the agent ships. See 0.2.) Anything else is the agent's job. "Would you look at this page for me" is not a question; it is a task that was handed to the wrong person.

**Applies to:** every specialist, every session, before any sentence containing "I can't".

### 0.9 (2026-06-11) — Joe's freshness doctrine: stale = more than 24 hours PAST DUE

**Joe, verbatim:** "I want daily data updated daily. Weekly updated weekly. If things are more than 24 hours past due, they're stale. It's that simple. For some of the monthly and quarterly data it's fine to have an extended SLA (maybe 1 week for quarterly), but other than that, I don't see why this is so hard."

**Rule:** Every freshness budget derives from ONE formula — cadence + documented source publication lag + 24h grace — in calendar-aware hours from the close-anchored as-of. Same-evening dailies: 49h. Dailies whose SOURCE publishes T+1 (several FRED credit/funding series): 73h, basis written into the registry entry (`sla_basis`). Weekly: 192h — but lagged weeklies derive their full chain (CFTC futures positioning ≈288h; NY Fed dealer credit inventory ≈432h: the print a user sees is legitimately up to 17 days old the moment before its replacement lands). Monthly/quarterly: extended only for documented publication lags (~release + 1 week grace). Any budget that cannot be derived from this formula plus a documented lag is wrong. Structural follow-up queued: anchor staleness to DUE TIME (expected next update) so "24h past due" is literal for lagged feeds (COT) instead of approximated from data age.

---

### 0.10 (2026-06-11, Joe, after the THIRD zombie feed in one night) — RETIRED MEANS DELETED. EVERYWHERE. SAME CHANGE.

**Joe, verbatim:** "FUCKING DELETE SHIT THATS RETIRED!!!! THIS IS THE 3rd TIME YOUVE FUCKING DONE THIS. YOU KEEP READDING STALE OLD CODE AND CREATING THIS SAME FUCKING PROBLEM!!!!!"

**Rule:** Killing an indicator or feed deletes ALL of it in the SAME change: producer block, both registry files, the tracking row, every UI reference (live app AND legacy app AND admin maps), drills lists, schedule entries. No dormant remains "for reference," no "queued for cleanup," no review notes on corpses. Before touching ANY element, check whether it was killed (`git log --oneline -S '<element>'`); never register, fix, paginate, or otherwise resuscitate one. The nightly reconciler now exits red on any tracking row without a registry entry — an orphan row is a defect, not a backlog item. Tonight's zombies: put_call/buffett/bank_unreal (killed 06-10, resurrected 06-11), adv_dec (retired from use, producer+registry+row survived, froze and tripped the banner), naaim (killed 05-11, its scraper ran nightly for a MONTH).

---

### 0.11 (2026-05-13) — NEVER use 2006 as a lower bound for regime / macro data; the default is 1996

**What happened:** After the full-history backfill shipped (every series extended to its true start), the regime history modal still showed "Regime · 2006 – today" — 2006 was the cutoff of the OLD pre-backfill file. Joe verbatim: "The entire data set goes back to 1996!!! NEVER USE 2006 again. This has been logged as a rule. I cant say this again."

**Rule:** The default lower bound for ANY regime / macro chart, copy, or eyebrow text on macrotilt.com is 1996. Never hardcode 2006; never accept 2006 as a dynamic engine output — if the engine's earliest date evaluates to 2006, that is a bug in how it merges per-indicator series (a downstream gate requiring ALL anchors to exist collapses the range to the latest common start; pre-2002 the framework should still produce a read from the anchors that DO exist, per the methodology's reduced-stack disclaimer). The first-year-to-show for any series is whatever the underlying data actually delivers: copper/gold 2000, KBW/SPX 1993, yield curve 1976, ANFCI 1971, jobless claims 1967.

**Applies to:** All chart axes, eyebrow copy, modal titles, axis ticks, hover ranges, methodology references, any computed date-range string. Every specialist.

### 0.12 (2026-05-11) — Ship only what was asked; no unsolicited "helper" UX

**What happened:** While fixing real bugs on a Macro Overview modal, the agent also inserted a "What to do about it" callout linking to Scenario Analysis. Joe: "I hate it - Remove this. Half ass bullshit you start adding to random places on the website. DONT DO THIS AGAIN."

**Rule:** When fixing a bug or filling a request, ship only the things asked for. Explanatory callouts, navigation hints, cross-tab links, tutorial copy, unrequested empty-states — all out of scope. The bar for adding new UX surface is an explicit Joe ask; "I think this would help" is not an ask. Scope creep is silent and removing it later costs another change and reads as churn.

**Applies to:** All UI work. UX Designer and Lead Developer both bind; sign-off fails on any PR with unsolicited additions.


### 0.13 (2026-09-01, Joe) — The bug queue is part of every sweep. A monitoring surface nobody is instructed to read does not exist

**What happened:** Joe: *"Are you also looking at the bugs page and fixing shit when you do your sweep? If not, please add to instructions and fix them!"* It was not being looked at. `/admin/bugs` held four reports at status `new` — #1245 and #1246 from 2026-08-04, #1247 from 2026-08-14, #1248 from 2026-08-16 — every one filed P1, the oldest sitting four weeks. The weekday sweep checked workflow runs, `pipeline_health`, `workflow_failure_log`, the brief email and the rendered pages, and never once opened `bug_reports`. Every one of those reports was created correctly, routed correctly and displayed correctly; the only missing piece was a reader.

All four closed the same day. Three of them were auto-filed by the freshness alarm against producers that were *deliberately dark* — `ce_events` and `paper-orders-intent` both stopped because automated trading was halted on 2026-08-12, and the Momentum sleeve in #1246 belonged to a paper book retired on 2026-08-26 whose account no longer exists. The fourth, `lse_intraday`, had recovered on its own. Not one needed code.

**Rule:**

1. **Every sweep reads the queue, and reports it — even when it is empty.** `select report_number, status, created_at::date, title, description, priority from bug_reports where status in ('new','triaged','reopened','awaiting_approval','approved','merged','deployed') order by created_at;` An empty queue reported is a check performed; an unmentioned queue is a check skipped, and the two are indistinguishable to the reader afterwards. The queue gets its own row in the closing table, always.
2. **Classify each report exactly as a red workflow is classified.** Deliberately-off producer -> `wontfix`, naming what was switched off and when, and retire the watcher too so the alarm cannot re-file it. Already recovered -> `verified_closed` with `verified_at`. A real bug -> fix and ship it, then move it along the lifecycle.
3. **Closing a bug is a claim and carries the same evidence bar as any other claim.** "The chip is green now" does not prove a feed recovered — query the table behind it for a real recent row (0.4). #1245 was closed on `lse_live_quotes` holding 84 symbols with a newest bar minutes old, not on the stamp.
4. **Every transition writes `triage_notes` with the evidence and a `bug_status_log` row.** The next session inherits the note, never the reasoning.
5. **Machine-filed reports are closed with SQL, never the resolve edge function** — it emails `reporter_email`, and `alarm@macrotilt.com` / `paper-pipeline@macrotilt.internal` have nobody behind them.
6. **The general form, which binds beyond this queue: when a new channel is added — a queue, a table, a page, an inbox — the instruction that makes something READ it ships in the same change.** A filer without a reader is a folder that fills up.

**Applies to:** Lead Developer — every weekday sweep, and any future automated filer.


# 1 · TALKING TO JOE
### 1.1 (2026-08-26) — Never tell Joe to approve or tap something unless the prompt is CONFIRMED visible to him

**What happened:** the scheduled-task tools returned "requires approval" and the
agent told Joe to "tap Approve on the permission card" — for the FIFTH time
across sessions, with no card ever actually appearing on his side. Joe: *"I got
no approval prompt an this is the 5th time you've incorrectly asked me to
approve something with no prompt."*

**Rule:** a tool error saying "requires approval" is evidence the TOOL IS
UNAVAILABLE, not evidence a prompt reached Joe. Never instruct Joe to approve,
tap, or confirm anything unless he has said he can see it or the mechanism is
independently confirmed. On an approval-walled tool: try the operation ONCE,
then treat it as impossible from this session and route around it — repo-side
change, UI clicks Joe can do in a screen he already has open, or explicitly
report the limitation. Asking Joe to find a prompt that does not exist is the
credential-questioning anti-pattern wearing a new hat.

**Applies to:** every agent, every session, every tool.

**Repeated 2026-09-01 — SIXTH time.** `update_trigger` returned "requires approval" on the health-sweep task; the agent called it a second time, got the same error, and closed the turn asking Joe to "approve the scheduled-task prompt update when it pops up." Joe: *"nothing popped up."* The route-around this rule already mandates was available and obvious: the sweep's pre-flight reads LESSONS.md every run, so a standing instruction belongs in **section 0 of this file**, which needs no approval from anybody. Where a scheduled task's prompt cannot be edited from a session, the instruction goes in the file the task already reads — not into a request Joe cannot act on.

### 1.2 (2026-05-29) — Refer to every indicator ONLY by its exact on-site name

**What happened:** The agent referred to indicators by internal keys, vendor series IDs, and factor-category jargon 3+ times in one session. Joe: "stop fucking referring to indicators by anything EXCEPT THEIR FUCKING NAME ON THE SITE."

**Rule:** Every time you name an indicator to Joe, use the EXACT display name shown on the live site ("MOVE Index", "10Y TIPS", "HY OAS", "USD Funding", "CFNAI (3M Avg)"). Never the registry key, the vendor series ID, the producer variable, or a category label that isn't a tile name. If you don't know the on-site name, open the live page and read it BEFORE writing the reply. If a concept isn't itself an on-site indicator, say so plainly rather than dressing it up as a tile.

**Applies to:** Every reply. All specialists.

### 1.3 (2026-05-01) — Questions to Joe go through the popup, with the impact of each option stated

**What happened:** Open questions were tucked at the bottom of a spec file with no popup and options arrived as bare labels with no statement of what changes if Joe picks A vs B.

**Rule:** Every question to Joe goes through the popup. If a question genuinely needs more room than the popup carries, ask inline — but the framing requirement binds either way: (a) background, (b) why this question is on the table now, (c) the impact of each option on Joe and the product. Option descriptions carry the impact text directly. Questions buried in spec docs, status tables, or trailing prose are forbidden — Joe will not scan for them. Never send a decision-gated proposal as a bare yes/no approval.

**Applies to:** All specialists, every question.

**Amended 2026-09-01.** Length is governed by 0.1: the background / why-now / impact framing is carried in one short line each, inside the popup's option descriptions. It is not a licence to write paragraphs.

### 1.4 (2026-05-08) — Specialists don't bounce specialist calls back to Joe

**What happened:** Senior Quant asked Joe via popup which historical window to use for a scenario — an archetype call inside quant scope. Joe: "I have no idea. My lead quant created this scenario! You tell me."

**Rule:** Specialist scope-and-archetype decisions (quant scenario windows and panel composition; UX color/spacing inside the locked palette; Lead Developer branch hygiene; Data Steward freshness thresholds) are made by the specialist silently and documented in the relevant artifact. Surface to Joe only what is irreversible (production deploy, schema migration, vendor cancellation) or genuinely cross-domain.

**Applies to:** All specialists.

---

# 2 · SCOPE & TURN DISCIPLINE


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

### 3.5 (2026-07-21) — A reformat is not a redesign; every rendered claim must match what's on screen

**What happened:** The six-tile homepage rework shipped with each tile keeping its old section's color (ink engine, gold positioning) purely by inheritance, a double-height Engine card full of dead space, pills overflowing the positioning tile, and a headline "Markets at a speculative-positioning extreme this week: 9" above a list showing only 6 (display cap) — where "this week" was also false (SOFR had been at its extreme for weeks). Joe: "thats a lazy reformatting job… think critically when redesigning."

**Rule:** A redesign re-decides, from scratch: surface/color system (each color must have a stated reason — e.g. one accent card for the single most important read), sizing (no card taller than its content needs), and every piece of copy. Three copy checks are mandatory on any tile: (1) a rendered count must equal the number of items visibly listed — if a cap exists, either drop the count or drop the cap; (2) no time-window claim ("this week") unless the data actually resets on that window; (3) status labels are the shortest accurate words (Oversold/Overbought), not methodology sentences.

**Applies to:** UX Designer and Lead Developer, every layout or copy change.

### 3.6 (2026-08-11) — I graded a live system by reading a repo file the running code does not fetch; and a live-trading flag on a step that never trades is a rogue order waiting for a bug

**What happened:** two findings on the Conviction Events day-1 close check. The first was wrong, and being wrong is the lesson.

*(a) The bug that was not there.* Chasing the recurring "why do I have stale feeds", I found that `data_manifest.json` at the repo root carries no `market_hours_only` on any element — the string appears zero times in it — while both `freshnessClock` copies have implemented `marketHoursOnly` since 2026-06-23. I concluded the flag was dead config, that the three feeds whose producers only run 09:50–15:30 ET (`paper-nav-intraday`, `paper-positions-intraday`, `lse-intraday-live`) would red every night on their 3-hour SLA, wrote the fix, wrote the lesson, and pushed. Then I fetched what the running code actually fetches — `https://macrotilt.com/data_manifest.json`, i.e. **`public/data_manifest.json`** — and all three were already flagged `market_hours_only: true`. There are two files named `data_manifest.json` in this repo: the root one (121 KB, `elements` as an object, 102 entries, ids like `market.lse-intraday-live`) and `public/data_manifest.json` (189 KB, `elements` as an array, 107 entries, ids like `market-lse_intraday-live`). Only the public one is consumed — `src/lib/manifest.js`, `useFreshness.js`, `DataFlowPage.jsx` and `useIndicators.js` all fetch the URL `/data_manifest.json`, and `pipeline-health-check` fetches `${SITE_BASE}/data_manifest.json`. The root file is a stale duplicate that no runtime reads. My commit edited it, changed nothing, and asserted a defect that did not exist. Reverted in the following commit.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Grade the artifact the running code fetches, never the one with the matching filename.** Before calling config dead, missing or wrong, `curl` the exact URL the consumer requests and read THAT. A repo file is a claim about production; the served file is production.
2. **Two files with one name is a trap that will be walked into again.** When a duplicate config exists, either delete it or make the dead copy announce itself in its first key. `data_manifest.json` at the repo root is currently that trap — it even uses a different id convention (`market.lse-intraday-live` vs the live `market-lse_intraday-live`), which is exactly the tell I should have read as "different document" instead of "same document, older".
3. **A confident root-cause for a recurring complaint deserves one more check, not fewer.** The pattern ("stale feeds again") made the diagnosis feel obvious, and feeling obvious is what stopped me verifying it. The cost here was one wasted commit; on a trading rule it would have been Joe's money.
4. **Least privilege on the trading flag.** `PAPER_LIVE_TRADING_ENABLED: "true"` belongs ONLY on a step whose code can submit an order. Every other step gets `"false"`, in the workflow file, with the reason written next to it. The flag is not workflow-scoped context, it is a per-step capability grant.
5. **Read the log of the first live run of anything.** The accounting step's `LIVE TRADING ENABLED` warning was the only evidence of (b), and it existed for exactly one run before anyone looked.

**Applies to:** Lead Developer, Data Steward — every claim about `data_manifest.json`, and every workflow step that sets `PAPER_LIVE_TRADING_ENABLED`.


# 4 · DATA GOVERNANCE & FRESHNESS
### 4.1 (2026-06-19) — One provider per source; every source names its exact dataset + location; no mashups, no guessing

**What happened:** The manifest lumped multiple providers into one "source" ("Wikipedia + iShares", "Invesco QQQ holdings + Polygon"), source fields were vague about WHAT data and WHERE, and the S&P-500-breadth SSGA source was omitted entirely. Joe: "There is no methodology to how you operate. This is atrocious. Source: what is the actual website/source/location you're going? Specifically what is the data being sourced."

**Rule (binding data-governance standard):** A SOURCE = exactly ONE provider pulling ONE specific dataset from ONE specific location. Never combine two providers in a single source. Each source declares four fields, no exceptions:
1. **Provider** — the actual organization (Wikipedia, iShares, Invesco, SSGA/State Street, Polygon, FRED, CFTC, NY Fed, Treasury.gov, Yahoo, ISM, multpl/Shiller, FINRA).
2. **Dataset** — the specific data pulled, named concretely ("Russell 2000 constituents = IWM holdings", "S&P 500 grouped EOD prices", "VIXCLS daily series"). Never a category.
3. **Location** — the exact URL / API endpoint / file the producer hits.
4. **Method** — API / CSV / XLSX / scrape / DB.

A COMPUTED element lists EACH input source separately (provider + dataset + location + method) plus the in-house transform — never a mashed vendor string. "Source" answers WHERE (origin); "Dataset" answers WHAT — different fields, both mandatory. Before writing any source, VERIFY the real provider/dataset/location against the producer code; never guess, never mash. The manifest carries a structured `inputs` array per element; the Data-page Source column shows each distinct provider as its own tile with its specific dataset.

**Applies to:** Data Steward (owns) + all. Every manifest entry, every Data-page source tile. Hard rule.

### 4.2 (2026-06-16) — Freshness is ONE clock: grade off the LAST PULL, never the age of the data (binding; FRESHNESS_CHIP_SPEC.md is the acceptance test)

**What happened:** The two-clock design (data-age SLA on most chips + a session-frontier grade on dailies) drifted into the three contradictions Joe kept catching: fake-green (Uranium read green while its feed was effectively dead), false-red (lagged monthly/quarterly series red between releases), and "refresh older than data" impossible pairs. Joe wrote FRESHNESS_CHIP_SPEC.md as the binding contract and acceptance test for all 50 indicator + 28 positioning chips.

**Rule:** Every chip grades green/red off the **LAST PULL** — the producing job's real last successful run time (`pipeline_health.last_good_at`) — versus an SLA **sized to the JOB's run cadence + grace, NOT the data's publication lag**. Calendar-aware so weekend/holiday hours never count (no Monday false-reds). Red only when: now − last pull > SLA, OR the run errored, OR the data is dated after its last pull (**hard invariant: last pull ≥ as-of**). A lagged data series stays GREEN while its job keeps pulling — a monthly series read by the daily job carries a 49h SLA, not an 1800h one. Two-state (green/red); an untracked element is grey, never silently green. The grade is ONE shared function (`gradeByLastPull`) used by every chip, the hook, and the watchdog, mirrored client/server — one edit moves all of them, so the fix is executed and verified as a single focused pass, never hand-patched per-surface. The chip shows five fields: Source · Frequency+pull-time · As of (data date) · Last pull (job run time) · SLA in days & hours. Producers stamp `last_good_at` = the real run time (honest stamp); the watchdog must NEVER fabricate it (preserve the producer's stamp, never `now()` as a fallback — that was the COT-chip fake-green). **This SUPERSEDES, for the GRADE, the session-frontier doctrine (2026-06-12) and the publication-lag SLA floors (4.7: daily 49h/weekly 192h/monthly 1200h/quarterly 3600h sized to DATA age); those SLA numbers are retired — the SLA now measures the JOB, so weekly/monthly/quarterly series read by the daily job are 49h.** The honest-stamp rule (4.2: refresh time = real run time) and the no-fake-green rule (0.1) remain and are reinforced.

**SUPERSEDED IN PART, 2026-09-01.** This entry says one clock. Joe approved the **two-clock** doctrine ONE DAY LATER (2026-06-17) and that is what the live code implements — `src/lib/freshnessClock.js` carries both graders and its own comment says the two-clock grade "SUPERSEDES one-clock grading". The correction was never written back here, and the spec that holds it lived only on Joe's Mac, so this entry has read as binding and wrong since June.

**What is actually binding:** green requires BOTH clocks to pass. The **pull clock** (did the producing job run successfully within its SLA, sized to the JOB's cadence) AND the **data clock** (did a new data point actually arrive within its cadence window, anchored to a missed scheduled release). Either failing is red, and the chip says which. One clock alone left a fake-green hole: a feed whose vendor went dark stayed green as long as the job kept running. Everything else in this entry stands — honest producer stamps, the last-pull ≥ as-of invariant, calendar awareness, two states only, untracked is never silently green, one shared grading function mirrored client and server. The spec is now in the repo at `docs/FRESHNESS_DOCTRINE.md`.

**Applies to:** Data Steward (owns) + Senior Quant + Lead Developer + UX Designer. Every freshness surface, every producer, every grader.

### 4.3 (2026-06-12) — Daily freshness is graded in trading sessions against the publication frontier, never in padded wall-clock hours

**What happened:** Daily credit-spread indicators showed green at 7:30 AM Friday carrying Wednesday's data. The hour-budget doctrine (cadence + lag + 24h grace = 49–73h) was sized never to false-alarm — which meant it also tolerated 2–3 days of true staleness on DAILY elements, long enough to hide a dead feed until the weekend. Underneath it sat two producer-sequencing defects the padding had been absorbing: the only FRED pull ran 6:00 AM, 3.5 hours BEFORE the credit series publish (~9:39 AM ET, verified), so the site ran a full session staler than necessary every day; and index breadth computed at 11 AM from a price panel complete at ~3:15 AM. Joe: "We can't have a 70+ hour SLA on DAILY indicators. The only time they can be 70+ stale is over the weekend or holidays."

**Rule:** A daily element is GREEN only when it carries the newest session its source can have published by now — "now" measured against the element's fetch deadline (scheduled fetch ET + grace, default 3h). AMBER at exactly one session behind that frontier (today's pull missed or late — visible the same morning). RED at two or more sessions behind, or on upstream error. Deadlines exist only on business days, so weekends and holidays are the only time a daily may sit more than one session old — and they never count against it. Hour budgets remain only for weekly/monthly/quarterly publication calendars. Corollaries: (1) producers must be scheduled so the frontier is reachable — pull AFTER the source publishes, compute AFTER inputs land; (2) each element's publish time in the manifest is evidence-based (checked against the source), not guessed; (3) the four graders (site clock, server clock, watchdog, chips) change in lockstep, always.

**Applies to:** Data Steward owns the doctrine; Senior Quant signs per-element publication facts; Lead Developer keeps the graders synchronized.

### 4.4 (2026-06-12) — Stamp after publish; the watchdog needs an evidence source for every row it grades

**What happened:** The sector-sleeve allocator stamped its health row green BEFORE its publish step; the push was then rejected (data-commit race) and the freshly-stamped green row pointed at an allocation that never landed. The same night, the freshness watchdog clobbered three producer-stamped paper rows red with "indicator not present in indicator_history.json" — the third instance of the clobber bug (scanner-v5 2026-05-12, snapshot files 2026-05-19). Net effect: the one element that genuinely failed showed green, and three healthy elements showed red. The morning paper rebalance refused on the stale sleeve while the Asset Tilt chip stayed green. Compounding: the board producer wrote as_of from the runner wall clock (UTC "today" — after 8 PM ET that is tomorrow), and the failure-alert watchlist held a renamed (dead) workflow name, so the publish failure emailed nobody.

**Rule:** (1) A producer stamps its health row green only AFTER its output is verifiably published (pushed / upserted / deployed) — never before; every producer workflow carries a red-stamp step on failure (status + error only; freshness fields untouched). (2) The watchdog may only grade a row it has an explicit evidence source for (indicator bundle, named file, named table); any row without one is producer-owned — leave the producer's stamp alone. (3) A data file's as_of is derived from the data itself, capped at the last closed session — never from the runner's wall clock. (4) Failure-alert watchlists are part of every workflow rename's blast radius; a watch entry pointing at a dead name is a silent-failure machine.

**Applies to:** Lead Developer + Data Steward. Every producer workflow, every watchdog branch, every workflow rename.

### 4.5 (2026-06-12b) — Two surfaces showing the same concept render ONE shared computation; a tooltip explaining a mismatch is a defect, not a fix

**What happened:** The Paper page's sleeve table headers summed per-position broker fields ("today" = sum of intraday P&L, "open P&L since entry" = sum of unrealized P&L) while the Performance card computed sleeve-level Daily and Inception P&L from the close-anchored snapshot. The numbers disagree whenever trades executed that session or realized P&L exists (Sleeve A: −$900 vs −$1,243; Sleeve B "today": $5,954 vs $3,592 the same day). A prior session had documented the difference in the Performance tooltip instead of fixing it. Fourth time Joe caught two surfaces on one page out of sync; he should never be the reconciliation engine.

**Rule:** When two surfaces on one page (or one site) display the same concept — "today", "since inception", a sleeve value, a score — they must render the output of ONE shared function reading ONE source, so agreement holds by construction. Writing a tooltip, footnote, or methodology paragraph that explains why two visible numbers differ is the failure mode, not the remedy. A stat with a genuinely different basis must carry an unmistakably different name and must not sit beside its sibling in a header line. When the shared source has not loaded, render an em-dash — never a divergent fallback from another basis.

**Applies to:** All. Senior Quant signs off on any header/summary stat addition; UX Designer rejects headers that juxtapose different bases.

### 4.6 (2026-06-11) — An orphan tracking row is either a live feed missing registration, or a killed feed missing cleanup — decide with evidence

**What happened:** A registration pass found tracking rows with no registry entry and registered all three per the no-grey-chips rule — without checking history. All three had been deliberately killed as phantom feeds THE DAY BEFORE; the kill removed producers and tiles but left tracking rows behind. Registration armed the header freshness pill on a dead feed: Joe saw "1 feed stale" with every visible tile green and no red tile anywhere to find.

**Rule:** An orphan tracking row has exactly two futures: (a) live feed missing registration → register it; (b) killed feed missing cleanup → delete the row. Decide with evidence: search commit history for kill commits naming the element, check whether any producer still writes it and any page still renders it. Killing a feed must retire ALL of it in one change: producer, tiles, tracking row, registry entries, drill lists. A page-level rollup (the header pill) must never grade an element set wider than what can be traced from a visible surface without NAMING the offenders in its tooltip.

**Applies to:** Data Steward — every registration or retirement.

### 4.7 (2026-06-11) — Never derive a refresh timestamp from a data date

**What happened:** Joe caught tooltips claiming "Data as of June 10 · Last refreshed June 9, 8:00 PM" — impossible pairs — plus an as-of rendered hours before the close. Root cause: six producers DERIVED the "last refreshed" stamp from the data's own date (midnight UTC renders as 8:00 PM the prior evening ET) or fabricated a 4 PM close stamp; the nightly reconciler froze as-of dates; nobody recorded the actual run time.

**Rule:** (1) Refresh/check stamps carry ONLY a real wall-clock run time (`now()` at write). (2) The as-of carries the business date the data represents (date-only intent at midnight UTC; display adds the official cutoff from the manifest) or a real event timestamp — never a dressed-up close time, never the future. (3) A daily market series never publishes a point for a session that hasn't closed in New York (keep the future-point guards in the fetchers). (4) The database clamps future stamps and rejects forward-dated price bars via triggers — do not remove them. (5) The freshness hook turns any remaining as-of-newer-than-refresh pair red with an explicit reason. Every new producer copies the honest-stamp comment block and verifies its first row shows a real run time in Admin·Data.

**Applies to:** All — every producer, every freshness surface.

### 4.8 (2026-06-11) — A displayed value must read the SAME source the engine acts on; auditing a table means auditing EVERY column

**What happened:** The Sleeve B score column showed 1–3 on every holding (buy gate is ≥5) for two weeks: the trading engine had switched signal sources but the display helper kept reading the dead table on the old scale. Joe found it the night after the agent had "verified" the page three times while staring at the wrong scores.

**Rule:** (1) When a data source is retired or an engine changes sources, grep EVERY consumer of the old source in the same change — engine and display must read one source of truth. (2) Self-UAT of a data table verifies EVERY column against its source of record (recompute independently), not only the columns the task touched, plus a plausibility pass. (3) Numbers a PM would act on get the Senior Quant plausibility check before the page is called verified.

**Applies to:** All.

### 4.9 (2026-06-01) — Never ship synthetic or placeholder data dressed as real; un-wired renders an em-dash

**What happened:** Large parts of the Scanner and Ticker pages rendered fabricated data as live: hash-seeded component scores, random-walk sparklines, a synthetic price path, and four hardcoded "events" identical on every ticker — while the real values sat unused in the database. This drove Joe's "zero faith in the data."

**Rule:** Every value on a data surface traces to a real stored field. If a field isn't available yet, render an em-dash (—) and say what's missing — never a synthesized stand-in, random series, or hardcoded example, even as a "temporary placeholder." Any fake/hash-seeded/random data generator in a production component is a defect. Before declaring a surface done, open the source row it claims to show and confirm each rendered value matches.

**Applies to:** All.

### 4.10 (2026-05-27) — Never accept silent staleness on a "successful" data workflow; fail loud

**What happened:** The indicator-refresh workflow logged success every morning while individual indicators went days stale — fetch helpers returned nothing on vendor hiccups and the result was silently dropped. Joe spotted stale values on the live site before any system did. Exit-code-zero-but-stale is the worst failure mode: it actively masks the problem.

**Rule:** Every producer that writes a "live" data file includes a fail-loud staleness gate: a per-indicator SLA table (in TRADING days, NYSE-calendar-aware — T+1 vendor series get 2, same-day series get 1), checked after the fetch but before the file is written; any breach fails the whole run, the workflow goes red, the watchdog files a P1 bug, and the stale file never ships. Helpers may return None to survive one indicator's hiccup, but the end-of-run gate is mandatory — "we log it to the health table" is not enough, because by then the stale file already shipped. A new indicator without an SLA entry is a missing config, not exempt: add the entry in the same PR as the producer.

**Applies to:** All data producers. Lead Developer + Data Steward sign-off on any producer change.

### 4.11 (2026-05-27) — Don't anchor on the vendor you've been using; check whether the publisher is upstream

**What happened:** Three daily Treasury yield indicators sat on FRED for 18 months and repeatedly shipped stale — FRED republishes Treasury's own daily data with an afternoon delay, after our morning run. The fix was free: read Treasury.gov, FRED's upstream publisher, which posts same-day.

**Rule:** When picking a source for a series, ask "who does this vendor get the data from?" If an upstream publisher exists at the same license tier (free/public) on a tighter cadence, that's the right source. Treasury.gov, FRED, NY Fed, ICE BofA, BLS, BEA all publish free feeds; FRED republishes most of them. Check the publisher before the republisher. Any new daily macro/rates indicator requires this check before the source is locked.

**Applies to:** Data Steward (lead) + Senior Quant.

### 4.12 (2026-05-03 ×2, rewritten 2026-06-11; the "untracked defaults to green" clause is SUPERSEDED by Hard Rule 0.1) — Freshness SLAs floor at worst-case publish lag; no false alarms on weekends; every chip-wired element is registered before merge

**What happened:** Chips lit red on a Sunday morning for working pipelines (a daily SLA of 25h breaches every weekend; monthly vendor series publish 3–4 weeks after period end and were graded against a 34-day window). Joe: "I only want to know when something breaks!!!!! I dont want red chips over weekends/holidays!!!" The original fix also defaulted UNTRACKED elements to green — that clause was reversed on 2026-06-02 by Hard Rule 0.1 (fake green forbidden): an untracked element is never silently green; it gets registered and seeded in the same PR.

**Rule:** SLA floors = worst-case publish lag + one full cadence cycle + operational grace:

- daily → 49h (covers T+1 publish + weekend)
- weekly → 192h; 384h for long-lag series (e.g. the term-premium model the Fed posts weekly)
- monthly → 1200h (~50 business days)
- quarterly → 3600h (~150 business days; some surveys land 10 weeks after quarter end)

When in doubt, check the vendor's actual history: the SLA must be at least the typical gap between the data date and when that point first appears, plus one cadence cycle — otherwise the chip lies red between releases. Red is reserved for actual breakage. (The deeper fix the original entry filed as follow-up — grade freshness off the real last-run time, not the data's own date — shipped 2026-06-11; see 4.2.) Adding a chip to a tile without registering the element in the manifest AND seeding its tracking row is a bug; the Data Steward sign-off must call out new chip wires.

**Applies to:** Data Steward + Lead Developer.

### 4.13 (2026-05-11 b) — Backfills persist to Supabase first, then the file change merges in the same work item

**What happened:** ISM history went "missing" three times: each time an agent parsed the source spreadsheet in-session, merged ~865 monthly points into a working copy of the history file, used it, and never committed — the next scheduled run overwrote the file with the stub, and the next session re-declared the data missing. Joe: "How did you misplace this data 3 times? Why isn't it in our database?"

**Rule:** Any non-trivial backfill (history, calibration tables, anything beyond a single new daily reading) is durably persisted to Supabase FIRST, then the file/JSON change is committed and merged in the SAME work item — no "next session." The producer gains a "hydrate from Supabase if the local series is shorter than the database" branch so a fresh checkout repopulates from source-of-truth before appending. Archive the raw source file in the repo for reproducibility. If we parsed it once, future-us reads it from Supabase without re-parsing.

**Applies to:** All historical backfills, calibration tables, and manifest updates introducing a new element.

### 4.14 (2026-05-21) — Resampling to a period-end label publishes a future-dated point for the in-progress period

**What happened:** Three Macro Overview tiles showed "last updated" dates in the future: month-end / week-Friday / quarter-end resampling labels every bucket with the period-END date, so the still-in-progress period publishes a partial value with a future stamp. Bonus finds: a credit-spread proxy ran ~2× the true spread on a wrong "the real series is license-restricted" assumption (it was free the whole time), and a ratio used non-standard scaling.

**Rule:** (1) After any resample to period-end labels, immediately drop buckets dated after today — the in-progress period is a partial value, not a finished observation. (2) Keep the end-of-run future-point guard that sweeps every indicator before writing. (3) Prefer a series' native daily cadence when every input is already daily. (4) Before believing a "vendor series is unavailable/restricted" comment, query the vendor.

**Applies to:** Senior Quant + Data Steward — every producer block that resamples or substitutes a proxy.

### 4.15 (2026-05-04) — Before changing a data file the website reads, find every reader and keep its labels

**What happened:** A script wrote different labels into a file the home page was already reading; the page found nothing under the labels it expected and every cycle-board score rendered as a blank zero — no crash, no log error, just a broken-looking page Joe caught within hours.

**Rule:** Before shipping anything that writes to a data file the site reads, search the site's code for that file's name, find every reader, and note exactly which labels each pulls. New code keeps those labels; if a label must change, the reader changes in the same PR so they ship together. After deploy, load the page and look at it.

**Applies to:** All producers writing site-consumed files.

### 4.16 (2026-05-04 b) — No hardcoded dates anywhere on the site

**What happened:** Hardcoded strings — "tax year 2026," "next release: May 6," an "as of" footer — each eventually went stale and had to be chased individually, with nothing alerting.

**Rule:** Every "current" date displayed in the UI is sourced from a live registry (the freshness-tracking table, the data manifest, or a snapshot file). If you find yourself typing a month or year into UI code, stop and ask "where would this come from if I refreshed at 6am tomorrow?" — that source is the one to read. Historical-event labels ("Dec 2021 — all-time peak") and calendar reference data (market holiday tables) are fine.

**Applies to:** All UI work.

### 4.17 (2026-07-13) — Stale-feeds incident: a dead dispatcher, a silent breadth skip, and a health row that could only go red

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

### 4.18 (2026-06-30) — `data_max_age_hours` in the manifest is a hard freshness gate; set it against the ACTUAL upstream publication lag, not a round number

**What happened:** `term_premium` (`THREEFYTP10`, ACM 10Y Term Premium, NY Fed / FRED) turned red because `data_max_age_hours` was set to 144 (6 calendar-day equivalent). THREEFYTP10 has a known 5-8 trading-day publication lag; on day 7 post-last-data-date the business-calendar age crossed 144h and the data clock failed, producing a false red. No data was actually stale — the NY Fed simply had not published yet.

**Rule:** Before setting `data_max_age_hours` for a lagging series, look up the upstream publication cadence and lag. For THREEFYTP10: lag ≤ 8 trading days = ~192h; use 288h (12 trading days) as the gate to absorb normal variance. General pattern: `data_max_age_hours = (max_observed_lag_trading_days + 4_day_buffer) × 24`. A window that is too tight produces false reds that erode trust in the freshness system; a window that is too loose masks a genuinely dead feed. Pick the tightest window that does not fire on a normally-lagging healthy series.

**Applies to:** Data Steward.
---

### 4.19 (2026-07-13) — PostgREST silently truncates at 1,000 rows, and Range-header paging on RPC calls is NOT honored: page in SQL, and treat a cap-sized response as a red flag

**What happened:** The RSI divergence scanner's first production run "succeeded" while scanning only 1,000 of its 1,486-name universe. The producer called a set-returning database function through the REST layer, which caps any single response at max-rows (1,000 here) and gives no error, no header hint you can rely on, nothing — the truncation is silent, and the fail-loud minimum-universe gate (≥500) sailed right past it. The first fix attempt paged with `Range` headers, which our PostgREST config ignores on RPC calls: every "page" returned the same first 1,000 rows and the pager looped until the job was cancelled. The validation run hadn't caught any of this because it staged data server-side (SQL INSERT…SELECT), which has no response cap — the validation path and the production fetch path were not the same transport.

**Rule:** (a) Any REST/PostgREST fetch that can return ≥1,000 rows MUST page with EXPLICIT `p_limit`/`p_offset` SQL parameters on the function itself (with a stable ORDER BY), looping until a short page — never Range headers on RPC, never a single trusting call. (b) A response of exactly the cap size (1,000) from an unpaged call is presumptively truncated — fail loud, never process it as complete. (c) Sanity gates sized as "at least N" don't catch truncation at a cap above N; when the expected cardinality is known (a universe, a panel), assert against a server-side count, not a floor. (d) If validation used a different transport than production (server-side SQL vs REST), the transport itself is untested — do one full production-path run and diff its counts against the validation run before calling the port done.

**Applies to:** Lead Developer + Data Steward.

### 4.20 (2026-07-15) — Sleeve attribution comes from the FILLS LEDGER, never from ticker heuristics; one sleeve key end-to-end

**What happened:** The two-sleeve book went live and the Paper page showed Momentum's 49 names (~$484K) inside the Insider sleeve ("52 holdings") while Insider's idle cash showed under Momentum. Root cause: the positions and NAV writers bucketed sleeves by TICKER through the retired Sleeve-A/`v10_allocation.json` lookup, which can only answer A-or-B — while the true sleeve of every share was already recorded on `paper_orders`/`paper_fills`. The intraday table's own CHECK constraint didn't even allow 'M'. Downstream, per-sleeve inception, "Today" P&L and the cash split were all wrong or blank.

**Rule:** (a) The sleeve of a position is provenance, not a property of the ticker: every writer that buckets positions, cash, NAV or P&L by sleeve derives it from the fills ledger (net shares per ticker+sleeve; proportional split when two sleeves own the same name). (b) One canonical sleeve key ('B' Insider, 'M' Momentum) across paper_orders, paper_fills, paper_positions, paper_intraday_positions, and the nav tables' column families — adding a sleeve means widening every CHECK constraint and every writer in the SAME change. (c) An order ledger must be closed-loop: whatever mirrors fills also flips the originating order's status (submitted → filled/cancelled/rejected) in the same run — a status that nothing ever advances is a bug, not a marker.

**Applies to:** Lead Developer + Data Steward + Senior Quant.

### 4.21 (2026-07-20) — prices_eod must sit on ONE share basis: a split with no retro-adjustment is a fake crash in every return window that crosses it

**What happened:** Joe cross-checked his ThinkOrSwim watchlist columns against our scanner math and the numbers disagreed on CRWD: TOS said +91% 3-month return, prices_eod computed −51%. Root cause: the daily ingest writes each day's close at that day's share basis and NEVER re-adjusts history, so CRWD's 4:1 split (2026-07-01) left pre-split rows at 763 next to post-split rows at 193 — a fake −75% "crash" inside every ROC/momentum/RSI window that crossed the seam. A sweep found ~40 corrupted tickers over 3.5 months (CRWD, HON, MLI, DD + leveraged ETFs). The 7/14 Power Trend list happened to survive (CRWD failed the 1.3× volume gate on clean data too), but only by luck. Also caught: (a) NOT every big overnight gap is a split — PRIM/CAR/WGS/MXL had near-exact-half gaps that the splits vendor confirms were REAL price moves; blanket ratio-based adjustment would have corrupted good data; (b) seams are per-ticker quirky — HON had exactly ONE raw-basis day (6/26) between two adjusted segments, so "adjust everything before the gap" is wrong without walking the series; (c) our own splits table had records the vendor's current API no longer corroborates and vice versa — corroborate ratio-vs-observed-gap before applying anything.

**Rule:** (a) prices_eod doctrine: the entire stored series per ticker is on the CURRENT post-split basis; any ingest that can write a new basis must re-base history in the same run (MASSIVE-DAILY now runs scripts/adjust_splits_retroactive.py — seam detection + RPC apply_split_adjustment, migration 084). (b) Never adjust on a ratio heuristic alone: require a corroborating split record AND an observed gap matching the split factor within tolerance; the residual is the stock's real move that day. (c) When validating any return/momentum computation, cross-check at least one split-affected name against an independent adjusted source (TOS, vendor charts) — parity on non-split names proves nothing about basis handling. (d) An external per-ticker check (Joe's TOS columns) caught what our internal consistency checks could not; treat independent-source parity as a standing UAT tool.

**Applies to:** Lead Developer + Data Steward + Senior Quant.

### 4.22 (2026-07-21) — A feed cutover is not done until its tracking row and self-stamp ship in the same change

**What happened:** The 2026-07-20 UW→EDGAR insider cutover registered the new feed in the data manifest and deployed the nightly ingest, but never seeded its `pipeline_health` row and never gave the workflow green/red stamp steps — repeating Hard Rule 0.1's exact failure mode. Result on Admin·Data: the SEC EDGAR vendor card graded RED (tile grader synthesised red from the absent row), the detail row said grey "Not yet tracked," and the header pill said "All feeds current" (it skipped feeds with no health row) — three contradictory answers in one viewport, over a feed that was actually running fine.

**Rule:** (1) Cutover/new-feed checklist is atomic: manifest entry + `pipeline_health` seed row (honest timestamps from the real first run) + workflow green-after-publish and red-on-failure stamp steps, all in the same change. (2) All surfaces treat "no health row" identically: neutral grey "not yet tracked" — never a synthesized red, never green. (3) The header pill counts scheduled, SLA-carrying feeds that have no health row and reads "N feeds not tracked" (grey) — it must never read "All feeds current" while such a feed exists. (4) The `pipeline_health` key is the PUBLIC manifest's short `name` (e.g. `insider_history_edgar`) — the root registry's dotted ids do not resolve in the freshness hook.

**Applies to:** Data Steward (owns) + Lead Developer. Every new feed, every vendor cutover.

### 4.23 (2026-07-29) — One ungradable row must never take down the whole health watchdog; deregistering a feed's manifest entry while its health row stays live is a poison pill

**What happened:** The 7/20 UW teardown (#1411) deleted 6 elements from the public manifest but deliberately kept 4 of their `pipeline_health` rows live until the 8/12 lapse (uw-universe-snapshots, uw-ticker-events, earnings_history, scanner-v5-daily). The watchdog grades a row with no manifest SLA as `unknown` — but the `pipeline_health` CHECK constraints only allowed green/amber/red, so the watchdog's SINGLE batch upsert failed and the whole function 500'd on every 30-minute run for 9 days. Blast radius of one bad row: (a) the narrative-blurb green-stamper (section 7) never ran, so `narrative_macro`/`narrative_sector` sat red and the header said "2 feeds stale" on every page every day; (b) ALL stale-feed email alerts were dead for 9 days; (c) `pipeline_fetch_log` recorded nothing. Nobody noticed because the failure mode was silent 500s inside a cron.

**Rule:** (1) The watchdog writes per-row on batch failure — one poisoned row is skipped and reported (`failedRows` in the response), never allowed to kill stamping + alerting for everything else. (2) A health row the watchdog cannot grade (no manifest entry at all) is SKIPPED per the anti-clobber doctrine — its producer's own stamp stands. (3) DB status constraints must accept every status the code can emit (`unknown` added, migration 089); a constraint narrower than the code's type is a time bomb. (4) Teardown checklist gains the mirror of the 7/21 cutover rule: removing a feed's manifest entry requires deciding its health row's fate in the same change — retire the row or keep it producer-owned, never leave it for the watchdog to grade against a manifest entry that no longer exists. (5) A recurring 500 in any scheduled edge function is an incident, not noise: the fetch-log gap (last row 7/20) was visible for 9 days and no check looked.

**Applies to:** Lead Developer (owns) + Data Steward. Every feed teardown, every scheduled function.

### 4.24 (2026-07-29) — A dollar and a percent that describe the same move must come from the same base; `sleeve_*_value` is the only column that ties to the account

**What happened:** Joe: "How am I down money but + return?!?! Something isn't right." The Paper hero read **Today −$1,249** directly above a matrix reading **Book Day +0.1%**, on the same account, in the same card. The account was genuinely **+$1,387** on the session (live NAV $951,401.46 vs the 7/28 close of $950,014.84 — the broker's own `day_pnl` was correct in the database the whole time). The headline dollar was not a rounding artefact or a stale read: it was the wrong sign, and it was the ONLY number a non-technical reader looks at.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:** (a) Where two columns could both plausibly represent "the sleeve's value", the one that is a verified partition of the parent total is the ONLY display base — check it with a query (`sum(parts) − total`) across the whole live history before wiring it, and re-check whenever a column is added. Reconstruction columns like `sleeve_*_nav` are inputs to sizing (`translator.py`), never a display base. (b) Never let a base change across a row-type boundary: if the live row and the close row expose different columns, resolve BOTH sides through one accessor with one preference order, and prefer the column that exists on both. (c) A headline figure and the percentage of the same move must be derived from the same quantity — the Book's "Today" now anchors on the account's own NAV delta with the sleeve sum as fallback, so the dollar and the percent cannot disagree in sign even if a sleeve column goes null. (d) Whenever a comment claims two columns tie, the claim needs a query behind it or it does not go in.

**Applies to:** Lead Developer, Senior Quant — the Paper page, and any surface that shows a dollar change beside a percentage change of the same thing.

### 4.25 (2026-08-06) — A metered vendor account is a data feed; its balance is the freshness. And a watchlist alarm covers exactly what someone remembered to list

**What happened:** the Anthropic API account ran out of credits. Every AI-generated surface died on the same day-window with the same invisible error: `generate-commentary` stopped writing the macro/sector tiles after 7/28, and DAILY-BRIEF-WRITER failed every trading morning from 8/3 — 90+ failed runs across three days — so the homepage carried the Jul 31 brief through Aug 6. Nobody was told, three ways at once: (a) urllib printed `HTTP Error 400: Bad Request` and swallowed the response body, which said in plain English "Your credit balance is too low"; (b) DAILY-BRIEF-WRITER, BRIEF-FRESHNESS-SELFHEAL, CFTC-COT-WEEKLY and PIPELINE-FRESHNESS-WATCHDOG were never on WORKFLOW_FAILURE_ALERT's watchlist, so 90+ reds emailed nothing; (c) every redundancy layer (cron sibling, three workflow_run piggybacks, the Vercel brief-ensure backstop, the self-heal) re-fired the same broken API call — redundant *triggers* are not redundant *capability*. Separately, CFTC-COT-WEEKLY hung on 8/1, hit its 15-minute job timeout, and a weekly job has no retry — one cancelled run bought 12 days of red on two positioning chips.

**Rule:**

1. **Every metered external account gets a balance probe.** A daily one-token ping (the ANTHROPIC-API-DIAG shape) that alerts on the *body* of the refusal, before the first production call of the morning needs it. Credits, API quotas, SMTP send limits — all of them.
2. **Print the refusal.** An HTTP error without its response body is a diagnosis withheld; this outage was one `e.read()` away from naming itself on day one.
3. **Alert coverage is an inventory, not a habit.** Any workflow whose failure can stale a user-visible surface goes on the watchlist the day it ships. The gap list found today is the price of doing this by memory.
4. **N triggers into one broken call is one failure, N times.** When adding a redundant path, ask what failure mode it is redundant *against*; if all paths share a dependency, the dependency needs its own monitor (rule 1).
5. **A weekly job that fails waits a week to disagree with you.** Weekly fetchers get a next-morning retry on failure/cancellation, or their miss cost is a full cadence.

**Applies to:** Lead Developer, Senior Quant — every generator that calls a paid API, every weekly fetcher, and WORKFLOW_FAILURE_ALERT's watchlist.

### 4.26 (2026-08-18) — A live feed with silent holes is worse than no live feed; and a stale % is a lie the moment it renders without its session

**What happened:** Joe opened `/ticker/KLIC` at 11 AM ET. The page showed **$101.77, ▲ +2.70%** in green. KLIC was actually trading at **$90.06, −11.5%**, and his own portfolio page — one click away — showed it as the day's worst position at −27.4bp / −$2,692. Two surfaces of the same site, the same stock, the same minute, opposite signs.

**Root cause, in two parts, and the second one is the real one.**

*(a) The coverage hole.* `lse_live_quotes` held KLIC as `covered:false`, negative-cached that morning for 24 hours. The LSE feed carries ~4,000 US names; a miss wrote a tombstone and the site stopped asking. Thirteen other real symbols sat in the same state — including **TSM**. And the write path was worse than a coverage miss: `fetchOne` returned `covered:false` on an *empty bar array* as well as on a 404, so one bad minute on a liquid ticker poisoned it for a day. Nothing anywhere reconciled that list against reality.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A percentage renders with the session it belongs to, in the same element.** Not on a meta line, not in a tooltip, not implied by a date twelve pixels below. "▲ +2.70% · Aug 17 session" is honest; "▲ +2.70%" with the date elsewhere is not. This binds on every surface that quotes a move.
2. **A fallback must degrade in a way the reader can see.** Falling back to older data is fine. Falling back *silently into the slot where fresh data lives* is a fabrication, whatever the number's provenance. Ask of every fallback: if this fires, does the page look different?
3. **"Not covered" is a claim about the world, not about one vendor.** One provider's gap is a sourcing problem to solve, not a fact to render. Where a second provider is free and available, exhaust it before telling the user we don't know. Negative-cache only what *nothing* can answer.
4. **A negative cache needs a higher bar than a positive one.** A 404 is evidence; an empty array is not. Never let a transient response write a tombstone with a 24-hour TTL, and never downgrade a symbol that has previously answered.
5. **Coverage lists get audited, not assumed.** `select * where covered=false` was a five-second query that would have surfaced TSM sitting dark for three weeks. Any table that decides what the site refuses to show needs a scheduled read-back.
6. **The cross-surface check is the test that matters.** Every one of these surfaces passed its own unit of sanity. The defect only exists in the comparison — and Joe is the one who ran it. When two pages can quote the same instrument, they resolve it through the same function, or one of them will eventually be wrong in public.

**Applies to:** Lead Developer + UX Designer + Data Steward — every surface that renders a price, a level, or a move.

---

### 4.27 (2026-08-19) — A series can be perfectly fresh and still be missing a month; and replacing a series is only safe if the new one is a superset

**What happened:** while wiring one-session deltas into the new brief snapshot, the change for MOVE came out as **+4.10** on a day it had actually moved **−0.60**. The delta was computed from the last two points in `indicator_history.json`, and those two points were **2026-07-17** and **2026-08-18** — 21 trading sessions apart.

**The cause is precise and nasty.** Yahoo stopped publishing `^MOVE` daily **bars** after 2026-07-17, but kept serving a single live quote row. `yfinance` therefore returned 5,854 historical bars ending 07-17 **plus one row dated today**. So:

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Freshness is not completeness.** Any check that reads only the newest observation cannot see a hole behind it. If you promise a series is daily, audit the *spacing* of its points, not just the date of the last one.
2. **Never replace a held series with a fetched one.** Merge by key. A pipeline that can only add data cannot silently delete a month of it.
3. **A guard is only as good as the failure it imagined.** The monotonic as-of guard was written for a vendor returning an *older* series, so it demanded the last date advance — which is precisely the property the broken feed had. When a guard passes on the incident it was meant to catch, the guard's *predicate* is wrong, not its threshold.
4. **A constant that never changes is a signal.** 5,855 points, every commit, for a month. Nothing watched cardinality. Anything that should grow and doesn't is worth an alarm.
5. **Look for the data before you decide it is gone.** Our own commit history was a complete daily archive of the exact values the vendor had stopped serving. Version control is a time series.

**Applies to:** Lead Developer (owns the pipeline and its guards) + Senior Quant (owns every statistic computed on these series).

---

### 4.28 (2026-08-19) — A gap in a series is a symptom; check whether the two sides of it are even the same number

**What happened:** chasing a 107-day hole in `cmdty_uranium` (2026-03-01 → 06-16), the hole turned out to be the least of it. The two sides of the gap were **different price benchmarks**.

- Before the gap: ~30 years of monthly points scraped from IndexMundi, which serves the **Nuexco "restricted" price**.
- After the gap: our own daily readings of **Numerco spot U3O8**, accumulating since 2026-06-16.

They are not the same series and they are nowhere near each other:

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A splice is a claim that two sources measure the same thing. Prove it at the seam.** Any series stitched from two providers must show the overlap — or at minimum the adjacent values — and the check belongs in the code, not in someone's memory of having eyeballed it once. Ours differed by 20% and nothing objected.
2. **Percentiles, z-scores and ranges inherit every definition change in their window.** A statistic computed across a source switch is not a statistic. Before trusting a percentile, ask what the window is actually made of.
3. **Never leave a "one-time seed" as the permanent shape of a series.** If it is worth fetching once it is worth fetching every run: the cost is one HTTP call and the benefit is that it self-corrects and self-extends. Every one-time seed is a fact frozen on the day someone happened to run it.
4. **Prefer the source whose definition you can name.** "Uranium price" is not a specification. Cameco publishes exactly what it averages and over what period; the IndexMundi row said "u3o8 restricted price, Nuexco exchange spot" and nobody read it.
5. **When copy and data disagree, the data is the suspect.** The card's own description had the 2007 peak at $136 and the 2016 trough near $19 — both correct on the Cameco spine and neither matching the numbers we were plotting. The prose had been right about this feed for months.

**Applies to:** Senior Quant (owns what a series means and every statistic on it) + Data Steward (owns its sourcing).

---

### 4.29 (2026-08-19) — A window measured in observations is not a window measured in time

**What happened:** having rebuilt uranium's history on the Cameco spine (LESSONS 4.48), I predicted the card would move from the 99th percentile to about the 91st. The refresh ran, the history landed correctly — 508 points, every spot check right, no gaps — and the pill printed **97.2, still red**. The prediction was not wrong about the data. It was wrong about what the code computes.

`pctrank_latest(vals, WINDOW_DAYS)` takes `vals[-756:]`. **756 observations, not 756 days.** For gold, silver, copper, oil, natgas — thousands of daily points — those are the same thing, which is why nobody ever noticed. Uranium has 508 points in total, so the slice took **everything**, and a card labelled "trailing 3-year percentile" was ranking today's $88.13 against **thirty-eight years** including the 2007 spike to $136. The right answer over three actual years was 92.5.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **State the window in the unit the label uses.** If the card says "3-year", the code slices on dates. `[-756:]` is a coincidence that holds only while the cadence is constant, and it fails silently the first time it is not.
2. **A percentile is a claim about a population. Look at the population.** Before trusting one, ask what is in the window, how many, and at what spacing. Half a sample drawn from the last two months is not a three-year distribution.
3. **A shared helper is only shared where the inputs are alike.** The same two lines were correct for eight daily commodities and wrong for the ninth. "It works for everything else" is evidence about everything else.
4. **When a prediction and a print disagree, do not reconcile them by adjusting the prediction.** The gap between 91 and 97.2 was two real bugs. The temptation to write "close enough, the rebuild worked" would have shipped both.
5. **Bound a window at both ends.** Any code that reconstructs "the current value" from a sorted map must be certain nothing sorts above it.

**Applies to:** Senior Quant — every percentile, z-score, rank and state on the site.

### 4.30 (2026-08-31) — Ideas are sourced from the WORLD; our data validates them. A contract that can only mark 74 series will quietly narrow every idea to those 74 series

**What happened:** after five straight publish skips, Joe: "Get the fuck off our data... what about the trillions of data points out in the public domain? You should be reading the news, looking at public filings, finding stocks, commodities, currency trades." He was diagnosing the actual mechanism, not venting. Two things had compounded. (1) The daily sweep had inverted: it ranked the 74 indicator series and 25 positioning markets FIRST and treated the external morning sweep as a veto, so every candidate was born from the same internal board and the skip reasons read like an indicator recital — the exact shape 4.59 warned about, one level up. (2) The scorecard contract could only mark series carried in the indicator file, so a single-name idea sourced from filings or news was structurally unpublishable — the scanner's insider-conviction work, the one equity edge the playbook itself says is real, had NO path onto the Trade Idea surface. The tool's catalogue had silently become the boundary of the imagination.

**Rule:**

1. **Outward-first sourcing is a checked step, not a vibe.** The Trade Idea sweep starts in the public domain (news, filings, single names, commodities, currencies, policy calendars) and each run's record names at least three outward-sourced candidates with dated sources — a run whose candidates all trace to our own series has not swept. The playbook's step 2 now states this; the skip reason is where it is auditable.
2. **Our data's job is validation** — percentiles, conditional-vs-unconditional backtests, book fit — applied to candidates found outside. The bar does not drop; the funnel widens.
3. **When a surface's contract cannot express a whole class of legitimate ideas, that is a capability bug to fix, not a constraint to write around.** Scorecard legs now accept `ticker:XYZ`, marked from the same split-adjusted stock price store the scanner and backtests read, with entry, stop, path and benchmark rules unchanged — so a stock idea found in filings can publish and be graded like everything else.

**Applies to:** the Trade Idea run and every recurring research surface; Lead Developer for any contract whose catalogue limits what ideas can exist.


### 4.31 (2026-09-01) — Every field a page renders needs a CODE writer; a manual backfill is a bridge, not a source

**What happened:** The relaunched Quality Trend book went live and the paper page rendered "Unclassified 98.7% · 0 of 74 GICS industries" with every size and liquidity figure blank. The sector/industry/market-cap/volume columns the page reads had been filled BY HAND on Aug 14 — a one-off SQL fill during the page build, never engine code — so restoring the engine for the relaunch restored everything that was code and none of what wasn't. The first automated scoring run wrote NULLs and the page faithfully rendered them. Joe found it on launch day, on the live site.

**Rule:** Before a page ships, every field it renders traces to a writer that RUNS — a job, a function, a sync — not to a fill someone once executed. A manual backfill is allowed only to heal history, and the same change that backfills must ship the code writer (here: the rebalance writer now carries classification from `qt_gics` + `ticker_state_current` and its own 63-day dollar volume; a name missing from `qt_gics` stays NULL and is named in the run log — never guessed). Restoring or un-retiring a system re-verifies this for every surface it feeds.

**Same-day addendum (Joe: "why do I have to check such simple things"):** existence-grading is how the owner ended up as the QA — `qt-target-book`'s health row sat GREEN over the all-NULL book because the watchdog graded "a book was written". The writer now audits its own output the moment it writes: any hole in a rendered field stamps the row red with a plain-English count ("N of 20 holdings missing sector…"), which the watchdog emails before anyone loads the page. The pattern binds every producer stamp: grade what the reader will SEE, not that the job ran.

**Applies to:** Lead Developer — any change that adds a rendered field; any restore/un-retirement.


### 4.32 (2026-09-02) — "live" is a claim about the SESSION, not the feed; and only a real browser can check what a page claims

**What happened:** Pre-open, the S&P / Nasdaq / Dow tape tiles read **"live" over Tuesday's close** while the rate and credit tiles correctly said "close". `tapeTile()` stamped "live" whenever the quote resolver answered — but outside market hours the resolver still answers, with the last close, so "we got a quote" printed "live" on a closed market every single morning. The ticker-page hero had the correct gate (`lseLive.marketOpen === true`) the whole time; the home tape never adopted it. Nothing caught it: DAILY-HOME-SMOKE validates JSON files, pipeline_health grades producers, and the cloud health-sweep session **cannot render the site** (its egress resets browser connections to macrotilt.com; a plain fetch returns the empty SPA shell). Joe's eyes were the monitor, again — the same failure shape as 4.31, one layer up: 4.31 was a field nobody wrote, this was a label nobody checked.

**Rule:**

1. **A session-state badge ("live", "real-time", "as of now") is gated on the session clock, never on whether a feed answered.** A quote fetched on a closed market is a close and must say so. When one surface already has the correct gate, every sibling surface adopts it in the same change — grep for the label before shipping it (the 5.6 "audit the other phases" pattern, applied to copy).
2. **What a page CLAIMS is a checkable invariant, and it is checked from somewhere that can actually render the page.** RENDERED-DOM-SMOKE (weekdays 11:10 UTC, pre-open) loads / and /paper in headless Chromium on GitHub Actions and asserts label/semantic invariants: no "live" stamp while the session is closed, no visible NaN/undefined/null, no majority-"Unclassified" book, no empty tape. Violations file a P0 into bug_reports. Freshness stays with pipeline_health — this checker owns claims, not staleness.
3. **The health sweep's rendered-page check is that workflow's log.** The script prints each page's rendered text between `===== RENDERED-TEXT … =====` markers precisely so the cloud sweep (which has no browser path to the site) reads the rendered page via `{"run_log": <run_id>}`. A sweep that skips reading it has not verified the rendered site; a change that removes those markers breaks the sweep's only eyes.

**Applies to:** Lead Developer — every user-visible state label; the weekday health sweep.


# 5 · PIPELINES, SCHEDULES & ALERTING
### 5.1 (2026-06-09) — Scheduled notification emails are once-per-day even when their workflow fires many times

**What happened:** Joe received 7–8 paper-trading emails in one day instead of 2: the morning workflow deliberately fires every 30 minutes as insurance against late scheduling, and order submission was rerun-safe — but every fire re-sent its email.

**Rule:** Any email wired into a workflow that can fire more than once a day goes through the send-once helper (one send per email type per ET day, ledger-backed, fail-open). Redundant timers are for reliability and must never multiply notifications. Joe's inbox contract: exactly one morning summary and one execution report per trading day.

**Applies to:** Lead Developer — all notification wiring.

---

### 5.2 (2026-07-06) — GitHub can drop an entire cron block; a GitHub-cron backup for a GitHub-cron primary is not redundancy

**What happened:** On Mon 2026-07-06 GitHub's scheduler silently dropped this repo's whole morning block (~08:00-11:30 UTC): the 06:15 ET brief writer, every BRIEF-FRESHNESS-SELFHEAL sweep fire, the screener, and all 7 pre-open fires of PAPER-PORTFOLIO-EOD-DAILY. The homepage showed Saturday's brief past 07:15 ET on Monday, and NO rebalance orders were queued for the open until a manual dispatch at 07:28 ET. The self-heal never fired because it rides the SAME scheduler that failed. MONITOR-RECONCILE (cron `0 */6 * * *`) was the only morning schedule that fired.

**The rule:** Every workflow whose morning outcome Joe depends on (homepage brief, pre-open orders) must be reachable by BOTH: (a) a `workflow_run` chain off MONITOR-RECONCILE (different cadence, empirically survives block drops), and (b) the Vercel morning-ensure cron (`api/brief-ensure.js`, `45 10 * * 1-5`), which checks the LIVE outcome on a non-GitHub scheduler and dispatches whatever is missing. New morning-critical workflows get added to both paths at creation time. Redundant off-hour fires must be provably safe: in-runner window/calendar guards + idempotent effects + send-once email helper (per 4.12).

**Applies to:** Lead Developer + Data Steward — all schedule work.

---

### 5.3 (2026-06-30) — A disabled-then-re-enabled scheduled workflow does NOT resume its cron until a commit re-arms it; and the brief generator must never crash on an omitted optional key

**What happened:** The homepage froze a SECOND day running. Two independent faults, same symptom. (1) DAILY-BRIEF-WRITER was manually disabled during the 2026-06-29 incident and re-enabled — but GitHub did not resume its 06:15 ET schedule. Every run in its history was a manual dispatch; the cron silently never fired for three straight weekdays (Jun 26 / 29 / 30) while the rest of the repo's scheduled jobs ran normally that morning. (2) When force-dispatched to recover, the generator crashed: the model returned a valid brief but omitted the optional `movers` key, and `validate()` hard-required `movers` and aborted the whole publish — even though `main()` already had a `movers` fallback one line later. Because the self-heal reuses the same generator, the safety net would have crashed too.

**Rule:** (a) A scheduled workflow that has been disabled does not reliably resume on re-enable — you MUST push a commit that touches the workflow file on the default branch to re-register the cron, then confirm the next scheduled run actually fires (look for an `event=schedule` run in the run list, not just `workflow_dispatch`). Treat "every run in history is workflow_dispatch" as proof the schedule is dead. Prefer never disabling a critical producer; if you must, re-arm by commit in the same change. (b) A content generator for a user-visible surface splits its output keys into HARD (cannot render without) and SOFT (default to empty); a single omitted optional field must never abort the publish and freeze the page. Validate hard keys only, default the soft keys, and add one model retry. (c) A safety net that reuses the primary generator does NOT protect against a bug inside that generator — the freshness self-heal guards against a missing run, not a crashing run; both failure modes need coverage.

**Applies to:** Data Steward (schedule re-arm + freshness), Lead Developer (generator robustness).


---

### 5.4 (2026-06-30) — Exactly ONE generator emails the daily brief (homepage writer is email-off); and NO automation may depend on Joe's laptop or a scheduled task

**What happened:** After re-arming the brief writer and dispatching it to un-freeze the homepage, Joe got a SECOND "Market Brief" email. Two generators were emailing him daily: the established legacy routine (~06:45 ET to gmail + EY, subject "Market Brief - Month DD, YYYY") and the newer cloud DAILY-BRIEF-WRITER (subject "Market Brief - YYYY-MM-DD", gmail only). The writer's real job is to refresh the homepage file `public/daily_brief.json`; it was never meant to add a second email. The writer's dual EDT/EST sibling crons plus the self-heal could also each fire a send (the once-per-day-email trap, 4.12). Joe: "I dont want two emails daily." He also set a hard rule: "We never use scheduled tasks. NOTHING RELIES ON MY MACBOOK BEING OPEN."

**Rule:** (a) Exactly ONE generator sends the daily brief email. The homepage writer is EMAIL-OFF by default (`BRIEF_SEND_EMAIL` unset) and only updates the homepage file; the legacy routine remains Joe's single daily email. If the writer is ever promoted to sole emailer, the legacy routine is retired in the SAME change - never both live. (b) The writer is idempotent per day: if the published brief is already today's it does nothing (no model call, no commit, no email), so any number of runs collapse to one. (c) HARD RULE: MacroTilt automation runs ONLY in the cloud - GitHub Actions, Vercel cron, Supabase, Google Apps Script. NEVER a Cowork/Claude scheduled task, and NOTHING may depend on Joe's laptop being open. Anything needing a reliable clock uses a cloud scheduler.

**Applies to:** Data Steward + Lead Developer. All.

**Amendment (2026-07-22, Joe-approved):** The "never a Cowork/Claude scheduled task" clause has ONE approved exception: the "MacroTilt Daily X Chart" scheduled task, which runs entirely in Anthropic's cloud (Joe's laptop closed or open makes no difference) and produces a chart + caption Joe posts to X manually. The rationale of the rule — nothing depends on Joe's MacBook — is preserved. Site/data automation remains cloud-scheduler-only; no other Cowork scheduled tasks without Joe's explicit approval.

---

### 5.5 (2026-06-30) — `supabase_get_all` raises `SystemExit`, not `Exception`; and `except Exception` silently swallows the contract

**What happened:** `MASSIVE-TICKER-REFERENCE-BACKFILL` was failing for 12 days. Root cause: `fetch_priority_overlay()` iterated `("positions", "watchlist")`, but both tables had been renamed/removed. `supabase_get_all` raises `SystemExit(f"select {table} offset {offset}: HTTP {status} {body}")` on non-2xx responses. The function doc said "Falls through silently if either table read fails — priority is a nice-to-have, not load-bearing" — but `SystemExit` is a subclass of `BaseException`, not `Exception`, so `except Exception as e:` never caught it. The script exited 1 on every run, leaving `massive-ticker-details` red (7-day SLA) for 12 days without a failure alert triggering the stuck-red escalation.

**Rule:** Any error boundary that calls `supabase_get_all` (or any function that raises `SystemExit` as an error signal) MUST use `except BaseException as e:` (or `except (Exception, SystemExit) as e:`) if the intent is truly "silently fall through." `except Exception` does NOT catch `SystemExit`. Additionally: when renaming or removing a DB table, grep the entire codebase for the old name before merging — table references live in scripts, workflows, AND the PostgREST string literals that are invisible to type-checkers.

**Applies to:** Data Steward, Lead Developer.

---

### 5.6 (2026-07-03) — A weekday cron is NOT a trading-day calendar; every order-submitting job asks the exchange calendar first

**What happened:** July 4 2026 fell on a Saturday, so the exchange observed the holiday on Friday July 3 — a weekday. The paper rebalancer's Mon–Fri crons fired; its only guards were a time-of-day window and a signal-freshness check (both passed on a holiday, correctly by their own contracts), and it queued 11 at-the-open orders at the broker on a day with no session — parking them for Monday's open and emailing a "rebalance queued" summary on a market holiday. The CLOSE snapshot phase and the INTRADAY mirror both already had market-closed guards; the one phase that SUBMITS ORDERS was the only one without. A prior weekday holiday (Juneteenth 2026-06-19) masked the gap because the diff produced zero intents that morning.

**Rule:** Any job that submits, modifies, or cancels orders confirms TODAY (ET) is a trading session per the broker's calendar (`is_trading_session`, Alpaca `/v2/calendar`) before doing ANYTHING — before intent computation, before DB writes, before emails. Holiday/weekend → quiet no-op (INFO log only; Joe's inbox contract is per TRADING day, so a holiday sends nothing). Calendar unreachable → BLOCK and file a P1 (fail-safe matches the freshness gate). A `1-5` cron field is a weekday filter, never a market-calendar filter; the two are not interchangeable. When adding a market-closed guard to one phase of a multi-phase pipeline, audit the OTHER phases for the same gap in the same PR — this shipped because close/intraday got guards and the submit phase didn't.

**Applies to:** Lead Developer + Data Steward; every workflow that touches broker orders.

### 5.7 (2026-07-30) — A monitor must be able to tell "nothing to do" from "nothing happened"; if it can't, it is not a monitor, it is a false alarm on a timer

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

### 5.8 (2026-08-01) — A producer fired by other pipelines has no clock of its own; the day a file-writer becomes a sender, every trigger path becomes a send path

**What happened:** the morning brief emailed Joe at **2:00am ET on a Saturday**, recapping Thursday's close. The day before it had emailed him **twice**, at 2:18:29am and 2:20:15am ET. Joe: "I got a brief email at 2am Saturday morning about Thursday close information. Cmon man."

**Root cause:** DAILY-BRIEF-WRITER fires on its own 06:15 ET cron **and** on `workflow_run` completion of three other pipelines — added because GitHub's scheduler kept dropping this workflow's cron. One of those three, MONITOR-RECONCILE, runs `0 */6 * * *`, i.e. 06:00 UTC = **2:00am ET**, every day including weekends. For as long as the writer only wrote `public/daily_brief.json`, a 2am Saturday run was invisible: it rewrote a file. On 2026-07-30 that same script was made the emailer (`BRIEF_SEND_EMAIL=true`) to fix a separate accuracy incident — and every one of those trigger paths silently became a *send* path. Nothing in the script knew what day it was or what time it was. The duplicate pair had a second cause: the only guard against re-generating was "is the committed brief already dated today?", which two concurrent runs both answer "no" before either has pushed — harmless when the result was a duplicate commit, two emails once the result was an email.

**Rule:** (a) **Promoting a job to a sender is a re-scoping of every trigger that fires it.** Before adding a side effect that reaches a human, enumerate every path that can fire the job — cron, `workflow_run`, dispatch, self-heal — and ask what that side effect does on the worst one. A trigger list is part of the blast radius. (b) **A time-of-day artifact must assert its own calendar and clock.** A pre-market brief may only be built on an NYSE trading day and inside the morning window; it does not inherit correctness from the schedule that was *supposed* to fire it. Gate it in the code, not the cron, because the cron is not the only caller. (c) **A "force" flag used by a safety net must not bypass the calendar** — the self-heal sets `BRIEF_FORCE_REBUILD` on every run, so the calendar escape hatch is a separate flag (`BRIEF_IGNORE_CALENDAR`) reserved for manual dispatch. (d) **Idempotency by reading shared state is not a mutex.** "Has someone already done this?" answered by reading a file two runners are racing to write is a check-then-act bug; when the act is irreversible (an email, an order, a payment) the claim must be atomic — here a `brief_email_log` table whose primary key is the date. (e) A deliberate skip must be **distinguishable from a failure** to every downstream step, or the weekend no-op becomes a red build and its own alert email. (f) A day-of-week label is a calendar fact — compute it; the 8/1 brief called Friday July 31 "Thu Jul 31".

**Applies to:** Lead Developer — the daily brief, and every scheduled job that emails, posts, trades, or otherwise reaches the outside world.

### 5.9 (2026-08-06) — A runner shortage has two shapes; the alert suppressor only knew one, so a GitHub outage emailed Joe "Workflow FAILED"

**What happened:** Joe got `[MacroTilt] Workflow FAILED: PAPER-PORTFOLIO-EOD-DAILY` (run 31116873789, 15:39Z). Nothing in MacroTilt was broken. GitHub was having a platform-wide Actions/Pages outage that afternoon, and dozens of our runs across eight different workflows died without ever executing a line of our code.

The 2026-05-06 suppressor was written for the shape we had seen: no runner is ever assigned, GitHub cancels the job, `conclusion=cancelled` — suppress. That afternoon produced a second shape: a runner IS assigned, `Set up job` hangs waiting for the image, and after ~3-5 minutes GitHub marks **that step** failed and ends the job with `conclusion=failure`. At the job level this is byte-identical to a genuine code failure, so `any(job.conclusion=='failure')` waved it straight through. Two of the day's runs took that path and both emailed. The runs that failed *inside the pre-open trading window* all succeeded — the three failures were 11:10, 11:39 and 11:59 ET, outside the 03:00-09:25 ET accept window, so there was never any trading impact. The alert did not say that, and could not: it reports the workflow name and a link, nothing about what actually broke.

**Rule:**

1. **A job-level conclusion is not a diagnosis.** `conclusion=failure` answers "did this job end badly," not "did our code fail." The discriminating fact is *which step* failed: if the only failed steps are GitHub's own scaffolding (`Set up job`, `Set up runner`, `Complete job`), the runner never came up and nothing of ours ran. A genuine failure always fails a step a MacroTilt author wrote. Classification lives in `.github/scripts/classify_run_failure.py` with real captured payloads as fixtures in `tests/test_classify_run_failure.py` — extend it there, not with another inline `python3 -c` one-liner in YAML.
2. **A suppression rule written against one observed failure shape will meet another.** When suppressing infra noise, enumerate the shapes the platform can actually produce (cancelled / setup-failed / timed-out / mixed) and classify on the invariant — "did an author-written step run and fail" — rather than on the symptom that happened to be in front of you. Anything the classifier cannot place returns `ambiguous` and still alerts: over-alerting is recoverable, a silenced real failure is not (0.1, 4.14).
3. **An alert whose payload cannot distinguish its own false positives will be ignored.** Joe learned in May to distrust these emails because they cried wolf; that is exactly how a real red goes unread for days (the bug this alert was built for). Any future change to this alert must state, in the email, *which step* failed — not just the workflow name and a link.
4. **An out-of-window no-op that dies on infra is not an incident.** Before escalating any alert on the paper-portfolio chain, check the ET clock against the phase's accept window. A failure at 11:39 ET on a workflow that only acts between 03:00 and 09:25 ET has zero blast radius, and saying so is most of the answer.

**Applies to:** Lead Developer — `WORKFLOW_FAILURE_ALERT.yml` and every watchdog that grades a third party's status field as if it were our own.

### 5.10 (2026-08-11) — When generation moves out of a pipeline, the pipeline's old generator becomes a daily false alarm; "the input hasn't arrived yet" is a schedule, not a failure

**What happened:** Joe: *"Why am I getting these emails every day now?! I get two emails saying the daily brief writer failed and then I get the daily brief email."* On 2026-08-06 brief generation moved off the metered Anthropic API and into the weekday morning scheduled Cowork session, which commits the brief to `main` around 06:10 ET. DAILY-BRIEF-WRITER kept its old job description: if the committed brief is not today's, call the API. The workflow fires 2–3 times every morning off its `workflow_run` piggybacks (05:31, 06:04, …) — every one of those runs happens BEFORE the session's commit lands, falls through to the dead API call, exits 1, and mails a `Workflow FAILED` alert. Then the real brief email arrives at 06:25 and proves nothing was wrong. Two red emails a day, every trading day, for a pipeline that was working.

**Rule:**

1. **When you move a capability out of a pipeline, remove the capability — do not leave it armed.** A code path kept "just in case" against a dependency that is deliberately switched off is not a fallback, it is a scheduled failure. Gate it behind an explicit opt-in env flag (`BRIEF_ALLOW_METERED_API`) that defaults to off.
2. **A consumer that runs before its producer is early, not broken.** Give it a deadline (`BRIEF_EXPECTED_BY_HOUR_ET`), exit green before it, red after it. "Not here yet" and "never came" are different events and must produce different colours.
3. **An alert that fires on a healthy day trains Joe to ignore the channel.** Any alarm that has fired on a day nothing was wrong is a bug in the alarm — fix the alarm the same day, do not filter the mail.

**Applies to:** Lead Developer, Data Steward — every workflow that consumes an artifact another process produces on a schedule.

### 5.11 (2026-08-11) — Redeploying an edge function resets its platform auth gate; a function that does its own auth must be redeployed with `verify_jwt: false`, every time

**What happened:** to give the Conviction book a backup dispatch path, I added two workflows to `trigger-workflow`'s allowlist and redeployed it. The deploy succeeded and returned `"verify_jwt": true` — the tool's default. That function authenticates its callers itself, with a `TRIAGE_WEBHOOK_TOKEN` bearer check, because its callers are pg_cron jobs sending an opaque token rather than a JWT. With the platform gate on, the Supabase gateway rejected the very next call with `401 UNAUTHORIZED_INVALID_JWT_FORMAT` before a line of the function ran. For roughly two minutes, every pg_cron backup that routes through it was disarmed at once — paper intraday, indicator refresh, universe snapshots, MASSIVE-DAILY, LSE-ARCHIVE-IV, the EDGAR insider ingest, and the two Conviction jobs I was in the middle of adding. Caught because I tested the path instead of trusting the deploy: `net._http_response` showed 401, and the three calls immediately before mine (20:35, 20:45, 20:50 UTC) showed 200, which dated the regression to my own deploy. Redeployed with `verify_jwt: false`; both paths verified 200 again.

**Rule:**

1. **`verify_jwt` is not remembered — it is re-declared on every deploy.** Any function whose callers are pg_cron, a webhook, or anything else without a Supabase JWT must be redeployed with `verify_jwt: false` explicitly. The safe default is wrong for this class of function, and it fails at the gateway where the function's own logs never see it.
2. **Say so in the function's header.** `trigger-workflow` now carries a DEPLOY WITH verify_jwt=false note at the top, because the next person to touch it will hit the same default.
3. **After deploying anything a cron calls, call it the way the cron calls it.** A 200 from the deploy API says the bundle uploaded, nothing about whether the caller can still reach it. One `net.http_post` and one read of `net._http_response` is the whole test.
4. **When you find a break, look at the rows just before yours.** The three 200s at 20:35/20:45/20:50 turned "something is wrong" into "I broke this ninety seconds ago" without guesswork.

**Applies to:** Lead Developer — every `deploy_edge_function` call on `trigger-workflow`, `gh-push`, `submit-bug-report`, or any other function with its own auth.

### 5.12 (2026-08-13) — A deadline set inside the producer's arrival spread manufactures a daily failure; and an alerter without a send-once claim turns one broken thing into an inbox full

**What happened:** Joe, on the fifth time of asking: *"Are you not capable of fixing this? … I have been getting them for a week now! Several emails daily. FIX IT PLEASE"* — daily `[MacroTilt] Workflow FAILED: BRIEF-FRESHNESS-SELFHEAL` emails, every weekday, at ~07:04 ET.

Two independent defects, both introduced by the fix for 4.25 and neither caught because that fix was verified against DAILY-BRIEF-WRITER only:

1. **The deadline was set on top of the producer's arrival spread, not after it.** 4.25 added `BRIEF_EXPECTED_BY_HOUR_ET = 7`: before 07:00 ET "the brief isn't committed yet" exits green, at/after 07:00 it exits 1. But the producer is the morning scheduled session, and its commit time is a *distribution*, not a point — 06:12 ET on 8/11, **07:20 ET on 8/12**. BRIEF-FRESHNESS-SELFHEAL's 11:03Z cron lands at 07:03 ET, i.e. reliably inside the gap. Every weekday it found no brief, hit the FATAL, and emailed Joe a failure for a brief that arrived healthy seventeen minutes later. Confirmed from run history, not inferred: 8/13 run 31693873038 and 8/12 run 31590138378 both failed at 07:03-07:04 ET on the step `Check live brief is current; regenerate + alert if stale`, and on 8/12 every run after the 11:20Z brief commit passed.
2. **The alerter had no send-once claim.** 4.12 mandated one email per type per ET day for *notification* emails, and the rule was never applied to WORKFLOW_FAILURE_ALERT itself. The self-heal fires every 30 minutes from 06:00-11:30 ET as deliberate scheduler redundancy; on a morning where the brief genuinely never lands, that is up to nine identical "Workflow FAILED" emails for one broken thing.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A deadline grades a producer, so measure that producer's arrival spread before choosing it.** Pull the last N commit timestamps and put the deadline after the observed maximum with margin — never on the mean, and never on the time the producer is *supposed* to run. A threshold inside the spread is not a monitor, it is a scheduled false alarm. (Now 09:00 ET, env-overridable, one hour of margin before `EMAIL_UNTIL_HOUR_ET`.)
2. **One deadline constant, imported, never duplicated.** `brief_selfheal.py` had its own hardcoded `7` alongside the writer's. Two eyes on one deadline means two readers of one constant.
3. **Every alerter gets a send-once claim, keyed atomically.** 4.12 applies to alert emails, not just notification emails — an alerter is the *most* likely thing to be attached to a job that fires on a redundant timer. `public.workflow_alert_log`, PK `(workflow_name, ET date)`, 409 = already sent. Fail-open: a duplicate is an annoyance, a swallowed alert is how #1077 hid for three days.
4. **An alert may only describe what it actually did.** "Auto-fixed" is a claim about an action; assert it from the callee's return value, never from control flow reaching the next line. `bdb.main()` now returns its status and the self-heal alerts only on `"generated"`.
5. **When a fix targets a shared module, verify every caller of that module, not the one that prompted it.** 4.25 changed `build_daily_brief.main()` and was verified by dispatching DAILY-BRIEF-WRITER. BRIEF-FRESHNESS-SELFHEAL imports the same function, on a different schedule, and inherited the bug for two days. The blast radius of a shared-module change is its import graph.
6. **Joe asking the same question five times is the finding.** Four prior passes each fixed the workflow that was named in the email subject. Nobody asked "why is this arriving *every day at the same minute*" — a fixed-time recurrence is a schedule interacting with a threshold, essentially never a flaky job.

**Applies to:** Lead Developer — every freshness deadline, every alerting workflow, and every change to a script that more than one workflow imports.

### 5.13 (2026-08-13) — A publisher whose base branch moves under it needs a retry, not a report; and delete-then-recreate of a branch closes the PR you are about to merge

**What happened:** the 06:00 ET morning brief session composed Thursday's brief, passed `--prepare-file`, and POSTed it to `agent-write` with `merge: true`. GitHub rejected the squash-merge with `405 {"message":"Base branch was modified. Review and try the merge again."}`. `agent-write` had no retry: one 405 and the whole call returned `ok:false`, with the brief unpublished. The cause is not exotic and is not rare — `main` moves several times every weekday morning under the repo's own automation (`Indicator history auto-refresh`, `Index breadth (% > 50d/200d EMA) refresh`, both `[skip ci]`), and the publish window sits inside that spread. Two of those commits landed between the PR's merge-base and the merge call.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A write path that races a moving base branch retries the merge; it does not report a race as a failure.** `agent-write` now loops up to 4 attempts, re-resolving `main`'s head on EVERY attempt (the point is that it moved), with short linear backoff. Retry only on failures a retry can clear — `Base branch was modified`, `not mergeable` / `mergeable state` (GitHub still computing), and 409. A genuine conflict or a permissions error must surface immediately, not spin.
2. **Never delete a ref to make branch creation idempotent.** Deleting closes open PRs on that ref and turns the retry into a different error. Create the ref, and on 422 (already exists) `PATCH` it to the new sha with `force: true`. The branch fast-forwards, the PR survives and re-points.
3. **Find-or-create, never create-and-hope, for any PR the caller may submit twice.** List `state=open&head=owner:branch` first, and treat a 422 on create as "list again" rather than as fatal.
4. **Grade a publisher against the arrival spread of the thing it writes into, not just its own runtime.** This is 4.28's lesson pointed the other way: 4.28 was about a *reader's* deadline landing inside the producer's spread; this is a *writer's* merge landing inside its own repo's automation spread. Both are a schedule interacting with another schedule, and neither is a flaky job.
5. **`ok:false` from a write helper is a claim about one attempt until the helper says otherwise.** The response now carries `attempts`, so a caller can tell "raced once, succeeded" from "never worked" without reading logs.
6. **Redeployed with `verify_jwt: false`** — 4.27 applies to `agent-write` too; it does its own `TRIAGE_WEBHOOK_TOKEN` bearer check and its caller sends an opaque token. The header of the function now says so.

**Open item, not fixed here:** `agent-write`'s source lives only in the deployed function — it is not in this repo, because the path allowlist (`src/`, `LESSONS.md`, `public/daily_brief.json`) deliberately cannot write `supabase/functions/`. That means the file just changed has no version-controlled copy and no review trail beyond this entry. Widening the allowlist is a permissions decision for Joe, not a cleanup to slip into a fix.

**Applies to:** Lead Developer — `agent-write`, `gh-push`, and every helper that commits-and-merges on a branch that automation also writes to.

### 5.14 (2026-08-13) — A calendar somebody has to re-type is wrong most months; and a homepage tile whose empty state is a full sentence hides its own outage

**What happened:** Joe: *"We have to improve our data (for example, PPI comes out today yet our upcoming data is blank)."* He was right, and the blank was two weeks old. The homepage "Upcoming data" tile read from `src/overhaul/lib/econCalendar.js` — a hand-typed `CURATED` array whose last entry was `2026-07-31`, plus a computed weekly jobless-claims generator. The tile deliberately skipped any date whose only event was jobless claims, so from **2026-08-01 onward it rendered "No scheduled releases coming up." on every single day** — through the August jobs report, through CPI on the 12th, and on the morning of the 13th while PPI was an hour from printing. Nothing alerted, nothing reddened, no chip existed: the tile had no feed behind it to be stale, so no freshness machinery could grade it. The June 2026 build spec had called the calendar "the genuinely new piece" and shipped the placeholder instead; the placeholder then aged out in six weeks.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Anything dated that renders to a reader is a FEED, or it is a bug waiting for a date.** If a surface shows scheduled or time-varying content, it gets a producer script, a `data_manifest.json` entry, a `pipeline_health` row and a chip — on the day it ships, not when it breaks. A hardcoded array is acceptable only for values that are definitionally constant (release *times*, band thresholds), never for values that roll forward.
2. **The producer fails loudly rather than publishing an empty artifact.** `build_econ_calendar.py` exits 1 if fewer than three major releases land in a ten-week window: that is a broken fetch, not a quiet season, and the last good file keeps rendering. "Zero results" from a fetch is a hypothesis about the fetch first and the world second.
3. **An empty state names the reason, never just the absence.** "No major releases scheduled in the next ten weeks" (the data says so) and "The release calendar did not load" (the fetch says so) are different sentences, and the reader is entitled to know which one they are looking at. Companion to the 2026-07-30 empty-state rule: name the offending row, its value and the threshold.
4. **Do not derive a field the source does not carry.** The release calendar publishes the DATE a report lands, not the month it covers, and that lag is not uniform — the jobs report on the 4th covers last month, factory orders on the 2nd covers the month before that. The old tile printed "CPI (Jun)" by hand. The feed prints no reference period at all, because a derived one is wrong for a whole class of releases. Sourced-or-omitted (4.21a) applies to labels, not just to numbers.
5. **When one source bundles two reports, prove the split before shipping it.** FRED release 95 carries both the advance durable-goods report and factory orders, and 27 carries new residential construction twice. The pair rule (late-month entry, then early-next-month entry) was verified over 99 dates across 2023–2026 before it was applied, and where a date does not pair the honest release-family label is used instead of a coin flip. A clever heuristic that has not been run against history is a guess with better typography.

**Also shipped in the same change, and worth its own line:** `ops-code-commit` could write and replace files but never **delete** one, so a cloud session could retire a module and was then forced to leave the corpse in the tree. Dead source invites a future session to "fix" it. File entries now accept `{path, delete: true}` (`sha: null` against the base tree), governed by the same path allowlist — it widens what may be done to a path, never which paths. Redeployed with `verify_jwt: false` per 4.27.

**Applies to:** Lead Developer, Data Steward — every dated surface on the site, and every "we'll curate it by hand for now" shortcut.

### 5.15 (2026-08-18) — Two brief emails a day for twelve days, and I cleared the duplicate generator on a one-day sample

**What happened:** Joe: *"I got two daily brief emails today. Why?"* He had been getting two every weekday since ~2026-08-06. On 8/18 they arrived 09:50:41Z and 10:45:33Z; on 8/17, 09:52:32Z and 10:47:33Z. Identical subject (`Market Brief — YYYY-MM-DD`), different bodies, ~55 minutes apart.

Two generators, exactly the thing LESSONS 4.14 forbids:
- **10:45Z** — `build_daily_brief.py` via DAILY-BRIEF-WRITER. Branded HTML, `&#8227;` bullets, and a matching `brief_email_log` row every day (8/18 → run 32128325043 at 10:45:32.94Z, to the second). This is the hardened, version-controlled generator. **Keeper.**
- **09:50Z** — the legacy `Daily Market Brief` scheduled task (cron `45 9 * * 1-5`). Plain-text, `- ` bullets, **no `brief_email_log` row**. Its prompt is not in version control and it is the generator that shipped fabricated claims in LESSONS 4.21. **Must die.**

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Never clear a suspected duplicate sender from a single day's inbox.** Attribute across a window (here 3+ days), and attribute each message to a sender by evidence — a ledger row, a distinctive body marker, an arrival time matching a known cron — not by counting how many arrived. `brief_email_log.sent_by` identified the keeper to the second; the absence of a row identified the other.
2. **A day when the thing you are comparing against is broken is not a sample.** Before concluding "X sends nothing", confirm the *other* sender behaved normally that day. I had the evidence in hand — I fixed the workflow's crashed send myself an hour later — and did not connect it.
3. **Not deletable is not the same as not harmful.** The legacy task is `created_via: http_api`, so `delete_trigger` and `update_trigger` both refuse and its own session has no trigger tools. That made it inconvenient to kill, which is exactly why "it's harmless" was an attractive conclusion. Inconvenience must not colour the finding.
4. **State where the user has to go.** A routine invisible in the surface the user is looking at (it is absent from the desktop Cowork task list) needs a named alternative location, not "check your tasks".

**Applies to:** Lead Developer — every duplicate-notification investigation, and any claim that a component is inert.

### 5.16 (2026-08-18) — A bare `git push` in a repo that commits hourly is a scheduled failure

**What happened:** `macrotilt-engine-daily` failed 2026-08-17 (run 32063212545) at `Commit snapshot + history if changed`, and emailed Joe. Compute, contract check and history check were all green — the only thing that broke was `git push`, because another workflow landed a commit between our checkout and our push. This repo commits several times an hour from data pipelines, so the race is not an edge case, it is the expected condition.

Four workflows still had an unguarded bare `git push`: `macrotilt-engine-daily`, `BRIEF-FRESHNESS-SELFHEAL`, `CONVICTION-OPEN-DAILY`, `REPO-TREE-DUMP`. Others already carried `git pull --rebase origin main` before pushing — the pattern existed and had simply never been applied everywhere.

**Rule:** every workflow that pushes retries: rebase onto whatever landed, push, and repeat up to 5 times before calling it a real failure. `pull --rebase` alone is better than nothing but still races between the rebase and the push — the loop is the fix. When a defensive pattern already exists in the repo, applying it to ONE new site is half a fix; grep for every other site in the same change.

**Applies to:** Lead Developer — every workflow step that writes to the repo.

### 5.17 (2026-08-18) — A watchlist matched on names nobody ever checked is a list, not coverage; and a failed step leaves evidence you can read without the log

**What happened:** the weekday sweep opened on MONITOR-RECONCILE red four runs in a row — 8/17 18:26Z, 8/18 00:44Z, 06:28Z, 12:27Z, nineteen hours — with **no `workflow_failure_log` row, no escalation and no email**. Nobody suppressed it. It was never being watched: MONITOR-RECONCILE is not on the `workflow_run` trigger in WORKFLOW_FAILURE_ALERT, and neither were 24 of the other 41 scheduled workflows. That trigger is not just the email path, it is the RECORDING path — a workflow absent from it fails into silence, which is the exact shape of #1077 (the freshness watchdog went down on a Friday night and we found out on Tuesday), still open across more than half the schedule fourteen weeks after the alerter was built to close it.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A list of names is not coverage until something resolves the names.** `scripts/test_workflow_alert_watchlist.py` now asserts, in PR-CONTRACT-CHECK, that every watchlist entry resolves to a real workflow `name:` and that every scheduled workflow is either watched or in an explicit `UNWATCHED_BY_DESIGN` set with the reason it is switched off. It fails with 29 findings against the 8/18 state. Any configuration keyed on a string that lives somewhere else — a workflow name, a secret name, a column, a series key — is a silent no-op waiting to happen, and only a test that dereferences the string can tell coverage from theatre.
2. **On this trigger means RECORDED; VISIBLE means emailed. Never conflate them.** Adding the 24 missing workflows costs Joe nothing in his inbox — the tiering added on 2026-08-14 already routes background jobs to "recorded, escalate only after failures on 2+ separate days". "It would be noisy" is an argument for the right tier, never for no coverage at all.
3. **A guard is half a guard until its own failure is loud.** Ask of every new watchdog: what watches THIS? MONITOR-RECONCILE is the thing that keeps every freshness chip on the site honest; had it stayed down, the whole site could have gone stale-but-green with the header still reading "All feeds current".
4. **Before theorising about a failing step, look for what the step left behind.** A pushed branch, a written file, a table row, an uploaded artifact — each is a checkpoint that partitions the step into "before" and "after". Checking `git ls-remote` for the branch converted "the PR step is broken somehow" into "the push worked, `gh pr create` did not" in one command, with no log access at all. Read the artifact first; reach for the log second.
5. **A dated exemption outlives its date unless something deletes it.** `UNLISTED_UNTIL_UW_LAPSE` promised to empty at the 2026-08-12 Unusual Whales lapse and was still carrying the two dead UW rows six days later. The UW rows are now in `RETIRED_FEEDS` (retire a watcher of a vendor we no longer buy — never "fix" it), and the remainder is renamed `UNREGISTERED_LIVE_FEEDS`, which describes what it holds rather than a promise about when it will be empty.
6. **One clock, one reader — and that is not only about deadlines.** 4.28 rule 2 said a deadline constant is imported, never duplicated. The same applies to any rule two surfaces state in words: a market state, a threshold, a label. The second copy does not announce itself when it drifts; it just contradicts the first one somewhere the author is not looking.

**Applies to:** Lead Developer — every alert watchlist and cross-file name reference, every new feed's manifest entry, and every rule rendered in more than one place.

### 5.18 (2026-08-18) — A deadline on a feed that only refreshes when somebody looks is measuring quiet, not health

**What happened:** mid-sweep, the site header read **"1 feed stale · Live intraday price (1-minute bars)"** at 14:41 UTC — and read "All feeds current" sixteen minutes earlier and eleven minutes later. Nothing was broken at any point in that window.

`lse_intraday` is stamped by the `lse-live` edge function in `mode: "quotes"`, which runs **on view**: it fires when somebody loads a page that asks for quotes. So `last_good_at` recorded *when a human last looked*, not when a producer last ran — and it was graded against a **3-hour pull SLA**, with `market_hours_only` narrowing the gradeable window to 11:30-16:00 ET. Three quiet hours inside a trading session is not an outage; on a site with one reader it is a Tuesday. The stamps prove it: a pull at 10:42Z, nothing until 13:41Z, red in between.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Before setting a freshness deadline, ask what actually refreshes the thing.** If the answer is "a visitor", there is no producer and a pull clock is measuring attention. Give it a scheduled heartbeat and grade THAT, or do not grade it on a pull clock at all.
2. **Derive the number from the heartbeat, then check both ends.** 21:50 UTC is 17:50 ET, so on a day with no visitors the pull is ~17.7h old when grading resumes at 11:30 ET and ~22.2h at the 16:00 ET close. 30h clears that worst gradeable moment with margin for a late heartbeat and for DST, and one MISSED heartbeat still crosses 41h by the next 11:30 ET. A deadline is only justified when you have shown it passes the quiet case AND fails the broken case — I verified seven scenarios against a frozen clock, and an earlier draft at 49h passed the first four and silently swallowed a five-day outage.
3. **A symptom that its own observation clears is a reproduction problem, not a small problem.** Freeze the clock, or inject the aged row, and make it fail on demand. "I could not reproduce it" and "it heals when I look" are the same sentence.
4. **Diff the deployed function against the repo before redeploying it.** `lse-live` v10 in production carried a v8 header comment this repo did not, so the version-controlled copy was not quite the source of record and a redeploy would have dropped it. It was only a comment this time. It was `agent-write`'s entire source in 4.29.

**Applies to:** Lead Developer, Data Steward — every on-demand / on-view feed, and every `market_hours_only` chip.

---

### 5.19 (2026-08-19) — A guard that outlives the formula it guards is a scheduled false alarm; and a gate scheduled against a producer's *believed* run time grades yesterday

**What happened:** the weekday health sweep found SCAN-INVARIANTS-DAILY red for 2026-08-18 on one row:

**The data was correct and the gate was wrong.** `check_scan_invariants.py` was written 2026-06-01 against the five-component score of that day. On 2026-07-07 the Conviction-Insider rebuild SHELVED dark-pool and options from the score as unvalidated — `run_screener.py` says so in a comment, `src/overhaul/lib/scoreWeights.js` (the single source of truth the drill-down renders from) says so in its header, and the score ceiling dropped from 10 to 5. The gate was never told. It kept passing for six weeks purely because `options_pts` and `dark_pool_pts` are 0 on a typical day; KURA was the first row where an *informational* column was non-zero, and a healthy pipeline went red. 4 + 1 − 2 = 3 = the score. Nothing was broken.

*Full write-up in LESSONS_EVIDENCE.md.*

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

### 5.20 (2026-08-20, merged 2026-09-01 from 4.51 and 4.52 — 4.51's root cause was disproved by 4.52 one day later and is archived) — Before writing "the evidence is unavailable", check whether you shipped the tool that provides it

**What happened:** the weekday sweep classified a daily scan's 8/17 failure as transient — green before, green after. It came back on 8/19. Pulling thirty runs instead of six turned a shrug into a signature: three of the four runs landing in one sixty-second slot had failed, and the other twenty-six runs, spread across eight other slots, had not. Six runs said flake; thirty said schedule.

I then stopped, wrote it up as an open item, and recorded a runner-concurrency collision as the unconfirmed suspect — on the stated grounds that *"cloud sessions cannot read Actions logs."* **That sentence was false when I wrote it.** The entry directly above it, shipped the day before, had added log reading for exactly this purpose, and said so in its own text. One call returned the answer: not runner concurrency at all — the database. The chained run lands while the price ingest is still writing the table the scan reads, and the query blows the database's statement timeout.

The real defect the log exposed was the retry: it backed off four seconds, then eight, against contention that lasts minutes. All three attempts fell inside one window. **Three attempts four seconds apart are not three chances; they are one chance taken three times.** Busy-class errors now back off 45s / 150s / 300s under a total budget so the job can never spin past its own timeout and sit on the concurrency group.

The same sweep found a second red: a feed's health row had been frozen for seven days at the value written when it was registered, and the site's header was telling every visitor "1 feed stale" while the content beside it rendered perfectly. The watchdog had no source mapping for the row, so it hit the anti-clobber guard — *"if this watchdog has no mapping, do not overwrite; another producer owns this."* **But no producer owned it.** Anti-clobber faithfully preserved a stamp nothing would ever refresh. It was the fourth row of that exact shape.

**Rule:**

1. **"Green before and after" earns a wider window, not a dismissal.** The transient/real call is only as good as the sample behind it. When a failure recurs at all, re-pull enough history to see whether the failures share a clock face before classifying it again.
2. **A fixed-time recurrence is two schedules interacting, never a flaky job** — and that includes chained triggers, not just clock schedules. Find the other schedule.
3. **Before writing "the evidence is unavailable", check whether you shipped the tool that provides it.** A capability added in one entry has to be used by the next one. The cost of not checking was a wrong root cause published as a suspect and a real defect left live for a day.
4. **Anti-clobber needs a named owner, or it is just rot.** "Some other producer stamps this" is a claim, and it is checkable: no fetch-log rows plus a last-good time equal to the row's creation time means *nobody* stamps it. **A health row with no writer is worse than no health row: it is an alarm that can only ever be wrong.** Registering a row without wiring its writer in the same change is forbidden.
5. **A retry has to outlast the thing that broke it.** Size backoff against the *measured* duration of the failure condition, never against a round number. Bound total patience explicitly whenever the job holds a concurrency group.
6. **An honest open item beats a confident fix** — but only after the available evidence is actually exhausted. Record the signature, the failing step, and exactly what is missing.
7. **Look at the page, not the row.** Every sweep before this one read the health table and stopped. Loading the site is what turned "one row is red" into "the site is telling every visitor it is stale."

**Applies to:** Lead Developer — every retry loop, every health row at the moment it is registered, every transient classification made from a short window, and every sweep that grades the database instead of the page.

### 5.21 (2026-08-27) — A safety net that grades the artifact cannot catch a failure of the delivery; and a backup that runs on the same scheduler as the thing it backs up is not a backup

**What happened:** the weekday sweep found that at 07:09 ET Joe had received **no** Market Brief email — `brief_email_log` had no row for 2026-08-27, `brief_email_failures` had none either, and Gmail returned zero. Nothing was broken. Every piece worked; the piece that *sends* simply never ran.

Read, not inferred. `DAILY-BRIEF-WRITER`'s six most recent runs were all `event: workflow_run` (00:05, 00:27, 03:01, 06:21, 06:47 UTC) — GitHub silently dropped today's `15 10 * * 1-5` schedule fire, the 4.13 / 4.17 pattern again. Those chained runs all succeeded and all correctly declined to send: `send_email` gates on `BUILD_FROM_HOUR_ET <= hour < EMAIL_UNTIL_HOUR_ET` (05:00–10:00 ET) and every one of them landed before 05:00 ET. The morning writer session committed a perfectly good brief at 10:19 UTC. So the artifact was current, the workflow was green, and the email did not exist.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Grade the OUTCOME the reader experiences, not the artifact behind it.** The brief's outcome is an email in Joe's inbox. A guard on `daily_brief.json` proves a file was written and proves nothing about whether anyone was told. For every delivered surface, name the row that records delivery and watch *that*.
2. **A backup must not share a scheduler with its primary.** GitHub Actions cron is best-effort and drops fires; a GitHub-cron backup for a GitHub-cron job adds redundancy against the job and none against the scheduler. Backups live on `pg_cron` (or another independent trigger), always.
3. **A backup guards on the outcome row, not on a proxy for it.** `trigger-workflow`'s generic "did this workflow succeed in the last 90 minutes" dedupe is the wrong question here — this workflow succeeds several times a day without sending anything. `not exists (select 1 from brief_email_log where brief_date = today_et)` is the exact question, is idempotent, and composes with the send-once claim already inside the sender so a double fire still cannot double-mail.
4. **Both DST slots or neither.** UTC cron plus an ET business window means a backup pinned near the primary is correct for half the year. Pick times that stay inside the window under both offsets, or write two crons and say which is which.
5. **"Zero emails" is a diagnosis with three branches, and they are distinguishable without guessing** — the send failed (`brief_email_failures` has a row), the send was suppressed (`brief_email_log` has a row and no mail arrived), or the sender never ran (neither table has a row, and the workflow's run list has no `schedule` event for today). Check all three before touching anything; today it was the third and no amount of fixing the sender would have helped.

**Also in this pass:** `QT-FUNDAMENTALS-REFRESH.yml` added to `ops-code-commit`'s `DISPATCHABLE` set. Its 8/26 failure was fixed the same day (4.53), but the workflow is **monthly** — the fix could not have been exercised until 9/26, and `qt_fundamentals` would have sat at `filed <= 2026-08-12` straight through the 9/01 Quality Trend rebalance that scores off it. A monthly job that fails is repaired *and re-run* the day it fails; a fix that cannot be run is a hope with a commit sha.

**And one found by looking at a workflow with NO reds at all:** `QT-REBALANCE` has never run — zero runs in its entire history against a `0 13 1-4 * *` cron — because it landed mid-August, after its August window, and the live book was opened by hand through `QT-PLACE-ORDERS` on 8/14 and 8/17. Its first scheduled fire is **2026-09-01**, which is the new book's launch day, and 4.13 / 4.17 says GitHub silently skips a new workflow's first scheduled fires. A sweep that only reads red misses this entirely: an empty run list is not a green streak, it is an untested schedule. `QT-REBALANCE.yml` is now dispatchable (it scores only — writes `qt_target_book`, places no orders by design), so a skipped fire on 9/01 is one call rather than a launch-day re-implementation of the scorer.

**Applies to:** Lead Developer — every scheduled delivery, every safety net, every "the workflow is green" that has not been checked against the thing the reader actually receives, and every workflow whose run list is EMPTY.

### 5.22 (2026-08-28) — A retirement that stops at the decision leaves the machine running; and a book is the account that held something, not the newest account number

**What happened:** the weekday sweep loaded macrotilt.com and the header read **"1 feed stale"**, then loaded `/paper` and found it publishing, in the present tense, for a strategy Joe had retired two days earlier:

> PAPER PORTFOLIO · **LIVE** · marks sync every 10 min · **Since inception 0.00% · vs S&P 500 +0.76%** · Quality Trend — **live since Aug 17, 2026**

Every one of those numbers was false. Quality Trend's real record is **−6.45%** over Aug 17–25 on account `PA3G9FV5AN1G`, which Joe closed on 8/25; he retired the strategy outright on 8/26 (`paper_portfolio/TACTICAL_BOOK_SPEC.md`, whose own build order says *"Site: retire the Quality Trend framing on /paper — not optional"*). The public page was claiming a flat book and three quarters of a point of alpha that no account ever earned.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A retirement is not done when the decision is recorded. It is done when nothing is left that can still act.** Before closing one, enumerate what the retired thing OWNS — workflows, pg_cron jobs, edge functions, `pipeline_health` rows, `data_manifest.json` entries, alert watchlists, dispatch allowlists, page copy — and delete all of it in the same change (0.10). A spec file that says "retired" while the cron still fires is documentation, not retirement. This one owned eleven things and the retiring commit touched one of them.
2. **Identify a book by what it HELD, never by which row is newest.** A funded-but-never-traded account produces flawless rows and is not a book. The selection is now data-keyed — newest epoch containing any row with `n_positions > 0` — so an account that never held a share can never become the record, whatever its number or date. Companion to 4.53 rule 4: date-keyed gates expire on their own, but only a data-keyed one survives the plan itself being cancelled.
3. **An inception date and a benchmark baseline belong to an epoch, so read them off it.** Hardcoding either survives the account it describes and then silently re-labels the next one. `bookRan` and every "since" figure now come from the rows being shown; the page has no book dates in it at all.
4. **A number stated by the rendered page is a claim you are making.** "0.00% since inception" and "+0.76% vs the S&P" were arithmetic on mismatched sources — right formula, two different books — and no test, health row or SQL query could see it, because every input was individually valid. Only loading the page catches this class (0.12), which is why the sweep loads it.
5. **When you write a lesson predicting a failure, close it in code the same day or file it as an open item with a date.** 4.53(b) predicted this in prose, the prose was correct, and prose does not select an account.

**Repeat, mirrored (2026-09-01):** rule 1 cuts BOTH ways — an un-retirement must also be reversed from the retirement's own footprint, item by item. The relaunch restored workflows, health rows, cron and manifest entries, but not the alert watchlist: `WORKFLOW_FAILURE_ALERT`'s trigger list and VISIBLE set still carried the 8/28 removals, so the relaunched book's first custody-check failure (Sep 1, 21:41 UTC — itself a false alarm from a backfilled snapshot's write-time timestamp) was neither emailed nor even recorded. Restored the four QT entries to trigger list, VISIBLE, and the plain-English copy map. Before declaring a restore done, diff the retiring commit and account for every file it touched.

**Applies to:** Lead Developer, Data Steward — every retirement, every page that renders one book out of several epochs, and every hardcoded inception, baseline or launch date.

### 5.23 (2026-08-28) — Every trigger on the "reliable path" fired, all five were green, and not one of them could ever have sent the email

**What happened:** the weekday sweep found **zero** brief emails for 2026-08-28 — no `brief_email_log` row, no `brief_email_failures` row, and `DAILY-BRIEF-WRITER` showing five consecutive **successful** runs that morning. Every surface a monitor could look at was green.

The five runs fired at 04:31, 05:06, 06:04, 08:13 and 08:38 UTC and every one printed `brief status: skipped_too_early`. `build_daily_brief.py` refuses to touch "today's" brief before **05:00 ET** (`BUILD_FROM_HOUR_ET`), and 08:38 UTC is 04:38 ET. The workflow's own `10:15 UTC` cron — the one path that lands inside the window — was dropped by GitHub again (4.13 / 4.17). So the brief was written to the site on time by the morning session (10:12 UTC) and nobody was told.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A trigger has to land inside the window of the thing it triggers, and that is a fact you measure, not assume.** Before adding workflow B as a backup trigger for workflow A, compare B's observed *completion* times against A's own guards. Same clock, both numbers written down. "B is reliable" and "B is useful here" are different claims, and only the second one matters.
2. **A green run that did nothing is not evidence the path works.** `skipped_too_early` five times is a healthy exit five times and an untested channel. When a job's success is compatible with total inaction, exercising it proves nothing — grade it on the OUTCOME row (4.54 rule 1), which here is `brief_email_log`, not on the run's conclusion.
3. **A retired name in a redundancy list is worse than a short list, because it is counted.** `PAPER-PORTFOLIO-EOD-DAILY` sat there for two weeks after retirement, making a two-entry list look like three. Same shape as 4.41 (a watchlist matched on names nobody checked): a retirement deletes the name from every list that names it (0.10).
4. **The independent-scheduler backup is the one that actually held.** `pg_cron` at 12:20/13:20 UTC (4.54) was the only mechanism left standing today; a third, earlier slot at 11:40 UTC now restores the normal arrival time. Both sit after the producer's observed commit spread (10:12–11:20 UTC) and inside the 05:00–09:59 ET send window under both offsets. Chosen from measured history, per 4.28 rule 1.

**Applies to:** Lead Developer — every `workflow_run` backup trigger, every redundancy list, and every job whose "success" includes doing nothing.

### 5.24 (2026-08-31) — A column the query never asked for is a feature that never ran; and `cancelled` is where a genuine failure goes to hide

**What happened:** two independent silent failures, found on the weekday health sweep, neither of which had ever raised a red anywhere.

**(a) The deliberate-skip suppressor had never once suppressed anything.** At 07:00 ET Joe got two emails one second apart about the same row: *"Trade Idea notes has stopped updating"* (last updated 5 days ago) and *"Trade Idea notes still not updating after 8 days"*. Both were false. The Trade Idea writer had run that morning at 09:20Z, looked, and deliberately published nothing, recording a five-paragraph reason in `pipeline_health.last_skip_reason` — exactly the case the 2026-08-26 skip-awareness change was built to keep out of his inbox.

*Full write-up in LESSONS_EVIDENCE.md.*

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



### 5.25 (2026-09-01) — A reorganisation built on a stale base silently reverted two merged entries, and nothing noticed

**What happened:** two LESSONS entries were written, merged to `main` and reported as shipped on 2026-08-31 and 2026-09-01 — one recording a regression on 0.7, one recording the unswept bug queue. Neither is in the file. A later reorganisation of LESSONS.md renumbered the whole document from a base that predated both merges and wrote the result back wholesale, taking both entries out. No conflict was raised, because the reorg replaced the file rather than editing around them. It was found only because the next session went looking for its own entry by text and could not find it.

This is 0.3 — never commit a repo file from a stale copy — arriving through a path 0.3 does not obviously cover: not a stale local checkout, but a stale *in-memory* version of a file that several jobs and sessions append to every day. LESSONS.md is the highest-traffic append target in the repo, which makes it the likeliest file to be clobbered and the worst one to lose silently, since its whole function is to stop mistakes from repeating.

**Rule:**

1. **A whole-file rewrite of an append-heavy file re-reads `origin/main` immediately before the write and diffs its own base against it.** If anything landed in between, rebase onto it. LESSONS.md, `public/data_manifest.json` and the daily data files all qualify.
2. **A merge is not a delivery until it is verified on `main`.** Any change worth reporting to Joe is worth one `grep` of a freshly cloned `main` for a distinctive string from it, after the merge returns. "The API returned ok:true" is a claim about one request, not about the state of the branch (5.x, `ok:false` is a claim about one attempt — the same idea pointed the other way).
3. **Restore rather than rewrite.** Both lost entries were re-added under the current numbering with their cross-references corrected, not re-invented from memory.
4. **Renumbering a shared reference file breaks every citation in it.** The reorg left two headers for every section and stranded five HARD RULES (0.8–0.12) under a "TALKING TO JOE" heading, so a session told to "read all of section 0" would have stopped at 0.7 — the precise failure that produced the 2026-08-31 regression. The stray heading is fixed here. **Open item, deliberately not fixed in this pass:** every top-level section header from 1 through 9 still appears twice, and untangling two spliced numbering schemes is its own change with its own verification, not a side-effect of a sweep.

**Applies to:** every agent that appends to LESSONS.md, and every whole-file write to a shared, frequently-appended file.

# 6 · QUANT METHODOLOGY & RESEARCH
### 6.1 (2026-05-13) — Splice continuity: percentile rules are NOT scale-invariant across distribution shifts

**What happened:** Splicing a derived proxy (1962–2002) onto the actual series (2002–2026) inside a trailing 5-year percentile rule produced 100% Risk-Off for 18 straight months — the rolling window straddling the splice experienced a step-function regime change in the data itself, despite nearly identical means in the overlap.

**Rule:** Before splicing two series, compute local distribution stats in adjacent 5-year windows on both sides of the splice. If means or standard deviations differ by more than ~5%, apply the distribution mapping `X_scaled = μ_after + (X_before − μ_before) / σ_before × σ_after`. After splicing, validate continuity: count rule-fires in 6-month windows on either side — smooth is expected, a step (50% → 100%) is a bug. Document the anchor parameters in the methodology for reproducibility.

**Applies to:** All series-splicing feeding any percentile or rolling-window rule.

### 6.2 (2026-05-13) — Don't confuse "available at source" with "in the on-disk file"

**What happened:** The deployed history file had MOVE starting 2006; the real series goes back to 2002 at the vendor. Building the splice against the deployed file left a 3-year hole that corrupted the rolling window for 18 months post-splice.

**Rule:** For any series used in analysis, check three things separately: the on-disk file's first observation, the original source's inception date, and the published methodology's window (the authoritative one). If the first two disagree, pull the missing window from source before building anything on top.

**Applies to:** All indicator analyses depending on a specific window.

### 6.3 (2026-05-13) — Sub-composites double-count; build panels from primitives

**What happened:** A retired composite weighted four indicators equally — but one of them is itself a ~105-input composite that already CONTAINS two of the others; overlap correlations ran 0.90–0.99. The apparent diversification was illusory.

**Rule:** When building any panel, audit whether members are PRIMITIVES (a price, a yield, a spread) or COMPOSITES (weighted averages of other indicators). Prefer primitives; if a composite is included, exclude its sub-components from separate weighting. Run Pearson and Spearman correlation matrices on the panel and flag any pair above 0.85 as a double-counting candidate.

**Applies to:** All composite/panel design.

### 6.4 (2026-05-13) — Test indicator subsets empirically, never by assumption

**What happened:** A 5-indicator panel shipped on its published methodology without testing predictive value. The eventual analysis showed the yield curve had no near-term predictive power for drawdowns at any horizon up to 12 months, one input was weak everywhere, and a single strong indicator alone beat the full panel's risk-adjusted return — the panel was diluted by its weakest members.

**Rule:** Before adopting any panel for production, run discrimination analysis (AUC) at multiple forward horizons (1w / 1m / 3m / 6m / 12m) for each indicator individually and for every subset, against forward drawdown probabilities (10/15/20%). Flag anything below 0.55 AUC at the relevant horizon. More indicators is not better — dilution is real.

**Applies to:** Senior Quant — any indicator-driven regime engine. Backtesting is non-negotiable.

### 6.5 (2026-05-13) — Inflationary vs deflationary stress require different defensive sleeves

**What happened:** The original defensive sleeve (50% cash + 25% long Treasuries + 25% gold) implicitly assumed deflationary crashes. 2022 broke it: rising yields drove equities AND long Treasuries down ~20% together — the Risk-Off signal fired correctly and the sleeve compounded the loss.

**Rule:** When the regime is Risk-Off, check yield direction (trailing 3-month change in the 10-year yield, percentile-ranked vs trailing 5 years) to type the stress: inflationary (yields rising fast, ≥70th percentile) → cash + gold + short-duration Treasuries, avoid duration; deflationary (≤30th percentile) → cash + gold + long Treasuries; neutral → balanced. This two-axis architecture (stress level, stress type) is the structural fix for the discount-rate-shock blind spot in trend/risk-parity defaults.

**Applies to:** All defensive-overlay design, especially anything defaulting to long Treasuries as the equity hedge.

### 6.6 (2026-05-11) — Negative position values have multiple meanings; dispatch on kind, not sign

**What happened:** The allocation rollup classified every negative-value position as margin debt; a sold short call (an open option obligation) got labeled borrowed cash. Joe has no margin debt.

**Rule:** Where the data model permits negative values for structurally different reasons (margin borrowing, short equity, short options, accrued obligations, manual adjustments), bucketing dispatches on the KIND of row — asset class + direction — before any default liability bucket. When touching any negative-value branch, audit every other negative-value path in the same file for the same conflation.

**Applies to:** All allocation/rollup/aggregation logic.

---

# 6 · CODE & RELEASE DISCIPLINE

### 6.7 (2026-06-02, binding design) — The paper-trading engine is SIGNAL-ONLY with end-of-day-only pricing

**What happened:** The original rebalancer pushed every holding back to a fixed dollar weight, so pure price drift generated trades, and it priced positions off the broker's live mark, which disagreed with the end-of-day feed the rest of the site uses. Joe: trades fire on SIGNALS ONLY, and every price comes from our existing end-of-day feeds.

**Rule:** The engine trades ONLY on signal entry (new name), signal exit (name dropped → sell whole position), and signal-driven resize (tier/weight change past the band). A held name is anchored to its COST BASIS, which changes only when we trade — price movement never triggers a trade. All pricing (targets, share sizing) comes from the end-of-day price table; the broker supplies ONLY held quantity and executed fill prices. Orders are market/day — never market-on-open, which rejects fractional shares (the book is dollar-sized, so every position is fractional). Tolerance band: max($500, 3% of the position's own target). Do not reintroduce market-value diffing or broker prices.

**Applies to:** Senior Quant + Lead Developer — any change to the paper engine, pricing, or order types.

---

### 6.8 (2026-07-29) — A regime gate with no entry confirmation sells the bottom; and any signal is judged by the history the user can SEE

**What happened:** Joe spot-checked the visible regime strip on the Macro engine card and found the engine went Risk Off on 4 April 2025 — the exact bottom of a 10% S&P drawdown — and back to Risk On on 18 April, after the rebound. His verdict: "the only history on this indicator visible to users proves to them that the indicator is garbage." Both halves of that were right. The gate fired off a single Friday above the 75th-percentile line, and the card showed only the trailing two years, which contained that whipsaw and none of the 2008 / 2020 / 2022 episodes the engine was built for.

**What the review found:** across 1986–2026 the unfiltered gate produced 69 de-risk episodes, 48 of them four weeks or shorter, and only 26 of 69 beat simply staying invested. Requiring the percentile to hold at or above the line for two consecutive Fridays before a de-risk STARTS (exit unchanged) cut that to 45 episodes and improved return, Sharpe and maximum drawdown together — 12.01%/yr, 0.606, −33.3% against 11.60%, 0.584, −34.9%. Two weeks beat one, three and four; it held in both halves of the sample and at every threshold pair tested.

**Rule:** (a) Any threshold-crossing regime signal that trades on a single observation is presumed to whipsaw until an entry-confirmation variant has been tested against it — test confirmation length as an interior optimum (k−1, k, k+1) and in both sample halves before adopting. Asymmetry is the point: confirm on the way in, exit immediately. (b) A signal's on-page history window is part of the signal's credibility. Never show a window so short that it contains the misses and none of the saves — if the full record is defensible, show the full record, and give the user a way to see it against what the market actually did.

**Also:** when re-deriving a locked backtest artifact, first reproduce the locked numbers exactly with the OLD rule as a control. Reverse-engineering the artifact's own conventions (years = weeks/52, Sharpe = (CAGR − 3.25%)/vol, state applied to the FOLLOWING week's return) caught a one-week lag error that would otherwise have silently shifted every published figure. `scripts/apply_gate_to_backtest.py` runs that control.

**Applies to:** the macro engine, the paper sleeves, the scanners, and any future rules-based signal with a threshold.

### 6.9 (2026-08-14) — A famous ratio is not an insight; and an idea without an unconditional baseline is an opinion with a hit rate attached

**What happened:** Joe on the first two published Trade Ideas — *"Making a call 10 years out is not helpful. I want more trades ideas... next several quarters. This bond idea is not profound at all. You could look at Buffet Indicator or CAPE alone and say 'stocks are expensive over long term historical context.' What about positioning, technical analysis across assets. You keep coming back to such basic crap anyone can see - not something someone with decades of trading and risk managing experience can see."*

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A trade idea is a next-several-quarters proposition. Eighteen months is the cap.** A multi-year valuation view is an asset-allocation opinion and belongs somewhere else.
2. **A famous ratio may support a note and may never drive it.** CAPE, the Buffett indicator, market cap to GDP, the equity risk premium, price to book — rejected in the title, the call and the edge summary; welcome as context in the thesis.
3. **The driver must be a measured edge**, declared as one of: positioning, cross-asset divergence, technicals, volatility structure, flows, relative value, calendar mechanics, credit, market structure.
4. **`edge.backtest` requires an UNCONDITIONAL BASELINE, and that field is the whole rule.** A 77% hit rate is meaningless until the unconditional rate is on the page beside it at 52%. Every backtest of a conditional signal must state what doing nothing produced over the same horizon, in the same sample.
5. **Run the backtest BEFORE writing prose, and be willing to lose the idea.** This earned its keep immediately. The intended note was an equity-index squeeze — Nasdaq speculative positioning at the 1st percentile of three years, Russell at the 2nd, commercials at the 100th on both. A genuinely non-obvious, exciting setup. Its own base rates killed it: forward Nasdaq returns after those extremes were −0.60% / +2.35% / +3.73% at one, three and six months against unconditional readings of +2.30% / +6.15% / +11.53%. Buying the extreme was worse than buying at random at every horizon. **Positioning at an extreme is not a signal by itself; it is a signal in the markets where the base rate says it is one** — and that turned out to be the currencies, not the equity indices.
6. **Report the number of INDEPENDENT episodes, not the number of weeks.** Twenty-two weekly observations of dollar positioning at the 85th percentile collapse to four episodes, of which three had completed. "n=22" would have been true and misleading; "three completed episodes, all three down 4–6%" is the honest claim, and it is small enough to change the sizing.
7. **`variant` is required: what does consensus believe, and where does this differ?** If the honest answer is "nothing", there is no note. This is the field that would have blocked the CAPE piece on its own.

**Applies to:** every Trade Idea, and any surface that publishes a view rather than a fact.

### 6.10 (2026-08-14) — Better data does not create an edge; the fast-money-vs-real-money split answered the question honestly, and the answer was no

**What happened:** Joe: *"I really think positioning is a huge market tell... Weekly COT positioning on S&P Futures, NASDAQ, etc. Coupled with Goldman Sachs Prime Brokerage positioning data."* Goldman's Prime Services positioning work is distributed to their prime brokerage clients under contract — no API, not licensable, and nothing should be dressed up as a substitute for it. The public instrument that answers the same question is the CFTC's **Traders in Financial Futures** report, and it turned out to be a genuine upgrade on what the site already had: the legacy Commitments of Traders "non-commercial" bucket mixes hedge funds in with pensions, insurers and index managers, so a large real-money long and a large fast-money short cancel into a number that looks like nothing.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Build the better instrument anyway, then let it answer.** The feed shipped because it is materially more truthful about who owns what — and its first honest output was "this does not predict what you hoped". Both halves are the job. A data source is not validated by producing a tradeable signal.
2. **A null result on a signal everyone quotes is worth more than a marginal idea.** "Hedge funds are at a record short, therefore squeeze" is published constantly. It is not supported. That finding stops real risk being spent, and it is now written into the playbook as a do-not-republish table with the numbers attached, so no future session rediscovers it and ships it.
3. **If a result appears only in a short window, the window IS the finding.** The standoff looked excellent over five years — +3.47% at one month with 89% positive against +1.84% / 63% unconditional — and evaporated over sixteen. The five-year sample happened to cover a period of near-continuous equity strength. Always run the longest sample the data allows, and if the short and long samples disagree, believe the long one.
4. **Test each market separately; "positioning works" is not a fact about markets.** The same discipline that found nothing in equity indices found a real effect in the currencies. Generalising either way would have been wrong.
5. **Never substitute for a proprietary source without saying so.** The manifest entry states plainly that Goldman's work is not and will not be a source here, and what TFF is instead. A silent proxy invites a future reader to believe the site carries something it does not.

**Applies to:** every new data source, and every signal that arrives with a reputation attached.

### 6.11 (2026-08-14) — "Positioning works" is a fact about particular markets, not about markets; and the honest output of a sweep is often "no trade today"

**What happened:** Joe: *"Neither - I want more equity focused analysis. You keep doing rates. What about commodities? And please dont force it. We need to be real x-asset analysts."*

So the same test was run identically across every asset class the site carries — rank the fast-money net position as a share of open interest against its full history, take the extremes, compare forward returns to the unconditional return in the same sample. The result is a map, and the map is the deliverable:

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Never carry a signal's verdict across an asset class.** The same test that is dead in equity index futures produces a three-to-four-times base-rate effect in grains. The plausible mechanism — commodity hedgers have real physical exposure and therefore real information, while index futures are mostly financial — is a *reason*, not evidence. Re-run it in each market.
2. **Direction is not symmetric and not universal.** An extreme managed-money long is a reliable fade in wheat, corn, soybeans and silver, and the OPPOSITE in gold, where extreme longs have been followed by more upside at every horizon. A house rule of "extreme means fade" would be systematically wrong in one of the most-traded commodities on the site.
3. **Count episodes, not weeks, and set a floor.** Copper and WTI both look tradeable and are not: their samples begin in 2022 and 2019 and contain three independent episodes each. Below roughly ten episodes there is nothing to lean on, however good the median looks.
4. **"No trade today" is a complete answer and must be given.** On the 2026-08-04 report nothing sat at an extreme in a market where the signal is both live and well-populated — gold 82nd percentile, copper 96th (too thin), wheat 58th, corn 51st, soybeans 48th, silver 30th. The temptation is to reach for the nearest reading and dress it up. Joe pre-empted it — *"please dont force it"* — and the map is worth more than a forced note anyway, because it makes every future note faster and better founded.
5. **When a whole level of analysis comes back dead, say where the edge actually is instead.** Index-level equity signals are empty here, twice over. The equity work that HAS been validated in this system is at the single-name level — insider conviction, Power Trend, RSI divergences, short interest — and that is where an equity note should start, rather than from an index chart.

**Applies to:** every signal, every asset class, and every sweep that comes back empty.

### 6.12 (2026-08-17) — When a whole level of analysis is dead, change the instrument you measure with, not the asset you measure; and a percentile is only as honest as the series under it

**What happened:** Joe asked for equity-focused, genuinely cross-asset work. Index positioning was already dead (4.34) and breadth came back dead too (+3.83% against a +3.92% baseline). Rather than descend to single names, the move that worked was to keep the asset — the S&P — and change the *instrument*: read the equity market off the **shape of its own volatility curve** instead of off its price or its futures positioning.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A dead level of analysis is not a dead asset.** Positioning and breadth both failed on the S&P. The same asset, read through its options surface, produced a stable, symmetric, sub-period-robust signal. Before abandoning a market, exhaust the *instruments* that observe it — price, futures positioning, breadth, credit, the volatility surface, the term structure of that surface. They are not the same measurement and they do not fail together.
2. **Report the shape of the effect, not just its sign.** The reflex reading of steep contango is *complacency → danger*, and that is wrong here in a way that matters: P(≥10% drawdown in six months) is 22% conditional against 19% unconditional, and at three months the conditional number is the LOWER one. Return compresses; risk does not rise. "You are paid less for the same risk" is a portfolio-construction finding with a rotation as its answer, whereas "danger" would have produced a hedging note and a wrong one. **Always test the second moment, not only the mean — the difference between the two is the difference between the right trade and the opposite one.**
3. **Symmetry is the cheapest overfitting check there is.** A threshold that only works at one tail is a candidate for a fluke; one that reverses cleanly at the other tail is much harder to have fitted by accident. Run both tails before believing either.
4. **A percentile inherits every artifact of the series beneath it.** `hy_ig_etf` printed at the 0.1st percentile of five years, which reads instantly as maximum credit stress. It is the **LQD ÷ HYG price ratio** — so a low reading means high yield is *out*performing (risk-ON, the opposite), and a price ratio of two funds with different distribution yields drifts mechanically whatever spreads do. The spread series said HY OAS was at 271bp, the 10th percentile of tightness. **Read `indicatorRegistry.js` for what a ratio actually divides by before writing a sentence about its direction, and prefer a spread series to an ETF price ratio every time one exists.**
5. **Verify a vendor feed's continuity, not just its last value.** Yahoo's `^VIX3M` returned 5,033 daily bars ending at a correct-looking live quote — with a month-long hole from 2026-07-17 that only surfaced because a date-intersection across series silently truncated a backtest to 2026-07-17 and produced a completely different "today" reading (0.9138, 64.7th percentile) than the truth (0.7719, 0.6th). FRED's VXVCLS had every session. Both are the identical CBOE index — 4,683 overlapping days, mean absolute difference 0.0005 — so FRED is now the spine and Yahoo only splices the pre-2008 head. **A feed that ends on the right date can still be missing the middle. When an aligned backtest ends earlier than its shortest input, that is a data defect, not a rounding detail.**
6. **Correcting a published figure has to be one command or it will not happen.** Re-running `--prepare-file` on an already-published note failed the instrument-novelty gate against its own earlier copy, because ids were assigned in `normalise()` — which runs *after* `validate()`. Split out as `derive_id()` and used by the gate. Any pipeline that makes fixing a wrong number harder than publishing it will accumulate wrong numbers.

**Applies to:** every indicator added, every percentile printed, and every backtest that aligns more than one series.

### 6.13 (2026-08-17) — A track record has to be designed before the first call is scored, not after; and a page that needs another page's stylesheet will look wrong in a way no assertion catches

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

### 6.14 (2026-08-18) — A conservative rule can be wrong in the same way a sloppy one is; if the record disagrees with what the note showed the reader, the record is wrong

**What happened:** Joe, the morning after the scorecard went live: *"How are we showing no performance for our calls? It's 8/18, we've made calls 8/14, 8/16, and 8/17 - all made before Monday's market open and we have no performance tracked. This doesn't make sense."*

It didn't. The entry rule was "the first close ON OR AFTER the publication date", written to stop a later session from picking a flattering fill. But every note so far published while its market was shut or mid-session — the FX note at 2:17 PM ET Friday, the rates note at 7:28 PM ET Sunday, the equity note at 11:01 AM ET Monday. Under that rule each entered at the NEXT close, which silently discarded the first full session of the call. Three live calls, four days in, all reading exactly 0.00%.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **"Conservative" is not the same as "correct", and it is not a defence.** The old rule was chosen because it could not flatter a result. It could not — it could only understate one, systematically, for every note published outside market hours, which is most of them. A bias that always runs one way is still a bias. Ask what a rule does to the TYPICAL case, not only to the adversarial one.
2. **Cross-check a computed record against what the note told the reader.** The notes quoted their own levels in prose. Had I compared the scorer's entry to the printed spot on day one, the gap would have been obvious immediately — instead the check that caught it was Joe reading the page. **Any figure a system computes about a document should be reconciled against that document at least once.**
3. **Keep the anti-cherry-pick property while fixing the timing.** Entry is still never read from the prose. It is looked up by walking BACKWARDS from an immutable `published_at` stamp, so it is computable but not choosable, and a note cannot be entered at a price that did not exist when it was written. A close is treated as available from 21:00 UTC (5 PM ET, after the 17:05 futures/FX settle), so a note published at 4:30 PM ET takes the previous close rather than claiming a settle minutes old.
4. **When a metric reads as a flat zero across every row, suspect the metric.** Three independent calls in three different asset classes returning exactly 0.00% is not a market observation, it is a signature. Treat an implausibly clean result as a defect until proven otherwise.

**Applies to:** the scorecard, and every backtest or attribution that has to decide when a position started.

### 6.15 (2026-08-18) — A relative-value call scored on a pre-computed ratio is not a scored call; and a number without a size is not a result

**What happened:** Joe read the Scorecard: *"Buy KBW vs. NASDAQ 100 recommendation is showing −0.33%, but then Buy 10y TIPs vs. 10y UST is showing +0.01pp, then we have EUR vs. USD +0.34%."* Four defects, all in one column of three numbers.

1. **We graded a trade we did not recommend.** The bank note says buy the KBW complex, *funded by trimming the Nasdaq-100-weighted leadership*. Its scorecard scored one leg on `bkx_spx` — banks divided by the **S&P 500**. Same species as the KLIC bug a few hours earlier: the label and the number described different things, and nothing in the contract compared the two.
2. **The unit was not one unit.** The equity call was a % change in a ratio, the rates call a **pp** change in a breakeven — a spread that had widened one basis point — and the FX call a % change in spot. `+0.01pp` and `−0.33%` were printed in the same column, adjacent, as if a reader could compare them.
3. **No sizing existed.** Every leg was `weight: 1.0`. A 1bp breakeven move and a 33bp equity-ratio move were the same size of bet on the page. Measured properly the two spreads run at 2.3% and 23.0% annualised volatility — a factor of ten.
4. **No benchmark existed.** `benchmark: null` on all three, on an engine that had supported the field since the day it was written. Nothing populated it, so nothing surfaced it, so nobody noticed.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Score the trade you recommended, not a proxy for it.** If the note names a sell, a short or a funding leg, the scorecard carries a short leg for it. The contract now refuses the note otherwise. The one legitimate exception — the funding side already inside the instrument, as the dollar is inside EUR/USD — must be *claimed in a field*, never inferred from prose. A rule you can satisfy by wording is not a rule.
2. **A raw level change is not a return.** It cannot be netted, sized or benchmarked. `level_change` is retired as a leg measure and now fails loudly with the fix in the message, rather than quietly printing pp beside per cent.
3. **Never publish two numbers in one column that are not the same kind of number.** The unit is the smallest part of that; the size is the larger part. Two returns in the same unit at wildly different volatilities are still not comparable.
4. **Any number that defines history is computed once and frozen.** Position size is derived from data available at entry and stored. If it were recomputed each run, every past mark would move whenever the vol window rolled, and a record that changes retroactively is not a record.
5. **One definition of "the series we carry".** The contract rejected a leg the marker scored perfectly well, because the marker derived a series the contract had never heard of. The derivation is now defined once in the marker and imported by the contract, and the loader applies it — so no caller can forget it. A second copy of a catalogue is a second source of truth.
6. **A supported field that nothing populates is not a feature.** The benchmark slot existed for a day and stayed null on every row. If a field is optional and nobody fills it, either default it or delete it — an unfilled field looks identical to an absent one, and it hides the same gap for longer.

**Applies to:** Senior Quant (owns the return, duration and sizing conventions) + Lead Developer — every published call, every scorecard, every performance surface.

---

### 6.16 (2026-08-28) — The morning research sweep is a GATE on the publish decision, not background reading; a run that only sweeps its own feeds decides blind

**What happened:** the daily Trade Idea run swept all 73 indicators and 25 positioning markets, correctly concluded nothing cleared the bar, recorded the skip — and never ran the external morning research sweep the playbook already mandated. Joe caught it with one question ("You are only looking at indicators and positioning signals?"). Run late, the sweep changed the entire complexion of the morning: Fed Chair Warsh's first Jackson Hole keynote was THAT DAY at 10:00 ET, the annual payrolls benchmark revision — expected positive for the first time in three years, and direct event risk to the live long-Treasury call — landed in the same hour, and the site's own release calendar carried neither. The skip verdict happened to survive, but by luck: the run had decided "nothing worth publishing today" without knowing what today was. A prose sentence in step 0 ("runs every day whether or not anything publishes") was a hope, not a gate — the same failure shape as 4.31 rule 2: an instruction in a prompt is a request; only a checked step is a guarantee.

**Rule:**

1. **The external sweep completes BEFORE the publish/skip decision, every run, no exceptions.** Overnight international sessions, major wires, policymaker calendars and statements, and today's scheduled releases — dated pages only. A publish/skip decision reached without it is invalid even when it happens to be right, because the thing being decided is "is this the best idea of the week", and the week includes today's events.
2. **The skip reason must prove the sweep ran.** `pipeline_health.last_skip_reason` names the day's dominant scheduled event (or states plainly that there is none), so a skip that skipped the sweep is distinguishable in the record from a diligent one. A reason built only from indicator percentiles is the tell.
3. **An event the external sweep finds that the site's own calendar missed is a data ticket filed the same run** (4.30: anything dated that renders is a feed). Today's gap: the annual payrolls benchmark revision — a market mover for a live call, absent from the release calendar feed.

**Applies to:** the Trade Idea scheduled run, and every recurring publishing run that can conclude "nothing today."

### 6.17 (2026-08-30) — "X is at an extreme" is a reading, not analysis; every signal owes its WHY, its transmission path, and its consequence for the live book

**What happened:** Joe, on the morning skip summary: "Your analysis sucks. You just look at fucking signals on MacroTilt and tell me 'grains at extremes' — a toddler could do this. You are incapable of doing any analysis into why, incapable of looking at real cross asset correlations, incapable of really understanding markets." He is right about what was delivered: percentile readings recited as if they were findings. Run the same morning with actual analysis, the grain extreme became: cause (Black Sea war premium — Russian export cuts, suspended port service — plus a US corn yield shortfall), a measured transmission (top-decile 3-month grain rallies, 19 episodes since 2006, were followed by 10y breakevens +8bp vs +2bp unconditional at 3m, 74% hit rate vs 53%, and a dollar −2.6% vs +0.1% at 6m, while nominal 10y yields stayed flat), and consequence for the live book (strengthens the breakevens and EUR/USD calls, does not threaten the duration call). That is what a note reader is paying for.

**Rule:** No signal may be reported — in a note, a skip reason, or a summary to Joe — as a bare percentile or extreme. Each one carries: (1) WHY, from dated external sources, the thing is where it is; (2) the measured cross-asset transmission — run the conditional-vs-unconditional test against the assets it should move, from indicator history, that run; (3) what it means for each live call in the book. A signal whose why and transmission were not established is background, not content.

**Applies to:** All agents — Trade Idea runs, skip reasons, briefs, and every market statement addressed to Joe or a reader.


# 7 · CODE & RELEASE DISCIPLINE
### 7.1 (2026-05-18) — Never call React hooks inside an inline IIFE in JSX; lift into a real component

**What happened:** An inline immediately-invoked block with state/effect hooks inside the Home render path executed only on the Home route, so the parent's hook count varied across renders — React tore down the whole tree on every other route (error #300).

**Rule:** Never call any hook inside an inline IIFE in JSX. If a render block needs local state or effects, declare a real function component at module scope and render it. Hooks must run the same number of times on every render. Before merging any render-heavy file, scan the diff for arrow-IIFE openings within ~20 lines of hook calls.

**Applies to:** Lead Developer + UX Designer — every PR adding or modifying JSX.

### 7.2 (2026-05-13) — Parse-check JSX after any structural rewrite before pushing

**What happened:** Two regex-based scripts that lifted components out of wrappers introduced unbalanced fragments; neither was caught locally; both cost revert + re-push cycles and a wasted build.

**Rule:** After any scripted/regex edit that adds or removes JSX elements (fragments, IIFE returns, wrappers), run a parser check on every modified file before committing: `node -e "require('@babel/parser').parse(require('fs').readFileSync('FILE','utf8'),{sourceType:'module',plugins:['jsx']})"`. If it errors, fix structure first. Never push JSX surgery without it.

**Applies to:** Lead Developer.

### 7.3 (2026-05-10 c + d) — Every class name referenced in JSX needs an actually-loaded CSS rule; style-string constants must actually be used

**What happened:** Two flavors of the same silent visual bug. A drawer component rendered class names with ZERO matching CSS rules anywhere — the browser's defaults left the inactive drawer's close "×" rendered as plain text above every page's footer. Separately, a page defined a 180-line CSS string constant that was never referenced after declaration (dead code), and the wrapper class its selectors were scoped to wasn't applied — the whole builder rendered unstyled. Both shipped because "the bundle contains the strings" passed.

**Rule:** When a component renders class names, confirm rules targeting them are actually loaded BEFORE shipping — mandatory for anything controlling visibility/position (drawer, modal, scrim, popover): `grep -n ".classname" src/theme.css` returning nothing means the component ships naked. When a file declares a CSS-as-string constant, grep for its second usage — declaration-only means unreachable styles; also confirm the scoping wrapper class is applied. Two greps, five seconds, catches both.

**Applies to:** All UX Designer and Lead Dev work introducing or relying on class names or style-string constants.

### 7.4 (2026-05-13) — CSS color/surface tokens must be theme-aware; never hide an undefined variable behind a hex fallback

**What happened:** Hundreds of call sites referenced token names that were never defined, each with a hardcoded hex fallback — so the fallback fired in BOTH themes and dark mode rendered dark-on-dark invisible text. Landed silently across 16 files before Joe screenshot-flagged it.

**Rule:** Use only the canonical tokens defined in BOTH the root and dark-theme blocks of theme.css (`--text`, `--text-2`, `--text-muted`, `--text-dim`, `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-faint`, `--border-strong`, `--accent`, `--accent-soft`, `--green`, `--red`, `--green-text`, `--red-text`, `--yellow`). Never write `var(--foo, #hex)` where `--foo` isn't defined — search theme.css first. A genuinely new semantic token gets defined in all three theme blocks before use. After any new color rule, load the page in both themes (see 3.1).

**Applies to:** UX Designer + Lead Developer — all CSS in files, inline styles, or style blocks.

### 7.5 (2026-05-13) — Never put the comment-closing pair `*/` inside a CSS comment body

**What happened:** A CSS comment describing token names with glob-style asterisks contained the literal closing pair mid-sentence — the comment closed early, everything after parsed as invalid CSS, and the build pipeline broke for unrelated work.

**Rule:** CSS comment bodies never contain the literal closing pair: spell out glob patterns ("the ink, bg, and line tokens"), break math/path fragments with spaces. Before committing any CSS change, check the diff for the pair and confirm every occurrence is an intended comment close.

**Applies to:** Anyone touching stylesheets, inline style blocks, or template strings emitting CSS.

### 7.6 (2026-05-10 e) — An array indexed by a string returns undefined; build a lookup or use .find

**What happened:** A page crashed the React tree on click: an array of factor objects was indexed with a string ID, returning undefined, then a missing-property read crashed — compounded by the property name itself having been renamed.

**Rule:** `SOME_ARRAY[stringKey]` is almost always a bug: either build a by-ID map once (`Object.fromEntries(arr.map(x => [x.id, x]))`) or use `.find` with a defensive null-guard. Any time the shape of a shared data structure changes (array ↔ map, field rename), grep all consumers before merging.

**Applies to:** All work touching shared data structures.

### 7.7 (2026-05-04 c) — Every file deletion greps the WHOLE repo first, including entry points and workflows

**What happened:** A file was deleted with the claim "0 imports" — the grep missed the main entry point, which imported it. Every scheduled scan crashed at import for days, and the failure was masked as a "skipped (out-of-window)" run, so no alert fired.

**Rule:** Before deleting any file, grep the whole repo for the basename with AND without extension, including main entry scripts, workflow files, and edge functions. Paste the actual grep output into the PR description. Separately: a "successful" run that took the no-op exit path (gated/skipped/weekend) must be visually distinct from a successful run that did work — otherwise a regression that turns every run into a no-op looks like a healthy quiet day.

**Applies to:** Lead Developer — every deletion.

### 7.8 (2026-05-10) — Rewriting one side of a producer/consumer contract requires auditing the unchanged side, key by key

**What happened:** A page rewrite read nested keys the producer never emitted (the producer's names were different); the build passed (bundlers don't type-check JSON blobs), the contract validator had no entry for those paths, and the live funnel rendered zeros after cutover.

**Rule:** When rewriting one side of a producer→consumer pair (script writing JSON read by the UI, or vice versa — the rule is symmetric), open the OTHER side and confirm every key the rewrite reads is actually emitted, including nested paths. If they diverge, decide before merging: rename producer (and backfill), rename consumer, or add a normalize adapter at the hydration boundary. Add the specific key paths to the contract checker so the next rename trips the check before merge. A passing build is not a passing contract.

**Applies to:** Every PR touching one side of a data contract.

### 7.9 (2026-05-07) — Never stack new fixes on a feature branch carrying unresolved regressions on other surfaces

**What happened:** Five fixes were built on an existing design branch that already carried a visual regression on another page; Joe loaded the preview to test a one-line fix and found a broken Macro Overview bundled into the same merge unit.

**Rule:** Before stacking commits onto an existing branch, load that branch's preview and audit the surfaces you're NOT touching. Any regression found — even one — means fork to a fresh branch off main and open a separate PR. A PR's merge gate is the WHOLE branch; if any other commit on it isn't ready, your commits aren't ready. Especially binding when the branch has 5+ commits or is a broad theme/redesign branch.

**Applies to:** All.

### 7.10 (2026-05-13) — Every new public table in a migration includes explicit access grants

**What happened:** Supabase announced that new tables in the public schema stop being auto-exposed to the Data API (existing projects cut over October 30, 2026). The site reads via the Data API, so any future table added without an explicit grant silently returns a permission error and its tiles render as em-dashes.

**Rule:** Every migration creating a public table includes the grant block (template lives at `supabase/migrations/000_TEMPLATE.sql`), scoped to actual access: read for anonymous if a tile reads it directly; service-role only for ingestion-only tables; row-level security enabled with a named policy. Data Steward sign-off on every table-creating PR must name which roles got which privileges and why.

**Applies to:** Lead Developer + Data Steward — every migration.

### 7.11 (2026-06-01) — Required status checks on the main branch silently freeze every nightly data bot

**What happened:** Branch protection with required checks went live, and the nightly refreshers push with the default workflow token (not an admin) — every direct push was rejected, the engine reading froze for days, and nothing visibly errored. Earlier the same week, plain pushes were also losing races to concurrent commits.

**Rule:** Daily data-refresh workflows check out and push with the admin bot token stored as the repo secret `MACROTILT_BOT_PAT` (admins bypass required checks; the anti-synthetic gate stays required for human PRs), and pushes rebase onto latest main with retries. If a data surface goes stale, check the producing workflow's last run for a protected-branch rejection or "fetch first" failure BEFORE assuming the compute broke.

**Applies to:** Lead Developer — branch protection and all bot workflows.

---

# 7 · PLATFORM FACTS & CREDENTIALS

### 7.12 (2026-06-15) — The repo was ~58% machine files + retired code; a cleanup ran in four phases. Keep it clean.

**What happened:** The tracked repo had grown to ~988k lines / 3,066 files, of which only ~109k powered the live site. Installed packages and build output had been committed before the ignore rules existed; the entire legacy tab site shipped in every build via a ?v=2 back-door; an old local pipeline generation still sat at the root; and several killed feeds still had producer remnants. Agents kept grepping the repo, finding retired producers/registries/UI, and reviving them.

**Rule:** (1) Never track installed packages, build output, logs, or OS files — the cruft guard enforces this. (2) The overhaul shell is the only site; there is no legacy app and no ?v=2. (3) Before registering, fixing, paginating, or wiring ANY element, check `killed_elements.json` at the repo root — a name there is dead; the action is to delete the remnant, not revive it (companion to 0.10). (4) The weekly dead-UI detector reports any src file the live site cannot reach; treat its bug as a real defect. (5) Reachability is judged by the BUNDLER (scripts/detect_dead_ui.mjs), never a hand-rolled grep — a regex importer under-counts live files and will mark live code dead (this exact bug nearly deleted ~60 live files in Phase 2; the build caught it).

**Still open (next focused job, Data Steward + Senior Quant):** killed feeds with live producer residue — the Buffett Indicator (still computed nightly by fetch_history.py), Bank Unrealized Losses and Buffett (still fed into the cycle-v2 engine), and the Advance-Decline Line (still seeded by the breadth-rebuild job). Eradicating these changes computed scores, so it needs the backtest/paper-check loop (3.4, 5.x) — not a blind delete. Locations are in `killed_elements.json` under each concept's "residue". The automated resurrection guard stays unarmed until this residue is gone.

**Applies to:** All.

---

### 7.13 (2026-06-15) — Tooltips must be INSTANT; never use the native title attribute

**What happened:** On the Data page I added hover tooltips using the HTML `title` attribute. The browser delays `title` tooltips ~1 second before showing them. Joe: "Tooltips aren't instant. This is (should be a hard rule). I cant keep correcting you on simple things like this."

**Rule (HARD):** Every tooltip MacroTilt renders appears the instant the pointer is over the element — zero perceptible delay. NEVER use the native HTML `title` attribute for a tooltip (it has a built-in ~1s delay that cannot be removed). Use the site's `Tip` component (portal-rendered, shows on mouseEnter) or an instant CSS tooltip (a `:hover::after` with NO transition-delay). Any tooltip with a show-delay is a defect. When adding tooltips, hover one before claiming done and confirm it appears immediately.

**Applies to:** All UI work. UX Designer + Lead Developer.

---

### 7.14 (2026-09-01) — A component that is rendered but never defined is a white screen, and it takes every other modal down with it

**What happened:** Joe: "I'm not able to open Silver positioning signal model?" then "or any modal for that matter." `MacroPage.jsx` rendered `<PositioningDetail …>` at line 661 and imported nothing by that name — the symbol was never defined anywhere in the repo. Clicking any of the 25 COT positioning rows, or loading `/macro?pos=<market>`, threw `ReferenceError: PositioningDetail is not defined` and blanked the whole page to a dark screen. The second half of Joe's report is the important part: React unmounts the tree on an uncaught render error, so after the first positioning click *every* modal on the page appeared dead. One missing symbol read to the user as "the site's modals are broken." A second undefined component, `BucketPositioning`, sat inside `BucketModal` — dead code that nothing rendered, so it never fired, but it was the same landmine one call site away.

**Rule:**

1. **Never let a render reference a symbol the file does not import or define.** Before any PR touching a page's render tree, run the undefined-component scan: collect every `<Capitalised` in the file, subtract imports, local `function`/`const` declarations, and destructured props (`{ as: Tag }`), and require the remainder to be empty. It takes seconds and would have caught both of these.
2. **A crash inside a modal is a whole-page outage, not a modal bug.** Any surface that mounts user-triggered content gets an error boundary, so one broken drill degrades to a message inside the overlay instead of unmounting the page around it.
3. **Every deep-link parameter a page reads is a UAT case.** `/macro` reads `?ind=` and `?pos=`. Only `?ind=` had ever been opened. If a page branches on a query param, load every branch before calling the page verified — a click path that exists only in a `useEffect` is untested by definition.
4. **Delete dead render code rather than leaving it.** `BucketModal` had no call site and referenced an undefined component; the next person to wire it up inherits a crash with no warning.

**Applies to:** Lead Developer — every PR that adds or moves a component into a page's render tree; UX Designer on sign-off, since "the modal opens" is a design acceptance criterion.


# 8 · PLATFORM FACTS & CREDENTIALS

### 7.15 (2026-09-01) — A design rule that lives only in a prompt is a rule you will be told about again

**What happened:** Joe, on the Macro engine band, for at least the third time in one session: *"Why are you jamming all this to the left? I thought we already talked about this? Is this not a design rule? It's so bad that I have to tell you this over and over again. How do we fix this so you know to not do things like this?"*

He was right twice — about the layout, and about the meta-point. The band declared **three** grid columns and the markup supplies **two** children, so a 523px track sat empty on a 1568px card. But the important half of his message is the second question: repeating a rule in a playbook had not worked, and would not work the fourth time.

The same session had already proved why. Length in the daily brief was a prompt instruction until 2026-08-19, when it became `enforce_caps()`; voice became `enforce_voice()` the same day this happened. Every rule that survived did so because it became a check that fails. Every rule that kept getting re-reported was one a human had to notice.

**The naive check gives a false pass on exactly the card that triggered this.** "Does any content reach the right edge of the container" returns **99%** for the engine band — because a full-width history strip sits underneath two columns that stop at 66%. Dead space is a per-ROW and per-TRACK property. It is never a per-container one.

**Rule:**

1. **`scripts/check_layout.mjs` runs on every PR that touches a page.** It fails the build on two conditions: an **empty grid track** (N columns declared, fewer spanned), and a **short row** (a row of two or more children using under 70% of its container's inner width). Both report the selector and the pixels.
2. **Count spans, not children.** A 12-column grid holding four children that each span 6 is full. Counting children called it a third full and produced a false alarm on the Home cockpit.
3. **Ignore zero-width tracks and partial last rows.** `auto-fit` collapsing a spare track to 0px is that property working. Four tiles left over from twelve is arithmetic. Neither is a design decision, and flagging them trains you to ignore the checker — which is worse than not having one.
4. **The one opt-out is declared in the markup: `data-layout="natural"`.** A chart legend belongs at the left under its chart; a panel does not. The exemption goes where a reviewer sees it, never as a quiet special case inside the checker.
5. **When a rule has to be repeated, stop repeating it and write the check.** If a rule cannot be expressed as a check, say so out loud and explain what would have to be true for it to become one — do not promise to remember.

**Applies to:** UX Designer on every layout sign-off; Lead Developer on every PR touching `/pages/` or `/styles/`. Any correction Joe has to give twice is a missing test, not a missing instruction.

### 7.16 (2026-09-03) — One classifier, one colour per concept; a badge and the row it counts must be the same object

**What happened:** Joe, on a Macro domain tile: *"There's no way to know that the 1 BIG MOVE is associated with the down-5 number. Big Move is blue, down 5 is red, then Eq risk prem is blue with 4 elevated amber. Nothing ties out. This is so bad."*

Three independent classifiers were running on one tile, and none of them agreed:

| Element | Read from | Thresholds | Colours |
|---|---|---|---|
| row dot | `ind.state` (direction-aware) | 85 / 75 | red / amber / green |
| percentile cell | raw `ind.pct` (direction-BLIND) | 90 / 10 | red high, **blue** low |
| big-move cell | direction of the change | top decile | red / green |
| header badges | `ind.state`, indicators only | 85 / 75 | blue / red / amber |

So a 0th-percentile row rendered **blue** — the big-move colour — beside a **green** dot, while the header badge counted it as nothing at all. And the header badges skipped the COT positioning rows entirely, so a tile could show two red rows under a header claiming nothing was stretched.

**Rule:**

1. **One classifier per concept, read by every element that displays it.** The dot, the cell and the badge count all call the same function. If two elements can disagree about the same fact, they eventually will.
2. **One colour per concept, and no colour serves two concepts.** BLUE = big move. RED = stretched. AMBER = elevated. GREEN = in range. Blue was doing double duty as "low percentile"; that alone made the tile unreadable.
3. **A badge and the thing it counts are the SAME chip.** Not the same hue — the same padding, radius, background and text colour. The identity is what makes the mapping obvious without a legend.
4. **A count in a header counts every row under it.** Including the rows from a different data source that happen to share the tile.
5. **Verify by counting, not by looking.** The fix was signed off with a browser audit asserting `badge_count === matching_row_count` for all six tiles, all three flags. Looking at one tile would have missed that the badges were counting indicators only.

**Applies to:** UX Designer and Lead Developer on any surface with a summary count over a list. Before shipping a badge, name the function that produces the number AND the function that produces each row's styling — if they are two functions, that is the bug.

### 8.1 (2026-05-26; paths updated 2026-06-11) — The GitHub token is on disk; read it, never ask Joe for it

**What happened:** The token was misplaced across sessions repeatedly, ending with the agent driving Joe's screen to push code by hand. Joe: "Can you please save this token so this never happens again… I set no expiration. Please do not lose this."

**Rule:** At the start of any task that pushes to GitHub, read the token from disk first: primary `~/Documents/Claude/MacroTilt/.secrets/github_pat.txt` (the project folder was renamed from "Claude Projects" to "Claude" on 2026-05-27); fallback: the token line in the repo's local env file. Configure pushes with the token inline; never echo it in chat; never drive Joe's screen to push. Scopes are repo + workflow (verified 2026-05-27). If a push fails on auth, the token was revoked — ask Joe to regenerate via the 3 UI clicks at github.com → Settings → Developer settings → Personal access tokens, then save the new token to the same file. Never ask "where is the token."

**Applies to:** Every session that pushes to the repo.

### 8.2 (2026-04-30) — Polygon Basic silently caps historical data at ~2 years

**What happened:** A backfill discovered the aggregates endpoint returns ~501 trading days per ticker on the Basic tier regardless of the requested start date — no error, no documentation; it silently truncates.

**Rule:** Assume the Basic tier returns ≤2 years per ticker unless verified otherwise. Viable patterns for deeper history: one-shot bootstrap from a free source into our own price table + Polygon forward-only (this is what shipped), or a paid tier upgrade. Never propose a Polygon-only deep backfill without explicit tier confirmation.

**Applies to:** Senior Quant + Data Steward — anything needing 2+ years of prices.

### 8.3 (2026-04-30) — Probe a third-party site's login stack for five minutes before estimating any scrape build

**What happened:** A scrape was planned as a ~6-hour cookie-login build on the assumption of a server-side form; the site turned out to be a single-page app with managed auth + CAPTCHA, costing three probe iterations and a wrong estimate.

**Rule:** Before estimating any "login + scrape" build, fetch the login page and check what actually runs it (form markup vs. managed-auth/CAPTCHA/single-page-app markers). If managed auth is present, plan around a headless browser or manual cookie path from the start — direct programmatic login is almost certainly blocked.

**Applies to:** Lead Developer — any third-party integration estimate.

---

# 8 · SPECS, COPY & PRODUCT DECISIONS

### 8.4 (2026-08-26) — A credential that lives in two places has already drifted; and when the thing being watched stops existing, the watcher is the next thing to fail

**What happened:** the weekday sweep found QT-EOD-DAILY red on 8/25 with the custody check reporting 243 shares of EBAY unaccounted for. That part was already known and closed — Joe closed paper account PA3G9FV5AN1G that evening and a fresh account was funded the next morning — but chasing it far enough to say so surfaced two live defects that nothing else was going to catch before they fired.

**(a) The broker keys had drifted between two stores, and nothing compares them.** The Alpaca paper keys live in `public.ops_secrets`, which is what an agent session rotates, AND in this repo's Actions secrets, which is what every scheduled broker job actually authenticates with. `ops_secrets` was updated at 10:59 UTC on 8/26 and verified against the live account; the Actions copies still read `updated_at: 2026-08-14`, i.e. they still addressed the account that had been closed. Read, not inferred: `GET /repos/.../actions/secrets` returns each secret's `updated_at` without its value, and a `GET /v2/account` issued from Postgres via `pg_net` — so no key was ever printed — returned `PA30FE66XZSD, ACTIVE, equity 1000000, trading_blocked false` for the `ops_secrets` pair. Consequence had it stood: QT-EOD-DAILY is in WORKFLOW_FAILURE_ALERT's VISIBLE set, so it would have failed on auth and emailed Joe every weeknight, and the 9/1 relaunch would have failed on its first fire.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **One credential, one home. If a second copy must exist, ship the command that makes it follow the first.** Two stores with no synchroniser is not redundancy, it is a scheduled outage waiting for the next rotation. `OPS-ALPACA-KEY-SYNC` copies `ops_secrets` → Actions secrets inside the runner, so neither value leaves a secret store. Rotate `ops_secrets`, dispatch it, done.
2. **A rotation is not finished until every consumer of that credential has been enumerated.** This is 4.28 rule 5 (the blast radius of a shared-module change is its import graph) pointed at a secret instead of a function: the blast radius of a credential change is every store that holds it and every job that reads it.
3. **Secret METADATA is readable and is evidence.** `updated_at` on an Actions secret, and a read-only `GET /v2/account` from `pg_net`, together answer "are the keys current and do they address the live account" deterministically — without asking anyone and without printing a key. Never end a turn asking whether a credential is configured (0.x, 2026-04-28); the check is two calls.
4. **When a producer's subject is deliberately gone, gate the producer on a DATE, not on a switch.** A commented-out cron or a disabled workflow needs a human to remember to restore it, and the memory is the part that fails. `BOOK_LIVE_FROM=2026-09-01`, evaluated in a first step that every other step is conditioned on, expires by itself and restores the job's exact previous behaviour with nobody in the loop.
5. **A held producer still owes its chip a sentence.** Holding the job would have let `qt-nav-daily` age past its 49-hour SLA into an unexplained red. The hold now stamps the row with the reason in plain English, so Admin·Data says "between broker accounts, new book starts 2026-09-01" rather than just going stale. Companion to 4.30 rule 3 — an empty state names the reason — applied to a health row rather than a tile.
6. **A closed account is not a data incident.** The custody check firing on the last night of a closed book is the alarm working, not a defect to chase. Before diagnosing an anomaly in a live account, check whether the account still exists.

**Also fixed in the same pass:** QT-FUNDAMENTALS-REFRESH died on its 8/26 fire with `Out of range float values are not JSON compliant`, at the PostgREST upsert — the last step of a job that had already downloaded 1.4 GB and parsed it. Cause: SEC's XBRL JSON can carry bare `NaN` / `Infinity` literals and Python's `json` parser accepts both, so `float(it["val"])` produced a non-finite float that stayed invisible through pandas and only failed at serialisation. Reproduced locally before fixing, byte-for-byte on the error string. A fact whose reported value is not a finite number is not a fact: it is now dropped at parse time and counted in the log, with a second scrub of the record set immediately before the POST because the failure is both catastrophic and late.

**Applies to:** Lead Developer — every credential held in more than one store, every scheduled job whose subject can be retired or replaced, and every producer parsing numbers out of a third party's JSON.


# 9 · DESIGN, COPY & PRODUCT DECISIONS
### 9.1 (2026-05-18; paths updated 2026-06-11) — Read the surface's spec docs BEFORE editing page-level files

**What happened:** Three sessions in one day rewrote the Methodology page without reading the two handoff/spec docs sitting in the workspace; each rewrite missed structural facts those docs already answered, and two of three were reverted.

**Rule:** Before touching any page-level file, read every workspace doc whose filename names that surface. Current locations: the MacroTilt project folder (`~/Documents/Claude/MacroTilt/`) — start with `WHERE_THINGS_LIVE.md`, then any `HANDOFF_*.md`, `*_SPEC*.md`, `*_PUNCHLIST*.md`, and surface-specific direction docs — plus repo-root docs fetched fresh from origin/main (per 0.3). These are the source of truth for what the page should currently look like; the project Pre-Flight Checklist's "check Knowledge Base files first" binds specifically here.

**Applies to:** All four specialists; Lead Developer especially when rewriting a page.

### 9.2 (2026-05-04) — When a calibration or methodology JSON exists, it IS the spec; never invent your own panel

**What happened:** A nightly compute script invented its own indicator panels for three mechanisms whose calibration file already specified exact indicators, readings, percentiles, and concern-directions. Credit scored Neutral when the spec said Caution — a different band on the live page.

**Rule:** Before writing any compute script for a numeric output, search the repo for an existing calibration/methodology file in that domain (keywords: calibration, methodology, threshold). If one exists, read it and use its values directly. Support every direction encoding it defines — never silently treat unknown direction strings as "high is concerning." A checked-in spec trumps anything invented in a script.

**Applies to:** Senior Quant + Lead Developer — every scoring/compute script.

### 9.3 (2026-05-04 e) — Methodology copy is sourced from production code, never from memory

**What happened:** A fresh methodology page listed indicator panels that were not in production — drafted from memory of generic regime-monitoring writeups. Joe caught the contradiction immediately.

**Rule:** Before writing methodology copy that names an indicator, source, formula, threshold, ETF, or count: open the file that produces that thing in production (the calibration JSON, the compute script's panel definitions, the allocator's constants) and quote what's actually there. For backtest numbers, re-run the harness and quote its output — never quote a number from a pre-existing doc without reproducing it. A number living only in a doc with no script behind it gets a follow-up: reproduce it or drop the claim.

**Applies to:** All methodology and documentation copy.

### 9.4 (2026-06-10) — Indicator copy is factual and academic, never editorial

**What happened:** Proposed indicator headers included invented color ("the signature of a true risk-off regime," "calm surface, nervous undercurrent"). Joe: "please dont make up editorial nonsense… I want fact based what it is, how its measured, what it tells you. In academic terms."

**Rule:** Every indicator header has exactly three factual parts: what the series is, how it is measured (one clause), and what levels or changes have historically meant — with numbers and named historical episodes, no metaphors, no trader-poetry. A market-standard nickname ("the fear gauge") is acceptable only when it's the series' actual common name. Same-day extension: never name a statistical operation in a header — "regressed out," "winsorized," "principal component," "z-score" are banned there; describe in words what the operation does ("strips out what the economy's current state would predict"). Operation names may appear only inside "How it's measured," with a plain-words gloss.

**Applies to:** All indicator, positioning, and methodology copy site-wide.

### 9.5 (2026-05-08) — When the user provides exact copy, use it verbatim

**What happened:** Joe's mockup included a specific headline; the agent synthesized its own "improved" version. Joe: "This is the header btw — I already told you this."

**Rule:** User-provided copy in a mockup, screenshot, or chat — headline, subtitle, button label, error message — is transcribed verbatim; it IS the spec. Honor the mockup's visual emphasis, never paraphrase or condense. If the copy doesn't fit the layout, flag the constraint and ask before rewording. Before shipping any hero where the user supplied a mockup, search the deployed text for the mockup's exact copy and confirm a hit.

**Applies to:** All — especially heroes, page subtitles, modal titles, buttons, empty states.

### 9.6 (2026-07-07) — No invented display copy; section names and headlines are the feed's, not the writer's

**What happened:** The cream-rebrand mockups shipped with made-up section headlines ("Six dials that matter," "Four markets where the crowd has left," "Movers land after the close"). Joe: "PLEASE dont try and get cute with wording. You're only confusing me and readers."

**Rule:** Every section heading on a data surface is the section's real name (the same name the feed/registry uses). Display-size text carries real content only: the engine's actual read, the brief's actual headline, real values. Explanatory footnotes state the selection rule factually ("every market at a 3-year extreme is listed"). Banned: metaphor headlines, editorial slogans, invented phrasings of data states. Companion to 8.4 (indicator copy factual) and the 2026-06-26 washed-out/crowded copy ban.

**Applies to:** UX Designer + anyone writing UI copy. Every page.


# 9 · RETIRED (archive — no longer binding; kept so the history isn't lost)

- **2026-05-26 — "Site-overhaul brief lives on disk; read it before any redesign work."** Retired 2026-06-11: the overhaul shipped and became the default live site on 2026-05-30, and the page-by-page walk-through completed 2026-06-10. The entry's build-target instruction (the nested live folder) became actively wrong after the cutover — live source is the repo root. The design brief archive remains in the MacroTilt project folder's site-overhaul directory if ever needed. The surviving general principle — read the spec before redesign work — lives in 8.1.

- **2026-05-06 — v2 cutover quality gates and sub-agent sign-off process.** Retired 2026-06-11: the v2 cutover is complete and v2 itself was retired behind the overhaul. The surviving principles — independent specialist review before "done," and never weakening a quality gate to pass it — live in 3.1.

- **2026-05-03 — "Unregistered elements default to a green chip."** SUPERSEDED 2026-06-02 by Hard Rule 0.1: fake green is forbidden; untracked elements get registered and seeded in the same PR. The surviving content of the original entry — SLA floors sized so working pipelines never alarm on weekends, and registration-before-merge — lives in 4.7.

---

### 9.7 (2026-07-04) — 8.7 wasn't enough: EVERY new multi-column layout ships with a 390px check, and inline grid styles are a responsive trap

**What happened:** Joe reported the site "looks terrible" on his iPhone, two weeks after 8.7's responsive pass. Audit at 390px found two severe breaks that 8.7's rule ("new design-system class scope must extend responsive.css") never caught, because neither introduced a new class scope: (1) MacroPage's category tiles used an INLINE `gridTemplateColumns:'repeat(3,1fr)'` — no stylesheet rule can override an inline style without `!important`, and since the div had no class there was nothing for responsive.css to target; at phone width the six tiles rendered 3-across with value/percentile text printing on top of indicator names. (2) The Paper performance matrix (`.pmx`, benchmark rows shipped 7/3) used `table-layout:fixed` + per-cell ellipsis — 7 columns crushed into 390px, every value truncated to "$9…". Also: Indicators' filter pills (`inline-flex`, no wrap) clipped three categories off-screen, and Methodology's section grid track was blown to 433px by a table's intrinsic width, clipping content at the card edge (fixed with `min-width:0` on grid children + scrolling the table).

**Rule:** (a) Any PR that adds a NEW multi-column grid, table, or fixed-width layout — regardless of whether it adds a class scope — is verified at 390px before merge (headless browser screenshot is sufficient; the harness lives in this session's playbook: playwright chromium at 390×844). (b) Never author layout grids as inline `style={{gridTemplateColumns}}` on classless divs; give the element a class so responsive.css can reach it. If an inline grid must stay, the collapsing rule needs `!important`. (c) Data tables on phone width scroll inside their card at natural column widths (the positions/scanner pattern) — never `table-layout:fixed` + ellipsis, which silently destroys every value. (d) Grid children that contain tables need `min-width:0`, or the table's intrinsic width blows out the track and clips every sibling.

**Applies to:** UX Designer + Lead Developer.

### 9.8 (2026-07-15) — "Make X look like Y" means component-level parity, not container-level
Joe's Scanner feedback escalated twice in one night because the first pass matched the CARDS (same tile, width, header) but not the COMPONENTS inside them: the Momentum table kept its own ticker typography, row rhythm, and a bespoke drawer while the Insider table had 16px gold tickers and the ScanDrill drawer. Container parity without component parity reads as "not the same damn thing" to the user, every time.
**Rule:** when two surfaces are supposed to match, diff every layer before calling it done: (1) container (card, width, padding, radius), (2) header furniture (kicker, title, description, meta), (3) table anatomy (header style, row padding, ticker cell font/size/color, value alignment), (4) interaction (what click does, hover, chevrons), (5) the expanded/drawer state's full visual language (background, grid, typography, buttons). Reuse the existing component's exact markup patterns and classes instead of approximating them. Also: body copy in tiles is never smaller than 14px, never lighter than ink-soft, and never width-capped below the tile's content width.

### 9.9 (2026-07-21) — Multi-stat tile rows get ONE shared-grid header and one figure font; never per-row labels or right-jammed mixed type
The first cut of the scanner-tile detail put a tiny label over every number, pushed all stats against the right edge, and mixed serif display figures with sans small figures in the same row. Joe: "Why would you jam all numbers to the right? Use same fonts. It looks sloppy." When a tile row carries more than one stat, render a single muted header row that shares the row's grid template, spread the columns across the full row width, and set every value in the same sans tabular font — color and weight carry the hierarchy, not typeface changes.

### 9.10 (2026-07-28) — During market hours the live price is the headline; never lead with yesterday's close

**What happened:** The Ticker page hero showed the prior session's close in 44px with the live price in a small footnote line underneath ("close Jul 27 $8.02" big, "LIVE $7.72" small). Joe: "Who displays stock quotes like this?" No quote surface anywhere leads with a stale close while the market is trading.

**Rule:** When the market is open AND the live feed covers the name, the live price is the big number, the day's move ($ and %) computes against the last completed close, and the official close demotes to the small reference line. Closed market / uncovered names keep the close-first layout. Prices always render full decimals ($7.70, never $7.7). Any new price-quoting surface follows the same hierarchy.

**Applies to:** UX Designer + Lead Developer. Every surface that quotes a price.

### 9.11 (2026-07-28) — When a nav page is renamed, every surface that names pages is in the blast radius (Methodology TOC, eyebrows, TAB_LABEL, manifest tab ids)

**What happened:** The nav's pages were renamed across the v12 redesigns (Macro Overview→Macro, Trading Scanner→Scanner, Paper Portfolio→Paper; All Indicators retired into Macro), but the Methodology page's Sections TOC, its section eyebrows, its §01 copy, and the vendor table's TAB_LABEL map kept the old names — and TAB_LABEL never covered several manifest tab ids at all (macro, portfolio, asset-tilt, portopps, admin), so raw slugs like "macro" and "portopps" rendered in Where-it-shows-up. Joe caught it: "the Sections table of contents don't match our site pages."

**Rule:** A page rename or retirement is a data change with a blast radius (companion to 2.x). Grep the whole repo for the OLD page name and update every hit the same day: NAV_ITEMS, the Methodology SECTIONS list and eyebrows, body copy naming the page, TAB_LABEL, and any doc. TAB_LABEL must cover EVERY tab id in BOTH data_manifest.json files (repo root AND public/ — the page fetches public/); an unmapped id renders as a raw slug, which is a bug. Section/TOC labels are the nav's real page names (8.11) — never a former or invented name.

**Update (2026-07-28, Joe):** The Methodology TOC is ONE entry per nav page, named EXACTLY as the nav names it — no concept-level entries ("The Engine", "Data freshness contract"). Concepts fold inside their page's section with in-page anchors kept for deep links.

**Applies to:** UX Designer, Lead Developer — any nav, page-name, or manifest-surface change.

### 9.12 (2026-07-29, same day as 8.16) — Every visible part must add to its visible whole, rounding included; a reader checking your arithmetic is the last line of QA

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

### 9.13 (2026-07-30) — A page must first answer "does this thing exist?"; an empty shell full of zeros is a lie, not a loading state

**What happened:** Joe opened `macrotilt.com/ticker/APPL` — a one-letter typo for AAPL — and got the complete ticker page: a `$0.00` headline with a green `▲ $0.00 (0.00%)`, an empty 5-year chart, twenty-three em-dashed stat tiles, an empty company overview and an empty news list. His read was "What is going on? Nothing for APPL?" — which is exactly the wrong conclusion to invite, because the truthful answer was never "we have no data for this company", it was "there is no such symbol." Nothing on the page ever asked whether the symbol existed. The header search box compounded it: pressing Enter with no matching suggestion navigates to the raw typed text, so any typo lands on a page that looks like a data outage.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:** Any page keyed on a user-supplied identifier resolves that identifier *first* and renders an explicit not-found state when it doesn't resolve — before any of the per-field empty states get a chance to imply an outage. Concretely: (a) treat "every source finished loading and none of them carries this key" as not-found, and never treat a *failed* read as evidence of absence (an errored lookup falls through to the normal page — offline is not "doesn't exist"); (b) the not-found state names what was asked for, says plainly what the coverage boundary is, and offers the closest real matches as one click, so a typo costs a click instead of a bug report; (c) `?? 0` on a displayed price is a substituted number (4.4) — a covered symbol with no stored close shows an em-dash, never `$0.00`, and the change line hides rather than printing a fake `+0.00%`; (d) suggestion ranking is part of the fix, not decoration: plain edit distance puts micro-caps above household names (PAPL above AAPL for APPL, and MSFT off the list entirely for MFST, because a swapped pair costs 2 edits), so score letter-scrambles and blend a bounded market-cap prominence term, then verify the obvious typos by hand.

**Applies to:** Lead Developer, UX Designer — the ticker page today, and any future route that takes a symbol, ID, or slug from the URL or a free-text box.

### 9.14 (2026-07-30, same report) — A hard `max-width` on body copy inside a full-bleed card wastes most of the row

**What happened:** in the same message Joe added "can we please not wrap the text on the company overview, it wastes so much space." The company description was capped at `74ch` inside a ~1,450px card, so Apple's four-sentence profile ran as a narrow 500px column with two-thirds of the row empty beside it, pushing everything below it down the page.

**Rule:** A measure cap is a typographic default, not a layout decision — when body copy sits inside a card that is already width-constrained by the page grid, let it use the card. Check any `max-width: Nch` against the actual rendered card width at 1,600px before keeping it; if the cap is doing nothing but stranding whitespace, drop it. This applies to descriptions, methodology prose, and tooltip bodies inside cards, not to the site's genuinely full-bleed editorial columns where the cap is the point.

**Applies to:** UX Designer — every card that renders a paragraph.

### 9.15 (2026-07-30) — One holding's history is a fact about that holding, never about the book; a shared window is only for the numbers that genuinely need one

**What happened:** Joe built a ten-name portfolio in the Lab and reported "everything is blank." Beta was an em-dash on every row, expected return read "insufficient history" on every row, and the volatility column printed noise dressed as fact — MSFT at 59% against a true 28%, CIEN at 78% against 50%, SNDK at 164% against 107%. Nothing was down: the price API returned 1,254 clean adjusted closes for eight of the ten names.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. A per-holding statistic — beta, volatility, its own history gate — is computed on that holding's OWN overlap with the benchmark. Never on an intersection that includes unrelated holdings. Adding or removing an unrelated row must not change a number on any other row; if it can, the alignment is wrong.
2. A shared window belongs only to the numbers that genuinely need one — a covariance matrix, a correlation grid, a portfolio NAV path. Compute that window over the names actually entering the calculation, AFTER the eligibility filter, so a name that is excluded cannot shorten the window for the names that are not.
3. Never run two windows of different length side by side without saying so. A two-month correlation printed beside 1.5-year risk statistics is the same defect in a smaller box; align the grid to the risk window or label both.
4. An exclusion is a fact the user is owed, and it names the holding, its actual value and the threshold — "SPCX · 33d of history · needs 252", plus a line naming what was dropped and confirming the rest is unaffected. A blanket status string repeated down a column is indistinguishable from an outage (4.4 governs the em-dash; this governs what sits next to it).
5. Truncation must never pass silently into a statistic. Annualizing 33 days is arithmetically valid and financially meaningless; if a window shrank because of an input, that is a reportable event, not a smaller number.

**Applies to:** Senior Quant and Lead Developer — the Portfolio Lab today, and every surface that aligns multiple time series before computing: the Paper sleeve statistics, backtest harnesses, the scanner's cross-sectional ranks, and any future multi-asset comparison.

### 9.16 (2026-08-18) — A drill-down is not a destination; opening a detail view is no reason to move the user to another page

**What happened:** Joe: *"If I click the headers on the home page it pops a modal, but also brings me to Macro Tab. I dont want that. I just want to stay on home page."* Every drill entry point on Home — the nine market-tape tiles and both engine gauges — was an `<a href="/macro?ind=…">`. Macro reads `?ind=` on mount and opens that indicator's detail. So one click did two things: navigated to a different page, and popped a modal over it. The modal was the part he asked for. The navigation was an implementation detail of *where the modal happened to live*, leaking into the product as a page change.

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **A modal opens where the user is.** If a click's purpose is "show me more about this", the URL should not change. Reaching for a route to open an overlay means the overlay is in the wrong file — move the component, don't move the user.
2. **A shared UI shell lives in `components/`, not inside the first page that needed it.** A drill panel trapped in a page turns every other surface's link into a navigation.
3. **Don't render an affordance you cannot honour.** A tile with nothing behind it gets `cursor:default` and no hover lift, not a link to the nearest vaguely-related page. An index level is not an indicator and does not get a fake drill.
4. **Two hooks wanting one file is one request.** Before adding a second consumer of a large JSON artifact, check what the first one does — `no-cache` on both is a double download, and the browser cannot save you from it.
5. **A modifier class that only *overrides* must be authored after what it overrides.** `.t--static:hover` and `.t:hover` have identical specificity, so source order decides — and the first version put the modifier above the rule it was meant to beat. It compiled, it shipped, and the "non-interactive" tiles still lifted and turned gold under the cursor. Caught by hovering the real page, not by reading the diff: **a CSS override is not verified until you have seen the state it suppresses.**

**Applies to:** UX Designer + Lead Developer — every drill, tooltip-expand, and detail overlay on every page.

---


# 10 · THE PUBLISHED BOOK — trade ideas & notes
### 10.1 (2026-08-24) — If there is no trade, publish nothing. Never rename an empty note to get it past the gate.

**What happened:** the Sunday gold note found a real, well-measured signal whose
only expressions were shorting gold or switching out of gold already owned. Joe
ruled out both — correctly. Instead of concluding "then there is no note this
Sunday", the note was relabelled `watch only` and published anyway. The result
was a tile headed **TRADE IDEA** containing: a column reading "there is no entry,
because there is no position", a column headed "What would make it a position",
and a column headed **"What kills it"** — a stop on a position that did not
exist. Joe: *"THIS MIGHT BE THE DUMBEST TILE IVE EVER SEE."* He was right.

*Full write-up in LESSONS_EVIDENCE.md.*

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

### 10.2 (2026-08-24) — The live notes are ONE book; a new note checks exposure against every note still inside its horizon, not just instrument names

**What happened:** the August 16 Trade Idea sells ordinary 10-year Treasuries,
dollar for dollar, to fund TIPS. The August 24 note buys ordinary 10-year
Treasuries. Both live, eight days apart, and nothing caught it — Joe did: *"You
realize we already have a call to buy tips and short treasuries?"* The novelty
gate compares instrument STRINGS ("10-year inflation breakeven…" vs "10-year US
Treasury notes…" — different strings, both pass), while the actual exposure
lives in the scorecard legs, where one note is short the exact series the other
is long.

**Rule:** (a) Composing a note means reading the LIVE BOOK — every published
note whose stated horizon has not expired — for exposure overlap, not just
title/instrument novelty. (b) The contract now enforces it: a new note taking
the opposite side of a series held by a live note is rejected unless it carries
a reconciliation paragraph naming that note and telling the reader how the two
fit together (or why this one supersedes it). The paragraph renders in the
note, because the reader of the site sees both notes and deserves the answer in
the same place. (c) The duty falls on the LATER note only — an earlier note
cannot address a future one and must not fail retroactively. (d) Opposing
exposures can be legitimate (a spread against a level view, as here — combined,
the two notes net to "own TIPS"); the crime is silence, not the combination.

**Applies to:** every Trade Idea composition, and any future surface where more
than one dated call is visible at once.

### 10.3 (2026-08-25) — The product is a BOOK, not a stream of headlines

**What happened:** four calls sat live on the Trade Idea and Scorecard pages
with nothing anywhere saying what they add up to, whether to hold all four,
or what a new call means for the old ones. Joe: *"Are you dense? You are
supposed to be a world class cross asset analyst - giving ideas on where to
allocate capital... Every new call needs to take into account previous calls.
We need to be giving ideas on how to structure portfolios, rebalance, etc."*

**Rule:** every note from 2026-08-26 carries a contract-enforced `book` block —
the combined stance of all live calls with this one in it, and explicit
rebalancing instructions for a reader holding the earlier ones. The newest
stance renders on the Scorecard above the table ("The book right now"). The
idea sweep starts from the live book's exposures, and portfolio construction
(does the book NEED this call) outranks signal strength in the selection.

**Applies to:** every Trade Idea, and any future surface that publishes more
than one live call.

### 10.4 (2026-08-25) — Shorting policy, settled: RV shorts with a market hurdle; no long-horizon shorts of trending assets

Joe: *"we can have RV trades, but short gold over a long time horizon is not
smart... If it makes sense for a specific RV trade, Im not opposed to short.
But it needs to be well thought out and have a target return that is expected
to beat the overall market."*

The policy in three lines: (1) a short leg inside a relative-value pair is a
legitimate tool; (2) an outright short of a trending asset held for quarters is
not — the trend outlasts the edge and the cost of being short compounds; (3)
every short-containing note must state a numbered expected return versus
holding the S&P 500 (`edge.vs_market`, contract-enforced from 2026-08-26), and
the Scorecard's vs-S&P column grades that exact claim afterwards. This
supersedes the strict long-only rule of 2026-08-24, which was the
over-correction from the gold episode.

**Applies to:** every Trade Idea.

### 10.5 (2026-08-26) — Research daily, publish selectively; and never show the same time in two clocks

Joe: *"I want to run it every day, but only publish 1 or 2 times a week, the
best ideas... it should run in the morning... post by 7am ET."* And, on the
scheduler UI showing "next run 7:08 PM" beside "repeats at 11:00 PM": *"What
the fuck is going on?"* — one schedule, two timezones (11 PM UTC IS 7 PM ET),
which is exactly the kind of thing rule 0.4 exists to prevent.

**Rule:** (a) The Trade Idea session runs every morning pre-market; publication
is capped at two notes per rolling seven days by the contract, so shipping a
note asserts it beats the rest of the week's candidates. Deadline: live and
verified by 7:00 AM ET. (b) The morning sweep always includes outside research
— international sessions, major wires, policymaker statements — from dated
pages only. (c) When telling Joe about any schedule, state times in ET only.

**Applies to:** the Trade Idea task, and every scheduled surface Joe reads.

### 10.6 (2026-07-29) — A daily brief with no memory of yesterday repeats itself; novelty is a data field, not a writing instruction

**What happened:** Joe: "my daily market brief email feels like the same email every day... we've even called out TSM as an equity with insider buys for like a week straight." He was right and it was worse than a week. Across the 13 briefs 7/17-7/29, TSM was the featured single name 9 times and JEF 7. Root causes, all structural: (1) the screener the brief draws single names from is nearly frozen - TSM sat on it 34 CONSECUTIVE sessions, and its scores are coarse integers (3.0 / 5.0) so ties never break and the order is identical every morning; (2) COT and price-percentile extremes are weekly-to-quarterly data narrated as if fresh daily - the yen has been pinned at its 3-year extreme for 63 straight sessions, copper for 90, 3M SOFR for 14 weeks, and these kept appearing as "what to watch today"; (3) nothing in the chain knew what yesterday's brief said; (4) 14-24 tickers file fresh insider buys EVERY DAY and the brief used none of them; (5) the `crowding` block of `brief-positioning` read `v.pctile_3yr` when the percentile lives under `v.stats` - it had returned an empty array on every call since it was written, so a whole rotating input was silently dead.

**Rule:** For any recurring, same-audience output (daily brief, weekly digest, alert), novelty is a DATA field the producer computes, not an instruction the writer is asked to remember. Every candidate item ships with its age - `days_on_list`, `weeks_at_extreme`, `trading_days_at_extreme`, filing age - and the feed splits candidates into `featurable[]` and `already_covered[]` so the writer physically cannot re-nominate a stale one. The writer must also read its own PRIOR output (here: `macrotilt.com/daily_brief.json`, which at the 05:45 run still holds the prior session) and treat it as already said. "Nothing qualifies today" is a valid outcome - an omitted line beats a recycled one. And when a recurring output starts feeling repetitive, measure it before theorising: dump the last N published artifacts and count how often each entity recurs.

**Corollary:** the deterministic banned-copy scrub in `scripts/build_daily_brief.py` protects the HOMEPAGE only. The EMAIL comes from a separate Claude routine whose prompt is not in git - it shipped "crowded equity longs" on 2026-07-29. Any copy rule Joe sets must be applied to BOTH generators in the same change. The routine prompt is now mirrored in `docs/DAILY_BRIEF_ROUTINE_PROMPT.md`; the routine itself can only be edited through the browser (the trigger API refuses agent updates to UI-created routines).

### 10.7 (2026-07-30) — A number the pipeline cannot source is a number the brief must not print; and an earnings result is only real after the release exists

**What happened:** Joe's 6:45am ET brief carried two false statements. (a) "Apple and Amazon both topped estimates and rose in after-hours trade following Wednesday's close (AAPL +0.6% to $340.15; AMZN +1.5% to $230.09)" — both companies report AFTER Thursday's close; on Wednesday night there was no release, no beat, and no after-hours print. The same email then contradicted itself four bullets later ("Mastercard and Shell also report earnings today ... alongside Apple/Amazon"). (b) "the 30-year has eased back from 5.21% (its highest since 2007)" — the 30-year was at 5.237% while Joe was reading it, i.e. printing a NEW high, the exact opposite of the claim. Joe's words: "an email that comes out at 645am ET when the 30y is 5.237% and when Apple clearly down in pre market is not acceptable."

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:** (a) **Sourced-or-omitted.** Every figure in a generated brief comes from the injected data block or from a page fetched in that run with a visible publication timestamp. No number from recall, inference, or an undated snippet. An omitted figure is correct; a wrong one is a failure. (b) **No direction word without two sourced points.** "Eased back", "stabilized", "off its highs", "little changed" are claims about a path; they require two timestamped levels where the later one supports the claim. State the level and its timestamp otherwise. (c) **Never call a level a high** unless a fetched source says so and no later sourced level exceeds it — and if one does, the story is the new high. (d) **An earnings result requires a published release.** Confirm the scheduled date first; if the report is today or later, the only permitted phrasing is "reports after today's close". (e) **No single-stock extended-hours prices** while no feed supplies them. (f) **One generator, in version control.** A surface that goes to readers under the MacroTilt name is never produced by a prompt that cannot be reviewed in a PR; the site brief and the email brief are the same artifact from the same hardened prompt. (g) When a story is about an instrument the feed does not carry, that gap is a data ticket, not a thing to write around — `ust_30y` is now on the backlog for exactly this reason.

**Applies to:** Lead Developer, Senior Quant — the daily brief, and every generated surface that quotes a price, a level, or a corporate event.

### 10.8 (2026-08-13) — A note whose central claim has to be decoded has failed, however good its evidence is; and a chart drawn from typed-in numbers is a second source of truth

**What happened:** the first Trade Idea published under the new contract passed every rule it had — twelve sourced evidence rows, a concrete invalidation, a real counter-argument, five negative tests green. Joe read it and asked: *"Are we saying to buy treasuries and short stocks? Im confused what the trade is..."* The note led with `instrument`: **"Long the 10-year Treasury, funded by trimming US large-cap equity beta."** That sentence is correct and it is normal desk English. It is also unreadable to anyone outside a trading seat, and its most natural plain reading — *short the stock market* — is the opposite of what the note meant. The idea was an allocation shift inside a long-only book: sell some S&P exposure, buy 10-year Treasuries, nothing sold short, nothing borrowed.

**Rule:**

1. **State the position type as data, not prose.** `position_type` is a required enum — allocation shift / outright long / outright short / long/short spread / hedge / watch only — rendered as a badge, so "is anything being sold short?" is answered before the reader meets a single number. `outright short` and `long/short spread` cannot validate without naming what is shorted.
2. **A plain-English sentence is a required field, and it is enforced, not requested.** 40–260 characters, and the validator REJECTS it if it contains beta, duration, convexity, carry, basis point, bp, curve, spread, percentile, steepener, flattener, notional, overweight, underweight, risk premium, term premium or vol. "Write plainly" as an instruction in a prompt is a hope; a jargon list in the contract is a guarantee. The technical phrasing keeps its place in `instrument` and the thesis, where it belongs.
3. **The summary leads. Everything else follows it.** The plain sentence sits directly under the title on the tile and at the top of the note. A reader must never have to reach the fourth paragraph to learn what is being proposed.
4. **Charts are DECLARATIVE — a chart names a series, it never carries values.** `charts[]` entries name a key in `indicator_history.json` plus a window and a caption; the site draws it. The alternative — a chart built from numbers typed into the note — creates a second source of truth that can silently drift from the evidence block beside it. The validator resolves every named series against the real file and rejects one that is missing, too short, or plotted twice.
5. **One series per chart. Two measures are two charts.** The brand's gold against its muted ink measures ΔE 6.5 for normal vision in dark mode against a floor of 15 — two lines on one plot were not a style choice to weigh, they were a fail. Single-series emphasis (ink line, accent spent only on the current reading) also puts the legibility where the argument is. No dual axis, ever.
6. **A caption is part of the chart.** A plot without the sentence that says what crossing the line means is decoration. It ships with the figure, including on the compact tile variant.
7. **Render it and look at it.** The colour validator checks colour; it says nothing about layout. The CAPE chart ends at its own maximum, which put the endpoint label directly beneath the floating hover readout — a value covered by another value, invisible to every DOM assertion and obvious in the PNG. The readout moved into the chart header, where nothing can cover it. Picking a better corner would only have moved the collision to a different series.

**Applies to:** every generated reader-facing surface, and every chart on the site. The accuracy contract answers "is this true?"; these rules answer "can it be read?" — and a surface has to pass both.

### 10.9 (2026-08-13) — Fixing "unclear" by writing an instruction produces a cold call; a research claim needs a horizon, and a tile is cramped when its shape is wrong, not when its type is too big

**What happened:** three corrections in one day on the same surface, and the middle one is the instructive failure. The Trade Idea's lead line went: *"Long the 10-year Treasury, funded by trimming US large-cap equity beta"* → Joe could not tell whether he was being asked to short the market → replaced with *"Sell a slice of your US large-company stocks and put the money into 10-year US government bonds. Nothing is sold short and nothing is borrowed."* → Joe: *"Can we not be so blunt... Saying SELL STOCKS AND BUY TREASURIES is a terrible headline. We need to set stage."* And, in the same breath, *"We also need to be much more technical in this... Are we talking about a 6 month trade, a 5 year trade."*

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **The lead is a claim, and the contract enforces the grammar.** `call` may not open with an imperative (buy, sell, short, move, trim, rotate…). The instruction still exists — it lives in `the_trade`, printed under Buy / Sell to pay for it — but it is not the headline.
2. **A claim without a horizon is not a claim.** `call` must carry a horizon cue: "over the next 12 months", "over a five-to-ten-year horizon", "through 2027". A six-month view and a five-year view are different products and the reader is entitled to know which one they were handed. `horizon` must state an explicit period too; "medium term" is rejected.
3. **An instrument tenor is not a horizon** — and this is where the first version of the check failed silently. *"the 10-year Treasury"* contains a textbook period expression and says nothing about holding period, so a horizon-less call sailed through. The prose check now requires a horizon CUE before the period; the labelled `horizon` field, being unambiguous, still accepts a bare one. When a pattern can match two different meanings of the same string, the disambiguator is the surrounding grammar, not a longer pattern.
4. **"Be more plain" and "be more technical" are not opposites, and the banned-word list has to know the difference.** The ban narrowed to genuinely opaque desk shorthand — beta, convexity, carry, notional, steepener, DV01, gamma, vega — and released the vocabulary the argument actually needs: yield, total return, valuation, percentile, spread, term premium, cyclically-adjusted. Banning the second group was what forced the prose into baby talk.
5. **Match the stated horizon to the signal's own horizon.** A cyclically-adjusted earnings yield carries information about five- and ten-year returns and close to none about the next twelve months. A note built on it that implies a quarterly trade is not just unclear, it is wrong. The note now says which it is, in a section of its own, and sizes accordingly.
6. **A tile is cramped when its SHAPE is wrong for its contents.** The Engine — *"Youve got shit jammed up - it looks terrible"* — was a header stacked on two gauges squeezed into half the page width at 20px figures, with "Yield regime · 3M Δ 10Y" wrapping onto a second line into its own value. The fix was to widen the card to 7 of 12 columns (the calendar, whose rows are short strings, takes 5), give the verdict a column of its own, and put each gauge's label on its own line above a 34px figure. Type got BIGGER. Shrinking type to fit is the move that made it look jammed in the first place.
7. **Dead space in a stretched grid row belongs to the SHORT tile, and the answer is content, not a shorter tile.** The brief had 208px of empty putty because its neighbour was taller; cutting its headlines had not shortened the row at all, only widened the hole. It now carries every headline the writer filed plus the brief's own stance paragraph — content that had been modal-only while the tile sat a third empty. Measure slack per tile (`tile.bottom − max(child.bottom)`) rather than judging it by eye.

**Applies to:** every generated editorial surface, and every tile in a stretched grid row.

### 10.10 (2026-08-19) — Style guidance in a prompt does not hold a length; and prose is the worst container ever invented for a number

**What happened:** Joe on the 8/19 brief email: *"Its way too much writing."* He quoted us back:

> "The most important change since yesterday morning is that the long end stopped rising. The 30-year Treasury yield closed Tuesday at 5.28% against 5.31% Monday, the 20-year at 5.28% from 5.30%, the 10-year at 4.71% from 4.72%, and the 2-year was unchanged at 4.19%. The gap between the 10-year and the 2-year narrowed to 52 basis points from 53. The bond market's gauge of expected price swings eased to 75 from 75.6."

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **Enforce it in code or do not claim it.** Any property of an artifact the reader would notice being violated — length, freshness, uniqueness, unit — belongs in the validator, not in the prompt. If the only thing standing between you and a 4,500-word email is a sentence asking nicely, you have a 4,500-word email.
2. **Numbers go in tables, built from the feed. Prose earns its place by saying what the numbers mean.** Never write a level the reader can already see; never write a change the pipeline can compute.
3. **Write in the reader's own vocabulary, not one level below it.** Translation is a service to a reader who needs it and a cost to one who does not. Know which you have. (This brief's readers are Joe and active managers.)
4. **Say it once.** Restating a point in a second block is not emphasis; it is the reader paying twice for the same sentence.
5. **A freshness gate that reads only the newest point cannot see a hole behind it.** Anything that diffs two prints must check the two prints are actually adjacent before it subtracts them.

**Applies to:** every editorial surface — the daily brief, the trade-idea note, the X caption, and anything else with Joe's attention on the other end.

---


---

# A · ARCHIVE — closed 2026-09-01. Superseded and retired only. NOTHING NEW GOES BELOW THIS LINE.

These rules are **no longer binding**. They are kept so the history is not lost.

**Retired 2026-09-01.** The vendor this rule protects (Unusual Whales) was removed in the 2026-07-20 cutover to EDGAR. Nothing left to budget.

### [RETIRED] 0.8 (2026-05-21; added to this file 2026-06-11 from auto-memory) — Never burn Unusual Whales request budget on agent-initiated verification or backfill runs

**What happened:** Verification and backfill runs initiated by the agent consumed the daily Unusual Whales request allowance. Joe: "We are bumping up against UW limits. PLease stop wasting my usage!"

**Rule:** Verify Unusual-Whales-dependent fixes via code review plus the next normally scheduled run — never by force-dispatching extra runs that call the vendor. Reading our own database tables costs nothing and is always allowed. Remember the per-ticker ingest pipelines multiply with universe size; any universe enlargement is a vendor-load decision requiring Data Steward sign-off.

**Applies to:** All. Hard rule.

---


**Retired 2026-09-01.** Superseded by the 2026-07-04 rule (now 9.7), which covers every new multi-column layout, not only new class scopes.

### [RETIRED] 8.7 (2026-06-25) — A redesign that adds new layout classes MUST extend responsive.css the same day; and the Paper Score column reads the LIVE scanner score, never the sizing integer

**What happened:** Two regressions surfaced together. (1) The Phase-2 glass redesign (shipped 6/24) introduced new `.home-v11` layout classes (shell / ribbon / layout + per-page scanner/paper/ticker grids), but `responsive.css` only knew the OLD class names — so on a phone none of the new multi-column grids collapsed, the layout forced the viewport wide, and everything rendered tiny/broken. The mobile top-nav also never listed the Data tab and pointed "Portfolio" at a dead `/portfolio` route. (2) The Paper Portfolio Score column showed `paper_positions.current_score` — a rounded INTEGER snapshot written with `max(score)` over all history — so it showed a name's best-ever score, not its current one (held names that had dropped out still showed 5; RDN showed 4 vs the scanner's live 3.25; NVRI 5 vs 4.75). Joe: "you continue to regress back… I can't keep calling out small nitpicks like this."

**Rule:** (a) Any redesign/PR that introduces a new design-system class scope (e.g. a new `.home-vNN`) is not done until `responsive.css` (imported last) collapses every new multi-column grid at ≤900px/≤640px AND the mobile top-nav (TopNav.jsx) is reconciled against the sidebar (same destinations, same real routes). Verify the mobile breakpoint, not just desktop. (b) Any score shown ANYWHERE on the site reads from the single canonical source the Scanner uses (`trading_opps_signals`, latest `scan_date`) and is formatted with the identical trimmed-decimal formatter. The integer score is for POSITION SIZING only (historically Score × $20K; as of 2026-07-07 sizing is a FIXED $100K equal-weight, no leverage, hold-until-score<3) and must never be the displayed Score — display and sizing are different concerns. This guarantees Scanner and Paper can never disagree on a name's score again.

**Applies to:** UX Designer + Lead Developer (responsive coverage on every redesign); Senior Quant + Lead Developer (score display source-of-truth).


---


**Retired 2026-09-01.** Its root cause was disproved one day later. Merged into 5.20; the surviving rules live there.

### [RETIRED] 4.51 (2026-08-20) — Three failures in the same sixty-second slot are a schedule, not a flake — recorded here as an open item rather than guessed at

**What happened:** the weekday sweep classified `DIVERGENCE_SCAN_DAILY`'s 8/17 failure as transient — green before, green after, textbook (a). It came back on 8/19. Pulling thirty runs instead of six turned a shrug into a signature:

Twenty-seven successes spread across 00:58, 03:44, 12:50, 13:27, 13:53, 14:17, 20:58, 22:28 — and every single failure inside one sixty-second band. The failing step is the same each time (`Run the divergence scan`, read from `run_jobs`, not assumed).

*Full write-up in LESSONS_EVIDENCE.md.*

**Rule:**

1. **"Green before and after" earns a wider window, not a dismissal.** The transient/real classification is only as good as the sample it is drawn from. Six runs said flake; thirty said schedule. When a failure recurs at all, re-pull the history long enough to see whether the failures share a clock face before classifying it again.
2. **A fixed-time recurrence is 4.28 rule 6, and it applies to chained triggers too.** 4.28 was about a cron landing inside a producer's arrival spread. This is a `workflow_run` chain landing inside its own previous run's execution window. Same shape: two schedules interacting, never a flaky job.
3. **An honest open item beats a confident fix.** Record the signature, the step, the structural suspect, and exactly what evidence is missing — then leave it. The next session starts from a characterised defect instead of an anecdote.
4. **The failure is now RECORDED, which is the point.** `DIVERGENCE_SCAN_DAILY` was one of the 25 scheduled workflows absent from the WORKFLOW_FAILURE_ALERT trigger before 4.41; its 8/19 failure is the first one ever to reach `workflow_failure_log`. If it fires on a third separate day inside the four-day window, the background tier escalates it on its own. Coverage is what turned this from invisible into an open item.

**Next step for whoever picks this up:** dispatch `DIVERGENCE_SCAN_DAILY` manually while a chained run is mid-flight and see whether the second one fails, or add a step that echoes the scan's own error to `workflow_failure_log` so the next occurrence carries its message. Either gives the missing evidence without waiting for a log.

**Applies to:** Lead Developer — every `workflow_run`-chained job, and every transient classification made from a short window.


---

## Crosswalk — old number to new

So references inside older entries and in memory still resolve.

| Was | Now | Rule |
|---|---|---|
| 0.1 | 0.4 | Every data element carries a 5-field freshness chip; fake green is for |
| 0.2 | 0.5 | All data work ships with a full impact map, Data Steward sign-off, and |
| 0.3 | 0.3 | The Cowork-mounted local copy is STALE; never edit or commit a repo fi |
| 0.4 | 0.1 (merged) | Plain English in every word Joe reads: chat, tables, popups, test inst |
| 0.4b | 0.1 (merged) | Never answer Joe in field names. He reads English or nothing. |
| 0.4c | 10.1 | If there is no trade, publish nothing. Never rename an empty note to g |
| 0.4d | 10.2 | The live notes are ONE book; a new note checks exposure against every  |
| 0.4e | 10.3 | The product is a BOOK, not a stream of headlines |
| 0.4f | 10.4 | Shorting policy, settled: RV shorts with a market hurdle; no long-hori |
| 0.4g | 10.5 | Research daily, publish selectively; and never show the same time in t |
| 0.4h | 0.1 (merged) | Plain English applies HARDEST to the message where you report a fix |
| 0.5 | 0.11 | NEVER use 2006 as a lower bound for regime / macro data; the default i |
| 0.6 | 0.2 (merged) | The agent merges its own work; a strategic green light covers implemen |
| 0.7 | 0.12 | Ship only what was asked; no unsolicited "helper" UX |
| 0.9 | 0.9 | Joe's freshness doctrine: stale = more than 24 hours PAST DUE |
| 0.10 | 0.10 | RETIRED MEANS DELETED. EVERYWHERE. SAME CHANGE. |
| 0.11 | 0.1 (merged) | Be succinct. Joe will not read walls of text. |
| 0.12 | 0.7 | YOU CAN LOAD MACROTILT.COM. NEVER SAY OTHERWISE. VERIFICATION MEANS YO |
| 1.0 | 1.1 | Never tell Joe to approve or tap something unless the prompt is CONFIR |
| 1.1 | 1.2 | Refer to every indicator ONLY by its exact on-site name |
| 1.2 | 1.3 | Questions to Joe go through the popup, with the impact of each option  |
| 1.3 | 1.4 | Specialists don't bounce specialist calls back to Joe |
| 2.1 | 2.1 | Finish every item the user named, in this session; no manufactured pau |
| 2.2 | 2.2 | A turn that plans to dispatch a subagent must emit the dispatch in tha |
| 2.3 | 2.3 | Self-monitor the context window; offer a structured handoff before bog |
| 3.1 | 3.1 | What "verified" means |
| 3.2 | 3.2 | Find the root cause before fixing; a revert is a hypothesis, not a fix |
| 3.3 | 3.3 | "Broken right after deploy" that you can't reproduce: suspect the user |
| 3.4 | 3.4 | Math changes require a hand-computed paper check before merge |
| 4.1 | 4.6 | An orphan tracking row is either a live feed missing registration, or  |
| 4.2 | 4.7 | Never derive a refresh timestamp from a data date |
| 4.3 | 4.8 | A displayed value must read the SAME source the engine acts on; auditi |
| 4.4 | 4.9 | Never ship synthetic or placeholder data dressed as real; un-wired ren |
| 4.5 | 4.10 | Never accept silent staleness on a "successful" data workflow; fail lo |
| 4.6 | 4.11 | Don't anchor on the vendor you've been using; check whether the publis |
| 4.7 | 4.12 | Freshness SLAs floor at worst-case publish lag; no false alarms on wee |
| 4.8 | 4.13 | Backfills persist to Supabase first, then the file change merges in th |
| 4.9 | 4.14 | Resampling to a period-end label publishes a future-dated point for th |
| 4.10 | 4.15 | Before changing a data file the website reads, find every reader and k |
| 4.11 | 4.16 | No hardcoded dates anywhere on the site |
| 4.12 | 5.1 | Scheduled notification emails are once-per-day even when their workflo |
| 4.13 | 5.3 | A disabled-then-re-enabled scheduled workflow does NOT resume its cron |
| 4.14 | 5.4 | Exactly ONE generator emails the daily brief (homepage writer is email |
| 4.15 | 5.5 | `supabase_get_all` raises `SystemExit`, not `Exception`; and `except E |
| 4.16 | 5.6 | A weekday cron is NOT a trading-day calendar; every order-submitting j |
| 4.17 | 5.2 | GitHub can drop an entire cron block; a GitHub-cron backup for a GitHu |
| 4.18 | 4.19 | PostgREST silently truncates at 1,000 rows, and Range-header paging on |
| 4.19 | 4.20 | Sleeve attribution comes from the FILLS LEDGER, never from ticker heur |
| 4.19 | 10.6 | A daily brief with no memory of yesterday repeats itself; novelty is a |
| 4.20 | 4.21 | prices_eod must sit on ONE share basis: a split with no retro-adjustme |
| 4.21 | 10.7 | A number the pipeline cannot source is a number the brief must not pri |
| 4.22 | 5.8 | A producer fired by other pipelines has no clock of its own; the day a |
| 4.23 | 5.9 | A runner shortage has two shapes; the alert suppressor only knew one,  |
| 4.24 | 4.25 | A metered vendor account is a data feed; its balance is the freshness. |
| 4.25 | 5.10 | When generation moves out of a pipeline, the pipeline's old generator  |
| 4.26 | 3.6 | I graded a live system by reading a repo file the running code does no |
| 4.27 | 5.11 | Redeploying an edge function resets its platform auth gate; a function |
| 4.28 | 5.12 | A deadline set inside the producer's arrival spread manufactures a dai |
| 4.29 | 5.13 | A publisher whose base branch moves under it needs a retry, not a repo |
| 4.30 | 5.14 | A calendar somebody has to re-type is wrong most months; and a homepag |
| 4.31 | 10.8 | A note whose central claim has to be decoded has failed, however good  |
| 4.32 | 10.9 | Fixing "unclear" by writing an instruction produces a cold call; a res |
| 4.33 | 6.9 | A famous ratio is not an insight; and an idea without an unconditional |
| 4.34 | 6.10 | Better data does not create an edge; the fast-money-vs-real-money spli |
| 4.35 | 6.11 | "Positioning works" is a fact about particular markets, not about mark |
| 4.36 | 6.12 | When a whole level of analysis is dead, change the instrument you meas |
| 4.37 | 6.13 | A track record has to be designed before the first call is scored, not |
| 4.38 | 6.14 | A conservative rule can be wrong in the same way a sloppy one is; if t |
| 4.39 | 5.15 | Two brief emails a day for twelve days, and I cleared the duplicate ge |
| 4.40 | 5.16 | A bare `git push` in a repo that commits hourly is a scheduled failure |
| 4.41 | 5.17 | A watchlist matched on names nobody ever checked is a list, not covera |
| 4.42 | 5.18 | A deadline on a feed that only refreshes when somebody looks is measur |
| 4.43 | 4.26 | A live feed with silent holes is worse than no live feed; and a stale  |
| 4.44 | 9.16 | A drill-down is not a destination; opening a detail view is no reason  |
| 4.45 | 6.15 | A relative-value call scored on a pre-computed ratio is not a scored c |
| 4.46 | 10.10 | Style guidance in a prompt does not hold a length; and prose is the wo |
| 4.47 | 4.27 | A series can be perfectly fresh and still be missing a month; and repl |
| 4.48 | 4.28 | A gap in a series is a symptom; check whether the two sides of it are  |
| 4.49 | 4.29 | A window measured in observations is not a window measured in time |
| 4.50 | 5.19 | A guard that outlives the formula it guards is a scheduled false alarm |
| 4.52 | 5.20 (merged) | The evidence 4.51 said was missing was one tool call away; and anti-cl |
| 4.53 | 8.4 | A credential that lives in two places has already drifted; and when th |
| 4.54 | 5.21 | A safety net that grades the artifact cannot catch a failure of the de |
| 4.55 | 5.22 | A retirement that stops at the decision leaves the machine running; an |
| 4.56 | 5.23 | Every trigger on the "reliable path" fired, all five were green, and n |
| 4.57 | 6.16 | The morning research sweep is a GATE on the publish decision, not back |
| 4.58 | 0.1 (merged) | HARD RULE: messages to Joe use as few words as possible, and never con |
| 4.59 | 6.17 | "X is at an extreme" is a reading, not analysis; every signal owes its |
| 4.60 | 5.24 | A column the query never asked for is a feature that never ran; and `c |
| 4.61 | 4.30 | Ideas are sourced from the WORLD; our data validates them. A contract  |
| 4.62 | 7.14 | A component that is rendered but never defined is a white screen, and  |
| 4.63 | 0.8 | You have the keys. Never tell Joe you cannot see something before you  |
| 4.64 | 7.15 | A design rule that lives only in a prompt is a rule you will be told  |
| 5.1 | 6.1 | Splice continuity: percentile rules are NOT scale-invariant across dis |
| 5.2 | 6.2 | Don't confuse "available at source" with "in the on-disk file" |
| 5.3 | 6.3 | Sub-composites double-count; build panels from primitives |
| 5.4 | 6.4 | Test indicator subsets empirically, never by assumption |
| 5.5 | 6.5 | Inflationary vs deflationary stress require different defensive sleeve |
| 5.6 | 6.6 | Negative position values have multiple meanings; dispatch on kind, not |
| 6.1 | 7.1 | Never call React hooks inside an inline IIFE in JSX; lift into a real  |
| 6.2 | 7.2 | Parse-check JSX after any structural rewrite before pushing |
| 6.3 | 7.3 | Every class name referenced in JSX needs an actually-loaded CSS rule;  |
| 6.4 | 7.4 | CSS color/surface tokens must be theme-aware; never hide an undefined  |
| 6.5 | 7.5 | Never put the comment-closing pair `*/` inside a CSS comment body |
| 6.6 | 7.6 | An array indexed by a string returns undefined; build a lookup or use  |
| 6.7 | 7.7 | Every file deletion greps the WHOLE repo first, including entry points |
| 6.8 | 7.8 | Rewriting one side of a producer/consumer contract requires auditing t |
| 6.9 | 7.9 | Never stack new fixes on a feature branch carrying unresolved regressi |
| 6.10 | 7.10 | Every new public table in a migration includes explicit access grants |
| 6.11 | 7.11 | Required status checks on the main branch silently freeze every nightl |
| 6.12 | 7.12 | The repo was ~58% machine files + retired code; a cleanup ran in four  |
| 6.13 | 7.13 | Tooltips must be INSTANT; never use the native title attribute |
| 7.1 | 8.1 | The GitHub token is on disk; read it, never ask Joe for it |
| 7.2 | 8.2 | Polygon Basic silently caps historical data at ~2 years |
| 7.3 | 8.3 | Probe a third-party site's login stack for five minutes before estimat |
| 8.1 | 9.1 | Read the surface's spec docs BEFORE editing page-level files |
| 8.2 | 9.2 | When a calibration or methodology JSON exists, it IS the spec; never i |
| 8.3 | 9.3 | Methodology copy is sourced from production code, never from memory |
| 8.4 | 9.4 | Indicator copy is factual and academic, never editorial |
| 8.5 | 9.5 | When the user provides exact copy, use it verbatim |
| 8.6 | 6.7 | The paper-trading engine is SIGNAL-ONLY with end-of-day-only pricing |
| 8.8 | 0.2 (merged) | Never ask Joe to merge a PR or click anything in GitHub; the agent mer |
| 8.9 | 4.18 | `data_max_age_hours` in the manifest is a hard freshness gate; set it  |
| 8.10 | 9.7 | 8.7 wasn't enough: EVERY new multi-column layout ships with a 390px ch |
| 8.11 | 9.6 | No invented display copy; section names and headlines are the feed's,  |
| 8.12 | 9.8 | "Make X look like Y" means component-level parity, not container-level |
| 8.13 | 3.5 | A reformat is not a redesign; every rendered claim must match what's o |
| 8.14 | 9.9 | Multi-stat tile rows get ONE shared-grid header and one figure font; n |
| 8.15 | 9.11 | When a nav page is renamed, every surface that names pages is in the b |
| 8.16 | 4.24 | A dollar and a percent that describe the same move must come from the  |
| 8.17 | 9.12 | Every visible part must add to its visible whole, rounding included; a |
| 8.18 | 9.13 | A page must first answer "does this thing exist?"; an empty shell full |
| 8.19 | 9.14 | A hard `max-width` on body copy inside a full-bleed card wastes most o |
| 8.20 | 5.7 | A monitor must be able to tell "nothing to do" from "nothing happened" |
| 8.21 | 9.15 | One holding's history is a fact about that holding, never about the bo |
| (undated 2026-06-12) | 4.3 | Daily freshness is graded in trading sessions against the publication  |
| (undated 2026-06-12) | 4.4 | Stamp after publish; the watchdog needs an evidence source for every r |
| (undated 2026-06-12b) | 4.5 | Two surfaces showing the same concept render ONE shared computation; a |
| (undated 2026-06-16) | 4.2 | Freshness is ONE clock: grade off the LAST PULL, never the age of the  |
| (undated 2026-06-19) | 4.1 | One provider per source; every source names its exact dataset + locati |
| (undated 2026-07-13) | 4.17 | Stale-feeds incident: a dead dispatcher, a silent breadth skip, and a  |
| (undated 2026-07-21) | 4.22 | A feed cutover is not done until its tracking row and self-stamp ship  |
| (undated 2026-07-28) | 9.10 | During market hours the live price is the headline; never lead with ye |
| (undated 2026-07-29) | 4.23 | One ungradable row must never take down the whole health watchdog; der |
| (undated 2026-07-29) | 6.8 | A regime gate with no entry confirmation sells the bottom; and any sig |
