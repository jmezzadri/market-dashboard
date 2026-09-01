# Morning Brief — scheduled-session playbook

**Who runs this:** the weekday "MacroTilt Morning Brief" scheduled Cowork task
(fires ~06:00 ET). The model runs on Joe's Claude subscription — the metered
Anthropic API is NOT used anywhere in this flow (Joe directive 2026-08-06:
no API spend on top of the subscription).

**Division of labor:** the session composes the brief. Everything after that is
the existing hardened pipeline: `scripts/build_daily_brief.py --prepare-file`
validates/normalizes, the `agent-write` edge function commits it to `main`
(Vercel deploys it), and the DAILY-BRIEF-WRITER GitHub workflow emails the
committed brief (trading-day + morning-window gated, atomic send-once claim).
**The session never sends email and never pushes with its own git credentials.**

**DEADLINE — read this, not the firing message (2026-08-25).** The brief must be
committed by **09:00 ET on the day you are running**, computed from the clock.
The scheduled task's stored prompt carries a hard-coded date next to the word
DEADLINE; that date is decoration and has been stale for weeks. It is not the
deadline and must never be reported as one. The only authority is
`BRIEF_EXPECTED_BY_HOUR_ET` in `scripts/build_daily_brief.py` (09), applied to
today. If the firing message and this file disagree about the deadline, this
file wins. Never print that stale date back to Joe — he has asked three times
for it to stop appearing.

**Canonical contract:** the accuracy contract below mirrors the `PROMPT` block
in `scripts/build_daily_brief.py`. If they ever diverge, the script is
canonical — update this file in the same commit that changes the script.

---

## VOICE — how this site writes (Joe, 2026-09-01)

Joe, on a published brief: *"I have worked in finance and markets for 25 years,
and I've never heard anyone talk like this. Don't use more words than you need
to. I much more prefer bullets than long sentences."*

The sentence that triggered it:

> **WRONG** — 52 words, and nobody on a desk speaks like this:
> "The tell was not the yield, it was what the market paid for optionality
> around a meeting fifteen days out while the front end sat perfectly still.
> Equities deferred their reaction by a session and are taking it before the
> open, into the first data the new stance has to survive."

> **RIGHT** — 27 words, three bullets, same content:
> - Vol bid into the Sep 17 FOMC. Front end unchanged.
> - Equities sat still yesterday. Moving pre-market.
> - First test today: ISM, 10:00.

### The rules

1. **Bullets by default.** Prose only where a bullet genuinely cannot carry it
   — the stance line, and nothing else. If you wrote a paragraph, try it as
   bullets first and keep the bullets.
2. **One idea per bullet. 20 words maximum.** Two ideas is two bullets.
3. **A concrete thing does the verb.** A market, an instrument, a number, a
   person. Never an abstraction. "Vol bid into the FOMC", never "what the
   market paid for optionality". "Equities sat still", never "equities
   deferred their reaction by a session".
4. **Say the thing, not the shape of the thing.** Name the instrument, the
   level, the date. If you find yourself describing the *significance* of a
   move before naming the move, you have it backwards.
5. **Cut every word that survives its own deletion.** Read the bullet without
   it; if nothing is lost, it stays deleted.
6. **No reveal structure.** The "it was not X, it was Y" inversion, "the tell
   was", "the real story is", "what actually happened is" — these are column
   openers. Lead with the fact.

### Banned constructions — the prepare step REJECTS these

| Banned | Write instead |
|---|---|
| "the tell", "the real tell", "is the tell" | name the thing directly |
| "it was not X, it was Y" | "Y." |
| "optionality" | "vol", "calls", "puts", "premium" |
| "the tape", "the podium", "the setup", "the print" as a sentence's subject | the actual instrument or event |
| "deferred its reaction", "took its medicine", markets with feelings | what the price did |
| "into the first data the new stance has to survive" | "First test: <release>, <time>." |
| "against the backdrop of", "it is worth noting", "that said" | delete |
| any sentence over 25 words | split it or cut it |


