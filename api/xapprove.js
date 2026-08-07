// ============================================================================
// api/xapprove.js — trusted-domain proxy for the X-chart approval pages
// ============================================================================
// Why this exists
// ---------------
// The approval buttons in Joe's morning email hit a Supabase edge function
// (x-post-approval). Since ~Aug 6 2026, supabase.co serves those responses to
// BROWSER user-agents with `Content-Type: text/plain` + a sandbox CSP
// (anti-phishing for functions serving HTML). Result on Joe's phone: the tap
// worked server-side, but the page rendered as raw source — "I clicked
// approve and nothing happened" (Aug 7). Verified: curl gets text/html, a
// mobile-Safari UA gets text/plain + `CSP: default-src 'none'; sandbox`.
//
// Fix: serve the pages from macrotilt.com (this proxy), which forwards to the
// Supabase function and returns the HTML with the right content-type. The
// edge function (v5) builds all of its links/forms against
// https://macrotilt.com/api/xapprove, and the trigger prompts write meta.json
// approve/changes URLs against it too — supabase.co never appears in email.
//
// Contract
// --------
//   GET  ?id&t&a=approve|changes|status  -> forwarded verbatim
//   POST (form: id, t, feedback)         -> forwarded verbatim
// Auth lives in the forwarded id+token pair (same as before); this proxy adds
// none and stores nothing. 15s upstream timeout -> 504 page.

const UPSTREAM = "https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/x-post-approval";

export default async function handler(req, res) {
  try {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const init = {
      method: req.method,
      headers: {},
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    };
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      init.body = Buffer.concat(chunks);
      init.headers["Content-Type"] = req.headers["content-type"] || "application/x-www-form-urlencoded";
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST, HEAD");
      return res.end("Method not allowed");
    }
    const r = await fetch(UPSTREAM + qs, init);
    const body = await r.text();
    res.statusCode = r.status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(body);
  } catch (e) {
    res.statusCode = 504;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font-family:-apple-system,Segoe UI,sans-serif;padding:40px 24px;background:#faf8f4">` +
      `<h2>Approval service didn't answer</h2><p>Nothing was posted. Wait a moment and tap the button again.</p>` +
      `<p style="color:#8a8374;font-size:13px">${String(e && e.name === "TimeoutError" ? "Upstream timeout" : e).slice(0, 120)}</p></body>`,
    );
  }
}
