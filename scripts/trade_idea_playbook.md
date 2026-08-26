# Trade Idea — scheduled-session playbook

**Who runs this:** the "MacroTilt Trade Idea" scheduled Cowork task, Sunday and
Wednesday evenings ET. The model runs on Joe's Claude subscription — the
metered Anthropic API is not used anywhere in this flow (Joe directive
2026-08-06: no API spend on top of the subscription).

**Division of labor:** the session COMPOSES the note. Everything after that is
code in git: `scripts/build_trade_idea.py --prepare-file` validates it against
the contract and merges it into `public/trade_ideas.json`, and the
`ops-code-commit` edge function commits that file to `main` (Vercel deploys
it). **The session never emails, never trades, and never pushes with its own
git credentials.**

**Canonical contract:** `scripts/build_trade_idea.py` is canonical. If this
file and that script ever disagree, the script wins — update this file in the
same commit that changes it.

**What this is not:** it is not a recommendation to any person, it is not
signal for the paper engine, and it never claims a track record. The paper
portfolio is a separate, backtested system; nothing here touches it.

---

## Steps

**0. Gate.** The session runs EVERY MORNING before the US open (the scheduled
task fires ~5:15 AM ET; anything published must be live and verified by 7:00 AM
ET). Publication is SELECTIVE — Joe, 2026-08-26: *"I want to run it every day,
but only publish 1 or 2 times a week, the best ideas."* The contract enforces
it: a third note inside any rolling seven days is rejected. So publishing today
is a claim that this idea beats whatever the rest of the week might offer — on
a day the best candidate is marginal, hold it and say so. An absent note is
correct; a forced one is not. The tile carries the previous note between
publishes by design.

