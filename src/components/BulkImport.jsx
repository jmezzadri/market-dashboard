// BulkImport — post-onboarding bulk upload / replace / merge for portfolios.
//
// Unlike OnboardingPanel (which only renders on first run when ACCOUNTS is
// empty), this modal is reachable at any time from the Portfolio Insights
// header. It supports two strategies, which the user picks before upload:
//
//   MERGE   — additive. For each CSV/XLSX row:
//               · if the account label doesn't exist yet, create it
//               · if (account, ticker) already exists, UPDATE that row
//               · otherwise INSERT a new position row
//             Nothing the user already has gets deleted.
//
//   REPLACE — destructive. Wipes ALL accounts + positions for the current
//             user, then inserts the fresh set. Equivalent to re-running
//             onboarding from scratch. Shown behind an extra confirm step
//             because it's irreversible.
//
// File formats accepted:
//   · .csv / .tsv — parsed inline (tiny splitter, same as OnboardingPanel)
//   · .xlsx / .xls — parsed via SheetJS (lazy-imported so the main bundle
//                    doesn't pay for it when the modal isn't opened)
//
// Column schema matches OnboardingPanel CSV_COLUMNS exactly — keeps one
// template, one mental model.

import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Same column schema as OnboardingPanel — don't fork it.
const CSV_COLUMNS = [
  "account", "ticker", "name", "shares", "price",
  "avg_cost", "value", "sector", "beta", "analysis",
];

const CSV_TEMPLATE = [
  CSV_COLUMNS.join(","),
  "Roth IRA,VOO,Vanguard S&P 500 ETF,25,540,450,13500,Index Funds,1.0,Core equity sleeve",
  "Roth IRA,AAPL,Apple Inc,10,175,150,1750,Tech,1.2,",
  "401(k),FXAIX,Fidelity 500 Index,100,180,150,18000,Index Funds,1.0,",
  "Taxable,NVDA,NVIDIA Corp,5,850,600,4250,Tech,1.8,High-conviction single-stock",
  "Taxable,CASH,Cash (sweep),,,,5000,Cash,0,",
].join("\n");

// ── CSV helpers (copied from OnboardingPanel — good enough for hand-curated
// portfolio CSVs; not a full RFC 4180 parser). ────────────────────────────────
function splitCsvLine(line) {
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
      if (ch === ',')       { out.push(cur); cur = ""; }
      else if (ch === '"')  { inQuotes = true; }
      else                  { cur += ch; }
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["File must have a header row plus at least one data row."] };
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = ["account", "ticker"].filter((h) => !headers.includes(h));
  if (missing.length) {
    return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}. Use the template below.`] };
  }
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ""; });
    return obj;
  });
  return { rows, errors: [] };
}

// Parse an Excel file using SheetJS. Lazy-loaded so opening the modal doesn't
// pull ~1MB of parser into the bundle for users who never import. Converts the
// first sheet into row-objects keyed by header.
async function parseXlsxFile(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ["No sheet found in the workbook."] };
  const ws = wb.Sheets[sheetName];
  // header:1 returns a 2D array; we normalize + handle our own header lookup
  // so column names get lowercased the same way as the CSV path.
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (!arr.length) return { rows: [], errors: ["Empty sheet."] };
  const headers = arr[0].map((h) => String(h || "").toLowerCase().trim());
  const missing = ["account", "ticker"].filter((h) => !headers.includes(h));
  if (missing.length) {
    return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}.`] };
  }
  const rows = arr.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))  // skip blank rows
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : ""; });
      return obj;
    });
  return { rows, errors: [] };
}

