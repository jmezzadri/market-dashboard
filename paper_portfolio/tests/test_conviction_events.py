"""
Tests for paper_portfolio.conviction — the Conviction Events engine.

Every case is hand-computed against the locked spec:
  * event aggregation: union of vendor + EDGAR rows, code-P only, 10b5-1
    excluded, exact-duplicate dedup (stage 1), joint-filer lot collapse
    (stage 2), $250K threshold per (ticker, filing_date);
  * gates: CS/ADRC universe, previous close >= $5, 21-day AVG dollar volume
    >= $2M, previous close > 50-day SMA — all windows END at the previous
    close (no look-ahead);
  * slot filling: max 8 concurrent, one per ticker, exits due today free
    their slots, same-morning overflow ranked by event dollar size;
  * exit math: open of the 21st trading day counting the entry day as day 1
    (= 20 sessions strictly after entry; held 20 full trading days), across
    weekends and holidays;
  * kill switch: both arms + the 40-trading-day guard on the SPY arm;
  * sizing: floor((equity/8)/price) whole shares;
  * submitter refusal: conviction BUYS refused while the kill switch is
    tripped (or unreadable) — SELLS still execute; and the CLI downgrades to
    dry-run when PAPER_LIVE_TRADING_ENABLED is not 'true'.
"""

from __future__ import annotations

from datetime import date

import pytest

from paper_portfolio.conviction import (
    ConvictionEvent,
    InsiderRow,
    KillDecision,
    PriceBar,
    aggregate_events,
    apply_gates,
    collapse_joint_lots,
    decide_actions,
    dedup_exact,
    evaluate_kill_switch,
    exit_due_session,
    next_session_after,
    rank_same_morning,
    size_entry,
)


def _row(ticker="ACME", filing="2026-08-10", tdate="2026-08-08",
         owner="Doe John", shares=10_000.0, price=30.0, after=50_000.0,
         b10=False, code="P", source="vendor"):
    return InsiderRow(ticker=ticker, filing_date=filing, transaction_date=tdate,
                      owner_name=owner, shares=shares, price=price,
                      shares_owned_after=after, is_10b5_1=b10,
                      transaction_code=code, source=source)


# ─────────────────────────────────────────────────────────────────────────────
# Event aggregation + dedup stages + 10b5-1 exclusion
# ─────────────────────────────────────────────────────────────────────────────

def test_event_aggregation_sums_lots_per_ticker_filing_date():
    rows = [
        _row(owner="Doe John", shares=5_000, price=30.0, after=10_000),    # $150K
        _row(owner="Smith Jane", shares=4_000, price=30.0, after=8_000),   # $120K
    ]
    events = aggregate_events(rows)
    assert len(events) == 1
    ev = events[0]
    assert ev.ticker == "ACME" and ev.filing_date == "2026-08-10"
    assert ev.total_usd == pytest.approx(270_000.0)
    assert ev.n_insiders == 2
    assert sorted(ev.insider_names) == ["Doe John", "Smith Jane"]
    assert ev.is_edgar_sourced is False


def test_sub_threshold_aggregate_is_not_an_event():
    rows = [_row(shares=8_000, price=31.0)]        # $248K < $250K
    assert aggregate_events(rows) == []
    rows = [_row(shares=8_065, price=31.0)]        # $250,015 >= $250K
    assert len(aggregate_events(rows)) == 1


def test_10b5_1_rows_are_excluded():
    rows = [
        _row(owner="Doe John", shares=9_000, price=30.0, b10=True),   # $270K but 10b5-1
        _row(owner="Smith Jane", shares=3_000, price=30.0, after=1),  # $90K
    ]
    assert aggregate_events(rows) == []            # only $90K remains


def test_non_purchase_codes_are_excluded():
    rows = [
        _row(code="S", shares=100_000, price=30.0),   # sale
        _row(code="A", shares=100_000, price=30.0),   # award
        _row(code="P", shares=9_000, price=30.0),     # $270K purchase
    ]
    events = aggregate_events(rows)
    assert len(events) == 1
    assert events[0].total_usd == pytest.approx(270_000.0)


def test_dedup_stage1_exact_duplicates_across_vendor_and_edgar():
    vendor = _row(owner="Doe John", shares=9_000, price=30.0, after=20_000, source="vendor")
    edgar = _row(owner="Doe John", shares=9_000, price=30.0, after=20_000, source="edgar")
    kept = dedup_exact([vendor, edgar])
    assert len(kept) == 1
    assert kept[0].source == "edgar"               # EDGAR copy preferred
    events = aggregate_events([vendor, edgar])
    assert events[0].total_usd == pytest.approx(270_000.0)   # counted ONCE
    assert events[0].is_edgar_sourced is True


def test_dedup_stage2_joint_filer_lot_collapse():
    # An LP + its GP + fund entity report the SAME 10,000-share lot: same
    # (ticker, transaction_date, amount, price, shares_owned_after), three
    # different owner names. The lot counts once; the lead filer is credited.
    lots = [
        _row(owner="Fund LP", shares=10_000, price=30.0, after=90_000),
        _row(owner="Fund GP LLC", shares=10_000, price=30.0, after=90_000),
        _row(owner="Fund Holdings I", shares=10_000, price=30.0, after=90_000),
    ]
    collapsed = collapse_joint_lots(lots)
    assert len(collapsed) == 1
    assert collapsed[0].owner_name == "Fund LP"    # first-seen = lead filer
    events = aggregate_events(lots)
    assert events[0].total_usd == pytest.approx(300_000.0)   # NOT $900K
    assert events[0].n_insiders == 1


