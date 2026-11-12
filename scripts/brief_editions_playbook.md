# Midday Update and Market Close — scheduled-session playbook

**Who runs this:** two weekday scheduled Cowork tasks on Joe's subscription —
"MacroTilt Midday Update" (~11:33 ET) and "MacroTilt Market Close" (~6:41 PM
ET). The metered Anthropic API is never called (Joe directive 2026-08-06).

**Why these exist (Joe, 2026-11-03):** *"Leaving the brief on the site even
after major events, like midterms, is bad."* And: *"I don't want half-ass
bullshit posted for the sake of posting."* So: the Morning Brief is unchanged;
the Market Close posts every trading day; the Midday Update posts ONLY when a
gate fires. The product spec is the "MacroTilt Brief Editions — Spec" doc.

**Everything in `scripts/brief_agent_playbook.md` binds here too** — VOICE,
the banned constructions, "every claim carries its time", WHERE THINGS LIVE,
the hard accuracy contract, the 20-word sentence cap, the data-line headline,
"never restate a row of the table", no outside research shop named, the
timestamped-news rule (MacroTilt's own free headline service, `news-wire`, last
12 hours for the morning; for these editions the window is **since the last
edition was written** — pass that edition's `written_at` as `since=`), and its
honest fallback: with no timed headlines the edition says so and quotes no
outside news. Bigdata.com is retired (free credit ran out 2026-11-12; never
call it). Read that file first. This file only says what is different.

**No email.** Neither edition sends or triggers an email (Joe, 2026-11-03:
no new emails until the editions are stable). The site is the only output.

**Never wait on a clock** (LESSONS 0.17). Read what is there, finish, stop.

---

## MIDDAY UPDATE (~11:33 ET)

**Job:** what the morning got right or wrong, and what it changes for the
afternoon. The reader has the Morning Brief already; nothing in it is restated.

**1. Clone and gate.**
```
git clone --depth 1 https://github.com/jmezzadri/market-dashboard.git /tmp/md
python3 /tmp/md/scripts/midday_gates.py --out /tmp/midday_gates.json [assertions]
```
Not a trading day → exit 2 → stop, one line.

The market gates (Equities, Rates, Oil and dollar) and the Scheduled-day gate
are computed from feeds. Three gates are **asserted by you**, each from a
source with a visible timestamp inside the last 3 hours, and only when they
qualify — an omitted assertion is a quiet gate, which is correct:
- `--release "<calendar name>=<actual>/<consensus>"` for a **tier-1** release
  that printed this morning (names as in `https://macrotilt.com/econ_calendar.json`,
  e.g. `"Job openings (JOLTS)=7.2/7.1"`, `"ISM Manufacturing=55.5/54.5"`).
  Units must match the series in `econ_release_history.json` (payrolls in K,
  CPI as the % change, ISM as the index).
- `--earnings "TICKER=<pre-market %>"` for a **top-50 US market-cap** name
  that reported before the open today.
- `--central-bank "<bank>: <decision>, consensus <expected>"` for an ECB, BoE
  or BoJ decision today that differed from consensus.
- `--source "<one line: where the asserted numbers came from, with times>"`.

Exit 3 = QUIET. Submit ONLY the gate log (step 4, file
`public/midday_gates.json`) and stop. The homepage prints "No midday update ·
nothing tripped at 11:30". Do not write an update. Do not look for a reason.

Exit 0 = FIRED. Continue.

**2. Fetch:** `https://macrotilt.com/daily_brief.json` (this morning's brief —
its `written_at` is the start of your news window), `brief-latest` (prior
closes), the gate log you just wrote (its values are your sourced intraday
levels, with times), and time-stamped headlines since the morning's `written_at`
(`curl -s -m 40 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/news-wire?since=<written_at>'`).

**3. Compose ONE JSON object** and write it to `/tmp/midday.json`:
```
{
  "headline":  "<=95 chars, data line, no full stop — the trigger first",
  "stance":    "<=200 chars, max 2 sentences",
  "trigger":   {"gate": "<a fired gate's exact name>", "detail": "<=120 chars, the value and its time>"},
  "scorecard": [{"call": "<what the morning brief said>", "actual": "<what happened, with time>"}],   // 0-3
  "bullets":   ["<=175 chars each, 0-5 — the reaction: open, 10:00 data, what it changes this afternoon"],
  "items":     [{"head": "<=60", "body": "<=155"}],   // 0-4, COMPANIES only (pre-market reports)
  "watch":     [{"head": "<=55", "body": "<=155"}]    // 0-4, this afternoon and after the close
}
```
Rules beyond the morning's: the trigger is the first thing in the headline;
every intraday level says its time ("at 11:30"); the scorecard quotes the
morning honestly — a wrong call is written down, not dropped; a company is
named in `items` or nowhere (bullets may not name one).

**4. Validate, then submit.**
```
python3 /tmp/md/scripts/build_brief_edition.py --edition midday --prepare-file /tmp/midday.json --gates /tmp/midday_gates.json
```
Must print `prepared OK`. Fix and rerun; never submit a file that failed.
Submit through the `ops-code-commit` edge function (NOT agent-write — its
allowlist is the morning file only). The bearer token is in the database:
Supabase MCP `execute_sql` on project `yqaqqzseepebrocgibcw`:
`select value from ops_secrets where name='gh_push_token'` — never echo it.
```
POST https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/ops-code-commit
Authorization: Bearer <token>
{"branch":"midday/<YYYY-MM-DD>","commit_message":"Midday update — <date>","pr_title":"Midday update — <date>",
 "pr_body":"Gate fired: <names>. Validated by build_brief_edition.py.","merge":true,
 "files":[{"path":"public/midday_gates.json","content_b64":"..."},{"path":"public/midday_update.json","content_b64":"..."}]}
```
On a QUIET day the `files` list carries only `public/midday_gates.json` and
the message is "Midday gate check — <date> (quiet)". The response must be
`"ok": true`.

**5. Verify live.** Poll `https://macrotilt.com/midday_gates.json?cb=<random>`
until `date` is today (Vercel deploys the merge; allow ~6 minutes). On a FIRED
day also `midday_update.json`, then render the homepage exactly as the
morning playbook says (`npm install --no-audit --no-fund` then
`node scripts/render_page.cjs https://macrotilt.com/ /tmp/home.png`) and
READ the screenshot: the tile label must say "Midday Update · … · written
<time> ET" — on a quiet day the Morning Brief with the "No midday update"
line under its label.

**6. Report** — numbered table, short, plain English, nothing for Joe to do.
A quiet day is one line: "Midday gate check: quiet (S&P −0.3%, 10y +2bp,
Brent +1.1%); nothing posted."

