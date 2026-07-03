# Policy A — Locked Spec + Backtest Protocol
**Decision:** Joe, 2026-07-03 — "Trade the tested strategy." Chosen over an S&P
core-satellite and over wait-and-see, from the Senior Quant review
(`Paper_vs_Benchmarks_Quant_Review_2026-07-03.xlsx`, Knowledge Base).
**Owner:** Senior Quant (spec + gates) · Lead Developer (harness + implementation)
· Data Steward (inputs) · UX Designer (page copy after ship).
**Status:** SPEC LOCKED — backtest not yet run. NO engine change ships before the
gates below pass. The live book keeps trading under the CURRENT policy until then.

## Why (one paragraph)
The live engine re-targets every position to a fixed dollar amount every
morning (3% tolerance): price falls → it buys more; price rises → it trims.
The strategy that was actually backtested (Phase 2 signal study + Phase 3
portfolio run) entered at launch, HELD ~21 trading days, and never topped up
on price moves. Since the 6/23 $1M start the live overlay fed falling names
(NVRI: $325K cumulative buys for a ~$100K slot; FUN: $164K) and trimmed
risers — an untested anti-momentum overlay on a tested signal. Book −1.75%
vs S&P +1.53% in 8 sessions; live beta −0.52.

## Policy variants to test
Common to P1a/P1b: entry next open after launch (buy-score ≥ 5); exit next
open after score < 5 (signal decay — matches live exit semantics); NO
top-ups or trims on price drift, ever; NO borrowing — fund new entries from
available cash only, skip a launch when cash is short (deterministic:
higher score first, then ticker A→Z); cash earns nothing.
- **P0 — live policy (baseline):** daily re-target to score-tier dollars
  ($100K score-5 … $200K score-10), 3% drift tolerance, 2× max leverage.
  Simulated faithfully; this is the head-to-head that isolates the top-up.
- **P1a — equal-weight tested policy:** every position enters at
  min($100K, 10% of NAV at entry). Score changes within ≥5 do NOT resize.
- **P1b — score-stepped, signal-only:** enter at tier size, resize ONLY when
  the integer score tier changes (never on price), same 10%-at-entry cap
  applied to the tier size, no leverage.

## Inputs (Data Steward)
- Prices: `prices_eod` (canonical; splits as stored — verify NVRI/FUN class
  events inside the window before trusting per-name paths).
- Signals: regenerate daily launch/decay series from `backtest_engine.py`
  scoring over the full insider history window (2025-05 →) — do NOT use only
  live `trading_opps_signals` (too short). Insider + trend layers decide
  launch (per calibrated config); dark-pool/options points displayed only.
- Benchmarks: SPY, IWM, QQQ, DIA from `prices_eod`; eligible-universe
  average from the engine panel.

## Protocol
Daily event replay, next-open execution, no lookahead (signal computed on
close(t) trades at open(t+1)); mark-to-market at official closes; report
NAV paths, total return, max drawdown, monthly Sharpe, turnover, per-name
contribution, and returns vs ALL four benchmarks + universe average.
Window: full available history AND the live window (2026-06-23→) replayed
as a sanity check against the actual book.

## Acceptance gates (all must pass before implementation ships)
1. P1 (winning variant) beats P0 on total return AND on max drawdown over
   the full window — otherwise Policy A is falsified and we report back.
2. Lookahead audit per LESSONS ("too-good-to-be-true → audit FIRST"):
   entry/exit timing check, split handling check, cash accounting foots.
3. Live-window replay reproduces the real book's NAV path under P0 within
   tolerance (validates the simulator before trusting its P1 numbers).
4. Senior Quant sign-off doc with the numbers pinned; Data Steward sign-off
   on inputs; then implementation PR.

## Implementation blast radius (when gates pass)
`paper_portfolio/config.py` (tier bands / cap / leverage), `sleeves.py`
(target builder), `diff.py` (drift-tolerance logic → signal-change-only),
`translator.py`, tests (`test_sleeves`, `test_diff`, `test_submitter`),
Paper page hero copy ("position size is Score × $20K" — changes under P1a),
Methodology §03/§04 copy, `data_manifest.json` element notes, LESSONS entry.
Page copy + UI: UX Designer sign-off. Trading behavior: Senior Quant sign-off.
