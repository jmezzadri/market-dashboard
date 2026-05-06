# v2 Cutover — Full-Site Audit Punchlist
## 2026-05-06 — Joe directive: walk every square inch, click every clickable, hover every tooltip, verify every pipe, before re-flipping V2_ENABLED.

| # | Tab / Surface | Severity | Defect | Evidence | Fix |
|---|---|---|---|---|---|

## #home — signed in (josephmezzadri@gmail.com)

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| H1 | P0 | "Sign in to view your portfolio" rendered in tile `03 · YOUR PORTFOLIO` while user IS signed in (sb-…-auth-token present in localStorage). | `src/v2/pages/HomePage.jsx` checks `accountList.length === 0` only — no useSession() check. | Wire `useSession()`; only show sign-in copy when `!session`. |
| H2 | P1 | Tile `04 · WHAT TO ACT ON TODAY` stuck forever on "Scanner output loading…". JSON `/latest_scan_data.json` HAS data (scan_time 2026-05-06T10:49:40-04:00). | Code reads `scan?.signals?.composite_picks \|\| scan?.picks` — neither exists. Real shape is `{buy_opportunities, watch_items, sell_alerts, portfolio_positions, watchlist, score_by_ticker, composite_by_ticker, wide_universe}`. | Re-point HomePage parser at `scan.buy_opportunities` (≥80 score) and `scan.watch_items` (70-79). |
| H3 | P2 | Hero greeting hardcodes "Joe." regardless of who's signed in. | `src/v2/pages/HomePage.jsx` line ~110 — literal `Joe.`. | Derive from `session.user.user_metadata.first_name` / fallback to email handle / fallback to "there". |
| H4 | P2 | Tile `02` shows "100%" as the lead number with no clear label — only context is the tiny subtitle "Cautious · 1.00× lev". Reads as ambiguous. | Layout puts equity-% as the hero stat without an "Equity" eyebrow. | Add eyebrow "Equity allocation" or explicit "100% equity" inline. |
| H5 | P2 | Freshness chip on tile 01 = "16H AGO", tile 02 = "2D AGO", tile 04 = "2H AGO". Three different age formats on one page. | Each chip uses its own data element's last-fetch timestamp. | Confirm each is accurate; consider a sentinel "STALE" treatment when >24h on slow-data tiles. |
| H6 | P2 | Mechanism mini-cards in tile 01 (VAL/CREDIT/FUNDING/GROWTH/LIQ&POL/POS&BR) carry colored top borders (red/gold/blue/gold). Brand spec: "All tags are neutral; only direction (up/down) gets color." | Inline borderTop with state-band colors. | Drop the top-border tints; use the state-band only as a single dot or a subtle pill — Marquee idiom. |
| H7 | P3 | Top-right "Today's stance" hero metric is `66/100` in champagne, label "Cautionary" below. The same number is restated huge on tile `01` 4cm below. Same data twice on the same fold. | Hero shows compositeAvg AND tile 01 shows compositeAvg. | Drop the right-rail Today's stance metric, or drop the tile-01 hero number. |
| H8 | P3 | Top header bar reads `MARKET OPEN` permanently. No clock-aware logic. | Static badge in App.jsx Hero strip. | Compute open/close from NYSE hours + holiday calendar + premarket awareness. |
| H9 | P3 | "WELCOME BACK / Joe." block is left-aligned, "Today's stance / 66 /100 / Cautionary / 16H AGO" is right-aligned at the same baseline. Two heros competing. | Single hero row holds both. | Pick one hero anchor; demote the other. |


