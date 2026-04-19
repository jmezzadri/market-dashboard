// SidebarAuth — footer slot rendered inside the left Sidebar component.
// Shows the signed-in user's email + a Sign out button, or a muted "Not signed in"
// hint + hint that portfolio tabs require sign-in. Falls back to the legacy
// version tag if Supabase is not configured (env missing).

import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { useSession } from "./useSession";

export default function SidebarAuth() {
  const { session, user, loading } = useSession();

  if (!isSupabaseConfigured) {
    return <span>v10 · {new Date().getFullYear()}</span>;
  }
  if (loading) return <span>…</span>;

  const onSignOut = async () => {
    await supabase.auth.signOut();
    // After sign-out, drop the user back on Home if they were on a gated tab.
    if (window.location.hash === "#portopps") {
      window.location.hash = "home";
    }
  };

  if (!session) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
        <div style={{ marginBottom: 4 }}>Not signed in</div>
        <div style={{ fontSize: 10, opacity: 0.8 }}>
          Portfolio tabs require sign-in.
        </div>
      </div>
    );
  }

  const email = user?.email || "signed in";
  // Truncate long emails in the narrow sidebar column.
  const shortEmail = email.length > 22 ? email.slice(0, 20) + "…" : email;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <div
        title={email}
        style={{
          fontSize: 11,
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {shortEmail}
      </div>
      <button
        onClick={onSignOut}
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          background: "transparent",
          border: "1px solid var(--border-faint)",
          borderRadius: 4,
          padding: "3px 8px",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          letterSpacing: "0.04em",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
