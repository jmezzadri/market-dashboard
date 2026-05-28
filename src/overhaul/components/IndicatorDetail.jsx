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

function sliceByTimeframe(points, tf) {
  if (!points?.length) return [];
  const last = new Date(points[points.length - 1][0]);
  let cutoff;
  if (tf === '1Y') cutoff = new Date(last.getTime() - 365 * 86400000);
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

export default function IndicatorDetail({ ind, onClose }) {
  const [tf, setTf] = useState('5Y');
  const navigate = useNavigate();

  const sliced = useMemo(() => sliceByTimeframe(ind.points, tf), [ind.points, tf]);
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

      {/* TF pills */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mt-pillgroup">
          {['1Y', '5Y', '10Y', 'Max'].map((k) => (
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

      {/* History chart */}
      <BigHistoryChart
        points={sliced}
        accent={accent}
        height={260}
        freq={ind.freq}
        yFormat={(v) => fmtNum(v, ind.decimals ?? 2)}
      />

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
          <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
            <b className="num">{ind.pct != null ? ind.pct : '—'}</b>th percentile
          </div>
        </div>
        <PercentileBar pct={ind.pct} direction={ind.direction} />
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
      {ind.description && (
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
            {ind.description}
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
          {ind.sourceEndpoint ? ` · ${ind.sourceEndpoint}` : ''}
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
