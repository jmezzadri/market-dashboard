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

**0. Gate.** Sunday or Wednesday only. If a note dated within the last two days
is already published, stop — the tile carries a position, not a headline, and
it is supposed to sit there until the next one.

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
  `long/short spread`, `hedge`, `watch only`. Renders as a badge, so the reader
  knows whether anything is being sold short before meeting a number.
  `outright short` and `long/short spread` REQUIRE `the_trade.short`.
- `the_trade` — `buy` is required; add `sell` (what is sold to fund it),
  `short` (only for an actual short) and `sizing`.

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

**5. Submit** the prepared `public/trade_ideas.json` to `ops-code-commit`
(bearer token is in the scheduled task's instructions — it is NOT in this repo),
branch `idea/<date>`, `merge: true`.

**6. Verify.** Load `https://macrotilt.com/` and read the Trade Idea tile.
Confirm the plain-English line, the position badge, the fact columns and the
tile chart render, and that "Read the full note" opens the note with every chart
drawn. **Look at the charts** — the validator checks the data, not the layout,
and a label that collides with another label is invisible to every assertion.
Markup containing the string is not verification.