def test_stage2_does_not_collapse_distinct_lots():
    # Two different owners, different shares_owned_after — genuinely
    # different lots even at the same size/price.
    lots = [
        _row(owner="Doe John", shares=5_000, price=30.0, after=10_000),
        _row(owner="Smith Jane", shares=5_000, price=30.0, after=99_000),
    ]
    events = aggregate_events(lots)
    assert events[0].total_usd == pytest.approx(300_000.0)
    assert events[0].n_insiders == 2


def test_events_group_per_ticker_and_filing_date():
    rows = [
        _row(ticker="AAA", filing="2026-08-10", shares=9_000, price=30.0),
        _row(ticker="AAA", filing="2026-08-07", shares=9_000, price=30.0, after=1_000),
        _row(ticker="BBB", filing="2026-08-10", shares=20_000, price=15.0, after=2_000),
    ]
    events = aggregate_events(rows)
    keys = {(e.ticker, e.filing_date) for e in events}
    assert keys == {("AAA", "2026-08-10"), ("AAA", "2026-08-07"), ("BBB", "2026-08-10")}


def test_unpriced_rows_contribute_zero_dollars():
    rows = [
        _row(owner="Doe John", shares=9_000, price=None, after=1),   # unpriceable
        _row(owner="Smith Jane", shares=9_000, price=30.0, after=2),
    ]
    events = aggregate_events(rows)
    assert events[0].total_usd == pytest.approx(270_000.0)


# ─────────────────────────────────────────────────────────────────────────────
# Gates — incl. the SMA no-look-ahead guarantee
# ─────────────────────────────────────────────────────────────────────────────

def _bars(closes, start_ord=None, volume=100_000.0):
    """Consecutive weekday-ish bars ending 2026-08-08; only relative order
    matters to the gate windows."""
    n = len(closes)
    base = date(2026, 8, 8).toordinal() - n + 1
    return [PriceBar(trade_date=date.fromordinal(base + i).isoformat(),
                     close=c, volume=volume)
            for i, c in enumerate(closes)]


def _ev(ticker="ACME"):
    return ConvictionEvent(ticker=ticker, filing_date="2026-08-08",
                           total_usd=300_000.0, insider_names=["Doe John"],
                           n_insiders=1, is_edgar_sourced=True)


UNIVERSE_CS = {"ticker": "ACME", "type": "CS", "active": True}


def test_gates_pass_on_a_clean_name():
    # 50 bars at $10 then 10 at $12: prev close 12 > SMA, ADV = 12*100K=$1.2M
    # -> fails volume; bump volume to clear $2M.
    hist = _bars([10.0] * 50 + [12.0] * 10, volume=200_000)  # ADV=$2.4M
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, hist)
    assert ev.passed_gates is True
    assert ev.gate_fail_reason is None
    assert ev.above_sma50 is True


def test_gate_universe_type():
    # Uptrend so the SMA gate passes: last-50 SMA = (40x10 + 10x12)/50 = 10.4
    # < prev close 12; 21-day ADV = (11x10 + 10x12)x200K/21 = $2.19M >= $2M.
    hist = _bars([10.0] * 50 + [12.0] * 10, volume=200_000)
    ev = apply_gates(_ev(), "2026-08-10", {"ticker": "ACME", "type": "ETF", "active": True}, hist)
    assert ev.passed_gates is False and "universe" in ev.gate_fail_reason
    ev = apply_gates(_ev(), "2026-08-10", None, hist)
    assert ev.passed_gates is False and "universe_master" in ev.gate_fail_reason
    ev = apply_gates(_ev(), "2026-08-10", {"ticker": "ACME", "type": "ADRC", "active": True}, hist)
    assert ev.passed_gates is True


def test_gate_min_previous_close():
    hist = _bars([4.0] * 60, volume=1_000_000)     # $4 < $5 (ADV $4M passes)
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, hist)
    assert ev.passed_gates is False
    assert "previous close $4.00 < $5" in ev.gate_fail_reason


def test_gate_21_day_average_dollar_volume():
    # Uptrend clears the SMA gate (SMA50 = 10.4 < prev 12), so ADV is the
    # only variable: 21-day avg close = (11x10 + 10x12)/21 = 10.952.
    # volume 150K -> ADV $1.64M < $2M fails; 250K -> $2.74M passes.
    up = [10.0] * 50 + [12.0] * 10
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, _bars(up, volume=150_000))
    assert ev.passed_gates is False and "21-day avg dollar volume" in ev.gate_fail_reason
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, _bars(up, volume=250_000))
    assert ev.passed_gates is True


def test_gate_sma50_hand_computed():
    # 49 bars at $10 + prev close $15: SMA50 = (49*10 + 15)/50 = 10.10; 15 > 10.10 passes.
    up = _bars([10.0] * 49 + [15.0], volume=300_000)
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, up)
    assert ev.passed_gates is True and ev.above_sma50 is True
    # 49 bars at $20 + prev close $10: SMA50 = (49*20+10)/50 = 19.80; 10 <= 19.80 fails.
    down = _bars([20.0] * 49 + [10.0], volume=300_000)
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, down)
    assert ev.passed_gates is False and ev.above_sma50 is False
    assert "50-day SMA" in ev.gate_fail_reason


