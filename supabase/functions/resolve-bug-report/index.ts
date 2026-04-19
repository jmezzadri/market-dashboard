// Edge function: send the resolution email and mark a bug report resolved.
//
// Called by the daily triage scheduled task when it detects a bugfix branch
// has been merged to main. Can also be invoked manually by Joe.
//
// Request body:
//   {
//     report_id: "uuid",
//     resolution_note?: "short plain-text summary of what we fixed"
//   }
// Response: { ok: true } | { ok: false, error: "..." }
//
// Requires service-role auth (callable only with SUPABASE_SERVICE_ROLE_KEY
// in the Authorization header). The scheduled task has this key. If we later
// want Joe to trigger it from a hidden admin UI, gate on admin auth there.
//
// Deploy:
//   supabase functions deploy resolve-bug-report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolutionTemplate, sendEmail } from "../_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Auth: require service-role bearer (so this can't be called by a random visitor).
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (auth !== expected) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const { report_id, resolution_note } = await req.json();
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
      .select("id, report_number, description, reporter_email, reporter_name, resolution_email_sent_at, status")
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) return json({ ok: false, error: "Report not found" }, 404);

    if (report.resolution_email_sent_at) {
      return json({ ok: true, already_sent: true });
    }

    const { subject, html } = resolutionTemplate({
      reportNumber: report.report_number,
      description: report.description,
      resolutionNote: resolution_note ?? null,
      reporterName: report.reporter_name,
    });

    await sendEmail({ to: report.reporter_email, subject, html });

    await supabase
      .from("bug_reports")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_email_sent_at: new Date().toISOString(),
        triage_notes: resolution_note
          ? (report.triage_notes ? `${report.triage_notes}\n\nResolved: ${resolution_note}` : `Resolved: ${resolution_note}`)
          : undefined,
      })
      .eq("id", report_id);

    return json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[resolve-bug-report] error:", err);
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
