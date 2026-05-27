/* Living Map · core components + extended dataset.
   Everything reused across pages lives here. Exported to window so each
   page script can pick them up.                                          */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ─── Extended mock dataset (mirrors MacroTilt's real shapes) ───────── */

const MT_INDICATORS = [
// Rates (5)
{ id: "yc", name: "Yield curve (10y−2y)", domain: "Rates", value: 43, unit: "bp", state: "calm", pct: 63, fresh: "fresh", asOf: "5d ago", trend: gen(60, 30, 24), delta: -10, dir: "down" },
{ id: "10yr", name: "10y real yield", domain: "Rates", value: 2.18, unit: "%", state: "extreme", pct: 93, fresh: "fresh", asOf: "6d ago", trend: gen(60, 60, 30), delta: 0.29, dir: "up" },
{ id: "move", name: "MOVE · bond volatility", domain: "Rates", value: 78, unit: "", state: "calm", pct: 22, fresh: "fresh", asOf: "5d ago", trend: gen(60, 80, 30), delta: 11, dir: "up" },
{ id: "tp", name: "Term premium", domain: "Rates", value: 81, unit: "bp", state: "extreme", pct: 100, fresh: "fresh", asOf: "May 15", trend: gen(60, 50, 30, 1), delta: 16, dir: "up" },
{ id: "be10", name: "10y breakeven", domain: "Rates", value: 2.40, unit: "%", state: "calm", pct: 50, fresh: "fresh", asOf: "5d ago", trend: gen(60, 45, 30), delta: 0.02, dir: "up" },
// Credit (5)
{ id: "hyig", name: "HY−IG spread", domain: "Credit", value: 278, unit: "bp", state: "calm", pct: 31, fresh: "stale", asOf: "May 19", trend: gen(60, 100, 25), delta: -8, dir: "down" },
{ id: "ig", name: "IG OAS", domain: "Credit", value: 92, unit: "bp", state: "calm", pct: 28, fresh: "fresh", asOf: "1d ago", trend: gen(60, 95, 18), delta: -2, dir: "down" },
{ id: "loans", name: "Bank loan demand", domain: "Credit", value: -8, unit: "%", state: "calm", pct: 42, fresh: "fresh", asOf: "1m ago", trend: gen(60, -5, 12), delta: 3, dir: "up" },
{ id: "delinq", name: "Credit-card delinq.", domain: "Credit", value: 3.1, unit: "%", state: "elevated", pct: 71, fresh: "fresh", asOf: "1m ago", trend: gen(60, 2.6, 0.6), delta: 0.1, dir: "up" },
{ id: "cdx", name: "CDX HY spread", domain: "Credit", value: 322, unit: "bp", state: "calm", pct: 33, fresh: "fresh", asOf: "1h ago", trend: gen(60, 300, 30), delta: -4, dir: "down" },
// Equities (5)
{ id: "skew", name: "SKEW Index", domain: "Equities", value: 137, unit: "", state: "elevated", pct: 71, fresh: "fresh", asOf: "4h ago", trend: gen(60, 120, 30), delta: 3, dir: "up" },
{ id: "cape", name: "CAPE", domain: "Equities", value: 42.0, unit: "x", state: "extreme", pct: 98, fresh: "fresh", asOf: "1d ago", trend: gen(60, 35, 20), delta: 0.4, dir: "up" },
{ id: "buff", name: "Buffett indicator", domain: "Equities", value: 230, unit: "%", state: "extreme", pct: 95, fresh: "fresh", asOf: "1d ago", trend: gen(60, 210, 25), delta: 2, dir: "up" },
{ id: "vix", name: "VIX", domain: "Equities", value: 14.8, unit: "", state: "calm", pct: 18, fresh: "fresh", asOf: "3m ago", trend: gen(60, 18, 8), delta: -1.2, dir: "down" },
{ id: "putc", name: "Put/call ratio", domain: "Equities", value: 0.86, unit: "", state: "calm", pct: 41, fresh: "fresh", asOf: "3m ago", trend: gen(60, 0.95, 0.3), delta: -0.04, dir: "down" },
// Money & banking (6)
{ id: "br", name: "Bank reserves", domain: "Money", value: 3130, unit: "b", state: "calm", pct: 65, fresh: "fresh", asOf: "May 20", trend: gen(60, 3000, 30), delta: 180, dir: "up" },
{ id: "tga", name: "Treasury general account", domain: "Money", value: 781, unit: "b", state: "calm", pct: 38, fresh: "fresh", asOf: "May 20", trend: gen(60, 800, 40), delta: -132, dir: "down" },
{ id: "rrp", name: "Reverse repo", domain: "Money", value: 89, unit: "b", state: "calm", pct: 22, fresh: "fresh", asOf: "May 20", trend: gen(60, 120, 30), delta: -8, dir: "down" },
{ id: "m2", name: "M2 yoy", domain: "Money", value: 3.8, unit: "%", state: "calm", pct: 45, fresh: "fresh", asOf: "1w ago", trend: gen(60, 3.2, 1), delta: 0.4, dir: "up" },
{ id: "dxy", name: "USD index", domain: "Money", value: 99.2, unit: "", state: "calm", pct: 52, fresh: "fresh", asOf: "3m ago", trend: gen(60, 100, 4), delta: -0.1, dir: "down" },
{ id: "gold", name: "Gold / USD", domain: "Money", value: 3182, unit: "$", state: "elevated", pct: 78, fresh: "fresh", asOf: "3m ago", trend: gen(60, 3000, 150), delta: 24, dir: "up" },
// Economy (6)
{ id: "ic", name: "Initial claims", domain: "Economy", value: 209, unit: "k", state: "calm", pct: 38, fresh: "fresh", asOf: "4d ago", trend: gen(60, 220, 25), delta: 1, dir: "up" },
{ id: "jolts", name: "JOLTS quits", domain: "Economy", value: 2.0, unit: "%", state: "extreme", pct: 9, fresh: "fresh", asOf: "1w ago", trend: gen(60, 2.4, 0.5), delta: -0.1, dir: "down" },
{ id: "pmi", name: "ISM Manufacturing", domain: "Economy", value: 49.4, unit: "", state: "elevated", pct: 32, fresh: "fresh", asOf: "1m ago", trend: gen(60, 50, 4), delta: -0.6, dir: "down" },
{ id: "lei", name: "Leading econ. index", domain: "Economy", value: -0.6, unit: "%", state: "extreme", pct: 8, fresh: "fresh", asOf: "1m ago", trend: gen(60, 0, 0.8), delta: -0.2, dir: "down" },
{ id: "retail", name: "Retail sales mom", domain: "Economy", value: 0.2, unit: "%", state: "calm", pct: 48, fresh: "fresh", asOf: "2w ago", trend: gen(60, 0.3, 0.4), delta: -0.1, dir: "down" },
{ id: "cpi", name: "Core CPI yoy", domain: "Economy", value: 3.4, unit: "%", state: "elevated", pct: 73, fresh: "fresh", asOf: "2w ago", trend: gen(60, 3.6, 0.4), delta: 0.1, dir: "up" }];


const MT_SECTORS = [
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
{ code: "XLRE", name: "Real Estate", weight: 1.5, tilt: -3.4, score: 1.9 }];


const MT_IG = {
  XLK: [
  { name: "Semiconductors", tilt: +3.8, weight: 9.2, score: 4.6, top: ["NVDA", "AVGO", "AMAT", "MU", "LRCX"] },
  { name: "Software · Infrastructure", tilt: +1.4, weight: 7.1, score: 4.1, top: ["MSFT", "ORCL", "PANW", "CRWD"] },
  { name: "Software · Application", tilt: +0.8, weight: 6.4, score: 3.8, top: ["CRM", "ADBE", "INTU", "NOW"] },
  { name: "Hardware · Peripherals", tilt: +0.2, weight: 3.9, score: 3.2, top: ["AAPL", "HPQ", "DELL"] },
  { name: "Communication Equipment", tilt: 0.0, weight: 1.8, score: 2.9, top: ["CSCO", "NTAP"] }],

  XLF: [
  { name: "Banks · Diversified", tilt: +1.6, weight: 6.2, score: 4.0, top: ["JPM", "BAC", "WFC", "C"] },
  { name: "Capital Markets", tilt: +0.6, weight: 3.4, score: 3.7, top: ["GS", "MS", "SCHW"] },
  { name: "Insurance · Diversified", tilt: -0.4, weight: 2.6, score: 3.1, top: ["BRK.B", "PGR", "AIG"] },
  { name: "Banks · Regional", tilt: +0.3, weight: 1.9, score: 3.3, top: ["USB", "PNC", "TFC"] }],

  XLV: [
  { name: "Drug Manufacturers · Major", tilt: -0.7, weight: 5.4, score: 2.8, top: ["LLY", "JNJ", "ABBV"] },
  { name: "Medical Devices", tilt: -0.4, weight: 3.2, score: 3.0, top: ["ISRG", "MDT", "SYK"] },
  { name: "Healthcare Plans", tilt: +0.1, weight: 2.1, score: 3.4, top: ["UNH", "ELV", "CI"] },
  { name: "Biotechnology", tilt: -0.4, weight: 1.9, score: 2.2, top: ["AMGN", "GILD", "REGN"] }],

  XLY: [
  { name: "Internet Retail", tilt: +0.8, weight: 5.1, score: 3.6, top: ["AMZN", "EBAY", "ETSY"] },
  { name: "Auto Manufacturers", tilt: -0.2, weight: 1.9, score: 2.7, top: ["TSLA", "F", "GM"] },
  { name: "Specialty Retail", tilt: +0.0, weight: 1.6, score: 3.0, top: ["HD", "LOW", "TJX"] },
  { name: "Travel Services", tilt: 0.0, weight: 1.2, score: 2.8, top: ["BKNG", "ABNB", "MAR"] }],

  XLC: [
  { name: "Internet Content & Info", tilt: +1.4, weight: 5.8, score: 4.2, top: ["GOOG", "META", "SPOT"] },
  { name: "Telecom · Diversified", tilt: +0.4, weight: 2.0, score: 2.9, top: ["T", "VZ", "TMUS"] },
  { name: "Entertainment", tilt: 0.0, weight: 1.1, score: 2.6, top: ["NFLX", "DIS", "RBLX"] }],

  XLI: [
  { name: "Aerospace & Defense", tilt: -0.4, weight: 3.0, score: 2.9, top: ["BA", "LMT", "RTX"] },
  { name: "Railroads", tilt: -0.2, weight: 1.4, score: 3.1, top: ["UNP", "CSX", "NSC"] },
  { name: "Industrial Distribution", tilt: -0.3, weight: 1.6, score: 2.7, top: ["GWW", "FAST", "WCC"] }],

  XLP: [
  { name: "Discount Stores", tilt: -0.6, weight: 2.4, score: 2.0, top: ["WMT", "COST", "TGT"] },
  { name: "Beverages · Non-Alcoholic", tilt: -0.9, weight: 1.6, score: 1.9, top: ["KO", "PEP", "KDP"] },
  { name: "Household Products", tilt: -0.8, weight: 1.4, score: 2.2, top: ["PG", "CL", "KMB"] }],

  XLE: [
  { name: "Oil & Gas · Integrated", tilt: -0.7, weight: 2.4, score: 2.4, top: ["XOM", "CVX", "SHEL"] },
  { name: "Oil & Gas · E&P", tilt: -0.4, weight: 1.2, score: 2.6, top: ["COP", "EOG", "OXY"] },
  { name: "Oil & Gas · Equipment", tilt: -0.1, weight: 0.6, score: 2.3, top: ["SLB", "BKR", "HAL"] }],

  XLU: [
  { name: "Utilities · Regulated Elec.", tilt: -0.4, weight: 2.1, score: 2.5, top: ["NEE", "DUK", "SO"] },
  { name: "Utilities · Renewable", tilt: +0.0, weight: 0.5, score: 2.3, top: ["AEP", "BEPC"] }],

  XLB: [
  { name: "Specialty Chemicals", tilt: -0.6, weight: 1.4, score: 2.3, top: ["LIN", "SHW", "ECL"] },
  { name: "Building Materials", tilt: -0.5, weight: 1.0, score: 2.4, top: ["VMC", "MLM", "NUE"] }],

  XLRE: [
  { name: "REIT · Specialty", tilt: -1.6, weight: 0.7, score: 1.9, top: ["AMT", "CCI", "SBAC"] },
  { name: "REIT · Industrial", tilt: -1.0, weight: 0.5, score: 2.0, top: ["PLD", "EXR", "DLR"] },
  { name: "REIT · Residential", tilt: -0.8, weight: 0.3, score: 1.8, top: ["EQR", "AVB", "INVH"] }]

};

const MT_SCANNER = [
{ ticker: "GRNT", name: "Granite Industries", sector: "Energy", score: 8.4, w1: 7.8, m1: 7.5, insider: ["B", "C"], dark: null, price: 5.52, chg: +0.36, vol: "0.9M", range: 0.42, sig: "buy" },
{ ticker: "PAM", name: "Pampa Energía", sector: "Utilities", score: 7.9, w1: 7.6, m1: 7.2, insider: ["B"], dark: null, price: 80.68, chg: -1.26, vol: "96.4M", range: 0.83, sig: "buy" },
{ ticker: "PLSE", name: "Pulse Biosciences", sector: "Healthcare", score: 7.8, w1: 7.9, m1: 7.7, insider: ["A"], dark: null, price: 25.89, chg: +1.29, vol: "0.3M", range: 0.55, sig: "buy" },
{ ticker: "CVBF", name: "CVB Financial", sector: "Financial Svcs", score: 7.4, w1: 7.7, m1: 7.4, insider: ["B"], dark: 20.31, price: 20.35, chg: +0.15, vol: "1.5M", range: 0.72, sig: "buy" },
{ ticker: "ZGN", name: "Ermenegildo Zegna", sector: "Consumer Cyclical", score: 6.9, w1: 7.5, m1: 7.1, insider: ["A"], dark: null, price: 13.30, chg: -0.38, vol: "0.4M", range: 0.31, sig: "buy" },
{ ticker: "XRN", name: "Xtractor Resources", sector: "Real Estate", score: 6.6, w1: 6.8, m1: 6.4, insider: ["A", "B", "C"], dark: null, price: 37.42, chg: -0.08, vol: "0.2M", range: 0.91, sig: "buy" },
{ ticker: "ACEL", name: "Accel Entertainment", sector: "Consumer Cyclical", score: 6.4, w1: 6.2, m1: 6.0, insider: ["B"], dark: 11.20, price: 11.65, chg: -0.34, vol: "0.2M", range: 0.61, sig: "buy" },
{ ticker: "OMCL", name: "Omnicell Inc", sector: "Healthcare", score: 5.8, w1: 5.5, m1: 5.1, insider: ["A", "C"], dark: null, price: 38.21, chg: +0.92, vol: "0.5M", range: 0.48, sig: "buy" }];


const MT_PORTFOLIO_ACCOUNTS = [
{ name: "EY 401(K)", type: "401k", balance: 349000, ttm: +19.87, sharpe: +1.29, cash: 0, share: 67.6, color: "#0a5cd1", positions: 18 },
{ name: "Taxable", type: "taxable", balance: 109000, ttm: +109.24, sharpe: +0.33, cash: 81011, share: 21.1, color: "#1f9d60", positions: 22 },
{ name: "Ethan 529", type: "529", balance: 34000, ttm: +21.81, sharpe: +1.27, cash: 0, share: 6.6, color: "#c08428", positions: 6 },
{ name: "Scarlett 529", type: "529", balance: 9000, ttm: +18.84, sharpe: +1.08, cash: 0, share: 1.7, color: "#c1394f", positions: 4 },
{ name: "Roth IRA", type: "ira", balance: 7000, ttm: -0.04, sharpe: +0.01, cash: 0, share: 1.4, color: "#5c34c9", positions: 3 },
{ name: "HSA", type: "hsa", balance: 7000, ttm: +83.04, sharpe: +0.92, cash: 0, share: 1.4, color: "#0a8a8a", positions: 4 }];


const MT_POSITIONS = [
{ ticker: "NVDA", account: "EY 401(K)", shares: 220, price: 145.20, cost: 78.40, value: 31944, score: 8.8, sig: "buy", chg: +1.82, sector: "Technology" },
{ ticker: "MSFT", account: "EY 401(K)", shares: 120, price: 432.00, cost: 312.00, value: 51840, score: 7.4, sig: "hold", chg: -0.21, sector: "Technology" },
{ ticker: "GOOGL", account: "Taxable", shares: 80, price: 184.40, cost: 142.20, value: 14752, score: 7.1, sig: "hold", chg: +0.55, sector: "Communication" },
{ ticker: "JPM", account: "EY 401(K)", shares: 160, price: 228.50, cost: 168.00, value: 36560, score: 7.6, sig: "buy", chg: +0.42, sector: "Financials" },
{ ticker: "LLY", account: "Roth IRA", shares: 12, price: 942.00, cost: 1042.00, value: 11304, score: 4.1, sig: "trim", chg: -0.95, sector: "Health Care" },
{ ticker: "AAPL", account: "Taxable", shares: 140, price: 218.80, cost: 187.50, value: 30632, score: 5.9, sig: "hold", chg: -0.30, sector: "Technology" },
{ ticker: "AMZN", account: "Taxable", shares: 56, price: 196.80, cost: 168.20, value: 11020, score: 7.0, sig: "buy", chg: +0.91, sector: "Consumer Discretion" },
{ ticker: "AVGO", account: "EY 401(K)", shares: 120, price: 178.30, cost: 124.80, value: 21396, score: 8.2, sig: "buy", chg: +1.45, sector: "Technology" },
{ ticker: "TSLA", account: "Taxable", shares: 60, price: 212.10, cost: 248.40, value: 12726, score: 3.4, sig: "trim", chg: -2.10, sector: "Consumer Discretion" }];


const MT_NEWS = [
["08:35", "Iran Decries US 'Ceasefire Violation' After Overnight Port Raid, Insists On $12BN Fund Release", "ZEROHEDGE"],
["08:25", "Futures Rise, US Stocks Set For New Record As Hopes For Iran Peace Deal Persist Despite Bombing", "ZEROHEDGE"],
["07:45", "Sterling Falls as Investors Lower Expectations of BOE Rate Rise", "WSJ"],
["07:43", "Marco Rubio Unveils Indo-Pacific Monitor Plan as Hormuz Crisis Deepens", "BLOOMBERG"],
["07:12", "Powell Hints at September Cut Conditional on Cooling Labor Print", "FT"],
["06:50", "Eurozone CPI Lands at 2.4%, Below Consensus — Bunds Bid", "BLOOMBERG"]];


const MT_SCENARIOS = [
{ id: "blackmonday", name: "Black Monday ('87)", year: 1987 },
{ id: "dotcomup", name: "Dot-Com Lead Up ('00)", year: 2000 },
{ id: "dotcomdown", name: "Dot-Com Flush ('02)", year: 2002 },
{ id: "gfc", name: "GFC ('08)", year: 2008 },
{ id: "ratehike", name: "Rate Hikes ('18)", year: 2018 },
{ id: "covid", name: "Covid ('20)", year: 2020 },
{ id: "inflation", name: "Inflation ('22)", year: 2022 },
{ id: "ai", name: "AI Correction ('24)", year: 2024 }];


/* ─── Sidebar ──────────────────────────────────────────────────────── */
const Sidebar = ({ page, setPage }) => {
  const items = [
  ["home", "Home", <NavIcon k="home" />, false],
  ["macro", "Macro overview", <NavIcon k="macro" />, false],
  ["tilt", "Asset Tilt", <NavIcon k="tilt" />, false],
  ["scanner", "Trading scanner", <NavIcon k="scanner" />, "13"],
  ["portfolio", "Portfolio insights", <NavIcon k="portfolio" />, false],
  ["scenarios", "Scenario analysis", <NavIcon k="scenarios" />, false],
  ["indicators", "All indicators", <NavIcon k="indicators" />, false],
  ["methodology", "Methodology", <NavIcon k="methodology" />, false]];

  const admin = [
  ["admin-data", "Admin · Data", <NavIcon k="admin" />],
  ["admin-bugs", "Admin · Bugs", <NavIcon k="bugs" />]];

  return (
    <aside className="mt-sidebar">
      <div className="mt-sidebar-brand">
        <div className="mt-mark">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 8 22 L 16 12 L 24 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div className="mt-sidebar-name">Macro<i style={{ color: 'var(--mt-accent)', fontStyle: 'italic' }}>Tilt</i></div>
          <div className="mt-sidebar-sub">v2 prototype</div>
        </div>
      </div>
      <nav className="mt-sidebar-nav">
        {items.map(([id, label, icon, chip]) =>
        <Tip key={id} content={label} side="right" bare block>
            <button className={`mt-navitem ${page === id ? "mt-navitem--active" : ""}`}
          onClick={() => setPage(id)} aria-label={label}>
              <span className="mt-navicon">{icon}</span>
              <span className="mt-navlbl">{label}</span>
              {chip && <span className="mt-navchip">{chip}</span>}
            </button>
          </Tip>
        )}
        <div className="mt-navsep"><span className="mt-navsep-lbl">Admin</span></div>
        {admin.map(([id, label, icon]) =>
        <Tip key={id} content={label} side="right" bare block>
            <button className={`mt-navitem ${page === id ? "mt-navitem--active" : ""}`}
          onClick={() => setPage(id)} aria-label={label}>
              <span className="mt-navicon">{icon}</span>
              <span className="mt-navlbl">{label}</span>
            </button>
          </Tip>
        )}
      </nav>
      <div className="mt-sidebar-foot">joseph@macrotilt</div>
    </aside>);

};

const TopNav = ({ page, setPage }) => {
  const items = [
  ["home", "Home"], ["macro", "Macro"], ["tilt", "Tilt"], ["scanner", "Scanner"],
  ["portfolio", "Portfolio"], ["scenarios", "Scenarios"], ["indicators", "All indicators"],
  ["methodology", "Methodology"]];

  return (
    <div className="mt-topnav">
      {items.map(([id, label]) =>
      <button key={id} className={`mt-pill ${page === id ? "on" : ""}`} onClick={() => setPage(id)}>{label}</button>
      )}
    </div>);

};

const NavIcon = ({ k }) => {
  const paths = {
    home: "M3 11 L12 4 L21 11 V20 H14 V14 H10 V20 H3 Z",
    macro: "M3 18 L9 12 L13 15 L21 6",
    tilt: "M4 4 V20 H20 M4 14 L9 8 L13 11 L20 6",
    scanner: "M11 18 A7 7 0 1 1 11 4 A7 7 0 0 1 11 18 M16 16 L21 21",
    portfolio: "M3 12 A9 9 0 1 1 12 21 V12 Z M12 3 A9 9 0 0 1 21 12 H12 Z",
    scenarios: "M4 20 L4 4 H20 V20 Z M4 14 L9 9 L13 13 L20 6",
    indicators: "M4 6 H20 M4 12 H20 M4 18 H20",
    methodology: "M5 4 H17 L19 6 V20 H5 Z M8 9 H14 M8 13 H14 M8 17 H12",
    admin: "M12 4 L20 8 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V8 Z",
    bugs: "M12 7 V13 M9 19 H15 M7 10 L17 10 M8 14 A4 4 0 0 0 16 14 V11 A4 4 0 0 0 8 11 Z"
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[k] || paths.home} />
    </svg>);

};

