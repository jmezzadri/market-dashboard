/* Trading Scanner — CREAM "home-v12" system (cream rebrand Phase B).

   Cream rebrand Phase B (2026-07-07): page moved from the home-v11 glass
   scope to the shared home-v12 cream system (cream-system.css) with page
   styles in scanner-v12.css. RESKIN ONLY — classNames, layout wrappers and
   CSS; zero data/logic/chip changes. The results table (ScanList) keeps all
   of its behaviour — every column shown by default, a gear show/hide chooser,
   drag a header to reorder, click a header to sort, click a row to drill —
   and reads cream through a --mt-* token bridge in scanner-v12.css (no edit
   to the shared table component; the row Tip tooltips portal OUTSIDE this
   scope and keep the app's solid tokens, as before). Every value remains
   live; the scan keeps its freshness chip. Score-band boxes in the hero are
   plain counts, not filters.

   History: refactored 2026-05-27 (Path-A); columns grouped 2026-06-17;
   home-v11 glass era 2026-06-24 → 2026-07-07. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import useScanScoreHistory from '../../hooks/useScanScoreHistory';
import FreshnessChip from '../components/FreshnessChip';
import ScanList, { INDICATOR_COLS, INDICATOR_COL_KEYS } from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';
import { SCORE_COMPONENTS } from '../lib/scoreWeights';
import '../styles/cream-system.css';
import '../styles/scanner-v12.css';

function bucketFor(s) {
  if (s >= 5) return 'b5';
  if (s >= 4) return 'b4';
  return 'b3';
}

const BUCKETS = [
  { key: 'b5', cls: 'b5', label: 'Score 5+ · Buy', tip: 'Score 5.0 or higher — the buy line. The paper book buys at Score ≥ 5 and exits below 5.' },
  { key: 'b4', cls: 'b4', label: 'Score 4–4.99',    tip: 'Score 4.0–4.99 — on watch, just below the buy line.' },
  { key: 'b3', cls: 'b3', label: 'Score 3–3.99',    tip: 'Score 3.0–3.99 — the entry threshold to make the watch list.' },
];

// Saved state is column order + show/hide. Every column is ON by default; the
// gear only hides what you opt out of. Reorder by dragging the header cells on
// the table. Ticker pinned left, Score pinned right. Key bump clears older
// saved layouts so everyone lands on the full grouped set once.
const COLS_KEY = 'mt-scanner-cols-v6';
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

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(100);
  const { byTicker: scoreHist, movers, priorDate } = useScanScoreHistory();
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [colState, setColState] = useState(loadColState);
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);
  const [tip, setTip] = useState(null);
  const navigate = useNavigate();

  const showTip = (e, text) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); };
  const hideTip = () => setTip(null);

  useEffect(() => {
    try { localStorage.setItem(COLS_KEY, JSON.stringify(colState)); } catch { /* ignore */ }
  }, [colState]);

  const activeColumns = useMemo(
    () => colState.filter((c) => c.on || LOCKED.includes(c.key)).map((c) => c.key),
    [colState],
  );
  const hiddenCount = colState.length - activeColumns.length;

  const rows = useMemo(
    () => (rawRows || []).map((r) => {
      const h = scoreHist[r.ticker];
      return {
        ...r,
        bucket: bucketFor(Number(r.score) || 0),
        scoreSeries: h?.series || null,
        scoreDelta: h?.delta ?? null,
        daysOnList: h?.daysOnList ?? null,
        scorePeak: h?.peak ?? null,
      };
    }),
    [rawRows, scoreHist],
  );

  const counts = useMemo(() => {
    const c = { b5: 0, b4: 0, b3: 0 };
    rows.forEach((r) => { c[r.bucket] = (c[r.bucket] || 0) + 1; });
    return c;
  }, [rows]);

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

  const universeTotal = bandCounts.total || rows.length || 0;

  // Plain-English copy for the four scoring inputs (kept verbatim from the
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
    'Options shock': {
      max: '+4',
      rule: 'An unusual surge in call buying versus the contract’s own prior open interest.',
    },
    'Dark pool': {
      max: '+2',
      rule: 'Large off-exchange block prints clustered near the day’s average price.',
    },
  };

  return (
    <div className="home-v12 scanner-v12">
      {tip && createPortal(
        <div className="sc-tip" style={{ left: tip.x, top: tip.y - 8 }}>{tip.text}</div>,
        document.body,
      )}

      {/* Hero — editorial left, scan card right */}
      <section className="wrap sc-hero">
        <Reveal className="sc-ed">
          <div className="eyebrow2"><span className="dot" />Trading scanner</div>
            <h1>Cutting through the noise with <i>proprietary signal intelligence</i> to find trading opportunities.</h1>
            <ul className="impl">
              <li><b>Two signals</b> — insider activity and technicals — sum into one live MacroTilt Score from 0 to 5. A name needs at least 3 to make the list. Options shock and dark-pool prints show as context only (shelved from the score on 2026-07-07 — unvalidated).</li>
              <li><b>Scanner indicates a buy with a Score ≥ 5</b>; the $1M paper book buys a fixed $100K per name (equal-weight, no leverage).{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/methodology#scanner'); }}>See the scoring methodology →</a></li>
            </ul>
        </Reveal>

        <Reveal className="sc-scan">
            <div className="sc-scantop">
              <div className="label">Today’s scan{scanDate ? ` · ${scanDate}` : ''}</div>
              <FreshnessChip
                elementId="equity-latest_scan_data-daily"
                variant="dot"
                fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
              />
            </div>
            <ScanMovers movers={movers} priorDate={priorDate} onPick={(tk) => navigate(`/ticker/${tk}`)} />
            <div className="sc-bands">
              {BUCKETS.map((b) => (
                <div
                  key={b.key}
                  className={`sc-band ${b.cls}`}
                  onMouseEnter={(e) => showTip(e, b.tip)}
                  onMouseLeave={hideTip}
                >
                  <div className="n">{counts[b.key] || 0}</div>
                  <div className="l">{b.label}</div>
                </div>
              ))}
            </div>
        </Reveal>
      </section>

      {/* Results — grouped columns, all shown. Gear hides columns; drag a
          header to move a column; click a header to sort. */}
      <section className="wrap sc-results">
        <div className="sc-tablecard">
          <div className="sc-panelhead">
            <h2 className="sc-paneltitle">Trading Scanner</h2>
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
            <ScanList
              rows={rows}
              drillOpenKey={drillOpenKey}
              setDrillOpenKey={setDrillOpenKey}
              indicatorColumns
              columns={activeColumns}
              onReorderColumn={reorderColumn}
              renderDrill={(r) => <ScanDrill row={r} onAct={flashToast} />}
            />
          )}
        </div>
        {toast && <div className="sc-toast mt-fade">{toast}</div>}
      </section>

      {/* How the score is built */}
      <section className="wrap sc-buildsec">
        <Reveal className="sc-build">
          <div className="sc-buildhead">
            <div>
              <div className="eyebrow2"><span className="dot" />How the score is built</div>
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
        </Reveal>
      </section>
    </div>
  );
}

