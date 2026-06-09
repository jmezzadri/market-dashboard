import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import useIndicators from '../lib/useIndicators';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import { getUpcoming, fmtEventDate } from '../lib/econCalendar';
import '../home-editorial.css';

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Financial Conditions & Economy'];
const DOMAIN_SHORT = { 'Financial Conditions & Economy': 'Fin Cond & Economy' };
const MECH_LABEL = { valuation: 'valuations', credit: 'credit', funding: 'funding', growth: 'growth', liquidity_policy: 'liquidity & policy', positioning_breadth: 'positioning & breadth' };
const SIGNAL_LABEL = { insider_pts: 'insider buying', sma200_pts: 'its 200-day trend', rsi_pts: 'momentum (RSI)', options_pts: 'options flow', dark_pool_pts: 'dark-pool accumulation' };

/* ── value / delta helpers ─────────────────────────────────────────────── */
function valueDaysAgo(points, days) {
  if (!points || points.length < 2) return null;
  const lastT = Date.parse(points[points.length - 1][0] + 'T00:00:00Z');
  const target = lastT - days * 86400000;
  for (let i = points.length - 1; i >= 0; i--) {
    if (Date.parse(points[i][0] + 'T00:00:00Z') <= target) return points[i][1];
  }
  return points[0][1];
}
function deltas(ind) {
  const p = ind.points || [];
  if (p.length < 2) return { recent: null, wow: null };
  const last = p[p.length - 1][1];
  return { recent: last - p[p.length - 2][1], wow: (() => { const w = valueDaysAgo(p, 7); return w == null ? null : last - w; })() };
}
function freqLabel(freq) { return freq === 'W' ? 'w/w' : freq === 'M' ? 'm/m' : freq === 'Q' ? 'q/q' : 'd/d'; }
function fmtVal(ind) {
  const v = ind.value; if (v == null) return '—';
  const d = Number.isFinite(ind.decimals) ? ind.decimals : 2;
  const u = ind.unit || '';
  if (u === '%') return `${v.toFixed(d)}%`;
  if (!u || u === 'index' || u === 'ratio' || u === 'z-score') return v.toFixed(d);
  return `${v.toFixed(d)} ${u}`;
}
function fmtDelta(x, ind) {
  if (x == null) return null;
  const d = Number.isFinite(ind.decimals) ? ind.decimals : 2;
  const s = `${x > 0 ? '+' : ''}${x.toFixed(Math.min(d, 2))}`;
  return { text: s, cls: Math.abs(x) < Math.pow(10, -(d + 1)) ? 'he-nu' : x > 0 ? 'he-up' : 'he-dn' };
}
function stanceFor(inds) {
  const ext = inds.filter((i) => i.state === 'extreme').length;
  const elev = inds.filter((i) => i.state === 'elevated').length;
  if (ext > 0) return { label: 'Stretched', cls: 'extreme', stretched: ext + elev };
  if (elev > 0) return { label: 'Elevated', cls: 'elev', stretched: elev };
  return { label: 'Calm', cls: 'calm', stretched: 0 };
}
function pickHeadline(inds) {
  if (!inds.length) return null;
  const score = (i) => (i.state === 'extreme' ? 200 : i.state === 'elevated' ? 100 : 0) + (i.pct != null ? Math.abs(i.pct - 50) : 0);
  return inds.slice().sort((a, b) => score(b) - score(a))[0];
}
function topDriver(s) {
  const c = s.contributions || {}; let k = null, mv = -1;
  Object.entries(c).forEach(([kk, vv]) => { const a = Math.abs(Number(vv) || 0); if (a > mv) { mv = a; k = kk; } });
  return MECH_LABEL[k] || k || 'the engine score';
}
function topSignal(r) {
  const f = { insider_pts: r.insider_pts, sma200_pts: r.sma200_pts, rsi_pts: r.rsi_pts, options_pts: r.options_pts, dark_pool_pts: r.dark_pool_pts };
  let k = null, mv = -Infinity;
  Object.entries(f).forEach(([kk, vv]) => { const n = Number(vv) || 0; if (n > mv) { mv = n; k = kk; } });
  return SIGNAL_LABEL[k] || 'multiple signals';
}

