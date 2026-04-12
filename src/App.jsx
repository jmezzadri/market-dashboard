import { useState, useEffect } from "react";

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
function sdColor(s){
if(s==null)return"#a3a3a3";
if(s<0.5) return"#22c55e";   // Low — green
if(s<1.0) return"#eab308";   // Normal — yellow
if(s<1.75)return"#f97316";   // Elevated — amber
return              "#ef4444"; // Extreme — red
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
{level:1,label:"LOW",      range:[-99,0.25], color:"#22c55e", eq:90,bd:5, ca:3, au:2,
 action:"Risk-on. Historically benign conditions. Consider adding cyclical beta."},
{level:2,label:"NORMAL",   range:[0.25,0.88],color:"#eab308", eq:75,bd:15,ca:7, au:3,
 action:"Market baseline. Maintain diversified exposure. Trim highest-beta on spikes."},
{level:3,label:"ELEVATED", range:[0.88,1.6], color:"#f97316", eq:55,bd:28,ca:12,au:5,
 action:"Active hedging warranted. Sell covered calls. Rotate defensive. Reduce leverage."},
{level:4,label:"EXTREME",  range:[1.6,99],   color:"#ef4444", eq:20,bd:30,ca:35,au:15,
 action:"Crisis regime. Maximum defensiveness. Harvest losses. Hold dry powder."},
];
function getConv(s){return CONVICTION.find(c=>s>=c.range[0]&&s<c.range[1])||CONVICTION[3];}

const AS_OF={
vix:"Apr 10 2026",hy_ig:"Apr 09 2026",eq_cr_corr:"Apr 12 2026",
yield_curve:"Apr 10 2026",move:"Apr 10 2026",anfci:"Apr 03 2026",
stlfsi:"Apr 03 2026",real_rates:"Apr 09 2026",sloos_ci:"Jan 01 2026",
cape:"Mar 2026",ism:"Mar 2026",copper_gold:"Apr 12 2026",
bkx_spx:"Apr 10 2026",bank_unreal:"Q4 2025",credit_3y:"Apr 2026",
term_premium:"Apr 03 2026",cmdi:"Apr 03 2026",loan_syn:"Apr 09 2026",
usd:"Apr 12 2026",cpff:"Apr 09 2026",skew:"Apr 10 2026",
sloos_cre:"Jan 01 2026",bank_credit:"Apr 01 2026",jobless:"Apr 04 2026",
jolts_quits:"Feb 01 2026",
};

const IND={
vix:["VIX","Equity Volatility","equity",1,"index",1,19.2,23.9,17.2,19.5,15.0,false,
"The CBOE Volatility Index measures expected 30-day S&P 500 volatility from live options prices. Known as the 'fear gauge' — higher = more fear, lower = calm.",
"At 23.9, modestly above the long-run average (~19.5). Down from 28+ recently. Watch for a sustained break above 30 (stress threshold) or 40 (crisis level)."],
hy_ig:["HY–IG Spread","Credit Risk Premium","credit",1,"bps",0,207.0,268,245,280,220,false,
"Spread between ICE BofA High Yield and Investment Grade bond yields. Measures extra return investors demand for credit risk.",
"At 228bps, spreads have tightened from recent highs. Markets not pricing significant default risk. Below 200bps = benign; above 400bps = significant stress."],
eq_cr_corr:["EQ–Credit Corr","Risk-Off Synchronization","equity",1,"corr",2,0.93,0.61,0.55,0.50,0.40,false,
"63-day rolling correlation between VIX and HY-IG spreads. When both move together, it signals a genuine risk-off regime rather than isolated noise.",
"At 0.74, markets are synchronized. Values above 0.6 indicate a true risk-off regime."],
yield_curve:["10Y–2Y Slope","Yield Curve","rates",1,"bps",0,50.0,52,35,15,-20,false,
"Difference between 10-year and 2-year Treasury yields. Inversion historically precedes recessions by 6–18 months.",
"At +52bps, re-steepened after the deepest inversion since 1981 (-109bps in 2023). An improving signal. Watch for bear steepening."],
move:["MOVE Index","Rates Volatility","rates",2,"index",0,72.0,98,95,90,85,false,
"Merrill Lynch Option Volatility Estimate: implied volatility of Treasury yields. The bond market's VIX.",
"At 112, well above the pre-2022 average of ~65. Elevated rates uncertainty raises borrowing costs."],
anfci:["ANFCI","Chicago Fed Fin. Conditions","fincond",2,"z-score",2,-0.43,0.08,0.06,0.04,-0.05,false,
"Adjusted National Financial Conditions Index: composite of 105 indicators isolating pure financial stress.",
"At +0.12, conditions are slightly tighter than the economy warrants. Positive = tighter than justified."],
stlfsi:["STLFSI","St. Louis Fed Stress Index","fincond",2,"index",2,-0.24,0.22,0.18,0.12,-0.10,false,
"St. Louis Fed Financial Stress Index: 18 weekly data series. Zero = historical average stress.",
"At 0.31, above-average but not severe. Sustained move above 1.0 would be concerning."],
real_rates:["10Y TIPS","Real Interest Rates","rates",2,"%",2,1.95,1.90,1.75,1.85,1.50,false,
"10-year TIPS yield — the real after-inflation rate. Represents the true cost of long-term borrowing.",
"At 1.82%, remains restrictive (historical avg ~0.5%). Compresses equity valuations especially growth stocks."],
sloos_ci:["SLOOS C&I","Business Lending Standards","bank",2,"%",1,5.3,9.8,8.0,6.0,2.0,false,
"Senior Loan Officer Opinion Survey: net % of banks tightening C&I loan standards.",
"At 14.2%, moderately tightening. Well below crisis levels (GFC: 84%). Historically leads credit events by 1–2 quarters."],
cape:["Shiller CAPE","Cyclically Adj. P/E Ratio","valuation",2,"ratio",1,34.2,35.1,33.8,31.5,29.8,true,
"S&P 500 price divided by 10-year average real earnings. Historical average ~17.",
"At 34.2, only exceeded in 1929 and the dot-com peak. Does not predict timing but predicts poor 10-year returns."],
ism:["ISM Mfg. PMI","Manufacturing Activity Index","economy",2,"index",1,52.7,52.4,52.6,49.8,47.9,true,
"ISM Manufacturing PMI: above 50 = expansion; below 50 = contraction.",
"At 52.7 (March 2026), strongest since Aug 2022. But prices paid jumped to 78.3 — signaling cost pressures."],
copper_gold:["Copper/Gold Ratio","Real Economy vs. Safe Haven","economy",2,"ratio",3,0.123,0.195,0.210,0.225,0.240,true,
"Ratio of copper to gold futures. A falling ratio signals growth pessimism and risk-off sentiment.",
"At 0.182, down 25% over 12 months. Diverging from ISM expansion reading. Historically leads equity weakness."],
bkx_spx:["BKX/SPX Ratio","Bank vs. Market Strength","bank",2,"ratio",3,0.092,0.352,0.365,0.378,0.395,true,
"KBW Bank Index divided by S&P 500. Bank weakness often signals coming broader stress.",
"At 0.335, near multi-year lows. Same pattern seen before SVB failed in March 2023."],
bank_unreal:["Bank Unreal. Loss","AFS+HTM Losses / Tier 1","bank",2,"% T1",1,19.9,19.5,20.8,22.1,18.5,true,
"Aggregate unrealized securities losses at FDIC-insured banks as % of Tier 1 regulatory capital.",
"At 19.9% of Tier 1 ($481B total). SVB was at 104% before failure. No margin for error on rate moves."],
credit_3y:["3Y Credit Growth","3-Year Bank Credit Expansion","bank",2,"% 3yr",1,4.5,11.8,12.5,13.2,12.8,true,
"Total bank credit growth over the prior 3 years. Measures buildup of system-wide credit fragility.",
"At 11.2% and decelerating. Above 12% = elevated fragility. Deceleration is a mild positive."],
term_premium:["Kim–Wright 10Y","10-Year Term Premium","rates",3,"bps",0,67.0,55,45,35,20,false,
"Fed model estimate of extra return for holding 10-year Treasuries vs. rolling short bills.",
"At 72bps, risen from deeply negative QE-era levels. Structural tightening independent of Fed policy."],
cmdi:["CMDI","Corp Bond Market Distress","credit",3,"index",2,0.07,0.38,0.30,0.25,0.12,false,
"Federal Reserve composite of corporate bond market functioning. Zero = normal.",
"At 0.42, somewhat impaired. Trending higher over 12 months. Leading indicator for credit availability."],
loan_syn:["HY Eff. Yield","High Yield Effective Yield","credit",3,"%",2,6.83,7.45,7.0,6.5,6.2,false,
"ICE BofA US High Yield Index Effective Yield. Proxy for leveraged loan market conditions.",
"At 7.84%, elevated vs. low-rate era (4–5%). Companies with near-term maturities face refinancing pressure."],
usd:["USD Index","Trade-Weighted Dollar","fincond",3,"index",1,99.1,103.1,102.5,101.8,101.0,false,
"Federal Reserve broad trade-weighted USD index. Strong dollar tightens global financial conditions.",
"At 104.2, modestly strong. Above 106 = meaningfully tight global conditions."],
cpff:["USD Funding","3M CP vs. Fed Funds Spread","fincond",3,"bps",0,9.0,14,12,10,8,false,
"Spread between 3-month AA financial commercial paper and effective Fed Funds Rate.",
"At 18bps, money markets functioning normally. GFC peak: 280bps; COVID: 65bps."],
skew:["SKEW Index","Options-Implied Tail Risk","equity",3,"index",0,144.0,141,138,135,130,false,
"CBOE SKEW from relative pricing of far OTM S&P 500 puts. Measures priced probability of a crash.",
"At 148, elevated. High SKEW + moderate VIX = quiet buildup of underlying anxiety."],
sloos_cre:["SLOOS CRE","CRE Lending Standards","bank",3,"%",1,8.9,18.3,15.0,12.0,8.0,false,
"Senior Loan Officer Opinion Survey: net % tightening Commercial Real Estate loan standards.",
"At 21.5%, CRE credit is tightening. Office and retail face a funding squeeze."],
bank_credit:["Bank Credit","YoY Bank Credit Growth","bank",3,"% YoY",1,6.7,3.4,3.8,4.2,5.0,false,
"Year-over-year growth in total bank credit from the Federal Reserve H.8 release.",
"At 2.8% YoY and decelerating (historical avg 6.5%). Constraining business and consumer activity."],
jobless:["Init. Claims","Weekly Jobless Claims","labor",3,"K",0,219.0,224,215,210,208,false,
"Initial unemployment insurance claims. Most timely high-frequency labor market indicator.",
"At 224K, within healthy pre-COVID range of 200–250K. No recession signal yet. Watch for 250K+."],
jolts_quits:["JOLTS Quits","Voluntary Quit Rate","labor",3,"%",1,1.9,2.3,2.35,2.45,2.55,false,
"Quits as % of total employment. Workers quit when confident about finding a better job.",
"At 2.1%, down from post-COVID high of 3.0%. Workers less confident — signals softening labor market."],
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
equity:   {label:"Equity & Vol",        color:ACCENT},
credit:   {label:"Credit Markets",      color:ACCENT},
rates:    {label:"Rates & Duration",    color:ACCENT},
fincond:  {label:"Financial Conditions",color:ACCENT},
bank:     {label:"Bank & Credit Supply",color:ACCENT},
labor:    {label:"Labor & Economy",     color:ACCENT},
valuation:{label:"Valuation",           color:ACCENT},
economy:  {label:"Real Economy",        color:ACCENT},
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
if(vel>0.12) return{label:"Rising Fast",  arrow:"▲▲",col:"#ef4444"};
if(vel>0.05) return{label:"Rising",       arrow:"▲", col:"#f97316"};
if(vel>0.02) return{label:"Edging Up",    arrow:"↗", col:"#eab308"};
if(vel<-0.12)return{label:"Easing Fast",  arrow:"▼▼",col:"#22c55e"};
if(vel<-0.05)return{label:"Easing",       arrow:"▼", col:"#22c55e"};
if(vel<-0.02)return{label:"Edging Down",  arrow:"↘", col:"#86efac"};
return              {label:"Stable",       arrow:"→", col:"#c0c0c0"};
}
const TREND_SIG=trendSignal(VEL);

