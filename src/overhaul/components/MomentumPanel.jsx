/* MomentumPanel — the Power Trend Momentum Scanner on the Trading Scanner
   page. An idea feed — not auto-traded (strategy reset 2026-08: the paper
   book trades Conviction Events only).

   Scanner-page consistency rebuild (2026-07-16, Joe): the panel now renders
   on the EXACT same tile anatomy as the Insider Conviction and RSI
   Divergence scanners — .sc-tablecard shell, .sc-kicker / .sc-paneltitle /
   .sc-rule header, .sc-scanmeta chip line (chip first, same spot), and the
   shared .sc-inset table surface with the shared .sc-table styling (row
   hover, 16px gold tickers, green/red numerics). Sleeve language removed
   from the page per Joe 2026-07-16 — this is a scanner, full stop. The
   backtest stats footnote is gone; the meta line links to Methodology.

   Data (Senior Quant / Data Steward):
     • power_trend_list (monthly, migration 081 scan — server-side math):
       rank, ticker, name, close (at rebalance), roc_3m (PERCENT,
       145.0 = +145%), rs_vs_spx (points over the index), breakout_volx
       (plain multiple), adv_usd (DOLLARS).
     • prices_eod (daily, market-prices_eod-daily) enriches DISPLAY ONLY:
       last close, 1-day move, and return since the list date
       (last_close / rebalance close − 1). Simple arithmetic on stored
       fields — no scoring, no engine read. If the price read fails those
       three columns render em-dashes (LESSON 4.4); the list still renders.
     • CASH sentinel row (ticker='CASH', rank=0) = zero-signal month.
     • ≤15 rows + ~100 price rows — far under the PostgREST 1,000 cap.
     • Chip keys equity-power_trend_list-monthly (monthly SLA; the price
       columns' as-of date is printed in the meta line). */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import FreshnessChip from './FreshnessChip';
import useLseIvDaily from '../../hooks/useLseIvDaily';

const MAX_SLOTS = 15;

const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

// Signed percent, 1 decimal, thousands grouped — multi-hundred-percent
// movers are real in this list. Input is already in PERCENT units.
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

