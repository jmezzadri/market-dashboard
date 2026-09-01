# MacroTilt Data Governance Standard

**The operating method for every piece of data on the site.** Written 2026-06-19 after Joe
(rightly) called out that freshness chips, lineage, and sources have all been handled
reactively — "no method, shooting from the hip." This is the single standard all three derive
from. If a data question can't be answered by an element's record below, the record is
incomplete — fix the record, don't improvise a one-off.

---

## Core principle

**Every data element on the site is ONE registry record — a "Data Element Contract."** Sources,
lineage, and freshness are not three separate systems; they are three blocks of the same record.
Each record is fully specified and **verified against the producer code — never guessed, never
mashed.**

## The contract — every element has all 7 blocks

| Block | What it pins down | Rule |
|---|---|---|
| 1. Identity | id, on-site name, **class** (see the complete taxonomy below) | Class decides where it renders and whether it counts as an indicator. Every element is exactly ONE class; the taxonomy is exhaustive — nothing is left without a home. |
| 2. Inputs (1..n) | each distinct **source** | **One provider per source.** Each input = Provider · Dataset · Location · Method (below). |
| 3. Transform | passthrough, or the named in-house computation | A computed element NEVER hides its inputs behind a vendor string — it lists each input source + the transform. |
| 4. Output | the stored artifact (file key / table) | One canonical output. |
| 5. Freshness contract | the single source of the chip (below) | Binary green/red from ONE grader. No per-surface improvising. |
| 6. Consumers | every surface that reads it | Drives the lineage's downstream edges. |
| 7. Owner / failure mode | who owns it, what happens on a bad pull | Fail-loud, never silent. |

## Class taxonomy (exhaustive — every element has exactly one home)

Organized in three tiers. If something doesn't fit, the taxonomy is wrong and gets fixed — we
do not invent a one-off bucket.

**Tier 1 — Macro / market series** (the Macro Overview world)
| Class | What it is | Examples | Typical provider |
|---|---|---|---|
| Market price | Observed prices / index levels, passthrough | S&P/Nasdaq/Dow levels; EOD share prices | Polygon, Yahoo |
| Indicator | A series ranked + shown on Macro Overview & All Indicators (the 50) | VIX, HY OAS, 10y yield, ISM | FRED, Yahoo, Treasury.gov |
| Positioning signal | Speculative / dealer positioning (the 28) | CFTC COT markets; NY-Fed IG/HY dealer inventory | CFTC, NY Fed |
| Derived series | Computed spread/ratio feeding the engine, not shown as an indicator | FRA-OIS, copper/gold, ERP | computed in-house |

**Tier 2 — Per-company data** (the Ticker Detail / Scanner world)
| Class | What it is | Examples | Typical provider |
|---|---|---|---|
| **Reference** | Slow-changing descriptive metadata about an entity | **company overview** (name, sector, description, market cap, exchange); index membership | Polygon ticker reference; SSGA/Invesco/iShares holdings |
| **Event** | Dated, point-in-time events | **next earnings date**, earnings history, dividends, splits, econ-calendar releases | Unusual Whales, Polygon |
| Per-entity metric | Computed per-ticker analytics | score, RSI, IV rank, implied move, greeks, insider tally | computed in-house; Unusual Whales |
| Flow | Per-ticker market activity | options flow, dark-pool prints, short interest | Unusual Whales, FINRA |

**Tier 3 — Content & outputs**
| Class | What it is | Examples | Typical provider |
|---|---|---|---|
| News | External headlines | ZeroHedge feed | ZeroHedge |
| Commentary | In-house generated narrative | macro / sector commentary | MacroTilt (Claude) |
| Model output | Engine / allocation / scenario results | cycle board scores, v10 allocation, asset tilt, scenarios | computed in-house |
| Portfolio | Paper book state | positions, NAV, orders, accounts | Alpaca (paper) |

The class drives rendering: indicators count toward the 50; positioning signals into the
Positioning Signals section; reference/event/metric/flow are the Ticker Detail & Scanner feeds;
news/commentary are content; model output and portfolio are their own tiles.

## Block 2 — Source rules (the thing that was broken)

A **source** = exactly ONE provider pulling ONE specific dataset from ONE specific location.
Each source names four things, always:

1. **Provider** — the actual organization (Wikipedia, iShares, Invesco, SSGA/State Street,
   Polygon, FRED, CFTC, NY Fed, Treasury.gov, Yahoo, ISM, multpl/Shiller, FINRA).
2. **Dataset** — the specific data, named concretely. "Russell 2000 constituents (IWM holdings)",
   not "membership data."
3. **Location** — the exact URL / endpoint / file the producer hits.
4. **Method** — API / CSV / XLSX / scrape / DB.

**Never combine two providers in one source.** "Wikipedia + iShares" is two sources. The Data-page
Source column shows each distinct provider as its own tile, listing its specific dataset.

## Block 5 — Freshness contract (the thing I kept re-inventing)

The chip is not a separate design exercise per element. It is five fields on the record, and ONE
grader renders all of them, binary:

- **Cadence** — how often the SOURCE publishes (daily / weekly / monthly / quarterly).
- **Scheduled fetch (ET)** — when our job pulls.
- **Pull SLA (hours)** — job cadence + grace → the *pull clock* (last successful run vs SLA).
- **Data max-age (hours)** — how old the newest datapoint may be → the *data clock* (data date vs window).
- **Calendar** — which days count (NYSE trading / US business / wall-clock).

Green only if BOTH clocks pass (job ran on time AND new data arrived), calendar-aware. Otherwise
red. Untracked / reference = grey, never silently green. This is the rule shipped 2026-06-19; the
contract is what stops it drifting again.

## Lineage = the chain, read straight off the contract

`Provider · Dataset (Location) → [Transform] → Output → Consumers`

Nothing on the Data page is hand-drawn. Source tiles = block 2 providers. The hops = inputs →
transform/engine → output → consumers. The chip = block 5. If a hop is missing on the page, a
block is missing on the record.

## Worked example — S&P 500 Breadth (50-day), done to standard

- **Identity:** `spx_above_50ema` · "S&P 500 Breadth (50d)" · indicator (Equities)
- **Inputs (TWO sources):**
  - Provider: **SSGA (State Street)** · Dataset: **SPY ETF daily holdings = S&P 500 constituents** · Location: `ssga.com/.../holdings-daily-us-en-spy.xlsx` · Method: XLSX
  - Provider: **Polygon** · Dataset: **EOD prices for those constituents** · Location: `public.prices_eod` (from Polygon grouped daily aggregates) · Method: DB
- **Transform:** MacroTilt computes the % of members closing above their 50-day EMA.
- **Output:** `indicator_history.json[spx_above_50ema]`
- **Freshness:** cadence daily · fetch 16:30 ET · pull SLA 49h · data max-age 54h · NYSE calendar
- **Consumers:** Macro Overview, All Indicators, Methodology

(The old record said vendor = "MacroTilt (Polygon prices_eod)" — SSGA, the actual membership
source, was missing entirely. That is exactly the failure this standard ends.)

## Rollout

1. This standard is the spec. (Source rule already logged to repo `LESSONS.md`, 2026-06-19.)
2. Re-model the manifest so every element carries a structured `inputs` array (the 4-field sources)
   + the transform + the freshness contract + consumers — **each verified against its producer.**
3. The Data page renders sources, lineage, and chips straight from the record.
4. Reconcile: every record complete and verified, or it's flagged — no record ships half-specified.
