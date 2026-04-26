"""Unit tests for asset_allocation/validation.py."""

import json
from datetime import datetime, timezone
from pathlib import Path

from asset_allocation.validation import (
    validate_schema,
    validate_against_schema_file,
    check_factor_freshness,
    check_factor_sanity,
    check_factor_anomaly,
    check_price_freshness,
    run_validation,
)


# ──────────────────────────────────────────────────────────────────────────
# Schema validation
# ──────────────────────────────────────────────────────────────────────────


def test_validate_schema_required_field_missing():
    schema = {"type": "object", "required": ["foo"], "properties": {"foo": {"type": "string"}}}
    errs = validate_schema({}, schema)
    assert any("missing required field" in e for e in errs)


def test_validate_schema_type_mismatch():
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    errs = validate_schema({"x": 42}, schema)
    assert any("expected" in e and "got int" in e for e in errs)


def test_validate_schema_const_mismatch():
    schema = {"type": "object", "properties": {"v": {"type": "string", "const": "v10.0"}}}
    errs = validate_schema({"v": "v9.0"}, schema)
    assert any("const" in e for e in errs)


def test_validate_schema_min_properties():
    schema = {
        "type": "object",
        "properties": {"factors": {"type": "object", "minProperties": 3}}
    }
    errs = validate_schema({"factors": {"a": 1}}, schema)
    assert any("minimum 3" in e for e in errs)


def test_validate_factor_panel_schema_happy_path():
    """A well-formed factor panel should pass schema validation."""
    fp = {
        "schema_version": "v10.0",
        "pulled_at": "2026-04-26T12:00:00+00:00",
        "factors": {f"f{i}": {
            "source": "FRED:TEST",
            "cadence": "D",
            "unit": "%",
            "points": [["2026-01-01", 1.0]],
        } for i in range(25)},  # need >= 20 properties
    }
    errs = validate_against_schema_file(fp, "factor_panel.schema.json")
    assert errs == [], f"unexpected errors: {errs}"


def test_validate_factor_panel_missing_schema_version():
    fp = {
        "pulled_at": "2026-04-26T12:00:00+00:00",
        "factors": {f"f{i}": {"source": "FRED:T", "cadence": "D", "unit": "%",
                              "points": [["2026-01-01", 1.0]]} for i in range(25)},
    }
    errs = validate_against_schema_file(fp, "factor_panel.schema.json")
    assert any("schema_version" in e for e in errs)


# ──────────────────────────────────────────────────────────────────────────
# Freshness
# ──────────────────────────────────────────────────────────────────────────


def test_freshness_within_threshold_no_issues():
    today = datetime(2026, 4, 26, tzinfo=timezone.utc)
    fp = {"factors": {"vix": {
        "expected_lag_days": 1, "cadence": "D", "unit": "i",
        "source": "Yahoo:^VIX", "min_value": 5, "max_value": 100,
        "points": [["2026-04-25", 18.0], ["2026-04-26", 18.5]]
    }}}
    issues = check_factor_freshness(fp, today=today)
    assert issues == []


def test_freshness_warning_at_1x_threshold():
    today = datetime(2026, 4, 26, tzinfo=timezone.utc)
    fp = {"factors": {"jobless": {
        "expected_lag_days": 7, "cadence": "W", "unit": "k",
        "source": "FRED:ICSA", "min_value": 100, "max_value": 8000,
        "points": [["2026-04-15", 220.0]]  # 11 days old > 7
    }}}
    issues = check_factor_freshness(fp, today=today)
    assert any(i["severity"] == "warning" and i["factor"] == "jobless" for i in issues)


def test_freshness_error_at_2x_threshold():
    today = datetime(2026, 4, 26, tzinfo=timezone.utc)
    fp = {"factors": {"vix": {
        "expected_lag_days": 1,
        "points": [["2026-04-20", 18.0]]  # 6 days old, 2x threshold = 2 days, way over
    }}}
    issues = check_factor_freshness(fp, today=today)
    assert any(i["severity"] == "error" and i["factor"] == "vix" for i in issues)


