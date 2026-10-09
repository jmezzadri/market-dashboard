/* MarketTape — the scrolling cross-asset banner under the header, on EVERY
   page (Joe, 2026-10-09: "Can we add it to the rest of the site? Also, can we
   add more things up there and make it scroll… energy - oil, nat gas, commods,
   metals, etc."). Until then it was nine fixed tiles on Home only.

   What is on it, and why these: one line per thing a macro desk checks before
   anything else, grouped the way a desk reads them — equities, volatility,
   rates, credit, FX, energy, metals, grains. Every series was ALREADY stored
   in indicator_history.json and already governed (data manifest, freshness
   chip on its own Macro row); this banner adds a reader, not a feed.

   Field notes:
   `pct: true`  — the move is quoted in percent. Equity indexes, FX and
                  commodities are quoted that way on every desk. Rates, spreads
                  and vol indexes move in their own points, so they are not.
   `live`       — quote symbol on the shared live-quote path. Only the three
                  equity indexes have one: in the session they show the live
                  level and move, outside it the last close. Everything else is
                  a daily series and is stamped "close" (LESSONS 4.26 rule 1:
                  a move renders with its session, in the same element).
   `ind`        — the Macro indicator the tile opens, in place, over whatever
                  page the reader is on (LESSONS 9.16). A tile with no
                  indicator behind it is a quote, not a button, and does not
                  look clickable.
   `idx`        — the equity indexes open their own level panel.

   The "live" stamp is a claim about the SESSION, not the feed (LESSONS 4.32):
   gated on marketOpen === true, exactly as before the move from HomePage. */

import React, { useMemo, useState } from 'react';
import useMarketLevels from '../lib/useMarketLevels';
import useLseLive from '../../hooks/useLseLive';
import IndicatorDrillModal from '../components/IndicatorDrillModal';
import IndexDrillModal, { INDEX_DRILLS } from '../components/IndexDrillModal';
import { IND } from '../../data/indicatorRegistry';
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';

export const TAPE = [
  { group: 'Equities', items: [
    { key: 'spx_index', label: 'S&P', dec: 0, live: '^GSPC', pct: true, idx: 'spx_index' },
    { key: 'ndx_index', label: 'NASDAQ', dec: 0, live: '^IXIC', pct: true, idx: 'ndx_index' },
    { key: 'dji_index', label: 'DOW', dec: 0, live: '^DJI', pct: true, idx: 'dji_index' },
  ] },
  { group: 'Volatility', items: [
    { key: 'vix', label: 'VIX', dec: 1, ind: 'vix' },
    { key: 'move', label: 'MOVE', dec: 0, ind: 'move' },
  ] },
  { group: 'Rates', items: [
    { key: 'ust_2y', label: '2Y', dec: 2, suffix: '%', ind: 'ust_2y' },
    { key: 'ust_10y', label: '10Y', dec: 2, suffix: '%', ind: 'ust_10y' },
    { key: 'ust_30y', label: '30Y', dec: 2, suffix: '%', ind: 'ust_30y' },
    { key: 'yield_curve', label: '2s10s', dec: 0, ind: 'yield_curve' },
  ] },
  { group: 'Credit', items: [
    { key: 'hy_ig', label: 'HY OAS', dec: 0, ind: 'hy_ig' },
    { key: 'ig_oas', label: 'IG OAS', dec: 0, ind: 'ig_oas' },
  ] },
  { group: 'FX', items: [
    { key: 'usd', label: 'DXY', dec: 2, pct: true, ind: 'usd' },
    { key: 'fx_eur', label: 'EUR/USD', dec: 4, pct: true, ind: 'fx_eur' },
    { key: 'fx_jpy', label: '¥/$', dec: 1, pct: true, ind: 'fx_jpy' },
    { key: 'fx_gbp', label: 'GBP/USD', dec: 4, pct: true, ind: 'fx_gbp' },
  ] },
  { group: 'Energy', items: [
    { key: 'cmdty_oil', label: 'WTI', dec: 2, pct: true, ind: 'cmdty_oil' },
    { key: 'cmdty_brent', label: 'Brent', dec: 2, pct: true, ind: 'cmdty_brent' },
    { key: 'cmdty_natgas', label: 'Nat Gas', dec: 3, pct: true, ind: 'cmdty_natgas' },
    { key: 'cmdty_gasoline', label: 'Gasoline', dec: 3, pct: true },
    { key: 'cmdty_heatoil', label: 'Diesel', dec: 3, pct: true },
  ] },
  { group: 'Metals', items: [
    { key: 'cmdty_gold', label: 'Gold', dec: 0, pct: true, ind: 'cmdty_gold' },
    { key: 'cmdty_silver', label: 'Silver', dec: 2, pct: true, ind: 'cmdty_silver' },
    { key: 'cmdty_copper', label: 'Copper', dec: 2, pct: true, ind: 'cmdty_copper' },
    { key: 'cmdty_uranium', label: 'Uranium', dec: 2, pct: true, ind: 'cmdty_uranium' },
  ] },
  { group: 'Grains', items: [
    { key: 'cmdty_corn', label: 'Corn', dec: 0, pct: true, ind: 'cmdty_corn' },
    { key: 'cmdty_wheat', label: 'Wheat', dec: 0, pct: true, ind: 'cmdty_wheat' },
    { key: 'cmdty_soybeans', label: 'Soybeans', dec: 0, pct: true, ind: 'cmdty_soybeans' },
  ] },
];
export const TAPE_ITEMS = TAPE.flatMap((g) => g.items);
const LIVE_SYMS = TAPE_ITEMS.filter((r) => r.live).map((r) => r.live);

