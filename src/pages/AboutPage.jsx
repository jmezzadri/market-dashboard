// AboutPage — the THESIS, not the math.
// Three-section editorial: The Problem, The Approach, Who It's For.
// Created 2026-04-27 (Joe ask) on feature/ux-home-welcome.
// Different from MethodologyPage:
//   Methodology = sources, scoring, rebalance cadence, backtest spec
//   About       = why this exists, what problem it solves, who it's for
//
// All claims traceable to v9_allocation.json + the indicator universe.
// Senior Quant signed off on the data references.
// UX Designer: paper theme + Fraunces + numbered eyebrows + max-72ch column.

import React from "react";

// Try to load the v9 backtest stats so the About page can show real numbers
// instead of placeholders. Mirrors AssetAllocation.jsx's load pattern.
function useV9Methodology() {
  const [meth, setMeth] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    fetch("/v9_allocation.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setMeth(d?.methodology || null); })
      .catch(() => { if (live) setMeth(null); });
    return () => { live = false; };
  }, []);
  return meth;
}

function StatChip({ label, value, sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: "var(--space-3) var(--space-4)",
      borderRight: "1px solid var(--border-faint)",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--text-dim)", letterSpacing: "0.16em", textTransform: "uppercase",
      }}>{label}</span>
      <span style={{
        fontFamily: "var(--font-display)", fontWeight: 500,
        fontSize: 22, lineHeight: 1, color: "var(--text)",
      }}>{value}</span>
      {sub && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Section({ num, title, children }) {
  return (
    <section style={{ marginBottom: "var(--space-8)" }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        color: "var(--accent)", letterSpacing: "0.18em", textTransform: "uppercase",
        marginBottom: "var(--space-3)",
        display: "flex", alignItems: "center", gap: "var(--space-2)",
      }}>
        <span style={{ width: 20, height: 1, background: "var(--accent)", opacity: 0.6, display: "inline-block" }}/>
        {num}
      </div>
      <h2 style={{
        fontFamily: "var(--font-display)", fontWeight: 400,
        fontSize: "clamp(28px, 3.4vw, 36px)",
        lineHeight: 1.1, letterSpacing: "-0.012em",
        color: "var(--text)", margin: 0, marginBottom: "var(--space-4)",
      }}>{title}</h2>
      <div style={{
        fontSize: 16, color: "var(--text)", lineHeight: 1.65,
        maxWidth: "72ch",
      }}>{children}</div>
    </section>
  );
}

