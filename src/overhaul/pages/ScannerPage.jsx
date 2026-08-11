/* Trading Scanner — CREAM "home-v12" system (cream rebrand Phase B).

   Cockpit layout (2026-07-30, Joe-approved mockup): the page is a cockpit
   landing — one tile per panel showing its top items with a small real-data
   visualization — and each tile opens a "desk view" overlay with the full
   panel (every column, sortable where the panel sorts).

   Strategy reset (2026-08): the insider-score scanner panel is replaced by
   the Conviction Events panel — the decision feed the Paper book actually
   trades (large real insider purchases, $250,000+ per name per day,
   confirmed above the 50-day average), read from ce_events via the SAME
   shared hook the Paper page's event ledger uses (LESSONS 2026-06-12b). The
   Power Trend Momentum panel STAYS as an idea feed — not auto-traded — and
   the RSI Divergence screen is unchanged.

   Degrade: ce_events will not resolve until the engine cutover; the tile
   renders its awaiting-first-events state on any read failure — never an
   error. History: refactored 2026-05-27 (Path-A); cream reskin 2026-07-07;
   cockpit 2026-07-30. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import usePowerTrendList from '../../hooks/usePowerTrendList';
import useDivergenceScan from '../../hooks/useDivergenceScan';
import { useCeEvents, ceActionMeta, ceInsiderNames } from '../../hooks/useCeEvents';
import FreshnessChip from '../components/FreshnessChip';
import ConvictionEventsPanel from '../components/ConvictionEventsPanel';
import DivergencePanel from '../components/DivergencePanel';
import MomentumPanel from '../components/MomentumPanel';
import '../styles/cream-system.css';
import '../styles/scanner-v12.css';

const MO_FMT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtScanDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MO_FMT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

/* Reveal — scroll-reveal wrapper, same pattern as HomePage/MacroPage (v12
   system). Replays in BOTH directions; state lives in React so data-poll
   re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

/* ── shared tile formatting ─────────────────────────────────────────────── */

const fmtSignedPct = (v, dp = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}%`;
  return n < 0 ? `−${s}` : `+${s}`;
};

const fmtSignedPts = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} pts`;
  return n < 0 ? `−${s}` : `+${s}`;
};

// Trading days since the newer pivot printed — "2d ago" language on the tile.
const fmtDaysAgo = (b) => (b == null ? '—' : b === 0 ? 'today' : `${b}d ago`);

// Compact dollars for the tile bars ($412K / $1.2M).
const fmtUsdShort = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}M`;
  return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`;
};

/* Tile shell — the whole card opens the desk view. div+role (not <button>)
   because the freshness chip inside is itself interactive. */
function CockpitTile({ kicker, title, cadence, onOpen, children }) {
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
  };
  return (
    <Reveal
      className="sc-ctile"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      aria-label={`Open ${title} desk view`}
    >
      <div className="sc-kicker">{kicker}</div>
      <h2 className="sc-ctitle">{title}</h2>
      <div className="sc-ccadence">{cadence}</div>
      {children}
      <div className="sc-copen">Open desk view <span className="arr" aria-hidden="true">→</span></div>
    </Reveal>
  );
}

/* ── Tile 1 · Conviction Events — the feed the Paper book trades ────────── */

