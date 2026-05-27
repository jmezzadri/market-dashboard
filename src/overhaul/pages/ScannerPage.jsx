/* Trading Scanner — refactored 2026-05-27 per Joe Path-A directive.

   Changes vs the prior overhaul rebuild:
   - Bucket cards now use the prototype's .sc-results / .sc-results-head
     / .sc-buckets / .sc-bucket.sc-bucket--score{7,5,3} classes instead
     of inline-styled approximations. Score 4.5+ maps to --score7 (green),
     3.5–4.49 to --score5 (accent), 3.0–3.49 to --score3 (neutral).
   - Toolbar uses .sc-toolbar.
   - Column picker uses .sc-colpicker / .sc-colgrid / .sc-coltoggle /
     .sc-colgrip / .sc-collock.
   - Score-built cards use .sc-buildgrid / .sc-buildcell / .sc-buildwhy /
     .sc-buildw.
   - "Scoring updated" copy uses .sc-note (no more hardcoded date — the
     date was a catalog violation; rephrased so it doesn't pretend to be
     a changelog timestamp).
   - SCORE_WEIGHTS imported from shared lib/scoreWeights.js — no more
     duplicate with ScanDrill.
   - "11/14 columns" hardcoded count em-dashed (no live picker state).
   - Toast positioned via .mt-toast utility class.
   - Zero inline style props on this page after the refactor. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import FreshnessChip from '../components/FreshnessChip';
import Tip from '../components/Tip';
import ScanList from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';
import { SCORE_WEIGHTS } from '../lib/scoreWeights';

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

const COLUMNS = [
  ['Last trade',        true,  false],
  ['Ticker',            true,  true],
  ['Signal',            true,  false],
  ['Score',             true,  true],
  ['Score 1w',          true,  false],
  ['Score 1m',          true,  false],
  ['Insider activity',  true,  false],
  ['Dark pool anchor',  true,  false],
  ['Options vol shock', false, false],
  ['Chart',             true,  false],
  ['Price',             true,  false],
  ['Change',            true,  false],
  ['Volume',            true,  false],
  ['52w range',         true,  false],
];

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(100);
  const [bucket, setBucket] = useState('all');
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

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

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows;
    return rows.filter((r) => r.bucket === bucket);
  }, [rows, bucket]);

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
            Five signals — <b>insider activity</b>, <b>dark-pool prints</b>,{' '}
            <b>options flow</b>, <b>congressional trades</b>, and{' '}
            <b>technicals</b> — rolled into one MacroTilt Score (0–5).
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
            <FreshnessChip elementId="equity-latest_scan_data-daily" variant="label" />
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
          <button type="button" className="mt-btn">＋ Filter</button>
          <button
            type="button"
            className="mt-btn"
            onClick={() => setShowCols(!showCols)}
          >
            ⚙ Columns <span className="sc-colcount num">—</span>
          </button>
        </div>
        {showCols && (
          <div className="sc-colpicker mt-fade">
            <div className="mt-eyebrow">Show / hide / reorder columns</div>
            <div className="sc-colgrid">
              {COLUMNS.map(([name, on, locked]) => (
                <label
                  key={name}
                  className={`sc-coltoggle ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}
                >
                  <input type="checkbox" checked={on} readOnly />
                  <span className="sc-colgrip">⋮⋮</span>
                  <span>{name}</span>
                  {locked && <span className="sc-collock">🔒</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="sc-note">
          <b>Scoring update.</b>{' '}
          The dark-pool and options layers are now live, raising the score
          ceiling. These two layers are not yet backtested — treat them as
          developing signals.
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
              <div className="mt-h2">Six inputs · one number per ticker.</div>
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
            {SCORE_WEIGHTS.map((c) => (
              <div key={c.key} className="sc-buildcell">
                <div className="mt-eyebrow">{c.key}</div>
                <div className="sc-buildwhy">{c.why}</div>
                <div className="sc-buildw">
                  weight <b className="num">{(c.weight * 100).toFixed(0)}%</b>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
