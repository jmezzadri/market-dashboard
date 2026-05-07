// ImportTransactions — broker transaction history upload (Joe 2026-05-04).
//
// Counterpart to BulkImport (which is for current holdings). This modal
// takes a Chase brokerage CSV transaction export, classifies every row
// in plain English (stock bought, option short opened, etc.), shows a
// preview, and inserts the new trades into the public.transactions
// ledger via the import_transactions RPC (mig 042) which dedups against
// any existing rows so re-uploads do not double-count.
//
// Today: Chase only. The broker dropdown is in place so Schwab / Fidelity
// can be added later by registering a second parser in src/lib/.
//
// UX Designer sign-off: brand tokens (var(--*)) only — no hex literals.
// Plain English everywhere — no "tran code", "CUSIP", "wash sale" in
// labels. Liquid Glass surface card, Fraunces headline, monospace meta.
// Mirror the BulkImport layout so the two modals feel like a pair.
// Senior Quant sign-off: parsing logic lives entirely in chaseImporter.js
// (covered by chaseImporter.test.mjs, 34/34 passing).

import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { classifyChaseCsv } from "../lib/chaseImporter";

const SUPPORTED_BROKERS = [
  { value: "chase",    label: "Chase / J.P. Morgan",       implemented: true  },
  { value: "schwab",   label: "Schwab (coming soon)",      implemented: false },
  { value: "fidelity", label: "Fidelity (coming soon)",    implemented: false },
];

