# Indicator SD Calibration Methodology (Bug #2b)

The `SD{}` map in `src/App.jsx` (mirrored in `macro_compute.py`) gives each
of the 25 indicators a `(mean, sd, direction)` triple. Every reading is
converted to a z-score:

```
sdScore = (value − mean) / sd        (if direction = "hw" or "nw")
        = −(value − mean) / sd       (if direction = "lw")
```

Z-scores then feed the 4-level color scale (Low < 0.5 < Normal < 1.0 <
Elevated < 1.75 < Extreme) and the composite stress score.

Because the z-score is only as good as its reference distribution, the
`(mean, sd)` values need periodic empirical re-grounding. Bug #2 fixed
`eq_cr_corr` (SPY/HYG 63d rolling correlation — now 0.38 / 0.22). Bug
#2b extends that to the rest of the 25.

## Pass 1 — April 2026 (this commit)

Reference window: **2016-04-01 → 2026-04-15** (10 years). That window
was chosen because:

- Captures the full post-QE "normal regime" plus COVID plus the 2022-
  2024 tightening cycle.
- Avoids the 2008 GFC, which would dominate SDs for every indicator
  and produce misleadingly wide bands in today's regime.
- Long enough (n > 40 for quarterly series, n > 500 for weekly, n >
  2500 for daily) that point estimates are not noise.

Data source: FRED CSV downloads via `scripts/calibration_audit.py`
(re-runnable — the script accepts cached CSVs in `/tmp/fred/`).

### Updated indicators

| id           | old μ  | new μ  | old σ  | new σ  | FRED series  | n    |
|--------------|-------:|-------:|-------:|-------:|--------------|-----:|
| `vix`        |  19.5  |  18.5  |   8.2  |   7.3  | VIXCLS       | 2553 |
| `real_rates` |   0.5  |   0.7  |   1.1  |   1.0  | DFII10       | 2510 |
| `sloos_ci`   |   5    |   9    |  18    |  22    | DRTSCILM     |   40 |

These three were picked because (a) the FRED series covers the full
10-year window, (b) the empirical deltas are modest and explainable by
the post-2016 regime, and (c) the updated SDs do not collapse
meaningfully (which would over-classify normal variation as "Extreme").

### Indicators reviewed but NOT updated

| id            | reason                                                                        |
|---------------|-------------------------------------------------------------------------------|
| `eq_cr_corr`  | Just re-calibrated in Bug #2 — leave as-is.                                   |
| `hy_ig`       | FRED now serves only 3 years of ICE BofA OAS data (2023+) due to licensing.   |
| `yield_curve` | Empirical μ of 37bps reflects 2022-2024 inversion regime; judgment call.      |
| `move`        | ICE BofA MOVE — no free FRED mirror.                                          |
| `anfci`       | Chicago Fed standardizes ANFCI to μ=0 by construction; don't override.        |
| `stlfsi`      | Same — STLFSI4 is standardized to μ=0.                                        |
| `sloos_cre`   | Empirical (6, 19) within rounding of current (5, 20) — not worth the churn.   |
| `cape`        | Shiller XLS only, not FRED — deferred.                                        |
| `ism`         | ISM PMI discontinued from FRED 2016 — need ISM direct feed.                   |
| `copper_gold` | Computed ratio from Yahoo price series — already calibrated to regime.        |
| `bkx_spx`     | Same — Yahoo computed, regime-specific.                                       |
| `bank_unreal` | FDIC QBP — short history (2022+), deferred.                                   |
| `credit_3y`   | Empirical σ=1.9 too tight — need broader window incl. pre-2016 cycles.        |
| `term_premium`| Empirical μ=11bps reflects post-QE compression; large enough shift to need  |
|               |  explicit regime decision before changing.                                    |
| `cmdi`        | NY Fed CMDI — separate API, deferred.                                         |
| `loan_syn`    | FRED gives only 3 years of HY effective yield — σ=0.72 too tight.             |
| `usd`         | DTWEXBGS (broad dollar, 2006-base) empirical μ=117 doesn't match the 98-110  |
|               |  range our UI displays — dashboard is using a different USD proxy. Need to   |
|               |  reconcile series first.                                                      |
| `cpff`        | CP-FF spread — underlying CP series discontinued 2022. Need alternate.        |
| `skew`        | CBOE direct, not FRED — deferred.                                             |
| `bank_credit` | Empirical μ=5.2 shifted by 2020-2021 PPP credit surge; regime-noisy.          |
| `jobless`     | 2020 spike inflates empirical σ to 517K; median/MAD or Winsorized approach    |
|               |  needed instead of raw SD.                                                    |
| `jolts_quits` | Empirical (2.28, 0.29) close to current (2.1, 0.42); minor shift, defer.      |

## Running the audit

```bash
# pre-fetch FRED CSVs
mkdir -p /tmp/fred && cd /tmp/fred
for s in VIXCLS DFII10 DRTSCILM T10Y2Y ANFCI STLFSI4 DRTSCLCC \
         THREEFYTP10 BAMLH0A0HYM2EY DTWEXBGS TOTBKCR IC4WSA \
         JTSQUR BAMLH0A0HYM2 BAMLC0A0CM; do
  curl -sS "https://fred.stlouisfed.org/graph/fredgraph.csv?id=$s&cosd=2016-04-01&coed=2026-04-15" \
    -o "$s.csv"
done

# run audit
python3 scripts/calibration_audit.py
```

## Roadmap

- **Pass 2** — source the MOVE, CAPE, SKEW, and CMDI series directly
  from their publishers so we can recalibrate those too.
- **Pass 3** — decide on regime-adjusted calibration for `hy_ig`,
  `credit_3y`, `term_premium`, `usd` (Joe to set the window / regime).
- **Pass 4** — Winsorize or switch to robust SD (MAD × 1.4826) for
  `jobless` so COVID doesn't dominate.
