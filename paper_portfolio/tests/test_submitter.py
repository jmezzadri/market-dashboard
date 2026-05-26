"""
Tests for paper_portfolio.submitter — using a mock AlpacaPaperClient.

These tests verify behavior without ever calling Alpaca or Supabase. We
patch the Supabase reader/writer at module scope and pass a MockAlpaca
in place of the real client.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
import requests

from paper_portfolio.submitter import (
    PendingOrderRow,
    submit_pending_orders,
)


class MockAlpaca:
    """Records every call; can be configured to return canned responses
    or raise a canned HTTPError."""

    def __init__(self, submit_response=None, submit_raises=None,
                 existing_by_client_id=None):
        self.submit_response = submit_response or {"id": "alpaca-generated-uuid"}
        self.submit_raises = submit_raises          # HTTPError to raise
        self.existing_by_client_id = existing_by_client_id or {}
        self.submit_calls = []
        self.lookup_calls = []

    def submit_market_on_open(self, **kwargs):
        self.submit_calls.append(kwargs)
        if self.submit_raises:
            raise self.submit_raises
        return self.submit_response

    def get_order_by_client_id(self, client_order_id):
        self.lookup_calls.append(client_order_id)
        return self.existing_by_client_id.get(client_order_id)


# Capture every executed SQL string so we can assert on state transitions.
_executed_sql: list[str] = []


def _fake_exec(sql: str) -> None:
    _executed_sql.append(sql)


@pytest.fixture(autouse=True)
def patch_supabase(monkeypatch):
    """Stub out the Supabase reader/writer for every test."""
    _executed_sql.clear()
    monkeypatch.setattr("paper_portfolio.submitter._supabase_exec", _fake_exec)
    monkeypatch.setattr("paper_portfolio.submitter.fetch_pending_orders", lambda limit=500: PENDING)
    yield


PENDING: list[PendingOrderRow] = []


def _mk(row_id: str, ticker: str, side: str = "buy",
        qty: float | None = 100.0, notional: float | None = None,
        sleeve: str = "B", score: int | None = 8) -> PendingOrderRow:
    return PendingOrderRow(
        id=row_id, sleeve=sleeve, ticker=ticker, side=side,
        order_type="market_on_open",
        target_quantity=qty, target_notional=notional,
        signal_score=score, signal_source="equity_scanner",
        rebalance_trigger_reason="test",
    )


def test_happy_path_submits_and_marks_submitted(monkeypatch):
    PENDING[:] = [_mk("row-1", "NVDA", qty=100.0)]
    alpaca = MockAlpaca(submit_response={"id": "alp-abc-123"})
    result = submit_pending_orders(alpaca=alpaca)

    assert result.submitted == 1
    assert result.rejected == 0
    assert len(alpaca.submit_calls) == 1
    call = alpaca.submit_calls[0]
    assert call["ticker"] == "NVDA"
    assert call["side"] == "buy"
    assert call["client_order_id"] == "row-1"
    # SQL should reflect status='submitted' for this id
    sql_all = " ".join(_executed_sql)
    assert "status = 'submitted'" in sql_all
    assert "alp-abc-123" in sql_all
    assert "row-1" in sql_all


def test_duplicate_client_id_is_repaired_not_re_submitted():
    """If Alpaca already has an order with this client_order_id (idempotency
    pre-check), the submitter should skip the POST and just repair state."""
    PENDING[:] = [_mk("row-2", "AAPL", qty=50.0)]
    alpaca = MockAlpaca(existing_by_client_id={"row-2": {"id": "alp-existing-xyz"}})
    result = submit_pending_orders(alpaca=alpaca)

    assert result.duplicates == 1
    assert result.submitted == 0
    assert len(alpaca.submit_calls) == 0          # never tried to submit
    sql_all = " ".join(_executed_sql)
    assert "alp-existing-xyz" in sql_all
    assert "status = 'submitted'" in sql_all


def test_alpaca_422_marks_row_rejected():
    PENDING[:] = [_mk("row-3", "BADTKR", qty=10.0)]
    err_resp = type("R", (), {"status_code": 422, "text": '{"message":"symbol not tradable"}'})()
    http_err = requests.HTTPError(response=err_resp)
    alpaca = MockAlpaca(submit_raises=http_err)
    result = submit_pending_orders(alpaca=alpaca)

    assert result.rejected == 1
    assert result.submitted == 0
    sql_all = " ".join(_executed_sql)
    assert "status = 'rejected'" in sql_all
    assert "symbol not tradable" in sql_all


def test_dry_run_writes_nothing():
    PENDING[:] = [_mk("row-4", "MSFT", qty=20.0)]
    alpaca = MockAlpaca()
    result = submit_pending_orders(alpaca=alpaca, dry_run=True)
    assert result.submitted == 1
    # dry_run skips both pre-check and submit
    assert len(_executed_sql) == 0


def test_notional_path_when_qty_missing():
    """If target_quantity is None but target_notional is set, the submitter
    must pass notional to Alpaca."""
    PENDING[:] = [_mk("row-5", "VTI", qty=None, notional=5000.0)]
    alpaca = MockAlpaca()
    result = submit_pending_orders(alpaca=alpaca)
    assert result.submitted == 1
    call = alpaca.submit_calls[0]
    assert call.get("notional") == 5000.0


def test_missing_qty_and_notional_marks_rejected():
    PENDING[:] = [_mk("row-6", "GOOG", qty=None, notional=None)]
    alpaca = MockAlpaca()
    result = submit_pending_orders(alpaca=alpaca)
    assert result.rejected == 1
    assert result.submitted == 0


def test_empty_pending_is_noop():
    PENDING[:] = []
    alpaca = MockAlpaca()
    result = submit_pending_orders(alpaca=alpaca)
    assert result.submitted == 0
    assert result.rejected == 0
    assert result.duplicates == 0
    assert len(alpaca.submit_calls) == 0
