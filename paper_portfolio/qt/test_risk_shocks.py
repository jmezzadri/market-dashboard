"""Shock scenarios with the crash brake replayed. python3 -m pytest paper_portfolio/qt/test_risk_shocks.py -q

Pins the replay to the repo's own MOVE and S&P 500 history so a change to the
brake rule, the percentile maths or the episode windows shows up here first.
"""
import json
from pathlib import Path

import pandas as pd
import pytest

from paper_portfolio.qt.risk import EPISODES, brake_states, shock_with_brake

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def hist():
    h = json.loads((REPO / "public" / "indicator_history.json").read_text())
    s = lambda k: pd.Series({pd.Timestamp(d): float(v) for d, v in h[k]["points"] if v is not None}).sort_index()
    return s("move"), s("spx_index")


def test_brake_is_off_until_a_window_exists(hist):
    move, _ = hist
    st = brake_states(move)
    assert not st.iloc[:300].any()


def test_brake_replay_cuts_the_three_coverable_episodes(hist):
    move, spx = hist
    st = brake_states(move)
    got = {sid: shock_with_brake(spx, st, 1.0, a, b) for sid, _, a, b in EPISODES}
    assert got["tech"] is None                     # no MOVE before Nov 2002, no S&P before 2006
    for sid in ("gfc", "covid", "y2022"):
        r = got[sid]
        assert r["index"] < -0.2
        assert r["book_brake"] > r["book"]         # less negative: the brake helps in every covered crash
        assert 0 <= r["sessions_in_cash"] <= r["sessions"]
    # 2022: the brake had been on since late 2021, so the book sat in cash for the whole fall
    assert got["y2022"]["sessions_in_cash"] == got["y2022"]["sessions"]
    assert got["y2022"]["book_brake"] == 0.0
    # 2020: on after the 28 Feb close, took the first week and sat out the rest
    assert -0.16 < got["covid"]["book_brake"] < -0.10
    # 2008: three on/off cycles; caught Lehman, re-entered before the final leg
    assert -0.40 < got["gfc"]["book_brake"] < -0.30


def test_beta_scales_the_no_brake_figure_only_linearly(hist):
    move, spx = hist
    st = brake_states(move)
    one = shock_with_brake(spx, st, 1.0, "2020-02-19", "2020-03-23")
    two = shock_with_brake(spx, st, 1.03, "2020-02-19", "2020-03-23")
    assert abs(two["book"] - 1.03 * one["index"]) < 1e-12
