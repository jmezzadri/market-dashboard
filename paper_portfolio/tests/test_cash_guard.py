"""Tests for the cash-conservation constraint (paper_portfolio.cash_guard).

Every expected number is HAND-COMPUTED from the arithmetic in the module
docstring, not read back out of the code (LESSON 3.4):

    expected_proceeds = SUM(sell qty x prior close) x (1 - SELL_GAP_HAIRCUT_PCT)
    available         = sleeve cash + expected_proceeds
    buy_budget        = available x (1 - BUY_GAP_BUFFER_PCT)
    scale             = buy_budget / SUM(buy notional)   when it binds

Coverage: no-scaling-needed, scaling-needed, the hard abort, negative starting
cash, and a full replay of the real 2026-08-03 sleeve-M rebalance that put the
Momentum sleeve into a margin debit.
"""
from __future__ import annotations

import pytest

from paper_portfolio.cash_guard import (
    CashConservationError,
    apply_cash_conservation,
)
from paper_portfolio.config import BUY_GAP_BUFFER_PCT, SELL_GAP_HAIRCUT_PCT
from paper_portfolio.diff import OrderIntent


def _buy(ticker, qty, notional, sleeve="M"):
    return OrderIntent(sleeve=sleeve, ticker=ticker, side="buy",
                       target_quantity=qty, target_notional=notional,
                       signal_score=None, signal_source="momentum",
                       rebalance_trigger_reason="Power Trend entry")


def _sell(ticker, qty, notional, sleeve="M"):
    return OrderIntent(sleeve=sleeve, ticker=ticker, side="sell",
                       target_quantity=qty, target_notional=notional,
                       signal_score=None, signal_source="momentum",
                       rebalance_trigger_reason="Dropped from the monthly list")


# ─────────────────────────────────────────────────────────────────────────────
# The constants themselves — calibrated 2026-08-03, documented in config.py.
# ─────────────────────────────────────────────────────────────────────────────

def test_constants_are_the_calibrated_values():
    # 95th-percentile book-level overnight gap for an 11-name basket (+1.30%)
    # and the 5th percentile for a 14-name basket (-1.34%), rounded up.
    assert SELL_GAP_HAIRCUT_PCT == 0.0140
    assert BUY_GAP_BUFFER_PCT == 0.0135


# ─────────────────────────────────────────────────────────────────────────────
# 1 — no scaling needed
# ─────────────────────────────────────────────────────────────────────────────

def test_no_scaling_needed_leaves_intents_untouched():
    """Cash $50,000; sells 1,000 shares at $100 = $100,000 at prior close.
      expected_proceeds = 100,000 x 0.9860 = 98,600.00
      available         =  50,000 + 98,600 = 148,600.00
      buy_budget        = 148,600 x 0.9865 = 146,593.90
    Buy book is 1,000 shares at $50 = $50,000 — well inside the budget.
    """
    prices = {"SELLME": 100.0, "BUYME": 50.0}
    intents = [_sell("SELLME", 1000.0, -100_000.0),
               _buy("BUYME", 1000.0, 50_000.0)]

    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=50_000.0, eod_prices=prices)

    assert res.scale_factor == 1.0 and res.scaled is False
    assert res.dollars_trimmed == 0.0
    assert res.expected_proceeds == pytest.approx(98_600.00, abs=0.01)
    assert res.available == pytest.approx(148_600.00, abs=0.01)
    assert res.buy_budget == pytest.approx(146_593.90, abs=0.01)
    assert res.projected_cash == pytest.approx(98_600.00, abs=0.01)  # 148,600 - 50,000
    # nothing rewritten: same objects, same order
    assert kept == intents


def test_sells_only_is_a_no_op():
    """A sleeve that is only exiting can never overdraw — no buys, no guard."""
    prices = {"SELLME": 100.0}
    intents = [_sell("SELLME", 1000.0, -100_000.0)]
    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=-9_999.0, eod_prices=prices)
    assert kept == intents and res.scale_factor == 1.0
    assert res.buy_notional_requested == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 2 — scaling needed
