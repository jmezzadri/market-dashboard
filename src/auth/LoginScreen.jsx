// LoginScreen — email + password sign-in (primary), with a code-by-email
// fallback for password reset / first-time signup / users who prefer
// passwordless.
//
// Three modes in the UI, picked by the user:
//
//   "signin"  — email + password → supabase.auth.signInWithPassword. The
//               default. Password managers autofill this, so it's one click
//               after the first visit.
//
//   "signup"  — email + password + confirm → supabase.auth.signUp. If the
//               Supabase project has "Confirm email" turned OFF (recommended,
//               see note below), the user is signed in immediately. If ON,
//               Supabase sends a confirmation link — Gmail's safe-browsing
//               scanner will pre-fetch and burn that token, so we strongly
//               advise turning email confirmation off.
//
//   "code"    — email → 6-digit code → supabase.auth.verifyOtp. Works as:
//                 a) a passwordless alternative for users who don't want to
//                    make up a password,
//                 b) the password-reset path (same code endpoint; once signed
//                    in, the user can change their password in their profile).
//
// Why the 6-digit code instead of a magic-link click?
//   Gmail / Workspace safe-browsing pre-fetches URLs in incoming mail, which
//   redeems single-use magic-link tokens before the user clicks → otp_expired.
//   A 6-digit code has no URL to pre-fetch.
//
// REQUIRED Supabase dashboard setting for this to be frictionless:
//   Authentication → Sign In / Providers → Email → "Confirm email": OFF.
//   With this off, signUp returns a session immediately (no email click). The
//   6-digit code path still works independently for passwordless / reset.

