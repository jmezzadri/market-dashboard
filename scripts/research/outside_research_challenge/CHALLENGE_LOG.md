# Outside research — challenge log

**What this is.** Joe, 2026-10-02: *"I don't want to publish this as COMPETING
RESEARCH. I want it to improve our research and trade ideas. I want you to
challenge yourself with their analysis. Not simply look at their calls vs ours
and run a comparison."*

So this is not a digest of somebody else's views. It is a record of what
reading them made us TEST about our own work, what the test found, and what we
changed. Newest entry first. Internal: nothing here is served on the site,
named in the brief, or cited in a note. A post's ideas are restated in our own
words and never copied.

**Every entry answers five things:** what their work does that ours does not ·
the question that puts to us · the test, on our data · the result, with its
baseline · what changed in MacroTilt. An entry with no test is not an entry.

Procedure: `PLAYBOOK.md`. Posts already read: `processed_posts.json`.

---

## 2026-10-27 — weak credit under a strong index: is the range divergence a signal on its own?

Ten posts since the last read (Oct 3–26; eight read in full, two members-only
episodes read from their public topic lists; all listed in
`processed_posts.json`). Also read, by sender, four Macro Ops letters and
twelve Daily Upside issues from the inbox (`letters_read.json`). Nothing new
from Praetorian since the Q3 letter; nothing from Greenhaven Road in 60 days.

**What their work does that ours does not.** It reads low-grade credit and
the index TOGETHER as a position in their recent ranges — the weakest bonds
near the bottom of a three-month range while the index sits near the top —
and treats that divergence, not the spread level, as the warning. It also
reads a rising rates-vol index against a calm equity-vol index as the first
crack, and counts momentum-factor crash days as a regime marker.

**The question that puts to us.** The Oct 22 SPY-puts call rests on one
measured signal: high-yield spreads widening 50bp+ with the index near a
record (five cases since 2014). Does the RANGE divergence add anything to
that, and is it live today?

**The test.** `credit_range_test.py`, output `results_2026-10-27.txt`. Range
position = (close − 63-session low) / (63-session high − low). Credit on HYG
price (daily 2007–) and, for robustness, HYG/IEF. Trigger: credit ≤ 0.15
AND SPY ≥ 0.90; first trigger in any 21 sessions; thresholds also moved to
0.25/0.85 and 0.10/0.95. Next 15, 63 and 126 sessions in SPY against every
day in the sample; share of windows with a 5% drawdown.

**The result.** Below baseline but small and thin on HYG price; nothing on
HYG/IEF.

| state | SPY next 63 sessions | baseline | episodes | 5% drawdown within 63 |
|---|---|---|---|---|
| HYG ≤ 0.15, SPY ≥ 0.90 | −0.6%, 56% up | +2.4%, 71% up | 9 | 67% vs 58% |
| HYG ≤ 0.25, SPY ≥ 0.85 | +0.3%, 62% up | +2.4%, 71% up | 21 | 57% vs 58% |
| HYG/IEF ≤ 0.15, SPY ≥ 0.90 | +2.9%, 91% up | +2.4%, 71% up | 11 | 64% vs 58% |

