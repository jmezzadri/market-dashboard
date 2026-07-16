/* MomentumPanel — Scanner 2 (Momentum sleeve) panel on the Trading Scanner page.
   Power Trend rewrite (2026-07-15): the sleeve's engine is the Power
   Trend signal — up to 15 names, monthly refresh, 8-name diversification
   floor. Replaces the retired 12-1 quintile list and its crash-guard strip.

   Consistency pass (2026-07-15, Joe): the panel now uses the SAME tile
   system as the Insider Conviction scanner — .sc-tablecard / .sc-panelhead /
   .sc-sleeve / .sc-paneltitle / .sc-rule / .sc-scanmeta — and the SAME
   interaction contract: clicking a ROW opens an inline drawer with the
   name's real test readings; clicking the TICKER text opens the full
   ticker page. No more page-jump-on-ticker inconsistency.

   Renders on the shared 1560px stage:
     • header — Scanner 2 kicker / title / sleeve description + rule copy,
       with the "List of {date} · next refresh {date}" meta + freshness chip;
     • the ranked monthly list — rank, ticker+name, price, 3-month return,
       margin over the S&P 500, breakout volume (from power_trend_list,
       latest rebalance_date); rows expand to a drawer;
     • the backtest footnote with the survivorship caveat.

   Data notes (Senior Quant / Data Steward):
     • power_trend_list.roc_3m is a PERCENT (145.0 = +145%), rs_vs_spx is in
       points (135.4 = 135.4 points over the index), breakout_volx is a plain
       multiple (1.35 = 1.35× the 20-day average volume). No unit conversion.
     • The drawer shows ONLY real row fields through the same formatters —
       no derived or synthesized values.
     • A single row with ticker='CASH' and rank=0 is the sentinel for "no
       names passed all three tests this month" — the sleeve is all cash.
     • The list is ≤15 rows — far under the PostgREST 1,000-row cap
       (LESSONS 4.18 does not bite; no paging needed).
     • Chip keys the manifest id equity-power_trend_list-monthly. */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import FreshnessChip from './FreshnessChip';

const MAX_SLOTS = 15;
const MIN_FILL = 8;

const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

// 3-month return, stored as a PERCENT (145.0 = +145%). Group thousands —
// multi-hundred-percent movers are real in this list.
const fmtPct1 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
  return n < 0 ? `−${s}` : `+${s}`;
};

// Margin over the S&P 500's 3-month return, stored in points (135.4).
const fmtPts = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} pts`;
  return n < 0 ? `−${s}` : `+${s}`;
};

// Breakout-day volume as a multiple of the 20-day average (1.35 → "1.35×").
const fmtVolx = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}×` : '—';
};

const fmtPx = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—';
};

/* MomentumDrill — drawer body under a Momentum row. SAME visual language as
   ScanDrill on the Insider table (Joe 2026-07-15: the drawers must match):
   mt-fade wrapper on --mt-surface-2, two-column grid; LEFT a composition-style
   table (Test / Reading / Result), RIGHT the facts boxes + the same mt-btn
   actions. Every value is a real power_trend_list field. */
