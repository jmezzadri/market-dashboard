// AccountTilesSection — per-account dashboard tile grid (Joe 2026-05-04).
//
// Replaces the prior AcctCard list in the Portfolio Insights → Account
// Breakdown section. Six tiles (one per account, sorted by NAV desc),
// each showing:
//   • account label + position count
//   • current NAV ($K compact) + % of book
//   • 12-month NAV sparkline
//   • TTM return / Sharpe / Beta (color-coded)
//   • cash chip (or MARGIN chip when cash < 0)
//
// Click a tile → expands an inline position list under the grid using the
// existing PosCard component (same render the old AcctCard used).
//
// Senior Quant: TTM uses chained monthly returns from the user's
// portfolio_history table. For accounts with monthly_return populated
// (Fidelity tax-advantaged), uses those directly. For accounts with only
// NAV + flows (Chase Taxable), computes Modified Dietz row-by-row:
//     r = (NAV_end - NAV_start - flows) / (NAV_start + 0.5 * flows)
// Sharpe = (TTM - 0.05) / annualized_vol, where annualized_vol = stdev(monthly
// returns) × sqrt(12), matching the page-header convention.
//
// UX: brand-token compliant, Liquid Glass surface, Fraunces label,
// JetBrains Mono numbers. Hover lifts; click toggles inline expand.

import { useMemo, useState } from "react";
import { usePortfolioHistory } from "../hooks/usePortfolioHistory";

// ── pure helpers ──────────────────────────────────────────────────────────

function computeAccountStats(rowsForAccount) {
  if (!rowsForAccount || rowsForAccount.length === 0) {
    return { ttmTwr: null, sharpe: null, annVol: null, navSeries: [], dataMonths: 0 };
  }
  const sorted = [...rowsForAccount].sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
  // Collapse to one row per (year-month), keeping the latest as_of in each.
  const byYM = new Map();
  for (const r of sorted) {
    const ym = r.as_of.slice(0, 7);
    byYM.set(ym, r);
  }
  const monthly = [...byYM.values()].sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
  const rets = [];
  const navs = [];
  for (let i = 1; i < monthly.length; i++) {
    const prev = monthly[i - 1];
    const cur = monthly[i];
    if (cur.monthly_return != null) {
      rets.push(Number(cur.monthly_return));
    } else {
      const nStart = Number(prev.nav || 0);
      const nEnd = Number(cur.nav || 0);
      const flows = Number(cur.contributions || 0) - Number(cur.withdrawals || 0);
      const denom = nStart + 0.5 * flows;
      if (denom > 0) rets.push((nEnd - nStart - flows) / denom);
      else rets.push(null);
    }
    if (cur.nav != null) navs.push({ as_of: cur.as_of, nav: Number(cur.nav) });
  }
  const lastReturns = rets.filter((x) => x != null).slice(-12);
  const lastNavs = navs.slice(-12);
  let ttmTwr = null;
  if (lastReturns.length) {
    let chain = 1;
    for (const r of lastReturns) chain *= 1 + r;
    ttmTwr = chain - 1;
  }
  let annVol = null;
  let sharpe = null;
  if (lastReturns.length > 1 && ttmTwr != null) {
    const mean = lastReturns.reduce((a, b) => a + b, 0) / lastReturns.length;
    const variance = lastReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (lastReturns.length - 1);
    annVol = Math.sqrt(variance) * Math.sqrt(12);
    if (annVol > 0) sharpe = (ttmTwr - 0.05) / annVol;
  }
  return { ttmTwr, sharpe, annVol, navSeries: lastNavs, dataMonths: lastReturns.length };
}

