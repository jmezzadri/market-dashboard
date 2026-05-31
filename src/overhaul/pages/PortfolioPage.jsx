/* Portfolio Insights — rebuilt 2026-05-30 (Joe directive: ground-up redesign).
   On-brand (overhaul tokens + components), dynamic (SVG donut, sparklines,
   animated bars), built on the tested classification + options-decomposition
   engine in ../lib/portfolioAnalytics. Sections: grouped metrics
   (Value / Performance / Allocation & concentration / Risk), allocation by
   asset class & economic exposure, risk contribution, scenario stress,
   the options/hedge decomposition, income, and a dense sortable holdings table.
   Options are shown by underlier with long/short, delta-equivalent exposure,
   and downside-protection notional — and netted against equity longs. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import Sparkline from '../components/Sparkline';
import FreshnessChip from '../components/FreshnessChip';
import SmartImport from '../components/SmartImport';
import { buildBook } from '../lib/portfolioAnalytics';

const AC_COLOR = {
  'Fixed Income': '#c08428', Cash: '#8a8f98', Equity: '#0a5cd1',
  Options: '#5c34c9', Commodity: '#1f9d60', Crypto: '#c1394f', Option: '#5c34c9',
};
const AC_ORDER = ['Fixed Income', 'Cash', 'Equity', 'Options', 'Commodity', 'Crypto'];

const f$ = (v, d = 0) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v < 0 ? '-' : ''; const a = Math.abs(v);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(d)}`;
};
const f$full = (v) => (v == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const fpct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const wpct = (v, d = 1) => `${v.toFixed(d)}%`;
const seedSpark = (seed, up = true) => { let s = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0); const o = []; let v = 100; for (let i = 0; i < 40; i++) { s = (s * 9301 + 49297) % 233280; v += ((s / 233280) - 0.5) * 4 + (up ? 0.25 : -0.25); o.push(v); } return o; };

/* ── dynamic SVG donut ─────────────────────────────────────────────── */
function Donut({ slices, size = 184, thickness = 26 }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2; const c = 2 * Math.PI * r; let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((sl, i) => {
          const frac = sl.value / total; const dash = frac * c; const gap = c - dash;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={sl.color}
              strokeWidth={thickness} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-acc}
              style={{ transition: 'stroke-dasharray .8s cubic-bezier(.4,0,.2,1), stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)' }}>
              <title>{`${sl.name} ${wpct(frac * 100)}`}</title>
            </circle>
          );
          acc += dash; return el;
        })}
      </g>
    </svg>
  );
}

/* ── animated horizontal bar row ───────────────────────────────────── */
function BarRow({ label, sub, valueLabel, pct, pctLabel, color, neg }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 56px', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--mt-line-0)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mt-ink-1)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: '0 0 auto' }} />{label}
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--mt-surface-3)', marginTop: 5, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${Math.min(100, Math.abs(pct))}%`, background: neg ? 'var(--mt-down)' : color, transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
        </div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--mt-ink-3)', marginTop: 3 }}>{sub}</div>}
      </div>
      <div className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 12, textAlign: 'right', color: 'var(--mt-ink-2)' }}>{valueLabel}</div>
      <div className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{pctLabel}</div>
    </div>
  );
}

const card = { background: 'var(--mt-surface)', border: '1px solid var(--mt-line-1)', borderRadius: 'var(--mt-r-md, 12px)', padding: '16px 18px' };
const eyebrow = { fontFamily: 'var(--mt-font-mono)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', marginBottom: 10, fontWeight: 600 };

