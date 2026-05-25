import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';
import { InfoTip, HeadWithTip } from '../../InfoTip';

/**
 * AssetTiltPage v2 — cutover.
 * Live JSON: /v10_allocation.json (engine output — equity_pct, defensive_pct, leverage,
 * mechanism_scores, mechanism_bands, sectors, industry_groups with tickers + contributions + dollar).
 */

const MECH_LABELS = {
  valuation: 'Valuation', credit: 'Credit', funding: 'Funding',
  growth: 'Growth', liquidity_policy: 'Liquidity & Policy', positioning_breadth: 'Positioning & Breadth',
};

// The mechanism keys on a sector/IG `contributions` block use the engine's
// canonical ids; the calibration tiles key the same mechanisms by their own
// `id`. These already line up except where the calibration uses a different
// slug — this map bridges the two so the mechanism drill can find the right
// tile (and therefore the indicator list + vendors) for a contribution row.
const MECH_TILE_ID = {
  valuation: 'valuation', credit: 'credit', funding: 'funding',
  growth: 'growth', liquidity_policy: 'liquidity_policy', positioning_breadth: 'positioning_breadth',
};

// ── Bug #1149 — Asset Tilt → Trading Opportunities hand-off ──────────────
//
// Clicking "View in Trading Opportunities" inside an industry-group drawer
// deep-links to the screener pre-filtered to that group's stocks. The
// screener (trading_opps_signals) carries NO per-stock industry-group tag —
// the only per-stock classification on a screener row is the broad `sector`
// field (the 11-bucket vendor sector taxonomy: Technology, Financial
// Services, Healthcare, …). So the screener can only honestly filter by
// SECTOR, not by industry group.
//
// That means the hand-off is only accurate for the industry groups that are
// the SOLE Asset Tilt industry group inside their GICS sector — filtering
// the screener to that sector then returns exactly that group's universe
// with no contamination from sibling groups. Every other Asset Tilt sector
// holds 2–3 industry groups (Information Technology = Semiconductors +
// Software + Hardware; Financials = Banks + Insurance + Diversified
// Financials; etc.), so a sector-level filter for any one of them would
// silently mix in the siblings — a misleading filter the council scope
// explicitly forbids. When in doubt, exclude: a missing button is fine.
//
// CLEAN_IG_IDS — the allowlist. Each id below is the only Asset Tilt
// industry group in its GICS sector, and that GICS sector maps 1:1 onto a
// single screener `sector` value:
//   reits     → Real Estate  (only IG in GICS Real Estate)
//   electric  → Utilities    (only IG in GICS Utilities)
// All 22 other industry groups share their GICS sector with one or two
// siblings and are deliberately excluded.
const CLEAN_IG_IDS = new Set(['reits', 'electric']);

