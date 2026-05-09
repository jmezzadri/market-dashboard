"""
Unit tests for scanner.signal_intelligence_v2.options.

Anchors against the canonical NVDA worked example in
TRADING_OPPS_V2_SPEC.md §A0.5 (Options Signal +44).

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_options_signal_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.options import compute_options_signal


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _call(premium, delta=0.45):
    return {"option_type": "call", "premium": premium, "delta": delta}


def _put(premium, delta=-0.32):
    return {"option_type": "put", "premium": premium, "delta": delta}


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example — Options Signal +44
#
#   Call premium $185M × delta 0.45  → +$83.25M directional
#   Put  premium  $42M × |delta 0.32| → −$13.44M directional
#   Net directional: +$69.81M (spec rounds to $69.9M)
#
#   Rolling directional stats: mean $25M, sd $30M → z = 1.494
#   Directional score = clamp(1.494 × 25, ±50) = +37.35
#
#   Rolling total stats:       mean $145M, sd $50M → z = 1.640
#   Total premium $227M; signed by direction (+1) → +1.640
#   Magnitude score = clamp(1.640 × 12 × 1, ±25) = +19.68
#
#   25-delta IV: call 48.5%, put 51.2% → skew = -2.7pp
#   Skew score = clamp(-2.7 × 5, ±25) = -13.5
#
#   Raw = 37.35 + (-13.5) + 19.68 = 43.53 → +44
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_worked_example_score_44():
    flows = [_call(185_000_000, 0.45), _put(42_000_000, -0.32)]
    score = compute_options_signal(
        flows=flows,
        rolling_directional={"mean": 25_000_000, "sd": 30_000_000},
        rolling_total={"mean": 145_000_000, "sd": 50_000_000},
        iv_snapshot={"call_iv_25d": 0.485, "put_iv_25d": 0.512},
    )
    assert score == 44, f"Expected +44, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Bearish flow + inverted-bear skew → strong negative
# ─────────────────────────────────────────────────────────────────────────────

def test_heavy_put_flow_with_bearish_skew():
    """Heavy puts opening, calls cheap relative to puts → strong bearish."""
    flows = [_call(20_000_000, 0.40), _put(180_000_000, -0.45)]
    score = compute_options_signal(
        flows=flows,
        rolling_directional={"mean": 0, "sd": 30_000_000},
        rolling_total={"mean": 145_000_000, "sd": 50_000_000},
        iv_snapshot={"call_iv_25d": 0.42, "put_iv_25d": 0.50},  # puts much richer
    )
    # net_dir = 20M*0.4 - 180M*0.45 = 8M - 81M = -73M, z = -73/30 = -2.43
    # directional = clamp(-2.43*25, ±50) = -50 (saturates)
    # skew = (0.42-0.50)*100 = -8 pp, score = clamp(-8*5, ±25) = -25 (saturates)
    # total = 200M, z = (200-145)/50 = 1.10, signed by direction (-1) = -1.10
    # magnitude = clamp(-1.10*12, ±25) = -13.2
    # raw = -50 + (-25) + (-13.2) = -88.2 → -88
    assert score is not None
    assert score <= -75, f"Expected Strong Bearish (≤−75), got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Inverted-bull skew without flow data → small bullish from skew alone
# ─────────────────────────────────────────────────────────────────────────────

def test_skew_only_inverted_bull():
    """Calls richer than puts (inverted skew) with no flow data — score from skew alone."""
    score = compute_options_signal(
        flows=None,
        iv_snapshot={"call_iv_25d": 0.55, "put_iv_25d": 0.50},  # +5pp skew
    )
    # skew = +5pp, score = clamp(5*5, ±25) = +25
    # Other components 0.
    assert score == 25, f"Expected +25 from skew alone, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# No data at all → None
# ─────────────────────────────────────────────────────────────────────────────

def test_no_data_returns_none():
    assert compute_options_signal(None) is None
    assert compute_options_signal([]) is None
    assert compute_options_signal(None, iv_snapshot=None) is None


# ─────────────────────────────────────────────────────────────────────────────
# Flows but no rolling stats → directional + magnitude both 0; only skew
# (if available) contributes. Or 0 if no IV either, but score still returns
# (not None) because we have flow data.
# ─────────────────────────────────────────────────────────────────────────────

def test_flows_without_rolling_stats():
    """Flows but no rolling baseline — directional/magnitude can't z-score, but flow-presence still triggers a (zero) score, not None."""
    flows = [_call(100_000_000, 0.5)]
    score = compute_options_signal(flows=flows)  # no rolling, no iv
    # directional & magnitude → 0 (no rolling stats)
    # skew → 0 (no IV)
    # raw = 0; score = 0
    assert score == 0


