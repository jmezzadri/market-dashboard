"""Unit tests for asset_allocation/state.py."""

import json
from pathlib import Path

import pytest

from asset_allocation.state import (
    append_allocation,
    list_history,
    find_prior_allocation,
    compute_deltas,
    attach_state,
)


def _make_allocation(as_of: str, ratings: list[dict] = None,
                     stance: str = "Balanced", leverage: float = 1.0) -> dict:
    """Helper — minimal allocation dict for testing."""
    return {
        "as_of": as_of,
        "schema_version": "v10.0",
        "stance": {"label": stance},
        "leverage": leverage,
        "alpha": leverage,
        "equity_share": 1.0,
        "ratings": ratings or [],
    }


def _make_rating(bucket: str, rating: str = "Neutral",
                 is_picked: bool = False) -> dict:
    return {
        "bucket_name": bucket,
        "display_name": bucket,
        "rating": rating,
        "is_picked": is_picked,
        "weight": 0.2 if is_picked else 0.0,
    }


# ──────────────────────────────────────────────────────────────────────────
# Storage
# ──────────────────────────────────────────────────────────────────────────


def test_append_allocation_creates_file(tmp_path):
    alloc = _make_allocation("2026-04-26")
    path = append_allocation(alloc, tmp_path)
    assert path.exists()
    assert path.name == "allocation_2026-04-26.json"


def test_append_allocation_idempotent(tmp_path):
    """Appending same as_of date twice overwrites, doesn't duplicate."""
    alloc1 = _make_allocation("2026-04-26", stance="Balanced")
    alloc2 = _make_allocation("2026-04-26", stance="Aggressive")
    append_allocation(alloc1, tmp_path)
    append_allocation(alloc2, tmp_path)
    assert len(list(tmp_path.glob("allocation_*.json"))) == 1
    saved = json.loads((tmp_path / "allocation_2026-04-26.json").read_text())
    assert saved["stance"]["label"] == "Aggressive"


def test_append_allocation_requires_as_of(tmp_path):
    with pytest.raises(ValueError, match="as_of"):
        append_allocation({}, tmp_path)


def test_list_history_sorted_ascending(tmp_path):
    for d in ["2026-04-26", "2026-04-12", "2026-04-19", "2026-04-05"]:
        append_allocation(_make_allocation(d), tmp_path)
    history = list_history(tmp_path)
    dates = [p.stem.replace("allocation_", "") for p in history]
    assert dates == sorted(dates)


def test_list_history_empty(tmp_path):
    assert list_history(tmp_path) == []


# ──────────────────────────────────────────────────────────────────────────
# find_prior_allocation
# ──────────────────────────────────────────────────────────────────────────


def test_find_prior_allocation_returns_none_when_no_history(tmp_path):
    result = find_prior_allocation("2026-04-26", tmp_path)
    assert result is None


def test_find_prior_allocation_returns_none_when_only_future_snapshots(tmp_path):
    """Snapshots dated AFTER the target shouldn't be returned."""
    append_allocation(_make_allocation("2026-05-15"), tmp_path)
    result = find_prior_allocation("2026-04-26", tmp_path)
    assert result is None


def test_find_prior_allocation_finds_4_weeks_back(tmp_path):
    """Default weeks_back=4 should find a snapshot ~4 weeks prior."""
    append_allocation(_make_allocation("2026-03-29"), tmp_path)  # ~4 weeks before
    result = find_prior_allocation("2026-04-26", tmp_path, weeks_back=4)
    assert result is not None
    assert result["as_of"] == "2026-03-29"


def test_find_prior_allocation_picks_closest_to_target(tmp_path):
    """When multiple snapshots are prior, pick the one CLOSEST to target_back_dt."""
    # weeks_back=4 → target is 2026-03-29
    # add candidates at various distances
    append_allocation(_make_allocation("2026-04-10"), tmp_path)  # too recent (16 days off)
    append_allocation(_make_allocation("2026-03-29"), tmp_path)  # exact match
    append_allocation(_make_allocation("2026-03-01"), tmp_path)  # too far back (28 days off)
    result = find_prior_allocation("2026-04-26", tmp_path, weeks_back=4)
    assert result["as_of"] == "2026-03-29"


def test_find_prior_allocation_returns_none_when_too_far_off(tmp_path):
    """If the closest snapshot is more than 2x weeks_back away, return None."""
    # weeks_back=1 → target is 2026-04-19; tolerance 14 days
    # Only snapshot is 2026-01-01 — too far away
    append_allocation(_make_allocation("2026-01-01"), tmp_path)
    result = find_prior_allocation("2026-04-26", tmp_path, weeks_back=1)
    assert result is None


