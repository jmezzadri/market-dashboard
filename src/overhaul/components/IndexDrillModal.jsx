/* IndexDrillModal — the drill for the three equity index tiles on the home
   tape (S&P 500, Nasdaq, Dow).

   Why it is NOT IndicatorDetail (Joe, 2026-08-18: "Why cant I drill into S&P,
   NASDAQ, DOW anymore?"): those three are price LEVELS, not registry
   indicators, and IndicatorDetail is built around a trailing-3-year percentile
   — the pill, the amber/red bands and the distribution bar are all the same
   statistic. A percentile of an index level is not a statistic, it is a
   restatement of the fact that indexes trend: the S&P sits near the top of its
   own three-year range in most months of most decades, and shading that red
   would be inventing a warning. Registering them in indicatorRegistry to get a
   drill would also have pushed them into Macro's indicator grids and counts,
   which is not what they are.

   So this shows what an index level actually supports: the live quote and the
   day move, trailing total-price returns over the windows people use, the
   same timeframe pills and the same chart, and drawdown from the period high.
   No percentile, no bands, no pill.

   Live price + prior close come from the SAME resolver the tape and the ticker
   pages use, so the header here and the tile behind it cannot disagree. */

import React, { useMemo, useState } from 'react';
import DetailModal from './DetailModal';
import BigHistoryChart from './BigHistoryChart';
import useLseLive from '../../hooks/useLseLive';

const TFS = ['1Y', '3Y', '5Y', '10Y', 'Max'];

export const INDEX_DRILLS = {
  spx_index: {
    key: 'spx_index',
    live: '^GSPC',
    name: 'S&P 500',
    eyebrow: 'US large-cap equities',
    blurb: 'The 500-name, float-weighted benchmark for US large-cap equities — the default definition of "the US stock market" and the reference return most portfolios are graded against.',
    source: 'Yahoo Finance ^GSPC daily closes, live quote via the site price feed.',
  },
  ndx_index: {
    key: 'ndx_index',
    live: '^IXIC',
    name: 'Nasdaq Composite',
    eyebrow: 'US technology-weighted equities',
    blurb: 'Every common stock listed on the Nasdaq exchange, market-cap weighted — heavily tilted to technology and growth, so it leads the S&P when duration is in favour and lags it when rates back up.',
    source: 'Yahoo Finance ^IXIC daily closes, live quote via the site price feed.',
  },
  dji_index: {
    key: 'dji_index',
    live: '^DJI',
    name: 'Dow Jones Industrial Average',
    eyebrow: 'US blue-chip equities',
    blurb: 'Thirty large US companies, PRICE weighted rather than market-cap weighted — a high-priced share moves it more than a large company does, which is why it can diverge from the S&P on days a single name gaps.',
    source: 'Yahoo Finance ^DJI daily closes, live quote via the site price feed.',
  },
};

function sliceByTimeframe(points, tf) {
  if (!points?.length) return [];
  const last = new Date(points[points.length - 1][0]);
  const yrs = { '1Y': 1, '3Y': 3, '5Y': 5, '10Y': 10 }[tf];
  if (!yrs) return points;
  const cutoff = new Date(last.getTime() - yrs * 365 * 86400000);
  return points.filter((p) => new Date(p[0]) >= cutoff);
}

const fmtLevel = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

/* Trailing return over N calendar days, measured from the last stored close
   back to the last close on or before the window start. Calendar-anchored, not
   bar-count-anchored, so a holiday-heavy window doesn't silently stretch. */
function trailingReturn(points, days) {
  if (!points?.length) return null;
  const lastT = Date.parse(String(points[points.length - 1][0]).slice(0, 10) + 'T00:00:00Z');
  const last = Number(points[points.length - 1][1]);
  if (!Number.isFinite(lastT) || !(last > 0)) return null;
  const cut = lastT - days * 86400000;
  let base = null;
  for (const p of points) {
    const t = Date.parse(String(p[0]).slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(t) && t <= cut && Number.isFinite(Number(p[1]))) base = Number(p[1]);
  }
  // The window starts before our history does — say nothing rather than
  // measuring from an arbitrary first bar (LESSONS 4.4).
  if (!(base > 0)) return null;
  return ((last / base) - 1) * 100;
}

function ytdReturn(points) {
  if (!points?.length) return null;
  const lastIso = String(points[points.length - 1][0]).slice(0, 10);
  const jan1 = `${lastIso.slice(0, 4)}-01-01`;
  let base = null;
  for (const p of points) {
    const iso = String(p[0]).slice(0, 10);
    if (iso < jan1 && Number.isFinite(Number(p[1]))) base = Number(p[1]);
  }
  const last = Number(points[points.length - 1][1]);
  if (!(base > 0) || !(last > 0)) return null;
  return ((last / base) - 1) * 100;
}