# ──────────────────────────────────────────────────────────────────────────
# Sanity
# ──────────────────────────────────────────────────────────────────────────


def test_sanity_value_within_range():
    fp = {"factors": {"vix": {
        "min_value": 5, "max_value": 100,
        "points": [["2026-04-26", 18.5]]
    }}}
    issues = check_factor_sanity(fp)
    assert issues == []


def test_sanity_value_out_of_range_high():
    fp = {"factors": {"vix": {
        "min_value": 5, "max_value": 100,
        "points": [["2026-04-26", 150.0]]
    }}}
    issues = check_factor_sanity(fp)
    assert any(i["severity"] == "error" and "max_value" in i["issue"] for i in issues)


def test_sanity_value_out_of_range_low():
    fp = {"factors": {"vix": {
        "min_value": 5, "max_value": 100,
        "points": [["2026-04-26", 2.0]]
    }}}
    issues = check_factor_sanity(fp)
    assert any(i["severity"] == "error" and "min_value" in i["issue"] for i in issues)


# ──────────────────────────────────────────────────────────────────────────
# Anomaly
# ──────────────────────────────────────────────────────────────────────────


def test_anomaly_normal_change():
    """Normal-looking (random walk) time series should not produce anomaly warnings."""
    import random
    random.seed(42)
    points = [["2025-01-01", 100.0]]
    val = 100.0
    for i in range(70):
        # Random walk with std ~1 — typical financial-series-like noise
        val += random.gauss(0, 1.0)
        points.append([f"2025-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}", float(val)])
    fp = {"factors": {"x": {
        "max_mom_zscore": 5.0,
        "points": points
    }}}
    issues = check_factor_anomaly(fp)
    assert issues == [], f"unexpected anomaly: {issues}"


def test_anomaly_extreme_jump():
    """A 20-sigma jump should trigger an anomaly warning."""
    points = [["2025-01-01", 100.0]]
    for i in range(70):
        points.append([f"2025-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}",
                       float(100.0 + (i % 3))])
    points.append(["2026-04-26", 1000.0])  # massive outlier
    fp = {"factors": {"x": {
        "max_mom_zscore": 5.0,
        "points": points
    }}}
    issues = check_factor_anomaly(fp)
    assert any(i["factor"] == "x" for i in issues)


# ──────────────────────────────────────────────────────────────────────────
# End-to-end
# ──────────────────────────────────────────────────────────────────────────


def test_run_validation_all_files_present(tmp_path):
    """A run dir with all valid files should pass validation."""
    (tmp_path / "factor_panel.json").write_text(json.dumps({
        "schema_version": "v10.0",
        "pulled_at": "2026-04-26T12:00:00+00:00",
        "factors": {f"f{i}": {
            "source": "FRED:T", "cadence": "D", "unit": "%",
            "min_value": -10, "max_value": 10, "expected_lag_days": 7,
            "points": [[(datetime.now(timezone.utc).date()).isoformat(), 1.0]],
        } for i in range(25)},
    }))
    (tmp_path / "price_panel.json").write_text(json.dumps({
        "schema_version": "v10.0",
        "pulled_at": "2026-04-26T12:00:00+00:00",
        "tickers": {f"T{i}": {
            "source": "Yahoo:T",
            "first_observation": "2020-01-01",
            "last_observation": (datetime.now(timezone.utc).date()).isoformat(),
            "n_observations": 100,
            "points": [["2020-01-01", 100.0]] * 100,
        } for i in range(25)},
    }))
    (tmp_path / "reference_groups.json").write_text(json.dumps({
        "schema_version": "v10.0",
        "last_updated": "2026-04-25",
        "groups": {f"g{i}": {
            "display_name": f"G{i}",
            "gics_path": "Test",
            "examples": ["A", "B", "C"],
            "calibration_etf": "TEST",
        } for i in range(15)},
    }))
    passed, report = run_validation(tmp_path)
    assert passed, f"errors: {report['errors']}"


def test_run_validation_missing_files_fails(tmp_path):
    passed, report = run_validation(tmp_path)
    assert not passed
    assert any("file missing" in e["issue"] for e in report["errors"])
