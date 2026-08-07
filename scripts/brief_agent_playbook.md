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

**Canonical contract:** the accuracy contract below mirrors the `PROMPT` block
in `scripts/build_daily_brief.py`. If they ever diverge, the script is
canonical — update this file in the same commit that changes the script.

---

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
each `{title, bullets[], positioning, single_name}` — and `movers` (leave `[]`;
the prepare step attaches real movers from the scan table). `date` and
`recap_session` are overwritten by the prepare step — don't sweat them.

**HARD ACCURACY CONTRACT (overrides everything else):**
1. **Sourced numbers only.** Every figure comes from the feeds above or a page fetched THIS RUN with a visible timestamp. Never from memory or an undated snippet. An omitted figure is correct; a wrong one is a failure.
2. **No direction word without two sourced points.** "Eased back", "stabilized", "rebounded", "off its highs", "steady" are path claims — write one only holding two timestamped levels where the later one supports it.
3. **Never call a level a high/record** unless a fetched source says so and no later sourced level exceeds it.
4. **Earnings are events with dates.** Confirm the report date this run. If the report is today or later, the ONLY phrasing is "reports after today's close". Never state results that have not been published.
5. **Single-stock extended-hours moves:** percent, from a story published in the last 6 hours, or not at all. Never a dollar level inferred from close + move.
6. **Self-check before returning:** name to yourself which fetch produced every number and direction word; delete anything that fails; check the brief does not contradict itself.
- **Pre-market labeling:** every equity/yield/FX/commodity figure is labeled "Wednesday's close" / "overnight (~6am ET)" / "pre-market" — never a bare "up X% today" before the open.
- **Reader-facing labels only:** never print an internal field name, the word DATA, a vendor/publication/feed name, or narration of your own research state.
- **Plain English** for a smart non-trader; translate jargon every time.
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
`date`/`recap_session`, scrubs banned copy, and attaches real movers.

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

**5. Verify live.** Poll `https://macrotilt.com/daily_brief.json?cb=<random>`
until `date` equals today (Vercel deploys the merge; allow up to ~6 minutes).
The email is sent by the GitHub workflow from the committed file on its
existing schedule — nothing for the session to send.

**6. Report** in the numbered-table format, short. Ping Joe only if something
is broken and needs him.

**Failure mode:** if any step fails, leave everything alone and say so in the
report. The site keeps the last good brief, and the GitHub-side freshness
alerts (WORKFLOW_FAILURE_ALERT + brief-ensure) cover staleness independently.
