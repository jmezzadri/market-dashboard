// approve-bug-fix
// One-tap email-approval handler for MacroTilt bug triage.
//
// Flow:
//   1. Joe taps APPROVE/SKIP link in the 7am triage email.
//   2. This function verifies the HMAC signature + 48h expiry.
//   3. On APPROVE: merges the pre-staged triage PR via GitHub API, marks
//      bug_reports.status = 'fixed', sends a confirmation email.
//   4. On SKIP:    updates bug_reports.status = 'skipped' and sets
//      resurface_at = now() + 2 days, sends a short ack email.
//
// Ship-immediately mode — no undo window. Designed for mobile taps.
//
// Required Supabase secrets:
//   HMAC_APPROVAL_SECRET    (32-byte base64 — generated at deploy time)
//   GITHUB_TRIAGE_TOKEN     (PAT with `repo` scope on market-dashboard)
//   SUPABASE_URL            (auto)
//   SUPABASE_SERVICE_ROLE_KEY  (auto — legacy JWT works for PostgREST)
//   RESEND_API_KEY          (for confirmation emails)
//   TRIAGE_EMAIL_TO         (josephmezzadri@gmail.com)
//   TRIAGE_EMAIL_FROM       (e.g. triage@macrotilt.com)
//   GITHUB_REPO             (e.g. "joemezzadri/market-dashboard")

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────
const SECRET         = Deno.env.get("HMAC_APPROVAL_SECRET")!;
const GH_TOKEN       = Deno.env.get("GITHUB_TRIAGE_TOKEN")!;
const GH_REPO        = Deno.env.get("GITHUB_REPO") || "joemezzadri/market-dashboard";
const SUPA_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY     = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_TO       = Deno.env.get("TRIAGE_EMAIL_TO")   || "josephmezzadri@gmail.com";
const EMAIL_FROM     = Deno.env.get("TRIAGE_EMAIL_FROM") || "triage@macrotilt.com";

const SKIP_WINDOW_DAYS = 2;

// ────────────────────────────────────────────────────────────────────────
// HMAC verification (SHA-256, base64url)
// ────────────────────────────────────────────────────────────────────────
const te = new TextEncoder();
const td = new TextDecoder();

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// Token format: base64url(JSON({id, action, exp, nonce})) . base64url(hmac)
async function verifyToken(token: string): Promise<
  | { ok: true; id: string; action: "approve" | "skip"; exp: number }
  | { ok: false; reason: string }
> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts;
  const expected = await hmacSha256(SECRET, payloadB64);
  const got = b64urlDecode(sigB64);
  if (!timingSafeEqual(expected, got)) return { ok: false, reason: "bad_signature" };
  let payload: { id: string; action: string; exp: number; nonce?: string };
  try { payload = JSON.parse(td.decode(b64urlDecode(payloadB64))); }
  catch { return { ok: false, reason: "bad_payload" }; }
  if (!payload.id || !payload.action || !payload.exp) return { ok: false, reason: "missing_fields" };
  if (Date.now() / 1000 > payload.exp) return { ok: false, reason: "expired" };
  if (payload.action !== "approve" && payload.action !== "skip") return { ok: false, reason: "bad_action" };
  return { ok: true, id: payload.id, action: payload.action, exp: payload.exp };
}