// Average dollars traded per day (adv_usd is in DOLLARS).
const fmtAdv = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}B`;
  return `$${Math.round(n / 1e6).toLocaleString('en-US')}M`;
};

const cls = (v) => (Number(v) >= 0 ? 'up' : 'down');

export default function MomentumPanel() {
  const [rows, setRows] = useState(null);      // null = loading, [] = none
  const [meta, setMeta] = useState(null);      // { asOf, next, allCash }
  const [px, setPx] = useState({ map: null, asOf: null }); // ticker -> {last, prev}
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
          .select('rank, ticker, name, roc_3m, rs_vs_spx, breakout_volx, adv_usd, close, rebalance_date, next_rebalance_date')
          .eq('rebalance_date', rd)
          .order('rank', { ascending: true });
        if (cancelled) return;
        const all = list.data || [];
        const allCash = all.length > 0 && all.every((r) => r.ticker === 'CASH' && Number(r.rank) === 0);
        const names = allCash ? [] : all.filter((r) => r.ticker !== 'CASH');
        setRows(names);
        setMeta({ asOf: rd, next: all[0]?.next_rebalance_date || null, allCash });

        // Display enrichment: latest two closes per name from prices_eod
        // (the ticker page's canonical price source). Failure here only
        // blanks the three price columns — never the list.
        if (names.length) {
          try {
            const since = new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10);
            const bars = await supabase
              .from('prices_eod')
              .select('ticker, trade_date, close')
              .in('ticker', names.map((r) => r.ticker))
              .gte('trade_date', since)
              .order('trade_date', { ascending: false });
            if (cancelled) return;
            const map = {};
            let asOf = null;
            (bars.data || []).forEach((b) => {
              const m = map[b.ticker] || (map[b.ticker] = {});
              if (m.last == null) {
                m.last = Number(b.close);
                if (!asOf || b.trade_date > asOf) asOf = b.trade_date;
              } else if (m.prev == null) {
                m.prev = Number(b.close);
              }
            });
            setPx({ map, asOf });
          } catch { /* price columns render em-dashes */ }
        }
      } catch {
        if (!cancelled) { setRows([]); setMeta(null); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { byTicker: ivDaily } = useLseIvDaily(); // Vol rank (LSE implied vol)
  const asOf = meta?.asOf || null;
  const nextRefresh = meta?.next || null;
  const allCash = !!meta?.allCash;
  const filled = rows ? rows.length : 0;

  return (
    <section className="wrap mo-sec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-kicker">Scanner · Monthly list</div>
            <h2 className="sc-paneltitle">Power Trend Momentum Scanner</h2>
            <div className="sc-rule">
              Strong uptrends that broke out on volume and are outrunning the S&amp;P 500. Three
              tests, all on daily closes: price above its 10-, 21-, 50- and 200-day moving averages
              with a 3-month return in the top 20% of the universe; a 3-month return at least 5 points
              above the S&amp;P 500&rsquo;s; and a close at a new 10-day high on volume more than 1.3&times; its
              20-day average at some point in the trailing month.
            </div>
            <div className="sc-rule">
              Up to {MAX_SLOTS} liquid US names, at most 3 per industry group, refreshed monthly —
              the refresh cadence that performed best in backtesting (daily and weekly refreshes were
              tested and did worse). A name that closes below all four moving averages drops out the
              same day.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="equity-power_trend_list-monthly"
                variant="dot"
                fallback={{ asOfIso: asOf, calendar: 'nyse-trading-day' }}
              />
              <span>
                {asOf ? <>List of {fmtDay(asOf)}{nextRefresh ? <> · next refresh {fmtDay(nextRefresh)}</> : null}</> : '—'}
                {px.asOf ? <> · prices as of {fmtDay(px.asOf)} close</> : null}
                {' · idea feed — not auto-traded'}
              </span>
              <button type="button" className="sc-metalink" onClick={() => navigate('/methodology#scanner')}>
                Backtest &amp; methodology →
              </button>
            </div>
          </div>
        </div>

        {rows === null ? (
          <div className="sc-loading">Loading the Power Trend list…</div>
        ) : allCash ? (
          <div className="sc-loading">All cash this month — no names passed all three tests.</div>
        ) : rows.length === 0 ? (
          <div className="sc-loading">No Power Trend list published yet.</div>
        ) : (
          <>
            <div className="sc-inset">
              <div className="sc-insetscroll">
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th className="num-h rank-h">Rank</th>
                      <th>Ticker</th>
                      <th className="num-h">Last close</th>
                      <th className="num-h">1-day</th>
                      <th className="num-h">Since list</th>
                      <th className="num-h">3-mo return</th>
                      <th className="num-h">vs S&amp;P 500</th>
                      <th className="num-h">Breakout volume</th>
                      <th className="num-h">Vol rank</th>
                      <th className="num-h">Avg $/day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const p = px.map?.[r.ticker] || {};
                      const day = Number.isFinite(p.last) && Number.isFinite(p.prev) && p.prev !== 0
                        ? ((p.last / p.prev) - 1) * 100 : null;
                      const sinceList = Number.isFinite(p.last) && Number(r.close) > 0
                        ? ((p.last / Number(r.close)) - 1) * 100 : null;
                      return (
                        <tr key={r.ticker} className="sc-trow" onClick={() => navigate(`/ticker/${r.ticker}`)}>
                          <td className="num rank">{r.rank}</td>
                          <td>
                            <button type="button" className="sc-tk" onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}>
                              <b>{r.ticker}</b>
                              <span className="nm">{r.name || ''}</span>
                            </button>
                          </td>
                          <td className="num">{Number.isFinite(p.last) ? fmtPx(p.last) : '—'}</td>
                          <td className={`num ${day == null ? '' : cls(day)}`}>{day == null ? '—' : fmtPct1(day)}</td>
                          <td className={`num ${sinceList == null ? '' : cls(sinceList)}`}>{sinceList == null ? '—' : fmtPct1(sinceList)}</td>
                          <td className={`num ${cls(r.roc_3m)}`}>{fmtPct1(r.roc_3m)}</td>
                          <td className={`num ${cls(r.rs_vs_spx)}`}>{fmtPts(r.rs_vs_spx)}</td>
                          <td className="num">{fmtVolx(r.breakout_volx)}</td>
                          {/* Options-implied volatility rank (LSE): percentile
                              of ~30-day ATM implied vol across today's covered
                              scan names. Em-dash = no listed options on the
                              feed (accepted coverage gap, Joe 2026-07-27). */}
                          <td className="num">{ivDaily[r.ticker]?.volRank != null ? Math.round(ivDaily[r.ticker].volRank) : '—'}</td>
                          <td className="num">{fmtAdv(r.adv_usd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {filled < MAX_SLOTS && (
              <div className="sc-tilefoot">
                {filled} name{filled === 1 ? '' : 's'} passed all three tests this month — the list holds up to {MAX_SLOTS}.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
