# Scenario Stress — Phase 2 Scope (Joe directive 2026-05-08)

## What Phase 2 ships

Two things go live together at the end of Phase 2:

1. **Cycle Mechanism Scenario Results table** (Scenario Analysis page, right column, top tile). Currently a placeholder — Phase 2 fills it in with `current` and `under stress` mechanism scores per scenario, and the page-level composite.
2. **Per-IG stress numbers** (Asset Tilt table, Industry Group rows). Currently `—`. Phase 2 fills with calibrated per-IG stress per scenario.

Both pieces depend on the same calibration JSON and the same backtest harness, so they ship as one Phase 2 release rather than two half-shipped tables.

## Methodology — Mechanism Stress

For each of 8 historical scenarios + the Custom Multi-Factor Shock builder, we want stressed mechanism scores. The rule:

> For each mechanism, look at the inputs that feed it. Document the value of each input at the historical scenario's peak stress. Re-percentile each stressed input against the calibration's full historical sample. Aggregate the stressed input scores to the mechanism score using the same simple-average logic the live engine uses today.

Six mechanisms × ~22 unique indicators across them = ~22 input panels we need to populate at peak stress for each of 8 scenarios. ~176 calibrated numbers. Senior Quant work.

Indicator panel by mechanism (sourced from `compute_v11_mechanisms.py` PANELS + `methodology_calibration_v11.json` Sprint 1 tiles):

| Mechanism | Indicators |
|---|---|
| Equity Valuations | CAPE (Shiller), ERP (Shiller), Buffett ratio (Wilshire 5000 / GDP) |
| Credit | HY OAS (ICE BofA via FRED), IG OAS (ICE BofA via FRED), IG-HY spread ratio |
| Funding | Commercial Paper risk premium (CPFF), St. Louis Fed FSI (STLFSI), Bank reserves at Fed, Reverse repo balance |
| Growth | ISM Manufacturing PMI, ISM Services PMI, Atlanta Fed GDPNow |
| Liquidity & Policy | Chicago Fed ANFCI, Fed Balance Sheet YoY %, SLOOS C&I lending tightening, M2 YoY % |
| Positioning & Breadth | CBOE SKEW, VIX, Equity-credit correlation 60d, MOVE Index (Treasury vol) |

## Methodology — IG Factor Loadings

For each of 25 IGs, run weekly OLS regression of the IG's proxy ETF total return against the 12 factors that feed sector stress (vix, move, real_rates, term_premium, dxy, copper_gold, hy, stlfsi, anfci, aaii, putcall, breadth). Window: rolling 5-year, weekly bars from Polygon Massive history. Output: `{ig_id: {factor: loading}}` JSON consumed alongside `SECTORS_RAW.loadings` in `sectorShocks()`.

## Backtest

Two harnesses, both required before Phase 2 declares "done":

1. **Mechanism stress harness.** For each (scenario × mechanism), compare the model's predicted stressed score at the scenario's historical peak to the OBSERVED mechanism score on that peak date. Tolerance: ±15 percentile points per mechanism, ±10 on the page-level composite. If a scenario × mechanism is outside tolerance, the calibration is rejected and Senior Quant re-tunes the input panel.
2. **IG regression harness.** Out-of-sample R² > 0.55 for each IG's 12-factor model AND the ranked stress for IGs within a sector under historical regime examples must align with realized IG returns over those windows.

Evidence pack lands in `dist/scenario_stress_backtest/` with one PDF per scenario (predicted vs observed mechanism scores, residuals, indicator-level detail).

## Sub-PR rollout

| PR | What ships | Lift | Owner |
|---|---|---|---|
| Phase 2A — Scope (this PR) | Scope doc, calibration JSON skeleton, Phase 2 punchlist | 1 day | Lead Dev |
| Phase 2B — Mechanism calibration values | Populate `scenario_stress_calibration.json` with peak-stress values for all 8 scenarios × 22 indicators. Defendable sources cited per row. | 4–5 days | Senior Quant |
| Phase 2C — Mechanism stress producer | `scripts/compute_scenario_mechanism_stress.py` reads calibration → outputs `public/scenario_stress.json`. GitHub Actions workflow `.github/workflows/scenario-stress-daily.yml`. | 1 day | Lead Dev |
| Phase 2D — Mechanism backtest harness | `scripts/backtest_scenario_stress.py`. Rejects calibrations failing tolerance bands. Evidence pack PDF. | 2 days | Senior Quant + Lead Dev |
| Phase 2E — Wire Cycle Mechanism table | Frontend reads `scenario_stress.json` per selected scenario, renders Table 2 live. Replaces placeholder. | 1 day | Lead Dev |
| Phase 2F — IG factor regression | `scripts/compute_ig_factor_loadings.py` runs weekly OLS per IG. Outputs `public/ig_factor_loadings.json`. | 2 days | Senior Quant + Lead Dev |
| Phase 2G — Wire IG stress in Table 1 | Frontend reads IG loadings, computes per-IG stress. Replaces "—". | half day | Lead Dev |
| Phase 2H — Data Steward registration | Register all new elements in `data_manifest.json`, freshness chips, methodology page section. | 1 day | Data Steward |

Total: ~2 weeks Senior Quant + ~3 days Lead Dev.

## Sign-off gate

Phase 2 declares done only when:
- Mechanism backtest passes ±15pp tolerance on every (scenario × mechanism) pair
- IG regression R² > 0.55 OOS on every IG
- Senior Quant + UX Designer + Data Steward all sign off on the same PR (Phase 2H)
- Joe approves the merge to main
