// ============================================================================
// CloseModal — modal for closing a position via the close_position RPC.
// ============================================================================
// Phase 3 of the Close Position + ledger build (v1+v2). Calls the
// SECURITY DEFINER stored function public.close_position which atomically:
//   1. Computes realized P&L (avg-cost weighted; tax-lot method = average
//      cost per Joe's decision 2026-04-27).
//   2. Writes a CLOSE row to public.transactions with full tax-lot context
//      (cost_basis, holding_days, is_long_term, gross/net proceeds).
//   3. Credits (long close) or debits (short buy-to-close) the chosen
//      cash row in the target account. Creates a cash row if none exists.
//   4. Soft-archives the source position (full close) or reduces qty
//      (partial close).
//
// Props:
//   position    : the heldPositions row being closed.
//                 Shape (raw, from App.jsx):
//                   { id, accountId, ticker, name, sector, price,
//                     avgCost, quantity, value, beta, acctLabel,
//                     assetClass, contractType, direction, strike,
//                     expiration, multiplier, ingestedPrice, ... }
//   accounts    : Array<{ id, label, tactical }> for the cash account picker.
//                 Defaults the picker to the position's source account.
//   onCancel    : fn() — close the modal without action.
//   onClosed    : fn(transactionRow) — success callback. Parent should
//                 refetch portfolio so the closed row disappears + the
//                 cash row updates.
// ============================================================================

import React, { useState } from "react";
import { supabase } from "../lib/supabase";

// ── styles (mirrors PositionEditor.jsx for visual consistency) ──────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
const modal = {
  width: "min(560px, 94vw)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "var(--surface-solid)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md, 10px)",
  padding: "20px 22px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const label = {
  display: "block", fontSize: 10, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
  fontWeight: 700, marginBottom: 4,
};
const input = {
  width: "100%", padding: "8px 10px", fontSize: 13,
  color: "var(--text)", background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm, 6px)",
  fontFamily: "var(--font-mono)", outline: "none", boxSizing: "border-box",
};
const primaryBtn = {
  padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#fff",
  background: "var(--accent)", border: "none",
  borderRadius: "var(--radius-sm, 6px)", cursor: "pointer",
};
const secondaryBtn = {
  padding: "9px 14px", fontSize: 13, color: "var(--text-muted)",
  background: "transparent", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm, 6px)", cursor: "pointer",
};