export default function IndexDrillModal({ indexKey, hist, onClose }) {
  const [tf, setTf] = useState('5Y');
  const def = indexKey ? INDEX_DRILLS[indexKey] : null;
  const live = useLseLive(def ? [def.live] : []);

  const points = useMemo(() => {
    const p = hist?.[indexKey]?.points;
    return Array.isArray(p) ? p.filter((r) => Number.isFinite(Number(r[1]))) : [];
  }, [hist, indexKey]);

  const sliced = useMemo(() => sliceByTimeframe(points, tf), [points, tf]);

  const q = def ? live.bySymbol?.[def.live] : null;
  const livePrice = q && q.covered && q.price != null ? q.price : null;
  const prevClose = q?.prevClose != null && q.prevClose > 0
    ? q.prevClose
    : (points.length ? Number(points[points.length - 1][1]) : null);
  const dayPct = livePrice != null && prevClose > 0 ? ((livePrice / prevClose) - 1) * 100 : null;

  const rets = useMemo(() => ([
    { label: '1 week', v: trailingReturn(points, 7) },
    { label: '1 month', v: trailingReturn(points, 30) },
    { label: '3 months', v: trailingReturn(points, 91) },
    { label: '6 months', v: trailingReturn(points, 182) },
    { label: 'Year to date', v: ytdReturn(points) },
    { label: '1 year', v: trailingReturn(points, 365) },
  ]), [points]);

  // Drawdown from the highest close inside the SELECTED window — the number a
  // reader actually wants next to a level ("how far off the high are we").
  const dd = useMemo(() => {
    if (!sliced.length) return null;
    const peak = Math.max(...sliced.map((p) => Number(p[1])));
    const last = livePrice != null ? livePrice : Number(sliced[sliced.length - 1][1]);
    if (!(peak > 0) || !(last > 0)) return null;
    return { peak, pct: ((last / peak) - 1) * 100 };
  }, [sliced, livePrice]);

  if (!indexKey || !def) return null;

  const headline = livePrice != null ? livePrice : (points.length ? Number(points[points.length - 1][1]) : null);
  const asOf = points.length ? String(points[points.length - 1][0]).slice(0, 10) : null;

  return (
    <DetailModal onClose={onClose}>
      <div style={{ padding: '28px 30px 26px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
          <div>
            <div className="mt-eyebrow">{def.eyebrow}</div>
            <h2 style={{ fontFamily: 'var(--mt-font-display)', fontSize: 34, fontWeight: 400, margin: '4px 0 0' }}>{def.name}</h2>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 38, lineHeight: 1.05 }}>{fmtLevel(headline)}</div>
            {dayPct != null && (
              <div className={`num ${dayPct >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>
                {dayPct >= 0 ? '▲' : '▼'} {fmtPct(dayPct).replace(/^[+-]/, '')} today
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 3 }}>
              {livePrice != null ? <>live · vs prev close {fmtLevel(prevClose)}</> : (asOf ? <>close {asOf}</> : null)}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--mt-ink-2)', margin: '14px 0 18px', maxWidth: 760 }}>{def.blurb}</p>

        {points.length > 0 ? (
          <>
            <div className="mt-pillgroup" style={{ marginBottom: 12 }}>
              {TFS.map((k) => (
                <button key={k} type="button" className={`mt-pill ${tf === k ? 'on' : ''}`} onClick={() => setTf(k)}>{k}</button>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mt-ink-3)' }}>
                <b className="num">{sliced.length.toLocaleString('en-US')}</b> observations
              </span>
            </div>

            <BigHistoryChart
              points={sliced}
              accent="var(--mt-accent)"
              height={260}
              freq="D"
              primaryLabel={def.name}
              yFormat={fmtLevel}
            />

            {dd && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--mt-ink-3)' }}>
                {dd.pct >= -0.05
                  ? <>At the high of the selected {tf} window.</>
                  : <>{fmtPct(dd.pct)} from the {tf} closing high of {fmtLevel(dd.peak)}.</>}
              </div>
            )}

            <div className="mt-eyebrow" style={{ marginTop: 24, marginBottom: 10 }}>Trailing price return</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '14px 20px' }}>
              {rets.map((r) => (
                <div key={r.label}>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', letterSpacing: '.04em' }}>{r.label}</div>
                  <div className={`num ${r.v == null ? '' : r.v >= 0 ? 'up' : 'down'}`} style={{ fontSize: 21, fontWeight: 600, marginTop: 2 }}>
                    {fmtPct(r.v)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mt-ink-3)' }}>
              Price return on the index level — no dividends, so it understates a total-return benchmark
              by roughly the index's dividend yield per year. Windows are calendar-anchored and measured
              from the last stored close; the live quote above is not mixed into them.
            </div>
          </>
        ) : (
          <div style={{ padding: '18px 0', fontSize: 13.5, color: 'var(--mt-ink-2)' }}>
            No stored daily history for this index yet — the live quote above is real, the chart is not
            available. {def.name} is quoted through the live price feed and has no nightly history feed
            behind it.
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 11, color: 'var(--mt-ink-3)' }}>Source: {def.source}</div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="mt-btn mt-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </DetailModal>
  );
}
