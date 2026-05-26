import React, { useMemo, useState } from "react";
import { AnimatedNumber, FreshnessChip, Sparkline, Tip } from "../atoms";
import SectorFlow from "../components/SectorFlow";
import { BigGauge, GaugeLegend } from "../components/BigGauge";
import { MT_SECTORS, MT_IG, gen } from "../data/mock";

export default function TiltPage({ setPage, openTicker }) {
  const stress = 78.4;
  const yieldDelta = 49;
  const [expandedSectors, setExpandedSectors] = useState(new Set(["XLK"]));
  const [expandedIGs, setExpandedIGs] = useState(new Set(["Semiconductors"]));

  const stressHist = useMemo(() => gen(120, 80, 22, 0, "stress"), []);
  const yieldHist = useMemo(() => gen(120, 30, 25, 0.4, "yield"), []);

  return (
    <>
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
            Sector tilts within the equity bucket key off six factor reads. Defensive sleeve fires only when stress crosses Watch.{" "}
            <a onClick={(e) => { e.preventDefault(); setPage("methodology"); }} href="#">Read the full methodology →</a>
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
            <BigGauge value={stress} max={200} thresholds={[{ pos: 0.58 }, { pos: 0.62 }]} />
            <GaugeLegend zones={[
              { kind: "up", label: "Risk On", range: "≤ 116" },
              { kind: "warn", label: "Watch", range: "116–124" },
              { kind: "down", label: "Risk Off", range: "≥ 124" },
            ]} />
            <div className="at-gaugefoot num">
              <span><AnimatedNumber value={stress} format={(v) => v.toFixed(1)} /></span>
              <span className="at-gaugedim">23ʳᵈ pctile · 5y</span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 10 }}>24-week history</div>
            <Sparkline data={stressHist} width={520} height={56} stroke="var(--mt-accent)" fill="var(--mt-accent)" area />
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
            <BigGauge value={yieldDelta} max={100} bidirectional thresholds={[{ pos: 0.445 }, { pos: 0.66 }]} />
            <GaugeLegend zones={[
              { kind: "up", label: "Deflationary", range: "≤ −11 bp" },
              { kind: "warn", label: "Neutral", range: "−11–+32" },
              { kind: "down", label: "Inflationary", range: "≥ +32 bp" },
            ]} />
            <div className="at-gaugefoot num">
              <span>+<AnimatedNumber value={yieldDelta} format={(v) => v.toFixed(0)} /> bp</span>
              <span className="at-gaugedim">80ᵗʰ pctile · 5y</span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 10 }}>24-week history</div>
            <Sparkline data={yieldHist} width={520} height={56} stroke="var(--mt-warn)" fill="var(--mt-warn)" area />
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
              Defensive sleeve on{" "}
              <Tip content="Activates when stress signal crosses Watch threshold (MOVE > 116).">standby</Tip> —
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
        <SectorFlow
          sectors={MT_SECTORS}
          igData={MT_IG}
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
          openTicker={openTicker}
        />
        <div className="lm-flowfoot">
          <span><b>Overweight</b> · 5 sectors · +12.0%</span>
          <span className="lm-flowfootsep" />
          <span><b>Underweight</b> · 6 sectors · −10.7%</span>
          <span className="lm-flowfootsep" />
          <FreshnessChip state="fresh" asOf="May 21" variant="label" />
          <span style={{ marginLeft: "auto" }}>
            <button className="mt-btn mt-btn--ghost" onClick={() => setPage("portfolio")}>
              Apply to my portfolio →
            </button>
          </span>
        </div>
      </section>

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
              const stressLabel = i < 8 ? "on" : i < 14 ? "watch" : "on";
              return (
                <Tip
                  key={i}
                  content={`Week ${i + 1}: ${stressLabel === "on" ? "Risk On" : "Watch"} · ${
                    stage === "infl" ? "Inflationary" : "Neutral"
                  }`}
                  bare
                  block
                >
                  <div className={`at-regcell at-regcell--${stage} at-regcell--${stressLabel}`} />
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
            <span style={{ marginLeft: "auto" }} className="num">24 weeks · rebalanced 2× since Jan</span>
          </div>
        </div>
      </section>
    </>
  );
}
