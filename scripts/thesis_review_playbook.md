# Weekly Thesis Review — scheduled-session playbook

**What this is.** Joe, 2026-09-30: *"Do we have a process where we analyze
intramonth and not wait until the target date to ensure the thesis is still
intact?"* — and then: *"run it weekly and I'd like an email of the analysis and
some range or probability analysis for how the trade is doing vs. expected
return and how the future expected return has changed, i.e. are we still
expecting this trade to pan out or do we have a different view."*

The daily scorer (`scripts/score_trade_ideas.py`) asks one question every
evening: did price cross the stop. This session asks the other one, every
Monday before the open: **is the reason for each open call still there** — and
says so with dated evidence, a verdict, and a number for where we now expect
the call to finish. `scripts/thesis_review.py` validates the verdicts, computes
the arithmetic from the record, and writes `public/thesis_reviews.json`. The
GitHub workflow `THESIS-REVIEW-WEEKLY.yml` emails Joe from that committed file.
**This session never sends email.** If this file and that script disagree, the
script wins — fix this file.

## What the session must NOT do

- Never edit `public/trade_ideas.json`, a note, or a scorecard block. The
  review is a separate record about the notes; the notes do not change.
- Never change a call's `called_for_pct` after its first review. The script
  rejects it. The return a note called for is the same kind of fact as its
  entry price.
- Never grade a call from the price alone. Down 10% with the driver intact is
  "weakened" at most; up 5% with the driver gone is "broken". Price is what
  the scorer already measures; the verdict is about the reason.
- Never write "intact" while a re-measured claim has failed. The script
  rejects it, and the reason it exists is that this is the tempting lie.
- Plain English in every field Joe reads (`view_now`, `action_reason`,
  `weakened_reason`, `book_now`, every `claim`): no series keys, no field
  names, no statistics jargon; say "88th percentile of the last three years",
  not "pctile_3yr".

## Steps

**0. Gate.** Run every Monday. If the US market is closed Monday (NYSE
holiday), still run — the marks are Friday's and the review is about the
drivers, not the tape. If there are no open calls, do nothing and say so in
one line (the script requires at least one review, and there is nothing to
review).

**1. Fetch the record.** All public, no secrets:

```
git clone --depth 1 https://github.com/jmezzadri/market-dashboard.git /tmp/md
cd /tmp/md
curl -s https://macrotilt.com/trade_ideas.json        -o public/trade_ideas.json
curl -s https://macrotilt.com/trade_idea_scores.json  -o public/trade_idea_scores.json
curl -s https://macrotilt.com/thesis_reviews.json     -o public/thesis_reviews.json   # 404 on the first week is fine
curl -s https://macrotilt.com/indicator_history.json  -o public/indicator_history.json
curl -s https://macrotilt.com/cot_positioning.json    -o /tmp/cot.json
```

The review needs closing prices for any `ticker:` leg, which the scorer reads
from the `prices_eod` table over the Supabase REST API. The site's own
publishable (anon) key can read that table. Export it before running the
script, under the two names the scorer reads:

```
export SUPABASE_URL=https://yqaqqzseepebrocgibcw.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<the publishable anon key from the scheduled task's instructions>
```

**2. Print the arithmetic first.** `python3 scripts/thesis_review.py --quant`
prints, for every OPEN call: return so far, sessions left, the position's own
volatility now vs at entry, the 10/50/90 finish range, chance of finishing
positive, and the stop's distance and base-rate chance. Read it before forming
a view — it is the part of the review that has no opinion in it.

**3. Re-measure every open call's driver.** For each open call, open the note
(`trade_ideas.json` → that id). Its `edge` names the driver and the base
rate; its `thesis[]` and `levels` state the claims. Notes dated 2026-10-01 or
later also carry `review_conditions[]` — measurable claims written at
publication, each with `measure`, `at_publication`, `holds_while` and
`critical`. **Those are the checks; re-measure exactly them.** For older notes,
take the claims from `thesis[]` and `edge.summary` and write each as a check
in the same shape.

For each claim, get the reading NOW from the same source the note used
(positioning: `/tmp/cot.json`; indicators: `indicator_history.json`; single
names: filings or the news, with the date). Then decide `holds`:

- `holds: true` — the condition the note relied on is still in place.
- `holds: false` — it is not. Be literal: "speculators at the 90th percentile"
  is not holding at the 55th.
- `critical: true` on the claim(s) the call cannot survive losing — the
  driver itself, not the colour. At least one check per call is critical.

Where the note's driver is an event or a policy actor (an intervention
campaign, a payrolls print), the check is whether the event has happened /
been contradicted, with the dated source.

**4. Verdict, view, expected finish, action.** Per call:

- `verdict`: `intact` (every check holds), `weakened` (something has moved
  against it — a non-critical check failed, or all hold but price or a new
  fact argues against; say what in `weakened_reason`), `broken` (a critical
  check failed).
