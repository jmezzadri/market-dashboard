# NOTES — Conviction Events page rebuild → engine-cutover handoff

Branch `feat/conviction-pages` rebuilds /paper, /scanner and /methodology for
the Conviction Events strategy (one book; the Insider + Momentum sleeves are
retired). The pages code against the agreed data contract (`ce_events`,
`ce_kill_switch`, book in the sleeve-B slot of the existing paper tables) and
degrade to "awaiting first events" everywhere the contract's tables don't
resolve yet. **Nothing below has been applied — every step is for the lead to
execute at the engine cutover.** Per LESSONS 2026-07-21 the feed cutover is
atomic: manifest SLA + pipeline_health seed + workflow stamp steps land in the
SAME change as the engine going live.

---

## 1 · pipeline_health seed row (apply AFTER the engine's first real run)

The pages' freshness chips key the new element to pipeline_health row key
`ce_events` (the public manifest's short `name`). Honest-stamp rule (LESSONS
4.2): seed with the FIRST REAL run's wall-clock times — never `now()` typed by
hand, never a data date dressed as a run time. Do not seed before the run
exists (that manufactures fake green, Hard Rule 0.1).

```sql
insert into public.pipeline_health
  (indicator_id, label, source, cadence, status,
   last_good_at, last_check_at, data_as_of, last_error)
values
  ('ce_events',
   'Conviction Events ledger',
   'ce_events',                          -- names the ACTUAL table graded (LESSONS 2026-07-13: never a sibling's source)
   'daily',
   'green',
   '<real first-run completion timestamp, UTC>',
   '<real first-run completion timestamp, UTC>',
   '<latest filing_date the run wrote>',
   null);
```

In the SAME change:

- `public/data_manifest.json` + root `data_manifest.json`, element
  `portfolio.ce-events-daily`: set `freshness_sla_hours: 49`,
  `data_max_age_hours: 73` (49h job SLA + the filings' T+1 morning pull;
  re-derive from the real schedule if it differs), fill
  `scheduled_fetch_time_et` / `refresh_trigger` with the real workflow, set
  `current_status: "live"`, and set
  `dependencies: ["insider_history_edgar", "market-prices_eod-daily"]`
  (left empty pre-cutover so the grey pending chip can't inherit an input's
  red). They are 0 / "pending-first-run" right now ON PURPOSE: an SLA armed
  before a producer exists is a false red; a registered element with no
  target grades grey — matching the no-health-row doctrine.
- Engine workflow gets the standard green-after-publish + red-on-failure
  stamp steps (stamp green only AFTER the upsert is verifiably committed —
  LESSONS 2026-06-12).
- Add the engine workflow to WORKFLOW_FAILURE_ALERT's watchlist (LESSONS
  4.24: alert coverage is an inventory, not a habit).

## 2 · Tables + grants (before the engine's first run)

- Create `public.ce_events` and `public.ce_kill_switch` per the agreed
  contract. Both must be **anon-readable** (the pages read them with the
  publishable key): use the grant/RLS template at
  `supabase/migrations/000_TEMPLATE.sql` — new public tables are NOT
  auto-exposed (LESSONS 6.10). Ingestion stays service-role-only.
- The pages read these exact columns — keep the names:
  - `ce_events`: filing_date, ticker, total_usd, insider_names, n_insiders,
    is_edgar_sourced, passed_gates, gate_fail_reason, above_sma50, action,
    entered_at, entry_qty, entry_price, exit_due_date, exited_at, exit_price,
    trade_return. `action` values rendered:
    entered / skipped_full / skipped_gate / skipped_dup / blocked_kill_switch.
  - `ce_kill_switch` (single row): tripped, tripped_at, reason, book_return,
    spy_return, max_drawdown, checked_at.
- `gate_fail_reason` renders to readers (hover on the "Failed gates" chip,
  underscores softened to spaces) — have the engine write it in plain
  English, e.g. "below the 50-day average", "under $250,000 after removing
  plan purchases".
- `insider_names`: the pages accept a Postgres/JSON array or a "; "-joined
  string. An array is preferred.

## 3 · Paper-table re-seed (the book in the sleeve-B slot)

- Re-seed `paper_nav_daily` at cutover. **The pages key inception off the
  table's EARLIEST row** — no dates are hardcoded anywhere; whatever the
  first row says is the book's start.
