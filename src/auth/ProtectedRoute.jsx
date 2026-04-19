// ProtectedRoute — renders its children only when the user has a Supabase session.
// Otherwise renders <LoginScreen/>. Used to gate the Portfolio & Insights tab
// per Track B scope doc (§ Decisions locked in — "Soft login gate").
//
// Usage:
//   <ProtectedRoute>
//     {portoppsContent}
//   </ProtectedRoute>

import { useSession } from "./useSession";
import LoginScreen from "./LoginScreen";

export default function ProtectedRoute({ children }) {
  const { session, loading } = useSession();

  // While we're resolving the initial session, render nothing — avoids a
  // brief "login screen flash" for already-authenticated users on page load.
  if (loading) {
    return (
      <main className="fade-in main-padded" style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)", minHeight: 200 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
          …
        </div>
      </main>
    );
  }

  if (!session) return <LoginScreen />;
  return children;
}
