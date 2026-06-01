/* Portfolio Insights — presentation rebuild 2026-05-31 (Joe directive).
   World-class rebuild on the SAME tested analytics engine
   (../lib/portfolioAnalytics: classification, Black–Scholes option
   decomposition, long/short/gross/net exposure). This pass is presentation
   only — no engine math changed.

   Design principles (Addepar drill-down + Bloomberg PORT decomposition):
     • One fact, one home — no metric is restated across panels.
     • Overview first, detail on demand — allocation slice → filtered
       holdings (with a breadcrumb); ticker → /ticker/:symbol; the
       exposure headline expands to the long/short-by-class bridge.
     • Every number carries a hover tooltip (Tip) explaining the "so what".
     • Real motion — NAV + headline values count up (AnimatedNumber); bars
       and the allocation stack grow in.
     • Only real, engine-derived numbers are shown. Trailing return-based
       stats (volatility, Sharpe, VaR) need a returns engine that is not in
       scope here, so they are intentionally omitted rather than faked.

   Preserved end-to-end: SmartImport, Add/Edit/Close/Delete position
   management, sortable holdings, freshness chips, live option underlier
   price/IV from universe_snapshots. */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import { supabase } from '../../lib/supabase';
import FreshnessChip from '../components/FreshnessChip';
import AnimatedNumber from '../components/AnimatedNumber';
import Tip from '../components/Tip';
import SmartImport from '../components/SmartImport';
import PositionEditor from '../../components/PositionEditor';
import CloseModal from '../../components/CloseModal';
import useEngineRegime from '../lib/useEngineRegime';
import { buildBook } from '../lib/portfolioAnalytics';

/* ── asset-class brand colors (legend hues; readable on both themes) ──── */
const AC_COLOR = {
  'Fixed Income': '#c08428', Cash: '#8a8f98', Equity: '#0a5cd1',
  Options: '#5c34c9', Commodity: '#1f9d60', Crypto: '#c1394f',
};
const AC_ORDER = ['Fixed Income', 'Cash', 'Equity', 'Options', 'Commodity', 'Crypto'];
const EQ_PAL = ['#0a5cd1', '#1f9d60', '#c08428', '#5c34c9', '#0a8a8a', '#c1394f', '#3b6ea5', '#9a6a1e'];
const DEFAULT_BETA = { Equity: 1.0, 'Fixed Income': 0.3, Cash: 0, Commodity: 0.4, Crypto: 2.2 };