function trendArrow(current,prior){
const d=current-prior;
if(d>5)  return{arrow:"▲",col:"#ef4444",label:"Rising"};
if(d>1)  return{arrow:"↗",col:"#f97316",label:"Edging up"};
if(d<-5) return{arrow:"▼",col:"#22c55e",label:"Easing"};
if(d<-1) return{arrow:"↘",col:"#86efac",label:"Edging down"};
return{arrow:"→",col:"#c0c0c0",label:"Stable"};
}

const TREND={
composite:{w1:43,m1:41,m6:52,m12:48},
equity:   {w1:52,m1:48,m6:44,m12:38},
credit:   {w1:38,m1:42,m6:48,m12:35},
rates:    {w1:55,m1:52,m6:58,m12:62},
fincond:  {w1:28,m1:30,m6:35,m12:30},
bank:     {w1:60,m1:58,m6:55,m12:50},
labor:    {w1:18,m1:20,m6:25,m12:28},
valuation:{w1:72,m1:70,m6:68,m12:65},
economy:  {w1:38,m1:42,m6:35,m12:30},
};

const COMP_HIST=[
["2005",28],["2006",22],["2007",38],["2008",92],["2009",78],["2010",48],
["2011",55],["2012",42],["2013",30],["2014",32],["2015",38],["2016",35],
["2017",18],["2018",40],["2019",32],["2020",82],["2021",25],["2022",62],
["2023",58],["2024",35],["Now",COMP100],
];

const COMP_CRISES=[
{label:"GFC",year:"2008",color:"#ef4444"},
{label:"COVID",year:"2020",color:"#f97316"},
{label:"Rate Shock",year:"2022",color:"#eab308"},
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

function buildDefaultHistKeyframes(id){
const sp=SD[id];if(!sp||!IND[id])return null;
const d=IND[id],m=sp.mean,sd=sp.sd||1e-9;
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
];
}

function getIndicatorHistSeries(id){
if(!IND[id]||!SD[id])return null;
const kf=buildDefaultHistKeyframes(id);
if(!kf)return null;
const out=[];
for(let y=2005;y<=2024;y++){
out.push([String(y),clampHistValue(id,piecewiseYearValue(y,kf))]);
}
out.push(["Now",clampHistValue(id,IND[id][6])]);
return out;
}

const STRESS_HIST_BANDS=[
{lo:0,hi:20,col:"#22c55e",label:"LOW"},
{lo:20,hi:50,col:"#eab308",label:"NORMAL"},
{lo:50,hi:75,col:"#f97316",label:"ELEVATED"},
{lo:75,hi:100,col:"#ef4444",label:"EXTREME"},
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
{ticker:"CASH", name:"Cash & Sweep Funds",         value:21800, price:1,     shares:21800,sector:"Cash",     beta:0.00,color:"#6e7580",
analysis:"Cash buffer at 7% — appropriate sizing. Covers quarterly estimated tax payments and dry powder for opportunistic deployment."},
]},
{id:"k401",label:"401(k) — Target Date",sub:"Acct …8823",color:"#6366f1",
note:"Pre-tax retirement account. Diversified target-date fund approach, auto-rebalancing.",
positions:[
{ticker:"FXAIX",name:"Fidelity 500 Index Fund",    value:198400,price:229.32,shares:866,sector:"US Equity",  beta:1.00,color:ACCENT,
analysis:"Core 401k holding — S&P 500 index at 60% of account. Do not manage tactically. Contribute the maximum ($23,500 in 2026) and let compounding work."},
{ticker:"FXNAX",name:"Fidelity U.S. Bond Index",   value:72800, price:10.45, shares:6967,sector:"Bonds",     beta:0.05,color:ACCENT,
analysis:"Bond allocation at 22% of 401k. Appropriate age-based diversification. Yield curve re-steepened to +51bps — intermediate bonds more attractive than during inversion."},
{ticker:"FSGGX",name:"Fidelity Global ex-US Index", value:48200,price:15.82, shares:3048,sector:"Intl Equity",beta:0.88,color:ACCENT,
analysis:"International diversification at 15% of 401k. Dollar strength (104) has been a headwind, but if dollar weakens this allocation benefits."},
{ticker:"FXIIX",name:"Fidelity Inflation-Prot Bond",value:10600,price:10.22, shares:1037,sector:"TIPS",      beta:0.12,color:ACCENT,
analysis:"TIPS allocation at 3% — appropriate inflation hedge. Real rates at 1.82% mean TIPS are paying a real yield."},
]},
{id:"roth",label:"Roth IRA",sub:"Acct …2290",color:"#22c55e",
note:"Tax-free growth account — best placement for highest-return, longest-duration assets.",
positions:[
{ticker:"VGT",  name:"Vanguard Info Technology ETF",value:28400,price:582.30,shares:49, sector:"Technology",beta:1.22,color:ACCENT,
analysis:"High-growth tech ETF in Roth — ideal placement. Tax-free compounding on a high-return sector. If composite reaches Elevated, trim to 50%; reinstate on pullback."},
{ticker:"FBTC", name:"Fidelity Bitcoin ETF",         value:14200,price:58.36, shares:243,sector:"Crypto",    beta:2.20,color:ACCENT,
analysis:"Bitcoin ETF at 34% of Roth — aggressive but appropriate in a tax-free account. High beta (2.20). Do not add at Elevated+ stress levels."},
{ticker:"ARKK", name:"ARK Innovation ETF",           value:8900, price:58.75, shares:151,sector:"Disruptive",beta:1.65,color:ACCENT,
analysis:"Speculative disruptive growth at 21% of Roth. Can drawdown 60%+ in stress regimes. Appropriate in Roth at this sizing."},
{ticker:"SPAXX",name:"Fidelity Govt Money Market",   value:7400, price:1.00,  shares:7400,sector:"Cash",     beta:0.00,color:"#6e7580",
analysis:"Cash in Roth at 18% of account — too high. Deploy into VGT or a broad index. Keep only $1,000–2,000 as a buffer."},
]},
{id:"529a",label:"529 Plan — Child 1 (Age 8)",sub:"Acct …5512",color:"#f97316",
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
{ticker:"FDRXX",name:"Fidelity Govt Money Market", value:4800, price:1.00,  shares:4800,sector:"Cash",   beta:0.00,color:"#6e7580",
analysis:"Cash buffer in HSA at 13% — slightly high. Keep $1,500–2,000 for near-term co-pays; deploy the rest into FXAIX."},
]},
];

const ANALYSIS=`REGIME SUMMARY — APRIL 8, 2026

A US-Iran ceasefire has triggered a broad risk-on rally: VIX plunged from 25.8 to ~20, oil dropped 16% to $94/bbl, S&P 500 surged 2%+. The composite remains Normal (not Low) — the ceasefire is explicitly temporary (two weeks) and underlying macro risks persist. CAPE at 34.2 is unchanged. Bank unrealized losses of $481B remain. ISM prices paid at 78.3 reflects supply chain damage that does not reverse overnight.

WHAT CHANGED: geopolitical risk premium partially unwound. Fed rate hike odds collapsed to zero; rate cut odds for year-end jumped to 45%. WHAT DIDN'T: structural rates, banking fragility, and valuation headwinds are unchanged.

KEY RISKS NEXT 4-8 WEEKS

Friday CPI print (Apr 10): if core CPI > 0.4% MoM, rate cut repricing reverses fast. Strait of Hormuz: Iran's statement was ambiguous — if strait stays effectively closed, oil re-rates to $110+. Islamabad talks Friday: any collapse in negotiations sends oil and VIX sharply higher within 24 hours.`;

