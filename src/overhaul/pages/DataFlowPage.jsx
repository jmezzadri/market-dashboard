/* DataFlowPage — end-to-end data lineage dashboard.

   Single E2E surface that shows every external source, every derived
   indicator bucket, every modelled engine, every live surface, and every
   downstream workflow. Replaces the per-vendor admin views.

   Behaviour:
     - Status dots on source tiles read from live pipeline_health via the
       useDataHealth hook (60s cache + tab-focus refresh).
     - Click any tile -> draws full transitive upstream + downstream chain
       (BFS in both directions on the edge list below), dims unconnected
       tiles, paints SVG curves on the connector layer.
     - Click again or click empty space -> clears the lineage.
     - Drawer below renders rich content per tile from TILE_DETAILS.
       Asset tilt allocator gets the special SectorAllocationDrawer that
       breaks out the three input groups + static config.

   Edges are derived from a live-code audit. Sources are connected to the
   SPECIFIC derived buckets they feed — not via a hub fan-out — so
   clicking ISM only lights up the growth chain.

   Theming uses --mt-* tokens from tokens.css, so the page picks up the
   existing light / dark / navy themes via data-mt-theme on <html>.
*/

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useDataHealth, VENDOR_MONTHLY_COST } from '../../hooks/useDataHealth';

const EDGES = [
  // Sources -> Indicator History Compiler
  ['fred', 'ihc'], ['treasury', 'ihc'], ['yahoo', 'ihc'], ['multpl', 'ihc'],
  ['naaim', 'ihc'], ['gdpnow', 'ihc'], ['ism', 'ihc'], ['fdic', 'ihc'],

  // Sources -> Derived buckets (specific, no hub fan-out)
  ['fred', 'rates'], ['fred', 'credit'], ['fred', 'liquidity'], ['fred', 'growth'], ['fred', 'twoaxis'],
  ['treasury', 'rates'],
  ['yahoo', 'positioning'], ['yahoo', 'commodity'], ['yahoo', 'credit'], ['yahoo', 'twoaxis'],
  ['multpl', 'valuation'],
  ['naaim', 'positioning'],
  ['gdpnow', 'growth'],
  ['ism', 'growth'],
  ['fdic', 'credit'],

  // Sources that bypass derived
  ['polygon', 'scanner'], ['polygon', 'sectorperf'],
  ['uw', 'scanner'],
  ['nasdaq', 'scanner'],
  ['congress', 'scanner'],
  ['spdr', 'asset_tilt'],
  ['zh', 'commentary'],
  ['broker', 'insights'],

  // Derived -> Engines
  ['rates', 'v11'], ['rates', 'cv2'],
  ['credit', 'v11'], ['credit', 'cv2'],
  ['liquidity', 'v11'], ['liquidity', 'cv2'],
  ['growth', 'v11'], ['growth', 'cv2'],
  ['valuation', 'v11'], ['valuation', 'cv2'],
  ['positioning', 'v11'], ['positioning', 'cv2'], ['positioning', 'twoaxis'],
  ['commodity', 'v11'],

  // Engines -> Surfaces
  ['ihc', 'indicators'], ['ihc', 'methodology'],
  ['v11', 'asset_tilt'], ['v11', 'overview'], ['v11', 'home'], ['v11', 'methodology'],
  ['cv2', 'overview'], ['cv2', 'indicators'],
  ['twoaxis', 'asset_tilt'], ['twoaxis', 'overview'], ['twoaxis', 'allocation'],
  ['asset_tilt', 'allocation'], ['asset_tilt', 'home'], ['asset_tilt', 'methodology'], ['asset_tilt', 'scenarios'],
  ['scanner', 'ops'], ['scanner', 'home'], ['scanner', 'methodology'],
  ['stress', 'scenarios'],
  ['sectorperf', 'allocation'], ['sectorperf', 'indicators'],

  // Engines -> Workflows
  ['asset_tilt', 'alpaca'],
  ['scanner', 'alpaca'],

  // Workflows -> Surfaces
  ['alpaca', 'paper'],
];

function bfs(start, dir) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift();
    for (const [a, b] of EDGES) {
      let next = null;
      if (dir === 'down' && a === n) next = b;
      if (dir === 'up' && b === n) next = a;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(start);
  return Array.from(seen);
}

// ---------- Tile config ----------
const COL1_EQUITY = [
  { id: 'polygon', name: 'Polygon Massive', cd: 'Daily · 4:30 PM ET' },
  { id: 'uw', name: 'Unusual Whales', cd: '3×/day · intraday' },
  { id: 'yahoo', name: 'Yahoo Finance', cd: 'Daily · close' },
  { id: 'nasdaq', name: 'Nasdaq / FINRA', cd: 'Daily · short interest' },
  { id: 'spdr', name: 'SPDR sector weights', cd: 'Daily · 6 AM ET' },
];

const COL1_MACRO = [
  { id: 'fred', name: 'FRED', cd: 'Daily · ~30 series' },
  { id: 'treasury', name: 'US Treasury', cd: 'Daily · 4 PM ET' },
  { id: 'ism', name: 'ISM PMI release', cd: 'Monthly', manual: true },
  { id: 'naaim', name: 'NAAIM exposure', cd: 'Weekly' },
  { id: 'gdpnow', name: 'Atlanta Fed GDPNow', cd: 'Bi-weekly' },
  { id: 'multpl', name: 'multpl.com CAPE', cd: 'Monthly' },
  { id: 'zh', name: 'ZeroHedge premium', cd: 'Weekly' },
  { id: 'congress', name: 'Congress roster', cd: 'Monthly' },
  { id: 'fdic', name: 'FDIC HTM losses', cd: 'Quarterly', manual: true },
  { id: 'broker', name: 'Broker CSV (Chase)', cd: 'Ad-hoc', manual: true },
];

