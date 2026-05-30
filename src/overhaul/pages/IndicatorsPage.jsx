/* All Indicators — refactored 2026-05-27 per Joe Path-A directive.

   Changes vs the prior overhaul rebuild:
   - CYCLE_COMPOSITE_IDS is now DERIVED from /methodology_calibration_v11.json
     (tiles[].indicators[].id, unique set). Previously hardcoded — that drift
     against the calibrated framework was a catalog violation.
   - VOL_TRIGGER_IDS stays as labeled DESIGN CONFIG (vix/move/skew). These
     are a framework decision, not user data — closest fit to exception #3
     ("Macro domain one-liners — design copy, never gets stale. Keep.").
     Comment makes the intent explicit so future agents don't mistake it.
   - "11/14 columns" hardcoded count em-dashed — no live column-picker state
     yet, so the count is unknown until that feature ships.
   - Every section spacing override now uses --tight / --tight2 variant
     classes instead of inline style props.
   - Loading state uses .mt-loadingcard class instead of inline styles.
   - Table card uses .mt-tablecard class instead of inline styles.
   - al-row right-alignment uses .al-row--push utility instead of inline. */

import React, { useMemo, useState } from 'react';
import Sparkline from '../components/Sparkline';
import FreshnessChip from '../components/FreshnessChip';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';

const DOMAINS = ['All', 'Rates', 'Credit', 'Equities', 'Money', 'Economy'];

function fmtNum(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
function fmtFreq(freq) {
  const f = String(freq || '').toUpperCase();
  if (f === 'D') return 'Daily';
  if (f === 'W') return 'Weekly';
  if (f === 'M') return 'Monthly';
  if (f === 'Q') return 'Quarterly';
  return freq || '—';
}

export default function IndicatorsPage() {
  const { active, loading } = useIndicators();
  const [domain, setDomain] = useState('All');
  const [sort, setSort] = useState({ key: 'state', dir: 'desc' });
  const [drill, setDrill] = useState(null);

  const filtered = useMemo(() => {
    let rows = active;
    if (domain !== 'All') rows = rows.filter((i) => i.domain === domain);
    // Sort
    const arr = [...rows];
    const key = sort.key;
    const dir = sort.dir === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === 'state') {
        const order = { extreme: 2, elevated: 1, calm: 0 };
        av = order[a.state] ?? -1;
        bv = order[b.state] ?? -1;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [active, domain, sort]);

  function toggleSort(key) {
    setSort((p) => p.key === key ? { key, dir: p.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }
  function arrow(key) {
    if (sort.key !== key) return '';
    return sort.dir === 'desc' ? ' ↓' : ' ↑';
  }

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">All indicators</div>
          <h1 className="mt-h1">
            Every indicator tracked on <i>MacroTilt</i> — what it is, why it matters, how it's used.
          </h1>
          <p className="mt-deck">
            Sourced live from the data registry. <b>Leading</b>, <b>coincident</b>, and <b>lagging</b> indicators
            across <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Money &amp; Banking</b>, and the real <b>Economy</b>.
          </p>
        </div>
      </section>

      <section className="mt-pagesection mt-pagesection--tight">
        <div className="al-toolbar mt-card">
          <div className="al-row">
            <div className="mt-eyebrow">Category</div>
            <div className="mt-pillgroup">
              {DOMAINS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`mt-pill ${domain === d ? 'on' : ''}`}
                  onClick={() => setDomain(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection mt-pagesection--tight2">
        {loading ? (
          <div className="mt-loadingcard">Loading indicators…</div>
        ) : (
          <div className="mt-tablecard">
            <table className="al-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('name')}>Indicator{arrow('name')}</th>
                  <th onClick={() => toggleSort('domain')}>Category{arrow('domain')}</th>
                  <th onClick={() => toggleSort('freq')}>Freq{arrow('freq')}</th>
                  <th onClick={() => toggleSort('typeLabel')}>Type{arrow('typeLabel')}</th>
                  <th>Last refresh</th>
                  <th className="num" onClick={() => toggleSort('value')}>Current{arrow('value')}</th>
                  <th className="num" onClick={() => toggleSort('prior_3m')}>3M ago{arrow('prior_3m')}</th>
                  <th className="num" onClick={() => toggleSort('prior_6m')}>6M ago{arrow('prior_6m')}</th>
                  <th className="num" onClick={() => toggleSort('prior_1y')}>1Y ago{arrow('prior_1y')}</th>
                  <th>5y</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const isOpen = drill === i.id;
                  const color =
                    i.state === 'extreme'
                      ? 'var(--mt-down)'
                      : i.state === 'elevated'
                        ? 'var(--mt-warn)'
                        : 'var(--mt-up)';
                  // 5-year sparkline = full available points (or up to ~1260 daily)
                  const trendPts = (i.points || [])
                    .slice(-Math.min(1260, (i.points || []).length))
                    .map((p) => p[1])
                    .filter(Number.isFinite);
                  return (
                    <React.Fragment key={i.id}>
                      <tr className={`al-row-tr ${isOpen ? 'open' : ''}`} onClick={() => setDrill(isOpen ? null : i.id)}>
                        <td>
                          <div className="al-tk">
                            <div className="al-tkname">{i.name}</div>
                            <div className="al-tkcode">{i.id}</div>
                          </div>
                        </td>
                        <td><span className="al-cat">{i.domain}</span></td>
                        <td><span className="al-freq">{fmtFreq(i.freq)}</span></td>
                        <td>
                          <span className={`al-type al-type--${i.typeLabel === 'LEAD' ? 'extreme' : i.typeLabel === 'COINC' ? 'elevated' : 'calm'}`}>
                            {i.typeLabel}
                          </span>
                        </td>
                        <td>
                          {/* Anchor freshness to the data point actually plotted
                              (i.asOf) — never let a pipeline_health run that ran
                              later than the published file make a stale on-screen
                              value look fresh. The user sees the file, not the cron. */}
                          <FreshnessChip
                            elementId={i.manifestId}
                            fallback={{ asOfIso: i.asOf }}
                            variant="label"
                          />
                        </td>
                        <td className={`num al-current al-current--${i.state}`}>
                          {fmtNum(i.value, i.decimals ?? 2)}<span className="al-unit">{i.unit}</span>
                        </td>
                        <td className="num al-historical">{fmtNum(i.prior_3m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_6m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_1y, i.decimals ?? 2)}</td>
                        <td className="al-sparkcell">
                          <Sparkline data={trendPts} width={140} height={22} stroke={color} showDot={false} />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="al-drill">
                          <td colSpan={10}>
                            <IndicatorDetail ind={i} onClose={() => setDrill(null)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="al-tablefoot">
          <span>
            Showing <b className="num">{filtered.length}</b> of <b className="num">{active.length}</b> indicators
          </span>
          {!loading && <FreshnessChip elementId="market-universe_master-daily" variant="label" />}
        </div>
      </section>
    </div>
  );
}
