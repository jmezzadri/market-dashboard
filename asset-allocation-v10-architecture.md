# MacroTilt — Asset Allocation v10 Architecture Spec

**Status:** Draft for council review
**Author:** Lead Developer (with Senior Quant + UX Designer consultation)
**Date:** 2026-04-25

This is the data and backend architecture that has to be built BEFORE any
wireframe work or React component work. Per LESSONS rule 9 (data pipeline
before UI) and rule 10 (industrialized everywhere, no compromise path).

The spec covers everything the new Asset Allocation page will need to run
in production reliably and refresh weekly. Wireframes happen against the
contract this spec defines.

---

## 1. Architecture overview

The Asset Allocation system has six layers. Each layer has a well-defined
contract with the next, validated by schema. None of them shares state
through globals; everything passes through versioned JSON files or the
filesystem.

```
┌─────────────────────────────────────────────────────────────┐
│  L1 — Data acquisition (FRED, Yahoo, Unusual Whales)        │
│       fetch_factors.py, fetch_prices.py, fetch_holdings.py   │
└──────────────────────┬──────────────────────────────────────┘
                       │ raw CSV / JSON files
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  L2 — Validation (schema, freshness, sanity checks)          │
│       validate_inputs.py — fails loud, logs alerts           │
└──────────────────────┬──────────────────────────────────────┘
                       │ validated_factors.json
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  L3 — Compute (regressions, ratings, narrative, themes)     │
│       compute_v10_allocation.py — pure functions             │
└──────────────────────┬──────────────────────────────────────┘
                       │ allocation_<date>.json
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  L4 — State management (historical snapshots, deltas)       │
│       allocation_history/ — append-only, immutable            │
└──────────────────────┬──────────────────────────────────────┘
                       │ allocation_current.json + history
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  L5 — Output (validated, versioned, schema-enforced)        │
│       public/v10_allocation.json (UI consumes this)         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  L6 — Monitoring (success / failure / anomaly)              │
│       Slack/email alerts, run history dashboard              │
└─────────────────────────────────────────────────────────────┘
```

Each layer has its own tests. CI runs them on every PR.

---

## 2. Layer 1 — Data acquisition

### What it pulls

Three categories:

**Macro factors** — already partially in `indicator_history.json` and
`deep_factors.json`. Need to consolidate into a single source of truth.
~30 series from FRED + Yahoo. Going back to 2001-2003.

**ETF prices** — daily from yfinance for the 14 equity buckets, 4 defensive,
2 benchmarks (SPY, AGG). Historical for back-test reproducibility.

**SPY sector composition** — pulled from SSGA's official daily holdings
disclosure (CSV available at <https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx>).
Refreshed weekly. Used to compute current S&P 500 sector weights for the
benchmark comparison doughnut.

**Industry-group reference data** — static JSON: top example holdings per
industry group (e.g., Software → Microsoft, Salesforce, Oracle, Adobe).
Hand-curated, version-controlled. Refreshed quarterly.

### Pull schedule

Weekly Friday after market close (5:30pm ET). Plus a Saturday morning
verification run. If Friday fails, Monday morning retries before the new
allocation publishes.

### Failure modes and handling

- **FRED API down**: pull from Yahoo where overlap exists, log a warning,
  proceed with stale-by-1-day data. If FRED is down for >3 days, fail loud
  and alert.
- **yfinance rate-limited**: exponential backoff with 4 retries, then fall
  back to the previous trading day's snapshot.
- **SSGA SPY holdings link broken**: fall back to last week's snapshot,
  log a warning. Hand-curated weights are a viable backup if the link
  stays broken for a month.
- **Static reference data corrupted**: schema validation in L2 catches
  this; allocation falls back to last-known-good.

---

## 3. Layer 2 — Validation

### Schema enforcement

Every input file has a JSON schema (`schemas/factor_panel.schema.json`,
`schemas/price_panel.schema.json`, etc.). Validation runs on every read.
Schema failure halts the pipeline and emits a Slack alert with the
specific field that broke.

