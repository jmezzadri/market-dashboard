"""Tests for the 2026-08-06 paper-accounting deep-dive fixes
(paper_portfolio.mirror + paper_portfolio.intraday).

Four verified defects, each reproduced here with synthetic fills/positions:
  (a) total_realized_pnl was a plug (NAV − $1M − unrealized) that absorbed
      broker-NAV errors; it must be the SUM of the per-sleeve avg-cost
      realized figures.
  (b) sleeve cash mixed two lot methods (capital − broker FIFO basis +
      avg-cost realized); it must equal capital + net fill cash flow, so
      book cash ties to fill-implied cash on multi-lot partial sells.
  (c) a tracked position missing from the broker positions feed was booked
      as a phantom at-cost liquidation (PBF, 8/4); the sync must book
      NOTHING, emit a loud ::error:: line, and carry the book position.
  (d) the intraday NAV writer could "succeed" without writing (8/6 20:45Z);
      after the upsert it must read the row back and HARD-FAIL when the
      write did not land.

Run: python3 -m pytest tests/test_paper_accounting.py -q
     (or: python3 -m pytest tests/ -k paper)
"""

from __future__ import annotations

import re

import pytest

from paper_portfolio.alpaca_client import AlpacaAccountSnapshot, AlpacaPosition
from paper_portfolio.intraday import write_nav_intraday
from paper_portfolio.mirror import mirror_positions, write_nav_daily

CAP_B = 500_000.0
CAP_M = 500_000.0


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic fills ledger — sleeve B holds XYZ via TWO buy lots at different
# prices with ONE partial sell (the exact shape where average-cost and FIFO
# lot accounting diverge); sleeve M holds MMM via a single lot (methods agree).
#
#   B: buy 100 XYZ @ $10, buy 100 XYZ @ $20, sell 50 XYZ @ $30
#      avg-cost realized = 50 × (30 − 15)        = $750
#      FIFO realized     = 50 × (30 − 10)        = $1,000
#      net fill cash     = 1,500 − 1,000 − 2,000 = −$1,500
#   M: buy 10 MMM @ $100 → net fill cash = −$1,000, realized = $0
# ─────────────────────────────────────────────────────────────────────────────

FILLS = [
    {"sleeve": "B", "ticker": "XYZ", "side": "buy", "quantity": 100, "price": 10.0,
     "filled_at": "2026-07-16T13:30:00+00"},
    {"sleeve": "B", "ticker": "XYZ", "side": "buy", "quantity": 100, "price": 20.0,
     "filled_at": "2026-07-18T13:30:00+00"},
    {"sleeve": "B", "ticker": "XYZ", "side": "sell", "quantity": 50, "price": 30.0,
     "filled_at": "2026-07-21T13:30:00+00"},
    {"sleeve": "M", "ticker": "MMM", "side": "buy", "quantity": 10, "price": 100.0,
     "filled_at": "2026-07-16T13:31:00+00"},
]

B_AVG_COST_REALIZED = 750.0
B_FILL_NET_CASH = -1_500.0
M_FILL_NET_CASH = -1_000.0


