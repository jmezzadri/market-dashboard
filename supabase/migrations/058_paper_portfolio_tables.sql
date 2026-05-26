-- 058_paper_portfolio_tables.sql
-- Paper Trading Portfolio — signal-validation engine
-- Sleeve A = $500K following Asset Tilt IG ETF weights
-- Sleeve B = $500K following Equity Scanner buy-side; up to 2x leverage on overflow
-- Joe directive 2026-05-26; spec locked same day
-- Council: Lead Dev (schema) + Senior Quant (math fields) + Data Steward (pipelines)

BEGIN;

-- Paper account registry (one row per Alpaca paper account)
CREATE TABLE IF NOT EXISTS public.paper_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number text NOT NULL UNIQUE,
  broker text NOT NULL DEFAULT 'alpaca_paper',
  starting_capital numeric NOT NULL,
  sleeve_a_allocation numeric NOT NULL,
  sleeve_b_allocation numeric NOT NULL,
  max_leverage_sleeve_b numeric NOT NULL DEFAULT 2.0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pre-submission order intent log (every order MacroTilt wants to send)
CREATE TABLE IF NOT EXISTS public.paper_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sleeve text NOT NULL CHECK (sleeve IN ('A', 'B')),
  ticker text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type text NOT NULL DEFAULT 'market_on_open',
  target_quantity numeric,
  target_notional numeric,
  signal_score integer,
  signal_source text NOT NULL CHECK (signal_source IN ('asset_tilt', 'equity_scanner')),
  rebalance_trigger_reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'filled', 'partially_filled', 'cancelled', 'rejected', 'expired')),
  alpaca_order_id text UNIQUE,
  submitted_at timestamptz,
  filled_at timestamptz,
  rejection_reason text
);
CREATE INDEX IF NOT EXISTS idx_paper_orders_status_created ON public.paper_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_orders_sleeve_ticker ON public.paper_orders (sleeve, ticker);

-- Actual fills from Alpaca (post-execution)
CREATE TABLE IF NOT EXISTS public.paper_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alpaca_order_id text NOT NULL REFERENCES public.paper_orders (alpaca_order_id) ON DELETE CASCADE,
  alpaca_fill_id text NOT NULL UNIQUE,
  sleeve text NOT NULL CHECK (sleeve IN ('A', 'B')),
  ticker text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity numeric NOT NULL,
  price numeric NOT NULL,
  gross_amount numeric NOT NULL,
  fees numeric DEFAULT 0,
  filled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paper_fills_filled_at ON public.paper_fills (filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_fills_sleeve_ticker ON public.paper_fills (sleeve, ticker);

-- Position snapshot (refreshed nightly + on rebalance)
CREATE TABLE IF NOT EXISTS public.paper_positions (
  snapshot_date date NOT NULL,
  sleeve text NOT NULL CHECK (sleeve IN ('A', 'B')),
  ticker text NOT NULL,
  quantity numeric NOT NULL,
  avg_cost numeric NOT NULL,
  market_value numeric NOT NULL,
  unrealized_pnl numeric NOT NULL,
  current_score integer,
  last_updated timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, sleeve, ticker)
);
CREATE INDEX IF NOT EXISTS idx_paper_positions_date ON public.paper_positions (snapshot_date DESC);

-- Daily NAV snapshot
CREATE TABLE IF NOT EXISTS public.paper_nav_daily (
  snapshot_date date PRIMARY KEY,
  sleeve_a_cash numeric NOT NULL,
  sleeve_a_equity numeric NOT NULL,
  sleeve_a_nav numeric NOT NULL,
  sleeve_b_cash numeric NOT NULL,
  sleeve_b_equity numeric NOT NULL,
  sleeve_b_margin_used numeric NOT NULL DEFAULT 0,
  sleeve_b_nav numeric NOT NULL,
  total_nav numeric NOT NULL,
  benchmark_spy_value numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Signal-state capture at each rebalance (for replay/audit)
CREATE TABLE IF NOT EXISTS public.paper_signal_capture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  signal_source text NOT NULL CHECK (signal_source IN ('asset_tilt', 'equity_scanner')),
  signal_payload jsonb NOT NULL,
  triggered_orders_count integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_paper_signal_capture_at ON public.paper_signal_capture (captured_at DESC);

-- RLS: site reads via anon (single-tenant — Joe's paper data); writes via service_role only
ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_nav_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_signal_capture ENABLE ROW LEVEL SECURITY;

CREATE POLICY paper_accounts_read ON public.paper_accounts FOR SELECT TO anon USING (true);
CREATE POLICY paper_orders_read ON public.paper_orders FOR SELECT TO anon USING (true);
CREATE POLICY paper_fills_read ON public.paper_fills FOR SELECT TO anon USING (true);
CREATE POLICY paper_positions_read ON public.paper_positions FOR SELECT TO anon USING (true);
CREATE POLICY paper_nav_daily_read ON public.paper_nav_daily FOR SELECT TO anon USING (true);
CREATE POLICY paper_signal_capture_read ON public.paper_signal_capture FOR SELECT TO anon USING (true);

-- Seed the active paper account row
INSERT INTO public.paper_accounts (
  account_number, starting_capital, sleeve_a_allocation, sleeve_b_allocation,
  max_leverage_sleeve_b, notes
) VALUES (
  'PA3ENEE9XT8L', 1000000, 500000, 500000, 2.0,
  'Initial paper portfolio. Sleeve A = Asset Tilt IG ETFs at recommended weights. Sleeve B = Equity Scanner long-only, score >= 5 buy / < 5 exit, $50K/$40K/$30K sizing by score tier, up to 2x leverage when signals exceed $500K.'
) ON CONFLICT (account_number) DO NOTHING;

COMMIT;
