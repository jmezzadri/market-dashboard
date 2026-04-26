"""Unit tests for asset_allocation/output.py."""

import json
from pathlib import Path

import pytest

from asset_allocation.output import shape_for_ui, _classify_composite
from asset_allocation.validation import validate_against_schema_file


def _make_compute_allocation() -> dict:
    """Minimal compute-layer allocation for shape_for_ui to consume."""
    return {
        "schema_version": "v10.0",
        "as_of": "2026-04-26",
        "calculated_at": "2026-04-26T18:30:00+00:00",
        "regime": {
            "risk_liquidity": -6.7,
            "growth": 1.4,
            "inflation_rates": -14.2,
            "rl_3mo_change": 12.8,
            "regime_flip_active": False,
        },
        "stance": {"label": "Aggressive", "color": "calm", "description": "test"},
        "alpha": 1.276,
        "equity_share": 1.0,
        "leverage": 1.276,
        "financing_drag_monthly": 0.001,
        "selection_confidence": "STRONG",
        "ratings": [
            {
                "ticker": "SOXX", "bucket_name": "Semiconductors",
                "display_name": "Semiconductors",
                "gics_path": "Information Technology → Semiconductors",
                "examples": ["Nvidia", "Broadcom", "AMD"],
                "calibration_etf": "SOXX",
                "implementation_notes": "Cap-weighted exposure",
                "kill_factors": ["industrial_prod"],
                "rating": "Most Favored",
                "indicator_score": 1.5, "momentum_score": 2.0,
                "combined_score": 3.5,
                "expected_return_monthly": 0.025,
                "trailing_6mo_return": 0.18,
                "is_picked": True,
                "weight": 0.255,
            },
            {
                "ticker": "XLU", "bucket_name": "Utilities",
                "display_name": "Utilities",
                "gics_path": "Utilities",
                "examples": ["NextEra", "Southern", "Duke"],
                "calibration_etf": "XLU",
                "implementation_notes": "Bond proxy",
                "kill_factors": ["term_premium"],
                "rating": "Least Favored",
                "indicator_score": -1.0, "momentum_score": -1.5,
                "combined_score": -2.5,
                "expected_return_monthly": 0.005,
                "trailing_6mo_return": 0.02,
                "is_picked": False,
                "weight": 0.0,
            },
        ],
        "defensive": [
            {"ticker": "BIL", "weight": 0.0, "weight_within_defensive": 0.27},
            {"ticker": "TLT", "weight": 0.0, "weight_within_defensive": 0.0},
            {"ticker": "GLD", "weight": 0.0, "weight_within_defensive": 0.7},
            {"ticker": "LQD", "weight": 0.0, "weight_within_defensive": 0.03},
        ],
        "spy_comparison": None,
    }


def test_shape_for_ui_produces_schema_valid_output():
    """The shaped output must validate against allocation_output.schema.json."""
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    errors = validate_against_schema_file(output, "allocation_output.schema.json")
    assert errors == [], f"schema errors: {errors}"


def test_shape_for_ui_organizes_ratings_by_tier():
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    assert len(output["ratings"]["most_favored"]) == 1
    assert output["ratings"]["most_favored"][0]["display_name"] == "Semiconductors"
    assert len(output["ratings"]["least_favored"]) == 1
    assert output["ratings"]["least_favored"][0]["display_name"] == "Utilities"


def test_shape_for_ui_includes_methodology():
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    assert output["methodology"]["version"] == "v10"
    assert output["methodology"]["back_test"]["cagr"] > 0


def test_shape_for_ui_includes_implementation_guidance():
    """Static implementation copy must be present in the output."""
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    assert len(output["implementation"]["guidance_paragraphs"]) >= 2
    assert "ETF" in output["implementation"]["guidance_paragraphs"][0]


def test_shape_for_ui_defensive_inactive_when_all_zero():
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    assert output["defensive"]["active"] is False


def test_shape_for_ui_defensive_active_when_weight_positive():
    alloc = _make_compute_allocation()
    alloc["defensive"][0]["weight"] = 0.15
    output = shape_for_ui(alloc)
    assert output["defensive"]["active"] is True


def test_shape_for_ui_phase4_fields_empty():
    """Narrative + themes + risk scenarios + key_factors are filled in Phase 4.
    For now they're present but empty."""
    alloc = _make_compute_allocation()
    output = shape_for_ui(alloc)
    assert output["macro_narrative"] == []
    assert output["themes"] == []
    assert output["risk_scenarios"] == []
    for tier in output["ratings"].values():
        for entry in tier:
            assert entry["rationale"] == ""
            assert entry["key_factors"] == []


def test_classify_composite_rl():
    assert _classify_composite(-20, "rl") == "calm"
    assert _classify_composite(0, "rl") == "neutral"
    assert _classify_composite(25, "rl") == "elevated"
    assert _classify_composite(50, "rl") == "stressed"


def test_classify_composite_growth():
    assert _classify_composite(-15, "growth") == "supportive"
    assert _classify_composite(0, "growth") == "neutral"
    assert _classify_composite(30, "growth") == "weakening"


def test_classify_composite_ir():
    assert _classify_composite(-15, "ir") == "cool"
    assert _classify_composite(0, "ir") == "neutral"
    assert _classify_composite(30, "ir") == "hot"
