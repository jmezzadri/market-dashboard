# `paper_portfolio` — MacroTilt Paper Trading Translator

**Phase 2 deliverable.** Single source of truth for translating the live
Asset Tilt + Equity Scanner output into Alpaca paper orders.

This module **does not submit orders**. It computes targets, diffs against
live Alpaca state, and writes intent rows to `public.paper_orders` with
`status='pending'`. Phase 4 wires execution.

## Module layout

```
paper_portfolio/
├── __init__.py
├── README.md                ← this file
├── config.py                ← paper account config + Senior Quant constants
├── alpaca_client.py         ← read-only Alpaca REST wrapper
├── signals.py               ← Asset Tilt + Equity Scanner readers
├── sleeves.py               ← Sleeve A + Sleeve B target builders (PURE MATH)
├── diff.py                  ← target − live → OrderIntent list
├── audit.py                 ← writers for paper_signal_capture + paper_orders
├── translator.py            ← top-level orchestrator (CLI entrypoint)
└── tests/
    ├── test_sleeves.py      ← 10 tests
    └── test_diff.py         ← 4 tests
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

14 tests; runtime <0.1s. All math is deterministic — no live calls.

## Senior Quant constants (locked v1)

| Constant | Value | Where |
|---|---|---|
| Sleeve B buy threshold | normalized buy-score ≥ 5.0 | `config.SLEEVE_B_BUY_THRESHOLD` |
| Sleeve B exit threshold | normalized buy-score < 5.0 | `config.SLEEVE_B_EXIT_THRESHOLD` |
| Tier 1 (score 9–10) base size | $50,000 | `config.SLEEVE_B_TIER_BANDS[0]` |
| Tier 2 (score 7–<9) base size | $40,000 | `config.SLEEVE_B_TIER_BANDS[1]` |
| Tier 3 (score 5–<7) base size | $30,000 | `config.SLEEVE_B_TIER_BANDS[2]` |
| Sleeve A rebalance tolerance | max($250, 0.5% of sleeve) | `config.SLEEVE_A_REBALANCE_*` |
| Sleeve B rebalance tolerance | max($250, 0.5% of sleeve) | `config.SLEEVE_B_REBALANCE_*` |
| mt_score → buy_score normalization | `max(0, mt_score / 10)` | `signals._normalize_buy_score` |

Any change to these requires Senior Quant sign-off + a backtest re-run in
the same PR.

## Spec drift surfaced in Phase 2

Three places the locked spec mismatched the live codebase. Captured here
for Senior Quant + Joe review before Phase 3.

1. **Industry-group count.** Spec said "17 IGs" / `industry_groups.json`.
   The reference file (`asset_allocation/industry_groups.json`) holds 16
   IGs. The live engine output (`public/v10_allocation.json`) holds **24
   IGs** with more granular splits (e.g. Banks / Insurance / Diversified
   Financials separately). The translator reads from the engine output —
   that is what the Asset Tilt page renders — so Sleeve A builds with 24
   ETF lines today.

2. **Scanner score scale.** Spec assumed a 0–10 buy-score scale. The
   live v5 scanner publishes `mt_score` on [-100, +100]. We normalize as
   `buy_score = max(0, mt_score / 10)` so the spec's cutoffs (≥5 buy, 9–10
   / 7–8 / 5–6 tiers) map cleanly: mt_score ≥ 50 buys at tier 3, ≥ 70 at
   tier 2, ≥ 90 at tier 1.

3. **Sleeve-attribution storage.** Alpaca does not natively tag positions
   by sleeve. v1 attributes by ticker membership (Sleeve A = ticker in the
   current IG ETF universe; Sleeve B = everything else). Phase 4 will
   write sleeve explicitly into `paper_orders.sleeve` at submit time and
   we'll read attribution from the order ledger instead of from ticker
   shape.
