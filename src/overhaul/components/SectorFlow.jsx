/* SectorFlow — sector → IG (→ ticker) 3-level inline drill.
   Ported from prototype/lm-shared.jsx (SectorFlow + SectorRow + SectorDrillBody).
   Data shape per row:
     sector: { sector (name), code (XL_), vs_spy_pp, weight (decimal), rating, etfs[], industry_groups? }
     igs:    array of { id, name, tilt_score, contributions{}, tickers[], rating, dollar?, weight? }
*/

import React from 'react';
import { useNavigate } from 'react-router-dom';
import Sparkline from './Sparkline';
import ScoreDial from './ScoreDial';
import FreshnessChip from './FreshnessChip';

function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtPercent(v, digits = 1) {
  // v in decimal (0.21 → 21.0%)
  if (v == null || !Number.isFinite(v)) return '—';
  return (v * 100).toFixed(digits);
}

/* ── Cycle-mechanism transparency (2026-06-16) ────────────────────────────
   Every sector and industry group carries a `contributions` object — six
   numbers, one per cycle-board mechanism, that SUM to the tilt score. We
   surface them so the tilt is traceable rather than a black box. Pure data
   already in v10_allocation.json; nothing here is recomputed. */
const MECH_ORDER = ['valuation', 'credit', 'funding', 'growth', 'liquidity_policy', 'positioning_breadth'];
const MECH_NAME = {
  valuation: 'Valuation',
  credit: 'Credit',
  funding: 'Funding',
  growth: 'Growth',
  liquidity_policy: 'Liquidity & Policy',
  positioning_breadth: 'Positioning & Breadth',
};

// Largest absolute mechanism magnitude across a contributions object — used to
// scale the breakdown bars so the dominant driver fills the channel.
function maxAbsContribution(contributions) {
  if (!contributions) return 1;
  const vals = MECH_ORDER.map((k) => Math.abs(Number(contributions[k]) || 0));
  return Math.max(0.0001, ...vals);
}

// Plain-English "why" sentence naming the top + and − mechanism drivers, so a
// PM reads the tilt without parsing six numbers. e.g. "Technology underweight:
// Valuation drags hardest, Liquidity & Policy partly offsets."
function whyTilt(name, tiltScore, contributions) {
  if (!contributions) return null;
  const entries = MECH_ORDER
    .map((k) => ({ k, name: MECH_NAME[k], v: Number(contributions[k]) || 0 }))
    .filter((e) => Math.abs(e.v) >= 0.001);
  if (!entries.length) return null;
  const dir = tiltScore > 0 ? 'overweight' : tiltScore < 0 ? 'underweight' : 'market-weight';
  // Driver = mechanism pushing in the SAME direction as the tilt (hardest).
  // Offset = mechanism pushing the OTHER way (largest opposing pull).
  const sign = tiltScore >= 0 ? 1 : -1;
  const sameDir = entries.filter((e) => Math.sign(e.v) === sign).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const oppDir = entries.filter((e) => Math.sign(e.v) === -sign).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const verb = tiltScore > 0 ? 'lifts hardest' : 'drags hardest';
  const parts = [];
  if (sameDir.length) parts.push(`${sameDir[0].name} ${verb}`);
  if (sameDir.length > 1) parts.push(`${sameDir[1].name} adds`);
  if (oppDir.length) parts.push(`${oppDir[0].name} partly offsets`);
  if (!parts.length) return `${name} ${dir} — drivers roughly balanced.`;
  return `${name} ${dir}: ${parts.join(', ')}.`;
}

/* MechBreakdown — the six per-mechanism contributions as a compact bar table.
   Each row: mechanism name · signed value · a center-anchored bar (green right
   for +, red left for −). Reused for both sectors and industry groups. Shows
   the mechanism's own band as a faint tag when bands are supplied. */
