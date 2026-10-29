#!/usr/bin/env python3
"""Self-test for build_trade_idea.py — Contract v2 (2026-10-21, LESSONS 6.26).

Fixtures, one per rule the October 21 review changed:
  * Decision 1 — a fallback note that passes (fewer than five matching cases,
    history did not ride the factor) and one that fails on dependence;
  * Decision 2 — a positioning note on full instrument history that fails the
    threshold scan on a sign flip, and one that survives it;
  * Decision 3 — an outright short refused on a positive absolute median;
    an inverse fund held too long;
  * Decision 4 — a valid event note ("prepared OK"), one refused for a
    seven-month resolve date, one refused on the odds gap;
  * Decision 5 — a note without a weight refused, a wrong weight refused,
    the weight immutable on republish.

Run:  python scripts/test_build_trade_idea.py
"""

import copy
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trade_idea as B  # noqa: E402

DATE = "2026-10-22"


def _days(start, n, f):
    d, out = dt.date.fromisoformat(start), []
    i = 0
    while len(out) < n:
        if d.weekday() < 5:
            out.append([d.isoformat(), round(f(i), 4)])
            i += 1
        d += dt.timedelta(days=1)
    return out


def _history():
    import math
    n = 320
    return {
        "spx_index": {"points": _days("2025-07-01", n, lambda i: 5000 + 12 * i + 40 * math.sin(i / 7))},
        "px_a": {"points": _days("2025-07-01", n, lambda i: 100 + 0.3 * i + 3 * math.sin(i / 5))},
        "px_b": {"points": _days("2025-07-01", n, lambda i: 50 - 0.05 * i + 2 * math.cos(i / 9))},
        "cmdty_brent": {"points": _days("2025-07-01", n, lambda i: 80 + 0.1 * i + 4 * math.sin(i / 11))},
        "ust_20y": {"points": _days("2025-07-01", n, lambda i: 4.6 + 0.3 * math.sin(i / 13))},
        "ust_10y": {"points": _days("2025-07-01", n, lambda i: 4.3 + 0.3 * math.sin(i / 13))},
        "ust_2y": {"points": _days("2025-07-01", n, lambda i: 4.0 + 0.3 * math.sin(i / 13))},
        "vix": {"points": _days("2025-07-01", n, lambda i: 17 + 3 * math.sin(i / 10))},
    }


