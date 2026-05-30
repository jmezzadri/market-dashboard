// importMapping.js — figure out what a brokerage file IS and which column is
// which, without requiring a fixed template.
//
// Two jobs:
//   1. detectKind(headers, sampleRows) → is this a list of CURRENT HOLDINGS
//      (what you own now) or BUY/SELL HISTORY (every trade)?
//   2. autoMap(headers, kind) → best guess at which of the file's columns maps
//      to each field we need, with a confidence flag so the UI can ask the
//      user to confirm anything it isn't sure about.
//
// The trade path deliberately produces rows keyed by the canonical Chase
// header names so they flow straight through the existing, signed-off
// mapChaseRowToTransaction logic (option multiplier, realized P&L, dedup).
//
// Pure functions. No React, no network, no DOM.

// ── normalization ───────────────────────────────────────────────────────────
// Lowercase, drop punctuation, collapse whitespace. "Price ($)" → "price".
export function normalizeHeader(h) {
  return String(h == null ? "" : h)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")     // drop parentheticals like "($)" / "(usd)"
    .replace(/[^a-z0-9]+/g, " ")  // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

// ── canonical fields + aliases ──────────────────────────────────────────────
// For trades, the canonical key IS the Chase header name the downstream mapper
// reads, so buildTransactionRows can write straight into that shape.
//
// Each entry: { key, required, aliases:[normalized strings] }. Matching is:
// exact normalized alias = high confidence; substring either direction = low.

const TRADE_FIELDS = [
  { key: "Trade Date", required: true, aliases: [
    "trade date", "date", "run date", "activity date", "transaction date",
    "trade date time", "date time", "as of date", "executed", "execution date",
  ] },
  { key: "Type", required: true, aliases: [
    "type", "action", "transaction type", "buy sell", "activity", "transaction",
    "side", "order type", "trans type",
  ] },
  { key: "Ticker", required: true, aliases: [
    "ticker", "symbol", "security symbol", "security id", "ticker symbol", "sym",
  ] },
  { key: "Quantity", required: true, aliases: [
    "quantity", "qty", "shares", "share quantity", "units", "no of shares",
    "share qty", "filled qty",
  ] },
  { key: "Price USD", required: false, aliases: [
    "price usd", "price", "price local", "unit price", "share price",
    "execution price", "price per share", "avg price", "trade price",
  ] },
  { key: "Amount USD", required: false, aliases: [
    "amount usd", "amount", "net amount", "principal", "total", "proceeds",
    "transaction amount", "net cash", "amount local",
  ] },
  { key: "Description", required: false, aliases: [
    "description", "security description", "security", "investment", "memo",
    "transaction description", "details", "name",
  ] },
  { key: "Security Type", required: false, aliases: [
    "security type", "asset type", "security category", "instrument type",
    "investment type", "asset class",
  ] },
  { key: "Account Name", required: false, aliases: [
    "account name", "account", "acct", "account description", "registration",
  ] },
  { key: "Account Number", required: false, aliases: [
    "account number", "account no", "acct number", "acct no", "account",
  ] },
  { key: "Commissions USD", required: false, aliases: [
    "commissions usd", "commission", "commissions", "fees", "fee", "comm",
    "fees and commissions", "commissions local",
  ] },
  { key: "Cusip", required: false, aliases: ["cusip"] },
  { key: "G/L Short USD", required: false, aliases: [
    "g l short usd", "g l short", "short term gain loss", "st gain loss",
    "gain loss short",
  ] },
  { key: "G/L Long USDs", required: false, aliases: [
    "g l long usds", "g l long usd", "g l long", "long term gain loss",
    "lt gain loss", "gain loss long",
  ] },
];

// Holdings canonical keys match the existing positions importer schema.
const HOLDING_FIELDS = [
  { key: "account", required: false, aliases: [
    "account name", "account", "acct", "registration", "account description",
  ] },
  { key: "ticker", required: true, aliases: [
    "ticker", "symbol", "security symbol", "security id", "ticker symbol", "sym",
  ] },
  { key: "quantity", required: true, aliases: [
    "quantity", "qty", "shares", "share quantity", "units", "current shares",
    "share qty",
  ] },
  { key: "cost_per_share", required: false, aliases: [
    "cost per share", "cost share", "avg cost", "average cost", "unit cost",
    "cost basis per share", "average cost basis", "purchase price", "price paid",
    "avg price", "cost basis share",
  ] },
  { key: "cost_basis_total", required: false, aliases: [
    "cost basis", "total cost", "cost", "total cost basis", "book value",
  ] },
  { key: "purchase_date", required: false, aliases: [
    "purchase date", "date acquired", "acquired", "acquisition date",
    "open date", "date",
  ] },
];

// ── matching ────────────────────────────────────────────────────────────────
function matchField(field, normHeaders) {
  // Pass 1: exact alias match → high confidence.
  for (let i = 0; i < normHeaders.length; i++) {
    if (field.aliases.includes(normHeaders[i])) return { index: i, confidence: "high" };
  }
  // Pass 2: the file's header CONTAINS a full alias phrase → low confidence
  // (user confirms). Only this direction, and only for aliases of real length,
  // so "Cost Basis" (a total) never gets grabbed by the "cost basis per share"
  // alias and short tokens like "b" don't match unrelated words.
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i];
    if (!h) continue;
    for (const a of field.aliases) {
      if (a.length >= 4 && h.includes(a)) return { index: i, confidence: "low" };
    }
  }
  return { index: -1, confidence: "none" };
}

