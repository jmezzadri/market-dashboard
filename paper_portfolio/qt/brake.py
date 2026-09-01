"""
Quality Trend crash brake. Joe approved 2026-08-28.

Runs once each trading day after the close (QT-BRAKE-DAILY workflow). Computes a
stress composite and holds the book at either full size or half size:

    composite = mean( VIX percentile over 3y , HYG 63d-drawdown percentile over 3y )
    ON  when composite > 0.80 ; stays ON until it falls below 0.65 (hysteresis)
    ON  -> sell half of every position (market orders, whole shares)
    OFF -> buy back to the latest target book's full weights

Hard limits, enforced in code, not in prose:
  - The brake ONLY scales. It never chooses a new symbol, never shorts, never
    borrows. Buys are restricted to symbols already in the target book.
  - It acts at most once per day, only on a state FLIP, and refuses to act at
    all if the account number does not match ops_secrets/alpaca_paper_account.
  - Any data failure = no action. A brake that cannot see must not steer.

State lives in qt_brake_state (one row per evaluation day). Orders are logged to
qt_orders with client ids QTBRAKE-<date>-<symbol> exactly like the engine's own.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request
from datetime import date, datetime, timezone

from paper_portfolio.strategy_config import CONFIG

SB_URL = os.environ.get("SUPABASE_URL", "https://yqaqqzseepebrocgibcw.supabase.co")
TRADE = "https://paper-api.alpaca.markets"
UA = {"User-Agent": "Mozilla/5.0 (MacroTilt QT brake)"}


# ── data access ─────────────────────────────────────────────────────────────
def _sb_headers():
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def _sb_get(path):
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers=_sb_headers())
    return json.load(urllib.request.urlopen(req, timeout=30))

def _sb_post(path, rows, upsert=False):
    h = _sb_headers()
    if upsert: h["Prefer"] = "resolution=merge-duplicates"
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers=h,
                                 data=json.dumps(rows).encode(), method="POST")
    urllib.request.urlopen(req, timeout=30).read()

def _alpaca_headers():
    return {"APCA-API-KEY-ID": os.environ["ALPACA_PAPER_KEY_ID"],
            "APCA-API-SECRET-KEY": os.environ["ALPACA_PAPER_SECRET"]}

def _alpaca(path, body=None, method="GET"):
    req = urllib.request.Request(f"{TRADE}{path}", headers={**_alpaca_headers(), "Content-Type": "application/json"},
                                 data=None if body is None else json.dumps(body).encode(), method=method)
    return json.load(urllib.request.urlopen(req, timeout=30))


# ── the composite (pure; unit-tested) ───────────────────────────────────────
def pct_rank_last(values, window):
    """Percentile of the last value within the trailing `window` values (inclusive)."""
    tail = [v for v in values[-window:] if v is not None]
    if len(tail) < window // 3:
        raise ValueError("not enough history for a percentile")
    last = tail[-1]
    # Midrank ties. Counting plain "<=" made a perfectly FLAT series read as the
    # 100th percentile — a long calm would have tripped the brake ON (caught by
    # test_composite_calm_vs_stressed before it ever ran live). Ties count half,
    # so an all-equal window sits at a neutral 0.5.
    less = sum(1 for v in tail if v < last)
    eq = sum(1 for v in tail if v == last)
    return (less + 0.5 * eq) / len(tail)

def hyg_drawdown_series(closes, dd_window=63):
    """63-day drawdown depth (positive number = deeper) for each day."""
    out = []
    for i in range(len(closes)):
        lo = max(0, i - dd_window + 1)
        peak = max(closes[lo:i + 1])
        out.append(1.0 - closes[i] / peak)
    return out

def composite(vix_values, hyg_closes, pct_window=756):
    v = pct_rank_last(vix_values, pct_window)
    dd = hyg_drawdown_series(hyg_closes)
    d = pct_rank_last(dd, pct_window)
    return (v + d) / 2.0

def next_state(comp, was_on, on=None, off=None):
    on = CONFIG.BRAKE_ON if on is None else on
    off = CONFIG.BRAKE_OFF if off is None else off
    if not was_on and comp > on: return True
    if was_on and comp < off: return False
    return was_on


# ── live inputs ─────────────────────────────────────────────────────────────
def fetch_vix():
    req = urllib.request.Request("https://macrotilt.com/indicator_history.json", headers=UA)
    j = json.load(urllib.request.urlopen(req, timeout=60))
    return [v for _, v in j["vix"]["points"] if v is not None]

def fetch_hyg():
    url = "https://query1.finance.yahoo.com/v8/finance/chart/HYG?range=5y&interval=1d"
    req = urllib.request.Request(url, headers=UA)
    j = json.load(urllib.request.urlopen(req, timeout=60))
    return [c for c in j["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"] if c is not None]


# ── the daily evaluation ────────────────────────────────────────────────────
def run(dry_run=False):
    today = date.today().isoformat()

    # Identity check before anything else.
    expected = _sb_get("ops_secrets?name=eq.alpaca_paper_account&select=value")
    expected = expected[0]["value"] if expected else None
    acct = _alpaca("/v2/account")
    if not expected or acct.get("account_number") != expected:
        raise SystemExit(f"REFUSING to act: account {acct.get('account_number')} != expected {expected}")

    comp = composite(fetch_vix(), fetch_hyg())
    prev = _sb_get("qt_brake_state?select=stress_on&order=d.desc&limit=1")
    was_on = bool(prev[0]["stress_on"]) if prev else False
    now_on = next_state(comp, was_on)
    action = "none"

    already = _sb_get(f"qt_brake_state?d=eq.{today}&select=d")
    positions = _alpaca("/v2/positions")

    if now_on != was_on and not already and positions:
        if now_on:
            action = "halved"
            for p in positions:
                qty = int(float(p["qty"])) // 2
                if qty < 1: continue
                if not dry_run:
                    _alpaca("/v2/orders", method="POST", body={
                        "symbol": p["symbol"], "qty": str(qty), "side": "sell",
                        "type": "market", "time_in_force": "day",
                        "client_order_id": f"QTBRAKE-{today}-{p['symbol']}"[:48]})
                print(f"  sell {qty} {p['symbol']}")
        else:
            action = "restored"
            book = _sb_get("qt_target_book?select=symbol,weight,rebalance_date&order=rebalance_date.desc&limit=100")
            latest = book[0]["rebalance_date"] if book else None
            weights = {r["symbol"]: float(r["weight"]) for r in book if r["rebalance_date"] == latest}
            equity = float(acct["equity"])
            held = {p["symbol"]: p for p in positions}
            n = 0
            for sym, w in weights.items():
                if sym not in held: continue          # scale existing only — never add names
                px = float(held[sym]["current_price"])
                want = math.floor(equity * w * 0.985 / px)
                have = int(float(held[sym]["qty"]))
                buy = want - have
                if buy < 1 or n >= 30: continue
                if not dry_run:
                    _alpaca("/v2/orders", method="POST", body={
                        "symbol": sym, "qty": str(buy), "side": "buy",
                        "type": "market", "time_in_force": "day",
                        "client_order_id": f"QTBRAKE-{today}-{sym}"[:48]})
                print(f"  buy {buy} {sym}"); n += 1
        if not dry_run:
            _sb_post("qt_orders", [{"rebalance_date": today, "symbol": "BRAKE", "side": action,
                                    "qty": 0, "order_type": "brake", "time_in_force": "day",
                                    "client_order_id": f"QTBRAKE-{today}-MARKER", "status": "filled"}])

    if not dry_run:
        _sb_post("qt_brake_state", [{"d": today, "composite": round(comp, 4),
                                     "stress_on": now_on, "action": action}], upsert=True)
    print(f"brake {today}: composite {comp:.3f}  state {'ON' if now_on else 'off'}"
          f" (was {'ON' if was_on else 'off'})  action {action}  positions {len(positions)}")

if __name__ == "__main__":
    run(dry_run=os.environ.get("BRAKE_DRY_RUN", "") == "1")
