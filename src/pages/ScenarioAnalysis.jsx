// src/pages/ScenarioAnalysis.jsx
//
// Sprint 1 — Full React port of design-lab/scenario-analysis-v2-interactive.html
// (v2.3, Joe-approved 2026-04-27). Mock data identical to the demo. Engine wiring
// to compute_v9_allocation via translation layer is Sprint 2 (task #13).
//
// Architectural Principle: Scenario Analysis is a stress-test viewer onto AA's
// existing optimizer. The L4 panel re-runs compute_v9_allocation with stressed
// CCAR factor inputs translated to v9's panel via translation-ccar-to-v9-v1.md.
// Same optimizer, same universe, same output schema. No duplicate calibration.

import { useState, useMemo, useCallback, useEffect } from "react";
import { useUserPortfolio } from "../hooks/useUserPortfolio";
import { SectorModal, IGModal } from "./AssetAllocation";

// ════════════════════════════════════════════════════════════════════════
// REAL ENGINE OUTPUT — Sprint 2: precomputed stressed allocations
// ════════════════════════════════════════════════════════════════════════
//
// For canned scenarios, the L4 panel reads from public/scenario_allocations.json
// (refreshed nightly by scripts/precompute_scenario_allocations.py). That file
// contains, per scenario: real picks, weights, defensive sleeve, regime, alpha
// — produced by the same v9 optimizer that runs nightly, fed a stressed factor
// panel translated from CCAR via translate_ccar_to_v9().
//
// For bespoke shocks: still using the mock math below (pending Sprint 2.5
// composite-stress derivation + a server-side compute endpoint for arbitrary
// shocks).

function useScenarioAllocations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/scenario_allocations.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (alive) setData(j); })
      .catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, []);
  return { data, error };
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 2.6 — REAL PORTFOLIO INGESTION
// ════════════════════════════════════════════════════════════════════════
//
// useScenarioPortfolio() returns an array of positions in the shape
// portfolioPnL() expects: { ticker, sector, value, weight }, where `sector`
// is a SECTORS row name (matched via mapPositionToSectorName).
//
// For signed-in users we read positions from useUserPortfolio (Supabase RLS),
// flatten across accounts, and apply ticker-level overrides + sector-string
// aliases. For anonymous users (or while the portfolio is loading) we fall
// back to the v2.3 demo PORTFOLIO so the page is never empty.

const TICKER_TO_SECTOR = {
  // Defensive sleeve ETFs (already in SECTORS)
  BIL: "T-Bills (1-3mo)", SHV: "T-Bills (1-3mo)", SHY: "T-Bills (1-3mo)",
  TLT: "USTs (20+yr)", IEF: "USTs (20+yr)", VGLT: "USTs (20+yr)",
  GLD: "Gold", IAU: "Gold", SLV: "Gold",   // SLV proxied via Gold for v1
  LQD: "IG Corp Bond", AGG: "IG Corp Bond", BND: "IG Corp Bond", VCIT: "IG Corp Bond",
  // Synthetic sectors added in Sprint 2.6
  JHYUX: "HY Bonds", HYG: "HY Bonds", JNK: "HY Bonds", USHY: "HY Bonds",
  FBTC: "Crypto", IBIT: "Crypto", ETHE: "Crypto", BITO: "Crypto",
  FXAIX: "Broad US Equity", FSKAX: "Broad US Equity",
  VTI: "Broad US Equity", SPY: "Broad US Equity", VOO: "Broad US Equity", IVV: "Broad US Equity",
  NHXINT906: "International Equity", VXUS: "International Equity",
  IXUS: "International Equity", IEFA: "International Equity", VEA: "International Equity",
  // Cash equivalents
  CASH: "Cash", SPAXX: "Cash",
};

const SECTOR_ALIASES_RAW = {
  TECH: "Technology", TECHNOLOGY: "Technology",
  "INFO TECH": "Technology", "INFORMATION TECHNOLOGY": "Technology",
  FINANCIALS: "Financials", FINANCIAL: "Financials",
  HEALTHCARE: "Healthcare", "HEALTH CARE": "Healthcare",
  ENERGY: "Energy",
  INDUSTRIALS: "Industrials",
  MATERIALS: "Materials", "BASIC MATERIALS": "Materials",
  STAPLES: "Staples", "CONSUMER STAPLES": "Staples",
  DISCRETIONARY: "Discretionary", "CONSUMER DISCRETIONARY": "Discretionary",
  UTILITIES: "Utilities",
  "REAL ESTATE": "Real Estate",
  "COMMUNICATION SERVICES": "Communication Services", TELECOM: "Communication Services",
  "HY BONDS": "HY Bonds", "HIGH YIELD": "HY Bonds",
  "INTERNATIONAL STOCKS": "International Equity", INTERNATIONAL: "International Equity",
  CRYPTO: "Crypto", "DIGITAL ASSETS": "Crypto",
  CASH: "Cash",
};

function mapPositionToSectorName(position) {
  const t = (position.ticker || "").toUpperCase();
  const ac = (position.asset_class || "stock").toLowerCase();
  // Asset-class overrides
  if (ac === "cash") return "Cash";
  if (ac === "option") return null; // skip — needs Greeks (Sprint 2.7)
  // Ticker-level overrides take priority
  if (TICKER_TO_SECTOR[t]) return TICKER_TO_SECTOR[t];
  // Sector-string normalization
  const s = (position.sector || "").trim().toUpperCase();
  if (SECTOR_ALIASES_RAW[s]) return SECTOR_ALIASES_RAW[s];
  // Fallback — assume broad US equity for anything else (e.g., individual stocks
  // without a clean GICS label, or NULL sectors on mutual funds)
  return "Broad US Equity";
}

function useScenarioPortfolio() {
  const { accounts, isAuthed } = useUserPortfolio();
  return useMemo(() => {
    if (!isAuthed || !accounts || accounts.length === 0) {
      return { positions: PORTFOLIO, total: PORTFOLIO_TOTAL, source: "demo", uncovered: [] };
    }
    // Flatten accounts → positions
    const flat = [];
    for (const acc of accounts) {
      for (const p of acc.positions || []) {
        flat.push(p);
      }
    }
    // Sum absolute values for the weight base — handles negative cash (margin
    // debit) without distorting weights.
    const grossTotal = flat.reduce((s, p) => s + Math.abs(p.value || 0), 0);
    const netTotal = flat.reduce((s, p) => s + (p.value || 0), 0);
    const positions = [];
    const uncovered = [];
    for (const p of flat) {
      const sectorName = mapPositionToSectorName(p);
      const value = Number(p.value) || 0;
      const weight = grossTotal > 0 ? Math.abs(value) / grossTotal * 100 : 0;
      const row = {
        ticker: p.ticker,
        sector: sectorName || "Not modeled",
        weight,
        value,
      };
      if (sectorName == null) {
        uncovered.push(row);
      } else {
        positions.push(row);
      }
    }
    return { positions, total: netTotal, source: "user", uncovered };
  }, [accounts, isAuthed]);
}

// ════════════════════════════════════════════════════════════════════════
// MOCK DATA — illustrative only, mirrors v2.3 demo
// ════════════════════════════════════════════════════════════════════════

const FACTORS = [
  { id:"vix",          name:"VIX",            min:-3, max:5, step:0.1 },
  { id:"move",         name:"MOVE",           min:-3, max:5, step:0.1 },
  { id:"real_rates",   name:"Real rates",     min:-3, max:5, step:0.1 },
  { id:"term_premium", name:"Term premium",   min:-3, max:5, step:0.1 },
  { id:"dxy",          name:"DXY (USD)",      min:-3, max:5, step:0.1 },
  { id:"copper_gold",  name:"Copper / gold",  min:-3, max:5, step:0.1 },
  { id:"hy",           name:"HY OAS",         min:-3, max:5, step:0.1 },
  { id:"stlfsi",       name:"STLFSI",         min:-3, max:5, step:0.1 },
  { id:"anfci",        name:"ANFCI",          min:-3, max:5, step:0.1 },
  { id:"aaii",         name:"AAII bull-bear", min:-3, max:5, step:0.1 },
  { id:"putcall",      name:"Put/call",       min:-3, max:5, step:0.1 },
  { id:"breadth",      name:"Breadth",        min:-5, max:3, step:0.1 },
];
const FACTOR_IDS = FACTORS.map(f => f.id);
const fmtZ = v => (v > 0 ? "+" : "") + v.toFixed(1) + "σ";

// Bug #1106 — nominal-value display for the bespoke shock builder.
// Mean / std calibrated 2006-01 to 2026-03 from indicator_history.json (8 factors)
// + textbook baselines for the 4 factors not in the panel (hy, aaii, putcall, breadth).
// Used to translate "+2σ on VIX" into "VIX 18 → 32" so users who think in nominal
// terms (most of them) don't have to convert in their heads.
const FACTOR_BASELINES = {
  vix:          { mean: 19.6, std:  8.1, fmt: v => v.toFixed(1) },
  move:         { mean: 85.2, std: 31.7, fmt: v => v.toFixed(0) },
  real_rates:   { mean:  0.83,std:  1.0, fmt: v => v.toFixed(2) + "%" },
  term_premium: { mean: 29.2, std: 39.5, fmt: v => v.toFixed(0) + "bps" },
  dxy:          { mean:106.2, std: 12.4, fmt: v => v.toFixed(1) },
  copper_gold:  { mean:  0.247, std: 0.098, fmt: v => v.toFixed(3) },
  hy:           { mean:400, std:150, fmt: v => v.toFixed(0) + "bps" },
  stlfsi:       { mean: 0.0, std:  1.18, fmt: v => v.toFixed(2) },
  anfci:        { mean:-0.24, std: 0.75, fmt: v => v.toFixed(2) },
  aaii:         { mean:  6, std: 12, fmt: v => (v >= 0 ? "+" : "") + v.toFixed(0) },
  putcall:      { mean:  0.95, std: 0.20, fmt: v => v.toFixed(2) },
  breadth:      { mean: 55, std: 25, fmt: v => v.toFixed(0) + "%" },
};
const fmtNominal = (factorId, sigma) => {
  const b = FACTOR_BASELINES[factorId];
  if (!b) return "";
  const v = b.mean + sigma * b.std;
  return b.fmt(v);
};

const CORR_PAIRS = {
  "vix|move": 0.65, "vix|real_rates": -0.30, "vix|term_premium": 0.10, "vix|dxy": 0.15,
  "vix|copper_gold": -0.45, "vix|hy": 0.75, "vix|stlfsi": 0.80, "vix|anfci": 0.60,
  "vix|aaii": -0.55, "vix|putcall": 0.70, "vix|breadth": -0.65,
  "move|real_rates": 0.20, "move|term_premium": -0.30, "move|dxy": 0.25,
  "move|copper_gold": -0.30, "move|hy": 0.55, "move|stlfsi": 0.65, "move|anfci": 0.50,
  "move|aaii": -0.30, "move|putcall": 0.45, "move|breadth": -0.40,
  "real_rates|term_premium": 0.10, "real_rates|dxy": 0.40, "real_rates|copper_gold": 0.25,
  "real_rates|hy": -0.20, "real_rates|stlfsi": 0.10, "real_rates|anfci": 0.20,
  "real_rates|aaii": 0.10, "real_rates|putcall": -0.15, "real_rates|breadth": 0.10,
  "term_premium|dxy": -0.20, "term_premium|copper_gold": 0.10, "term_premium|hy": 0.05,
  "term_premium|stlfsi": 0.15, "term_premium|anfci": 0.20, "term_premium|aaii": -0.05,
  "term_premium|putcall": 0.10, "term_premium|breadth": -0.05,
  "dxy|copper_gold": -0.40, "dxy|hy": 0.10, "dxy|stlfsi": 0.20, "dxy|anfci": 0.15,
  "dxy|aaii": -0.10, "dxy|putcall": 0.10, "dxy|breadth": -0.15,
  "copper_gold|hy": -0.50, "copper_gold|stlfsi": -0.50, "copper_gold|anfci": -0.40,
  "copper_gold|aaii": 0.40, "copper_gold|putcall": -0.40, "copper_gold|breadth": 0.50,
  "hy|stlfsi": 0.85, "hy|anfci": 0.75, "hy|aaii": -0.50, "hy|putcall": 0.55, "hy|breadth": -0.55,
  "stlfsi|anfci": 0.80, "stlfsi|aaii": -0.55, "stlfsi|putcall": 0.60, "stlfsi|breadth": -0.60,
  "anfci|aaii": -0.45, "anfci|putcall": 0.45, "anfci|breadth": -0.50,
  "aaii|putcall": -0.45, "aaii|breadth": 0.55,
  "putcall|breadth": -0.50,
};
const getCorr = (a, b) => a === b ? 1.0 : (CORR_PAIRS[a + "|" + b] ?? CORR_PAIRS[b + "|" + a] ?? 0);

