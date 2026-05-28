/* DataFlowPage — end-to-end data lineage dashboard.

   Replaces the old vendor-per-page admin views with a single E2E surface
   that shows every external source, every derived indicator bucket, every
   modelled engine, every live surface, and every downstream workflow.

   Behaviour:
     - Click any tile -> draws full transitive upstream + downstream chain
       (BFS in both directions on the edge list below), dims unconnected
       tiles, paints SVG curves on the connector layer.
     - Click again or click empty space -> clears the lineage.
     - Drawer below the flow shows detail for the selected tile. Currently
       hard-wired to render the Asset Tilt Allocator (sector allocation)
       detail — the next PR will branch on selectedId to swap drawer
       contents per box.

   Edges are derived from a live-code audit (see DATA_TEARDOWN_KICKOFF.md
   and compute_v10_allocation.py). Sources are connected to the SPECIFIC
   derived buckets they feed — not via a hub fan-out — so clicking ISM
   only lights up the growth chain, not the entire cycle board.

   Theming uses --mt-* tokens from tokens.css, so the page picks up the
   existing light / dark / navy themes via data-mt-theme on <html>.
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';

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
  { id: 'ism', name: 'ISM PMI release', cd: 'Monthly', manual: true, warn: true },
  { id: 'naaim', name: 'NAAIM exposure', cd: 'Weekly' },
  { id: 'gdpnow', name: 'Atlanta Fed GDPNow', cd: 'Bi-weekly' },
  { id: 'multpl', name: 'multpl.com CAPE', cd: 'Monthly' },
  { id: 'zh', name: 'ZeroHedge premium', cd: 'Weekly' },
  { id: 'congress', name: 'Congress roster', cd: 'Monthly' },
  { id: 'fdic', name: 'FDIC HTM losses', cd: 'Quarterly', manual: true, warn: true },
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

// ---------- Tile component ----------
function Tile({ tile, role, selected, lit, dim, onClick }) {
  const cls = [
    'df-tile',
    `df-tile--${role}`,
    tile.manual ? 'df-tile--manual' : '',
    selected ? 'df-tile--selected' : '',
    lit ? 'df-tile--lit' : '',
    dim ? 'df-tile--dim' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => { e.stopPropagation(); onClick(tile.id); }}
      data-id={tile.id}
    >
      <span className={`df-dot ${tile.warn ? 'df-dot--warn' : ''}`} aria-hidden />
      <span className="df-tile-name">{tile.name}</span>
      <span className="df-tile-cd">{tile.cd}</span>
    </button>
  );
}

// ---------- Sector allocation drawer (default content) ----------
function SectorAllocationDrawer() {
  return (
    <div className="df-drawer">
      <div className="df-drawer-head">
        <h3>
          <span className="df-dot df-dot--inline" aria-hidden />
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
        <div><div className="df-meta-k">Last run</div><div className="df-meta-v">Today · 8:15 AM ET</div></div>
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

// ---------- Generic drawer placeholder for non-asset-tilt tiles ----------
function GenericDrawer({ name }) {
  return (
    <div className="df-drawer">
      <div className="df-drawer-head">
        <h3>
          <span className="df-dot df-dot--inline" aria-hidden />
          {name}
        </h3>
      </div>
      <p className="df-drawer-desc" style={{ fontStyle: 'italic' }}>
        Detailed drawer for this element ships in the next PR. The lineage above already reflects this
        element's accurate upstream and downstream chain.
      </p>
    </div>
  );
}

// ---------- Main page ----------
export default function DataFlowPage() {
  const [selectedId, setSelectedId] = useState('asset_tilt');
  const flowRef = useRef(null);
  const svgRef = useRef(null);

  const allTiles = [
    ...COL1_EQUITY, ...COL1_MACRO, ...COL2_DERIVED,
    ...COL3_ENGINES, ...COL4_SURFACES, ...COL4_WORKFLOWS,
  ];
  const tileById = Object.fromEntries(allTiles.map((t) => [t.id, t]));

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
      onClick={handleTileClick}
    />
  );

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

      {selectedId === 'asset_tilt' ? (
        <SectorAllocationDrawer />
      ) : selectedId && tileById[selectedId] ? (
        <GenericDrawer name={tileById[selectedId].name} />
      ) : null}

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
        .df-dot--warn { background: var(--mt-warn); }
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
