#!/usr/bin/env python3
"""Self-test for score_trade_ideas.py, on synthetic history.

Why this exists: on the day the scorer shipped, all three published notes were
awaiting their entry close, so running it against real data proved nothing about
the logic that matters — entry selection, the invalidation stop, the horizon
close, and the excursion arithmetic. A scorer that is only exercised months
later, by the first call that goes wrong, is a scorer nobody should trust.

Run:  python scripts/test_score_trade_ideas.py
"""

import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_trade_ideas as S  # noqa: E402


def hist(**series):
    """{'key': [(iso, value), ...]} in the shape load_history returns."""
    return {k: sorted(v) for k, v in series.items()}


def days(start, values):
    """Consecutive weekdays from `start`, one value each."""
    d, out = dt.date.fromisoformat(start), []
    for v in values:
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        out.append((d.isoformat(), float(v)))
        d += dt.timedelta(days=1)
    return out


def idea(**kw):
    base = {"id": "x", "date": "2026-01-05", "kind": "equity", "title": "t",
            "instrument": "i", "position_type": "outright long",
            "scorecard": {"legs": [{"series": "px", "side": "long", "measure": "pct_change"}],
                          "horizon_months": 3}}
    base["scorecard"].update(kw.pop("scorecard", {}))
    base.update(kw)
    return base


class TestEntry(unittest.TestCase):
    def test_entry_is_first_close_on_or_after_publication(self):
        """Rule 1 — a Sunday note enters on the Monday close, never Friday's."""
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0), ("2026-01-06", 121.0)])
        r = S.score_one(idea(date="2026-01-03"), h, "2026-01-06")   # Saturday note
        self.assertEqual(r["entry_date"], "2026-01-05")
        self.assertEqual(r["legs"][0]["entry_value"], 110.0)
        self.assertAlmostEqual(r["mark"], 10.0, places=6)           # 110 -> 121

    def test_never_enters_before_publication(self):
        h = hist(px=days("2026-01-05", [100, 200, 300]))
        r = S.score_one(idea(date="2026-01-06"), h, "2026-01-07")
        self.assertEqual(r["legs"][0]["entry_value"], 200.0)

    def test_pending_when_no_close_yet(self):
        """Not a defect — the position exists, the tape has not printed."""
        h = hist(px=[("2026-01-02", 100.0)])
        r = S.score_one(idea(date="2026-01-05"), h, "2026-01-05")
        self.assertEqual(r["status"], "pending_entry")
        self.assertIn("2026-01-02", r["reason"])

    def test_missing_series_is_unscoreable_not_silent(self):
        r = S.score_one(idea(), hist(other=[("2026-01-05", 1.0)]), "2026-01-06")
        self.assertEqual(r["status"], "unscoreable")
        self.assertIn("not in indicator_history", r["reason"])

    def test_note_without_scorecard_is_reported_not_dropped(self):
        i = idea()
        del i["scorecard"]
        r = S.score_one(i, hist(px=days("2026-01-05", [1, 2])), "2026-01-06")
        self.assertEqual(r["status"], "unscoreable")


class TestDirection(unittest.TestCase):
    def test_short_leg_profits_when_series_falls(self):
        h = hist(px=days("2026-01-05", [100, 90]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "px", "side": "short"}]}), h, "2026-01-06")
        self.assertAlmostEqual(r["mark"], 10.0, places=6)

    def test_level_change_measure_reports_points_not_percent(self):
        """A breakeven going 2.30 -> 2.45 is +0.15pp, not +6.5%."""
        h = hist(be=days("2026-01-05", [2.30, 2.45]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "be", "side": "long",
                                                  "measure": "level_change"}]}), h, "2026-01-06")
        self.assertAlmostEqual(r["mark"], 0.15, places=6)
        self.assertEqual(r["unit"], "pp")

    def test_two_legs_are_weighted_and_netted(self):
        h = hist(a=days("2026-01-05", [100, 110]), b=days("2026-01-05", [100, 105]))
        r = S.score_one(idea(scorecard={"legs": [
            {"series": "a", "side": "long"}, {"series": "b", "side": "short"}]}), h, "2026-01-06")
        self.assertAlmostEqual(r["mark"], 5.0, places=6)   # +10 long, -5 short


