"""Unit tests for asset_allocation/pipeline.py and monitoring/."""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from asset_allocation.pipeline import (
    PipelineRun, append_run_log, load_recent_runs,
)
from asset_allocation.monitoring.anomaly import (
    detect_anomalies, _flatten_ratings, _get_rl_value, TIER_ORDER,
)


# ──────────────────────────────────────────────────────────────────────────
# PipelineRun
# ──────────────────────────────────────────────────────────────────────────


def test_pipeline_run_starts_in_progress():
    run = PipelineRun(
        run_id="abc123",
        mode="weekly",
        started_at=datetime.now(timezone.utc).isoformat(),
        run_dir=Path("/tmp/x"),
    )
    assert run.exit_status == "in_progress"
    assert run.layers_completed == []
    assert run.warnings == []
    assert run.errors == []


def test_pipeline_run_finalize_success():
    run = PipelineRun("a", "weekly", "2026-04-26T00:00:00", Path("/tmp/x"))
    run.layers_completed = ["acquisition", "validation"]
    run.finalize()
    assert run.exit_status == "success"
    assert run.finished_at is not None


def test_pipeline_run_finalize_warnings_only():
    run = PipelineRun("a", "weekly", "2026-04-26T00:00:00", Path("/tmp/x"))
    run.log_warning("acquisition", "stale by 1 day")
    run.finalize()
    assert run.exit_status == "completed_with_warnings"


def test_pipeline_run_finalize_failure():
    run = PipelineRun("a", "weekly", "2026-04-26T00:00:00", Path("/tmp/x"))
    run.log_error("validation", "schema fail")
    run.finalize()
    assert run.exit_status == "failed"


def test_pipeline_run_to_dict_serializable():
    run = PipelineRun("a", "weekly", "2026-04-26T00:00:00", Path("/tmp/x"))
    d = run.to_dict()
    json.dumps(d)  # must be JSON-serializable
    assert d["run_dir"] == "/tmp/x"  # Path → str


# ──────────────────────────────────────────────────────────────────────────
# Run log
# ──────────────────────────────────────────────────────────────────────────


def test_append_and_load_run_log(tmp_path):
    log_path = tmp_path / "run_log.jsonl"
    run = PipelineRun("a", "weekly", "2026-04-26T00:00:00", tmp_path)
    run.layers_completed = ["acquisition"]
    run.finalize()
    append_run_log(run, log_path)

    runs = load_recent_runs(log_path)
    assert len(runs) == 1
    assert runs[0]["run_id"] == "a"
    assert runs[0]["exit_status"] == "success"


def test_load_recent_runs_returns_empty_when_no_log(tmp_path):
    assert load_recent_runs(tmp_path / "nonexistent.jsonl") == []


def test_load_recent_runs_respects_limit(tmp_path):
    log_path = tmp_path / "run_log.jsonl"
    for i in range(5):
        run = PipelineRun(f"r{i}", "weekly", "2026-04-26T00:00:00", tmp_path)
        run.finalize()
        append_run_log(run, log_path)
    out = load_recent_runs(log_path, limit=3)
    assert len(out) == 3
    assert [r["run_id"] for r in out] == ["r2", "r3", "r4"]


# ──────────────────────────────────────────────────────────────────────────
# Anomaly detection
# ──────────────────────────────────────────────────────────────────────────


def _make_alloc(stance: str = "Balanced", alpha: float = 1.0,
                leverage: float = 1.0, rl: float = 0.0,
                ratings: dict | None = None,
                regime_flip: bool = False) -> dict:
    return {
        "stance": {"label": stance},
        "headline": {"alpha": alpha, "leverage": leverage},
        "regime": {
            "risk_liquidity": {"value": rl, "label": "neutral"},
            "regime_flip_active": regime_flip,
        },
        "ratings": ratings or {"most_favored": [], "favored": [], "neutral": [],
                                "less_favored": [], "least_favored": []},
    }


def test_detect_anomalies_no_prior_returns_empty():
    cur = _make_alloc()
    assert detect_anomalies(cur, None) == []


def test_no_anomalies_when_nothing_changed():
    rating = {"neutral": [{"bucket": "Software", "rating": "Neutral"}]}
    cur = _make_alloc(ratings=rating)
    prior = _make_alloc(ratings=rating)
    assert detect_anomalies(cur, prior) == []


def test_rating_skip_flagged():
    cur = _make_alloc(ratings={"most_favored": [{"bucket": "Software", "rating": "Most Favored"}]})
    prior = _make_alloc(ratings={"least_favored": [{"bucket": "Software", "rating": "Least Favored"}]})
    anomalies = detect_anomalies(cur, prior)
    skip = [a for a in anomalies if a["type"] == "rating_skip"]
    assert len(skip) == 1
    assert "Software" in skip[0]["description"]


