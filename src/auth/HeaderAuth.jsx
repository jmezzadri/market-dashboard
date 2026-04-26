// HeaderAuth — small "Sign in" CTA rendered in the page-level Hero top row.
//
// Why this exists:
//   The only sign-in entry point used to be the gated Portfolio tab. Joe wanted
//   a top-of-page CTA so users don't have to navigate to Portfolio first to find
//   the login. Clicking this button drops them on #portopps where ProtectedRoute
//   renders LoginScreen for unauthenticated visitors.
//
// Visibility rules:
//   - Hidden when a Supabase session exists (SidebarAuth already shows
//     "signed in as ..." + Sign out — no point duplicating it up top).
//   - Hidden when Supabase is not configured (env vars missing on this build).
//   - Hidden while the initial session check is loading — avoids a flicker of
//     "Sign in" for already-authenticated users on page load.
//
// Styling matches the Hero top row (compact, muted, sits beside ThemeToggle).
// When signed in, the sidebar footer is the source of truth for auth state.

import { isSupabaseConfigured } from "../lib/supabase";
import { Tip } from "../InfoTip";
import { useSession } from "./useSession";

export default function HeaderAuth() {
  const { session, loading } = useSession();

  if (!isSupabaseConfigured) return null;
  if (loading) return null;
  if (session) return null;

  const onClick = () => {
    // Single-click UX: jump straight to the 6-digit code-entry LoginScreen,
    // bypassing the portopps preview screen. We route to #portopps so the
    // Portfolio tab is active, AND dispatch macrotilt:open-login so App.jsx
    // flips showPortoppsLogin=true. After sign-in they land directly on
    // the Portfolio tab (which is the point of signing in anyway).
    window.location.hash = "portopps";
    window.dispatchEvent(new Event("macrotilt:open-login"));
  };

  return (
    <Tip def="Sign in to view your portfolio"><button onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text)",
        background: "var(--surface-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "6px 12px",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        letterSpacing: "0.02em",
        transition: "background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "var(--hover)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "var(--surface-3)";
      }}>
      Sign in
    </button></Tip>
  );
}