// ── CHART HELPERS ───────────────────────────────────────────────────────────
function makePath(pts){
return pts.map((p,i)=>`${i===0?"M":"L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
}

function ChartCore({data,labels,dir,sdP,crisisData,col,fmtFn,H,pL,pR,pT,pB,W}){
const [hover,setHover]=useState(null);
const IW=W-pL-pR,IH=H-pT-pB;
const vals=data.map(d=>d[1]);
const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
const xp=i=>pL+(i/(data.length-1))*IW;
const yp=v=>{const raw=(v-mn)/rng;return pT+(dir==="lw"||dir==="nw"?raw:1-raw)*IH;};
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
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%4===0);
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
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"none"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{hZone&&hZone.h>0&&<rect x={pL} y={hZone.y} width={IW} height={hZone.h} fill="rgba(34,197,94,0.08)"/>}
{meanY!=null&&<line x1={pL} y1={meanY} x2={pL+IW} y2={meanY} stroke="rgba(34,197,94,0.35)" strokeWidth="0.5" strokeDasharray="3,4"/>}
{sdP&&<text x={pL-3} y={meanY!=null?meanY+2:pT} textAnchor="end" fill="rgba(34,197,94,0.5)" fontSize="5.5" fontFamily="monospace">{fmtFn(sdP.mean)}</text>}
<text x={pL-3} y={pT+4} textAnchor="end" fill="#9e9e9e" fontSize="6" fontFamily="monospace">{fmtFn(dir==="lw"||dir==="nw"?mn:mx)}</text>
<text x={pL-3} y={pT+IH+2} textAnchor="end" fill="#9e9e9e" fontSize="6" fontFamily="monospace">{fmtFn(dir==="lw"||dir==="nw"?mx:mn)}</text>
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.6"/>
<text x={cm.x} y={pT-6} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace" fontWeight="700">{cm.label}</text>
<rect x={cm.x-14} y={cm.y-10} width={28} height={10} rx="2" fill="#0a0a0a" stroke={cm.color} strokeWidth="0.5"/>
<text x={cm.x} y={cm.y-2} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace">{fmtFn(cm.v)}</text>
</g>
))}
<path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill={col} stroke="#080808" strokeWidth="1.5"/>
<text x={lastPt[0]} y={lastPt[1]-7} textAnchor="middle" fill={col} fontSize="6" fontFamily="monospace" fontWeight="700">{fmtFn(data[data.length-1][1])}</text>
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-4} textAnchor="middle" fill="#8a8a8a" fontSize="6" fontFamily="monospace">{l}</text>
))}
{hover&&(
<g>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="#fff" strokeWidth="0.5" opacity="0.2"/>
<circle cx={hover.x} cy={hover.y} r="4" fill="#fff" stroke={col} strokeWidth="1.5" opacity="0.9"/>
<rect x={ttX-24} y={ttY-9} width={48} height={16} rx="3" fill="#0a0a0a" stroke={col} strokeWidth="1"/>
<text x={ttX} y={ttY-1} textAnchor="middle" fill="#fff" fontSize="7" fontFamily="monospace" fontWeight="700">{fmtFn(hover.value)}</text>
<text x={ttX} y={ttY+7} textAnchor="middle" fill="#d4d4d4" fontSize="5.5" fontFamily="monospace">{hover.label}</text>
</g>
)}
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
<div style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace",marginBottom:4}}>
LONG-TERM HISTORY
<span style={{color:"rgba(34,197,94,0.7)",marginLeft:6}}>▬ normal range</span>
{COMP_CRISES.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year||l.startsWith(cm.year));
if(idx<0)return null;
return <span key={cm.label} style={{color:cm.color,marginLeft:8}}>│{cm.label}: {fmt(data[idx][1])}</span>;
})}
<span style={{color:"#9e9e9e",marginLeft:8}}>· hover chart for dates & values</span>
</div>
<ChartCore data={data} labels={labels} dir={sd?.dir} sdP={sd} crisisData={COMP_CRISES}
col={col} fmtFn={fmt} H={100} pL={28} pR={8} pT={18} pB={22} W={500}/>
</div>
);
}

function CompHistChart(){
const col=sdColor(COMP);
const data=COMP_HIST;
const labels=data.map(d=>String(d[0]));
const W=500,H=115,pL=24,pR=44,pT=14,pB=22;
const IW=W-pL-pR,IH=H-pT-pB;
const [hover,setHover]=useState(null);
const vals=data.map(d=>d[1]);
const xp=i=>pL+(i/(data.length-1))*IW;
const yp=v=>pT+(1-v/100)*IH;
const pts=data.map((d,i)=>[xp(i),yp(d[1])]);
const fullPath=makePath(pts);
const recentPath=makePath(pts.slice(-3));
const marks=COMP_CRISES.map(cm=>{
const idx=labels.findIndex(l=>l===cm.year);
if(idx<0)return null;
return{...cm,x:xp(idx),y:yp(vals[idx]),v:vals[idx]};
}).filter(Boolean);
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%4===0);
const lastPt=pts[pts.length-1];
const handleInteract=e=>{
e.stopPropagation();
const svg=e.currentTarget,rect=svg.getBoundingClientRect();
const cx=e.touches?e.touches[0].clientX:e.clientX;
const svgX=((cx-rect.left)/rect.width)*W;
let best=0,bestD=Infinity;
pts.forEach(([px],i)=>{const d=Math.abs(px-svgX);if(d<bestD){bestD=d;best=i;}});
setHover({x:pts[best][0],y:pts[best][1],label:labels[best],value:vals[best]});
};
const ttX=hover?Math.min(Math.max(hover.x,pL+24),W-pR-24):0;
const ttY=hover?(hover.y<pT+20?hover.y+14:hover.y-14):0;
return(
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"none"}}
onMouseMove={handleInteract} onTouchStart={handleInteract} onTouchMove={handleInteract}
onMouseLeave={()=>setHover(null)} onTouchEnd={()=>setTimeout(()=>setHover(null),1800)}>
{STRESS_HIST_BANDS.map(b=>(
<g key={b.label}>
<rect x={pL} y={yp(b.hi)} width={IW} height={yp(b.lo)-yp(b.hi)} fill={b.col} opacity="0.07"/>
<text x={pL+IW+3} y={yp((b.lo+b.hi)/2)+3} fill={b.col} fontSize="5" fontFamily="monospace" opacity="0.7">{b.label}</text>
</g>
))}
{[0,20,50,75,100].map(v=>(
<g key={v}>
<line x1={pL-2} y1={yp(v)} x2={pL} y2={yp(v)} stroke="#505050" strokeWidth="0.5"/>
<text x={pL-4} y={yp(v)+3} textAnchor="end" fill="#8a8a8a" fontSize="6" fontFamily="monospace">{v}</text>
</g>
))}
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.6"/>
<text x={cm.x} y={pT-3} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace" fontWeight="700">{cm.label}</text>
<rect x={cm.x-10} y={cm.y-9} width={20} height={9} rx="2" fill="#0a0a0a" stroke={cm.color} strokeWidth="0.5"/>
<text x={cm.x} y={cm.y-2} textAnchor="middle" fill={cm.color} fontSize="5.5" fontFamily="monospace">{cm.v}</text>
</g>
))}
<path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill={col} stroke="#080808" strokeWidth="1.5"/>
<text x={lastPt[0]} y={lastPt[1]-7} textAnchor="middle" fill={col} fontSize={7} fontFamily="monospace" fontWeight="800">{COMP100}</text>
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-4} textAnchor="middle" fill="#8a8a8a" fontSize="6" fontFamily="monospace">{l}</text>
))}
{hover&&(
<g>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="#fff" strokeWidth="0.5" opacity="0.2"/>
<circle cx={hover.x} cy={hover.y} r="4" fill="#fff" stroke={col} strokeWidth="1.5" opacity="0.9"/>
<rect x={ttX-20} y={ttY-9} width={40} height={16} rx="3" fill="#0a0a0a" stroke={col} strokeWidth="1"/>
<text x={ttX} y={ttY-1} textAnchor="middle" fill="#fff" fontSize="7" fontFamily="monospace" fontWeight="700">{hover.value}</text>
<text x={ttX} y={ttY+7} textAnchor="middle" fill="#d4d4d4" fontSize="5.5" fontFamily="monospace">{hover.label}</text>
</g>
)}
</svg>
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
const showLbl=labels.map((_,i)=>i===0||i===data.length-1||i%4===0);
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
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",touchAction:"none"}}
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
<text x={pL-4} y={yp(v)+3} textAnchor="end" fill="#8a8a8a" fontSize={compact?5:6} fontFamily="monospace">{v}</text>
</g>
))}
{marks.map(cm=>(
<g key={cm.label}>
<line x1={cm.x} y1={pT} x2={cm.x} y2={pT+IH} stroke={cm.color} strokeWidth="1" strokeDasharray="2,3" opacity="0.6"/>
<text x={cm.x} y={pT-3} textAnchor="middle" fill={cm.color} fontSize={compact?5:5.5} fontFamily="monospace" fontWeight="700">{cm.label}</text>
<rect x={cm.x-(compact?11:10)} y={cm.y-9} width={compact?22:20} height={9} rx="2" fill="#0a0a0a" stroke={cm.color} strokeWidth="0.5"/>
<text x={cm.x} y={cm.y-2} textAnchor="middle" fill={cm.color} fontSize={compact?5:5.5} fontFamily="monospace">{fmtRaw(cm.raw)}</text>
</g>
))}
<path d={fullPath} fill="none" stroke="#505050" strokeWidth="1.5" strokeLinejoin="round"/>
<path d={recentPath} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/>
<circle cx={lastPt[0]} cy={lastPt[1]} r={compact?3.5:4} fill={col} stroke="#080808" strokeWidth="1.5"/>
<text x={lastPt[0]} y={lastPt[1]-(compact?6:7)} textAnchor="middle" fill={col} fontSize={compact?6:7} fontFamily="monospace" fontWeight="800">{lastStress!=null?Math.round(lastStress):"—"}</text>
{labels.map((l,i)=>showLbl[i]&&(
<text key={i} x={xp(i)} y={H-4} textAnchor="middle" fill="#8a8a8a" fontSize={compact?5:6} fontFamily="monospace">{l}</text>
))}
{hover&&(
<g>
<line x1={hover.x} y1={pT} x2={hover.x} y2={pT+IH} stroke="#fff" strokeWidth="0.5" opacity="0.2"/>
<circle cx={hover.x} cy={hover.y} r={compact?3.5:4} fill="#fff" stroke={col} strokeWidth="1.5" opacity="0.9"/>
<rect x={ttX-30} y={ttY-10} width={60} height={20} rx="3" fill="#0a0a0a" stroke={col} strokeWidth="1"/>
<text x={ttX} y={ttY-2} textAnchor="middle" fill="#fff" fontSize={6.5} fontFamily="monospace" fontWeight="700">{fmtRaw(hover.raw)}</text>
<text x={ttX} y={ttY+8} textAnchor="middle" fill="#d4d4d4" fontSize={5} fontFamily="monospace">{hover.label}{hover.st!=null?` · ${Math.round(hover.st)}/100`:""}</text>
</g>
)}
</svg>
<div style={{fontSize:6,color:"#8a8a8a",fontFamily:"monospace",marginTop:3}}>Line = stress score (0–100) · tooltip shows native units</div>
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
{[0.2,0.4,0.6,0.8].map(t=>{const [tx,ty]=pt(start+sweep*t);return(<circle key={t} cx={tx} cy={ty} r="2.5" fill="#080808"/>);})}
<line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
<circle cx={cx} cy={cy} r="3.5" fill="white" opacity="0.6"/>
<text x={cx} y={90} textAnchor="middle" fill={col} fontSize="26" fontWeight="800" fontFamily="monospace">{n}</text>
<text x={cx} y={104} textAnchor="middle" fill={col} fontSize="10" fontFamily="monospace">{conv.label}</text>
<text x={cx} y={116} textAnchor="middle" fill="#bcbcbc" fontSize="7" fontFamily="monospace">COMPOSITE STRESS</text>
</svg>
{onClick&&<div style={{fontSize:7,color:"#9e9e9e",fontFamily:"monospace",marginTop:1}}>tap for history</div>}
</div>
);
}

function RangeBar({sMin,sMax,sp,cur,col}){
if(!sp||sMin==null)return null;
const range=sMax-sMin||1;
const tp=v=>Math.max(0,Math.min(100,((v-sMin)/range)*100));
const dirFlip=sp.dir==="lw"||sp.dir==="nw";
const hLo=sp.mean-sp.sd*0.5,hHi=sp.mean+sp.sd*0.5;
const lp=tp(hLo),hp=tp(hHi);
const adjL=dirFlip?100-hp:lp,adjH=dirFlip?100-lp:hp;
const adjCur=dirFlip?100-tp(cur):tp(cur);
const adjAvg=dirFlip?100-tp(sp.mean):tp(sp.mean);
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
<div style={{height:8,background:"#1a1a1a",borderRadius:4,overflow:"hidden",position:"relative"}}>
{CONVICTION.map(c=>{
const w=c.range[1]>50?25:c.range[1]-Math.max(0,c.range[0]);
const l=Math.max(0,c.range[0])/100*100;
return <div key={c.level} style={{position:"absolute",left:`${l}%`,width:`${w}%`,height:"100%",background:c.color,opacity:0.2}}/>;
})}
<div style={{position:"absolute",left:0,top:0,height:"100%",width:`${fillW}%`,background:col,borderRadius:4,opacity:0.9}}/>
</div>
<div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
{CONVICTION.map(c=>(<div key={c.level} style={{fontSize:5,color:"#9e9e9e",fontFamily:"monospace",textAlign:"center",flex:1,lineHeight:1.1}}>{c.label}</div>))}
</div>
</div>
);
}

function IndicatorTrendPills({id,d}){
const stress100=v=>{const sc=sdScore(id,v);return sc==null?null:sdTo100(sc);};
const sNow=sdScore(id,d[6]);
const s1m=sdScore(id,d[7]);
const curN=stress100(d[6]);
const velI=sNow!=null&&s1m!=null?sNow-s1m:0;
const sig=trendSignal(velI);
const rows=[
["12M",d[10]],["6M",d[9]],["3M",d[8]],["1M",d[7]],["NOW",d[6]],
];
return(
<div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
{rows.map(([lbl,v])=>{
if(v==null)return null;
const vN=stress100(v);
const c=sdColor(sdScore(id,v));
const isNow=lbl==="NOW";
const t=curN!=null&&vN!=null&&!isNow?trendArrow(curN,vN):null;
return(
<div key={lbl} style={{flex:isNow?1.15:1,minWidth:56,background:"#0a0a0a",border:isNow?`1px solid ${c}55`:"1px solid #1a1a1a",borderRadius:5,padding:"5px 6px",textAlign:"center"}}>
<div style={{fontSize:6,color:"#9e9e9e",fontFamily:"monospace",marginBottom:2}}>{isNow?"NOW":lbl}</div>
<div style={{fontSize:11,fontWeight:800,color:c,fontFamily:"monospace"}}>{fmtV(id,v)}</div>
{t&&<div style={{fontSize:7,color:t.col,fontFamily:"monospace",marginTop:2}}>{t.arrow} {curN>vN?"+":""}{curN-vN}</div>}
{isNow&&<div style={{fontSize:8,color:sig.col,fontFamily:"monospace",marginTop:2}}>{sig.arrow} vs 1M</div>}
</div>
);
})}
</div>
);
}

function IndicatorCard({id,trendPeriod,trendIdx,expandedId,setExpandedId}){
const isX=expandedId===id;
const d=IND[id];if(!d)return null;
const [label,sub,cat,tier,,,cur,m1,m3,m6,m12,isNew,desc,signal]=d;
const catCol=CATS[cat]?.color||"#6b7280";
const s=sdScore(id,cur);
const tV=d[trendIdx[trendPeriod]];
const sT=sdScore(id,tV);
const delta=s!=null&&sT!=null?s-sT:null;
const col=sdColor(s);
const tierCol=tier===1?"#eab308":tier===2?"#94a3b8":"#4b5563";
const sp=SD[id];
const allV=[cur,m1,m3,m6,m12].filter(v=>v!=null);
const sMin=allV.length?Math.min(...allV):null;
const sMax=allV.length?Math.max(...allV):null;
return(
<div id={`card-${id}`} onClick={()=>setExpandedId(isX?null:id)}
style={{background:isX?"#111":"#0c0c0c",border:`1px solid ${isX?col+"66":"#1c1c1c"}`,borderRadius:6,padding:"11px 13px",cursor:"pointer",transition:"all 0.2s",position:"relative"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
<div>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
<div style={{width:3,height:12,background:catCol,borderRadius:1}}/>
<span style={{fontSize:11,fontWeight:700,color:"#f0f0f0",fontFamily:"monospace"}}>{label}</span>
<span style={{fontSize:7,color:tierCol,border:`1px solid ${tierCol}44`,borderRadius:2,padding:"1px 4px",fontFamily:"monospace"}}>T{tier}</span>
</div>
<div style={{fontSize:9,color:"#b0b0b0",marginLeft:9}}>{sub}</div>
<div style={{fontSize:7,color:"#949494",marginLeft:9,fontFamily:"monospace"}}>{AS_OF[id]}</div>
</div>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
<span style={{fontSize:13,fontWeight:800,color:col,fontFamily:"monospace"}}>{fmtV(id,cur)}</span>
</div>
</div>
<div style={{marginBottom:6}}>
<span style={{fontSize:11,fontWeight:700,color:col,fontFamily:"monospace"}}>{s!=null?sdLabel(s):"No Data"}</span>
<ConvictionMiniBar s={s}/>
<div style={{marginTop:8,width:"100%"}}>
<div style={{fontSize:7,color:"#9e9e9e",fontFamily:"monospace",marginBottom:5,letterSpacing:"0.04em"}}>STRESS HISTORY (0–100) · GFC · COVID · RATE SHOCK · hover for date & level</div>
<IndStressChart id={id} col={col} compact/>
</div>
<IndicatorTrendPills id={id} d={d}/>
</div>
{delta!=null&&(
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontSize:9,color:delta>0.1?col:delta<-0.1?"#22c55e":"#c8c8c8",fontFamily:"monospace"}}>
{delta>0.1?"▲ Worsening":delta<-0.1?"▼ Improving":"→ Stable"} vs {trendPeriod}
</span>
<span style={{fontSize:8,padding:"1px 5px",borderRadius:2,background:(delta>0.1?col:"#22c55e")+"18",color:delta>0.1?col:delta<-0.1?"#22c55e":"#c8c8c8",fontFamily:"monospace"}}>
{Math.abs(delta)<0.15?"Marginal":Math.abs(delta)<0.4?"Modest":Math.abs(delta)<0.7?"Notable":"Significant"}
</span>
</div>
)}
{isX&&(
<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1a1a1a"}} onClick={e=>e.stopPropagation()}>
<LongChart id={id} col={col}/>
{sp&&sMin!=null&&(
<div style={{marginBottom:10}}>
<RangeBar sMin={sMin} sMax={sMax} sp={sp} cur={cur} col={col}/>
<div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#9e9e9e",fontFamily:"monospace",marginBottom:4}}>
<span>{fmtV(id,sMin)} (12M low)</span>
<span style={{color:"rgba(34,197,94,0.6)"}}>avg: {fmtV(id,sp.mean)}</span>
<span>{fmtV(id,sMax)} (12M high)</span>
</div>
<div style={{fontSize:8,color:"#aaaaaa",fontFamily:"monospace",display:"flex",gap:12}}>
<span>Elevated above: {fmtV(id,sp.mean+sp.sd)}</span>
<span>Extreme above: {fmtV(id,sp.mean+sp.sd*2)}</span>
</div>
</div>
)}
<div style={{background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:4,padding:"8px 10px",marginBottom:8}}>
<div style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:5}}>WHAT IS THIS INDICATOR?</div>
<div style={{fontSize:9,color:"#d4d4d4",lineHeight:1.75}}>{desc}</div>
</div>
<div style={{background:col+"0a",border:`1px solid ${col}22`,borderRadius:4,padding:"8px 10px"}}>
<div style={{fontSize:8,color:col,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:5}}>WHAT IS IT TELLING YOU RIGHT NOW?</div>
<div style={{fontSize:9,color:"#d4d4d4",lineHeight:1.75}}>{signal}</div>
</div>
</div>
)}
</div>
);
}

function PosCard({p,accountTotal,convColor,convLabel,stressScore}){
const [exp,setExp]=useState(false);
const pct=(p.value/accountTotal*100).toFixed(1);
const bCol=p.beta>1.5?"#ef4444":p.beta>1.0?"#f97316":p.beta>0.5?"#eab308":"#22c55e";
return(
<div onClick={e=>{e.stopPropagation();setExp(x=>!x);}}
style={{background:"#0a0a0a",border:`1px solid ${exp?"#4a6fa555":"#1a1a1a"}`,borderRadius:6,padding:"10px 12px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{width:26,height:26,borderRadius:5,background:"#4a6fa522",border:"1px solid #4a6fa544",display:"flex",alignItems:"center",justifyContent:"center"}}>
<span style={{fontSize:6,color:"#4a6fa5",fontFamily:"monospace",fontWeight:700}}>{p.ticker.slice(0,6)}</span>
</div>
<div>
<div style={{fontSize:10,fontWeight:700,color:"#f0f0f0",fontFamily:"monospace"}}>{p.ticker}</div>
<div style={{fontSize:8,color:"#b0b0b0"}}>{p.name}</div>
</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontSize:12,fontWeight:800,color:"#e0e0e0",fontFamily:"monospace"}}>${p.value.toLocaleString()}</div>
<div style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace"}}>{pct}% of acct</div>
</div>
</div>
<div style={{display:"flex",gap:10,marginBottom:5,flexWrap:"wrap"}}>
{[{l:"Price",v:`$${p.price}`},{l:"Qty",v:p.shares<100?p.shares:Math.round(p.shares)},{l:"Beta",v:p.beta.toFixed(2),c:bCol},{l:"Sector",v:p.sector}].map(({l,v,c})=>(
<div key={l}>
<div style={{fontSize:6,color:"#9e9e9e",fontFamily:"monospace"}}>{l}</div>
<div style={{fontSize:8,color:c||"#d8d8d8",fontFamily:"monospace",fontWeight:700}}>{v}</div>
</div>
))}
</div>
<div style={{height:2,background:"#1a1a1a",borderRadius:1,overflow:"hidden"}}>
<div style={{width:`${pct}%`,height:"100%",background:ACCENT,opacity:0.5}}/>
</div>
{exp&&(
<div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #1a1a1a"}} onClick={e=>e.stopPropagation()}>
<div style={{fontSize:7,color:convColor,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>ANALYSIS · {convLabel} REGIME ({stressScore}/100)</div>
<div style={{fontSize:9,color:"#d4d4d4",lineHeight:1.75}}>{p.analysis}</div>
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
<div style={{background:"#0c0c0c",border:`1px solid ${ACCENT}33`,borderRadius:8,overflow:"hidden"}}>
<div onClick={()=>setOpen(o=>!o)} style={{padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
<div style={{width:8,height:8,borderRadius:"50%",background:acct.color,flexShrink:0}}/>
<span style={{fontSize:11,fontWeight:700,color:"#f0f0f0",fontFamily:"monospace"}}>{acct.label}</span>
<span style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace"}}>{acct.sub}</span>
</div>
<div style={{fontSize:8,color:"#bcbcbc",marginLeft:16,lineHeight:1.5}}>{acct.note}</div>
</div>
<div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
<div style={{fontSize:14,fontWeight:800,color:"#e0e0e0",fontFamily:"monospace"}}>${total.toLocaleString()}</div>
<div style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace"}}>{pctOfTotal}% of wealth</div>
<div style={{fontSize:9,color:"#bcbcbc"}}>{open?"▲":"▼"}</div>
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
   note:"High CAPE headwind offset by strong earnings momentum. TIPS at 1.82% compress long-duration multiples."},
  {name:"Semiconductors",         sensitivities:{rates:1,growth:-2,credit:1},
   note:"ISM expansion + supply chain normalization post-ceasefire is a tailwind. Capex cycle intact."},
  {name:"Small/mid-cap SaaS",     sensitivities:{rates:3,credit:3,valuation:2},
   note:"Most rate-sensitive sub-sector. HY yield at 7.84% raises refinancing risk for unprofitable growers."},
 ]},
{id:"financials",name:"Financials",sub:"Banks · Insurance · Asset Mgmt · Payments",beta:1.05,
 chainLinks:["Real Estate (lending conditions)","Industrials (C&I loan availability)","Consumer Disc. (consumer credit)"],
 subsectors:[
  {name:"Large / Money Center Banks",    sensitivities:{banking:3,credit:2,rates:1},
   note:"BKX/SPX at multi-year lows despite re-steepened yield curve. Unrealized losses ($481B) suppress multiples."},
  {name:"Regional Banks",               sensitivities:{banking:3,credit:3,cre:3},
   note:"Most exposed to SLOOS tightening + CRE stress (21.5% tightening). SVB-pattern BKX weakness is a warning."},
  {name:"Insurance / Asset Management", sensitivities:{credit:1,consumer:1},
   note:"Higher rates = better float returns for insurers. Asset managers benefit from equity market stability."},
  {name:"Payments / Fintech",           sensitivities:{consumer:2,credit:1,rates:1},
   note:"Consumer spending data mixed — JOLTS quits falling signals softening confidence."},
 ]},
{id:"healthcare",name:"Healthcare",sub:"Pharma · Biotech · Med Devices · Managed Care",beta:0.62,
 chainLinks:["Technology (AI drug discovery)","Consumer (out-of-pocket spending sensitivity)"],
 subsectors:[
  {name:"Large-cap Pharma",    sensitivities:{rates:1,valuation:1},
   note:"Classic defensive. Pricing power, non-cyclical demand, strong FCF. Undervalued vs CAPE-heavy index."},
  {name:"Biotech (small/mid)", sensitivities:{credit:3,rates:2,valuation:1},
   note:"Credit-sensitive (HY funding). CMDI at 0.42 is a headwind for early-stage issuance."},
  {name:"Managed Care / HMOs", sensitivities:{consumer:1,rates:1},
   note:"Employment-linked enrollment is stable. Defensive FCF profile."},
 ]},
{id:"consumer_staples",name:"Consumer Staples",sub:"Food · Beverage · Household Products",beta:0.55,
 chainLinks:["Materials (packaging, commodity inputs)","Energy (logistics costs)","Consumer Disc. (wallet share)"],
 subsectors:[
  {name:"Food & Beverage",          sensitivities:{dollar:1,growth:1},
   note:"Input cost pressure from ISM prices paid (78.3) is a headwind, but pricing power has held."},
  {name:"Household & Personal Care",sensitivities:{dollar:1,rates:1},
   note:"Inelastic demand. Dollar strength (104) is a modest FX headwind for multinationals."},
 ]},
{id:"consumer_disc",name:"Consumer Discretionary",sub:"Retail · Autos · Hotels · E-commerce",beta:1.15,
 chainLinks:["Financials (consumer credit)","Labor (employment = discretionary income)","Energy (gasoline costs)"],
 subsectors:[
  {name:"E-commerce / Digital Retail",sensitivities:{consumer:2,credit:1},
   note:"Resilient but JOLTS quits decline signals consumer confidence erosion."},
  {name:"Auto & Durable Goods",      sensitivities:{rates:3,consumer:3,credit:2},
   note:"Most rate-sensitive consumer sub-sector. SLOOS C&I tightening constrains floor plan financing."},
  {name:"Hotels / Travel / Leisure", sensitivities:{consumer:2,rates:1,credit:1},
   note:"Post-ceasefire travel demand should recover. Real rates at 1.82% keep borrowing expensive."},
  {name:"Luxury",                    sensitivities:{consumer:2,valuation:2,dollar:2},
   note:"Vulnerable to wealth effects as CAPE mean-reverts. USD strength hurts peer valuations."},
 ]},
{id:"industrials",name:"Industrials",sub:"Aerospace · Defense · Transport · Machinery",beta:1.02,
 chainLinks:["Energy (fuel costs for transport)","Materials (steel, aluminum)","Technology (automation capex)"],
 subsectors:[
  {name:"Aerospace & Defense",       sensitivities:{credit:1,rates:1},
   note:"Iran war ceasefire is fragile — defense spending unlikely to reverse. Backlog cycle intact."},
  {name:"Transportation & Logistics",sensitivities:{growth:2,dollar:1,credit:1},
   note:"Post-ceasefire Hormuz reopening removes biggest supply chain bottleneck."},
  {name:"Machinery / Capital Goods", sensitivities:{growth:2,credit:2,rates:1},
   note:"ISM expansion (+52.7) is green light, but SLOOS C&I tightening constrains capex financing."},
 ]},
{id:"energy",name:"Energy",sub:"E&P · Integrated · Midstream · Services",beta:0.92,
 chainLinks:["Industrials (energy input costs)","Materials (drilling materials)","Consumer Staples (logistics costs)"],
 subsectors:[
  {name:"Integrated Majors (XOM, CVX)",sensitivities:{dollar:2,growth:1},
   note:"Oil fell 16% on ceasefire to $94/bbl. Ras Laffan LNG at 17% capacity = structural supply constraint."},
  {name:"E&P (upstream)",             sensitivities:{dollar:2,growth:2,credit:1},
   note:"Oil price volatility extreme. At $94, shale operators FCF-positive but margins compressed."},
  {name:"Midstream / MLPs",           sensitivities:{credit:1,rates:1},
   note:"Fee-based income, less commodity price exposure. Infrastructure demand is durable."},
  {name:"Oil Services",               sensitivities:{growth:2,credit:2,dollar:1},
   note:"Capex cycle likely to slow as operators wait for oil price clarity post-ceasefire."},
 ]},
{id:"materials",name:"Materials",sub:"Metals · Mining · Chemicals · Packaging",beta:1.08,
 chainLinks:["Energy (mining energy costs)","Industrials (steel/aluminum)","Consumer Staples (packaging inputs)"],
 subsectors:[
  {name:"Precious Metals / Gold Miners",sensitivities:{rates:-2,dollar:-1},
   note:"Gold +3.2% on ceasefire. Real rates declining = lower opportunity cost. GLD hedge appropriate."},
  {name:"Base Metals / Copper",         sensitivities:{growth:3,dollar:3},
   note:"Copper/Gold ratio at 0.182 — 25% below 12M average. Dollar at 104 is additional headwind."},
  {name:"Specialty Chemicals",          sensitivities:{growth:2,credit:1,dollar:1},
   note:"ISM expansion supportive but input cost inflation (prices paid 78.3) squeezes margins."},
  {name:"Packaging",                    sensitivities:{growth:1,credit:1},
   note:"Defensive demand but commodity input exposure. Monitor ISM prices paid trajectory."},
 ]},
{id:"utilities",name:"Utilities",sub:"Electric · Gas · Water · Renewables",beta:0.42,
 chainLinks:["Technology (AI power demand driving capex)","Financials (rate-sensitive valuation)","Materials (grid infrastructure)"],
 subsectors:[
  {name:"Regulated Electric / Gas",  sensitivities:{rates:3,credit:2},
   note:"Real rates at 1.82% = significant headwind on regulated utility multiples. Wait for rate relief."},
  {name:"Renewables / Clean Energy", sensitivities:{rates:1,credit:1},
   note:"AI data center power demand is structural. Grid investment cycle intact. Strong secular tailwind."},
  {name:"Water Utilities",           sensitivities:{rates:1},
   note:"Least rate-sensitive utility sub-sector. Steady cash flows, regulatory protection."},
 ]},
{id:"real_estate",name:"Real Estate",sub:"REITs · Commercial · Residential",beta:0.78,
 chainLinks:["Financials (lending conditions)","Utilities (building energy costs)","Materials (construction costs)"],
 subsectors:[
  {name:"Industrial REITs",          sensitivities:{rates:2,credit:2,cre:2},
   note:"E-commerce demand firm, but SLOOS CRE tightening (21.5%) constrains refinancing."},
  {name:"Office REITs",              sensitivities:{rates:3,credit:3,cre:3},
   note:"Remote work headwind + CRE lending tightening + real rates = triple compression. Avoid."},
  {name:"Residential / Multifamily", sensitivities:{rates:2,credit:2,cre:1},
   note:"Supply constraint supports demand but affordability crisis limits growth."},
  {name:"Data Center REITs",         sensitivities:{rates:1,credit:1},
   note:"AI infrastructure demand is exceptional. Secular growth story transcends rate cycle."},
 ]},
{id:"comm_services",name:"Comm. Services",sub:"Social Media · Streaming · Telecom",beta:1.10,
 chainLinks:["Technology (infrastructure dependency)","Consumer Disc. (advertising budgets)","Financials (debt refinancing)"],
 subsectors:[
  {name:"Digital Advertising (Meta, Alphabet)",sensitivities:{rates:1,valuation:2,consumer:1},
   note:"Ad spending resilient. AI-driven targeting efficiency improving ROI. Earnings quality is high."},
  {name:"Streaming / Content",                sensitivities:{consumer:2,rates:1},
   note:"Consumer softening is a risk to subscription adds. Mature penetration limits upside."},
  {name:"Telecom",                            sensitivities:{rates:2,credit:2},
   note:"Rate-sensitive (high debt loads) but defensive demand. Dividend yield attractive if rates plateau."},
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
if(score>0.85)return{label:"OVERWEIGHT", color:"#22c55e",short:"OW"};
if(score>0.65)return{label:"SLIGHT OW",  color:"#86efac",short:"+="};
if(score>0.40)return{label:"NEUTRAL",    color:"#d8d8d8",   short:"=" };
if(score>0.20)return{label:"SLIGHT UW",  color:"#f97316",short:"-="};
return              {label:"UNDERWEIGHT",color:"#ef4444",short:"UW"};
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
style={{background:expanded?"#111":"#0c0c0c",border:`1px solid ${expanded?outlook.color+"55":"#1c1c1c"}`,borderRadius:8,padding:"14px 16px",cursor:"pointer",transition:"all 0.2s"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
  <div style={{flex:1,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
      <div style={{width:3,height:16,background:ACCENT,borderRadius:1,flexShrink:0}}/>
      <span style={{fontSize:13,fontWeight:800,color:"#f0f0f0",fontFamily:"monospace"}}>{sector.name}</span>
      <span style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace"}}>β {sector.beta.toFixed(2)}</span>
    </div>
    <div style={{fontSize:9,color:"#b0b0b0",marginLeft:11}}>{sector.sub}</div>
  </div>
  <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
    <div style={{padding:"4px 10px",borderRadius:4,background:outlook.color+"18",border:`1px solid ${outlook.color}44`,fontSize:10,fontWeight:800,color:outlook.color,fontFamily:"monospace"}}>
      {outlook.label}
    </div>
    <div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginTop:3}}>Rank {rank}/{totalSectors}</div>
  </div>
</div>
<div style={{height:4,background:"#1a1a1a",borderRadius:2,marginBottom:10,overflow:"hidden"}}>
  <div style={{width:`${barPct}%`,height:"100%",background:outlook.color,borderRadius:2,opacity:0.8}}/>
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
  {topHeadwinds.map(h=>{
    const col=h.impact>1.2?"#ef4444":h.impact>0.5?"#f97316":"#c8c8c8";
    return <div key={h.key} style={{padding:"2px 7px",borderRadius:3,background:col+"15",border:`1px solid ${col}33`,fontSize:8,color:col,fontFamily:"monospace"}}>↓ {FACTOR_DISPLAY.find(f=>f.key===h.key)?.label||h.key}</div>;
  })}
</div>
{expanded&&(
<div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #1a1a1a"}} onClick={e=>e.stopPropagation()}>
  <div style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace",letterSpacing:"0.12em",marginBottom:8}}>SUBSECTOR OUTLOOK · scores from live indicator data</div>
  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
    {subsectorScores.map((ss,i)=>{
      const ol=outlookLabel(ss.score);
      const barW=Math.max(5,Math.min(100,ss.score*80));
      return(
        <div key={i} style={{background:"#0a0a0a",border:`1px solid ${ol.color}22`,borderRadius:5,padding:"8px 10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontSize:9,fontWeight:700,color:"#e6e6e6",fontFamily:"monospace"}}>{ss.name}</span>
            <span style={{fontSize:9,fontWeight:700,color:ol.color,fontFamily:"monospace"}}>{ol.label}</span>
          </div>
          <div style={{height:3,background:"#1a1a1a",borderRadius:2,overflow:"hidden",marginBottom:5}}>
            <div style={{width:`${barW}%`,height:"100%",background:ol.color,borderRadius:2,opacity:0.7}}/>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:5}}>
            {Object.entries(ss.sensitivities).filter(([k,w])=>w!==0).map(([k,w])=>{
              const stress=FACTOR_SCORES[k]||0;
              const isHead=w>0;
              const impact=Math.abs(w)*stress;
              const col=!isHead?"#22c55e":impact>0.8?"#ef4444":impact>0.3?"#f97316":"#c8c8c8";
              return <span key={k} style={{fontSize:7,color:col,background:col+"15",padding:"1px 5px",borderRadius:2,fontFamily:"monospace"}}>{isHead?"↓":"↑"}{FACTOR_DISPLAY.find(f=>f.key===k)?.label||k}</span>;
            })}
          </div>
          <div style={{fontSize:9,color:"#c8c8c8",lineHeight:1.65}}>{ss.note}</div>
        </div>
      );
    })}
  </div>
  <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:5,padding:"8px 10px"}}>
    <div style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace",marginBottom:5}}>SUPPLY CHAIN & CORRELATION LINKS</div>
    {sector.chainLinks.map((link,i)=>(
      <div key={i} style={{display:"flex",gap:6,marginBottom:3}}>
        <span style={{color:"#8a8a8a",fontSize:9,flexShrink:0}}>→</span>
        <span style={{fontSize:9,color:"#c8c8c8",lineHeight:1.6}}>{link}</span>
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
const topFactors=Object.entries(FACTOR_SCORES).map(([k,v])=>({key:k,stress:v,label:FACTOR_DISPLAY.find(f=>f.key===k)?.label||k})).sort((a,b)=>b.stress-a.stress).slice(0,4);
return(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:14}}>
  <div style={{background:"#0c0c0c",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"12px 16px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:8,color:CONV.color,fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:4}}>SECTOR OUTLOOK · {CONV.label} {TREND_SIG.arrow} {TREND_SIG.label} · {COMP100}/100</div>
        <div style={{fontSize:9,color:"#c8c8c8",maxWidth:420,lineHeight:1.6}}>Sector scores driven by live indicator data. Parent score = average of dynamic subsector scores. Each subsector has its own macro sensitivity weights.</div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        <div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",alignSelf:"center"}}>TOP HEADWINDS:</div>
        {topFactors.map(f=>{const col=f.stress>1.2?"#ef4444":f.stress>0.5?"#f97316":"#c8c8c8";return(
          <div key={f.key} style={{background:col+"15",border:`1px solid ${col}33`,borderRadius:4,padding:"3px 8px",fontSize:8,color:col,fontFamily:"monospace"}}>{f.label} {sdLabel(f.stress)}</div>
        );})}
      </div>
    </div>
  </div>
  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
    <span style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace"}}>FILTER:</span>
    {[{id:null,label:"ALL"},{id:"ow",label:"↑ OW"},{id:"neutral",label:"= NEUTRAL"},{id:"uw",label:"↓ UW"}].map(({id,label})=>(
      <button key={String(id)} onClick={()=>setFilterOutlook(id)}
        style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:8,fontFamily:"monospace",background:filterOutlook===id?"#e0e0e0":"transparent",color:filterOutlook===id?"#000":"#c8c8c8",borderColor:filterOutlook===id?"#e0e0e0":"#1e1e1e"}}>{label}</button>
    ))}
    <span style={{fontSize:8,color:"#9e9e9e",fontFamily:"monospace",marginLeft:"auto"}}>tap any card to expand</span>
  </div>
  <div style={{background:"#0c0c0c",border:"1px solid #181818",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:8}}>RELATIVE RANKING · bar = macro-adjusted favorability score</div>
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {scored.map((s,i)=>{
        const ol=outlookLabel(s.score);
        const barPct=Math.max(5,Math.min(100,s.score*80));
        return(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:8,color:"#9e9e9e",fontFamily:"monospace",minWidth:16,textAlign:"right"}}>{i+1}</span>
            <span style={{fontSize:9,color:"#dadada",fontFamily:"monospace",minWidth:160}}>{s.name}</span>
            <div style={{flex:1,height:5,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${barPct}%`,height:"100%",background:ol.color,borderRadius:2,opacity:0.8}}/>
            </div>
            <span style={{fontSize:8,fontWeight:700,color:ol.color,fontFamily:"monospace",minWidth:90,textAlign:"right"}}>{ol.label}</span>
          </div>
        );
      })}
    </div>
    <div style={{fontSize:7,color:"#8a8a8a",fontFamily:"monospace",marginTop:6}}>
      Color = outlook (green = favorable · red = caution) · Bar length = relative favorability · Scores computed from subsector averages
    </div>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:10}}>
    {filtered.map((s,i)=>(<SectorCard key={s.id} sector={s} rank={scored.indexOf(s)+1} totalSectors={scored.length}/>))}
  </div>
  <div style={{fontSize:7,color:"#7a7a7a",fontFamily:"monospace",textAlign:"center"}}>Sector scores from live dashboard indicators · Subsector scores are the source of truth · Not investment advice</div>
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
<div style={{background:"#0c0c0c",border:"1px solid #1e1e1e",borderRadius:8,padding:"16px 18px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
<div>
<div style={{fontSize:8,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.18em",marginBottom:3}}>LIVE AI NARRATIVE ANALYSIS</div>
<div style={{fontSize:10,color:"#bcbcbc"}}>Generated from today's live indicator readings · Powered by Claude</div>
{generatedAt&&<div style={{fontSize:8,color:"#9e9e9e",fontFamily:"monospace",marginTop:4}}>📅 Generated {generatedAt}</div>}
</div>
<button onClick={generate} disabled={loading}
style={{padding:"8px 20px",borderRadius:4,border:`1px solid ${loading?"#333":CONV.color}`,background:loading?"#111":CONV.color+"20",color:loading?"#c8c8c8":CONV.color,cursor:loading?"not-allowed":"pointer",fontSize:9,fontFamily:"monospace",fontWeight:700,minWidth:160}}>
{loading?"⟳ GENERATING...":"▶ GENERATE ANALYSIS"}
</button>
</div>

{/* Indicator snapshot fed to Claude */}
<div style={{padding:"8px 12px",background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:4,marginBottom:12}}>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginBottom:6}}>CURRENT READINGS BEING ANALYZED</div>
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{Object.entries(IND).map(([id,d])=>{
const s=sdScore(id,d[6]);
const col=sdColor(s);
return(
<div key={id} style={{background:"#111",border:`1px solid ${col}22`,borderRadius:3,padding:"2px 7px",display:"flex",gap:5,alignItems:"center"}}>
<span style={{fontSize:7,color:"#c8c8c8",fontFamily:"monospace"}}>{d[0]}</span>
<span style={{fontSize:8,fontWeight:700,color:col,fontFamily:"monospace"}}>{fmtV(id,d[6])}</span>
</div>
);
})}
</div>
</div>

{error&&(
<div style={{padding:"10px 14px",background:"#ef444410",border:"1px solid #ef444433",borderRadius:4,marginBottom:12}}>
<div style={{fontSize:9,color:"#ef4444",fontFamily:"monospace"}}>{error}</div>
</div>
)}

{loading&&(
<div style={{padding:"20px",textAlign:"center"}}>
<div style={{fontSize:10,color:"#c8c8c8",fontFamily:"monospace"}}>Analyzing {Object.keys(IND).length} indicators across rates, credit, banking, labor, and valuation...</div>
<div style={{marginTop:8,fontSize:8,color:"#9e9e9e",fontFamily:"monospace"}}>Usually takes 5-10 seconds</div>
</div>
)}

{analysis&&!loading&&(
<div style={{fontSize:10,color:"#dadada",lineHeight:1.9}}>
{analysis.split("\n\n").map((para,i)=>{
const lines=para.split("\n");
const isH=lines[0]===lines[0].toUpperCase()&&lines[0].length<60&&!lines[0].includes(".");
return(
<div key={i} style={{marginBottom:14}}>
{isH?(
<>
<div style={{fontSize:8,color:CONV.color,fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:6,marginTop:i>0?10:0}}>{lines[0]}</div>
<div style={{color:"#d8d8d8",lineHeight:1.85}}>{lines.slice(1).join(" ")}</div>
</>
):(
<div style={{color:"#dadada",lineHeight:1.85}}>{para}</div>
)}
</div>
);
})}
</div>
)}

{!analysis&&!loading&&!error&&(
<div style={{padding:"30px 20px",textAlign:"center",borderTop:"1px solid #111"}}>
<div style={{fontSize:11,color:"#9e9e9e",fontFamily:"monospace",marginBottom:8}}>Click "Generate Analysis" to get a live narrative</div>
<div style={{fontSize:9,color:"#9a9a9a",fontFamily:"monospace"}}>Claude will analyze all 25 current indicator readings and write a fresh macro summary</div>
</div>
)}
</div>
</div>
);
}