const SCENARIOS = {
  black_monday_1987: { name:"1987 Black Monday", window:"Oct 1987",
    factors:{ vix:+5.0, move:+3.5, real_rates:+1.5, term_premium:-0.5, dxy:-0.5, copper_gold:-1.0, hy:+2.0, stlfsi:+2.5, anfci:+2.0, aaii:-3.0, putcall:+3.5, breadth:-4.0 },
    narrative:"Single-week crash. Portfolio insurance amplification. VIX values are VXO-derived; HY OAS is BAA-Treasury × 1.85.",
    proxy:true, lowConf:false },
  dotcom_slow_2000: { name:"2000 Slow Burn", window:"Mar 2000–Oct 2002",
    factors:{ vix:+1.5, move:+1.0, real_rates:+0.5, term_premium:-0.5, dxy:+0.8, copper_gold:-1.2, hy:+1.8, stlfsi:+1.5, anfci:+1.2, aaii:-2.0, putcall:+1.8, breadth:-2.5 },
    narrative:"2.5-year peak-to-trough across three regimes. Tech multiple compression, telecom collapse, recession + accounting scandals. HY OAS pre-1996 is BAA-Treasury proxy.",
    proxy:true, lowConf:false },
  dotcom_capitulation_2002: { name:"2002 Capitulation", window:"Aug–Oct 2002",
    factors:{ vix:+2.8, move:+1.8, real_rates:-0.5, term_premium:+0.3, dxy:-0.5, copper_gold:-1.5, hy:+2.5, stlfsi:+1.8, anfci:+1.5, aaii:-2.5, putcall:+2.5, breadth:-3.2 },
    narrative:"Final flush of the dotcom bear. Capitulation low followed by 5-year bull market.",
    proxy:false, lowConf:false },
  gfc_2008: { name:"2008 GFC", window:"Sep–Nov 2008",
    factors:{ vix:+4.0, move:+3.2, real_rates:-1.5, term_premium:+0.5, dxy:+0.5, copper_gold:-2.0, hy:+3.5, stlfsi:+3.5, anfci:+2.8, aaii:-2.3, putcall:+2.5, breadth:-3.5 },
    narrative:"Credit seizure plus banking solvency crisis. Lehman, AIG, congressional rejection of TARP v1. Financials and Real Estate led losses; Staples cushioned.",
    proxy:false, lowConf:false },
  q4_2018: { name:"2018 Q4 Pivot", window:"Oct–Dec 2018",
    factors:{ vix:+2.2, move:+1.5, real_rates:+1.3, term_premium:-0.8, dxy:+0.8, copper_gold:-0.7, hy:+1.5, stlfsi:+1.2, anfci:+0.7, aaii:-1.3, putcall:+1.4, breadth:-1.8 },
    narrative:"Fed rate-path shock plus yield-curve flattening. Utilities held up; Energy and Industrials broke hardest.",
    proxy:false, lowConf:false },
  covid_2020: { name:"COVID 2020", window:"Feb–Mar 2020",
    factors:{ vix:+3.8, move:+3.5, real_rates:-1.0, term_premium:+0.3, dxy:+1.5, copper_gold:-1.8, hy:+2.8, stlfsi:+2.5, anfci:+1.8, aaii:-1.5, putcall:+2.2, breadth:-3.0 },
    narrative:"33-day liquidity-driven crash. Lockdown hit Energy and Discretionary hardest. Tech recovered fastest.",
    proxy:false, lowConf:false },
  inflation_2022: { name:"2022 Inflation", window:"Jan–Oct 2022",
    factors:{ vix:+1.5, move:+2.5, real_rates:+3.2, term_premium:-1.5, dxy:+2.5, copper_gold:-0.5, hy:+1.2, stlfsi:+1.0, anfci:+0.5, aaii:-1.8, putcall:+1.5, breadth:-2.0 },
    narrative:"Rate shock rerated long-duration equities. Energy was the only winner. Multiple compression dominated.",
    proxy:false, lowConf:false },
  ai_2024: { name:"2024 AI Concentration", window:"Jun–Aug 2024",
    factors:{ vix:+1.8, move:+1.0, real_rates:-0.5, term_premium:+0.3, dxy:-0.3, copper_gold:-0.4, hy:+0.5, stlfsi:+0.3, anfci:+0.2, aaii:-0.8, putcall:+1.1, breadth:-2.5 },
    narrative:"Narrow-breadth rally + August carry-trade unwind. Concentration risk realized. Mega-cap tech under-performed broader market briefly.",
    proxy:false, lowConf:true },
};

const SECTORS_RAW = [
  { id:"XLK", name:"Technology",            assetClass:"Equity", beta:1.15, current:18, loadings:{ vix:+0.85, move:+0.40, real_rates:+0.85, term_premium:-0.30, dxy:+0.45, copper_gold:+0.20, hy:+0.55, stlfsi:+0.65, anfci:+0.50, aaii:-0.40, putcall:+0.50, breadth:-0.70 },
    igs:[{name:"Software"},{name:"Semiconductors"},{name:"Hardware & Equipment"},{name:"IT Services"}] },
  { id:"XLC", name:"Communication Services",assetClass:"Equity", beta:1.05, current:12, loadings:{ vix:+0.80, move:+0.35, real_rates:+0.70, term_premium:-0.25, dxy:+0.30, copper_gold:+0.15, hy:+0.50, stlfsi:+0.60, anfci:+0.45, aaii:-0.30, putcall:+0.45, breadth:-0.65 },
    igs:[{name:"Interactive Media"},{name:"Telecom Services"},{name:"Entertainment"}] },
  { id:"XLF", name:"Financials",            assetClass:"Equity", beta:1.25, current:13, loadings:{ vix:+0.75, move:+0.45, real_rates:-0.30, term_premium:+0.55, dxy:-0.10, copper_gold:-0.20, hy:+0.85, stlfsi:+0.85, anfci:+0.65, aaii:-0.40, putcall:+0.55, breadth:-0.65 },
    igs:[{name:"Banks"},{name:"Diversified Financial Services"},{name:"Insurance"},{name:"Capital Markets"}] },
  { id:"XLY", name:"Discretionary",         assetClass:"Equity", beta:1.20, current:7,  loadings:{ vix:+0.75, move:+0.40, real_rates:+0.45, term_premium:-0.10, dxy:+0.20, copper_gold:+0.10, hy:+0.65, stlfsi:+0.70, anfci:+0.55, aaii:-0.40, putcall:+0.50, breadth:-0.60 },
    igs:[{name:"Retail"},{name:"Automobiles"},{name:"Consumer Services"},{name:"Consumer Durables"}] },
  { id:"XLI", name:"Industrials",           assetClass:"Equity", beta:1.10, current:6,  loadings:{ vix:+0.70, move:+0.35, real_rates:+0.10, term_premium:+0.05, dxy:+0.30, copper_gold:-0.30, hy:+0.55, stlfsi:+0.60, anfci:+0.45, aaii:-0.35, putcall:+0.40, breadth:-0.55 },
    igs:[{name:"Capital Goods"},{name:"Transportation"},{name:"Commercial Services"}] },
  { id:"XLB", name:"Materials",             assetClass:"Equity", beta:1.10, current:3,  loadings:{ vix:+0.65, move:+0.30, real_rates:-0.10, term_premium:+0.05, dxy:+0.50, copper_gold:-0.85, hy:+0.50, stlfsi:+0.55, anfci:+0.40, aaii:-0.30, putcall:+0.35, breadth:-0.50 },
    igs:[{name:"Chemicals"},{name:"Metals & Mining"},{name:"Construction Materials"}] },
  // Hotfix #1108 — Energy is an INFLATION HEDGE. real_rates / term_premium loadings flipped
  // negative so Energy benefits when rates rise during inflation regimes (matches 2022 actuals
  // where XLE was the only positive sector). Validated directionally across all 8 historical
  // scenarios. Senior Quant pass; magnitudes still under-stress crisis events vs realized but
  // signs are correct on every scenario.
  { id:"XLE", name:"Energy",                assetClass:"Equity", beta:1.30, current:4,  loadings:{ vix:+0.3, move:+0.1, real_rates:-1.2, term_premium:-0.5, dxy:-0.1, copper_gold:-0.5, hy:+0.2, stlfsi:+0.2, anfci:+0.1, aaii:-0.2, putcall:+0.2, breadth:-0.3 },
    igs:[{name:"Oil & Gas"},{name:"Energy Equipment & Services"}] },
  { id:"XLV", name:"Healthcare",            assetClass:"Equity", beta:0.85, current:11, loadings:{ vix:+0.45, move:+0.25, real_rates:+0.15, term_premium:-0.05, dxy:+0.10, copper_gold:-0.05, hy:+0.35, stlfsi:+0.40, anfci:+0.30, aaii:-0.25, putcall:+0.30, breadth:-0.35 },
    igs:[{name:"Pharmaceuticals"},{name:"Biotech"},{name:"Health Care Equipment"},{name:"Health Care Services"}] },
  { id:"XLP", name:"Staples",               assetClass:"Equity", beta:0.65, current:5,  loadings:{ vix:+0.30, move:+0.15, real_rates:+0.10, term_premium:-0.05, dxy:+0.15, copper_gold:-0.05, hy:+0.25, stlfsi:+0.30, anfci:+0.20, aaii:-0.15, putcall:+0.20, breadth:-0.30 },
    igs:[{name:"Food & Beverage"},{name:"Household & Personal Products"},{name:"Food & Staples Retail"}] },
  { id:"XLU", name:"Utilities",             assetClass:"Equity", beta:0.55, current:2,  loadings:{ vix:+0.30, move:+0.20, real_rates:+0.55, term_premium:-0.10, dxy:+0.05, copper_gold:-0.05, hy:+0.30, stlfsi:+0.35, anfci:+0.25, aaii:-0.15, putcall:+0.20, breadth:-0.30 },
    igs:[{name:"Electric Utilities"},{name:"Multi-Utilities"},{name:"Gas Utilities"}] },
  { id:"XLRE",name:"Real Estate",           assetClass:"Equity", beta:1.05, current:2,  loadings:{ vix:+0.75, move:+0.50, real_rates:+1.10, term_premium:-0.40, dxy:+0.10, copper_gold:-0.10, hy:+0.70, stlfsi:+0.75, anfci:+0.60, aaii:-0.35, putcall:+0.45, breadth:-0.55 },
    igs:[{name:"Equity REITs"},{name:"Real Estate Mgmt"}] },
  { id:"BIL", name:"T-Bills (1-3mo)",       assetClass:"Defensive", beta:0.05, current:0, loadings:{ vix:-0.05, move:-0.05, real_rates:+0.2, term_premium:0, dxy:0, copper_gold:0, hy:-0.05, stlfsi:-0.05, anfci:-0.05, aaii:0, putcall:-0.05, breadth:0 }, igs:[] },
  { id:"TLT", name:"USTs (20+yr)",          assetClass:"Defensive", beta:1.20, current:0, loadings:{ vix:-0.6, move:-0.5, real_rates:+3.0, term_premium:-0.3, dxy:-0.2, copper_gold:+0.2, hy:-0.3, stlfsi:-0.4, anfci:-0.3, aaii:+0.2, putcall:-0.3, breadth:+0.2 }, igs:[] },
  { id:"GLD", name:"Gold",                  assetClass:"Defensive", beta:0.70, current:0, loadings:{ vix:-0.5, move:-0.3, real_rates:+0.6, term_premium:0, dxy:+0.5, copper_gold:+0.7, hy:-0.4, stlfsi:-0.3, anfci:-0.2, aaii:+0.1, putcall:-0.3, breadth:+0.1 }, igs:[] },
  { id:"LQD", name:"IG Corp Bond",          assetClass:"Defensive", beta:0.60, current:0, loadings:{ vix:+0.2, move:+0.3, real_rates:+2.0, term_premium:-0.2, dxy:-0.1, copper_gold:0, hy:+0.3, stlfsi:+0.2, anfci:+0.15, aaii:-0.1, putcall:+0.1, breadth:-0.15 }, igs:[] },
  // Sprint 2.6 — synthetic sectors covering positions outside the GICS-equity set.
  // Loadings are textbook-defensible v1 starting points (BAA-Treasury for HY, broad
  // equity ± DXY for International, 1.8× equity for Crypto, S&P average for Broad US).
  // Scheduled for empirical refit in Sprint 2.7 once we have factor-return regressions
  // on each underlying.
  { id:"HY",  name:"HY Bonds",              assetClass:"Defensive", beta:0.55, current:0, loadings:{ vix:+0.5, move:+0.4, real_rates:+0.6, term_premium:-0.1, dxy:0, copper_gold:-0.2, hy:+2.5, stlfsi:+1.2, anfci:+0.9, aaii:-0.3, putcall:+0.3, breadth:-0.3 }, igs:[] },
  { id:"INTL",name:"International Equity",  assetClass:"Equity",    beta:0.95, current:0, loadings:{ vix:+0.75, move:+0.4, real_rates:+0.4, term_premium:-0.1, dxy:-0.9, copper_gold:-0.3, hy:+0.6, stlfsi:+0.65, anfci:+0.5, aaii:-0.4, putcall:+0.45, breadth:-0.55 }, igs:[] },
  { id:"BTC", name:"Crypto",                assetClass:"Equity",    beta:1.80, current:0, loadings:{ vix:+1.5, move:+0.5, real_rates:+1.0, term_premium:-0.3, dxy:-0.4, copper_gold:-0.5, hy:+1.2, stlfsi:+1.4, anfci:+1.0, aaii:-0.7, putcall:+0.9, breadth:-1.0 }, igs:[] },
  { id:"SPX", name:"Broad US Equity",       assetClass:"Equity",    beta:1.00, current:0, loadings:{ vix:+0.85, move:+0.4, real_rates:+0.5, term_premium:-0.2, dxy:-0.1, copper_gold:-0.25, hy:+0.7, stlfsi:+0.75, anfci:+0.55, aaii:-0.4, putcall:+0.45, breadth:-0.6 }, igs:[] },
  { id:"CSH", name:"Cash",                  assetClass:"Defensive", beta:0.00, current:0, loadings:{ vix:0, move:0, real_rates:0, term_premium:0, dxy:0, copper_gold:0, hy:0, stlfsi:0, anfci:0, aaii:0, putcall:0, breadth:0 }, igs:[] },
];
// Re-balance equity currents to sum to 100% (defensive is 0% baseline).
const SECTORS = SECTORS_RAW.map(s => s.assetClass === "Equity"
  ? { ...s, current: Math.round(s.current * 100 / 83) }
  : s
);
const SECTOR_BY_NAME = Object.fromEntries(SECTORS.map(s => [s.name, s]));