# ─────────────────────────────────────────────────────────────────────────────

def test_scaling_needed_scales_pro_rata_and_refloors_shares():
    """Cash $0; sells 1,000 shares at $100 = $100,000 at prior close.
      expected_proceeds = 100,000 x 0.9860 =  98,600.00
      available         =                     98,600.00
      buy_budget        =  98,600 x 0.9865 =  97,268.90
    Buy book asks for the full $100,000 (2 names x $50,000; AAA at $100 =
    500 shares, BBB at $250 = 200 shares).
      scale = 97,268.90 / 100,000 = 0.9726890
      AAA: floor(500 x 0.9726890) = floor(486.3445) = 486 sh = $48,600
      BBB: floor(200 x 0.9726890) = floor(194.5378) = 194 sh = $48,500
      final book = $97,100.00, trimmed $2,900.00
      projected cash = 98,600.00 - 97,100.00 = $1,500.00  (>= 0)
    """
    prices = {"SELLME": 100.0, "AAA": 100.0, "BBB": 250.0}
    intents = [_sell("SELLME", 1000.0, -100_000.0),
               _buy("AAA", 500.0, 50_000.0),
               _buy("BBB", 200.0, 50_000.0)]

    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=0.0, eod_prices=prices)

    assert res.scale_factor == pytest.approx(0.9726890, abs=1e-7)
    assert res.buy_notional_requested == pytest.approx(100_000.00, abs=0.01)
    assert res.buy_notional_final == pytest.approx(97_100.00, abs=0.01)
    assert res.dollars_trimmed == pytest.approx(2_900.00, abs=0.01)
    assert res.projected_cash == pytest.approx(1_500.00, abs=0.01)

    by_ticker = {i.ticker: i for i in kept if i.side == "buy"}
    assert by_ticker["AAA"].target_quantity == 486.0
    assert by_ticker["BBB"].target_quantity == 194.0
    # share counts only ever go DOWN
    assert all(by_ticker[t].target_quantity <= q for t, q in (("AAA", 500.0), ("BBB", 200.0)))
    # the sell is untouched
    assert [i for i in kept if i.side == "sell"] == [intents[0]]
    # and the reason string says what happened
    assert "cash guard" in by_ticker["AAA"].rebalance_trigger_reason


def test_buy_that_floors_below_one_share_is_dropped():
    """A $300 buy of a $299 stock scales to 0 whole shares and is dropped
    rather than submitted as a 0-share order."""
    prices = {"SELLME": 10.0, "BIG": 299.0, "SMALL": 1.0}
    intents = [_sell("SELLME", 100.0, -1_000.0),   # $1,000 at prior close
               _buy("BIG", 1.0, 299.0),
               _buy("SMALL", 700.0, 700.0)]
    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=0.0, eod_prices=prices)
    # expected proceeds 986.00; budget 986.00 x 0.9865 = 972.69;
    # requested 999.00 -> scale 0.973664; BIG: floor(299 x .973664/299) = 0
    assert res.scaled is True
    assert res.dropped_tickers == ["BIG"]
    assert {i.ticker for i in kept if i.side == "buy"} == {"SMALL"}
    assert res.projected_cash >= 0


def test_unpriced_sell_contributes_no_proceeds():
    """A sell we cannot price at the prior close must not fund a buy."""
    prices = {"BUYME": 10.0}          # no price for the sell
    intents = [_sell("NOPRICE", 1000.0, -100_000.0),
               _buy("BUYME", 100.0, 1_000.0)]
    with pytest.raises(CashConservationError):
        apply_cash_conservation(
            intents, sleeve="M", sleeve_cash=0.0, eod_prices=prices)


# ─────────────────────────────────────────────────────────────────────────────
# 3 — the hard abort
# ─────────────────────────────────────────────────────────────────────────────

