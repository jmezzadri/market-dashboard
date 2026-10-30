/* EngineTrackRecord — the S&P 500 with every stretch the engine spent
   defensive shaded, plus the drawdown table from the engine's backtest.

   Moved out of MacroPage.jsx on 2026-10-29 so Home's "See the track record"
   opens it in place (LESSONS 9.16 — a drill-down is not a destination). It
   used to send the reader to Macro Landscape, which has no track-record
   section: the view lives behind "See it against the market" in a pop-up.
   One component, so the two pages can never show different records. */

import React, { useEffect, useMemo, useState } from 'react';
import '../styles/modal.css';

/* Engine track record — the S&P 500 with every de-risked stretch shaded, so a
   reader can judge the stress signal against what the market actually did
   instead of inferring it from a two-year colour strip. Added 2026-07-29
   alongside the confirmation filter on the stress gate. */
export default function EngineTrackRecord({ weeks = [], spx = [] }) {
  const [bt, setBt] = useState(null);
  useEffect(() => {
    let c = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!c) setBt(d); }).catch(() => {});
    return () => { c = true; };
  }, []);

  const rows = useMemo(() => {
    if (!weeks.length || !spx.length) return [];
    const out = []; let j = 0;
    for (const w of weeks) {
      while (j + 1 < spx.length && spx[j + 1][0] <= w.date) j += 1;
      const p = spx[j];
      if (!p || p[0] > w.date || !Number.isFinite(p[1])) continue;
      out.push({ date: w.date, v: p[1], st: w.stress_state });
    }
    return out;
  }, [weeks, spx]);

  const W = 1000, H = 300, PADL = 4, PADB = 22;
  const geom = useMemo(() => {
    if (rows.length < 8) return null;
    const vs = rows.map((r) => Math.log(r.v));
    const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const x = (i) => PADL + (i / (rows.length - 1)) * (W - PADL * 2);
    const y = (v) => (H - PADB) - ((Math.log(v) - lo) / span) * (H - PADB - 10);
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.v).toFixed(1)}`).join('');
    const bands = []; let cur = null;
    rows.forEach((r, i) => {
      const off = r.st && r.st !== 'Risk On';
      if (off && !cur) cur = { a: i, b: i, st: r.st };
      else if (off) { cur.b = i; if (r.st === 'Risk Off') cur.st = 'Risk Off'; }
      else if (cur) { bands.push(cur); cur = null; }
    });
    if (cur) bands.push(cur);
    const ticks = [];
    let lastYr = null;
    rows.forEach((r, i) => {
      const yr = r.date.slice(0, 4);
      if (yr !== lastYr && Number(yr) % 3 === 0) { ticks.push({ x: x(i), label: yr }); lastYr = yr; }
      else if (yr !== lastYr) lastYr = yr;
    });
    return { x, y, line, bands, ticks };
  }, [rows]);

  const eps = bt?.drawdowns || [];
  const v = bt?.validation;
  const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

  return (
    <div className="eng-track">
      <div className="mt-eyebrow">The engine · track record</div>
      <h3>Every stretch the engine spent defensive, against the S&amp;P 500</h3>
      <p className="eng-lede">
        The line is the S&amp;P 500 on a log scale since {rows[0]?.date.slice(0, 4) || '2006'}. Shaded stretches are
        the weeks the stress signal had the engine out of full equity — amber at the watch line, red at the
        de-risk line. A de-risk only starts after two consecutive Fridays above the line, which is what keeps
        one-week volatility spikes from turning into a round trip.
      </p>
      {geom ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" preserveAspectRatio="none" role="img"
               aria-label="S&P 500 with de-risked periods shaded">
            {geom.bands.map((b, i) => (
              <rect key={i} x={geom.x(b.a)} y={0} width={Math.max(1.5, geom.x(b.b) - geom.x(b.a))}
                    height={H - PADB} fill={b.st === 'Risk Off' ? 'var(--mt-down)' : 'var(--mt-warn)'}
                    opacity={b.st === 'Risk Off' ? 0.16 : 0.13} />
            ))}
            <path d={geom.line} fill="none" stroke="var(--mt-ink-0)" strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="eng-axis">
            {geom.ticks.map((t, i) => (
              <span key={i} style={{ left: `${(t.x / W) * 100}%` }}>{t.label}</span>
            ))}
          </div>
        </>
      ) : <p className="eng-lede">Chart data loading…</p>}

      <div className="eng-key">
        <span><i className="eng-sw off" />De-risked · 50% equity</span>
        <span><i className="eng-sw watch" />Watch · 80% equity</span>
        <span><i className="eng-sw on" />Fully invested</span>
      </div>

      {eps.length > 0 && (
        <>
          <h4 className="eng-h4">How deep each drawdown got · full backtest window, 1986 onward</h4>
          <table className="eng-tbl">
            <thead><tr><th>Episode</th><th>S&amp;P 500</th><th>The engine</th><th>Difference</th></tr></thead>
            <tbody>
              {eps.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td className="num">{fmtPct(e.spy_depth)}</td>
                  <td className="num">{fmtPct(e.engine_depth)}</td>
                  <td className={`num ${e.diff_pp > 0.05 ? 'good' : ''}`}>
                    {e.diff_pp > 0.05 ? `${e.diff_pp.toFixed(1)}% shallower` : 'no material difference'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {v && (
            <p className="eng-foot">
              Full window {(bt.weekly?.[0]?.date || '').slice(0, 4)}–{(bt.weekly?.[bt.weekly.length - 1]?.date || '').slice(0, 4)}:
              {' '}the engine returned <b>{v.engine.cagr}% a year</b> against <b>{v.spy.cagr}%</b> for the S&amp;P 500,
              with a worst drawdown of <b>{fmtPct(v.engine.max_drawdown)}</b> against <b>{fmtPct(v.spy.max_drawdown)}</b>.
              Signal read at Friday close, executed the following Monday open. {bt.calibration_label}.
            </p>
          )}
        </>
      )}
    </div>
  );
}


