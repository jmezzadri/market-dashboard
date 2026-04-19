// LoginScreen — email magic-link sign-in, styled to match the rest of the
// Apple-tone dashboard. Lives inside the app frame (Hero + Sidebar stay visible);
// the ProtectedRoute wrapper renders this in place of the gated tab content.

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        // Magic-link click returns the user to the same page they signed in from.
        // On return, the Supabase client reads the hash fragment and establishes
        // the session automatically (detectSessionInUrl: true in supabase.js).
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message || "Something went wrong. Please try again.");
    } else {
      setStatus("sent");
    }
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
          a one-time sign-in link. No password required.
        </p>

        {!isSupabaseConfigured && (
          <div style={{ padding: 12, marginBottom: 16, background: "rgba(255, 149, 0, 0.1)", border: "1px solid rgba(255, 149, 0, 0.3)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)" }}>
            Supabase is not configured (missing env vars). Contact the admin.
          </div>
        )}

        {status !== "sent" ? (
          <form onSubmit={onSubmit}>
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
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: 14,
                color: "var(--text)",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-ui)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={status === "sending" || !isSupabaseConfigured || !email.trim()}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "12px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: status === "sending" ? "wait" : "pointer",
                opacity: status === "sending" || !email.trim() || !isSupabaseConfigured ? 0.6 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--danger, #ff3b30)" }}>
                {errorMsg}
              </div>
            )}
          </form>
        ) : (
          <div>
            <div style={{ padding: 16, background: "rgba(52, 199, 89, 0.08)", border: "1px solid rgba(52, 199, 89, 0.25)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                Check your email
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email}</strong>.
                Click it on this device to finish signing in.
              </div>
            </div>
            <button
              onClick={() => { setStatus("idle"); setEmail(""); }}
              style={{
                marginTop: 14,
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
          </div>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Only the Portfolio & Insights tab requires sign-in. The macro dashboard, indicators, sectors, scanner, and methodology are public.
        </div>
      </div>
    </main>
  );
}
