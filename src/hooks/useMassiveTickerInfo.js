// useMassiveTickerInfo — Phase 4a of the Massive (Polygon) data revamp.
//
// For any ticker the modal opens on, fetches the canonical name from the
// new Supabase tables (`ticker_reference` first — richer metadata
// populated by Phase 3 — then `universe_master` — always populated by
// the daily Massive cron). The TickerDetailModal name waterfall used to
// fall through to the raw ticker symbol for the ~11,000 tickers outside
// UW's screener; this hook fills that gap so every one of the ~12,500
// active US tickers shows the actual company name instead.
//
// Lightweight: one row per modal open, ~30ms round-trip.
//
// Returns: { name, source, loading } where source ∈ {ticker_reference,
// universe_master, null}.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useMassiveTickerInfo(ticker) {
  const [state, setState] = useState({ name: null, source: null, loading: false });

  useEffect(() => {
    if (!ticker) {
      setState({ name: null, source: null, loading: false });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));

    const upper = ticker.toUpperCase();
    (async () => {
      try {
        // ticker_reference is richer (description, logo, employees, etc.)
        // populated by Phase 3 backfill — try it first.
        const { data: ref } = await supabase
          .from("ticker_reference")
          .select("name")
          .eq("ticker", upper)
          .maybeSingle();
        if (cancelled) return;
        if (ref?.name) {
          setState({ name: ref.name, source: "ticker_reference", loading: false });
          return;
        }

        // universe_master is the canonical full-coverage list, populated
        // by the daily Massive cron (Phase 1+2). Always available.
        const { data: um } = await supabase
          .from("universe_master")
          .select("name")
          .eq("ticker", upper)
          .maybeSingle();
        if (cancelled) return;
        setState({
          name: um?.name || null,
          source: um?.name ? "universe_master" : null,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ name: null, source: null, loading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}