function fmtMoneyCompact(v) {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-$" : "$";
  if (abs >= 1_000_000) return sign + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1_000) return sign + Math.round(abs / 1e3) + "K";
  return sign + Math.round(abs).toLocaleString();
}
function fmtMoney(v) {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-$" : "$";
  return sign + Math.round(abs).toLocaleString();
}
function fmtPct(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return sign + (v * 100).toFixed(dp) + "%";
}
function fmtNum(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return sign + v.toFixed(dp);
}
function colorTwr(v) {
  if (v == null) return "var(--text-muted)";
  if (v > 0.05) return "#137333";
  if (v > 0) return "#2e7d4f";
  if (v > -0.05) return "#a85d00";
  return "#9a1f1f";
}
function colorSharpe(v) {
  if (v == null) return "var(--text-muted)";
  if (v > 1.0) return "#137333";
  if (v > 0.5) return "#2e7d4f";
  if (v > 0) return "#7a6e3a";
  return "#9a1f1f";
}
function colorBeta(v) {
  if (v == null) return "var(--text-muted)";
  if (v > 1.5) return "#9a1f1f";
  if (v > 1.1) return "#a85d00";
  if (v < 0.4) return "#3d5a80";
  return "var(--text)";
}

function Sparkline({ navSeries }) {
  if (!navSeries || navSeries.length < 2) {
    return (
      <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-muted)" }}>
        No 12-month NAV history yet
      </div>
    );
  }
  const W = 240, H = 42;
  const navs = navSeries.map((s) => s.nav);
  const lo = Math.min(...navs), hi = Math.max(...navs);
  const span = hi - lo || 1;
  const n = navs.length;
  const pts = navs.map((v, i) => {
    const x = (i / (n - 1)) * W;
    const y = H - ((v - lo) / span) * (H - 6) - 3;
    return [x, y];
  });
  const linePath = "M " + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const areaPath = linePath + ` L ${pts[n - 1][0].toFixed(1)},${H} L 0,${H} Z`;
  const up = navs[n - 1] >= navs[0];
  const stroke = up ? "#137333" : "#9a1f1f";
  const fill = up ? "#13733322" : "#9a1f1f22";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 42, display: "block" }}>
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[n - 1][0].toFixed(1)} cy={pts[n - 1][1].toFixed(1)} r="2.5" fill={stroke} />
    </svg>
  );
}

const ACCOUNT_DOT_COLORS = {
  "EY 401(K)":    "#7a2e2a",
  "Taxable":      "#b58a3d",
  "Ethan 529":    "#3a6e58",
  "Scarlett 529": "#a8587a",
  "ROTH IRA":     "#3d5a80",
  "HSA":          "#7a6e3a",
};

// ── component ─────────────────────────────────────────────────────────────

