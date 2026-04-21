#!/usr/bin/env node
// bug-triage-helper.mjs
// Helper called by the bug-triage-daily scheduled task after it finishes
// root-causing + staging PRs for each open bug.
//
// Usage:
//   node bug-triage-helper.mjs /path/to/triage-payload.json
//
// The payload file is JSON of shape:
//   {
//     "bugs": [
//       {
//         "id":           "<uuid>",
//         "description":  "User's original bug report text",
//         "url":          "/page-where-bug-happens",
//         "reportedAt":   "2026-04-19T14:22:00Z",
//         "rootCause":    "Full paragraph explaining the real root cause…",
//         "fixSpec":      "Detailed description of the fix made…",
//         "filesChanged": ["src/App.jsx", "supabase/migrations/009_x.sql"],
//         "prNumber":     42,
//         "prUrl":        "https://github.com/.../pull/42",
//         "diffPreview":  "- old line\\n+ new line\\n…"   // ≤40 lines recommended
//       },
//       …
//     ]
//   }
//
// Env required (read from process.env):
//   HMAC_APPROVAL_SECRET       — must match the edge function's secret
//   APPROVE_ENDPOINT           — e.g. https://<proj>.supabase.co/functions/v1/approve-bug-fix
//   RESEND_API_KEY             — Resend API key
//   TRIAGE_EMAIL_TO            — josephmezzadri@gmail.com
//   TRIAGE_EMAIL_FROM          — e.g. triage@macrotilt.com

import fs from "node:fs";
import crypto from "node:crypto";

const SECRET           = process.env.HMAC_APPROVAL_SECRET;
const APPROVE_ENDPOINT = process.env.APPROVE_ENDPOINT;
const RESEND_KEY       = process.env.RESEND_API_KEY;
const EMAIL_TO         = process.env.TRIAGE_EMAIL_TO   || "josephmezzadri@gmail.com";
const EMAIL_FROM       = process.env.TRIAGE_EMAIL_FROM || "triage@macrotilt.com";

if (!SECRET || !APPROVE_ENDPOINT || !RESEND_KEY) {
  console.error("Missing required env vars: HMAC_APPROVAL_SECRET, APPROVE_ENDPOINT, RESEND_API_KEY");
  process.exit(2);
}

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error("Usage: node bug-triage-helper.mjs <payload.json>");
  process.exit(2);
}
const { bugs } = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
if (!Array.isArray(bugs)) { console.error("payload.bugs must be array"); process.exit(2); }

// ── HMAC signing (mirror of edge function verifier) ─────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signUrl(bugId, action) {
  const exp = Math.floor(Date.now() / 1000) + 48 * 3600; // 48h
  const payload = JSON.stringify({ id: bugId, action, exp, nonce: crypto.randomBytes(8).toString("hex") });
  const payloadB64 = b64url(Buffer.from(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(payloadB64).digest();
  const sigB64 = b64url(sig);
  const token = `${payloadB64}.${sigB64}`;
  return `${APPROVE_ENDPOINT}?t=${token}`;
}

// ── HTML ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function bugBlock(b, idx) {
  const approveUrl = signUrl(b.id, "approve");
  const skipUrl    = signUrl(b.id, "skip");
  const files = (b.filesChanged || []).map(f => `<code>${esc(f)}</code>`).join(", ") || "<em>(no files)</em>";
  const diff = b.diffPreview ? esc(b.diffPreview) : "(diff preview unavailable — see PR)";

  return `
  <tr><td style="padding:24px 0;border-top:2px solid #e0e0e0;">
    <div style="font-size:12px;color:#757575;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">
      Bug ${idx + 1} of ${bugs.length} · ID ${esc(b.id).slice(0, 8)} · ${esc(b.reportedAt?.slice(0, 10) || "")}
    </div>
    <div style="font-size:17px;font-weight:600;color:#212121;line-height:1.3;margin-bottom:4px;">
      ${esc(b.description || "(no description)")}
    </div>
    <div style="font-size:13px;color:#616161;margin-bottom:18px;">
      Reported on <code>${esc(b.url || "(no url)")}</code>
    </div>

    <div style="font-size:13px;font-weight:700;color:#455a64;letter-spacing:0.04em;text-transform:uppercase;margin:18px 0 6px;">Root cause</div>
    <div style="font-size:14px;color:#263238;line-height:1.55;margin-bottom:16px;">
      ${esc(b.rootCause || "(not analyzed)")}
    </div>

    <div style="font-size:13px;font-weight:700;color:#455a64;letter-spacing:0.04em;text-transform:uppercase;margin:18px 0 6px;">Proposed fix</div>
    <div style="font-size:14px;color:#263238;line-height:1.55;margin-bottom:10px;">
      ${esc(b.fixSpec || "(no fix spec)")}
    </div>
    <div style="font-size:12px;color:#616161;margin-bottom:10px;">Files: ${files}</div>
    <pre style="background:#263238;color:#eceff1;padding:12px 14px;border-radius:6px;font-size:12px;line-height:1.5;overflow-x:auto;margin:0 0 16px;white-space:pre-wrap;">${diff}</pre>
    <div style="font-size:12px;color:#616161;margin-bottom:20px;">
      PR: <a href="${esc(b.prUrl)}" style="color:#1976d2;">#${esc(b.prNumber)}</a> (draft, staged on feat/triage-${esc(b.id).slice(0, 8)})
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      <tr>
        <td style="padding-right:10px;">
          <a href="${approveUrl}" style="display:inline-block;padding:12px 22px;background:#2e7d32;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;font-size:15px;">
            ✅ APPROVE &amp; SHIP
          </a>
        </td>
        <td>
          <a href="${skipUrl}" style="display:inline-block;padding:12px 22px;background:#eceff1;color:#37474f;font-weight:700;text-decoration:none;border-radius:6px;font-size:15px;border:1px solid #b0bec5;">
            ⏭ SKIP (2 days)
          </a>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border-radius:12px;padding:28px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
    <div style="font-size:13px;color:#757575;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">
      MacroTilt · Daily Triage
    </div>
    <div style="font-size:22px;font-weight:700;color:#212121;margin-bottom:6px;">
      ${bugs.length} bug${bugs.length === 1 ? "" : "s"} ready for review
    </div>
    <div style="font-size:13px;color:#616161;margin-bottom:4px;">${dateStr}</div>
    <div style="font-size:13px;color:#616161;">
      Each fix is already staged as a draft PR. Tap APPROVE to merge + deploy, or SKIP to defer 2 days. Links expire in 48h.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${bugs.map(bugBlock).join("\n")}
    </table>
  </div>
  <div style="font-size:11px;color:#9e9e9e;text-align:center;padding:16px 8px;">
    MacroTilt triage · built by bug-triage-daily @ ${new Date().toISOString()}
  </div>
</div>
</body></html>`;

// ── Send via Resend ──────────────────────────────────────────────────────
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: EMAIL_FROM,
    to: [EMAIL_TO],
    subject: `🐛 MacroTilt — ${bugs.length} bug${bugs.length === 1 ? "" : "s"} ready to ship`,
    html,
  }),
});

if (!res.ok) {
  console.error(`Resend ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`✅ Sent ${bugs.length} bug(s) to ${EMAIL_TO}`);
