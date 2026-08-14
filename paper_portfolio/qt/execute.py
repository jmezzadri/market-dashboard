"""
paper_portfolio.qt.execute — turn a target book into Alpaca orders.

    python -m paper_portfolio.qt.execute                      # dry run, prints the plan
    python -m paper_portfolio.qt.execute --live --confirm GO  # actually submits

Two guards, both deliberate:
  * dry run is the default; --live alone is not enough, --confirm GO is also
    required, so a stray flag in a workflow file cannot trade the account.
  * every order carries a deterministic client_order_id derived from the
    rebalance date and symbol. Re-running a partially-failed batch re-submits
    only what is missing; Alpaca rejects the duplicates with a 422.

Sells are submitted before buys so proceeds are available for the buys.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date

import pandas as pd
import requests

from . import data as D

TRADE = D.ALPACA_TRADE
# Guard rails — a plan that trips either of these is a bug, not a rebalance.
MAX_ORDERS = 120
MAX_GROSS_TURNOVER = 1.10       # fraction of equity


def account() -> dict:
    r = requests.get(f"{TRADE}/v2/account", headers=D._alpaca_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def positions() -> pd.DataFrame:
    r = requests.get(f"{TRADE}/v2/positions", headers=D._alpaca_headers(), timeout=60)
    r.raise_for_status()
    p = r.json()
    if not p:
        return pd.DataFrame(columns=["symbol", "qty", "market_value"])
    df = pd.DataFrame(p)[["symbol", "qty", "market_value"]]
    for c in ("qty", "market_value"):
        df[c] = pd.to_numeric(df[c])
    return df


def load_book(rebalance_date: str | None = None, csv: str | None = None) -> pd.DataFrame:
    if csv:
        b = pd.read_csv(csv)
        b["rebalance_date"] = rebalance_date or date.today().isoformat()
        if "target_dollars" not in b.columns:
            raise ValueError("book csv needs a target_dollars column")
        return b
    params = {"select": "*", "order": "rank.asc"}
    if rebalance_date:
        params["rebalance_date"] = f"eq.{rebalance_date}"
    else:
        params["order"] = "rebalance_date.desc,rank.asc"
        params["limit"] = "40"
    r = requests.get(f"{D.SB_URL}/rest/v1/qt_target_book", headers=D._sb_headers(),
                     params=params, timeout=60)
    r.raise_for_status()
    return pd.DataFrame(r.json())


def plan(book: pd.DataFrame, tif: str = "opg") -> pd.DataFrame:
    """Diff the target book against the account and emit whole-share orders."""
    held = positions().set_index("symbol")
    want = book.set_index("symbol")
    px = D.latest_trades(sorted(set(want.index) | set(held.index)))

    rows = []
    # Sells first: anything held that is no longer in the book, in full.
    for sym, r in held.iterrows():
        if sym not in want.index and r.qty > 0:
            rows.append({"symbol": sym, "side": "sell", "qty": int(r.qty),
                         "why": "left the book"})

    for sym, r in want.iterrows():
        p = float(px.get(sym, r.get("ref_price") or 0) or 0)
        if p <= 0:
            rows.append({"symbol": sym, "side": "buy", "qty": 0, "why": "NO PRICE — skipped"})
            continue
        target_sh = int(float(r.target_dollars) // p)
        have = int(held.qty.get(sym, 0))
        delta = target_sh - have
        if delta > 0:
            rows.append({"symbol": sym, "side": "buy", "qty": delta,
                         "why": "new" if have == 0 else "top-up"})
        elif delta < 0 and abs(delta) * p > 500:   # ignore trivial trims
            rows.append({"symbol": sym, "side": "sell", "qty": -delta, "why": "trim"})

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    ref = want.get("ref_price")
    df["price"] = [
        float(px.get(s, 0) or 0)
        or (float(ref.get(s, 0) or 0) if ref is not None else 0.0)
        for s in df.symbol
    ]
    df["notional"] = (df.qty * df.price).round(2)
    df["time_in_force"] = tif
    order = {"sell": 0, "buy": 1}
    return df[df.qty > 0].sort_values(["side", "notional"],
                                      key=lambda c: c.map(order) if c.name == "side" else -c)


def submit(df: pd.DataFrame, rebalance_date: str, live: bool) -> pd.DataFrame:
    H = D._alpaca_headers() | {"Content-Type": "application/json"}
    out = []
    for _, r in df.iterrows():
        coid = f"qt-{rebalance_date}-{r.symbol}-{r.side}"[:48]
        body = {"symbol": r.symbol, "qty": str(int(r.qty)), "side": r.side,
                "type": "market", "time_in_force": r.time_in_force,
                "client_order_id": coid}
        rec = {"rebalance_date": rebalance_date, "symbol": r.symbol, "side": r.side,
               "qty": int(r.qty), "order_type": "market",
               "time_in_force": r.time_in_force, "client_order_id": coid}
        if not live:
            rec["status"] = "dry_run"
            out.append(rec)
            continue
        resp = requests.post(f"{TRADE}/v2/orders", headers=H, json=body, timeout=60)
        if resp.status_code in (200, 201):
            j = resp.json()
            rec |= {"alpaca_order_id": j["id"], "status": j["status"],
                    "submitted_at": j.get("submitted_at")}
        else:
            rec |= {"status": "rejected", "error": resp.text[:400]}
        out.append(rec)
    return pd.DataFrame(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebalance-date", default=None)
    ap.add_argument("--csv", default=None, help="book csv instead of qt_target_book")
    ap.add_argument("--tif", default="opg", choices=["opg", "day"],
                    help="opg = market-on-open next session; day = immediate market order")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--confirm", default="")
    a = ap.parse_args()

    book = load_book(a.rebalance_date, a.csv)
    if book.empty:
        print("no target book found", file=sys.stderr)
        return 1
    rd = str(book.rebalance_date.iloc[0])[:10]
    acct = account()
    p = plan(book, a.tif)
    if p.empty:
        print("account already matches the book — nothing to do")
        return 0

    gross = float(p.notional.sum())
    equity = float(acct["equity"])
    print(f"account {acct['account_number']}  equity ${equity:,.0f}  cash ${float(acct['cash']):,.0f}")
    print(f"book {rd}: {len(book)} names | {len(p)} orders | gross ${gross:,.0f} "
          f"({gross / equity:.0%} of equity)")
    print(p[["side", "symbol", "qty", "price", "notional", "why"]].to_string(index=False))

    # A missing price makes `gross` read as $0, which would sail past the
    # turnover guard below. Fail loudly instead — an unpriced order is an order
    # whose size nobody checked.
    unpriced = p[p.price <= 0]
    if len(unpriced):
        print(f"REFUSING: no price for {len(unpriced)} symbols "
              f"({', '.join(unpriced.symbol.head(10))}) — cannot size or guard the plan.",
              file=sys.stderr)
        return 2

    if len(p) > MAX_ORDERS or gross > equity * MAX_GROSS_TURNOVER:
        print(f"REFUSING: {len(p)} orders / ${gross:,.0f} gross exceeds the guard rails "
              f"({MAX_ORDERS} orders, {MAX_GROSS_TURNOVER:.0%} of equity).", file=sys.stderr)
        return 2

    live = a.live and a.confirm == "GO"
    if a.live and not live:
        print("--live requires --confirm GO. Nothing submitted.", file=sys.stderr)
        return 3

    res = submit(p, rd, live)
    try:
        h = dict(D._sb_headers()) | {"Prefer": "resolution=merge-duplicates,return=minimal"}
        # Upsert on client_order_id: a dry run writes the same deterministic id
        # the live run will use, so without this every rehearsal would block the
        # real submit's log row on a unique violation.
        requests.post(f"{D.SB_URL}/rest/v1/qt_orders?on_conflict=client_order_id",
                      headers=h, json=res.to_dict("records"), timeout=120)
        h = dict(D._sb_headers()) | {"Prefer": "return=minimal"}
        requests.post(f"{D.SB_URL}/rest/v1/qt_run_log", headers=h, json=[{
            "run_kind": "execute", "rebalance_date": rd,
            "status": "ok" if live else "dry_run",
            "n_book": int(len(book)), "n_orders": int(len(res)),
            "detail": {"gross": gross, "tif": a.tif},
        }], timeout=60)
    except Exception as e:      # logging must never block or unwind a live submit
        print(f"warn: could not log to Supabase: {e}", file=sys.stderr)

    bad = res[res.status.isin(["rejected"])] if "status" in res.columns else pd.DataFrame()
    print(f"\n{'SUBMITTED' if live else 'DRY RUN'}: {len(res)} orders, {len(bad)} rejected")
    if len(bad):
        print(bad[["symbol", "side", "qty", "error"]].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
