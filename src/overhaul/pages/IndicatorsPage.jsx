/* All Indicators — rebuilt 2026-05-27 to prototype/pages/indicators.jsx.
   - Layer pills: All / Vol triggers / Cycle composite / Reference
   - Type column shows LEAD / COINC / LAG (from registryTier 1/2/3)
   - 5y sparkline (full data)
   - Hero summary uses FreshnessChip pill + 3-cell grid of layer counts. */

import React, { useMemo, useState } from 'react';
import Sparkline from '../components/Sparkline';
import FreshnessChip from '../components/FreshnessChip';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';

const LAYERS = ['All', 'Vol triggers', 'Cycle composite', 'Reference'];
const DOMAINS = ['All', 'Rates', 'Credit', 'Equities', 'Money', 'Economy'];

// Vol triggers — the named volatility indicators
const VOL_TRIGGER_IDS = new Set(['vix', 'move', 'skew']);
// Cycle composite — the v11 framework's calibrated set (10 active mapped today)
const CYCLE_COMPOSITE_IDS = new Set(['cape', 'erp', 'buffett', 'ig_oas', 'hy_oas', 'hy_ig_ratio', 'cfnai_3ma', 'jobless', 'ism', 'hy_ig']);

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
  const [layer, setLayer] = useState('All');
  const [domain, setDomain] = useState('All');
  const [sort, setSort] = useState({ key: 'state', dir: 'desc' });
  const [drill, setDrill] = useState(null);

  const counts = useMemo(() => ({
    vol: active.filter((i) => VOL_TRIGGER_IDS.has(i.id)).length,
    cycle: active.filter((i) => CYCLE_COMPOSITE_IDS.has(i.id)).length,
    reference: active.filter((i) => !VOL_TRIGGER_IDS.has(i.id) && !CYCLE_COMPOSITE_IDS.has(i.id)).length,
  }), [active]);

  const filtered = useMemo(() => {
    let rows = active;
    if (layer === 'Vol triggers') rows = rows.filter((i) => VOL_TRIGGER_IDS.has(i.id));
    else if (layer === 'Cycle composite') rows = rows.filter((i) => CYCLE_COMPOSITE_IDS.has(i.id));
    else if (layer === 'Reference') rows = rows.filter((i) => !VOL_TRIGGER_IDS.has(i.id) && !CYCLE_COMPOSITE_IDS.has(i.id));
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
  }, [active, layer, domain, sort]);

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
        <div className="al-summary">
          <FreshnessChip elementId="market-universe_master-daily" variant="pill" label={`${active.length} indicators`} />
          <div className="al-summarygrid">
            <div>
              <div className="mt-eyebrow">Vol triggers</div>
              <b className="num al-sumnum">{counts.vol}</b>
            </div>
            <div>
              <div className="mt-eyebrow">Cycle composite</div>
              <b className="num al-sumnum">{counts.cycle}</b>
            </div>
            <div>
              <div className="mt-eyebrow">Reference</div>
              <b className="num al-sumnum">{counts.reference}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 16, paddingBottom: 12 }}>
        <div className="al-toolbar mt-card">
          <div className="al-row">
            <div className="mt-eyebrow">Layer</div>
            <div className="mt-pillgroup">
              {LAYERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`mt-pill ${layer === l ? 'on' : ''}`}
                  onClick={() => setLayer(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
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
          <div className="al-row" style={{ marginLeft: 'auto' }}>
            <button type="button" className="mt-btn">＋ Filter</button>
            <button type="button" className="mt-btn">⚙ Columns <span className="num">11/14</span></button>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading indicators…
          </div>
        ) : (
          <div className="mt-card" style={{ padding: 0, overflow: 'hidden' }}>
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
                      <tr className={isOpen ? 'open' : ''} onClick={() => setDrill(isOpen ? null : i.id)}>
                        <td>
                          <div className="al-tkname">{i.name}</div>
                          <div className="al-tkcode">{i.id}</div>
                        </td>
                        <td><span className="al-cat">{i.domain}</span></td>
                        <td><span className="al-freq">{fmtFreq(i.freq)}</span></td>
                        <td>
                          <span className={`al-type al-type--${i.typeLabel === 'LEAD' ? 'extreme' : i.typeLabel === 'COINC' ? 'elevated' : 'calm'}`}>
                            {i.typeLabel}
                          </span>
                        </td>
                        <td>
                          <FreshnessChip elementId={i.manifestId} variant="label" />
                        </td>
                        <td className={`num al-current al-current--${i.state}`}>
                          {fmtNum(i.value, i.decimals ?? 2)}<span className="al-unit">{i.unit}</span>
                        </td>
                        <td className="num al-historical">{fmtNum(i.prior_3m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_6m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_1y, i.decimals ?? 2)}</td>
                        <td style={{ color }}>
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