export default function AboutPage({ onNav }) {
  const meth = useV9Methodology();
  const cagrAlpha = meth?.vs_spy_cagr_diff;
  const sharpe = meth?.back_test_sharpe;
  const drawdown = meth?.back_test_max_drawdown;
  const window = meth?.back_test_window;
  const igs = meth?.ig_universe_size;

  return (
    <main className="fade-in" style={{
      maxWidth: 880, margin: "0 auto",
      padding: "var(--space-6) var(--space-8) var(--space-10)",
    }}>
      {/* Hero strip */}
      <div style={{ marginBottom: "var(--space-7)" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--accent)", letterSpacing: "0.18em", textTransform: "uppercase",
          marginBottom: "var(--space-3)",
          display: "flex", alignItems: "center", gap: "var(--space-2)",
        }}>
          <span style={{ width: 20, height: 1, background: "var(--accent)", opacity: 0.6, display: "inline-block" }}/>
          About MacroTilt
        </div>
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: 400,
          fontSize: "clamp(36px, 4.6vw, 52px)",
          lineHeight: 1.05, letterSpacing: "-0.015em",
          color: "var(--text)", margin: 0, marginBottom: "var(--space-4)",
        }}>
          A disciplined model for a <em style={{ fontStyle: "italic", color: "var(--accent)" }}>noisy market.</em>
        </h1>
        <p style={{
          fontSize: 17, color: "var(--text-muted)", lineHeight: 1.55,
          maxWidth: "60ch", margin: 0,
        }}>
          MacroTilt operationalizes a back-tested macro framework into three layers a portfolio manager can read in ten seconds: where stress is, how aggressive to be, and what's worth a trade today.
        </p>
      </div>

      {/* Backtest receipt strip */}
      {meth && (
        <div style={{
          marginBottom: "var(--space-8)",
          padding: 0,
          background: "var(--surface)",
          border: "1px solid var(--border-faint)",
          borderRadius: 8,
          display: "flex", flexWrap: "wrap",
        }}>
          <StatChip
            label="vs S&P 500"
            value={cagrAlpha != null ? `${cagrAlpha >= 0 ? "+" : ""}${(cagrAlpha * 100).toFixed(1)}% / yr` : "—"}
            sub="annualized excess return"
          />
          <StatChip
            label="Sharpe ratio"
            value={sharpe != null ? sharpe.toFixed(2) : "—"}
            sub="return per unit of volatility"
          />
          <StatChip
            label="Max drawdown"
            value={drawdown != null ? `${(drawdown * 100).toFixed(1)}%` : "—"}
            sub="worst peak-to-trough loss"
          />
          <div style={{
            flex: 1, minWidth: 0,
            padding: "var(--space-3) var(--space-4)",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--text-dim)", letterSpacing: "0.16em", textTransform: "uppercase",
            }}>Calibration</span>
            <span style={{
              fontFamily: "var(--font-display)", fontWeight: 500,
              fontSize: 22, lineHeight: 1, color: "var(--text)",
            }}>{window || "—"}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
              {igs ? `${igs} industry groups` : "—"}
            </span>
          </div>
        </div>
      )}

      <Section num="01 / The problem" title="The benchmark is harder to beat than it looks.">
        <p style={{ marginBottom: "var(--space-3)" }}>
          The S&amp;P 500 has a long-run total return that most active strategies struggle to match on a risk-adjusted basis. The reason is not stock picking — it's regime mismatch. Markets spend most of their time in conditions that punish the obvious play: risk-on when stress is hiding, defensive when discounts arrive, leveraged into the crowded factor right before it unwinds.
        </p>
        <p>
          Most "macro views" are unscored gut calls; most trading tools optimize for activity, not edge. What's missing is a disciplined way to read the regime, allocate to it, and act on it — every day, the same way, whether the market is calm or screaming.
        </p>
      </Section>

      <Section num="02 / The approach" title="Three composites, one calibrated model.">
        <p style={{ marginBottom: "var(--space-3)" }}>
          MacroTilt scores macro stress against history across three composites — Risk &amp; Liquidity, Growth, and Inflation — on a −100 to +100 scale where 0 is the long-run normal. The composites are built from indicators that empirically lead S&amp;P drawdowns, sourced from FRED, the Federal Reserve, ICE BofA, the Cleveland Fed, and the Atlanta Fed.
        </p>
        <p style={{ marginBottom: "var(--space-3)" }}>
          The composite read drives a back-tested allocation across the {igs || 25} S&amp;P industry groups, with a defensive sleeve (Treasuries, gold, investment-grade credit) that activates as stress flips. Confidence and leverage scale with how clean the regime signal is. A daily watchlist scanner runs over your tracked names and flags buy alerts and near-triggers.
        </p>
        <p>
          Every parameter — composite weights, regime thresholds, rebalance cadence, the back-test results above — is exposed on the Methodology page. Nothing is opaque. Nothing is gut feel.
          {onNav && (
            <>
              {" "}
              <a onClick={() => onNav("readme")} style={{
                color: "var(--accent)", cursor: "pointer", fontWeight: 500,
                textDecoration: "none",
              }}>Open the methodology →</a>
            </>
          )}
        </p>
      </Section>

      <Section num="03 / Who it's for" title="Portfolio managers, risk managers, and serious individual investors.">
        <p style={{ marginBottom: "var(--space-3)" }}>
          MacroTilt is built for people who already know what a Sharpe ratio is and want a structured way to think about three questions:
          <em style={{ display: "block", marginTop: 8, color: "var(--text-muted)", fontStyle: "italic" }}>
            Where is risk now? · How aggressive should I be? · What's worth a trade today?
          </em>
        </p>
        <p style={{ marginBottom: "var(--space-3)" }}>
          It's not a signal service. It's not a recommendation engine. It's a framework you can pressure-test, override, and use to argue with yourself before you put on size. Numbers are calibrated, not advisory. Disclaimers in the footer; this is not investment advice.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: 14, fontStyle: "italic", marginTop: "var(--space-5)" }}>
          Built in NY, NY · Macro-regime dashboard + watchlist scanner · 2026.
        </p>
      </Section>

      {/* Sign-off footer cross-links */}
      <div style={{
        marginTop: "var(--space-8)",
        paddingTop: "var(--space-5)",
        borderTop: "1px solid var(--border-faint)",
        display: "flex", flexWrap: "wrap", gap: "var(--space-5)",
        fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em",
      }}>
        {onNav && (
          <>
            <a onClick={() => onNav("home")} style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>
              ← Back to home
            </a>
            <a onClick={() => onNav("readme")} style={{ color: "var(--text-muted)", cursor: "pointer", textDecoration: "none" }}>
              Methodology →
            </a>
            <a onClick={() => onNav("overview")} style={{ color: "var(--text-muted)", cursor: "pointer", textDecoration: "none" }}>
              Today's macro →
            </a>
          </>
        )}
      </div>
    </main>
  );
}
