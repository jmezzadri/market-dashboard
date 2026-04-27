// useDailyNavSnapshot — on-visit backstop for portfolio_history.
//
// Calls the public.snapshot_my_portfolio_today() RPC once per session for
// authenticated users. The RPC aggregates the caller's positions into per-
// account NAV rows in portfolio_history, scoped by auth.uid().
//
// Pairs with the cron path (snapshot-portfolios-daily-2100utc, jobid 16):
//   • Cron runs nightly at 21:00 UTC weekdays (after US close).
//   • This hook fires when an authenticated user lands on the site, so a
//     Saturday or holiday visit still captures the last close.
//   • Both paths upsert via ON CONFLICT (user_id, account_label, as_of).
//     Manual statement seeds always win; cron beats on-visit; on-visit
//     fills gaps when nothing else has written.
//
// Idempotent — safe to call multiple times per session, but we cap to once
// per mount to avoid pointless RPC chatter.

import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

export function useDailyNavSnapshot() {
  const { session } = useSession();
  const fired = useRef(false);

  useEffect(() => {
    if (!session?.user?.id) { fired.current = false; return; }
    if (fired.current) return;
    fired.current = true;

    supabase.rpc("snapshot_my_portfolio_today")
      .then(({ data, error }) => {
        if (error) {
          // Soft-fail — the cron path is the primary; the on-visit hook is
          // a backstop. Log to console for diagnostics, do not surface to UI.
          console.warn("snapshot_my_portfolio_today failed:", error.message);
        } else if (data && Array.isArray(data) && data[0]?.rows_written != null) {
          // Successful write. Quiet log so we can diff sessions during QA.
          console.log(`[NAV snapshot] wrote ${data[0].rows_written} rows for today`);
        }
      });
  }, [session]);
}

export default useDailyNavSnapshot;
