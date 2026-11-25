"""futures_contracts.py - which dated futures contract is front month.

Shared by fetch_market_indicators.py and midday_gates.py (stdlib only, so the
gate script can import it without numpy). See LESSONS 4.56.
"""
from __future__ import annotations

_FUT_MONTH_CODES = "FGHJKMNQUVXZ"


def _last_london_business_day(y, m):
    """Last weekday of the month, skipping the UK summer bank holiday (last
    Monday of August) - the only London holiday that can fall on a month end
    that matters here."""
    import datetime as _dtm, calendar as _cal
    d = _dtm.date(y, m, _cal.monthrange(y, m)[1])
    while d.weekday() >= 5:
        d -= _dtm.timedelta(days=1)
    if m == 8 and d.weekday() == 0:
        d -= _dtm.timedelta(days=3)
    return d


def brent_front_symbol(d):
    """Yahoo symbol of the ICE Brent contract that is front month on date d
    (date or ISO string). Month M expires on the last London business day of
    month M-2, and trades (and settles) on that day."""
    import datetime as _dtm
    if isinstance(d, str):
        d = _dtm.date.fromisoformat(d[:10])
    y, m = d.year, d.month
    if d > _last_london_business_day(y, m):
        m += 1
        if m > 12:
            y, m = y + 1, 1
    cm, cy = m + 2, y
    if cm > 12:
        cm, cy = cm - 12, cy + 1
    return f"BZ{_FUT_MONTH_CODES[cm - 1]}{cy % 100:02d}.NYM"
