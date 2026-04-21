// BulkImport — post-onboarding bulk upload / replace / merge for portfolios.
//
// 5-field CSV schema (aligned with the PositionEditor rewrite for Items 14/15/19):
//   account, ticker, purchase_date, shares, cost_per_share
//
// Everything else (price, value, sector, beta, analysis) is populated by the
// scanner after insert — the user doesn't type it. `value` is seeded from
// `shares * cost_per_share` at insert time so rows render sensibly until the
// next scanner refresh overwrites with a live quote.
//
// purchase_date is optional (nullable column in the DB after migration 007).
//
// Two strategies:
//   MERGE   — additive; (account, ticker) matches update in place, new rows insert.
//   REPLACE — wipes all of the current user's accounts + positions, then inserts fresh.
//
// File formats: CSV, TSV, XLSX, XLS.

import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Canonical column schema. Accepts a couple of common aliases so a user who
// exports from a brokerage (which may call it "cost basis per share" etc.)
// still lands on the right field.
const CSV_COLUMNS = ["account", "ticker", "purchase_date", "shares", "cost_per_share"];
const COLUMN_ALIASES = {
  "account": "account",
  "acct": "account",
  "ticker": "ticker",
  "symbol": "ticker",
  "purchase_date": "purchase_date",
  "purchase date": "purchase_date",
  "purchased": "purchase_date",
  "date": "purchase_date",
  "shares": "shares",
  "qty": "shares",
  "quantity": "shares",
  "cost_per_share": "cost_per_share",
  "cost per share": "cost_per_share",
  "cost/share": "cost_per_share",
  "avg_cost": "cost_per_share",
  "avg cost": "cost_per_share",
  "cost basis": "cost_per_share",
};

const CSV_TEMPLATE = [
  CSV_COLUMNS.join(","),
  "Roth IRA,VOO,2024-03-15,25,450",
  "Roth IRA,AAPL,2023-11-02,10,150",
  "401(k),FXAIX,,100,150",
  "Taxable,NVDA,2024-01-10,5.5,600",
  "Ethan 529,VTSAX,2025-06-01,8.25,210",
].join("\n");

// ── CSV helpers (lifted from the old BulkImport — same parser) ─────────────
function splitCsvLine(line, delim = ",") {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"')                    { inQuotes = false; }
      else                                    { cur += ch; }
    } else {
      if (ch === delim)     { out.push(cur); cur = ""; }
      else if (ch === '"')  { inQuotes = true; }
      else                  { cur += ch; }
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Detect the delimiter used on the header line. Excel copy/paste yields
// tab-separated text; downloaded CSVs use commas. We count both on the
// first line and pick whichever dominates. Falls back to comma when the
// line is single-column (no delimiter).
function detectDelimiter(firstLine) {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

// Normalize a header row into canonical column names using COLUMN_ALIASES.
// Unknown headers are preserved as-is (ignored downstream).
function canonicalizeHeaders(headers) {
  return headers.map((h) => {
    const key = String(h || "").toLowerCase().trim();
    return COLUMN_ALIASES[key] || key;
  });
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["File must have a header row plus at least one data row."] };
  }
  // Auto-detect delimiter from the header line — supports Excel copy/paste
  // (tab-separated) as well as downloaded CSVs (comma-separated).
  const delim = detectDelimiter(lines[0]);
  const headers = canonicalizeHeaders(splitCsvLine(lines[0], delim));
  const missing = ["account", "ticker", "shares", "cost_per_share"].filter((h) => !headers.includes(h));
  if (missing.length) {
    return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}. Use the template below.`] };
  }
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delim);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ""; });
    return obj;
  });
  return { rows, errors: [] };
}

async function parseXlsxFile(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ["No sheet found in the workbook."] };
  const ws = wb.Sheets[sheetName];
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (!arr.length) return { rows: [], errors: ["Empty sheet."] };
  const headers = canonicalizeHeaders(arr[0].map((h) => String(h || "").trim()));
  const missing = ["account", "ticker", "shares", "cost_per_share"].filter((h) => !headers.includes(h));
  if (missing.length) {
    return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}.`] };
  }
  const rows = arr.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : ""; });
      return obj;
    });
  return { rows, errors: [] };
}

