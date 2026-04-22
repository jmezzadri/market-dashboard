// useIsAdmin — React hook that checks whether the current Supabase session
// belongs to an admin (row exists in public.admin_users).
//
// Gating contract:
//   - Calls public.is_admin() RPC (SECURITY DEFINER, see migration 011).
//   - Returns false when not signed in or not in the allowlist — safe default.
//   - Re-runs when the session's user.id changes (sign-in / sign-out).
//
// Usage:
//   const { isAdmin, loading } = useIsAdmin();
//   if (loading) return null;
//   if (!isAdmin) return <NotAuthorized/>;

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

export function useIsAdmin() {
  const { session, loading: sessionLoading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    if (sessionLoading) return;
    if (!session?.user?.id) {
      if (!mounted) return;
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase.rpc("is_admin").then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        // Fail closed — any error treats the caller as non-admin.
        console.warn("[useIsAdmin] rpc error", error);
        setIsAdmin(false);
      } else {
        setIsAdmin(Boolean(data));
      }
      setLoading(false);
    });

    return () => { mounted = false; };
  }, [session?.user?.id, sessionLoading]);

  return { isAdmin, loading };
}