## #overview · Macro Overview — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| MO1 | **P0 — blocking** | All 6 mechanism tiles render score `0/100` while hero says `5/6 above Neutral`, `Composite 66/100`, `22 calibrated indicators`. Hero math is right; tile render is wrong. | v10_allocation.json mechanism_scores: `{valuation:99, credit:68, funding:50, growth:45, liquidity_policy:62, positioning_breadth:69}`. Tile JSX: `<CountUp to={Math.round(m.score)} />`. CountUp stuck at 0 — same regression as bug #1168 (theme #12) that supposedly closed in commit 9d40792. | Replace `CountUp` with plain numeric render on tiles, OR rebuild CountUp to set the FIRST frame to the target value when data arrives async (set `started=false` on data change). |
| MO2 | P0 | State pills (`Risk Off`, `Cautionary`, `Cautionary`, `Neutral`, `Cautionary`, `Cautionary`) reflect the right state-band, but the score number contradicts them. A tile labelled `Risk Off` showing `0/100` reads as broken. | Same root cause as MO1. | Same fix. |
| MO3 | P1 | Tile `01 Valuation` left border is red, `02 Credit` border is gold, `03 Funding` is gold, `04 Growth` no border (Neutral), `05 / 06` gold. Multi-color decoration on the tile borders. | Inline `borderLeft` keyed off bandClass. | Per brand spec ("only direction up/down gets color"), the state-band color belongs in the state pill only — not on the tile body's border. Demote to neutral hairline border + colored pill. |
| MO4 | P2 | Single-line page title `Cautionary.` (no eyebrow, no descriptor). Right rail says `17H AGO` only. No "Wednesday May 6" anchor; no headline sentence. | Hero is just `<h1>{headlineState}.</h1>` + freshness chip. | Add eyebrow `Today's macro stance` + the calibration JSON's `headline_gauge.headline_sentence` below the headline. |
| MO5 | P2 | Footer reads `SHILLER · DERIVED · FRED · YAHOO · AS OF 2026-05-06 · V11.0.0`. The token `DERIVED` reads as plumbing. | Source list dedup logic. | Replace `DERIVED` with the underlying upstream (e.g. `FRED · ICE BofA · CBOE`); never expose the producer-internal "derived" tag. |
| MO6 | P3 | Hero quad `MECHANISMS FLAGGED 5/6 · COMPOSITE 66/100 · CALIBRATED INDICATORS 22 · FRAMEWORK v11.0.0` is dense — two of the four numbers are derived from the same set, and "Framework v11" reads as version-stamp not a stat. | 4-up grid at top of page. | Drop `Framework` from the hero quad; promote the headline_sentence into that slot. |
| MO7 | P3 | "OPEN MECHANISM →" CTA uses uppercase tracked-out caps (Marquee-ish, OK) but is the same accent color (champagne) as the section eyebrows. CTA needs hover affordance. | Inline accent color on the link. | Use `.v2-cta` class shipped earlier; add :hover + :focus-visible. |


