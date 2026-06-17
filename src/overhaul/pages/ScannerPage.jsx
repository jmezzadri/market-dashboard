/* Trading Scanner — refactored 2026-05-27 per Joe Path-A directive.

   2026-06-17 PM (Joe): columns grouped into Stock / Performance / Technicals /
   MacroTilt signal scores / Other / Score (a grouped header tier renders above
   the column labels). Every column shows by default; a small gear opens a
   show/hide chooser. Reorder by dragging the header cells on the table itself;
   click a header to sort. Row hover is animated. The score-band boxes in the
   hero are plain counts, not filters. */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import FreshnessChip from '../components/FreshnessChip';
import ScanList, { INDICATOR_COLS, INDICATOR_COL_KEYS } from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';
import { SCORE_COMPONENTS } from '../lib/scoreWeights';

function bucketFor(s) {
  if (s >= 4.5) return 'b5';
  if (s >= 3.5) return 'b4';
  return 'b3';
}

const BUCKETS = [
  { key: 'b5', label: 'Score 4.5+',     proto: 'sc-bucket--score7' },
  { key: 'b4', label: 'Score 3.5–4.49', proto: 'sc-bucket--score5' },
  { key: 'b3', label: 'Score 3.0–3.49', proto: 'sc-bucket--score3' },
];

// v5 (2026-06-17 PM): saved state is column order + show/hide. Every column is
// ON by default; the gear only hides what you opt out of. Reorder happens by
// dragging the header cells on the table. Ticker pinned left, Score pinned
// right. Key bump clears older saved layouts so everyone lands on the full
// grouped set once.
const COLS_KEY = 'mt-scanner-cols-v5';
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

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(100);
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [colState, setColState] = useState(loadColState);
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    try { localStorage.setItem(COLS_KEY, JSON.stringify(colState)); } catch { /* ignore */ }
  }, [colState]);

  const activeColumns = useMemo(
    () => colState.filter((c) => c.on || LOCKED.includes(c.key)).map((c) => c.key),
    [colState],
  );
  const hiddenCount = colState.length - activeColumns.length;

  const rows = useMemo(
    () => (rawRows || []).map((r) => ({ ...r, bucket: bucketFor(Number(r.score) || 0) })),
    [rawRows],
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

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Trading scanner</div>
          <h1 className="mt-h1">
            Cutting through the noise with <i>proprietary signal intelligence</i>{' '}
            to find trading opportunities.
          </h1>
          <p className="mt-deck">
            Four signals — <b>insider activity</b>, <b>technicals</b>,{' '}
            <b>options shock</b>, and <b>dark-pool prints</b> — sum into one
            live MacroTilt Score from 0 to 10. A name needs at least 3 to make
            the list.
            Long alerts today <b className="num">{universeTotal}</b>.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate('/methodology#scanner'); }}
            >
              See the scoring methodology →
            </a>
          </p>
        </div>
        <div className="sc-results">
          <div className="sc-results-head">
            <div className="mt-eyebrow">
              Today's scan{scanDate ? ` · ${scanDate}` : ''}
            </div>
            <FreshnessChip
              elementId="equity-latest_scan_data-daily"
              variant="label"
              fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
            />
          </div>
          <div className="sc-buckets">
            {BUCKETS.map((b) => (
              <div key={b.key} className={`sc-bucket ${b.proto}`}>
                <span className="num">{counts[b.key] || 0}</span>
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Results — grouped columns, all shown. Gear hides columns; drag a header
          to move a column; click a header to sort. Wide table scrolls sideways. */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10, position: 'relative' }}>
          <span className="mt-eyebrow" style={{ marginRight: 'auto', color: 'var(--mt-ink-3)' }}>
            Drag a column header to reorder · click to sort
          </span>
          <button
            type="button"
            className={`mt-btn ${showCols ? 'on' : ''}`}
            onClick={() => setShowCols((v) => !v)}
            title="Show or hide columns"
            aria-label="Show or hide columns"
            style={{ fontSize: 20, lineHeight: 1, padding: '7px 11px' }}
          >
            <span aria-hidden="true">⚙</span>
            {hiddenCount > 0 && <span className="sc-colcount num" style={{ fontSize: 11 }}>{activeColumns.length}/{colState.length}</span>}
          </button>
          {showCols && (
            <div
              className="sc-colpicker mt-fade"
              style={{ position: 'absolute', top: '100%', right: 0, zIndex: 30, marginTop: 6, minWidth: 300 }}
            >
              <div className="sc-filterhead">
                <div className="mt-eyebrow">Show / hide columns</div>
                <button type="button" className="sc-linkbtn" onClick={() => setColState(DEFAULT_COL_STATE)}>
                  Show all
                </button>
              </div>
              <div className="sc-colgrid">
                {colState.map(({ key, on }) => {
                  const col = INDICATOR_COLS[key];
                  const locked = LOCKED.includes(key);
                  const isOn = on || locked;
                  return (
                    <label key={key} className={`sc-coltoggle ${isOn ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                      <input type="checkbox" checked={isOn} disabled={locked} onChange={() => toggleCol(key)} />
                      <span>{col.label}</span>
                      {locked && <span className="sc-collock">🔒</span>}
                    </label>
                  );
                })}
              </div>
              <div className="sc-filterfoot mt-eyebrow">
                Reorder by dragging the column headers on the table.
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-loadingcard">Loading scan results…</div>
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
        {toast && <div className="mt-toast mt-fade">{toast}</div>}
      </section>

      {/* How the score is built */}
      <section className="mt-pagesection">
        <div className="mt-card">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">How the score is built</div>
              <div className="mt-h2">Four inputs, summed into one 0–10 score · a name needs ≥3 from insider + trend to launch.</div>
            </div>
            <button
              type="button"
              className="mt-btn mt-btn--ghost"
              onClick={() => navigate('/methodology#scanner')}
            >
              Full methodology →
            </button>
          </div>
          <div className="sc-buildgrid">
            {SCORE_COMPONENTS.map((c) => {
              const d = {
                'Insider': {
                  max: '+4',
                  rule: "Open-market buys filed in the last 30 days. Points fire on the rules — not a raw buy count: a C-suite officer lifting their own stake ≥10% (≥$100k), combined buying worth ≥0.05% of the company, or 3+ different insiders buying. Capped at +4 and faded for age — full weight ≤15 days, gone by 31.",
                },
                'Technicals': {
                  max: '+1 / −2',
                  rule: '+1 when it trades above its 200-day line, −2 below; a further −2 if the 14-day RSI is overbought (above 65).',
                },
                'Options shock': {
                  max: '+4',
                  rule: "An unusual surge in call buying versus the contract's own prior open interest.",
                },
                'Dark pool': {
                  max: '+2',
                  rule: "Large off-exchange block prints clustered near the day's average price.",
                },
              }[c.key] || { max: '', rule: c.why };
              return (
                <div key={c.key} className="sc-buildcell">
                  <div className="mt-eyebrow">{c.key}</div>
                  <div className="sc-buildwhy">{d.rule}</div>
                  <div className="sc-buildw">
                    up to <b className="num">{d.max}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