// ── styles (mirror BulkImport.jsx tokens) ───────────────────────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(20,18,15,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20, zIndex: 1000,
};
const modal = {
  background: "var(--surface)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 10,
  padding: 22, maxWidth: 900, width: "100%",
  maxHeight: "92vh", overflowY: "auto",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
  fontFamily: "var(--font-sans)",
};
const label = {
  display: "block", fontSize: 10, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
  marginBottom: 6,
};
const select = {
  padding: "8px 10px", fontSize: 13, color: "var(--text)",
  background: "var(--surface-2)", border: "1px solid var(--border)",
  borderRadius: 6, fontFamily: "var(--font-sans)", outline: "none",
};
const primaryBtn = {
  padding: "9px 16px", fontSize: 13, fontWeight: 600,
  background: "var(--accent)", color: "var(--surface)",
  border: "none", borderRadius: 6, cursor: "pointer",
};
const secondaryBtn = {
  padding: "9px 14px", fontSize: 13, fontWeight: 500,
  background: "var(--surface-2)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
};
const TH = { padding: "8px 10px", fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const TD = { padding: "7px 10px", fontSize: 12, color: "var(--text)", borderBottom: "1px solid var(--border)" };

function fmt$(v) {
  if (v == null || isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return sign + "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(v, mult) {
  if (v == null || isNaN(v)) return "—";
  if (mult && mult > 1) return v + " contract" + (v === 1 ? "" : "s");
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function ImportTransactions({ onClose, onDone }) {
  const fileInputRef = useRef(null);
  const [broker, setBroker] = useState("chase");
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState("");
  const [classification, setClassification] = useState(null); // {transactions, skipped, errors, headerErrors}
  const [submitErr, setSubmitErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // {inserted, duplicates, errors}

  const brokerInfo = SUPPORTED_BROKERS.find((b) => b.value === broker);

  function classify(text) {
    if (!text || !text.trim()) { setClassification(null); return; }
    if (broker !== "chase") {
      setClassification({ transactions: [], skipped: [], errors: [], headerErrors: [`${brokerInfo?.label || broker} is not supported yet — only Chase is implemented today. Use the broker dropdown to switch.`] });
      return;
    }
    setClassification(classifyChaseCsv(text));
    setResult(null);
    setSubmitErr("");
  }

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || "");
      setPasteText(text);
      classify(text);
    };
    reader.readAsText(file);
  }

  function handlePasteChange(text) {
    setPasteText(text);
    setFileName("");
    classify(text);
  }

  const counts = useMemo(() => {
    if (!classification) return null;
    const txs = classification.transactions || [];
    const stockBuy = txs.filter((t) => t.asset_class === "stock" && t.side === "BUY").length;
    const stockSell = txs.filter((t) => t.asset_class === "stock" && t.side === "SELL").length;
    const optionBuy = txs.filter((t) => t.asset_class === "option" && t.side === "BUY").length;
    const optionSell = txs.filter((t) => t.asset_class === "option" && t.side === "SELL").length;
    return { total: txs.length, stockBuy, stockSell, optionBuy, optionSell, skipped: (classification.skipped || []).length, errors: (classification.errors || []).length };
  }, [classification]);

  async function handleSubmit() {
    if (!classification || !classification.transactions || classification.transactions.length === 0) return;
    setSubmitErr("");
    setSubmitting(true);
    setResult(null);
    try {
      const payload = classification.transactions.map((t) => {
        const { raw, ...keep } = t; // strip the original CSV row
        return keep;
      });
      const { data, error } = await supabase.rpc("import_transactions", { p_rows: payload });
      if (error) throw error;
      setResult(data);
      // Tell parent to refetch the trade ledger + realized P&L tile
      await onDone?.();
    } catch (e) {
      console.error("[ImportTransactions] submit failed:", e);
      setSubmitErr(e?.message || "Import failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              IMPORT BROKER TRADES
            </div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--text)", margin: "2px 0 0" }}>
              Add transactions from your broker
            </h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              For your <b>buy / sell history</b> (every individual trade). Use Bulk Import on the positions tile if you want to load <b>current holdings</b> instead.
            </div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", marginBottom: 14, alignItems: "center" }}>
          <span style={label}>BROKER</span>
          <div>
            <select value={broker} onChange={(e) => { setBroker(e.target.value); classify(pasteText); }} style={select}>
              {SUPPORTED_BROKERS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            {!brokerInfo?.implemented && (
              <span style={{ marginLeft: 10, fontSize: 11, color: "var(--text-muted)" }}>Not yet supported. Switch back to Chase to import.</span>
            )}
          </div>

          <span style={label}>FILE</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={secondaryBtn}>Choose file…</button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{fileName || "Chase transaction CSV (the file you download from chase.com)"}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </div>
        </div>

        <label style={label}>OR PASTE THE CSV TEXT</label>
        <textarea
          value={pasteText}
          onChange={(e) => handlePasteChange(e.target.value)}
          placeholder="Paste the contents of your Chase transactions CSV here…"
          rows={4}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 12,
            color: "var(--text)", background: "var(--surface-2)",
            border: "1px solid var(--border)", borderRadius: 6,
            fontFamily: "var(--font-mono)", resize: "vertical", outline: "none",
            marginBottom: 12, boxSizing: "border-box",
          }}
        />

        {classification?.headerErrors?.length > 0 && (
          <div style={{ padding: 12, marginBottom: 14, fontSize: 12, color: "var(--text)", background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>This file isn't in the expected shape:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {classification.headerErrors.map((e, i) => <li key={i} style={{ lineHeight: 1.5 }}>{e}</li>)}
            </ul>
          </div>
        )}

        {counts && counts.total > 0 && (
          <>
            <div style={{ padding: 10, marginBottom: 10, fontSize: 12, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }}>
              Found <b style={{ color: "var(--text)" }}>{counts.total}</b> trades —{" "}
              {counts.stockBuy} stock buy{counts.stockBuy === 1 ? "" : "s"},{" "}
              {counts.stockSell} stock sell{counts.stockSell === 1 ? "" : "s"},{" "}
              {counts.optionBuy} option buy{counts.optionBuy === 1 ? "" : "s"},{" "}
              {counts.optionSell} option sell{counts.optionSell === 1 ? "" : "s"}.
              {counts.skipped > 0 && <> {counts.skipped} non-trade row{counts.skipped === 1 ? "" : "s"} skipped.</>}
              {counts.errors > 0 && <> {counts.errors} row{counts.errors === 1 ? "" : "s"} could not be read.</>}
              <br />
              <span style={{ fontSize: 11 }}>
                Anything you've already imported (or that landed in the ledger from the year-to-date backfill) will be detected as a duplicate and skipped automatically.
              </span>
            </div>

            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={TH}>Trade date</th>
                    <th style={TH}>What it was</th>
                    <th style={TH}>Account</th>
                    <th style={TH}>Ticker</th>
                    <th style={{ ...TH, textAlign: "right" }}>Quantity</th>
                    <th style={{ ...TH, textAlign: "right" }}>Price</th>
                    <th style={{ ...TH, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {classification.transactions.map((t) => (
                    <tr key={t.dedup_key}>
                      <td style={TD}>{t.executed_at}</td>
                      <td style={TD}>
                        <span style={{ fontWeight: 600 }}>{t.classification}</span>
                        {t.contract_type && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                            {t.ticker} ${t.strike}{t.contract_type === "put" ? "P" : "C"} exp {t.expiration}
                          </div>
                        )}
                      </td>
                      <td style={TD}>{t.account_label}</td>
                      <td style={TD}>{t.ticker}</td>
                      <td style={{ ...TD, textAlign: "right" }}>{fmtQty(t.quantity, t.multiplier)}</td>
                      <td style={{ ...TD, textAlign: "right" }}>{fmt$(t.price)}</td>
                      <td style={{ ...TD, textAlign: "right" }}>{fmt$(t.gross_proceeds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {classification?.errors?.length > 0 && (
          <div style={{ padding: 10, marginBottom: 14, fontSize: 12, color: "var(--text)", background: "rgba(255,149,0,0.10)", border: "1px solid rgba(255,149,0,0.3)", borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Some rows couldn't be read:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {classification.errors.map((e, i) => <li key={i} style={{ lineHeight: 1.5 }}>Row {e.rowNum}: {e.reason}</li>)}
            </ul>
          </div>
        )}

        {result && (
          <div style={{ padding: 12, marginBottom: 14, fontSize: 13, color: "var(--text)", background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.3)", borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Done.</div>
            Added <b>{result.inserted}</b> new trade{result.inserted === 1 ? "" : "s"} to your ledger.
            {result.duplicates > 0 && <> Skipped <b>{result.duplicates}</b> duplicate{result.duplicates === 1 ? "" : "s"}.</>}
            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <> {result.errors.length} row{result.errors.length === 1 ? "" : "s"} couldn't be inserted — see error log below.</>
            )}
          </div>
        )}

        {submitErr && (
          <div style={{ padding: 10, marginBottom: 14, fontSize: 12, color: "var(--red)", background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 6 }}>
            {submitErr}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" style={secondaryBtn} disabled={submitting} onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              type="button"
              style={primaryBtn}
              disabled={submitting || !brokerInfo?.implemented || !counts || counts.total === 0}
              onClick={handleSubmit}
            >
              {submitting ? "Importing…" : counts ? `Add ${counts.total} trade${counts.total === 1 ? "" : "s"} to ledger` : "Add trades to ledger"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