class TestInvalidation(unittest.TestCase):
    def test_stop_closes_the_call_there_not_at_the_recovery(self):
        """Rule 3 — the whole point. Price craters through the stop, then
        rallies to a profit. The call is marked at the stop, at a loss."""
        h = hist(px=days("2026-01-05", [100, 95, 80, 90, 130]))
        r = S.score_one(idea(scorecard={"horizon_months": 6,
                                        "invalidation": {"series": "px", "op": "<=", "level": 85}}),
                        h, "2026-06-01")
        self.assertEqual(r["status"], "closed_invalidated")
        self.assertAlmostEqual(r["result"], -20.0, places=6)
        self.assertEqual(r["invalidation"]["date"], h["px"][2][0])
        self.assertLess(r["mark"], 0, "a stopped call must not be marked at the later rally")

    def test_setup_cannot_be_invalid_on_the_day_it_is_taken(self):
        h = hist(px=days("2026-01-05", [100, 101, 102]))
        r = S.score_one(idea(scorecard={"invalidation": {"series": "px", "op": "<=", "level": 100}}),
                        h, "2026-01-08")
        self.assertEqual(r["status"], "open")

    def test_weekly_close_basis_ignores_a_midweek_breach(self):
        """'A weekly close below 2.10' must not trigger on a Tuesday print."""
        # Mon..Fri, breaching only on the Tuesday
        h = hist(px=days("2026-01-05", [100, 80, 100, 100, 100]))
        r = S.score_one(idea(scorecard={"invalidation": {"series": "px", "op": "<=", "level": 85,
                                                         "basis": "weekly_close"}}), h, "2026-01-09")
        self.assertEqual(r["status"], "open")

    def test_weekly_close_basis_does_trigger_on_the_week_end(self):
        h = hist(px=days("2026-01-05", [100, 100, 100, 100, 80, 100]))
        r = S.score_one(idea(scorecard={"invalidation": {"series": "px", "op": "<=", "level": 85,
                                                         "basis": "weekly_close"}}), h, "2026-01-12")
        self.assertEqual(r["status"], "closed_invalidated")

    def test_unhit_stop_is_still_reported_so_the_rule_is_visible(self):
        h = hist(px=days("2026-01-05", [100, 105]))
        r = S.score_one(idea(scorecard={"invalidation": {"series": "px", "op": "<=", "level": 50}}),
                        h, "2026-01-06")
        self.assertIsNone(r["invalidation"]["date"])
        self.assertIn("px <= 50", r["invalidation"]["rule"])


class TestHorizonAndPath(unittest.TestCase):
    def test_closes_at_the_horizon_and_ignores_what_happened_after(self):
        h = hist(px=days("2026-01-05", [100] + [100] * 60 + [500] * 20))
        r = S.score_one(idea(scorecard={"horizon_months": 1}), h, "2026-06-01")
        self.assertEqual(r["status"], "closed_horizon")
        self.assertEqual(r["target_date"], "2026-02-05")
        self.assertLess(r["result"], 1.0, "the post-horizon spike must not be counted")

    def test_open_before_the_horizon(self):
        h = hist(px=days("2026-01-05", [100, 101]))
        r = S.score_one(idea(scorecard={"horizon_months": 6}), h, "2026-01-06")
        self.assertEqual(r["status"], "open")
        self.assertIsNone(r["result"])

    def test_excursions_record_the_path_not_just_the_destination(self):
        """Rule 4 — a call that was 20% underwater and finished flat."""
        h = hist(px=days("2026-01-05", [100, 130, 80, 100]))
        r = S.score_one(idea(scorecard={"horizon_months": 6}), h, "2026-01-09")
        self.assertAlmostEqual(r["max_favourable"]["value"], 30.0, places=6)
        self.assertAlmostEqual(r["max_adverse"]["value"], -20.0, places=6)
        self.assertAlmostEqual(r["mark"], 0.0, places=6)

    def test_benchmark_excess_is_the_difference(self):
        h = hist(px=days("2026-01-05", [100, 110]), bm=days("2026-01-05", [100, 104]))
        r = S.score_one(idea(scorecard={"benchmark": {"series": "bm"}}), h, "2026-01-06")
        self.assertAlmostEqual(r["benchmark"]["excess"], 6.0, places=6)


class TestSummaryDiscipline(unittest.TestCase):
    def test_no_hit_rate_below_the_threshold(self):
        """Rule 5 — three calls is not a track record."""
        rows = [{"id": str(i), "status": "closed_horizon", "result": 5.0} for i in range(3)]
        s = S.summarise(rows)
        self.assertTrue(s["stats_withheld"])
        self.assertNotIn("hit_rate", s)
        self.assertIn("mislead", s["stats_withheld_reason"])

    def test_hit_rate_appears_once_the_sample_exists(self):
        rows = [{"id": str(i), "status": "closed_horizon", "result": (5.0 if i < 7 else -3.0)}
                for i in range(S.MIN_CLOSED_FOR_STATS)]
        s = S.summarise(rows)
        self.assertFalse(s["stats_withheld"])
        self.assertEqual(s["hit_rate"], 70.0)

    def test_losers_and_unscoreables_are_counted_never_dropped(self):
        rows = ([{"id": "w", "status": "closed_horizon", "result": 9.0}]
                + [{"id": "l", "status": "closed_invalidated", "result": -9.0}]
                + [{"id": "u", "status": "unscoreable", "reason": "series gone"}])
        s = S.summarise(rows)
        self.assertEqual(s["published"], 3)
        self.assertEqual(s["closed"], 2)
        self.assertEqual(s["unscoreable"], 1)
        self.assertEqual(s["unscoreable_reasons"][0]["reason"], "series gone")


class TestRealFile(unittest.TestCase):
    def test_published_notes_all_carry_a_markable_scorecard(self):
        """Every live note must be scoreable — pending entry is fine, a broken
        or absent scorecard is not."""
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ideas_p = os.path.join(root, S.IDEAS_PATH)
        hist_p = os.path.join(root, S.HISTORY_PATH)
        if not (os.path.exists(ideas_p) and os.path.exists(hist_p)):
            self.skipTest("run from the repo root")
        with open(ideas_p, encoding="utf-8") as f:
            doc = json.load(f)
        h = S.load_history(hist_p)
        today = dt.date.today().isoformat()
        bad = [(i["date"], S.score_one(i, h, today)["reason"])
               for i in doc["ideas"] if S.score_one(i, h, today)["status"] == "unscoreable"]
        self.assertEqual(bad, [], f"unscoreable published notes: {bad}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