# ──────────────────────────────────────────────────────────────────────────
# compute_deltas
# ──────────────────────────────────────────────────────────────────────────


def test_compute_deltas_no_prior_returns_empty():
    cur = _make_allocation("2026-04-26")
    assert compute_deltas(cur, None) == []


def test_compute_deltas_no_changes_returns_empty():
    rating = [_make_rating("Software", "Most Favored", is_picked=True)]
    cur = _make_allocation("2026-04-26", ratings=rating, stance="Balanced", leverage=1.0)
    prior = _make_allocation("2026-04-19", ratings=rating, stance="Balanced", leverage=1.0)
    assert compute_deltas(cur, prior) == []


def test_compute_deltas_promotion():
    cur_rating = [_make_rating("Energy", "Most Favored", is_picked=True)]
    prior_rating = [_make_rating("Energy", "Neutral", is_picked=False)]
    cur = _make_allocation("2026-04-26", ratings=cur_rating)
    prior = _make_allocation("2026-04-19", ratings=prior_rating)
    deltas = compute_deltas(cur, prior)
    promotion = [d for d in deltas if d["type"] == "promotion"]
    assert len(promotion) == 1
    assert promotion[0]["from"] == "Neutral"
    assert promotion[0]["to"] == "Most Favored"


def test_compute_deltas_demotion():
    cur = _make_allocation("2026-04-26", ratings=[_make_rating("Software", "Less Favored")])
    prior = _make_allocation("2026-04-19", ratings=[_make_rating("Software", "Most Favored", is_picked=True)])
    deltas = compute_deltas(cur, prior)
    demotion = [d for d in deltas if d["type"] == "demotion"]
    assert len(demotion) == 1
    assert demotion[0]["from"] == "Most Favored"
    assert demotion[0]["to"] == "Less Favored"


def test_compute_deltas_pick_change():
    cur = _make_allocation("2026-04-26", ratings=[_make_rating("Energy", "Most Favored", is_picked=True)])
    prior = _make_allocation("2026-04-19", ratings=[_make_rating("Energy", "Most Favored", is_picked=False)])
    deltas = compute_deltas(cur, prior)
    added = [d for d in deltas if d["type"] == "added_to_picks"]
    assert len(added) == 1
    assert added[0]["bucket"] == "Energy"


def test_compute_deltas_stance_change():
    cur = _make_allocation("2026-04-26", stance="Aggressive")
    prior = _make_allocation("2026-04-19", stance="Balanced")
    deltas = compute_deltas(cur, prior)
    stance_changes = [d for d in deltas if d["type"] == "stance_change"]
    assert len(stance_changes) == 1
    assert stance_changes[0]["from"] == "Balanced"
    assert stance_changes[0]["to"] == "Aggressive"


def test_compute_deltas_leverage_change():
    cur = _make_allocation("2026-04-26", leverage=1.3)
    prior = _make_allocation("2026-04-19", leverage=1.0)
    deltas = compute_deltas(cur, prior)
    lev = [d for d in deltas if d["type"] == "leverage_change"]
    assert len(lev) == 1
    assert lev[0]["magnitude"] == 0.3


def test_compute_deltas_small_leverage_change_ignored():
    """Leverage moves under 0.05x are noise — shouldn't appear in the UI."""
    cur = _make_allocation("2026-04-26", leverage=1.02)
    prior = _make_allocation("2026-04-19", leverage=1.0)
    deltas = compute_deltas(cur, prior)
    lev = [d for d in deltas if d["type"] == "leverage_change"]
    assert lev == []


# ──────────────────────────────────────────────────────────────────────────
# attach_state — end-to-end
# ──────────────────────────────────────────────────────────────────────────


def test_attach_state_first_run_no_prior(tmp_path):
    """First-ever run: no prior allocations → empty deltas, fresh history."""
    cur = _make_allocation("2026-04-26", ratings=[_make_rating("Software", "Most Favored")])
    out = attach_state(cur, tmp_path)
    assert out["what_changed"]["vs_last_rebalance"] == []
    assert out["what_changed"]["vs_last_month"] == []
    assert out["what_changed"]["vs_last_quarter"] == []
    assert (tmp_path / "allocation_2026-04-26.json").exists()


def test_attach_state_with_prior_produces_deltas(tmp_path):
    prior = _make_allocation("2026-04-19", ratings=[_make_rating("Software", "Neutral")])
    append_allocation(prior, tmp_path)
    cur = _make_allocation("2026-04-26", ratings=[_make_rating("Software", "Most Favored", is_picked=True)])
    out = attach_state(cur, tmp_path)
    rebal = out["what_changed"]["vs_last_rebalance"]
    assert any(d["type"] == "promotion" and d["bucket"] == "Software" for d in rebal)
