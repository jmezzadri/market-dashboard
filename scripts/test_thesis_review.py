#!/usr/bin/env python3
"""Self-test for thesis_review.py, on synthetic history.

Same reason as test_score_trade_ideas.py: the rules that make the weekly
review trustworthy — the verdict following from the checks, the called-for
return frozen after the first review, a broken verdict closing the call — are
exactly the rules a later session would be tempted to bend. They are tested
here before any real review exists, so the first review that goes wrong is
not the first time the contract is exercised.

Run:  python scripts/test_thesis_review.py
"""

import datetime as dt
import json
import math
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_trade_ideas as S  # noqa: E402
import thesis_review as T  # noqa: E402


def days(start, values):
    d, out = dt.date.fromisoformat(start), []
    for v in values:
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        out.append((d.isoformat(), float(v)))
        d += dt.timedelta(days=1)
    return out


def walk(start, n, level=100.0, sd=1.0, seed=1):
    rnd = random.Random(seed)
    vals, v = [], level
    for _ in range(n):
        v *= 1.0 + rnd.gauss(0, sd / 100.0)
        vals.append(v)
    return days(start, vals)


def scored_row(**kw):
    """A row in the shape score_trade_ideas writes for an open call."""
    base = {"id": "n1", "date": "2026-03-02", "kind": "fx", "title": "t", "trade_label": "Long PX",
            "status": "open", "entry_date": "2026-03-02", "target_date": "2026-06-02", "horizon_months": 3,
            "legs": [{"series": "px", "side": "long", "measure": "pct_change", "weight": 1.0,
                      "entry_date": "2026-03-02", "entry_value": 100.0, "label": "PX", "short_label": "PX"}],
            "mark": 2.0, "mark_date": "2026-04-01", "sessions_held": 22,
            "benchmark": {"difference": 1.0}, "max_favourable": {"value": 3.0, "date": "2026-03-20"},
            "max_adverse": {"value": -1.0, "date": "2026-03-05"}, "sizing": {"spread_vol_pct": 12.0}}
    base.update(kw)
    return base


def review(**kw):
    base = {"id": "n1", "verdict": "intact", "action": "hold",
            "driver_checks": [{"claim": "positioning at an extreme", "at_publication": "92nd percentile",
                               "now": "88th percentile", "source": "CFTC via macrotilt.com", "as_of": "2026-03-27",
                               "holds": True, "critical": True}],
            "view_now": "The driver is still in place and the position has not been rewarded yet, which is the setup.",
            "expected_return_now_pct": 3.0, "expected_basis": "the note's base rate from the current percentile reading",
            "called_for_pct": 3.2, "called_for_basis": "median three-month move in the note's base rate",
            "action_reason": "Nothing in the driver has changed; the stop is far and the horizon has two months to run."}
    base.update(kw)
    return base


def submission(*reviews, review_date="2026-03-30"):
    return {"review_date": review_date,
            "book_now": "One position, long the pair against the dollar, sized to a three-month horizon; no duration, no equity beta in the book.",
            "reviews": list(reviews) or [review()]}