def test_hard_abort_when_no_cash_and_no_proceeds():
    """Cash $0, no sells, but a buy book: available = $0, so nothing can be
    bought without borrowing. Raise, and keep no buys."""
    prices = {"AAA": 100.0}
    intents = [_buy("AAA", 500.0, 50_000.0)]
    with pytest.raises(CashConservationError) as exc:
        apply_cash_conservation(
            intents, sleeve="M", sleeve_cash=0.0, eod_prices=prices)
    assert "long-only, no leverage" in str(exc.value)
    assert "buy book NOT submitted" in str(exc.value)
    assert exc.value.sell_intents == []       # nothing to keep
    assert exc.value.result.buy_notional_final == 0.0


def test_hard_abort_keeps_the_sell_intents():
    """Cash -$60,000; sells 100 shares at $100 = $10,000 at prior close.
      expected_proceeds = 10,000 x 0.9860 = 9,860.00
      available         = -60,000 + 9,860 = -50,140.00   (< 0)
    Buys are impossible; the SELLS must still run — they are the repair.
    """
    prices = {"SELLME": 100.0, "AAA": 100.0}
    sell = _sell("SELLME", 100.0, -10_000.0)
    intents = [sell, _buy("AAA", 500.0, 50_000.0)]
    with pytest.raises(CashConservationError) as exc:
        apply_cash_conservation(
            intents, sleeve="M", sleeve_cash=-60_000.0, eod_prices=prices)
    assert exc.value.sell_intents == [sell]
    assert exc.value.result.available == pytest.approx(-50_140.00, abs=0.01)


# ─────────────────────────────────────────────────────────────────────────────
# 4 — negative starting cash that the proceeds CAN repair
# ─────────────────────────────────────────────────────────────────────────────

def test_negative_starting_cash_is_repaid_before_any_buying():
    """The 2026-08-04-shaped case: the sleeve starts in debit and rebalances.
    Cash -$2,535.51; sells 1,000 shares at $100 = $100,000 at prior close.
      expected_proceeds = 100,000 x 0.9860 = 98,600.00
      available         = 98,600.00 - 2,535.51 = 96,064.49
      buy_budget        = 96,064.49 x 0.9865 = 94,767.62
    Buy book asks for $100,000 (1,000 shares of a $100 stock).
      scale = 94,767.62 / 100,000 = 0.9476762
      qty   = floor(100,000 x 0.9476762 / 100) = floor(947.6762) = 947 sh
      final = $94,700.00
      projected cash = -2,535.51 + 98,600.00 - 94,700.00 = $1,364.49  (>= 0)
    The debit is repaid FIRST; only what is left over is spent.
    """
    prices = {"SELLME": 100.0, "AAA": 100.0}
    intents = [_sell("SELLME", 1000.0, -100_000.0),
               _buy("AAA", 1000.0, 100_000.0)]

    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=-2_535.51, eod_prices=prices)

    assert res.available == pytest.approx(96_064.49, abs=0.01)
    assert res.buy_budget == pytest.approx(94_767.62, abs=0.01)
    assert res.scale_factor == pytest.approx(0.9476762, abs=1e-7)
    buy = next(i for i in kept if i.side == "buy")
    assert buy.target_quantity == 947.0
    assert res.projected_cash == pytest.approx(1_364.49, abs=0.01)
    assert res.projected_cash >= 0


# ─────────────────────────────────────────────────────────────────────────────
# 5 — REPLAY of the real 2026-08-03 sleeve-M rebalance
# ─────────────────────────────────────────────────────────────────────────────
#
# Source of record: public.paper_orders + public.paper_fills (sleeve 'M',
# 2026-08-03) and public.prices_eod closes for 2026-07-31. Starting cash is
# paper_nav_daily.sleeve_m_cash on 2026-07-31.
#
# AS TRADED:
#   buy book  @ prior close $346,284.92 -> filled $348,764.78 (+0.72%)
#   sell book @ prior close $348,367.16 -> filled $342,177.77 (-1.78%)
#   cash 4,051.50 + 342,177.77 - 348,764.78 = -$2,535.51   <- MARGIN DEBIT
#
# The 11 buys were each sized at the $31,559.95 equal-weight slot
# (0.99 x $478,181.13 sleeve NAV / 15 slots) and floored to whole shares at
# the 7/31 close.

