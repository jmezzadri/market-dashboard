import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import { useSession } from '../../auth/useSession';

/**
 * HomePage v2 — cutover.
 *
 * Live JSON sources:
 *   /cycle_board_snapshot.json — for Macro Overview mini-card (composite + 6 mech scores)
 *   /v10_allocation.json       — for Asset Tilt mini-card (equity/def/lev + sector OW/UW)
 *   /latest_scan_data.json     — for Daily Opp Scan tile + headlines feed
 *
 * No synthetic data. Every value reads from the JSON; '—' if missing.
 */

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US');
}
function scoreBand(score) {
  if (score == null) return { id: 'unknown', cls: 'placeholder', label: '—' };
  if (score < 25) return { id: 'r-on', cls: 'r-on', label: 'Risk On' };
  if (score < 50) return { id: 'r-neu', cls: 'r-neu', label: 'Neutral' };
  if (score < 75) return { id: 'r-cau', cls: 'r-cau', label: 'Cautionary' };
  return { id: 'r-off', cls: 'r-off', label: 'Risk Off' };
}

function useHomeData() {
  const [snap, setSnap] = useState(null);
  const [v10, setV10] = useState(null);
  const [scan, setScan] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([
      fetch('/cycle_board_snapshot.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/v10_allocation.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/latest_scan_data.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
    ]).then(([s, v, sc]) => { setSnap(s); setV10(v); setScan(sc); }).catch((e) => setErr(e?.message));
  }, []);
  return { snap, v10, scan, err };
}

function navTo(hash) {
  if (typeof window !== 'undefined') {
    window.location.hash = hash;
  }
}

