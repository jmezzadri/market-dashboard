// ops-code-commit — ship code + observe the result, for Cowork cloud sessions.
//
// Why this exists: Cowork cloud sessions cannot `git push` (the git proxy refuses to inject a
// credential for this repo) and api.github.com is intercepted in-container, so a session that
// fixes a bug can neither ship it nor watch the workflow it just fixed. `agent-write` covers
// src/, LESSONS.md and the daily brief only.
//
// Auth:  Bearer <ops_secrets.gh_push_token>   (same secret gh-push uses)
// Token: ops_secrets.github_pat
//
// Modes (one per call):
//   { branch, commit_message, pr_title?, pr_body?, merge?, files:[{path, content_b64} | {path, delete:true}] }
//   { merge_pr_number }                       retry the squash merge (main moved under the PR)
//   { dispatch: "WORKFLOW.yml", inputs?: {} } workflow_dispatch, allowlisted workflows only
//   { runs: "WORKFLOW.yml", limit?: n }       recent runs w/ conclusion  (read-only)
//   { run_jobs: <run_id> }                    per-step outcome for one run (read-only)
//   { run_log: <run_id>, tail?: n, all?: b }  the failing job's LOG TEXT     (read-only)

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GH_REPO = "jmezzadri/market-dashboard";
const GH_API = "https://api.github.com";

