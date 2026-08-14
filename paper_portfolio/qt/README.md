# Quality Trend v3 — production pipeline

The strategy itself is specified in `paper_portfolio/QUALITY_TREND_V3.md` and its
weights live in `paper_portfolio/strategy_config.py`. This directory is the code
that runs it for real.

## The rule that shapes everything here

**Scoring never places orders. Only one job can move the account.**

| Job | Fires | Can it trade? |
|---|---|---|
| `QT-FUNDAMENTALS-REFRESH` | monthly, 26th | no |
| `QT-REBALANCE` | monthly, first trading day | no |
| `QT-PLACE-ORDERS` | manual dispatch only | **yes — and only when `confirm` is literally `GO`** |

`execute.py` repeats the check in Python (`--live` *and* `--confirm GO`), so a
mis-edited workflow file cannot submit on its own. It also refuses any plan over
120 orders or 110% of equity in gross turnover — a rebalance that large is a bug,
not a rebalance.

## Files

| File | Does |
|---|---|
| `data.py` | universe (Alpaca assets, funds stripped), daily bars, point-in-time fundamentals, meaningful-insider score |
| `score.py` | the scorer — production twin of the validated backtest |
| `rebalance.py` | build the 40-name book → `qt_target_book` |
| `execute.py` | diff book vs account → orders → `qt_orders` |
| `sec_refresh.py` | SEC XBRL bulk archive → `qt_fundamentals` |

## Tables

- `qt_fundamentals` — one row per (symbol, tag, period_end) with the SEC **acceptance date**. The scorer filters `filed <= as_of` and nothing else. Using period-end dates instead is how you build a backtest you cannot trade.
- `qt_target_book` — the 40 names per rebalance date, with the inputs that put them there.
- `qt_orders` — every order intent, with a deterministic `client_order_id` so a half-failed batch can be re-run safely.
- `qt_run_log` — one row per scoring or execution run.

## Two traps already paid for

**Survivorship bias.** SEC's `company_tickers.json` maps only companies that still
exist. The first quality build joined on it, silently deleted every company that
had died, and showed Sharpe 0.86 → 0.93. An isolation test attributed +0.08 to the
narrower universe and **−0.01 to the signal** — the entire gain was the bias.
Matching dead companies by name recovered 401 firms and flipped it to −0.02 universe,
**+0.07 signal**. Production is allowed to use the live ticker map because it scores
today's tradable universe; **historical research is not**.

**The insider signal is negative until you filter it.** All open-market buys run
−2.07% vs market over six months. Officers and directors only: +0.54%. Stake
increase ≥100%: +10.80%. Doubled stake *and* buy under $250k: **+14.51%**. Dollar
size runs the other way — buys over $1M are −3.01% — which is why a big ticket is
halved rather than rewarded. A $300k top-up by a 10% holder is rebalancing, not
conviction, and never counts.

## Running it by hand

```bash
python -m paper_portfolio.qt.rebalance --dry-run      # score, print, write nothing
python -m paper_portfolio.qt.execute                  # print the order plan
python -m paper_portfolio.qt.execute --live --confirm GO
```

## Known limits

- Alpaca's free SIP feed rejects an `end` date inside the last two sessions, so bars are pulled to T-3 and scores are stamped with the date they actually end on.
- `insider_history_edgar` starts 2026-04-21, so the 180-day insider window is not yet full. The term is bonus-only and clipped at zero, so partial coverage degrades the signal rather than corrupting it.
- Fundamentals cover ~4,700 companies. A company with no filed financials is dropped from the book rather than scored on price alone — guessing is what produced the biased build.