// Reshape raw row-objects into validated { accountLabel, positionFields[] }
// groups. Mirrors the logic in OnboardingPanel.groupRowsForInsert so the
// validation rules stay in lockstep.
function groupRowsForInsert(rows) {
  const errors = [];
  const accounts = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const labelRaw  = (r.account || "").toString().trim();
    const tickerRaw = (r.ticker  || "").toString().trim().toUpperCase();
    if (!labelRaw)  { errors.push(`Row ${i + 2}: missing "account"`); continue; }
    if (!tickerRaw) { errors.push(`Row ${i + 2}: missing "ticker"`); continue; }

    const valueNum = Number(r.value);
    let value = Number.isFinite(valueNum) ? valueNum : null;
    if (value === null || Number.isNaN(value)) {
      const sh = Number(r.shares);
      const px = Number(r.price);
      if (Number.isFinite(sh) && Number.isFinite(px)) value = sh * px;
    }
    if (value === null || !Number.isFinite(value)) {
      errors.push(`Row ${i + 2}: need either "value" or both "shares" and "price"`);
      continue;
    }

    if (!accounts.has(labelRaw)) accounts.set(labelRaw, []);
    accounts.get(labelRaw).push({
      ticker:   tickerRaw,
      name:     r.name     || tickerRaw,
      shares:   Number(r.shares)   || null,
      price:    Number(r.price)    || null,
      avg_cost: Number(r.avg_cost) || null,
      value,
      sector:   r.sector   || null,
      beta:     Number(r.beta) || null,
      analysis: r.analysis || null,
    });
  }
  return { accounts, errors };
}

