// ============================================================================
// api/brief-ensure.js — independent cloud backstop for the MORNING pipelines
// (homepage daily brief + paper-portfolio pre-open engine)
// ============================================================================
// Why this exists
// ---------------
// The morning pipelines run on GitHub Actions cron, which is best-effort. On
// Mon 2026-07-06 GitHub silently dropped this repo's ENTIRE morning cron block
// (~08:00-11:30 UTC): the 06:15 ET brief writer, every self-heal sweep fire,
// the screener, and all 7 pre-open fires of the paper engine. The homepage sat
// on Saturday's brief past 07:15 ET and NO rebalance orders were queued for
// the open until a manual dispatch. The self-heal sweep could not help because
// it rides the SAME scheduler that failed.
//
// This function is the independent layer: a Vercel cron — different company,
// different scheduler. Nothing here depends on anyone's laptop. (LESSONS 4.17)
//
// What it does (one fire per weekday morning)
// -------------------------------------------
//   1. BRIEF — reads the LIVE homepage brief; if it is not today's (ET),
//      dispatches DAILY-BRIEF-WRITER. The writer is idempotent + email-off,
//      so this can never double-generate or duplicate email.
//   2. PAPER ENGINE — dispatches PAPER-PORTFOLIO-EOD-DAILY unconditionally on
//      weekdays. That workflow is built for redundant fires (12 crons/day by
//      design): it exits quietly outside its 03:00-09:25 ET accept window, on
//      non-trading days (broker-calendar gate), and when today's orders are
//      already submitted (idempotent submitter). This fire is exactly as safe
//      as its own 13th cron — and guarantees the morning rebalance queues
//      even if GitHub drops every cron again.
//
// Schedule: vercel.json cron "45 10 * * 1-5" — 06:45 ET in EDT (05:45 ET in
// EST; the winter fire lands before the 06:15 writer, which then no-ops — an
// accepted DST tradeoff on the Hobby plan's 2-cron budget). Hobby cron
// precision is within the hour, so the worst case is ~07:45 ET EDT — still
// well before the 09:28 ET at-the-open order cutoff.
//
// One-time setup (Vercel -> Project -> Settings -> Environment Variables):
//   BRIEF_DISPATCH_TOKEN = GitHub token with Actions read+write on
//   jmezzadri/market-dashboard. The JSON response's `tokenPresent` field
//   reports whether it is configured — check it after any deploy.
// ============================================================================

const REPO = "jmezzadri/market-dashboard";
const WRITER_WORKFLOW = "DAILY-BRIEF-WRITER.yml";
const PAPER_WORKFLOW = "PAPER-PORTFOLIO-EOD-DAILY.yml";
const BRIEF_URL = "https://macrotilt.com/daily_brief.json";

function etParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, weekday: o.weekday };
}

async function ghDispatch(token, workflow, inputs) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "macrotilt-morning-ensure",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(inputs ? { ref: "main", inputs } : { ref: "main" }),
    }
  );
  return r.status;
}

export default async function handler(req, res) {
  // Same cron auth pattern as the other batch endpoints: if CRON_SECRET is
  // set, require Vercel's bearer header.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  const { date: today, weekday } = etParts();
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const token = process.env.BRIEF_DISPATCH_TOKEN;
  const tokenPresent = Boolean(token);
  const out = { today, weekday, tokenPresent, brief: {}, paper: {} };

  // ---- 1. BRIEF: check the live outcome; dispatch the writer only if stale.
  try {
    const r = await fetch(`${BRIEF_URL}?cb=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    out.brief.liveDate = (await r.json())?.date ?? null;
  } catch (e) {
    out.brief.error = `fetch-live: ${String(e)}`;
  }
  out.brief.fresh = out.brief.liveDate === today;
  if (!out.brief.fresh && tokenPresent) {
    try {
      out.brief.ghStatus = await ghDispatch(token, WRITER_WORKFLOW, { send_mode: "live" });
      out.brief.dispatched = out.brief.ghStatus === 204;
    } catch (e) {
      out.brief.error = `dispatch: ${String(e)}`;
    }
  }

  // ---- 2. PAPER ENGINE: weekday mornings, dispatch unconditionally (see header).
  if (isWeekday && tokenPresent) {
    try {
      out.paper.ghStatus = await ghDispatch(token, PAPER_WORKFLOW);
      out.paper.dispatched = out.paper.ghStatus === 204;
    } catch (e) {
      out.paper.error = `dispatch: ${String(e)}`;
    }
  }

  if (!tokenPresent && (!out.brief.fresh || isWeekday)) {
    out.note =
      "BRIEF_DISPATCH_TOKEN not set in Vercel env — morning-ensure cannot dispatch GitHub workflows until it is added";
  }

  const briefOk = out.brief.fresh || out.brief.dispatched === true;
  const paperOk = !isWeekday || out.paper.dispatched === true;
  return res.status(200).json({ ok: briefOk && paperOk, ...out });
}
