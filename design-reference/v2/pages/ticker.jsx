/* Page · Ticker Detail
   Full single-stock view. Triggered from anywhere ticker symbols appear —
   scanner row, portfolio row, IG list. The "open detail" target.         */

const PageTicker = ({ symbol, onClose, openTicker }) => {
  const [tf, setTf] = useState("6M");
  const [tab, setTab] = useState("score");
  const row = MT_SCANNER.find(r => r.ticker === symbol) || MT_POSITIONS.find(p => p.ticker === symbol);
  const mock = useMemo(() => row || {
    ticker: symbol, name: symbol, sector: "Equity",
    score: 6.2, price: 100, chg: +0.2, vol: "1.0M", insider: ["B"], dark: null, range: 0.5,
  }, [symbol]);

  const tfMap = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "5Y": 1260, "Max": 5000 };
  const series = useMemo(() => gen(tfMap[tf], mock.price * 0.85, mock.price * 0.25, mock.chg >= 0 ? 0.3 : -0.2).concat([mock.price]), [tf, mock.price, mock.chg]);
  const items = useMemo(() => breakdownForTicker(mock), [mock.ticker, mock.score]);
  const total = items.reduce((s, x) => s + x.contribution, 0);

  return (
    <div className="mt-pagebody tk-page">
      <section className="mt-pagehero tk-hero">
        <div>
          <div className="tk-back">
            <button className="mt-btn mt-btn--ghost" onClick={onClose}>← Back to scanner</button>
            <FreshnessChip state="fresh" asOf="3 min" variant="label" />
          </div>
          <div className="tk-symwrap">
            <h1 className="tk-symbol">{mock.ticker}</h1>
            <div>
              <div className="tk-name">{mock.name}</div>
              <div className="tk-meta">
                <span>{mock.sector || mock.account}</span>
                <span className="lm-flowfootsep" />
                <span>NYSE</span>
                <span className="lm-flowfootsep" />
                <span>Mkt cap <b className="num">$4.1B</b></span>
                <span className="lm-flowfootsep" />
                <span>Vol <b className="num">{mock.vol || "1.0M"}</b></span>
              </div>
            </div>
          </div>
          <div className="tk-priceblock">
            <div className="tk-price num">${mock.price.toFixed(2)}</div>
            <div className={`tk-priceΔ num ${mock.chg >= 0 ? "up" : "down"}`}>
              {mock.chg >= 0 ? "▲" : "▼"} ${Math.abs(mock.price * mock.chg / 100).toFixed(2)}{" "}
              ({mock.chg > 0 ? "+" : ""}{mock.chg.toFixed(2)}%)
            </div>
            <div className="tk-pricemeta num">last · 4:00pm ET · prev close ${(mock.price - mock.price * mock.chg/100).toFixed(2)}</div>
          </div>
        </div>
        <div className="tk-scoreblock">
          <div className="mt-eyebrow">MacroTilt Score</div>
          <div className="tk-bigdial">
            <ScoreDial score={mock.score} size={96} />
          </div>
          <span className="lm-sigpill" style={{ alignSelf: "center" }}>BUY · LONG</span>
          <div style={{ fontSize: 11.5, color: "var(--mt-ink-2)", textAlign: "center", marginTop: 6 }}>
            Score climbed <b className="num up">+0.4</b> over 14 days
          </div>
        </div>
      </section>

      {/* Price chart */}
      <section className="mt-pagesection">
        <article className="mt-card">
          <div className="mt-sectionhead" style={{ marginBottom: 16 }}>
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">${mock.price.toFixed(2)} <span style={{ color: "var(--mt-ink-2)", fontSize: 14, fontFamily: "var(--mt-font-ui)" }}>· {tf} window</span></div>
            </div>
            <div className="mt-pillgroup">
              {Object.keys(tfMap).map(k => (
                <button key={k} className={`mt-pill ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>{k}</button>
              ))}
            </div>
          </div>
          <BigHistoryChart data={series} accent={mock.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"} height={320} />
          <div className="tk-overlay">
            <Tip content="50-day SMA — toggle line"><button className="mt-btn">+ 50d SMA</button></Tip>
            <Tip content="200-day SMA — toggle line"><button className="mt-btn">+ 200d SMA</button></Tip>
            <Tip content="Toggle volume bars"><button className="mt-btn">+ Volume</button></Tip>
            <Tip content="Drop event markers (insider buys, congress, dark pool prints)"><button className="mt-btn">+ Events</button></Tip>
            <Tip content="Overlay another ticker for comparison"><button className="mt-btn">+ Compare ticker</button></Tip>
          </div>
        </article>
      </section>

      {/* Key stats */}
      <section className="mt-pagesection">
        <div className="tk-keygrid">
          {[
            ["Open",      `$${(mock.price - 0.12).toFixed(2)}`],
            ["High",      `$${(mock.price + 0.18).toFixed(2)}`],
            ["Low",       `$${(mock.price - 0.21).toFixed(2)}`],
            ["52w high",  `$${(mock.price * 1.18).toFixed(2)}`],
            ["52w low",   `$${(mock.price * 0.62).toFixed(2)}`],
            ["Avg vol",   mock.vol || "1.2M"],
            ["P/E",       "—"],
            ["Div yield", "—"],
            ["Beta",      "1.42"],
            ["EPS (TTM)", "$0.32"],
            ["Float",     "92M"],
            ["Inst hold", "64%"],
          ].map(([k, v]) => (
            <div key={k} className="tk-kvcell">
              <div className="mt-eyebrow">{k}</div>
              <b className="num">{v}</b>
            </div>
          ))}
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-pagesection">
        <div className="mt-pillgroup tk-tabs">
          {[
            ["score",   "Score breakdown"],
            ["insider", "Insider · 7"],
            ["options", "Options flow"],
            ["dark",    "Dark pool"],
            ["news",    "News · 12"],
            ["fund",    "Fundamentals"],
          ].map(([id, l]) => (
            <button key={id} className={`mt-pill ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>

        {tab === "score" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow">Composition of <b className="num">{total.toFixed(2)}</b><span className="lm-iddleg-dim" style={{ marginLeft: 6 }}>/10</span></div>
            <table className="lm-scoremath" style={{ marginTop: 14 }}>
              <thead>
                <tr><th>Component</th><th className="num">Weight</th><th className="num">Score</th><th className="num">Contribution</th></tr>
              </thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.key}>
                    <td>
                      <div className="lm-scoreklabel">{c.key}</div>
                      <div className="lm-scorekwhy">{c.why}</div>
                    </td>
                    <td className="num">{(c.weight * 100).toFixed(0)}<span className="lm-scoredim">%</span></td>
                    <td className="num lm-scorebarcell">
                      <span className="lm-scoreval">{c.score5.toFixed(1)}<i>/5</i></span>
                      <span className="lm-scorebar"><b style={{ width: `${(c.score5/5)*100}%` }} /></span>
                    </td>
                    <td className="num lm-scorecontr"><b>{c.contribution.toFixed(2)}</b></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}><b>MacroTilt Score</b></td><td className="num lm-scorecontr"><b>{total.toFixed(1)}<i>/10</i></b></td></tr>
              </tfoot>
            </table>
          </article>
        )}

        {tab === "insider" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow" style={{ marginBottom: 10 }}>Recent insider activity · 90d</div>
            <table className="tk-evttable">
              <thead><tr><th>Date</th><th>Insider</th><th>Role</th><th>Action</th><th className="num">Shares</th><th className="num">Value</th></tr></thead>
              <tbody>
                {[
                  ["2026-05-22", "P. Kim",     "CEO",   "buy",  4200,  23184],
                  ["2026-05-19", "S. Patel",   "CFO",   "buy",  1500,   8265],
                  ["2026-05-11", "J. Chen",    "Dir.",  "buy",   900,   4923],
                  ["2026-05-02", "P. Kim",     "CEO",   "buy",  3000,  16290],
                  ["2026-04-18", "L. Romero",  "VP",    "sell", -1200, -6480],
                ].map(([date, name, role, act, sh, v]) => (
                  <tr key={date}>
                    <td className="num">{date}</td>
                    <td>{name}</td>
                    <td>{role}</td>
                    <td><span className={`mt-tag mt-tag--${act === "buy" ? "calm" : "extreme"}`}>{act.toUpperCase()}</span></td>
                    <td className={`num ${sh >= 0 ? "up" : "down"}`}>{sh > 0 ? "+" : ""}{sh.toLocaleString()}</td>
                    <td className={`num ${v >= 0 ? "up" : "down"}`}>${Math.abs(v).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}

        {tab === "options" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow">Options activity · 30d</div>
            <div className="tk-keygrid" style={{ marginTop: 10 }}>
              {[
                ["Call vol",   "12,420"],
                ["Put vol",    "5,180"],
                ["C/P ratio",  "2.40"],
                ["IV rank",    "31"],
                ["IV (30d)",   "42.6%"],
                ["Skew",       "+1.4σ"],
              ].map(([k, v]) => (
                <div key={k} className="tk-kvcell">
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num">{v}</b>
                </div>
              ))}
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>Notable sweeps</div>
            <table className="tk-evttable">
              <thead><tr><th>Date</th><th>Strike</th><th>Expiry</th><th>Type</th><th className="num">Size</th><th className="num">Premium</th></tr></thead>
              <tbody>
                <tr><td className="num">2026-05-21</td><td className="num">$6.00</td><td className="num">Jun 20</td><td><span className="mt-tag mt-tag--calm">CALL sweep</span></td><td className="num">3,200</td><td className="num">$58K</td></tr>
                <tr><td className="num">2026-05-15</td><td className="num">$7.00</td><td className="num">Jul 18</td><td><span className="mt-tag mt-tag--calm">CALL sweep</span></td><td className="num">1,800</td><td className="num">$22K</td></tr>
              </tbody>
            </table>
          </article>
        )}

        {tab === "dark" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow">Dark-pool prints · 30d</div>
            <p style={{ fontSize: 13, color: "var(--mt-ink-1)", lineHeight: 1.55, margin: "8px 0 14px", maxWidth: 640 }}>
              No off-exchange anchor prints detected at material size. Engine treats this as <b>neutral</b> rather than negative.
            </p>
            <FreshnessChip state="fresh" asOf="3 min" variant="label" />
          </article>
        )}

        {tab === "news" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Recent headlines · 12</div>
            <ul className="hm-newslist" style={{ marginTop: 0 }}>
              {[
                ["08:35", `${mock.ticker} declares quarterly dividend, beats consensus`, "ZACKS"],
                ["07:12", `BMO upgrades ${mock.ticker} to Outperform, raises PT to $7.50`, "BLOOMBERG"],
                ["06:50", `Insider buying continues at ${mock.ticker} as CEO adds 4,200 shares`, "MARKETBEAT"],
                ["yesterday", `${mock.ticker} announces strategic partnership with regional carrier`, "PR NEWSWIRE"],
              ].map(([t, h, s]) => (
                <li key={h} className="hm-newsrow">
                  <span className="hm-newstime num">{t}</span>
                  <span className="hm-newshead">{h}</span>
                  <span className="hm-newssrc">{s}</span>
                </li>
              ))}
            </ul>
          </article>
        )}

        {tab === "fund" && (
          <article className="mt-card mt-fade">
            <div className="mt-eyebrow">Fundamentals · TTM</div>
            <div className="tk-keygrid" style={{ marginTop: 10 }}>
              {[
                ["Revenue",   "$248M"], ["YoY growth", "+18.4%"], ["Gross margin","68.2%"], ["Op margin","12.4%"],
                ["EBITDA",    "$42M"],  ["FCF",        "$28M"],   ["Net income", "$14M"],   ["Debt/Eq",  "0.42"],
              ].map(([k, v]) => (
                <div key={k} className="tk-kvcell">
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num">{v}</b>
                </div>
              ))}
            </div>
          </article>
        )}
      </section>

      {/* Related */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Related names · same sector</div>
            <div className="mt-h2">Other names the scanner liked in {mock.sector || "this group"}</div>
          </div>
        </div>
        <div className="tk-relatedgrid">
          {MT_SCANNER.filter(r => r.ticker !== mock.ticker).slice(0, 4).map(r => (
            <button key={r.ticker} className="tk-relcard" onClick={() => openTicker?.(r.ticker)}>
              <div className="tk-relhead">
                <span className="lm-tkmain">{r.ticker}</span>
                <ScoreDial score={r.score} size={36} />
              </div>
              <div className="tk-relsub">{r.name}</div>
              <div className="tk-relstats num">
                <span>${r.price.toFixed(2)}</span>
                <span className={r.chg >= 0 ? "up" : "down"}>{r.chg > 0 ? "+" : ""}{r.chg.toFixed(2)}%</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

window.PageTicker = PageTicker;
