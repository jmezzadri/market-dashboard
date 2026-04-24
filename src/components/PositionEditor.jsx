// PositionEditor — modal for add / edit / delete of a single position.
//
// Asset-class aware (Item 41)
// ───────────────────────────
// We store up to five classes in public.positions:
//   stock    — the original equity/ETF case. quantity=shares, price=per-share.
//   cash     — quantity=amount, price=1, avg_cost=1, value=amount. See 35E.
//   option   — long/short call/put. We store price & avg_cost PER-CONTRACT
//              (multiplier baked in) so the universal `value = quantity × price`
//              formula in PositionsTable keeps working. `manual_price` holds
//              the raw per-share mark so the editor can round-trip it cleanly.
//              Short positions are stored with NEGATIVE quantity.
//   bond     — quantity=bonds, price=per-bond mark (no feed → manual), avg_cost=per-bond.
//   crypto   — quantity=units, price=per-unit mark (V1: manual; Joe's 3x/day
//              pricing job is wiring up a live feed in a sibling session),
//              avg_cost=per-unit.
//
// For options, bonds, and (for now) crypto the scanner fan-out at save time
// is skipped — those classes either have no UW scanner symbol (bonds),
// can't be priced by UW's equity scanner (options), or have a different
// pricing path coming (crypto). Stock class is the only one we fire
// `/api/scan-ticker` for in this component.
//
// Dynamic calc model (stock mode, unchanged)
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

// ── class helpers ──────────────────────────────────────────────────────────
const CLASSES = [
  { id: "stock",  label: "Stock / ETF" },
  { id: "cash",   label: "Cash" },
  { id: "option", label: "Option" },
  { id: "bond",   label: "Bond" },
  { id: "crypto", label: "Crypto" },
];

// Infer asset class from an existing row. Rows written before the 012
// migration didn't carry asset_class; back-heal ran for CASH, everything
// else defaults to stock.
function inferAssetClass(existing) {
  if (!existing) return "stock";
  if (existing.assetClass) return existing.assetClass;
  const t = String(existing.ticker || "").trim().toUpperCase();
  if (t === "CASH") return "cash";
  return "stock";
}