## #allocation · Asset Tilt — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| AT1 | P0 | "Cautious lean." page hero — `Cautious` is OFF-LEXICON. v2 strict lexicon = Risk On / Neutral / Cautionary / Risk Off. The legacy producer emits `page_stance: "Cautious"`. | v10_allocation.json `page_stance: "Cautious"`. | Either re-train the v10 producer to emit `Cautionary`, or apply a stance-map at the v2 page boundary that collapses `Cautious` → `Cautionary`. |
| AT2 | P0 | Hero stat row shows `STRESS 3/6 mechanisms above Neutral` while Macro Overview hero says `MECHANISMS FLAGGED 5/6 above Neutral`. Same denominator (6), same label ("above Neutral"), DIFFERENT numerator on two tabs reading from data feeds that overlap. User cannot tell which is right. | Macro Overview reads `cycle_board_snapshot.mechanisms` and counts band ∈ {caution, risk-off}. Asset Tilt reads `v10_allocation.stress_score` from a different threshold rule. | Either harmonize the two definitions or rename the Asset Tilt one to `Stress score 3/6` (no "above Neutral" label) so users don't expect them to match. |
| AT3 | P0 | `Top & bottom tilts` rail and `Industry groups` table BOTH show internal scoring jargon: `+0.87`, `+0.77`, `-1.01`, `-0.93`, `-0.90`. Theme #7 explicitly bans `+0.87` (Joe's directive 2026-05-05). | Inline render of `tilt_score` from v10 JSON. | Replace the score column with portfolio % weight or `$ NAV exposure` (already present as `$8.04K`). Move tilt_score to a tooltip if at all. |
| AT4 | P1 | First-paint flash: `STRESS 0/6` and `EQUITY 6%` rendered for ~3s on initial load before settling to `STRESS 3/6` and `EQUITY 100%`. Same CountUp race as Macro Overview tiles. | Inline `<CountUp to={...}>` on hero stats. | First-frame seeds at target value, not 0 (LESSONS rule from bug #1168 still binds). |
| AT5 | P1 | `EQUITY 100% / DEFENSIVE 0% / LEVERAGE 1.00× / STRESS 3/6` — four hero stats mix percentages, count, and ratio in the same row. The `100%` for equity reads as a perfect score, not "all of NAV in equities". | Heterogeneous stat row. | Add eyebrow `Equity allocation` above the `100%`, or re-frame as `Net equity weight 100%`. |
| AT6 | P2 | `$ EXPOSURE` column on Industry groups (e.g. `$8.04K`, `$4.85K`, `$2.98K`) — implies a portfolio NAV that the user hasn't been shown anywhere on the page. Where is `$8.04K` coming from? | v10 producer multiplies normalized tilt by user NAV; NAV not displayed here. | Header section at top of Industry Groups table: `Capital deployed: $X · gross $X` so `$ exposures` are anchored. Or move `$` to its own section. |
| AT7 | P2 | Industry Groups table: `INDUSTRY GROUP · SECTOR · TICKERS · TILT · $ EXPOSURE` — the `TICKERS` column shows three tickers separated by `·` (e.g. `PPH · IHE · XPH`). No click-through, no quote, no expansion. Dead column. | Inline render. | Either drop the column, or make each ticker a chip that drilldowns to a TickerDetail modal. |
| AT8 | P2 | All/Overweight/Marketweight/Underweight filter pills on Industry Groups — when "All 24" is active, the pill is solid champagne; the inactive 3 are outlined. Hover/focus-visible state on these pills not visible. | Inline button styling. | Add `:hover` and `:focus-visible` per the `.v2-cta` pattern shipped earlier. |
| AT9 | P3 | Sectors table only shows top 11 GICS — no expand-to-IG drilldown ("click sector to see industry groups inside"). Theme #9 says every aggregate must drill down. | Static table. | Wire `onClick` on each sector row → expand inline or scroll to that sector's IG sub-list in the bottom table. |
| AT10 | P3 | "see Macro Overview →" link in `CYCLE SAYS` strip — unclear if it's a button or text. No hover affordance until cursor lands on it. | `.v2-cycle-link` class shipped. | Verify hover/focus rendered correctly in production bundle (could be cached old build). |


## #portopps · Trading Opportunities — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| TO1 | P0 | All four hero stats render `0` (BUY ALERTS, NEAR TRIGGERS, INSIDER BUYS, UNIVERSE = em-dash) despite the scan JSON being fresh (scan_time 2026-05-06T10:49:40-04:00) and containing 538 wide_universe entries, plus buy_opportunities / watch_items / sell_alerts arrays. | TradingOppsPage parser reads `scan?.signals?.composite_picks` — that key does not exist in latest_scan_data.json. Real top-level keys: `scan_time, scan_type, date_label, buy_opportunities, watch_items, sell_alerts, portfolio_positions, portfolio_covered_calls, watchlist, score_by_ticker, composite_by_ticker, wide_universe`. | Re-point parser at the real shape. Map `BUY ALERTS = (buy_opportunities ?? []).length`, `NEAR TRIGGERS = (watch_items ?? []).length`, `INSIDER BUYS (5D) = scan.insider_buys_5d ?? compute from form4 feed`, `UNIVERSE = wide_universe.length`. |
| TO2 | P0 | Theme #11 explicit Joe directive (bug #1167): `Trading Opps = signal-source breakdown (insider / Congress / dark pool / options / news) as stacked horizontal bars per ticker.` Current page shows two empty cards `Today's buys` / `Near-triggers` with no signal-source visual. | Page inventory has no stacked-bar component; only the empty-state copy. | Build a `<TickerSignalRow>` component that renders one row per buy_opportunity, with stacked bars showing the contribution of insider / Congress / dark-pool / options / news scores normalized to the composite. |
| TO3 | P0 | Footer line `SCAN REFRESHED 16:30 ET · SOURCES FROM LATEST_SCAN_DATA.JSON` — `LATEST_SCAN_DATA.JSON` is the producer-internal filename. Theme #5 banned. | Inline render of file path. | Replace with `Sourced from Unusual Whales · Yahoo Finance · SEC Form 4 · Congressional Disclosures` (vendor-only). |
| TO4 | P1 | Empty-state copy `No buys above 80 in latest scan.` exposes the internal `80+ score` cutoff. The score cutoff IS internal jargon (theme #7); user shouldn't see "above 80". | Hardcoded copy. | Use `No buy alerts in today's scan.` or similar plain-English. |
| TO5 | P2 | `Today's opps.` page title — too informal compared to other v2 page titles (`Cautionary.`, `Methodology.`, `Indicators.`). Loses gravitas. | Inline `<h1>Today's opps.</h1>`. | Either `Trading opportunities.` to match nav label (theme #1) or `Trading opps.`. |
| TO6 | P2 | Hero stat row shows dashed em-dash for `UNIVERSE` while data exists. Should not show dash when data is loaded. | Initial null state never replaced. | Wire universe count to `wide_universe.length` correctly. |
| TO7 | P3 | Two cards `BUY` / `NEAR` use rgba colour pills — direction-themed, OK per the brand brief, but the cards themselves are empty. Need actual content. | Layout. | Beyond TO2 — when actual buys exist, render a top-3 list inside each card with score, ticker, sector, last-close. |
| TO8 | P3 | Page does not implement Joe's per-ticker drill-down (theme #9: `Position → Trades`). A signal row should expand to show the underlying signals (insider names, Congress trades, options strikes, news headlines). | No drilldown implemented. | Wire each `<TickerSignalRow>` onClick → `<Drawer>` showing the per-source signal evidence. |


## #insights · Portfolio Insights — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| IN1 | P0 | All six account tiles render `$0` and `0 positions` despite Joe having an actual portfolio (TAXABLE / ROTH IRA / EY 401(K) / SCARLETT 529 / ETHAN 529 / HSA — all known accounts). Hero `Total net liquidation $0`. | InsightsPage code reads `a.market_value || a.total_value || 0` per account. The v2 hook `useUserPortfolio` returns `accounts[]` where each account has a nested `positions[]` array; there is no top-level `market_value` on the account shape. Page fall-through is 0. | Compute per-account total in InsightsPage: `account.value = (account.positions \|\| []).reduce((s,p) => s + (p.value \|\| 0), 0)`. Also surface `position_count = account.positions.length`. Verify shape against `src/hooks/useUserPortfolio.js` reshape function. |
| IN2 | P0 | Footer reads `ACCOUNTS · PRICES_EOD NIGHTLY · POSITIONS LIVE FROM CHASE / SCHWAB / IRAS / UTMA IMPORTS` — `PRICES_EOD` is the Supabase table name. Theme #5 plumbing leak. | Inline render of internal table name. | Replace with vendor-only: `Accounts · Prices end-of-day from Polygon · Positions imported from Chase, Schwab, Fidelity`. |
| IN3 | P1 | Page has no NAV history chart. Joe shipped MTChart-driven NAV chart code; it only renders if `navPoints.length >= 2`. With $0 totals, navPoints likely empty too, hiding the chart entirely. Page reads as a 6-tile static grid. | Conditional render of MTChart. | Once IN1 is fixed, NAV chart should populate. If still empty, debug `usePortfolioHistory` hook and `portfolio_history` Supabase table contents. |
| IN4 | P1 | No auth-state messaging when `accounts.length === 0` but user IS signed in. Joe sees 6 tiles with $0 each — confusing. | Empty-state branch added in cutover commit but only fires when `!isAuthed`. | When isAuthed AND accounts have zero positions in aggregate, show `Add a position to populate Insights` CTA pointing to Admin → portfolio editor (or wherever Add Position lives). |
| IN5 | P2 | Account tile sub-line `0 positions` followed by no last-synced date. v1 InsightsPage shows `last_synced_at`. | Conditional renders `a.last_synced_at` but field never populates due to IN1. | After IN1, sub-line: `12 positions · synced May 6`. |
| IN6 | P2 | `TOTAL NET LIQUIDATION` is the page hero label — verbose. Real-world PMs say "NAV". | Hardcoded eyebrow. | Replace with `Net liquidation` or `Net asset value`. |
| IN7 | P2 | No drill-down from account tile to per-position detail. Theme #9 "every aggregate must drill to its components" — clicking TAXABLE should open a drawer with the underlying position list. | Account tiles are `<div>` with no onClick. | Wire onClick → drawer showing positions sorted by value. |
| IN8 | P3 | Six account tiles laid out 3×2. With 6 accounts of varying size, some will likely overflow. No sort by value DESC. | Rendered in `accounts` order from the hook. | Sort `accountList.sort((a,b) => b.value - a.value)`. |
| IN9 | P3 | Hero `$0` is rendered in champagne accent color. When the actual NAV lands, a $400K number in champagne reads like marketing. | Inline accent on big number. | Use `--ink-0` (neutral) per Marquee discipline; reserve accent for direction or decoration. |


## #scenarios · Scenario Analysis — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| SC1 | **P0 — CATASTROPHIC** | `/#scenarios` route crashes the ENTIRE React app. Page renders blank white. Sidebar disappears. User cannot navigate away without manually editing the URL. THIS is the bug Joe hit when he said "can't even sign in" — a crash on this route kills the auth UI too. | Console: `TypeError: n.map is not a function`. ScenariosPage code: `const scenarios = data?.scenarios \|\| data?.canned \|\| [];` then `scenarios.map(...)`. JSON shape: `data.scenarios` is `{"object", isArray:false}` — `data?.scenarios \|\| []` returns the empty truthy object, NOT the fallback `[]`. | Two fixes, both binding: (1) Coerce: `const list = Array.isArray(data?.scenarios) ? data.scenarios : Object.values(data?.scenarios \|\| {});`. (2) **Add a top-level React `<ErrorBoundary>`** wrapping every v2 page so any single-page crash doesn't kill the app — display a "this tab failed to render, click another to recover" fallback. Without (2), any future page crash will reproduce the same catastrophic failure. |
| SC2 | P0 | Joe directive 2026-04-27: scenario analysis = bespoke shock builder + composite stress against the v9/v10 allocator with calibrated scenario set (8 historical anchors). Current page is a 5%-complete shell. | No bespoke shock builder, no calibrated scenarios rendered. | Full rebuild required. Source from `STRESS_SCENARIO_SCOPE.md` and `asset_allocation/ccar_translation.py`. |
| SC3 | P1 | `Loading scenarios from /scenario_allocations.json…` empty-state copy exposes the file path. Theme #5 plumbing leak. | Inline fallback string. | Replace with `Loading scenarios…` (no path). |


## #indicators · All Indicators — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| ID1 | **P0** | Hero stat `CALIBRATED SERIES 1 live + tracked` — but the table below shows 28 indicators across 6 families. The 1 is wildly wrong. | Page reads from `rows.length` after filtering — but the hero is computed BEFORE rows hydrate. Race: hero stat captures a single-row early state. | Same root cause as the CountUp 0 bug — hero stat must update once `rows` populates. Ensure it recomputes via `useMemo([rows])`. |
| ID2 | P0 | Mechanism column reads `—` (em-dash) for EVERY indicator. Only 10 of the 28 indicators are in the calibration JSON's tile arrays (Sprint 1 valuation/credit/growth). The other 18 (VIX, HY-IG, MOVE, ANFCI, STLFSI, etc.) live in the Sprint 2 PANELS dict in `compute_v11_mechanisms.py`. The IndicatorsPage's `mechFor` lookup only checks calibration tiles. | `mechFor` hash is built from `(calib?.tiles \|\| []).flatMap(t => t.indicators)`. Most v2 PANELS aren't in there. | Add a JSON file `public/v11_panels.json` exported by `compute_v11_mechanisms.py` containing the full Sprint 2 PANELS dict (mechanism → indicator-list). Build `mechFor` from BOTH the calibration tiles AND that panels JSON. |
| ID3 | P0 | `SHARE` column reads `—` for every indicator. Same root cause as ID2 — composite_share_pct is only present in Sprint 1 calibration entries. | No share data for Sprint 2 indicators. | Producer-side: extend `compute_v11_mechanisms.py` PANELS to emit `composite_share_pct` per indicator; surface in v11_panels.json. |
| ID4 | P1 | `IN ALERT TAIL 0` — but visually the table contains indicators in their alert quartile (EQ-Credit Corr 82nd, 10Y TIPS 82nd, Kim-Wright 84th — all top-quartile per their direction). | Hero stat counts rows where `pctBand(row.pct, row.direction) === 'r-off'`. Threshold for r-off is 85+ (or ≤15 for low direction). 82-84 falls in r-cau, not r-off. Stat technically correct given the threshold but the label "alert tail" misleads. | Either widen the threshold to ≥75 or rename the stat to `In alert quartile (≥85th)`. |
| ID5 | P1 | Hero stat `MONTHS OF HISTORY 2K` — the literal `2K` is rendered (Math.round(rows.reduce(...) / 1000)). User reads "2,000 months" which is ~167 years, implausible. | The math sums all 45 indicators' history-point counts — a column-of-history-points count, not literal months. Mislabeled. | Either rename label to `Series-points logged` (and keep the K abbrev), or change the math to `Math.max(...rows.map(r => r.points.length))` and label it `Longest indicator history (months)`. |
| ID6 | P2 | Search bar placeholder `Search indicators…` — works, but no `:focus-visible` outline on the input element. | Inline-styled `<input>` without focus-visible CSS. | Apply token-driven outline on focus. |
| ID7 | P2 | The `All (28)` filter pill is solid champagne when active; inactive ones outlined. No hover affordance, no focus-visible. | Inline button styling. | Promote to `.v2-cta` class shipped in tokens.css. |
| ID8 | P3 | `Last update` column shows `today`, `yesterday`, `5d ago`, `2d ago`, `Mar 31`. Format inconsistency — `Mar 31` is older than 7 days fallback. Mixed across rows. | `relativeAge()` helper falls through to `toLocaleDateString` for >7d. | Acceptable; consider promoting older rows to `Mon Mar 31` for clarity. |

| ID9 | P1 | Theme #2 violation: indicator-drawer chart for VIX (and likely all indicators) renders the time-series line WITHOUT calibrated tint bands. The brand spec requires green/grey/amber/red horizontal bands at the indicator's 25/50/75 percentile cuts. | MTChart on indicator drawer not wired to `tintBands` prop. | Compute the indicator's [25, 50, 75] percentile cuts from its `points`, pass into MTChart's `tintBands` prop (already supported on Macro Overview drawers per commit 7d8c81f). |
| ID10 | P2 | Drawer has no breadcrumb back to Indicators table; only the close X. Deep-link refresh would land on /#indicators but no indication of which view to return to. | No breadcrumb. | Add `← Indicators` link top-left of drawer (mirrors v2 Macro Overview drawer pattern). |


## #readme · Methodology — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| ME1 | P0 | Lexicon section: `Risk On` and `Neutral` cards both render `—` (no description) while `Cautionary` and `Risk Off` cards have descriptions. | Calibration JSON's `lexicon.tooltips` only carries "Cautionary" and "Risk Off" keys (the others were lost in the auto-refresh + my merge-time scrub). | Repopulate `lexicon.tooltips` with all 4 states. Producer-side: `compute_v11_sprint1_calibration.py` should always emit all four with the v2-lexicon copy. |
| ME2 | P0 | `Risk Off` card description: `Tile rule is fully met. Mechanism is signaling its concerning regime.` — `concerning` is theme #3 banned lex, slipped through the scrub. | Calibration JSON's `lexicon.tooltips["Risk Off"]` carries the banned word. | Producer scrub. Replace with `Mechanism is in the alert quartile of its 5y baseline.` |
| ME3 | P0 | Headline gauge sentence: `Risk-off setup forming. 3 of 3 live cycle mechanisms elevated above Normal — 1 in Risk Off territory, 2 Cautionary.` — `above Normal` is banned per BANNED_NORMAL_PATTERNS. | Same producer regression. | `above Normal` → `above the cohort` (or restate as `… in Cautionary or Risk Off territory`). |
| ME4 | P0 | Valuation `RULE` block reads: `Risk Off when 3 of 4 indicators sit in their concerning quartile.` — `concerning quartile` is banned, theme #3. | The auto-refresh on main re-emitted the JSON before my producer scrub landed; deployed bundle has the old text. | Producer-side scrub of `tile.rule.description` for every tile, not just the keys. Needs a re-run + re-deploy. |
| ME5 | P1 | `CALIBRATED INDICATORS` table for Valuation — `CAPE (Shiller)` row shows `Shiller · As of 2026-05-05`. The brand pattern is `Vendor · As of YYYY-MM-DD`, but the date here is older than the page-level `17H AGO` chip. Equity Risk Premium row says `Derived · As of 2026-05-31` — `Derived` is plumbing slang (theme #5) and the date is in the FUTURE (May 31 vs today May 6). | Per-indicator `current.date` is whatever the producer wrote; "Derived" is the literal source string. | (a) Replace `Derived` with the upstream chain (e.g. `FRED-derived`). (b) Clamp `current.date` to today on the page if it's in the future (or fix the producer). |
| ME6 | P1 | Buffett Indicator row: `FRED · As of 2025-12-31` — 5+ months stale. No freshness chip per row, no "STALE" badge. Looks current at a glance. | Inline render of as-of date only. | Add per-row freshness state pill (green/amber/red) when as-of vs SLA exceeds threshold. |
| ME7 | P2 | Jump-nav: 11 chips on a sticky bar. `Lexicon, Headline gauge, Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth, Allocator (v10), Sources` — long. On narrow viewports, will wrap or overflow. | Inline flex-wrap. | Confirm wrap behavior; consider collapsing to a select/dropdown on narrow viewports. |
| ME8 | P2 | "see live tile →" CTA at top-right of each mechanism card. Same accent color as the eyebrow. Hover not visible without cursor. | `.v2-cta` class. | Verify hover/focus-visible visible in production bundle. |
| ME9 | P3 | Each mechanism card scrolls into view with `scrollMarginTop: 24` — but the sticky jump-nav is taller than that (~50px), so the card heading hides under the nav after click. | Inline scrollMarginTop too small. | Bump to `scrollMarginTop: 80` to clear sticky nav. (Already set on lexicon/headline/allocator/sources sections; missing on `MechCard`.) |


## #admin · Admin (Usage + Bugs share one route) — signed in

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| AD1 | P0 | Sidebar `Admin · Usage` and `Admin · Bugs` BOTH render the same page. The page mixes a `UW API usage` header (with no actual usage stats below) and an Admin bug-list table. Should be two distinct views. | `App.jsx` routes both `tab==="admin"` and `tab==="bugs"` to `<AdminPageV2 />`. AdminPageV2 doesn't read `tab` to differentiate. | Either split into two components (AdminUsagePageV2 / AdminBugsPageV2) or pass `tab` prop and conditionally render. |
| AD2 | P0 | First-paint shows `OPEN P0 0 / OPEN P1 0 / OPEN P2 0 / TOTAL OPEN 1`, then animates to settle. After click on a row, stats jumped to `15/12/14/48` then back. The denominators are unstable / non-deterministic. | CountUp race + page recomputes on click? | (a) Compute counts once from `bug_reports` fetch, never animate. (b) Bug-row click should NOT trigger stat recompute. |
| AD3 | P0 | `TOTAL OPEN ... bug_reports table` — the sublabel `bug_reports table` is the Supabase table name. Theme #5 plumbing leak. | Inline render. | Replace with `open tickets`. |
| AD4 | P1 | `UW API usage` header at top has copy `Daily calls, quota remaining, peak RPM, and recent run history. Visible only to admins.` but no actual stats render below. The view is empty under the header. | AdminPage.jsx has the header but no usage stats wired. | Wire to `/api/usage` (legacy) or to a Supabase view with daily_calls / quota_remaining / peak_rpm / recent_runs. |
| AD5 | P1 | Bug rows are not clickable (clicking row 1159 did nothing). Theme #9: "every aggregate must drill down to its components". | No `onClick` on `<tr>`. | Wire onClick → drawer with full bug detail (description, screenshots, repro steps, fix history). |
| AD6 | P2 | Bug list shows `STATUS: NEW` and `FIXED` only — no filter by status. Theme #9 + UX: should be filterable. | No filter pills above the table. | Add `All / New / Triaged / Fixed / Resolved` pill set above the table mirroring Indicators page filter. |
| AD7 | P3 | `← Home` breadcrumb top-left — okay, but no breadcrumb on other pages. Inconsistent. | Inline breadcrumb only on Admin. | Either add to all pages or drop here. |
| AD8 | P3 | Top-right corner shows a small `M/T` mark — looks like a partial logo render. | Unknown component. | Investigate / drop. |


## Signed-out flows

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| SO1 | P0 | Home hero shows `WELCOME BACK / Joe.` when SIGNED OUT. Hardcoded literal `Joe.` regardless of session. (This is the bug Joe flagged: "Welcome back, Joe even when I'm signed out!!!".) | `src/v2/pages/HomePage.jsx` heading literal `<h1>Joe.</h1>` — no `useSession()` check. | Wire `useSession()`. When `!session`, render generic header (e.g. `MacroTilt.` or `Today.`). When `session`, derive name from `session.user.user_metadata.first_name` / fallback to email handle. |
| SO2 | P1 | Sidebar `Portfolio Insights` is clickable when signed out and routes to a `$0` page. No locked state. | Sidebar button always active. | Greyout / lock icon for tabs requiring auth; on click route to a sign-in modal instead of the dead page. |
| SO3 | P1 | Insights signed-out renders hero `TOTAL NET LIQUIDATION $0` THEN below shows the sign-in CTA. Hero should be hidden when not signed in; sign-in CTA should be the primary content. | Hero renders unconditionally above the auth gate. | Hide hero when `!isAuthed`. Replace with a single centered sign-in card. |
| SO4 | P2 | Bottom-left sidebar text `Not signed in / Portfolio tabs require sign-in.` is good; but no link to sign in — user has to click `Sign in` button in top-right corner. | Inline paragraph text. | Make the entire bottom-left block clickable → opens sign-in modal. |


## Site-wide / cross-cutting

| # | Severity | Defect | Evidence | Fix |
|---|----------|--------|----------|-----|
| SW1 | **P0 — root cause of "site is broken"** | NO React error boundary. A single component throw kills the entire app — sidebar, hero, every tab, sign-in button. Joe's "can't even sign in" was a side-effect of the `/#scenarios` `n.map is not a function` crash in SC1. | Catastrophic single-page crash propagates. | Wrap every v2 page in a top-level `<ErrorBoundary>` that catches render exceptions and renders a fallback (`Tab failed to render — try another` + "report bug" link). Critical for v2 default-on. |
| SW2 | P0 | CountUp animation race condition: hero stats render `0` for ~3-5s on first load, then animate to true value. Affects Macro Overview tile scores, Asset Tilt STRESS/EQUITY, Indicators hero, Admin counts, Home Today's Stance. The first paint is what users see and judge — they see `0` and assume broken. | `CountUp.jsx` `useEffect` with IntersectionObserver. First frame fires before async data arrives; subsequent setVal locked. | Either (a) skip animation entirely when data arrives async — render the value at first frame; or (b) re-trigger CountUp's "started" flag when `to` changes from null to a number. |
| SW3 | P1 | Theme #2 violation site-wide: NO chart on the v2 site renders calibrated tint bands. Macro Overview drawer charts (verified Valuation 5Y, Liquidity & Policy 5Y) and Indicators drawer (VIX 5Y) all show plain time-series lines with no green/grey/amber/red 25/50/75 band tints behind them. | MTChart `tintBands` prop not wired in any of the 3 places I checked. | Wire on every chart. Macro Overview composite chart needs fixed 0–100 cuts; indicator charts need indicator-specific 25/50/75 cuts (computed from history). |
| SW4 | P1 | `MARKET OPEN` badge in top header is ALWAYS green-pill + 'MARKET OPEN' regardless of clock / weekend / holiday. | Static. | Compute live: NYSE 9:30-16:00 ET on trading days, premarket / aftermarket / closed otherwise. Reference `nyse_holidays.json` already in repo. |
| SW5 | P1 | Freshness chips inconsistent across tabs. Macro Overview hero `17H AGO`, Home tile-01 `17H AGO`, Home tile-02 `2D AGO`, Home tile-04 `2H AGO`, Asset Tilt hero `2D AGO`. User cannot intuit whether a chip is "fresh enough" for that surface. | Each chip uses its own data element's age vs SLA. | All chips need a green/amber/red dot color reflecting age-vs-SLA, not just the timestamp. Hover state should expand to show SLA + last-success + next-expected (per LESSONS rule on freshness UX). |
| SW6 | P1 | "Report Bug" button bottom-right of every page. Clicking it (untested in this audit but flagged): does it open the legacy bug-report form or a v2 form? Auth-gated? | Floats persistently. | Verify the form submits to `submit_bug_report` RPC (LESSONS rule, RLS workaround). Style it to v2 brand. |
| SW7 | P2 | The brand monogram `M/T` in the top-left logo block is small and low-contrast against the white bg. | SVG monogram. | Bump weight or contrast; verify against `light` and `dark` themes. |
| SW8 | P2 | Theme toggle (sun/moon icons in top-right) — clicked? Does it actually toggle dark mode? Untested. | Two icon buttons. | Verify both modes load; light vs dark parity is brand-spec binding. |
| SW9 | P2 | Sidebar nav lacks a search / filter. With 7 tabs + 2 admin entries, fine for now. But no keyboard shortcut binding (e.g. cmd+1 → Home). | No keyboard shortcuts. | Add `cmd+1..7` for tabs. |
| SW10 | P3 | All v2 pages still ship the decorative `<div className="arc">` SVG with concentric circles in the JSX, even though my CSS hides it. Dead DOM. | Inline SVG block in every page hero. | Remove from JSX entirely. CSS hide is sufficient functionally but the markup is a code smell. |

## Audit summary

Walked all 9 v2 tabs (Home, Macro Overview, Asset Tilt, Trading Opportunities, Portfolio Insights, Scenario Analysis, All Indicators, Methodology, Admin) signed-in plus signed-out home + insights. Drilled into the Macro Overview Valuation drawer + Liquidity & Policy drawer + Indicators VIX drawer + Asset Tilt Pharmaceuticals drawer. Compared rendered values to underlying JSON for every key field. Console errors captured.

**Defect totals by severity:**


  - **P0 (blocking — must fix before re-flipping V2_ENABLED):** 26
  - **P1 (high impact):** 21
  - **P2 (medium):** 24
  - **P3 (polish):** 16
  - **Total:** 87 defects across 9 tabs/surfaces

**Top-3 P0 root causes that explain most user-visible breakage:**

1. **No React error boundary** (SW1) — any throw kills the whole app. Caused Joe's "can't even sign in".
2. **CountUp race condition** (SW2 / MO1 / MO2 / AT4 / ID1 / AD2) — every hero stat shows 0 for 3-5s on first load. The first thing every user sees is "0".
3. **Data-shape contracts mismatched between pages and JSONs** (H2 / TO1 / IN1 / SC1 / ID2) — TradingOpps / Insights / Scenarios / Indicators all read keys that don't exist in the producer JSON. Silent zero/empty rendering.

**Recommended fix order** (after producing this audit, NO code changes):

1. SW1 (error boundary) — single PR; unblocks all the rest.
2. SW2 (CountUp race) — single component fix; affects 6+ surfaces.
3. SC1, H2, TO1, IN1, ID2 — five data-shape parser fixes; can ship in parallel.
4. ME2/ME3/ME4 producer-side scrub re-emit — single producer commit + JSON re-publish.
5. AT3 — strip -style scoring jargon from Asset Tilt — single page fix.
6. SO1 — auth-aware Home hero — single page fix.
7. AT1, ME1 — lexicon harmonization (Cautious → Cautionary; populate Risk On/Neutral tooltips) — producer-side.
8. The remainder of P1/P2/P3 — work through tab-by-tab.
