// Shared Resend email helper for MacroTilt transactional emails.
//
// Reads RESEND_API_KEY from the edge function env. Set via:
//   supabase secrets set RESEND_API_KEY=re_...
//
// Sends from noreply@send.macrotilt.com — the DKIM record is published at
// resend._domainkey.send.macrotilt.com (Porkbun DNS), and Resend's dashboard
// shows send.macrotilt.com as the verified sending domain, not the apex.
// Sending from @macrotilt.com would fail DKIM.
// Replies route to Joe's inbox so reporters who just hit reply get a human.

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "MacroTilt Support <noreply@send.macrotilt.com>";
const REPLY_TO = "josephmezzadri@gmail.com";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailArgs) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not set in function secrets");
  }

  const resp = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      reply_to: REPLY_TO,
      subject,
      html,
      text: text ?? stripHtml(html),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }
  return await resp.json();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Email templates ────────────────────────────────────────────────────────

export function ackTemplate(args: {
  reportNumber: number;
  description: string;
  reporterName?: string | null;
}): { subject: string; html: string } {
  const who = args.reporterName ? args.reporterName.split(" ")[0] : "there";
  const short = args.description.slice(0, 140) + (args.description.length > 140 ? "…" : "");
  const subject = `We got your bug report #${args.reportNumber}`;
  const html = `
<p>Hi ${esc(who)},</p>

<p>Thanks for reporting this — your bug report <strong>#${args.reportNumber}</strong> is queued for triage.</p>

<p>Here's what we have on record:</p>
<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555; margin: 12px 0;">${esc(short)}</blockquote>

<p>We'll email you back within <strong>48 hours</strong> with a status update. If we need more detail to reproduce, we'll ask. If we've shipped a fix, you'll get a heads-up to refresh and try again.</p>

<p>— The MacroTilt team</p>

<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;"/>
<p style="font-size: 12px; color: #888;">You're receiving this because you reported a bug on macrotilt.com. Reply to this email to add more detail.</p>
`;
  return { subject, html };
}

export function nudgeTemplate(args: {
  reportNumber: number;
  reporterName?: string | null;
}): { subject: string; html: string } {
  const who = args.reporterName ? args.reporterName.split(" ")[0] : "there";
  const subject = `Quick update on bug report #${args.reportNumber}`;
  const html = `
<p>Hi ${esc(who)},</p>

<p>Quick note on bug report <strong>#${args.reportNumber}</strong>: we're still investigating and wanted to keep you in the loop. No action needed on your end.</p>

<p>We'll send another update as soon as we have either a fix or a clarifying question. Thanks for your patience.</p>

<p>— The MacroTilt team</p>
`;
  return { subject, html };
}

export function resolutionTemplate(args: {
  reportNumber: number;
  description: string;
  resolutionNote?: string | null;
  reporterName?: string | null;
}): { subject: string; html: string } {
  const who = args.reporterName ? args.reporterName.split(" ")[0] : "there";
  const short = args.description.slice(0, 140) + (args.description.length > 140 ? "…" : "");
  const subject = `Fixed: bug report #${args.reportNumber}`;
  const note = args.resolutionNote
    ? `<p>What we did:</p><blockquote style="border-left: 3px solid #34c759; padding-left: 12px; color: #555; margin: 12px 0;">${esc(args.resolutionNote)}</blockquote>`
    : "";
  const html = `
<p>Hi ${esc(who)},</p>

<p>Good news — we shipped a fix for bug report <strong>#${args.reportNumber}</strong>.</p>

<p>Original report:</p>
<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555; margin: 12px 0;">${esc(short)}</blockquote>

${note}

<p>Please refresh macrotilt.com and try again. If you still see the issue, just reply to this email and we'll re-open the investigation.</p>

<p>Thanks for helping us make the product better.</p>

<p>— The MacroTilt team</p>
`;
  return { subject, html };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
