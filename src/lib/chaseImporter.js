// chaseImporter.js — Chase brokerage CSV → transactions ledger mapper.
//
// Pure functions only. No DOM, no network, no React. Imported by both the
// browser (ImportTransactions.jsx) and the Node test script
// (chaseImporter.test.mjs) so we get the same parsing behavior in both
// places.
//
// Senior Quant sign-off (Joe 2026-05-04): per LESSONS rule #20, when
// Chase populates G/L Short USD or G/L Long USD on a row we use that as
// the canonical realized_pnl and use the column's name to set
// is_long_term. When those fields are blank (most regular trade exports
// — only the year-end tax export fills them), realized_pnl is left NULL
// and the holding-period tile reconciles later. Matches the 4/28 backfill.
//
// Multiplier convention (matches mig 027 / PositionEditor / CloseModal):
// option positions store PER-CONTRACT prices. Chase's Price USD column
// is per-share, so for options we convert price = chase_price *
// multiplier (default 100 for equity options). Stocks are 1×.
//
// Side convention: BUY when money goes out (Chase Type=Buy), SELL when
// money comes in (Chase Type=Sell). Direction (long/short) is captured
// separately for options.
//
// Dedup key (also enforced server-side in mig 042 RPC):
//   account_label | ticker | executedDate (YYYY-MM-DD) | side | assetClass | absQuantity

const REQUIRED_HEADERS = [
  "Trade Date",
  "Account Name",
  "Type",
  "Description",
  "Ticker",
  "Security Type",
  "Price USD",
  "Quantity",
  "Amount USD",
];

const OPTION_MULTIPLIER_DEFAULT = 100;

function stripBom(s) {
  if (s && s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

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
      if (ch === ",")       { out.push(cur); cur = ""; }
      else if (ch === '"')  { inQuotes = true; }
      else                  { cur += ch; }
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseChaseCsv(text) {
  if (!text || typeof text !== "string") {
    return { rows: [], errors: ["Empty or unreadable file."] };
  }
  const cleaned = stripBom(text);
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["File needs a header row plus at least one trade row."] };
  }
  const headers = splitCsvLine(lines[0]);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      rows: [],
      errors: [
        "This doesn't look like a Chase brokerage transaction export. Missing column" + (missing.length === 1 ? "" : "s") + ": " + missing.join(", ") + ". The file should have these columns in row 1: Trade Date, Account Name, Type, Description, Ticker, Security Type, Price USD, Quantity, Amount USD (plus the rest of the standard Chase header — 31 columns total).",
      ],
    };
  }
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i] : ""; });
    return obj;
  });
  return { rows, errors: [] };
}

export function parseChaseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy = 2000 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return yy.toString().padStart(4, "0") + "-" + mm.toString().padStart(2, "0") + "-" + dd.toString().padStart(2, "0");
}

export function parseOptionDescription(desc) {
  if (!desc) return null;
  const m = String(desc).trim().match(/^(CALL|PUT)\s+([A-Z][A-Z0-9.\-]{0,9})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d.]+)\b/i);
  if (!m) return null;
  const contractType = m[1].toLowerCase();
  const underlyingTicker = m[2].toUpperCase();
  const expiration = parseChaseDate(m[3]);
  const strike = Number(m[4]);
  if (!expiration || !Number.isFinite(strike)) return null;
  return { contractType, underlyingTicker, expiration, strike };
}

export function isAssignmentRow(desc) {
  return /\bASSIGNED\b/i.test(String(desc || ""));
}