// ── component ──────────────────────────────────────────────────────────────
export default function PositionEditor({
  mode,
  existing,
  accounts,
  userId,
  onClose,
  onSaved,
  onDeleted,
}) {
  const isEdit = mode === "edit" && existing;

  // ── account / ticker / sector / date (shared across classes) ──────────────
  const existingAcctLabel = isEdit
    ? (accounts?.find((a) => a.id === existing.accountId)?.label || existing.acctLabel || "")
    : "";
  const [accountLabel, setAccountLabel] = useState(existingAcctLabel);
  const [ticker, setTicker]   = useState(isEdit ? existing.ticker || "" : "");
  const [sector, setSector]   = useState(isEdit ? existing.sector || "" : "");
  const [purchaseDate, setPurchaseDate] = useState(
    isEdit ? (existing.purchaseDate || existing.purchase_date || "") : ""
  );

  // Asset class — drives which field block renders below.
  const [assetClass, setAssetClass] = useState(inferAssetClass(existing));

  // ── class-agnostic canonical numerics (stock/bond/crypto/cash amount) ────
  // For cash: shares = dollar amount, others unused.
  // For stock/bond/crypto: shares = quantity, avgCost = per-unit cost,
  // price = per-unit mark.
  const _existingTickerUC = isEdit ? String(existing.ticker || "").trim().toUpperCase() : "";
  const _isExistingCash   = _existingTickerUC === "CASH" || (isEdit && existing.assetClass === "cash");
  const _initAmount       = _isExistingCash
    ? (existing?.value ?? existing?.quantity ?? null)
    : (isEdit ? existing.quantity ?? null : null);

  const [shares,  setShares]  = useState(_initAmount);
  const [avgCost, setAvgCost] = useState(isEdit ? existing.avgCost ?? null : null);
  const [price,   setPrice]   = useState(isEdit ? existing.price   ?? null : null);

  const [sharesStr,  setSharesStr]  = useState(inputVal(_initAmount));
  const [avgCostStr, setAvgCostStr] = useState(inputVal(isEdit ? existing.avgCost ?? null : null));

  useEffect(() => {
    if (parseNum(sharesStr) !== shares) setSharesStr(inputVal(shares));
  }, [shares]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (parseNum(avgCostStr) !== avgCost) setAvgCostStr(inputVal(avgCost));
  }, [avgCost]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sticky strings for the stock-mode derived inputs.
  const [totalCostStr,    setTotalCostStr]    = useState("");
  const [currentValueStr, setCurrentValueStr] = useState("");
  // Bug #1019 — stocks can be flagged as "manually priced" (mutual fund,
  // untracked asset, etc.) so the user enters today's NAV directly instead
  // of fumbling with a derived price. Back-compat: an existing stock row
  // with manual_price already set loads this toggle on by default.
  const [manualMarkStock, setManualMarkStock] = useState(
    isEdit && (existing?.assetClass === "stock" || !existing?.assetClass) && existing?.manualPrice != null
  );
  const [markPerShareStr, setMarkPerShareStr] = useState(
    isEdit && existing?.manualPrice != null ? String(existing.manualPrice)
      : isEdit && existing?.price != null ? String(existing.price)
      : ""
  );

  // Migration 017 — "as uploaded" price, preserved across scanner updates
  // and manual overrides. Drives the "Revert to uploaded price" button
  // below the NAV input. Falls back to avg_cost for rows pre-dating
  // migration 017 (backfill covers most, this is belt-and-suspenders).
  const revertTargetPrice = (
    existing?.ingestedPrice != null ? Number(existing.ingestedPrice)
    : existing?.avgCost != null     ? Number(existing.avgCost)
    : null
  );
  const hasRevertTarget = revertTargetPrice != null && Number.isFinite(revertTargetPrice);
  // Show the revert affordance only when the on-screen mark actually differs
  // from the revert target (within a cent tolerance), so a freshly-imported
  // fund with no override doesn't display a redundant "revert" button.
  const markDiffersFromUploaded = (
    hasRevertTarget
    && price != null
    && Number.isFinite(price)
    && Math.abs(price - revertTargetPrice) > 0.005
  );
  const revertToUploadedPrice = () => {
    if (!hasRevertTarget) return;
    const v = revertTargetPrice;
    setPrice(v);
    setMarkPerShareStr(String(v));
    if (shares != null && shares > 0) setCurrentValueStr(String(shares * v));
  };

  useEffect(() => {
    if (shares != null && avgCost != null) setTotalCostStr(String(shares * avgCost));
  }, [shares, avgCost]);
  useEffect(() => {
    if (shares != null && price != null) setCurrentValueStr(String(shares * price));
  }, [shares, price]);

  // ── option-specific state ────────────────────────────────────────────────
  // Stored per-contract in DB, but we ask the user for per-SHARE premium
  // and multiplier so the mental model matches how options are quoted
  // ("$2.50 premium × 100 multiplier × 3 contracts = $750 cost basis").
  const _initMultiplier = isEdit && existing.multiplier != null ? Number(existing.multiplier) : 100;
  const _initStrike     = isEdit && existing.strike     != null ? Number(existing.strike)     : null;
  const _initExpir      = isEdit ? (existing.expiration || "") : "";
  const _initDirection  = isEdit && existing.direction       ? existing.direction       : "long";
  const _initContractTp = isEdit && existing.contractType    ? existing.contractType    : "call";
  // Entry premium per share = avgCost (per-contract) / multiplier.
  const _initEntryPrem  = (isEdit && existing.avgCost != null && _initMultiplier)
    ? Number(existing.avgCost) / _initMultiplier : null;
  // Mark per share = manual_price (raw, as the user typed it).
  const _initMarkPerShare = isEdit && existing.manualPrice != null
    ? Number(existing.manualPrice)
    // Back-compat: if manual_price is null but price is set, derive from price/multiplier.
    : (isEdit && existing.price != null && _initMultiplier ? Number(existing.price) / _initMultiplier : null);
  // Contract count (always positive in the UI; sign encoded via direction).
  const _initContracts = _isExistingCash
    ? null
    : (isEdit && assetClass === "option" && existing.quantity != null
       ? Math.abs(Number(existing.quantity))
       : null);

  const [contractType, setContractType] = useState(_initContractTp); // call | put
  const [direction,    setDirection]    = useState(_initDirection);  // long | short
  const [strikeStr,    setStrikeStr]    = useState(inputVal(_initStrike));
  const [strike,       setStrike]       = useState(_initStrike);
  const [expiration,   setExpiration]   = useState(_initExpir);
  const [multiplierStr, setMultiplierStr] = useState(inputVal(_initMultiplier));
  const [multiplier,    setMultiplier]    = useState(_initMultiplier);
  const [contractsStr, setContractsStr] = useState(inputVal(_initContracts));
  const [contracts,    setContracts]    = useState(_initContracts);
  const [entryPremStr, setEntryPremStr] = useState(inputVal(_initEntryPrem));
  const [entryPrem,    setEntryPrem]    = useState(_initEntryPrem);
  const [markPSStr,    setMarkPSStr]    = useState(inputVal(_initMarkPerShare));
  const [markPS,       setMarkPS]       = useState(_initMarkPerShare);

  // ── submit state ──────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Derived display values (stock mode)
  const totalCost    = shares != null && avgCost != null ? shares * avgCost : null;
  const currentValue = shares != null && price   != null ? shares * price   : null;
  const pnlDollars   = currentValue != null && totalCost != null ? currentValue - totalCost : null;
  const pnlPct       = price != null && avgCost != null && avgCost !== 0
    ? (price / avgCost - 1) * 100 : null;

  // Derived display values (option mode)
  const optSignedContracts = contracts != null ? (direction === "short" ? -contracts : contracts) : null;
  const optCostBasis       = (contracts != null && entryPrem != null && multiplier != null)
    ? optSignedContracts * entryPrem * multiplier : null;
  const optCurrentValue    = (contracts != null && markPS    != null && multiplier != null)
    ? optSignedContracts * markPS * multiplier : null;
  const optPnl$            = (optCurrentValue != null && optCostBasis != null)
    ? optCurrentValue - optCostBasis : null;

  // Derived display values (bond/crypto — same shape as stock)
  const genCostBasis    = (shares != null && avgCost != null) ? shares * avgCost : null;
  const genCurrentValue = (shares != null && price   != null) ? shares * price   : null;
  const genPnl$         = (genCurrentValue != null && genCostBasis != null)
    ? genCurrentValue - genCostBasis : null;

  // ── input handlers (stock) ────────────────────────────────────────────────
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
    if (total == null) return;
    if (shares != null && shares > 0) setAvgCost(total / shares);
  };
  const onChangeCurrentValue = (raw) => {
    setCurrentValueStr(raw);
    const val = parseNum(raw);
    if (val == null) return;
    if (shares != null && shares > 0) setPrice(val / shares);
  };
  // Bug #1019 — when the user is managing a mutual-fund-style position,
  // they paste today's NAV directly and we derive Current Value from it
  // (the inverse of the default stock flow). Keep Current Value in sync
  // so the summary below stays consistent regardless of entry direction.
  const onChangeMarkPerShare = (raw) => {
    setMarkPerShareStr(raw);
    const n = parseNum(raw);
    if (n == null) return;
    setPrice(n);
    if (shares != null && shares > 0) setCurrentValueStr(String(shares * n));
  };

  // ── validation ────────────────────────────────────────────────────────────
  const tickerClean = ticker.trim().toUpperCase();
  const accountLabelClean = accountLabel.trim();

  const validation = useMemo(() => {
    if (!accountLabelClean) return "Account name is required.";
    if (accountLabelClean.length > 80) return "Account name is too long — max 80 chars.";
    if (!tickerClean)   return "Ticker / symbol is required.";
    if (tickerClean.length > 24) return "Ticker looks too long — max 24 chars.";
    if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      return "Purchase date must be YYYY-MM-DD (or leave it blank).";
    }

    if (assetClass === "cash") {
      if (shares == null || !Number.isFinite(shares)) return "Enter a dollar amount.";
      if (shares === 0) return "Amount can't be zero — use Delete to remove a position.";
      return null;
    }
    if (assetClass === "option") {
      if (!contractType) return "Pick Call or Put.";
      if (!direction)    return "Pick Long or Short.";
      if (strike == null || strike <= 0) return "Strike must be a positive number.";
      if (!expiration || !/^\d{4}-\d{2}-\d{2}$/.test(expiration)) return "Expiration must be YYYY-MM-DD.";
      if (multiplier == null || multiplier <= 0) return "Multiplier must be a positive integer (usually 100).";
      if (contracts == null || contracts <= 0) return "Enter the number of contracts (positive — Short is set via Direction).";
      if (entryPrem == null || entryPrem < 0) return "Enter the entry premium per share.";
      if (markPS == null || markPS < 0) return "Enter a current mark per share (manual).";
      return null;
    }
    // bond / crypto / stock — same minimum bar: qty + price
    if (shares == null || shares === 0) return "Enter quantity.";
    if (price == null || !Number.isFinite(price)) {
      return assetClass === "stock"
        ? "Enter Shares and Current Value."
        : "Enter a current price (manual for now).";
    }
    if (avgCost == null || !Number.isFinite(avgCost)) return "Enter a cost basis (per unit).";
    return null;
  }, [
    assetClass, accountLabelClean, tickerClean, purchaseDate,
    shares, avgCost, price,
    contractType, direction, strike, expiration, multiplier, contracts, entryPrem, markPS,
  ]);

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
        label:   target,
        sort_order: (accounts?.length ?? 0),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (validation) { setErr(validation); return; }
    setErr("");
    setSubmitting(true);
    try {
      // Build a class-specific payload. All classes round-trip the universal
      // `value = quantity × price` formula so PositionsTable math stays the
      // same across the board.
      let payload;
      if (assetClass === "cash") {
        payload = {
          ticker:    "CASH",
          name:      "CASH",
          quantity:  shares,
          price:     1,
          avg_cost:  1,
          value:     shares,
          sector:    "Cash",
          beta:      0,
          analysis:  existing?.analysis ?? null,
          purchase_date: purchaseDate || null,
          asset_class:   "cash",
          contract_type: null,
          direction:     null,
          strike:        null,
          expiration:    null,
          multiplier:    null,
          manual_price:  null,
          ingested_price: existing?.ingestedPrice ?? 1,
        };
      } else if (assetClass === "option") {
        // Multiplier is baked into stored price + avg_cost (per-contract)
        // so value = quantity × price keeps working. manual_price stores
        // the raw per-share mark so the editor can round-trip cleanly.
        const signedQty   = direction === "short" ? -contracts : contracts;
        const pricePerCt  = markPS * multiplier;
        const avgPerCt    = entryPrem * multiplier;
        payload = {
          ticker:    tickerClean,
          name:      existing?.name || tickerClean,
          quantity:  signedQty,
          price:     pricePerCt,
          avg_cost:  avgPerCt,
          value:     signedQty * pricePerCt,
          sector:    sector || "Options",
          beta:      existing?.beta ?? null,
          analysis:  existing?.analysis ?? null,
          purchase_date: purchaseDate || null,
          asset_class:   "option",
          contract_type: contractType,
          direction,
          strike,
          expiration,
          multiplier,
          manual_price:  markPS,
          ingested_price: existing?.ingestedPrice ?? pricePerCt,
        };
      } else if (assetClass === "bond") {
        // Per-bond convention: quantity = bond count, price = per-bond mark.
        payload = {
          ticker:    tickerClean,
          name:      existing?.name || tickerClean,
          quantity:  shares,
          price,
          avg_cost:  avgCost,
          value:     shares * price,
          sector:    sector || "Bonds",
          beta:      existing?.beta ?? null,
          analysis:  existing?.analysis ?? null,
          purchase_date: purchaseDate || null,
          asset_class:   "bond",
          contract_type: null,
          direction:     null,
          strike:        null,
          expiration:    null,
          multiplier:    null,
          manual_price:  price, // manual mark lives in the price column for bonds
          ingested_price: existing?.ingestedPrice ?? price,
        };
      } else if (assetClass === "crypto") {
        payload = {
          ticker:    tickerClean,
          name:      existing?.name || tickerClean,
          quantity:  shares,
          price,
          avg_cost:  avgCost,
          value:     shares * price,
          sector:    sector || "Crypto",
          beta:      existing?.beta ?? null,
          analysis:  existing?.analysis ?? null,
          purchase_date: purchaseDate || null,
          asset_class:   "crypto",
          contract_type: null,
          direction:     null,
          strike:        null,
          expiration:    null,
          multiplier:    null,
          manual_price:  price, // V1: user-entered; Joe's sibling session will overwrite
          ingested_price: existing?.ingestedPrice ?? price,
        };
      } else {
        // stock / ETF — manual_price is populated iff the user flagged this
        // as a manually-priced position (mutual fund / untracked asset),
        // see bug #1019. Downstream can treat `manual_price IS NOT NULL`
        // as "skip any live-price overlay, this NAV was set by hand".
        payload = {
          ticker:    tickerClean,
          name:      existing?.name || tickerClean,
          quantity:  shares,
          price,
          avg_cost:  avgCost,
          value:     currentValue,
          sector:    sector || existing?.sector || null,
          beta:      existing?.beta ?? null,
          analysis:  existing?.analysis ?? null,
          purchase_date: purchaseDate || null,
          asset_class:   "stock",
          contract_type: null,
          direction:     null,
          strike:        null,
          expiration:    null,
          multiplier:    null,
          manual_price:  manualMarkStock ? price : null,
          // Mig 017 — preserve "as uploaded" price so Revert always has a target.
          // New inserts: seed from avg_cost (which equals price on fresh seed).
          // Edits: preserve whatever the row already had.
          ingested_price: existing?.ingestedPrice ?? (avgCost ?? price),
        };
      }

      let savedRow;
      if (isEdit) {
        const account_id = await resolveAccountId();
        const { data, error } = await supabase
          .from("positions")
          .update({ ...payload, account_id })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        savedRow = data;
      } else {
        const account_id = await resolveAccountId();
        const { data, error } = await supabase
          .from("positions")
          .insert({
            ...payload,
            user_id:    userId,
            account_id,
            sort_order: 9999,
          })
          .select()
          .single();
        if (error) throw error;
        savedRow = data;
      }

      // Scanner fan-out — stock class only. Options/bonds have no UW path
      // and crypto gets its price from the sibling 3x/day pricing session.
      if (assetClass === "stock") {
        try {
          const { data: sessData } = await supabase.auth.getSession();
          const token = sessData?.session?.access_token;
          if (token) {
            await fetch("/api/scan-ticker", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ ticker: tickerClean }),
            });
          }
        } catch (scanErr) {
          // eslint-disable-next-line no-console
          console.warn("[PositionEditor] scan-ticker best-effort failed:", scanErr);
        }
      }

      onSaved?.(savedRow);
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

        {/* Asset class picker */}
        <div style={{ marginBottom: 12 }}>
          <label style={label}>ASSET CLASS</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CLASSES.map((c) => {
              const active = assetClass === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setAssetClass(c.id);
                    // CASH shortcut: auto-set the ticker so the cash branch
                    // picks it up even if the user hadn't typed anything.
                    if (c.id === "cash") setTicker("CASH");
                    if (c.id !== "cash" && tickerClean === "CASH") setTicker("");
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    fontWeight: active ? 700 : 500,
                    color: active ? "#fff" : "var(--text-muted)",
                    background: active ? "var(--accent)" : "transparent",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm, 6px)",
                    cursor: "pointer",
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
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
          </div>
          <div>
            <label style={label}>
              {assetClass === "option" ? "UNDERLYING" :
               assetClass === "bond"   ? "SYMBOL / CUSIP" :
               assetClass === "crypto" ? "SYMBOL" :
               assetClass === "cash"   ? "LABEL" :
               "TICKER"}
            </label>
            <input
              style={input}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder={
                assetClass === "option" ? "AAPL" :
                assetClass === "bond"   ? "TLT or 912810SZ9" :
                assetClass === "crypto" ? "BTC" :
                assetClass === "cash"   ? "CASH" :
                "AAPL"
              }
            />
          </div>
        </div>

        {/* Sector + Purchase Date — hidden for CASH */}
        {assetClass !== "cash" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>SECTOR (optional)</label>
              <input
                style={input}
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder={
                  assetClass === "option" ? "Options" :
                  assetClass === "bond"   ? "Treasuries, HY Credit…" :
                  assetClass === "crypto" ? "Crypto" :
                  "Tech, HY Bonds, Intl Equity…"
                }
              />
            </div>
            <div>
              <label style={label}>
                {assetClass === "option" ? "ENTRY DATE (optional)" : "PURCHASE DATE (optional)"}
              </label>
              <input
                style={input}
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── STOCK / ETF block ──────────────────────────────────────────── */}
        {assetClass === "stock" && (
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
                  value={shares != null && avgCost != null ? String(shares * avgCost) : totalCostStr}
                  onChange={(e) => onChangeTotalCost(e.target.value)}
                  inputMode="decimal"
                  placeholder="1500.00"
                />
              </div>
            </div>

            {/* Bug #1019 — manual-NAV toggle for mutual funds + untracked
                assets that don't show up in the live price feed. When on,
                the user types today's NAV and Current Value is derived;
                when off, the original behaviour (edit Current Value, NAV
                is derived) is preserved. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={manualMarkStock}
                onChange={(e) => setManualMarkStock(e.target.checked)}
              />
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-2)", letterSpacing: "0.04em" }}>
                MANUALLY PRICED (mutual fund, untracked asset)
              </span>
            </label>

            {manualMarkStock ? (
              <div style={{ marginBottom: 6 }}>
                <label style={label}>CURRENT NAV / MARK PER SHARE</label>
                <input
                  style={input}
                  value={markPerShareStr}
                  onChange={(e) => onChangeMarkPerShare(e.target.value)}
                  inputMode="decimal"
                  placeholder="82.17"
                />
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  Paste today\'s NAV from Fidelity / Vanguard / your broker.
                  Current value and PnL are derived as shares × NAV.
                </div>
                {hasRevertTarget && (
                  <div style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "6px 10px",
                    background: markDiffersFromUploaded ? "rgba(251, 191, 36, 0.08)" : "var(--surface-2)",
                    border: markDiffersFromUploaded ? "1px solid rgba(251, 191, 36, 0.45)" : "1px solid var(--border)",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}>
                    <span style={{ color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      As uploaded
                    </span>
                    <span style={{ color: "var(--text)", fontWeight: 700 }}>
                      ${Number(revertTargetPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {markDiffersFromUploaded ? (
                      <button
                        type="button"
                        onClick={revertToUploadedPrice}
                        style={{
                          marginLeft: "auto",
                          background: "transparent",
                          border: "1px solid #B8860B",
                          borderRadius: 5,
                          padding: "4px 10px",
                          color: "#B8860B",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                        title="Replace the current NAV with the price from your last CSV import / broker upload."
                      >
                        ⟲ Revert to uploaded
                      </button>
                    ) : (
                      <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
                        current NAV matches upload
                      </span>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 10 }}>
                  <label style={label}>CURRENT VALUE (= SHARES × NAV)</label>
                  <input
                    style={{ ...input, background: "var(--surface-2)", color: "var(--text-muted)" }}
                    value={shares != null && price != null ? String(shares * price) : currentValueStr}
                    readOnly
                    inputMode="decimal"
                  />
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 6 }}>
                <label style={label}>CURRENT VALUE</label>
                <input
                  style={input}
                  value={shares != null && price != null ? String(shares * price) : currentValueStr}
                  onChange={(e) => onChangeCurrentValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="1750.00"
                />
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  Enter today\'s market value of the holding. Price/share is derived automatically.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CASH block ────────────────────────────────────────────────── */}
        {assetClass === "cash" && (
          <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 14, marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 10 }}>
              CASH BALANCE
            </div>
            <div>
              <label style={label}>AMOUNT ($)</label>
              <input
                style={input}
                value={sharesStr}
                onChange={(e) => onChangeShares(e.target.value)}
                inputMode="decimal"
                placeholder="40000"
              />
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                Cash is an account balance. Enter the dollar amount — we pin price to $1
                so your portfolio math stays consistent. A negative amount represents a margin debit.
              </div>
            </div>
          </div>
        )}

        {/* ── OPTION block ──────────────────────────────────────────────── */}
        {assetClass === "option" && (
          <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 14, marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 10 }}>
              CONTRACT SPEC · DIRECTION / TYPE / STRIKE / EXPIRY
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>DIRECTION</label>
                <select
                  style={input}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
              <div>
                <label style={label}>TYPE</label>
                <select
                  style={input}
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                >
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>STRIKE</label>
                <input
                  style={input}
                  value={strikeStr}
                  onChange={(e) => { setStrikeStr(e.target.value); setStrike(parseNum(e.target.value)); }}
                  inputMode="decimal"
                  placeholder="250.00"
                />
              </div>
              <div>
                <label style={label}>EXPIRATION</label>
                <input
                  style={input}
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>CONTRACTS</label>
                <input
                  style={input}
                  value={contractsStr}
                  onChange={(e) => { setContractsStr(e.target.value); setContracts(parseNum(e.target.value)); }}
                  inputMode="decimal"
                  placeholder="3"
                />
              </div>
              <div>
                <label style={label}>MULTIPLIER</label>
                <input
                  style={input}
                  value={multiplierStr}
                  onChange={(e) => { setMultiplierStr(e.target.value); setMultiplier(parseNum(e.target.value)); }}
                  inputMode="decimal"
                  placeholder="100"
                />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", margin: "14px 0 10px" }}>
              PRICING · PER-SHARE PREMIUM (× MULTIPLIER × CONTRACTS = $ VALUE)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
              <div>
                <label style={label}>ENTRY PREMIUM / SHARE</label>
                <input
                  style={input}
                  value={entryPremStr}
                  onChange={(e) => { setEntryPremStr(e.target.value); setEntryPrem(parseNum(e.target.value)); }}
                  inputMode="decimal"
                  placeholder="2.50"
                />
              </div>
              <div>
                <label style={label}>CURRENT MARK / SHARE (MANUAL)</label>
                <input
                  style={input}
                  value={markPSStr}
                  onChange={(e) => { setMarkPSStr(e.target.value); setMarkPS(parseNum(e.target.value)); }}
                  inputMode="decimal"
                  placeholder="3.25"
                />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              No live options feed in V1 — type today's mark manually.
              Short positions flip to a negative position value automatically.
            </div>
          </div>
        )}

        {/* ── BOND block ────────────────────────────────────────────────── */}
        {assetClass === "bond" && (
          <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 14, marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 10 }}>
              BOND HOLDING · PER-BOND PRICING
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>BONDS HELD</label>
                <input
                  style={input}
                  value={sharesStr}
                  onChange={(e) => onChangeShares(e.target.value)}
                  inputMode="decimal"
                  placeholder="10"
                />
              </div>
              <div>
                <label style={label}>AVG COST / BOND</label>
                <input
                  style={input}
                  value={avgCostStr}
                  onChange={(e) => onChangeAvgCost(e.target.value)}
                  inputMode="decimal"
                  placeholder="995.00"
                />
              </div>
            </div>
            <div>
              <label style={label}>CURRENT PRICE / BOND (MANUAL)</label>
              <input
                style={input}
                value={price != null ? String(price) : ""}
                onChange={(e) => setPrice(parseNum(e.target.value))}
                inputMode="decimal"
                placeholder="1020.00"
              />
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                No bond pricing feed in V1. Enter today's per-bond mark manually (face value conventions vary — we store whatever you type).
              </div>
            </div>
          </div>
        )}

        {/* ── CRYPTO block ──────────────────────────────────────────────── */}
        {assetClass === "crypto" && (
          <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 14, marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 10 }}>
              CRYPTO HOLDING · PER-UNIT PRICING
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>QUANTITY</label>
                <input
                  style={input}
                  value={sharesStr}
                  onChange={(e) => onChangeShares(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.5"
                />
              </div>
              <div>
                <label style={label}>AVG COST / UNIT</label>
                <input
                  style={input}
                  value={avgCostStr}
                  onChange={(e) => onChangeAvgCost(e.target.value)}
                  inputMode="decimal"
                  placeholder="42000.00"
                />
              </div>
            </div>
            <div>
              <label style={label}>CURRENT PRICE / UNIT (MANUAL)</label>
              <input
                style={input}
                value={price != null ? String(price) : ""}
                onChange={(e) => setPrice(parseNum(e.target.value))}
                inputMode="decimal"
                placeholder="67500.00"
              />
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                V1: enter today's mark manually. A sibling job will wire up
                3x/day crypto pricing shortly — after that, this field
                becomes an optional override.
              </div>
            </div>
          </div>
        )}

        {/* Derived summary — hidden for CASH */}
        {assetClass === "stock" && (
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-faint)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "10px 12px", marginBottom: 14,
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6,
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            <div><span style={{ color: "var(--text-muted)" }}>Cost basis: </span>{fmt$(totalCost)}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Current value: </span>{fmt$(currentValue)}</div>
            <div title="Derived per-unit mark — shares × derived mark = current value. Not a live market quote; for mutual funds and untracked assets, edit Current NAV above to update it.">
              <span style={{ color: "var(--text-muted)" }}>Derived mark: </span>{fmt$(price)}
            </div>
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
        )}
        {assetClass === "option" && (
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-faint)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "10px 12px", marginBottom: 14,
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6,
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            <div><span style={{ color: "var(--text-muted)" }}>Cost basis: </span>{fmt$(optCostBasis)}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Current value: </span>{fmt$(optCurrentValue)}</div>
            <div style={{ gridColumn: "span 2" }}>
              <span style={{ color: "var(--text-muted)" }}>PnL $: </span>
              <span style={{ color: optPnl$ == null ? "var(--text-muted)" : optPnl$ >= 0 ? "#30d158" : "#ff453a" }}>
                {fmt$(optPnl$)}
              </span>
            </div>
          </div>
        )}
        {(assetClass === "bond" || assetClass === "crypto") && (
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-faint)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "10px 12px", marginBottom: 14,
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6,
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            <div><span style={{ color: "var(--text-muted)" }}>Cost basis: </span>{fmt$(genCostBasis)}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Current value: </span>{fmt$(genCurrentValue)}</div>
            <div style={{ gridColumn: "span 2" }}>
              <span style={{ color: "var(--text-muted)" }}>PnL $: </span>
              <span style={{ color: genPnl$ == null ? "var(--text-muted)" : genPnl$ >= 0 ? "#30d158" : "#ff453a" }}>
                {fmt$(genPnl$)}
              </span>
            </div>
          </div>
        )}

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