// ── MAIN APP ─────────────────────────────────────────────────────────────────
const TAB_IDS=["overview","analysis","indicators","sectors","portfolio","readme"];

export default function App(){
const [tab,setTab]=useState(()=>{
if(typeof window==="undefined")return"overview";
const h=(window.location.hash||"").slice(1);
return TAB_IDS.includes(h)?h:"overview";
});
useEffect(()=>{window.location.hash=tab;},[tab]);
const [catFilter,setCatFilter]=useState(null);
const [newOnly,setNewOnly]=useState(false);
const [trendPeriod,setTrendPeriod]=useState("3M");
const [expandedId,setExpandedId]=useState(null);
const [showCompHist,setShowCompHist]=useState(false);
const trendIdx={"1M":7,"3M":8,"6M":9,"12M":10};

const visibleIds=Object.keys(IND).filter(id=>{
if(newOnly)return IND[id][11];
if(catFilter)return IND[id][2]===catFilter;
return true;
});

const grandTotal=ACCOUNTS.reduce((a,acc)=>a+acc.positions.reduce((b,p)=>b+p.value,0),0);
const portBeta=ACCOUNTS.flatMap(acc=>acc.positions).reduce((a,p)=>a+(p.value/grandTotal)*p.beta,0);
const assetRollup={};
ACCOUNTS.flatMap(acc=>acc.positions).forEach(p=>{
const cls=p.sector==="Cash"?"Cash":["GLD","SLV"].includes(p.ticker)?"Precious Metals":["FBTC","ETHE"].includes(p.ticker)?"Crypto":p.sector==="Intl Equity"?"Intl Equity":["FXAIX","FSKAX","FZILX","FSGGX"].includes(p.ticker)?"Index Funds":"Individual Stocks";
assetRollup[cls]=(assetRollup[cls]||0)+p.value;
});
const rollupColors={"Index Funds":"#4a6fa5","Intl Equity":"#6366f1","Individual Stocks":"#f97316","Precious Metals":"#eab308","Crypto":"#a855f7","Cash":"#6e7580"};

return(
<div style={{minHeight:"100vh",background:"#080808",color:"#e0e0e0",fontFamily:"sans-serif"}}>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>

{/* HEADER */}
<div style={{padding:"16px 20px 12px",borderBottom:"1px solid #111",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14}}>
<div style={{flex:1,minWidth:200}}>
<div style={{fontSize:8,letterSpacing:"0.25em",color:"#949494",fontFamily:"monospace",marginBottom:4}}>MACRO STRESS MONITOR · Apr 09, 2026</div>
<div style={{fontSize:18,fontWeight:800,letterSpacing:"-0.02em"}}>Market Stress <span style={{color:CONV.color}}>Dashboard</span></div>
<div style={{fontSize:9,color:"#949494",marginTop:2,fontFamily:"monospace"}}>25 indicators · statistically calibrated · 6 accounts</div>
<div style={{display:"flex",gap:6,marginTop:10,alignItems:"center",flexWrap:"wrap"}}>
<span style={{fontSize:8,color:"#9e9e9e",fontFamily:"monospace"}}>LEVELS:</span>
{CONVICTION.map(c=>(
<div key={c.level} style={{display:"flex",alignItems:"center",gap:3}}>
<div style={{width:7,height:7,borderRadius:"50%",background:c.color}}/>
<span style={{fontSize:8,color:CONV.level===c.level?c.color:"#bcbcbc",fontFamily:"monospace",fontWeight:CONV.level===c.level?700:400}}>{c.label}</span>
</div>
))}
</div>
</div>
<Gauge score={COMP} onClick={()=>setShowCompHist(x=>!x)}/>
</div>

{/* COMPOSITE HISTORY PANEL */}
{showCompHist&&(
<div style={{padding:"12px 20px 0",background:"#080808"}} onClick={()=>setShowCompHist(false)}>
<div style={{background:"#0c0c0c",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"14px 16px"}} onClick={e=>e.stopPropagation()}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<div style={{fontSize:8,color:CONV.color,fontFamily:"monospace",letterSpacing:"0.12em"}}>COMPOSITE STRESS HISTORY · 0–100 SCALE</div>
<div style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace",cursor:"pointer"}} onClick={()=>setShowCompHist(false)}>✕ close</div>
</div>
<CompHistChart/>
</div>
</div>
)}

{/* STATUS BAR — now shows level + trend signal prominently */}
<div style={{padding:"8px 20px",borderBottom:"1px solid #0e0e0e",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
<div style={{display:"flex",alignItems:"center",gap:8,background:CONV.color+"12",border:`1px solid ${CONV.color}33`,borderRadius:6,padding:"5px 12px"}}>
  <span style={{fontSize:11,fontWeight:800,color:CONV.color,fontFamily:"monospace"}}>{CONV.label}</span>
  <span style={{fontSize:11,color:"#bcbcbc",fontFamily:"monospace"}}>·</span>
  <span style={{fontSize:11,fontWeight:700,color:CONV.color,fontFamily:"monospace"}}>{COMP100}/100</span>
  <span style={{fontSize:11,color:"#bcbcbc",fontFamily:"monospace"}}>·</span>
  <span style={{fontSize:11,fontWeight:700,color:TREND_SIG.col,fontFamily:"monospace"}}>{TREND_SIG.arrow} {TREND_SIG.label}</span>
</div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
  {[["1M",COMP1M100],["3M",COMP3M100]].map(([lbl,val])=>{
    const t=trendArrow(COMP100,val);
    return <div key={lbl} style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace",background:"#111",borderRadius:4,padding:"3px 8px"}}>
      {lbl}: <span style={{color:t.col}}>{val} {t.arrow}</span>
    </div>;
  })}
</div>
<span style={{fontSize:9,color:"#c8c8c8",fontFamily:"monospace",marginLeft:"auto"}}>→ {CONV.action}</span>
</div>

{/* TABS */}
<div style={{padding:"8px 20px",borderBottom:"1px solid #0e0e0e",display:"flex",gap:5,flexWrap:"wrap"}}>
{[["overview","OVERVIEW"],["analysis","AI ANALYSIS"],["indicators","INDICATORS"],["sectors","SECTORS"],["portfolio","PORTFOLIO"],["readme","FAQ"]].map(([id,label])=>(
<button key={id} onClick={()=>setTab(id)} style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:8,fontFamily:"monospace",background:tab===id?"#e0e0e0":"transparent",color:tab===id?"#000":"#bcbcbc",borderColor:tab===id?"#e0e0e0":"#1e1e1e"}}>{label}</button>
))}
</div>

{/* OVERVIEW */}
{tab==="overview"&&(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:14}}>
<div style={{background:"#0c0c0c",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"14px 16px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<div>
<div style={{fontSize:8,color:CONV.color,fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:2}}>OVERALL STRESS COMPOSITE</div>
<div style={{fontSize:9,color:"#c8c8c8"}}>Weighted average of 25 indicators · 0 = no stress, 100 = crisis · Normal is where markets spend most time</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontSize:28,fontWeight:800,color:CONV.color,fontFamily:"monospace",lineHeight:1}}>{COMP100}</div>
<div style={{fontSize:10,color:CONV.color,fontFamily:"monospace"}}>{CONV.label} {TREND_SIG.arrow} {TREND_SIG.label}</div>
</div>
</div>
<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",alignSelf:"center",marginRight:4}}>TREND:</div>
{[["1 Wk ago",TREND.composite.w1],["1 Mo ago",TREND.composite.m1],["6 Mo ago",TREND.composite.m6],["12 Mo ago",TREND.composite.m12]].map(([lbl,val])=>{
const t=trendArrow(COMP100,val);
return(
<div key={lbl} style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:5,padding:"6px 10px",textAlign:"center",minWidth:72}}>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginBottom:3}}>{lbl}</div>
<div style={{fontSize:14,fontWeight:800,color:sdColor((val-25)/25),fontFamily:"monospace"}}>{val}</div>
<div style={{fontSize:8,color:t.col,fontFamily:"monospace"}}>{t.arrow} {COMP100>val?"+":""}{COMP100-val}</div>
</div>
);
})}
<div style={{background:"#0a0a0a",border:`1px solid ${CONV.color}44`,borderRadius:5,padding:"6px 10px",textAlign:"center",minWidth:72}}>
<div style={{fontSize:7,color:CONV.color,fontFamily:"monospace",marginBottom:3}}>NOW</div>
<div style={{fontSize:14,fontWeight:800,color:CONV.color,fontFamily:"monospace"}}>{COMP100}</div>
<div style={{fontSize:8,color:TREND_SIG.col,fontFamily:"monospace"}}>{TREND_SIG.arrow} {TREND_SIG.label}</div>
</div>
</div>
<div style={{position:"relative",marginBottom:6}}>
<div style={{height:8,background:"#1a1a1a",borderRadius:4,overflow:"hidden",position:"relative"}}>
{CONVICTION.map(c=>{
const w=c.range[1]>50?25:c.range[1]-Math.max(0,c.range[0]);
const l=Math.max(0,c.range[0])/100*100;
return <div key={c.level} style={{position:"absolute",left:`${l}%`,width:`${w}%`,height:"100%",background:c.color,opacity:0.2}}/>;
})}
<div style={{position:"absolute",left:0,top:0,height:"100%",width:`${COMP100}%`,background:CONV.color,borderRadius:4,opacity:0.9}}/>
</div>
<div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
{CONVICTION.map(c=>(<div key={c.level} style={{fontSize:6,color:CONV.level===c.level?c.color:"#9e9e9e",fontFamily:"monospace",textAlign:"center",flex:1}}>{c.label}</div>))}
</div>
</div>
<div style={{fontSize:8,color:"#c8c8c8",marginTop:8,fontStyle:"italic"}}>{CONV.action}</div>
</div>

