#!/usr/bin/env python3
"""Tests for daily_thesis_check.py (LESSONS 6.28). Standard library only."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily_thesis_check as D  # noqa: E402


def days(start, vals):
    d, out = dt.date.fromisoformat(start), []
    for v in vals:
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        out.append((d.isoformat(), float(v)))
        d += dt.timedelta(days=1)
    return out


# The Oct 22 credit note, in miniature: 267 at the start, 333 at publication,
# 340 at the peak, 314 now — the level test (>= 300) passes, the give-back
# test (36% of a 73bp move against a one-third limit) trips.
HY = days("2026-09-08", [267] * 30 + [333, 327, 340, 338, 330, 318, 314])
PUB = HY[30][0]
TODAY = HY[-1][0]
IDEA = {"id": "n1", "date": PUB, "title": "Credit note",
        "review_conditions": [{"claim": "Credit stays wide", "critical": True,
                               "check": {"series": "hy", "op": ">=", "level": 300},
                               "driver": {"series": "hy", "direction": "up",
                                          "move_start": {"date": HY[0][0], "value": 267}}}]}
SCORES = {"scores": [{"id": "n1", "status": "open"}]}


class T(unittest.TestCase):
    def test_level_holds_but_giveback_trips(self):
        doc = D.run([IDEA], SCORES, {"hy": HY}, {}, TODAY)
        c = doc["calls"][0]
        self.assertEqual(c["conditions"][0]["check"]["status"], "holds")
        self.assertEqual(c["conditions"][0]["driver"]["status"], "broken")
        self.assertAlmostEqual(c["conditions"][0]["driver"]["given_back_pct"], 35.6, places=1)
        self.assertTrue(c["tripped"])
        self.assertEqual(doc["tripped"], ["n1"])

    def test_giveback_under_the_limit_holds(self):
        hy = HY[:-2] + [(HY[-2][0], 330.0), (HY[-1][0], 325.0)]   # 15/73 = 21%
        c = D.run([IDEA], SCORES, {"hy": hy}, {}, TODAY)["calls"][0]
        self.assertFalse(c["tripped"])

    def test_broken_critical_level_trips(self):
        hy = HY[:-1] + [(HY[-1][0], 290.0)]
        c = D.run([IDEA], SCORES, {"hy": hy}, {}, TODAY)["calls"][0]
        self.assertEqual(c["conditions"][0]["check"]["status"], "broken")
        self.assertIn("cond0", [r["key"] for r in c["trip_reasons"]])

    def test_broken_non_critical_level_is_reported_not_tripped(self):
        idea = {**IDEA, "review_conditions": [{**IDEA["review_conditions"][0], "critical": False, "driver": None}]}
        hy = HY[:-1] + [(HY[-1][0], 290.0)]
        c = D.run([idea], SCORES, {"hy": hy}, {}, TODAY)["calls"][0]
        self.assertFalse(c["tripped"])
        self.assertTrue(any("BROKEN" in ln for ln in c["lines"]))

    def test_stale_reading_never_passes_silently(self):
        far = (dt.date.fromisoformat(TODAY) + dt.timedelta(days=14)).isoformat()
        c = D.run([IDEA], SCORES, {"hy": HY}, {}, far)["calls"][0]
        self.assertEqual(c["conditions"][0]["check"]["status"], "stale")

    def test_sidecar_supplies_the_machine_form_for_older_notes(self):
        old = {"id": "n1", "date": PUB, "title": "Credit note",
               "review_conditions": [{"claim": "Credit stays wide", "critical": True}]}
        side = {"n1": {"conditions": [{"check": IDEA["review_conditions"][0]["check"],
                                       "driver": IDEA["review_conditions"][0]["driver"]}]}}
        self.assertTrue(D.run([old], SCORES, {"hy": HY}, side, TODAY)["calls"][0]["tripped"])

    def test_closed_calls_are_not_checked(self):
        doc = D.run([IDEA], {"scores": [{"id": "n1", "status": "closed_thesis"}]}, {"hy": HY}, {}, TODAY)
        self.assertEqual(doc["calls"], [])

    def test_a_call_with_no_machine_form_says_so(self):
        old = {"id": "n1", "date": PUB, "title": "x"}
        c = D.run([old], SCORES, {"hy": HY}, {}, TODAY)["calls"][0]
        self.assertEqual(c["coverage"], "none")

    def test_percentile_and_200_day_transforms(self):
        s = days("2024-01-01", list(range(1, 801)))
        self.assertEqual(D.transformed(s, "pctile_3y")[-1][1], 100.0)
        self.assertGreater(D.transformed(s, "pct_vs_200d")[-1][1], 0)

    def test_spec_validation(self):
        with self.assertRaises(D.CheckError):
            D.validate_check({"series": "hy", "op": "=>", "level": 1}, "x")
        with self.assertRaises(D.CheckError):
            D.validate_driver({"series": "hy", "direction": "sideways", "move_start": {"date": "2026-01-01", "value": 1}}, "x")
        with self.assertRaises(D.CheckError):
            D.validate_driver({"series": "hy", "direction": "up", "move_start": {"date": "2026-01-01", "value": 1}, "max_giveback": 0.9}, "x")
        with self.assertRaises(D.CheckError):
            D.validate_check({"series": "nope", "op": ">=", "level": 1}, "x", series_known={"hy"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
