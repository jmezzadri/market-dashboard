// usePricesAsOfDate — fetch the latest trade_date from prices_eod.
//
// Powers the freshness chip on the positions table (TableFootnote).
// Returns the YYYY-MM-DD string of the most recent close-data date.
// Re-fetches every 5 minutes so the chip flips green on its own once
// the daily MASSIVE-DAILY ingest completes overnight without requiring
// a page reload.
//
// Joe directive 2026-05-04 evening — replaces the misleading "Updated
// 4:06 PM ET" page-load timestamp.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function usePricesAsOfDate() {
  const [asOfDate, setAsOfDate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase
        .from("prices_eod")
        .select("trade_date")
        .order("trade_date", { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (error) {
        console.warn("[usePricesAsOfDate] fetch failed", error);
        return;
      }
      const row = (data || [])[0];
      if (row && row.trade_date) setAsOfDate(row.trade_date);
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return asOfDate;
}

export default usePricesAsOfDate;
