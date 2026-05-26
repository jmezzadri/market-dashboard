/**
 * MacroTilt v2 — mock dataset.
 *
 * Ported verbatim from the design handoff (lm-core.jsx + shared.jsx).
 * This is the v1 stand-in. The page layer will swap each MT_* export for
 * the real Supabase/JSON-feed equivalent in subsequent commits — see
 * data_manifest.json mapping in the handoff README §"Data shapes".
 *
 * Senior Quant note: every MT_INDICATORS row carries a `pct` (5y
 * percentile) which RegimeCanvas + IndicatorDetail key off. When wiring
 * to real data, that field MUST come from the indicator engine's 5y
 * rolling percentile — never re-derive in the UI.
 */

/* Stable random walk for sparkline series. Seeded by index so a re-render
   doesn't redraw a different line; the design called for sparklines to
   draw on mount and stay still. */
export function gen(n, base, range, drift = 0, seedKey = "") {
  const out = [];
  let v = base;
  // Tiny xorshift seeded by string hash so each ind id gets a stable curve
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) h = ((h << 5) - h + seedKey.charCodeAt(i)) | 0;
  let s = h || 12345;
  const rng = () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  for (let i = 0; i < n; i++) {
    v += (rng() - 0.5) * range / 12 + drift * (i / n) * range / 30;
    out.push(v);
  }
  return out;
}

