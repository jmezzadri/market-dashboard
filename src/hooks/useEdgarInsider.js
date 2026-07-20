// useEdgarInsider — per-ticker insider filings read DIRECTLY from the SEC
// EDGAR table (insider_history_edgar), shaped into the same event objects the
// UW ticker_events insider stream produced ({event_ts, payload:{...}}), so
// InsiderDrill and any other consumer render unchanged.
//
// 2026-07-20 cutover: this replaces the Unusual Whales insider event stream
// as the Ticker page's insider evidence source. The scanner reads the same
// table, so the drill's evidence list and the score can never disagree on
// which filings exist.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function useEdgarInsider(sym, daysBack = 90) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!sym) { setEvents([]); return () => {}; }
    (async () => {
      const since = new Date(Date.now() - daysBack * 86400e3)
        .toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('insider_history_edgar')
        .select('filing_date,transaction_date,transaction_code,amount,stock_price,owner_name,is_officer,is_director,is_ten_percent_owner,is_10b5_1,officer_title')
        .eq('ticker', sym)
        .gte('filing_date', since)
        .order('filing_date', { ascending: false })
        .limit(500);
      if (!alive) return;
      if (error || !data) { setEvents([]); return; }
      setEvents(data.map((r) => ({
        event_ts: r.filing_date,
        source: 'insider',
        payload: {
          transaction_date: r.transaction_date,
          transaction_code: r.transaction_code,
          amount: r.amount,
          price: r.stock_price,
          value: r.amount != null && r.stock_price != null
            ? Number(r.amount) * Number(r.stock_price) : null,
          owner_name: r.owner_name,
          is_officer: r.is_officer,
          is_director: r.is_director,
          is_ten_percent: r.is_ten_percent_owner,
          is_10b5_1: r.is_10b5_1,
          title: r.officer_title,
        },
      })));
    })();
    return () => { alive = false; };
  }, [sym, daysBack]);
  return events;
}
