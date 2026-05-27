/* Page · Trading Scanner
   Filterable, sortable, reorderable table of equity opportunities.        */

const PageScanner = ({ setPage, openTicker }) => {
  const [bucket, setBucket] = useState("all");
  const [drillOpen, setDrillOpen] = useState("GRNT");
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);

  const rows = useMemo(() => MT_SCANNER.filter(r =>
    (bucket === "all"
      ? true
      : bucket === "7+" ? r.score >= 7
      : bucket === "5-6" ? r.score >= 5 && r.score < 7
      : r.score < 5)
  ), [bucket]);

  return (
    <div className="mt-pagebody">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Trading scanner</div>
          <h1 className="mt-h1">
            Cutting through the noise with <i>proprietary signal intelligence</i> to identify trading opportunities.
          </h1>
          <p className="mt-deck">
            Five signals — insider activity, dark-pool prints, options flow, congressional trades, technicals — rolled into one MacroTilt Score (0–10).
            Universe scanned <b className="num">12,206</b> · liquidity-cleared <b className="num">2,964</b> · long alerts today <b className="num">13</b>.
            <a onClick={(e) => { e.preventDefault(); setPage("methodology"); }} href="#"> See the scoring methodology →</a>
          </p>
        </div>
        <div className="sc-results">
          <div className="sc-results-head">
            <div className="mt-eyebrow">Today's scan</div>
            <FreshnessChip state="fresh" asOf="EOD May 22" variant="label" />
          </div>
          <div className="sc-buckets">
            <button className={`sc-bucket sc-bucket--score7 ${bucket === "7+" ? "on" : ""}`}
                    onClick={() => setBucket(bucket === "7+" ? "all" : "7+")}>
              <span className="num">{MT_SCANNER.filter(r => r.score >= 7).length}</span>
              <span>Score 7+</span>
            </button>
            <button className={`sc-bucket sc-bucket--score5 ${bucket === "5-6" ? "on" : ""}`}
                    onClick={() => setBucket(bucket === "5-6" ? "all" : "5-6")}>
              <span className="num">{MT_SCANNER.filter(r => r.score >= 5 && r.score < 7).length}</span>
              <span>Score 5–6</span>
            </button>
            <button className={`sc-bucket sc-bucket--score3 ${bucket === "3-4" ? "on" : ""}`}
                    onClick={() => setBucket(bucket === "3-4" ? "all" : "3-4")}>
              <span className="num">{MT_SCANNER.filter(r => r.score < 5).length}</span>
              <span>Score 3–4</span>
            </button>
          </div>
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <div className="sc-toolbar">
          <div className="mt-pillgroup">
            <button className={`mt-pill ${bucket === "all" ? "on" : ""}`} onClick={() => setBucket("all")}>All</button>
            <button className={`mt-pill ${bucket === "7+" ? "on" : ""}`} onClick={() => setBucket("7+")}>Score 7+</button>
            <button className={`mt-pill ${bucket === "5-6" ? "on" : ""}`} onClick={() => setBucket("5-6")}>Score 5–6</button>
            <button className={`mt-pill ${bucket === "3-4" ? "on" : ""}`} onClick={() => setBucket("3-4")}>Score 3–4</button>
          </div>
          <span className="sc-shortnote"><Tip content="Engine doesn't yet output short signals — long-only universe today.">Long signals only</Tip></span>
          <span style={{ flex: 1 }} />
          <button className="mt-btn"><span style={{ marginRight: 6 }}>＋</span>Filter</button>
          <button className="mt-btn" onClick={() => setShowCols(!showCols)}>
            ⚙ Columns <span className="sc-colcount num">11/14</span>
          </button>
        </div>
        {showCols && (
          <div className="sc-colpicker mt-fade">
            <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Show / hide / reorder columns</div>
            <div className="sc-colgrid">
              {[
                ["Last trade", true], ["Ticker", true, "locked"], ["Signal", true],
                ["Score", true, "locked"], ["Score 1w", true], ["Score 1m", true],
                ["Insider activity", true], ["Dark pool anchor", true], ["Options vol shock", false],
                ["Chart", true], ["Price", true], ["Change", true], ["Volume", true], ["52w range", true],
              ].map(([name, on, lock]) => (
                <label key={name} className={`sc-coltoggle ${on ? "on" : ""} ${lock ? "locked" : ""}`}>
                  <input type="checkbox" checked={on} readOnly />
                  <span className="sc-colgrip">⋮⋮</span>
                  <span>{name}</span>
                  {lock && <span className="sc-collock">🔒</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="sc-note">
          <span className="num"><b>Scoring updated 21 May 2026.</b></span>
          {" "}The dark-pool and options layers are now live, raising the score ceiling from 5 to 10.
          These two layers are not yet backtested — treat them as developing signals. Any Score 1W or Score 1M
          figure from before this date is marked <span style={{ color: "var(--mt-accent)" }}>*</span>.
        </div>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <ScanList rows={rows} drillOpen={drillOpen} setDrillOpen={setDrillOpen}
                  onOpenTicker={openTicker}
                  onAct={(action, tk) => {
                    if (action === "copy" && navigator?.clipboard) navigator.clipboard.writeText(tk);
                    setToast(action === "copy" ? `Copied ${tk}` : `Added ${tk} to watchlist`);
                    setTimeout(() => setToast(null), 1800);
                  }} />
        {toast && <div className="mt-toast mt-fade">{toast}</div>}
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 16 }}>
        <div className="mt-card">
          <div className="mt-sectionhead" style={{ marginBottom: 12 }}>
            <div>
              <div className="mt-eyebrow">How the score is built</div>
              <div className="mt-h2">Five inputs · one number per ticker.</div>
            </div>
            <button className="mt-btn mt-btn--ghost" onClick={() => setPage("methodology")}>Full methodology →</button>
          </div>
          <div className="sc-buildgrid">
            {[
              ["Technicals", "200d trend, RSI, MACD, ATR", 2],
              ["Insider activity", "C-suite buys/sells, 60d ratio", 2],
              ["Options flow", "Calls/puts, IV rank, sweeps", 2],
              ["Congressional trades", "Senate + House disclosures", 2],
              ["Dark-pool prints", "Block trades, VWAP anchor", 2],
            ].map(([k, why, weight]) => (
              <div key={k} className="sc-buildcell">
                <div className="mt-eyebrow">{k}</div>
                <div className="sc-buildwhy">{why}</div>
                <div className="sc-buildw">weight <b className="num">{weight}</b></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

window.PageScanner = PageScanner;
