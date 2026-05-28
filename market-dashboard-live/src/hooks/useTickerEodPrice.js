// useTickerEodPrice — authoritative last-close + prev-close + trade_date
// for any ticker, sourced from prices_eod (Polygon Massive EOD).
//
// 2026-05-27 — extended to also return open / high / low / volume for the
// latest session, used by the redesigned ticker page Key Stats grid.
//
// Why this exists:
//   The TickerDetailModal used to read price from a chain of overlays
//   (signal_intel_v5_daily.diagnostic, universe_snapshots, the public
//   latest_scan_data.json artifact, …). Each of those is on its own
//   refresh cadence, with its own coverage gap, and ordered by its own
//   key. For LUNR on 2026-05-12 the chain picked up an older prices_eod
//   row via the wrong ordering and rendered $24.11 (close from 5/7) when
//   the latest close was $32.42 (5/11). Joe's bug report driving this fix.
//
// Same-day self-heal (added 2026-05-14):
//   Polygon Basic tier won't serve today's grouped EOD until T+1, so
//   prices_eod sits a trading day behind between market close and the
//   next morning's ingest. When the hook's first read returns a
//   trade_date older than the most recent NYSE trading session, we fire
//   the eod-same-day edge function (Yahoo fallback) and re-query. This
//   makes intraday opens of a stale-row ticker self-heal within ~1
//   second instead of waiting for the next batch.
//
// What it returns:
//   { last_close, prev_close, trade_date, prev_trade_date,
//     open, high, low, volume,
//     day_pct, loading, source: "prices_eod", error }
//
//   trade_date / prev_trade_date are the actual trading-day labels of the
//   two values — these are what the freshness chip MUST anchor to, not
//   "the pipeline ran today at 4 AM". A user reading "Last close: Mon
//   May 11" knows exactly what the price is from; "today 4:07 AM ET" is
//   misleading whenever the data is a back-fill or a stale row.
//
// Performance:
//   Two prices_eod lookups per modal open, ordered by trade_date DESC
//   LIMIT 1 (and LIMIT 1 OFFSET 1). Indexed on (ticker, trade_date).
//   Under 50 ms in practice. Same-day self-heal adds ~1s but only when
//   the row is actually stale.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { latestTradingSessionDate } from "../lib/freshnessClock";

const EMPTY = {
  last_close: null,
  prev_close: null,
  trade_date: null,
  prev_trade_date: null,
  ingested_at: null,
  open: null,
  high: null,
  low: null,
  volume: null,
  day_pct: null,
  loading: false,
  source: null,
  error: null,
};

function latestSessionETDate() {
  const d = latestTradingSessionDate();
  if (!d) return null;
  const s = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return s;
}

export default function useTickerEodPrice(ticker) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!ticker) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const upper = ticker.toUpperCase();

    async function readPricesEod() {
      const { data, error } = await supabase
        .from("prices_eod")
        .select("close, open, high, low, volume, trade_date, ingested_at")
        .eq("ticker", upper)
        .order("trade_date", { ascending: false })
        .limit(2);
      if (error) throw new Error(error.message || String(error));
      const rows = Array.isArray(data) ? data : [];
      return { cur: rows[0] || null, prev: rows[1] || null };
    }

    function commit({ cur, prev }) {
      const last_close = cur  ? Number(cur.close)  : null;
      const prev_close = prev ? Number(prev.close) : null;
      const day_pct =
        Number.isFinite(last_close) &&
        Number.isFinite(prev_close) &&
        prev_close > 0
          ? ((last_close - prev_close) / prev_close) * 100
          : null;
      setState({
        last_close,
        prev_close,
        trade_date: cur?.trade_date || null,
        prev_trade_date: prev?.trade_date || null,
        ingested_at: cur?.ingested_at || null,
        open:   cur && cur.open  != null ? Number(cur.open)   : null,
        high:   cur && cur.high  != null ? Number(cur.high)   : null,
        low:    cur && cur.low   != null ? Number(cur.low)    : null,
        volume: cur && cur.volume != null ? Number(cur.volume) : null,
        day_pct,
        loading: false,
        source: "prices_eod",
        error: null,
      });
    }

    (async () => {
      try {
        let result = await readPricesEod();
        if (cancelled) return;

        const sessionDate = latestSessionETDate();
        const haveDate = result.cur?.trade_date || null;
        if (sessionDate && haveDate && haveDate < sessionDate) {
          commit(result);
          try {
            const { data: sess } = await supabase.auth.getSession();
            const accessToken = sess?.session?.access_token;
            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eod-same-day`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ ticker: upper }),
            });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[useTickerEodPrice] eod-same-day fallback failed", e);
          }
          if (cancelled) return;
          try {
            const fresh = await readPricesEod();
            if (cancelled) return;
            commit(fresh);
          } catch (_) {
            /* keep previously committed */
          }
          return;
        }

        commit(result);
      } catch (e) {
        if (!cancelled) {
          setState({ ...EMPTY, error: e?.message || String(e) });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}
