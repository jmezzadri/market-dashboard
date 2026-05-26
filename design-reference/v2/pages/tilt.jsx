/* Page · Asset Tilt
   Engine read: stress + yield regime → equity vs defensive split → sector
   tilts. Two gauges, a regime ribbon, the sector river, and a stats block
   comparing the engine to S&P 500.                                       */

const PageTilt = ({ setPage, openTicker }) => {
  const stress = useTickerJitter(78.4, 0.003, 1800);
  const yieldDelta = useTickerJitter(49, 0.004, 2200);
  const [expandedSectors, setExpandedSectors] = useState(new Set(["XLK"]));
  const [expandedIGs, setExpandedIGs] = useState(new Set(["Semiconductors"]));

  /* Stable mock series — memo'd so we don't regenerate on every tick. */
  const stressHist = useMemo(() => gen(120, 80, 22), []);
  const yieldHist  = useMemo(() => gen(120, 30, 25, 0.4), []);

  return (
    <div className="mt-pagebody">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Asset Tilt · today's call</div>
          <h1 className="mt-h1">
            <span className="at-headalloc">
              <span><span className="num">100</span><i>% equity</i></span>
              <span className="at-headalloc-sep">·</span>
              <span className="at-headalloc--dim"><span className="num">0</span><i>% defensive</i></span>
            </span>
          </h1>
          <p className="mt-deck">
            <b>Risk On · <i style={{ color: "var(--mt-warn)", fontStyle: "italic" }}>Inflationary</i> regime.</b>{" "}
            Bond-market volatility (MOVE) and the 3-month change in 10y yield set the regime and equity exposure.
            Sector tilts within the equity bucket key off six factor reads. Defensive sleeve fires only when stress crosses Watch.
            <a onClick={(e) => { e.preventDefault(); setPage("methodology"); }} href="#"> Read the full methodology →</a>
          </p>
        </div>
        <div className="at-keystats at-keystats--compact">
          <div className="mt-eyebrow">Backtest · 1986–2026</div>
          <div className="at-keygrid">
            <div><div className="mt-eyebrow">CAGR</div><b className="num at-keynum">11.93<i>%</i></b><span className="at-keyvs num">vs SPY 11.16%</span></div>
            <div><div className="mt-eyebrow">Sharpe</div><b className="num at-keynum">0.61</b><span className="at-keyvs num">vs SPY 0.47</span></div>
            <div><div className="mt-eyebrow">Max DD</div><b className="num at-keynum down">−32.1<i>%</i></b><span className="at-keyvs num">vs SPY −54.6%</span></div>
            <div><div className="mt-eyebrow">Validated</div><b className="num at-keynum">2,056w</b><span className="at-keyvs num">weekly rebal</span></div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Today's engine read</div>
            <div className="mt-h2">Risk On · Inflationary — 100% equity, defensive on standby.</div>
          </div>
          <FreshnessChip state="fresh" asOf="May 21 · weekly" variant="pill" label="Engine in cadence" />
        </div>
        <div className="at-engineread">
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow">Stress signal · MOVE</div>
              <div className="mt-pillgroup">
                <button className="mt-pill on">RISK ON</button>
                <button className="mt-pill">WATCH</button>
                <button className="mt-pill">RISK OFF</button>
              </div>
            </div>
            <BigGauge value={stress} max={200}
                      thresholds={[{ pos: 0.58 }, { pos: 0.62 }]} />
            <GaugeLegend zones={[
              { kind: "up",   label: "Risk On", range: "≤ 116" },
              { kind: "warn", label: "Watch",   range: "116–124" },
              { kind: "down", label: "Risk Off", range: "≥ 124" },
            ]} />
            <div className="at-gaugefoot num">
              <span><AnimatedNumber value={stress} format={v => v.toFixed(1)} /></span>
              <span className="at-gaugedim">23ʳᵈ pctile · 5y</span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 10 }}>24-week history</div>
            <Sparkline data={stressHist} width={520} height={56}
                       stroke="var(--mt-accent)" fill="var(--mt-accent)" area />
            <div className="at-gaugemini num"><span>24W</span><span>NOW</span></div>
          </article>

          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow">Yield regime · 3M Δ 10y</div>
              <div className="mt-pillgroup">
                <button className="mt-pill">DEFL.</button>
                <button className="mt-pill">NEUTRAL</button>
                <button className="mt-pill on">INFL.</button>
              </div>
            </div>
            <BigGauge value={yieldDelta} max={100} bidirectional
                      thresholds={[{ pos: 0.445 }, { pos: 0.66 }]} />
            <GaugeLegend zones={[
              { kind: "up",   label: "Deflationary", range: "≤ −11 bp" },
              { kind: "warn", label: "Neutral",      range: "−11–+32" },
              { kind: "down", label: "Inflationary", range: "≥ +32 bp" },
            ]} />
            <div className="at-gaugefoot num">
              <span>+<AnimatedNumber value={yieldDelta} format={v => v.toFixed(0)} /> bp</span>
              <span className="at-gaugedim">80ᵗʰ pctile · 5y</span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 10 }}>24-week history</div>
            <Sparkline data={yieldHist} width={520} height={56}
                       stroke="var(--mt-warn)" fill="var(--mt-warn)" area />
            <div className="at-gaugemini num"><span>24W</span><span>NOW</span></div>
          </article>

          <article className="mt-card at-stance">
            <div className="mt-eyebrow">Allocation</div>
            <div className="at-stanceval">
              <span className="at-stancepct num">100<i>%</i></span>
              <span className="at-stancelabel">equity</span>
            </div>
            <div className="at-stanceval at-stanceval--dim">
              <span className="at-stancepct num">0<i>%</i></span>
              <span className="at-stancelabel">defensive</span>
            </div>
            <div className="mt-divider" />
            <p style={{ fontSize: 12.5, color: "var(--mt-ink-2)", lineHeight: 1.5, margin: 0 }}>
              Defensive sleeve on <Tip content="Activates when stress signal crosses Watch threshold (MOVE &gt; 116).">standby</Tip> —
              would compose <b>12% gold</b>, <b>9% TLT</b>, <b>4% cash</b> in this inflationary regime.
            </p>
          </article>
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Equity bucket · sector tilts</div>
            <div className="mt-h2">Where the engine wants overweight — and what's underneath.</div>
          </div>
          <div className="mt-pillgroup">
            <button className="mt-pill on">Tilt vs cap</button>
            <button className="mt-pill">Weight</button>
            <button className="mt-pill">Score</button>
          </div>
        </div>
        <SectorFlow sectors={MT_SECTORS} igData={MT_IG}
                    expandedSectors={expandedSectors}
                    expandedIGs={expandedIGs}
                    toggleSector={(c) => {
                      const n = new Set(expandedSectors);
                      if (n.has(c)) n.delete(c); else n.add(c);
                      setExpandedSectors(n);
                    }}
                    toggleIG={(name) => {
                      const n = new Set(expandedIGs);
                      if (n.has(name)) n.delete(name); else n.add(name);
                      setExpandedIGs(n);
                    }}
                    openTicker={openTicker} />
        <div className="lm-flowfoot">
          <span><b>Overweight</b> · 5 sectors · +12.0%</span>
          <span className="lm-flowfootsep" />
          <span><b>Underweight</b> · 6 sectors · −10.7%</span>
          <span className="lm-flowfootsep" />
          <FreshnessChip state="fresh" asOf="May 21" variant="label" />
          <span style={{ marginLeft: "auto" }}>
            <button className="mt-btn mt-btn--ghost" onClick={() => setPage("portfolio")}>Apply to my portfolio →</button>
          </span>
        </div>
      </section>

      {/* Regime history strip */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Regime history · 24 weeks</div>
            <div className="mt-h2">When the engine moved.</div>
          </div>
        </div>
        <div className="mt-card">
          <div className="at-regstrip">
            {Array.from({ length: 24 }, (_, i) => {
              const stage = i < 6 ? "neutral" : i < 12 ? "infl" : i < 18 ? "neutral" : "infl";
              const stress = i < 8 ? "on" : i < 14 ? "watch" : "on";
              return (
                <Tip key={i} content={`Week ${i + 1}: ${stress === "on" ? "Risk On" : "Watch"} · ${stage === "infl" ? "Inflationary" : "Neutral"}`} bare block>
                  <div className={`at-regcell at-regcell--${stage} at-regcell--${stress}`} />
                </Tip>
              );
            })}
          </div>
          <div className="at-regfoot">
            <span><span className="at-regdot at-regdot--on" /> Risk On</span>
            <span><span className="at-regdot at-regdot--watch" /> Watch</span>
            <span><span className="at-regdot at-regdot--off" /> Risk Off</span>
            <span className="lm-flowfootsep" />
            <span><span className="at-regdot at-regdot--neutral" /> Neutral</span>
            <span><span className="at-regdot at-regdot--infl" /> Inflationary</span>
            <span><span className="at-regdot at-regdot--defl" /> Deflationary</span>
            <span style={{ marginLeft: "auto" }} className="num">24 weeks · {/* */}rebalanced 2× since Jan</span>
          </div>
        </div>
      </section>
    </div>
  );
};

