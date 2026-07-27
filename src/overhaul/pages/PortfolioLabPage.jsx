/* Portfolio Lab — /portfolio-lab (signed-in only).

   Build spec: PORTFOLIO_LAB_BUILD_SPEC.md (project folder, 2026-07-27).
   One workspace: holdings table (add/remove any US ticker, weight, per-row
   ER method), efficient frontier (click a point to load its weights),
   core statistics vs a benchmark, growth-of-$10K comparison, and saved
   portfolios per user (portfolio_lab_portfolios, RLS owner-only).

   ER methods live (Phase 1–2): CAPM and Weighted Scenarios. The
   options-implied method is Phase 3, pending an options data source
   (Joe decision 2026-07-27) — deliberately NOT rendered as a dead option.

   Math: src/overhaul/lib/labMath.js — every formula paper-checked in
   labMath.test.mjs (LESSONS 3.4). Prices: api/price-history (Yahoo,
   adjusted, 5y) via useLabPrices — ONE price basis for every series on
   the page (LESSONS 2026-06-12b). Risk-free: ust_2y / ust_10y from the
   public indicator history (registered, chipped feeds). */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';
import useLabPrices, { useRiskFree, riskFreeForHorizon } from '../lib/useLabPrices';
import {
  HORIZONS, alignSeries, dailyReturns, annualVol, betaVs, covMatrix, corrMatrix,
  capmAnnualER, scenarioHorizonER, horizonFromAnnual, annualFromHorizon,
  portfolioER, portfolioVol, riskContribution, portfolioPath, maxDrawdown,
  efficientFrontier, sicToSectorEtf,
} from '../lib/labMath';
import { ERP_ANNUAL, ERP_SOURCE, MIN_HISTORY_DAYS } from '../lib/labConfig';
import '../styles/cream-system.css';
import '../styles/lab-v12.css';

const BENCHMARKS = ['SPY', 'QQQ', 'IWM', 'DIA'];
const SECTOR_MIX = 'Sector mix';
const METHODS = { capm: 'CAPM', scen: 'Scenarios' };

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
      const { data } = await supabase
        .from('ticker_reference')
        .select('ticker,name')
        .or(`ticker.ilike.${term}%,name.ilike.%${term}%`)
        .order('market_cap', { ascending: false, nullsFirst: false })
        .limit(7);
      if (id !== reqId.current) return;
      setRes(data || []);
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

/* Nice round axis ticks: step ∈ {1,2,2.5,5,10}×10^k covering [min,max]. */
function niceTicks(min, max, count = 4) {
  const range = max - min;
  if (!(range > 0)) return [min];
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}

