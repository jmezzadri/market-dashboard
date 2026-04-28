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

## UAT evidence

<!--
  At minimum: the live URL you tested, what you clicked, what you saw.
  Screenshots strongly preferred for UI/visual changes. If you couldn't
  test something, say so explicitly and explain why.
-->