// Validate + group rows by account. Enforces: non-empty account, non-empty
// ticker, positive numeric shares, non-negative cost_per_share, optional
// YYYY-MM-DD purchase_date.
function groupRowsForInsert(rows) {
  const errors = [];
  const accounts = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const labelRaw = (r.account || "").toString().trim();
    const tickerRaw = (r.ticker || "").toString().trim().toUpperCase();
    if (!labelRaw)  { errors.push(`Row ${i + 2}: missing "account"`); continue; }
    if (!tickerRaw) { errors.push(`Row ${i + 2}: missing "ticker"`); continue; }

    const sharesNum = Number(String(r.shares).replace(/[$,\s]/g, ""));
    const costNum = Number(String(r.cost_per_share).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
      errors.push(`Row ${i + 2}: "shares" must be a positive number (got "${r.shares}")`);
      continue;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      errors.push(`Row ${i + 2}: "cost_per_share" must be non-negative (got "${r.cost_per_share}")`);
      continue;
    }
    const purchaseDate = (r.purchase_date || "").toString().trim();
    if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      errors.push(`Row ${i + 2}: "purchase_date" must be YYYY-MM-DD (got "${purchaseDate}")`);
      continue;
    }

    if (!accounts.has(labelRaw)) accounts.set(labelRaw, []);
    accounts.get(labelRaw).push({
      ticker: tickerRaw,
      name: tickerRaw,              // scanner will overwrite with proper name
      shares: sharesNum,
      cost_per_share: costNum,
      purchase_date: purchaseDate || null,
      // seed value = shares * cost; scanner updates price + value on next run
      seed_value: sharesNum * costNum,
    });
  }
  return { accounts, errors };
}

// ── styles ─────────────────────────────────────────────────────────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modal = {
  width: "min(640px, 96vw)", maxHeight: "92vh", overflowY: "auto",
  background: "var(--surface-solid)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-md, 10px)", padding: "20px 22px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
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
  padding: "9px 14px", fontSize: 13, color: "#fff",
  background: "#ff453a", border: "none",
  borderRadius: "var(--radius-sm, 6px)", cursor: "pointer",
};
const label = {
  display: "block", fontSize: 11, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
  fontWeight: 600, marginBottom: 8,
};
const modePill = (active, tone = "accent") => ({
  padding: "8px 14px", fontSize: 12, fontWeight: 600,
  fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
  color: active ? "#fff" : "var(--text-muted)",
  background: active
    ? (tone === "danger" ? "#ff453a" : "var(--accent)")
    : "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm, 6px)",
  cursor: "pointer", userSelect: "none",
});

