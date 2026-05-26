/* Living Map · shared interactive sections (Regime canvas, Indicator drill,
   Sector flow, Scanner card). Used across Home, Macro, Tilt, Scanner,
   Portfolio, Indicators pages.                                            */

const { useState: useStateLm2, useMemo: useMemoLm2, useRef: useRefLm2 } = React;

/* Sector positions on the regime canvas — each sector maps to a typical
   (stress × yield) sensitivity. Lets us render the engine's recommended
   sector tilts ON the same map as the macro indicators.                  */
const SECTOR_POS = {
  XLK:  { x: -0.45, y:  0.30 },  // Tech · risk-on growth, infl-sensitive
  XLC:  { x: -0.30, y:  0.45 },  // Comms · similar to Tech
  XLY:  { x: -0.55, y:  0.10 },  // Consumer Disc · cyclical risk-on
  XLF:  { x:  0.25, y:  0.55 },  // Financials · yields up = good, stress = bad
  XLI:  { x: -0.20, y:  0.05 },  // Industrials · cyclical
  XLB:  { x: -0.10, y:  0.30 },  // Materials · cyclical infl
  XLE:  { x:  0.45, y:  0.55 },  // Energy · infl play, stressy
  XLV:  { x:  0.00, y: -0.20 },  // Health Care · defensive neutral
  XLP:  { x: -0.45, y: -0.45 },  // Staples · defensive defl-friendly
  XLU:  { x:  0.35, y: -0.50 },  // Utilities · rate-sensitive defensive
  XLRE: { x:  0.45, y: -0.50 },  // REITs · rate-sensitive defensive
};

