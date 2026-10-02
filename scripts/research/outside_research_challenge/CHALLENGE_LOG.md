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
