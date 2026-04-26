# MacroTilt Asset Allocation v10 — Backend

Industrialized, schema-validated, monitored data + compute pipeline for
the Asset Allocation tab. Architecture per
`asset-allocation-v10-architecture.md` at repo root.

## Layers

```
acquisition.py   — L1: pull factors, prices, SPY holdings, reference data
validation.py    — L2: schema, freshness, sanity, anomaly checks
compute.py       — L3: regression, ratings for all 14 buckets, narrative   [Phase 2]
state.py         — L4: append-only allocation history                       [Phase 3]
output.py        — L5: schema-validated JSON, public/v10_allocation.json    [Phase 3]
monitoring.py    — L6: run_log, anomaly alerts, admin page                  [Phase 5]
```

Each layer has tests under `tests/`. CI runs them on every PR.

## Quick start

A complete pipeline run:

```bash
# Phase 1: pull and validate
python -m asset_allocation.acquisition --run-dir /tmp/aa/2026-04-26
python -m asset_allocation.validation  --run-dir /tmp/aa/2026-04-26

# Phase 2-5 (not yet built — placeholders):
python -m asset_allocation.compute     --run-dir /tmp/aa/2026-04-26   # TODO
python -m asset_allocation.state       --run-dir /tmp/aa/2026-04-26   # TODO
python -m asset_allocation.output      --run-dir /tmp/aa/2026-04-26   # TODO
```

Each step writes its outputs into the run directory. Validation is
gating — if it fails, downstream steps don't run.

## Outputs

```
{run_dir}/
├── factor_panel.json       — ~30 macro factors, history back to 2001
├── price_panel.json        — daily ETF prices for 20 tickers (14 equity + 4 defensive + 2 bench)
├── spy_holdings.json       — current SPY composition aggregated to GICS sector
├── reference_groups.json   — static industry-group reference (top examples per IG)
├── acquisition_run.json    — per-step success/warning/failure log
├── validation_report.json  — schema + freshness + sanity + anomaly results
├── allocation.json         — [Phase 2] computed allocation                 (TODO)
└── publication.json        — [Phase 3] schema-validated output ready for UI (TODO)
```

## Schemas

All outputs are validated against JSON schemas in `schemas/`. Schema
breakage halts the pipeline and fails CI.

| Schema | Validates |
|---|---|
| `factor_panel.schema.json`           | acquisition.py output for factor data |
| `price_panel.schema.json`            | acquisition.py output for ETF prices |
| `spy_holdings.schema.json`           | acquisition.py output for SPY composition |
| `industry_group_reference.schema.json` | static reference data |
| `allocation_output.schema.json`      | final UI-consumable output (Phase 3) |

## Tests

```bash
cd <repo root>
python -m pytest asset_allocation/tests/  # fast unit tests, offline
python -m pytest asset_allocation/tests/integration/  # live data tests, slower
```

Unit tests must pass on every PR. Integration tests run on the merge to
main and on the weekly schedule.

## Cadence

The pipeline runs **weekly Friday after market close (5:30pm ET)** plus
**daily Monday-Thursday morning** for the regime watch (composite movement
since last rebalance).

The weekly run produces a new allocation; the daily run only flags if a
regime shift has occurred since the last formal rebalance.

## Failure handling

Every layer has named failure modes documented in
`docs/asset-allocation-runbook.md`. Common cases:

- **FRED API down:** acquisition layer logs warning, falls back to last-known-good for affected factors. If down > 3 days, pipeline halts and alerts.
- **yfinance rate-limited:** exponential backoff, 4 retries, then stale-by-1-day fallback.
- **SSGA SPY holdings link broken:** falls back to last week's snapshot.
- **Validation failure:** pipeline halts, alert, no new allocation publishes. Last-known-good stays live.
- **Anomaly detected:** allocation runs but is flagged for operator review before publication.

## Ownership

| Layer | Owner |
|---|---|
| Acquisition + validation | Lead Developer |
| Compute (rating logic, narrative templates) | Senior Quant |
| State + output schema | Lead Developer |
| Monitoring | Lead Developer |
| UI consumption | UX Designer |

## Status

| Phase | Status |
|---|---|
| Phase 1 — Data layer (acquisition + validation + schemas + tests) | **Built — this PR** |
| Phase 2 — Compute extensions (rate all 14 buckets, MoM/QoQ) | TODO |
| Phase 3 — State management + output schema | TODO |
| Phase 4 — Narrative templating engine | TODO |
| Phase 5 — Scheduling + monitoring | TODO |
| Phase 6 — Wireframes (UX Designer) | TODO |
| Phase 7 — UI build to spec | TODO |
| Phase 8 — Production cutover | TODO |
