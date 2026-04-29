// MethodologyV11 — v11 Cycle Mechanism Board methodology (Sprint 1).
//
// Renders the v11 methodology narrative top-to-bottom. Reads
// public/methodology_calibration_v11.json for live data points (today's
// readings, percentiles, sample windows). Content authored in
// methodology-v11.md and mirrored here as JSX.
//
// Per LESSONS rule #31: this is a single coherent rewrite. The legacy v9
// MethodologyPage will be retired in a follow-up PR; until then it
// continues serving the parts of the site that haven't migrated yet.

import React, { useEffect, useState } from "react";

const STATE_COLORS = {
  Normal: "#4a7c4a",
  Cautionary: "#b8860b",
  Stressed: "#a04518",
  Distressed: "#7a1414",
};

const TOC = [
  ["why", "Why this document was rewritten"],
  ["framework", "The framework in one paragraph"],
  ["lexicon", "The four-state lexicon"],
  ["headline", "The headline gauge"],
  ["mechanisms", "The six cycle mechanisms"],
  ["forward", "The Forward Warning tile"],
  ["recovery", "Recovery Watch"],
  ["watchlist", "Watch List — what we won't claim"],
  ["data", "Data sources, sample windows, and caveats"],
  ["changelog", "What changed from v10 to v11"],
];

function H1({ children }) {
  return <h1 style={{
    fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
    fontSize: 38,
    fontWeight: 300,
    letterSpacing: "-0.018em",
    margin: "0 0 14px",
  }}>{children}</h1>;
}

function H2({ id, children }) {
  return <h2 id={id} style={{
    fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
    fontSize: 24,
    fontWeight: 400,
    letterSpacing: "-0.008em",
    marginTop: 44,
    marginBottom: 12,
    paddingTop: 26,
    borderTop: "0.5px solid var(--border, #e0ddd5)",
    scrollMarginTop: 80,
  }}>{children}</h2>;
}

function H3({ children }) {
  return <h3 style={{
    fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
    fontSize: 18,
    fontWeight: 400,
    margin: "26px 0 8px",
  }}>{children}</h3>;
}

function P({ children }) {
  return <p style={{
    fontSize: 14,
    lineHeight: 1.65,
    color: "var(--text-2, #3a3a32)",
    margin: "0 0 14px",
  }}>{children}</p>;
}

