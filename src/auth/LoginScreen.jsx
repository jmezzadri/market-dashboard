// LoginScreen — email + 6-digit code sign-in, styled to match the rest of the
// Apple-tone dashboard. Lives inside the app frame (Hero + Sidebar stay visible);
// the ProtectedRoute wrapper renders this in place of the gated tab content.
//
// Flow:
//   1) User enters email, clicks "Send code".
//   2) Supabase emails a 6-digit code (template variable {{ .Token }}).
//   3) User types the code here; we call supabase.auth.verifyOtp.
//   4) On success, onAuthStateChange fires in useSession and the gate drops.
//
// Why code-entry instead of clicking the magic link?
//   Gmail / Google Workspace safe-browsing scanners pre-fetch URLs in incoming
//   mail, which redeems the single-use magic-link token before the user can
//   click — producing `otp_expired` on return (seen live on macrotilt.com).
//   A 6-digit code has no URL for a scanner to fetch, so it's immune to this.
//   The email still includes the magic link as a fallback for users who prefer
//   clicking; either path works.

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

// Read Supabase auth error params from the URL (e.g. after a failed magic-link
// click, Supabase redirects back with ?error=access_denied&error_code=otp_expired
// &error_description=Email+link+is+invalid+or+has+expired). We surface these
// inline so the user can see *why* the link didn't work rather than silently
// bouncing back to the sign-in CTA.
function readAuthUrlError() {
  if (typeof window === "undefined") return null;
  const qs   = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const src  = qs.get("error") ? qs : hash.get("error") ? hash : null;
  if (!src) return null;
  return {
    error:       src.get("error"),
    errorCode:   src.get("error_code"),
    description: src.get("error_description"),
  };
}

// Strip the Supabase error params from the URL so a page refresh doesn't
// keep showing the banner after the user acts on it.
function clearAuthUrlError() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["error", "error_code", "error_description"].forEach((k) => url.searchParams.delete(k));
  url.hash = "";
  window.history.replaceState({}, "", url.toString());
}

export default function LoginScreen() {
  const [email, setEmail]       = useState("");
  const [code, setCode]         = useState("");
  // idle → sending → sent → verifying → error/(success removes screen)
  const [status, setStatus]     = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [urlErr, setUrlErr]     = useState(null);

  // On mount, pick up any Supabase error params from a bounced magic-link click.
  useEffect(() => {
    const parsed = readAuthUrlError();
    if (parsed) setUrlErr(parsed);
  }, []);

  const onSendEmail = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        // Magic-link fallback: if the user chooses to click the link instead of
        // typing the code, Supabase will redirect here with #access_token=... and
        // the client picks it up via detectSessionInUrl (see supabase.js).
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Something went wrong. Please try again.");
    } else {
      setStatus("sent");
      setCode("");
    }
  };

  const onVerifyCode = async (e) => {
    e.preventDefault();
    const trimmedCode  = code.trim();
    const trimmedEmail = email.trim();
    if (!trimmedCode || !trimmedEmail) return;

    setStatus("verifying");
    setErrorMsg("");

    // `type: "email"` matches Supabase's email OTP — same token works whether it
    // was delivered as a click-link (ConfirmationURL) or a 6-digit code (Token).
    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: "email",
    });

    if (error) {
      setStatus("sent"); // stay on code-entry screen so user can retry
      setErrorMsg(error.message || "Invalid or expired code. Request a new one.");
    }
    // On success, onAuthStateChange in useSession will flip session !== null
    // and ProtectedRoute will render the gated content. Nothing to do here.
  };

  // Wrapper style — mirrors the .card tone used across the dashboard so the
  // login screen doesn't feel grafted on.
  const card = {
    maxWidth: 460,
    margin: "min(12vh, 96px) auto",
    padding: "var(--space-7) var(--space-7) var(--space-6)",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-sm)",
  };

  const inputBase = {
    width: "100%",
    padding: "12px 14px",
    fontSize: 14,
    color: "var(--text)",
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-ui)",
    outline: "none",
  };

  const primaryBtn = (disabled) => ({
    marginTop: 14,
    width: "100%",
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "opacity 0.15s",
  });

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      <div style={card}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 6 }}>
          SIGN IN REQUIRED
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
          Sign in to view portfolio data
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 24px" }}>
          Portfolio & Insights is private to each user. Enter your email and we'll send
          a 6-digit sign-in code. No password required.
        </p>

        {!isSupabaseConfigured && (
          <div style={{ padding: 12, marginBottom: 16, background: "rgba(255, 149, 0, 0.1)", border: "1px solid rgba(255, 149, 0, 0.3)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)" }}>
            Supabase is not configured (missing env vars). Contact the admin.
          </div>
        )}

        {urlErr && (
          <div style={{ padding: 12, marginBottom: 16, background: "rgba(255, 59, 48, 0.08)", border: "1px solid rgba(255, 59, 48, 0.3)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              That sign-in link didn't work
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              {urlErr.description
                ? urlErr.description.replace(/\+/g, " ")
                : `Auth error: ${urlErr.errorCode || urlErr.error}.`}
              {" "}Enter your email below and sign in with the 6-digit code instead —
              it can't be pre-fetched by Gmail's link scanner.
            </div>
            <button
              type="button"
              onClick={() => { clearAuthUrlError(); setUrlErr(null); }}
              style={{
                marginTop: 10,
                padding: "6px 10px",
                fontSize: 11,
                color: "var(--text-muted)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {status === "sent" || status === "verifying" ? (
          // Step 2: code entry.
          <form onSubmit={onVerifyCode}>
            <div style={{ padding: 14, marginBottom: 16, background: "rgba(52, 199, 89, 0.08)", border: "1px solid rgba(52, 199, 89, 0.25)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below to sign in.
              </div>
            </div>

            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 6 }}>
              6-DIGIT CODE
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              disabled={status === "verifying" || !isSupabaseConfigured}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{
                ...inputBase,
                fontSize: 20,
                letterSpacing: "0.3em",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}
            />
            <button
              type="submit"
              disabled={status === "verifying" || !isSupabaseConfigured || code.length !== 6}
              style={primaryBtn(status === "verifying" || code.length !== 6)}
            >
              {status === "verifying" ? "Verifying…" : "Sign in"}
            </button>
            {errorMsg && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setStatus("idle"); setCode(""); setErrorMsg(""); }}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={(e) => { setCode(""); setErrorMsg(""); onSendEmail(e); }}
                disabled={status === "verifying"}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                Resend code
              </button>
            </div>
          </form>
        ) : (
          // Step 1: email entry.
          <form onSubmit={onSendEmail}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 6 }}>
              EMAIL
            </label>
            <input
              type="email"
              required
              autoFocus
              disabled={status === "sending" || !isSupabaseConfigured}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputBase}
            />
            <button
              type="submit"
              disabled={status === "sending" || !isSupabaseConfigured || !email.trim()}
              style={primaryBtn(status === "sending" || !email.trim() || !isSupabaseConfigured)}
            >
              {status === "sending" ? "Sending…" : "Send code"}
            </button>
            {status === "error" && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}
          </form>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Only the Portfolio & Insights tab requires sign-in. The macro dashboard, indicators, sectors, scanner, and methodology are public.
        </div>
      </div>
    </main>
  );
}
