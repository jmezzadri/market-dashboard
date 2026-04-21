// PositionEditor — modal for add / edit / delete of a single position.
//
// 5-field model (post-Items 14/15/19 rewrite):
//   • account        — free-form label, find-or-create (datalist hints)
//   • ticker         — uppercase, locked in edit mode
//   • purchase_date  — optional ISO date
//   • shares         — numeric, supports fractional (e.g. 2.5)
//   • cost_per_share — numeric
//
// Everything else (price, value, sector, beta) is populated by the scanner
// on the next refresh — the user doesn't type it. `value` is seeded at save
// time as `shares * cost_per_share` so the row renders a plausible number
// until the live price arrives; it gets overwritten by the scan pipeline.
//
// Decimal-entry fix (Bug #19 root cause):
//   Earlier versions kept shares/avgCost as Number state. Typing "2." got
//   parsed to 2, then String(2) = "2" was fed back into the input on next
//   render — the trailing dot was stripped mid-type. Now each numeric
//   input keeps its own *string* state (shares_str, costPerShare_str); we
//   only parse to a Number at save time.
//
// Modes
//   "add"  — `existing` prop is null. User picks account + types ticker.
//   "edit" — `existing` prop is a position object (with id). Account +
//            ticker are locked (delete+re-add to move between accounts).
//            A DELETE button is shown.

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// ── formatting helpers ─────────────────────────────────────────────────────
const fmt$ = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (v) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

// Parse "1,750.25" / "$1,750" / "" → Number or null. Accepts commas and a
// leading $ because that's what copy/paste from brokerage statements looks
// like. Trailing dots and empty strings return null, not NaN.
function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (s === "" || s === "." || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Initial display string for numeric fields in edit mode. We want to echo
// whatever numeric Supabase gave us without flattening it, but we also don't
// want to render "12.0000000001" for a value that was actually 12 — so we
// rely on JS's default Number→String which does the sensible thing.
const initNumStr = (n) => (n == null || !Number.isFinite(Number(n)) ? "" : String(n));

// ── styles ─────────────────────────────────────────────────────────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
const modal = {
  width: "min(500px, 94vw)",
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
  display: "block",
  fontSize: 10,
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
  fontWeight: 700,
  marginBottom: 4,
};
const input = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  color: "var(--text)",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm, 6px)",
  fontFamily: "var(--font-mono)",
  outline: "none",
  boxSizing: "border-box",
};
const inputLocked = { ...input, opacity: 0.6, cursor: "not-allowed" };
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
const dangerBtn = {
  padding: "9px 14px", fontSize: 13, color: "#ff453a",
  background: "transparent", border: "1px solid rgba(255,69,58,0.4)",
  borderRadius: "var(--radius-sm, 6px)", cursor: "pointer",
};

