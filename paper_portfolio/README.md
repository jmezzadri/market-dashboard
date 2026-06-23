# `paper_portfolio` — MacroTilt Paper Trading Translator

Single source of truth for translating the live Equity Scanner output into
Alpaca paper orders.

**The paper portfolio is Sleeve B (Equity Scanner) ONLY.** Sleeve A — the
Asset Tilt industry-group ETF sleeve — was retired 2026-06-23 when the Asset
Tilt engine (and its `public/v10_allocation.json` output) was removed. Any
ETF still held from the old Sleeve A is exited to cash on the next rebalance:
the diff engine sells every held name that is absent from the Sleeve B target.

This module **does not submit orders**. It computes targets, diffs against
live Alpaca state, and writes intent rows to `public.paper_orders` with
`status='pending'`. A separate execution layer submits.

## Module layout

```
paper_portfolio/
├── __init__.py
├── README.md                ← this file
├── config.py                ← paper account config + Senior Quant constants
├── alpaca_client.py         ← read-only Alpaca REST wrapper
├── signals.py               ← Equity Scanner reader
├── sleeves.py               ← Sleeve B target builder (PURE MATH)
├── diff.py                  ← target − live → OrderIntent list (incl. exits)
├── audit.py                 ← writers for paper_signal_capture + paper_orders
├── freshness.py             ← pre-submit scanner freshness gate
├── translator.py            ← top-level orchestrator (CLI entrypoint)
├── runner.py                ← nightly phase orchestrator
├── mirror.py                ← positions / fills / NAV writers
└── tests/
    ├── test_sleeves.py
    ├── test_diff.py
    ├── test_mirror.py
    └── test_submitter.py
```

## Run

```bash
# Dry-run — compute everything, no Supabase writes, no Alpaca submission
python -m paper_portfolio.translator --dry-run --print-intents

# Full run — writes paper_signal_capture + paper_orders (pending)
python -m paper_portfolio.translator

# Replay a historical scan
python -m paper_portfolio.translator --scan-date 2026-05-22 --dry-run
```

## Tests

```bash
python -m pytest paper_portfolio/tests/ -v -p no:cacheprovider
```

All math is deterministic — no live calls.

## Senior Quant constants (locked v1)

| Constant | Value | Where |
|---|---|---|
| Sleeve B buy threshold | normalized buy-score ≥ 5.0 | `config.SLEEVE_B_BUY_THRESHOLD` |
| Sleeve B exit threshold | normalized buy-score < 5.0 | `config.SLEEVE_B_EXIT_THRESHOLD` |
| Tier 1 (score 9–10) base size | $50,000 | `config.SLEEVE_B_TIER_BANDS[0]` |
| Tier 2 (score 7–<9) base size | $40,000 | `config.SLEEVE_B_TIER_BANDS[1]` |
| Tier 3 (score 5–<7) base size | $30,000 | `config.SLEEVE_B_TIER_BANDS[2]` |
| Sleeve B rebalance tolerance | max($500, 3% of position target) | `config.SLEEVE_B_REBALANCE_*` |

Any change to these requires Senior Quant sign-off + a backtest re-run in
the same PR.

## Exit behavior (retired Sleeve A)

The diff engine is signal-only and reconciles **every** held position against
the (single) Sleeve B target:

* A held name still in the Sleeve B target resizes only when its signal-driven
  target differs from cost basis by more than the rebalance band.
* A held name **not** in the Sleeve B target is sold in full (whole quantity)
  to cash. This is exactly how the retired Sleeve-A ETFs are unwound: with no
  Sleeve A target, those ETFs are absent from the only target and are emitted
  as exits. No held position is ever silently orphaned.
