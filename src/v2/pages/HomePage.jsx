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

// ─── 2-axis engine integration (cutover from old regime/cycle framework) ────
//     Stress + yield read comes from macrotilt_engine.json.
//     Macro Overview tile mini-preview mirrors the new 5-panel Macro Overview
//     page — domain heat indicators computed off indicator_history.json.

const VIZ_COLORS = {
  hot:     '#D946C4',
  cool:    '#10B981',
  watch:   '#F59E0B',
  neutral: '#64748B',
};

// Direction-of-stress sense for each indicator on the new Macro Overview page.
// Mirror of INDICATORS[*].dir in src/v2/pages/MacroOverviewPage.jsx.
const INDICATOR_DIR = {
  // RATES
  yield_curve: 'lw', real_rates: 'hw', move: 'hw', term_premium: 'hw', breakeven_10y: 'neutral',
  // CREDIT
  hy_ig: 'hw', ig_oas: 'hw', hy_ig_ratio: 'hw', sloos_ci: 'hw', sloos_cre: 'hw',
  // EQUITIES
  buffett: 'hw', cape: 'hw', vix: 'hw', skew: 'hw', eq_cr_corr: 'neutral',
  // MONEY & BANKING
  cpff: 'hw', anfci: 'hw', stlfsi: 'hw', bkx_spx_v11: 'lw', bank_credit: 'lw', fed_bs: 'lw',
  // ECONOMY
  ic4wsa: 'hw', ism: 'lw', jolts_quits: 'lw', copper_gold: 'lw', usd: 'neutral', cfnai: 'lw',
};

const PANEL_INDICATORS = {
  rates:    ['yield_curve','real_rates','move','term_premium','breakeven_10y'],
  credit:   ['hy_ig','ig_oas','hy_ig_ratio','sloos_ci','sloos_cre'],
  equities: ['buffett','cape','vix','skew','eq_cr_corr'],
  money:    ['cpff','anfci','stlfsi','bkx_spx_v11','bank_credit','fed_bs'],
  economy:  ['ic4wsa','ism','jolts_quits','copper_gold','usd','cfnai'],
};

const PANEL_LIST = [
  { id: 'rates',    label: 'Rates' },
  { id: 'credit',   label: 'Credit' },
  { id: 'equities', label: 'Equities' },
  { id: 'money',    label: 'Money' },
  { id: 'economy',  label: 'Economy' },
];

function trailingPctile5y(points, value) {
  if (!points || (value == null && value !== 0)) return null;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffStr = cutoff.toISOString().slice(0,10);
  const recent = points.filter(p => p[0] >= cutoffStr).map(p => p[1]).filter(v => v != null);
  if (!recent.length) return null;
  const sorted = [...recent].sort((a,b) => a-b);
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < value) lo = m+1; else hi = m; }
  return lo / sorted.length;
}

function heatBucket(pct, dir) {
  if (pct == null) return 'unknown';
  if (dir === 'hw') return pct >= 0.75 ? 'stressed' : pct >= 0.50 ? 'elevated' : 'calm';
  if (dir === 'lw') return pct <= 0.25 ? 'stressed' : pct <= 0.50 ? 'elevated' : 'calm';
  // neutral direction — by percentile band, not a stress call
  if (pct >= 0.75) return 'high';
  if (pct <= 0.25) return 'low';
  return 'mid';
}

function heatColorFor(bucket) {
  if (bucket === 'stressed') return VIZ_COLORS.hot;
  if (bucket === 'elevated') return VIZ_COLORS.watch;
  if (bucket === 'calm')     return VIZ_COLORS.cool;
  return VIZ_COLORS.neutral;
}

// Domain summary: counts of stressed/elevated/calm/neutral indicators in a domain.
function summarizeDomain(panelId, indHist) {
  const ids = PANEL_INDICATORS[panelId] || [];
  const counts = { stressed: 0, elevated: 0, calm: 0, neutral: 0 };
  for (const id of ids) {
    const series = indHist && indHist[id];
    if (!series || !series.points || !series.points.length) continue;
    const cur = series.points[series.points.length - 1][1];
    const pct = trailingPctile5y(series.points, cur);
    const dir = INDICATOR_DIR[id];
    const b = heatBucket(pct, dir);
    if (b === 'stressed') counts.stressed++;
    else if (b === 'elevated') counts.elevated++;
    else if (b === 'calm') counts.calm++;
    else counts.neutral++;
  }
  // Domain heat = the worst bucket present (stressed > elevated > calm > neutral)
  const worst = counts.stressed > 0 ? 'stressed' : counts.elevated > 0 ? 'elevated' : counts.calm > 0 ? 'calm' : 'neutral';
  return { ...counts, worst, total: ids.length };
}