export default function AccountTilesSection({ accounts, grandTotal, convColor, convLabel, stressScore, PosCard }) {
  const { rows: history, loading: historyLoading } = usePortfolioHistory();
  const [expandedId, setExpandedId] = useState(null);

  const tiles = useMemo(() => {
    const histByLabel = new Map();
    for (const r of history || []) {
      if (!histByLabel.has(r.account_label)) histByLabel.set(r.account_label, []);
      histByLabel.get(r.account_label).push(r);
    }
    const out = (accounts || []).map((a) => {
      const positions = a.positions || [];
      const nav = positions.reduce((sum, p) => sum + (p.value || 0), 0);
      const cash = positions.filter((p) => (p.asset_class || "").toLowerCase() === "cash" || (p.sector || "").toLowerCase() === "cash")
                           .reduce((sum, p) => sum + (p.value || 0), 0);
      const exNonCash = positions.filter((p) => (p.asset_class || "").toLowerCase() !== "cash" && (p.sector || "").toLowerCase() !== "cash");
      const denom = exNonCash.reduce((s, p) => s + Math.max(0, p.value || 0), 0);
      const beta = denom > 0
        ? exNonCash.reduce((s, p) => s + ((Math.max(0, p.value || 0) / denom) * (p.beta || 0)), 0)
        : null;
      const stats = computeAccountStats(histByLabel.get(a.label) || []);
      return {
        id: a.id,
        label: a.label,
        sub: a.sub,
        positionCount: positions.length,
        nav,
        cash,
        beta,
        ...stats,
        accountColor: ACCOUNT_DOT_COLORS[a.label] || a.color || "#5e5e63",
        positions,
      };
    }).sort((a, b) => b.nav - a.nav);
    return out;
  }, [accounts, history]);

  const expanded = tiles.find((t) => t.id === expandedId);

  const wrap = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px 24px", boxShadow: "var(--shadow-sm)", backdropFilter: "blur(20px)" };
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, marginBottom: 18 };
  const tile = (active) => ({
    background: "rgba(255,255,255,0.92)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 10,
    padding: "16px 18px",
    boxShadow: active ? "0 4px 14px rgba(0,0,0,0.08)" : "var(--shadow-sm)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
  });
  const statsGrid = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, padding: "10px 0 8px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.12em" }}>③ ACCOUNT BREAKDOWN</span>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {tiles.length} accounts · trailing 12 months · click to expand
        </span>
      </div>

      <div style={grid}>
        {tiles.map((t) => {
          const cashChipColor = t.cash < 0 ? "#9a1f1f" : (t.cash > 0 ? "#3d5a80" : "#5e5e63");
          const cashChipBg = t.cash < 0 ? "#fdecec" : (t.cash > 0 ? "#ecf2fa" : "#f0f0f3");
          const cashLabel = t.cash < 0 ? "MARGIN" : "CASH";
          const isExpanded = t.id === expandedId;
          return (
            <div
              key={t.id}
              style={tile(isExpanded)}
              onClick={() => setExpandedId(isExpanded ? null : t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(isExpanded ? null : t.id); }}
            >
              {/* head */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accountColor, flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: 16, fontWeight: 500, color: "var(--text)", letterSpacing: "-0.01em" }}>
                    {t.label}
                  </span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.05em" }}>
                  {t.positionCount} pos
                </span>
              </div>

              {/* nav */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: -4 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  {fmtMoneyCompact(t.nav)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {grandTotal > 0 ? ((t.nav / grandTotal) * 100).toFixed(1) + "% of book" : ""}
                </span>
              </div>

              {/* sparkline */}
              <div style={{ margin: "4px -2px 0" }}>
                <Sparkline navSeries={t.navSeries} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.03em", marginTop: -4 }}>
                <span>12-mo NAV</span>
                <span>
                  {t.navSeries[0]?.as_of?.slice(0, 7) || ""}
                  {t.navSeries.length ? " → " : ""}
                  {t.navSeries[t.navSeries.length - 1]?.as_of?.slice(0, 7) || ""}
                </span>
              </div>

              {/* stats */}
              <div style={statsGrid}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.07em", marginBottom: 4 }}>TTM RETURN</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: colorTwr(t.ttmTwr) }}>{fmtPct(t.ttmTwr)}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.07em", marginBottom: 4 }}>SHARPE</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: colorSharpe(t.sharpe) }}>{fmtNum(t.sharpe)}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.07em", marginBottom: 4 }}>BETA</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: colorBeta(t.beta) }}>{fmtNum(t.beta)}</div>
                </div>
              </div>

              {/* cash + footer */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, padding: "3px 8px", border: `1px solid ${cashChipColor}33`, borderRadius: 4, color: cashChipColor, background: cashChipBg, letterSpacing: "0.05em" }}>
                  {cashLabel}&nbsp;{fmtMoney(t.cash)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: isExpanded ? "var(--accent)" : "var(--text-dim)" }}>
                  {isExpanded ? "▾ Open" : "▸ Click to open"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline expand: position list for the clicked account */}
      {expanded && (
        <div style={{ background: "var(--surface-2)", border: `1px solid ${expanded.accountColor}55`, borderRadius: 10, padding: "14px 18px", marginTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: 15, fontWeight: 500, color: "var(--text)" }}>
              {expanded.label} positions
            </span>
            <button
              onClick={() => setExpandedId(null)}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 10px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}
            >
              Collapse
            </button>
          </div>
          {expanded.positions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 0" }}>No open positions in this account.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {expanded.positions
                .slice()
                .sort((a, b) => (b.value || 0) - (a.value || 0))
                .map((p) => (
                  <PosCard
                    key={p.ticker + (p.id || "")}
                    p={p}
                    accountTotal={expanded.nav}
                    convColor={convColor}
                    convLabel={convLabel}
                    stressScore={stressScore}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {historyLoading && tiles.every((t) => !t.navSeries.length) && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>
          Loading 12-month history…
        </div>
      )}
    </div>
  );
}