export const MT_INDICATORS = [
  { id: "yc", name: "Yield curve (10y−2y)", domain: "Rates", value: 43, unit: "bp", state: "calm", pct: 63, fresh: "fresh", asOf: "5d ago", trend: gen(60, 30, 24, 0, "yc"), delta: -10, dir: "down" },
  { id: "10yr", name: "10y real yield", domain: "Rates", value: 2.18, unit: "%", state: "extreme", pct: 93, fresh: "fresh", asOf: "6d ago", trend: gen(60, 60, 30, 0, "10yr"), delta: 0.29, dir: "up" },
  { id: "move", name: "MOVE · bond volatility", domain: "Rates", value: 78, unit: "", state: "calm", pct: 22, fresh: "fresh", asOf: "5d ago", trend: gen(60, 80, 30, 0, "move"), delta: 11, dir: "up" },
  { id: "tp", name: "Term premium", domain: "Rates", value: 81, unit: "bp", state: "extreme", pct: 100, fresh: "fresh", asOf: "May 15", trend: gen(60, 50, 30, 1, "tp"), delta: 16, dir: "up" },
  { id: "be10", name: "10y breakeven", domain: "Rates", value: 2.40, unit: "%", state: "calm", pct: 50, fresh: "fresh", asOf: "5d ago", trend: gen(60, 45, 30, 0, "be10"), delta: 0.02, dir: "up" },
  { id: "hyig", name: "HY−IG spread", domain: "Credit", value: 278, unit: "bp", state: "calm", pct: 31, fresh: "stale", asOf: "May 19", trend: gen(60, 100, 25, 0, "hyig"), delta: -8, dir: "down" },
  { id: "ig", name: "IG OAS", domain: "Credit", value: 92, unit: "bp", state: "calm", pct: 28, fresh: "fresh", asOf: "1d ago", trend: gen(60, 95, 18, 0, "ig"), delta: -2, dir: "down" },
  { id: "loans", name: "Bank loan demand", domain: "Credit", value: -8, unit: "%", state: "calm", pct: 42, fresh: "fresh", asOf: "1m ago", trend: gen(60, -5, 12, 0, "loans"), delta: 3, dir: "up" },
  { id: "delinq", name: "Credit-card delinq.", domain: "Credit", value: 3.1, unit: "%", state: "elevated", pct: 71, fresh: "fresh", asOf: "1m ago", trend: gen(60, 2.6, 0.6, 0, "delinq"), delta: 0.1, dir: "up" },
  { id: "cdx", name: "CDX HY spread", domain: "Credit", value: 322, unit: "bp", state: "calm", pct: 33, fresh: "fresh", asOf: "1h ago", trend: gen(60, 300, 30, 0, "cdx"), delta: -4, dir: "down" },
  { id: "skew", name: "SKEW Index", domain: "Equities", value: 137, unit: "", state: "elevated", pct: 71, fresh: "fresh", asOf: "4h ago", trend: gen(60, 120, 30, 0, "skew"), delta: 3, dir: "up" },
  { id: "cape", name: "CAPE", domain: "Equities", value: 42.0, unit: "x", state: "extreme", pct: 98, fresh: "fresh", asOf: "1d ago", trend: gen(60, 35, 20, 0, "cape"), delta: 0.4, dir: "up" },
  { id: "buff", name: "Buffett indicator", domain: "Equities", value: 230, unit: "%", state: "extreme", pct: 95, fresh: "fresh", asOf: "1d ago", trend: gen(60, 210, 25, 0, "buff"), delta: 2, dir: "up" },
  { id: "vix", name: "VIX", domain: "Equities", value: 14.8, unit: "", state: "calm", pct: 18, fresh: "fresh", asOf: "3m ago", trend: gen(60, 18, 8, 0, "vix"), delta: -1.2, dir: "down" },
  { id: "putc", name: "Put/call ratio", domain: "Equities", value: 0.86, unit: "", state: "calm", pct: 41, fresh: "fresh", asOf: "3m ago", trend: gen(60, 0.95, 0.3, 0, "putc"), delta: -0.04, dir: "down" },
  { id: "br", name: "Bank reserves", domain: "Money", value: 3130, unit: "b", state: "calm", pct: 65, fresh: "fresh", asOf: "May 20", trend: gen(60, 3000, 30, 0, "br"), delta: 180, dir: "up" },
  { id: "tga", name: "Treasury general account", domain: "Money", value: 781, unit: "b", state: "calm", pct: 38, fresh: "fresh", asOf: "May 20", trend: gen(60, 800, 40, 0, "tga"), delta: -132, dir: "down" },
  { id: "rrp", name: "Reverse repo", domain: "Money", value: 89, unit: "b", state: "calm", pct: 22, fresh: "fresh", asOf: "May 20", trend: gen(60, 120, 30, 0, "rrp"), delta: -8, dir: "down" },
  { id: "m2", name: "M2 yoy", domain: "Money", value: 3.8, unit: "%", state: "calm", pct: 45, fresh: "fresh", asOf: "1w ago", trend: gen(60, 3.2, 1, 0, "m2"), delta: 0.4, dir: "up" },
  { id: "dxy", name: "USD index", domain: "Money", value: 99.2, unit: "", state: "calm", pct: 52, fresh: "fresh", asOf: "3m ago", trend: gen(60, 100, 4, 0, "dxy"), delta: -0.1, dir: "down" },
  { id: "gold", name: "Gold / USD", domain: "Money", value: 3182, unit: "$", state: "elevated", pct: 78, fresh: "fresh", asOf: "3m ago", trend: gen(60, 3000, 150, 0, "gold"), delta: 24, dir: "up" },
  { id: "ic", name: "Initial claims", domain: "Economy", value: 209, unit: "k", state: "calm", pct: 38, fresh: "fresh", asOf: "4d ago", trend: gen(60, 220, 25, 0, "ic"), delta: 1, dir: "up" },
  { id: "jolts", name: "JOLTS quits", domain: "Economy", value: 2.0, unit: "%", state: "extreme", pct: 9, fresh: "fresh", asOf: "1w ago", trend: gen(60, 2.4, 0.5, 0, "jolts"), delta: -0.1, dir: "down" },
  { id: "pmi", name: "ISM Manufacturing", domain: "Economy", value: 49.4, unit: "", state: "elevated", pct: 32, fresh: "fresh", asOf: "1m ago", trend: gen(60, 50, 4, 0, "pmi"), delta: -0.6, dir: "down" },
  { id: "lei", name: "Leading econ. index", domain: "Economy", value: -0.6, unit: "%", state: "extreme", pct: 8, fresh: "fresh", asOf: "1m ago", trend: gen(60, 0, 0.8, 0, "lei"), delta: -0.2, dir: "down" },
  { id: "retail", name: "Retail sales mom", domain: "Economy", value: 0.2, unit: "%", state: "calm", pct: 48, fresh: "fresh", asOf: "2w ago", trend: gen(60, 0.3, 0.4, 0, "retail"), delta: -0.1, dir: "down" },
  { id: "cpi", name: "Core CPI yoy", domain: "Economy", value: 3.4, unit: "%", state: "elevated", pct: 73, fresh: "fresh", asOf: "2w ago", trend: gen(60, 3.6, 0.4, 0, "cpi"), delta: 0.1, dir: "up" },
];

