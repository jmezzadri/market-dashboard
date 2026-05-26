import React, { useState } from "react";
import { FreshnessChip } from "../atoms";
import { MT_SCENARIOS, MT_SECTORS, MT_POSITIONS } from "../data/mock";

function scenarioBlurb(id) {
  return ({
    blackmonday: "The 1987 crash. S&P fell 22.6% in a single day on October 19. Bond vol spiked, yields collapsed, dollar weakened.",
    dotcomup: "March 2000: peak of the Nasdaq bubble. Eight-week window before the rollover.",
    dotcomdown: "October 2002: capitulation low after 32-month grind. Tech multiples re-rated by 60%+.",
    gfc: "September–November 2008. Lehman, Iceland, AIG. MOVE > 250. Credit spreads to 1,800bp.",
    ratehike: "Q4 2018: Powell pivot. SPX drew down 19.8% on rate-cycle fears.",
    covid: "March 2020. Liquidity flush, VIX > 80, MOVE > 160, oil briefly negative.",
    inflation: "2022: 4×75bp Fed hikes. Bonds and stocks both selling off, real yields up 250bp.",
    ai: "Late 2024 AI cohort correction · 18% NASDAQ drawdown.",
  })[id] || "—";
}
function scenarioDD(id) {
  return ({ blackmonday: "−22.6%", dotcomup: "+8.4%", dotcomdown: "−14.1%", gfc: "−37.4%", ratehike: "−19.8%", covid: "−33.9%", inflation: "−24.1%", ai: "−18.2%" })[id] || "—";
}
function scenarioCall(id) {
  return ({ blackmonday: "Risk Off · Deflationary", dotcomup: "Risk On · Inflationary", dotcomdown: "Risk Off · Neutral", gfc: "Risk Off · Deflationary", ratehike: "Watch · Neutral", covid: "Risk Off · Deflationary", inflation: "Watch · Inflationary", ai: "Watch · Neutral" })[id] || "—";
}

