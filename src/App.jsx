import { useState, useEffect } from "react";
import Scanner from "./Scanner";
import { useTheme, Hero, Tile, SectionHeader, Footer } from "./Shell";
import { InfoTip } from "./InfoTip";

const SD={
vix:{mean:19.5,sd:8.2,dir:"hw"},hy_ig:{mean:220,sd:95,dir:"hw"},
eq_cr_corr:{mean:0.38,sd:0.22,dir:"hw"},yield_curve:{mean:80,sd:95,dir:"nw"},
move:{mean:72,sd:28,dir:"hw"},anfci:{mean:0,sd:0.38,dir:"hw"},
stlfsi:{mean:0,sd:0.9,dir:"hw"},real_rates:{mean:0.5,sd:1.1,dir:"hw"},
sloos_ci:{mean:5,sd:18,dir:"hw"},cape:{mean:22,sd:7,dir:"hw"},
ism:{mean:52,sd:5.5,dir:"lw"},copper_gold:{mean:0.20,sd:0.03,dir:"lw"},
bkx_spx:{mean:0.13,sd:0.03,dir:"lw"},bank_unreal:{mean:5,sd:8,dir:"hw"},
credit_3y:{mean:7,sd:5,dir:"hw"},term_premium:{mean:40,sd:70,dir:"hw"},
cmdi:{mean:0.1,sd:0.35,dir:"hw"},loan_syn:{mean:6.2,sd:2.5,dir:"hw"},
usd:{mean:99,sd:7,dir:"hw"},cpff:{mean:10,sd:28,dir:"hw"},
skew:{mean:128,sd:12,dir:"hw"},sloos_cre:{mean:5,sd:20,dir:"hw"},
bank_credit:{mean:6.5,sd:3.2,dir:"lw"},jobless:{mean:340,sd:185,dir:"hw"},
jolts_quits:{mean:2.1,sd:0.42,dir:"lw"},
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
if(s<1.0) return"#ffd60a";   // Normal — yellow
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
// Low 0-20 | Normal 20-50 | Elevated 50-75 | Extreme 75-100
const CONVICTION=[
{level:1,label:"LOW",      range:[-99,0.25], color:"#30d158", eq:90,bd:5, ca:3, au:2,
 action:"Risk-on. Historically benign conditions. Consider adding cyclical beta."},
{level:2,label:"NORMAL",   range:[0.25,0.88],color:"#ffd60a", eq:75,bd:15,ca:7, au:3,
 action:"Market baseline. Maintain diversified exposure. Trim highest-beta on spikes."},
{level:3,label:"ELEVATED", range:[0.88,1.6], color:"#ff9f0a", eq:55,bd:28,ca:12,au:5,
 action:"Active hedging warranted. Sell covered calls. Rotate defensive. Reduce leverage."},
{level:4,label:"EXTREME",  range:[1.6,99],   color:"#ff453a", eq:20,bd:30,ca:35,au:15,
 action:"Crisis regime. Maximum defensiveness. Harvest losses. Hold dry powder."},
];
function getConv(s){return CONVICTION.find(c=>s>=c.range[0]&&s<c.range[1])||CONVICTION[3];}
// Theme-aware text color for conviction. Raw conviction colors (used for bars,
// borders, KPI numbers) are bright by design; when those same colors are
// applied to small text on a light surface the yellow becomes illegible.
// This swaps the NORMAL yellow for the deeper amber --yellow-text token.
function convTextColor(conv){return conv.color==="#ffd60a"?"var(--yellow-text)":conv.color;}
// Swap bright yellow (#ffd60a) for a theme-aware variant that stays
// legible on light backgrounds. Used anywhere an indicator/KPI/trend
// color is rendered directly as text on a light surface.
function yText(col){return(col==="#ffd60a"||col==="#FFD60A")?"var(--yellow-text)":col;}

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
};