class FakeDB:
    """Routes the mirror/intraday SQL by shape and answers from the synthetic
    fills/positions fixtures — a miniature paper_fills / paper_positions."""

    def __init__(self, fills=None, prior_positions=None, intraday_nav_verify=None,
                 alloc_b=CAP_B, alloc_m=CAP_M):
        self.fills = fills if fills is not None else list(FILLS)
        self.prior_positions = prior_positions or []
        self.intraday_nav_verify = intraday_nav_verify or []
        self.alloc_b = alloc_b
        self.alloc_m = alloc_m
        self.executed: list[str] = []

    def exec_(self, sql: str) -> None:
        self.executed.append(sql)

    def query(self, sql: str):
        # _sleeve_initial_capital: capital bases from paper_accounts
        # allocations (Conviction Events cutover 2026-08-11 — previously the
        # hardcoded 500K/500K constants; the two-sleeve fixtures keep those
        # values so every pre-existing assertion is unchanged).
        if "sleeve_b_allocation" in sql:
            return [{"sleeve_b_allocation": self.alloc_b,
                     "sleeve_m_allocation": self.alloc_m}]
        # _fill_cashflows_by_sleeve: net cash per sleeve from actual fills.
        if "as net_cash" in sql:
            agg: dict[str, float] = {}
            for f in self.fills:
                sgn = 1.0 if f["side"] == "sell" else -1.0
                agg[f["sleeve"]] = agg.get(f["sleeve"], 0.0) + sgn * f["quantity"] * f["price"]
            return [{"sleeve": s, "net_cash": v} for s, v in agg.items()]
        # _sleeve_share_map: net shares per (sleeve, ticker).
        if "then quantity else -quantity end) as net" in sql:
            agg = {}
            for f in self.fills:
                sgn = 1.0 if f["side"] == "buy" else -1.0
                key = (f["sleeve"], f["ticker"])
                agg[key] = agg.get(key, 0.0) + sgn * f["quantity"]
            return [{"sleeve": s, "ticker": t, "net": v} for (s, t), v in agg.items()]
        # _realized_pnl_by_sleeve: the raw fill rows, filled_at ASC.
        if "select sleeve, ticker, side, quantity, price" in sql:
            return list(self.fills)
        # _restore_missing_tracked_positions: last book row for one ticker.
        if "sum(quantity) as qty" in sql and "from public.paper_positions" in sql:
            m = re.search(r"upper\(ticker\) = '([A-Z0-9.\-]+)'", sql)
            t = m.group(1) if m else ""
            rows = [r for r in self.prior_positions if r["ticker"].upper() == t]
            if not rows:
                return [{"qty": None, "cb": None, "px": None}]
            return [{"qty": sum(r["quantity"] for r in rows),
                     "cb": sum(r["cost_basis"] for r in rows),
                     "px": max(r["current_price"] for r in rows)}]
        # write-verify readback (defect d) — configured per test.
        if "from public.paper_intraday_nav" in sql:
            return self.intraday_nav_verify
        if "from public.paper_nav_daily" in sql:
            return []           # beta / anchors / prior-close: no history
        if "from public.paper_positions" in sql:
            return []           # entry-date fallback lookup
        if "from public.trading_opps_signals" in sql:
            return []           # scan scores
        return [{"max_t": None}]


def _patch_db(monkeypatch, db: FakeDB) -> None:
    # intraday.py imports the two helpers into its own namespace, so both
    # modules must be patched to the same fake.
    monkeypatch.setattr("paper_portfolio.mirror._supabase_exec", db.exec_)
    monkeypatch.setattr("paper_portfolio.mirror._supabase_query", db.query)
    monkeypatch.setattr("paper_portfolio.intraday._supabase_exec", db.exec_)
    monkeypatch.setattr("paper_portfolio.intraday._supabase_query", db.query)


class MockAlpaca:
    def __init__(self, positions=None, account=None):
        self._positions = positions or []
        self._account = account or AlpacaAccountSnapshot(
            account_number="PA3ENEE9XT8L",
            cash=997_500, equity=1_002_350, buying_power=2_000_000,
            portfolio_value=1_002_350, long_market_value=4_850,
            short_market_value=0, initial_margin=0, maintenance_margin=0,
            status="ACTIVE",
        )

    def get_positions(self):
        return self._positions

    def get_account(self):
        return self._account

    def list_orders(self, status="all", after=None, until=None, limit=100):
        return []

    def get_close_price(self, ticker):
        return 600.0            # benchmarks just need a number

    def get_daily_closes(self, ticker, start):
        return []               # anchors tolerate missing history


def _pos(ticker, qty, price, cost_basis):
    mv = qty * price
    return AlpacaPosition(
        ticker=ticker, qty=qty, avg_entry_price=cost_basis / qty,
        market_value=mv, cost_basis=cost_basis, unrealized_pl=mv - cost_basis,
        side="long", unrealized_plpc=(mv - cost_basis) / cost_basis,
        current_price=price, lastday_price=price,
    )


def _book_positions():
    # Broker state after the FILLS fixture: XYZ 150 sh marked $25 with the
    # broker's FIFO remaining-lot basis (50@10 + 100@20 = $2,500 — NOT the
    # avg-cost $2,250), MMM 10 sh marked $110.
    return [_pos("XYZ", 150, 25.0, 2_500.0), _pos("MMM", 10, 110.0, 1_000.0)]


# ─────────────────────────────────────────────────────────────────────────────
# (a) total_realized_pnl = Σ per-sleeve realized, never the NAV plug
# ─────────────────────────────────────────────────────────────────────────────

