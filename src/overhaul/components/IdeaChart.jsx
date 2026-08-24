/* IdeaChart — the chart a Trade Idea points at.

   A note's `charts[]` entries are DECLARATIVE: they name a series that already
   exists in public/indicator_history.json, a window, and a caption. Nothing is
   drawn from numbers typed into the note. That is the whole point — the chart
   and the evidence block are the same data, so a chart can never disagree with
   the sentence beside it, and a note cannot illustrate a series we do not have.

   FORM (per the dataviz method, decided before any color):
     • Job = trend over time, and in every case ONE series is the subject. So the
       form is emphasis, not categorical: the line is ink (maximum legibility
       against the putty tile), and the accent is spent on the ONE thing the
       reader is meant to take away — the current reading, its dot and its label.
     • Two-series charts were tried and rejected: the brand's gold and its muted
       ink fail the normal-vision separation check outright in dark mode
       (ΔE 6.5, floor 15). Two measures become two charts, which is also what the
       method prescribes for two different scales. There is no dual axis here and
       there never will be.
     • A single series needs no legend box — the title names it.
     • Grid and axes are solid hairlines one shade off the surface, never dashed.
     • Values are reachable three ways: the endpoint is direct-labelled, hover
       gives a crosshair readout, and every chart has a table view. The tooltip
       never gates a number. */

import React, { useMemo, useRef, useState } from 'react';

const PAD = { t: 16, r: 58, b: 22, l: 46 };