export default function HomePage() {
  // v2 spec PR 3.1 — Home macro tile shows 3 v2 headlines @ 6m alongside the
  // legacy composite + 6-mechanism mini bar (legacy stays during transition).
  const [cycleV2, setCycleV2] = useState(null);
  const [indHist, setIndHist] = useState(null);
  useEffect(() => {
    fetch("/cycle_v2.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("cycle_v2.json HTTP " + r.status)))
      .then(setCycleV2)
      .catch((err) => { console.warn("[Home] cycle_v2.json fetch failed", err); });
    fetch("/indicator_history.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : null)
      .then(setIndHist)
      .catch((err) => { console.warn("[Home] indicator_history.json fetch failed", err); });
  }, []);

  // ─── Signal Intelligence regime computation (mirrors MacroOverviewPage rule book) ───
  const si = useMemo(() => {
    if (!indHist || !cycleV2) return null;
    const TRIGGER_PCTILE = 85, LATE_CYCLE = 80;
    const trailing5ySorted = (points) => {
      if (!points || !points.length) return [];
      const last = new Date(points[points.length - 1][0]);
      const cutoff = new Date(last); cutoff.setFullYear(last.getFullYear() - 5);
      return points.filter(([d]) => new Date(d) >= cutoff).map(([, v]) => v).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
    };
    const valAtPctile = (sorted, pct) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))] : null;
    const pctileOf = (v, sorted) => {
      if (!sorted.length || v == null) return null;
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      return Math.round((lo / sorted.length) * 100);
    };
    const stageOfRun = (points, mark) => {
      if (!points || !points.length || mark == null) return 0;
      let consec = 0;
      // last 24 weeks daily — approximate consecutive-week-above by collapsing to weekly Friday closes
      const byWeek = {};
      for (const [ds, val] of points) {
        if (val == null || isNaN(val)) continue;
        const d = new Date(ds), w = new Date(d); w.setDate(d.getDate() - d.getDay());
        byWeek[w.toISOString().slice(0, 10)] = val;
      }
      const weeks = Object.keys(byWeek).sort().slice(-24);
      for (let i = weeks.length - 1; i >= 0; i--) {
        if (byWeek[weeks[i]] >= mark) consec++; else break;
      }
      if (consec === 0) return 0;
      if (consec === 1) return 1;
      if (consec <= 3) return 2;
      return 3;
    };
    const buildInd = (key) => {
      const r = indHist[key];
      if (!r || !r.points || !r.points.length) return null;
      const sorted = trailing5ySorted(r.points);
      const mark = valAtPctile(sorted, TRIGGER_PCTILE);
      const cur = r.points[r.points.length - 1];
      return { pctile: pctileOf(cur[1], sorted), currentValue: cur[1], mark, stage: stageOfRun(r.points, mark) };
    };
    const vix = buildInd('vix'), mv = buildInd('move'), cp = buildInd('cpff');
    const cycle = cycleV2.headlines?.cycle_value?.scores_by_horizon?.['6m'];
    const stages = [vix?.stage || 0, mv?.stage || 0, cp?.stage || 0];
    const sustained = stages.filter(s => s >= 2).length;
    const crossed = stages.filter(s => s === 1).length;
    const latecycle = cycle != null && cycle >= LATE_CYCLE;
    const label = (sustained >= 1 && latecycle) ? 'Risk Off' : sustained >= 1 ? 'Cautionary' : crossed >= 1 ? 'Neutral' : 'Risk On';
    return { vix, move: mv, cpff: cp, cycle, regime: { label } };
  }, [indHist, cycleV2]);

  const regimeShortDesc = {
    'Risk On':    'No volatility triggers. Stay fully invested.',
    'Neutral':    'One trigger crossed — possible head fake. Hold.',
    'Cautionary': 'One or more triggers sustained. Trim risk.',
    'Risk Off':   'Sustained at late-cycle. Defensive stance.',
  };
  const { snap, v10, scan, err } = useHomeData();
  const { user, loading: authLoading } = useSession();
  const greetingName = user
    ? (user.user_metadata?.first_name
       || user.user_metadata?.full_name?.split(' ')[0]
       || (user.email ? user.email.split('@')[0] : '')
       || 'there')
    : null;

  // Composite avg from snapshot mechanisms
  const mechs = snap?.mechanisms || [];
  const compAvg = mechs.length
    ? Math.round(mechs.reduce((a, m) => a + (m.score || 0), 0) / mechs.length)
    : null;
  const compBand = scoreBand(compAvg);

  // Asset Tilt summary from v10
  const eqPct = v10?.equity_pct != null ? Math.round(v10.equity_pct * 100) : null;
  const defPct = v10?.defensive_pct != null ? Math.round(v10.defensive_pct * 100) : null;
  const lev = v10?.leverage != null ? v10.leverage.toFixed(2) : '—';
  const stance = v10?.page_stance || '—';
  const sectors = v10?.sectors || [];
  const ow = sectors.filter((s) => s.rating === 'OW').slice(0, 3);
  const uw = sectors.filter((s) => s.rating === 'UW').slice(0, 3);

  // Today's stance copy from cycle board
  const stanceLabel = compAvg != null
    ? (compAvg < 25 ? 'Risk On' : compAvg < 50 ? 'Neutral' : compAvg < 75 ? 'Cautionary' : 'Risk Off')
    : 'Loading';

  // Top scan picks — read from the actual JSON shape:
  //   scan.buy_opportunities (>=80 score)
  //   scan.watch_items       (70-79 score)
  //   scan.sell_alerts       (low scores)
  const buys = useMemo(() => {
    const list = Array.isArray(scan?.buy_opportunities) ? scan.buy_opportunities
               : Array.isArray(scan?.signals?.composite_picks) ? scan.signals.composite_picks.filter(p => (p.composite_score||p.score||0)>=80)
               : [];
    return list.slice(0, 5);
  }, [scan]);
  const nears = useMemo(() => {
    const list = Array.isArray(scan?.watch_items) ? scan.watch_items
               : Array.isArray(scan?.signals?.composite_picks) ? scan.signals.composite_picks.filter(p => { const s=p.composite_score||p.score||0; return s>=70 && s<80; })
               : [];
    return list.slice(0, 3);
  }, [scan]);

  // Headlines
  const headlines = useMemo(() => {
    const block = scan?.signals?.market_news || {};
    const items = (Array.isArray(block.items) && block.items.length)
      ? block.items
      : (block.zerohedge_public || []);
    return items.slice(0, 7);
  }, [scan]);

  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">
              {[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}
            </g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <div>
              <div className="t-eyebrow accent" style={{ marginBottom: 14 }}>
                {authLoading ? '' : (user ? 'Welcome back' : 'MacroTilt')}
              </div>
              <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>
                {authLoading ? '—' : (user ? `${greetingName}.` : 'Today.')}
              </h1>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingBottom: 6, textAlign: 'right' }}>
              <span className="t-eyebrow">Today's stance</span>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:64, lineHeight:.95, letterSpacing:'-.02em', color:'var(--warn)', fontFeatureSettings:'"tnum"' }}>
                {compAvg != null ? <CountUp to={compAvg} /> : '—'}
                {compAvg != null && <span style={{ fontSize: 24, color: 'var(--ink-2)', marginLeft: 2 }}>/100</span>}
              </span>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:18, color:'var(--ink-0)' }}>{stanceLabel}</span>
              <FreshnessChip elementId="cycle_board" fallback={snap?.as_of} />
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '32px 0 0' }} className="v2-home-grid">

          {/* CARD 1 · MACRO OVERVIEW — Signal Intelligence regime read */}
          <article className="v2-tile" onClick={() => navTo('overview')} tabIndex={0}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span className="t-eyebrow accent">01 · Macro Overview</span>
              <FreshnessChip elementId="cycle_board" fallback={snap?.as_of} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4 }}>
                Current regime
              </div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontStyle: 'italic', fontWeight: 400, fontSize: 40, lineHeight: 1.05, color: 'var(--accent)', letterSpacing: '-0.005em' }}>
                {si?.regime?.label || 'Loading…'}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-1)', marginTop: 6, lineHeight: 1.5 }}>
                {si?.regime?.label ? regimeShortDesc[si.regime.label] : ''}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, paddingTop: 16, borderTop: '1px solid var(--line-0)' }}>
              {[
                { name: 'Equity Vol', sub: 'VIX', d: si?.vix },
                { name: 'Bond Vol', sub: 'MOVE', d: si?.move },
                { name: 'Funding', sub: 'CPFF', d: si?.cpff },
                { name: 'Cycle', sub: 'POSITION', d: { pctile: si?.cycle, stage: si?.cycle >= 80 ? 3 : si?.cycle >= 50 ? 1 : 0 } },
              ].map(({ name, sub, d }) => (
                <div key={sub} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9.5, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4, lineHeight: 1.2 }}>{name}</div>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, fontSize: 26, lineHeight: 1, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', letterSpacing: '-0.005em' }}>
                    {d?.pctile != null ? d.pctile : '—'}
                  </div>
                  <div style={{ fontSize: 9, letterSpacing: '.06em', color: 'var(--ink-3)', marginTop: 4, fontStyle: 'italic' }}>
                    {sub}
                  </div>
                </div>
              ))}
            </div>
          </article>
          {/* CARD 2 · ASSET TILT (with sector mini-list folded in) */}
          <article className="v2-tile" onClick={() => navTo('allocation')} tabIndex={0}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <span className="t-eyebrow accent">02 · Where the cycle says to lean</span>
              <FreshnessChip elementId="v10_allocation" fallback={v10?.as_of} />
            </div>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:14, marginBottom:14 }}>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:64, lineHeight:.95, letterSpacing:'-.02em', color:'var(--up)', fontFeatureSettings:'"tnum"' }}>
                {eqPct != null ? <CountUp to={eqPct} /> : '—'}
                {eqPct != null && <span style={{ fontSize:22, color:'var(--ink-2)', marginLeft:2 }}>%</span>}
              </span>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:22, color:'var(--ink-0)' }}>{stance} · {lev}× lev</span>
            </div>
            {eqPct != null && (
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
                <div style={{ flex:1, height:8, background:'var(--bg-2)', borderRadius:'var(--r-pill)', overflow:'hidden', display:'flex' }}>
                  <div style={{ background:'var(--up)', height:'100%', width:`${eqPct}%` }} />
                  <div style={{ background:'var(--accent)', height:'100%', width:`${defPct}%` }} />
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:14, fontSize:11, color:'var(--ink-2)', letterSpacing:'.04em', marginBottom:14 }}>
              <span><strong style={{ color:'var(--ink-0)', fontWeight:500 }}>{eqPct ?? '—'}%</strong> equity</span>
              <span><strong style={{ color:'var(--ink-0)', fontWeight:500 }}>{defPct ?? '—'}%</strong> defensive</span>
              <span><strong style={{ color:'var(--ink-0)', fontWeight:500 }}>{lev}×</strong> leverage</span>
            </div>
            <div style={{ paddingTop:14, borderTop:'1px solid var(--line-0)' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--up)', fontWeight:500, marginBottom:6 }}>Overweight</div>
                  <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:13, color:'var(--ink-0)', lineHeight:1.7 }}>
                    {ow.length ? ow.map((s) => <div key={s.sector}>{s.sector}</div>) : <span style={{ color:'var(--ink-2)' }}>—</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--down)', fontWeight:500, marginBottom:6 }}>Underweight</div>
                  <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:13, color:'var(--ink-0)', lineHeight:1.7 }}>
                    {uw.length ? uw.map((s) => <div key={s.sector}>{s.sector}</div>) : <span style={{ color:'var(--ink-2)' }}>—</span>}
                  </div>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 3 · PORTFOLIO SNAPSHOT (placeholder until React port wires Supabase) */}
          <article className="v2-tile" onClick={() => navTo('insights')} tabIndex={0}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <span className="t-eyebrow accent">03 · Your portfolio</span>
              <FreshnessChip elementId="portfolio_history" />
            </div>
            <div style={{ margin:'auto 0', textAlign:'center', color:'var(--ink-2)', fontSize:13, padding:'40px 0' }}>
              <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:18, color:'var(--ink-1)', marginBottom:10 }}>
                {user ? 'Open Insights to view your portfolio' : 'Sign in to view your portfolio'}
              </div>
              <div style={{ fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--accent)', fontWeight:500 }}>
                Open Insights →
              </div>
            </div>
          </article>

          {/* CARD 4 · DAILY OPP SCAN */}
          <article className="v2-tile" onClick={() => navTo('portopps')} tabIndex={0}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <span className="t-eyebrow accent">04 · What to act on today</span>
              <FreshnessChip elementId="latest_scan" fallback={scan?.scan_time} />
            </div>
            {buys.length === 0 && nears.length === 0 ? (
              <div style={{ margin:'auto 0', textAlign:'center', color:'var(--ink-2)', fontSize:13, padding:'40px 0' }}>
                Scanner output loading…
              </div>
            ) : (
              <div>
                {[...buys.map((p) => ({ ...p, tag: 'Buy', tagCls: 'up' })), ...nears.map((p) => ({ ...p, tag: 'Near', tagCls: 'warn' }))].slice(0, 5).map((p, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 0', borderBottom:i<4 ? '1px solid var(--line-0)' : 'none', fontSize:14, gap:12 }}>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:18, color:'var(--ink-0)', fontFeatureSettings:'"tnum"', minWidth:54 }}>{p.ticker || p.symbol}</span>
                    <span style={{ flex:1, color:'var(--ink-1)', fontSize:13 }}>
                      <span style={{ fontSize:10, letterSpacing:'.14em', fontWeight:500, textTransform:'uppercase', color:`var(--${p.tagCls})`, marginRight:8 }}>{p.tag}</span>
                      {p.reason || p.signal_summary || ''}
                    </span>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:18, color:'var(--ink-0)', fontFeatureSettings:'"tnum"', minWidth:36, textAlign:'right' }}>{p.composite_score || p.score || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </article>

        </section>

        {/* HEADLINES */}
        {headlines.length > 0 && (
          <section style={{ paddingTop:32 }}>
            <div style={{ background:'var(--bg-1)', border:'1px solid var(--line-1)', borderRadius:'var(--r-tile)', padding:'24px 28px', marginTop:18 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <span className="t-eyebrow accent">Today's headlines</span>
                <span className="t-eyebrow">multi-source · 30 min refresh</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'0 32px' }} className="v2-hl-grid">
                {headlines.map((h, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:14, padding:'12px 0', borderBottom:i<headlines.length-2 ? '1px solid var(--line-0)' : 'none' }}>
                    <a href={h.url || '#'} target="_blank" rel="noopener noreferrer" style={{ color:'var(--ink-0)', textDecoration:'none', fontSize:14, lineHeight:1.45, fontFamily: 'Inter,system-ui,-apple-system,sans-serif', flex:1 }}>{h.title || h.headline}</a>
                    <div style={{ fontSize:10.5, letterSpacing:'.08em', color:'var(--ink-2)', textTransform:'uppercase', textAlign:'right', whiteSpace:'nowrap', flexShrink:0, fontWeight:500 }}>
                      {h.source && <span style={{ color:'var(--accent)', marginRight:6 }}>{h.source}</span>}
                      {h.time || h.published_at?.slice(11,16) || ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <div style={{ margin:'48px 0 24px', paddingTop:24, borderTop:'1px solid var(--line-0)', textAlign:'center', color:'var(--ink-2)', fontSize:11, letterSpacing:'.06em', textTransform:'uppercase' }}>
          v{(snap?.version || '11.0').replace(/^v/,'')} cycle board · v{(v10?.version || '10.1c').replace(/^v/,'')} allocator · sources per page
        </div>
      </div>

      {err && (
        <div style={{ position:'fixed', bottom:16, left:16, padding:'10px 16px', background:'var(--bg-1)', border:'1px solid var(--down)', borderRadius:8, color:'var(--down)', fontSize:12 }}>
          Home: failed to load live data ({err}).
        </div>
      )}
    </div>
  );
}