def test_paper_total_realized_is_sleeve_sum_not_nav_plug(monkeypatch):
    db = FakeDB()
    _patch_db(monkeypatch, db)
    # Broker reports equity with a $777.77 error vs cash + market value
    # (997,500 + 4,850 = 1,002,350 true). The plug would have booked the
    # error straight into total_realized_pnl.
    account = AlpacaAccountSnapshot(
        account_number="PA3ENEE9XT8L",
        cash=997_500, equity=1_003_127.77, buying_power=2_000_000,
        portfolio_value=1_003_127.77, long_market_value=4_850,
        short_market_value=0, initial_margin=0, maintenance_margin=0,
        status="ACTIVE",
    )
    alpaca = MockAlpaca(positions=_book_positions(), account=account)
    nav = write_nav_daily(alpaca=alpaca)
    plug = nav["total_nav"] - 1_000_000.0 - nav["total_unrealized_pnl"]
    assert plug == pytest.approx(1_777.77)          # what the old code stored
    assert nav["total_realized_pnl"] == pytest.approx(B_AVG_COST_REALIZED)
    assert nav["total_realized_pnl"] != pytest.approx(plug)


# ─────────────────────────────────────────────────────────────────────────────
# (b) sleeve cash == capital + net fill cash flow (multi-lot partial sell)
# ─────────────────────────────────────────────────────────────────────────────

def test_paper_sleeve_cash_ties_to_fill_cashflows(monkeypatch):
    db = FakeDB()
    _patch_db(monkeypatch, db)
    alpaca = MockAlpaca(positions=_book_positions())
    nav = write_nav_daily(alpaca=alpaca)
    # Fill-implied cash, one method end-to-end.
    assert nav["sleeve_b_cash"] == pytest.approx(CAP_B + B_FILL_NET_CASH)   # 498,500
    assert nav["sleeve_m_cash"] == pytest.approx(CAP_M + M_FILL_NET_CASH)   # 499,000
    # The old mixed-method derivation (cap − FIFO basis + avg-cost realized)
    # drifted by exactly avg-cost − FIFO realized = −$250 on this fixture.
    old_mixed = CAP_B - 2_500.0 + B_AVG_COST_REALIZED                        # 498,250
    assert nav["sleeve_b_cash"] != pytest.approx(old_mixed)
    assert nav["sleeve_b_cash"] - old_mixed == pytest.approx(250.0)
    # Sleeve NAVs tie: nav = cash + equity, and B + M sums to the account's
    # true equity (cash 997,500 + MV 4,850) to the penny — the gap closes.
    assert nav["sleeve_b_nav"] == pytest.approx(nav["sleeve_b_cash"] + nav["sleeve_b_equity"])
    assert (nav["sleeve_b_nav"] + nav["sleeve_m_nav"]) == pytest.approx(1_002_350.0)


# ─────────────────────────────────────────────────────────────────────────────
# (c) missing-from-broker-feed position: book nothing, flag loudly, carry it
# ─────────────────────────────────────────────────────────────────────────────

_PBF_FILLS = [
    {"sleeve": "B", "ticker": "PBF", "side": "buy", "quantity": 436.7992,
     "price": 59.4, "filled_at": "2026-07-16T13:30:00+00"},
]
_PBF_COST = 436.7992 * 59.4          # $25,945.87 — the phantom credit of 8/4
_PBF_LAST_BOOK_ROW = {"ticker": "PBF", "quantity": 436.7992,
                      "cost_basis": _PBF_COST, "current_price": 61.2}


def test_paper_missing_position_is_not_phantom_closed(monkeypatch, capsys):
    db = FakeDB(fills=list(_PBF_FILLS), prior_positions=[_PBF_LAST_BOOK_ROW])
    _patch_db(monkeypatch, db)
    alpaca = MockAlpaca(positions=[])     # broker feed omits PBF entirely
    n = mirror_positions(alpaca=alpaca)
    out = capsys.readouterr().out
    assert "::error::" in out
    assert "PAPER-SYNC position PBF missing from broker feed" in out
    assert "refusing phantom close" in out
    # The snapshot keeps the book position at its last known price.
    assert n == 1
    snap_sql = db.executed[0]
    assert "insert into public.paper_positions" in snap_sql
    assert "'PBF'" in snap_sql and "436.7992" in snap_sql

    nav = write_nav_daily(alpaca=alpaca)
    # NOTHING was booked: no realized P&L, and sleeve cash still reflects the
    # original buy only — no qty×avg_cost credit (the 8/4 bug paid $25,945.87
    # into sleeve cash with zero realized).
    assert nav["total_realized_pnl"] == pytest.approx(0.0)
    assert nav["sleeve_b_cash"] == pytest.approx(CAP_B - _PBF_COST)
    # ... and the position is still valued (last known price 61.20).
    assert nav["sleeve_b_equity"] == pytest.approx(436.7992 * 61.2)
    assert nav["sleeve_b_positions"] == 1


