// useUserPortfolio — session-scoped portfolio store.
//
// Reads accounts / positions / watchlist rows from Supabase for the current
// signed-in user and reshapes them to match the structure the dashboard already
// renders from (the old hard-coded `ACCOUNTS` / `WATCHLIST_FALLBACK` constants
// in App.jsx). Unauthenticated callers get empty arrays — no network fetch,
// no "undefined.map" errors downstream.
//
// Shape returned to callers:
//   {
//     accounts  : Array<{ id, label, sub, color, tactical, note, positions:[...] }>
//     watchlist : Array<{ ticker, name, theme }>   (crypto stays hard-coded in App.jsx)
//     loading   : boolean   (true only during the initial authenticated fetch)
//     error     : Error | null
//     refetch   : () => Promise<void>   (call after a write to refresh)
//     isAuthed  : boolean   (convenience — session && rows fetched)
//   }
//
// Row-level security enforces tenant isolation server-side. The client never
// asks Supabase to filter by user_id — the wrong-user JWT simply gets zero
// rows back, which is what we want.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const ACCENT = "#4a6fa5"; // must match the ACCENT constant in App.jsx

// Map a raw Supabase `positions` row to the shape the render code expects.
// NOTE: `id` and `accountId` are included so downstream edit/delete flows can
// target the row without having to re-query. Without them, update/delete would
// have to match on (account_id, ticker) which breaks if a user legitimately
// holds the same ticker in two accounts.
function shapePosition(row) {
  return {
    id:         row.id,
    accountId:  row.account_id,
    ticker:     row.ticker,
    name:       row.name,
    value:      row.value !== null ? Number(row.value) : null,
    price:      row.price !== null ? Number(row.price) : null,
    quantity:   row.quantity !== null ? Number(row.quantity) : null,
    avgCost:    row.avg_cost !== null ? Number(row.avg_cost) : null,   // DB snake → JS camel
    sector:     row.sector,
    beta:       row.beta !== null ? Number(row.beta) : null,
    color:      row.color || ACCENT,
    analysis:   row.analysis || "",
    // Item 36: optional acquisition date. NULL for legacy rows.
    // Drives Holding Period column + future Annualized PnL column.
    purchaseDate: row.purchase_date || null,
  };
}

function shapeWatchRow(row) {
  return {
    ticker: row.ticker,
    name:   row.name || row.ticker,
    theme:  row.theme || "",
  };
}

export function useUserPortfolio() {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user?.id ?? null;

  const [accounts,  setAccounts]  = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  // Tick counter that the caller can bump via refetch() to force a reload.
  const [refreshTick, setRefreshTick] = useState(0);

  const refetch = useCallback(() => {
    setRefreshTick((n) => n + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    // No session → render empty state. Don't block with loading=true; unauthenticated
    // isn't a loading condition, it's the steady-state zero-data view.
    if (!userId) {
      setAccounts([]);
      setWatchlist([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch all three tables in parallel. RLS filters to the current user.
        const [accRes, posRes, watchRes] = await Promise.all([
          supabase.from("accounts")
            .select("id,label,sub,color,tactical,note,sort_order")
            .order("sort_order", { ascending: true }),
          supabase.from("positions")
            .select("id,account_id,ticker,name,quantity,price,avg_cost,value,sector,beta,analysis,color,sort_order,purchase_date")
            .order("sort_order", { ascending: true }),
          supabase.from("watchlist")
            .select("ticker,name,theme,sort_order")
            .order("sort_order", { ascending: true }),
        ]);

        if (cancelled) return;

        if (accRes.error)   throw accRes.error;
        if (posRes.error)   throw posRes.error;
        if (watchRes.error) throw watchRes.error;

        // Nest positions under their account.
        const byAccount = new Map();
        for (const p of posRes.data || []) {
          if (!byAccount.has(p.account_id)) byAccount.set(p.account_id, []);
          byAccount.get(p.account_id).push(shapePosition(p));
        }

        const nested = (accRes.data || []).map((a) => ({
          id:       a.id,
          label:    a.label,
          sub:      a.sub,
          color:    a.color,
          tactical: !!a.tactical,
          note:     a.note,
          positions: byAccount.get(a.id) || [],
        }));

        setAccounts(nested);
        setWatchlist((watchRes.data || []).map(shapeWatchRow));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[useUserPortfolio] fetch failed:", err);
        setError(err);
        setAccounts([]);
        setWatchlist([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, refreshTick]);

  // `isAuthed` is true once we have a session and are not mid-fetch — useful
  // for gating "empty because no data yet" vs. "empty because not signed in".
  const isAuthed = useMemo(
    () => Boolean(userId) && !loading && !error,
    [userId, loading, error]
  );

  return {
    accounts,
    watchlist,
    loading: loading || sessionLoading,
    error,
    refetch,
    isAuthed,
    userId,
  };
}
