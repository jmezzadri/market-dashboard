// Edge function: send a "still investigating" nudge email to anyone whose
// bug report is >36h old, still open, and hasn't been nudged yet. Keeps the
// 48-hour SLA promise intact even when triage runs long.
//
// Called by the daily scheduled task (no request body required).
// Returns { ok: true, nudged: <count> }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { nudgeTemplate, sendEmail } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36 hours

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (auth !== expected) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    const { data: stale, error } = await supabase
      .from("bug_reports")
      .select("id, report_number, reporter_email, reporter_name")
      .in("status", ["received", "investigating", "fix-proposed"])
      .is("nudge_email_sent_at", null)
      .lte("created_at", cutoff);

    if (error) throw error;

    let nudged = 0;
    for (const r of stale ?? []) {
      try {
        const { subject, html } = nudgeTemplate({
          reportNumber: r.report_number,
          reporterName: r.reporter_name,
        });
        await sendEmail({ to: r.reporter_email, subject, html });
        await supabase
          .from("bug_reports")
          .update({ nudge_email_sent_at: new Date().toISOString() })
          .eq("id", r.id);
        nudged++;
      } catch (innerErr) {
        // eslint-disable-next-line no-console
        console.error(`[nudge-stale-bugs] failed for #${r.report_number}:`, innerErr);
      }
    }

    return json({ ok: true, nudged });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[nudge-stale-bugs] error:", err);
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
