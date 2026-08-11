"""
scripts/ce_capture.py — Conviction Events expected-vs-actual capture.

LESSONS 8.20: a monitor must be able to tell "nothing to do" from "nothing
happened", and the evidence that work was EXPECTED must be recorded by the
producer itself. Every morning the Conviction Events open phase calls
write_conviction_capture() as its final act, recording how many entry and
exit orders it just queued (expected = entries + exits THIS run — zero on a
quiet day is a healthy heartbeat, not a failure). The existing post-open
watchdog (scripts/paper_fill_watchdog.py) then grades the ET session day:
sum(paper_signal_capture.triggered_orders_count) vs paper_orders rows
actually created. Redundant fires are safe: the engine only counts orders it
NEWLY queued, so a second fire records 0 and the day's sums still tie.

Standalone invocation (python -m scripts.ce_capture) writes a zero-count
heartbeat row ONLY if the engine has not captured today — a manual liveness
poke that can never distort the expected-vs-actual sums.
"""

from __future__ import annotations

import logging
import sys

from paper_portfolio.audit import write_signal_capture

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ce_capture")

SIGNAL_SOURCE = "conviction_events"


def write_conviction_capture(
    session_date: str,
    expected_entries: int,
    expected_exits: int,
    payload: dict,
    dry_run: bool = False,
) -> str | None:
    """One paper_signal_capture row for this run. triggered_orders_count is
    the number of orders the engine just queued (entries + exits), so the
    watchdog's expected-vs-actual comparison grades the real order book."""
    total = int(expected_entries) + int(expected_exits)
    body = {
        "signal": "conviction_events",
        "session_date": session_date,
        "expected_entries": int(expected_entries),
        "expected_exits": int(expected_exits),
        **payload,
    }
    if dry_run:
        logger.info("[dry-run] would capture: expected_entries=%d expected_exits=%d",
                    expected_entries, expected_exits)
        return None
    cap_id = write_signal_capture(
        signal_source=SIGNAL_SOURCE,
        signal_payload=body,
        triggered_orders_count=total,
    )
    logger.info("captured conviction signal state (%s): entries=%d exits=%d",
                cap_id, expected_entries, expected_exits)
    return cap_id


def _captured_today() -> bool:
    from paper_portfolio.mirror import _supabase_query
    rows = _supabase_query(
        "select 1 from public.paper_signal_capture "
        f"where signal_source = '{SIGNAL_SOURCE}' "
        "and (captured_at at time zone 'America/New_York')::date = "
        "    (now() at time zone 'America/New_York')::date limit 1;")
    return bool(rows)


def main() -> int:
    """Manual heartbeat: writes a zero-count capture only when the engine has
    not captured today (never double-counts expected orders)."""
    from paper_portfolio.mirror import _et_today
    if _captured_today():
        logger.info("engine already captured today — nothing to do")
        return 0
    write_conviction_capture(
        session_date=_et_today().isoformat(),
        expected_entries=0, expected_exits=0,
        payload={"note": "manual heartbeat via scripts.ce_capture — engine had "
                         "not captured today"},
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
