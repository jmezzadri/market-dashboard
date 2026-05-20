-- =============================================================================
-- 055_trading_opps_phase1_data.sql
-- Trading Opportunities overhaul — Phase 1 data foundation.
-- -----------------------------------------------------------------------------
-- Adds the two new ingestion tables the rebuilt screener needs and the two
-- insider columns required for the "% change in personal stake" rule.
--
--   * public.darkpool_prints   — per-print off-exchange block trades (48h
--                                clustering window; rolling retention).
--   * public.options_eod_daily — per (ticker, as_of_date) end-of-day options
--                                picture: scoring inputs + informational
--                                sentiment/vol metrics.
--   * public.insider_history   — ALTER: add shares_owned_before /
--                                shares_owned_after (already exposed by the
--                                Unusual Whales insider feed; not previously
--                                stored). officer_title already exists.
--
-- Both new tables are service-role-only ingestion tables (Pattern C). No
-- front-end tile reads them directly — the screener engine reads them and
-- writes pre-aggregated scoring output to the scan table the UI consumes.
--
-- Data Steward sign-off: Data Steward (lead). Senior Quant + Lead Developer
-- consulted. See Phase 1 of TRADING_OPPS_OVERHAUL_PLAN_2026-05-20.
-- =============================================================================

-- 1) DARK POOL PRINTS ---------------------------------------------------------
create table if not exists public.darkpool_prints (
    tracking_id          bigint primary key,   -- unique per print (UW)
    ticker               text        not null,
    executed_at          timestamptz not null, -- print execution time
    trf_executed_at      timestamptz,          -- TRF report time
    price                numeric,              -- print price
    size                 bigint,               -- shares in THIS block print
    day_volume           bigint,               -- cumulative session volume in the stock
    premium              numeric,              -- dollar value of the print
    nbbo_bid             numeric,
    nbbo_ask             numeric,
    nbbo_bid_quantity    integer,
    nbbo_ask_quantity    integer,
    sale_cond_codes      text,                 -- modifiers (e.g. Form T / late)
    ext_hour_sold_codes  text,
    market_center        text,
    trade_code           text,
    trade_settlement     text,
    canceled             boolean     not null default false,
    ingested_at          timestamptz not null default now()
);

create index if not exists ix_darkpool_prints_ticker_exec
    on public.darkpool_prints (ticker, executed_at desc);
create index if not exists ix_darkpool_prints_executed_at
    on public.darkpool_prints (executed_at desc);

grant all on public.darkpool_prints to service_role;
-- Service-only ingestion table (Pattern C). This project is pre-2026-10-30,
-- so new public tables still auto-grant to anon/authenticated — revoke that
-- explicitly so the table is genuinely service-only.
revoke all on public.darkpool_prints from anon, authenticated;

alter table public.darkpool_prints enable row level security;
-- no policies: service_role bypasses RLS; nothing else may read.

-- 2) OPTIONS END-OF-DAY DAILY -------------------------------------------------
create table if not exists public.options_eod_daily (
    ticker            text        not null,
    as_of_date        date        not null,
    -- informational aggregates (feed the Group 3 options columns) ------------
    call_volume       bigint,
    put_volume        bigint,
    put_call_ratio    numeric,
    net_premium       numeric,
    atm_iv            numeric,
    implied_move_7d   numeric,
    implied_move_30d  numeric,
    realized_vol_30d  numeric,
    -- scoring inputs: best fresh-positioning multiples among qualifying
    -- intermediate out-of-the-money contracts --------------------------------
    best_call_vol_oi  numeric,
    best_put_vol_oi   numeric,
    -- per-contract detail for the scorer + the Phase 2 backtest. Stored as a
    -- 7-60 DTE superset so the backtest can move the 14-45 DTE candidate
    -- window without a re-ingest. Each element:
    --   {option_symbol, type, strike, expiry, dte, volume, prev_oi,
    --    open_interest, ask_volume, bid_volume, sweep_volume,
    --    implied_volatility, delta, total_premium, vol_to_oi, pct_at_ask}
    contracts         jsonb,
    ingested_at       timestamptz not null default now(),
    primary key (ticker, as_of_date)
);

create index if not exists ix_options_eod_daily_date
    on public.options_eod_daily (as_of_date desc);

grant all on public.options_eod_daily to service_role;
-- Service-only ingestion table (Pattern C). This project is pre-2026-10-30,
-- so new public tables still auto-grant to anon/authenticated — revoke that
-- explicitly so the table is genuinely service-only.
revoke all on public.options_eod_daily from anon, authenticated;

alter table public.options_eod_daily enable row level security;
-- no policies: service_role bypasses RLS; nothing else may read.

-- 3) INSIDER HISTORY — add personal-stake columns -----------------------------
-- The Unusual Whales insider feed exposes shares_owned_before /
-- shares_owned_after on every Form 4 row; they were simply never stored.
-- They are required for the "% change in the executive's personal stake"
-- rule in the rebuilt insider scoring layer. Existing table — no new GRANT
-- needed; it keeps its current grants.
alter table public.insider_history
    add column if not exists shares_owned_before bigint,
    add column if not exists shares_owned_after  bigint;
