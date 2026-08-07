// gh-push — PERMANENT: single-commit multi-file push to jmezzadri/market-dashboard via Git Data API.
// Exists because Cowork scheduled-task sandboxes lost direct git push access (~2026-08-05, git proxy
// strips tokens). Trigger sessions deliver x-charts content through this instead of git.
// Auth: Bearer <ops_secrets.gh_push_token>. Body: {branch, message, files:[{path, content_b64}]}.
// Returns {ok, commit_sha}. Allowed branches: x-charts only (safety: no main writes from here).

import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GH_REPO = "jmezzadri/market-dashboard";
const GH_API = "https://api.github.com";
const ALLOWED_BRANCHES = ["x-charts"];

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { data: tok } = await supabase.from("ops_secrets").select("value").eq("name", "gh_push_token").maybeSingle();
  const auth = req.headers.get("authorization") || "";
  if (!tok?.value || !auth.startsWith("Bearer ") || auth.slice(7) !== tok.value) return json({ error: "unauthorized" }, 401);
  const { data: pat } = await supabase.from("ops_secrets").select("value").eq("name", "github_pat").maybeSingle();
  if (!pat?.value) return json({ error: "no github_pat" }, 500);
  const H = { Authorization: `Bearer ${pat.value}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  async function gh(method: string, path: string, body?: unknown) {
    const r = await fetch(`${GH_API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${txt.slice(0, 250)}`);
    return txt ? JSON.parse(txt) : null;
  }

  try {
    const b = await req.json();
    if (!b?.branch || !Array.isArray(b.files) || !b.files.length || !b.message) return json({ error: "bad request" }, 400);
    if (!ALLOWED_BRANCHES.includes(b.branch)) return json({ error: `branch not allowed: ${b.branch}` }, 403);
    const ref = await gh("GET", `/repos/${GH_REPO}/git/refs/heads/${b.branch}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await gh("GET", `/repos/${GH_REPO}/git/commits/${baseCommitSha}`);
    const treeItems = [] as Array<Record<string, string>>;
    for (const f of b.files) {
      const blob = await gh("POST", `/repos/${GH_REPO}/git/blobs`, { content: f.content_b64, encoding: "base64" });
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await gh("POST", `/repos/${GH_REPO}/git/trees`, { base_tree: baseCommit.tree.sha, tree: treeItems });
    const commit = await gh("POST", `/repos/${GH_REPO}/git/commits`, {
      message: b.message, tree: tree.sha, parents: [baseCommitSha],
      author: { name: "MacroTilt Agent", email: "agent@macrotilt.com" },
    });
    await gh("PATCH", `/repos/${GH_REPO}/git/refs/heads/${b.branch}`, { sha: commit.sha, force: false });
    return json({ ok: true, commit_sha: commit.sha });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 400) }, 500);
  }
});
