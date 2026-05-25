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

import { useMemo, useState, useEffect } from "react";
import { usePortfolioHistory } from "../hooks/usePortfolioHistory";
import { usePricesAsOfDate } from "../hooks/usePricesAsOfDate";
import PositionsTable from "./PositionsTable";

// ── pure helpers ──────────────────────────────────────────────────────────

// Exported (bug #1204) so the Home page's Portfolio Insights tile can compute
// per-account TTM with the EXACT same logic the Portfolio Insights page uses,
// guaranteeing the two surfaces can never disagree.
export function computeAccountStats(rowsForAccount) {
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
  if (v > 0.05) return "var(--green-text)";
  if (v > 0) return "var(--green)";
  if (v > -0.05) return "var(--yellow-text)";
  return "var(--red-text)";
}
function colorSharpe(v) {
  if (v == null) return "var(--text-muted)";
  if (v > 1.0) return "var(--green-text)";
  if (v > 0.5) return "var(--green)";
  if (v > 0) return "var(--yellow-text)";
  return "var(--red-text)";
}
function colorBeta(v) {
  if (v == null) return "var(--text-muted)";
  if (v > 1.5) return "var(--red-text)";
  if (v > 1.1) return "var(--yellow-text)";
  if (v < 0.4) return "var(--text-muted)";
  return "var(--text)";
}

function Sparkline({ navSeries, tall = false, compact = false }) {
  if (!navSeries || navSeries.length < 2) {
    return (
      <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-muted)" }}>
        No 12-month NAV history yet
      </div>
    );
  }
  const W = tall ? 880 : 240;
  const H = tall ? 58 : (compact ? 28 : 42);
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
  const stroke = tall ? "var(--red-text)" : (up ? "var(--green-text)" : "var(--red-text)");
  const fill = tall ? "color-mix(in srgb, var(--red) 12%, transparent)" : (up ? "color-mix(in srgb, var(--green) 13%, transparent)" : "color-mix(in srgb, var(--red) 13%, transparent)");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[n - 1][0].toFixed(1)} cy={pts[n - 1][1].toFixed(1)} r="2.5" fill={stroke} />
    </svg>
  );
}

const ACCOUNT_DOT_COLORS = {
  "EY 401(K)":    "var(--red-text)",
  "Taxable":      "#b58a3d",
  "Ethan 529":    "#3a6e58",
  "Scarlett 529": "#a8587a",
  "ROTH IRA":     "var(--accent)",
  "HSA":          "#7a6e3a",
};

// ── component ─────────────────────────────────────────────────────────────