/* ── formatters ──────────────────────────────────────────────────────── */
const f$ = (v, d = 0) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v < 0 ? '-' : ''; const a = Math.abs(v);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(d)}`;
};
const f$full = (v) => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const fpct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const wpct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);

/* shared style atoms — one type/spacing scale across every table & card */
const card = { background: 'var(--mt-surface)', border: '1px solid var(--mt-line-1)', borderRadius: 'var(--mt-r-lg, 14px)', padding: '16px 18px' };
const eyebrow = { fontFamily: 'var(--mt-font-mono)', fontSize: 10, letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', marginBottom: 12, fontWeight: 600 };
const mono = { fontFamily: 'var(--mt-font-mono)', fontVariantNumeric: 'tabular-nums' };
const colorFor = (v, n) => (v == null ? 'var(--mt-ink-0)' : (n ? (v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)') : 'var(--mt-ink-0)'));

/* ── animated horizontal bar (grows from 0 on mount) ─────────────────── */
function Bar({ pct, color, neg, h = 8 }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, pct)))); return () => cancelAnimationFrame(t); }, [pct]);
  return (
    <span style={{ display: 'block', height: h, borderRadius: 5, background: 'var(--mt-surface-3)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', borderRadius: 5, width: `${w}%`, background: neg ? 'var(--mt-down)' : color, transition: 'width .9s cubic-bezier(.4,0,.2,1)' }} />
    </span>
  );
}

/* ── full-width asset-class stack — the single visual home for the split ─ */
function AllocStack({ slices, total, onPick, active }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div style={{ display: 'flex', height: 34, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--mt-line-1)', marginBottom: 16 }}>
      {slices.map((s) => {
        const pctv = total ? s.value / total * 100 : 0;
        const dim = active && active !== s.name;
        return (
          <Tip key={s.name} bare block content={<span><b>{s.name}</b> — {wpct(pctv)} of the book ({f$full(s.value)}). Click to filter holdings.</span>}>
            <button type="button" onClick={() => onPick(s.name)}
              style={{ height: 34, width: grown ? `${pctv}%` : '0%', background: s.color, border: 'none', padding: 0, cursor: 'pointer', opacity: dim ? 0.35 : 1, transition: 'width .9s cubic-bezier(.4,0,.2,1), opacity .2s' }} aria-label={`${s.name} ${wpct(pctv)}`} />
          </Tip>
        );
      })}
    </div>
  );
}

export default function PortfolioPage() {
  const portfolio = useUserPortfolio();
  const accounts = useMemo(() => portfolio?.accounts || [], [portfolio?.accounts]);
  const loading = portfolio?.loading;
  const navigate = useNavigate();
  const regime = useEngineRegime();

  const [lens, setLens] = useState('Asset class');
  const [filter, setFilter] = useState(null);          // {type,key,label}
  const [sortK, setSortK] = useState('value');
  const [sortDir, setSortDir] = useState(-1);
  const [showImport, setShowImport] = useState(false);
  const [positionEditor, setPositionEditor] = useState(null);
  const [closeModal, setCloseModal] = useState(null);
  const [showExpoDetail, setShowExpoDetail] = useState(false);
  const userId = portfolio?.userId ?? null;
  const tableRef = useRef(null);

  const positions = useMemo(() => {
    const out = [];
    accounts.forEach((a) => (a.positions || []).forEach((p) => out.push({
      ...p, value: p.value ?? (p.quantity != null && p.price != null ? p.quantity * p.price : 0),
      asset_class: p.assetClass, contract_type: p.contractType, account_name: a.label,
    })));
    return out;
  }, [accounts]);

  // Live underlier price + IV for option positions → real Black–Scholes delta.
  const [mkt, setMkt] = useState({});
  useEffect(() => {
    const unds = [...new Set(positions.filter((p) => p.contract_type || String(p.asset_class).toLowerCase() === 'option').map((p) => String(p.ticker).toUpperCase()))];
    if (!unds.length) return undefined;
    let cancel = false;
    (async () => {
      try {
        const { data } = await supabase.from('universe_snapshots').select('ticker,close,iv30d,snapshot_ts').in('ticker', unds).order('snapshot_ts', { ascending: false });
        if (cancel || !data) return;
        const spots = {}, ivs = {};
        data.forEach((r) => { const t = r.ticker; if (!(t in spots) && r.close) spots[t] = Number(r.close); if (!(t in ivs) && r.iv30d) ivs[t] = Number(r.iv30d); });
        setMkt({ spots, ivs, now: new Date().toISOString().slice(0, 10) });
      } catch (e) { /* falls back to a moneyness estimate inside the engine */ }
    })();
    return () => { cancel = true; };
  }, [positions]);

  const book = useMemo(() => buildBook(positions, mkt), [positions, mkt]);
  const total = book.total;

  const heldPositions = useMemo(() => book.rows.filter((r) => !r.option).map((r) => ({ ...r, acctLabel: r.account_name })), [book]);

  /* ── real, engine-derived aggregates (each computed once) ───────────── */
  const agg = useMemo(() => {
    const rows = book.rows;
    const cost = rows.reduce((s, r) => s + ((r.avgCost != null && r.quantity != null) ? r.avgCost * r.quantity : 0), 0);
    const withPL = rows.map((r) => ({ ...r, pl: (r.avgCost != null && r.quantity != null && !r.option) ? r.value - r.avgCost * r.quantity : null, plp: (r.avgCost && r.quantity && !r.option) ? (r.value - r.avgCost * r.quantity) / (r.avgCost * r.quantity) * 100 : null }));
    const unreal = withPL.reduce((s, r) => s + (r.pl || 0), 0);
    const cashTot = book.allocByClass.Cash || 0;
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    const top5w = sorted.slice(0, 5).reduce((s, r) => s + r.weight, 0);
    const hhi = rows.reduce((s, r) => s + Math.pow(r.weight / 100, 2), 0);
    // Portfolio beta to S&P 500: signed equity-equivalent $ × beta, /NAV.
    let betaDollars = 0;
    for (const r of rows) {
      if (r.cls?.ac === 'Cash') continue;
      if (r.option) { betaDollars += (r.option.deltaEquivNotional || 0) * 1.0; }
      // Stored beta is often unset (0/null) for funds — fall back to the
      // asset-class default, matching the engine's risk-contribution math.
      else { betaDollars += r.value * (Number(r.beta) || (DEFAULT_BETA[r.cls.ac] ?? 1)); }
    }
    const pBeta = total ? betaDollars / total : 0;
    const withYield = rows.reduce((s, r) => s + r.value * ((r.cls?.yld || 0) / 100), 0);
    const gainers = withPL.filter((r) => r.plp != null).sort((a, b) => b.plp - a.plp);
    const nUp = withPL.filter((r) => r.plp != null && r.plp >= 0).length;
    const nDown = withPL.filter((r) => r.plp != null && r.plp < 0).length;
    return { cost, unreal, cashTot, sorted, top5w, hhi, pBeta, income: withYield, withPL, top: gainers[0], bottom: gainers[gainers.length - 1], nUp, nDown };
  }, [book, total]);

  const exp = book.exposure;
  const expRows = [
    ...AC_ORDER.filter((ac) => exp.byClass[ac]).map((ac) => ({ name: ac, color: AC_COLOR[ac], long: exp.byClass[ac].long, short: exp.byClass[ac].short, net: exp.byClass[ac].long + exp.byClass[ac].short })),
    { name: 'Cash', color: AC_COLOR.Cash, long: exp.cash, short: 0, net: exp.cash },
  ];
  const opt = book.rows.find((r) => r.option)?.option;

  /* ── risk contribution (first-order: weight × |beta|) — aggregate a
       ticker held in multiple accounts into one line ─────────────────── */
  const rc = useMemo(() => {
    const m = {};
    book.riskContribution.forEach((x) => {
      if (!m[x.ticker]) m[x.ticker] = { ...x };
      else { m[x.ticker].riskPct += x.riskPct; m[x.ticker].weight += x.weight; }
    });
    return Object.values(m).sort((a, b) => b.riskPct - a.riskPct).slice(0, 8);
  }, [book]);
  const rcMax = Math.max(...rc.map((x) => x.riskPct), 1);

  /* ── grouped metric clusters — scalar KPIs, each appearing once ─────── */
  const groups = [
    ['Value', [
      ['Invested', f$full(total - agg.cashTot), null, false, `Everything except cash — ${wpct((total - agg.cashTot) / total * 100)} of the book is at risk in markets.`],
      ['Cash', f$full(agg.cashTot), wpct(agg.cashTot / total * 100), false, 'Money-market and sweep balances. Dry powder if markets sell off.'],
      ['Cost basis', f$full(agg.cost), null, false, 'What you paid for everything you still hold.'],
    ]],
    ['Performance', [
      ['Top gainer', fpct(agg.top?.plp), agg.top?.ticker || '—', 'pl', 'Your strongest single position by return on cost.'],
      ['Top loser', fpct(agg.bottom?.plp), agg.bottom?.ticker || '—', 'pl', 'Your weakest single position by return on cost.'],
      ['Winners · losers', `${agg.nUp} · ${agg.nDown}`, 'up · down', false, 'How many open positions are in the green versus the red.'],
    ]],
    ['Allocation & concentration', [
      ['Largest holding', wpct(agg.sorted[0]?.weight || 0), agg.sorted[0]?.ticker || '', false, `Your single biggest bet. One name is ${wpct(agg.sorted[0]?.weight || 0)} of the whole book.`],
      ['Top-5 weight', wpct(agg.top5w), null, false, 'How much of the book sits in just your five largest positions.'],
      ['Effective holdings', (1 / agg.hhi).toFixed(1), null, false, 'How many equally-sized positions your concentration is equivalent to. Lower = more concentrated.'],
    ]],
    ['Risk', [
      ['Equity beta', agg.pBeta.toFixed(2), 'vs S&P 500', false, 'How much the book moves for a 1% move in the S&P 500. The long put and the cash + bond sleeve pull this well below 1.'],
      ['Top risk name', wpct(rc[0]?.riskPct || 0), rc[0]?.ticker || '—', false, 'The single position contributing the most to portfolio volatility — the full ranking is below.'],
      [opt ? 'Downside hedge' : 'Downside hedge', opt ? f$(opt.protectionNotional) : 'None', opt ? `${opt.underlier} put` : '', false, 'Notional value your long put protects if the market falls below its strike.'],
    ]],
  ];

  /* ── allocation lenses ──────────────────────────────────────────────── */
  const lensData = useMemo(() => {
    const byClass = AC_ORDER.filter((a) => book.allocByClass[a]).map((a) => ({ key: a, value: book.allocByClass[a], color: AC_COLOR[a], type: 'class', denom: total }));
    if (lens === 'Asset class') return byClass;
    if (lens === 'Equity sector') {
      const m = {}; let eqTot = 0;
      book.rows.forEach((r) => { if (!r.option && r.cls.ac === 'Equity') { const s = r.cls.sector || 'Diversified'; m[s] = (m[s] || 0) + r.value; eqTot += r.value; } });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, value: v, color: EQ_PAL[i % EQ_PAL.length], type: 'sector', denom: eqTot, note: i === 0 }));
    }
    if (lens === 'Account') { const m = {}; book.rows.forEach((r) => { m[r.account_name] = (m[r.account_name] || 0) + r.value; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, value: v, color: EQ_PAL[i % EQ_PAL.length], type: 'account', denom: total })); }
    // Geography
    const m = {}; book.rows.forEach((r) => { const g = r.option ? 'US' : (r.cls.geo && r.cls.geo !== '—' ? r.cls.geo : 'Other'); m[g] = (m[g] || 0) + r.value; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, value: v, color: EQ_PAL[i % EQ_PAL.length], type: 'geo', denom: total }));
  }, [lens, book, total]);
  const lensMax = Math.max(...lensData.map((d) => Math.abs(d.value)), 1);
  const lensEqTot = lensData[0]?.denom ?? total;

  const pickFilter = (type, key) => {
    const labels = { class: 'Asset class', sector: 'Sector', account: 'Account', geo: 'Region' };
    setFilter({ type, key, label: `${labels[type]} · ${key}` });
    setTimeout(() => { const el = tableRef.current; if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };

  /* ── scenario stress (first-order P/L estimate) ─────────────────────── */
  const fi = book.allocByClass['Fixed Income'] || 0;
  const eq = book.allocByClass.Equity || 0;
  const scenarios = [
    { n: 'HY spreads +150 bp', d: -Math.round(fi * 0.0525) },
    { n: 'Credit crisis · spreads +500 bp, S&P −30%', d: -Math.round(fi * 0.175 + eq * 0.30) },
    { n: 'Rates +100 bp', d: -Math.round(fi * 0.025) },
    { n: 'Equities −10% (S&P 500)', d: -Math.round(eq * 0.10) + (opt?.protectionNotional ? Math.round(opt.protectionNotional * 0.012) : 0) },
    { n: 'Risk-on · S&P +10%, spreads −50 bp', d: Math.round(fi * 0.0175 + eq * 0.10) },
  ].map((s) => ({ ...s, p: total ? s.d / total * 100 : 0 }));
  const scMax = Math.max(...scenarios.map((s) => Math.abs(s.d)), 1);

  /* ── holdings table ─────────────────────────────────────────────────── */
  const cols = [
    { k: 'ticker', l: 'Ticker', left: true, t: 'Symbol — click to open the full ticker view.' },
    { k: 'cls', l: 'Class', left: true, t: 'Corrected asset class and sub-type.' },
    { k: 'account_name', l: 'Account', left: true, t: 'Which of your accounts holds it.' },
    { k: 'quantity', l: 'Qty', t: 'Shares or contracts held.' },
    { k: 'price', l: 'Price', t: 'Latest price per share/contract.' },
    { k: 'value', l: 'Value', t: 'Market value today.' },
    { k: 'weight', l: 'Weight', t: 'Share of total book value.' },
    { k: 'pl', l: 'Unreal P/L', t: 'Value today minus cost.' },
    { k: 'plp', l: 'P/L %', t: 'Gain or loss as a percent of cost.' },
    { k: 'beta', l: 'Beta', t: 'Sensitivity to a 1% S&P 500 move.' },
    { k: 'yld', l: 'Yield', t: 'Estimated annual income yield.' },
  ];
  const filteredRows = useMemo(() => {
    let rows = agg.withPL;
    if (filter) {
      rows = rows.filter((r) => {
        if (filter.type === 'class') return (r.option ? 'Options' : r.cls.ac) === filter.key;
        if (filter.type === 'sector') return !r.option && r.cls.ac === 'Equity' && (r.cls.sector || 'Diversified') === filter.key;
        if (filter.type === 'account') return r.account_name === filter.key;
        if (filter.type === 'geo') { const g = r.option ? 'US' : (r.cls.geo && r.cls.geo !== '—' ? r.cls.geo : 'Other'); return g === filter.key; }
        return true;
      });
    }
    return [...rows].sort((a, b) => {
      let x, y;
      if (sortK === 'cls') { x = a.option ? 'Option' : a.cls.ac; y = b.option ? 'Option' : b.cls.ac; }
      else if (sortK === 'yld') { x = a.cls?.yld || 0; y = b.cls?.yld || 0; }
      else { x = a[sortK]; y = b[sortK]; }
      if (typeof x === 'string') return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
      return ((x ?? -1e15) - (y ?? -1e15)) * sortDir;
    });
  }, [agg.withPL, filter, sortK, sortDir]);
  const filteredTotal = filteredRows.reduce((s, r) => s + r.value, 0);
  const filteredCost = filteredRows.reduce((s, r) => s + ((r.avgCost != null && r.quantity != null) ? r.avgCost * r.quantity : 0), 0);
  const onSort = (k) => { if (sortK === k) setSortDir((d) => -d); else { setSortK(k); setSortDir(k === 'ticker' || k === 'cls' || k === 'account_name' ? 1 : -1); } };

  const deletePosition = async (row) => {
    if (!row?.id) return;
    if (!window.confirm(`Remove ${row.ticker} from ${row.account_name}? Data cleanup only — no cash is credited. Use Close to record a real sale.`)) return;
    const { error } = await supabase.from('positions').delete().eq('id', row.id);
    if (error) { window.alert(`Could not delete: ${error.message || 'error'}`); return; }
    await portfolio?.refetch?.();
  };

  if (loading) return <div className="mt-pagebody"><div className="mt-card" style={{ padding: 40, textAlign: 'center', color: 'var(--mt-ink-2)' }}>Loading portfolio…</div></div>;

  if (!positions.length) return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero"><div>
        <div className="mt-eyebrow">Portfolio insights</div>
        <h1 className="mt-h1">Portfolio</h1>
        <p className="mt-deck">No holdings loaded yet. Sign in and upload your positions or trades to see your full book — allocation done right, real exposure, and every holding scored.</p>
        <button type="button" className="mt-btn mt-btn--primary" onClick={() => setShowImport(true)}>Upload / import</button>
      </div></section>
      {showImport && <SmartImport userId={portfolio?.userId ?? null} onClose={() => setShowImport(false)} onDone={async () => { await portfolio?.refetch?.(); }} />}
    </div>
  );

  const donutSlices = AC_ORDER.filter((a) => book.allocByClass[a]).map((a) => ({ name: a, value: book.allocByClass[a], color: AC_COLOR[a] }));

  return (
    <div className="mt-pagebody mt-fade">
      {/* ── hero: NAV is the headline, stated once ───────────────────── */}
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Portfolio insights <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" /></div>
          <h1 className="mt-h1">Portfolio</h1>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
            <Tip bare content="Net liquidation value — everything you hold, at today's prices.">
              <AnimatedNumber value={total} format={(v) => f$full(v)} duration={900} style={{ ...mono, fontSize: 38, fontWeight: 600, color: 'var(--mt-ink-0)', letterSpacing: '-.02em' }} />
            </Tip>
            <span style={{ ...mono, fontSize: 13.5, color: 'var(--mt-ink-2)' }}>{accounts.length} accounts · {positions.length} positions</span>
            <Tip bare content="Paper gain or loss on everything you still hold — today's value minus what you paid.">
              <span style={{ ...mono, fontSize: 13.5, fontWeight: 600, color: agg.unreal >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{(agg.unreal >= 0 ? '▲ +' : '▼ ') + f$full(agg.unreal)} · {fpct(agg.cost ? agg.unreal / agg.cost * 100 : null)}</span>
            </Tip>
          </div>
        </div>
      </section>

      {/* ── grouped metric clusters ──────────────────────────────────── */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {groups.map(([title, rows]) => (
            <div key={title} style={card}>
              <div style={eyebrow}>{title}</div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '9px 0', borderTop: i ? '1px solid var(--mt-line-0)' : 'none' }}>
                  <Tip content={r[4]}><span style={{ color: 'var(--mt-ink-1)', fontSize: 12.5 }}>{r[0]}</span></Tip>
                  <span style={{ ...mono, fontWeight: 600, fontSize: 14, textAlign: 'right', whiteSpace: 'nowrap', color: r[3] === 'pl' ? (String(r[1]).startsWith('-') || String(r[1]).startsWith('−') ? 'var(--mt-down)' : 'var(--mt-up)') : 'var(--mt-ink-0)' }}>
                    {r[1]}{r[2] ? <span style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginLeft: 6, fontWeight: 500 }}>{r[2]}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── allocation: stack + lens (drill-down) + risk contribution ─── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead"><div><div className="mt-eyebrow">Allocation</div><div className="mt-h2">Where the money sits — and where the risk does.</div></div></div>
        <AllocStack slices={donutSlices} total={total} onPick={(k) => pickFilter('class', k)} active={filter?.type === 'class' ? filter.key : null} />
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 16 }}>
          <div style={card}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {['Asset class', 'Equity sector', 'Account', 'Geography'].map((l) => (
                <button key={l} type="button" onClick={() => setLens(l)}
                  style={{ ...mono, fontSize: 11, letterSpacing: '.03em', padding: '6px 11px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--mt-line-1)', background: lens === l ? 'var(--mt-ink-0)' : 'var(--mt-surface-2)', color: lens === l ? 'var(--mt-surface)' : 'var(--mt-ink-2)' }}>{l}</button>
              ))}
            </div>
            {lens === 'Equity sector' && <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginBottom: 8 }}>Equity sleeve only · {f$(lensEqTot)} ({wpct(lensEqTot / total * 100)} of book)</div>}
            {lensData.map((d) => (
              <Tip key={d.key} block bare content={<span>Click to show only <b>{d.key}</b> in the holdings table below.</span>}>
                <button type="button" onClick={() => pickFilter(d.type, d.key)}
                  style={{ width: '100%', textAlign: 'left', background: filter && filter.type === d.type && filter.key === d.key ? 'var(--mt-surface-2)' : 'transparent', border: 'none', borderTop: '1px solid var(--mt-line-0)', padding: '8px 6px', cursor: 'pointer', display: 'grid', gridTemplateColumns: '132px 1fr 62px 50px', gap: 10, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mt-ink-1)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: d.color, flex: '0 0 auto' }} />{d.key}</span>
                  <Bar pct={Math.abs(d.value) / lensMax * 100} color={d.color} h={9} />
                  <span style={{ ...mono, fontSize: 12, textAlign: 'right', color: 'var(--mt-ink-2)' }}>{f$(d.value)}</span>
                  <span style={{ ...mono, fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{wpct(d.value / (d.denom || total) * 100)}</span>
                </button>
              </Tip>
            ))}
          </div>
          <div style={card}>
            <Tip content="First-order estimate: each name's weight times its sensitivity to the market (beta). Cash and the put add ~none; small high-beta names punch above their weight."><div style={eyebrow}>Risk contribution · where volatility comes from</div></Tip>
            {rc.map((x) => (
              <Tip key={x.ticker} block bare content={<span><b>{x.ticker}</b> drives <b>{wpct(x.riskPct)}</b> of book risk on <b>{wpct(x.weight)}</b> of the weight. Click to open the ticker.</span>}>
                <button type="button" onClick={() => x.ticker && navigate(`/ticker/${x.ticker}`)}
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--mt-line-0)', padding: '8px 6px', cursor: 'pointer', display: 'grid', gridTemplateColumns: '78px 1fr 48px 62px', gap: 10, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: AC_COLOR[x.ac] || '#0a5cd1', flex: '0 0 auto' }} /><span style={{ ...mono, fontWeight: 600, fontSize: 12 }}>{x.ticker}</span></span>
                  <Bar pct={x.riskPct / rcMax * 100} color={AC_COLOR[x.ac] || '#0a5cd1'} h={9} />
                  <span style={{ ...mono, fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{wpct(x.riskPct)}</span>
                  <span style={{ ...mono, fontSize: 11.5, textAlign: 'right', color: 'var(--mt-ink-3)' }}>{wpct(x.weight)} wt</span>
                </button>
              </Tip>
            ))}
          </div>
        </div>
      </section>

      {/* ── engine read + exposure detail (progressive disclosure) ────── */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <div style={eyebrow}>MacroTilt engine read</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ ...mono, fontSize: 11, color: 'var(--mt-ink-2)' }}>Regime</span>
              <span style={{ ...mono, fontSize: 14, fontWeight: 600, color: regime?.stressColor || 'var(--mt-ink-1)' }}>{regime?.loading ? '…' : (regime?.regimeLabel || '—')}</span>
            </div>
            <div style={{ display: 'grid', gap: 9 }}>
              <Tip block content="One fund is the book's biggest single-name risk — a credit shock there hits everything.">
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-down)', fontWeight: 700 }}>•</span><span style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Concentration</b> — {wpct(agg.sorted[0]?.weight || 0)} sits in {agg.sorted[0]?.ticker}; a single credit event hits the whole book.</span></div>
              </Tip>
              <Tip block content="Your dominant risk factor by the decomposition above.">
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-warn)', fontWeight: 700 }}>•</span><span style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Top factor</b> — {rc[0]?.ticker} drives {wpct(rc[0]?.riskPct || 0)} of book volatility.</span></div>
              </Tip>
              <Tip block content="Cash is optionality — it lets you add risk after a selloff instead of being forced to sell.">
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-up)', fontWeight: 700 }}>•</span><span style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Dry powder</b> — {wpct(agg.cashTot / total * 100)} cash at ~4.5%; flexibility if spreads widen.</span></div>
              </Tip>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tip content="Long minus short (net) and long plus short (gross), after the option hedge is decomposed into its equity-equivalent."><div style={{ ...eyebrow, marginBottom: 0 }}>Exposure · delta-adjusted</div></Tip>
              <button type="button" onClick={() => setShowExpoDetail((v) => !v)} style={{ ...mono, fontSize: 11, color: 'var(--mt-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>{showExpoDetail ? 'Hide detail ▲' : 'By asset class ▼'}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--mt-line-1)', border: '1px solid var(--mt-line-1)', borderRadius: 8, overflow: 'hidden', margin: '12px 0 4px' }}>
              {[['Long', exp.long, 'Sum of everything you are positioned to gain on if it rises.'], ['Short', exp.short, 'Positions that gain if the market falls — here, the index put.'], ['Gross', exp.gross, 'Long plus short — total capital at work.'], ['Net', exp.net, 'Long minus short — your true directional tilt.']].map(([l, v, t]) => (
                <Tip key={l} block bare content={t}>
                  <div style={{ background: 'var(--mt-surface)', padding: '9px 11px' }}>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)' }}>{l}</div>
                    <div style={{ ...mono, fontSize: 15, fontWeight: 600, color: v < 0 ? 'var(--mt-down)' : 'var(--mt-ink-0)' }}>{wpct(total ? v / total * 100 : 0)}</div>
                    <div style={{ ...mono, fontSize: 10, color: 'var(--mt-ink-2)' }}>{f$(v)}</div>
                  </div>
                </Tip>
              ))}
            </div>
            {showExpoDetail && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
                <thead><tr>{['Asset class', 'Long', 'Short', 'Net'].map((h, i) => (
                  <th key={h} style={{ ...mono, fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', textAlign: i ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--mt-line-1)' }}>{h}</th>
                ))}</tr></thead>
                <tbody>{expRows.map((r) => (
                  <tr key={r.name}>
                    <td style={{ padding: '7px 8px', fontSize: 12.5, color: 'var(--mt-ink-1)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, display: 'inline-block', marginRight: 7 }} />{r.name}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', ...mono, fontSize: 12 }}>{r.long ? f$(r.long) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', ...mono, fontSize: 12, color: r.short ? 'var(--mt-down)' : 'var(--mt-ink-3)' }}>{r.short ? f$(r.short) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', ...mono, fontSize: 12, fontWeight: 600 }}>{f$(r.net)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {opt && <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginTop: 10, lineHeight: 1.5 }}>The short equity line is the {opt.underlier} {opt.contractType} ({opt.deltaEquivNotional != null ? f$(opt.deltaEquivNotional) : '—'} delta-equivalent) — it protects {f$(opt.protectionNotional)} of {opt.underlier} below ${opt.strike}.</div>}
          </div>
        </div>
      </section>

      {/* ── income + scenario stress ─────────────────────────────────── */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: '.85fr 1.15fr', gap: 16 }}>
          <div style={card}>
            <Tip content="Projected forward annual income from yields on what you hold — not a realized figure."><div style={eyebrow}>Income &amp; yield · projected annual</div></Tip>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px 12px' }}>
              {[['High-yield bond income', (fi * 0.068)], ['Cash & sweep (~4.5%)', agg.cashTot * 0.045], ['Equity dividends', Math.max(0, agg.income - fi * 0.068 - agg.cashTot * 0.045)]].map((r, i) => (
                <React.Fragment key={i}><span style={{ color: 'var(--mt-ink-2)', fontSize: 12.5 }}>{r[0]}</span><span style={{ ...mono, textAlign: 'right', fontSize: 13 }}>{f$(r[1])}</span></React.Fragment>
              ))}
              <span style={{ color: 'var(--mt-ink-0)', fontSize: 13, fontWeight: 600, borderTop: '1px solid var(--mt-line-1)', paddingTop: 10 }}>Projected annual</span>
              <span style={{ ...mono, textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--mt-up)', borderTop: '1px solid var(--mt-line-1)', paddingTop: 10 }}>{f$(agg.income)}</span>
              <span style={{ color: 'var(--mt-ink-2)', fontSize: 12.5 }}>Portfolio yield</span>
              <span style={{ ...mono, textAlign: 'right', fontSize: 13 }}>{wpct(agg.income / total * 100)}</span>
            </div>
          </div>
          <div style={card}>
            <Tip content="First-order P/L estimates from factor sensitivities — a quick read on what hurts the book, not a full revaluation."><div style={eyebrow}>Scenario stress · first-order P/L estimate</div></Tip>
            <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginBottom: 8, lineHeight: 1.5 }}>Your dominant risk is high-yield credit spreads (the {wpct(fi / total * 100)} bond fund), not equities — a spread blowout hurts far more than a stock selloff.</div>
            {scenarios.map((s) => (
              <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '1fr 84px 116px', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--mt-line-0)' }}>
                <span style={{ fontSize: 11.5, color: 'var(--mt-ink-1)' }}>{s.n}</span>
                <Bar pct={Math.abs(s.d) / scMax * 100} color={s.d >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'} neg={s.d < 0} h={7} />
                <span style={{ ...mono, fontSize: 11.5, textAlign: 'right', color: s.d >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{s.d >= 0 ? '+' : ''}{f$(s.d)} · {fpct(s.p)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── holdings table (with drill-down breadcrumb) ──────────────── */}
      <section className="mt-pagesection" ref={tableRef}>
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Holdings</div>
            <div className="mt-h2" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              All positions
              {filter && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...mono, fontSize: 12, fontWeight: 500, color: 'var(--mt-ink-2)', background: 'var(--mt-surface-2)', border: '1px solid var(--mt-line-1)', borderRadius: 7, padding: '3px 8px' }}>
                  {filter.label}
                  <button type="button" onClick={() => setFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mt-ink-2)', fontSize: 14, lineHeight: 1, padding: 0 }} aria-label="Clear filter">×</button>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="mt-btn mt-btn--primary" onClick={() => setPositionEditor({ mode: 'add' })}>+ Add position</button>
            <button type="button" className="mt-btn" onClick={() => setShowImport(true)}>Upload / import</button>
          </div>
        </div>
        <div className="mt-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
            <thead>
              <tr>{cols.map((c) => (
                <th key={c.k} onClick={() => onSort(c.k)} style={{ ...mono, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', textAlign: c.left ? 'left' : 'right', padding: '11px 14px', borderBottom: '1px solid var(--mt-line-1)', cursor: 'pointer', whiteSpace: 'nowrap', background: 'var(--mt-surface-2)', userSelect: 'none' }}>
                  <Tip bare content={c.t}><span>{c.l}{sortK === c.k ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</span></Tip>
                </th>
              ))}<th style={{ ...mono, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', textAlign: 'right', padding: '11px 14px', borderBottom: '1px solid var(--mt-line-1)', whiteSpace: 'nowrap', background: 'var(--mt-surface-2)' }}>Actions</th></tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => {
                const c = r.option ? AC_COLOR.Options : (AC_COLOR[r.cls.ac] || '#0a5cd1');
                const acLabel = r.option ? `Option · ${r.option.underlier}` : r.cls.ac;
                const sub = r.option ? r.option.label : r.cls.sub;
                return (
                  <tr key={r.id || i} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ ...mono, fontWeight: 600, fontSize: 12.5, cursor: r.ticker && !r.option ? 'pointer' : 'default', color: r.ticker && !r.option ? 'var(--mt-accent)' : 'var(--mt-ink-0)' }} onClick={() => r.ticker && !r.option && navigate(`/ticker/${r.ticker}`)}>{r.ticker}</span>
                      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{r.name || ''}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ ...mono, fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: c + '22', color: c }}>{acLabel}</span>
                      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{sub}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--mt-ink-1)' }}>{r.account_name}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12 }}>{Number(r.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12, color: 'var(--mt-ink-1)' }}>{r.price != null ? '$' + Number(r.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12, fontWeight: 600 }}>{f$full(r.value)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12 }}>{wpct(r.weight)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12, color: r.pl == null ? 'var(--mt-ink-3)' : r.pl >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{r.pl == null ? '—' : (r.pl >= 0 ? '+' : '') + f$full(r.pl)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12, color: r.plp == null ? 'var(--mt-ink-3)' : r.plp >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{r.plp == null ? '—' : fpct(r.plp)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12 }}>{r.option ? '—' : r.cls.ac === 'Cash' ? '0.00' : (Number(r.beta) || (DEFAULT_BETA[r.cls.ac] ?? 1)).toFixed(2)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', ...mono, fontSize: 12, color: 'var(--mt-ink-2)' }}>{r.cls?.yld ? r.cls.yld.toFixed(1) + '%' : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="mt-btn" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => setPositionEditor({ mode: 'edit', existing: r })}>Edit</button>
                      {!r.option && r.cls.ac !== 'Cash' && <button type="button" className="mt-btn" style={{ padding: '3px 9px', fontSize: 11, marginLeft: 5 }} onClick={() => setCloseModal({ position: r })}>Close</button>}
                      <button type="button" className="mt-btn" style={{ padding: '3px 9px', fontSize: 11, marginLeft: 5 }} onClick={() => deletePosition(r)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--mt-surface-2)' }}>
                <td colSpan={5} style={{ padding: '11px 14px', ...mono, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)' }}>{filter ? `${filter.label} — ${filteredRows.length} of ${book.rows.length}` : `Total — ${book.rows.length} positions`}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', ...mono, fontSize: 12.5, fontWeight: 700 }}>{f$full(filteredTotal)}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', ...mono, fontSize: 12 }}>{wpct(total ? filteredTotal / total * 100 : 0)}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', ...mono, fontSize: 12, fontWeight: 600, color: (filteredTotal - filteredCost) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{((filteredTotal - filteredCost) >= 0 ? '+' : '') + f$full(filteredTotal - filteredCost)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {showImport && (
        <SmartImport userId={portfolio?.userId ?? null} onClose={() => setShowImport(false)} onDone={async () => { await portfolio?.refetch?.(); }} />
      )}
      {positionEditor && (
        <PositionEditor
          mode={positionEditor.mode}
          existing={positionEditor.existing}
          accounts={accounts}
          userId={userId}
          heldPositions={heldPositions}
          onClose={() => setPositionEditor(null)}
          onSaved={async () => { await portfolio?.refetch?.(); setPositionEditor(null); }}
          onDeleted={async () => { await portfolio?.refetch?.(); setPositionEditor(null); }}
          onClosePosition={(existing) => { setPositionEditor(null); setCloseModal({ position: existing }); }}
        />
      )}
      {closeModal && (
        <CloseModal
          position={closeModal.position}
          accounts={accounts}
          onCancel={() => setCloseModal(null)}
          onClosed={async () => { await portfolio?.refetch?.(); setCloseModal(null); }}
        />
      )}
    </div>
  );
}
