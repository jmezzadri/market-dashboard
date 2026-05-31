// portfolioAnalytics.test.mjs — validates classification + options decomposition
// against Joe's real book. Run: node src/overhaul/lib/portfolioAnalytics.test.mjs
import { classifyPosition, decomposeOption, buildBook } from "./portfolioAnalytics.js";

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.error("  FAIL " + m); } };

console.log("\n== Classification (the data foundation) ==");
const C = (p) => classifyPosition(p);
assert(C({ ticker: "JHYUX", name: "John Hancock High Yield", asset_class: "stock", sector: "HY Bonds" }).ac === "Fixed Income",
  "JHYUX (HY bond fund) classifies as Fixed Income, NOT stock");
assert(C({ ticker: "JHYUX" }).sector === "High Yield", "JHYUX sector = High Yield (not an equity sector)");
assert(C({ ticker: "NHXINT906", asset_class: "stock" }).ac === "Equity" && C({ ticker: "NHXINT906" }).geo === "Intl",
  "NHXINT906 = International equity");
assert(C({ ticker: "PLSE" }).sector === "Health Care", "PLSE = Health Care equity");
assert(C({ ticker: "GLD" }).ac === "Commodity" && C({ ticker: "SLV" }).ac === "Commodity", "GLD/SLV = Commodity");
assert(C({ ticker: "FBTC" }).ac === "Crypto" && C({ ticker: "ETHE" }).ac === "Crypto", "FBTC/ETHE = Crypto");
assert(C({ ticker: "CASH", asset_class: "cash" }).ac === "Cash" && C({ ticker: "SPAXX", asset_class: "cash" }).ac === "Cash", "CASH/SPAXX = Cash");
// heuristics for unseen tickers — no Unknown
assert(C({ ticker: "ZZZHY", name: "Vanguard High Yield Corporate" }).ac === "Fixed Income", "unseen HY bond fund → Fixed Income (heuristic)");
assert(C({ ticker: "XYZ", name: "Some Corp", sector: "unknown" }).ac === "Equity" && C({ ticker: "XYZ", sector: "unknown" }).sector !== "unknown",
  "unseen name with 'unknown' sector → Equity / Diversified (never 'Unknown')");

console.log("\n== Options decomposition (by underlier, long/short, delta-equiv, protection) ==");
const qqqPut = { ticker: "QQQ", asset_class: "option", contract_type: "put", strike: 670, multiplier: 100, quantity: 4, value: 2018 };
const dec = decomposeOption(qqqPut, { spots: { QQQ: 600 }, deltas: { "QQQ:670:put": -0.30 } });
assert(dec.underlier === "QQQ", "underlier is QQQ, not 'option'");
assert(dec.direction === "long" && dec.label === "long put", "direction captured: long put");
assert(dec.isDownsideHedge === true, "long put recognized as a downside hedge");
assert(dec.deltaEquivShares === -120, `delta-equivalent = -120 shares (4 x 100 x -0.30) (got ${dec.deltaEquivShares})`);
assert(dec.deltaEquivNotional === -72000, `delta-equivalent short = -$72,000 (-120 x $600 spot) (got ${dec.deltaEquivNotional})`);
assert(dec.protectionNotional === 268000, `downside protection = $268,000 (4 x 100 x $670 strike) (got ${dec.protectionNotional})`);

console.log("\n== buildBook: economic exposure nets the put against equity ==");
const BOOK = [
  { ticker: "JHYUX", name: "John Hancock High Yield", asset_class: "stock", sector: "HY Bonds", value: 348379, beta: 0.30 },
  { ticker: "CASH", name: "Cash & sweep", asset_class: "cash", value: 110391 },
  { ticker: "NHXINT906", name: "Intl Equity", asset_class: "stock", value: 43292, beta: 0.95 },
  { ticker: "PLSE", name: "Pulse Biosciences", asset_class: "stock", value: 25000, beta: 1.10 },
  { ticker: "FXAIX", name: "Fidelity 500 Index", asset_class: "stock", value: 7374, beta: 1.0 },
  { ticker: "RCAT", name: "Red Cat", asset_class: "stock", value: 1877, beta: 3.20 },
  { ticker: "GLD", name: "SPDR Gold", asset_class: "stock", value: 1251, beta: 0.26 },
  { ticker: "FBTC", name: "Fidelity Bitcoin", asset_class: "stock", value: 1278, beta: 1.81 },
  { ticker: "QQQ", name: "QQQ Put", asset_class: "option", contract_type: "put", strike: 670, multiplier: 100, quantity: 4, value: 2018 },
];
const book = buildBook(BOOK, { spots: { QQQ: 600 }, deltas: { "QQQ:670:put": -0.30 } });
assert(Math.round(book.allocByClass["Fixed Income"]) === 348379, "raw allocation: Fixed Income = $348,379 (the HY fund)");
assert(book.allocByClass["Options"] === 2018, "raw allocation: Options shown as its own $2,018 line");
const rawEquity = 43292 + 25000 + 7374 + 1877; // funds + names
const econEquity = book.allocByEconomic["Equity"];
assert(Math.round(econEquity) === Math.round(rawEquity - 72000),
  `economic equity = long equity MINUS the put's $72K short delta (${Math.round(econEquity)} vs ${Math.round(rawEquity - 72000)})`);
assert(book.riskContribution[0].riskPct > 0 && book.riskContribution.every((x) => x.riskPct >= 0),
  "risk contribution computed for every position");
const jhyux = book.riskContribution.find((x) => x.ticker === "JHYUX");
assert(jhyux.riskPct < jhyux.weight, `JHYUX is less of the risk (${jhyux.riskPct.toFixed(0)}%) than its weight (${jhyux.weight.toFixed(0)}%) — low-beta credit`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
