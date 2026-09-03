/* IndicatorDetail — inline drill panel that opens below the map / row
   when a dot or table row is clicked. TF pills (1Y / 5Y / 10Y / Max),
   BigHistoryChart, PercentileBar, mean/median/sd/z, narrative, two
   working buttons (Methodology / Close).
   Site-overhaul brief: NO modals. Everything drills inline. */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import BigHistoryChart from './BigHistoryChart';
import PercentileBar from './PercentileBar';
import FreshnessChip from './FreshnessChip';
import IndexOverlayToggles from './IndexOverlayToggles';
import { TAILS } from '../../data/indicatorRegistry';

function sliceByTimeframe(points, tf) {
  if (!points?.length) return [];
  const last = new Date(points[points.length - 1][0]);
  let cutoff;
  if (tf === '1Y') cutoff = new Date(last.getTime() - 365 * 86400000);
  else if (tf === '3Y') cutoff = new Date(last.getTime() - 3 * 365 * 86400000);
  else if (tf === '5Y') cutoff = new Date(last.getTime() - 5 * 365 * 86400000);
  else if (tf === '10Y') cutoff = new Date(last.getTime() - 10 * 365 * 86400000);
  else return points;
  return points.filter((p) => new Date(p[0]) >= cutoff);
}

function fmtNum(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// 1 -> "1st", 22 -> "22nd", 13 -> "13th" — fixes the "1th percentile" class of bug.
function ordSuffix(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Turn FRED series codes inside a source string into clickable links to the
// FRED series page, so you can verify a value at the source in one click
// (e.g. confirm whether a stale reading is FRED's lag or our feed). Joe 2026-06-03.
function linkifyFred(text) {
  if (!text) return text;
  return String(text).split(/(\b[A-Z][A-Z0-9]{2,}\b)/g).map((p, i) =>
    (/^[A-Z][A-Z0-9]{2,}$/.test(p) && p !== 'FRED')
      ? <a key={i} href={`https://fred.stlouisfed.org/series/${p}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mt-accent)', textDecoration: 'underline' }}>{p}</a>
      : p,
  );
}

export default function IndicatorDetail({ ind, onClose, catalog = [], indexSeries = [] }) {
  const [tf, setTf] = useState('5Y');
  const [overlayKey, setOverlayKey] = useState('');
  const [idxOn, setIdxOn] = useState({});
  const navigate = useNavigate();

  const sliced = useMemo(() => sliceByTimeframe(ind.points, tf), [ind.points, tf]);
  const overlay = useMemo(() => {
    if (!overlayKey) return null;
    const c = catalog.find((x) => x.key === overlayKey);
    if (!c || !c.points?.length) return null;
    // The " (index)" suffix is dropdown-only disambiguation — strip it here so
    // the chart legend reads "S&P 500 (indexed)", not "S&P 500 (index) (indexed)".
    return { points: sliceByTimeframe(c.points, tf), label: c.label.replace(/ \(index\)$/, '') };
  }, [overlayKey, catalog, tf]);
  // Amber/red pill zones, in value space. Computed from the SAME trailing
  // 3-year distribution that colors the pill (useIndicators pctRank), so the
  // shading and the pill can never disagree — and the bands stay FIXED as the
  // timeframe changes, because the yardstick doesn't move when you zoom.
  // Directions mirror stateFor() in useIndicators:
  //   high-warns (default): amber 75th–85th percentile, red above 85th
  //   low-warns:            amber 15th–25th percentile, red below 15th
  //   both-ends:            both of the above
  const bands = useMemo(() => {
    const pts = ind.points || [];
    if (!pts.length) return [];
    const lastT = Date.parse(String(pts[pts.length - 1][0]).slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(lastT)) return [];
    const cutT = lastT - 3 * 365 * 86400000;
    const vals = pts
      .filter((p) => {
        const t = Date.parse(String(p[0]).slice(0, 10) + 'T00:00:00Z');
        return Number.isFinite(t) && t >= cutT && typeof p[1] === 'number';
      })
      .map((p) => p[1])
      .sort((a, b) => a - b);
    if (vals.length < 12) return [];
    const q = (f) => {
      const i = (vals.length - 1) * f;
      const lo = Math.floor(i), hi = Math.ceil(i);
      return vals[lo] + (vals[hi] - vals[lo]) * (i - lo);
    };
    const AMBER = 'var(--mt-warn)', RED = 'var(--mt-down)';
    const top = [
      { from: q(0.85), to: null, color: RED, opacity: 0.08, label: 'Red zone' },
      { from: q(0.75), to: q(0.85), color: AMBER, opacity: 0.10, label: 'Amber zone' },
    ];
    const bottom = [
      { from: null, to: q(0.15), color: RED, opacity: 0.08, label: 'Red zone' },
      { from: q(0.15), to: q(0.25), color: AMBER, opacity: 0.10, label: 'Amber zone' },
    ];
    if (ind.direction === 'lw') return bottom;
    if (ind.direction === 'bw') return [...top, ...bottom];
    return top; // 'hw' and anything unmapped — mirrors stateFor's default
  }, [ind.points, ind.direction]);

  const idxCompares = useMemo(
    () => indexSeries
      .filter((x) => idxOn[x.key] && x.points?.length)
      .map((x) => ({ points: sliceByTimeframe(x.points, tf), label: x.label, color: x.color })),
    [indexSeries, idxOn, tf],
  );

  const stats = useMemo(() => {
    const vals = sliced.map((p) => p[1]).filter((v) => Number.isFinite(v));
    if (!vals.length) return { mean: null, median: null, sd: null, z: null };
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const z = sd > 0 ? (ind.value - mean) / sd : null;
    return { mean, median, sd, z };
  }, [sliced, ind.value]);
  const slicePct = useMemo(() => {
    const vals = sliced.map((p) => p[1]).filter((v) => Number.isFinite(v));
    if (!vals.length || ind.value == null) return ind.pct;
    const below = vals.filter((v) => v < ind.value).length;
    return Math.round((below / vals.length) * 100);
  }, [sliced, ind.value, ind.pct]);

  const accent =
    ind.state === 'extreme'
      ? 'var(--mt-down)'
      : ind.state === 'elevated'
        ? 'var(--mt-warn)'
        : 'var(--mt-up)';

  // Plain-English note on how the displayed series relates to the raw vendor
  // feed, read from the manifest's sourcing_mode. "STP" = straight-through
  // from the vendor (no note needed). Everything else means MacroTilt builds
  // the series, so we say how.
  const sourcingNote = (() => {
    const mode = String(ind.sourcingMode || '').toLowerCase();
    if (!mode || mode === 'stp') return null;
    if (mode.includes('curated')) return 'curated by MacroTilt';
    if (mode.includes('anchor')) return 'vendor feed, history anchored in-house by MacroTilt';
    if (mode.includes('computed') || mode.includes('derived')) {
      return 'computed in-house by MacroTilt from the raw source';
    }
    if (mode === 'tbd') return null;
    return null;
  })();

  return (
    <div
      className="mt-card mt-fade ind-detail"
      style={{ marginTop: 16, padding: 24 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div className="mt-eyebrow">{ind.familyFull || ind.domain}</div>
          <div
            style={{
              fontFamily: 'var(--mt-font-display)',
              fontSize: 32,
              fontWeight: 400,
              letterSpacing: '-0.02em',
              margin: '4px 0 0',
              lineHeight: 1.1,
            }}
          >
            {ind.name}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 32, fontWeight: 500, color: accent, lineHeight: 1 }}>
            {fmtNum(ind.value, ind.decimals ?? 2)}
            <span style={{ fontSize: 14, color: 'var(--mt-ink-2)', marginLeft: 6, fontWeight: 400 }}>
              {ind.unit}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <FreshnessChip
              elementId={ind.manifestId || ind.id}
              fallback={{ asOfIso: ind.asOf }}
              variant="label"
            />
          </div>
        </div>
      </header>

      {ind.description && (
        <p style={{ fontSize: 13.5, color: 'var(--mt-ink-1)', lineHeight: 1.65, margin: '0 0 18px' }}>
          {ind.description}
        </p>
      )}

      {/* TF pills */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mt-pillgroup">
          {['1Y', '3Y', '5Y', '10Y', 'Max'].map((k) => (
            <button
              key={k}
              type="button"
              className={`mt-pill ${tf === k ? 'on' : ''}`}
              onClick={() => setTf(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
          <b className="num">{sliced.length.toLocaleString()}</b> observations
        </div>
      </div>

      {/* Overlay picker — compare another series (indexed to the same start) */}
      {catalog.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--mt-ink-2)' }}>
          <span>Overlay:</span>
          <select value={overlayKey} onChange={(e) => setOverlayKey(e.target.value)}
            style={{ font: 'inherit', fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--mt-line-1)', background: 'var(--mt-surface)', color: 'var(--mt-ink-1)', maxWidth: 280 }}>
            <option value="">None</option>
            {catalog.filter((c) => c.label !== ind.name).map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          {overlay && <span style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>(indexed — scales differ)</span>}
        </div>
      )}

      {indexSeries.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <IndexOverlayToggles series={indexSeries} on={idxOn}
            onToggle={(k) => setIdxOn((prev) => ({ ...prev, [k]: !prev[k] }))} />
        </div>
      )}

      {/* History chart */}
      <BigHistoryChart
        points={sliced}
        accent={accent}
        height={260}
        freq={ind.freq}
        yFormat={(v) => fmtNum(v, ind.decimals ?? 2)}
        compareData={overlay ? overlay.points : null}
        compareLabel={overlay ? overlay.label : ''}
        compares={idxCompares}
        bands={bands}
      />
      {bands.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--mt-ink-3)' }}>
          Shaded bands mark where this pill turns amber and red — fixed to the same
          3-year basis that colors the pill, whatever timeframe you select.
        </div>
      )}

      {/* Percentile bar */}
      <div style={{ marginTop: 22, marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 8,
          }}
        >
          <div className="mt-eyebrow">Where today sits in the {tf} distribution</div>
          {/* The tail word, same vocabulary as the tile row this was opened
              from (LESSONS 7.18). Derived from slicePct, not the 3-year pct,
              so it always describes the timeframe actually on screen. */}
          <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
            {slicePct != null && TAILS[ind.id] && (slicePct >= 75 || slicePct <= 25) && (
              <b style={{ color: (slicePct >= 85 || slicePct <= 15) ? 'var(--mt-down)' : 'var(--mt-warn)',
                          letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 6 }}>
                {slicePct <= 50 ? TAILS[ind.id][0] : TAILS[ind.id][1]}
              </b>
            )}
            <b className="num">{slicePct != null ? slicePct : '—'}</b>{slicePct != null ? ordSuffix(slicePct) : ''} percentile
          </div>
        </div>
        <PercentileBar pct={slicePct} direction={ind.direction} />
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginTop: 28,
          paddingTop: 16,
          borderTop: '1px solid var(--mt-line-0)',
        }}
      >
        {[
          ['Mean', fmtNum(stats.mean, ind.decimals ?? 2)],
          ['Median', fmtNum(stats.median, ind.decimals ?? 2)],
          ['Std dev', fmtNum(stats.sd, 2)],
          ['Z-score', fmtNum(stats.z, 2)],
        ].map(([lbl, v]) => (
          <div key={lbl}>
            <div className="mt-eyebrow">{lbl}</div>
            <div className="num" style={{ fontSize: 20, marginTop: 4, color: 'var(--mt-ink-0)' }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* Methodology / how-it's-measured. The per-indicator "what's happening
          now" narrative was removed 2026-05-28 (Joe directive): it was
          hand-written prose referencing specific levels and dates
          ("-109bps in 2023", "down from 23.9 a month ago") that silently
          went stale the moment the market moved. Anything shown here must be
          sourced live, never typed in. The methodology description below is
          static reference copy (formula, source, thresholds) — that does not
          go stale and stays. */}
      {(ind.methodology || ind.description) && (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--mt-ink-2)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            How it's measured
          </summary>
          <p
            style={{
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--mt-ink-1)',
            }}
          >
            {ind.methodology || ind.description}
          </p>
        </details>
      )}

      {/* Source line — names the raw vendor AND, when MacroTilt builds the
          indicator itself rather than reading it straight from the vendor,
          says so explicitly. Joe directive 2026-05-28: if we source raw data
          from somewhere but derive the indicator in-house, that must be on the
          screen so nobody mistakes a computed series for a vendor feed. */}
      {ind.sourceVendor && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--mt-ink-2)' }}>
          Source: <b style={{ color: 'var(--mt-ink-1)' }}>{ind.sourceVendor}</b>
          {ind.sourceEndpoint ? <> · {/FRED/i.test(ind.sourceVendor || '') ? linkifyFred(ind.sourceEndpoint) : ind.sourceEndpoint}</> : ''}
          {sourcingNote && (
            <span style={{ color: 'var(--mt-ink-1)' }}> · {sourcingNote}</span>
          )}
        </div>
      )}

      {/* Buttons */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid var(--mt-line-0)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          className="mt-btn"
          onClick={() => navigate(`/methodology#${ind.familyId || ind.id}`)}
        >
          Methodology →
        </button>
        <button type="button" className="mt-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
