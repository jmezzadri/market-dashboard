// x-post-approval — email-button approval endpoint for the MacroTilt Daily X Chart.
//
// Flow: the daily chart run inserts a row into public.x_pending_posts and emails Joe
// (via the x-charts branch X-CHART-EMAIL action) with two buttons pointing here:
//   GET  ?id=<uuid>&t=<token>&a=approve   -> publish the chart+caption to X, mark posted
//   GET  ?id=<uuid>&t=<token>&a=changes   -> small feedback form
//   POST (form)  id, t, feedback          -> mark changes_requested (checker run regenerates)
//
// Auth: verify_jwt=false (links live in email); auth = row id + single random token,
// same-day-ET expiry, one-shot claim via conditional UPDATE. Service-role DB access.
// X credentials read from public.ops_secrets: x_api_key, x_api_secret, x_access_token,
// x_access_token_secret. Chart bytes fetched from the x-charts branch via github_pat.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const REPO = "jmezzadri/market-dashboard";
const TABLE = "x_pending_posts";

// ---------- tiny HTML shell (MacroTilt-ish, phone-friendly) ----------
function page(title: string, body: string, ok = true): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;background:#faf8f4;color:#1a1a14;font-family:Georgia,'Times New Roman',serif}
.wrap{max-width:560px;margin:0 auto;padding:48px 24px}
.brand{font-size:22px;font-weight:700}.brand em{color:#b8860b;font-style:italic}
.card{background:#fff;border:1px solid #e6e1d6;border-radius:12px;padding:28px;margin-top:20px}
h1{font-size:26px;margin:0 0 10px}p{font-size:17px;line-height:1.5;margin:10px 0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.ok{color:#1e6b34}.bad{color:#9c2b1f}
a.btn,button.btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:16px;margin-top:14px;border-radius:10px;border:0;
 font-size:17px;font-weight:600;text-decoration:none;cursor:pointer;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.gold{background:#b8860b;color:#fff}.ghost{background:#f0ece2;color:#1a1a14}
textarea{width:100%;box-sizing:border-box;min-height:120px;font-size:16px;padding:12px;border:1px solid #cfc8b8;border-radius:10px;
 font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.cap{white-space:pre-wrap;background:#f6f3ec;border-radius:8px;padding:14px;font-size:15px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.foot{margin-top:22px;font-size:13px;color:#8a8374;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
</style></head><body><div class="wrap">
<div class="brand">Macro<em>Tilt</em></div>
<div class="card">${body}</div>
<div class="foot">macrotilt.com &middot; Daily X Chart approval</div>
</div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------- helpers ----------
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function getSecrets(names: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("ops_secrets").select("name,value").in("name", names);
  if (error) throw new Error("secrets read failed: " + error.message);
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[r.name] = r.value;
  return out;
}

// ---------- OAuth 1.0a (HMAC-SHA1) ----------
function pctEnc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1B64(key: string, base: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(base));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function oauth1Header(
  method: string,
  url: string,
  creds: { key: string; secret: string; token: string; tokenSecret: string },
  queryParams: Record<string, string> = {},
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...queryParams };
  const paramStr = Object.keys(all).sort().map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`).join("&");
  const base = [method.toUpperCase(), pctEnc(url), pctEnc(paramStr)].join("&");
  const signingKey = `${pctEnc(creds.secret)}&${pctEnc(creds.tokenSecret)}`;
  oauth.oauth_signature = await hmacSha1B64(signingKey, base);
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pctEnc(k)}="${pctEnc(oauth[k])}"`).join(", ");
}

// ---------- X publish ----------
async function fetchChartPng(sha: string | null, pat: string): Promise<Uint8Array> {
  const ref = sha || "x-charts";
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/chart.png?ref=${ref}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github.raw+json", "User-Agent": "macrotilt-approval" },
  });
  if (!r.ok) throw new Error(`chart fetch failed (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

async function uploadMedia(png: Uint8Array, creds: any): Promise<string> {
  // v2 first, v1.1 fallback.
  const attempts: Array<[string, (fd: FormData) => void]> = [
    ["https://api.x.com/2/media/upload", (fd) => {
      fd.append("media", new Blob([png], { type: "image/png" }), "chart.png");
      fd.append("media_category", "tweet_image");
    }],
    ["https://upload.twitter.com/1.1/media/upload.json", (fd) => {
      fd.append("media", new Blob([png], { type: "image/png" }), "chart.png");
    }],
  ];
  let lastErr = "";
  for (const [url, fill] of attempts) {
    const fd = new FormData();
    fill(fd);
    const auth = await oauth1Header("POST", url, creds);
    const r = await fetch(url, { method: "POST", headers: { Authorization: auth }, body: fd });
    const txt = await r.text();
    if (r.ok) {
      const j = JSON.parse(txt);
      const id = j?.data?.id ?? j?.media_id_string ?? j?.id;
      if (id) return String(id);
      lastErr = "no media id in response";
    } else lastErr = `${url} -> ${r.status}: ${txt.slice(0, 300)}`;
  }
  throw new Error("media upload failed: " + lastErr);
}

async function createPost(text: string, mediaId: string, creds: any): Promise<{ id: string; url: string }> {
  const url = "https://api.x.com/2/tweets";
  const auth = await oauth1Header("POST", url, creds);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`post create failed ${r.status}: ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt);
  const id = j?.data?.id;
  if (!id) throw new Error("no tweet id in response");
  return { id, url: `https://x.com/WeTheSheeple46/status/${id}` };
}

// ---------- Typefully publish (fallback route: no X developer account needed) ----------
async function typefullySocialSetId(apiKey: string): Promise<string> {
  const { data } = await supabase.from("ops_secrets").select("value").eq("name", "typefully_social_set_id").maybeSingle();
  if (data?.value) return data.value;
  const r = await fetch("https://api.typefully.com/v2/social-sets?limit=10", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`typefully social-sets ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const sets = Array.isArray(j) ? j : (j?.results ?? j?.data ?? j?.social_sets ?? []);
  const first = Array.isArray(sets) ? sets[0] : null;
  if (!first?.id) throw new Error("no typefully social set found — is the X account connected in Typefully?");
  await supabase.from("ops_secrets").upsert(
    { name: "typefully_social_set_id", value: String(first.id), note: "auto-cached by x-post-approval", updated_at: new Date().toISOString() },
    { onConflict: "name" },
  );
  return String(first.id);
}

async function typefullyPublish(caption: string, png: Uint8Array, apiKey: string): Promise<void> {
  const setId = await typefullySocialSetId(apiKey);
  const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const up = await fetch(`https://api.typefully.com/v2/social-sets/${setId}/media/upload`, {
    method: "POST", headers: H, body: JSON.stringify({ file_name: "chart.png" }),
  });
  if (!up.ok) throw new Error(`typefully media slot ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const { media_id, upload_url } = await up.json();
  const put = await fetch(upload_url, { method: "PUT", body: png });
  if (!put.ok) throw new Error(`typefully media put ${put.status}`);
  for (let i = 0; i < 10; i++) {
    const st = await fetch(`https://api.typefully.com/v2/social-sets/${setId}/media/${media_id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const j = await st.json().catch(() => ({} as any));
    if (j?.status === "ready") break;
    if (j?.status === "failed") throw new Error("typefully media processing failed");
    await new Promise((res) => setTimeout(res, 2000));
  }
  // publish_at:"now" is rejected by X policy for posts containing URLs ("Direct publishing of X
  // drafts containing URLs is blocked") — captions end in macrotilt.com, so ALWAYS publish via the
  // scheduled queue ~90s out, which X permits. Verified live 2026-08-06.
  const when = new Date(Date.now() + 90_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const dr = await fetch(`https://api.typefully.com/v2/social-sets/${setId}/drafts`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      platforms: { x: { enabled: true, posts: [{ text: caption, media_ids: [media_id] }] } },
      publish_at: when,
    }),
  });
  if (!dr.ok) throw new Error(`typefully draft ${dr.status}: ${(await dr.text()).slice(0, 200)}`);
}

