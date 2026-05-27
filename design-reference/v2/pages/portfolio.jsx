/* Page · Portfolio Insights
   Six accounts, fourteen positions, allocation by asset class + sector,
   every position scored by the MacroTilt engine. Accounts are clickable —
   click drills into account detail with positions, allocation, performance.*/

const PagePortfolio = ({ setPage, openTicker }) => {
  const [drillRow, setDrillRow] = useState("NVDA");
  const [tab, setTab] = useState("byaccount");
  const [acctOpen, setAcctOpen] = useState(null); // account name when drilled

  const total = MT_PORTFOLIO_ACCOUNTS.reduce((s, a) => s + a.balance, 0);
  const sectorAlloc = useMemo(() => {
    const out = {};
    for (const p of MT_POSITIONS) out[p.sector] = (out[p.sector] || 0) + p.value;
    return Object.entries(out)
      .map(([name, v]) => ({ name, value: v, pct: v / total * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [total]);

  /* Cost basis math — used by both positions list and account drill */
  const pnl = (p) => {
    const totalCost = p.cost * p.shares;
    const pl = p.value - totalCost;
    const plPct = (pl / totalCost) * 100;
    return { totalCost, pl, plPct };
  };

  const account = acctOpen ? MT_PORTFOLIO_ACCOUNTS.find(a => a.name === acctOpen) : null;
  const acctPositions = acctOpen ? MT_POSITIONS.filter(p => p.account === acctOpen) : [];

  return (
    <div className="mt-pagebody">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Portfolio insights <FreshnessChip state="fresh" asOf="3 min" /></div>
          <h1 className="mt-h1">
            Your portfolio and watchlist — <i>augmented</i> with MacroTilt's signal intelligence.
          </h1>
          <p className="mt-deck">
            Time-weighted performance and position-level alerts. The same scoring you see on Trading Scanner
            applied to every position you hold across six accounts.
          </p>
        </div>
        <div className="pf-keystats">
          <div className="mt-eyebrow">Key stats vs. S&amp;P 500</div>
          <div className="pf-keygrid">
            <div><div className="mt-eyebrow">Total wealth</div><b className="pf-keynum num">$516<i>K</i></b><span className="num pf-keysub">6 accounts</span></div>
            <div><div className="mt-eyebrow">TTM performance</div><b className="pf-keynum num up">+79.4<i>%</i></b><span className="num pf-keysub">S&amp;P +34.1%</span></div>
            <div><div className="mt-eyebrow">Beta</div><b className="pf-keynum num">0.86</b><span className="num pf-keysub">S&amp;P 1.00</span></div>
            <div><div className="mt-eyebrow">Sharpe</div><b className="pf-keynum num">0.29</b><span className="num pf-keysub">S&amp;P 1.52</span></div>
          </div>
        </div>
      </section>

      {/* Accounts grid */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">By account</div>
            <div className="mt-h2">Six accounts · trailing 12 months · click to drill</div>
          </div>
          <button className="mt-btn">Upload transactions</button>
        </div>
        <div className="pf-acctgrid">
          {MT_PORTFOLIO_ACCOUNTS.map(a => (
            <button key={a.name}
              className={`mt-card pf-acctcard ${acctOpen === a.name ? "on" : ""}`}
              onClick={() => setAcctOpen(acctOpen === a.name ? null : a.name)}>
              <div className="pf-accthead">
                <span className="pf-acctname"><span className="pf-acctdot" style={{ background: a.color }} />{a.name}</span>
                <span className="num pf-acctshare">{a.share.toFixed(1)}<i>% of book</i></span>
              </div>
              <div className="pf-acctbal num">${(a.balance/1000).toFixed(0)}K</div>
              <Sparkline data={gen(60, 100, 8, a.ttm/40)} width={260} height={28}
                         stroke={a.ttm >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
                         fill={a.ttm >= 0 ? "var(--mt-up)" : "var(--mt-down)"} area showDot={false} />
              <div className="pf-acctkv">
                <div><div className="mt-eyebrow">TTM</div><b className={`num ${a.ttm >= 0 ? "up" : "down"}`}>{a.ttm > 0 ? "+" : ""}{a.ttm.toFixed(2)}%</b></div>
                <div><div className="mt-eyebrow">Sharpe</div><b className="num">{a.sharpe > 0 ? "+" : ""}{a.sharpe.toFixed(2)}</b></div>
                <div><div className="mt-eyebrow">Positions</div><b className="num">{a.positions}</b></div>
              </div>
              <div className="pf-acctfoot">
                <span>{acctOpen === a.name ? "▾ Hide" : "▸ Open"}</span>
              </div>
            </button>
          ))}
        </div>

        {account && (
          <article className="mt-card pf-acctdrill mt-fade">
            <div className="pf-acctdrillhead">
              <div>
                <div className="mt-eyebrow"><span className="pf-acctdot" style={{ background: account.color, marginRight: 6 }} />{account.type.toUpperCase()}</div>
                <div className="mt-h2">{account.name}</div>
                <div style={{ fontSize: 13, color: "var(--mt-ink-2)", marginTop: 4 }}>
                  <b className="num" style={{ color: "var(--mt-ink-0)" }}>${(account.balance/1000).toFixed(0)}K</b>
                  {" "}· {account.positions} positions ·{" "}
                  <Tip content="Trailing 12 months, time-weighted, before tax."><span className={account.ttm >= 0 ? "up" : "down"}>{account.ttm > 0 ? "+" : ""}{account.ttm.toFixed(1)}% TTM</span></Tip>
                </div>
              </div>
              <button className="mt-btn" onClick={() => setAcctOpen(null)}>✕ Close</button>
            </div>

            <div className="pf-acctdrillgrid">
              <div className="pf-acctcol">
                <div className="mt-eyebrow">Performance · 12 months</div>
                <Sparkline data={gen(252, 100, 12, account.ttm/30)} width={520} height={140}
                           stroke={account.ttm >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
                           fill={account.ttm >= 0 ? "var(--mt-up)" : "var(--mt-down)"} area />
                <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "var(--mt-ink-2)" }}>
                  <span><b className="num" style={{ color: "var(--mt-ink-0)" }}>{account.sharpe.toFixed(2)}</b> sharpe</span>
                  <span><b className="num" style={{ color: "var(--mt-ink-0)" }}>0.92</b> beta</span>
                  <span><b className="num down">−18.4%</b> max DD</span>
                </div>
              </div>
              <div className="pf-acctcol">
                <div className="mt-eyebrow">Positions in this account</div>
                <table className="pf-mini">
                  <thead><tr><th>Ticker</th><th className="num">Score</th><th className="num">Value</th><th className="num">P/L</th></tr></thead>
                  <tbody>
                    {acctPositions.map(p => {
                      const { pl, plPct } = pnl(p);
                      return (
                        <tr key={p.ticker}>
                          <td><span className="lm-tkmain lm-tkmain--link"
                                onClick={() => openTicker?.(p.ticker)}
                                style={{ fontSize: 14 }}>{p.ticker}</span></td>
                          <td className="num"><b>{p.score.toFixed(1)}</b></td>
                          <td className="num">${(p.value/1000).toFixed(1)}K</td>
                          <td className={`num ${pl >= 0 ? "up" : "down"}`}>{pl > 0 ? "+" : ""}${(pl/1000).toFixed(1)}K · {plPct > 0 ? "+" : ""}{plPct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        )}
      </section>

      {/* Allocation */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Allocation</div>
            <div className="mt-h2">Where the money lives.</div>
          </div>
          <div className="mt-pillgroup">
            <button className={`mt-pill ${tab === "byaccount" ? "on" : ""}`} onClick={() => setTab("byaccount")}>By account</button>
            <button className={`mt-pill ${tab === "bysector" ? "on" : ""}`} onClick={() => setTab("bysector")}>By sector</button>
            <button className={`mt-pill ${tab === "byclass" ? "on" : ""}`} onClick={() => setTab("byclass")}>By asset class</button>
          </div>
        </div>
        <article className="mt-card">
          <div className="pf-allocrows">
            {(tab === "bysector" ? sectorAlloc : tab === "byclass" ? CLASS_ALLOC : MT_PORTFOLIO_ACCOUNTS.map(a => ({ name: a.name, value: a.balance, pct: a.share, color: a.color })))
              .map((r, i) => (
                <div key={r.name} className="pf-allocrow">
                  <span className="pf-alloccolor" style={{ background: r.color || PF_COLORS[i % PF_COLORS.length] }} />
                  <span className="pf-allocname">{r.name}</span>
                  <span className="pf-allocbar"><span style={{
                    width: `${Math.min(100, r.pct)}%`,
                    background: r.color || PF_COLORS[i % PF_COLORS.length],
                  }} /></span>
                  <span className="num pf-allocval">${(r.value / 1000).toFixed(0)}K</span>
                  <span className="num pf-allocpct">{r.pct.toFixed(1)}%</span>
                </div>
              ))}
          </div>
        </article>
      </section>

      {/* Positions with MT scoring + tilt-vs-engine alerts */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Positions · MacroTilt score</div>
            <div className="mt-h2">Engine signal on every position — with value, cost &amp; P&amp;L.</div>
          </div>
          <div className="mt-pillgroup">
            <button className="mt-pill on">All</button>
            <button className="mt-pill">Alerts <span className="sc-colcount num">3</span></button>
            <button className="mt-pill">Buys <span className="sc-colcount num">5</span></button>
            <button className="mt-pill">Trims <span className="sc-colcount num">2</span></button>
          </div>
        </div>
        <ul className="lm-scanlist">
          {MT_POSITIONS.map(p => {
            const { pl, plPct, totalCost } = pnl(p);
            return (
              <li key={p.ticker} className={`lm-scancard ${drillRow === p.ticker ? "open" : ""}`}>
                <button className="lm-scanrow pf-posrow" onClick={() => setDrillRow(drillRow === p.ticker ? null : p.ticker)}>
                  <div className="lm-tk">
                    <span className="lm-tkmain lm-tkmain--link"
                          onClick={(e) => { e.stopPropagation(); openTicker?.(p.ticker); }}>{p.ticker}</span>
                    <div className="lm-tksub">{p.account} · {p.sector}</div>
                  </div>
                  <div>
                    <span className={`lm-sigpill ${p.sig === "trim" ? "lm-sigpill--short" : ""}`} style={p.sig === "hold" ? { background: "var(--mt-surface-3)", color: "var(--mt-ink-1)" } : {}}>
                      {p.sig.toUpperCase()}
                    </span>
                  </div>
                  <div className="lm-tkscore"><ScoreDial score={p.score} /></div>
                  <div className="num pf-valblock">
                    <div className="lm-tkpx">${(p.value/1000).toFixed(1)}K</div>
                    <div style={{ fontSize: 11, color: "var(--mt-ink-2)" }}>{p.shares} sh @ ${p.price.toFixed(2)}</div>
                  </div>
                  <div className="num pf-plblock">
                    <div className={`pf-plval ${pl >= 0 ? "up" : "down"}`}>{pl > 0 ? "+" : ""}${(pl/1000).toFixed(1)}K</div>
                    <div className={`pf-plpct ${plPct >= 0 ? "up" : "down"}`}>{plPct > 0 ? "+" : ""}{plPct.toFixed(1)}%</div>
                  </div>
                  <div className={`lm-tkchg num ${p.chg >= 0 ? "up" : "down"}`} style={{ textAlign: "right" }}>
                    <div>${p.price.toFixed(2)}</div>
                    <div style={{ fontSize: 11 }}>{p.chg > 0 ? "+" : ""}{p.chg.toFixed(2)}%</div>
                  </div>
                  <Sparkline data={gen(30, p.price, p.price * 0.07)} width={80} height={28}
                             stroke={p.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"}
                             fill={p.chg >= 0 ? "var(--mt-up)" : "var(--mt-down)"} area />
                  <div className="lm-tkchev">{drillRow === p.ticker ? "▾" : "▸"}</div>
                </button>
                {drillRow === p.ticker && (
                  <div className="lm-drill mt-fade">
                    <div className="lm-drillcol">
                      <div className="mt-eyebrow">Signal vs. last review</div>
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                        Engine sees <b>{p.ticker}</b> as a <b>{p.sig === "trim" ? "trim" : p.sig === "buy" ? "buy" : "hold"}</b>{" "}
                        ({p.score.toFixed(1)}/10). {p.sig === "trim"
                          ? "Score has degraded over the last 14 days on insider distribution + technical weakness — engine recommends reducing exposure by 1/3."
                          : p.sig === "buy"
                          ? "Score has improved over the last 14 days on strong insider buying and options sweeps — engine flags as add candidate."
                          : "Score is range-bound; hold without action."}
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
                        <div><div className="mt-eyebrow">Cost basis</div><b className="num" style={{ fontFamily: "var(--mt-font-display)", fontSize: 17 }}>${(totalCost/1000).toFixed(1)}K</b></div>
                        <div><div className="mt-eyebrow">Mkt value</div><b className="num" style={{ fontFamily: "var(--mt-font-display)", fontSize: 17 }}>${(p.value/1000).toFixed(1)}K</b></div>
                        <div><div className="mt-eyebrow">Total P/L</div><b className={`num ${pl >= 0 ? "up" : "down"}`} style={{ fontFamily: "var(--mt-font-display)", fontSize: 17 }}>{pl > 0 ? "+" : ""}${(pl/1000).toFixed(1)}K</b></div>
                      </div>
                      <div className="lm-drillctas">
                        <button className="mt-btn mt-btn--primary" onClick={() => openTicker?.(p.ticker)}>Open ticker detail →</button>
                        <button className="mt-btn">Set alert</button>
                        <button className="mt-btn">Adjust position</button>
                      </div>
                    </div>
                    <div className="lm-drillcol">
                      <div className="mt-eyebrow">Score composition · {p.ticker}</div>
                      <div className="lm-drilllayers">
                        {[
                          ["Technicals", 0.6, 0.9],
                          ["Insider",    0.7, 0.95],
                          ["Options",    0.55, 0.85],
                          ["Analyst",    0.65, 0.78],
                        ].map(([k, v]) => (
                          <div key={k} className="lm-drilllayer">
                            <div className="lm-drilllayertop">
                              <span className="lm-drilllayerk">{k}</span>
                              <span className="num lm-drilllayerv">{(v * 5).toFixed(1)}<i>/5</i></span>
                            </div>
                            <div className="lm-drilllayerbar"><b style={{ width: `${v * 100}%` }} /></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

const PF_COLORS = ["#0a5cd1", "#1f9d60", "#c08428", "#c1394f", "#5c34c9", "#0a8a8a"];

const CLASS_ALLOC = [
  { name: "HY Bonds",         value: 349000, pct: 68, color: "#0a5cd1" },
  { name: "Cash",             value:  82000, pct: 16, color: "#7a8290" },
  { name: "Individual Stocks",value:  72000, pct: 14, color: "#3a3f47" },
  { name: "Index Funds",      value:   9000, pct:  2, color: "#0a8a8a" },
  { name: "Precious Metals",  value:   2000, pct:  0.4, color: "#c08428" },
  { name: "Crypto",           value:   2000, pct:  0.4, color: "#5c34c9" },
];

window.PagePortfolio = PagePortfolio;