- `paper_accounts` active row: `sleeve_b_allocation = 1000000`,
  `sleeve_m_allocation = 0`. The page uses `sleeve_b_allocation` as the
  since-start capital base (falls back to a $1,000,000 constant while the
  row is unreadable), and the hero copy says "$1M paper book" — if the reset
  seeds a different base, both the constant (`STARTING_CAPITAL` in
  `src/v2/pages/PaperPortfolioPage.jsx`) and that copy must change in the
  same PR.
- `paper_positions` / `paper_intraday_positions`: book rows carry
  `sleeve = 'B'` (the pages filter to it; null is tolerated as 'B'); no 'M'
  rows after cutover. `paper_intraday_nav` keeps stamping
  `spy_close` / `spy_prev_close` — the live S&P day row uses them.
- Flip `PAPER_LIVE_TRADING_ENABLED` back to `"true"` in
  PAPER-PORTFOLIO-OPEN-DAILY.yml + PAPER-PORTFOLIO-CLOSE-DAILY.yml (frozen
  "false" since 2026-08-10), and retire `MOMENTUM_SLEEVE_ENABLED` (the
  momentum sleeve no longer exists — don't leave a live-looking flag on a
  dead sleeve).

## 4 · Field-unit confirmations (blocking a small display upgrade)

The pages deliberately do NOT render `trade_return`, `book_return`,
`spy_return`, `max_drawdown` — the contract doesn't pin their units
(fraction vs percent vs points), and a number shown 100× off is worse than
none (LESSONS 4.4 / never-guess). Once the engine pins units, a follow-up
can add: a Result column on the event ledger (closed trades) and the
kill-switch line's live book-vs-S&P readings.

## 5 · Retired-machinery teardown (one atomic change, LESSONS 0.10 / 0.2)

Replacing the scanner's insider-score panel left these UNREACHABLE from the
live site (bundler tree-shakes them out of the bundle, but the weekly
dead-UI detector will flag the files). Deleting them belongs to the engine
cutover's full teardown of the insider-score scanner — do it in the same
change as the producer retirement, with `killed_elements.json` entries:

- `src/overhaul/components/ScanList.jsx` (only ever consumed by the old
  scanner page; self-references ScanDrill)
- `src/overhaul/components/ScanDrill.jsx`
- `src/hooks/useScanScoreHistory.js` (zero importers now)
- Dead CSS blocks in `src/overhaul/styles/scanner-v12.css` for the removed
  desk: `.sc-results`, `.sc-buildsec`, `.sc-toolbar`, `.sc-hint`,
  `.sc-gear`, `.sc-colpick`, `.sc-colgrid`, `.sc-ctog`, `.sc-foot`,
  `.sc-panelhead-tools`, `.sc-colbtn`, `.sc-toast`, `.sc-build*`,
  `.sc-ghostbtn`, `.sc-tenure`, `.sc-tip` (+ their responsive rules)
- Decide the fate of the Ticker page's insider-score drill (it still reads
  `trading_opps_signals` and documents the 0–5 score; the methodology for
  that score was deleted with the scanner panel). Keeping the scanner feed
  alive as a ticker-page feature vs retiring it is an engine-cutover
  product call — whichever way, copy + producers + manifest move together.
- Obsolete localStorage keys (harmless, self-expiring): the old scanner
  column state `mt-scanner-cols-v7`, the old paper column state
  `mt_paper_cols_v5_shared`.

## 6 · Post-cutover verification (LESSONS 3.1)

- Load /paper signed in: hero card shows the re-seeded book; positions carry
  "why it's here" from `ce_events`; ledger chips render; kill-switch line
  reads quiet with a real checked-at stamp; freshness dots green.
- Load /scanner signed out: Conviction Events tile ranks real events by
  buy total; Power Trend + RSI Divergence unchanged.
- /methodology: backtest figures render VERBATIM from the spec (+112% vs
  +24%, Sharpe 2.3, 61%, ~18-day hold, +53% ex-top-5, June 2025–August 2026,
  ~14 months, zero costs) — if the engine team re-runs the study and the
  numbers move, the page copy moves in the same change (LESSONS 8.3).
- Admin·Data: the Conviction Events ledger row is green with all five chip
  fields; the header pill does not count it as untracked anymore.