function MechBreakdown({ contributions, tiltScore, mechBands }) {
  if (!contributions) {
    return <div style={{ color: 'var(--mt-ink-2)', fontSize: 12 }}>No mechanism breakdown for this row.</div>;
  }
  const maxAbs = maxAbsContribution(contributions);
  const sum = MECH_ORDER.reduce((s, k) => s + (Number(contributions[k]) || 0), 0);
  return (
    <div className="at-mechbd">
      {MECH_ORDER.map((k) => {
        const v = Number(contributions[k]) || 0;
        const isPos = v > 0;
        const w = Math.max(2, (Math.abs(v) / maxAbs) * 50); // % of half-track
        const band = mechBands && mechBands[k];
        return (
          <div key={k} className="at-mechbd-row">
            <span className="at-mechbd-name">
              {MECH_NAME[k]}
              {band && <span className={`at-mechbd-band at-mechbd-band--${band === 'risk-off' ? 'off' : band === 'caution' ? 'watch' : 'on'}`} />}
            </span>
            <span className="at-mechbd-track">
              <span className="at-mechbd-mid" />
              <span
                className={`at-mechbd-fill ${isPos ? 'at-mechbd-fill--pos' : 'at-mechbd-fill--neg'}`}
                style={isPos ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
              />
            </span>
            <span
              className="num at-mechbd-val"
              style={{ color: v > 0 ? 'var(--mt-up)' : v < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)' }}
            >
              {v > 0 ? '+' : ''}{v.toFixed(2)}
            </span>
          </div>
        );
      })}
      <div className="at-mechbd-sum">
        <span>Sum = tilt score</span>
        <span className="num" style={{ color: sum > 0 ? 'var(--mt-up)' : sum < 0 ? 'var(--mt-down)' : 'var(--mt-ink-1)' }}>
          {sum > 0 ? '+' : ''}{sum.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// Shared column template: Sector(1fr) | Rating | Recommended % | Prev wk | vs SPY
const GRID = '1fr 64px 120px 110px 96px';

export default function SectorFlow({
  sectors,
  igsBySector,
  expandedSectors,
  expandedIGs,
  toggleSector,
  toggleIG,
  sortKey = 'recommended',
  sleeveRows = [],
  prevBySector = {},
  mechBands = null,
}) {
  return (
    <div style={{ background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', borderRadius: 14 }}>
      {/* Column header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          gap: 16,
          padding: '10px 18px',
          fontSize: 10.5,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--mt-ink-2)',
          fontWeight: 600,
          borderBottom: '1px solid var(--mt-line-0)',
        }}
      >
        <span>Sector</span>
        <span style={{ textAlign: 'right' }}>Rating</span>
        <span style={{ textAlign: 'right' }}>Recommended{sortKey === 'recommended' ? ' ▾' : ''}</span>
        <span style={{ textAlign: 'right' }}>Prev wk</span>
        <span style={{ textAlign: 'right' }}>vs SPY{sortKey === 'tilt' ? ' ▾' : ''}</span>
      </div>

      {sectors.map((s) => {
        const isExpanded = expandedSectors.has(s.sector);
        const igs = igsBySector[s.sector] || [];
        return (
          <div key={s.sector} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
            <SectorRow
              s={s}
              isExpanded={isExpanded}
              onToggle={() => toggleSector(s.sector)}
              prevDollar={prevBySector[s.sector]}
            />
            {isExpanded && (
              <SectorDrillBody
                s={s}
                igs={igs}
                expandedIGs={expandedIGs}
                toggleIG={toggleIG}
                mechBands={mechBands}
              />
            )}
          </div>
        );
      })}

      {/* Defensive sleeve — always rendered under the equity rows. */}
      {sleeveRows.length > 0 && (
        <div style={{ background: 'var(--mt-surface-2)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: 16,
              padding: '8px 18px',
              fontSize: 10.5,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--mt-ink-2)',
              fontWeight: 600,
              borderTop: '1px solid var(--mt-line-0)',
            }}
          >
            <span>Defensive sleeve</span>
            <span /><span /><span /><span />
          </div>
          {sleeveRows.map((d) => (
            <div
              key={d.ticker}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 16,
                alignItems: 'center',
                padding: '12px 18px',
                borderTop: '1px solid var(--mt-line-0)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 22 }}>
                <span style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 11, color: 'var(--mt-ink-2)', fontWeight: 600, minWidth: 36 }}>
                  {d.ticker}
                </span>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--mt-ink-0)' }}>{d.name}</span>
              </div>
              <span style={{ textAlign: 'right', color: 'var(--mt-ink-3)', fontSize: 12 }}>
                {(d.dollar ?? 0) > 0 ? '—' : 'standby'}
              </span>
              <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-1)', fontWeight: 600 }}>
                {fmtPct(d.dollar ?? 0, 1)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 1 }}>%</span>
              </span>
              <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-3)', fontSize: 13 }}>—</span>
              <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-3)', fontSize: 13 }}>—</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectorRow({ s, isExpanded, onToggle, prevDollar }) {
  const tilt = s.vs_spy_pp ?? 0;
  const isOver = tilt > 0;
  const recPct = s.dollar ?? ((s.weight ?? 0) * 100); // % of total portfolio
  const hasPrev = prevDollar != null && Number.isFinite(prevDollar);
  const delta = hasPrev ? recPct - prevDollar : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        appearance: 'none',
        border: 'none',
        background: isExpanded ? 'var(--mt-surface-2)' : 'transparent',
        width: '100%',
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 16,
        alignItems: 'center',
        padding: '14px 18px',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontSize: 12,
            color: 'var(--mt-ink-3)',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform var(--mt-dur-fast) var(--mt-ease)',
          }}
        >
          ▸
        </span>
        <span
          style={{
            fontFamily: 'var(--mt-font-mono)',
            fontSize: 11,
            color: 'var(--mt-ink-2)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            minWidth: 36,
          }}
        >
          {(s.etfs && s.etfs[0]) || s.code || ''}
        </span>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--mt-ink-0)' }}>{s.sector}</span>
      </div>

      {/* Rating */}
      <span style={{ textAlign: 'right' }}>
        <span className={`mt-tag ${s.rating === 'OW' ? 'mt-tag--calm' : s.rating === 'UW' ? 'mt-tag--extreme' : 'mt-tag--range'}`}>
          {s.rating || '—'}
        </span>
      </span>

      {/* Recommended % of total portfolio */}
      <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-0)', fontWeight: 600 }}>
        {fmtPct(recPct, 1)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 1 }}>%</span>
      </span>

      {/* Prev week + delta */}
      <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-2)', fontSize: 13 }}>
        {hasPrev ? (
          <>
            {fmtPct(prevDollar, 1)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11 }}>%</span>
            {delta != null && Math.abs(delta) >= 0.05 && (
              <span style={{ color: delta > 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontSize: 11, marginLeft: 5 }}>
                {delta > 0 ? '+' : ''}{fmtPct(delta, 1)}
              </span>
            )}
          </>
        ) : '—'}
      </span>

      {/* Tilt vs SPY */}
      <span className="num" style={{ textAlign: 'right', color: isOver ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}>
        {isOver ? '+' : ''}{fmtPct(tilt, 1)}pp
      </span>
    </button>
  );
}