// ── styles (match OnboardingPanel visual language) ─────────────────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modal = {
  width: "min(640px, 96vw)", maxHeight: "92vh", overflowY: "auto",
  // Opaque panel — --surface-1 doesn't exist as a CSS var, and --surface /
  // --surface-2 are translucent rgba colors. --surface-solid is the one
  // opaque panel background in the design system.
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
export default function BulkImport({
  userId,
  onClose,
  onDone,   // parent refetches + closes after successful write
}) {
  const [strategy, setStrategy] = useState("merge"); // "merge" | "replace"
  const [fileName, setFileName] = useState("");
  const [rows, setRows]         = useState([]);      // parsed row-objects
  const [errors, setErrors]     = useState([]);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const parsedSummary = useMemo(() => {
    if (!rows.length) return null;
    const accts = new Set(rows.map((r) => (r.account || "").trim()).filter(Boolean));
    return { rowCount: rows.length, acctCount: accts.size };
  }, [rows]);

  // ── input handlers ────────────────────────────────────────────────────────
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
        // CSV / TSV — read as text, reuse parser
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

  // ── write paths ───────────────────────────────────────────────────────────

  // REPLACE — wipe existing, then insert (same shape as onboarding).
  // We delete positions FIRST, then accounts, because positions has a FK to
  // accounts and the DB will refuse to delete an account that still has rows.
  const doReplace = async () => {
    const { accounts, errors: valErr } = groupRowsForInsert(rows);
    if (valErr.length) { setErrors(valErr.slice(0, 8)); return false; }
    if (!accounts.size) { setErrors(["No valid rows to import."]); return false; }

    // Wipe. RLS scopes the delete to this user, so we can use an unfiltered
    // delete — but we add an explicit user_id predicate so this is obvious
    // in code-review and survives any future RLS changes.
    const { error: delPosErr } = await supabase.from("positions").delete().eq("user_id", userId);
    if (delPosErr) throw delPosErr;
    const { error: delAcctErr } = await supabase.from("accounts").delete().eq("user_id", userId);
    if (delAcctErr) throw delAcctErr;

    // Insert accounts, capture IDs, then positions.
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
        posPayload.push({
          user_id: userId, account_id,
          ticker: p.ticker, name: p.name,
          shares: p.shares, price: p.price, avg_cost: p.avg_cost,
          value: p.value, sector: p.sector, beta: p.beta,
          analysis: p.analysis, sort_order: sort++,
        });
      }
    }
    if (posPayload.length) {
      const { error: posErr } = await supabase.from("positions").insert(posPayload);
      if (posErr) throw posErr;
    }
    return true;
  };

  // MERGE — additive. For each row:
  //   1) find or create the account (by label)
  //   2) if (account_id, ticker) already exists → UPDATE
  //   3) else → INSERT
  // We fetch existing accounts + positions once up-front to avoid N+1 queries.
  const doMerge = async () => {
    const { accounts: grouped, errors: valErr } = groupRowsForInsert(rows);
    if (valErr.length) { setErrors(valErr.slice(0, 8)); return false; }
    if (!grouped.size) { setErrors(["No valid rows to import."]); return false; }

    // Existing accounts + positions
    const [{ data: existingAccts, error: eAErr }, { data: existingPos, error: ePErr }] = await Promise.all([
      supabase.from("accounts").select("id,label").eq("user_id", userId),
      supabase.from("positions").select("id,account_id,ticker").eq("user_id", userId),
    ]);
    if (eAErr) throw eAErr;
    if (ePErr) throw ePErr;

    const labelToId = new Map((existingAccts || []).map((a) => [a.label, a.id]));
    const posKey = (aid, t) => `${aid}::${t}`;
    const posIdBy = new Map((existingPos || []).map((p) => [posKey(p.account_id, p.ticker), p.id]));

    // 1) Create any missing accounts
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

    // 2) Partition rows into updates vs inserts
    const toUpdate = []; // [{id, patch}]
    const toInsert = [];
    let sortCursor = posIdBy.size;
    for (const [lbl, posList] of grouped.entries()) {
      const account_id = labelToId.get(lbl);
      for (const p of posList) {
        const key = posKey(account_id, p.ticker);
        const existingId = posIdBy.get(key);
        const patch = {
          name: p.name, shares: p.shares, price: p.price, avg_cost: p.avg_cost,
          value: p.value, sector: p.sector, beta: p.beta, analysis: p.analysis,
        };
        if (existingId) {
          toUpdate.push({ id: existingId, patch });
        } else {
          toInsert.push({
            user_id: userId, account_id,
            ticker: p.ticker, ...patch, sort_order: sortCursor++,
          });
        }
      }
    }

    // 3) Fire the writes. Updates go one-at-a-time (Supabase doesn't support
    //    bulk heterogeneous updates) but in parallel. Inserts go as one batch.
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
      if (ok) await onDone?.();
    } catch (e) {
      console.error("[BulkImport] submit failed:", e);
      setSubmitErr(e.message || "Import failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
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

        {/* Strategy */}
        <div style={{ marginBottom: 14 }}>
          <label style={label}>STRATEGY</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div
              role="button"
              onClick={() => { setStrategy("merge"); setConfirmReplace(false); }}
              style={modePill(strategy === "merge")}
            >
              MERGE · update + add
            </div>
            <div
              role="button"
              onClick={() => setStrategy("replace")}
              style={modePill(strategy === "replace", "danger")}
            >
              REPLACE · wipe + reload
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
            {strategy === "merge"
              ? "Existing positions with matching account + ticker get updated. Anything new gets added. Nothing you already have is removed."
              : "DESTRUCTIVE — deletes ALL of your existing accounts and positions, then inserts from this file. Not reversible."}
          </div>
        </div>

        {/* File / paste */}
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

        <label style={label}>OR PASTE CSV</label>
        <textarea
          value={pasteText}
          onChange={(e) => handlePasteChange(e.target.value)}
          placeholder={"account,ticker,shares,price,avg_cost,value,sector\nRoth IRA,VOO,25,540,450,13500,Index Funds"}
          rows={5}
          style={{
            width: "100%", padding: "10px 12px", fontSize: 12,
            color: "var(--text)", background: "var(--surface-2)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 6px)",
            fontFamily: "var(--font-mono)", resize: "vertical", outline: "none",
            marginBottom: 10, boxSizing: "border-box",
          }}
        />

        {/* Parse state */}
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

        {/* Submit */}
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