def test_gate_sma_no_look_ahead():
    """A bar dated ON the entry session must NOT enter any window. History:
    49 bars at $20 + prev close $10 (fails the SMA gate). Append a same-day
    $100 bar — with look-ahead it would flip prev close to $100 and the gate
    to pass; the gate must discard it and still fail."""
    hist = _bars([20.0] * 49 + [10.0], volume=300_000)
    look_ahead = hist + [PriceBar(trade_date="2026-08-10", close=100.0, volume=10_000_000)]
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, look_ahead)
    assert ev.passed_gates is False
    assert ev.above_sma50 is False
    assert "previous close $10.00" in ev.gate_fail_reason   # $100 bar ignored


def test_gate_insufficient_history_fails_sma():
    hist = _bars([12.0] * 30, volume=300_000)      # only 30 rows < 50
    ev = apply_gates(_ev(), "2026-08-10", UNIVERSE_CS, hist)
    assert ev.passed_gates is False
    assert "cannot compute 50-day SMA" in ev.gate_fail_reason
    assert ev.above_sma50 is None


# ─────────────────────────────────────────────────────────────────────────────
# Sizing floor
# ─────────────────────────────────────────────────────────────────────────────

def test_sizing_floor_whole_shares():
    # equity $1,000,000 -> slot $125,000; price $30 -> floor(4166.67) = 4166
    assert size_entry(1_000_000, 30.0) == 4166
    # exact division: $125,000 / $125 = 1000
    assert size_entry(1_000_000, 125.0) == 1000
    # price above the slot -> 0 shares (cannot enter)
    assert size_entry(1_000_000, 130_000.0) == 0
    assert size_entry(1_000_000, None) == 0
    assert size_entry(0, 30.0) == 0
    # drifted equity: $973,456/8 = $121,682 -> / $87.65 = 1388.38 -> 1388
    assert size_entry(973_456, 87.65) == 1388


# ─────────────────────────────────────────────────────────────────────────────
# Exit math — 21st trading day across weekends/holidays
# ─────────────────────────────────────────────────────────────────────────────

def _weekday_sessions(start: date, end: date, holidays=()):
    out = []
    d = start
    while d <= end:
        if d.weekday() < 5 and d not in holidays:
            out.append(d)
        d = date.fromordinal(d.toordinal() + 1)
    return out


def test_exit_due_is_20_sessions_after_entry_plain_weeks():
    # No holidays: entry Mon 2026-08-10; 20 sessions later = Mon 2026-09-07…
    # BUT 2026-09-07 is Labor Day in reality — this synthetic calendar has no
    # holidays, so the 20th session after entry is exactly 4 calendar weeks: 9/7.
    sessions = _weekday_sessions(date(2026, 8, 1), date(2026, 10, 1))
    entry = date(2026, 8, 10)
    assert entry in sessions
    assert exit_due_session(sessions, entry) == date(2026, 9, 7)


def test_exit_due_skips_holidays():
    # Same window with Labor Day (Mon 2026-09-07) as a holiday: every session
    # from 9/7 onward shifts one later, so the 20th session lands Tue 9/8.
    sessions = _weekday_sessions(date(2026, 8, 1), date(2026, 10, 1),
                                 holidays=(date(2026, 9, 7),))
    assert exit_due_session(sessions, date(2026, 8, 10)) == date(2026, 9, 8)


def test_exit_due_counts_sessions_not_calendar_days():
    # Entry Friday: the next session is Monday (weekend never counts).
    sessions = _weekday_sessions(date(2026, 8, 1), date(2026, 10, 1))
    entry = date(2026, 8, 14)                      # Friday
    later = [s for s in sessions if s > entry]
    assert later[0] == date(2026, 8, 17)           # Monday
    # 20th session strictly after Friday 8/14 = Friday 9/11 (4 weeks later).
    assert exit_due_session(sessions, entry) == date(2026, 9, 11)
    # Held FULL trading days between entry open and exit open = exactly 20.
    held = [s for s in sessions if entry <= s < exit_due_session(sessions, entry)]
    assert len(held) == 20


def test_exit_due_none_when_calendar_window_too_short():
    sessions = _weekday_sessions(date(2026, 8, 10), date(2026, 8, 21))  # 10 sessions
    assert exit_due_session(sessions, date(2026, 8, 10)) is None


def test_next_session_after_weekend_and_holiday():
    hol = date(2026, 9, 7)
    sessions = _weekday_sessions(date(2026, 9, 1), date(2026, 9, 30), holidays=(hol,))
    # Filing Friday 9/4 -> next open would be Mon 9/7 but it's a holiday -> Tue 9/8.
    assert next_session_after(sessions, date(2026, 9, 4)) == date(2026, 9, 8)
    # Filing Saturday 9/5 -> same Tue 9/8.
    assert next_session_after(sessions, date(2026, 9, 5)) == date(2026, 9, 8)


# ─────────────────────────────────────────────────────────────────────────────
# Slot filling + same-morning ranking (production decision path)
# ─────────────────────────────────────────────────────────────────────────────

SESSIONS = _weekday_sessions(date(2026, 8, 1), date(2026, 12, 1))
TODAY = date(2026, 8, 10)


def _gated_event(ticker, total_usd):
    e = ConvictionEvent(ticker=ticker, filing_date="2026-08-07",
                        total_usd=total_usd, insider_names=["Doe John"],
                        n_insiders=1, is_edgar_sourced=True)
    e.passed_gates = True
    e.above_sma50 = True
    return e


def test_rank_same_morning_by_total_dollar_size():
    evs = [_gated_event("SMALL", 260_000), _gated_event("BIG", 900_000),
           _gated_event("MID", 500_000)]
    assert [e.ticker for e in rank_same_morning(evs)] == ["BIG", "MID", "SMALL"]


