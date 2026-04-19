// OnboardingPanel — first-run data-entry UI for a signed-in user with no portfolio yet.
//
// Two modes:
//   1) PASTE — symbol-only "watchlist" onboarding. Textarea accepts tickers
//      separated by commas, spaces, or newlines; we parse, dedupe, upper-case,
//      and bulk-insert into the `watchlist` table (unique index on
//      (user_id, upper(ticker)) prevents dupes server-side as well).
//   2) CSV   — full-portfolio upload: accounts + positions. Single CSV with an
//      `account` grouping column; one row per position. We parse client-side
//      (no library), group by account label, insert distinct accounts first,
//      then insert positions keyed to the newly-created account IDs.
//
// On success, the caller's `refetchPortfolio()` is invoked so the dashboard
// re-reads from Supabase and the onboarding panel disappears on the next
// render (ACCOUNTS becomes non-empty).
//
// All writes rely on RLS: the client never sets user_id on insert, Supabase
// rejects anything that doesn't match auth.uid(), so we do pass user_id
// explicitly. That keeps the SQL path dumb and the enforcement at the DB
// layer rather than in JS.

import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// CSV column order we write in the template and expect on import.
const CSV_COLUMNS = [
  "account",   // required  — account label (e.g. "Roth IRA", "JPM Taxable")
  "ticker",    // required  — symbol
  "name",      // optional  — company/fund name
  "shares",    // optional  — numeric
  "price",     // optional  — numeric (last price)
  "avg_cost",  // optional  — numeric (cost basis per share)
  "value",     // required  — numeric (dollars held; shares*price if not set)
  "sector",    // optional  — "Tech", "HY Bonds", "Cash", "Intl Equity", etc.
  "beta",      // optional  — numeric
  "analysis",  // optional  — free-text qualitative note
];

// Template CSV body shipped via download link. Tiny, readable, one example row
// per common account-type so users get the pattern without guessing.
const CSV_TEMPLATE = [
  CSV_COLUMNS.join(","),
  "Roth IRA,VOO,Vanguard S&P 500 ETF,25,540,450,13500,Index Funds,1.0,Core equity sleeve",
  "Roth IRA,AAPL,Apple Inc,10,175,150,1750,Tech,1.2,",
  "401(k),FXAIX,Fidelity 500 Index,100,180,150,18000,Index Funds,1.0,",
  "Taxable,NVDA,NVIDIA Corp,5,850,600,4250,Tech,1.8,High-conviction single-stock",
  "Taxable,CASH,Cash (sweep),,,,5000,Cash,0,",
].join("\n");

// Minimal CSV line splitter. Handles:
//   a,b,c                          → ["a","b","c"]
//   "a, with, commas",b,c          → ["a, with, commas","b","c"]
//   a,"b ""with quotes""",c        → ['a', 'b "with quotes"', 'c']
// Good enough for hand-curated portfolio CSVs; not a full RFC 4180 parser.
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

// Parse a user-pasted ticker blob into a clean, deduped, uppercase list.
// Accepts comma, whitespace, semicolon, or newline separators. Drops empty
// strings. Caps at 200 to prevent a typo from filling the watchlist with
// junk rows.
function parseTickerBlob(blob) {
  const tokens = blob
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (!seen.has(t) && t.length <= 10) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= 200) break;
  }
  return out;
}

