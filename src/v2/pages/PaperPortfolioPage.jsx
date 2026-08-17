/* PaperPortfolioPage — the Quality Trend book, live.

   2026-08-17: the under-construction placeholder comes down. The replacement
   strategy (Quality Trend v3) was validated on survivorship-free data —
   14,632 US companies 2016–2026 including 2,011 that no longer exist — and
   the $1M paper account went live at today's open: 40 names, equal weight,
   monthly rebalance. Full spec: paper_portfolio/QUALITY_TREND_V3.md; scoring
   engine: paper_portfolio/qt/.

   Data, all read-only through RLS-protected public tables:
     qt_target_book — the 40 names of the current rebalance, with the inputs
                      that put them there (written by QT-REBALANCE, monthly)
     qt_orders      — order intents + fill state (QT-PLACE-ORDERS / QT-EOD-DAILY)
     qt_nav_daily   — one equity snapshot per trading day (QT-EOD-DAILY)

   Design: self-contained inline styles on the cream ground, same as the
   placeholder it replaces — no new CSS file, nothing for the bundler to
   tree-shake wrong. Borders/dividers use neutral rgba grays so light, dark
   and navy themes all read. Backtest numbers are quoted VERBATIM from the
   strategy spec, never re-derived here (LESSONS 8.3). */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const BORDER = '1px solid rgba(128,128,128,0.25)';
const HAIRLINE = '1px solid rgba(128,128,128,0.16)';

/* Backtest figures — VERBATIM from paper_portfolio/QUALITY_TREND_V3.md.
   If the spec changes these change with it; nothing on this page computes them. */
const BACKTEST = {
  window: 'Feb 2017 – Aug 2026',
  cagr: '21.2%', cagrSpx: '15.3%',
  sharpe: '0.97', sharpeSpx: '0.82',
  maxdd: '−19.3%', maxddSpx: '−23.9%',
  years: '7 of 10', worstYear: '−6.7%', worstYearSpx: '−18.2%',
};

