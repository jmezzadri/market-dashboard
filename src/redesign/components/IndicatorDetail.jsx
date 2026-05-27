/**
 * IndicatorDetail — inline drill panel below the regime map when an
 * indicator dot is clicked. TF pills, chart, percentile distribution,
 * stats, related indicators, methodology + compare CTAs.
 */
import React, { useMemo, useState } from "react";
import { AnimatedNumber, FreshnessChip } from "../atoms";
import BigHistoryChart from "./BigHistoryChart";
import PercentileBar from "./PercentileBar";
import { MT_INDICATORS, gen } from "../data/mock";

const TF_MAP = { "1Y": 52, "5Y": 240, "10Y": 480, Max: 800 };

const DESCRIPTIONS = {
  "Term premium": "Investor compensation for holding duration. Derived from the Kim-Wright decomposition of the 10-year yield.",
  "10y real yield": "10-year Treasury yield minus 10-year breakeven inflation — the 'real cost of money' for duration assets.",
  CAPE: "Shiller cyclically-adjusted P/E. Equity valuation, smoothed across 10 years of inflation-adjusted earnings.",
  "MOVE · bond volatility": "Bond-market volatility index. The 'VIX of rates' — a stress signal for duration.",
  "Yield curve (10y−2y)": "10-year Treasury minus 2-year. Inversions historically precede recessions by 6–18 months.",
  "10y breakeven": "Implied long-term inflation expectation: 10-year nominal yield minus 10-year TIPS.",
  "HY−IG spread": "High-yield minus investment-grade credit spread. Widens when credit stress is brewing.",
  VIX: "S&P 500 30-day implied volatility — the classic equity fear gauge.",
  "SKEW Index": "Tail-risk skew in S&P 500 options. High readings flag investors paying up for left-tail protection.",
  "Bank reserves": "Reserves held by depository institutions at the Fed. Liquidity proxy for the banking system.",
  "Initial claims": "Weekly unemployment claims. Leading labor-market indicator.",
  "JOLTS quits": "Voluntary separations as % of employment. High when workers feel confident.",
  "Core CPI yoy": "Inflation ex-food & energy. The Fed's preferred read on sticky price pressure.",
};

function describe(ind) {
  return DESCRIPTIONS[ind.name] || `Read this indicator with the Tilt engine's regime: today's signal is ${ind.state}, sitting in the ${ind.pct}th percentile of the last 5 years.`;
}

export default function IndicatorDetail({ ind, onClose, onMethodology }) {
  const [tf, setTf] = useState("5Y");
  const [compare, setCompare] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const series = useMemo(
    () => gen(TF_MAP[tf], ind.value * 0.9, ind.value * 0.4, ind.dir === "up" ? 0.3 : -0.1, `${ind.id}-${tf}`).concat([ind.value]),
    [tf, ind.id, ind.value, ind.dir]
  );
  const compareSeries = useMemo(
    () =>
      compare
        ? gen(TF_MAP[tf], compare.value * 0.9, compare.value * 0.4, compare.dir === "up" ? 0.3 : -0.1, `${compare.id}-${tf}`).concat([compare.value])
        : null,
    [tf, compare]
  );

  const accent = ind.state === "extreme" ? "var(--mt-down)" : ind.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)";
  const cmpAccent = compare
    ? compare.state === "extreme"
      ? "var(--mt-down)"
      : compare.state === "elevated"
      ? "var(--mt-warn)"
      : "var(--mt-up)"
    : null;

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
            <p className="lm-iddprose">{describe(ind)}</p>
          </div>
          <div className="lm-iddctrls">
            <div className="mt-pillgroup">
              {Object.keys(TF_MAP).map((k) => (
                <button key={k} className={`mt-pill ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>
                  {k}
                </button>
              ))}
            </div>
            <button className="lm-iddclose" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>
        <div className="lm-iddbody">
          <div>
            <BigHistoryChart data={series} accent={accent} compareData={compareSeries} compareAccent={cmpAccent} />
            <div className="lm-iddlegend">
              <span>
                <AnimatedNumber value={ind.value} format={(v) => v.toFixed(v > 100 ? 0 : 2)} suffix={ind.unit} />
              </span>
              <span className={`num ${ind.dir === "up" ? "up" : "down"}`}>
                {ind.dir === "up" ? "▲" : "▼"} {Math.abs(ind.delta).toFixed(2)}{ind.unit} · w/w
              </span>
              <span className="lm-flowfootsep" />
              <span className="lm-iddleg-dim">5Y range</span>
              <span className="num">
                {(ind.value * 0.7).toFixed(2)}–{(ind.value * 1.15).toFixed(2)}{ind.unit}
              </span>
              {compare && (
                <>
                  <span className="lm-flowfootsep" />
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: cmpAccent }}>
                    <span style={{ width: 16, height: 2, background: cmpAccent, display: "inline-block" }} />
                    {compare.name}
                    <button
                      onClick={() => setCompare(null)}
                      style={{ border: "none", background: "transparent", color: cmpAccent, cursor: "pointer", padding: 0, fontSize: 14 }}
                    >
                      ✕
                    </button>
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
              {MT_INDICATORS.filter((x) => x.domain === ind.domain && x.id !== ind.id).slice(0, 4).map((r) => (
                <li key={r.id}>
                  <span>{r.name}</span>
                  <span className="num" style={{ color: "var(--mt-ink-1)" }}>
                    {r.value.toFixed(r.value > 100 ? 0 : 2)}{r.unit}
                  </span>
                  <span className={`num lm-iddrel-pct lm-iddrel-pct--${r.state}`}>{r.pct}ᵗʰ</span>
                </li>
              ))}
            </ul>
            <div className="lm-iddactions">
              <button className="mt-btn mt-btn--primary" onClick={() => onMethodology?.(ind.id)}>
                Read methodology →
              </button>
              <button className="mt-btn" onClick={() => setPickerOpen(!pickerOpen)}>
                {compare ? `Comparing · ${compare.name}` : "+ Compare"}
              </button>
            </div>
            {pickerOpen && (
              <div className="lm-iddpicker mt-fade">
                <div className="mt-eyebrow" style={{ marginBottom: 6 }}>Pick a second indicator to overlay</div>
                <ul className="lm-iddpickerlist">
                  {MT_INDICATORS.filter((x) => x.id !== ind.id).slice(0, 10).map((x) => (
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
    </section>
  );
}