def test_slot_filling_ranks_and_marks_overflow_skipped_full():
    evs = [_gated_event("AAA", 300_000), _gated_event("BBB", 800_000),
           _gated_event("CCC", 500_000)]
    prev = {"AAA": 10.0, "BBB": 20.0, "CCC": 30.0}
    entered = decide_actions(evs, free_slots=2, kill_switch_tripped=False,
                             blocked_tickers=set(), equity=1_000_000,
                             prev_closes=prev, sessions=SESSIONS, session=TODAY)
    assert [e.ticker for e in entered] == ["BBB", "CCC"]     # biggest $ first
    by = {e.ticker: e for e in evs}
    assert by["AAA"].action == "skipped_full"
    assert by["BBB"].action == "entered"
    assert by["BBB"].entry_qty == 6250                        # floor(125K/20)
    assert by["BBB"].exit_due_date == exit_due_session(SESSIONS, TODAY).isoformat()
    assert by["CCC"].entry_qty == 4166                        # floor(125K/30)


def test_zero_free_slots_skips_everything_as_full():
    evs = [_gated_event("AAA", 300_000)]
    entered = decide_actions(evs, free_slots=0, kill_switch_tripped=False,
                             blocked_tickers=set(), equity=1_000_000,
                             prev_closes={"AAA": 10.0}, sessions=SESSIONS, session=TODAY)
    assert entered == []
    assert evs[0].action == "skipped_full"


def test_one_position_per_ticker_marks_skipped_dup():
    evs = [_gated_event("HELD", 900_000), _gated_event("NEW", 300_000)]
    entered = decide_actions(evs, free_slots=8, kill_switch_tripped=False,
                             blocked_tickers={"HELD"}, equity=1_000_000,
                             prev_closes={"HELD": 10.0, "NEW": 10.0},
                             sessions=SESSIONS, session=TODAY)
    assert [e.ticker for e in entered] == ["NEW"]
    assert evs[0].action == "skipped_dup"


def test_kill_switch_blocks_entries_in_decision_path():
    evs = [_gated_event("AAA", 900_000)]
    entered = decide_actions(evs, free_slots=8, kill_switch_tripped=True,
                             blocked_tickers=set(), equity=1_000_000,
                             prev_closes={"AAA": 10.0}, sessions=SESSIONS, session=TODAY)
    assert entered == []
    assert evs[0].action == "blocked_kill_switch"


def test_gate_failed_events_record_skipped_gate_even_when_tripped():
    e = _gated_event("AAA", 900_000)
    e.passed_gates = False
    e.gate_fail_reason = "previous close $4.00 < $5"
    decide_actions([e], free_slots=8, kill_switch_tripped=True,
                   blocked_tickers=set(), equity=1_000_000,
                   prev_closes={"AAA": 4.0}, sessions=SESSIONS, session=TODAY)
    assert e.action == "skipped_gate"


def test_unsizeable_entry_records_reason_and_frees_the_slot():
    # BRK.A-style price above the slot: floor -> 0 shares; the next-ranked
    # event still takes the slot.
    evs = [_gated_event("PRICY", 900_000), _gated_event("OK", 300_000)]
    entered = decide_actions(evs, free_slots=1, kill_switch_tripped=False,
                             blocked_tickers=set(), equity=1_000_000,
                             prev_closes={"PRICY": 700_000.0, "OK": 10.0},
                             sessions=SESSIONS, session=TODAY)
    assert [e.ticker for e in entered] == ["OK"]
    assert evs[0].action == "skipped_gate"
    assert "0 whole shares" in evs[0].gate_fail_reason


# ─────────────────────────────────────────────────────────────────────────────
# Kill switch — both arms + the 40-day guard
# ─────────────────────────────────────────────────────────────────────────────

def _nav_rows(navs, spys):
    return [{"snapshot_date": f"d{i}", "total_nav": n, "spy_close": s}
            for i, (n, s) in enumerate(zip(navs, spys))]


def test_kill_arm1_underperformance_requires_40_day_guard():
    # 39 trading days (40 rows incl. inception): book -12% vs SPY 0% ->
    # trails by 12 pts >= 10 but the guard holds it.
    navs = [1_000_000.0] + [880_000.0] * 39
    spys = [600.0] * 40
    d = evaluate_kill_switch(_nav_rows(navs, spys))
    assert d.trading_days == 39
    assert d.book_return == pytest.approx(-0.12)
    assert d.spy_return == pytest.approx(0.0)
    assert d.should_trip is False                  # guard: < 40 trading days
    # One more session (40 trading days): now it trips.
    d = evaluate_kill_switch(_nav_rows(navs + [880_000.0], spys + [600.0]))
    assert d.trading_days == 40
    assert d.should_trip is True
    assert "trails SPY" in d.reason


def test_kill_arm1_boundary_exactly_10_points():
    # Book -4%, SPY +6% -> gap exactly 10 pts at 40 trading days: trips (>=).
    navs = [1_000_000.0] + [1_000_000.0] * 39 + [960_000.0]
    spys = [600.0] + [600.0] * 39 + [636.0]
    d = evaluate_kill_switch(_nav_rows(navs, spys))
    assert d.trading_days == 40
    assert (d.spy_return - d.book_return) == pytest.approx(0.10)
    assert d.should_trip is True
    # 9.99 pts must NOT trip.
    spys2 = [600.0] + [600.0] * 39 + [635.94]      # SPY +5.99%
    d2 = evaluate_kill_switch(_nav_rows(navs, spys2))
    assert d2.should_trip is False


