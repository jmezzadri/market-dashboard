#!/usr/bin/env python3
"""Hand-computed unit tests for momentum_rules.py (math-change rule:
worked examples in the PR). Run in MOMENTUM-LIST-MONTHLY.yml before the
producer."""

import sys
from datetime import date

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from momentum_rules import pick_rebalance_day, ret_12_1, momentum_ranks, quintile_clamp, guard_invested


def check(name, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'} {name}: got {got!r}, want {want!r}")
    return ok


ok = True

# pick_rebalance_day: last eligible day strictly before the 1st of today's month
cal = [date(2026, 5, 28), date(2026, 5, 29), date(2026, 6, 29), date(2026, 6, 30), date(2026, 7, 1)]
ok &= check("rebal prior month", pick_rebalance_day(cal, date(2026, 7, 1)), date(2026, 6, 30))
ok &= check("rebal skips current month", pick_rebalance_day(cal, date(2026, 6, 15)), date(2026, 5, 29))
ok &= check("rebal empty", pick_rebalance_day([date(2026, 7, 2)], date(2026, 7, 1)), None)

# ret_12_1 hand case: lb=4, skip=2; series [100, ?, 110, ?, ?] -> 110/100 - 1 = 0.10
ok &= check("12-1 hand case", round(ret_12_1([100, None, 110, None, 999], lb=4, skip=2), 10), 0.10)
ok &= check("12-1 missing endpoint", ret_12_1([None, 1, 110, 1, 1], lb=4, skip=2), None)
ok &= check("12-1 wrong length", ret_12_1([100, 110], lb=4, skip=2), None)

# ranks: B (0.5) > A (0.1); C excluded (missing endpoint); tie broken by ticker
ranks = momentum_ranks({"A": [100, 0, 110, 0, 0], "B": [100, 0, 150, 0, 0],
                        "C": [None, 0, 110, 0, 0], "D": [100, 0, 150, 0, 0]}, lb=4, skip=2)
ok &= check("rank order", [t for t, _ in ranks], ["B", "D", "A"])

# quintile clamp
ok &= check("clamp floor", quintile_clamp(80), 20)     # 80//5=16 -> 20
ok &= check("clamp mid", quintile_clamp(150), 30)      # 150//5=30
ok &= check("clamp ceiling", quintile_clamp(1500), 50) # 300 -> 50

# guard: closes [1,2,3] avg=2; last=3 >= 2 -> invested; [3,2,1] last=1 < 2 -> cash
ok &= check("guard invested", guard_invested([1, 2, 3]), True)
ok &= check("guard cash", guard_invested([3, 2, 1]), False)
ok &= check("guard at-average", guard_invested([2, 2, 2]), True)

sys.exit(0 if ok else 1)