_AUG3_START_CASH = 4_051.496463170344

# ticker: (share count ordered, 2026-07-31 close)
_AUG3_BUYS = {
    "AMC": (11191.0, 2.82), "AVTR": (2290.0, 13.78), "BRKR": (502.0, 62.84),
    "CORT": (275.0, 114.49), "DDOG": (117.0, 267.97), "FBRX": (412.0, 76.60),
    "GH": (194.0, 161.99), "ILMN": (153.0, 205.10), "OKTA": (222.0, 141.93),
    "OSCR": (1010.0, 31.22), "SNOW": (107.0, 293.28),
}
_AUG3_SELLS = {
    "ALKS": (587.0, 48.99), "CBRL": (600.0, 56.39), "DAVE": (76.0, 372.69),
    "DINO": (349.0, 91.47), "DK": (480.0, 67.87), "FCEL": (1336.0, 21.61),
    "GEO": (1002.0, 30.89), "LQDA": (349.0, 84.11), "LTH": (42.0, 45.10),
    "MAN": (623.0, 52.42), "NSIT": (24.0, 128.93), "PBF": (66.0, 72.28),
    "TXG": (647.0, 47.27), "XMTR": (359.0, 85.72),
}
# realised average fill price at the 2026-08-03 opening auction
_AUG3_FILLS = {
    "AMC": 2.967285, "AVTR": 13.888411, "BRKR": 62.510000, "CORT": 113.500000,
    "DDOG": 273.050000, "FBRX": 76.646189, "GH": 157.931031, "ILMN": 205.875032,
    "OKTA": 145.114099, "OSCR": 30.570000, "SNOW": 302.871963,
    "ALKS": 48.431261, "CBRL": 57.554134, "DAVE": 374.034474, "DINO": 90.000000,
    "DK": 65.750000, "FCEL": 19.765651, "GEO": 30.510000, "LQDA": 80.128596,
    "LTH": 45.960953, "MAN": 53.990000, "NSIT": 130.590000, "PBF": 69.100000,
    "TXG": 45.361886, "XMTR": 84.308301,
}
_AUG3_SLOT = 31_559.95


def _aug3_case():
    prices = {t: c for t, (_, c) in {**_AUG3_BUYS, **_AUG3_SELLS}.items()}
    intents = (
        [_sell(t, q, -round(q * c, 2)) for t, (q, c) in sorted(_AUG3_SELLS.items())]
        + [_buy(t, q, _AUG3_SLOT) for t, (q, _) in sorted(_AUG3_BUYS.items())]
    )
    return intents, prices


def test_aug3_as_traded_reproduces_the_margin_debit():
    """Control: the run WITHOUT the guard is what actually happened."""
    buys_filled = sum(q * _AUG3_FILLS[t] for t, (q, _) in _AUG3_BUYS.items())
    sells_filled = sum(q * _AUG3_FILLS[t] for t, (q, _) in _AUG3_SELLS.items())
    assert buys_filled == pytest.approx(348_764.78, abs=0.05)
    assert sells_filled == pytest.approx(342_177.77, abs=0.05)
    ending = _AUG3_START_CASH + sells_filled - buys_filled
    assert ending == pytest.approx(-2_535.51, abs=0.05)
    assert ending < 0                      # the defect