class TestStatistics(unittest.TestCase):
    def test_normal_cdf(self):
        self.assertAlmostEqual(T.norm_cdf(0.0), 0.5, places=9)
        self.assertAlmostEqual(T.norm_cdf(1.2815515655), 0.9, places=6)
        self.assertAlmostEqual(T.norm_cdf(-1.96), 0.025, places=3)

    def test_sessions_between(self):
        self.assertEqual(T.sessions_between("2026-01-01", "2026-01-01"), 0)
        self.assertEqual(T.sessions_between("2026-01-01", "2027-01-01"), 252)
        self.assertEqual(T.sessions_between("2026-03-01", "2026-06-01"), 64)

    def test_mark_increments_are_the_scorer_marks_differenced(self):
        h = {"px": days("2026-03-02", [100, 102, 101, 104])}
        row = scored_row(mark_date="2026-03-05")
        incs = T.mark_increments(row, h, "2026-03-05", 10)
        self.assertEqual([round(x, 6) for x in incs], [2.0, -1.0, 3.0])

    def test_two_leg_spread_increment_nets_the_short(self):
        h = {"a": days("2026-03-02", [100, 110]), "b": days("2026-03-02", [200, 210])}
        row = scored_row(legs=[{"series": "a", "side": "long", "measure": "pct_change", "weight": 1.0, "entry_value": 100.0},
                               {"series": "b", "side": "short", "measure": "pct_change", "weight": 1.0, "entry_value": 200.0}],
                         mark_date="2026-03-03")
        incs = T.mark_increments(row, h, "2026-03-03", 10)
        self.assertAlmostEqual(incs[0], 10.0 - 5.0, places=9)

    def test_bond_leg_increment_uses_entry_duration(self):
        h = {"y": days("2026-03-02", [4.0, 4.1])}
        row = scored_row(legs=[{"series": "y", "side": "long", "measure": "bond_return", "maturity_years": 10,
                                "weight": 1.0, "entry_value": 4.0}], mark_date="2026-03-03")
        incs = T.mark_increments(row, h, "2026-03-03", 10)
        self.assertAlmostEqual(incs[0], -S.modified_duration(4.0, 10) * 0.1, places=9)

    def test_range_is_centred_on_the_mark_and_symmetric(self):
        h = {"px": walk("2025-06-02", 260)}
        row = scored_row(entry_date="2026-03-02", mark_date=h["px"][-1][0], mark=2.0,
                         target_date=(dt.date.fromisoformat(h["px"][-1][0]) + dt.timedelta(days=60)).isoformat())
        q = T.quant_one(row, {"scorecard": {}}, h, 5.0)
        r = q["range_at_horizon"]
        self.assertAlmostEqual(r["p50"], 2.0, places=6)
        self.assertAlmostEqual(r["p90"] - 2.0, 2.0 - r["p10"], places=6)
        self.assertGreater(r["p90"], r["p75"])
        self.assertAlmostEqual(q["p_finish_at_or_above_called_for"] + T.norm_cdf(3.0 / r["width_pct"]), 1.0, places=2)
        self.assertEqual(q["vol"]["sessions_used"], T.REVIEW_VOL_SESSIONS)

    def test_no_range_without_enough_history(self):
        h = {"px": days("2026-03-02", [100] * 10)}
        row = scored_row(mark_date=h["px"][-1][0])
        q = T.quant_one(row, {"scorecard": {}}, h, None)
        self.assertIsNone(q["range_at_horizon"])
        self.assertIn("sessions", q["note"])

    def test_forward_extremes_match_brute_force(self):
        vals = [random.Random(3).uniform(90, 110) for _ in range(300)]
        for prop in (True, False):
            up, down = T.forward_extremes(vals, 7, prop)
            for t in range(0, 300 - 7):
                seg = vals[t + 1:t + 8]
                if prop:
                    eu, ed = 100.0 * (max(seg) / vals[t] - 1), 100.0 * (1 - min(seg) / vals[t])
                else:
                    eu, ed = max(seg) - vals[t], vals[t] - min(seg)
                self.assertAlmostEqual(up[t], eu, places=9)
                self.assertAlmostEqual(down[t], ed, places=9)
            self.assertIsNone(up[295])

    def test_touch_base_rate_counts_exactly(self):
        # sawtooth: every 4-session window from an even start rises 5 points; from an odd start it falls
        vals = [100.0, 105.0] * 50
        p, n = T.touch_base_rate(vals, 5.0, "up", 2, proportional=False)
        self.assertEqual(n, 98)
        self.assertAlmostEqual(p, 0.5, places=9)      # only the starts at 100 see +5 within two sessions
        p2, _ = T.touch_base_rate(vals, 5.01, "up", 2, proportional=False)
        self.assertEqual(p2, 0.0)

    def test_stop_geometry_direction_and_units(self):
        h = {"px": walk("2025-01-01", 400, level=100, sd=1.0), "r": [(d, 2.0 + 0.001 * i) for i, (d, _) in enumerate(walk("2025-01-01", 400))]}
        end = h["px"][-1][0]
        row = scored_row(mark_date=end)
        g = T.stop_geometry(row, {"scorecard": {"invalidation": {"series": "px", "op": "<=", "level": 50.0}}}, h, end, 40, {"px": "$"})
        self.assertEqual(g["units"], "proportional (%)")
        self.assertGreater(g["distance"], 0)
        self.assertEqual(g["p_touch_before_horizon"], 0.0)   # a 50% fall in 40 sessions never happened on a 1%-a-day walk
        g2 = T.stop_geometry(row, {"scorecard": {"invalidation": {"series": "r", "op": ">=", "level": 2.0}}}, h, end, 40, {"r": "%"})
        self.assertEqual(g2["units"], "absolute (points)")
        self.assertEqual(g2["p_touch_before_horizon"], 1.0)   # already through the level


