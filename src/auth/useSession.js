// useSession — React hook that tracks the current Supabase auth session.
//
// Returns:
//   session : Session | null
//   loading : true while we're doing the initial getSession() call, false after
//   user    : session?.user ?? null (convenience)
//
// Usage:
//   const { session, user, loading } = useSession();
//   if (loading) return null;
//   if (!session) return <LoginScreen/>;
//
// The hook subscribes to supabase.auth.onAuthStateChange so it reacts to sign-in,
// sign-out, token refresh, and magic-link-in-URL events automatically.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Initial snapshot. `detectSessionInUrl: true` means this call will also
    // pick up the `#access_token=...` fragment on a magic-link return.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    // Subscribe to future changes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}
