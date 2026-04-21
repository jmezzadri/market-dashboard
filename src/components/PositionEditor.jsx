// PositionEditor — modal for add / edit / delete of a single position.
//
// Dynamic calc model
//   Canonical state : { shares, avgCost, price } — one numeric truth per field.
//   Derived         : totalCost    = shares × avgCost
//                     currentValue = shares × price
//                     pnl$         = currentValue − totalCost
//                     pnl%         = price / avgCost − 1
//   All five numeric inputs are user-editable. Editing the derived ones
//   (total cost, current value) back-solves the canonical one — e.g. typing
//   "1,750" into TOTAL COST when shares is 10 sets avgCost to 175. If shares
//   is 0/empty we can't back-solve, so we keep the derived display showing
//   the user's typed value but don't touch canonical until they fill shares.
//
// Modes
//   "add"  — `existing` prop is null. User must pick an account + type a
//            ticker. Submit inserts a new row.
//   "edit" — `existing` prop is a position object (with `id`). Account and
//            ticker are editable — changing Account resolves / creates the
//            target account and re-parents the row; changing Ticker updates
//            the same row in place (so live price/scanner data refreshes
//            on next scan). Submit updates the row. A DELETE button is
//            shown.
//
// All writes land in the Supabase `positions` table. RLS scopes to auth.uid()
// so we don't need to filter by user_id on read, but we do pass it on insert
// so the row is owned by the caller.
//
// Parent is expected to call refetchPortfolio() after a successful write —
// we call `onSaved()` / `onDeleted()` to signal that; the parent decides
// whether to refetch + close, or just close.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// ── formatting helpers ─────────────────────────────────────────────────────
const fmt$ = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (v) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

// Parse "1,750.25" / "$1,750" / "" → Number or null. We accept commas and a
// leading $ because that's what copy/paste from brokerage statements looks
// like. Anything unparseable becomes null, not NaN, so downstream math stays
// sane.
function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Format a number for input display. We deliberately DON'T format with
// commas inside the input — it fights the caret during typing. Keep it
// plain; the read-only derived row below shows the pretty version.
const inputVal = (n) => (n == null || !Number.isFinite(n) ? "" : String(n));