def test_rating_change_two_tiers_no_skip():
    """A 2-tier change (Neutral → Most Favored) is normal, not a skip."""
    cur = _make_alloc(ratings={"most_favored": [{"bucket": "Software", "rating": "Most Favored"}]})
    prior = _make_alloc(ratings={"neutral": [{"bucket": "Software", "rating": "Neutral"}]})
    anomalies = detect_anomalies(cur, prior)
    skip = [a for a in anomalies if a["type"] == "rating_skip"]
    assert skip == []


def test_stance_flip_without_rl_move_flagged():
    cur = _make_alloc(stance="Defensive", rl=10)
    prior = _make_alloc(stance="Aggressive", rl=-5)
    anomalies = detect_anomalies(cur, prior)
    flip = [a for a in anomalies if a["type"] == "stance_flip"]
    assert len(flip) == 1


def test_stance_flip_with_rl_move_not_flagged():
    """Stance flip with R&L moving > 20 points is justified."""
    cur = _make_alloc(stance="Defensive", rl=40)
    prior = _make_alloc(stance="Aggressive", rl=-5)
    anomalies = detect_anomalies(cur, prior)
    flip = [a for a in anomalies if a["type"] == "stance_flip"]
    assert flip == []


def test_leverage_discontinuity_flagged():
    cur = _make_alloc(leverage=1.4)
    prior = _make_alloc(leverage=1.0)
    anomalies = detect_anomalies(cur, prior)
    lev = [a for a in anomalies if a["type"] == "leverage_discontinuity"]
    assert len(lev) == 1


def test_leverage_small_change_not_flagged():
    cur = _make_alloc(leverage=1.05)
    prior = _make_alloc(leverage=1.0)
    anomalies = detect_anomalies(cur, prior)
    lev = [a for a in anomalies if a["type"] == "leverage_discontinuity"]
    assert lev == []


def test_extreme_alpha_high_flagged():
    cur = _make_alloc(alpha=1.45)
    anomalies = detect_anomalies(cur, _make_alloc())
    extreme = [a for a in anomalies if a["type"] == "extreme_alpha"]
    assert len(extreme) == 1


def test_extreme_alpha_low_flagged_as_warning():
    cur = _make_alloc(alpha=0.5)
    anomalies = detect_anomalies(cur, _make_alloc())
    extreme = [a for a in anomalies if a["type"] == "extreme_alpha"]
    assert len(extreme) == 1
    assert extreme[0]["severity"] == "warning"


def test_unexpected_regime_flip_flagged():
    cur = _make_alloc(rl=5, regime_flip=True)
    prior = _make_alloc(rl=0, regime_flip=False)
    anomalies = detect_anomalies(cur, prior)
    flip = [a for a in anomalies if a["type"] == "unexpected_regime_flip"]
    assert len(flip) == 1


def test_regime_flip_with_big_rl_move_not_flagged():
    """A regime flip with R&L moving > 10 points is justified."""
    cur = _make_alloc(rl=-15, regime_flip=True)
    prior = _make_alloc(rl=10, regime_flip=False)
    anomalies = detect_anomalies(cur, prior)
    flip = [a for a in anomalies if a["type"] == "unexpected_regime_flip"]
    assert flip == []


def test_mass_reshuffling_flagged():
    """5+ buckets changing rating in one rebalance is flagged."""
    prior_ratings = {"neutral": [{"bucket": f"B{i}", "rating": "Neutral"} for i in range(6)]}
    cur_ratings = {"most_favored": [{"bucket": f"B{i}", "rating": "Most Favored"} for i in range(6)]}
    cur = _make_alloc(ratings=cur_ratings)
    prior = _make_alloc(ratings=prior_ratings)
    anomalies = detect_anomalies(cur, prior)
    mass = [a for a in anomalies if a["type"] == "mass_reshuffling"]
    assert len(mass) == 1


# ──────────────────────────────────────────────────────────────────────────
# _flatten_ratings
# ──────────────────────────────────────────────────────────────────────────


def test_flatten_ratings_compute_layer_shape():
    """Compute-layer ratings is a flat list."""
    alloc = {"ratings": [
        {"bucket_name": "Software", "rating": "Most Favored"},
        {"bucket_name": "Banks", "rating": "Neutral"},
    ]}
    out = _flatten_ratings(alloc)
    assert out == {"Software": "Most Favored", "Banks": "Neutral"}


def test_flatten_ratings_output_layer_shape():
    """Output-layer ratings is a tier dict."""
    alloc = {"ratings": {
        "most_favored": [{"bucket": "Software", "rating": "Most Favored"}],
        "neutral": [{"bucket": "Banks", "rating": "Neutral"}],
        "favored": [], "less_favored": [], "least_favored": [],
    }}
    out = _flatten_ratings(alloc)
    assert out == {"Software": "Most Favored", "Banks": "Neutral"}


def test_get_rl_value_dict_form():
    alloc = {"regime": {"risk_liquidity": {"value": -6.7, "label": "calm"}}}
    assert _get_rl_value(alloc) == -6.7


def test_get_rl_value_scalar_form():
    alloc = {"regime": {"risk_liquidity": -6.7}}
    assert _get_rl_value(alloc) == -6.7


def test_get_rl_value_missing():
    assert _get_rl_value({}) == 0.0
