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
    # DataFrame.to_dict turns None into NaN, and json.dumps happily emits the
    # literal `NaN` — which PostgREST rejects, killing the whole write. Any
    # missing value crosses the wire as null.
    rows = [{k: (None if isinstance(v, float) and v != v else v) for k, v in r.items()}
            for r in rows]
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
    book = _classify(book, feats)

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
    _stamp_health(book, as_of)
    print(f"wrote {len(book)} names to qt_target_book for {as_of}", flush=True)
    return book


def _stamp_health(book: pd.DataFrame, as_of: str) -> None:
    """Page-completeness audit, stamped by the producer the moment it writes.

    On 2026-09-01 the qt-target-book health row sat GREEN while every
    classification field in the book it tracks was NULL: the watchdog graded
    "a book was written", the public page rendered "Unclassified 98.7%" with
    blank size and liquidity cards, and the OWNER was the first to notice —
    on launch day, on the live site. A book is not OK because it exists; it
    is OK when every field the page renders is present. So the writer audits
    its own output here: any hole is a red row with a plain-English reason,
    which the health watchdog emails BEFORE anyone loads the page.
    """
    from datetime import datetime, timezone
    rendered = ["company", "sector", "industry", "market_cap", "addv"]
    chk = book[rendered].copy()
    chk["company"] = chk["company"].replace("", None)   # empty string renders as blank too
    bad = int(chk.isna().any(axis=1).sum())
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "indicator_id": "qt-target-book",
        "status": "red" if bad else "green",
        "last_check_at": now,
        "data_as_of": now,
        "last_error": (f"{bad} of {len(book)} holdings in the {as_of} book are missing "
                       "sector, industry, market cap or trading volume — the public "
                       "page renders blanks for them") if bad else None,
    }
    if not bad:
        row["last_good_at"] = now
    try:
        _post("pipeline_health", [row], on_conflict="indicator_id")
    except Exception as e:   # the audit must never sink the run it audits
        print(f"health stamp failed ({e}) — book write itself succeeded", flush=True)
    if bad:
        print(f"BOOK INCOMPLETE: {row['last_error']}", flush=True)


def _classify(book: pd.DataFrame, feats: pd.DataFrame) -> pd.DataFrame:
    """Sector, industry, market cap and traded dollar volume for each name.

    The paper page's allocation and liquidity cards read these straight off
    qt_target_book. They were NULL on the 2026-09-01 relaunch because the
    Aug 14 values had been a one-off manual fill, never code — the first
    automated scoring run wrote a book the page rendered as "Unclassified
    98.7%" with every size and liquidity figure blank.

    addv is the engine's own number: the 63-day average dollar volume already
    computed as the liquidity gate's input. Classification comes from qt_gics
    (curated GICS labels, seeded 2026-09-01); market cap from
    ticker_state_current, the site's canonical per-ticker state. A name
    missing from qt_gics keeps NULLs and is PRINTED so the next monthly run
    gets curated labels — a wrong sector on a public page is worse than a
    blank one, so nothing here guesses. Lookups must never sink a scoring
    run: on any failure the book is written without them.
    """
    syms = book.symbol.tolist()
    out = book.copy()
    out["addv"] = [
        (lambda v: None if pd.isna(v) or v <= 0 else round(float(v), 0))(feats.addv.get(s))
        for s in syms
    ]
    def _n(v):
        return None if v is None or pd.isna(v) else v
    try:
        gx = D._sb_select("qt_gics", {"select": "ticker,sector,industry",
                                      "ticker": f"in.({','.join(syms)})"})
        ts = D._sb_select("ticker_state_current", {"select": "ticker,market_cap",
                                                   "ticker": f"in.({','.join(syms)})"})
    except Exception as e:
        print(f"classification lookup failed ({e}) — book written without it", flush=True)
        return out
    gm = gx.set_index("ticker") if len(gx) else pd.DataFrame(columns=["sector", "industry"])
    tm = ts.set_index("ticker") if len(ts) else pd.DataFrame(columns=["market_cap"])
    out["sector"] = [_n(gm.sector.get(s)) if s in gm.index else None for s in syms]
    out["industry"] = [_n(gm.industry.get(s)) if s in gm.index else None for s in syms]
    out["market_cap"] = [
        (lambda v: None if v is None or pd.isna(v) else round(float(v), 0))(
            tm.market_cap.get(s) if s in tm.index else None)
        for s in syms
    ]
    missing = [s for s in syms if s not in gm.index]
    if missing:
        print(f"qt_gics is missing {len(missing)} name(s) — add curated GICS labels "
              f"for: {', '.join(missing)}", flush=True)
    return out


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
