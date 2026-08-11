// trigger-workflow — fires a GitHub Actions workflow_dispatch with a
// dedupe guard to prevent double-runs when GitHub's own cron scheduler
// has already fired (or is about to fire) the same workflow.
//
// Called by Supabase pg_cron + pg_net from the database, using a shared
// bearer token (TRIAGE_WEBHOOK_TOKEN). The allowlist below prevents an
// exfiltrated token from dispatching arbitrary repo workflows.
//
// Request body: { workflow: string, ref?: string }
// Response:     { triggered: boolean, ... }
//
// 2026-07-13 — Hardened against boot failure. The deployed bundle began
// returning 503 BOOT_ERROR on every call, which silently no-opped every
// Supabase-cron backup job that dispatches through this function (paper
// intraday, indicator refresh, universe snapshots, massive daily, scan
// backups). Two changes remove the boot-time failure surface: (1) use the
// built-in Deno.serve instead of the external std/http `serve` import, so
// there is no module fetched over the network at boot; (2) read all
// secrets lazily inside the handler instead of at module load, so a
// missing secret returns a clean 500 rather than crashing the isolate.

const GH_API = "https://api.github.com";

// Allowlist — only these workflows can be triggered by this function.
// Prevents an exfiltrated TRIAGE_WEBHOOK_TOKEN from firing arbitrary
// workflows on the repo.
const ALLOWED_WORKFLOWS = new Set<string>([
  "SCAN_345PM_WEEKDAYS.yml",
  "INDICATOR-REFRESH_7AM_WEEKDAYS.yml",
  "UNIVERSE_SNAPSHOT_3X_WEEKDAYS.yml",
  "MASSIVE-DAILY.yml",
  // 2026-07-13 — the pg_cron backup `paper-intraday-backup-hourly` dispatches
  // this to cover GitHub silently dropping the intraday schedule (LESSONS
  // 4.13/4.17). It was missing here, so the backup returned workflow_not_allowed
  // and the two Paper intraday feeds went stale whenever GitHub skipped a slot.
  "PAPER-PORTFOLIO-INTRADAY.yml",
  // 2026-07-29 — LSE-ARCHIVE-IV's first-ever scheduled fire (02:30 UTC) never
  // ran (GitHub silently skipped it, LESSONS 4.13). pg_cron backup at 03:30 UTC
  // dispatches through here; the 90-min dedupe window skips it when GitHub's
  // own cron did run.
  "LSE-ARCHIVE-IV.yml",
  // 2026-07-29 — the EDGAR Form 4 ingest is a single-schedule job with no
  // backup path and no alerting. GitHub silently skipped its 10:00/11:00 UTC
  // fire on 7/29, so insider_history_edgar stopped at filing_date 2026-07-27
  // while the paid UW feed stayed current — and the health row still read
  // green. This matters more every week: UW lapses 2026-08-12, after which
  // EDGAR is the ONLY insider source. pg_cron backup at 11:30 UTC dispatches
  // through here; the 90-min dedupe skips it when GitHub's own cron did run.
  "scanner-insider_edgar-daily.yml",
  // 2026-08-11 — the Conviction Events book's ENTIRE trading schedule is these
  // two brand-new workflows, and LESSONS 4.13/4.17 says GitHub silently skips
  // a new workflow's first scheduled fires. It did: at 21:20 UTC on cutover day
  // CONVICTION-KILL-CHECK had zero runs against a 21:15 UTC schedule, and had
  // to be dispatched by hand. No backup path existed for either. pg_cron
  // backups ('conviction-open-backup-1215utc', 'conviction-kill-backup-2145utc')
  // dispatch through here; the 90-min dedupe skips them when GitHub's own cron
  // did run. A missed OPEN fire is a day the book does not trade.
  "CONVICTION-OPEN-DAILY.yml",
  "CONVICTION-KILL-CHECK.yml",
]);

