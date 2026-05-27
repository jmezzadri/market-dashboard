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

export default function SectorFlow({
  sectors,
  igsBySector,
  expandedSectors,
  expandedIGs,
  toggleSector,
  toggleIG,
  view = 'tilt', // 'tilt' | 'weight' | 'score'
}) {
  return (
    <div style={{ background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', borderRadius: 14 }}>
      {sectors.map((s) => {
        const isExpanded = expandedSectors.has(s.sector);
        const igs = igsBySector[s.sector] || [];
        return (
          <div key={s.sector} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
            <SectorRow
              s={s}
              isExpanded={isExpanded}
              onToggle={() => toggleSector(s.sector)}
              view={view}
            />
            {isExpanded && (
              <SectorDrillBody
                s={s}
                igs={igs}
                expandedIGs={expandedIGs}
                toggleIG={toggleIG}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectorRow({ s, isExpanded, onToggle, view }) {
  const tilt = s.vs_spy_pp ?? 0;
  const isOver = tilt > 0;
  const w = Math.max(28, Math.abs(tilt) * 18);
  const weightPct = (s.weight ?? 0) * 100;

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
        gridTemplateColumns: '1fr 220px 70px 70px',
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
      {/* Centered ±bar — center is 50%, bar extends in tilt direction */}
      <div style={{ position: 'relative', height: 18 }}>
        <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--mt-line-1)' }} />
        <span
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: isOver ? '50%' : `calc(50% - ${w}px)`,
            width: w,
            background: isOver ? 'var(--mt-up)' : 'var(--mt-down)',
            borderRadius: 3,
          }}
        />
      </div>
      <div
        className="num"
        style={{
          textAlign: 'right',
          color: isOver ? 'var(--mt-up)' : 'var(--mt-down)',
          fontWeight: 600,
        }}
      >
        {isOver ? '+' : ''}{fmtPct(tilt, 1)}pp
      </div>
      <div
        className="num"
        style={{
          textAlign: 'right',
          color: 'var(--mt-ink-1)',
          fontSize: 13,
        }}
      >
        {fmtPct(weightPct, 1)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 1 }}>%</span>
      </div>
    </button>
  );
}

function SectorDrillBody({ s, igs, expandedIGs, toggleIG }) {
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
            <span style={{ textAlign: 'right' }}>Score</span>
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
                  <span className="num" style={{ textAlign: 'right', fontSize: 12, color: 'var(--mt-ink-1)' }}>
                    {ig.contributions ? '—' : '—'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--mt-ink-3)' }}>
                    {igOpen ? '▾' : '▸'}
                  </span>
                </button>
                {igOpen && <IGDrill ig={ig} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IGDrill({ ig }) {
  const navigate = useNavigate();
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
        <p style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.55, margin: '6px 0 12px', maxWidth: 480 }}>
          Engine is {ig.tilt_score > 0 ? 'overweighting' : 'underweighting'} <b>{ig.name}</b>{' '}
          based on its contribution profile across the six v11 cycle mechanisms.
        </p>
        {ig.contributions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(ig.contributions).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--mt-ink-2)' }}>{k.replace(/_/g, ' ')}</span>
                <span
                  className="num"
                  style={{ color: v > 0 ? 'var(--mt-up)' : v < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)', fontWeight: 600 }}
                >
                  {v > 0 ? '+' : ''}{Number(v).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
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