### Freshness checks

For each factor, we know its expected cadence (daily / weekly / monthly /
quarterly). Validation checks the most recent observation against the
cadence-appropriate threshold. Stale-by-more-than-tolerance fails the
pipeline.

### Sanity checks

Numerical sanity: VIX between 5 and 100. Yield curve between -300 and
+500 bps. Composite values between -100 and +100. Out-of-range values fail
the run.

Time-series sanity: month-over-month change in any factor capped at ±5
standard deviations of historical change. Larger moves trigger anomaly
review (run continues but alerts the operator).

Cross-factor sanity: composite values must be derivable from underlying
indicators within a tolerance. This catches data corruption in either
the composite history or the indicator history.

### Output

A `validated_inputs/<date>/` directory containing the green-lit data plus
a `validation_report.json` documenting what passed, what was warned,
what was repaired (e.g., "yfinance NDX missing 2026-04-23, filled forward
from 2026-04-22").

---

## 4. Layer 3 — Compute

### Inputs

The validated data from L2.

### Per-asset regression (existing logic, extended)

For each of the 14 equity buckets and 4 defensive assets:
1. Fit multivariate regression on the bucket's per-asset factor list
   (locked v9 maps in `multivariate_factor_map.json`)
2. Forecast next-month return (μ)
3. Standardize μ, momentum, and momentum acceleration into z-scores
4. Generate raw rating score (combines μ + momentum)

### Rating assignment for ALL 14 buckets (NEW vs v9)

The v9 logic only selects 5 picks. v10 outputs a rating for every bucket:

- **Most Favored (Overweight):** combined score in top quintile of universe
- **Favored:** combined score above median
- **Neutral:** combined score around median (±0.5 z-score)
- **Less Favored:** combined score below median
- **Least Favored (Underweight):** combined score in bottom quintile

The 5 buckets the model actually holds are drawn from Most Favored + Favored.

### Narrative templating engine (NEW)

For each rating section and each bucket, generate prose from the underlying
factor data using rule-based templates. Pure functions, no LLM, fully
deterministic and testable.

**Template structure:**

```
Per-bucket rationale:
  "{Bucket} is {rating}. {top_factor_1} {direction} ({reading}, {compared_to}),
   suggesting {interpretation_1}. {top_factor_2} {direction} ({reading}),
   reinforcing the {bucket_theme} thesis."

Example output:
  "Energy is Overweight. Initial jobless claims have edged lower 
   (213k, vs 220k 4-week average), suggesting labor market resilience 
   that historically supports energy demand. Commercial paper risk 
   is compressing (4bps tighter month-over-month), reinforcing the 
   risk-on cyclical thesis."
```

**Templates needed:**
- 14 per-bucket rationale templates (one per bucket, referencing that bucket's selected factors)
- 5 rating-level templates (Most Favored / Favored / Neutral / Less Favored / Least Favored)
- 6 macro-headline templates (one per regime: deep stress, stress, recovery, calm, late-cycle, mid-cycle)
- 4 leverage/equity-share templates

**Edge case handling:** when a factor is at a sample-window extreme,
the template inserts qualifier ("at the highest level since 2020"). When
factors disagree, the template names the disagreement explicitly ("yield
curve and credit spreads point in opposite directions"). When data is
stale, the template flags it.

**Test fixtures:** golden-output tests for 12+ historical regimes (GFC,
COVID, 2022 inflation, 2024 AI rally, etc.). Each fixture is a known-good
output for a known input. CI fails if templates produce different output
for the same inputs.

### Theme detection (NEW)

Cross-bucket theme detection runs after individual ratings are computed.
Rules:

- If 2+ tech-adjacent buckets (Software, Semis, MegaCapGrowth, CommSvcs)
  are Most Favored → emit "AI infrastructure" theme.
- If Energy + Materials + Industrials are Most Favored → emit "Cyclical
  recovery" theme.
- If Utilities + Staples + Real Estate are Most Favored → emit "Defensive
  positioning" theme.
- If Banks + Insurance + Financials are Most Favored AND yield curve is
  steepening → emit "Steepener trade" theme.
- (10-15 such rules total, codified, tested)

Output: 0-4 active themes per run, each with a short narrative explanation.

### Risk scenario generation (NEW)

For each Most Favored bucket, generate the "kill factor" and a conditional
narrative:

```
Per-pick risk:
  "If {factor} {threshold_direction} {threshold}, {bucket} is most exposed
   ({reason})."

Example output:
  "If WTI crude breaks below $65, Energy and Industrials become
   vulnerable simultaneously (oil-services capex pullback)."
```

3-5 risk scenarios per allocation, each tied to a specific factor crossing
a specific threshold.

### MoM and QoQ comparisons (NEW)

After all ratings are assigned, compare to the previous month's allocation
(stored in L4) and the previous quarter's allocation:

- Each bucket: rating change (e.g., "Energy: Neutral → Most Favored")
- Each bucket: weight change in percentage points
- Aggregate: stance change (Defensive → Balanced → Aggressive)
- Aggregate: leverage change

Output is a structured "what changed" object that the UI can render as a
callout.

### SPY benchmark sector weights (NEW)

Pulled from SSGA holdings disclosure in L1. Validated in L2. Aggregated
to GICS sector level for direct comparison with the strategy's bucket
weights. Stored as `spy_sector_weights_<date>.json`.

### Stance classification (NEW)

Three-way classification based on alpha + leverage + composite stress:
- **Aggressive:** alpha > 1.05 (leverage on)
- **Balanced:** 0.95 ≤ alpha ≤ 1.05 (full equity, no leverage, no defensive)
- **Defensive:** alpha < 0.95 (defensive bucket activated)

---

## 5. Layer 4 — State management

### Historical storage

Every weekly run produces an `allocation_<YYYY-MM-DD>.json` file written
to `allocation_history/`. This directory is append-only, never modified.
Old entries are immutable.

Why: enables MoM/QoQ comparisons, time-travel queries ("what was the
allocation in March 2024?"), audit trail for any future "what if you
had followed the model" calculations, and rollback if a bad run ships
to prod.

Storage size: 200 weekly snapshots × ~50KB = ~10MB total over 4 years.
Trivial.

### Current pointer

`public/v10_allocation.json` is symlinked or hard-copied from the most
recent `allocation_history/allocation_<date>.json`. The UI consumes this
single endpoint.

### Versioning

Every output JSON includes `schema_version: "v10.0"`. Schema bumps require
a new code branch and migration plan. Old UI clients fail loud rather
than silently parse a new schema as old.

### Rollback path

If a weekly run produces obviously-bad output (e.g., a regime classifier
flips wildly because a single indicator was bad), the operator can:
1. Roll the symlink back to the previous week's `allocation_history`
   entry
2. Mark the bad run as `quarantined` in the `validation_report.json`
3. Investigate, fix the issue, re-run

This is a simple file operation, not a database transaction. No state
gets corrupted.

---

## 6. Layer 5 — Output schema

The contract between backend and UI. Validated on every write.

```json
{
  "schema_version": "v10.0",
  "as_of": "2026-04-26",
  "calculated_at": "2026-04-26T18:30:00Z",
  "rebalance_frequency": "weekly",
  "previous_rebalance": "2026-04-19",
  "next_rebalance": "2026-05-03",

  "stance": {
    "label": "Aggressive",
    "description": "...",
    "color": "calm",
    "vs_last_month": "unchanged"
  },

  "headline": {
    "narrative": "April 2026 — Aggressive equity tilt...",
    "alpha": 1.276,
    "equity_share": 1.0,
    "leverage": 1.276,
    "active_themes": ["AI infrastructure", "Energy discipline"]
  },

  "regime": {
    "risk_liquidity": { "value": -6.7, "label": "calm", "trend_3mo": "improving", ... },
    "growth": { ... },
    "inflation_rates": { ... },
    "yield_curve_bps": { "value": 50, "trend_3mo": "steepening" },
    "credit_spreads_bps": { ... },
    "regime_flip_active": false
  },

  "macro_narrative": [
    "{paragraph 1 — composites}",
    "{paragraph 2 — leading indicators}",
    "{paragraph 3 — implications for sector positioning}"
  ],

  "themes": [
    { "name": "AI infrastructure", "narrative": "...", "buckets": ["SOXX", "IGV", "MGK"] },
    { "name": "Energy discipline", "narrative": "...", "buckets": ["XOP", "XLE"] }
  ],

  "ratings": {
    "most_favored": [
      {
        "bucket": "Semiconductors",
        "industry_group": "Information Technology — Semiconductors",
        "rationale": "Initial jobless claims compressing...",
        "key_factors": [
          { "factor": "jobless", "value": 213000, "direction": "down", "interpretation": "labor strength" }
        ],
        "examples": ["Nvidia", "Broadcom", "AMD", "Taiwan Semi"],
        "rating": "Most Favored",
        "rating_change_mom": "unchanged",
        "rating_change_qoq": "Neutral → Most Favored",
        "current_weight_pct": 25.5,
        "benchmark_weight_pct": 8.2,
        "vs_benchmark_pp": "+17.3"
      },
      ...
    ],
    "favored": [...],
    "neutral": [...],
    "less_favored": [...],
    "least_favored": [
      {
        "bucket": "Real Estate",
        "rationale": "Mortgage rates above 30-year median...",
        "rating": "Least Favored",
        "rating_change_mom": "unchanged",
        "current_weight_pct": 0,
        "benchmark_weight_pct": 2.4,
        "vs_benchmark_pp": "-2.4"
      }
    ]
  },

  "target_allocation": {
    "strategy_weights": {
      "Semiconductors": 0.255,
      "CommSvcs": 0.255,
      ...
    },
    "spy_sector_weights": {
      "InformationTechnology": 0.30,
      "Financials": 0.13,
      ...
    },
    "active_overweights_pp": [...],
    "active_underweights_pp": [...]
  },

  "defensive": {
    "active": false,
    "weights": [
      { "asset": "BIL", "fund": "1-3 month T-bills (cash)", "weight": 0, "rationale_when_active": "..." },
      ...
    ]
  },

  "what_changed": {
    "vs_last_month": [
      { "type": "promotion", "bucket": "Energy", "from": "Neutral", "to": "Most Favored" },
      ...
    ],
    "vs_last_quarter": [...],
    "stance_change": "Balanced → Aggressive (3 weeks ago)",
    "leverage_change": "1.0x → 1.28x (this rebalance)"
  },

  "risk_scenarios": [
    {
      "trigger": "WTI crude < $65",
      "impacted_buckets": ["XLE", "XOP", "XLI"],
      "narrative": "..."
    },
    ...
  ],

  "implementation": {
    "guidance_paragraphs": [...],
    "rebalance_note": "Strategy rebalances weekly...",
    "tax_note": "..."
  },

  "methodology": {
    "version": "v10",
    "locked_at": "2026-04-25",
    "back_test": {
      "window": "2008-2026",
      "cagr": 0.1388,
      "sharpe": 0.610,
      "max_drawdown": -0.2364,
      "vs_spy_cagr": 0.0282
    },
    "documentation_url": "/asset-allocation-methodology-v10-LOCKED.md",
    "raw_data_url": "/v10_allocation.json"
  },

  "data_quality": {
    "factors_pulled": 30,
    "factors_stale_warnings": [],
    "factors_failed_validation": [],
    "warnings": []
  }
}
```

UI never reads anything not in this schema. Backend never writes anything
not in this schema. CI enforces this.

---

## 7. Layer 6 — Monitoring

### Run health

Every weekly run emits a structured log line: `run_id`, `start_time`,
`end_time`, `factors_pulled`, `validation_warnings_count`,
`buckets_rated`, `narrative_paragraphs_generated`, `output_bytes`.

Stored in `run_log.jsonl`. UI has a small admin page showing the last
30 runs.

### Alerts

Slack/email when:
- A run fails (any layer error)
- Validation warning count > 5 in a single run
- A factor is stale > 2× cadence
- Allocation changes by > 30% week-over-week (anomaly indicator)
- Output schema validation fails before write

### Anomaly detection

After each run, compare the new allocation to the previous week's:
- Buckets promoted by 3+ rating levels (Most Favored ← Least Favored skip)
  → flag for review
- Stance change from Aggressive ← Defensive within a single rebalance
  without R&L composite move > 20 points → flag
- Leverage change > 0.3x in a single rebalance → flag

Flags don't halt the run. They surface in the admin page and via email
alert. Operator reviews and either approves or rolls back.

---

## 8. Cadence — weekly with mid-week regime watch

Two related but distinct timers:

**Weekly rebalance** — every Friday after market close. Computes the
allocation, writes to history, updates the public JSON. The strategy's
formal recommendations only change at this cadence.

**Mid-week regime watch** — daily check Monday-Thursday. Recomputes the
composites and flags whether a regime flip has happened since Friday's
rebalance. The page surfaces a banner: "Risk & Liquidity composite has
moved 12 points since last rebalance. Allocation may need review at next
rebalance." This is a passive alert, not an allocation change.

Why this hybrid: Joe's earlier ask was "weekly is better than monthly,
but markets shift fast." This gives a weekly formal allocation (back-tested
methodology stays intact) plus daily monitoring of whether the most
recent rebalance is still appropriate.

---

## 9. Tests

### Unit tests

- Every template function: input fixtures → known-good output strings.
  Fail if output changes byte-for-byte.
- Every theme detection rule: fixture pattern of bucket ratings →
  expected theme set.
- Every risk scenario generator: regime + picks → expected scenarios.
- Every comparison function: two snapshots → expected diff structure.

Target: 200+ unit tests covering every templating rule and edge case.

### Integration tests

- Pull factors from a frozen test snapshot → run the full pipeline →
  validate output against expected JSON. Run for 12 historical regimes
  (GFC, COVID, 2022 inflation, 2024 AI, etc.).
- Schema validation on output of the historical-regime tests.
- Idempotency: run the pipeline twice with the same inputs → identical
  output (no time-of-day or run-id differences in the actual allocation).

### CI

- All tests run on every PR.
- Pull request can't merge if any test fails.
- Each push to main triggers a "live" test run on the most recent data
  (not the frozen fixtures) — surfaces new bugs from changing market data.

### Production verification

- Weekly run finishes → automated comparison to the previous week's
  output → flagged anomalies emailed to the operator.
- Operator has a one-line `python verify_allocation.py` script to spot-
  check any week's output (regenerates from inputs, diffs against stored).

---

## 10. Documentation

### Runbook (for the operator — Joe)

`docs/asset-allocation-runbook.md`:
- "Week's run failed" → diagnostic steps
- "Validation warnings spiked" → diagnostic steps
- "An indicator looks stale" → fix or escalate
- "I need to roll back to last week" → file commands
- "I need to re-run for a specific date" → command
- "How do I add a new factor to the panel"

### Schema docs

`docs/asset-allocation-schema.md`: every field in the v10 JSON output,
its type, its meaning, what fills it, what consumes it.

### Methodology docs

`asset-allocation-methodology-v10-LOCKED.md`: same structure as v9 lock.
Documents the math + ratings logic + narrative templates + theme rules +
risk scenarios.

### Data dictionary

`docs/factor-data-dictionary.md`: every macro factor we pull, its source,
its release schedule, its meaning, its typical range, its known data
issues.

---

## 11. Implementation plan

Sequenced. Each phase has a tight scope, gets reviewed by the council,
ships to a staging environment for validation, then lands.

### Phase 1 — Data layer rebuild (Week 1)

- Consolidate `indicator_history.json` + `deep_factors.json` → unified
  factor panel
- Add SPY holdings pull
- Add static reference data (industry-group examples)
- Build L1 (acquisition) and L2 (validation) with full schema enforcement
- Backfill historical data from 2001-01-01 where ETF inception allows
- Tests: schema validation, freshness checks, sanity checks
- Council review: Lead Developer + Senior Quant

### Phase 2 — Compute layer enhancements (Week 1.5)

- Extend `compute_v10_allocation.py` (replace v9 script):
  - Rate all 14 buckets, not just pick 5
  - Compute MoM/QoQ comparisons (from L4 history)
  - Generate stance classification
  - Pull SPY sector weights, compute vs-benchmark pp
- No narrative engine yet (placeholder text)
- Schema-validated JSON output
- Tests: 12 historical-regime fixtures
- Council review: Senior Quant signs off on rating logic

### Phase 3 — State management (Week 2)

- Build `allocation_history/` storage
- Symlink `public/v10_allocation.json` → most recent
- Versioning: schema_version field, migration tooling
- Rollback: file-system-based, scripted
- Tests: idempotency, history append-only, rollback works
- Council review: Lead Developer

### Phase 4 — Narrative templating engine (Week 2.5-3)

- 14 per-bucket rationale templates
- 5 rating-level templates
- 6 macro-headline templates
- 10-15 theme detection rules
- 8-10 risk scenario rules
- Golden-output tests for 12 historical regimes
- Council review: Senior Quant signs off on the rules + sample outputs

### Phase 5 — Scheduling + monitoring (Week 3)

- Move from daily INDICATOR-REFRESH workflow to dedicated
  weekly + daily-watch workflow
- Build run_log + admin run-history page
- Build Slack/email alerting
- Build anomaly detection rules
- Documentation: runbook, schema docs, data dictionary
- Council review: Lead Developer

### Phase 6 — Wireframes (Week 3.5)

- UX Designer drafts wireframes against the now-existing v10 schema
- Real data feeds the mockup
- 3 states: calm, stressed, regime-change
- Joe critiques, iterates
- Council review: UX Designer + Joe sign off

### Phase 7 — UI build to spec (Week 4)

- React component reads v10 schema
- Type safety: TypeScript types generated from JSON schema
- All chart types per Joe's request: bar, doughnut, MoM/QoQ
- Click-to-drill interactions
- Methodology + back-test in modal/footer
- Council review: UX Designer signs off

### Phase 8 — Production cutover (Week 4.5)

- Switch nav from v9 → v10
- Deploy
- Monitor first 2 weekly runs in production
- Rollback ready in case of issues

---

## 12. What's NOT in v10 (parked)

Same as v9 — scenario panel (interactive sliders), historical playback,
style-factor overlay, international equities, leverage > 1.5x.

---

## 13. Questions answered explicitly so we never offer them as choices again

**Industrialization is the default.** Tests, monitoring, schema
validation, rollback, runbook — all of it ships with v10. There is no
"v10 lite" without these.

**Weekly cadence** is the cadence. The hybrid (weekly formal rebalance
+ daily regime watch) is the cleanest answer to Joe's "monthly isn't
enough" feedback.

**Wireframes happen against the real v10 JSON output**, not against
imaginary data. Phase 6 is the only correct sequencing.

**Senior Quant signs off** on rating logic, narrative rules, theme
rules, and risk scenarios — they're calculation code per the project
council rules.

**UX Designer signs off** on the wireframes and the implemented page —
they're UI per the project council rules.

**Lead Developer** drives execution and self-UATs every phase before
moving to the next.

---

## Council sign-offs needed before Phase 1 begins

- [ ] Joe: approves the architecture spec
- [ ] Senior Quant: approves the rating + narrative + theme logic in
  principle (specific rules reviewed in Phase 4)
- [ ] UX Designer: approves the schema as sufficient input for the
  storyboard (data-completeness check before wireframes)

Once those three sign off, Phase 1 starts.
