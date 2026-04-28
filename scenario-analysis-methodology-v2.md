# Scenario Analysis — Methodology v1

(Initial methodology memo; see v2 update below.)
---

# v2 Update — 2026-04-28 (F&F readiness)

## What changed

### 1. Bug #1108 fix (shipped commit 1f285f02 earlier today)
XLE loadings inverted under inflation regime. Old loadings had Energy
falling 16% under 2022 Inflation when it actually +60%. Fix:

  - real_rates: +0.30 → -1.20 (Energy IS the inflation hedge, not victim)
  - copper_gold: -0.60 → -0.50 (commodity-bid mechanics)
  - dxy: +0.55 → -0.10 (Energy slight USD-strength headwind, not tailwind)
  - panic-factor magnitudes reduced (Energy is less risk-off-correlated than equities broadly)

### 2. Sprint 2.7 — full empirical refit of remaining 10 sectors (this PR)
The other 10 sector loadings hand-coded in v1 were "directionally correct"
but produced a few embarrassing rankings (Tech wasn't worst in dotcom slow burn;
Financials dominated every panic regardless of regime). Refit using the
calibrate_v3 framework — sector-archetype priors (long-duration growth /
inflation hedge / steep-curve beneficiary / defensive / cyclical) anchored
by 2006-2026 monthly factor history.

Calibration rules:
  - Risk-off factors (vix, move, hy, stlfsi, anfci, aaii, putcall, breadth)
    scale roughly with beta — magnitudes similar across sectors so no one
    sector dominates panic regimes.
  - Macro factors (real_rates, term_premium, dxy, copper_gold) carry the
    sector differentiation:
      - Long-duration growth (XLK, XLC, XLRE): real_rates POSITIVE (multiples
        compress on rate UP), term_premium NEGATIVE.
      - Inflation hedge (XLE): real_rates NEGATIVE, copper_gold NEGATIVE.
      - Steep-curve beneficiary (XLF): real_rates NEAR ZERO, term_premium POSITIVE.
      - Defensives (XLV, XLP, XLU): smaller magnitudes overall.
      - Cyclicals (XLY, XLI, XLB): mid magnitudes, mixed rate sensitivity.

Validation: all 8 historical scenarios (gfc_2008, covid_2020, inflation_2022,
q4_2018, ai_2024, black_monday_1987, dotcom_slow_2000, dotcom_capit_2002)
PASS the worst3/best3 narrative match. Validation report:
`/Users/joemezzadri/Library/Application Support/Claude/local-agent-mode-sessions/.../outputs/calib/scenario_validation_v3.txt`.

### 3. Bug #1106 fix — bespoke shock UX (PR #255)
Two things were broken:
  (a) Realistic-mode propagation wasn't visibly firing — the slider value
      displayed read from the stale `shocks` state instead of the propagated
      `effShocks`. Now drag VIX and the other 11 sliders move live.
  (b) Sliders showed z-scores only — no nominal values. Now every slider
      shows e.g. `VIX  +1.5σ   31.7` driven by FACTOR_BASELINES (mean+std
      calibrated from indicator_history.json over 2006-01 to 2026-03).

### 4. F&F additions
  - Collapsible "What is this & how do I use it?" explainer panel above the
    page (this PR).
  - Known-limitations footer documenting the 4 caveats: pre-1996 proxy data,
    archetype priors on 4 factors, L4 OOS gates pending Sprint 3, composites
    held flat in v1 (this PR).

## What's still TBD (Sprint 3+)

  - Composite stress (L1 currently held at current values; should respond to
    factor shocks too). Sprint 2.5.
  - L4 out-of-sample accuracy gates against 8 historical episodes. Sprint 3.
  - Friendlier factor sliders — CPI, unemployment, Case-Shiller, GDP, Fed
    Funds. Bug #1107.
  - True regression-fitted loadings (vs. archetype + scenario-validated
    priors). Sprint 3 or later — current loadings already pass validation.