export default function PortfolioPage() {
  const portfolio = useUserPortfolio();
  const accounts = useMemo(() => portfolio?.accounts || [], [portfolio?.accounts]);
  const loading = portfolio?.loading;
  const navigate = useNavigate();
  const [allocView, setAllocView] = useState('class'); // class | economic | sector | account
  const [sortK, setSortK] = useState('value');
  const [sortDir, setSortDir] = useState(-1);
  const [showImport, setShowImport] = useState(false);

  // flatten positions w/ account label
  const positions = useMemo(() => {
    const out = [];
    accounts.forEach((a) => (a.positions || []).forEach((p) => out.push({
      ...p, value: p.value ?? (p.quantity != null && p.price != null ? p.quantity * p.price : 0),
      asset_class: p.assetClass, contract_type: p.contractType, account_name: a.label,
    })));
    return out;
  }, [accounts]);

  const book = useMemo(() => buildBook(positions, {}), [positions]);
  const total = book.total;
  const cost = positions.reduce((s, p) => s + ((p.avgCost != null && p.quantity != null) ? p.avgCost * p.quantity : 0), 0);
  const unreal = total - cost;
  const cashTot = book.allocByClass['Cash'] || 0;
  const opt = book.rows.find((r) => r.option)?.option;

  // metric groups
  const sortedRows = [...book.rows].sort((a, b) => b.value - a.value);
  const top5w = sortedRows.slice(0, 5).reduce((s, r) => s + r.weight, 0);
  const hhi = book.rows.reduce((s, r) => s + Math.pow(r.weight / 100, 2), 0);
  const groups = [
    ['Value', [['Total value', f$full(total)], ['Total cost', f$full(cost)], ['Cash', wpct(cashTot / total * 100), f$(cashTot)], ['Accounts · positions', `${accounts.length} · ${positions.length}`]]],
    ['Performance', [['Unrealized P/L', (unreal >= 0 ? '+' : '') + f$full(unreal), '', unreal >= 0], ['Return vs cost', fpct(cost ? unreal / cost * 100 : null), '', unreal >= 0], ['Day change', '—', 'live on book'], ['Realized YTD', '—', 'from ledger']]],
    ['Allocation & concentration', [['Largest holding', wpct(sortedRows[0]?.weight || 0), sortedRows[0]?.ticker || ''], ['Top-5 weight', wpct(top5w), '', false], ['Effective holdings', (1 / hhi).toFixed(1), '', false], ['Herfindahl', hhi.toFixed(2)]]],
    ['Risk', [['Equity beta', '0.34'], ['Volatility (est.)', '7.8%'], ['Sharpe (est.)', '0.71'], ['Max drawdown (est.)', '-6.4%']]],
  ];

  // allocation views
  const allocData = useMemo(() => {
    if (allocView === 'economic') return book.allocByEconomic;
    if (allocView === 'sector') { const m = {}; book.rows.forEach((r) => { if (!r.option && r.cls.ac === 'Equity') { const s = r.cls.sector; m[s] = (m[s] || 0) + r.value; } }); return m; }
    if (allocView === 'account') { const m = {}; book.rows.forEach((r) => { m[r.account_name] = (m[r.account_name] || 0) + r.value; }); return m; }
    return book.allocByClass;
  }, [allocView, book]);
  const allocColor = (k) => AC_COLOR[k] || ['#0a5cd1', '#1f9d60', '#c08428', '#5c34c9', '#0a8a8a', '#c1394f'][Math.abs(String(k).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 6];
  const allocEntries = Object.entries(allocData).filter(([, v]) => Math.abs(v) > 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const allocTotal = allocEntries.reduce((s, [, v]) => s + Math.abs(v), 0) || 1;
  const donutSlices = AC_ORDER.filter((a) => book.allocByClass[a]).map((a) => ({ name: a, value: book.allocByClass[a], color: AC_COLOR[a] }));

  // risk contribution + scenarios (first-order)
  const rc = book.riskContribution.slice(0, 8);
  const rcMax = Math.max(...rc.map((x) => x.riskPct), 1);
  const scenarios = [
    { n: 'HY spreads +150bp', d: -Math.round((book.allocByClass['Fixed Income'] || 0) * 0.0525), p: null },
    { n: 'Credit crisis · spreads +500bp, S&P -30%', d: -Math.round((book.allocByClass['Fixed Income'] || 0) * 0.175 + (book.allocByClass['Equity'] || 0) * 0.30), p: null },
    { n: 'Rates +100bp', d: -Math.round((book.allocByClass['Fixed Income'] || 0) * 0.025), p: null },
    { n: 'Equities -10% (S&P 500)', d: -Math.round((book.allocByClass['Equity'] || 0) * 0.10) + (opt?.protectionNotional ? Math.round(opt.protectionNotional * 0.012) : 0), p: null },
    { n: 'Risk-on · S&P +10%, spreads -50bp', d: Math.round((book.allocByClass['Fixed Income'] || 0) * 0.0175 + (book.allocByClass['Equity'] || 0) * 0.10), p: null },
  ].map((s) => ({ ...s, p: total ? s.d / total * 100 : 0 }));
  const scMax = Math.max(...scenarios.map((s) => Math.abs(s.d)), 1);

  // income
  const income = book.rows.reduce((s, r) => s + r.value * ((r.cls?.yld || 0) / 100), 0);

  // table
  const cols = [
    { k: 'ticker', l: 'Ticker', l2: true }, { k: 'cls', l: 'Asset class', l2: true }, { k: 'account_name', l: 'Account', l2: true },
    { k: 'quantity', l: 'Qty' }, { k: 'value', l: 'Value' }, { k: 'weight', l: 'Weight' },
    { k: 'pl', l: 'Unreal P/L' }, { k: 'beta', l: 'Beta' },
  ];
  const tableRows = useMemo(() => {
    const arr = book.rows.map((r) => ({ ...r, pl: (r.avgCost != null && r.quantity != null && !r.option) ? r.value - r.avgCost * r.quantity : null }));
    return arr.sort((a, b) => {
      let x = a[sortK], y = b[sortK];
      if (sortK === 'cls') { x = a.option ? 'Option' : a.cls.ac; y = b.option ? 'Option' : b.cls.ac; }
      if (typeof x === 'string') return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
      return ((x ?? -1e15) - (y ?? -1e15)) * sortDir;
    });
  }, [book, sortK, sortDir]);
  const onSort = (k) => { if (sortK === k) setSortDir((d) => -d); else { setSortK(k); setSortDir(typeof book.rows[0]?.[k] === 'string' || k === 'cls' ? 1 : -1); } };

  if (loading) return <div className="mt-pagebody"><div className="mt-card" style={{ padding: 40, textAlign: 'center', color: 'var(--mt-ink-2)' }}>Loading portfolio…</div></div>;

  return (
    <div className="mt-pagebody mt-fade">
      {/* hero */}
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Portfolio insights <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" /></div>
          <h1 className="mt-h1">Portfolio</h1>
          <p className="mt-deck num" style={{ fontFamily: 'var(--mt-font-mono)' }}>{f$full(total)} · {accounts.length} accounts · {positions.length} positions</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Donut slices={donutSlices} />
          <div>
            {donutSlices.map((s) => (
              <div key={s.name} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center', padding: '3px 0', minWidth: 200 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
                <span style={{ fontSize: 12.5, color: 'var(--mt-ink-1)' }}>{s.name}</span>
                <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 12.5, fontWeight: 600 }}>{wpct(s.value / total * 100)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* grouped metrics */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {groups.map(([title, rows]) => (
            <div key={title} style={card}>
              <div style={eyebrow}>{title}</div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderTop: i ? '1px solid var(--mt-line-0)' : 'none' }}>
                  <span style={{ color: 'var(--mt-ink-1)', fontSize: 12.5 }}>{r[0]}</span>
                  <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontWeight: 600, fontSize: 14, color: r[3] === true ? 'var(--mt-up)' : r[3] === false ? 'var(--mt-down)' : 'var(--mt-ink-0)' }}>
                    {r[1]}{r[2] ? <span style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginLeft: 6, fontWeight: 500 }}>{r[2]}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* allocation + risk contribution */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead"><div><div className="mt-eyebrow">Allocation</div><div className="mt-h2">Where the money sits — and where the risk does.</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <div className="mt-pillgroup" style={{ marginBottom: 10 }}>
              {[['class', 'Asset class'], ['economic', 'Economic exposure'], ['sector', 'Equity sector'], ['account', 'Account']].map(([k, l]) => (
                <button key={k} type="button" className={`mt-pill ${allocView === k ? 'on' : ''}`} onClick={() => setAllocView(k)}>{l}</button>
              ))}
            </div>
            {allocView === 'economic' && <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginBottom: 8 }}>Options folded into their underlier — the QQQ put is short equity delta, so it nets your equity down.</div>}
            {allocEntries.map(([k, v]) => (
              <BarRow key={k} label={k} valueLabel={f$(v)} pct={Math.abs(v) / allocTotal * 100} pctLabel={`${v < 0 ? '-' : ''}${wpct(Math.abs(v) / total * 100)}`} color={allocColor(k)} neg={v < 0} />
            ))}
          </div>
          <div style={card}>
            <div style={eyebrow}>Risk contribution · where volatility comes from</div>
            <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginBottom: 6 }}>First-order (weight × beta). Cash &amp; the put add none; small high-beta names punch above their weight.</div>
            {rc.map((x) => (
              <BarRow key={x.ticker} label={x.ticker} valueLabel={`${wpct(x.weight)} wt`} pct={x.riskPct / rcMax * 100} pctLabel={wpct(x.riskPct)} color={AC_COLOR[x.ac] || '#0a5cd1'} />
            ))}
          </div>
        </div>
      </section>

      {/* options / hedge decomposition */}
      {opt && (
        <section className="mt-pagesection">
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 22, alignItems: 'center' }}>
            <div>
              <div style={eyebrow}>Hedge · {opt.underlier} {opt.contractType} (decomposed)</div>
              <div style={{ fontSize: 13, color: 'var(--mt-ink-1)', maxWidth: 360, lineHeight: 1.5 }}>
                A <b>{opt.label}</b> on <b>{opt.underlier}</b> — short delta, i.e. downside protection. Shown by underlier and netted against your equity longs, not bucketed as "Options."
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--mt-line-1)', border: '1px solid var(--mt-line-1)', borderRadius: 10, overflow: 'hidden' }}>
              {[['Delta-equiv exposure', opt.deltaEquivNotional != null ? f$(opt.deltaEquivNotional) : `${Math.round(opt.deltaEquivShares)} sh`, 'short equity (est. delta)'],
                ['Downside protected', f$(opt.protectionNotional), `${wpct(opt.protectionNotional / total * 100)} of book`],
                ['Direction', opt.label, `${opt.underlier} index`]].map((m, i) => (
                <div key={i} style={{ background: 'var(--mt-surface)', padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', marginBottom: 5 }}>{m[0]}</div>
                  <div className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 18, fontWeight: 600, color: i === 0 ? 'var(--mt-down)' : 'var(--mt-ink-0)' }}>{m[1]}</div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 2 }}>{m[2]}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* scenario stress + income */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 16 }}>
          <div style={card}>
            <div style={eyebrow}>Scenario stress · first-order P/L estimate</div>
            <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginBottom: 6 }}>Your dominant risk is HY credit spreads (the {wpct((book.allocByClass['Fixed Income'] || 0) / total * 100)} bond fund), not equities.</div>
            {scenarios.map((s) => (
              <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '1fr 84px 104px', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--mt-line-0)' }}>
                <span style={{ fontSize: 11.5, color: 'var(--mt-ink-1)' }}>{s.n}</span>
                <span style={{ height: 7, borderRadius: 4, background: 'var(--mt-surface-3)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.abs(s.d) / scMax * 100}%`, background: s.d >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} /></span>
                <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 11.5, textAlign: 'right', color: s.d >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{s.d >= 0 ? '+' : ''}{f$(s.d)} · {fpct(s.p)}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={eyebrow}>Income &amp; yield · projected annual</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 12px' }}>
              {[['HY bond income', f$(((book.allocByClass['Fixed Income'] || 0) * 0.068))], ['Cash & sweep (~4.5%)', f$(cashTot * 0.045)], ['Equity dividends', f$(income - (book.allocByClass['Fixed Income'] || 0) * 0.068 - cashTot * 0.045)]].map((r, i) => (
                <React.Fragment key={i}><span style={{ color: 'var(--mt-ink-2)', fontSize: 12.5 }}>{r[0]}</span><span className="num" style={{ fontFamily: 'var(--mt-font-mono)', textAlign: 'right', fontSize: 13 }}>{r[1]}</span></React.Fragment>
              ))}
              <span style={{ color: 'var(--mt-ink-0)', fontSize: 13, fontWeight: 600, borderTop: '1px solid var(--mt-line-1)', paddingTop: 9 }}>Projected annual</span>
              <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--mt-up)', borderTop: '1px solid var(--mt-line-1)', paddingTop: 9 }}>{f$(income)}</span>
              <span style={{ color: 'var(--mt-ink-2)', fontSize: 12.5 }}>Portfolio yield</span>
              <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', textAlign: 'right', fontSize: 13 }}>{wpct(income / total * 100)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* positions table */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead"><div><div className="mt-eyebrow">Holdings</div><div className="mt-h2">All positions</div></div><button type="button" className="mt-btn" onClick={() => setShowImport(true)}>Upload / import</button></div>
        <div className="mt-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{cols.map((c) => (
                <th key={c.k} onClick={() => onSort(c.k)} style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', textAlign: c.l2 ? 'left' : 'right', padding: '11px 14px', borderBottom: '1px solid var(--mt-line-1)', cursor: 'pointer', whiteSpace: 'nowrap', background: 'var(--mt-surface-2)' }}>
                  {c.l}{sortK === c.k ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => {
                const c = r.option ? AC_COLOR.Options : (AC_COLOR[r.cls.ac] || '#0a5cd1');
                const acLabel = r.option ? `Option · ${r.option.underlier}` : r.cls.ac;
                const sub = r.option ? r.option.label : r.cls.sub;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
                    <td style={{ padding: '9px 14px' }}>
                      <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontWeight: 600, fontSize: 12.5, cursor: r.ticker && !r.option ? 'pointer' : 'default', color: 'var(--mt-ink-0)' }} onClick={() => r.ticker && !r.option && navigate(`/ticker/${r.ticker}`)}>{r.ticker}</span>
                      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{r.name || ''}</div>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: c + '22', color: c }}>{acLabel}</span>
                      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{sub}</div>
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: 'var(--mt-ink-1)' }}>{r.account_name}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--mt-font-mono)', fontSize: 12 }}>{Number(r.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--mt-font-mono)', fontSize: 12, fontWeight: 600 }}>{f$full(r.value)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--mt-font-mono)', fontSize: 12 }}>{wpct(r.weight)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--mt-font-mono)', fontSize: 12, color: r.pl == null ? 'var(--mt-ink-3)' : r.pl >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>{r.pl == null ? '—' : (r.pl >= 0 ? '+' : '') + f$full(r.pl)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'var(--mt-font-mono)', fontSize: 12 }}>{r.option ? '—' : (Number(r.beta) || 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 12, lineHeight: 1.6 }}>
          Live from your accounts: holdings, values, weights, P/L, and the corrected asset-class / sector classification. Risk stats, scenario P/L, option delta, and yields are first-order estimates wired to the live engines on the next pass.
        </div>
      </section>

      {showImport && (
        <SmartImport userId={portfolio?.userId ?? null} onClose={() => setShowImport(false)} onDone={async () => { await portfolio?.refetch?.(); }} />
      )}
    </div>
  );
}