function Table({ headers, rows }) {
  return (
    <div style={{ overflowX: "auto", margin: "10px 0 18px" }}>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                textAlign: "left",
                padding: "8px 12px 8px 0",
                borderBottom: "0.5px solid var(--text, #1a1a1a)",
                fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
                fontWeight: 400,
                fontSize: 12,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--text-muted, #7a7a72)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{
                  padding: "8px 12px 8px 0",
                  borderBottom: "0.5px dashed var(--border, #e0ddd5)",
                  verticalAlign: "top",
                  color: "var(--text-2, #3a3a32)",
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Accept-and-ignore legacy props from v9 App.jsx call site:
//   <MethodologyPage ind={...} asOf={...} weights={...} cats={...} indFreq={...} />
// The v11 framework reads all live data from public/methodology_calibration_v11.json.
export default function MethodologyPage(_props) {
  const [calib, setCalib] = useState(null);

  useEffect(() => {
    fetch(`/methodology_calibration_v11.json?v=${Date.now()}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setCalib)
      .catch(() => setCalib(null));
  }, []);

  const tiles = (calib?.tiles || []).filter((t) => t.live);
  const valuation = tiles.find((t) => t.id === "valuation");
  const credit = tiles.find((t) => t.id === "credit");
  const growth = tiles.find((t) => t.id === "growth");
  const gauge = calib?.headline_gauge || {};

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 28px) 64px" }}>

      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted, #7a7a72)",
          fontWeight: 600,
          marginBottom: 8,
        }}>
          MacroTilt Methodology
        </div>
        <H1>v11 — Cycle Mechanism Board</H1>
        <div style={{ fontSize: 13, color: "var(--text-muted, #7a7a72)" }}>
          As of {calib?.as_of || "—"} · Framework version {calib?.version || "v11.0.0"} · Sprint {calib?.sprint || 1}
        </div>
      </div>

      {/* Table of contents */}
      <nav style={{ margin: "32px 0", padding: "20px 22px", background: "var(--bg, #fafaf7)", border: "0.5px solid var(--border)", borderRadius: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted, #7a7a72)", marginBottom: 10, fontWeight: 600 }}>
          Table of contents
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.85 }}>
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} style={{ color: "var(--text-2, #3a3a32)", textDecoration: "none" }}>{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      {/* §1 Why */}
      <H2 id="why">Why this document was rewritten</H2>
      <P>
        This page is the source of truth for what MacroTilt's market-stress models actually do.
        When a model changes, this page is updated in place — sections are replaced, not appended.
      </P>
      <P>
        The v10 framework that this document used to describe has been retired in full.
        v10 read as four panels with 13 "validated" forward triggers, claiming hit-rate accuracy
        across a 21-year sample. On 2026-04-29 we re-examined the validation work and found that
        most triggers had only two-to-seven truly independent stress episodes, that out-of-sample
        testing demolished 11 of 13 of them, and that compound conditions don't escape multiple-testing
        risk. The honest read is that with roughly ten historical drawdowns in the daily-frequency
        dataset, the data simply cannot support hit-rate claims at the indicator level.
      </P>
      <P>
        What follows replaces v10 entirely. The new framework is descriptive cycle-mechanism counting —
        not predictive trigger firing. Conviction comes from multi-mechanism alignment, not from any
        single indicator firing.
      </P>

      {/* §2 Framework */}
      <H2 id="framework">The framework in one paragraph</H2>
      <P>
        MacroTilt observes six market mechanisms that historically describe where the cycle sits:
        Valuation, Credit, Funding, Growth, Liquidity &amp; Policy, and Positioning &amp; Breadth.
        Each mechanism is read against its own ex-ante rule and labeled Normal, Cautionary,
        Stressed, or Distressed. The headline gauge counts how many of the six mechanisms sit
        above Normal. Zero or one elevated reads as constructive. Two reads as watchful. Three
        is a defensive setup forming. Four or more is a high-conviction defensive posture.
        There is one separate forward-looking tile (yield-curve compound condition) and one
        symmetrical Recovery Watch tile that activates only when several mechanisms are stressed
        or when the equity market is in a 15%-plus drawdown.
      </P>

      {/* §3 Lexicon */}
      <H2 id="lexicon">The four-state lexicon</H2>
      <P>
        Every tile on the site — and every other surface that describes a market reading on
        MacroTilt — uses the same four-state lexicon. The lexicon is defined per mechanism by
        the mechanism's own rule.
      </P>
      <Table
        headers={["State", "Meaning"]}
        rows={[
          [<span style={{ color: STATE_COLORS.Normal, fontWeight: 600 }}>Normal</span>, "The mechanism's rule is not met. The reading is constructive or neutral."],
          [<span style={{ color: STATE_COLORS.Cautionary, fontWeight: 600 }}>Cautionary</span>, "The mechanism's rule is partially met. Worth watching, not yet enough to act on."],
          [<span style={{ color: STATE_COLORS.Stressed, fontWeight: 600 }}>Stressed</span>, "The mechanism's rule is fully met. The mechanism is signaling its concerning regime."],
          [<span style={{ color: STATE_COLORS.Distressed, fontWeight: 600 }}>Distressed</span>, "The mechanism's rule is fully met and deteriorating over the last 60 trading days."],
        ]}
      />
      <P>
        The cutoffs are intentionally conservative: Cautionary fires at partial rule-fire,
        Stressed only at full rule-fire, and Distressed is reserved for the case where the rule
        is fully met and the reading is still moving in the wrong direction. We do this so that
        when "Stressed" or "Distressed" appears on the page, it means something — there is no
        alert-fatigue tail.
      </P>

      {/* §4 Headline */}
      <H2 id="headline">The headline gauge</H2>
      <P>
        The top of the Cycle Mechanism Board reads as a single editorial sentence and a count.
      </P>
      <Table
        headers={["Mechanisms elevated above Normal", "Read"]}
        rows={[
          ["0–1", "Constructive"],
          ["2", "Watchful"],
          ["3", "Defensive setup forming"],
          ["4+", "High-conviction defensive"],
        ]}
      />
      <P>
        We do not report an aggregate "score." Each mechanism is described qualitatively and
        counted toward the headline read. This is deliberate — aggregate scores invite the same
        false-precision the v10 framework collapsed under.
      </P>
      {gauge.headline_sentence && (
        <P>
          <strong>Today's reading:</strong> {gauge.headline_sentence} {gauge.verdict ? `Read: ${gauge.verdict}.` : ""}
        </P>
      )}

      {/* §5 Mechanisms */}
      <H2 id="mechanisms">The six cycle mechanisms</H2>

      <H3>5.1 Valuation</H3>
      <P>
        <strong>What it answers.</strong> How richly is the equity market priced relative to its
        history? When several measures simultaneously sit in their concerning quartile, the
        equity market is showing the cycle-peak signature — high prices, narrow risk premium,
        market-cap-to-GDP near record.
      </P>
      <P><strong>Indicators (Sprint 1).</strong></P>
      <Table
        headers={["Indicator", "Source", "Sample window"]}
        rows={[
          ["CAPE (Shiller)", "Shiller / multpl monthly", "post-2011 (15y)"],
          ["Equity Risk Premium", "Derived: 1/CAPE − DGS10", "post-2011 (15y)"],
          ["Buffett Indicator", "FRED NCBCEL / GDP, quarterly", "post-1970 (~55y)"],
          ["Trailing P/E", "Shiller monthly", "Sprint 1.5"],
        ]}
      />
      <P>
        <strong>Rule.</strong> Stressed when 3 of 4 indicators sit in their concerning quartile.
        For CAPE, P/E, and Buffett the concerning quartile is the top 25% (rich). For equity
        risk premium it is the bottom 25% (no compensation for owning stocks vs bonds).
        Cautionary at 2 of 4. Distressed at 3 of 4 plus deteriorating over 60 trading days.
      </P>
      {valuation && (
        <P>
          <strong>Today.</strong> {valuation.current_state}. {valuation.rule_status}.
          {valuation.indicators?.length > 0 && (
            <> Indicators: {valuation.indicators.map((i, idx) => (
              <span key={i.id}>
                {idx > 0 && "; "}
                {i.name} {i.current?.value} ({i.percentile}th percentile)
              </span>
            ))}.</>
          )}
        </P>
      )}

      <H3>5.2 Credit</H3>
      <P>
        <strong>What it answers.</strong> What compensation are investors demanding to take
        corporate-credit risk? The Credit tile is read as bidirectional: extreme tightness reads
        as cycle-peak complacency ("priced for perfection"), extreme widening reads as actual
        stress arriving. Both are interesting in opposite ways.
      </P>
      <P><strong>Indicators (Sprint 1).</strong></P>
      <Table
        headers={["Indicator", "Source", "Sample window"]}
        rows={[
          ["IG OAS (Baa − 10y)", "FRED BAA − DGS10, monthly", "post-1986 (~40y)"],
          ["HY OAS", "FRED BAMLH0A0HYM2, monthly", "post-2011 (15y)"],
          ["HY/IG ratio", "Derived", "post-2011 (15y)"],
          ["Leveraged loan spread", "TBD", "Sprint 2"],
        ]}
      />
      <P>
        <strong>Rule (bidirectional).</strong> Stressed when 3 of 4 spreads sit in the top
        quartile (real stress arriving) or in the bottom quartile (priced for perfection).
        Cautionary at 2 of 4 in either tail. Distressed when the Stressed condition holds
        and spreads are deteriorating over 60 trading days.
      </P>
      {credit && (
        <P>
          <strong>Today.</strong> {credit.current_state}. {credit.rule_status}.
        </P>
      )}

      <H3>5.3 Funding (Sprint 2)</H3>
      <P>
        <strong>Status.</strong> Not yet live. Renders as a greyed placeholder on the
        Cycle Mechanism Board.
      </P>
      <P>
        <strong>Planned indicators.</strong> SOFR-OIS, FRA-OIS, CDX investment-grade vs
        high-yield basis, 5-year EUR cross-currency basis, 3-month commercial-paper funding spread.
      </P>
      <P>
        <strong>Why we ship Funding before Liquidity &amp; Policy.</strong> Funding is the
        highest-expected-value new mechanism in the framework. Most stress episodes that the
        v10 panel missed had a funding-stress signature that wasn't being read; this is where
        the alpha is.
      </P>

      <H3>5.4 Growth</H3>
      <P>
        <strong>What it answers.</strong> How fast (or slow) is the real economy moving, and
        is it deteriorating? The Growth tile fires only when indicators are simultaneously at
        extreme levels and worsening — the "and" is critical.
      </P>
      <P><strong>Indicators (Sprint 1).</strong></P>
      <Table
        headers={["Indicator", "Source", "Sample window"]}
        rows={[
          ["CFNAI 3-month", "FRED CFNAIMA3, monthly", "post-2006 (20y)"],
          ["Jobless claims (4-week)", "FRED IC4WSA, weekly", "post-2006 (20y)"],
          ["ISM Manufacturing PMI", "FRED NAPMPI, monthly", "post-2006 (20y)"],
          ["Banks vs S&P 500 (BKX/SPX)", "Yahoo ^BKX, ^GSPC, daily", "post-2006 (20y)"],
        ]}
      />
      <P>
        <strong>Rule.</strong> Stressed when 3 of 4 indicators are both extreme (|z| &gt; 1)
        and deteriorating over the last 60 trading days. Cautionary when 2 of 4 meet the dual
        condition. Distressed when 3 of 4 are extreme and all 4 are deteriorating.
      </P>
      {growth && (
        <P>
          <strong>Today.</strong> {growth.current_state}. {growth.rule_status}.
        </P>
      )}

      <H3>5.5 Liquidity &amp; Policy (Sprint 4)</H3>
      <P>
        <strong>Status.</strong> Not yet live.
      </P>
      <P>
        <strong>Planned indicators.</strong> Adjusted National Financial Conditions Index (ANFCI),
        real Fed funds rate, M2 year-over-year growth, term premium, Fed balance sheet
        6-month change.
      </P>
      <P>
        <strong>Planned rule.</strong> Bidirectional composite z-score in either tail
        (top or bottom quartile) is interesting in opposite ways.
      </P>

      <H3>5.6 Positioning &amp; Breadth (Sprint 4)</H3>
      <P>
        <strong>Status.</strong> Not yet live.
      </P>
      <P>
        <strong>Planned indicators.</strong> NAAIM exposure, margin debt year-over-year,
        equity put/call ratio, percentage of S&amp;P 500 above 200-day moving average,
        advance-decline line.
      </P>
      <P>
        <strong>Planned rule.</strong> Bidirectional. Euphoria (long positioning combined with
        narrow breadth) and capitulation (short positioning combined with breadth-thrust setup)
        both read as concerning, opposite directions.
      </P>

      {/* §6 Forward Warning */}
      <H2 id="forward">The Forward Warning tile</H2>
      <P>
        The Forward Warning tile sits visually apart from the six cycle-mechanism tiles.
        It is the only forward-looking signal on the page that we are willing to publish.
      </P>
      <P>
        <strong>The compound condition.</strong> All three of:
      </P>
      <ol style={{ marginLeft: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: "var(--text-2, #3a3a32)" }}>
        <li>The 10-year minus 2-year Treasury yield curve sits in the +0 to +75 bp band (de-inversion underway, not yet steep).</li>
        <li>The Federal funds rate has been cut by at least 75 bp in the last 12 months.</li>
        <li>CFNAI 3-month is below −0.35 and worsening over the last 90 days.</li>
      </ol>
      <P>
        <strong>Read.</strong> The tile fires at 2 of 3 sub-conditions ("warning"). It reads
        "high conviction" at 3 of 3.
      </P>
      <P>
        <strong>Sample-size disclosure.</strong> This compound condition has been met three
        times in the 21-year daily-frequency sample (2007, 2019, 2023). Three observations is
        too few to claim a hit rate. We publish the read because the mechanism is well-understood;
        we do not claim it is a probability statement.
      </P>

      {/* §7 Recovery Watch */}
      <H2 id="recovery">Recovery Watch</H2>
      <P>
        Recovery Watch is the symmetric sibling of the cycle-mechanism board. It activates
        only when the cycle board has 3 or more mechanisms elevated or the S&amp;P 500 is in
        a 15%-plus drawdown. Otherwise it is hidden.
      </P>
      <P>
        <strong>Why we built it.</strong> The hardest call in cycle investing is not "when do
        I get defensive?" The hard call is "when do I come back?" Most defensive frameworks
        go defensive in time and stay defensive too long.
      </P>
      <Table
        headers={["Signal", "Description"]}
        rows={[
          ["VIX peak-and-roll", "VIX has printed a 90-day high then fallen 20% off the peak"],
          ["HY spread peak-and-roll", "HY OAS has printed a 90-day high then fallen 20% off the peak"],
          ["Breadth thrust (Zweig)", "10-day average advance/decline ratio crosses above 0.615"],
          ["Fed pivot", "Fed funds futures price in 2+ cuts within the next 6 months relative to spot"],
        ]}
      />
      <P>
        <strong>Rule.</strong> Lights at 2 of 4. High conviction at 3 of 4.
      </P>

      {/* §8 Watch List */}
      <H2 id="watchlist">Watch List — what we won't claim</H2>
      <P>
        The following indicators were validated in v10 as forward triggers and did not survive
        out-of-sample testing. We continue to display them on the dashboard for context but we
        do not fire alerts on them and we do not include them in any tile rule.
      </P>
      <Table
        headers={["Indicator", "v10 framing", "Why we dropped the trigger"]}
        rows={[
          ["HY OAS > 250 bp", "Defensive sleeve activates", "The 250 bp threshold sits below the post-2011 minimum. Trigger was never wired to the model."],
          ["10y-2y deeply inverted", "Recession imminent", "Coincident, not leading. The de-inversion is the actual lead signal (now in Forward Warning)."],
          ["VIX > 25 sustained", "Stress regime", "Two episodes of sustained > 25 VIX in 21 years — sample too thin."],
          ["MOVE > 130 sustained", "Rates stress", "Coincident with HY OAS in episode count; no incremental signal."],
          ["Real fed funds > 2%", "Restrictive policy", "Permanent-elevated failure mode (1990s)."],
          ["ISM new orders < 45", "Manufacturing recession", "Subindex requires paid feed; headline proxy is too noisy."],
          ["Jobless 4w > 300k", "Labor turning", "Threshold drift. Fired only 2x in 21 years."],
          ["CFNAI 3m < −0.7", "Recession imminent", "Hits 2 false positives in 21 years (2003, 2016)."],
          ["Breadth < 30% above 200dma", "Bear market regime", "Coincident with drawdown, not predictive."],
          ["Margin debt YoY < −20%", "Leverage unwind", "Two episodes; fires after the drawdown is well underway."],
          ["Real rates > 2.5% AND HY > 600 bp", "Compound stress", "Compound conditions don't escape multiple-testing risk."],
        ]}
      />

      {/* §9 Data */}
      <H2 id="data">Data sources, sample windows, and caveats</H2>
      <Table
        headers={["Indicator", "Source", "Window", "Caveat"]}
        rows={[
          ["CAPE", "Shiller / multpl monthly", "post-2011", "Long-history Shiller (post-1881) deferred to v12; current 15y window is the operative comparison."],
          ["Trailing P/E", "Shiller monthly", "post-2011", "Sprint 1.5 add."],
          ["Equity Risk Premium", "Derived (1/CAPE − DGS10)", "post-2011", "—"],
          ["Buffett Indicator", "FRED NCBCEL / GDP, quarterly", "post-1970", "NCBCEL is nonfinancial corps only; canonical version includes financials. Directional read is identical, level slightly understated."],
          ["HY OAS", "FRED BAMLH0A0HYM2, monthly", "post-2011", "ICE BofA license restricts FRED's free history to post-2011. The 2008 GFC peak (~2,000 bp) is out of sample."],
          ["IG OAS proxy", "FRED BAA − DGS10, monthly", "post-1986", "The canonical IG OAS is also license-restricted; BAA − DGS10 is a clean long-history proxy."],
          ["HY/IG ratio", "Derived", "post-2011", "Same window as HY OAS."],
          ["Leveraged loan spread", "TBD", "TBD", "Proprietary feed required; deferred to Sprint 2."],
          ["CFNAI 3-month", "FRED CFNAIMA3, monthly", "post-2006", "Long history (1967+) available; current 20y window matches the rest of the Growth tile."],
          ["Jobless claims (4w)", "FRED IC4WSA, weekly", "post-2006", "—"],
          ["ISM Manufacturing", "FRED NAPMPI, monthly", "post-2006", "Used as a proxy for the new-orders subindex (paid feed)."],
          ["BKX vs S&P 500", "Yahoo ^BKX, ^GSPC daily", "post-2006", "Constructed as ^BKX / ^GSPC."],
        ]}
      />

      {/* §10 Changelog */}
      <H2 id="changelog">What changed from v10 to v11</H2>
      <Table
        headers={["Area", "v10", "v11"]}
        rows={[
          ["Framework", "Four panels with 13 forward triggers", "Six cycle-mechanism tiles + Forward Warning + Recovery Watch + Watch List"],
          ["Headline read", "Composite \"regime score\"", "Count of mechanisms elevated above Normal"],
          ["State labels", "Four-band, level only", "Four-state, rule-based, conservative cuts"],
          ["HY OAS framing", "Wide spreads = stress trigger", "State descriptor inside Credit tile, bidirectional"],
          ["Yield curve", "Deeply inverted = trigger", "De-inversion compound condition with FOMC sub-conditions"],
          ["Hit-rate claims", "Per-trigger hit rates published", "Removed; sample size too small to support"],
          ["Constituent overrides", "Override rules allowed", "Removed (data mining)"],
          ["Killed indicators", "Hidden", "Published in Watch List with explicit \"insufficient evidence\" tag"],
        ]}
      />
      <P>
        The single largest change is the removal of trigger-firing language. v10 told the
        reader that specific indicators would fire defensive postures with quantified
        reliability. v11 tells the reader where each mechanism currently sits in its history,
        lets the reader count, and stays out of probability claims that the data cannot support.
      </P>

      <div style={{
        marginTop: 56,
        paddingTop: 18,
        borderTop: "0.5px dashed var(--border)",
        fontSize: 11,
        color: "var(--text-muted, #7a7a72)",
        lineHeight: 1.6,
      }}>
        Document owner: Senior Quant (numerical accuracy) · UX Designer (structural coherence) ·
        Lead Developer (ships in same PR as the calibration JSON, per LESSONS rule #31).
        <br />
        Calibration source: <code>public/methodology_calibration_v11.json</code>, built by{" "}
        <code>compute_v11_sprint1_calibration.py</code>.
      </div>
    </main>
  );
}
