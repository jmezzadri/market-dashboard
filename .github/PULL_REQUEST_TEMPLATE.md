<!--
  MacroTilt PR template. Strip whatever's not relevant to your PR.
  Specialist sign-offs (per project instructions) are required for
  merge — fill in the boxes that apply.
-->

## Summary

<!-- One paragraph: what changed, why, what bug# it closes. -->

## Specialist sign-offs

- [ ] **Lead Developer** — Self-UAT done. State what was tested, what was
      observed, and whether it matched the expected outcome.
- [ ] **Senior Quant** — required if this PR touches calculations,
      indicators, models, scoring logic, or anything under `compute_*.py`.
      Math explained in plain English; back-test referenced.
- [ ] **UX Designer** — required if this PR touches `.tsx`, `.jsx`,
      `/components/`, or `/styles/`. Brand fit confirmed.
- [ ] **Data Steward** — required if this PR touches `supabase/migrations/`,
      `scripts/`, `supabase/functions/`, `asset_allocation/`,
      `.github/workflows/*`, `data_manifest.json`, `pipeline_schedule.yml`,
      or freshness UX. Element registered, grants reviewed, schedule
      normalized.

## Shared-producer changes — REQUIRED home-page check

If this PR touches **any** of the following, attach a screenshot of
`macrotilt.com/#home` showing the affected tile is still rendering:

- [ ] `compute_v9_allocation.py` — Home Outperformance/Drawdown/Sharpe tile,
      Asset Allocation tab
- [ ] `fetch_history.py` / `compute_composite_history.py` — Home Macro
      lead-in, TodayMacro chart
- [ ] Anything under `public/*.json`
- [ ] N/A — this PR doesn't touch a shared producer

> Producer schema changes have broken Home tiles silently before
> (bug #1109, LESSONS rule #29). The CI contract check catches missing
> required keys, but a screenshot is the only thing that catches a
> shape change the contract didn't anticipate yet.

## New `public` table? — REQUIRED grants check

Supabase changed its Data API default on 2026-05-13. Starting Oct 30, 2026
new tables in `public` are NOT auto-exposed to supabase-js. Every new table
must ship with explicit `GRANT` statements or the front end will silently
break with error 42501. Reference: `supabase/migrations/000_TEMPLATE.sql`.

- [ ] This PR does not add any new `public` table — N/A.
- [ ] This PR adds a new `public` table and the migration contains explicit
      `grant ... on public.<table> to <role>` for every role the consumer
      needs. Pattern picked (A public-read / B user-owned / C service-only)
      named in the description.

## UAT evidence

<!--
  At minimum: the live URL you tested, what you clicked, what you saw.
  Screenshots strongly preferred for UI/visual changes. If you couldn't
  test something, say so explicitly and explain why.
-->
