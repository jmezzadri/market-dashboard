/* Trading Scanner — CREAM "home-v12" system (cream rebrand Phase B).

   Cockpit rebuild (2026-07-30, Joe-approved mockup): the page is now a
   cockpit landing — one tile per scanner showing its top-conviction names
   with a small real-data visualization — and each tile opens a "desk view"
   overlay containing the EXACT full scanner section that used to stack on
   the page (the Insider ScanList card + "How the score is built", the
   MomentumPanel, the DivergencePanel). ZERO data/logic changes: the desk
   views render the same components with the same hooks, columns, sorting,
   gear picker, drills and freshness chips as before. The tiles read the
   same cached hooks (useTradingOppsTop / usePowerTrendList /
   useDivergenceScan) — display only, no new scoring.

   History: refactored 2026-05-27 (Path-A); columns grouped 2026-06-17;
   home-v11 glass era 2026-06-24 → 2026-07-07; cream reskin 2026-07-07;
   stacked-page era ended 2026-07-30 (cockpit). */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import useScanScoreHistory from '../../hooks/useScanScoreHistory';
import useLseIvDaily from '../../hooks/useLseIvDaily';
import usePowerTrendList from '../../hooks/usePowerTrendList';
import useDivergenceScan from '../../hooks/useDivergenceScan';
import FreshnessChip from '../components/FreshnessChip';
import ScanList, { INDICATOR_COLS, INDICATOR_COL_KEYS } from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';
import DivergencePanel from '../components/DivergencePanel';
import MomentumPanel from '../components/MomentumPanel';
import { SCORE_COMPONENTS } from '../lib/scoreWeights';
import '../styles/cream-system.css';
import '../styles/scanner-v12.css';

const MO_FMT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtScanDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MO_FMT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

function bucketFor(s) {
  if (s >= 5) return 'b5';
  if (s >= 4) return 'b4';
  return 'b3';
}

// Saved state is column order + show/hide. Every column is ON by default; the
// gear only hides what you opt out of. Reorder by dragging the header cells on
// the table. Ticker pinned left, Score pinned right. Key bump clears older
// saved layouts so everyone lands on the full grouped set once.
const COLS_KEY = 'mt-scanner-cols-v7'; // v7: Vol rank column (LSE implied vol, 2026-07-27) lands in the Technicals group for everyone
const LOCKED = ['ticker', 'score'];
const DEFAULT_COL_STATE = INDICATOR_COL_KEYS.map((key) => ({ key, on: true }));

function loadColState() {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (!raw) return DEFAULT_COL_STATE;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return DEFAULT_COL_STATE;
    const known = saved.filter((c) => c && INDICATOR_COLS[c.key]);
    const seen = new Set(known.map((c) => c.key));
    INDICATOR_COL_KEYS.forEach((k) => { if (!seen.has(k)) known.push({ key: k, on: true }); });
    return known.map((c) => (LOCKED.includes(c.key) ? { ...c, on: true } : c));
  } catch {
    return DEFAULT_COL_STATE;
  }
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

// Fired insider-rule tags — the three scored rules, described factually
// (run_screener.py: A = C-suite lifting own stake ≥10% and ≥$100k,
// B = combined buying ≥0.05% of the company, C = 3+ different insiders).
const RULE_TAG = { A: 'C-suite buy', B: 'Cluster value', C: '3+ insiders' };

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

/* ── Tile 1 · Insider Conviction ────────────────────────────────────────── */

