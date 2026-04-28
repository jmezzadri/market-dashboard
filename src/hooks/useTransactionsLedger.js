// useTransactionsLedger — session-scoped transactions ledger.
//
// Reads every transaction row for the signed-in user and joins the account
// label so the trade history table can render and filter by account name
// without a second round-trip. Realized P&L windows (YTD / 1M / 3M /
// Lifetime) and the short-term vs long-term split are computed once here
// so the consumer just renders.
//
// Returned shape:
//   {
//     rows       : Array<TxRow>      (newest-first)
//     totals     : {
//                    ytd       : { all, st, lt },   // dollars
//                    m1        : { all, st, lt },
//                    m3        : { all, st, lt },
//                    lifetime  : { all, st, lt },
//                  }
//     loading    : boolean
//     error      : Error | null
//     refetch    : () => Promise<void>
//   }
//
// TxRow columns (camelCased):
//   id, executedAt (Date), side, ticker, assetClass, quantity, price,
//   multiplier, grossProceeds, netProceeds, costBasis, realizedPnl,
//   holdingDays, isLongTerm, contractType, direction, strike, expiration,
//   accountId, accountLabel, notes
//
// Why short/long-term matters in plain English:
//   Realized gains taxed at your *ordinary* income rate if held ≤ 1 year
//   (short-term), or at the preferential 0/15/20% capital-gains rate if
//   held > 1 year (long-term). The is_long_term column is populated by
//   the close_position RPC; we just read it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const MS_PER_DAY = 86400000;

function shapeRow(r) {
  return {
    id:             r.id,
    executedAt:     r.executed_at ? new Date(r.executed_at) : null,
    side:           r.side,
    ticker:         r.ticker,
    assetClass:     r.asset_class,
    quantity:       r.quantity != null ? Number(r.quantity) : null,
    price:          r.price != null ? Number(r.price) : null,
    multiplier:     r.multiplier != null ? Number(r.multiplier) : 1,
    fees:           r.fees != null ? Number(r.fees) : 0,
    grossProceeds:  r.gross_proceeds != null ? Number(r.gross_proceeds) : null,
    netProceeds:    r.net_proceeds != null ? Number(r.net_proceeds) : null,
    costBasis:      r.cost_basis != null ? Number(r.cost_basis) : null,
    realizedPnl:    r.realized_pnl != null ? Number(r.realized_pnl) : null,
    holdingDays:    r.holding_days != null ? Number(r.holding_days) : null,
    isLongTerm:     r.is_long_term,
    contractType:   r.contract_type || null,
    direction:      r.direction || null,
    strike:         r.strike != null ? Number(r.strike) : null,
    expiration:     r.expiration || null,
    notes:          r.notes || "",
    accountId:      r.account_id,
    accountLabel:   r.account?.label || "—",
  };
}

// Sum realized P&L for rows where executedAt >= cutoff (or any cutoff===null).
// Returns { all, st, lt } in dollars. Rows without realizedPnl are skipped
// (those are BUY / OPEN entries — only CLOSE rows realize P&L).
function sumWindow(rows, cutoff) {
  let all = 0, st = 0, lt = 0;
  for (const r of rows) {
    if (r.realizedPnl == null) continue;
    if (cutoff && (!r.executedAt || r.executedAt < cutoff)) continue;
    all += r.realizedPnl;
    if (r.isLongTerm === true) lt += r.realizedPnl;
    else if (r.isLongTerm === false) st += r.realizedPnl;
    // is_long_term === null → counted in `all` but not in either bucket
  }
  return { all, st, lt };
}

export function useTransactionsLedger() {
  const { user } = useSession();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRows = useCallback(async () => {
    if (!user) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // RLS filters by auth.uid() = user_id automatically.
      const { data, error: e } = await supabase
        .from("transactions")
        .select("id, user_id, account_id, ticker, asset_class, side, quantity, price, multiplier, fees, gross_proceeds, net_proceeds, cost_basis, realized_pnl, holding_days, is_long_term, contract_type, direction, strike, expiration, notes, executed_at, account:accounts(label,sub)")
        .order("executed_at", { ascending: false });
      if (e) throw e;
      setRows((data || []).map(shapeRow));
    } catch (err) {
      console.error("[useTransactionsLedger] fetch failed", err);
      setError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const totals = useMemo(() => {
    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    const m1Start  = new Date(now.getTime() - 30 * MS_PER_DAY);
    const m3Start  = new Date(now.getTime() - 90 * MS_PER_DAY);
    return {
      ytd:      sumWindow(rows, ytdStart),
      m1:       sumWindow(rows, m1Start),
      m3:       sumWindow(rows, m3Start),
      lifetime: sumWindow(rows, null),
    };
  }, [rows]);

  return { rows, totals, loading, error, refetch: fetchRows };
}
