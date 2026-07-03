"""
Tests for paper_portfolio.freshness.is_trading_session — the trading-day
gate's calendar primitive (added 2026-07-03 after the Independence Day
holiday submission). Mock Alpaca; no network.
"""

from __future__ import annotations

import datetime as dt

import pytest

from paper_portfolio.freshness import is_trading_session


class MockAlpaca:
    def __init__(self, payload=None, raises=None):
        self.payload = payload if payload is not None else []
        self.raises = raises
        self.calls = []

    def _get(self, path):
        self.calls.append(path)
        if self.raises:
            raise self.raises
        return self.payload


def test_trading_day_true_when_calendar_lists_the_day():
    a = MockAlpaca(payload=[{"date": "2026-07-06", "open": "09:30", "close": "16:00"}])
    assert is_trading_session(a, dt.date(2026, 7, 6)) is True
    assert a.calls == ["/v2/calendar?start=2026-07-06&end=2026-07-06"]


def test_holiday_false_when_calendar_omits_the_day():
    # 2026-07-03: Independence Day observed — a WEEKDAY with no session.
    a = MockAlpaca(payload=[])
    assert is_trading_session(a, dt.date(2026, 7, 3)) is False


def test_false_when_calendar_returns_a_neighboring_session_only():
    # Defensive: some calendar ranges include the next session instead of
    # an empty list — a neighboring date must not count as today.
    a = MockAlpaca(payload=[{"date": "2026-07-06", "open": "09:30", "close": "16:00"}])
    assert is_trading_session(a, dt.date(2026, 7, 3)) is False


def test_early_close_day_is_still_a_trading_day():
    # 2026-11-27 (half day): a session with an early close is a trading day.
    a = MockAlpaca(payload=[{"date": "2026-11-27", "open": "09:30", "close": "13:00"}])
    assert is_trading_session(a, dt.date(2026, 11, 27)) is True


def test_none_payload_is_false_not_crash():
    a = MockAlpaca(payload=None)
    a.payload = None  # _get returns None
    assert is_trading_session(a, dt.date(2026, 7, 3)) is False


def test_transport_error_propagates_to_caller():
    # The runner decides the fail-safe direction (block + P1); the helper
    # must NOT swallow errors into a silent True/False.
    a = MockAlpaca(raises=RuntimeError("calendar down"))
    with pytest.raises(RuntimeError):
        is_trading_session(a, dt.date(2026, 7, 6))