class TestContract(unittest.TestCase):
    def scores(self, *rows):
        return {"as_of": "2026-03-27", "generated_at": "x", "scores": list(rows) or [scored_row()]}

    def ideas(self):
        return [{"id": "n1", "date": "2026-03-02", "scorecard": {"legs": [{"series": "px", "side": "long", "measure": "pct_change"}]}}]

    def test_valid_submission_passes(self):
        out = T.validate_submission(submission(), self.scores(), self.ideas(), None)
        self.assertEqual(out[0]["verdict"], "intact")
        self.assertEqual(out[0]["called_for_pct"], 3.2)

    def assertRejected(self, sub, needle, prior=None, scores=None):
        with self.assertRaises(T.ReviewError) as cm:
            T.validate_submission(sub, scores or self.scores(), self.ideas(), prior)
        self.assertIn(needle, str(cm.exception))

    def test_intact_with_a_failed_check_is_rejected(self):
        ck = dict(review()["driver_checks"][0], holds=False)
        self.assertRejected(submission(review(driver_checks=[ck])), "'intact' but a driver check has failed")

    def test_broken_needs_a_failed_critical_check(self):
        ck = dict(review()["driver_checks"][0], holds=False, critical=False)
        ck2 = dict(review()["driver_checks"][0], holds=True, critical=True)
        self.assertRejected(submission(review(verdict="broken", action="close", driver_checks=[ck, ck2])),
                            "requires a CRITICAL driver check that has failed")

    def test_broken_must_close_and_close_needs_broken(self):
        ck = dict(review()["driver_checks"][0], holds=False, critical=True)
        self.assertRejected(submission(review(verdict="broken", action="hold", driver_checks=[ck])), "action must be 'close'")
        self.assertRejected(submission(review(verdict="intact", action="close")), "only for a broken thesis")

    def test_weakened_with_all_checks_holding_needs_a_reason(self):
        self.assertRejected(submission(review(verdict="weakened")), "needs weakened_reason")
        out = T.validate_submission(submission(review(verdict="weakened", weakened_reason="Price has moved against it by more than the base rate allows for.")),
                                    self.scores(), self.ideas(), None)
        self.assertEqual(out[0]["verdict"], "weakened")

    def test_called_for_is_frozen_after_the_first_review(self):
        prior = {"latest": {"review_date": "2026-03-23", "calls": [{"id": "n1", "called_for_pct": 3.2}]}, "history": []}
        self.assertRejected(submission(review(called_for_pct=4.0)), "cannot change after the first review", prior=prior)
        out = T.validate_submission(submission(review(called_for_pct=3.2)), self.scores(), self.ideas(), prior)
        self.assertEqual(out[0]["called_for_pct"], 3.2)

    def test_every_open_call_must_be_reviewed(self):
        sc2 = self.scores(scored_row(), scored_row(id="n2", trade_label="Long QQ"))
        self.assertRejected(submission(), "missing: n2", scores=sc2)

    def test_closed_calls_are_not_reviewable(self):
        sc2 = self.scores(scored_row(status="closed_horizon"))
        self.assertRejected(submission(), "is not an OPEN call", scores=sc2)

    def test_checks_need_dated_sources_and_a_critical_one(self):
        ck = dict(review()["driver_checks"][0]); ck.pop("as_of")
        self.assertRejected(submission(review(driver_checks=[ck])), "as_of is required")
        ck = dict(review()["driver_checks"][0], critical=False)
        self.assertRejected(submission(review(driver_checks=[ck])), "must be marked critical")

    def test_banned_copy_and_thin_prose_are_rejected(self):
        self.assertRejected(submission(review(view_now="Positioning is crowded and the trade should work from here.")), "banned copy")
        self.assertRejected(submission(review(action_reason="fine")), "action_reason must be a real sentence")
        self.assertRejected(submission(review(expected_return_now_pct="soon")), "expected_return_now_pct")