const PORTFOLIO = [
  { ticker:"JPM",   sector:"Financials",            weight:14.2, value:35500 },
  { ticker:"AAPL",  sector:"Technology",            weight:12.8, value:32000 },
  { ticker:"NVDA",  sector:"Technology",            weight:11.0, value:27500 },
  { ticker:"GS",    sector:"Financials",            weight:9.6,  value:24000 },
  { ticker:"META",  sector:"Communication Services", weight:8.5,  value:21250 },
  { ticker:"BRK.B", sector:"Financials",            weight:7.5,  value:18750 },
  { ticker:"PG",    sector:"Staples",               weight:7.0,  value:17500 },
  { ticker:"XLE",   sector:"Energy",                weight:8.4,  value:21000 },
  { ticker:"JNJ",   sector:"Healthcare",            weight:6.0,  value:15000 },
  { ticker:"LMT",   sector:"Industrials",           weight:5.0,  value:12500 },
  { ticker:"XLU",   sector:"Utilities",             weight:3.2,  value:8000  },
  { ticker:"CASH",  sector:"Cash",                  weight:6.8,  value:17000 },
];
const PORTFOLIO_TOTAL = PORTFOLIO.reduce((s, p) => s + p.value, 0);
const CURRENT_COMPOSITES = { rl: 36, growth: 54, ir: 47 };

// ════════════════════════════════════════════════════════════════════════
// COMPUTE — pure functions
// ════════════════════════════════════════════════════════════════════════

