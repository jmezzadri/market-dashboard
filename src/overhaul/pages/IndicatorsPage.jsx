/* All Indicators page — full filterable, sortable table view.
   Site-overhaul PR-O2.

   Wired to:
     - useIndicators() (reads /indicator_history.json + IND registry + manifest)
     - FreshnessChip (per-row, wraps real useFreshness)
     - IndicatorDetail (inline drill on row click)
   No mock data anywhere in this page. */

import React, { useMemo, useState } from 'react';
import Sparkline from '../components/Sparkline';
import FreshnessChip from '../components/FreshnessChip';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';

const LAYERS = [
  ['All', null],
  ['Tier 1', { tier: 1 }],
  ['Tier 2', { tier: 2 }],
  ['Deprecated', { deprecated: true }],
];
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
  const { indicators, loading } = useIndicators();
  const [layer, setLayer] = useState('All');
  const [domain, setDomain] = useState('All');
  const [sort, setSort] = useState({ key: 'state', dir: 'desc' });
  const [drill, setDrill] = useState(null);

  const filtered = useMemo(() => {
    let rows = indicators;
    const lconf = LAYERS.find(([l]) => l === layer)?.[1];
    if (lconf) {
      if (lconf.deprecated) rows = rows.filter((i) => i.deprecated);
      else if (lconf.tier) rows = rows.filter((i) => {
        // Tier is the 4th entry in the IND meta tuple.
        const tierFromMeta = i.tier === 'paid' ? 1 : 2;
        // Use the registry tier if set (Tier 1/2 = importance, not license).
        // For simplicity here we infer importance from the family.
        const importance = ['equity', 'credit', 'rates'].includes(i.familyId) ? 1 : 2;
        return importance === lconf.tier;
      });
    }
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
  }, [indicators, layer, domain, sort]);

  const counts = useMemo(() => {
    return {
      extreme: indicators.filter((i) => i.state === 'extreme').length,
      elevated: indicators.filter((i) => i.state === 'elevated').length,
      calm: indicators.filter((i) => i.state === 'calm').length,
    };
  }, [indicators]);

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' };
      }
      return { key, dir: 'desc' };
    });
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
            Every input, in <i>one table</i>.
          </h1>
          <p className="mt-deck">
            Sourced live from the data registry. Leading, coincident, and lagging
            indicators across <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Money</b>,
            and the real <b>Economy</b>. Click any row to drill — chart, percentile bar,
            stats, methodology.
          </p>
        </div>
        <div className="al-summary">
          <FreshnessChip elementId="universe-master-daily" variant="pill" label={`${indicators.length} indicators`} />
          <div className="al-summarygrid">
            <div>
              <div className="mt-eyebrow">Extreme</div>
              <b className="num al-sumnum" style={{ color: 'var(--mt-down)' }}>{counts.extreme}</b>
            </div>
            <div>
              <div className="mt-eyebrow">Elevated</div>
              <b className="num al-sumnum" style={{ color: 'var(--mt-warn)' }}>{counts.elevated}</b>
            </div>
            <div>
              <div className="mt-eyebrow">Calm</div>
              <b className="num al-sumnum" style={{ color: 'var(--mt-up)' }}>{counts.calm}</b>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 16, paddingBottom: 12 }}>
        <div className="al-toolbar mt-card">
          <div className="al-row">
            <div className="mt-eyebrow">Layer</div>
            <div className="mt-pillgroup">
              {LAYERS.map(([l]) => (
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
                  <th onClick={() => toggleSort('state')}>State{arrow('state')}</th>
                  <th>Last refresh</th>
                  <th className="num" onClick={() => toggleSort('value')}>Current{arrow('value')}</th>
                  <th className="num" onClick={() => toggleSort('prior_3m')}>3M ago{arrow('prior_3m')}</th>
                  <th className="num" onClick={() => toggleSort('prior_6m')}>6M ago{arrow('prior_6m')}</th>
                  <th className="num" onClick={() => toggleSort('prior_1y')}>1Y ago{arrow('prior_1y')}</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const isOpen = drill === i.id;
                  const stateColor =
                    i.state === 'extreme'
                      ? 'var(--mt-down)'
                      : i.state === 'elevated'
                        ? 'var(--mt-warn)'
                        : 'var(--mt-up)';
                  const trendPts = (i.points || []).slice(-90).map((p) => p[1]).filter(Number.isFinite);
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
                          <span className={`al-type al-type--${i.state}`}>{i.state}</span>
                        </td>
                        <td>
                          <FreshnessChip elementId={i.id} variant="label" />
                        </td>
                        <td className={`num al-current al-current--${i.state}`}>
                          {fmtNum(i.value, i.decimals ?? 2)}<span className="al-unit">{i.unit}</span>
                        </td>
                        <td className="num al-historical">{fmtNum(i.prior_3m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_6m, i.decimals ?? 2)}</td>
                        <td className="num al-historical">{fmtNum(i.prior_1y, i.decimals ?? 2)}</td>
                        <td style={{ color: stateColor }}>
                          <Sparkline data={trendPts} width={120} height={22} stroke={stateColor} showDot />
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
            Showing <b className="num">{filtered.length}</b> of{' '}
            <b className="num">{indicators.length}</b> indicators
          </span>
          {!loading && <FreshnessChip elementId="universe-master-daily" variant="label" />}
        </div>
      </section>
    </div>
  );
}