function MomentumDrill({ row, asOf, filled, navigate }) {
  const [copied, setCopied] = useState(false);
  const TESTS = [
    {
      key: 'Trend & strength',
      why: '3-month return in the top 20% of the universe; price above its 10-, 21-, 50- and 200-day averages',
      reading: `${fmtPct1(row.roc_3m)} over 3 months`,
    },
    {
      key: 'Vs the S&P 500',
      why: 'A 3-month return at least 5 points above the index\u2019s',
      reading: `${fmtPts(row.rs_vs_spx)} over the index`,
    },
    {
      key: 'Breakout',
      why: 'A close at a new 10-day high on volume more than 1.3\u00d7 its 20-day average',
      reading: `${fmtVolx(row.breakout_volx)} average volume`,
    },
  ];
  return (
    <div
      className="mt-fade"
      style={{
        padding: '18px 18px 22px',
        background: 'var(--mt-surface-2)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 22,
        whiteSpace: 'normal',
      }}
    >
      {/* LEFT — the three Power Trend tests, composition-table style */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="mt-eyebrow">Power Trend tests · {fmtDay(asOf)} panel</div>
          <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-1)' }}>
            <b style={{ color: 'var(--mt-accent)' }}>3</b>
            <span style={{ color: 'var(--mt-ink-3)', marginLeft: 2 }}>/3 passed</span>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Test</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Reading</th>
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {TESTS.map((t) => (
              <tr key={t.key} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                <td style={{ padding: '8px 8px 8px 0' }}>
                  <div style={{ color: 'var(--mt-ink-0)', fontWeight: 500 }}>{t.key}</div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{t.why}</div>
                </td>
                <td className="num" style={{ padding: '8px', color: 'var(--mt-ink-1)' }}>{t.reading}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--mt-up)' }}>Pass</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--mt-line-1)' }}>
              <td style={{ padding: '10px 8px 6px 0', fontWeight: 700 }} colSpan={2}>On the Power Trend list</td>
              <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--mt-accent)', fontSize: 14 }}>
                Rank {row.rank}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* RIGHT — sleeve facts + the same trade-plan boxes and actions */}
      <div>
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>In the Momentum sleeve</div>
        <div style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}>
          Rank {row.rank} of {filled} on this month&rsquo;s list. Equal-weight slot in the $500K
          Momentum paper sleeve; the list refreshes monthly on the 1st, and a name leaves the
          sleeve only when it drops off the list.
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            ['Panel close', fmtPx(row.close)],
            ['3-mo return', fmtPct1(row.roc_3m)],
            ['Beat S&P by', fmtPts(row.rs_vs_spx)],
          ].map(([label, v]) => (
            <div key={label} style={{ background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="mt-eyebrow">{label}</div>
              <b className="num" style={{ fontSize: 13 }}>{v}</b>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="mt-btn mt-btn--primary"
            onClick={() => navigate(`/ticker/${row.ticker}`)}
          >
            Open ticker detail →
          </button>
          <button
            type="button"
            className="mt-btn"
            onClick={() => {
              navigator.clipboard?.writeText(row.ticker);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied ✓' : 'Copy ticker'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MomentumPanel() {
  const [rows, setRows] = useState(null);      // null = loading, [] = none
  const [meta, setMeta] = useState(null);      // { asOf, next, allCash }
  const [openTicker, setOpenTicker] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await supabase
          .from('power_trend_list')
          .select('rebalance_date')
          .order('rebalance_date', { ascending: false })
          .limit(1);
        const rd = latest?.data?.[0]?.rebalance_date;
        if (!rd) { if (!cancelled) setRows([]); return; }
        const list = await supabase
          .from('power_trend_list')
          .select('rank, ticker, name, roc_3m, rs_vs_spx, breakout_volx, close, rebalance_date, next_rebalance_date')
          .eq('rebalance_date', rd)
          .order('rank', { ascending: true });
        if (cancelled) return;
        const all = list.data || [];
        const allCash = all.length > 0 && all.every((r) => r.ticker === 'CASH' && Number(r.rank) === 0);
        setRows(allCash ? [] : all.filter((r) => r.ticker !== 'CASH'));
        setMeta({ asOf: rd, next: all[0]?.next_rebalance_date || null, allCash });
      } catch {
        if (!cancelled) { setRows([]); setMeta(null); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const asOf = meta?.asOf || null;
  const nextRefresh = meta?.next || null;
  const allCash = !!meta?.allCash;
  const filled = rows ? rows.length : 0;

  const toggleRow = (tk) => setOpenTicker((cur) => (cur === tk ? null : tk));

  return (
    <section className="wrap mo-sec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-sleeve">Scanner 2 · Sleeve 2</div>
            <h2 className="sc-paneltitle">Momentum Scanner</h2>
            <div className="sc-rule">
              Owns up to 15 liquid US names in confirmed uptrends that just broke to a new 10-day high
              on heavy volume while beating the S&amp;P 500 by 5 points or more over 3 months.
              Equal-weight, refreshed monthly; fewer than 8 qualifiers &rarr; the unfilled slots rest
              in cash. Drives the $500K Momentum paper sleeve.
            </div>
            <div className="sc-rule">
              Three tests, all on daily closes: price above its 10-, 21-, 50- and 200-day moving
              averages with a 3-month return in the top 20% of the universe; a 3-month return at
              least 5 points above the S&amp;P 500&rsquo;s; and a close at a new 10-day high on volume
              more than 1.3&times; its 20-day average.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="equity-power_trend_list-monthly"
                variant="dot"
                fallback={{ asOfIso: asOf, calendar: 'nyse-trading-day' }}
              />
              <span>
                {asOf ? <>List of {fmtDay(asOf)}{nextRefresh ? <> · next refresh {fmtDay(nextRefresh)}</> : null}</> : '—'}
              </span>
            </div>
          </div>
        </div>

        {rows === null ? (
          <div className="mo-loading">Loading the Power Trend list…</div>
        ) : allCash ? (
          <div className="mo-loading">All cash this month — no names passed all three tests.</div>
        ) : rows.length === 0 ? (
          <div className="mo-loading">No Power Trend list published yet.</div>
        ) : (
          <>
            <div className="mo-scroll">
              <table className="mo-table">
                <thead>
                  <tr>
                    <th className="num-h">Rank</th>
                    <th>Ticker</th>
                    <th className="num-h">Price</th>
                    <th className="num-h">3-mo return</th>
                    <th className="num-h">Beat S&amp;P by</th>
                    <th className="num-h">Breakout volume</th>
                    <th className="mo-chev-h" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = openTicker === r.ticker;
                    return (
                      <React.Fragment key={r.ticker}>
                        <tr
                          className={`mo-row${isOpen ? ' open' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleRow(r.ticker)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(r.ticker); }
                          }}
                        >
                          <td className="num">{r.rank}</td>
                          <td>
                            <button
                              type="button"
                              className="mo-tk"
                              onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}
                            >
                              <b>{r.ticker}</b>
                              <span className="mo-name">{r.name || ''}</span>
                            </button>
                          </td>
                          <td className="num">{fmtPx(r.close)}</td>
                          <td className={`num ${Number(r.roc_3m) >= 0 ? 'up' : 'down'}`}>{fmtPct1(r.roc_3m)}</td>
                          <td className={`num ${Number(r.rs_vs_spx) >= 0 ? 'up' : 'down'}`}>{fmtPts(r.rs_vs_spx)}</td>
                          <td className="num">{fmtVolx(r.breakout_volx)}</td>
                          <td className="mo-chev"><span aria-hidden="true">›</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="mo-drill">
                            <td colSpan={7}>
                              <MomentumDrill row={r} asOf={asOf} filled={filled} navigate={navigate} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filled < MIN_FILL && (
              <div className="mo-foot">
                {filled} of {MAX_SLOTS} slots filled — the rest is cash.
              </div>
            )}
          </>
        )}

        <div className="mo-foot">
          Backtested 2020–2026 (portfolio simulation, 8-name floor): 18.2%/yr vs S&amp;P 14.8%, Sharpe 1.26,
          max drawdown −19.7%. Run on a survivor cohort — live results should run below the backtest.
          Details in Methodology.
        </div>
      </div>
    </section>
  );
}
