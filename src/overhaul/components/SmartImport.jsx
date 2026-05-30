// SmartImport — one drop zone for the Portfolio page.
//
// Drop any brokerage file (real Excel, the web-page-style .xls that Chase and
// Schwab actually download, a comma file, or pasted text). It:
//   1. reads it no matter the format,
//   2. figures out whether it's CURRENT HOLDINGS or BUY/SELL HISTORY,
//   3. makes its best guess at which column is which, and
//   4. shows a one-screen "confirm the columns" step so nothing imports on a
//      wrong guess. Nothing leaves the browser to do any of this.
//
// Buys and sells only — dividends, interest, transfers and cash sweeps are
// skipped (Joe's choice, 2026-05-29). All theming uses the overhaul tokens so
// it's correct in light, dark, and navy.

import React, { useMemo, useRef, useState } from "react";
import { readTabularFile, readPastedText, splitGrid } from "../../lib/importReader";
import { detectKind, autoMap, fieldSpec, buildTransactionRows, buildHoldingsRows } from "../../lib/importMapping";
import { classifyRows } from "../../lib/transactionsClassify";
import { writeTransactions, writeHoldings, groupHoldingsForInsert } from "../../lib/portfolioWrite";

const TX_LABELS = {
  "Trade Date": "Trade date", "Type": "Buy / sell", "Ticker": "Ticker (symbol)",
  "Quantity": "Quantity", "Price USD": "Price", "Amount USD": "Total amount",
  "Description": "Description", "Security Type": "Stock or option",
  "Account Name": "Account", "Account Number": "Account number",
  "Commissions USD": "Commission / fees", "Cusip": "CUSIP",
  "G/L Short USD": "Realized gain/loss (short-term)", "G/L Long USDs": "Realized gain/loss (long-term)",
};
const HOLD_LABELS = {
  account: "Account", ticker: "Ticker (symbol)", quantity: "Quantity (shares)",
  cost_per_share: "Cost per share", cost_basis_total: "Total cost basis",
  purchase_date: "Date acquired",
};
const labelFor = (kind, key) => (kind === "holdings" ? HOLD_LABELS[key] : TX_LABELS[key]) || key;

const KIND_COPY = {
  transactions: "Looks like your buy / sell history",
  holdings: "Looks like your current holdings",
  unknown: "Couldn't tell what this is — pick one below",
};

// ── styles (overhaul tokens only) ────────────────────────────────────────────
const scrim = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1200 };
const card = { width: "min(760px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--mt-surface)", border: "1px solid var(--mt-line-1)", borderRadius: "var(--mt-r-lg, 14px)", padding: "22px 24px", boxShadow: "0 24px 70px rgba(0,0,0,0.35)" };
const eyebrow = { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--mt-ink-2)", fontFamily: "var(--mt-font-mono)" };
const h3 = { fontFamily: "var(--mt-font-display)", fontSize: 22, fontWeight: 600, color: "var(--mt-ink-0)", margin: "2px 0 0" };
const sub = { fontSize: 13, color: "var(--mt-ink-2)", marginTop: 6, lineHeight: 1.5 };
const lbl = { display: "block", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--mt-ink-2)", fontFamily: "var(--mt-font-mono)", marginBottom: 6 };
const dropZone = (active) => ({ border: `1.5px dashed ${active ? "var(--mt-accent)" : "var(--mt-line-1)"}`, background: active ? "var(--mt-accent-soft)" : "var(--mt-surface-2)", borderRadius: "var(--mt-r-md, 10px)", padding: "26px 20px", textAlign: "center", cursor: "pointer", transition: "border-color .15s, background .15s" });
const textarea = { width: "100%", padding: "10px 12px", fontSize: 12, color: "var(--mt-ink-1)", background: "var(--mt-surface-2)", border: "1px solid var(--mt-line-1)", borderRadius: "var(--mt-r-sm, 8px)", fontFamily: "var(--mt-font-mono)", resize: "vertical", outline: "none", boxSizing: "border-box" };
const select = (warn) => ({ padding: "7px 9px", fontSize: 13, color: "var(--mt-ink-0)", background: "var(--mt-surface-2)", border: `1px solid ${warn ? "var(--mt-warn)" : "var(--mt-line-1)"}`, borderRadius: "var(--mt-r-sm, 8px)", outline: "none", width: "100%", boxShadow: warn ? "0 0 0 2px rgba(192,132,40,0.12)" : "none" });
const note = (tone) => ({ padding: "10px 12px", borderRadius: "var(--mt-r-sm, 8px)", fontSize: 12.5, lineHeight: 1.5, color: "var(--mt-ink-1)", background: tone === "warn" ? "rgba(192,132,40,0.10)" : tone === "down" ? "rgba(193,57,79,0.10)" : tone === "up" ? "rgba(31,157,96,0.10)" : "var(--mt-surface-2)", border: `1px solid ${tone === "warn" ? "var(--mt-warn)" : tone === "down" ? "var(--mt-down)" : tone === "up" ? "var(--mt-up)" : "var(--mt-line-1)"}` });
const pill = (active, tone) => ({ padding: "7px 13px", fontSize: 12, fontWeight: 600, fontFamily: "var(--mt-font-mono)", letterSpacing: "0.04em", cursor: "pointer", userSelect: "none", borderRadius: "var(--mt-r-sm, 8px)", border: "1px solid var(--mt-line-1)", color: active ? "#fff" : "var(--mt-ink-2)", background: active ? (tone === "down" ? "var(--mt-down)" : "var(--mt-accent)") : "var(--mt-surface-2)" });

