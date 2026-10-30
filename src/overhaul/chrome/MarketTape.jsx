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
                  US equity indexes have one: in the session they show the live
                  level and move, outside it the last close. Everything else is
                  a daily series and is stamped "close" (LESSONS 4.26 rule 1:
                  a move renders with its session, in the same element).
   `ind`        — the Macro indicator the tile opens, in place, over whatever
                  page the reader is on (LESSONS 9.16). A tile with no
                  indicator behind it is a quote, not a button, and does not
                  look clickable.
   `idx`        — the equity indexes (and Bitcoin, which is also a price
                  level that trends) open their own level panel.

   Every tile opens something (Joe, 2026-10-14: "why cant I click and open a
   modal?" on TTF and Gasoline). The eight series added on 2026-10-09 were
   quotes with no drill behind them; the four commodities are now registered
   Macro indicators and the four levels have their own panel.

   The "live" stamp is a claim about the SESSION, not the feed (LESSONS 4.32):
   gated on marketOpen === true, exactly as before the move from HomePage. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    { key: 'ndx_index', label: 'Nasdaq Comp.', dec: 0, live: '^IXIC', pct: true, idx: 'ndx_index' },   // the Composite (^IXIC), not the Nasdaq-100 (2026-10-29)
    { key: 'dji_index', label: 'DOW', dec: 0, live: '^DJI', pct: true, idx: 'dji_index' },
    { key: 'rut_index', label: 'Russell 2K', dec: 0, live: '^RUT', pct: true, idx: 'rut_index' },
  ] },
  { group: 'Overseas equities', items: [
    { key: 'n225_index', label: 'Nikkei', dec: 0, pct: true, idx: 'n225_index' },
    { key: 'dax_index', label: 'DAX', dec: 0, pct: true, idx: 'dax_index' },
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
    { key: 'cmdty_ttf', label: 'TTF', dec: 2, pct: true, ind: 'cmdty_ttf' },
    { key: 'cmdty_gasoline', label: 'Gasoline', dec: 3, pct: true, ind: 'cmdty_gasoline' },
    { key: 'cmdty_heatoil', label: 'Diesel', dec: 3, pct: true, ind: 'cmdty_heatoil' },
  ] },
  { group: 'Metals', items: [
    { key: 'cmdty_gold', label: 'Gold', dec: 0, pct: true, ind: 'cmdty_gold' },
    { key: 'cmdty_silver', label: 'Silver', dec: 2, pct: true, ind: 'cmdty_silver' },
    { key: 'cmdty_platinum', label: 'Platinum', dec: 0, pct: true, ind: 'cmdty_platinum' },
    { key: 'cmdty_copper', label: 'Copper', dec: 2, pct: true, ind: 'cmdty_copper' },
    { key: 'cmdty_uranium', label: 'Uranium', dec: 2, pct: true, ind: 'cmdty_uranium' },
  ] },
  { group: 'Grains', items: [
    { key: 'cmdty_corn', label: 'Corn', dec: 0, pct: true, ind: 'cmdty_corn' },
    { key: 'cmdty_wheat', label: 'Wheat', dec: 0, pct: true, ind: 'cmdty_wheat' },
    { key: 'cmdty_soybeans', label: 'Soybeans', dec: 0, pct: true, ind: 'cmdty_soybeans' },
  ] },
  { group: 'Crypto', items: [
    { key: 'crypto_btc', label: 'Bitcoin', dec: 0, pct: true, idx: 'crypto_btc' },
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
const OIL_PAIR_MAX_GAP_PCT = 3; // 2026-10-21: a 4.98-point WTI roll gap slipped under 5

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
  if (r === 0) return { arrow: '', txt: '', cls: '', zero: (0).toFixed(d) };
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

/* A tile has three states, and only one of them prints numbers:
     loading  the label and two neutral bars — never "0" or "close", which
              read as "unchanged at the close" (2026-10-29 audit: the banner
              printed "S&P — 0close" until the 4.9 MB history file arrived);
     missing  the feed answered without this series: an em-dash, no change,
              no session stamp (LESSONS 4.9);
     ready    value, change and the session the change belongs to. */
function Tile({ r, t, loading, onOpen, ghost }) {
  let body;
  if (loading) {
    body = (
      <>
        <span className="rd-tile-v"><span className="rd-skel rd-skel--v" /></span>
        <span className="rd-tile-c"><span className="rd-skel rd-skel--c" /></span>
      </>
    );
  } else if (!t) {
    body = (
      <>
        <span className="rd-tile-v">—</span>
        <span className="rd-tile-c fl">&nbsp;</span>
      </>
    );
  } else {
    const d = r.pct ? ddParts(t.pct, 2) : ddParts(t.dd, r.dec);
    const move = d.txt ? `${d.cls === 'up' ? '+' : '−'}${d.txt}${r.pct ? '%' : ''}` : (d.zero != null ? `${d.zero}${r.pct ? '%' : ''}` : '');
    body = (
      <>
        <span className="rd-tile-v">{fmt(t.value, r.dec) + (r.suffix || '')}</span>
        <span className={`rd-tile-c ${d.cls || 'fl'}`}>
          {move || '—'}
          {/* the session the move belongs to, in the same element as the move
              (LESSONS 4.26 rule 1 / 4.32) */}
          {move && <small className="rd-tile-s">{t.stamp}</small>}
        </span>
      </>
    );
  }
  const inner = (
    <>
      <span className="rd-tile-l">{r.label}</span>
      {body}
    </>
  );
  // Both copies of the strip open the drill. The second copy is what is on
  // screen half of the time; until 2026-10-29 it was inert, so a click on
  // "S&P" worked only when the first copy happened to be in view. It stays
  // out of the tab order and hidden from assistive tech (its strip is
  // aria-hidden); a pointer can still use it.
  return onOpen && !loading ? (
    <button type="button" className="rd-tile rd-tile--drill" onClick={onOpen}
            tabIndex={ghost ? -1 : undefined}
            aria-label={ghost ? undefined : `${r.label} — open detail`}>
      {inner}
    </button>
  ) : (
    <div className="rd-tile" aria-busy={loading ? 'true' : undefined}>{inner}</div>
  );
}

function reducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* The banner's controls. Pause/play everywhere; back and forward on wider
   screens (on a phone the strip is swiped instead). Icons are drawn, not
   glyphs, so they sit on the same centre line in every font. */
function TapeControls({ userPaused, onPause, onBack, onForward }) {
  return (
    <div className="rd-tape-ctl" role="group" aria-label="Banner controls">
      <button type="button" className="rd-tape-btn rd-tape-btn--step" onClick={onBack} aria-label="Show earlier tiles">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
      </button>
      <button type="button" className="rd-tape-btn" onClick={onPause} aria-pressed={userPaused}
              aria-label={userPaused ? 'Play the banner' : 'Pause the banner'}>
        {userPaused
          ? <svg viewBox="0 0 16 16" aria-hidden="true"><path className="fill" d="M5 3.5v9l7-4.5z" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>}
      </button>
      <button type="button" className="rd-tape-btn rd-tape-btn--step" onClick={onForward} aria-label="Show later tiles">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
    </div>
  );
}

export default function MarketTape() {
  const { level, hist, loaded, failed } = useMarketLevels();
  const live = useLseLive(LIVE_SYMS);
  const [drillInd, setDrillInd] = useState(null);
  const [drillIdx, setDrillIdx] = useState(null);

  /* Why the strip is held still. Any one is enough:
       userPaused  the pause button;
       hover       a mouse is over the banner (reading or aiming at a tile);
       focusIn     a tile has keyboard focus;
       dragging    a finger or mouse is sliding the strip by hand;
       a drill is open, so the tile is still where it was on close. */
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [dragging, setDragging] = useState(false);
  const paused = userPaused || hover || focusIn || dragging || !!drillInd || !!drillIdx;

  const sectionRef = useRef(null);
  const viewRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(null);
  const suppressClickUntil = useRef(0);

  const groups = useMemo(() => {
    const tiles = {};
    TAPE_ITEMS.forEach((r) => { tiles[r.key] = tapeTile(r, level(r.key), live.bySymbol?.[r.live], live.marketOpen); });
    const [a, b] = OIL_PAIR.map((k) => tiles[k]?.pct);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > OIL_PAIR_MAX_GAP_PCT) {
      tiles[Math.abs(a) > Math.abs(b) ? OIL_PAIR[0] : OIL_PAIR[1]] = null;
    }
    // While the history is still loading every tile shows its label and two
    // neutral bars, so the banner has its final shape from the first frame.
    // Once loaded, a series with nothing to show is left off rather than
    // scrolled past as a dash — except the live indexes, which can fill in
    // from the live feed a moment later.
    const loadingNow = !loaded && !failed;
    return TAPE
      .map((g) => ({
        group: g.group,
        items: g.items
          .filter((r) => loadingNow || tiles[r.key] || r.live)
          .map((r) => ({ r, t: tiles[r.key], loading: loadingNow && !tiles[r.key] })),
      }))
      .filter((g) => g.items.length);
  }, [level, loaded, failed, live.bySymbol, live.marketOpen]);

  const openFor = (r) => {
    if (r.ind && IND[r.ind]) return () => setDrillInd(r.ind);
    if (r.idx && INDEX_DRILLS[r.idx]) return () => setDrillIdx(r.idx);
    return null;
  };

  /* ── moving the strip by hand ──────────────────────────────────────────
     The strip is moved by its own animation's clock, never by scrolling the
     window (LESSONS 9.30: a box that slides its content is clipped, not
     scrolled — the two offsets add and can carry the strip out of view).
     Seeking the animation keeps the loop seamless in both directions. Under
     reduced motion nothing slides, the window is a real scroller, and the
     same controls scroll it. */
  const anim = () => trackRef.current?.getAnimations?.()?.[0] || null;
  // wrap: true loops past either end (the arrows, a swipe); false clamps to
  // one copy (keyboard focus must show the focused tile itself, not its twin).
  const seekPx = (dx, wrap = true) => {
    const a = anim();
    const tr = trackRef.current;
    if (!a || !tr) {
      viewRef.current?.scrollBy?.({ left: dx });
      return;
    }
    const D = Number(a.effect?.getComputedTiming?.().duration) || 0;
    const half = tr.scrollWidth / 2;
    if (!D || !half) return;
    const t = (Number(a.currentTime) || 0) + (dx / half) * D;
    a.currentTime = wrap ? ((t % D) + D) % D : Math.min(D - 1, Math.max(0, t));
  };
  const glide = (dx) => {
    if (!anim()) { viewRef.current?.scrollBy?.({ left: dx, behavior: 'smooth' }); return; }
    const start = performance.now();
    let done = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / 320);
      const target = dx * (1 - Math.pow(1 - k, 3));
      seekPx(target - done);
      done = target;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const page = () => Math.max(160, (viewRef.current?.clientWidth || 600) * 0.6);

  /* A focused tile is brought fully into view, clear of the edge fade. */
  const bringIntoView = (el) => {
    const v = viewRef.current;
    if (!el || !v) return;
    const vb = v.getBoundingClientRect();
    const rb = el.getBoundingClientRect();
    const pad = 48;
    if (rb.left < vb.left + pad) seekPx(rb.left - vb.left - pad, false);
    else if (rb.right > vb.right - pad) seekPx(rb.right - vb.right + pad, false);
  };

  /* 2026-10-22: while the strip slides, the window must stay at scroll 0. A
     scroll (focus moving to a tile, a trackpad gesture that got through the
     clipped overflow) adds to the slide and can carry the whole strip out of
     view, leaving the banner blank. Under reduced motion nothing slides and
     the window is a real hand scroller, so the position is left alone. */
  const snapBackWhileSliding = (e) => {
    if (reducedMotion()) return;
    if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0;
  };

  const onFocusIn = (e) => {
    const tile = e.target?.closest?.('.rd-tile');
    if (!tile) return;
    let keyboard = true;
    try { keyboard = e.target.matches(':focus-visible'); } catch { /* old engines: treat as keyboard */ }
    if (!keyboard) return;
    setFocusIn(true);
    requestAnimationFrame(() => bringIntoView(tile));
  };
  const onFocusOut = (e) => {
    if (!sectionRef.current?.contains(e.relatedTarget)) setFocusIn(false);
  };

  const onPointerEnter = (e) => { if (e.pointerType === 'mouse') setHover(true); };
  const onPointerLeave = (e) => { if (e.pointerType === 'mouse') setHover(false); };
  const onPointerDown = (e) => {
    if (e.button !== 0 || reducedMotion()) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, last: e.clientX, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      const ax = Math.abs(e.clientX - d.x);
      const ay = Math.abs(e.clientY - d.y);
      if (ax < 6) return;
      if (ay > ax) { drag.current = null; return; }   // a vertical swipe scrolls the page
      d.moved = true;
      setDragging(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
    }
    seekPx(d.last - e.clientX);
    d.last = e.clientX;
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d || (e && d.id !== e.pointerId)) return;
    drag.current = null;
    if (d.moved) {
      suppressClickUntil.current = performance.now() + 80;
      setDragging(false);
    }
  };
  const onClickCapture = (e) => {
    if (performance.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); }
  };

  // A sideways trackpad swipe over the banner moves the strip (and is kept
  // from turning into the browser's back gesture). Not passive, so it can
  // claim the gesture; vertical wheel movement scrolls the page as usual.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return undefined;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      seekPx(e.deltaX);
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, []);

  /* The strip is rendered twice, end to end, and slid left by exactly one
     copy's width — that is what makes the loop seamless. The second copy is
     decoration for assistive tech (aria-hidden, out of the tab order) but
     answers a click like the first. */
  const strip = (dup) => (
    <div className="rd-tape-strip" aria-hidden={dup ? 'true' : undefined}>
      {groups.map((g) => (
        <div className="rd-tape-group" key={g.group} role={dup ? undefined : 'group'} aria-label={dup ? undefined : g.group}>
          {g.items.map(({ r, t, loading }) => (
            <Tile key={r.key} r={r} t={t} loading={loading} ghost={dup} onOpen={openFor(r)} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <section
        ref={sectionRef}
        className={`rd-tape${paused ? ' is-paused' : ''}${dragging ? ' is-dragging' : ''}`}
        role="region"
        aria-label="Markets, scrolling"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocusIn}
        onBlur={onFocusOut}
      >
        <div
          ref={viewRef}
          className="rd-tape-view"
          onScroll={snapBackWhileSliding}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
        >
          <div ref={trackRef} className="rd-tape-track" style={{ '--tape-n': TAPE_ITEMS.length }}>
            {strip(false)}
            {strip(true)}
          </div>
        </div>
        <TapeControls
          userPaused={userPaused}
          onPause={() => setUserPaused((v) => !v)}
          onBack={() => glide(-page())}
          onForward={() => glide(page())}
        />
      </section>
      {/* The drill modals portal into the shell and keep their own skin. */}
      <IndicatorDrillModal indId={drillInd} onClose={() => setDrillInd(null)} />
      <IndexDrillModal indexKey={drillIdx} hist={hist} onClose={() => setDrillIdx(null)} />
    </>
  );
}