function autoMapFields(fields, headers) {
  const normHeaders = headers.map(normalizeHeader);
  const mapping = {};
  const confidence = {};
  const used = new Set();
  for (const field of fields) {
    const m = matchField(field, normHeaders);
    // Don't let two canonical fields claim the same column (e.g. Account Name
    // vs Account Number both seeing "account"); the first/required wins.
    if (m.index >= 0 && !used.has(m.index)) {
      mapping[field.key] = m.index;
      confidence[field.key] = m.confidence;
      used.add(m.index);
    } else {
      mapping[field.key] = -1;
      confidence[field.key] = "none";
    }
  }
  const missingRequired = fields
    .filter((f) => f.required && (mapping[f.key] == null || mapping[f.key] < 0))
    .map((f) => f.key);
  return { mapping, confidence, missingRequired };
}

// ── public: kind detection ──────────────────────────────────────────────────
// Normalize a broker's action/side value to "Buy" / "Sell" (or pass the value
// through unchanged so non-trades like "Dividend" / "Transfer" / "Reinvest" /
// "BNK" get classified as non-trades and skipped). This is what keeps us to
// the "buys and sells only" behavior Joe chose: we only convert values the
// broker itself calls a buy or a sell. Word-boundary matching avoids the trap
// where a code like "BNK" looks like it "starts with B".
export function normalizeSideValue(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "";
  if (s === "b") return "Buy";
  if (s === "s") return "Sell";
  if (/\b(sell|sold|sale)\b/.test(s)) return "Sell";
  if (/\b(buy|bought|purchase)\b/.test(s)) return "Buy";
  return v; // unknown action → leave as-is so it's skipped as a non-trade
}

function isBuyOrSell(v) {
  const n = normalizeSideValue(v);
  return n === "Buy" || n === "Sell";
}