const BigGauge = ({ value, max = 100, thresholds = [], bidirectional = false }) => {
  const norm = Math.max(0.02, Math.min(0.98, bidirectional ? (value + max) / (2 * max) : value / max));

  /* Arc position [0,1] → (x,y) on a 120-radius arc centered at (150,140).
     Left edge → (30,140) at 180°, top → (150,20) at -90°, right → (270,140) at 0°. */
  const arcXY = (t) => {
    const a = (180 + t * 180) * Math.PI / 180;
    return [150 + 120 * Math.cos(a), 140 + 120 * Math.sin(a)];
  };
  const arcPath = (t0, t1) => {
    const [x0, y0] = arcXY(t0);
    const [x1, y1] = arcXY(t1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A 120 120 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };

  const sorted = [...thresholds].map(t => ({ ...t, pos: Math.max(0, Math.min(1, t.pos)) })).sort((a, b) => a.pos - b.pos);
  const t1 = sorted[0]?.pos ?? 0.50;
  const t2 = sorted[1]?.pos ?? 0.75;

  const needleAngle = (norm - 0.5) * 180;

  return (
    <svg viewBox="0 0 300 160" style={{ width: "100%", height: 160 }}>
      <path d={arcPath(0, t1)}  fill="none" strokeWidth="10" strokeLinecap="round"
            stroke="color-mix(in oklab, var(--mt-up) 38%, var(--mt-surface-3))" />
      <path d={arcPath(t1, t2)} fill="none" strokeWidth="10"
            stroke="color-mix(in oklab, var(--mt-warn) 48%, var(--mt-surface-3))" />
      <path d={arcPath(t2, 1)}  fill="none" strokeWidth="10" strokeLinecap="round"
            stroke="color-mix(in oklab, var(--mt-down) 40%, var(--mt-surface-3))" />

      <g transform={`translate(150 140) rotate(${needleAngle})`}>
        <line x1="0" y1="0" x2="0" y2="-110" stroke="var(--mt-ink-0)" strokeWidth="3" strokeLinecap="round" />
        <circle cy="-110" r="5" fill="var(--mt-ink-0)" stroke="var(--mt-surface)" strokeWidth="2" />
        <circle r="8" fill="var(--mt-ink-0)" />
        <circle r="3" fill="var(--mt-surface)" />
      </g>
    </svg>
  );
};

const GaugeLegend = ({ zones }) => (
  <div className="at-gaugelegend">
    {zones.map((z, i) => (
      <span key={i} className={`at-gaugezone at-gaugezone--${z.kind}`}>
        <span className="at-gaugezonedot" />
        <span className="at-gaugezonelbl">{z.label}</span>
        <span className="at-gaugezonenum num">{z.range}</span>
      </span>
    ))}
  </div>
);

window.PageTilt = PageTilt;