// Convert a parsed CSV (array of row objects) into (accounts, positions) shape
// ready for insertion. Returns { accounts: Map<label,{tmpId,rows}>, positions: [...], errors: [...] }
function groupRowsForInsert(rows) {
  const errors = [];
  const accounts = new Map(); // label -> { label, rows: [] }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = (r.account || "").trim();
    const ticker = (r.ticker || "").trim().toUpperCase();
    const valueNum = Number(r.value);
    if (!label)  { errors.push(`Row ${i + 2}: missing "account"`); continue; }
    if (!ticker) { errors.push(`Row ${i + 2}: missing "ticker"`); continue; }
    // Allow missing value ONLY if both shares and price are present (we'll compute).
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
    if (!accounts.has(label)) accounts.set(label, { label, rows: [] });
    accounts.get(label).rows.push({
      ticker,
      name:     r.name     || ticker,
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

// ── Component ───────────────────────────────────────────────────────────────

export default function OnboardingPanel({ userId, onDone }) {
  // "paste" = symbol-only watchlist; "csv" = full accounts+positions
  const [mode, setMode] = useState("paste");

  // PASTE state
  const [blob, setBlob] = useState("");
  const parsedTickers = useMemo(() => parseTickerBlob(blob), [blob]);

  // CSV state
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState([]); // array of {account, ticker, ...}
  const [csvFileName, setCsvFileName] = useState("");
  const [csvErrors, setCsvErrors] = useState([]);
  const fileInputRef = useRef(null);

  // Submit state — shared across both modes
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // ── CSV handling ──────────────────────────────────────────────────────────

  const handleCsvText = (text) => {
    setCsvText(text);
    setCsvErrors([]);
    setSubmitError("");
    if (!text.trim()) { setCsvRows([]); return; }
    try {
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setCsvErrors(["CSV must have a header row plus at least one data row."]);
        setCsvRows([]);
        return;
      }
      const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
      // Soft check — account + ticker + value are the real must-haves; others optional.
      const requiredMissing = ["account", "ticker"].filter((h) => !headers.includes(h));
      if (requiredMissing.length) {
        setCsvErrors([`Missing required columns: ${requiredMissing.join(", ")}. Use the template below.`]);
        setCsvRows([]);
        return;
      }
      const rows = lines.slice(1).map((line) => {
        const cells = splitCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cells[i] || ""; });
        return obj;
      });
      setCsvRows(rows);
    } catch (err) {
      setCsvErrors([`Parse error: ${err.message}`]);
      setCsvRows([]);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => handleCsvText(String(e.target?.result || ""));
    reader.onerror = () => setCsvErrors(["Could not read the file."]);
    reader.readAsText(file);
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

  // ── Submit handlers ───────────────────────────────────────────────────────

  const submitPaste = async () => {
    if (!parsedTickers.length) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const rows = parsedTickers.map((ticker, i) => ({
        user_id: userId,
        ticker,
        name: ticker,
        sort_order: i,
      }));
      // The unique index (user_id, upper(ticker)) will reject any dupes. We
      // swallow duplicate-key errors so a re-paste is idempotent.
      const { error } = await supabase
        .from("watchlist")
        .upsert(rows, { onConflict: "user_id,ticker", ignoreDuplicates: true });
      if (error) throw error;
      await onDone?.();
    } catch (err) {
      console.error("[OnboardingPanel] paste submit failed:", err);
      setSubmitError(err.message || "Could not save your watchlist. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCsv = async () => {
    if (!csvRows.length) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const { accounts, errors } = groupRowsForInsert(csvRows);
      if (errors.length) {
        setCsvErrors(errors.slice(0, 8));  // don't drown them in errors
        setSubmitting(false);
        return;
      }
      if (!accounts.size) {
        setCsvErrors(["No valid rows to import."]);
        setSubmitting(false);
        return;
      }

      // 1) Insert accounts, capture their generated UUIDs.
      const acctPayload = Array.from(accounts.values()).map((a, i) => ({
        user_id:    userId,
        label:      a.label,
        sort_order: i,
      }));
      const { data: acctRows, error: acctErr } = await supabase
        .from("accounts")
        .insert(acctPayload)
        .select("id,label,sort_order");
      if (acctErr) throw acctErr;

      // 2) Map each position row to its newly-minted account_id.
      const labelToId = new Map(acctRows.map((a) => [a.label, a.id]));
      const posPayload = [];
      let sort = 0;
      for (const group of accounts.values()) {
        const account_id = labelToId.get(group.label);
        for (const p of group.rows) {
          posPayload.push({
            user_id: userId,
            account_id,
            ticker:   p.ticker,
            name:     p.name,
            shares:   p.shares,
            price:    p.price,
            avg_cost: p.avg_cost,
            value:    p.value,
            sector:   p.sector,
            beta:     p.beta,
            analysis: p.analysis,
            sort_order: sort++,
          });
        }
      }
      const { error: posErr } = await supabase.from("positions").insert(posPayload);
      if (posErr) throw posErr;

      await onDone?.();
    } catch (err) {
      console.error("[OnboardingPanel] csv submit failed:", err);
      setSubmitError(err.message || "Could not import your portfolio. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────

  const card = {
    padding: "var(--space-5)",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
  };
  const tab = (active) => ({
    padding: "8px 14px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.08em",
    fontWeight: 600,
    color: active ? "var(--text)" : "var(--text-muted)",
    background: active ? "var(--surface-1)" : "transparent",
    border: "1px solid var(--border)",
    borderRight: "none",
    cursor: "pointer",
  });
  const primaryBtn = {
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: submitting ? "wait" : "pointer",
    opacity: submitting ? 0.7 : 1,
  };
  const secondaryBtn = {
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  };
  const label = {
    display: "block",
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.08em",
    fontWeight: 600,
    marginBottom: 8,
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", marginBottom: 6 }}>
        GET STARTED
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
        Load your portfolio
      </h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 20px" }}>
        Pick the path that fits — track a few tickers now, or import your full portfolio.
        Everything is private to your account and editable later.
      </p>

      {/* Mode switcher */}
      <div style={{ display: "flex", marginBottom: 18 }}>
        <button type="button" onClick={() => setMode("paste")} style={{ ...tab(mode === "paste"), borderTopLeftRadius: "var(--radius-sm)", borderBottomLeftRadius: "var(--radius-sm)" }}>
          TRACK TICKERS
        </button>
        <button type="button" onClick={() => setMode("csv")} style={{ ...tab(mode === "csv"), borderRight: "1px solid var(--border)", borderTopRightRadius: "var(--radius-sm)", borderBottomRightRadius: "var(--radius-sm)" }}>
          IMPORT FULL PORTFOLIO
        </button>
      </div>

      {mode === "paste" && (
        <div>
          <label style={label}>TICKERS</label>
          <textarea
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
            placeholder="AAPL, MSFT, NVDA, VOO, SMH&#10;or one per line"
            rows={5}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--text)",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-mono)",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {parsedTickers.length
                ? `${parsedTickers.length} ticker${parsedTickers.length === 1 ? "" : "s"}: ${parsedTickers.slice(0, 8).join(", ")}${parsedTickers.length > 8 ? "…" : ""}`
                : "Separated by commas, spaces, or newlines."}
            </span>
          </div>
          <button type="button" onClick={submitPaste} disabled={!parsedTickers.length || submitting} style={primaryBtn}>
            {submitting ? "Saving…" : `Add ${parsedTickers.length || ""} to watchlist`.trim()}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
            Watchlist tickers show up under “Other Watchlist” in Trading Opportunities. No account or
            position details required — just symbols.
          </div>
        </div>
      )}

      {mode === "csv" && (
        <div>
          <label style={label}>UPLOAD CSV</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={secondaryBtn}>
              Choose file…
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {csvFileName || "No file selected"}
            </span>
            <button type="button" onClick={downloadTemplate} style={{ ...secondaryBtn, marginLeft: "auto" }}>
              Download template
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </div>

          <label style={label}>OR PASTE CSV TEXT</label>
          <textarea
            value={csvText}
            onChange={(e) => handleCsvText(e.target.value)}
            placeholder={"account,ticker,name,shares,price,avg_cost,value,sector,beta,analysis\nRoth IRA,VOO,Vanguard S&P 500 ETF,25,540,450,13500,Index Funds,1.0,"}
            rows={6}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 12,
              color: "var(--text)",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-mono)",
              resize: "vertical",
              outline: "none",
              marginBottom: 10,
            }}
          />

          {csvRows.length > 0 && !csvErrors.length && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              Parsed {csvRows.length} row{csvRows.length === 1 ? "" : "s"} across{" "}
              {new Set(csvRows.map((r) => r.account)).size} account
              {new Set(csvRows.map((r) => r.account)).size === 1 ? "" : "s"}.
            </div>
          )}
          {csvErrors.length > 0 && (
            <div style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "var(--text)", background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not import:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {csvErrors.map((e, i) => <li key={i} style={{ lineHeight: 1.5 }}>{e}</li>)}
              </ul>
            </div>
          )}

          <button type="button" onClick={submitCsv} disabled={!csvRows.length || submitting} style={primaryBtn}>
            {submitting ? "Importing…" : `Import ${csvRows.length || ""} position${csvRows.length === 1 ? "" : "s"}`.trim()}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
            Required columns: <code>account</code>, <code>ticker</code>, and either{" "}
            <code>value</code> or both <code>shares</code> and <code>price</code>.
            Everything else is optional.
          </div>
        </div>
      )}

      {submitError && (
        <div style={{ marginTop: 14, padding: 10, fontSize: 12, color: "var(--danger, #ff3b30)", background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.3)", borderRadius: "var(--radius-sm)" }}>
          {submitError}
        </div>
      )}
    </div>
  );
}