const IND={
vix:["VIX","Equity Volatility","equity",1,"index",1,17.9,23.9,17.2,19.5,15.0,false,
"The CBOE Volatility Index measures expected 30-day S&P 500 volatility from live options prices. Known as the 'fear gauge' — higher = more fear, lower = calm.",
"Modestly below the long-run average (~19.5) and down meaningfully from 23.9 a month ago. Stress is fading. Watch for a sustained break above 30 (stress threshold) or 40 (crisis level)."],
hy_ig:["HY–IG Spread","Credit Risk Premium","credit",1,"bps",0,205.0,268,245,280,220,false,
"Spread between ICE BofA High Yield and Investment Grade bond yields. Measures extra return investors demand for credit risk.",
"Spreads have tightened ~55bps over the past month — markets not pricing significant default risk. Below 200bps = benign; above 400bps = significant stress."],
eq_cr_corr:["EQ–Credit Corr","Risk-Off Synchronization","equity",1,"corr",2,0.92,0.61,0.55,0.50,0.40,false,
"63-day rolling correlation between VIX and HY-IG spreads. When both move together, it signals a genuine risk-off regime rather than isolated noise.",
"Sharp jump in correlation — equities and credit are now moving as a single risk factor. Values above 0.6 indicate a true risk-off regime; this is a warning sign."],
yield_curve:["10Y–2Y Slope","Yield Curve","rates",1,"bps",0,54.0,52,35,15,-20,false,
"Difference between 10-year and 2-year Treasury yields. Inversion historically precedes recessions by 6–18 months.",
"Re-steepened after the deepest inversion since 1981 (-109bps in 2023). An improving signal, though bear steepening (long-end selling off) would be the wrong kind."],
move:["MOVE Index","Rates Volatility","rates",2,"index",0,66.0,98,95,90,85,false,
"Merrill Lynch Option Volatility Estimate: implied volatility of Treasury yields. The bond market's VIX.",
"Rates volatility has eased substantially from 98 a month ago. Now near the pre-2022 average of ~65 — borrowing-cost uncertainty has receded."],
anfci:["ANFCI","Chicago Fed Fin. Conditions","fincond",2,"z-score",2,-0.47,0.08,0.06,0.04,-0.05,false,
"Adjusted National Financial Conditions Index: composite of 105 indicators isolating pure financial stress.",
"Conditions have loosened sharply — among the most accommodative readings outside crisis-response periods. Negative = looser than the economy warrants."],
stlfsi:["STLFSI","St. Louis Fed Stress Index","fincond",2,"index",2,-0.65,0.22,0.18,0.12,-0.10,false,
"St. Louis Fed Financial Stress Index: 18 weekly data series. Zero = historical average stress.",
"Stress has receded to below-average levels. A sustained move above 1.0 would be concerning."],
real_rates:["10Y TIPS","Real Interest Rates","rates",2,"%",2,1.9,1.90,1.75,1.85,1.50,false,
"10-year TIPS yield — the real after-inflation rate. Represents the true cost of long-term borrowing.",
"Restrictive (historical avg ~0.5%). Compresses equity valuations especially growth stocks. Slow-moving — has held in this range for months."],
sloos_ci:["SLOOS C&I","Business Lending Standards","bank",2,"%",1,5.3,9.8,8.0,6.0,2.0,false,
"Senior Loan Officer Opinion Survey: net % of banks tightening C&I loan standards.",
"Net tightening has eased meaningfully from 9.8% a quarter ago. Well below crisis levels (GFC: 84%). Historically leads credit events by 1–2 quarters."],
cape:["Shiller CAPE","Cyclically Adj. P/E Ratio","equity",2,"ratio",1,34.2,35.1,33.8,31.5,29.8,true,
"S&P 500 price divided by 10-year average real earnings. Historical average ~17.",
"Elevated valuation — only exceeded in 1929 and the dot-com peak. Does not predict timing but predicts poor 10-year forward returns."],
ism:["ISM Mfg. PMI","Manufacturing Activity Index","labor",2,"index",1,52.7,52.4,52.6,49.8,47.9,true,
"ISM Manufacturing PMI: above 50 = expansion; below 50 = contraction.",
"Manufacturing in expansion territory and inflecting higher after a soft 2H 2025. A reading sustained above 52 would confirm a real cyclical upturn."],
copper_gold:["Copper/Gold Ratio","Real Economy vs. Safe Haven","labor",2,"ratio",3,0.126,0.098,0.108,0.112,0.152,true,
"Ratio of copper to gold futures. A falling ratio signals growth pessimism and risk-off sentiment.",
"At 0.126, ratio sits ~37% below its 0.20 historical mean — persistent safe-haven gold demand continues to overshadow copper. Ratio dipped to ~0.098 a month ago before copper's rally toward $6/lb drove a partial rebound. A sustained move back toward 0.15+ would signal improving growth confidence."],
bkx_spx:["BKX/SPX Ratio","Bank vs. Market Strength","bank",2,"ratio",3,0.09,0.086,0.103,0.097,0.090,true,
"KBW Bank Index divided by S&P 500. Bank weakness often signals coming broader stress.",
"KBE/SPY near 0.09, up from ~0.086 a month ago as banks rallied in early April. Ratio sits ~30% below its historical mean of 0.13 — banks continue to trade at a persistent structural discount to the broader market. A sustained drop below 0.08 would echo SVB-era stress (March 2023)."],
bank_unreal:["Bank Unreal. Loss","AFS+HTM Losses / Tier 1","bank",2,"% T1",1,19.9,19.5,20.8,22.1,18.5,true,
"Aggregate unrealized securities losses at FDIC-insured banks as % of Tier 1 regulatory capital.",
"Aggregate unrealized losses remain near recent highs (~$481B). SVB was at 104% before failure. No margin for error if long rates back up."],
credit_3y:["3Y Credit Growth","3-Year Bank Credit Expansion","bank",2,"% 3yr",1,4.5,11.8,12.5,13.2,12.8,true,
"Total bank credit growth over the prior 3 years. Measures buildup of system-wide credit fragility.",
"Steep slowdown from 11.8% a quarter ago. Below 5% historically signals tight credit conditions and reduced economic dynamism."],
term_premium:["Kim–Wright 10Y","10-Year Term Premium","rates",3,"bps",0,65.0,55,45,35,20,false,
"Fed model estimate of extra return for holding 10-year Treasuries vs. rolling short bills.",
"Risen steadily from QE-era depths — long-end investors demanding more compensation. Structural tightening independent of Fed policy."],
cmdi:["CMDI","Corp Bond Market Distress","credit",3,"index",2,0.03,0.38,0.30,0.25,0.12,false,
"Federal Reserve composite of corporate bond market functioning. Zero = normal.",
"Corporate bond market functioning normally — sharp improvement from 0.38 a month ago. A clear positive for credit availability."],
loan_syn:["HY Eff. Yield","High Yield Effective Yield","credit",3,"%",2,6.74,7.45,7.0,6.5,6.2,false,
"ICE BofA US High Yield Index Effective Yield. Proxy for leveraged loan market conditions.",
"Easing from 7.45% a month ago but still elevated vs. low-rate era (4–5%). Companies with near-term maturities face refinancing pressure."],
usd:["USD Index","Trade-Weighted Dollar","fincond",3,"index",1,98.3,101.0,102.5,101.8,101.0,false,
"Federal Reserve broad trade-weighted USD index. Strong dollar tightens global financial conditions.",
"Dollar has weakened ~3% over the past month from ~101 — eases global financial conditions and supports EM/commodity exposures. Above 106 = meaningfully tight."],
cpff:["USD Funding","3M CP vs. Fed Funds Spread","fincond",3,"bps",0,18.0,14,12,10,8,false,
"Spread between 3-month AA financial commercial paper and effective Fed Funds Rate.",
"Money markets functioning normally. GFC peak: 280bps; COVID: 65bps. Funding stress is absent."],
skew:["SKEW Index","Options-Implied Tail Risk","equity",3,"index",0,141.0,141,138,135,130,false,
"CBOE SKEW from relative pricing of far OTM S&P 500 puts. Measures priced probability of a crash.",
"Mildly elevated. Combined with moderate VIX, suggests quiet positioning for tail risk underneath an otherwise calm market."],
sloos_cre:["SLOOS CRE","CRE Lending Standards","bank",3,"%",1,8.9,18.3,15.0,12.0,8.0,false,
"Senior Loan Officer Opinion Survey: net % tightening Commercial Real Estate loan standards.",
"Net CRE tightening has more than halved from 18.3% a quarter ago — a meaningful easing. Office and retail still face funding squeeze."],
bank_credit:["Bank Credit","YoY Bank Credit Growth","bank",3,"% YoY",1,6.7,3.4,3.8,4.2,5.0,false,
"Year-over-year growth in total bank credit from the Federal Reserve H.8 release.",
"Credit growth has accelerated back to historical average (~6.5%) — well up from a stalled 3.4% a month ago. Supports business and consumer activity."],
jobless:["Init. Claims","Weekly Jobless Claims","labor",3,"K",0,207.0,224,215,210,208,false,
"Initial unemployment insurance claims. Most timely high-frequency labor market indicator.",
"Within healthy pre-COVID range of 200–250K. No recession signal. Watch for sustained moves above 250K."],
jolts_quits:["JOLTS Quits","Voluntary Quit Rate","labor",3,"%",1,1.9,2.3,2.35,2.45,2.55,false,
"Quits as % of total employment. Workers quit when confident about finding a better job.",
"Down sharply from a post-COVID high of 3.0% — workers less confident about finding a better job. Signals softening labor market."],
};

// Reporting frequency per indicator: D=Daily, W=Weekly, M=Monthly, Q=Quarterly
const IND_FREQ={
  vix:"Apr 16 2026",hy_ig:"Apr 15 2026",eq_cr_corr:"Apr 17 2026",yield_curve:"Apr 16 2026",move:"Apr 16 2026",
  anfci:"Apr 10 2026",stlfsi:"Apr 10 2026",real_rates:"Apr 15 2026",sloos_ci:"Jan 01 2026",cape:"Mar 2026",
  ism:"Mar 2026",copper_gold:"Apr 16 2026",bkx_spx:"Apr 16 2026",bank_unreal:"Q4 2025",credit_3y:"Apr 2026",
  term_premium:"Apr 10 2026",cmdi:"Apr 10 2026",loan_syn:"Apr 15 2026",usd:"Apr 16 2026",cpff:"Apr 14 2026",
  skew:"Apr 16 2026",sloos_cre:"Jan 01 2026",bank_credit:"Apr 01 2026",jobless:"Apr 11 2026",jolts_quits:"Feb 01 2026",
};

const WEIGHTS={
vix:1.5,hy_ig:1.5,eq_cr_corr:1.5,yield_curve:1.5,
move:1.2,anfci:1.2,stlfsi:1.2,real_rates:1.2,sloos_ci:1.2,
cape:1.2,ism:1.2,copper_gold:1.2,bkx_spx:1.2,bank_unreal:1.2,credit_3y:1.2,
term_premium:1.0,cmdi:1.0,loan_syn:1.0,usd:1.0,cpff:1.0,
skew:1.0,sloos_cre:1.0,bank_credit:1.0,jobless:1.0,jolts_quits:1.0,
};

const ACCENT="#4a6fa5";
const CATS={
equity:  {label:"Equity & Vol",        color:ACCENT},
credit:  {label:"Credit Markets",      color:ACCENT},
rates:   {label:"Rates & Duration",    color:ACCENT},
fincond: {label:"Financial Conditions",color:ACCENT},
bank:    {label:"Bank & Money Supply", color:ACCENT},
labor:   {label:"Labor & Economy",     color:ACCENT},
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

const NOW={},MO1={},MO3={};
Object.keys(IND).forEach(id=>{NOW[id]=IND[id][6];MO1[id]=IND[id][7];MO3[id]=IND[id][8];});
const COMP=compScore(NOW);
const COMP1M=compScore(MO1);
const COMP3M=compScore(MO3);
const COMP100=sdTo100(COMP);
const COMP1M100=sdTo100(COMP1M);
const COMP3M100=sdTo100(COMP3M);
// Velocity: change over 4 weeks (positive = stress rising)
const VEL=COMP-COMP1M;
const CONV=getConv(COMP);

// ── TREND SIGNAL ────────────────────────────────────────────────────────────
function trendSignal(vel){
if(vel>0.12) return{label:"Rising Fast",  arrow:"▲▲",col:"#ff453a"};
if(vel>0.05) return{label:"Rising",       arrow:"▲", col:"#ff9f0a"};
if(vel>0.02) return{label:"Edging Up",    arrow:"↗", col:"#ffd60a"};
if(vel<-0.12)return{label:"Easing Fast",  arrow:"▼▼",col:"#30d158"};
if(vel<-0.05)return{label:"Easing",       arrow:"▼", col:"#30d158"};
if(vel<-0.02)return{label:"Edging Down",  arrow:"↘", col:"#86efac"};
return              {label:"Stable",       arrow:"→", col:"var(--text-2)"};
}
const TREND_SIG=trendSignal(VEL);

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
["Apr 15",COMP100],
];

