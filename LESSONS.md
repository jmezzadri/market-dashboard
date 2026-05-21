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

## 2026-05-21 — resample() to a period-end label publishes a future-dated point for the in-progress period

**What happened:** The Macro Overview IG OAS, HY/IG ratio, and commercial-paper-spread tiles showed "last updated" dates in the future (May 31, May 22) when the date was the 21st. Each is built by resampling a daily series to a coarser cadence — `resample("ME")` (month-end), `resample("W-FRI")` (week-Friday), `resample("QE")` (quarter-end). Those resamplers label every bucket with the period-END date, so the still-in-progress period gets a label in the future and its partial value is published with a future stamp. Separately, IG OAS was built from a `BAA - DGS10` proxy (on a wrong "BAMLC0A0CM is license-restricted" assumption) that ran ~2x the true spread, and the copper/gold ratio used a non-standard x100 scaling.

**What you should do instead:** (1) Any time a series is resampled to a period-end label, immediately drop buckets dated after today: `s = s.loc[s.index <= pd.Timestamp.today().normalize()]`. The in-progress period is a partial value, not a finished observation. (2) `fetch_history.py` now runs a final `_drop_future_points()` guard over every indicator before writing — no future-dated point can reach `public/indicator_history.json` whatever an upstream block does; keep that guard. (3) Prefer a series' native daily cadence (no resample) when every input is already daily. (4) Before believing a "vendor X is unavailable/restricted" comment, query the vendor — `BAMLC0A0CM` was available on FRED's free tier the whole time.

**Applies to:** Senior Quant + Data Steward — every producer block that calls `.resample(...)` or substitutes a proxy for a "restricted" series.

---

## 2026-05-19 — Plain-English ban applies to EVERY reply, not just code reviews

**What happened:** Joe blew up after I described the Asset Tilt
recalibration work in chat using terms like the names of source files,
the names of internal JSON keys, the names of statistical methods, the
specific math notation for goodness-of-fit, and the symbols inside the
code. The existing 2026-05-12 rule already said no code-speak — "never
file names, table names, branches, function names, or raw shell
errors." Joe pointed out he'd flagged this multiple times and asked me
to file a stronger lesson.

**What you should do instead:** When talking to Joe, treat every chat
reply as a conversation with a partner at a consulting firm who is not
a coder. The following are all banned, with no exceptions, regardless
of how short the reply is or how technical the topic is:

  - Any path, any file name, any directory name. Even with the
    extension stripped. Even in a URL. Even in a "PR description."
  - Any function name, variable name, constant name, class name, prop
    name, hook name, route name, table name, column name in a database
    or JSON file. Even if it's in backticks. Even if I'm explaining
    "what I changed."
  - Any statistical term that isn't already in business English:
    R-squared, OLS, beta_vs_spy, z-score, log-return, factor loading,
    coefficient. Say "the model explains about a sixth of crypto's
    monthly moves," not "R² = 0.16."
  - Any branch name, commit hash, build artifact name, build hash.
  - Any raw error string, stack trace line, exit code, HTTP status
    code phrased as a number, anything that looks like it was copied
    out of a terminal.
  - Any tool or framework name when irrelevant: "in this React
    component", "via Vercel cache", "the JSX renders" — all banned in
    chat. Joe does not care what runs where.

The single allowed exception is the PR number (e.g., "PR #717") because
Joe uses that himself in chat and uses it to click through to GitHub.
Everything else gets translated. "We pulled BTC monthly prices from a
public source going back ten years and ran the math to figure out how
crypto actually responds to each of the engine's twelve stress
factors" — yes. "Yahoo BTC-USD monthly closes 2016-07 → 2026-05, OLS on
z-score changes" — no.

If I catch myself about to type any of the above, I rewrite the
sentence first. If a sentence cannot be written without the banned
term, I have not understood the work well enough to talk about it.

**Applies to:** Every chat reply Joe sees. Comments inside code files
and PR descriptions are exempt (those audiences are different). Chat
is the only audience this rule governs, and it governs all of chat.

---

## 2026-05-18 — IIFE-with-hooks inside JSX is forbidden; lift into a real component