// ────────────────────────────────────────────────────────────────────────
// GitHub helpers
// ────────────────────────────────────────────────────────────────────────
const GH_API = "https://api.github.com";
const ghHeaders = {
  "Authorization": `Bearer ${GH_TOKEN}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function ghGet(path: string) {
  const r = await fetch(`${GH_API}${path}`, { headers: ghHeaders });
  if (!r.ok) throw new Error(`GH GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function ghPost(path: string, body: unknown) {
  const r = await fetch(`${GH_API}${path}`, {
    method: "POST", headers: ghHeaders, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GH POST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function ghPatch(path: string, body: unknown) {
  const r = await fetch(`${GH_API}${path}`, {
    method: "PATCH", headers: ghHeaders, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GH PATCH ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function ghPut(path: string, body: unknown) {
  const r = await fetch(`${GH_API}${path}`, {
    method: "PUT", headers: ghHeaders, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GH PUT ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// Find the triage PR for a bug id. The scheduled task opens a draft PR with
// head `feat/triage-{bugId}-{YYYYMMDD}`; we just match by the triage-{id} prefix.
async function findTriagePr(bugId: string) {
  const openPrs = await ghGet(`/repos/${GH_REPO}/pulls?state=open&per_page=100`);
  const needle = `triage-${bugId}`;
  const hit = openPrs.find((p: any) => (p.head?.ref || "").includes(needle));
  return hit || null;
}

async function shipTriagePr(bugId: string): Promise<{ prNumber: number; sha: string }> {
  const pr = await findTriagePr(bugId);
  if (!pr) throw new Error(`no open triage PR found for bug ${bugId}`);
  // Flip draft → ready, then squash-merge.
  if (pr.draft) {
    await ghPatch(`/repos/${GH_REPO}/pulls/${pr.number}`, { draft: false });
    // GitHub requires GraphQL to mark ready-for-review reliably; PATCH draft=false
    // works for PRs created via REST which is what we use.
  }
  const merge = await ghPut(`/repos/${GH_REPO}/pulls/${pr.number}/merge`, {
    merge_method: "squash",
    commit_title: `${pr.title} (#${pr.number})`,
  });
  return { prNumber: pr.number, sha: merge.sha };
}

async function closeTriagePrNoMerge(bugId: string): Promise<number | null> {
  // SKIP doesn't close the PR — we keep it around so next run can update it.
  // But if we wanted to discard, we'd PATCH state=closed here.
  // Leaving as a no-op: PR stays open, bug_reports.status=skipped hides it
  // from the next email until resurface_at.
  const pr = await findTriagePr(bugId);
  return pr?.number ?? null;
}

// ────────────────────────────────────────────────────────────────────────
// Email (Resend)
// ────────────────────────────────────────────────────────────────────────
async function sendEmail(subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject,
      html,
    }),
  });
  if (!r.ok) console.error(`resend ${r.status}: ${await r.text()}`);
}

// ────────────────────────────────────────────────────────────────────────
// HTML response helpers (minimal mobile-friendly confirmation page)
// ────────────────────────────────────────────────────────────────────────
function htmlPage(body: string, tone: "ok" | "err" | "info" = "info"): Response {
  const bg = tone === "ok" ? "#e8f5e9" : tone === "err" ? "#ffebee" : "#eceff1";
  const fg = tone === "ok" ? "#1b5e20" : tone === "err" ? "#b71c1c" : "#263238";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>MacroTilt triage</title>
     <style>body{margin:0;background:${bg};color:${fg};
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
       .card{max-width:480px;background:#fff;border-radius:12px;padding:28px;
       box-shadow:0 2px 12px rgba(0,0,0,.08);}h1{margin:0 0 12px;font-size:20px}
       p{margin:0 0 8px;line-height:1.5;font-size:15px}code{background:#f5f5f5;
       padding:2px 6px;border-radius:4px;font-size:13px}</style></head>
     <body><div class="card">${body}</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t");
    if (!token) {
      return htmlPage("<h1>Missing token</h1><p>This link is malformed.</p>", "err");
    }

    const v = await verifyToken(token);
    if (!v.ok) {
      const msg = v.reason === "expired"
        ? "This approval link has expired (48h window). The bug will resurface in the next triage email."
        : "This link is invalid or has been tampered with.";
      return htmlPage(`<h1>Link ${v.reason}</h1><p>${msg}</p>`, "err");
    }

    const supa = createClient(SUPA_URL, SUPA_SVC_KEY);

    // Load the bug row — we verify it's still pending; if someone already acted
    // (double-tap, replay), we short-circuit idempotently.
    const { data: bug, error: bugErr } = await supa
      .from("bug_reports")
      .select("id, status, description, resurface_at")
      .eq("id", v.id)
      .maybeSingle();

    if (bugErr || !bug) {
      return htmlPage(`<h1>Bug not found</h1><p>ID: <code>${v.id}</code></p>`, "err");
    }
    if (bug.status === "fixed") {
      return htmlPage(
        `<h1>Already shipped</h1><p>Bug <code>${v.id}</code> was already merged. No action taken.</p>`,
        "info",
      );
    }

    // ── APPROVE ──────────────────────────────────────────────────────
    if (v.action === "approve") {
      let shipped;
      try {
        shipped = await shipTriagePr(v.id);
      } catch (e) {
        await sendEmail(
          `❌ Triage ship failed — bug ${v.id}`,
          `<p>APPROVE tap for bug <code>${v.id}</code> failed to merge.</p>
           <pre>${String(e).replace(/[<>&]/g, "")}</pre>
           <p>Bug left in <code>new</code> state. Investigate manually.</p>`,
        );
        return htmlPage(
          `<h1>Ship failed</h1><p>The PR couldn't be merged. A diagnostic email has been sent.</p><p><code>${String(e).slice(0, 200)}</code></p>`,
          "err",
        );
      }

      await supa.from("bug_reports").update({
        status: "fixed",
        fixed_at: new Date().toISOString(),
        fixed_pr: shipped.prNumber,
        fixed_sha: shipped.sha,
      }).eq("id", v.id);

      await sendEmail(
        `✅ Shipped — bug ${v.id} (PR #${shipped.prNumber})`,
        `<p>PR <a href="https://github.com/${GH_REPO}/pull/${shipped.prNumber}">#${shipped.prNumber}</a> merged to main.</p>
         <p>Vercel is building; should be live in ~60s.</p>
         <p>Bug: <em>${(bug.description || "").slice(0, 200)}</em></p>`,
      );
      return htmlPage(
        `<h1>✅ Shipped</h1>
         <p>PR <code>#${shipped.prNumber}</code> merged. Vercel is deploying.</p>
         <p>Confirmation email on its way.</p>`,
        "ok",
      );
    }

    // ── SKIP ─────────────────────────────────────────────────────────
    if (v.action === "skip") {
      const resurface = new Date(Date.now() + SKIP_WINDOW_DAYS * 86400_000).toISOString();
      await supa.from("bug_reports").update({
        status: "skipped",
        resurface_at: resurface,
      }).eq("id", v.id);
      await closeTriagePrNoMerge(v.id); // no-op by design

      return htmlPage(
        `<h1>Skipped</h1>
         <p>Bug <code>${v.id}</code> will resurface in the triage email on ${resurface.slice(0, 10)}.</p>`,
        "info",
      );
    }

    return htmlPage("<h1>Unknown action</h1>", "err");
  } catch (e) {
    console.error("approve-bug-fix error:", e);
    return htmlPage(
      `<h1>Internal error</h1><p><code>${String(e).slice(0, 300)}</code></p>`,
      "err",
    );
  }
});