export function optionContractAction(desc) {
  const s = String(desc || "").toUpperCase();
  if (/\bCLOSING\s+CONTRACT\b/.test(s)) return "close";
  if (/\bOPEN\s+CONTRACT\b/.test(s))    return "open";
  return null;
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function mapChaseRowToTransaction(rawRow) {
  const tradeDateRaw = rawRow["Trade Date"];
  const accountLabel = (rawRow["Account Name"] || "").trim();
  const accountNumber = (rawRow["Account Number"] || "").trim();
  const typeRaw = (rawRow["Type"] || "").trim();
  const description = (rawRow["Description"] || "").trim();
  const tickerRaw = (rawRow["Ticker"] || "").trim();
  const securityType = (rawRow["Security Type"] || "").trim().toLowerCase();
  const priceUsd = toNum(rawRow["Price USD"]);
  const quantityRaw = toNum(rawRow["Quantity"]);
  const amountUsd = toNum(rawRow["Amount USD"]);
  const commissionsUsd = toNum(rawRow["Commissions USD"]) || 0;
  const tranCodeDesc = (rawRow["Tran Code Description"] || "").trim();
  const cusip = (rawRow["Cusip"] || "").trim();

  const glShort = toNum(rawRow["G/L Short USD"]);
  const glLong = toNum(rawRow["G/L Long USDs"]);
  const glLongAlt = toNum(rawRow["G/L Long USD"]);
  const glLongFinal = glLong != null ? glLong : glLongAlt;

  const executedDate = parseChaseDate(tradeDateRaw);
  if (!executedDate) {
    return { tx: null, classification: "error", error: "Trade Date is missing or unreadable: \"" + tradeDateRaw + "\"" };
  }
  if (!accountLabel) {
    return { tx: null, classification: "error", error: "Account Name is empty (Trade Date " + tradeDateRaw + ")." };
  }

  const typeUpper = typeRaw.toUpperCase();
  if (typeUpper !== "BUY" && typeUpper !== "SELL") {
    return {
      tx: null,
      classification: "skipped",
      error: "Row type \"" + (typeRaw || "(blank)") + "\" is not yet supported (only Buy / Sell trades). Description: \"" + description.slice(0, 60) + "\"",
    };
  }

  const isOption = securityType === "option" || /^(CALL|PUT)\s/i.test(description);
  const assetClass = isOption ? "option" : "stock";
  const side = typeUpper;

  if (quantityRaw == null) {
    return { tx: null, classification: "error", error: "Quantity is missing on a " + typeRaw + " row." };
  }
  const quantity = Math.abs(quantityRaw);
  if (!(quantity > 0)) {
    return { tx: null, classification: "error", error: "Quantity must be greater than zero (got " + quantityRaw + ")." };
  }

  let contractType = null;
  let direction = null;
  let strike = null;
  let expiration = null;
  let underlyingTicker = tickerRaw.toUpperCase();
  let multiplier = 1;
  let priceForLedger = priceUsd;

  if (isOption) {
    multiplier = OPTION_MULTIPLIER_DEFAULT;
    if (priceUsd != null) priceForLedger = priceUsd * OPTION_MULTIPLIER_DEFAULT;
    const parsed = parseOptionDescription(description);
    if (parsed) {
      contractType = parsed.contractType;
      strike = parsed.strike;
      expiration = parsed.expiration;
      underlyingTicker = parsed.underlyingTicker;
    }
    const action = optionContractAction(description);
    if (action === "open") direction = side === "BUY" ? "long" : "short";
    else if (action === "close") direction = side === "BUY" ? "short" : "long";
  }

  let realizedPnl = null;
  let isLongTerm = null;
  if (glShort != null && glShort !== 0) {
    realizedPnl = glShort;
    isLongTerm = false;
  } else if (glLongFinal != null && glLongFinal !== 0) {
    realizedPnl = glLongFinal;
    isLongTerm = true;
  }

  const grossProceeds = amountUsd != null ? Math.abs(amountUsd) : (priceForLedger != null ? quantity * priceForLedger : null);
  const netProceeds = grossProceeds != null ? grossProceeds - (commissionsUsd || 0) : null;

  const action = optionContractAction(description);
  const noteParts = [];
  if (isAssignmentRow(description)) noteParts.push("ASSIGNED (option exercise)");
  if (action) noteParts.push(action === "open" ? "Open contract" : "Closing contract");
  if (cusip) noteParts.push("CUSIP " + cusip);
  noteParts.push("Imported from Chase (" + tradeDateRaw + "). Desc: " + description.slice(0, 120));
  const notes = noteParts.join(" · ");

  let classification = "";
  if (assetClass === "stock") {
    classification = isAssignmentRow(description)
      ? "Stock " + (side === "SELL" ? "sold" : "bought") + " via option assignment"
      : "Stock " + (side === "SELL" ? "sold" : "bought");
  } else {
    const dirWord = direction === "long" ? "long" : direction === "short" ? "short" : "";
    const actionWord = action === "open" ? "opened" : action === "close" ? "closed" : (side === "BUY" ? "bought" : "sold");
    classification = ("Option " + dirWord + " " + actionWord).replace(/\s+/g, " ").trim();
  }

  const tx = {
    account_label: accountLabel,
    account_number_last4: accountNumber.replace(/[^\d]/g, "").slice(-4) || null,
    ticker: assetClass === "option" ? underlyingTicker : tickerRaw.toUpperCase(),
    asset_class: assetClass,
    side,
    quantity,
    price: priceForLedger,
    multiplier,
    fees: commissionsUsd,
    gross_proceeds: grossProceeds,
    net_proceeds: netProceeds,
    realized_pnl: realizedPnl,
    is_long_term: isLongTerm,
    contract_type: contractType,
    direction,
    strike,
    expiration,
    notes,
    executed_at: executedDate,
    dedup_key: dedupKey({
      accountLabel,
      ticker: assetClass === "option" ? underlyingTicker : tickerRaw.toUpperCase(),
      executedDate,
      side,
      assetClass,
      quantity,
    }),
  };

  return { tx, classification, error: null };
}

export function dedupKey({ accountLabel, ticker, executedDate, side, assetClass, quantity }) {
  return [
    (accountLabel || "").trim().toLowerCase(),
    (ticker || "").trim().toUpperCase(),
    executedDate,
    side,
    assetClass,
    Math.abs(Number(quantity) || 0).toFixed(6),
  ].join("|");
}

export function classifyChaseCsv(text) {
  const { rows, errors } = parseChaseCsv(text);
  if (errors.length) return { transactions: [], skipped: [], errors, headerErrors: errors };

  const transactions = [];
  const skipped = [];
  const rowErrors = [];

  rows.forEach((rawRow, idx) => {
    const { tx, classification, error } = mapChaseRowToTransaction(rawRow);
    const rowNum = idx + 2;
    if (tx) {
      transactions.push({ rowNum, classification, ...tx, raw: rawRow });
    } else if (classification === "skipped") {
      skipped.push({ rowNum, reason: error, raw: rawRow });
    } else {
      rowErrors.push({ rowNum, reason: error, raw: rawRow });
    }
  });

  return { transactions, skipped, errors: rowErrors, headerErrors: [] };
}
