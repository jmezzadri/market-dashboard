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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GH_TOKEN   = Deno.env.get("GITHUB_TRIAGE_TOKEN")!;
const GH_REPO    = Deno.env.get("GITHUB_REPO") || "jmezzadri/market-dashboard";
const WH_TOKEN   = Deno.env.get("TRIAGE_WEBHOOK_TOKEN")!;

// Allowlist — only these workflows can be triggered by this function.
// Prevents an exfiltrated TRIAGE_WEBHOOK_TOKEN from firing arbitrary
// workflows on the repo.
const ALLOWED_WORKFLOWS = new Set<string>([
  "SCAN_345PM_WEEKDAYS.yml",
  "INDICATOR-REFRESH_7AM_WEEKDAYS.yml",
  "UNIVERSE_SNAPSHOT_3X_WEEKDAYS.yml",
]);

// If the workflow has a run completed with conclusion=success in the last
// DEDUPE_WINDOW_MIN minutes, skip firing. Covers: GitHub's own cron
// already fired, OR the caller retried within the same window.
const DEDUPE_WINDOW_MIN = 90;

const GH_API = "https://api.github.com";
const ghHeaders = {
  "Authorization": `Bearer ${GH_TOKEN}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function ghGet(path: string): Promise<unknown> {
  const r = await fetch(`${GH_API}${path}`, { headers: ghHeaders });
  if (!r.ok) {
    throw new Error(`GH GET ${path} → ${r.status} ${await r.text()}`);
  }
  return r.json();
}

// POST /dispatches returns 204 with empty body — handle that case.
async function ghDispatch(workflow: string, ref: string): Promise<void> {
  const path = `/repos/${GH_REPO}/actions/workflows/${workflow}/dispatches`;
  const r = await fetch(`${GH_API}${path}`, {
    method: "POST",
    headers: ghHeaders,
    body: JSON.stringify({ ref }),
  });
  if (r.status !== 204) {
    throw new Error(`GH POST ${path} → ${r.status} ${await r.text()}`);
  }
}

async function recentSuccessfulRun(workflow: string, windowMin: number) {
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
    `/repos/${GH_REPO}/actions/workflows/${workflow}/runs?per_page=10`,
  ) as { workflow_runs: Run[] };

  const cutoff = Date.now() - windowMin * 60_000;
  for (const run of data.workflow_runs) {
    const t = Date.parse(run.updated_at);
    if (t < cutoff) break; // runs are newest-first; stop scanning
    if (run.status === "completed" && run.conclusion === "success") {
      return run;
    }
    if (run.status === "queued" || run.status === "in_progress") {
      // Treat in-flight runs as a dedupe hit too — don't stack.
      return run;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
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
    recent = await recentSuccessfulRun(workflow, DEDUPE_WINDOW_MIN);
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
    await ghDispatch(workflow, ref);
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
