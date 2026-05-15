// usePricesEodBatch — batched last + prev close lookup from prices_eod
// for a set of tickers. One Supabase round-trip regardless of fan-out.
//
// Why this exists:
//   The WatchlistTable, the Positions table, the Trading Opps cards, and
//   every other surface that renders a price for a list of tickers used
//   to read each from its own cached column (positions.price,
//   scanData.signals.screener.{ticker}.close, signal_intel_v5_daily.price,
//   …). Each cache refreshes on its own cadence, so the same ticker
//   could legitimately show three different prices on the same screen
//   depending on which surface you were looking at.
//
//   This hook is the single read path. Every list-rendering surface
//   should resolve prices through it so there is exactly one source of
//   truth, lockstep with the same prices_eod the drawer headline reads.
//
// Returns:
//   { byTicker: { [TICKER]: { close, prev_close, trade_date,
//                             prev_trade_date, day_pct } }, loading }
//
// Refreshes every 90 seconds so eod-same-day writes (Yahoo intraday
// updates triggered by another tab, the scheduled batch, or an
// addToWatchlist) propagate into the live UI without a hard reload.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const REFRESH_MS = 90 * 1000;

export default function usePricesEodBatch(tickers) {
  const norm = useMemo(
    () => Array.from(
      new Set(
        (tickers || [])
          .map((t) => String(t || "").trim().toUpperCase())
          .filter(Boolean)
      )
    ),
    [tickers]
  );
  const key = norm.join("|"); // stable dep for useEffect

  const [byTicker, setByTicker] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (norm.length === 0) { setByTicker({}); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Pull last ~5 trading days for every ticker in one shot. We
        // only need the latest two rows per ticker (today's close +
        // prev close for the day-% calc), but fetching 5 days is
        // cheap on the (ticker, trade_date) index and gives us a
        // safety margin for weekends / new listings.
        const today = new Date();
        const fromDate = new Date(today.getTime() - 9 * 86400000);
        const isoFrom = fromDate.toISOString().slice(0, 10);

        const { data, error } = await supabase
          .from("prices_eod")
          .select("ticker, close, trade_date")
          .in("ticker", norm)
          .gte("trade_date", isoFrom)
          .order("trade_date", { ascending: false });

        if (cancelled) return;
        if (error) {
          setLoading(false);
          // eslint-disable-next-line no-console
          console.warn("[usePricesEodBatch] fetch failed", error.message);
          return;
        }

        // Group rows by ticker; first two entries per ticker (ordered
        // by trade_date DESC) are the last close + prev close.
        const groups = {};
        for (const row of (data || [])) {
          const t = String(row.ticker || "").toUpperCase();
          if (!groups[t]) groups[t] = [];
          if (groups[t].length < 2) groups[t].push(row);
        }
        const next = {};
        for (const t of norm) {
          const g = groups[t] || [];
          const cur  = g[0] || null;
          const prev = g[1] || null;
          const close      = cur  ? Number(cur.close)  : null;
          const prev_close = prev ? Number(prev.close) : null;
          const day_pct =
            Number.isFinite(close) &&
            Number.isFinite(prev_close) &&
            prev_close > 0
              ? ((close - prev_close) / prev_close) * 100
              : null;
          next[t] = {
            close,
            prev_close,
            trade_date:       cur?.trade_date  || null,
            prev_trade_date:  prev?.trade_date || null,
            day_pct,
          };
        }
        setByTicker(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { byTicker, loading };
}
