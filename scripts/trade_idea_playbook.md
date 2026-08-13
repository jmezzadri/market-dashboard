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
commodity / equity), `title`, `dek`, `position_type`, `plain_english`,
`the_trade{buy, sell?, short?, sizing?}`, `instrument`, `horizon`, `thesis[]`
(three or more), `evidence[]` (each `{claim, value, source, as_of}`),
`charts[]` (2–5), `levels{trigger, invalidation, target}`, `sections[]` (each
`{title, prose}` or `{title, bullets[]}`), `other_side`, `risks[]`, `so_what`.

### Say what the trade IS before you say anything else

Joe on the first published note: *"Are we saying to buy treasuries and short
stocks? Im confused what the trade is..."* That note led with "Long the 10-year
Treasury, funded by trimming US large-cap equity beta" — which a professional
reads as an allocation shift and everyone else reads as a short. **A note whose
central claim has to be decoded has failed, however good its evidence is.**

- `position_type` — one of `allocation shift`, `outright long`, `outright short`,
  `long/short spread`, `hedge`, `watch only`. It renders as a badge, so the
  reader knows whether anything is being sold short before meeting a number.
  `outright short` and `long/short spread` REQUIRE `the_trade.short`.
- `plain_english` — one sentence, 40–260 characters, for a reader who is not a
  trader. The contract rejects it if it contains any of: beta, duration,
  convexity, carry, basis point(s), bp/bps, curve, spread, percentile,
  steepener, flattener, notional, overweight, underweight, risk premium, term
  premium, vol. Put the technical version in `instrument` and the thesis —
  those are allowed to be technical, and should be.
- `the_trade` — `buy` is required; add `sell` (what is sold to fund it),
  `short` (only for an actual short) and `sizing`.

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
