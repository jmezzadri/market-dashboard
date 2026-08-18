/* useLseLive — live intraday prices from the London Strategic Edge feed
   (lse-live edge function, mode "quotes"), added 2026-07-27 (Joe-approved).

   Display-only doctrine: these prices are for what the user SEES right now.
   Every engine (paper trading, scanner, allocator) stays on the official
   end-of-day price table — LESSONS 8.6 binds; nothing here feeds a trade.

   Two providers behind one hook (2026-08-18): the edge function tries LSE
   first and falls back to Yahoo's chart meta for anything LSE doesn't carry,
   so `covered:false` now means the symbol isn't real rather than "our paid
   feed happens to have a hole here". Covered names also return `prevClose`
   when the provider supplies it — use it as the base for the day move in
   preference to a stored close, which can be a session behind.

   How it stays cheap: the edge function keeps a shared server-side cache
   (45 s TTL in market hours) so every viewer reads the same vendor pull.
   This hook polls the function every 30 s while the tab is visible and the
   market is open; closed-market polls collapse to every 5 minutes and serve
   the cached last bar. Coverage: ~4,000 US stocks + major ETFs; uncovered
   names return covered:false and the UI renders an em-dash — never a
   fabricated value (LESSONS 4.4).

   Feed governance: manifest element market.lse-intraday-live; health row
   lse_intraday (stamped by the edge function after each real vendor pull);
   chip elementId "market-lse_intraday-live". */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const POLL_OPEN_MS = 30 * 1000;
const POLL_CLOSED_MS = 5 * 60 * 1000;

// One in-flight request per symbol-set across all mounted components.
let _lastResponse = null;

export default function useLseLive(tickers, { enabled = true } = {}) {
  const key = useMemo(
    () => [...new Set((tickers || []).map((t) => String(t || '').trim().toUpperCase()).filter(Boolean))].sort().join(','),
    [tickers],
  );
  const [state, setState] = useState({ bySymbol: {}, marketOpen: null, asOf: null, loading: false, error: null });
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled || !key) {
      setState({ bySymbol: {}, marketOpen: null, asOf: null, loading: false, error: null });
      return undefined;
    }
    const symbols = key.split(',');
    let fetchedOnce = false;

    async function tick() {
      // Always fetch the first time (a background tab should have data the
      // moment it's switched to); after that, pause the polling loop while
      // hidden and resume instantly on visibilitychange below.
      if (fetchedOnce && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer.current = setTimeout(tick, POLL_OPEN_MS);
        return;
      }
      fetchedOnce = true;
      try {
        const { data, error } = await supabase.functions.invoke('lse-live', {
          body: { mode: 'quotes', symbols },
        });
        if (!alive.current) return;
        if (error || !data || data.error) throw new Error(error?.message || data?.error || 'no data');
        _lastResponse = data;
        const bySymbol = {};
        let newest = null;
        for (const q of data.quotes || []) {
          bySymbol[q.symbol] = {
            price: q.price != null && Number.isFinite(Number(q.price)) ? Number(q.price) : null,
            prevClose: q.prevClose != null && Number.isFinite(Number(q.prevClose)) ? Number(q.prevClose) : null,
            barTs: q.barTs || null,
            covered: q.covered !== false,
            source: q.source || null,
          };
          if (q.barTs && (!newest || q.barTs > newest)) newest = q.barTs;
        }
        setState({ bySymbol, marketOpen: !!data.marketOpen, asOf: newest, loading: false, error: null });
        timer.current = setTimeout(tick, data.marketOpen ? POLL_OPEN_MS : POLL_CLOSED_MS);
      } catch (e) {
        if (!alive.current) return;
        // Keep the last good quotes on a transient failure; surface the error.
        setState((s) => ({ ...s, loading: false, error: String(e.message || e) }));
        timer.current = setTimeout(tick, POLL_OPEN_MS * 2);
      }
    }

    setState((s) => ({ ...s, loading: true }));
    tick();
    // Coming back to a hidden tab refreshes immediately instead of waiting
    // out the paused poll cycle.
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer.current);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, enabled]);

  return state;
}