// ── styles ─────────────────────────────────────────────────────────────────
const backdrop = {
  // Darker backdrop so the opaque modal above it reads crisply against the
  // page content behind.
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
const modal = {
  width: "min(520px, 94vw)",
  maxHeight: "90vh",
  overflowY: "auto",
  // MUST be fully opaque — --surface / --surface-2 are translucent rgba colors,
  // and --surface-1 doesn't exist, so falling back to them makes the modal
  // unreadable over the page. --surface-solid is the opaque panel color.
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
  existing,        // position object for edit mode (carries id, accountId, ticker, shares, avgCost, price, ...)
  accounts,        // [{ id, label }, ...] — needed for add mode account picker
  userId,          // current auth uid, required for insert
  onClose,         // () => void — dismiss without saving
  onSaved,         // (savedRow) => void — fired after successful write
  onDeleted,       // (deletedId) => void — fired after successful delete (edit mode only)
}) {
  const isEdit = mode === "edit" && existing;

  // ── form state ────────────────────────────────────────────────────────────
  // Account is a FREE-FORM label (typed string), not an ID. In edit mode we
  // lock it to the existing label. In add mode the user can either pick an
  // existing account from the datalist suggestions or type a brand-new name
  // — on save we find-or-create the account row and use its id for the
  // position insert. This way the component makes no assumptions about what
  // account names make sense for any given user.
  const existingAcctLabel = isEdit
    ? (accounts?.find((a) => a.id === existing.accountId)?.label || existing.acctLabel || "")
    : "";
  const [accountLabel, setAccountLabel] = useState(existingAcctLabel);
  const [ticker, setTicker]   = useState(isEdit ? existing.ticker || "" : "");
  const [sector, setSector]   = useState(isEdit ? existing.sector || "" : "");

  // Canonical numerics
  const [shares,  setShares]  = useState(isEdit ? existing.shares  ?? null : null);
  const [avgCost, setAvgCost] = useState(isEdit ? existing.avgCost ?? null : null);
  const [price,   setPrice]   = useState(isEdit ? existing.price   ?? null : null);

  // ── Sticky input strings for the primary numeric inputs (item 35D) ───────
  // Prevents `parseNum("2.") → 2 → inputVal(2) → "2"` from stripping the
  // trailing decimal while the user is mid-keystroke. The canonical Numbers
  // still drive all downstream math; these strings only drive what the
  // input renders.
  const [sharesStr,  setSharesStr]  = useState(inputVal(isEdit ? existing.shares  ?? null : null));
  const [avgCostStr, setAvgCostStr] = useState(inputVal(isEdit ? existing.avgCost ?? null : null));

  // Mirror canonical → sticky whenever the Number drifts from the string's
  // parsed value (e.g. back-solve via onChangeTotalCost / onChangeCurrentValue).
  // The equality check ensures mid-keystroke typing ("2.") isn't clobbered
  // because parseNum("2.") === 2 === avgCost.
  useEffect(() => {
    if (parseNum(sharesStr) !== shares) setSharesStr(inputVal(shares));
  }, [shares]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (parseNum(avgCostStr) !== avgCost) setAvgCostStr(inputVal(avgCost));
  }, [avgCost]); // eslint-disable-line react-hooks/exhaustive-deps

  // Item 36: optional acquisition date. Used by PositionsTable's Holding
  // Period column and (future) Annualized PnL column. Stored as ISO YYYY-MM-DD
  // in positions.purchase_date. NULL for rows the user skipped.
  const [purchaseDate, setPurchaseDate] = useState(
    isEdit ? (existing.purchaseDate || existing.purchase_date || "") : ""
  );

  // "Sticky" display strings for the two derived inputs — so the user's
  // typing doesn't get clobbered while shares is still empty.
  const [totalCostStr,    setTotalCostStr]    = useState("");
  const [currentValueStr, setCurrentValueStr] = useState("");

  // Whenever the canonical triplet changes, resync the derived input strings
  // (unless the user is actively typing in one — we detect that by whether
  // the string is "stale", i.e. no longer matches the would-be derived value).
  useEffect(() => {
    if (shares != null && avgCost != null) {
      setTotalCostStr(String(shares * avgCost));
    }
  }, [shares, avgCost]);
  useEffect(() => {
    if (shares != null && price != null) {
      setCurrentValueStr(String(shares * price));
    }
  }, [shares, price]);

  // Derived display-only values
  const totalCost    = shares != null && avgCost != null ? shares * avgCost : null;
  const currentValue = shares != null && price   != null ? shares * price   : null;
  const pnlDollars   = currentValue != null && totalCost != null ? currentValue - totalCost : null;
  const pnlPct       = price != null && avgCost != null && avgCost !== 0
    ? (price / avgCost - 1) * 100 : null;

  // ── input handlers ────────────────────────────────────────────────────────
  const onChangeShares = (raw) => {
    setSharesStr(raw);
    setShares(parseNum(raw));
  };

  const onChangeAvgCost = (raw) => {
    setAvgCostStr(raw);
    setAvgCost(parseNum(raw));
  };

  const onChangeTotalCost = (raw) => {
    setTotalCostStr(raw);
    const total = parseNum(raw);
    if (total == null) return;          // let the user keep typing
    if (shares != null && shares > 0) {
      setAvgCost(total / shares);       // back-solve canonical
    }
    // if shares is empty, hold the typed value in the sticky string; the
    // useEffect above won't overwrite it until shares+avgCost are both set
  };

  const onChangePrice = (raw) => {
    const n = parseNum(raw);
    setPrice(n);
  };

  const onChangeCurrentValue = (raw) => {
    setCurrentValueStr(raw);
    const val = parseNum(raw);
    if (val == null) return;
    if (shares != null && shares > 0) {
      setPrice(val / shares);
    }
  };

  // ── submit state ──────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Validation — we enforce the same minimum bar as the CSV onboarding path:
  // account + ticker + either (value) or (shares AND price). That's what
  // `value` actually is in the DB, so compute it from whichever pair the
  // user gave us.
  const tickerClean = ticker.trim().toUpperCase();
  const accountLabelClean = accountLabel.trim();
  const validation = useMemo(() => {
    if (!accountLabelClean) return "Account name is required.";
    if (accountLabelClean.length > 80) return "Account name is too long — max 80 chars.";
    if (!tickerClean)   return "Ticker is required.";
    if (tickerClean.length > 10) return "Ticker looks too long — max 10 chars.";
    // We need enough to compute `value`:
    const haveValue = currentValue != null && Number.isFinite(currentValue);
    if (!haveValue) {
      return "Enter Shares and Current Value.";
    }
    // Purchase date is optional; if the user typed one, it must be ISO.
    if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      return "Purchase date must be YYYY-MM-DD (or leave it blank).";
    }
    return null;
  }, [accountLabelClean, tickerClean, currentValue, purchaseDate]);

  // Resolve the typed account label to an account_id. If no account with
  // that exact label exists, create one and return its id. Case-insensitive
  // match against existing accounts so "Roth IRA" and "roth ira" don't
  // produce duplicate rows.
  const resolveAccountId = async () => {
    const target = accountLabelClean;
    const match = (accounts || []).find(
      (a) => (a.label || "").trim().toLowerCase() === target.toLowerCase()
    );
    if (match) return match.id;
    // Not found — create a new account row. sort_order = current count so it
    // lands at the end of the list; the user can reorder elsewhere.
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        label:   target,
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
      const payload = {
        ticker:   tickerClean,
        name:     existing?.name || tickerClean,
        shares:   shares,
        price:    price,
        avg_cost: avgCost,
        value:    currentValue,
        sector:   sector || existing?.sector || null,
        beta:     existing?.beta ?? null,
        analysis: existing?.analysis ?? null,
        // Item 36: empty string → NULL so we don't insert a garbage date.
        purchase_date: purchaseDate || null,
      };

      if (isEdit) {
        // 35C: Account is now editable in edit mode. Resolve (or create)
        // the target account so the row moves if the user re-routed it.
        const account_id = await resolveAccountId();
        const { data, error } = await supabase
          .from("positions")
          .update({ ...payload, account_id })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data);
      } else {
        // Find-or-create the account by label, then insert the position.
        const account_id = await resolveAccountId();
        const { data, error } = await supabase
          .from("positions")
          .insert({
            ...payload,
            user_id:    userId,
            account_id,
            sort_order: 9999,   // push to end; re-sort is a separate concern
          })
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data);
      }
    } catch (e) {
      console.error("[PositionEditor] save failed:", e);
      setErr(e.message || "Save failed. Try again.");
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

        {/* Account + Ticker row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>ACCOUNT</label>
            <input
              style={input}
              value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)}
              list="position-editor-account-suggestions"
              placeholder="Brokerage, Roth IRA, 401(k)…"
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id="position-editor-account-suggestions">
              {(accounts || []).map((a) => (
                <option key={a.id} value={a.label} />
              ))}
            </datalist>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {isEdit
                ? "Rename or re-route to another account — we'll create it if it doesn't exist."
                : "Type any name. Pick from your existing accounts or enter a new one — it'll be created."}
            </div>
          </div>
          <div>
            <label style={label}>TICKER</label>
            <input
              style={input}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
            />
          </div>
        </div>

        {/* Sector + Purchase Date row — both optional */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>SECTOR (optional)</label>
            <input
              style={input}
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Tech, HY Bonds, Cash, Intl Equity…"
            />
          </div>
          <div>
            <label style={label}>PURCHASE DATE (optional)</label>
            <input
              style={input}
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              Powers Holding Period & future Annualized PnL. Leave blank if you'd rather skip.
            </div>
          </div>
        </div>

        {/* Numeric block */}
        <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 14, marginTop: 4, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 10 }}>
            POSITION MATH · COST/SHARE ↔ TOTAL COST AUTO-CALCULATE
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={label}>SHARES</label>
              <input
                style={input}
                value={sharesStr}
                onChange={(e) => onChangeShares(e.target.value)}
                inputMode="decimal"
                placeholder="10"
              />
            </div>
          </div>

          {/* Cost pair */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={label}>COST / SHARE</label>
              <input
                style={input}
                value={avgCostStr}
                onChange={(e) => onChangeAvgCost(e.target.value)}
                inputMode="decimal"
                placeholder="150.00"
              />
            </div>
            <div>
              <label style={label}>TOTAL COST (= SHARES × COST/SHARE)</label>
              <input
                style={input}
                value={
                  // if both canonicals are set, show derived; else show sticky string
                  shares != null && avgCost != null
                    ? String(shares * avgCost)
                    : totalCostStr
                }
                onChange={(e) => onChangeTotalCost(e.target.value)}
                inputMode="decimal"
                placeholder="1500.00"
              />
            </div>
          </div>

          {/* Current value — full width. No price/share input: we back-solve
              price = value / shares on save. The platform's market data layer
              refreshes the live price after save, so there's no reason to ask
              the user for it manually. */}
          <div style={{ marginBottom: 6 }}>
            <label style={label}>CURRENT VALUE</label>
            <input
              style={input}
              value={
                shares != null && price != null
                  ? String(shares * price)
                  : currentValueStr
              }
              onChange={(e) => onChangeCurrentValue(e.target.value)}
              inputMode="decimal"
              placeholder="1750.00"
            />
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              Enter today's market value of the holding. Price/share is derived automatically.
            </div>
          </div>
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
          <div><span style={{ color: "var(--text-muted)" }}>Current value: </span>{fmt$(currentValue)}</div>
          <div><span style={{ color: "var(--text-muted)" }}>Implied price/share: </span>{fmt$(price)}</div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>PnL $: </span>
            <span style={{ color: pnlDollars == null ? "var(--text-muted)" : pnlDollars >= 0 ? "#30d158" : "#ff453a" }}>
              {fmt$(pnlDollars)}
            </span>
          </div>
          <div>
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
