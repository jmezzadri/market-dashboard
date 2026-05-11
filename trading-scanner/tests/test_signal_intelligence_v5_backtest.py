"""Unit tests for the v5 Phase 3 backtest harness."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from scanner.signal_intelligence_v5 import backtest_harness as h
from scanner.signal_intelligence_v5 import composite as v5c


# ─────────────────────────────────────────────────────────────────────────────
# Helpers used by multiple tests
# ─────────────────────────────────────────────────────────────────────────────

def _ins_row(d: date, code: str, owner: str, amount: int, price: float, *,
             is_10b5_1: bool = False, is_officer: bool = True,
             marketcap: float | None = 1e9) -> dict:
    return {
        "ticker": "ABC", "transaction_date": d.isoformat(),
        "owner_name": owner, "owner_name_lower": owner.lower(),
        "transaction_code": code, "amount": amount, "stock_price": price,
        "is_officer": is_officer, "is_director": False,
        "is_ten_percent_owner": False, "is_10b5_1": is_10b5_1,
        "marketcap": marketcap, "__d": d,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. cap_bucket classifier
# ─────────────────────────────────────────────────────────────────────────────

def test_cap_bucket_thresholds():
    """Each cap bucket boundary classifies in the correct band."""
    assert h.cap_bucket(300_000_000) == "Small Cap"
    assert h.cap_bucket(8_099_999_999) == "Small Cap"
    assert h.cap_bucket(8_100_000_000) == "Mid Cap"
    assert h.cap_bucket(23_499_999_999) == "Mid Cap"
    assert h.cap_bucket(23_500_000_000) == "Large Cap"
    assert h.cap_bucket(199_999_999_999) == "Large Cap"
    assert h.cap_bucket(200_000_000_000) == "Mega Cap"
    assert h.cap_bucket(2_000_000_000_000) == "Mega Cap"
    assert h.cap_bucket(None) == "Unknown"
    assert h.cap_bucket(100_000_000) == "Unknown"  # below floor


# ─────────────────────────────────────────────────────────────────────────────
# 2. Insider pure logic (first-buy gate, 10b5-1 exclusion)
# ─────────────────────────────────────────────────────────────────────────────

def test_insider_first_buy_gate_fires_when_no_prior_p_buy():
    """Owner with no prior P buys -> first-buy bonus fires (sub_score boosted)."""
    eff = date(2025, 9, 1)
    in_window = [
        _ins_row(eff - timedelta(days=5), "P", "JOHN SMITH", 10000, 50.0),
    ]
    # no prior history -> first_buy_fires=True
    sub = h._insider_compute_from_rows(in_window, in_window, eff)
    # v2_signal positive (insider P-buy), +10 boost for first buy
    assert sub is not None
    assert sub > 0


def test_insider_10b5_1_sell_excluded():
    """10b5-1 sales are treated as routine; do not register as a sell signal."""
    eff = date(2025, 9, 1)
    rows = [
        _ins_row(eff - timedelta(days=3), "S", "JANE DOE", 5000, 50.0, is_10b5_1=True),
    ]
    sub = h._insider_compute_from_rows(rows, rows, eff)
    # All-10b5-1 sell window -> v2 should not produce a bearish signal
    # (it treats them as routine). Result is None or 0, not strongly negative.
    assert sub is None or sub > -20


# ─────────────────────────────────────────────────────────────────────────────
# 3. Composite blending with cap-discount
# ─────────────────────────────────────────────────────────────────────────────

def test_composite_cap_discount_applied_at_floor_and_ceiling():
    """insider_weight_factor anchors: $500M=1.00, $50B=0.50, $500B=0.25."""
    assert v5c.insider_weight_factor(500_000_000) == pytest.approx(1.0, abs=0.01)
    assert v5c.insider_weight_factor(50_000_000_000) == pytest.approx(0.5, abs=0.01)
    assert v5c.insider_weight_factor(500_000_000_000) == pytest.approx(0.25, abs=0.01)
    # below floor / above ceiling clamped
    assert v5c.insider_weight_factor(100_000_000) == 1.0
    assert v5c.insider_weight_factor(1_000_000_000_000) == 0.25
    # missing cap
    assert v5c.insider_weight_factor(None) == 1.0


def test_composite_excludes_none_subscores_from_denominator():
    """None sub_scores are excluded; non-None weight renormalized.

    v5.1 (2026-05-10): only 2 of 6 signals firing falls below the
    MIN_COVERAGE_SIGNALS (3) honest-score guard -- the calibrated-weights
    composite returns Insufficient Data. The original 60-when-2-fire
    behavior is preserved when min_coverage_signals=2 is exercised by
    callers that explicitly opt in (e.g. backward-compat code paths or
    the historical backtest harness that needs the older shape).
    """
    sub_scores = {
        "insider": 80, "options": None, "congress": None,
        "technicals": 40, "analyst": None, "short_interest": None,
    }
    # Default behavior at calibrated weights: insider(36.3%)+technicals(8.7%)
    # = 45% weight, 2 signals -> passes both coverage guards (>= 2 signals
    # AND >= 40% weight) so the composite IS computed.
    res = v5c.compute_composite(sub_scores, market_cap=500_000_000)
    assert res["mt_score"] is not None
    assert res["band"] in ("Watch Buy", "Strong Buy")
    assert res["signals_fired"] == 2

    # If only one signal fires, the row always fails the signals guard
    # (>= 2 required). Even insider alone at 36.3% weight is gated -- a
    # single-signal score is too brittle.
    sub_lone = {"insider": 80, "options": None, "congress": None,
                "technicals": None, "analyst": None, "short_interest": None}
    res_lone = v5c.compute_composite(sub_lone, market_cap=500_000_000)
    assert res_lone["mt_score"] is None
    assert res_lone["band"] == "Insufficient Data"
    assert res_lone["signals_fired"] == 1

    # When the test wants to verify the old none-handling math directly, it
    # has to use 3 firing signals so the coverage guard does not strip the
    # composite. We keep the same insider+technicals pattern and add a
    # third positive signal (options at 0) so the math still produces a
    # positive blend without changing the test's intent.
    sub_scores_3 = dict(sub_scores)
    sub_scores_3["options"] = 0
    res3 = v5c.compute_composite(sub_scores_3, market_cap=500_000_000,
                                  weights=v5c.EQUAL_WEIGHTS)
    # Weighted mean over 3 firing signals (each 1/6) = (80 + 40 + 0) / 3 = 40
    assert res3["mt_score"] == pytest.approx(40.0, abs=0.5)
    assert res3["band"] in ("Watch Buy", "Strong Buy", "Neutral")


def test_composite_all_none_returns_no_data():
    """Every sub_score None -> mt_score=None, band='No Data'."""
    res = v5c.compute_composite({k: None for k in v5c.SIGNAL_KEYS},
                                 market_cap=1_000_000_000)
    assert res["mt_score"] is None
    assert res["band"] == "No Data"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Refit weights round-trip
# ─────────────────────────────────────────────────────────────────────────────

def test_composite_accepts_refit_weights_and_sums_to_one():
    """Run C custom weights propagate through the composite; total stays 1.0."""
    custom = {
        "insider": 0.5, "options": 0.1, "congress": 0.0,
        "technicals": 0.2, "analyst": 0.1, "short_interest": 0.1,
    }
    sub_scores = {k: 50 for k in v5c.SIGNAL_KEYS}  # all moderate-bull
    res = v5c.compute_composite(sub_scores, market_cap=1_000_000_000, weights=custom)
    # weights_used after cap-discount should sum to 1.0 within epsilon
    wu = res["weights_used"]
    assert sum(wu.values()) == pytest.approx(1.0, abs=1e-6)
    # cap discount at $1B: factor = 1 - 0.25*log10(1B/500M) = 1 - 0.25*0.301 = 0.925
    expected_factor = v5c.insider_weight_factor(1_000_000_000)
    # The insider weight is shrunk; freed weight goes pro-rata to others
    assert wu["insider"] == pytest.approx(custom["insider"] * expected_factor, abs=1e-4)
    # MT score should be 50 (all signals 50)
    assert res["mt_score"] == pytest.approx(50.0, abs=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Slice helpers — window inclusivity
# ─────────────────────────────────────────────────────────────────────────────

def test_slice_window_inclusive_both_ends():
    """_slice_window includes rows on the boundary dates."""
    rows = [
        {"__d": date(2025, 1, 1)},
        {"__d": date(2025, 6, 1)},   # inside
        {"__d": date(2025, 9, 1)},   # boundary high
        {"__d": date(2025, 12, 1)},
    ]
    sliced = h._slice_window(rows, date(2025, 6, 1), date(2025, 9, 1))
    dates = [r["__d"] for r in sliced]
    assert date(2025, 6, 1) in dates
    assert date(2025, 9, 1) in dates
    assert date(2025, 1, 1) not in dates
    assert date(2025, 12, 1) not in dates


# ─────────────────────────────────────────────────────────────────────────────
# 6. SPY forward-return cache
# ─────────────────────────────────────────────────────────────────────────────

def test_spy_fwd_cache_returns_none_for_missing_date():
    """fetch_spy_forward returns None on dates not in the cache rather than KeyError."""
    # Seed cache with one date so it's "populated" without yfinance call
    h._SPY_FWD_CACHE.clear()
    h._SPY_FWD_CACHE[date(2025, 1, 2)] = 0.0123
    assert h.fetch_spy_forward(date(2025, 1, 2)) == pytest.approx(0.0123)
    assert h.fetch_spy_forward(date(2099, 12, 31)) is None
