# Senior Quant Sign-off — Scenario Analysis Phase 1 Calibration

**Calibration date:** 2026-04-28 00:21 UTC
**Window:** 1985-01-01 through 2026-04-28

## Deliverables produced

1. `factor_panel_calibrated.json` — 16 CCAR US-Domestic variables, mixed-cadence,
   Ledoit-Wolf-ready innovations.
2. `factor_covariance.json` — Σ̂ shrinkage applied; sub-window stability diagnostics.
3. `scenario_anchors.json` — 8 historical scenario shock vectors at anchor weeks.
4. `coherence_validation.json` — KS diagnostic; parametric vs. empirical fallback.
5. `oos_backtest.json` — schema only; populated by Track 3 sector loadings re-fit.
6. `international_factor_panel.schema.json` — v1.1 stub.

## Acceptance gates per methodology §10

- [ ] All 16 factors pulled with proxy substitutions applied.
- [ ] Ledoit-Wolf shrinkage produces non-singular Σ̂.
- [ ] Sub-window stability check flags any |Δρ| > 0.3 across decades.
- [ ] All 8 scenarios anchored within their windows.
- [ ] KS test p-value reported (parametric used if p ≥ 0.01).
- [ ] OOS schema reserved for Track 3 to populate.
- [ ] International v1.1 stub schema reserved.

## Next actions

- Sprint 1 Track 3 (Lead Developer): React shell scaffold using v2.3 demo as visual spec.
- Sprint 2 (task #13): wire L4 to compute_v9_allocation via translation layer (task #20).
- Sprint 3: golden-output back-tests gate ship.

— Senior Quant