export default function SmartImport({ userId, onClose, onDone }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const [grid, setGrid] = useState(null);          // string[][] incl. header row
  const [kind, setKind] = useState("unknown");     // 'transactions' | 'holdings' | 'unknown'
  const [mapping, setMapping] = useState({});
  const [confidence, setConfidence] = useState({});
  const [defaultAccount, setDefaultAccount] = useState("");
  const [strategy, setStrategy] = useState("merge"); // holdings only
  const [readErr, setReadErr] = useState("");
  const [showOptional, setShowOptional] = useState(false);

  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const { headers, dataRows } = useMemo(() => splitGrid(grid || []), [grid]);

  function ingest(result) {
    setReadErr("");
    if (result.error) { setReadErr(result.error); setGrid(null); return; }
    if (!result.grid || result.grid.length < 2) { setReadErr("That file doesn't have a header row plus at least one data row."); setGrid(null); return; }
    const { headers: hs, dataRows: rows } = splitGrid(result.grid);
    const k = detectKind(hs, rows);
    const k2 = k === "unknown" ? "transactions" : k; // default guess so the screen is usable
    const am = autoMap(hs, k2);
    setGrid(result.grid);
    setKind(k);
    setMapping(am.mapping);
    setConfidence(am.confidence);
    setResult(null); setSubmitErr(""); setConfirmReplace(false);
  }

  async function onFile(file) {
    if (!file) return;
    setFileName(file.name); setPasteText("");
    try { ingest(await readTabularFile(file)); }
    catch (e) { setReadErr(`Couldn't read that file: ${e?.message || e}`); setGrid(null); }
  }
  async function onPaste(text) {
    setPasteText(text); setFileName("");
    if (!text.trim()) { setGrid(null); setReadErr(""); return; }
    try { ingest(await readPastedText(text)); }
    catch (e) { setReadErr(`Couldn't read that text: ${e?.message || e}`); setGrid(null); }
  }

  // Re-map when the user overrides the detected kind.
  function switchKind(k) {
    const am = autoMap(headers, k);
    setKind(k); setMapping(am.mapping); setConfidence(am.confidence); setResult(null); setSubmitErr("");
  }
  const effectiveKind = kind === "unknown" ? "transactions" : kind;

  // ── preview (recomputed from the current mapping) ──────────────────────────
  const preview = useMemo(() => {
    if (!grid || !headers.length) return null;
    if (effectiveKind === "holdings") {
      const built = buildHoldingsRows(dataRows, mapping, { defaultAccount });
      const { accounts, errors } = groupHoldingsForInsert(built);
      let positions = 0; accounts.forEach((list) => { positions += list.length; });
      return { kind: "holdings", positions, accounts: accounts.size, errors };
    }
    const built = buildTransactionRows(dataRows, mapping, { defaultAccount });
    const { transactions, skipped, errors } = classifyRows(built);
    const buys = transactions.filter((t) => t.side === "BUY").length;
    const sells = transactions.filter((t) => t.side === "SELL").length;
    return { kind: "transactions", transactions, skipped: skipped.length, rowErrors: errors.length, buys, sells, total: transactions.length };
  }, [grid, headers, dataRows, mapping, effectiveKind, defaultAccount]);

  const fields = useMemo(() => fieldSpec(effectiveKind), [effectiveKind]);
  const accountKey = effectiveKind === "holdings" ? "account" : "Account Name";
  const accountUnmapped = mapping[accountKey] == null || mapping[accountKey] < 0;
  const requiredMissing = fields.filter((f) => f.required && (mapping[f.key] == null || mapping[f.key] < 0));

  const visibleFields = fields.filter((f) => f.required || (mapping[f.key] != null && mapping[f.key] >= 0) || showOptional);
  const hiddenOptionalCount = fields.filter((f) => !f.required && (mapping[f.key] == null || mapping[f.key] < 0)).length;

  function setField(key, idx) { setMapping((m) => ({ ...m, [key]: idx })); setConfidence((c) => ({ ...c, [key]: idx >= 0 ? "high" : "none" })); }

  const canImport = preview && requiredMissing.length === 0 &&
    (effectiveKind === "holdings" ? preview.positions > 0 : preview.total > 0);

  async function doImport() {
    if (effectiveKind === "holdings" && strategy === "replace" && !confirmReplace) { setConfirmReplace(true); return; }
    setBusy(true); setSubmitErr(""); setResult(null);
    try {
      if (effectiveKind === "holdings") {
        const built = buildHoldingsRows(dataRows, mapping, { defaultAccount });
        const res = await writeHoldings(userId, built, strategy);
        if (!res.ok) { setSubmitErr(res.errors.join("  ·  ")); setBusy(false); return; }
        setResult({ mode: "holdings", ...res });
      } else {
        const built = buildTransactionRows(dataRows, mapping, { defaultAccount });
        const { transactions } = classifyRows(built);
        const res = await writeTransactions(transactions);
        setResult({ mode: "transactions", inserted: res?.inserted ?? 0, duplicates: res?.duplicates ?? 0, errors: res?.errors || [] });
      }
      await onDone?.();
    } catch (e) {
      const msg = String(e?.message || e || "");
      setSubmitErr(msg.toLowerCase().includes("not authenticated") ? "You need to be signed in to import — sign in and try again." : (msg || "Import failed. Try again."));
    } finally { setBusy(false); }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={scrim} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={eyebrow}>Import portfolio data</div>
            <h3 style={h3}>Drop a file — I'll figure out the rest</h3>
            <div style={sub}>Current holdings or buy/sell history, from any broker, in whatever format they hand you. Buys and sells only; dividends, interest and transfers are skipped. Nothing leaves your browser.</div>
          </div>
          <button type="button" className="mt-btn" onClick={onClose} style={{ flexShrink: 0 }}>Close</button>
        </div>

        {result ? (
          <div style={note("up")}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--mt-ink-0)" }}>Done.</div>
            {result.mode === "transactions" ? (
              <>Added <b>{result.inserted}</b> new trade{result.inserted === 1 ? "" : "s"} to your history.
                {result.duplicates > 0 && <> Skipped <b>{result.duplicates}</b> already on file.</>}
                {Array.isArray(result.errors) && result.errors.length > 0 && <> {result.errors.length} row{result.errors.length === 1 ? "" : "s"} couldn't be added.</>}
                <div style={{ marginTop: 4, color: "var(--mt-ink-2)" }}>Your holdings update automatically from these trades.</div>
              </>
            ) : (
              <>Imported <b>{result.positions ?? (result.inserted || 0)}</b> holding{(result.positions === 1) ? "" : "s"} across <b>{result.accounts}</b> account{result.accounts === 1 ? "" : "s"}. Prices and analytics fill in over the next moment.</>
            )}
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button type="button" className="mt-btn mt-btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Drop zone + paste */}
            <div
              style={dropZone(dragActive)}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); onFile(e.dataTransfer?.files?.[0]); }}
            >
              <div style={{ fontSize: 14, color: "var(--mt-ink-1)", fontWeight: 600 }}>{fileName || "Drop a file here, or click to choose"}</div>
              <div style={{ fontSize: 12, color: "var(--mt-ink-3)", marginTop: 4 }}>Excel, .xls, comma or tab file — straight from your broker, no reformatting</div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.xlsx,.xls,text/csv,application/vnd.ms-excel" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Or paste it</label>
              <textarea rows={3} value={pasteText} onChange={(e) => onPaste(e.target.value)} placeholder="Paste rows copied from a spreadsheet or your broker…" style={textarea} />
            </div>

            {readErr && <div style={{ ...note("down"), marginTop: 12 }}>{readErr}</div>}

            {/* Confirm screen */}
            {grid && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mt-ink-0)" }}>
                    {KIND_COPY[kind]} <span style={{ color: "var(--mt-ink-3)", fontWeight: 400 }}>· {dataRows.length} rows</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span role="button" onClick={() => switchKind("transactions")} style={pill(effectiveKind === "transactions")}>Buy / sell history</span>
                    <span role="button" onClick={() => switchKind("holdings")} style={pill(effectiveKind === "holdings")}>Current holdings</span>
                  </div>
                </div>

                <div style={{ ...note(requiredMissing.length ? "warn" : "default"), marginTop: 10 }}>
                  {requiredMissing.length
                    ? <>Pick the column for: <b>{requiredMissing.map((f) => labelFor(effectiveKind, f.key)).join(", ")}</b>. I couldn't match {requiredMissing.length === 1 ? "it" : "them"} on my own.</>
                    : <>I matched every column I need. Glance over them below and adjust anything that's off, then import.</>}
                </div>

                {/* mapping grid */}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.8fr) 1fr", gap: "8px 14px", alignItems: "center", marginTop: 12 }}>
                  {visibleFields.map((f) => {
                    const warn = f.required && (mapping[f.key] == null || mapping[f.key] < 0);
                    const low = confidence[f.key] === "low";
                    return (
                      <React.Fragment key={f.key}>
                        <div style={{ fontSize: 13, color: "var(--mt-ink-1)" }}>
                          {labelFor(effectiveKind, f.key)}{f.required && <span style={{ color: "var(--mt-down)" }}> *</span>}
                          {low && <span style={{ fontSize: 10, color: "var(--mt-warn)", marginLeft: 6, fontFamily: "var(--mt-font-mono)" }}>check</span>}
                        </div>
                        <select value={mapping[f.key] ?? -1} onChange={(e) => setField(f.key, Number(e.target.value))} style={select(warn || low)}>
                          <option value={-1}>— none —</option>
                          {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                        </select>
                      </React.Fragment>
                    );
                  })}
                </div>

                {hiddenOptionalCount > 0 && (
                  <button type="button" className="mt-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setShowOptional((s) => !s)}>
                    {showOptional ? "Hide extra columns" : `Show ${hiddenOptionalCount} more optional column${hiddenOptionalCount === 1 ? "" : "s"}`}
                  </button>
                )}

                {accountUnmapped && (
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>No account column in the file — name this account</label>
                    <input value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)} placeholder="e.g. Chase Self-Directed" style={{ ...textarea, fontFamily: "var(--mt-font-ui)", fontSize: 13 }} />
                  </div>
                )}

                {/* holdings strategy */}
                {effectiveKind === "holdings" && (
                  <div style={{ marginTop: 14 }}>
                    <label style={lbl}>How to apply</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span role="button" onClick={() => { setStrategy("merge"); setConfirmReplace(false); }} style={pill(strategy === "merge")}>Add / update</span>
                      <span role="button" onClick={() => setStrategy("replace")} style={pill(strategy === "replace", "down")}>Replace everything</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--mt-ink-3)", marginTop: 6, lineHeight: 1.5 }}>
                      {strategy === "merge" ? "Updates holdings you already have and adds new ones. Nothing is removed." : "Deletes all current accounts and holdings first, then loads this file. Can't be undone."}
                    </div>
                  </div>
                )}

                {/* preview */}
                {preview && (
                  <div style={{ ...note("default"), marginTop: 14 }}>
                    {preview.kind === "transactions"
                      ? <><b style={{ color: "var(--mt-ink-0)" }}>{preview.total}</b> trade{preview.total === 1 ? "" : "s"} ready — {preview.buys} buy{preview.buys === 1 ? "" : "s"}, {preview.sells} sell{preview.sells === 1 ? "" : "s"}. {preview.skipped} non-trade row{preview.skipped === 1 ? "" : "s"} skipped.{preview.rowErrors > 0 && <> {preview.rowErrors} row{preview.rowErrors === 1 ? "" : "s"} couldn't be read.</>}<br /><span style={{ color: "var(--mt-ink-3)", fontSize: 11.5 }}>Anything already on file is detected and skipped automatically — safe to re-import.</span></>
                      : <><b style={{ color: "var(--mt-ink-0)" }}>{preview.positions}</b> holding{preview.positions === 1 ? "" : "s"} across {preview.accounts} account{preview.accounts === 1 ? "" : "s"} ready.{preview.errors.length > 0 && <> {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} need a look: {preview.errors.slice(0, 3).join("; ")}.</>}</>}
                  </div>
                )}

                {submitErr && <div style={{ ...note("down"), marginTop: 12 }}>{submitErr}</div>}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
                  <button type="button" className="mt-btn" disabled={busy} onClick={onClose}>Cancel</button>
                  <button type="button" className="mt-btn mt-btn--primary" disabled={busy || !canImport} onClick={doImport}>
                    {busy ? "Importing…"
                      : effectiveKind === "holdings"
                        ? (strategy === "replace" && confirmReplace ? `Yes, replace with ${preview?.positions || 0}` : `Import ${preview?.positions || 0} holding${(preview?.positions === 1) ? "" : "s"}`)
                        : `Import ${preview?.total || 0} trade${(preview?.total === 1) ? "" : "s"}`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
