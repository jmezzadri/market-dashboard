/* Page · Methodology — editorial, deep
   Long-form. Each section covers what the page does, the data behind it,
   the formula or rules, and the freshness contract. Anchored by id so
   the "Read methodology" buttons elsewhere deep-link.                    */

const PageMethodology = ({ setPage }) => (
  <div className="mt-pagebody me-body">
    <section className="mt-pagehero">
      <div>
        <div className="mt-eyebrow">Methodology</div>
        <h1 className="mt-h1">
          How MacroTilt <i>actually</i> works.
        </h1>
        <p className="mt-deck">
          Six sections. Plain English. Every page on the site links here for the underlying logic.
          The full formula sheet and data vendor table are at the bottom.
        </p>
      </div>
    </section>

    <section className="mt-pagesection">
      <nav className="me-toc">
        <div className="mt-eyebrow">Sections</div>
        <ol>
          {[
            ["macro",     "Macro overview"],
            ["tilt",      "Asset Tilt engine"],
            ["scanner",   "Trading scanner"],
            ["portfolio", "Portfolio insights"],
            ["scenarios", "Scenario analysis"],
            ["freshness", "Data freshness contract"],
            ["sources",   "Data sources & vendors"],
            ["change",    "Changelog"],
          ].map(([id, label], i) => (
            <li key={id}><a href={`#${id}`}><span className="num">{String(i+1).padStart(2,"0")}</span><span>{label}</span></a></li>
          ))}
        </ol>
      </nav>

      {/* 01 — Macro overview */}
      <article id="macro" className="me-section">
        <div className="me-num">01</div>
        <div>
          <div className="mt-eyebrow">Macro overview</div>
          <h2 className="me-h2">Five-domain backdrop · 27 indicators</h2>
          <p className="me-body-p">
            Every indicator on MacroTilt is classified into one of five domains: <b>Rates</b>, <b>Credit</b>,
            <b> Equities</b>, <b>Money &amp; Banking</b>, and the real <b>Economy</b>. Within a domain, each
            indicator has a <b>type</b> — Lead, Coincident, or Lag — based on its empirical timing vs.
            the business cycle.
          </p>
          <p className="me-body-p">
            <b>State</b> (Calm / Elevated / Extreme) is set by where today's reading sits in the 5-year
            percentile distribution of the same indicator. Cut-points are domain-specific; for most
            two-sided indicators we use <code>[10, 25, 75, 90]</code> percentiles. The map's spatial
            placement uses <i>state</i>, not raw percentile, so red dots always live in the stress quadrant
            regardless of whether the extreme is high or low.
          </p>
          <div className="me-formula">
            state(today) = bin(percentile<sub>5y</sub>(value), [10, 25, 75, 90])<br />
            stress_x  = state ∈ {`{extreme: +0.62, elevated: +0.18, calm: −0.55}`} + jitter<br />
            regime_y  = domain_anchor ∈ {`{Rates: +0.40, Equities: +0.10, Credit: −0.05, Money: −0.25, Economy: −0.42}`}
          </div>
          <div className="me-links">
            <button className="mt-btn" onClick={() => setPage("macro")}>Open Macro overview →</button>
          </div>
        </div>
      </article>

      {/* 02 — Asset Tilt */}
      <article id="tilt" className="me-section">
        <div className="me-num">02</div>
        <div>
          <div className="mt-eyebrow">Asset Tilt engine</div>
          <h2 className="me-h2">Two axes set the regime · equity % &amp; sector tilts</h2>
          <p className="me-body-p">
            Bond-market volatility (<b>MOVE</b>) sets the stress axis. The 3-month change in 10-year
            Treasury yield (<b>3M Δ 10y</b>) sets the yield-regime axis. Together they define a 3×3 grid
            (Risk On / Watch / Risk Off × Inflationary / Neutral / Deflationary). The cell determines
            equity %, the defensive sleeve composition, and the within-equity sector tilts.
          </p>
          <div className="me-formula">
            stress_signal = MOVE<br />
            stress_zone   = MOVE &lt; 116 → Risk On · 116 ≤ MOVE &lt; 124 → Watch · MOVE ≥ 124 → Risk Off<br />
            yield_regime  = 3M Δ 10y ≥ +32 bp → Inflationary · ≤ −11 bp → Deflationary · else Neutral<br />
            equity_pct    = lookup_grid(stress_zone, yield_regime)<br />
            sleeve_mix    = inflationary ? 12% Au / 9% TLT / 4% Cash : 4% Au / 16% TLT / 5% Cash (only when stress ≥ Watch)
          </div>
          <p className="me-body-p">
            Within the equity bucket, six factor reads drive sector and industry-group tilts:
            credit OAS, valuation z-score, breadth, growth, liquidity, and an earnings-revision z. Each
            sector's active weight is a weighted sum of those factors, clipped to [−4%, +6%] vs. its cap weight.
          </p>
          <p className="me-body-p">
            <b>Validated 1986 → 2026</b> over 2,056 weeks. <b>CAGR 11.93%</b> vs SPY 11.16%, Sharpe 0.61 vs 0.47,
            max drawdown −32.1% vs −54.6%. Rebalanced weekly; defensive sleeve fires only when stress crosses
            Watch.
          </p>
          <div className="me-links">
            <button className="mt-btn" onClick={() => setPage("tilt")}>Open Asset Tilt →</button>
          </div>
        </div>
      </article>

      {/* 03 — Scanner */}
      <article id="scanner" className="me-section">
        <div className="me-num">03</div>
        <div>
          <div className="mt-eyebrow">Trading scanner</div>
          <h2 className="me-h2">Five signals · one MacroTilt Score (0–10)</h2>
          <p className="me-body-p">
            Each ticker is scored on six components, each on a 0–5 scale. The headline score is the
            weighted sum, rescaled so the maximum theoretical score is 10. Weights are calibrated to
            historical alpha contribution.
          </p>
          <div className="me-formula">
            Technicals × 0.25 · Insider × 0.20 · Analyst × 0.20<br />
            Options vol × 0.15 · Congress × 0.10 · Dark pool × 0.10<br />
            MacroTilt Score = Σ (component_score / 5) × weight × 10
          </div>
          <p className="me-body-p">
            The dark-pool and options layers went live <b>21 May 2026</b>. They're not yet backtested —
            treat them as developing signals. Score 1W or 1M figures from before that date are marked with
            an asterisk and reflect the old 5-point ceiling.
          </p>
          <p className="me-body-p">
            <b>Universe scan</b> runs once per trading day at 15:30 ET. <b>Event firehoses</b> (insider Form 4,
            congressional disclosures, dark-pool prints, news) refresh 3× daily at 10:00, 13:00, and 15:45 ET.
            A buy alert is fired when score ≥ 6 and the ticker cleared the $1.5M average daily liquidity gate.
          </p>
          <div className="me-links">
            <button className="mt-btn" onClick={() => setPage("scanner")}>Open Trading scanner →</button>
          </div>
        </div>
      </article>

      {/* 04 — Portfolio */}
      <article id="portfolio" className="me-section">
        <div className="me-num">04</div>
        <div>
          <div className="mt-eyebrow">Portfolio insights</div>
          <h2 className="me-h2">Engine score on every position you hold</h2>
          <p className="me-body-p">
            Upload Chase, Fidelity, or Schwab CSVs — or wire a brokerage account via Plaid (coming soon).
            Positions are deduplicated by ticker per account and refreshed nightly.
          </p>
          <p className="me-body-p">
            For every position we compute: <b>cost basis</b> (FIFO), <b>market value</b>, <b>P/L</b> ($ and %),
            <b> beta</b> (60-month vs S&P 500), and the same <b>MacroTilt Score</b> the scanner produces.
            The score is computed even for tickers outside the scanner universe, using a degraded model
            (no dark-pool layer if the name doesn't clear liquidity).
          </p>
          <p className="me-body-p">
            <b>Tilt-vs-engine alerts</b> compare your active weights to the engine's recommended sector
            tilts. A position is flagged "TRIM" when your score &lt; 5 AND active weight &gt; engine target;
            "BUY" when score ≥ 7 AND active weight &lt; engine target.
          </p>
          <div className="me-links">
            <button className="mt-btn" onClick={() => setPage("portfolio")}>Open Portfolio →</button>
          </div>
        </div>
      </article>

      {/* 05 — Scenarios */}
      <article id="scenarios" className="me-section">
        <div className="me-num">05</div>
        <div>
          <div className="mt-eyebrow">Scenario analysis</div>
          <h2 className="me-h2">Eight historical · plus 4-factor custom shocks</h2>
          <p className="me-body-p">
            The eight canned scenarios are <b>Black Monday '87, Dot-Com lead-up '00, Dot-Com flush '02,
            GFC '08, Rate Hikes '18, Covid '20, Inflation '22, AI Correction '24</b>. Each is a fixed
            historical window with frozen factor moves replayed against today's portfolio.
          </p>
          <p className="me-body-p">
            <b>Custom shocks</b> let you set MOVE multiplier, 10y yield Δ, USD index Δ, and oil Δ. The engine
            recomputes equity %, sleeve mix, and sector tilts as if those values were today's reading, and
            applies the implied beta/sector/yield exposures to your portfolio for the chosen horizon (1M / 3M / 6M).
          </p>
          <div className="me-formula">
            shock = (MOVE × m, 10y + Δ_y, DXY × (1 + Δ_d), Oil × (1 + Δ_o))<br />
            portfolio_pnl(horizon) = Σ_pos β_pos × ΔSPX(shock) + ε_idiosyncratic
          </div>
          <div className="me-links">
            <button className="mt-btn" onClick={() => setPage("scenarios")}>Open Scenario analysis →</button>
          </div>
        </div>
      </article>

      {/* 06 — Freshness */}
      <article id="freshness" className="me-section">
        <div className="me-num">06</div>
        <div>
          <div className="mt-eyebrow">Data freshness contract</div>
          <h2 className="me-h2">Why every value has a chip</h2>
          <p className="me-body-p">
            Every value, chart, gauge and table on MacroTilt renders a <b>freshness chip</b> — green if the
            underlying data is within SLA, red if stale. Aggregates roll up automatically: a single stale
            dependency flips the parent chip red and the tooltip names the culprit. No surface ever renders
            a hard-coded freshness string.
          </p>
          <div className="me-formula">
            chip(element) = green if last_good_at(element) within SLA(element) ∧ all_deps_green<br />
            chip(element) = red   otherwise<br />
            tooltip(red)  = "Data is stale — last updated {`{ts}`} ({`{age}`} past due) · {`{root cause}`}"
          </div>
          <p className="me-body-p">
            SLAs and the manifest of every element are stored in <code>data_manifest.json</code>; live status
            is tracked in <code>pipeline_health</code>. The chip component reads both via{" "}
            <code>useFreshness(elementId)</code>.
          </p>
        </div>
      </article>

      {/* 07 — Sources */}
      <article id="sources" className="me-section">
        <div className="me-num">07</div>
        <div>
          <div className="mt-eyebrow">Data sources &amp; vendors</div>
          <h2 className="me-h2">Where every number comes from</h2>
          <table className="me-vendors">
            <thead>
              <tr><th>Source</th><th>What we ingest</th><th>Cadence</th><th>License</th></tr>
            </thead>
            <tbody>
              {[
                ["FRED",           "Macro indicators (CPI, JOLTS, claims, etc.)", "Daily",   "Public"],
                ["Polygon",        "EOD &amp; intraday equity prices",            "EOD · 16:30 ET", "Paid · API"],
                ["Unusual Whales", "Form 4 insider, congress, dark pool, news",   "3× daily",   "Paid · API"],
                ["Treasury Direct","TGA, reserves, yield curve",                  "Daily",      "Public"],
                ["NYSE Holiday",   "Trading calendar for SLA math",               "Annual",     "Public"],
                ["S&amp;P / MSCI", "Sector + industry-group classifications",     "Quarterly",  "Paid · feed"],
                ["Shiller dataset","CAPE history",                                "Monthly",    "Public"],
              ].map(row => (
                <tr key={row[0]}>{row.map((c, i) => <td key={i} dangerouslySetInnerHTML={{__html: c}} />)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {/* 08 — Changelog */}
      <article id="change" className="me-section">
        <div className="me-num">08</div>
        <div>
          <div className="mt-eyebrow">Changelog</div>
          <h2 className="me-h2">Recent model + data changes</h2>
          <ul className="me-changelog">
            <li><b className="num">2026-05-21</b> — Scanner score ceiling raised from 5 to 10; dark-pool and options layers live.</li>
            <li><b className="num">2026-05-12</b> — Freshness chip simplified to two states (green/red); aggregate rollup automatic.</li>
            <li><b className="num">2026-05-06</b> — Trading Opps page: single consolidated <code>DataFreshness</code> line.</li>
            <li><b className="num">2026-04-29</b> — V5 modal grid widened from 760px to 1200px (left content + signal rail).</li>
            <li><b className="num">2026-04-19</b> — Phase 1 design playbook v1.0 finalized (Fraunces, Inter, single accent).</li>
          </ul>
        </div>
      </article>
    </section>
  </div>
);

window.PageMethodology = PageMethodology;
