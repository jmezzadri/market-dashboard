// ============================================================================
// api/brief-ensure.js — independent cloud backstop for the homepage daily brief
// ============================================================================
// Why this exists
// ---------------
// The homepage brief (public/daily_brief.json) is produced by the GitHub
// workflow DAILY-BRIEF-WRITER (06:15 ET) and guarded by BRIEF-FRESHNESS-SELFHEAL
// (every 30 min through mid-morning). Both rely on GitHub Actions' scheduler.
// This function is a THIRD layer on a DIFFERENT scheduler (Vercel cron), so even
// a full GitHub-scheduler outage cannot leave the homepage stale. Nothing here
// depends on anyone's laptop.
//
// What it does
// ------------
//   1. Reads the LIVE homepage brief and compares its date to today (ET).
//   2. If it is already today's -> no-op (the normal case; GitHub did its job).
//   3. If it is stale -> dispatches DAILY-BRIEF-WRITER via the GitHub API.
//      The writer is idempotent + email-off, so a dispatch here can NEVER
//      duplicate Joe's email or double-generate.
//
// One-time setup (Vercel -> Project -> Settings -> Environment Variables):
//   BRIEF_DISPATCH_TOKEN = a GitHub token with Actions: read+write on
//   jmezzadri/market-dashboard. Until it is set, this safely no-ops on a stale
//   day (and reports that the token is missing).
//
// Schedule: vercel.json cron "30 12 * * 1-5" (~08:30 ET EDT / 07:30 ET EST),
// after the GitHub writer + early self-heals, so it only ever acts when GitHub
// failed entirely.
// ============================================================================

const REPO = "jmezzadri/market-dashboard";
const WRITER_WORKFLOW = "DAILY-BRIEF-WRITER.yml";
const BRIEF_URL = "https://macrotilt.com/daily_brief.json";

function todayET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

export default async function handler(req, res) {
  // Reuse the same cron auth the other batch endpoints use (already configured
  // in Vercel). If CRON_SECRET is set, require Vercel's bearer header.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  const today = todayET();

  let liveDate = null;
  try {
    const r = await fetch(`${BRIEF_URL}?cb=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    liveDate = (await r.json())?.date ?? null;
  } catch (e) {
    return res.status(200).json({ ok: false, stage: "fetch-live", error: String(e), today });
  }

  if (liveDate === today) {
    return res.status(200).json({ ok: true, fresh: true, liveDate, today });
  }

  // Stale -> dispatch the GitHub writer.
  const token = process.env.BRIEF_DISPATCH_TOKEN;
  if (!token) {
    return res.status(200).json({
      ok: false, fresh: false, liveDate, today,
      note: "homepage stale but BRIEF_DISPATCH_TOKEN not set in Vercel env — add it to enable auto-heal",
    });
  }

  try {
    const gh = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WRITER_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "macrotilt-brief-ensure",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { send_mode: "live" } }),
      }
    );
    const okDispatch = gh.status === 204;
    return res.status(200).json({
      ok: okDispatch, dispatched: okDispatch, ghStatus: gh.status, liveDate, today,
      note: okDispatch ? "homepage was stale — dispatched DAILY-BRIEF-WRITER" : "dispatch failed",
    });
  } catch (e) {
    return res.status(200).json({ ok: false, stage: "dispatch", error: String(e), liveDate, today });
  }
}
