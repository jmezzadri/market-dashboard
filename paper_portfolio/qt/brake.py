"""
Quality Trend crash brake — v2, MOVE-based. Replaces the VIX + high-yield
composite that shipped 2026-08-31 without a backtest on its own book.

Backtested 2026-09-10 on the rebuilt Quality Trend daily book (20 names, 5bp
costs, Feb 2017 - Sep 2026; study in paper_portfolio/qt/research/brake_study_2026-09-10):

    no brake ............ CAGR 19.8%  Sharpe 0.75  worst fall -36.7%  worst year -6.5%
    VIX+HY half (old) ... CAGR 16.3%  Sharpe 0.72  worst fall -25.6%  worst year -8.8%   <- cost 3.5 pts/yr
    THIS RULE ........... CAGR 23.7%  Sharpe 1.00  worst fall -26.7%  worst year  0.0%
    Both halves beat no-brake (2017-21 Sharpe 1.26 vs 0.84; 2022-26 0.72 vs 0.65),
    at a one-day data lag as well, and on the 40-name variant. Every MOVE-based
    cell in a ~300-variant grid beat no-brake; every VIX-based cell lost to it.

Rule, evaluated once each trading day after the close (QT-BRAKE-DAILY):

    stress  = percentile of today's MOVE Index within its trailing 5 years (1,260 sessions)
    ON      when stress > 0.95 on TWO consecutive readings (today and the stored prior)
            -> sell EVERY position at the next open; the book sits in cash
    OFF     when stress < 0.80 -> buy the latest target book back at full weights
    Between 0.80 and 0.95 nothing changes (hysteresis).

Hard limits, enforced in code, not in prose:
  - The brake only moves the book between 0% and 100% of its own target book.
    It never chooses a symbol outside qt_target_book, never shorts, never borrows.
  - It acts at most once per day, only on a state FLIP, and refuses to act at
    all if the account number does not match ops_secrets/alpaca_paper_account.
  - Any data failure = no action. A brake that cannot see must not steer.

State lives in qt_brake_state (one row per evaluation day: the stress reading,
on/off, action taken). Orders are logged to qt_orders with client ids
QTBRAKE-<date>-<symbol>, exactly like the engine's own.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request
from datetime import date

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


# ── the stress reading (pure; unit-tested) ───────────────────────────────────
def pct_rank_last(values, window):
    """Percentile of the last value within the trailing `window` values (inclusive), midrank ties."""
    tail = [v for v in values[-window:] if v is not None]
    if len(tail) < window // 3:
        raise ValueError("not enough history for a percentile")
    last = tail[-1]
    less = sum(1 for v in tail if v < last)
    eq = sum(1 for v in tail if v == last)
    return (less + 0.5 * eq) / len(tail)

def stress(move_values, window=None):
    return pct_rank_last(move_values, CONFIG.BRAKE_WINDOW if window is None else window)

def next_state(today, prev_reading, was_on, on=None, off=None):
    """Two consecutive readings above ON switch the brake on; one reading below OFF switches it off.
    `prev_reading` is the stored reading from the previous evaluation (None on the first day)."""
    on = CONFIG.BRAKE_ON if on is None else on
    off = CONFIG.BRAKE_OFF if off is None else off
    if not was_on and today > on and prev_reading is not None and prev_reading > on:
        return True
    if was_on and today < off:
        return False
    return was_on


# ── live inputs ─────────────────────────────────────────────────────────────
def fetch_move():
    """The site's own MOVE history — the same series the Macro engine reads.
    Refreshed by INDICATOR-REFRESH at 16:45 ET; if today's close is not in yet the
    brake reads yesterday's, which the study tested (one-day lag) and which still
    beats no-brake in both halves."""
    req = urllib.request.Request("https://macrotilt.com/indicator_history.json", headers=UA)
    j = json.load(urllib.request.urlopen(req, timeout=60))
    pts = [(d, v) for d, v in j["move"]["points"] if v is not None]
    return [v for _, v in pts], pts[-1][0]


# ── the daily evaluation ────────────────────────────────────────────────────
def run(dry_run=False):
    today = date.today().isoformat()

    # Identity check before anything else.
    expected = _sb_get("ops_secrets?name=eq.alpaca_paper_account&select=value")
    expected = expected[0]["value"] if expected else None
    acct = _alpaca("/v2/account")
    if not expected or acct.get("account_number") != expected:
        raise SystemExit(f"REFUSING to act: account {acct.get('account_number')} != expected {expected}")

    values, as_of = fetch_move()
    reading = stress(values)
    prev = _sb_get("qt_brake_state?select=d,composite,stress_on&order=d.desc&limit=1")
    was_on = bool(prev[0]["stress_on"]) if prev else False
    prev_reading = float(prev[0]["composite"]) if prev and prev[0].get("composite") is not None and prev[0]["d"] != today else None
    now_on = next_state(reading, prev_reading, was_on)
    action = "none"

    already = _sb_get(f"qt_brake_state?d=eq.{today}&select=d")
    positions = _alpaca("/v2/positions")

    if now_on != was_on and not already:
        if now_on:
            # Sell everything. Whole shares; the book goes to cash.
            action = "sold_all" if positions else "none"
            for p in positions:
                qty = int(float(p["qty"]))
                if qty < 1: continue
                if not dry_run:
                    _alpaca("/v2/orders", method="POST", body={
                        "symbol": p["symbol"], "qty": str(qty), "side": "sell",
                        "type": "market", "time_in_force": "day",
                        "client_order_id": f"QTBRAKE-{today}-{p['symbol']}"[:48]})
                print(f"  sell {qty} {p['symbol']}")
        else:
            # Buy the latest target book back at full weights -- these symbols and
            # ONLY these; the brake never picks a name of its own.
            action = "restored"
            book = _sb_get("qt_target_book?select=symbol,weight,rebalance_date&order=rebalance_date.desc&limit=100")
            latest = book[0]["rebalance_date"] if book else None
            weights = {r["symbol"]: float(r["weight"]) for r in book if r["rebalance_date"] == latest}
            equity = float(acct["equity"])
            held = {p["symbol"]: int(float(p["qty"])) for p in positions}
            syms = ",".join(weights)
            # delayed_sip: the free plan cannot read recent SIP; 15 minutes late is fine for sizing
            req = urllib.request.Request(
                f"https://data.alpaca.markets/v2/stocks/trades/latest?symbols={syms}&feed=delayed_sip",
                headers=_alpaca_headers())
            trades = json.load(urllib.request.urlopen(req, timeout=60)).get("trades") or {}
            n = 0
            for sym, w in weights.items():
                px = float((trades.get(sym) or {}).get("p") or 0)
                if px <= 0:
                    print(f"  {sym}: no price -- skipped"); continue
                want = math.floor(equity * w * 0.985 / px)
                buy = want - held.get(sym, 0)
                if buy < 1 or n >= 40: continue
                if not dry_run:
                    _alpaca("/v2/orders", method="POST", body={
                        "symbol": sym, "qty": str(buy), "side": "buy",
                        "type": "market", "time_in_force": "day",
                        "client_order_id": f"QTBRAKE-{today}-{sym}"[:48]})
                print(f"  buy {buy} {sym}"); n += 1
        if not dry_run and action != "none":
            _sb_post("qt_orders", [{"rebalance_date": today, "symbol": "BRAKE", "side": action,
                                    "qty": 0, "order_type": "brake", "time_in_force": "day",
                                    "client_order_id": f"QTBRAKE-{today}-MARKER", "status": "filled"}])

    if not dry_run:
        _sb_post("qt_brake_state", [{"d": today, "composite": round(reading, 4),
                                     "stress_on": now_on, "action": action}], upsert=True)
    print(f"brake {today}: MOVE stress {reading:.3f} (MOVE as of {as_of}, prior {prev_reading})  "
          f"state {'ON' if now_on else 'off'} (was {'ON' if was_on else 'off'})  action {action}  positions {len(positions)}")

if __name__ == "__main__":
    run(dry_run=os.environ.get("BRAKE_DRY_RUN", "") == "1")