/* ─── Header ──────────────────────────────────────────────────────── */
const PageHeader = ({ onOpenTweaks, theme, setTheme }) =>
<header className="mt-header">
    <div className="mt-headmeta">
      <span><span className="mt-marketdot" />Market closed</span>
      <span className="mt-headmeta-sep" />
      <span><b>Tuesday</b>, May 26 · 2026</span>
    </div>
    <div className="mt-search">
      <span>⌕</span>
      <span>Search tickers, indicators, scenarios…</span>
      <kbd>⌘K</kbd>
    </div>
    <div className="mt-headstatus">
      <FreshnessChip state="fresh" asOf="3 min" variant="pill" label="All feeds healthy" />
      <button className="mt-iconbtn" onClick={() => {
      const order = ["light", "dark", "navy"];
      const next = order[(order.indexOf(theme) + 1) % order.length];
      setTheme(next);
    }} aria-label="Cycle theme" title={`Theme: ${theme}`}>
        {theme === "light" ? "☾" : theme === "dark" ? "✱" : "☀"}
      </button>
      <button className="mt-iconbtn" onClick={onOpenTweaks} aria-label="Open tweaks">⚙</button>
    </div>
  </header>;


/* ─── Score dial (small donut for scanner / IGs) ───────────────────── */
const ScoreDial = ({ score, max = 10, size = 44 }) => {
  const pct = score / max;
  const r = (size - 8) / 2,c = 2 * Math.PI * r;
  return (
    <div className="lm-dialwrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="lm-dial">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mt-line-1)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mt-accent)" strokeWidth="3"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.2,0.8,0.2,1)" }} />
      </svg>
      <span className="lm-dialnum num" style={{ fontSize: size * 0.34 }}>{score.toFixed(1)}</span>
    </div>);

};

