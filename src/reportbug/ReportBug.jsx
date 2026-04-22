// ReportBug — floating button + modal for user bug reporting.
//
// v1: direct Supabase insert + storage upload. Email ack layer comes in v2 via
// a Resend edge function.
//
// Usage: drop <ReportBug/> once near the root of App.jsx. It renders its own
// fixed-position button + modal overlay.
//
// UX intent:
//   • Unobtrusive bottom-right floating button, visible to everyone
//   • One click → modal with description, email (prefilled if signed in),
//     auto-screenshot toggle (default on)
//   • Submit → row + screenshot land in Supabase, success toast, modal closes
//   • Rate-limited to 1 submission per minute via localStorage

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";
import { captureScreenshot, getRecentConsoleErrors } from "./captureScreenshot";

const RATE_LIMIT_KEY = "mt_bug_report_last_ts";
const RATE_LIMIT_MS = 60 * 1000; // 1 min

function getLastSubmitTs() {
  try { return Number(localStorage.getItem(RATE_LIMIT_KEY) || 0); } catch { return 0; }
}
function setLastSubmitTs(ts) {
  try { localStorage.setItem(RATE_LIMIT_KEY, String(ts)); } catch { /* noop */ }
}

function BugIcon({ size = 16 }) {
  // Minimal bug glyph — kept generic to match the rest of the app's icon set.
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5c1.4 0 2.5 1 2.5 2.3h-5C5.5 3.5 6.6 2.5 8 2.5z"
        fill="currentColor"
      />
      <rect x="5" y="5" width="6" height="7" rx="2.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
      <line x1="3" y1="7"  x2="5" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="3" y1="10" x2="5" y2="10"  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="3" y1="13" x2="5" y2="12"  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="13" y1="7"  x2="11" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="13" y1="10" x2="11" y2="10"  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="13" y1="13" x2="11" y2="12"  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function ReportBug() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 5000,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text-2)",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--font-ui)",
          letterSpacing: "0.02em",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          transition: "transform 120ms ease, box-shadow 120ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.12)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
        }}
      >
        <BugIcon />
        <span>Report Bug</span>
      </button>

      {open && <ReportBugModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportBugModal({ onClose }) {
  const { session } = useSession();
  const prefilledEmail = session?.user?.email || "";

  const [email, setEmail] = useState(prefilledEmail);
  const [description, setDescription] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null); // { reportNumber }
  const firstFieldRef = useRef(null);

  useEffect(() => {
    // Focus first field on open
    if (firstFieldRef.current) firstFieldRef.current.focus();
  }, []);

  useEffect(() => {
    // ESC to close
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = description.trim().length >= 10 && emailIsValid && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    // Client-side rate limit.
    const since = Date.now() - getLastSubmitTs();
    if (since < RATE_LIMIT_MS) {
      const mins = Math.ceil((RATE_LIMIT_MS - since) / 60000);
      setErrorMsg(`Please wait ~${mins} min before filing another report.`);
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Capture screenshot (if requested). Do this BEFORE rendering any
      //    "Submitting…" overlay so the capture shows the actual page state,
      //    not a modal overlay. We captured the modal in the DOM anyway,
      //    but html2canvas captures the full viewport — acceptable.
      let screenshotBlob = null;
      if (includeScreenshot) {
        screenshotBlob = await captureScreenshot();
      }

      // 2. Insert bug_reports row (returns new id + report_number).
      const payload = {
        user_id: session?.user?.id || null,
        reporter_email: email.trim(),
        reporter_name: session?.user?.user_metadata?.full_name || null,
        description: description.trim(),
        title: description.trim().split("\n")[0].slice(0, 80),
        url_hash: window.location.hash || null,
        url_full: window.location.href,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        build_sha: import.meta.env.VITE_BUILD_SHA || null,
        console_errors: getRecentConsoleErrors(),
      };

      const { data: inserted, error: insertErr } = await supabase
        .from("bug_reports")
        .insert(payload)
        .select("id, report_number")
        .single();

      if (insertErr) throw insertErr;
      const reportId = inserted.id;
      const reportNumber = inserted.report_number;

      // 3. Upload screenshot if we got one.
      if (screenshotBlob) {
        const path = `${reportId}/${Date.now()}.png`;
        const { error: uploadErr } = await supabase.storage
          .from("bug-screenshots")
          .upload(path, screenshotBlob, {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadErr) {
          // Don't fail the whole report if screenshot upload hiccups — the
          // description + context still made it in.
          // eslint-disable-next-line no-console
          console.warn("[reportbug] screenshot upload failed:", uploadErr);
        } else {
          // Best-effort update of screenshot_path. RLS blocks this UPDATE for
          // non-admin users, so this will fail silently for the reporter —
          // the scheduled task can backfill screenshot_path by listing the
          // storage bucket prefix {reportId}/ when it runs triage.
          await supabase
            .from("bug_reports")
            .update({ screenshot_path: path })
            .eq("id", reportId);
        }
      }

      // 4. Fire ack email (best-effort). If Resend isn't set up yet, the edge
      //    function will 500 — we swallow the error so the report itself
      //    still counts as filed. The scheduled triage task can backfill
      //    missed acks if needed.
      try {
        await supabase.functions.invoke("submit-bug-report", {
          body: { report_id: reportId },
        });
      } catch (ackErr) {
        // eslint-disable-next-line no-console
        console.warn("[reportbug] ack email dispatch failed (non-fatal):", ackErr);
      }

      setLastSubmitTs(Date.now());
      setSuccessInfo({ reportNumber });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[reportbug] submit failed:", err);
      setErrorMsg(
        err?.message
          ? `Submission failed: ${err.message}`
          : "Submission failed. Please try again in a moment."
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success view ────────────────────────────────────────────────────────
  if (successInfo) {
    return (
      <ModalShell onClose={onClose}>
        <div style={{ padding: "6px 4px 2px" }}>
          <div style={{
            fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.12em",
            color: "var(--accent)", marginBottom: 6,
          }}>
            REPORT FILED
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
            Thanks — we got it.
          </div>
          <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 16 }}>
            Your report <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>#{successInfo.reportNumber}</span> is
            queued for triage. We'll email{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{email.trim()}</span>{" "}
            within 48 hours with a status update.
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--accent)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  // ── Form view ────────────────────────────────────────────────────────────
  return (
    <ModalShell onClose={onClose} disableClose={submitting}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{
            fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.12em",
            color: "var(--text-dim)", marginBottom: 4,
          }}>
            REPORT A BUG
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
            Something broken or confusing?
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, lineHeight: 1.5 }}>
            Describe what you were doing and what happened. We'll reply within 48 hours.
          </div>
        </div>

        {/* Description */}
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{
            fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em",
            color: "var(--text-dim)",
          }}>
            WHAT HAPPENED <span style={{ color: "var(--red)" }}>*</span>
          </span>
          <textarea
            ref={firstFieldRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Clicked 'Add to watchlist' with 13 tickers and got a red error about ON CONFLICT."
            rows={5}
            required
            minLength={10}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              lineHeight: 1.5,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </label>

        {/* Email */}
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{
            fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em",
            color: "var(--text-dim)",
          }}>
            YOUR EMAIL <span style={{ color: "var(--red)" }}>*</span>
            {prefilledEmail && (
              <span style={{ color: "var(--text-dim)", fontWeight: 400, marginLeft: 6 }}>
                (from your account — edit if needed)
              </span>
            )}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              boxSizing: "border-box",
            }}
          />
        </label>

        {/* Screenshot toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeScreenshot}
            onChange={(e) => setIncludeScreenshot(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            Include a screenshot of what I'm looking at
          </span>
        </label>

        {/* Error banner */}
        {errorMsg && (
          <div style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: "var(--red-bg, rgba(255,69,58,0.1))",
            border: "1px solid var(--red, #ff453a)",
            color: "var(--red-text, #ff453a)",
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            {errorMsg}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-2)",
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--accent)",
              background: canSubmit ? "var(--accent)" : "var(--surface-3)",
              color: canSubmit ? "white" : "var(--text-dim)",
              fontSize: 13,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              minWidth: 96,
            }}
          >
            {submitting ? "Sending…" : "Submit report"}
          </button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
          We auto-capture the current URL, browser, viewport, and recent errors to help us reproduce. No passwords or payment info is collected.
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, disableClose }) {
  return (
    <div
      onClick={() => { if (!disableClose) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 6000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Report a bug"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 22,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          disabled={disableClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: disableClose ? "not-allowed" : "pointer",
            borderRadius: 6,
          }}
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}