export default function AccountTilesSection({
  accounts, grandTotal, convColor, convLabel, stressScore,
  // Per-account positions table action handlers — passed straight through
  // to <PositionsTable> when an account tile is expanded. Same shape as the
  // global PositionsTable wiring removed from App.jsx in this PR.
  scanData,
  onOpenTicker, onAdd, onEdit, onClose, onDelete,
  onBulkImport, onImportTransactions, onRescan,
  rescanBusy, rescanProgress, pricesTs, eventsTs,
}) {
  const { rows: history, loading: historyLoading } = usePortfolioHistory();
  const pricesAsOfDate = usePricesAsOfDate();
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
      // Beta methodology: match the page-header portBeta exactly. Includes
      // ALL positions (cash, margin, holdings) in both numerator and
      // denominator. Cash positions have beta=0, so they dilute the
      // weighted average toward zero — this is the desired behavior and
      // matches portBeta in App.jsx (line ~5323).
      const denom = positions.reduce((s, p) => s + Math.max(0, p.value || 0), 0);
      const beta = denom > 0
        ? positions.reduce((s, p) => s + ((Math.max(0, p.value || 0) / denom) * (p.beta || 0)), 0)
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
    background: "var(--surface-2)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 10,
    padding: "16px 18px",
    boxShadow: active ? "var(--shadow-md)" : "var(--shadow-sm)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
  });
  // Account tile stats — TTM Return + Sharpe only. Joe directive 2026-05-11:
  // Beta was blank on most accounts and added noise; the sparkline auto-scale
  // misled on small accounts. Tile reads cleaner as name → balance → 2 stats
  // → cash row.
  const statsGrid = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, padding: "10px 0 8px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.12em" }}>BY ACCOUNT</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {tiles.length} accounts · trailing 12 months
        </span>
      </div>

      <div style={grid}>
        {tiles.map((t) => {
          const cashChipColor = t.cash < 0 ? "var(--red-text)" : (t.cash > 0 ? "var(--accent)" : "var(--text-muted)");
          const cashChipBg = t.cash < 0 ? "color-mix(in srgb, var(--red) 10%, transparent)" : (t.cash > 0 ? "var(--accent-soft)" : "var(--surface-3)");
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accountColor, flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 500, color: "var(--text)", letterSpacing: "-0.01em", flex: 1 }}>
                  {t.label}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.05em" }}>
                  {((t.nav / grandTotal) * 100).toFixed(0)}% of book
                </span>
              </div>

              {/* nav */}
              <div style={{ marginTop: -2 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  {fmtMoneyCompact(t.nav)}
                </span>
              </div>

              {/* sparkline removed 2026-05-11 — Joe directive. Auto-scaling
                  misled on small accounts; the line added no insight at
                  this tile size. */}

              {/* stats — TTM RETURN + SHARPE only. BETA dropped 2026-05-11. */}
              <div style={statsGrid}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.07em", marginBottom: 4 }}>TTM RETURN</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: colorTwr(t.ttmTwr) }}>{fmtPct(t.ttmTwr)}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.07em", marginBottom: 4 }}>SHARPE</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: colorSharpe(t.sharpe) }}>{fmtNum(t.sharpe)}</div>
                </div>
              </div>

              {/* cash row — quiet single-line readout */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                <span>{cashLabel} <span style={{ color: t.cash < 0 ? "var(--text-2)" : "var(--text)" }}>{fmtMoney(t.cash)}</span></span>
                <span style={{ color: isExpanded ? "var(--accent)" : "var(--text-dim)" }}>
                  {isExpanded ? "▾" : "▸"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {historyLoading && tiles.every((t) => !t.navSeries.length) && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>
          Loading 12-month history…
        </div>
      )}

      {/* Full-page modal: click an account tile → modal opens with that
          account's PositionsTable. Joe directive 2026-05-11: replaces the
          previous inline-expand-below pattern. Modal sized at 95vw × 92vh
          so the 36-column position table breathes and the user can read
          across without horizontal scrolling on a large monitor.
          Reuses the existing PositionsTable component (sortable, editable
          columns, +Add / per-row Edit / Close / Delete) filtered to the
          account's rows. tableKey is unique per account so sort prefs
          don't bleed between accounts. */}
      {expanded && (
        <AccountPositionsModal
          expanded={expanded}
          onClose={() => setExpandedId(null)}
          scanData={scanData}
          onOpenTicker={onOpenTicker}
          onAdd={onAdd}
          onBulkImport={onBulkImport}
          onImportTransactions={onImportTransactions}
          onRescan={onRescan}
          rescanBusy={rescanBusy}
          rescanProgress={rescanProgress}
          onEdit={onEdit}
          onClose2={onClose}
          onDelete={onDelete}
          pricesTs={pricesTs}
          eventsTs={eventsTs}
          pricesAsOfDate={pricesAsOfDate}
        />
      )}
    </div>
  );
}

// ─── Per-account positions modal ───────────────────────────────────────────
// Full-page overlay with the same PositionsTable rendered inline before.
// Lifted out so esc-to-close + click-backdrop-to-close can be scoped
// cleanly without re-rendering the tile grid on every keystroke.
function AccountPositionsModal({
  expanded, onClose, scanData,
  onOpenTicker, onAdd, onBulkImport, onImportTransactions,
  onRescan, rescanBusy, rescanProgress,
  onEdit, onClose2, onDelete,
  pricesTs, eventsTs, pricesAsOfDate,
}) {
  // Esc key closes the modal. Listener registered on mount, cleaned up on
  // unmount, so it doesn't intercept Esc anywhere else in the app.
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const backdrop = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: "3vh 2vw",
  };
  const panel = {
    width: "min(1640px, 96vw)",
    maxHeight: "94vh",
    overflowY: "auto",
    background: "var(--surface-solid, var(--surface))",
    border: `1px solid ${expanded.accountColor}66`,
    borderRadius: 12,
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    padding: "18px 22px 16px",
  };

  return (
    <div
      style={backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${expanded.label} positions`}
    >
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: expanded.accountColor }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, color: "var(--text)" }}>
              {expanded.label} positions
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
              {expanded.positions.length} row{expanded.positions.length === 1 ? "" : "s"} · ${Math.round(expanded.nav).toLocaleString()} NAV
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "6px 12px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
        <PositionsTable
          rows={expanded.positions}
          grandTotal={expanded.nav}
          screener={scanData?.signals?.screener || {}}
          info={scanData?.signals?.info || {}}
          signals={scanData?.signals || null}
          tableKey={`positions-${expanded.id}`}
          onOpenTicker={onOpenTicker}
          emptyMessage="No open positions in this account."
          onAdd={onAdd}
          onBulkImport={onBulkImport}
          onImportTransactions={onImportTransactions}
          onRescan={onRescan ? () => onRescan(expanded.positions) : undefined}
          rescanBusy={rescanBusy}
          rescanProgress={rescanProgress}
          onEdit={onEdit}
          onClose={onClose2}
          onDelete={onDelete}
          pricesTs={pricesTs}
          eventsTs={eventsTs}
          footnoteSource="Unusual Whales + Yahoo Finance"
          pricesAsOfDate={pricesAsOfDate}
        />
      </div>
    </div>
  );
}
