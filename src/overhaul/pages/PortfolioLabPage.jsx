/* Portfolio Lab — /portfolio-lab (signed-in only).

   Build spec: PORTFOLIO_LAB_BUILD_SPEC.md (project folder, 2026-07-27).
   One workspace: holdings table (add/remove any US ticker, weight, per-row
   ER method), efficient frontier (click a point to load its weights),
   core statistics vs a benchmark, growth-of-$10K comparison, and saved
   portfolios per user (portfolio_lab_portfolios, RLS owner-only).

   ER methods live: CAPM, Weighted Scenarios, and (Phase 3, 2026-07-27)
   Implied vol — options-implied expected range from the London Strategic
   Edge ATM implied-vol term structure (lse-live edge function). Honest
   framing per spec §3.3: options give a RANGE, not a directional expected
   return, so drift stays CAPM and the volatility input swaps from
   historical to implied (correlations stay historical). A name with no
   listed options shows an em-dash and falls back to CAPM — never a
   fabricated value (LESSONS 4.4).

   Math: src/overhaul/lib/labMath.js — every formula paper-checked in
   labMath.test.mjs (LESSONS 3.4). Prices: api/price-history (Yahoo,
   adjusted, 5y) via useLabPrices — ONE price basis for every series on
   the page (LESSONS 2026-06-12b). Risk-free: ust_2y / ust_10y from the
   public indicator history (registered, chipped feeds). */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';
import useLabPrices, { useRiskFree, riskFreeForHorizon } from '../lib/useLabPrices';
import useLseIv from '../lib/useLseIv';
import useLseLive from '../../hooks/useLseLive';
import FreshnessChip from '../components/FreshnessChip';
import {
  HORIZONS, alignSeries, dailyReturns, annualVol, betaVs, covMatrix, corrMatrix,
  capmAnnualER, scenarioHorizonER, horizonFromAnnual, annualFromHorizon,
  portfolioER, portfolioVol, riskContribution, portfolioPath, maxDrawdown,
  efficientFrontier, sicToSectorEtf, ivAtHorizon, rescaleCovToImplied, riskCompensationER,
} from '../lib/labMath';
import { ERP_ANNUAL, ERP_SOURCE, MIN_HISTORY_DAYS } from '../lib/labConfig';
import '../styles/cream-system.css';
import '../styles/lab-v12.css';
// v13 last — it overrides the page's own v12 stylesheet.
import '../styles/v13.css';
import '../styles/pages-v13.css';

const BENCHMARKS = ['SPY', 'QQQ', 'IWM', 'DIA'];
const SECTOR_MIX = 'Sector mix';
const METHODS = { capm: 'CAPM', scen: 'Scenarios', ivol: 'Implied vol' };

const pct = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(dp)}%`);
const signPct = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`);
const money = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 1000 ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${v.toFixed(2)}`);

/* Scroll-reveal wrapper — same pattern as the other v12 pages. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

/* Ticker typeahead against ticker_reference (same query as the site search). */
function TickerAdd({ onAdd, existing }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const timer = useRef(null);
  const reqId = useRef(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim().replace(/[%,]/g, '');
    if (!term) { setRes([]); setOpen(false); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = ++reqId.current;
      // Exact symbol first, always — ETFs carry no market cap, so ranking by
      // cap alone buried SPY under name matches like Spyre (Joe, 7/27).
      const upper = term.toUpperCase();
      const [exact, fuzzy] = await Promise.all([
        supabase.from('ticker_reference').select('ticker,name').eq('ticker', upper).limit(1),
        supabase.from('ticker_reference').select('ticker,name')
          .or(`ticker.ilike.${term}%,name.ilike.%${term}%`)
          .order('market_cap', { ascending: false, nullsFirst: false })
          .limit(7),
      ]);
      if (id !== reqId.current) return;
      const merged = [...(exact.data || []), ...(fuzzy.data || [])]
        .filter((r, i, a) => a.findIndex((x) => x.ticker === r.ticker) === i)
        .slice(0, 7);
      setRes(merged);
      setOpen(true);
      setHi(0);
    }, 140);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (t) => {
    const T = String(t || q).trim().toUpperCase();
    if (T && !existing.includes(T)) onAdd(T);
    setQ(''); setRes([]); setOpen(false);
  };

  return (
    <div className="lab-add" ref={boxRef}>
      <input
        value={q}
        placeholder="Add a stock or ETF…"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(res[hi]?.ticker); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        aria-label="Add a stock or ETF"
      />
      {open && res.length > 0 && (
        <div className="lab-add-menu" role="listbox">
          {res.map((r, i) => (
            <button
              type="button"
              key={r.ticker}
              className={`lab-add-item${i === hi ? ' hi' : ''}${existing.includes(r.ticker) ? ' dim' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(r.ticker)}
            >
              <b>{r.ticker}</b><span>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Nice axis domain: snaps [lo,hi] outward to round-number bounds and returns
   gridline positions at every step — so the plot's edges ARE gridlines and no
   point can ever float above the last line (Joe, 7/27 ×2). */
function niceDomain(lo, hi, count = 4) {
  if (!(hi > lo)) hi = lo + (Math.abs(lo) || 1) * 0.1;
  const rough = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(v);
  return { min, max, step, ticks };
}

