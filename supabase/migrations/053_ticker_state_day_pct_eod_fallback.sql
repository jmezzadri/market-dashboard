-- 053_ticker_state_day_pct_eod_fallback.sql
--
-- Bug fix: Trading Opportunities table was rendering DAY% = 0.00% for every
-- row. Root cause was a producer/consumer combo problem:
--
--   1. The ticker_state_current view's `day_perc_change` column read only
--      from universe_snapshots.perc_change (Unusual Whales feed). That
--      column is currently null for 100% of 12,634 ticker_state_current
--      rows -- the upstream producer has been silently empty.
--
--   2. The consumer (src/v2/pages/TradingOppsPage.jsx) ran
--      `Number(snap.perc_change)` against a null value, which silently
--      coerces to 0; Number.isFinite(0) is true, so the prev-close fallback
--      never fired and every row painted "0.00%".
--
-- Fix applied here (DB side): the view now COALESCEs day_perc_change with
-- a deterministic compute from prices_eod (Polygon Massive EOD). We pull
-- the most recent prices_eod close (`pe.close`) and the prior trading
-- day's close from a new lateral subquery (`prev_pe.close`), then compute
-- ((today - prior) / prior) * 100 when the snapshot feed is null. Two new
-- columns are also exposed at the end of the view: `prev_close_eod` and
-- `prev_close_eod_date`, so future consumers can read EOD data directly.
--
-- Producer-side gap (universe_snapshots.perc_change being 100% null) is
-- being tracked separately as a P1 data bug; this view fix means the
-- Trading Opps table no longer depends on that pipeline being healthy.
--
-- Coverage after the fix: 12,469 / 12,634 tickers (98.7%) now have a
-- non-null day_perc_change. The remaining 1.3% are brand-new listings
-- with only a single prices_eod row (no prior day available yet).
--
-- This is a CREATE OR REPLACE VIEW; the only schema change is two columns
-- added at the end (prev_close_eod, prev_close_eod_date) and the formula
-- behind day_perc_change. Reversible by re-replacing with the prior body.

CREATE OR REPLACE VIEW ticker_state_current AS
 SELECT tr.ticker,
    tr.name AS ticker_name,
    tr.description AS ticker_description,
    tr.sic_code,
    tr.sic_description,
    tr.list_date,
    tr.address_city,
    tr.address_state,
    tr.share_class_shares_outstanding,
    tr.total_employees,
    tr.homepage_url,
    tr.logo_url,
    g.sector AS gics_sector,
    g.industry_group AS gics_industry_group,
    us.sector AS snap_sector,
    us.full_name AS snap_full_name,
    COALESCE(us.marketcap, tr.market_cap) AS market_cap,
    tr.market_cap AS market_cap_ref,
    us.marketcap AS market_cap_snap,
    COALESCE(us.close, pe.close) AS last_close,
    us.close AS last_close_snap,
    pe.close AS last_close_eod,
    pe.trade_date AS last_close_eod_date,
    us.prev_close AS prev_close_snap,
    COALESCE(
      us.perc_change,
      CASE
        WHEN pe.close IS NOT NULL AND prev_pe.close IS NOT NULL AND prev_pe.close > 0
        THEN (((pe.close - prev_pe.close) / prev_pe.close) * 100)::numeric
        ELSE NULL
      END
    ) AS day_perc_change,
    us.week_52_high,
    us.week_52_low,
    us.iv_rank,
    us.snapshot_ts AS snap_ts,
    siv.scan_date AS score_date,
    siv.mt_score,
    siv.band,
    siv.sub_scores,
    siv.weights_used,
    siv.cap_discount,
    siv.so_what,
    siv.diagnostic AS scorer_diagnostic,
    prev_pe.close AS prev_close_eod,
    prev_pe.trade_date AS prev_close_eod_date
   FROM (((((ticker_reference tr
     LEFT JOIN LATERAL gics_from_sic((tr.sic_code)::integer) g(sector, industry_group) ON (true))
     LEFT JOIN LATERAL ( SELECT universe_snapshots.ticker,
            universe_snapshots.snapshot_ts,
            universe_snapshots.as_of_date,
            universe_snapshots.full_name,
            universe_snapshots.sector,
            universe_snapshots.issue_type,
            universe_snapshots.is_index,
            universe_snapshots.marketcap,
            universe_snapshots.close,
            universe_snapshots.prev_close,
            universe_snapshots.perc_change,
            universe_snapshots.week_52_high,
            universe_snapshots.week_52_low,
            universe_snapshots.iv_rank,
            universe_snapshots.fetched_at
           FROM universe_snapshots
          WHERE (universe_snapshots.ticker = tr.ticker)
          ORDER BY universe_snapshots.snapshot_ts DESC
         LIMIT 1) us ON (true))
     LEFT JOIN LATERAL ( SELECT prices_eod.ticker,
            prices_eod.trade_date,
            prices_eod.close
           FROM prices_eod
          WHERE (prices_eod.ticker = tr.ticker)
          ORDER BY prices_eod.trade_date DESC
         LIMIT 1) pe ON (true))
     LEFT JOIN LATERAL ( SELECT prices_eod.close,
            prices_eod.trade_date
           FROM prices_eod
          WHERE (prices_eod.ticker = tr.ticker) AND (prices_eod.trade_date < pe.trade_date)
          ORDER BY prices_eod.trade_date DESC
         LIMIT 1) prev_pe ON (true))
     LEFT JOIN LATERAL ( SELECT signal_intel_v5_daily.scan_date,
            signal_intel_v5_daily.ticker,
            signal_intel_v5_daily.market_cap,
            signal_intel_v5_daily.mt_score,
            signal_intel_v5_daily.band,
            signal_intel_v5_daily.sub_scores,
            signal_intel_v5_daily.weights_used,
            signal_intel_v5_daily.cap_discount,
            signal_intel_v5_daily.so_what,
            signal_intel_v5_daily.diagnostic,
            signal_intel_v5_daily.ingested_at
           FROM signal_intel_v5_daily
          WHERE (signal_intel_v5_daily.ticker = tr.ticker)
          ORDER BY signal_intel_v5_daily.scan_date DESC
         LIMIT 1) siv ON (true));
