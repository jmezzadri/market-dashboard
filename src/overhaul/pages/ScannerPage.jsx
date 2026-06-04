/* Trading Scanner — refactored 2026-05-27 per Joe Path-A directive.

   2026-06-04: the Columns and Filter toolbar buttons are now LIVE.
   - Columns: real show/hide state per column, drag-to-reorder via the grips,
     a live "shown/total" count, and a Reset link. Ticker + Score are locked
     on. Choices persist in localStorage. The active, ordered column list is
     passed down to ScanList, which builds its grid/header/cells from it.
     The four prior phantom columns (Score 1w, Score 1m, Volume, 52w range)
     were removed — the scan row carries no data for them, so a toggle for
     them would have been a non-functional placeholder.
   - Filter: a real panel with a minimum-score input, a ticker text search,
     and "must include" toggles for the insider / options / dark-pool signals.
     Applied on top of the bucket pills. A live count of active filters shows
     on the button, with a Clear link in the panel. */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import FreshnessChip from '../components/FreshnessChip';
import Tip from '../components/Tip';
import ScanList, { INDICATOR_COLS, INDICATOR_COL_KEYS } from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';
import { SCORE_COMPONENTS } from '../lib/scoreWeights';

function bucketFor(s) {
  if (s >= 4.5) return 'b5';
  if (s >= 3.5) return 'b4';
  return 'b3';
}

const BUCKETS = [
  { key: 'b5', label: 'Score 4.5+',    proto: 'sc-bucket--score7' },
  { key: 'b4', label: 'Score 3.5–4.49', proto: 'sc-bucket--score5' },
  { key: 'b3', label: 'Score 3.0–3.49', proto: 'sc-bucket--score3' },
];

const COLS_STORAGE_KEY = 'mt-scanner-cols-v1';
const LOCKED = ['ticker', 'score'];

// default column model: ordered, all on
const DEFAULT_COL_STATE = INDICATOR_COL_KEYS.map((key) => ({ key, on: true }));

function loadColState() {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_COL_STATE;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return DEFAULT_COL_STATE;
    // keep only known keys, append any new keys that appeared since the save
    const known = saved.filter((c) => INDICATOR_COLS[c.key]);
    const seen = new Set(known.map((c) => c.key));
    INDICATOR_COL_KEYS.forEach((k) => { if (!seen.has(k)) known.push({ key: k, on: true }); });
    // locked columns must stay on
    return known.map((c) => (LOCKED.includes(c.key) ? { ...c, on: true } : c));
  } catch {
    return DEFAULT_COL_STATE;
  }
}

