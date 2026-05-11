# Signal Intelligence v5 — Phase 2 starting points

Phase 1 shipped the producer side. Phase 2 builds the composite MT Score
+ band assignment on top.

## What Phase 2 needs to ship

1. **Composite MT Score** — weighted blend of the six sub_scores returned by
   each scorer. Equal-weight v1 (each ~16.7%) per Joe's spec.

2. **Insider cap-discount** — the only signal that gets a cap haircut.
   `$500M = 100%`, `$50B = 50%`, `$500B = 25%`, log-linear interpolation.
   Apply only to the insider sub-score. Other 5 keep full weight at every
   cap.

3. **Band assignment**:
   - −100 to −50 = Strong Sell
   - −50 to −20 = Watch Sell
   - −20 to +20 = Neutral
   - +20 to +50 = Watch Buy
   - +50 to +100 = Strong Buy

4. **None-handling** — when a sub_score is None, it must be excluded from
   the composite denominator (NOT treated as zero). Anchor: v2's rollup
   pattern in `scanner.signal_intelligence_v2.rollup`.

5. **Cap-bucket tagging** for the backtest in Phase 3 (S&P thresholds):
   - Small Cap   $300M–$8.1B
   - Mid Cap     $8.1B–$23.5B
   - Large Cap   $23.5B–$200B
   - Mega Cap    $200B+

## Open data items from Phase 1

1. `short_interest.short_interest_float_pct` — the Nasdaq endpoint exposes
   shares + ADV but not %-of-float. Phase 2 should derive this at upsert
   time from `ticker_reference.share_class_shares_outstanding` (or the
   newer Polygon weighted_shares_outstanding column).

2. UW `all_opening_trades` flag is per-alert; Phase 2 wires the proper
   Pan-Poteshman opening-only filter on `options_flow_daily` ingest.

3. Run `workflow_dispatch` on `ANALYST_INGEST_DAILY` and
   `SHORT_INTEREST_INGEST_DAILY` once to backfill the tail of the
   universe (Phase 1 covered 26% of analyst tickers and the priority
   queue for SI).

## Files in this package

| File | Purpose |
|---|---|
| `__init__.py`              | Version + module export |
| `universe.py`              | Phase 1 universe selector (3,306 names live) |
| `insider_score.py`         | Form 4 P-buys vs S-sells, 10b5-1 excluded |
| `options_score.py`         | Call/put $ ratio + ask/bid skew |
| `congress_score.py`        | Buys − sells, tier-weighted |
| `technicals_score.py`      | SMA50/200 + RSI bucket + BB + RVOL |
| `analyst_score.py`         | Action points + PT-vs-spot gap |
| `short_interest_score.py`  | 3-regime bidirectional |
| `options_ingest.py`        | UW /option-trades/flow-alerts → options_flow_daily |
| `congress_ingest.py`       | UW /congress/recent-trades → congress_trades_daily |
| `analyst_ingest.py`        | UW /screener/analysts → analyst_ratings_daily (per-ticker) |
| `short_interest_ingest.py` | FINRA + UW continuous → short_interest + short_interest_daily |

## How to call a scorer

```python
from datetime import date
from scanner.signal_intelligence_v5 import insider_score

result = insider_score.score("NVDA", date(2026, 5, 10))
# result = {"sub_score": 80, "components": {...}, "diagnostic": {...}}
```

`sub_score` is `None` when the ticker has no data for that signal.
