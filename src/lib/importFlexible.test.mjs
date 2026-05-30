// importFlexible.test.mjs — proves the flexible importer reads real-world,
// non-templated brokerage files: the actual Chase 90-day export (an HTML
// table saved as .xls), plus synthetic Fidelity-style and holdings layouts.
//
// Run: node src/lib/importFlexible.test.mjs
// (reads the fixture via SheetJS exactly like the browser reader does)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { detectKind, autoMap, buildTransactionRows, buildHoldingsRows, normalizeSideValue } from "./importMapping.js";
import { classifyRows } from "./transactionsClassify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLS = path.resolve(__dirname, "../../test_fixtures/sample_broker_html.xls");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else      { fail++; console.error("  FAIL " + msg); }
}

// Mirror importReader.readTabularFile's core: SheetJS grid from the bytes.
function gridFromFile(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: false })
    .map((r) => r.map((c) => (c == null ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c !== ""));
}

console.log("\n== Brokerage HTML table saved as .xls (the Chase / Schwab quirk) ==");
const grid = gridFromFile(XLS);
const headers = grid[0];
const dataRows = grid.slice(1);
assert(headers.length === 31, `31 columns read from the HTML-table file (got ${headers.length})`);
assert(dataRows.length === 6, `6 data rows read (got ${dataRows.length})`);

const kind = detectKind(headers, dataRows);
assert(kind === "transactions", `detected as buy/sell history (got "${kind}")`);

const { mapping, confidence, missingRequired } = autoMap(headers, "transactions");
assert(missingRequired.length === 0, `every required field mapped (missing: ${missingRequired.join(", ") || "none"})`);
assert(confidence["Trade Date"] === "high" && confidence["Type"] === "high" && confidence["Ticker"] === "high" && confidence["Quantity"] === "high",
  "Trade Date / Type / Ticker / Quantity all matched with high confidence");

const built = buildTransactionRows(dataRows, mapping);
const { transactions, skipped, errors: rowErrors } = classifyRows(built);
console.log(`     → ${transactions.length} trades, ${skipped.length} skipped, ${rowErrors.length} errors`);
assert(transactions.length === 3, `3 trades classified — 2 stock + 1 option (got ${transactions.length})`);
assert(skipped.length === 3, `3 non-trade rows skipped — dividend, transfer, reinvest (got ${skipped.length})`);
assert(rowErrors.length === 0, `no row errors (got ${rowErrors.length})`);
assert(transactions.every((t) => t.side === "BUY" || t.side === "SELL"), "every classified row is a Buy or Sell");
assert(transactions.some((t) => t.asset_class === "option" && t.ticker === "GGGG" && t.strike === 450),
  "the option open is recognized (underlying GGGG, strike 450)");
assert(transactions.every((t) => t.dedup_key && t.executed_at && /^\d{4}-\d{2}-\d{2}$/.test(t.executed_at)),
  "every trade has a dedup key and an ISO date for the server-side de-dup");

console.log("\n== Synthetic Fidelity-style layout (different names + 'YOU BOUGHT') ==");
const fidHeaders = ["Run Date", "Action", "Symbol", "Description", "Quantity", "Price ($)", "Commission ($)", "Amount ($)", "Account"];
const fidRows = [
  ["05/01/2026", "YOU BOUGHT", "AAPL", "APPLE INC", "10", "150.00", "0", "-1500.00", "Individual"],
  ["05/02/2026", "YOU SOLD", "MSFT", "MICROSOFT CORP", "5", "400.00", "0", "2000.00", "Individual"],
  ["05/03/2026", "DIVIDEND RECEIVED", "AAPL", "APPLE INC", "", "", "0", "12.50", "Individual"],
];
assert(detectKind(fidHeaders, fidRows) === "transactions", "Fidelity-style file detected as buy/sell history");
const fidMap = autoMap(fidHeaders, "transactions");
assert(fidMap.missingRequired.length === 0, `Fidelity required fields mapped (missing: ${fidMap.missingRequired.join(", ") || "none"})`);
assert(normalizeSideValue("YOU BOUGHT") === "Buy" && normalizeSideValue("YOU SOLD") === "Sell", "'YOU BOUGHT'/'YOU SOLD' normalize to Buy/Sell");
const fidTx = classifyRows(buildTransactionRows(fidRows, fidMap.mapping));
assert(fidTx.transactions.length === 2, `2 trades from Fidelity sample, dividend skipped (got ${fidTx.transactions.length})`);
assert(fidTx.transactions[0].ticker === "AAPL" && fidTx.transactions[0].side === "BUY", "AAPL buy mapped");
assert(fidTx.transactions[1].ticker === "MSFT" && fidTx.transactions[1].side === "SELL", "MSFT sell mapped");

console.log("\n== Synthetic holdings layout (current positions, no action column) ==");
const holdHeaders = ["Account Name", "Symbol", "Quantity", "Average Cost Basis", "Date Acquired"];
const holdRows = [
  ["Roth IRA", "VOO", "25", "450.00", "03/15/2024"],
  ["Taxable", "NVDA", "5.5", "600.00", "2024-01-10"],
];
assert(detectKind(holdHeaders, holdRows) === "holdings", "holdings file detected as current holdings");
const holdMap = autoMap(holdHeaders, "holdings");
assert(holdMap.missingRequired.length === 0, `holdings required fields mapped (missing: ${holdMap.missingRequired.join(", ") || "none"})`);
const builtHold = buildHoldingsRows(holdRows, holdMap.mapping);
assert(builtHold[0].ticker === "VOO" && Number(builtHold[0].quantity) === 25 && Number(builtHold[0].cost_per_share) === 450,
  "VOO holding mapped (qty 25, cost 450)");

console.log("\n== Holdings with only a TOTAL cost basis (derive per-share) ==");
const totHeaders = ["Account", "Ticker", "Shares", "Cost Basis"];
const totRows = [["Brokerage", "SPY", "10", "5000"]];
const totMap = autoMap(totHeaders, "holdings");
const totBuilt = buildHoldingsRows(totRows, totMap.mapping);
assert(Number(totBuilt[0].cost_per_share) === 500, `per-share cost derived from total (5000/10 = 500, got ${totBuilt[0].cost_per_share})`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
