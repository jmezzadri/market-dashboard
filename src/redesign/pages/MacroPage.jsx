import React, { useEffect, useMemo, useState } from "react";
import { FreshnessChip } from "../atoms";
import RegimeCanvas from "../components/RegimeCanvas";
import IndicatorDetail from "../components/IndicatorDetail";
import IndicatorCard from "../components/IndicatorCard";
import { MT_INDICATORS } from "../data/mock";
import { positionIndicators } from "../data/score";

function domainTitle(d) {
  return ({
    Rates: "The cost and shape of money.",
    Credit: "Stress in lending markets.",
    Equities: "Valuation, volatility, breadth.",
    Money: "Reserves, liquidity and the dollar.",
    Economy: "Real growth and the labor market.",
  })[d];
}

export default function MacroPage({ setPage }) {
  // Persist view choice per spec
  const [view, setView] = useState(() => {
    try {
      return window.localStorage.getItem("mt.macro.view") || "map";
    } catch (e) {
      return "map";
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem("mt.macro.view", view); } catch (e) {}
  }, [view]);

  const [state, setState] = useState("all");
  const [domain, setDomain] = useState("All");
  const [selectedInd, setSelectedInd] = useState(MT_INDICATORS.find((i) => i.id === "tp"));
  const [hoverInd, setHoverInd] = useState(null);

  const filtered = useMemo(
    () =>
      MT_INDICATORS.filter(
        (i) =>
          (state === "all" || i.state === state) &&
          (domain === "All" || i.domain === domain)
      ),
    [state, domain]
  );

  const positioned = useMemo(() => positionIndicators(filtered), [filtered]);

  const counts = useMemo(
    () => ({
      all: MT_INDICATORS.length,
      extreme: MT_INDICATORS.filter((i) => i.state === "extreme").length,
      elevated: MT_INDICATORS.filter((i) => i.state === "elevated").length,
      calm: MT_INDICATORS.filter((i) => i.state === "calm").length,
    }),
    []
  );

  const byDomain = useMemo(() => {
    const out = {};
    for (const ind of MT_INDICATORS) {
      out[ind.domain] = out[ind.domain] || [];
      out[ind.domain].push(ind);
    }
    return out;
  }, []);

  return (
    <>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Macro overview · today's read</div>
          <h1 className="mt-h1">
            The five things you should know <i>about the tape</i> today.
          </h1>
          <p className="mt-deck">
            27 indicators across <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Money &amp; Banking</b>, and the real <b>Economy</b>.
            No regime call lives on this page — that's Asset Tilt. This is the indicator backdrop.{" "}
            <a onClick={(e) => { e.preventDefault(); setPage("methodology"); }} href="#">See methodology →</a>
          </p>
        </div>
        <div className="mc-onthispage">
          <div className="mt-eyebrow">On this page</div>
          <div className="mc-otpval num">27</div>
          <div className="mc-otpsub">indicators · five domains</div>
          <div className="mt-divider" />
          <div className="mc-otprow"><span>Vol triggers</span><b className="num">3</b></div>
          <div className="mc-otprow"><span>Cycle composite</span><b className="num">7</b></div>
          <div className="mc-otprow"><span>Reference</span><b className="num">25</b></div>
          <FreshnessChip state="fresh" asOf="last poll · < 6 min" variant="label" />
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="mc-domstrip">
          {Object.entries(byDomain).map(([dom, inds]) => {
            const ext = inds.filter((i) => i.state === "extreme").length;
            const elev = inds.filter((i) => i.state === "elevated").length;
            const isActive = domain === dom;
            return (
              <button
                key={dom}
                className={`mc-domcell ${isActive ? "on" : ""}`}
                onClick={() => setDomain(isActive ? "All" : dom)}
              >
                <div className="mc-domhead">
                  <div className="mc-domname">{dom}</div>
                  <FreshnessChip state={dom === "Credit" ? "stale" : "fresh"} asOf={dom === "Credit" ? "May 19" : "today"} />
                </div>
                <div className="mc-domnum num">
                  {ext}<span className="mc-domof">/{inds.length}</span>
                  <span className="mc-domlabel">extreme</span>
                </div>
                {elev > 0 && (
                  <div className="mc-domsub">+ <b>{elev}</b> elevated</div>
                )}
                <div className="mc-domsumbar">
                  {inds.map((i, idx) => (
                    <span key={idx} className={`mc-domsumdot mc-domsumdot--${i.state}`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 16, paddingBottom: 8 }}>
        <div className="mc-filterbar">
          <div className="mc-legend">
            <div className="mt-eyebrow">Filter</div>
            <div className="mt-pillgroup">
              {[["all", "All"], ["extreme", "Extreme"], ["elevated", "Elevated"], ["calm", "Calm"]].map(
                ([k, l]) => (
                  <button key={k} className={`mt-pill ${state === k ? "on" : ""}`} onClick={() => setState(k)}>
                    {l} <span className="mc-pillcount num">{counts[k]}</span>
                  </button>
                )
              )}
            </div>
          </div>
          <div className="mc-legend">
            <div className="mt-eyebrow">Domain</div>
            <div className="mt-pillgroup">
              {["All", "Rates", "Credit", "Equities", "Money", "Economy"].map((d) => (
                <button key={d} className={`mt-pill ${domain === d ? "on" : ""}`} onClick={() => setDomain(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="mc-legend" style={{ marginLeft: "auto" }}>
            <div className="mt-eyebrow">View</div>
            <div className="mt-pillgroup">
              <button className={`mt-pill ${view === "map" ? "on" : ""}`} onClick={() => setView("map")}>
                Map
              </button>
              <button className={`mt-pill ${view === "grid" ? "on" : ""}`} onClick={() => setView("grid")}>
                Grid
              </button>
            </div>
          </div>
        </div>
      </section>

      {view === "map" ? (
        <>
          <section className="mt-pagesection">
            <div className="lm-canvas">
              <RegimeCanvas
                data={positioned}
                onHover={setHoverInd}
                hover={hoverInd}
                onSelect={setSelectedInd}
                selected={selectedInd}
              />
              <div className="lm-canvaslegend">
                <div className="lm-legrow">
                  <span className="lm-legdot lm-legdot--extreme" /> extreme
                  <span className="lm-legdot lm-legdot--elevated" /> elevated
                  <span className="lm-legdot lm-legdot--calm" /> calm
                </div>
                <div className="lm-legrow lm-legrow--dim">
                  showing {filtered.length} of {MT_INDICATORS.length} · click any dot to drill
                </div>
              </div>
            </div>
          </section>
          {selectedInd && (
            <IndicatorDetail
              ind={selectedInd}
              onClose={() => setSelectedInd(null)}
              onMethodology={() => setPage("methodology")}
            />
          )}
        </>
      ) : (
        <>
          {Object.entries(byDomain)
            .filter(([dom]) => domain === "All" || domain === dom)
            .map(([dom, inds]) => {
              const visible = inds.filter((i) => state === "all" || i.state === state);
              if (!visible.length) return null;
              return (
                <section key={dom} className="mt-pagesection">
                  <div className="mt-sectionhead">
                    <div>
                      <div className="mt-eyebrow">{dom}</div>
                      <div className="mt-h2">{domainTitle(dom)}</div>
                    </div>
                    <div className="mc-domstate">
                      {visible.filter((i) => i.state === "extreme").length > 0 && (
                        <span className="mt-tag mt-tag--extreme">
                          {visible.filter((i) => i.state === "extreme").length} extreme
                        </span>
                      )}
                      {visible.filter((i) => i.state === "elevated").length > 0 && (
                        <span className="mt-tag mt-tag--elev">
                          {visible.filter((i) => i.state === "elevated").length} elevated
                        </span>
                      )}
                      {visible.filter((i) => i.state === "calm").length > 0 && (
                        <span className="mt-tag mt-tag--calm">
                          {visible.filter((i) => i.state === "calm").length} calm
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mc-grid">
                    {visible.map((ind) => (
                      <IndicatorCard key={ind.id} ind={ind} onClick={() => setSelectedInd(ind)} />
                    ))}
                  </div>
                </section>
              );
            })}
          {selectedInd && (
            <IndicatorDetail
              ind={selectedInd}
              onClose={() => setSelectedInd(null)}
              onMethodology={() => setPage("methodology")}
            />
          )}
        </>
      )}
    </>
  );
}