def standard_note(**kw):
    """A complete, valid v2 standard long note. Every test mutates a copy."""
    n = {
        "date": DATE, "kind": "commodity",
        "title": "Platinum at a liquidation low in a tight market",
        "dek": "Physical stocks cover fourteen weeks of demand while the price sits 44% below January's record.",
        "instrument": "PPLT, the physical platinum fund",
        "horizon": "6 months",
        "position_type": "outright long",
        "call": "Platinum is priced for a liquidation that the physical market does not support, and the metal is likely to recover a third of its fall over the next six months.",
        "the_trade": {"buy": "PPLT shares, the listed physical platinum fund, held for six months.",
                      "buy_line": "PPLT shares, held six months",
                      "sizing": "Ten of a notional hundred; the stop is nine per cent below entry."},
        "edge": {
            "source": "technicals",
            "summary": "When platinum has fallen more than a third from a one-year high while above-ground stocks were tight, the metal recovered over the following six months in six of seven cases. Only one of the seven past cases had the Fed raising rates as it is today; the cases' returns did not depend on the yield move.",
            "backtest": {
                "window": "Platinum spot, January 2000 to October 2026; independent cases at least 126 sessions apart",
                "n": 7, "episodes": 7,
                "result": "+28.8% median over 126 sessions, positive in 6 of 7; average +20.0%",
                "baseline": "Every 126-session window since 2000: average +4.2%, median +3.1%, positive 55% of the time",
                "regime_match": {
                    "factor": "the Fed funds rate rising over the prior quarter (today: +50bp, the Fed raising into an oil shock)",
                    "matching_cases": 1,
                    "dependence": {"correlation": 0.12,
                                   "method": "correlation across all seven cases between the 126-session forward return of platinum and the change in the 10-year real yield over the same window"},
                },
            },
        },
        "variant": "Consensus reads the fall as demand destruction from automakers; the physical market says the opposite, and the cases where both were true recovered.",
        "thesis": ["Above-ground stocks cover fourteen weeks of demand, the tightest since 2008.",
                   "The fall was led by fund liquidation rather than a change in physical demand.",
                   "Six of seven comparable lows recovered within six months."],
        "evidence": [{"claim": "platinum below its January record", "value": "44% below", "source": "LBMA fix", "as_of": "2026-10-21"},
                     {"claim": "above-ground stocks", "value": "14 weeks of demand", "source": "WPIC Q3 report", "as_of": "2026-10-15"}],
        "levels": {"trigger": "a weekly close above the 20-day average", "invalidation": "a weekly close below $860, nine per cent under entry", "target": "$1,200 within six months"},
        "other_side": "The last two times this same signal fired, in March and September, platinum fell further; and only one of the seven past cases had the Fed raising rates as it is today, so the history was measured in an easier world.",
        "risks": ["A deeper recession in Europe cuts auto demand", "Fund liquidation has a second leg"],
        "so_what": "A tight metal at a liquidation low is a six-month long with a defined stop.",
        "charts": [{"series": "px_a", "title": "Platinum", "caption": "spot", "source": "LBMA", "window": "3y"},
                   {"series": "cmdty_brent", "title": "Brent", "caption": "oil", "source": "ICE", "window": "3y"}],
        "scorecard": {"legs": [{"series": "px_a", "side": "long", "measure": "pct_change", "label": "Platinum", "short_label": "Platinum"}],
                      "horizon_months": 6,
                      "invalidation": {"series": "px_a", "op": "<=", "level": 1.0, "basis": "weekly_close"}},
        "review_conditions": [{"claim": "stocks stay tight", "measure": "WPIC quarterly stocks-to-demand",
                               "at_publication": "14 weeks, 2026-10-15", "holds_while": "below 20 weeks", "critical": True}],
        "expected_return": {"pct": 28.0, "loss_at_stop_pct": 9.0,
                            "basis": "the median 126-session recovery in the seven past cases, on PPLT shares, which is what the Scorecard marks",
                            "instrument": "PPLT shares held for six months"},
        "book": {"stance": "With this call in it the book owns energy, natural gas and the yen against a short in wheat, and now a precious metal at a liquidation low; it is positioned for an oil shock that does not break the economy, with the most conviction in energy and the least in the yen.",
                 "rebalance": "A reader holding the earlier calls adds this at half the size of the energy position and leaves the rest alone."},
        "sizing": {"weight": 5},
    }
    n.update(kw)
    return n