def test_kill_arm2_drawdown_trips_without_the_40_day_guard():
    # Day 3 of the book: peak 1.05M -> 0.89M = 15.24% drawdown >= 15%.
    navs = [1_000_000.0, 1_050_000.0, 890_000.0]
    spys = [600.0, 601.0, 602.0]
    d = evaluate_kill_switch(_nav_rows(navs, spys))
    assert d.trading_days == 2                     # well under 40
    assert d.max_drawdown == pytest.approx((1_050_000 - 890_000) / 1_050_000)
    assert d.should_trip is True
    assert "drawdown" in d.reason


def test_kill_drawdown_is_measured_from_the_peak_not_inception():
    # Book UP overall (+2%) but peaked +25% then fell: dd from peak = 18.4%.
    navs = [1_000_000.0, 1_250_000.0, 1_020_000.0]
    spys = [600.0, 600.0, 600.0]
    d = evaluate_kill_switch(_nav_rows(navs, spys))
    assert d.book_return == pytest.approx(0.02)
    assert d.max_drawdown == pytest.approx(0.184)
    assert d.should_trip is True


def test_kill_no_trip_when_healthy():
    navs = [1_000_000.0] + [1_010_000.0] * 45
    spys = [600.0] + [603.0] * 45
    d = evaluate_kill_switch(_nav_rows(navs, spys))
    assert d.should_trip is False and d.reason is None


def test_kill_inception_only_row_is_quiet():
    d = evaluate_kill_switch(_nav_rows([1_000_000.0], [600.0]))
    assert d.trading_days == 0 and d.should_trip is False
    d = evaluate_kill_switch([])
    assert d.should_trip is False


def test_kill_missing_spy_disables_only_the_spy_arm():
    navs = [1_000_000.0] + [850_000.0] * 45        # -15% book, dd exactly 15%
    rows = [{"snapshot_date": f"d{i}", "total_nav": n, "spy_close": None}
            for i, n in enumerate(navs)]
    d = evaluate_kill_switch(rows)
    assert d.spy_return is None
    assert d.should_trip is True                   # drawdown arm still armed
    assert "drawdown" in d.reason and "trails" not in d.reason


# ─────────────────────────────────────────────────────────────────────────────
# Submitter refusal — kill switch tripped / trading disabled
# ─────────────────────────────────────────────────────────────────────────────

class _FakeAlpaca:
    def __init__(self):
        self.submitted = []

    def list_orders(self, status="open", limit=500):
        return []

    def get_order_by_client_id(self, cid):
        return None

    def get_asset(self, ticker):
        return {"fractionable": True}

    def submit_market_on_open(self, ticker, qty, side, client_order_id, notional=None):
        self.submitted.append((ticker, side, qty))
        return {"id": f"alp-{ticker}-{side}"}


def _pending(tid, ticker, side, source="conviction_events", qty=100.0):
    from paper_portfolio.submitter import PendingOrderRow
    return PendingOrderRow(id=tid, sleeve="B", ticker=ticker, side=side,
                           order_type="market_on_open", target_quantity=qty,
                           target_notional=None, signal_score=None,
                           signal_source=source, rebalance_trigger_reason=None)


def test_submitter_refuses_conviction_buys_when_tripped_but_sells_execute(monkeypatch):
    from paper_portfolio import submitter as sub
    alp = _FakeAlpaca()
    skipped, submitted = [], []
    monkeypatch.setattr(sub, "fetch_pending_orders", lambda limit=500: [
        _pending("row-buy", "AAA", "buy"),
        _pending("row-sell", "BBB", "sell"),
    ])
    monkeypatch.setattr(sub, "_conviction_kill_switch_tripped", lambda: True)
    monkeypatch.setattr(sub, "_mark_skipped", lambda rid, reason: skipped.append((rid, reason)))
    monkeypatch.setattr(sub, "_mark_submitted", lambda rid, aid: submitted.append(rid))
    res = sub.submit_pending_orders(alpaca=alp, dry_run=False)
    # BUY refused, never reached the broker; SELL executed.
    assert [t for (t, s, q) in alp.submitted] == ["BBB"]
    assert res.submitted == 1
    assert skipped and skipped[0][0] == "row-buy"
    assert "kill switch" in skipped[0][1]
    assert submitted == ["row-sell"]


def test_submitter_allows_conviction_buys_when_clear(monkeypatch):
    from paper_portfolio import submitter as sub
    alp = _FakeAlpaca()
    monkeypatch.setattr(sub, "fetch_pending_orders", lambda limit=500: [
        _pending("row-buy", "AAA", "buy"),
    ])
    monkeypatch.setattr(sub, "_conviction_kill_switch_tripped", lambda: False)
    monkeypatch.setattr(sub, "_mark_submitted", lambda rid, aid: None)
    res = sub.submit_pending_orders(alpaca=alp, dry_run=False)
    assert [t for (t, s, q) in alp.submitted] == ["AAA"]
    assert res.submitted == 1


def test_submitter_refusal_fails_safe_when_state_unreadable(monkeypatch):
    from paper_portfolio import submitter as sub

    def _boom(sql):
        raise RuntimeError("ce_kill_switch unreachable")
    monkeypatch.setattr(sub, "_supabase_query", _boom)
    assert sub._conviction_kill_switch_tripped() is True   # unreadable = refuse