const COL2_DERIVED = [
  { id: 'rates', name: 'Rates & curve', cd: '6 metrics' },
  { id: 'credit', name: 'Credit', cd: '6 metrics' },
  { id: 'liquidity', name: 'Liquidity & money', cd: '4 metrics' },
  { id: 'growth', name: 'Growth', cd: '2 metrics + ISM, GDPNow' },
  { id: 'valuation', name: 'Valuation', cd: '2 metrics' },
  { id: 'positioning', name: 'Positioning & vol', cd: '3 metrics' },
  { id: 'commodity', name: 'Commodity & sector', cd: '2 metrics' },
];

const COL3_ENGINES = [
  { id: 'ihc', name: 'Indicator history compiler', cd: 'Daily · 6 AM & 6 PM' },
  { id: 'v11', name: 'Cycle mechanism board', cd: 'Nightly · 6 macro scores' },
  { id: 'cv2', name: 'Cycle board (horizon-aware)', cd: 'Daily + Sat weekly' },
  { id: 'twoaxis', name: '2-axis engine', cd: 'Stress · yield direction' },
  { id: 'asset_tilt', name: 'Asset tilt allocator', cd: 'Daily · 8:15 AM ET' },
  { id: 'scanner', name: 'Trading opps scanner', cd: '3:30 / 5:30 / 9:30 ET' },
  { id: 'stress', name: 'Scenario stress (CCAR)', cd: 'Weekly' },
  { id: 'sectorperf', name: 'Sector performance compute', cd: 'Daily' },
];

const COL4_SURFACES = [
  { id: 'home', name: 'Home', cd: 'Tile dashboard' },
  { id: 'overview', name: 'Macro overview', cd: 'Cycle board page' },
  { id: 'allocation', name: 'Asset tilt', cd: 'Sector / IG / defensive' },
  { id: 'ops', name: 'Trading ops', cd: 'Named tickers' },
  { id: 'insights', name: 'Portfolio insights', cd: 'Real positions' },
  { id: 'paper', name: 'Paper portfolio', cd: 'Alpaca mirror' },
  { id: 'scenarios', name: 'Scenario analysis', cd: 'CCAR stress' },
  { id: 'indicators', name: 'All indicators', cd: '36-indicator grid' },
  { id: 'methodology', name: 'Methodology', cd: 'Calibration tables' },
];

const COL4_WORKFLOWS = [
  { id: 'alpaca', name: 'Alpaca paper queue', cd: 'Daily · 9 AM ET' },
  { id: 'alerts', name: 'Email alerts', cd: 'Resend · on-event' },
  { id: 'triage', name: 'Bug triage loop', cd: 'Resend + GitHub' },
  { id: 'commentary', name: 'News commentary', cd: 'Threshold-gated' },
];

// ---------- Source tile -> canonical vendor (for live freshness lookup) ----------
const VENDOR_BY_TILE = {
  polygon:  'Polygon Massive',
  uw:       'Unusual Whales',
  yahoo:    'Yahoo Finance',
  nasdaq:   'Nasdaq / FINRA',
  spdr:     'State Street SPDR',
  fred:     'FRED',
  treasury: 'U.S. Treasury',
  ism:      'ISM',
  naaim:    null,
  gdpnow:   'FRED',
  multpl:   'Shiller dataset',
  zh:       'ZeroHedge',
  congress: 'GitHub public roster',
  fdic:     'FDIC',
  broker:   null,
};