At 15 sessions (the Nov 13 put's window) the tight HYG-price state ran −0.4%
against +0.6%, nine cases. Today the state is NOT live: HYG sits at 0.13 of
its range but SPY at 0.72 (2.3% under its high). The spread-widening signal
already underwriting the open call is the stronger and the live one.

**What changed in MacroTilt.** Nothing in the book. The range divergence is
logged as weak-and-thin, not a second leg for the credit call; the call stays
on its own measure. The rates-vol-versus-equity-vol crack and the
momentum-crash count go to the queue below.

### Not yet tested — carried to the next read

- MOVE up 25+ points in 21 sessions while VIX ≤ 18: forward S&P return and
  5% drawdown odds (we carry both daily from 2006).
- Count of ±2% daily moves in the momentum factor over 63 sessions ≥ 8 with
  the S&P within 3% of its high (French momentum daily is on file).
- Tight range followed by a break to a new 3-month high, with a measured-move
  target (carried from Oct 13).
- Equal-weight S&P lagging as a warning (needs a longer equal-weight series).
- Corporate-bond-to-Treasury relative strength, spread-based (carried from Oct 2).

---

## 2026-10-13 — do financials breaking down under a record S&P call the top?

Eight new posts, Oct 3–12; four read (listed in `processed_posts.json`). One
was cut off before its trade section; public part only. The other four
(Oct 3, 5, 10, 11) are left out of that file so the next read picks them up.

**What their work does that ours does not.** It reads the market's internals
as a late-cycle clock: financials falling hard while the index holds its high,
the equal-weight index lagging, credit spreads as the first thing to break.
It also treats a calm, upward-sloping volatility curve as licence to add risk.
Ours tests one signal against one baseline and has never asked whether a
break in financials says anything about the index.

**The question that puts to us.** We withdrew a long-banks note on Oct 7 and
closed a banks call at -12%. If weak financials under a record S&P is a top
signal, the lesson of those two calls is not "banks are hard", it is "the
index is the short". Is it?

**The test.** `financials_break_test.py`, output `results_2026-10-13.txt`.
XLF (1998–2026) and KBE (2005–2026) down 5%, 8% or 10% over 63 sessions while
SPY sits within 3% or 5% of its one-year high. SPY over the next 63 and 126
sessions, independent episodes, against every day in the same sample.

**The result.** Nothing, at every threshold.

| state | S&P next 126 sessions | baseline | episodes |
|---|---|---|---|
| KBE down 8%+, SPY within 5% of high | +5.9%, 79% up | +5.1%, 74% up | 14 |
| KBE down 10%+, SPY within 5% of high | +3.4%, 82% up | +5.1%, 74% up | 11 |
| XLF down 5%+, SPY within 5% of high | +3.4%, 77% up | +3.8%, 70% up | 13 |
| XLF down 8%+, SPY within 5% of high | +1.3%, 71% up | +3.8%, 70% up | 7 |

No t-statistic reaches 1.3 in either direction. The 2007 episode is in the
sample and lost 10–11%; it is one of 14. Today KBE is down 7.8% over 63
sessions and XLF 2.0%, with SPY 0.1% under its high — the state is close to
live on banks and not live on the broad sector.

On their volatility-curve read: already tested here on 2026-08-17. A steep
curve preceded lower S&P returns than average, not higher (+4.36% vs +6.63%
at six months, 37 episodes). Our data argues against adding index risk on
that signal. No new test needed.

**What changed in MacroTilt.** Nothing, and that is the finding: a break in
financials under a record index is not evidence for an index short or a
hedge note. It joins the list of tested-and-empty index signals. The Oct 7
lesson stands as written (LESSONS 6.23) — the bank calls failed on regime,
not because banks were warning about the S&P.

### Not yet tested — carried to the next read

- Tight range followed by a break to a new 3-month high, with a measured-move
  target and a rule for the first retest. A cruder version ran today in the
  Trade Idea sweep: copper at a new 3-year closing high made +2.8% vs +3.2%
  over 63 sessions (19 episodes) — no edge. The range-compression part is
  still untested.
- Equal-weight S&P lagging the cap-weight index as a warning. We hold RSP
  only from 2020; needs a longer equal-weight series.
- Credit spreads widening as the first break: HY OAS up X bp in a month with
  the S&P near its high. We carry the spread series; not done today.
- Corporate-bond-to-Treasury relative strength, spread-based (carried from
  Oct 2).

---

## 2026-10-03 — kill-tests from the daily session's second sweep

Not an outside-research read: the 10-02 method applied to the three loudest
things on our own board, on Joe's instruction to dig deeper. Full numbers,
episode tables and data in `results_2026-10-03.md` / `cot_extra_2026-10-03.json`
/ `sterling_tbond_tests.py`. The short version:

- **Sterling spec-short fade: empty** (12 episodes since 2004, mean -0.02% vs
  -0.22% unconditional). With the euro, the FX fade class is now dead in both
  markets we quote.
- **The Treasury bond "most opposed ever" standoff is a window artifact** of
  the TFF feed's 2010-06 ranking start (bug #1263) — full-record percentiles
  are mid-range — and the honest test finds no edge (7 episodes, +0bp vs +1bp).
- **Weak payrolls do not predict yields** (26 episodes since 2006, flat vs
  baseline).
- **Banks/S&P at the 1st percentile of 20y is the one real edge found**
  (+3.0% vs -1.3% over 126 sessions, 20 episodes, only at <=2nd pctile) — too
  small for the 15% bar unlevered; a watch item, not a note.

## 2026-10-02 — first read (six posts, Sep 19–28)

### What their work does that ours does not

They trade WITH price. Every position in their book is a market already
moving their way — a breakout from a tight range, bought, and held while the
trend lasts. Ours leans the other way: most of our published calls bet on
something stretched coming back (positioning, a ratio, a rate). Our three
losing calls are long the 10-year (stopped, -2.9%), banks against the Nasdaq
(closed, -12.2%) and long the euro (open, -2.5%). Two of the three were
entered against the 200-day trend: the 10-year yield was above its average and
rising, the euro below its average and falling.

Scoring their calls against ours would have missed that. The useful question
is about method.

### Question 1 — Is trend-following itself an edge on our series?

Test: `trend_following_check.py`. Sign of the 12-month return (skipping the
last month), next 63 sessions, 16 series, 2000–2026.

Result: **no, not as a blanket rule.** Pooled +0.13% a quarter, 52% winners,
n=4,423. It pays in equity indices and gold, where it is mostly the same as
being long; it loses in oil, natural gas, the euro, sterling and the dollar.

Change: none. We do not adopt "follow the trend" as a rule. Their returns come
from selection and exits inside trends, which a sign test does not capture.

### Question 2 — Do our positioning fades depend on the trend?

Test: `trend_vs_positioning.py` (output: `results_2026-10-02.txt`). Full CFTC
record. Percentiles on an expanding window — each week ranked only against the
history available that week. Independent episodes, 13 clear weeks apart. Next
63 sessions, split by price above or below its 200-day average. The code
reproduces the playbook's published wheat figure (-5.98%) exactly when run the
old way, so differences below are method, not arithmetic.

| market | fade signal | honest test | split by trend |
|---|---|---|---|
| **Wheat** | funds ≥ 85th → short | **11 episodes, +7.8% mean, +11.4% median, 73% won** (holding short otherwise: -1.3%) | every episode came with price above its 200-day average. The fade works against the trend. |
| **Corn** | funds ≥ 85th → short | 6 episodes, -1.9% mean, 50% won | **against an uptrend: 5 episodes, -10.1% mean, worst -31%** |
| **Soybeans** | funds ≥ 85th → short | 12 episodes, +1.8% mean, 67% won, worst -32% | no clean split; one-in-three ends badly |
| **Euro** | speculators ≤ 15th → long | **9 episodes, -1.2% mean, 33% won** | loses on both sides of the trend |

Three results, each of which changes something.

**(a) The euro edge was never there.** The Aug 14 note quoted +3.18% in three
months, 77% positive — measured on 26 weekly reports inside one 156-week
window. On the record since 2004 the same signal is followed by a median
-1.62% (43% positive) against +0.09% for any week; since 2010, +0.03%. With
honest percentiles and independent episodes: nine, and two-thirds lost. A
stretched euro short has more often been speculators being right. The
playbook's own warning — "if a result only appears in a short window, the
window is the finding" — was written the same week and not applied to this
note. The "most one-sided trade in the market" sat at the 30th percentile of
its own full history on the day we published.

**(b) Wheat is the real edge, and it survives every way we cut it.** The
Sep 6 short stands on evidence. It also answers their grain view directly:
buying a wheat breakout once funds are already long has been the losing side.

**(c) Corn and soybeans are not wheat.** In the first pass of this log we set
"speculators at the 98th percentile" against their long-grains view as if it
were a counter-argument. For corn it is not: fading corn length while price is
above its 200-day average lost 10% on average. Corn sits at the 93rd
percentile of its full history today, above its 200-day average. Our data does
not contradict their corn and soybean longs. The Trade Idea editor was right
to kill both fades on Oct 1, and the brief should stop implying a fade when it
quotes those percentiles.

### Question 3 — Which percentile are we quoting?

The site and the brief quote 3-year percentiles. Every tested edge was measured
on the full record. They disagree, materially, today:

| market | 3-year percentile | full-history percentile |
|---|---|---|
| Wheat, funds | 92nd | 57th |
| Euro, speculators | 13th | 31st |
| Corn, funds | 98th | 93rd |
| Soybeans, funds | 99th | 93rd |

A 3-year percentile describes the recent range. It is not the signal that was
tested, and reading it as one is how the euro note happened.

### What changed in MacroTilt

1. **Trade Idea contract** (`scripts/build_trade_idea.py`, notes from
   2026-10-03): a positioning edge must state independent episodes (at least
   10), at least 10 years of record, percentiles ranked on an expanding window,
   and the result split by trend. The Aug 14 euro note would have been refused
   on three of the four.
2. **Trade Idea playbook**: the cross-asset map is corrected — euro moved to
   "tested and found empty", corn and soybeans downgraded, wheat confirmed —
   and outside research gets a standing role as a challenge, not a source of
   calls.
3. **Brief playbook**: a 3-year positioning percentile is a description. The
   brief implies a fade only in a market where the fade has passed the honest
   test (today: wheat).
4. **Open euro call**: its evidence does not hold. Monday's thesis review
   re-measures it against this file; on these numbers the verdict is broken.
5. **Brief contract**: another research shop is never named or cited in the
   brief (`enforce_no_outside_research`).
6. **LESSONS 6.21 and 10.12.**

### Not yet tested — carried to the next read

- Their entry discipline: a tight range followed by a break to a new 3-month
  high. Testable on our 16 price series; not done today.
- Corporate-bond-to-Treasury relative strength as a confirmation of equity
  breakouts. We carry the series; the playbook already warns that an ETF price
  ratio drifts mechanically. Needs a spread-based version.
- Insider buying in a cyclical with a rising commodity backdrop (their
  dry-bulk shipping idea). Our filings show buying and selling roughly offset
  in that name since April, and we hold only 20 months of its prices.