- `called_for_pct` + `called_for_basis`: the return the note called for over
  its horizon, as ONE number, in the position's own return terms (the same
  units as the Scorecard row). Take it from the note's base rate — the
  conditional median at the note's horizon (e.g. "+3.18% at three months") —
  or from `levels.target` converted to a return from entry. For a bond leg,
  convert the yield move with the entry duration (the scorer's rule). Write
  it once; every later week must repeat the same number.
- `expected_return_now_pct` + `expected_basis`: where WE now expect the call
  to finish, as one number, and how it was arrived at — usually the same base
  rate re-read from the current driver reading (if positioning has fallen
  from the 90th to the 70th percentile, the conditional median from the 70th
  is the number), plus what has already been earned. This is the "has our
  expected return changed" figure Joe asked for; the script prints it beside
  what the note called for and beside the no-view range.
- `view_now`: two to four plain sentences — what the driver is doing, what
  price has done relative to it, whether we still expect the call to pan out
  and why.
- `action` + `action_reason`: `hold` (leave it), `trim` (reduce; say why and
  by how much in words), `close` (only with `broken`; the scorer closes the
  call at Friday's close). A broken thesis is closed even if the call is in
  profit; an intact thesis is held even if it is under water. That asymmetry
  is the point of the review.

**5. The book.** `book_now`: one paragraph — what the whole book is
positioned for after these verdicts, what carries the most and least
conviction, what a reader holding the calls does today. This renders on the
Scorecard as "The book right now" when it is newer than the newest note.

**6. Compose the submission** as one JSON object:

```json
{
  "review_date": "YYYY-MM-DD",
  "book_now": "…",
  "reviews": [
    {
      "id": "<note id>",
      "verdict": "intact | weakened | broken",
      "driver_checks": [
        {"claim": "…", "at_publication": "…", "now": "…", "source": "…", "as_of": "YYYY-MM-DD",
         "holds": true, "critical": true}
      ],
      "weakened_reason": "… (only when verdict is weakened and every check holds)",
      "view_now": "…",
      "called_for_pct": 3.18, "called_for_basis": "…",
      "expected_return_now_pct": 2.4, "expected_basis": "…",
      "action": "hold | trim | close", "action_reason": "…"
    }
  ]
}
```

**7. Validate and write.**

```
python3 scripts/thesis_review.py --prepare-file /tmp/review.json --out public/thesis_reviews.json
```

Must print `prepared OK`. If it prints `REJECTED`, fix the submission — never
loosen the check, never skip a call. It writes the new `latest` and moves the
previous week's verdicts into `history`.

**8. Submit** `public/thesis_reviews.json` to `ops-code-commit` (read the
bearer token from `ops_secrets` where name = `gh_push_token`; never echo it),
branch `review/<date>`, `merge: true`. The push to `main` fires
`THESIS-REVIEW-WEEKLY.yml`, which emails Joe.

**9. Verify.** Wait ~2 minutes. Load `https://macrotilt.com/thesis_reviews.json`
and confirm `latest.review_date` is today. Load `https://macrotilt.com/scorecard`
(the UAT sign-in is in `ops_secrets`: `uat_account_email` /
`uat_account_password`) and confirm the "Last review" column shows today's
date on every open row. Then search Joe's Gmail for
`subject:"Thesis Review — <today>" newer_than:1d`; if it has not arrived after
two checks five minutes apart, say so plainly.

**10. Report** to Joe in three sentences at most: how many intact / weakened /
broken, which call (if any) was closed and why, and one line if anything
needs him. The email is the analysis; the reply is the receipt.

## The arithmetic, in plain English (for `view_now` and for Joe)

- **Return so far** is the Scorecard's mark: the position's price return from
  the entry close, both legs, no costs.
- **What the note called for** is the base-rate median at the note's horizon.
- **Where it can finish, no view** is a range built from the position's own
  recent volatility (last quarter of sessions), projected over the sessions
  left, with no drift: 10th / median / 90th. It is what you would expect if
  you knew nothing from here. It was tested on every live series over history
  (`scripts/research/thesis_review_calibration/`): the 10–90 band held 78–84%
  of the time, close to the 80% it claims.
- **Chance of finishing positive / of reaching the call** are read off that
  range.
- **Distance to the stop** is in the stop series' own units and in daily
  moves; the **chance the stop prints** is a base rate — how often, in that
  series' own history, a move of the current size in the stop's direction
  happened within the sessions left. (The textbook formula was tried and
  rejected: on a vol ratio, wheat and gas it was off by a factor of two.)
- **Our expected finish now** is the review's own number — the thesis
  re-priced from the driver's current reading. The gap between it and "what
  the note called for" is the answer to "has our expected return changed".

## Evidence challenges from outside research (2026-10-02)

Before the verdicts, read the newest entry in
`scripts/research/outside_research_challenge/CHALLENGE_LOG.md`. Where it finds
that an open call's EDGE does not hold on an honest re-test, that is a
re-measurement of the driver like any other: state it in the review, and if the
edge the note rested on is gone, the verdict is broken whatever the price has
done. First case: the Aug 14 long-euro call. Its edge (+3.18% in three months
after speculators reached the 15th percentile) existed only inside a 156-week
window; over the record since 2004 the same signal lost money (9 independent
episodes, 33% won).
