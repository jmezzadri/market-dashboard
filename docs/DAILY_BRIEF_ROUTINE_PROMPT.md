# Daily Market Brief — the email's generator, and the 2026-07-29 anti-repetition fix

## What actually generates Joe's morning email

- A Claude routine, **"Daily Market Brief"** (`trig_012HedTsd6tXbC7xcJBKyCgf`),
  runs 05:45 ET weekdays and writes the brief via the Gmail connector.
- The Apps Script **"Market Brief Auto-Send"** delivers it as branded HTML at
  ~06:45 ET on NYSE trading days, to gmail + EY.
- This is **NOT** `scripts/build_daily_brief.py`. That repo generator is
  email-off (LESSONS 4.14) and only writes `public/daily_brief.json` for the
  homepage. Two generators, two different texts — on 2026-07-29 the email named
  TSM + JEF while the homepage brief named TSM + FSBC.

The routine's prompt cannot be updated through the trigger API by an agent (it
was created via the UI — the API returns "agents can only update routines they
created"). The only write path is the browser: Claude app → Code → Routines →
Daily Market Brief → pencil icon → Instructions → Save.

## Why it changed (2026-07-29)

Joe: "the daily brief feels like the same email every day — we've called out TSM
as an equity with insider buys for a week straight."

Measured across the 13 briefs 7/17–7/29:

| Symptom | Measurement |
|---|---|
| Same single name repeated | TSM featured 9 of 13 briefs, JEF 7 of 13 |
| Source list frozen | TSM on the screener 34 consecutive sessions; GGAL 12; JEF 8 |
| Scores too coarse to rotate | integer 3.0 / 5.0 → ties never break → identical order daily |
| Positioning narrated as fresh | yen pinned at its 3-year extreme 63 straight sessions; copper 90; 3M SOFR 14 weeks |
| No memory | nothing in the chain knew what yesterday's brief said |
| Wasted fresh material | 14–24 tickers file fresh insider buys every day; the brief used none of them |

## The fix, two halves

**1. Feed (`supabase/functions/brief-positioning/index.ts`, deployed 2026-07-29)**

- `setups[]` gains `days_on_list`, `first_seen`, `latest_insider_buy_filing`,
  `insider_filing_age_days`, `is_new_today`, `eligible_to_feature`, `novelty`.
- New `featurable[]` (new to the list within 3 sessions, or a fresh filing within
  3 days) and `already_covered[]` (everything else — never name these).
- COT extremes gain `weeks_at_extreme`, `pctile_change_wow`, `is_new_this_week`,
  recomputed from each market's own `history[]`.
- `crowding[]` gains `trading_days_at_extreme`, `pctile_change_5d`,
  `is_new_extreme`. **This block was dead**: it read `v.pctile_3yr` but the
  percentile lives under `v.stats`, so it returned `[]` on every call since it
  was written. Fixed — it now returns 5 live entries.
- New `fresh_insider_buys[]` — the last 3 filing days across the whole universe.
- `setups` is now pinned to the latest `scan_date` (it previously mixed in
  yesterday's rows, producing duplicate tickers and a `days_on_list` of 0).
- `lean` no longer emits the banned words "washed out" / "crowded".

**2. Routine prompt (live in the routine as of 2026-07-29)**

Everything from the locked 2026-06-17 format was preserved — six exact numbered
headers, the plain-English glossary, the three callout types, the
futures-vs-close labelling, the under-500-words constraint. Added:

```
YOUR ONE JOB BEYOND ACCURACY: DO NOT REPEAT YESTERDAY. This brief goes to the
same readers every weekday morning. Anything that has not changed since
yesterday is not news to them.

- YESTERDAY'S BRIEF: fetch https://macrotilt.com/daily_brief.json. At your run
  time this file still holds the PRIOR session's brief. Treat its headline,
  news[], watch[], implications[] and every sections[].single_name.ticker as
  ALREADY SAID.

NOVELTY RULES (hard):
- SINGLE NAME: name a ticker ONLY from featurable[]. NEVER name anything in
  already_covered[]. NEVER re-use a ticker from yesterday's brief. If nothing
  qualifies, run NO single-name line — an absent line is correct, not a gap.
- POSITIONING: lead on an extreme only where is_new_this_week is true or
  pctile_change_wow is at least 10 points. An extreme older than 2 weeks (or a
  crowding entry older than 5 sessions) is standing background: at most one
  clause, and say how long it has been that way. NEVER a "What to Watch" item.
- WHAT TO WATCH TODAY: every item must happen or resolve today or tomorrow.
  Standing conditions are banned in this section.
- FRESH MATERIAL FIRST: prefer fresh_insider_buys[] over restating the screener.
  Cite the filing date; never imply ongoing buying from an old filing.
- Open section 1 with the single most important thing that CHANGED since
  yesterday's brief.

BANNED WORDS — never write "washed out" or "crowded" anywhere, in any form.
```

The banned-word line is new to this prompt: the 2026-07-29 email shipped
"crowded equity longs". The repo generator scrubs that deterministically; this
one had no guard.

## Open item

The EDGAR insider ingest last ran 2026-07-28 12:02 UTC and its newest filing
date is 2026-07-27 — check `INSIDER_INGEST_NIGHTLY` / the EDGAR shadow ingest is
still firing, since `fresh_insider_buys[]` is only as fresh as that table.