const fmtUsd = (v, dp = 0) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
const fmtPct = (v, dp = 1) =>
  (v == null || !Number.isFinite(Number(v))) ? '—'
    : `${v > 0 ? '+' : ''}${(Number(v) * 100).toFixed(dp)}%`;
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function Stat({ label, value, sub, accent }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.5, marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: accent || 'inherit' }}>{value}</div>
      {sub ? <div style={{ fontSize: 12.5, opacity: 0.55, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

const th = { textAlign: 'right', padding: '8px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5, whiteSpace: 'nowrap' };
const td = { textAlign: 'right', padding: '9px 10px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

export default function PaperPortfolioPage({ onOpenTicker }) {
  const [book, setBook] = useState(null);        // latest rebalance rows
  const [orders, setOrders] = useState({});      // symbol -> latest order row
  const [nav, setNav] = useState(null);          // qt_nav_daily rows, ascending
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { data: latest, error: e1 } = await supabase
          .from('qt_target_book')
          .select('rebalance_date')
          .order('rebalance_date', { ascending: false })
          .limit(1);
        if (e1) throw e1;
        const rd = latest?.[0]?.rebalance_date;
        if (!rd) { if (!dead) setBook([]); return; }

        const [bk, od, nv] = await Promise.all([
          supabase.from('qt_target_book').select('*').eq('rebalance_date', rd).order('rank'),
          supabase.from('qt_orders').select('symbol,side,qty,status,filled_qty,filled_avg_price')
            .eq('rebalance_date', rd).neq('status', 'dry_run'),
          supabase.from('qt_nav_daily').select('d,equity,cash,n_positions,positions').order('d'),
        ]);
        if (bk.error) throw bk.error;
        if (dead) return;
        setBook(bk.data || []);
        const om = {};
        (od.data || []).forEach((o) => { om[o.symbol] = o; });
        setOrders(om);
        setNav(nv.data || []);
      } catch (ex) {
        if (!dead) setErr(String(ex?.message || ex));
      }
    })();
    return () => { dead = true; };
  }, []);

  const latestNav = nav && nav.length ? nav[nav.length - 1] : null;
  const liveReturn = latestNav ? latestNav.equity / 1000000 - 1 : null;
  const marks = useMemo(() => {
    const m = {};
    (latestNav?.positions || []).forEach((p) => { m[p.symbol] = p; });
    return m;
  }, [latestNav]);
  const rebalDate = book && book.length ? book[0].rebalance_date : null;

  const filled = Object.values(orders).filter((o) => o.status === 'filled').length;
  const pending = Object.values(orders).filter((o) => !['filled', 'canceled', 'rejected', 'expired'].includes(o.status)).length;

  return (
    <div className="cream-page paper-qt">
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '72px 24px 120px' }}>

        {/* ── hero ─────────────────────────────────────────────────────── */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.55, marginBottom: 20 }}>
          Paper Portfolio
        </div>
        <h1 style={{ fontSize: 'clamp(34px, 5vw, 48px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 20px' }}>
          Quality Trend
        </h1>
        <p style={{ fontSize: 17.5, lineHeight: 1.65, opacity: 0.8, margin: '0 0 14px', maxWidth: 760 }}>
          Forty US companies with strong, steady price trends <b>and</b> real profitability —
          scored on momentum, trend consistency, gross profitability, cash generation, buybacks
          and meaningful insider buying. Equal weight, rebalanced monthly, no leverage.
          Live in a $1,000,000 paper account since <b>August 17, 2026</b>.
        </p>
        <p style={{ fontSize: 13.5, opacity: 0.6, margin: '0 0 40px' }}>
          Every rule is published — <Link to="/methodology#portfolio" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
            read the full methodology
          </Link>. Paper money, not investment advice.
        </p>

        {/* ── live band ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 24, borderTop: BORDER, paddingTop: 26, marginBottom: 36 }}>
          <Stat label="Account" value={fmtUsd(latestNav ? latestNav.equity : 1000000)}
            sub={latestNav ? `as of ${fmtDate(latestNav.d)} close` : 'opening equity'} />
          <Stat label="Since inception" value={liveReturn == null ? '—' : fmtPct(liveReturn, 2)}
            sub={liveReturn == null ? 'first close lands today' : 'vs. $1,000,000 start'}
            accent={liveReturn == null ? undefined : (liveReturn >= 0 ? 'var(--up, #1a7f4e)' : 'var(--down, #b3403a)')} />
          <Stat label="Positions" value={latestNav ? latestNav.n_positions : (book ? book.length : '—')}
            sub="$25,000 target each" />
          <Stat label="Current book" value={fmtDate(rebalDate)}
            sub={pending > 0 ? `${filled} filled · ${pending} working` : 'monthly rebalance'} />
        </div>

        {/* ── backtest band ────────────────────────────────────────────── */}
        <div style={{ border: BORDER, borderRadius: 12, padding: '22px 24px', marginBottom: 48 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.5, marginBottom: 16 }}>
            Backtest · {BACKTEST.window} · survivorship-free (2,011 delisted companies included)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 24 }}>
            <Stat label="Return / yr" value={BACKTEST.cagr} sub={`S&P 500: ${BACKTEST.cagrSpx}`} />
            <Stat label="Sharpe" value={BACKTEST.sharpe} sub={`S&P 500: ${BACKTEST.sharpeSpx}`} />
            <Stat label="Worst drawdown" value={BACKTEST.maxdd} sub={`S&P 500: ${BACKTEST.maxddSpx}`} />
            <Stat label="Years beating the index" value={BACKTEST.years} sub={`worst year ${BACKTEST.worstYear} vs ${BACKTEST.worstYearSpx}`} />
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.55, marginTop: 16, lineHeight: 1.6 }}>
            A backtest is not a live record. This one covers ten years, includes the companies that
            died, uses financials only from their SEC filing dates, and survives 40bp round-trip
            costs — and the live book should still be expected to run below it. It will also have
            losing years: three of the ten backtest years trailed the index.
          </div>
        </div>

        {/* ── the book ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>The book</h2>
          <div style={{ fontSize: 12.5, opacity: 0.55 }}>
            scored {fmtDate(rebalDate)} · next rebalance: first trading day of the month
          </div>
        </div>

        {err ? (
          <div style={{ border: BORDER, borderRadius: 12, padding: 24, fontSize: 14, opacity: 0.7 }}>
            The book could not be loaded ({err}). Refresh to retry.
          </div>
        ) : !book ? (
          <div style={{ border: BORDER, borderRadius: 12, padding: 24, fontSize: 14, opacity: 0.6 }}>Loading…</div>
        ) : (
          <div style={{ border: BORDER, borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  <th style={{ ...th, textAlign: 'left' }}>#</th>
                  <th style={{ ...th, textAlign: 'left' }}>Company</th>
                  <th style={th}>Position</th>
                  <th style={th}>Fill</th>
                  <th style={th}>P&amp;L</th>
                  <th style={th}>12-mo momentum</th>
                  <th style={th}>Gross profit / assets</th>
                  <th style={th}>Buyback</th>
                  <th style={th}>Insider</th>
                </tr>
              </thead>
              <tbody>
                {book.map((r) => {
                  const o = orders[r.symbol];
                  const m = marks[r.symbol];
                  const fillTxt = o
                    ? (o.status === 'filled' ? fmtUsd(o.filled_avg_price, 2)
                      : o.status.replace(/_/g, ' '))
                    : '—';
                  return (
                    <tr key={r.symbol} style={{ borderBottom: HAIRLINE }}>
                      <td style={{ ...td, textAlign: 'left', opacity: 0.5 }}>{r.rank}</td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <button
                          type="button"
                          onClick={() => onOpenTicker && onOpenTicker(r.symbol)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
                          title={`Open ${r.symbol}`}
                        >
                          <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                          <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 12.5 }}>
                            {(r.company || '').replace(/\s*(Common Stock|Ordinary Share|Class A Common Stock).*$/i, '')}
                          </span>
                        </button>
                      </td>
                      <td style={td}>{m ? fmtUsd(m.mv) : fmtUsd(r.target_dollars)}</td>
                      <td style={{ ...td, opacity: o && o.status !== 'filled' ? 0.6 : 1 }}>{fillTxt}</td>
                      <td style={{ ...td, color: m ? (m.upl >= 0 ? 'var(--up, #1a7f4e)' : 'var(--down, #b3403a)') : 'inherit', opacity: m ? 1 : 0.45 }}>
                        {m ? fmtPct(m.uplpc, 1) : '—'}
                      </td>
                      <td style={td}>{r.mom12 == null ? '—' : `${r.mom12 > 0 ? '+' : ''}${Math.round(r.mom12 * 100)}%`}</td>
                      <td style={td}>{r.gp_a == null ? '—' : Number(r.gp_a).toFixed(2)}</td>
                      <td style={td}>{r.iss == null ? '—' : fmtPct(Number(r.iss), 1)}</td>
                      <td style={{ ...td, opacity: Number(r.insider) > 0 ? 1 : 0.35 }}>
                        {Number(r.insider) > 0 ? Number(r.insider).toFixed(2) : '·'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── how it works, in one breath ──────────────────────────────── */}
        <div style={{ borderLeft: '2px solid rgba(128,128,128,0.3)', paddingLeft: 22, margin: '44px 0 0', maxWidth: 820 }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, opacity: 0.72, margin: 0 }}>
            Every company is scored on six inputs: 12- and 6-month price momentum (45% + 30% —
            skipping the most recent month), trend consistency (15%), drawdown resilience (10%),
            then gross profitability, cash generation and buybacks from point-in-time SEC filings,
            plus a bonus for <i>meaningful</i> insider buying — officers and directors making
            open-market purchases that are large relative to what they already own. A name is
            bought when it enters the top 40 and held until it falls out of the top quarter of the
            ranking, which roughly halves turnover. Buyback figure shown is the year-over-year
            reduction in share count. Fills are the account&rsquo;s official records; marks update
            after each close.
          </p>
        </div>
      </div>
    </div>
  );
}