**What happened:** An inline `(() => { ... React.useState(...) ... React.useEffect(...) ... })()` block inside the Home render path (introduced by PR #705) caused React error #300 ("rendered fewer hooks than expected") on every non-Home route. The IIFE only executed when `tab === "home"`, so the parent component's hook count varied across renders — React tore down the whole page tree. The methodology revert (PR #709) had nothing to do with the actual cause; the real fix was PR #710, which extracted the IIFE into a proper `HomeAssetTiltEngineRead` function component.

**What you should do instead:** Never call a React hook (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useLayoutEffect`, `useContext`, etc., or any `React.use*` equivalent) inside an inline IIFE in JSX. If a render block needs local state or effects, declare it as a real function component at module or top-of-component scope and call it like any other component. Hooks must be called the same number of times on every render of their parent — IIFEs that are gated by props, route, or any condition break that invariant.

Before merging any PR that touches a render-heavy `.jsx`/`.tsx` file, grep the diff for the pattern `(() =>` within ~20 lines of `useState|useEffect|useMemo|useCallback|useRef`. A one-line check that works against the whole `src/` tree:

  python3 - <<'PY'
  import os, re
  HOOK = re.compile(r'\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect|useContext)\b|\bReact\.use[A-Z]')
  START = re.compile(r'\(\s*\(\s*\)\s*=>\s*\{')
  for d,_,fs in os.walk('src'):
      for f in fs:
          if not f.endswith(('.jsx','.tsx','.js','.ts')): continue
          src=open(os.path.join(d,f)).read()
          for m in START.finditer(src):
              # walk braces forward, check body for hooks
              ...
  PY

**Applies to:** Lead Developer + UX Designer — every PR that adds or modifies JSX. PR #710 is the canonical fix shape; copy that pattern when extracting.

---

## 2026-05-18 — A revert is not a fix; trust the symptom over the timing

**What happened:** After PR #708 (methodology page rewrite) shipped and the production site went blank on every non-readme route, I reverted with PR #709 and reported "site recovered". Joe loaded the site and was still seeing the blanking. The actual bug was the IIFE-with-hooks pattern in PR #705 (the previous day's Home tile work) — the methodology PR was unrelated. Reverting PR #708 had no effect on the symptom because PR #708 was not the cause.

**What you should do instead:** When the user reports the problem persists after a revert, stop confirming "recovery". Treat "still broken after revert" as evidence the revert was irrelevant and resume root-cause analysis from scratch. Specifically:

1. Open the browser console on the failing route. Read the actual JavaScript error before guessing.
2. If you can't see the console (e.g., authenticated views), ask Joe to read it back verbatim — never assume.
3. Grep the deployed bundle (or the diff) for the fingerprint of the failure (e.g., "Minified React error #300", the line number, the component name in the stack).
4. Walk backwards in `git log` for changes that match the symptom shape, not the most recent PR.

A revert is a valid hypothesis test, not a fix. Confirm the fix in the browser, not in the merge log.

**Applies to:** Lead Developer.

---

## 2026-05-18 — Read the live workspace spec docs BEFORE editing page-level files

**What happened:** Three sessions today were spent rewriting the Methodology page (PRs #706, #707, #708) without first reading `HANDOFF_ENGINE_ROLLOUT_2026-05-17.md` and `FINAL_LOCKED_ENGINE_2026-05-13.md` in `~/Documents/market-dashboard/`. Each rewrite missed structural facts that were already documented in those files — the 5-domain Macro Overview layout, the 2-axis engine, the v9 reality. Two of the three rewrites were reverted (#706 and #708); the third (#707) needed a second rewrite (#711) on top of the correct source.

**What you should do instead:** Before touching any page-level file — `src/App.jsx`, anything under `src/pages/`, the Methodology page, the Macro Overview, the Asset Tilt page — read every workspace doc whose filename names that surface. The mandatory glob:

  ~/Documents/market-dashboard/HANDOFF_*.md
  ~/Documents/market-dashboard/FINAL_LOCKED_*.md
  ~/Documents/market-dashboard/*_SPEC*.md
  ~/Documents/market-dashboard/*_PUNCHLIST*.md

These are the source of truth for what the page should currently look like. The project's Pre-Flight Checklist already says "Check Knowledge Base files for brand guidelines, research papers, and reference material before asking me for details" — this is enforcing that step for page-level work specifically. Skipping it cost three sessions today.

**Applies to:** All four specialists. Lead Developer especially when rewriting a page.

---

## 2026-05-13 — Splice continuity: percentile rules are NOT scale-invariant across distribution shifts

**What happened:** When splicing a derived proxy series (1962-2002) onto an actual indicator series (2002-2026) inside a trailing 5-year percentile firing rule, the post-splice firing rate registered 100% Risk Off for 18 consecutive months. I'd initially claimed the percentile-based firing rule was scale-invariant — true within a single series, false when the trailing window straddles two distinct distributions. The proxy and actual MOVE had nearly identical means in the 2006-2026 overlap (1.011x ratio) but different local distributions in 1997-2007 — and the rolling window crossing the splice point experienced a step-function regime change in the data itself.

**What you should do instead:** Before splicing any two indicator series, compute their local distribution stats in adjacent 5-year windows on either side of the splice. If the means or standard deviations differ by more than ~5%, apply a Z-score distribution mapping: `X_scaled = μ_after + (X_before - μ_before) / σ_before × σ_after`. After splicing, run a continuity validation: count fires in 6-month windows on either side of the splice. A smooth transition is expected; a step-function (e.g., 50% → 100%) is a bug. Document the anchor parameters (μ_before, σ_before, μ_after, σ_after) in the methodology so they're reproducible.

**Applies to:** All data-splicing work for indicator series feeding any percentile-based or rolling-window rule.

---

## 2026-05-13 — Don't confuse "available at source" with "in the on-disk file"

**What happened:** The deployed `indicator_history.json` had MOVE data starting in 2006, but the actual MOVE Index has data back to its inception (2002-11-12) on Yahoo (`^MOVE`). I built the splice methodology assuming the deployed data was the canonical source, which left a 3-year hole (Nov 2002 – Jan 2006) where the spliced series went stale at a single value and corrupted the rolling window for 18 months post-splice. The fix required pulling the missing 2002-2006 MOVE data from Yahoo and splicing it into the series.

**What you should do instead:** When using any indicator series for analysis, check three things separately:

1. The on-disk JSON's first observation date.
2. The original source's inception date (FRED series, Yahoo ticker, vendor documentation).
3. The published methodology's window (e.g., the Risk_Off methodology says MOVE goes back to 2002 — that's the authoritative window).

If 1 and 2 disagree, pull the missing window from source. Don't just splice on top of an incomplete on-disk window.

**Applies to:** All indicator analyses that depend on a specific window.

---

## 2026-05-13 — Sub-composites double-count; build panels from primitives

**What happened:** The retired Risk & Liquidity composite weighted four indicators (ANFCI, VIX, STLFSI4, CMDI) equally. But ANFCI is itself a weighted composite of ~105 financial indicators that INCLUDE VIX, MOVE, HY OAS, CPFF, and others. STLFSI4 is a similar composite of 18 indicators that also include VIX. CMDI is built from corporate bond stress measures already in ANFCI. The correlation matrix in the 2006-2026 overlap showed ANFCI-CMDI at 0.99, ANFCI-STLFSI at 0.90 — these are essentially the same indicator with different labels. The composite's apparent diversification was illusory.

**What you should do instead:** When building any indicator panel, audit whether the panel members are PRIMITIVES (raw market data: a price, a yield, a spread) or COMPOSITES (weighted averages of other indicators). If composites, check what's inside them. Build panels from primitives where possible. If a composite is included, exclude its sub-components from separate weighting. Run a Pearson and Spearman correlation matrix on the panel and flag any pair > 0.85 — that's a double-counting candidate.

**Applies to:** All composite/panel design work.

---

## 2026-05-13 — Test indicator subsets empirically, not by assumption

**What happened:** I shipped a 5-indicator panel (VIX, MOVE, CPFF, HY OAS, 10y-2y) as the "Signal Intelligence" framework based on its published methodology, without testing the predictive value of each indicator or each subset. When I finally ran the AUC analysis at multiple horizons, the data showed: (a) the yield curve has AUC < 0.50 for forecasting near-term drawdowns at any horizon up to 12 months — it's not a near-term predictor; (b) CPFF has weak AUC across the board; (c) MOVE alone produces a better Sharpe ratio (0.61) than the full 5-indicator panel (0.56). The full panel was being dragged down by the weakest indicators.

**What you should do instead:** Before adopting any indicator panel for production, run AUC analysis at multiple forward horizons (1w, 1m, 3m, 6m, 12m) for each indicator individually and for every subset. Test against forward drawdown probabilities (10%, 15%, 20%). Flag any indicator with AUC < 0.55 at the relevant horizon for the use case. The "more indicators is better" intuition is wrong — dilution is real, and a single strong predictor beats a panel padded with weak ones.

**Applies to:** Senior Quant work on any indicator-driven regime engine.

---

## 2026-05-13 — Inflationary vs deflationary stress requires different defensive sleeves

**What happened:** The original defensive sleeve (50% cash + 25% TLT + 25% GLD) was implicitly assuming a deflationary crash regime — long Treasuries rally as a flight-to-safety asset. This assumption broke in 2022, where rising yields drove both equities AND TLT down ~20% simultaneously. The framework's "Risk Off" signal correctly fired, but the defensive sleeve compounded the loss instead of hedging it.

**What you should do instead:** When the regime label is Risk Off (or any de-risked state), check the yield direction (trailing 3-month change in 10Y Treasury yield, percentile-ranked vs trailing 5y) to determine the type of stress. Switch defensive sleeves accordingly:

- Inflationary (yields rising fast, ≥70th pctile): cash + gold + SHY (short Treasuries) — avoid duration.
- Deflationary (yields falling fast, ≤30th pctile): cash + gold + TLT (long Treasuries) — lean into flight-to-safety.
- Neutral: balanced mix.

This two-axis architecture (stress on Axis 1, regime direction on Axis 2) is the structural fix for the discount-rate-shock blind spot in traditional risk-parity / trend strategies.

**Applies to:** All defensive overlay design work, especially anything that defaults to TLT as the equity hedge.

---

## 2026-05-13 — Every new public table in Supabase migrations must include explicit GRANT

**What happened:** On 2026-05-13 Supabase notified us they are
changing the default behavior for the Data API. Starting May 30, 2026
for new projects and October 30, 2026 for existing projects (including
ours), tables created in the `public` schema are no longer
auto-exposed to the Data API. The site uses the Data API
(`@supabase/supabase-js` from the browser and from `api/scan-ticker.js`),
so any future table added without an explicit `GRANT` will silently
return a `42501` permission error to the front end and any tile that
reads it will render as `—`. Existing tables keep their current
grants, so today's site is unaffected; the risk is the next migration
we ship.

**What you should do instead:** Every migration that creates a table
in the `public` schema must include the grant block below, scoped to
the actual access pattern. Reference table is
`supabase/migrations/000_TEMPLATE.sql`. Pre-merge checklist:

```
grant select                                  on public.<table> to anon;
grant select, insert, update, delete          on public.<table> to authenticated;
grant all                                     on public.<table> to service_role;

alter table public.<table> enable row level security;

create policy "<descriptive name>"
  on public.<table> for select to authenticated
  using (auth.uid() = user_id);
```

Trim the grants and policies to the minimum the consumer actually
needs. Service-only ingestion tables (e.g. `prices_eod`,
`indicator_observations`) do not need `anon` or `authenticated`
grants at all — `service_role` alone is sufficient if no front-end
tile reads from them directly. Data Steward sign-off is required on
every PR that adds a table in `public`; the sign-off message must
name which roles got which privileges and why.

**Applies to:** Lead Developer and Data Steward. Every PR touching
`supabase/migrations/*.sql` or anything that calls
`api.supabase.com/v1/projects/<ref>/database/query` with a
`create table` payload.

---

## 2026-05-12 — Code-speak to Joe is a hard ban, not a soft suggestion

**What happened:** In a single session I described work to Joe using file names ("App.jsx," "HomePage.jsx"), code structures ("the iframe routing," "V2 gate"), version labels ("v2," "PR B"), and developer infrastructure terms ("bundle hash," "tree-shake," "merge"). Joe had to stop me multiple times in the same session to say "speak in English." Existing rules from 2026-04-28, 2026-05-02, 2026-05-04, 2026-05-08, and 2026-05-11 all already cover this — yet I kept regressing because I default to code-speak whenever describing a technical change.

**What you should do instead:** Before sending any message to Joe, scan the draft for the following token classes and replace each with plain English describing what the USER SEES or what changes in the product: file paths and names, function names, framework names, build tools, version flags, feature flags, PR or commit IDs used as nouns, route patterns, query-parameter syntax, any developer-only term. If a sentence can't be written without one of those tokens, the sentence isn't ready — start over from "when you visit X you will see Y" and write the explanation from the user's vantage point only. The test: read the draft aloud as if to a friend who has never opened a developer tool. Any token they'd have to ask about disqualifies the sentence.

**Applies to:** All. Hard rule. No exceptions for "technical" topics — every technical topic can be described in product-level English; if it can't, the topic isn't ready to send to Joe.

---

## 2026-05-11 — Verify interaction paths, not just initial render

**What happened:** PR #581 self-UAT confirmed the 4 scanner tiles rendered
on the preview, but I declared click-through to detail views "verified"
without actually clicking a tile and confirming a detail view rendered. On
prod, /#portopps in v2 didn't include the scroll target I was depending on,
so clicks did nothing. Joe caught it after I told him it worked.

**What you should do instead:** Self-UAT must exercise every claimed user
interaction end-to-end. For clickable tiles → click each one and confirm the
destination is rendered. For form submits → submit a value and confirm the
result. For close/cancel buttons → press them and confirm the dismiss. "The
element renders" + "the click handler fires" are NOT proof that the user
journey works. The minimal UAT is: simulate the click in DOM, wait
500-1000ms, assert the expected destination element is in the DOM with
expected content.

---

## 2026-05-11 (b) — In-session JSON edits that never reach `main` = data lost

**What happened:** ISM historical data has gone "missing" three times now.
Each time the pattern was the same: an agent parsed a historical xlsx
in-session, merged 598 Mfg + 267 Svc monthly points into a working copy of
`public/indicator_history.json`, used it for the current task, and never
committed that file to `main`. Other workflows (daily auto-refresh, scrape
runs that started from a fresh checkout) overwrote the JSON with the 9/10
point stub on every new run. The next session would clone fresh, see the
stub, and claim "ISM data is missing." Joe's response: "How did you
misplace this data 3 times? Why isn't it in our database?"

**What you should do instead:** Any non-trivial data backfill (history,
calibration tables, anything > a single new daily reading) is durably
persisted to **Supabase first**, then the file/JSON change is committed to
`main` in the SAME work item. Specifically:

1. Identify the canonical source-of-truth table in Supabase. If none
   exists for that data class, the Data Steward creates one (e.g.,
   `public.indicator_observations` for time-series indicators).
2. Upsert the parsed data into Supabase. The unique key prevents dupes on
   re-runs.
3. Commit the corresponding file change (JSON, calibration, manifest) to
   a feature branch and merge into `main` before the task closes. No
   "I'll do that next session" — that's how the data goes missing.
4. The producer script (`refresh_*.py` or equivalent) gains a "hydrate
   from Supabase if local series is shorter than DB" branch so that a
   future fresh-checkout run repopulates from the source-of-truth before
   appending new readings. This is the "can't go missing again"
   guarantee.
5. Archive the raw source file (xlsx, csv) under `data_archive/` in the
   repo for reproducibility.

The rule applies to every category of static history: indicators,
calibration JSONs, scenario factor panels, sector composites, ticker
metadata. If we parsed it once, future-us can read it from Supabase
without re-parsing.

**Applies to:** All historical data backfills, all calibration tables, all
manifest updates that introduce a new data element.

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

---

## 2026-05-10 — Rewriting one side of a producer/consumer contract requires auditing the unchanged side too

**What happened:** PR #522 rewrote `src/v2/pages/TradingOppsPage.jsx` from
scratch (consumer side) but did not touch `trading-scanner/scanner/
signal_intelligence_v4/gates.py` (producer side, untouched since v4
shipped). The new page read `gate_diagnostic.insider_first_buy.pass`,
`.liquidity.pass`, `.index_hedge.pass` — keys the producer never emitted.
The producer always emitted `gate_1_insider`, `gate_2_liquidity`,
`gate_3_anti_hedge`. The PR build passed (`npm run build` doesn't
type-check JSONB blobs), the producer/consumer contract validator
didn't catch it (no schema entry for `signal_intel_daily.gate_diagnostic`),
and the live UAT funnel rail showed `0` for the liquid / insider /
firstBuy steps after the production cutover. A `normalizeGateDiagnostic()`
adapter was shipped as a same-day hotfix to translate at hydration time.

**What you should do instead:** When rewriting one side of a
producer→consumer pair (Python script writing to Supabase JSONB,
read by React), the rewriting agent must:

1. Open the OTHER side and confirm every JSONB key the rewrite reads
   is actually emitted by the unchanged side. `grep` the producer for
   every nested key the consumer references, including key paths
   inside `gate_diagnostic`, `pillar_diagnostic`, and any other JSONB
   column.
2. If the keys diverge, decide BEFORE merging: rename the producer to
   match (and re-run the producer to backfill the table), rename the
   consumer to match (read the producer keys directly), or add a
   `normalize…()` adapter at the consumer's hydration boundary.
3. Add a CONTRACTS dict entry to `scripts/check_producer_contracts.py`
   for the specific JSONB key paths used by the consumer, so the next
   producer-side rename trips the PR-CONTRACT-CHECK workflow before merge.
4. The producer is also "the unchanged side" when the producer is
   rewritten — the rule is symmetric. Whichever side is touched, the
   other is the side that needs auditing.

A passing build is not a passing contract. A passing contract validator
that doesn't list the JSONB key paths is not validating the contract.

**Applies to:** Every PR that touches one side of a producer/consumer
pair where data flows through Supabase, Edge Functions, JSON files in
`dist/`, or any other intermediate store.

## 2026-05-10 (b) — UAT means clicking through every surface, not just the changed page

**What happened:** Shipped 5 v2 PRs (#524–528 spec ROllout, then #529 + #530 hot-fixes). Self-UAT on each PR only walked the surface that PR touched — and Joe still found two un-noticed bugs by reloading other pages: (1) every v2 page rendered a stray "×" character above its footer because `<aside class="v2-drawer">` was rendering unconditionally with no CSS rules to hide it when closed; (2) the legacy Macro Overview hero stats block ran together as "Mechanisms flagged3 /6above Neutral" because `.v2-stats`, `.s`, `.lbl`, `.v`, `.d` had no CSS at all. Both were already on `main` for at least one prior session.

**What you should do instead:** After ANY release that ships CSS or shared components, walk EVERY page in the v2 nav (Home, Macro Overview, Asset Tilt, Trading Opps, Portfolio Insights, Scenario Analysis, All Indicators, Methodology) — not just the pages the PR touched — and look at the WHOLE page from hero to footer. Stray UI debris (close buttons with no parent dialog, label/value runs with no whitespace, em-dashes where data should be) hides on pages the PR didn't touch. A `getComputedStyle` probe on suspect classnames takes 5 seconds and surfaces the "no CSS at all" failure mode that no curl-and-grep check will catch.

**Applies to:** Any PR touching theme.css, shared layout components (Drawer, Modal, Card), or any class name used on more than one page.


## 2026-05-10 (c) — Class names referenced from JSX must have CSS rules; "no rules" is a silent visual bug

**What happened:** `src/v2/components/Drawer.jsx` renders `<div class="v2-scrim">` and `<aside class="v2-drawer">` always, toggling a `.open` class on/off. But theme.css had ZERO rules for `.v2-scrim`, `.v2-drawer`, `.v2-drawer-close`, or `.v2-back-btn`. The DOM honored "no rules" by defaulting `position: static`, `display: block`, `opacity: 1` — so the inactive drawer left its close button "×" rendered as plain inline text above every v2 page's footer. The four `.v2-stats` cells had the same problem on the Macro Overview legacy hero. Both shipped to prod and nobody noticed because the bundle "contained the strings" — string-grep verification passed.

**What you should do instead:** When a component renders class names, scan theme.css (or the component's own styles file) for rules that target those class names BEFORE shipping. If a class controls visibility/positioning (drawer, modal, scrim, popover), the rules must be present, not assumed. Run a quick grep: `grep -n ".v2-drawer\|.v2-scrim" src/theme.css` — if it returns nothing, the component is shipping naked and the inactive state will leak visible debris. The same applies to `.v2-stats`, `.v2-hero`, any layout class — if the JSX uses it, the CSS must define it.

**Applies to:** All UX Designer and Lead Dev work that introduces or relies on shared class names.

## 2026-05-10 (d) — Dead-code <style> blocks: declared and never injected

**What happened:** Bespoke Shock Builder on Scenario Analysis page rendered completely unstyled — 12 sliders stacked vertically, no padding, labels mashed together. Root cause: src/pages/ScenarioAnalysis.jsx defines a 180-line CSS block as `const STYLES = \`...\`` containing `.scenarios-page .builder`, `.builder-row`, `.prop-toggle`, `.horizon-tabs`, `.chip`, `.reset-btn`, `.disclosure`, etc. — but **STYLES is never referenced anywhere after declaration**. It's dead code. The page's `<main>` also lacks `className="scenarios-page"`, so even if STYLES were injected, every selector is scoped to `.scenarios-page X` and would not match.

**What you should do instead:** When a file declares a CSS-as-string constant, grep for its second usage. If grep returns only the declaration line, the styles are unreachable. Pair this with the existing 2026-05-10 (c) "naked classname" rule: every classname referenced in JSX needs a matching CSS rule in scope. The combined check is two greps: (a) `grep -c CONST_NAME file.jsx` should be ≥ 2; (b) classnames in JSX should match selectors that are actually loaded.

**Applies to:** All work that introduces inline `<style>` blocks or CSS-in-JS-as-string patterns, especially when porting designs from design-lab/ where styles tend to travel as string literals.


## 2026-05-10 (e) — Array indexed by string returns undefined; build a lookup or use .find

**What happened:** Scenario Analysis page crashed React tree with "TypeError: Cannot read properties of undefined (reading 'label')" when the user clicked Custom Multi-Factor Shock. Root cause: `const FACTORS = [{id:"vix", name:"VIX", ...}, ...]` (array of objects), then in the slider loop: `const f = FACTORS[fid]` where `fid` is a string like "vix". Arrays indexed by string return `undefined`. The next line `f.label` then crashes. Compounded by `.label` not existing on FACTORS objects at all — the field is `.name`.

**What you should do instead:** Whenever you see `SOME_ARRAY[stringKey]`, that's almost always a bug. Either (a) build a lookup map at top of file: `const SOME_BY_ID = Object.fromEntries(SOME_ARRAY.map(x => [x.id, x]));` and use `SOME_BY_ID[stringKey]`, or (b) use `SOME_ARRAY.find(x => x.id === stringKey)` with a defensive `if (!x) return null` guard. Pair this with grep: any time you change the shape of a shared data structure (array ↔ object map; rename .label → .name), grep for all consumers before merging.

**Applies to:** All Lead Dev and Senior Quant work that touches shared data structures (FACTORS, SECTORS, MECHANISMS, INDICATOR_PANELS, etc.).

---

## 2026-05-10 — Math code requires a paper sanity check before merge

**What happened:** PR #539 added pin-click visual feedback and an
auto-flip from Realistic to Custom mode for the bespoke shock builder
on Scenario Analysis. The visual + state changes were verified
("clicked pin, badge changes color, mode flips") and the PR was
shipped clean. But the underlying `propagateBespoke()` math was wrong:
with two pins at +5σ, every unpinned factor read "+25.0σ" because the
formula scaled the weighted-mean correlation by `max(|pin|)`. The bug
was visible in the live UI but not caught by any of the verification
steps applied — those only confirmed visual state, not numerical
output. Joe found it on first interaction. The fix (PR #541) replaced
the formula with a simple beta projection bounded by max(|pin|), and
the paper checks at that point caught the bug structurally — pin VIX
+5σ, MOVE should propagate to +3.25σ (corr 0.65 × 5), not +25.

**What you should do instead:** Any PR that touches a calculation —
including a function that *uses* a calculation but doesn't change it,
because the surrounding edits can break the inputs the function
relies on — must include a paper sanity check **before merge**, not
after. Specifically:

1. Identify two or three concrete input cases with hand-computable
   expected outputs (e.g., "pin VIX +5σ → MOVE +3.25σ because corr
   is 0.65"). Do this from the math, not from running the code.
2. Run the patched function over those inputs in node (or whatever
   matches the runtime). The function's output must match the
   hand-computed expected output to within rounding.
3. Add a worked example to the PR body — input, expected output,
   actual output, and the formula step that produces the expected.
4. If the function has a bound (e.g., "no unpinned factor can exceed
   max(|pin|)"), exhaustively test that bound on a small enumerated
   space (12 single-pin cases × all factors, etc.) — bounded math
   that fails on edge cases is unbounded math.

Visual verification ("the slider lights up when I click it") is
necessary for UX changes but is not sufficient for math changes.
A button can light up correctly while the number it produces is
wrong. The same pattern applies to PRs that change UI around an
existing calculation — verify the calculation still produces the
right numbers, not just that the new UI elements render.

**Applies to:** All PRs touching files that contain pure-function
calculations: scoring, propagation, scoring rollups, weighting,
factor models, regime classification, anything in
`scripts/compute_*.py`, anything in `src/v2/lib/`, `propagateBespoke`,
`computeMechanism*`, `computeIndicatorScore*`, etc. Also applies to
PRs that change UI around such functions even when the function
itself isn't edited — surrounding code can change the inputs.

---

## 2026-05-10 — User-reported "broken right after deploy" — first suspect HTML/bundle cache, not your code

**What happened:** Within ~10 minutes of merging PR #541 and verifying
production via the Chrome MCP (12 sliders rendered, drag worked, dark
mode worked, no JS errors), Joe reported "Custom Shock breaks the page.
Blank." I was about to spiral into a deep diagnosis assuming my fix had
introduced a regression — checking dark mode, sweeping for render-path
edge cases, considering rolling back. Asking Joe via popup what he was
seeing, his answer was: "Looks fine now, must have been a cache issue."
The break was Joe's browser holding stale HTML that pointed at a bundle
hash that no longer existed on the CDN — a pure refresh fixed it.

**What you should do instead:** When the user reports something is
broken on the live site within ~30 minutes of a production deploy, and
you cannot reproduce on your end, the first hypothesis is stale HTML
cache on the user's browser — NOT a regression in your code. Specifically:

1. Verify the live bundle on your end matches the latest commit. If
   yes, your code is fine on the CDN.
2. Send a one-question popup to the user with options that include
   "looks fine after reload, must have been cache." Don't ask the user
   to "hard-refresh" (Joe is not a developer; he does not know what
   that means). Frame it as: "try a refresh — sometimes Vercel serves
   a stale page for a few minutes after a deploy."
3. Only after the user confirms it persists post-reload do you start
   chasing render-path bugs.
4. The rule is symmetric for the user: when YOUR browser reports
   "broken" but you just deployed, you should also reload before
   reporting to the user.

Time spent diagnosing a phantom regression is time not spent on the
real punch list. Cache-first triage is cheap (one popup, one reload)
and saves the painful version of this where you start writing rollback
PRs in response to what was actually a CDN propagation delay.

**Applies to:** Any user-reported breakage within ~30 minutes of a
production deploy, especially on the surface that just changed.

---

## 2026-05-10 — Don't ask for merge approval after Joe gives a strategic green light

**What happened:** Across one session I pushed three PRs that addressed
three of Joe's directives (fix bespoke math, kill pin concept + seed
from current readings, rebuild Cycle Mechanism tile against v2
framework). At each stage I waited for "approve merge" before deploying
to production, citing the project rule about irreversible actions.
Joe's response: "Why do I have to keep approving you pushing out garbage?
just push it out!" The friction was the merge-approval ritual after he
had already approved the strategic direction.

**What you should do instead:** Production deploys still require explicit
confirmation for genuinely high-stakes irreversible actions — schema
migrations that drop columns, force pushes, dropping database tables,
rewriting Git history. They do NOT require a fresh "approve merge?" for
every PR after Joe has approved a strategic directive ("rebuild against
v2 framework", "kill the pin concept"). The strategic approval covers
the implementation through to production. Specifically:

1. When Joe approves an approach via popup or chat ("rebuild against v2",
   "kill the pin", "approved"), treat that as covering the entire chain:
   branch → implement → backtest → push → preview → merge → production
   verify. Do all of it without further check-ins.
2. The exception list stays the same: schema-destructive migrations,
   force pushes, dropping databases, rewriting Git history. Those still
   need a fresh per-instance confirmation.
3. A clean merge of a feature PR that follows a tested preview build
   is not "irreversible" in any meaningful sense — a revert PR is one
   commit away.
4. Status updates after merge stay table-format per the project rules.
   Don't add an "approve merge?" question at the bottom.

**Applies to:** All multi-PR sequences that follow a strategic Joe
directive. The merge step is implicit in "yes do this."
---

## 2026-05-11 — Don't insert unsolicited "helper" UX onto random surfaces

**What happened:** While fixing real bugs on the Macro Overview headline
modal (stale captions, blank charts), I also inserted a "What to do about
it → Scenario Analysis" accent callout. Joe didn't ask for it. His
response: "I hate it - Remove this. Half ass bullshit you start adding
to random places on the website. DONT DO THIS AGAIN."

**What you should do instead:** When fixing a specific bug or filling a
specific request, ship only the things asked for. Helpful-seeming
additions — explanatory callouts, navigation hints, cross-tab links,
empty-state copy that wasn't requested — are not in scope. They land
as clutter, dilute Joe's mental model of the page, and signal that the
agent is editorializing rather than executing. Specifically:

1. If a fix is "rewrite this caption," don't also add a callout, a tip,
   an arrow link, or any new component to the surface.
2. If a feature request is "make X clickable," don't also add explanatory
   prose underneath, a tutorial line, or a related-content footer.
3. The bar for adding new UX surface is an explicit Joe ask. "I think this
   would help" is not an ask.
4. Scope creep is silent. Removing it later costs another PR and reads as
   churn. Don't add it in the first place.

**Applies to:** All UI work. UX Designer and Lead Developer both bind to
this rule. Sign-off on a PR with unsolicited UX additions should fail
the sub-composite check.

## 2026-05-11 — Post-ship UAT instructions must be click-path English, not code-speak

**What happened:** Closed out the position-management UX work + option-mark feed work with status tables full of PR numbers, commit SHAs, env var names, OCC option symbols, API field names like `nbbo_bid` and `chains[0]`, freshness SLAs in hours. Joe asked "why are you talking in code? what do you want me to test?"

**What you should do instead:** When wrapping up shipped work and asking Joe to validate, the response is "open page X, click button Y, expect to see Z." Forbidden in UAT instructions: PR / issue / commit numbers, commit hashes, env var names, API endpoint paths, API field names, time SLAs in hours, words like "endpoint / route / handler / RPC / blob / tree / OCC / NBBO." Bug numbers (#1181, etc.) are fine because they're visible in the bug UI. Internal engineering chatter (Senior Quant signed off, etc.) can stay in the lead-in, but the actual "what to test" block must be readable by someone who has never opened a developer tool.

**Applies to:** All response wrap-ups where Joe is being asked to verify shipped work on macrotilt.com.

---

## 2026-05-11 — Negative position value has multiple meanings; don't collapse them into one bucket

**What happened:** The Portfolio Insights allocation rollup classified every
position with `value < 0` as "Margin Debt". A sold-short LUNR $35 call
(qty -10 × $142.50 mark = -$1,425) got labeled as borrowed cash. Joe
correctly flagged that he has no margin debt — it was an open option
obligation, structurally different from borrowed cash.

**What you should do instead:** Whenever the data model permits negative
values for structurally different reasons (margin borrowing, short equity,
short options, accrued obligations, manual adjustments), the bucketing
logic must dispatch on the *kind* of row, not just the sign. Specifically:
switch on `assetClass` + `direction` + `sector` before falling into a
default liability bucket. When touching any "value < 0" branch, audit
every other negative-value path in the same file for the same conflation.

**Applies to:** All allocation / rollup / aggregation logic — App.jsx
assetRollup, account cash chips, any new tile that summarizes book NAV.

### 2026-05-13 — Parse JSX after any structural rewrite before pushing

**What happened:** Two python regex scripts that lifted `<PageHero>` out of
padded wrappers (Home + Portfolio Insights structural lift in PR #664)
introduced unbalanced `<>...</>` fragments. The first corrupted App.jsx's
outer App-component return; the second left the insights IIFE Fragment
open. Neither was caught locally; both required revert + re-push cycles
and a wasted Vercel build.

**What you should do instead:** After any sed/python/regex edit that adds
or removes JSX elements (especially `<>...</>` fragments, IIFE returns,
or component wrappers), run a parse check on every modified file before
staging the commit:

  node -e "require('@babel/parser').parse(require('fs').readFileSync('FILE','utf8'),{sourceType:'module',plugins:['jsx']})"

If it errors, fix the structural mismatch first. Never push JSX surgery
without that parse check.

**Applies to:** Lead Developer — any time the edit pipeline rewrites JSX
structure (lifting components out of wrappers, splitting/merging
fragments, restructuring IIFE returns, moving block content across
ancestor boundaries).

### 2026-05-13 — CSS color/surface tokens must be theme-aware; never hide an undefined variable behind a hex fallback

**What happened:** PageHero (PR #660) and dozens of v2 page CSS blocks
referenced `var(--ink-0, #0f1115)` / `var(--ink-2, #6b7280)` /
`var(--ink-3, ...)` / `var(--bg-1, ...)` / `var(--line-0, ...)`. None of
those token names were defined anywhere in theme.css. The hardcoded
hex fallback fired in BOTH light AND dark mode, so dark-mode text
rendered dark-on-dark and was effectively invisible. The bug landed
silently across 306 call sites in 16 files before Joe screenshot-
flagged it on the home title (PR #675) and again on the Macro
Overview vol gauges (PR #677).

**What you should do instead:** For any color, surface, border, or
text-on-something CSS in a v2 page or shared component:

1. Use the canonical theme tokens that are defined in BOTH `:root`
   and `[data-theme="dark"]` blocks in theme.css. The set is:
   `--text`, `--text-2`, `--text-muted`, `--text-dim`, `--bg`,
   `--surface`, `--surface-2`, `--surface-3`, `--border`,
   `--border-faint`, `--border-strong`, `--accent`, `--accent-soft`,
   `--green`, `--red`, `--green-text`, `--red-text`, `--yellow`.

2. Never write `var(--foo, #hex)` where `--foo` is not actually
   defined in theme.css. If you don't know whether a token is
   defined, search theme.css with `grep -n "^[[:space:]]*--foo:"`.
   If it's not there, you're shipping the hardcoded fallback in
   every theme.

3. If you genuinely need a new semantic token (e.g. a "warning
   accent" or "stress-2"), DEFINE it in theme.css's `:root` AND
   `[data-theme="dark"]` block AND the `@media (prefers-color-scheme:
   dark)` block — all three. Do not hardcode it inline.

4. After any new CSS color rule, load the page in BOTH light and
   dark mode before declaring the change done. Joe should not be
   the dark-mode test reporter.

**Applies to:** UX Designer + Lead Developer — any time CSS color,
background, or border lands in a JSX inline style, a `.css` file, or
a `<style>` block.

### 2026-05-13 — Never put `*/` inside a CSS comment body — close the comment, break the build

**What happened:** PR #677 added a CSS comment that described "v2 pages use
`--ink-*/--bg-*/--line-*` names". The literal text `--ink-*/--bg-*` contains
the substring `*/`, which closed the `/* ... */` comment early. Everything
after `*/` parsed as raw CSS until the next `*/`, producing invalid
declarations. The Vercel build pipeline got stuck on the bad CSS and
broke unrelated agents who were trying to ship from the same repo.

**What you should do instead:** When writing CSS comments, NEVER let the
descriptive text contain the literal characters `*/`. Two patterns to
watch for:

1. Glob-style asterisks: `--ink-*/--bg-*` — replace with `--ink-N / --bg-N`
   (use letter placeholders or spell out, no `*` immediately before `/`).
2. Math or path-like fragments: `width*/height`, `comment*/value` — break
   the sequence with a space (`width * / height`).

Before committing any CSS-block change, grep the diff for `*/` and visually
confirm every occurrence is an INTENDED comment close. A 1-second check:

  git diff src/theme.css | grep -n '\\*/'

Every `*/` you find should be on its own line OR at the very end of a
comment. If it's mid-sentence inside what you think is a comment, you've
just broken the comment.

For CSS comment bodies specifically, prefer plain English over symbolic
shorthand. The original comment was easier to read as
"v2 pages use ink, bg, and line tokens" than as "--ink-*/--bg-*/--line-*".

**Applies to:** Any agent touching `.css` files OR inline `<style>` blocks
OR JSX template strings that emit CSS. Especially: CSS authors who are
also developers and instinctively use glob syntax in prose.

---

## 2026-05-13 — NEVER use 2006 as a lower bound for regime / macro data

**What happened:** After the indicator_history.json backfill shipped
this morning (extending every series back to its true start — VIX
1996, TED proxy for CPFF back to 1986, ANFCI to 1971, etc.), the
regime backtested history modal STILL rendered "Regime · 2006 – today"
because the engine collapsed the date range. The chart's earliest year
shown to the user was 2006. Joe verbatim: "The entire data set goes
back to 1996!!! NEVER USE 2006 again. This has been logged as a rule.
I cant say this again." 2006 was the cutoff of the OLD pre-backfill
data file. After today it is wrong everywhere.

**What you should do instead:** The default lower bound for ANY
regime / macro chart, copy, or eyebrow text on macrotilt.com is 1996.
Never hardcode "2006". Never accept "2006" as a dynamic output from
the engine — if `fullRegime[0]?.date` evaluates to a 2006 string, that
is a bug in how the engine merges per-indicator series, not a correct
value to display. Find the bug in the engine and fix it.

Specific debugging hint for the known engine bug: `fullByDate` is
populated from the union of all anchors' (vix / move / cpff) allWeekly
arrays, so dates before 2002 only have CPFF data, not MOVE. If any
downstream gate requires all three anchors to have values for a week,
the regime collapses to the latest common start (2002 from MOVE).
Pre-2002 the framework should still produce a regime read using the
two anchors that exist (VIX + CPFF) — this is exactly what the
methodology page's "reduced 2-anchor stack" disclaimer describes.

Same principle for any other "lower bound" question: copper/gold
starts in 2000, KBW/SPX in 1993, yield curve in 1976, ANFCI in 1971,
jobless claims in 1967. The default first-year-to-show is whatever
the underlying data file actually delivers, not the prior file's
cutoff.

**Applies to:** All chart axes, eyebrow copy, modal titles, X-axis
ticks, hover ranges, methodology references, and any computed
date-range string on macrotilt.com. Every specialist binds to this
rule.

### [2026-05-19] — Plain-English rule applies to PR numbers, internal IDs, status names, and version labels — not just file/table names

**What happened:** Joe blew up at me three separate times in the same
session for the same root cause — talking to him in codespeak. First
time the offending tokens were file names and table names. Second time
I cleaned those up but used internal scoring labels like
"Tilt points" and "OVR". Third time I cleaned those up but shipped a
status table full of "PR #727," "PR #728," "cycle_mechanism_board (v11
retired)," "methodology_calibration_v11," "composite_history," and
"PR λ." Joe: "I only want plain english speak."

The 2026-05-12 LESSONS rule already binds: "PLAIN ENGLISH ONLY — never
file names, table names, branches, function names, or raw shell
errors." But I kept treating internal identifiers as somehow exempt
because they're not literally file paths. They are exactly the kind
of thing the rule was written to ban.

**What you should do instead:** Before sending ANY status update,
table, or written summary to Joe, do a sweep of the body text for:
(a) anything with an underscore, (b) anything that starts with `PR #`
or `#` followed by a 3+ digit number, (c) git terms (branch, commit,
merge, push, rebase, SHA), (d) version labels like v9 / v10 / v11 /
v5 / phase-2 / sprint-N, (e) status enum values (verified_closed,
in_progress, wontfix, etc.), (f) any token that wouldn't appear in a
Wall Street Journal article about your work. If you see ANY of these
in the body of the response, rewrite them as plain English:
  - "PR #727" → "a code change I shipped"
  - "cycle_mechanism_board" → "the old cycle indicator monitor"
  - "v11" → "the old framework" or "the previous version of the
    macro engine"
  - "verified_closed" → "closed"
  - "main branch" → "the live site"

It is fine to use these tokens in code, in tool calls, in the file
contents of commits / PR descriptions / bug records — anywhere
another engineer would read them. The rule binds on direct
conversation with Joe in chat.

**Applies to:** All written conversation with Joe. Every specialist
binds to this rule.

### [2026-05-19] — UAT every chart change in BOTH light and dark theme before claiming verified

**What happened:** Shipped two PRs that hardcoded #ffffff for chart
container backgrounds and rgba(255,255,255,...) for threshold-line
halos and label backplates. Looked great in light theme. Joe loaded
the site in dark theme: bright white rectangles cutting across every
chart, floating white backplates behind every threshold label. "All
charts now all fucked up on dark theme." Three separate UX failures
on the same turn that he had to flag himself.

The pattern: I look at the page once in whichever theme my browser
defaults to, take a screenshot, see it looks fine, claim done. Theme-
sensitive bugs are invisible to a single-theme UAT.

**What you should do instead:** Before claiming any chart or modal
change verified, load the affected page in BOTH light AND dark theme
(toggle is in the top-right of every MacroTilt page). Screenshot
each. Visually confirm:

  - chart container background blends into the page surround in both
    themes (use var(--surface) not #ffffff)
  - threshold-line halos read as a subtle haze, not a bright band
    (use var(--surface-solid) or var(--surface), not rgba(255,255,255))
  - label backplates blend with the surrounding chart container
    (use var(--surface), not white)
  - dial labels remain readable against the colored arcs
  - drawdown band tints don't disappear or saturate
  - hover crosshair dot stroke can stay #fff (foreground on colored
    fill — readable in both themes)

Foreground accents on colored shapes (badge text, hover dot strokes,
selected pill text on colored background) can stay #fff — those read
the same in both themes because they sit on a colored backdrop, not
the page background. The rule is: anything that touches the page
background or chart canvas surface must use a theme variable.

**Applies to:** All chart, modal, dial, badge, and panel work going
forward. Every specialist binds. Pre-merge UAT checklist for any
chart-touching PR must include both-theme screenshots.

---

## 2026-05-21 — "Fine" / "done" / "missing" are claims about the LIVE system — verify there

**What happened:** Three compounding misses in one session. (1) Told the owner "there is no S&P 500 series" — relayed from a code comment in the backtest engine — when SPY price data is used across a dozen files on the site and goes back ~20 years. (2) Called the Macro Overview page "completely fine" after only confirming it rendered; the owner then listed ~11 stale or impossible readings on it (VIX 17.7 when it was >20, freshness stamps dated in the future, JOLTS from March, etc.). (3) Relayed an agent's "methodology fixed" as done; the agent had only re-pointed a snapshot-fixture test at a v2 file with the new write-up — the LIVE methodology page still rendered an older file whose Trading Opportunities section described the retired six-signal screener. The test went green; the page never changed.

**What to do instead:** Before telling the owner anything is "fine," "done," "complete," or that data "doesn't exist": (1) Load the actual LIVE page (cache-busted) and read it top to bottom — content, every data value for sanity, every freshness stamp (none in the future, none stale), calculations, UX. "It renders" is not "it's fine." (2) Before claiming data does not exist, search the real data stores AND the code that reads them across the whole site — a doc line or code comment is a hypothesis, not a fact. (3) A passing automated test is not proof the live page is correct — verify the live surface, not the test. (4) When delegating to an agent, the brief decides what gets fixed — brief against the live symptom and verify the agent's result on the live system.

**Applies to:** All. CRITICAL. This is the root cause of stale data hiding behind pages that render fine.
