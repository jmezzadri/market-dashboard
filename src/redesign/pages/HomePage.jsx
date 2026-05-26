import React, { useMemo, useState } from "react";
import { AnimatedNumber, FreshnessChip, Tip } from "../atoms";
import RegimeCanvas from "../components/RegimeCanvas";
import IndicatorDetail from "../components/IndicatorDetail";
import { MT_INDICATORS, MT_SECTORS, MT_NEWS } from "../data/mock";
import { positionIndicators } from "../data/score";

function FeatureCard({ num, label, title, body, stat, page, setPage }) {
  return (
    <button className="hm-feat" onClick={() => setPage(page)}>
      <div className="hm-featnum">{num}</div>
      <div className="hm-feattop">
        <div className="mt-eyebrow">{label}</div>
        <FreshnessChip state="fresh" asOf="3 min" />
      </div>
      <div className="hm-feattitle">{title}</div>
      <p className="hm-featbody">{body}</p>
      <div className="hm-featstat">
        <span className="mt-tag mt-tag--accent">{stat}</span>
        <span className="hm-featgo">Open →</span>
      </div>
    </button>
  );
}

export default function HomePage({ setPage }) {
  const positioned = useMemo(() => positionIndicators(MT_INDICATORS), []);
  const [hoverInd, setHoverInd] = useState(null);
  const [selectedInd, setSelectedInd] = useState(null);

  const stressed = MT_INDICATORS.filter((i) => i.state === "extreme").length;
  const elevated = MT_INDICATORS.filter((i) => i.state === "elevated").length;
  const calm = MT_INDICATORS.filter((i) => i.state === "calm").length;

  return (
    <>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Today's tape · MacroTilt</div>
          <h1 className="mt-h1">
            Risk-on,<br />
            <i>inflationary</i> — with <span style={{ whiteSpace: "nowrap" }}>{stressed} of 27</span> flashing.
          </h1>
          <p className="mt-deck">
            Your portfolio beta is{" "}
            <Tip content="Beta vs S&P 500, weighted by position. Updated daily after close.">0.86</Tip>{" "}
            and the defensive sleeve is on{" "}
            <Tip content="Sleeve composition: 12% gold, 9% TLT, 4% cash. Would activate if MOVE crosses Watch (116).">standby</Tip>.
            Eight names cleared a 5-point score this morning.{" "}
            <a onClick={(e) => { e.preventDefault(); setPage("methodology"); }} href="#">Read the methodology →</a>
          </p>
        </div>
        <div className="hm-statgrid">
          <div className="hm-stat">
            <div className="mt-eyebrow">Stress signal</div>
            <div className="hm-statval num">
              <AnimatedNumber value={78.4} format={(v) => v.toFixed(1)} />
            </div>
            <div className="hm-statsub">MOVE · 23ʳᵈ pctile · Watch 116</div>
          </div>
          <div className="hm-stat">
            <div className="mt-eyebrow">Yield regime</div>
            <div className="hm-statval num">
              +49<span>bp</span>
            </div>
            <div className="hm-statsub">3M Δ 10y · 80ᵗʰ pctile · inflationary</div>
          </div>
          <div className="hm-stat">
            <div className="mt-eyebrow">Indicators</div>
            <div className="hm-statval num">
              {stressed + elevated}
              <span>/27</span>
            </div>
            <div className="hm-statsub">
              <span style={{ color: "var(--mt-down)" }}>{stressed} extreme</span> ·{" "}
              <span style={{ color: "var(--mt-warn)" }}>{elevated} elevated</span> ·{" "}
              <span style={{ color: "var(--mt-up)" }}>{calm} calm</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="hm-todaygrid">
          <div className="lm-canvas hm-mapcard">
            <div className="hm-mapcardhead">
              <div>
                <div className="mt-eyebrow">Macro position</div>
                <div className="mt-h2">Where the 27 indicators sit today.</div>
                <div className="hm-mapcardsub">Hover any dot to read · click to drill into history</div>
              </div>
              <button className="mt-btn" onClick={() => setPage("macro")}>Open Macro →</button>
            </div>
            <RegimeCanvas
              data={positioned}
              onHover={setHoverInd}
              hover={hoverInd}
              onSelect={setSelectedInd}
              selected={selectedInd}
              aspect={1.55}
            />
            <div className="lm-canvaslegend">
              <div className="lm-legrow">
                <span className="lm-legdot lm-legdot--extreme" /> extreme
                <span className="lm-legdot lm-legdot--elevated" /> elevated
                <span className="lm-legdot lm-legdot--calm" /> calm
              </div>
              <div className="lm-legrow lm-legrow--dim">
                {MT_INDICATORS.length} indicators · 5y normalized
              </div>
            </div>
          </div>

          <aside className="hm-tiltcard">
            <div className="hm-tiltcardhead">
              <div>
                <div className="mt-eyebrow">Engine call · today</div>
                <div className="hm-tiltcall">
                  Risk On · <i>Inflationary</i>
                </div>
                <div className="hm-tiltsubcall">
                  100% equity · 0% defensive ·{" "}
                  <FreshnessChip state="fresh" asOf="May 21" variant="label" />
                </div>
              </div>
              <button className="mt-btn" onClick={() => setPage("tilt")}>Open Tilt →</button>
            </div>

            <div className="hm-allocgroup">
              <div className="hm-eyebrowrow">
                <span className="mt-eyebrow">Recommended allocation</span>
                <span className="hm-allocfoot num">= 100%</span>
              </div>
              {(() => {
                const enriched = MT_SECTORS.map((s) => ({
                  ...s,
                  alloc: Math.max(0, s.weight + s.tilt),
                })).sort((a, b) => b.alloc - a.alloc);
                const maxAlloc = enriched[0].alloc;
                return enriched.map((s) => (
                  <button key={s.code} className="hm-allocrow" onClick={() => setPage("tilt")}>
                    <span className="hm-allocname">
                      <span className="lm-flowcode">{s.code}</span>
                      <span className="hm-allocnamelbl">{s.name}</span>
                    </span>
                    <span className="hm-allocbar">
                      <span
                        style={{
                          width: `${(s.alloc / maxAlloc) * 100}%`,
                          background: "var(--mt-accent)",
                        }}
                      />
                    </span>
                    <span className="num hm-allocpct">
                      {s.alloc.toFixed(1)}<i>%</i>
                    </span>
                  </button>
                ));
              })()}
            </div>
          </aside>
        </div>
        {selectedInd && (
          <IndicatorDetail
            ind={selectedInd}
            onClose={() => setSelectedInd(null)}
            onMethodology={() => setPage("methodology")}
          />
        )}
      </section>

      <section className="mt-pagesection">
        <div className="hm-featgrid hm-featgrid--three">
          <FeatureCard
            num="01"
            label="Trading scanner"
            title="Five signals into one score"
            body="Insider activity, dark-pool prints, options flow, congressional trades and technicals. Cleared liquidity gate · 13 long alerts today."
            stat="13 long alerts"
            page="scanner"
            setPage={setPage}
          />
          <FeatureCard
            num="02"
            label="Portfolio insights"
            title="Your book, augmented"
            body="Six accounts, fourteen positions — every line scored, tilts compared to engine, freshness on every value. Upload Chase/Fidelity CSVs."
            stat="$516K · +79.4% TTM"
            page="portfolio"
            setPage={setPage}
          />
          <FeatureCard
            num="03"
            label="Scenario analysis"
            title="Stress-test the playbook"
            body="Eight canned historical shocks (Black Monday, GFC, Covid…) plus custom multi-factor scenarios. See how each strategy and your portfolio would respond."
            stat="8 scenarios · 4 factors"
            page="scenarios"
            setPage={setPage}
          />
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Market news · Macro</div>
            <div className="mt-h2">What moved the tape this morning.</div>
          </div>
          <div className="mt-pillgroup">
            <button className="mt-pill on">All</button>
            <button className="mt-pill">Macro</button>
            <button className="mt-pill">Equities</button>
            <button className="mt-pill">Crypto</button>
          </div>
        </div>
        <ul className="hm-newslist">
          {MT_NEWS.map(([time, head, src]) => (
            <li key={head} className="hm-newsrow">
              <span className="hm-newstime num">{time}</span>
              <span className="hm-newshead">{head}</span>
              <span className="hm-newssrc">{src}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <button className="mt-btn mt-btn--ghost">Show more headlines →</button>
        </div>
      </section>
    </>
  );
}
