"""
Unit tests for scanner.signal_intelligence_v2.universe.

Verifies the v2 universe filter:
- $1B market cap floor
- $10M average daily dollar volume floor
- ETF / OTC / etc. excluded
- No momentum gates (the whole point of v2)

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_universe_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.universe import (
    UNIVERSE_MIN_ADV_USD,
    UNIVERSE_MIN_MARKET_CAP_USD,
    filter_universe_v2,
)


def _candidate(
    ticker: str,
    market_cap: float = 5e9,
    adv: float = 50e6,
    asset_type: str = "common",
    exchange: str = "NASDAQ",
):
    return {
        "ticker": ticker,
        "market_cap": market_cap,
        "avg_dollar_volume_20d": adv,
        "asset_type": asset_type,
        "exchange": exchange,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Default gates: $1B market cap + $10M ADV
# ─────────────────────────────────────────────────────────────────────────────

def test_passes_both_gates():
    """A name with $5B market cap and $50M ADV passes."""
    survivors = filter_universe_v2([_candidate("NVDA")])
    assert survivors == ["NVDA"]


def test_below_market_cap_floor_excluded():
    """A $500M company is below the $1B floor."""
    survivors = filter_universe_v2([_candidate("MICRO", market_cap=500_000_000)])
    assert survivors == []


def test_below_adv_floor_excluded():
    """A $5B company with $5M ADV (below $10M floor) is excluded."""
    survivors = filter_universe_v2([_candidate("ILLIQUID", adv=5_000_000)])
    assert survivors == []


def test_at_floor_passes():
    """A name at exactly $1B mkt cap and $10M ADV passes."""
    survivors = filter_universe_v2([
        _candidate("EDGE", market_cap=1_000_000_000, adv=10_000_000),
    ])
    assert survivors == ["EDGE"]


# ─────────────────────────────────────────────────────────────────────────────
# Asset-type / exchange exclusions
# ─────────────────────────────────────────────────────────────────────────────

def test_etf_excluded():
    survivors = filter_universe_v2([_candidate("SPY", asset_type="etf")])
    assert survivors == []


def test_etn_excluded():
    survivors = filter_universe_v2([_candidate("VXX", asset_type="etn")])
    assert survivors == []


def test_warrant_excluded():
    survivors = filter_universe_v2([_candidate("ABC.W", asset_type="warrant")])
    assert survivors == []


def test_otc_excluded():
    survivors = filter_universe_v2([_candidate("OTCNAME", exchange="OTC")])
    assert survivors == []


def test_pink_sheets_excluded():
    survivors = filter_universe_v2([_candidate("PINKNAME", exchange="PINK")])
    assert survivors == []


# ─────────────────────────────────────────────────────────────────────────────
# Mixed candidate list — only those passing both gates surface
# ─────────────────────────────────────────────────────────────────────────────

def test_mixed_universe():
    candidates = [
        _candidate("NVDA"),                                  # passes
        _candidate("AAPL"),                                  # passes
        _candidate("TINY", market_cap=500_000_000),          # below mkt cap
        _candidate("ILLIQ", adv=2_000_000),                  # below ADV
        _candidate("SPY", asset_type="etf"),                 # ETF excluded
        _candidate("OTCNAME", exchange="OTC"),               # OTC excluded
        _candidate("MSFT"),                                  # passes
    ]
    survivors = filter_universe_v2(candidates)
    assert survivors == ["AAPL", "MSFT", "NVDA"]


# ─────────────────────────────────────────────────────────────────────────────
# Custom thresholds (Phase D may sweep these)
# ─────────────────────────────────────────────────────────────────────────────

def test_custom_thresholds():
    """Caller can override gate thresholds for back-test sweeps."""
    candidates = [
        _candidate("BIG", market_cap=10e9, adv=50e6),
        _candidate("MID", market_cap=2e9, adv=30e6),
    ]
    # Stricter gates: $5B mkt cap, $40M ADV → only BIG passes
    survivors = filter_universe_v2(
        candidates, min_market_cap=5e9, min_adv_usd=40e6
    )
    assert survivors == ["BIG"]


# ─────────────────────────────────────────────────────────────────────────────
# Empty / null inputs handled gracefully
# ─────────────────────────────────────────────────────────────────────────────

def test_empty_candidate_list():
    assert filter_universe_v2([]) == []


def test_null_market_cap_excluded():
    """A row with null market_cap is excluded (defensive)."""
    candidates = [_candidate("UNKNOWN", market_cap=None)]
    assert filter_universe_v2(candidates) == []


def test_null_adv_excluded():
    candidates = [_candidate("UNKNOWN", adv=None)]
    assert filter_universe_v2(candidates) == []


# ─────────────────────────────────────────────────────────────────────────────
# Default constants match spec
# ─────────────────────────────────────────────────────────────────────────────

def test_default_thresholds_match_spec():
    """v2 spec defines $1B mkt cap + $10M ADV."""
    assert UNIVERSE_MIN_MARKET_CAP_USD == 1_000_000_000
    assert UNIVERSE_MIN_ADV_USD == 10_000_000


# ─────────────────────────────────────────────────────────────────────────────
# Sorted, deduplicated output
# ─────────────────────────────────────────────────────────────────────────────

def test_output_sorted_and_deduplicated():
    """Output is sorted alphabetically and de-duplicated."""
    candidates = [_candidate("NVDA"), _candidate("AAPL"), _candidate("NVDA")]
    survivors = filter_universe_v2(candidates)
    assert survivors == ["AAPL", "NVDA"]