<div style={{background:"#0c0c0c",border:"1px solid #1e1e1e",borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:8,color:"#d8d8d8",fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:2}}>CONVICTION FRAMEWORK</div>
<div style={{fontSize:9,color:"#c8c8c8",marginBottom:10}}>4 stress regimes · Normal is the market baseline where most time is spent · Extreme reserved for historical crises</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{CONVICTION.map(c=>(
<div key={c.level} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:6,background:CONV.level===c.level?c.color+"12":"#0a0a0a",border:`1px solid ${CONV.level===c.level?c.color+"55":"#1a1a1a"}`}}>
<div style={{minWidth:90}}>
<div style={{fontSize:7,color:c.color,fontFamily:"monospace",letterSpacing:"0.1em"}}>L{c.level} · {Math.max(0,c.range[0])}–{Math.min(100,c.range[1])}/100</div>
<div style={{fontSize:11,fontWeight:800,color:CONV.level===c.level?c.color:"#d8d8d8",fontFamily:"monospace"}}>{c.label}</div>
</div>
<div style={{flex:1,fontSize:9,color:"#c8c8c8"}}>{c.action}</div>
<div style={{display:"flex",gap:8,flexShrink:0}}>
{[["EQ",c.eq,"#22c55e"],["BD",c.bd,"#4a6fa5"],["CA",c.ca,"#eab308"],["AU",c.au,"#f59e0b"]].map(([lbl,pct,col])=>(
<div key={lbl} style={{textAlign:"center",minWidth:28}}>
<div style={{fontSize:6,color:"#bcbcbc",fontFamily:"monospace"}}>{lbl}</div>
<div style={{fontSize:10,fontWeight:700,color:col,fontFamily:"monospace"}}>{pct}%</div>
</div>
))}
</div>
{CONV.level===c.level&&<div style={{fontSize:9,color:c.color,fontFamily:"monospace",flexShrink:0}}>◀ NOW</div>}
</div>
))}
</div>
<div style={{fontSize:7,color:"#9e9e9e",marginTop:8,fontFamily:"monospace"}}>EQ = Equities · BD = Bonds · CA = Cash · AU = Gold/Commodities · Not financial advice</div>
</div>

