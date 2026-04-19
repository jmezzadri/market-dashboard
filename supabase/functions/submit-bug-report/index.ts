// Edge function: send the acknowledgment email for a just-filed bug report.
//
// Called by the client AFTER it has inserted the bug_reports row. We look up
// the row by id, send the ack via Resend, and stamp ack_email_sent_at.
//
// Why a separate function (instead of insert-from-the-function): keeping the
// row-creation on the client lets us use RLS for spoof protection and keeps
// the screenshot upload path simple. The email hop is the only server-only
// piece that needs secrets, so this function is thin.
//
// Request body: { report_id: "uuid" }
// Response:     { ok: true } | { ok: false, error: "..." }
//
// Deploy:
//   supabase functions deploy submit-bug-report --no-verify-jwt
// (We allow anon calls because the reporter may not be signed in; the function
// itself authenticates with service_role against the DB to read/update the row.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { ackTemplate, sendEmail } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const { report_id } = await req.json();
    if (!report_id || typeof report_id !== "string") {
      return json({ ok: false, error: "Missing report_id" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: report, error: fetchErr } = await supabase
      .from("bug_reports")
      .select("id, report_number, description, reporter_email, reporter_name, ack_email_sent_at")
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) {
      return json({ ok: false, error: "Report not found" }, 404);
    }

    // Idempotency: if we already sent the ack, don't resend.
    if (report.ack_email_sent_at) {
      return json({ ok: true, already_sent: true });
    }

    const { subject, html } = ackTemplate({
      reportNumber: report.report_number,
      description: report.description,
      reporterName: report.reporter_name,
    });

    await sendEmail({ to: report.reporter_email, subject, html });

    await supabase
      .from("bug_reports")
      .update({ ack_email_sent_at: new Date().toISOString() })
      .eq("id", report_id);

    return json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[submit-bug-report] error:", err);
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