function fmtVal(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtDate(iso, long = false) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', long
    ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    /* Four-digit year on the axis. A two-digit year renders "Aug 16", which on
       a ten-year chart reads as the sixteenth of August rather than 2016 — the
       tick then lies about the span of the picture. Verified on the 2026-08-16
       note, where all four charts carried "Aug 16 / Aug 21 / Aug 26". */
    : { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* Window is applied to the SERIES' own last observation, not to today — a
   monthly series stamped at month-end must not lose its final year because the
   browser clock is three weeks later. */
function sliceWindow(points, window) {
  if (!points.length || !window || window === 'full') return points;
  const yrs = { '1y': 1, '3y': 3, '5y': 5, '10y': 10, '20y': 20 }[window];
  if (!yrs) return points;
  const last = points[points.length - 1][0];
  const cut = new Date(`${last}T00:00:00Z`);
  cut.setUTCFullYear(cut.getUTCFullYear() - yrs);
  const cutISO = cut.toISOString().slice(0, 10);
  const out = points.filter(([d]) => d >= cutISO);
  return out.length > 8 ? out : points;
}

/* Downsample for drawing only. A 20-year daily series is 5,000 points inside a
   440px card — more path nodes than pixels. Min/max are preserved per bucket so
   an extreme is never smoothed away, which would be a lie, not an optimisation.
   The table view and the hover readout still address the full series. */
function decimate(points, target = 460) {
  if (points.length <= target) return points;
  const bucket = Math.ceil(points.length / target);
  const out = [];
  for (let i = 0; i < points.length; i += bucket) {
    const chunk = points.slice(i, i + bucket);
    let lo = chunk[0]; let hi = chunk[0];
    chunk.forEach((p) => { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; });
    const [a, b] = lo[0] <= hi[0] ? [lo, hi] : [hi, lo];
    out.push(a);
    if (b !== a) out.push(b);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1][0] !== last[0]) out.push(last);
  return out;
}

function niceTicks(min, max, n = 4) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/* `compact` is the TILE variant: the same figure with the apparatus stripped —
   no subtitle, no table toggle. The caption stays, because a chart without the
   sentence that says what crossing the line means is decoration; and the source
   stays, because a number on this site never appears unattributed. The full
   apparatus (subtitle, table view, every chart in the note) is one click away
   in the note itself. */
export default function IdeaChart({ spec, series, asOf = null, width = 620, height = 220, compact = false }) {
  const [hover, setHover] = useState(null);
  const [tableOpen, setTableOpen] = useState(false);
  const wrapRef = useRef(null);

  const all = useMemo(() => {
    const pts = (series?.points || [])
      .filter((p) => Array.isArray(p) && p[1] != null && Number.isFinite(Number(p[1])))
      .map((p) => [p[0], Number(p[1])]);
    return sliceWindow(pts, spec?.window);
  }, [series, spec?.window]);

  const draw = useMemo(() => decimate(all), [all]);

  if (!series || all.length < 2) {
    // Honest empty state: say WHICH thing is missing, never a bare "no data"
    // that reads the same as a quiet market (LESSONS 4.30).
    return (
      <figure className="ideachart ideachart--empty">
        <figcaption className="ic-title">{spec?.title || 'Chart'}</figcaption>
        <p className="secnote">
          The series behind this chart ({spec?.series}) did not load, so it is not drawn rather than drawn wrong.
        </p>
      </figure>
    );
  }

  const dec = spec?.decimals ?? 2;
  const vals = all.map((p) => p[1]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (spec?.zero_rule && lo > 0) lo = 0;
  if (spec?.zero_rule && hi < 0) hi = 0;
  const padY = (hi - lo) * 0.12 || 1;
  lo -= padY; hi += padY;

  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const t0 = new Date(`${all[0][0]}T00:00:00Z`).getTime();
  const t1 = new Date(`${all[all.length - 1][0]}T00:00:00Z`).getTime();
  const span = t1 - t0 || 1;
  const X = (iso) => PAD.l + ((new Date(`${iso}T00:00:00Z`).getTime() - t0) / span) * iw;
  const Y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  const path = draw.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${path} L${X(draw[draw.length - 1][0]).toFixed(1)} ${Y(Math.max(lo, Math.min(hi, 0))).toFixed(1)} L${X(draw[0][0]).toFixed(1)} ${Y(Math.max(lo, Math.min(hi, 0))).toFixed(1)} Z`;

  const last = all[all.length - 1];
  const yTicks = niceTicks(lo, hi, 4);
  const xTicks = [all[0], all[Math.floor(all.length / 2)], last];

  const onMove = (e) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    const frac = Math.max(0, Math.min(1, (px - PAD.l) / iw));
    const target = t0 + frac * span;
    let best = all[0];
    let bestD = Infinity;
    all.forEach((p) => {
      const d = Math.abs(new Date(`${p[0]}T00:00:00Z`).getTime() - target);
      if (d < bestD) { bestD = d; best = p; }
    });
    setHover(best);
  };

  const shown = hover || last;

  /* Stamp the caption only when the series has moved past the note's date —
     comparing ISO day strings, which sort correctly and dodge every timezone
     question. `last[0]` is the series' own last observation, so a monthly
     series stamped at month-end does not falsely trigger it. */
  const asOfStamp = (asOf && last?.[0] && String(asOf).slice(0, 10) < String(last[0]).slice(0, 10))
    ? fmtDate(String(asOf).slice(0, 10), true).replace(/,? \d{4}$/, '')
    : null;

  return (
    <figure className="ideachart">
      <figcaption className="ic-head">
        <span className="ic-heads">
          <span className="ic-title">{spec.title}</span>
          {spec.subtitle && !compact && <span className="ic-sub">{spec.subtitle}</span>}
        </span>
        {/* The readout lives in the HEADER, not floating over the plot. It was
            top-right inside the frame and the CAPE chart — whose line ends at
            its own maximum — printed its gold endpoint label directly beneath
            it. A value that can be covered by another value is a defect, and no
            amount of picking a corner fixes it for every series. */}
        <span className="ic-readout" aria-live="polite">
          <b>{fmtVal(shown[1], dec)}{spec.unit || ''}</b>
          <span>{fmtDate(shown[0], true)}{hover ? '' : ' · latest'}</span>
        </span>
      </figcaption>

      <div
        className="ic-plot"
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0])}
      >
        <svg viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="none"
             aria-label={`${spec.title}. Latest ${fmtVal(last[1], dec)}${spec.unit || ''} on ${fmtDate(last[0], true)}.`}>
          {/* recessive grid — solid hairlines, one shade off the surface */}
          {yTicks.map((v) => (
            <g key={v}>
              <line className="ic-grid" x1={PAD.l} x2={width - PAD.r} y1={Y(v)} y2={Y(v)} />
              <text className="ic-ytick" x={PAD.l - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle">
                {fmtVal(v, Math.abs(v) >= 100 ? 0 : dec)}
              </text>
            </g>
          ))}

          {/* an explicit reference band, when the note names one */}
          {spec.band && Number.isFinite(spec.band.from) && Number.isFinite(spec.band.to) && (
            <rect className="ic-band" x={PAD.l} width={iw}
                  y={Y(Math.max(spec.band.from, spec.band.to))}
                  height={Math.abs(Y(spec.band.from) - Y(spec.band.to))} />
          )}

          {spec.zero_rule && lo <= 0 && hi >= 0 && (
            <>
              <line className="ic-zero" x1={PAD.l} x2={width - PAD.r} y1={Y(0)} y2={Y(0)} />
              <text className="ic-zerolab" x={width - PAD.r + 6} y={Y(0)} dominantBaseline="middle">0</text>
            </>
          )}

          <path className="ic-area" d={area} />
          <path className="ic-line" d={path} />

          {/* emphasis: the accent is spent on the current reading only */}
          <circle className="ic-dot" cx={X(last[0])} cy={Y(last[1])} r="4.5" />
          <text className="ic-endlab" x={X(last[0]) + 9}
                y={Math.max(PAD.t + 6, Math.min(PAD.t + ih - 6, Y(last[1])))} dominantBaseline="middle">
            {fmtVal(last[1], dec)}{spec.unit || ''}
          </text>

          {hover && (
            <g>
              <line className="ic-cross" x1={X(hover[0])} x2={X(hover[0])} y1={PAD.t} y2={PAD.t + ih} />
              <circle className="ic-hoverdot" cx={X(hover[0])} cy={Y(hover[1])} r="4" />
            </g>
          )}

          {xTicks.map((p, i) => (
            <text key={p[0]} className="ic-xtick" x={X(p[0])} y={height - 6}
                  textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {fmtDate(p[0])}
            </text>
          ))}
        </svg>

      </div>

      {/* The caption is FROZEN PROSE and the plot beside it is LIVE. On the
          2026-08-17 note the caption read "At 0.77 it is the 0.6th percentile"
          while the readout four lines above it had advanced to 0.84 — the note's
          own kill line being 1.00, that is the number that decides whether the
          trade is still alive. 4.31 rule 4 banned typed-in values inside the
          chart's DATA; the caption then became the second source of truth it
          was written to prevent. A caption written on a date is true AS AT that
          date, so it is stamped with it — and only once the series has actually
          moved past it, so a note published today reads exactly as before. */}
      {spec.caption && (
        <p className="ic-caption">
          {asOfStamp && <span className="ic-asof">As at {asOfStamp}: </span>}
          {spec.caption}
        </p>
      )}

      <p className="ic-meta">
        {!compact && (
          <button type="button" className="ic-tablebtn" onClick={() => setTableOpen((v) => !v)}>
            {tableOpen ? 'Hide the numbers' : 'Show the numbers'}
          </button>
        )}
        <span className="ic-src">{spec.source}</span>
      </p>

      {tableOpen && (
        <div className="ic-table">
          <table>
            <thead><tr><th>Date</th><th>{spec.title}</th></tr></thead>
            <tbody>
              {/* Newest first, and a bounded sample of a long daily series with
                  the count stated — a silent cap would read as the whole series. */}
              {all.slice().reverse().filter((_, i, arr) => i < 12 || i % Math.ceil(arr.length / 24) === 0)
                .slice(0, 30)
                .map((p) => (
                  <tr key={p[0]}><td>{fmtDate(p[0], true)}</td><td>{fmtVal(p[1], dec)}{spec.unit || ''}</td></tr>
                ))}
            </tbody>
          </table>
          <p className="secnote">
            {all.length.toLocaleString('en-US')} observations from {fmtDate(all[0][0], true)} to {fmtDate(last[0], true)};
            the most recent readings are listed in full and the rest sampled evenly.
          </p>
        </div>
      )}
    </figure>
  );
}
