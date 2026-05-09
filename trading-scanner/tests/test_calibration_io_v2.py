"""
Unit tests for scanner.signal_intelligence_v2.calibration_io.

Verifies round-tripping of calibration data through JSON and that the
placeholder values written to disk match the in-memory placeholders the
producer reads.

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_calibration_io_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scanner.signal_intelligence_v2.calibration_io import (
    CALIBRATION_FILENAMES,
    bands_to_json,
    conviction_table_from_json,
    conviction_table_to_json,
    excess_return_curve_from_json,
    excess_return_curve_to_json,
    load_calibration_from_dir,
    write_calibration_files,
)
from scanner.signal_intelligence_v2.rollup import (
    BAND_CUTOFFS,
    PLACEHOLDER_CONVICTION_TABLE,
    PLACEHOLDER_EXCESS_RETURN_CURVE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Round-trip: in-memory → JSON → in-memory
# ─────────────────────────────────────────────────────────────────────────────


def test_excess_return_curve_round_trip():
    original = PLACEHOLDER_EXCESS_RETURN_CURVE
    doc = excess_return_curve_to_json(original, source="test")
    restored = excess_return_curve_from_json(doc)
    assert restored == sorted(original)
    assert doc["source"] == "test"
    assert doc["schema_version"] == 1


def test_conviction_table_round_trip():
    original = PLACEHOLDER_CONVICTION_TABLE
    doc = conviction_table_to_json(original, source="test")
    restored = conviction_table_from_json(doc)
    assert set(restored.keys()) == set(original.keys())
    for agr in original:
        assert sorted(restored[agr]) == sorted(original[agr])


# ─────────────────────────────────────────────────────────────────────────────
# Bands JSON contains all 8 bands with non-overlapping ranges
# ─────────────────────────────────────────────────────────────────────────────


def test_bands_json_has_all_eight_bands():
    doc = bands_to_json(source="test")
    labels = [b["label"] for b in doc["bands"]]
    expected = {
        "Buy Signal", "Strong Bullish", "Moderate Bullish", "Weak Bullish",
        "Weak Bearish", "Moderate Bearish", "Strong Bearish", "Sell Trigger",
    }
    assert set(labels) == expected
    assert len(doc["bands"]) == 8


def test_bands_json_ranges_consistent():
    doc = bands_to_json(source="test")
    for band in doc["bands"]:
        assert -100 <= band["min_score"] <= band["max_score"] <= 100
        assert band["n_obs"] == 0  # placeholder
        assert band["population_pct"] == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# write_calibration_files writes valid JSON the producer can read back
# ─────────────────────────────────────────────────────────────────────────────


def test_write_then_load_round_trip(tmp_path):
    """Write placeholder, load, verify the producer's expected shapes match."""
    paths = write_calibration_files(tmp_path, source="placeholder_v1")
    assert all(Path(p).exists() for p in paths.values())

    loaded = load_calibration_from_dir(tmp_path)

    # Excess return curve matches placeholder
    assert loaded["excess_return_curve"] == sorted(PLACEHOLDER_EXCESS_RETURN_CURVE)

    # Conviction table matches placeholder
    for agr, curve in PLACEHOLDER_CONVICTION_TABLE.items():
        assert sorted(loaded["conviction_table"][agr]) == sorted(curve)

    # Source metadata propagates
    assert loaded["metadata"]["excess_return"]["source"] == "placeholder_v1"


def test_write_creates_three_files(tmp_path):
    paths = write_calibration_files(tmp_path)
    expected_filenames = set(CALIBRATION_FILENAMES.values())
    written_filenames = {Path(p).name for p in paths.values()}
    assert written_filenames == expected_filenames


# ─────────────────────────────────────────────────────────────────────────────
# JSON files are valid JSON (parse cleanly)
# ─────────────────────────────────────────────────────────────────────────────


def test_written_files_are_valid_json(tmp_path):
    paths = write_calibration_files(tmp_path)
    for p in paths.values():
        with open(p) as f:
            json.load(f)  # raises if invalid


# ─────────────────────────────────────────────────────────────────────────────
# Custom calibration override (for synthetic / real back-test runs)
# ─────────────────────────────────────────────────────────────────────────────


def test_custom_calibration_writes(tmp_path):
    """A custom curve passes through to disk."""
    custom_curve = [(-50, -2.0), (0, 0.0), (50, 2.0)]
    custom_table = {100: [(0, 60), (50, 80)]}
    paths = write_calibration_files(
        tmp_path,
        excess_curve=custom_curve,
        conviction_table=custom_table,
        source="synthetic_test",
    )
    loaded = load_calibration_from_dir(tmp_path)
    assert loaded["excess_return_curve"] == [(-50, -2.0), (0, 0.0), (50, 2.0)]
    assert loaded["conviction_table"] == {100: [(0, 60.0), (50, 80.0)]}
    assert loaded["metadata"]["conviction"]["source"] == "synthetic_test"
