/* PositioningDetail — the drill panel for a CFTC Commitments-of-Traders market
   (the "Positioning · COT extremes" rows on /macro).

   2026-09-01: this component did not exist. MacroPage.jsx rendered
   <PositioningDetail> at line 661 and imported nothing, so clicking ANY
   positioning row — or loading /macro?pos=<market> — threw
   "ReferenceError: PositioningDetail is not defined" and blanked the whole
   page to a white screen. Reported by Joe as "I can't open Silver
   positioning… or any modal for that matter": the first crash unmounts the
   React tree, so every other modal appears dead until a reload.

   The maths shown here is read straight off public/cot_positioning.json,
   which scripts/build_cot_positioning.py computes as:
     netPct   = (non-commercial long − short) / open interest, per weekly report
     spec/comm = percentile rank of that net% inside its own trailing
                 156-week (3-year) window — pctrank() counts the share of
                 weeks at or below today's reading
     div      = spec >= 90 and comm <= 10, or spec <= 10 and comm >= 90
   Nothing is recomputed in the browser. */

import React, { useMemo, useState } from 'react';
import BigHistoryChart from './BigHistoryChart';
import PercentileBar from './PercentileBar';

function ordSuffix(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}
function ord(n) { return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}${ordSuffix(n)}`; }

function fmtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function signed(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;
}

function sliceYears(points, years) {
  if (!points?.length || years == null) return points || [];
  const last = new Date(`${points[points.length - 1][0]}T00:00:00Z`);
  const cutoff = new Date(last.getTime() - years * 365 * 86400000);
  return points.filter((p) => new Date(`${p[0]}T00:00:00Z`) >= cutoff);
}

// Plain-English read. Percentile thresholds match build_cot_positioning.py
// (TAIL_LOW 10 / TAIL_HIGH 90) so the drill can never disagree with the row.
function specRead(market, spec, specNet) {
  const side = specNet > 0 ? 'net long' : specNet < 0 ? 'net short' : 'flat';
  if (spec == null) return `No ranked speculator history for ${market}.`;
  if (spec >= 90) {
    return `Speculators are crowded — ${side} ${Math.abs(specNet).toFixed(1)}% of open interest, the ${ord(spec)} percentile of the last three years. Crowded positioning is a contrarian signal: when everyone is already on one side, there is nobody left to buy, and unwinds tend to be sharp.`;
  }
  if (spec <= 10) {
    return `Speculators are washed out — ${side} ${Math.abs(specNet).toFixed(1)}% of open interest, the ${ord(spec)} percentile of the last three years. The crowd has already left, which historically leaves room for the position to be rebuilt.`;
  }
  return `Speculators are ${side} ${Math.abs(specNet).toFixed(1)}% of open interest — the ${ord(spec)} percentile of the last three years. Mid-range: no crowded extreme to fade this week.`;
}

export default function PositioningDetail({ item, domain, blurb, onClose }) {
  const [tf, setTf] = useState('3Y');
  if (!item) return null;

  const { market, spec, comm, specNet, commNet, div, oi, asof, history } = item;

  const specPts = useMemo(
    () => sliceYears((history || []).map((h) => [h[0], h[1]]), tf === '1Y' ? 1 : tf === '3Y' ? 3 : null),
    [history, tf],
  );
  const commPts = useMemo(
    () => sliceYears((history || []).map((h) => [h[0], h[2]]), tf === '1Y' ? 1 : tf === '3Y' ? 3 : null),
    [history, tf],
  );
  const hasComm = comm != null && commPts.some((p) => p[1] != null);

  const label = { fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mt-ink-3)', fontWeight: 700 };
  const statV = { fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 2 };
  const accent = spec >= 90 || spec <= 10 ? 'var(--mt-down)' : spec >= 75 || spec <= 25 ? 'var(--mt-warn)' : 'var(--mt-ink-0)';

  return (
    <div className="mt-card mt-fade ind-detail" style={{ marginTop: 0, padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mt-eyebrow">{domain ? `${domain} · Positioning` : 'Positioning'}</div>
          <div style={{ fontFamily: 'var(--mt-font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.1 }}>
            {market}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 32, fontWeight: 500, color: accent, lineHeight: 1 }}>
            {ord(spec)}
          </div>
          <div style={{ ...label, marginTop: 4 }}>Speculator percentile</div>
        </div>
      </header>

      {blurb && (
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--mt-ink-1)', margin: '0 0 14px', maxWidth: '72ch' }}>
          {blurb}
        </p>
      )}

      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--mt-ink-1)', margin: '0 0 18px', maxWidth: '72ch' }}>
        {specRead(market, spec, specNet)}
      </p>

      {div && (
        <div style={{ border: '1px solid var(--mt-warn)', borderRadius: 'var(--mt-r-md)', padding: '10px 14px', marginBottom: 18, fontSize: 13.5, lineHeight: 1.55, color: 'var(--mt-ink-1)' }}>
          <b>Divergence.</b> Speculators and commercial hedgers sit at opposite three-year extremes.
          The people who use the physical commodity are taking the other side of the crowd — historically
          the more informed side of that trade.
        </div>
      )}

      {/* ── percentile bars ── */}
      <div style={{ display: 'grid', gap: 22, marginBottom: 26 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
            <span style={label}>Speculators — the crowd</span>
            <span className="num" style={{ fontSize: 13, color: 'var(--mt-ink-1)' }}>{ord(spec)} percentile</span>
          </div>
          <PercentileBar pct={spec} direction="bw" />
        </div>
        {hasComm && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
              <span style={label}>Commercial hedgers — the users</span>
              <span className="num" style={{ fontSize: 13, color: 'var(--mt-ink-1)' }}>{ord(comm)} percentile</span>
            </div>
            <PercentileBar pct={comm} direction="bw" />
          </div>
        )}
      </div>

      {/* ── the numbers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, padding: '16px 0', borderTop: '1px solid var(--mt-line-1)', borderBottom: '1px solid var(--mt-line-1)', marginBottom: 20 }}>
        <div>
          <div style={label}>Speculator net</div>
          <div className="num" style={statV}>{signed(specNet)}<span style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginLeft: 4 }}>% of OI</span></div>
        </div>
        {commNet != null && (
          <div>
            <div style={label}>Hedger net</div>
            <div className="num" style={statV}>{signed(commNet)}<span style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginLeft: 4 }}>% of OI</span></div>
          </div>
        )}
        {oi != null && (
          <div>
            <div style={label}>Open interest</div>
            <div className="num" style={statV}>{Number(oi).toLocaleString()}<span style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginLeft: 4 }}>contracts</span></div>
          </div>
        )}
        <div>
          <div style={label}>Report week</div>
          <div className="num" style={statV}>{fmtDate(asof)}</div>
        </div>
      </div>

      {/* ── history ── */}
      {specPts.length > 1 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={label}>Net position as a share of open interest</div>
            <div className="mt-pillgroup">
              {['1Y', '3Y', 'Max'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mt-pill${tf === t ? ' on' : ''}`}
                  aria-pressed={tf === t}
                  onClick={() => setTf(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <BigHistoryChart
            points={specPts}
            primaryLabel="Speculators"
            accent="var(--mt-accent)"
            height={260}
            freq="W"
            yFormat={(v) => `${v.toFixed(0)}%`}
            overlays={hasComm ? [{ points: commPts, color: 'var(--mt-ink-3)', label: 'Hedgers', dash: '4 3' }] : []}
          />
          <p style={{ fontSize: 12, color: 'var(--mt-ink-3)', margin: '8px 0 0', lineHeight: 1.55, maxWidth: '80ch' }}>
            Weekly, from the CFTC Commitments of Traders report. Above zero is net long, below zero net short.
            The percentiles above rank today's reading inside its own trailing 156-week range — so a high
            percentile means crowded relative to this market's own history, not relative to any other market.
          </p>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--mt-line-1)' }}>
        <div style={{ fontSize: 12, color: 'var(--mt-ink-3)' }}>
          Source: <b style={{ color: 'var(--mt-ink-2)' }}>CFTC</b> · Commitments of Traders, published Fridays for the prior Tuesday
        </div>
        {onClose && (
          <button type="button" className="mt-btn" onClick={onClose}>Close</button>
        )}
      </div>
    </div>
  );
}
