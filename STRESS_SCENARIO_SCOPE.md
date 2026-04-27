# MacroTilt — Stress / Scenario Analysis Scope

**Status:** SCOPED, NOT STARTED. Captured 2026-04-27 evening so we don't
lose sight after the Asset Allocation tab polish wraps up.

**Owner:** Senior Quant leads the math; Lead Developer ships; UX Designer
owns layout and copy.

**Trigger:** Joe noted "next major change on this page will be to bring
in the Stress / Scenario Analysis capability" after PR #200 / #211
landed.

---

## What we know so far

### From Joe's prior responses (memory file `project_sector_lab_stress_testing.md`, 2026-04-22)

- **Canned scenarios + user-defined.** Both modes are in scope. The
  product is NOT an open-ended slider tool — it's a curated set of
  named scenarios (GFC-2008 replay, COVID-2020, 2022 inflation shock,
  AI-bubble pop, etc.) AND a user-defined builder that lets the user
  pick a starting macro state and a duration.
- **Correlated factor moves, not independent sliders.** This is the
  hard rule. When the user moves "real rates +50bp," the simulation
  must propagate the historical correlations to every other factor
  (term premium, USD, copper-gold, VIX, credit spreads, etc.) — not
  let each slider move in isolation. Independent sliders produce
  finance-fiction outputs ("real rates up but VIX down and credit
  spreads tight" is a thing that doesn't happen in reality).
- **Do NOT ship sliders without calibrated covariance.** Hard veto on
  Joe's part. The covariance matrix has to be calibrated against the
  actual factor history (e.g., 2008-2026 weekly returns) before any
  user-facing slider exists.

### What this means for the Asset Allocation tab specifically

Per LESSONS rule 9 (data first, no exceptions), we need:

1. The factor covariance matrix as a versioned input file
   (`public/factor_covariance.json` or similar).
2. A scenario engine: `simulate(scenario_or_user_inputs) →
   {factors, picks, weights, alpha, drawdown}`.
3. A back-test of the engine itself against historical episodes —
   "given the macro state at the start of 2008-09, does the engine
   reproduce something close to what actually unfolded?"
4. UI to pick a scenario or build one, and show the resulting
   allocation diff vs the current calm-state recommendation.

---

## Open design questions (for Joe when he picks this up)

1. **Where does it live on the page?** Three plausible homes:
   (a) New Section 7 below Methodology, default-collapsed.
   (b) Modal triggered from a "Stress test this allocation →" button
       in the hero KPI strip.
   (c) Its own tab `/#stress` (deep-linkable, shareable).
   Recommendation pending.

2. **Scenario library — what's the shipping set?** Strawman:
   - GFC 2008 (R&L peak, credit blowout, equity drawdown −46%)
   - COVID March 2020 (volatility shock, V-bottom recovery)
   - 2022 Inflation Shock (real rates spike, multiples compress)
   - 2024 AI Mega-Cap Concentration (narrow-breadth rally)
   - 2018 Q4 (Powell pivot, credit widening)
   - User-defined ("what if real rates go to 2.5%?")
   Joe to bless the list before Senior Quant calibrates.

3. **Time horizon.** 1-month forward simulation? 3-month?
   6-month? Multiple horizons in tabs?

4. **What does "user-defined" actually let the user move?** The
   composite scores (R&L, Growth, IR)? Individual factors (real
   rates, VIX, copper-gold, etc.)? Both? The covariance constraint
   is the same either way, but the surface area of inputs matters
   for UX.

5. **Does the stress output show a NEW recommendation or just impact
   on the CURRENT one?** Both are useful. "If COVID happens tomorrow,
   the model will rotate to defensive sleeve activation + these picks"
   versus "If COVID happens tomorrow, the current Aggressive book
   takes a −Y% hit." Probably both.

6. **Per-pick stress vs portfolio-level stress.** Show how each of
   the 5 current picks responds to the scenario, OR roll up to a
   single portfolio P&L number, OR both.

7. **Calibration window.** 2008-2026 (full v9 backtest) or rolling
   shorter window (5y / 10y)? Affects whether "scenario X happens
   today" calibrates against the full crisis library or just recent
   regime.

---

## Out of scope (deliberate cut-outs)

- Independent sliders without correlated propagation. Hard veto.
- Real-time tick-by-tick simulation. Daily/weekly is fine.
- Trading the scenario directly from the page. View-only.

---

## Suggested phasing (if we pick this up later)

1. **Phase 1 — covariance calibration.** Senior Quant builds the
   factor covariance matrix from 1998-2026 weekly returns. Schema-
   validated JSON output. Tests for stationarity warnings.
2. **Phase 2 — scenario engine (no UI).** `simulate()` function in
   `asset_allocation/scenario.py`. Golden-output tests for the 5
   canned scenarios. CI runs them.
3. **Phase 3 — UI mockups.** UX Designer drafts wireframes against
   the v10 schema for scenario output. Joe reviews. Three states
   shown: calm, stress, regime-flip.
4. **Phase 4 — implementation.** Lead Developer builds React + wires
   the engine to UI. UX Designer signs off on rendering.
5. **Phase 5 — back-testing the back-test.** Senior Quant validates
   the scenario engine against historical episodes one more time on
   prod data before declaring it shippable.

Realistic timeline: 4-6 weeks of focused work to do correctly. Per
LESSONS rule 10, no half-version shipped.

---

## Where to find this doc later

- **In the repo root:** `STRESS_SCENARIO_SCOPE.md` (this file).
- **In Joe's auto-memory:** `project_stress_scenario_scope.md`.
- **In chat:** mention "stress scenario scope" and the team agent
  will surface this doc.

When Joe is ready to pick this up, the kickoff message is:
> "Let's start the stress / scenario work. Read STRESS_SCENARIO_SCOPE.md
> first, then come back with a Phase 1 kickoff plan."

Senior Quant + UX Designer + Lead Developer will read the doc, propose
the answers to the open design questions, and Joe approves before any
calibration code ships.
