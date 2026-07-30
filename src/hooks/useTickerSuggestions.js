// useTickerSuggestions — "did you mean?" close matches for a symbol that
// isn't in ticker_reference.
//
// Why this exists (Joe, 2026-07-30): /ticker/APPL — a one-letter typo for
// AAPL — rendered the whole ticker page shell with a $0.00 price, an empty
// chart, an empty company overview and no news, because nothing on the page
// ever asked whether the symbol exists. The page now shows an explicit
// not-found state, and this hook supplies the suggestions on it.
//
// Ranking lives in Postgres (migration 090, ticker_did_you_mean): edit
// distance on the symbol OR trigram similarity on the company name, ties
// broken by market cap so the household name comes first. APPL -> AAPL.
//
// Only fires when `enabled` is true, i.e. only on the not-found path — it
// costs nothing on a normal ticker view.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const EMPTY = { rows: [], loading: false, error: null };

export default function useTickerSuggestions(ticker, { enabled = true, limit = 5 } = {}) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    const term = String(ticker || '').trim().toUpperCase();
    if (!enabled || !term) { setState(EMPTY); return; }

    let cancelled = false;
    setState({ rows: [], loading: true, error: null });

    (async () => {
      const { data, error } = await supabase.rpc('ticker_did_you_mean', { q: term, lim: limit });
      if (cancelled) return;
      setState({
        rows: (data || []).filter((r) => r && r.ticker && r.ticker !== term),
        loading: false,
        error: error?.message || null,
      });
    })();

    return () => { cancelled = true; };
  }, [ticker, enabled, limit]);

  return state;
}