def test_submitter_ignores_kill_switch_for_legacy_sources(monkeypatch):
    from paper_portfolio import submitter as sub
    alp = _FakeAlpaca()
    calls = []
    monkeypatch.setattr(sub, "fetch_pending_orders", lambda limit=500: [
        _pending("row-legacy", "CCC", "buy", source="equity_scanner"),
    ])
    monkeypatch.setattr(sub, "_conviction_kill_switch_tripped",
                        lambda: calls.append(1) or True)
    monkeypatch.setattr(sub, "_mark_submitted", lambda rid, aid: None)
    res = sub.submit_pending_orders(alpaca=alp, dry_run=False)
    assert res.submitted == 1                      # legacy buy unaffected
    assert calls == []                             # state never even consulted


def test_cli_downgrades_to_dry_run_when_trading_disabled(monkeypatch):
    """PAPER_LIVE_TRADING_ENABLED not 'true' and no --force-live: the engine
    must downgrade to dry-run — no submissions possible."""
    import paper_portfolio.conviction as conv
    seen = {}
    monkeypatch.delenv("PAPER_LIVE_TRADING_ENABLED", raising=False)
    monkeypatch.setattr(conv, "run_open_phase",
                        lambda dry_run=False, session_date=None: seen.setdefault("dry", dry_run))
    conv.main(["--phase", "open"])
    assert seen["dry"] is True

    seen.clear()
    monkeypatch.setenv("PAPER_LIVE_TRADING_ENABLED", "false")
    conv.main(["--phase", "open"])
    assert seen["dry"] is True

    seen.clear()
    monkeypatch.setenv("PAPER_LIVE_TRADING_ENABLED", "true")
    conv.main(["--phase", "open"])
    assert seen["dry"] is False


def test_cli_kill_check_honors_trading_disabled(monkeypatch):
    import paper_portfolio.conviction as conv
    seen = {}
    monkeypatch.delenv("PAPER_LIVE_TRADING_ENABLED", raising=False)
    monkeypatch.setattr(conv, "run_kill_check",
                        lambda dry_run=False: seen.setdefault("dry", dry_run) or 0)
    conv.main(["--phase", "kill-check"])
    assert seen["dry"] is True


# ─────────────────────────────────────────────────────────────────────────────
# Kill-check upsert semantics (latch + fresh-trip exit code)
# ─────────────────────────────────────────────────────────────────────────────

def test_fresh_trip_latches_and_repeat_check_does_not_retrip(monkeypatch):
    import paper_portfolio.conviction as conv
    state = {"tripped": False, "reason": None}
    executed = []

    def fake_query(sql):
        if "from public.ce_kill_switch" in sql:
            return [dict(state)]
        return []

    def fake_exec(sql):
        executed.append(sql)
        if "tripped = true" in sql:
            state["tripped"] = True
            state["reason"] = "tripped-by-test"
    monkeypatch.setattr(conv, "_supabase_query", fake_query)
    monkeypatch.setattr(conv, "_supabase_exec", fake_exec)

    trip = KillDecision(True, "book trails SPY", -0.12, 0.0, 0.02, 41)
    assert conv.upsert_kill_switch(trip) is True           # fresh trip
    assert state["tripped"] is True
    # Second evaluation while already tripped: metrics update, NOT a fresh trip.
    assert conv.upsert_kill_switch(trip) is False
    # The latch never wrote tripped=false.
    assert not any("tripped = false" in q for q in executed)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration smoke — open phase (dry run) and kill-check phase end-to-end
# against fully faked broker + DB
# ─────────────────────────────────────────────────────────────────────────────

class _FakeBroker:
    """Alpaca stand-in for the open phase: calendar, positions, account."""

    def __init__(self, sessions, positions, equity):
        self._sessions = sessions
        self._positions = positions
        self._equity = equity

    def _get(self, path):
        # /v2/calendar?start=...&end=... — used by the calendar loader AND
        # freshness.is_trading_session.
        import re as _re
        m = _re.search(r"start=([0-9-]+)&end=([0-9-]+)", path)
        s, e = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
        return [{"date": d.isoformat(), "open": "09:30", "close": "16:00"}
                for d in self._sessions if s <= d <= e]

    def get_positions(self):
        return self._positions

    def get_account(self):
        class _A:  # only .equity is read
            equity = self._equity
        return _A


class _BrokerPos:
    def __init__(self, ticker, qty):
        self.ticker = ticker
        self.qty = qty


def _open_phase_router(state):
    """SQL router for run_open_phase's reads. `state` configures the fixtures."""
    def q(sql):
        if "and (entry_price is null or exited_at is null)" in sql:
            return []                                   # reconcile: nothing pending
        if "from public.paper_fills" in sql:
            return []
        if "where action = 'entered' and exited_at is null" in sql:
            return state["open_events"]
        if "insider_history_edgar" in sql:
            return state["insider_rows"]
        if "from public.universe_master" in sql:
            return state["universe"]
        if "from public.prices_eod" in sql:
            return state["price_rows"]
        if "from public.ce_kill_switch" in sql:
            return [state["kill_row"]]
        if "from public.ce_events" in sql and "where filing_date in" in sql:
            return []                                   # nothing recorded yet
        return []
    return q