export const MT_SECTORS = [
  { code: "XLK", name: "Technology", weight: 28.4, tilt: +6.2, score: 4.5 },
  { code: "XLF", name: "Financials", weight: 14.1, tilt: +2.1, score: 3.8 },
  { code: "XLV", name: "Health Care", weight: 12.6, tilt: -1.4, score: 2.6 },
  { code: "XLY", name: "Consumer Discretion", weight: 10.8, tilt: +0.6, score: 3.1 },
  { code: "XLC", name: "Communication", weight: 8.9, tilt: +1.8, score: 3.4 },
  { code: "XLI", name: "Industrials", weight: 8.4, tilt: -0.9, score: 2.9 },
  { code: "XLP", name: "Consumer Staples", weight: 6.1, tilt: -2.3, score: 2.1 },
  { code: "XLE", name: "Energy", weight: 4.2, tilt: -1.2, score: 2.5 },
  { code: "XLU", name: "Utilities", weight: 2.6, tilt: -0.4, score: 2.4 },
  { code: "XLB", name: "Materials", weight: 2.4, tilt: -1.1, score: 2.3 },
  { code: "XLRE", name: "Real Estate", weight: 1.5, tilt: -3.4, score: 1.9 },
];

export const MT_IG = {
  XLK: [
    { name: "Semiconductors", tilt: +3.8, weight: 9.2, score: 4.6, top: ["NVDA", "AVGO", "AMAT", "MU", "LRCX"] },
    { name: "Software · Infrastructure", tilt: +1.4, weight: 7.1, score: 4.1, top: ["MSFT", "ORCL", "PANW", "CRWD"] },
    { name: "Software · Application", tilt: +0.8, weight: 6.4, score: 3.8, top: ["CRM", "ADBE", "INTU", "NOW"] },
    { name: "Hardware · Peripherals", tilt: +0.2, weight: 3.9, score: 3.2, top: ["AAPL", "HPQ", "DELL"] },
    { name: "Communication Equipment", tilt: 0.0, weight: 1.8, score: 2.9, top: ["CSCO", "NTAP"] },
  ],
  XLF: [
    { name: "Banks · Diversified", tilt: +1.6, weight: 6.2, score: 4.0, top: ["JPM", "BAC", "WFC", "C"] },
    { name: "Capital Markets", tilt: +0.6, weight: 3.4, score: 3.7, top: ["GS", "MS", "SCHW"] },
    { name: "Insurance · Diversified", tilt: -0.4, weight: 2.6, score: 3.1, top: ["BRK.B", "PGR", "AIG"] },
    { name: "Banks · Regional", tilt: +0.3, weight: 1.9, score: 3.3, top: ["USB", "PNC", "TFC"] },
  ],
  XLV: [
    { name: "Drug Manufacturers · Major", tilt: -0.7, weight: 5.4, score: 2.8, top: ["LLY", "JNJ", "ABBV"] },
    { name: "Medical Devices", tilt: -0.4, weight: 3.2, score: 3.0, top: ["ISRG", "MDT", "SYK"] },
    { name: "Healthcare Plans", tilt: +0.1, weight: 2.1, score: 3.4, top: ["UNH", "ELV", "CI"] },
    { name: "Biotechnology", tilt: -0.4, weight: 1.9, score: 2.2, top: ["AMGN", "GILD", "REGN"] },
  ],
  XLY: [
    { name: "Internet Retail", tilt: +0.8, weight: 5.1, score: 3.6, top: ["AMZN", "EBAY", "ETSY"] },
    { name: "Auto Manufacturers", tilt: -0.2, weight: 1.9, score: 2.7, top: ["TSLA", "F", "GM"] },
    { name: "Specialty Retail", tilt: +0.0, weight: 1.6, score: 3.0, top: ["HD", "LOW", "TJX"] },
    { name: "Travel Services", tilt: 0.0, weight: 1.2, score: 2.8, top: ["BKNG", "ABNB", "MAR"] },
  ],
  XLC: [
    { name: "Internet Content & Info", tilt: +1.4, weight: 5.8, score: 4.2, top: ["GOOG", "META", "SPOT"] },
    { name: "Telecom · Diversified", tilt: +0.4, weight: 2.0, score: 2.9, top: ["T", "VZ", "TMUS"] },
    { name: "Entertainment", tilt: 0.0, weight: 1.1, score: 2.6, top: ["NFLX", "DIS", "RBLX"] },
  ],
  XLI: [
    { name: "Aerospace & Defense", tilt: -0.4, weight: 3.0, score: 2.9, top: ["BA", "LMT", "RTX"] },
    { name: "Railroads", tilt: -0.2, weight: 1.4, score: 3.1, top: ["UNP", "CSX", "NSC"] },
    { name: "Industrial Distribution", tilt: -0.3, weight: 1.6, score: 2.7, top: ["GWW", "FAST", "WCC"] },
  ],
  XLP: [
    { name: "Discount Stores", tilt: -0.6, weight: 2.4, score: 2.0, top: ["WMT", "COST", "TGT"] },
    { name: "Beverages · Non-Alcoholic", tilt: -0.9, weight: 1.6, score: 1.9, top: ["KO", "PEP", "KDP"] },
    { name: "Household Products", tilt: -0.8, weight: 1.4, score: 2.2, top: ["PG", "CL", "KMB"] },
  ],
  XLE: [
    { name: "Oil & Gas · Integrated", tilt: -0.7, weight: 2.4, score: 2.4, top: ["XOM", "CVX", "SHEL"] },
    { name: "Oil & Gas · E&P", tilt: -0.4, weight: 1.2, score: 2.6, top: ["COP", "EOG", "OXY"] },
    { name: "Oil & Gas · Equipment", tilt: -0.1, weight: 0.6, score: 2.3, top: ["SLB", "BKR", "HAL"] },
  ],
  XLU: [
    { name: "Utilities · Regulated Elec.", tilt: -0.4, weight: 2.1, score: 2.5, top: ["NEE", "DUK", "SO"] },
    { name: "Utilities · Renewable", tilt: +0.0, weight: 0.5, score: 2.3, top: ["AEP", "BEPC"] },
  ],
  XLB: [
    { name: "Specialty Chemicals", tilt: -0.6, weight: 1.4, score: 2.3, top: ["LIN", "SHW", "ECL"] },
    { name: "Building Materials", tilt: -0.5, weight: 1.0, score: 2.4, top: ["VMC", "MLM", "NUE"] },
  ],
  XLRE: [
    { name: "REIT · Specialty", tilt: -1.6, weight: 0.7, score: 1.9, top: ["AMT", "CCI", "SBAC"] },
    { name: "REIT · Industrial", tilt: -1.0, weight: 0.5, score: 2.0, top: ["PLD", "EXR", "DLR"] },
    { name: "REIT · Residential", tilt: -0.8, weight: 0.3, score: 1.8, top: ["EQR", "AVB", "INVH"] },
  ],
};