### Every claim carries its time

Joe, on a rewrite I offered him — *"vol bid into the sep17 FOMC.... This sounds
past tense but its only Sept 1...."* Two failures in five words.

- **A move that already happened names its session.** "Rate vol repriced
  Monday", not "vol bid".
- **A scheduled event names its date and reads as ahead.** "FOMC, Sep 16."
- **Never a verb that could be either.** If the reader has to work out whether
  it already happened, rewrite it.

**And never write an event date from memory.** The date in that example was
wrong — the calendar feed says the FOMC is **Sep 16**, not Sep 17. FOMC, CPI,
PPI, payrolls, ISM, PCE, GDP, claims, JOLTS and retail sales dates are read off
`https://macrotilt.com/econ_calendar.json`, the same feed the homepage tile
uses. The prepare step now checks every dated event mention against it and
refuses a mismatch. A wrong tense is awkward; a wrong FOMC date is a reader
missing a meeting.

**The corrected example:**

> - Rate vol repriced Monday. Front end unchanged.
> - The bid is for FOMC, Sep 16.
> - Equities flat Monday, lower pre-market.
> - First test today: ISM, 10:00.

### The test

Read it aloud as if you were saying it to a PM standing at your desk who has
about eight seconds. If you would not say it that way out loud, it does not
ship.

## Steps

**0. Gate.** Weekday + NYSE trading day only. If today is a holiday or the
prepare step exits with "not a trading day", stop quietly — the site correctly
carries the last trading day's brief. Do not force anything.

**1. Fetch the data (all public, no secrets):**
- `https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-latest` — prior-close indicator values (`indicators[name] = {value, as_of, unit, state, pctile_3yr}`). Source of truth for VIX, spreads, yields, FX, commodities, indices, CAPE, MOVE. **Every value here is a PRIOR CASH CLOSE.**
- `https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-positioning` — COT extremes, crowding, scored setups, `featurable[]`, `already_covered[]`, `fresh_insider_buys[]`, and a `novelty_rules` object. **Obey `novelty_rules` literally.**
- `https://macrotilt.com/daily_brief.json` — at run time this is the PRIOR session's brief. Its headline, news, watch, implications, and every single-name ticker are ALREADY SAID: advance those themes, never restate them.
- Web search, last 12 hours, for overnight news — only stories with a visible publication timestamp are usable for a level or an event claim.