def event_note(**kw):
    n = {
        "date": DATE, "kind": "event",
        "title": "A Hormuz deal is 35% priced; TLT pays 3.5 to 1 on it by December 18",
        "dek": "Oil down $20 takes the December hike off the table and the 10-year down 40 basis points.",
        "instrument": "TLT 80/86 call spread, December 18 expiry",
        "horizon": "2 months",
        "position_type": "outright long",
        "call": "If the Strait of Hormuz reopens before December 18, long-dated Treasuries are likely to be the asset that reprices most, and the market is charging only about a third of the odds we see over the next two months.",
        "event": {
            "name": "A US-Iran agreement that reopens the Strait of Hormuz to commercial tanker traffic",
            "resolves_by": "2026-12-18",
            "resolution": "Daily tanker transits on the IMF PortWatch tracker back above 60 a day for five consecutive days counts as reopened; a formal collapse of talks counts as not happening.",
            "implied_odds": {"pct": 35, "source": "Polymarket, Hormuz reopened by Dec 31", "as_of": "2026-10-20"},
            "transmission": [
                {"step": "Brent falls on a reopening", "figure": "-$20 a barrel, the war premium measured since February", "source": "ICE Brent vs pre-war average", "as_of": "2026-10-21"},
                {"step": "December hike odds fall with oil", "figure": "from 90% to under 40%: fed funds futures moved 25bp per $10 of oil this cycle", "source": "CME FedWatch, measured this run", "as_of": "2026-10-21"},
                {"step": "The 10-year follows the hike odds", "figure": "-40bp, the move the April ceasefire rumour produced", "source": "FRED DGS10", "as_of": "2026-10-21"},
                {"step": "TLT reprices", "figure": "+6% for 40bp at a 15-year duration", "source": "our own duration arithmetic", "as_of": "2026-10-21"},
            ],
        },
        "the_trade": {"structure": "call_spread", "underlying": "TLT", "strikes": [80, 86], "expiry": "2026-12-18",
                      "premium_pct_of_width": 0.22,
                      "buy": "The TLT December 18 80/86 call spread: buy the 80 call, sell the 86 call, for about $1.32 on a $6 width.",
                      "buy_line": "TLT 80/86 call spread, Dec 18; premium is the max loss"},
        "edge": {"source": "event",
                 "summary": "The market is charging 35% for a reopening and the spread's breakeven is 22%; we put the odds near 40% because both sides called the Qatar-Pakistan proposal positive on October 20 and Iran has tabled a seven-day reopening plan."},
        "variant": "Consensus treats the talks as theatre; the dated record of the last two weeks shows both sides moving toward a text, and the option market has not repriced.",
        "thesis": ["Both sides called the Qatar-Pakistan compromise positive on October 20.",
                   "Iran's seven-day reopening plan is on the table with conditions.",
                   "The December FOMC, the midterms and Iran's own timetable all fall inside the window."],
        "evidence": [{"claim": "Brent", "value": "$109", "source": "ICE", "as_of": "2026-10-21"},
                     {"claim": "December hike odds", "value": "90%", "source": "CME FedWatch", "as_of": "2026-10-21"},
                     {"claim": "10-year yield", "value": "5.12%", "source": "FRED DGS10", "as_of": "2026-10-21"}],
        "levels": {"trigger": "the premium at or below 25% of the width", "invalidation": "TLT closes below $80 on December 18 and the spread expires worthless", "target": "TLT above $86 on December 18"},
        "other_side": "Talks have collapsed twice since May, and even a signed deal might not move the 10-year 40 basis points if the Fed has already turned its attention to wages.",
        "risks": ["A deal that leaves the strait shut", "The Fed hikes in December regardless"],
        "so_what": "A capped-loss bet that pays 3.5 to 1 on a reopening the market says is a one-in-three chance.",
        "charts": [{"series": "ust_20y", "title": "20-year yield", "caption": "yield", "source": "FRED", "window": "1y"},
                   {"series": "cmdty_brent", "title": "Brent", "caption": "oil", "source": "ICE", "window": "1y"}],
        "review_conditions": [{"claim": "the strait is still effectively shut", "measure": "IMF PortWatch daily transits",
                               "at_publication": "under 40 a day, 2026-10-21 (85 pre-war)", "holds_while": "below 60 a day", "critical": True}],
        "expected_return": {"payoff_ratio": 3.55, "breakeven_odds": 22, "edge_odds": 40, "loss_at_stop_pct": 100,
                            "edge_odds_basis": "Both sides called the October 20 compromise positive; Iran tabled a seven-day plan on October 19; the April ceasefire rumour moved the 10-year 40bp in two sessions."},
        "book": {"stance": "With this call in it the book owns energy, natural gas and the yen against a short in wheat, and holds 1.5 of premium on a Hormuz reopening — a small, capped bet against the rest of the book's oil-shock positioning.",
                 "rebalance": "A reader holding the earlier calls adds this with premium only and changes nothing else."},
        "sizing": {"weight": 1.5},
    }
    n.update(kw)
    return n