export const MT_SCANNER = [
  { ticker: "GRNT", name: "Granite Industries", sector: "Energy", score: 8.4, w1: 7.8, m1: 7.5, insider: ["B", "C"], dark: null, price: 5.52, chg: +0.36, vol: "0.9M", range: 0.42, sig: "buy" },
  { ticker: "PAM", name: "Pampa Energía", sector: "Utilities", score: 7.9, w1: 7.6, m1: 7.2, insider: ["B"], dark: null, price: 80.68, chg: -1.26, vol: "96.4M", range: 0.83, sig: "buy" },
  { ticker: "PLSE", name: "Pulse Biosciences", sector: "Healthcare", score: 7.8, w1: 7.9, m1: 7.7, insider: ["A"], dark: null, price: 25.89, chg: +1.29, vol: "0.3M", range: 0.55, sig: "buy" },
  { ticker: "CVBF", name: "CVB Financial", sector: "Financial Svcs", score: 7.4, w1: 7.7, m1: 7.4, insider: ["B"], dark: 20.31, price: 20.35, chg: +0.15, vol: "1.5M", range: 0.72, sig: "buy" },
  { ticker: "ZGN", name: "Ermenegildo Zegna", sector: "Consumer Cyclical", score: 6.9, w1: 7.5, m1: 7.1, insider: ["A"], dark: null, price: 13.30, chg: -0.38, vol: "0.4M", range: 0.31, sig: "buy" },
  { ticker: "XRN", name: "Xtractor Resources", sector: "Real Estate", score: 6.6, w1: 6.8, m1: 6.4, insider: ["A", "B", "C"], dark: null, price: 37.42, chg: -0.08, vol: "0.2M", range: 0.91, sig: "buy" },
  { ticker: "ACEL", name: "Accel Entertainment", sector: "Consumer Cyclical", score: 6.4, w1: 6.2, m1: 6.0, insider: ["B"], dark: 11.20, price: 11.65, chg: -0.34, vol: "0.2M", range: 0.61, sig: "buy" },
  { ticker: "OMCL", name: "Omnicell Inc", sector: "Healthcare", score: 5.8, w1: 5.5, m1: 5.1, insider: ["A", "C"], dark: null, price: 38.21, chg: +0.92, vol: "0.5M", range: 0.48, sig: "buy" },
];

