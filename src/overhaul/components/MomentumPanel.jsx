/* MomentumPanel — Sleeve 2 (Momentum) panel on the Trading Scanner page.
   Power Trend rewrite (2026-07-15): the sleeve's engine is now the Power
   Trend signal — up to 15 names, monthly refresh, 8-name diversification
   floor. Replaces the retired 12-1 quintile list and its crash-guard strip.

   Renders on the shared 1560px stage:
     • header — kicker / title / signal subtitle + the three-test rule copy;
     • the ranked monthly list — rank, ticker+name, price, 3-month return,
       margin over the S&P 500, breakout volume (from power_trend_list,
       latest rebalance_date);
     • "List of {rebalance date} · next refresh {date}" line + freshness chip;
     • the backtest footnote with the survivorship caveat.

   Data notes (Senior Quant / Data Steward):
     • power_trend_list.roc_3m is a PERCENT (145.0 = +145%), rs_vs_spx is in
       points (135.4 = 135.4 points over the index), breakout_volx is a plain
       multiple (1.35 = 1.35× the 20-day average volume). No unit conversion.
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

export default function MomentumPanel() {
  const [rows, setRows] = useState(null);      // null = loading, [] = none
  const [meta, setMeta] = useState(null);      // { asOf, next, allCash }
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

  return (
    <section className="wrap mo-sec">
      <div className="mo-card">
        <div className="mo-head">
          <div>
            <div className="mo-sleeve">Sleeve 2</div>
            <h2 className="mo-title">Momentum Sleeve</h2>
            <div className="mo-rule">
              Power Trend signal — strong uptrends that just broke out on volume, outrunning the S&amp;P 500.
            </div>
            <div className="mo-rule">
              Owns up to 15 liquid US names, equal-weight, refreshed monthly. Three tests, all on daily
              closes: price above its 10-, 21-, 50- and 200-day moving averages with a 3-month return in
              the top 20% of the universe; a 3-month return at least 5 points above the S&amp;P 500&rsquo;s; and a
              close at a new 10-day high on volume more than 1.3&times; its 20-day average. Fewer than 8
              qualifiers &rarr; the unfilled slots stay in cash.
            </div>
          </div>
          <div className="mo-asof">
            {asOf ? <>List of {fmtDay(asOf)}{nextRefresh ? <> · next refresh {fmtDay(nextRefresh)}</> : null}</> : '—'}
            {' '}
            <FreshnessChip
              elementId="equity-power_trend_list-monthly"
              variant="dot"
              fallback={{ asOfIso: asOf, calendar: 'nyse-trading-day' }}
            />
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
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker}>
                      <td className="num">{r.rank}</td>
                      <td>
                        <button type="button" className="mo-tk" onClick={() => navigate(`/ticker/${r.ticker}`)}>
                          <b>{r.ticker}</b>
                          <span className="mo-name">{r.name || ''}</span>
                        </button>
                      </td>
                      <td className="num">{fmtPx(r.close)}</td>
                      <td className={`num ${Number(r.roc_3m) >= 0 ? 'up' : 'down'}`}>{fmtPct1(r.roc_3m)}</td>
                      <td className={`num ${Number(r.rs_vs_spx) >= 0 ? 'up' : 'down'}`}>{fmtPts(r.rs_vs_spx)}</td>
                      <td className="num">{fmtVolx(r.breakout_volx)}</td>
                    </tr>
                  ))}
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