function ConvictionEventsTile({ onOpen }) {
  const { rows, loading } = useCeEvents(30);
  const latest = rows.length ? rows[0].filing_date : null;

  // Recent qualifying events (passed the gates), ranked by buy total —
  // newest 15 considered, top 5 by dollars shown.
  const top = useMemo(() => {
    const q = rows.filter((r) => r.passed_gates).slice(0, 15);
    q.sort((a, b) => (Number(b.total_usd) || 0) - (Number(a.total_usd) || 0));
    return q.slice(0, 5);
  }, [rows]);

  const barMax = 190;
  const maxUsd = top.length ? Math.max(...top.map((r) => Number(r.total_usd) || 0)) : 0;

  return (
    <CockpitTile
      kicker="Book feed · Daily events"
      title="Conviction Events"
      cadence="Insider buys of $250K+ per name per day · confirmed above the 50-day average"
      onOpen={onOpen}
    >
      {loading ? (
        <div className="sc-cloading">Loading events…</div>
      ) : top.length === 0 ? (
        <div className="sc-cloading">Awaiting first events — qualifying insider purchases appear here as the engine records them.</div>
      ) : (
        <>
          <div className="sc-cviz">
            <div className="sc-cvizlab">Aggregated insider buying per event, ranked by dollars</div>
            <svg width="100%" height={top.length * 24 - 4} viewBox={`0 0 300 ${top.length * 24 - 4}`} role="img" aria-label="Buy totals of the top events">
              {top.map((r, i) => {
                const y = i * 24;
                const w = maxUsd > 0 ? Math.max(4, ((Number(r.total_usd) || 0) / maxUsd) * barMax) : 4;
                return (
                  <g key={`${r.ticker}-${i}`}>
                    <text x="0" y={y + 13} className="sc-cbarlab">{r.ticker}</text>
                    <rect x="52" y={y + 4} width={barMax} height="11" rx="5.5" className="sc-cbartrack" />
                    <rect x="52" y={y + 4} width={w} height="11" rx="5.5" className="sc-cbarfill" />
                    <text x="298" y={y + 13} textAnchor="end" className="sc-cbarval">{fmtUsdShort(r.total_usd)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="sc-crows">
            {top.map((r, i) => {
              const meta = ceActionMeta(r.action);
              const names = ceInsiderNames(r.insider_names);
              const n = r.n_insiders != null ? Number(r.n_insiders) : names.length;
              return (
                <div key={`${r.ticker}-${i}`} className="sc-crow">
                  <span className="tk">{r.ticker}</span>
                  <span className="nm">{names[0] ? `${names[0]}${n > 1 ? ` +${n - 1}` : ''}` : (n ? `${n} insider${n > 1 ? 's' : ''}` : '')}</span>
                  <span className="val num">{fmtUsdShort(r.total_usd)}</span>
                  <span className={`ce-chip ${meta.tone}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="sc-cmeta" onClick={(e) => e.stopPropagation()}>
        <FreshnessChip
          elementId="portfolio.ce-events-daily"
          variant="dot"
          fallback={{ asOfIso: latest, calendar: 'nyse-trading-day' }}
        />
        <span>{latest ? `Latest event · ${fmtScanDay(latest)}` : 'Awaiting first events'}</span>
      </div>
    </CockpitTile>
  );
}

/* ── Tile 2 · Power Trend Momentum (idea feed — not auto-traded) ────────── */

function MomentumTile({ onOpen }) {
  const { rows, asOf, allCash, loading } = usePowerTrendList();
  const top = rows.slice(0, 5);

  // Bubble field: x = margin over the S&P 500 (points), y = 3-month return
  // (percent), bubble area = average dollars traded per day. All three are
  // stored fields on the list — no new math beyond min/max scaling.
  const bubbles = useMemo(() => {
    if (!top.length) return [];
    const xs = top.map((r) => Number(r.rs_vs_spx) || 0);
    const ys = top.map((r) => Number(r.roc_3m) || 0);
    const zs = top.map((r) => Math.sqrt(Math.max(Number(r.adv_usd) || 0, 0)));
    const span = (arr) => {
      const lo = Math.min(...arr); const hi = Math.max(...arr);
      return [lo, hi - lo || 1];
    };
    const [x0, xw] = span(xs); const [y0, yw] = span(ys); const [z0, zw] = span(zs);
    return top.map((r, i) => ({
      ticker: r.ticker,
      cx: 34 + ((xs[i] - x0) / xw) * 232,
      cy: 96 - ((ys[i] - y0) / yw) * 74,
      r: 9 + ((zs[i] - z0) / zw) * 9,
    }));
  }, [top]);

  return (
    <CockpitTile
      kicker="Scanner · Monthly list"
      title="Power Trend Momentum"
      cadence="Monthly refresh · ranked by trend strength · idea feed — not auto-traded"
      onOpen={onOpen}
    >
      {loading ? (
        <div className="sc-cloading">Loading the list…</div>
      ) : allCash ? (
        <div className="sc-cloading">All cash this month — no names passed all three tests.</div>
      ) : top.length === 0 ? (
        <div className="sc-cloading">No Power Trend list published yet.</div>
      ) : (
        <>
          <div className="sc-cviz">
            <div className="sc-cvizlab">Lead over the S&amp;P 500 (→) · 3-mo return (↑) · size = $ traded/day</div>
            <svg width="100%" height="116" viewBox="0 0 300 116" role="img" aria-label="Momentum leaders">
              <line x1="10" y1="104" x2="292" y2="104" className="sc-cax" />
              <line x1="10" y1="104" x2="10" y2="6" className="sc-cax" />
              {bubbles.map((b) => (
                <g key={b.ticker}>
                  <circle cx={b.cx} cy={b.cy} r={b.r} className="sc-cbub" />
                  <text x={b.cx} y={b.cy + 3} textAnchor="middle" className="sc-cbublab">{b.ticker}</text>
                </g>
              ))}
            </svg>
          </div>
          <div className="sc-crows">
            {top.map((r) => (
              <div key={r.ticker} className="sc-crow">
                <span className="tk">{r.ticker}</span>
                <span className="nm">{r.name ? `${r.name} · ` : ''}#{r.rank}</span>
                <span className={`val num ${Number(r.roc_3m) >= 0 ? 'up' : 'down'}`}>{fmtSignedPct(r.roc_3m)} 3-mo</span>
                <span className="pill num">{fmtSignedPts(r.rs_vs_spx)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sc-cmeta" onClick={(e) => e.stopPropagation()}>
        <FreshnessChip
          elementId="equity-power_trend_list-monthly"
          variant="dot"
          fallback={{ asOfIso: asOf, calendar: 'nyse-trading-day' }}
        />
        <span>{asOf ? `List of ${fmtScanDay(asOf)}` : '—'}</span>
      </div>
    </CockpitTile>
  );
}

/* ── Tile 3 · RSI Divergence ────────────────────────────────────────────── */

function DivergenceTile({ onOpen }) {
  const { bull, bear, scanDate, loading } = useDivergenceScan();

  // Extremes only — the same filter the panel applies (Joe 2026-07-16).
  const top = useMemo(() => {
    const rows = [
      ...bull.filter((r) => r.strong).map((r) => ({ ...r, dir: 'bull' })),
      ...bear.filter((r) => r.strong).map((r) => ({ ...r, dir: 'bear' })),
    ];
    rows.sort((a, b) => {
      const d = (a.barsAgo ?? 99) - (b.barsAgo ?? 99);
      return d !== 0 ? d : (b.rsiGap ?? 0) - (a.rsiGap ?? 0);
    });
    return rows.slice(0, 5);
  }, [bull, bear]);

  // Pivot paths for the three freshest setups: RSI at the older → newer
  // pivot on a 0–100 scale, with the 30/70 extreme bands shaded.
  const paths = top.slice(0, 3);
  const yFor = (rsi) => 8 + (1 - Math.min(Math.max(Number(rsi) || 0, 0), 100) / 100) * 96;

  return (
    <CockpitTile
      kicker="Scanner · Daily scan"
      title="RSI Divergence"
      cadence="Extremes only (RSI ≤30 / ≥70) · a screen, not a signal"
      onOpen={onOpen}
    >
      {loading ? (
        <div className="sc-cloading">Loading divergence scan…</div>
      ) : top.length === 0 ? (
        <div className="sc-cloading">No fresh divergences from an RSI extreme in the latest scan.</div>
      ) : (
        <>
          <div className="sc-cviz">
            <div className="sc-cvizlab">RSI at the two pivots · rising off a low = bullish · fading off a high = bearish</div>
            <svg width="100%" height="112" viewBox="0 0 300 112" role="img" aria-label="RSI pivot paths">
              <rect x="16" y={yFor(70) - 9} width="266" height="18" className="sc-cband bear" />
              <rect x="16" y={yFor(30) - 9} width="266" height="18" className="sc-cband bull" />
              <text x="298" y={yFor(70) + 3} textAnchor="end" className="sc-cbandlab">70</text>
              <text x="298" y={yFor(30) + 3} textAnchor="end" className="sc-cbandlab">30</text>
              {paths.map((r, i) => {
                const x1 = 92 + i * 26;
                const x2 = 182 + i * 34;
                return (
                  <g key={r.ticker} className={`sc-cpath ${r.dir}`}>
                    <text x={x1} y={yFor(r.rsi1) + (i % 2 ? 16 : -9)} textAnchor="middle" className="lab">{r.ticker}</text>
                    <line x1={x1} y1={yFor(r.rsi1)} x2={x2} y2={yFor(r.rsi2)} />
                    <circle cx={x1} cy={yFor(r.rsi1)} r="4" />
                    <circle cx={x2} cy={yFor(r.rsi2)} r="4" className="new" />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="sc-crows">
            {top.map((r) => (
              <div key={r.ticker} className="sc-crow">
                <span className="tk">{r.ticker}</span>
                <span className={`tag ${r.dir}`}>{r.dir === 'bull' ? 'Bullish' : 'Bearish'}</span>
                <span className="nm" />
                <span className="val num">RSI {r.rsi1 == null ? '—' : Math.round(r.rsi1)}→{r.rsi2 == null ? '—' : Math.round(r.rsi2)}</span>
                <span className="val num age">{fmtDaysAgo(r.barsAgo)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sc-cmeta" onClick={(e) => e.stopPropagation()}>
        <FreshnessChip
          elementId="equity-rsi_divergences-daily"
          variant="dot"
          fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
        />
        <span>Latest scan{scanDate ? ` · ${fmtScanDay(scanDate)} close` : ''}</span>
      </div>
    </CockpitTile>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const DESK_TABS = [
  { key: 'conviction', label: 'Conviction Events' },
  { key: 'momentum', label: 'Power Trend Momentum' },
  { key: 'divergence', label: 'RSI Divergence' },
];

export default function ScannerPage() {
  const [desk, setDesk] = useState(null); // null | 'conviction' | 'momentum' | 'divergence'

  // Desk view open: lock body scroll + close on Escape.
  useEffect(() => {
    if (!desk) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setDesk(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [desk]);

  return (
    <div className="home-v12 scanner-v12">
      {/* Hero — cockpit landing (Joe-approved mockup, 2026-07-30) */}
      <section className="wrap sc-hero">
        <Reveal className="sc-ed">
          <div className="eyebrow2"><span className="dot" />Trading scanner</div>
          <h1>The scanner desk. <i>Three panels, one cockpit.</i></h1>
          <div className="sc-sub">
            Conviction Events — the feed the Paper book trades — plus the Power Trend and
            RSI Divergence scanners. Click any tile to open its desk view.
          </div>
        </Reveal>
      </section>

      {/* Cockpit — one tile per panel */}
      <section className="wrap sc-cockpit">
        <ConvictionEventsTile onOpen={() => setDesk('conviction')} />
        <MomentumTile onOpen={() => setDesk('momentum')} />
        <DivergenceTile onOpen={() => setDesk('divergence')} />
      </section>

      {/* Desk view — the full panel, in an overlay */}
      {desk && (
        <div
          className="sc-desk"
          role="dialog"
          aria-modal="true"
          aria-label={`${DESK_TABS.find((t) => t.key === desk)?.label} desk view`}
          onClick={(e) => { if (e.target === e.currentTarget) setDesk(null); }}
        >
          <div className="sc-deskcard">
            <div className="sc-deskbar">
              <div className="sc-dtabs">
                {DESK_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`sc-dtab ${desk === t.key ? 'on' : ''}`}
                    onClick={() => setDesk(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button type="button" className="sc-deskback" onClick={() => setDesk(null)}>
                ← Back to cockpit
              </button>
            </div>
            <div className="sc-deskbody">
              {desk === 'conviction' && <ConvictionEventsPanel />}
              {desk === 'momentum' && <MomentumPanel />}
              {desk === 'divergence' && <DivergencePanel />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