import { useEffect, useState } from "react";
import { Monogram, Wordmark } from "../components/Logo";
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
  // Which form are we showing?
  //   "signin"   — email + password (existing user)
  //   "signup"   — email + password + confirm (new account)
  //   "code"     — email → "Send code"
  //   "codeSent" — code entry after Send code
  const [mode, setMode]         = useState("signin");

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [passwordConf, setPasswordConf] = useState("");
  const [code, setCode]               = useState("");

  // idle → sending → verifying → error/(success removes screen)
  const [status, setStatus]     = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg]   = useState("");
  const [urlErr, setUrlErr]     = useState(null);

  // On mount, pick up any Supabase error params from a bounced magic-link click.
  useEffect(() => {
    const parsed = readAuthUrlError();
    if (parsed) setUrlErr(parsed);
  }, []);

  // Reset transient state when the user switches modes so stale error banners
  // from one path don't bleed into another.
  const switchMode = (next) => {
    setMode(next);
    setStatus("idle");
    setErrorMsg("");
    setInfoMsg("");
    if (next !== "codeSent") setCode("");
    if (next !== mode) setPassword("");
    if (next !== mode) setPasswordConf("");
  };

  // ---- handlers ----------------------------------------------------------

  const onSignIn = async (e) => {
    e.preventDefault();
    const em = email.trim();
    if (!em || !password) return;
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithPassword({
      email: em,
      password,
    });
    if (error) {
      setStatus("error");
      // Supabase returns "Invalid login credentials" — keep but clarify.
      setErrorMsg(
        /invalid login/i.test(error.message)
          ? "Email or password is incorrect. If you're new here, click \"Create one\" below."
          : error.message || "Could not sign in."
      );
    }
    // Success: onAuthStateChange flips session; ProtectedRoute renders gated UI.
  };

  const onSignUp = async (e) => {
    e.preventDefault();
    const em = email.trim();
    if (!em || !password) return;
    if (password.length < 6) {
      setStatus("error");
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (password !== passwordConf) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }
    setStatus("sending");
    setErrorMsg("");
    const { data, error } = await supabase.auth.signUp({
      email: em,
      password,
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Could not create account.");
      return;
    }
    // If "Confirm email" is OFF in Supabase, we get a session here and the
    // auth state listener takes over. If ON, data.session is null — tell
    // the user to check their mail (and warn about the prefetch problem).
    if (!data?.session) {
      setStatus("idle");
      setInfoMsg(
        "Account created. Check your email for a confirmation link to finish signing in. " +
        "(If the link says \"expired\", ask the admin to turn off email confirmation in the Supabase dashboard.)"
      );
      switchMode("signin");
    }
  };

  const onSendCode = async (e) => {
    e.preventDefault();
    const em = email.trim();
    if (!em) return;
    setStatus("sending");
    setErrorMsg("");
    // No `emailRedirectTo` — we don't want a magic-link URL (Gmail pre-fetch
    // would burn the token). The Supabase email template is configured to
    // render `{{ .Token }}` only.
    const { error } = await supabase.auth.signInWithOtp({ email: em });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Could not send code.");
    } else {
      setStatus("idle");
      setMode("codeSent");
    }
  };

  const onVerifyCode = async (e) => {
    e.preventDefault();
    const tc = code.trim();
    const em = email.trim();
    if (!tc || !em) return;
    setStatus("verifying");
    setErrorMsg("");
    const { error } = await supabase.auth.verifyOtp({
      email: em,
      token: tc,
      type: "email",
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Invalid or expired code. Request a new one.");
    }
    // Success: onAuthStateChange takes over.
  };

  // Google OAuth — gated off because the Google provider isn't enabled in the
  // Supabase project (requires Google Cloud OAuth client setup). Left here so
  // re-enabling is just wiring this onto a button. See file header comment.
  // eslint-disable-next-line no-unused-vars
  const _onSignInGoogle = async () => {
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Could not start Google sign-in.");
    }
  };

  // ---- styling -----------------------------------------------------------

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
    // box-sizing: border-box is critical — without it, width:100% + padding +
    // border made the inputs render wider than the card, so text bumped right
    // against (or past) the borders. Joe flagged 2026-04-27.
    boxSizing: "border-box",
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

  const label = {
    display: "block",
    fontSize: 12,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.06em",
    marginTop: 14,
    marginBottom: 6,
  };

  const primaryBtn = (disabled) => ({
    marginTop: 18,
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

  const linkBtn = {
    padding: "4px 0",
    fontSize: 13,
    color: "var(--accent)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
    fontFamily: "inherit",
  };

  // ---- render ------------------------------------------------------------

  const busy = status === "sending" || status === "verifying";
  const disabledInputs = busy || !isSupabaseConfigured;

  // Intro text varies by mode so the hero copy matches the form below it.
  const intro = {
    signin:
      "Portfolio & Insights is private to each user. Sign in with your email and password — your browser can save it so next time is one click.",
    signup:
      "Create an account with your email and a password. You'll stay signed in on this device after signup.",
    code:
      "We'll email you a 6-digit sign-in code. Use this for first-time signup, password reset, or if you'd rather not set a password at all.",
    codeSent:
      "Check your email for a 6-digit code and enter it below.",
  }[mode];

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      {/* Brand wordmark above the sign-in card */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: "min(8vh, 64px)" }}>
        <span className="login-brand-logo" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Monogram size={40} color="var(--accent, #d9b27a)" />
          <Wordmark size={17} />
        </span>
      </div>
      <div style={{ ...card, margin: "var(--space-5) auto 0" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 6 }}>
          {mode === "signup" ? "CREATE ACCOUNT" : mode === "code" || mode === "codeSent" ? "EMAIL CODE" : "SIGN IN REQUIRED"}
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
          {mode === "signup" ? "Create your account" :
           mode === "code" ? "Sign in with an email code" :
           mode === "codeSent" ? "Enter your 6-digit code" :
           "Sign in to view portfolio data"}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 24px" }}>
          {intro}
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
              {" "}Sign in below with your email and password, or request a 6-digit code.
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

        {infoMsg && (
          <div style={{ padding: 12, marginBottom: 16, background: "rgba(52, 199, 89, 0.08)", border: "1px solid rgba(52, 199, 89, 0.25)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
            {infoMsg}
          </div>
        )}

        {/* --- SIGN IN (email + password) --- */}
        {mode === "signin" && (
          <form onSubmit={onSignIn}>
            <label style={{ ...label, marginTop: 0 }}>EMAIL</label>
            <input
              type="email"
              autoComplete="email"
              required
              autoFocus
              disabled={disabledInputs}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputBase}
            />
            <label style={label}>PASSWORD</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              disabled={disabledInputs}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputBase}
            />
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !email.trim() || !password}
              style={primaryBtn(busy || !email.trim() || !password || !isSupabaseConfigured)}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {errorMsg && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap", gap: 8 }}>
              <span>
                First time?{" "}
                <button type="button" onClick={() => switchMode("signup")} style={linkBtn}>
                  Create one
                </button>
              </span>
              <button type="button" onClick={() => switchMode("code")} style={linkBtn}>
                Forgot password / use email code
              </button>
            </div>
          </form>
        )}

        {/* --- SIGN UP (email + password + confirm) --- */}
        {mode === "signup" && (
          <form onSubmit={onSignUp}>
            <label style={{ ...label, marginTop: 0 }}>EMAIL</label>
            <input
              type="email"
              autoComplete="email"
              required
              autoFocus
              disabled={disabledInputs}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputBase}
            />
            <label style={label}>PASSWORD (6+ chars)</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              disabled={disabledInputs}
              placeholder="Choose a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputBase}
            />
            <label style={label}>CONFIRM PASSWORD</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              disabled={disabledInputs}
              placeholder="Type it again"
              value={passwordConf}
              onChange={(e) => setPasswordConf(e.target.value)}
              style={inputBase}
            />
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !email.trim() || password.length < 6}
              style={primaryBtn(busy || !email.trim() || password.length < 6 || !isSupabaseConfigured)}
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
            {errorMsg && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")} style={linkBtn}>
                Sign in
              </button>
            </div>
          </form>
        )}

        {/* --- CODE: email entry --- */}
        {mode === "code" && (
          <form onSubmit={onSendCode}>
            <label style={{ ...label, marginTop: 0 }}>EMAIL</label>
            <input
              type="email"
              autoComplete="email"
              required
              autoFocus
              disabled={disabledInputs}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputBase}
            />
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured || !email.trim()}
              style={primaryBtn(busy || !email.trim() || !isSupabaseConfigured)}
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
            {errorMsg && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}>
              <button type="button" onClick={() => switchMode("signin")} style={linkBtn}>
                ← Back to password sign-in
              </button>
            </div>
          </form>
        )}

        {/* --- CODE: enter the 6-digit code --- */}
        {mode === "codeSent" && (
          <form onSubmit={onVerifyCode}>
            <div style={{ padding: 14, marginBottom: 8, background: "rgba(52, 199, 89, 0.08)", border: "1px solid rgba(52, 199, 89, 0.25)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              We sent a 6-digit code to <strong>{email}</strong>.
            </div>

            <label style={label}>6-DIGIT CODE</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              disabled={disabledInputs}
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
              disabled={busy || !isSupabaseConfigured || code.length !== 6}
              style={primaryBtn(busy || code.length !== 6 || !isSupabaseConfigured)}
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
            {errorMsg && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => switchMode("code")}
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
                onClick={(e) => { setCode(""); setErrorMsg(""); onSendCode(e); }}
                disabled={busy}
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
              <button
                type="button"
                onClick={() => switchMode("signin")}
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
                Use password instead
              </button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Only the Portfolio & Insights tab requires sign-in. The macro dashboard, indicators, sectors, scanner, and methodology are public.
        </div>
      </div>
    </main>
  );
}
