#!/usr/bin/env python3
"""Hand-computed unit tests for power_trend_rules.py (math-change rule:
worked examples in the PR). Run in POWER-TREND-LIST-MONTHLY.yml before the
producer. Plain asserts via check(); no pytest dependency."""

import sys
from datetime import date

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from power_trend_rules import cap_top15, per_name_notional, next_first_of_month


def check(name, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'} {name}: got {got!r}, want {want!r}")
    return ok


ok = True

# cap_top15: 20 candidates, roc_3m 1..20 -> keep the 15 highest (20 down to 6);
# ZZZ and AAA tied at 6 -> AAA (ticker asc) wins the last slot, ZZZ dropped.
rows = [{"ticker": f"T{i:02d}", "roc_3m": i} for i in range(7, 21)]  # 7..20 (14 rows)
rows += [{"ticker": "ZZZ", "roc_3m": 6}, {"ticker": "AAA", "roc_3m": 6}]
capped = cap_top15(rows)
ok &= check("cap length", len(capped), 15)
ok &= check("cap top is max roc", capped[0]["ticker"], "T20")
ok &= check("cap tiebreak ticker asc", capped[-1]["ticker"], "AAA")
ok &= check("cap drops the tie loser", any(r["ticker"] == "ZZZ" for r in capped), False)

# per-name notional: n >= 8 -> exact equal weight
ok &= check("equal weight n=14", round(per_name_notional(500_000, 14), 2), 35714.29)
ok &= check("equal weight n=15", round(per_name_notional(500_000, 15), 2), 33333.33)
ok &= check("equal weight n=8", per_name_notional(500_000, 8), 62_500.0)

# min-8 floor: n=3 -> 500K/8 = 62,500 each; 3 x 62,500 = 187,500 gross,
# 312,500 stays in cash
per = per_name_notional(500_000, 3)
ok &= check("floor per-name n=3", per, 62_500.0)
ok &= check("floor gross n=3", per * 3, 187_500.0)
ok &= check("floor cash n=3", 500_000 - per * 3, 312_500.0)

# n=0 (CASH-sentinel month) -> 0.0, no division blow-up
ok &= check("n=0 all cash", per_name_notional(500_000, 0), 0.0)

# next_first_of_month, including year end
ok &= check("next month mid", next_first_of_month(date(2026, 7, 15)), date(2026, 8, 1))
ok &= check("next month on the 1st", next_first_of_month(date(2026, 7, 1)), date(2026, 8, 1))
ok &= check("next month year end", next_first_of_month(date(2026, 12, 31)), date(2027, 1, 1))

sys.exit(0 if ok else 1)