// ── component ──────────────────────────────────────────────────────────────
export default function PositionEditor({
  mode,            // "add" | "edit"
  existing,        // position row for edit mode
  accounts,        // [{ id, label }, ...] — datalist hints in add mode
  userId,          // current auth uid, required for insert
  onClose,
  onSaved,
  onDeleted,
}) {
  const isEdit = mode === "edit" && existing;

  // ── form state ────────────────────────────────────────────────────────────
  const existingAcctLabel = isEdit
    ? (accounts?.find((a) => a.id === existing.accountId)?.label || existing.acctLabel || "")
    : "";
  const [accountLabel, setAccountLabel] = useState(existingAcctLabel);
  const [ticker, setTicker] = useState(isEdit ? existing.ticker || "" : "");
  const [purchaseDate, setPurchaseDate] = useState(
    isEdit ? (existing.purchase_date || existing.purchaseDate || "") : ""
  );

  // Numeric inputs kept as STRINGS — sticky pattern so typing "2." doesn't
  // get stripped back to "2" on re-render. Only parseNum at save time.
  const [sharesStr, setSharesStr] = useState(isEdit ? initNumStr(existing.shares) : "");
  const [costStr, setCostStr] = useState(
    isEdit ? initNumStr(existing.avgCost ?? existing.avg_cost) : ""
  );

  // ── submit state ──────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Parsed values for validation + preview
  const shares = parseNum(sharesStr);
  const costPerShare = parseNum(costStr);
  const totalCost = shares != null && costPerShare != null ? shares * costPerShare : null;

  // Live price — pulled from the parent-enriched `existing.price` if present
  // (edit mode). In add mode we have no live price until the next scanner run,
  // so PnL preview is blank.
  const livePrice = isEdit && Number.isFinite(Number(existing.price)) ? Number(existing.price) : null;
  const currentValue = shares != null && livePrice != null ? shares * livePrice : null;
  const pnlDollars = currentValue != null && totalCost != null ? currentValue - totalCost : null;
  const pnlPct = livePrice != null && costPerShare != null && costPerShare !== 0
    ? (livePrice / costPerShare - 1) * 100 : null;

  // ── validation ────────────────────────────────────────────────────────────
  const tickerClean = ticker.trim().toUpperCase();
  const accountLabelClean = accountLabel.trim();
  const validation = useMemo(() => {
    if (!accountLabelClean) return "Account name is required.";
    if (accountLabelClean.length > 80) return "Account name is too long — max 80 chars.";
    if (!tickerClean) return "Ticker is required.";
    if (tickerClean.length > 10) return "Ticker looks too long — max 10 chars.";
    if (shares == null || !Number.isFinite(shares) || shares <= 0) {
      return "Shares must be a positive number (fractional OK, e.g. 2.5).";
    }
    if (costPerShare == null || !Number.isFinite(costPerShare) || costPerShare < 0) {
      return "Cost per share must be a non-negative number.";
    }
    // purchase_date is optional; if provided, validate as ISO date
    if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      return "Purchase date must be in YYYY-MM-DD format.";
    }
    return null;
  }, [accountLabelClean, tickerClean, shares, costPerShare, purchaseDate]);

  // Find-or-create account by label (case-insensitive dedupe).
  const resolveAccountId = async () => {
    const target = accountLabelClean;
    const match = (accounts || []).find(
      (a) => (a.label || "").trim().toLowerCase() === target.toLowerCase()
    );
    if (match) return match.id;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        label: target,
        sort_order: (accounts?.length ?? 0),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  const handleSave = async () => {
    if (validation) { setErr(validation); return; }
    setErr("");
    setSubmitting(true);
    try {
      // Seed `value` = shares * costPerShare so the row renders sensibly until
      // the next scanner refresh overwrites price with a live quote.
      const seedValue = shares * costPerShare;
      const payload = {
        ticker: tickerClean,
        name: existing?.name || tickerClean,
        shares,
        avg_cost: costPerShare,
        // price + value get rewritten by scan; seed with cost-basis pricing
        // so the UI doesn't show $0 between save and next scan.
        price: isEdit ? (existing.price ?? costPerShare) : costPerShare,
        value: isEdit ? (existing.value ?? seedValue) : seedValue,
        purchase_date: purchaseDate || null,
        // Sector, beta, analysis: preserve whatever the scanner (or a prior
        // save) already wrote; don't blank them on edit.
        sector: existing?.sector ?? null,
        beta: existing?.beta ?? null,
        analysis: existing?.analysis ?? null,
      };

      if (isEdit) {
        const { data, error } = await supabase
          .from("positions")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data);
      } else {
        const account_id = await resolveAccountId();
        const { data, error } = await supabase
          .from("positions")
          .insert({
            ...payload,
            user_id: userId,
            account_id,
            sort_order: 9999,
          })
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data);
      }
    } catch (e) {
      console.error("[PositionEditor] save failed:", e);
      // Friendlier error when the migration hasn't been applied yet.
      const msg = (e.message || "").toLowerCase().includes("purchase_date")
        ? "Database is missing the purchase_date column. Run migration 007_positions_purchase_date.sql in Supabase SQL editor."
        : (e.message || "Save failed. Try again.");
      setErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    setErr("");
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("positions")
        .delete()
        .eq("id", existing.id);
      if (error) throw error;
      onDeleted?.(existing.id);
    } catch (e) {
      console.error("[PositionEditor] delete failed:", e);
      setErr(e.message || "Delete failed. Try again.");
      setSubmitting(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              {isEdit ? "EDIT POSITION" : "ADD POSITION"}
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "2px 0 0" }}>
              {isEdit ? `${existing.ticker} · ${existing.acctLabel || ""}` : "New holding"}
            </h3>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
            Close
          </button>
        </div>

        {/* Row 1: Account + Ticker */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>ACCOUNT</label>
            {isEdit ? (
              <input style={inputLocked} value={existing.acctLabel || existingAcctLabel} readOnly />
            ) : (
              <>
                <input
                  style={input}
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  list="position-editor-account-suggestions"
                  placeholder="Taxable, 401(k), Roth IRA, Ethan 529…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="position-editor-account-suggestions">
                  {(accounts || []).map((a) => (
                    <option key={a.id} value={a.label} />
                  ))}
                  {/* Generic hints if the user has no accounts yet */}
                  {(accounts || []).length === 0 && (
                    <>
                      <option value="Taxable" />
                      <option value="401(k)" />
                      <option value="IRA" />
                      <option value="Roth IRA" />
                      <option value="529" />
                    </>
                  )}
                </datalist>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  Type any name — e.g. "Ethan 529", "Joint Taxable". New names are created automatically.
                </div>
              </>
            )}
          </div>
          <div>
            <label style={label}>TICKER</label>
            <input
              style={isEdit ? inputLocked : input}
              value={ticker}
              readOnly={isEdit}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Row 2: Purchase date (optional) */}
        <div style={{ marginBottom: 12 }}>
          <label style={label}>PURCHASE DATE (OPTIONAL)</label>
          <input
            style={input}
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            Used for hold-period / tax-lot display later. Leave blank if you don't remember.
          </div>
        </div>

        {/* Row 3: Shares + Cost/share */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 6 }}>
          <div>
            <label style={label}>SHARES</label>
            <input
              style={input}
              value={sharesStr}
              onChange={(e) => setSharesStr(e.target.value)}
              inputMode="decimal"
              placeholder="2.5"
              autoComplete="off"
            />
          </div>
          <div>
            <label style={label}>COST / SHARE</label>
            <input
              style={input}
              value={costStr}
              onChange={(e) => setCostStr(e.target.value)}
              inputMode="decimal"
              placeholder="150.00"
              autoComplete="off"
            />
          </div>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4, marginBottom: 12 }}>
          Current price comes from the scanner after save — you don't enter it here.
        </div>

        {/* Derived summary */}
        <div style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-faint)",
          borderRadius: "var(--radius-sm, 6px)",
          padding: "10px 12px",
          marginBottom: 14,
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}>
          <div><span style={{ color: "var(--text-muted)" }}>Cost basis: </span>{fmt$(totalCost)}</div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Live price: </span>
            {livePrice != null ? fmt$(livePrice) : <span style={{ color: "var(--text-muted)" }}>—</span>}
          </div>
          <div><span style={{ color: "var(--text-muted)" }}>Current value: </span>{fmt$(currentValue)}</div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>PnL $: </span>
            <span style={{ color: pnlDollars == null ? "var(--text-muted)" : pnlDollars >= 0 ? "#30d158" : "#ff453a" }}>
              {fmt$(pnlDollars)}
            </span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={{ color: "var(--text-muted)" }}>PnL %: </span>
            <span style={{ color: pnlPct == null ? "var(--text-muted)" : pnlPct >= 0 ? "#30d158" : "#ff453a" }}>
              {fmtPct(pnlPct)}
            </span>
          </div>
        </div>

        {err && (
          <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "#ff453a", background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 6 }}>
            {err}
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {isEdit && !confirmDelete && (
              <button type="button" style={dangerBtn} disabled={submitting} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            {isEdit && confirmDelete && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#ff453a", fontFamily: "var(--font-mono)" }}>Sure?</span>
                <button type="button" style={dangerBtn} disabled={submitting} onClick={handleDelete}>
                  {submitting ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" style={secondaryBtn} disabled={submitting} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={secondaryBtn} disabled={submitting} onClick={onClose}>
              Cancel
            </button>
            <button type="button" style={primaryBtn} disabled={submitting} onClick={handleSave}>
              {submitting ? "Saving…" : (isEdit ? "Save changes" : "Add position")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