/* ─── Regime canvas — the 2D macro map ───────────────────────────── */
const RegimeCanvas = ({ data, onHover, hover, onSelect, selected, aspect = 1.78, sectorOverlay = false, sectorData = null, onHoverSector, hoverSector, showIndicators = true }) => {
  /* Responsive: viewBox is fixed; SVG fills its container width and lets
     the host card grow its height naturally. */
  const W = 1200, H = Math.round(W / aspect);
  const px = (x) => 60 + (x + 1) / 2 * (W - 120);
  const py = (y) => H - 60 - (y + 1) / 2 * (H - 120);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lm-mapsvg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="lm-q-extreme" cx="0.85" cy="0.15" r="0.6">
          <stop offset="0%" stopColor="var(--mt-down)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--mt-down)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lm-q-cool" cx="0.15" cy="0.85" r="0.6">
          <stop offset="0%" stopColor="var(--mt-up)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--mt-up)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lm-glow" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="var(--mt-accent)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--mt-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#lm-q-extreme)" />
      <rect x="0" y="0" width={W} height={H} fill="url(#lm-q-cool)" />

      <line x1={W / 2} x2={W / 2} y1="30" y2={H - 30} stroke="var(--mt-line-1)" strokeDasharray="2 4" />
      <line x1="30" x2={W - 30} y1={H / 2} y2={H / 2} stroke="var(--mt-line-1)" strokeDasharray="2 4" />

      <text x={W - 12} y={H / 2 - 8} textAnchor="end" className="lm-axlbl">stress ↑</text>
      <text x="12" y={H / 2 - 8} className="lm-axlbl">← calm</text>
      <text x={W / 2 + 8} y="28" className="lm-axlbl">inflationary ↑</text>
      <text x={W / 2 + 8} y={H - 14} className="lm-axlbl">↓ deflationary</text>

      <text x={W - 24} y="40" textAnchor="end" className="lm-quadlbl lm-quadlbl--extreme">RISK OFF · INFL</text>
      <text x="24" y="40" className="lm-quadlbl">RISK ON · INFL</text>
      <text x={W - 24} y={H - 24} textAnchor="end" className="lm-quadlbl">RISK OFF · DEFL</text>
      <text x="24" y={H - 24} className="lm-quadlbl lm-quadlbl--cool">RISK ON · DEFL</text>

      <g transform={`translate(${px(-0.55)} ${py(0.45)})`}>
        <circle r="22" fill="none" stroke="var(--mt-accent)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
        <line x1="-30" x2="30" y1="0" y2="0" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
        <line x1="0" x2="0" y1="-30" y2="30" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
        <circle r="5" fill="var(--mt-accent)" stroke="var(--mt-surface)" strokeWidth="2" />
        <text x="14" y="-26" className="lm-mappinlbl">Engine call</text>
        <text x="14" y="-12" className="lm-mappinlbl lm-mappinlbl--strong">Risk On · Inflationary</text>
      </g>

      {sectorOverlay && sectorData && sectorData.map((s) => {
        const pos = SECTOR_POS[s.code];
        if (!pos) return null;
        const x = px(pos.x), y = py(pos.y);
        const isOver = s.tilt > 0.1;
        const isUnder = s.tilt < -0.1;
        const isHover = hoverSector === s.code;
        const r = 6 + (s.weight / 28) * 14;
        const col = isOver ? "var(--mt-up)" : isUnder ? "var(--mt-down)" : "var(--mt-ink-3)";
        return (
          <g key={s.code} transform={`translate(${x} ${y})`}
             onMouseEnter={() => onHoverSector?.(s.code)} onMouseLeave={() => onHoverSector?.(null)}
             style={{ cursor: "pointer" }}>
            <circle r={isHover ? r + 4 : r} fill={col} opacity="0.22" />
            <circle r={isHover ? r * 0.55 : r * 0.45} fill={col} stroke="var(--mt-surface)" strokeWidth="1.5" />
            <text textAnchor="middle" y={-r - 4} className="lm-sectorlbl" style={{ fill: col }}>{s.code}</text>
            {isHover && (
              <g transform={`translate(${x > 600 ? -22 : 22} ${-r - 30})`}>
                <rect x={x > 600 ? -150 : 0} y="0" width="150" height="56" rx="8"
                      fill="var(--mt-surface)" stroke={col} strokeWidth="1.5" />
                <text x={x > 600 ? -142 : 8} y="18" className="lm-tipname">{s.name}</text>
                <text x={x > 600 ? -142 : 8} y="34" className="lm-tipval" style={{ fontSize: 14 }}>
                  {s.tilt > 0 ? "+" : ""}{s.tilt.toFixed(1)}% tilt
                </text>
                <text x={x > 600 ? -142 : 8} y="48" className="lm-tippct">{s.weight.toFixed(1)}% of S&amp;P</text>
              </g>
            )}
          </g>
        );
      })}

      {showIndicators && data.map((d) => {
        const x = px(d.x),y = py(d.y);
        const isHover = hover?.id === d.id;
        const isSelected = selected?.id === d.id;
        const col = d.state === "extreme" ? "var(--mt-down)" : d.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)";
        return (
          <g key={d.id} className="lm-mapdot" transform={`translate(${x} ${y})`}
          onMouseEnter={() => onHover(d)} onMouseLeave={() => onHover(null)}
          onClick={() => onSelect?.(isSelected ? null : d)}
          style={{ cursor: "pointer" }}>
            {isSelected && <circle r={18} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />}
            <circle r={isHover || isSelected ? 12 : 8} fill={col} opacity={isSelected ? 0.28 : 0.18} />
            <circle r={isHover || isSelected ? 6 : 4} fill={col} stroke="var(--mt-surface)" strokeWidth="1.5"
            style={{ transition: "r 200ms" }} />
            {isHover &&
            <g>
                <line x1="0" y1="0" x2={x > W / 2 ? -18 : 18} y2={-22} stroke={col} strokeWidth="1" />
                <g transform={`translate(${x > W / 2 ? -22 : 22} ${-72})`}>
                  <rect x={x > W / 2 ? -160 : 0} y="0" width="160" height="60" rx="8"
                fill="var(--mt-surface)" stroke={col} strokeWidth="1.5" />
                  <text x={x > W / 2 ? -150 : 10} y="18" className="lm-tipname">{d.name}</text>
                  <text x={x > W / 2 ? -150 : 10} y="36" className="lm-tipval">
                    {d.value.toFixed(d.value > 100 ? 0 : 2)}{d.unit}
                  </text>
                  <text x={x > W / 2 ? -150 : 10} y="50" className="lm-tippct">{d.pct}ᵗʰ pctile · {d.state}</text>
                </g>
              </g>
            }
          </g>);

      })}
      <text x="50" y="20" className="lm-mapttl">macro position · stress × yield regime · 5y normalized</text>
    </svg>);

};