// ── helpers ────────────────────────────────────────────────────────────────
const fmt$ = (v) => `$${(Number(v) || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

// ── component ──────────────────────────────────────────────────────────────
export default function CloseModal({ position, accounts, onCancel, onClosed }) {
  // Guard: render nothing if no position selected.
  if (!position) return null;

  // Read shape — App.jsx uses both camelCase (avgCost, contractType) and
  // snake_case (avg_cost) depending on which path produced the row, so we
  // fall back through both.
  const isOption     = (position.assetClass || position.asset_class) === "option";
  const directionLC  = (position.direction || "").toLowerCase();
  const qtyRaw       = Number(position.quantity ?? 0);
  const isShort      = directionLC === "short" || qtyRaw < 0;
  const multiplier   = Number(position.multiplier || (isOption ? 100 : 1));
  const fullQty      = Math.abs(qtyRaw);
  const livePrice    = Number(position.price ?? position.avgCost ?? position.avg_cost ?? 0);
  const avgCost      = Number(position.avgCost ?? position.avg_cost ?? 0);
  const ticker       = position.ticker || "";
  const acctLabel    = position.acctLabel || "";
  const contractType = position.contractType || position.contract_type || "";
  const strike       = Number(position.strike || 0);
  const expiration   = position.expiration || "";

  // Form state — defaults are the most likely close ("sell whole position
  // at today's mark") so a single Confirm click ships the typical case.
  const [closingPrice,   setClosingPrice]   = useState(livePrice);
  const [closeQty,       setCloseQty]       = useState(fullQty);
  const [executedAt,     setExecutedAt]     = useState(todayISO());
  const [cashAccountId,  setCashAccountId]  = useState(position.accountId || "");
  const [fees,           setFees]           = useState(0);
  const [notes,          setNotes]          = useState("");
  const [submitting,     setSubmitting]     = useState(false);
  const [err,            setErr]            = useState("");

  // Live preview math — cash impact + realized P&L using average-cost basis.
  const closingPriceN = Number(closingPrice) || 0;
  const closeQtyN     = Number(closeQty) || 0;
  const feesN         = Number(fees) || 0;
  const grossProceeds = closeQtyN * closingPriceN * multiplier;
  const netCash       = grossProceeds - feesN;
  const costAmount    = closeQtyN * avgCost * multiplier;
  const realizedPnL   = isShort
    ? (costAmount - grossProceeds - feesN)
    : (grossProceeds - costAmount - feesN);
  const cashLabel     = isShort ? "you'll pay (buy-to-close)" : "you'll receive (sell-to-close)";
  const cashSign      = isShort ? -1 : 1;

  // Submit — calls the close_position RPC. The function is SECURITY DEFINER
  // and verifies auth.uid() matches the position owner, so RLS still gates
  // even though the function bypasses RLS on the inserts/updates.
  const handleSubmit = async () => {
    setErr("");
    if (!position.id)              { setErr("Position id missing.");                return; }
    if (!(closingPriceN > 0))      { setErr("Closing price must be positive.");     return; }
    if (!(closeQtyN > 0))          { setErr("Quantity must be positive.");          return; }
    if (closeQtyN > fullQty + 1e-9){ setErr(`Quantity can't exceed open qty ${fullQty}.`); return; }
    if (!cashAccountId)            { setErr("Pick a cash account for the proceeds."); return; }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("close_position", {
        p_position_id:     position.id,
        p_close_price:     closingPriceN,
        p_close_qty:       closeQtyN,
        // Use 4pm ET-ish timestamp — close-of-business proxy. The user
        // picked the date; the time is approximate.
        p_executed_at:     new Date(`${executedAt}T16:00:00`).toISOString(),
        p_cash_account_id: cashAccountId,
        p_fees:            feesN,
        p_notes:           notes || null,
      });
      if (error) throw error;
      onClosed?.(data);
    } catch (e) {
      console.error("[CloseModal] close_position RPC failed:", e);
      setErr(e.message || "Close failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Eligible cash-target accounts — every account the user has. Could
  // restrict to tactical-only; we keep all to support edge cases like
  // crediting a 401(k)'s cash sleeve. Sorted by tactical-first.
  const eligibleAccounts = (accounts || [])
    .filter((a) => a && a.id)
    .slice()
    .sort((a, b) => (b.tactical ? 1 : 0) - (a.tactical ? 1 : 0));

  return (
    <div style={backdrop} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {/* ── header ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              CLOSE POSITION
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "2px 0 0" }}>
              {ticker} {acctLabel ? `· ${acctLabel}` : ""}
            </h3>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {isOption
                ? `${directionLC || "long"} ${contractType || "?"} · K=${fmt$(strike)} · exp ${expiration || "?"}`
                : (position.assetClass || position.asset_class || "stock")}
              {" · avg cost "}{fmt$(avgCost)}{isOption ? "/share" : ""}
              {" · open qty "}{fullQty}
            </div>
          </div>
          <button onClick={onCancel} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
            Close
          </button>
        </div>

        {/* ── price + qty ───────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>
              CLOSING PRICE{isOption ? " (PER SHARE LEG)" : ""}
            </label>
            <input
              type="number" step="0.01" style={input}
              value={closingPrice}
              onChange={(e) => setClosingPrice(e.target.value)}
            />
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              live mark {fmt$(livePrice)}{isOption ? "/share" : ""}
              {multiplier !== 1 ? ` • ×${multiplier}` : ""}
            </div>
          </div>
          <div>
            <label style={label}>QUANTITY (MAX {fullQty})</label>
            <input
              type="number" step="any" style={input}
              value={closeQty}
              onChange={(e) => setCloseQty(e.target.value)}
            />
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {closeQtyN >= fullQty ? "full close" : `partial close — ${fullQty - closeQtyN} ${isOption ? "contracts" : "shares"} remain`}
            </div>
          </div>
        </div>

        {/* ── date + cash account ───────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>EXECUTED</label>
            <input type="date" style={input} value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} />
          </div>
          <div>
            <label style={label}>{isShort ? "CASH FROM" : "CASH TO"}</label>
            <select
              style={input}
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
            >
              {eligibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}{a.tactical ? "" : " · core"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── fees + notes ──────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={label}>FEES (OPTIONAL)</label>
            <input
              type="number" step="0.01" style={input}
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label style={label}>NOTES (OPTIONAL)</label>
            <input
              type="text" style={input}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. rolled to ATM, took profit"
            />
          </div>
        </div>

        {/* ── live preview ──────────────────────────────────────────── */}
        <div style={{
          padding: 12, marginBottom: 14,
          background: "var(--surface-2, rgba(0,0,0,0.04))",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm, 6px)",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>
            PREVIEW
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: "var(--text-muted)" }}>{cashLabel}</span>
            <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", color: cashSign > 0 ? "#30d158" : "#ff453a" }}>
              {fmt$(Math.abs(netCash))}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-muted)" }}>realized profit/loss (avg-cost basis)</span>
            <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", color: realizedPnL >= 0 ? "#30d158" : "#ff453a" }}>
              {realizedPnL >= 0 ? "+" : "−"}{fmt$(Math.abs(realizedPnL))}
            </span>
          </div>
        </div>

        {err && (
          <div style={{
            padding: 10, marginBottom: 12, fontSize: 12, color: "#ff453a",
            background: "rgba(255,69,58,0.08)",
            border: "1px solid rgba(255,69,58,0.3)",
            borderRadius: 6,
          }}>
            {err}
          </div>
        )}

        {/* ── action bar ────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={secondaryBtn} disabled={submitting} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={primaryBtn} disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Closing…" : "Close Position"}
          </button>
        </div>
      </div>
    </div>
  );
}
