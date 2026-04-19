// LoginScreen — Google OAuth (primary) + email/6-digit-code (fallback).
//
// Two sign-in paths, picked by the user:
//
// 1) CONTINUE WITH GOOGLE
//    One click → Supabase/Google OAuth → returns signed in. Zero friction for
//    Gmail / Google Workspace users (most F&F).
//
// 2) SIGN IN WITH EMAIL CODE (fallback for users without Google)
//    Enter email → Supabase emails a 6-digit code → type the code → signed in.
//    Users stay signed in on their device via Supabase refresh tokens
//    (`persistSession: true`), so the code is entered ONCE per device, not
//    every visit.
//
// Why the 6-digit code instead of a magic-link click?
//   Gmail / Google Workspace safe-browsing scanners pre-fetch URLs in incoming
//   mail, which redeems the single-use magic-link token before the user can
//   click — producing `otp_expired` on return (seen live on macrotilt.com).
//   A 6-digit code has no URL for a scanner to fetch, so it's immune to this.
//   We intentionally DO NOT pass `emailRedirectTo` anymore; the Supabase email
//   template is configured to render the {{ .Token }} only (no magic link).

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

  const onSignInGoogle = async () => {
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Where Google redirects back after successful auth. We land on the
        // same page and useSession picks up the session automatically.
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Could not start Google sign-in.");
    }
    // Success path: the browser navigates to Google — nothing to handle here.
  };

  const onSendEmail = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus("sending");
    setErrorMsg("");

    // No `emailRedirectTo` — we don't want a magic-link URL in the email at
    // all (Gmail pre-fetch burns the token). The Supabase email template is
    // configured to render `{{ .Token }}` only.
    const { error } = await supabase.auth.signInWithOtp({ email: trimmed });

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
          Portfolio & Insights is private to each user. One click with Google, or get a
          6-digit sign-in code by email. You'll stay signed in on this device.
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
          // Step 1: pick Google OAuth or email.
          <>
            {/* Primary: Google OAuth */}
            <button
              type="button"
              onClick={onSignInGoogle}
              disabled={status === "sending" || !isSupabaseConfigured}
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: (status === "sending" || !isSupabaseConfigured) ? "wait" : "pointer",
                opacity: (status === "sending" || !isSupabaseConfigured) ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              {/* Google "G" mark — inline SVG to avoid an asset fetch */}
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
                <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
                <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
                <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
              </svg>
              {status === "sending" ? "Signing in…" : "Continue with Google"}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 16px" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border-faint)" }} />
              <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", fontWeight: 600 }}>
                OR EMAIL CODE
              </div>
              <div style={{ flex: 1, height: 1, background: "var(--border-faint)" }} />
            </div>

            {/* Fallback: email → 6-digit code */}
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
          </>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Only the Portfolio & Insights tab requires sign-in. The macro dashboard, indicators, sectors, scanner, and methodology are public.
        </div>
      </div>
    </main>
  );
}
