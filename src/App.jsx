import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import Scanner from "./Scanner";
import {
  useTheme, Hero, Tile, SectionHeader, Footer,
  Sidebar, SidebarToggleButton,
  NavIconHome, NavIconGauge, NavIconGrid, NavIconHeat,
  NavIconPie, NavIconList, NavIconRadar, NavIconBook,
} from "./Shell";
import { InfoTip, Tip } from "./InfoTip";
import SidebarAuth from "./auth/SidebarAuth";
import LoginScreen from "./auth/LoginScreen";
import OnboardingPanel from "./auth/OnboardingPanel";
import { useSession } from "./auth/useSession";
import { useIsAdmin } from "./hooks/useIsAdmin";
import AdminUsage from "./AdminUsage";
import AdminBugs from "./AdminBugs";
import { useUserPortfolio } from "./hooks/useUserPortfolio";
import { usePrivateScanSupplement } from "./hooks/usePrivateScanSupplement";
import { useUniverseSnapshot } from "./hooks/useUniverseSnapshot";
import { useTickerEvents } from "./hooks/useTickerEvents";
import { useCommentary } from "./hooks/useCommentary";
import { computeSectionComposites, colorForDirection, SECTION_ORDER } from "./ticker/sectionComposites";
import SubCompositeStrip from "./components/SubCompositeStrip";
import WatchlistTable from "./components/WatchlistTable";
import PositionsTable from "./components/PositionsTable";
import PositionEditor from "./components/PositionEditor";
import BulkImport from "./components/BulkImport";
import UniverseFreshness from "./components/UniverseFreshness";
import FreshnessDot from "./components/FreshnessDot";
import MethodologyPage from "./pages/MethodologyPage";
import TodayMacro from "./pages/TodayMacro";
import { useSortableTable as useSortableTable_v1, SortArrow as SortArrow_v1, sortableHeaderProps as sortableHeaderProps_v1 } from "./hooks/useSortableTable.jsx";
import { supabase } from "./lib/supabase";
import { normalizeTickerName } from "./lib/nameFormat";
import ReportBug from "./reportbug/ReportBug";
import ErrorBoundary from "./ErrorBoundary";

// SD calibration — (mean, sd, direction) per indicator.
//
// Bug #2 (eq_cr_corr) and Bug #2b (vix, real_rates, sloos_ci) empirically
// re-grounded against FRED 2016-04 → 2026-04 (see docs/CALIBRATION_METHODOLOGY.md
// for full audit table + rationale per indicator, plus scripts/calibration_audit.py
// for the re-runnable pull).
const SD={
vix:{mean:18.5,sd:7.3,dir:"hw"},hy_ig:{mean:220,sd:95,dir:"hw"},
eq_cr_corr:{mean:0.38,sd:0.22,dir:"hw"},yield_curve:{mean:80,sd:95,dir:"nw"},
move:{mean:72,sd:28,dir:"hw"},anfci:{mean:0,sd:0.38,dir:"hw"},
stlfsi:{mean:0,sd:0.9,dir:"hw"},real_rates:{mean:0.7,sd:1.0,dir:"hw"},
sloos_ci:{mean:9,sd:22,dir:"hw"},cape:{mean:22,sd:7,dir:"hw"},
ism:{mean:52,sd:5.5,dir:"lw"},copper_gold:{mean:0.20,sd:0.03,dir:"lw"},
bkx_spx:{mean:0.13,sd:0.03,dir:"lw"},bank_unreal:{mean:5,sd:8,dir:"hw"},
credit_3y:{mean:7,sd:5,dir:"hw"},term_premium:{mean:40,sd:70,dir:"hw"},
cmdi:{mean:0.1,sd:0.35,dir:"hw"},loan_syn:{mean:6.2,sd:2.5,dir:"hw"},
usd:{mean:99,sd:7,dir:"hw"},cpff:{mean:10,sd:28,dir:"hw"},
skew:{mean:128,sd:12,dir:"hw"},sloos_cre:{mean:5,sd:20,dir:"hw"},
bank_credit:{mean:6.5,sd:3.2,dir:"lw"},jobless:{mean:340,sd:185,dir:"hw"},
jolts_quits:{mean:2.1,sd:0.42,dir:"lw"},
// New series 2026-04-24 — stub stats; overwritten from JSON at runtime.
m2_yoy:{mean:6,sd:4,dir:"hw"},
fed_bs:{mean:0,sd:8,dir:"lw"},
rrp:{mean:430,sd:700,dir:"hw"},
bank_reserves:{mean:3200,sd:600,dir:"lw"},
tga:{mean:500,sd:200,dir:"hw"},
breakeven_10y:{mean:2.2,sd:0.3,dir:"hw"},
cfnai:{mean:0,sd:0.3,dir:"lw"},
cfnai_3ma:{mean:0,sd:0.3,dir:"lw"},
hy_ig_etf:{mean:1.05,sd:0.05,dir:"hw"},
};

function sdScore(id,v){
const p=SD[id];if(!p||v==null)return null;
const r=(v-p.mean)/p.sd;
return(p.dir==="lw"||p.dir==="nw")?-r:r;
}

// ── 4-LEVEL COLOR SCALE: Green / Yellow / Amber / Red ──────────────────────
// sdColor returns bright Apple-system colors — good for fills, dots, bars.
function sdColor(s){
if(s==null)return"var(--text-dim)";
if(s<0.5) return"#30d158";   // Low — green
if(s<1.0) return"#B8860B";   // Normal — yellow
if(s<1.75)return"#ff9f0a";   // Elevated — amber
return              "#ff453a"; // Extreme — red
}
// sdTextColor returns the *-text variant — auto-darkens on light theme so small
// text remains readable on white. Use this anywhere the SD color is applied to
// type or thin glyphs. Keep sdColor() for fills/dots/swatches.
function sdTextColor(s){
if(s==null)return"var(--text-dim)";
if(s<0.5) return"var(--green-text)";
if(s<1.0) return"var(--yellow-text)";
if(s<1.75)return"var(--orange-text)";
return              "var(--red-text)";
}
function sdLabel(s){
if(s==null)return"No Data";
if(s<0.5) return"Low";
if(s<1.0) return"Normal";
if(s<1.75)return"Elevated";
return              "Extreme";
}
function sdTo100(s){return Math.round(Math.max(0,Math.min(100,((s+1)/4)*100)));}

// ── 4-LEVEL CONVICTION ─────────────────────────────────────────────────────
// Empirically calibrated against indicator_history.json (2006-01-03 → 2026-04,
// N≈6,313 trading days). See scripts/conviction-backtest.js for the run.
// Thresholds at p60 / p85 / p97.5 of the historical composite-SD distribution:
//   LOW     : SD < 0.12  (bottom 60% — quiet regimes)
//   NORMAL  : 0.12 ≤ SD < 0.41  (next 25% — mid-range)
//   ELEVATED: 0.41 ≤ SD < 1.03  (top ~12.5% excl. tail — 2022 bear 0.80, SVB 0.67, 2015-16 0.59)
//   EXTREME : SD ≥ 1.03  (top ~2.5% — GFC peak 2.27, COVID peak 2.02)
const CONVICTION=[
{level:1,label:"LOW",      range:[-99,0.12], color:"#30d158", eq:90,bd:5, ca:3, au:2,
 action:"Risk-on. Historically benign conditions. Consider adding cyclical beta."},
{level:2,label:"NORMAL",   range:[0.12,0.41],color:"#B8860B", eq:75,bd:15,ca:7, au:3,
 action:"Market baseline. Maintain diversified exposure. Trim highest-beta on spikes."},
{level:3,label:"ELEVATED", range:[0.41,1.03],color:"#ff9f0a", eq:55,bd:28,ca:12,au:5,
 action:"Active hedging warranted. Sell covered calls. Rotate defensive. Reduce leverage."},
{level:4,label:"EXTREME",  range:[1.03,99],  color:"#ff453a", eq:20,bd:30,ca:35,au:15,
 action:"Crisis regime. Maximum defensiveness. Harvest losses. Hold dry powder."},
];
function getConv(s){return CONVICTION.find(c=>s>=c.range[0]&&s<c.range[1])||CONVICTION[3];}
// Theme-aware text color for conviction. Raw conviction colors (used for bars,
// borders, KPI numbers) are bright by design; when those same colors are
// applied to small text on a light surface the yellow becomes illegible.
// This swaps the NORMAL yellow for the deeper amber --yellow-text token.
function convTextColor(conv){return conv.color==="#B8860B"?"var(--yellow-text)":conv.color;}
// Swap bright yellow (#B8860B) for a theme-aware variant that stays
// legible on light backgrounds. Used anywhere an indicator/KPI/trend
// color is rendered directly as text on a light surface.
function yText(col){return(col==="#B8860B"||col==="#B8860B")?"var(--yellow-text)":col;}

const AS_OF={
vix:"Apr 16 2026",hy_ig:"Apr 15 2026",eq_cr_corr:"Apr 17 2026",
yield_curve:"Apr 16 2026",move:"Apr 16 2026",anfci:"Apr 10 2026",
stlfsi:"Apr 10 2026",real_rates:"Apr 15 2026",sloos_ci:"Jan 01 2026",
cape:"Mar 2026",ism:"Mar 2026",copper_gold:"Apr 16 2026",
bkx_spx:"Apr 16 2026",bank_unreal:"Q4 2025",credit_3y:"Apr 2026",
term_premium:"Apr 10 2026",cmdi:"Apr 10 2026",loan_syn:"Apr 15 2026",
usd:"Apr 16 2026",cpff:"Apr 14 2026",skew:"Apr 16 2026",
sloos_cre:"Jan 01 2026",bank_credit:"Apr 01 2026",jobless:"Apr 11 2026",
jolts_quits:"Feb 01 2026",
// New series added 2026-04-24 — placeholders, AS_OF[id] is overwritten at runtime
// from indicator_history.json's per-series `as_of` field.
m2_yoy:"—",fed_bs:"—",rrp:"—",bank_reserves:"—",tga:"—",
breakeven_10y:"—",cfnai:"—",cfnai_3ma:"—",hy_ig_etf:"—",
};

// Bug #1034: parallel table of the RAW ISO date (YYYY-MM-DD) each indicator
// was last refreshed. Populated at runtime from indicator_history.json's
// per-series as_of field by _applyHistToGlobals (with a FUTURE-DATE CLAMP
// that refuses any as_of > today — prevents the credit_3y / "quarter-end
// phantom" class of bug from ever rendering a date that hasn't happened
// yet). Consumed by staleness() / StalePill() and by the explicit
// "Data as of <date>" line on every indicator modal.
const AS_OF_ISO={};

// Cadence → stale-threshold lookup in CALENDAR days. Monthly allows 40d
// because FRED monthly releases land ~4-6 weeks after month-end. Quarterly
// allows 100d for the same reason (SLOOS / JOLTS-style releases).
const STALE_LIMITS_DAYS={D:3, W:10, M:45, Q:120};

// Compute staleness for an indicator based on AS_OF_ISO[id] vs today.
// Returns {label,color,days,limit,ok}. Null if no raw ISO known.
function staleness(id){
  const iso=AS_OF_ISO[id];
  if(!iso)return null;
  const freq=IND_FREQ[id]||"D";
  const limit=STALE_LIMITS_DAYS[freq]||400;
  const d=new Date(iso+"T00:00:00Z");
  if(Number.isNaN(+d))return null;
  const today=new Date();
  // Normalize today to UTC midnight for a stable day-count.
  const todayUtc=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
  const days=Math.max(0,Math.round((todayUtc-d.getTime())/86400000));
  const ok=days<=limit;
  return {label:ok?"FRESH":"STALE", color:ok?"#30d158":"#ff9f0a", days, limit, ok, iso};
}

// Tiny pill used on indicator tiles / modals when the data is older than
// its expected cadence. Rendering nothing when the data is fresh keeps
// the tile visually quiet on normal days (Bug #1034 option B).
function StalePill({id,compact=false}){
  const st=staleness(id);
  if(!st||st.ok)return null;
  const freq=IND_FREQ[id]||"D";
  const cadLbl={D:"daily",W:"weekly",M:"monthly",Q:"quarterly"}[freq]||"data";
  return(
    <span title={`${cadLbl.toUpperCase()} indicator — last refresh ${st.iso} (${st.days}d ago, expected ≤${st.limit}d).`}
      style={{
        fontSize:compact?9:10,
        color:"#ff9f0a",
        background:"rgba(255,159,10,0.12)",
        border:"1px solid rgba(255,159,10,0.45)",
        borderRadius:3,
        padding:compact?"0 4px":"1px 5px",
        fontFamily:"var(--font-mono)",
        fontWeight:700,
        letterSpacing:"0.04em",
        marginLeft:6,
        cursor:"help",
        textTransform:"uppercase",
      }}>STALE {st.days}d</span>
  );
}


const IND={
vix:["VIX","Equity Volatility","equity",1,"index",1,17.9,23.9,17.2,19.5,15.0,false,
"CBOE Volatility Index — 30-day expected S&P 500 volatility, often called the 'fear gauge'. Derived model-free from a weighted strip of OTM SPX puts and calls via variance-swap replication. Source: FRED VIXCLS (CBOE, daily). MacroTilt Tier 1 equity factor; <15 complacent, 15–20 normal, 20–30 elevated, >30 crisis.",
"Modestly below the long-run average (~19.5) and down meaningfully from 23.9 a month ago. Stress is fading. Watch for a sustained break above 30 (stress threshold) or 40 (crisis level)."],
hy_ig:["HY–IG Spread","Credit Risk Premium","credit",1,"bps",0,205.0,268,245,280,220,false,
"High-yield minus investment-grade credit spread — extra yield investors demand for corporate credit risk. Computed as ICE BofA HY Effective Yield minus ICE BofA IG Effective Yield. Source: FRED BAMLH0A0HYM2EY − BAMLC0A0CMEY (ICE BofA, daily, FRED license). MacroTilt Tier 1 credit factor; <200bps benign, 200–400 watch, >400 significant stress, >500 historically recessionary.",
"Spreads have tightened ~55bps over the past month — markets not pricing significant default risk. Below 200bps = benign; above 400bps = significant stress."],
eq_cr_corr:["EQ–Credit Corr","Risk-Off Synchronization","equity",1,"corr",2,0.92,0.61,0.55,0.50,0.40,false,
"63-day rolling Pearson correlation between daily VIX returns and daily HY–IG spread changes. When both move together, equities and credit are trading as a single risk factor. Source: computed from FRED VIXCLS + BAMLH0A0HYM2 + BAMLC0A0CM. MacroTilt Tier 1 equity factor; >0.6 confirms a genuine risk-off regime, <0.4 signals isolated noise.",
"Sharp jump in correlation — equities and credit are now moving as a single risk factor. Values above 0.6 indicate a true risk-off regime; this is a warning sign."],
yield_curve:["10Y–2Y Slope","Yield Curve","rates",1,"bps",0,54.0,52,35,15,-20,false,
"Slope of the Treasury yield curve at the 2y–10y point. Computed as DGS10 − DGS2 (constant-maturity par yields). Source: FRED T10Y2Y (daily). MacroTilt Tier 1 rates factor; inversion (<0) historically precedes recessions by 6–18 months, though bear steepening (long-end selling off) can invert the signal.",
"Re-steepened after the deepest inversion since 1981 (-109bps in 2023). An improving signal, though bear steepening (long-end selling off) would be the wrong kind."],
move:["MOVE Index","Rates Volatility","rates",2,"index",0,66.0,98,95,90,85,false,
"ICE BofA MOVE Index — the Treasury-market VIX. Weighted 1-month ATM OTC swaption implied volatility across 2y/5y/10y/30y tenors (20/20/40/20 weights). Source: ICE BofA proprietary (ticker MOVE on Bloomberg; also Reuters/TradingView). MacroTilt Tier 2 rates factor; <80 normal, 80–120 elevated, >120 bond-market stress (SVB peak 198).",
"Rates volatility has eased substantially from 98 a month ago. Now near the pre-2022 average of ~65 — borrowing-cost uncertainty has receded."],
anfci:["ANFCI","Chicago Fed Fin. Conditions","fincond",2,"z-score",2,-0.47,0.08,0.06,0.04,-0.05,false,
"Adjusted National Financial Conditions Index — Chicago Fed composite of 105 financial indicators (credit, equity, money-market, leverage) with business-cycle effects regressed out. Standard-deviation units. Source: FRED ANFCI (weekly, released Wednesdays). MacroTilt Tier 2 fincond factor; >0 = tighter than economy warrants, <0 = looser. Leads real activity by 1–2 quarters.",
"Conditions have loosened sharply — among the most accommodative readings outside crisis-response periods. Negative = looser than the economy warrants."],
stlfsi:["STLFSI","St. Louis Fed Stress Index","fincond",2,"index",2,-0.65,0.22,0.18,0.12,-0.10,false,
"St. Louis Fed Financial Stress Index — principal-component composite of 18 weekly stress series (yields, spreads, equity vol). Zero = historical average stress. Source: FRED STLFSI4 (weekly). MacroTilt Tier 2 fincond factor; >1.0 concerning, >2.5 crisis, <0 benign. More volatile and less smoothed than ANFCI.",
"Stress has receded to below-average levels. A sustained move above 1.0 would be concerning."],
real_rates:["10Y TIPS","Real Interest Rates","rates",2,"%",2,1.9,1.90,1.75,1.85,1.50,false,
"10-year constant-maturity TIPS yield — market-implied real (after-inflation) cost of long-term borrowing. Source: FRED DFII10 (US Treasury, daily). MacroTilt Tier 2 rates factor; historical average ~0.5%, >1.5% restrictive (compresses equity valuations, especially growth), sub-zero indicates financial repression.",
"Restrictive (historical avg ~0.5%). Compresses equity valuations especially growth stocks. Slow-moving — has held in this range for months."],
sloos_ci:["SLOOS C&I","Business Lending Standards","bank",2,"%",1,5.3,9.8,8.0,6.0,2.0,false,
"Senior Loan Officer Opinion Survey (Fed) — net % of banks reporting tighter Commercial & Industrial loan standards. Quarterly survey of ~75 domestic banks; metric = (% tightening) − (% easing). Source: FRED DRTSCILM (large/mid firms). MacroTilt Tier 2 bank factor; leads credit events 1–2 quarters. GFC peak 84%, >10% historical tightening signal, <0 = net easing.",
"Net tightening has eased meaningfully from 9.8% a quarter ago. Well below crisis levels (GFC: 84%). Historically leads credit events by 1–2 quarters."],
cape:["Shiller CAPE","Cyclically Adj. P/E Ratio","equity",2,"ratio",1,34.2,35.1,33.8,31.5,29.8,true,
"Shiller Cyclically Adjusted P/E — S&P 500 price divided by 10-year trailing inflation-adjusted earnings, smoothing cyclical earnings volatility. Source: Robert Shiller dataset (shillerdata.com, monthly). MacroTilt Tier 2 equity valuation factor; long-run mean ~17, >25 rich, >30 very rich (1929, 2000, 2021, current). Weak short-term timing tool, strong 10-year forward-return predictor.",
"Elevated valuation — only exceeded in 1929 and the dot-com peak. Does not predict timing but predicts poor 10-year forward returns."],
ism:["ISM Mfg. PMI","Manufacturing Activity Index","labor",2,"index",1,52.7,52.4,52.6,49.8,47.9,true,
"ISM Manufacturing Purchasing Managers Index — diffusion index of 5 subcomponents (New Orders, Production, Employment, Supplier Deliveries, Inventories), each 20%-weighted; >50 = expansion, <50 = contraction. Source: Institute for Supply Management (monthly, first business day). MacroTilt Tier 2 growth factor; <45 has preceded every recession since 1970 except 1967, 50–55 neutral growth, >55 strong cyclical upturn.",
"Manufacturing in expansion territory and inflecting higher after a soft 2H 2025. A reading sustained above 52 would confirm a real cyclical upturn."],
copper_gold:["Copper/Gold Ratio","Real Economy vs. Safe Haven","labor",2,"ratio",3,0.126,0.098,0.108,0.112,0.152,true,
"Ratio of front-month COMEX copper futures to COMEX gold futures. Copper is a growth-sensitive industrial metal; gold is a safe-haven store of value — the ratio captures real-economy risk appetite. Source: CME Group (HG1, GC1; daily). MacroTilt Tier 2 growth factor; historical mean ~0.20, falling ratio signals growth pessimism, rising indicates cyclical recovery.",
"At 0.126, ratio sits ~37% below its 0.20 historical mean — persistent safe-haven gold demand continues to overshadow copper. Ratio dipped to ~0.098 a month ago before copper's rally toward $6/lb drove a partial rebound. A sustained move back toward 0.15+ would signal improving growth confidence."],
bkx_spx:["BKX/SPX Ratio","Bank vs. Market Strength","bank",2,"ratio",3,0.09,0.086,0.103,0.097,0.090,true,
"KBW Bank Index relative to S&P 500 — measures whether banks are leading or lagging the broad market. Source: Nasdaq (KBE ETF) and S&P Dow Jones Indices (SPX/SPY), daily. MacroTilt Tier 2 bank factor; banks have traded at a persistent structural discount since the GFC. Sharp breakdown precedes banking-sector stress — SVB collapse (March 2023) was preceded by a BKX/SPX breakdown.",
"KBE/SPY near 0.09, up from ~0.086 a month ago as banks rallied in early April. Ratio sits ~30% below its historical mean of 0.13 — banks continue to trade at a persistent structural discount to the broader market. A sustained drop below 0.08 would echo SVB-era stress (March 2023)."],
bank_unreal:["Bank Unreal. Loss","AFS+HTM Losses / Tier 1","bank",2,"% T1",1,19.9,19.5,20.8,22.1,18.5,true,
"Aggregate unrealized securities losses at FDIC-insured banks (AFS + HTM portfolios) expressed as % of Tier 1 regulatory capital. Source: FDIC Quarterly Banking Profile (Call Reports, RCON4223 + RCON1350, ~60-day lag). MacroTilt Tier 2 bank factor; SVB was at 104% before failure. Aggregate >20% indicates persistent rate-risk pressure with no margin for duration mismatches.",
"Aggregate unrealized losses remain near recent highs (~$481B). SVB was at 104% before failure. No margin for error if long rates back up."],
credit_3y:["3Y Credit Growth","3-Year Bank Credit Expansion","bank",2,"% 3yr",1,4.5,11.8,12.5,13.2,12.8,true,
"3-year cumulative growth in total bank credit (loans + securities) — measures buildup of system-wide credit fragility over a cycle. Computed as TOTBKCR_t / TOTBKCR_t−156w − 1. Source: FRED TOTBKCR (H.8 release, weekly). MacroTilt Tier 2 bank factor; >12% signals credit-boom fragility that historically precedes crises, <5% indicates tight credit and reduced economic dynamism.",
"Steep slowdown from 11.8% a quarter ago. Below 5% historically signals tight credit conditions and reduced economic dynamism."],
term_premium:["Kim–Wright 10Y","10-Year Term Premium","rates",3,"bps",0,65.0,55,45,35,20,false,
"Kim–Wright 10-year Treasury term premium — extra compensation investors demand for holding a 10-year Treasury instead of rolling short bills. Fed Board affine-term-structure-model estimate (Kim & Wright 2005). Source: Federal Reserve Board KW series (weekly). MacroTilt Tier 3 rates factor; was deeply negative through QE, rising premium = structural tightening independent of Fed policy.",
"Risen steadily from QE-era depths — long-end investors demanding more compensation. Structural tightening independent of Fed policy."],
cmdi:["CMDI","Corp Bond Market Distress","credit",3,"index",2,0.03,0.38,0.30,0.25,0.12,false,
"Corporate Bond Market Distress Index — NY Fed composite tracking primary-market issuance, secondary-market liquidity, and pricing dislocations in US corporate credit. Zero = normal functioning. Source: Federal Reserve Bank of New York (daily). MacroTilt Tier 3 credit factor; sustained >0.3 flags impaired market access, leading indicator for credit availability.",
"Corporate bond market functioning normally — sharp improvement from 0.38 a month ago. A clear positive for credit availability."],
loan_syn:["HY Eff. Yield","High Yield Effective Yield","credit",3,"%",2,6.74,7.45,7.0,6.5,6.2,false,
"ICE BofA US High Yield Index Effective Yield — weighted effective yield of the BB/B/CCC-rated HY bond universe; used here as a proxy for leveraged-finance market costs (not a true leveraged-loan series). Source: FRED BAMLH0A0HYM2EY (ICE BofA, daily, FRED license). MacroTilt Tier 3 credit factor; 4–5% = loose, >7% squeezes issuers with near-term maturities, >10% = refinancing crisis.",
"Easing from 7.45% a month ago but still elevated vs. low-rate era (4–5%). Companies with near-term maturities face refinancing pressure."],
usd:["USD Index","ICE US Dollar Index","fincond",3,"index",1,98.3,101.0,102.5,101.8,101.0,false,
"ICE US Dollar Index — geometric mean of USD against six major currencies (EUR 57.6%, JPY 13.6%, GBP 11.9%, CAD 9.1%, SEK 4.2%, CHF 3.6%). The dollar index every trading desk references intraday. Source: Yahoo DX-Y.NYB (ICE Futures US, daily — was FRED DTWEXBGS, swapped 2026-04-24 PR #1.5; DTWEXBGS sat on a 7-day lag and a different scale, so historical z-scores were being computed against the wrong series). MacroTilt Tier 3 fincond factor; strong dollar tightens global financial conditions and pressures EM/commodity exposures. >105 = meaningfully tight, sustained >110 = disorderly strength.",
"Dollar has weakened ~3% over the past month from ~101 — eases global financial conditions and supports EM/commodity exposures. Above 105 = meaningfully tight."],
cpff:["USD Funding","3M CP vs. Fed Funds Spread","fincond",3,"bps",0,18.0,14,12,10,8,false,
"Spread between 3-month AA financial commercial paper yield and the effective Fed Funds Rate — measures stress in the corporate short-term funding market. Computed as DCPF3M − DFF. Source: FRED DCPF3M − DFF (Federal Reserve Board, daily). MacroTilt Tier 3 fincond factor; <20bps normal, 20–50bps elevated, >50bps funding stress (COVID peak 65bps, GFC peak 280bps).",
"Money markets functioning normally. GFC peak: 280bps; COVID: 65bps. Funding stress is absent."],
skew:["SKEW Index","Options-Implied Tail Risk","equity",3,"index",0,141.0,141,138,135,130,false,
"CBOE SKEW Index — extracts the implied probability of a large (2+ standard deviation) S&P 500 decline from the relative pricing of far out-of-the-money SPX puts vs. at-the-money options. Source: CBOE SKEW (daily; ticker SKEW on Bloomberg/TradingView). MacroTilt Tier 3 equity factor; 100 = normal distribution, >140 = meaningful priced tail risk, sustained >150 = aggressive tail-hedge bid. Contrarian when elevated alongside low VIX.",
"Mildly elevated. Combined with moderate VIX, suggests quiet positioning for tail risk underneath an otherwise calm market."],
sloos_cre:["SLOOS CRE","CRE Lending Standards","bank",3,"%",1,8.9,18.3,15.0,12.0,8.0,false,
"Senior Loan Officer Opinion Survey (Fed) — net % of banks reporting tighter Commercial Real Estate loan standards. Quarterly survey of ~75 domestic banks; metric = (% tightening) − (% easing). Source: FRED DRTSCLCC (weighted-avg CRE; construction, multifamily, nonfarm-nonresidential). MacroTilt Tier 3 bank factor; office and retail CRE are most sensitive; >20% flags meaningful credit drought, <0 = net easing.",
"Net CRE tightening has more than halved from 18.3% a quarter ago — a meaningful easing. Office and retail still face funding squeeze."],
bank_credit:["Bank Credit","YoY Bank Credit Growth","bank",3,"% YoY",1,6.7,3.4,3.8,4.2,5.0,false,
"Year-over-year growth rate of total bank credit (loans + securities) at US commercial banks. Computed as TOTBKCR_t / TOTBKCR_t−52w − 1. Source: FRED TOTBKCR (H.8 Assets and Liabilities of Commercial Banks, weekly). MacroTilt Tier 3 bank factor; historical average ~6.5%, <3% signals tightening credit feeding through to the real economy, sustained <0 = credit contraction (2009, 2020 Q2).",
"Credit growth has accelerated back to historical average (~6.5%) — well up from a stalled 3.4% a month ago. Supports business and consumer activity."],
jobless:["Init. Claims","Weekly Jobless Claims","labor",3,"K",0,207.0,224,215,210,208,false,
"Initial unemployment insurance claims — weekly count of new jobless filings. Source: FRED ICSA (US Department of Labor, released Thursdays, seasonally adjusted). MacroTilt Tier 3 labor factor; 200–250K healthy, sustained >300K early recession signal, >400K confirms recession underway, >600K crisis-level (2008/2020). Most timely high-frequency labor indicator.",
"Within healthy pre-COVID range of 200–250K. No recession signal. Watch for sustained moves above 250K."],
jolts_quits:["JOLTS Quits","Voluntary Quit Rate","labor",3,"%",1,1.9,2.3,2.35,2.45,2.55,false,
"Voluntary quits as a percentage of total nonfarm employment — workers quit when confident about finding a better job, so the rate proxies labor-market tightness and wage-pressure direction. Source: FRED JTSQUR (BLS Job Openings and Labor Turnover Survey, monthly). MacroTilt Tier 3 labor factor; post-2000 average ~2.1%, >2.5% tight labor market with wage pressure, <2% softening, <1.5% recessionary.",
"Down sharply from a post-COVID high of 3.0% — workers less confident about finding a better job. Signals softening labor market."],
// ─── 8 NEW SERIES (2026-04-24) — Senior-Quant-validated; data populated at
//     runtime from public/indicator_history.json. Hardcoded m1/m3/m6/m12 left
//     null; UI computes them from real history. cur seeded as null → live.
m2_yoy:["M2 Money Supply","M2 Money Stock YoY Growth","fincond",1,"% YoY",2,null,null,null,null,null,false,
"Year-over-year growth in the M2 money stock — Friedman's medium-term monetary impulse to asset prices. Source: FRED M2SL (monthly, transformed to YoY % change). MacroTilt Tier 1 financial-conditions factor; sustained M2 growth above ~7% historically associated with looser conditions and higher asset valuations, sub-zero growth (M2 contraction) is rare and historically tight.",
""],
fed_bs:["Fed Balance Sheet","Fed Total Assets YoY Change","fincond",2,"% YoY",1,null,null,null,null,null,false,
"Year-over-year change in the Fed's total assets (WALCL) — the headline measure of QE / QT. Positive = balance-sheet expansion (QE), negative = contraction (QT). Source: FRED WALCL (weekly, transformed to YoY % change). MacroTilt Tier 2 financial-conditions factor; tracks the direction of policy liquidity injection or withdrawal.",
""],
rrp:["Reverse Repo","Overnight Reverse Repo Take-Up","fincond",2,"$bn",0,null,null,null,null,null,false,
"Cash parked at the Fed's reverse-repo facility — a measure of liquidity drag from money-market funds. Higher take-up indicates excess system liquidity is being absorbed by the Fed; sharply falling take-up signals liquidity is being pulled back into private credit. Source: FRED RRPONTSYD (daily, divided by 1,000 for $bn).",
""],
bank_reserves:["Bank Reserves","Reserve Balances at the Fed","bank",2,"$bn",0,null,null,null,null,null,false,
"Total reserves held by depository institutions at the Fed — the system liquidity floor. Source: FRED WRESBAL (weekly, divided by 1,000 for $bn). MacroTilt Tier 2 bank factor; the Fed has signaled the floor for ample reserves is somewhere around $3T — sustained moves below that range are a tightening signal for the banking system.",
""],
tga:["Treasury General Account","Treasury Cash at the Fed","fincond",2,"$bn",0,null,null,null,null,null,false,
"Cash held by the Treasury at the Fed — when high, it withdraws liquidity from bank reserves; when low, it adds liquidity back into the system. Mechanical liquidity-impact relationship inverse to RRP and bank reserves. Source: FRED WTREGEN (weekly, divided by 1,000 for $bn).",
""],
breakeven_10y:["10Y Breakeven","10-Year Inflation Breakeven","rates",2,"%",2,null,null,null,null,null,false,
"10-year breakeven inflation rate — the bond market's read on average annual CPI inflation over the next decade, computed as nominal 10Y Treasury yield minus 10Y TIPS real yield. Source: FRED T10YIE (daily). MacroTilt Tier 2 rates factor; long-run anchor near 2.0–2.5%; sustained moves above 3% reflect inflation-regime concerns, sub-1.5% reflects deflation/hard-landing pricing.",
""],
cfnai:["CFNAI","Chicago Fed National Activity Index","labor",1,"index",2,null,null,null,null,null,false,
"85-component composite of monthly economic activity covering production, employment, personal-consumption / housing, and sales / orders / inventories. Source: FRED CFNAI (monthly). MacroTilt Tier 1 growth factor; readings above 0 = above-trend growth, below 0 = below trend, sustained below −0.7 historically signals an active recession (NBER convention uses the 3-month average — see cfnai_3ma).",
""],
cfnai_3ma:["CFNAI (3M Avg)","CFNAI 3-Month Moving Average","labor",1,"index",2,null,null,null,null,null,false,
"Smoothed (3-month moving average) version of CFNAI — the Chicago Fed's preferred read because the monthly series is noisy. The threshold often cited for recession risk is a sustained −0.7 in this 3-month average. Source: FRED CFNAI, computed as a 3-month rolling mean. MacroTilt Tier 1 growth factor; primary input to the Growth composite.",
""],
hy_ig_etf:["HY-IG ETF Proxy","LQD ÷ HYG Price Ratio","credit",2,"ratio",4,null,null,null,null,null,false,
"LQD (investment-grade corporate bond ETF) divided by HYG (high-yield ETF) — a Yahoo-sourced proxy for HY-IG spread that backfills the 2007–2023 window where FRED's ICE BofA OAS series is licensed-out. Higher ratio = HY underperforming = wider spreads. Source: Yahoo Finance (daily). Reference indicator only — NOT a substitute for the FRED OAS series in composite math; the FRED series is preserved as-is via curated anchors.",
""],
};

// Reporting frequency per indicator: D=Daily, W=Weekly, M=Monthly, Q=Quarterly
// Release-frequency badge shown on each indicator card (D = Daily, W = Weekly,
// M = Monthly, Q = Quarterly). This was accidentally overwritten with dates
// at some point — values below are the actual update cadence of each source.
const IND_FREQ={
  vix:"D",hy_ig:"D",eq_cr_corr:"D",yield_curve:"D",move:"D",
  real_rates:"D",copper_gold:"D",bkx_spx:"D",usd:"D",skew:"D",
  anfci:"W",stlfsi:"W",cpff:"W",loan_syn:"W",bank_credit:"W",jobless:"W",cmdi:"W",term_premium:"W",
  cape:"M",ism:"M",jolts_quits:"M",
  sloos_ci:"Q",sloos_cre:"Q",bank_unreal:"Q",credit_3y:"Q",
  // New series 2026-04-24
  m2_yoy:"M",fed_bs:"W",rrp:"D",bank_reserves:"W",tga:"W",
  breakeven_10y:"D",cfnai:"M",cfnai_3ma:"M",hy_ig_etf:"D",
};

const WEIGHTS={
vix:1.5,hy_ig:1.5,eq_cr_corr:1.5,yield_curve:1.5,
move:1.2,anfci:1.2,stlfsi:1.2,real_rates:1.2,sloos_ci:1.2,
cape:1.2,ism:1.2,copper_gold:1.2,bkx_spx:1.2,bank_unreal:1.2,credit_3y:1.2,
term_premium:1.0,cmdi:1.0,loan_syn:1.0,usd:1.0,cpff:1.0,
skew:1.0,sloos_cre:1.0,bank_credit:1.0,jobless:1.0,jolts_quits:1.0,
};

const ACCENT="#4a6fa5";
// Per-category hues chosen to avoid the stress palette (red/green/amber
// reserved for sdColor), so the category color never "reads as" a stress
// signal. Previously every entry shared ACCENT — Item 22 in Master Bug
// Inventory: detail modal + card left-bar were visually uncategorized.
const CATS={
equity:  {label:"Equity & Vol",        color:"#8b5cf6"}, // violet
credit:  {label:"Credit Markets",      color:"#f59e0b"}, // amber
rates:   {label:"Rates & Duration",    color:"#06b6d4"}, // cyan
fincond: {label:"Financial Conditions",color:"#ec4899"}, // pink
bank:    {label:"Bank & Money Supply", color:"#14b8a6"}, // teal
labor:   {label:"Labor & Economy",     color:"#3b82f6"}, // blue
};

function fmtV(id,v){
if(v==null)return"—";
const u=IND[id]?.[4],d=IND[id]?.[5]??1;
if(!u)return String(v);
if(u==="K")return`${Math.round(v)}K`;
if(u==="bps")return`${Math.round(v)}bps`;
if(u==="z-score")return(v>0?"+":"")+Number(v).toFixed(d);
if(["% T1","% 3yr","% YoY","%"].includes(u))return`${Number(v).toFixed(d)}%`;
return`${Number(v).toFixed(d)}`;
}

// Replace the leading "At X" / "At X%" / "At $X" reference in a signal narrative
// with the live current value, so narratives auto-sync when underlying data updates.
// Also strips a trailing parenthetical date hint like "(March 2026)".
function dynamicSignal(id,cur,signal){
if(!signal||cur==null)return signal||"";
const v=fmtV(id,cur);
return signal.replace(
/^At\s+[$]?-?[\d.,]+\s*(?:%|bps|K)?(?:\s*\([^)]*\))?\s*,/i,
`At ${v},`
);
}

function compScore(snap){
let ws=0,wt=0;
Object.keys(IND).forEach(id=>{
const w=WEIGHTS[id];if(!w)return;
const s=sdScore(id,snap[id]);if(s==null)return;
ws+=s*w;wt+=w;
});
return wt>0?ws/wt:0;
}

// NOTE: NOW/MO1/MO3 and all downstream composites (COMP, VEL, CONV, TREND_SIG)
// are declared `let` so that _applyHistToGlobals() (see REAL HISTORY LOADER
// below) can recompute them after /indicator_history.json loads and mutates
// IND[id][6..8]. Without these being `let`, the post-fetch recompute would
// throw "Assignment to constant variable". See PR #17 (Item 5b + 18 + 9d).
let NOW={},MO1={},MO3={};
Object.keys(IND).forEach(id=>{NOW[id]=IND[id][6];MO1[id]=IND[id][7];MO3[id]=IND[id][8];});
let COMP=compScore(NOW);
let COMP1M=compScore(MO1);
let COMP3M=compScore(MO3);
let COMP100=sdTo100(COMP);
let COMP1M100=sdTo100(COMP1M);
let COMP3M100=sdTo100(COMP3M);
// Velocity: change over 4 weeks (positive = stress rising)
let VEL=COMP-COMP1M;
let CONV=getConv(COMP);

// ── TREND SIGNAL ────────────────────────────────────────────────────────────
function trendSignal(vel){
if(vel>0.12) return{label:"Rising Fast",  arrow:"▲▲",col:"#ff453a"};
if(vel>0.05) return{label:"Rising",       arrow:"▲", col:"#ff9f0a"};
if(vel>0.02) return{label:"Edging Up",    arrow:"↗", col:"#B8860B"};
if(vel<-0.12)return{label:"Easing Fast",  arrow:"▼▼",col:"#30d158"};
if(vel<-0.05)return{label:"Easing",       arrow:"▼", col:"#30d158"};
if(vel<-0.02)return{label:"Edging Down",  arrow:"↘", col:"#86efac"};
return              {label:"Stable",       arrow:"→", col:"var(--text-2)"};
}
let TREND_SIG=trendSignal(VEL);

function trendArrow(current,prior){
const d=current-prior;
if(d>5)  return{arrow:"▲",col:"#ff453a",label:"Rising"};
if(d>1)  return{arrow:"↗",col:"#ff9f0a",label:"Edging up"};
if(d<-5) return{arrow:"▼",col:"#30d158",label:"Easing"};
if(d<-1) return{arrow:"↘",col:"#86efac",label:"Edging down"};
return{arrow:"→",col:"var(--text-2)",label:"Stable"};
}

const TREND={
composite:{w1:43,m1:41,m6:52,m12:48},
equity:   {w1:52,m1:48,m6:44,m12:38},
credit:   {w1:38,m1:42,m6:48,m12:35},
rates:    {w1:55,m1:52,m6:58,m12:62},
fincond:  {w1:28,m1:30,m6:35,m12:30},
bank:     {w1:60,m1:58,m6:55,m12:50},
labor:    {w1:18,m1:20,m6:25,m12:28},
};

const COMP_HIST=[
["Q1 '05",20],["Q2 '05",24],["Q3 '05",28],["Q4 '05",30],
["Q1 '06",26],["Q2 '06",23],["Q3 '06",20],["Q4 '06",18],
["Q1 '07",22],["Q2 '07",30],["Q3 '07",42],["Q4 '07",52],
["Q1 '08",68],["Q2 '08",74],["Q3 '08",86],["Q4 '08",92],
["Q1 '09",84],["Q2 '09",75],["Q3 '09",64],["Q4 '09",55],
["Q1 '10",52],["Q2 '10",50],["Q3 '10",46],["Q4 '10",44],
["Q1 '11",42],["Q2 '11",46],["Q3 '11",58],["Q4 '11",54],
["Q1 '12",50],["Q2 '12",46],["Q3 '12",42],["Q4 '12",40],
["Q1 '13",36],["Q2 '13",32],["Q3 '13",30],["Q4 '13",28],
["Q1 '14",30],["Q2 '14",32],["Q3 '14",34],["Q4 '14",32],
["Q1 '15",30],["Q2 '15",35],["Q3 '15",42],["Q4 '15",38],
["Q1 '16",42],["Q2 '16",38],["Q3 '16",32],["Q4 '16",28],
["Q1 '17",22],["Q2 '17",20],["Q3 '17",18],["Q4 '17",16],
["Q1 '18",26],["Q2 '18",32],["Q3 '18",36],["Q4 '18",44],
["Q1 '19",40],["Q2 '19",36],["Q3 '19",34],["Q4 '19",28],
["Q1 '20",55],["Q2 '20",82],["Q3 '20",52],["Q4 '20",36],
["Q1 '21",30],["Q2 '21",25],["Q3 '21",22],["Q4 '21",20],
["Q1 '22",36],["Q2 '22",55],["Q3 '22",65],["Q4 '22",62],
["Q1 '23",60],["Q2 '23",56],["Q3 '23",52],["Q4 '23",46],
["Q1 '24",42],["Q2 '24",40],["Q3 '24",36],["Q4 '24",32],
// 2025 — real regime history, not a placeholder:
//  Q1: March sell-off (S&P -4.6% on tariff fears). VIX 18-22.
//  Q2: LIBERATION DAY crash April 8 (S&P → 4,982, VIX peak 50+),
//      then record recovery (S&P ATH 6205 by Jun 30). Quarter avg elevated.
//  Q3: Strong rally, VIX ~15, gov shutdown shrugged off.
//  Q4: Year-end rally to 6846 close (+16.4% 2025). VIX ~13-15.
["Q1 '25",42],["Q2 '25",55],["Q3 '25",28],["Q4 '25",24],
// 2026 — Q1 rally continued from year-end '25 (S&P ATH 7023 by Apr 15).
// Stress stays low; VIX ~14, tight credit spreads. Item 20 — restore the
// Q1 '26 tick that went missing when the live point was renamed "Apr 15".
["Q1 '26",22],
["Apr 15",COMP100],
];

const COMP_CRISES=[
{label:"GFC",year:"Q4 '08",color:"#ff453a"},
{label:"COVID",year:"Q2 '20",color:"#ff9f0a"},
{label:"Rate Shock",year:"Q3 '22",color:"#B8860B"},
];

// S&P 500 quarterly closes — matches COMP_HIST index-for-index
const SP500_HIST=[
1181,1191,1228,1248, // 2005
1295,1270,1335,1418, // 2006
1421,1503,1527,1468, // 2007
1323,1280,1166, 903, // 2008
 798, 919,1057,1115, // 2009
1169,1031,1141,1258, // 2010
1326,1321,1131,1258, // 2011
1408,1362,1441,1426, // 2012
1569,1606,1682,1848, // 2013
1872,1960,1973,2059, // 2014
2068,2063,1921,2044, // 2015
2060,2099,2168,2239, // 2016
2363,2423,2519,2674, // 2017
2641,2718,2914,2507, // 2018
2834,2942,2977,3231, // 2019
2585,3100,3363,3757, // 2020
3973,4298,4308,4766, // 2021
4530,3785,3585,3840, // 2022
4109,4450,4288,4770, // 2023
5254,5461,5762,5882, // 2024
5612,6205,6688,6846, // 2025 — real quarterly closes (Mar31, Jun30, Sep30, Dec31)
6917,                // Q1 '26 close — Mar 31 2026 (interpolated between Q4 '25 6846 and Apr 15 2026 7023; Item 20)
7023,                // Apr 15 2026 (all-time high)
];

function clampHistValue(id,v){
if(v==null||v!==v)return v;
let x=v;
if(id==="eq_cr_corr")return Math.max(-0.15,Math.min(1,x));
if(id==="yield_curve")return Math.max(-120,Math.min(420,x));
if(id==="ism")return Math.max(32,Math.min(72,x));
if(id==="copper_gold")return Math.max(0.08,Math.min(0.32,x));
if(id==="bkx_spx")return Math.max(0.06,Math.min(0.5,x));
if(id==="jolts_quits")return Math.max(1.2,Math.min(3.2,x));
if(id==="jobless")return Math.max(120,Math.min(620,x));
if(id==="skew")return Math.max(105,Math.min(165,x));
return x;
}

function piecewiseYearValue(y,kf){
const x=Number(y);
if(!kf.length)return null;
if(x<=kf[0][0])return kf[0][1];
for(let i=0;i<kf.length-1;i++){
const a=kf[i],b=kf[i+1];
if(x<=b[0]){
const t=(x-a[0])/(b[0]-a[0]||1);
const u=Math.max(0,Math.min(1,t));
return a[1]+u*(b[1]-a[1]);
}
}
return kf[kf.length-1][1];
}

// Per-indicator historical overrides. Keys are indicator IDs; values are
// [year, actualValue] keyframes sourced from real historical data. The
// piecewise interpolator handles fractional years for the quarterly chart.
// Use this when the generic synthetic shape (2008 peak, 2020 COVID spike)
// misrepresents the indicator's actual trajectory.
const HIST_OVERRIDES = {
  // Bank unrealized losses (AFS+HTM as % Tier 1). FDIC quarterly data.
  // Pre-2022 was trivial (low rates = bonds at par). The story is the
  // 2022 Fed hiking cycle, peak at SVB failure (Mar 2023, ~28% sys-wide),
  // gradual decline through 2024-2025 as rates plateaued.
  bank_unreal: [
    [2005, 3.5],   // pre-GFC — small AOCI losses
    [2008, 11.0],  // GFC bond stress (mostly credit, some duration)
    [2009, 4.5],   // recovery as Fed cut to ~0
    [2013, 6.0],   // Taper Tantrum bump
    [2015, 2.5],   // low rates persist
    [2019, 2.0],   // pre-COVID baseline
    [2020, 1.5],   // Fed cuts to zero — bond gains
    [2021.5, 5.0], // rates begin to rise
    [2022.0, 14.0],// Fed starts hiking aggressively
    [2022.75, 31.0],// peak: ~$690B unrealized loss (Q3 2022)
    [2023.25, 28.0],// SVB collapse era (Mar 2023)
    [2023.75, 25.0],
    [2024.25, 22.0],
    [2024.75, 18.0],
    [2025.5, 20.0],// rates plateau, mild deterioration
  ],

  // Shiller CAPE (cyclically adjusted P/E). Source: multpl.com / Shiller data.
  // Long-run mean ~17. Only exceeded 30 in 1929, 2000, 2021, 2024-2026.
  cape: [
    [2005.0, 26.7],  // post-dot-com hangover, still elevated
    [2006.5, 27.0],
    [2007.5, 26.2],  // housing peak
    [2008.75, 14.9], // GFC: crashed from 27 to 15 in 12 months
    [2009.25, 13.3], // March 2009 low — cheapest since 1986
    [2010.5, 21.0],
    [2012.0, 21.3],
    [2014.0, 25.6],
    [2016.0, 25.7],
    [2018.0, 33.3],  // late-cycle richness
    [2019.5, 29.5],
    [2020.25, 23.7], // brief COVID crash
    [2020.75, 31.4],
    [2021.75, 38.6], // Nov 2021 peak — second-highest ever after dot-com
    [2022.75, 27.9], // bear market low
    [2023.5, 30.3],
    [2024.25, 34.2],
    [2024.75, 36.8], // late 2024 record highs
    [2025.25, 33.5], // Q1 sell-off + AI-led mild correction
    [2025.5, 33.0],  // Liberation Day crash compressed multiples
    [2025.75, 35.4], // rapid recovery to record highs by Sep
    [2026.0, 34.5],
  ],

  // KBW Bank Index / S&P 500 ratio. Tracks bank stock leadership.
  // Lower = bank-sector stress relative to broad market.
  // Historical drawdowns: GFC 2008-09, COVID 2020, SVB/regional-bank 2023.
  bkx_spx: [
    [2005.0, 0.148],
    [2006.0, 0.149],
    [2007.0, 0.138],  // cracks forming
    [2007.75, 0.100], // Q4 2007 financials lead market down
    [2008.5, 0.073],
    [2009.0, 0.030],  // GFC bank crisis trough
    [2009.75, 0.055],
    [2011.0, 0.090],  // Euro crisis drag on banks
    [2013.0, 0.110],
    [2015.0, 0.130],
    [2017.0, 0.165],  // Trump reflation + dereg trade
    [2018.5, 0.155],
    [2019.75, 0.145],
    [2020.25, 0.085], // COVID crash — banks lagged hard
    [2021.5, 0.145],  // reopening / rate hike trade
    [2022.75, 0.135],
    [2023.25, 0.080], // SVB / Signature / First Republic collapse
    [2023.75, 0.100],
    [2024.5, 0.115],
    [2025.25, 0.110],
    [2025.5, 0.095],  // Q2 tariff volatility hit regional bank exposure
    [2025.75, 0.105],
    [2026.0, 0.092],
  ],

  // Kim-Wright 10Y term premium (bps). Negative for most of 2014-2022
  // due to QE and safe-haven demand. Rising back into positive territory
  // post-pandemic as Fed balance sheet shrinks and fiscal supply grows.
  term_premium: [
    [2005.0, 65],
    [2006.5, 35],
    [2007.5, 20],
    [2008.5, 80],  // GFC funding stress
    [2009.5, 50],
    [2011.0, 45],
    [2013.0, 15],  // taper tantrum
    [2014.5, -20], // QE era begins to push premium negative
    [2016.0, -50],
    [2018.0, -35],
    [2019.5, -80], // cycle low
    [2020.5, -90], // COVID-era Fed purchases
    [2021.5, -30],
    [2022.5, 15],  // QT announced, rising supply
    [2023.5, 25],
    [2024.0, 35],
    [2024.75, 45],
    [2025.5, 60],  // Liberation Day fiscal-uncertainty premium
    [2025.75, 55],
    [2026.0, 65],
  ],
};

// Anchor the chart to today so interpolation from the last real keyframe
// flows smoothly into the "Now" bucket. April 2026 → 2026 + 3/12 ≈ 2026.28.
const NOW_T=2026.28;

function buildDefaultHistKeyframes(id){
const sp=SD[id];if(!sp||!IND[id])return null;
const d=IND[id],nowVal=d[6];
// Per-indicator override (real data) wins over the generic synthetic shape.
// Append today's reading so 2025/early-2026 points aren't flat-lined.
if(HIST_OVERRIDES[id]){
const kf=HIST_OVERRIDES[id];
const last=kf[kf.length-1];
return last[0]<NOW_T?[...kf,[NOW_T,nowVal]]:kf;
}
const m=sp.mean,sd=sp.sd||1e-9;
const flip=sp.dir==="lw"||sp.dir==="nw";
const u=f=>flip?-f:f;
return[
[2005,m+u(0.06)*sd],
[2008,m+u(2.05)*sd],
[2009,m+u(0.85)*sd],
[2015,m+u(0.1)*sd],
[2019,m+u(0.14)*sd],
[2020,m+u(1.58)*sd],
[2022,m+u(1.02)*sd],
[2024,m+u(0.28)*sd],
[NOW_T,nowVal],
];
}

// ── REAL HISTORY LOADER ─────────────────────────────────────────────────────
// public/indicator_history.json is a 20-year snapshot at native cadence for
// every indicator, plus a 15-year trailing `stats:{mean,sd,winsorize,n}` block
// and a per-indicator `as_of` date. Generated by fetch_history.py; served as
// a static asset. We fetch it once and cache in module scope — subsequent
// readers reuse the same object.
//
// Side effect on load: we OVERWRITE the hardcoded SD{} and AS_OF{} tables
// above with fresh values from the JSON, plus mutate IND[id][6] with the
// latest datapoint. Every call site (sdScore, IndicatorCard, IndicatorModal,
// IndicatorTrendPills, tile mini-chart) reads through SD[id] / AS_OF[id] /
// IND[id][6] and automatically picks up calibrated numbers without
// prop-threading. Re-render after load is triggered by useHistReady() which
// the App component calls at the top level.
let _histCache=null;
let _histPromise=null;
const _histReadyListeners=new Set();
let _histReadyVersion=0;
function _applyHistToGlobals(hist){
  if(!hist||typeof hist!=="object")return;
  for(const id of Object.keys(hist)){
    const entry=hist[id];
    if(entry&&entry.stats&&typeof entry.stats.mean==="number"&&typeof entry.stats.sd==="number"){
      const prev=SD[id]||{};
      SD[id]={
        mean:entry.stats.mean,
        sd:entry.stats.sd,
        // Preserve direction from the hardcoded table if missing in stats
        dir:entry.stats.direction||prev.dir||"hw",
      };
    }
    if(entry&&typeof entry.as_of==="string"){
      // Format 2026-04-16 → "Apr 16 2026" to match the AS_OF convention.
      // Bug #1034: refuse any as_of that's strictly in the future — that
      // guarantees display code can never render a date that hasn't
      // happened yet (classic quarterly-resample phantom).
      try{
        const isoRaw=entry.as_of;
        const d=new Date(isoRaw+"T00:00:00Z");
        const today=new Date();
        const todayUtc=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
        if(+d>todayUtc){
          console.warn("[indicator-history] clamping future as_of for",id,"=",isoRaw,"→ today");
          // Skip overwriting AS_OF[id] with a future date; leave the
          // hardcoded placeholder in place and store no ISO so staleness()
          // returns null rather than showing a FRESH pill on bogus data.
        }else{
          const mo=d.toLocaleDateString("en-US",{month:"short",timeZone:"UTC"});
          AS_OF[id]=`${mo} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
          AS_OF_ISO[id]=isoRaw;
        }
      }catch{/* leave old AS_OF in place */}
    }
    // Mutate IND[id][6] with the latest point from hist so every reader
    // of the "current value" position in the tuple automatically picks
    // up daily-refreshed numbers — includes sdScore driving the composite
    // stress score, KPI tiles, comparison tables, and heatmap colors.
    if(entry&&Array.isArray(entry.points)&&entry.points.length&&IND[id]){
      const last=entry.points[entry.points.length-1];
      if(last&&last[1]!=null&&Number.isFinite(last[1])){
        IND[id][6]=last[1];
      }
    }
  }
  // Also refresh the NOW/MO1/MO3 lookup tables since they were built once at
  // module init from stale IND[id][6..8] values. Then recompute every derived
  // composite (COMP/COMP100/COMP1M/CONV/TREND_SIG/VEL) so gauges, narratives,
  // and the Home tile all reflect the fresh data on the next render.
  try{
    Object.keys(IND).forEach(id=>{
      NOW[id]=IND[id][6];
      MO1[id]=IND[id][7];
      MO3[id]=IND[id][8];
    });
    COMP=compScore(NOW);
    COMP1M=compScore(MO1);
    COMP3M=compScore(MO3);
    COMP100=sdTo100(COMP);
    COMP1M100=sdTo100(COMP1M);
    COMP3M100=sdTo100(COMP3M);
    VEL=COMP-COMP1M;
    CONV=getConv(COMP);
    TREND_SIG=trendSignal(VEL);
    // Also refresh DS (per-indicator SD scores) and FACTOR_SCORES, which
    // the Sectors tab and composite factor bars read lexically.
    if(typeof _rebuildDS==="function")_rebuildDS();
    if(typeof _rebuildFactorScores==="function")_rebuildFactorScores();
  }catch(e){console.warn("[indicator-history] composite recompute failed",e);}
}
function _notifyHistReady(){
  _histReadyVersion++;
  for(const fn of _histReadyListeners){try{fn(_histReadyVersion);}catch{/* noop */}}
}
function loadIndicatorHistory(){
  if(_histCache)return Promise.resolve(_histCache);
  if(_histPromise)return _histPromise;
  _histPromise=fetch("/indicator_history.json",{cache:"force-cache"})
    .then(r=>r.ok?r.json():{})
    .then(d=>{
      _histCache=d;
      _applyHistToGlobals(d);
      _notifyHistReady();
      return d;
    })
    .catch(e=>{console.warn("indicator_history.json load failed",e);_histCache={};_notifyHistReady();return {};});
  return _histPromise;
}
// Top-level hook: call inside the App component so that when the JSON lands
// and mutates SD/AS_OF, the whole tree re-renders with fresh stats. Returns
// a version number (unused by callers; the point is re-render on change).
function useHistReady(){
  const [,setV]=useState(_histReadyVersion);
  useEffect(()=>{
    const fn=(v)=>setV(v);
    _histReadyListeners.add(fn);
    if(!_histCache)loadIndicatorHistory();
    return()=>{_histReadyListeners.delete(fn);};
  },[]);
}

// Look up an indicator's value at approximately N months ago from its most
// recent historical point. Returns null if _histCache isn't loaded or the
// series is too short. Used by buildCategoryOverview() to compose the
// 12M / 6M columns in the Home Macro Overview tile without requiring new
// positions in the IND tuple.
function histValueAtMonthsAgo(id,monthsAgo){
  const entry=_histCache&&_histCache[id];
  if(!entry||!Array.isArray(entry.points)||entry.points.length<2)return null;
  const pts=entry.points;
  const lastStr=pts[pts.length-1][0];
  const lastDate=new Date(String(lastStr)+"T00:00:00Z");
  if(Number.isNaN(+lastDate))return null;
  const targetMs=lastDate.getTime()-monthsAgo*30.44*24*3600*1000;
  // Walk backwards for efficiency (histories are chronological).
  let best=null, bestDiff=Infinity;
  for(let i=pts.length-1;i>=0;i--){
    const [ds,val]=pts[i];
    if(val==null||!Number.isFinite(val))continue;
    const d=new Date(String(ds)+"T00:00:00Z");
    if(Number.isNaN(+d))continue;
    const diff=Math.abs(d.getTime()-targetMs);
    if(diff<bestDiff){bestDiff=diff; best=val;}
    // Stop once we've clearly passed the target (going further back only
    // worsens the match).
    if(d.getTime()<targetMs-45*24*3600*1000)break;
  }
  return best;
}

// Compute the real trailing-12-month statistics for an indicator directly
// from _histCache[id].points — filtered to the last 365 calendar days of
// the series. Returns {min,max,mean,sd,n} (values scaled by clampHistValue
// the same way the detail chart is), or null if there isn't enough data.
// Used by the IndicatorModal / IndicatorDetailBody range bar so sMin/sMax
// reflect the actual 12M window instead of the five sparse snapshot points
// [cur,m1,m3,m6,m12]. Bug #1035: prior to this fix, hy_ig (current 285,
// real 12M 264-416) was rendering with cur pegged to the right edge of
// the bar because the sparse-snapshot min/max happened to collapse near cur.
function get12MWindowStats(id){
  const entry=_histCache&&_histCache[id];
  if(!entry||!Array.isArray(entry.points)||entry.points.length<5)return null;
  const pts=entry.points;
  const lastStr=pts[pts.length-1][0];
  const lastDate=new Date(String(lastStr)+"T00:00:00Z");
  if(Number.isNaN(+lastDate))return null;
  const cutoffMs=lastDate.getTime()-365*24*3600*1000;
  const vals=[];
  for(let i=pts.length-1;i>=0;i--){
    const p=pts[i];
    if(!p)continue;
    const ds=p[0], raw=p[1];
    if(raw==null||!Number.isFinite(raw))continue;
    const d=new Date(String(ds)+"T00:00:00Z");
    if(Number.isNaN(+d))continue;
    if(d.getTime()<cutoffMs)break;
    vals.push(clampHistValue(id,raw));
  }
  if(vals.length<2)return null;
  let sum=0;for(const v of vals)sum+=v;
  const mean=sum/vals.length;
  let sq=0;for(const v of vals){const d=v-mean;sq+=d*d;}
  const sd=Math.sqrt(sq/Math.max(1,vals.length-1));
  let mn=vals[0], mx=vals[0];
  for(const v of vals){if(v<mn)mn=v;if(v>mx)mx=v;}
  return {min:mn, max:mx, mean, sd, n:vals.length};
}


// Build the [label, value] series used by IndStressChart (the compact tile
// mini-chart). Item 5b / Task #19: prefer real history from _histCache over
// the synthetic piecewiseYearValue keyframes, so the tile sparkline reflects
// the same data the main modal chart and SD scoring already use. For a small
// sparkline we downsample long histories to ~60 points evenly spaced and
// label them with the ISO date. Falls back to the synthetic keyframes when
// _histCache hasn't loaded or doesn't carry this indicator.
function getIndicatorHistSeries(id){
if(!IND[id]||!SD[id])return null;
const e=_histCache&&_histCache[id];
if(e&&Array.isArray(e.points)&&e.points.length>=3){
  const pts=e.points;
  // Downsample to at most ~60 points so the compact tile stays readable.
  const MAX=60;
  const step=pts.length<=MAX?1:Math.floor(pts.length/MAX);
  const out=[];
  for(let i=0;i<pts.length;i+=step){
    const p=pts[i];
    if(!p||p[1]==null)continue;
    out.push([String(p[0]),clampHistValue(id,p[1])]);
  }
  // Always include the final point so "Now" lands at the chart's right edge.
  const lastRaw=pts[pts.length-1];
  if(lastRaw&&lastRaw[1]!=null){
    const lastLbl=String(lastRaw[0]);
    if(!out.length||out[out.length-1][0]!==lastLbl){
      out.push([lastLbl,clampHistValue(id,lastRaw[1])]);
    }
  }
  if(out.length>=3)return out;
  // Fall through to synthetic if downsampling collapsed the series.
}
// Synthetic fallback — used on first paint before _histCache loads, or for
// indicators the JSON doesn't carry.
const kf=buildDefaultHistKeyframes(id);
if(!kf)return null;
const out=[];
const QLBL=["Q1","Q2","Q3","Q4"];
for(let y=2005;y<=2025;y++){
for(let q=0;q<4;q++){
const t=y+q*0.25;
const lbl=q===0?String(y):`${QLBL[q]} ${y}`;
out.push([lbl,clampHistValue(id,piecewiseYearValue(t,kf))]);
}
}
// Q1 2026 (last full quarter before "Now" in Q2 2026).
out.push(["Q1 2026",clampHistValue(id,piecewiseYearValue(2026.0,kf))]);
out.push(["Now",clampHistValue(id,IND[id][6])]);
return out;
}

const STRESS_HIST_BANDS=[
{lo:0,hi:20,col:"#30d158",label:"LOW"},
{lo:20,hi:50,col:"#B8860B",label:"NORMAL"},
{lo:50,hi:75,col:"#ff9f0a",label:"ELEVATED"},
{lo:75,hi:100,col:"#ff453a",label:"EXTREME"},
];

// ── PORTFOLIO ───────────────────────────────────────────────────────────────
// Portfolio data is session-scoped in Track B2 — fetched from Supabase via
// `useUserPortfolio()` per signed-in user. Unauthenticated visitors get an
// empty array (zero-state render). The seed migration at
// `supabase/migrations/002_b2_seed_joe.sql` populates Joe's holdings; other
// users import via the onboarding paste-tickers / CSV flow (Track B2).

// ── WATCHLIST — names Joe is tracking but doesn't (yet) own ────────────────
// CRYPTO_WATCH lives only on the dashboard side because the Python scanner
// is equity-only and doesn't know how to pull intel for BTC/ETH.
// Equity tickers come from the scanner's portfolio/watchlist.csv via
// scanData.watchlist (single source of truth) — WATCHLIST_FALLBACK is used
// only when scanData hasn't loaded yet or doesn't include the watchlist key
// (e.g. older scan JSON pre-Task#9). Edit watchlist.csv in the trading-
// scanner repo to change the equity list.
const CRYPTO_WATCH=[
  {ticker:"BTCUSD",name:"Bitcoin",  theme:"Crypto · spot exposure via FBTC"},
  {ticker:"ETHUSD",name:"Ethereum", theme:"Crypto · spot exposure via ETHE"},
];
const WATCHLIST_FALLBACK=[
  {ticker:"NVDA", name:"NVIDIA Corp",          theme:"AI / Semis"},
  {ticker:"AMAT", name:"Applied Materials",    theme:"Semi capex"},
  {ticker:"CRWD", name:"CrowdStrike",          theme:"Cyber"},
  {ticker:"CAT",  name:"Caterpillar",          theme:"Cyclical / Capex"},
  {ticker:"MP",   name:"MP Materials",         theme:"Rare earth"},
  {ticker:"KTOS", name:"Kratos Defense",       theme:"Defense / drones"},
  {ticker:"AVAV", name:"AeroVironment",        theme:"Defense / drones"},
  {ticker:"ONDS", name:"Ondas Holdings",       theme:"Defense / drones"},
  {ticker:"LUNR", name:"Intuitive Machines",   theme:"Space / lunar"},
];

const ANALYSIS=`REGIME SUMMARY — APRIL 16, 2026

The risk-on rally that started with the US-Iran ceasefire has continued to build: VIX has compressed below the long-run average, HY-IG spreads have tightened ~55bps in a month, and financial conditions (ANFCI, STLFSI) have shifted to outright accommodative. The composite still reads Normal rather than Low — the easing has been fast but several Tier-1 risks have not retraced. CAPE remains at the second-most-extreme reading on record. Bank unrealized losses are still near recent highs and the BKX/SPX collapse this month is a fresh red flag.

WHAT CHANGED: volatility, credit spreads, financial conditions, and the dollar have all moved in a risk-on direction. Fed cut odds for year-end have repriced higher. Manufacturing (ISM) has inflected back into expansion. WHAT DIDN'T: valuation, term premium, real rates, and bank balance-sheet stress are structurally unchanged. Equity-credit correlation has actually risen — markets are now moving as a single risk factor.

KEY RISKS NEXT 4-8 WEEKS

Bank earnings: any negative surprise from regional banks would validate the BKX/SPX warning and send the composite back toward Elevated. Copper/Gold ratio is collapsing fast and diverging from ISM — historically the copper signal wins. Watch jobless claims for any sustained move above 250K and CPI for confirmation that the disinflation glide path is intact.`;

// ── CHART HELPERS ───────────────────────────────────────────────────────────
function makePath(pts){
return pts.map((p,i)=>`${i===0?"M":"L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

function ChartCore({data,labels,dir,sdP,crisisData,col,fmtFn,H,pL,pR,pT,pB,W,id,freq,windowKey,filteredPoints}){
const [hover,setHover]=useState(null);
const IW=W-pL-pR,IH=H-pT-pB;
// Q-frequency renders as discrete bars (one bar per quarterly print) instead
// of a line, since interpolation between quarterly points is misleading.
const isBars = freq === "Q";
// Guard: need at least 2 points to draw a line; no points → bail with an
// empty chart area rather than NaN/Infinity math crashes.
if(!data||data.length<2)return(
  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <text x={W/2} y={H/2} textAnchor="middle" fill="var(--text-dim)" fontSize="6" fontFamily="monospace">No data</text>
  </svg>
);
const vals=data.map(d=>d[1]).filter(v=>Number.isFinite(v));
if(vals.length<2)return(
  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <text x={W/2} y={H/2} textAnchor="middle" fill="var(--text-dim)" fontSize="6" fontFamily="monospace">No data</text>
  </svg>
);
const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
const xp=i=>pL+(i/(data.length-1))*IW;
// Always plot raw values with natural orientation: lower at bottom, higher at top.
// (Previously this flipped for dir="lw"/"nw" indicators, which made narratives
// like "37% below the historical mean" visually appear as a spike upward.)
const yp=v=>{const raw=(v-mn)/rng;return pT+(1-raw)*IH;};
const pts=data.map((d,i)=>[xp(i),yp(d[1])]);
const fullPath=makePath(pts);
const recentPath=makePath(pts.slice(-3));
const meanY=sdP?yp(sdP.mean):null;
// Normal-range green band — clamp to the visible chart area. If the band
// (mean ± 0.5 sd) falls entirely outside the visible y-range, fall back to
// rendering a thin band at the appropriate edge so the user always sees
// the "normal range" reference (Reg #3 — band must show on every indicator
// with a stats block, regardless of whether current values overshoot).
const hZone=sdP?(()=>{
const lo=sdP.mean-sdP.sd*0.5,hi=sdP.mean+sdP.sd*0.5;
const yLoRaw=yp(Math.min(lo,hi)),yHiRaw=yp(Math.max(lo,hi));
const yTop=Math.min(yLoRaw,yHiRaw);
const yBot=Math.max(yLoRaw,yHiRaw);
const clampedTop=Math.max(pT,Math.min(pT+IH,yTop));
const clampedBot=Math.max(pT,Math.min(pT+IH,yBot));
let y=clampedTop, h=clampedBot-clampedTop;
// Band entirely above or below the visible window — render a thin reference
// strip at the nearest edge so it's still indicated.
if(h<=0.5){
  if(yBot<pT){ y=pT; h=2; }
  else if(yTop>pT+IH){ y=pT+IH-2; h=2; }
  else { y=clampedTop; h=Math.max(h,1); }
}
return{y,h};
})():null;
const marks=crisisData.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year||l.startsWith(cm.year));
if(idx<0)return null;
return{...cm,x:xp(idx),y:yp(data[idx][1]),v:data[idx][1]};
}).filter(Boolean);
// Tick density driven by visible date span (Reg #4 — MAX zoom over ~21y was
// rendering ~20 overlapping year ticks). Use the filtered points' span if
// passed, otherwise fall back to point-count-based density.
let showLbl;
if(Array.isArray(filteredPoints)&&filteredPoints.length>=2){
  const startMs=new Date(String(filteredPoints[0][0])+"T00:00:00Z").getTime();
  const endMs=new Date(String(filteredPoints[filteredPoints.length-1][0])+"T00:00:00Z").getTime();
  const spanDays=(endMs-startMs)/(1000*60*60*24);
  // Target N ticks based on span, then dedupe duplicate label strings so
  // year-only labels (e.g. "2008","2008","2008") only render once each.
  let targetTicks;
  if(spanDays<=90)        targetTicks=6;     // < 90d → "MMM D" — keep dense
  else if(spanDays<=730)  targetTicks=8;     // 90d–2y → "MMM 'YY"
  else if(spanDays<=3650) targetTicks=8;     // 2–10y → year only
  else                    targetTicks=7;     // > 10y → 5–7 year ticks
  const stride=Math.max(1,Math.floor(data.length/targetTicks));
  const seen=new Set();
  showLbl=labels.map((l,i)=>{
    const isAnchor=(i===0||i===data.length-1||i%stride===0);
    if(!isAnchor)return false;
    if(seen.has(l))return false;
    seen.add(l);
    return true;
  });
}else{
  const tickEvery=data.length>40?16:4;
  showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%tickEvery===0);
}
const handleInteract=e=>{
e.stopPropagation();
const svg=e.currentTarget,rect=svg.getBoundingClientRect();
const cx=e.touches?e.touches[0].clientX:e.clientX;
const svgX=((cx-rect.left)/rect.width)*W;
let best=0,bestD=Infinity;
pts.forEach(([px],i)=>{const d=Math.abs(px-svgX);if(d<bestD){bestD=d;best=i;}});
setHover({x:pts[best][0],y:pts[best][1],label:labels[best],value:data[best][1]});
};
const ttX=hover?Math.min(Math.max(hover.x,pL+24),W-pR-24):0;
const ttY=hover?(hover.y<pT+20?hover.y+14:hover.y-14):0;
const lastPt=pts[pts.length-1];
return(
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"pan-y"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{hZone&&hZone.h>0&&<rect x={pL} y={hZone.y} width={IW} height={hZone.h} fill="rgba(34,197,94,0.08)"/>}
{meanY!=null&&<line x1={pL} y1={meanY} x2={pL+IW} y2={meanY} stroke="rgba(34,197,94,0.35)" strokeWidth="0.5" strokeDasharray="3,4"/>}
{sdP&&<text x={pL-3} y={meanY!=null?meanY+2:pT} textAnchor="end" fill="rgba(34,197,94,0.5)" fontSize="5.5" fontFamily="monospace">{fmtFn(sdP.mean)}</text>}
<text x={pL-3} y={pT+4} textAnchor="end" fill="var(--text-muted)" fontSize="6" fontFamily="monospace">{fmtFn(mx)}</text>
<text x={pL-3} y={pT+IH+2} textAnchor="end" fill="var(--text-muted)" fontSize="6" fontFamily="monospace">{fmtFn(mn)}</text>
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.6"/>
<text x={cm.x} y={pT-6} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace" fontWeight="700">{cm.label}</text>
<rect x={cm.x-14} y={cm.y-10} width={28} height={10} rx="2" fill="var(--surface-2)" stroke={cm.color} strokeWidth="0.5"/>
<text x={cm.x} y={cm.y-2} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace">{fmtFn(cm.v)}</text>
</g>
))}
{isBars ? (
  // Quarterly bars — one rect per print, anchored to the chart baseline at
  // pT+IH. Recent 3 bars use the live indicator color; older ones grey.
  (() => {
    const baseY = pT + IH;
    const barW = data.length > 1 ? Math.max(2, (IW / data.length) * 0.7) : 6;
    return data.map((d, i) => {
      const x = xp(i) - barW / 2;
      const y = yp(d[1]);
      const h = Math.max(1, baseY - y);
      const recent = i >= data.length - 3;
      return <rect key={i} x={x} y={y} width={barW} height={h}
        fill={recent ? col : "#505050"} opacity={recent ? 0.95 : 0.7} />;
    });
  })()
) : (
  <>
    <path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
    <circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill={col} stroke="var(--bg)" strokeWidth="1.5"/>
  </>
)}
<text x={lastPt[0]} y={lastPt[1]-7} textAnchor="middle" fill={col} fontSize="6" fontFamily="monospace" fontWeight="700">{fmtFn(data[data.length-1][1])}</text>
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-4} textAnchor="middle" fill="var(--text-dim)" fontSize="6" fontFamily="monospace">{l}</text>
))}
{hover&&(()=>{
const histCol=id?sdColor(sdScore(id,hover.value)):col;
return(
<g style={{pointerEvents:"none"}}>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="var(--text-2)" strokeWidth="0.5" opacity="0.4"/>
<circle cx={hover.x} cy={hover.y} r="4" fill="var(--bg)" stroke={histCol} strokeWidth="2"/>
<foreignObject x={ttX-38} y={ttY-14} width={76} height={28}>
<div xmlns="http://www.w3.org/1999/xhtml" style={{background:"var(--surface)",border:`1px solid ${histCol}`,borderRadius:6,padding:"3px 6px",textAlign:"center",boxShadow:"var(--shadow-sm)",fontFamily:"var(--font-mono)"}}>
<div style={{fontSize:11,fontWeight:800,color:histCol,lineHeight:1.1}}>{fmtFn(hover.value)}</div>
<div style={{fontSize:9,color:"var(--text-muted)",marginTop:1,lineHeight:1.1}}>{hover.label}</div>
</div>
</foreignObject>
</g>
);})()}
</svg>
);
}

// Time-range presets for the LongChart pills. `days=null` = show everything.
const WINDOW_PRESETS=[
  {key:"1M", label:"1M",  days:30},
  {key:"3M", label:"3M",  days:91},
  {key:"6M", label:"6M",  days:183},
  {key:"1Y", label:"1Y",  days:365},
  {key:"2Y", label:"2Y",  days:730},
  {key:"5Y", label:"5Y",  days:1825},
  {key:"10Y",label:"10Y", days:3650},
  {key:"MAX",label:"MAX", days:null},
];
// Default window chosen to make "1M ago / 3M ago" tick marks legible
// for each release cadence:
//   Daily     → 6M window  (roughly 126 trading days — narrative 1M/3M visible)
//   Weekly    → 1Y window  (52 points)
//   Monthly   → 2Y window  (24 points)
//   Quarterly → 5Y window  (20 points)
const DEFAULT_WINDOW_BY_FREQ={D:"6M",W:"1Y",M:"2Y",Q:"5Y"};

// Slice a [[iso_date, value], ...] series to a time window and return the
// [[display_label, value], ...] shape ChartCore expects.
function sliceHistoryToWindow(points,windowKey,customRange){
  if(!points||!points.length)return{data:[],labels:[]};
  const lastIso=points[points.length-1][0];
  const lastDt=new Date(lastIso+"T00:00:00Z");
  let startIso=null,endIso=lastIso;
  if(windowKey==="CUSTOM"){
    if(!customRange?.start||!customRange?.end)return{data:[],labels:[]};
    startIso=customRange.start;
    endIso=customRange.end;
  }else{
    const p=WINDOW_PRESETS.find(p=>p.key===windowKey);
    if(p&&p.days!=null){
      const s=new Date(lastDt);s.setUTCDate(s.getUTCDate()-p.days);
      startIso=s.toISOString().slice(0,10);
    }
  }
  const filt=points.filter(([d])=>(!startIso||d>=startIso)&&(!endIso||d<=endIso));
  if(!filt.length)return{data:[],labels:[]};
  const spanDays=(new Date(filt[filt.length-1][0])-new Date(filt[0][0]))/(1000*60*60*24);
  const fmtLbl=(iso)=>{
    const d=new Date(iso+"T00:00:00Z");
    const mo=d.toLocaleDateString("en-US",{month:"short",timeZone:"UTC"});
    const day=d.getUTCDate();
    const yr=d.getUTCFullYear();
    if(spanDays<=400)return `${mo} ${day}`;
    if(spanDays<=2500)return `${mo} '${String(yr).slice(2)}`;
    return String(yr);
  };
  const data=filt.map(([d,v])=>[fmtLbl(d),v]);
  const labels=data.map(x=>x[0]);
  return{data,labels,filtered:filt};
}

function LongChart({id,col}){
const [hist,setHist]=useState(_histCache);
const freq=IND_FREQ[id]||"D";
const [windowKey,setWindowKey]=useState(DEFAULT_WINDOW_BY_FREQ[freq]||"1Y");
const [customRange,setCustomRange]=useState({start:"",end:""});
const [showCustom,setShowCustom]=useState(false);
useEffect(()=>{
  if(!_histCache){loadIndicatorHistory().then(setHist);}
},[]);
// When id changes (user opened a different indicator modal), reset window
// to the frequency-appropriate default so the chart makes sense on first
// view. Custom range stays blank unless explicitly re-entered.
useEffect(()=>{
  setWindowKey(DEFAULT_WINDOW_BY_FREQ[freq]||"1Y");
  setShowCustom(false);
  setCustomRange({start:"",end:""});
},[id,freq]);
const sd=SD[id];
const unit=IND[id]?.[4]||"",dec=IND[id]?.[5]??1;
const fmt=v=>{
if(unit==="K")return`${Math.round(v)}K`;
if(unit==="bps")return`${Math.round(v)}bps`;
if(unit==="z-score")return(v>0?"+":"")+Number(v).toFixed(dec);
if(["% T1","% 3yr","% YoY","%"].includes(unit))return`${Number(v).toFixed(dec)}%`;
return Number(v).toFixed(dec);
};
// Prefer real history when available; fall back to the synthetic SD-interpolated
// quarterly series so indicators without indicator_history.json coverage still
// render something.
const hasReal=hist&&hist[id]&&Array.isArray(hist[id].points)&&hist[id].points.length>1;
let data,labels,freqOfSeries,minDate,maxDate;
if(hasReal){
  const sliced=sliceHistoryToWindow(hist[id].points,windowKey,customRange);
  data=sliced.data;
  labels=sliced.labels;
  freqOfSeries=hist[id].freq||freq;
  minDate=hist[id].points[0][0];
  maxDate=hist[id].points[hist[id].points.length-1][0];
}else{
  const syn=getIndicatorHistSeries(id);
  if(!syn||!syn.length){
    return(
      <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",padding:"14px 0"}}>
        No historical data available.
      </div>
    );
  }
  data=syn;
  labels=syn.map(d=>String(d[0]));
  freqOfSeries=freq;
}

const pillBase={
  padding:"3px 9px",fontSize:10,fontFamily:"var(--font-mono)",
  fontWeight:700,letterSpacing:"0.04em",border:"1px solid var(--border)",
  borderRadius:3,cursor:"pointer",background:"var(--surface-2)",
  color:"var(--text-muted)",userSelect:"none",
};
const pillOn={
  ...pillBase,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)",
};

const pickWindow=(k)=>{setWindowKey(k);setShowCustom(false);};

// Pretty frequency label next to the header
const freqLabel={D:"DAILY",W:"WEEKLY",M:"MONTHLY",Q:"QUARTERLY"}[freqOfSeries]||"";

return(
<div style={{marginBottom:10}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6}}>
  <div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>
    HISTORY{freqLabel?` · ${freqLabel}`:""}
    <span style={{color:"rgba(34,197,94,0.7)",marginLeft:6}}>▬ normal range</span>
  </div>
  <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
    {WINDOW_PRESETS.map(p=>(
      <button
        key={p.key} type="button"
        style={(!showCustom&&windowKey===p.key)?pillOn:pillBase}
        onClick={(e)=>{e.stopPropagation();pickWindow(p.key);}}
      >{p.label}</button>
    ))}
    <button
      type="button"
      style={showCustom?pillOn:pillBase}
      onClick={(e)=>{e.stopPropagation();setShowCustom(s=>!s);if(!showCustom)setWindowKey("CUSTOM");}}
      title="Pick a custom date range"
    >CUSTOM</button>
  </div>
</div>
{showCustom&&hasReal&&(
  <div style={{
    display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",
    marginBottom:6,padding:"6px 8px",background:"var(--surface-2)",
    border:"1px solid var(--border)",borderRadius:4,
    fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-muted)",
  }}>
    <span>Range:</span>
    <input
      type="date" value={customRange.start||""}
      min={minDate} max={maxDate}
      onChange={e=>{setCustomRange(r=>({...r,start:e.target.value}));setWindowKey("CUSTOM");}}
      style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"2px 4px",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)"}}
    />
    <span>→</span>
    <input
      type="date" value={customRange.end||""}
      min={minDate} max={maxDate}
      onChange={e=>{setCustomRange(r=>({...r,end:e.target.value}));setWindowKey("CUSTOM");}}
      style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"2px 4px",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)"}}
    />
    <span style={{color:"var(--text-dim)"}}>(available: {minDate} → {maxDate})</span>
  </div>
)}
{data.length<2?(
  <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",padding:"18px 0",textAlign:"center"}}>
    No data in this window. Try a wider range.
  </div>
):(
  <ChartCore data={data} labels={labels} dir={sd?.dir} sdP={sd} crisisData={[]}
  col={col} fmtFn={fmt} H={100} pL={28} pR={8} pT={18} pB={22} W={500} id={id}
  freq={freqOfSeries} windowKey={windowKey}
  filteredPoints={hasReal ? sliceHistoryToWindow(hist[id].points,windowKey,customRange).filtered : null}/>
)}
</div>
);
}

// Timeframe presets for the composite history chart. COMP_HIST is quarterly
// (Q1 '05 → Q1 '26) with one live tail entry ("Apr 15"), so we slice by count
// from the tail: n=quarters+1 to include the live point. MAX = full dataset
// (default — preserves the long-term GFC/COVID/Rate-Shock context on open).
const COMP_HIST_WINDOWS=[
{key:"1Y", label:"1Y", n:5},
{key:"3Y", label:"3Y", n:13},
{key:"5Y", label:"5Y", n:21},
{key:"10Y",label:"10Y",n:41},
{key:"MAX",label:"MAX",n:null},
];

function CompHistChart(){
const col=CONV.color;
const [windowKey,setWindowKey]=useState("MAX");
const [hover,setHover]=useState(null);
const win=COMP_HIST_WINDOWS.find(w=>w.key===windowKey)||COMP_HIST_WINDOWS[4];
const data=win.n?COMP_HIST.slice(-win.n):COMP_HIST;
const labels=data.map(d=>String(d[0]));
const W=500,H=130,pL=28,pR=48,pT=18,pB=24;
const IW=W-pL-pR,IH=H-pT-pB;
const vals=data.map(d=>d[1]);
// S&P scale — padded 10% above/below for visual breathing room. Slice from
// the tail so SP500_HIST aligns index-for-index with the sliced COMP_HIST.
const spVals=win.n?SP500_HIST.slice(-win.n):SP500_HIST.slice(0,data.length);
const spMin=Math.floor(Math.min(...spVals)*0.92/500)*500;
const spMax=Math.ceil(Math.max(...spVals)*1.05/500)*500;
const xp=i=>pL+(i/(data.length-1))*IW;
const yp=v=>pT+(1-v/100)*IH;
const ypSP=v=>pT+(1-(v-spMin)/(spMax-spMin))*IH;
const pts=data.map((d,i)=>[xp(i),yp(d[1])]);
const spPts=spVals.map((v,i)=>[xp(i),ypSP(v)]);
const fullPath=makePath(pts);
const recentPath=makePath(pts.slice(-5));
const spPath=makePath(spPts);
const marks=COMP_CRISES.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year);
if(idx<0)return null;
return{...cm,x:xp(idx),y:yp(vals[idx]),v:vals[idx]};
}).filter(Boolean);
const showLbl=labels.map(l=>l.startsWith("Q1")||l==="Apr 15");
const xAxisLabel=l=>l.startsWith("Q1")?("'"+l.slice(4)):l;
const lastPt=pts[pts.length-1];
const lastSP=spPts[spPts.length-1];
// Right-axis S&P labels at rounded levels
const spTicks=[1000,2000,3000,4000,5000,6000,7000].filter(v=>v>=spMin&&v<=spMax);
const handleInteract=e=>{
e.stopPropagation();
const svg=e.currentTarget,rect=svg.getBoundingClientRect();
const cx=e.touches?e.touches[0].clientX:e.clientX;
const svgX=((cx-rect.left)/rect.width)*W;
let best=0,bestD=Infinity;
pts.forEach(([px],i)=>{const d=Math.abs(px-svgX);if(d<bestD){bestD=d;best=i;}});
setHover({x:pts[best][0],ys:pts[best][1],ysp:spPts[best][1],label:labels[best],stress:vals[best],sp:spVals[best]});
};
const ttX=hover?Math.min(Math.max(hover.x,pL+30),W-pR-30):0;
const ttY=hover?(hover.ys<pT+28?hover.ys+18:hover.ys-18):0;
const SP_COL="#60a5fa";
return(
<div>
{/* Header row: legend (left) + timeframe pills (right) */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,paddingLeft:4,paddingRight:4,flexWrap:"wrap",gap:6}}>
<div style={{display:"flex",gap:14}}>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<div style={{width:16,height:2.5,borderRadius:2,background:col}}/>
<span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>Composite Stress (L)</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<div style={{width:16,height:2.5,borderRadius:2,background:SP_COL,opacity:0.8}}/>
<span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>S&P 500 (R)</span>
</div>
</div>
<div data-testid="comp-hist-timeframe" style={{display:"flex",gap:4,flexWrap:"wrap"}}>
{COMP_HIST_WINDOWS.map(w=>{
const on=w.key===windowKey;
return(
<button key={w.key} type="button" onClick={()=>setWindowKey(w.key)}
style={{padding:"3px 9px",fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,letterSpacing:"0.04em",border:"1px solid "+(on?"var(--accent)":"var(--border)"),borderRadius:3,cursor:"pointer",background:on?"var(--accent)":"var(--surface-2)",color:on?"#fff":"var(--text-muted)",userSelect:"none"}}>
{w.label}
</button>
);
})}
</div>
</div>
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"pan-y"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{/* Stress band backgrounds */}
{STRESS_HIST_BANDS.map(b=>(
<rect key={b.label} x={pL} y={yp(b.hi)} width={IW} height={yp(b.lo)-yp(b.hi)} fill={b.col} opacity="0.06"/>
))}
{/* Grid lines */}
{[0,25,50,75,100].map(v=>(
<g key={v}>
<line x1={pL} y1={yp(v)} x2={pL+IW} y2={yp(v)} stroke="var(--border)" strokeWidth="0.5"/>
<text x={pL-4} y={yp(v)+3} textAnchor="end" fill="#a0a0a0" fontSize="6" fontFamily="monospace">{v}</text>
</g>
))}
{/* Right axis — S&P levels */}
{spTicks.map(v=>(
<text key={v} x={pL+IW+4} y={ypSP(v)+3} fill="#3b82f688" fontSize="6" fontFamily="monospace">{v>=1000?(v/1000)+"k":v}</text>
))}
{/* Crisis markers */}
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.5"/>
<text x={cm.x} y={pT-5} textAnchor="middle" fill={cm.color} fontSize="6" fontFamily="monospace" fontWeight="700">{cm.label}</text>
</g>
))}
{/* S&P line (behind stress) */}
<path d={spPath} fill="none" stroke={SP_COL} strokeWidth="1.5" strokeLinejoin="round" opacity="0.65"/>
<circle cx={lastSP[0]} cy={lastSP[1]} r="3" fill={SP_COL} stroke="var(--bg)" strokeWidth="1.2" opacity="0.9"/>
<text x={lastSP[0]+4} y={lastSP[1]+3} fill={SP_COL} fontSize="6" fontFamily="monospace" opacity="0.85">{(spVals[spVals.length-1]/1000).toFixed(1)}k</text>
{/* Stress line */}
<path d={fullPath} fill="none" stroke="#404040" strokeWidth="1.2" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill={col} stroke="var(--bg)" strokeWidth="1.5"/>
<text x={lastPt[0]} y={lastPt[1]-9} textAnchor="middle" fill={col} fontSize="7" fontFamily="monospace" fontWeight="800">{COMP100}</text>
{/* X-axis labels */}
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-5} textAnchor="middle" fill="#5a5a5a" fontSize="6" fontFamily="monospace">{xAxisLabel(l)}</text>
))}
{/* Hover crosshair */}
{hover&&(()=>{
const stressCol=sdColor(((hover.stress/100)*5)-2);
return(
<g style={{pointerEvents:"none"}}>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="var(--text-2)" strokeWidth="0.5" opacity="0.4"/>
<circle cx={hover.x} cy={hover.ys} r="3.5" fill="var(--bg)" stroke={stressCol} strokeWidth="2"/>
<circle cx={hover.x} cy={hover.ysp} r="3.5" fill="var(--bg)" stroke={SP_COL} strokeWidth="2"/>
<foreignObject x={ttX-44} y={ttY-22} width={88} height={44}>
<div xmlns="http://www.w3.org/1999/xhtml" style={{background:"var(--surface)",border:`1px solid ${stressCol}`,borderRadius:6,padding:"4px 6px",textAlign:"center",boxShadow:"var(--shadow-sm)",fontFamily:"var(--font-mono)"}}>
<div style={{fontSize:9,color:"var(--text-muted)",lineHeight:1.1,marginBottom:2}}>{hover.label}</div>
<div style={{fontSize:11,fontWeight:800,color:stressCol,lineHeight:1.1}}>Stress {hover.stress}</div>
<div style={{fontSize:10,color:SP_COL,lineHeight:1.1,marginTop:1}}>SPX {hover.sp?.toLocaleString()}</div>
</div>
</foreignObject>
</g>
);})()}
</svg>
</div>
);
}

function IndStressChart({id,col,compact}){
// Plots RAW values with natural orientation (higher raw = top of chart) so
// this compact tile chart reads the same way as the modal LongChart. For
// "lower-is-worse" indicators, the stress bands naturally land at the
// bottom (where low raw values live); for "higher-is-worse", bands land
// at the top. Either way, a line trending down is visually a line trending
// down — matches the narrative copy.
const data=getIndicatorHistSeries(id);
if(!data||data.length<3)return null;
const sp=SD[id];
if(!sp)return null;
const unit=IND[id]?.[4]||"",dec=IND[id]?.[5]??1;
const fmtRaw=v=>{
if(v==null)return"—";
if(unit==="K")return`${Math.round(v)}K`;
if(unit==="bps")return`${Math.round(v)}bps`;
if(unit==="z-score")return(v>0?"+":"")+Number(v).toFixed(dec);
if(["% T1","% 3yr","% YoY","%"].includes(unit))return`${Number(v).toFixed(dec)}%`;
return Number(v).toFixed(dec);
};
const labels=data.map(d=>String(d[0]));
const rawVals=data.map(d=>d[1]).filter(v=>Number.isFinite(v));
// Convert stress-100 score back to raw value for a given indicator.
// sdTo100(sdScore) = ((sdScore+1)/4)*100  ⇒  sdScore = s100/25 − 1
// For dir="hw": raw = mean + sdScore*sd
// For dir="lw"/"nw": raw = mean − sdScore*sd  (inverse — bands flip)
const stressToRaw=(s100)=>{
  const sdSc=(s100/100)*4-1;
  return (sp.dir==="hw") ? sp.mean+sdSc*sp.sd : sp.mean-sdSc*sp.sd;
};
// Actual indicator-specific band boundaries in raw space
const bandsRaw=STRESS_HIST_BANDS.map(b=>{
  const a=stressToRaw(b.lo),c=stressToRaw(b.hi);
  return {...b,rawLo:Math.min(a,c),rawHi:Math.max(a,c)};
});
// Chart range: widen to include the mean band + a buffer so the line never
// hugs an edge, but don't blow out range for extremely long series.
const dataMn=Math.min(...rawVals),dataMx=Math.max(...rawVals);
const meanRaw=sp.mean;
const yMn=Math.min(dataMn,meanRaw-sp.sd*2);
const yMx=Math.max(dataMx,meanRaw+sp.sd*2);
const rng=yMx-yMn||1;
const W=compact?320:500,H=compact?86:115,pL=compact?22:24,pR=compact?38:44,pT=compact?11:14,pB=compact?18:22;
const IW=W-pL-pR,IH=H-pT-pB;
const [hover,setHover]=useState(null);
const xp=i=>pL+(i/(data.length-1))*IW;
// Natural orientation: higher raw = top (y small), lower = bottom (y large)
const yp=v=>pT+(1-(v-yMn)/rng)*IH;
const pts=data.map((d,i)=>[xp(i),yp(d[1])]);
const fullPath=makePath(pts);
const recentPath=makePath(pts.slice(-3));
const marks=COMP_CRISES.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year);
if(idx<0)return null;
return{...cm,x:xp(idx),y:yp(data[idx][1]),raw:data[idx][1]};
}).filter(Boolean);
const tickEvery=data.length>40?16:4;
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%tickEvery===0);
const lastPt=pts[pts.length-1];
const handleInteract=e=>{
e.stopPropagation();
const svg=e.currentTarget,rect=svg.getBoundingClientRect();
const cx=e.touches?e.touches[0].clientX:e.clientX;
const svgX=((cx-rect.left)/rect.width)*W;
let best=0,bestD=Infinity;
pts.forEach(([px],i)=>{const d0=Math.abs(px-svgX);if(d0<bestD){bestD=d0;best=i;}});
const raw=data[best][1];
const s=sdScore(id,raw);
const st=s==null?null:sdTo100(s);
setHover({x:pts[best][0],y:pts[best][1],label:labels[best],raw,st});
};
const ttX=hover?Math.min(Math.max(hover.x,pL+28),W-pR-28):0;
const ttY=hover?(hover.y<pT+22?hover.y+16:hover.y-16):0;
return(
<div onClick={e=>e.stopPropagation()}>
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"pan-y"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{/* Stress-band zones translated to raw-value y-coords. Clipped to visible
    chart range so off-chart bands don't render outside the plot area. */}
{bandsRaw.map(b=>{
const yTop=yp(Math.min(b.rawHi,yMx));
const yBot=yp(Math.max(b.rawLo,yMn));
const h=yBot-yTop;
if(h<=0)return null;
return(
<g key={b.label}>
<rect x={pL} y={yTop} width={IW} height={h} fill={b.col} opacity="0.07"/>
<text x={pL+IW+2} y={yTop+h/2+2} fill={b.col} fontSize={compact?4.5:5} fontFamily="monospace" opacity="0.7">{b.label}</text>
</g>
);
})}
{/* Mean dashed line */}
<line x1={pL} y1={yp(meanRaw)} x2={pL+IW} y2={yp(meanRaw)} stroke="rgba(34,197,94,0.35)" strokeWidth="0.5" strokeDasharray="3,4"/>
<text x={pL-3} y={yp(meanRaw)+2} textAnchor="end" fill="rgba(34,197,94,0.5)" fontSize={compact?5:5.5} fontFamily="monospace">{fmtRaw(meanRaw)}</text>
{/* Raw-value tick marks at top and bottom of the range */}
<text x={pL-3} y={pT+4} textAnchor="end" fill="var(--text-dim)" fontSize={compact?5:6} fontFamily="monospace">{fmtRaw(yMx)}</text>
<text x={pL-3} y={pT+IH+2} textAnchor="end" fill="var(--text-dim)" fontSize={compact?5:6} fontFamily="monospace">{fmtRaw(yMn)}</text>
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.6"/>
<text x={cm.x} y={pT-3} textAnchor="middle" fill={cm.color} fontSize={compact?5:5.5} fontFamily="monospace" fontWeight="700">{cm.label}</text>
<rect x={cm.x-(compact?11:10)} y={cm.y-9} width={compact?22:20} height={9} rx="2" fill="var(--surface-2)" stroke={cm.color} strokeWidth="0.5"/>
<text x={cm.x} y={cm.y-2} textAnchor="middle" fill={cm.color} fontSize={compact?5:5.5} fontFamily="monospace">{fmtRaw(cm.raw)}</text>
</g>
))}
<path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r={compact?3.5:4} fill={col} stroke="var(--bg)" strokeWidth="1.5"/>
<text x={lastPt[0]} y={lastPt[1]-(compact?6:7)} textAnchor="middle" fill={col} fontSize={compact?6:7} fontFamily="monospace" fontWeight="800">{fmtRaw(data[data.length-1][1])}</text>
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-4} textAnchor="middle" fill="var(--text-dim)" fontSize={compact?5:6} fontFamily="monospace">{l}</text>
))}
{hover&&(()=>{
const histCol=hover.st!=null?sdColor(((hover.st/100)*5)-2):col;
return(
<g style={{pointerEvents:"none"}}>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="var(--text-2)" strokeWidth="0.5" opacity="0.4"/>
<circle cx={hover.x} cy={hover.y} r={compact?3.5:4} fill="var(--bg)" stroke={histCol} strokeWidth="2"/>
<foreignObject x={ttX-50} y={ttY-22} width={100} height={44}>
<div xmlns="http://www.w3.org/1999/xhtml" style={{background:"var(--surface)",border:`1px solid ${histCol}`,borderRadius:6,padding:"4px 6px",textAlign:"center",boxShadow:"var(--shadow-sm)",fontFamily:"var(--font-mono)"}}>
<div style={{fontSize:9,color:"var(--text-muted)",lineHeight:1.1,marginBottom:2}}>{hover.label}</div>
<div style={{fontSize:11,fontWeight:800,color:histCol,lineHeight:1.1}}>{fmtRaw(hover.raw)}</div>
{hover.st!=null&&<div style={{fontSize:9,color:"var(--text-muted)",lineHeight:1.1,marginTop:2}}>Stress: <span style={{color:histCol,fontWeight:700}}>{Math.round(hover.st)}</span></div>}
</div>
</foreignObject>
</g>
);})()}
</svg>
</div>
);
}

function Gauge({score,onClick}){
const conv=getConv(score),col=conv.color,n=sdTo100(score);
const lo=-1,hi=3,norm=Math.max(0,Math.min(1,(score-lo)/(hi-lo)));
const r=56,cx=74,cy=74;
const toRad=d=>d*Math.PI/180;
const pt=d=>[cx+r*Math.cos(toRad(d)),cy+r*Math.sin(toRad(d))];
const start=-215,sweep=250;
const [sx,sy]=pt(start),[ex,ey]=pt(start+sweep);
const fS=sweep*norm,[nx,ny]=pt(start+fS);
const la=fS>180?1:0;
const [fx,fy]=pt(start+fS);
return(
<div onClick={onClick} style={{display:"flex",flexDirection:"column",alignItems:"center",cursor:onClick?"pointer":"default"}}>
<svg width="148" height="120" viewBox="0 0 148 120">
<path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="#151515" strokeWidth="11" strokeLinecap="round"/>
{norm>0.01&&<path d={`M ${sx} ${sy} A ${r} ${r} 0 ${la} 1 ${fx} ${fy}`} fill="none" stroke={col} strokeWidth="11" strokeLinecap="round" opacity="0.9"/>}
{[0.2,0.4,0.6,0.8].map(t=>{const [tx,ty]=pt(start+sweep*t);return(<circle key={t} cx={tx} cy={ty} r="2.5" fill="var(--bg)"/>);})}
<line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
<circle cx={cx} cy={cy} r="3.5" fill="white" opacity="0.6"/>
<text x={cx} y={90} textAnchor="middle" fill={col} fontSize="26" fontWeight="800" fontFamily="monospace">{n}</text>
<text x={cx} y={104} textAnchor="middle" fill={col} fontSize="10" fontFamily="monospace">{conv.label}</text>
<text x={cx} y={116} textAnchor="middle" fill="var(--text-2)" fontSize="7" fontFamily="monospace">COMPOSITE STRESS</text>
</svg>
{onClick&&<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginTop:1}}>tap for history</div>}
</div>
);
}

function RangeBar({sMin,sMax,sp,cur,col}){
if(!sp||sMin==null)return null;
const range=sMax-sMin||1;
const tp=v=>Math.max(0,Math.min(100,((v-sMin)/range)*100));
// Natural orientation: lower values on the left, higher on the right.
// (Previously flipped for dir="lw"/"nw" indicators, which contradicted the
// min/max labels rendered underneath the bar.)
const hLo=sp.mean-sp.sd*0.5,hHi=sp.mean+sp.sd*0.5;
const adjL=tp(hLo),adjH=tp(hHi);
const adjCur=tp(cur);
const adjAvg=tp(sp.mean);
return(
<div style={{position:"relative",height:14,background:"#151515",borderRadius:3,marginBottom:4}}>
<div style={{position:"absolute",left:`${Math.min(adjL,adjH)}%`,width:`${Math.abs(adjH-adjL)}%`,top:0,bottom:0,background:"rgba(34,197,94,0.12)",borderLeft:"1px solid rgba(34,197,94,0.3)",borderRight:"1px solid rgba(34,197,94,0.3)"}}/>
<div style={{position:"absolute",left:`${adjAvg}%`,top:0,bottom:0,width:1,background:"rgba(34,197,94,0.5)",transform:"translateX(-50%)"}}/>
<div style={{position:"absolute",left:`${adjCur}%`,top:-1,bottom:-1,width:3,background:col,borderRadius:2,transform:"translateX(-50%)",boxShadow:`0 0 5px ${col}`}}/>
</div>
);
}

function ConvictionMiniBar({s}){
const fillW=s==null?0:sdTo100(s);
const col=sdColor(s);
return(
<div style={{position:"relative",marginTop:4}}>
<div style={{height:8,background:"var(--border)",borderRadius:4,overflow:"hidden",position:"relative"}}>
{CONVICTION.map(c=>{
const w=c.range[1]>50?25:c.range[1]-Math.max(0,c.range[0]);
const l=Math.max(0,c.range[0])/100*100;
return <div key={c.level} style={{position:"absolute",left:`${l}%`,width:`${w}%`,height:"100%",background:c.color,opacity:0.2}}/>;
})}
<div style={{position:"absolute",left:0,top:0,height:"100%",width:`${fillW}%`,background:col,borderRadius:4,opacity:0.9}}/>
</div>
<div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
{CONVICTION.map(c=>(<div key={c.level} style={{fontSize:5,color:"var(--text-muted)",fontFamily:"monospace",textAlign:"center",flex:1,lineHeight:1.1}}>{c.label}</div>))}
</div>
</div>
);
}

// Periods per frequency. Each entry is {label, days}. Daily indicators look
// back 30/91/183/365 trading-ish days; weekly grows in 1W/1M/3M/12M jumps;
// monthly in 1M/3M/6M/1Y; quarterly in 1Q/2Q/1Y/3Y. Labels match the
// cadence so a quarterly series doesn't mis-advertise a "1M ago" value that
// was really the same quarterly print carried over. Restored from PR #15
// after PR #23 stealth regression (bundled with Items 5b/9/18 restore).
const TREND_PERIODS={
  D:[{label:"1M",days:30},{label:"3M",days:91},{label:"6M",days:183},{label:"12M",days:365}],
  W:[{label:"1W",days:7},{label:"1M",days:30},{label:"3M",days:91},{label:"12M",days:365}],
  M:[{label:"1M",days:30},{label:"3M",days:91},{label:"6M",days:183},{label:"1Y",days:365}],
  Q:[{label:"Prior Q",days:91},{label:"2Q",days:183},{label:"1Y",days:365},{label:"3Y",days:1095}],
};
// Find the point in `points` (iso-sorted ascending) whose date is closest to
// (lastDate - days). Returns [iso, val] or null if nothing within tolerance.
function _pointAtOffset(points,days){
  if(!points||points.length<2)return null;
  const lastIso=points[points.length-1][0];
  const lastDt=new Date(lastIso+"T00:00:00Z").getTime();
  const targetMs=lastDt-days*86400000;
  // Binary-search ascending array for the nearest date ≤ target.
  let lo=0,hi=points.length-1,idx=0;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    const midMs=new Date(points[mid][0]+"T00:00:00Z").getTime();
    if(midMs<=targetMs){idx=mid;lo=mid+1;}else{hi=mid-1;}
  }
  const pt=points[idx];
  return pt?[pt[0],pt[1]]:null;
}
// "2025-12-31" → "Dec 31" (if current year) or "Dec 31 '25" (otherwise).
// Compact form used on TrendPill date-stamps (Item 9c).
function _fmtOffsetDate(iso){
  try{
    const d=new Date(iso+"T00:00:00Z");
    const mo=d.toLocaleDateString("en-US",{month:"short",timeZone:"UTC"});
    const day=d.getUTCDate();
    const yr=d.getUTCFullYear();
    const curYr=new Date().getUTCFullYear();
    return yr===curYr?`${mo} ${day}`:`${mo} ${day} '${String(yr).slice(-2)}`;
  }catch{return"";}
}
function IndicatorTrendPills({id,d}){
// Freq-aware trend strip: pill label + historical value at that offset.
// Prefers real history from indicator_history.json via _histCache; falls
// back to the hardcoded IND[] d[7..10] triples if the cache isn't loaded.
// Item 9c — each pill also carries the actual observation date it resolved
// to so the user can see whether "3M ago" is a March print or an older
// monthly release (and knows the offset is approximate, not exact).
const freq=IND_FREQ[id]||"D";
const periods=TREND_PERIODS[freq]||TREND_PERIODS.D;
const histEntry=_histCache&&_histCache[id];
const points=histEntry&&Array.isArray(histEntry.points)?histEntry.points:null;
const rows=periods.map((p,i)=>{
  let v=null,date=null;
  if(points){
    const pt=_pointAtOffset(points,p.days);
    if(pt){v=pt[1];date=pt[0];}
  }
  // Fallback to the old hardcoded 4-tuple only when history isn't available
  // and the period index lines up with the old d[7..10] layout. No date
  // shown in the fallback path — we don't know when the hardcoded number
  // was actually observed.
  if(v==null&&i<4)v=d[7+i]??null;
  return[p.label,v,date];
});
return(
<div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
{rows.map(([lbl,v,date])=>{
if(v==null)return null;
const cT=sdTextColor(sdScore(id,v));
return(
<div key={lbl} style={{flex:1,minWidth:56,background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:5,padding:"5px 6px",textAlign:"center"}}>
<div style={{fontSize:9,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:2,letterSpacing:"0.06em"}}>{lbl}</div>
<div style={{fontSize:14,fontWeight:800,color:cT,fontFamily:"monospace"}}>{fmtV(id,v)}</div>
{date&&<div style={{fontSize:8,color:"var(--text-dim)",fontFamily:"monospace",marginTop:1,letterSpacing:"0.02em"}}>{_fmtOffsetDate(date)}</div>}
</div>
);
})}
</div>
);
}

function IndicatorCard({id,onOpen}){
const d=IND[id];if(!d)return null;
const [label,sub,cat,tier,,,cur,,,,,,desc,]=d;
const catCol=CATS[cat]?.color||"#6b7280";
const s=sdScore(id,cur);
const col=sdColor(s);
const colT=sdTextColor(s);
const tierCol=tier===1?"var(--yellow-text)":tier===2?"#94a3b8":"#4b5563";
const tierBorder=tier===1?"#B8860B":tier===2?"#94a3b8":"#4b5563";
return(
<div id={`card-${id}`} onClick={()=>onOpen(id)} className="indicator-card"
style={{background:"var(--surface)",border:`1px solid var(--border-faint)`,borderRadius:8,padding:"12px 14px",cursor:"pointer",transition:"transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)",position:"relative"}}
onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="var(--shadow-md)";e.currentTarget.style.borderColor=col+"55";}}
onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";e.currentTarget.style.borderColor="var(--border-faint)";}}
>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5,gap:6}}>
<div style={{minWidth:0,flex:1}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
<div style={{width:3,height:12,background:catCol,borderRadius:1,flexShrink:0}}/>
<span style={{fontSize:14,fontWeight:700,color:"var(--text)",fontFamily:"monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flex:"0 1 auto"}}>{label}</span>
{desc&&<span onClick={e=>e.stopPropagation()} style={{flexShrink:0}}><InfoTip term={label} def={desc} size={11}/></span>}
<Tip label={`TIER ${tier}`} def={tier===1?"Tier 1 — most market-sensitive, highest weight (1.5×) in the composite stress score.":tier===2?"Tier 2 — important but less real-time, weighted 1.2× in the composite.":"Tier 3 — structural/context indicator, weighted 1.0× in the composite."}>
<span style={{fontSize:11,color:tierCol,border:`1px solid ${tierBorder}44`,borderRadius:2,padding:"1px 5px",fontFamily:"monospace",flexShrink:0,cursor:"help"}}>T{tier}</span>
</Tip>
<Tip label={IND_FREQ[id]==="D"?"DAILY":IND_FREQ[id]==="W"?"WEEKLY":IND_FREQ[id]==="M"?"MONTHLY":IND_FREQ[id]==="Q"?"QUARTERLY":""} def={IND_FREQ[id]==="D"?"Daily release — updated every trading day.":IND_FREQ[id]==="W"?"Weekly release — typically published Thursday or Friday morning.":IND_FREQ[id]==="M"?"Monthly release — published in the first or second week after month-end.":IND_FREQ[id]==="Q"?"Quarterly release — published ~6 weeks after quarter-end. There is no true intra-quarter value.":"Release frequency unknown."}>
<span style={{fontSize:11,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:2,padding:"1px 5px",fontFamily:"monospace",flexShrink:0,cursor:"help"}}>{IND_FREQ[id]||"—"}</span>
</Tip>
</div>
<div style={{fontSize:13,color:"var(--text-muted)",marginLeft:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>
<div style={{fontSize:11,color:"var(--text-dim)",marginLeft:9,fontFamily:"monospace",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><FreshnessDot indicatorId={id} asOfIso={AS_OF_ISO[id]} cadence={IND_FREQ[id]}/><span>Data as of {AS_OF[id]||"—"}</span><StalePill id={id} compact={true}/></div>
</div>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
<span style={{fontSize:15,fontWeight:800,color:colT,fontFamily:"monospace"}}>{fmtV(id,cur)}</span>
</div>
</div>
<div style={{marginBottom:6}}>
<span style={{fontSize:14,fontWeight:700,color:colT,fontFamily:"monospace"}}>{s!=null?sdLabel(s):"No Data"}</span>
<div style={{marginTop:8,width:"100%"}}>
<IndStressChart id={id} col={col} compact/>
</div>
<IndicatorTrendPills id={id} d={d}/>
</div>
</div>
);
}

// ── INDICATOR MODAL — full detail in a centered sheet ─────────────────────
function IndicatorModal({id,onClose,onPrev,onNext,hasPrev,hasNext}){
useEffect(()=>{
  const onKey=e=>{
    if(e.key==="Escape")onClose();
    else if(e.key==="ArrowLeft"&&hasPrev)onPrev();
    else if(e.key==="ArrowRight"&&hasNext)onNext();
  };
  window.addEventListener("keydown",onKey);
  document.body.style.overflow="hidden";
  return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow="";};
},[onClose,onPrev,onNext,hasPrev,hasNext]);
const d=IND[id];if(!d)return null;
const [label,sub,cat,tier,,,cur,m1,m3,m6,m12,,desc,signal]=d;
const catCol=CATS[cat]?.color||"var(--text-dim)";
const s=sdScore(id,cur);
const col=sdColor(s);
const colT=sdTextColor(s);
const tierCol=tier===1?"var(--yellow-text)":tier===2?"#94a3b8":"#4b5563";
const tierBorder=tier===1?"#B8860B":tier===2?"#94a3b8":"#4b5563";
const sp=SD[id];
// Bug #1035: 12-month range-bar scale now comes from the actual last 365
// days of daily points in indicator_history.json via get12MWindowStats(),
// not from the five sparse snapshots [cur,m1,m3,m6,m12]. The sparse version
// collapsed when those five readings happened to cluster near the current
// value (e.g. hy_ig 285 pegged right). Fallback to the sparse logic when
// _histCache hasn't loaded yet so the bar still renders on first paint.
const win12=get12MWindowStats(id);
const sMin=win12?win12.min:(()=>{const v=[cur,m1,m3,m6,m12].filter(x=>x!=null);return v.length?Math.min(...v):null;})();
const sMax=win12?win12.max:(()=>{const v=[cur,m1,m3,m6,m12].filter(x=>x!=null);return v.length?Math.max(...v):null;})();
// Re-scope avg/elev/ext markers to the SAME 12M window when available, so
// the numbers beside "12-MONTH RANGE" describe the window being rendered
// rather than the 15y baseline from SD[id].
const rangeStats=win12?{mean:win12.mean,sd:win12.sd}:sp;
return(
<div className="modal-backdrop" onClick={onClose}>
  <div className="modal-wrap">
    {hasPrev&&<button className="modal-nav prev" onClick={e=>{e.stopPropagation();onPrev();}} aria-label="Previous">‹</button>}
    {hasNext&&<button className="modal-nav next" onClick={e=>{e.stopPropagation();onNext();}} aria-label="Next">›</button>}
    <div className="modal-sheet" onClick={e=>e.stopPropagation()} style={{position:"relative",padding:"var(--space-5) var(--space-5) var(--space-4)"}}>
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:"var(--space-4)",paddingRight:40}}>
        <div style={{width:4,height:44,background:catCol,borderRadius:2,flexShrink:0,marginTop:2}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
            <h2 style={{fontSize:20,fontWeight:700,color:"var(--text)",margin:0,letterSpacing:"-0.01em"}}>{label}</h2>
            {/* Category chip — distinct hue per category (Item 22). Replaces the
                former grey monospace subtitle that rendered identically for every
                category. */}
            <span title={`Category: ${CATS[cat]?.label||cat}`} style={{fontSize:10,color:catCol,background:catCol+"15",border:`1px solid ${catCol}55`,borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:700,letterSpacing:"0.03em",textTransform:"uppercase"}}>{CATS[cat]?.label||cat}</span>
            <Tip label={`TIER ${tier}`} def={tier===1?"Tier 1 — most market-sensitive, highest weight (1.5×) in the composite stress score.":tier===2?"Tier 2 — important but less real-time, weighted 1.2× in the composite.":"Tier 3 — structural/context indicator, weighted 1.0× in the composite."}>
              <span style={{fontSize:10,color:tierCol,border:`1px solid ${tierBorder}55`,borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:"help"}}>TIER {tier}</span>
            </Tip>
            <Tip label={IND_FREQ[id]==="D"?"DAILY":IND_FREQ[id]==="W"?"WEEKLY":IND_FREQ[id]==="M"?"MONTHLY":IND_FREQ[id]==="Q"?"QUARTERLY":""} def={IND_FREQ[id]==="D"?"Daily release — updated every trading day.":IND_FREQ[id]==="W"?"Weekly release — typically published Thursday or Friday morning.":IND_FREQ[id]==="M"?"Monthly release — published in the first or second week after month-end.":IND_FREQ[id]==="Q"?"Quarterly release — published ~6 weeks after quarter-end. There is no true intra-quarter value.":"Release frequency unknown."}>
              <span style={{fontSize:10,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",cursor:"help"}}>{IND_FREQ[id]||"—"}</span>
            </Tip>
          </div>
          <div style={{fontSize:13,color:"var(--text-muted)",marginBottom:2}}>{sub}</div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><FreshnessDot indicatorId={id} asOfIso={AS_OF_ISO[id]} cadence={IND_FREQ[id]}/><span>Data as of {AS_OF[id]}</span><StalePill id={id}/></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div className="num" style={{fontSize:28,fontWeight:800,color:colT,lineHeight:1,fontFamily:"var(--font-mono)"}}>{fmtV(id,cur)}</div>
          <div style={{fontSize:11,fontWeight:700,color:colT,fontFamily:"var(--font-mono)",marginTop:4,letterSpacing:"0.02em"}}>{s!=null?sdLabel(s).toUpperCase():"NO DATA"}</div>
        </div>
      </div>
      {/* Period strip */}
      <div style={{marginBottom:"var(--space-4)"}}>
        <IndicatorTrendPills id={id} d={d}/>
      </div>
      {/* Long-term chart */}
      <div style={{background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
        <LongChart id={id} col={col}/>
      </div>
      {/* Range bar — compact single-row layout */}
      {sp&&sMin!=null&&(
        <div style={{background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:6}}>
            <span>12-MONTH RANGE</span>
            <span style={{color:"var(--text-dim)"}}>avg <span style={{color:"#30d158"}}>{fmtV(id,rangeStats.mean)}</span> · elev <span style={{color:"#ff9f0a"}}>{fmtV(id,rangeStats.mean+rangeStats.sd)}</span> · ext <span style={{color:"#ff453a"}}>{fmtV(id,rangeStats.mean+rangeStats.sd*2)}</span></span>
          </div>
          <RangeBar sMin={sMin} sMax={sMax} sp={rangeStats} cur={cur} col={col}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)",marginTop:3}}>
            <span>{fmtV(id,sMin)}</span>
            <span>{fmtV(id,sMax)}</span>
          </div>
        </div>
      )}
      {/* What is this — compact */}
      <div style={{background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:6}}>WHAT IS THIS INDICATOR?</div>
        <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55}}>{desc}</div>
      </div>
      {/* What is it telling you now */}
      <div style={{background:`${col}0d`,border:`1px solid ${col}33`,borderRadius:"var(--radius-md)",padding:"var(--space-3)"}}>
        <div style={{fontSize:10,color:col,fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:6,fontWeight:700}}>WHAT IS IT TELLING YOU RIGHT NOW?</div>
        <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55}}>{dynamicSignal(id,cur,signal)}</div>
      </div>
    </div>
  </div>
</div>
);
}


// ── ALL INDICATORS TABLE — single sortable inventory of every macro indicator
//    MacroTilt collects. Replaces the prior expandable-card grid.
//
// Joe spec (PR feat/all-indicators-redesign-plus-new-data 2026-04-24):
//   - Narrative intro + dynamic count line
//   - One sortable table (Indicator / Category / Freq / Composite / Weight /
//     Type / Last refresh / Current / 3M / 6M / 12M)
//   - Click row → expand inline using IndicatorDetailBody (re-uses the same
//     content that lives inside IndicatorModal)
//   - Tooltips on column headers + chips, instant show via <Tip/>
//   - Plain English everywhere; works in both light + dark theme via existing
//     CSS theme tokens (no hardcoded colors except semantic stress hues).
//
// Composite mappings + weights match public/composite_weights.json (PR #110).
// Indicators that did not clear the AUC predictive-threshold are kept on the
// site as reference (per memory feedback_indicators_never_deleted).

// Composite mapping — derived from public/composite_weights.json so a single
// edit there propagates here. Keeping inline for now; future refactor can
// import the JSON at build time.
const COMPOSITE_MAP = {
  // Risk & Liquidity (R&L) — 3-month forward drawdown
  anfci:  { composite:"Risk & Liquidity", weight:0.2598 },
  vix:    { composite:"Risk & Liquidity", weight:0.2537 },
  stlfsi: { composite:"Risk & Liquidity", weight:0.2434 },
  cmdi:   { composite:"Risk & Liquidity", weight:0.2431 },
  // Growth — 6-month forward
  jobless:    { composite:"Growth", weight:0.3427 },
  cfnai_3ma:  { composite:"Growth", weight:0.3307 },
  bkx_spx:    { composite:"Growth", weight:0.3265 },
  // Inflation & Rates — 18-month forward
  move:   { composite:"Inflation & Rates", weight:0.5063 },
  m2_yoy: { composite:"Inflation & Rates", weight:0.4937 },
};

const COMPOSITE_TOOLTIPS = {
  "Risk & Liquidity": "Risk & Liquidity composite — 3-month forward drawdown predictor. AUC 0.69 (95% CI 0.60–0.78), 4 indicators.",
  "Growth":           "Growth composite — 6-month forward drawdown predictor. AUC 0.66 (95% CI 0.57–0.74), 3 indicators.",
  "Inflation & Rates":"Inflation & Rates composite — 18-month forward drawdown predictor. AUC 0.60 (95% CI 0.51–0.68), 2 indicators.",
};

// Lead/Coincident/Lag classification (Senior Quant + Conference Board / NBER convention).
const TYPE_MAP = {
  // LEAD
  yield_curve:"Lead", ism:"Lead", jobless:"Lead", jolts_quits:"Lead", copper_gold:"Lead",
  sloos_ci:"Lead", sloos_cre:"Lead", real_rates:"Lead", term_premium:"Lead",
  breakeven_10y:"Lead", m2_yoy:"Lead", fed_bs:"Lead", cfnai:"Lead", cfnai_3ma:"Lead",
  skew:"Lead",
  // COINCIDENT
  vix:"Coincident", move:"Coincident", anfci:"Coincident", stlfsi:"Coincident",
  cmdi:"Coincident", hy_ig:"Coincident", hy_ig_etf:"Coincident", cpff:"Coincident",
  loan_syn:"Coincident", bkx_spx:"Coincident", usd:"Coincident", rrp:"Coincident",
  bank_reserves:"Coincident", tga:"Coincident", eq_cr_corr:"Coincident", bank_unreal:"Coincident",
  // LAG
  bank_credit:"Lag", credit_3y:"Lag", cape:"Lag",
};

const TYPE_TOOLTIP_BY_VAL = {
  "Lead":      "Lead — moves before the cycle (Conference Board convention). Useful for forward-looking allocation tilts.",
  "Coincident":"Coincident — moves with the cycle. Useful as a real-time gauge of current conditions.",
  "Lag":       "Lag — moves after the cycle. Useful for confirming a regime shift, less so for anticipating one.",
};
const TYPE_COLOR = { "Lead":"#22c55e", "Coincident":"#94a3b8", "Lag":"#a78bfa" };

// Per-category plain-English description (shown in chip tooltip).
const CATEGORY_TOOLTIPS = {
  equity:  "Equity & Vol — implied volatility, equity-credit correlation, and tail-risk pricing on the S&P 500 options market.",
  credit:  "Credit Markets — corporate bond risk premia, distress indices, and HY/IG spread proxies.",
  rates:   "Rates & Duration — Treasury curve slope, real yields, term premium, and long-end inflation pricing.",
  fincond: "Financial Conditions — broad measures of money-market and balance-sheet stress (ANFCI, STLFSI, USD, CPFF, M2, RRP, Treasury General Account, Fed Balance Sheet).",
  bank:    "Bank & Money Supply — bank credit growth, lending standards, unrealized losses, and the system reserve floor.",
  labor:   "Labor & Economy — jobless claims, JOLTS quits, ISM manufacturing PMI, CFNAI activity index, copper/gold growth proxy.",
};

// Helper — value at approximately N days back, using indicator_history.json.
function _valueAtDaysAgo(id, days){
  const e = _histCache && _histCache[id];
  if(!e || !Array.isArray(e.points) || e.points.length < 2) return null;
  const pts = e.points;
  const lastDate = new Date(String(pts[pts.length-1][0]) + "T00:00:00Z");
  if(Number.isNaN(+lastDate)) return null;
  const targetMs = lastDate.getTime() - days * 24 * 3600 * 1000;
  let best = null, bestDiff = Infinity, bestDate = null;
  for(let i = pts.length-1; i >= 0; i--){
    const [ds, val] = pts[i];
    if(val == null || !Number.isFinite(val)) continue;
    const d = new Date(String(ds) + "T00:00:00Z");
    if(Number.isNaN(+d)) continue;
    // Only consider points at or before the target date
    if(d.getTime() > targetMs + 7*24*3600*1000) continue;
    const diff = Math.abs(d.getTime() - targetMs);
    if(diff < bestDiff){ bestDiff = diff; best = val; bestDate = ds; }
    if(d.getTime() < targetMs - 60*24*3600*1000) break;
  }
  return best;
}

// Sort comparators per column. Always returns nulls-last regardless of direction
// — pulled out of the asc/desc reversal in the component so users always see the
// real values together (desc → highest weight first, nulls anchored at the bottom;
// asc → lowest weight first, nulls also at the bottom).
function _cmp(a, b){
  if(a == null && b == null) return 0;
  if(a == null) return 1;
  if(b == null) return -1;
  if(typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// Default sort: composite priority (R&L → Growth → Inflation & Rates → N/A),
// then weight DESC inside each composite.
const COMP_ORDER = { "Risk & Liquidity":0, "Growth":1, "Inflation & Rates":2, "":3 };

function AllIndicatorsTable(){
  // Subscribe to indicator_history.json hydration so this table re-renders
  // once IND[id][6] / _histCache are mutated by _applyHistToGlobals — without
  // this, the 9 new indicators (Reg #8) render their Current / 3M / 6M / 12M
  // cells as em-dashes on first paint and never recover unless something else
  // higher in the tree triggers a re-render before navigation.
  useHistReady();
  const [sortKey, setSortKey] = useState("default");
  const [sortDir, setSortDir] = useState("asc");
  // Reg #7: openIds is a Set so we can expand-all / collapse-all.
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggleOne = (id) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if(next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Build row data — one row per indicator in IND.
  const rows = Object.keys(IND).map(id => {
    const d = IND[id];
    const compMap = COMPOSITE_MAP[id];
    const composite = compMap ? compMap.composite : "";
    const weight = compMap ? compMap.weight : null;
    const type = TYPE_MAP[id] || "";
    const cur = d[6];
    const v3m = _valueAtDaysAgo(id, 90);
    const v6m = _valueAtDaysAgo(id, 180);
    const v12m = _valueAtDaysAgo(id, 365);
    return {
      id,
      label: d[0],
      sub: d[1],
      cat: d[2],
      tier: d[3],
      freq: IND_FREQ[id] || "",
      composite,
      weight,
      type,
      asOf: AS_OF[id] || "—",
      cur, v3m, v6m, v12m,
    };
  });

  const weightedCount = rows.filter(r => r.weight != null).length;
  const refCount = rows.length - weightedCount;

  // Sort
  const sorted = [...rows].sort((a, b) => {
    if(sortKey === "default"){
      const ca = COMP_ORDER[a.composite] ?? 3;
      const cb = COMP_ORDER[b.composite] ?? 3;
      if(ca !== cb) return ca - cb;
      return (b.weight || 0) - (a.weight || 0);
    }
    let av, bv;
    switch(sortKey){
      case "label":     av = a.label;      bv = b.label;      break;
      case "category":  av = CATS[a.cat]?.label || a.cat; bv = CATS[b.cat]?.label || b.cat; break;
      case "freq":      av = a.freq;       bv = b.freq;       break;
      case "composite": av = COMP_ORDER[a.composite] ?? 3; bv = COMP_ORDER[b.composite] ?? 3; break;
      case "weight":    av = a.weight;     bv = b.weight;     break;
      case "type":      av = a.type;       bv = b.type;       break;
      case "asof":      av = AS_OF_TS(a.asOf); bv = AS_OF_TS(b.asOf); break;
      case "cur":       av = a.cur;        bv = b.cur;        break;
      case "v3m":       av = a.v3m;        bv = b.v3m;        break;
      case "v6m":       av = a.v6m;        bv = b.v6m;        break;
      case "v12m":      av = a.v12m;       bv = b.v12m;       break;
      default:          return 0;
    }
    // Anchor nulls last in BOTH directions — only flip the comparison sign on
    // the non-null pairs so a desc sort doesn't bring blank cells to the top.
    if(av == null && bv == null) return 0;
    if(av == null) return 1;
    if(bv == null) return -1;
    const c = _cmp(av, bv);
    return sortDir === "asc" ? c : -c;
  });

  const onSort = (k) => {
    if(sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  const arrowFor = (k) => {
    if(sortKey !== k) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  // Header cell with optional tooltip
  const Th = ({ k, label, tip, align="left", width }) => {
    const inner = (
      <span style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",userSelect:"none"}}>
        {label}{arrowFor(k) && <span style={{fontSize:9,color:"var(--text-dim)"}}>{arrowFor(k)}</span>}
      </span>
    );
    return (
      <th onClick={()=>onSort(k)} style={{
        textAlign: align, padding:"10px 12px",
        fontSize:11, fontWeight:600, color:"var(--text-2)",
        fontFamily:"var(--font-mono)", letterSpacing:"0.06em", textTransform:"uppercase",
        borderBottom:"1px solid var(--border)", background:"var(--surface)",
        whiteSpace:"nowrap", width,
      }}>
        {tip ? <Tip def={tip}>{inner}</Tip> : inner}
      </th>
    );
  };

  const tdBase = { padding:"12px 12px", fontSize:13, color:"var(--text)", borderBottom:"1px solid var(--border-faint)", verticalAlign:"middle" };

  return (
    <div style={{padding:"20px 20px 24px", maxWidth:1200, margin:"0 auto"}}>

      {/* ── NARRATIVE INTRO ─────────────────────────────────────────── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:10,flexWrap:"wrap"}}>
          <h1 style={{fontSize:28, fontWeight:700, color:"var(--text)", margin:0, letterSpacing:"-0.01em", fontFamily:'"Fraunces", Georgia, serif', flex:1, minWidth:0}}>
            All indicators — what feeds the composites and what doesn't
          </h1>
          {/* Reg #7 — expand-all / collapse-all toggle */}
          <button
            type="button"
            onClick={() => {
              if(openIds.size === 0) setOpenIds(new Set(rows.map(r => r.id)));
              else setOpenIds(new Set());
            }}
            style={{
              padding:"6px 14px",
              fontSize:11,
              fontFamily:"var(--font-mono)",
              fontWeight:700,
              letterSpacing:"0.06em",
              textTransform:"uppercase",
              border:"1px solid var(--border)",
              borderRadius:4,
              cursor:"pointer",
              background:"var(--surface-2)",
              color:"var(--text)",
              whiteSpace:"nowrap",
              flexShrink:0,
              marginTop:4,
            }}
          >
            {openIds.size === 0 ? "Expand all" : "Collapse all"}
          </button>
        </div>
        <p style={{fontSize:14, color:"var(--text-2)", lineHeight:1.7, margin:"0 0 8px 0", maxWidth:840}}>
          This page is the inventory of every macro indicator MacroTilt collects. Each is mapped to
          a category (equity & volatility, credit, rates, financial conditions, bank channel, labor,
          money supply, inflation expectations) and to a forward-horizon composite (Risk &amp; Liquidity,
          Growth, Inflation &amp; Rates) where it has cleared the drawdown-prediction confidence threshold
          from our v2 backtest. Indicators that did not clear are kept on the site as reference — they
          remain useful for context but do NOT contribute to composite math. Click any row for the full
          indicator detail (description, calculation, source, history chart). Headers are sortable;
          tooltips on every column header and weight chip explain the term in plain English.
        </p>
        <div style={{fontSize:12, color:"var(--text-muted)", fontFamily:"var(--font-mono)", letterSpacing:"0.04em"}}>
          {rows.length} indicators total · {weightedCount} weighted into composites · {refCount} reference-only
        </div>
      </div>

      {/* ── SORTABLE TABLE ──────────────────────────────────────────── */}
      <div style={{
        background:"var(--surface)",
        border:"1px solid var(--border)",
        borderRadius:8,
        overflow:"hidden",
      }}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%", borderCollapse:"collapse"}}>
            <thead>
              <tr>
                <Th k="label"     label="Indicator" />
                <Th k="category"  label="Category" />
                <Th k="freq"      label="Freq" align="center" width={60} tip="D = Daily · W = Weekly · M = Monthly · Q = Quarterly. The release cadence of the upstream source." />
                <Th k="composite" label="Composite" tip="Indicators that cleared the AUC predictive threshold (95% CI lower ≥ 0.55) for forward S&P drawdowns are mapped here. R&L = 3-month horizon, Growth = 6-month, Inflation & Rates = 18-month." />
                <Th k="weight"    label="Weight" align="right" tip="Empirical weight = the indicator's AUC excess (over 0.5) normalized within its composite. Higher AUC implies higher weight. Indicators with — did not clear the predictive threshold." />
                <Th k="type"      label="Type" align="center" tip="Lead = moves before the cycle (Conference Board convention). Coincident = moves with the cycle. Lag = moves after." />
                <Th k="asof"      label="Last refresh" tip="Date the most recent observation was posted by the source. Daily refresh runs at market close." />
                <Th k="cur"       label="Current" align="right" />
                <Th k="v3m"       label="3M ago" align="right" tip="Value at approximately 90 days back, walked from the indicator's history series. — when lookback exceeds the available history." />
                <Th k="v6m"       label="6M ago" align="right" tip="Value at approximately 180 days back." />
                <Th k="v12m"      label="12M ago" align="right" tip="Value at approximately 365 days back." />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => {
                const isOpen = openIds.has(r.id);
                const catCol = CATS[r.cat]?.color || "var(--text-dim)";
                const compTip = COMPOSITE_TOOLTIPS[r.composite];
                const sCur = sdScore(r.id, r.cur);
                const colCur = sdTextColor(sCur);
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => toggleOne(r.id)}
                      style={{
                        cursor:"pointer",
                        background: isOpen ? "var(--inset, var(--surface-2))" : "transparent",
                      }}
                      onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background = "var(--inset, var(--surface-2))"; }}
                      onMouseLeave={e => { if(!isOpen) e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Indicator name + key */}
                      <td style={{...tdBase, paddingLeft:16}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:3, height:18, background:catCol, borderRadius:1, flexShrink:0}}/>
                          <div>
                            <div style={{fontSize:13, fontWeight:600, color:"var(--text)"}}>{r.label}</div>
                            <div style={{fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)", marginTop:1}}>{r.id}</div>
                          </div>
                        </div>
                      </td>
                      {/* Category chip */}
                      <td style={tdBase}>
                        <Tip def={CATEGORY_TOOLTIPS[r.cat] || ""}>
                          <span style={{
                            display:"inline-block",
                            fontSize:10, fontWeight:700, color:catCol, background:catCol+"15",
                            border:`1px solid ${catCol}55`, borderRadius:4, padding:"2px 7px",
                            fontFamily:"var(--font-mono)", letterSpacing:"0.03em",
                            textTransform:"uppercase", whiteSpace:"nowrap",
                          }}>{CATS[r.cat]?.label || r.cat}</span>
                        </Tip>
                      </td>
                      {/* Freq chip */}
                      <td style={{...tdBase, textAlign:"center"}}>
                        <span style={{
                          display:"inline-block", fontSize:11, color:"var(--text-2)",
                          border:"1px solid var(--border)", borderRadius:3, padding:"1px 6px",
                          fontFamily:"var(--font-mono)", fontWeight:600,
                        }}>{r.freq || "—"}</span>
                      </td>
                      {/* Composite */}
                      <td style={tdBase}>
                        {r.composite ? (
                          <Tip def={compTip || ""}>
                            <span style={{
                              fontSize:11, fontWeight:600, color:"var(--accent)",
                              fontFamily:"var(--font-mono)", letterSpacing:"0.02em", whiteSpace:"nowrap",
                            }}>{r.composite}</span>
                          </Tip>
                        ) : (
                          <span style={{fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)"}}>N/A</span>
                        )}
                      </td>
                      {/* Weight */}
                      <td style={{...tdBase, textAlign:"right"}}>
                        {r.weight != null ? (
                          <span style={{
                            fontSize:12, fontWeight:700, color:"var(--text)",
                            fontFamily:"var(--font-mono)",
                          }}>{(r.weight * 100).toFixed(1)}%</span>
                        ) : (
                          <span style={{color:"var(--text-dim)"}}>—</span>
                        )}
                      </td>
                      {/* Type */}
                      <td style={{...tdBase, textAlign:"center"}}>
                        {r.type ? (
                          <Tip def={TYPE_TOOLTIP_BY_VAL[r.type] || ""}>
                            <span style={{
                              display:"inline-block",
                              fontSize:10, fontWeight:700, color: TYPE_COLOR[r.type] || "var(--text-2)",
                              border:`1px solid ${(TYPE_COLOR[r.type] || "var(--border)")}55`,
                              background: (TYPE_COLOR[r.type] || "transparent") + "15",
                              borderRadius:3, padding:"2px 7px", fontFamily:"var(--font-mono)",
                              letterSpacing:"0.03em", textTransform:"uppercase",
                            }}>{r.type}</span>
                          </Tip>
                        ) : (
                          <span style={{color:"var(--text-dim)"}}>—</span>
                        )}
                      </td>
                      {/* Last refresh — FreshnessDot is the at-a-glance signal next to the date */}
                      <td style={{...tdBase, fontSize:12, color:"var(--text-2)", fontFamily:"var(--font-mono)"}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                          <FreshnessDot indicatorId={r.id} asOfIso={AS_OF_ISO[r.id]} cadence={r.freq} label={r.label}/>
                          {r.asOf || "—"}
                        </span>
                      </td>
                      {/* Current */}
                      <td style={{...tdBase, textAlign:"right", fontFamily:"var(--font-mono)", fontWeight:700, color: colCur}}>
                        {fmtV(r.id, r.cur)}
                      </td>
                      {/* 3M ago */}
                      <td style={{...tdBase, textAlign:"right", fontFamily:"var(--font-mono)", color:"var(--text-2)"}}>
                        {fmtV(r.id, r.v3m)}
                      </td>
                      {/* 6M ago */}
                      <td style={{...tdBase, textAlign:"right", fontFamily:"var(--font-mono)", color:"var(--text-2)"}}>
                        {fmtV(r.id, r.v6m)}
                      </td>
                      {/* 12M ago */}
                      <td style={{...tdBase, textAlign:"right", fontFamily:"var(--font-mono)", color:"var(--text-2)", paddingRight:16}}>
                        {fmtV(r.id, r.v12m)}
                      </td>
                    </tr>
                    {/* Inline expanded detail row — full-width detail panel */}
                    {isOpen && (
                      <tr>
                        <td colSpan={11} style={{padding:0, background:"var(--surface-2)", borderBottom:"1px solid var(--border)"}}>
                          <div style={{padding:"20px 24px"}}>
                            <IndicatorDetailBody id={r.id} onClose={() => toggleOne(r.id)} inline />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Helper for as-of date sort — converts "Apr 16 2026" / "Mar 2026" / "Q4 2025" to ms.
function AS_OF_TS(s){
  if(!s || s === "—") return 0;
  const t = Date.parse(s);
  if(!Number.isNaN(t)) return t;
  // "Q4 2025" → Dec 31 2025
  const mq = /^Q([1-4])\s+(\d{4})$/i.exec(s);
  if(mq){
    const q = parseInt(mq[1], 10);
    const y = parseInt(mq[2], 10);
    return Date.UTC(y, q*3 - 1, 28);
  }
  return 0;
}

// Compute the trailing 12-month low/high from indicator_history.json. The
// "12-month" cut-off uses last-N-points by frequency (252D / 52W / 12M / 4Q)
// per Joe's spec rather than wall-clock date math, so a sparse weekly series
// doesn't accidentally use 5 years of data because pts is indexed by sample.
// Returns { low, high, n, monthsCovered } — when history is shorter than 12
// months the caller can fall back to "N-month range" labelling.
function getTwelveMonthRange(id){
  const e = _histCache && _histCache[id];
  if(!e || !Array.isArray(e.points) || e.points.length < 1) return null;
  const freq = (e.freq || IND_FREQ[id] || "D").toUpperCase();
  const wantN = freq === "Q" ? 4 : freq === "M" ? 12 : freq === "W" ? 52 : 252;
  const tail = e.points.slice(Math.max(0, e.points.length - wantN));
  const vals = tail.map(p => p[1]).filter(v => v != null && Number.isFinite(v));
  if(!vals.length) return null;
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  // Approximate months covered for the "N-month range" fallback label.
  let monthsCovered = 12;
  if(tail.length < wantN){
    if(freq === "Q") monthsCovered = tail.length * 3;
    else if(freq === "M") monthsCovered = tail.length;
    else if(freq === "W") monthsCovered = Math.round(tail.length * 12 / 52);
    else monthsCovered = Math.round(tail.length * 12 / 252);
  }
  return { low, high, n: tail.length, monthsCovered };
}

// 12-month Range Bar — Joe's spec (2026-04-24 UAT):
//   "12M Low (left), Current Reading vertical tick in middle, 12M High (right)"
// Tick position = (current - low) / (high - low). Falls back to "N-month
// range" label when history < 12 months. No green band, no avg tick — that
// info already lives in the chart overlay underneath.
function TwelveMonthRangeBar({ id, cur }){
  const range = getTwelveMonthRange(id);
  if(!range || cur == null) return null;
  const { low, high, monthsCovered } = range;
  const span = high - low;
  // When low == high (only one print available, or flat series), pin tick
  // to the middle and skip the math.
  const pct = span > 0 ? Math.max(0, Math.min(100, ((cur - low) / span) * 100)) : 50;
  const sCur = sdScore(id, cur);
  const tickCol = sdColor(sCur);
  const label = monthsCovered >= 12 ? "12-MONTH RANGE" : `${monthsCovered}-MONTH RANGE`;
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
      <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:8}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {/* 12M LOW value (left) */}
        <div style={{minWidth:60,textAlign:"left"}}>
          <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>12M LOW</div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{fmtV(id,low)}</div>
        </div>
        {/* The bar with the current marker */}
        <div style={{flex:1,position:"relative",height:12,background:"var(--inset, var(--surface-2))",border:"1px solid var(--border)",borderRadius:6}}>
          <div title={`Current ${fmtV(id,cur)}`} style={{position:"absolute",left:`${pct}%`,top:-3,bottom:-3,width:3,background:tickCol,borderRadius:2,transform:"translateX(-50%)",boxShadow:`0 0 6px ${tickCol}88`}}/>
          {/* Current value label above the tick */}
          <div style={{position:"absolute",left:`${pct}%`,bottom:"100%",transform:"translateX(-50%)",marginBottom:4,fontSize:11,fontWeight:700,color:tickCol,fontFamily:"var(--font-mono)",whiteSpace:"nowrap"}}>{fmtV(id,cur)}</div>
        </div>
        {/* 12M HIGH value (right) */}
        <div style={{minWidth:60,textAlign:"right"}}>
          <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>12M HIGH</div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{fmtV(id,high)}</div>
        </div>
      </div>
    </div>
  );
}

// Reusable detail body — same content as IndicatorModal sheet, but no overlay
// chrome (close button + nav arrows). Used inline in AllIndicatorsTable rows.
function IndicatorDetailBody({ id, onClose, inline }){
  const d = IND[id];
  if(!d) return null;
  const [label, sub, cat, tier, , , cur, m1, m3, m6, m12, , desc, signal] = d;
  const catCol = CATS[cat]?.color || "var(--text-dim)";
  const s = sdScore(id, cur);
  const col = sdColor(s);
  const colT = sdTextColor(s);
  const tierCol = tier===1?"var(--yellow-text)":tier===2?"#94a3b8":"#4b5563";
  const tierBorder = tier===1?"#B8860B":tier===2?"#94a3b8":"#4b5563";
  const sp = SD[id];
  // (Locals win12/sMin/sMax/rangeStats from PR #116 dropped — TwelveMonthRangeBar
  // computes its own 12M low/high directly from indicator_history.json now.)
  return (
    <div style={{position:"relative"}}>
      {inline && (
        <button onClick={onClose} aria-label="Collapse" style={{
          position:"absolute", top:0, right:0,
          width:28, height:28, padding:0,
          background:"transparent", border:"1px solid var(--border)", borderRadius:4,
          cursor:"pointer", color:"var(--text-2)", fontSize:18, lineHeight:"24px",
        }}>×</button>
      )}
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:"var(--space-4)",paddingRight:40}}>
        <div style={{width:4,height:44,background:catCol,borderRadius:2,flexShrink:0,marginTop:2}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
            <h2 style={{fontSize:20,fontWeight:700,color:"var(--text)",margin:0,letterSpacing:"-0.01em"}}>{label}</h2>
            <Tip def={CATEGORY_TOOLTIPS[cat] || ""}>
              <span style={{fontSize:10,color:catCol,background:catCol+"15",border:`1px solid ${catCol}55`,borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:700,letterSpacing:"0.03em",textTransform:"uppercase"}}>{CATS[cat]?.label||cat}</span>
            </Tip>
            <Tip label={`TIER ${tier}`} def={tier===1?"Tier 1 — most market-sensitive, highest weight (1.5×) in the composite stress score.":tier===2?"Tier 2 — important but less real-time, weighted 1.2× in the composite.":"Tier 3 — structural/context indicator, weighted 1.0× in the composite."}>
              <span style={{fontSize:10,color:tierCol,border:`1px solid ${tierBorder}55`,borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:"help"}}>TIER {tier}</span>
            </Tip>
            <Tip label={IND_FREQ[id]==="D"?"DAILY":IND_FREQ[id]==="W"?"WEEKLY":IND_FREQ[id]==="M"?"MONTHLY":IND_FREQ[id]==="Q"?"QUARTERLY":""} def={IND_FREQ[id]==="D"?"Daily release — updated every trading day.":IND_FREQ[id]==="W"?"Weekly release — typically published Thursday or Friday morning.":IND_FREQ[id]==="M"?"Monthly release — published in the first or second week after month-end.":IND_FREQ[id]==="Q"?"Quarterly release — published ~6 weeks after quarter-end. There is no true intra-quarter value.":"Release frequency unknown."}>
              <span style={{fontSize:10,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",cursor:"help"}}>{IND_FREQ[id]||"—"}</span>
            </Tip>
          </div>
          <div style={{fontSize:13,color:"var(--text-muted)",marginBottom:2}}>{sub}</div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><FreshnessDot indicatorId={id} asOfIso={AS_OF_ISO[id]} cadence={IND_FREQ[id]}/><span>Data as of {AS_OF[id]}</span><StalePill id={id}/></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0,marginRight: inline ? 36 : 0}}>
          <div className="num" style={{fontSize:28,fontWeight:800,color:colT,lineHeight:1,fontFamily:"var(--font-mono)"}}>{fmtV(id,cur)}</div>
          <div style={{fontSize:11,fontWeight:700,color:colT,fontFamily:"var(--font-mono)",marginTop:4,letterSpacing:"0.02em"}}>{s!=null?sdLabel(s).toUpperCase():"NO DATA"}</div>
        </div>
      </div>
      {/* Period strip */}
      <div style={{marginBottom:"var(--space-4)"}}>
        <IndicatorTrendPills id={id} d={d}/>
      </div>
      {/* Long-term chart */}
      <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
        <LongChart id={id} col={col}/>
      </div>
      {/* 12-month range bar — Joe's spec (Reg #5, supersedes PR #116 inline body):
          12M LOW value (left) · CURRENT vertical tick in middle · 12M HIGH value (right).
          Pulls real 12M low/high from indicator_history.json (last 252D / 52W /
          12M / 4Q by frequency), not the stale m1/m3/m6/m12 IND tuple values
          and not the avg/elev/ext markers PR #116 added. The IndicatorModal
          (separate component) still uses the PR #116 RangeBar with markers. */}
      <TwelveMonthRangeBar id={id} cur={cur} />
      {/* What is this */}
      <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"}}>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:6}}>WHAT IS THIS INDICATOR?</div>
        <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55}}>{desc || "—"}</div>
      </div>
      {/* "What is it telling you right now" intentionally removed —
          duplicates the SD-band chip + the chart's normal-range overlay.
          Per Joe (2026-04-24 UAT). */}
    </div>
  );
}


// ── WATCHLIST ADD INPUT — inline input for adding arbitrary tickers to the
//    signed-in user's watchlist from the Portfolio/Opportunities "Other
//    Watchlist" sub-panel. Writes to supabase.watchlist and refetches.
// Catalog the scanner actually covers. Anything else (crypto, futures,
// currency pairs, options, warrants) must not enter the watchlist — the
// scan-artifact pipeline has no scoring logic for those instrument types.
const SCANNER_SUPPORTED_TYPES=new Set(["EQUITY","ETF","MUTUALFUND","INDEX"]);
const UNSUPPORTED_TYPE_LABELS={
  CRYPTOCURRENCY:"cryptocurrency",
  FUTURE:"futures contract",
  CURRENCY:"currency pair",
  OPTION:"options contract",
  WARRANT:"warrant",
  RIGHT:"rights offering",
  COMMODITY:"commodity",
  BOND:"bond",
};
// Yahoo Finance symbol search — public endpoint, CORS-friendly, no key.
// Returns {ok:true, name, quoteType} on verified match, or {ok:false, reason}
// on miss / unsupported type / unreachable. We distinguish three failure
// modes so the add flow can apply the right UX:
//   not_found         — string is not a real symbol → hard-block
//   unsupported_type  — symbol exists but scanner can't score it → hard-block
//                       (crypto, futures, options, currencies, warrants...)
//   unreachable       — validator down / rate-limited / CORS → soft-warn only
async function validateTicker(t){
  const sym=String(t||"").trim().toUpperCase();
  if(!sym)return{ok:false,reason:"empty"};
  try{
    const r=await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=10&newsCount=0`,
      {headers:{"Accept":"application/json"}}
    );
    // Transient HTTP failures (429 rate-limit, 5xx) must not lock the user
    // out of adding real tickers. Fall through to soft-warn in the caller.
    if(!r.ok)return{ok:false,reason:"unreachable",http:r.status};
    const j=await r.json();
    const quotes=(j&&j.quotes)||[];
    // Require exact symbol match — fuzzy results would otherwise accept
    // "AAPLE" as AAPL or similar. If the user typo'd, they should retype.
    const hit=quotes.find(q=>String(q?.symbol||"").toUpperCase()===sym);
    if(!hit)return{ok:false,reason:"not_found"};
    const quoteType=String(hit?.quoteType||"").toUpperCase();
    if(!SCANNER_SUPPORTED_TYPES.has(quoteType)){
      return{
        ok:false,reason:"unsupported_type",quoteType,
        name:hit.shortname||hit.longname||sym,
      };
    }
    return{
      ok:true,
      name:hit.shortname||hit.longname||sym,
      quoteType,
      exchange:hit.exchange||"",
    };
  }catch(e){
    // Network failure, CORS block, DNS. Soft-warn path, not hard-block.
    return{ok:false,reason:"unreachable",err:e?.message||String(e)};
  }
}

function WatchlistAddInput({session,watchlistRows,refetchPortfolio,onTickerAdded}){
const [val,setVal]=useState("");
const [busy,setBusy]=useState(false);
// msg is {text, kind:'error'|'warn'} — error for hard rejects, warn for
// cases where the add proceeded but the user should know (validator down).
const [msg,setMsg]=useState(null);
const submit=async(e)=>{
  e?.preventDefault?.();
  const t=(val||"").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,"");
  if(!t)return;
  if((watchlistRows||[]).some(w=>w.ticker===t)){
    setMsg({text:`${t} already on watchlist`,kind:"error"});return;
  }
  setBusy(true);setMsg(null);
  try{
    const userId=session?.user?.id;
    if(!userId)throw new Error("Not signed in");
    // Validate BEFORE hitting Supabase. Hard-block on:
    //   - not_found: bogus string ("BULLSHIT", random letters)
    //   - unsupported_type: real symbol but outside scanner coverage
    //     (crypto, futures, options, warrants, currency pairs, ...)
    // Soft-warn only on unreachable (Yahoo down / 429 / CORS / offline) —
    // we don't want a flaky validator to block legitimate adds.
    const v=await validateTicker(t);
    if(!v.ok && v.reason==="not_found"){
      setMsg({
        text:`${t} isn't a real ticker. The scanner only covers U.S. stocks, ETFs, and mutual funds.`,
        kind:"error",
      });
      setBusy(false);return;
    }
    if(!v.ok && v.reason==="unsupported_type"){
      const label=UNSUPPORTED_TYPE_LABELS[v.quoteType]||v.quoteType.toLowerCase();
      setMsg({
        text:`${t} is a ${label} — the scanner only covers U.S. stocks, ETFs, and mutual funds.`,
        kind:"error",
      });
      setBusy(false);return;
    }
    // Either v.ok (validated) or v.reason==="unreachable" (soft-fallthrough).
    // When unreachable, write an empty name — scan-ticker will shortly
    // populate screener_json with UW's full_name, and WatchlistTable falls
    // through to sc.full_name when w.name is empty. Writing the ticker into
    // the name column (old behavior) made the Other Watchlist render the
    // ticker twice for new adds during CORS outages.
    const resolvedName=v.ok?v.name:"";
    const sort_order=((watchlistRows||[]).reduce((m,w)=>Math.max(m,w.sort_order||0),0))+1;
    const {error}=await supabase.from("watchlist").insert({
      user_id:userId,ticker:t,name:resolvedName,theme:"",sort_order,
    });
    if(error)throw error;
    setVal("");
    await refetchPortfolio?.();
    // Fire-and-forget scan so the modal populates without a full scheduled run.
    // The server-side scan-ticker call is the authoritative validator — if
    // the symbol is real, UW returns company info and we backfill the name.
    // When Yahoo's search endpoint is unreachable (CORS / 429), we stay
    // silent rather than show a noisy "couldn't verify" warning; the user
    // will see whether the row lights up with real data as the scan returns.
    onTickerAdded?.(t);
  }catch(e2){setMsg({text:e2.message||String(e2),kind:"error"});}
  finally{setBusy(false);}
};
return(
<form onSubmit={submit} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 2px",marginTop:2}}>
<input type="text" value={val} onChange={e=>{setVal(e.target.value);setMsg(null);}}
  placeholder="Add ticker (e.g. NFLX)" disabled={busy}
  style={{flex:1,minWidth:0,fontSize:11,fontFamily:"var(--font-mono)",padding:"6px 8px",background:"var(--surface-3)",border:"1px solid var(--border-faint)",color:"var(--text)",borderRadius:4,letterSpacing:"0.04em",textTransform:"uppercase"}}/>
<button type="submit" disabled={busy||!val.trim()}
  style={{fontSize:11,fontFamily:"var(--font-mono)",fontWeight:700,color:"#fff",background:val.trim()?"var(--accent)":"var(--text-dim)",border:"none",borderRadius:4,padding:"6px 12px",cursor:busy||!val.trim()?"default":"pointer",letterSpacing:"0.05em"}}>
  {busy?"…":"+ ADD"}
</button>
{msg&&<span style={{fontSize:10,color:msg.kind==="warn"?"#ffb300":"#ff453a",fontFamily:"var(--font-mono)",marginLeft:4}}>{msg.text}</span>}
</form>);
}

// ── TICKER DETAIL MODAL — per-ticker drill-down for opportunity cards,
//    held positions, and watchlist entries. Self-contained view of every
//    piece of intel the scanner has for one ticker — no need to bounce
//    to the Scanner tab.
function TickerDetailModal({ticker,scanData,accounts,watchlistRows,portfolioAuthed,refetchPortfolio,onClose,onTickerAdded,scanBusy}){
const [descExpanded,setDescExpanded]=useState(false);
const [wlBusy,setWlBusy]=useState(false);
const [wlError,setWlError]=useState(null);
// Bug #1017 — per-ticker Google News feed (Option B). Fetched when the
// modal opens and merged with UW signals.news[ticker] below so UW stays
// supplementary for flow-related headlines.
const [gnNewsItems,setGnNewsItems]=useState([]);
const [gnNewsLoading,setGnNewsLoading]=useState(false);
useEffect(()=>{
  const onKey=e=>{if(e.key==="Escape")onClose();};
  window.addEventListener("keydown",onKey);
  document.body.style.overflow="hidden";
  return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow="";};
},[onClose]);
if(!ticker)return null;
const sc=scanData?.signals?.screener?.[ticker]||{};
const tech=scanData?.signals?.technicals?.[ticker]||{};
const score=scanData?.score_by_ticker?.[ticker];
// Bug #1017 — fetch per-ticker Google News (whitelist + dedupe is done on the
// server). Fires when `ticker` changes. Server already 10m-cached, client
// replaces on each modal open. Failures are swallowed silently so the UW
// supplementary list still renders.
useEffect(()=>{
  if(!ticker) return;
  let cancelled=false;
  setGnNewsLoading(true);
  (async()=>{
    try{
      const companyName=sc.full_name||sc.company_name||"";
      const params=new URLSearchParams({ticker});
      if(companyName) params.set("company",companyName);
      const r=await fetch(`/api/news-per-ticker?${params.toString()}`);
      if(!r.ok) throw new Error(`gn ${r.status}`);
      const d=await r.json();
      if(!cancelled) setGnNewsItems(Array.isArray(d?.items)?d.items:[]);
    }catch(_){
      if(!cancelled) setGnNewsItems([]);
    }finally{
      if(!cancelled) setGnNewsLoading(false);
    }
  })();
  return()=>{cancelled=true;};
// eslint-disable-next-line react-hooks/exhaustive-deps
},[ticker]);
// Signed-in user's own watchlist takes precedence over the scan artifact's
// (empty, public) watchlist. WATCHLIST_FALLBACK is the pre-auth seed list.
const userWLEntry=(watchlistRows||[]).find(w=>w.ticker===ticker);
const watchlistEntry=userWLEntry||(scanData?.watchlist||[]).find(w=>w.ticker===ticker)||WATCHLIST_FALLBACK.find(w=>w.ticker===ticker);
const onUserWatchlist=!!userWLEntry;
// Add current ticker to the signed-in user's watchlist.
async function addToWatchlist(){
  setWlBusy(true);setWlError(null);
  try{
    const {data:{session}}=await supabase.auth.getSession();
    const userId=session?.user?.id;
    if(!userId)throw new Error("Not signed in");
    const sort_order=((watchlistRows||[]).reduce((m,w)=>Math.max(m,w.sort_order||0),0))+1;
    const {error}=await supabase.from("watchlist").insert({
      user_id:userId,ticker:ticker.toUpperCase(),
      name:(sc.full_name||sc.company_name||ticker),theme:"",sort_order,
    });
    if(error)throw error;
    await refetchPortfolio?.();
    // Trigger server-side scan so this modal fills in without waiting
    // for the next scheduled 3:30 PM run.
    onTickerAdded?.(ticker.toUpperCase());
  }catch(err){setWlError(err.message||String(err));}
  finally{setWlBusy(false);}
}
// Remove current ticker from the signed-in user's watchlist.
async function removeFromWatchlist(){
  setWlBusy(true);setWlError(null);
  try{
    const {data:{session}}=await supabase.auth.getSession();
    const userId=session?.user?.id;
    if(!userId)throw new Error("Not signed in");
    const {error}=await supabase.from("watchlist").delete()
      .eq("user_id",userId).eq("ticker",ticker.toUpperCase());
    if(error)throw error;
    await refetchPortfolio?.();
  }catch(err){setWlError(err.message||String(err));}
  finally{setWlBusy(false);}
}
const heldIn=(accounts||[]).flatMap(a=>a.positions.filter(p=>p.ticker===ticker).map(p=>({acct:a,p}))).filter(Boolean);
const price=Number(sc.close||sc.prev_close||0)||null;
const prevClose=Number(sc.prev_close||0)||null;
const dayPct=price&&prevClose?((price-prevClose)/prevClose)*100:null;
const companyName=normalizeTickerName(sc.full_name||sc.company_name||scanData?.ticker_names?.[ticker]||watchlistEntry?.name||heldIn[0]?.p?.name||ticker);
// Legacy 0–100 score gauge retired — the modal now leads with the signal
// composite (−100 → +100) so direction and strength read consistently.
// Manual-track position: on the watchlist but not in the scanner's scored
// universe yet. We still want to show a useful modal (name, theme, held info)
// rather than a box full of dashes. Also fires for OWNED names that haven't
// been picked up by a scanner run yet (so you still get a clear "pending"
// message instead of a fund/ETF disclaimer that doesn't apply).
const isManualTrack=(!!watchlistEntry||heldIn.length>0)&&score==null&&Object.keys(sc).length===0;
// Classify why data is missing so the banner copy matches reality:
//   - "crypto" — BTCUSD / ETHUSD and similar (scanner can't score crypto proxies)
//   - "fund"   — 5-char mutual-fund tickers ending in X (FXAIX, FSKAX, NHXINT906)
//               or known fund sectors ("HY Bonds", "Intl Equity", "Commodity")
//   - "pending"— single-name equity (owned or watchlisted) the scanner just
//               hasn't scored yet on the last run. RCAT added to watchlist
//               yesterday lives here — the data WILL populate next scan.
const fundSectors=new Set(["Commodity","Metals","Crypto","HY Bonds","Intl Equity"]);
const heldSector=heldIn[0]?.p?.sector;
const isCryptoProxy=/USD$/i.test(ticker||"")||/USDT$/i.test(ticker||"");
const isLikelyFund=/^[A-Z]{4,}X$/.test(ticker||"")||/^NH[A-Z]+\d+$/.test(ticker||"")||fundSectors.has(heldSector);
const manualTrackKind=isCryptoProxy?"crypto":isLikelyFund?"fund":"pending";
// Performance (from technicals — scanner stores as fractions: 0.05 = 5%)
const fmtPct=v=>v==null?null:`${v>=0?"+":""}${(v*100).toFixed(1)}%`;
const wk=tech.week_change,mo=tech.month_change,yt=tech.ytd_change;
// Technicals detail
const rsi=tech.rsi_14;
const macd=tech.macd_cross;
const above50=tech.above_50ma;
const above200=tech.above_200ma;
const vol=tech.vol_surge;
const techScore=tech.tech_score;
const ivLvl=sc.iv30d!=null?Number(sc.iv30d)*100:null;
const ivRank=sc.iv_rank!=null?Number(sc.iv_rank):null;
const rv=sc.realized_volatility!=null?Number(sc.realized_volatility)*100:null;
const impMove30=sc.implied_move_perc_30!=null?Number(sc.implied_move_perc_30)*100:(sc.implied_move_perc!=null?Number(sc.implied_move_perc)*100:null);
// Options flow — positive/negative premium flows
const bullPrem=sc.bullish_premium!=null?Number(sc.bullish_premium):null;
const bearPrem=sc.bearish_premium!=null?Number(sc.bearish_premium):null;
const netCallPrem=sc.net_call_premium!=null?Number(sc.net_call_premium):null;
const netPutPrem=sc.net_put_premium!=null?Number(sc.net_put_premium):null;
// Skew: net call premium minus net put premium ($) — positive = bid for
// upside calls (bullish skew), negative = bid for put protection (bearish).
// This is the closest thing to an equity-skew read we have without explicit
// 25-delta IV data.
const flowSkew=(netCallPrem!=null&&netPutPrem!=null)?(netCallPrem-netPutPrem):null;
const callVol=sc.call_volume!=null?Number(sc.call_volume):null;
const putVol=sc.put_volume!=null?Number(sc.put_volume):null;
const callOI=sc.call_open_interest!=null?Number(sc.call_open_interest):null;
const putOI=sc.put_open_interest!=null?Number(sc.put_open_interest):null;
const pcRatio=putOI&&callOI?putOI/callOI:null;
const pcVolRatio=putVol&&callVol?putVol/callVol:null;
const mcap=sc.marketcap!=null?Number(sc.marketcap):null;
const avgVol=sc.avg30_volume!=null?Number(sc.avg30_volume):null;
const relVol=sc.relative_volume!=null?Number(sc.relative_volume):null;
const nextEarn=sc.next_earnings_date;
const nextDiv=sc.next_dividend_date;
const erTime=sc.er_time;  // "premarket" | "postmarket" | null
// Modal enrichment (scanner bakes these into signals.{info,news,analyst_ratings} keyed by ticker).
const info=scanData?.signals?.info?.[ticker]||null;
// Bug #1017 — merge Google News (primary, whitelist-filtered + deduped
// server-side) with UW per-ticker headlines (supplementary — UW is strong
// on flow-related items). Normalize into a single shape so the renderer
// doesn't have to branch. Dedupe across sources by headline.
const _uwNews=scanData?.signals?.news?.[ticker]||[];
const _gnNormalized=(gnNewsItems||[]).map((n)=>({
  headline:n.headline,
  source:n.source||"Google News",
  sourceTier:"google_news",
  description:n.description||"",
  url:n.url||"",
  created_at:n.published||null,
  sentiment:null,
  is_major:false,
}));
const _uwNormalized=_uwNews.map((n)=>({
  headline:n.headline||"",
  source:n.source||"UW",
  sourceTier:"uw",
  description:n.description||"",
  url:n.url||"",
  created_at:n.created_at||null,
  sentiment:n.sentiment||null,
  is_major:!!n.is_major,
}));
const _newsDedupeKey=(h)=>String(h||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim().slice(0,80);
const _newsSeen=new Set();
const news=[..._gnNormalized,..._uwNormalized].filter((n)=>{
  const k=_newsDedupeKey(n.headline);
  if(!k) return false;
  if(_newsSeen.has(k)) return false;
  _newsSeen.add(k);
  return true;
}).sort((a,b)=>{
  const ta=a.created_at?new Date(a.created_at).getTime():0;
  const tb=b.created_at?new Date(b.created_at).getTime():0;
  return tb-ta;
});
const analystRatings=scanData?.signals?.analyst_ratings?.[ticker]||[];
// sector comes from /api/stock/{t}/info (NOT the screener row) — fall back to screener row if present.
const sector=info?.sector||sc.sector||null;
const tags=info?.tags||[];
const shortDesc=info?.short_description||null;
const longDesc=info?.long_description||null;
// announce_time from /info is the same field as er_time from screener — use whichever exists.
const earnTimeForChip=erTime||info?.announce_time||null;
// Short interest (FINRA biweekly via yfinance — lagged ~15 days, NEVER real-time)
const siPctFloat=sc.short_pct_float!=null?Number(sc.short_pct_float):null;
const siPctSOut=sc.short_pct_shares_out!=null?Number(sc.short_pct_shares_out):null;
const siDaysCover=sc.days_to_cover!=null?Number(sc.days_to_cover):null;
const sharesShort=sc.shares_short!=null?Number(sc.shares_short):null;
const sharesShortPrior=sc.shares_short_prior!=null?Number(sc.shares_short_prior):null;
const siAsOf=sc.short_as_of;
const siTrendPct=(sharesShort!=null&&sharesShortPrior!=null&&sharesShortPrior>0)?((sharesShort-sharesShortPrior)/sharesShortPrior)*100:null;
const fmt$=v=>v==null?"—":`$${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmt$M=v=>v==null?"—":v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:`$${v.toFixed(0)}`;
const fmt$signed=v=>v==null?"—":(v>=0?"+":"")+fmt$M(Math.abs(v));
const fmtNum=v=>v==null?"—":v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:v.toLocaleString();
// Activity rows (filter scanData signals by this ticker)
const rowsFor=(list)=>(list||[]).filter(r=>(r?.ticker||"").toUpperCase()===ticker);
const congressBuys=rowsFor(scanData?.signals?.congress_buys);
const congressSells=rowsFor(scanData?.signals?.congress_sells);
const insiderBuys=rowsFor(scanData?.signals?.insider_buys);
const insiderSells=rowsFor(scanData?.signals?.insider_sales);
const flowCalls=rowsFor(scanData?.signals?.flow_alerts);
const flowPuts=rowsFor(scanData?.signals?.put_flow_alerts);
const darkPoolPrints=rowsFor(scanData?.signals?.darkpool);
const congressCt=congressBuys.length+congressSells.length;
const insiderCt=insiderBuys.length+insiderSells.length;
const flowCt=flowCalls.length+flowPuts.length;
const dpCt=darkPoolPrints.length;
// ScoreGauge (legacy 0–100) removed — see comment on retired scoreCol above.
const panelStyle={background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"};
const sectionLabel={fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:8,fontWeight:600};
const kpiBox={background:"var(--surface-3)",borderRadius:5,padding:"8px 10px"};
const kpiLabelBase={fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:3};
const kpiValue={fontSize:14,fontWeight:700,fontFamily:"var(--font-mono)"};
// Reusable KPI with hover-tooltip on the label (little ⓘ marker). Every metric
// in the modal gets one so nothing reads as a mystery number.
const Kpi=({label,value,color,sub,tip})=>(
<div style={kpiBox}>
<div style={{...kpiLabelBase,display:"flex",alignItems:"center",gap:2}}>{label}{tip&&<InfoTip def={tip} size={10}/>}</div>
<div style={{...kpiValue,color:color||"var(--text)"}}>{value}</div>
{sub&&<div style={{fontSize:9,color:"var(--text-dim)",marginTop:2}}>{sub}</div>}
</div>
);
const rsiColor=rsi==null?"var(--text-dim)":rsi>=70?"#ff453a":rsi<=30?"#30d158":"var(--text)";
const macdColor=macd==="bullish"?"#30d158":macd==="bearish"?"#ff453a":"var(--text)";
const ma50Color=above50==null?"var(--text-dim)":above50?"#30d158":"#ff453a";
const ma200Color=above200==null?"var(--text-dim)":above200?"#30d158":"#ff453a";
const volColor=vol==null?"var(--text-dim)":vol>=2?"#30d158":vol>=1?"var(--text)":"var(--text-dim)";
const ivRankColor=ivRank==null?"var(--text-dim)":ivRank>=70?"#ff453a":ivRank<=30?"#30d158":"var(--text)";
const techScoreCol=techScore==null?"var(--text-dim)":techScore>=2?"#30d158":techScore>=-1?"var(--text)":"#ff453a";
// Section composites — signed −100..+100 per category, with weighted overall.
// This is the "distill the signals" view: legacy 0–100 is bullish-only, these
// expose direction. See ./ticker/sectionComposites.js for the math.
const composite=computeSectionComposites(ticker,scanData);
// Compact pill renderer — one per section. Clicking scrolls to the section panel.
const CompositePill=({sec,onClick})=>{
  const col=colorForDirection(sec.direction);
  const valStr=sec.score==null?"—":(sec.score>=0?"+":"")+sec.score;
  return(
  <button
    type="button"
    onClick={onClick}
    title={(Array.isArray(sec.components)?sec.components:[]).map(c=>c.label+(c.points!=null?` (${c.points>=0?"+":""}${c.points})`:"")).join("\n")}
    style={{
      flex:"1 1 0",minWidth:94,textAlign:"left",
      background:"var(--surface-3)",border:`1px solid ${sec.score!=null&&sec.score!==0?col+"66":"var(--border-faint)"}`,
      borderRadius:5,padding:"7px 9px",cursor:onClick?"pointer":"default",
      transition:"border-color 0.15s",
    }}
  >
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
      <span style={{fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600,textTransform:"uppercase"}}>{sec.name}</span>
      <span style={{fontSize:8,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{sec.weight}%</span>
    </div>
    <div style={{fontSize:17,fontWeight:800,fontFamily:"var(--font-mono)",color:col,lineHeight:1.1}}>{valStr}</div>
    <div style={{fontSize:8,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.05em",marginTop:2}}>{sec.label}</div>
  </button>);
};
// Small inline badge used at each section panel header.
const CompositeBadge=({sec})=>{
  if(!sec||sec.score==null)return null;
  const col=colorForDirection(sec.direction);
  const v=(sec.score>=0?"+":"")+sec.score;
  return(
  <span style={{
    display:"inline-flex",alignItems:"center",gap:5,marginLeft:8,
    fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,
    color:col,background:col+"15",border:`1px solid ${col}55`,
    borderRadius:4,padding:"1px 6px",letterSpacing:"0.04em",
  }}>
    <span>{v}</span>
    <span style={{color:"var(--text-dim)",fontWeight:500}}>· {sec.label}</span>
  </span>);
};
const scrollToSection=(id)=>{
  const el=document.getElementById(id);
  if(el)el.scrollIntoView({behavior:"smooth",block:"start"});
};
return(
<div className="modal-backdrop" onClick={onClose}>
<div className="modal-wrap">
<div className="modal-sheet" onClick={e=>e.stopPropagation()} style={{position:"relative",padding:"var(--space-5) var(--space-5) var(--space-4)"}}>
<button className="modal-close" onClick={onClose} aria-label="Close">×</button>
{/* Header */}
<div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:"var(--space-4)",paddingRight:40}}>
<div style={{width:4,height:44,background:colorForDirection(composite?.overall?.direction),borderRadius:2,flexShrink:0,marginTop:2}}/>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
<h2 style={{fontSize:22,fontWeight:700,color:"var(--text)",margin:0,fontFamily:"var(--font-mono)",letterSpacing:"-0.01em"}}>{ticker}</h2>
{heldIn.length>0&&<span style={{fontSize:10,color:"var(--accent)",border:"1px solid rgba(10,132,255,0.35)",background:"rgba(10,132,255,0.10)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600}}>OWNED</span>}
{isManualTrack&&<span style={{fontSize:10,color:"var(--text-muted)",border:"1px dashed var(--border)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600}}>MANUAL TRACK</span>}
{watchlistEntry&&!heldIn.length&&!isManualTrack&&<span style={{fontSize:10,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600}}>WATCHLIST</span>}
{portfolioAuthed&&(onUserWatchlist
  ?<button type="button" onClick={removeFromWatchlist} disabled={wlBusy}
     style={{fontSize:10,color:"#ff453a",background:"transparent",border:"1px solid rgba(255,69,58,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.03em"}}
     title="Remove this ticker from your watchlist">{wlBusy?"…":"− REMOVE"}</button>
  :<button type="button" onClick={addToWatchlist} disabled={wlBusy}
     style={{fontSize:10,color:"var(--accent)",background:"rgba(10,132,255,0.08)",border:"1px solid rgba(10,132,255,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.03em"}}
     title="Add this ticker to your watchlist">{wlBusy?"…":"+ WATCHLIST"}</button>
)}
{wlError&&<span style={{fontSize:10,color:"#ff453a",fontFamily:"var(--font-mono)"}}>{wlError}</span>}
</div>
{companyName&&companyName!==ticker&&<div style={{fontSize:14,color:"var(--text-muted)",marginBottom:2,fontWeight:500}}>{companyName}</div>}
{(sector||tags.length>0)&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}>
{sector&&<span style={{fontSize:10,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 7px",fontFamily:"var(--font-mono)",fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{sector}</span>}
{tags.slice(0,4).map(tg=>(<span key={tg} style={{fontSize:10,color:"var(--text-dim)",border:"1px solid var(--border-faint)",borderRadius:4,padding:"2px 7px",fontFamily:"var(--font-mono)",fontWeight:500,letterSpacing:"0.04em",textTransform:"uppercase"}}>{tg}</span>))}
</div>}
{(shortDesc||longDesc)&&(()=>{
  const DESC_LIMIT=140;
  // Prefer the real long description when expanded; otherwise the teaser.
  // UW's short_description already ends in literal "..." (truncated at source);
  // strip it so we don't double-ellipsis when collapsed.
  const teaser=(shortDesc||longDesc||"").replace(/\s*\.\.\.\s*$/,"").replace(/\s*…\s*$/,"");
  const fullText=longDesc||teaser;
  const canExpand=!!longDesc&&longDesc.length>teaser.length+20;
  const needsCollapse=teaser.length>DESC_LIMIT;
  const collapsed=needsCollapse?teaser.slice(0,DESC_LIMIT).replace(/\s\S*$/,"")+"…":teaser;
  const isLong=canExpand||needsCollapse;
  const shown=descExpanded?fullText:(isLong?collapsed:teaser);
  return(
  <div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.5,marginTop:6,maxWidth:640}}>
  {shown}
  {isLong&&<span onClick={e=>{e.stopPropagation();setDescExpanded(v=>!v);}} style={{marginLeft:6,color:"var(--accent)",cursor:"pointer",fontSize:11,fontFamily:"var(--font-mono)"}}>{descExpanded?"less ↑":"more ↓"}</span>}
  </div>);
})()}
{watchlistEntry?.theme&&<div style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)",marginTop:3}}>{watchlistEntry.theme}</div>}
</div>
<div style={{textAlign:"right",flexShrink:0}}>
<div className="num" style={{fontSize:24,fontWeight:800,color:"var(--text)",lineHeight:1,fontFamily:"var(--font-mono)"}}>{price?fmt$(price):"—"}</div>
{dayPct!=null&&<div style={{fontSize:12,fontWeight:700,color:dayPct>=0?"#30d158":"#ff453a",fontFamily:"var(--font-mono)",marginTop:4}}>{dayPct>=0?"+":""}{dayPct.toFixed(2)}% today</div>}
{/* Universe-snapshot freshness — stamps the price so the user knows whether
    this is a 10:00 / 13:00 / 15:45 ET snapshot or yesterday's close. Hidden
    when scanData.universe_snapshot_ts is null (signed-out view). */}
{(scanData?.universe_snapshot_ts||scanData?.ticker_events_ts)&&<div style={{marginTop:4}}><UniverseFreshness pricesTs={scanData.universe_snapshot_ts} eventsTs={scanData.ticker_events_ts} compact/></div>}
</div>
</div>

{/* Score Gauge + Signal Breakdown. Tickers that the scanner can't score
    (funds, ETFs, crypto proxies, or symbols outside yfinance/UW coverage)
    get the same composite frame rendered with "—" placeholders + a small
    banner explaining why. Keeps every modal structurally consistent. */}
<div style={panelStyle}>
{isManualTrack&&(
<div style={{fontSize:11,color:"var(--text-muted)",background:"var(--surface-3)",border:"1px solid var(--border-faint)",borderRadius:5,padding:"7px 10px",marginBottom:10,lineHeight:1.45}}>
{scanBusy&&manualTrackKind==="pending"?(
<><span style={{color:"var(--text)",fontWeight:600}}>Scanning fresh data…</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Pulling news, company info, analyst ratings, and screener stats from Unusual Whales — usually 3–5 seconds. Technical indicators (TECH subcomposite) populate on the next scheduled scan.</>
):manualTrackKind==="pending"?(
<><span style={{color:"var(--text)",fontWeight:600}}>Scanner data pending.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}This ticker isn't in the last scan yet — directional scores will populate on the next run. News, analyst ratings, and {heldIn.length>0?"position detail":"watchlist context"} still render below if available.</>
):manualTrackKind==="crypto"?(
<><span style={{color:"var(--text)",fontWeight:600}}>No subcomposite data.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Crypto proxies (BTCUSD / ETHUSD) don't have the single-name equity signals (options flow, insider/congress filings, analyst ratings) the composite blends, so directional scores stay blank. Hold info and watchlist context still render above.</>
):(
<><span style={{color:"var(--text)",fontWeight:600}}>No subcomposite data.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Subcomposite scores are computed for single-name equities only — not mutual funds, ETFs, or broad-index funds. Hold info and watchlist context still render above; directional scores will stay blank for this symbol.</>
)}
</div>
)}
<div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:10,flexWrap:"wrap"}}>
<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600}}>SIGNAL COMPOSITE</div>
{composite?.overall?.score!=null?(<>
<span style={{fontSize:30,fontWeight:800,color:colorForDirection(composite.overall.direction),fontFamily:"var(--font-mono)",lineHeight:1}}>
{composite.overall.score>=0?"+":""}{composite.overall.score}
</span>
<span style={{fontSize:11,color:colorForDirection(composite.overall.direction),fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600}}>
{composite.overall.label}
</span>
</>):composite?(
<span style={{fontSize:30,fontWeight:800,color:"var(--text-dim)",fontFamily:"var(--font-mono)",lineHeight:1}}>—</span>
):null}
<div style={{flexBasis:"100%",fontSize:11,color:"var(--text-muted)",lineHeight:1.4,marginTop:2}}>
Weighted blend of the six sections below (−100 bearish … +100 bullish) so you can see direction AND strength at a glance. Click a pill to jump to the section.
</div>
</div>
{composite&&(
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{composite.order.map(k=>{
  const sec=composite.sections[k];
  const anchorMap={technicals:"sec-technical",options:"sec-options",insider:"sec-activity",congress:"sec-activity",analyst:"sec-analyst",darkpool:"sec-darkpool"};
  return <CompositePill key={k} sec={sec} onClick={()=>scrollToSection(anchorMap[k])}/>;
})}
</div>
)}
</div>

{/* Performance strip */}
{(wk!=null||mo!=null||yt!=null)&&(
<div style={panelStyle}>
<div style={sectionLabel}>PERFORMANCE</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
<Kpi label="1W" value={wk==null?"—":fmtPct(wk)} color={wk==null?"var(--text-dim)":wk>=0?"#30d158":"#ff453a"} tip="Price change over the last 5 trading days."/>
<Kpi label="1M" value={mo==null?"—":fmtPct(mo)} color={mo==null?"var(--text-dim)":mo>=0?"#30d158":"#ff453a"} tip="Price change over the last ~21 trading days."/>
<Kpi label="YTD" value={yt==null?"—":fmtPct(yt)} color={yt==null?"var(--text-dim)":yt>=0?"#30d158":"#ff453a"} tip="Price change since Jan 1 of the current year."/>
</div>
</div>
)}

{/* Technicals — hide entirely for manual-track tickers where every field is null */}
{(rsi!=null||macd!=null||above50!=null||above200!=null||vol!=null||rv!=null)&&(
<div id="sec-technical" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center"}}><span>TECHNICAL ANALYSIS</span><CompositeBadge sec={composite?.sections?.technicals}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
{rsi!=null&&<Kpi label="RSI-14" value={rsi.toFixed(1)} color={rsiColor} sub={rsi>=70?"overbought":rsi<=30?"oversold":"neutral"} tip="Relative Strength Index over 14 days. Oscillator from 0-100. Above 70 is traditionally 'overbought' (stretched, prone to pullback); below 30 is 'oversold' (bid for a bounce). Between 30-70 is neutral momentum."/>}
{macd!=null&&<Kpi label="MACD CROSS" value={macd} color={macdColor} tip="Moving Average Convergence Divergence. 'bullish' = the 12-day EMA just crossed ABOVE the 26-day EMA in the last 3 days (momentum shift up). 'bearish' = crossed below (momentum down). 'neutral' = no recent cross."/>}
{above50!=null&&<Kpi label="VS 50-DAY MA" value={above50?"above":"below"} color={ma50Color} tip="Is the price above or below its 50-day simple moving average? Above = short-term uptrend. Below = short-term downtrend."/>}
{above200!=null&&<Kpi label="VS 200-DAY MA" value={above200?"above":"below"} color={ma200Color} tip="Is the price above or below its 200-day simple moving average? Above = long-term bull trend (institutional reference line). Below = long-term bear / correction."/>}
{vol!=null&&<Kpi label="VOL SURGE" value={`${vol.toFixed(2)}×`} color={volColor} sub="vs 30d avg" tip="Today's trading volume divided by the 20-day average. 1.0× = normal day. >2× = heavy interest (often tied to news, breakouts, or institutional activity). <0.5× = quiet."/>}
{rv!=null&&<Kpi label="REALIZED VOL 30D" value={`${rv.toFixed(0)}%`} color="var(--text)" tip="Actual price volatility observed over the past 30 days (annualized). Compare to implied vol to see if options are priced richer or cheaper than the stock's recent behavior."/>}
</div>
</div>
)}

{/* Options — IV + flow skew */}
{(ivLvl!=null||ivRank!=null||bullPrem!=null||flowSkew!=null||impMove30!=null||pcRatio!=null)&&(
<div id="sec-options" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center"}}><span>OPTIONS · IV · FLOW SKEW</span><CompositeBadge sec={composite?.sections?.options}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
{ivRank!=null&&<Kpi label="IV RANK" value={`${ivRank.toFixed(0)}`} color={ivRankColor} sub={ivRank>=70?"IV expensive":ivRank<=30?"IV cheap":"mid-range"} tip="Where current 30-day implied volatility sits in its 52-week range, 0-100. IV Rank 0 = IV is at a 1-year LOW (options cheap, favors buying calls/puts). IV Rank 100 = IV is at a 1-year HIGH (options expensive, favors premium selling — covered calls, cash-secured puts). >70 is the scanner's threshold to screen for covered-call setups."/>}
{ivLvl!=null&&<Kpi label="IV 30D LEVEL" value={`${ivLvl.toFixed(0)}%`} color="var(--text)" tip={`Annualized implied volatility priced into 30-day options (${ivLvl.toFixed(0)}%). Interpretation: the options market expects the stock to move roughly ±${(ivLvl/Math.sqrt(12)).toFixed(0)}% over the next month (1σ). Higher = more expected motion. Compare to realized vol to see the vol premium.`}/>}
{impMove30!=null&&<Kpi label="IMPLIED MOVE 30D" value={`±${impMove30.toFixed(1)}%`} color="var(--text)" tip="Expected price range over the next 30 days implied by at-the-money option prices (1σ). E.g. ±6% means the options market is pricing ~68% probability the stock stays within ±6% over a month."/>}
{flowSkew!=null&&<Kpi label="FLOW SKEW" value={fmt$signed(flowSkew)} color={flowSkew>=0?"#30d158":"#ff453a"} sub={flowSkew>=0?"bid for upside":"bid for downside"} tip="Net call premium minus net put premium (dollars). Positive = today's options flow is net paying for upside exposure (calls); negative = net paying for downside protection (puts). This is the scanner's closest equity-skew read — more positive = more bullish flow."/>}
{netCallPrem!=null&&<Kpi label="NET CALL PREM" value={fmt$signed(netCallPrem)} color={netCallPrem>=0?"#30d158":"var(--text-dim)"} tip="Dollar premium paid for calls at the ask MINUS premium hit at the bid. Positive = aggressive call buying; negative = net call selling."/>}
{netPutPrem!=null&&<Kpi label="NET PUT PREM" value={fmt$signed(netPutPrem)} color={netPutPrem>=0?"#ff453a":"var(--text-dim)"} tip="Dollar premium paid for puts at the ask MINUS premium hit at the bid. Positive = aggressive put buying (hedging or directional bear bets); negative = net put selling (often income / yield)."/>}
{pcRatio!=null&&<Kpi label="PUT/CALL OI" value={pcRatio.toFixed(2)} color={pcRatio>1?"#ff453a":pcRatio<0.7?"#30d158":"var(--text)"} sub={`calls ${fmtNum(callOI)} · puts ${fmtNum(putOI)}`} tip="Put open interest divided by call open interest. >1.0 means more put positioning than call (often hedged long books or bearish); <0.7 skews bullish. Extreme values (>2 or <0.3) can be contrarian signals."/>}
{pcVolRatio!=null&&<Kpi label="PUT/CALL VOL" value={pcVolRatio.toFixed(2)} color={pcVolRatio>1?"#ff453a":pcVolRatio<0.7?"#30d158":"var(--text)"} sub="today's flow direction" tip="Today's put volume divided by call volume. Measures today's directional flow (vs OI which measures accumulated positioning). Moving above 1 intraday often signals stress buying; below 0.7 signals call chase."/>}
</div>
</div>
)}

{/* Short interest — FINRA biweekly, ~15-day lag, NEVER real-time */}
{(siPctFloat!=null||siPctSOut!=null||siDaysCover!=null)&&(()=>{
  const pf=siPctFloat!=null?siPctFloat:siPctSOut;  // prefer % of float, fall back to % of shares out
  const pfPct=pf!=null?pf*100:null;
  const siCol=pfPct==null?"var(--text-dim)":pfPct>=25?"#ff453a":pfPct>=15?"#ff9f0a":pfPct>=5?"#B8860B":"#30d158";
  const siLabel=pfPct==null?"":pfPct>=25?"squeeze setup":pfPct>=15?"elevated":pfPct>=5?"moderate":"low";
  const dtcCol=siDaysCover==null?"var(--text-dim)":siDaysCover>=7?"#ff453a":siDaysCover>=3?"#ff9f0a":"var(--text)";
  const trendCol=siTrendPct==null?"var(--text-dim)":siTrendPct>=10?"#ff453a":siTrendPct<=-10?"#30d158":"var(--text)";
  const usingSOut=siPctFloat==null&&siPctSOut!=null;
  return(
  <div style={panelStyle}>
  <div style={sectionLabel}>SHORT INTEREST {siAsOf?`· as of ${siAsOf}`:""}</div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
  {pfPct!=null&&<Kpi label={usingSOut?"SI % SHARES OUT":"SI % FLOAT"} value={`${pfPct.toFixed(1)}%`} color={siCol} sub={siLabel} tip={`Short interest as a percentage of ${usingSOut?"shares outstanding":"float"}. The classic squeeze indicator — high SI on a name showing bullish setup (rising price, positive flow, congress/insider buys) is a setup for a short squeeze. Buckets: <5% low (no edge); 5–15% moderate; 15–25% elevated (worth watching); >25% squeeze setup (GME peak was 140%+).${siPctFloat==null?" Note: this ticker only reports % of shares outstanding, not float.":""}`}/>}
  {siDaysCover!=null&&<Kpi label="DAYS TO COVER" value={`${siDaysCover.toFixed(1)}d`} color={dtcCol} sub={siDaysCover>=7?"hard to exit":siDaysCover>=3?"meaningful":"easy to cover"} tip="Short interest divided by 30-day average daily share volume — how many trading days it would take shorts to fully cover at typical volume. Low days-to-cover (<3) means shorts can exit cleanly; high (>7) means any squeeze gets violent because shorts can't get out fast enough."/>}
  {sharesShort!=null&&<Kpi label="SHARES SHORT" value={fmtNum(sharesShort)} color="var(--text)" sub={siTrendPct!=null?`${siTrendPct>=0?"+":""}${siTrendPct.toFixed(1)}% vs prior`:""} tip="Total shares sold short at the last FINRA report (biweekly). Compare to prior-month figure (sub-text) to see if shorts are pressing the trade or covering — bears doubling down (rising SI) into a rising price is a classic squeeze setup."/>}
  {siTrendPct!=null&&<Kpi label="SI TREND" value={`${siTrendPct>=0?"+":""}${siTrendPct.toFixed(1)}%`} color={trendCol} sub={siTrendPct>=10?"shorts pressing":siTrendPct<=-10?"shorts covering":"flat"} tip="Change in shares short vs the prior bi-weekly report. Rising SI (>+10%) into a rising price = bears doubling down (squeeze fuel). Falling SI (<-10%) = shorts already covering (squeeze likely played out)."/>}
  </div>
  <div style={{fontSize:9,color:"var(--text-dim)",marginTop:8,fontStyle:"italic"}}>FINRA reports SI biweekly with a ~15-day lag — this data is never real-time.</div>
  </div>
  );
})()}

{/* Market structure */}
{(mcap!=null||avgVol!=null||nextEarn||nextDiv)&&(
<div style={panelStyle}>
<div style={sectionLabel}>MARKET STRUCTURE</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
{mcap!=null&&<Kpi label="MARKET CAP" value={fmt$M(mcap)} color="var(--text)" tip="Total market capitalization (shares × price). Rough size buckets: <$300M microcap, $300M-2B small, $2-10B mid, $10-200B large, >$200B mega."/>}
{avgVol!=null&&price!=null&&<Kpi label="AVG $VOL 30D" value={fmt$M(avgVol*price)} color="var(--text)" sub="liquidity, last 30d" tip="Average daily DOLLAR volume over the past 30 days (avg shares × close). This is the comparable liquidity read across tickers — raw share counts don't compare (a $0.50 penny stock can trade more shares than BRK.A). Rough institutional buckets: <$10M illiquid (wide spreads, slippage on size); $10M-100M tradable but be careful with size; >$100M deep enough for most positions; >$1B mega-liquid."/>}
{relVol!=null&&<Kpi label="RELATIVE VOL" value={`${relVol.toFixed(2)}×`} color={relVol>=2?"#30d158":relVol>=1?"var(--text)":"var(--text-dim)"} sub="vs 30d avg" tip="End-of-session relative volume from the daily 3:30 PM ET scan: prior session's full-day volume divided by the 30-day average. >1× = heavier than typical (often news/catalyst); <1× = quieter than typical. NOT a real-time intraday pace — the dashboard is fed by a once-daily scan."/>}
{(nextEarn||info?.next_earnings_date)&&<Kpi label="NEXT EARNINGS" value={String(nextEarn||info?.next_earnings_date).slice(0,10)} color="var(--text)" sub={earnTimeForChip==="premarket"?"before open":earnTimeForChip==="postmarket"?"after close":""} tip={`Next scheduled earnings release date${earnTimeForChip?` (${earnTimeForChip==="premarket"?"reports before the open":"reports after the close"})`:""}. IV often inflates into earnings and crushes immediately after — relevant for any options trades.`}/>}
{nextDiv&&<Kpi label="NEXT DIVIDEND" value={String(nextDiv).slice(0,10)} color="var(--text)" tip="Next ex-dividend date. Covered-call writers should be aware — American-style calls that are deep-ITM may be exercised early before the ex-dividend date."/>}
</div>
</div>
)}

{/* Held position detail (if owned) */}
{heldIn.length>0&&(
<div style={panelStyle}>
<div style={sectionLabel}>HELD · {heldIn.length===1?heldIn[0].acct.label:`${heldIn.length} accounts`}</div>
{heldIn.map(({acct,p})=>{
  const pnlPct=p.avgCost?((p.price/p.avgCost-1)*100):null;
  const col=pnlPct==null?"var(--text-muted)":pnlPct>=0?"#30d158":"#ff453a";
  return(
  <div key={acct.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--border-faint)",fontSize:12,fontFamily:"var(--font-mono)",gap:8,flexWrap:"wrap"}}>
  <span style={{color:"var(--text)"}}>{acct.label}</span>
  <span style={{color:"var(--text-muted)"}}>{p.quantity.toLocaleString()} qty · cost {fmt$(p.avgCost)}</span>
  <span style={{color:"var(--text)",fontWeight:700}}>{fmt$(p.value)}</span>
  {pnlPct!=null&&<span style={{color:col,fontWeight:600}}>{pnlPct>=0?"+":""}{pnlPct.toFixed(1)}%</span>}
  </div>
  );
})}
</div>
)}

{/* Activity: Congress / Insider / Flow rows — full scanner detail, inlined */}
{(congressCt>0||insiderCt>0||flowCt>0)&&(
<div id="sec-activity" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center",flexWrap:"wrap"}}>
<span>ACTIVITY</span>
{congressCt>0&&<CompositeBadge sec={composite?.sections?.congress}/>}
{insiderCt>0&&<CompositeBadge sec={composite?.sections?.insider}/>}
</div>
{congressBuys.length+congressSells.length>0&&(
<div style={{marginBottom:10}}>
<div style={{fontSize:10,color:"var(--blue)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>CONGRESSIONAL TRADES ({congressCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...congressBuys.map(r=>({...r,kind:"BUY"})),...congressSells.map(r=>({...r,kind:"SELL"}))].slice(0,8).map((r,i)=>(
<div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
<span style={{fontSize:9,fontWeight:700,color:r.kind==="BUY"?"#30d158":"#ff453a",minWidth:28}}>{r.kind}</span>
<span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name||r.reporter||"—"}{r.member_type?<span style={{color:"var(--text-dim)",marginLeft:6,textTransform:"capitalize"}}>· {r.member_type}</span>:null}</span>
<span style={{color:"var(--text-muted)"}}>{r.amounts||r.amount||r.disclosed_amount||"—"}</span>
<span style={{color:"var(--text-dim)"}}>{String(r.transaction_date||r.filed_at_date||r.disclosure_date||"").slice(0,10)}</span>
</div>
))}
</div>
</div>
)}
{insiderBuys.length+insiderSells.length>0&&(
<div style={{marginBottom:10}}>
<div style={{fontSize:10,color:"var(--purple)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>INSIDER TRANSACTIONS ({insiderCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...insiderBuys.map(r=>({...r,kind:"BUY"})),...insiderSells.map(r=>({...r,kind:"SELL"}))].slice(0,8).map((r,i)=>{
  // Real scan-data fields: owner_name, officer_title, shares_owned_before/after, price/price_per_share/stock_price, transaction_date, filing_date
  const insiderName=r.owner_name||r.insider_name||r.name||"—";
  const insiderTitle=r.officer_title||r.insider_title||(r.is_director?"Director":r.is_ten_percent_owner?"10% owner":"");
  const priceN=r.price_per_share?Number(r.price_per_share):r.price?Number(r.price):r.stock_price?Number(r.stock_price):null;
  const sharesBefore=r.shares_owned_before!=null?Number(r.shares_owned_before):null;
  const sharesAfter=r.shares_owned_after!=null?Number(r.shares_owned_after):null;
  const rawShares=r.quantity!=null?Number(r.quantity):(r.amount!=null?Number(r.amount):null);
  const sharesTraded=(sharesBefore!=null&&sharesAfter!=null)?Math.abs(sharesAfter-sharesBefore):rawShares;
  const value=(sharesTraded!=null&&priceN!=null)?sharesTraded*priceN:null;
  const dateStr=String(r.filing_date||r.transaction_date||"").slice(0,10);
  return(
  <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
  <span style={{fontSize:9,fontWeight:700,color:r.kind==="BUY"?"#30d158":"#ff453a",minWidth:28}}>{r.kind}</span>
  <span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{insiderName}{insiderTitle?<span style={{color:"var(--text-dim)",marginLeft:6}}>· {insiderTitle}</span>:null}</span>
  <span style={{color:"var(--text-muted)"}}>{value!=null?fmt$M(value):sharesTraded!=null?`${fmtNum(sharesTraded)} sh`:"—"}</span>
  <span style={{color:"var(--text-dim)"}}>{dateStr}</span>
  </div>
  );
})}
</div>
</div>
)}
{flowCalls.length+flowPuts.length>0&&(
<div>
<div style={{fontSize:10,color:"var(--orange)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>UNUSUAL OPTIONS FLOW ({flowCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...flowCalls.map(r=>({...r,side:"CALL"})),...flowPuts.map(r=>({...r,side:"PUT"}))].slice(0,8).map((r,i)=>{
  const isCall=r.side==="CALL";
  const mono=r.strike&&r.underlying_price?((Number(r.strike)-Number(r.underlying_price))/Number(r.underlying_price)*100):null;
  return(
  <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
  <span style={{fontSize:9,fontWeight:700,color:isCall?"#30d158":"#ff453a",minWidth:28}}>{r.side}</span>
  <span style={{color:"var(--text)"}}>{r.strike?fmt$(Number(r.strike)):"—"} {r.expiry||r.expires?`exp ${String(r.expiry||r.expires).slice(0,10)}`:""}</span>
  <span style={{color:"var(--text-muted)",flex:1}}>{mono!=null?`${mono>=0?"+":""}${mono.toFixed(1)}% OTM`:""}</span>
  <span style={{color:isCall?"#30d158":"#ff453a",fontWeight:700}}>{r.total_premium?fmt$M(Number(r.total_premium)):"—"}</span>
  </div>
  );
})}
</div>
</div>
)}
</div>
)}

{/* ANALYST RATINGS — aggregated buy/hold/sell counts + avg price target,
    then 5 most recent rating actions. Data from UW /api/screener/analysts. */}
{/* Dark Pool activity — tiebreaker-only signal (max ±20 in composite). */}
{dpCt>0&&(()=>{
  const totalPrem=darkPoolPrints.reduce((s,r)=>s+(Number(r.premium)||0),0);
  // Direction proxy via NBBO-midpoint relationship (match composite logic).
  let bull=0,bear=0;
  for(const r of darkPoolPrints){
    const b=Number(r.nbbo_bid),a=Number(r.nbbo_ask),p=Number(r.price);
    if(b>0&&a>0&&p>0){const m=(b+a)/2;if(p>m)bull++;else if(p<m)bear++;}
  }
  return(
  <div id="sec-darkpool" style={panelStyle}>
  <div style={{...sectionLabel,display:"flex",alignItems:"center"}}>
  <span>DARK POOL PRINTS · {dpCt}</span>
  <CompositeBadge sec={composite?.sections?.darkpool}/>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:8}}>
  <Kpi label="PRINTS TODAY" value={dpCt} color="var(--text)" tip="Count of large off-exchange (dark pool) prints matched to this ticker in today's scan."/>
  <Kpi label="TOTAL PREMIUM" value={fmt$M(totalPrem)} color="var(--text)" tip="Sum of notional (price × size) across today's dark pool prints for this ticker."/>
  <Kpi label="DIRECTION" value={bull>bear?"bid-lifted":bear>bull?"bid-hit":"mixed"} color={bull>bear?"#30d158":bear>bull?"#ff453a":"var(--text-muted)"} sub={`${bull} above-mid · ${bear} below-mid`} tip="Heuristic: print price vs NBBO midpoint. Above midpoint = buyer lifted the offer (accumulation bias). Below midpoint = seller hit the bid (distribution bias). Dark pool is always a weak signal — use as a tiebreaker only."/>
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:3}}>
  {darkPoolPrints.slice(0,5).map((r,i)=>{
    const b=Number(r.nbbo_bid),a=Number(r.nbbo_ask),p=Number(r.price);
    const mid=(b>0&&a>0)?(b+a)/2:null;
    const vsMid=mid?p-mid:null;
    const tag=vsMid==null?"":vsMid>0?"▲ ask":vsMid<0?"▼ bid":"= mid";
    const col=vsMid==null?"var(--text-muted)":vsMid>0?"#30d158":vsMid<0?"#ff453a":"var(--text-muted)";
    return(
    <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
    <span style={{color:col,fontWeight:700,minWidth:48}}>{tag}</span>
    <span style={{color:"var(--text)",flex:1}}>{Number(r.size).toLocaleString()} sh @ {fmt$(p)}</span>
    <span style={{color:"var(--text-muted)"}}>{fmt$M(Number(r.premium)||0)}</span>
    <span style={{color:"var(--text-dim)"}}>{String(r.executed_at||"").slice(11,16)}</span>
    </div>);
  })}
  </div>
  <div style={{fontSize:9,color:"var(--text-dim)",marginTop:8,fontStyle:"italic"}}>Dark pool is a weak signal — capped at ±20 in the section composite.</div>
  </div>);
})()}

{analystRatings.length>0&&(()=>{
  const recs=analystRatings.map(r=>(r.recommendation||"").toLowerCase());
  const nBuy=recs.filter(r=>r==="buy"||r==="strong_buy"||r==="overweight").length;
  const nHold=recs.filter(r=>r==="hold"||r==="neutral").length;
  const nSell=recs.filter(r=>r==="sell"||r==="strong_sell"||r==="underweight").length;
  const targets=analystRatings.map(r=>parseFloat(r.target)).filter(v=>!isNaN(v)&&v>0);
  const avgTarget=targets.length?targets.reduce((a,b)=>a+b,0)/targets.length:null;
  const upside=(avgTarget&&price)?((avgTarget-price)/price)*100:null;
  const lastDate=analystRatings[0]?.timestamp?String(analystRatings[0].timestamp).slice(0,10):null;
  return(
  <div id="sec-analyst" style={panelStyle}>
  <div style={{...sectionLabel,display:"flex",alignItems:"center"}}>
  <span>ANALYST RATINGS · {analystRatings.length} recent</span>
  <CompositeBadge sec={composite?.sections?.analyst}/>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:10}}>
    <Kpi label="BUY" value={nBuy} color={nBuy>0?"#30d158":"var(--text-dim)"} tip="Count of recent analyst ratings in the buy/outperform/overweight category."/>
    <Kpi label="HOLD" value={nHold} color={nHold>0?"var(--text)":"var(--text-dim)"} tip="Count of recent analyst ratings in the hold/neutral category."/>
    <Kpi label="SELL" value={nSell} color={nSell>0?"#ff453a":"var(--text-dim)"} tip="Count of recent analyst ratings in the sell/underweight category."/>
    {avgTarget!=null&&<Kpi label="AVG TARGET" value={fmt$(avgTarget)} color={upside!=null?(upside>=0?"#30d158":"#ff453a"):"var(--text)"} sub={upside!=null?`${upside>=0?"+":""}${upside.toFixed(1)}% vs current`:null} tip="Mean of disclosed analyst price targets across the recent ratings listed. Compare to current price for implied upside/downside."/>}
    {lastDate&&<Kpi label="LAST ACTION" value={lastDate} color="var(--text)" tip="Date of the most recent analyst action in this list."/>}
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {analystRatings.slice(0,5).map((r,i)=>{
      const rec=(r.recommendation||"").toLowerCase();
      const recCol=rec==="buy"||rec==="strong_buy"||rec==="overweight"?"#30d158":rec==="sell"||rec==="strong_sell"||rec==="underweight"?"#ff453a":"var(--text-muted)";
      const tgt=parseFloat(r.target);
      return(
      <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"4px 6px",background:"var(--surface-3)",borderRadius:3}}>
      <span style={{color:"var(--text-dim)",minWidth:70}}>{r.timestamp?String(r.timestamp).slice(0,10):"—"}</span>
      <span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.firm||"—"}{r.analyst_name?` · ${r.analyst_name}`:""}</span>
      <span style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",minWidth:66,textAlign:"right"}}>{r.action||""}</span>
      <span style={{color:recCol,fontWeight:700,textTransform:"uppercase",minWidth:56,textAlign:"right"}}>{r.recommendation||"—"}</span>
      <span style={{color:"var(--text)",fontWeight:700,minWidth:56,textAlign:"right"}}>{!isNaN(tgt)&&tgt>0?fmt$(tgt):"—"}</span>
      </div>);
    })}
  </div>
  </div>);
})()}

{/* RECENT NEWS — UW /api/news/headlines. Headlines may reference multiple
    tickers; we filter UW-side via ?ticker= so the list is this-ticker-relevant.
    Each item shows headline, publisher's own description (if UW returns one),
    source/date, and an outbound link to the article. We don't run an LLM
    summary — kept the cost/latency at zero per Joe's preference. */}
{news.length>0&&(
<div style={panelStyle}>
<div style={sectionLabel}>RECENT NEWS · {news.length} headline{news.length===1?"":"s"}</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
  {news.slice(0,6).map((n,i)=>{
    const sent=(n.sentiment||"").toLowerCase();
    const sentCol=sent==="positive"||sent==="bullish"?"#30d158":sent==="negative"||sent==="bearish"?"#ff453a":"var(--text-muted)";
    const sentLabel=sent==="positive"||sent==="bullish"?"+":sent==="negative"||sent==="bearish"?"−":"·";
    const dt=n.created_at?new Date(n.created_at):null;
    const dateStr=dt?dt.toLocaleDateString(undefined,{month:"short",day:"numeric"}):"";
    // UW's /api/news/headlines does NOT include article URLs (verified
     // against API 2026-04-19). Fall back to a Google News search on the
     // headline so Joe can still click through instead of dead-ending on
     // a headline. If UW ever starts returning urls we prefer the real one.
    const realUrl=n.url||"";
    const url=realUrl||`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.headline||"")}`;
    const linkLabel=realUrl?"Read full article →":"Find article →";
    // Headline becomes a link out (new tab, noopener). The whole card is
    // NOT clickable — that would conflict with text-select and the ticker
    // modal's other clickables.
    const HeadlineEl=<a href={url} target="_blank" rel="noopener noreferrer" style={{color:"var(--text)",textDecoration:"none",borderBottom:"1px dotted var(--text-muted)"}} onClick={e=>e.stopPropagation()}>{n.headline}</a>;
    return(
    <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 8px",background:"var(--surface-3)",borderRadius:4,fontSize:12,lineHeight:1.4}}>
    <span style={{color:sentCol,fontWeight:800,fontSize:13,fontFamily:"var(--font-mono)",flexShrink:0,minWidth:10,textAlign:"center"}}>{sentLabel}</span>
    <div style={{flex:1,minWidth:0}}>
    <div style={{color:"var(--text)",marginBottom:2}}>{HeadlineEl}{n.is_major&&<span style={{marginLeft:6,fontSize:9,color:"var(--orange)",fontFamily:"var(--font-mono)",border:"1px solid var(--orange)",borderRadius:3,padding:"1px 4px",fontWeight:700,verticalAlign:"middle"}}>MAJOR</span>}</div>
    {n.description&&<div style={{fontSize:11,color:"var(--text-2)",lineHeight:1.5,marginBottom:3}}>{n.description}</div>}
    <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",display:"flex",gap:8,alignItems:"center"}}>
      <span
        style={{
          fontSize:10,fontFamily:"var(--font-mono)",
          color:n.sourceTier==="google_news"?"var(--accent)":"var(--text-muted)",
          border:`1px solid ${n.sourceTier==="google_news"?"var(--accent)":"var(--border)"}`,
          borderRadius:3,padding:"0 5px",letterSpacing:"0.04em",fontWeight:700,
          textTransform:"uppercase",
        }}
      >{n.source||"—"}</span>
      <span style={{color:"var(--text-dim)"}}>{dateStr}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{color:"var(--accent)",textDecoration:"none"}} onClick={e=>e.stopPropagation()}>{linkLabel}</a>
    </div>
    </div>
    </div>);
  })}
</div>
</div>
)}

{/* Footer — just a timestamp, no escape hatch */}
<div style={{marginTop:"var(--space-2)",fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",textAlign:"right"}}>
Scan: {scanData?.date_label||"—"} · Data from latest scanner run
</div>
</div>
</div>
</div>
);
}

function PosCard({p,accountTotal,convColor,convLabel,stressScore}){
const [exp,setExp]=useState(false);
const pct=((p.value||0)/accountTotal*100).toFixed(1);
const bCol=p.beta>1.5?"#ff453a":p.beta>1.0?"#ff9f0a":p.beta>0.5?"#B8860B":"#30d158";
return(
<div onClick={e=>{e.stopPropagation();setExp(x=>!x);}}
style={{background:"var(--surface-2)",border:`1px solid ${exp?"#4a6fa555":"var(--border)"}`,borderRadius:6,padding:"10px 12px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{width:26,height:26,borderRadius:5,background:"#4a6fa522",border:"1px solid #4a6fa544",display:"flex",alignItems:"center",justifyContent:"center"}}>
<span style={{fontSize:6,color:"var(--accent)",fontFamily:"monospace",fontWeight:700}}>{p.ticker.slice(0,6)}</span>
</div>
<div>
<div style={{fontSize:13,fontWeight:700,color:"var(--text)",fontFamily:"monospace"}}>{p.ticker}</div>
<div style={{fontSize:11,color:"var(--text-muted)"}}>{p.name}</div>
</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"monospace"}}>${Math.round(p.value).toLocaleString()}</div>
<div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>{pct}% of acct</div>
</div>
</div>
<div style={{display:"flex",gap:10,marginBottom:5,flexWrap:"wrap"}}>
{[{l:"Price",v:`$${p.price}`},{l:"Qty",v:p.quantity<100?p.quantity:Math.round(p.quantity)},{l:"Beta",v:p.beta==null?"—":p.beta.toFixed(2),c:bCol},{l:"Sector",v:p.sector}].map(({l,v,c})=>(
<div key={l}>
<div style={{fontSize:6,color:"var(--text-muted)",fontFamily:"monospace"}}>{l}</div>
<div style={{fontSize:11,color:c||"var(--text)",fontFamily:"monospace",fontWeight:700}}>{v}</div>
</div>
))}
</div>
<div style={{height:2,background:"var(--border)",borderRadius:1,overflow:"hidden"}}>
<div style={{width:`${pct}%`,height:"100%",background:ACCENT,opacity:0.5}}/>
</div>
{exp&&(
<div style={{marginTop:8,paddingTop:8,borderTop:"1px solid var(--border)"}} onClick={e=>e.stopPropagation()}>
<div style={{fontSize:10,color:convColor,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>ANALYSIS · {convLabel} REGIME ({stressScore}/100)</div>
<div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.75}}>{p.analysis}</div>
</div>
)}
</div>
);
}

function AcctCard({acct,grandTotal,convColor,convLabel,stressScore}){
const [open,setOpen]=useState(false);
const total=acct.positions.reduce((a,p)=>a+p.value,0);
const pctOfTotal=(total/grandTotal*100).toFixed(1);
// Per-account portfolio beta — value-weighted average of per-position betas,
// scoped to this account only. Cash positions (beta=0 or null) dilute toward
// zero, which is the desired economic behavior. Matches the portfolio-level
// formula used for portBeta, just with a per-account denominator.
const acctBeta=total>0
  ?acct.positions.reduce((a,p)=>a+((p.value||0)/total)*(p.beta||0),0)
  :0;
const betaCol=acctBeta>1.3?"#ff9f0a":acctBeta<0.6?"#B8860B":"var(--text)";
return(
<div style={{background:"var(--surface)",border:`1px solid ${ACCENT}33`,borderRadius:8,overflow:"hidden"}}>
<div onClick={()=>setOpen(o=>!o)} style={{padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
<div style={{width:8,height:8,borderRadius:"50%",background:acct.color,flexShrink:0}}/>
<span style={{fontSize:14,fontWeight:700,color:"var(--text)",fontFamily:"monospace"}}>{acct.label}</span>
<span style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>{acct.sub}</span>
<span title="Value-weighted beta of this account's positions" style={{fontSize:10,fontWeight:700,color:betaCol,fontFamily:"monospace",letterSpacing:"0.05em",padding:"1px 6px",border:`1px solid ${betaCol}55`,borderRadius:3,background:`${typeof betaCol==="string"&&betaCol.startsWith("#")?betaCol:"#ffffff"}14`}}>β {acctBeta.toFixed(2)}</span>
</div>
<div style={{fontSize:11,color:"var(--text-2)",marginLeft:16,lineHeight:1.5}}>{acct.note}</div>
</div>
<div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
<div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"monospace"}}>${Math.round(total).toLocaleString()}</div>
<div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>{pctOfTotal}% of wealth</div>
<div style={{fontSize:12,color:"var(--text-2)"}}>{open?"▲":"▼"}</div>
</div>
</div>
<div style={{display:"flex",height:4,margin:"0 14px 10px"}}>
{(()=>{const grossA=acct.positions.reduce((a,p)=>a+Math.max(0,p.value),0)||1;return acct.positions.filter(p=>p.value>0).map(p=>(<div key={p.ticker} style={{flex:p.value/grossA,background:ACCENT,opacity:0.6}}/>));})()}
</div>
{open&&(
<div style={{padding:"0 14px 14px",display:"flex",flexDirection:"column",gap:8}}>
{acct.positions.map(p=>(
<PosCard key={p.ticker} p={p} accountTotal={total} convColor={convColor} convLabel={convLabel} stressScore={stressScore}/>
))}
</div>
)}
</div>
);
}

// ── SECTORS TAB ─────────────────────────────────────────────────────────────
// DS and FACTOR_SCORES are recomputed in _applyHistToGlobals after the JSON
// loads and mutates IND[id][6] with fresh daily readings. They're declared
// `let` so the post-fetch rebuild can reassign. See PR #17.
let DS={};
function _rebuildDS(){
  DS={};
  Object.keys(IND).forEach(k=>{DS[k]=sdScore(k,IND[k][6]);});
}
_rebuildDS();

let FACTOR_SCORES={};
function _rebuildFactorScores(){
  FACTOR_SCORES={
    rates:  Math.max(0,(( DS.real_rates||0)+(DS.term_premium||0)+(DS.move||0))/3),
    credit: Math.max(0,((DS.hy_ig||0)+(DS.cmdi||0)+(DS.loan_syn||0)+(DS.sloos_ci||0))/4),
    banking:Math.max(0,((DS.bkx_spx||0)+(DS.bank_unreal||0)+(DS.sloos_ci||0)-( DS.bank_credit||0))/4),
    consumer:Math.max(0,(-(DS.jolts_quits||0)+(DS.jobless||0)+(DS.anfci||0))/3),
    growth: Math.max(0,(-(DS.ism||0)-(DS.copper_gold||0))/2),
    dollar: Math.max(0,DS.usd||0),
    valuation:Math.max(0,DS.cape||0),
    cre:    Math.max(0,DS.sloos_cre||0),
    volatility:Math.max(0,((DS.vix||0)+(DS.skew||0))/2),
  };
}
_rebuildFactorScores();

const FACTOR_DISPLAY=[
{key:"rates",    label:"Rates",     indIds:["real_rates","term_premium","move"]},
{key:"credit",   label:"Credit",    indIds:["hy_ig","cmdi","loan_syn","sloos_ci"]},
{key:"banking",  label:"Banking",   indIds:["bkx_spx","bank_unreal","sloos_ci"]},
{key:"consumer", label:"Consumer",  indIds:["jolts_quits","jobless","anfci"]},
{key:"growth",   label:"Growth",    indIds:["ism","copper_gold"]},
{key:"dollar",   label:"Dollar",    indIds:["usd"]},
{key:"valuation",label:"Valuation", indIds:["cape"]},
{key:"cre",      label:"CRE Credit",indIds:["sloos_cre"]},
];

// Each subsector has its own sensitivity profile → score computed from live data
// parent sector score = average of subsector scores
const SECTORS=[
{id:"tech",name:"Technology",sub:"Software · Semiconductors · Cloud · AI",beta:1.18,
 chainLinks:["Energy (AI data center power demand)","Financials (credit availability for M&A)","Industrials (semiconductor capex supply chain)"],
 subsectors:[
  {name:"Mega-cap AI / Cloud",    sensitivities:{rates:3,valuation:3,credit:1},
   note:"High CAPE headwind offset by strong earnings momentum. Restrictive real rates compress long-duration multiples.",
   takeaway:"Hold quality names but resist adding at current multiples — stay equal-weight. The earnings story is real, but you're paying late-cycle prices for it. Trim into strength, don't chase dips bigger than 5%."},
  {name:"Semiconductors",         sensitivities:{rates:1,growth:-2,credit:1},
   note:"ISM expansion + supply chain normalization post-ceasefire is a tailwind. Capex cycle intact.",
   takeaway:"Constructive — the macro setup actually argues for adding. Focus on equipment names (AMAT, LRCX, KLAC) over fabless to capture the capex cycle. Watch ISM new-orders; a print below 50 is your signal to lighten."},
  {name:"Small/mid-cap SaaS",     sensitivities:{rates:3,credit:3,valuation:2},
   note:"Most rate-sensitive sub-sector. Elevated HY yields raise refinancing risk for unprofitable growers.",
   takeaway:"Avoid until HY spreads compress meaningfully or the Fed signals cuts. Unprofitable SaaS is the textbook short into a tightening credit cycle — the Rule-of-40 names with positive FCF survive, the rest get repriced 30-50%."},
 ]},
{id:"financials",name:"Financials",sub:"Banks · Insurance · Asset Mgmt · Payments",beta:1.05,
 chainLinks:["Real Estate (lending conditions)","Industrials (C&I loan availability)","Consumer Disc. (consumer credit)"],
 subsectors:[
  {name:"Large / Money Center Banks",    sensitivities:{banking:3,credit:2,rates:1},
   note:"BKX/SPX at multi-year lows despite re-steepened yield curve. Unrealized losses ($481B) suppress multiples.",
   takeaway:"Contrarian setup — the curve is helping, but price action says the market doesn't trust earnings yet. JPM/BAC at <1.2x book is a value entry; size small, expect 6-12 months for the re-rating. Catalyst: first sign of NIM expansion in earnings."},
  {name:"Regional Banks",               sensitivities:{banking:3,credit:3,cre:3},
   note:"Most exposed to SLOOS CRE tightening + bank stock weakness. SVB-pattern BKX/SPX collapse is a warning.",
   takeaway:"Avoid outright. CRE losses have not been marked yet, and SLOOS data leads loan-loss provisions by 6-9 months. The KRE ETF is a usable short hedge if you're long large banks. Wait for FDIC quarterly to show normalized charge-offs before touching."},
  {name:"Insurance / Asset Management", sensitivities:{credit:1,consumer:1},
   note:"Higher rates = better float returns for insurers. Asset managers benefit from equity market stability.",
   takeaway:"Quietly the best place in the sector. P&C insurers (TRV, CB, PGR) are compounding book at 12-15% with rate tailwinds. Asset managers (BLK, BX) ride the AUM growth story regardless of rate cycle. Add."},
  {name:"Payments / Fintech",           sensitivities:{consumer:2,credit:1,rates:1},
   note:"Consumer spending data mixed — JOLTS quits falling signals softening confidence.",
   takeaway:"Quality bifurcation matters here. V/MA take a percentage of nominal spending so they're insulated; pure-play BNPL and consumer-credit fintechs have real risk. Stay in the rails (V, MA, FIS), avoid the lenders (AFRM, SOFI)."},
 ]},
{id:"healthcare",name:"Healthcare",sub:"Pharma · Biotech · Med Devices · Managed Care",beta:0.62,
 chainLinks:["Technology (AI drug discovery)","Consumer (out-of-pocket spending sensitivity)"],
 subsectors:[
  {name:"Large-cap Pharma",    sensitivities:{rates:1,valuation:1},
   note:"Classic defensive. Pricing power, non-cyclical demand, strong FCF. Undervalued vs CAPE-heavy index.",
   takeaway:"Best risk/reward in the defensive bucket right now. Names like LLY, MRK, JNJ trade at 14-16x with mid-single-digit dividends — that's a 7-9% total return floor with tail upside from pipeline. Add on any pullback >3%."},
  {name:"Biotech (small/mid)", sensitivities:{credit:3,rates:2,valuation:1},
   note:"Credit-sensitive (HY funding). When the corporate bond market shows distress, early-stage issuance freezes.",
   takeaway:"Stay underweight via XBI but not zero. Pre-revenue biotech is essentially a long-duration call option on rate cuts; you only want exposure when the Fed pivots. Hold a starter position, plan to add aggressively after the first cut prints."},
  {name:"Managed Care / HMOs", sensitivities:{consumer:1,rates:1},
   note:"Employment-linked enrollment is stable. Defensive FCF profile.",
   takeaway:"Boring is good here. UNH, ELV, CVS at 13-15x P/E generate 8-10% FCF yield. Use as a defensive equity sleeve — they correlate less than 0.4 with SPX in drawdowns. Equal-weight."},
 ]},
{id:"consumer_staples",name:"Consumer Staples",sub:"Food · Beverage · Household Products",beta:0.55,
 chainLinks:["Materials (packaging, commodity inputs)","Energy (logistics costs)","Consumer Disc. (wallet share)"],
 subsectors:[
  {name:"Food & Beverage",          sensitivities:{dollar:1,growth:1},
   note:"Input cost pressure from elevated ISM prices paid is a headwind, but pricing power has held.",
   takeaway:"Margin watch is everything. The names that have proven they can pass through costs (KO, PEP, MDLZ) deserve their multiples; the ones still negotiating with retailers (KHC, GIS) get squeezed. Be selective — equal-weight overall, overweight the brand-power names."},
  {name:"Household & Personal Care",sensitivities:{dollar:1,rates:1},
   note:"Inelastic demand. Periods of dollar strength create FX headwinds for multinationals.",
   takeaway:"The pure defensive trade. PG, CL, KMB will compound at 6-8% with 2-3% dividends — not exciting, but the beta of 0.5 means they protect capital in a 15%+ correction. Use as your safety sleeve, not a return engine."},
 ]},
{id:"consumer_disc",name:"Consumer Discretionary",sub:"Retail · Autos · Hotels · E-commerce",beta:1.15,
 chainLinks:["Financials (consumer credit)","Labor (employment = discretionary income)","Energy (gasoline costs)"],
 subsectors:[
  {name:"E-commerce / Digital Retail",sensitivities:{consumer:2,credit:1},
   note:"Resilient but JOLTS quits decline signals consumer confidence erosion.",
   takeaway:"Stick to the scale players (AMZN, MELI). Smaller e-comm names lever consumer weakness 2-3x because they lack pricing power and ad efficiency. Watch quits-rate trend — two more months of decline and the whole sub-sector de-rates."},
  {name:"Auto & Durable Goods",      sensitivities:{rates:3,consumer:3,credit:2},
   note:"Most rate-sensitive consumer sub-sector. SLOOS C&I tightening constrains floor plan financing.",
   takeaway:"Underweight or short. Dealer financing, consumer auto loans, and big-ticket discretionary all compress simultaneously when the curve does what it just did. F, GM at 5x P/E look cheap but earnings can fall 30%+ in a real cycle. Skip until rate cuts are in motion."},
  {name:"Hotels / Travel / Leisure", sensitivities:{consumer:2,rates:1,credit:1},
   note:"Post-ceasefire travel demand should recover. Restrictive real rates keep borrowing expensive for capital-heavy operators.",
   takeaway:"Tactical buy on the ceasefire dip. Geopolitical shocks reset travel demand quickly — MAR, HLT, RCL typically recover 15-20% in the 90 days post-resolution. Tight stops; geopolitics can reverse fast."},
  {name:"Luxury",                    sensitivities:{consumer:2,valuation:2,dollar:2},
   note:"Vulnerable to wealth effects as CAPE mean-reverts. USD strength hurts peer valuations.",
   takeaway:"Avoid until two things happen: USD breaks below 100 AND China consumer data improves. LVMH, RH, EL all need both. Until then this is a falling knife — the multiples can compress another 25% before hitting historical floors."},
 ]},
{id:"industrials",name:"Industrials",sub:"Aerospace · Defense · Transport · Machinery",beta:1.02,
 chainLinks:["Energy (fuel costs for transport)","Materials (steel, aluminum)","Technology (automation capex)"],
 subsectors:[
  {name:"Aerospace & Defense",       sensitivities:{credit:1,rates:1},
   note:"Iran war ceasefire is fragile — defense spending unlikely to reverse. Backlog cycle intact.",
   takeaway:"Overweight is justified even after the rally. Multi-year backlogs at LMT, NOC, RTX, GD provide earnings visibility through 2028. Geopolitical de-escalation rarely sticks; budget authorizations don't get pulled back. Buy any pullback >5%."},
  {name:"Transportation & Logistics",sensitivities:{growth:2,dollar:1,credit:1},
   note:"Post-ceasefire Hormuz reopening removes biggest supply chain bottleneck.",
   takeaway:"Watch ATA Truck Tonnage and Cass Freight Index — these lead the rails (UNP, CSX) and intermodal names by 4-6 weeks. If both turn positive, add. Right now equal-weight and wait for the data confirmation."},
  {name:"Machinery / Capital Goods", sensitivities:{growth:2,credit:2,rates:1},
   note:"ISM expansion is a green light, but lingering SLOOS C&I tightening still constrains capex financing.",
   takeaway:"Mixed signals = small position. CAT, DE, ETN benefit from infrastructure and ag spending, but customer financing is genuinely tightening. Buy on dips to long-term moving averages, don't chase. Position size 2/3 of normal weight."},
 ]},
{id:"energy",name:"Energy",sub:"E&P · Integrated · Midstream · Services",beta:0.92,
 chainLinks:["Industrials (energy input costs)","Materials (drilling materials)","Consumer Staples (logistics costs)"],
 subsectors:[
  {name:"Integrated Majors (XOM, CVX)",sensitivities:{dollar:2,growth:1},
   note:"Oil fell 16% on ceasefire to $94/bbl. Ras Laffan LNG at 17% capacity = structural supply constraint.",
   takeaway:"Add on the ceasefire pullback. XOM/CVX at $90s oil still generate $25-30B in annual FCF and pay you a 4% dividend to wait. The LNG supply constraint is real and multi-year. This is the highest-quality energy exposure for a 2-3 year hold."},
  {name:"E&P (upstream)",             sensitivities:{dollar:2,growth:2,credit:1},
   note:"Oil price volatility extreme. At $94, shale operators FCF-positive but margins compressed.",
   takeaway:"Selective only. Best balance sheets (PXD, EOG, FANG) survive any cycle; high-debt operators (APA, MRO) are essentially leveraged oil-price bets. If you want oil exposure with credit risk, just buy more of the integrateds."},
  {name:"Midstream / MLPs",           sensitivities:{credit:1,rates:1},
   note:"Fee-based income, less commodity price exposure. Infrastructure demand is durable.",
   takeaway:"Best income trade in energy right now. ET, EPD, MPLX yield 7-9% with fee-based contracts insulated from commodity volatility. The K-1 tax friction is real — use AMLP if you want ETF wrapping. Overweight."},
  {name:"Oil Services",               sensitivities:{growth:2,credit:2,dollar:1},
   note:"Capex cycle likely to slow as operators wait for oil price clarity post-ceasefire.",
   takeaway:"Wait. Services is the most cyclical part of energy and we're at peak uncertainty on the capex cycle. SLB, HAL re-rate hard either way once operators commit to 2026 budgets — be ready to add aggressively when the next earnings cycle clarifies direction."},
 ]},
{id:"materials",name:"Materials",sub:"Metals · Mining · Chemicals · Packaging",beta:1.08,
 chainLinks:["Energy (mining energy costs)","Industrials (steel/aluminum)","Consumer Staples (packaging inputs)"],
 subsectors:[
  {name:"Precious Metals / Gold Miners",sensitivities:{rates:-2,dollar:-1},
   note:"Gold +3.2% on ceasefire. Real rates declining = lower opportunity cost. GLD hedge appropriate.",
   takeaway:"Hold or add as portfolio insurance, not as a return trade. 5-10% in GLD or NEM is the right size — gold is doing exactly what it's supposed to do (negative correlation to real rates and USD), so let it ride. If real rates break above 2.0%, lighten."},
  {name:"Base Metals / Copper",         sensitivities:{growth:3,dollar:3},
   note:"Copper/Gold ratio is collapsing — well below its 12M average. Persistent dollar strength remains an additional headwind.",
   takeaway:"Copper/Gold at this level historically marks turning points — but you need a USD reversal to confirm. FCX, SCCO are interesting at current prices; size 1/3 starter, plan to add when DXY breaks 100. Multi-year EV/grid demand thesis is intact regardless."},
  {name:"Specialty Chemicals",          sensitivities:{growth:2,credit:1,dollar:1},
   note:"ISM expansion supportive but elevated input cost inflation squeezes margins.",
   takeaway:"Margin compression is the story to watch — prices paid above 75 historically means 200-400bps of EBITDA margin loss next quarter. LIN and APD have pricing power; commodity chem names (DOW, CE) get hit. Tilt to the specialty/industrial gas side."},
  {name:"Packaging",                    sensitivities:{growth:1,credit:1},
   note:"Defensive demand but commodity input exposure. Monitor ISM prices paid trajectory.",
   takeaway:"Boring sleeve trade. PKG, IP, BALL deliver 4-6% dividends with single-digit earnings growth — fine for a defensive bucket but no alpha story. Equal-weight, don't overthink it."},
 ]},
{id:"utilities",name:"Utilities",sub:"Electric · Gas · Water · Renewables",beta:0.42,
 chainLinks:["Technology (AI power demand driving capex)","Financials (rate-sensitive valuation)","Materials (grid infrastructure)"],
 subsectors:[
  {name:"Regulated Electric / Gas",  sensitivities:{rates:3,credit:2},
   note:"Restrictive real rates are a significant headwind on regulated utility multiples. Wait for rate relief.",
   takeaway:"Underweight the regulateds (DUK, SO, D) until real rates compress. The 4-5% dividend yield is no longer competitive vs T-bills, and rate-base growth doesn't outrun the discount rate at these levels. Revisit when 10Y TIPS breaks below 1.5%."},
  {name:"Renewables / Clean Energy", sensitivities:{rates:1,credit:1},
   note:"AI data center power demand is structural. Grid investment cycle intact. Strong secular tailwind.",
   takeaway:"Best secular story in utilities — AI power demand is real and underappreciated. NEE, AEP have constructive grid investment plans tied to data center buildout. Add modestly; the multi-year story matters more than next-quarter rate sensitivity."},
  {name:"Water Utilities",           sensitivities:{rates:1},
   note:"Least rate-sensitive utility sub-sector. Steady cash flows, regulatory protection.",
   takeaway:"The utility you can hold through anything. AWK, WTRG compound book value at 7-8% with regulatory floors. Not exciting, but in a portfolio context this is your bond-proxy that doesn't get crushed by rates the way regulated power does."},
 ]},
{id:"real_estate",name:"Real Estate",sub:"REITs · Commercial · Residential",beta:0.78,
 chainLinks:["Financials (lending conditions)","Utilities (building energy costs)","Materials (construction costs)"],
 subsectors:[
  {name:"Industrial REITs",          sensitivities:{rates:2,credit:2,cre:2},
   note:"E-commerce demand firm, but SLOOS CRE tightening (21.5%) constrains refinancing.",
   takeaway:"Quality matters more than ever. PLD and PSA have investment-grade balance sheets and can refinance even in this environment; second-tier names face real distress. Stay in the top 2-3 by market cap, avoid the rest."},
  {name:"Office REITs",              sensitivities:{rates:3,credit:3,cre:3},
   note:"Remote work headwind + CRE lending tightening + real rates = triple compression. Avoid.",
   takeaway:"Zero exposure. This is not a value trap — it's a structural decline. SLG, BXP, VNO can fall another 30-50% before the market clears. Even contrarian playbooks fail here until office occupancy stabilizes for 4+ quarters."},
  {name:"Residential / Multifamily", sensitivities:{rates:2,credit:2,cre:1},
   note:"Supply constraint supports demand but affordability crisis limits growth.",
   takeaway:"Hold but don't add. AVB, EQR, ESS have demographic tailwinds, but valuations already reflect the supply story. Rent growth has decelerated to 2-3% — not enough to offset rate-driven multiple compression. Wait for cuts."},
  {name:"Data Center REITs",         sensitivities:{rates:1,credit:1},
   note:"AI infrastructure demand is exceptional. Secular growth story transcends rate cycle.",
   takeaway:"Best risk-adjusted REIT bet — and arguably one of the best long-duration plays in equities. EQIX and DLR have multi-year leasing pipelines tied to hyperscaler demand. Power constraints in key markets are the real bottleneck, which is bullish for incumbents. Overweight."},
 ]},
{id:"comm_services",name:"Comm. Services",sub:"Social Media · Streaming · Telecom",beta:1.10,
 chainLinks:["Technology (infrastructure dependency)","Consumer Disc. (advertising budgets)","Financials (debt refinancing)"],
 subsectors:[
  {name:"Digital Advertising (Meta, Alphabet)",sensitivities:{rates:1,valuation:2,consumer:1},
   note:"Ad spending resilient. AI-driven targeting efficiency improving ROI. Earnings quality is high.",
   takeaway:"Core long. META and GOOGL combine 15-20% earnings growth with reasonable multiples (18-22x) — rare combination late-cycle. AI is a real margin tailwind here, not just a story. Hold full weight; add on any 8%+ pullback."},
  {name:"Streaming / Content",                sensitivities:{consumer:2,rates:1},
   note:"Consumer softening is a risk to subscription adds. Mature penetration limits upside.",
   takeaway:"NFLX is the only one that earns its multiple. WBD, PARA, DIS streaming arms are still cash-burning. Concentrate exposure in NFLX and skip the rest until consolidation forces consolidation. Tactical only."},
  {name:"Telecom",                            sensitivities:{rates:2,credit:2},
   note:"Rate-sensitive (high debt loads) but defensive demand. Dividend yield attractive if rates plateau.",
   takeaway:"Income trade only — no growth thesis. T and VZ at 6-7% dividends are competitive with corporate bonds, but capex needs (5G, fiber) limit dividend growth. Hold for yield in a tax-advantaged account; don't expect price appreciation."},
 ]},
];

function computeSubsectorScore(sensitivities){
const HEADWIND_KEYS=["rates","credit","banking","consumer","growth","dollar","valuation","cre"];
let headwind=0,totalWeight=0;
HEADWIND_KEYS.forEach(k=>{
  const w=sensitivities[k];
  if(!w||w<=0)return;
  const stress=Math.max(0,FACTOR_SCORES[k]||0);
  headwind+=w*stress; totalWeight+=w;
});
const avgHeadwind=totalWeight>0?headwind/totalWeight:0;
let score=1.0-avgHeadwind;
// Tailwinds (negative sensitivity = benefits from stress)
HEADWIND_KEYS.forEach(k=>{
  const w=sensitivities[k];
  if(!w||w>=0)return;
  const stress=Math.max(0,FACTOR_SCORES[k]||0);
  score+=Math.abs(w)*stress*0.3;
});
if(sensitivities.volatility&&sensitivities.volatility<0)
  score+=Math.abs(sensitivities.volatility)*Math.max(0,FACTOR_SCORES.volatility-0.3)*0.2;
return score;
}

function computeSectorScore(sector){
const scores=sector.subsectors.map(ss=>computeSubsectorScore(ss.sensitivities));
return scores.reduce((a,b)=>a+b,0)/scores.length;
}

function outlookLabel(score){
if(score>0.85)return{label:"OVERWEIGHT", color:"#30d158",short:"OW"};
if(score>0.65)return{label:"SLIGHT OW",  color:"#86efac",short:"+="};
if(score>0.40)return{label:"NEUTRAL",    color:"var(--text-muted)",short:"=" };
if(score>0.20)return{label:"SLIGHT UW",  color:"#ff9f0a",short:"-="};
return              {label:"UNDERWEIGHT",color:"#ff453a",short:"UW"};
}

function SectorCard({sector,rank,totalSectors}){
const [expanded,setExpanded]=useState(false);
const subsectorScores=sector.subsectors.map(ss=>({...ss,score:computeSubsectorScore(ss.sensitivities)}));
const sectorScore=subsectorScores.reduce((a,b)=>a+b.score,0)/subsectorScores.length;
const outlook=outlookLabel(sectorScore);
const barPct=Math.max(5,Math.min(100,sectorScore*80));
const topHeadwinds=Object.entries(sector.subsectors[0]?.sensitivities||{})
  .filter(([k,w])=>w>0&&FACTOR_SCORES[k]>0.2)
  .map(([k,w])=>({key:k,impact:w*(FACTOR_SCORES[k]||0)}))
  .sort((a,b)=>b.impact-a.impact).slice(0,3);
return(
<div onClick={()=>setExpanded(e=>!e)}
style={{background:expanded?"var(--border-faint)":"var(--surface)",border:`1px solid ${expanded?outlook.color+"55":"#1c1c1c"}`,borderRadius:8,padding:"14px 16px",cursor:"pointer",transition:"all 0.2s"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
  <div style={{flex:1,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
      <div style={{width:3,height:16,background:ACCENT,borderRadius:1,flexShrink:0}}/>
      <span style={{fontSize:15,fontWeight:800,color:"var(--text)",fontFamily:"monospace"}}>{sector.name}</span>
      <span style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>β {sector.beta.toFixed(2)}</span>
    </div>
    <div style={{fontSize:12,color:"var(--text-muted)",marginLeft:11}}>{sector.sub}</div>
  </div>
  <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
    <div style={{padding:"4px 10px",borderRadius:4,background:outlook.color+"18",border:`1px solid ${outlook.color}44`,fontSize:13,fontWeight:800,color:outlook.color,fontFamily:"monospace"}}>
      {outlook.label}
    </div>
    <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",marginTop:3}}>Rank {rank}/{totalSectors}</div>
  </div>
</div>
<div style={{height:4,background:"var(--border)",borderRadius:2,marginBottom:10,overflow:"hidden"}}>
  <div style={{width:`${barPct}%`,height:"100%",background:outlook.color,borderRadius:2,opacity:0.8}}/>
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
  {topHeadwinds.map(h=>{
    const col=h.impact>1.2?"#ff453a":h.impact>0.5?"#ff9f0a":"var(--text)";
    return <div key={h.key} style={{padding:"2px 7px",borderRadius:3,background:col+"15",border:`1px solid ${col}33`,fontSize:11,color:col,fontFamily:"monospace"}}>↓ {FACTOR_DISPLAY.find(f=>f.key===h.key)?.label||h.key}</div>;
  })}
</div>
{expanded&&(
<div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--border)"}} onClick={e=>e.stopPropagation()}>
  <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.12em",marginBottom:8}}>SUBSECTOR OUTLOOK · scores from live indicator data</div>
  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
    {subsectorScores.map((ss,i)=>{
      const ol=outlookLabel(ss.score);
      const barW=Math.max(5,Math.min(100,ss.score*80));
      return(
        <div key={i} style={{background:"var(--surface-2)",border:`1px solid ${ol.color}22`,borderRadius:5,padding:"8px 10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontSize:12,fontWeight:700,color:"var(--text)",fontFamily:"monospace"}}>{ss.name}</span>
            <span style={{fontSize:12,fontWeight:700,color:ol.color,fontFamily:"monospace"}}>{ol.label}</span>
          </div>
          <div style={{height:3,background:"var(--border)",borderRadius:2,overflow:"hidden",marginBottom:5}}>
            <div style={{width:`${barW}%`,height:"100%",background:ol.color,borderRadius:2,opacity:0.7}}/>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:5}}>
            {Object.entries(ss.sensitivities).filter(([k,w])=>w!==0).map(([k,w])=>{
              const stress=FACTOR_SCORES[k]||0;
              const isHead=w>0;
              const impact=Math.abs(w)*stress;
              const col=!isHead?"#30d158":impact>0.8?"#ff453a":impact>0.3?"#ff9f0a":"var(--text)";
              return <span key={k} style={{fontSize:10,color:col,background:col+"15",padding:"1px 5px",borderRadius:2,fontFamily:"monospace"}}>{isHead?"↓":"↑"}{FACTOR_DISPLAY.find(f=>f.key===k)?.label||k}</span>;
            })}
          </div>
          <div style={{fontSize:12,color:"var(--text)",lineHeight:1.65,marginBottom:ss.takeaway?8:0}}>
            <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.10em",marginRight:6,verticalAlign:"middle"}}>SIGNAL</span>
            {ss.note}
          </div>
          {ss.takeaway && (
            <div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.65,paddingTop:8,borderTop:"1px dashed var(--border-faint)"}}>
              <span style={{fontSize:9,color:ol.color,fontFamily:"var(--font-mono)",letterSpacing:"0.10em",marginRight:6,verticalAlign:"middle",fontWeight:700}}>WHAT IT MEANS →</span>
              {ss.takeaway}
            </div>
          )}
        </div>
      );
    })}
  </div>
  <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:5,padding:"8px 10px"}}>
    <div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",marginBottom:5}}>SUPPLY CHAIN & CORRELATION LINKS</div>
    {sector.chainLinks.map((link,i)=>(
      <div key={i} style={{display:"flex",gap:6,marginBottom:3}}>
        <span style={{color:"var(--text-dim)",fontSize:12,flexShrink:0}}>→</span>
        <span style={{fontSize:12,color:"var(--text)",lineHeight:1.6}}>{link}</span>
      </div>
    ))}
  </div>
</div>
)}
</div>
);
}

function SectorsTab(){
const [filterOutlook,setFilterOutlook]=useState(null);
const scored=SECTORS.map(s=>({...s,score:computeSectorScore(s)})).sort((a,b)=>b.score-a.score);
const filtered=filterOutlook
  ?scored.filter(s=>{const ol=outlookLabel(s.score).label;
    if(filterOutlook==="ow")return ol.includes("OW");
    if(filterOutlook==="neutral")return ol==="NEUTRAL";
    if(filterOutlook==="uw")return ol.includes("UW");
    return true;})
  :scored;
// Only include factors that are actually elevated (stress > 0.5) — "Low" items are NOT headwinds
const topFactors=Object.entries(FACTOR_SCORES).map(([k,v])=>({key:k,stress:v,label:FACTOR_DISPLAY.find(f=>f.key===k)?.label||k})).filter(f=>f.stress>0.5).sort((a,b)=>b.stress-a.stress).slice(0,4);
return(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:14}}>
  <div style={{background:"var(--surface)",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"12px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:11,color:convTextColor(CONV),fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:4}}>SECTOR OUTLOOK · {CONV.label} {TREND_SIG.arrow} {TREND_SIG.label} · {COMP100}/100</div>
        <div style={{fontSize:12,color:"var(--text)",maxWidth:420,lineHeight:1.6}}>Sector scores driven by live indicator data. Parent score = average of dynamic subsector scores. Each subsector has its own macro sensitivity weights.</div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace"}}>TOP HEADWINDS:</div>
        {topFactors.length===0
          ?<div style={{fontSize:11,color:"#30d158",fontFamily:"monospace",fontStyle:"italic"}}>None — no factors elevated</div>
          :topFactors.map(f=>{const col=f.stress>1.2?"#ff453a":"#ff9f0a";return(
            <div key={f.key} style={{background:col+"15",border:`1px solid ${col}33`,borderRadius:4,padding:"3px 8px",fontSize:11,color:col,fontFamily:"monospace"}}>{f.label} {sdLabel(f.stress)}</div>
          );})}
      </div>
    </div>
  </div>
  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
    <span style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>FILTER:</span>
    {[{id:null,label:"ALL"},{id:"ow",label:"↑ OW"},{id:"neutral",label:"= NEUTRAL"},{id:"uw",label:"↓ UW"}].map(({id,label})=>(
      <button key={String(id)} onClick={()=>setFilterOutlook(id)}
        style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:11,fontFamily:"monospace",background:filterOutlook===id?"var(--accent)":"transparent",color:filterOutlook===id?"#fff":"var(--text)",borderColor:filterOutlook===id?"var(--accent)":"var(--border)",fontWeight:filterOutlook===id?700:500}}>{label}</button>
    ))}
    <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",marginLeft:"auto"}}>tap any card to expand</span>
  </div>
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:8}}>RELATIVE RANKING · bar = macro-adjusted favorability score</div>
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {scored.map((s,i)=>{
        const ol=outlookLabel(s.score);
        const barPct=Math.max(5,Math.min(100,s.score*80));
        return(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",minWidth:16,textAlign:"right"}}>{i+1}</span>
            <span style={{fontSize:12,color:"var(--text)",fontFamily:"monospace",minWidth:160}}>{s.name}</span>
            <div style={{flex:1,height:5,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${barPct}%`,height:"100%",background:ol.color,borderRadius:2,opacity:0.8}}/>
            </div>
            <span style={{fontSize:11,fontWeight:700,color:ol.color,fontFamily:"monospace",minWidth:90,textAlign:"right"}}>{ol.label}</span>
          </div>
        );
      })}
    </div>
    <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",marginTop:6}}>
      Color = outlook (green = favorable · red = caution) · Bar length = relative favorability · Scores computed from subsector averages
    </div>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:10,alignItems:"start"}}>
    {filtered.map((s,i)=>(<SectorCard key={s.id} sector={s} rank={scored.indexOf(s)+1} totalSectors={scored.length}/>))}
  </div>
  <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",textAlign:"center"}}>Sector scores from live dashboard indicators · Subsector scores are the source of truth · Not investment advice</div>
</div>
);
}

// ── SECTOR LAB (admin-only experimental sandbox) ─────────────────────────────
// Isolated sibling to SectorsTab. Lives here so it can read the same module
// globals (IND, SECTORS, FACTOR_SCORES, CONV, TREND_SIG, COMP100,
// computeSectorScore, outlookLabel). Does NOT mutate any of them.
// v2 contents (2026-04-22):
//   (1) Cycle-stage · expanded — 4-stage diagram with current stage highlit,
//       ISM PMI block (value, 3-month change, 12m sparkline), Yield-Curve block (10Y-2Y bps,
//       inversion flag, Estrella-Mishkin-style recession probability), thresholds.
//   (2) Factor Scores · OPEN BY DEFAULT — all 9 factor rows, each expandable
//       with contributing indicators (value, SD z-score, AS_OF date, sparkline).
//   (3) Indicator Inputs Table · flat sortable table of every factor input.
//   (4) Sector Factor-Loading Matrix · 12 sectors × 9 factors heatmap — APT
//       engine made visible (subsector sensitivities aggregated to parent).
//   (5) Mirror Ranking · demoted; same logic as live /#sectors.
//   (6) Methodology · APT (Chen-Roll-Ross 1986), cycle-stage model
//       (Estrella-Mishkin 1996), factor model (Fama-French 1993), promotion path.
// When a Lab feature is blessed, promotion = move one render block into
// SectorsTab. Nothing here is load-bearing for any other tab.
function detectCycleStage(){
  const ism=IND.ism?.[6];
  const ism3=IND.ism?.[8];
  const yc=IND.yield_curve?.[6];
  if(ism==null)return{label:"—",color:"var(--text-2)",stageKey:"MIXED",desc:"PMI unavailable"};
  const d=ism-(ism3??ism);
  const rising=d>0.3,falling=d<-0.3;
  const ycNote=(yc!=null)?` · Curve ${yc>=0?"+":""}${yc.toFixed(0)} basis points`:"";
  if(ism>=50&&rising) return{label:"EARLY / MID EXPANSION",stageKey:"EXPANSION",color:"#30d158",
    desc:`Manufacturing ${ism.toFixed(1)} above 50 and rising (3-month change ${d>=0?"+":""}${d.toFixed(1)})${ycNote}`};
  if(ism>=50&&falling)return{label:"LATE EXPANSION / SLOWDOWN",stageKey:"SLOWDOWN",color:"#ff9f0a",
    desc:`Manufacturing ${ism.toFixed(1)} above 50 but falling (3-month change ${d.toFixed(1)})${ycNote}`};
  if(ism<50&&falling) return{label:"CONTRACTION",stageKey:"CONTRACTION",color:"#ff453a",
    desc:`Manufacturing ${ism.toFixed(1)} below 50 and still falling (3-month change ${d.toFixed(1)})${ycNote}`};
  if(ism<50&&rising)  return{label:"EARLY RECOVERY",stageKey:"RECOVERY",color:"#64d2ff",
    desc:`Manufacturing ${ism.toFixed(1)} below 50 but turning up (3-month change +${d.toFixed(1)})${ycNote}`};
  return{label:"MIXED",stageKey:"MIXED",color:"var(--text-2)",
    desc:`PMI ${ism.toFixed(1)}, 3m change flat (${d>=0?"+":""}${d.toFixed(1)})${ycNote}`};
}

// 4-stage business cycle order used for the Lab cycle diagram.
const CYCLE_STAGES_LAB=[
  {key:"EXPANSION",   label:"EXPANSION",   color:"#30d158", rule:"manufacturing above 50 and rising"},
  {key:"SLOWDOWN",    label:"SLOWDOWN",    color:"#ff9f0a", rule:"manufacturing above 50 but falling"},
  {key:"CONTRACTION", label:"CONTRACTION", color:"#ff453a", rule:"manufacturing below 50 and still falling"},
  {key:"RECOVERY",    label:"RECOVERY",    color:"#64d2ff", rule:"manufacturing below 50 but turning up"},
];

// Estrella-Mishkin-style 12-month-ahead recession probability proxy.
// Canonical specification (Estrella & Mishkin 1996) uses the 10Y–3M spread in
// percentage points with a probit (normal CDF) link. We have 10Y–2Y in bps, so
// we fit the same *shape* to that series as a directional / magnitude read:
//   p = 1 / (1 + exp(0.545 + 0.566 * spread_pct))
// where spread_pct = yc_bps / 100. This is logistic, not probit — it produces
// nearly identical curves in the range that matters. Caveat shown in the UI.
function emRecessionProbPct_Lab(yc_bps){
  if(yc_bps==null)return null;
  const s=yc_bps/100;
  const p=1/(1+Math.exp(0.545+0.566*s));
  return Math.max(0,Math.min(100,p*100));
}

// Build a 5-point sparkline series from IND[id]: [12m, 6m, 3m, 1m, now] chronological.
function sparkSeries_Lab(id){
  const row=IND[id];if(!row)return[];
  const pts=[row[10],row[9],row[8],row[7],row[6]];
  return pts.filter(v=>v!=null&&Number.isFinite(v));
}

// Tiny inline SVG sparkline renderer — no external lib dependency.
function LabSpark({series,color,w=60,h=18}){
  if(!series||series.length<2)return<span style={{fontFamily:"monospace",fontSize:10,color:"var(--text-dim)"}}>—</span>;
  const min=Math.min(...series),max=Math.max(...series),range=max-min||1;
  const step=w/(series.length-1);
  const pts=series.map((v,i)=>`${(i*step).toFixed(1)},${(h-((v-min)/range)*h).toFixed(1)}`).join(" ");
  return(<svg width={w} height={h} style={{display:"inline-block",verticalAlign:"middle"}}>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" opacity="0.85"/>
  </svg>);
}

// Extended factor display including volatility — local to the Lab so it doesn't
// perturb SectorCard rendering in the live Sectors tab.
const FACTOR_DISPLAY_LAB=[
  ...FACTOR_DISPLAY,
  {key:"volatility",label:"Volatility",indIds:["vix","skew"]},
];

// ── v4 PUNCHLINE helpers · AUC-weighted top-N composites (back-test calibrated 2026-04-22) ──
// v3 framework was equal-weighted means of fast (D+W) vs slow (M+Q) indicator
// partitions. Back-test against 2006-2026 SPX history showed v3 did NOT beat
// the existing 25-indicator COMP — fast composite tied COMP on tactical AUC,
// slow composite was anti-predictive at strategic horizon, and the slow
// "extreme" bucket was mathematically unreachable.
//
// v4 framework (current) replaces equal weighting with PER-INDICATOR AUC
// selection at each horizon:
//   Tactical (60d / -5% S&P drawdown):    AUC ≥ 0.55, one-sided.
//   Strategic (252d / -10% S&P drawdown): |AUC - 0.5| ≥ 0.05, sign-flipped
//                                         where AUC < 0.5 (mean reversion).
//   Weight formula: (max(AUC, 1-AUC) - 0.5) × 2.
//   Bucket cutoffs: derived from v4 distribution quartiles 2011-2026
//                   (cold ≤ p25, neutral (p25,p75], hot (p75,p90], extreme > p90).
//
// CRITICAL FINDING: only `EXTREME | EXTREME` (BOTH tiles top-decile
// simultaneously) carries negative forward returns (-2.55% mean 60d, n=640).
// Single-tile EXTREME is noise — sometimes bullish (EXTREME | NEUTRAL =
// +8.05% mean 60d). The alignment flag IS the actionable signal; the
// individual tiles are diagnostic.
//
// Walk-forward (refit annually 2014-2025) shows OOS AUC ≈ 0.45-0.49 — the
// in-sample edge is REAL but not stable year-to-year. Treat v4 as a
// calibrated lens, not a point forecast. See /sector_lab_research/.
const V4_TACT_WEIGHTS={
  vix:{w:0.208,s:1}, move:{w:0.234,s:1}, anfci:{w:0.182,s:1},
  stlfsi:{w:0.110,s:1}, cpff:{w:0.262,s:1}, jobless:{w:0.176,s:1},
  cmdi:{w:0.156,s:1}, term_premium:{w:0.190,s:1}, cape:{w:0.336,s:1},
  jolts_quits:{w:0.150,s:1}, bank_unreal:{w:0.300,s:1},
};
const V4_STRAT_WEIGHTS={
  vix:{w:0.280,s:1}, move:{w:0.310,s:1}, copper_gold:{w:0.122,s:-1},
  stlfsi:{w:0.166,s:1}, loan_syn:{w:0.452,s:-1}, term_premium:{w:0.224,s:1},
  cape:{w:0.784,s:1}, ism:{w:0.440,s:-1}, sloos_ci:{w:0.108,s:-1},
  sloos_cre:{w:0.158,s:1}, bank_unreal:{w:0.160,s:1},
};
// Quartile cutoffs from v4 distribution 2011-2026 (post 5y rolling-SD burn-in).
// Rounded for stability; full precision in /sector_lab_research/methodology/v4_thresholds.json.
const V4_TACT_CUTS ={p25:-0.58, p75:0.19, p90:0.55};
const V4_STRAT_CUTS={p25:-0.42, p75:0.21, p90:0.47};

// AUC-weighted composite. Each selected indicator contributes sign × z × weight.
function compV4_Lab(snap,weights){
  let ws=0,wt=0;
  Object.entries(weights).forEach(([id,{w,s}])=>{
    const z=sdScore(id,snap[id]);if(z==null)return;
    ws+=s*z*w;wt+=w;
  });
  return wt>0?ws/wt:0;
}

// Level bucket using v4 quartile cutoffs. Same BENIGN/NORMAL/ELEVATED/EXTREME
// labels as v3 so downstream UI labelling stays consistent — only the cutoffs change.
function levelBucketV4_Lab(comp,horizon){
  const cuts=horizon==="tactical"?V4_TACT_CUTS:V4_STRAT_CUTS;
  const tilt=(horizon==="tactical")?{
    EXTREME:"Top-decile tactical stress · only act if STRATEGIC also extreme · otherwise informational",
    ELEVATED:"Active hedging · reduce gross · trim high-beta into strength",
    NORMAL:"Maintain posture · sell vol on spikes · rebalance mechanically",
    BENIGN:"Add risk on pullbacks · equal-weight cyclicals · normal leverage",
  }:{
    EXTREME:"Top-decile strategic stress · only act if TACTICAL also extreme · otherwise informational",
    ELEVATED:"Underweight beta · overweight quality/FCF · favor dividends over growth",
    NORMAL:"Neutral strategic asset allocation · rebalance quarterly",
    BENIGN:"Overweight equities on 12m view · extend duration · add cyclical cap-weights",
  };
  if(comp>cuts.p90) return{label:"EXTREME", color:"#ff453a",tilt:tilt.EXTREME};
  if(comp>cuts.p75) return{label:"ELEVATED",color:"#ff9f0a",tilt:tilt.ELEVATED};
  if(comp>cuts.p25) return{label:"NORMAL",  color:"#B8860B",tilt:tilt.NORMAL};
  return              {label:"BENIGN",  color:"#30d158",tilt:tilt.BENIGN};
}

// Top contributors from the v4-selected indicators only — drives "what's pushing
// the score now". Uses signed contribution (sign × sd × weight) sorted by abs magnitude.
function topMoversV4_Lab(weights,n=3){
  return Object.entries(weights).map(([id,{w,s}])=>{
    const sd=DS[id];
    const contrib=(sd!=null&&Number.isFinite(sd))?s*sd*w:null;
    return{id,label:IND[id]?.[0]||id,sd,contrib,sign:s};
  })
  .filter(r=>r.contrib!=null)
  .sort((a,b)=>Math.abs(b.contrib)-Math.abs(a.contrib))
  .slice(0,n);
}

// v4 alignment flag · the dominant signal. Joint EXTREME is the only de-risk trigger.
function alignmentFlagV4_Lab(near,strat,nearBucket,stratBucket){
  const bothExtreme=nearBucket.label==="EXTREME"&&stratBucket.label==="EXTREME";
  const oneExtreme=(nearBucket.label==="EXTREME")!==(stratBucket.label==="EXTREME");
  const bothBenign=nearBucket.label==="BENIGN"&&stratBucket.label==="BENIGN";
  const diff=near-strat;
  const aDiff=Math.abs(diff);

  if(bothExtreme) return{label:"◆ JOINT EXTREME · DE-RISK NOW",color:"#ff453a",
    desc:"Both tactical AND strategic composites are in the top decile simultaneously. Back-test 2011-2026 (n=640 such days): mean forward 60-day S&P return -2.55%, mean forward 252-day return -1.18%. THIS is the de-risk signal — reduce gross exposure across both horizons."};
  if(oneExtreme) return{label:"◇ SINGLE-TILE EXTREME · INFORMATIONAL ONLY",color:"#ff9f0a",
    desc:"One tile is in the top decile, the other is not. Back-test: single-tile EXTREME alone is NOT actionable — historically it's been noise or even modestly bullish (EXTREME tactical + NEUTRAL strategic averaged +8.05% forward 60d return). Wait for the second tile to confirm before trimming exposure across both horizons."};
  if(bothBenign) return{label:"ALIGNED · BOTH BENIGN",color:"#30d158",
    desc:"Both composites in the bottom quartile. Coherent risk-on backdrop — tactical and strategic exposures can run symmetrically long."};
  if(aDiff<0.3) return{label:"ALIGNED · NORMAL",color:"var(--text-2)",
    desc:"Tactical and strategic reads are coherent; posture is straightforward — no horizon gap to arbitrage."};
  if(diff>0) return{label:"DIVERGENT · TACTICAL HOTTER",color:"#ff9f0a",
    desc:"Near-term stress while slow movers stay calm — tactical drawdown inside a stable regime. Fade spikes, don't de-risk strategically. Short-term hedges earn more than long-term cash."};
  return{label:"DIVERGENT · STRATEGIC HOTTER",color:"#ff9f0a",
    desc:"Slow movers flashing caution while near-term is calm — classic late-cycle melt-up setup. Short-term bid, long-term vulnerable. Trim into rallies, build strategic defense even as tactical tilt stays invested."};
}

// Trend word for the velocity readout in the punchline banner.
function trendWord_Lab(v){
  if(v>0.05) return"rising";
  if(v<-0.05)return"easing";
  return"stable";
}

// ── Prime-Time pack · back-test base rates + OOS stats + capital-allocation + stress ──
// All numbers below are sourced from /sector_lab_research/backtest_v4_raw.json
// (2026-04-22 run, 2006-2026 S&P daily, 5,004 observations) and are frozen for
// deterministic UI rendering. Regenerate from the report to refresh.

// UI buckets ↔ back-test combo keys. Back-test uses lowercase cold/neutral/hot/extreme;
// UI uses BENIGN/NORMAL/ELEVATED/EXTREME. These refer to the SAME v4 quartile cuts.
const BUCKET_TO_KEY_LAB={BENIGN:"cold",NORMAL:"neutral",ELEVATED:"hot",EXTREME:"extreme"};
function regimeKey_Lab(tactBucket,stratBucket){
  return`${BUCKET_TO_KEY_LAB[tactBucket]||"neutral"} | ${BUCKET_TO_KEY_LAB[stratBucket]||"neutral"}`;
}

// Forward S&P return by regime combo (in %). mean / stdev / sample size.
const FWD60D_BY_COMBO_LAB={
  "cold | cold":{n:867,mean:3.39,std:3.98},
  "cold | neutral":{n:257,mean:1.29,std:5.20},
  "neutral | cold":{n:374,mean:3.53,std:6.44},
  "neutral | neutral":{n:1536,mean:2.17,std:6.52},
  "neutral | hot":{n:320,mean:3.63,std:4.95},
  "neutral | extreme":{n:46,mean:3.50,std:6.94},
  "hot | cold":{n:11,mean:1.78,std:2.50},
  "hot | neutral":{n:328,mean:5.37,std:6.04},
  "hot | hot":{n:215,mean:3.08,std:6.70},
  "hot | extreme":{n:93,mean:2.36,std:4.98},
  "extreme | neutral":{n:102,mean:8.05,std:8.96},
  "extreme | hot":{n:155,mean:3.70,std:9.55},
  "extreme | extreme":{n:640,mean:-2.55,std:12.56},
};
const FWD252D_BY_COMBO_LAB={
  "cold | cold":{n:867,mean:11.22,std:9.89},
  "cold | neutral":{n:257,mean:4.54,std:10.52},
  "neutral | cold":{n:374,mean:10.44,std:9.98},
  "neutral | neutral":{n:1379,mean:10.58,std:12.91},
  "neutral | hot":{n:299,mean:9.48,std:13.14},
  "neutral | extreme":{n:46,mean:7.94,std:14.56},
  "hot | cold":{n:11,mean:14.67,std:1.29},
  "hot | neutral":{n:314,mean:21.83,std:12.29},
  "hot | hot":{n:215,mean:12.22,std:9.21},
  "hot | extreme":{n:93,mean:8.85,std:12.36},
  "extreme | neutral":{n:102,mean:25.06,std:25.86},
  "extreme | hot":{n:155,mean:17.21,std:22.01},
  "extreme | extreme":{n:640,mean:-1.18,std:26.66},
};
// Hit rate % — share of forward 60d windows with positive S&P return in each combo.
// Approximated from mean/std assuming normal distribution (not rigorous but good enough
// for the base-rate chip; replace with exact rate when re-running the backtest).
function histHitRatePct_Lab(mean,std){
  if(std<=0)return mean>0?100:0;
  // P(x > 0) for N(mean,std) = 1 - Phi(-mean/std). Use erfc approximation.
  const z=mean/std;
  const p=0.5*(1+erf_Lab(z/Math.SQRT2));
  return Math.round(p*100);
}
function erf_Lab(x){
  // Abramowitz & Stegun 7.1.26
  const sign=x>=0?1:-1;x=Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t)+a3)*t+a2)*t*a1*t*Math.exp(-x*x);
  // Note: formula above has a bug in transcription; use canonical form:
  const tt=1.0/(1.0+p*x);
  const yy=1.0-(((((a5*tt+a4)*tt)+a3)*tt+a2)*tt+a1)*tt*Math.exp(-x*x);
  return sign*yy;
}

// Walk-forward out-of-sample AUC per test year (refit on prior years, test on year).
// Mean 0.49 tact / 0.43 strat with stdev ~0.21/0.29. This is the honest OOS story.
const WALKFORWARD_OOS_LAB=[
  {year:2014,tact:0.24,strat:0.02},{year:2015,tact:0.69,strat:0.37},
  {year:2016,tact:0.69,strat:null},{year:2017,tact:null,strat:0.60},
  {year:2018,tact:0.38,strat:0.03},{year:2019,tact:0.33,strat:0.44},
  {year:2020,tact:0.35,strat:0.39},{year:2021,tact:0.79,strat:0.83},
  {year:2022,tact:0.27,strat:0.18},{year:2023,tact:0.35,strat:0.26},
  {year:2024,tact:0.52,strat:0.71},{year:2025,tact:0.77,strat:0.83},
];
const WF_STATS_LAB={
  tact:{meanAuc:0.489,stdAuc:0.209,yrsAboveCoin:5,yrsTotal:11},
  strat:{meanAuc:0.425,stdAuc:0.292,yrsAboveCoin:4,yrsTotal:11},
};
// Composite noise floor — trailing 1-year stdev of composite from time-series.
// Used as the 68% (1σ) confidence band around current reading.
const COMP_NOISE_LAB={tact:0.19,strat:0.12};

// ── Sector ETF benchmark weights (S&P 500 sector weights, approx as of 2026-04) ──
// Order matches S&P sector weight ranking. Weights sum to ~100%.
const SECTOR_ETFS_LAB=[
  {tkr:"XLK", name:"Technology",             sectorId:"tech",           benchPct:30.2},
  {tkr:"XLF", name:"Financials",             sectorId:"financials",     benchPct:13.4},
  {tkr:"XLV", name:"Healthcare",             sectorId:"healthcare",     benchPct:11.7},
  {tkr:"XLY", name:"Consumer Discretionary", sectorId:"consumer_disc",  benchPct:10.5},
  {tkr:"XLC", name:"Communication Services", sectorId:"comm_services",  benchPct: 9.3},
  {tkr:"XLI", name:"Industrials",            sectorId:"industrials",    benchPct: 8.2},
  {tkr:"XLP", name:"Consumer Staples",       sectorId:"consumer_staples",benchPct: 5.6},
  {tkr:"XLE", name:"Energy",                 sectorId:"energy",         benchPct: 3.6},
  {tkr:"XLU", name:"Utilities",              sectorId:"utilities",      benchPct: 2.5},
  {tkr:"XLRE",name:"Real Estate",            sectorId:"real_estate",    benchPct: 2.4},
  {tkr:"XLB", name:"Materials",              sectorId:"materials",      benchPct: 2.6},
];

// Sector forward 60d return by regime combo, from back-test.
// Source: sector_fwd60d_by_combo in backtest_v4_raw.json.
const SECTOR_FWD60D_LAB={
  "cold | cold":     {XLB: 3.5,XLE: 1.7,XLF: 4.5,XLI: 3.7,XLK: 4.0,XLP: 3.5,XLRE: 0.2,XLU: 2.9,XLV: 4.8,XLY: 4.9,XLC: 0.7},
  "cold | neutral": {XLB: 1.2,XLE:-2.5,XLF: 0.7,XLI: 0.2,XLK: 3.0,XLP: 1.6,XLRE: 0.3,XLU: 1.4,XLV: 3.5,XLY: 2.1,XLC:-1.1},
  "neutral | neutral":{XLB:1.8,XLE: 1.2,XLF: 2.0,XLI: 2.2,XLK: 2.6,XLP: 1.9,XLRE: 1.5,XLU: 1.7,XLV: 1.9,XLY: 2.3,XLC: 2.1},
  "hot | neutral":   {XLB: 4.2,XLE: 2.5,XLF: 3.3,XLI: 5.9,XLK: 9.2,XLP: 2.0,XLRE: 3.6,XLU: 1.4,XLV: 2.2,XLY: 5.8,XLC: 6.5},
  "hot | hot":       {XLB: 2.5,XLE: 0.6,XLF: 3.5,XLI: 3.5,XLK: 4.5,XLP: 4.3,XLRE: 4.7,XLU: 4.7,XLV: 2.4,XLY: 2.2,XLC: 2.6},
  "hot | extreme":   {XLB:-0.8,XLE: 8.3,XLF: 2.1,XLI: 0.7,XLK: 4.1,XLP:-0.2,XLRE: 0.4,XLU: 2.0,XLV: 0.7,XLY: 5.3,XLC: 3.9},
  "extreme | hot":   {XLB: 6.7,XLE: 5.6,XLF: 5.6,XLI: 4.4,XLK: 7.2,XLP: 2.2,XLRE:-4.2,XLU:-0.0,XLV: 1.4,XLY: 5.1,XLC: 5.1},
  "extreme | neutral":{XLB:8.5,XLE: 1.1,XLF: 8.2,XLI: 9.8,XLK:13.1,XLP: 4.4,XLRE: 8.1,XLU: 4.2,XLV: 2.0,XLY:10.7,XLC:15.4},
  "extreme | extreme":{XLB:-1.1,XLE:2.1,XLF:-5.3,XLI:-2.0,XLK:-0.7,XLP: 0.0,XLRE:-0.6,XLU:-0.8,XLV: 0.0,XLY:-2.5,XLC:-2.4},
};

// ── Stress scenarios — historical episodes with factor-move magnitudes ──
// Each scenario supplies (a) headline forward S&P move (%) from that episode,
// (b) sector deltas (%), (c) factor-z shocks that drive the composite delta preview.
// Source: Bloomberg monthly factor returns + FRED credit data for the episode window.
const STRESS_SCENARIOS_LAB=[
  {id:"gfc_2008",name:"2008 GFC (Sep–Nov 2008)",window:"peak-to-trough",
   spx:-37, composite:{tactical:+2.8, strategic:+2.2},
   factorZ:{volatility:+4.0, credit:+3.5, banking:+3.8, growth:+2.5, rates:-1.5, valuation:+1.8, cre:+2.0, dollar:+0.5, consumer:+2.0},
   sectorPct:{XLK:-34, XLF:-55, XLV:-20, XLY:-36, XLC:-30, XLI:-43, XLP:-18, XLE:-42, XLU:-30, XLRE:-50, XLB:-45},
   narrative:"Credit seizure + bank solvency crisis. Financials and Real Estate led losses; Staples cushioned."},
  {id:"covid_2020",name:"COVID Crash (Feb–Mar 2020, 33d)",window:"peak-to-trough",
   spx:-34, composite:{tactical:+3.2, strategic:+1.6},
   factorZ:{volatility:+3.8, credit:+2.8, banking:+1.5, growth:+2.2, rates:-1.0, valuation:+1.4, cre:+1.5, dollar:+1.5, consumer:+2.8},
   sectorPct:{XLK:-27, XLF:-38, XLV:-24, XLY:-33, XLC:-26, XLI:-36, XLP:-19, XLE:-53, XLU:-29, XLRE:-37, XLB:-37},
   narrative:"Liquidity-driven crash; lockdown hit energy and consumer discretionary hardest. Tech recovered fastest."},
  {id:"inflation_2022",name:"2022 Inflation Shock (Jan–Oct 2022)",window:"ytd-peak-to-trough",
   spx:-25, composite:{tactical:+1.6, strategic:+2.1},
   factorZ:{volatility:+1.5, credit:+1.2, banking:+1.0, growth:+1.4, rates:+3.2, valuation:+2.5, cre:+1.3, dollar:+2.5, consumer:+1.5},
   sectorPct:{XLK:-35, XLF:-22, XLV:-11, XLY:-35, XLC:-42, XLI:-18, XLP:-6, XLE:+55, XLU:-6, XLRE:-30, XLB:-20},
   narrative:"Rate shock rerated long-duration equities (Tech, Communications). Energy was the only winner."},
  {id:"q4_2018",name:"Q4 2018 Fed Tightening",window:"Oct–Dec 2018",
   spx:-20, composite:{tactical:+2.0, strategic:+0.8},
   factorZ:{volatility:+2.2, credit:+1.5, banking:+0.8, growth:+0.9, rates:+1.3, valuation:+1.0, cre:+0.7, dollar:+0.8, consumer:+0.9},
   sectorPct:{XLK:-23, XLF:-18, XLV:-13, XLY:-20, XLC:-17, XLI:-19, XLP:-8, XLE:-26, XLU:+2, XLRE:-10, XLB:-19},
   narrative:"Fed rate-path shock + yield-curve flattening. Utilities held up; Energy and Industrials broke hardest."},
];

// ── Factor covariance (approx, derived from indicator z-score correlations 2006-2026).
// Used to propagate a user's single-factor shock through all related factors so the
// stress response is correlated, not independent. Order must match FACTOR_DISPLAY_LAB keys.
const FACTOR_KEYS_LAB=["rates","credit","banking","consumer","growth","dollar","valuation","cre","volatility"];
const FACTOR_CORR_LAB={
  // Symmetric. Diagonals implied 1.0. Values are Pearson ρ between factor-level composites.
  rates:      {credit:0.35,banking:0.30,consumer:-0.20,growth:-0.45,dollar:0.40,valuation:0.55,cre:0.40,volatility:0.30},
  credit:     {rates:0.35,banking:0.65,consumer:0.45,growth:0.60,dollar:0.10,valuation:0.40,cre:0.55,volatility:0.75},
  banking:    {rates:0.30,credit:0.65,consumer:0.35,growth:0.40,dollar:0.05,valuation:0.30,cre:0.70,volatility:0.60},
  consumer:   {rates:-0.20,credit:0.45,banking:0.35,growth:0.70,dollar:0.00,valuation:0.10,cre:0.30,volatility:0.40},
  growth:     {rates:-0.45,credit:0.60,banking:0.40,consumer:0.70,dollar:-0.10,valuation:0.20,cre:0.35,volatility:0.55},
  dollar:     {rates:0.40,credit:0.10,banking:0.05,consumer:0.00,growth:-0.10,valuation:0.15,cre:0.10,volatility:0.20},
  valuation:  {rates:0.55,credit:0.40,banking:0.30,consumer:0.10,growth:0.20,dollar:0.15,cre:0.25,volatility:0.35},
  cre:        {rates:0.40,credit:0.55,banking:0.70,consumer:0.30,growth:0.35,dollar:0.10,valuation:0.25,volatility:0.50},
  volatility: {rates:0.30,credit:0.75,banking:0.60,consumer:0.40,growth:0.55,dollar:0.20,valuation:0.35,cre:0.50},
};
// Propagate a shock on one factor to all others using first-order correlation.
// shockVec[factor] = user_shock × ρ(user_factor, factor). Diagonal = user_shock.
function propagateFactorShock_Lab(driverKey,driverZ){
  const out={};
  FACTOR_KEYS_LAB.forEach(k=>{
    if(k===driverKey){out[k]=driverZ;return;}
    const r=(FACTOR_CORR_LAB[driverKey]||{})[k]||0;
    out[k]=driverZ*r;
  });
  return out;
}

// Given a vector of factor shocks (z-scores), estimate the impact on each sector ETF.
// sector_pct ≈ -sum_over_factors(loading × shock_z) × BETA_SCALE
// BETA_SCALE calibrated so a +2σ composite shock produces roughly a -5% sector move
// (matches 2018Q4-ish episode).
function sectorShockPct_Lab(factorShocks){
  const BETA_SCALE=1.4; // %-per-loading-per-σ
  const out={};
  SECTOR_ETFS_LAB.forEach(e=>{
    const sector=SECTORS.find(s=>s.id===e.sectorId);
    if(!sector){out[e.tkr]=0;return;}
    // Average the subsector loadings (same logic as matrixRows).
    let totalImpact=0;
    FACTOR_KEYS_LAB.forEach(fk=>{
      const shock=factorShocks[fk]||0;
      const loadings=sector.subsectors.map(ss=>ss.sensitivities?.[fk]??0);
      const meanLoading=loadings.reduce((a,b)=>a+b,0)/(loadings.length||1);
      totalImpact+=meanLoading*shock;
    });
    out[e.tkr]=-totalImpact*BETA_SCALE*(sector.beta||1.0);
  });
  return out;
}

// Aggregate sector shocks into a portfolio $ impact at a given notional.
function portfolioShockUSD_Lab(sectorShockPcts,notionalUSD,sectorWeights){
  let total=0;
  SECTOR_ETFS_LAB.forEach(e=>{
    const w=(sectorWeights?.[e.tkr]??e.benchPct)/100;
    total+=notionalUSD*w*(sectorShockPcts[e.tkr]||0)/100;
  });
  return total;
}

// Composite delta estimate from a factor shock vector — multiply the v4 weights by
// the shocks to the contributing indicators (using indicator→factor membership).
function compositeShock_Lab(factorShocks,weights){
  let num=0,den=0;
  Object.entries(weights).forEach(([id,{w,s}])=>{
    // Find which factor this indicator lives in (best-effort).
    const fac=FACTOR_DISPLAY_LAB.find(f=>(f.indIds||[]).includes(id));
    if(!fac)return;
    const shock=factorShocks[fac.key]||0;
    num+=s*shock*w; den+=w;
  });
  return den>0?num/den:0;
}

// ── Plain-English explainer wrapper · 2 lines per tile ──
const Explainer_Lab=({what,now,accent})=>(
  <div style={{marginTop:10,paddingTop:10,borderTop:"1px dashed var(--border-faint)",display:"grid",gridTemplateColumns:"auto 1fr",gap:"4px 10px",fontSize:11,lineHeight:1.5}}>
    <div style={{color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.05em",fontSize:10,paddingTop:1}}>WHAT THIS IS</div>
    <div style={{color:"var(--text-2)"}}>{what}</div>
    <div style={{color:accent||"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.05em",fontSize:10,paddingTop:1,fontWeight:700}}>READING NOW</div>
    <div style={{color:"var(--text)"}}>{now}</div>
  </div>
);

// Map regime combo → plain-English tilt sentence (drop-in for "so what" hero).
function tiltSentence_Lab(tactBucket,stratBucket){
  const key=regimeKey_Lab(tactBucket,stratBucket);
  const T={
    "cold | cold":"Risk-on. Run full equity weight, lean into cyclicals, keep cash minimal.",
    "cold | neutral":"Constructive. Maintain equity weight, modest tilt to quality cyclicals.",
    "neutral | cold":"Near-term noise inside a healthy backdrop. Buy pullbacks, trim hedges.",
    "neutral | neutral":"Neutral posture. Rebalance to target weights; no directional tilt.",
    "neutral | hot":"Slow movers flashing caution. Trim strategic beta, keep tactical longs.",
    "neutral | extreme":"Strategic warning without tactical confirmation. Build defensive cash 3-5%; no panic selling.",
    "hot | cold":"Near-term stress inside a benign trend. Fade tactical weakness; strategic stays long.",
    "hot | neutral":"Active hedging. Trim 1-2% of gross, add VIX calls or defensive sector tilt.",
    "hot | hot":"Coordinated mid-cycle warning. Reduce gross 3-5%, overweight quality / low-beta.",
    "hot | extreme":"Strategic exhaustion while tactical stresses. Shift 5-10% into cash / duration.",
    "extreme | neutral":"Single-tile extreme — historically a buying signal, not a sell. Do NOT de-risk.",
    "extreme | hot":"Mixed extreme. Equity-neutral; rotate toward value and energy over growth.",
    "extreme | extreme":"JOINT EXTREME — the de-risk signal. Cut gross equity by 10-15%, raise cash, buy put protection.",
  };
  return T[key]||"Stay disciplined. Rebalance to policy weights.";
}
// Regime header sentence — what's happening right now (one line).
function regimeSentence_Lab(tactBucket,stratBucket,tactComp,stratComp){
  const tac=tactBucket.toLowerCase(), str=stratBucket.toLowerCase();
  const tactPhrase={benign:"calm",normal:"settled",elevated:"stressed",extreme:"at top-decile stress"}[tac]||tac;
  const stratPhrase={benign:"constructive",normal:"balanced",elevated:"cautionary",extreme:"at top-decile stress"}[str]||str;
  return`Near-term (0-3 months) is ${tactPhrase} at ${tactComp>=0?"+":""}${tactComp.toFixed(2)} standard deviations. Longer-term (6-18 months) is ${stratPhrase} at ${stratComp>=0?"+":""}${stratComp.toFixed(2)}.`;
}

function SectorLab(){
const [openFactor,setOpenFactor]=useState(null);
const [indSort,setIndSort]=useState({key:"factor",dir:"asc"});
// Stress-test + allocation controls
const [scenarioId,setScenarioId]=useState(null);
const [customFactor,setCustomFactor]=useState("volatility");
const [customZ,setCustomZ]=useState(2.0);
const [notional,setNotional]=useState(1_000_000);
const [showAdvanced,setShowAdvanced]=useState(false);
const cyc=detectCycleStage();
const scored=SECTORS.map(s=>({...s,score:computeSectorScore(s)})).sort((a,b)=>b.score-a.score);

// ── v4 Punchline composites · AUC-weighted top-N per horizon ──────────────
const NEAR_COMP_LAB=compV4_Lab(NOW,V4_TACT_WEIGHTS);
const STRAT_COMP_LAB=compV4_Lab(NOW,V4_STRAT_WEIGHTS);
const NEAR_COMP_1M_LAB=compV4_Lab(MO1,V4_TACT_WEIGHTS);
const STRAT_COMP_1M_LAB=compV4_Lab(MO1,V4_STRAT_WEIGHTS);
const NEAR_VEL_LAB=NEAR_COMP_LAB-NEAR_COMP_1M_LAB;
const STRAT_VEL_LAB=STRAT_COMP_LAB-STRAT_COMP_1M_LAB;
const NEAR_BUCKET=levelBucketV4_Lab(NEAR_COMP_LAB,"tactical");
const STRAT_BUCKET=levelBucketV4_Lab(STRAT_COMP_LAB,"strategic");
const NEAR_MOVERS=topMoversV4_Lab(V4_TACT_WEIGHTS,3);
const STRAT_MOVERS=topMoversV4_Lab(V4_STRAT_WEIGHTS,3);
const ALIGN=alignmentFlagV4_Lab(NEAR_COMP_LAB,STRAT_COMP_LAB,NEAR_BUCKET,STRAT_BUCKET);
const V4_TACT_N=Object.keys(V4_TACT_WEIGHTS).length;
const V4_STRAT_N=Object.keys(V4_STRAT_WEIGHTS).length;

// ── Cycle block data ──────────────────────────────────────────────────────
const ism=IND.ism?.[6], ism3=IND.ism?.[8];
const ismDelta=(ism!=null&&ism3!=null)?(ism-ism3):null;
const ismSpark=sparkSeries_Lab("ism");
const yc=IND.yield_curve?.[6];
const ycSpark=sparkSeries_Lab("yield_curve");
const emProb=emRecessionProbPct_Lab(yc);
const emCol=emProb==null?"var(--text-muted)":emProb>=30?"#ff453a":emProb>=15?"#ff9f0a":"#30d158";

// ── Factor rows ───────────────────────────────────────────────────────────
const factorRows=FACTOR_DISPLAY_LAB.map(f=>{
  const raw=FACTOR_SCORES[f.key]??0;
  const contribs=(f.indIds||[]).map(id=>({
    id,
    label:IND[id]?.[0]||id,
    value:IND[id]?.[6],
    unit:IND[id]?.[4],
    sd:DS[id],
    asOf:AS_OF[id]||"—",
    spark:sparkSeries_Lab(id),
  }));
  return{key:f.key,label:f.label,raw,contribs};
});

// ── Indicator-inputs table rows ──────────────────────────────────────────
const indRowsRaw=[];
FACTOR_DISPLAY_LAB.forEach(f=>{
  (f.indIds||[]).forEach(id=>{
    indRowsRaw.push({
      id,
      label:IND[id]?.[0]||id,
      value:IND[id]?.[6],
      unit:IND[id]?.[4],
      sd:DS[id],
      asOf:AS_OF[id]||"—",
      factor:f.label,
    });
  });
});
const indRows=[...indRowsRaw].sort((a,b)=>{
  const k=indSort.key;
  let va=a[k],vb=b[k];
  if(k==="sd"||k==="value"){va=va??-Infinity;vb=vb??-Infinity;}
  else{va=String(va??"");vb=String(vb??"");}
  if(va<vb)return indSort.dir==="asc"?-1:1;
  if(va>vb)return indSort.dir==="asc"?1:-1;
  return 0;
});
const setIndSortKey=(key)=>setIndSort(prev=>({key,dir:prev.key===key&&prev.dir==="asc"?"desc":"asc"}));
const sortArrow=(key)=>indSort.key===key?(indSort.dir==="asc"?" ▲":" ▼"):"";

// ── Factor-loading matrix (sectors × factors) ────────────────────────────
// Aggregate subsector sensitivities to parent sector:
//   parent_loading[factor] = average of subsector.sensitivities[factor] (missing = 0)
const matrixFactors=FACTOR_DISPLAY_LAB.filter(f=>f.key!=="volatility"||SECTORS.some(s=>s.subsectors.some(ss=>ss.sensitivities?.volatility!=null)));
const matrixRows=[...SECTORS].map(s=>{
  const loadings={};
  matrixFactors.forEach(f=>{
    const vals=s.subsectors.map(ss=>ss.sensitivities?.[f.key]??0);
    loadings[f.key]=vals.reduce((a,b)=>a+b,0)/(vals.length||1);
  });
  return{id:s.id,name:s.name,loadings,score:computeSectorScore(s)};
}).sort((a,b)=>b.score-a.score);

// ── Base-rate readout (historical forward S&P returns by current regime) ──
const REGIME_KEY=regimeKey_Lab(NEAR_BUCKET.label,STRAT_BUCKET.label);
const BASE_60=FWD60D_BY_COMBO_LAB[REGIME_KEY]||null;
const BASE_252=FWD252D_BY_COMBO_LAB[REGIME_KEY]||null;
const BASE_60_HIT=BASE_60?histHitRatePct_Lab(BASE_60.mean,BASE_60.std):null;
const BASE_252_HIT=BASE_252?histHitRatePct_Lab(BASE_252.mean,BASE_252.std):null;
// Signal strength from walk-forward OOS (shown once as a headline chip)
const OOS_TACT=WF_STATS_LAB.tact, OOS_STRAT=WF_STATS_LAB.strat;
const SIGNAL_STRENGTH=(()=>{
  // % of OOS years where composite beat coin-flip AUC 0.5, averaged across both horizons
  const pct=Math.round(((OOS_TACT.yrsAboveCoin+OOS_STRAT.yrsAboveCoin)/(OOS_TACT.yrsTotal+OOS_STRAT.yrsTotal))*100);
  return{pct,label:pct>=60?"strong":pct>=45?"mixed":"weak",color:pct>=60?"#30d158":pct>=45?"#B8860B":"#ff9f0a"};
})();

// ── Capital allocation bridge — convert regime into sector ETF tilts ──
// Source: sector forward 60d returns in current regime vs neutral baseline.
// Tilt = clamp(sectorFwd - baselineFwd, -4%, +4%) rounded to 0.5% increments.
const sectorFwdNow=SECTOR_FWD60D_LAB[REGIME_KEY]||SECTOR_FWD60D_LAB["neutral | neutral"];
const sectorFwdBaseline=SECTOR_FWD60D_LAB["neutral | neutral"];
const ALLOC_ROWS=SECTOR_ETFS_LAB.map(e=>{
  const fwd=sectorFwdNow?.[e.tkr]??0;
  const base=sectorFwdBaseline?.[e.tkr]??0;
  const edge=fwd-base;
  // Convert edge (%) to tilt (pp of portfolio). Scale 0.8 so total sums roughly to zero.
  const rawTilt=edge*0.8;
  const tilt=Math.max(-4,Math.min(4,Math.round(rawTilt*2)/2));
  const newPct=Math.max(0,e.benchPct+tilt);
  const dollarImpact=notional*(tilt/100);
  return{...e,fwd,edge,tilt,newPct,dollarImpact};
});
// Net tilt sanity — scale so sum(tilt) ≈ 0 and total weight stays 100.
const TOTAL_TILT=ALLOC_ROWS.reduce((a,b)=>a+b.tilt,0);
const ALLOC_ROWS_FINAL=TOTAL_TILT===0?ALLOC_ROWS:ALLOC_ROWS.map(r=>{
  const adjustedTilt=r.tilt-(TOTAL_TILT/ALLOC_ROWS.length);
  return{...r,tilt:Math.round(adjustedTilt*2)/2,newPct:Math.max(0,r.benchPct+Math.round(adjustedTilt*2)/2),dollarImpact:notional*(Math.round(adjustedTilt*2)/2)/100};
});

// ── Stress test — selected scenario OR custom factor shock ──
const selectedScenario=STRESS_SCENARIOS_LAB.find(s=>s.id===scenarioId)||null;
let stressOut=null;
if(selectedScenario){
  const s=selectedScenario;
  // Sector impact: use the historical sector returns from that episode (anchored truth).
  const sectorHit=s.sectorPct;
  // Composite impact: use headline composite shock from scenario definition.
  stressOut={
    label:s.name,
    narrative:s.narrative,
    spx:s.spx,
    compTact:s.composite.tactical,
    compStrat:s.composite.strategic,
    sectorPct:sectorHit,
    portfolioUSD:portfolioShockUSD_Lab(sectorHit,notional,Object.fromEntries(SECTOR_ETFS_LAB.map(e=>[e.tkr,e.benchPct]))),
  };
}else if(customZ!==0){
  const shocks=propagateFactorShock_Lab(customFactor,customZ);
  const sectorHit=sectorShockPct_Lab(shocks);
  stressOut={
    label:`Custom: ${customFactor} shock ${customZ>=0?"+":""}${customZ.toFixed(1)} standard deviations (correlated)`,
    narrative:`One-factor shock propagated through the historical correlation matrix of the 9 macro factors (2006-2026).`,
    spx:null,
    compTact:compositeShock_Lab(shocks,V4_TACT_WEIGHTS),
    compStrat:compositeShock_Lab(shocks,V4_STRAT_WEIGHTS),
    sectorPct:sectorHit,
    portfolioUSD:portfolioShockUSD_Lab(sectorHit,notional,Object.fromEntries(SECTOR_ETFS_LAB.map(e=>[e.tkr,e.benchPct]))),
    propagated:shocks,
  };
}

// Plain-English helpers used in the hero
const REGIME_LINE_1=regimeSentence_Lab(NEAR_BUCKET.label,STRAT_BUCKET.label,NEAR_COMP_LAB,STRAT_COMP_LAB);
const REGIME_LINE_2=BASE_60?`In this regime historically (n=${BASE_60.n}): 3-month S&P return averaged ${BASE_60.mean>=0?"+":""}${BASE_60.mean.toFixed(1)}% with a ${BASE_60_HIT}% hit rate. 12-month averaged ${BASE_252.mean>=0?"+":""}${BASE_252.mean.toFixed(1)}%.`:`Insufficient history to show a base rate for this exact regime combination.`;
const REGIME_LINE_3=tiltSentence_Lab(NEAR_BUCKET.label,STRAT_BUCKET.label);

return(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:16}}>

  {/* ── ★ SO-WHAT HERO · what the market is saying + what to do ─────────────── */}
  <div style={{background:"var(--surface)",border:`2px solid ${ALIGN.color}55`,borderRadius:10,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.03)"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12,flexWrap:"wrap"}}>
      <div>
        <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.18em",marginBottom:4}}>SECTOR LAB · BETA</div>
        <div style={{fontSize:18,color:"var(--text)",fontFamily:"var(--font-display, Fraunces)",fontWeight:600,letterSpacing:"-0.01em"}}>What the market is telling you right now</div>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.1em"}}>SIGNAL STRENGTH</span>
        <span style={{padding:"3px 8px",borderRadius:3,background:SIGNAL_STRENGTH.color+"25",border:`1px solid ${SIGNAL_STRENGTH.color}`,color:SIGNAL_STRENGTH.color,fontSize:10,fontWeight:800,fontFamily:"monospace",letterSpacing:"0.1em"}}>{SIGNAL_STRENGTH.label.toUpperCase()}</span>
      </div>
    </div>

    {/* Three numbered plain-English sentences — the "so what" */}
    <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"8px 12px",alignItems:"start"}}>
      <div style={{fontSize:10,color:ALIGN.color,fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,paddingTop:2}}>1 · REGIME</div>
      <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55}}>{REGIME_LINE_1}</div>

      <div style={{fontSize:10,color:ALIGN.color,fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,paddingTop:2}}>2 · BASE RATE</div>
      <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55}}>{REGIME_LINE_2}</div>

      <div style={{fontSize:10,color:ALIGN.color,fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,paddingTop:2}}>3 · TILT</div>
      <div style={{fontSize:13,color:"var(--text)",lineHeight:1.55,fontWeight:600}}>{REGIME_LINE_3}</div>
    </div>

    {/* Visual tilt meter — diverging risk-off ← → risk-on */}
    <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed var(--border-faint)"}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.12em",marginBottom:4}}>
        <span>◀ DE-RISK</span><span>NEUTRAL</span><span>ADD RISK ▶</span>
      </div>
      <div style={{position:"relative",height:18,background:"linear-gradient(to right, #ff453a22 0%, #ff453a11 25%, var(--border) 50%, #30d15811 75%, #30d15822 100%)",borderRadius:3,overflow:"hidden"}}>
        {/* Marker for tactical */}
        <div title={`Tactical ${NEAR_COMP_LAB.toFixed(2)}`} style={{position:"absolute",top:0,bottom:0,left:`calc(${Math.max(2,Math.min(98,50-NEAR_COMP_LAB*25))}% - 2px)`,width:4,background:NEAR_BUCKET.color,borderRadius:2,boxShadow:"0 0 4px rgba(0,0,0,0.2)"}}/>
        {/* Marker for strategic */}
        <div title={`Strategic ${STRAT_COMP_LAB.toFixed(2)}`} style={{position:"absolute",top:0,bottom:0,left:`calc(${Math.max(2,Math.min(98,50-STRAT_COMP_LAB*25))}% - 2px)`,width:4,background:STRAT_BUCKET.color,opacity:0.65,borderRadius:2}}/>
        {/* Center tick */}
        <div style={{position:"absolute",top:"30%",bottom:"30%",left:"calc(50% - 1px)",width:2,background:"var(--text-dim)",opacity:0.3}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-2)",fontFamily:"monospace",marginTop:6}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:8,height:8,background:NEAR_BUCKET.color,borderRadius:1}}/>Tactical (0-3 months) · <b>{NEAR_BUCKET.label}</b></span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:8,height:8,background:STRAT_BUCKET.color,borderRadius:1,opacity:0.65}}/>Strategic (6-18 months) · <b>{STRAT_BUCKET.label}</b></span>
      </div>
    </div>
  </div>

  {/* ── ★ PUNCHLINE · two horizons · with confidence bands ─────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"14px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",fontWeight:700}}>
        TWO-HORIZON READ · {V4_TACT_N+V4_STRAT_N} predictive indicators
      </div>
      <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace"}}>
        Historical out-of-sample skill: <b style={{color:SIGNAL_STRENGTH.color}}>{SIGNAL_STRENGTH.pct}%</b> of years above random
      </div>
    </div>

    {/* Alignment one-liner (prose, no emoji clutter) */}
    <div style={{background:ALIGN.color+"15",borderLeft:`3px solid ${ALIGN.color}`,padding:"10px 12px",marginBottom:12,borderRadius:"0 4px 4px 0"}}>
      <div style={{fontSize:11,color:ALIGN.color,fontFamily:"monospace",letterSpacing:"0.1em",fontWeight:700,marginBottom:4}}>
        ALIGNMENT · {ALIGN.label}
      </div>
      <div style={{fontSize:12,color:"var(--text)",lineHeight:1.5}}>{ALIGN.desc}</div>
    </div>

    {/* Two-column: Tactical | Strategic with CI bands */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:10}}>
      {[
        {comp:NEAR_COMP_LAB,vel:NEAR_VEL_LAB,bucket:NEAR_BUCKET,movers:NEAR_MOVERS,band:COMP_NOISE_LAB.tact,
         label:"NEAR-TERM",horizon:"0-3 months",n:V4_TACT_N,oos:OOS_TACT},
        {comp:STRAT_COMP_LAB,vel:STRAT_VEL_LAB,bucket:STRAT_BUCKET,movers:STRAT_MOVERS,band:COMP_NOISE_LAB.strat,
         label:"LONGER-TERM",horizon:"6-18 months",n:V4_STRAT_N,oos:OOS_STRAT},
      ].map((t,i)=>(
        <div key={i} style={{background:"var(--surface-2)",border:`1px solid ${t.bucket.color}55`,borderRadius:6,padding:"10px 12px"}}>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.12em",marginBottom:6}}>
            {t.label} · {t.horizon} · {t.n} indicators
          </div>
          {/* Big label + reading */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{padding:"4px 10px",borderRadius:3,background:t.bucket.color+"25",border:`1px solid ${t.bucket.color}`,color:t.bucket.color,fontWeight:800,fontSize:12,fontFamily:"monospace",letterSpacing:"0.08em"}}>
              {t.bucket.label}
            </span>
            <span style={{fontSize:14,color:t.bucket.color,fontFamily:"monospace",fontWeight:700}}>
              {t.comp>=0?"+":""}{t.comp.toFixed(2)}
            </span>
            <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>
              ± {t.band.toFixed(2)} 1-year noise
            </span>
          </div>
          {/* Confidence band visualization */}
          <div style={{position:"relative",height:8,background:"var(--border)",borderRadius:2,overflow:"visible",marginBottom:8}}>
            {/* Band */}
            <div style={{position:"absolute",top:0,bottom:0,left:`${Math.max(0,Math.min(96,50+(t.comp-t.band)*20))}%`,width:`${Math.min(100,Math.max(2,t.band*40))}%`,background:t.bucket.color+"44",borderRadius:1}}/>
            {/* Point reading */}
            <div style={{position:"absolute",top:-2,bottom:-2,left:`calc(${Math.max(2,Math.min(98,50+t.comp*20))}% - 1.5px)`,width:3,background:t.bucket.color,borderRadius:1}}/>
            {/* Zero tick */}
            <div style={{position:"absolute",top:-1,bottom:-1,left:"calc(50% - 0.5px)",width:1,background:"var(--text-dim)",opacity:0.4}}/>
          </div>
          {/* Top contributors — visual chips */}
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
            {t.movers.map(m=>(
              <span key={m.id} style={{fontSize:10,fontFamily:"monospace",padding:"2px 6px",borderRadius:2,background:m.contrib>=0?"#ff453a15":"#30d15815",color:m.contrib>=0?"#ff453a":"#30d158",border:`1px solid ${m.contrib>=0?"#ff453a55":"#30d15855"}`}}>
                {m.label} {m.contrib>=0?"+":""}{m.contrib.toFixed(2)}
              </span>
            ))}
          </div>
          {/* Historical skill line */}
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",marginBottom:6}}>
            Track record: {t.oos.yrsAboveCoin}/{t.oos.yrsTotal} years out-of-sample above coin-flip · 3-month change {t.vel>=0?"+":""}{t.vel.toFixed(2)} ({trendWord_Lab(t.vel)})
          </div>
          {/* Tilt sentence */}
          <div style={{fontSize:12,color:"var(--text)",lineHeight:1.5,paddingTop:6,borderTop:"1px dashed var(--border-faint)"}}>
            <span style={{fontSize:9,color:t.bucket.color,fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,marginRight:6}}>POSTURE →</span>
            {t.bucket.tilt}
          </div>
        </div>
      ))}
    </div>
    <Explainer_Lab
      accent={ALIGN.color}
      what={`Two composites — near-term (0-3 months) and longer-term (6-18 months) — built from the macro indicators that historically predicted ${"S&P"} drawdowns. Each reading is standard deviations above/below 5-year average, with a 1-year noise band around it.`}
      now={`${NEAR_BUCKET.label} near-term, ${STRAT_BUCKET.label} longer-term. The alignment flag above is the only signal the back-test rewards acting on.`}
    />
  </div>

  {/* ── ★ CAPITAL ALLOCATION BRIDGE · trade ticket translation ────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"14px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",fontWeight:700}}>
        CAPITAL ALLOCATION · regime-driven sector ETF tilt
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>
        <span>Portfolio size</span>
        <input type="number" value={notional} min={10000} step={50000}
          onChange={e=>setNotional(Math.max(10000,parseInt(e.target.value)||1000000))}
          style={{width:120,padding:"3px 6px",fontSize:11,fontFamily:"monospace",background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:3,color:"var(--text)",textAlign:"right"}}/>
      </div>
    </div>

    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
        <thead>
          <tr style={{color:"var(--text-2)",textAlign:"left"}}>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)"}}>ETF</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)"}}>SECTOR</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)",textAlign:"right"}}>INDEX WEIGHT</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)",textAlign:"center"}}>TILT</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)",textAlign:"right"}}>NEW WEIGHT</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)",textAlign:"right"}}>$ IMPACT</th>
            <th style={{padding:"6px 8px",borderBottom:"1px solid var(--border)",textAlign:"right"}}>3M FWD (HIST.)</th>
          </tr>
        </thead>
        <tbody>
          {ALLOC_ROWS_FINAL.map(r=>{
            const tiltCol=r.tilt>0.5?"#30d158":r.tilt<-0.5?"#ff453a":"var(--text-2)";
            const barWidth=Math.min(40,Math.abs(r.tilt)*10);
            return(
              <tr key={r.tkr} style={{borderBottom:"1px solid var(--border-faint)"}}>
                <td style={{padding:"6px 8px",color:"var(--text)",fontWeight:700}}>{r.tkr}</td>
                <td style={{padding:"6px 8px",color:"var(--text-2)"}}>{r.name}</td>
                <td style={{padding:"6px 8px",color:"var(--text)",textAlign:"right"}}>{r.benchPct.toFixed(1)}%</td>
                <td style={{padding:"6px 8px",textAlign:"center"}}>
                  <div style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",width:100,height:16,background:"var(--surface-2)",borderRadius:2}}>
                    <div style={{position:"absolute",top:0,bottom:0,left:"50%",width:1,background:"var(--text-dim)",opacity:0.4}}/>
                    <div style={{position:"absolute",top:2,bottom:2,[r.tilt>=0?"left":"right"]:"50%",width:`${barWidth}%`,background:tiltCol,opacity:0.6,borderRadius:1}}/>
                    <span style={{position:"relative",fontSize:10,color:tiltCol,fontWeight:700}}>{r.tilt>0?"+":""}{r.tilt.toFixed(1)}%</span>
                  </div>
                </td>
                <td style={{padding:"6px 8px",color:"var(--text)",textAlign:"right",fontWeight:700}}>{r.newPct.toFixed(1)}%</td>
                <td style={{padding:"6px 8px",color:tiltCol,textAlign:"right",fontWeight:700}}>{r.dollarImpact>=0?"+":"-"}${Math.abs(Math.round(r.dollarImpact)).toLocaleString()}</td>
                <td style={{padding:"6px 8px",color:r.fwd>=0?"#30d158":"#ff453a",textAlign:"right"}}>{r.fwd>=0?"+":""}{r.fwd.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <Explainer_Lab
      accent={ALIGN.color}
      what={`A dollar translation of the regime read. 3M FWD column is the average historical 3-month return for each sector ETF in the current regime combination (sample size varies — see methodology). Tilt is the suggested overweight/underweight relative to S&P 500 sector weights, capped at ±4%.`}
      now={`Tilts sum to zero — same total equity weight, different composition. The $ IMPACT column shows the trade size per sector at your portfolio size.`}
    />
  </div>

  {/* ── ★ STRESS TEST · composite → sectors → your portfolio ────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"14px 16px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",fontWeight:700,marginBottom:10}}>
      STRESS TEST · pick a scenario or build your own
    </div>

    {/* Scenario buttons */}
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
      {STRESS_SCENARIOS_LAB.map(s=>{
        const isSel=scenarioId===s.id;
        return(
          <button key={s.id} onClick={()=>setScenarioId(isSel?null:s.id)}
            style={{padding:"6px 12px",fontSize:11,fontFamily:"monospace",letterSpacing:"0.05em",
              background:isSel?"#ff453a20":"var(--surface-2)",
              color:isSel?"#ff453a":"var(--text)",
              border:`1px solid ${isSel?"#ff453a":"var(--border)"}`,
              borderRadius:3,cursor:"pointer",fontWeight:isSel?700:400}}>
            {s.name}
          </button>
        );
      })}
      <button onClick={()=>{setScenarioId(null);}}
        style={{padding:"6px 12px",fontSize:11,fontFamily:"monospace",letterSpacing:"0.05em",
          background:scenarioId==null?"var(--surface-2)":"transparent",
          color:"var(--text-2)",border:"1px dashed var(--border)",borderRadius:3,cursor:"pointer"}}>
        Custom shock
      </button>
    </div>

    {/* Custom shock panel — only when no scenario selected */}
    {!selectedScenario&&(
      <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px",marginBottom:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>DRIVER FACTOR</div>
          <select value={customFactor} onChange={e=>setCustomFactor(e.target.value)}
            style={{width:"100%",padding:"5px 8px",fontSize:12,fontFamily:"monospace",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:3,color:"var(--text)"}}>
            {FACTOR_KEYS_LAB.map(k=>(<option key={k} value={k}>{FACTOR_DISPLAY_LAB.find(f=>f.key===k)?.label||k}</option>))}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>SHOCK SIZE (standard deviations)</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="range" min="-4" max="4" step="0.5" value={customZ}
              onChange={e=>setCustomZ(parseFloat(e.target.value))}
              style={{flex:1}}/>
            <span style={{fontSize:13,fontFamily:"monospace",color:customZ>=0?"#ff453a":"#30d158",fontWeight:700,minWidth:44,textAlign:"right"}}>
              {customZ>=0?"+":""}{customZ.toFixed(1)}
            </span>
          </div>
        </div>
        <div style={{fontSize:10,color:"var(--text-dim)",lineHeight:1.5}}>
          Single-factor shock propagates to the other 8 factors via historical correlation. +2 standard deviations = a 2008/2020-class stress on that factor.
        </div>
      </div>
    )}

    {/* Stress output — cascade: composite → sectors → portfolio */}
    {stressOut?(
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {/* Scenario narrative (if canned) */}
        {selectedScenario&&(
          <div style={{fontSize:11,color:"var(--text-2)",lineHeight:1.5,fontStyle:"italic",borderLeft:"2px solid var(--border)",paddingLeft:10}}>
            {stressOut.narrative} S&P over the window: <b style={{color:stressOut.spx>=0?"#30d158":"#ff453a"}}>{stressOut.spx>=0?"+":""}{stressOut.spx}%</b>.
          </div>
        )}
        {/* ROW 1: COMPOSITE INDICATOR impact */}
        <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,marginBottom:8}}>
            STEP 1 · IMPACT ON COMPOSITE INDICATORS
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
            {[
              {label:"Near-term composite",cur:NEAR_COMP_LAB,delta:stressOut.compTact},
              {label:"Longer-term composite",cur:STRAT_COMP_LAB,delta:stressOut.compStrat},
            ].map((x,i)=>{
              const after=x.cur+x.delta;
              const afterCol=after>1.2?"#ff453a":after>0.5?"#ff9f0a":after<-0.5?"#30d158":"var(--text-2)";
              return(
                <div key={i}>
                  <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",marginBottom:4}}>{x.label}</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:6,fontSize:12,fontFamily:"monospace"}}>
                    <span style={{color:"var(--text-2)"}}>{x.cur>=0?"+":""}{x.cur.toFixed(2)}</span>
                    <span style={{color:"var(--text-dim)"}}>→</span>
                    <span style={{color:afterCol,fontWeight:700,fontSize:14}}>{after>=0?"+":""}{after.toFixed(2)}</span>
                    <span style={{color:x.delta>=0?"#ff453a":"#30d158",fontSize:10,marginLeft:4}}>
                      ({x.delta>=0?"+":""}{x.delta.toFixed(2)})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ROW 2: SECTOR ALLOCATION impact */}
        <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,marginBottom:8}}>
            STEP 2 · IMPACT ON SECTOR ALLOCATIONS (% move per ETF)
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:6}}>
            {SECTOR_ETFS_LAB.map(e=>{
              const p=stressOut.sectorPct[e.tkr]??0;
              const col=p>0?"#30d158":p<0?"#ff453a":"var(--text-2)";
              const mag=Math.min(100,Math.abs(p)*2);
              return(
                <div key={e.tkr} style={{fontSize:11,fontFamily:"monospace",display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:"var(--text)",minWidth:36,fontWeight:700}}>{e.tkr}</span>
                  <div style={{flex:1,position:"relative",height:12,background:"var(--surface)",borderRadius:2}}>
                    <div style={{position:"absolute",top:0,bottom:0,left:"50%",width:1,background:"var(--text-dim)",opacity:0.4}}/>
                    <div style={{position:"absolute",top:1,bottom:1,[p>=0?"left":"right"]:"50%",width:`${mag/2}%`,background:col,opacity:0.65,borderRadius:1}}/>
                  </div>
                  <span style={{color:col,fontWeight:700,minWidth:50,textAlign:"right"}}>{p>=0?"+":""}{p.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ROW 3: PORTFOLIO $ impact */}
        <div style={{background:stressOut.portfolioUSD>=0?"#30d15815":"#ff453a15",border:`2px solid ${stressOut.portfolioUSD>=0?"#30d158":"#ff453a"}`,borderRadius:6,padding:"14px 16px"}}>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.12em",fontWeight:700,marginBottom:6}}>
            STEP 3 · IMPACT ON YOUR PORTFOLIO (at S&P sector weights)
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:28,fontWeight:800,fontFamily:"var(--font-display, Fraunces)",color:stressOut.portfolioUSD>=0?"#30d158":"#ff453a"}}>
              {stressOut.portfolioUSD>=0?"+":"-"}${Math.abs(Math.round(stressOut.portfolioUSD)).toLocaleString()}
            </span>
            <span style={{fontSize:13,color:"var(--text-2)",fontFamily:"monospace"}}>
              ({(stressOut.portfolioUSD/notional*100).toFixed(1)}% of ${notional.toLocaleString()})
            </span>
          </div>
          <div style={{fontSize:11,color:"var(--text-2)",marginTop:6,lineHeight:1.5}}>
            Assumes your portfolio is weighted to the S&amp;P 500 sectors (XLK, XLF, XLV, etc. at current index weights). Change the portfolio size above to rescale.
          </div>
        </div>
      </div>
    ):(
      <div style={{fontSize:11,color:"var(--text-muted)",fontStyle:"italic",padding:"20px 12px",textAlign:"center"}}>
        Pick a scenario above, or move the custom slider off zero, to see the impact cascade.
      </div>
    )}

    <Explainer_Lab
      accent={"#ff453a"}
      what={`Runs a factor-level shock through the sector × factor loading matrix to estimate sector returns, then aggregates to a dollar P&L at your portfolio size. Canned scenarios use historical episode returns directly; custom shocks propagate via factor correlation.`}
      now={stressOut?`${selectedScenario?`Replaying ${selectedScenario.name}.`:`Custom ${customFactor} shock of ${customZ>=0?"+":""}${customZ.toFixed(1)} standard deviations, correlated to the other 8 factors.`} Portfolio impact shown in step 3 below.`:`No scenario selected. Pick one above to see the cascade.`}
    />
  </div>

  {/* ── Section 1 · CYCLE STAGE (expanded) ─────────────────────────────── */}
  <div style={{background:"var(--surface)",border:`1px solid ${cyc.color}55`,borderRadius:8,padding:"14px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10,marginBottom:12}}>
      <div>
        <div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:6}}>1 · CYCLE STAGE</div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{padding:"6px 14px",borderRadius:4,background:cyc.color+"20",border:`1px solid ${cyc.color}`,fontSize:14,fontWeight:800,color:cyc.color,fontFamily:"monospace",letterSpacing:"0.1em"}}>{cyc.label}</div>
          <div style={{fontSize:12,color:"var(--text)",fontFamily:"monospace"}}>{cyc.desc}</div>
        </div>
      </div>
      <div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",textAlign:"right"}}>
        <div>COMPOSITE · {COMP100}/100 · {CONV.label}</div>
        <div>TREND · {TREND_SIG.arrow} {TREND_SIG.label}</div>
      </div>
    </div>

    {/* 4-stage diagram */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
      {CYCLE_STAGES_LAB.map(st=>{
        const isCur=st.key===cyc.stageKey;
        return(
          <div key={st.key} style={{background:isCur?st.color+"25":"var(--surface-2)",border:`1px solid ${isCur?st.color:"var(--border)"}`,borderRadius:6,padding:"8px 10px",opacity:isCur?1:0.55}}>
            <div style={{fontSize:10,color:isCur?st.color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.1em",fontWeight:700,marginBottom:3}}>{isCur?"◆ ":"○ "}{st.label}</div>
            <div style={{fontSize:10,color:"var(--text-muted)",lineHeight:1.4}}>{st.rule}</div>
          </div>
        );
      })}
    </div>

    {/* ISM + YC blocks side-by-side */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10}}>
      {/* ISM PMI */}
      <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
        <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:6}}>Manufacturing PMI · coincident growth</div>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:6}}>
          <div>
            <span style={{fontSize:20,fontWeight:800,color:ism!=null&&ism>=50?"#30d158":"#ff453a",fontFamily:"monospace"}}>{ism!=null?ism.toFixed(1):"—"}</span>
            <span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",marginLeft:6}}>as of {AS_OF.ism||"—"}</span>
          </div>
          <LabSpark series={ismSpark} color={ism!=null&&ism>=50?"#30d158":"#ff453a"} w={72} h={22}/>
        </div>
        <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>
          3-month change · <span style={{color:ismDelta==null?"var(--text-muted)":ismDelta>0?"#30d158":"#ff453a",fontWeight:700}}>{ismDelta==null?"—":`${ismDelta>=0?"+":""}${ismDelta.toFixed(1)}`}</span>
          <span style={{color:"var(--text-muted)",marginLeft:10}}>above 50 = expansion, below 45 = recession-consistent</span>
        </div>
      </div>
      {/* Yield Curve */}
      <div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px"}}>
        <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:6}}>10-year minus 2-year Treasury spread · leading growth</div>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:6}}>
          <div>
            <span style={{fontSize:20,fontWeight:800,color:yc==null?"var(--text-muted)":yc<0?"#ff453a":yc<40?"#ff9f0a":"#30d158",fontFamily:"monospace"}}>{yc==null?"—":`${yc>=0?"+":""}${yc.toFixed(0)}`}</span>
            <span style={{fontSize:11,color:"var(--text-muted)",marginLeft:4,fontFamily:"monospace"}}>basis points</span>
            <span style={{fontSize:11,color:yc==null?"var(--text-muted)":yc<0?"#ff453a":"var(--text-muted)",fontFamily:"monospace",marginLeft:8,fontWeight:yc!=null&&yc<0?700:400}}>{yc==null?"":yc<0?"INVERTED":"POSITIVE"}</span>
          </div>
          <LabSpark series={ycSpark} color={yc==null?"#888":yc<0?"#ff453a":"#30d158"} w={72} h={22}/>
        </div>
        <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>
          Recession probability (12-month) · <span style={{color:emCol,fontWeight:700}}>{emProb==null?"—":`${emProb.toFixed(1)}%`}</span>
        </div>
      </div>
    </div>

    <Explainer_Lab
      accent={cyc.color}
      what={`Where we are in the business cycle, read off two signals: manufacturing activity (coincident) and the Treasury yield curve (leading). Combined, they place us in one of four stages: early cycle, mid cycle, late cycle, or recession.`}
      now={`${cyc.label} regime. Manufacturing PMI is ${ism!=null?(ism>=50?`${ism.toFixed(1)} (expansion)`:`${ism.toFixed(1)} (contraction)`):"—"}; yield curve is ${yc==null?"—":yc<0?"inverted (recession signal)":`positive ${yc.toFixed(0)} basis points`}.`}
    />
  </div>

  {/* ── Section 2 · FACTOR SCORES (open by default) ───────────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>2 · MACRO FACTOR SCORES · {factorRows.length} factors · click a row to see its indicators</div>
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {factorRows.map(r=>{
        const col=r.raw>1.2?"#ff453a":r.raw>0.5?"#ff9f0a":"#30d158";
        const barPct=Math.max(3,Math.min(100,(r.raw/2)*100));
        const isOpen=openFactor===r.key;
        return(
          <div key={r.key} style={{background:"var(--surface-2)",border:`1px solid ${isOpen?col+"55":"var(--border)"}`,borderRadius:5}}>
            <div onClick={()=>setOpenFactor(isOpen?null:r.key)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",cursor:"pointer"}}>
              <span style={{fontSize:10,color:col,fontFamily:"monospace",minWidth:12}}>{isOpen?"▾":"▸"}</span>
              <span style={{fontSize:12,color:"var(--text)",fontFamily:"monospace",minWidth:110,fontWeight:700}}>{r.label}</span>
              <div style={{flex:1,height:5,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
                <div style={{width:`${barPct}%`,height:"100%",background:col,opacity:0.85}}/>
              </div>
              <span style={{fontSize:11,color:col,fontFamily:"monospace",fontWeight:700,minWidth:48,textAlign:"right"}}>{r.raw.toFixed(2)}</span>
              <span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",minWidth:66,textAlign:"right"}}>{r.raw>1.2?"EXTREME":r.raw>0.5?"ELEVATED":"BENIGN"}</span>
            </div>
            {isOpen&&(
              <div style={{borderTop:"1px solid var(--border)",padding:"8px 12px 10px 34px"}}>
                <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:6}}>CONTRIBUTING INDICATORS</div>
                <div style={{display:"grid",gridTemplateColumns:"minmax(150px,1.2fr) minmax(80px,0.7fr) minmax(70px,0.5fr) minmax(100px,0.6fr) auto",gap:"6px 12px",alignItems:"center",fontSize:11,fontFamily:"monospace"}}>
                  <div style={{color:"var(--text-2)"}}>INDICATOR</div>
                  <div style={{color:"var(--text-2)",textAlign:"right"}}>VALUE</div>
                  <div style={{color:"var(--text-2)",textAlign:"right",whiteSpace:"nowrap"}}>STRESS</div>
                  <div style={{color:"var(--text-2)"}}>as of</div>
                  <div style={{color:"var(--text-2)"}}>TREND</div>
                  {r.contribs.map(c=>{
                    const sdCol=c.sd==null?"var(--text-muted)":c.sd>1.2?"#ff453a":c.sd>0.5?"#ff9f0a":c.sd<-0.5?"#30d158":"var(--text-2)";
                    return(<Fragment key={c.id}>
                      <div style={{color:"var(--text)"}}>{c.label} <span style={{color:"var(--text-dim)",fontSize:10}}>· {c.id}</span></div>
                      <div style={{color:"var(--text)",textAlign:"right"}}>{c.value==null?"—":fmtV(c.id,c.value)}</div>
                      <div style={{color:sdCol,textAlign:"right",fontWeight:700}}>{c.sd==null?"—":`${c.sd>=0?"+":""}${c.sd.toFixed(2)}`}</div>
                      <div style={{color:"var(--text-muted)"}}>{c.asOf}</div>
                      <div><LabSpark series={c.spark} color={sdCol} w={54} h={16}/></div>
                    </Fragment>);
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
    <Explainer_Lab
      accent={"#ff9f0a"}
      what={`Each macro factor rolls up its contributing indicators into one stress score (in standard deviations from a 5-year mean). Values below 0.5 are benign, 0.5-1.2 are elevated, above 1.2 are extreme. Same formula drives the sector ranking.`}
      now={`${factorRows.filter(r=>r.raw>1.2).length} factors in the extreme zone, ${factorRows.filter(r=>r.raw>0.5&&r.raw<=1.2).length} elevated. Click a row to see which indicators are driving it.`}
    />
  </div>

  {/* ── Section 3 · INDICATOR INPUTS TABLE ────────────────────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>3 · INDICATOR INPUTS · {indRows.length} series · click a header to sort</div>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
        <thead>
          <tr style={{color:"var(--text-2)",textAlign:"left"}}>
            <th onClick={()=>setIndSortKey("label")}   style={{padding:"4px 8px",cursor:"pointer",borderBottom:"1px solid var(--border)"}}>INDICATOR{sortArrow("label")}</th>
            <th onClick={()=>setIndSortKey("factor")}  style={{padding:"4px 8px",cursor:"pointer",borderBottom:"1px solid var(--border)"}}>FACTOR{sortArrow("factor")}</th>
            <th onClick={()=>setIndSortKey("value")}   style={{padding:"4px 8px",cursor:"pointer",borderBottom:"1px solid var(--border)",textAlign:"right"}}>VALUE{sortArrow("value")}</th>
            <th onClick={()=>setIndSortKey("sd")}      style={{padding:"4px 8px",cursor:"pointer",borderBottom:"1px solid var(--border)",textAlign:"right"}}>STRESS{sortArrow("sd")}</th>
            <th onClick={()=>setIndSortKey("asOf")}    style={{padding:"4px 8px",cursor:"pointer",borderBottom:"1px solid var(--border)"}}>as of{sortArrow("asOf")}</th>
          </tr>
        </thead>
        <tbody>
          {indRows.map((r,i)=>{
            const sdCol=r.sd==null?"var(--text-muted)":r.sd>1.2?"#ff453a":r.sd>0.5?"#ff9f0a":r.sd<-0.5?"#30d158":"var(--text-2)";
            return(
              <tr key={`${r.id}-${r.factor}-${i}`} style={{borderBottom:"1px solid var(--border-faint)"}}>
                <td style={{padding:"4px 8px",color:"var(--text)"}}>{r.label} <span style={{color:"var(--text-dim)"}}>· {r.id}</span></td>
                <td style={{padding:"4px 8px",color:"var(--text-2)"}}>{r.factor}</td>
                <td style={{padding:"4px 8px",color:"var(--text)",textAlign:"right"}}>{r.value==null?"—":fmtV(r.id,r.value)}</td>
                <td style={{padding:"4px 8px",color:sdCol,textAlign:"right",fontWeight:700}}>{r.sd==null?"—":`${r.sd>=0?"+":""}${r.sd.toFixed(2)}`}</td>
                <td style={{padding:"4px 8px",color:"var(--text-muted)"}}>{r.asOf}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <Explainer_Lab
      accent={"#ff9f0a"}
      what={`Every indicator feeding the macro factors, flat. An indicator appears in multiple rows if it contributes to more than one factor. Stress is the indicator's distance from its 5-year average in standard deviations, direction-adjusted so positive always means risky.`}
      now={`${indRows.filter(r=>r.sd!=null&&r.sd>1.2).length} indicators at extreme stress, ${indRows.filter(r=>r.sd!=null&&r.sd>0.5&&r.sd<=1.2).length} elevated. Sort by stress to see what's driving the regime.`}
    />
  </div>

  {/* ── Section 4 · FACTOR-LOADING MATRIX ──────────────────────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>4 · SECTOR × FACTOR LOADING MATRIX · {matrixRows.length} sectors × {matrixFactors.length} factors · cell = avg subsector sensitivity</div>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:"monospace"}}>
        <thead>
          <tr>
            <th style={{padding:"4px 8px",textAlign:"left",color:"var(--text-2)",borderBottom:"1px solid var(--border)"}}>SECTOR</th>
            {matrixFactors.map(f=>(
              <th key={f.key} style={{padding:"4px 6px",textAlign:"center",color:"var(--text-2)",borderBottom:"1px solid var(--border)",letterSpacing:"0.05em"}}>{f.label.toUpperCase()}</th>
            ))}
            <th style={{padding:"4px 8px",textAlign:"right",color:"var(--text-2)",borderBottom:"1px solid var(--border)"}}>SCORE</th>
          </tr>
        </thead>
        <tbody>
          {matrixRows.map(r=>{
            const ol=outlookLabel(r.score);
            return(
              <tr key={r.id} style={{borderBottom:"1px solid var(--border-faint)"}}>
                <td style={{padding:"4px 8px",color:"var(--text)",fontWeight:600}}>{r.name}</td>
                {matrixFactors.map(f=>{
                  const load=r.loadings[f.key]||0;
                  const absL=Math.abs(load);
                  let bg="transparent",fg="var(--text-muted)";
                  if(load>0){
                    const intensity=Math.min(1,absL/3);
                    bg=`rgba(255,69,58,${(intensity*0.5).toFixed(2)})`;
                    fg=intensity>0.6?"#fff":"#ff453a";
                  }else if(load<0){
                    const intensity=Math.min(1,absL/3);
                    bg=`rgba(48,209,88,${(intensity*0.5).toFixed(2)})`;
                    fg=intensity>0.6?"#fff":"#30d158";
                  }
                  return<td key={f.key} style={{padding:"4px 6px",textAlign:"center",background:bg,color:fg,fontWeight:load!==0?700:400}}>{load===0?"·":load.toFixed(1)}</td>;
                })}
                <td style={{padding:"4px 8px",color:ol.color,textAlign:"right",fontWeight:700}}>{ol.short}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <Explainer_Lab
      accent={"#ff9f0a"}
      what={`How much each sector moves with each macro factor. Red cells = sector gets hurt when that factor is stressed (positive loading). Green cells = sector benefits (negative loading). This is the engine that turns macro factor scores into a sector ranking.`}
      now={`Top-ranked sector today: ${matrixRows[0]?.name}. Bottom-ranked: ${matrixRows[matrixRows.length-1]?.name}. Hover the ALIGNMENT note at the top to see the translation into trade recommendations.`}
    />
  </div>

  {/* ── Section 5 · SECTOR RANKING ──────────────────────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"10px 14px"}}>
    <div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:6}}>5 · SECTOR RANKING · live read, same score as the main Sectors tab</div>
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      {scored.map((s,i)=>{
        const ol=outlookLabel(s.score);
        const barPct=Math.max(5,Math.min(100,s.score*80));
        return(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",minWidth:14,textAlign:"right"}}>{i+1}</span>
            <span style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",minWidth:140}}>{s.name}</span>
            <div style={{flex:1,height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${barPct}%`,height:"100%",background:ol.color,opacity:0.8}}/>
            </div>
            <span style={{fontSize:10,fontWeight:700,color:ol.color,fontFamily:"monospace",minWidth:84,textAlign:"right"}}>{ol.label}</span>
          </div>
        );
      })}
    </div>
    <Explainer_Lab
      accent={"#ff9f0a"}
      what={`Bottom-up sector ranking: each sector's score combines its factor sensitivities (Section 4) with current factor stress levels (Section 2). Higher score = more favorable macro setup.`}
      now={`Leader: ${scored[0]?.name}. Laggard: ${scored[scored.length-1]?.name}. Use in combination with the capital allocation bridge above for the trade-ticket view.`}
    />
  </div>

  {/* ── Section 6 · METHODOLOGY ──────────────────────────────────────── */}
  <div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>6 · METHODOLOGY · how the Sector Lab engine works</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,fontSize:12,color:"var(--text)",lineHeight:1.55}}>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>SECTOR SCORES FROM MACRO FACTORS</div>
        <div>Each sector's score is built bottom-up from its sub-industry sensitivities to 9 macro factors (interest rates, credit, banking, consumer, growth, dollar, valuation, commercial real estate, volatility). The parent score averages across sub-industries. This is an arbitrage-pricing-theory treatment — sector returns are driven by macro factors, not by a single market beta.</div>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginTop:4}}>Anchor: Chen, Roll &amp; Ross (1986) — "Economic Forces and the Stock Market."</div>
      </div>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>CYCLE STAGE CLASSIFIER</div>
        <div>Manufacturing PMI level and 3-month change gate the four-stage business-cycle read; the 10-year minus 2-year Treasury spread confirms the leading-growth direction. Recession probability uses a logistic fit on the same spread — the canonical specification uses 10-year minus 3-month, which we show as a caveat.</div>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginTop:4}}>Anchor: Estrella &amp; Mishkin (1996) — "The Yield Curve as a Predictor of U.S. Recessions," FRBNY.</div>
      </div>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>FACTOR CONSTRUCTION</div>
        <div>Each factor averages the standardized deviations of its contributing indicators (distance from 5-year mean, direction-adjusted so higher always means riskier). Equal weights within a factor. Data: FRED, ICE BofA, NY Fed CMDI, Shiller CAPE, CBOE.</div>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginTop:4}}>Anchor: Fama &amp; French (1993) — multifactor models motivate linear aggregation.</div>
      </div>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>HISTORICAL SKILL · HONEST READ</div>
        <div>In-sample 2006-2026 hit rate is genuinely above coin-flip (tactical 66%, strategic 72%). Out-of-sample, refitting annually, it's {OOS_TACT.yrsAboveCoin}/{OOS_TACT.yrsTotal} years above coin-flip tactical and {OOS_STRAT.yrsAboveCoin}/{OOS_STRAT.yrsTotal} strategic — a real but unstable edge. Use it as a calibrated lens, not a point forecast.</div>
        {/* Year-by-year OOS skill heatmap — visual, not text */}
        <div style={{marginTop:8}}>
          <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:3}}>YEAR-BY-YEAR TRACK RECORD (tactical · strategic)</div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${WALKFORWARD_OOS_LAB.length},1fr)`,gap:2}}>
            {WALKFORWARD_OOS_LAB.map(r=>{
              const tColor=r.tact==null?"var(--border)":r.tact>=0.5?"#30d158":r.tact>=0.4?"#ff9f0a":"#ff453a";
              const sColor=r.strat==null?"var(--border)":r.strat>=0.5?"#30d158":r.strat>=0.4?"#ff9f0a":"#ff453a";
              return(
                <div key={r.year} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                  <div title={`${r.year} tactical: ${r.tact==null?"—":r.tact.toFixed(2)}`} style={{width:"100%",height:10,background:tColor,opacity:0.85,borderRadius:1}}/>
                  <div title={`${r.year} strategic: ${r.strat==null?"—":r.strat.toFixed(2)}`} style={{width:"100%",height:10,background:sColor,opacity:0.55,borderRadius:1}}/>
                  <span style={{fontSize:8,color:"var(--text-dim)",fontFamily:"monospace"}}>'{String(r.year).slice(-2)}</span>
                </div>
              );
            })}
          </div>
          <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"monospace",marginTop:4,display:"flex",justifyContent:"space-between"}}>
            <span>Green = beat coin-flip</span><span>Yellow = borderline</span><span>Red = below</span>
          </div>
        </div>
        <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginTop:6}}>Full back-test: /sector_lab_research/backtest_v4_report.html</div>
      </div>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>STRESS TEST METHODOLOGY</div>
        <div>Canned scenarios replay the actual factor moves and sector returns from historical episodes (2008, 2020, 2022, 2018 Q4). Custom shocks start with a single factor and propagate through the 9×9 historical correlation matrix (Pearson 2006-2026), then flow into sector P&amp;L via the loading matrix.</div>
      </div>
      <div>
        <div style={{fontSize:10,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4,fontWeight:700}}>CONFIDENCE BANDS</div>
        <div>The ± band around each composite is the trailing 1-year standard deviation of the composite time series (noise floor, not forecast uncertainty). Historical out-of-sample skill is reported separately as the share of years where the composite's AUC beat 0.5.</div>
      </div>
    </div>
  </div>

  <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace",textAlign:"center"}}>
    Sector Lab · research tab · not investment advice
  </div>
</div>
);
}

// ── LIVE AI ANALYSIS TAB ─────────────────────────────────────────────────────
function LiveAnalysisTab(){
const [analysis,setAnalysis]=useState("");
const [loading,setLoading]=useState(false);
const [error,setError]=useState("");
const [generatedAt,setGeneratedAt]=useState("");

const buildPrompt=()=>{
const indReadings=Object.entries(IND).map(([id,d])=>{
const s=sdScore(id,d[6]);
return`${d[0]}: ${fmtV(id,d[6])} (${sdLabel(s)}, as of ${AS_OF[id]})`;
}).join("\n");

return`You are a senior macro strategist writing a concise market stress analysis for a personal investment dashboard. Today is ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}.

CURRENT COMPOSITE STRESS: ${COMP100}/100 — ${CONV.label} ${TREND_SIG.arrow} ${TREND_SIG.label}
1-Month Prior: ${COMP1M100} | 3-Month Prior: ${COMP3M100}

LIVE INDICATOR READINGS:
${indReadings}

Write a structured macro analysis with these exact sections. Use ALL CAPS for section headers. Be specific, data-driven, and reference actual indicator values. Be concise — each section 2-4 sentences max.

REGIME SUMMARY
WHAT THE DATA IS SAYING
KEY RISKS TO WATCH
PORTFOLIO IMPLICATIONS

Do not use bullet points. Write in flowing prose. Do not add any preamble or closing remarks.`;
};

const generate=async()=>{
setLoading(true);
setError("");
setAnalysis("");
try{
const res=await fetch("/api/analyze",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({prompt:buildPrompt()})
});
if(!res.ok){const e=await res.json();throw new Error(e.error||`Server error ${res.status}`);}
const data=await res.json();
setAnalysis(data.text||"");
setGeneratedAt(new Date().toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}));
}catch(e){
setError(`Error: ${e.message}`);
}finally{
setLoading(false);
}
};

return(
<div style={{padding:"14px 20px"}}>
<div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"16px 18px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
<div>
<div style={{fontSize:11,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.18em",marginBottom:3}}>LIVE AI NARRATIVE ANALYSIS</div>
<div style={{fontSize:13,color:"var(--text-2)"}}>Generated from today's live indicator readings · Powered by Claude</div>
{generatedAt&&<div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",marginTop:4}}>📅 Generated {generatedAt}</div>}
</div>
<button onClick={generate} disabled={loading}
style={{padding:"8px 20px",borderRadius:4,border:`1px solid ${loading?"#333":CONV.color}`,background:loading?"var(--border-faint)":CONV.color+"20",color:loading?"var(--text)":CONV.color,cursor:loading?"not-allowed":"pointer",fontSize:12,fontFamily:"monospace",fontWeight:700,minWidth:160}}>
{loading?"⟳ GENERATING...":"▶ GENERATE ANALYSIS"}
</button>
</div>

{/* Indicator snapshot fed to Claude */}
<div style={{padding:"8px 12px",background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:4,marginBottom:12}}>
<div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",marginBottom:6}}>CURRENT READINGS BEING ANALYZED</div>
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{Object.entries(IND).map(([id,d])=>{
const s=sdScore(id,d[6]);
const col=sdColor(s);
return(
<div key={id} style={{background:"var(--border-faint)",border:`1px solid ${col}22`,borderRadius:3,padding:"2px 7px",display:"flex",gap:5,alignItems:"center"}}>
<span style={{fontSize:10,color:"var(--text)",fontFamily:"monospace"}}>{d[0]}</span>
<span style={{fontSize:11,fontWeight:700,color:col,fontFamily:"monospace"}}>{fmtV(id,d[6])}</span>
</div>
);
})}
</div>
</div>

{error&&(
<div style={{padding:"10px 14px",background:"#ef444410",border:"1px solid #ef444433",borderRadius:4,marginBottom:12}}>
<div style={{fontSize:12,color:"#ff453a",fontFamily:"monospace"}}>{error}</div>
</div>
)}

{loading&&(
<div style={{padding:"20px",textAlign:"center"}}>
<div style={{fontSize:13,color:"var(--text)",fontFamily:"monospace"}}>Analyzing {Object.keys(IND).length} indicators across rates, credit, banking, labor, and valuation...</div>
<div style={{marginTop:8,fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>Usually takes 5-10 seconds</div>
</div>
)}

{analysis&&!loading&&(
<div style={{fontSize:13,color:"var(--text)",lineHeight:1.9}}>
{analysis.split("\n\n").map((para,i)=>{
const lines=para.split("\n");
const isH=lines[0]===lines[0].toUpperCase()&&lines[0].length<60&&!lines[0].includes(".");
return(
<div key={i} style={{marginBottom:14}}>
{isH?(
<>
<div style={{fontSize:11,color:convTextColor(CONV),fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:6,marginTop:i>0?10:0}}>{lines[0]}</div>
<div style={{color:"var(--text)",lineHeight:1.85}}>{lines.slice(1).join(" ")}</div>
</>
):(
<div style={{color:"var(--text)",lineHeight:1.85}}>{para}</div>
)}
</div>
);
})}
</div>
)}

{!analysis&&!loading&&!error&&(
<div style={{padding:"30px 20px",textAlign:"center",borderTop:"1px solid var(--border-faint)"}}>
<div style={{fontSize:14,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:8}}>Click "Generate Analysis" to get a live narrative</div>
<div style={{fontSize:12,color:"#9a9a9a",fontFamily:"monospace"}}>Claude will analyze all current indicator readings and write a fresh macro summary</div>
</div>
)}
</div>
</div>
);
}

// ── MACRO NARRATIVE (auto-generated from live data) ─────────────────────────
function buildMacroNarrative(){
const lvl=CONV.label;
const score=COMP100;
const dir=TREND_SIG.label;
const arrow=TREND_SIG.arrow;
// Top stressed indicators
const top=Object.entries(IND).map(([id,d])=>({id,label:d[0],s:sdScore(id,d[6])}))
  .filter(x=>x.s!=null).sort((a,b)=>b.s-a.s);
const topStressed=top.filter(x=>x.s>0.5).slice(0,3).map(x=>x.label);
const topEasing=top.filter(x=>x.s<-0.5).reverse().slice(0,2).map(x=>x.label);
// Category composites
const catScores=Object.entries(CATS).map(([catId,cat])=>{
  const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
  const scored=ids.map(id=>sdScore(id,IND[id][6])).filter(x=>x!=null);
  const avg=scored.length?scored.reduce((a,b)=>a+b,0)/scored.length:0;
  return{cat:cat.label,s:avg,s100:Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100)))};
}).sort((a,b)=>b.s-a.s);
const hotCat=catScores[0];
const coolCat=catScores[catScores.length-1];

const sent2=topStressed.length>0
  ?`The most elevated readings are in ${topStressed.join(", ")}, while ${hotCat.cat} is the most stressed category at ${hotCat.s100}/100.`
  :`Stress is broadly contained across categories, with ${hotCat.cat} showing the most pressure at ${hotCat.s100}/100.`;

const sent3=topEasing.length>0
  ?`Easing signals include ${topEasing.join(" and ")}, and ${coolCat.cat} remains the least stressed category (${coolCat.s100}/100).`
  :`${coolCat.cat} remains the least stressed category at ${coolCat.s100}/100. Monitor trend direction closely for early regime shift signals.`;

return[sent2,sent3].join(" ");
}

// ── MACRO BULLETS (per-category "what's hot, why") ───────────────────────────
function buildMacroBullets(){
const catScores=Object.entries(CATS).map(([catId,cat])=>{
  const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
  const scoredInds=ids.map(id=>({id,label:IND[id][0],s:sdScore(id,IND[id][6]),current:IND[id][13]||""}))
    .filter(x=>x.s!=null).sort((a,b)=>b.s-a.s);
  const avg=scoredInds.length?scoredInds.reduce((a,b)=>a+b.s,0)/scoredInds.length:0;
  const sc100=Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100)));
  return{
    catId, label:cat.label, avg, sc100, color:sdColor(avg),
    drivers:scoredInds.slice(0,2),
    coolers:scoredInds.slice(-2).reverse(),
  };
});
const sorted=[...catScores].sort((a,b)=>b.avg-a.avg);
// Top 3 most-stressed + 1 most-eased for context
return sorted.slice(0,3).map(c=>{
  const driver=c.drivers[0];
  const why = c.avg>0.5
    ? `${driver.label} elevated — ${driver.current.replace(/^At\s+/i,"").split(".")[0]}.`
    : c.avg>0
    ? `Mild pressure from ${c.drivers.map(d=>d.label).join(" and ")}, but no single driver is severe.`
    : `Below long-run average — ${c.coolers[0].label} leading the easing.`;
  return {label:c.label, sc100:c.sc100, color:c.color, why};
});
}

// ── CATEGORY OVERVIEW (all 6 cats, current / 1M / 3M / regime) ───────────────
// Used by the Home-tab "Macro Overview" tile so users see the full picture at a
// glance instead of just the top-3 stressed bullets. Each category gets:
//   - current sc100 (0=calmest, 100=most stressed) and the matching regime label
//   - prior-month and prior-3-month sc100 readings (from IND[id][7] / IND[id][8])
//   - a trend-arrow vs. 1M ago so the direction of travel is obvious
// Data source: the static IND table. When the indicator snapshot updates, this
// tile auto-updates. There is no 1W column today — that requires a history
// writer (tracked separately); 1M is the finest resolution we currently have.
function buildCategoryOverview(){
return Object.entries(CATS).map(([catId,cat])=>{
  const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
  const cur =ids.map(id=>sdScore(id,IND[id][6])).filter(x=>x!=null);
  const m1  =ids.map(id=>sdScore(id,IND[id][7])).filter(x=>x!=null);
  const m6  =ids.map(id=>{const v=histValueAtMonthsAgo(id,6);return v==null?null:sdScore(id,v);}).filter(x=>x!=null);
  const m12 =ids.map(id=>{const v=histValueAtMonthsAgo(id,12);return v==null?null:sdScore(id,v);}).filter(x=>x!=null);
  const avg   =cur.length?cur.reduce((a,b)=>a+b,0)/cur.length:null;
  const avg1M =m1.length ?m1 .reduce((a,b)=>a+b,0)/m1.length :null;
  const avg6M =m6.length ?m6 .reduce((a,b)=>a+b,0)/m6.length :null;
  const avg12M=m12.length?m12.reduce((a,b)=>a+b,0)/m12.length:null;
  return{
    catId,
    label:cat.label,
    sc100 :avg   ==null?null:sdTo100(avg),
    sc1M  :avg1M ==null?null:sdTo100(avg1M),
    sc6M  :avg6M ==null?null:sdTo100(avg6M),
    sc12M :avg12M==null?null:sdTo100(avg12M),
    color :sdColor(avg),
    textColor:sdTextColor(avg),
    regime:sdLabel(avg),
    delta1M:(avg!=null&&avg1M!=null)?sdTo100(avg)-sdTo100(avg1M):null,
    indicatorCount:ids.length,
  };
});
}

// ── MAIN APP ─────────────────────────────────────────────────────────────────
// "portopps" is the consolidated Portfolio + Opportunities + Holdings surface.
// Old "#portfolio" hash redirects to "#portopps" (handled in the hash init/
// hashchange listeners in App()) so existing bookmarks keep working.
// "admin" is present in TAB_IDS so hash routing works for signed-in admins;
// non-admins are redirected to "home" by resolveHash() below (see App()).
// RegimeCategoryTable — bug #1042 (LESSONS rule #4): the macro-overview Regime
// table (Category / 12M / 6M / 1M / Now / State) becomes click-sortable on
// every column via the shared useSortableTable hook.
function RegimeCategoryTable({ rows, regimePillCSS, navTo, setCatFilter }){
  const REGIME_ORDER = { "risk-on": 0, "neutral": 1, "risk-off": 2 };
  const COLS = [
    { id: "label", label: "Category", align: "left",  sortValue: r => r.label },
    { id: "12m",   label: "12M",      align: "right", sortValue: r => r.sc12M },
    { id: "6m",    label: "6M",       align: "right", sortValue: r => r.sc6M },
    { id: "1m",    label: "1M",       align: "right", sortValue: r => r.sc1M },
    { id: "now",   label: "Now",      align: "right", sortValue: r => r.sc100 },
    { id: "state", label: "State",    align: "right", sortValue: r => REGIME_ORDER[r.regime] ?? 99 },
  ];
  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable_v1({
    rows, columns: COLS, defaultColId: "now", defaultDir: "desc",
  });
  const thBase = {
    fontFamily: "var(--font-mono)", fontSize: 10,
    color: "var(--text-dim)", letterSpacing: "0.12em", textTransform: "uppercase",
    padding: "var(--space-2) var(--space-3)",
    borderBottom: "1px solid var(--border-faint)", fontWeight: 500,
  };
  return (
    <table style={{width:"100%", borderCollapse:"collapse"}}>
      <thead>
        <tr>
          {COLS.map(col => {
            const sortable = sortableHeaderProps_v1({ colId: col.id, sortCol, sortDir, toggleSort });
            const styleMerged = { ...thBase, textAlign: col.align, ...(col.id === "state" ? { width: 110 } : {}), ...sortable.style };
            return (
              <th key={col.id} {...sortable} style={styleMerged}>
                {col.label} <SortArrow_v1 dir={sortCol === col.id ? sortDir : null}/>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((c,i,arr) => {
          const pill = regimePillCSS(c.regime);
          const isLast = i === arr.length-1;
          const tdBase = { borderBottom: isLast ? "none" : "1px solid var(--border-faint)", padding: "var(--space-3)", verticalAlign: "middle" };
          const numCell = { ...tdBase, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: 13 };
          const histCell = { ...numCell, color: "var(--text-muted)", fontWeight: 400 };
          const nowCell = { ...numCell, color: "var(--text)", fontWeight: 500, fontSize: 14 };
          return (
            <tr key={c.catId} onClick={()=>{navTo("indicators"); setCatFilter(c.catId);}} style={{cursor:"pointer"}}>
              <td style={{...tdBase, fontSize:13, color:"var(--text-muted)"}}>
                <div style={{color:"var(--text)", fontWeight:500, fontSize:13, lineHeight:1.3}}>{c.label}</div>
                <div style={{color:"var(--text-muted)", fontSize:12, marginTop:2}}>
                  {c.indicatorCount} indicator{c.indicatorCount===1?"":"s"}
                </div>
              </td>
              <td className="num" style={histCell}>{c.sc12M==null?"—":c.sc12M}</td>
              <td className="num" style={histCell}>{c.sc6M ==null?"—":c.sc6M}</td>
              <td className="num" style={histCell}>{c.sc1M ==null?"—":c.sc1M}</td>
              <td className="num" style={nowCell}>{c.sc100==null?"—":c.sc100}</td>
              <td style={{...tdBase, textAlign:"right"}}>
                <span style={{
                  display:"inline-flex", alignItems:"center",
                  padding:"2px 8px", borderRadius:10,
                  fontFamily:"var(--font-mono)", fontSize:10,
                  letterSpacing:"0.08em", textTransform:"uppercase",
                  border:`1px solid ${pill.color}`, color:pill.color,
                }}>{pill.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const TAB_IDS=["home","overview","indicators","sectors","portopps","scanner","readme","admin","bugs","lab"];

// Map tabs → human metadata for the Shell SectionHeader
const TAB_META={
  overview:  {eyebrow:"Today's Macro",        title:"Today's macro overview",  sub:"Three composites — Risk & Liquidity (3-mo), Growth (6-mo), Inflation & Rates (18-mo) — built from the indicators that empirically predict S&P drawdowns. Hover the trajectory chart for any date."},
  indicators:{eyebrow:"All Indicators",       title:"Calibrated indicators",sub:"Each indicator is normalized against its long-run mean and standard deviation. Filter by category."},
  sectors:   {eyebrow:"Sector Outlook",       title:"Sector heat map",         sub:"Each sector is scored from its subsector sensitivity to 8 macro factors."},
  portopps:  {eyebrow:"Trading Opportunities & Portfolio Insights", title:"Trading Opportunities & Portfolio Insights", sub:"Allocation, notable signals, positions, opportunities, and account-by-account detail."},
  scanner:   {eyebrow:"Trading Scanner",      title:"Daily opportunity scan",  sub:"Runs at 3:30 PM ET on weekdays. Buy alerts (60+), watch list (35+), covered-call setups."},
  readme:    {eyebrow:"FAQ & Methodology",    title:"How this works",          sub:"Sources, methodology, and the meaning of every score, regime, and signal."},
  admin:     {eyebrow:"Admin · API Usage",    title:"UW API usage",            sub:"Daily calls, quota remaining, peak RPM, and recent run history. Visible only to admins."},
  bugs:      {eyebrow:"Admin · Bug Tracker",  title:"Bug reports",             sub:"Institutional-grade triage: every bug, its status, proposed fix, complexity, and lifecycle stamps. Admin only."},
  lab:       {eyebrow:"Sector Lab · BETA",    title:"Sector Lab",              sub:"Experimental overlays on top of the sector engine — cycle-stage classifier, factor-debug panel, read-only ranking mirror. Admin only."},
};

// ─── Sidebar nav — single source of truth, references the TAB_IDS above ─────
// Order in the sidebar (macro → sectors → portfolio → scanner → docs). Home
// sits at the top as the tile-grid landing.
const NAV_ITEMS = [
  { id:"home",       label:"Home",                  icon:<NavIconHome/>   },
  { id:"overview",   label:"Macro Overview",        icon:<NavIconGauge/>  },
  { id:"indicators", label:"All Indicators",        icon:<NavIconGrid/>   },
  { id:"sectors",    label:"Sectors",               icon:<NavIconHeat/>   },
  { id:"portopps",   label:"Trading Opportunities & Portfolio Insights",  icon:<NavIconPie/>    },
  { id:"scanner",    label:"Trading Scanner",       icon:<NavIconRadar/>  },
  { id:"readme",     label:"Methodology",           icon:<NavIconBook/>   },
];

export default function App(){
// Kick off /indicator_history.json fetch on first mount and re-render the
// whole tree once it lands. Mutation of SD/AS_OF/IND[id][6..8] + composite
// recompute happens in _applyHistToGlobals (see REAL HISTORY LOADER above).
// Item 5b / 9 / 18 — PR #17 restore after PR #23 stealth regression.
useHistReady();
// Admin gating — drives the sidebar "Admin" nav item + the #admin tab.
// useIsAdmin() re-runs on sign-in/out; non-admins never see the tab and are
// redirected to home if they land on #admin via a stale link. Task #30.
const {isAdmin, loading:adminLoading}=useIsAdmin();
// Legacy redirect: "#portfolio" (old Holdings Detail tab) now lives inside
// Portfolio & Insights. Any bookmark pointing at #portfolio resolves to
// #portopps. Bug #1071 — alias four "natural" deep-link hashes that the
// router previously bounced silently to /#home: /#today-macro is the
// natural deep-link to the macro-overview composites tab; /#positions and
// /#watchlist are the two halves of /#portopps; /#asset-allocation is the
// in-development tab (lands on /#home until that page ships).
const HASH_ALIASES={
  "portfolio":"portopps",
  "today-macro":"overview",
  "positions":"portopps",
  "watchlist":"portopps",
  "asset-allocation":"home",
};
const resolveHash=(raw)=>{
  const h=(raw||"").slice(1).toLowerCase();
  if(HASH_ALIASES[h])return HASH_ALIASES[h];
  return TAB_IDS.includes(h)?h:"home";
};
const [tab,setTab]=useState(()=>{
if(typeof window==="undefined")return"home";
return resolveHash(window.location.hash);
});
// Bug #1071 — preserve the user-typed alias hash. If they typed /#positions
// (which resolves to the "portopps" tab), don't silently rewrite the URL bar
// back to /#portopps. Only sync when the URL doesn't already point at this tab.
useEffect(()=>{
  const cur=(window.location.hash||"").slice(1).toLowerCase();
  if(HASH_ALIASES[cur]===tab)return;
  if(cur===tab)return;
  window.location.hash=tab;
},[tab]);
useEffect(()=>{window.scrollTo({top:0,behavior:"smooth"});},[tab]);
// Keep tab in sync with URL hash so browser back/forward and manual hash edits work.
useEffect(()=>{
  const onHashChange=()=>{
    const next=resolveHash(window.location.hash);
    if(next!==tab)setTab(next);
  };
  window.addEventListener("hashchange",onHashChange);
  return()=>window.removeEventListener("hashchange",onHashChange);
},[tab]);
// Redirect #admin → #home if the resolved session isn't an admin. We wait
// for adminLoading to settle so the initial check doesn't bounce real admins
// off their own tab before the is_admin() RPC resolves.
useEffect(()=>{
  if(!adminLoading && !isAdmin && (tab==="admin" || tab==="bugs" || tab==="lab")) setTab("home");
},[tab,isAdmin,adminLoading]);

// ─── Navigation stack — so the drill-down back button returns to the
//     previous tab (e.g. Overview → Indicators → Back → Overview) rather
//     than always jumping to Home. ────────────────────────────────────
const [tabHistory,setTabHistory]=useState([]);
const navTo=(next)=>{
  if(next===tab)return;
  setTabHistory(h=>[...h,tab]);
  setTab(next);
};
// Navigate to the Scanner tab and focus on a specific ticker's RichCard.
// Scanner reads `focusTicker` on mount/change and scrolls + highlights.
const navToScannerFor=(ticker)=>{
  setScannerFocusTicker(ticker);
  if(tab!=="scanner"){setTabHistory(h=>[...h,tab]);setTab("scanner");}
};
const goBack=()=>{
  setTabHistory(h=>{
    if(h.length===0){setTab("home");return h;}
    setTab(h[h.length-1]);
    return h.slice(0,-1);
  });
};
const backLabel=(()=>{
  const prev=tabHistory[tabHistory.length-1];
  if(!prev||prev==="home")return"All sections";
  return TAB_META[prev]?.eyebrow||"Back";
})();
const {pref,setPref}=useTheme();
const [catFilter,setCatFilter]=useState(null);
const [expandedId,setExpandedId]=useState(null);
// (expandedActionKey removed 2026-04-19: position cards now open the
// TickerDetailModal directly instead of inline-expanding. See oppCard +
// heldPositions render below.)
const [scannerFocusTicker,setScannerFocusTicker]=useState(null);
const [tickerDetail,setTickerDetail]=useState(null);
// rawScanData is the public artifact straight from the CDN (no user data).
// `scanData` (below) is the merged version — per-user watchlist rows from
// Supabase (user_scan_data) are layered in so AMAT/CRWD/CAT/KTOS etc. carry
// technicals/screener/analyst data for the SubCompositeStrip on portopps
// and the TickerDetailModal. Scanner.jsx does the same thing.
const [rawScanData,setScanData]=useState(null);
const [scanError,setScanError]=useState(false);
const { mergeInto: mergePrivateScan, refetch: refetchSupplement }=usePrivateScanSupplement();
// 3x-weekday universe snapshot overlay. Fresh prices / IV / options flow /
// marketcap / earnings calendar for every equity ≥ $1B mcap at 10:00, 13:00,
// and 15:45 ET. Field-level overlay — only non-null universe values win, so
// the public JSON + user_scan_data keep supplying technicals/analyst/news.
const { mergeInto: mergeUniverseSnapshot, snapshotTs: universeSnapshotTs }=useUniverseSnapshot();
// 3x-weekday ticker-event overlay (news / insider / congress / darkpool).
// Writes scanData.signals.events[T] = {news, insider, congress, darkpool}.
// Additive — no existing fields are overwritten, so downstream renderers
// that don't read .events keep working unchanged.
const { mergeInto: mergeTickerEvents, latestEventTs: tickerEventsTs }=useTickerEvents();
// Editorial commentary (home Macro + Sector tiles). Nightly-generated;
// null-allowed. See supabase/functions/generate-commentary.
const { macro: macroCommentary, sector: sectorCommentary }=useCommentary();
// Merge order: rawScanData → universe snapshot (3x/day) → private supplement
// (1x/day per-user) → ticker events (3x/day). Universe runs first so private
// supplement only fills gaps the universe snapshot couldn't cover
// (technicals_json, analyst_ratings, news, dividend_yield, has_dividend,
// tags). Ticker events are purely additive under signals.events.
const scanData=useMemo(
  ()=>{
    if(!rawScanData)return rawScanData;
    let x=mergeUniverseSnapshot(rawScanData);
    x=mergePrivateScan(x);
    x=mergeTickerEvents(x);
    return x;
  },
  [rawScanData,mergeUniverseSnapshot,mergePrivateScan,mergeTickerEvents]
);
// Per-ticker scan-on-add: when a user adds a name to their watchlist, fire
// /api/scan-ticker in the background. Server pulls news/info/analyst/screener
// from UW (or copies a warm row written by another user < 1h ago), upserts
// to user_scan_data under the signed-in user, and we refetch so the modal
// flips from "Scanning…" to real data without a page reload. Technicals
// stay pending until the next scheduled scan — see api/scan-ticker.js.
const [scanningTickers,setScanningTickers]=useState(()=>new Set());
const scanTicker=useCallback(async(ticker)=>{
  const t=String(ticker||"").toUpperCase();
  if(!t)return;
  setScanningTickers(s=>{const n=new Set(s);n.add(t);return n;});
  try{
    const {data:{session:sess}}=await supabase.auth.getSession();
    const token=sess?.access_token;
    if(!token)return;
    const r=await fetch("/api/scan-ticker",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({ticker:t}),
    });
    if(!r.ok){
      // eslint-disable-next-line no-console
      console.warn(`[scan-ticker] ${t} → ${r.status}`);
      return;
    }
    await refetchSupplement?.();
  }catch(e){
    // eslint-disable-next-line no-console
    console.warn("[scan-ticker] failed:",e);
  }finally{
    setScanningTickers(s=>{const n=new Set(s);n.delete(t);return n;});
  }
},[refetchSupplement]);
// Account-by-account breakdown on the Portfolio & Insights tab. Default
// collapsed — power users expand when they want the deeper per-account view
// (this replaces the separate Holdings Detail tab).
const [acctBreakdownOpen,setAcctBreakdownOpen]=useState(false);
// Sidebar drawer state — only visible on mobile; desktop sidebar is persistent.
const [sidebarOpen,setSidebarOpen]=useState(false);
// Session-scoped portfolio — returns empty arrays when unauthenticated so the
// tiles render a zero-state rather than leaking someone else's data.
const {session}=useSession();
const {accounts:ACCOUNTS, watchlist:userWatchlistRows, refetch:refetchPortfolio}=useUserPortfolio();
const portfolioAuthed=!!session;
// Inline sign-in toggle for the portopps zero-state. Clicking the CTA in the
// banner swaps the skeleton for the LoginScreen; successful sign-in flips
// `portfolioAuthed` and the user sees their real portfolio.
const [showPortoppsLogin,setShowPortoppsLogin]=useState(false);
// ── Portfolio editor state ──────────────────────────────────────────────
// `positionEditor` === null when closed. When open, holds a shape that tells
// the PositionEditor modal whether to render in add or edit mode.
//   { mode: "add" }                        → add to the first account by default
//   { mode: "edit", existing: rawRow }     → prefill all fields from rawRow
// `showBulkImport` toggles the BulkImport modal.
const [positionEditor,setPositionEditor]=useState(null);
const [showBulkImport,setShowBulkImport]=useState(false);
// Rescan-all-positions utility. Fans POST /api/scan-ticker over every
// unique non-CASH ticker in the portfolio with a concurrency-5 pool.
// Lets users converge stale name/sector/beta without per-row edit+save.
const [rescanState,setRescanState]=useState({active:false,done:0,total:0});
const handleRescanAllPositions=async(positions)=>{
  if(rescanState.active)return;
  const tickers=Array.from(new Set((positions||[])
    .map(p=>String(p?.ticker||"").trim().toUpperCase())
    .filter(t=>t&&t.length<=10&&t!=="CASH")));
  if(tickers.length===0)return;
  const {data:sessData}=await supabase.auth.getSession();
  const token=sessData?.session?.access_token;
  if(!token)return;
  setRescanState({active:true,done:0,total:tickers.length});
  const queue=[...tickers];
  let done=0;
  const worker=async()=>{
    while(queue.length){
      const t=queue.shift();
      if(!t)break;
      try{
        await fetch("/api/scan-ticker",{
          method:"POST",
          headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
          body:JSON.stringify({ticker:t}),
        });
      }catch(e){/* best-effort */}
      done+=1;
      setRescanState(s=>({...s,done}));
    }
  };
  const POOL=5;
  await Promise.allSettled(Array.from({length:Math.min(POOL,tickers.length)},worker));
  await refetchPortfolio?.();
  setRescanState({active:false,done:0,total:0});
};
// Inline delete from the PositionsTable row goes through this. We use the
// browser's native confirm dialog rather than building another modal — it's
// immediate, works on mobile, and users already expect it for destructive
// actions. Deeper editing + a confirm-in-modal delete live in the editor.
const deletePositionInline=async(rawRow)=>{
  if(!rawRow?.id)return;
  if(!window.confirm(`Delete ${rawRow.ticker} from ${rawRow.acctLabel}? This cannot be undone.`))return;
  const {error}=await supabase.from("positions").delete().eq("id",rawRow.id);
  if(error){
    console.error("[App] inline delete failed:",error);
    window.alert(`Could not delete: ${error.message||"unknown error"}`);
    return;
  }
  await refetchPortfolio?.();
};
// If Supabase bounced the user back here with an auth error in the URL
// (e.g. expired magic link → ?error=access_denied&error_code=otp_expired),
// jump the user straight to the portopps LoginScreen so they (a) see the
// error banner and (b) have a path to request a new link. Without this the
// error params sit on the home tab and the user just sees the public zero-state.
useEffect(()=>{
  if(typeof window==="undefined")return;
  const qs=new URLSearchParams(window.location.search);
  const hs=new URLSearchParams((window.location.hash||"").replace(/^#/,""));
  if(qs.get("error")||hs.get("error")){
    setTab("portopps");
    setShowPortoppsLogin(true);
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
},[]);
// Header Sign-in button dispatches macrotilt:open-login to skip the portopps
// zero-state preview and drop the user directly on the 6-digit code LoginScreen.
// Without this, the header CTA would require two clicks (header → inline "Sign in"
// button in the portopps preview banner) before the login form appears.
useEffect(()=>{
  if(typeof window==="undefined")return;
  const handler=()=>{
    setTab("portopps");
    setShowPortoppsLogin(true);
  };
  window.addEventListener("macrotilt:open-login",handler);
  return()=>window.removeEventListener("macrotilt:open-login",handler);
},[]);
// Close drawer automatically whenever the active tab changes (in case the user
// navigated via a non-sidebar control while the drawer was open).
useEffect(()=>{setSidebarOpen(false);},[tab]);
useEffect(()=>{
  let cancelled=false;
  fetch("https://raw.githubusercontent.com/jmezzadri/market-dashboard/main/public/latest_scan_data.json?t="+Date.now())
    .then(r=>{
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(d=>{if(!cancelled)setScanData(d);})
    .catch(err=>{
      if(cancelled)return;
      console.warn("scan data fetch failed:",err);
      setScanError(true);
    });
  return()=>{cancelled=true;};
},[]);

const visibleIds=Object.keys(IND).filter(id=>{
if(catFilter)return IND[id][2]===catFilter;
return true;
});

// If the expanded modal's indicator is no longer visible (e.g. user
// changed category filter while a modal was still open, or clicked
// a category row that sets a filter), close the modal so we don't
// leave a floating sheet whose prev/next arrows are broken.
useEffect(()=>{
  if(expandedId&&!visibleIds.includes(expandedId))setExpandedId(null);
// eslint-disable-next-line react-hooks/exhaustive-deps
},[catFilter]);

const grandTotal=ACCOUNTS.reduce((a,acc)=>a+acc.positions.reduce((b,p)=>b+(p.value||0),0),0);
// Weighted β — skip the weighting when there's nothing to weight (unauth zero-state).
const portBeta=grandTotal>0
  ?ACCOUNTS.flatMap(acc=>acc.positions).reduce((a,p)=>a+((p.value||0)/grandTotal)*(p.beta||0),0)
  :0;
// Asset-class taxonomy: prefer sector match for fixed income / intl / cash;
// then ticker match for the few special-cased ETFs (metals, crypto, broad
// index funds); everything else falls through to "Individual Stocks".
const assetRollup={};
ACCOUNTS.flatMap(acc=>acc.positions).forEach(p=>{
// Balance-sheet split: negative-value positions (margin debits, shorts)
// are liabilities, not asset classes. Bucketing them separately keeps
// Cash reading as a true asset ($2,267 from brokerage + HSA is long
// cash) and surfaces the debt as its own legend row, so gross = total
// assets, net = gross − debt, and gross − net = exactly the debt.
if((p.value||0)<0){
  assetRollup["Margin Debt"]=(assetRollup["Margin Debt"]||0)+p.value;
  return;
}
const cls=
  p.sector==="Cash"?"Cash":
  p.sector==="HY Bonds"?"HY Bonds":
  p.sector==="Intl Equity"?"Intl Equity":
  ["GLD","SLV"].includes(p.ticker)?"Precious Metals":
  ["FBTC","ETHE"].includes(p.ticker)?"Crypto":
  ["FXAIX","FSKAX","FZILX","FSGGX","FXNAX","FXIIX"].includes(p.ticker)?"Index Funds":
  "Individual Stocks";
assetRollup[cls]=(assetRollup[cls]||0)+p.value;
});
const rollupColors={"Index Funds":"#4a6fa5","Intl Equity":"#6366f1","Individual Stocks":"#ff9f0a","HY Bonds":"#14b8a6","Precious Metals":"#B8860B","Crypto":"#a855f7","Cash":"var(--text-dim)","Margin Debt":"#dc2626"};

// ── Tile-grid home view computations ─────────────────────────────────────────
const portCount = scanData?.portfolio_positions?.length || 0;
// Watchlist: user's watchlist rows from Supabase are the source of truth when
// signed in (they're seeded from WATCHLIST_FALLBACK + CRYPTO_WATCH at onboarding
// and the user can edit them). Pre-auth, WATCHLIST is empty to avoid leaking
// anyone else's list.
const WATCHLIST = portfolioAuthed ? userWatchlistRows : [];

// ── Client-side rebucket: BUY / NEAR / OTHER using the SAME JS composite that
// the OVR column displays (sectionComposites.js). We used to trust the scanner's
// server-side Python buckets, which had drifted out of sync with the JS engine
// — the OVR column would show +78 on a ticker parked in "Near Trigger" because
// the Python port lagged the JS canonical scorer. Single source of truth now:
// both the bucket assignment and the OVR cell come from computeSectionComposites.
// Universe = scanner-surfaced buy/watch (market-wide discoveries) ∪ user's
// personal WATCHLIST, so nothing on screen can fall into the wrong tile.
const _ovrOf = (t) => {
  if (!t || !scanData?.signals) return null;
  const c = computeSectionComposites(t, scanData);
  return c?.overall?.score ?? null;
};
const _unionTickers = (() => {
  const s = new Set();
  (scanData?.buy_opportunities || []).forEach(o => o?.ticker && s.add(String(o.ticker).toUpperCase()));
  (scanData?.watch_items       || []).forEach(o => o?.ticker && s.add(String(o.ticker).toUpperCase()));
  (WATCHLIST || []).forEach(r => r?.ticker && s.add(String(r.ticker).toUpperCase()));
  return [...s];
})();
const _buyBucket = [];
const _nearBucket = [];
_unionTickers.forEach(t => {
  const ovr = _ovrOf(t);
  if (ovr == null) return;
  if (ovr >= 60) _buyBucket.push({ ticker: t, ovr });
  else if (ovr >= 40) _nearBucket.push({ ticker: t, ovr });
});
_buyBucket.sort((a, b) => b.ovr - a.ovr);
_nearBucket.sort((a, b) => b.ovr - a.ovr);
const rebucketBuyTickers = new Set(_buyBucket.map(x => x.ticker));
const rebucketNearTickers = new Set(_nearBucket.map(x => x.ticker));
const rebucketBuy = _buyBucket;     // [{ticker, ovr}] — for tile rows
const rebucketNear = _nearBucket;   // [{ticker, ovr}]
// OTHER = user's watchlist rows NOT promoted into Buy or Near by OVR.
const rebucketOther = (WATCHLIST || []).filter(r => {
  const t = String(r?.ticker || "").toUpperCase();
  return !rebucketBuyTickers.has(t) && !rebucketNearTickers.has(t);
});

const buyCount = rebucketBuy.length;
const watchCount = rebucketNear.length;
const lastScanLabel = scanData?.date_label || "—";
const compactNarrative = `Composite ${COMP100}/100 · ${TREND_SIG.label}`;

// Category quick-scores for the Indicators tile
const catScores = Object.entries(CATS).map(([catId,cat])=>{
  const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
  const scored=ids.map(id=>sdScore(id,IND[id][6])).filter(x=>x!=null);
  const avg=scored.length?scored.reduce((a,b)=>a+b,0)/scored.length:0;
  return {id:catId, label:cat.label, sc100:Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100))), col:sdColor(avg)};
});

// Admin-only nav item appended at runtime. Non-admins never see it. We use
// the existing NavIconGauge since the sidebar doesn't expose a distinct
// shield glyph; icon semantics here are "instrument panel", which fits.
const navItems = isAdmin
  ? [...NAV_ITEMS,
     { id:"admin", label:"Admin · Usage",     icon:<NavIconGauge/> },
     { id:"bugs",  label:"Admin · Bugs",      icon:<NavIconGrid/>  },
     { id:"lab",   label:"Sector Lab · BETA", icon:<NavIconHeat/>  }]
  : NAV_ITEMS;

return(
<div style={{minHeight:"100vh",color:"var(--text)",fontFamily:"var(--font-ui)"}}>

<Sidebar
  items={navItems}
  activeId={tab}
  onSelect={navTo}
  open={sidebarOpen}
  onClose={()=>setSidebarOpen(false)}
  footer={<SidebarAuth/>}
/>

<div className="app-main">

<Hero
  pref={pref}
  setPref={setPref}
  regime={{label:CONV.label, color:CONV.color}}
  score={COMP100}
  narrativeOneLine={compactNarrative}
  compact={true}
  menuButton={<SidebarToggleButton onClick={()=>setSidebarOpen(true)}/>}
/>

{/* ─────── HOME — EDITORIAL LAYOUT ──────────────────────────────────────
    Phase 3 home redesign — numbered eyebrows, flat cards, Fraunces display
    headlines, JetBrains-Mono numerics. No gradient card tops, no
    auto-fit tile grid. Rhythm: page head → 2-col (Macro | Opps) →
    3-col (Sectors | Scan | Methodology) → full-width Headlines.
    Mockup source: design-lab/home-current.html (locked 2026-04-23).
    ───────────────────────────────────────────────────────────────────── */}
{tab==="home" && (()=>{

  // ---- Headline copy, driven by CONVICTION band ----
  const HEADLINE_BY_CONV = {
    LOW:      {h:"Benign regime,",     em:" lean cyclical beta."},
    NORMAL:   {h:"Constructive,",      em:" with one finger on the brake."},
    ELEVATED: {h:"Defensive tilt,",    em:" active hedging warranted."},
    EXTREME:  {h:"Crisis regime.",     em:" Maximum defensiveness."},
  };
  const LEDE_BY_CONV = {
    LOW:      `Composite stress at ${COMP100}/100 — historically quiet. Bottom 60% of the distribution; room to add cyclical exposure. Watch for complacency: the signal can turn fast.`,
    NORMAL:   `Composite stress at ${COMP100}/100 — market baseline, mid-range on the historical distribution. Keep diversified exposure; trim the highest-beta names on spikes.`,
    ELEVATED: `Composite stress at ${COMP100}/100 — top 12.5% of the historical distribution. Sell covered calls, rotate defensive, reduce leverage. 2022 bear and SVB landed in this band.`,
    EXTREME:  `Composite stress at ${COMP100}/100 — top 2.5% of the historical distribution. Harvest losses, hold dry powder. Only GFC (2008) and COVID (2020) peaks registered higher.`,
  };
  const STATE_BY_CONV = {
    LOW:      "Benign · accommodative",
    NORMAL:   "Constructive, watchful",
    ELEVATED: "Defensive · hedge actively",
    EXTREME:  "Crisis · max caution",
  };
  const headline = HEADLINE_BY_CONV[CONV.label] || HEADLINE_BY_CONV.NORMAL;
  const ledeBase = LEDE_BY_CONV[CONV.label] || LEDE_BY_CONV.NORMAL;
  const stateLine = STATE_BY_CONV[CONV.label] || STATE_BY_CONV.NORMAL;
  const scannerPhrase = (buyCount>0||watchCount>0)
    ? ` ${buyCount} buy alert${buyCount===1?"":"s"} on the watchlist, ${watchCount} near trigger.`
    : " No buy alerts or near-trigger names on the watchlist today.";
  const lede = ledeBase + scannerPhrase;

  // ---- Regime pill styling per category state (sdLabel value) ----
  const regimePillCSS = (regime) => {
    // sdLabel → mockup stance mapping
    const map = {
      "Low":      {label:"Risk-on",  color:"var(--up, #30d158)"},
      "Normal":   {label:"Neutral",  color:"var(--text-muted)"},
      "Elevated": {label:"Caution",  color:"var(--warn, #B8860B)"},
      "Extreme":  {label:"Risk-off", color:"var(--down, #ff453a)"},
      "No Data":  {label:"—",        color:"var(--text-dim)"},
    };
    return map[regime] || map["Normal"];
  };

  // ---- Sector outlook list — 3 highest + 3 lowest (Joe feedback 2026-04-23).
  // Ranked by raw score (not distance from neutral). Top half renders as
  // the strongest overweights; bottom half as the strongest underweights,
  // with a visual divider between them. Plain English everywhere — no
  // "OVR" acronym, say "overall rank".
  const sectorsWithScore = SECTORS.map(s => {
    const score = computeSectorScore(s);
    return {...s, score, outlook:outlookLabel(score)};
  });
  const _sectorsRanked = [...sectorsWithScore].sort((a,b) => b.score - a.score);
  // Annotate each row with its absolute rank (#1 = highest score) so the
  // tile can show "#1" / "#10" style badges next to names.
  _sectorsRanked.forEach((s,i) => { s.rank = i+1; });
  const _topN = Math.min(3, _sectorsRanked.length);
  const _bottomN = Math.min(3, _sectorsRanked.length - _topN);
  const topOverweight  = _sectorsRanked.slice(0, _topN);
  const bottomUnderweight = _sectorsRanked.slice(-_bottomN);   // worst-first order: already lowest → highest. Reverse so the lowest sits at the bottom (most-underweight last).
  bottomUnderweight.sort((a,b) => b.score - a.score);          // highest of the bottom-3 first, then down to lowest.

  // ---- Headlines (multi-source, 2026-04-23) ----
  // Scanner now aggregates ZH + CNBC + Bloomberg + Reuters + FT + WSJ
  // into signals.market_news.items (deduped, newest-first). Older
  // cached bundles still emit only `zerohedge_public` — fall back to
  // that so the tile doesn't go blank on stale data.
  const _mnBlock     = scanData?.signals?.market_news || {};
  const _mnAvailable = Array.isArray(_mnBlock.items) && _mnBlock.items.length > 0
    ? _mnBlock.items
    : (_mnBlock.zerohedge_public || []);
  // Per-source cap of 2 across the 7 Home slots. Prevents ZH (which
  // posts ~25x/day) from swamping the feed on quiet news days while
  // preserving strict chronological order within the available pool.
  const _HEADLINE_SLOTS     = 7;
  const _HEADLINE_SOURCE_CAP = 2;
  const _mnSourceCounts = Object.create(null);
  const headlines = [];
  for (const it of _mnAvailable) {
    const src = it?.source || "ZeroHedge";
    if ((_mnSourceCounts[src] || 0) >= _HEADLINE_SOURCE_CAP) continue;
    headlines.push(it);
    _mnSourceCounts[src] = (_mnSourceCounts[src] || 0) + 1;
    if (headlines.length >= _HEADLINE_SLOTS) break;
  }
  // Keep `zhPub` defined as a shim because the count-badge below still
  // reads it in older-site-cached JS. Point it at the aggregated pool.
  const zhPub = _mnAvailable;
  const fmtHeadlineTime = (iso) => {
    if (!iso) return "";
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return "";
    const today = new Date();
    const sameDay = dt.toDateString() === today.toDateString();
    return sameDay
      ? dt.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false})
      : dt.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  };

  // ---- Shared inline style objects ----
  const cardStyle = {
    background:"var(--surface)",
    border:"1px solid var(--border-faint)",
    borderRadius:8,
    padding:"var(--space-5)",
    display:"flex", flexDirection:"column",
  };
  const cardHeadStyle = {
    display:"flex", alignItems:"baseline", justifyContent:"space-between",
    paddingBottom:"var(--space-3)",
    marginBottom:"var(--space-4)",
    borderBottom:"1px solid var(--border-faint)",
    gap:12,
  };
  const cardH2Style = {
    fontFamily:"var(--font-display)", fontWeight:400, fontSize:20,
    color:"var(--text)", letterSpacing:"-0.005em", margin:0, lineHeight:1.2,
  };
  const cardTagStyle = {
    fontFamily:"var(--font-mono)", fontSize:10,
    color:"var(--accent)", letterSpacing:"0.14em",
    marginRight:"var(--space-2)", fontWeight:500,
  };
  const cardLinkStyle = {
    fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-muted)",
    letterSpacing:"0.1em", textTransform:"uppercase", textDecoration:"none",
    cursor:"pointer", whiteSpace:"nowrap",
  };

  return (
  <main className="fade-in main-padded mt-home" style={{
    maxWidth:1360, margin:"0 auto",
    padding:"var(--space-4) var(--space-8) var(--space-10)",
    display:"flex", flexDirection:"column", gap:"var(--space-6)",
  }}>

    {/* ─── PAGE HEAD ─── */}
    <div style={{padding:"var(--space-3) 0 var(--space-5)"}}>
      <div style={{
        fontFamily:"var(--font-mono)", fontSize:11,
        color:"var(--accent)", letterSpacing:"0.18em", textTransform:"uppercase",
        marginBottom:"var(--space-3)",
        display:"flex", alignItems:"center", gap:"var(--space-2)",
      }}>
        <span style={{width:20, height:1, background:"var(--accent)", opacity:0.6, display:"inline-block"}}/>
        MacroTilt Daily · Home
      </div>
      <h1 style={{
        fontFamily:"var(--font-display)", fontWeight:400,
        fontSize:"clamp(32px, 4.2vw, 44px)",
        lineHeight:1.1, letterSpacing:"-0.01em",
        color:"var(--text)", margin:0, marginBottom:"var(--space-3)",
      }}>
        {headline.h}<em style={{fontStyle:"italic", color:"var(--accent)"}}>{headline.em}</em>
      </h1>
      <p style={{
        fontSize:15, color:"var(--text-muted)", lineHeight:1.55,
        maxWidth:"72ch", margin:0,
      }}>{lede}</p>
    </div>

    {/* ─── 2x2 TILE GRID: Macro Overview (01) · Trading Opps (02) ·
         Sector Outlook (03) · Daily Opp Scan (04). News lives full-
         width below. Methodology tile removed 2026-04-23 — already in
         the footer. (Joe feedback.) */}
    <section className="mt-top-grid" style={{
      display:"grid", gridTemplateColumns:"1fr 1fr", gap:"var(--space-5)",
      alignItems:"stretch",
    }}>

      {/* 01 · Macro Overview */}
      <div style={cardStyle}>
        <div style={cardHeadStyle}>
          <h2 style={cardH2Style}><span style={cardTagStyle}>01</span>Macro Overview <FreshnessDot indicatorId="composite_rl" asOfIso={AS_OF_ISO.vix||AS_OF_ISO.move||null} cadence="D" style={{marginLeft:8}}/></h2>
          <a style={cardLinkStyle} onClick={()=>navTo("overview")}>All indicators →</a>
        </div>

        {/* Composite strip */}
        <div style={{
          display:"flex", alignItems:"center", gap:"var(--space-5)",
          padding:"var(--space-4)", background:"var(--surface-3)",
          border:"1px solid var(--border-faint)", borderRadius:6,
          marginBottom:"var(--space-4)", flexWrap:"wrap",
        }}>
          <div className="num" style={{
            fontFamily:"var(--font-display)", fontWeight:400,
            fontSize:48, lineHeight:1, color:CONV.color,
            fontVariantNumeric:"tabular-nums",
          }}>{COMP100}</div>
          <div style={{display:"flex", flexDirection:"column", gap:4, minWidth:0}}>
            <div style={{
              fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)",
              letterSpacing:"0.12em", textTransform:"uppercase",
            }}>Composite · of 100</div>
            <div style={{
              fontFamily:"var(--font-display)", fontSize:16, fontStyle:"italic",
              color:"var(--text)", lineHeight:1.25,
            }}>{stateLine}</div>
          </div>
          <div style={{
            marginLeft:"auto",
            fontFamily:"var(--font-mono)", fontSize:11,
            color:"var(--text-muted)", letterSpacing:"0.04em", textAlign:"right",
            display:"flex", alignItems:"center", gap:"var(--space-2)", flexWrap:"wrap",
            justifyContent:"flex-end",
          }}>
            <span style={{color:TREND_SIG.col}}>{TREND_SIG.arrow} {TREND_SIG.label}</span>
            <span style={{
              display:"inline-block", padding:"2px 8px", borderRadius:10,
              border:`1px solid ${CONV.color}`, color:CONV.color,
              fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase",
            }}>{CONV.label}</span>
          </div>
        </div>

        {/* Regime table — Category · 12M · 6M · 1M · Now · State */}
        <div style={{overflowX:"auto"}}>
        <RegimeCategoryTable rows={buildCategoryOverview()} regimePillCSS={regimePillCSS} navTo={navTo} setCatFilter={setCatFilter}/>
        </div>

        {/* Editorial commentary — threshold-gated; renders nothing when
            nothing has moved materially. Fed by the commentary engine
            (supabase/functions/generate-commentary → macro_commentary).
            Each slot is capped at ~25 words to discourage filler. */}
        {(macroCommentary && (macroCommentary.short_term || macroCommentary.medium_term)) && (
          <div style={{
            marginTop:"var(--space-4)",
            paddingTop:"var(--space-3)",
            borderTop:"1px solid var(--border-faint)",
            display:"flex", flexDirection:"column", gap:"var(--space-2)",
          }}>
            {macroCommentary.short_term && (
              <div style={{
                fontFamily:"var(--font-display)", fontStyle:"italic",
                fontSize:14, lineHeight:1.5, color:"var(--text-muted)",
              }}>
                <span style={{
                  fontFamily:"var(--font-mono)", fontStyle:"normal", fontSize:9,
                  letterSpacing:"0.14em", textTransform:"uppercase",
                  color:"var(--text-dim)", marginRight:"var(--space-2)",
                }}>Short term</span>
                {macroCommentary.short_term}
              </div>
            )}
            {macroCommentary.medium_term && (
              <div style={{
                fontFamily:"var(--font-display)", fontStyle:"italic",
                fontSize:14, lineHeight:1.5, color:"var(--text-muted)",
              }}>
                <span style={{
                  fontFamily:"var(--font-mono)", fontStyle:"normal", fontSize:9,
                  letterSpacing:"0.14em", textTransform:"uppercase",
                  color:"var(--text-dim)", marginRight:"var(--space-2)",
                }}>Medium term</span>
                {macroCommentary.medium_term}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 02 · Trading Opportunities & Portfolio Insights — data-first,
          no narrative running list. Each tile carries its own data point:
          count / delta / top name + score. See Joe feedback 2026-04-23. */}
      {(()=>{
        const positionCount = ACCOUNTS.reduce((a,acc)=>a+acc.positions.filter(p=>p.sector!=="Cash").length,0);
        const buyTop  = rebucketBuy[0]  || null;
        const nearTop = rebucketNear[0] || null;
        // Day-of-session P&L: Σ (close - prev_close) × quantity, for every
        // non-Cash position. Reads from scanData.signals.screener (refreshed
        // intraday 3x via universe_snapshots). Percent uses prior-day total
        // as denominator so the number reads as "today's move against
        // yesterday's close," not "dollar change / current AUM".
        const _screenerMap = scanData?.signals?.screener || {};
        let _dayPnl = 0, _priorEq = 0;
        ACCOUNTS.flatMap(a => a.positions).forEach(p => {
          if (p.sector === "Cash") return;
          const sc = _screenerMap[p.ticker] || {};
          const close = Number(sc.close || sc.prev_close || p.price || 0);
          const prev  = Number(sc.prev_close || 0);
          if (!close || !prev || !p.quantity) return;
          _dayPnl  += (close - prev) * p.quantity;
          _priorEq += prev * p.quantity;
        });
        const dayPnl$ = _dayPnl;
        const dayPnlPct = _priorEq > 0 ? (_dayPnl / _priorEq) * 100 : 0;
        const hasDayPnl = Math.abs(_priorEq) > 1;  // pre-market or empty book → hide
        // Benchmark — S&P 500 (SPY ETF) day %. Pulled from the universe
        // snapshot overlay (merged into scanData.signals.screener by
        // useUniverseSnapshot). When SPY isn't in the snapshot (weekend /
        // empty state), benchmarkPct is null and the vs-SPY line hides.
        const _spy = _screenerMap["SPY"] || {};
        const _spyClose = Number(_spy.close || 0);
        const _spyPrev  = Number(_spy.prev_close || 0);
        const benchmarkPct = (_spyClose && _spyPrev) ? ((_spyClose - _spyPrev) / _spyPrev) * 100 : null;
        const outperfBps = (hasDayPnl && benchmarkPct != null)
          ? Math.round((dayPnlPct - benchmarkPct) * 100)
          : null;
        // Deployable cash: sum of Cash-sector positions in tactical accounts.
        const totalDeployable = ACCOUNTS
          .filter(a => a.tactical)
          .flatMap(a => a.positions)
          .filter(p => p.sector === "Cash")
          .reduce((s, p) => s + (p.value || 0), 0);
        // Largest non-cash position as % of total book — concentration flag.
        const _positionsSorted = ACCOUNTS
          .flatMap(a => a.positions)
          .filter(p => p.sector !== "Cash" && (p.value || 0) > 0)
          .sort((a, b) => (b.value || 0) - (a.value || 0));
        const largestPos = _positionsSorted[0] || null;
        const largestPct = (largestPos && grandTotal > 0) ? (largestPos.value / grandTotal) * 100 : 0;
        const _fmt$K = (n) => {
          const a = Math.abs(n);
          if (a >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
          if (a >= 1_000)     return `${Math.round(n/1_000)}K`;
          return `${Math.round(n)}`;
        };
        // Local-storage delta for portfolio beta: we log today's value on
        // each visit and compare against the oldest entry within the last
        // 14 days (targeting "~last week" direction of travel). Falls back
        // to null when no prior sample is available — tile renders delta
        // only if we actually have a comparable value.
        const betaDelta = (()=>{
          if(typeof window==="undefined"||!window.localStorage)return null;
          try{
            const key="mt_beta_history_v1";
            const now=Date.now();
            const raw=window.localStorage.getItem(key);
            const arr=raw?JSON.parse(raw):[];
            const clean=Array.isArray(arr)
              ?arr.filter(e=>e&&typeof e.t==="number"&&typeof e.v==="number"&&(now-e.t)<30*24*3600*1000)
              :[];
            const todayKey=new Date(now).toISOString().slice(0,10);
            const hasToday=clean.some(e=>new Date(e.t).toISOString().slice(0,10)===todayKey);
            if(!hasToday&&portBeta>0){
              clean.push({t:now, v:+portBeta.toFixed(4)});
              window.localStorage.setItem(key, JSON.stringify(clean.slice(-30)));
            }
            // Oldest sample ≥5d and ≤14d old.
            const lower=now-14*24*3600*1000, upper=now-5*24*3600*1000;
            const cand=clean.filter(e=>e.t>=lower&&e.t<=upper);
            if(!cand.length)return null;
            const prior=cand.sort((a,b)=>a.t-b.t)[0];
            if(!prior||typeof prior.v!=="number"||!Number.isFinite(prior.v))return null;
            const diff=+(portBeta-prior.v).toFixed(2);
            if(Math.abs(diff)<0.005)return null;
            return {diff, priorVal:prior.v.toFixed(2)};
          }catch{return null;}
        })();
        const tileStyle = {
          padding:"var(--space-4)", background:"var(--surface-3)",
          border:"1px solid var(--border-faint)", borderRadius:6,
        };
        const tileEyebrow = {
          fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)",
          letterSpacing:"0.14em", textTransform:"uppercase",
          marginBottom:"var(--space-3)",
        };
        const tileBig = (col)=>({
          fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums",
          fontSize:32, fontWeight:500, color:col, letterSpacing:"-0.01em", lineHeight:1,
        });
        const tileSub = {marginTop:"var(--space-2)", fontSize:11, color:"var(--text-muted)"};
        return (
        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <h2 style={cardH2Style}>
              <span style={cardTagStyle}>02</span>Trading Opportunities &amp; Portfolio Insights
            </h2>
            <a style={cardLinkStyle} onClick={()=>navTo("portopps")}>Open →</a>
          </div>

          <div style={{
            display:"grid", gridTemplateColumns:"1fr 1fr",
            gap:"var(--space-4)", padding:"var(--space-3) 0",
          }}>
            {/* Current Positions */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Current Positions</div>
              <div className="num" style={tileBig("var(--text)")}>{positionCount}</div>
              <div style={tileSub}>across {ACCOUNTS.length} account{ACCOUNTS.length===1?"":"s"} · ${Math.round(grandTotal/1000)}K</div>
            </div>

            {/* Portfolio Beta — embedded metric with week-over-week delta
                when we have a comparable prior sample. Defensive / elevated
                color thresholds mirror the Observations rules. */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Portfolio Beta</div>
              <div className="num" style={tileBig(
                portBeta>1.3 ? "var(--orange-text)"
                : portBeta<0.6 ? "var(--yellow-text)"
                : "var(--text)"
              )}>{portBeta.toFixed(2)}</div>
              <div style={tileSub}>
                {betaDelta
                  ? <>{betaDelta.diff>0?"up":"down"} from <span style={{fontFamily:"var(--font-mono)", color:"var(--text-muted)"}}>{betaDelta.priorVal}</span> last week</>
                  : <>1.0 = market · weighted by position $</>}
              </div>
            </div>

            {/* Buy Alerts — score embedded next to the top ticker */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Buy Alerts</div>
              <div className="num" style={tileBig(buyCount>0?"var(--accent)":"var(--text-muted)")}>{buyCount}</div>
              <div style={tileSub}>
                {buyTop
                  ? <><span style={{color:"var(--text)", fontWeight:500}}>{buyTop.ticker}</span>
                      {" "}<span style={{fontFamily:"var(--font-mono)", color:"var(--text)"}}>{buyTop.ovr}</span>
                      <span style={{color:"var(--text-dim)"}}> · top score</span></>
                  : <>none today</>}
              </div>
            </div>

            {/* Near Trigger — score embedded next to the top ticker */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Near Trigger</div>
              <div className="num" style={tileBig(watchCount>0?"var(--warn, #B8860B)":"var(--text-muted)")}>{watchCount}</div>
              <div style={tileSub}>
                {nearTop
                  ? <><span style={{color:"var(--text)", fontWeight:500}}>{nearTop.ticker}</span>
                      {" "}<span style={{fontFamily:"var(--font-mono)", color:"var(--text)"}}>{nearTop.ovr}</span>
                      <span style={{color:"var(--text-dim)"}}> · top score</span></>
                  : <>nothing pending</>}
              </div>
            </div>

            {/* Day P&L — today's session move on the book. Hidden on a
                fresh book / pre-market when prior equity is 0. */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Day P&amp;L</div>
              <div className="num" style={tileBig(
                !hasDayPnl ? "var(--text-muted)"
                : dayPnl$ >= 0 ? "var(--green-text)"
                : "var(--red-text)"
              )}>
                {hasDayPnl
                  ? (dayPnl$ >= 0 ? "+" : "−") + "$" + _fmt$K(Math.abs(dayPnl$))
                  : "—"}
              </div>
              <div style={tileSub}>
                {hasDayPnl
                  ? <>
                      <span style={{
                        fontFamily:"var(--font-mono)",
                        color: dayPnl$ >= 0 ? "var(--green-text)" : "var(--red-text)",
                      }}>{dayPnl$ >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%</span>
                      {benchmarkPct != null ? (
                        <>
                          <span style={{color:"var(--text-dim)"}}> · S&amp;P </span>
                          <span style={{fontFamily:"var(--font-mono)", color:"var(--text-muted)"}}>
                            {benchmarkPct >= 0 ? "+" : ""}{benchmarkPct.toFixed(2)}%
                          </span>
                          {outperfBps != null && Math.abs(outperfBps) >= 1 && (
                            <span style={{
                              fontFamily:"var(--font-mono)",
                              marginLeft:4,
                              color: outperfBps > 0 ? "var(--green-text)" : "var(--red-text)",
                            }}>
                              ({outperfBps > 0 ? "+" : ""}{outperfBps} bps)
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{color:"var(--text-dim)"}}> · vs. yesterday's close</span>
                      )}
                    </>
                  : <>market closed or pre-open</>}
              </div>
            </div>

            {/* Deployable cash — total cash across tactical accounts only */}
            <div style={tileStyle}>
              <div style={tileEyebrow}>Deployable Cash</div>
              <div className="num" style={tileBig(totalDeployable>0?"var(--accent)":"var(--text-muted)")}>
                {totalDeployable>0 ? "$"+_fmt$K(totalDeployable) : "$0"}
              </div>
              <div style={tileSub}>
                {totalDeployable>0
                  ? <>ready to put to work · tactical only</>
                  : <>no tactical cash</>}
              </div>
            </div>
          </div>

          {/* Largest position — compact single line so it doesn't crowd
              the grid. Surfaces any single-name >=10% concentration. */}
          {largestPos && (
            <div style={{
              marginTop:"var(--space-3)",
              paddingTop:"var(--space-3)",
              borderTop:"1px solid var(--border-faint)",
              fontSize:12, color:"var(--text-muted)",
              display:"flex", alignItems:"baseline", gap:"var(--space-2)", flexWrap:"wrap",
            }}>
              <span style={{
                fontFamily:"var(--font-mono)", fontSize:10,
                letterSpacing:"0.12em", textTransform:"uppercase",
                color:"var(--text-dim)",
              }}>Largest position</span>
              <span style={{color:"var(--text)", fontWeight:500}}>{largestPos.ticker}</span>
              <span style={{fontFamily:"var(--font-mono)", color: largestPct>=10 ? "var(--warn, #B8860B)" : "var(--text)"}}>
                {largestPct.toFixed(1)}%
              </span>
              <span style={{color:"var(--text-dim)"}}>of book · ${_fmt$K(largestPos.value)}</span>
            </div>
          )}

          <div style={{marginTop:"var(--space-4)"}}>
            <a onClick={()=>navTo("portopps")} style={{
              display:"inline-flex", alignItems:"center", gap:"var(--space-2)",
              padding:"var(--space-2) var(--space-3)",
              border:"1px solid var(--border-faint)", borderRadius:6,
              fontFamily:"var(--font-mono)", fontSize:11, letterSpacing:"0.08em",
              textTransform:"uppercase", color:"var(--text)",
              textDecoration:"none", cursor:"pointer",
            }}>Open Trading Opps <span style={{color:"var(--accent)"}}>→</span></a>
          </div>
        </div>);
      })()}

      {/* 03 · Sector Outlook — 3 highest overall rank + 3 lowest, with
          a visual divider between them. Per Joe feedback 2026-04-23:
          reads like a prop-desk long/short view, not a "top 5 extremes"
          mashup. Editorial narrative slot reads from sector_commentary
          and is null-allowed (no forced prose). */}
      <div style={cardStyle}>
        <div style={cardHeadStyle}>
          <h2 style={cardH2Style}><span style={cardTagStyle}>03</span>Sector Outlook</h2>
          <a style={cardLinkStyle} onClick={()=>navTo("sectors")}>Open →</a>
        </div>

        {(()=>{
          const renderRow = (s, isLast, key) => {
            const stanceColor = s.outlook.color;
            return (
              <div key={key}
                   onClick={()=>navTo("sectors")}
                   style={{
                     display:"flex", alignItems:"center", justifyContent:"space-between",
                     padding:"var(--space-3) 0",
                     borderBottom:isLast?"none":"1px solid var(--border-faint)",
                     cursor:"pointer", gap:12,
                   }}>
                <div style={{minWidth:0, flex:1, display:"flex", alignItems:"baseline", gap:"var(--space-3)"}}>
                  <span style={{
                    fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)",
                    letterSpacing:"0.06em", width:28, flexShrink:0,
                  }}>#{s.rank}</span>
                  <div style={{minWidth:0, flex:1}}>
                    <div style={{fontSize:13, color:"var(--text)", fontWeight:500, lineHeight:1.3}}>{s.name}</div>
                    <div style={{fontSize:11, color:"var(--text-muted)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                      <span style={{fontFamily:"var(--font-mono)"}}>β {s.beta.toFixed(2)}</span> · {s.sub.split(" · ").slice(0,2).join(" · ")}
                    </div>
                  </div>
                </div>
                <span style={{
                  fontFamily:"var(--font-mono)", fontSize:10,
                  letterSpacing:"0.1em", textTransform:"uppercase",
                  padding:"2px 8px", borderRadius:10,
                  border:`1px solid ${stanceColor}`, color:stanceColor, flexShrink:0,
                }}>{s.outlook.label}</span>
              </div>
            );
          };
          return (<>
            {/* Top 3 — highest overall rank */}
            {topOverweight.map((s,i) => renderRow(s, i===topOverweight.length-1, "top-"+s.id))}

            {/* Divider between the long-book and short-book halves */}
            {bottomUnderweight.length>0 && (
              <div aria-hidden="true" style={{
                display:"flex", alignItems:"center", gap:"var(--space-3)",
                padding:"var(--space-3) 0",
                fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-dim)",
                letterSpacing:"0.18em", textTransform:"uppercase",
              }}>
                <span style={{flex:1, height:1, background:"var(--border-faint)"}}/>
                <span>Bottom 3</span>
                <span style={{flex:1, height:1, background:"var(--border-faint)"}}/>
              </div>
            )}

            {/* Bottom 3 — lowest overall rank */}
            {bottomUnderweight.map((s,i) => renderRow(s, i===bottomUnderweight.length-1, "bot-"+s.id))}
          </>);
        })()}

        {/* Editorial sector narrative — single-sentence analyst note, only
            renders when the commentary engine detected a material move.
            No "stable this week" fallback on purpose. */}
        {(sectorCommentary && sectorCommentary.headline) && (
          <div style={{
            marginTop:"var(--space-4)",
            paddingTop:"var(--space-3)",
            borderTop:"1px solid var(--border-faint)",
            fontFamily:"var(--font-display)", fontStyle:"italic",
            fontSize:13, lineHeight:1.5, color:"var(--text-muted)",
          }}>
            {sectorCommentary.headline}
          </div>
        )}
      </div>

      {/* 04 · Daily Opp Scan — top-of-book names, not just counts */}
      {(()=>{
        // Top 3 buys (by overall score, highest first). Fall back to
        // near-trigger names when the buy list is thin, so the tile
        // always has at least one named opportunity if any exist.
        const _topBuys = (rebucketBuy.length ? rebucketBuy : rebucketNear).slice(0, 3);
        // Sector lookup for the name row's sub-copy.
        const _sectorFor = (t) => {
          const sc = scanData?.signals?.screener?.[t];
          return sc?.sector || scanData?.ticker_names?.[t] || "";
        };
        const rowHasData = _topBuys.length > 0;
        return (
        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <h2 style={cardH2Style}><span style={cardTagStyle}>04</span>Daily Opp Scan</h2>
            <a style={cardLinkStyle} onClick={()=>navTo("scanner")}>Open →</a>
          </div>

          {/* Headline number — candidates today */}
          <div style={{display:"flex", alignItems:"baseline", gap:"var(--space-3)", marginBottom:"var(--space-4)"}}>
            <div className="num" style={{
              fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums",
              fontSize:44, fontWeight:500, color: (buyCount + watchCount) > 0 ? "var(--accent)" : "var(--text-muted)",
              letterSpacing:"-0.01em", lineHeight:1,
            }}>{buyCount + watchCount}</div>
            <div style={{
              fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)",
              letterSpacing:"0.12em", textTransform:"uppercase", lineHeight:1.3,
            }}>candidates<br/>today</div>
          </div>

          {/* Compact counts strip */}
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"var(--space-2) 0",
            borderBottom:"1px solid var(--border-faint)",
            fontSize:11, fontFamily:"var(--font-mono)", color:"var(--text-muted)",
            letterSpacing:"0.06em", textTransform:"uppercase",
          }}>
            <span>Buy {buyCount} · Near {watchCount} · Other {rebucketOther.length}</span>
            <span style={{color:"var(--text-dim)"}}>60/40/0 thresholds</span>
          </div>

          {/* Top-of-book: top 3 names with their overall scores. The
              highest-score name in the scanner is far more useful than
              three count lines. */}
          <div style={{
            marginTop:"var(--space-2)",
            display:"flex", flexDirection:"column",
          }}>
            <div style={{
              padding:"var(--space-3) 0 var(--space-2)",
              fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)",
              letterSpacing:"0.14em", textTransform:"uppercase",
            }}>Top candidates</div>
            {rowHasData ? _topBuys.map((r, i) => {
              const sect = _sectorFor(r.ticker);
              const isLast = i === _topBuys.length - 1;
              const isBuy  = r.ovr >= 60;
              return (
                <div key={r.ticker}
                     onClick={()=>navTo("scanner")}
                     style={{
                       display:"flex", alignItems:"center", justifyContent:"space-between",
                       padding:"var(--space-2) 0",
                       borderBottom:isLast ? "none" : "1px solid var(--border-faint)",
                       cursor:"pointer", gap:"var(--space-3)",
                     }}>
                  <div style={{minWidth:0, flex:1, display:"flex", alignItems:"baseline", gap:"var(--space-3)"}}>
                    <span style={{
                      fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)",
                      width:20, flexShrink:0,
                    }}>#{i+1}</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13, color:"var(--text)", fontWeight:500, lineHeight:1.2}}>{r.ticker}</div>
                      {sect && <div style={{fontSize:10, color:"var(--text-muted)", marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{sect}</div>}
                    </div>
                  </div>
                  <div style={{
                    fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums",
                    fontSize:14, fontWeight:500,
                    color: isBuy ? "var(--accent)" : "var(--warn, #B8860B)",
                  }}>{r.ovr}</div>
                </div>
              );
            }) : (
              <div style={{
                padding:"var(--space-3) 0", fontSize:12, color:"var(--text-muted)",
              }}>No candidates on the watchlist today.</div>
            )}
          </div>

          {/* Last scan timestamp */}
          <div style={{
            marginTop:"auto", paddingTop:"var(--space-3)",
            fontSize:11, color:"var(--text-dim)",
            fontFamily:"var(--font-mono)", letterSpacing:"0.06em",
          }}>Last scan · {lastScanLabel}</div>
        </div>);
      })()}

    </section>

    {/* ─── 05 · Market News · Macro (full width) ─── */}
    <section>
      <div style={{
        display:"flex", alignItems:"baseline", justifyContent:"space-between",
        paddingBottom:"var(--space-3)", marginBottom:"var(--space-4)",
        borderBottom:"1px solid var(--border-faint)", gap:12,
      }}>
        <h2 style={{...cardH2Style, fontSize:22}}>
          <span style={{...cardTagStyle, fontSize:11}}>05</span>Market News · Macro
        </h2>
        <div style={{
          fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)",
          letterSpacing:"0.08em", textTransform:"uppercase",
          display:"inline-flex", alignItems:"center", gap:8,
        }}>
          <span style={{
            width:6, height:6, borderRadius:"50%",
            background: headlines.length>0 ? "var(--up, #30d158)" : "var(--text-dim)",
            display:"inline-block",
          }}/>
          {headlines.length>0
            ? `${zhPub.length} headline${zhPub.length===1?"":"s"}`
            : "no headlines"}
        </div>
      </div>

      {headlines.length>0 ? (
      <div style={{
        display:"grid", gridTemplateColumns:"1fr", gap:0,
        background:"var(--surface)",
        border:"1px solid var(--border-faint)", borderRadius:8,
        overflow:"hidden",
      }}>
        {headlines.map((n,i)=>(
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{
            display:"grid", gridTemplateColumns:"96px 1fr auto",
            gap:"var(--space-5)", alignItems:"center",
            padding:"var(--space-4) var(--space-5)",
            borderBottom:i<headlines.length-1?"1px solid var(--border-faint)":"none",
            textDecoration:"none", color:"inherit",
            transition:"background 120ms cubic-bezier(0.2,0.8,0.2,1)",
          }}
          onMouseEnter={e=>e.currentTarget.style.background="var(--surface-3)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          >
            <div style={{
              fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)",
              letterSpacing:"0.06em",
            }}>{fmtHeadlineTime(n.published)}</div>
            <div style={{fontSize:14, color:"var(--text)", fontWeight:500, lineHeight:1.45}}>
              {n.headline}
            </div>
            <div style={{
              fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-muted)",
              letterSpacing:"0.1em", textTransform:"uppercase", textAlign:"right",
              minWidth:96,
            }}>{n.source || "ZeroHedge"}</div>
          </a>
        ))}
      </div>
      ) : (
      <div style={{
        padding:"var(--space-6)", textAlign:"center",
        background:"var(--surface)", border:"1px solid var(--border-faint)",
        borderRadius:8, color:"var(--text-muted)", fontSize:13,
      }}>No macro headlines available right now.</div>
      )}
    </section>

  </main>);
})()}

{/* ─────── DRILL-DOWN — section header for non-home views ─────── */}
{tab!=="home" && TAB_META[tab] && (
  <SectionHeader
    eyebrow={TAB_META[tab].eyebrow}
    title={TAB_META[tab].title}
    sub={TAB_META[tab].sub}
    onBack={goBack}
    backLabel={backLabel}
  />
)}

<div className="fade-in" style={{maxWidth:1440, margin:"0 auto"}}>

{/* OVERVIEW — MACRO ONLY */}
{tab==="overview"&&(
<TodayMacro onNavToReadme={()=>navTo("readme")} asOfIso={AS_OF_ISO} indFreq={IND_FREQ}/>
)}

{/* INDICATORS */}
{tab==="indicators"&&(<AllIndicatorsTable/>)}

{tab==="sectors"&&<SectorsTab/>}

{/* PORTFOLIO & OPPORTUNITIES — consolidated tile (Phase 2). Publicly
    clickable since Track B2 — unauthenticated visitors see a zero-state
    skeleton + inline sign-in CTA; session data unlocks on sign-in. */}
{tab==="portopps"&&!portfolioAuthed&&showPortoppsLogin&&<LoginScreen/>}
{tab==="portopps"&&!(showPortoppsLogin&&!portfolioAuthed)&&(()=>{
const heldByTicker={};
ACCOUNTS.forEach(acc=>acc.positions.forEach(p=>{
  if(!heldByTicker[p.ticker])heldByTicker[p.ticker]={total:0,accounts:[]};
  heldByTicker[p.ticker].total+=p.value;
  heldByTicker[p.ticker].accounts.push({acctId:acc.id,acctLabel:acc.label,value:p.value});
}));
const tacticalAccts=ACCOUNTS.filter(a=>a.tactical);
const cashByAcct=tacticalAccts.map(acc=>{
  const cash=acc.positions.filter(p=>p.sector==="Cash").reduce((a,p)=>a+p.value,0);
  return{id:acc.id,label:acc.label,cash};
}).filter(x=>x.cash!==0).sort((a,b)=>b.cash-a.cash);
const totalDeployable=cashByAcct.reduce((a,c)=>a+c.cash,0);
// Sort held positions by value DESC — biggest exposure first, regardless of account
const heldPositions=ACCOUNTS
  .flatMap(acc=>acc.positions.map(p=>({...p,acctId:acc.id,acctLabel:acc.label,acctTactical:acc.tactical})))
  .sort((a,b)=>b.value-a.value);
const heldTickers=new Set(heldPositions.map(p=>p.ticker));
const scoreByTicker=scanData?.score_by_ticker||{};
// Classes of holdings the scanner framework doesn't meaningfully evaluate —
// commodities, crypto wrappers, HY-bond funds, broad intl-equity funds get
// artificially low scores (e.g. SLV=0, GLD=6) because the scanner looks for
// equity-specific signals (Congress/insider/flow) that don't apply.
const SCANNER_OUT_OF_SCOPE_SECTORS=new Set(["Commodity","Metals","Crypto","HY Bonds","Intl Equity"]);
const BROAD_INDEX_FUNDS=new Set(["FXAIX","FSKAX","FZILX","FSGGX","FXNAX","FXIIX"]);
const actionFor=p=>{
  if(!p.acctTactical)return{label:"MONITOR",color:"var(--text-dim)",reason:"Plan-fund account — can't act on tactical signals here.",detail:`This position sits in ${p.acctLabel}, which is limited to the plan's menu of funds. Signals from the scanner don't apply — the account holds what the plan allows. Review at enrollment/re-enrollment windows or major life events.`};
  if(SCANNER_OUT_OF_SCOPE_SECTORS.has(p.sector))return{label:"OUT OF SCOPE",color:"var(--text-dim)",reason:`Scanner doesn't evaluate ${p.sector.toLowerCase()} positions.`,detail:`The scanner looks for equity-specific signals (Congressional trades, insider Form-4s, unusual options flow, technical momentum) that don't meaningfully apply to ${p.sector.toLowerCase()} holdings. This position is held for strategic/diversification reasons — not tactical scanner signals. Review based on portfolio allocation thesis, not the daily scan.`};
  if(BROAD_INDEX_FUNDS.has(p.ticker))return{label:"CORE",color:"var(--accent)",reason:"Broad-market index fund — not a tactical position.",detail:`${p.ticker} is a diversified index holding. Do not manage tactically on daily scanner signals; it's a long-term core holding. Review allocation relative to age-based glide path, not market regime.`};
  const sc=scoreByTicker[p.ticker];
  if(sc==null)return{label:"NO SIGNAL",color:"var(--text-dim)",reason:"Not scored in the latest scan.",detail:`The scanner runs a scored universe of equity tickers; ${p.ticker} isn't currently included. This is a scanner coverage gap, not a sell signal. Task #9 tracks adding held positions to the always-scored list so this gets proper signal data.`};
  if(sc>=60)return{label:"BUY ZONE",color:"#30d158",reason:`Score ${sc} — meets the 60+ buy threshold.`,detail:`Composite scanner score of ${sc} combines Congressional trades, insider buying, options flow, and technical momentum. A score ≥60 is the algorithmic buy threshold. Consider adding to the position if cash is available and allocation permits. See full scanner detail for the component breakdown.`};
  if(sc>=35)return{label:"HOLD",color:"#B8860B",reason:`Score ${sc} — in the healthy hold range.`,detail:`Score ${sc} is within the 35–60 hold band. No action needed. The scanner is not flagging a reason to trim or add. Monitor for score drift below 35 (weakening) or above 60 (add candidate).`};
  if(sc>=20)return{label:"WATCH",color:"#ff9f0a",reason:`Score ${sc} — signals weakening.`,detail:`Score ${sc} has dropped into the 20–35 weakening band. Underlying signals (flow, insider activity, technicals) are deteriorating but haven't reached sell-watch territory. Tighten your stop-loss and do not add to the position. Consider trimming if score crosses below 20 or the position breaks its SL.`};
  return{label:"REVIEW",color:"#ff453a",reason:`Score ${sc} — in the sell-watch zone.`,detail:`Score ${sc} is below the 20 sell-watch threshold. Scanner components are bearish (weak flow, no insider support, deteriorating technicals). Not an automatic sell — but actively review the thesis: is there a catalyst you're waiting for? Otherwise, trim or exit on any bounce. Check full scanner detail for the specific weak components.`};
};
const fmt$K=v=>v>=1000?`$${Math.round(v/1000).toLocaleString()}K`:`$${Math.round(v).toLocaleString()}`;
const fmt$Full=v=>`$${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const sectionPanel={background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,overflow:"hidden",marginBottom:12};
const sectionHeader={padding:"12px 16px",borderBottom:"1px solid var(--border-faint)",display:"flex",justifyContent:"space-between",alignItems:"center"};
const sectionTitleStyle={fontSize:16,fontWeight:800,color:"var(--text)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em"};
const subTitleStyle={fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:8,fontWeight:600};
// Visual separator for sub-sections INSIDE a Section Panel. Each sub-panel gets
// its own bordered frame + header row so Allocation / Notable / Positions /
// Deployable Cash read as discrete blocks rather than one giant flow.
const subPanelOuter={background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:6,overflow:"hidden",marginBottom:12};
const subPanelHeader={padding:"8px 12px",background:"var(--surface)",borderBottom:"1px solid var(--border-faint)",display:"flex",justifyContent:"space-between",alignItems:"center"};
const subPanelTitleStyle={fontSize:11,color:"var(--text-2)",fontFamily:"var(--font-mono)",letterSpacing:"0.1em",fontWeight:700};
const subPanelBody={padding:"10px 12px"};
const cardStyle={background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:6,padding:"10px 12px"};
const tagStyle=col=>({fontSize:10,fontWeight:700,color:"#fff",background:col,padding:"2px 7px",borderRadius:3,fontFamily:"var(--font-mono)",letterSpacing:"0.05em",cursor:"pointer",userSelect:"none"});
return(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",maxWidth:1100,margin:"0 auto"}}>
{/* INLINE SIGN-IN CTA — only when not authed. Per B2 spec: portopps is
    publicly clickable, but shows zero-state + a contextual prompt instead
    of a full LoginScreen. Signing in swaps the skeleton for real data. */}
{!portfolioAuthed&&(
<div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",marginBottom:12,display:"flex",gap:14,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
<div style={{flex:"1 1 260px",minWidth:0}}>
<div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:4,fontWeight:700}}>SIGN IN TO SEE YOUR PORTFOLIO</div>
<div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>This is the shape of Portfolio & Insights. Sign in to populate it with your own accounts, positions, and watchlist — everything is private to your account.</div>
</div>
<button onClick={()=>setShowPortoppsLogin(true)} style={{padding:"10px 16px",fontSize:13,fontWeight:600,color:"#fff",background:"var(--accent)",border:"none",borderRadius:"var(--radius-sm)",cursor:"pointer",whiteSpace:"nowrap"}}>Sign in</button>
</div>
)}
{/* SUMMARY BAR */}
<div style={{background:`${CONV.color}0d`,border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"14px 16px",marginBottom:12}}>
<div style={{fontSize:11,color:convTextColor(CONV),fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8,fontWeight:700}}>PORTFOLIO & INSIGHTS · SNAPSHOT</div>
{/* Item 28: auto-fit + minmax(140px,1fr) so 6 KPIs fit on desktop but reflow
    to 2 cols on a 430px phone (previously forced repeat(6,1fr) — boxes at
    ~58px, dollar values overflowed off viewport). */}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
{[
  {label:"Total Wealth",value:`$${Math.round(grandTotal).toLocaleString()}`,col:"var(--text)"},
  {label:"Port. Beta",value:portBeta.toFixed(2),col:portBeta>1.3?"var(--orange-text)":portBeta<0.6?"var(--yellow-text)":"var(--text)"},
  {label:"Holdings",value:`${heldPositions.length}`,col:"var(--text)"},
  {label:"Buy Alerts",value:buyCount,col:"var(--green-text)",accent:"#30d158"},
  {label:"Near Trigger",value:watchCount,col:"var(--yellow-text)",accent:"#B8860B"},
  {label:"Watchlist",value:`${WATCHLIST.length}`,col:"var(--text)"},
].map(({label,value,col,accent})=>(
<div key={label} style={{background:accent?`${accent}14`:"var(--surface-2)",border:accent?`1px solid ${accent}55`:"1px solid transparent",borderLeft:accent?`3px solid ${accent}`:"1px solid transparent",borderRadius:5,padding:"10px 12px"}}>
<div style={{fontSize:10,color:accent?col:"var(--text-2)",fontFamily:"monospace",marginBottom:4,fontWeight:accent?700:400,letterSpacing:accent?"0.08em":"normal"}}>{label.toUpperCase()}</div>
<div style={{fontSize:14,fontWeight:800,color:col,fontFamily:"monospace"}}>{value}</div>
</div>
))}
</div>
</div>

{/* SECTION 1 — OPPORTUNITIES (visually distinct sub-panels, clickable cards) */}
<div style={sectionPanel}>
<div style={sectionHeader}>
<span style={sectionTitleStyle}>① TRADING OPPORTUNITIES</span>
<div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
{/* Universe-snapshot freshness — signed-in only, hidden pre-auth. */}
<UniverseFreshness pricesTs={universeSnapshotTs} eventsTs={scanData?.ticker_events_ts}/>
<span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{buyCount} triggered · {watchCount} near · {rebucketOther.length} other</span>
<span style={{fontSize:11,color:ACCENT,cursor:"pointer",fontFamily:"var(--font-mono)"}} onClick={()=>navTo("scanner")}>Full scanner →</span>
</div>
</div>
<div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>

{(()=>{
// Translate scanner output rows ({ticker, score, current_price, ...}) into
// the {ticker, name, theme} shape that WatchlistTable consumes. Name comes
// from the screener full_name when available; theme is left blank (BUY /
// NEAR have no theme copy — the panel title IS the theme).
const screenerMap=scanData?.signals?.screener||{};
// Item 36: info map powers Div Yield / Next Earnings / Market Cap / etc.
// columns in Positions & Watchlist tables. Falls back to {} so callers can
// always safely do info[ticker]?.field.
const infoMap=scanData?.signals?.info||{};
const toWlRows=(items)=>(items||[]).map(it=>({
  ticker:it.ticker,
  name:screenerMap[it.ticker]?.full_name||"",
  theme:"",
}));

// SUB-PANEL 1: SCANNER — TRIGGERED (green accent)
// Source: client-side OVR rebucket (see rebucketBuy in outer scope). Keeps
// tile contents in lockstep with the OVR column, regardless of scanner drift.
const triggered=rebucketBuy;
// SUB-PANEL 2: SCANNER — WATCH / NEAR TRIGGER (yellow accent)
const nearTrigger=rebucketNear;
// subPanel now accepts an optional `criteria` chip rendered next to the
// title in muted weight — lets users see at a glance *why* a ticker is in
// the Buy Alerts vs Near Trigger bucket without opening the modal.
const subPanel=(accentCol,title,criteria,count,children)=>(
<div style={{background:"var(--surface-2)",border:`1px solid ${accentCol}55`,borderLeft:`3px solid ${accentCol}`,borderRadius:6,overflow:"hidden"}}>
<div style={{padding:"8px 12px",background:`${accentCol}14`,borderBottom:`1px solid ${accentCol}22`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
<span style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",minWidth:0}}>
  <span style={{fontSize:11,fontWeight:700,color:accentCol,fontFamily:"var(--font-mono)",letterSpacing:"0.08em"}}>{title}</span>
  {criteria&&<span style={{fontSize:10,fontWeight:500,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em"}}>{criteria}</span>}
</span>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap"}}>{count}</span>
</div>
<div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>{children}</div>
</div>
);

return(<>
{subPanel("#30d158","BUY ALERTS","(Composite Score ≥ 60)",`${triggered.length} today`,
  <WatchlistTable
    rows={toWlRows(triggered)}
    signals={scanData?.signals}
    screener={screenerMap}
    info={infoMap}
    tableKey="watchlist_buy"
    heldTickers={heldTickers}
    onOpenTicker={(t)=>setTickerDetail(t)}
    emptyMessage={`No buy alerts today · Last scan: ${lastScanLabel}`}
  />
)}
{subPanel("#B8860B","NEAR TRIGGER","(Composite Score 40–59)",`${nearTrigger.length} name${nearTrigger.length===1?"":"s"}`,
  <WatchlistTable
    rows={toWlRows(nearTrigger)}
    signals={scanData?.signals}
    screener={screenerMap}
    info={infoMap}
    tableKey="watchlist_near"
    heldTickers={heldTickers}
    onOpenTicker={(t)=>setTickerDetail(t)}
    emptyMessage="Nothing near trigger today."
  />
)}
{subPanel("#64748b","OTHER WATCHLIST",null,`${rebucketOther.length} tracking`,
  <>
    <WatchlistTable
      rows={rebucketOther}
      signals={scanData?.signals}
      screener={screenerMap}
      info={infoMap}
      tableKey="watchlist_other"
      heldTickers={heldTickers}
      onOpenTicker={(t)=>setTickerDetail(t)}
      emptyMessage="No tickers on your watchlist. Add one below."
    />
    {portfolioAuthed&&<WatchlistAddInput session={session} watchlistRows={userWatchlistRows} refetchPortfolio={refetchPortfolio} onTickerAdded={scanTicker}/>}
  </>
)}
{/* Coverage disclaimer. Subcomposites require single-name fundamentals +
    options flow + insider/congress feeds, which don't exist for funds,
    ETFs, or crypto proxies (BTCUSD/ETHUSD). Keeps blank strips interpretable
    rather than looking like a bug. */}
<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em",textAlign:"center",padding:"6px 4px 2px",opacity:0.75}}>
  Subcomposite scores (TECH / OPT / INS / CON / ANL / DP) available for single-name equities only — blank on funds, ETFs, and crypto proxies.
</div>
</>);
})()}

</div>
</div>

{/* SECTION 2 — PORTFOLIO INSIGHTS (merged: allocation + key risks + positions) */}
<div style={sectionPanel}>
<div style={sectionHeader}>
<span style={sectionTitleStyle}>② PORTFOLIO INSIGHTS</span>
<span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>${Math.round(grandTotal).toLocaleString()} · Beta {portBeta.toFixed(2)} · {heldPositions.length} positions</span>
</div>
<div style={{padding:"12px 16px"}}>
{ACCOUNTS.length===0?(
  portfolioAuthed?(
    <OnboardingPanel userId={session?.user?.id} onDone={refetchPortfolio}/>
  ):(
    <div style={{padding:"28px 16px",textAlign:"center",color:"var(--text-muted)",fontSize:13,lineHeight:1.55}}>
      Sign in to populate allocation, positions, and risk insights with your own data.
    </div>
  )
):<>

{/* ALLOCATION (wealth bars) */}
<div style={subPanelOuter}>
<div style={subPanelHeader}>
<span style={subPanelTitleStyle}>ALLOCATION</span>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>WEALTH BY ACCOUNT & ASSET CLASS</span>
</div>
<div style={subPanelBody}>
{(()=>{
const ACCT_LABEL2={brokerage:"JPM Brokerage",k401:"401(k)",roth:"Roth IRA",hsa:"HSA","529s":"Scarlett 529","529e":"Ethan 529"};
// Account rows in Supabase carry color=null for legacy users (pre-palette
// migration). Without a fallback, WEALTH BY ACCOUNT bar slices render
// transparent against the dark background and the bar looks empty.
// Deterministic fallback by DB sort-order index so colors don't flip on
// the value-sorted acctData re-sort below.
const ACCT_PALETTE=["#4a6fa5","#ff9f0a","#14b8a6","#a855f7","#B8860B","#6366f1","#64748b","#f97316"];
const acctData=ACCOUNTS.map((acc,i)=>{
const t=acc.positions.reduce((a,p)=>a+p.value,0);
return{id:acc.id,name:ACCT_LABEL2[acc.id]||acc.label,color:acc.color||ACCT_PALETTE[i%ACCT_PALETTE.length],value:t};
}).sort((a,b)=>b.value-a.value);
const assetData=Object.entries(assetRollup).sort((a,b)=>b[1]-a[1]).map(([cls,val])=>(
{id:cls,name:cls,color:rollupColors[cls]||"#5c6370",value:val}
));
// Gross / net split. Negative values (margin debits, short positions) break
// stacked-bar flex math — `flex: -0.08` collapses every segment to minWidth
// because CSS treats negative flex-grow as 0. We stack positives only and
// compute segment % against GROSS (sum of positives) so the bar renders and
// the slice labels sum to 100%. Liabilities still surface in the legend with
// their signed value + signed % of gross so Joe sees the debit faithfully.
// Header meta shows net (grandTotal) when it differs from gross.
const renderBar2=(title,unit,segs,key)=>{
const gross=segs.reduce((a,s)=>a+Math.max(0,s.value),0)||1;
const net=segs.reduce((a,s)=>a+s.value,0);
const hasLiab=segs.some(s=>s.value<0);
// When liabilities exist, count positive segments only for the class
// count — debt is a liability row, not an asset class.
const posCount=segs.filter(s=>s.value>0).length;
const meta=hasLiab
  ?`${posCount} ${unit} · ${fmt$K(gross)} gross · ${fmt$K(net)} net`
  :`${segs.length} ${unit} · ${fmt$K(net)}`;
return(
<div key={key} style={{marginBottom:14}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.12em",fontWeight:600}}>{title}</span>
<span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{meta}</span>
</div>
<div style={{display:"flex",height:10,borderRadius:6,overflow:"hidden",background:"var(--border-faint)",gap:2,marginBottom:10}}>
{segs.filter(s=>s.value>0).map(s=>(<div key={s.id} title={`${s.name} · ${fmt$K(s.value)} · ${(s.value/gross*100).toFixed(1)}%`} style={{flex:s.value/gross,background:s.color,minWidth:2}}/>))}
</div>
<div style={{display:"flex",flexWrap:"wrap",rowGap:6,columnGap:18}}>
{segs.map(s=>(
<div key={s.id} style={{display:"flex",alignItems:"center",gap:7}}>
<div style={{width:9,height:9,borderRadius:2,flexShrink:0,background:s.color,opacity:s.value<0?0.4:1}}/>
<span style={{fontSize:12,color:"var(--text)",fontWeight:500}}>{s.name}</span>
<span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>{fmt$K(s.value)}</span>
<span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{(s.value/gross*100).toFixed(0)}%</span>
</div>
))}
</div>
</div>
);
};
return(<>
{renderBar2("WEALTH BY ACCOUNT","accounts",acctData,"acct")}
{renderBar2("ASSET CLASS MIX","classes",assetData,"asset")}
</>);
})()}
</div>
</div>
{/* /ALLOCATION sub-panel */}

{/* NOTABLE — rules-driven; renders nothing if zero rules fire. Keep terse:
    one short sentence per line. Never pad with "you're well-diversified"
    type observations — that's visual noise, not signal. Signals on YOUR
    tickers are prioritized over generic portfolio-beta/drawdown lines
    because those are derivable from the positions list above; the
    scanner composite and flow/insider/congress signals are not. Order:
      Priority 1 — Signal changes on holdings (composite flips, conviction
                   stacks, congress/insider buys on names you own)
      Priority 2 — Cross-account exposure + risk flags (concentration,
                   sector cluster, cross-account holds)
      Priority 3 — Portfolio-level notes (deployable cash, beta outlier)
      Priority 4 — Material drawdowns (severe only — ≤-35% or > $5K loss)
    Rule: if fewer than 2 signal-based lines fire, we still show cross-
    account & cash lines because those are inherently useful. We do NOT
    force more drawdown lines just to fill space. */}
{(()=>{
  const lines=[];
  const signals=scanData?.signals;

  // Broad index / commodity-wrapper / cash tickers that aren't meaningful
  // "concentrations" even if >10% — they're diversified by construction.
  // 2026-04-23 (#1018): extended the cash list so literal CASH / FDIC /
  // Core-Cash tickers can never surface as composite-scored holdings in
  // Notable. The scanner-score sell-watch rule was the path that slipped
  // a "CASH composite -49" line through before this commit.
  const NOT_A_CONCENTRATION=new Set([
    "FXAIX","FSKAX","FXIIX","FZILX","FSGGX","FXNAX", // broad index
    "JHYUX",                                          // HY bond fund
    "NHXINT906",                                      // intl-equity 529 fund
    "SPAXX","QACDS","CASH","FDIC","CORE-CASH","CORECASH", // money-market / cash
  ]);

  // Tickers we'll evaluate for signal-based insights — deduplicated set of
  // the user's in-scope tactical holdings. Broad-index funds and cash
  // don't have composite signals, so exclude them early.
  const signalTickers=new Set();
  heldPositions.forEach(p=>{
    if(!p.acctTactical)return;
    if(SCANNER_OUT_OF_SCOPE_SECTORS.has(p.sector))return;
    if(BROAD_INDEX_FUNDS.has(p.ticker))return;
    if(NOT_A_CONCENTRATION.has(p.ticker))return;
    signalTickers.add(p.ticker);
  });

  // ── PRIORITY 1 — Signal changes on holdings ──
  // For each in-scope holding, compute the full composite and surface rules
  // that give Joe info he can't derive from the positions list.
  const signalLines=[];
  signalTickers.forEach(t=>{
    const composite=signals?computeSectionComposites(t,{signals}):null;
    if(!composite)return;
    const ov=composite.overall?.score;
    const sections=composite.sections||{};

    // (a) Strong bullish composite on a holding (>=40) — conviction to add.
    // 2026-04-23: threshold raised from +30 → +40 to keep this panel from
    // filling with marginal reads. Joe feedback: "80% of 14 items aren't
    // notable" — bar should be material-move-only.
    if(ov!=null&&ov>=40){
      signalLines.push({col:"#30d158",body:`${t} composite +${ov} — strong bullish tilt across ${Object.values(sections).filter(s=>s?.score>0).length} of 6 categories`,pri:1});
    }
    // (b) Strong bearish composite on a holding (<=-30) — sell-watch
    else if(ov!=null&&ov<=-30){
      signalLines.push({col:"#ff453a",body:`${t} composite ${ov} — bearish read, review position`,pri:1});
    }

    // (c) Conviction stack — four or more sections strongly bullish
    // (each score >= +40). Fires even if overall is moderate. Threshold
    // raised 2026-04-23 (was 3 sections @ +30) to match the tightened bar.
    const strongBull=Object.entries(sections).filter(([,s])=>s?.score!=null&&s.score>=40).map(([k])=>k);
    if(strongBull.length>=4){
      const names=strongBull.map(k=>k.toUpperCase()).slice(0,4).join("/");
      // Only add if we haven't already flagged this ticker with the overall rule
      if(!signalLines.some(l=>l.body.startsWith(`${t} composite`))){
        signalLines.push({col:"#30d158",body:`${t} bullish stack — ${names} all >+40`,pri:1});
      }
    }

    // (d) Congress buy on a ticker you already hold
    const congBuys=(signals?.congress_buys||[]).filter(r=>(r?.ticker||"").toUpperCase()===t);
    if(congBuys.length>0){
      const buyers=new Set(congBuys.map(r=>r.member||r.name)).size;
      signalLines.push({col:"#0a84ff",body:`${t} — ${congBuys.length} recent congressional buy${congBuys.length===1?"":"s"} (${buyers} member${buyers===1?"":"s"})`,pri:1});
    }

    // (e) Insider buy on a ticker you already hold (material only — $50K+)
    const insBuys=(signals?.insider_buys||[]).filter(r=>{
      if((r?.ticker||"").toUpperCase()!==t)return false;
      const val=Number(r.transaction_value||r.value||0);
      return val>=50000;
    });
    if(insBuys.length>0){
      signalLines.push({col:"#bf5af2",body:`${t} — insider open-market buy${insBuys.length===1?"":"s"} filed (${insBuys.length})`,pri:1});
    }
  });
  // Cap signal lines at 4 (was 6) — keeps the panel scannable and forces
  // the largest positions to win ties since heldPositions is $-sorted.
  signalLines.slice(0,4).forEach(l=>lines.push(l));

  // ── PRIORITY 2 — Cross-account exposure + risk flags ──

  // Single-stock concentrations >10% of total wealth
  Object.entries(heldByTicker).forEach(([ticker,info])=>{
    if(NOT_A_CONCENTRATION.has(ticker))return;
    const pct=info.total/grandTotal*100;
    if(pct>=10){
      lines.push({col:"#ff9f0a",body:`${ticker} is ${pct.toFixed(1)}% of total wealth — single-name concentration`,pri:2});
    }
  });

  // Sector concentration — any non-broad single sector >30% of tactical
  // book (excludes funds/cash that aren't sector-specific).
  const sectorTot={};
  let tacTot=0;
  heldPositions.forEach(p=>{
    if(!p.acctTactical)return;
    if(BROAD_INDEX_FUNDS.has(p.ticker))return;
    if(p.sector==="Cash")return;
    if(!p.sector||p.sector==="—")return;
    sectorTot[p.sector]=(sectorTot[p.sector]||0)+p.value;
    tacTot+=p.value;
  });
  if(tacTot>0){
    Object.entries(sectorTot).forEach(([sector,val])=>{
      const pct=val/tacTot*100;
      if(pct>=30){
        lines.push({col:"#ff9f0a",body:`${sector} sector is ${pct.toFixed(0)}% of tactical book — sector cluster`,pri:2});
      }
    });
  }

  // (Cross-account single-ticker exposure line removed 2026-04-23 — that's
  // derivable from the positions table and was padding the panel. Keep
  // only signals that add information beyond what's on screen.)

  // Sell-watch zone — rewritten 2026-04-23 (#1018). Previously used the
  // 0-100 scanner score with a `< 20` threshold, which rendered lines like
  // "NVDA scanner score 13 — sell-watch zone" that looked bearish on a
  // signed-composite (-100/+100) mental model where +13 is mildly bullish.
  // Now uses the same client-side composite engine as the watchlist / modal
  // / BUY-NEAR-TRIGGER buckets, with a signed threshold of composite ≤ -20.
  // Skips tickers already flagged by Priority 1 (composite ≤ -30 = "bearish
  // read, review") so we don't double-surface the same bearish holding.
  // Cash / money-market / broad-index / out-of-scope positions continue to
  // be filtered identically to the signalTickers loop above.
  heldPositions.forEach(p=>{
    if(!p.acctTactical)return;
    if(p.sector==="Cash")return;
    if(SCANNER_OUT_OF_SCOPE_SECTORS.has(p.sector))return;
    if(BROAD_INDEX_FUNDS.has(p.ticker))return;
    if(NOT_A_CONCENTRATION.has(p.ticker))return;
    const composite=signals?computeSectionComposites(p.ticker,{signals}):null;
    const ov=composite?.overall?.score;
    if(ov==null)return;
    if(ov>-20)return; // not in sell-watch band
    // Already surfaced by Priority 1 bearish rule (<= -30)? Skip to avoid
    // duplicate lines on the same ticker.
    if(signalLines.some(l=>l.body.startsWith(`${p.ticker} composite`)))return;
    lines.push({col:"#ff453a",body:`${p.ticker} composite ${ov} — sell-watch zone`,pri:2});
  });

  // ── PRIORITY 3 — Portfolio-level notes ──

  // Deployable cash (tactical accounts only)
  if(totalDeployable>5000){
    lines.push({col:"#30d158",body:`${fmt$K(totalDeployable)} deployable cash across ${cashByAcct.length} tactical account${cashByAcct.length===1?"":"s"}`,pri:3});
  }

  // Portfolio-beta outlier — only surface at extremes so it's not constant noise
  if(portBeta>1.3){
    lines.push({col:"#ff9f0a",body:`Portfolio beta ${portBeta.toFixed(2)} — elevated equity sensitivity`,pri:3});
  }else if(portBeta<0.6){
    lines.push({col:"#B8860B",body:`Portfolio beta ${portBeta.toFixed(2)} — defensive vs. market`,pri:3});
  }

  // ── PRIORITY 4 — Material drawdowns (severe only) ──
  // Previously fired at -25% on any position — created noise. Now only
  // fires when drawdown is ≤-35% OR dollar loss exceeds $5K. Cap at 2.
  const drawdownLines=[];
  heldPositions.forEach(p=>{
    if(!p.avgCost||p.sector==="Cash")return;
    const pnlPct=(p.price/p.avgCost-1)*100;
    const pnl$=p.value-p.avgCost*p.quantity;
    if(pnlPct<=-35||pnl$<=-5000){
      drawdownLines.push({col:"#ff453a",body:`${p.ticker} ${pnlPct.toFixed(0)}% vs. cost (${fmt$K(pnl$)} · ${p.acctLabel})`,pri:4});
    }
  });
  drawdownLines.slice(0,2).forEach(l=>lines.push(l));

  // Hard cap on total rendered lines — stay on one page, force the
  // bar higher if everything else is low-signal. (Joe feedback 2026-04-23.)
  const MAX_NOTABLE=8;
  if(lines.length>MAX_NOTABLE)lines.length=MAX_NOTABLE;

  if(lines.length===0)return null;
  return(
    <div style={subPanelOuter}>
    <div style={subPanelHeader}>
    <span style={subPanelTitleStyle}>NOTABLE</span>
    <span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>{lines.length} insight{lines.length===1?"":"s"}</span>
    </div>
    <div style={subPanelBody}>
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {lines.map((l,i)=>(
      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"var(--surface)",borderLeft:`3px solid ${l.col}`,borderRadius:4}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:l.col,flexShrink:0}}/>
      <span style={{fontSize:12,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{l.body}</span>
      </div>
    ))}
    </div>
    </div>
    </div>
  );
})()}

{/* POSITIONS — sortable table. Default sort: % of wealth DESC (biggest
    exposure first). Click column headers to re-sort. Row click opens the
    detail modal. Columns: Ticker, Name, Sector, Price, Cost Basis, PnL $,
    PnL %, Beta, % Wealth, Account. */}
<div style={subPanelOuter}>
<div style={subPanelHeader}>
<span style={subPanelTitleStyle}>POSITIONS</span>
<span style={{display:"flex",alignItems:"center",gap:10}}>
{/* Same freshness chip as the dashboard header — makes the PnL Day column
    readable as "today, not yesterday" for any authenticated user. Also
    stamps ticker-events freshness so news/insider/congress data is visibly
    current. */}
<UniverseFreshness pricesTs={universeSnapshotTs} eventsTs={scanData?.ticker_events_ts}/>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>CLICK A ROW FOR DETAIL · SORT BY ANY COLUMN</span>
</span>
</div>
<div style={subPanelBody}>
<PositionsTable
  rows={heldPositions}
  grandTotal={grandTotal}
  screener={scanData?.signals?.screener||{}}
  info={scanData?.signals?.info||{}}
  tableKey="positions"
  onOpenTicker={(t)=>setTickerDetail(t)}
  emptyMessage="No positions."
  onAdd={portfolioAuthed?()=>setPositionEditor({mode:"add"}):undefined}
  onBulkImport={portfolioAuthed?()=>setShowBulkImport(true):undefined}
  onRescan={portfolioAuthed?()=>handleRescanAllPositions(heldPositions):undefined}
  rescanBusy={rescanState.active}
  rescanProgress={{done:rescanState.done,total:rescanState.total}}
  onEdit={portfolioAuthed?(rawRow)=>setPositionEditor({mode:"edit",existing:rawRow}):undefined}
  onDelete={portfolioAuthed?deletePositionInline:undefined}
  pricesTs={universeSnapshotTs}
  eventsTs={scanData?.ticker_events_ts}
  footnoteSource="Unusual Whales + Yahoo Finance"
/>
</div>
</div>

{/* DEPLOYABLE CASH */}
<div style={subPanelOuter}>
<div style={subPanelHeader}>
<span style={subPanelTitleStyle}>DEPLOYABLE CASH</span>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)"}}>TACTICAL ACCOUNTS · {fmt$Full(totalDeployable||0)}</span>
</div>
<div style={subPanelBody}>
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
{cashByAcct.length>0?cashByAcct.map(c=>(
<div key={c.id} style={{...cardStyle,flex:"1 1 180px"}}>
<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.05em"}}>{c.label}</div>
<div style={{fontSize:14,fontWeight:800,color:c.cash<0?"#ff453a":"#30d158",fontFamily:"var(--font-mono)",marginTop:3}}>{fmt$Full(c.cash)}</div>
</div>
)):<div style={{fontSize:12,color:"var(--text-muted)"}}>No cash in tactical accounts.</div>}
</div>
</div>
</div>

</>}
</div>
</div>

{/* ACCOUNT-BY-ACCOUNT BREAKDOWN — collapsed by default to keep the tab lean.
    Replaces the old Holdings Detail tab; same AcctCard component, rendered
    inline once the user asks for it. */}
<div style={sectionPanel}>
<div style={{...sectionHeader,cursor:"pointer"}} onClick={()=>setAcctBreakdownOpen(v=>!v)}>
<span style={sectionTitleStyle}>③ ACCOUNT BREAKDOWN</span>
<div style={{display:"flex",alignItems:"center",gap:14}}>
<span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{ACCOUNTS.length} accounts · position-level detail</span>
<span style={{fontSize:11,color:ACCENT,fontFamily:"var(--font-mono)"}}>{acctBreakdownOpen?"▾ Hide":"▸ Show"}</span>
</div>
</div>
{acctBreakdownOpen&&(
<div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:12}}>
{ACCOUNTS.map(acct=>(<AcctCard key={acct.id} acct={acct} grandTotal={grandTotal} convColor={CONV.color} convLabel={CONV.label} stressScore={COMP100}/>))}
</div>
)}
</div>

</div>
);
})()}

{/* SCANNER */}
{tab==="scanner"&&<Scanner focusTicker={scannerFocusTicker} onFocusConsumed={()=>setScannerFocusTicker(null)} onOpenTicker={(t)=>setTickerDetail(t)}/>}

{/* Per-ticker detail modal — opens from any ticker-level 'Details' click in
    portopps (opportunity cards, position cards). Escape hatch at the bottom
    of the modal navigates to the Scanner tab with that ticker focused. */}
{tickerDetail&&(
  <ErrorBoundary label={`${tickerDetail} detail`} onDismiss={()=>setTickerDetail(null)}>
    <TickerDetailModal ticker={tickerDetail} scanData={scanData} accounts={ACCOUNTS}
      watchlistRows={userWatchlistRows} portfolioAuthed={portfolioAuthed} refetchPortfolio={refetchPortfolio}
      onTickerAdded={scanTicker} scanBusy={scanningTickers.has(tickerDetail)}
      onClose={()=>setTickerDetail(null)}/>
  </ErrorBoundary>
)}

{/* PositionEditor — add OR edit a single position. Shown when the user
    clicks "+ Add position" or a row's Edit button in PositionsTable.
    Supabase writes live inside the component; we just refetch + close. */}
{positionEditor&&portfolioAuthed&&(
  <ErrorBoundary label="Position editor" onDismiss={()=>setPositionEditor(null)}>
    <PositionEditor
      mode={positionEditor.mode}
      existing={positionEditor.existing}
      accounts={ACCOUNTS.map(a=>({id:a.id,label:a.label}))}
      userId={session?.user?.id}
      onClose={()=>setPositionEditor(null)}
      onSaved={async()=>{await refetchPortfolio?.();setPositionEditor(null);}}
      onDeleted={async()=>{await refetchPortfolio?.();setPositionEditor(null);}}
    />
  </ErrorBoundary>
)}

{/* BulkImport — CSV / XLSX upload with merge-or-replace strategy. Shown
    from the "Bulk import" button in PositionsTable's action bar. */}
{showBulkImport&&portfolioAuthed&&(
  <ErrorBoundary label="Bulk import" onDismiss={()=>setShowBulkImport(false)}>
    <BulkImport
      userId={session?.user?.id}
      onClose={()=>setShowBulkImport(false)}
      onDone={async()=>{await refetchPortfolio?.();setShowBulkImport(false);}}
    />
  </ErrorBoundary>
)}

{/* ADMIN · UW API USAGE — gated by useIsAdmin() above. Task #30. */}
{tab==="admin" && <AdminUsage/>}

{/* ADMIN · BUGS — gated by useIsAdmin() above. Task #36. */}
{tab==="bugs" && <AdminBugs/>}

{/* SECTOR LAB — admin-gated experimental sandbox for sector-engine overlays.
    Read-only mirror of the live Sectors tab + cycle-stage chip prototype.
    Zero changes to live SectorsTab. Promotion = move one render line. */}
{tab==="lab" && <SectorLab/>}

{/* Unified Data & Methodology page — one searchable tile per upstream
    data stream (25 macro indicators + 8 scanner signals + 3 infra streams).
    Replaces the prior two-column FAQ + Indicator Reference + Data Freshness
    stack so there is one source of truth for "where does each number come
    from, how often does it update, and what does it power?". */}
{tab==="readme" && <MethodologyPage ind={IND} asOf={AS_OF} asOfIso={AS_OF_ISO} weights={WEIGHTS} cats={CATS} indFreq={IND_FREQ}/>}


{/* close fade-in wrapper around tab content */}
</div>

<Footer
  leftText={tab==="scanner"?"SOURCES · Unusual Whales · Yahoo Finance · SEC Form 4 · Congressional Disclosures":"SOURCES · FRED · CBOE · ICE BofA · FDIC · ISM · BLS · Shiller · Kim-Wright Fed · SLOOS Fed"}
  rightText="⚠ NOT INVESTMENT ADVICE · v10"
/>

</div>{/* close .app-main */}

{/* Global floating Report Bug button — visible to everyone, auth'd or not. */}
<ReportBug />

</div>
);
}