// ── component ──────────────────────────────────────────────────────────────
export default function BulkImport({ userId, onClose, onDone }) {
  const [strategy, setStrategy] = useState("merge"); // "merge" | "replace"
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const parsedSummary = useMemo(() => {
    if (!rows.length) return null;
    const accts = new Set(rows.map((r) => (r.account || "").trim()).filter(Boolean));
    return { rowCount: rows.length, acctCount: accts.size };
  }, [rows]);

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setErrors([]);
    setSubmitErr("");
    const ext = file.name.toLowerCase().split(".").pop();
    try {
      if (ext === "xlsx" || ext === "xls") {
        const { rows: r, errors: e } = await parseXlsxFile(file);
        setRows(r);
        setErrors(e);
      } else {
        const text = await file.text();
        const { rows: r, errors: e } = parseCsvText(text);
        setRows(r);
        setErrors(e);
      }
    } catch (e) {
      console.error("[BulkImport] parse failed:", e);
      setErrors([`Could not parse file: ${e.message || String(e)}`]);
      setRows([]);
    }
  };

  const handlePasteChange = (text) => {
    setPasteText(text);
    setFileName("");
    setErrors([]);
    setSubmitErr("");
    if (!text.trim()) { setRows([]); return; }
    const { rows: r, errors: e } = parseCsvText(text);
    setRows(r);
    setErrors(e);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "macrotilt-portfolio-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Build the insert payload for one position row. Keeps the column shape
  // compatible with the existing `positions` table (price, value, sector,
  // beta, analysis are nullable and get populated by the scanner).
  const buildPosRow = (p, { user_id, account_id, sort_order }) => ({
    user_id,
    account_id,
    ticker: p.ticker,
    name: p.name,
    shares: p.shares,
    avg_cost: p.cost_per_share,
    price: p.cost_per_share,        // seed price = cost; scanner overwrites
    value: p.seed_value,            // seed = shares * cost_per_share
    purchase_date: p.purchase_date, // nullable; needs migration 007
    sector: null,
    beta: null,
    analysis: null,
    sort_order,
  });

  const doReplace = async () => {
    const { accounts, errors: valErr } = groupRowsForInsert(rows);
    if (valErr.length) { setErrors(valErr.slice(0, 8)); return false; }
    if (!accounts.size) { setErrors(["No valid rows to import."]); return false; }

    const { error: delPosErr } = await supabase.from("positions").delete().eq("user_id", userId);
    if (delPosErr) throw delPosErr;
    const { error: delAcctErr } = await supabase.from("accounts").delete().eq("user_id", userId);
    if (delAcctErr) throw delAcctErr;

    const acctPayload = Array.from(accounts.keys()).map((label, i) => ({
      user_id: userId, label, sort_order: i,
    }));
    const { data: acctRows, error: acctErr } = await supabase
      .from("accounts").insert(acctPayload).select("id,label");
    if (acctErr) throw acctErr;

    const labelToId = new Map(acctRows.map((a) => [a.label, a.id]));
    const posPayload = [];
    let sort = 0;
    for (const [lbl, posList] of accounts.entries()) {
      const account_id = labelToId.get(lbl);
      for (const p of posList) {
        posPayload.push(buildPosRow(p, { user_id: userId, account_id, sort_order: sort++ }));
      }
    }
    if (posPayload.length) {
      const { error: posErr } = await supabase.from("positions").insert(posPayload);
      if (posErr) throw posErr;
    }
    return true;
  };

  const doMerge = async () => {
    const { accounts: grouped, errors: valErr } = groupRowsForInsert(rows);
    if (valErr.length) { setErrors(valErr.slice(0, 8)); return false; }
    if (!grouped.size) { setErrors(["No valid rows to import."]); return false; }

    const [{ data: existingAccts, error: eAErr }, { data: existingPos, error: ePErr }] = await Promise.all([
      supabase.from("accounts").select("id,label").eq("user_id", userId),
      supabase.from("positions").select("id,account_id,ticker").eq("user_id", userId),
    ]);
    if (eAErr) throw eAErr;
    if (ePErr) throw ePErr;

    const labelToId = new Map((existingAccts || []).map((a) => [a.label, a.id]));
    const posKey = (aid, t) => `${aid}::${t}`;
    const posIdBy = new Map((existingPos || []).map((p) => [posKey(p.account_id, p.ticker), p.id]));

    const newLabels = [];
    for (const lbl of grouped.keys()) {
      if (!labelToId.has(lbl)) newLabels.push(lbl);
    }
    if (newLabels.length) {
      const startOrder = labelToId.size;
      const { data: created, error: cErr } = await supabase
        .from("accounts")
        .insert(newLabels.map((label, i) => ({ user_id: userId, label, sort_order: startOrder + i })))
        .select("id,label");
      if (cErr) throw cErr;
      for (const a of created) labelToId.set(a.label, a.id);
    }

    const toUpdate = [];
    const toInsert = [];
    let sortCursor = posIdBy.size;
    for (const [lbl, posList] of grouped.entries()) {
      const account_id = labelToId.get(lbl);
      for (const p of posList) {
        const key = posKey(account_id, p.ticker);
        const existingId = posIdBy.get(key);
        const patch = {
          name: p.name,
          shares: p.shares,
          avg_cost: p.cost_per_share,
          price: p.cost_per_share,
          value: p.seed_value,
          purchase_date: p.purchase_date,
        };
        if (existingId) {
          toUpdate.push({ id: existingId, patch });
        } else {
          toInsert.push(buildPosRow(p, { user_id: userId, account_id, sort_order: sortCursor++ }));
        }
      }
    }

    if (toUpdate.length) {
      const results = await Promise.all(
        toUpdate.map(({ id, patch }) =>
          supabase.from("positions").update(patch).eq("id", id)
        )
      );
      const firstErr = results.find((r) => r.error);
      if (firstErr) throw firstErr.error;
    }
    if (toInsert.length) {
      const { error: insErr } = await supabase.from("positions").insert(toInsert);
      if (insErr) throw insErr;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (strategy === "replace" && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setSubmitErr("");
    setSubmitting(true);
    try {
      const ok = strategy === "replace" ? await doReplace() : await doMerge();
      if (ok) {
        // 35B: fire scan-ticker for each distinct ticker so name/sector/beta
        // are populated before the parent refetches. Skip CASH rows (not
        // scannable). Concurrency 5 so UW doesn't get hammered on a big
        // import. Promise.allSettled so one bad ticker doesn't fail the set.
        const tickersToScan = Array.from(new Set(
          rows
            .map((r) => String(r?.ticker || "").trim().toUpperCase())
            .filter((t) => t && t.length <= 10 && t !== "CASH")
        ));
        if (tickersToScan.length) {
          try {
            const { data: sessData } = await supabase.auth.getSession();
            const token = sessData?.session?.access_token;
            if (token) {
              const POOL = 5;
              const queue = [...tickersToScan];
              const worker = async () => {
                while (queue.length) {
                  const t = queue.shift();
                  if (!t) break;
                  try {
                    await fetch("/api/scan-ticker", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({ ticker: t }),
                    });
                  } catch (_) { /* best-effort per ticker */ }
                }
              };
              await Promise.allSettled(
                Array.from({ length: Math.min(POOL, tickersToScan.length) }, worker)
              );
            }
          } catch (scanErr) {
            // eslint-disable-next-line no-console
            console.warn("[BulkImport] scan fan-out failed:", scanErr);
          }
        }
        await onDone?.();
      }
    } catch (e) {
      console.error("[BulkImport] submit failed:", e);
      const msg = (e.message || "").toLowerCase().includes("purchase_date")
        ? "Database is missing the purchase_date column. Run migration 007_positions_purchase_date.sql in Supabase SQL editor, then retry."
        : (e.message || "Import failed. Try again.");
      setSubmitErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              BULK IMPORT
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "2px 0 0" }}>
              Upload CSV or Excel
            </h3>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
            Close
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>STRATEGY</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div role="button" onClick={() => { setStrategy("merge"); setConfirmReplace(false); }} style={modePill(strategy === "merge")}>
              MERGE · update + add
            </div>
            <div role="button" onClick={() => setStrategy("replace")} style={modePill(strategy === "replace", "danger")}>
              REPLACE · wipe + reload
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
            {strategy === "merge"
              ? "Rows with a matching account + ticker get updated. New rows are added. Nothing you already have is removed."
              : "DESTRUCTIVE — deletes ALL of your existing accounts and positions, then inserts from this file. Not reversible."}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={label}>COLUMNS</label>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
            Required: <b style={{ color: "var(--text)" }}>account, ticker, shares, cost_per_share</b><br/>
            Optional: <b style={{ color: "var(--text)" }}>purchase_date</b> (YYYY-MM-DD)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} style={secondaryBtn}>
            Choose file…
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {fileName || "CSV, XLSX, or XLS"}
          </span>
          <button type="button" onClick={downloadTemplate} style={{ ...secondaryBtn, marginLeft: "auto" }}>
            Download template
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ display: "none" }}
          />
        </div>

        <label style={label}>OR PASTE CSV OR EXCEL</label>
        <textarea
          value={pasteText}
          onChange={(e) => handlePasteChange(e.target.value)}
          placeholder={"account,ticker,purchase_date,shares,cost_per_share\nRoth IRA,VOO,2024-03-15,25,450"}
          rows={5}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 12,
            color: "var(--text)", background: "var(--surface-2)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 6px)",
            fontFamily: "var(--font-mono)", resize: "vertical", outline: "none",
            marginBottom: 10, boxSizing: "border-box",
          }}
        />

        {parsedSummary && !errors.length && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            Parsed {parsedSummary.rowCount} row{parsedSummary.rowCount === 1 ? "" : "s"} across{" "}
            {parsedSummary.acctCount} account{parsedSummary.acctCount === 1 ? "" : "s"}.
          </div>
        )}
        {errors.length > 0 && (
          <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "var(--text)", background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)", borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not import:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e, i) => <li key={i} style={{ lineHeight: 1.5 }}>{e}</li>)}
            </ul>
          </div>
        )}

        {submitErr && (
          <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "#ff453a", background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 6 }}>
            {submitErr}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" style={secondaryBtn} disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          {strategy === "replace" && confirmReplace ? (
            <button type="button" style={dangerBtn} disabled={submitting || !rows.length} onClick={handleSubmit}>
              {submitting ? "Replacing…" : `Yes, replace with ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button
              type="button"
              style={strategy === "replace" ? dangerBtn : primaryBtn}
              disabled={submitting || !rows.length}
              onClick={handleSubmit}
            >
              {submitting
                ? "Importing…"
                : strategy === "replace"
                  ? `Replace portfolio (${rows.length})`
                  : `Merge ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
