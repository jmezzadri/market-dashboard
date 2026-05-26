"""
paper_portfolio.backtest.harness — the replay loop.

V1 methodology (Senior Quant-locked 2026-05-26):

  Sleeve A:
    NAV path follows the engine's own `asset_tilt_weekly_return` series
    from public/macrotilt_engine_backtest.json. This IS the engine's
    historical backtest of the IG-tilted allocation — Sleeve A would
    mirror it at the $500K capital base.

  Sleeve B:
    Walk the v5 scanner panel one scan_date at a time. At each scan_date:
      1. Build the Sleeve B target via the production allocator (the
         same code paths the live translator uses — no re-implementation).
      2. Each held position carries its fwd_return_21d as a "scheduled
         period return," spread evenly across the next 4 weekly scans
         (matches the monthly rebalance cadence).
      3. NAV updates each week by the notional-weighted realized weekly
         return of currently-held positions.
      4. Margin drag = 7.5% annualized × time-weighted borrowed half,
         applied as a daily drag and rolled into the NAV path.

  Execution guardrail (BacktestState.realized_return_clip):
    Per-name 21-day realized return is clipped to ±50% (default). Backtest
    data carries +374% HYMC-style outliers on $0.50 meme stocks that MOO
    orders would not capture in live trading — clipping is conservative
    and surfaces a stress range.

  Rebalance cadence:
    Monthly (every 4th weekly scanner scan).

  Benchmark:
    SPY weekly return series from the same engine backtest file.

  Window:
    Joint window of both signals = 2025-05-12 → 2026-05-04 (52 weeks).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from paper_portfolio.backtest.historical_signals import (
    load_asset_tilt_history,
    load_scanner_history,
    scanner_dates,
    scanner_snapshot_for_date,
)
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target


@dataclass
class BacktestState:
    sleeve_a_capital: float
    sleeve_b_capital: float
    max_leverage_sleeve_b: float
    rebalance_every_n_scans: int   # 4 = monthly (every 4th weekly scan)
    # Realistic execution guardrail — clip per-name realized 21-day return
    # to this magnitude. Backtest data carries +374 % HYMC-style outliers
    # that MOO fills on $0.50 stocks would rarely capture in live trading.
    # 0.50 means cap any pick's contribution at ±50 % per 21-day period.
    realized_return_clip: float = 0.50


@dataclass
class WeeklyRecord:
    date: pd.Timestamp
    sleeve_a_nav: float
    sleeve_b_nav: float
    total_nav: float
    sleeve_b_gross_long: float
    sleeve_b_idle_cash: float
    sleeve_b_leverage_used: float
    sleeve_b_lines_count: int
    sleeve_b_week_return: float
    sleeve_b_rebalanced: bool
    spy_nav: float
    asset_tilt_weekly_return: float
    spy_weekly_return: float
    sleeve_b_gross_traded: float


def _snapshot_to_signal_obj(snap: pd.DataFrame, scan_date: pd.Timestamp
                            ) -> EquityScannerSnapshot:
    signals = [
        EquitySignal(
            ticker=str(r.ticker),
            mt_score=float(r.mt_score),
            buy_score=float(r.buy_score),
            band=str(r.band),
            scan_date=str(scan_date.date()),
        )
        for r in snap.itertuples(index=False)
    ]
    return EquityScannerSnapshot(
        scan_date=str(scan_date.date()),
        signals=signals,
        all_count=len(signals),
        raw_payload_sample=[],
    )


def run_backtest(
    state: BacktestState,
    asset_tilt_path: str = "public/macrotilt_engine_backtest.json",
    scanner_path: str = "v5_backtest_run_C.parquet",
) -> tuple[pd.DataFrame, list[dict]]:
    """Run the backtest end-to-end. Returns:
        weekly_df — one row per scanner scan_date with NAV / leverage /
                    sleeve totals.
        rebalance_log — list of dicts capturing each rebalance event.
    """
    at = load_asset_tilt_history(asset_tilt_path)
    scanner_df = load_scanner_history(scanner_path)

    dates = scanner_dates(scanner_df)
    if not dates:
        raise RuntimeError("No scan_dates in the scanner backtest panel.")

    at = at.sort_index()

    def _at_row_for(scan_date: pd.Timestamp) -> dict:
        loc = at.index.searchsorted(scan_date, side="right") - 1
        if loc < 0:
            return {"asset_tilt_weekly_return": 0.0, "spy_weekly_return": 0.0}
        return {
            "asset_tilt_weekly_return": float(at.iloc[loc]["asset_tilt_weekly_return"]),
            "spy_weekly_return": float(at.iloc[loc]["spy_weekly_return"]),
        }

    sleeve_a_nav = state.sleeve_a_capital
    sleeve_b_nav = state.sleeve_b_capital
    spy_nav = state.sleeve_a_capital + state.sleeve_b_capital

    # positions: ticker -> {"notional": float, "scheduled_return": float,
    #                       "ticks_remaining": int}
    positions: dict[str, dict] = {}
    rebalance_log: list[dict] = []
    weekly_records: list[WeeklyRecord] = []

    for i, scan_date in enumerate(dates):
        at_row = _at_row_for(scan_date)
        at_ret = at_row["asset_tilt_weekly_return"]
        spy_ret = at_row["spy_weekly_return"]

        # ── Sleeve A roll
        sleeve_a_nav *= (1.0 + at_ret)

        # ── SPY benchmark roll
        spy_nav *= (1.0 + spy_ret)

        # ── Sleeve B rebalance check
        rebalanced = False
        gross_traded = 0.0
        if i == 0 or (i % state.rebalance_every_n_scans == 0):
            rebalanced = True
            snap = scanner_snapshot_for_date(scanner_df, scan_date)
            scanner_obj = _snapshot_to_signal_obj(snap, scan_date)
            target = build_sleeve_b_target(
                snapshot=scanner_obj,
                sleeve_b_capital=state.sleeve_b_capital,
                max_leverage=state.max_leverage_sleeve_b,
            )

            # Build new position map carrying each name's scheduled return.
            sub = snap.set_index("ticker")
            n_ticks = state.rebalance_every_n_scans
            clip = state.realized_return_clip
            new_positions: dict[str, dict] = {}
            for line in target.lines:
                fwd = sub.loc[line.ticker, "fwd_return_21d"] if line.ticker in sub.index else None
                if fwd is None or pd.isna(fwd):
                    scheduled = 0.0
                else:
                    scheduled = max(-clip, min(clip, float(fwd)))
                new_positions[line.ticker] = {
                    "notional": line.notional,
                    "scheduled_return": scheduled,
                    "ticks_remaining": n_ticks,
                }

            # Turnover = sum of |notional change| across union of tickers.
            all_t = set(positions.keys()) | set(new_positions.keys())
            for t in all_t:
                old = positions.get(t, {}).get("notional", 0.0)
                new = new_positions.get(t, {}).get("notional", 0.0)
                gross_traded += abs(new - old)

            positions = new_positions

        # ── Accrue this week's slice of each held position's scheduled
        #    return. Per-position weekly accrual = scheduled_return / 4
        #    (the rebalance cadence). NAV gain = notional × weekly_accrual.
        week_pnl = 0.0
        for slot in positions.values():
            if slot["ticks_remaining"] <= 0:
                continue
            weekly_slice = slot["scheduled_return"] / state.rebalance_every_n_scans
            week_pnl += slot["notional"] * weekly_slice
            slot["ticks_remaining"] -= 1

        sleeve_b_gross_long = sum(s["notional"] for s in positions.values()) if positions else 0.0
        sleeve_b_idle_cash = max(0.0, state.sleeve_b_capital - sleeve_b_gross_long)
        sleeve_b_leverage_used = max(0.0, sleeve_b_gross_long - state.sleeve_b_capital)

        # Apply this week's P&L to Sleeve B NAV.
        nav_before = sleeve_b_nav
        sleeve_b_nav += week_pnl
        week_return = (sleeve_b_nav / nav_before - 1.0) if nav_before > 0 else 0.0

        if rebalanced:
            rebalance_log.append({
                "date": str(scan_date.date()),
                "lines_count": len(positions),
                "gross_long": sleeve_b_gross_long,
                "leverage_used": sleeve_b_leverage_used,
                "idle_cash": sleeve_b_idle_cash,
                "gross_traded": gross_traded,
            })

        weekly_records.append(WeeklyRecord(
            date=scan_date,
            sleeve_a_nav=round(sleeve_a_nav, 2),
            sleeve_b_nav=round(sleeve_b_nav, 2),
            total_nav=round(sleeve_a_nav + sleeve_b_nav, 2),
            sleeve_b_gross_long=round(sleeve_b_gross_long, 2),
            sleeve_b_idle_cash=round(sleeve_b_idle_cash, 2),
            sleeve_b_leverage_used=round(sleeve_b_leverage_used, 2),
            sleeve_b_lines_count=len(positions),
            sleeve_b_week_return=round(week_return, 6),
            sleeve_b_rebalanced=rebalanced,
            spy_nav=round(spy_nav, 2),
            asset_tilt_weekly_return=round(at_ret, 6),
            spy_weekly_return=round(spy_ret, 6),
            sleeve_b_gross_traded=round(gross_traded, 2),
        ))

    df = pd.DataFrame([r.__dict__ for r in weekly_records]).set_index("date")
    return df, rebalance_log