/* ── positioning generators (fully derived from live engine state) ─────── */
function macroPosition(regime, alloc, buckets) {
  if (!regime || regime.loading) return 'Reading the tape…';
  const zone = regime.stressZone || 'Neutral';
  const eq = alloc ? Math.round((alloc.equity_pct || 0) * 100) : null;
  const def = alloc ? Math.round((alloc.defensive_pct || 0) * 100) : null;
  let worst = null, wv = -1;
  buckets.forEach((b) => { const n = b.inds.filter((i) => i.state === 'extreme').length * 2 + b.inds.filter((i) => i.state === 'elevated').length; if (n > wv) { wv = n; worst = b; } });
  const lean = zone === 'Risk On' ? 'lean risk-on' : zone === 'Risk Off' ? 'cut risk' : 'stay balanced and watch the data';
  let s = `The engine reads ${regime.regimeLabel || zone}`;
  if (eq != null) s += ` — ${eq}% equity, ${def}% defensive`;
  s += `. The signal is to ${lean}`;
  if (worst && wv > 0) s += `; ${(DOMAIN_SHORT[worst.name] || worst.name).toLowerCase()} is the bucket showing the most stress right now`;
  return s + '.';
}
function tiltPosition(regime, alloc) {
  if (!alloc || !regime) return '';
  const eq = Math.round((alloc.equity_pct || 0) * 100), def = Math.round((alloc.defensive_pct || 0) * 100);
  const zone = regime.regimeLabel || regime.stressZone || '\u2014';
  const sleeve = regime.sleeveMix ? 'firing' : 'on standby';
  return `The engine reads ${zone} \u2014 ${eq}% equity, ${def}% defensive (defensive sleeve ${sleeve}). The moves below change which sectors you own, not how much risk you carry.`;
}
function scannerPosition(bandCounts, top) {
  if (!bandCounts) return '';
  const names = top.slice(0, 3).map((r) => r.ticker).filter(Boolean).join(', ');
  return `${bandCounts.total} names cleared the score gate${bandCounts.score5 ? `, ${bandCounts.score5} at top conviction` : ''}. The strongest setups right now: ${names || '—'}. Stage entries around the releases above — these are event-gated, not buy-and-holds.`;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { active, loading: indLoading } = useIndicators();
  const { allocation } = useAllocation();
  const regime = useEngineRegime();
  const { rows: scanRows, bandCounts, scanDate } = useTradingOppsTop(20);

  const todayISO = new Date().toISOString().slice(0, 10);
  const calendar = useMemo(() => getUpcoming(todayISO, 5), [todayISO]);

  const buckets = useMemo(() => {
    const map = {}; DOMAINS.forEach((d) => { map[d] = []; });
    (active || []).forEach((i) => { const d = DOMAINS.includes(i.domain) ? i.domain : 'Financial Conditions & Economy'; map[d].push(i); });
    return DOMAINS.map((name) => ({ name, inds: map[name] }));
  }, [active]);

  const tiltMoves = useMemo(() => {
    const s = (allocation?.sectors || []).slice().sort((a, b) => (b.vs_spy_pp ?? 0) - (a.vs_spy_pp ?? 0));
    const ow = s.filter((x) => (x.vs_spy_pp ?? 0) > 0).slice(0, 2);
    const uw = s.filter((x) => (x.vs_spy_pp ?? 0) < 0).slice(-2).reverse();
    return [...ow, ...uw];
  }, [allocation]);

  const topBuys = useMemo(() => (scanRows || []).filter((r) => (r.band ?? 0) >= 4).slice(0, 3), [scanRows]);

  const stretchedTotal = (active || []).filter((i) => i.state === 'extreme' || i.state === 'elevated').length;

  return (
    <div className="mt-pagebody mt-fade">
      {/* ── Week-ahead calendar ── */}
      <section className="he-week" aria-label="Economic calendar — week ahead">
        <div className="he-weekhd"><span>What's coming · the releases the tape is trading around</span></div>
        <div className="he-cal">
          {calendar.map((e) => (
            <div key={e.date + e.name} className={`he-ev${e.today ? ' today' : ''}`}>
              <div className="he-ev-dt">{e.today ? 'TODAY · ' : ''}{fmtEventDate(e.date)} · {e.time}</div>
              <div className="he-ev-nm">{e.name}</div>
              <div className="he-ev-detail">{e.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Macro Overview ── */}
      <section className="mt-pagesection he-section">
        <div className="mt-eyebrow">Macro Overview · today's read</div>
        <h1 className="mt-h1">{regime.loading ? 'Reading the tape' : <>{regime.stressZone || 'Neutral'} — <i>{(regime.yieldRegime || 'neutral').toLowerCase()}</i>.</>}</h1>
        <p className="mt-deck">
          A read across the six things we watch — rates, credit, equities, commodities, FX, and the economy — each ranked against its own three-year history. {stretchedTotal} of {(active || []).length} indicators are stretched right now.
        </p>

        <div className="he-lanehd"><span>What's changed · across the six buckets</span></div>
        <div className="he-buckets">
          {indLoading ? <div className="mt-deck">Loading indicators…</div> : buckets.map((b) => {
            const stance = stanceFor(b.inds);
            const head = pickHeadline(b.inds);
            const dd = head ? deltas(head) : { recent: null, wow: null };
            const dRec = head ? fmtDelta(dd.recent, head) : null;
            const dWow = head ? fmtDelta(dd.wow, head) : null;
            return (
              <button key={b.name} className="he-bk" onClick={() => navigate('/macro')}>
                <div className="he-bk-top">
                  <span className="he-bk-nm">{DOMAIN_SHORT[b.name] || b.name}</span>
                  <span className={`he-chip ${stance.cls}`}><span className="he-dot" />{stance.label}</span>
                </div>
                {head && (
                  <>
                    <div className="he-met num">
                      <span className="he-lv">{fmtVal(head)}</span>
                      {dRec && <span className={`he-dl ${dRec.cls}`}>{dRec.text} {freqLabel(head.freq)}</span>}
                      {dWow && head.freq === 'D' && <span className={`he-dl ${dWow.cls}`}>{dWow.text} w/w</span>}
                    </div>
                    <div className="he-rd"><b>{head.name}</b> — {head.state === 'calm' ? 'in its normal range' : `${head.state} vs its 3-year range`}.</div>
                  </>
                )}
                <div className="he-tr"><b>{stance.stretched}</b> of {b.inds.length} indicators stretched · <FreshnessChip elementId={head?.manifestId} variant="dot" /></div>
              </button>
            );
          })}
        </div>

        <div className="he-sowhat">
          <div className="he-sowhat-lbl"><span>How to position</span></div>
          <p>{macroPosition(regime, allocation, buckets)}</p>
        </div>
      </section>

      {/* ── Asset Tilt ── */}
      <section className="mt-pagesection he-section">
        <div className="mt-eyebrow">Asset Tilt · rebalance</div>
        <h1 className="mt-h1">Where the engine is <i>leaning the book</i>.</h1>
        <p className="mt-deck">The biggest overweights and underweights versus the benchmark, and the mechanism driving each. <FreshnessChip elementId="v10-allocation-daily" fallback={{ asOfIso: allocation?.as_of, calendar: 'us-business-day' }} variant="label" /></p>

        <div className="he-lanehd"><span>What's changed · this morning's moves</span></div>
        <div className="he-reb">
          {tiltMoves.map((s) => {
            const pp = s.vs_spy_pp ?? 0; const up = pp > 0;
            return (
              <button key={s.sector} className="he-rrow" onClick={() => navigate('/tilt')}>
                <span className={`he-ar ${up ? 'he-up' : 'he-dn'}`}>{up ? '▲' : '▼'}</span>
                <span className="he-rnm">{s.sector}<small>{s.rating === 'OW' ? 'Overweight' : s.rating === 'UW' ? 'Underweight' : 'Neutral'} · {(s.etfs && s.etfs[0]) || ''}</small></span>
                <span className="he-wy">Driven mostly by {topDriver(s)}.</span>
                <span className={`he-pp ${up ? 'he-up' : 'he-dn'}`}>{up ? '+' : ''}{pp.toFixed(1)}pp</span>
              </button>
            );
          })}
        </div>

        <div className="he-sowhat">
          <div className="he-sowhat-lbl"><span>How to position</span></div>
          <p>{tiltPosition(regime, allocation)}</p>
        </div>
      </section>

      {/* ── Equity Scanner ── */}
      <section className="mt-pagesection he-section">
        <div className="mt-eyebrow">Equity Scanner · {bandCounts ? bandCounts.total : ''} long alerts</div>
        <h1 className="mt-h1">The names this setup <i>points at</i>.</h1>
        <p className="mt-deck">Top-conviction longs from the five-signal scan, with the signal driving each. <FreshnessChip elementId="equity-latest_scan_data-daily" fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }} variant="label" /></p>

        <div className="he-lanehd"><span>What's changed · today's top conviction</span></div>
        {topBuys.length === 0 ? <div className="mt-deck">No names cleared the conviction gate today.</div> : topBuys.map((r) => {
          const chg = (r.score != null && r.score_1m != null) ? r.score - r.score_1m : null;
          return (
            <button key={r.ticker} className="he-buy" onClick={() => navigate(`/ticker/${r.ticker}`)}>
              <div className="he-buy-h">
                <span className="he-tk">{r.ticker}</span>
                <span className={`he-conv ${r.band >= 5 ? 'high' : 'med'}`}>{r.band >= 5 ? 'High' : 'Medium'}</span>
                <span className="he-sc">Score <b>{r.score != null ? r.score.toFixed(1) : '—'}</b>{chg != null ? ` · ${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : ''}${chg.toFixed(1)} vs 1mo` : ''}</span>
              </div>
              <div className="he-wy"><b>Driver:</b> {r.so_what ? r.so_what : `Led by ${topSignal(r)}.`}{r.name ? ` (${r.name})` : ''}</div>
            </button>
          );
        })}

        <div className="he-sowhat">
          <div className="he-sowhat-lbl"><span>How to position</span></div>
          <p>{scannerPosition(bandCounts, topBuys)}</p>
        </div>
      </section>
    </div>
  );
}