function useHomeData() {
  const [snap, setSnap] = useState(null);
  const [v10, setV10] = useState(null);
  const [scan, setScan] = useState(null);
  const [engine, setEngine] = useState(null);
  const [indHist, setIndHist] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([
      fetch('/cycle_board_snapshot.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/v10_allocation.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/latest_scan_data.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/macrotilt_engine.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/indicator_history.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
    ]).then(([s, v, sc, en, ih]) => { setSnap(s); setV10(v); setScan(sc); setEngine(en); setIndHist(ih); }).catch((e) => setErr(e?.message));
  }, []);
  return { snap, v10, scan, engine, indHist, err };
}

function navTo(hash) {
  if (typeof window !== 'undefined') {
    window.location.hash = hash;
  }
}

export default function HomePage() {
  // ─── 2-axis engine cutover (PR Home v2): engine + indicator_history power
  //     the new Macro Overview mini preview and the Asset Tilt headline.
  const { snap, v10, scan, engine, indHist, err } = useHomeData();
  const { user, loading: authLoading } = useSession();
  const greetingName = user
    ? (user.user_metadata?.first_name
       || user.user_metadata?.full_name?.split(' ')[0]
       || (user.email ? user.email.split('@')[0] : '')
       || 'there')
    : null;

  // 2-axis engine read (replaces cycle_board composite + old stance text)
  const stressState   = engine?.stress?.state || null;             // 'Risk On' | 'Watch' | 'Risk Off'
  const yieldRegime   = engine?.yield_regime?.state || null;       // 'Inflationary' | 'Neutral' | 'Deflationary'
  const enginePct     = engine?.allocation?.equity_pct != null ? Math.round(engine.allocation.equity_pct) : null;
  const engineDefPct  = engine?.allocation?.defensive_pct != null ? Math.round(engine.allocation.defensive_pct) : null;
  const engineSleeve  = engine?.allocation?.active_sleeve_label || null;
  const engineAsOf    = engine?.as_of || null;

  // v10 still provides sector OW/UW tilts (AA stays on v9 per project memory).
  const sectors = v10?.sectors || [];
  const lev     = v10?.leverage != null ? v10.leverage.toFixed(2) : '1.00';
  const ow = sectors.filter((s) => s.rating === 'OW').slice(0, 3);
  const uw = sectors.filter((s) => s.rating === 'UW').slice(0, 3);

  // Domain heat preview for Macro Overview tile.
  const domainSummaries = useMemo(() => {
    if (!indHist) return null;
    const out = {};
    for (const p of PANEL_LIST) out[p.id] = summarizeDomain(p.id, indHist);
    return out;
  }, [indHist]);

  // Aggregate across all 26 indicators on the new page.
  const totalCounts = useMemo(() => {
    if (!domainSummaries) return null;
    const t = { stressed: 0, elevated: 0, calm: 0, neutral: 0, total: 0 };
    for (const id of Object.keys(domainSummaries)) {
      const s = domainSummaries[id];
      t.stressed += s.stressed; t.elevated += s.elevated; t.calm += s.calm; t.neutral += s.neutral;
      t.total += s.total;
    }
    return t;
  }, [domainSummaries]);

  // Hero stance colors
  const stressHeroColor = stressState === 'Risk Off' ? VIZ_COLORS.hot : stressState === 'Watch' ? VIZ_COLORS.watch : stressState === 'Risk On' ? VIZ_COLORS.cool : 'var(--ink-2)';
  

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
              <span className="t-eyebrow">Today's engine read</span>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:54, lineHeight:.95, letterSpacing:'-.02em', color: stressHeroColor, fontFeatureSettings:'"tnum"' }}>
                {stressState || '—'}
              </span>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:16, color:'var(--ink-1)' }}>
                {yieldRegime ? `${yieldRegime} yield regime` : ''}
                {enginePct != null ? ` · ${enginePct}% equity` : ''}
              </span>
              <FreshnessChip elementId="macrotilt_engine" fallback={engineAsOf} />
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '32px 0 0' }} className="v2-home-grid">

          {/* CARD 1 · MACRO OVERVIEW — 5-domain heat preview (mirrors the new page) */}
          <article className="v2-tile" onClick={() => navTo('overview')} tabIndex={0}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span className="t-eyebrow accent">01 · Macro Overview</span>
              <FreshnessChip elementId="indicator_history" fallback={indHist?.__meta__?.generated_at_utc?.slice(0,10)} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-1)', marginBottom: 14, lineHeight: 1.55 }}>
              {totalCounts ? (
                <>
                  Across the {totalCounts.total} indicators on the page:
                  {' '}
                  <strong style={{ color: VIZ_COLORS.hot }}>{totalCounts.stressed} stressed</strong>
                  {' · '}
                  <strong style={{ color: VIZ_COLORS.watch }}>{totalCounts.elevated} elevated</strong>
                  {' · '}
                  <strong style={{ color: VIZ_COLORS.cool }}>{totalCounts.calm} calm</strong>
                  {totalCounts.neutral > 0 ? <> · <strong style={{ color: VIZ_COLORS.neutral }}>{totalCounts.neutral} range-only</strong></> : null}
                </>
              ) : 'Loading…'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {PANEL_LIST.map(p => {
                const sum = domainSummaries?.[p.id];
                const worstColor = sum ? heatColorFor(sum.worst) : VIZ_COLORS.neutral;
                const stressedN = sum?.stressed || 0;
                return (
                  <div key={p.id} style={{
                    background: 'var(--bg-1)',
                    border: `0.5px solid var(--line-1)`,
                    borderTop: `3px solid ${worstColor}`,
                    borderRadius: 8,
                    padding: '10px 8px 12px',
                    textAlign: 'center',
                    minWidth: 0,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-0)', letterSpacing: '0.02em', marginBottom: 6 }}>{p.label}</div>
                    <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, fontSize: 22, lineHeight: 1, color: worstColor, fontFeatureSettings: '"tnum"' }}>
                      {sum ? stressedN : '—'}
                    </div>
                    <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 5, fontWeight: 600 }}>
                      stressed / {sum?.total ?? '—'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-0)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.04em' }}>
              Open Macro Overview →
            </div>
          </article>
          {/* CARD 2 · ASSET TILT — 2-axis engine read + sector tilts from v10 */}
          <article className="v2-tile" onClick={() => navTo('allocation')} tabIndex={0}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <span className="t-eyebrow accent">02 · Asset Tilt</span>
              <FreshnessChip elementId="macrotilt_engine" fallback={engineAsOf} />
            </div>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:14, marginBottom:10 }}>
              <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:64, lineHeight:.95, letterSpacing:'-.02em', color: stressHeroColor, fontFeatureSettings:'"tnum"' }}>
                {enginePct != null ? <CountUp to={enginePct} /> : '—'}
                {enginePct != null && <span style={{ fontSize:22, color:'var(--ink-2)', marginLeft:2 }}>%</span>}
              </span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize:20, color: stressHeroColor, fontWeight: 600, lineHeight: 1.1 }}>{stressState || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>{yieldRegime ? `${yieldRegime} yield regime` : ''}</div>
              </div>
            </div>
            {enginePct != null && (
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
                <div style={{ flex:1, height:8, background:'var(--bg-2)', borderRadius:'var(--r-pill)', overflow:'hidden', display:'flex' }}>
                  <div style={{ background: VIZ_COLORS.cool, height:'100%', width:`${enginePct}%` }} />
                  <div style={{ background: VIZ_COLORS.watch, height:'100%', width:`${engineDefPct}%` }} />
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:14, fontSize:11, color:'var(--ink-2)', letterSpacing:'.04em', marginBottom:14 }}>
              <span><strong style={{ color:'var(--ink-0)', fontWeight:500 }}>{enginePct ?? '—'}%</strong> equity</span>
              <span><strong style={{ color:'var(--ink-0)', fontWeight:500 }}>{engineDefPct ?? 0}%</strong> defensive{engineSleeve && engineDefPct ? ` (${engineSleeve})` : ''}</span>
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
