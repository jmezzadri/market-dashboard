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
    # Default published_at is AFTER the publication day's close (22:00 UTC),
    # so entry is that day's own close and the direction / invalidation /
    # horizon suites below can assume entry == first bar. TestEntry passes its
    # own stamps to exercise the mid-session and Sunday cases explicitly.
    base = {"id": "x", "date": "2026-01-05", "published_at": "2026-01-05T22:00:00Z",
            "kind": "equity", "title": "t",
            "instrument": "i", "position_type": "outright long",
            "scorecard": {"legs": [{"series": "px", "side": "long", "measure": "pct_change"}],
                          "horizon_months": 3}}
    base["scorecard"].update(kw.pop("scorecard", {}))
    base.update(kw)
    return base


class TestEntry(unittest.TestCase):
    """Rule 1 — entry is the last close that had SETTLED when the note went out.

    The regression these guard against is the one Joe caught on 2026-08-18: the
    original rule ("first close on or after the publish date") silently threw
    away the first full session of every note published outside market hours,
    so three live calls showed no performance four days in."""

    def test_note_published_midsession_enters_at_the_previous_close(self):
        """The equity note went out 11:01 AM ET Monday. Monday's close did not
        exist yet, so the reader was looking at Friday's — and Monday's move is
        part of the call, not excluded from it."""
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0), ("2026-01-06", 121.0)])
        r = S.score_one(idea(date="2026-01-05", published_at="2026-01-05T15:00:00Z"), h, "2026-01-06")
        self.assertEqual(r["entry_date"], "2026-01-02")
        self.assertEqual(r["legs"][0]["entry_value"], 100.0)
        self.assertAlmostEqual(r["mark"], 21.0, places=6)   # 100 -> 121, Monday INCLUDED

    def test_sunday_note_enters_at_fridays_close(self):
        """The rates note went out 7:28 PM ET Sunday. Friday's close is the
        last price that existed; Monday's whole session belongs to the call."""
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0)])
        r = S.score_one(idea(date="2026-01-04", published_at="2026-01-04T23:28:45Z"), h, "2026-01-05")
        self.assertEqual(r["entry_date"], "2026-01-02")
        self.assertAlmostEqual(r["mark"], 10.0, places=6)

    def test_note_published_after_the_close_enters_at_that_close(self):
        """Published 10 PM UTC — the day's close has settled, so it is the entry."""
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0), ("2026-01-06", 121.0)])
        r = S.score_one(idea(date="2026-01-05", published_at="2026-01-05T22:00:00Z"), h, "2026-01-06")
        self.assertEqual(r["entry_date"], "2026-01-05")
        self.assertAlmostEqual(r["mark"], 10.0, places=6)

    def test_close_minutes_old_is_refused_conservatively(self):
        """4:30 PM ET (20:30 UTC) is before the 21:00 cutoff: futures and FX
        have not settled, so the note takes the previous close rather than
        claiming a settle it could not have seen."""
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0)])
        r = S.score_one(idea(date="2026-01-05", published_at="2026-01-05T20:30:00Z"), h, "2026-01-06")
        self.assertEqual(r["entry_date"], "2026-01-02")

    def test_entry_can_never_be_a_price_published_after_the_note(self):
        """The anti-cherry-pick property: no matter how good a later print
        looks, the lookup walks BACKWARDS from the publication stamp."""
        h = hist(px=days("2026-01-05", [100, 500, 900]))
        r = S.score_one(idea(date="2026-01-06", published_at="2026-01-06T15:00:00Z"), h, "2026-01-08")
        self.assertEqual(r["legs"][0]["entry_value"], 100.0)

    def test_missing_published_at_falls_back_to_the_prior_close(self):
        h = hist(px=[("2026-01-02", 100.0), ("2026-01-05", 110.0)])
        i = idea(date="2026-01-05"); del i["published_at"]
        r = S.score_one(i, h, "2026-01-06")
        self.assertEqual(r["entry_date"], "2026-01-02")

    def test_pending_when_no_close_predates_publication(self):
        h = hist(px=[("2026-02-01", 100.0)])
        r = S.score_one(idea(date="2026-01-05"), h, "2026-02-02")
        self.assertEqual(r["status"], "pending_entry")
        self.assertIn("no settled close", r["reason"])

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

    def test_level_change_is_no_longer_a_legal_leg_measure(self):
        """Retired 2026-08-18. A raw spread move is not a return: it cannot be
        netted against another leg, sized to a risk budget, or compared to a
        benchmark. The old behaviour printed '+0.01pp' beside equity returns in
        per cent and invited exactly the comparison it could not support, so it
        now fails loudly with the fix in the message."""
        h = hist(be=days("2026-01-05", [2.30, 2.45]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "be", "side": "long",
                                                  "measure": "level_change"}]}), h, "2026-01-06")
        self.assertEqual(r["status"], "unscoreable")
        self.assertIn("not a return", r["reason"])
        self.assertIn("bond_return", r["reason"])

    def test_a_yield_leg_becomes_a_price_return_via_duration(self):
        """A 10y at 4.72% has a modified duration of 7.899, so +10bp is -0.79%.

        Both figures are cross-checked against the textbook route (Macaulay
        duration of a par bond, then divided by 1 + y/2): 8.0851 -> 7.8987 and
        8.9337 -> 8.8260. The closed form in the scorer agrees to four decimals.
        An earlier version of this test asserted 7.856 from mental arithmetic
        and the CODE was right — which is the whole reason the expected values
        here are derived rather than remembered."""
        self.assertAlmostEqual(S.modified_duration(4.72, 10), 7.8987, places=3)
        self.assertAlmostEqual(S.modified_duration(2.44, 10), 8.8260, places=3)
        h = hist(y=days("2026-01-05", [4.72, 4.82]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "y", "side": "long",
                                                  "measure": "bond_return",
                                                  "maturity_years": 10}]}), h, "2026-01-06")
        self.assertEqual(r["unit"], "%")
        self.assertAlmostEqual(r["legs"][0]["return_pct"], -0.7899, places=3)

    def test_bond_leg_without_a_maturity_is_unscoreable(self):
        """Duration cannot be inferred from a yield alone — refuse, don't guess."""
        h = hist(y=days("2026-01-05", [4.72, 4.82]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "y", "side": "long",
                                                  "measure": "bond_return"}]}), h, "2026-01-06")
        self.assertEqual(r["status"], "unscoreable")
        self.assertIn("maturity_years", r["reason"])

    def test_both_sides_are_reported_and_netted(self):
        """Joe 2026-08-18: show what we said to buy, what we said to sell, and
        the net — not one opaque number off a pre-computed ratio."""
        h = hist(a=days("2026-01-05", [100, 102]), b=days("2026-01-05", [100, 101]))
        r = S.score_one(idea(scorecard={"legs": [
            {"series": "a", "side": "long", "measure": "pct_change"},
            {"series": "b", "side": "short", "measure": "pct_change"}]}), h, "2026-01-06")
        self.assertAlmostEqual(r["buy_pct"], 2.0, places=6)
        self.assertAlmostEqual(r["sell_pct"], 1.0, places=6)
        self.assertAlmostEqual(r["net_unlevered_pct"], 1.0, places=6)

    def test_size_falls_back_to_1x_when_vol_cannot_be_measured(self):
        """Two observations is not a volatility. Say so, size at 1x, and record
        the reason — never invent a multiple off three days of data."""
        h = hist(a=days("2026-01-05", [100, 102]))
        r = S.score_one(idea(scorecard={"legs": [{"series": "a", "side": "long",
                                                  "measure": "pct_change"}]}), h, "2026-01-06")
        self.assertEqual(r["sizing"]["multiple"], 1.0)
        self.assertEqual(r["sizing"]["method"], "none")
        self.assertIn("reason", r["sizing"])
        self.assertAlmostEqual(r["mark"], r["net_unlevered_pct"], places=6)

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

    def test_benchmark_difference_is_the_gap_to_the_passive_alternative(self):
        h = hist(px=days("2026-01-05", [100, 110]), bm=days("2026-01-05", [100, 104]))
        r = S.score_one(idea(scorecard={"benchmark": {"series": "bm"}}), h, "2026-01-06")
        self.assertAlmostEqual(r["benchmark"]["difference"], 6.0, places=6)


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