// If the workflow has a run completed with conclusion=success in the last
// DEDUPE_WINDOW_MIN minutes, skip firing.
const DEDUPE_WINDOW_MIN = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ghHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function ghGet(token: string, path: string): Promise<unknown> {
  const r = await fetch(`${GH_API}${path}`, { headers: ghHeaders(token) });
  if (!r.ok) throw new Error(`GH GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

// POST /dispatches returns 204 with empty body — handle that case.
async function ghDispatch(repo: string, token: string, workflow: string, ref: string): Promise<void> {
  const path = `/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  const r = await fetch(`${GH_API}${path}`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref }),
  });
  if (r.status !== 204) throw new Error(`GH POST ${path} -> ${r.status} ${await r.text()}`);
}

async function recentSuccessfulRun(repo: string, token: string, workflow: string, windowMin: number) {
  type Run = {
    id: number;
    status: string;
    conclusion: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
    event: string;
  };
  const data = await ghGet(
    token,
    `/repos/${repo}/actions/workflows/${workflow}/runs?per_page=10`,
  ) as { workflow_runs: Run[] };

  const cutoff = Date.now() - windowMin * 60_000;
  for (const run of data.workflow_runs) {
    const t = Date.parse(run.updated_at);
    if (t < cutoff) break; // runs are newest-first; stop scanning
    if (run.status === "completed" && run.conclusion === "success") return run;
    if (run.status === "queued" || run.status === "in_progress") return run;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // Lazy env reads — a missing secret returns a clean 500, never a boot crash.
  const GH_TOKEN = Deno.env.get("GITHUB_TRIAGE_TOKEN") || "";
  const GH_REPO  = Deno.env.get("GITHUB_REPO") || "jmezzadri/market-dashboard";
  const WH_TOKEN = Deno.env.get("TRIAGE_WEBHOOK_TOKEN") || "";
  if (!GH_TOKEN || !WH_TOKEN) {
    const missing = [!GH_TOKEN ? "GITHUB_TRIAGE_TOKEN" : "", !WH_TOKEN ? "TRIAGE_WEBHOOK_TOKEN" : ""].filter(Boolean).join(", ");
    return json({ error: "server_misconfigured", detail: `missing secret(s): ${missing}` }, 500);
  }

  // Auth
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${WH_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  // Parse body
  let body: { workflow?: string; ref?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const workflow = body.workflow;
  const ref = body.ref || "main";

  if (!workflow || typeof workflow !== "string") {
    return json({ error: "missing_workflow" }, 400);
  }
  if (!ALLOWED_WORKFLOWS.has(workflow)) {
    return json(
      { error: "workflow_not_allowed", workflow, allowed: [...ALLOWED_WORKFLOWS] },
      400,
    );
  }

  // Dedupe check
  let recent;
  try {
    recent = await recentSuccessfulRun(GH_REPO, GH_TOKEN, workflow, DEDUPE_WINDOW_MIN);
  } catch (e) {
    return json({ error: "github_api_error", detail: String(e) }, 502);
  }
  if (recent) {
    return json({
      triggered: false,
      reason: `recent_${recent.status}`,
      run: {
        id: recent.id,
        status: recent.status,
        conclusion: recent.conclusion,
        event: recent.event,
        updated_at: recent.updated_at,
        url: recent.html_url,
      },
      dedupe_window_min: DEDUPE_WINDOW_MIN,
      note: "Skipped to avoid double-running — a recent run exists.",
    });
  }

  // Fire dispatch
  const dispatchedAt = new Date().toISOString();
  try {
    await ghDispatch(GH_REPO, GH_TOKEN, workflow, ref);
  } catch (e) {
    return json({ error: "github_dispatch_failed", detail: String(e) }, 502);
  }

  return json({
    triggered: true,
    workflow,
    ref,
    dispatched_at: dispatchedAt,
    note: "workflow_dispatch fired. Check Actions tab within ~10s to see the run.",
    actions_url: `https://github.com/${GH_REPO}/actions/workflows/${workflow}`,
  });
});