**2. Compose ONE JSON object** with exactly the keys the site renders
(`date`, `recap_session`, `eyebrow`, `headline`, `stance`, `news[]` as
`{head, body}`, `implications[]`, `watch[]` as `{head, body}`, `sections[]` —
exactly three, titled "Macro & Rates", "Equity Markets", "Credit & Liquidity",
each `{title, bullets[], positioning, single_name}` — and `movers` (leave `[]`).
`date`, `recap_session`, `movers`, `metrics` and `ideas` are all written by the
prepare step — don't sweat them, and do NOT emit `metrics` or `ideas` yourself.

---

### THE ONE RULE (Joe, 2026-08-19)

**The levels and the changes are already done.** The prepare step attaches a
market-snapshot table built from the feed — 2y, 10y, **20y, 30y**, 2s10s, 10y
real, 10y breakeven, term premium, MOVE, S&P, Nasdaq, Dow, VIX, VIX term
structure, SKEW, CAPE, IG OAS, HY-IG, HYG/LQD, SOFR-OIS, CP spread, RRP, TGA,
WTI, Brent, gold, copper, DXY, USD/JPY, EUR/USD — with each level, its
one-session change and its as-of date. (The 30y and 20y got a feed on
2026-08-21; before that you had to source them by hand every morning. Stop
doing that — they are in the table.) **Never restate a row of that table in prose.** Your whole job is
the sentence *after* the numbers. If a move has no so-what, the table already
said it and you say nothing.

> **WRONG** (62 words, every number already in the table):
> "The most important change since yesterday morning is that the long end
> stopped rising. The 30-year Treasury yield closed Tuesday at 5.28% against
> 5.31% Monday, the 20-year at 5.28% from 5.30%, the 10-year at 4.71% from
> 4.72%, and the 2-year was unchanged at 4.19%. The gap between the 10-year and
> the 2-year narrowed to 52 basis points from 53. The bond market's gauge of
> expected price swings eased to 75 from 75.6."
>
> **RIGHT** (the table carries the levels, so you carry the meaning, 26 words):
> "First down day in a week at the long end, and it gets tested at 1pm: $16bn
> 20y auction into that same level. Dealer takedown, not the yield, is the tell
> — the 30y left 11.5% last week."

### WRITE FOR THE DESK (this REVERSES the old plain-English rule)

The readers are Joe and active managers. They know the terms. Use the market's
own name and stop: **MOVE**, not "the bond market's gauge of expected price
swings". **2s10s 52bp**, not "the gap between the 10-year and the 2-year".
**HY OAS**, **dealer takedown**, **days to cover**, **COT 91st %ile**. No
appositive translations, no glosses, no "which is the price of insurance
against...". Every explanatory clause you delete is one Joe does not have to
read. (The pre-2026-08-19 rule said the opposite — it is dead.)

### DATA LINES, THEN THE SO-WHAT

For any figure NOT in the snapshot (futures, a single stock, an overnight
level, a release): write the data line, not a sentence —
`Brent $91.54, +0.6% (~6am ET)` — then one sentence of what it means, only if
there is one. An observation is not a brief.

### HARD CAPS — the prepare step REFUSES a brief that breaks any of them

| field | limit |
|---|---|
| headline | 140 chars |
| stance | 320 chars (2 sentences) |
| section bullets | max 3, each 175 chars |
| positioning | 200 chars · single-name note 180 chars |
| news | max 4 · head 60 · body 155 |
| implications | max 2, each 190 chars |
| watch | max 4 · head 55 · body 155 |
| **whole brief** | **700 words** (aim for 550) |

**Say it once.** The prepare step also rejects the same eight-word run appearing
in two different blocks. The 8/19 brief told the $3tn AI story four times —
stance, an Equity Markets bullet, a news item and an implication. Six blocks are
six angles on the day, not six chances to repeat one sentence.

**HARD ACCURACY CONTRACT (overrides everything else):**
1. **Sourced numbers only.** Every figure comes from the feeds above or a page fetched THIS RUN with a visible timestamp. Never from memory or an undated snippet. An omitted figure is correct; a wrong one is a failure.
2. **No direction word without two sourced points.** "Eased back", "stabilized", "rebounded", "off its highs", "steady" are path claims — write one only holding two timestamped levels where the later one supports it.
3. **Never call a level a high/record** unless a fetched source says so and no later sourced level exceeds it.
4. **Earnings are events with dates.** Confirm the report date this run. If the report is today or later, the ONLY phrasing is "reports after today's close". Never state results that have not been published.
5. **Single-stock extended-hours moves:** percent, from a story published in the last 6 hours, or not at all. Never a dollar level inferred from close + move.
6. **Self-check before returning:** name to yourself which fetch produced every number and direction word; delete anything that fails; check the brief does not contradict itself; then check every cap above.
- **Pre-market labeling:** every equity/yield/FX/commodity figure is labeled "Wednesday's close" / "overnight (~6am ET)" / "pre-market" — never a bare "up X% today" before the open.
- **Reader-facing labels only:** never print an internal field name, the word DATA, a vendor/publication/feed name, or narration of your own research state.
- **Banned words:** "washed out", "crowded" (write "extended short" / "extended long"). The prepare step also scrubs these deterministically.
- **Novelty:** open "Macro & Rates" with the single most important thing that CHANGED since the prior brief. Single names only from `featurable[]`, never from `already_covered[]` or yesterday's brief; if nothing qualifies, run without one — absence is correct.

**3. Validate through the versioned contract.** Write the JSON to
`/tmp/brief.json`, then:

```
git clone --depth 1 https://github.com/jmezzadri/market-dashboard.git /tmp/md
python3 /tmp/md/scripts/build_daily_brief.py --prepare-file /tmp/brief.json
```

Must print `prepared OK`. If it errors, fix the JSON and rerun — never submit
a brief that failed the prepare step. The prepare step forces the correct
`date`/`recap_session`, scrubs banned copy, attaches real movers, builds the
market-snapshot table from `indicator_history.json`, and attaches the live marks
on MacroTilt's own open calls from `trade_idea_scores.json`.

If it fails on length or duplication it prints **every** overage at once — fix
them all in one rewrite. Cut whole items before shaving words: three sharp
bullets beat five hedged ones. If three rewrites still fail, drop the weakest
news item and the weakest bullet in each section and rerun; a shorter brief is
always acceptable, a late one is not.

**4. Submit.** POST the prepared file to the `agent-write` edge function
(bearer token is provided in the scheduled task's instructions — it is NOT in
this repo):

```
BODY=$(python3 - <<'EOF'
import base64, json
content = open('/tmp/brief.json','rb').read()
print(json.dumps({
  "branch": "brief/DATE",                     # brief/2026-08-07
  "commit_message": "Daily brief — DATE (subscription session)",
  "pr_title": "Daily brief — DATE",
  "pr_body": "Generated by the morning scheduled session per scripts/brief_agent_playbook.md; validated by --prepare-file.",
  "files": [{"path": "public/daily_brief.json", "content_b64": base64.b64encode(content).decode()}],
  "merge": True
}))
EOF
)
curl -s -X POST "https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/agent-write" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY"
```

**TEST MODE:** if the firing message says TEST MODE, submit with
`"merge": false`, report the PR number and diff summary, and stop — no merge,
and note that no email can result.

**5. Verify live — the JSON AND the rendered page.** First poll
`https://macrotilt.com/daily_brief.json?cb=<random>` until `date` equals today
(Vercel deploys the merge; allow up to ~6 minutes). The email is sent by the
GitHub workflow from the committed file on its existing schedule — nothing for
the session to send.

Then actually LOOK at `https://macrotilt.com/`. Markup containing a string is
not verification (Joe, 2026-04-28: "verified means I looked"). Read the date
line, the headline, the market-snapshot table, the "All feeds current" chip and
the surrounding tiles, and check for stale copy, placeholder text, hard-coded
years, and numbers in prose that contradict the chart beside them.

*How to render it in this sandbox (verified 2026-08-25).* The page is
client-rendered, so a plain HTTP fetch returns an empty shell — a browser is
required. Chromium is preinstalled at `/opt/pw-browsers/chromium` and Playwright
is configured for it; never run `playwright install`. The sandbox exports an
HTTP proxy in `$HTTPS_PROXY` which `curl` uses happily, but Chromium's CONNECT
through that proxy is reset (`net::ERR_CONNECTION_RESET`) — this is what made an
earlier session wrongly report that browser egress was blocked. Chromium's
direct egress works, so launch with the proxy off:

```js
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--no-proxy-server'],
});
```

Then `goto` with `waitUntil: 'networkidle'`, wait ~5s for the client-side data
fetch, screenshot, and READ the screenshot with the Read tool — `innerText`
alone will not show you a layout or clipping problem. If the render genuinely
fails, say so plainly, state what was verified from the JSON instead, and never
describe the page as visually verified.

**6. Report** in the numbered-table format, short. Joe is a management
consultant, not an engineer: nothing he reads may contain a file path, a shell
command, a command-line flag, a code snippet, a tool name or an internal field
name. Describe what happened, not how. Ping Joe only if something is broken and
genuinely needs a decision from him.

**Failure mode:** if any step fails, leave everything alone and say so in the
report. The site keeps the last good brief, and the GitHub-side freshness
alerts (WORKFLOW_FAILURE_ALERT + brief-ensure) cover staleness independently.