def test_aug3_replay_with_the_guard_ends_with_cash_at_or_above_zero():
    """Same morning, same fills, guard armed.

      sell qty x prior close      $348,367.16
      expected proceeds (-1.40%)  $343,490.02
      available (+ $4,051.50)     $347,541.52
      buy budget (-1.35%)         $342,849.71
      requested (11 whole-share
        lines at the 7/31 closes) $346,284.92   -> scale 0.990080
      trimmed before re-flooring  $  3,435.21
    After the whole-share re-floor the buy book is $341,985.58 at the 7/31
    closes and, priced at the REAL 8/3 opening fills, $344,425.66.
      ending cash = 4,051.50 + 342,177.77 - 344,425.66 = +$1,803.61
    """
    intents, prices = _aug3_case()
    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=_AUG3_START_CASH, eod_prices=prices)

    assert res.sell_value_at_close == pytest.approx(348_367.16, abs=0.05)
    assert res.expected_proceeds == pytest.approx(343_490.02, abs=0.05)
    assert res.available == pytest.approx(347_541.52, abs=0.05)
    assert res.buy_budget == pytest.approx(342_849.71, abs=0.05)
    assert res.buy_notional_requested == pytest.approx(346_284.92, abs=0.05)
    assert res.scale_factor == pytest.approx(0.990080, abs=1e-6)
    assert res.dollars_trimmed == pytest.approx(4_299.34, abs=0.05)  # incl. share floor
    assert res.buy_notional_final == pytest.approx(341_985.58, abs=0.05)
    assert res.projected_cash == pytest.approx(5_555.94, abs=0.05)

    # Now settle the guarded book at the prices the market ACTUALLY printed.
    guarded_buys = {i.ticker: i.target_quantity for i in kept if i.side == "buy"}
    assert guarded_buys == {
        "AMC": 11079.0, "AVTR": 2267.0, "BRKR": 497.0, "CORT": 272.0,
        "DDOG": 115.0, "FBRX": 407.0, "GH": 192.0, "ILMN": 151.0,
        "OKTA": 219.0, "OSCR": 999.0, "SNOW": 105.0,
    }
    buys_filled = sum(q * _AUG3_FILLS[t] for t, q in guarded_buys.items())
    sells_filled = sum(q * _AUG3_FILLS[t] for t, (q, _) in _AUG3_SELLS.items())
    ending = _AUG3_START_CASH + sells_filled - buys_filled

    assert buys_filled == pytest.approx(344_425.66, abs=0.05)
    assert ending == pytest.approx(1_803.61, abs=0.05)
    assert ending >= 0                     # the fix

    # every sell still submitted, unchanged
    assert len([i for i in kept if i.side == "sell"]) == len(_AUG3_SELLS)


def test_aug3_guard_never_increases_a_share_count():
    intents, prices = _aug3_case()
    kept, _ = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=_AUG3_START_CASH, eod_prices=prices)
    for i in kept:
        if i.side == "buy":
            assert i.target_quantity <= _AUG3_BUYS[i.ticker][0]


def test_guard_is_a_no_op_on_a_quiet_morning():
    """No intents = no rebalance. The guard must not touch anything, which is
    what makes it safe to merge: it can only ever shrink an order book that
    some OTHER trigger has already decided to build."""
    kept, res = apply_cash_conservation(
        [], sleeve="M", sleeve_cash=-50_000.0, eod_prices={})
    assert kept == [] and res.scale_factor == 1.0


def test_share_sized_buy_without_a_price_still_shrinks():
    """A buy that carries a share count but whose ticker is missing from the
    EOD price map must still have its SHARE COUNT reduced. submitter.py sizes
    off target_quantity whenever it is present, so scaling only the dollar
    figure would leave the real spend unchanged — the guard would look like it
    worked and the sleeve would still overdraw.

    Sells $100,000 at prior close -> proceeds $98,600 -> budget $97,268.90;
    two $50,000 buys -> scale 0.9726890; both floor to 486 of 500 shares.
    """
    prices = {"SELLME": 100.0, "AAA": 100.0}          # no price for NOPX
    intents = [_sell("SELLME", 1000.0, -100_000.0),
               _buy("AAA", 500.0, 50_000.0),
               _buy("NOPX", 500.0, 50_000.0)]
    kept, res = apply_cash_conservation(
        intents, sleeve="M", sleeve_cash=0.0, eod_prices=prices)
    buys = {i.ticker: i for i in kept if i.side == "buy"}
    assert buys["AAA"].target_quantity == 486.0
    assert buys["NOPX"].target_quantity == 486.0
    assert buys["NOPX"].target_notional < 50_000.0
    assert res.projected_cash >= 0
