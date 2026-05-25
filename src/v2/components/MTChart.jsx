import React, { useEffect, useRef, useState } from 'react';

const DEFAULT_TF = [
  { key: '1Y', label: '1Y' }, { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' }, { key: 'MAX', label: 'MAX' },
];

function fmtMonth(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 7 ? iso + '-01' : iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function sliceByRange(data, range) {
  if (!data?.length) return [];
  if (range === 'MAX') return [...data];
  const yrs = parseInt(range, 10);
  if (!yrs) return [...data];
  const last = data[data.length - 1][0];
  const lastDate = new Date(last.length === 7 ? last + '-01' : last);
  const cut = new Date(lastDate);
  cut.setFullYear(cut.getFullYear() - yrs);
  return data.filter((d) => {
    const dt = new Date(d[0].length === 7 ? d[0] + '-01' : d[0]);
    return dt >= cut;
  });
}

// ─── Calibrated regime tint bands (#1158) ───────────────────────────────
// Cut-points are the 25th/50th/75th PERCENTILES of the chart series' OWN
// historical data — the same array the chart already receives, no external
// fetch. Linear-interpolation percentile (the standard "type 7" estimator).
function percentile(sortedVals, p) {
  const n = sortedVals.length;
  if (!n) return null;
  if (n === 1) return sortedVals[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n - 1);
  const frac = idx - lo;
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * frac;
}

// Compute the three band cuts from a [date, value] series.
function computeBandCuts(data) {
  if (!data?.length) return null;
  const vals = data
    .map((p) => p[1])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (vals.length < 4) return null; // too few points to calibrate quartiles
  return {
    p25: percentile(vals, 25),
    p50: percentile(vals, 50),
    p75: percentile(vals, 75),
  };
}

export default function MTChart({
  data, timeframes = DEFAULT_TF, initialRange = '3Y',
  yFormat, tipFormat, height = 200, width = 600,
  // Polarity of the series, controls which quarter is the Risk-On zone:
  //   'stress'  — HIGH reading = bad (VIX, MOVE, SKEW, OAS, jobless claims).
  //               top quarter = Risk Off, bottom quarter = Risk On.  [default]
  //   'risk-on' — HIGH reading = good (MT engine score, breadth, NAV,
  //               equity momentum). Inverted: top quarter = Risk On.
  //   'none'    — no calibrated bands (e.g. bidirectional indicators
  //               where a single 4-zone ramp is not meaningful).
  polarity = 'stress',
  // Bands are ON by default. Pass tintBands={false} to suppress them, or
  // pass an explicit {p25, p50, p75[, direction]} object to override the
  // self-computed percentile cuts (back-compat with the original prop).
  tintBands = true,
}) {
  const [range, setRange] = useState(initialRange);
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const lineRef = useRef(null);
  const tipRef = useRef(null);
  const wrapRef = useRef(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sliced = sliceByRange(data || [], range);
  const pad = { l: 36, r: 14, t: 10, b: 24 };
  const W = width; const H = height;

  let xs = [], ys = [], yMin = 0, yMax = 1, pathD = '', areaD = '';
  if (sliced.length >= 2) {
    xs = sliced.map((_, i) => pad.l + (W - pad.l - pad.r) * (i / (sliced.length - 1)));
    const vals = sliced.map((p) => p[1]);
    const minV = Math.min(...vals); const maxV = Math.max(...vals);
    const rng = maxV - minV || 1;
    yMin = minV - rng * 0.06; yMax = maxV + rng * 0.06;
    ys = vals.map((v) => pad.t + (H - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin)));
    pathD = `M ${xs[0]} ${ys[0]}` + xs.slice(1).map((x, i) => ` L ${x} ${ys[i + 1]}`).join('');
    areaD = pathD + ` L ${xs[xs.length - 1]} ${H - pad.b} L ${xs[0]} ${H - pad.b} Z`;
  }

  // Resolve the band cut-points. Priority:
  //   1. explicit {p25,p50,p75} object passed by the consumer
  //   2. percentiles computed from the FULL series (data), polarity-agnostic
  // Bands are suppressed when tintBands===false or polarity==='none'.
  let bandCuts = null;
  let bandDir = polarity === 'risk-on' ? 'low' : 'high';
  if (tintBands && polarity !== 'none') {
    if (typeof tintBands === 'object'
        && tintBands.p25 != null && tintBands.p50 != null && tintBands.p75 != null) {
      bandCuts = { p25: tintBands.p25, p50: tintBands.p50, p75: tintBands.p75 };
      if (tintBands.direction === 'low' || tintBands.direction === 'high') {
        bandDir = tintBands.direction;
      }
    } else {
      // Percentiles from the series' own full history (not the sliced range)
      // so the zones stay stable as the reader switches timeframe pills.
      bandCuts = computeBandCuts(data);
    }
  }

  useEffect(() => {
    if (reduceMotion || !lineRef.current) return;
    const el = lineRef.current;
    const len = el.getTotalLength();
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    void el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 700ms cubic-bezier(.22,1,.36,1)';
    el.style.strokeDashoffset = '0';
  }, [range, sliced.length, reduceMotion]);

  function handleMove(e) {
    if (!sliced.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - x);
      if (d < bd) { bd = d; best = i; }
    }
    setHoverIdx(best);
  }
  function handleLeave() { setHoverIdx(null); }

  const tk = 4;
  const ticks = [];
  for (let i = 0; i <= tk; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (i / tk);
    const v = yMax - (yMax - yMin) * (i / tk);
    ticks.push({ y, label: yFormat ? yFormat(v) : v.toFixed(0) });
  }
  const xMid = Math.floor(sliced.length / 2);
  const xLabels = sliced.length >= 2 ? [
    { x: xs[0], anchor: 'start', text: fmtMonth(sliced[0][0]) },
    { x: xs[xMid], anchor: 'middle', text: fmtMonth(sliced[xMid][0]) },
    { x: xs[sliced.length - 1], anchor: 'end', text: fmtMonth(sliced[sliced.length - 1][0]) },
  ] : [];

  const lastVal = sliced.length ? sliced[sliced.length - 1][1] : null;
  const firstVal = sliced.length ? sliced[0][1] : null;
  const totChg = lastVal != null && firstVal != null ? lastVal - firstVal : 0;
  const totPct = firstVal !== 0 && firstVal != null ? (totChg / Math.abs(firstVal)) * 100 : 0;
  const formatV = tipFormat || ((v) => v.toFixed(2));

  let tipPos = null;
  let hover = null;
  if (hoverIdx != null && sliced[hoverIdx]) {
    hover = sliced[hoverIdx];
    const px = xs[hoverIdx]; const py = ys[hoverIdx];
    const rect = svgRef.current?.getBoundingClientRect();
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (rect && wrapRect) {
      const lx = (px / W) * rect.width; const ly = (py / H) * rect.height;
      const tipW = tipRef.current?.offsetWidth || 140;
      let leftPx = lx + 14;
      if (lx + 14 + tipW > rect.width) leftPx = lx - tipW - 14;
      tipPos = {
        left: leftPx + (rect.left - wrapRect.left),
        top: Math.max(8, ly - 30 + (rect.top - wrapRect.top)),
      };
    }
  }
  const hoverChg = hover ? hover[1] - firstVal : 0;
  const hoverPct = hover && firstVal !== 0 ? (hoverChg / Math.abs(firstVal)) * 100 : 0;

  return (
    <div className="v2-chart" ref={wrapRef}>
      <div className="v2-chart-head">
        <div className="v2-chart-readout">
          <span className="v">{lastVal != null ? formatV(lastVal) : '—'}</span>
          <span className="d">
            {sliced.length ? fmtMonth(sliced[sliced.length - 1][0]) : '—'}
            <span className={`delta ${totChg >= 0 ? 'up' : 'down'}`}>
              {' '}{totChg >= 0 ? '+' : ''}{totChg.toFixed(2)} · {totPct >= 0 ? '+' : ''}{totPct.toFixed(1)}%
            </span>
          </span>
        </div>
        <div className="v2-tf" role="group" aria-label="Timeframe">
          {timeframes.map((tf) => (
            <button key={tf.key} type="button"
              className={range === tf.key ? 'on' : ''}
              onClick={() => setRange(tf.key)}>
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <svg ref={svgRef} className="v2-chart-svg" viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none" onPointerMove={handleMove} onPointerLeave={handleLeave}>
        <defs>
          <linearGradient id="v2chartGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {bandCuts && bandCuts.p25 != null && bandCuts.p50 != null && bandCuts.p75 != null && sliced.length >= 2 && (() => {
          // Map percentile cuts to SVG y-coords using the current yMin/yMax.
          const yAt = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin));
          const yTop = pad.t;
          const yBot = H - pad.b;
          const clamp = (y) => Math.max(yTop, Math.min(yBot, y));
          const y25 = clamp(yAt(bandCuts.p25));
          const y50 = clamp(yAt(bandCuts.p50));
          const y75 = clamp(yAt(bandCuts.p75));
          const xL = pad.l;
          const xW = W - pad.r - pad.l;
          // Band fills are CSS theme variables so they flip with light/dark
          // mode and never use a hardcoded palette. Defined in theme.css.
          const RISK_ON  = 'var(--tint-risk-on)';
          const NEUTRAL  = 'var(--tint-neutral)';
          const CAUTION  = 'var(--tint-cautionary)';
          const RISK_OFF = 'var(--tint-risk-off)';
          // 'high' polarity (high reading = stress):
          //   top→p75 Risk Off, p75→p50 Cautionary, p50→p25 Neutral, p25→bottom Risk On
          // 'low' polarity (high reading = risk-on): inverted.
          const bands = bandDir === 'high'
            ? [
                { y0: yTop, y1: y75,  fill: RISK_OFF, label: 'Risk Off zone' },
                { y0: y75,  y1: y50,  fill: CAUTION,  label: 'Cautionary zone' },
                { y0: y50,  y1: y25,  fill: NEUTRAL,  label: 'Neutral zone' },
                { y0: y25,  y1: yBot, fill: RISK_ON,  label: 'Risk-On zone' },
              ]
            : [
                { y0: yTop, y1: y75,  fill: RISK_ON,  label: 'Risk-On zone' },
                { y0: y75,  y1: y50,  fill: NEUTRAL,  label: 'Neutral zone' },
                { y0: y50,  y1: y25,  fill: CAUTION,  label: 'Cautionary zone' },
                { y0: y25,  y1: yBot, fill: RISK_OFF, label: 'Risk Off zone' },
              ];
          return (
            <g className="v2-chart-tint" aria-hidden="true">
              {bands.map((b, i) => (
                <rect key={'tband-' + i} x={xL} y={Math.min(b.y0, b.y1)}
                  width={xW} height={Math.abs(b.y1 - b.y0)} fill={b.fill}>
                  <title>{b.label}</title>
                </rect>
              ))}
            </g>
          );
        })()}
        <g>{ticks.map((t, i) => (<line key={i} className="grid" x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} />))}</g>
        <g>{ticks.map((t, i) => (<text key={i} className="yLabel" x={pad.l - 6} y={t.y + 3} textAnchor="end">{t.label}</text>))}</g>
        {sliced.length >= 2 && (
          <>
            <path className="area" d={areaD} fill="url(#v2chartGrad)" key={`area-${range}-${sliced.length}`} />
            <path className="line" ref={lineRef} d={pathD} stroke="var(--accent)" key={`line-${range}-${sliced.length}`} />
          </>
        )}
        <g>{xLabels.map((x, i) => (<text key={i} className="xLabel" x={x.x} y={H - 6} textAnchor={x.anchor}>{x.text}</text>))}</g>
        {hoverIdx != null && (
          <>
            <line className="crossV on" x1={xs[hoverIdx]} x2={xs[hoverIdx]} y1={pad.t} y2={H - pad.b} />
            <line className="crossH on" x1={pad.l} x2={W - pad.r} y1={ys[hoverIdx]} y2={ys[hoverIdx]} />
            <circle className="hoverDot on" cx={xs[hoverIdx]} cy={ys[hoverIdx]} r="4" />
          </>
        )}
      </svg>
      <div ref={tipRef} className={`v2-tip ${hover ? 'on' : ''}`} style={tipPos || {}}>
        {hover && (
          <>
            <div className="tipDate">{fmtMonth(hover[0])}</div>
            <div className="tipVal">{formatV(hover[1])}</div>
            <div className={`tipDelta ${hoverChg >= 0 ? 'up' : 'down'}`}>
              {hoverChg >= 0 ? '+' : ''}{hoverChg.toFixed(2)} · {hoverPct >= 0 ? '+' : ''}{hoverPct.toFixed(1)}% over range
            </div>
          </>
        )}
      </div>
    </div>
  );
}
