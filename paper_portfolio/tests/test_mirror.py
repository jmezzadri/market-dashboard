"""
Tests for paper_portfolio.mirror — positions / fills / NAV writers.

Uses a MockAlpaca and patches the Supabase exec layer to verify the SQL
shape and the sleeve attribution.
"""

from __future__ import annotations

import pytest

from paper_portfolio.alpaca_client import AlpacaAccountSnapshot, AlpacaPosition
from paper_portfolio.mirror import (
    mirror_fills,
    mirror_positions,
    write_nav_daily,
)


class MockAlpaca:
    def __init__(self, positions=None, account=None, orders=None,
                 last_trade_price=600.0):
        self._positions = positions or []
        self._account = account or AlpacaAccountSnapshot(
            account_number="PA3ENEE9XT8L",
            cash=900_000, equity=1_010_000, buying_power=2_000_000,
            portfolio_value=1_010_000, long_market_value=110_000,
            short_market_value=0, initial_margin=0, maintenance_margin=0,
            status="ACTIVE",
        )
        self._orders = orders or []
        self._last_trade_price = last_trade_price

    def get_positions(self):
        return self._positions

    def get_account(self):
        return self._account

    def list_orders(self, status="all", after=None, until=None, limit=100):
        return self._orders

    def get_last_trade_price(self, ticker):
        return self._last_trade_price


_executed: list[str] = []


def _fake_exec(sql: str) -> None:
    _executed.append(sql)


def _fake_query(sql: str):
    # Used by write_nav for "max(filled_at)" lookups
    return [{"max_t": None}]


@pytest.fixture(autouse=True)
def patch_supabase(monkeypatch):
    _executed.clear()
    monkeypatch.setattr("paper_portfolio.mirror._supabase_exec", _fake_exec)
    monkeypatch.setattr("paper_portfolio.mirror._supabase_query", _fake_query)
    # Empty Sleeve A universe for these tests — every ticker attributes to Sleeve B
    # unless test overrides.
    monkeypatch.setattr("paper_portfolio.mirror._build_sleeve_a_etf_universe",
                        lambda asset_tilt_path="public/v10_allocation.json": {"SOXX", "IGV", "KBE", "IHI"})
    yield


def _pos(ticker, qty, mv):
    return AlpacaPosition(
        ticker=ticker, qty=qty, avg_entry_price=mv / qty,
        market_value=mv, cost_basis=mv, unrealized_pl=0, side="long",
    )


def test_mirror_positions_writes_delete_then_insert():
    positions = [_pos("SOXX", 100, 50_000), _pos("NVDA", 50, 80_000)]
    alpaca = MockAlpaca(positions=positions)
    n = mirror_positions(alpaca=alpaca)
    assert n == 2
    # Exactly one SQL execution (begin; delete; inserts; commit)
    assert len(_executed) == 1
    sql = _executed[0]
    # SOXX (in Sleeve A universe) → sleeve A; NVDA (not) → sleeve B
    assert "'A'" in sql and "SOXX" in sql
    assert "'B'" in sql and "NVDA" in sql
    assert "delete from public.paper_positions" in sql
    assert "insert into public.paper_positions" in sql


def test_mirror_positions_dry_run_writes_nothing():
    positions = [_pos("AAPL", 10, 1500)]
    alpaca = MockAlpaca(positions=positions)
    n = mirror_positions(alpaca=alpaca, dry_run=True)
    assert n == 1
    assert len(_executed) == 0


def test_mirror_fills_only_filled_orders():
    orders = [
        {"id": "ord-1", "symbol": "NVDA", "side": "buy",
         "status": "filled", "filled_qty": "50", "filled_avg_price": "100.5",
         "filled_at": "2026-05-26T13:30:00Z"},
        {"id": "ord-2", "symbol": "AAPL", "side": "buy",
         "status": "canceled", "filled_qty": "0", "filled_avg_price": None,
         "filled_at": None},
        {"id": "ord-3", "symbol": "SOXX", "side": "buy",
         "status": "partially_filled", "filled_qty": "10",
         "filled_avg_price": "200.0", "filled_at": "2026-05-26T13:35:00Z"},
    ]
    alpaca = MockAlpaca(orders=orders)
    n = mirror_fills(alpaca=alpaca)
    assert n == 2          # NVDA + SOXX, AAPL canceled is excluded
    sql = _executed[-1]    # last exec carries the insert batch
    assert "NVDA" in sql
    assert "SOXX" in sql
    assert "AAPL" not in sql
    assert "on conflict (alpaca_fill_id) do nothing" in sql


def test_write_nav_daily_with_long_only_positions():
    # 50K Sleeve A (SOXX), 80K Sleeve B (NVDA)
    positions = [_pos("SOXX", 100, 50_000), _pos("NVDA", 50, 80_000)]
    account = AlpacaAccountSnapshot(
        account_number="PA3ENEE9XT8L", cash=870_000, equity=1_000_000,
        buying_power=2_000_000, portfolio_value=1_000_000,
        long_market_value=130_000, short_market_value=0,
        initial_margin=0, maintenance_margin=0, status="ACTIVE",
    )
    alpaca = MockAlpaca(positions=positions, account=account)
    nav = write_nav_daily(alpaca=alpaca)
    assert nav["sleeve_a_equity"] == 50_000
    assert nav["sleeve_b_equity"] == 80_000
    assert nav["sleeve_b_margin_used"] == 0   # under $500K cap
    assert nav["total_nav"] == 1_000_000
    sql = _executed[-1]
    assert "insert into public.paper_nav_daily" in sql
    assert "on conflict (snapshot_date) do update" in sql


def test_write_nav_daily_with_leverage():
    # Sleeve B exceeds $500K cap by $200K → leverage 200K
    positions = [_pos("NVDA", 100, 700_000)]
    account = AlpacaAccountSnapshot(
        account_number="PA3ENEE9XT8L", cash=500_000, equity=1_200_000,
        buying_power=2_400_000, portfolio_value=1_200_000,
        long_market_value=700_000, short_market_value=0,
        initial_margin=100_000, maintenance_margin=50_000, status="ACTIVE",
    )
    alpaca = MockAlpaca(positions=positions, account=account)
    nav = write_nav_daily(alpaca=alpaca)
    assert nav["sleeve_b_equity"] == 700_000
    assert nav["sleeve_b_margin_used"] == 200_000