const COMP_CRISES=[
{label:"GFC",year:"Q4 '08",color:"#ff453a"},
{label:"COVID",year:"Q2 '20",color:"#ff9f0a"},
{label:"Rate Shock",year:"Q3 '22",color:"#ffd60a"},
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

function getIndicatorHistSeries(id){
if(!IND[id]||!SD[id])return null;
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
out.push(["2026",clampHistValue(id,piecewiseYearValue(2026.0,kf))]);
out.push(["Now",clampHistValue(id,IND[id][6])]);
return out;
}

const STRESS_HIST_BANDS=[
{lo:0,hi:20,col:"#30d158",label:"LOW"},
{lo:20,hi:50,col:"#ffd60a",label:"NORMAL"},
{lo:50,hi:75,col:"#ff9f0a",label:"ELEVATED"},
{lo:75,hi:100,col:"#ff453a",label:"EXTREME"},
];

// ── PORTFOLIO ───────────────────────────────────────────────────────────────
const ACCOUNTS=[
{id:"brokerage",label:"Taxable Brokerage",sub:"…4471",color:"#3b82f6",
note:"Taxable account — active trading, tax-loss harvesting, and macro-driven positioning.",
positions:[
{ticker:"SPY",  name:"SPDR S&P 500 ETF",          value:124500,price:548.20,shares:227,sector:"US Equity",  beta:1.00,color:ACCENT,
analysis:"Core equity holding at 41% of brokerage. At Normal (38/100), holding is appropriate. No reason to reduce until composite reaches Elevated (50+)."},
{ticker:"QQQ",  name:"Invesco Nasdaq-100 ETF",     value:52800, price:468.50,shares:113,sector:"Technology", beta:1.18,color:ACCENT,
analysis:"Tech/growth overweight at 17% of brokerage. High beta (1.18). Sensitive to real rates — any rise above 2.5% on TIPS would compress this significantly. First to trim if composite moves to Elevated."},
{ticker:"GLD",  name:"SPDR Gold ETF",              value:45600, price:429.41,shares:106,sector:"Commodity",  beta:0.08,color:ACCENT,
analysis:"Macro hedge at 15% of brokerage. Well-positioned at Normal — gold benefits from geopolitical uncertainty and real rate declines."},
{ticker:"BRK.B",name:"Berkshire Hathaway Class B", value:38200, price:478.20,shares:80, sector:"Financials", beta:0.85,color:ACCENT,
analysis:"Quality defensive at 13% of brokerage. Buffett's cash pile (~$325B) benefits in stress regimes. Appropriate at any conviction level. Hold."},
{ticker:"TLT",  name:"iShares 20+ Yr Treasury ETF",value:22100, price:92.30, shares:239,sector:"Long Bonds", beta:-0.25,color:ACCENT,
analysis:"Duration hedge at 7% of brokerage. Negative beta to equities — rallies when stocks sell off. If yield curve continues steepening, TLT will underperform. Keep modest."},
{ticker:"CASH", name:"Cash & Sweep Funds",         value:21800, price:1,     shares:21800,sector:"Cash",     beta:0.00,color:"var(--text-dim)",
analysis:"Cash buffer at 7% — appropriate sizing. Covers quarterly estimated tax payments and dry powder for opportunistic deployment."},
]},
{id:"k401",label:"401(k) — Target Date",sub:"Acct …8823",color:"#6366f1",
note:"Pre-tax retirement account. Diversified target-date fund approach, auto-rebalancing.",
positions:[
{ticker:"FXAIX",name:"Fidelity 500 Index Fund",    value:198400,price:229.32,shares:866,sector:"US Equity",  beta:1.00,color:ACCENT,
analysis:"Core 401k holding — S&P 500 index at 60% of account. Do not manage tactically. Contribute the maximum ($23,500 in 2026) and let compounding work."},
{ticker:"FXNAX",name:"Fidelity U.S. Bond Index",   value:72800, price:10.45, shares:6967,sector:"Bonds",     beta:0.05,color:ACCENT,
analysis:"Bond allocation at 22% of 401k. Appropriate age-based diversification. With the curve re-steepening, intermediate bonds are more attractive than during the prior inversion."},
{ticker:"FSGGX",name:"Fidelity Global ex-US Index", value:48200,price:15.82, shares:3048,sector:"Intl Equity",beta:0.88,color:ACCENT,
analysis:"International diversification at 15% of 401k. Recent dollar weakening helps this allocation; further USD softness would compound the tailwind."},
{ticker:"FXIIX",name:"Fidelity Inflation-Prot Bond",value:10600,price:10.22, shares:1037,sector:"TIPS",      beta:0.12,color:ACCENT,
analysis:"TIPS allocation at 3% — appropriate inflation hedge. With real rates restrictive, TIPS are paying a meaningful real yield."},
]},
{id:"roth",label:"Roth IRA",sub:"Acct …2290",color:"#30d158",
note:"Tax-free growth account — best placement for highest-return, longest-duration assets.",
positions:[
{ticker:"VGT",  name:"Vanguard Info Technology ETF",value:28400,price:582.30,shares:49, sector:"Technology",beta:1.22,color:ACCENT,
analysis:"High-growth tech ETF in Roth — ideal placement. Tax-free compounding on a high-return sector. If composite reaches Elevated, trim to 50%; reinstate on pullback."},
{ticker:"FBTC", name:"Fidelity Bitcoin ETF",         value:14200,price:58.36, shares:243,sector:"Crypto",    beta:2.20,color:ACCENT,
analysis:"Bitcoin ETF at 34% of Roth — aggressive but appropriate in a tax-free account. High beta (2.20). Do not add at Elevated+ stress levels."},
{ticker:"ARKK", name:"ARK Innovation ETF",           value:8900, price:58.75, shares:151,sector:"Disruptive",beta:1.65,color:ACCENT,
analysis:"Speculative disruptive growth at 21% of Roth. Can drawdown 60%+ in stress regimes. Appropriate in Roth at this sizing."},
{ticker:"SPAXX",name:"Fidelity Govt Money Market",   value:7400, price:1.00,  shares:7400,sector:"Cash",     beta:0.00,color:"var(--text-dim)",
analysis:"Cash in Roth at 18% of account — too high. Deploy into VGT or a broad index. Keep only $1,000–2,000 as a buffer."},
]},
{id:"529a",label:"529 Plan — Child 1 (Age 8)",sub:"Acct …5512",color:"#ff9f0a",
note:"College savings — 10-year horizon to enrollment. Moderate equity glide path appropriate.",
positions:[
{ticker:"FZILX",name:"Fidelity ZERO Intl Index",value:22400,price:14.20,shares:1577,sector:"Intl Equity",beta:0.85,color:ACCENT,
analysis:"0% expense ratio international index. 10-year horizon provides enough runway. Consider shifting to a target-enrollment 2035 fund within 3 years."},
{ticker:"FXAIX",name:"Fidelity 500 Index Fund", value:14600,price:229.32,shares:64, sector:"US Equity", beta:1.00,color:ACCENT,
analysis:"US equity core at 39% of 529. Age-8 child has 10-year horizon. Begin adding a bond allocation (target 20%) in 3–4 years."},
]},
{id:"hsa",label:"Health Savings Account",sub:"Acct …7734",color:"#00d4a0",
note:"Triple tax-advantaged — contribute max ($8,550 family 2026), invest long-term, never withdraw if possible.",
positions:[
{ticker:"FXAIX",name:"Fidelity 500 Index Fund",    value:31200,price:229.32,shares:136,sector:"US Equity",beta:1.00,color:ACCENT,
analysis:"S&P 500 index in HSA — correct. Maximize contributions for 20 years and this could compound to $500K+. Never withdraw."},
{ticker:"FDRXX",name:"Fidelity Govt Money Market", value:4800, price:1.00,  shares:4800,sector:"Cash",   beta:0.00,color:"var(--text-dim)",
analysis:"Cash buffer in HSA at 13% — slightly high. Keep $1,500–2,000 for near-term co-pays; deploy the rest into FXAIX."},
]},
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

function ChartCore({data,labels,dir,sdP,crisisData,col,fmtFn,H,pL,pR,pT,pB,W,id}){
const [hover,setHover]=useState(null);
const IW=W-pL-pR,IH=H-pT-pB;
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
const hZone=sdP?(()=>{
const lo=sdP.mean-sdP.sd*0.5,hi=sdP.mean+sdP.sd*0.5;
const y1=yp(Math.min(lo,hi)),y2=yp(Math.max(lo,hi));
return{y:Math.min(y1,y2),h:Math.abs(y2-y1)};
})():null;
const marks=crisisData.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year||l.startsWith(cm.year));
if(idx<0)return null;
return{...cm,x:xp(idx),y:yp(data[idx][1]),v:data[idx][1]};
}).filter(Boolean);
const tickEvery=data.length>40?16:4;
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%tickEvery===0);
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
<path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill={col} stroke="var(--bg)" strokeWidth="1.5"/>
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