/* WTI and Brent are the same barrel with a slow spread between them. When
   their one-session moves differ by more than this many percentage points,
   the larger one is a futures contract roll or a bad tick, not a market move,
   and that tile is dropped — the same rule, and the same threshold, the
   morning brief applies (LESSONS 4.37). An absent tile is correct; a wrong
   one lies. */
const OIL_PAIR = ['cmdty_oil', 'cmdty_brent'];
const OIL_PAIR_MAX_GAP_PCT = 5;

function fmt(v, dec) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function ddParts(dd, dec) {
  if (dd == null || !Number.isFinite(dd)) return { arrow: '', txt: '', cls: '' };
  const d = Math.min(dec, 2);
  // Round to the displayed precision first, so a change that rounds to zero
  // shows nothing rather than a spurious "-0.0".
  const r = Number(dd.toFixed(d));
  if (r === 0) return { arrow: '', txt: '', cls: '' };
  const a = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return r > 0 ? { arrow: '▲', txt: a, cls: 'up' } : { arrow: '▼', txt: a, cls: 'down' };
}

/* One tile's numbers, resolved once so the value, the change and the stamp
   can never come from different observations. */
function tapeTile(r, lv, liveQ, marketOpen) {
  const live = r.live && liveQ && liveQ.covered && liveQ.price != null ? liveQ : null;
  if (live) {
    const base = live.prevClose != null && live.prevClose > 0 ? live.prevClose : null;
    return {
      value: live.price,
      pct: base != null ? ((live.price / base) - 1) * 100 : null,
      dd: base != null ? live.price - base : null,
      stamp: marketOpen === true ? 'live' : 'close',
    };
  }
  if (!lv) return null;
  const prev = lv.dd != null ? lv.value - lv.dd : null;
  return {
    value: lv.value,
    pct: prev > 0 && lv.dd != null ? (lv.dd / prev) * 100 : null,
    dd: lv.dd,
    stamp: 'close',
  };
}

function Tile({ r, t, onOpen }) {
  const d = r.pct ? ddParts(t?.pct, 2) : ddParts(t?.dd, r.dec);
  const inner = (
    <>
      <span className="tk">{r.label}</span>
      <span className="tv">{t ? fmt(t.value, r.dec) + (r.suffix || '') : '—'}</span>
      <span className={`td ${d.cls || 'fl'}`}>
        {d.txt ? `${d.arrow} ${d.txt}${r.pct ? '%' : ''}` : '—'}{' '}
        <small>{t?.stamp || 'close'}</small>
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" className="t t--drill" onClick={onOpen} aria-label={`${r.label} — open detail`}>
      {inner}
    </button>
  ) : (
    <div className="t t--static">{inner}</div>
  );
}

export default function MarketTape() {
  const { level, hist } = useMarketLevels();
  const live = useLseLive(LIVE_SYMS);
  const [drillInd, setDrillInd] = useState(null);
  const [drillIdx, setDrillIdx] = useState(null);

  const groups = useMemo(() => {
    const tiles = {};
    TAPE_ITEMS.forEach((r) => { tiles[r.key] = tapeTile(r, level(r.key), live.bySymbol?.[r.live], live.marketOpen); });
    const [a, b] = OIL_PAIR.map((k) => tiles[k]?.pct);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > OIL_PAIR_MAX_GAP_PCT) {
      tiles[Math.abs(a) > Math.abs(b) ? OIL_PAIR[0] : OIL_PAIR[1]] = null;
    }
    // A series with nothing to show is left off rather than scrolled past as
    // a dash — except the live indexes, which fill in a moment later.
    return TAPE
      .map((g) => ({ group: g.group, items: g.items.filter((r) => tiles[r.key] || r.live).map((r) => ({ r, t: tiles[r.key] })) }))
      .filter((g) => g.items.length);
  }, [level, live.bySymbol, live.marketOpen]);

  const openFor = (r) => {
    if (r.ind && IND[r.ind]) return () => setDrillInd(r.ind);
    if (r.idx && INDEX_DRILLS[r.idx]) return () => setDrillIdx(r.idx);
    return null;
  };

  /* The strip is rendered twice, end to end, and slid left by exactly one
     copy's width — that is what makes the loop seamless. The second copy is
     decoration: hidden from assistive tech and out of the tab order. */
  const strip = (dup) => (
    <div className="row" aria-hidden={dup ? 'true' : undefined} inert={dup ? '' : undefined}>
      {groups.map((g) => (
        <div className="tgroup" key={g.group} role={dup ? undefined : 'group'} aria-label={dup ? undefined : g.group}>
          {g.items.map(({ r, t }) => <Tile key={r.key} r={r} t={t} onOpen={dup ? null : openFor(r)} />)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="home-v12 v13 home-cockpit mt-tape-host">
      <div className="tape" role="region" aria-label="Market prices">
        <div className="wrap tape-view" tabIndex={0}>
          <div className="tape-track" style={{ '--tape-n': TAPE_ITEMS.length }}>
            {strip(false)}
            {strip(true)}
          </div>
        </div>
      </div>
      <IndicatorDrillModal indId={drillInd} onClose={() => setDrillInd(null)} />
      <IndexDrillModal indexKey={drillIdx} hist={hist} onClose={() => setDrillIdx(null)} />
    </div>
  );
}