/* ─── Big history chart used in indicator drill ───────────────────── */
const BigHistoryChart = ({ data, accent, height = 240, compareData = null, compareAccent = null }) => {
  /* Measure the container width so the chart fills it without preserveAspectRatio
     distortion (text + strokes stay crisp). Falls back to 800 pre-mount.    */
  const wrapRef = useRef(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(320, Math.floor(entry.contentRect.width));
      if (w !== W) setW(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const H = height,P = 20;
  const min = Math.min(...data),max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (W - P * 2) / (data.length - 1);
  const pts = data.map((d, i) => [P + i * stepX, H - P - (d - min) / range * (H - P * 2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${dPath} L${pts[pts.length - 1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`;

  let cmpDPath = null;
  if (compareData && compareData.length) {
    const cmin = Math.min(...compareData),cmax = Math.max(...compareData);
    const cr = cmax - cmin || 1;
    const cStepX = (W - P * 2) / (compareData.length - 1);
    const cPts = compareData.map((d, i) => [P + i * cStepX, H - P - (d - cmin) / cr * (H - P * 2)]);
    cmpDPath = cPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  }

  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const ticks = 4;
  const gradId = useMemo(() => `lm-area-${Math.random().toString(36).slice(2, 8)}`, []);

  const onMove = (e) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - P) / stepX)));
    setHover(i);
  };

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="lm-iddchart-svg"
    width={W} height={H}
    style={{ height, width: "100%" }}
    onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const y = P + (H - P * 2) / ticks * i;
        const v = max - range / ticks * i;
        return (
          <g key={i}>
            <line x1={P} x2={W - P} y1={y} y2={y} stroke="var(--mt-line-0)" strokeWidth="1" />
            <text x={W - P + 4} y={y + 3} fontSize="9" fill="var(--mt-ink-3)">{v.toFixed(1)}</text>
          </g>);

      })}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={dPath} fill="none" stroke={accent} strokeWidth="1.6" />
      {cmpDPath &&
      <path d={cmpDPath} fill="none" stroke={compareAccent} strokeWidth="1.4" strokeDasharray="3 3" />
      }
      {hover != null && pts[hover] &&
      <>
          <line x1={pts[hover][0]} x2={pts[hover][0]} y1={P} y2={H - P}
        stroke="var(--mt-ink-2)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
          <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill={accent}
        stroke="var(--mt-surface)" strokeWidth="1.5" />
          <g transform={`translate(${Math.min(W - 110, Math.max(10, pts[hover][0] - 50))} ${Math.max(8, pts[hover][1] - 40)})`}>
            <rect width="100" height="32" rx="6" fill="var(--mt-surface)" stroke={accent} strokeWidth="1.2" />
            <text x="8" y="13" fontSize="9" fill="var(--mt-ink-2)" letterSpacing="0.06em">PT {hover + 1}</text>
            <text x="8" y="26" fontSize="12" fill="var(--mt-ink-0)" fontWeight="600">{data[hover].toFixed(2)}</text>
          </g>
        </>
      }
    </svg>
    </div>);

};

const PercentileBar = ({ value, accent }) =>
<div className="lm-pctile">
    <svg viewBox="0 0 200 40" width="100%" height="40">
      {Array.from({ length: 20 }, (_, i) => {
      const distFromCenter = Math.abs(i - 10);
      const h = 4 + Math.max(0, 30 - distFromCenter * 3) + Math.sin(i * 7.31) * 2;
      const isYou = value / 5 >= i && value / 5 < i + 1;
      return (
        <rect key={i} x={i * 10 + 1} y={36 - h} width="8" height={h}
        fill={isYou ? accent : "color-mix(in oklab, currentColor 10%, transparent)"} rx="1.5" />);

    })}
    </svg>
    <div className="lm-pctilelabels">
      <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
    </div>
    <div className="lm-pctilemarker">
      <span style={{ left: `${value}%`, background: accent }} />
      <span className="lm-pctilebadge" style={{ left: `${value}%`, color: accent, borderColor: accent }}>
        today · {value}ᵗʰ
      </span>
    </div>
  </div>;


/* ─── Indicator card (used on Macro page) ─────────────────────────── */
const IndicatorCard = ({ ind, onClick, compact = false }) => {
  const accent = ind.state === "extreme" ? "var(--mt-down)" : ind.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)";
  return (
    <button className={`lm-indcard lm-indcard--${ind.state}`} onClick={onClick}>
      <div className="lm-indtop">
        <span className="lm-indcat">{ind.domain}</span>
        <FreshnessChip state={ind.fresh} asOf={ind.asOf} />
      </div>
      <div className="lm-indname">{ind.name}</div>
      {!compact &&
      <Sparkline data={ind.trend} width={220} height={32} stroke={accent} fill={accent} area showDot={false} />
      }
      <div className="lm-indvalrow">
        <span className="lm-indval num">
          {ind.value > 1000 ? ind.value.toLocaleString() : ind.value.toFixed(ind.value > 100 ? 0 : 2)}
          <span className="lm-indunit">{ind.unit}</span>
        </span>
        <span className={`lm-indchg num ${ind.dir === "up" ? "up" : "down"}`}>
          {ind.dir === "up" ? "▲" : "▼"} {Math.abs(ind.delta).toFixed(2)}
        </span>
      </div>
      <div className="lm-indfoot">
        <span className="num">5Y</span>
        <span className={`lm-indfbar lm-indfbar--${ind.state}`}><span style={{ width: `${ind.pct}%` }} /></span>
        <span className={`num lm-indpct--${ind.state}`}>{ind.pct}ᵗʰ</span>
      </div>
    </button>);

};

Object.assign(window, {
  MT_INDICATORS, MT_SECTORS, MT_IG, MT_SCANNER, MT_PORTFOLIO_ACCOUNTS, MT_POSITIONS,
  MT_NEWS, MT_SCENARIOS,
  Sidebar, TopNav, PageHeader, ScoreDial, BigHistoryChart, PercentileBar, IndicatorCard
});