// The write surface. A session can READ the whole repo (it clones it); this is
// only about what it may COMMIT, and it is deliberately explicit.
//
// 2026-08-12 (Joe: "clean up both"): the list stopped being a code constant.
// Twice in one day a cleanup stalled because a path was not on it and widening
// meant redeploying this function. Extra prefixes now come from
// ops_secrets.code_path_prefixes (comma-separated), so widening is one SQL
// update. The base set below is what ships by default.
const BASE_PATH_PREFIXES = [
  "scripts/", "src/", "LESSONS.md", "supabase/functions/", "paper_portfolio/",
  ".github/workflows/",     // the schedules and their docs live with the code they run
  "public/data_manifest.json", // the feed contract the site renders
];
async function allowedPrefixes(): Promise<string[]> {
  try {
    const { data } = await supabase.from("ops_secrets").select("value")
      .eq("name", "code_path_prefixes").maybeSingle();
    const extra = String(data?.value || "").split(",").map((x) => x.trim()).filter(Boolean);
    return [...BASE_PATH_PREFIXES, ...extra];
  } catch (_) {
    return BASE_PATH_PREFIXES;   // a missing row must never block a legitimate ship
  }
}
const FORBIDDEN_BRANCHES = ["main", "master"];
// 2026-08-19: repairing the MOVE hole meant waiting ~3h for the next
// scheduled indicator pull to see whether the fix worked. A data fix you
// cannot trigger is a data fix you cannot verify in the session that made it.
// TRADE-IDEA-SCORECARD-DAILY was added the same way on 2026-08-17 (Joe: the
// scorecard read "no close on or after 8/17" while the refresh had not run).
// Both are read-then-write-a-data-file jobs that commit only if the file
// changed; neither touches source, deploys, or money.
//
// 2026-08-19 (health sweep): this Set had DRIFTED — the deployed function
// carried TRADE-IDEA-SCORECARD-DAILY but the committed copy did not, because
// 8/17 was hand-deployed and never committed. The next deploy from this repo
// would have silently removed it. Deployed source and committed source are one
// artifact: any hand-deploy is a bug until it is committed.
const DISPATCHABLE = new Set([
  "DAILY-BRIEF-WRITER.yml", "BRIEF-FRESHNESS-SELFHEAL.yml", "BRIEF-EMAIL-SMOKE.yml",
  "CONVICTION-OPEN-DAILY.yml", "ECON-CALENDAR-DAILY.yml",
  "INDICATOR-REFRESH_7AM_WEEKDAYS.yml", "TRADE-IDEA-SCORECARD-DAILY.yml",
  // The QT-* entries that stood here were removed on 2026-08-28: Quality Trend
  // was retired on 2026-08-26 and QT-EOD-DAILY / QT-FUNDAMENTALS-REFRESH /
  // QT-REBALANCE were deleted with it. A dispatchable name with no workflow
  // behind it is a 404 that reads like a capability.
]);

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
function pathAllowed(p: string, prefixes: string[]) {
  if (p.includes("..")) return false;
  return prefixes.some((pref) => p === pref || p.startsWith(pref));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { data: tok } = await supabase.from("ops_secrets").select("value").eq("name", "gh_push_token").maybeSingle();
  const auth = req.headers.get("authorization") || "";
  if (!tok?.value || !auth.startsWith("Bearer ") || auth.slice(7) !== tok.value) return json({ error: "unauthorized" }, 401);

  const { data: pat } = await supabase.from("ops_secrets").select("value").eq("name", "github_pat").maybeSingle();
  if (!pat?.value) return json({ error: "no github_pat" }, 500);

  const H = {
    Authorization: `Bearer ${pat.value}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  async function gh(method: string, path: string, body?: unknown) {
    const r = await fetch(`${GH_API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : null;
  }

  // This repo commits several times an hour (data pipelines), so "Base branch was
  // modified" is the NORMAL race, not an error — retry the merge a few times.
  async function squashMerge(prNumber: number, title: string) {
    let last: unknown = null;
    for (let i = 0; i < 5; i++) {
      try {
        return await gh("PUT", `/repos/${GH_REPO}/pulls/${prNumber}/merge`, { merge_method: "squash", commit_title: `${title} (#${prNumber})` });
      } catch (e) { last = e; await sleep(3000); }
    }
    throw last;
  }

  try {
    const b = await req.json();

    // ---- read-only: recent runs -------------------------------------------
    if (b?.runs) {
      const limit = Math.min(Number(b.limit) || 8, 30);
      const d = await gh("GET", `/repos/${GH_REPO}/actions/workflows/${b.runs}/runs?per_page=${limit}`);
      return json({ ok: true, runs: (d.workflow_runs || []).map((r: any) => ({
        id: r.id, status: r.status, conclusion: r.conclusion, event: r.event,
        created_at: r.created_at, url: r.html_url, head_sha: (r.head_sha || "").slice(0, 8),
      })) });
    }

    // ---- read-only: per-step outcome for one run ---------------------------
    if (b?.run_jobs) {
      const d = await gh("GET", `/repos/${GH_REPO}/actions/runs/${b.run_jobs}/jobs?per_page=100`);
      return json({ ok: true, jobs: (d.jobs || []).map((j: any) => ({
        name: j.name, status: j.status, conclusion: j.conclusion,
        steps: (j.steps || []).map((s: any) => ({ name: s.name, conclusion: s.conclusion })),
      })) });
    }

    // ---- read-only: the failing job's log TEXT ------------------------------
    // 2026-08-19 (health sweep): `run_jobs` says WHICH step failed and stops
    // there, so every sweep that hit a red had to guess at WHY from the step
    // name. LESSONS 4.28 ("confirmed from run history, not inferred") is not
    // reachable without the log, and a guess that happens to be plausible is
    // exactly how a false fix ships. Defaults to failed jobs only, tail only —
    // a full Actions log is megabytes and the answer is always at the end.
    if (b?.run_log) {
      const tail = Math.min(Math.max(Number(b.tail) || 6000, 500), 60000);
      const d = await gh("GET", `/repos/${GH_REPO}/actions/runs/${b.run_log}/jobs?per_page=100`);
      const jobs = (d.jobs || []).filter((j: any) => b.all === true || j.conclusion !== "success");
      const out = [];
      for (const j of jobs) {
        let txt = "";
        try {
          // redirect: "manual" on purpose — the log lives in blob storage and
          // forwarding the GitHub Authorization header to it returns 403.
          const r0 = await fetch(`${GH_API}/repos/${GH_REPO}/actions/jobs/${j.id}/logs`, { headers: H, redirect: "manual" });
          if (r0.status >= 300 && r0.status < 400) {
            const loc = r0.headers.get("location");
            const r1 = await fetch(loc!);
            txt = r1.ok ? await r1.text() : `<log fetch ${r1.status}>`;
          } else {
            txt = r0.ok ? await r0.text() : `<log ${r0.status}: expired or unavailable>`;
          }
        } catch (e) {
          txt = `<log error: ${String((e as Error).message || e).slice(0, 200)}>`;
        }
        out.push({
          job: j.name, conclusion: j.conclusion, bytes: txt.length,
          failed_steps: (j.steps || []).filter((s: any) => s.conclusion !== "success" && s.conclusion !== "skipped").map((s: any) => s.name),
          log_tail: txt.slice(-tail),
        });
      }
      return json({ ok: true, run_id: b.run_log, jobs: out });
    }

    // ---- dispatch ---------------------------------------------------------
    if (b?.dispatch) {
      if (!DISPATCHABLE.has(b.dispatch)) return json({ error: `workflow not dispatchable: ${b.dispatch}` }, 403);
      const r = await fetch(`${GH_API}/repos/${GH_REPO}/actions/workflows/${b.dispatch}/dispatches`, {
        method: "POST", headers: H, body: JSON.stringify({ ref: b.ref || "main", inputs: b.inputs || {} }),
      });
      if (r.status !== 204) return json({ ok: false, error: `dispatch -> ${r.status}: ${(await r.text()).slice(0, 300)}` }, 502);
      return json({ ok: true, dispatched: b.dispatch });
    }

    // ---- merge-only retry --------------------------------------------------
    if (b?.merge_pr_number) {
      const pr = await gh("GET", `/repos/${GH_REPO}/pulls/${b.merge_pr_number}`);
      const merge = await squashMerge(pr.number, pr.title);
      return json({ ok: true, pr_number: pr.number, pr_url: pr.html_url, merge_sha: merge?.sha || null });
    }

    // ---- commit + PR (+ optional merge) ------------------------------------
    if (!b?.branch || !b?.commit_message || !Array.isArray(b.files) || !b.files.length) return json({ error: "bad request" }, 400);
    if (FORBIDDEN_BRANCHES.includes(b.branch)) return json({ error: "cannot commit straight to main" }, 403);
    const prefixes = await allowedPrefixes();
    for (const f of b.files) {
      if (typeof f.path !== "string") return json({ error: "bad file entry" }, 400);
      // 2026-08-13: a file entry is EITHER a write (content_b64) or a delete
      // (delete:true). Deletion was missing, which meant a session could
      // replace a retired module but never remove it — the four-tile cockpit
      // left a stale hand-typed calendar and an orphan component behind with
      // no way to take them out, and dead source invites a future session to
      // "fix" it. Same path allowlist governs both: this widens what can be
      // done to a path, never which paths.
      const isDelete = f.delete === true;
      if (!isDelete && typeof f.content_b64 !== "string") return json({ error: "bad file entry" }, 400);
      if (!pathAllowed(f.path, prefixes)) return json({ error: `path not allowed: ${f.path} (allowed: ${prefixes.join(", ")})` }, 400);
    }

    const mainRef = await gh("GET", `/repos/${GH_REPO}/git/refs/heads/main`);
    const mainSha = mainRef.object.sha;
    // LESSONS 4.29 rule 2, applied here 2026-08-19: NEVER delete a ref to make
    // creation idempotent. Deleting a ref CLOSES any open PR on it, so a second
    // submission of the same branch silently kills the PR it is trying to update
    // and then fails on "a pull request already exists". `agent-write` was fixed
    // for this on 8/13; this function had the identical delete-then-create and
    // was missed — 4.28 rule 5 (verify every caller of a shared rule) in the
    // flesh. Create the ref; on 422 (already exists) force-PATCH it instead.
    try {
      await gh("POST", `/repos/${GH_REPO}/git/refs`, { ref: `refs/heads/${b.branch}`, sha: mainSha });
    } catch (e) {
      if (!String((e as Error).message || e).includes("422")) throw e;
      await gh("PATCH", `/repos/${GH_REPO}/git/refs/heads/${b.branch}`, { sha: mainSha, force: true });
    }

    const baseCommit = await gh("GET", `/repos/${GH_REPO}/git/commits/${mainSha}`);
    const treeItems = [];
    for (const f of b.files) {
      if (f.delete === true) {
        // sha:null against a base_tree is how the git data API records a removal.
        treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const blob = await gh("POST", `/repos/${GH_REPO}/git/blobs`, { content: f.content_b64, encoding: "base64" });
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await gh("POST", `/repos/${GH_REPO}/git/trees`, { base_tree: baseCommit.tree.sha, tree: treeItems });
    const commit = await gh("POST", `/repos/${GH_REPO}/git/commits`, {
      message: b.commit_message, tree: tree.sha, parents: [mainSha],
      author: { name: "MacroTilt Agent", email: "agent@macrotilt.com" },
    });
    await gh("PATCH", `/repos/${GH_REPO}/git/refs/heads/${b.branch}`, { sha: commit.sha, force: true });

    let pr = null;
    const existing = await gh("GET", `/repos/${GH_REPO}/pulls?state=open&head=jmezzadri:${b.branch}`);
    if (Array.isArray(existing) && existing.length) pr = existing[0];
    if (!pr) {
      pr = await gh("POST", `/repos/${GH_REPO}/pulls`, {
        title: b.pr_title || b.commit_message.split("\n")[0], head: b.branch, base: "main", body: b.pr_body || "", draft: false,
      });
    }

    let merge = null;
    if (b.merge === true) merge = await squashMerge(pr.number, pr.title);
    return json({ ok: true, pr_number: pr.number, pr_url: pr.html_url, merge_sha: merge?.sha || null });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 500) }, 500);
  }
});