## MARKET CLOSE (~6:41 PM ET)

**Job:** score the day and set up tomorrow. Posts every trading day, after the
post-market earnings window. Tomorrow's stance is the Morning's job, not this
one's.

**1. Clone and gate.** Clone as above. If today is not a trading day the
prepare step exits 2 — stop with one line.

**2. Fetch:** `daily_brief.json` and, if it exists for today,
`midday_update.json` (what was said — the scorecard grades them);
`brief-latest` only after it has rolled to today's close (its `as_of` dates
are today's) — if it still shows the prior session, take the closes from the
Yahoo chart endpoint the gate script uses, labelled "at the close"; time-stamped
headlines from `news-wire` since the midday (or morning) `written_at`
(`?since=<written_at>`; add `&q=earnings,results,revenue,guidance` for the
post-market reports), including post-market earnings with their after-hours
moves and times. An after-hours move is quoted only when a timed headline or
the Yahoo chart endpoint (with its own time) carries it.

**3. Compose ONE JSON object** → `/tmp/close.json`:
```
{
  "headline":  "<=95 chars, data line: the closes that mattered and the biggest post-market print",
  "stance":    "<=200 chars, max 2 sentences — the day in one read",
  "scorecard": [{"call": "...", "actual": "..."}],   // 1-3, REQUIRED: what the morning (and midday) said vs what happened
  "sections":  [ Macro & Rates / Equity Markets / Credit & Liquidity, each {title, bullets[<=3 x 175], positioning, single_name} ],
  "items":     [{"head": "<=60", "body": "<=155"}],   // 0-4, COMPANIES: post-market reports with after-hours % and time
  "watch":     [{"head": "<=55", "body": "<=155"}]    // 0-4, TOMORROW: releases with times, reports, decisions
}
```
`positioning` and `single_name` are normally `null` — the morning carries
positioning; repeat it only if it changed today. Nothing-to-say is allowed:
if the table says it all, post the scorecard, one bullet per section at
most, and tomorrow's calendar.

**4. Validate, then submit** exactly as the midday, with
`--edition close`, file `public/market_close.json`, branch
`close/<YYYY-MM-DD>`, message "Market close — <date>".

**5. Verify live** as above: `market_close.json` carries today's date and the
homepage tile reads "Market Close · … · written <time> ET". The Morning Brief
and Midday Update move to "Earlier today" inside the full-brief view.

**6. Report** — numbered table, short.

## FAILURE MODE
If any step fails, leave everything alone and say so. A missing Midday Update
is the normal state; a missing Market Close shows yesterday's edition with
its own date and is caught by the morning session's report the next day.
Never fix a tool only in the sandbox: a fix to `midday_gates.py`,
`build_brief_edition.py` or this file ships to `main` through
`ops-code-commit` in the same run (`python3 -m py_compile` first).
