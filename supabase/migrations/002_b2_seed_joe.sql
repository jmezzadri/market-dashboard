-- ============================================================================
-- Track B2 — Seed Joe's portfolio (one-time)
-- ============================================================================
-- Inserts Joe's 6 accounts + 16 positions into the B2 tables, under his
-- auth.users row. Runs as role `postgres` in the Supabase SQL editor, which
-- bypasses RLS (the writes still set user_id correctly so RLS-scoped reads
-- return them afterward).
--
-- Idempotent: wrapped in a transaction that first deletes any existing rows
-- for Joe, then re-inserts. Safe to re-run if the bundled portfolio changes.
--
-- user_id comes from: select id from auth.users where email = 'josephmezzadri@gmail.com';
-- Value at time of seed: 83cd9e76-eb35-4581-864e-9517e13e9be0
-- ============================================================================

-- Pin Joe's user_id so every row tags correctly.
-- (DO block is atomic — the whole thing rolls back on any error.)
do $$
declare
  joe uuid := '83cd9e76-eb35-4581-864e-9517e13e9be0';
  brokerage_id uuid;
  k401_id      uuid;
  roth_id      uuid;
  s529_id      uuid;
  e529_id      uuid;
  hsa_id       uuid;
begin
  -- Idempotency: clear any prior Joe rows so re-run is clean.
  delete from public.positions where user_id = joe;
  delete from public.accounts  where user_id = joe;
  delete from public.watchlist where user_id = joe;

  -- ── Accounts ──────────────────────────────────────────────────────────────
  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'JPM Taxable Brokerage', 'Margin · J.P. Morgan', '#3b82f6', true,
          'Active trading account — concentrated tactical positions in cyclicals + commodity producers. Chase sweep cash is dry powder.', 0)
  returning id into brokerage_id;

  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'EY 401(k)', 'Pre-tax · Account 86964', '#6366f1', false,
          'Pre-tax retirement — single-fund allocation. ~67% of total investable wealth sits in HY credit via this one fund. Limited to plan funds; no individual securities.', 1)
  returning id into k401_id;

  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'Roth IRA', 'Tax-free · Fidelity 23643', '#30d158', true,
          'Tax-free compounding — best home for highest-conviction, longest-duration assets. Currently small balance with diversified satellite holdings.', 2)
  returning id into roth_id;

  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'Scarlett 529', 'NH 529 · Account 6034', '#ff9f0a', false,
          'College savings — 100% international equity. Limited to NH 529 plan funds; no individual stocks. Long horizon supports the allocation but single-fund concentration warrants a glide-path plan.', 3)
  returning id into s529_id;

  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'Ethan 529', 'NH 529 · Account 6185', '#f97316', false,
          'College savings — same 100% international equity allocation as Scarlett''s account, larger balance. Limited to NH 529 plan funds.', 4)
  returning id into e529_id;

  insert into public.accounts (user_id, label, sub, color, tactical, note, sort_order)
  values (joe, 'Health Savings Account', 'Triple tax-adv · Fidelity 23567', '#00d4a0', true,
          'Triple tax-advantaged — contribute the family max and invest long-term. Treat as stealth retirement; never withdraw if cash flow allows.', 5)
  returning id into hsa_id;

  -- ── Positions ─────────────────────────────────────────────────────────────
  -- Brokerage
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, brokerage_id, 'CCJ',   'Cameco Corp',                      400,   120.665, 117.35, 48266, 'Materials',  1.40,
     'Uranium leader — 43% of brokerage and the largest single-stock position in the book. Beta ~1.4. Concentration warrants a stop discipline; PT $140 / SL $99 from scanner.',
     null, 0),
    (joe, brokerage_id, 'RCAT',  'Red Cat Holdings',                 2000,  13.43,   16.87,  26860, 'Technology', 2.50,
     'Small-cap drone/AI defense play — 24% of brokerage. Beta ~2.5, very high vol. Wash-sale flagged on this lot — taxable-loss harvesting limited until the 30-day window passes.',
     null, 1),
    (joe, brokerage_id, 'OXY',   'Occidental Petroleum',             500,   52.26,   64.95,  26130, 'Energy',     1.20,
     'Energy major — 23% of brokerage. Berkshire still anchors the float; buyback yield supports downside. Trim only if energy regime shifts.',
     null, 2),
    (joe, brokerage_id, 'QACDS', 'Chase Brokerage Sweep',            9795,  1.00,    1.00,   9795,  'Cash',       0.00,
     '~9% cash in brokerage — deployable dry powder. Reasonable sizing given the all-equity, 3-name concentration above. Consider building toward 15% if the composite moves to Elevated.',
     'var(--text-dim)', 3);

  -- 401(k)
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, k401_id, 'JHYUX', 'JPMorgan High Yield Fund (R6)', 53188, 6.59, 6.53, 350506, 'HY Bonds', 0.50,
     '100% of the 401(k) and ~67% of total investable wealth. Diversified within HY credit (hundreds of issuers), but the whole position carries that asset class''s credit-spread risk — JHYUX correlates more with equity than with Treasuries and behaves like a defensive equity sleeve, not a duration hedge. Currently +0.9% on cost. At Elevated regime, expect 8–15% drawdowns.',
     null, 0);

  -- Roth
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, roth_id, 'RCAT',  'Red Cat Holdings',               129, 13.57,  6.07,  1756, 'Technology', 2.50,
     '21% of Roth. Same name as the brokerage holding — total household exposure to RCAT is ~$28.6K. Roth placement is correct for high-vol asymmetric upside.',
     null, 0),
    (joe, roth_id, 'FSKAX', 'Fidelity Total Market Index',    8.1, 193.37, 123.24, 1569, 'US Equity', 1.00,
     'Broad US market core — 19% of Roth. Right asset in the right account; let it compound.',
     null, 1),
    (joe, roth_id, 'FBTC',  'Fidelity Wise Origin Bitcoin',   20,  67.75,  91.89,  1355, 'Crypto',    2.50,
     'BTC exposure — 17% of Roth. Tax-free is the optimal home for crypto. Sizing is appropriate at this conviction level.',
     null, 2),
    (joe, roth_id, 'GLD',   'SPDR Gold Trust',                3,   447.515, 463.92, 1343, 'Metals',   0.05,
     'Gold hedge — 16% of Roth. Diversifier.',
     null, 3),
    (joe, roth_id, 'SLV',   'iShares Silver Trust',           15,  74.85,  99.75,  1123, 'Metals',   0.30,
     'Silver — 14% of Roth. Higher beta than gold; both industrial and monetary.',
     null, 4),
    (joe, roth_id, 'SPAXX', 'Fidelity Govt Money Market',     531, 1.00,   1.00,   531,  'Cash',     0.00,
     'Cash sweep — 6% of Roth. Fine as a small buffer; deploy if balance grows.',
     'var(--text-dim)', 5),
    (joe, roth_id, 'ETHE',  'Grayscale Ethereum Trust',       25,  19.84,  31.56,  496,  'Crypto',   3.00,
     'ETH exposure — 6% of Roth. Legacy Grayscale wrapper has expense-ratio drag vs. spot ETF alternatives. Consider rolling to ETHA/ETHE-equivalent spot product on next add.',
     null, 6);

  -- Scarlett 529
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, s529_id, 'NHXINT906', 'NH International Index', 359, 25.63, 19.51, 9194, 'Intl Equity', 0.85,
     '100% intl equity — +31% on cost. Heavy regional concentration relative to a typical age-based 529 portfolio. Consider blending to a target-enrollment fund as horizon shortens.',
     null, 0);

  -- Ethan 529
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, e529_id, 'NHXINT906', 'NH International Index', 1345, 25.63, 15.43, 34473, 'Intl Equity', 0.85,
     '100% intl equity — +66% on cost. Largest 529 holding. Same single-fund concentration call as Scarlett''s account; revisit at age-based glide-path checkpoints.',
     null, 0);

  -- HSA
  insert into public.positions (user_id, account_id, ticker, name, quantity, price, avg_cost, value, sector, beta, analysis, color, sort_order) values
    (joe, hsa_id, 'FXAIX', 'Fidelity 500 Index Fund',     28,   244.69, 183.24, 6841, 'US Equity', 1.00,
     'S&P 500 core — 80% of HSA. Correct asset for the most tax-advantaged account in the stack.',
     null, 0),
    (joe, hsa_id, 'FDRXX', 'Fidelity Govt Money Market',  1747, 1.00,   1.00,   1747, 'Cash',     0.00,
     '20% cash buffer — slightly high. Keep $1.5–2K for near-term medical, deploy the rest into FXAIX.',
     'var(--text-dim)', 1);

  -- ── Watchlist (seed with Joe's existing fallback list) ─────────────────────
  insert into public.watchlist (user_id, ticker, name, theme, sort_order) values
    (joe, 'BTCUSD', 'Bitcoin',              'Crypto · spot exposure via FBTC', 0),
    (joe, 'ETHUSD', 'Ethereum',             'Crypto · spot exposure via ETHE', 1),
    (joe, 'NVDA',   'NVIDIA Corp',          'AI / Semis',                      2),
    (joe, 'AMAT',   'Applied Materials',    'Semi capex',                      3),
    (joe, 'CRWD',   'CrowdStrike',          'Cyber',                           4),
    (joe, 'CAT',    'Caterpillar',          'Cyclical / Capex',                5),
    (joe, 'MP',     'MP Materials',         'Rare earth',                      6),
    (joe, 'KTOS',   'Kratos Defense',       'Defense / drones',                7),
    (joe, 'AVAV',   'AeroVironment',        'Defense / drones',                8),
    (joe, 'ONDS',   'Ondas Holdings',       'Defense / drones',                9),
    (joe, 'LUNR',   'Intuitive Machines',   'Space / lunar',                   10);

end $$;

-- Verify seed worked:
--   select count(*) as accts   from public.accounts   where user_id = '83cd9e76-eb35-4581-864e-9517e13e9be0';
--   select count(*) as pos     from public.positions  where user_id = '83cd9e76-eb35-4581-864e-9517e13e9be0';
--   select count(*) as watches from public.watchlist  where user_id = '83cd9e76-eb35-4581-864e-9517e13e9be0';
-- Expected: 6, 16, 11.
