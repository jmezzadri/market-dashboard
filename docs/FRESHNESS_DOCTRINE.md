# Freshness Doctrine — THE Spec (v2, two-clock binary)
**Approved by Joe 2026-06-17. SUPERSEDES the v1 one-clock spec** (which graded off last pull only and created a fake-green hole: a feed whose vendor went dark stayed green as long as the cron ran). This is the binding contract for every data chip on MacroTilt and the acceptance test for the build.

## 1. Two states only — green or red
- **Green** = healthy.
- **Red** = stale, broken, or untracked.
- **No amber.** "Running late" is just red-in-waiting; amber things all eventually turn red, and we want to be on top of staleness the moment it starts.
- **Untracked is red**, never green ("not registered"). Fake-green is forbidden (Hard Rule 0.1). The goal is zero untracked.

## 2. Two clocks — green requires BOTH to pass
| Clock | Question | Source | Catches |
|---|---|---|---|
| **Pull clock** | Did the producing job run successfully on schedule? | `pipeline_health.last_good_at` vs SLA | Fetch job broke / stopped / errored |
| **Data clock** | Did a new data point actually arrive on schedule? | `pipeline_health.data_as_of` vs the cadence window | Vendor went dark / upstream silently empty |

If either clock fails → **red**. The chip shows the reason ("fetch job failed" vs "vendor returned no new data"). Invariant: `data_as_of` ≤ `last_good_at` always; a violation is a producer bug → red.

## 3. Data-clock windows by frequency
Red the moment data is past due. **Trading-day aware** — weekends and US market holidays pause the clock (a Friday print is not "stale" Monday morning). Windows are anchored to a *missed scheduled release*, never a multiple of the SLA.

| Frequency | What's on it | RED when newest point is later than |
|---|---|---|
| **Daily** | prices, daily indicators, options, dark pool, technicals, engine, paper | **25 hours** past the expected daily update (weekends/holidays pause) |
| **Weekly** | jobless, CFTC COT, weekly Fed series | **1 trading day** past its scheduled release |
| **Bi-weekly** | short interest (FINRA, ~2×/mo, 15-day lag) — the only one | **1 trading day** past its scheduled FINRA publication |
| **Monthly** | CFNAI, ISM, M2, CAPE, ERP, payrolls | **5 trading days** past its scheduled release |
| **Quarterly** | SLOOS, Buffett, fundamentals | **10 trading days** past its scheduled release |
| **Event-driven** | earnings / corporate events | see §5 (coverage reconciliation, not an age timer) |
| **Static** | methodology, lexicon | exempt — labeled "reference," no freshness grade |

**No intraday tier.** The slowest-acceptable user-facing update is daily. The two feeds that refresh 3×/weekday (universe snapshots, ticker events) grade on the daily clock (current to last session). Internal jobs (price backfill every 4h, ops heartbeat every 30m) grade as infra, not as data chips.

## 4. Per-element overrides + computed feeds
- **Known long lags carry a per-element data window** in the manifest (CFTC COT ~3-day release lag, short interest 15-day FINRA lag, JOLTS ~6-week, some Fed series) so they never false-red — but red still fires one release late, measured from their *real* schedule.
- **In-house computed feeds** (technicals, correlations, the engine, the cycle board) have no vendor; the data clock checks that *our own* compute produced a new point on its cadence.

## 5. Event-driven (earnings) — daily coverage reconciliation
Not an age timer. A daily job checks the forward earnings calendar (next-earnings-date per ticker, from Unusual Whales):
1. **Forward coverage:** every active name that reports quarterly should have a next date within ~90 days. If not → red, reason *"no forward earnings date returned by vendor for XYZ."*
2. **Post-event ingestion:** once an earnings date passes, the result must be ingested within **1 trading day**. If not → red, reason *"reported {date}, result not ingested."*
Per-ticker status + reason are written to health so the panel shows the *why*.

## 6. Applies to every data class
Macro indicators · CFTC COT positioning (28 signals, one umbrella feed) · stock prices (EOD) · options chains/IV/greeks · options flow · dark pool · technicals (RSI/SMA/BB/RVOL) · short interest · earnings/fundamentals · news & commentary · engine/allocation/cycle board · paper portfolio. Reference docs are static/exempt.

## 7. Implementation contract
- One shared grader (`src/lib/freshnessClock.js`), **mirrored server-side** (watchdog + alerts) so chips, watchdog, and alerts grade identically.
- Manifest fields: `freshness_sla_hours` (pull clock) **+ a per-element data-clock window** (default from cadence per §3, override per §4).
- Every producer stamps BOTH `last_good_at` (real run time) and `data_as_of` (the source's own data date) on every run.
- Red is not passive: two consecutive misses auto-file a P1 issue and page the pipeline; a page-level banner if anything sits red.

## 8. Acceptance — verify live (both themes) before "done"
- Buffett (quarterly, data Dec-2025) → **red** (Q1 release missed).
- CFNAI / ISM / M2 (monthly, data Apr-2026) → **green** (this month's print landed on time).
- CFTC COT (weekly, data Jun-09) → **green** (current; next release Jun-19).
- A simulated dead vendor (cron still "succeeds," data frozen) → **red**.
- A Friday daily print on Monday morning → **green** (weekend pause).
- No chip green unless both clocks pass; no chip red that's genuinely current.