function InsiderTile({ rows, scanDate, loading, onOpen }) {
  const top = rows.slice(0, 5);
  const barMax = 210;
  return (
    <CockpitTile
      kicker="Scanner 1 · Daily scan"
      title="Insider Conviction"
      cadence="Scored 0–5 · on the list at ≥4 · drops below 3"
      onOpen={onOpen}
    >
      {loading ? (
        <div className="sc-cloading">Loading scan…</div>
      ) : top.length === 0 ? (
        <div className="sc-cloading">No names on the list.</div>
      ) : (
        <>
          <div className="sc-cviz">
            <div className="sc-cvizlab">Score out of 5</div>
            <svg width="100%" height={top.length * 24 - 4} viewBox={`0 0 300 ${top.length * 24 - 4}`} role="img" aria-label="Scores of the top names">
              {top.map((r, i) => {
                const y = i * 24;
                const w = Math.max(4, (Math.min(Number(r.score) || 0, 5) / 5) * barMax);
                return (
                  <g key={r.ticker}>
                    <text x="0" y={y + 13} className="sc-cbarlab">{r.ticker}</text>
                    <rect x="52" y={y + 4} width={barMax} height="11" rx="5.5" className="sc-cbartrack" />
                    <rect x="52" y={y + 4} width={w} height="11" rx="5.5" className="sc-cbarfill" />
                    <text x="298" y={y + 13} textAnchor="end" className="sc-cbarval">{Number(r.score).toFixed(1)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="sc-crows">
            {top.map((r) => (
              <div key={r.ticker} className="sc-crow">
                <span className="tk">{r.ticker}</span>
                <span className="nm">{r.name || ''}</span>
                {r.insider_rules?.length ? <span className="tag">{RULE_TAG[r.insider_rules[0]] || ''}</span> : null}
                <span className={`val num ${r.chg == null ? '' : r.chg >= 0 ? 'up' : 'down'}`}>{fmtSignedPct(r.chg)}</span>
                <span className="pill num">{Number(r.score).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sc-cmeta" onClick={(e) => e.stopPropagation()}>
        <FreshnessChip
          elementId="equity-trading_opps_scan-daily"
          variant="dot"
          fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
        />
        <span>Latest scan{scanDate ? ` · ${fmtScanDay(scanDate)} close` : ''}</span>
      </div>
    </CockpitTile>
  );
}

/* ── Tile 2 · Power Trend Momentum ──────────────────────────────────────── */

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
      kicker="Scanner 2 · Monthly list"
      title="Power Trend Momentum"
      cadence="Monthly refresh · ranked by trend strength"
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
      kicker="Scanner 3 · Daily scan"
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
  { key: 'insider', label: 'Insider Conviction' },
  { key: 'momentum', label: 'Power Trend Momentum' },
  { key: 'divergence', label: 'RSI Divergence' },
];

export default function ScannerPage() {
  const { rows: rawRows, scanDate, loading } = useTradingOppsTop(100);
  const { byTicker: scoreHist } = useScanScoreHistory();
  const { byTicker: ivDaily } = useLseIvDaily(); // Vol rank column (LSE feed)
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [colState, setColState] = useState(loadColState);
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);
  const [tip, setTip] = useState(null);
  const [desk, setDesk] = useState(null); // null | 'insider' | 'momentum' | 'divergence'
  const navigate = useNavigate();

  const showTip = (e, text) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); };
  const hideTip = () => setTip(null);

  useEffect(() => {
    try { localStorage.setItem(COLS_KEY, JSON.stringify(colState)); } catch { /* ignore */ }
  }, [colState]);

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

  const activeColumns = useMemo(
    () => colState.filter((c) => c.on || LOCKED.includes(c.key)).map((c) => c.key),
    [colState],
  );
  const hiddenCount = colState.length - activeColumns.length;

  const rows = useMemo(
    () => (rawRows || []).map((r) => {
      const h = scoreHist[r.ticker];
      const iv = ivDaily[r.ticker];
      return {
        ...r,
        bucket: bucketFor(Number(r.score) || 0),
        scoreSeries: h?.series || null,
        scoreDelta: h?.delta ?? null,
        daysOnList: h?.daysOnList ?? null,
        scorePeak: h?.peak ?? null,
        volRank: iv?.volRank ?? null,
        atmIv: iv?.atmIv ?? null,
      };
    }),
    [rawRows, scoreHist, ivDaily],
  );

  function toggleCol(key) {
    if (LOCKED.includes(key)) return;
    setColState((prev) => prev.map((c) => (c.key === key ? { ...c, on: !c.on } : c)));
  }

  // Drag a header onto another to move that column there. Ticker stays pinned
  // left and Score pinned right (ScanList enforces the locks too).
  function reorderColumn(fromKey, toKey) {
    if (!fromKey || fromKey === toKey) return;
    if (LOCKED.includes(fromKey) || LOCKED.includes(toKey)) return;
    setColState((prev) => {
      const next = [...prev];
      const from = next.findIndex((c) => c.key === fromKey);
      const to = next.findIndex((c) => c.key === toKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function flashToast(action, ticker) {
    const msg = action === 'copy' ? `Copied ${ticker}` : `Added ${ticker} to watchlist`;
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // Plain-English copy for the scoring inputs (kept verbatim from the
  // approved scanner copy).
  const BUILD_COPY = {
    'Insider': {
      max: '+4',
      rule: 'Open-market buys filed in the last 30 days. Points fire on the rules — not a raw buy count: a C-suite officer lifting their own stake ≥10% (≥$100k), combined buying worth ≥0.05% of the company, or 3+ different insiders buying. Capped at +4 and faded for age — full weight ≤15 days, gone by 31.',
    },
    'Technicals': {
      max: '+1 / −2',
      rule: '+1 when it trades above its 200-day line, −2 below; a further −2 if the 14-day RSI is overbought (above 65).',
    },
  };

  /* The Insider desk body — the exact results card + "How the score is
     built" that used to stack on the page, unchanged. */
  const insiderDesk = (
    <>
      <section className="wrap sc-results">
        <div className="sc-tablecard">
          <div className="sc-panelhead">
            <div>
              <div className="sc-kicker">Scanner 1 · Daily scan</div>
              <h2 className="sc-paneltitle">Insider Conviction Scanner</h2>
              <div className="sc-rule">
                Flags names where executives are buying their own stock and the trend confirms. Every
                liquid US name is scored 0–5 on insider buying plus trend; event-driven, scanned daily.
              </div>
              <div className="sc-rule">A name makes the list at Score ≥ 4 (max 5) and stays on it until its score decays below 3.</div>
              <div className="sc-scanmeta">
                <FreshnessChip
                  elementId="equity-trading_opps_scan-daily"
                  variant="dot"
                  fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
                />
                <span>Latest scan{scanDate ? ` · ${fmtScanDay(scanDate)} close` : ''} · refreshes daily</span>
                <FreshnessChip elementId="equity-lse_iv_scan-daily" variant="dot" />
                <span>Vol rank · implied volatility</span>
                <button type="button" className="sc-metalink" onClick={() => navigate('/methodology#scanner')}>
                  Methodology →
                </button>
              </div>
            </div>
            <div className="sc-panelhead-tools">
              <button
                type="button"
                className={`sc-colbtn ${showCols ? 'on' : ''}`}
                onClick={() => setShowCols((v) => !v)}
                aria-label="Show or hide columns"
                onMouseEnter={(e) => showTip(e, 'Show or hide columns')}
                onMouseLeave={hideTip}
              >
                <span aria-hidden="true">⋯</span> Columns
                {hiddenCount > 0 && <span className="cnt">{activeColumns.length}/{colState.length}</span>}
              </button>
              {showCols && (
                <div className="sc-colpick mt-fade">
              <div className="ph">
                <div className="label">Show / hide columns</div>
                <button type="button" className="lnk" onClick={() => setColState(DEFAULT_COL_STATE)}>Show all</button>
              </div>
              <div className="sc-colgrid">
                {colState.map(({ key, on }) => {
                  const col = INDICATOR_COLS[key];
                  const locked = LOCKED.includes(key);
                  const isOn = on || locked;
                  return (
                    <label key={key} className={`sc-ctog ${isOn ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                      <input type="checkbox" checked={isOn} disabled={locked} onChange={() => toggleCol(key)} />
                      <span>{col.label}</span>
                      {locked && <span aria-hidden="true">🔒</span>}
                    </label>
                  );
                })}
              </div>
              <div className="sc-foot">Reorder by dragging the column headers on the table.</div>
            </div>
              )}
            </div>
          </div>
          {loading ? (
            <div className="sc-loading">Loading scan results…</div>
          ) : (
            <div className="sc-inset">
              <ScanList
                rows={rows}
                drillOpenKey={drillOpenKey}
                setDrillOpenKey={setDrillOpenKey}
                indicatorColumns
                columns={activeColumns}
                onReorderColumn={reorderColumn}
                renderDrill={(r) => <ScanDrill row={r} onAct={flashToast} />}
              />
            </div>
          )}
        </div>
      </section>

      {/* How the score is built — lives inside the Insider desk view now */}
      <section className="wrap sc-buildsec">
        <div className="sc-build">
          <div className="sc-buildhead">
            <div>
              <div className="eyebrow2"><span className="dot" />How the Insider Conviction score is built</div>
              <h2>Two inputs, summed into one 0–5 score · a name needs ≥3 from insider + trend to launch.</h2>
            </div>
            <button type="button" className="sc-ghostbtn" onClick={() => navigate('/methodology#scanner')}>
              Full methodology →
            </button>
          </div>
          <div className="sc-buildgrid">
            {SCORE_COMPONENTS.map((c) => {
              const d = BUILD_COPY[c.key] || { max: '', rule: c.why };
              return (
                <div key={c.key} className="sc-buildcell">
                  <div className="k">{c.key}</div>
                  <div className="why">{d.rule}</div>
                  <div className="w">up to <b>{d.max}</b></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );

  return (
    <div className="home-v12 scanner-v12">
      {tip && createPortal(
        <div className="sc-tip" style={{ left: tip.x, top: tip.y - 8 }}>{tip.text}</div>,
        document.body,
      )}

      {/* Hero — cockpit landing (Joe-approved mockup, 2026-07-30) */}
      <section className="wrap sc-hero">
        <Reveal className="sc-ed">
          <div className="eyebrow2"><span className="dot" />Trading scanner</div>
          <h1>The scanner desk. <i>Three scanners, one cockpit.</i></h1>
          <div className="sc-sub">
            Top conviction from each scanner at a glance. Click any tile to open its desk view —
            every column, sortable, trader-level.
          </div>
        </Reveal>
      </section>

      {/* Cockpit — one tile per scanner */}
      <section className="wrap sc-cockpit">
        <InsiderTile rows={rows} scanDate={scanDate} loading={loading} onOpen={() => setDesk('insider')} />
        <MomentumTile onOpen={() => setDesk('momentum')} />
        <DivergenceTile onOpen={() => setDesk('divergence')} />
      </section>

      {/* Desk view — the full scanner section, unchanged, in an overlay */}
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
              {desk === 'insider' && insiderDesk}
              {desk === 'momentum' && <MomentumPanel />}
              {desk === 'divergence' && <DivergencePanel />}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="sc-toast mt-fade">{toast}</div>}
    </div>
  );
}