/* Efficient-frontier chart (SVG). Click loads the nearest point's weights. */
function FrontierChart({ frontier, current, benches, rf, onPick }) {
  const W = 640; const H = 340; const P = { l: 54, r: 16, t: 14, b: 36 };
  const [hover, setHover] = useState(null);
  if (!frontier || frontier.points.length < 2) return null;
  const pts = frontier.points;
  /* Scale to the CURVE + your portfolio only — reference dots must never
     dictate the domain (an SPY dot far from a high-vol book crushed the
     curve into the top corner). Bounds snap to round gridlines via
     niceDomain, so the plot edges are gridlines. Benchmarks render only
     when they land inside the visible window; the statistics card always
     carries the full benchmark comparison. */
  const xs = pts.map((p) => p.vol).concat(current ? [current.vol] : []);
  const ys = pts.map((p) => p.ret).concat(current ? [current.ret] : []);
  const xlo = Math.min(...xs); const xhi = Math.max(...xs);
  const ylo = Math.min(...ys); const yhi = Math.max(...ys);
  const xr = (xhi - xlo) || xhi * 0.2 || 0.02;
  const yr = (yhi - ylo) || Math.abs(yhi) * 0.2 || 0.02;
  /* Tight padding + denser gridlines (Joe 7/27: the loose 25-30% padding
     left the curve crushed into a corner of a mostly-empty plot). */
  const xd = niceDomain(Math.max(0, xlo - xr * 0.08), xhi + xr * 0.08, 6);
  const yd = niceDomain(ylo - yr * 0.12, yhi + yr * 0.12, 5);
  const xmin = xd.min; const xmax = xd.max;
  const ymin = yd.min; const ymax = yd.max;
  const visBenches = benches.filter((b) => b.vol >= xmin && b.vol <= xmax && b.ret >= ymin && b.ret <= ymax);
  const xdp = xd.step < 0.01 ? 1 : 0;
  const ydp = yd.step < 0.01 ? 1 : 0;
  const X = (v) => P.l + ((v - xmin) / (xmax - xmin)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - ((v - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.vol).toFixed(1)},${Y(p.ret).toFixed(1)}`).join(' ');
  const xticks = xd.ticks;
  const yticks = yd.ticks;
  const nearest = (mx, my) => {
    let best = null; let bd = Infinity;
    for (const p of pts) {
      const d = (X(p.vol) - mx) ** 2 + (Y(p.ret) - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const handleMove = (e) => {
    if (e.target?.classList?.contains('lab-clickmark')) return; // marker hover owns the read line
    const box = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - box.left) / box.width) * W;
    const my = ((e.clientY - box.top) / box.height) * H;
    setHover(nearest(mx, my));
  };
  /* Marker discipline (Joe 7/27, superseding the halo experiment): every
     marker is SMALL (4.5px) and coincident points are DEDUPLICATED on the
     canvas instead of stacked — when two presets land within a few pixels
     of each other (or of the portfolio dot), only the first renders; the
     legend below always carries all three names and stays clickable, so
     nothing is lost. Names never render on-canvas (they collide). */
  const markDefs = [
    { p: frontier.maxSharpe, cls: 'lab-markdot', r: 4.5, label: 'Max Sharpe' },
    { p: frontier.minVol, cls: 'lab-minvoldot', r: 4.5, label: 'Min volatility' },
    { p: frontier.equalWeight, cls: 'lab-eqdot', r: 4.5, label: 'Equal weight' },
  ];
  const placedPx = current ? [[X(current.vol), Y(current.ret)]] : [];
  const marks = [];
  for (const m of markDefs) {
    const mx = X(m.p.vol);
    const my = Y(m.p.ret);
    if (!placedPx.some(([px, py]) => (px - mx) ** 2 + (py - my) ** 2 < 121)) { // 11px apart minimum
      marks.push(m);
      placedPx.push([mx, my]);
    }
  }
  return (
    <div className="lab-chartwrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="lab-frontier"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover && onPick(hover)}
        role="img"
        aria-label="Efficient frontier: annual volatility vs expected return"
      >
        {yticks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="lab-grid" />
            <text x={P.l - 8} y={Y(v) + 4} className="lab-tick" textAnchor="end">{pct(v, ydp)}</text>
          </g>
        ))}
        {xticks.map((v, i) => (
          <text key={`x${i}`} x={X(v)} y={H - P.b + 22} className="lab-tick" textAnchor="middle">{pct(v, xdp)}</text>
        ))}
        <text x={(P.l + W - P.r) / 2} y={H - 4} className="lab-axis" textAnchor="middle">Volatility (annual)</text>
        <path d={path} className="lab-curve" fill="none" />
        {visBenches.map((b) => (
          <g key={b.ticker}>
            <circle cx={X(b.vol)} cy={Y(b.ret)} r="4" className="lab-benchdot" />
            <text x={X(b.vol) - 7} y={Y(b.ret) + 4} className="lab-dotlabel" textAnchor="end">{b.ticker}</text>
          </g>
        ))}
        {/* portfolio dot renders FIRST and ignores the pointer, so the
            clickable preset markers are never buried underneath it when the
            points coincide */}
        {current && <circle cx={X(current.vol)} cy={Y(current.ret)} r="5" className="lab-youdot" />}
        {marks.map((m) => (
          <circle
            key={m.cls}
            cx={X(m.p.vol)} cy={Y(m.p.ret)} r={m.r}
            className={`${m.cls} lab-clickmark`}
            onClick={(e) => { e.stopPropagation(); onPick(m.p); }}
            onMouseMove={(e) => { e.stopPropagation(); setHover({ ...m.p, label: m.label }); }}
          />
        ))}
        {hover && <circle cx={X(hover.vol)} cy={Y(hover.ret)} r="4" className="lab-hoverdot" />}
      </svg>
      <div className="lab-fmarks">
        <span className="lab-fmark"><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" className="lab-youdot" /></svg>Your portfolio</span>
        {markDefs.map((m) => (
          <button key={m.cls} type="button" className="lab-fmark asbtn" onClick={() => onPick(m.p)}>
            <svg width="12" height="12"><circle cx="6" cy="6" r="4.5" className={m.cls} /></svg>
            {m.label}
          </button>
        ))}
      </div>
      <div className="lab-frontier-read">
        {hover
          ? <>{hover.label ? `${hover.label}: ` : 'At '}{pct(hover.vol)} volatility{hover.label ? '' : ' the frontier'} expects {signPct(hover.ret)} a year — click to load these weights.</>
          : <>Click any point on the curve — or a marked point / its legend name — to load those weights into the table. Sharpe uses a {pct(rf, 2)} risk-free rate.</>}
      </div>
    </div>
  );
}

/* Growth-of-$10K comparison chart (SVG multi-line). */
function GrowthChart({ dates, lines }) {
  const W = 940; const H = 300; const P = { l: 58, r: 12, t: 12, b: 30 };
  if (!dates.length || !lines.length) return null;
  const all = lines.flatMap((l) => l.nav);
  /* Snap the dollar axis to round gridlines that enclose every line. */
  const yd = niceDomain(Math.min(...all) * 10000 * 0.99, Math.max(...all) * 10000 * 1.01);
  const ymin = yd.min / 10000;
  const ymax = yd.max / 10000;
  const X = (i) => P.l + (i / (dates.length - 1)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - ((v - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  const yearMarks = [];
  let lastYear = null;
  dates.forEach((d, i) => {
    const y = d.slice(0, 4);
    if (y !== lastYear) { yearMarks.push({ i, y }); lastYear = y; }
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lab-growth" role="img" aria-label="Growth of $10,000: portfolio vs benchmarks">
      {yd.ticks.map((d, k) => (
        <g key={k}>
          <line x1={P.l} x2={W - P.r} y1={Y(d / 10000)} y2={Y(d / 10000)} className="lab-grid" />
          <text x={P.l - 8} y={Y(d / 10000) + 4} className="lab-tick" textAnchor="end">{money(d)}</text>
        </g>
      ))}
      {yearMarks.slice(1).map((m) => (
        <text key={m.y} x={X(m.i)} y={H - 8} className="lab-tick" textAnchor="middle">{m.y}</text>
      ))}
      {lines.map((l) => (
        <path
          key={l.label}
          d={l.nav.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}
          className={`lab-line ${l.cls}`}
          fill="none"
        />
      ))}
    </svg>
  );
}

export default function PortfolioLabPage() {
  const { session, user, loading: authLoading } = useSession();
  const navigate = useNavigate();

  const [holdings, setHoldings] = useState([]); // {ticker, weight(%), method, scenarios}
  const [horizon, setHorizon] = useState('1y');
  const [benchSel, setBenchSel] = useState(['SPY']);
  const [openScen, setOpenScen] = useState(null); // ticker with scenario drawer open
  const [growthWin, setGrowthWin] = useState('max'); // growth-chart lookback
  const [saved, setSaved] = useState([]);
  const [activeName, setActiveName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [autoMsg, setAutoMsg] = useState('');
  const lastSavedRef = useRef(null); // JSON snapshot of the last persisted state
  const autoTimer = useRef(null);
  const [undoW, setUndoW] = useState(null);
  const [sicMap, setSicMap] = useState({});

  const years = HORIZONS[horizon].years;
  const held = holdings.map((h) => h.ticker);

  /* sector codes for the sector-mix benchmark */
  useEffect(() => {
    const need = held.filter((t) => !(t in sicMap));
    if (!need.length) return;
    supabase.from('ticker_reference').select('ticker,sic_code').in('ticker', need).then(({ data }) => {
      setSicMap((m) => {
        const next = { ...m };
        for (const t of need) next[t] = null;
        for (const r of data || []) next[r.ticker] = r.sic_code;
        return next;
      });
    });
  }, [held.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectorEtfs = useMemo(() => {
    if (!benchSel.includes(SECTOR_MIX)) return [];
    return [...new Set(held.map((t) => sicToSectorEtf(sicMap[t])))];
  }, [benchSel, held.join(','), sicMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const wanted = useMemo(
    () => [...new Set([...held, 'SPY', ...benchSel.filter((b) => b !== SECTOR_MIX), ...sectorEtfs])],
    [held.join(','), benchSel.join(','), sectorEtfs.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { series, lastPrice, asOf, loading: pricesLoading, failed } = useLabPrices(wanted);
  /* Live quotes for the held names, off the SAME resolver the ticker page and
     the home tape use (2026-08-18). Before this, the Lab's "Last" column was
     the previous session's close while the ticker page one click away was
     live — the same stock, two prices, and no way for a reader to tell which
     one was talking about today. The history series stays on adjusted closes;
     only the quoted price and the day move come from the live feed. */
  const labLive = useLseLive(held);
  /* Traded price + today's move per holding. Base preference is the quote
     provider's own prior close, then the previous raw close in the series —
     never a mixture of an adjusted and an unadjusted basis. */
  const quotes = useMemo(() => {
    const out = {};
    for (const t of held) {
      const q = labLive.bySymbol?.[t];
      const rows = series[t] || [];
      const lastRaw = rows.length ? (rows[rows.length - 1].raw ?? rows[rows.length - 1].c) : null;
      const prevRaw = rows.length > 1 ? (rows[rows.length - 2].raw ?? rows[rows.length - 2].c) : null;
      const live = q && q.covered && q.price != null ? q.price : null;
      const base = (q?.prevClose != null && q.prevClose > 0)
        ? q.prevClose
        : (live != null ? lastRaw : prevRaw);
      const price = live != null ? live : (lastPrice[t] ?? lastRaw);
      const pctChg = (price != null && base > 0) ? ((price / base) - 1) * 100 : null;
      out[t] = { price, pctChg, live: live != null };
    }
    return out;
  }, [held.join(','), labLive.bySymbol, series, lastPrice]); // eslint-disable-line react-hooks/exhaustive-deps
  const rfCurve = useRiskFree();
  const rfH = riskFreeForHorizon(rfCurve, horizon);   // for Sharpe/CAPM (annual rate)
  /* ATM implied-vol term structures — fetched only for rows on the
     Implied vol method (LSE options feed, server-cached). */
  const ivolTickers = holdings.filter((h) => h.method === 'ivol').map((h) => h.ticker);
  // SPY's implied vol is the market leg of the risk-compensation formula —
  // fetched whenever any holding is on the Implied vol method.
  const { byTicker: ivMap, loading: ivLoading } = useLseIv(ivolTickers.length ? [...ivolTickers, 'SPY'] : []);

  /* ── analysis pipeline ────────────────────────────────────────────── */
  const analysis = useMemo(() => {
    const have = held.filter((t) => series[t]?.length);
    if (!have.length || !series.SPY?.length) return null;

    /* Per-holding stats come from THAT holding's own overlap with SPY —
       never the book-wide intersection (LESSONS 8.21). One young name used
       to truncate every other series to its own length: adding a June-2026
       IPO with 32 bars blanked beta and expected return for all ten
       holdings and printed a 32-day annualized vol for names carrying
       thirty years of history (Joe, 7/30 — "everything is blank").
       A single holding's history is now a fact about that holding. */
    const own = {};
    for (const t of have) {
      const a = alignSeries({ x: series[t], SPY: series.SPY });
      own[t] = {
        days: a.dates.length,
        rets: dailyReturns(a.closes.x),
        spy: dailyReturns(a.closes.SPY),
      };
    }
    const enough = have.filter((t) => own[t].days >= MIN_HISTORY_DAYS);
    if (!have.some((t) => own[t].days >= 30)) return null;
    const spyVol = annualVol(dailyReturns(series.SPY.map((p) => p.c)));

    const perStock = {};
    for (const t of have) {
      const beta = own[t].days >= 30 ? betaVs(own[t].rets, own[t].spy) : null;
      const vol = own[t].days >= 30 ? annualVol(own[t].rets) : null;
      const h = holdings.find((x) => x.ticker === t);
      let erAnnual = null;
      let erH = null;
      let range = null;
      let implVol = null;
      let ivMissing = false;
      if (h.method === 'scen') {
        erH = scenarioHorizonER(h.scenarios, lastPrice[t]);
        erAnnual = annualFromHorizon(erH, years);
        if (erH != null && lastPrice[t] > 0) {
          range = [h.scenarios.bear.price / lastPrice[t] - 1, h.scenarios.bull.price / lastPrice[t] - 1];
        }
      } else {
        if (h.method === 'ivol') {
          // Risk-compensation expected return (Joe-approved 2026-07-27):
          // ER = risk-free + market Sharpe ratio × the stock's option-implied
          // volatility, both vols at the 1-year point. Market leg = SPY
          // implied vol (historical SPY vol as fallback). The ER now MOVES
          // with the options market; no listed options → CAPM fallback +
          // em-dash note (LESSONS 4.4).
          implVol = ivAtHorizon(ivMap[t]?.term, years * 365);
          const stockIv1y = ivAtHorizon(ivMap[t]?.term, 365);
          const marketVol = ivAtHorizon(ivMap.SPY?.term, 365) ?? spyVol;
          if (stockIv1y != null && implVol != null) {
            erAnnual = riskCompensationER(rfH, ERP_ANNUAL, marketVol, stockIv1y);
            erH = horizonFromAnnual(erAnnual, years);
            if (erH != null) {
              const moveH = implVol * Math.sqrt(years); // market-implied expected move over the horizon
              range = [erH - moveH, erH + moveH];
            }
          } else {
            ivMissing = true; // no listed options → CAPM drift + historical vol
            erAnnual = enough.includes(t) ? capmAnnualER(beta, rfH, ERP_ANNUAL) : null;
            erH = horizonFromAnnual(erAnnual, years);
            if (erH != null) {
              const volH = vol * Math.sqrt(years);
              range = [erH - volH, erH + volH];
            }
          }
        } else {
          // CAPM
          erAnnual = enough.includes(t) ? capmAnnualER(beta, rfH, ERP_ANNUAL) : null;
          erH = horizonFromAnnual(erAnnual, years);
          if (erH != null) {
            const volH = vol * Math.sqrt(years);
            range = [erH - volH, erH + volH];
          }
        }
      }
      perStock[t] = {
        beta: enough.includes(t) ? beta : null,
        vol, erAnnual, erH, range, implVol, ivMissing,
        days: own[t].days,
        thin: !enough.includes(t),
      };
    }
    const valid = have.filter((t) => perStock[t].erAnnual != null && !perStock[t].thin);
    const excluded = have.filter((t) => perStock[t].thin);

    /* The optimizer's shared window is the intersection over the names it
       actually uses (valid + SPY) — a holding that is too young to be
       optimized must not shorten the window for the ones that aren't
       (LESSONS 8.21). */
    const covNames = [...valid, 'SPY'];
    const { dates, closes } = alignSeries(Object.fromEntries(covNames.map((t) => [t, series[t]])));
    const rets = {};
    for (const t of covNames) rets[t] = dailyReturns(closes[t]);

    // Covariance: historical, then the Implied vol rows' diagonal swaps to
    // options-implied vol (correlations stay historical) — ONE matrix feeds
    // the frontier, portfolio vol, and risk contribution (2026-06-12b: one
    // shared computation per concept).
    const Shist = covMatrix(rets, valid);
    const histVolMap = Object.fromEntries(valid.map((t) => [t, annualVol(rets[t])]));
    const implVolMap = Object.fromEntries(valid.filter((t) => perStock[t].implVol != null).map((t) => [t, perStock[t].implVol]));
    const S = Object.keys(implVolMap).length ? rescaleCovToImplied(Shist, valid, histVolMap, implVolMap) : Shist;

    /* Correlations run on the SAME window and the SAME names as the covariance
       that feeds the frontier — one concept, one computation (2026-06-12b).
       Including a 33-day IPO would drag the whole grid down to 33 days, and a
       two-month correlation printed beside 1.5-year risk numbers is the same
       class of mistake this fix exists to remove. Short names are named in the
       excluded note above the table instead. */
    const C = valid.length >= 2 ? corrMatrix(rets, valid) : null;

    return { dates, closes, rets, perStock, valid, have, excluded, S, C };
  }, [held.join(','), JSON.stringify(holdings), series, lastPrice, rfH, years, ivMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const weightsSum = holdings.reduce((s, h) => s + (Number(h.weight) || 0), 0);

  /* Turn a count of trading days into the page's window label. */
  const spanLabel = (days) => {
    if (!days) return '5y';
    const y = days / 252;
    if (y >= 4.8) return '5y';
    if (y >= 1) return `${(Math.round(y * 10) / 10).toString().replace(/\.0$/, '')}y`;
    return `${Math.round(y * 12)}mo`;
  };

  /* The shared window behind the PORTFOLIO numbers — vol, Sharpe, drawdown,
     the frontier: the intersection across the holdings the optimizer can
     actually use, capped at 5 years by the price fetch. Per-holding beta and
     vol no longer live here; each of those uses that holding's own overlap
     with SPY (LESSONS 8.21), so one young name can no longer shrink the
     window for the whole book (Joe, 7/27 "what if we don't have 5 years?",
     7/30 "everything is blank"). */
  const windowLabel = useMemo(() => spanLabel(analysis?.dates?.length), [analysis]);

  const portfolio = useMemo(() => {
    if (!analysis || analysis.valid.length < 1) return null;
    const { perStock, valid, S, rets, dates, closes } = analysis;
    const raw = valid.map((t) => Number(holdings.find((h) => h.ticker === t)?.weight) || 0);
    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const w = raw.map((x) => x / total);
    const mu = valid.map((t) => perStock[t].erAnnual);
    const erAnnual = portfolioER(w, mu);
    const volAnnual = portfolioVol(w, S);
    const nav = portfolioPath(dates, closes, valid, w);
    const benchRets = rets.SPY;
    const pRets = dailyReturns(nav);
    return {
      w, mu, valid,
      erAnnual,
      erH: horizonFromAnnual(erAnnual, years),
      volAnnual,
      volH: volAnnual * Math.sqrt(years),
      sharpe: rfH != null && volAnnual > 0 ? (erAnnual - rfH) / volAnnual : null,
      beta: betaVs(pRets, benchRets),
      mdd: maxDrawdown(nav),
      rc: riskContribution(w, S),
      nav,
    };
  }, [analysis, JSON.stringify(holdings.map((h) => [h.ticker, h.weight])), rfH, years]); // eslint-disable-line react-hooks/exhaustive-deps

  const frontier = useMemo(() => {
    if (!analysis || analysis.valid.length < 2 || rfH == null) return null;
    const mu = analysis.valid.map((t) => analysis.perStock[t].erAnnual);
    return efficientFrontier(analysis.S, mu, rfH, 40);
  }, [analysis, rfH]);

  /* benchmark stats + growth lines */
  const benchStats = useMemo(() => {
    if (!analysis) return [];
    const out = [];
    for (const b of BENCHMARKS) {
      if (!series[b]?.length) continue;
      const { dates, closes } = alignSeries({ b: series[b], SPY: series.SPY });
      if (dates.length < 30) continue;
      const rb = dailyReturns(closes.b);
      const beta = betaVs(rb, dailyReturns(closes.SPY));
      const erAnnual = capmAnnualER(beta, rfH, ERP_ANNUAL);
      out.push({ ticker: b, vol: annualVol(rb), beta, erAnnual, erH: horizonFromAnnual(erAnnual, years) });
    }
    return out;
  }, [analysis, series, rfH, years]);

  const growth = useMemo(() => {
    if (!portfolio || !analysis) return { dates: [], lines: [] };
    const want = benchSel.filter((b) => b !== SECTOR_MIX);
    const mixWeights = {};
    if (benchSel.includes(SECTOR_MIX)) {
      const total = analysis.valid.reduce((s, t) => s + (Number(holdings.find((h) => h.ticker === t)?.weight) || 0), 0);
      for (const t of analysis.valid) {
        const etf = sicToSectorEtf(sicMap[t]);
        const w = (Number(holdings.find((h) => h.ticker === t)?.weight) || 0) / (total || 1);
        if (series[etf]?.length) mixWeights[etf] = (mixWeights[etf] || 0) + w;
      }
    }
    const all = { ...Object.fromEntries(analysis.valid.map((t) => [t, series[t]])) };
    for (const b of want) if (series[b]?.length) all[b] = series[b];
    for (const e of Object.keys(mixWeights)) all[e] = series[e];
    let { dates, closes } = alignSeries(all);
    // Chart lookback picker: slice the common history to the chosen window,
    // then every line re-bases to $10K at the window start.
    const WIN_DAYS = { '1y': 252, '2y': 504, '3y': 756, max: Infinity };
    const keep = Math.min(dates.length, WIN_DAYS[growthWin] ?? Infinity);
    if (keep < dates.length) {
      const i0 = dates.length - keep;
      dates = dates.slice(i0);
      closes = Object.fromEntries(Object.entries(closes).map(([k, v]) => [k, v.slice(i0)]));
    }
    if (dates.length < 30) return { dates: [], lines: [] };
    const raw = analysis.valid.map((t) => Number(holdings.find((h) => h.ticker === t)?.weight) || 0);
    const tot = raw.reduce((a, b) => a + b, 0) || 1;
    const lines = [{
      label: 'Your portfolio', cls: 'you',
      nav: portfolioPath(dates, closes, analysis.valid, raw.map((x) => x / tot)),
    }];
    want.forEach((b, i) => {
      if (closes[b]) lines.push({ label: b, cls: `b${i}`, nav: portfolioPath(dates, closes, [b], [1]) });
    });
    const mixKeys = Object.keys(mixWeights);
    if (mixKeys.length) {
      const mt = mixKeys.reduce((s, k) => s + mixWeights[k], 0) || 1;
      lines.push({
        label: SECTOR_MIX, cls: 'mix',
        nav: portfolioPath(dates, closes, mixKeys, mixKeys.map((k) => mixWeights[k] / mt)),
      });
    }
    return { dates, lines };
  }, [portfolio, analysis, benchSel.join(','), growthWin, series, sicMap, JSON.stringify(holdings.map((h) => [h.ticker, h.weight]))]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── saved portfolios ──────────────────────────────────────────────
     The active portfolio is a live container: once a book has a name,
     every change (holdings, weights, methods, scenarios, horizon,
     benchmarks) AUTO-SAVES, and returning to the page restores the most
     recently touched portfolio — clicking away never loses work
     (Joe, 7/27: added 4 stocks, navigated away, book came back empty). */
  const snapshot = (h, hz, bs) => JSON.stringify({ h, hz, bs });

  /* Chip clicks re-fetch the row so a book auto-saved since the list was
     last read never loads stale contents (caught in UAT: switch between two
     portfolios returned the older copy). */
  async function openPortfolio(row) {
    const { data } = await supabase.from('portfolio_lab_portfolios')
      .select('id,name,holdings,horizon,benchmark,updated_at')
      .eq('id', row.id).maybeSingle();
    loadPortfolio(data || row);
  }

  function loadPortfolio(row) {
    const h = Array.isArray(row.holdings) ? row.holdings : [];
    const hz = row.horizon && HORIZONS[row.horizon] ? row.horizon : '1y';
    const bs = String(row.benchmark || 'SPY').split(',').filter(Boolean);
    lastSavedRef.current = snapshot(h, hz, bs.join(','));
    setHoldings(h);
    setHorizon(hz);
    setBenchSel(bs);
    setActiveName(row.name);
    setAutoMsg('');
  }

  const refreshSaved = (autoloadIfBlank = false) => {
    if (!user) return;
    supabase.from('portfolio_lab_portfolios').select('id,name,holdings,horizon,benchmark,updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setSaved(data || []);
        if (autoloadIfBlank && data?.length && !activeName && !holdings.length) loadPortfolio(data[0]);
      });
  };
  useEffect(() => refreshSaved(true), [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(name) {
    const row = {
      user_id: user.id, name, holdings, horizon,
      benchmark: benchSel.join(','), updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('portfolio_lab_portfolios')
      .upsert(row, { onConflict: 'user_id,name' });
    if (!error) {
      lastSavedRef.current = snapshot(holdings, horizon, benchSel.join(','));
      // keep the in-memory chip list current so a later chip click can never
      // resurrect a pre-auto-save copy
      setSaved((s) => s.map((r) => (r.name === name
        ? { ...r, holdings, horizon, benchmark: benchSel.join(','), updated_at: row.updated_at }
        : r)));
    }
    return error;
  }

  /* Auto-save: debounce any change while a portfolio is active. */
  useEffect(() => {
    if (!user || !activeName) return undefined;
    const snap = snapshot(holdings, horizon, benchSel.join(','));
    if (snap === lastSavedRef.current) return undefined;
    setAutoMsg('Saving…');
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(async () => {
      const error = await persist(activeName);
      setAutoMsg(error ? `Not saved — ${error.message}` : 'All changes saved');
    }, 800);
    return () => clearTimeout(autoTimer.current);
  }, [user?.id, activeName, JSON.stringify(holdings), horizon, benchSel.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePortfolio() {
    const name = (saveName || activeName || '').trim();
    if (!user || !name) { setSaveMsg('Name it first'); return; }
    const error = await persist(name);
    setSaveMsg(error ? `Save failed: ${error.message}` : 'Saved');
    if (!error) { setActiveName(name); setSaveName(''); refreshSaved(); }
    setTimeout(() => setSaveMsg(''), 2500);
  }

  function newPortfolio() {
    clearTimeout(autoTimer.current);
    lastSavedRef.current = null;
    setHoldings([]);
    setActiveName('');
    setSaveName('');
    setAutoMsg('');
  }

  async function deletePortfolio(row) {
    await supabase.from('portfolio_lab_portfolios').delete().eq('id', row.id);
    if (activeName === row.name) newPortfolio();
    refreshSaved();
  }

  /* ── holdings edits ───────────────────────────────────────────────── */
  const defaultScen = (t) => {
    const p = lastPrice[t] || 100;
    return {
      bull: { price: Math.round(p * 1.25 * 100) / 100, prob: 25 },
      base: { price: Math.round(p * 1.08 * 100) / 100, prob: 50 },
      bear: { price: Math.round(p * 0.85 * 100) / 100, prob: 25 },
    };
  };
  // Adding a name re-splits the book equally — predictable starting point;
  // set weights by hand or click the frontier afterwards.
  const addTicker = (t) => setHoldings((hs) => {
    const next = [...hs, { ticker: t, weight: 0, method: 'capm', scenarios: null }];
    const w = Math.round((100 / next.length) * 10) / 10;
    const first = Math.round((100 - w * (next.length - 1)) * 10) / 10; // rounding remainder
    return next.map((h, i) => ({ ...h, weight: i === 0 ? first : w }));
  });
  const removeTicker = (t) => setHoldings((hs) => hs.filter((h) => h.ticker !== t));
  // One click sets every holding's method (spec §2's global switcher —
  // built 2026-07-27 on Joe's ask; per-row overrides still work after).
  const setAllMethods = (m) => {
    setHoldings((hs) => hs.map((h) => ({
      ...h,
      method: m,
      scenarios: m === 'scen' ? (h.scenarios || defaultScen(h.ticker)) : h.scenarios,
    })));
    setOpenScen(null);
  };
  const patch = (t, up) => setHoldings((hs) => hs.map((h) => (h.ticker === t ? { ...h, ...up } : h)));
  const patchScen = (t, k, f, v) => setHoldings((hs) => hs.map((h) => (
    h.ticker === t
      ? { ...h, scenarios: { ...h.scenarios, [k]: { ...h.scenarios[k], [f]: Number(v) } } }
      : h
  )));
  const rebalance = () => setHoldings((hs) => {
    const s = hs.reduce((a, h) => a + (Number(h.weight) || 0), 0);
    const scaled = s <= 0
      ? hs.map(() => Math.round((100 / hs.length) * 10) / 10)
      : hs.map((h) => Math.round(((Number(h.weight) || 0) / s) * 1000) / 10);
    const drift = Math.round((100 - scaled.reduce((a, b) => a + b, 0)) * 10) / 10;
    if (scaled.length) scaled[0] = Math.round((scaled[0] + drift) * 10) / 10;
    return hs.map((h, i) => ({ ...h, weight: scaled[i] }));
  });
  const applyFrontier = (pt) => {
    if (!analysis) return;
    setUndoW(holdings.map((h) => ({ ticker: h.ticker, weight: h.weight })));
    setHoldings((hs) => hs.map((h) => {
      const i = analysis.valid.indexOf(h.ticker);
      return { ...h, weight: i >= 0 ? Math.round(pt.weights[i] * 1000) / 10 : 0 };
    }));
  };
  const undo = () => {
    if (!undoW) return;
    setHoldings((hs) => hs.map((h) => ({ ...h, weight: undoW.find((u) => u.ticker === h.ticker)?.weight ?? h.weight })));
    setUndoW(null);
  };

  /* ── auth gate ────────────────────────────────────────────────────── */
  if (authLoading) return null;
  if (!session) return <Navigate to="/signin" replace />;

  const selBench = benchStats.find((b) => b.ticker === (benchSel.find((x) => x !== SECTOR_MIX) || 'SPY'));
  const failedHeld = held.filter((t) => failed[t]);

  return (
    <div className="home-v12 v13 lab-v12">
      <div className="wrap">

        <Reveal as="section" className="lab-head">
          <div className="eyebrow2"><span className="dot" />Portfolio Lab</div>
          <h1 className="serif">Expected return &amp; portfolio construction</h1>
          <p className="lab-sub">
            Add stocks, choose how each one&rsquo;s expected return is estimated, then optimize the mix
            and compare it against benchmarks. Return, beta and volatility use split- and
            dividend-adjusted daily closes through {asOf || '—'}; Last and Today are the traded
            price, live while the market is open · Risk-free {pct(rfH, 2)} ({horizon === '3y' ? '2y–10y Treasury blend' : '2-year Treasury'}
            {rfCurve.asOf ? `, ${rfCurve.asOf}` : ''}).
            {ivolTickers.length > 0 && (
              <span className="lab-ivchip">
                <FreshnessChip elementId="options-lse_atm_iv-ondemand" variant="label" />
                {ivLoading ? ' Fetching options data…' : null}
              </span>
            )}
          </p>

          <div className="lab-controls">
            <div className="lab-ctl">
              <span className="label">Horizon</span>
              <div className="lab-seg">
                {Object.entries(HORIZONS).map(([k, h]) => (
                  <button key={k} type="button" className={horizon === k ? 'on' : ''} onClick={() => setHorizon(k)}>{h.label}</button>
                ))}
              </div>
            </div>
            <div className="lab-ctl">
              <span className="label">Saved portfolios</span>
              <div className="lab-savedrow">
                {saved.length === 0 && <span className="lab-dim">None yet</span>}
                {saved.map((r) => (
                  <span key={r.id} className={`lab-savedchip${activeName === r.name ? ' on' : ''}`}>
                    <button type="button" onClick={() => openPortfolio(r)}>{r.name}</button>
                    <button type="button" className="x" aria-label={`Delete ${r.name}`} onClick={() => deletePortfolio(r)}>×</button>
                  </span>
                ))}
              </div>
              <div className="lab-saverow">
                <input
                  value={saveName}
                  placeholder={activeName ? 'Rename / save a copy…' : 'Portfolio name'}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button type="button" className="lab-btn" onClick={savePortfolio}>Save</button>
                <button type="button" className="lab-btn ghost" onClick={newPortfolio}>New</button>
                {saveMsg && <span className="lab-dim">{saveMsg}</span>}
                {!saveMsg && activeName && (
                  <span className="lab-dim">{autoMsg || `Working on “${activeName}” — changes save automatically`}</span>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        {/* ── holdings table ── */}
        <Reveal as="section" className="lab-card">
          <div className="lab-cardhead">
            <h2 className="serif">Holdings</h2>
            <div className="lab-headtools">
              {holdings.length >= 2 && (
                <div className="lab-ctl lab-allmethod">
                  <span className="label">Set all methods</span>
                  <div className="lab-seg small">
                    {Object.entries(METHODS).map(([k, v]) => {
                      const allOn = holdings.length > 0 && holdings.every((h) => h.method === k);
                      return (
                        <button key={k} type="button" className={allOn ? 'on' : ''} onClick={() => setAllMethods(k)}>{v}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              <TickerAdd onAdd={addTicker} existing={held} />
            </div>
          </div>

          {failedHeld.length > 0 && (
            <p className="lab-warn">No price history found for {failedHeld.join(', ')} — check the symbol.</p>
          )}

          {holdings.length === 0 ? (
            <p className="lab-empty">Add a stock to begin. A single stock shows its expected return; two or more unlock the optimizer.</p>
          ) : (
            <>
              <div className="lab-tablewrap">
                <table className="lab-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th className="num">Last</th>
                      <th className="num">Today</th>
                      {/* Beta and volatility are per-holding facts, each from
                          that name's own history vs SPY (up to 5y) — not the
                          book-wide window (LESSONS 8.21). */}
                      <th className="num">Beta · vs SPY</th>
                      <th className="num">Volatility</th>
                      <th className="num">Weight %</th>
                      <th>Method</th>
                      <th className="num">Expected return · {HORIZONS[horizon].label}</th>
                      <th className="num">Range</th>
                      <th aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => {
                      const ps = analysis?.perStock?.[h.ticker];
                      const scenOpen = openScen === h.ticker;
                      return (
                        <React.Fragment key={h.ticker}>
                          <tr
                            className={`lab-row${failed[h.ticker] ? ' dim' : ''}`}
                            onClick={(e) => {
                              // controls keep their own behavior; anywhere else in the row opens the ticker page
                              if (e.target.closest('button, input, select, a')) return;
                              navigate(`/ticker/${h.ticker}`);
                            }}
                          >
                            <td className="tick">
                              <button type="button" className="lab-ticklink" onClick={() => navigate(`/ticker/${h.ticker}`)}>{h.ticker}</button>
                            </td>
                            <td className="num">{money(quotes[h.ticker]?.price)}</td>
                            <td className="num">
                              {Number.isFinite(quotes[h.ticker]?.pctChg) ? (
                                <span className={quotes[h.ticker].pctChg >= 0 ? 'up' : 'down'}>
                                  {quotes[h.ticker].pctChg >= 0 ? '+' : ''}{quotes[h.ticker].pctChg.toFixed(2)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="num">{ps?.beta == null ? '—' : ps.beta.toFixed(2)}</td>
                            {/* The volatility the optimizer actually uses for
                                this row: options-implied for Implied vol rows
                                (marked), realized 5y daily otherwise — one
                                concept, one source per row (2026-06-12b). */}
                            <td className="num">
                              {h.method === 'ivol' && ps?.implVol != null
                                ? <>{pct(ps.implVol, 0)}<span className="lab-ivtag">impl</span></>
                                : (ps?.vol == null || !Number.isFinite(ps.vol) ? '—' : pct(ps.vol, 0))}
                            </td>
                            <td className="num">
                              <input
                                className="lab-w"
                                type="number" min="0" max="100" step="0.1"
                                value={h.weight}
                                onChange={(e) => patch(h.ticker, { weight: e.target.value === '' ? '' : Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <select
                                className="lab-method"
                                value={h.method}
                                onChange={(e) => {
                                  const m = e.target.value;
                                  patch(h.ticker, { method: m, scenarios: m === 'scen' ? (h.scenarios || defaultScen(h.ticker)) : h.scenarios });
                                  setOpenScen(m === 'scen' ? h.ticker : (scenOpen ? null : openScen));
                                }}
                              >
                                {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                              {h.method === 'scen' && (
                                <button type="button" className="lab-scenbtn" onClick={() => setOpenScen(scenOpen ? null : h.ticker)}>
                                  {scenOpen ? 'Close' : 'Edit'}
                                </button>
                              )}
                            </td>
                            <td className={`num strong ${ps?.erH > 0 ? 'up' : ps?.erH < 0 ? 'down' : ''}`}>
                              {/* Say WHICH holding is short and by how much —
                                  "insufficient history" on ten rows at once
                                  reads as an outage (Joe, 7/30). */}
                              {ps?.erH == null && ps?.thin && (h.method === 'capm' || h.method === 'ivol')
                                ? <span className="lab-dim">— {ps.days}d of history · needs {MIN_HISTORY_DAYS}</span>
                                : signPct(ps?.erH)}
                            </td>
                            <td className="num">
                              {h.method === 'ivol' && ps?.ivMissing
                                ? <span className="lab-dim">— not covered by the live options feed; using CAPM</span>
                                : ps?.range
                                  ? <>
                                      {signPct(ps.range[0], 0)} to {signPct(ps.range[1], 0)}
                                      {h.method === 'ivol' && ps?.implVol != null && (
                                        <span className="lab-ivnote">
                                          {/* Every row states its data vintage the same way (Joe
                                              2026-07-28): live-feed names read "live", nightly-
                                              archive names read "as of <date> close". */}
                                          market-implied · 1y IV {pct(ivAtHorizon(ivMap[h.ticker]?.term, 365), 0)}
                                          {ivMap[h.ticker]?.source === 'archive' && ivMap[h.ticker]?.asOf
                                            ? ` · as of ${new Date(`${ivMap[h.ticker].asOf}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} close`
                                            : ' · live'}
                                        </span>
                                      )}
                                    </>
                                  : '—'}
                            </td>
                            <td className="num">
                              <button type="button" className="lab-x" aria-label={`Remove ${h.ticker}`} onClick={() => removeTicker(h.ticker)}>×</button>
                            </td>
                          </tr>
                          {scenOpen && h.scenarios && (
                            <tr className="lab-scenrow">
                              <td colSpan={10}>
                                <div className="lab-scen">
                                  {['bull', 'base', 'bear'].map((k) => (
                                    <div key={k} className="lab-scencase">
                                      <span className={`label ${k}`}>{k === 'bull' ? 'Bull' : k === 'base' ? 'Base' : 'Bear'}</span>
                                      <label>Target price
                                        <input type="number" min="0" step="0.01" value={h.scenarios[k].price}
                                          onChange={(e) => patchScen(h.ticker, k, 'price', e.target.value)} />
                                      </label>
                                      <label>Probability %
                                        <input type="number" min="0" max="100" step="1" value={h.scenarios[k].prob}
                                          onChange={(e) => patchScen(h.ticker, k, 'prob', e.target.value)} />
                                      </label>
                                    </div>
                                  ))}
                                  <div className={`lab-scensum${Math.round(['bull', 'base', 'bear'].reduce((s, k) => s + (Number(h.scenarios[k].prob) || 0), 0)) === 100 ? ' ok' : ' bad'}`}>
                                    Probabilities sum to {Math.round(['bull', 'base', 'bear'].reduce((s, k) => s + (Number(h.scenarios[k].prob) || 0), 0))}% — must equal 100%.
                                    Targets are prices at the end of the {HORIZONS[horizon].label} horizon.
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Names the optimizer had to drop, and why — a holding
                  silently missing from the risk numbers is worse than a
                  holding you were told about (LESSONS 8.21). */}
              {analysis?.excluded?.length > 0 && (
                <p className="lab-dim lab-excluded">
                  {analysis.excluded.join(', ')} {analysis.excluded.length === 1 ? 'has' : 'have'} under{' '}
                  {MIN_HISTORY_DAYS} days of price history, so {analysis.excluded.length === 1 ? 'it is' : 'they are'} left
                  out of the expected return, risk and frontier numbers below. Every other holding is unaffected.
                </p>
              )}
              <div className="lab-tally">
                <span className={Math.round(weightsSum * 10) / 10 === 100 ? 'ok' : 'warn'}>
                  Weights sum to {Math.round(weightsSum * 10) / 10}%
                </span>
                {Math.round(weightsSum * 10) / 10 !== 100 && (
                  <button type="button" className="lab-btn" onClick={rebalance}>Rebalance to 100%</button>
                )}
                {undoW && <button type="button" className="lab-btn ghost" onClick={undo}>Undo weight change</button>}
              </div>
            </>
          )}
        </Reveal>

        {/* ── efficient frontier ── */}
        {holdings.length >= 2 && (
          <Reveal as="section" className="lab-card">
            <div className="lab-cardhead">
              <h2 className="serif">Efficient frontier</h2>
              <span className="lab-dim">Expected return uses each holding&rsquo;s selected method · beta and volatility from each holding&rsquo;s own daily history vs SPY (up to 5 years) · portfolio risk from the shared history of the optimized holdings ({windowLabel === '5y' ? '5 years' : `${windowLabel} — the longest window they all cover, capped at 5 years`}); Implied vol rows swap in options-implied volatility</span>
            </div>
            {frontier && portfolio ? (
              <FrontierChart
                frontier={frontier}
                current={{ vol: portfolio.volAnnual, ret: portfolio.erAnnual }}
                benches={benchStats.map((b) => ({ ticker: b.ticker, vol: b.vol, ret: b.erAnnual }))}
                rf={rfH}
                onPick={applyFrontier}
              />
            ) : (
              <p className="lab-empty">
                {pricesLoading ? 'Loading price history…'
                  : 'The frontier needs at least two holdings with a valid expected return and a year of price history.'}
              </p>
            )}
          </Reveal>
        )}

        {/* ── statistics ── */}
        {portfolio && (
          <Reveal as="section" className="lab-card">
            <div className="lab-cardhead">
              <h2 className="serif">Portfolio statistics</h2>
              <span className="lab-dim">vs {selBench?.ticker || 'SPY'} · {windowLabel === '5y' ? '5 years of shared daily history' : `${windowLabel} of shared daily history — the longest window the optimized holdings all cover`}</span>
            </div>
            <div className="lab-statgrid" role="table" aria-label="Portfolio statistics vs benchmark">
              <div className="lab-statrow head" role="row">
                <span role="columnheader">&nbsp;</span>
                <span className="num" role="columnheader">Your portfolio</span>
                <span className="num" role="columnheader">{selBench?.ticker || 'SPY'}</span>
              </div>
              {[
                ['Expected return', signPct(portfolio.erH), signPct(selBench?.erH)],
                ['Volatility', pct(portfolio.volH), selBench ? pct(selBench.vol * Math.sqrt(years)) : '—'],
                ['Sharpe ratio', portfolio.sharpe == null ? '—' : portfolio.sharpe.toFixed(2),
                  selBench && selBench.vol > 0 ? ((selBench.erAnnual - rfH) / selBench.vol).toFixed(2) : '—'],
                [`Beta vs SPY · ${windowLabel}`, portfolio.beta == null ? '—' : portfolio.beta.toFixed(2),
                  selBench?.beta == null ? '—' : selBench.beta.toFixed(2)],
                [`Max drawdown (${windowLabel})`, pct(portfolio.mdd), (() => {
                  const b = selBench?.ticker;
                  if (!b || !series[b]?.length) return '—';
                  return pct(maxDrawdown(series[b].map((p) => p.c)));
                })()],
              ].map(([label, a, b]) => (
                <div className="lab-statrow" role="row" key={label}>
                  <span role="cell">{label}</span>
                  <span className="num strong" role="cell">{a}</span>
                  <span className="num" role="cell">{b}</span>
                </div>
              ))}
            </div>

            <div className="lab-substats">
              <div className="lab-sub-col">
                <h3 className="label">Contribution to risk</h3>
                {portfolio.valid.map((t, i) => (
                  <div key={t} className="lab-rcrow">
                    <button type="button" className="tick lab-ticklink" onClick={() => navigate(`/ticker/${t}`)}>{t}</button>
                    <span className="lab-rcbar"><i style={{ width: `${Math.max(portfolio.rc[i] * 100, 0)}%` }} /></span>
                    <span className="num">{pct(portfolio.rc[i], 0)}</span>
                  </div>
                ))}
              </div>
              {analysis && analysis.C && analysis.valid.length >= 2 && (
                <div className="lab-sub-col">
                  <h3 className="label">Correlation of daily returns</h3>
                  {/* Same names and same window as the frontier and the risk
                      table — holdings too young to be optimized are named in
                      the note under the Holdings table, not silently folded
                      into a two-month correlation (LESSONS 8.21). */}
                  <span className="lab-dim">{windowLabel === '5y' ? '5 years' : windowLabel} of shared daily history — the same window as the risk numbers</span>
                  <div className="lab-corr" style={{ gridTemplateColumns: `52px repeat(${analysis.valid.length}, 1fr)` }}>
                    <span />
                    {analysis.valid.map((t) => (
                      <button key={`h${t}`} type="button" className="lab-corrhead lab-ticklink" onClick={() => navigate(`/ticker/${t}`)}>{t}</button>
                    ))}
                    {analysis.valid.map((t, i) => (
                      <React.Fragment key={`r${t}`}>
                        <button type="button" className="lab-corrhead lab-ticklink" onClick={() => navigate(`/ticker/${t}`)}>{t}</button>
                        {analysis.valid.map((u, j) => {
                          const v = analysis.C[i][j];
                          return (
                            <span
                              key={`${t}${u}`}
                              className="lab-corrcell"
                              style={{ background: `color-mix(in srgb, var(--gold-deep) ${Math.round(Math.abs(v) * 55)}%, var(--bg2))` }}
                            >{v.toFixed(2)}</span>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Reveal>
        )}

        {/* ── benchmark comparison ── */}
        {portfolio && (
          <Reveal as="section" className="lab-card">
            <div className="lab-cardhead">
              <h2 className="serif">Growth of $10,000</h2>
              <div className="lab-chartctl">
                <div className="lab-seg small">
                  {[['1y', '1 year'], ['2y', '2 years'], ['3y', '3 years'], ['max', 'Max']].map(([k, l]) => (
                    <button key={k} type="button" className={growthWin === k ? 'on' : ''} onClick={() => setGrowthWin(k)}>{l}</button>
                  ))}
                </div>
                <div className="lab-benchpick">
                  {[...BENCHMARKS, SECTOR_MIX].map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={benchSel.includes(b) ? 'on' : ''}
                      onClick={() => setBenchSel((s) => (s.includes(b) ? s.filter((x) => x !== b) : [...s, b]))}
                    >{b}</button>
                  ))}
                </div>
              </div>
            </div>
            {growth.lines.length ? (
              <>
                <GrowthChart dates={growth.dates} lines={growth.lines} />
                <div className="lab-legend">
                  {growth.lines.map((l) => (
                    <span key={l.label} className={`lab-leg ${l.cls}`}>
                      <i />{l.label}
                      <b className="num">{money(l.nav[l.nav.length - 1] * 10000)}</b>
                    </span>
                  ))}
                </div>
                <p className="lab-foot">
                  Historical performance of today&rsquo;s weights, rebalanced monthly. Every line starts at
                  $10,000 on {growth.dates[0]} — the chart can only go back as far as the shortest price
                  history among your holdings and the selected benchmarks (up to 5 years).
                  {benchSel.includes(SECTOR_MIX) ? ' Sector mix holds each stock’s sector ETF at the same weight.' : ''}
                </p>
              </>
            ) : <p className="lab-empty">Loading benchmark history…</p>}
          </Reveal>
        )}

        <Reveal as="p" className="lab-method-foot">
          CAPM expected return = risk-free rate + beta × {pct(ERP_ANNUAL, 2)} equity risk premium ({ERP_SOURCE}).
          Scenario expected return = probability-weighted return across your Bull / Base / Bear targets.
          Implied vol prices the risk directly: expected return = risk-free rate + the market&rsquo;s going
          rate of return per unit of volatility (equity risk premium ÷ SPY&rsquo;s implied volatility) ×
          the stock&rsquo;s own option-implied volatility — so it moves with the options market. The range
          shown is the market-implied expected move. Full detail on the Methodology page.
        </Reveal>

      </div>
    </div>
  );
}