/* Layout helper: positions every indicator on the 2D regime canvas.
   X axis = stress signal (right = high stress) keyed off STATE so red dots
   always live on the right; high-percentile-but-not-extreme stays mid.
   Y axis = yield regime (up = inflationary) keyed off domain.            */
function positionIndicators(inds) {
  return inds.map((ind, i) => {
    const xBase =
      ind.state === "extreme"  ? 0.62 :
      ind.state === "elevated" ? 0.18 :
      -0.55;
    const yBase = (
      ind.domain === "Rates"    ?  0.40 :
      ind.domain === "Equities" ?  0.10 :
      ind.domain === "Credit"   ? -0.05 :
      ind.domain === "Money"    ? -0.25 :
      ind.domain === "Economy"  ? -0.42 : 0
    );
    return {
      ...ind,
      x: xBase + Math.sin(i * 1.7) * 0.12,
      y: yBase + Math.cos(i * 1.3) * 0.18,
    };
  });
}

/* ─── Indicator drill-down panel ──────────────────────────────────── */
const IndicatorDetail = ({ ind, onClose, onMethodology, onCompare }) => {
  const [tf, setTf] = useStateLm2("5Y");
  const [compare, setCompare] = useStateLm2(null);
  const [pickerOpen, setPickerOpen] = useStateLm2(false);
  const tfMap = { "1Y": 52, "5Y": 240, "10Y": 480, "Max": 800 };
  const series = useMemoLm2(() => gen(tfMap[tf], ind.value * 0.9, ind.value * 0.4, ind.dir === "up" ? 0.3 : -0.1).concat([ind.value]),
  [tf, ind.id]);
  const compareSeries = useMemoLm2(() =>
    compare ? gen(tfMap[tf], compare.value * 0.9, compare.value * 0.4, compare.dir === "up" ? 0.3 : -0.1).concat([compare.value]) : null,
  [tf, compare?.id]);
  const accent = ind.state === "extreme" ? "var(--mt-down)" : ind.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)";
  const cmpAccent = compare ? (compare.state === "extreme" ? "var(--mt-down)" : compare.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)") : null;

  return (
    <section className="lm-inddetail mt-fade" style={{ padding: "0 var(--mt-pad-page) 32px" }}>
      <div className="lm-inddetailwrap">
        <header className="lm-iddhead">
          <div>
            <div className="mt-eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: accent }}>● {ind.domain}</span>
              <span className="lm-flowfootsep" />
              <span>{ind.state} · {ind.pct}ᵗʰ pctile (5y)</span>
              <span className="lm-flowfootsep" />
              <FreshnessChip state={ind.fresh} asOf={ind.asOf} variant="label" />
            </div>
            <h3 className="lm-iddname">{ind.name}</h3>
            <p className="lm-iddprose">{describeIndicator(ind)}</p>
          </div>
          <div className="lm-iddctrls">
            <div className="mt-pillgroup">
              {Object.keys(tfMap).map((k) =>
              <button key={k} className={`mt-pill ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>{k}</button>
              )}
            </div>
            <button className="lm-iddclose" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>
        <div className="lm-iddbody">
          <div>
            <BigHistoryChart data={series} accent={accent} compareData={compareSeries} compareAccent={cmpAccent} />
            <div className="lm-iddlegend">
              <span><AnimatedNumber value={ind.value} format={(v) => v.toFixed(v > 100 ? 0 : 2)} suffix={ind.unit} /></span>
              <span className={`num ${ind.dir === "up" ? "up" : "down"}`}>
                {ind.dir === "up" ? "▲" : "▼"} {Math.abs(ind.delta).toFixed(2)}{ind.unit} · w/w
              </span>
              <span className="lm-flowfootsep" />
              <span className="lm-iddleg-dim">5Y range</span>
              <span className="num">{(ind.value * 0.7).toFixed(2)}–{(ind.value * 1.15).toFixed(2)}{ind.unit}</span>
              {compare && (
                <>
                  <span className="lm-flowfootsep" />
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: cmpAccent }}>
                    <span style={{ width: 16, height: 2, background: cmpAccent, display: "inline-block" }} />
                    {compare.name}
                    <button onClick={() => setCompare(null)}
                      style={{ border: "none", background: "transparent", color: cmpAccent, cursor: "pointer", padding: 0, fontSize: 14 }}>✕</button>
                  </span>
                </>
              )}
            </div>
          </div>
          <aside className="lm-iddside">
            <div className="mt-eyebrow">Percentile · last 5 years</div>
            <PercentileBar value={ind.pct} accent={accent} />
            <div className="lm-iddstats">
              <div><div className="mt-eyebrow">Mean</div><b className="num">{(ind.value * 0.85).toFixed(2)}</b></div>
              <div><div className="mt-eyebrow">Median</div><b className="num">{(ind.value * 0.82).toFixed(2)}</b></div>
              <div><div className="mt-eyebrow">σ</div><b className="num">{(ind.value * 0.18).toFixed(2)}</b></div>
              <div><div className="mt-eyebrow">Z-score</div><b className="num">{((ind.pct - 50) / 16).toFixed(2)}</b></div>
            </div>
            <div className="mt-divider" />
            <div className="mt-eyebrow">Related in {ind.domain}</div>
            <ul className="lm-iddrelated">
              {MT_INDICATORS.filter((x) => x.domain === ind.domain && x.id !== ind.id).slice(0, 4).map((r) =>
              <li key={r.id}>
                  <span>{r.name}</span>
                  <span className="num" style={{ color: "var(--mt-ink-1)" }}>{r.value.toFixed(r.value > 100 ? 0 : 2)}{r.unit}</span>
                  <span className={`num lm-iddrel-pct lm-iddrel-pct--${r.state}`}>{r.pct}ᵗʰ</span>
                </li>
              )}
            </ul>
            <div className="lm-iddactions">
              <button className="mt-btn mt-btn--primary" onClick={() => onMethodology?.(ind.id)}>Read methodology →</button>
              <button className="mt-btn" onClick={() => setPickerOpen(!pickerOpen)}>
                {compare ? `Comparing · ${compare.name}` : "+ Compare"}
              </button>
            </div>
            {pickerOpen && (
              <div className="lm-iddpicker mt-fade">
                <div className="mt-eyebrow" style={{ marginBottom: 6 }}>Pick a second indicator to overlay</div>
                <ul className="lm-iddpickerlist">
                  {MT_INDICATORS.filter(x => x.id !== ind.id).slice(0, 10).map(x => (
                    <li key={x.id}>
                      <button onClick={() => { setCompare(x); setPickerOpen(false); }}>
                        <span>{x.name}</span>
                        <span className="lm-iddpicker-meta">{x.domain} · {x.pct}ᵗʰ</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>);

};

function describeIndicator(ind) {
  const lines = {
    "Term premium": "Investor compensation for holding duration. Calculated from the Kim-Wright decomposition of the 10-year yield.",
    "10y real yield": "10-year Treasury yield minus 10-year breakeven inflation. The 'real cost of money' for duration assets.",
    "CAPE": "Shiller cyclically-adjusted P/E. Equity valuation, smoothed across 10 years of inflation-adjusted earnings.",
    "MOVE · bond volatility": "Bond-market volatility index. The 'VIX of rates' — a stress signal for duration.",
    "Yield curve (10y−2y)": "10-year Treasury minus 2-year. Inversions historically precede recessions by 6–18 months.",
    "10y breakeven": "Implied long-term inflation expectation: 10-year nominal yield minus 10-year TIPS.",
    "HY−IG spread": "High-yield minus investment-grade credit spread. Widens when credit stress is brewing.",
    "VIX": "S&P 500 30-day implied volatility — the classic equity fear gauge.",
    "SKEW Index": "Tail-risk skew in S&P 500 options. High readings flag investors paying up for left-tail protection.",
    "Bank reserves": "Reserves held by depository institutions at the Fed. Liquidity proxy for the banking system.",
    "Initial claims": "Weekly unemployment claims. Leading labor-market indicator.",
    "JOLTS quits": "Voluntary separations as % of employment. High when workers feel confident.",
    "Core CPI yoy": "Inflation ex-food & energy. The Fed's preferred read on sticky price pressure."
  };
  return lines[ind.name] || `Read this indicator with the Tilt engine's regime: today's signal is ${ind.state}, sitting in the ${ind.pct}th percentile of the last 5 years.`;
}

/* ─── Sector flow row + drill body ────────────────────────────────── */
const SectorFlow = ({ sectors, igData, expandedSectors, expandedIGs, toggleSector, toggleIG }) =>
<div className="lm-flow">
    {sectors.map((s) => {
    const isExpanded = expandedSectors.has(s.code);
    const igs = igData[s.code] || [];
    return (
      <div key={s.code} className={`lm-flowcard ${isExpanded ? "open" : ""}`}>
          <SectorRow s={s} isExpanded={isExpanded} onToggle={() => toggleSector(s.code)} />
          {isExpanded &&
        <SectorDrillBody s={s} igs={igs} expandedIGs={expandedIGs} toggleIG={toggleIG} />
        }
        </div>);

  })}
  </div>;


const SectorRow = ({ s, isExpanded, onToggle }) => {
  const w = Math.max(28, Math.abs(s.tilt) * 18);
  const isOver = s.tilt > 0;
  return (
    <button className="lm-flowrow" onClick={onToggle}>
      <div className="lm-flowname">
        <span className={`lm-flowchev ${isExpanded ? "open" : ""}`}>▸</span>
        <span className="lm-flowcode">{s.code}</span>
        <span>{s.name}</span>
      </div>
      <div className="lm-flowtrack">
        <span className="lm-flowmid" />
        <span className={`lm-flowbar lm-flowbar--${isOver ? "over" : "under"}`}
        style={{ width: `${w}px`, left: isOver ? "50%" : `calc(50% - ${w}px)` }}>
          <span className="lm-flowstripe" />
        </span>
      </div>
      <div className={`lm-flowval num ${isOver ? "up" : "down"}`}>
        {isOver ? "+" : ""}{s.tilt.toFixed(1)}%
      </div>
      <div className="lm-flowweight num">{s.weight.toFixed(1)}<i>%</i></div>
    </button>);

};

const SectorDrillBody = ({ s, igs, expandedIGs, toggleIG, openTicker }) =>
<div className="lm-sectordrill mt-fade">
    <div className="lm-sdmeta">
      <div>
        <div className="mt-eyebrow">Sector reading</div>
        <div className="lm-sdmetaline">
          <span>5y pctile</span><b className="num">{(s.score * 15).toFixed(0)}ᵗʰ</b>
          <span className="lm-flowfootsep" />
          <span>Composite</span><b className="num">{s.score.toFixed(1)}<i>/5</i></b>
          <span className="lm-flowfootsep" />
          <FreshnessChip state="fresh" asOf="May 21" variant="label" />
        </div>
      </div>
      <Sparkline data={gen(60, 50, 30)} width={260} height={56}
    stroke={s.tilt >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
    fill={s.tilt >= 0 ? "var(--mt-up)" : "var(--mt-down)"} area />
    </div>
    <div className="lm-igtable">
      <div className="lm-igheader">
        <span>Industry group</span><span>Tilt</span>
        <span className="lm-igheader-bar">vs. cap weight</span>
        <span className="num">Weight</span><span className="num">Score</span><span />
      </div>
      {igs.map((ig) => {
      const igOpen = expandedIGs.has(ig.name);
      const wIG = Math.max(22, Math.abs(ig.tilt) * 28);
      const isOver = ig.tilt > 0;
      return (
        <div key={ig.name} className={`lm-igcard ${igOpen ? "open" : ""}`}>
            <button className="lm-igrow" onClick={() => toggleIG(ig.name)}>
              <span className="lm-igname">
                <span className={`lm-flowchev ${igOpen ? "open" : ""}`}>▸</span>
                {ig.name}
              </span>
              <span className={`num ${isOver ? "up" : "down"}`} style={{ fontWeight: 600 }}>
                {isOver ? "+" : ""}{ig.tilt.toFixed(1)}%
              </span>
              <span className="lm-igbar">
                <span className="lm-flowmid" />
                <span className={`lm-flowbar lm-flowbar--${isOver ? "over" : "under"}`}
              style={{ width: `${wIG}px`, left: isOver ? "50%" : `calc(50% - ${wIG}px)` }} />
              </span>
              <span className="num lm-igw">{ig.weight.toFixed(1)}<i>%</i></span>
              <span className="num lm-igscore">{ig.score.toFixed(1)}<i>/5</i></span>
              <span className="lm-igchev">{igOpen ? "▾" : "▸"}</span>
            </button>
            {igOpen &&
          <div className="lm-igdrill mt-fade">
                <div className="lm-igdrillcol">
                  <div className="mt-eyebrow">90-day relative · vs S&amp;P 500</div>
                  <Sparkline data={gen(90, 100, 14, isOver ? 1 : -1)} width={400} height={84}
              stroke={isOver ? "var(--mt-up)" : "var(--mt-down)"}
              fill={isOver ? "var(--mt-up)" : "var(--mt-down)"} area />
                  <div className="lm-igreason">
                    <div className="mt-eyebrow">Why the tilt</div>
                    <p>
                      Engine is overweighting <b>{ig.name}</b> on stronger {isOver ? "breadth + earnings revisions" : "credit-spread divergence"} ·
                      contribution to portfolio active weight:{" "}
                      <b className={`num ${isOver ? "up" : "down"}`}>{isOver ? "+" : ""}{(ig.tilt * 0.6).toFixed(2)}%</b>.
                    </p>
                  </div>
                </div>
                <div className="lm-igdrillcol">
                  <div className="mt-eyebrow">Top names · MacroTilt score</div>
                  <ul className="lm-iglist">
                    {ig.top.slice(0, 5).map((tk, i) =>
                <li key={tk}>
                        <span className="lm-igtk lm-tkmain--link"
                              onClick={(e) => { e.stopPropagation(); openTicker?.(tk); }}>{tk}</span>
                        <span className="lm-igdial"><ScoreDial score={Math.max(2, 4.6 - i * 0.4)} max={5} size={36} /></span>
                        <span className={`lm-iggrowth num ${i % 3 ? "up" : "down"}`}>
                          {i % 3 ? "+" : "−"}{(2.4 - i * 0.5).toFixed(1)}%
                        </span>
                        <span><Sparkline data={gen(20, 100, 12, 0.4 - i * 0.1)} width={70} height={18}
                    stroke={i % 3 ? "var(--mt-up)" : "var(--mt-down)"} /></span>
                      </li>
                )}
                  </ul>
                  <button className="lm-igseeall">See all {ig.top.length * 6} names in scanner →</button>
                </div>
              </div>
          }
          </div>);

    })}
    </div>
  </div>;


/* ─── Score model — explicit weighting so the drill reconciles ─────
   Total MacroTilt Score (0–10) = sum over components of
   (component score on /5 scale) × weight × 2.
   Weights sum to 1.00; the ×2 converts /5 → /10 contribution. */
const MT_SCORE_WEIGHTS = [
  { key: "Technicals",  weight: 0.25, why: "200d trend up · RSI 62 · MACD bullish cross" },
  { key: "Insider",     weight: 0.20, why: "3 buys · 1 sale · 60d ratio" },
  { key: "Analyst",     weight: 0.20, why: "2 upgrades · raised PT consensus" },
  { key: "Options vol", weight: 0.15, why: "Calls 2.4× puts · IV rank 31" },
  { key: "Congress",    weight: 0.10, why: "1 senate buy · last week" },
  { key: "Dark pool",   weight: 0.10, why: "Block prints below VWAP" },
];

function breakdownForTicker(row) {
  /* Stable per-ticker breakdown derived from row.score so the math always
     reconciles. Each component receives the row's mean (on /5 scale)
     plus a stable per-component offset; sum × weights × 2 ≈ headline. */
  const meanFive = row.score / 2;
  const offsets = [0.65, 0.78, 0.32, 0.10, -0.55, -0.30];
  const items = MT_SCORE_WEIGHTS.map((c, i) => {
    const s5 = Math.max(0.5, Math.min(5, meanFive + offsets[i]));
    return { ...c, score5: s5, contribution: s5 * c.weight * 2 };
  });
  /* Normalize to land on the headline score exactly. */
  const sum = items.reduce((s, x) => s + x.contribution, 0);
  const k = row.score / sum;
  return items.map(x => ({ ...x, contribution: x.contribution * k, score5: Math.min(5, x.score5 * k) }));
}

/* ─── Scanner card + drill ──────────────────────────────────────── */
const ScanList = ({ rows, drillOpen, setDrillOpen, onOpenTicker, onAct }) =>
<ul className="lm-scanlist">
    {rows.map((row) =>
  <li key={row.ticker} className={`lm-scancard ${drillOpen === row.ticker ? "open" : ""}`}>
        <button className="lm-scanrow" onClick={() => setDrillOpen(drillOpen === row.ticker ? null : row.ticker)}>
          <div className="lm-tk">
            <span className="lm-tkmain lm-tkmain--link"
                  onClick={(e) => { e.stopPropagation(); onOpenTicker?.(row.ticker); }}>
              {row.ticker}
            </span>
            <div className="lm-tksub">{row.name} · {row.sector}</div>
          </div>
          <div className="lm-tkscore"><ScoreDial score={row.score} /></div>
          <div>
            <div className="lm-tkpx num">${row.price.toFixed(2)}</div>
            <div className={`lm-tkchg num ${row.chg >= 0 ? "up" : "down"}`}>{row.chg > 0 ? "+" : ""}{row.chg.toFixed(2)}%</div>
          </div>
          <Sparkline data={gen(30, row.price, row.price * 0.07)} width={100} height={32}
            stroke={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
            fill={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"} area />
          <div className="lm-tkfacets">
            <Tip content={`Insider buys/sells (60d): ${row.insider.join(", ")}`}><span className="lm-facet">⌂ {row.insider.length}</span></Tip>
            <Tip content={row.dark ? `Dark pool block at $${row.dark}` : "No recent dark-pool prints"}><span className="lm-facet">◐ {row.dark ? "✓" : "—"}</span></Tip>
            <Tip content="Options flow: bullish skew, calls > puts"><span className="lm-facet">∿ ↑</span></Tip>
          </div>
          <div className="lm-tkchev">{drillOpen === row.ticker ? "▾" : "▸"}</div>
        </button>
        {drillOpen === row.ticker && <ScanDrill row={row} onOpenTicker={onOpenTicker} onAct={onAct} />}
      </li>
  )}
  </ul>;


const ScanDrill = ({ row, onOpenTicker, onAct }) => {
  const items = useMemoLm2(() => breakdownForTicker(row), [row.ticker, row.score]);
  const total = items.reduce((s, x) => s + x.contribution, 0);

  /* Events with specific day indices on a 0–89 path */
  const events = [
    { idx: 86, badge: "A", label: "CEO buy · $128K", when: "4d ago" },
    { idx: 83, badge: "B", label: "CFO buy · $86K",   when: "7d ago" },
    { idx: 79, badge: "C", label: "Block 142K @ $5.40", when: "11d ago" },
    { idx: 76, badge: "N", label: "BMO → Outperform",  when: "14d ago" },
  ];

  return (
    <div className="lm-drill mt-fade">
      <div className="lm-drillcol">
        <div className="lm-drillheadrow">
          <div className="mt-eyebrow">Signal composition</div>
          <div className="lm-drilltotal num">
            <Tip content="Sum of contribution column. Each component: weight × (score / 5) × 10.">
              <span>= <b>{total.toFixed(2)}</b><i>/10</i></span>
            </Tip>
          </div>
        </div>
        <table className="lm-scoremath">
          <thead>
            <tr><th>Component</th><th className="num">Weight</th><th className="num">Score</th><th className="num">Contribution</th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.key}>
                <td>
                  <div className="lm-scoreklabel">{c.key}</div>
                  <div className="lm-scorekwhy">{c.why}</div>
                </td>
                <td className="num">{(c.weight * 100).toFixed(0)}<span className="lm-scoredim">%</span></td>
                <td className="num lm-scorebarcell">
                  <span className="lm-scoreval">{c.score5.toFixed(1)}<i>/5</i></span>
                  <span className="lm-scorebar"><b style={{ width: `${(c.score5/5)*100}%` }} /></span>
                </td>
                <td className="num lm-scorecontr"><b>{c.contribution.toFixed(2)}</b></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><b>MacroTilt Score</b></td>
              <td className="num lm-scorecontr"><b>{total.toFixed(1)}<i>/10</i></b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="lm-drillcol">
        <div className="mt-eyebrow">90-day path · events marked</div>
        <EventChart data={gen(90, row.price, row.price * 0.1)} accent={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"} events={events} />
        <div className="lm-drilltimeline">
          {events.map(e => (
            <div key={e.label} className="lm-evtrow">
              <span className="lm-evtbadge">{e.badge}</span>
              <span className="lm-evtlbl">{e.label}</span>
              <span className="lm-evtwhen num">{e.when}</span>
            </div>
          ))}
        </div>
        <div className="lm-drillctas">
          <button className="mt-btn mt-btn--primary" onClick={() => onOpenTicker?.(row.ticker)}>Open ticker detail →</button>
          <button className="mt-btn" onClick={() => onAct?.("watchlist", row.ticker)}>+ Watchlist</button>
          <button className="mt-btn" onClick={() => onAct?.("copy", row.ticker)}>Copy ticker</button>
        </div>
      </div>
    </div>
  );
};

/* Chart used inside the scanner drill — sparkline with event markers. */
const EventChart = ({ data, accent, events }) => {
  const W = 480, H = 130, P = 10;
  const min = Math.min(...data), max = Math.max(...data);
  const r = max - min || 1;
  const stepX = (W - P*2) / (data.length - 1);
  const pts = data.map((d, i) => [P + i*stepX, H - P - ((d - min) / r) * (H - P*2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${dPath} L${pts[pts.length-1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lm-evtchart">
      <defs>
        <linearGradient id="lm-evt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#lm-evt-area)" />
      <path d={dPath} fill="none" stroke={accent} strokeWidth="1.6" />
      {events.map(e => {
        const p = pts[Math.min(pts.length - 1, e.idx)];
        if (!p) return null;
        return (
          <g key={e.badge} transform={`translate(${p[0]} ${p[1]})`}>
            <line x1="0" y1="0" x2="0" y2="-22" stroke={accent} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
            <circle cy="-26" r="8" fill="var(--mt-surface)" stroke={accent} strokeWidth="1.5" />
            <text textAnchor="middle" y="-23" fontSize="9.5" fontWeight="700"
                  fontFamily="var(--mt-font-mono)" fill={accent}>{e.badge}</text>
            <circle r="3.5" fill={accent} stroke="var(--mt-surface)" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
};


Object.assign(window, {
  RegimeCanvas, positionIndicators, IndicatorDetail,
  SectorFlow, SectorRow, SectorDrillBody, ScanList, ScanDrill, EventChart,
  MT_SCORE_WEIGHTS, breakdownForTicker, SECTOR_POS,
});