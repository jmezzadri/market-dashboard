-- 060_seed_new_feed_health.sql
-- Seed pipeline_health rows for the Macro Overview commodity, FX, and
-- positioning feeds added 2026-06-02. The 30-minute pipeline-health-check
-- edge function ONLY updates rows that already exist — so without these seeds
-- the new feeds stay invisible to Admin·Data and would render "fake-green"
-- (untracked → green by default). After this migration:
--   • commodity + FX rows are matched to their indicator_history.json keys by
--     the edge function's generic lookup → data_as_of populated, real RAG.
--   • cftc-cot reads public/cot_positioning.json (the edge function needs a
--     FILE_MAP entry for it — see companion edge-function change).
-- cadence codes: D=daily, W=weekly. expected_cadence_minutes mirrors the
-- existing seed convention (daily 1440, weekly 10080).

INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('cmdty_gold',     'Gold',          'yahoo', 'D', 1440,  'green'),
  ('cmdty_silver',   'Silver',        'yahoo', 'D', 1440,  'green'),
  ('cmdty_copper',   'Copper',        'yahoo', 'D', 1440,  'green'),
  ('cmdty_uranium',  'Uranium',       'yahoo', 'W', 10080, 'green'),
  ('cmdty_oil',      'Crude oil',     'yahoo', 'D', 1440,  'green'),
  ('cmdty_natgas',   'Natural gas',   'yahoo', 'D', 1440,  'green'),
  ('cmdty_corn',     'Corn',          'yahoo', 'D', 1440,  'green'),
  ('cmdty_soybeans', 'Soybeans',      'yahoo', 'D', 1440,  'green'),
  ('cmdty_wheat',    'Wheat',         'yahoo', 'D', 1440,  'green'),
  ('fx_eur',         'Euro',          'yahoo', 'D', 1440,  'green'),
  ('fx_jpy',         'Japanese yen',  'yahoo', 'D', 1440,  'green'),
  ('fx_gbp',         'British pound', 'yahoo', 'D', 1440,  'green'),
  ('cftc-cot',       'CFTC positioning', 'cftc', 'W', 10080, 'green')
ON CONFLICT (indicator_id) DO NOTHING;
