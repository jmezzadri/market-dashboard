#!/usr/bin/env python3
"""Trade Idea — the versioned contract for MacroTilt's editorial note.

WHAT THIS IS
------------
MacroTilt publishes one proprietary trade idea twice a week (Sunday and
Wednesday evenings ET). The note is COMPOSED by the scheduled Cowork session
on Joe's subscription (see scripts/trade_idea_playbook.md) and PUBLISHED
through this script, which is the only thing allowed to write
public/trade_ideas.json.

That split is deliberate and comes straight from LESSONS 4.21(f): a surface
that goes to readers under the MacroTilt name is never produced by a prompt
that cannot be reviewed in a pull request. The prose is written by a model;
the CONTRACT it has to satisfy is code, in git, and enforced here.

    python3 scripts/build_trade_idea.py --prepare-file /tmp/idea.json
        validate one composed idea, normalise it, merge it into the published
        file (newest first, capped) and write the result. Prints "prepared OK".

    python3 scripts/build_trade_idea.py --check
        re-validate everything already published (CI guard).

THE CONTRACT (mirrors the daily brief's, adapted for a position note)
---------------------------------------------------------------------
1.  Every claim that carries a NUMBER lives in `evidence[]`, and every entry
    there carries its own `source` and `as_of`. A figure with no provenance is
    rejected, not printed. (LESSONS 4.21a — sourced-or-omitted.)
2.  A trade idea must be FALSIFIABLE: `levels.invalidation` is required and
    must be concrete. "Manage risk carefully" is not an invalidation.
3.  A trade idea must be BALANCED: `other_side` is required and must be a real
    argument against the position, not a hedge clause. Joe's words: "Should be
    balanced but technical and informative."
4.  No direction word ("rebounded", "eased back", "stabilised") anywhere in the
    note unless the evidence block carries two dated observations. The daily
    brief lost Joe's trust on exactly this. (LESSONS 4.21b.)
5.  Banned copy is scrubbed deterministically, same list as the brief:
    "washed out", "crowded".
6.  Novelty is a data field, not an instruction (LESSONS 4.19): an idea whose
    primary instrument matches a still-open idea from the last 21 days is
    rejected, so the tile cannot show the same trade twice in a row wearing a
    different headline.
7.  No performance claim. The note never states or implies a track record;
    there is no verified one, and inventing one is the worst failure available
    to this surface.

CONTRACT v2 (notes dated from 2026-10-21; LESSONS 6.26)
-------------------------------------------------------
8.  `edge.backtest.regime_match` is {factor, matching_cases, result|dependence}.
    Five or more matching cases: the edge must clear the baseline inside
    them. Fewer: the note may still publish if |correlation(case return,
    factor change)| < 0.30, disclosed in `other_side` and `edge.summary`,
    with the stop at most one third of the expected return and
    `sizing.weight` 5 (half size).
9.  A positioning edge needs ten years of data OR the instrument's full CFTC
    history plus `threshold_scan[]` with the edge's sign unchanged from the
    published percentile to twice it.
10. An outright short carries `edge.backtest.absolute` (the asset's own
    median forward return must be negative); a long/short spread carries
    `edge.backtest.relative`; an inverse fund is held four weeks at most.
11. `kind: event` — a defined-risk options spread on a named event. Required:
    `event{name, resolves_by (<= 6 months), resolution, implied_odds,
    transmission[]}`, `the_trade{structure, underlying, strikes, expiry,
    premium_pct_of_width | premium, buy_line stating the premium as the
    maximum loss}`, `expected_return{payoff_ratio, breakeven_odds,
    edge_odds >= 1.5 x breakeven, edge_odds_basis, loss_at_stop_pct 100}`.
    Exempt from the pace bar and the 2x-stop rule; the scorecard block is
    derived from the trade.
12. `sizing.weight` on every note: 10 standard, 5 under the rule-8 fallback,
    1–2 for an event idea. Fixed at publication; the book test uses the real
    weights.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

PUBLISHED_PATH = os.environ.get("TRADE_IDEAS_PATH", "public/trade_ideas.json")
MAX_PUBLISHED = 40          # the tile shows one; the rest are the archive
NOVELTY_WINDOW_DAYS = 21

VALID_KINDS = {
    "macro", "cross-asset", "single-name", "rates", "credit",
    "fx", "commodity", "equity",
    "event",     # 2026-10-21 — a premium-paid bet on a named binary event (Decision 4)
}

# Notes dated from here carry machine-checkable review_conditions (see 3f-bis)
# and an expected_return block that clears the expected-return hurdle (3f-ter).
REVIEW_CONDITIONS_FROM = "2026-10-01"
# 2026-10-30 (LESSONS 6.28) — Joe: "we need a check that proves the posted idea
# is still factual." The Oct 22 note's title said spreads were "widening" for a
# week after they had started tightening, and its 300bp line sat halfway back
# through the 66bp move, so the review would have called it intact. From this
# date: (a) every CRITICAL review condition carries its machine form —
# `check {series, op, level, transform?, basis?}` and `driver {series,
# direction, move_start {date, value}, max_giveback?}` — which
# scripts/daily_thesis_check.py re-measures every evening; (b) the title and
# dek state dated facts, never a present-tense trend ("widening", "surging").
REVIEW_CHECKS_FROM = "2026-10-31"
TREND_TENSE_RE = re.compile(
    r"\b(widening|tightening|rising|falling|surging|soaring|climbing|sliding|slipping|sinking|plunging|"
    r"plummeting|tumbling|dropping|collapsing|crashing|spiking|jumping|rallying|selling off|breaking (?:out|down)|"
    r"accelerating|decelerating|slowing|cooling|heating up|easing|firming|weakening|strengthening|"
    r"steepening|flattening|melting up|unwinding|deteriorating|improving|worsening)\b", re.I)
# 2026-10-02 — positioning edges are measured on the full record, with no
# look-ahead, and counted in independent episodes. The Aug 14 euro note passed
# this contract with "n=26" — 26 WEEKS inside a 156-week window, about four
# episodes. On the full record the same signal has the opposite sign. See
# scripts/research/outside_research_challenge/ and LESSONS 6.21.
POSITIONING_RIGOUR_FROM = "2026-10-03"
MIN_POSITIONING_EPISODES = 10
MIN_POSITIONING_WINDOW_YEARS = 10
# Joe, 2026-09-30: "I want a minimum of 20% expected return... If I want 10%
# I'll buy the SPY." Per cent of the position, over the note's own horizon.
# Lowered to 15% by Joe, 2026-10-02, after the 20% bar at 2x the stop had
# killed every candidate for three straight daily runs — no real measured
# edge could clear 20% while also paying twice its stop in a retail vehicle.
MIN_EXPECTED_RETURN_PCT = 15.0

# 2026-10-07 — THE HURDLE IS A PACE, AND THE BOOK IS ONE PORTFOLIO. Joe: "So a
# trade that's going to make 14% in a week doesn't get published, a trade
# that's going to make 15% over 18 months does?" and "I am looking to beat the
# market by a healthy margin with lower overall portfolio vol than the market
# ... take into account the current calls that are on the books and see if
# this is incremental alpha." The flat 15% ignored time: it refused a fast
# trade and passed one earning less a year than the index. From
# BOOK_RULES_FROM a note must
#   (a) call for a return whose ANNUAL PACE beats the S&P's long-run return
#       (MARKET_ANNUAL_PCT) by MARGIN_ANNUAL_PCT — i.e. HURDLE_ANNUAL_PCT a
#       year, pro-rated to the horizon (1 month 1.67%, 6 months 10%,
#       12 months 20%, 18 months 30%);
#   (b) still pay at least twice its loss at the stop;
#   (c) be INCREMENTAL to the open book: adding it must raise the book's
#       expected return over the S&P per unit of risk (risk-adjusted expected
#       return). The 2026-10-07 cap on book volatility was withdrawn
#       2026-10-14 (Joe: a higher risk-adjusted return is the only test).
# The open book is the calls the scorer marks open — a stopped or broken call
# is not a position, whatever its original horizon said.
BOOK_RULES_FROM = "2026-10-07"
REGIME_MATCH_FROM = "2026-10-08"      # LESSONS 6.23 — the sample has to contain today
MIN_REGIME_MATCH_EPISODES = 5
MIN_REGIME_MATCH_CHARS = 80

# ── CONTRACT v2 (2026-10-21, LESSONS 6.26) ──────────────────────────────────
# Six decisions from the October 21 review. No note had published since Oct 9;
# five straight sweeps ended in a skip, and the 20%-a-year bar killed almost
# nothing on its own. What killed the candidates was two other tests applied
# in a market that looks like nothing in the data (a Fed raising rates into an
# oil shock, the 10-year at a 20-year high, record-tight spreads):
#
#   1. The "today's conditions" test (6.23) failed nearly everything by
#      construction. It now has a FALLBACK: with fewer than five matching
#      cases, the idea may still publish if the correlation between the cases'
#      forward return and the named factor's change over the hold is under
#      0.30 in absolute value (the history did not ride the factor) — and the
#      note then carries a plain-English disclosure, a one-third stop and half
#      the standard size. The Oct 7 banks note would still have died (+0.73).
#   2. The ten-years rule for positioning (6.21) permanently barred anything
#      younger than ten years (the volatility-ETF short in VIX futures is a
#      2020-on phenomenon). It gives way when the FULL CFTC history is used
#      AND the edge keeps its sign at every threshold from the published one
#      to twice it (`threshold_scan[]`). One sign flip and the note is refused.
#   3. Shorts are not restricted (Joe: "I just need to be able to express it
#      as a retail trader"). A lagging asset is not a falling asset: an
#      outright short needs its own ABSOLUTE test (the asset's own forward
#      return, median below zero); a relative edge supports a pair only.
#      Inverse funds are held a month at most (daily-reset drift).
#   4. A second kind of note — `kind: event` — a defined-risk, premium-paid
#      options spread on a named binary event. No backtest; three tests
#      instead: our odds at least EVENT_MIN_ODDS_MULTIPLE x the breakeven odds
#      the premium implies, a measured transmission, and defined risk on a
#      listed underlying with rows in the price store. Resolves within six
#      months. Exempt from the pace bar and the 2x-stop rule: the premium IS
#      the stop (loss at stop is 100% of it).
#   5. The book gets a capital base of 100. Every note carries
#      `sizing.weight`: 10 for a standard idea, 5 under the Decision-1
#      fallback, EVENT_WEIGHT_MIN–EVENT_WEIGHT_MAX of premium for an event
#      idea (Joe, 2026-10-21). The book test uses these weights, not equal
#      weights. The weight is fixed at publication and never changes.
#   6. Everything Joe reads is plain English (playbook step 7; LESSONS 1.6).
CONTRACT_V2_FROM = "2026-10-21"
STANDARD_WEIGHT = 10.0
FALLBACK_WEIGHT = 5.0                  # half size: the price of publishing out of regime
EVENT_WEIGHT_MIN, EVENT_WEIGHT_MAX = 1.0, 2.0
MAX_DEPENDENCE_CORRELATION = 0.30
FALLBACK_STOP_FRACTION = 3.0           # loss at stop <= pct / 3 under the fallback (normal rule: /2)
EVENT_MIN_ODDS_MULTIPLE = 1.5          # our odds >= 1.5 x the breakeven the premium implies
EVENT_MAX_RESOLVE_MONTHS = 6
EVENT_STRUCTURES = {"call_spread", "put_spread", "call", "put"}
MAX_INVERSE_FUND_WEEKS = 4
# Listed inverse funds a retail account can hold. Matched as whole words in
# the_trade's buy legs; the word "inverse" matches too.
INVERSE_FUNDS = {
    "SH", "PSQ", "DOG", "RWM", "SDS", "QID", "DXD", "TWM", "SPXS", "SPXU", "SQQQ", "TZA", "SRTY",
    "TBF", "TBT", "TMV", "TTT", "SJB", "DUG", "SCO", "GLL", "ZSL", "EUO", "YCS", "UDN", "EFZ",
    "EUM", "SEF", "SKF", "FAZ", "ERY", "DRIP", "SOXS", "LABD", "SARK", "SVXY", "SVIX",
}
# The plain-English disclosure the Decision-1 fallback requires, in both
# `other_side` and `edge.summary`: "no (or only N) past cases had today's
# condition". Matched loosely so wording can vary; the playbook gives the form.
FALLBACK_DISCLOSURE_RE = re.compile(
    r"\b(no|none|only\s+\w+|\w+\s+of\s+(?:the\s+)?\w+|fewer\s+than\s+\w+)\b[^.]{0,80}?"
    r"\b(cases?|episodes?)\b[^.]{0,160}?\b(today|current|this|present)\b", re.I)
MARKET_ANNUAL_PCT = 10.0      # S&P 500 long-run total return, the bar to beat
MARGIN_ANNUAL_PCT = 10.0      # the "healthy margin" over it (Joe, 2026-10-07: "make it 20% a year")
HURDLE_ANNUAL_PCT = MARKET_ANNUAL_PCT + MARGIN_ANNUAL_PCT
MAX_HORIZON_WEEKS = 8         # a sub-quarter trade may state its horizon in weeks
DAYS_PER_MONTH = 30.44

REQUIRED = ["date", "kind", "title", "dek", "instrument", "horizon",
            "position_type", "call", "the_trade", "edge", "variant",
            "thesis", "evidence", "levels", "other_side", "risks", "so_what",
            "charts", "scorecard"]

# 2026-08-17 (Joe): "Can we somehow track our trade ideas and how they
# performed? I'd like to start collecting historical data on our calls."
#
# A note cannot be marked from its prose. "US bank equities — the KBW-style bank
# complex, held outright" is a good sentence and a useless instruction to a
# scorer. So every note now states its position a second time, in machine-
# readable form, and it does so BEFORE publication — which is the only moment at
# which it can be written honestly. A scorecard block added after the fact, once
# the outcome is visible, is not a record of a call; it is a record of a
# preference. scripts/score_trade_ideas.py consumes this and nothing else.
# 2026-08-18: level_change is retired as a LEG measure. A raw spread move is
# not a return — it cannot be netted against the other side of the trade, sized
# to a risk budget, or compared to a benchmark, and printing it in pp next to
# equity returns in per cent invites exactly the comparison it cannot support.
# A yield leg is now stated as bond_return with a maturity, which converts the
# yield move into a price return through the duration of a par bond.
# Single-name scorecard legs (2026-08-31). "ticker:XYZ" marks a stock from the
# prices_eod table instead of indicator_history.json — added because the
# series-only catalogue structurally limited every publishable note to the 74
# macro series (Joe: sourcing must start in the public domain — news, filings,
# single names). The contract validates the FORM always, and EXISTENCE when
# database credentials are in the environment; without credentials it warns,
# and the daily scorer still fails loudly on a ticker it cannot fetch.
_TICKER_RE = re.compile(r"^ticker:[A-Z][A-Z0-9.\-]{0,9}$")


def _is_ticker_key(key) -> bool:
    return isinstance(key, str) and key.startswith("ticker:")


def _ticker_exists_error(tkey: str):
    """None if the ticker is confirmed in prices_eod or cannot be checked here;
    an error string if the database answered and the ticker is not there."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return None                      # no credentials — the scorer enforces
    sym = tkey.split(":", 1)[1]
    try:
        import urllib.parse
        import urllib.request
        q = urllib.parse.urlencode({"select": "ticker", "ticker": f"eq.{sym}", "limit": "1"})
        req = urllib.request.Request(
            f"{base}/rest/v1/prices_eod?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read().decode("utf-8"))
        if not rows:
            return f"ticker {sym!r} has no rows in the price table — it cannot be marked"
    except Exception:  # noqa: BLE001 — unreachable database is not a contract failure
        return None
    return None


SCORE_MEASURES = {"pct_change", "bond_return"}
RETIRED_MEASURES = {"level_change"}
SCORE_SIDES = {"long", "short"}
SCORE_OPS = {">=", "<=", ">", "<"}
SCORE_BASES = {"close", "weekly_close"}

# 2026-08-14 (Joe): "Making a call 10 years out is not helpful. I want more
# trades ideas... next several quarters. This bond idea is not profound at all.
# You could look at Buffet Indicator or CAPE alone and say 'stocks are expensive
# over long term historical context.' What about positioning, technical analysis
# across assets. You keep coming back to such basic crap anyone can see - not
# something someone with decades of trading and risk managing experience can see."
#
# Three rules come out of that, and together they are the difference between
# research and a truism with a chart on it.
#
# (a) A TRADE idea is a next-several-quarters proposition. A ten-year valuation
#     view is an asset-allocation opinion; it is not this product.
# (b) Long-horizon valuation ratios — CAPE, the Buffett indicator, the equity
#     risk premium — cannot be the DRIVER. They are visible to anyone with a
#     browser, they say the same thing for years at a time, and they are silent
#     about the next two quarters. They are allowed as context.
# (c) The driver must be an EDGE that was measured: positioning, cross-asset
#     divergence, technicals, volatility structure, flows, relative value,
#     calendar mechanics or credit — and it must come with a backtest that
#     includes the UNCONDITIONAL BASELINE. A hit rate with nothing to compare it
#     to is a statistic, not an edge. This rule has already earned its keep: the
#     first idea written under it (equity index positioning at a 3-year extreme
#     → squeeze) was killed by its own backtest, which came in at or below the
#     unconditional baseline at every horizon.
EDGE_SOURCES = {
    "positioning", "cross-asset divergence", "technicals", "volatility structure",
    "flows", "relative value", "calendar mechanics", "credit", "market structure",
    "event",     # 2026-10-21 — only for kind: event; the edge is the odds gap, not a backtest
}
# Ratios that are famous, slow, and say the same thing for years.
TRUISM_SIGNALS = [
    "cape", "shiller", "buffett indicator", "market cap to gdp",
    "equity risk premium", "cyclically-adjusted price", "price to book",
]
MAX_HORIZON_MONTHS = 18

# 2026-08-13, Joe on the first published note: "Are we saying to buy treasuries
# and short stocks? I'm confused what the trade is." He was right — the note led
# with "Long the 10-year Treasury, funded by trimming US large-cap equity beta",
# which a professional reads as an allocation shift and everyone else reads as a
# short. A note whose central claim has to be decoded has failed no matter how
# good its evidence is. So the position TYPE is now a required enum rendered as a
# badge, and a plain-English sentence is a required field with its own jargon
# ban — the reader learns whether anything is being sold short before they read
# a single number.
POSITION_TYPES = {
    "allocation shift":  "Move money from one asset to another. Nothing sold short, no leverage.",
    "outright long":     "Buy and hold it. Nothing sold short.",
    "outright short":    "A short position — sold with the intention of buying it back lower.",
    "long/short spread": "Long one thing and short the other, sized against each other.",
    "hedge":             "Protection bought against something already owned.",
}
# 2026-08-24 — `watch only` is REMOVED, and this is the reason. The 2026-08-23
# gold note found something real that had no expression Joe would publish, so it
# shipped as `watch only`: a tile headed TRADE IDEA, carrying a fact strip that
# said there is no entry, no position, and here is what kills the position that
# does not exist. Joe: "We cannot have a tile that says TRADE IDEA on the
# fucking website and then post NO TRADE IDEA."
#
# He is right, and the fault was never the label — it was publishing at all. The
# playbook has said from the start that an absent note is correct and a forced
# one is not. `watch only` was the loophole that let a forced note through by
# renaming it. There is no surface on this site for a finding with no trade in
# it, so until there is one, a note that cannot name something to buy or sell
# does not get published. The tile keeps showing the previous note, which is
# what it is designed to do.
RETIRED_POSITION_TYPES = {
    "watch only": (
        "there is no trade in it. The tile is headed TRADE IDEA; a note that names no position "
        "does not belong under it. If the data will not support a trade, publish nothing — the "
        "tile carries the previous note until the next real one."
    ),
}

# 2026-08-13 (Joe, third pass): "Can we not be so blunt... It should be more
# editorial - something like UST are likely to yield more than large caps over x
# time period... We also need to be much more technical in this... Are we talking
# about a 6 month trade, a 5 year trade. Saying SELL STOCKS AND BUY TREASURIES is
# a terrible headline. We need to set stage."
#
# The previous field, `plain_english`, over-corrected. Solving "the reader cannot
# tell if we are shorting" by writing an imperative instruction produced a
# headline that reads like a broker's cold call. The fix is not less technical
# language — Joe asked for MORE — it is a CLAIM instead of an ORDER:
#
#   ORDER  Sell a slice of your US large-company stocks and buy 10-year bonds.
#   CLAIM  Over a five-to-ten-year horizon the 10-year Treasury is priced to
#          out-return the S&P 500 by the widest margin in our data since 2006.
#
# So `call` is a claim, and three things are enforced: it may not OPEN with an
# imperative, it MUST carry an explicit horizon (a six-month view and a five-year
# view are different products and the reader is entitled to know which), and it
# still may not lean on genuinely opaque desk shorthand. Note what is NOT banned
# any more — yield, total return, valuation, percentile, spread, term premium.
# Those are the technical vocabulary of the argument and Joe wants them.
JARGON = [
    "beta", "convexity", "carry", "notional", "steepener", "flattener",
    "dv01", "gamma", "vega", "basis risk", "roll-down", "rolldown",
]

# An order, not a claim. Checked against the FIRST word of `call`.
IMPERATIVE_OPENERS = {
    "buy", "sell", "short", "own", "add", "cut", "trim", "move", "rotate",
    "switch", "hold", "avoid", "get", "put", "take", "go",
}

# A horizon has to be a period a reader can hold in their head. "Medium term"
# is not one.
_PERIOD = (r"(?:\d+\s*(?:-|–|\s+to\s+)?\s*\d*\s*(?:week|month|quarter|year)s?"
           r"|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen)"
           r"(?:[- ]to[- ](?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen))?"
           r"[- ](?:week|month|quarter|year)s?)")

# The `horizon` FIELD is labelled, so a bare period is unambiguous there.
HORIZON_PERIOD_RE = re.compile(rf"\b{_PERIOD}\b|\bthrough\s+\w*\s*\d{{4}}\b|\binto\s+\w+\s+\d{{4}}\b", re.I)

# Inside `call` it is NOT unambiguous: "the 10-year Treasury" contains a perfect
# period expression and says nothing about how long the view is held. A first
# version of this check passed a call with no horizon at all for exactly that
# reason. So in prose the period must follow a horizon CUE, or be the thing a
# horizon is "of" — an instrument tenor never satisfies it.
HORIZON_PHRASE_RE = re.compile(
    rf"(?:\b(?:over|within|across|for|through|into|out\s+to|by)\s+(?:the\s+)?(?:next\s+)?(?:a\s+)?{_PERIOD}\b"
    rf"|\b{_PERIOD}\s+(?:horizon|view|window|out)\b"
    rf"|\bhorizon\s+of\s+{_PERIOD}\b"
    rf"|\bnext\s+{_PERIOD}\b"
    rf"|\bthrough\s+\w*\s*\d{{4}}\b|\binto\s+\w+\s+\d{{4}}\b)", re.I)

# Path words: a claim about how something MOVED needs two dated observations
# behind it. Checked against the evidence block, never taken on trust.
DIRECTION_WORDS = [
    "rebounded", "eased back", "eased off", "stabilised", "stabilized",
    "off its highs", "off the highs", "off its lows", "little changed",
    "recovered", "rolled over", "broke down", "broke out", "reversed",
    "accelerated", "decelerated", "cooled", "reheated", "backed up",
]

BANNED_COPY = {
    "washed out": "extended short",
    "crowded": "extended long",
}

# Claims the note may never make about itself.
PERFORMANCE_CLAIM = re.compile(
    r"\b(our (last|previous|prior) (call|idea|trade)|we (called|nailed|caught)|"
    r"track record|batting average|win rate|since inception|"
    r"(up|down)\s+\d+(\.\d+)?%\s+since we)\b", re.I)

# Language that reads as personalised advice rather than research.
ADVICE_CLAIM = re.compile(
    r"\b(you should (buy|sell|short|own)|we recommend you|guaranteed|"
    r"risk[- ]free|can'?t lose|sure thing)\b", re.I)


def _max_months(text: str):
    """Largest horizon in a phrase, in months. 'five-to-ten-year' -> 120."""
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
             "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "eighteen": 18}
    best = 0
    for m in re.finditer(r"([\w.-]+)[\s-]+(week|month|quarter|year)s?", str(text), re.I):
        raw, unit = m.group(1), m.group(2).lower()
        nums = [int(x) for x in re.findall(r"\d+", raw)]
        nums += [words[w] for w in re.findall(r"[a-z]+", raw.lower()) if w in words]
        if not nums:
            continue
        mult = {"week": 7 / 30.44, "month": 1, "quarter": 3, "year": 12}[unit]
        best = max(best, round(max(nums) * mult, 2))
    return best or None


def _history():
    """The series catalogue a chart must exist in. Local copy first (the repo
    ships one), then --history, then the live file. Returns None only if every
    route failed, which downgrades the chart check to a warning rather than
    silently passing a chart of nothing."""
    for path in (os.environ.get("INDICATOR_HISTORY_PATH"), "public/indicator_history.json"):
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return _with_derived(json.load(f))
            except Exception:  # noqa: BLE001
                pass
    try:
        import urllib.request
        with urllib.request.urlopen("https://macrotilt.com/indicator_history.json", timeout=60) as r:
            return _with_derived(json.loads(r.read().decode("utf-8")))
    except Exception:  # noqa: BLE001
        return None


def _with_derived(raw):
    """The contract must see the SAME series catalogue the marker does.

    The marker builds a few series from stored ones (the bank complex level is
    bkx_spx x spx_index) so a leg can name the thing the note actually named.
    Without this, the contract rejects a leg the marker scores perfectly well —
    two definitions of "series we carry", which is one too many. The names are
    imported from the marker rather than restated here, so they cannot drift.
    """
    if not isinstance(raw, dict):
        return raw
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from score_trade_ideas import DERIVED
    except Exception:  # noqa: BLE001
        return raw
    for name, spec in DERIVED.items():
        if all(k in raw for k in spec["of"]):
            raw.setdefault(name, {"points": [], "derived_from": list(spec["of"]),
                                  "note": "built by the marker; not a stored feed"})
    return raw


class ContractError(Exception):
    pass


# ── small helpers ──────────────────────────────────────────────────────────
def _text_of(idea: dict) -> str:
    """Every reader-facing string in one blob, for the copy scans."""
    parts = [idea.get("title", ""), idea.get("dek", ""), idea.get("instrument", ""),
             idea.get("other_side", ""), idea.get("so_what", ""), idea.get("call", "")]
    tt = idea.get("the_trade") or {}
    if isinstance(tt, dict):
        parts += [str(v) for v in tt.values()]
    for c in idea.get("charts") or []:
        if isinstance(c, dict):
            parts += [str(c.get("title", "")), str(c.get("subtitle", "")), str(c.get("caption", ""))]
    parts += list(idea.get("thesis") or [])
    parts += list(idea.get("risks") or [])
    for e in idea.get("evidence") or []:
        parts += [str(e.get("claim", "")), str(e.get("value", ""))]
    for s in idea.get("sections") or []:
        parts.append(s.get("title", ""))
        parts.append(s.get("prose", "") or "")
        parts += list(s.get("bullets") or [])
    lv = idea.get("levels") or {}
    parts += [str(lv.get(k, "")) for k in ("trigger", "invalidation", "target")]
    return "\n".join(str(p) for p in parts)


def _is_concrete(s: str) -> bool:
    """An invalidation or trigger has to be checkable: it names a level, a
    date, a percentage, or a specific observable event."""
    s = (s or "").strip()
    if len(s) < 12:
        return False
    if re.search(r"\d", s):
        return True
    # Allow a purely qualitative but still checkable event, e.g.
    # "the Fed cuts at the September meeting".
    return bool(re.search(r"\b(above|below|through|breaks?|closes?|prints?|cuts?|hikes?|"
                          r"crosses|falls|rises|exceeds|drops)\b", s, re.I))


def _scrub(idea: dict) -> list[str]:
    """Deterministic banned-copy replacement, in place. Returns what changed."""
    changed = []

    def fix(s):
        if not isinstance(s, str):
            return s
        out = s
        for bad, good in BANNED_COPY.items():
            if re.search(rf"\b{re.escape(bad)}\b", out, re.I):
                out = re.sub(rf"\b{re.escape(bad)}\b", good, out, flags=re.I)
                changed.append(bad)
        return out

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return fix(node)

    scrubbed = walk(idea)
    idea.clear()
    idea.update(scrubbed)
    return sorted(set(changed))


# ── book construction: correlation of a candidate with the live calls ──────
# Joe, 2026-09-30: "significant alpha generating ideas, ensuring we have
# downside protection, not an overly correlated book." Exposure conflict (3g)
# catches the same series on opposite sides; this catches two notes that are
# the same bet in different clothes — long euro and short dollar index, say.
MAX_BOOK_CORRELATION = 0.60
WARN_BOOK_CORRELATION = 0.40
CORRELATION_SESSIONS = 126
MIN_REWARD_TO_RISK = 2.0


def _position_daily_returns(sc: dict, hist: dict, sessions: int = CORRELATION_SESSIONS):
    """{date: one-session % return of the position} over the last `sessions`
    common sessions, from the scorecard legs (pct legs as % change, bond legs
    as -duration x yield change, signed by side). None if any leg is a ticker
    we cannot read here or a series we do not carry."""
    if not isinstance(hist, dict) or not isinstance(sc, dict):
        return None
    legs = sc.get("legs") or []
    maps, specs = {}, []
    for j, leg in enumerate(legs):
        resolved = _leg_closes(leg, hist)
        if resolved is None:
            return None
        closes, measure, maturity, sign = resolved
        maps[j] = closes
        specs.append((j, measure, maturity, sign, leg))
    if not maps:
        return None
    dates = sorted(set.intersection(*[set(m) for m in maps.values()]))[-(sessions + 1):]
    if len(dates) < 40:
        return None
    from score_trade_ideas import modified_duration, SIDES
    out = {}
    for i in range(1, len(dates)):
        d0, d1, tot = dates[i - 1], dates[i], 0.0
        for j, measure, maturity, sign, leg in specs:
            v0, v1 = maps[j][d0], maps[j][d1]
            if measure == "bond_return":
                r = -modified_duration(v0, maturity) * (v1 - v0)
            else:
                r = 100.0 * (v1 / v0 - 1.0) if v0 else 0.0
            tot += sign * SIDES.get(leg.get("side"), 0.0) * float(leg.get("weight", 1.0)) * r
        out[d1] = tot
    return out


# A listed fund that tracks a series we carry is measured on that series for
# the book check — the same mapping the playbook tells notes to state ("levels
# are on front-month wheat; WEAT is the vehicle"). sign -1: the fund moves
# against the quoted series (FXY rises when yen-per-dollar falls).
TICKER_PROXIES = {
    "WEAT": ("cmdty_wheat", "pct_change", None, 1), "CORN": ("cmdty_corn", "pct_change", None, 1),
    "SOYB": ("cmdty_soybeans", "pct_change", None, 1), "UNG": ("cmdty_natgas", "pct_change", None, 1),
    "USO": ("cmdty_oil", "pct_change", None, 1), "BNO": ("cmdty_brent", "pct_change", None, 1),
    "GLD": ("cmdty_gold", "pct_change", None, 1), "IAU": ("cmdty_gold", "pct_change", None, 1),
    "SLV": ("cmdty_silver", "pct_change", None, 1), "CPER": ("cmdty_copper", "pct_change", None, 1),
    "FXE": ("fx_eur", "pct_change", None, 1), "FXB": ("fx_gbp", "pct_change", None, 1),
    "FXY": ("fx_jpy", "pct_change", None, -1),
    "SPY": ("spx_index", "pct_change", None, 1), "VOO": ("spx_index", "pct_change", None, 1),
    "IVV": ("spx_index", "pct_change", None, 1), "QQQ": ("ndx_index", "pct_change", None, 1),
    "DIA": ("dji_index", "pct_change", None, 1),
    "TLT": ("ust_20y", "bond_return", 20.0, 1), "IEF": ("ust_10y", "bond_return", 8.0, 1),
}
_PRICE_CACHE: dict = {}


def _points_map(pts):
    try:
        return {str(p[0])[:10]: float(p[1]) for p in pts if p[1] is not None}
    except (TypeError, ValueError, IndexError, KeyError):
        try:
            return {str(p["d"])[:10]: float(p["v"]) for p in pts if p.get("v") is not None}
        except Exception:  # noqa: BLE001
            return None


def _ticker_closes(sym: str):
    """Closes for a stock from (1) PRICES_EOD_PATH — a JSON file
    {"SYM": [["2026-01-02", 12.3], ...]} the session writes from prices_eod —
    or (2) the price table directly when database credentials are present.
    None if neither is available."""
    if sym in _PRICE_CACHE:
        return _PRICE_CACHE[sym]
    out = None
    path = os.environ.get("PRICES_EOD_PATH")
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            if sym in doc:
                out = _points_map(doc[sym])
        except Exception:  # noqa: BLE001
            out = None
    if out is None:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if base and key:
            try:
                import urllib.parse
                import urllib.request
                since = (dt.date.today() - dt.timedelta(days=400)).isoformat()
                q = urllib.parse.urlencode({"select": "trade_date,close", "ticker": f"eq.{sym}",
                                            "trade_date": f"gte.{since}", "order": "trade_date"})
                req = urllib.request.Request(f"{base}/rest/v1/prices_eod?{q}",
                                             headers={"apikey": key, "Authorization": f"Bearer {key}"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    rows = json.loads(r.read().decode("utf-8"))
                out = {str(x["trade_date"])[:10]: float(x["close"]) for x in rows if x.get("close")} or None
            except Exception:  # noqa: BLE001
                out = None
    _PRICE_CACHE[sym] = out
    return out


def _leg_closes(leg: dict, hist: dict):
    """(closes {date: value}, measure, maturity_years, sign) for one leg, or None."""
    key = leg.get("series")
    measure = leg.get("measure", "pct_change")
    maturity = float(leg.get("maturity_years") or 10)
    if _is_ticker_key(key):
        sym = key.split(":", 1)[1]
        if sym in TICKER_PROXIES:
            series, measure, mat, sign = TICKER_PROXIES[sym]
            if series not in hist:
                return None
            pts = hist[series].get("points") if isinstance(hist[series], dict) else hist[series]
            m = _points_map(pts or [])
            return (m, measure, mat or maturity, sign) if m else None
        m = _ticker_closes(sym)
        return (m, "pct_change", maturity, 1) if m else None
    if key not in hist:
        return None
    pts = hist[key].get("points") if isinstance(hist[key], dict) else hist[key]
    m = _points_map(pts or [])
    return (m, measure, maturity, 1) if m else None


def _correlation(a: dict, b: dict):
    ds = sorted(set(a) & set(b))
    if len(ds) < 40:
        return None
    xa, xb = [a[d] for d in ds], [b[d] for d in ds]
    ma, mb = sum(xa) / len(xa), sum(xb) / len(xb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(xa, xb))
    va = sum((x - ma) ** 2 for x in xa)
    vb = sum((y - mb) ** 2 for y in xb)
    if va <= 0 or vb <= 0:
        return None
    return cov / (va * vb) ** 0.5


def _scored_months(sc: dict):
    """The scored horizon in months (float). A note may state horizon_weeks
    (1 to MAX_HORIZON_WEEKS) instead of horizon_months for a sub-quarter trade."""
    if not isinstance(sc, dict):
        return None
    if sc.get("horizon_weeks") not in (None, ""):
        try:
            return round(int(sc["horizon_weeks"]) * 7 / DAYS_PER_MONTH, 4)
        except (TypeError, ValueError):
            return None
    try:
        return float(int(sc.get("horizon_months")))
    except (TypeError, ValueError):
        return None


def _scores_doc():
    """The scorer's output — the only record of which calls are still OPEN."""
    for path in (os.environ.get("TRADE_IDEA_SCORES_PATH"), "public/trade_idea_scores.json"):
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                pass
    try:
        import urllib.request
        with urllib.request.urlopen("https://macrotilt.com/trade_idea_scores.json", timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _open_book(published: list, idea: dict, warnings: list):
    """The calls a reader holds today: marked open (or pending entry) by the
    scorer. A stopped or thesis-broken call is not in the book even if its
    original horizon has time left. Falls back to the horizon rule only if the
    scores file cannot be read, and says so."""
    me = derive_id(idea)
    doc = _scores_doc()
    if isinstance(doc, dict) and isinstance(doc.get("scores"), list):
        live = {r.get("id") for r in doc["scores"] if r.get("status") in ("open", "pending_entry")}
        return [p for p in published if p.get("id") in live and p.get("id") != me]
    warnings.append("trade_idea_scores.json unreadable — open book taken from note horizons instead")
    idea_date = dt.date.fromisoformat(str(idea["date"]))
    out = []
    for prev in published:
        m = _scored_months(prev.get("scorecard") or {})
        try:
            pd_ = dt.date.fromisoformat(str(prev.get("date", "")))
        except ValueError:
            continue
        if prev.get("id") != me and m and pd_ < idea_date <= pd_ + dt.timedelta(days=int(m * DAYS_PER_MONTH)):
            out.append(prev)
    return out


def _annual_pace(note: dict):
    """The annual pace of the return a note called for, or None if it stated none.

    An option-vehicle note (scorecard.option, 2026-10-29) states its return on
    the PREMIUM — +109% in three weeks on a put is a 1,900%-a-year pace — and
    the book test measures the position's daily returns on the underlying
    (as it does for an event idea). Pacing the premium return against the
    underlying's volatility would swamp the book test for every later note
    while the option is open, so such a note also states
    expected_return.underlying_pct, the move in the underlying it calls for,
    and that is the pace the book test uses."""
    er = note.get("expected_return") or {}
    m = _scored_months(note.get("scorecard") or {})
    sc = note.get("scorecard") if isinstance(note.get("scorecard"), dict) else {}
    key = "underlying_pct" if isinstance(sc.get("option"), dict) else "pct"
    try:
        pct = float(er.get(key))
    except (TypeError, ValueError):
        return None
    return pct * 12.0 / m if m else None


def _ann_vol(xs):
    if len(xs) < 40:
        return None
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) ** 0.5 * (252 ** 0.5)


# ── contract v2 helpers (2026-10-21) ───────────────────────────────────────
def is_event(idea: dict) -> bool:
    return str(idea.get("kind", "")) == "event"


def is_v2(idea: dict) -> bool:
    return str(idea.get("date", "")) >= CONTRACT_V2_FROM


def _num(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _months_between(d0: dt.date, d1: dt.date) -> float:
    return (d1 - d0).days / DAYS_PER_MONTH


def event_payoff(structure: str, strikes, premium_pct_of_width=None, premium=None):
    """The arithmetic of a defined-risk event trade, shared with the scorer.

    Spread: width = |long strike - short strike|, premium = premium_pct_of_width
    x width, max payoff = width, payoff ratio = (width - premium) / premium.
    Single option: premium is absolute (per share); the payoff is uncapped, so
    the ratio is None and the breakeven odds cannot be read from the price
    alone (the note states them from the market, and the contract requires a
    spread when it wants a payoff ratio).
    Returns {width, premium, payoff_ratio, breakeven_odds_pct} or raises
    ContractError.
    """
    if structure not in EVENT_STRUCTURES:
        raise ContractError(f"the_trade.structure must be one of {sorted(EVENT_STRUCTURES)}, got {structure!r}")
    if structure.endswith("_spread"):
        if not (isinstance(strikes, (list, tuple)) and len(strikes) == 2):
            raise ContractError("the_trade.strikes must be [long strike, short strike] for a spread")
        k_long, k_short = _num(strikes[0]), _num(strikes[1])
        if k_long is None or k_short is None or k_long == k_short:
            raise ContractError("the_trade.strikes must be two different numbers")
        if structure == "call_spread" and not k_short > k_long:
            raise ContractError("a call spread's short strike must be ABOVE its long strike")
        if structure == "put_spread" and not k_short < k_long:
            raise ContractError("a put spread's short strike must be BELOW its long strike")
        width = abs(k_short - k_long)
        p = _num(premium_pct_of_width)
        if p is None or not (0.0 < p < 1.0):
            raise ContractError("the_trade.premium_pct_of_width must be a share of the width between 0 and 1 "
                                "(0.22 means the spread cost 22% of its width)")
        prem = p * width
        return {"width": width, "premium": prem, "payoff_ratio": (width - prem) / prem,
                "breakeven_odds_pct": 100.0 * p}
    if not (isinstance(strikes, (list, tuple)) and len(strikes) == 1 and _num(strikes[0]) is not None):
        raise ContractError("the_trade.strikes must be [strike] for a single option")
    prem = _num(premium)
    if prem is None or prem <= 0:
        raise ContractError("the_trade.premium (per share, absolute) is required for a single option")
    return {"width": None, "premium": prem, "payoff_ratio": None, "breakeven_odds_pct": None}


def _validate_event(idea: dict, idea_date: dt.date, warnings: list) -> None:
    """Decision 4 — the three event tests, plus shape. Raises ContractError."""
    ev = idea.get("event")
    if not isinstance(ev, dict):
        raise ContractError("kind is event, so `event{name, resolves_by, implied_odds, transmission[]}` is required")
    if len(str(ev.get("name") or "").strip()) < 20:
        raise ContractError("event.name must state the event in one plain sentence (min 20 chars)")
    try:
        resolves = dt.date.fromisoformat(str(ev.get("resolves_by")))
    except (TypeError, ValueError):
        raise ContractError("event.resolves_by must be an ISO date — the day or window by which the event is decided")
    if resolves <= idea_date:
        raise ContractError("event.resolves_by must be after the note's date")
    if _months_between(idea_date, resolves) > EVENT_MAX_RESOLVE_MONTHS + 0.05:
        raise ContractError(
            f"event.resolves_by is {_months_between(idea_date, resolves):.1f} months out — an event note resolves "
            f"within {EVENT_MAX_RESOLVE_MONTHS} months, or it is a directional bet dressed as an event")
    if len(str(ev.get("resolution") or "").strip()) < 30:
        raise ContractError("event.resolution must say, observably, what counts as the event happening and not "
                            "happening (min 30 chars) — an event with no observable resolution cannot be scored")
    io = ev.get("implied_odds")
    if not isinstance(io, dict):
        raise ContractError("event.implied_odds{pct, source, as_of} is required — the probability the market is charging")
    implied = _num(io.get("pct"))
    if implied is None or not (0.0 < implied < 100.0):
        raise ContractError("event.implied_odds.pct must be a percentage between 0 and 100")
    for k in ("source", "as_of"):
        if not str(io.get(k) or "").strip():
            raise ContractError(f"event.implied_odds.{k} is required — the odds come from a dated source")
    tr = ev.get("transmission")
    if not isinstance(tr, list) or len(tr) < 2:
        raise ContractError("event.transmission[] needs at least two links — what reprices, by how much, if it happens")
    for i, link in enumerate(tr):
        if not isinstance(link, dict):
            raise ContractError(f"event.transmission[{i}] must be an object {{step, figure, source, as_of}}")
        for k in ("step", "figure", "source", "as_of"):
            if not str(link.get(k) or "").strip():
                raise ContractError(f"event.transmission[{i}].{k} is required — transmission is measured, not asserted")
        if not re.search(r"\d", str(link.get("figure"))):
            raise ContractError(f"event.transmission[{i}].figure must carry a number (how much, per what)")
        try:
            dt.date.fromisoformat(str(link.get("as_of")))
        except ValueError:
            raise ContractError(f"event.transmission[{i}].as_of must be ISO yyyy-mm-dd")

    tt = idea.get("the_trade") or {}
    if not isinstance(tt, dict):
        raise ContractError("the_trade must be an object")
    pay = event_payoff(tt.get("structure"), tt.get("strikes"), tt.get("premium_pct_of_width"), tt.get("premium"))
    und = str(tt.get("underlying") or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", und):
        raise ContractError("the_trade.underlying must be a listed ticker (the fund or stock the options are on)")
    err = _ticker_exists_error(f"ticker:{und}")
    if err:
        raise ContractError(f"the_trade.underlying: {err}")
    try:
        expiry = dt.date.fromisoformat(str(tt.get("expiry")))
    except (TypeError, ValueError):
        raise ContractError("the_trade.expiry must be the listed expiry as an ISO date")
    if expiry < resolves:
        raise ContractError(f"the_trade.expiry ({expiry}) is before event.resolves_by ({resolves}) — the option must outlive the event")
    if _months_between(idea_date, expiry) > EVENT_MAX_RESOLVE_MONTHS + 1.05:
        raise ContractError("the_trade.expiry is more than a month past the six-month resolution limit")
    bl = str(tt.get("buy_line") or "").strip()
    if not re.search(r"\b(most|maximum|max)\b[^.]{0,40}\b(lose|loss)\b|\b(lose|loss)\b[^.]{0,40}\b(most|maximum|max)\b", bl, re.I) \
            and not re.search(r"premium[^.]{0,40}\b(is|=)\b[^.]{0,20}\b(the\s+)?(most|maximum|max)", bl, re.I):
        raise ContractError("the_trade.buy_line must state the premium as the most the trade can lose "
                            "(e.g. 'TLT 80/86 call spread to Dec 18; premium is the most you can lose')")

    er = idea.get("expected_return")
    if not isinstance(er, dict):
        raise ContractError("expected_return{payoff_ratio, breakeven_odds, edge_odds, loss_at_stop_pct} is required")
    if pay["payoff_ratio"] is None:
        # A single option has no cap, so the note states the ratio it is
        # underwriting and the market odds it reads from the price.
        ratio = _num(er.get("payoff_ratio"))
        be = _num(er.get("breakeven_odds"))
        if ratio is None or ratio <= 0 or be is None or not (0 < be < 100):
            raise ContractError("a single option has no payoff cap: state expected_return.payoff_ratio (the payoff "
                                "underwritten per unit of premium) and breakeven_odds (= 100 / (ratio + 1)) explicitly")
        if abs(be - 100.0 / (ratio + 1.0)) > 1.0:
            raise ContractError(f"expected_return.breakeven_odds {be:g}% does not match the payoff ratio "
                                f"({100.0 / (ratio + 1.0):.1f}% for {ratio:g} to 1)")
    else:
        ratio, be = pay["payoff_ratio"], pay["breakeven_odds_pct"]
        for k, want in (("payoff_ratio", ratio), ("breakeven_odds", be)):
            got = _num(er.get(k))
            if got is None or abs(got - want) > 0.05 * max(1.0, abs(want)):
                raise ContractError(f"expected_return.{k} is {er.get(k)!r}; from the strikes and premium it is {want:.2f}")
    edge_odds = _num(er.get("edge_odds"))
    if edge_odds is None or not (0 < edge_odds < 100):
        raise ContractError("expected_return.edge_odds must be the note's own probability of the event, in per cent")
    if edge_odds < EVENT_MIN_ODDS_MULTIPLE * be:
        raise ContractError(
            f"odds gap: our odds {edge_odds:g}% are less than {EVENT_MIN_ODDS_MULTIPLE:g}x the breakeven {be:.1f}% the "
            f"premium implies — the trade is not mispriced enough to pay for")
    if len(str(er.get("edge_odds_basis") or "").strip()) < 60:
        raise ContractError("expected_return.edge_odds_basis must argue the gap with dated facts, not conviction (min 60 chars)")
    loss = _num(er.get("loss_at_stop_pct"))
    if loss is None or abs(abs(loss) - 100.0) > 1e-9:
        raise ContractError("expected_return.loss_at_stop_pct is always 100 for an event note — the premium is the stop")
    # The headline return the note calls for: the full payoff, in per cent of
    # premium. Written here so the weekly review and the scorer grade one number.
    er["pct"] = round(ratio * 100.0, 1)
    if len(str(er.get("basis") or "").strip()) < 20:
        er["basis"] = (f"the spread paying off in full at expiry: {ratio:.2f} to 1 on the premium paid "
                       f"({be:.0f}% breakeven odds against our {edge_odds:g}%)")
    er.setdefault("instrument", f"{und} {str(tt.get('structure')).replace('_', ' ')}, expiry {expiry.isoformat()}")

    # The scorecard block is derived, not authored: the scorer marks the
    # underlying's close against the strikes at expiry (Decision 4), and the
    # book / correlation tests measure the underlying (Decision 5).
    sc = idea.get("scorecard")
    if not isinstance(sc, dict) or not sc.get("legs"):
        sc = {"legs": [{"series": f"ticker:{und}", "side": "long" if str(tt.get("structure")).startswith("call") else "short",
                        "measure": "pct_change", "label": f"{und} ({str(tt.get('structure')).replace('_', ' ')})",
                        "short_label": f"{und} {str(tt.get('structure')).replace('_', ' ')}"}]}
        idea["scorecard"] = sc
    hm = max(1, int(round(_months_between(idea_date, expiry))))
    sc["horizon_months"] = min(hm, MAX_HORIZON_MONTHS)
    sc.pop("horizon_weeks", None)
    sc["event"] = {"structure": tt.get("structure"), "underlying": und, "strikes": list(tt.get("strikes")),
                   "expiry": expiry.isoformat(), "resolves_by": resolves.isoformat(),
                   "width": pay["width"], "premium": round(pay["premium"], 4),
                   "premium_pct_of_width": _num(tt.get("premium_pct_of_width")),
                   "payoff_ratio": round(ratio, 4), "breakeven_odds_pct": round(be, 2),
                   "edge_odds_pct": edge_odds, "implied_odds_pct": implied}
    if sc.get("invalidation"):
        raise ContractError("an event note has no price stop — the premium is the stop; remove scorecard.invalidation")
    if not str(sc.get("note") or "").strip():
        sc["note"] = ("Event note: scored at expiry from the underlying's close against the strikes; the premium is the "
                      "maximum loss and there is no price stop. Closes early only on a broken critical review condition.")
    idea["sizing"] = idea.get("sizing") if isinstance(idea.get("sizing"), dict) else {}


# ---------------------------------------------------------------------------
# OPTION VEHICLES (2026-10-29, bug #1277). The Oct 22 note told the reader to
# buy "SPY ATM puts, Nov 13 expiry" and its scorecard marked the S&P 500 index
# short, with a note saying "the put premium is not machine-checkable". It is
# — from the underlying's close, an implied-volatility series we carry and a
# rate (score_trade_ideas.score_option) — and the index short was the return
# of a trade nobody was told to make: +0.2% on the row while the put was down
# 11% from the entry close. LESSONS 6.18(a): the scorecard grades the vehicle
# the reader is told to trade.
#
# Rule: from OPTION_VEHICLE_FROM, a directional note whose trade names a put,
# call or option (and is not an event note, which has its own block) states
# `the_trade.option {underlying, structure, strike, expiry, premium?}` — the
# one contract the reader is told to buy — and the scorecard leg is DERIVED
# from it: the underlying's ticker, marked as that option. A note may still
# offer shares with options as an alternative; then it says so in
# `the_trade.shares_primary` (one sentence) and is marked on the shares. A
# note that names only an option and carries neither field does not publish.
# Notes dated before OPTION_VEHICLE_FROM are grandfathered unless they carry
# an option block, in which case it is validated.
OPTION_VEHICLE_FROM = "2026-10-29"
OPTION_WORD_RE = re.compile(r"\b(puts?|calls?|options?|straddles?|strangles?)\b", re.I)
OPTION_VEHICLE_STRUCTURES = {"put", "call"}
# The implied-volatility series the scorer values the option with, by
# underlying. Anything else must name option.iv_series explicitly.
OPTION_IV_DEFAULTS = {"SPY": "vix", "VOO": "vix", "IVV": "vix", "SPX": "vix",
                      "QQQ": "vxn", "GLD": "gvz", "IAU": "gvz", "USO": "ovx"}
OPTION_RATE_DEFAULT = "ust_2y"


def _option_grandfathered(idea: dict) -> bool:
    """A note dated before OPTION_VEHICLE_FROM that carries an option block —
    i.e. a published note re-stated on its real vehicle after the fact."""
    sc = idea.get("scorecard") if isinstance(idea.get("scorecard"), dict) else {}
    tt = idea.get("the_trade") if isinstance(idea.get("the_trade"), dict) else {}
    has = isinstance(sc.get("option"), dict) or isinstance(tt.get("option"), dict)
    return has and str(idea.get("date", "")) < OPTION_VEHICLE_FROM


def _names_an_option(tt: dict, idea: dict) -> bool:
    txt = " ".join(str(tt.get(k) or "") for k in ("buy", "buy_line", "sell", "sell_line", "short", "short_line"))
    txt += " " + str(idea.get("instrument") or "")
    return bool(OPTION_WORD_RE.search(txt))


def _validate_option_vehicle(idea: dict, idea_date: dt.date, warnings: list) -> None:
    """Derives scorecard.legs and scorecard.option from the_trade.option, or
    confirms the note has claimed shares as the primary vehicle. Raises
    ContractError."""
    tt = idea.get("the_trade")
    if not isinstance(tt, dict):
        raise ContractError("the_trade must be an object")
    opt = tt.get("option")
    sc = idea.get("scorecard") if isinstance(idea.get("scorecard"), dict) else {}
    dated_in = str(idea.get("date", "")) >= OPTION_VEHICLE_FROM
    if opt is None and not isinstance(sc.get("option"), dict):
        if not _names_an_option(tt, idea) or not dated_in:
            return
        if len(str(tt.get("shares_primary") or "").strip()) >= 20:
            return                        # shares are the vehicle; options offered as an alternative
        raise ContractError(
            "the_trade names a put, call or option, so the reader is being told to trade an option: state "
            "the_trade.option{underlying, structure (put|call), strike, expiry, premium (per share, optional)} "
            "and the scorecard will mark that option — or, if shares are the vehicle and the option is only an "
            "alternative, say so in the_trade.shares_primary (one sentence). The scorecard grades the vehicle "
            "the reader is told to trade (LESSONS 6.18), never its underlying.")
    if opt is None:
        opt = dict(sc.get("option") or {})   # a corrected note may carry only the scorecard block
    if not isinstance(opt, dict):
        raise ContractError("the_trade.option must be an object")
    und = str(opt.get("underlying") or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", und):
        raise ContractError("the_trade.option.underlying must be the listed ticker the option is on (e.g. SPY)")
    err = _ticker_exists_error(f"ticker:{und}")
    if err:
        raise ContractError(f"the_trade.option.underlying: {err}")
    structure = str(opt.get("structure") or "").strip().lower()
    if structure not in OPTION_VEHICLE_STRUCTURES:
        raise ContractError("the_trade.option.structure must be put or call (a spread on a named event is kind: event)")
    strike = _num(opt.get("strike"))
    if strike is None or strike <= 0:
        raise ContractError("the_trade.option.strike must be the strike price, a positive number")
    try:
        expiry = dt.date.fromisoformat(str(opt.get("expiry")))
    except (TypeError, ValueError):
        raise ContractError("the_trade.option.expiry must be the listed expiry as an ISO date")
    if expiry <= idea_date:
        raise ContractError(f"the_trade.option.expiry ({expiry}) must be after the note's date")
    premium = opt.get("premium")
    if premium not in (None, ""):
        premium = _num(premium)
        if premium is None or premium <= 0:
            raise ContractError("the_trade.option.premium, when stated, is the price per share paid — a positive number; "
                                "omit it and the scorer models the premium at the entry close")
    else:
        premium = None
    iv_series = str(opt.get("iv_series") or OPTION_IV_DEFAULTS.get(und) or "").strip()
    if not iv_series:
        raise ContractError(f"the_trade.option.iv_series is required for {und}: the implied-volatility series the option "
                            f"is valued with (defaults exist only for {', '.join(sorted(OPTION_IV_DEFAULTS))})")
    rate_series = str(opt.get("rate_series") or OPTION_RATE_DEFAULT).strip()
    hist = _history()
    if hist is not None:
        for k, label in ((iv_series, "iv_series"), (rate_series, "rate_series")):
            if k not in hist:
                raise ContractError(f"the_trade.option.{label} {k!r} is not in indicator_history.json — the option cannot be valued")
    div = _num(opt.get("dividend_yield_pct"), 0.0)
    if div is None or div < 0 or div > 20:
        raise ContractError("the_trade.option.dividend_yield_pct must be a small positive percentage or omitted")

    side = "short" if structure == "put" else "long"
    short_label = f"{und} {strike:g} {structure}, {expiry.strftime('%b')} {expiry.day}"
    legs = sc.get("legs")
    if isinstance(legs, list) and legs:
        if len(legs) != 1 or not isinstance(legs[0], dict):
            raise ContractError("an option-vehicle note has exactly one scorecard leg: the underlying the option is on")
        if str(legs[0].get("series")) != f"ticker:{und}":
            raise ContractError(
                f"scorecard.legs[0] names {legs[0].get('series')!r} but the option is on {und}: the leg must be "
                f"'ticker:{und}' so the option is marked from the fund the reader actually holds it on")
        if legs[0].get("side") != side:
            raise ContractError(f"scorecard.legs[0].side must be {side!r} for a {structure}")
        legs[0].setdefault("label", f"{und} (the fund the {structure}s are on)")
        legs[0]["short_label"] = short_label
        legs[0].setdefault("measure", "pct_change")
    else:
        sc["legs"] = [{"series": f"ticker:{und}", "side": side, "measure": "pct_change",
                       "label": f"{und} (the fund the {structure}s are on)", "short_label": short_label}]
    sc["option"] = {"underlying": und, "structure": structure, "strike": strike, "expiry": expiry.isoformat(),
                    "premium": premium, "iv_series": iv_series, "rate_series": rate_series,
                    "dividend_yield_pct": div}
    idea["scorecard"] = sc
    tt["option"] = {"underlying": und, "structure": structure, "strike": strike, "expiry": expiry.isoformat(),
                    "premium": premium, "iv_series": iv_series, "rate_series": rate_series,
                    "dividend_yield_pct": div}
    er = idea.get("expected_return")
    if isinstance(er, dict):
        inst = str(er.get("instrument") or "")
        if not OPTION_WORD_RE.search(inst):
            raise ContractError("expected_return.instrument must name the option: the called-for return and the loss "
                                "at the stop are stated on the premium, which is what the scorecard marks")
        loss = _num(er.get("loss_at_stop_pct"))
        if loss is not None and abs(loss) > 100.0 + 1e-9:
            raise ContractError("expected_return.loss_at_stop_pct cannot exceed 100 on an option — the premium is the most it can lose")
        upct = _num(er.get("underlying_pct"))
        if upct is None or upct <= 0:
            raise ContractError("expected_return.underlying_pct is required on an option-vehicle note: the move in the "
                                "underlying the note calls for, in per cent (the book test paces the underlying; the "
                                "premium return is what the scorecard marks)")
    if not str(sc.get("note") or "").strip():
        sc["note"] = (f"Marked as the {short_label} the note tells the reader to buy: valued every session from "
                      f"{und}'s close with a Black-Scholes model, the {iv_series} series as implied volatility and "
                      f"the {rate_series} series as the rate; intrinsic value at expiry. The return is on the premium, "
                      f"which is the most it can lose. The exit level on the underlying still closes the call.")


def _validate_weight(idea: dict, fallback: bool, warnings: list) -> None:
    """Decision 5 — every note carries sizing.weight, banded by its type."""
    sz = idea.get("sizing")
    if not isinstance(sz, dict):
        raise ContractError("sizing{weight} is required — the book is a notional 100 and every call is sized against it")
    w = _num(sz.get("weight"))
    if w is None:
        raise ContractError("sizing.weight must be a number out of 100 (standard idea 10; Decision-1 fallback 5; "
                            f"event idea {EVENT_WEIGHT_MIN:g} to {EVENT_WEIGHT_MAX:g} of premium)")
    if is_event(idea):
        if not (EVENT_WEIGHT_MIN - 1e-9 <= w <= EVENT_WEIGHT_MAX + 1e-9):
            raise ContractError(f"sizing.weight is {w:g} — an event idea is sized by premium at risk, "
                                f"{EVENT_WEIGHT_MIN:g} to {EVENT_WEIGHT_MAX:g} of the book's 100")
    elif fallback:
        if abs(w - FALLBACK_WEIGHT) > 1e-9:
            raise ContractError(f"sizing.weight is {w:g} — a note published under the fewer-than-five-cases fallback "
                                f"is sized at {FALLBACK_WEIGHT:g} of 100, half the standard idea")
    elif abs(w - STANDARD_WEIGHT) > 1e-9:
        raise ContractError(f"sizing.weight is {w:g} — a standard idea is sized at {STANDARD_WEIGHT:g} of 100")
    sz["weight"] = w
    sz.setdefault("basis", "of a notional book of 100; fixed at publication and never changed")


def _validate_regime_match_v2(idea: dict, bt: dict, er: dict, warnings: list) -> bool:
    """Decision 1 — the three-field regime match. Returns True if the note
    publishes under the fewer-than-five-cases fallback."""
    rm = bt.get("regime_match")
    if not isinstance(rm, dict):
        raise ContractError(
            "edge.backtest.regime_match must be an object {factor, matching_cases, result, dependence}: the factor "
            "the note says is driving the move (with today's reading), how many backtest cases share today's state on "
            "it, the result inside them, and the correlation of every case's forward return with the factor's change "
            "over the hold")
    factor = str(rm.get("factor") or "").strip()
    if len(factor) < 20 or not re.search(r"\d", factor):
        raise ContractError("regime_match.factor must name the one thing driving the move, with today's reading "
                            "(e.g. 'the 10-year yield, 5.12% today, a 20-year high')")
    try:
        mc = int(rm.get("matching_cases"))
    except (TypeError, ValueError):
        raise ContractError("regime_match.matching_cases must be a whole number — how many backtest cases share today's state")
    if mc < 0:
        raise ContractError("regime_match.matching_cases cannot be negative")
    if mc >= MIN_REGIME_MATCH_EPISODES:
        res = str(rm.get("result") or "").strip()
        if len(res) < 40 or not re.search(r"\d", res):
            raise ContractError(f"regime_match.result must state the outcome inside the {mc} matching cases, with the "
                                "numbers, and it must clear the baseline on its own (min 40 chars)")
        if re.search(r"\b(below|under|fails?|did not clear|does not clear|worse than)\b[^.]{0,40}\bbaseline\b", res, re.I):
            raise ContractError("regime_match.result says the edge does not clear the baseline inside the matching cases "
                                "— the edge is out of sample for the one thing the note says matters; no note")
        return False
    # Fewer than five: the dependence check.
    dep = rm.get("dependence")
    if not isinstance(dep, dict):
        raise ContractError(
            f"regime_match.matching_cases is {mc} (fewer than {MIN_REGIME_MATCH_EPISODES}), so regime_match.dependence"
            "{correlation, method} is required: the correlation across ALL backtest cases between each case's forward "
            "return and the factor's change over the holding period, and how it was computed")
    corr = _num(dep.get("correlation"))
    if corr is None or not (-1.0 <= corr <= 1.0):
        raise ContractError("regime_match.dependence.correlation must be a number between -1 and 1")
    if len(str(dep.get("method") or "").strip()) < 40:
        raise ContractError("regime_match.dependence.method must say how the correlation was computed (series, window, "
                            "cases; min 40 chars)")
    if abs(corr) >= MAX_DEPENDENCE_CORRELATION:
        raise ContractError(
            f"fallback refused: only {mc} past case(s) share today's state on the named factor, and the cases' forward "
            f"returns ran at {corr:+.2f} correlation with the factor's change — the history depended on the condition "
            f"(limit {MAX_DEPENDENCE_CORRELATION:.2f} in absolute value). The sample is from a different world.")
    for k, txt in (("other_side", str(idea.get("other_side") or "")),
                   ("edge.summary", str((idea.get("edge") or {}).get("summary") or ""))):
        if not FALLBACK_DISCLOSURE_RE.search(txt):
            raise ContractError(
                f"fallback disclosure missing in {k}: say plainly that no (or only {mc}) past cases had today's "
                "condition on the named factor — e.g. 'Only one of the seven past cases had the Fed raising rates as "
                "it is today.'")
    pct, loss = _num(er.get("pct")), _num(er.get("loss_at_stop_pct"))
    if pct is not None and loss is not None and loss > pct / FALLBACK_STOP_FRACTION + 1e-9:
        msg = (f"fallback stop: loss at the stop is {loss:g}% against an expected {pct:g}% — under the fewer-than-five-cases "
               f"fallback the stop may be at most one third of the expected return ({pct / FALLBACK_STOP_FRACTION:.2f}%)")
        if _option_grandfathered(idea):
            warnings.append("GRANDFATHERED (vehicle re-stated on the option, #1277): " + msg)
        else:
            raise ContractError(msg)
    warnings.append(f"published under the Decision-1 fallback: {mc} matching case(s), dependence correlation {corr:+.2f}, "
                    f"weight {FALLBACK_WEIGHT:g}, one-third stop")
    return True


def _validate_threshold_scan(bt: dict, yrs: float) -> None:
    """Decision 2 — the ten-year minimum gives way to full instrument history
    plus a threshold-stability check."""
    if yrs >= MIN_POSITIONING_WINDOW_YEARS:
        return
    if bt.get("full_history") is not True or not str(bt.get("first_report") or "").strip():
        raise ContractError(
            f"edge.backtest.window_years is {yrs:g} — a positioning edge is measured on at least "
            f"{MIN_POSITIONING_WINDOW_YEARS} years, OR on the instrument's FULL history from the first CFTC report "
            "(set edge.backtest.full_history: true and first_report: <date>) when the contract or trader category is "
            "younger than ten years. The Aug 14 euro edge existed only inside a 3-year window; over 22 years it lost.")
    scan = bt.get("threshold_scan")
    pub = _num(bt.get("threshold"))
    if pub is None or pub <= 0:
        raise ContractError("edge.backtest.threshold (the published percentile, e.g. 2 for the 2nd percentile) is "
                            "required with full_history")
    if not isinstance(scan, list) or len(scan) < 3:
        raise ContractError(
            "edge.backtest.threshold_scan[] is required with full_history: one row {threshold, cases, avg, baseline, "
            "edge} per threshold from the published percentile to twice it (e.g. 2nd, 3rd, 4th, 5th), at the published hold")
    rows = []
    for i, r in enumerate(scan):
        if not isinstance(r, dict):
            raise ContractError(f"threshold_scan[{i}] must be an object")
        t, e = _num(r.get("threshold")), _num(r.get("edge"))
        if t is None or e is None:
            raise ContractError(f"threshold_scan[{i}] needs numeric threshold and edge (average minus baseline)")
        rows.append((t, e))
    rows.sort()
    ts = [t for t, _ in rows]
    if min(ts) > pub + 1e-9 or max(ts) < 2 * pub - 1e-9:
        raise ContractError(f"threshold_scan must run from the published threshold ({pub:g}) to twice it ({2 * pub:g}); "
                            f"it covers {min(ts):g} to {max(ts):g}")
    base_sign = 1 if rows[0][1] > 0 else -1 if rows[0][1] < 0 else 0
    if base_sign == 0:
        raise ContractError("threshold_scan: the edge at the published threshold is zero — there is no edge to publish")
    for t, e in rows:
        if (e > 0) - (e < 0) != base_sign:
            raise ContractError(
                f"threshold-stability check failed: the edge is {rows[0][1]:+.1f} at the {rows[0][0]:g}th percentile but "
                f"{e:+.1f} at the {t:g}th — a sign flip. The signal does not survive moving the threshold; refused.")


def _validate_short_tests(idea: dict, bt: dict) -> None:
    """Decision 3 — lagging is not falling."""
    pt = idea.get("position_type")
    if pt == "outright short":
        ab = bt.get("absolute")
        if not isinstance(ab, dict):
            raise ContractError(
                "an outright short needs edge.backtest.absolute{median, win_rate} — the asset's OWN forward return "
                "over the hold against its own unconditional return. A relative edge (A lags the market) supports a "
                "pair only; an asset can lag and still rise, and the short then drags.")
        med, wr = _num(ab.get("median")), _num(ab.get("win_rate"))
        if med is None or wr is None:
            raise ContractError("edge.backtest.absolute.median and .win_rate must be numbers (median % return of the asset "
                                "itself; share of cases in which it fell)")
        if med >= 0:
            raise ContractError(
                f"outright short refused: the asset's own median forward return in the backtest is {med:+.1f}% — it "
                "lagged the market but did not fall. Express this as a pair (long/short spread) or drop it.")
    if pt == "long/short spread":
        rel = bt.get("relative")
        if not isinstance(rel, dict) or _num(rel.get("median")) is None or _num(rel.get("win_rate")) is None:
            raise ContractError(
                "a long/short spread needs edge.backtest.relative{median, win_rate} — the gap between the two legs "
                "over the hold (median, share of cases positive). The pair's return IS the gap.")


def _inverse_fund_named(tt: dict) -> str | None:
    for k in ("buy", "buy_line"):
        txt = str(tt.get(k) or "")
        if re.search(r"\binverse\b", txt, re.I):
            return "inverse"
        for sym in re.findall(r"\b[A-Z]{2,5}\b", txt):
            if sym in INVERSE_FUNDS:
                return sym
    return None


# ── the contract ───────────────────────────────────────────────────────────
def validate(idea: dict, published: list[dict] | None = None) -> list[str]:
    """Raise ContractError on anything that must not ship. Return warnings."""
    warnings: list[str] = []
    published = published or []
    v2 = is_v2(idea)
    event = is_event(idea)
    fallback = False

    # 0 — shape
    try:
        idea_date = dt.date.fromisoformat(str(idea.get("date")))
    except (ValueError, TypeError):
        raise ContractError(f"date must be ISO yyyy-mm-dd, got {idea.get('date')!r}")
    if event:
        if not v2:
            raise ContractError(f"kind: event is accepted on notes dated from {CONTRACT_V2_FROM}")
        # Decision 4 — the event block, the odds gap, the transmission and the
        # defined-risk structure; also derives the scorecard block.
        _validate_event(idea, idea_date, warnings)

    missing = [k for k in REQUIRED if not idea.get(k)]
    if missing:
        raise ContractError(f"missing required field(s): {', '.join(missing)}")

    # 0b — dated facts in the headline (2026-10-30, LESSONS 6.28). A title in
    # the present tense ("Credit spreads widening") is true the day it is
    # written and stays on the tile for weeks; the Oct 22 one was false within
    # a week. Write the move with its size and window ("66bp wider in six
    # weeks") — a dated fact stays true.
    if str(idea.get("date", "")) >= REVIEW_CHECKS_FROM:
        for fld in ("title", "dek"):
            m = TREND_TENSE_RE.search(str(idea.get(fld) or ""))
            if m:
                raise ContractError(
                    f"{fld} uses the present-tense trend {m.group(0)!r} — it goes stale while the note is live. "
                    "State the dated fact instead: the move, its size and its window (e.g. '66bp wider in six weeks')")
    if not event:
        # 2026-10-29 (#1277) — a directional note whose vehicle is a listed
        # option is marked as that option; derives the scorecard leg.
        _validate_option_vehicle(idea, idea_date, warnings)

    if idea["kind"] not in VALID_KINDS:
        raise ContractError(f"kind must be one of {sorted(VALID_KINDS)}, got {idea['kind']!r}")
    for key in ("thesis", "risks", "evidence"):
        if not isinstance(idea[key], list) or not idea[key]:
            raise ContractError(f"{key} must be a non-empty list")
    if len(idea["thesis"]) < 3:
        raise ContractError("thesis needs at least three points — a one-line call is not a note")
    if not isinstance(idea["levels"], dict):
        raise ContractError("levels must be an object")

    # 1 — every number carries provenance
    for i, e in enumerate(idea["evidence"]):
        if not isinstance(e, dict):
            raise ContractError(f"evidence[{i}] must be an object")
        for k in ("claim", "value", "source", "as_of"):
            if not str(e.get(k, "")).strip():
                raise ContractError(f"evidence[{i}] is missing {k} — a figure with no provenance is not printable")
        try:
            as_of = dt.date.fromisoformat(str(e["as_of"]))
        except ValueError:
            raise ContractError(f"evidence[{i}].as_of must be ISO yyyy-mm-dd, got {e['as_of']!r}")
        if as_of > idea_date:
            raise ContractError(f"evidence[{i}].as_of ({as_of}) is after the note's date — a note cannot cite the future")
        if (idea_date - as_of).days > 45:
            warnings.append(f"evidence[{i}] is {(idea_date - as_of).days} days old ({e['source']})")

    # 2 — falsifiable
    if not _is_concrete(idea["levels"].get("invalidation", "")):
        raise ContractError(
            "levels.invalidation must be concrete — name the level, date or event that proves the idea wrong")

    # 3 — balanced
    other = str(idea["other_side"]).strip()
    if len(other) < 60:
        raise ContractError("other_side must be a real counter-argument, not a hedge clause (min 60 chars)")

    # 3b — the reader must know what the position IS before any number
    if idea["position_type"] in RETIRED_POSITION_TYPES:
        raise ContractError(
            f"position_type {idea['position_type']!r} is retired — {RETIRED_POSITION_TYPES[idea['position_type']]}")
    if idea["position_type"] not in POSITION_TYPES:
        raise ContractError(f"position_type must be one of {sorted(POSITION_TYPES)}, got {idea['position_type']!r}")
    pe = str(idea["call"]).strip()
    if not (60 <= len(pe) <= 340):
        raise ContractError(f"call must be a claim of 60-340 chars, got {len(pe)}")
    first = re.sub(r"[^a-z]", "", pe.split()[0].lower()) if pe.split() else ""
    if first in IMPERATIVE_OPENERS:
        raise ContractError(
            f"call opens with the imperative {first!r} — that is an order, not a claim. "
            "State what is likely to happen and over what period; the instruction belongs in `the_trade`.")
    if not HORIZON_PHRASE_RE.search(pe):
        raise ContractError(
            "call must name its horizon — a six-month view and a five-year view are different products. "
            "e.g. 'over the next 12 months', 'over a five-to-ten-year horizon', 'through 2027'. "
            "(An instrument tenor such as 'the 10-year Treasury' is not a horizon.)")
    hits = [w for w in JARGON if re.search(rf"\b{re.escape(w)}\b", pe, re.I)]
    if hits:
        raise ContractError(
            f"call leans on desk shorthand {hits} — say it in words the argument can carry. "
            "Technical vocabulary is welcome; opaque shorthand is not.")
    hz = str(idea["horizon"]).strip()
    if not HORIZON_PERIOD_RE.search(hz):
        raise ContractError(
            f"horizon must state an explicit period, got {hz!r} — 'medium term' is not a horizon.")
    months = _max_months(hz) or _max_months(pe)
    if months and months > MAX_HORIZON_MONTHS:
        raise ContractError(
            f"horizon reaches {months} months — a trade idea is a next-several-quarters proposition "
            f"(max {MAX_HORIZON_MONTHS}). A multi-year valuation view is an allocation opinion, not this product.")

    # 3d — the edge, and the baseline it was measured against
    edge = idea["edge"]
    if not isinstance(edge, dict):
        raise ContractError("edge must be an object")
    if edge.get("source") not in EDGE_SOURCES:
        raise ContractError(f"edge.source must be one of {sorted(EDGE_SOURCES)}, got {edge.get('source')!r}")
    if (edge.get("source") == "event") != event:
        raise ContractError("edge.source 'event' is for kind: event, and an event note's edge.source is 'event' — "
                            "the edge is the gap between our odds and the market's, not a backtest")
    bt = edge.get("backtest")
    if event:
        # Decision 4 — an event note has no backtest; the three event tests ran
        # in _validate_event. If the case for the trade would survive the event
        # NOT happening it is a standard note, and the playbook says so.
        bt = bt if isinstance(bt, dict) else {}
        if len(str(edge.get("summary") or "").strip()) < 80:
            raise ContractError("edge.summary for an event note states the odds gap in words (market odds, our odds, why) — min 80 chars")
    if not event and not isinstance(bt, dict):
        raise ContractError("edge.backtest is required — an idea with no measured base rate is an opinion")
    for k in (() if event else ("window", "n", "result", "baseline")):
        if not str(bt.get(k, "")).strip():
            raise ContractError(
                f"edge.backtest is missing {k}. Every field is load-bearing: `baseline` is the UNCONDITIONAL "
                "outcome over the same horizon, and without it a hit rate means nothing.")
    if not event:
        try:
            if int(bt["n"]) < 3:
                raise ContractError(f"edge.backtest.n is {bt['n']} — too few observations to claim an edge")
        except (TypeError, ValueError):
            raise ContractError(f"edge.backtest.n must be a number, got {bt['n']!r}")
    if edge["source"] == "positioning" and str(idea.get("date", "")) >= POSITIONING_RIGOUR_FROM:
        try:
            eps = int(bt.get("episodes"))
            yrs = float(bt.get("window_years"))
        except (TypeError, ValueError):
            raise ContractError(
                "a positioning edge must state edge.backtest.episodes (INDEPENDENT episodes, not weeks) and "
                "edge.backtest.window_years — a run of consecutive weekly reports at an extreme is one observation")
        if eps < MIN_POSITIONING_EPISODES:
            raise ContractError(
                f"edge.backtest.episodes is {eps} — a positioning edge needs at least {MIN_POSITIONING_EPISODES} "
                "independent episodes (13 clear weeks apart). Fewer is an anecdote; do not publish it.")
        if v2:
            # Decision 2 — ten years, OR the full instrument history plus a
            # threshold-stability check (one sign flip refuses the note).
            _validate_threshold_scan(bt, yrs)
        elif yrs < MIN_POSITIONING_WINDOW_YEARS:
            raise ContractError(
                f"edge.backtest.window_years is {yrs:g} — a positioning edge is measured on at least "
                f"{MIN_POSITIONING_WINDOW_YEARS} years. The Aug 14 euro edge (+3.18% in three months) existed only "
                "inside a 3-year window; over 22 years the same signal lost money.")
        if str(bt.get("percentile_basis", "")).strip().lower() != "expanding":
            raise ContractError(
                'edge.backtest.percentile_basis must be "expanding": rank each week against the history available '
                "THAT week. A percentile ranked against the whole sample, or a trailing 3-year window, knows the future "
                "or forgets the past — the site's 3-year percentile is a description, never the tested signal.")
        if not str(bt.get("trend_split", "")).strip():
            raise ContractError(
                "edge.backtest.trend_split is required for a positioning edge: the result with price ABOVE and BELOW "
                "its 200-day average, separately. Fading corn longs in an uptrend lost 10% on average; in wheat the "
                "fade worked anyway. The split is where that difference shows.")

    # 3d-bis — the sample has to contain today (2026-10-07, LESSONS 6.23). A
    # long-banks note published on 19 clean episodes and came down within the
    # hour: its own prose named the 10-year at a 20-year high as the cause of
    # the selloff, and 18 of the 19 episodes had entered with yields flat or
    # falling. The edge was measured in a world that did not contain today.
    # So every note names the factor it says caused the move, counts the
    # episodes that share today's state on it, and reports the result in
    # those alone — as a field, so the question cannot be skipped.
    if v2 and not event:
        # Decision 1 (2026-10-21) — {factor, matching_cases, result | dependence}.
        # Fewer than five matching cases is no longer an automatic veto: the
        # note may publish if the history did not ride the factor, disclosed,
        # at half size, with a one-third stop. `fallback` feeds the weight and
        # stop checks below.
        fallback = _validate_regime_match_v2(idea, bt, idea.get("expected_return") or {}, warnings)
    elif str(idea.get("date", "")) >= REGIME_MATCH_FROM and not event:
        rm = str(bt.get("regime_match") or "").strip()
        if len(rm) < MIN_REGIME_MATCH_CHARS or not re.search(r"\d", rm):
            raise ContractError(
                "edge.backtest.regime_match is required: name the factor the note says caused the move, how many "
                "backtest episodes share today's state on that factor, and the result in those episodes alone "
                f"(min {MIN_REGIME_MATCH_CHARS} chars, with the count). Fewer than {MIN_REGIME_MATCH_EPISODES} "
                "such episodes, or no edge inside them, is no note — an 'other side' paragraph that concedes "
                "it is the rejection written down.")
        m_eps = re.search(r"(\d+)\s+(?:of\s+\d+\s+)?(?:such\s+|matching\s+|backtest\s+)?episodes?", rm, re.I)
        if m_eps and int(m_eps.group(1)) < MIN_REGIME_MATCH_EPISODES:
            raise ContractError(
                f"edge.backtest.regime_match counts {m_eps.group(1)} episode(s) sharing today's state on the named "
                f"factor — fewer than {MIN_REGIME_MATCH_EPISODES}. The edge is out of sample for the one thing the "
                "note says matters; do not publish it.")

    # the truism check — a famous ratio may support a note, never drive it
    driver_text = " ".join([pe, str(idea["title"]), str(edge.get("summary", "")), str(idea.get("dek", ""))]).lower()
    hits = [t for t in TRUISM_SIGNALS if t in driver_text]
    if hits and edge["source"] not in ("relative value", "cross-asset divergence"):
        raise ContractError(
            f"the call/title leans on {hits} — a long-horizon valuation ratio is visible to anyone and says the "
            "same thing for years. It may appear as context in the thesis; it may not be the driver.")

    # 3e — variant perception: why is this not obvious?
    var = str(idea["variant"]).strip()
    if len(var) < 80:
        raise ContractError(
            "variant must say what consensus believes and where this differs (min 80 chars). "
            "If the answer is 'nothing', the idea is not worth publishing.")
    tt = idea["the_trade"]
    if not isinstance(tt, dict):
        raise ContractError("the_trade must be an object")
    # 2026-08-23 (Joe: "I dont agree to short gold. Thats insane."). A note whose
    # edge is RELATIVE has no long-only, ownership-free expression: the only ways
    # to hold "A lags B" are to short A, or to already own A and switch. If both
    # are off the table the honest label is `watch only` — and such a note has
    # nothing to buy. Requiring `buy` anyway forced the note to invent a purchase,
    # which is how "sell a slice of your existing gold" got written in the first
    # place. So `buy` is required for every position type EXCEPT `watch only`,
    # which must instead say what would MAKE it a position.
    if not str(tt.get("buy", "")).strip():
        raise ContractError("the_trade must be an object naming at least what is bought (`buy`)")
    if idea["position_type"] in ("outright short", "long/short spread") and not str(tt.get("short", "")).strip():
        raise ContractError(f"position_type {idea['position_type']!r} requires the_trade.short — say what is sold short")
    if idea["position_type"] not in ("outright short", "long/short spread") and str(tt.get("short", "")).strip():
        raise ContractError("the_trade.short is set but position_type says nothing is sold short — pick one")
    if v2 and not event:
        # Decision 3 — an outright short carries the absolute test; a pair
        # carries the relative test; an inverse fund is held a month at most.
        _validate_short_tests(idea, bt)
        inv_fund = _inverse_fund_named(tt)
        if inv_fund:
            wk = idea.get("scorecard", {}).get("horizon_weeks") if isinstance(idea.get("scorecard"), dict) else None
            try:
                wk = int(wk)
            except (TypeError, ValueError):
                wk = None
            if wk is None or wk > MAX_INVERSE_FUND_WEEKS:
                raise ContractError(
                    f"the_trade names an inverse fund ({inv_fund}); an inverse fund resets daily and drifts, so it is "
                    f"held at most {MAX_INVERSE_FUND_WEEKS} weeks — state scorecard.horizon_weeks (1 to "
                    f"{MAX_INVERSE_FUND_WEEKS}) or use puts / a pair instead")

    # 3e-ter — TILE LINES (Joe, 2026-09-14): "I want the home page trade idea
    # tile to be more succinct... Its too much writing." The homepage tile
    # prints the_trade as a scannable fact strip; a 40-word buy leg belongs in
    # the modal, not the strip. Optional `buy_line` / `sell_line` / `short_line`
    # give the tile a hand-written short form ("UNG shares, or 1–3 month
    # at-the-money call options"); without one the tile falls back to the leg's
    # first clause. Hard length cap so the strip stays scannable.
    for k in ("buy_line", "sell_line", "short_line"):
        v = str(tt.get(k, "") or "").strip()
        if not v:
            continue
        if not (8 <= len(v) <= 64):
            raise ContractError(f"the_trade.{k} is a tile display line: 8-64 characters, got {len(v)}")
        base = k[:-5]
        if not str(tt.get(base, "")).strip():
            raise ContractError(f"the_trade.{k} without the_trade.{base} — the short line abridges a real leg")

    # 3e-bis — RETAIL EXPRESSION (Joe, 2026-09-09): "I, and many other retail
    # traders, dont have access to futures. How can I short wheat without
    # futures?" Every leg of the_trade names a vehicle a standard US retail
    # brokerage account can hold: a listed stock, an ETF/ETN, or listed options
    # on one. Futures, forwards, swaps, CDX and CFDs are rejected as the NAMED
    # vehicle — the futures series may still be the signal and carry the levels
    # (the scorecard marks the series, not the vehicle), and the note states the
    # mapping in one line. Dated notes before 2026-09-09 are grandfathered so
    # --check stays green on the archive.
    if str(idea.get("date", "")) >= "2026-09-09":
        non_retail = re.compile(r"\b(futures?|forwards?|swaps?|CDX|CFDs?)\b", re.I)
        for k in ("buy", "sell", "short", "buy_line", "sell_line", "short_line"):
            m = non_retail.search(str(tt.get(k, "")))
            if m:
                raise ContractError(
                    f"the_trade.{k} names {m.group(0)!r} — express the trade in something a retail "
                    "account can hold: a listed stock, an ETF/ETN, or listed options on one. The "
                    "futures series may still carry the signal and the levels; the vehicle must be retail.")

    # 3c — charts. Joe, 2026-08-13: "I'd like to include charts embedded in the
    # tile and note. Several charts to show visuals of what you're writing
    # about." Charts are DECLARATIVE: a note names a series that already exists
    # in indicator_history.json and the site draws it. Nothing is plotted from
    # numbers typed into the note, so a chart can never disagree with the
    # sentence beside it — and a note cannot illustrate a series we do not have.
    charts = idea["charts"]
    if not isinstance(charts, list) or not (2 <= len(charts) <= 5):
        raise ContractError(f"charts must be a list of 2 to 5 entries, got {len(charts) if isinstance(charts, list) else type(charts).__name__}")
    hist = _history()
    for i, c in enumerate(charts):
        if not isinstance(c, dict):
            raise ContractError(f"charts[{i}] must be an object")
        for k in ("series", "title", "caption", "source"):
            if not str(c.get(k, "")).strip():
                raise ContractError(f"charts[{i}] is missing {k}")
        if c.get("window") and c["window"] not in ("1y", "3y", "5y", "10y", "20y", "full"):
            raise ContractError(f"charts[{i}].window must be one of 1y/3y/5y/10y/20y/full, got {c['window']!r}")
        if hist is not None:
            ser = hist.get(c["series"])
            if ser is None:
                raise ContractError(
                    f"charts[{i}] names series {c['series']!r}, which is not in indicator_history.json — "
                    "a chart of a series we do not carry cannot be drawn")
            pts = [p for p in (ser.get("points") or []) if p and p[1] is not None]
            if len(pts) < 24:
                raise ContractError(f"charts[{i}] series {c['series']!r} has only {len(pts)} observations — too few to plot")
        else:
            warnings.append(f"charts[{i}] series {c['series']!r} NOT verified — no indicator_history.json available")
    if len({c.get("series") for c in charts}) < len(charts):
        raise ContractError("two charts plot the same series — each chart must show something the others do not")

    # 3f — the scorecard: the same position, in a form that can be marked.
    sc = idea["scorecard"]
    if not isinstance(sc, dict):
        raise ContractError("scorecard must be an object")
    legs = sc.get("legs")
    if not isinstance(legs, list) or not legs:
        raise ContractError("scorecard.legs must be a non-empty list — name the series the mark is taken from")
    # A note that says "buy X, funded by selling Y" must be scored on X AND Y.
    # The 2026-08-17 bank note was scored on a single banks-over-S&P ratio while
    # its funding paragraph named the Nasdaq: we graded a different trade than
    # we recommended, and nothing in the contract caught it (Joe 2026-08-18).
    trade = idea.get("the_trade") or {}
    funds = any(str(trade.get(k) or "").strip() for k in ("sell", "short", "funded_by"))
    if funds and not any(l.get("side") == "short" for l in legs if isinstance(l, dict)):
        # One legitimate exception: the funding side is already inside the
        # instrument (buying EUR/USD sells dollars; adding a short DXY leg would
        # double the same exposure). That has to be CLAIMED in a field, not
        # inferred from prose — a rule you can satisfy by wording is not a rule.
        why = str(sc.get("funding_inside_instrument") or "").strip()
        if not why:
            raise ContractError(
                "the_trade names a sell / short / funded_by side, so scorecard.legs must carry a short leg for "
                "it — score the trade you recommended, not a proxy for it. If the funding side is already "
                "inside the instrument, set scorecard.funding_inside_instrument to a one-sentence explanation.")
    for i, leg in enumerate(legs):
        if not isinstance(leg, dict):
            raise ContractError(f"scorecard.legs[{i}] must be an object")
        if leg.get("side") not in SCORE_SIDES:
            raise ContractError(f"scorecard.legs[{i}].side must be long or short, got {leg.get('side')!r}")
        meas = leg.get("measure", "pct_change")
        if meas in RETIRED_MEASURES:
            raise ContractError(
                f"scorecard.legs[{i}].measure is {meas!r}, which is retired. A raw level move is not a return: "
                "it cannot be netted against the other leg, sized, or benchmarked. State a price series as "
                "pct_change, or a yield series as bond_return with a maturity_years.")
        if meas not in SCORE_MEASURES:
            raise ContractError(
                f"scorecard.legs[{i}].measure must be one of {sorted(SCORE_MEASURES)} — a yield or spread moves "
                "in levels, a price moves in percent, and marking one as the other is silently wrong")
        if meas == "bond_return":
            try:
                float(leg.get("maturity_years"))
            except (TypeError, ValueError):
                raise ContractError(
                    f"scorecard.legs[{i}].measure is bond_return but maturity_years is missing or not a number — "
                    "duration cannot be inferred from a yield alone")
        if _is_ticker_key(leg.get("series")):
            # Single-name legs (2026-08-31): "ticker:XYZ" is marked from the
            # prices_eod table, not indicator_history.json. The contract checks
            # the FORM here; existence is checked against the database when
            # credentials are in the environment, and otherwise left to the
            # scorer, which reports a missing ticker loudly as unscoreable.
            if not _TICKER_RE.match(leg["series"]):
                raise ContractError(
                    f"scorecard.legs[{i}].series {leg['series']!r} is not a valid ticker key — "
                    "expected ticker:SYMBOL (capital letters, digits, dot or dash)")
            err = _ticker_exists_error(leg["series"])
            if err:
                raise ContractError(f"scorecard.legs[{i}]: {err}")
        elif hist is not None:
            ser = hist.get(leg.get("series"))
            if ser is None:
                raise ContractError(
                    f"scorecard.legs[{i}] names series {leg.get('series')!r}, which is not in "
                    "indicator_history.json — a position we do not carry data for cannot be marked")
    if sc.get("horizon_weeks") not in (None, ""):
        if str(idea.get("date", "")) < BOOK_RULES_FROM:
            raise ContractError("scorecard.horizon_weeks is only accepted on notes dated from " + BOOK_RULES_FROM)
        if sc.get("horizon_months") not in (None, ""):
            raise ContractError("scorecard states both horizon_weeks and horizon_months — state one")
        try:
            wk = int(sc.get("horizon_weeks"))
        except (TypeError, ValueError):
            raise ContractError("scorecard.horizon_weeks must be a whole number of weeks")
        if not (1 <= wk <= MAX_HORIZON_WEEKS):
            raise ContractError(f"scorecard.horizon_weeks is {wk} — must be 1 to {MAX_HORIZON_WEEKS}")
        months = _scored_months(sc)
    else:
        try:
            months = int(sc.get("horizon_months"))
        except (TypeError, ValueError):
            raise ContractError("scorecard.horizon_months must be a whole number of months "
                                "(or state horizon_weeks for a sub-quarter trade)")
        if not (1 <= months <= MAX_HORIZON_MONTHS):
            raise ContractError(f"scorecard.horizon_months is {months} — must be 1 to {MAX_HORIZON_MONTHS}")
    # The prose `horizon` and the scored horizon must not disagree. They are the
    # same promise written twice, and if they drift the note says one thing and
    # is graded on another.
    stated = _max_months(hz)
    if stated and months > stated + 0.01:
        raise ContractError(
            f"scorecard.horizon_months ({months}) is longer than the horizon the note states ({stated}) — "
            "a call cannot be graded over a period it did not claim")
    inv = sc.get("invalidation")
    if inv is not None:
        if not isinstance(inv, dict):
            raise ContractError("scorecard.invalidation must be an object or omitted")
        if inv.get("op") not in SCORE_OPS:
            raise ContractError(f"scorecard.invalidation.op must be one of {sorted(SCORE_OPS)}")
        if inv.get("basis", "close") not in SCORE_BASES:
            raise ContractError(f"scorecard.invalidation.basis must be one of {sorted(SCORE_BASES)}")
        try:
            float(inv.get("level"))
        except (TypeError, ValueError):
            raise ContractError("scorecard.invalidation.level must be a number — a stop you cannot check is not a stop")
        if _is_ticker_key(inv.get("series")):
            if not _TICKER_RE.match(inv["series"]):
                raise ContractError(
                    f"scorecard.invalidation.series {inv['series']!r} is not a valid ticker key — "
                    "expected ticker:SYMBOL (capital letters, digits, dot or dash)")
            err = _ticker_exists_error(inv["series"])
            if err:
                raise ContractError(f"scorecard.invalidation: {err}")
        elif hist is not None and inv.get("series") not in hist:
            raise ContractError(
                f"scorecard.invalidation names series {inv.get('series')!r}, which is not in indicator_history.json")
    elif _is_concrete(idea["levels"].get("invalidation", "")):
        warnings.append(
            "levels.invalidation states a condition in prose but scorecard.invalidation is absent — the stop "
            "will not be enforced when the note is marked")

    # 3f-bis — review conditions (2026-09-30). Joe: "Do we have a process where
    # we analyze intramonth ... to ensure the thesis is still intact?" The
    # weekly review (scripts/thesis_review.py) re-measures each claim a note
    # relied on. For that to be a check and not a vibe, the claims have to be
    # written down as measurable conditions AT PUBLICATION, when they can still
    # be written honestly. Every note dated on or after REVIEW_CONDITIONS_FROM
    # carries at least one, and at least one is critical — the claim the call
    # cannot survive losing. Older notes are reviewed from their thesis prose.
    if str(idea.get("date", "")) >= REVIEW_CONDITIONS_FROM:
        rc = idea.get("review_conditions")
        if not isinstance(rc, list) or not rc:
            raise ContractError(
                "review_conditions[] is required — list the measurable claims the call rests on, each with "
                "`claim` (one sentence), `measure` (what is read and where), `at_publication` (the reading now, "
                "with its as-of), `holds_while` (the condition under which the claim still stands) and "
                "`critical` (true for the claim the call cannot survive losing)")
        crit = False
        for i, c in enumerate(rc):
            if not isinstance(c, dict):
                raise ContractError(f"review_conditions[{i}] must be an object")
            for k in ("claim", "measure", "at_publication", "holds_while"):
                if not str(c.get(k) or "").strip():
                    raise ContractError(f"review_conditions[{i}].{k} is required")
            if not isinstance(c.get("critical"), bool):
                raise ContractError(f"review_conditions[{i}].critical must be true or false")
            crit = crit or c["critical"]
        if not crit:
            raise ContractError("review_conditions: at least one condition must be critical")
        if str(idea.get("date", "")) >= REVIEW_CHECKS_FROM:
            import daily_thesis_check as _DTC
            _h = _history()
            known = set(_h) if _h is not None else None
            for i, c in enumerate(rc):
                if not c.get("critical") and not c.get("check"):
                    continue
                try:
                    if not c.get("check"):
                        raise _DTC.CheckError(
                            f"review_conditions[{i}] is critical and needs `check` {{series, op, level}} — the machine "
                            "form of holds_while that the daily thesis check re-measures every evening")
                    _DTC.validate_check(c["check"], f"review_conditions[{i}]", known)
                    if c.get("critical"):
                        if not c.get("driver"):
                            raise _DTC.CheckError(
                                f"review_conditions[{i}] is critical and needs `driver` {{series, direction, "
                                "move_start {date, value}} — where the move the call rests on began, so the daily "
                                "check can flag the call when more than a third of that move is handed back")
                        _DTC.validate_driver(c["driver"], f"review_conditions[{i}]", known)
                    elif c.get("driver"):
                        _DTC.validate_driver(c["driver"], f"review_conditions[{i}]", known)
                except _DTC.CheckError as e:
                    raise ContractError(str(e))

    # 3f-ter — the expected-return hurdle (2026-09-30; 15% since 2026-10-02).
    # Joe, on finding the live book called for +0.9% and +3.7% over six
    # months: "Did we really make a call for a trade that would have been
    # 'successful' if it returned 0.9%?...
    # I want a minimum of 20% expected return." A measured edge is necessary,
    # not sufficient: the note must say what the reader earns if it works,
    # on the position it tells them to hold, and that number must clear the
    # bar. A small underlying move publishes only through an instrument
    # (futures, options, leverage, stated sizing) that gets it there.
    if str(idea.get("date", "")) >= REVIEW_CONDITIONS_FROM:
        er = idea.get("expected_return")
        if not isinstance(er, dict):
            raise ContractError(
                "expected_return{pct, basis, instrument} is required — the return the note calls for over its "
                f"horizon, on the position the reader holds; it must be at least {MIN_EXPECTED_RETURN_PCT:g}%")
        try:
            er_pct = float(er.get("pct"))
        except (TypeError, ValueError):
            raise ContractError("expected_return.pct must be a number (per cent of the position over the horizon)")
        if event:
            # Decision 4 — a premium trade is -100% or several hundred per cent;
            # the pace bar and the 2x-stop rule have no meaning for it. Its
            # three tests ran in _validate_event.
            pass
        elif str(idea.get("date", "")) >= BOOK_RULES_FROM:
            hm = _scored_months(idea.get("scorecard") or {})
            if not hm:
                raise ContractError("the hurdle is a pace — scorecard must state horizon_months or horizon_weeks")
            need = HURDLE_ANNUAL_PCT * hm / 12.0
            if er_pct < need:
                raise ContractError(
                    f"expected_return.pct is {er_pct:g}% over {hm:.2f} months — a pace of {er_pct * 12 / hm:.1f}% a year. "
                    f"The bar is {HURDLE_ANNUAL_PCT:g}% a year (the S&P's {MARKET_ANNUAL_PCT:g}% plus a "
                    f"{MARGIN_ANNUAL_PCT:g}-point margin), which over this horizon is {need:.2f}%")
        elif er_pct < MIN_EXPECTED_RETURN_PCT:
            raise ContractError(
                f"expected_return.pct is {er_pct:g}% — below the {MIN_EXPECTED_RETURN_PCT:g}% minimum. A real but small "
                f"edge does not publish unless the note names the instrument that turns it into {MIN_EXPECTED_RETURN_PCT:g}%+ "
                "(and its risk); if there is none, there is no note")
        for k in ("basis", "instrument"):
            if len(str(er.get(k) or "").strip()) < 20:
                raise ContractError(f"expected_return.{k} must say, in a sentence, how the called-for return is earned")
        # Downside protection: what the position loses if the stop prints, on
        # the same basis, and the call must pay at least twice that.
        try:
            loss = abs(float(er.get("loss_at_stop_pct")))
        except (TypeError, ValueError):
            raise ContractError("expected_return.loss_at_stop_pct is required — the loss on the position if the stop prints, "
                                "on the same basis as pct (a positive number)")
        if loss <= 0:
            raise ContractError("expected_return.loss_at_stop_pct must be a positive number")
        if not event and er_pct < MIN_REWARD_TO_RISK * loss and _option_grandfathered(idea):
            # A note published before OPTION_VEHICLE_FROM on an underlying
            # basis and since re-stated on the option it named (#1277): the
            # honest risk/reward on the vehicle is published and shown, not
            # hidden behind the index arithmetic it passed with. Dated, so no
            # new note can use it.
            warnings.append(f"GRANDFATHERED (vehicle re-stated on the option, #1277): expected_return.pct ({er_pct:g}%) "
                            f"is less than {MIN_REWARD_TO_RISK:g}x the loss at the stop ({loss:g}%) on the option")
        elif not event and er_pct < MIN_REWARD_TO_RISK * loss:
            # 2026-10-09 — Joe can waive the 2x rule for one named note. He was
            # shown that the energy call's history supports a 10% gain against
            # a 10% stop (no stop level gave 2x: a tighter stop was hit in 7 of
            # 8 episodes) and said "POst the energy trade!". The waiver is a
            # FIELD, dated and attributed, so it is visible in the published
            # file and cannot be claimed by wording; the session may not grant
            # itself one. The note must still state the real loss at the stop.
            wv = er.get("reward_risk_waiver")
            ok = (isinstance(wv, dict)
                  and str(wv.get("approved_by", "")).strip() == "Joe"
                  and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(wv.get("approved_on", "")))
                  and len(str(wv.get("reason", "")).strip()) >= 80)
            if not ok:
                raise ContractError(
                    f"expected_return.pct ({er_pct:g}%) is less than {MIN_REWARD_TO_RISK:g}x the loss at the stop ({loss:g}%) — "
                    "tighten the stop, change the instrument, or drop the idea. (Joe alone can waive this for a "
                    "single note: expected_return.reward_risk_waiver{approved_by: 'Joe', approved_on, reason>=80 chars}.)")
            warnings.append(
                f"reward-to-risk waiver used: {er_pct:g}% expected against {loss:g}% at the stop "
                f"(approved by Joe {wv.get('approved_on')})")

    # 3h-pre — Decision 5 (2026-10-21): the book is a notional 100 and every
    # note states its weight, banded by type. Fixed at publication (main()
    # refuses a republish that changes it).
    if v2:
        _validate_weight(idea, fallback, warnings)
    my_weight = _num((idea.get("sizing") or {}).get("weight"), STANDARD_WEIGHT) if isinstance(idea.get("sizing"), dict) else STANDARD_WEIGHT

    # 3h — not an overly correlated book (2026-09-30). A candidate whose
    # position returns have run at |correlation| above MAX_BOOK_CORRELATION
    # with any live call over the last CORRELATION_SESSIONS sessions is the
    # same bet twice and is rejected — no prose exemption (6.15 rule 1).
    # From BOOK_RULES_FROM "live" means OPEN on the scorecard, not "inside its
    # original horizon": a stopped call is not a position (2026-10-07 — the
    # stopped Aug 24 ten-year call was still blocking duration ideas).
    if str(idea.get("date", "")) >= REVIEW_CONDITIONS_FROM:
        hist_c = _history()
        mine = _position_daily_returns(idea.get("scorecard"), hist_c)
        if str(idea.get("date", "")) >= BOOK_RULES_FROM:
            book = _open_book(published, idea, warnings)
        else:
            book = []
            for prev in published:
                psc = prev.get("scorecard") or {}
                try:
                    prev_date = dt.date.fromisoformat(str(prev.get("date", "")))
                    prev_h = int(psc.get("horizon_months") or 0)
                except (ValueError, TypeError):
                    continue
                if prev.get("id") == derive_id(idea) or prev_date >= idea_date or prev_h <= 0 \
                        or idea_date > prev_date + dt.timedelta(days=int(prev_h * 30.44)):
                    continue
                book.append(prev)
        if mine is None:
            if str(idea.get("date", "")) >= BOOK_RULES_FROM:
                raise ContractError(
                    "the position's daily returns cannot be measured, so the book test cannot run — every leg must be "
                    "a carried series, a fund in TICKER_PROXIES, or a stock whose closes are supplied through "
                    "PRICES_EOD_PATH (a JSON file {\"SYM\": [[date, close], ...]} pulled from prices_eod)")
            warnings.append("book correlation not checked — a leg is a ticker or a series not carried here; "
                            "the weekly review will report it from the price store")
        else:
            book_rets = []
            for prev in book:
                psc = prev.get("scorecard") or {}
                theirs = _position_daily_returns(psc, hist_c)
                label = prev.get("instrument") or prev.get("id")
                if theirs is None:
                    warnings.append(f"open call {prev.get('date')} ({label}) cannot be measured here — left out of the book test")
                    continue
                book_rets.append((prev, theirs))
                c = _correlation(mine, theirs)
                if c is None:
                    continue
                if abs(c) > MAX_BOOK_CORRELATION:
                    raise ContractError(
                        f"this position's returns have run at {c:+.2f} correlation with the open {prev.get('date')} call "
                        f"({label}) over the last {CORRELATION_SESSIONS} sessions — the book already holds this bet; "
                        f"limit is {MAX_BOOK_CORRELATION:.2f}")
                if abs(c) > WARN_BOOK_CORRELATION:
                    warnings.append(f"correlation {c:+.2f} with the open {prev.get('date')} call ({label}) — say in book.stance how the two sit together")

            # 3i — incremental to the book, and the book calmer than the market
            # (2026-10-07, Joe: "beat the market by a healthy margin with lower
            # overall portfolio vol than the market ... see if this is
            # incremental alpha"). Equal weight per call, last
            # CORRELATION_SESSIONS sessions common to every position.
            if str(idea.get("date", "")) >= BOOK_RULES_FROM:
                spx = _leg_closes({"series": "spx_index"}, hist_c or {})
                series_all = [mine] + [r for _, r in book_rets]
                common = sorted(set.intersection(*[set(r) for r in series_all]))
                if spx:
                    spx_d = sorted(spx[0])
                    spx_ret = {spx_d[i]: 100.0 * (spx[0][spx_d[i]] / spx[0][spx_d[i - 1]] - 1.0)
                               for i in range(1, len(spx_d))}
                    common = [d for d in common if d in spx_ret]
                if len(common) < 40 or not spx:
                    raise ContractError("book test: fewer than 40 sessions common to the candidate, the open calls "
                                        "and the S&P — cannot show the book stays calmer than the market")
                paces, weights = [], []
                for prev, _ in book_rets:
                    pace = _annual_pace(prev)
                    if pace is None:
                        pace = HURDLE_ANNUAL_PCT
                        warnings.append(f"open call {prev.get('date')} stated no expected return — counted at the "
                                        f"{HURDLE_ANNUAL_PCT:g}%-a-year bar in the book test")
                    paces.append(pace)
                    # Decision 5 (2026-10-21): the REAL weight of every open
                    # call, out of 100. A call published before weights existed
                    # was backfilled to the standard 10 by the migration.
                    pw = _num(((prev.get("sizing") or {}) if isinstance(prev.get("sizing"), dict) else {}).get("weight"))
                    weights.append(pw if pw is not None else STANDARD_WEIGHT)
                my_pace = _annual_pace(idea)
                n = len(book_rets)
                vol_spx = _ann_vol([spx_ret[d] for d in common])
                if vol_spx is None:
                    raise ContractError("book test: volatility could not be computed")
                if v2:
                    # ── weighted book, in points of a notional 100 ──
                    # Each call contributes weight/100 x its daily return;
                    # expected excess over the S&P = Σ w (pace - 10%) / 100; an
                    # event idea enters as a position worth its premium with
                    # the payoff distribution the note states (lose 100% with
                    # probability 1 - edge odds, earn the payoff ratio
                    # otherwise), uncorrelated with the open calls.
                    old_book = [sum(w / 100.0 * r[d] for w, (_, r) in zip(weights, book_rets)) for d in common]
                    exc_old = sum(w / 100.0 * (p - MARKET_ANNUAL_PCT) for w, p in zip(weights, paces))
                    vol_old = _ann_vol(old_book) if n else None
                    if event:
                        ev = (idea.get("scorecard") or {}).get("event") or {}
                        p_win = _num(ev.get("edge_odds_pct"), 0.0) / 100.0
                        ratio = _num(ev.get("payoff_ratio"), 0.0)
                        hm = _scored_months(idea.get("scorecard") or {}) or 1.0
                        exp_ret = 100.0 * (p_win * ratio - (1.0 - p_win))            # % of premium over the hold
                        sd_ret = 100.0 * (ratio + 1.0) * (p_win * (1.0 - p_win)) ** 0.5
                        my_exc = my_weight / 100.0 * (exp_ret * 12.0 / hm - MARKET_ANNUAL_PCT)
                        my_var_ann = (my_weight / 100.0 * sd_ret) ** 2 * 12.0 / hm
                        base_var = (vol_old ** 2) if vol_old else 0.0
                        vol_new = (base_var + my_var_ann) ** 0.5
                        new_desc = (f"event idea at weight {my_weight:g}: {p_win * 100:.0f}% chance of {ratio:.1f} to 1, "
                                    f"else -100% of premium")
                    else:
                        new_book = [o + my_weight / 100.0 * mine[d] for o, d in zip(old_book, common)]
                        vol_new = _ann_vol(new_book)
                        my_exc = my_weight / 100.0 * (my_pace - MARKET_ANNUAL_PCT)
                        new_desc = f"this call at weight {my_weight:g}"
                    exc_new = exc_old + my_exc
                    if vol_new is None or vol_new <= 0:
                        raise ContractError("book test: volatility could not be computed")
                    total_w = sum(weights) + my_weight
                    ratio_new = exc_new / vol_new
                    line = (f"book test (weights): {n} open call(s) at {sum(weights):g} of 100 + {new_desc} — expected "
                            f"excess over the S&P {exc_new:+.2f} points of the book a year, volatility "
                            f"{vol_new:.2f} points vs the S&P's {vol_spx * total_w / 100.0:.2f} at the same {total_w:g} of 100")
                    if event and my_exc <= 0:
                        raise ContractError(
                            f"event idea has no positive expected value at the note's own odds: {new_desc} gives "
                            f"{my_exc:+.2f} points of expected excess a year — the odds gap is not large enough")
                    if n and vol_old:
                        ratio_old = exc_old / vol_old
                        if event and ratio_new <= ratio_old:
                            # A binary payoff's dispersion (lose 1.5 or earn 5)
                            # lowers excess-return-per-unit-of-volatility
                            # mechanically even though the loss is capped at
                            # the premium — the ratio penalises the upside.
                            # So for an event idea the ratio is REPORTED and
                            # the binding tests are positive expected value
                            # (above), the premium band (Decision 5) and the
                            # correlation cap on the underlying. Settled in the
                            # script 2026-10-21 (the spec expected the ratio
                            # to rise; it cannot for a 3.5-to-1 payoff).
                            warnings.append(
                                f"event idea lowers the book's excess return per unit of volatility ({ratio_old:.2f} → "
                                f"{ratio_new:.2f}) because a binary payoff is dispersed by construction; allowed — the "
                                f"loss is capped at {my_weight:g} of 100 and the expected excess rises {exc_old:+.2f} → {exc_new:+.2f}")
                        elif ratio_new <= ratio_old:
                            raise ContractError(
                                f"not incremental: adding this call at weight {my_weight:g} takes the book's excess "
                                f"return per unit of risk from {ratio_old:.2f} to {ratio_new:.2f} (expected excess "
                                f"{exc_old:+.2f} → {exc_new:+.2f} points a year, volatility {vol_old:.2f} → {vol_new:.2f} "
                                "points) — it must raise it")
                        line += f"; excess return per unit of risk {ratio_old:.2f} → {ratio_new:.2f}"
                    warnings.append(line)
                else:
                    new_book = [(mine[d] + sum(r[d] for _, r in book_rets)) / (n + 1) for d in common]
                    vol_new = _ann_vol(new_book)
                    exp_new = (sum(paces) + my_pace) / (n + 1)
                    if vol_new is None:
                        raise ContractError("book test: volatility could not be computed")
                    # 2026-10-14 (Joe): "the book doesn't need to be calmer, per
                    # se. So long as RISK ADJUSTED EXPECTED RETURN IS HIGHER it's
                    # OK." The volatility cap (book vol <= S&P vol, 2026-10-07) is
                    # withdrawn: it deadlocked on 2026-10-09 and it was never the
                    # point. The one test that remains is the ratio below — adding
                    # the call must RAISE the book's excess return per unit of
                    # volatility. Book volatility against the S&P's is still
                    # reported in the line so the stance can quote it.
                    if vol_new > vol_spx:
                        warnings.append(
                            f"book volatility with this call is {vol_new:.1f}% a year against the S&P's {vol_spx:.1f}% "
                            f"over {len(common)} sessions — allowed; the risk-adjusted test below is the one that binds")
                    ratio_new = (exp_new - MARKET_ANNUAL_PCT) / vol_new
                    line = (f"book test: {n} open call(s) + this one — expected {exp_new:.1f}% a year vs the S&P's "
                            f"{MARKET_ANNUAL_PCT:g}%, volatility {vol_new:.1f}% vs the S&P's {vol_spx:.1f}%")
                    if n:
                        old_book = [sum(r[d] for _, r in book_rets) / n for d in common]
                        vol_old = _ann_vol(old_book)
                        exp_old = sum(paces) / n
                        ratio_old = (exp_old - MARKET_ANNUAL_PCT) / vol_old if vol_old else None
                        if ratio_old is not None and ratio_new <= ratio_old:
                            raise ContractError(
                                f"not incremental: adding this call takes the book's excess return per unit of risk from "
                                f"{ratio_old:.2f} to {ratio_new:.2f} (expected {exp_old:.1f}% → {exp_new:.1f}% a year, "
                                f"volatility {vol_old:.1f}% → {vol_new:.1f}%) — it must raise it")
                        line += f"; excess return per unit of risk {ratio_old:.2f} → {ratio_new:.2f}"
                    warnings.append(line)

    # 3g — the live book is ONE book (2026-08-24). Joe: "You realize we already
    # have a call to buy tips and short treasuries?" The Aug 16 breakeven note
    # sells 10-year nominals dollar-for-dollar; the Aug 24 note buys them. Both
    # were live at once and nothing caught it, because novelty compares
    # instrument STRINGS while exposure lives in the scorecard legs. So: if any
    # published note whose stated horizon still covers this note's date holds
    # the OPPOSITE side of the same series, this note must carry a
    # `reconciles` entry for that note's date — a paragraph telling the reader
    # how the two positions fit together (or why this one supersedes it). A
    # house that contradicts itself silently is worse than one that is wrong.
    for prev in published:
        if prev.get("id") == derive_id(idea):
            continue
        psc = prev.get("scorecard") or {}
        try:
            prev_date = dt.date.fromisoformat(str(prev.get("date", "")))
            prev_h = int(psc.get("horizon_months") or 0)
        except (ValueError, TypeError):
            continue
        if prev_date >= idea_date:
            continue  # the duty to reconcile falls on the LATER note; an
                      # earlier note cannot address a future one (and must not
                      # fail retroactively when one appears)
        if prev_h <= 0 or idea_date > prev_date + dt.timedelta(days=int(prev_h * 30.44)):
            continue  # the earlier note's own horizon has expired
        clash = sorted({
            str(pl.get("series"))
            for pl in (psc.get("legs") or []) if isinstance(pl, dict)
            for nl in legs if isinstance(nl, dict)
            if pl.get("series") == nl.get("series")
            and pl.get("side") in SCORE_SIDES and nl.get("side") in SCORE_SIDES
            and pl.get("side") != nl.get("side")
        })
        if clash:
            recs = idea.get("reconciles") or []
            ok = any(isinstance(r, dict) and str(r.get("date", "")) == str(prev.get("date"))
                     and len(str(r.get("prose", "")).strip()) >= 120 for r in recs)
            if not ok:
                raise ContractError(
                    f"this note takes the opposite side of {', '.join(clash)} from the live note dated "
                    f"{prev.get('date')} ({str(prev.get('title',''))[:60]!r}), whose horizon has not expired. "
                    "Add a `reconciles` entry [{date, prose}] (prose >= 120 chars) telling the reader how the "
                    "two fit together — the site may not contradict itself without saying so.")

    # 3i — shorts: allowed inside relative-value trades, with a hurdle
    # (Joe, 2026-08-25): "we can have RV trades... If it makes sense for a
    # specific RV trade, Im not opposed to short. But it needs to be well
    # thought out and have a target return that is expected to beat the overall
    # market." So any note containing a short leg must state, with a number,
    # what the trade is expected to return over its horizon and why that beats
    # holding the S&P 500 — the same yardstick every call is graded against on
    # the Scorecard, so the claim is checkable after the fact. The judgment
    # half of the policy (never outright-short a trending asset on a
    # multi-quarter horizon — gold being the canonical example) lives in the
    # playbook, where judgment belongs.
    has_short = bool(str((idea.get("the_trade") or {}).get("short", "")).strip())         or idea["position_type"] in ("outright short", "long/short spread")
    if has_short and idea_date >= dt.date(2026, 8, 26):
        vm = str((idea.get("edge") or {}).get("vs_market", "")).strip()
        if len(vm) < 80 or not re.search(r"\d", vm):
            raise ContractError(
                "this note contains a short leg, so edge.vs_market is required (min 80 chars, with a figure): "
                "state the expected return over the horizon and why it beats simply holding the S&P 500 — "
                "a short is only worth its costs if it clears the market hurdle.")

    # 3h — a call is a PORTFOLIO action, not an isolated headline (2026-08-25).
    # Joe: "We have 4 calls on the page... Every new call needs to take into
    # account previous calls. We need to be giving ideas on how to structure
    # portfolios, rebalance, etc." A reader who has followed the site holds the
    # live book, and a note that ignores that book hands them a fifth position
    # with no advice about the other four. So every note from 2026-08-26 states
    # its portfolio view twice: `book.stance` — what the WHOLE live book is
    # positioned for once this call is in it — and `book.rebalance` — what a
    # reader holding the earlier calls actually does (add, trim, replace,
    # leave alone). Date-gated so the archive does not fail retroactively.
    if idea_date >= dt.date(2026, 8, 26):
        bk = idea.get("book")
        if not isinstance(bk, dict):
            raise ContractError(
                "book is required — a call is a portfolio action. Provide book.stance (what the whole live "
                "book is positioned for with this call in it, min 150 chars) and book.rebalance (what a "
                "reader holding the earlier calls does now, min 80 chars).")
        if len(str(bk.get("stance", "")).strip()) < 150:
            raise ContractError("book.stance must describe the combined live book in at least 150 chars")
        if len(str(bk.get("rebalance", "")).strip()) < 80:
            raise ContractError("book.rebalance must tell a holder of the earlier calls what to do (min 80 chars)")

    # 3j — daily research, selective publication (Joe, 2026-08-26): "I want to
    # run it every day, but only publish 1 or 2 times a week, the best ideas."
    # The morning session runs its sweep every day; this gate is what makes
    # "best of the week" real rather than aspirational — a THIRD note inside
    # any rolling seven days is rejected, so publishing today means believing
    # this idea beats whatever the rest of the week might offer. Date-gated so
    # the existing archive (which has 8/14, 8/16, 8/17) does not fail.
    if idea_date >= dt.date(2026, 8, 27):
        window_start = idea_date - dt.timedelta(days=6)
        recent = [str(prev.get("date")) for prev in published
                  if prev.get("id") != derive_id(idea)
                  and window_start.isoformat() <= str(prev.get("date", "")) <= idea_date.isoformat()]
        if len(recent) >= 2:
            raise ContractError(
                f"two notes already published in the trailing seven days ({', '.join(sorted(recent))}) — "
                "the cadence is at most two a week, the best of the daily sweeps. Hold this idea; if it is "
                "still the best candidate when the window opens, publish it then.")

    # 4 — no direction word without two dated observations
    blob = _text_of(idea)
    dated = len({str(e.get("as_of")) for e in idea["evidence"]})
    used = [w for w in DIRECTION_WORDS if re.search(rf"\b{re.escape(w)}\b", blob, re.I)]
    if used and dated < 2:
        raise ContractError(
            f"path claim(s) {used} need at least two differently-dated evidence rows; the note has {dated}")

    # 5 — banned copy (scrubbed, then confirmed gone)
    scrubbed = _scrub(idea)
    if scrubbed:
        warnings.append(f"banned copy replaced: {', '.join(scrubbed)}")

    # 6 — novelty
    for prev in published:
        try:
            prev_date = dt.date.fromisoformat(prev.get("date", ""))
        except ValueError:
            continue
        if abs((idea_date - prev_date).days) > NOVELTY_WINDOW_DAYS:
            continue
        if prev.get("id") == derive_id(idea):
            continue
        a = re.sub(r"[^a-z0-9]", "", str(prev.get("instrument", "")).lower())
        b = re.sub(r"[^a-z0-9]", "", str(idea.get("instrument", "")).lower())
        if a and a == b:
            raise ContractError(
                f"same instrument as the note dated {prev_date} ({prev.get('instrument')}) — "
                "within the 21-day novelty window. Absence is correct; a repeat is not.")

    # 7 — no performance or advice claims
    m = PERFORMANCE_CLAIM.search(blob)
    if m:
        raise ContractError(f"performance claim {m.group(0)!r} — there is no verified track record to cite")
    m = ADVICE_CLAIM.search(blob)
    if m:
        raise ContractError(f"advice language {m.group(0)!r} — this is research, not a recommendation to a person")

    return warnings


def derive_id(idea: dict) -> str:
    """The note's stable id. Split out of normalise() on 2026-08-17: the
    novelty gate skips a previously-published note with the SAME id (that is a
    correction, not a repeat), but ids were only assigned in normalise(), which
    runs AFTER validate(). So re-publishing a note to fix a figure failed the
    instrument-novelty check against its own earlier copy. Correcting a
    published number has to be a one-command operation or it does not happen."""
    if idea.get("id"):
        return str(idea["id"])
    slug = re.sub(r"[^a-z0-9]+", "-", str(idea.get("title", "")).lower()).strip("-")[:48]
    return f"{idea.get('date')}-{slug}"


def normalise(idea: dict) -> dict:
    """Fill the derived fields the site reads, leaving authored prose alone."""
    out = dict(idea)
    out["id"] = derive_id(out)
    out.setdefault("status", "live")
    out.setdefault("sections", [])
    out["published_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


def next_publish_after(d: dt.date) -> str:
    """The research runs every morning (Joe, 2026-08-26), so the next day a
    note COULD appear is simply tomorrow. Whether one does is selective —
    at most two per rolling seven days, the best of the daily sweeps."""
    return (d + dt.timedelta(days=1)).isoformat()


def load_published(path: str) -> dict:
    if not os.path.exists(path):
        return {"ideas": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prepare-file", help="path to one composed idea (JSON object)")
    ap.add_argument("--check", action="store_true", help="re-validate the published file")
    ap.add_argument("--out", default=PUBLISHED_PATH)
    args = ap.parse_args(argv)

    doc = load_published(args.out)
    ideas = list(doc.get("ideas") or [])

    if args.check:
        bad = 0
        for i, idea in enumerate(ideas):
            try:
                validate(dict(idea), [x for x in ideas if x is not idea])
            except ContractError as exc:
                print(f"FAIL ideas[{i}] ({idea.get('date')}): {exc}", file=sys.stderr)
                bad += 1
        print(f"checked {len(ideas)} published idea(s), {bad} failing")
        return 1 if bad else 0

    if not args.prepare_file:
        ap.error("one of --prepare-file or --check is required")

    with open(args.prepare_file, encoding="utf-8") as f:
        idea = json.load(f)
    if not isinstance(idea, dict):
        print("FATAL: --prepare-file must contain a single JSON object", file=sys.stderr)
        return 1

    try:
        warnings = validate(idea, ideas)
    except ContractError as exc:
        print(f"FATAL: contract violation — {exc}", file=sys.stderr)
        return 1

    explicit_pa = str(idea.get("published_at") or "").strip()
    idea = normalise(idea)
    prev = next((x for x in ideas if x.get("id") == idea["id"]), None)
    if prev is not None:
        # A CORRECTION KEEPS THE ORIGINAL PUBLICATION MOMENT (2026-09-09).
        # The scorer marks entry from the last settled close before
        # `published_at`; normalise() stamping "now" on a re-publish silently
        # moved the wheat short's entry from the Sep 4 close to the Sep 8
        # close when its vehicle was corrected. The earliest stamp ever
        # recorded for this id is the truth: take the minimum of the previous
        # copy's stamp, an explicit stamp in the correction file (for
        # restoring a value verified in git history), and now. min() means a
        # correction can never move an entry LATER — no entry-shopping.
        cands = [c for c in (str(prev.get("published_at") or "").strip(),
                             explicit_pa, idea["published_at"]) if c]
        idea["published_at"] = min(cands)
        idea["corrected_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Decision 5 (2026-10-21): the weight is never edited after
        # publication, same rule as the scorecard block (LESSONS 6.13). A
        # correction keeps the original.
        pw = _num(((prev.get("sizing") or {}) if isinstance(prev.get("sizing"), dict) else {}).get("weight"))
        nw = _num(((idea.get("sizing") or {}) if isinstance(idea.get("sizing"), dict) else {}).get("weight"))
        if pw is not None and nw is not None and abs(pw - nw) > 1e-9:
            print(f"FATAL: contract violation — sizing.weight was {pw:g} at publication and may not change "
                  f"(the correction asked for {nw:g}); a republish keeps the original weight", file=sys.stderr)
            return 1
    ideas = [x for x in ideas if x.get("id") != idea["id"]]
    ideas.insert(0, idea)
    ideas.sort(key=lambda x: x.get("date", ""), reverse=True)
    ideas = ideas[:MAX_PUBLISHED]

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cadence": "Research runs every morning before the US open; the best ideas publish — at most two a week.",
        "next_publish": next_publish_after(dt.date.fromisoformat(idea["date"])),
        "disclaimer": ("MacroTilt research is published for information only. It is not investment advice "
                       "and it is not a recommendation to buy or sell any security."),
        "ideas": ideas,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    for w in warnings:
        print(f"  warning: {w}", file=sys.stderr)
    print(f"prepared OK — {idea['id']} ({len(ideas)} published, next {payload['next_publish']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