// ---------- Per-tile drawer content ----------
const TILE_DETAILS = {
  // -- Sources --
  polygon: {
    role: 'source',
    desc: 'End-of-day equity prices for ~12,600 US-listed tickers, plus ticker reference (name, SIC, sector, industry group), dividends, splits, sector ETF performance, and the master universe.',
    consumers: {
      engines: ['Trading opps scanner', 'Sector performance compute'],
      surfaces: ['Trading ops (prices, day change, sector)', 'Portfolio insights (position marks)', 'Asset tilt (sector performance)'],
      workflows: [],
    },
  },
  uw: {
    role: 'source',
    desc: 'Per-ticker universe snapshot, insider trades, options flow alerts, dark-pool prints, per-contract EOD options, congress trades, analyst ratings, news event streams, earnings history.',
    consumers: {
      engines: ['Trading opps scanner', 'Dark-pool scoring layer', 'Options scoring layer'],
      surfaces: ['Trading ops (composite scores)', 'Portfolio insights (option marks)', 'All indicators (IV rank, earnings)'],
      workflows: [],
    },
  },
  yahoo: {
    role: 'source',
    desc: 'Free market data for indices and macro-sensitive ETFs: ^MOVE, ^SKEW, GLD, SPY, KBE, HG=F (copper), GC=F (gold), HYG, LQD. Used for both macro signals and price fallback.',
    consumers: {
      engines: ['Indicator history compiler', '2-axis engine (MOVE)'],
      surfaces: ['All indicators (MOVE, SKEW)', 'Macro overview (positioning + commodity)'],
      workflows: [],
    },
  },
  nasdaq: {
    role: 'source',
    desc: 'Bi-monthly settlement short-interest print, published via Nasdaq/FINRA. Feeds the short-interest sub-score on the Trading Opps scanner.',
    consumers: {
      engines: ['Trading opps scanner'],
      surfaces: ['Trading ops (short interest column)'],
      workflows: [],
    },
  },
  spdr: {
    role: 'source',
    desc: 'SPY GICS sector weights from the SPDR holdings file. Used as the benchmark against which Asset Tilt computes vs-SPY deltas.',
    consumers: {
      engines: ['Asset tilt allocator'],
      surfaces: ['Asset tilt (vs-SPY column)'],
      workflows: [],
    },
  },
  fred: {
    role: 'source',
    desc: '~30 macro series including HY/IG OAS, jobless claims, M2, balance sheet WALCL, term premium, RRP, SLOOS, and rate series (DGS10, DGS2, DFF, SOFR, CP yields).',
    consumers: {
      engines: ['Indicator history compiler', '2-axis engine (DGS10)'],
      surfaces: ['Macro overview', 'All indicators', 'Methodology'],
      workflows: [],
    },
  },
  treasury: {
    role: 'source',
    desc: 'Daily par yields (1Mo–30Y nominal) and TIPS real yields from home.treasury.gov. Published same-day around 4 PM ET. Replaced FRED for same-day Treasury coverage in May 2026.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (yield curve)', 'All indicators (10Y, 2Y, breakevens)'],
      workflows: [],
    },
  },
  ism: {
    role: 'source',
    desc: 'Monthly Purchasing Managers Index release. Currently scraped from TradingEconomics. Feeds the Growth cycle mechanism — and only the Growth mechanism — despite being a high-attention release.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (Growth mechanism)', 'All indicators (ISM PMI)'],
      workflows: [],
    },
  },
  naaim: {
    role: 'source',
    desc: 'Weekly NAAIM Active-Manager Exposure Index — a positioning indicator scraped from naaim.org. Feeds the Positioning & Breadth mechanism.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (Positioning mechanism)', 'All indicators'],
      workflows: [],
    },
  },
  gdpnow: {
    role: 'source',
    desc: 'Atlanta Fed GDPNow nowcast, ingested via the FRED GDPNOW series. Refreshes bi-weekly when the Atlanta Fed publishes an update.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (Growth mechanism)', 'All indicators'],
      workflows: [],
    },
  },
  multpl: {
    role: 'source',
    desc: 'Shiller CAPE ratio, scraped monthly from multpl.com with a curated anchor fallback for missed scrapes. Feeds the Valuation mechanism and the Equity Risk Premium derived indicator.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (Valuation mechanism)', 'All indicators (CAPE, ERP)'],
      workflows: [],
    },
  },
  zh: {
    role: 'source',
    desc: 'ZeroHedge premium feed, cookie-authenticated. A weekly cookie health-check workflow emails Joe to refresh the cookie when it nears expiry.',
    consumers: {
      engines: [],
      surfaces: ['Ticker detail (commentary)', 'Home (news strip)'],
      workflows: ['News commentary'],
    },
  },
  congress: {
    role: 'source',
    desc: 'Members of Congress roster JSON (unitedstates/congress-legislators on GitHub, CC0). Refreshes monthly with a PR on diff. Used to attach member names to congressional trade activity.',
    consumers: {
      engines: ['Trading opps scanner'],
      surfaces: ['Trading ops (congress trades column)'],
      workflows: [],
    },
  },
  fdic: {
    role: 'source',
    desc: 'FDIC Quarterly Banking Profile — bank unrealized HTM losses. Manually updated quarterly via a curated anchor list because the underlying FDIC publication is PDF-based.',
    consumers: {
      engines: ['Indicator history compiler'],
      surfaces: ['Macro overview (Credit mechanism)', 'All indicators (bank stress)'],
      workflows: [],
    },
  },
  broker: {
    role: 'source',
    desc: 'Chase J.P. Morgan transaction CSV uploads. Joe uploads broker statements ad-hoc to reconcile Portfolio Insights against the real account. Wash-sale handling matches broker-reported realized P&L.',
    consumers: {
      engines: [],
      surfaces: ['Portfolio insights (positions, trade history, realized P&L)'],
      workflows: [],
    },
  },

  // -- Derived --
  rates: {
    role: 'derived',
    desc: 'Six rates-and-curve derived indicators: 10Y-2Y slope, 10Y breakeven inflation, term premium, real Fed funds rate, 3-month Δ 10Y in bps, and 10Y yield 5-year percentile.',
    consumers: {
      engines: ['Cycle mechanism board (Funding mechanism)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  credit: {
    role: 'derived',
    desc: 'Six credit derived indicators: HY-IG spread, HY/IG ratio, HY/IG ETF proxy (HYG/LQD), commercial paper minus Fed funds spread, FRA-OIS modern proxy, and the CMDI distress proxy.',
    consumers: {
      engines: ['Cycle mechanism board (Credit mechanism)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  liquidity: {
    role: 'derived',
    desc: 'Four liquidity-and-money derived indicators: M2 year-over-year, Fed balance sheet year-over-year, three-year bank credit growth, and bank credit year-over-year.',
    consumers: {
      engines: ['Cycle mechanism board (Liquidity & Policy mechanism)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  growth: {
    role: 'derived',
    desc: 'Growth bucket: two derived indicators (CFNAI 3-month moving average, jobless claims 4-week moving average) plus the direct ISM Manufacturing and Services PMI prints and the Atlanta Fed GDPNow nowcast.',
    consumers: {
      engines: ['Cycle mechanism board (Growth mechanism)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  valuation: {
    role: 'derived',
    desc: 'Two valuation derived indicators: the Buffett indicator (corporate equities divided by GDP) and the Equity Risk Premium (1/CAPE minus 10Y yield).',
    consumers: {
      engines: ['Cycle mechanism board (Valuation mechanism)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  positioning: {
    role: 'derived',
    desc: 'Three positioning-and-volatility derived indicators: MOVE 5-year percentile, NAAIM exposure index, and 63-day rolling equity-credit correlation (SPY vs HYG).',
    consumers: {
      engines: ['Cycle mechanism board (Positioning & Breadth)', '2-axis engine (MOVE)', 'Cycle board (horizon-aware)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },
  commodity: {
    role: 'derived',
    desc: 'Two commodity-and-sector derived indicators: Copper/Gold ratio (HG/GC × 100) and BKX/SPX (banks versus market).',
    consumers: {
      engines: ['Cycle mechanism board (growth signal)'],
      surfaces: ['Macro overview', 'All indicators'],
      workflows: [],
    },
  },

  // -- Engines --
  ihc: {
    role: 'engine',
    desc: 'Indicator History Compiler. Pulls all macro sources nightly and twice daily, derives every indicator above, and writes the consolidated indicator_history.json that the rest of the engine and surface chain reads from.',
    owner: 'Senior Quant + Lead Dev',
    output: 'indicator_history.json',
    consumers: {
      engines: ['Cycle mechanism board', 'Cycle board (horizon-aware)', '2-axis engine'],
      surfaces: ['All indicators (36-indicator grid)', 'Methodology'],
      workflows: [],
    },
  },
  v11: {
    role: 'engine',
    desc: 'The Cycle Mechanism Board. Scores six macro mechanisms 0–100 each via direction-corrected percentile averaging of their constituent indicators. The six are Valuation, Credit, Funding, Growth, Liquidity & Policy, and Positioning & Breadth.',
    owner: 'Senior Quant',
    output: 'cycle_board_snapshot.json',
    consumers: {
      engines: ['Asset tilt allocator'],
      surfaces: ['Macro overview (the anchor)', 'Home (cycle tile)', 'Methodology'],
      workflows: [],
    },
  },
  cv2: {
    role: 'engine',
    desc: 'Horizon-aware variant of the cycle board. Computes per-indicator Spearman information coefficients against SPY forward returns at 1, 3, 6, and 12-month horizons; produces seven sub-composites and three headline gauges (Cycle & Value, Market Stress, Real Economy).',
    owner: 'Senior Quant',
    output: 'cycle_v2.json',
    consumers: {
      engines: [],
      surfaces: ['Macro overview (horizon panel)', 'All indicators (sub-composites)'],
      workflows: [],
    },
  },
  twoaxis: {
    role: 'engine',
    desc: 'MacroTilt 2-axis engine. Axis 1 (Stress) reads MOVE trailing 5-year percentile and maps to Risk On / Watch / Risk Off bands and equity allocation 100% / 80% / 50%. Axis 2 (Yield Direction) reads the 3-month Δ 10Y 5-year percentile and maps to Inflationary / Neutral / Deflationary defensive sleeves.',
    owner: 'Senior Quant',
    output: 'macrotilt_engine.json',
    consumers: {
      engines: ['Asset tilt allocator'],
      surfaces: ['Macro overview (stress band)', 'Asset tilt (equity / defensive split)'],
      workflows: [],
    },
  },
  asset_tilt: { role: 'engine', special: 'sector_allocation' },
  scanner: {
    role: 'engine',
    desc: 'Trading Opportunities scanner. Per-ticker MacroTilt Score in [-100, +100] built from six weighted sub-scores: insider, options flow, congress, technicals, analyst, short interest. Assigns one of five bands: Strong Sell, Watch Sell, Neutral, Watch Buy, Strong Buy.',
    owner: 'Senior Quant + Lead Dev',
    output: 'signal_intel_v5_daily',
    consumers: {
      engines: [],
      surfaces: ['Trading ops (named tickers)', 'Home (top opps tile)', 'Methodology (scoring framework)'],
      workflows: ['Alpaca paper queue (Sleeve B)'],
    },
  },
  stress: {
    role: 'engine',
    desc: 'Scenario Stress engine. Translates Fed CCAR US-16 variables to the v9 factor panel and runs eight historical CCAR-anchored scenarios to project stressed allocations.',
    owner: 'Senior Quant',
    output: 'scenario_allocations.json',
    consumers: {
      engines: [],
      surfaces: ['Scenario analysis'],
      workflows: [],
    },
  },
  sectorperf: {
    role: 'engine',
    desc: 'Sector Performance Compute. 1-month, 3-month, and trailing-twelve-month return plus TTM volatility for each of the 11 GICS sector ETFs.',
    owner: 'Lead Dev',
    output: 'sector_perf.json',
    consumers: {
      engines: [],
      surfaces: ['Asset tilt (sector performance column)', 'All indicators (sector grid)'],
      workflows: [],
    },
  },

  // -- Surfaces --
  home: { role: 'surface', desc: 'Landing tile dashboard. Summarises the regime, the asset tilt, the top trading opportunities, and any urgent freshness alerts on a single screen.' },
  overview: { role: 'surface', desc: 'Macro Overview page. Anchored on the Cycle Mechanism Board — six mechanism scores, the stress band, the yield direction band, and the regime label.' },
  allocation: { role: 'surface', desc: 'Asset Tilt page. Live sector allocation (11 sectors + 25 industry groups), the defensive sleeve, the page stance, and the vs-SPY deltas.' },
  ops: { role: 'surface', desc: 'Trading Opportunities page. Filterable grid of every scanner-scored ticker with MacroTilt Score, band, sub-scores, and named drivers.' },
  insights: { role: 'surface', desc: "Portfolio Insights page. Joe's real positions, watchlist, trade history, accounts, and realized P&L — reconciled to broker statements." },
  paper: { role: 'surface', desc: 'Paper Portfolio page. Alpaca-mirrored paper account: $1M total with two sleeves. NAV, fills, and positions update on the morning open and EOD chains.' },
  scenarios: { role: 'surface', desc: 'Scenario Analysis page. CCAR-anchored historical stress scenarios plus a bespoke shock builder; projects allocation drift under stressed factor moves.' },
  indicators: { role: 'surface', desc: 'All Indicators page. Full 36-indicator grid with per-indicator percentile, history, and drill-down panels.' },
  methodology: { role: 'surface', desc: "Methodology page. Documents every engine's framework, calibration tables, formulae, and back-test results. Updated in the same PR as any model change." },

  // -- Workflows --
  alpaca: {
    role: 'workflow',
    desc: 'Paper-portfolio EOD and Open jobs. EOD translates the Asset Tilt allocation and the Trading Opps scanner output into pending paper orders and submits them market-on-open to Alpaca; the morning Open job mirrors fills back to Supabase.',
    consumers: { engines: [], surfaces: ['Paper portfolio'], workflows: [] },
  },
  alerts: {
    role: 'workflow',
    desc: 'Resend-powered email alerts for workflow failures, daily home smoke tests, pipeline freshness watchdog, and bug-triage events.',
    consumers: { engines: [], surfaces: [], workflows: [] },
  },
  triage: {
    role: 'workflow',
    desc: 'Bug triage email loop. Resend acknowledgement on file → 36-hour nudge on stale bugs → one-tap APPROVE email that auto-merges the triage PR via the GitHub API.',
    consumers: { engines: [], surfaces: ['Admin · Bugs'], workflows: [] },
  },
  commentary: {
    role: 'workflow',
    desc: 'Threshold-gated editorial commentary generator. Pulls ZeroHedge premium articles, runs a Claude call when relevant tickers cross a salience threshold, and writes blurbs to the Ticker Detail commentary section.',
    consumers: { engines: [], surfaces: ['Ticker detail', 'Home (news strip)'], workflows: [] },
  },
};

// ---------- Tile component ----------
function Tile({ tile, role, selected, lit, dim, status, onClick }) {
  const cls = [
    'df-tile',
    `df-tile--${role}`,
    tile.manual ? 'df-tile--manual' : '',
    selected ? 'df-tile--selected' : '',
    lit ? 'df-tile--lit' : '',
    dim ? 'df-tile--dim' : '',
  ].filter(Boolean).join(' ');
  const dotCls = `df-dot df-dot--${status || 'g'}`;
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => { e.stopPropagation(); onClick(tile.id); }}
      data-id={tile.id}
    >
      <span className={dotCls} aria-hidden />
      <span className="df-tile-name">{tile.name}</span>
      <span className="df-tile-cd">{tile.cd}</span>
    </button>
  );
}

// ---------- Sector allocation drawer (special-case for asset_tilt) ----------
function SectorAllocationDrawer() {
  return (
    <div className="df-drawer">
      <div className="df-drawer-head">
        <h3>
          <span className="df-dot df-dot--inline df-dot--g" aria-hidden />
          Asset tilt allocator · sector allocation
        </h3>
      </div>
      <p className="df-drawer-desc">
        Live engine behind the Asset Tilt page. Combines the 2-axis macro engine with the six cycle mechanism
        board scores (Valuation, Credit, Funding, Growth, Liquidity &amp; Policy, Positioning &amp; Breadth) plus
        a static sensitivity matrix to produce 11 sector tilts, 25 industry-group tilts, defensive sleeve
        composition, page stance, and leverage. Source of truth: compute_v10_allocation.py (v10.2, locked
        2026-05-22).
      </p>

      <div className="df-meta">
        <div><div className="df-meta-k">Type</div><div className="df-meta-v">Modelled engine</div></div>
        <div><div className="df-meta-k">Cadence</div><div className="df-meta-v">Daily · 8:15 AM ET</div></div>
        <div><div className="df-meta-k">Output</div><div className="df-meta-v">v10_allocation.json</div></div>
        <div><div className="df-meta-k">Owner</div><div className="df-meta-v">Senior Quant + Lead Dev</div></div>
      </div>

      <div className="df-block">
        <div className="df-block-h">Inputs · what the engine reads</div>

        <div className="df-inp">
          <div className="df-inp-h"><span className="df-inp-bar" />From the 2-axis engine</div>
          <div className="df-inp-sub">Drives equity %, defensive %, and the defensive sleeve mix.</div>
          <div className="df-chips">
            <span className="df-chip">MOVE 5-yr percentile</span>
            <span className="df-chip">3-month Δ 10Y yield 5-yr percentile</span>
            <span className="df-chip">Equity %</span>
            <span className="df-chip">Defensive %</span>
            <span className="df-chip">Sleeve mix (cash / SHY / TLT / GLD / LQD)</span>
          </div>
        </div>

        <div className="df-inp">
          <div className="df-inp-h"><span className="df-inp-bar" />From the cycle mechanism board</div>
          <div className="df-inp-sub">Six macro scores (0–100). Each is itself an aggregate of 3–5 underlying FRED, Yahoo and scrape indicators.</div>
          <div className="df-chips">
            <span className="df-chip">Valuation</span>
            <span className="df-chip">Credit</span>
            <span className="df-chip">Funding</span>
            <span className="df-chip">Growth</span>
            <span className="df-chip">Liquidity &amp; policy</span>
            <span className="df-chip">Positioning &amp; breadth</span>
          </div>
        </div>

        <div className="df-inp">
          <div className="df-inp-h"><span className="df-inp-bar" />Static configuration</div>
          <div className="df-inp-sub">Hard-coded constants reviewed each methodology cycle.</div>
          <div className="df-chips">
            <span className="df-chip">11-sector SPY benchmark weights</span>
            <span className="df-chip">11 × 6 sensitivity matrix</span>
            <span className="df-chip">25 IG sensitivity adjustments</span>
            <span className="df-chip">OW / UW thresholds ±0.3</span>
            <span className="df-chip">Leverage cap 1.5×</span>
          </div>
        </div>
      </div>

      <div className="df-block">
        <div className="df-block-h">Downstream consumers</div>
        <div className="df-grp">
          <div>
            <div className="df-grp-h">Engines</div>
            <ul><li className="df-grp-empty">Terminal — no downstream engines</li></ul>
          </div>
          <div>
            <div className="df-grp-h">Live surfaces</div>
            <ul>
              <li>Asset tilt page</li>
              <li>Home (asset tilt tile)</li>
              <li>Methodology page</li>
              <li>Scenario analysis</li>
            </ul>
          </div>
          <div>
            <div className="df-grp-h">Downstream workflows</div>
            <ul>
              <li>Paper portfolio EOD → Alpaca</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Generic per-tile drawer (TILE_DETAILS-driven) ----------
function TileDetailDrawer({ tileId, tileById, status }) {
  const details = TILE_DETAILS[tileId];
  const tile = tileById[tileId];
  if (!details || !tile) return null;

  const roleLabel = {
    source: 'External source',
    derived: 'Derived indicator bucket',
    engine: 'Modelled engine',
    surface: 'Live surface',
    workflow: 'Downstream workflow',
  }[details.role] || 'Element';

  const consumers = details.consumers || { engines: [], surfaces: [], workflows: [] };
  const vendor = details.role === 'source' ? VENDOR_BY_TILE[tileId] : null;
  const cost = vendor ? VENDOR_MONTHLY_COST[vendor] : null;

  const dotCls = `df-dot df-dot--inline df-dot--${status || 'g'}`;

  return (
    <div className="df-drawer">
      <div className="df-drawer-head">
        <h3>
          <span className={dotCls} aria-hidden />
          {tile.name}
        </h3>
      </div>
      <p className="df-drawer-desc">{details.desc}</p>

      <div className="df-meta">
        <div><div className="df-meta-k">Type</div><div className="df-meta-v">{roleLabel}</div></div>
        <div><div className="df-meta-k">Cadence</div><div className="df-meta-v">{tile.cd}</div></div>
        {vendor && <div><div className="df-meta-k">Vendor</div><div className="df-meta-v">{vendor}</div></div>}
        {cost && <div><div className="df-meta-k">Monthly cost</div><div className="df-meta-v">{cost}</div></div>}
        {details.owner && <div><div className="df-meta-k">Owner</div><div className="df-meta-v">{details.owner}</div></div>}
        {details.output && <div><div className="df-meta-k">Output</div><div className="df-meta-v">{details.output}</div></div>}
        {tile.manual && <div><div className="df-meta-k">Ingest</div><div className="df-meta-v">Manual upload</div></div>}
      </div>

      {(consumers.engines.length + consumers.surfaces.length + consumers.workflows.length) > 0 && (
        <div className="df-block">
          <div className="df-block-h">Downstream consumers</div>
          <div className="df-grp">
            <div>
              <div className="df-grp-h">Engines</div>
              <ul>
                {consumers.engines.length === 0
                  ? <li className="df-grp-empty">None</li>
                  : consumers.engines.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
            <div>
              <div className="df-grp-h">Live surfaces</div>
              <ul>
                {consumers.surfaces.length === 0
                  ? <li className="df-grp-empty">None</li>
                  : consumers.surfaces.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
            <div>
              <div className="df-grp-h">Downstream workflows</div>
              <ul>
                {consumers.workflows.length === 0
                  ? <li className="df-grp-empty">None</li>
                  : consumers.workflows.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Status lookup helpers ----------
function statusForVendorRollup(rollup) {
  if (!rollup) return 'g';
  if (rollup.red > 0) return 'r';
  if (rollup.amber > 0) return 'a';
  return 'g';
}

// ---------- Main page ----------
export default function DataFlowPage() {
  const [selectedId, setSelectedId] = useState('asset_tilt');
  const flowRef = useRef(null);
  const svgRef = useRef(null);

  // Live vendor freshness (60s cache, focus refresh)
  const { byVendor } = useDataHealth();

  const allTiles = useMemo(() => [
    ...COL1_EQUITY, ...COL1_MACRO, ...COL2_DERIVED,
    ...COL3_ENGINES, ...COL4_SURFACES, ...COL4_WORKFLOWS,
  ], []);
  const tileById = useMemo(
    () => Object.fromEntries(allTiles.map((t) => [t.id, t])),
    [allTiles],
  );

  // Resolve per-tile status from live data
  const statusByTile = useMemo(() => {
    const out = {};
    allTiles.forEach((t) => {
      const vendor = VENDOR_BY_TILE[t.id];
      if (vendor && byVendor && byVendor.get(vendor)) {
        out[t.id] = statusForVendorRollup(byVendor.get(vendor));
      } else if (t.manual) {
        out[t.id] = 'a'; // manual sources default to amber to flag attention
      } else {
        out[t.id] = 'g';
      }
    });
    return out;
  }, [allTiles, byVendor]);

  const drawLineage = useCallback((id) => {
    const svg = svgRef.current;
    const flow = flowRef.current;
    if (!svg || !flow) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!id) return;

    const upstream = bfs(id, 'up');
    const downstream = bfs(id, 'down');
    const connected = new Set([id, ...upstream, ...downstream]);

    const fr = flow.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);

    EDGES.forEach(([from, to]) => {
      if (!connected.has(from) || !connected.has(to)) return;
      const a = flow.querySelector(`[data-id="${from}"]`);
      const b = flow.querySelector(`[data-id="${to}"]`);
      if (!a || !b) return;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const x1 = ar.right - fr.left;
      const y1 = ar.top + ar.height / 2 - fr.top;
      const x2 = br.left - fr.left;
      const y2 = br.top + br.height / 2 - fr.top;
      const dx = (x2 - x1) / 2;
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
  }, []);

  useEffect(() => {
    drawLineage(selectedId);
    const onResize = () => drawLineage(selectedId);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedId, drawLineage]);

  const handleTileClick = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  // Compute lit / dim sets for current selection
  let litSet = new Set();
  let dimSet = new Set();
  if (selectedId) {
    const upstream = bfs(selectedId, 'up');
    const downstream = bfs(selectedId, 'down');
    const connected = new Set([selectedId, ...upstream, ...downstream]);
    allTiles.forEach((t) => {
      if (!connected.has(t.id) && t.id !== selectedId) dimSet.add(t.id);
      else if (t.id !== selectedId) litSet.add(t.id);
    });
  }

  const renderTile = (tile, role) => (
    <Tile
      key={tile.id}
      tile={tile}
      role={role}
      selected={selectedId === tile.id}
      lit={litSet.has(tile.id)}
      dim={dimSet.has(tile.id)}
      status={statusByTile[tile.id]}
      onClick={handleTileClick}
    />
  );

  const drawerForSelection = () => {
    if (!selectedId) return null;
    if (selectedId === 'asset_tilt') return <SectorAllocationDrawer />;
    return <TileDetailDrawer tileId={selectedId} tileById={tileById} status={statusByTile[selectedId]} />;
  };

  return (
    <div className="mt-pagebody mt-fade df-page">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Admin · Data</div>
          <h1 className="mt-h1">
            End-to-end <i>data flow</i>.
          </h1>
          <p className="mt-deck">
            Every source, every derived indicator, every engine, every surface, every downstream workflow.
            Click any tile to trace its full upstream and downstream chain.
          </p>
        </div>
      </section>

      <div className="df-flow" ref={flowRef} onClick={() => setSelectedId(null)}>
        <svg className="df-svg" ref={svgRef} />
        <div className="df-cols" onClick={(e) => e.stopPropagation()}>

          <div className="df-col">
            <div className="df-col-h">External · starting points</div>
            <div className="df-sub-h">Equity &amp; option vendors</div>
            <div className="df-stack">{COL1_EQUITY.map((t) => renderTile(t, 'source'))}</div>
            <div className="df-sub-h">Macro &amp; alternative</div>
            <div className="df-stack">{COL1_MACRO.map((t) => renderTile(t, 'source'))}</div>
          </div>

          <div className="df-col">
            <div className="df-col-h">Derived indicators</div>
            <div className="df-stack" style={{ marginTop: 16 }}>
              {COL2_DERIVED.map((t) => renderTile(t, 'derived'))}
            </div>
          </div>

          <div className="df-col">
            <div className="df-col-h">Modelled engines</div>
            <div className="df-stack" style={{ marginTop: 16 }}>
              {COL3_ENGINES.map((t) => renderTile(t, 'engine'))}
            </div>
          </div>

          <div className="df-col">
            <div className="df-col-h">Surfaces &amp; workflows</div>
            <div className="df-sub-h">Live surfaces</div>
            <div className="df-stack">{COL4_SURFACES.map((t) => renderTile(t, 'surface'))}</div>
            <div className="df-sub-h">Downstream workflows</div>
            <div className="df-stack">{COL4_WORKFLOWS.map((t) => renderTile(t, 'workflow'))}</div>
          </div>

        </div>
      </div>

      <div className="df-legend">
        <span><span className="df-legpip df-legpip--auto" />Auto</span>
        <span><span className="df-legpip df-legpip--manual" />Manual</span>
        <span><span className="df-legpip df-legpip--derived" />Derived</span>
        <span><span className="df-legpip df-legpip--surface" />Surface</span>
        <span className="df-legend-hint">Tap a tile to trace · tap again to clear</span>
      </div>

      {drawerForSelection()}

      <style>{`
        .df-page { padding-bottom: 40px; }
        .df-flow { position: relative; padding: 12px 0; }
        .df-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; color: var(--mt-accent); }
        .df-svg path { fill: none; stroke: currentColor; stroke-width: 1.3; opacity: 0.55; }
        .df-cols { display: grid; grid-template-columns: 1.05fr 1fr 1.1fr 1.15fr; gap: 14px; position: relative; z-index: 2; }
        .df-col { min-width: 0; }
        .df-col-h { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--mt-line-0); }
        .df-sub-h { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; margin: 12px 0 6px 2px; }
        .df-sub-h:first-of-type { margin-top: 0; }
        .df-stack { display: flex; flex-direction: column; gap: 6px; }

        .df-tile { all: unset; box-sizing: border-box; cursor: pointer; display: block; position: relative;
          background: var(--mt-surface); border: 1px solid var(--mt-line-0); border-left: 3px solid var(--mt-accent);
          border-radius: var(--mt-r-sm); padding: 8px 12px; min-height: 44px;
          transition: opacity 0.18s var(--mt-ease), background 0.15s var(--mt-ease), border-color 0.15s var(--mt-ease), transform 0.12s var(--mt-ease); }
        .df-tile:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
        .df-tile:hover { background: var(--mt-accent-soft); transform: translateY(-1px); }
        .df-tile--manual { border-left-color: var(--mt-warn); }
        .df-tile--derived { border-left-color: var(--mt-ink-3); }
        .df-tile--engine { border-left-color: var(--mt-accent); background: var(--mt-surface-2); }
        .df-tile--surface { border-left-color: var(--mt-up); background: var(--mt-surface-2); }
        .df-tile--workflow { border-left-color: var(--mt-warn); background: var(--mt-surface-2); }
        .df-tile--selected { background: var(--mt-accent-soft); box-shadow: 0 0 0 2px var(--mt-accent); }
        .df-tile--lit { border-color: var(--mt-accent); background: var(--mt-accent-soft); }
        .df-tile--dim { opacity: 0.2; }

        .df-tile-name { display: block; font-size: 12.5px; font-weight: 600; color: var(--mt-ink-0); line-height: 1.25; padding-right: 16px; }
        .df-tile-cd { display: block; font-size: 10.5px; color: var(--mt-ink-2); margin-top: 2px; line-height: 1.25; }
        .df-dot { position: absolute; top: 10px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--mt-up); }
        .df-dot--g { background: var(--mt-up); }
        .df-dot--a { background: var(--mt-warn); }
        .df-dot--r { background: var(--mt-down); }
        .df-dot--inline { position: static; display: inline-block; vertical-align: 1px; margin-right: 6px; }

        .df-legend { display: flex; gap: 16px; justify-content: flex-end; align-items: center;
          font-size: 11px; color: var(--mt-ink-2); margin: 12px 0 0; flex-wrap: wrap; }
        .df-legpip { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 5px; vertical-align: 2px; }
        .df-legpip--auto { background: var(--mt-accent); }
        .df-legpip--manual { background: var(--mt-warn); }
        .df-legpip--derived { background: var(--mt-ink-3); }
        .df-legpip--surface { background: var(--mt-up); }
        .df-legend-hint { color: var(--mt-ink-3); font-style: italic; font-size: 10.5px; }

        .df-drawer { margin-top: 18px; background: var(--mt-surface); border: 1px solid var(--mt-line-0);
          border-radius: var(--mt-r-md); padding: 18px 22px; }
        .df-drawer-head h3 { font-size: 15px; font-weight: 600; margin: 0 0 4px; color: var(--mt-ink-0); display: flex; align-items: center; }
        .df-drawer-desc { font-size: 12.5px; color: var(--mt-ink-2); margin: 4px 0 14px; line-height: 1.5; }

        .df-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 24px; font-size: 11.5px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--mt-line-0); }
        .df-meta-k { color: var(--mt-ink-3); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; margin-bottom: 2px; }
        .df-meta-v { color: var(--mt-ink-0); font-weight: 500; font-size: 12px; line-height: 1.3; }

        .df-block { margin-bottom: 16px; }
        .df-block-h { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-ink-3); font-weight: 600; margin-bottom: 8px; }
        .df-inp { background: var(--mt-surface-2); border: 1px solid var(--mt-line-0); border-radius: var(--mt-r-sm); padding: 12px 14px; margin-bottom: 8px; }
        .df-inp-h { font-size: 11.5px; font-weight: 600; color: var(--mt-ink-0); margin-bottom: 4px; display: flex; align-items: center; gap: 7px; }
        .df-inp-bar { width: 3px; height: 12px; background: var(--mt-accent); border-radius: 1px; }
        .df-inp-sub { font-size: 11px; color: var(--mt-ink-2); margin-bottom: 8px; line-height: 1.5; }
        .df-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .df-chip { font-size: 11px; background: var(--mt-surface); border: 1px solid var(--mt-line-0); padding: 2px 8px; border-radius: 11px; color: var(--mt-ink-0); }

        .df-grp { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; font-size: 12px; }
        .df-grp-h { font-size: 11px; font-weight: 600; color: var(--mt-ink-0); margin-bottom: 5px; }
        .df-grp ul { list-style: none; padding: 0; margin: 0; }
        .df-grp li { padding: 3px 0; color: var(--mt-ink-0); font-size: 11.5px; line-height: 1.4; display: flex; align-items: flex-start; gap: 6px; }
        .df-grp li::before { content: ""; width: 3px; height: 3px; border-radius: 50%; background: var(--mt-accent); display: inline-block; margin-top: 7px; flex: 0 0 3px; }
        .df-grp li.df-grp-empty { color: var(--mt-ink-2); font-style: italic; }
        .df-grp li.df-grp-empty::before { display: none; }

        @media (max-width: 1100px) {
          .df-cols { grid-template-columns: 1fr 1fr; gap: 12px; }
          .df-svg { display: none; }
          .df-meta { grid-template-columns: 1fr 1fr; }
          .df-grp { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