// ---------- handler ----------
Deno.serve(async (req: Request) => {
  try {
    const u = new URL(req.url);
    let id: string | null, t: string | null, a: string | null, feedback = "";

    if (req.method === "POST") {
      const form = await req.formData();
      id = String(form.get("id") ?? "");
      t = String(form.get("t") ?? "");
      a = "submit_changes";
      feedback = String(form.get("feedback") ?? "").trim();
    } else {
      id = u.searchParams.get("id");
      t = u.searchParams.get("t");
      a = u.searchParams.get("a");
    }
    if (!id || !t || !a) return page("Not found", `<h1 class="bad">Link not valid</h1><p>This approval link is incomplete.</p>`, false);

    const { data: row } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (!row || row.approval_token !== t) {
      return page("Not found", `<h1 class="bad">Link not valid</h1><p>This approval link doesn't match a pending chart.</p>`, false);
    }

    // Terminal states
    if (row.status === "posted") {
      return page("Already posted", `<h1 class="ok">Already posted &#10003;</h1><p>This chart went out earlier.</p>
        ${row.tweet_url ? `<a class="btn gold" href="${row.tweet_url}">View the post on X</a>` : ""}`);
    }
    if (row.status === "cancelled" || row.status === "expired") {
      return page("Expired", `<h1 class="bad">This one's closed</h1><p>This chart ${row.status === "expired" ? "expired unposted" : "was cancelled"}. Tomorrow's chart will come with fresh buttons.</p>`, false);
    }

    // Same-day-ET guard: never post yesterday's chart.
    if (row.post_date !== todayET()) {
      await supabase.from(TABLE).update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", id).in("status", ["pending", "changes_requested", "approved", "failed"]);
      return page("Expired", `<h1 class="bad">This chart has expired</h1><p>It was for ${row.post_date} and only posts same-day. Nothing went out.</p>`, false);
    }

    // ----- request-changes form -----
    if (a === "changes") {
      return page("Request changes", `<h1>What should change?</h1>
        <p>Plain English is fine — the morning run will rebuild the chart and email you a fresh approval.</p>
        <div class="cap">${escapeHtml(row.caption)}</div>
        <form method="POST" action="${u.origin + u.pathname}">
          <input type="hidden" name="id" value="${id}"><input type="hidden" name="t" value="${t}">
          <textarea name="feedback" placeholder="e.g. Lead with the 2s10s number instead, and drop the second panel" required></textarea>
          <button class="btn gold" type="submit">Send changes</button>
        </form>`);
    }

    if (a === "submit_changes") {
      if (!feedback) return page("Missing", `<h1 class="bad">No feedback entered</h1><p>Go back and add a line about what to change.</p>`, false);
      await supabase.from(TABLE).update({
        status: "changes_requested", change_feedback: feedback, updated_at: new Date().toISOString(),
      }).eq("id", id).in("status", ["pending", "failed", "changes_requested"]);
      return page("Got it", `<h1 class="ok">Got it &#10003;</h1><p>A revised chart and caption will land in your inbox shortly (checker runs hourly through early afternoon). Nothing posts until you approve.</p>`);
    }

    // ----- approve -----
    if (a === "approve") {
      // One-shot claim so double-taps don't double-post.
      const { data: claimed } = await supabase.from(TABLE)
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", id).in("status", ["pending", "changes_requested", "failed"])
        .select().maybeSingle();
      if (!claimed) {
        return page("In progress", `<h1>Working on it</h1><p>This approval is already being processed — check X in a minute.</p>`);
      }

      const s = await getSecrets(["x_api_key", "x_api_secret", "x_access_token", "x_access_token_secret", "github_pat", "typefully_api_key"]);

      try {
        if (s.x_api_key && s.x_api_secret && s.x_access_token && s.x_access_token_secret) {
          const creds = { key: s.x_api_key, secret: s.x_api_secret, token: s.x_access_token, tokenSecret: s.x_access_token_secret };
          const png = await fetchChartPng(row.chart_sha, s.github_pat);
          const mediaId = await uploadMedia(png, creds);
          const post = await createPost(row.caption, mediaId, creds);
          await supabase.from(TABLE).update({
            status: "posted", tweet_id: post.id, tweet_url: post.url,
            posted_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
          }).eq("id", id);
          return page("Posted", `<h1 class="ok">Posted &#10003;</h1><p>The chart is live on @WeTheSheeple46.</p>
            <a class="btn gold" href="${post.url}">View the post on X</a>`);
        } else if (s.typefully_api_key) {
          const png = await fetchChartPng(row.chart_sha, s.github_pat);
          await typefullyPublish(row.caption, png, s.typefully_api_key);
          const url = "https://x.com/WeTheSheeple46";
          await supabase.from(TABLE).update({
            status: "posted", tweet_url: url,
            posted_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
          }).eq("id", id);
          return page("Posted", `<h1 class="ok">Publishing &#10003;</h1><p>Approved &mdash; it posts to X within ~2 minutes (queued publish; X blocks instant API posts with links).</p>
            <a class="btn gold" href="${url}">Open @WeTheSheeple46</a>`);
        } else {
          await supabase.from(TABLE).update({ status: "pending", error: "posting_not_configured", updated_at: new Date().toISOString() }).eq("id", id);
          return page("Not configured", `<h1 class="bad">Posting isn't wired up yet</h1>
            <p>Approval works, but no posting credentials are configured on the backend, so nothing went out. Once they're added, this same button will post for real.</p>`, false);
        }
      } catch (e) {
        await supabase.from(TABLE).update({ status: "failed", error: String(e).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", id);
        return page("Failed", `<h1 class="bad">Posting failed</h1><p>Nothing went out. The hourly checker will flag this; you can also tap the approve button again to retry.</p>`, false);
      }
    }

    return page("Not found", `<h1 class="bad">Unknown action</h1>`, false);
  } catch (e) {
    return page("Error", `<h1 class="bad">Something broke</h1><p>${escapeHtml(String(e)).slice(0, 200)}</p>`, false);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
