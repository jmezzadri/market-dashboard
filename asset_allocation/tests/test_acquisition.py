"""Unit tests for asset_allocation/acquisition.py — fast offline tests only.
Live data tests live in tests/integration/ and run separately."""

import json
from datetime import datetime, timezone
from pathlib import Path

from asset_allocation.acquisition import (
    AcquisitionRun,
    series_to_points,
    load_industry_groups,
    EQUITY_TICKERS,
    DEFENSIVE_TICKERS,
    BENCHMARK_TICKERS,
    FRED_FACTORS,
    YAHOO_FACTORS,
)
import pandas as pd


def test_universe_is_correct_size():
    """v10 universe must be 14 equity + 4 defensive + 2 benchmarks = 20."""
    assert len(EQUITY_TICKERS) == 14
    assert len(DEFENSIVE_TICKERS) == 4
    assert len(BENCHMARK_TICKERS) == 2


def test_universe_includes_megacap_growth():
    """MGK was the v9 addition — must remain in the v10 universe."""
    assert "MGK" in EQUITY_TICKERS


def test_universe_uses_iyr_not_xlre():
    """Per v9 deep-history substitution, IYR (2000 inception) is used over XLRE (2015)."""
    assert "IYR" in EQUITY_TICKERS
    assert "XLRE" not in EQUITY_TICKERS


def test_universe_uses_iyz_not_xlc():
    """Per v9 deep-history substitution, IYZ (2000 inception) is used over XLC (2018)."""
    assert "IYZ" in EQUITY_TICKERS
    assert "XLC" not in EQUITY_TICKERS


def test_factors_have_required_metadata():
    """Every FRED factor must have series_id, cadence, unit, min, max, expected_lag_days."""
    required = {"series_id", "cadence", "unit", "min", "max", "expected_lag_days"}
    for name, meta in FRED_FACTORS.items():
        missing = required - set(meta.keys())
        assert not missing, f"{name} missing: {missing}"


def test_yahoo_factors_have_required_metadata():
    required = {"ticker", "cadence", "unit", "min", "max", "expected_lag_days"}
    for name, meta in YAHOO_FACTORS.items():
        missing = required - set(meta.keys())
        assert not missing, f"{name} missing: {missing}"


def test_factor_min_max_sane():
    """Sanity-check the sanity-check thresholds — min < max."""
    for name, meta in {**FRED_FACTORS, **YAHOO_FACTORS}.items():
        assert meta["min"] < meta["max"], f"{name}: min {meta['min']} not < max {meta['max']}"


def test_factor_count_minimum():
    """We need at least 20 factors for the multivariate regression to work meaningfully."""
    total = len(FRED_FACTORS) + len(YAHOO_FACTORS) + 1  # +1 for copper_gold computed
    assert total >= 20, f"only {total} factors, expected ≥ 20"


def test_acquisition_run_logging():
    run = AcquisitionRun(
        run_id="test123",
        start_time=datetime.now(timezone.utc).isoformat(),
        run_dir=Path("/tmp/x"),
    )
    run.log_success("test", "thing", "ok")
    run.log_warning("test", "warn", "stale")
    run.log_failure("test", "fail", "broken")
    d = run.to_dict()
    assert len(d["successes"]) == 1
    assert len(d["warnings"]) == 1
    assert len(d["failures"]) == 1
    assert d["exit_status"] == "partial"


def test_acquisition_run_all_success_exit_status():
    run = AcquisitionRun(
        run_id="test123",
        start_time=datetime.now(timezone.utc).isoformat(),
        run_dir=Path("/tmp/x"),
    )
    run.log_success("test", "thing")
    assert run.to_dict()["exit_status"] == "success"


def test_acquisition_run_all_failure_exit_status():
    run = AcquisitionRun(
        run_id="test123",
        start_time=datetime.now(timezone.utc).isoformat(),
        run_dir=Path("/tmp/x"),
    )
    run.log_failure("test", "thing", "x")
    assert run.to_dict()["exit_status"] == "failure"


def test_series_to_points_format():
    s = pd.Series([1.0, 2.0, 3.0],
                  index=pd.to_datetime(["2026-04-24", "2026-04-25", "2026-04-26"]))
    points = series_to_points(s)
    assert points == [["2026-04-24", 1.0], ["2026-04-25", 2.0], ["2026-04-26", 3.0]]


def test_series_to_points_drops_nan():
    s = pd.Series([1.0, float("nan"), 3.0],
                  index=pd.to_datetime(["2026-04-24", "2026-04-25", "2026-04-26"]))
    points = series_to_points(s)
    assert len(points) == 2
    assert points[0] == ["2026-04-24", 1.0]
    assert points[1] == ["2026-04-26", 3.0]


def test_load_industry_groups():
    """Static reference data must load and have all 16 groups defined in the v10 universe."""
    ref = load_industry_groups()
    assert ref["schema_version"] == "v10.0"
    expected_groups = {
        "Software", "Semiconductors", "Biotech", "Banks", "Insurance", "MedDevices",
        "Transports", "AeroDefense", "OilExploration", "Retail", "Materials",
        "ConsStaples", "Utilities", "RealEstate", "CommSvcs", "MegaCapGrowth",
    }
    actual_groups = set(ref["groups"].keys())
    assert actual_groups == expected_groups, f"diff: {actual_groups ^ expected_groups}"


def test_industry_groups_have_examples():
    """Every group must have at least 3 example holdings (for the UI)."""
    ref = load_industry_groups()
    for name, group in ref["groups"].items():
        assert len(group["examples"]) >= 3, f"{name} has only {len(group['examples'])} examples"


def test_industry_groups_have_kill_factors():
    """Every group must have at least one kill_factor (for risk scenario generation in Phase 4)."""
    ref = load_industry_groups()
    for name, group in ref["groups"].items():
        assert "kill_factors" in group, f"{name} has no kill_factors"
        assert len(group["kill_factors"]) >= 1, f"{name} has no kill_factors entries"
