// Node-runnable test against Joe's actual Chase file (2026-05-04).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChaseCsv, classifyChaseCsv, parseChaseDate, parseOptionDescription } from "./chaseImporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_PATH = process.argv[2] || path.resolve(__dirname, "../../test_fixtures/chase_transactions_2026-05-04.csv");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ok  " + msg); }
  else      { fail++; console.error("  FAIL " + msg); }
}

console.log("\nLoading: " + CSV_PATH + "\n");
if (!fs.existsSync(CSV_PATH)) { console.error("Fixture not found"); process.exit(2); }
const csv = fs.readFileSync(CSV_PATH, "utf-8");

console.log("-- Header parsing --");
const parsed = parseChaseCsv(csv);
assert(parsed.errors.length === 0, "no header errors");
assert(parsed.rows.length === 17, "parsed 17 trade rows (got " + parsed.rows.length + ")");

console.log("\n-- Date parsing --");
assert(parseChaseDate("4/29/2026") === "2026-04-29", "M/D/YYYY -> YYYY-MM-DD");
assert(parseChaseDate("4/10/26") === "2026-04-10", "M/D/YY -> YYYY-MM-DD");
assert(parseChaseDate("garbage") === null, "garbage returns null");

console.log("\n-- Option description parsing --");
const opt1 = parseOptionDescription("PUT NVDA 07/17/26 195 NVIDIA CORPORATION UNSOLICITED CLOSING CONTRACT Exchange Listed Option");
assert(opt1 && opt1.contractType === "put" && opt1.underlyingTicker === "NVDA" && opt1.strike === 195 && opt1.expiration === "2026-07-17", "NVDA Jul 26 195 PUT parsed");
const opt2 = parseOptionDescription("CALL GLD 04/10/26 450 SPDR GOLD TR UNSOLICITED OPEN CONTRACT");
assert(opt2 && opt2.contractType === "call" && opt2.underlyingTicker === "GLD" && opt2.strike === 450 && opt2.expiration === "2026-04-10", "GLD Apr 26 450 CALL parsed");

console.log("\n-- Classification --");
const { transactions, skipped, errors, headerErrors } = classifyChaseCsv(csv);
assert(headerErrors.length === 0, "no header errors");
assert(errors.length === 0, "no row errors (got " + errors.length + (errors.length ? ": " + errors.map(e => e.reason).join("; ") : "") + ")");
assert(skipped.length === 0, "no skipped rows (got " + skipped.length + ")");
assert(transactions.length === 17, "17 transactions classified (got " + transactions.length + ")");

const stockBuys = transactions.filter(t => t.asset_class === "stock" && t.side === "BUY");
const stockSells = transactions.filter(t => t.asset_class === "stock" && t.side === "SELL");
const optionBuys = transactions.filter(t => t.asset_class === "option" && t.side === "BUY");
const optionSells = transactions.filter(t => t.asset_class === "option" && t.side === "SELL");
console.log("  -> " + stockBuys.length + " stock buys, " + stockSells.length + " stock sells, " + optionBuys.length + " option buys, " + optionSells.length + " option sells");
assert(stockBuys.length === 6, "6 stock buys");
assert(stockSells.length === 6, "6 stock sells (incl. 1 assignment)");
assert(optionBuys.length === 1, "1 option buy (NVDA put open)");
assert(optionSells.length === 4, "4 option sells (3 sell-to-open Apr 6 + 1 sell-to-close NVDA put)");

console.log("\n-- Spot checks --");
const oxy = transactions.find(t => t.ticker === "OXY" && t.executed_at === "2026-04-29");
assert(oxy && oxy.side === "SELL" && oxy.quantity === 500 && oxy.price === 59.69 && oxy.gross_proceeds === 29841.88, "OXY 4/29 sell mapped");

const ondsBuy = transactions.find(t => t.ticker === "ONDS" && t.executed_at === "2026-04-27");
assert(ondsBuy && ondsBuy.side === "BUY" && ondsBuy.quantity === 500 && ondsBuy.price === 10.48 && ondsBuy.gross_proceeds === 5240, "ONDS 4/27 buy 500 @ $10.48 mapped");

const nvdaPutClose = transactions.find(t => t.ticker === "NVDA" && t.asset_class === "option" && t.executed_at === "2026-04-27");
assert(nvdaPutClose && nvdaPutClose.side === "SELL", "NVDA put close = SELL");
assert(nvdaPutClose && nvdaPutClose.contract_type === "put", "NVDA put close contract_type=put");
assert(nvdaPutClose && nvdaPutClose.strike === 195, "NVDA put close strike=195");
assert(nvdaPutClose && nvdaPutClose.expiration === "2026-07-17", "NVDA put close expiration=2026-07-17");
assert(nvdaPutClose && nvdaPutClose.quantity === 1, "NVDA put close qty=1 contract");
assert(nvdaPutClose && nvdaPutClose.price === 790, "NVDA put close price=$790 per-contract (got " + (nvdaPutClose && nvdaPutClose.price) + ")");
assert(nvdaPutClose && nvdaPutClose.multiplier === 100, "NVDA option multiplier=100");
assert(nvdaPutClose && nvdaPutClose.direction === "long", "NVDA put close direction=long (was a long position)");

const nvdaPutOpen = transactions.find(t => t.ticker === "NVDA" && t.asset_class === "option" && t.executed_at === "2026-04-20");
assert(nvdaPutOpen && nvdaPutOpen.side === "BUY", "NVDA put open = BUY");
assert(nvdaPutOpen && nvdaPutOpen.direction === "long", "NVDA put open direction=long");
assert(nvdaPutOpen && nvdaPutOpen.price === 1193, "NVDA put open price=$1193 per-contract (got " + (nvdaPutOpen && nvdaPutOpen.price) + ")");

const nvdaAssign = transactions.find(t => t.ticker === "NVDA" && t.asset_class === "stock" && t.executed_at === "2026-04-10");
assert(nvdaAssign && nvdaAssign.side === "SELL" && nvdaAssign.quantity === 100 && nvdaAssign.price === 177.5, "NVDA 4/10 assignment-sell mapped");
assert(nvdaAssign && nvdaAssign.notes.includes("ASSIGNED"), "NVDA assignment row notes flagged ASSIGNED");

const gldCallShort = transactions.find(t => t.ticker === "GLD" && t.asset_class === "option");
assert(gldCallShort && gldCallShort.side === "SELL" && gldCallShort.direction === "short", "GLD call written = SELL + short");
assert(gldCallShort && gldCallShort.quantity === 2 && gldCallShort.price === 90, "GLD call written 2 @ $90/contract (got qty=" + (gldCallShort && gldCallShort.quantity) + ", price=" + (gldCallShort && gldCallShort.price) + ")");

console.log("\n-- Dedup keys --");
const dedupKeys = new Set(transactions.map(t => t.dedup_key));
assert(dedupKeys.size === 17, "every transaction has a unique dedup key (" + dedupKeys.size + "/17)");

console.log("\n-- Realized P&L (none filled in this file - regular trade export) --");
const withRealizedPnl = transactions.filter(t => t.realized_pnl != null);
assert(withRealizedPnl.length === 0, "no realized P&L set (regular export, not tax export)");

console.log("\n" + "=".repeat(40) + "\n" + pass + " pass | " + fail + " fail\n" + "=".repeat(40) + "\n");
if (fail > 0) process.exit(1);
