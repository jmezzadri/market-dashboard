# MacroTilt Asset Allocation v10 — Operator Runbook

Operator: Joe Mezzadri.
On-call: Lead Developer (the council of agents).

This runbook covers the common failure modes of the v10 pipeline and the
diagnostic + recovery steps for each. Every alert includes a pointer to a
section here.

## Where things live

| Resource | Location |
|---|---|
| Pipeline orchestrator | `asset_allocation/pipeline.py` |
| Run history | `asset_allocation/run_log.jsonl` |
| Allocation history | `public/allocation_history/allocation_<YYYY-MM-DD>.json` |
| Live UI output | `public/v10_allocation.json` |
| Regime watch alert | `public/v10_regime_alert.json` |
| Architecture spec | `asset-allocation-v10-architecture.md` |
| Methodology lock | `asset-allocation-methodology-v9-LOCKED.md` |

## Cadence

- **Weekly run** — Friday 5:30pm ET, full pipeline. Writes the new
  allocation + history snapshot. Triggers anomaly detection. Sends an
  email alert if the run fails or anomalies fire.
- **Daily watch** — Mon-Thu 7:00am ET, lightweight regime check. Refreshes
  composite values, compares to last weekly rebalance, writes
  `v10_regime_alert.json`. Sends an email if the regime has shifted > 15
  points since rebalance.

Both run via the GitHub Actions workflow at
`.github/workflows/V10-ALLOCATION.yml`.

## Common failures

### "Pipeline failed at acquisition layer"

**What it means.** One or more data sources (FRED, Yahoo, SSGA) failed to
respond.

**Diagnosis.**
1. Check `runs/<latest>/acquisition_run.json` for the specific failures.
2. If FRED is down, log into <https://fred.stlouisfed.org> manually to
   confirm.
3. If yfinance is rate-limited, wait 1 hour and retry.

**Recovery.**
1. Re-run with the same run-dir: `python -m asset_allocation.pipeline
   --mode weekly --run-dir runs/<date>`. Idempotent — picks up where it
   left off.
2. If re-run fails again with the same source, fall back: edit
   `acquisition.py` to use the last-known-good cached file, log the
   degradation, alert.
3. Last-known-good in production stays live — no UI change happens until
   the run succeeds.

### "Pipeline failed at validation layer"

**What it means.** Data passed acquisition but failed schema, freshness,
or sanity checks.

**Diagnosis.** Read `runs/<latest>/validation_report.json`. It lists
every failed check with the offending field/value.

**Recovery.** Validation failures are usually:
- A schema-version drift in an upstream source. Patch the schema in
  `asset_allocation/schemas/<file>.schema.json`.
- A FRED-released revision that breaks a sanity check. Update the
  `min_value` / `max_value` in `acquisition.py` for that factor.
- A genuinely broken data source. File a bug, fall back to last-known-good.

### "Pipeline failed at compute layer"

**What it means.** The regression / rating / max-Sharpe code raised an
exception.

**Diagnosis.** Read `runs/<latest>/pipeline_run.json` for the traceback.

**Recovery.** Almost always means a data input was malformed despite
passing validation. Add a tighter validation rule, then re-run. If the
math itself is broken, it's a code bug — write a failing unit test, fix
the code, ship a hotfix.

### "Pipeline failed at output layer schema validation"

**What it means.** The compute-layer allocation produced an output that
doesn't conform to `allocation_output.schema.json`.

**Diagnosis.** Read the schema errors logged in
`runs/<latest>/pipeline_run.json`. They name the specific field that
broke.

**Recovery.** Either fix the schema (if the new output shape is
intentional) or fix the compute layer (if the schema is the source of
truth). NEVER bypass validation to publish bad output to UI consumers.

### "Anomaly detected — operator review needed"

**What it means.** The new allocation was produced cleanly, but
post-pipeline anomaly detection flagged something for review.

Anomaly types:
- **rating_skip** — bucket jumped 3+ rating tiers in one rebalance
- **stance_flip** — Aggressive ↔ Defensive without big R&L move
- **leverage_discontinuity** — leverage moved > 0.3x in one rebalance
- **mass_reshuffling** — > 4 buckets changed rating
- **extreme_alpha** — alpha > 1.4 or < 0.6
- **unexpected_regime_flip** — flip activated without R&L move

**Diagnosis.** Read `runs/<latest>/anomaly_report.json`. It explains the
specific anomaly. Compare against the previous week's allocation:
`diff public/allocation_history/allocation_<prev>.json
public/allocation_history/allocation_<this>.json`.

**Decision.**
- If the anomaly is justified by a real macro shift (verify in Macro
  Overview tab), let the new allocation stand. The email alert is
  informational.
- If the anomaly looks like a bug, follow the rollback procedure below.

### "SPY holdings pull failed — fallback active"

**What it means.** SSGA's daily holdings disclosure URL didn't respond.
The benchmark comparison falls back to last week's snapshot.

**Recovery.** No immediate action needed for one-off failures. If SSGA is
down for > 1 week, the fallback gets stale — manually update
`asset_allocation/spy_holdings_fallback.json` from a different source
(e.g., iShares SPDR's bulletin) until SSGA is back.

### "Composite history is stale"

**What it means.** `public/composite_history_daily.json` hasn't refreshed
in > 3 days. The dial dots on Today's Macro will go red. The Asset
Allocation page's regime classification is using stale composite values.

**Recovery.** This is bug #1036's category — see `compute_composite_history.py`
and the INDICATOR-REFRESH workflow. Confirm the workflow ran. If not,
manually trigger via Actions tab.

## Rollback procedure

If a published v10_allocation.json is bad:

1. Identify the last good snapshot in `public/allocation_history/`.
2. `cp public/allocation_history/allocation_<good>.json public/v10_allocation.json`.
3. Commit + push.
4. Vercel redeploys. Bad output is replaced with the good snapshot in
   under a minute.
5. Mark the bad run in `run_log.jsonl` with
   `{"run_id": "...", "quarantined": true, "reason": "..."}`.
6. Investigate, fix, re-run for the affected date.

## Re-running a specific date

```bash
python -m asset_allocation.pipeline --mode weekly \
    --run-dir runs/2026-04-26 --log-level DEBUG
```

The pipeline is idempotent on date — running twice with the same
allocation_history target overwrites that date's history entry but
preserves all others.

## Adding a new factor

1. Add the factor to `acquisition.py` FRED_FACTORS or YAHOO_FACTORS dict
   with min/max/expected_lag_days.
2. Run the multivariate analysis (`v8_multivariate.py` or successor) to
   determine which buckets the new factor is significant for.
3. Update `compute.py` PER_BUCKET_FACTORS for affected buckets.
4. Update the v10 methodology lock memo with the change rationale.
5. If the factor needs a kill_factor scenario, add it to
   `narrative/risks.py` KILL_CONDITIONS.
6. Add tests covering the new factor's data shape + range.
7. Re-run the back-test to confirm performance doesn't degrade.

## Adding a new bucket

This is a major change — methodology v11. Goes through full council
review (Senior Quant + UX Designer + Lead Developer). Requires:
1. Multivariate analysis identifying the new bucket's factor map
2. ETF identified for back-test calibration
3. Full back-test re-run with the new universe
4. Industry group reference data updated
5. Theme rules updated if cross-bucket patterns change
6. Schema migration if the output structure changes
