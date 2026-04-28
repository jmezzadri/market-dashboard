// TradeHistorySection — collapsible inline ledger on Portfolio Insights.
//
// Phase 5B. Renders a sortable, filterable table over public.transactions
// for the signed-in user. Driven entirely by the rows passed in from the
// useTransactionsLedger hook in App.jsx — no separate fetching here.
//
// Filters:
//   • date range: YTD, 1M, 3M, Lifetime  (matches the Realized P&L tile)
//   • ticker: free-text contains (case-insensitive)
//   • account: dropdown over the user's accounts (+ "All accounts")
//   • options-only toggle: show only asset_class === "option"
//
// CSV export: downloads the *currently filtered* rows. File name is
// `macrotilt-trades-YYYY-MM-DD.csv`.
//
// Sortable via the shared useSortableTable hook (LESSONS rule #4).
// Plain English column headers + tooltips on the trickier ones (LESSONS
// rule #5).

import { useMemo, useState } from "react";
import { useSortableTable, SortArrow } from "../hooks/useSortableTable.jsx";
import { InfoTip } from "../InfoTip";

const MS_PER_DAY = 86400000;
const TH_PAD = "8px 10px";
const TD_PAD = "7px 10px";

// CSV-safe stringify: wraps values in quotes when they contain commas,
// quotes, or newlines; doubles internal quotes per RFC 4180.
function csvField(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function fmt$(v, opts = {}) {
  if (v == null || isNaN(v)) return "—";
  const sign = v < 0 ? "-" : opts.signed ? "+" : "";
  const abs = Math.abs(v);
  return sign + "$" + abs.toLocaleString(undefined, {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

function fmtQty(v, multiplier) {
  if (v == null || isNaN(v)) return "—";
  // Options: show "1 contract" rather than "1" so the row reads obvious.
  if (multiplier && multiplier > 1) return `${v} contract${v === 1 ? "" : "s"}`;
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Side badge color — BUY/OPEN green, CLOSE blue, SELL/SHORT red.
function sideColor(side) {
  switch ((side || "").toUpperCase()) {
    case "BUY":   return { bg: "rgba(48,209,88,0.14)",  fg: "var(--green-text)"  };
    case "OPEN":  return { bg: "rgba(48,209,88,0.10)",  fg: "var(--green-text)"  };
    case "CLOSE": return { bg: "rgba(74,111,165,0.18)", fg: "#4a6fa5"            };
    case "SELL":  return { bg: "rgba(255,69,58,0.14)",  fg: "var(--orange-text)" };
    default:      return { bg: "var(--surface-3)",      fg: "var(--text-muted)"  };
  }
}

// Ticker label for options: "NVDA $195P 7/17/26" — easier to read than four
// separate columns on a phone.
function tickerLabel(r) {
  if (r.assetClass === "option" && r.contractType && r.strike != null) {
    const ct = r.contractType.toUpperCase().slice(0, 1); // P or C
    const exp = r.expiration ? new Date(r.expiration).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "";
    return `${r.ticker} $${r.strike}${ct}${exp ? " " + exp : ""}`;
  }
  return r.ticker;
}

export default function TradeHistorySection({ rows, loading, accounts }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("lifetime"); // ytd | m1 | m3 | lifetime
  const [tickerQ, setTickerQ] = useState("");
  const [accountId, setAccountId] = useState("all");
  const [optionsOnly, setOptionsOnly] = useState(false);

  // Apply filters, then feed into useSortableTable.
  const filtered = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const now = new Date();
    let cutoff = null;
    if (period === "ytd")      cutoff = new Date(now.getFullYear(), 0, 1);
    else if (period === "m1")  cutoff = new Date(now.getTime() - 30 * MS_PER_DAY);
    else if (period === "m3")  cutoff = new Date(now.getTime() - 90 * MS_PER_DAY);
    const tq = tickerQ.trim().toLowerCase();
    return rows.filter(r => {
      if (cutoff && (!r.executedAt || r.executedAt < cutoff)) return false;
      if (accountId !== "all" && r.accountId !== accountId) return false;
      if (optionsOnly && r.assetClass !== "option") return false;
      if (tq && !(r.ticker || "").toLowerCase().includes(tq)) return false;
      return true;
    });
  }, [rows, period, tickerQ, accountId, optionsOnly]);

  const cols = useMemo(() => ([
    { id: "date",     label: "Date",        align: "left",  sortValue: r => r.executedAt ? r.executedAt.getTime() : null },
    { id: "side",     label: "Side",        align: "left",  sortValue: r => r.side },
    { id: "ticker",   label: "Ticker",      align: "left",  sortValue: r => r.ticker },
    { id: "asset",    label: "Asset",       align: "left",  sortValue: r => r.assetClass },
    { id: "qty",      label: "Quantity",    align: "right", sortValue: r => r.quantity },
    { id: "price",    label: "Price",       align: "right", sortValue: r => r.price },
    { id: "proceeds", label: "Proceeds",    align: "right", sortValue: r => r.netProceeds },
    { id: "pnl",      label: "Realized P&L",align: "right", sortValue: r => r.realizedPnl },
    { id: "hold",     label: "Hold (days)", align: "right", sortValue: r => r.holdingDays },
    { id: "tax",      label: "ST/LT",       align: "left",  sortValue: r => r.isLongTerm === true ? 1 : r.isLongTerm === false ? 0 : null },
    { id: "acct",     label: "Account",     align: "left",  sortValue: r => r.accountLabel },
  ]), []);

  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable({
    rows: filtered, columns: cols, defaultColId: "date", defaultDir: "desc",
  });

  // CSV export — currently filtered rows, sorted view.
  const exportCsv = () => {
    const header = ["Date","Side","Ticker","Asset class","Contract","Direction","Strike","Expiration","Quantity","Price","Multiplier","Gross proceeds","Net proceeds","Cost basis","Realized P&L","Holding days","Tax bucket","Account","Notes"];
    const lines = [header.map(csvField).join(",")];
    for (const r of sorted) {
      const tax = r.isLongTerm === true ? "Long-term" : r.isLongTerm === false ? "Short-term" : "";
      lines.push([
        r.executedAt ? r.executedAt.toISOString().slice(0,10) : "",
        r.side,
        r.ticker,
        r.assetClass,
        r.contractType || "",
        r.direction || "",
        r.strike ?? "",
        r.expiration || "",
        r.quantity,
        r.price,
        r.multiplier,
        r.grossProceeds,
        r.netProceeds,
        r.costBasis,
        r.realizedPnl,
        r.holdingDays,
        tax,
        r.accountLabel,
        r.notes,
      ].map(csvField).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `macrotilt-trades-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  };

  // Static styles (mirrors the rest of /#insights).
  const sectionPanel = { background: "var(--surface)", border: "1px solid var(--border-faint)", borderRadius: 8, marginBottom: 12, overflow: "hidden" };
  const sectionHeader = { padding: "10px 14px", borderBottom: "1px solid var(--border-faint)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" };
  const sectionTitleStyle = { fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)", letterSpacing: "0.15em", fontWeight: 700 };
  const ACCENT = "#4a6fa5";

  const closeCount = useMemo(() => (rows || []).filter(r => r.realizedPnl != null).length, [rows]);

  return (
    <div style={sectionPanel}>
      <div style={{ ...sectionHeader, cursor: "pointer" }} onClick={() => setOpen(v => !v)}>
        <span style={sectionTitleStyle}>
          TRADE HISTORY <InfoTip term="Trade History" def="Every BUY, SELL, OPEN, and CLOSE booked through your portfolio. Realized P&L is populated only on closes — opens are cost-basis only." size={10}/>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {(rows||[]).length} trade{rows && rows.length === 1 ? "" : "s"} · {closeCount} closed
          </span>
          <span style={{ fontSize: 11, color: ACCENT, fontFamily: "var(--font-mono)" }}>
            {open ? "▾ Hide" : "▸ Show"}
          </span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Filters row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {/* Period */}
            <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", borderRadius: 5, padding: 3 }}>
              {[
                { id: "ytd",      lbl: "YTD"      },
                { id: "m1",       lbl: "1M"       },
                { id: "m3",       lbl: "3M"       },
                { id: "lifetime", lbl: "Lifetime" },
              ].map(b => (
                <button key={b.id} onClick={() => setPeriod(b.id)} style={{
                  padding: "5px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
                  fontWeight: 600, letterSpacing: "0.04em",
                  background: period === b.id ? ACCENT : "transparent",
                  color: period === b.id ? "#fff" : "var(--text-muted)",
                  border: "none", borderRadius: 4, cursor: "pointer",
                }}>{b.lbl}</button>
              ))}
            </div>
            {/* Ticker filter */}
            <input
              type="text"
              placeholder="Filter ticker…"
              value={tickerQ}
              onChange={e => setTickerQ(e.target.value)}
              style={{
                padding: "6px 10px", fontSize: 12, fontFamily: "var(--font-mono)",
                background: "var(--surface-2)", border: "1px solid var(--border-faint)",
                borderRadius: 4, color: "var(--text)", width: 130,
              }}
            />
            {/* Account dropdown */}
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              style={{
                padding: "6px 10px", fontSize: 12, fontFamily: "var(--font-mono)",
                background: "var(--surface-2)", border: "1px solid var(--border-faint)",
                borderRadius: 4, color: "var(--text)",
              }}
            >
              <option value="all">All accounts</option>
              {(accounts || []).map(a => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            {/* Options-only */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", cursor: "pointer" }}>
              <input type="checkbox" checked={optionsOnly} onChange={e => setOptionsOnly(e.target.checked)} />
              Options only
            </label>
            {/* Spacer */}
            <div style={{ flex: 1 }} />
            {/* CSV export */}
            <button
              onClick={exportCsv}
              disabled={!sorted || sorted.length === 0}
              title={sorted.length === 0 ? "No rows to export" : `Export ${sorted.length} row${sorted.length === 1 ? "" : "s"} to CSV`}
              style={{
                padding: "6px 12px", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                letterSpacing: "0.04em", color: sorted.length === 0 ? "var(--text-dim)" : "#fff",
                background: sorted.length === 0 ? "var(--surface-3)" : ACCENT,
                border: "none", borderRadius: 4, cursor: sorted.length === 0 ? "default" : "pointer",
              }}
            >
              ↓ EXPORT CSV
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>Loading trade history…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center", fontStyle: "italic" }}>
              No trades match these filters.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    {cols.map(c => (
                      <th
                        key={c.id}
                        onClick={() => toggleSort(c.id)}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(c.id); } }}
                        role="button"
                        tabIndex={0}
                        aria-sort={sortCol === c.id ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                        style={{ padding: TH_PAD, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em", borderBottom: "1px solid var(--border-faint)", whiteSpace: "nowrap", fontSize: 10, textAlign: c.align, cursor: "pointer", userSelect: "none" }}
                      >
                        {c.label} <SortArrow dir={sortCol === c.id ? sortDir : null} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const sc = sideColor(r.side);
                    const pnlCol = r.realizedPnl == null ? "var(--text-dim)" : r.realizedPnl > 0 ? "var(--green-text)" : r.realizedPnl < 0 ? "var(--orange-text)" : "var(--text)";
                    const taxLabel = r.isLongTerm === true ? "LT" : r.isLongTerm === false ? "ST" : "—";
                    const taxColor = r.isLongTerm === true ? "var(--green-text)" : r.isLongTerm === false ? "var(--text-muted)" : "var(--text-dim)";
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--border-faint)", background: i % 2 === 0 ? "transparent" : "var(--surface-2)" }}>
                        <td style={{ padding: TD_PAD, color: "var(--text)" }}>{fmtDate(r.executedAt)}</td>
                        <td style={{ padding: TD_PAD }}>
                          <span style={{ background: sc.bg, color: sc.fg, padding: "2px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>{r.side}</span>
                        </td>
                        <td style={{ padding: TD_PAD, color: "var(--text)", fontWeight: 600 }}>{tickerLabel(r)}</td>
                        <td style={{ padding: TD_PAD, color: "var(--text-muted)" }}>{r.assetClass}</td>
                        <td style={{ padding: TD_PAD, textAlign: "right", color: "var(--text)" }}>{fmtQty(r.quantity, r.multiplier)}</td>
                        <td style={{ padding: TD_PAD, textAlign: "right", color: "var(--text)" }}>{r.price != null ? "$" + Number(r.price).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</td>
                        <td style={{ padding: TD_PAD, textAlign: "right", color: "var(--text)" }}>{fmt$(r.netProceeds, { cents: false })}</td>
                        <td style={{ padding: TD_PAD, textAlign: "right", color: pnlCol, fontWeight: 700 }}>{r.realizedPnl == null ? "—" : fmt$(r.realizedPnl, { signed: true })}</td>
                        <td style={{ padding: TD_PAD, textAlign: "right", color: "var(--text-muted)" }}>{r.holdingDays == null ? "—" : r.holdingDays}</td>
                        <td style={{ padding: TD_PAD, color: taxColor, fontWeight: 700 }}>{taxLabel}</td>
                        <td style={{ padding: TD_PAD, color: "var(--text-muted)" }}>{r.accountLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
            Sortable — click any column header. ST = short-term (≤ 1 year, ordinary income tax). LT = long-term (&gt; 1 year, capital-gains tax). Proceeds shown net of fees. Options shown per-contract; Quantity column shows contract count.
          </div>
        </div>
      )}
    </div>
  );
}
