"""Guard rails for the brake's pure logic. python3 -m pytest paper_portfolio/qt/test_brake.py -q"""
from paper_portfolio.qt.brake import pct_rank_last, hyg_drawdown_series, composite, next_state

def test_hysteresis_cannot_flap():
    seq = [(0.50, False), (0.81, True), (0.75, True), (0.70, True), (0.64, False), (0.79, False), (0.81, True)]
    was = False
    for comp, expect in seq:
        was = next_state(comp, was, on=0.80, off=0.65)
        assert was == expect, f"comp={comp}"

def test_percentile_extremes():
    vals = list(range(100))
    assert abs(pct_rank_last(vals, 100) - 0.995) < 1e-9
    assert abs(pct_rank_last(list(reversed(vals)), 100) - 0.005) < 1e-9
    assert pct_rank_last([7.0]*100, 100) == 0.5   # flat = neutral, never max

def test_drawdown_series():
    dd = hyg_drawdown_series([100, 90, 95, 100, 80])
    assert dd[0] == 0.0
    assert abs(dd[1] - 0.10) < 1e-9
    assert abs(dd[4] - 0.20) < 1e-9

def test_composite_calm_vs_stressed():
    calm_vix = [15]*800; calm_hyg = [100.0]*800
    assert composite(calm_vix, calm_hyg) < 0.80          # calm never trips ON by itself
    stressed_vix = [15]*799 + [60]
    crash_hyg = [100.0]*790 + [100 - i*1.5 for i in range(10)]
    assert composite(stressed_vix, crash_hyg) > 0.80     # spike + credit crack trips