function LongChart({id,col}){
const data=getIndicatorHistSeries(id);if(!data)return null;
const sd=SD[id];
const unit=IND[id]?.[4]||"",dec=IND[id]?.[5]??1;
const fmt=v=>{
if(unit==="K")return`${Math.round(v)}K`;
if(unit==="bps")return`${Math.round(v)}bps`;
if(unit==="z-score")return(v>0?"+":"")+Number(v).toFixed(dec);
if(["% T1","% 3yr","% YoY","%"].includes(unit))return`${Number(v).toFixed(dec)}%`;
return Number(v).toFixed(dec);
};
const labels=data.map(d=>String(d[0]));
return(
<div style={{marginBottom:10}}>
<div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",marginBottom:4}}>
LONG-TERM HISTORY
<span style={{color:"rgba(34,197,94,0.7)",marginLeft:6}}>▬ normal range</span>
</div>
<ChartCore data={data} labels={labels} dir={sd?.dir} sdP={sd} crisisData={COMP_CRISES}
col={col} fmtFn={fmt} H={100} pL={28} pR={8} pT={18} pB={22} W={500} id={id}/>
</div>
);
}

function CompHistChart(){
const col=CONV.color;
const data=COMP_HIST;
const labels=data.map(d=>String(d[0]));
const W=500,H=130,pL=28,pR=48,pT=18,pB=24;
const IW=W-pL-pR,IH=H-pT-pB;
const [hover,setHover]=useState(null);
const vals=data.map(d=>d[1]);
// S&P scale — padded 10% above/below for visual breathing room
const spVals=SP500_HIST.slice(0,data.length);
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
{/* Legend */}
<div style={{display:"flex",gap:14,marginBottom:6,paddingLeft:4}}>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<div style={{width:16,height:2.5,borderRadius:2,background:col}}/>
<span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>Composite Stress (L)</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<div style={{width:16,height:2.5,borderRadius:2,background:SP_COL,opacity:0.8}}/>
<span style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>S&P 500 (R)</span>
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
const data=getIndicatorHistSeries(id);
if(!data||data.length<3)return null;
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
const valsStress=data.map(([,v])=>{const s=sdScore(id,v);return s==null?null:sdTo100(s);});
const W=compact?320:500,H=compact?86:115,pL=compact?22:24,pR=compact?38:44,pT=compact?11:14,pB=compact?18:22;
const IW=W-pL-pR,IH=H-pT-pB;
const [hover,setHover]=useState(null);
const xp=i=>pL+(i/(data.length-1))*IW;
const yp=v=>pT+(1-Math.max(0,Math.min(100,v))/100)*IH;
const pts=data.map((d,i)=>{
const st=valsStress[i];
return[xp(i),yp(st==null?50:st)];
});
const fullPath=makePath(pts);
const recentPath=makePath(pts.slice(-3));
const marks=COMP_CRISES.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year);
if(idx<0)return null;
const st=valsStress[idx];
return{...cm,x:xp(idx),y:yp(st==null?50:st),raw:data[idx][1]};
}).filter(Boolean);
const tickEvery=data.length>40?16:4;
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%tickEvery===0);
const lastPt=pts[pts.length-1];
const lastStress=valsStress[valsStress.length-1];
const handleInteract=e=>{
e.stopPropagation();
const svg=e.currentTarget,rect=svg.getBoundingClientRect();
const cx=e.touches?e.touches[0].clientX:e.clientX;
const svgX=((cx-rect.left)/rect.width)*W;
let best=0,bestD=Infinity;
pts.forEach(([px],i)=>{const d0=Math.abs(px-svgX);if(d0<bestD){bestD=d0;best=i;}});
const raw=data[best][1];
const st=valsStress[best];
setHover({x:pts[best][0],y:pts[best][1],label:labels[best],raw,st});
};
const ttX=hover?Math.min(Math.max(hover.x,pL+28),W-pR-28):0;
const ttY=hover?(hover.y<pT+22?hover.y+16:hover.y-16):0;
return(
<div onClick={e=>e.stopPropagation()}>
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"pan-y"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{STRESS_HIST_BANDS.map(b=>(
<g key={b.label}>
<rect x={pL} y={yp(b.hi)} width={IW} height={yp(b.lo)-yp(b.hi)} fill={b.col} opacity="0.07"/>
<text x={pL+IW+2} y={yp((b.lo+b.hi)/2)+3} fill={b.col} fontSize={compact?4.5:5} fontFamily="monospace" opacity="0.7">{b.label}</text>
</g>
))}
{[0,20,50,75,100].map(v=>(
<g key={v}>
<line x1={pL-2} y1={yp(v)} x2={pL} y2={yp(v)} stroke="#505050" strokeWidth="0.5"/>
<text x={pL-4} y={yp(v)+3} textAnchor="end" fill="var(--text-dim)" fontSize={compact?5:6} fontFamily="monospace">{v}</text>
</g>
))}
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

function IndicatorTrendPills({id,d}){
// Compact trend strip: just period label + value. The current value lives in
// the card/modal header — no need for a separate NOW pill, and the small
// delta numbers under each reading were noise. Order is short→long
// (1M, 3M, 6M, 12M) so the eye reads recent-to-historical left-to-right.
const rows=[
["1M",d[7]],["3M",d[8]],["6M",d[9]],["12M",d[10]],
];
return(
<div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
{rows.map(([lbl,v])=>{
if(v==null)return null;
const cT=sdTextColor(sdScore(id,v));
return(
<div key={lbl} style={{flex:1,minWidth:56,background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:5,padding:"5px 6px",textAlign:"center"}}>
<div style={{fontSize:9,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:2,letterSpacing:"0.06em"}}>{lbl}</div>
<div style={{fontSize:14,fontWeight:800,color:cT,fontFamily:"monospace"}}>{fmtV(id,v)}</div>
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
const tierBorder=tier===1?"#ffd60a":tier===2?"#94a3b8":"#4b5563";
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
<span style={{fontSize:11,color:tierCol,border:`1px solid ${tierBorder}44`,borderRadius:2,padding:"1px 5px",fontFamily:"monospace",flexShrink:0}}>T{tier}</span>
<span style={{fontSize:11,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:2,padding:"1px 5px",fontFamily:"monospace",flexShrink:0}}>{IND_FREQ[id]||"—"}</span>
</div>
<div style={{fontSize:13,color:"var(--text-muted)",marginLeft:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>
<div style={{fontSize:11,color:"var(--text-dim)",marginLeft:9,fontFamily:"monospace"}}>{AS_OF[id]||"—"}</div>
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
const tierBorder=tier===1?"#ffd60a":tier===2?"#94a3b8":"#4b5563";
const sp=SD[id];
const allV=[cur,m1,m3,m6,m12].filter(v=>v!=null);
const sMin=allV.length?Math.min(...allV):null;
const sMax=allV.length?Math.max(...allV):null;
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
            <span style={{fontSize:10,color:tierCol,border:`1px solid ${tierBorder}55`,borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)",fontWeight:600}}>TIER {tier}</span>
            <span style={{fontSize:10,color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 6px",fontFamily:"var(--font-mono)"}}>{IND_FREQ[id]||"—"}</span>
          </div>
          <div style={{fontSize:13,color:"var(--text-muted)",marginBottom:2}}>{sub}</div>
          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{CATS[cat]?.label||cat} · As of {AS_OF[id]}</div>
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
            <span style={{color:"var(--text-dim)"}}>avg <span style={{color:"#30d158"}}>{fmtV(id,sp.mean)}</span> · elev <span style={{color:"#ff9f0a"}}>{fmtV(id,sp.mean+sp.sd)}</span> · ext <span style={{color:"#ff453a"}}>{fmtV(id,sp.mean+sp.sd*2)}</span></span>
          </div>
          <RangeBar sMin={sMin} sMax={sMax} sp={sp} cur={cur} col={col}/>
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

function PosCard({p,accountTotal,convColor,convLabel,stressScore}){
const [exp,setExp]=useState(false);
const pct=(p.value/accountTotal*100).toFixed(1);
const bCol=p.beta>1.5?"#ff453a":p.beta>1.0?"#ff9f0a":p.beta>0.5?"#ffd60a":"#30d158";
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
<div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"monospace"}}>${p.value.toLocaleString()}</div>
<div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>{pct}% of acct</div>
</div>
</div>
<div style={{display:"flex",gap:10,marginBottom:5,flexWrap:"wrap"}}>
{[{l:"Price",v:`$${p.price}`},{l:"Qty",v:p.shares<100?p.shares:Math.round(p.shares)},{l:"Beta",v:p.beta.toFixed(2),c:bCol},{l:"Sector",v:p.sector}].map(({l,v,c})=>(
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
const [open,setOpen]=useState(true);
const total=acct.positions.reduce((a,p)=>a+p.value,0);
const pctOfTotal=(total/grandTotal*100).toFixed(1);
return(
<div style={{background:"var(--surface)",border:`1px solid ${ACCENT}33`,borderRadius:8,overflow:"hidden"}}>
<div onClick={()=>setOpen(o=>!o)} style={{padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
<div style={{width:8,height:8,borderRadius:"50%",background:acct.color,flexShrink:0}}/>
<span style={{fontSize:14,fontWeight:700,color:"var(--text)",fontFamily:"monospace"}}>{acct.label}</span>
<span style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace"}}>{acct.sub}</span>
</div>
<div style={{fontSize:11,color:"var(--text-2)",marginLeft:16,lineHeight:1.5}}>{acct.note}</div>
</div>
<div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
<div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"monospace"}}>${total.toLocaleString()}</div>
<div style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>{pctOfTotal}% of wealth</div>
<div style={{fontSize:12,color:"var(--text-2)"}}>{open?"▲":"▼"}</div>
</div>
</div>
<div style={{display:"flex",height:4,margin:"0 14px 10px"}}>
{acct.positions.map(p=>(<div key={p.ticker} style={{flex:p.value/total,background:ACCENT,opacity:0.6}}/>))}
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
const DS={};
Object.keys(IND).forEach(k=>{DS[k]=sdScore(k,IND[k][6]);});

const FACTOR_SCORES={
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

// ── MAIN APP ─────────────────────────────────────────────────────────────────
const TAB_IDS=["home","overview","indicators","sectors","portfolio","scanner","readme"];

// Map tabs → human metadata for the Shell SectionHeader
const TAB_META={
  overview:  {eyebrow:"Macro Dashboard",      title:"Today's macro overview",  sub:"Composite stress, regime, category breakdown, and the historical stress trajectory."},
  indicators:{eyebrow:"All Indicators",       title:"Calibrated indicators",sub:"Each indicator is normalized against its long-run mean and standard deviation. Filter by category."},
  sectors:   {eyebrow:"Sector Outlook",       title:"Sector heat map",         sub:"Each sector is scored from its subsector sensitivity to 8 macro factors."},
  portfolio: {eyebrow:"Sample Portfolio",     title:"Portfolio insights",      sub:"For illustration only. Shows how the macro regime maps to position-level analysis."},
  scanner:   {eyebrow:"Trading Scanner",      title:"Daily opportunity scan",  sub:"Runs at 3:45 PM ET on weekdays. Buy alerts (60+), watch list (35+), covered-call setups."},
  readme:    {eyebrow:"FAQ & Methodology",    title:"How this works",          sub:"Sources, methodology, and the meaning of every score, regime, and signal."},
};

export default function App(){
const [tab,setTab]=useState(()=>{
if(typeof window==="undefined")return"home";
const h=(window.location.hash||"").slice(1);
return TAB_IDS.includes(h)?h:"home";
});
useEffect(()=>{window.location.hash=tab;},[tab]);
useEffect(()=>{window.scrollTo({top:0,behavior:"smooth"});},[tab]);
// Keep tab in sync with URL hash so browser back/forward and manual hash edits work.
useEffect(()=>{
  const onHashChange=()=>{
    const h=(window.location.hash||"").slice(1);
    if(TAB_IDS.includes(h)&&h!==tab)setTab(h);
  };
  window.addEventListener("hashchange",onHashChange);
  return()=>window.removeEventListener("hashchange",onHashChange);
},[tab]);

// ─── Navigation stack — so the drill-down back button returns to the
//     previous tab (e.g. Overview → Indicators → Back → Overview) rather
//     than always jumping to Home. ────────────────────────────────────
const [tabHistory,setTabHistory]=useState([]);
const navTo=(next)=>{
  if(next===tab)return;
  setTabHistory(h=>[...h,tab]);
  setTab(next);
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
const [scanData,setScanData]=useState(null);
const [scanError,setScanError]=useState(false);
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

const grandTotal=ACCOUNTS.reduce((a,acc)=>a+acc.positions.reduce((b,p)=>b+p.value,0),0);
const portBeta=ACCOUNTS.flatMap(acc=>acc.positions).reduce((a,p)=>a+(p.value/grandTotal)*p.beta,0);
const assetRollup={};
ACCOUNTS.flatMap(acc=>acc.positions).forEach(p=>{
const cls=p.sector==="Cash"?"Cash":["GLD","SLV"].includes(p.ticker)?"Precious Metals":["FBTC","ETHE"].includes(p.ticker)?"Crypto":p.sector==="Intl Equity"?"Intl Equity":["FXAIX","FSKAX","FZILX","FSGGX"].includes(p.ticker)?"Index Funds":"Individual Stocks";
assetRollup[cls]=(assetRollup[cls]||0)+p.value;
});
const rollupColors={"Index Funds":"#4a6fa5","Intl Equity":"#6366f1","Individual Stocks":"#ff9f0a","Precious Metals":"#ffd60a","Crypto":"#a855f7","Cash":"var(--text-dim)"};

// ── Tile-grid home view computations ─────────────────────────────────────────
const buyCount = scanData?.buy_opportunities?.length || 0;
const watchCount = scanData?.watch_items?.length || 0;
const portCount = scanData?.portfolio_positions?.length || 0;
const lastScanLabel = scanData?.date_label || "—";
const compactNarrative = `Composite ${COMP100}/100 · ${TREND_SIG.label}`;

// Category quick-scores for the Indicators tile
const catScores = Object.entries(CATS).map(([catId,cat])=>{
  const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
  const scored=ids.map(id=>sdScore(id,IND[id][6])).filter(x=>x!=null);
  const avg=scored.length?scored.reduce((a,b)=>a+b,0)/scored.length:0;
  return {id:catId, label:cat.label, sc100:Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100))), col:sdColor(avg)};
});

return(
<div style={{minHeight:"100vh",color:"var(--text)",fontFamily:"var(--font-ui)"}}>

<Hero
  pref={pref}
  setPref={setPref}
  regime={{label:CONV.label, color:CONV.color}}
  score={COMP100}
  narrativeOneLine={compactNarrative}
  compact={tab!=="home"}
/>

{/* ─────── HOME — TILE GRID ─────── */}
{tab==="home" && (
  <main className="fade-in main-padded" style={{maxWidth:1440, margin:"0 auto", padding:"var(--space-4) var(--space-8) var(--space-10)"}}>
    <div className="home-tile-grid" style={{
      display:"grid",
      gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",
      gap:"var(--space-5)",
    }}>
      <Tile
        eyebrow="Today's Snapshot"
        title="Macro Overview"
        sub={`Composite stress at ${COMP100}/100 — regime is ${CONV.label}, ${TREND_SIG.label.toLowerCase()}. Here's what's driving it:`}
        accent={CONV.color}
        span={2}
        kpi={{value:COMP100, unit:"/ 100", color:CONV.color, delta:`${TREND_SIG.arrow} ${TREND_SIG.label}`, deltaColor:TREND_SIG.col}}
        status={{label:CONV.label, color:CONV.color}}
        onClick={()=>navTo("overview")}
      >
        <div style={{display:"flex", flexDirection:"column", gap:10, marginTop:"var(--space-3)"}}>
          {buildMacroBullets().map((b,i)=>(
            <div key={i} style={{display:"flex", gap:10, alignItems:"flex-start"}}>
              <div style={{width:8, height:8, borderRadius:"50%", background:b.color, flexShrink:0, marginTop:6, boxShadow:`0 0 0 3px ${b.color}22`}}/>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8, marginBottom:2}}>
                  <span style={{fontSize:13, fontWeight:600, color:"var(--text)"}}>{b.label}</span>
                  <span className="num" style={{fontSize:12, fontWeight:700, color:b.color, fontFamily:"var(--font-mono)"}}>{b.sc100}/100</span>
                </div>
                <div style={{fontSize:12, color:"var(--text-muted)", lineHeight:1.5}}>{b.why}</div>
              </div>
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        eyebrow="Trading Scanner"
        title="Daily Opportunities"
        sub={`Latest scan: ${lastScanLabel}`}
        accent="#30d158"
        kpi={{value:buyCount, unit:"buy alerts", color:buyCount>0?"#30d158":"var(--text-muted)"}}
        onClick={()=>navTo("scanner")}
      >
        <div style={{display:"flex", gap:8, marginTop:"var(--space-2)", flexWrap:"wrap"}}>
          <div style={{flex:1, minWidth:90, padding:"10px 12px", background:"var(--surface-3)", borderRadius:"var(--radius-sm)", border:"1px solid var(--border-faint)"}}>
            <div style={{fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)", letterSpacing:"0.06em", marginBottom:3}}>WATCH</div>
            <div className="num" style={{fontSize:20, fontWeight:700, color:"var(--yellow-text)"}}>{watchCount}</div>
          </div>
          <div style={{flex:1, minWidth:90, padding:"10px 12px", background:"var(--surface-3)", borderRadius:"var(--radius-sm)", border:"1px solid var(--border-faint)"}}>
            <div style={{fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)", letterSpacing:"0.06em", marginBottom:3}}>HELD</div>
            <div className="num" style={{fontSize:20, fontWeight:700, color:"var(--accent)"}}>{portCount}</div>
          </div>
        </div>
      </Tile>

      <Tile
        eyebrow="All Indicators"
        title="Calibrated signals"
        accent="var(--accent)"
        onClick={()=>navTo("indicators")}
      >
        <div style={{display:"flex", gap:8, marginTop:"var(--space-3)", flexWrap:"wrap"}}>
          {catScores.map(c=>(
            <span key={c.id} style={{
              fontSize:13, padding:"6px 14px", borderRadius:999,
              background:`${c.col}1a`, color:c.col, border:`1px solid ${c.col}33`,
              fontFamily:"var(--font-mono)", fontWeight:600,
            }}>{c.label.split(" ")[0]} {c.sc100}</span>
          ))}
        </div>
      </Tile>

      <Tile
        eyebrow="Sector Outlook"
        title="Sectors heat map"
        sub="Subsector sensitivity to 8 macro factors. Re-ranked live as data refreshes."
        accent="#bf5af2"
        onClick={()=>navTo("sectors")}
      />

      <Tile
        eyebrow="Sample Portfolio"
        title="Portfolio insights"
        sub={`Total: $${(grandTotal/1000).toFixed(0)}K · Beta ${portBeta.toFixed(2)} · ${CONV.label} regime`}
        accent="#0a84ff"
        kpi={{value:`$${(grandTotal/1000).toFixed(0)}`, unit:"K", color:"var(--text)"}}
        onClick={()=>navTo("portfolio")}
      />

      <Tile
        eyebrow="Methodology"
        title="How it works"
        sub="Sources, scoring, regimes, and what every signal means."
        accent="var(--text-dim)"
        onClick={()=>navTo("readme")}
      />
    </div>
  </main>
)}

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
<div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:12,maxWidth:980,margin:"0 auto"}}>

<div>
<div style={{fontSize:14,color:"var(--text-muted)",lineHeight:1.7}}>Monitors economic and financial stress indicators across six categories, producing a composite stress score and four-regime conviction framework. <span style={{color:ACCENT,cursor:"pointer"}} onClick={()=>navTo("readme")}>See FAQ →</span> · <span style={{color:ACCENT,cursor:"pointer"}} onClick={()=>navTo("scanner")}>View Scanner →</span></div>
</div>

{/* Narrative + Composite dial + Category bars */}
<div style={{background:"var(--surface)",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"16px"}}>
<div style={{fontSize:13,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:10}}>SUMMARY OF CURRENT MACRO ENVIRONMENT</div>
<div style={{fontSize:14,color:"var(--text)",lineHeight:1.85,marginBottom:16}}>{buildMacroNarrative()}</div>
<div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
<div style={{flexShrink:0}}>
<Gauge score={COMP}/>
</div>
<div style={{flex:1,paddingTop:4}}>
{Object.entries(CATS).map(([catId,cat])=>{
const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
const scored=ids.map(id=>sdScore(id,IND[id][6])).filter(x=>x!=null);
const avg=scored.length?scored.reduce((a,b)=>a+b,0)/scored.length:0;
const sc100=Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100)));
const col=sdColor(avg);
return(
<div key={catId} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer"}} onClick={()=>{navTo("indicators");setCatFilter(catId);}}>
<span style={{fontSize:12,color:"var(--text)",fontFamily:"monospace",minWidth:108,whiteSpace:"nowrap"}}>{cat.label}</span>
<div style={{flex:1,height:7,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
<div style={{width:`${sc100}%`,height:"100%",background:col,borderRadius:3}}/>
</div>
<span style={{fontSize:13,fontWeight:700,color:col,fontFamily:"monospace",minWidth:26,textAlign:"right"}}>{sc100}</span>
</div>
);
})}
</div>
</div>
</div>

{/* Historical Chart */}
<div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"16px"}}>
<div style={{fontSize:12,color:"var(--text-muted)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:10}}>COMPOSITE STRESS HISTORY</div>
<CompHistChart/>
</div>

{/* Category tiles 2-col grid */}
<div className="two-col-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
{Object.entries(CATS).map(([catId,cat])=>{
const ids=Object.keys(IND).filter(id=>IND[id][2]===catId);
const scored=ids.map(id=>({id,s:sdScore(id,IND[id][6])})).filter(x=>x.s!=null).sort((a,b)=>b.s-a.s);
const avg=scored.length?scored.reduce((a,b)=>a+b.s,0)/scored.length:0;
const sc100=Math.round(Math.max(0,Math.min(100,((avg+2)/5)*100)));
const col=sdColor(avg);
const trend=TREND[catId];
return(
<div key={catId} onClick={()=>{navTo("indicators");setCatFilter(catId);}} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"12px 14px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
<div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{cat.label}</div>
<div style={{fontSize:22,fontWeight:800,color:col,fontFamily:"monospace",lineHeight:1}}>{sc100}</div>
</div>
<div style={{height:4,background:"var(--border)",borderRadius:2,overflow:"hidden",marginBottom:8}}>
<div style={{width:`${sc100}%`,height:"100%",background:col,borderRadius:2}}/>
</div>
{trend&&<div style={{display:"flex",gap:4,marginBottom:8}}>
{[["1M",trend.m1],["6M",trend.m6],["12M",trend.m12]].map(([lbl,prior])=>{
const ta=trendArrow(sc100,prior);
return(<div key={lbl} style={{background:"var(--border-faint)",borderRadius:3,padding:"2px 6px",display:"flex",alignItems:"center",gap:2}}>
<span style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace"}}>{lbl}</span>
<span style={{fontSize:11,color:yText(ta.col),fontFamily:"monospace"}}>{ta.arrow}{sc100>prior?"+":""}{sc100-prior}</span>
</div>);
})}
</div>}
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{scored.slice(0,2).map(({id,s})=>{
const c2=sdColor(s);
return(<div key={id} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontSize:12,color:"var(--text-muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"65%"}}>{IND[id][0]}</span>
<span style={{fontSize:12,color:c2,fontFamily:"monospace",flexShrink:0}}>{sdLabel(s)}</span>
</div>);
})}
</div>
</div>
);
})}
</div>

</div>
)}

{/* INDICATORS */}
{tab==="indicators"&&(
<div style={{padding:"12px 20px"}}>
<div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
<button onClick={()=>setCatFilter(null)} style={{padding:"5px 14px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:13,fontFamily:"monospace",background:!catFilter?"var(--accent)":"transparent",color:!catFilter?"#fff":"var(--text)",borderColor:!catFilter?"var(--accent)":"var(--border)",fontWeight:!catFilter?700:500}}>ALL</button>
{Object.entries(CATS).map(([catId,cat])=>(
<button key={catId} onClick={()=>setCatFilter(catFilter===catId?null:catId)} style={{padding:"5px 14px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:13,fontFamily:"monospace",background:catFilter===catId?ACCENT+"22":"transparent",color:catFilter===catId?ACCENT:"var(--text)",borderColor:catFilter===catId?ACCENT:"var(--border)"}}>{cat.label}</button>
))}
</div>
<div style={{fontSize:12,color:"var(--text-dim)",fontFamily:"monospace",marginBottom:10}}>Frequency: D = Daily · W = Weekly · M = Monthly · Q = Quarterly</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:9,alignItems:"start"}}>
{visibleIds.map(id=>(<IndicatorCard key={id} id={id} onOpen={setExpandedId}/>))}
</div>
{expandedId&&IND[expandedId]&&(()=>{
  const idx=visibleIds.indexOf(expandedId);
  // If the currently-expanded id isn't in visibleIds (shouldn't happen
  // given the useEffect above, but belt-and-suspenders) still render the
  // modal but hide the prev/next chrome.
  const hasPrev=idx>0;
  const hasNext=idx>=0&&idx<visibleIds.length-1;
  return(<IndicatorModal id={expandedId} onClose={()=>setExpandedId(null)} onPrev={()=>hasPrev&&setExpandedId(visibleIds[idx-1])} onNext={()=>hasNext&&setExpandedId(visibleIds[idx+1])} hasPrev={hasPrev} hasNext={hasNext}/>);
})()}
</div>
)}

{tab==="sectors"&&<SectorsTab/>}

{/* PORTFOLIO */}
{tab==="portfolio"&&(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:12}}>
<div style={{background:"var(--surface)",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:11,color:convTextColor(CONV),fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>PORTFOLIO INSIGHTS · SAMPLE PORTFOLIO · FOR ILLUSTRATION ONLY</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginBottom:12}}>
{[{label:"Total Wealth",value:`$${grandTotal.toLocaleString()}`,col:"var(--text)"},{label:"Accounts",value:"5 accounts",col:"var(--text)"},{label:"Port. Beta",value:portBeta.toFixed(2),col:portBeta>1.2?"#ff9f0a":portBeta>0.8?"var(--yellow-text)":"#30d158"},{label:"Macro Regime",value:`${CONV.label} ${TREND_SIG.arrow}`,col:convTextColor(CONV)}].map(({label,value,col})=>(
<div key={label} style={{background:"var(--surface-2)",borderRadius:5,padding:"10px 12px"}}>
<div style={{fontSize:10,color:"var(--text-2)",fontFamily:"monospace",marginBottom:4}}>{label.toUpperCase()}</div>
<div style={{fontSize:14,fontWeight:800,color:col,fontFamily:"monospace"}}>{value}</div>
</div>
))}
</div>
<div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:6}}>WEALTH BY ACCOUNT</div>
<div style={{display:"flex",height:30,borderRadius:5,overflow:"hidden",marginBottom:12}}>
{ACCOUNTS.map(acc=>{
const t=acc.positions.reduce((a,p)=>a+p.value,0);
const pct=t/grandTotal;
const ACCT_LABEL={brokerage:"Taxable",k401:"401k",roth:"Roth",hsa:"HSA","529":"529"};
const name=ACCT_LABEL[acc.id]||acc.label.split(" ")[0];
return(<div key={acc.id} style={{flex:pct,background:acc.color,opacity:0.85,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 6px",overflow:"hidden"}}>
{pct>0.08?<span style={{fontSize:12,color:"#fff",fontFamily:"monospace",fontWeight:700,letterSpacing:"0.02em",textShadow:"0 1px 2px rgba(0,0,0,0.35)",whiteSpace:"nowrap"}}>{name} {(pct*100).toFixed(0)}%</span>:pct>0.04?<span style={{fontSize:11,color:"#fff",fontFamily:"monospace",fontWeight:700,textShadow:"0 1px 2px rgba(0,0,0,0.35)",whiteSpace:"nowrap"}}>{(pct*100).toFixed(0)}%</span>:null}
</div>);
})}
</div>
<div style={{fontSize:11,color:"var(--text-2)",fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:6}}>ASSET CLASS MIX</div>
<div style={{display:"flex",height:30,borderRadius:5,overflow:"hidden",marginBottom:8}}>
{Object.entries(assetRollup).sort((a,b)=>b[1]-a[1]).map(([cls,val])=>{
const pct=val/grandTotal;
const ABBR={"Individual Stocks":"Ind Stks","Index Funds":"Idx Funds","Intl Equity":"Int'l Stks","Precious Metals":"Metals","Crypto":"Crypto","Cash":"Cash"};
const label=ABBR[cls]||cls;
return(<div key={cls} style={{flex:pct,background:rollupColors[cls]||"#5c6370",opacity:0.9,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px",overflow:"hidden"}}>
{pct>0.08?<span style={{fontSize:11,color:"#fff",fontFamily:"monospace",fontWeight:700,letterSpacing:"0.02em",textShadow:"0 1px 2px rgba(0,0,0,0.35)",whiteSpace:"nowrap"}}>{label} {(pct*100).toFixed(0)}%</span>:pct>0.04?<span style={{fontSize:11,color:"#fff",fontFamily:"monospace",fontWeight:700,textShadow:"0 1px 2px rgba(0,0,0,0.35)",whiteSpace:"nowrap"}}>{(pct*100).toFixed(0)}%</span>:null}
</div>);
})}
</div>
<div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
{Object.entries(assetRollup).sort((a,b)=>b[1]-a[1]).map(([cls,val])=>(
<div key={cls} style={{display:"flex",alignItems:"center",gap:5}}>
<div style={{width:8,height:8,borderRadius:"50%",background:rollupColors[cls]||"#5c6370"}}/>
<span style={{fontSize:12,color:"var(--text)",fontFamily:"monospace"}}>{cls} {(val/grandTotal*100).toFixed(0)}%</span>
</div>
))}
</div>
</div>
<div style={{background:"var(--surface)",border:"1px solid var(--border-faint)",borderRadius:8,padding:"12px 14px"}}>
<div style={{fontSize:11,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:8}}>KEY OBSERVATIONS · {CONV.label} REGIME</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{[
{ok:true,text:"401k is diversified across US equity (60%), bonds (22%), international (15%), and TIPS (3%) — appropriate target-date structure for a long-horizon retirement account."},
{ok:CONV.level<=3,text:`Brokerage is well-diversified: SPY core, QQQ growth tilt, GLD hedge, BRK.B quality, TLT tail hedge, and 7% cash. ${CONV.level<=2?"Consider trimming GLD and adding equity on any dip.":"Positioning appropriate for current "+CONV.label+" stress level."}`},
{ok:true,text:"529 uses Fidelity ZERO funds (0% expense ratio) — optimal fund selection. Begin glide toward bonds within 3–4 years as enrollment approaches."},
{ok:true,text:"HSA invested in FXAIX — correct. Maximize family contributions ($8,550 in 2026). Treat as stealth retirement account; never withdraw."},
{ok:true,text:"Roth IRA holds highest-risk/return assets (VGT, FBTC, ARKK) — tax-free growth makes this the right account for speculative and high-growth positions."},
{ok:false,text:"Roth cash (SPAXX at 18% of account) is too high — deploy into VGT or a broad index to maximize tax-free compounding."},
].map(({ok,text},i)=>(
<div key={i} style={{display:"flex",gap:8,padding:"7px 10px",background:ok?"#22c55e08":"#ef444408",border:`1px solid ${ok?"#22c55e22":"#ef444422"}`,borderRadius:5}}>
<span style={{color:ok?"#30d158":"#ff453a",fontSize:13,flexShrink:0}}>{ok?"✓":"✗"}</span>
<span style={{fontSize:12,color:"var(--text-2)",lineHeight:1.6}}>{text}</span>
</div>
))}
</div>
</div>
{ACCOUNTS.map(acct=>(<AcctCard key={acct.id} acct={acct} grandTotal={grandTotal} convColor={CONV.color} convLabel={CONV.label} stressScore={COMP100}/>))}
<div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"monospace"}}>Sample portfolio · Illustrative values only · Not investment advice</div>
</div>
)}

{/* SCANNER */}
{tab==="scanner"&&<Scanner/>}

{/* FAQ */}
{tab==="readme"&&(
<div className="two-col-grid" style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>

{/* LEFT — MACRO DASHBOARD */}
<div style={{display:"flex",flexDirection:"column",gap:10}}>
<div style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:2}}>The Macro Dashboard</div>
<div style={{fontSize:12,color:"var(--accent)",fontFamily:"monospace",letterSpacing:"0.15em",padding:"5px 0",borderBottom:"1px solid var(--border)"}}>METHODOLOGY & DATA SOURCES</div>
{[
{title:"What is the Macro Dashboard?",body:"A market stress monitor tracking statistically-calibrated economic and financial indicators synthesized into a single composite stress score (0–100). The score drives regime classification (Low / Normal / Elevated / Extreme) and allocation guidance. Data is sourced exclusively from public databases — FRED, CBOE, ICE BofA, FDIC, ISM, BLS, Shiller, NY Fed, and the St. Louis Fed."},
{title:"What indicators are tracked and how frequently do they update?",body:"Indicators span 6 categories: Equity & Vol (VIX, EQ-Credit Correlation, SKEW Index), Credit Markets (HY-IG Spread, Corp Bond Distress Index, HY Effective Yield), Rates & Duration (10Y-2Y Slope, 10Y TIPS Real Rate, MOVE Index, Kim-Wright Term Premium), Financial Conditions (ANFCI, STLFSI, USD Index, USD Funding Spread), Bank & Money Supply (SLOOS C&I, SLOOS CRE, BKX/SPX Ratio, Bank Unrealized Losses, 3Y Credit Growth, YoY Bank Credit), Labor & Economy (ISM PMI, Copper/Gold Ratio, Initial Claims, JOLTS Quits, Shiller CAPE). Each card displays its frequency badge: D = Daily, W = Weekly, M = Monthly, Q = Quarterly."},
{title:"How is the composite stress score calculated?",body:"Each indicator is calibrated against its own long-run mean and standard deviation (SD). The raw SD score measures how many standard deviations the current reading is from its historical average, with direction adjusted so that higher always means more stress. Scores are weighted by tier — T1 indicators (1.5x weight) are the most market-sensitive, T2 (1.2x) are important but less real-time, T3 (1.0x) provide structural context. The weighted average SD score is mapped to a 0–100 scale anchored to historical crises (GFC = 92, COVID = 82, 2022 Rate Shock = 62)."},
{title:"What are the 4 stress regimes?",body:"LOW (0–20): Historically rare, genuinely risk-on conditions. VIX well below mean, credit spreads tight. NORMAL (20–50): Where markets spend most of their time — the baseline. Mild background stress. ELEVATED (50–75): Active risk management warranted. Sell covered calls, trim beta, rotate defensive. 2022 rate shock peaked at 62; SVB stress hit 58. EXTREME (75–100): Reserved for historical crises. COVID peaked at 82; GFC peaked at 92. Maximum defensiveness."},
{title:"What does color mean?",body:"Color always means stress level — nothing else. Green = Low stress. Yellow = Normal. Orange = Elevated. Red = Extreme. Any time you see color on an indicator, a bar, or a chart element, it tells you exactly where that reading sits in the stress spectrum."},
{title:"What is the trend signal?",body:"The trend signal shows the rate of change of the composite score over the prior 4 weeks. 'Rising Fast' means stress is accelerating — an early warning to start de-risking even if the level is still Normal. 'Easing' means conditions are improving. Level and direction together give a more complete picture than level alone."},
{title:"How does the Sectors tab work?",body:"Each sector score is the average of its subsector scores. Each subsector has its own sensitivity profile across 8 macro factors (Rates, Credit, Banking, Consumer, Growth, Dollar, Valuation, CRE). The stress of each factor is computed live from the indicator data and multiplied by the subsector's sensitivity weight. Sector rankings update automatically as indicator data refreshes."},
].map(({title,body},i)=>(
<div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:13,fontWeight:700,color:"var(--text)",fontFamily:"monospace",marginBottom:7}}>{String(i+1).padStart(2,"0")} · {title}</div>
<div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.85}}>{body}</div>
</div>
))}
</div>

{/* RIGHT — TRADING SCANNER */}
<div style={{display:"flex",flexDirection:"column",gap:10}}>
<div style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:2}}>The Trading Scanner</div>
<div style={{fontSize:12,color:"var(--accent)",fontFamily:"monospace",letterSpacing:"0.15em",padding:"5px 0",borderBottom:"1px solid var(--border)"}}>METHODOLOGY & DATA SOURCES</div>
{[
{title:"What is the Trading Scanner?",body:"An automated daily scan that runs at 3:45 PM ET on weekdays via GitHub Actions. It pulls signal data from Unusual Whales (options flow, dark pool, congressional trades, insider transactions) and scores every qualifying ticker on a 0–100 composite signal score. Tickers scoring 60+ are Buy-tier; 35–59 are Watch-tier."},
{title:"What data sources does the scanner use?",body:"Unusual Whales API: real-time options flow alerts (unusual volume, large sweeps), dark pool block trades, congressional stock disclosures (within 45 days), and insider purchase filings (SEC Form 4). Yahoo Finance: current price, technicals (RSI, MACD, 50/200-day MA). The scanner does not use analyst ratings or fundamental screeners."},
{title:"How is the signal score calculated?",body:"Each ticker is scored across 5 signal categories: Options Flow (large unusual sweeps, call-heavy activity, sweep vs. block mix), Dark Pool (size vs. average daily volume, recency), Congressional Activity (buy vs. sell, recency, position size), Insider Buying (Form 4 filings, recency, dollar value), and Technicals (RSI momentum, MACD crossover, price vs. 50/200-day MA). Each category contributes up to 20 points. Tickers must pass a price filter ($5–$500) and a market cap screen before scoring."},
{title:"What is the Covered Call recommendation?",body:"For Buy-tier tickers, the scanner evaluates the options chain and recommends a covered call strike if conditions are met: IV Rank must be above the minimum threshold (avoids selling premium when IV is low), the strike must be at least 1 standard deviation OTM, and the annualized yield must meet the minimum return target (25% annualized). The DTE window is 14–42 days. If conditions are not met, the scanner explains specifically why (e.g., 'All bids $0 — market closed', 'Spreads too wide', 'IVR below threshold')."},
{title:"How current is the scanner data?",body:"The scan runs once daily at 3:45 PM ET on weekdays, capturing end-of-day options flow and dark pool data. The dashboard displays the most recent scan with a timestamp. If the market is closed or the scan has not yet run today, the prior day's data is shown with a staleness notice."},
{title:"What does the Sample Portfolio tab show?",body:"The Sample Portfolio illustrates how the macro regime maps to position-level analysis for a hypothetical set of holdings. It is for illustrative purposes only and does not represent actual account balances or real trading recommendations."},
].map(({title,body},i)=>(
<div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:13,fontWeight:700,color:"var(--text)",fontFamily:"monospace",marginBottom:7}}>{String(i+1).padStart(2,"0")} · {title}</div>
<div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.85}}>{body}</div>
</div>
))}
{/* DISCLAIMER */}
<div style={{background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:8,padding:"12px 14px",marginTop:4}}>
<div style={{fontSize:11,color:"var(--text-dim)",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:6}}>DISCLAIMER</div>
<div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.75}}>This dashboard is for informational and educational purposes only. It is not financial advice, investment advice, or a solicitation to buy or sell any security. All data is sourced from public databases and may have errors or delays. Past relationships between indicators and market outcomes do not guarantee future results.</div>
</div>
</div>

</div>
)}

{/* close fade-in wrapper around tab content */}
</div>

<Footer
  leftText={tab==="scanner"?"SOURCES · Unusual Whales · Yahoo Finance · SEC Form 4 · Congressional Disclosures":"SOURCES · FRED · CBOE · ICE BofA · FDIC · ISM · BLS · Shiller · Kim-Wright Fed · SLOOS Fed"}
  rightText="⚠ NOT INVESTMENT ADVICE · v10"
/>
</div>
);
}