// Decide holdings vs transactions from the headers (and a peek at the values
// of the most likely "action" column). A Buy/Sell action column is the single
// strongest signal of a transactions file; a per-share cost column with no
// action column signals a holdings file.
export function detectKind(headers, sampleRows = []) {
  const normHeaders = headers.map(normalizeHeader);
  const has = (aliases) => normHeaders.some((h) => aliases.some((a) => h === a || h.includes(a)));

  const sideCol = (() => {
    const field = TRADE_FIELDS.find((f) => f.key === "Type");
    const m = matchField(field, normHeaders);
    return m.index;
  })();

  // Sniff the candidate action column's values for buy/sell-like tokens.
  let sideValuesLookTradey = false;
  if (sideCol >= 0 && sampleRows.length) {
    let hits = 0;
    for (const r of sampleRows.slice(0, 50)) {
      if (isBuyOrSell(String((r || [])[sideCol] || ""))) hits++;
    }
    sideValuesLookTradey = hits > 0;
  }

  const hasTradeDate = has(["trade date", "run date", "activity date", "transaction date"]);
  const hasCostPerShare = has(["cost per share", "average cost", "avg cost", "average cost basis", "cost basis per share", "unit cost"]);
  const hasAmount = has(["amount", "proceeds", "principal"]);
  const hasQty = has(["quantity", "qty", "shares"]);
  const hasTicker = has(["ticker", "symbol"]);

  let txScore = 0;
  if (sideCol >= 0) txScore += 2;
  if (sideValuesLookTradey) txScore += 2;
  if (hasTradeDate) txScore += 1;
  if (hasAmount) txScore += 1;

  let holdScore = 0;
  if (hasCostPerShare) holdScore += 2;
  if (hasQty) holdScore += 1;
  if (hasTicker) holdScore += 1;
  if (sideCol < 0) holdScore += 1; // no action column at all leans holdings

  if (txScore >= holdScore && txScore >= 2) return "transactions";
  if (holdScore >= 2) return "holdings";
  return "unknown";
}

// ── public: auto-map ────────────────────────────────────────────────────────
export function autoMap(headers, kind) {
  const fields = kind === "holdings" ? HOLDING_FIELDS : TRADE_FIELDS;
  return autoMapFields(fields, headers);
}

export function fieldSpec(kind) {
  return kind === "holdings" ? HOLDING_FIELDS : TRADE_FIELDS;
}

// ── public: build rows from a mapping ───────────────────────────────────────
// Transactions: produce objects keyed by the canonical Chase header names so
// they feed straight into classifyRows(). `defaultAccount` fills in when the
// file has no account column.
export function buildTransactionRows(dataRows, mapping, { defaultAccount = "" } = {}) {
  const at = (row, key) => {
    const idx = mapping[key];
    return idx != null && idx >= 0 ? (row[idx] != null ? String(row[idx]) : "") : "";
  };
  return (dataRows || []).map((row) => {
    const rawType = at(row, "Type");
    return {
      "Trade Date": at(row, "Trade Date"),
      "Account Name": at(row, "Account Name") || defaultAccount || "",
      "Account Number": at(row, "Account Number"),
      "Type": normalizeSideValue(rawType),
      "Description": at(row, "Description"),
      "Cusip": at(row, "Cusip"),
      "Ticker": at(row, "Ticker"),
      "Security Type": at(row, "Security Type"),
      "Price USD": at(row, "Price USD"),
      "Quantity": at(row, "Quantity"),
      "Amount USD": at(row, "Amount USD"),
      "Commissions USD": at(row, "Commissions USD"),
      "G/L Short USD": at(row, "G/L Short USD"),
      "G/L Long USDs": at(row, "G/L Long USDs"),
    };
  });
}

// Holdings: produce { account, ticker, quantity, cost_per_share, purchase_date }
// matching the positions importer. Derives per-share cost from a total
// cost-basis column when only that is present.
export function buildHoldingsRows(dataRows, mapping, { defaultAccount = "" } = {}) {
  const at = (row, key) => {
    const idx = mapping[key];
    return idx != null && idx >= 0 ? (row[idx] != null ? String(row[idx]).trim() : "") : "";
  };
  const num = (s) => {
    const n = Number(String(s).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return (dataRows || []).map((row) => {
    const qty = num(at(row, "quantity"));
    let cps = at(row, "cost_per_share");
    if ((cps === "" || num(cps) == null) && qty) {
      const totalCB = num(at(row, "cost_basis_total"));
      if (totalCB != null && qty) cps = String(totalCB / qty);
    }
    return {
      account: at(row, "account") || defaultAccount || "",
      ticker: at(row, "ticker"),
      quantity: at(row, "quantity"),
      cost_per_share: cps,
      purchase_date: at(row, "purchase_date"),
    };
  });
}
