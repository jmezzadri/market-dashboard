/* MomentumPanel — Sleeve 2 (Momentum) panel on the Trading Scanner page.
   Two-sleeve build PR-3 (2026-07-14, MOMENTUM_SLEEVE_BUILD_SPEC.md §3).

   Renders three pieces on the shared 1560px stage:
     • guard status strip — INVESTED / IN CASH with the SPY close vs its
       200-day average and the last flip date (from momentum_guard, daily);
     • the ranked monthly list — rank, ticker, name, 12-month return,
       insider-badge dot (from momentum_list, latest rebalance_date);
     • "as of {rebalance date} · next re-rank {date}" line + freshness chips.

   Data notes (Senior Quant / Data Steward):
     • momentum_list.ret_12_1 is a FRACTION (p1/p0 − 1 in momentum_rules.py),
       so display multiplies by 100. Verified against prices_eod (AXTI
       2.09 → 103 ≈ +4,882% over the 12-1 window — real, not a units bug).
     • The latest list is ≤50 rows by the quintile clamp, and the guard read
       is limit-1 — both far under the PostgREST 1,000-row cap (LESSONS 4.18
       does not bite; no paging needed).
     • Chips key the manifest ids equity-momentum_list-monthly and
       market-momentum_guard-daily (pipeline_health short keys momentum_list /
       momentum_guard, seeded in PR-1).
     • guard flip date: most recent momentum_guard row with flipped = true;
       none on record yet → the strip says so plainly (em-dash rule: honest,
       never invented). */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import FreshnessChip from './FreshnessChip';

const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

// 12-month (12-1) return, stored as a fraction. Big winners are real
// (multi-thousand-percent moves happen in this list), so group thousands.
const fmtRet = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const pct = n * 100;
  const s = `${Math.abs(pct).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
  return pct < 0 ? `−${s}` : `+${s}`;
};

const fmtPx = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—';
};

export default function MomentumPanel() {
  const [rows, setRows] = useState(null);      // null = loading, [] = none
  const [guard, setGuard] = useState(null);
  const [flipDate, setFlipDate] = useState(undefined); // undefined = loading, null = none on record
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await supabase
          .from('momentum_list')
          .select('rebalance_date')
          .order('rebalance_date', { ascending: false })
          .limit(1);
        const rd = latest?.data?.[0]?.rebalance_date;
        if (rd) {
          const list = await supabase
            .from('momentum_list')
            .select('rank, ticker, name, ret_12_1, insider_badge, rebalance_date, next_rebalance_date')
            .eq('rebalance_date', rd)
            .order('rank', { ascending: true });
          if (!cancelled) setRows(list.data || []);
        } else if (!cancelled) setRows([]);

        const g = await supabase
          .from('momentum_guard')
          .select('as_of, spy_close, sma_200, invested')
          .order('as_of', { ascending: false })
          .limit(1);
        if (!cancelled) setGuard(g?.data?.[0] || null);

        const f = await supabase
          .from('momentum_guard')
          .select('as_of')
          .eq('flipped', true)
          .order('as_of', { ascending: false })
          .limit(1);
        if (!cancelled) setFlipDate(f?.data?.[0]?.as_of ?? null);
      } catch {
        if (!cancelled) { setRows([]); setGuard(null); setFlipDate(null); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const asOf = rows?.[0]?.rebalance_date || null;
  const nextRerank = rows?.[0]?.next_rebalance_date || null;
  const invested = guard ? !!guard.invested : null;

  // Split the list into two columns of equal length so 20–50 names don't
  // produce one very tall single table on desktop (classed grid; responsive
  // collapses it to one column).
  const [colA, colB] = useMemo(() => {
    const r = rows || [];
    const half = Math.ceil(r.length / 2);
    return [r.slice(0, half), r.slice(half)];
  }, [rows]);

  const Table = ({ data }) => (
    <div className="mo-scroll">
      <table className="mo-table">
        <thead>
          <tr>
            <th className="num-h">Rank</th>
            <th>Ticker</th>
            <th className="num-h">12-mo return</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.ticker}>
              <td className="num">{r.rank}</td>
              <td>
                <button type="button" className="mo-tk" onClick={() => navigate(`/ticker/${r.ticker}`)}>
                  <b>{r.ticker}</b>
                  {r.insider_badge && (
                    <span className="mo-badge" aria-label="At least one officer or director bought in the open market in the trailing 90 days" />
                  )}
                  <span className="mo-name">{r.name || ''}</span>
                </button>
              </td>
              <td className={`num ${Number(r.ret_12_1) >= 0 ? 'up' : 'down'}`}>{fmtRet(r.ret_12_1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="wrap mo-sec">
      <div className="mo-card">
        <div className="mo-head">
          <div>
            <div className="mo-sleeve">Sleeve 2</div>
            <h2 className="mo-title">Momentum Sleeve</h2>
            <div className="mo-rule">
              Owns the top-quintile 12-month performers among liquid US stocks (20–50 names, equal-weight),
              re-ranked monthly. A portfolio-level crash guard moves the sleeve to cash when the S&amp;P 500
              trades below its 200-day average.
            </div>
          </div>
          <div className="mo-asof">
            {asOf ? <>As of {fmtDay(asOf)}{nextRerank ? <> · next re-rank {fmtDay(nextRerank)}</> : null}</> : '—'}
            {' '}
            <FreshnessChip
              elementId="equity-momentum_list-monthly"
              variant="dot"
              fallback={{ asOfIso: asOf, calendar: 'nyse-trading-day' }}
            />
          </div>
        </div>

        {/* Crash-guard status strip */}
        <div className={`mo-guard ${invested === null ? '' : invested ? 'on' : 'off'}`}>
          <span className="mo-guard-state">
            {invested === null ? '—' : invested ? 'Invested' : 'In cash'}
          </span>
          <span className="mo-guard-detail">
            {guard
              ? <>S&amp;P 500 (SPY) {fmtPx(guard.spy_close)} vs 200-day average {fmtPx(guard.sma_200)} · as of {fmtDay(guard.as_of)}</>
              : 'Guard status unavailable'}
          </span>
          <span className="mo-guard-flip">
            {flipDate === undefined ? '' : flipDate ? `Last flip ${fmtDay(flipDate)}` : 'No flip on record'}
          </span>
          <FreshnessChip
            elementId="market-momentum_guard-daily"
            variant="dot"
            fallback={{ asOfIso: guard?.as_of, calendar: 'nyse-trading-day' }}
          />
        </div>

        {rows === null ? (
          <div className="mo-loading">Loading the momentum list…</div>
        ) : rows.length === 0 ? (
          <div className="mo-loading">No momentum list published yet.</div>
        ) : (
          <>
            <div className="mo-grid">
              <Table data={colA} />
              <Table data={colB} />
            </div>
            <div className="mo-foot">
              <span className="mo-badge" /> = at least one officer or director bought in the open market in the trailing 90 days (informational only — it does not affect this sleeve's selection).
            </div>
          </>
        )}
      </div>
    </section>
  );
}