export default function AssetTiltPage() {
  const [v10, setV10] = useState(null);
  const [calib, setCalib] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);
  // Drill state. `drill` is a stack-like object describing the deepest open
  // level so the Drawer's ← Back walks Sector → IG → ETF and IG → Mechanism →
  // (indicator vendor shown inline). `null` = drawer closed.  Bug #1165.
  const [drill, setDrill] = useState(null);
  const [igFilter, setIgFilter] = useState('all');

  useEffect(() => {
    fetch('/v10_allocation.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null)
      .then(setV10).catch((e) => setErr(e?.message));
    // Calibration tiles carry each mechanism's component indicator list;
    // the manifest carries each indicator's source vendor. Both feed the
    // Mechanism → Indicators → vendor drill. Failure is non-fatal — the
    // mechanism rows simply stay non-clickable if the lookups are empty.
    fetch('/methodology_calibration_v11.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setCalib).catch(() => {});
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setManifest).catch(() => {});
  }, []);

  const eqPct = v10?.equity_pct != null ? Math.round(v10.equity_pct * 100) : null;
  const defPct = v10?.defensive_pct != null ? Math.round(v10.defensive_pct * 100) : null;
  const lev = v10?.leverage;
  const stress = v10?.stress_score;
  const STANCE_MAP = { 'Cautious':'Watch', 'Watch':'Watch', 'Cautionary':'Watch', 'Stressed':'Risk Off', 'Distressed':'Risk Off', 'Concerning':'Watch', 'Complacent':'Watch', 'Normal':'Risk On', 'Neutral':'Watch', 'Risk On':'Risk On', 'Risk Off':'Risk Off' };
  const rawStance = v10?.page_stance || '—';
  const stance = STANCE_MAP[rawStance] || rawStance;
  const sectors = v10?.sectors || [];
  const igs = v10?.industry_groups || [];
  const igsSorted = useMemo(() => [...igs].sort((a, b) => (b.tilt_score || 0) - (a.tilt_score || 0)), [igs]);

  const igsFiltered = useMemo(() => {
    if (igFilter === 'all') return igsSorted;
    return igsSorted.filter((ig) => ig.rating === igFilter);
  }, [igsSorted, igFilter]);

  const top = igsSorted.slice(0, 5);
  const bot = igsSorted.slice(-5).reverse();

  // Per-mechanism component-indicator list, keyed by mechanism tile id.
  // Built from the calibration tiles so the Mechanism drill knows which
  // indicators roll up into a mechanism contribution.  Bug #1165.
  const mechIndicators = useMemo(() => {
    const out = {};
    (calib?.tiles || []).forEach((t) => {
      out[t.id] = (t.indicators || []).map((ind) => ({
        id: ind.id,
        name: ind.name || ind.id,
        share: ind.composite_share_pct != null ? Number(ind.composite_share_pct) : null,
      }));
    });
    return out;
  }, [calib]);

  // Indicator id → source vendor, from the data manifest. This is the
  // terminal node of the Mechanism → Indicators → vendor drill.
  const vendorFor = useMemo(() => {
    const out = {};
    const els = manifest?.elements;
    if (!Array.isArray(els)) return out;
    els.forEach((e) => {
      if (e.category !== 'indicator' || !e.name) return;
      out[e.name] = (e.source_vendor || '').split(/[(:·]/)[0].trim() || null;
    });
    return out;
  }, [manifest]);

  // Resolve the open records from the drill stack. Helpers above their
  // consumers (no temporal-dead-zone — these are plain const expressions).
  const openSector = drill?.sector ? sectors.find((s) => s.sector === drill.sector) : null;
  const openIgRecord = drill?.ig ? igs.find((ig) => ig.id === drill.ig) : null;
  const openEtf = drill?.etf || null;
  const openMech = drill?.mech || null;
  // Industry groups that belong to the open sector — the Sector → IG level.
  const sectorIgs = useMemo(
    () => (openSector ? igsSorted.filter((ig) => ig.sector === openSector.sector) : []),
    [openSector, igsSorted]
  );

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
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>{stance}{stance && stance !== '—' ? ' lean.' : ''}</h1>
            <FreshnessChip elementId="v10_allocation" fallback={v10?.as_of} />
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className={`s ${stress > 1 ? 'warn' : ''}`}>
              <span className="lbl">Stress <InfoTip term="STRESS" size={10} /></span>
              <span className="v"><CountUp to={stress != null ? stress : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}> /6</span></span>
              <span className="d">mechanisms above Neutral</span>
            </div>
            <div className="s">
              <span className="lbl">Equity <InfoTip term="EQUITY %" size={10} /></span>
              <span className="v"><CountUp to={eqPct != null ? eqPct : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}>%</span></span>
              <span className="d">{defPct === 0 ? 'no defensive sleeve' : `${defPct}% defensive`}</span>
            </div>
            <div className="s">
              <span className="lbl">Defensive <InfoTip term="DEFENSIVE %" size={10} /></span>
              <span className="v"><CountUp to={defPct != null ? defPct : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}>%</span></span>
              <span className="d">BIL · TLT · GLD · LQD</span>
            </div>
            <div className="s">
              <span className="lbl">Leverage <InfoTip term="LEVERAGE" size={10} /></span>
              <span className="v">{lev != null ? lev.toFixed(2) : '—'}<span style={{ fontSize: 18, color: 'var(--ink-2)' }}>×</span></span>
              <span className="d">gross {v10?.gross_exposure?.toFixed(2) || '—'}×</span>
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        {/* Theme #8: cycle mechanism strip lives only on Macro Overview.
            Asset Tilt links back, never re-renders.  Bug #1164. */}
        <a
          href="#overview"
          className="v2-cycle-link"
          title="The cycle mechanism board lives on Macro Overview. Click to see all six mechanisms."
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="t-eyebrow accent" style={{ marginRight: 4 }}>Cycle says</span>
            <span className="stance">{stance || '—'}</span>
          </span>
          <span className="cta">see Macro Overview →</span>
        </a>

        {/* 2-COL: SECTORS + TOP/BOTTOM */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, padding: '32px 0 0' }} className="v2-asset-grid">

          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Sectors</h2>
              <span className="t-eyebrow">{sectors.length} GICS</span>
            </div>
            {sectors.map((s) => {
              const maxW = Math.max(...sectors.map((x) => x.weight));
              return (
                <div key={s.sector} onClick={() => setDrill({ sector: s.sector })}
                  style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 60px 60px', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--line-0)', fontSize: 14, cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span className={`v2-pill ${s.rating === 'OW' ? 'r-on' : s.rating === 'UW' ? 'r-off' : 'placeholder'}`}>{s.rating}</span>
                  <span style={{ color: 'var(--ink-0)' }}>{s.sector}</span>
                  <div style={{ height: 5, background: 'var(--bg-2)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--accent)', width: `${(s.weight / maxW) * 100}%`, borderRadius: 'var(--r-pill)' }} />
                  </div>
                  <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 15, color: 'var(--ink-1)', fontFeatureSettings: '"tnum"', textAlign: 'right' }}>{(s.weight * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Top &amp; bottom tilts</h2>
              <span className="t-eyebrow" title="The five industry groups with the largest overweight versus the five with the largest underweight.">Top 5 · bottom 5</span>
            </div>
            {top.map((ig) => (
              <div key={ig.id} onClick={() => setDrill({ ig: ig.id })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13, cursor: 'pointer' }}>
                <div>
                  <div style={{ color: 'var(--ink-0)', fontSize: 13.5 }}>{ig.name}</div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', marginTop: 2 }}>{ig.sector}</div>
                </div>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 16, color: 'var(--up)', fontFeatureSettings: '"tnum"' }}>${(ig.dollar || 0).toFixed(0)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', color: 'var(--ink-2)', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 500 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line-1)' }} />
              Underweight
              <span style={{ flex: 1, height: 1, background: 'var(--line-1)' }} />
            </div>
            {bot.map((ig) => (
              <div key={ig.id} onClick={() => setDrill({ ig: ig.id })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13, cursor: 'pointer' }}>
                <div>
                  <div style={{ color: 'var(--ink-0)', fontSize: 13.5 }}>{ig.name}</div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', marginTop: 2 }}>{ig.sector}</div>
                </div>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 16, color: 'var(--down)', fontFeatureSettings: '"tnum"' }}>${(ig.dollar || 0).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FULL IG TABLE */}
        <div style={{ marginTop: 24, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 14px', borderBottom: '1px solid var(--line-0)', gap: 14, flexWrap: 'wrap' }}>
            <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Industry groups</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', `All ${igs.length}`], ['OW', 'Overweight'], ['MW', 'Marketweight'], ['UW', 'Underweight']].map(([k, lbl]) => (
                <button key={k} onClick={() => setIgFilter(k)} style={{
                  fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--r-pill)',
                  background: igFilter === k ? 'var(--accent)' : 'var(--bg-2)',
                  color: igFilter === k ? '#1a1411' : 'var(--ink-1)',
                  border: igFilter === k ? '1px solid transparent' : '1px solid var(--line-1)',
                  cursor: 'pointer', letterSpacing: '.04em',
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  { label: 'Industry group', term: null },
                  { label: 'Sector', term: null },
                  { label: 'Tickers', term: null },
                  { label: 'Tilt', term: 'TILT' },
                  { label: '$ exposure', term: '$ EXPOSURE' },
                ].map((h, i) => (
                  <th key={h.label} style={{
                    textAlign: i === 4 ? 'right' : 'left',
                    padding: '14px 28px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: 'var(--ink-2)', fontWeight: 500, borderBottom: '1px solid var(--line-1)',
                    background: 'var(--bg-1)', position: 'sticky', top: 0,
                  }}>{h.term ? <HeadWithTip label={h.label} term={h.term} /> : h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {igsFiltered.map((ig) => (
                <tr key={ig.id} onClick={() => setDrill({ ig: ig.id })} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-0)', fontWeight: 500 }}>
                    <span className={`v2-pill ${ig.rating === 'OW' ? 'r-on' : ig.rating === 'UW' ? 'r-off' : 'placeholder'}`} style={{ marginRight: 10, minWidth: 30, justifyContent: 'center' }}>{ig.rating}</span>
                    {ig.name}
                  </td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>{ig.sector}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 11, fontFeatureSettings: '"tnum"', letterSpacing: '.04em' }}>{(ig.tickers || []).join(' · ')}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)' }}>
                    <span style={{ fontSize: 14, color: ig.tilt_score >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {ig.tilt_score >= 0 ? '↑' : '↓'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', textAlign: 'right' }}>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontFeatureSettings: '"tnum"', fontSize: 15, color: 'var(--ink-0)' }}>${ig.dollar?.toFixed(2)}K</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          v{(v10?.version || '10.1c').replace(/^v/, '')} · {v10?.engine || '6-mechanism cycle-board allocator'} · refreshed nightly 22:45 UTC
        </div>
      </div>

      {/* ── DRILL DRAWER ─────────────────────────────────────────────────
          Bug #1165. One Drawer, four levels. Active level is the deepest
          key set on `drill`: ETF > Mechanism > IG > Sector. ← Back walks
          one level up; close clears the whole stack. */}
      <Drawer
        open={drill != null}
        onClose={() => setDrill(null)}
        onBack={
          openEtf ? () => setDrill({ sector: drill.sector, ig: drill.ig })
          : openMech ? () => setDrill({ sector: drill.sector, ig: drill.ig })
          : (openIgRecord && drill?.sector) ? () => setDrill({ sector: drill.sector })
          : undefined
        }
        backLabel={
          openEtf ? (openIgRecord?.name || openSector?.sector || 'previous')
          : openMech ? (openIgRecord?.name || 'industry group')
          : (openIgRecord && drill?.sector) ? (openSector?.sector || 'sector')
          : undefined
        }
      >
        {/* ── Level: SECTOR → lists its industry groups ── */}
        {openSector && !openIgRecord && (
          <>
            <div className="t-eyebrow accent">GICS sector</div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{openSector.sector}</h3>
            <div className="v2-drawer-grid">
              <div className="v2-drawer-stat">
                <div className="lbl">Rating <InfoTip def="The allocator's lean on this sector — OW (overweight), MW (marketweight), or UW (underweight)." size={10} /></div>
                <div className="v">{openSector.rating}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Weight</div>
                <div className="v">{(openSector.weight * 100).toFixed(1)}%</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">$ exposure <InfoTip term="$ EXPOSURE" size={10} /></div>
                <div className="v">${(openSector.dollar || 0).toFixed(2)}K</div>
              </div>
            </div>
            <div className="v2-drawer-section">
              <span className="t-eyebrow">Sector ETFs</span>
              <div style={{ marginTop: 8, color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em' }}>
                {(openSector.etfs || []).map((t) => (
                  <span key={t} onClick={() => setDrill({ sector: drill.sector, etf: t })}
                    style={{ display: 'inline-block', padding: '4px 9px', border: '1px solid var(--line-1)', borderRadius: 4, marginRight: 6, marginBottom: 6, color: 'var(--ink-1)', cursor: 'pointer' }}>{t} →</span>
                ))}
              </div>
            </div>
            <div className="v2-drawer-section">
              <span className="t-eyebrow">Industry groups</span>
              {sectorIgs.length === 0 && (
                <div style={{ color: 'var(--ink-2)', fontSize: 12, padding: '8px 0' }}>No industry groups mapped to this sector.</div>
              )}
              {sectorIgs.map((ig) => (
                <div key={ig.id} onClick={() => setDrill({ sector: drill.sector, ig: ig.id })}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13, cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`v2-pill ${ig.rating === 'OW' ? 'r-on' : ig.rating === 'UW' ? 'r-off' : 'placeholder'}`} style={{ minWidth: 30, justifyContent: 'center' }}>{ig.rating}</span>
                    <span style={{ color: 'var(--ink-0)' }}>{ig.name}</span>
                  </div>
                  <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, color: ig.tilt_score >= 0 ? 'var(--up)' : 'var(--down)', fontFeatureSettings: '"tnum"' }}>${(ig.dollar || 0).toFixed(2)}K →</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Level: IG → tickers (ETF drill) + contribution by mechanism (mechanism drill) ── */}
        {openIgRecord && !openEtf && !openMech && (
          <>
            <div className="t-eyebrow accent">{openIgRecord.sector} · industry group</div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{openIgRecord.name}</h3>
            <div style={{ marginBottom: 8, color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em' }}>
              {(openIgRecord.tickers || []).map((t) => (
                <span key={t} onClick={() => setDrill({ sector: drill.sector, ig: drill.ig, etf: t })}
                  style={{ display: 'inline-block', padding: '4px 9px', border: '1px solid var(--line-1)', borderRadius: 4, marginRight: 6, marginBottom: 6, color: 'var(--ink-1)', cursor: 'pointer' }}>{t} →</span>
              ))}
            </div>
            <div className="v2-drawer-grid">
              <div className="v2-drawer-stat">
                <div className="lbl">Position <InfoTip term="TILT" size={10} /></div>
                <div className={`v ${openIgRecord.tilt_score >= 0 ? 'up' : 'down'}`} style={{ fontSize: 22 }}>
                  {openIgRecord.tilt_score >= 0 ? 'Overweight' : 'Underweight'}
                </div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Rating <InfoTip def="The allocator's lean on this group — OW (overweight, hold more), MW (marketweight, hold neutral), or UW (underweight, hold less)." size={10} /></div>
                <div className="v">{openIgRecord.rating}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">$ exposure <InfoTip term="$ EXPOSURE" size={10} /></div>
                <div className="v">${openIgRecord.dollar?.toFixed(2)}K</div>
              </div>
            </div>

            <div className="v2-drawer-section">
              <span className="t-eyebrow">Contribution by mechanism <InfoTip term="CONTRIBUTION BY MECHANISM" size={10} /></span>
              {Object.entries(openIgRecord.contributions || {}).map(([m, v]) => {
                const up = v >= 0;
                const segW = Math.min(50, Math.abs(v) * 50);
                const tileId = MECH_TILE_ID[m] || m;
                const drillable = (mechIndicators[tileId] || []).length > 0;
                return (
                  <div key={m}
                    onClick={drillable ? () => setDrill({ sector: drill.sector, ig: drill.ig, mech: m }) : undefined}
                    style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', gap: 16, alignItems: 'center', padding: '8px 0', fontSize: 13, cursor: drillable ? 'pointer' : 'default' }}
                    onMouseEnter={drillable ? (e) => e.currentTarget.style.background = 'var(--bg-2)' : undefined}
                    onMouseLeave={drillable ? (e) => e.currentTarget.style.background = 'transparent' : undefined}>
                    <span style={{ color: 'var(--ink-1)' }}>{MECH_LABELS[m] || m}{drillable ? ' →' : ''}</span>
                    <div style={{ position: 'relative', height: 14, display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--line-1)' }} />
                      <span style={{
                        position: 'absolute', top: 3, height: 8, borderRadius: 2,
                        background: up ? 'var(--up)' : 'var(--down)',
                        ...(up ? { right: '50%', width: `${segW}%` } : { left: '50%', width: `${segW}%` }),
                      }} />
                    </div>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, fontFeatureSettings: '"tnum"', textAlign: 'right', color: up ? 'var(--up)' : 'var(--down)' }}>
                      {up ? '+' : ''}{v?.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bug #1149 — hand-off to the Trading Opportunities screener,
                pre-filtered to this industry group. Rendered only when the
                group maps cleanly to a single screener sector (CLEAN_IG_IDS);
                a misleading partial filter is never shown. */}
            {CLEAN_IG_IDS.has(openIgRecord.id) && (
              <div className="v2-drawer-section">
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = '#portopps?ig=' + encodeURIComponent(openIgRecord.id);
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                    padding: '9px 16px', borderRadius: 'var(--r-pill)',
                    background: 'var(--accent)', color: '#1a1411',
                    border: '1px solid transparent', cursor: 'pointer',
                    letterSpacing: '.01em',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                  onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                >
                  View in Trading Opportunities →
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Level: ETF → terminal node of Sector→IG→ETF ── */}
        {openEtf && (
          <>
            <div className="t-eyebrow accent">
              {openIgRecord ? `${openIgRecord.name} · ETF` : openSector ? `${openSector.sector} · ETF` : 'ETF'}
            </div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{openEtf}</h3>
            <div className="v2-drawer-section">
              <div className="v2-drawer-row"><span className="lbl">Symbol</span><span className="val">{openEtf}</span></div>
              {openIgRecord && (
                <div className="v2-drawer-row"><span className="lbl">Industry group</span><span className="val">{openIgRecord.name}</span></div>
              )}
              <div className="v2-drawer-row"><span className="lbl">Sector</span><span className="val">{openIgRecord?.sector || openSector?.sector || '—'}</span></div>
              <div className="v2-drawer-row"><span className="lbl">Role</span><span className="val">Tracking ETF for this {openIgRecord ? 'industry group' : 'sector'}</span></div>
            </div>
          </>
        )}

        {/* ── Level: MECHANISM → component indicators → source vendor ── */}
        {openMech && openIgRecord && (() => {
          const tileId = MECH_TILE_ID[openMech] || openMech;
          const inds = mechIndicators[tileId] || [];
          const contribVal = openIgRecord.contributions?.[openMech];
          return (
            <>
              <div className="t-eyebrow accent">{openIgRecord.name} · mechanism</div>
              <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{MECH_LABELS[openMech] || openMech}</h3>
              {contribVal != null && (
                <div className="v2-drawer-grid">
                  <div className="v2-drawer-stat">
                    <div className="lbl">Contribution to tilt</div>
                    <div className={`v ${contribVal >= 0 ? 'up' : 'down'}`} style={{ fontSize: 22 }}>
                      {contribVal >= 0 ? '+' : ''}{contribVal.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}
              <div className="v2-drawer-section">
                <span className="t-eyebrow">Component indicators <InfoTip def="The calibrated indicators that roll up into this mechanism's composite score. Share is each indicator's weight within the mechanism." size={10} /></span>
                {inds.length === 0 && (
                  <div style={{ color: 'var(--ink-2)', fontSize: 12, padding: '8px 0' }}>No indicators mapped to this mechanism.</div>
                )}
                {inds.map((ind) => (
                  <div key={ind.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13 }}>
                    <div>
                      <div style={{ color: 'var(--ink-0)' }}>{ind.name}</div>
                      <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.03em', marginTop: 2 }}>
                        Source · {vendorFor[ind.id] || 'Source not yet mapped'}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 13, color: 'var(--ink-1)', fontFeatureSettings: '"tnum"' }}>
                      {ind.share != null ? `${ind.share.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </Drawer>

      {err && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, padding: '10px 16px', background: 'var(--bg-1)', border: '1px solid var(--down)', borderRadius: 8, color: 'var(--down)', fontSize: 12 }}>
          Asset Tilt: failed to load v10_allocation ({err}).
        </div>
      )}
    </div>
  );
}