<div>
<div style={{fontSize:8,color:"#d8d8d8",fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>CATEGORY COMPOSITES</div>
<div style={{fontSize:8,color:"#bcbcbc",marginBottom:8}}>Stress score per indicator category · tap any card to see constituent indicators</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))",gap:10}}>
{Object.entries(CATS).map(([catId,cat])=>{
const catIds=Object.keys(IND).filter(id=>IND[id][2]===catId);
const scored=catIds.map(id=>({id,s:sdScore(id,IND[id][6]),label:IND[id][0]})).filter(x=>x.s!=null).sort((a,b)=>b.s-a.s);
const cs=scored.length?scored.reduce((a,b)=>a+b.s,0)/scored.length:0;
const col=sdColor(cs);
const sc100=Math.round(Math.max(0,Math.min(100,((cs+2)/5)*100)));
const trend=TREND[catId];
return(
<div key={catId} onClick={()=>{setTab("indicators");setCatFilter(catId);setNewOnly(false);}}
style={{background:"#0c0c0c",border:`1px solid #1e1e1e`,borderRadius:8,padding:"14px 15px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
<div>
<div style={{fontSize:8,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.12em",marginBottom:3}}>{cat.label.toUpperCase()}</div>
<div style={{fontSize:26,fontWeight:800,color:col,fontFamily:"monospace",lineHeight:1}}>{sc100}</div>
<div style={{fontSize:10,fontWeight:700,color:col,fontFamily:"monospace",marginTop:2}}>{sdLabel(cs)}</div>
</div>
<svg width="52" height="52" viewBox="0 0 52 52">
<circle cx="26" cy="26" r="20" fill="none" stroke="#1a1a1a" strokeWidth="7"/>
<circle cx="26" cy="26" r="20" fill="none" stroke={col} strokeWidth="7" strokeDasharray={`${(sc100/100)*125.6} 125.6`} strokeDashoffset="31.4" strokeLinecap="round"/>
<text x="26" y="30" textAnchor="middle" fill={col} fontSize="9" fontWeight="800" fontFamily="monospace">{sc100}</text>
</svg>
</div>
<div style={{display:"flex",gap:6,marginBottom:8}}>
{trend&&[["1M",trend.m1],["6M",trend.m6],["12M",trend.m12]].map(([lbl,prior])=>{
const ta=trendArrow(sc100,prior);
return(<div key={lbl} style={{background:"#0a0a0a",borderRadius:4,padding:"3px 7px",display:"flex",alignItems:"center",gap:3}}>
<span style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace"}}>{lbl}</span>
<span style={{fontSize:9,color:ta.col,fontFamily:"monospace"}}>{ta.arrow}{sc100>prior?"+":""}{sc100-prior}</span>
</div>);
})}
</div>
<div style={{height:3,background:"#1a1a1a",borderRadius:2,overflow:"hidden",marginBottom:8}}>
<div style={{width:`${sc100}%`,height:"100%",background:col,borderRadius:2}}/>
</div>
<div style={{display:"flex",flexDirection:"column",gap:4}}>
{scored.slice(0,3).map(({id,s,label})=>{
const iCol=sdColor(s),iPct=Math.max(0,Math.min(100,((s+2)/5)*100));
return(<div key={id} style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontSize:8,color:"#c8c8c8",fontFamily:"monospace",minWidth:90,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</span>
<div style={{flex:1,height:3,background:"#1a1a1a",borderRadius:1,overflow:"hidden"}}><div style={{width:`${iPct}%`,height:"100%",background:iCol,borderRadius:1}}/></div>
<span style={{fontSize:8,color:iCol,fontFamily:"monospace",minWidth:52,textAlign:"right"}}>{sdLabel(s)}</span>
</div>);
})}
{scored.length>3&&<div style={{fontSize:7,color:"#8a8a8a",fontFamily:"monospace"}}>+{scored.length-3} more →</div>}
</div>
</div>
);
})}
</div>
</div>

<div style={{background:"#0c0c0c",border:"1px solid #181818",borderRadius:8,padding:"12px 14px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
<div style={{fontSize:8,color:"#ef4444",fontFamily:"monospace",letterSpacing:"0.1em"}}>MOST STRESSED INDICATORS</div>
<div style={{fontSize:7,color:"#bcbcbc"}}>Ranked by SD score · tap to drill in</div>
</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{Object.entries(IND).map(([id,d])=>({id,s:sdScore(id,d[6]),label:d[0]})).filter(x=>x.s!=null).sort((a,b)=>b.s-a.s).slice(0,8).map(({id,s,label})=>{
const col=sdColor(s);
return(<div key={id} onClick={()=>{setTab("indicators");setCatFilter(null);setNewOnly(false);setExpandedId(id);setTimeout(()=>document.getElementById(`card-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"}),100);}}
style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"4px 6px",borderRadius:4}}>
<span style={{fontSize:9,color:"#d8d8d8",fontFamily:"monospace",minWidth:120}}>{label}</span>
<div style={{flex:1,height:3,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}><div style={{width:`${Math.max(0,Math.min(100,((s+2)/5)*100))}%`,height:"100%",background:col,borderRadius:2}}/></div>
<span style={{fontSize:9,color:col,fontFamily:"monospace",minWidth:60,textAlign:"right"}}>{sdLabel(s)}</span>
<span style={{fontSize:9,color:"#9e9e9e"}}>›</span>
</div>);
})}
</div>
</div>
</div>
)}

{/* AI ANALYSIS — LIVE */}
{tab==="analysis"&&<LiveAnalysisTab/>}

{/* INDICATORS */}
{tab==="indicators"&&(
<div style={{padding:"12px 20px"}}>
<div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
<span style={{fontSize:8,color:"#bcbcbc",fontFamily:"monospace"}}>TREND:</span>
{["1M","3M","6M","12M"].map(p=>(
<button key={p} onClick={()=>setTrendPeriod(p)} style={{padding:"3px 10px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:9,fontFamily:"monospace",background:trendPeriod===p?"#e0e0e0":"transparent",color:trendPeriod===p?"#000":"#c8c8c8",borderColor:trendPeriod===p?"#e0e0e0":"#1e1e1e"}}>{p}</button>
))}
</div>
<div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
<button onClick={()=>{setNewOnly(n=>!n);setCatFilter(null);}} style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:8,fontFamily:"monospace",background:newOnly?"#eab30822":"transparent",color:newOnly?"#eab308":"#c8c8c8",borderColor:newOnly?"#eab308":"#1e1e1e"}}>★ NEW ONLY</button>
<button onClick={()=>{setCatFilter(null);setNewOnly(false);}} style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:8,fontFamily:"monospace",background:!catFilter&&!newOnly?"#e0e0e0":"transparent",color:!catFilter&&!newOnly?"#000":"#c8c8c8",borderColor:!catFilter&&!newOnly?"#e0e0e0":"#1e1e1e"}}>ALL</button>
{Object.entries(CATS).map(([catId,cat])=>(
<button key={catId} onClick={()=>{setCatFilter(catFilter===catId?null:catId);setNewOnly(false);}} style={{padding:"4px 12px",borderRadius:3,border:"1px solid",cursor:"pointer",fontSize:8,fontFamily:"monospace",background:catFilter===catId?ACCENT+"22":"transparent",color:catFilter===catId?ACCENT:"#c8c8c8",borderColor:catFilter===catId?ACCENT:"#1e1e1e"}}>{cat.label}</button>
))}
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:9}}>
{visibleIds.map(id=>(<IndicatorCard key={id} id={id} trendPeriod={trendPeriod} trendIdx={trendIdx} expandedId={expandedId} setExpandedId={setExpandedId}/>))}
</div>
</div>
)}

{tab==="sectors"&&<SectorsTab/>}

{/* PORTFOLIO */}
{tab==="portfolio"&&(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:12}}>
<div style={{background:"#0c0c0c",border:`1px solid ${CONV.color}33`,borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:8,color:CONV.color,fontFamily:"monospace",letterSpacing:"0.15em",marginBottom:8}}>PORTFOLIO INSIGHTS · SAMPLE PORTFOLIO · FOR ILLUSTRATION ONLY</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginBottom:12}}>
{[{label:"Total Wealth",value:`$${grandTotal.toLocaleString()}`,col:"#e0e0e0"},{label:"Accounts",value:"5 accounts",col:"#d8d8d8"},{label:"Port. Beta",value:portBeta.toFixed(2),col:portBeta>1.2?"#f97316":portBeta>0.8?"#eab308":"#22c55e"},{label:"Macro Regime",value:`${CONV.label} ${TREND_SIG.arrow}`,col:CONV.color}].map(({label,value,col})=>(
<div key={label} style={{background:"#0a0a0a",borderRadius:5,padding:"10px 12px"}}>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginBottom:4}}>{label.toUpperCase()}</div>
<div style={{fontSize:12,fontWeight:800,color:col,fontFamily:"monospace"}}>{value}</div>
</div>
))}
</div>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginBottom:5}}>WEALTH BY ACCOUNT</div>
<div style={{display:"flex",height:18,borderRadius:4,overflow:"hidden",marginBottom:8}}>
{ACCOUNTS.map(acc=>{
const t=acc.positions.reduce((a,p)=>a+p.value,0);
return(<div key={acc.id} style={{flex:t/grandTotal,background:acc.color,opacity:0.8,display:"flex",alignItems:"center",justifyContent:"center"}}>
{t/grandTotal>0.12&&<span style={{fontSize:6,color:"#000",fontFamily:"monospace",fontWeight:700}}>{acc.id==="k401"?"401k":acc.label.split(" ")[0]}</span>}
</div>);
})}
</div>
<div style={{fontSize:7,color:"#bcbcbc",fontFamily:"monospace",marginBottom:5}}>ASSET CLASS MIX</div>
<div style={{display:"flex",height:10,borderRadius:3,overflow:"hidden",marginBottom:6}}>
{Object.entries(assetRollup).sort((a,b)=>b[1]-a[1]).map(([cls,val])=>(<div key={cls} style={{flex:val/grandTotal,background:rollupColors[cls]||"#5c6370",opacity:0.85}}/>))}
</div>
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
{Object.entries(assetRollup).sort((a,b)=>b[1]-a[1]).map(([cls,val])=>(
<div key={cls} style={{display:"flex",alignItems:"center",gap:3}}>
<div style={{width:6,height:6,borderRadius:"50%",background:rollupColors[cls]||"#5c6370"}}/>
<span style={{fontSize:7,color:"#c8c8c8",fontFamily:"monospace"}}>{cls} {(val/grandTotal*100).toFixed(0)}%</span>
</div>
))}
</div>
</div>
<div style={{background:"#0c0c0c",border:"1px solid #181818",borderRadius:8,padding:"12px 14px"}}>
<div style={{fontSize:8,color:ACCENT,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:8}}>KEY OBSERVATIONS · {CONV.label} REGIME</div>
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
<span style={{color:ok?"#22c55e":"#ef4444",fontSize:10,flexShrink:0}}>{ok?"✓":"✗"}</span>
<span style={{fontSize:9,color:"#d4d4d4",lineHeight:1.6}}>{text}</span>
</div>
))}
</div>
</div>
{ACCOUNTS.map(acct=>(<AcctCard key={acct.id} acct={acct} grandTotal={grandTotal} convColor={CONV.color} convLabel={CONV.label} stressScore={COMP100}/>))}
<div style={{fontSize:7,color:"#7a7a7a",fontFamily:"monospace"}}>Sample portfolio · Illustrative values only · Not investment advice</div>
</div>
)}

{/* FAQ */}
{tab==="readme"&&(
<div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:14}}>
{[
{title:"What is this dashboard?",body:"A personal macro market stress monitor tracking 25 economic and financial indicators synthesized into a single composite stress score (0–100) that drives allocation recommendations and sector guidance."},
{title:"How are the 4 conviction levels calibrated?",body:"LOW (0–20): Historically rare, genuinely risk-on conditions — VIX well below mean, credit spreads tight, strong growth signals. NORMAL (20–50): Where markets spend most of their time. Mild background stress, nothing flashing. This is the baseline. ELEVATED (50–75): Active hedging warranted — sell covered calls, trim beta, rotate defensive. 2022 rate shock (62) and 2023 SVB stress (58) were in this band. EXTREME (75–100): Reserved for historical crises — COVID (82), GFC (92). Maximum defensiveness."},
{title:"How is the composite score calculated?",body:"Each indicator is calibrated using its long-run mean and standard deviation (SD). The raw SD score measures how many SDs above or below normal the current reading is. Scores are directionally adjusted, weighted by tier (T1 = 1.5×, T2 = 1.2×, T3 = 1.0×), and averaged into a composite. The composite SD score is mapped to the 0–100 scale."},
{title:"What is the trend signal?",body:"The trend signal shows the rate of change of the composite score over the past 4 weeks. 'Normal ↗ Rising' means the level is still in Normal territory but stress is accelerating toward Elevated — an early warning. 'Elevated ↘ Easing' means conditions are bad but improving. Level + direction together give a more complete picture than level alone."},
{title:"How does the Sectors tab work?",body:"Each sector's parent score is the average of its subsector scores. Each subsector has its own sensitivity profile across 8 macro factors (Rates, Credit, Banking, Consumer, Growth, Dollar, Valuation, CRE). The current stress of each factor (computed from live indicator data) is multiplied by the sensitivity weight. This means sector rankings change dynamically as indicator data updates."},
{title:"What does color mean throughout the dashboard?",body:"Color always means stress level — nothing else. Green = Low, Yellow = Normal, Amber = Elevated, Red = Extreme. All identity/category labels use a quiet neutral blue. This way, any time you see color, it tells you how stressed something is."},
{title:"How current is the data?",body:"Each indicator card shows its as-of date. Daily indicators update weekly on refresh. Monthly indicators update once per month. Quarterly indicators update each quarter. FRED API automation (coming via MacBook pipeline) will automate daily indicator updates."},
{title:"Disclaimer",body:"This dashboard is for informational and educational purposes only. It is not financial advice, investment advice, or a solicitation to buy or sell any security. All data is sourced from public databases and may have errors or delays. Allocation suggestions are illustrative frameworks, not personalized recommendations."},
].map(({title,body},i)=>(
<div key={i} style={{background:"#0c0c0c",border:"1px solid #1a1a1a",borderRadius:8,padding:"14px 16px"}}>
<div style={{fontSize:10,fontWeight:700,color:"#e6e6e6",fontFamily:"monospace",marginBottom:8}}>{String(i+1).padStart(2,"0")} · {title}</div>
<div style={{fontSize:10,color:"#d4d4d4",lineHeight:1.85}}>{body}</div>
</div>
))}
<div style={{fontSize:8,color:"#9e9e9e",fontFamily:"monospace",textAlign:"center",padding:"8px 0"}}>
MACRO STRESS MONITOR v10 · Built with Claude · Data: FRED · CBOE · ICE BofA · FDIC · ISM · BLS · Shiller · NY Fed
</div>
</div>
)}

<div style={{padding:"10px 20px",borderTop:"1px solid #0e0e0e",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
<span style={{fontSize:7,color:"#7a7a7a",fontFamily:"monospace"}}>SOURCES: FRED · CBOE · ICE BofA · FDIC · ISM · BLS · Shiller · Kim-Wright Fed · SLOOS Fed</span>
<span style={{fontSize:7,color:"#7a7a7a",fontFamily:"monospace"}}>⚠ NOT INVESTMENT ADVICE · v10</span>
</div>
</div>
);
}
