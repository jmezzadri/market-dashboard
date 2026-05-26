/**
 * SectorFlow — sector → industry-group → ticker 3-level drill.
 */
import React from "react";
import { Sparkline, FreshnessChip } from "../atoms";
import ScoreDial from "./ScoreDial";
import { gen } from "../data/mock";

export default function SectorFlow({
  sectors,
  igData,
  expandedSectors,
  expandedIGs,
  toggleSector,
  toggleIG,
  openTicker,
}) {
  return (
    <div className="lm-flow">
      {sectors.map((s) => {
        const isExpanded = expandedSectors.has(s.code);
        const igs = igData[s.code] || [];
        return (
          <div key={s.code} className={`lm-flowcard ${isExpanded ? "open" : ""}`}>
            <SectorRow s={s} isExpanded={isExpanded} onToggle={() => toggleSector(s.code)} />
            {isExpanded && (
              <SectorDrillBody s={s} igs={igs} expandedIGs={expandedIGs} toggleIG={toggleIG} openTicker={openTicker} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectorRow({ s, isExpanded, onToggle }) {
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
        <span
          className={`lm-flowbar lm-flowbar--${isOver ? "over" : "under"}`}
          style={{ width: `${w}px`, left: isOver ? "50%" : `calc(50% - ${w}px)` }}
        >
          <span className="lm-flowstripe" />
        </span>
      </div>
      <div className={`lm-flowval num ${isOver ? "up" : "down"}`}>
        {isOver ? "+" : ""}{s.tilt.toFixed(1)}%
      </div>
      <div className="lm-flowweight num">
        {s.weight.toFixed(1)}<i>%</i>
      </div>
    </button>
  );
}

function SectorDrillBody({ s, igs, expandedIGs, toggleIG, openTicker }) {
  return (
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
        <Sparkline
          data={gen(60, 50, 30, 0, `sector-${s.code}`)}
          width={260}
          height={56}
          stroke={s.tilt >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
          fill={s.tilt >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
          area
        />
      </div>
      <div className="lm-igtable">
        <div className="lm-igheader">
          <span>Industry group</span>
          <span>Tilt</span>
          <span className="lm-igheader-bar">vs. cap weight</span>
          <span className="num">Weight</span>
          <span className="num">Score</span>
          <span />
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
                  <span
                    className={`lm-flowbar lm-flowbar--${isOver ? "over" : "under"}`}
                    style={{ width: `${wIG}px`, left: isOver ? "50%" : `calc(50% - ${wIG}px)` }}
                  />
                </span>
                <span className="num lm-igw">{ig.weight.toFixed(1)}<i>%</i></span>
                <span className="num lm-igscore">{ig.score.toFixed(1)}<i>/5</i></span>
                <span className="lm-igchev">{igOpen ? "▾" : "▸"}</span>
              </button>
              {igOpen && (
                <div className="lm-igdrill mt-fade">
                  <div className="lm-igdrillcol">
                    <div className="mt-eyebrow">90-day relative · vs S&amp;P 500</div>
                    <Sparkline
                      data={gen(90, 100, 14, isOver ? 1 : -1, `ig-${ig.name}`)}
                      width={400}
                      height={84}
                      stroke={isOver ? "var(--mt-up)" : "var(--mt-down)"}
                      fill={isOver ? "var(--mt-up)" : "var(--mt-down)"}
                      area
                    />
                    <div className="lm-igreason">
                      <div className="mt-eyebrow">Why the tilt</div>
                      <p>
                        Engine is overweighting <b>{ig.name}</b> on stronger {isOver ? "breadth + earnings revisions" : "credit-spread divergence"} ·
                        contribution to portfolio active weight:{" "}
                        <b className={`num ${isOver ? "up" : "down"}`}>
                          {isOver ? "+" : ""}{(ig.tilt * 0.6).toFixed(2)}%
                        </b>.
                      </p>
                    </div>
                  </div>
                  <div className="lm-igdrillcol">
                    <div className="mt-eyebrow">Top names · MacroTilt score</div>
                    <ul className="lm-iglist">
                      {ig.top.slice(0, 5).map((tk, i) => (
                        <li key={tk}>
                          <span
                            className="lm-igtk lm-tkmain--link"
                            onClick={(e) => { e.stopPropagation(); openTicker?.(tk); }}
                          >
                            {tk}
                          </span>
                          <span className="lm-igdial">
                            <ScoreDial score={Math.max(2, 4.6 - i * 0.4)} max={5} size={36} />
                          </span>
                          <span className={`lm-iggrowth num ${i % 3 ? "up" : "down"}`}>
                            {i % 3 ? "+" : "−"}{(2.4 - i * 0.5).toFixed(1)}%
                          </span>
                          <span>
                            <Sparkline
                              data={gen(20, 100, 12, 0.4 - i * 0.1, `tk-${tk}`)}
                              width={70}
                              height={18}
                              stroke={i % 3 ? "var(--mt-up)" : "var(--mt-down)"}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button className="lm-igseeall">See all {ig.top.length * 6} names in scanner →</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
