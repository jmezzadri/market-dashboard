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

export default function MTChart({
  data, timeframes = DEFAULT_TF, initialRange = '3Y',
  yFormat, tipFormat, height = 200, width = 600,
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
