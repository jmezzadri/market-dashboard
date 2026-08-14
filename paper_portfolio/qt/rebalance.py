"""
paper_portfolio.qt.rebalance — build the target book. Places no orders.

    python -m paper_portfolio.qt.rebalance                 # score, write qt_target_book
    python -m paper_portfolio.qt.rebalance --dry-run       # score, print, write nothing

Scoring and execution are deliberately two separate jobs with two separate
workflows. A scoring run can fire on a schedule and touch nothing that costs
money; only paper_portfolio.qt.execute can move the account.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta

import pandas as pd
import requests

from ..strategy_config import CONFIG
from . import data as D
from .score import build_features, eligible, score, target_book

SB_URL = D.SB_URL


def _post(table: str, rows: list[dict], on_conflict: str | None = None) -> None:
    if not rows:
        return
    h = dict(D._sb_headers())
    h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    url = f"{SB_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    for i in range(0, len(rows), 500):
        r = requests.post(url, headers=h, json=rows[i:i + 500], timeout=120)
        r.raise_for_status()


def current_holdings() -> list[str]:
    """Names already in the account — the trade band needs them."""
    try:
        r = requests.get(f"{D.ALPACA_TRADE}/v2/positions",
                         headers=D._alpaca_headers(), timeout=60)
        r.raise_for_status()
        return [p["symbol"] for p in r.json()]
    except Exception:
        return []


def run(as_of: str | None = None, dry_run: bool = False, equity: float | None = None) -> pd.DataFrame:
    as_of = as_of or date.today().isoformat()
    # The free SIP feed refuses an `end` inside the last two sessions, so bars
    # are pulled to T-3 and the score is stamped with the date they end on.
    bar_end = (pd.Timestamp(as_of) - timedelta(days=3)).date().isoformat()
    bar_start = (pd.Timestamp(as_of) - timedelta(days=600)).date().isoformat()

    uni = D.universe()
    print(f"universe: {len(uni):,} operating companies", flush=True)

    # The full bar pull takes ~20 minutes. Caching it lets a failed downstream
    # step be re-run in seconds instead of re-downloading 2.3M rows.
    cache = os.environ.get("QT_BAR_CACHE")
    if cache and os.path.exists(cache):
        bars = pd.read_parquet(cache)
        print(f"bars: loaded from cache {cache}", flush=True)
    else:
        bars = D.prices(uni.query_symbol.tolist(), bar_start, bar_end)
        if cache:
            bars.to_parquet(cache, index=False)
    # A cache built from a research pull can contain names that are no longer
    # tradable. Scoring one and then trying to buy it fails at the broker, so
    # intersect with today's universe regardless of where the bars came from.
    bars = bars[bars.symbol.isin(set(uni.query_symbol))]
    bars = bars[bars.d >= pd.Timestamp(bar_start)]
    print(f"bars: {len(bars):,} rows / {bars.symbol.nunique():,} symbols", flush=True)
    px = bars.pivot_table(index="d", columns="symbol", values="c", aggfunc="last")
    vl = bars.pivot_table(index="d", columns="symbol", values="v", aggfunc="last")

    feats = eligible(build_features(px, vl))
    print(f"eligible after liquidity gates: {len(feats):,}", flush=True)

    fund = D.fundamentals(as_of)
    ins = D.insiders(as_of, CONFIG.INSIDER_WINDOW_DAYS)
    print(f"fundamentals: {len(fund):,} companies | insider conviction: {len(ins):,} tickers",
          flush=True)

    sc = score(feats, fund, ins)
    names = target_book(sc, current_holdings())
    if len(names) < CONFIG.POSITIONS:
        raise RuntimeError(f"only {len(names)} names scored — refusing to build a short book")

    if equity is None:
        acct = requests.get(f"{D.ALPACA_TRADE}/v2/account",
                            headers=D._alpaca_headers(), timeout=60).json()
        equity = float(acct["equity"])
    per = equity * CONFIG.GROSS_EXPOSURE / CONFIG.POSITIONS

    nm = uni.set_index("query_symbol").name
    book = pd.DataFrame({
        "rebalance_date": as_of,
        "symbol": names,
        "rank": range(1, len(names) + 1),
        "score": [round(float(sc.get(s, 0)), 6) for s in names],
        "weight": round(1.0 / CONFIG.POSITIONS, 6),
        "target_dollars": round(per, 2),
        "ref_price": [round(float(feats.price.get(s, 0)), 4) for s in names],
        "gp_a":    [_g(fund, s, "gp_a") for s in names],
        "iss":     [_g(fund, s, "iss") for s in names],
        "insider": [round(float(ins.get(s, 0) or 0), 6) for s in names],
        "mom12":   [round(float(feats.mom12.get(s, 0)), 6) for s in names],
        "vol":     [round(float(feats.vol.get(s, 0)), 6) for s in names],
        "company": [str(nm.get(s, "")) [:120] for s in names],
    })

    if dry_run:
        print(book[["rank", "symbol", "score", "ref_price", "target_dollars"]].to_string(index=False))
        return book

    _post("qt_target_book", book.to_dict("records"), on_conflict="rebalance_date,symbol")
    _post("qt_run_log", [{
        "run_kind": "score", "rebalance_date": as_of, "status": "ok",
        "n_universe": int(len(feats)), "n_book": int(len(book)),
        "detail": {"bar_end": bar_end, "equity": equity,
                   "insider_tickers": int(len(ins)), "fundamentals": int(len(fund))},
    }])
    print(f"wrote {len(book)} names to qt_target_book for {as_of}", flush=True)
    return book


def _g(fund: pd.DataFrame, sym: str, col: str):
    try:
        v = float(fund.loc[sym, col])
        return None if pd.isna(v) else round(v, 6)
    except Exception:
        return None


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--equity", type=float, default=None)
    a = ap.parse_args()
    try:
        run(a.as_of, a.dry_run, a.equity)
    except Exception as e:
        print(f"REBALANCE FAILED: {e}", file=sys.stderr)
        raise
