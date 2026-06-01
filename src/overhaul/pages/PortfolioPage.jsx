/* Portfolio Insights — rebuilt 2026-06-01 to match the site design system.
   Uses the real overhaul classes (pf-* account cards, pf-allocrow allocation,
   lm-scancard scored rows, pf-keystats hero, display-font numbers) so the page
   matches Home / Scanner / Tilt instead of bespoke inline styling.

   Built on the tested engines: classification + options decomposition
   (../lib/portfolioAnalytics) and trailing proxy-risk (../lib/portfolioRisk,
   fed by public/risk_proxies.json). Every number is real or omitted — no
   placeholders. Funds map to liquid proxies for the trailing risk panel only,
   clearly labelled. Preserves import + Add/Edit/Close/Delete + ticker links. */

import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import { supabase } from '../../lib/supabase';
import FreshnessChip from '../components/FreshnessChip';
import Tip from '../components/Tip';
import SmartImport from '../components/SmartImport';
import PositionEditor from '../../components/PositionEditor';
import CloseModal from '../../components/CloseModal';
import useEngineRegime from '../lib/useEngineRegime';
import { buildBook } from '../lib/portfolioAnalytics';
import { computeTrailingRisk } from '../lib/portfolioRisk';

const PF_COLORS = ['#0a5cd1', '#1f9d60', '#c08428', '#c1394f', '#5c34c9', '#0a8a8a', '#3a3f47', '#9a6a1e'];
const AC_COLOR = { 'Fixed Income': '#c08428', Cash: '#7a8290', Equity: '#0a5cd1', Options: '#5c34c9', Commodity: '#1f9d60', Crypto: '#c1394f' };
const AC_ORDER = ['Fixed Income', 'Cash', 'Equity', 'Options', 'Commodity', 'Crypto'];