function propagateRealistic(driverId, driverZ) {
  const out = {};
  FACTOR_IDS.forEach(f => { out[f] = driverZ * getCorr(driverId, f); });
  return out;
}
function propagateBespoke(pinnedShocks) {
  const out = { ...pinnedShocks };
  const pinnedKeys = Object.keys(pinnedShocks);
  if (pinnedKeys.length === 0) return Object.fromEntries(FACTOR_IDS.map(f => [f, 0]));
  FACTOR_IDS.forEach(f => {
    if (out[f] !== undefined) return;
    let weightedSum = 0, weightSum = 0;
    pinnedKeys.forEach(p => {
      const c = getCorr(p, f);
      weightedSum += c * pinnedShocks[p];
      weightSum += Math.abs(c);
    });
    out[f] = weightSum > 0 ? weightedSum / weightSum * Math.max(...pinnedKeys.map(k => Math.abs(pinnedShocks[k]))) * Math.sign(weightedSum) : 0;
  });
  return out;
}
function getEffectiveShocks(state) {
  if (state.mode === "canned") {
    return state.scenario ? { ...SCENARIOS[state.scenario].factors } : Object.fromEntries(FACTOR_IDS.map(f => [f, 0]));
  }
  if (state.prop === "realistic" && state.driver) {
    return propagateRealistic(state.driver, state.shocks[state.driver]);
  }
  const pinnedShocks = {};
  state.pinned.forEach(p => { if (Math.abs(state.shocks[p]) > 0.01) pinnedShocks[p] = state.shocks[p]; });
  return propagateBespoke(pinnedShocks);
}
function coherence(shocks) {
  const factors = FACTOR_IDS.filter(f => Math.abs(shocks[f]) > 0.05);
  if (factors.length < 2) return 100;
  let badness = 0;
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i], b = factors[j];
      const c = getCorr(a, b);
      if (Math.abs(c) < 0.2) continue;
      const expectedB = c * shocks[a];
      const actualB = shocks[b];
      const signDisagree = (Math.sign(expectedB) !== Math.sign(actualB)) && Math.abs(expectedB) > 0.1 && Math.abs(actualB) > 0.1;
      if (signDisagree) {
        badness += Math.abs(shocks[a]) * Math.abs(shocks[b]) * Math.abs(c);
      } else {
        const ratio = Math.min(Math.abs(expectedB), Math.abs(actualB)) / (Math.max(Math.abs(expectedB), Math.abs(actualB)) + 0.01);
        badness += (1 - ratio) * Math.abs(shocks[a]) * Math.abs(shocks[b]) * Math.abs(c) * 0.3;
      }
    }
  }
  return Math.max(0, Math.min(100, Math.round(100 - badness * 6)));
}
function sectorShocks(factorShocks, horizon) {
  const horizonMult = horizon === "1mo" ? 0.5 : horizon === "3mo" ? 1.0 : 1.55;
  const out = {};
  SECTORS.forEach(s => {
    let total = 0;
    Object.entries(s.loadings).forEach(([f, l]) => { total += l * (factorShocks[f] || 0); });
    out[s.id] = -1.4 * s.beta * total * horizonMult;
  });
  return out;
}
function compositeShock(factorShocks) {
  return {
    rl:     0.30 * (factorShocks.vix||0) + 0.25 * (factorShocks.hy||0) + 0.20 * (factorShocks.stlfsi||0) + 0.15 * (factorShocks.putcall||0) + 0.10 * (factorShocks.move||0),
    growth: 0.40 * (factorShocks.copper_gold||0) - 0.20 * (factorShocks.dxy||0) + 0.30 * (factorShocks.breadth||0) + 0.10 * (factorShocks.aaii||0),
    ir:     0.50 * (factorShocks.real_rates||0) + 0.30 * (factorShocks.term_premium||0) + 0.20 * (factorShocks.dxy||0),
  };
}
function compositeNew(currentVal, deltaZ, isStressUp) {
  return Math.max(0, Math.min(100, Math.round(currentVal + deltaZ * 12 * (isStressUp ? 1 : -1))));
}
function portfolioPnL(sectorPcts, portfolio = PORTFOLIO) {
  const positions = portfolio.map(p => {
    const s = SECTOR_BY_NAME[p.sector];
    const pct = s ? sectorPcts[s.id] || 0 : 0;
    return { ...p, pct, dollar: p.value * pct / 100 };
  });
  return { positions, total: positions.reduce((s, p) => s + p.dollar, 0) };
}
function newAllocation(factorShocks, horizon) {
  const sectorPcts = sectorShocks(factorShocks, horizon);
  const SCALING = 0.75;
  const targets = SECTORS.map(s => {
    const target = s.current + sectorPcts[s.id] * SCALING;
    const floor   = s.assetClass === "Equity" ? 1 : 2;
    const ceiling = s.assetClass === "Equity" ? 30 : 40;
    return { ...s, _target: Math.max(floor, Math.min(ceiling, target)) };
  });
  const sum = targets.reduce((s, t) => s + t._target, 0);
  const scale = sum > 0 ? 100 / sum : 1;
  return targets.map(t => {
    const stressed = Math.round(t._target * scale);
    return { id: t.id, name: t.name, assetClass: t.assetClass, current: t.current, stressed, delta: stressed - t.current };
  });
}
function compositeHeadline(c) {
  const stressMove = Math.abs(c.rl);
  if (stressMove > 1.5) return "All composites shift toward Crisis band";
  if (stressMove > 0.6) return "Stress lifts; growth and rates re-rate";
  if (Math.abs(c.growth) > 0.6) return "Growth pulse moves materially";
  if (Math.abs(c.ir) > 0.6) return "Rates regime shifts";
  return "Modest composite movement";
}
function formatDollar(amt) {
  if (amt === 0) return "$0";
  const sign = amt < 0 ? "−" : "+";
  const v = Math.abs(amt);
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

// ════════════════════════════════════════════════════════════════════════
// STYLES — full v2.3 CSS as a string injected via <style>
// ════════════════════════════════════════════════════════════════════════

const STYLES = `
.scenarios-page {
  /* Spacing — map to global --space-* tokens */
  --s-1: var(--space-1);    /* 4px  */
  --s-2: var(--space-2);    /* 8px  */
  --s-3: var(--space-4);    /* 16px */
  --s-4: var(--space-6);    /* 24px */
  --s-5: var(--space-8);    /* 32px */
  --s-6: var(--space-12);   /* 48px */
  --s-7: 64px;              /* no global 64px equivalent */

  /* Radii — keep close to local intent */
  --r-sm: 4px;
  --r-md: var(--radius-xs);   /* 6px  */
  --r-lg: 8px;
  --r-xl: var(--radius-sm);   /* 10px */

  /* Brand: parchment/burgundy variants now resolve to the brand teal */
  --accent-parchment: var(--accent);
  --accent-burgundy:  var(--accent);
  --accent-warm:      var(--accent);

  /* Surfaces inherit from the global palette → dark mode now works on this page */
  --bg-0: var(--bg);
  --bg-1: var(--surface);
  --bg-2: var(--surface-2);
  --bg-3: var(--surface-3);

  /* Ink */
  --ink-0: var(--text);
  --ink-1: var(--text-2);
  --ink-2: var(--text-muted);
  --ink-3: var(--text-dim);

  /* Lines */
  --line-0: var(--border-faint);
  --line-1: var(--border);

  /* Direction stays semantic; banned ochre and Apple-bright blue folded to neutral / accent */
  --up:   var(--green);
  --down: var(--red);
  --warn: var(--text-muted);
  --info: var(--accent);

  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  max-width: 1320px;
  margin: 0 auto;
  padding: var(--s-5) var(--s-5) var(--s-7);
}
.scenarios-page .num,.scenarios-page .mono { font-family:var(--font-ui); font-variant-numeric:tabular-nums; }
.scenarios-page .tab-head { display:flex; align-items:flex-end; justify-content:space-between; gap:var(--s-5); margin-bottom:var(--s-4); padding-bottom:var(--s-3); border-bottom:1px solid var(--line-1); }
.scenarios-page .crumb { font-family:var(--font-ui); font-size:11px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-3); margin-bottom:var(--s-2); }
.scenarios-page h1.title { font-family:Fraunces,Georgia,serif; font-weight:400; font-size:34px; letter-spacing:-.015em; line-height:1.1; color:var(--ink-0); }
.scenarios-page .lede { font-size:14px; color:var(--ink-1); max-width:600px; margin-top:var(--s-2); }
.scenarios-page .lede em { font-style:italic; color:var(--accent-burgundy); }
.scenarios-page .mode-toggle { display:inline-flex; border:1px solid var(--line-1); border-radius:var(--r-lg); overflow:hidden; background:var(--bg-1); }
.scenarios-page .mode-toggle button { font-family:Inter,sans-serif; font-size:13px; font-weight:500; padding:10px 18px; border:none; background:transparent; color:var(--ink-1); cursor:pointer; transition:all 120ms; }
.scenarios-page .mode-toggle button.active { background:var(--ink-0); color:var(--bg-1); }
.scenarios-page .mode-toggle button:hover:not(.active) { background:var(--bg-2); }
.scenarios-page .builder { background:var(--bg-1); border:1px solid var(--line-1); border-radius:var(--r-xl); padding:var(--s-3) var(--s-4); margin-bottom:var(--s-4); }
.scenarios-page .builder-row { display:flex; align-items:center; gap:var(--s-3); flex-wrap:wrap; }
.scenarios-page .builder-label { font-family:var(--font-ui); font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-2); }
.scenarios-page .scenario-chips { display:flex; gap:6px; flex-wrap:wrap; }
.scenarios-page .chip { font-size:12px; font-weight:500; padding:6px 11px; border:1px solid var(--line-1); border-radius:999px; background:var(--bg-1); color:var(--ink-1); cursor:pointer; white-space:nowrap; transition:all 120ms; }
.scenarios-page .chip:hover:not(.active) { background:var(--bg-2); }
.scenarios-page .chip.active { background:var(--accent-burgundy); color:#fff; border-color:var(--accent-burgundy); }
.scenarios-page .chip.proxy::after { content:" ※"; color:var(--warn); font-weight:700; }
.scenarios-page .chip.low-conf::before { content:"◐ "; color:var(--warn); font-weight:600; }
.scenarios-page .horizon-tabs { display:inline-flex; border:1px solid var(--line-1); border-radius:var(--r-md); overflow:hidden; background:var(--bg-1); }
.scenarios-page .horizon-tabs button { font-family:var(--font-ui); font-size:12px; font-weight:500; padding:6px 14px; border:none; background:transparent; color:var(--ink-1); cursor:pointer; }
.scenarios-page .horizon-tabs button.active { background:var(--bg-3); color:var(--ink-0); font-weight:600; }
.scenarios-page .horizon-tabs button:hover:not(.active) { background:var(--bg-2); }
.scenarios-page .prop-toggle { display:inline-flex; gap:var(--s-2); align-items:center; padding:5px 10px; background:var(--bg-2); border:1px solid var(--line-1); border-radius:var(--r-md); font-size:12px; cursor:pointer; transition:all 120ms; }
.scenarios-page .prop-toggle:hover { background:var(--bg-3); }
.scenarios-page .prop-toggle .dot { width:8px; height:8px; border-radius:50%; background:var(--up); }
.scenarios-page .prop-toggle.bespoke .dot { background:var(--warn); }
.scenarios-page .prop-toggle strong { color:var(--ink-0); }
.scenarios-page .coherence { display:inline-flex; align-items:center; gap:8px; padding:7px 13px; background:rgba(31,157,96,.08); border:1px solid rgba(31,157,96,.25); border-radius:var(--r-md); font-size:12px; color:var(--ink-1); transition:all 200ms; }
.scenarios-page .coherence .score { font-family:var(--font-ui); font-weight:700; font-size:14px; color:var(--up); }
.scenarios-page .coherence.unusual { background:rgba(216,178,122,.08); border-color:rgba(216,178,122,.4); }
.scenarios-page .coherence.unusual .score { color:var(--accent-parchment); }
.scenarios-page .coherence.rare { background:rgba(107,122,133,.08); border-color:rgba(107,122,133,.3); }
.scenarios-page .coherence.rare .score { color:var(--warn); }
.scenarios-page .coherence.exotic { background:rgba(14,85,96,.08); border-color:rgba(14,85,96,.3); }
.scenarios-page .coherence.exotic .score { color:var(--accent-burgundy); }
.scenarios-page .factor-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px var(--s-4); margin-top:var(--s-3); }
.scenarios-page .factor { display:grid; grid-template-columns:100px 1fr 60px 80px 22px; align-items:center; gap:7px; padding:4px 0; }
.scenarios-page .factor-name { font-size:12px; color:var(--ink-1); font-weight:500; }
.scenarios-page .factor input[type="range"] { -webkit-appearance:none; appearance:none; width:100%; height:4px; background:var(--bg-3); border-radius:999px; outline:none; cursor:pointer; transition:background 120ms; }
.scenarios-page .factor input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:var(--ink-0); border:2px solid var(--bg-1); box-shadow:0 1px 3px rgba(0,0,0,.2); cursor:pointer; transition:all 120ms; }
.scenarios-page .factor input[type="range"]::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:var(--ink-0); border:2px solid var(--bg-1); box-shadow:0 1px 3px rgba(0,0,0,.2); cursor:pointer; }
.scenarios-page .factor.pinned input[type="range"]::-webkit-slider-thumb { background:var(--accent-burgundy); }
.scenarios-page .factor.pinned input[type="range"]::-moz-range-thumb { background:var(--accent-burgundy); }
.scenarios-page .factor.driver input[type="range"]::-webkit-slider-thumb { background:var(--accent-burgundy); transform:scale(1.15); }
.scenarios-page .factor.driver input[type="range"]::-moz-range-thumb { background:var(--accent-burgundy); }
.scenarios-page .factor.auto input[type="range"]::-webkit-slider-thumb { background:var(--ink-3); }
.scenarios-page .factor.auto input[type="range"]::-moz-range-thumb { background:var(--ink-3); }
.scenarios-page .factor.auto input[type="range"] { pointer-events:none; opacity:.7; }
.scenarios-page .factor-val { font-family:var(--font-ui); font-size:11px; font-weight:600; color:var(--ink-0); text-align:right; }
.scenarios-page .factor-nominal { font-family:var(--font-ui); font-size:11px; font-weight:500; color:var(--ink-2); text-align:right; }
.scenarios-page .factor.driver .factor-nominal { color:var(--accent-burgundy); }
.scenarios-page .factor.auto .factor-val { color:var(--ink-2); font-weight:500; }
.scenarios-page .factor-pin { font-size:13px; color:var(--ink-3); text-align:center; cursor:pointer; user-select:none; transition:color 120ms; }
.scenarios-page .factor-pin:hover { color:var(--ink-1); }
.scenarios-page .factor.pinned .factor-pin { color:var(--accent-burgundy); }
.scenarios-page .reset-btn { font-family:var(--font-ui); font-size:11px; font-weight:500; padding:5px 11px; border:1px solid var(--line-1); border-radius:var(--r-md); background:var(--bg-1); color:var(--ink-1); cursor:pointer; transition:all 120ms; }
.scenarios-page .reset-btn:hover { background:var(--bg-2); color:var(--ink-0); }
.scenarios-page .so-what { background:linear-gradient(180deg,var(--bg-1) 0%,var(--bg-2) 100%); border:1px solid var(--line-1); border-left:4px solid var(--accent-burgundy); border-radius:var(--r-xl); padding:var(--s-3) var(--s-4); margin-bottom:var(--s-4); transition:all 200ms; }
.scenarios-page .so-what.exotic { border-left-color:var(--warn); }
.scenarios-page .so-what .label { font-family:var(--font-ui); font-size:10px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:var(--accent-burgundy); margin-bottom:6px; }
.scenarios-page .so-what.exotic .label { color:var(--warn); }
.scenarios-page .so-what .punchline { font-family:Fraunces,serif; font-weight:500; font-size:20px; line-height:1.3; letter-spacing:-.005em; color:var(--ink-0); margin-bottom:6px; }
.scenarios-page .so-what .punchline em { font-style:italic; color:var(--accent-burgundy); }
.scenarios-page .so-what.exotic .punchline em { color:var(--warn); }
.scenarios-page .so-what .takeaway { font-size:13px; color:var(--ink-1); max-width:920px; }
.scenarios-page .output-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--s-3); margin-top:var(--s-3); align-items:start; }
.scenarios-page .panel { background:var(--bg-1); border:1px solid var(--line-1); border-radius:var(--r-xl); padding:var(--s-3) var(--s-4); transition:all 200ms; }
.scenarios-page .panel-eyebrow { font-family:var(--font-ui); font-size:10px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); margin-bottom:2px; }
.scenarios-page .panel-title { font-family:Fraunces,serif; font-weight:500; font-size:18px; letter-spacing:-.005em; color:var(--ink-0); margin-bottom:var(--s-3); }
.scenarios-page .composite-bars { display:flex; flex-direction:column; gap:8px; }
.scenarios-page .bar-row { display:grid; grid-template-columns:84px 1fr 110px; gap:var(--s-3); align-items:center; }
.scenarios-page .bar-label { font-size:13px; color:var(--ink-1); font-weight:500; }
.scenarios-page .bar-track { position:relative; height:8px; background:var(--bg-3); border-radius:999px; overflow:hidden; }
.scenarios-page .bar-fill { position:absolute; top:0; height:100%; border-radius:999px; transition:all 250ms ease-out; }
.scenarios-page .bar-fill.up { background:var(--up); }
.scenarios-page .bar-fill.down { background:var(--down); }
.scenarios-page .bar-fill.neutral { background:var(--ink-3); }
.scenarios-page .bar-delta { font-family:var(--font-ui); font-size:12px; font-weight:600; text-align:right; }
.scenarios-page .sector-list { display:flex; flex-direction:column; max-height:380px; overflow-y:auto; }
.scenarios-page .sector-row { display:grid; grid-template-columns:28px 1fr 50px 70px; gap:8px; align-items:center; padding:7px 0; border-bottom:1px solid var(--line-0); cursor:pointer; transition:background 120ms; }
.scenarios-page .sector-row:hover { background:var(--bg-2); }
.scenarios-page .sector-row:last-child { border-bottom:none; }
.scenarios-page .sector-row.expanded { background:var(--bg-2); border-bottom-color:var(--line-1); }
.scenarios-page .sector-rank { font-family:var(--font-ui); font-size:11px; color:var(--ink-3); }
.scenarios-page .sector-name { font-size:13px; color:var(--ink-0); }
.scenarios-page .sector-tkr { font-family:var(--font-ui); font-size:11px; color:var(--ink-2); }
.scenarios-page .sector-pct { font-family:var(--font-ui); font-size:13px; font-weight:600; text-align:right; }
.scenarios-page .sector-pct.up { color:var(--up); }
.scenarios-page .sector-pct.down { color:var(--down); }
.scenarios-page .ig-list { padding:6px 0 6px 32px; background:var(--bg-2); border-bottom:1px solid var(--line-0); }
.scenarios-page .ig-row { display:grid; grid-template-columns:1fr 70px; gap:8px; padding:4px 0; font-size:12px; }
.scenarios-page .ig-name { color:var(--ink-1); }
.scenarios-page .ig-pct { font-family:var(--font-ui); font-weight:500; text-align:right; }
.scenarios-page .ig-pct.up { color:var(--up); }
.scenarios-page .ig-pct.down { color:var(--down); }
.scenarios-page .sector-divider { font-family:var(--font-ui); font-size:10px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-3); padding:10px 0 6px; margin-top:4px; border-top:1px solid var(--line-1); }
.scenarios-page .portfolio-table { width:100%; border-collapse:collapse; font-size:12px; }
.scenarios-page .portfolio-table th { font-family:var(--font-ui); font-size:9px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); text-align:left; padding:5px 6px 5px 0; border-bottom:1px solid var(--line-1); }
.scenarios-page .portfolio-table th.right { text-align:right; }
.scenarios-page .portfolio-table td { padding:6px 6px 6px 0; border-bottom:1px solid var(--line-0); }
.scenarios-page .portfolio-table td.mono { font-family:var(--font-ui); font-variant-numeric:tabular-nums; }
.scenarios-page .portfolio-table td.right { text-align:right; }
.scenarios-page .portfolio-table td.up { color:var(--up); font-weight:600; }
.scenarios-page .portfolio-table td.down { color:var(--down); font-weight:600; }
.scenarios-page .portfolio-table tr.total td { border-top:2px solid var(--line-1); border-bottom:none; padding-top:9px; font-weight:700; }
.scenarios-page .action-subline { font-size:13px; color:var(--ink-2); margin-bottom:var(--s-3); font-style:italic; }
.scenarios-page .action-section { margin-bottom:var(--s-3); }
.scenarios-page .action-section-head { font-family:var(--font-ui); font-size:10px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-3); margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid var(--line-1); }
.scenarios-page .action-row { display:grid; grid-template-columns:1fr 80px 110px; gap:8px; align-items:baseline; padding:6px 0; font-size:13px; }
.scenarios-page .action-name { color:var(--ink-0); }
.scenarios-page .action-name .ac-tag { font-family:var(--font-ui); font-size:9px; font-weight:600; color:var(--ink-3); margin-left:6px; letter-spacing:.1em; text-transform:uppercase; }
.scenarios-page .action-delta { font-family:var(--font-ui); font-weight:700; font-size:15px; text-align:right; }
.scenarios-page .action-delta.up { color:var(--up); }
.scenarios-page .action-delta.down { color:var(--down); }
.scenarios-page .action-detail { font-family:var(--font-ui); font-size:11px; color:var(--ink-2); text-align:right; }
.scenarios-page .action-empty { font-size:12px; color:var(--ink-3); font-style:italic; padding:6px 0; }
.scenarios-page .action-footer { margin-top:var(--s-3); padding-top:var(--s-3); border-top:1px solid var(--line-1); font-family:var(--font-ui); font-size:11px; font-weight:500; color:var(--ink-1); line-height:1.7; }
.scenarios-page .action-footer .ac-pill { display:inline-block; padding:2px 8px; margin-right:6px; background:var(--bg-2); border-radius:999px; }
.scenarios-page .action-warn { margin-top:var(--s-2); font-size:11px; color:var(--warn); font-style:italic; }
.scenarios-page .disclosure { font-family:var(--font-ui); font-size:10px; color:var(--ink-2); padding:7px 11px; background:var(--bg-2); border-left:2px solid var(--accent-warm); border-radius:var(--r-sm); margin-top:var(--s-2); }
.scenarios-page .legend { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:var(--s-3); padding:8px 12px; background:rgba(216,178,122,.06); border:1px dashed var(--accent-parchment); border-radius:var(--r-sm); font-family:var(--font-ui); font-size:11px; color:var(--ink-1); }
.scenarios-page .legend .legend-label { font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-2); padding-right:6px; border-right:1px solid var(--line-1); }
.scenarios-page .legend .legend-item { display:inline-flex; align-items:center; gap:6px; }
.scenarios-page .legend .lg-marker { color:var(--warn); font-weight:700; font-size:13px; }
.scenarios-page .empty-state { text-align:center; padding:var(--s-5) 0; font-size:13px; color:var(--ink-3); }
.scenarios-page .demo-banner { background:rgba(216,178,122,.15); border:1px dashed var(--accent-parchment); padding:8px 14px; border-radius:var(--r-sm); margin-bottom:var(--s-4); font-size:12px; font-family:var(--font-ui); color:var(--ink-1); }
.scenarios-page .demo-banner b { color:var(--accent-burgundy); }

@media (max-width: 980px) {
  .scenarios-page .output-grid { grid-template-columns:1fr; }
  .scenarios-page .factor-grid { grid-template-columns:1fr; }
  .scenarios-page .tab-head { flex-direction:column; align-items:flex-start; gap:var(--s-3); }
}
`;

// ════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════

export default function ScenarioAnalysis({ onOpenTicker }) {
  const [mode, setMode] = useState("canned");
  // Wire-through to the same modals Asset Tilt uses, so a sector click here
  // opens the same rich modal there. v10_allocation.json carries the data.
  const [v10, setV10] = useState(null);
  const [sectorModal, setSectorModal] = useState(null);
  const [igModal, setIgModal] = useState(null);
  useEffect(() => {
    fetch("/v10_allocation.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setV10).catch(() => setV10(null));
  }, []);
  // Map Scenarios sector names + synthetic asset IDs → real Asset Tilt
  // sector names / tickers, so the click-target hits the right modal data.
  const SCEN_TO_AT_SECTOR = {
    "Technology": "Information Technology",
    "Communication Services": "Communication Services",
    "Financials": "Financials",
    "Discretionary": "Consumer Discretionary",
    "Industrials": "Industrials",
    "Materials": "Materials",
    "Energy": "Energy",
    "Healthcare": "Health Care",
    "Staples": "Consumer Staples",
    "Utilities": "Utilities",
    "Real Estate": "Real Estate",
  };
  // Synthetic-asset id → real ticker for TickerDetailModal
  const SCEN_TO_TICKER = {
    BIL: "BIL", TLT: "TLT", GLD: "GLD", LQD: "LQD",
    HY:  "HYG", INTL: "VXUS", BTC: "IBIT", SPX: "SPY",
    CSH: null, // cash has no ticker — click is a no-op
  };
  const openSectorByName = (scenName) => {
    if (!v10) return;
    const atName = SCEN_TO_AT_SECTOR[scenName];
    if (!atName) return;
    const sec = v10.sectors.find(x => x.sector === atName);
    if (sec) setSectorModal(sec);
  };
  const openIGByName = (igName, parentScenName) => {
    if (!v10) return;
    const parentAtName = SCEN_TO_AT_SECTOR[parentScenName];
    const ig = v10.industry_groups.find(x => x.name === igName && x.sector === parentAtName);
    if (ig) setIgModal(ig);
  };
  const handleAssetClick = (s) => {
    if (s.assetClass === "Equity" && SCEN_TO_AT_SECTOR[s.name]) {
      openSectorByName(s.name);
    } else {
      const t = SCEN_TO_TICKER[s.id];
      if (t && onOpenTicker) onOpenTicker(t);
    }
  };
  const [scenario, setScenario] = useState(null);
  const [horizon, setHorizon] = useState("3mo");
  const [prop, setProp] = useState("realistic");
  const [driver, setDriver] = useState(null);
  const [shocks, setShocks] = useState(() => Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
  const [pinned, setPinned] = useState(() => new Set());
  const [expandedSector, setExpandedSector] = useState(null);

  const stateObj = { mode, scenario, horizon, prop, driver, shocks, pinned };
  const effShocks = useMemo(() => getEffectiveShocks(stateObj), [mode, scenario, prop, driver, shocks, pinned]);
  const hasShock = Object.values(effShocks).some(v => Math.abs(v) > 0.05);
  const sectorPcts = useMemo(() => sectorShocks(effShocks, horizon), [effShocks, horizon]);
  const composites = useMemo(() => compositeShock(effShocks), [effShocks]);
  const pnl = useMemo(() => portfolioPnL(sectorPcts), [sectorPcts]);
  const score = useMemo(() => coherence(effShocks), [effShocks]);
  const tilts = useMemo(() => newAllocation(effShocks, horizon), [effShocks, horizon]);
  const { data: engineData } = useScenarioAllocations();
  const userPortfolio = useScenarioPortfolio();
  // Override the demo-portfolio P&L when we have real positions
  const realPnl = useMemo(
    () => portfolioPnL(sectorPcts, userPortfolio.positions),
    [sectorPcts, userPortfolio.positions]
  );
  const portfolioTotal = userPortfolio.total;
  const portfolioSource = userPortfolio.source;
  const portfolioUncovered = userPortfolio.uncovered;

  // Mode toggle
  const onModeChange = useCallback(m => {
    setMode(m);
    if (m === "bespoke") {
      setShocks(Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
      setDriver(null);
      setPinned(new Set());
    } else {
      setScenario(null);
    }
  }, []);

  // Scenario click
  const onScenarioClick = useCallback(id => setScenario(s => s === id ? null : id), []);

  // Slider change
  const onSliderChange = useCallback((fid, v) => {
    setShocks(prev => ({ ...prev, [fid]: v }));
    if (prop === "realistic") setDriver(fid);
    else setPinned(prev => new Set(prev).add(fid));
  }, [prop]);

  // Pin toggle
  const onPinToggle = useCallback(fid => {
    setPinned(prev => {
      const next = new Set(prev);
      if (next.has(fid)) {
        next.delete(fid);
        if (prop === "realistic" && driver === fid) {
          setDriver(null);
          setShocks(s => ({ ...s, [fid]: 0 }));
        }
      } else { next.add(fid); }
      return next;
    });
  }, [prop, driver]);

  // Prop toggle (Realistic ↔ Bespoke)
  const onPropToggle = useCallback(() => {
    if (prop === "realistic") {
      setProp("bespoke");
      if (driver) setPinned(prev => new Set(prev).add(driver));
      setDriver(null);
    } else {
      setProp("realistic");
      let maxAbs = 0, maxId = null;
      FACTOR_IDS.forEach(f => { if (Math.abs(shocks[f]) > maxAbs) { maxAbs = Math.abs(shocks[f]); maxId = f; } });
      setPinned(new Set());
      setDriver(maxId);
      if (maxId) setShocks(s => Object.fromEntries(FACTOR_IDS.map(f => [f, f === maxId ? s[f] : 0])));
    }
  }, [prop, driver, shocks]);

  const onReset = useCallback(() => {
    setShocks(Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
    setDriver(null);
    setPinned(new Set());
  }, []);

  const horizonText = horizon === "1mo" ? "1-month" : horizon === "3mo" ? "3-month" : "6-month";

  return (
    <>
      <style>{STYLES}</style>
      <div className="scenarios-page">
        <div className="demo-banner">
          <b>Scenario Analysis v2</b> · 8 historical scenarios + 12 factor sliders · click chips, drag sliders, toggle modes — outputs update in real time.<br/>
          <b>L1–L3 math</b> uses sector loadings refit against 2006–2026 monthly factor history. <b style={{color:"var(--accent-burgundy)"}}>L4 panel</b> shows live engine output for historical scenarios — picks come from the production optimizer fed a stressed factor panel.
        </div>


        <div className="tab-head">
          <div>
            <div className="crumb">04 · Scenario Analysis</div>
            <h1 className="title">Stress your book against history.</h1>
            <div className="lede">Pick a historical episode or build a custom factor shock and watch four things light up: macro composites, sector rankings, your portfolio P&L, and what the live engine would re-allocate to. Try <em>2022 Inflation</em> first — Energy should rank best, long-duration growth worst.</div>
          </div>
          <div className="mode-toggle">
            <button className={mode === "canned" ? "active" : ""} onClick={() => onModeChange("canned")}>Canned scenario</button>
            <button className={mode === "bespoke" ? "active" : ""} onClick={() => onModeChange("bespoke")}>Custom shock</button>
          </div>
        </div>

        {mode === "canned" ? (
          <div className="builder">
            <div className="builder-row">
              <div className="builder-label">Scenario</div>
              <div className="scenario-chips">
                {Object.entries(SCENARIOS).map(([id, s]) => {
                  const cls = ["chip"];
                  if (s.proxy) cls.push("proxy");
                  if (s.lowConf) cls.push("low-conf");
                  if (scenario === id) cls.push("active");
                  return <span key={id} className={cls.join(" ")} onClick={() => onScenarioClick(id)}>{s.name}</span>;
                })}
              </div>
              <div style={{marginLeft:"auto", display:"flex", gap:"var(--s-3)", alignItems:"center"}}>
                <div className="builder-label">Horizon</div>
                <div className="horizon-tabs">
                  {["1mo","3mo","6mo"].map(h => (
                    <button key={h} className={horizon === h ? "active" : ""} onClick={() => setHorizon(h)}>{h}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="legend"><span className="legend-label">Legend</span><span className="legend-item"><span className="lg-marker">◐</span> Lower-confidence calibration</span><span className="legend-item"><span className="lg-marker">※</span> Pre-1996 proxies (VXO for VIX, BAA-Treasury for HY OAS)</span></div>
          </div>
        ) : (
          <div className="builder">
            <div className="builder-row" style={{marginBottom:"var(--s-2)"}}>
              <div className="builder-label">Propagation</div>
              <div className={"prop-toggle" + (prop === "bespoke" ? " bespoke" : "")} onClick={onPropToggle}>
                <span className="dot"></span>
                <strong>{prop === "realistic" ? "Realistic" : "Custom"}</strong>
                <span style={{color:"var(--ink-2)"}}>{prop === "realistic" ? " · single driver · others auto-propagate" : " · each pinned slider moves freely · Coherence Score warns on rare combos"}</span>
              </div>
              <div style={{marginLeft:"auto", display:"flex", gap:"var(--s-3)", alignItems:"center"}}>
                <div className={"coherence" + (score >= 50 ? "" : score >= 25 ? " unusual" : score >= 5 ? " rare" : " exotic")}>
                  Coherence
                  <span className="score">{score}</span>
                  <span style={{color:"var(--ink-2)"}}>{score >= 50 ? "typical regime" : score >= 25 ? "unusual combination" : score >= 5 ? "historically rare" : "exotic — exploratory only"}</span>
                </div>
                <div className="builder-label">Horizon</div>
                <div className="horizon-tabs">
                  {["1mo","3mo","6mo"].map(h => (
                    <button key={h} className={horizon === h ? "active" : ""} onClick={() => setHorizon(h)}>{h}</button>
                  ))}
                </div>
                <button className="reset-btn" onClick={onReset}>Reset all</button>
              </div>
            </div>
            <div className="factor-grid">
              {FACTORS.map(f => {
                const isPinned = pinned.has(f.id);
                const isDriver = driver === f.id;
                const isAuto = (prop === "realistic" && driver !== null && driver !== f.id) || (prop === "bespoke" && !isPinned);
                const cls = ["factor"];
                if (isPinned) cls.push("pinned");
                if (isDriver) cls.push("driver");
                if (isAuto) cls.push("auto");
                const val = isAuto ? effShocks[f.id] : shocks[f.id];
                const nominal = fmtNominal(f.id, val);
                return (
                  <div key={f.id} className={cls.join(" ")}>
                    <span className="factor-name">{f.name}</span>
                    <input type="range" min={f.min} max={f.max} step={f.step} value={val.toFixed(2)} onChange={e => onSliderChange(f.id, parseFloat(e.target.value))} />
                    <span className="factor-val">{fmtZ(val)}</span>
                    <span className="factor-nominal" title={`${f.name} ≈ ${nominal} at ${fmtZ(val)} (calibrated 2006-2026 mean+std)`}>{nominal}</span>
                    <span className="factor-pin" onClick={() => onPinToggle(f.id)} title={isPinned ? "Unpin" : "Pin"}>{isPinned ? "📌" : "📍"}</span>
                  </div>
                );
              })}
            </div>
            <div className="disclosure">{prop === "realistic" ? "Realistic mode: drag any one slider to set it as the driver. The other 11 factors auto-propagate based on historical correlations." : "Custom mode: pin any factors you want to move freely. The other factors auto-propagate from your pins based on historical correlations."}</div>
          </div>
        )}

        {hasShock && <SoWhatHero mode={mode} scenario={scenario} score={score} pnl={realPnl} horizonText={horizonText} portfolioTotal={portfolioTotal} portfolioSource={portfolioSource} />}

        {/* L1 (3 macro composites) was retired — composites are deprecated per
            the v11 cycle-mechanism cutover. Composites belong on Macro Overview
            anyway; Scenarios is about how a shock hits the BOOK and WHICH
            sectors lead/lag. L2 takes the substance row alone; L3 + L4 sit
            below in the 2-column grid. */}
        <div style={{ marginTop: "var(--s-3)" }}>
          <L2Panel hasShock={hasShock} sectorPcts={sectorPcts} expandedSector={expandedSector} setExpandedSector={setExpandedSector} mode={mode} scenarioId={scenario} effShocks={effShocks} onAssetClick={handleAssetClick} />
        </div>
        <div className="output-grid">
          <L3Panel hasShock={hasShock} pnl={realPnl} horizon={horizon} portfolioTotal={portfolioTotal} portfolioSource={portfolioSource} portfolioUncovered={portfolioUncovered} />
          <L4Panel hasShock={hasShock} tilts={tilts} score={score} mode={mode} scenarioId={scenario} engineData={engineData} onAssetClick={handleAssetClick} onOpenTicker={onOpenTicker} />
        </div>
      </div>
      {sectorModal && v10 && <SectorModal sector={sectorModal} igs={v10.industry_groups} onClose={() => setSectorModal(null)} onIGClick={(ig) => { setSectorModal(null); setIgModal(ig); }} onEtfClick={(e) => onOpenTicker && onOpenTicker(e.t || e)} />}
      {igModal && v10 && <IGModal ig={igModal} sectorIGs={v10.industry_groups.filter(x => x.sector === igModal.sector)} parentSector={v10.sectors.find(x => x.sector === igModal.sector)} onClose={() => setIgModal(null)} onEtfClick={(e) => onOpenTicker && onOpenTicker(e.t || e)} onBackToSector={(sector) => { setIgModal(null); setSectorModal(sector); }} onTickerClick={(t) => onOpenTicker && onOpenTicker(t)} />}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════

function SoWhatHero({ mode, scenario, score, pnl, horizonText, portfolioTotal = PORTFOLIO_TOTAL, portfolioSource = "demo" }) {
  const isExotic = mode === "bespoke" && score < 5;
  const PT = portfolioTotal || PORTFOLIO_TOTAL;
  let label, punchline, takeaway;
  if (mode === "canned") {
    const sc = SCENARIOS[scenario];
    label = `So what · ${sc.name} · ${horizonText} forward`;
    const direction = pnl.total < 0 ? "hit" : "gain";
    const dollarStr = (Math.abs(pnl.total) / 1000).toFixed(0) + "K";
    punchline = (
      <>{sc.narrative.split(".")[0]}. Your ${(PT / 1000).toFixed(0)}K book takes a <em>{pnl.total < 0 ? "−" : "+"}${dollarStr} {direction}</em> over {horizonText}.</>
    );
    takeaway = sc.narrative + (sc.proxy ? " Note: pre-1996 proxies in use; magnitudes are approximations." : "") + (sc.lowConf ? " Low-confidence calibration — single recent episode." : "");
  } else {
    label = `So what · Custom · ${horizonText} forward · Coherence ${score} / 100`;
    const dollarStr = (Math.abs(pnl.total) / 1000).toFixed(0) + "K";
    const lossOrGain = pnl.total < 0 ? "hit" : "gain";
    if (score < 5) {
      punchline = <>This factor combination hasn't shown up in market history. The engine projects a <em>${dollarStr} {lossOrGain}</em> on your book — useful as a what-if, not as an allocation call.</>;
      takeaway = "When the factors you've pinned haven't moved together historically, the model can't anchor the read to a real regime. Use this for exploration; the recommended re-allocation in L4 isn't meant to be acted on.";
    } else if (score < 25) {
      punchline = <>This combination is rare in market history. Your book would take a <em>${dollarStr} {lossOrGain}</em>. The model's response is mathematically valid, but uncertainty is elevated.</>;
      takeaway = "Fewer than 25% of weekly observations from 1985–2026 produced this combination. Treat the recommended re-allocation as one option among several.";
    } else {
      punchline = <>This combination is consistent with historical regimes. Your book would take a <em>${dollarStr} {lossOrGain}</em> over {horizonText}.</>;
      takeaway = "The model's output carries normal calibration confidence.";
    }
  }
  return (
    <div className={"so-what" + (isExotic ? " exotic" : "")}>
      <div className="label">{label}</div>
      <div className="punchline">{punchline}</div>
      <div className="takeaway">{takeaway}</div>
    </div>
  );
}

function L1Panel({ hasShock, composites }) {
  const rlNew = compositeNew(CURRENT_COMPOSITES.rl, composites.rl, true);
  const grNew = compositeNew(CURRENT_COMPOSITES.growth, composites.growth, false);
  const irNew = compositeNew(CURRENT_COMPOSITES.ir, composites.ir, true);
  const renderBar = (label, current, newVal, isStressUp) => {
    const delta = newVal - current;
    const direction = (isStressUp ? delta > 0 : delta < 0) ? "down" : delta === 0 ? "neutral" : "up";
    const left = Math.min(current, newVal);
    const width = Math.abs(delta);
    return (
      <div key={label} className="bar-row">
        <div className="bar-label">{label}</div>
        <div className="bar-track">
          {hasShock
            ? <div className={"bar-fill " + direction} style={{left: left + "%", width: width + "%"}}/>
            : <div className="bar-fill neutral" style={{left: Math.max(0, current - 3) + "%", width: "6%"}}/>}
        </div>
        <div className={"bar-delta " + (hasShock ? direction : "")}>{hasShock ? `${current} → ${newVal}` : `${current} / 100`}</div>
      </div>
    );
  };
  return (
    <div className="panel">
      <div className="panel-eyebrow">L1 · Macro composites{hasShock ? " · scenario delta" : " · current state"}</div>
      <h3 className="panel-title">{hasShock ? compositeHeadline(composites) : "Composite indicators · current state"}</h3>
      <div className="composite-bars">
        {renderBar("R&L stress", CURRENT_COMPOSITES.rl, rlNew, true)}
        {renderBar("Growth", CURRENT_COMPOSITES.growth, grNew, false)}
        {renderBar("Inflation & Rates", CURRENT_COMPOSITES.ir, irNew, true)}
      </div>
      <div style={{marginTop:"var(--s-3)", fontSize:11, color:"var(--ink-2)", fontFamily:"var(--font-ui)"}}>
        {hasShock ? "Composite shocks derived from factor z-scores via current weights." : "Pick a scenario or move sliders to see composite shifts."}
      </div>
    </div>
  );
}

function L2Panel({ hasShock, sectorPcts, expandedSector, setExpandedSector, mode, scenarioId, effShocks, onAssetClick, onOpenIG }) {
  if (!hasShock) {
    return (
      <div className="panel">
        <div className="panel-eyebrow">L2 · Asset class &amp; sector reaction</div>
        <h3 className="panel-title">Idle</h3>
        <div className="empty-state">Pick a scenario or move factor sliders to see how each asset class and sector would price under the shock.</div>
      </div>
    );
  }

  const ranked = SECTORS.map(s => ({ ...s, shockPct: sectorPcts[s.id] }));
  const allSorted = [...ranked].sort((a, b) => b.shockPct - a.shockPct);

  // Asset-class roll-up using current weights as the within-class denominator
  // so the rollup matches the model baseline (current %) rather than equal-weighting.
  const classAvg = (cls) => {
    const items = ranked.filter(s => s.assetClass === cls);
    const wsum = items.reduce((s, x) => s + (x.current || 0), 0);
    if (wsum > 0) return items.reduce((s, x) => s + (x.current || 0) * x.shockPct, 0) / wsum;
    return items.length ? items.reduce((s, x) => s + x.shockPct, 0) / items.length : 0;
  };
  const equityAvg = classAvg("Equity");
  const defensiveAvg = classAvg("Defensive");
  const spread = equityAvg - defensiveAvg;

  // Driver factors — top 3 by absolute z-score, formatted with sign
  const factorMap = Object.fromEntries(FACTORS.map(f => [f.id, f.name]));
  const drivers = FACTOR_IDS
    .filter(f => Math.abs(effShocks?.[f] || 0) >= 0.5)
    .sort((a, b) => Math.abs(effShocks[b]) - Math.abs(effShocks[a]))
    .slice(0, 3)
    .map(f => `${factorMap[f]} ${fmtZ(effShocks[f])}`);

  // Headline + narrative — driven by the SCENARIOS metadata for canned, by
  // top driver for bespoke. Replaces the prior data-replay headline.
  let headline, narrative, window;
  if (mode === "canned" && scenarioId && SCENARIOS[scenarioId]) {
    const sc = SCENARIOS[scenarioId];
    headline = sc.name;
    narrative = sc.narrative;
    window = sc.window;
  } else {
    const top = drivers[0] || "factor moves";
    headline = `Custom shock · ${top} dominates`;
    narrative = drivers.length
      ? `Engine prices each asset class off its loadings to the moved factors. Largest moves: ${drivers.join(" · ")}.`
      : "Move factor sliders to see how each asset class and sector would price under the shock.";
    window = null;
  }

  const maxAbsShock = Math.max(...allSorted.map(s => Math.abs(s.shockPct)), 0.01);

  return (
    <div className="panel">
      <div className="panel-eyebrow">L2 · Asset class &amp; sector reaction · click any row to open the asset detail</div>
      <h3 className="panel-title">{headline}{window ? <span style={{fontFamily:"var(--font-ui)", fontSize:11, color:"var(--ink-3)", marginLeft:8, fontWeight:400}}>{window}</span> : null}</h3>
      <div style={{fontSize:12, color:"var(--ink-2)", marginBottom:6}}>How asset classes and sectors performed over the stressed period.</div>
      <div className="action-subline" style={{fontStyle:"normal"}}>{narrative}</div>

      {drivers.length > 0 && (
        <div style={{display:"flex", flexWrap:"wrap", gap:6, margin:"0 0 var(--s-3)"}}>
          <span style={{fontFamily:"var(--font-ui)", fontSize:10, fontWeight:600, letterSpacing:".14em", textTransform:"uppercase", color:"var(--ink-3)", alignSelf:"center", marginRight:4}}>Drivers</span>
          {drivers.map(d => (
            <span key={d} style={{display:"inline-block", padding:"2px 8px", background:"var(--bg-2)", border:"1px solid var(--line-1)", borderRadius:999, fontFamily:"var(--font-ui)", fontSize:11, color:"var(--ink-1)"}}>{d}</span>
          ))}
        </div>
      )}

      <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:0, padding:"10px 14px", background:"var(--bg-2)", border:"1px solid var(--line-1)", borderRadius:"var(--r-sm)", marginBottom:"var(--s-3)"}}>
        <div style={{paddingRight:14, borderRight:"1px solid var(--line-1)"}}>
          <div style={{fontFamily:"var(--font-ui)", fontSize:9, fontWeight:600, letterSpacing:".14em", textTransform:"uppercase", color:"var(--ink-3)"}}>Equity sleeve avg</div>
          <div className={"action-delta " + (equityAvg < 0 ? "down" : "up")} style={{textAlign:"left"}}>{equityAvg >= 0 ? "+" : ""}{equityAvg.toFixed(1)}%</div>
        </div>
        <div style={{paddingLeft:14, paddingRight:14, borderRight:"1px solid var(--line-1)"}}>
          <div style={{fontFamily:"var(--font-ui)", fontSize:9, fontWeight:600, letterSpacing:".14em", textTransform:"uppercase", color:"var(--ink-3)"}}>Defensive sleeve avg</div>
          <div className={"action-delta " + (defensiveAvg < 0 ? "down" : "up")} style={{textAlign:"left"}}>{defensiveAvg >= 0 ? "+" : ""}{defensiveAvg.toFixed(1)}%</div>
        </div>
        <div style={{paddingLeft:14}}>
          <div style={{fontFamily:"var(--font-ui)", fontSize:9, fontWeight:600, letterSpacing:".14em", textTransform:"uppercase", color:"var(--ink-3)"}}>Equity-vs-defensive spread</div>
          <div className={"action-delta " + (spread < 0 ? "down" : "up")} style={{textAlign:"left"}}>{spread >= 0 ? "+" : ""}{spread.toFixed(1)}%</div>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"28px minmax(140px, 220px) 70px 60px 70px minmax(140px, 1fr) 60px", gap:10, padding:"4px 0 6px", borderBottom:"1px solid var(--line-1)", fontFamily:"var(--font-ui)", fontSize:9, fontWeight:600, letterSpacing:".14em", textTransform:"uppercase", color:"var(--ink-3)"}}>
        <span>#</span>
        <span>Asset / Sector</span>
        <span style={{textAlign:"left"}}>Class</span>
        <span style={{textAlign:"right"}}>Curr %</span>
        <span style={{textAlign:"right"}}>Shock %</span>
        <span style={{textAlign:"center"}}>← Down · Up →</span>
        <span style={{textAlign:"right"}}>Tkr</span>
      </div>

      <div className="sector-list" style={{maxHeight:"420px"}}>
        {allSorted.map((s, i) => {
          const isEquity = s.assetClass === "Equity";
          const expandable = isEquity && s.igs && s.igs.length > 0;
          return (
            <div key={s.id}>
              <div
                className={"sector-row" + (expandedSector === s.id ? " expanded" : "")}
                onClick={() => onAssetClick && onAssetClick(s)}
                style={{cursor: "pointer", gridTemplateColumns:"28px minmax(140px, 220px) 70px 60px 70px minmax(140px, 1fr) 60px", gap:10}}
              >
                <span className="sector-rank">#{i+1}</span>
                <span className="sector-name">{s.name}</span>
                <span style={{fontFamily:"var(--font-ui)", fontSize:10, color:"var(--ink-3)", letterSpacing:".10em", textTransform:"uppercase"}}>{isEquity ? "Equity" : "Defensive"}</span>
                <span style={{fontFamily:"var(--font-ui)", fontSize:12, color:"var(--ink-2)", textAlign:"right"}}>{(s.current || 0).toFixed(0)}%</span>
                <span className={"sector-pct " + (s.shockPct > 0 ? "up" : "down")}>{s.shockPct >= 0 ? "+" : ""}{s.shockPct.toFixed(1)}%</span>
                <span style={{position:"relative", height:8, alignSelf:"center"}}>
                  <span style={{position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"var(--line-1)"}} />
                  {s.shockPct >= 0
                    ? <span style={{position:"absolute", left:"50%", top:0, bottom:0, width:`${(Math.abs(s.shockPct) / maxAbsShock) * 50}%`, background:"var(--up)", opacity:.7, borderRadius:2}} />
                    : <span style={{position:"absolute", right:"50%", top:0, bottom:0, width:`${(Math.abs(s.shockPct) / maxAbsShock) * 50}%`, background:"var(--down)", opacity:.7, borderRadius:2}} />
                  }
                </span>
                <span className="sector-tkr" style={{textAlign:"right"}}>{s.id}</span>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

function L3Panel({ hasShock, pnl, horizon, portfolioTotal = PORTFOLIO_TOTAL, portfolioSource = "demo", portfolioUncovered = [] }) {
  const PT = portfolioTotal || PORTFOLIO_TOTAL;
  const eyebrowSuffix = portfolioSource === "user"
    ? "your real book · live"
    : "demo book · sign in for your real positions";
  if (!hasShock) {
    return (
      <div className="panel">
        <div className="panel-eyebrow">L3 · Your portfolio · {eyebrowSuffix}</div>
        <h3 className="panel-title">Position-level P&amp;L · idle</h3>
        <div className="empty-state">Pick a scenario or move factor sliders to populate.</div>
      </div>
    );
  }
  // Use absolute portfolio value as the denominator so margin debits don't
  // distort the % book impact reading.
  const denom = Math.abs(PT) > 1 ? Math.abs(PT) : 1;
  const totalPct = (pnl.total / denom * 100);
  const sortedPositions = [...pnl.positions].sort((a, b) => Math.abs(b.dollar) - Math.abs(a.dollar));
  const top5 = sortedPositions.slice(0, 5);
  const others = sortedPositions.slice(5);
  const totalCls = pnl.total < 0 ? "down" : "up";
  const uncoveredValue = (portfolioUncovered || []).reduce((s, p) => s + Math.abs(p.value || 0), 0);
  const isDemo = portfolioSource !== "user";
  return (
    <div className="panel">
      <div className="panel-eyebrow">L3 · Your portfolio · {eyebrowSuffix}</div>
      {isDemo ? (
        <>
          <h3 className="panel-title">Sign in to see how your real positions react.</h3>
          <p style={{fontSize:13, color:"var(--ink-2)", marginTop:"var(--s-2)", marginBottom:"var(--s-3)"}}>
            The table below is a generic 5-name sample for illustration. Your numbers will replace it once you sign in.
          </p>
        </>
      ) : (
        <h3 className="panel-title" style={{color: pnl.total < 0 ? "var(--down)" : pnl.total > 0 ? "var(--up)" : "var(--ink-0)"}}>
          {formatDollar(pnl.total)} · {Math.abs(totalPct).toFixed(1)}% of book · {horizon} horizon
        </h3>
      )}
      <table className="portfolio-table" style={isDemo ? {opacity: 0.7} : {}}>
        <thead>
          <tr><th>Ticker</th><th>Sector</th><th className="right">Weight</th><th className="right">Shock %</th><th className="right">P&amp;L $</th></tr>
        </thead>
        <tbody>
          {top5.map(p => {
            const cls = p.dollar < 0 ? "down" : p.dollar > 0 ? "up" : "";
            return (
              <tr key={p.ticker + "-" + p.sector}>
                <td className="mono">{p.ticker}</td>
                <td>{p.sector}</td>
                <td className={"right mono"}>{p.weight.toFixed(1)}%</td>
                <td className={"right mono " + cls}>{p.pct >= 0 ? "+" : ""}{p.pct.toFixed(1)}%</td>
                <td className={"right mono " + cls}>{formatDollar(p.dollar)}</td>
              </tr>
            );
          })}
          {others.length > 0 && <tr><td colSpan="5" style={{textAlign:"center", color:"var(--ink-3)", fontSize:10, padding:"6px 0"}}>… {others.length} more positions</td></tr>}
          <tr className="total">
            <td colSpan="2">Total book impact</td>
            <td className="right mono">100%</td>
            <td className={"right mono " + totalCls}>{totalPct >= 0 ? "+" : ""}{totalPct.toFixed(1)}%</td>
            <td className={"right mono " + totalCls}>{formatDollar(pnl.total)}</td>
          </tr>
        </tbody>
      </table>
      {portfolioSource === "user" && (
        <div style={{marginTop:"var(--s-3)", paddingTop:"var(--s-3)", borderTop:"1px dashed var(--line-1)", fontSize:10, color:"var(--ink-3)", fontFamily:"var(--font-ui)", fontStyle:"italic", lineHeight:1.5}}>
          Live read of your real positions ($
          {(Math.abs(PT) / 1000).toFixed(0)}K across {pnl.positions.length} modeled
          {portfolioUncovered.length > 0 ? ` + ${portfolioUncovered.length} not modeled (~$${(uncoveredValue/1000).toFixed(0)}K — options, illiquids)` : ""}
          ). Synthetic-sector loadings (HY Bonds, International, Crypto, Broad US Equity) are textbook-defensible v1 starting points; empirical refit lands in Sprint 2.7.
        </div>
      )}
    </div>
  );
}

function L4Panel({ hasShock, tilts, score, mode, scenarioId, engineData, onAssetClick, onOpenTicker }) {
  // Sprint 2: real engine output for canned scenarios. Bespoke (custom shock)
  // mode still uses sector-loadings math below — composite stress + arbitrary-shock
  // engine wiring lands later.
  const realEngine = mode === "canned" && scenarioId && engineData?.scenarios?.[scenarioId];

  if (!hasShock) {
    return (
      <div className="panel">
        <div className="panel-eyebrow">L4 · Recommended portfolio</div>
        <h3 className="panel-title">Idle</h3>
        <div className="empty-state">Pick a scenario or move factor sliders to see the engine's recommended target portfolio under that regime — sectors, defensive sleeve, asset-class mix, all expressed as % of total book.</div>
      </div>
    );
  }

  if (realEngine) {
    return <L4PanelReal scenario={realEngine} baseline={engineData.baseline} asOf={engineData.factor_panel_last_obs} />;
  }

  // ---- Sector-loadings target portfolio (canned-without-engine + bespoke) ----
  const equity = tilts.filter(t => t.assetClass === "Equity").sort((a, b) => b.stressed - a.stressed);
  const defensive = tilts.filter(t => t.assetClass === "Defensive").sort((a, b) => b.stressed - a.stressed);
  const equityTotal = equity.reduce((s, t) => s + t.stressed, 0);
  const defensiveTotal = defensive.reduce((s, t) => s + t.stressed, 0);
  const grandTotal = equityTotal + defensiveTotal;

  const scName = mode === "canned" && scenarioId && SCENARIOS[scenarioId]
    ? SCENARIOS[scenarioId].name
    : "this shock";

  let headline, subline;
  if (defensiveTotal >= 25) {
    headline = `Defensive-tilted target · ${defensiveTotal}% in cushions, ${equityTotal}% in equity`;
  } else if (defensiveTotal >= 10) {
    headline = `Mixed defensive overlay · ${defensiveTotal}% sleeve, ${equityTotal}% equity`;
  } else {
    headline = `Equity-led target · ${equityTotal}% equity, ${defensiveTotal}% defensive`;
  }
  subline = (
    <>Target weights from re-running the allocator with the stressed factor panel for <b>{scName}</b>. Per-asset floors and ceilings honored ({"±"}1–40% per asset, classes re-summed to 100%). Compare against your live book in L3.</>
  );

  const renderRow = (t) => {
    const isHeavy = t.stressed >= 10;
    return (
      <div key={t.id} className="action-row" style={{gridTemplateColumns:"1fr 80px 110px", cursor:"pointer"}} onClick={() => onAssetClick && onAssetClick(t)}>
        <span className="action-name"><b style={{fontFamily:"var(--font-ui)", color:"var(--ink-2)", fontSize:11, marginRight:6}}>{t.id}</b>{t.name}</span>
        <span className="action-delta" style={{color:isHeavy ? "var(--ink-0)" : "var(--ink-1)"}}>{t.stressed}%</span>
        <span className="action-detail">{t.current}% baseline</span>
      </div>
    );
  };

  const warn = mode === "bespoke" && score < 5
    ? `⚠ Coherence ${score}/100 — engine output is mathematically valid but regime-incoherent. Treat as exploratory only.`
    : mode === "bespoke" && score < 25
      ? "⚠ Historically rare combination — engine confidence reduced."
      : null;

  return (
    <div className="panel">
      <div className="panel-eyebrow">L4 · Recommended portfolio · target weights under {scName}</div>
      <h3 className="panel-title">{headline}</h3>
      <div className="action-subline" style={{fontStyle:"normal"}}>{subline}</div>

      <div className="action-section">
        <div className="action-section-head">Equity sleeve · target {equityTotal}% of book</div>
        {equity.length > 0 ? equity.map(renderRow) : <div className="action-empty">No equity exposure under this scenario.</div>}
      </div>
      <div className="action-section">
        <div className="action-section-head">Defensive sleeve · target {defensiveTotal}% of book</div>
        {defensive.length > 0 ? defensive.map(renderRow) : <div className="action-empty">Sleeve dormant — engine stays fully invested.</div>}
      </div>

      <div className="action-footer">
        Asset-class mix:
        <span className="ac-pill"><strong>Equity</strong> {equityTotal}%</span>
        <span className="ac-pill"><strong>Defensive</strong> {defensiveTotal}%</span>
        <span className="ac-pill" style={{color:"var(--ink-3)"}}>Sums to {grandTotal}%</span>
      </div>
      {warn && <div className="action-warn">{warn}</div>}
    </div>
  );
}

// L4Panel — REAL ENGINE OUTPUT variant (canned scenarios, Sprint 2)
// ════════════════════════════════════════════════════════════════════════

function L4PanelReal({ scenario, baseline, asOf }) {
  const stressed = scenario.stressed_allocation;
  const baselinePicks = baseline.picks;
  const baselinePicksByT = Object.fromEntries(baselinePicks.map(p => [p.ticker, p]));
  const stressedPicks = stressed.picks;
  const stressedPicksByT = Object.fromEntries(stressedPicks.map(p => [p.ticker, p]));
  const added = stressedPicks.filter(p => !baselinePicksByT[p.ticker]);
  const removed = baselinePicks.filter(p => !stressedPicksByT[p.ticker]);
  const kept = stressedPicks.filter(p => baselinePicksByT[p.ticker]);

  const stressedDef = stressed.defensive || [];
  const baselineDef = baseline.defensive || [];
  const baselineDefByT = Object.fromEntries(baselineDef.map(d => [d.ticker, d]));

  const equityShareCurr = (baseline.equity_share * 100).toFixed(0);
  const equityShareStr  = (stressed.equity_share * 100).toFixed(0);
  const alphaCurr = (baseline.alpha * 100).toFixed(0);
  const alphaStr  = (stressed.alpha * 100).toFixed(0);

  // Headline copy
  let headline;
  if (added.length > 0 && removed.length > 0) {
    const addNames = added.slice(0, 2).map(p => p.ticker).join(" + ");
    const remNames = removed.slice(0, 2).map(p => p.ticker).join(" + ");
    headline = `Engine rotates picks: drops ${remNames}, adds ${addNames}`;
  } else if (added.length > 0) {
    headline = `Engine adds ${added.map(p => p.ticker).slice(0, 3).join(" + ")} to picks`;
  } else if (removed.length > 0) {
    headline = `Engine drops ${removed.map(p => p.ticker).slice(0, 3).join(" + ")} from picks`;
  } else {
    headline = `Engine keeps the same 5 picks; reweights within equity`;
  }

  const subline = (
    <>
      Re-ran the optimizer with the {scenario.name} CCAR shock translated to the model panel. <b>{kept.length}</b> picks held, <b>{added.length}</b> added, <b>{removed.length}</b> dropped. Equity share <span className="mono">{equityShareCurr}% → {equityShareStr}%</span>, alpha <span className="mono">{alphaCurr}% → {alphaStr}%</span>.
    </>
  );

  const fmtMu = v => (v * 100).toFixed(2) + "%";
  const fmtW  = v => (v * 100).toFixed(1) + "%";
  const muDelta = (sticker, baseTicker) => {
    const sm = stressedPicksByT[sticker]?.expected_return_monthly;
    const bm = baselinePicksByT[baseTicker]?.expected_return_monthly;
    if (sm == null || bm == null) return null;
    const d = sm - bm;
    return { val: d, str: (d >= 0 ? "+" : "") + (d * 100).toFixed(2) + "%" };
  };

  return (
    <div className="panel">
      <div className="panel-eyebrow">L4 · Stressed allocation · live engine output</div>
      <h3 className="panel-title">{headline}</h3>
      <div className="action-subline">{subline}</div>

      {added.length > 0 && (
        <div className="action-section">
          <div className="action-section-head" style={{color:"var(--up)"}}>Added picks</div>
          {added.map(p => (
            <div key={p.ticker} className="action-row">
              <span className="action-name"><b>{p.ticker}</b> · {p.name}</span>
              <span className="action-delta up">{fmtW(p.weight)}</span>
              <span className="action-detail" style={{fontFamily:"var(--font-ui)"}}>μ {fmtMu(p.expected_return_monthly)}</span>
            </div>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div className="action-section">
          <div className="action-section-head" style={{color:"var(--down)"}}>Dropped picks</div>
          {removed.map(p => (
            <div key={p.ticker} className="action-row">
              <span className="action-name"><b>{p.ticker}</b> · {p.name}</span>
              <span className="action-delta down">−{fmtW(p.weight)}</span>
              <span className="action-detail" style={{fontFamily:"var(--font-ui)"}}>was {fmtW(p.weight)}</span>
            </div>
          ))}
        </div>
      )}
      {kept.length > 0 && (
        <div className="action-section">
          <div className="action-section-head">Held picks · μ change</div>
          {kept.map(p => {
            const d = muDelta(p.ticker, p.ticker);
            return (
              <div key={p.ticker} className="action-row">
                <span className="action-name"><b>{p.ticker}</b> · {p.name}</span>
                <span className="action-delta" style={{color:"var(--ink-1)"}}>{fmtW(p.weight)}</span>
                <span className="action-detail" style={{fontFamily:"var(--font-ui)", color: d && d.val > 0 ? "var(--up)" : d && d.val < 0 ? "var(--down)" : "var(--ink-3)"}}>
                  μ {fmtMu(p.expected_return_monthly)}{d ? ` (${d.str})` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="action-section">
        <div className="action-section-head">Defensive sleeve</div>
        {stressedDef.map(d => {
          const b = baselineDefByT[d.ticker];
          const change = b ? d.weight - b.weight : d.weight;
          const dir = change > 0.001 ? "up" : change < -0.001 ? "down" : null;
          return (
            <div key={d.ticker} className="action-row">
              <span className="action-name"><b>{d.ticker}</b> · {d.fund}</span>
              <span className={"action-delta " + (dir || "")} style={!dir ? {color:"var(--ink-3)"} : {}}>{fmtW(d.weight)}</span>
              <span className="action-detail" style={{fontFamily:"var(--font-ui)", color:"var(--ink-3)"}}>
                {b ? `was ${fmtW(b.weight)}` : "new"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="action-footer">
        Engine state:
        <span className="ac-pill"><strong>R&L</strong> {stressed.regime.risk_liquidity.toFixed(1)}</span>
        <span className="ac-pill"><strong>Growth</strong> {stressed.regime.growth.toFixed(1)}</span>
        <span className="ac-pill"><strong>I&R</strong> {stressed.regime.inflation_rates.toFixed(1)}</span>
        <span className="ac-pill"><strong>Picks</strong> {stressed.selection_confidence}</span>
      </div>

      <div style={{marginTop:"var(--s-3)", paddingTop:"var(--s-3)", borderTop:"1px dashed var(--line-1)", fontSize:10, color:"var(--ink-3)", fontFamily:"var(--font-ui)", fontStyle:"italic"}}>
        Live engine output · panel as of {asOf} · engine output not yet validated against historical actuals (acceptance gates pending). Composites held at current values for now; future iterations will stress them too.
      </div>
    </div>
  );
}