/* Efficient-frontier chart (SVG). Click loads the nearest point's weights. */
function FrontierChart({ frontier, current, benches, rf, onPick }) {
  const W = 640; const H = 340; const P = { l: 54, r: 16, t: 14, b: 36 };
  const [hover, setHover] = useState(null);
  if (!frontier || frontier.points.length < 2) return null;
  const pts = frontier.points;
  const xs = pts.map((p) => p.vol).concat(current ? [current.vol] : [], benches.map((b) => b.vol));
  const ys = pts.map((p) => p.ret).concat(current ? [current.ret] : [], benches.map((b) => b.ret));
  /* Pad around the DATA on both axes (never anchor at 0): with a high-vol
     holding in the book a 0-anchored scale crushed every point into the top
     corner, above the last gridline (Joe, 7/27). */
  const xlo = Math.min(...xs); const xhi = Math.max(...xs);
  const ylo = Math.min(...ys); const yhi = Math.max(...ys);
  const xpad = (xhi - xlo) * 0.18 || xhi * 0.15 || 0.02;
  const ypad = (yhi - ylo) * 0.22 || Math.abs(yhi) * 0.15 || 0.02;
  const xmin = Math.max(0, xlo - xpad);
  const xmax = xhi + xpad;
  const ymin = ylo - ypad;
  const ymax = yhi + ypad;
  const X = (v) => P.l + ((v - xmin) / (xmax - xmin)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - ((v - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.vol).toFixed(1)},${Y(p.ret).toFixed(1)}`).join(' ');
  const xticks = niceTicks(xmin, xmax, 4);
  const yticks = niceTicks(ymin, ymax, 4);
  const nearest = (mx, my) => {
    let best = null; let bd = Infinity;
    for (const p of pts) {
      const d = (X(p.vol) - mx) ** 2 + (Y(p.ret) - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const handleMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - box.left) / box.width) * W;
    const my = ((e.clientY - box.top) / box.height) * H;
    setHover(nearest(mx, my));
  };
  /* Fixed distinct label offsets so the three preset labels and the
     portfolio label never stack on one another when the points cluster. */
  const marks = [
    { p: frontier.minVol, label: 'Min volatility', dx: 8, dy: 18, anchor: 'start' },
    { p: frontier.maxSharpe, label: 'Max Sharpe', dx: 8, dy: -8, anchor: 'start' },
    { p: frontier.equalWeight, label: 'Equal weight', dx: -10, dy: 18, anchor: 'end' },
  ];
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
            <text x={P.l - 8} y={Y(v) + 4} className="lab-tick" textAnchor="end">{pct(v, 0)}</text>
          </g>
        ))}
        {xticks.map((v, i) => (
          <text key={`x${i}`} x={X(v)} y={H - P.b + 22} className="lab-tick" textAnchor="middle">{pct(v, 0)}</text>
        ))}
        <text x={(P.l + W - P.r) / 2} y={H - 4} className="lab-axis" textAnchor="middle">Volatility (annual)</text>
        <path d={path} className="lab-curve" fill="none" />
        {benches.map((b) => (
          <g key={b.ticker}>
            <circle cx={X(b.vol)} cy={Y(b.ret)} r="4" className="lab-benchdot" />
            <text x={X(b.vol) - 7} y={Y(b.ret) + 4} className="lab-dotlabel" textAnchor="end">{b.ticker}</text>
          </g>
        ))}
        {marks.map((m) => (
          <g key={m.label}>
            <circle cx={X(m.p.vol)} cy={Y(m.p.ret)} r="4.5" className="lab-markdot" />
            <text
              x={Math.min(Math.max(X(m.p.vol) + m.dx, P.l + 4), W - P.r - 4)}
              y={Math.min(Math.max(Y(m.p.ret) + m.dy, P.t + 12), H - P.b - 6)}
              className="lab-dotlabel" textAnchor={m.anchor}
            >{m.label}</text>
          </g>
        ))}
        {current && (
          <g>
            <circle cx={X(current.vol)} cy={Y(current.ret)} r="6" className="lab-youdot" />
            <text
              x={Math.min(Math.max(X(current.vol) + 2, P.l + 40), W - P.r - 40)}
              y={Math.max(Y(current.ret) - 11, P.t + 12)}
              className="lab-dotlabel you" textAnchor="middle"
            >Your portfolio</text>
          </g>
        )}
        {hover && <circle cx={X(hover.vol)} cy={Y(hover.ret)} r="5" className="lab-hoverdot" />}
      </svg>
      <div className="lab-frontier-read">
        {hover
          ? <>At {pct(hover.vol)} volatility the frontier expects {signPct(hover.ret)} a year — click to load these weights.</>
          : <>Click any point on the curve to load its weights into the table. Sharpe uses a {pct(rf, 2)} risk-free rate.</>}
      </div>
    </div>
  );
}

/* Growth-of-$10K comparison chart (SVG multi-line). */
function GrowthChart({ dates, lines }) {
  const W = 940; const H = 300; const P = { l: 58, r: 12, t: 12, b: 30 };
  if (!dates.length || !lines.length) return null;
  const all = lines.flatMap((l) => l.nav);
  const ymin = Math.min(...all) * 0.98;
  const ymax = Math.max(...all) * 1.02;
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
      {niceTicks(ymin * 10000, ymax * 10000, 4).map((d, k) => (
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

  const [holdings, setHoldings] = useState([]); // {ticker, weight(%), method, scenarios}
  const [horizon, setHorizon] = useState('1y');
  const [benchSel, setBenchSel] = useState(['SPY']);
  const [openScen, setOpenScen] = useState(null); // ticker with scenario drawer open
  const [growthWin, setGrowthWin] = useState('max'); // growth-chart lookback
  const [saved, setSaved] = useState([]);
  const [activeName, setActiveName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
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
  const rfCurve = useRiskFree();
  const rfH = riskFreeForHorizon(rfCurve, horizon);   // for Sharpe/CAPM (annual rate)

  /* ── analysis pipeline ────────────────────────────────────────────── */
  const analysis = useMemo(() => {
    const have = held.filter((t) => series[t]?.length);
    if (!have.length || !series.SPY?.length) return null;
    const { dates, closes } = alignSeries(
      Object.fromEntries([...have, 'SPY'].map((t) => [t, series[t]])),
    );
    if (dates.length < 30) return null;
    const rets = {};
    for (const t of [...have, 'SPY']) rets[t] = dailyReturns(closes[t]);
    const enough = have.filter(() => dates.length >= MIN_HISTORY_DAYS);
    const perStock = {};
    for (const t of have) {
      const beta = betaVs(rets[t], rets.SPY);
      const vol = annualVol(rets[t]);
      const h = holdings.find((x) => x.ticker === t);
      let erAnnual = null;
      let erH = null;
      let range = null;
      if (h.method === 'scen') {
        erH = scenarioHorizonER(h.scenarios, lastPrice[t]);
        erAnnual = annualFromHorizon(erH, years);
        if (erH != null && lastPrice[t] > 0) {
          range = [h.scenarios.bear.price / lastPrice[t] - 1, h.scenarios.bull.price / lastPrice[t] - 1];
        }
      } else {
        erAnnual = enough.includes(t) ? capmAnnualER(beta, rfH, ERP_ANNUAL) : null;
        erH = horizonFromAnnual(erAnnual, years);
        if (erH != null) {
          const volH = vol * Math.sqrt(years);
          range = [erH - volH, erH + volH];
        }
      }
      perStock[t] = { beta: enough.includes(t) ? beta : null, vol, erAnnual, erH, range, thin: !enough.includes(t) };
    }
    const valid = have.filter((t) => perStock[t].erAnnual != null && !perStock[t].thin);
    const S = covMatrix(rets, valid);
    const C = corrMatrix(rets, have);
    return { dates, closes, rets, perStock, valid, have, S, C };
  }, [held.join(','), JSON.stringify(holdings), series, lastPrice, rfH, years]); // eslint-disable-line react-hooks/exhaustive-deps

  const weightsSum = holdings.reduce((s, h) => s + (Number(h.weight) || 0), 0);

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

  /* ── saved portfolios ─────────────────────────────────────────────── */
  const refreshSaved = () => {
    if (!user) return;
    supabase.from('portfolio_lab_portfolios').select('id,name,holdings,horizon,benchmark,updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setSaved(data || []));
  };
  useEffect(refreshSaved, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePortfolio() {
    const name = (saveName || activeName || '').trim();
    if (!user || !name) { setSaveMsg('Name it first'); return; }
    const row = {
      user_id: user.id, name, holdings, horizon,
      benchmark: benchSel.join(','), updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('portfolio_lab_portfolios')
      .upsert(row, { onConflict: 'user_id,name' });
    setSaveMsg(error ? `Save failed: ${error.message}` : 'Saved');
    if (!error) { setActiveName(name); setSaveName(''); refreshSaved(); }
    setTimeout(() => setSaveMsg(''), 2500);
  }

  function loadPortfolio(row) {
    setHoldings(Array.isArray(row.holdings) ? row.holdings : []);
    setHorizon(row.horizon && HORIZONS[row.horizon] ? row.horizon : '1y');
    setBenchSel(String(row.benchmark || 'SPY').split(',').filter(Boolean));
    setActiveName(row.name);
  }

  async function deletePortfolio(row) {
    await supabase.from('portfolio_lab_portfolios').delete().eq('id', row.id);
    if (activeName === row.name) setActiveName('');
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
    <div className="home-v12 lab-v12">
      <div className="wrap">

        <Reveal as="section" className="lab-head">
          <div className="eyebrow2"><span className="dot" />Portfolio Lab</div>
          <h1 className="serif">Expected return &amp; portfolio construction</h1>
          <p className="lab-sub">
            Add stocks, choose how each one&rsquo;s expected return is estimated, then optimize the mix
            and compare it against benchmarks. Prices through {asOf || '—'} · adjusted daily closes,
            fetched live · Risk-free {pct(rfH, 2)} ({horizon === '3y' ? '2y–10y Treasury blend' : '2-year Treasury'}
            {rfCurve.asOf ? `, ${rfCurve.asOf}` : ''}).
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
                    <button type="button" onClick={() => loadPortfolio(r)}>{r.name}</button>
                    <button type="button" className="x" aria-label={`Delete ${r.name}`} onClick={() => deletePortfolio(r)}>×</button>
                  </span>
                ))}
              </div>
              <div className="lab-saverow">
                <input
                  value={saveName}
                  placeholder={activeName ? `Save as “${activeName}”` : 'Portfolio name'}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button type="button" className="lab-btn" onClick={savePortfolio}>Save</button>
                {saveMsg && <span className="lab-dim">{saveMsg}</span>}
              </div>
            </div>
          </div>
        </Reveal>

        {/* ── holdings table ── */}
        <Reveal as="section" className="lab-card">
          <div className="lab-cardhead">
            <h2 className="serif">Holdings</h2>
            <TickerAdd onAdd={addTicker} existing={held} />
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
                          <tr className={failed[h.ticker] ? 'dim' : ''}>
                            <td className="tick">{h.ticker}</td>
                            <td className="num">{money(lastPrice[h.ticker])}</td>
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
                              {ps?.thin && h.method === 'capm'
                                ? <span className="lab-dim">— insufficient history</span>
                                : signPct(ps?.erH)}
                            </td>
                            <td className="num">{ps?.range ? `${signPct(ps.range[0], 0)} to ${signPct(ps.range[1], 0)}` : '—'}</td>
                            <td className="num">
                              <button type="button" className="lab-x" aria-label={`Remove ${h.ticker}`} onClick={() => removeTicker(h.ticker)}>×</button>
                            </td>
                          </tr>
                          {scenOpen && h.scenarios && (
                            <tr className="lab-scenrow">
                              <td colSpan={7}>
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
              <span className="lab-dim">Expected return uses each holding&rsquo;s selected method · risk from 5 years of daily prices</span>
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
              <span className="lab-dim">vs {selBench?.ticker || 'SPY'} · history over the last 5 years</span>
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
                ['Beta vs SPY', portfolio.beta == null ? '—' : portfolio.beta.toFixed(2),
                  selBench?.beta == null ? '—' : selBench.beta.toFixed(2)],
                ['Max drawdown (5y)', pct(portfolio.mdd), (() => {
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
                    <span className="tick">{t}</span>
                    <span className="lab-rcbar"><i style={{ width: `${Math.max(portfolio.rc[i] * 100, 0)}%` }} /></span>
                    <span className="num">{pct(portfolio.rc[i], 0)}</span>
                  </div>
                ))}
              </div>
              {analysis && analysis.have.length >= 2 && (
                <div className="lab-sub-col">
                  <h3 className="label">Correlation of daily returns</h3>
                  <div className="lab-corr" style={{ gridTemplateColumns: `52px repeat(${analysis.have.length}, 1fr)` }}>
                    <span />
                    {analysis.have.map((t) => <span key={`h${t}`} className="lab-corrhead">{t}</span>)}
                    {analysis.have.map((t, i) => (
                      <React.Fragment key={`r${t}`}>
                        <span className="lab-corrhead">{t}</span>
                        {analysis.have.map((u, j) => {
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
          Full detail on the Methodology page.
        </Reveal>

      </div>
    </div>
  );
}