const fk = (v) => { if (v == null || !Number.isFinite(v)) return '—'; const s = v < 0 ? '-' : ''; const a = Math.abs(v); return a >= 1000 ? `${s}$${(a / 1000).toFixed(a >= 100000 ? 0 : 1)}K` : `${s}$${a.toFixed(0)}`; };
const f$full = (v) => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const fpct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const wpct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
const upDn = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export default function PortfolioPage() {
  const portfolio = useUserPortfolio();
  const accounts = useMemo(() => portfolio?.accounts || [], [portfolio?.accounts]);
  const loading = portfolio?.loading;
  const navigate = useNavigate();
  const regime = useEngineRegime();

  const [tab, setTab] = useState('class');        // allocation lens: account | sector | class
  const [acctOpen, setAcctOpen] = useState(null);
  const [drillRow, setDrillRow] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [positionEditor, setPositionEditor] = useState(null);
  const [closeModal, setCloseModal] = useState(null);
  const [riskFeed, setRiskFeed] = useState(null);
  const [wlInput, setWlInput] = useState('');
  const userId = portfolio?.userId ?? null;
  const watchlist = portfolio?.watchlist || [];

  const positions = useMemo(() => {
    const out = [];
    accounts.forEach((a) => (a.positions || []).forEach((p) => out.push({
      ...p, value: p.value ?? (p.quantity != null && p.price != null ? p.quantity * p.price : 0),
      asset_class: p.assetClass, contract_type: p.contractType, account_name: a.label, account_color: a.color,
    })));
    return out;
  }, [accounts]);

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
      } catch (e) { /* moneyness fallback inside engine */ }
    })();
    return () => { cancel = true; };
  }, [positions]);

  useEffect(() => {
    if (typeof fetch !== 'function') return undefined;
    let cancel = false;
    fetch('/risk_proxies.json').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancel) setRiskFeed(d); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  const book = useMemo(() => buildBook(positions, mkt), [positions, mkt]);
  const total = book.total;
  const trisk = useMemo(() => computeTrailingRisk(book.rows, total, riskFeed), [book, total, riskFeed]);

  const rowsWithPL = useMemo(() => book.rows.map((r) => ({
    ...r,
    pl: (r.avgCost != null && r.quantity != null && !r.option) ? r.value - r.avgCost * r.quantity : null,
    plp: (r.avgCost && r.quantity && !r.option) ? (r.value - r.avgCost * r.quantity) / (r.avgCost * r.quantity) * 100 : null,
  })), [book]);

  const cost = useMemo(() => book.rows.reduce((s, r) => s + ((r.avgCost != null && r.quantity != null) ? r.avgCost * r.quantity : 0), 0), [book]);
  const unreal = total - cost;
  const cashTot = book.allocByClass.Cash || 0;
  const sortedRows = useMemo(() => [...rowsWithPL].sort((a, b) => b.value - a.value), [rowsWithPL]);
  const pBeta = useMemo(() => {
    const DB = { Equity: 1.0, 'Fixed Income': 0.3, Cash: 0, Commodity: 0.4, Crypto: 2.2 };
    let bd = 0;
    for (const r of book.rows) { if (r.cls?.ac === 'Cash') continue; if (r.option) bd += (r.option.deltaEquivNotional || 0); else bd += r.value * (Number(r.beta) || (DB[r.cls.ac] ?? 1)); }
    return total ? bd / total : 0;
  }, [book, total]);

  // per-account rollup (real: balance, share, return on cost, positions)
  const acctData = useMemo(() => accounts.map((a, i) => {
    const pos = rowsWithPL.filter((r) => r.account_name === a.label);
    const bal = pos.reduce((s, r) => s + r.value, 0);
    const c = pos.reduce((s, r) => s + ((r.avgCost != null && r.quantity != null) ? r.avgCost * r.quantity : 0), 0);
    return { name: a.label, color: a.color || PF_COLORS[i % PF_COLORS.length], balance: bal, share: total ? bal / total * 100 : 0, ret: c ? (bal - c) / c * 100 : null, positions: pos.length, holdings: pos };
  }).filter((a) => a.positions > 0).sort((x, y) => y.balance - x.balance), [accounts, rowsWithPL, total]);

  // allocation rows for the active lens
  const allocRows = useMemo(() => {
    if (tab === 'account') return acctData.map((a) => ({ name: a.name, value: a.balance, pct: a.share, color: a.color }));
    if (tab === 'sector') {
      const m = {}; book.rows.forEach((r) => { if (!r.option && r.cls.ac === 'Equity') { const s = r.cls.sector || 'Diversified'; m[s] = (m[s] || 0) + r.value; } });
      const eqTot = Object.values(m).reduce((s, v) => s + v, 0) || 1;
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, v], i) => ({ name, value: v, pct: v / eqTot * 100, color: PF_COLORS[i % PF_COLORS.length] }));
    }
    return AC_ORDER.filter((a) => book.allocByClass[a]).map((a) => ({ name: a, value: book.allocByClass[a], pct: total ? book.allocByClass[a] / total * 100 : 0, color: AC_COLOR[a] }));
  }, [tab, acctData, book, total]);

  const exp = book.exposure;
  const opt = book.rows.find((r) => r.option)?.option;
  const rc = useMemo(() => {
    const m = {}; book.riskContribution.forEach((x) => { if (!m[x.ticker]) m[x.ticker] = { ...x }; else { m[x.ticker].riskPct += x.riskPct; m[x.ticker].weight += x.weight; } });
    return Object.values(m).sort((a, b) => b.riskPct - a.riskPct);
  }, [book]);
  const topRisk = rc[0];
  const largestNonCash = sortedRows.find((r) => r.cls?.ac !== 'Cash');

  const deletePosition = async (row) => {
    if (!row?.id) return;
    if (!window.confirm(`Remove ${row.ticker} from ${row.account_name}? Data cleanup only — no cash is credited. Use Close to record a real sale.`)) return;
    const { error } = await supabase.from('positions').delete().eq('id', row.id);
    if (error) { window.alert(`Could not delete: ${error.message || 'error'}`); return; }
    await portfolio?.refetch?.();
  };
  const heldPositions = useMemo(() => book.rows.filter((r) => !r.option), [book]);

  const addWatch = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const ticker = String(wlInput || '').toUpperCase().trim();
    if (!ticker) return;
    if (!userId) { window.alert('Sign in to manage your watchlist.'); return; }
    const sort_order = (watchlist.reduce((m, w) => Math.max(m, w.sort_order || 0), 0)) + 1;
    const { error } = await supabase.from('watchlist').insert({ user_id: userId, ticker, name: '', theme: '', sort_order });
    if (error) { window.alert(`Could not add ${ticker}: ${error.message || 'error'}`); return; }
    setWlInput('');
    await portfolio?.refetch?.();
  };
  const removeWatch = async (ticker) => {
    if (!userId) return;
    const { error } = await supabase.from('watchlist').delete().match({ user_id: userId, ticker });
    if (error) { window.alert(`Could not remove: ${error.message || 'error'}`); return; }
    await portfolio?.refetch?.();
  };

  if (loading) return <div className="mt-pagebody"><article className="mt-card" style={{ padding: 40, textAlign: 'center', color: 'var(--mt-ink-2)' }}>Loading portfolio…</article></div>;

  if (!positions.length) return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero"><div>
        <div className="mt-eyebrow">Portfolio insights</div>
        <h1 className="mt-h1">Portfolio</h1>
        <p className="mt-deck">No holdings loaded yet. Sign in and upload your positions or trades to see your full book — allocation done right, real exposure, and every account scored.</p>
        <button type="button" className="mt-btn mt-btn--primary" onClick={() => setShowImport(true)}>Upload / import</button>
      </div></section>
      {showImport && <SmartImport userId={userId} onClose={() => setShowImport(false)} onDone={async () => { await portfolio?.refetch?.(); }} />}
    </div>
  );

  const account = acctOpen ? acctData.find((a) => a.name === acctOpen) : null;
  const riskNote = topRisk ? `${topRisk.ticker} drives ${wpct(topRisk.riskPct)} of book volatility` : 'diversified across positions';

  return (
    <div className="mt-pagebody mt-fade">
      {/* ── hero ─────────────────────────────────────────────────────── */}
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Portfolio insights <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" /></div>
          <h1 className="mt-h1">Your book, <i>scored</i> and stress-tested by the MacroTilt engine.</h1>
          <p className="mt-deck">Every position valued, classified, and rolled up across {acctData.length} accounts — with real exposure, concentration, and trailing risk.</p>
        </div>
        <div className="pf-keystats">
          <div className="mt-eyebrow">Key stats</div>
          <div className="pf-keygrid">
            <div><div className="mt-eyebrow">Total wealth</div><b className="pf-keynum num">{fk(total)}</b><span className="pf-keysub num">{acctData.length} accounts</span></div>
            <div><div className="mt-eyebrow">Unrealized P/L</div><b className={`pf-keynum num ${upDn(unreal)}`}>{fpct(cost ? unreal / cost * 100 : null)}</b><span className="pf-keysub num">{(unreal >= 0 ? '+' : '') + f$full(unreal)}</span></div>
            <div><div className="mt-eyebrow">Equity beta</div><b className="pf-keynum num">{pBeta.toFixed(2)}</b><span className="pf-keysub num">S&amp;P 1.00</span></div>
            <div><div className="mt-eyebrow">Sharpe</div><b className="pf-keynum num">{trisk?.sharpe != null ? trisk.sharpe.toFixed(2) : '—'}</b><span className="pf-keysub num">{trisk ? 'trailing 3y' : '…'}</span></div>
          </div>
        </div>
      </section>

      {/* ── accounts ─────────────────────────────────────────────────── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div><div className="mt-eyebrow">By account</div><div className="mt-h2">{acctData.length} accounts · click to drill in</div></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="mt-btn mt-btn--primary" onClick={() => setPositionEditor({ mode: 'add' })}>+ Add position</button>
            <button type="button" className="mt-btn" onClick={() => setShowImport(true)}>Upload / import</button>
          </div>
        </div>
        <div className="pf-acctgrid">
          {acctData.map((a) => (
            <button key={a.name} type="button" className={`mt-card pf-acctcard ${acctOpen === a.name ? 'on' : ''}`} onClick={() => setAcctOpen(acctOpen === a.name ? null : a.name)}>
              <div className="pf-accthead">
                <span className="pf-acctname"><span className="pf-acctdot" style={{ background: a.color }} />{a.name}</span>
                <span className="num pf-acctshare">{a.share.toFixed(1)}<i> % of book</i></span>
              </div>
              <div className="pf-acctbal num">{fk(a.balance)}</div>
              <div className="pf-acctkv">
                <div><div className="mt-eyebrow">Return</div><b className={`num ${upDn(a.ret)}`}>{a.ret == null ? '—' : fpct(a.ret)}</b></div>
                <div><div className="mt-eyebrow">Positions</div><b className="num">{a.positions}</b></div>
                <div><div className="mt-eyebrow">Weight</div><b className="num">{a.share.toFixed(0)}%</b></div>
              </div>
              <div className="pf-acctfoot">{acctOpen === a.name ? '▾ Hide holdings' : '▸ Open holdings'}</div>
            </button>
          ))}
        </div>

        {account && (
          <article className="mt-card pf-acctdrill mt-fade">
            <div className="pf-acctdrillhead">
              <div>
                <div className="mt-eyebrow"><span className="pf-acctdot" style={{ background: account.color, marginRight: 6 }} />Account</div>
                <div className="mt-h2">{account.name}</div>
                <div style={{ fontSize: 13, color: 'var(--mt-ink-2)', marginTop: 4 }}>
                  <b className="num" style={{ color: 'var(--mt-ink-0)' }}>{f$full(account.balance)}</b>{' '}· {account.positions} positions ·{' '}
                  <span className={upDn(account.ret)}>{account.ret == null ? '—' : fpct(account.ret)} on cost</span>
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => setAcctOpen(null)}>✕ Close</button>
            </div>
            <table className="pf-mini">
              <thead><tr><th>Ticker</th><th>Class</th><th className="num">Value</th><th className="num">Weight</th><th className="num">P/L</th><th /></tr></thead>
              <tbody>
                {account.holdings.sort((a, b) => b.value - a.value).map((p) => (
                  <tr key={p.id || p.ticker}>
                    <td><span className="lm-tkmain lm-tkmain--link" style={{ fontSize: 15 }} onClick={() => p.ticker && !p.option && navigate(`/ticker/${p.ticker}`)}>{p.ticker}</span></td>
                    <td style={{ color: 'var(--mt-ink-2)', fontSize: 12 }}>{p.option ? `Option · ${p.option.underlier}` : p.cls.ac}</td>
                    <td className="num">{fk(p.value)}</td>
                    <td className="num">{wpct(p.weight)}</td>
                    <td className={`num ${upDn(p.pl)}`}>{p.pl == null ? '—' : (p.pl >= 0 ? '+' : '') + fk(p.pl)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="mt-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setPositionEditor({ mode: 'edit', existing: p })}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}
      </section>

      {/* ── allocation ───────────────────────────────────────────────── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div><div className="mt-eyebrow">Allocation</div><div className="mt-h2">Where the money lives.</div></div>
          <div className="mt-pillgroup">
            {[['class', 'By asset class'], ['sector', 'By sector'], ['account', 'By account']].map(([k, l]) => (
              <button key={k} type="button" className={`mt-pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
        </div>
        <article className="mt-card">
          {tab === 'sector' && <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Equity sleeve only</div>}
          <div className="pf-allocrows">
            {allocRows.map((r, i) => (
              <div key={r.name} className="pf-allocrow">
                <span className="pf-alloccolor" style={{ background: r.color || PF_COLORS[i % PF_COLORS.length] }} />
                <span className="pf-allocname">{r.name}</span>
                <span className="pf-allocbar"><span style={{ width: `${Math.min(100, Math.abs(r.pct))}%`, background: r.color || PF_COLORS[i % PF_COLORS.length] }} /></span>
                <span className="num pf-allocval">{fk(r.value)}</span>
                <span className="num pf-allocpct">{r.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      {/* ── positions (scored-row style like the Scanner) ────────────── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div><div className="mt-eyebrow">Positions</div><div className="mt-h2">Every position — value, cost &amp; P/L.</div></div>
        </div>
        <ul className="lm-scanlist">
          {sortedRows.map((p) => {
            const isOpt = !!p.option;
            const c = isOpt ? AC_COLOR.Options : (AC_COLOR[p.cls.ac] || '#0a5cd1');
            const open = drillRow === (p.id || p.ticker);
            return (
              <li key={p.id || p.ticker} className={`lm-scancard ${open ? 'open' : ''}`}>
                <button type="button" className="lm-scanrow" style={{ gridTemplateColumns: '240px 96px 1fr 130px 130px 28px' }} onClick={() => setDrillRow(open ? null : (p.id || p.ticker))}>
                  <div className="lm-tk">
                    <span className="lm-tkmain lm-tkmain--link" onClick={(e) => { e.stopPropagation(); p.ticker && !isOpt && navigate(`/ticker/${p.ticker}`); }}>{p.ticker}</span>
                    <div className="lm-tksub">{p.account_name} · {isOpt ? p.option.label : (p.cls.sub || p.cls.ac)}</div>
                  </div>
                  <div><span className="lm-sigpill" style={{ background: c + '22', color: c }}>{isOpt ? 'OPTION' : p.cls.ac.toUpperCase()}</span></div>
                  <div className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-2)', fontSize: 12 }}>{wpct(p.weight)} of book</div>
                  <div className="num pf-valblock">
                    <div className="lm-tkpx">{fk(p.value)}</div>
                    <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{Number(p.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {isOpt ? 'ct' : 'sh'}{p.price != null ? ` @ $${Number(p.price).toFixed(2)}` : ''}</div>
                  </div>
                  <div className="num pf-plblock">
                    <div className={`pf-plval ${upDn(p.pl)}`}>{p.pl == null ? '—' : (p.pl >= 0 ? '+' : '') + fk(p.pl)}</div>
                    <div className={`pf-plpct ${upDn(p.plp)}`} style={{ fontSize: 12 }}>{p.plp == null ? '' : fpct(p.plp)}</div>
                  </div>
                  <div className="lm-tkchev">{open ? '▾' : '▸'}</div>
                </button>
                {open && (
                  <div className="lm-drill mt-fade">
                    <div className="lm-drillcol">
                      <div className="mt-eyebrow">Position detail</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 10 }}>
                        <div><div className="mt-eyebrow">Cost basis</div><b className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 17 }}>{p.avgCost != null && p.quantity != null ? fk(p.avgCost * p.quantity) : '—'}</b></div>
                        <div><div className="mt-eyebrow">Mkt value</div><b className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 17 }}>{fk(p.value)}</b></div>
                        <div><div className="mt-eyebrow">Total P/L</div><b className={`num ${upDn(p.pl)}`} style={{ fontFamily: 'var(--mt-font-display)', fontSize: 17 }}>{p.pl == null ? '—' : (p.pl >= 0 ? '+' : '') + fk(p.pl)}</b></div>
                      </div>
                      <div className="lm-drillctas" style={{ marginTop: 14 }}>
                        {p.ticker && !isOpt && <button type="button" className="mt-btn mt-btn--primary" onClick={() => navigate(`/ticker/${p.ticker}`)}>Open ticker detail →</button>}
                        <button type="button" className="mt-btn" onClick={() => setPositionEditor({ mode: 'edit', existing: p })}>Edit</button>
                        {!isOpt && p.cls.ac !== 'Cash' && <button type="button" className="mt-btn" onClick={() => setCloseModal({ position: p })}>Close</button>}
                        <button type="button" className="mt-btn" onClick={() => deletePosition(p)}>Delete</button>
                      </div>
                    </div>
                    <div className="lm-drillcol">
                      <div className="mt-eyebrow">Classification</div>
                      <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--mt-ink-1)' }}>
                        {isOpt
                          ? <>A {p.option.label} on {p.option.underlier}{p.option.strike ? ` (strike $${p.option.strike})` : ''}. It enters exposure as {p.option.deltaEquivNotional != null ? fk(p.option.deltaEquivNotional) : '—'} of delta-equivalent {p.option.underlier}{p.option.protectionNotional ? `, protecting ${fk(p.option.protectionNotional)} below the strike` : ''}.</>
                          : <>{p.cls.ac}{p.cls.sub ? ` · ${p.cls.sub}` : ''}{p.cls.geo && p.cls.geo !== '—' ? ` · ${p.cls.geo}` : ''}. Beta to the S&amp;P about {(Number(p.beta) || ({ Equity: 1.0, 'Fixed Income': 0.3, Cash: 0, Commodity: 0.4, Crypto: 2.2 }[p.cls.ac] ?? 1)).toFixed(2)}.</>}
                      </p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── risk + exposure ──────────────────────────────────────────── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead"><div><div className="mt-eyebrow">Risk</div><div className="mt-h2">Trailing risk &amp; engine read.</div></div></div>
        <div className="pf-acctdrillgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <article className="mt-card">
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Risk metrics · trailing</div>
            {!trisk ? <div style={{ color: 'var(--mt-ink-3)', fontSize: 13 }}>Computing from the market feed…</div> : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px 18px' }}>
                  {[
                    ['Volatility', wpct(trisk.vol * 100), null, "How much the book swings over a year."],
                    ['Sharpe', trisk.sharpe != null ? trisk.sharpe.toFixed(2) : '—', null, 'Return per unit of risk, above cash.'],
                    ['Sortino', trisk.sortino != null ? trisk.sortino.toFixed(2) : '—', null, 'Like Sharpe but only downside counts.'],
                    ['Max drawdown (12m)', wpct(trisk.maxDD * 100), 'down', 'Worst peak-to-trough drop last year.'],
                    ['Value at risk (95% · 1d)', fk(trisk.var95Dollar), 'down', 'A rough day (1-in-20) loses about this.'],
                    ['Beta to high-yield', trisk.betaHY != null ? trisk.betaHY.toFixed(2) : '—', null, 'Sensitivity to high-yield bond moves.'],
                  ].map((m, i) => (
                    <div key={i}>
                      <Tip content={m[3]}><div className="mt-eyebrow">{m[0]}</div></Tip>
                      <b className={`num ${m[2] || ''}`} style={{ fontFamily: 'var(--mt-font-display)', fontSize: 22, fontWeight: 400, display: 'block', marginTop: 4, color: m[2] === 'down' ? 'var(--mt-down)' : 'var(--mt-ink-0)' }}>{m[1]}</b>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 14, lineHeight: 1.5, borderTop: '1px solid var(--mt-line-0)', paddingTop: 10 }}>
                  Proxy-based estimate · {trisk.windowYears}-yr daily returns · as of {trisk.asOf}. Funds shown via liquid look-alikes.
                </div>
              </>
            )}
          </article>
          <article className="mt-card">
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>MacroTilt engine read</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>Regime</span>
              <b className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 18, fontWeight: 500, color: regime?.stressColor || 'var(--mt-ink-1)' }}>{regime?.loading ? '…' : (regime?.regimeLabel || '—')}</b>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-warn)', fontWeight: 700 }}>•</span><span style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Concentration</b> — {largestNonCash ? `${wpct(largestNonCash.weight)} sits in ${largestNonCash.ticker}` : 'well spread across positions'}.</span></div>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-accent)', fontWeight: 700 }}>•</span><span style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Top risk</b> — {riskNote}.</span></div>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><span style={{ color: 'var(--mt-up)', fontWeight: 700 }}>•</span><span style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}><b>Dry powder</b> — {wpct(total ? cashTot / total * 100 : 0)} in cash for flexibility.</span></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--mt-line-1)', border: '1px solid var(--mt-line-1)', borderRadius: 8, overflow: 'hidden', marginTop: 16 }}>
              {[['Long', exp.long], ['Short', exp.short], ['Gross', exp.gross], ['Net', exp.net]].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--mt-surface)', padding: '9px 11px' }}>
                  <div className="mt-eyebrow">{l}</div>
                  <b className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 16, fontWeight: 500, display: 'block', marginTop: 2, color: v < 0 ? 'var(--mt-down)' : 'var(--mt-ink-0)' }}>{wpct(total ? v / total * 100 : 0)}</b>
                </div>
              ))}
            </div>
            {opt && <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', marginTop: 10, lineHeight: 1.5 }}>Short line = the {opt.underlier} {opt.contractType} ({opt.deltaEquivNotional != null ? fk(opt.deltaEquivNotional) : '—'} delta-equivalent), protecting {fk(opt.protectionNotional)} below ${opt.strike}.</div>}
          </article>
        </div>
      </section>

      {/* ── watchlist ────────────────────────────────────────────────── */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead"><div><div className="mt-eyebrow">Watchlist</div><div className="mt-h2">Names you're tracking.</div></div></div>
        <article className="mt-card">
          <form onSubmit={addWatch} style={{ display: 'flex', gap: 8, marginBottom: watchlist.length ? 16 : 0, flexWrap: 'wrap' }}>
            <input value={wlInput} onChange={(e) => setWlInput(e.target.value)} placeholder="Add a ticker — e.g. NVDA"
              style={{ flex: '0 1 240px', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mt-line-1)', background: 'var(--mt-surface-2)', color: 'var(--mt-ink-0)', fontFamily: 'var(--mt-font-mono)', fontSize: 13 }} />
            <button type="submit" className="mt-btn mt-btn--primary">Add to watchlist</button>
          </form>
          {watchlist.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {watchlist.map((w) => (
                <span key={w.ticker} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px', border: '1px solid var(--mt-line-1)', borderRadius: 999, background: 'var(--mt-surface-2)' }}>
                  <span className="lm-tkmain lm-tkmain--link" style={{ fontSize: 15 }} onClick={() => navigate(`/ticker/${w.ticker}`)}>{w.ticker}</span>
                  {w.name ? <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>{w.name}</span> : null}
                  <button type="button" onClick={() => removeWatch(w.ticker)} aria-label={`Remove ${w.ticker}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mt-ink-3)', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>✕</button>
                </span>
              ))}
            </div>
          ) : <div style={{ fontSize: 13, color: 'var(--mt-ink-3)' }}>No names yet — add a ticker above to start tracking it.</div>}
        </article>
      </section>

      {showImport && <SmartImport userId={userId} onClose={() => setShowImport(false)} onDone={async () => { await portfolio?.refetch?.(); }} />}
      {positionEditor && (
        <PositionEditor mode={positionEditor.mode} existing={positionEditor.existing} accounts={accounts} userId={userId} heldPositions={heldPositions}
          onClose={() => setPositionEditor(null)} onSaved={async () => { await portfolio?.refetch?.(); setPositionEditor(null); }} onDeleted={async () => { await portfolio?.refetch?.(); setPositionEditor(null); }}
          onClosePosition={(existing) => { setPositionEditor(null); setCloseModal({ position: existing }); }} />
      )}
      {closeModal && <CloseModal position={closeModal.position} accounts={accounts} onCancel={() => setCloseModal(null)} onClosed={async () => { await portfolio?.refetch?.(); setCloseModal(null); }} />}
    </div>
  );
}