Two consequences of the daily cadence:
- The MORNING RESEARCH sweep (overnight international sessions, major wires,
  policymaker statements, today's releases — dated pages only) runs every day
  whether or not anything publishes, and what it finds feeds the next day's
  judgment of "best of the week".
- If a note dated within the last two days is already live and nothing has
  materially changed, the bar for another is even higher — the tile carries a
  position, not a headline.

**1. Fetch the data.** All public, no secrets:

- `https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-latest` —
  every indicator's latest value with its own `as_of`. **Prior cash closes.**
- `https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-positioning` —
  CFTC positioning extremes with `weeks_at_extreme`, plus the scored setups
  and fresh insider filings.
- `https://macrotilt.com/indicator_history.json` — the full history behind
  every indicator. **Use it.** A percentile computed from this file is worth
  more than any adjective: it is what makes the note proprietary rather than
  commentary. Compute the current reading's rank over 1y / 3y / 10y / full
  history and quote the window you used.
- `https://macrotilt.com/positioning_tff.json` — **positioning split by WHO holds it**:
  leveraged funds (hedge funds), asset managers (real money) and dealers, across
  25 equity index / rates / FX / vol / crypto contracts, weekly back to June
  2010. Percentiles are computed over the FULL 843-week history, not a
  convenient window. `opposed_markets[]` lists the markets where fast money and
  real money sit at opposite extremes. This is the public instrument that
  answers what Goldman's Prime Services positioning work answers for its
  clients — that work is client-distributed under contract and will never be a
  source here.
  **Read the null results below before building an idea on it.**
- `https://macrotilt.com/econ_calendar.json` — the dated releases the idea
  will live or die on. The "Dates that decide it" section comes from here.
- `https://macrotilt.com/trade_ideas.json` — what has already been published.
  Read it. The contract rejects a repeat of a live instrument inside 21 days.
- Web search for anything the feeds do not carry — usable only if the page
  carries a visible publication timestamp.

**2. Pick the idea.** Free-form macro: it can start from any theme, with our
data as the support (Joe, 2026-08-13). It must still be a *trade*, not an
observation — something with an instrument, a horizon and a level that proves
it wrong.

Bias toward what the data actually says over what would make a good headline.
"Nothing is stretched enough to write about" is a valid outcome on a given day;
a forced note is worse than a late one.

**3. Compose ONE JSON object** with these keys:

`date`, `kind` (one of macro / cross-asset / single-name / rates / credit / fx /
commodity / equity), `title`, `dek`, `position_type`, `call`,
`the_trade{buy, sell?, short?, sizing?}`, `edge{source, summary, backtest{window,n,result,baseline}}`,
`variant`, `instrument`, `horizon`, `thesis[]`
(three or more), `evidence[]` (each `{claim, value, source, as_of}`),
`charts[]` (2–5), `levels{trigger, invalidation, target}`, `sections[]` (each
`{title, prose}` or `{title, bullets[]}`), `other_side`, `risks[]`, `so_what`.

### The call — a claim with a horizon, never an order

This field has now failed in both directions on the same day, which is worth
understanding before writing one.

The FIRST note led with `instrument`: *"Long the 10-year Treasury, funded by
trimming US large-cap equity beta."* Correct desk English; Joe read it as
*short the stock market*, which is the opposite of what it meant.

The fix over-corrected into an instruction — *"Sell a slice of your US
large-company stocks and put the money into 10-year US government bonds"* — and
Joe's verdict was: *"Can we not be so blunt... Saying SELL STOCKS AND BUY
TREASURIES is a terrible headline. We need to set stage."* He also asked for
**more** technical content, not less, and for the horizon to be explicit:
*"Are we talking about a 6 month trade, a 5 year trade."*

So `call` is a **claim**, not an order:

> ORDER — Sell a slice of your US large-company stocks and buy 10-year bonds.
> CLAIM — Over a five-to-ten-year horizon the 10-year Treasury is priced to
> out-return US large-cap equities: the S&P 500's cyclically-adjusted earnings
> yield now sits 2.14 points below the nominal 10-year, the widest that gap has
> been in our data since 2006.

Enforced by the contract:

- **60–340 characters**, and it may not OPEN with an imperative (buy, sell,
  short, own, add, cut, trim, move, rotate, switch, hold, avoid…). The
  instruction belongs in `the_trade`, where the tile prints it under Buy / Sell.
- **It must name its horizon**, and a horizon CUE is required — "over the next
  12 months", "over a five-to-ten-year horizon", "through 2027". An instrument
  tenor does not count: *"the 10-year Treasury"* contains a perfect period
  expression and says nothing about how long the view is held.
- **Desk shorthand is still rejected** — beta, convexity, carry, notional,
  steepener, flattener, DV01, gamma, vega, basis risk, roll-down. Note what is
  NOT on that list any more: yield, total return, valuation, percentile, spread,
  term premium, cyclically-adjusted. Those are the vocabulary of the argument
  and Joe wants them used.
- `horizon` must state an explicit period too — "5–10 years for the case · 1–2
  quarters for the entry". "Medium term" is rejected.
- `position_type` — one of `allocation shift`, `outright long`, `outright short`,
  `long/short spread`, `hedge`. Renders as a badge, so the reader
  knows whether anything is being sold short before meeting a number.
  `outright short` and `long/short spread` REQUIRE `the_trade.short`.
  `watch only` is RETIRED (2026-08-24) — see "A relative edge you cannot short".
- `the_trade` — `buy` is required; add `sell` (what is sold to fund it),
  `short` (only for an actual short) and `sizing`.

### A relative edge you cannot short (2026-08-23)

Joe, on the gold note: *"you just assume people have gold. 'Sell a slice of
existing gold position' what if someone doesn't own gold"* — and then, on the
rewrite that turned the funding leg into an actual short: *"I dont agree to
short gold. Thats insane."* Both are right, and together they close a door that
is worth understanding rather than working around.

A RELATIVE edge — A lags B — has exactly three expressions and no fourth:

1. short A against long B;
2. switch out of A, which requires the reader to already own A;
3. nothing.

The first note wrote (2) and phrased it as an instruction, which silently
assumed a holding the reader may not have. The fix reached for (1). With both
ruled out the answer is (3) — and (3) means DO NOT PUBLISH, not "publish it with
a different badge".

That distinction cost a whole evening. The note went out labelled `watch only`,
under a tile headed TRADE IDEA, with a fact strip reading "there is no entry,
because there is no position" beside a column headed "What kills it". Joe:
*"We cannot have a tile that says TRADE IDEA on the fucking website and then
post NO TRADE IDEA... THEN YOU HAVE WHAT KILLS IT?!?!!?"* `watch only` is now
retired from the contract. A finding with no trade in it is a finding; this
surface is for trades, and the tile is designed to keep showing the previous
note until there is a new one. Two publishable notes a week is the cadence, not
the quota.

Three rules follow.

**Never manufacture a leg to satisfy a field.** `the_trade.buy` used to be
required on every note, so a note with nothing to buy invented something — that
is literally how "sell a slice of your existing gold holding" got written. The
contract now exempts `watch only` from `buy` and requires
`what_would_make_it_a_position` instead.

**Never borrow a relative edge's credibility for one leg of it.** The gold note
measured gold trailing the S&P by a median 6.76pp over six months. It would have
been easy to publish "long the S&P 500" and keep all the same evidence. The
S&P's own conditional return in those episodes was +7.30% against a +6.90%
unconditional baseline — no edge at all. One leg of a spread is not a position
the spread's backtest supports, and publishing it as one is a lie told with true
numbers.

**Never write an instruction that presumes a holding.** "Trim", "sell a slice
of", "rotate out of", "move part of your X" all assume the reader owns X. State
the position; if owning it already is a cheaper way in, that belongs in `sizing`
as a variation, never as the premise.

### A call is a portfolio action; the reader holds the BOOK (2026-08-25)

Joe: *"We have 4 calls on the page... Every new call needs to take into account
previous calls. We need to be giving ideas on how to structure portfolios,
rebalance, etc."* The reader this product serves is not choosing a headline —
they are running money, and to them four disconnected notes are four questions,
not four answers.

So, from 2026-08-26, every note carries a `book` block, contract-enforced:

- **`book.stance`** — what the WHOLE live book is positioned for once this call
  is in it, written as one portfolio: what is owned, what is tilted, what the
  book as a whole is betting on and not betting on, and which call carries the
  most and least conviction. The newest note's stance renders on the Scorecard
  as "The book right now", so the table of calls always states what its rows
  add up to.
- **`book.rebalance`** — what a reader holding the earlier calls actually DOES:
  add, trim, replace, or leave alone — named per call, including which existing
  position is the first to come off and when.

Composition order follows from it: the sweep starts by re-reading the live
book's exposures, and the first question a candidate must answer is not "is
the edge real" but "does the book need this" — a fifth bond-adjacent call may
be a worse note than a weaker signal that diversifies the book. Exposure
conflict already has its own gate (the reconciliation rule); this one is about
construction, not contradiction.

### The search is a SWEEP, not a defence of the first signal found (2026-08-24)

The gold-volatility session found one real signal, lost its only publishable
expression, and then spent three rewrites defending the corpse instead of going
back to the board. Joe: *"You are supposed to be the world's best cross asset
market analysis. You cant come up with a fucking trade idea? You are so narrow
minded hung up this gold thing."* The fix that session: sweep every family —
positioning across all 25 TFF markets, the volatility surface, credit, the
indicator percentile scan — kill candidates on their own backtests (oil vol
died on its 2014-15 sub-period, natgas on its full-history percentile), and
publish the one that survived. That is the standing method:

1. **Rank the whole board first.** Compute percentiles for every indicator and
   every positioning market before writing a word. Candidates come from the
   extremes list, not from whatever was interesting last session.
2. **A candidate that dies stays dead.** No re-expressing, no relabelling — the
   next candidate is one line down the list.
3. **Shorts live inside relative-value trades, never as long-horizon bets
   against a trend (Joe, 2026-08-25).** The gold episode settled this policy in
   two halves. What is OUT: an outright short of a trending asset held for
   quarters — "short gold for 6-12 months" fails however good the signal,
   because trending assets (gold above all — see the cross-asset map: gold
   extremes are followed by MORE upside) can run against a short far longer
   than the edge lasts, and the carry of being short compounds the pain. What
   is IN: a short leg inside a specific relative-value trade — long one thing
   against short a related thing — when the pair is the honest expression of a
   measured edge. Every short-containing note must clear a HURDLE the contract
   enforces: `edge.vs_market` states, with a number, the expected return over
   the horizon and why it beats simply holding the S&P 500. The Scorecard
   already grades every call against the S&P, so the claim is marked, not
   just made. An edge with no long-only expression AND no defensible RV pair
   is still context for the next note, not the note.
4. **Read the street before writing the variant.** Web-search current sell-side
   and financial-press positioning on the candidate (dated pages only). The
   `variant` field should quote a real, dated piece of consensus — arguing with
   a strawman is how a note ends up obvious.

**Set the stage.** Match the horizon to the SIGNAL. A cyclically-adjusted
earnings yield carries information about five- and ten-year returns and close to
none about the next twelve months, so a note built on it is a five-year note
with a tactical entry — and it should say so, in a section of its own, rather
than leaving the reader to work out which product they are being handed.

### The bar an idea has to clear

Joe, 2026-08-14: *"Making a call 10 years out is not helpful. I want more trades
ideas... next several quarters. This bond idea is not profound at all. You could
look at Buffet Indicator or CAPE alone and say 'stocks are expensive over long
term historical context.' What about positioning, technical analysis across
assets. You keep coming back to such basic crap anyone can see - not something
someone with decades of trading and risk managing experience can see."*

Three rules follow, and the contract enforces all three.

**1. Next several quarters. Maximum 18 months.** A ten-year valuation view is an
asset-allocation opinion, not a trade. `horizon` is rejected above 18 months.

**2. A famous ratio may not be the driver.** CAPE, the Buffett indicator, market
cap to GDP, the equity risk premium, price to book — visible to anyone with a
browser, unchanged for years at a time, silent about the next two quarters. They
are welcome as CONTEXT in the thesis. They are rejected in the title, the call or
the edge summary.

**3. The driver is a measured edge.** `edge.source` must be one of: positioning,
cross-asset divergence, technicals, volatility structure, flows, relative value,
calendar mechanics, credit, market structure. And `edge.backtest` requires four
fields:

| field | what it is |
|---|---|
| `window` | the sample and its dates |
| `n` | observations (minimum 3) |
| `result` | what followed the signal |
| `baseline` | **the unconditional outcome over the same horizon** |

`baseline` is the one that does the work. A 77% hit rate means nothing until you
know the unconditional rate is 52%. **This rule has already killed an idea.** The
first note written under it was going to be an equity-index squeeze — Nasdaq
speculative positioning at the 1st percentile of three years, Russell at the 2nd,
commercials at the 100th on both. Exciting, and its own backtest destroyed it:
forward Nasdaq returns after those extremes were −0.60% / +2.35% / +3.73% at one,
three and six months against unconditional readings of +2.30% / +6.15% / +11.53%.
Buying the extreme was WORSE than buying at random at every horizon. The note that
shipped instead was the one where the base rate held up.

### Where positioning actually works — the cross-asset map

Tested 2026-08-14, one method applied identically to every asset class: rank the
speculative/fast-money net position as a share of open interest against its FULL
history, take the extremes, and compare forward returns to the UNCONDITIONAL
return over the same sample. Medians below, conditional versus unconditional.

| asset class | signal | 3-month result | verdict |
|---|---|---|---|
| **Currencies** | euro, specs ≤15th pctile | **+3.18% vs +0.18%** (77% vs 52% positive) | **works** |
| **Currencies** | dollar, specs ≥85th pctile | −1.25% vs +0.06% (73% vs 49% lower) | **works**, 1–3m only |
| **Agriculture** | wheat, managed money ≥85th | **−5.98% vs +0.14%** (14 episodes, 12y) | **works — fade the long** |
| **Agriculture** | corn, managed money ≥85th | −1.08% vs +0.73%, −6.49% vs −0.83% at 6m | works, slower |
| **Agriculture** | soybeans, managed money ≥85th | −1.54% vs +0.90% (21 episodes) | works |
| **Agriculture** | corn/wheat/beans, managed money ≤15th | +4.11 / +4.04 / +2.38% vs +0.73 / +0.14 / +0.90% | **works — buy the short** |
| Precious | silver, managed money ≥85th | −1.69% vs +1.75% (27 episodes) | works |
| Precious | **gold, managed money ≥85th** | **+2.96% vs +2.68%** — and +9.68% vs +5.30% at 6m | **does NOT fade — gold TRENDS** |
| **Equity index** | S&P / Nasdaq, every formulation | inside the noise, 16 years | **dead** |
| **Equity breadth** | 50-day breadth below 200-day | +3.83% vs +3.92% | **dead** |
| Energy | WTI, managed money ≤15th | −8.98% vs −0.34%, but 3 episodes from 2019 | **too thin — do not use** |
| Copper | managed money ≥85th | +4.85% vs +2.40%, 3 episodes from 2022 | **too thin — do not use** |

Three things to take from this table, none of which are obvious:

1. **"Positioning works" is not a fact about markets. It is a fact about
   particular markets.** The same test that finds nothing in equity index futures
   finds a 3-to-4x base-rate effect in grains. Never carry a conclusion across
   an asset class without re-running it there.
2. **The direction is not symmetric and it is not the same everywhere.** Managed
   money at a max long is a reliable FADE in wheat, corn, soybeans and silver —
   and the opposite in gold, where an extreme long has been followed by MORE
   upside at every horizon. A note that treats "extreme = fade" as a law will be
   wrong in gold specifically.
3. **Episode count, not week count.** Copper and WTI look tradeable and are not:
   their samples start in 2022 and 2019 and contain 3 episodes each. Below about
   ten independent episodes there is nothing to lean on.

**As of the 2026-08-04 report there is NO commodity trade here.** Gold is at the
82nd percentile, copper 96th, wheat 58th, corn 51st, soybeans 48th, silver 30th —
nothing sits at an extreme in a market where the signal is both live and
well-populated. That is a complete answer, and the right one. Do not reach for
the nearest thing and call it a setup.

**Where equity edge actually lives in this system:** not in index-level
aggregates — both the positioning and the breadth tests above are dead — but in
the single-stock work that was backtested when it was built: the insider
conviction scan, the Power Trend list, RSI divergences and FINRA short interest.
An equity note should start there, at the name level, not from an index chart.

### Signals already tested and found EMPTY — do not republish these

Measured 2026-08-14 on the full CFTC record, 843 weekly reports from June 2010.
Each was run against the unconditional base rate over the same sample. **None of
them clear. Do not spend a note on them without new evidence.**

| signal | 1m | 3m | 6m | unconditional |
|---|---|---|---|---|
| Nasdaq — hedge funds bottom 15th pctile | +2.45% | +4.89% | +9.58% | +1.89% / +4.83% / +9.37% |
| Nasdaq — the standoff (HF bottom 15th AND asset managers top 60th) | +2.29% | +4.22% | +7.15% | same |
| S&P — hedge funds bottom 15th pctile | +1.35% | +3.70% | +6.74% | +1.53% / +4.06% / +7.03% |
| Nasdaq — one-week hedge-fund change in the bottom decile | +1.68% | +5.48% | — | +1.90% / +4.84% |
| S&P — one-week hedge-fund change in the bottom decile | +1.72% | +3.33% | — | +1.53% / +4.06% |

Measured 2026-08-17, same method, on the volatility and credit surface. Also empty:

| signal | 6m conditional | 6m unconditional | verdict |
|---|---|---|---|
| S&P breadth — 50-day above 200-day | +3.83% | +3.92% | dead |
| VXN/VIX ≥ 90th pctile → Nasdaq over S&P | +1.98pp | +1.97pp | dead in both directions at 6m |
| SKEW ≥ 90th pctile ("crash hedges dear") → S&P | +5.39% | +6.21% | inside the noise, 58 episodes |
| Equity–credit correlation ≤ 10th pctile → S&P | +6.82% | +6.50% | dead |
| Banks ÷ S&P ≤ 10th pctile alone → S&P | +8.91% | +6.14% | real but always-on; no entry discipline |

**A data trap that cost an hour and would have printed a false headline.** The
`hy_ig_etf` series is the **LQD ÷ HYG price ratio**, and on 2026-08-14 it sat at
the 0.1st percentile of five years — which reads instantly as maximum credit
stress and is the opposite of the truth. Two artifacts: the label direction
(a LOW ratio means high yield is *out*performing, i.e. risk-on), and the fact
that a *price* ratio of two funds with different distribution yields drifts
mechanically regardless of spreads. The spread-based reading — HY OAS at 271bp,
the 10th percentile of its 2011-2026 range — said credit was near its tightest,
not its widest. **Never take a directional reading off an ETF price ratio when a
spread series exists; check `indicatorRegistry.js` for what the series actually
divides by before writing a sentence about it.**

**Equity-index futures positioning does not forecast equity returns** — not the
level, not hedge funds alone, not the fast-money-versus-real-money standoff, and
not the rate of change. Sixteen years, every formulation tried, all inside the
noise. Most positioning commentary claims otherwise; the data does not support
it, and a note that says "hedge funds are at a record short, therefore squeeze"
is the exact "basic crap anyone can see" this playbook exists to prevent.

A trap worth naming: the standoff DID look strong on a five-year window
(+3.47% at one month, 89% positive, against +1.84% / 63%). It evaporated on the
full sample. **If a result only appears in a short window, the window is the
finding.**

Where positioning HAS cleared is the currencies — see the 2026-08-14 note. Test
each market on its own; "positioning works" is not a fact about markets, it is a
fact about particular markets.

### Where the EQUITY edge lives — the volatility surface, not the index chart

Measured 2026-08-17. The index-level equity signals are empty twice over:
positioning (above) and breadth (S&P members above the 50-day against the
200-day: +3.83% versus a +3.92% baseline). Both dead. What is NOT dead is the
**shape of the volatility curve**, and it is the one equity signal in this
system that most readers will guess backwards.

`vix_ts` = 30-day implied volatility ÷ three-month implied volatility (VIX ÷
VIX3M), carried daily from 2006-07. Below 1.00 is contango, the normal state.
Ranked on a **causal trailing five-year percentile**, episodes separated by 42
trading days, 2011-12 → 2026-08:

| entry: curve ≤ 5th pctile | 1m | 3m | 6m | 12m |
|---|---|---|---|---|
| S&P conditional (n=37) | +0.40% | +2.19% | +4.36% | +10.20% |
| S&P unconditional | +1.11% | +3.34% | +6.63% | +13.48% |
| hit rate | 61 / 67% | 63 / 76% | 74 / 82% | 85 / 86% |
| **banks ÷ S&P** | — | +1.28% | **+1.72%** | +1.62% |
| banks ÷ S&P unconditional | — | −0.60% | **−1.11%** | −2.94% |
| Nasdaq excess over S&P | — | +0.03pp | +0.96pp | — |
| Nasdaq excess, unconditional | — | +1.00pp | +2.03pp | — |

Three things make this usable where the positioning work was not:

1. **It is stable.** Every sub-period is negative (2011-15 −2.03pp, 2016-20
   −1.28pp, 2021-26 −4.33pp) and every threshold from the 2nd to the 20th
   percentile is negative (−1.28pp to −2.40pp). Contrast the "standoff" trap
   above, which lived in one window only.
2. **It is symmetric.** The top 5th percentile — backwardation — preceded a
   +8.97% six-month S&P return against the same +6.63% baseline. A signal that
   works in both directions is much harder to have fitted by accident.
3. **It says something non-obvious.** The reflex reading of steep contango is
   *complacency, therefore danger*. The measured outcome is **dilution, not
   danger**: P(≥10% drawdown within six months) is 22% conditional against 19%
   unconditional, and at three months the conditional figure is the LOWER one
   (8% against 11%). Return compresses; risk does not rise. That is a
   portfolio-construction finding, not a hedging one — which is why the
   tradeable expression is a rotation (banks, mid-range at the 44.6th
   percentile) rather than a reduction.

Cross-asset volatility ratios are now carried too (`gvz`, `ovx`): gold and crude
implied volatility against the VIX. Their use is context, not signal — they say
whether cheap equity volatility is part of a general calm or specific to
equities. On 2026-08-14 it was specific (GVZ/VIX 97th percentile, OVX/VIX 94th,
MOVE at the 14th).

**Run the backtest before writing a word of prose.** If the conditional result
does not separate from the baseline, there is no note — go and find another one.

**4. `variant` — why is this not obvious?** State what consensus believes and
where this differs. If the honest answer is "nothing", do not publish.

### Charts

Joe: *"I'd like to include charts embedded in the tile and note. Several charts
to show visuals of what you're writing about."*

Charts are **declarative**, and this is the important part: a chart names a
series that already exists in `indicator_history.json` and the site draws it.
Nothing is plotted from numbers typed into the note, so a chart can never
disagree with the sentence beside it — and a note cannot illustrate a series we
do not carry. The contract checks every named series against the real file and
rejects one that is missing or too short.

```json
{
  "series": "erp",
  "title": "What stocks pay you over bonds",
  "subtitle": "S&P 500 cyclically-adjusted earnings yield minus the 10-year Treasury yield, monthly since 2006",
  "unit": "%", "decimals": 2, "window": "full", "zero_rule": true,
  "caption": "Below the zero line, a Treasury pays more than the S&P's long-run earnings yield…",
  "source": "MacroTilt indicator history (Shiller CAPE + FRED DGS10)"
}
```

- 2 to 5 charts, each a DIFFERENT series. The first is the tile's chart.
- `window`: `1y` / `3y` / `5y` / `10y` / `20y` / `full`.
- `title` is what the reader learns, not the series name — "What a bond pays
  after inflation" beats "real_rates".
- The `caption` is the point of the chart: say what crossing the line means. A
  chart without one is decoration.
- Every chart is a SINGLE series. If two measures matter, that is two charts —
  never two lines on one plot and never a second y-axis.

### HARD CONTRACT (the script enforces every one of these)

1. **Every number lives in `evidence[]` with its own `source` and `as_of`.** A
   figure with no provenance is not printable. An omitted figure is correct; a
   wrong one is a failure. (LESSONS 4.21a.)
2. **`levels.invalidation` must be concrete** — a level, a date, or a specific
   observable event. "Manage risk carefully" is rejected.
3. **`other_side` must be a real counter-argument**, not a hedge clause. Joe:
   "balanced but technical and informative." Where our own data argues against
   the idea, that data belongs in `evidence[]` too, labeled as such.
4. **No path word** ("rebounded", "eased back", "stabilised", "broke out") unless
   the evidence block carries two differently-dated observations. (LESSONS 4.21b.)
5. **Never call a level a high or a record** unless the series you are quoting
   shows it and no later observation exceeds it. Name the series and its start
   date when you do.
6. **No performance claim of any kind.** No "our last call", no track record, no
   win rate. There is no verified one.
7. **No advice language.** "You should buy", "guaranteed", "risk-free" are
   rejected. This is research about a market, not instruction to a person.
8. **Banned copy** — "washed out", "crowded" (write "extended short" /
   "extended long"). Scrubbed deterministically as well.
9. **Novelty** — the contract rejects the same `instrument` inside 21 days.
10. **Plain English** for a smart non-trader; translate jargon every time. Never
    print an internal field name, a feed name, or narration of your own
    research state.
11. **Every chart's series must exist in `indicator_history.json`** and the note
    may not plot the same series twice.

**4. Validate through the versioned contract.**

```
git clone --depth 1 https://github.com/jmezzadri/market-dashboard.git /tmp/md
curl -s https://macrotilt.com/trade_ideas.json -o /tmp/md/public/trade_ideas.json
python3 /tmp/md/scripts/build_trade_idea.py --prepare-file /tmp/idea.json \
        --out /tmp/md/public/trade_ideas.json
```

Must print `prepared OK`. If it errors, fix the JSON and rerun — never submit a
note that failed the prepare step. Pulling the live file first is what makes
the novelty check real; validating against an empty file checks nothing.

**4b. The scorecard block — REQUIRED, and written BEFORE you know the answer.**
Joe, 2026-08-17: *"Can we somehow track our trade ideas and how they performed?
I'd like to start collecting historical data on our calls."* A note cannot be
marked from its prose, so every note states its position a second time in
machine-readable form:

```json
"scorecard": {
  "legs": [{"series": "bkx_spx", "side": "long", "measure": "pct_change",
            "label": "US banks / S&P 500"}],
  "horizon_months": 6,
  "invalidation": {"series": "vix_ts", "op": ">=", "level": 1.00, "basis": "close"},
  "benchmark": {"series": "spx_index"}
}
```

- `measure` is `pct_change` for a price or a ratio, `level_change` for a yield
  or a spread. Marking one as the other is silently wrong: a breakeven going
  2.30 to 2.45 is +0.15pp, not +6.5%.
- `horizon_months` may not exceed the horizon the prose claims. The gate checks
  this — a call cannot be graded over a period it did not claim.
- If the leg is already a RATIO of the two things being compared, do not add a
  `benchmark`; that subtracts the index twice.
- `invalidation` is the same stop the prose states, as a number. `basis` is
  `close` or `weekly_close` — "a weekly close below 2.10" must not trigger on a
  Tuesday print. If part of the stated stop is not machine-checkable (a payrolls
  print, say), say so in `scorecard.note` so the gap is visible rather than
  assumed away.

**This block is written at publication and never edited afterwards.** A
scorecard added once the outcome is visible is not a record of a call, it is a
record of a preference. `scripts/score_trade_ideas.py` marks from this and
nothing else; `/scorecard` renders the result and computes nothing.

**5. Submit** the prepared `public/trade_ideas.json` to `ops-code-commit`
(bearer token is in the scheduled task's instructions — it is NOT in this repo),
branch `idea/<date>`, `merge: true`.

**6. Verify.** Load `https://macrotilt.com/` and read the Trade Idea tile.
Confirm the plain-English line, the position badge, the fact columns and the
tile chart render, and that "Read the full note" opens the note with every chart
drawn. **Look at the charts** — the validator checks the data, not the layout,
and a label that collides with another label is invisible to every assertion.
Markup containing the string is not verification.