def test_paper_position_closed_by_real_sell_fill_is_not_restored(monkeypatch, capsys):
    # A REAL sell fill zeroes the fills-ledger net, so the ticker is NOT
    # tracked and its absence from the broker feed is correct — no restore,
    # no error line. Only a sell FILL may close a position, and here it did.
    fills = list(_PBF_FILLS) + [
        {"sleeve": "B", "ticker": "PBF", "side": "sell", "quantity": 436.7992,
         "price": 62.0, "filled_at": "2026-08-01T13:30:00+00"},
    ]
    db = FakeDB(fills=fills, prior_positions=[_PBF_LAST_BOOK_ROW])
    _patch_db(monkeypatch, db)
    alpaca = MockAlpaca(positions=[])
    n = mirror_positions(alpaca=alpaca)
    out = capsys.readouterr().out
    assert "PAPER-SYNC" not in out
    assert n == 0


# ─────────────────────────────────────────────────────────────────────────────
# (d) intraday write-verify: hard-fail when the upsert did not land
# ─────────────────────────────────────────────────────────────────────────────

def _intraday_alpaca():
    return MockAlpaca(positions=_book_positions())


def test_paper_intraday_write_verify_hard_fails_on_stale_row(monkeypatch):
    # The upsert "succeeds" (no exception) but the readback still shows the
    # 17:51Z stamp — exactly the 2026-08-06 incident. The writer must raise.
    db = FakeDB(intraday_nav_verify=[
        {"updated_at": "2026-08-06 17:51:33.29+00", "fresh": False}])
    _patch_db(monkeypatch, db)
    with pytest.raises(RuntimeError, match="write-verify FAILED"):
        write_nav_intraday(alpaca=_intraday_alpaca())


def test_paper_intraday_write_verify_hard_fails_on_missing_row(monkeypatch):
    db = FakeDB(intraday_nav_verify=[])       # zero rows affected / no row
    _patch_db(monkeypatch, db)
    with pytest.raises(RuntimeError, match="write-verify FAILED"):
        write_nav_intraday(alpaca=_intraday_alpaca())


def test_paper_intraday_write_verify_passes_on_fresh_row(monkeypatch):
    db = FakeDB(intraday_nav_verify=[
        {"updated_at": "2026-08-06 20:45:10.00+00", "fresh": True}])
    _patch_db(monkeypatch, db)
    nav = write_nav_intraday(alpaca=_intraday_alpaca())
    assert nav["total_nav"] == pytest.approx(1_002_350.0)
    # The intraday sleeve cash uses the same fills-ledger derivation (b).
    upsert = [q for q in db.executed if "insert into public.paper_intraday_nav" in q]
    assert upsert, "no intraday NAV upsert executed"


# ─────────────────────────────────────────────────────────────────────────────
# (e) Conviction Events epoch (2026-08-11): the sleeve capital bases are
# CONFIGURATION from paper_accounts allocations, not hardcoded 500K/500K.
# After scripts/ce_reset_epoch.py sets B = the whole account and M = 0, the
# same cash accounting (cap + net fill cash flow) must re-anchor to those.
# ─────────────────────────────────────────────────────────────────────────────

def test_paper_sleeve_caps_follow_paper_accounts_allocations(monkeypatch):
    e0 = 1_037_000.0                      # account equity at the epoch reset
    fills = [
        {"sleeve": "B", "ticker": "XYZ", "side": "buy", "quantity": 100,
         "price": 10.0, "filled_at": "2026-08-12T13:30:00+00"},
    ]
    db = FakeDB(fills=fills, alloc_b=e0, alloc_m=0.0)
    _patch_db(monkeypatch, db)
    account = AlpacaAccountSnapshot(
        account_number="PA3ENEE9XT8L",
        cash=e0 - 1_000.0, equity=e0 + 100.0, buying_power=2_000_000,
        portfolio_value=e0 + 100.0, long_market_value=1_100.0,
        short_market_value=0, initial_margin=0, maintenance_margin=0,
        status="ACTIVE",
    )
    alpaca = MockAlpaca(positions=[_pos("XYZ", 100, 11.0, 1_000.0)],
                        account=account)
    nav = write_nav_daily(alpaca=alpaca)
    # Cash base = the NEW allocation, same accounting method (cap + net fills).
    assert nav["sleeve_b_cash"] == pytest.approx(e0 - 1_000.0)
    assert nav["sleeve_m_cash"] == pytest.approx(0.0)
    assert nav["sleeve_b_nav"] == pytest.approx(nav["sleeve_b_cash"] + 1_100.0)
    # The dead sleeve M carries nothing.
    assert nav["sleeve_m_positions"] == 0