export default function ScenariosPage({ setPage }) {
  const [active, setActive] = useState("gfc");
  const [horizon, setHorizon] = useState("3M");
  const [custom, setCustom] = useState({ move: 0.6, dxy: -0.04, ust10: 0.4, oil: 0.3 });

  const scen = MT_SCENARIOS.find((s) => s.id === active);

  return (
    <>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Scenario analysis</div>
          <h1 className="mt-h1">
            See how your portfolio and MacroTilt's engines react under <i>stress</i>.
          </h1>
          <p className="mt-deck">
            Run a <b>canned historical shock</b> or compose a <b>custom multi-factor</b> scenario.
            Bond vol, dollar, 10y yield, oil — pull the levers, watch the engine respond.
          </p>
        </div>
        <div className="sn-picker">
          <div className="mt-eyebrow">Scenario selection</div>
          <div className="sn-scengrid">
            {MT_SCENARIOS.map((s) => (
              <button
                key={s.id}
                className={`sn-scenpill ${active === s.id ? "on" : ""}`}
                onClick={() => setActive(s.id)}
              >
                {s.name}
              </button>
            ))}
            <button
              className="sn-scenpill sn-scenpill--custom"
              onClick={() => setActive("custom")}
            >
              Custom multi-factor shock
            </button>
          </div>
        </div>
      </section>

      {active === "custom" && (
        <section className="mt-pagesection">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">Build a shock</div>
              <div className="mt-h2">Pull a factor — the engine recomputes live.</div>
            </div>
            <div className="mt-pillgroup">
              <button className={`mt-pill ${horizon === "1M" ? "on" : ""}`} onClick={() => setHorizon("1M")}>1M</button>
              <button className={`mt-pill ${horizon === "3M" ? "on" : ""}`} onClick={() => setHorizon("3M")}>3M</button>
              <button className={`mt-pill ${horizon === "6M" ? "on" : ""}`} onClick={() => setHorizon("6M")}>6M</button>
            </div>
          </div>
          <div className="sn-customcard mt-card">
            {[
              ["move", "MOVE · bond vol", "1.0 = today · 2.0 = double", -1, 2.5, 0.05],
              ["ust10", "10y treasury yield Δ", "Percentage-point shift", -2, 3, 0.05],
              ["dxy", "USD index Δ", "% shift", -0.2, 0.2, 0.005],
              ["oil", "Brent crude Δ", "% shift", -0.5, 1, 0.01],
            ].map(([k, label, sub, mn, mx, step]) => (
              <div key={k} className="sn-slidercell">
                <div>
                  <div className="mt-eyebrow">{label}</div>
                  <div className="sn-slidersub">{sub}</div>
                </div>
                <input
                  type="range"
                  min={mn}
                  max={mx}
                  step={step}
                  value={custom[k]}
                  onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })}
                  className="sn-slider"
                />
                <div className="sn-sliderval num">
                  {custom[k] > 0 ? "+" : ""}{(custom[k] * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {active !== "custom" && scen && (
        <section className="mt-pagesection">
          <div className="sn-headercard mt-card">
            <div className="sn-headertop">
              <div>
                <div className="mt-eyebrow">Active scenario</div>
                <div className="sn-headertitle">{scen.name}</div>
                <div className="sn-headersub">{scenarioBlurb(scen.id)}</div>
              </div>
              <div className="sn-headstats">
                <div><div className="mt-eyebrow">Peak drawdown</div><b className="num down sn-headstat">{scenarioDD(scen.id)}</b></div>
                <div><div className="mt-eyebrow">Engine call</div><b className="sn-headstat">{scenarioCall(scen.id)}</b></div>
                <div>
                  <div className="mt-eyebrow">Horizon</div>
                  <div className="mt-pillgroup" style={{ marginTop: 2 }}>
                    <button className={`mt-pill ${horizon === "1M" ? "on" : ""}`} onClick={() => setHorizon("1M")}>1M</button>
                    <button className={`mt-pill ${horizon === "3M" ? "on" : ""}`} onClick={() => setHorizon("3M")}>3M</button>
                    <button className={`mt-pill ${horizon === "6M" ? "on" : ""}`} onClick={() => setHorizon("6M")}>6M</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Strategy allocations</div>
            <div className="mt-h2">How each strategy positions going in.</div>
          </div>
          <FreshnessChip state="fresh" asOf="this window" variant="label" />
        </div>
        <div className="mt-card">
          <table className="sn-strategytable num">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Strategy</th>
                <th>Equity</th><th>Cash</th><th>Gold</th><th>TLT</th>
                <th>Return</th><th>Max DD</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ textAlign: "left" }}>S&amp;P 500</td><td>100%</td><td>—</td><td>—</td><td>—</td><td className="down">−21.4%</td><td className="down">−34.2%</td></tr>
              <tr><td style={{ textAlign: "left" }}>S&amp;P 500 / Cash 60/40</td><td>60%</td><td>40%</td><td>—</td><td>—</td><td className="down">−12.7%</td><td className="down">−20.1%</td></tr>
              <tr style={{ background: "var(--mt-accent-soft)" }}>
                <td style={{ textAlign: "left" }}>
                  <b>Your portfolio</b>{" "}
                  <span className="mt-tag mt-tag--accent" style={{ marginLeft: 8 }}>YOU</span>
                </td>
                <td>83.7%</td><td>15.8%</td><td>0.4%</td><td>—</td>
                <td className="down">−18.2%</td><td className="down">−28.4%</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left" }}>
                  <span style={{ color: "var(--mt-accent)" }}>Asset Tilt</span>{" "}
                  <span className="mt-tag mt-tag--accent" style={{ marginLeft: 8 }}>MACROTILT</span>
                </td>
                <td>40%</td><td>—</td><td>30%</td><td>30%</td>
                <td className="up">+4.6%</td><td className="down">−8.2%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="sn-splitcard">
          <article className="mt-card">
            <div className="mt-eyebrow">Asset Tilt engine response</div>
            <div className="mt-h2" style={{ marginBottom: 12 }}>How sectors and industry groups would move.</div>
            <ul className="sn-engineimpact">
              {MT_SECTORS.slice(0, 8).map((s, idx) => {
                const proxy = Math.round(s.tilt * 4 + ((idx * 5) % 7) - 3);
                const stress = -Math.abs(proxy) - ((idx * 3) % 10);
                return (
                  <li key={s.code}>
                    <span className="lm-flowcode">{s.code}</span>
                    <span className="sn-secname">{s.name}</span>
                    <span className={`num ${proxy >= 0 ? "up" : "down"} sn-proxy`}>
                      {proxy > 0 ? "+" : ""}{proxy}%
                    </span>
                    <span className="sn-arrow">→</span>
                    <span className={`num ${stress >= 0 ? "up" : "down"} sn-stress`}>{stress}%</span>
                  </li>
                );
              })}
            </ul>
          </article>
          <article className="mt-card">
            <div className="mt-eyebrow">Your portfolio impact</div>
            <div className="mt-h2" style={{ marginBottom: 12 }}>Position-level P&amp;L · {horizon} window.</div>
            <table className="sn-poslosses num">
              <thead>
                <tr><th style={{ textAlign: "left" }}>Ticker</th><th>Sector</th><th>Curr.</th><th>Stress</th><th>P/L</th></tr>
              </thead>
              <tbody>
                {MT_POSITIONS.slice(0, 6).map((p, idx) => {
                  const loss = -Math.abs(p.value * 0.2 + ((idx * 17) % 100) * (p.value * 0.001));
                  return (
                    <tr key={p.ticker}>
                      <td style={{ textAlign: "left" }}><b>{p.ticker}</b></td>
                      <td style={{ textAlign: "left", color: "var(--mt-ink-2)", fontSize: 11.5 }}>{p.sector}</td>
                      <td>${(p.value / 1000).toFixed(1)}K</td>
                      <td className="down">${((p.value + loss) / 1000).toFixed(1)}K</td>
                      <td className="down">${(loss / 1000).toFixed(1)}K</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--mt-line-1)" }}>
                  <td style={{ textAlign: "left", paddingTop: 12 }} colSpan={2}><b>Total impact</b></td>
                  <td colSpan={2} style={{ paddingTop: 12 }}>$516K</td>
                  <td className="down" style={{ paddingTop: 12, fontWeight: 700 }}>$−93.9K</td>
                </tr>
              </tfoot>
            </table>
          </article>
        </div>
      </section>
    </>
  );
}