def test_open_phase_dry_run_exits_first_then_gated_entry(monkeypatch, capsys):
    import paper_portfolio.conviction as conv

    today = date(2026, 8, 10)                           # Monday
    sessions = _weekday_sessions(date(2026, 7, 27), date(2026, 11, 30))
    # 60 ascending bars ending Fri 8/7 (prev close $12, uptrend passes SMA):
    # the price panel needs its own long weekday range for the 50-day window.
    closes = [10.0] * 50 + [12.0] * 10
    hist_days = _weekday_sessions(date(2026, 5, 1), date(2026, 8, 7))[-60:]
    assert len(hist_days) == 60
    bars = [{"ticker": "NEWCO", "trade_date": s.isoformat(),
             "close": closes[i], "volume": 250_000}
            for i, s in enumerate(hist_days)]

    state = {
        "open_events": [
            {"id": 1, "ticker": "EXITME", "filing_date": "2026-07-10",
             "entered_at": "2026-07-13 12:45:00+00", "entry_qty": 100,
             "entry_price": 50.0, "exit_due_date": today.isoformat()},
            {"id": 2, "ticker": "HOLD1", "filing_date": "2026-08-03",
             "entered_at": "2026-08-04 12:45:00+00", "entry_qty": 10,
             "entry_price": 20.0, "exit_due_date": "2026-09-01"},
        ],
        # $300K single-insider buy filed Friday 8/7 -> enters at Monday's open
        "insider_rows": [
            {"ticker": "NEWCO", "filing_date": "2026-08-07",
             "transaction_date": "2026-08-06", "owner_name": "Doe John",
             "amount": 10_000, "stock_price": 30.0, "shares_owned_after": 90_000,
             "is_10b5_1": False, "transaction_code": "P", "source": "edgar"},
        ],
        "universe": [{"ticker": "NEWCO", "type": "CS", "active": True}],
        "price_rows": bars,
        "kill_row": {"tripped": False, "reason": None},
    }
    monkeypatch.setattr(conv, "_supabase_query", _open_phase_router(state))
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: (_ for _ in ()).throw(
        AssertionError(f"dry run must not write: {sql[:120]}")))
    broker = _FakeBroker(sessions,
                         [_BrokerPos("EXITME", 100.0), _BrokerPos("HOLD1", 10.0)],
                         equity=1_000_000.0)
    monkeypatch.setattr(conv, "AlpacaPaperClient", lambda: broker)

    res = conv.run_open_phase(dry_run=True, session_date=today)

    assert res["exits_due"] == 1                        # EXITME due, HOLD1 not
    assert res["exit_orders"] == 1
    assert res["events"] == 1
    assert res["entries"] == 1                          # NEWCO passed all gates
    assert res["kill_switch_tripped"] is False


def test_open_phase_dry_run_blocks_entries_when_tripped(monkeypatch):
    import paper_portfolio.conviction as conv

    today = date(2026, 8, 10)
    sessions = _weekday_sessions(date(2026, 7, 27), date(2026, 11, 30))
    closes = [10.0] * 50 + [12.0] * 10
    hist_days = _weekday_sessions(date(2026, 5, 1), date(2026, 8, 7))[-60:]
    bars = [{"ticker": "NEWCO", "trade_date": s.isoformat(),
             "close": closes[i], "volume": 250_000}
            for i, s in enumerate(hist_days)]
    state = {
        "open_events": [],
        "insider_rows": [
            {"ticker": "NEWCO", "filing_date": "2026-08-07",
             "transaction_date": "2026-08-06", "owner_name": "Doe John",
             "amount": 10_000, "stock_price": 30.0, "shares_owned_after": 90_000,
             "is_10b5_1": False, "transaction_code": "P", "source": "edgar"},
        ],
        "universe": [{"ticker": "NEWCO", "type": "CS", "active": True}],
        "price_rows": bars,
        "kill_row": {"tripped": True, "reason": "drawdown 16%"},
    }
    monkeypatch.setattr(conv, "_supabase_query", _open_phase_router(state))
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: None)
    broker = _FakeBroker(sessions, [], equity=1_000_000.0)
    monkeypatch.setattr(conv, "AlpacaPaperClient", lambda: broker)

    res = conv.run_open_phase(dry_run=True, session_date=today)
    assert res["entries"] == 0                          # refused while tripped
    assert res["kill_switch_tripped"] is True


def test_open_phase_no_ops_on_a_non_trading_day(monkeypatch):
    import paper_portfolio.conviction as conv
    holiday = date(2026, 9, 7)                          # Monday holiday
    sessions = _weekday_sessions(date(2026, 8, 1), date(2026, 10, 1),
                                 holidays=(holiday,))
    broker = _FakeBroker(sessions, [], equity=1_000_000.0)
    monkeypatch.setattr(conv, "AlpacaPaperClient", lambda: broker)
    monkeypatch.setattr(conv, "_supabase_query", lambda sql: (_ for _ in ()).throw(
        AssertionError("must not touch the DB on a market holiday")))
    res = conv.run_open_phase(dry_run=True, session_date=holiday)
    assert res == {"skipped": "market-closed", "date": holiday.isoformat()}


def test_kill_check_phase_fresh_trip_fails_the_job(monkeypatch, capsys):
    import paper_portfolio.conviction as conv
    navs = [1_000_000.0, 1_050_000.0, 880_000.0]        # dd 16.2% -> trip
    state = {"tripped": False, "reason": None}
    executed = []

    def q(sql):
        if "from public.paper_nav_daily" in sql:
            return [{"snapshot_date": f"2026-08-1{i}", "total_nav": n,
                     "spy_close": 600.0} for i, n in enumerate(navs)]
        if "from public.ce_kill_switch" in sql:
            return [dict(state, book_return=None, spy_return=None,
                         max_drawdown=None, tripped_at=None, checked_at=None)]
        if "and (entry_price is null or exited_at is null)" in sql:
            return []
        return []

    def x(sql):
        executed.append(sql)
        if "tripped = true" in sql:
            state["tripped"] = True
            state["reason"] = "tripped"
    monkeypatch.setattr(conv, "_supabase_query", q)
    monkeypatch.setattr(conv, "_supabase_exec", x)
    monkeypatch.setattr(conv, "file_alert", lambda **kw: None)

    rc = conv.run_kill_check(dry_run=False)
    assert rc == 1                                      # job FAILS -> alert email
    out = capsys.readouterr().out
    assert "::error::" in out and "KILL SWITCH TRIPPED" in out
    assert any("tripped = true" in s for s in executed)

    # Next evening, still tripped: loud line but exit 0 (one email per trip).
    rc2 = conv.run_kill_check(dry_run=False)
    assert rc2 == 0
    out2 = capsys.readouterr().out
    assert "remains TRIPPED" in out2


