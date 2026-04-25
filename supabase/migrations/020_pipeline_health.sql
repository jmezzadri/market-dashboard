-- ============================================================================
-- Migration 020 — pipeline_health (data-freshness monitoring)
-- ============================================================================
-- Why
-- ---
-- Joe reports recurring "only one of my daily indicators updated today" noise
-- when in fact most are running — the confusion is data-date vs workflow-date
-- and missing per-indicator freshness signals. Also, when a fetch *silently*
-- fails (e.g. Yahoo throttles, FRED publishes an empty series) we have no
-- server-side detector.
--
-- This migration creates ONE table — `pipeline_health` — owned by a scheduled
-- edge function that re-computes per-indicator status on a 30-minute cadence
-- and is read by the frontend `useFreshness` hook to paint a 6px RAG dot
-- next to every indicator/composite/tile on the site.
--
-- Status is a simple RAG:
--     green  — last_good_at is within 1× expected cadence
--     amber  — last_good_at is within 1–2× expected cadence
--     red    — last_good_at is >2× expected cadence, OR missing, OR
--              last fetch errored
--
-- Alerts (Resend) fire on green→red transitions, debounced per indicator
-- at 1/day unless it recovers and re-breaks within the window.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_health (
  indicator_id               text        PRIMARY KEY,
  label                      text        NOT NULL,
  source                     text        NOT NULL,
  cadence                    text        NOT NULL CHECK (cadence IN ('D','W','M','Q')),
  expected_cadence_minutes   int         NOT NULL,
  last_good_at               timestamptz,
  last_check_at              timestamptz NOT NULL DEFAULT now(),
  last_value                 jsonb,
  last_error                 text,
  status                     text        NOT NULL DEFAULT 'red'
                                        CHECK (status IN ('green','amber','red')),
  -- Green→red transition tracking for debounced Resend alerts
  last_alerted_at            timestamptz,
  prev_status                text        CHECK (prev_status IN ('green','amber','red')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pipeline_health IS
  'Per-indicator freshness + health for the site-wide FreshnessDot UX. '
  'Written by the pipeline-health-check edge function (30-min cadence). '
  'Read anon by the frontend via useFreshness.';

COMMENT ON COLUMN public.pipeline_health.cadence IS
  'Expected release cadence: D=Daily, W=Weekly, M=Monthly, Q=Quarterly. '
  'Matches IND_FREQ in src/App.jsx.';

COMMENT ON COLUMN public.pipeline_health.expected_cadence_minutes IS
  'Minutes after which a non-update transitions status from green→amber. '
  '2× this value flips amber→red. Set per indicator to account for '
  'release-time offsets (e.g. Initial Claims is Thu 8:30am ET, not every 7d).';

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_health_status        ON public.pipeline_health(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_health_last_check_at ON public.pipeline_health(last_check_at DESC);

-- updated_at trigger (reuses touch_updated_at() from migration 001)
DROP TRIGGER IF EXISTS pipeline_health_touch_updated_at ON public.pipeline_health;
CREATE TRIGGER pipeline_health_touch_updated_at
  BEFORE UPDATE ON public.pipeline_health
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Read: anon (public site) can read everything — no PII in this table.
-- Write: service_role only (the edge function).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pipeline_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_health_read_anon     ON public.pipeline_health;
CREATE POLICY pipeline_health_read_anon
  ON public.pipeline_health
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy for anon — writes go through service_role.

-- ─── Seed from the indicator registry ───────────────────────────────────────
-- Keeps the migration idempotent — re-running does nothing for existing rows.
-- Cadence values mirror IND_FREQ in src/App.jsx (HEAD 2026-04-24).
--   D  →  1440 min (1d) expected, 2× = 2d before red
--   W  →  10080 min (7d), plus a ~24h tolerance for release-time offsets
--          built into the edge fn (not the table)
--   M  →  43200 min (30d)
--   Q  →  129600 min (90d)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  -- Daily
  ('vix',           'VIX',              'FRED VIXCLS',            'D', 1440, 'red'),
  ('hy_ig',         'HY–IG Spread',     'FRED BAML HY−IG',        'D', 1440, 'red'),
  ('eq_cr_corr',    'EQ–Credit Corr',   'FRED VIX × BAML (derived)','D', 1440, 'red'),
  ('yield_curve',   '10Y–2Y Slope',     'FRED T10Y2Y',            'D', 1440, 'red'),
  ('move',          'MOVE Index',       'Yahoo ^MOVE',            'D', 1440, 'red'),
  ('real_rates',    '10Y TIPS',         'FRED DFII10',            'D', 1440, 'red'),
  ('copper_gold',   'Copper/Gold Ratio','CME HG1 / GC1',          'D', 1440, 'red'),
  ('bkx_spx',       'BKX/SPX Ratio',    'Yahoo KBE / SPY',        'D', 1440, 'red'),
  ('usd',           'USD Index',        'Yahoo DX-Y.NYB',         'D', 1440, 'red'),
  ('skew',          'SKEW Index',       'Yahoo ^SKEW',            'D', 1440, 'red'),
  ('rrp',           'Reverse Repo',     'FRED RRPONTSYD',         'D', 1440, 'red'),
  ('breakeven_10y', '10Y Breakeven',    'FRED T10YIE',            'D', 1440, 'red'),
  ('hy_ig_etf',     'HY-IG ETF Proxy',  'Yahoo LQD ÷ HYG',        'D', 1440, 'red'),

  -- Weekly
  ('anfci',         'ANFCI',            'FRED ANFCI',             'W', 10080, 'red'),
  ('stlfsi',        'STLFSI',           'FRED STLFSI4',           'W', 10080, 'red'),
  ('cpff',          'USD Funding',      'FRED DCPF3M − DFF',      'W', 10080, 'red'),
  ('loan_syn',      'HY Eff. Yield',    'FRED BAMLH0A0HYM2EY',    'W', 10080, 'red'),
  ('bank_credit',   'Bank Credit',      'FRED TOTBKCR',           'W', 10080, 'red'),
  ('jobless',       'Init. Claims',     'FRED ICSA',              'W', 10080, 'red'),
  ('cmdi',          'CMDI',             'NY Fed CMDI',            'W', 10080, 'red'),
  ('term_premium',  'Kim–Wright 10Y',   'Fed Board KW',           'W', 10080, 'red'),
  ('fed_bs',        'Fed Balance Sheet','FRED WALCL',             'W', 10080, 'red'),
  ('bank_reserves', 'Bank Reserves',    'FRED WRESBAL',           'W', 10080, 'red'),
  ('tga',           'Treasury Cash',    'FRED WTREGEN',           'W', 10080, 'red'),

  -- Monthly
  ('cape',          'Shiller CAPE',     'Shiller dataset',        'M', 43200, 'red'),
  ('ism',           'ISM Mfg. PMI',     'ISM',                    'M', 43200, 'red'),
  ('jolts_quits',   'JOLTS Quits',      'FRED JTSQUR',            'M', 43200, 'red'),
  ('m2_yoy',        'M2 Money Supply',  'FRED M2SL',              'M', 43200, 'red'),
  ('cfnai',         'CFNAI',            'FRED CFNAI',             'M', 43200, 'red'),
  ('cfnai_3ma',     'CFNAI (3M Avg)',   'FRED CFNAI (3M roll)',   'M', 43200, 'red'),

  -- Quarterly
  ('sloos_ci',      'SLOOS C&I',        'FRED DRTSCILM',          'Q', 129600, 'red'),
  ('sloos_cre',     'SLOOS CRE',        'FRED DRTSCLCC',          'Q', 129600, 'red'),
  ('bank_unreal',   'Bank Unreal. Loss','FDIC QBP',               'Q', 129600, 'red'),
  ('credit_3y',     '3Y Credit Growth', 'FRED TOTBKCR (3yr)',     'Q', 129600, 'red')
ON CONFLICT (indicator_id) DO NOTHING;

-- Composite-level health rows — mirror the 3 composites on Today's Macro so
-- the dial-gauge cards can get their own dots without joining across multiple
-- indicator rows.
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('composite_rl', 'Risk & Liquidity composite', 'composite_history_daily.json', 'D', 1440, 'red'),
  ('composite_gr', 'Growth composite',           'composite_history_daily.json', 'D', 1440, 'red'),
  ('composite_ir', 'Inflation & Rates composite','composite_history_daily.json', 'D', 1440, 'red')
ON CONFLICT (indicator_id) DO NOTHING;
