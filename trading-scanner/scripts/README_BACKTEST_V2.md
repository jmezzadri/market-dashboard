# Trading Opps v2 back-test pipeline

Companion to `scanner/signal_intelligence_v2/`. Generates the three
calibration JSON files the producer reads:

- `public/calibration_v2_magnitude_to_excess_return.json`
- `public/calibration_v2_conviction_table.json`
- `public/calibration_v2_bands.json`

## Quick start (placeholder mode)

```bash
cd trading-scanner
PYTHONPATH=. python3 scripts/run_backtest_v2.py \
    --mode placeholder \
    --out-dir ../market-dashboard/public
```

Writes placeholder values matching `rollup.py`'s `PLACEHOLDER_*` constants.
Idempotent. Used on launch day to give the UI something non-empty to read
before real back-test data exists.

## Synthetic mode (smoke test)

```bash
cd trading-scanner
PYTHONPATH=. python3 scripts/run_backtest_v2.py \
    --mode synthetic --seed 42 \
    --out-dir ../market-dashboard/public
```

Runs the harness on a deterministic synthetic dataset (250 days × 100
tickers). Useful for end-to-end pipeline validation without API costs.

## Real mode (BLOCKED on Phase 9.5 — UW historical backfill)

```bash
cd trading-scanner
PYTHONPATH=. python3 scripts/run_backtest_v2.py \
    --mode real \
    --train-from 2019-01-01 --train-until 2024-06-30 \
    --holdout-from 2024-07-01 --holdout-to 2026-04-30 \
    --out-dir ../market-dashboard/public
```

**Currently raises `NotImplementedError`.** The data dependencies are:

| Data needed | Status | Source |
|---|---|---|
| `prices_eod` (Polygon EOD prices) | ✅ Backfilled in Supabase | already running |
| `ticker_reference` (mkt cap, asset_type, exchange) | ✅ Backfilled in Supabase | already running |
| `universe_master` / `universe_snapshots` | ✅ Backfilled in Supabase | already running |
| Historical insider Form 4 events | ❌ Not backfilled | UW live API only |
| Historical options flow alerts | ❌ Not backfilled | UW live API only |
| Historical congress disclosures | ❌ Not backfilled | UW live API only |
| Historical analyst rating events | ❌ Not backfilled | UW live API only |

The four UW historical tables need to be backfilled into Supabase before
real-mode can run end-to-end. That's **Phase 9.5 — Data Steward PR**:
schema migrations + UW historical pulls + backfill scripts. Estimated
scope: 1-2 weeks (rate-limited UW API, ~5 years of daily snapshots).

Until 9.5 lands, the producer reads placeholder calibration. UI ships with
a chip indicating "calibration source: placeholder" so the user knows
they're seeing pre-back-test estimates.

## Pipeline architecture

```
run_backtest_v2.py
    │
    ├─→ Mode = placeholder
    │       └─→ calibration_io.write_calibration_files()  ← rollup.PLACEHOLDER_*
    │
    ├─→ Mode = synthetic
    │       └─→ tests.test_backtest_v2._make_synthetic_days()
    │           └─→ backtest.compute_ticker_outcomes()
    │           └─→ backtest.build_excess_return_curve()
    │           └─→ backtest.build_conviction_table()
    │           └─→ backtest.build_band_stats()
    │           └─→ calibration_io.write_calibration_files()
    │
    └─→ Mode = real (BLOCKED)
            └─→ Supabase data pulls (Phase 9.5)
            └─→ backtest.walk_forward(train, holdout)
            └─→ backtest.signal_ablation()
            └─→ calibration_io.write_calibration_files()
```

## Schema notes

All three JSONs include a `schema_version` field. Bumping the schema
requires updating `calibration_io.py` deserialization to handle both old
and new versions for at least one release (so the producer doesn't break
mid-deploy).

## Operational note

Once Phase 9.5 lands and real-mode works, this script should run nightly
via Cowork scheduled task, writing the JSONs back to `market-dashboard/public/`
and committing via the same PAT-based push pattern Lead Developer uses for
other automation. Real calibration freshness becomes a Data Steward
freshness chip on the methodology page.
