// useTickerDeepDive — Phase 4b PR-E
//
// For any ticker the modal opens on, pulls three Supabase rows-or-lists
// in parallel:
//   - ticker_reference   — single row (Massive · Polygon metadata)
//   - dividends          — recent dividend records (last ~5 most recent)
//   - splits             — recent split records (last ~5 most recent)
//
// All three feed the bottom-tabs deep-dive section of TickerDetailModal
// (About / Dividend history / Splits). Lazy-loaded on modal open;
// cached per-ticker via the lifecycle of the hook (re-fetches when
// ticker changes).
//
// LESSONS rule #29: this hook is a new consumer of the Massive Phase 1
// tables. The producer (the daily MASSIVE-DAILY cron) writes the rows;
// the modal reads them here. Listed in pipeline_health under
// massive-corporate-actions and massive-ticker-details.
//
// LESSONS rule #30: every value rendered downstream from this hook
// derives from live Supabase reads — no hardcoded narrative.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const EMPTY = { ref: null, dividends: [], splits: [], loading: false, error: null };

export default function useTickerDeepDive(ticker) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!ticker) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const upper = String(ticker).toUpperCase();

    (async () => {
      try {
        const [refRes, divRes, splRes] = await Promise.all([
          supabase.from("ticker_reference").select(
            "ticker,name,description,homepage_url,logo_url,list_date,market_cap," +
            "share_class_shares_outstanding,total_employees,sic_code,sic_description," +
            "address_city,address_state,address_country,primary_exchange,phone_number,ingested_at"
          ).eq("ticker", upper).maybeSingle(),
          supabase.from("dividends").select(
            "ticker,ex_dividend_date,pay_date,record_date,declaration_date," +
            "cash_amount,currency,frequency,dividend_type"
          ).eq("ticker", upper).order("ex_dividend_date", { ascending: false }).limit(8),
          supabase.from("splits").select(
            "ticker,execution_date,split_from,split_to"
          ).eq("ticker", upper).order("execution_date", { ascending: false }).limit(8),
        ]);

        if (cancelled) return;
        setState({
          ref: refRes?.data || null,
          dividends: divRes?.data || [],
          splits: splRes?.data || [],
          loading: false,
          error: refRes?.error || divRes?.error || splRes?.error || null,
        });
      } catch (err) {
        if (!cancelled) setState({ ...EMPTY, loading: false, error: err });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}
