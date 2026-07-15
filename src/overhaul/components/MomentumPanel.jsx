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

/* Drawer body — the three Power Trend tests this name passed on the list's
   panel day, each with the REAL reading off the power_trend_list row. */
function MomentumDrill({ row, asOf, onOpenTicker }) {
  return (
    <div className="mo-drillbody">
      <div className="mo-drillhead">
        Passed all three Power Trend tests on the {fmtDay(asOf)} panel
      </div>
      <div className="mo-drillgrid">
        <div className="mo-drillcell">
          <div className="k">Trend &amp; strength</div>
          <div className="v num">{fmtPct1(row.roc_3m)} over 3 months</div>
          <div className="why">In the top 20% of the universe, with the close above its 10-, 21-, 50- and 200-day moving averages.</div>
        </div>
        <div className="mo-drillcell">
          <div className="k">Vs the S&amp;P 500</div>
          <div className="v num">{fmtPts(row.rs_vs_spx)}</div>
          <div className="why">Margin over the index&rsquo;s own 3-month return. The test requires at least 5 points.</div>
        </div>
        <div className="mo-drillcell">
          <div className="k">Breakout</div>
          <div className="v num">{fmtVolx(row.breakout_volx)} volume</div>
          <div className="why">Closed at a new 10-day high on more than 1.3&times; its 20-day average volume.</div>
        </div>
      </div>
      <div className="mo-drillfoot">
        <span>Rank {row.rank} · {fmtPx(row.close)} at the panel close · equal-weight slot in the Momentum sleeve</span>
        <button type="button" className="mo-drillbtn" onClick={onOpenTicker}>
          Open ticker page →
        </button>
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
                              <MomentumDrill
                                row={r}
                                asOf={asOf}
                                onOpenTicker={() => navigate(`/ticker/${r.ticker}`)}
                              />
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
