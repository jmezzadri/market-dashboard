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

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useUserPortfolio } from "../hooks/useUserPortfolio";
import { useSortableTable, SortArrow, sortableHeaderProps } from "../hooks/useSortableTable";
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

// Slider id → key in public/indicator_history.json. Some IDs differ from
// history keys (dxy → usd in the data feed, hy → hy_ig). aaii/putcall/breadth
// are not tracked in the history feed; those sliders default to z = 0
// (slider sits at baseline mean) until a feed is added.
const FACTOR_HISTORY_KEYS = {
  vix: "vix",
  move: "move",
  real_rates: "real_rates",
  term_premium: "term_premium",
  dxy: "usd",
  copper_gold: "copper_gold",
  hy: "hy_ig",
  stlfsi: "stlfsi",
  anfci: "anfci",
  aaii: null,
  putcall: null,
  breadth: null,
};

// Convert today's reading on an indicator-history series into a σ-z
// relative to FACTOR_BASELINES (the calibration the σ readout uses).
// Result: slider position reflects where the factor sits in real life RIGHT
// NOW. Custom mode starts from these readings so users shock from reality,
// not from a synthetic zero.
function getCurrentReadings(indicatorHistory) {
  const out = {};
  FACTOR_IDS.forEach(fid => {
    const histKey = FACTOR_HISTORY_KEYS[fid];
    const baseline = FACTOR_BASELINES[fid];
    if (!histKey || !baseline || !indicatorHistory || !indicatorHistory[histKey]) {
      out[fid] = 0;
      return;
    }
    const points = indicatorHistory[histKey].points;
    if (!points || !points.length) { out[fid] = 0; return; }
    const lastValue = points[points.length - 1][1];
    if (typeof lastValue !== "number" || !isFinite(lastValue) || !baseline.std) {
      out[fid] = 0;
      return;
    }
    out[fid] = (lastValue - baseline.mean) / baseline.std;
  });
  return out;
}

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
function getEffectiveShocks(state) {
  if (state.mode === "canned") {
    return state.scenario ? { ...SCENARIOS[state.scenario].factors } : Object.fromEntries(FACTOR_IDS.map(f => [f, 0]));
  }
  if (state.prop === "realistic" && state.driver) {
    return propagateRealistic(state.driver, state.shocks[state.driver]);
  }
  // Custom mode: each slider is independent. No propagation, no pins.
  // Plausibility of the combination is reported separately by the
  // coherence() badge — input control and plausibility check are
  // intentionally decoupled here.
  return { ...state.shocks };
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
/* Segmented control — used for the PROPAGATION (Realistic / Custom) toggle.
   Mirrors the look of .horizon-tabs so the page reads as one design language. */
.scenarios-page .prop-toggle { display:inline-flex; border:1px solid var(--line-1); border-radius:var(--r-md); overflow:hidden; background:var(--bg-1); }
.scenarios-page .prop-toggle button { font-family:var(--font-ui); font-size:12px; font-weight:500; padding:6px 14px; border:none; background:transparent; color:var(--ink-1); cursor:pointer; transition:background 120ms, color 120ms; white-space:nowrap; }
.scenarios-page .prop-toggle button + button { border-left:1px solid var(--line-1); }
.scenarios-page .prop-toggle button:hover:not(.active) { background:var(--bg-2); }
.scenarios-page .prop-toggle button.active { background:var(--ink-0); color:var(--bg-1); font-weight:600; }
.scenarios-page .prop-toggle .dot { display:none; } /* legacy single-button decoration, no longer used */
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

/* ── bespoke shock sliders (added 2026-05-10 — were missing entirely) ── */
.scenarios-page .sliders { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px 24px; margin-top:var(--s-3); }
.scenarios-page .slider-row { display:grid; grid-template-columns:120px 1fr 96px; align-items:center; gap:12px; padding:6px 8px; border-radius:var(--r-sm); border-left:3px solid transparent; transition:background 120ms, border-color 120ms; }
.scenarios-page .slider-row:hover { background:var(--bg-2); }
.scenarios-page .slider-row.driver { background:rgba(184,70,47,.10); border-left-color:var(--accent-burgundy); }
.scenarios-page .slider-row .slider-label { font-family:var(--font-ui); font-size:12px; color:var(--ink-1); font-weight:500; }
.scenarios-page .slider-row input[type="range"] { width:100%; accent-color:var(--accent-burgundy); }
.scenarios-page .slider-row .slider-val { display:flex; flex-direction:column; align-items:flex-end; line-height:1.15; font-family:var(--font-ui); font-variant-numeric:tabular-nums; }
.scenarios-page .slider-row .slider-val .sigma { font-size:12px; font-weight:600; color:var(--ink-0); }
.scenarios-page .slider-row .slider-val .nominal { font-size:10.5px; color:var(--ink-2); margin-top:1px; }

@media (max-width: 980px) {
  .scenarios-page .output-grid { grid-template-columns:1fr; }
  .scenarios-page .factor-grid { grid-template-columns:1fr; }
  .scenarios-page .tab-head { flex-direction:column; align-items:flex-start; gap:var(--s-3); }
  .scenarios-page .sliders { grid-template-columns:1fr; }
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
  const [indicatorHistory, setIndicatorHistory] = useState(null);
  const [igLoadings, setIgLoadings] = useState(null);
  const [sectorModal, setSectorModal] = useState(null);
  const [igModal, setIgModal] = useState(null);
  useEffect(() => {
    fetch("/v10_allocation.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setV10).catch(() => setV10(null));
  }, []);

  // Phase 2D/2E — load the scenario stress snapshot + current cycle board so
  // the Cycle Mechanism Scenario Results table can render `current → stressed`
  // for the selected scenario. Both files refresh nightly via their
  // respective producers; cache: no-cache so the table always shows the
  // latest published numbers.
  // Phase 2E feedback fix — fetch indicator_history so the per-indicator
  // drilldown can show the live "current reading" for each indicator next
  // to the calibrated stressed value. Same convention as the rest of the
  // dashboard: latest non-null point in the series.
  useEffect(() => {
    fetch("/indicator_history.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("indicator_history.json HTTP " + r.status)))
      .then(setIndicatorHistory)
      .catch((err) => { console.warn("[Phase 2E] indicator_history.json fetch failed", err); });
  }, []);

  // Phase 2G — load per-IG factor loadings (parent-sector inheritance + per-IG
  // beta vs SPY) so the Asset Tilt Engine table can show live stress numbers
  // for every IG row. Refreshed weekly by compute_ig_factor_loadings.py.
  useEffect(() => {
    fetch("/ig_factor_loadings.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("ig_factor_loadings.json HTTP " + r.status)))
      .then(setIgLoadings)
      .catch((err) => { console.warn("[Phase 2G] ig_factor_loadings.json fetch failed", err); });
  }, []);
  // Escape-key closes whichever modal is on top
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (igModal) setIgModal(null);
      else if (sectorModal) setSectorModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [igModal, sectorModal]);
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
  const [expandedSector, setExpandedSector] = useState(null);
  // Joe directive 2026-05-08: Asset Tilt sectors are collapseable, default collapsed.
  const [expandedSectors, setExpandedSectors] = useState(() => new Set());
  const toggleSectorExpanded = useCallback((sectorId) => {
    setExpandedSectors(prev => {
      const next = new Set(prev);
      if (next.has(sectorId)) next.delete(sectorId);
      else next.add(sectorId);
      return next;
    });
  }, []);

  // When indicator_history first loads, seed Custom-mode sliders with
  // today's live readings (only if the user hasn't already started shocking
  // values). This makes "click Custom Multi-Factor Shock" land you at
  // reality instead of zeros.
  const [readingsSeeded, setReadingsSeeded] = useState(false);
  useEffect(() => {
    if (readingsSeeded) return;
    if (!indicatorHistory) return;
    if (mode !== "bespoke" || prop !== "bespoke") return;
    // Only auto-seed if the user is at the all-zeros default.
    const anyDirty = FACTOR_IDS.some(f => Math.abs(shocks[f] || 0) > 0.01);
    if (anyDirty) return;
    setShocks(getCurrentReadings(indicatorHistory));
    setReadingsSeeded(true);
  }, [indicatorHistory, mode, prop, shocks, readingsSeeded]);

  const stateObj = { mode, scenario, horizon, prop, driver, shocks };
  const effShocks = useMemo(() => getEffectiveShocks(stateObj), [mode, scenario, prop, driver, shocks]);
  const hasShock = Object.values(effShocks).some(v => Math.abs(v) > 0.05);
  const sectorPcts = useMemo(() => sectorShocks(effShocks, horizon), [effShocks, horizon]);

  // Phase 2G — per-IG stress %. Same dot-product math as sectorShocks(), but
  // IG-specific: parent-sector loadings (from ig_factor_loadings.json, v1
  // parent_sector_inherit) × the IG's own beta vs SPY, then horizon-scaled.
  // {ig_id: pct}.
  const igPcts = useMemo(() => {
    const out = {};
    if (!igLoadings || !Array.isArray(igLoadings.industry_groups)) return out;
    const horizonMult = horizon === "1mo" ? 0.5 : horizon === "3mo" ? 1.0 : 1.55;
    igLoadings.industry_groups.forEach((ig) => {
      if (!ig.loadings || ig.beta_vs_spy == null) return;
      let total = 0;
      Object.entries(ig.loadings).forEach(([f, l]) => {
        total += (l || 0) * (effShocks[f] || 0);
      });
      out[ig.id] = -1.4 * ig.beta_vs_spy * total * horizonMult;
    });
    return out;
  }, [igLoadings, effShocks, horizon]);
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

  // Mode toggle. Entering bespoke seeds shocks based on prop:
  //   - Custom (prop = "bespoke")  → start at today's live readings
  //   - Realistic (prop = "realistic") → start at 0 (slider becomes driver)
  // Canned mode clears the scenario selection on exit.
  const onModeChange = useCallback(m => {
    setMode(m);
    if (m === "bespoke") {
      if (prop === "bespoke") {
        setShocks(getCurrentReadings(indicatorHistory));
      } else {
        setShocks(Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
      }
      setDriver(null);
    } else {
      setScenario(null);
    }
  }, [prop, indicatorHistory]);

  // Scenario click
  const onScenarioClick = useCallback(id => setScenario(s => s === id ? null : id), []);

  // Slider change. Realistic mode tags the dragged factor as the
  // driver (propagation source). Custom mode: each slider is independent,
  // the value lands in state.shocks and nothing else is affected.
  const onSliderChange = useCallback((fid, v) => {
    setShocks(prev => ({ ...prev, [fid]: v }));
    if (prop === "realistic") setDriver(fid);
  }, [prop]);

  // Prop toggle (Realistic ↔ Custom).
  // Realistic → all sliders reset to 0; first drag becomes the driver.
  // Custom → seed from today's live readings so the user shocks from reality.
  const onPropToggle = useCallback(() => {
    if (prop === "realistic") {
      setProp("bespoke");
      setShocks(getCurrentReadings(indicatorHistory));
      setDriver(null);
    } else {
      setProp("realistic");
      setShocks(Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
      setDriver(null);
    }
  }, [prop, indicatorHistory]);

  const onReset = useCallback(() => {
    if (prop === "bespoke") {
      setShocks(getCurrentReadings(indicatorHistory));
    } else {
      setShocks(Object.fromEntries(FACTOR_IDS.map(f => [f, 0])));
    }
    setDriver(null);
  }, [prop, indicatorHistory]);

  const horizonText = horizon === "1mo" ? "1-month" : horizon === "3mo" ? "3-month" : "6-month";

  // === SHORT NAMES for the Scenario Selection card ===
  // Joe mockup 2026-05-08: 8 historical scenario buttons in 2x4, plus Custom.
  const SCENARIO_SHORT = {
    black_monday_1987:     "Black Monday ('87)",
    dotcom_slow_2000:      "Dot Com Lead Up ('00)",
    dotcom_capitulation_2002: "Dot Com Final Flush ('02)",
    gfc_2008:              "GFC ('08)",
    q4_2018:               "Rate Hikes ('18)",
    covid_2020:            "Covid ('20)",
    inflation_2022:        "Inflation ('22)",
    ai_2024:               "AI Correction ('24)",
  };
  const _eyebrow = { fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:14 };
  const _h1 = { fontFamily:"var(--font-display)", fontWeight:400, fontSize:"clamp(28px, 3.4vw, 38px)", lineHeight:1.18, letterSpacing:"-0.012em", color:"var(--text)", margin:"0 0 12px" };
  const _emItalic = { fontStyle:"italic", color:"var(--accent)", fontWeight:500 };
  const _subtitle = { fontFamily:"var(--font-ui)", fontSize:16, color:"var(--text-2)", lineHeight:1.55, margin:"10px 0 0", maxWidth:720 };
  const _rightCard = { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"18px 20px 14px", display:"flex", flexDirection:"column" };
  const _cardEyebrow = { fontFamily:"var(--font-ui)", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.18em", marginBottom:14, textAlign:"center" };
  const _scenBtn = (active) => ({
    fontFamily:"var(--font-ui)", fontSize:11, fontWeight:500,
    padding:"8px 10px", borderRadius:6,
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--surface-2)",
    color: active ? "var(--accent)" : "var(--text)",
    cursor:"pointer", textAlign:"center", letterSpacing:"0.01em",
  });
  const _customBtn = (active) => ({
    fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600,
    padding:"10px 12px", borderRadius:6, marginTop:6, width:"100%",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--surface-2)",
    color: active ? "var(--accent)" : "var(--text)",
    cursor:"pointer", textAlign:"center", letterSpacing:"0.04em", textTransform:"uppercase",
  });
  const _tableCard = { background:"var(--surface)", border:"0.5px solid var(--border)", borderRadius:12, overflow:"hidden", marginBottom:20 };
  const _tableHead = { padding:"14px 18px 12px", borderBottom:"0.5px solid var(--border)" };
  const _tableTitle = { fontFamily:"var(--font-display)", fontSize:18, fontWeight:500, margin:0, letterSpacing:"-0.005em" };
  const _tableSub = { fontSize:12, color:"var(--text-muted)", marginTop:4 };
  const _th = { fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", textAlign:"left", padding:"10px 14px", borderBottom:"0.5px solid var(--border)", whiteSpace:"normal", lineHeight:1.25 };
  const _td = { fontSize:13, color:"var(--text)", padding:"10px 14px", borderBottom:"0.5px solid var(--border-faint, var(--border))" };
  const _tdNum = { ...{ fontSize:13, padding:"10px 14px", borderBottom:"0.5px solid var(--border-faint, var(--border))" }, fontFamily:"var(--font-mono)", textAlign:"right" };

  // Anchor to the same 11 GICS + 4 defensive that the Asset Tilt page uses
  // (Joe directive 2026-05-08: drop synthetic INTL / BTC / SPX / HY / CSH).
  // IGs come from v10.industry_groups (the same dataset Asset Tilt uses) so we
  // get the calibrated proxy ETFs (e.g. SOXX for Semis). IG-level stress is
  // intentionally left as null in v1 — Joe correction 2026-05-08: the
  // "all IGs inherit parent sector stress" approximation was wrong; proper
  // IG-level factor calibration is Phase 2.
  const GICS_IDS = ["XLK","XLC","XLF","XLY","XLI","XLB","XLE","XLV","XLP","XLU","XLRE"];
  const DEFENSIVE_IDS = ["BIL","TLT","GLD","LQD"];
  // Map Scenarios sector name → Asset Tilt sector name (already declared above as SCEN_TO_AT_SECTOR)
  const _v10IGsBySector = (() => {
    const m = {};
    if (!v10 || !Array.isArray(v10.industry_groups)) return m;
    v10.industry_groups.forEach(ig => {
      if (!m[ig.sector]) m[ig.sector] = [];
      m[ig.sector].push({ id: ig.id, name: ig.name, proxy: (ig.tickers || [])[0] || "—", pct: null });
    });
    return m;
  })();
  const _equityParents = SECTORS.filter(s => GICS_IDS.includes(s.id)).map(s => {
    const atName = SCEN_TO_AT_SECTOR[s.name] || s.name;
    return {
      id: s.id, name: s.name, ticker: s.id, pct: sectorPcts[s.id] || 0,
      igs: _v10IGsBySector[atName] || []
    };
  });
  const _defensiveRows = SECTORS.filter(s => DEFENSIVE_IDS.includes(s.id)).map(s => ({
    id: s.id, name: s.name, ticker: s.id, pct: sectorPcts[s.id] || 0
  }));

  const _stressColor = (pct) => pct > 0 ? "var(--green)" : (pct < 0 ? "var(--red, #b8332a)" : "var(--text-muted)");
  const _fmtPct = (pct) => (pct === 0 || !hasShock ? "—" : (pct > 0 ? "+" : "") + pct.toFixed(1) + "%");
  const _fmtDollar = (v) => v === 0 ? "$0" : (v < 0 ? "−$" : "+$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <main className="scenarios-page" style={{ maxWidth: 1216, margin: "0 auto", padding: "24px 32px 48px" }}>
        {/* HERO — eyebrow + h1 + subtitle on left, Scenario Selection card on right.
            Matches MO/AT/TO hero spec (PR #483). */}
        <section style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:36, alignItems:"start", marginBottom:32 }}>
          <div style={{ minWidth:0 }}>
            <div style={_eyebrow}>Scenario Analysis</div>
            <h1 style={_h1}>
              How your book reacts under a <em style={_emItalic}>custom shock</em> or a <em style={_emItalic}>historical scenario</em>.
            </h1>
          </div>
          <aside style={_rightCard}>
            <div style={_cardEyebrow}>Scenario Selection</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {Object.entries(SCENARIO_SHORT).map(([id, short]) => (
                <button key={id} onClick={() => { onModeChange("canned"); onScenarioClick(id); }} style={_scenBtn(mode==="canned" && scenario===id)}>
                  {short}
                </button>
              ))}
            </div>
            <button onClick={() => onModeChange("bespoke")} style={_customBtn(mode==="bespoke")}>
              Custom Multi-Factor Shock
            </button>
          </aside>
        </section>

        {/* If user picked Custom, render the existing builder above the tables.
            Builder UI preserved verbatim from prior implementation — calibrated factor sliders. */}
        {mode === "bespoke" && (
          <div className="builder" style={{ marginBottom:20 }}>
            <div className="builder-row" style={{marginBottom:"var(--s-2)"}}>
              <div className="builder-label">Propagation</div>
              <div className="prop-toggle">
                <button className={prop === "realistic" ? "active" : ""} onClick={onPropToggle}>Realistic (correlated)</button>
                <button className={prop === "bespoke" ? "active" : ""} onClick={onPropToggle}>Custom (independent)</button>
              </div>
              <div style={{marginLeft:"auto", display:"flex", gap:"var(--s-3)", alignItems:"center"}}>
                <button className="reset-btn" onClick={onReset}>Reset</button>
                <div className="builder-label">Horizon</div>
                <div className="horizon-tabs">
                  {["1mo","3mo","6mo"].map(h => (
                    <button key={h} className={horizon === h ? "active" : ""} onClick={() => setHorizon(h)}>{h}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="sliders">
              {FACTOR_IDS.map(fid => {
                // FACTORS is an ARRAY of {id,name,min,max,step} — not a lookup
                // map — so FACTORS[fid] returns undefined for a string fid.
                // Use .find() to locate the factor entry, and read .name (the
                // actual field) rather than the non-existent .label.
                const f = FACTORS.find(x => x.id === fid);
                if (!f) return null;
                const v = effShocks[fid];
                const isDriver = driver === fid;
                const nominal = fmtNominal(fid, v);
                const clampedV = Math.max(-5, Math.min(5, v));
                return (
                  <div key={fid} className={"slider-row" + (isDriver ? " driver" : "")}>
                    <div className="slider-label">{f.name}</div>
                    <input type="range" min="-5" max="5" step="0.1" value={clampedV} onChange={(e) => onSliderChange(fid, parseFloat(e.target.value))} />
                    <div className="slider-val">
                      <span className="sigma">{v >= 0 ? "+" : ""}{v.toFixed(1)}σ</span>
                      {nominal ? <span className="nominal">{nominal}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="disclosure">{prop === "realistic" ? "Realistic mode: drag any one slider to set it as the driver. The other 11 factors auto-propagate based on historical correlations." : "Custom mode: every slider is independent — drag any one and only that factor moves. Sliders start at today's live reading; the coherence indicator below flags combinations that haven't shown up together historically."}</div>
          </div>
        )}

        {/* CONTROLS STRIP — Horizon toggle (always visible) + Reset (when shock active).
            Horizon controls how far forward the stress is projected: 1mo (mult 0.5),
            3mo (mult 1.0, default), 6mo (mult 1.55). The same multipliers existed
            before the layout rewrite; just exposing the UI now. */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", letterSpacing:"0.10em", textTransform:"uppercase" }}>Horizon</span>
            <div style={{ display:"inline-flex", border:"1px solid var(--border)", borderRadius:6, overflow:"hidden" }}>
              {[
                { id:"1mo", label:"1M" },
                { id:"3mo", label:"3M" },
                { id:"6mo", label:"6M" },
              ].map((h, i) => (
                <button key={h.id} onClick={() => setHorizon(h.id)} style={{
                  fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600,
                  padding:"6px 14px",
                  background: horizon===h.id ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--surface)",
                  color: horizon===h.id ? "var(--accent)" : "var(--text-2)",
                  border:"none", borderLeft: i>0 ? "1px solid var(--border)" : "none",
                  cursor:"pointer", letterSpacing:"0.04em",
                }}>{h.label}</button>
              ))}
            </div>
          </div>
          {(scenario || hasShock) && (
            <button onClick={() => { onModeChange("canned"); setScenario(null); onReset(); }} style={{ fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, padding:"6px 12px", borderRadius:6, border:"1px solid var(--border)", background:"var(--surface-2, var(--surface))", color:"var(--text-2)", cursor:"pointer", letterSpacing:"0.04em", textTransform:"uppercase" }}>
              ↺ Reset all shocks
            </button>
          )}
        </div>

        {/* TWO-COLUMN GRID — Joe mockup 2026-05-08:
            LEFT (~0.95fr): Asset Tilt Engine Scenario Results.
            RIGHT (~1.05fr): Cycle Mechanism Scenario Results + Your Portfolio. */}
        <div style={{ display:"grid", gridTemplateColumns:"0.95fr 1.05fr", gap:20, alignItems:"start" }}>

          {/* LEFT COLUMN — TABLE 1: Asset Tilt Engine Scenario Results */}
          <Table1AssetTilt
            hasShock={hasShock}
            igPcts={igPcts}
            igLoadings={igLoadings}
            equityParents={_equityParents}
            defensiveRows={_defensiveRows}
            expandedSectors={expandedSectors}
            toggleSectorExpanded={toggleSectorExpanded}
            openSectorByName={openSectorByName}
            openIGByName={openIGByName}
            onOpenTicker={onOpenTicker}
            stressColor={_stressColor}
            fmtPct={_fmtPct}
            tableCard={_tableCard}
            tableHead={_tableHead}
            tableTitle={_tableTitle}
            tableSub={_tableSub}
            scenToAt={SCEN_TO_AT_SECTOR}
          />

          {/* RIGHT COLUMN — TABLE 2 (placeholder) + TABLE 3 (Your Portfolio) stacked */}
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

            {/* TABLE 2 — Cycle Mechanism Scenario Results (Phase 2E live) */}
            <CycleMechanismScenarioResultsTable
              mode={mode}
              scenarioName={scenario && SCENARIOS[scenario] ? SCENARIOS[scenario].name : null}
              effShocks={effShocks}
              indicatorHistory={indicatorHistory}
              tableCard={_tableCard}
              tableHead={_tableHead}
              tableTitle={_tableTitle}
              tableSub={_tableSub}
            />

            {/* TABLE 3 — Your Portfolio under stress */}
            <Table3Portfolio
              positions={realPnl.positions || []}
              total={realPnl.total || 0}
              hasShock={hasShock}
              portfolioSource={portfolioSource}
              onOpenTicker={onOpenTicker}
              stressColor={_stressColor}
              fmtDollar={_fmtDollar}
              tableCard={_tableCard}
              tableHead={_tableHead}
              tableTitle={_tableTitle}
              tableSub={_tableSub}
            />

          </div>
        </div>
      </main>
      {sectorModal && v10 && <SectorModal sector={sectorModal} igs={v10.industry_groups} onClose={() => setSectorModal(null)} onIGClick={(ig) => { setSectorModal(null); setIgModal(ig); }} onEtfClick={(e) => onOpenTicker && onOpenTicker(e.t || e)} />}
      {igModal && v10 && <IGModal ig={igModal} sectorIGs={v10.industry_groups.filter(x => x.sector === igModal.sector)} parentSector={v10.sectors.find(x => x.sector === igModal.sector)} onClose={() => setIgModal(null)} onEtfClick={(e) => onOpenTicker && onOpenTicker(e.t || e)} onBackToSector={(sector) => { setIgModal(null); setSectorModal(sector); }} onTickerClick={(t) => onOpenTicker && onOpenTicker(t)} />}
    </>
  );
}


// ────────────────────────────────────────────────────────────────────────
// CycleMechanismScenarioResultsTable — v2 stress (rebuilt 2026-05-10).
// Renders 3 v2 headlines (Cycle & Value / Market Stress / Real Economy)
// plus 7 sub-composites — each as current → stressed → Δ. Stress is
// computed live in the browser via computeV2Stress() from the effShocks
// vector. Works for canned scenarios AND Custom mode (the v11 6-mechanism
// table previously here only worked for canned). State-based scoring; see
// engine block above for the math + state-vs-forecast rationale.
// ────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════
// V2 STRESS ENGINE — Joe directive 2026-05-10
// ════════════════════════════════════════════════════════════════════════
// Computes v2 sub-composite + headline stress from a 12-factor shock vector.
// Works for canned scenarios AND Custom mode. Replaces v11 6-mechanism table.
//
// Math chain: shock σ → stressed nominal value (FACTOR_BASELINES.mean +
// σ × std) → percentile-rank against indicator's historical points → direction-
// correct (0..100 cautionary) → average across all indicators in the sub-
// composite → average sub-composites per headline.
//
// State-based (no IC sign-flip, no IC gate): the gate + sign-flip are
// forecast-quality filters used by Macro Overview's horizon-aware v2 reads.
// For a stress tile users expect concerning indicators to push concerning
// scores UP. State-vs-forecast split captured in PR body + LESSONS.
// ────────────────────────────────────────────────────────────────────────

const SHOCK_FACTOR_TO_V2 = {
  vix:          "vix",
  move:         "move",
  hy:           "hy_oas",
  stlfsi:       "stlfsi",
  anfci:        "anfci",
  term_premium: "term_premium",
};

const V2_THRESHOLDS = {
  ism_mfg:     { max_stress: 40,   neutral: 50,  peak_strength: 60,  direction: "low_is_concerning" },
  ism_svc:     { max_stress: 40,   neutral: 50,  peak_strength: 60,  direction: "low_is_concerning" },
  gdpnow:      { max_stress: -3.0, neutral: 1.5, peak_strength: 5.0, direction: "low_is_concerning" },
  jobless:     { max_stress: 350,  neutral: 230, peak_strength: 180, direction: "high_is_concerning" },
  jolts_quits: { max_stress: 1.5,  neutral: 2.5, peak_strength: 3.5, direction: "low_is_concerning" },
  cfnai_3ma:   { max_stress: -1.0, neutral: 0.0, peak_strength: 1.0, direction: "low_is_concerning" },
  copper_gold: { max_stress: -20,  neutral: 0,   peak_strength: 20,  direction: "low_is_concerning" },
};

const V2_HEADLINES_DEF = {
  cycle_value:   { label: "Cycle & Value",  tagline: "The Setup",  subcomposites: ["Equities", "Rates", "MoneyBanking"] },
  market_stress: { label: "Market Stress",  tagline: "The Panic",  subcomposites: ["Credit", "Funding", "PositioningVol"] },
  real_economy:  { label: "Real Economy",   tagline: "The Truth",  subcomposites: ["RealEconomy"] },
};

const V2_REGIME_DEFS = [
  { s_lo: 60, s_hi: 100, st_lo:  0, st_hi: 40, label: "Late-cycle setup",       action: "Pull a little risk off — strategic trim, raise quality" },
  { s_lo: 60, s_hi: 100, st_lo: 60, st_hi: 100, label: "Late-cycle correction", action: "Pull a lot of risk off — hedges on" },
  { s_lo:  0, s_hi:  40, st_lo: 60, st_hi: 100, label: "Capitulation / panic",  action: "Capitulation buy — mean-reversion plays out" },
  { s_lo:  0, s_hi:  40, st_lo:  0, st_hi:  40, label: "Early expansion",       action: "Risk-on / leverage in line with risk tolerance" },
];

function classifyV2Regime(setup, stress) {
  if (setup === null || stress === null || setup === undefined || stress === undefined) {
    return { label: "Mixed regime", action: "Neutral — wait for confirmation" };
  }
  for (const r of V2_REGIME_DEFS) {
    if (r.s_lo <= setup && setup <= r.s_hi && r.st_lo <= stress && stress <= r.st_hi) {
      return { label: r.label, action: r.action };
    }
  }
  return { label: "Mixed regime", action: "Neutral — wait for confirmation" };
}

function v2PercentileScore(value, sample, direction) {
  if (!sample.length) return 50;
  let below = 0;
  for (const v of sample) if (v < value) below++;
  const pct = below / sample.length * 100;
  return direction === "low_is_concerning" ? 100 - pct : pct;
}

function v2ThresholdScore(value, anchors, direction) {
  const ms = anchors.max_stress, n = anchors.neutral, p = anchors.peak_strength;
  if (direction === "low_is_concerning") {
    if (value <= ms) return 100;
    if (value >= p) return 0;
    if (value <= n) return 100 - ((value - ms) / (n - ms)) * 50;
    return 50 - ((value - n) / (p - n)) * 50;
  }
  if (value >= ms) return 100;
  if (value <= p) return 0;
  if (value >= n) return 50 + ((value - n) / (ms - n)) * 50;
  return ((value - p) / (n - p)) * 50;
}

function computeV2Stress(shocks, cycleV2, indicatorHistory) {
  if (!cycleV2 || !cycleV2.indicators) return null;
  const indicatorById = Object.fromEntries(cycleV2.indicators.map(ind => [ind.id, ind]));
  const indicatorsBySub = {};
  for (const ind of cycleV2.indicators) {
    (indicatorsBySub[ind.sub_composite] = indicatorsBySub[ind.sub_composite] || []).push(ind);
  }
  const stressedScores = {};
  for (const ind of cycleV2.indicators) stressedScores[ind.id] = ind.current_score;

  for (const [factorId, indId] of Object.entries(SHOCK_FACTOR_TO_V2)) {
    const sigma = shocks && shocks[factorId];
    if (sigma === undefined || sigma === null) continue;
    const baseline = FACTOR_BASELINES[factorId];
    const ind = indicatorById[indId];
    if (!baseline || !ind) continue;
    const stressedValue = baseline.mean + sigma * baseline.std;

    if (ind.scoring === "threshold") {
      const anchors = V2_THRESHOLDS[indId];
      if (anchors) stressedScores[indId] = v2ThresholdScore(stressedValue, anchors, anchors.direction);
    } else {
      const histKey = ind.history_key;
      const hist = indicatorHistory && indicatorHistory[histKey];
      if (!hist || !hist.points) continue;
      const lookbackStart = ind.lookback_start ? new Date(ind.lookback_start) : new Date(0);
      const sample = [];
      for (const pt of hist.points) {
        const v = pt[1];
        if (v === null || v === undefined || typeof v !== "number") continue;
        if (new Date(pt[0]) < lookbackStart) continue;
        sample.push(v);
      }
      stressedScores[indId] = v2PercentileScore(stressedValue, sample, ind.direction);
    }
  }

  function avgInds(subId, useStressed) {
    const inds = indicatorsBySub[subId] || [];
    const vals = inds
      .map(i => useStressed ? stressedScores[i.id] : i.current_score)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const subcomposites = {};
  for (const subId of Object.keys(indicatorsBySub)) {
    subcomposites[subId] = { current: avgInds(subId, false), stressed: avgInds(subId, true) };
  }

  const headlines = {};
  for (const [hId, hDef] of Object.entries(V2_HEADLINES_DEF)) {
    const cs = hDef.subcomposites.map(s => subcomposites[s] && subcomposites[s].current).filter(x => x !== null && x !== undefined);
    const ss = hDef.subcomposites.map(s => subcomposites[s] && subcomposites[s].stressed).filter(x => x !== null && x !== undefined);
    headlines[hId] = {
      label: hDef.label, tagline: hDef.tagline, subcomposites: hDef.subcomposites,
      current: cs.length ? Math.round(cs.reduce((a, b) => a + b) / cs.length) : null,
      stressed: ss.length ? Math.round(ss.reduce((a, b) => a + b) / ss.length) : null,
    };
  }
  const regime = {
    current: classifyV2Regime(headlines.cycle_value.current, headlines.market_stress.current),
    stressed: classifyV2Regime(headlines.cycle_value.stressed, headlines.market_stress.stressed),
  };
  return { headlines, subcomposites, stressedScores, regime };
}

function CycleMechanismScenarioResultsTable({
  mode, scenarioName, effShocks, indicatorHistory,
  tableCard, tableHead, tableTitle, tableSub,
}) {
  const [cycleV2, setCycleV2] = useState(null);
  useEffect(() => {
    fetch("/cycle_v2.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("cycle_v2.json HTTP " + r.status)))
      .then(setCycleV2)
      .catch((err) => { console.warn("[Scenario Analysis · v2 stress] cycle_v2.json fetch failed", err); });
  }, []);

  // Show today's reads as soon as cycle_v2.json lands. indicator_history
  // is only needed to recompute scores under shock, so don't block the
  // default render on it - otherwise the tile looks dead on first load.
  const stress = useMemo(() => {
    if (!cycleV2) return null;
    return computeV2Stress(effShocks || {}, cycleV2, indicatorHistory);
  }, [cycleV2, indicatorHistory, effShocks]);

  if (!cycleV2) {
    return (
      <div style={tableCard}>
        <div style={tableHead}>
          <h2 style={tableTitle}>Cycle Mechanisms</h2>
          <div style={tableSub}>Loading...</div>
        </div>
      </div>
    );
  }
  if (!stress) {
    return (
      <div style={tableCard}>
        <div style={tableHead}>
          <h2 style={tableTitle}>Cycle Mechanisms</h2>
          <div style={tableSub}>Could not compute - check console.</div>
        </div>
      </div>
    );
  }

  const hasShock = effShocks && Object.values(effShocks).some(v => Math.abs(v) > 0.05);

  const subtitle = mode === "canned"
    ? (scenarioName
        ? `How each cycle mechanism reads under ${scenarioName} vs today.`
        : "Today's cycle reads. Pick a scenario above to see how each mechanism would shift.")
    : "Today's cycle reads. Drag any slider above to see live impact on each mechanism.";

  const renderDelta = (cur, str) => {
    if (cur === null || str === null || cur === undefined || str === undefined) {
      return <span style={{ color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>—</span>;
    }
    const c = Math.round(cur), s = Math.round(str);
    const d = s - c;
    if (d === 0) return <span style={{ color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums" }}>±0</span>;
    const tone = d > 0 ? "var(--neg, #b03030)" : "var(--pos, #2a7a4f)";
    const sign = d > 0 ? "+" : "−";
    return <span style={{ color: tone, fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums" }}>{sign}{Math.abs(d)}</span>;
  };

  const SUB_ORDER = ["Equities", "Rates", "MoneyBanking", "Credit", "Funding", "PositioningVol", "RealEconomy"];
  const SUB_LABELS = {
    Equities: "Equities", Rates: "Rates", MoneyBanking: "Money / Banking",
    Credit: "Credit", Funding: "Funding", PositioningVol: "Positioning / Vol",
    RealEconomy: "Real Economy",
  };

  const headlineCard = { border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", padding: "12px 14px", background: "var(--surface-2, var(--surface))", flex: "1 1 0", minWidth: 0 };
  const headlineLabel = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 };
  const headlineNum = { fontFamily: "var(--font-display, var(--font-ui))", fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums" };
  const headlineNumDim = { ...headlineNum, color: "var(--text-muted)" };

  return (
    <div style={tableCard}>
      <div style={tableHead}>
        <h2 style={tableTitle}>Cycle Mechanisms</h2>
        <div style={tableSub}>{subtitle}</div>
      </div>

      <div style={{ padding: "14px 18px", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Object.entries(stress.headlines).map(([hId, h]) => (
          <div key={hId} style={headlineCard}>
            <div style={headlineLabel}>{h.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-ui)", marginBottom: 2 }}>today</div>
                <div style={hasShock ? headlineNumDim : headlineNum}>{h.current ?? "—"}</div>
              </div>
              {hasShock && (
                <>
                  <div style={{ color: "var(--text-muted)", fontSize: 16 }}>→</div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-ui)", marginBottom: 2 }}>stressed</div>
                    <div style={headlineNum}>{h.stressed ?? "—"}</div>
                  </div>
                  <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>{renderDelta(h.current, h.stressed)}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "0 18px 14px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Regime
        </div>
        <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 17, fontWeight: 500 }}>
          {hasShock ? `${stress.regime.current.label} → ${stress.regime.stressed.label}` : stress.regime.current.label}
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {hasShock ? stress.regime.stressed.action : stress.regime.current.action}
        </div>
      </div>

      <div style={{ padding: "0 18px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr 0.5fr", gap: 6, paddingBottom: 6, borderBottom: "0.5px solid var(--border)", fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <div>Mechanism</div>
            <div style={{ textAlign: "right" }}>Today</div>
            <div style={{ textAlign: "right" }}>{hasShock ? "Stressed" : ""}</div>
            <div style={{ textAlign: "right" }}>{hasShock ? "Δ" : ""}</div>
        </div>
        {SUB_ORDER.map(subId => {
          const s = stress.subcomposites[subId];
          if (!s) return null;
          const curRound = s.current === null ? null : Math.round(s.current);
          const strRound = s.stressed === null ? null : Math.round(s.stressed);
          return (
            <div key={subId} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr 0.5fr", gap: 6, padding: "6px 0", borderBottom: "0.5px solid var(--border)", fontFamily: "var(--font-ui)", fontSize: 12, alignItems: "center" }}>
                <div style={{ color: "var(--ink-0)" }}>{SUB_LABELS[subId] || subId}</div>
                <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: hasShock ? "var(--text-muted)" : "var(--ink-0)" }}>{curRound ?? "—"}</div>
                <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink-0)" }}>{hasShock ? (strRound ?? "—") : ""}</div>
                <div style={{ textAlign: "right" }}>{hasShock ? renderDelta(s.current, s.stressed) : null}</div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "8px 18px 14px", fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
        Higher score = more cautionary. {cycleV2.as_of ? "Refreshed " + cycleV2.as_of + "." : ""}
      </div>
    </div>
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
      takeaway = "When the factors you've shocked haven't moved together historically, the model can't anchor the read to a real regime. Use this for exploration; the recommended re-allocation in L4 isn't meant to be acted on.";
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


// ════════════════════════════════════════════════════════════════════════
// Phase 1 sub-components (Joe mockup 2026-05-08 v2)
// ════════════════════════════════════════════════════════════════════════

// Table 1 — sortable, sectors collapsible (default collapsed), IGs use v10 proxy ETFs.
// IG-level stress shows "—" with note (Phase 2 calibration).
function Table1AssetTilt({ igPcts, igLoadings, equityParents, defensiveRows, expandedSectors, toggleSectorExpanded, openSectorByName, openIGByName, onOpenTicker, stressColor, fmtPct, tableCard, tableHead, tableTitle, tableSub, scenToAt, hasShock }) {
  // Phase 2G — look up per-IG stress %. v10's industry_groups list keys IGs by
  // a flat id ("semis", "software", …); ig_factor_loadings.json uses the same
  // id keys. ScenarioAnalysis's IG rows here only carry name + proxy, so we
  // resolve via name → ig_id by walking igLoadings.
  const igIdByName = useMemo(() => {
    const m = {};
    if (igLoadings && Array.isArray(igLoadings.industry_groups)) {
      igLoadings.industry_groups.forEach((ig) => { if (ig.name) m[ig.name] = ig.id; });
    }
    return m;
  }, [igLoadings]);
  const igStressFor = (igName) => {
    const id = igIdByName[igName];
    if (!id || !igPcts) return null;
    const v = igPcts[id];
    return (v === undefined || v === null) ? null : v;
  };
  const cols = [
    { id:"name",   label:"Sector / Industry Group", align:"left",  sortValue: r => r.name },
    { id:"ticker", label:"Proxy",                   align:"left",  sortValue: r => r.ticker || "" },
    { id:"pct",    label:"Stress",                  align:"right", sortValue: r => r.pct ?? null },
  ];
  const eq = useSortableTable({ rows: equityParents, columns: cols, defaultColId: "pct", defaultDir: "asc" });
  const df = useSortableTable({ rows: defensiveRows, columns: cols, defaultColId: "pct", defaultDir: "desc" });

  const _th = { fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", padding:"10px 14px", borderBottom:"0.5px solid var(--border)", whiteSpace:"normal", lineHeight:1.25, cursor:"pointer", userSelect:"none" };
  const _td = { fontSize:13, color:"var(--text)", padding:"10px 14px", borderBottom:"0.5px solid var(--border-faint, var(--border))" };
  const _tdNum = { fontSize:13, padding:"10px 14px", borderBottom:"0.5px solid var(--border-faint, var(--border))", fontFamily:"var(--font-mono)", textAlign:"right" };

  const Header = () => (
    <>
      <div style={{..._th, textAlign:"left"}} onClick={() => eq.toggleSort("name")}>Sector / Industry Group <SortArrow dir={eq.sortCol==="name"?eq.sortDir:null}/></div>
      <div style={{..._th, textAlign:"left"}} onClick={() => eq.toggleSort("ticker")}>Proxy <SortArrow dir={eq.sortCol==="ticker"?eq.sortDir:null}/></div>
      {hasShock && <div style={{..._th, textAlign:"right"}} onClick={() => eq.toggleSort("pct")}>Stress <SortArrow dir={eq.sortCol==="pct"?eq.sortDir:null}/></div>}
    </>
  );

  return (
    <div style={tableCard}>
      <div style={tableHead}>
        <h2 style={tableTitle}>Asset Tilt Engine</h2>
        <div style={tableSub}>{hasShock ? "How each equity sector, industry group, and defensive asset class is impacted by the selected scenario. Click a sector row to expand its industry groups." : "Pick a scenario above (or run a custom shock) to see how each sector and industry group would move."}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns: hasShock ? "1fr 70px 90px" : "1fr 70px" }}>
        <Header/>
        <div style={{ ..._td, gridColumn:"1 / -1", fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", background:"var(--surface-2, var(--surface))", padding:"8px 14px" }}>Equity Sectors</div>
        {eq.sorted.map(s => {
          const isExpanded = expandedSectors.has(s.id);
          const chev = isExpanded ? "▾" : "▸";
          return (
            <React.Fragment key={s.id}>
              <div style={{..._td, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6}} onClick={() => toggleSectorExpanded(s.id)}>
                <span style={{ fontSize:10, color:"var(--text-muted)", width:12, display:"inline-block" }}>{chev}</span>
                <span onClick={(e) => { e.stopPropagation(); if (scenToAt[s.name]) openSectorByName(s.name); }} style={{textDecoration: scenToAt[s.name] ? "underline" : "none", textDecorationColor:"rgba(128,128,128,0.35)", textUnderlineOffset:3}}>{s.name}</span>
              </div>
              <div style={_td}>{s.ticker}</div>
              {hasShock && <div style={{..._tdNum, color: stressColor(s.pct), fontWeight:600}}>{fmtPct(s.pct)}</div>}
              {isExpanded && s.igs.map((ig, ix) => {
                const igPct = igStressFor(ig.name);
                return (
                  <React.Fragment key={s.id + "-" + ix}>
                    <div style={{..._td, paddingLeft:42, color:"var(--text-2)", fontSize:12, cursor:"pointer"}} onClick={() => openIGByName && openIGByName(ig.name, s.name)}>↳ {ig.name}</div>
                    <div style={{..._td, fontSize:12, color:"var(--text-muted)"}}>{ig.proxy}</div>
                    {hasShock && (igPct === null
                      ? <div style={{..._tdNum, fontSize:12, color:"var(--text-muted)"}} title="No factor loadings available for this IG">—</div>
                      : <div style={{..._tdNum, fontSize:12, color: stressColor(igPct), fontWeight:600}}>{fmtPct(igPct)}</div>
                    )}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}
        <div style={{ ..._td, gridColumn:"1 / -1", fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", background:"var(--surface-2, var(--surface))", padding:"8px 14px" }}>Defensive Sleeve</div>
        {df.sorted.map(r => (
          <React.Fragment key={r.ticker}>
            <div style={{..._td, fontWeight:600, cursor: onOpenTicker ? "pointer" : "default"}} onClick={() => onOpenTicker && onOpenTicker(r.ticker)}>{r.name}</div>
            <div style={_td}>{r.ticker}</div>
            {hasShock && <div style={{..._tdNum, color: stressColor(r.pct), fontWeight:600}}>{fmtPct(r.pct)}</div>}
          </React.Fragment>
        ))}
      </div>
      <div style={{ padding:"10px 14px", fontFamily:"var(--font-ui)", fontSize:11, color:"var(--text-muted)", fontStyle:"italic", borderTop:"0.5px solid var(--border)" }}>
        IG stress = parent-sector factor loadings × IG-specific beta vs SPY, horizon-scaled (Phase 2F v1 inheritance, directional regime test 83% pass).
      </div>
    </div>
  );
}

// Table 3 — sortable Your Portfolio table with proper column widths so P&L doesn't wrap.
function Table3Portfolio({ positions, total, hasShock, portfolioSource, onOpenTicker, stressColor, fmtDollar, tableCard, tableHead, tableTitle, tableSub }) {
  const rows = positions.map(p => ({
    ticker: p.ticker, sector: p.sector, value: p.value || 0, dollar: p.dollar || 0, pct: p.pct || 0,
    stressed: (p.value || 0) + (p.dollar || 0)
  }));
  const cols = [
    { id:"ticker",   label:"Ticker",   align:"left",  sortValue: r => r.ticker },
    { id:"sector",   label:"Sector",   align:"left",  sortValue: r => r.sector },
    { id:"value",    label:"Curr.",    align:"right", sortValue: r => r.value },
    { id:"stressed", label:"Stressed", align:"right", sortValue: r => r.stressed },
    { id:"dollar",   label:"P&L $",    align:"right", sortValue: r => r.dollar },
    { id:"pct",      label:"P&L %",    align:"right", sortValue: r => r.pct },
  ];
  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable({ rows, columns: cols, defaultColId: "value", defaultDir: "desc" });
  const totalCurr = rows.reduce((s,r) => s + r.value, 0);
  const totalStressed = rows.reduce((s,r) => s + r.stressed, 0);
  const totalPctNum = totalCurr > 0 ? (total / totalCurr) * 100 : 0;
  const totK = (totalCurr/1000).toFixed(0);
  const _th = { fontFamily:"var(--font-ui)", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", padding:"10px 12px", borderBottom:"0.5px solid var(--border)", whiteSpace:"nowrap", cursor:"pointer", userSelect:"none" };
  const _td = { fontSize:12, color:"var(--text)", padding:"10px 12px", borderBottom:"0.5px solid var(--border-faint, var(--border))", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 };
  const _tdNum = { fontSize:12, padding:"10px 12px", borderBottom:"0.5px solid var(--border-faint, var(--border))", fontFamily:"var(--font-mono)", textAlign:"right", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 };
  // Wider P&L $ column so "−$11,092" fits without wrap.
  return (
    <div style={tableCard}>
      <div style={tableHead}>
        <h2 style={tableTitle}>Your Portfolio</h2>
        <div style={tableSub}>{!hasShock ? (portfolioSource === "demo" ? `Illustrative $${totK}K book. Pick a scenario or run a custom shock to see position-level P&L.` : "Your real positions across all accounts. Pick a scenario or run a custom shock to see position-level P&L.") : (portfolioSource === "demo" ? `Illustrative $${totK}K book — sign in to apply the scenario to your real positions.` : "Your real positions across all accounts.")}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns: hasShock ? "minmax(60px, 110px) minmax(90px, 200px) minmax(78px, 120px) minmax(78px, 120px) minmax(78px, 120px) minmax(60px, 80px)" : "minmax(60px, 110px) minmax(90px, 220px) minmax(78px, 140px)" }}>
        <div style={{..._th, textAlign:"left"}} onClick={() => toggleSort("ticker")}>Ticker <SortArrow dir={sortCol==="ticker"?sortDir:null}/></div>
        <div style={{..._th, textAlign:"left"}} onClick={() => toggleSort("sector")}>Sector <SortArrow dir={sortCol==="sector"?sortDir:null}/></div>
        <div style={{..._th, textAlign:"right"}} onClick={() => toggleSort("value")}>Curr. <SortArrow dir={sortCol==="value"?sortDir:null}/></div>
        {hasShock && <div style={{..._th, textAlign:"right"}} onClick={() => toggleSort("stressed")}>Stressed <SortArrow dir={sortCol==="stressed"?sortDir:null}/></div>}
        {hasShock && <div style={{..._th, textAlign:"right"}} onClick={() => toggleSort("dollar")}>P&amp;L $ <SortArrow dir={sortCol==="dollar"?sortDir:null}/></div>}
        {hasShock && <div style={{..._th, textAlign:"right"}} onClick={() => toggleSort("pct")}>P&amp;L % <SortArrow dir={sortCol==="pct"?sortDir:null}/></div>}
        {sorted.map((pos, i) => {
          const pctText = (pos.pct === 0 || !hasShock) ? "—" : (pos.pct > 0 ? "+" : "") + pos.pct.toFixed(1) + "%";
          return (
            <React.Fragment key={i}>
              <div style={{..._td, fontWeight:600, cursor: onOpenTicker ? "pointer" : "default"}} title={pos.ticker} onClick={() => onOpenTicker && onOpenTicker(pos.ticker)}>{pos.ticker}</div>
              <div style={{..._td, color:"var(--text-muted)"}} title={pos.sector}>{pos.sector}</div>
              <div style={_tdNum}>${pos.value.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
              {hasShock && <div style={_tdNum}>${pos.stressed.toLocaleString(undefined, {maximumFractionDigits:0})}</div>}
              {hasShock && <div style={{..._tdNum, color: stressColor(pos.dollar), fontWeight:600}}>{fmtDollar(pos.dollar)}</div>}
              {hasShock && <div style={{..._tdNum, color: stressColor(pos.pct), fontWeight:600}}>{pctText}</div>}
            </React.Fragment>
          );
        })}
        <div style={{..._td, fontWeight:700, borderTop:"1px solid var(--border)"}}>Total</div>
        <div style={{..._td, borderTop:"1px solid var(--border)"}}></div>
        <div style={{..._tdNum, fontWeight:700, borderTop:"1px solid var(--border)"}}>${totalCurr.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
        {hasShock && <div style={{..._tdNum, fontWeight:700, borderTop:"1px solid var(--border)"}}>${totalStressed.toLocaleString(undefined,{maximumFractionDigits:0})}</div>}
        {hasShock && <div style={{..._tdNum, fontWeight:700, color: stressColor(total), borderTop:"1px solid var(--border)"}}>{fmtDollar(total)}</div>}
        {hasShock && <div style={{..._tdNum, fontWeight:700, color: stressColor(total), borderTop:"1px solid var(--border)"}}>{totalPctNum.toFixed(1)+"%"}</div>}
      </div>
    </div>
  );
}