export const MT_PORTFOLIO_ACCOUNTS = [
  { name: "EY 401(K)", type: "401k", balance: 349000, ttm: +19.87, sharpe: +1.29, cash: 0, share: 67.6, color: "#0a5cd1", positions: 18 },
  { name: "Taxable", type: "taxable", balance: 109000, ttm: +109.24, sharpe: +0.33, cash: 81011, share: 21.1, color: "#1f9d60", positions: 22 },
  { name: "Ethan 529", type: "529", balance: 34000, ttm: +21.81, sharpe: +1.27, cash: 0, share: 6.6, color: "#c08428", positions: 6 },
  { name: "Scarlett 529", type: "529", balance: 9000, ttm: +18.84, sharpe: +1.08, cash: 0, share: 1.7, color: "#c1394f", positions: 4 },
  { name: "Roth IRA", type: "ira", balance: 7000, ttm: -0.04, sharpe: +0.01, cash: 0, share: 1.4, color: "#5c34c9", positions: 3 },
  { name: "HSA", type: "hsa", balance: 7000, ttm: +83.04, sharpe: +0.92, cash: 0, share: 1.4, color: "#0a8a8a", positions: 4 },
];

export const MT_POSITIONS = [
  { ticker: "NVDA", account: "EY 401(K)", shares: 220, price: 145.20, cost: 78.40, value: 31944, score: 8.8, sig: "buy", chg: +1.82, sector: "Technology" },
  { ticker: "MSFT", account: "EY 401(K)", shares: 120, price: 432.00, cost: 312.00, value: 51840, score: 7.4, sig: "hold", chg: -0.21, sector: "Technology" },
  { ticker: "GOOGL", account: "Taxable", shares: 80, price: 184.40, cost: 142.20, value: 14752, score: 7.1, sig: "hold", chg: +0.55, sector: "Communication" },
  { ticker: "JPM", account: "EY 401(K)", shares: 160, price: 228.50, cost: 168.00, value: 36560, score: 7.6, sig: "buy", chg: +0.42, sector: "Financials" },
  { ticker: "LLY", account: "Roth IRA", shares: 12, price: 942.00, cost: 1042.00, value: 11304, score: 4.1, sig: "trim", chg: -0.95, sector: "Health Care" },
  { ticker: "AAPL", account: "Taxable", shares: 140, price: 218.80, cost: 187.50, value: 30632, score: 5.9, sig: "hold", chg: -0.30, sector: "Technology" },
  { ticker: "AMZN", account: "Taxable", shares: 56, price: 196.80, cost: 168.20, value: 11020, score: 7.0, sig: "buy", chg: +0.91, sector: "Consumer Discretion" },
  { ticker: "AVGO", account: "EY 401(K)", shares: 120, price: 178.30, cost: 124.80, value: 21396, score: 8.2, sig: "buy", chg: +1.45, sector: "Technology" },
  { ticker: "TSLA", account: "Taxable", shares: 60, price: 212.10, cost: 248.40, value: 12726, score: 3.4, sig: "trim", chg: -2.10, sector: "Consumer Discretion" },
];