/* Short month-day label, e.g. "Jun 22". */
function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/* Compact score: whole numbers bare, fractions to two places trimmed. */
function fmtScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, '');
}

/* Biggest day-over-day score moves, ranked by magnitude. Green = climbing,
   red = cooling. Fills the Today's Scan card; degrades to a plain line on a
   quiet day so it never looks empty. */
function ScanMovers({ movers, priorDate, onPick }) {
  const list = Array.isArray(movers) ? movers.slice(0, 3) : [];
  return (
    <div className="sc-movers">
      <div className="label">Biggest score moves{priorDate ? ` · since ${fmtDay(priorDate)}` : ''}</div>
      {list.length === 0 ? (
        <div className="sc-movers-empty">No score changes since the prior scan.</div>
      ) : (
        <div className="sc-movers-list">
          {list.map((m) => {
            const up = m.delta > 0;
            return (
              <button type="button" key={m.ticker} className="sc-mover" onClick={() => onPick?.(m.ticker)}>
                <span className={`sc-mv-arrow ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'}</span>
                <span className="sc-mv-tk">{m.ticker}</span>
                <span className="sc-mv-path num">{fmtScore(m.prior)} → {fmtScore(m.today)}</span>
                <span className={`sc-mv-d num ${up ? 'up' : 'down'}`}>{up ? '+' : '−'}{fmtScore(Math.abs(m.delta))}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
