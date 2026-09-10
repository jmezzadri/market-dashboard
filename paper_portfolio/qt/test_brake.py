"""Guard rails for the brake's pure logic. python3 -m pytest paper_portfolio/qt/test_brake.py -q"""
from paper_portfolio.qt.brake import pct_rank_last, stress, next_state


def test_flat_series_is_neutral_not_extreme():
    # Counting "<=" made a flat series read as the 100th percentile; midrank ties fix that.
    assert abs(pct_rank_last([100.0] * 300, 300) - 0.5) < 1e-9


def test_stress_calm_vs_panic():
    calm = [80.0 + (i % 7) for i in range(1500)]
    assert stress(calm + [60.0]) < 0.05
    assert stress(calm + [200.0]) > 0.95


def test_two_readings_needed_to_switch_on():
    assert next_state(0.97, None, False, 0.95, 0.80) is False      # first day above: not yet
    assert next_state(0.97, 0.90, False, 0.95, 0.80) is False      # prior was below the line
    assert next_state(0.97, 0.96, False, 0.95, 0.80) is True       # two in a row: on


def test_hysteresis_band_holds_state():
    assert next_state(0.90, 0.90, True, 0.95, 0.80) is True        # inside the band: stays on
    assert next_state(0.90, 0.90, False, 0.95, 0.80) is False      # inside the band: stays off
    assert next_state(0.79, 0.90, True, 0.95, 0.80) is False       # one reading below OFF: off


def test_not_enough_history_refuses():
    import pytest
    with pytest.raises(ValueError):
        pct_rank_last([1.0] * 10, 1260)