class TestEndToEnd(unittest.TestCase):
    def test_prepare_check_email_and_scorer_close(self):
        tmp = tempfile.mkdtemp()
        # A walk that ends about today, so the call (entry ~60 sessions ago, six-month horizon) is still open.
        start = (dt.date.today() - dt.timedelta(days=377)).isoformat()
        px = walk(start, 260)
        hist_doc = {"px": {"unit": "$", "points": [[d, v] for d, v in px]}}
        mark_date = px[-1][0]
        entry = px[200][0]
        ideas_doc = {"ideas": [{"id": "n1", "date": entry, "published_at": f"{entry}T22:00:00Z", "kind": "fx", "title": "t",
                                "instrument": "i", "position_type": "outright long",
                                "scorecard": {"legs": [{"series": "px", "side": "long", "measure": "pct_change", "label": "PX", "short_label": "PX"}],
                                              "horizon_months": 6, "invalidation": {"series": "px", "op": "<=", "level": 1.0}}}]}
        p_ideas, p_hist, p_scores, p_out = (os.path.join(tmp, n) for n in ("ideas.json", "hist.json", "scores.json", "reviews.json"))
        json.dump(ideas_doc, open(p_ideas, "w")); json.dump(hist_doc, open(p_hist, "w"))
        # real scorer output for the row
        S.main(["--ideas", p_ideas, "--history", p_hist, "--out", p_scores, "--reviews", p_out])
        scores = json.load(open(p_scores))
        self.assertEqual(scores["scores"][0]["status"], "open")
        review_date = (dt.date.fromisoformat(mark_date) + dt.timedelta(days=3)).isoformat()

        p_sub = os.path.join(tmp, "sub.json")
        json.dump(submission(review_date=review_date), open(p_sub, "w"))
        doc = T.prepare(p_sub, p_out, p_ideas, p_scores, p_hist)
        self.assertEqual(doc["latest"]["counts"], {"intact": 1, "weakened": 0, "broken": 0})
        q = doc["latest"]["calls"][0]["quant"]
        self.assertIsNotNone(q["range_at_horizon"])
        self.assertEqual(q["called_for_pct"], 3.2)
        self.assertIn("p_touch_before_horizon", q["stop"])
        html_ = T.render_email_html(doc)
        self.assertIn("WEEKLY THESIS REVIEW", html_)
        self.assertIn("INTACT", html_)
        self.assertIn("Long PX", html_)

        # a second review, a week later, marks it broken -> scorer closes it at the last close on/before the review date
        rd2 = (dt.date.fromisoformat(review_date) + dt.timedelta(days=7)).isoformat()
        ck = dict(review()["driver_checks"][0], holds=False, critical=True, now="40th percentile")
        json.dump(submission(review(verdict="broken", action="close", driver_checks=[ck]), review_date=rd2), open(p_sub, "w"))
        doc2 = T.prepare(p_sub, p_out, p_ideas, p_scores, p_hist)
        self.assertEqual(len(doc2["history"]), 1)
        self.assertEqual(doc2["history"][0]["review_date"], review_date)
        self.assertEqual(S.load_review_closes(p_out), {"n1": rd2})
        S.main(["--ideas", p_ideas, "--history", p_hist, "--out", p_scores, "--reviews", p_out])
        row = json.load(open(p_scores))["scores"][0]
        self.assertEqual(row["status"], "closed_thesis")
        self.assertLessEqual(row["mark_date"], rd2)
        self.assertEqual(row["thesis_review_close"]["review_date"], rd2)

        # re-preparing the same week's submission after the scorer closed the call must still pass
        doc3 = T.prepare(p_sub, p_out, p_ideas, p_scores, p_hist)
        self.assertEqual(doc3["latest"]["review_date"], rd2)
        self.assertEqual(len(doc3["history"]), 1)

        # --check: fresh today? the review is dated in the past relative to real today, so it reports stale
        probs = T.check(p_out, p_ideas, p_scores, max_age_days=10 ** 6)
        self.assertEqual(probs, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
