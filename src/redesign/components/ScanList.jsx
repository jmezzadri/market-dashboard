/**
 * ScanList + ScanDrill — scanner table with score-math reconciliation drill.
 */
import React, { useMemo } from "react";
import { Sparkline, Tip } from "../atoms";
import ScoreDial from "./ScoreDial";
import { breakdownForTicker } from "../data/score";
import { gen } from "../data/mock";

export default function ScanList({ rows, drillOpen, setDrillOpen, onOpenTicker, onAct }) {
  return (
    <ul className="lm-scanlist">
      {rows.map((row) => (
        <li key={row.ticker} className={`lm-scancard ${drillOpen === row.ticker ? "open" : ""}`}>
          <button className="lm-scanrow" onClick={() => setDrillOpen(drillOpen === row.ticker ? null : row.ticker)}>
            <div className="lm-tk">
              <span
                className="lm-tkmain lm-tkmain--link"
                onClick={(e) => { e.stopPropagation(); onOpenTicker?.(row.ticker); }}
              >
                {row.ticker}
              </span>
              <div className="lm-tksub">{row.name} · {row.sector}</div>
            </div>
            <div className="lm-tkscore"><ScoreDial score={row.score} /></div>
            <div>
              <div className="lm-tkpx num">${row.price.toFixed(2)}</div>
              <div className={`lm-tkchg num ${row.chg >= 0 ? "up" : "down"}`}>
                {row.chg > 0 ? "+" : ""}{row.chg.toFixed(2)}%
              </div>
            </div>
            <Sparkline
              data={gen(30, row.price, row.price * 0.07, 0, `scan-${row.ticker}`)}
              width={100}
              height={32}
              stroke={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
              fill={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
              area
            />
            <div className="lm-tkfacets">
              <Tip content={`Insider buys/sells (60d): ${row.insider.join(", ")}`}>
                <span className="lm-facet">⌂ {row.insider.length}</span>
              </Tip>
              <Tip content={row.dark ? `Dark pool block at $${row.dark}` : "No recent dark-pool prints"}>
                <span className="lm-facet">◐ {row.dark ? "✓" : "—"}</span>
              </Tip>
              <Tip content="Options flow: bullish skew, calls > puts">
                <span className="lm-facet">∿ ↑</span>
              </Tip>
            </div>
            <div className="lm-tkchev">{drillOpen === row.ticker ? "▾" : "▸"}</div>
          </button>
          {drillOpen === row.ticker && <ScanDrill row={row} onOpenTicker={onOpenTicker} onAct={onAct} />}
        </li>
      ))}
    </ul>
  );
}

function ScanDrill({ row, onOpenTicker, onAct }) {
  const items = useMemo(() => breakdownForTicker(row), [row.ticker, row.score]);
  const total = items.reduce((s, x) => s + x.contribution, 0);

  const events = [
    { idx: 86, badge: "A", label: "CEO buy · $128K", when: "4d ago" },
    { idx: 83, badge: "B", label: "CFO buy · $86K", when: "7d ago" },
    { idx: 79, badge: "C", label: "Block 142K @ $5.40", when: "11d ago" },
    { idx: 76, badge: "N", label: "BMO → Outperform", when: "14d ago" },
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
            <tr>
              <th>Component</th>
              <th className="num">Weight</th>
              <th className="num">Score</th>
              <th className="num">Contribution</th>
            </tr>
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
                  <span className="lm-scorebar"><b style={{ width: `${(c.score5 / 5) * 100}%` }} /></span>
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
        <EventChart
          data={gen(90, row.price, row.price * 0.1, 0, `evt-${row.ticker}`)}
          accent={row.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
          events={events}
        />
        <div className="lm-drilltimeline">
          {events.map((e) => (
            <div key={e.label} className="lm-evtrow">
              <span className="lm-evtbadge">{e.badge}</span>
              <span className="lm-evtlbl">{e.label}</span>
              <span className="lm-evtwhen num">{e.when}</span>
            </div>
          ))}
        </div>
        <div className="lm-drillctas">
          <button className="mt-btn mt-btn--primary" onClick={() => onOpenTicker?.(row.ticker)}>
            Open ticker detail →
          </button>
          <button className="mt-btn" onClick={() => onAct?.("watchlist", row.ticker)}>+ Watchlist</button>
          <button className="mt-btn" onClick={() => onAct?.("copy", row.ticker)}>Copy ticker</button>
        </div>
      </div>
    </div>
  );
}

function EventChart({ data, accent, events }) {
  const W = 480, H = 130, P = 10;
  const min = Math.min(...data), max = Math.max(...data);
  const r = max - min || 1;
  const stepX = (W - P * 2) / (data.length - 1);
  const pts = data.map((d, i) => [P + i * stepX, H - P - ((d - min) / r) * (H - P * 2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${dPath} L${pts[pts.length - 1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`;
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
      {events.map((e) => {
        const p = pts[Math.min(pts.length - 1, e.idx)];
        if (!p) return null;
        return (
          <g key={e.badge} transform={`translate(${p[0]} ${p[1]})`}>
            <line x1="0" y1="0" x2="0" y2="-22" stroke={accent} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
            <circle cy="-26" r="8" fill="var(--mt-surface)" stroke={accent} strokeWidth="1.5" />
            <text textAnchor="middle" y="-23" fontSize="9.5" fontWeight="700" fontFamily="var(--mt-font-mono)" fill={accent}>{e.badge}</text>
            <circle r="3.5" fill={accent} stroke="var(--mt-surface)" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
}
