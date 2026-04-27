// usePortfolioHistory — session-scoped fetch of public.portfolio_history rows.
//
// Returns the user's per-account monthly NAV / contributions / withdrawals /
// monthly_return history (typically 200-300 rows for a multi-account book).
// RLS enforces tenant isolation server-side; the client never filters by
// user_id.
//
// Shape returned:
//   {
//     rows    : Array<{
//                 account_id, account_label, as_of, nav, contributions,
//                 withdrawals, monthly_return, source
//               }>
//     loading : boolean
//     error   : Error | null
//     refetch : () => Promise<void>
//   }
//
// Empty array for unauthenticated users (no network fetch).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

export function usePortfolioHistory() {
  const { session } = useSession();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!session) {
      setRows([]); setLoading(false); setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("portfolio_history")
      .select("account_id, account_label, as_of, nav, contributions, withdrawals, monthly_return, source")
      .order("as_of", { ascending: true });
    if (error) {
      setError(error);
      setRows([]);
    } else {
      // Normalize numeric fields — Postgres numeric comes back as string from PostgREST.
      const normalized = (data || []).map(r => ({
        account_id:     r.account_id,
        account_label:  r.account_label,
        as_of:          r.as_of,
        nav:            r.nav            != null ? Number(r.nav)            : null,
        contributions:  r.contributions  != null ? Number(r.contributions)  : 0,
        withdrawals:    r.withdrawals    != null ? Number(r.withdrawals)    : 0,
        monthly_return: r.monthly_return != null ? Number(r.monthly_return) : null,
        source:         r.source,
      }));
      setRows(normalized);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => { refetch(); }, [refetch]);

  return { rows, loading, error, refetch };
}

export default usePortfolioHistory;