const EMPTY_FILTER = { minScore: '', q: '', need: { insider: false, options: false, dark: false } };

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(100);
  const [bucket, setBucket] = useState('all');
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [showCols, setShowCols] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [colState, setColState] = useState(loadColState);
  const [dragKey, setDragKey] = useState(null);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(colState)); } catch { /* ignore */ }
  }, [colState]);

  const activeColumns = useMemo(
    () => colState.filter((c) => c.on || LOCKED.includes(c.key)).map((c) => c.key),
    [colState],
  );
  const shownCount = activeColumns.length;
  const totalCount = colState.length;

  const rows = useMemo(
    () => (rawRows || []).map((r) => ({
      ...r,
      bucket: bucketFor(Number(r.score) || 0),
    })),
    [rawRows],
  );

  const counts = useMemo(() => {
    const c = { b5: 0, b4: 0, b3: 0 };
    rows.forEach((r) => { c[r.bucket] = (c[r.bucket] || 0) + 1; });
    return c;
  }, [rows]);

  const activeFilterCount =
    (filter.minScore !== '' ? 1 : 0) +
    (filter.q.trim() !== '' ? 1 : 0) +
    Object.values(filter.need).filter(Boolean).length;

  const filtered = useMemo(() => {
    let out = bucket === 'all' ? rows : rows.filter((r) => r.bucket === bucket);
    const min = parseFloat(filter.minScore);
    if (!Number.isNaN(min)) out = out.filter((r) => (Number(r.score) || 0) >= min);
    const q = filter.q.trim().toUpperCase();
    if (q) out = out.filter((r) =>
      String(r.ticker || '').toUpperCase().includes(q) ||
      String(r.name || '').toUpperCase().includes(q));
    if (filter.need.insider) out = out.filter((r) => (r.insider_pts ?? 0) > 0);
    if (filter.need.options) out = out.filter((r) => (r.options_pts ?? 0) > 0);
    if (filter.need.dark) out = out.filter((r) => (r.dark_pool_pts ?? 0) > 0 || r.dark_pool_anchor != null);
    return out;
  }, [rows, bucket, filter]);

  function toggleCol(key) {
    if (LOCKED.includes(key)) return;
    setColState((prev) => prev.map((c) => (c.key === key ? { ...c, on: !c.on } : c)));
  }

  function onColDrop(targetKey) {
    setColState((prev) => {
      if (!dragKey || dragKey === targetKey) return prev;
      const next = [...prev];
      const from = next.findIndex((c) => c.key === dragKey);
      const to = next.findIndex((c) => c.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragKey(null);
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
            <b>options flow</b>, and <b>dark-pool prints</b> — sum into one
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
            {BUCKETS.map((b) => {
              const isOn = bucket === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  className={`sc-bucket ${b.proto} ${isOn ? 'on' : ''}`}
                  onClick={() => setBucket(isOn ? 'all' : b.key)}
                >
                  <span className="num">{counts[b.key] || 0}</span>
                  <span>{b.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <div className="sc-toolbar">
          <div className="mt-pillgroup">
            <button
              type="button"
              className={`mt-pill ${bucket === 'all' ? 'on' : ''}`}
              onClick={() => setBucket('all')}
            >
              All {universeTotal}
            </button>
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`mt-pill ${bucket === b.key ? 'on' : ''}`}
                onClick={() => setBucket(b.key)}
              >
                {b.label} {counts[b.key] || 0}
              </button>
            ))}
          </div>
          <span className="sc-shortnote">
            <Tip content="Engine doesn't yet output short signals — long-only universe today.">
              Long signals only
            </Tip>
          </span>
          <span className="mt-spacer-flex" />
          <button
            type="button"
            className={`mt-btn ${showFilter ? 'on' : ''}`}
            onClick={() => { setShowFilter((v) => !v); setShowCols(false); }}
          >
            ＋ Filter{activeFilterCount > 0 && <span className="sc-colcount num">{activeFilterCount}</span>}
          </button>
          <button
            type="button"
            className={`mt-btn ${showCols ? 'on' : ''}`}
            onClick={() => { setShowCols((v) => !v); setShowFilter(false); }}
          >
            ⚙ Columns <span className="sc-colcount num">{shownCount}/{totalCount}</span>
          </button>
        </div>

        {showFilter && (
          <div className="sc-colpicker mt-fade">
            <div className="sc-filterhead">
              <div className="mt-eyebrow">Filter results</div>
              {activeFilterCount > 0 && (
                <button type="button" className="sc-linkbtn" onClick={() => setFilter(EMPTY_FILTER)}>
                  Clear all
                </button>
              )}
            </div>
            <div className="sc-filtergrid">
              <label className="sc-field">
                <span className="mt-eyebrow">Minimum score</span>
                <input
                  type="number" min="0" max="10" step="0.5" inputMode="decimal"
                  className="sc-input num" placeholder="e.g. 4"
                  value={filter.minScore}
                  onChange={(e) => setFilter((f) => ({ ...f, minScore: e.target.value }))}
                />
              </label>
              <label className="sc-field">
                <span className="mt-eyebrow">Search ticker / name</span>
                <input
                  type="text" className="sc-input" placeholder="e.g. AAPL or Apple"
                  value={filter.q}
                  onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                />
              </label>
              <div className="sc-field">
                <span className="mt-eyebrow">Must include signal</span>
                <div className="sc-needrow">
                  {[
                    ['insider', 'Insider'],
                    ['options', 'Options'],
                    ['dark', 'Dark pool'],
                  ].map(([k, lbl]) => (
                    <label key={k} className={`sc-coltoggle ${filter.need[k] ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={filter.need[k]}
                        onChange={() => setFilter((f) => ({ ...f, need: { ...f.need, [k]: !f.need[k] } }))}
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="sc-filterfoot mt-eyebrow">
              Showing <b className="num">{filtered.length}</b> of <b className="num">{rows.length}</b> names
            </div>
          </div>
        )}

        {showCols && (
          <div className="sc-colpicker mt-fade">
            <div className="sc-filterhead">
              <div className="mt-eyebrow">Show / hide / reorder columns — drag the grips to reorder</div>
              <button type="button" className="sc-linkbtn" onClick={() => setColState(DEFAULT_COL_STATE)}>
                Reset
              </button>
            </div>
            <div className="sc-colgrid">
              {colState.map(({ key, on }) => {
                const col = INDICATOR_COLS[key];
                const locked = LOCKED.includes(key);
                const isOn = on || locked;
                return (
                  <label
                    key={key}
                    className={`sc-coltoggle ${isOn ? 'on' : ''} ${locked ? 'locked' : ''} ${dragKey === key ? 'dragging' : ''}`}
                    draggable={!locked}
                    onDragStart={() => !locked && setDragKey(key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onColDrop(key)}
                    onDragEnd={() => setDragKey(null)}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={locked}
                      onChange={() => toggleCol(key)}
                    />
                    <span className="sc-colgrip">⋮⋮</span>
                    <span>{col.label}</span>
                    {locked && <span className="sc-collock">🔒</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="sc-note">
          <b>Scoring update.</b>{' '}
          Dark-pool prints and options flow are now live inputs to the 0–10
          MacroTilt Score.
        </div>
      </section>

      {/* ScanList */}
      <section className="mt-pagesection mt-pagesection--tight2">
        {loading ? (
          <div className="mt-loadingcard">Loading scan results…</div>
        ) : (
          <ScanList
            rows={filtered}
            drillOpenKey={drillOpenKey}
            setDrillOpenKey={setDrillOpenKey}
            indicatorColumns
            columns={activeColumns}
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
                'Options flow': {
                  max: '+4',
                  rule: "An unusual surge in call buying versus the stock's own baseline.",
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