# ─────────────────────────────────────────────────────────────────────────────
# Magnitude dampens direction when activity is below normal
# ─────────────────────────────────────────────────────────────────────────────

def test_magnitude_dampens_thin_activity():
    """Bullish direction but BELOW-average activity → magnitude pulls negative."""
    flows = [_call(20_000_000, 0.5), _put(2_000_000, -0.3)]
    # net_dir = 10M - 0.6M = 9.4M, z = 9.4/30 = 0.313, directional = +7.83
    # total = 22M, z = (22-145)/50 = -2.46, signed by direction (+1) = -2.46
    # magnitude = clamp(-2.46*12, ±25) = -25 (saturates)
    # skew assume neutral (none provided)
    # raw = 7.83 + 0 + (-25) = -17.17
    score = compute_options_signal(
        flows=flows,
        rolling_directional={"mean": 0, "sd": 30_000_000},
        rolling_total={"mean": 145_000_000, "sd": 50_000_000},
    )
    assert score is not None
    assert score < 0, f"Thin activity on bullish direction should pull negative, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Magnitude amplifies direction when activity is above normal AND directional
# ─────────────────────────────────────────────────────────────────────────────

def test_magnitude_amplifies_strong_activity():
    """Bullish direction with HEAVY activity → magnitude adds positive."""
    flows = [_call(300_000_000, 0.5), _put(10_000_000, -0.3)]
    # net_dir = 150M - 3M = 147M, z = 147/30 = 4.9, directional = clamp = +50
    # total = 310M, z = (310-145)/50 = 3.3, signed +1 = +3.3
    # magnitude = clamp(3.3*12, ±25) = +25
    # raw = 50 + 0 + 25 = 75
    score = compute_options_signal(
        flows=flows,
        rolling_directional={"mean": 0, "sd": 30_000_000},
        rolling_total={"mean": 145_000_000, "sd": 50_000_000},
    )
    assert score is not None
    assert score >= 50, f"Heavy bullish activity should produce ≥ +50, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Symmetry sanity — flipping all signs flips the score's sign
# ─────────────────────────────────────────────────────────────────────────────

def test_symmetry_flip():
    """Mirroring bullish setup with bearish should flip score sign approximately."""
    bull_flows = [_call(185_000_000, 0.45), _put(42_000_000, -0.32)]
    bear_flows = [_call(42_000_000, 0.32), _put(185_000_000, -0.45)]
    rolling_dir = {"mean": 0, "sd": 30_000_000}
    rolling_total = {"mean": 145_000_000, "sd": 50_000_000}

    s_bull = compute_options_signal(
        flows=bull_flows,
        rolling_directional=rolling_dir,
        rolling_total=rolling_total,
        iv_snapshot={"call_iv_25d": 0.55, "put_iv_25d": 0.50},
    )
    s_bear = compute_options_signal(
        flows=bear_flows,
        rolling_directional=rolling_dir,
        rolling_total=rolling_total,
        iv_snapshot={"call_iv_25d": 0.50, "put_iv_25d": 0.55},
    )
    # Should be mirrored within rounding tolerance
    assert s_bull is not None and s_bear is not None
    assert abs(s_bull + s_bear) <= 2, f"Symmetric setups should mirror; got bull={s_bull}, bear={s_bear}"
