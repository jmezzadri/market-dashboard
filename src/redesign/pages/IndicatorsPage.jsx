import React, { useMemo, useState } from "react";
import { FreshnessChip, Sparkline } from "../atoms";
import IndicatorDetail from "../components/IndicatorDetail";
import { MT_INDICATORS } from "../data/mock";

export default function IndicatorsPage({ setPage }) {
  const [layer, setLayer] = useState("All");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("current");
  const [drill, setDrill] = useState(null);

  const filtered = useMemo(
    () =>
      MT_INDICATORS.filter(
        (i) =>
          (cat === "All" || i.domain === cat) &&
          (layer === "All" ||
            (layer === "Vol triggers" &&
              ["MOVE · bond volatility", "VIX", "SKEW Index"].includes(i.name)) ||
            (layer === "Cycle composite" && i.state === "extreme") ||
            (layer === "Reference" && i.state !== "extreme"))
      ),
    [layer, cat]
  );

  return (
    <>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">All indicators</div>
          <h1 className="mt-h1">
            Every indicator tracked on <i>MacroTilt.com</i> — what it is, why it matters, how it's used.
          </h1>
          <p className="mt-deck">
            Sourced live from our data registry. Leading, lagging and coincidental indicators across rates, credit, equities,
            money &amp; banking, and the real economy.
          </p>
        </div>
        <div className="al-summary">
          <FreshnessChip
            state="fresh"
            asOf="last poll < 6 min"
            variant="pill"
            label={`${MT_INDICATORS.length} indicators`}
          />
          <div className="al-summarygrid">
            <div><div className="mt-eyebrow">Vol triggers</div><b className="num al-sumnum">3</b></div>
            <div><div className="mt-eyebrow">Cycle composite</div><b className="num al-sumnum">7</b></div>
            <div><div className="mt-eyebrow">Reference</div><b className="num al-sumnum">{MT_INDICATORS.length - 10}</b></div>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 16, paddingBottom: 12 }}>
        <div className="al-toolbar mt-card">
          <div className="al-row">
            <div className="mt-eyebrow">Layer</div>
            <div className="mt-pillgroup">
              {["All", "Vol triggers", "Cycle composite", "Reference"].map((l) => (
                <button key={l} className={`mt-pill ${layer === l ? "on" : ""}`} onClick={() => setLayer(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="al-row">
            <div className="mt-eyebrow">Category</div>
            <div className="mt-pillgroup">
              {["All", "Equities", "Credit", "Rates", "Money", "Economy"].map((c) => (
                <button key={c} className={`mt-pill ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="al-row" style={{ marginLeft: "auto" }}>
            <button className="mt-btn">＋ Filter</button>
            <button className="mt-btn">
              ⚙ Columns <span className="sc-colcount num">11/14</span>
            </button>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <div className="mt-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="al-table">
            <thead>
              <tr>
                <th>Indicator</th><th>Category</th><th>Freq</th><th>Type</th>
                <th>Last refresh</th>
                <th className="num" onClick={() => setSort("current")}>
                  Current {sort === "current" ? "↓" : ""}
                </th>
                <th className="num">3M ago</th>
                <th className="num">6M ago</th>
                <th className="num">12M ago</th>
                <th>5y</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const isOpen = drill === i.id;
                return (
                  <React.Fragment key={i.id}>
                    <tr
                      className={`al-row-tr ${isOpen ? "open" : ""}`}
                      onClick={() => setDrill(isOpen ? null : i.id)}
                    >
                      <td>
                        <div className="al-tk">
                          <div className="al-tkname">{i.name}</div>
                          <div className="al-tkcode">{i.id}</div>
                        </div>
                      </td>
                      <td><span className="al-cat">{i.domain.toUpperCase()}</span></td>
                      <td><span className="al-freq num">{["D", "W", "M"][i.id.length % 3]}</span></td>
                      <td>
                        <span className={`al-type al-type--${i.state}`}>
                          {i.state === "extreme" ? "LEAD" : i.state === "elevated" ? "COINC" : "LAG"}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <FreshnessChip state={i.fresh} asOf={i.asOf} />
                          <span className="num" style={{ color: "var(--mt-ink-1)", fontSize: 12 }}>
                            {i.asOf}
                          </span>
                        </span>
                      </td>
                      <td className={`num al-current al-current--${i.state}`}>
                        {i.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        <span className="al-unit">{i.unit}</span>
                      </td>
                      <td className="num al-historical">
                        {(i.value * 0.92).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="num al-historical">
                        {(i.value * 0.88).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="num al-historical">
                        {(i.value * 0.84).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <Sparkline
                          data={i.trend}
                          width={120}
                          height={22}
                          stroke={
                            i.state === "extreme"
                              ? "var(--mt-down)"
                              : i.state === "elevated"
                              ? "var(--mt-warn)"
                              : "var(--mt-up)"
                          }
                        />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="al-drill">
                        <td colSpan={10}>
                          <IndicatorDetail
                            ind={i}
                            onClose={() => setDrill(null)}
                            onMethodology={() => setPage("methodology")}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="al-tablefoot">
          Showing <b className="num">{filtered.length}</b> of <b className="num">{MT_INDICATORS.length}</b> indicators
          · <FreshnessChip state="fresh" asOf="live · < 6 min" variant="label" />
        </div>
      </section>
    </>
  );
}