function SectorDrillBody({ s, igs, expandedIGs, toggleIG, mechBands = null }) {
  const why = whyTilt(s.sector, s.tilt_score ?? s.vs_spy_pp ?? 0, s.contributions);
  return (
    <div
      className="mt-fade"
      style={{ padding: '14px 18px 18px 44px', background: 'var(--mt-surface-2)' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div className="mt-eyebrow">Sector reading</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: 'var(--mt-ink-1)',
              marginTop: 4,
            }}
          >
            <span>Rating</span><b style={{ color: 'var(--mt-ink-0)' }}>{s.rating || '—'}</b>
            <span style={{ width: 1, height: 10, background: 'var(--mt-line-1)' }} />
            <span>ETFs</span>
            <span className="num" style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 11, color: 'var(--mt-ink-2)' }}>
              {(s.etfs || []).join(' · ')}
            </span>
            <span style={{ width: 1, height: 10, background: 'var(--mt-line-1)' }} />
            <FreshnessChip elementId="v10-allocation-daily" variant="label" />
          </div>
        </div>
      </div>

      {/* Why this sector tilts — mechanism breakdown traceable to the cycle
          read above. The six contributions sum to the tilt score. */}
      <div className="at-secwhy">
        <div className="at-secwhy-left">
          <div className="mt-eyebrow">Why the tilt</div>
          {why && <p className="at-secwhy-sentence">{why}</p>}
          <div className="at-secwhy-hint">Each mechanism's contribution to the sector tilt — they sum to the tilt score.</div>
        </div>
        <div className="at-secwhy-right">
          <MechBreakdown contributions={s.contributions} tiltScore={s.tilt_score ?? s.vs_spy_pp ?? 0} mechBands={mechBands} />
        </div>
      </div>

      {igs.length === 0 && (
        <div style={{ color: 'var(--mt-ink-2)', fontSize: 12 }}>
          No industry-group detail for this sector.
        </div>
      )}
      {igs.length > 0 && (
        <div
          style={{
            background: 'var(--mt-surface)',
            border: '1px solid var(--mt-line-0)',
            borderRadius: 10,
            padding: '6px 0',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 200px 70px 70px 20px',
              gap: 12,
              padding: '8px 14px',
              fontSize: 10.5,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--mt-ink-2)',
              fontWeight: 600,
              borderBottom: '1px solid var(--mt-line-0)',
            }}
          >
            <span>Industry group</span>
            <span style={{ textAlign: 'right' }}>Rating</span>
            <span>Tilt vs cap</span>
            <span style={{ textAlign: 'right' }}>Tilt</span>
            <span style={{ textAlign: 'right' }}>vs SPY</span>
            <span />
          </div>
          {igs.map((ig) => {
            const igOpen = expandedIGs.has(ig.id || ig.name);
            const tiltScore = ig.tilt_score ?? 0;
            const isOver = tiltScore > 0;
            const wIG = Math.max(22, Math.abs(tiltScore) * 80);
            return (
              <div key={ig.id || ig.name}>
                <button
                  type="button"
                  onClick={() => toggleIG(ig.id || ig.name)}
                  style={{
                    appearance: 'none',
                    border: 'none',
                    background: igOpen ? 'var(--mt-surface-2)' : 'transparent',
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 200px 70px 70px 20px',
                    gap: 12,
                    padding: '10px 14px',
                    alignItems: 'center',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderTop: '1px solid var(--mt-line-0)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--mt-ink-3)',
                        transform: igOpen ? 'rotate(90deg)' : 'rotate(0)',
                        transition: 'transform var(--mt-dur-fast) var(--mt-ease)',
                      }}
                    >
                      ▸
                    </span>
                    {ig.name}
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span className={`mt-tag ${ig.rating === 'OW' ? 'mt-tag--calm' : ig.rating === 'UW' ? 'mt-tag--extreme' : 'mt-tag--range'}`}>
                      {ig.rating || '—'}
                    </span>
                  </span>
                  <div style={{ position: 'relative', height: 14 }}>
                    <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--mt-line-1)' }} />
                    <span
                      style={{
                        position: 'absolute',
                        top: 3,
                        bottom: 3,
                        left: isOver ? '50%' : `calc(50% - ${wIG}px)`,
                        width: wIG,
                        background: isOver ? 'var(--mt-up)' : 'var(--mt-down)',
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <span
                    className="num"
                    style={{
                      textAlign: 'right',
                      color: isOver ? 'var(--mt-up)' : 'var(--mt-down)',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {isOver ? '+' : ''}{tiltScore.toFixed(2)}
                  </span>
                  <span
                    className="num"
                    style={{
                      textAlign: 'right',
                      fontSize: 12,
                      fontWeight: 600,
                      color: ig.vs_spy_pp == null ? 'var(--mt-ink-3)'
                        : ig.vs_spy_pp > 0 ? 'var(--mt-up)'
                          : ig.vs_spy_pp < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)',
                    }}
                  >
                    {ig.vs_spy_pp == null ? '—' : `${ig.vs_spy_pp > 0 ? '+' : ''}${fmtPct(ig.vs_spy_pp, 1)}pp`}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--mt-ink-3)' }}>
                    {igOpen ? '▾' : '▸'}
                  </span>
                </button>
                {igOpen && <IGDrill ig={ig} mechBands={mechBands} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IGDrill({ ig, mechBands = null }) {
  const navigate = useNavigate();
  const why = whyTilt(ig.name, ig.tilt_score ?? 0, ig.contributions);
  return (
    <div
      className="mt-fade"
      style={{
        padding: '14px 18px 18px 44px',
        background: 'var(--mt-surface-2)',
        borderTop: '1px solid var(--mt-line-0)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 20,
      }}
    >
      <div>
        <div className="mt-eyebrow">Why the tilt</div>
        {why ? (
          <p style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.55, margin: '6px 0 12px', maxWidth: 480 }}>
            {why}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.55, margin: '6px 0 12px', maxWidth: 480 }}>
            Engine is {ig.tilt_score > 0 ? 'overweighting' : 'underweighting'} <b>{ig.name}</b>{' '}
            based on its contribution profile across the six cycle mechanisms.
          </p>
        )}
        <MechBreakdown contributions={ig.contributions} tiltScore={ig.tilt_score ?? 0} mechBands={mechBands} />
      </div>
      <div>
        <div className="mt-eyebrow">ETFs in this group</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {(ig.tickers || []).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => navigate(`/ticker/${tk}`)}
              className="mt-btn"
              style={{ fontFamily: 'var(--mt-font-mono)' }}
            >
              {tk}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
