# Theme sweep — sectors, styles and macro themes (2026-10-09)

Joe, 2026-10-09: *"do you ever look at sector based trades?"* then *"I really
need you to think about broader macro themes. Value vs. growth, etc. Do
research!"* The daily sweep carried one sector series (banks vs the S&P). This
folder is the harness that fixes that. `trade_idea_playbook.md` step 2 item 5
makes it a required part of every run.

## Data (all public, no secrets beyond the site's publishable key)

| what | where | history |
|---|---|---|
| Sector / industry / asset funds | `prices_eod` via `pull_prices.py` (pages 1,000 rows at a time, LESSONS 4.19) | SPDR sectors 1998-12, industries 2006, SPY 1996 |
| Value, growth, size, momentum | Ken French library, daily: `F-F_Research_Data_Factors_daily_CSV.zip`, `6_Portfolios_2x3_daily_CSV.zip`, `F-F_Momentum_Factor_daily_CSV.zip` under `mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/` | 1926, about five weeks behind |
| Long macro history | FRED `fredgraph.csv?id=` DGS10 (1962), DCOILWTICO (1986), DFII10, T10Y2Y, VIXCLS, THREEFYTP10 | as listed |
| Our own series | `macrotilt.com/indicator_history.json` | 2006 |

IWD / IWF / RSP / MTUM / IWM-style funds only have rows from 2026-04 or 2020 —
too short to backtest. Test value vs growth on the French series and name the
fund as the vehicle. `lib.py` expects the files under `/tmp/w/px`, `/tmp/w/ff`,
`/tmp/w/fred` and `/tmp/d/indicator_history.json`.

## Scripts

- `scan_macro_states.py` — today's macro states (yield surge, oil high, diesel
  margin, dollar high, bear steepening, low equity vol with high rate vol …)
  against ~50 themes, next 63 and 126 sessions, independent episodes, each
  against its unconditional baseline, split into first and second half.
- `scan_own_state.py` — each theme's own six-month relative move ranked on an
  expanding window: does a stretched theme revert or keep going?
- `refiner_regime_match.py` — the LESSONS 6.23 test, applied to refiners.

## How to read a scan — it is a screen, never a result

The 2026-10-09 run made 873 tests. About 45 showed |t| > 2, which is what
chance alone produces. A row counts only if (a) it holds in both halves of the
sample, (b) it survives moving the thresholds, (c) neighbouring themes agree
(retail AND consumer discretionary, not one of them), and (d) it passes the
same-regime test. Then it still has to clear the 20%-a-year pace.

## Findings, 2026-10-09

State of the market: technology and software sit at the 99th percentile of
their own six-month relative-return history; utilities, industrials, consumer
discretionary, materials, aerospace, REITs, homebuilders, staples and
transports are all below the 8th. Value sectors against growth sectors: 6th.

| theme | test | result | verdict |
|---|---|---|---|
| Value vs growth (French HML, big value minus big growth) | every macro state on today's board, 126 sessions, back to 1962 | inside the noise in every state (e.g. after a 10-year surge +1.2% vs +1.2% baseline, 37 episodes) | **no macro state on today's board forecasts value vs growth** |
| Value sectors after lagging growth this badly | 6-month relative move at or below its 10th expanding percentile | value kept lagging: -1.6% over 126 sessions, won 22% of 18 episodes (baseline -2.5%, 32%) | **a stretched value discount is not a reversion signal at 3–6 months** |
| Technology / software after a 95th+ percentile run | same method | tech +1.7% vs +1.4% baseline; software -2.8% vs +2.1% over 126 sessions, 10 episodes, t -1.4 | no edge either way |
| Lagging sectors (utilities, industrials, discretionary, materials) at 5th-percentile lows | same method | all within 2 points of baseline | **no bounce edge** |
| Consumer discretionary vs S&P after a 10-year surge | 10-year +50bp in a quarter to a 1-year high, 1998-2026 | -3.0% over 63 sessions (18 episodes, won 28%) vs +0.4%; -3.8% over 126; both halves; retail agrees | **real but small — under the pace bar, and needs a short** |
| Energy after yields surge with oil high | XLE, 126 sessions | +12.1% vs +4.3% with oil above its 90th 3-year percentile (8 episodes); +5.6% vs +4.3% at the 80th (12 episodes) | **fragile — moves with the threshold; not publishable** |
| Refiners with the diesel margin at its 95th percentile | VLO, MPC, 63 sessions | VLO +13.0% (beat the S&P by 10.9 points, 79% of 14) | looked like a lead … |
| … same, after a run like this one | VLO +58% and MPC +63% in 63 sessions on 2026-10-08 | fewer than 6 episodes share the diesel margin and a 40% run; after any 40% run MPC lagged the S&P by 5.3 points over 63 sessions, won 20% of 10 | **fails the same-regime test — no note** |
| Regional banks after a 10-year surge / 5-year high in the 10-year | KRE vs S&P | -8.8% over 126 sessions, won 1 of 10; -7.3% over 63 after a 5-year high, 6 episodes | consistent with the withdrawn Oct 7 bank note; small sample, 2023 dominates |
| Nasdaq after a 10-year surge | QQQ, 126 sessions, 1999-2026 | +11.8% vs +6.4%, 87% of 15 | **sample is the disinflation era** — the market back to 1962 did worse than baseline after the same signal (-0.6% vs +3.7%, 37 episodes; first half -6.0%). Out of regime for an oil shock |
| Momentum factor with oil high | French momentum, 63 sessions, 1989-2026 | +4.3% vs +1.7%, 76% of 41, both halves | real; under the pace bar; no long-history vehicle |