class Base(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        hp = os.path.join(self.td.name, "h.json")
        json.dump(_history(), open(hp, "w"))
        sp = os.path.join(self.td.name, "scores.json")
        json.dump({"scores": []}, open(sp, "w"))
        self._env = {k: os.environ.get(k) for k in ("INDICATOR_HISTORY_PATH", "TRADE_IDEA_SCORES_PATH", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
        os.environ["INDICATOR_HISTORY_PATH"] = hp
        os.environ["TRADE_IDEA_SCORES_PATH"] = sp
        os.environ.pop("SUPABASE_URL", None)
        os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.td.cleanup()

    def refuse(self, note, *needles):
        with self.assertRaises(B.ContractError) as cm:
            B.validate(copy.deepcopy(note), [])
        msg = str(cm.exception)
        for nd in needles:
            self.assertIn(nd, msg, f"expected {nd!r} in: {msg}")
        return msg


class TestDecision1Fallback(Base):
    def test_fallback_note_passes_at_half_size_with_a_third_stop_and_disclosure(self):
        w = B.validate(standard_note(), [])
        self.assertTrue(any("Decision-1 fallback" in x for x in w), w)

    def test_fallback_refused_when_the_history_rode_the_factor(self):
        n = standard_note()
        n["edge"]["backtest"]["regime_match"]["dependence"]["correlation"] = 0.73     # the Oct 7 banks note
        self.refuse(n, "fallback refused", "+0.73")

    def test_fallback_needs_the_disclosure_in_both_places(self):
        n = standard_note(other_side="The last two firings of this signal lost money, and demand from automakers could weaken further into a European recession.")
        self.refuse(n, "fallback disclosure missing in other_side")

    def test_fallback_needs_a_one_third_stop(self):
        n = standard_note()
        n["expected_return"]["loss_at_stop_pct"] = 12.0        # 28/3 = 9.33 is the most allowed
        self.refuse(n, "fallback stop", "one third")

    def test_fallback_needs_weight_five(self):
        n = standard_note(sizing={"weight": 10})
        self.refuse(n, "sized at 5 of 100")

    def test_five_or_more_cases_keeps_the_old_rule_and_the_standard_weight(self):
        n = standard_note(sizing={"weight": 10})
        n["edge"]["backtest"]["regime_match"] = {
            "factor": "oil above $90 a barrel (today $109)", "matching_cases": 6,
            "result": "inside the six matching cases: median +24% over 126 sessions, positive in 5 of 6, against the +4.2% baseline"}
        w = B.validate(copy.deepcopy(n), [])
        self.assertFalse(any("fallback" in x for x in w), w)
        n["edge"]["backtest"]["regime_match"]["result"] = "inside the six matching cases the median was +1%, below the baseline of +4.2%"
        self.refuse(n, "does not clear the baseline")

    def test_regime_match_must_be_the_three_field_object_on_v2_notes(self):
        n = standard_note()
        n["edge"]["backtest"]["regime_match"] = "The named cause is oil; all 7 episodes share that state: +20% mean, 6 of 7 higher."
        self.refuse(n, "regime_match must be an object")


class TestDecision2ThresholdScan(Base):
    def _positioning(self, scan):
        n = standard_note(sizing={"weight": 10})
        n["edge"]["source"] = "positioning"
        n["edge"]["backtest"].update({
            "episodes": 14, "window_years": 6.3, "percentile_basis": "expanding",
            "trend_split": "above the 200-day: +9.1 (9 cases); below: +12.4 (5 cases)",
            "full_history": True, "first_report": "2020-06-02", "threshold": 2,
            "threshold_scan": scan,
            "regime_match": {"factor": "index volatility compressed (VIX 13 today, 10th percentile)", "matching_cases": 7,
                             "result": "inside the seven matching cases: median +9% over 21 sessions, 5 of 7 positive, against a +1.2% baseline"},
        })
        return n

    def test_sign_flip_across_the_scan_is_refused(self):
        scan = [{"threshold": 2, "cases": 14, "avg": 14.8, "baseline": 4.2, "edge": 10.6},
                {"threshold": 3, "cases": 19, "avg": 11.9, "baseline": 4.2, "edge": 7.7},
                {"threshold": 4, "cases": 24, "avg": 3.4, "baseline": 4.2, "edge": -0.8},
                {"threshold": 5, "cases": 27, "avg": 4.0, "baseline": 4.2, "edge": -0.2}]
        self.refuse(self._positioning(scan), "threshold-stability check failed", "sign flip")

    def test_full_history_with_a_stable_scan_passes_under_ten_years(self):
        scan = [{"threshold": 2, "cases": 14, "avg": 14.8, "baseline": 4.2, "edge": 10.6},
                {"threshold": 3, "cases": 19, "avg": 11.9, "baseline": 4.2, "edge": 7.7},
                {"threshold": 4, "cases": 24, "avg": 9.4, "baseline": 4.2, "edge": 5.2},
                {"threshold": 5, "cases": 27, "avg": 7.0, "baseline": 4.2, "edge": 2.8}]
        B.validate(self._positioning(scan), [])

    def test_under_ten_years_without_full_history_is_still_refused(self):
        n = self._positioning([])
        n["edge"]["backtest"].pop("full_history")
        self.refuse(n, "FULL history")

    def test_scan_must_reach_twice_the_published_threshold(self):
        scan = [{"threshold": 2, "cases": 14, "avg": 14.8, "baseline": 4.2, "edge": 10.6},
                {"threshold": 3, "cases": 19, "avg": 11.9, "baseline": 4.2, "edge": 7.7},
                {"threshold": 3.5, "cases": 21, "avg": 9.0, "baseline": 4.2, "edge": 4.8}]
        self.refuse(self._positioning(scan), "to twice it")


class TestDecision3Shorts(Base):
    def _short(self, median):
        n = standard_note(sizing={"weight": 10}, position_type="outright short",
                          title="Regional banks fall, not just lag",
                          instrument="KRE, the regional bank fund, sold short")
        n["the_trade"] = {"buy": "Nothing is bought; the position is a short.", "short": "KRE shares sold short, or KRE puts three months out.",
                          "short_line": "KRE puts, three months"}
        n["edge"]["backtest"]["regime_match"] = {"factor": "the dollar at a one-year high (today 108)", "matching_cases": 9,
                                                 "result": "inside the nine matching cases: median -4% over 126 sessions, 7 of 9 negative, against +4.2% unconditional"}
        n["edge"]["backtest"]["absolute"] = {"median": median, "win_rate": 59}
        n["edge"]["vs_market"] = "The position is expected to return +12% over six months while the S&P returns about +5%: the gap is the expected excess, net of borrow of about 1%."
        n["scorecard"] = {"legs": [{"series": "px_b", "side": "short", "measure": "pct_change", "label": "KRE", "short_label": "KRE"}],
                          "horizon_months": 6}
        n["expected_return"] = {"pct": 12.0, "loss_at_stop_pct": 5.0, "basis": "the median fall of the fund itself in the nine cases, on KRE shares, which is what the Scorecard marks", "instrument": "KRE shares sold short, or KRE puts"}
        return n

    def test_outright_short_refused_when_the_asset_rose_while_lagging(self):
        self.refuse(self._short(+3.1), "outright short refused", "lagged the market but did not fall")

    def test_outright_short_passes_when_the_asset_itself_fell(self):
        B.validate(self._short(-6.0), [])

    def test_outright_short_needs_the_absolute_test_at_all(self):
        n = self._short(-6.0)
        n["edge"]["backtest"].pop("absolute")
        self.refuse(n, "edge.backtest.absolute")

    def test_pair_needs_the_relative_test(self):
        n = self._short(-6.0)
        n["position_type"] = "long/short spread"
        n["the_trade"]["buy"] = "SPY shares against the short."
        n["scorecard"]["legs"].append({"series": "spx_index", "side": "long", "measure": "pct_change", "label": "S&P 500"})
        self.refuse(n, "edge.backtest.relative")
        n["edge"]["backtest"]["relative"] = {"median": -6.1, "win_rate": 76}
        B.validate(n, [])

    def test_inverse_fund_is_held_four_weeks_at_most(self):
        n = standard_note(sizing={"weight": 10})
        n["edge"]["backtest"]["regime_match"] = {"factor": "the dollar at a one-year high (today 108)", "matching_cases": 9,
                                                 "result": "inside the nine matching cases: median +12% over 126 sessions, 7 of 9 positive, against +4.2% unconditional"}
        n["the_trade"]["buy"] = "SH, the inverse S&P 500 fund, held for the month."
        n["the_trade"]["buy_line"] = "SH shares, one month"
        self.refuse(n, "inverse fund", "4 weeks")
        n["scorecard"].pop("horizon_months")
        n["scorecard"]["horizon_weeks"] = 4
        n["horizon"] = "4 weeks"
        n["call"] = "The S&P 500 is likely to give back its October gain over the next 4 weeks as the hike is priced in full."
        n["expected_return"] = {"pct": 4.0, "loss_at_stop_pct": 1.5, "basis": "the median four-week fall in the nine cases, on SH shares, which is what the Scorecard marks", "instrument": "SH shares held four weeks"}
        B.validate(n, [])


def option_note(**kw):
    """A short-horizon S&P note whose vehicle is a listed put (bug #1277)."""
    n = standard_note(date="2026-10-29", kind="cross-asset", instrument="SPY 773 put, Nov 13 expiry",
                      horizon="2–3 weeks", position_type="outright long",
                      call="Over the next 2–3 weeks the S&P 500 is likely to fall about 3%, to 7,510, as credit leads it lower.",
                      the_trade={"buy": "SPY at-the-money puts, Nov 13 expiry.", "buy_line": "SPY 773 put, Nov 13 expiry",
                                 "sizing": "5 of 100 (half size).",
                                 "option": {"underlying": "SPY", "structure": "put", "strike": 773, "expiry": "2026-11-13"}},
                      scorecard={"legs": [{"series": "ticker:SPY", "side": "short", "measure": "pct_change", "label": "SPY", "short_label": "SPY"}],
                                 "horizon_weeks": 3,
                                 "invalidation": {"series": "spx_index", "op": ">", "level": 99999, "basis": "close"}},
                      levels={"trigger": "credit 40bp wider in six weeks", "invalidation": "a close above 7,818", "target": "7,510 within three weeks"},
                      expected_return={"pct": 109.0, "loss_at_stop_pct": 30.0, "underlying_pct": 3.2,
                                       "basis": "the put's modelled value if the index falls the median 3.2% by the planned close, against the premium",
                                       "instrument": "SPY 773 put, Nov 13 expiry — the return is on the premium"},
                      charts=[{"series": "spx_index", "title": "S&P 500", "caption": "index", "source": "MacroTilt", "window": "1y"},
                              {"series": "cmdty_brent", "title": "Brent", "caption": "oil", "source": "ICE", "window": "3y"}])
    n.update(kw)
    return n


class TestOptionVehicle(Base):
    """2026-10-29 (bug #1277): a note that tells the reader to buy a put or a
    call is marked as that option, never as its underlying."""

    def test_option_note_derives_the_option_block_and_the_ticker_leg(self):
        n = option_note()
        B.validate(n, [])
        sc = n["scorecard"]
        self.assertEqual(sc["legs"][0]["series"], "ticker:SPY")
        self.assertEqual(sc["legs"][0]["side"], "short")
        self.assertEqual(sc["legs"][0]["short_label"], "SPY 773 put, Nov 13")
        self.assertEqual(sc["option"]["structure"], "put")
        self.assertEqual(sc["option"]["iv_series"], "vix")
        self.assertEqual(sc["option"]["rate_series"], "ust_2y")
        self.assertEqual(sc["option"]["expiry"], "2026-11-13")
        self.assertIsNone(sc["option"]["premium"])          # modelled at the entry close by the scorer
        self.assertIn("Black-Scholes", sc["note"])

    def test_a_put_named_in_the_trade_without_an_option_block_is_refused(self):
        n = option_note()
        del n["the_trade"]["option"]
        n["scorecard"]["legs"] = [{"series": "spx_index", "side": "short", "measure": "pct_change", "label": "S&P 500", "short_label": "S&P 500"}]
        with self.assertRaisesRegex(B.ContractError, "the_trade.option"):
            B.validate(n, [])

    def test_shares_as_the_vehicle_with_options_as_an_alternative_is_marked_on_the_shares(self):
        n = option_note()
        del n["the_trade"]["option"]
        n["the_trade"]["buy"] = "SH shares, or SPY at-the-money puts for defined risk."
        n["the_trade"]["shares_primary"] = "Shares are the vehicle; the puts are an alternative for a reader who wants defined risk."
        n["scorecard"]["legs"] = [{"series": "spx_index", "side": "short", "measure": "pct_change", "label": "S&P 500", "short_label": "S&P 500"}]
        n["expected_return"] = {"pct": 3.2, "loss_at_stop_pct": 0.8, "basis": "the median fall in the five cases, on the index, which is what the Scorecard marks", "instrument": "SH shares held three weeks"}
        B.validate(n, [])
        self.assertNotIn("option", n["scorecard"])

    def test_the_leg_must_be_the_fund_the_option_is_on(self):
        n = option_note()
        n["scorecard"]["legs"] = [{"series": "spx_index", "side": "short", "measure": "pct_change", "label": "S&P 500", "short_label": "S&P 500"}]
        with self.assertRaisesRegex(B.ContractError, "ticker:SPY"):
            B.validate(n, [])

    def test_option_note_states_the_underlying_move_for_the_book_test(self):
        n = option_note()
        del n["expected_return"]["underlying_pct"]
        with self.assertRaisesRegex(B.ContractError, "underlying_pct"):
            B.validate(n, [])
        n = option_note()
        B.validate(n, [])
        self.assertAlmostEqual(B._annual_pace(n), 3.2 * 12 / B._scored_months({"horizon_weeks": 3}), places=6)

    def test_loss_at_stop_cannot_exceed_the_premium(self):
        n = option_note()
        n["expected_return"]["loss_at_stop_pct"] = 120
        with self.assertRaisesRegex(B.ContractError, "cannot exceed 100"):
            B.validate(n, [])

    def test_a_note_dated_before_the_rule_without_an_option_block_is_grandfathered(self):
        n = option_note(date="2026-10-22")
        del n["the_trade"]["option"]
        n["scorecard"]["legs"] = [{"series": "spx_index", "side": "short", "measure": "pct_change", "label": "S&P 500", "short_label": "S&P 500"}]
        n["expected_return"] = {"pct": 3.2, "loss_at_stop_pct": 0.8, "basis": "the median fall in the five cases, on the index, which is what the Scorecard marks", "instrument": "SPY ATM puts, Nov 13 expiry"}
        B.validate(n, [])

    def test_a_restated_pre_rule_note_warns_instead_of_failing_the_two_to_one_rule(self):
        n = option_note(date="2026-10-22")
        n["expected_return"]["loss_at_stop_pct"] = 57.0      # 109 < 2 x 57: refused for a new note, warned for a re-statement
        with self.assertRaisesRegex(B.ContractError, "loss at the stop is 57%"):
            B.validate(option_note(expected_return=dict(n["expected_return"])), [])
        w = B.validate(n, [])
        self.assertTrue(any("GRANDFATHERED" in x for x in w))


class TestDecision4Event(Base):
    def test_valid_event_note_prepares_ok_and_derives_the_scorecard(self):
        out = os.path.join(self.td.name, "ideas.json")
        src = os.path.join(self.td.name, "ev.json")
        json.dump(event_note(), open(src, "w"))
        self.assertEqual(B.main(["--prepare-file", src, "--out", out]), 0)
        doc = json.load(open(out))
        sc = doc["ideas"][0]["scorecard"]
        self.assertEqual(sc["legs"][0]["series"], "ticker:TLT")
        self.assertEqual(sc["event"]["structure"], "call_spread")
        self.assertAlmostEqual(sc["event"]["premium"], 1.32, places=4)
        self.assertAlmostEqual(sc["event"]["payoff_ratio"], (6 - 1.32) / 1.32, places=3)
        self.assertAlmostEqual(sc["event"]["breakeven_odds_pct"], 22.0, places=3)
        self.assertEqual(doc["ideas"][0]["sizing"]["weight"], 1.5)
        self.assertAlmostEqual(doc["ideas"][0]["expected_return"]["pct"], round((6 - 1.32) / 1.32 * 100, 1), places=1)

    def test_seven_month_resolve_date_is_refused(self):
        n = event_note()
        n["event"]["resolves_by"] = "2027-05-22"
        n["the_trade"]["expiry"] = "2027-06-18"
        self.refuse(n, "within 6 months", "directional bet dressed as an event")

    def test_odds_gap_below_one_and_a_half_times_breakeven_is_refused(self):
        n = event_note()
        n["expected_return"]["edge_odds"] = 30      # 1.36x the 22% breakeven
        self.refuse(n, "odds gap")

    def test_transmission_must_carry_numbers(self):
        n = event_note()
        n["event"]["transmission"][1]["figure"] = "the hike odds fall a lot"
        self.refuse(n, "transmission[1].figure must carry a number")

    def test_premium_must_be_stated_as_the_most_it_can_lose(self):
        n = event_note()
        n["the_trade"]["buy_line"] = "TLT 80/86 call spread to Dec 18"
        self.refuse(n, "the most the trade can lose")

    def test_payoff_ratio_in_the_note_must_match_the_strikes_and_premium(self):
        n = event_note()
        n["expected_return"]["payoff_ratio"] = 5.0
        self.refuse(n, "expected_return.payoff_ratio")

    def test_event_weight_is_one_to_two_of_premium(self):
        self.refuse(event_note(sizing={"weight": 10}), "1 to 2 of the book")
        B.validate(event_note(sizing={"weight": 2}), [])

    def test_an_event_note_has_no_price_stop(self):
        n = event_note()
        n["scorecard"] = {"legs": [{"series": "ticker:TLT", "side": "long", "measure": "pct_change"}], "horizon_months": 2,
                          "invalidation": {"series": "ust_20y", "op": ">=", "level": 5.5, "basis": "close"}}
        self.refuse(n, "no price stop")

    def test_a_standard_note_may_not_claim_the_event_edge(self):
        n = standard_note()
        n["edge"]["source"] = "event"
        self.refuse(n, "edge.source 'event' is for kind: event")


class TestDecision5Weights(Base):
    def test_note_without_a_weight_is_refused(self):
        n = standard_note()
        n.pop("sizing")
        self.refuse(n, "sizing{weight} is required")

    def test_standard_idea_must_be_ten(self):
        n = standard_note(sizing={"weight": 7})
        n["edge"]["backtest"]["regime_match"] = {"factor": "oil above $90 a barrel (today $109)", "matching_cases": 6,
                                                 "result": "inside the six matching cases: median +24% over 126 sessions, positive in 5 of 6, against the +4.2% baseline"}
        self.refuse(n, "sized at 10 of 100")

    def test_weight_is_immutable_on_republish(self):
        out = os.path.join(self.td.name, "ideas.json")
        src = os.path.join(self.td.name, "n.json")
        json.dump(standard_note(), open(src, "w"))
        self.assertEqual(B.main(["--prepare-file", src, "--out", out]), 0)
        fixed = json.load(open(out))["ideas"][0]
        fixed["sizing"]["weight"] = 10
        fixed["edge"]["backtest"]["regime_match"] = {"factor": "oil above $90 a barrel (today $109)", "matching_cases": 6,
                                                     "result": "inside the six matching cases: median +24% over 126 sessions, positive in 5 of 6, against the +4.2% baseline"}
        json.dump(fixed, open(src, "w"))
        self.assertEqual(B.main(["--prepare-file", src, "--out", out]), 1)
        self.assertEqual(json.load(open(out))["ideas"][0]["sizing"]["weight"], 5)

    def test_pre_v2_notes_are_not_asked_for_a_weight(self):
        """The archive (--check) must stay green: notes dated before the
        contract carry no weight and are read at the standard 10 by the scorer."""
        n = standard_note(date="2026-10-15")
        n.pop("sizing")
        n["evidence"] = [{**e, "as_of": "2026-10-14"} for e in n["evidence"]] + [{"claim": "platinum low", "value": "$880", "source": "LBMA fix", "as_of": "2026-10-10"}]
        n["edge"]["backtest"]["regime_match"] = "The named cause is oil above $90; 6 matching episodes: median +24% over 126 sessions, 5 of 6 higher, against +4.2%."
        B.validate(n, [])


class TestBookTestWithWeights(Base):
    def test_book_test_line_quotes_weights_and_an_event_enters_at_its_premium(self):
        pub = standard_note(sizing={"weight": 10}, title="Open energy call", instrument="XLE")
        pub["id"] = "2026-10-09-open"
        pub["edge"]["backtest"]["regime_match"] = {"factor": "oil above $90 a barrel (today $109)", "matching_cases": 6,
                                                   "result": "inside the six matching cases: median +24% over 126 sessions, positive in 5 of 6, against the +4.2% baseline"}
        pub["scorecard"] = {"legs": [{"series": "px_b", "side": "long", "measure": "pct_change"}], "horizon_months": 6}
        json.dump({"scores": [{"id": "2026-10-09-open", "status": "open"}]}, open(os.environ["TRADE_IDEA_SCORES_PATH"], "w"))
        w = B.validate(event_note(), [pub])
        line = next(x for x in w if x.startswith("book test (weights)"))
        self.assertIn("1 open call(s) at 10 of 100", line)
        self.assertIn("event idea at weight 1.5", line)


if __name__ == "__main__":
    unittest.main(verbosity=2)