export const MT_NEWS = [
  ["08:35", "Iran Decries US 'Ceasefire Violation' After Overnight Port Raid, Insists On $12BN Fund Release", "ZEROHEDGE"],
  ["08:25", "Futures Rise, US Stocks Set For New Record As Hopes For Iran Peace Deal Persist Despite Bombing", "ZEROHEDGE"],
  ["07:45", "Sterling Falls as Investors Lower Expectations of BOE Rate Rise", "WSJ"],
  ["07:43", "Marco Rubio Unveils Indo-Pacific Monitor Plan as Hormuz Crisis Deepens", "BLOOMBERG"],
  ["07:12", "Powell Hints at September Cut Conditional on Cooling Labor Print", "FT"],
  ["06:50", "Eurozone CPI Lands at 2.4%, Below Consensus — Bunds Bid", "BLOOMBERG"],
];

export const MT_SCENARIOS = [
  { id: "blackmonday", name: "Black Monday ('87)", year: 1987 },
  { id: "dotcomup", name: "Dot-Com Lead Up ('00)", year: 2000 },
  { id: "dotcomdown", name: "Dot-Com Flush ('02)", year: 2002 },
  { id: "gfc", name: "GFC ('08)", year: 2008 },
  { id: "ratehike", name: "Rate Hikes ('18)", year: 2018 },
  { id: "covid", name: "Covid ('20)", year: 2020 },
  { id: "inflation", name: "Inflation ('22)", year: 2022 },
  { id: "ai", name: "AI Correction ('24)", year: 2024 },
];

export const SECTOR_POS = {
  XLK:  { x: -0.45, y:  0.30 },
  XLC:  { x: -0.30, y:  0.45 },
  XLY:  { x: -0.55, y:  0.10 },
  XLF:  { x:  0.25, y:  0.55 },
  XLI:  { x: -0.20, y:  0.05 },
  XLB:  { x: -0.10, y:  0.30 },
  XLE:  { x:  0.45, y:  0.55 },
  XLV:  { x:  0.00, y: -0.20 },
  XLP:  { x: -0.45, y: -0.45 },
  XLU:  { x:  0.35, y: -0.50 },
  XLRE: { x:  0.45, y: -0.50 },
};
