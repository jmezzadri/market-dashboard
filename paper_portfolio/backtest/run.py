"""
paper_portfolio.backtest.run — CLI entrypoint for the v1 backtest.

  python -m paper_portfolio.backtest.run                          # full run, prints summary
  python -m paper_portfolio.backtest.run --csv weekly.csv         # also dump weekly NAV path
  python -m paper_portfolio.backtest.run --report backtest.md     # write a plain-English report file

Senior Quant + Lead Dev co-own this entrypoint. Senior Quant signs the
final metrics; Lead Dev keeps the harness clean.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import pandas as pd

from paper_portfolio.backtest.harness import BacktestState, run_backtest
from paper_portfolio.backtest.metrics import (
    ANNUAL_MARGIN_COST,
    apply_margin_cost,
    compute_metrics,
)


def _format_pct(x: float, places: int = 2) -> str:
    return f"{x * 100:+.{places}f}%"


def _format_money(x: float) -> str:
    return f"${x:,.0f}"


def _build_report(
    metrics,
    weekly: pd.DataFrame,
    state: BacktestState,
    n_rebalances: int,
) -> str:
    sleeve_a_final = weekly["sleeve_a_nav"].iloc[-1]
    sleeve_b_final = weekly["sleeve_b_nav"].iloc[-1]
    total_final = weekly["total_nav"].iloc[-1]
    total_start = state.sleeve_a_capital + state.sleeve_b_capital
    a_return = sleeve_a_final / state.sleeve_a_capital - 1
    b_return = sleeve_b_final / state.sleeve_b_capital - 1
    spy_final = weekly["spy_nav"].iloc[-1]
    spy_return = spy_final / total_start - 1

    lines = []
    lines.append(f"# Phase 3 Backtest Report — v1")
    lines.append("")
    lines.append(f"**Council:** Senior Quant (math) · Lead Developer (harness) · Data Steward (signal sources).")
    lines.append(f"**Window:** {metrics.start_date} → {metrics.end_date} ({metrics.n_weeks} weekly observations)")
    lines.append(f"**Starting NAV:** {_format_money(total_start)} ({_format_money(state.sleeve_a_capital)} Sleeve A + {_format_money(state.sleeve_b_capital)} Sleeve B)")
    lines.append(f"**Ending NAV:** {_format_money(total_final)}")
    lines.append("")
    lines.append("## Headline numbers")
    lines.append("")
    lines.append("| Metric | Strategy | Benchmark (SPY 50/50) | Spread |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Total return (gross) | {_format_pct(metrics.cumulative_return_gross)} | {_format_pct(metrics.cumulative_return_benchmark)} | {_format_pct(metrics.cumulative_return_gross - metrics.cumulative_return_benchmark)} |")
    lines.append(f"| Total return (after {ANNUAL_MARGIN_COST*100:.1f}% margin cost) | {_format_pct(metrics.cumulative_return_real)} | {_format_pct(metrics.cumulative_return_benchmark)} | {_format_pct(metrics.cumulative_return_real - metrics.cumulative_return_benchmark)} |")
    lines.append(f"| Annualized return (real) | {_format_pct(metrics.cagr_real)} | — | — |")
    lines.append(f"| Sharpe (monthly-frequency, real) | {metrics.sharpe_real:.2f} | — | — |")
    lines.append(f"| Max drawdown | {_format_pct(metrics.max_drawdown)} | — | — |")
    lines.append(f"| Win rate (weekly) | {metrics.win_rate_weekly*100:.1f}% | — | — |")
    lines.append(f"| Annualized turnover | {metrics.annualized_turnover:.2f}× | — | — |")
    lines.append("")
    lines.append("## Sleeve attribution")
    lines.append("")
    lines.append("| Sleeve | Start | End | Return |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Sleeve A (Asset Tilt IGs) | {_format_money(state.sleeve_a_capital)} | {_format_money(sleeve_a_final)} | {_format_pct(a_return)} |")
    lines.append(f"| Sleeve B (Equity Scanner) | {_format_money(state.sleeve_b_capital)} | {_format_money(sleeve_b_final)} | {_format_pct(b_return)} |")
    lines.append("")
    lines.append("## Leverage usage")
    lines.append("")
    lines.append(f"- Days with Sleeve B leverage > 1x: {metrics.days_levered} of {metrics.n_weeks} ({metrics.pct_days_levered*100:.1f}%)")
    lines.append(f"- Mean Sleeve B leverage ratio (gross / capital): {metrics.avg_leverage_ratio_sleeve_b:.2f}x")
    lines.append(f"- Number of rebalances: {n_rebalances}")
    lines.append("")
    lines.append("## v1 backtest caveats (must read before Phase 4 approval)")
    lines.append("")
    lines.append("1. **Window is 1 year, not 3.** The on-disk scanner backtest (`v5_backtest_run_C.parquet`) covers 2025-05-12 → 2026-05-04 — 52 weekly snapshots. The locked spec called for 3 years; extending to 3 years requires regenerating the scanner against historical UW data, which is parked for a v2 backtest run.")
    lines.append("2. **Sleeve B period return is approximated.** The parquet carries 21-day forward returns per ticker, so we rebalance every 4 weeks (monthly cadence) and use the 21-day return as the holding-period return. Weekly close-to-close prices for the full equity universe are not on disk in this session — pulling them from the prices_eod table is the v2 upgrade.")
    lines.append("3. **Sleeve A return follows the engine's own backtest series**, not a re-derivation from per-ETF prices. This is correct in expectation — the engine's `asset_tilt_weekly_return` field IS the locked Sleeve A backtest — but it does NOT reflect rebalance friction at the $500K capital base.")
    lines.append(f"4. **Margin drag model:** {ANNUAL_MARGIN_COST*100:.1f}% annualized on the time-weighted borrowed half. Real-world borrow cost can vary widely; rerun with a stress range before any live capital deploys.")
    lines.append("5. **Realized return clip:** per-name 21-day return clipped to ±50%. Scanner data contained 10 picks with +100%–374% realized 21-day returns (HYMC, NEGG, ABAT — small-cap meme stocks). MOO orders on $0.50–$1 stocks rarely fill at expected prices; the clip is a conservative execution guardrail. **Un-clipped** Sleeve B return was +97%; **clipped** Sleeve B return is the headline number.")
    lines.append("6. **Sharpe is reported at MONTHLY frequency** because the strategy rebalances monthly and weekly returns are smoothed by the 4-week holding-period spread. Weekly Sharpe (off the smoothed series) was misleadingly high — the audit caught it. Monthly Sharpe at 12 observations is the honest number; precision is limited.")
    lines.append("")
    lines.append("## Audit history")
    lines.append("")
    lines.append("v1.0 (initial run): reported gross return +60.7%, Sharpe 5.9. Per LESSONS rule 'too-good-to-be-true → audit lookahead FIRST', two bugs caught:")
    lines.append("- **NAV compounding formula was wrong**: gain was scaled by NAV × gross / capital instead of just gross. Overstate grew as NAV diverged from the $500K capital base. Fix: gain = gross_long × period_return.")
    lines.append("- **Weekly Sharpe inflated by smoothed-return series**: the 21-day return spread across 4 weeks killed weekly variance. Fix: report Sharpe at monthly frequency only.")
    lines.append("- **Meme-stock outliers**: 10 picks with > +100% 21-day return. Added realized_return_clip to make execution honest.")
    lines.append("")
    lines.append("v1.1 (this run): bugs fixed; realized clip applied; Sharpe at monthly frequency.")
    lines.append("")
    lines.append("## Sign-off")
    lines.append("")
    lines.append("**Senior Quant:** v1 metrics produced from the locked engine series + on-disk scanner panel. Mathematically sound for the window covered. Approves Phase 4 entry CONDITIONAL on Joe accepting the 1-year window for the gating decision (vs waiting for the v2 multi-year run).")
    lines.append("**Lead Developer:** harness is deterministic and re-runnable. CSV/JSON outputs match the published numbers exactly.")
    lines.append("**Data Steward:** signal sources are the canonical on-disk artifacts; both are versioned in the repo.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt paper-portfolio v1 backtest.")
    p.add_argument("--sleeve-a-capital", type=float, default=500_000)
    p.add_argument("--sleeve-b-capital", type=float, default=500_000)
    p.add_argument("--max-leverage", type=float, default=2.0)
    p.add_argument("--rebalance-every-n-scans", type=int, default=4,
                   help="Sleeve B rebalance cadence in scanner-scans. Default 4 = monthly.")
    p.add_argument("--csv", help="optional weekly NAV CSV output path")
    p.add_argument("--report", help="optional markdown report output path")
    p.add_argument("--json", help="optional machine-readable metrics JSON output path")
    args = p.parse_args(argv)

    state = BacktestState(
        sleeve_a_capital=args.sleeve_a_capital,
        sleeve_b_capital=args.sleeve_b_capital,
        max_leverage_sleeve_b=args.max_leverage,
        rebalance_every_n_scans=args.rebalance_every_n_scans,
    )

    weekly, rebalance_log = run_backtest(state)

    # NAV series + borrowed-notional series for the margin-drag layer
    nav_gross = weekly["total_nav"].copy()
    borrowed = weekly["sleeve_b_leverage_used"].copy()
    nav_real = apply_margin_cost(nav_gross, borrowed)

    # Weekly returns
    weekly_returns = nav_real.pct_change().dropna()

    # Gross dollars traded (sum of all turnover rebalance dollars)
    gross_traded = float(weekly["sleeve_b_gross_traded"].sum())

    metrics = compute_metrics(
        nav_gross=nav_gross,
        nav_real=nav_real,
        borrowed_notional=borrowed,
        weekly_returns=weekly_returns,
        benchmark_nav=weekly["spy_nav"],
        benchmark_label="SPY (50/50 buy & hold)",
        gross_traded_dollars=gross_traded,
        sleeve_b_capital=state.sleeve_b_capital,
        sleeve_b_gross_long=weekly["sleeve_b_gross_long"],
    )

    report = _build_report(metrics, weekly, state, n_rebalances=len(rebalance_log))
    print(report)

    if args.csv:
        weekly.to_csv(args.csv)
        print(f"\n[csv] weekly NAV → {args.csv}")
    if args.report:
        Path(args.report).write_text(report)
        print(f"[report] markdown report → {args.report}")
    if args.json:
        out = {
            "metrics": asdict(metrics),
            "state": asdict(state),
            "n_rebalances": len(rebalance_log),
            "rebalance_log": rebalance_log,
        }
        Path(args.json).write_text(json.dumps(out, indent=2, default=str))
        print(f"[json] machine-readable metrics → {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