def test_kill_check_phase_healthy_book_stays_quiet(monkeypatch, capsys):
    import paper_portfolio.conviction as conv
    executed = []

    def q(sql):
        if "from public.paper_nav_daily" in sql:
            return [{"snapshot_date": "2026-08-11", "total_nav": 1_000_000.0,
                     "spy_close": 600.0},
                    {"snapshot_date": "2026-08-12", "total_nav": 1_004_000.0,
                     "spy_close": 601.0}]
        if "from public.ce_kill_switch" in sql:
            return [{"tripped": False, "reason": None}]
        if "and (entry_price is null or exited_at is null)" in sql:
            return []
        return []
    monkeypatch.setattr(conv, "_supabase_query", q)
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: executed.append(sql))
    rc = conv.run_kill_check(dry_run=False)
    assert rc == 0
    assert "::error::" not in capsys.readouterr().out
    # metrics still recorded every close (checked_at heartbeat)
    assert any("checked_at = now()" in s for s in executed)


def test_open_phase_without_migration_skips_in_dry_run_and_raises_live(monkeypatch):
    import paper_portfolio.conviction as conv
    today = date(2026, 8, 10)
    sessions = _weekday_sessions(date(2026, 7, 27), date(2026, 9, 30))
    broker = _FakeBroker(sessions, [], equity=1_000_000.0)
    monkeypatch.setattr(conv, "AlpacaPaperClient", lambda: broker)

    def q(sql):
        if "from public.ce_kill_switch" in sql:
            raise RuntimeError('relation "public.ce_kill_switch" does not exist')
        return []
    monkeypatch.setattr(conv, "_supabase_query", q)
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: None)

    # Frozen pre-cutover state (dry run): quiet skip, job stays green.
    res = conv.run_open_phase(dry_run=True, session_date=today)
    assert res == {"skipped": "migration-094-not-applied"}
    # Live without the schema: misordered cutover — loud failure.
    with pytest.raises(RuntimeError, match="migration 094"):
        conv.run_open_phase(dry_run=False, session_date=today)


def test_kill_check_without_migration_skips_in_dry_run_and_raises_live(monkeypatch):
    import paper_portfolio.conviction as conv

    def q(sql):
        if "from public.ce_kill_switch" in sql:
            raise RuntimeError('relation "public.ce_kill_switch" does not exist')
        return []
    monkeypatch.setattr(conv, "_supabase_query", q)
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: None)
    assert conv.run_kill_check(dry_run=True) == 0
    with pytest.raises(RuntimeError, match="migration 094"):
        conv.run_kill_check(dry_run=False)


def test_open_phase_never_reenters_a_ticker_exiting_the_same_morning(monkeypatch):
    """An event on a ticker whose exit is due at today's open frees the slot
    CAPACITY but the ticker itself stays blocked (no opposing same-symbol
    orders at one auction) — recorded skipped_dup."""
    import paper_portfolio.conviction as conv
    today = date(2026, 8, 10)
    sessions = _weekday_sessions(date(2026, 7, 27), date(2026, 11, 30))
    closes = [10.0] * 50 + [12.0] * 10
    hist_days = _weekday_sessions(date(2026, 5, 1), date(2026, 8, 7))[-60:]
    bars = [{"ticker": "EXITME", "trade_date": s.isoformat(),
             "close": closes[i], "volume": 250_000}
            for i, s in enumerate(hist_days)]
    state = {
        "open_events": [
            {"id": 1, "ticker": "EXITME", "filing_date": "2026-07-10",
             "entered_at": "2026-07-13 12:45:00+00", "entry_qty": 100,
             "entry_price": 50.0, "exit_due_date": today.isoformat()},
        ],
        "insider_rows": [                                # fresh event, same ticker
            {"ticker": "EXITME", "filing_date": "2026-08-07",
             "transaction_date": "2026-08-06", "owner_name": "Doe John",
             "amount": 10_000, "stock_price": 30.0, "shares_owned_after": 90_000,
             "is_10b5_1": False, "transaction_code": "P", "source": "edgar"},
        ],
        "universe": [{"ticker": "EXITME", "type": "CS", "active": True}],
        "price_rows": bars,
        "kill_row": {"tripped": False, "reason": None},
    }
    monkeypatch.setattr(conv, "_supabase_query", _open_phase_router(state))
    monkeypatch.setattr(conv, "_supabase_exec", lambda sql: None)
    broker = _FakeBroker(sessions, [_BrokerPos("EXITME", 100.0)], equity=1_000_000.0)
    monkeypatch.setattr(conv, "AlpacaPaperClient", lambda: broker)

    res = conv.run_open_phase(dry_run=True, session_date=today)
    assert res["exit_orders"] == 1
    assert res["entries"] == 0                           # blocked: same-day flip
