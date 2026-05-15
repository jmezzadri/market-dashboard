// AssetTilt — Phase 5 React page reading live v10.1c allocator output.
//
// Consumes:
//   /cycle_board_snapshot.json  — 6 mechanism scores (refreshed nightly at 22:30 UTC)
//   /v10_allocation.json        — today's recommended allocation (refreshed nightly at 22:45 UTC)

import { useState, useEffect, useMemo, useRef } from "react";
import FreshnessDot from "../components/FreshnessDot";
import { InfoTip } from "../InfoTip";
import MTTable from "../components/MTTable";
import PageHero from "../v2/components/PageHero";

const STANCE_COLOR = {
  "Risk On":  "var(--green)",
  "Neutral":  "var(--text-muted)",
  "Cautious": "var(--yellow)",
  "Caution":  "var(--yellow)",
  "Risk Off": "var(--red)",
};
const BAND_COLOR = {
  "risk-on":  "var(--green)",
  "neutral":  "var(--text-muted)",
  "caution":  "var(--yellow)",
  "risk-off": "var(--red)",
};
const RATING_BG = {
  "OW":  "rgba(47,157,106,0.18)",
  "MW":  "rgba(94,94,99,0.18)",
  "UW":  "rgba(200,70,88,0.18)",
};
const RATING_TEXT = { "OW":  "var(--green)", "MW":  "var(--text-muted)", "UW":  "var(--red)" };
const RATING_LABEL = { OW: "Overweight", MW: "Market wt", UW: "Underweight" };

// Sector-level ETFs with metadata so they can be clicked and detail-viewed
const SECTOR_ETFS = {
  "Information Technology": [
    {t:"XLK",  n:"Technology Select Sector SPDR",     er:"0.09%", aum:"$80B", flow:"inflow"},
    {t:"VGT",  n:"Vanguard Information Technology",   er:"0.10%", aum:"$90B", flow:"flat"},
    {t:"FTEC", n:"Fidelity MSCI Information Tech",    er:"0.084%",aum:"$20B", flow:"flat"},
  ],
  "Communication Services": [
    {t:"XLC",  n:"Communication Services Select SPDR",er:"0.09%", aum:"$22B", flow:"inflow"},
    {t:"VOX",  n:"Vanguard Communication Services",   er:"0.10%", aum:"$5B",  flow:"flat"},
    {t:"FCOM", n:"Fidelity MSCI Communication Svcs",  er:"0.084%",aum:"$1.5B",flow:"flat"},
  ],
  "Financials": [
    {t:"XLF",  n:"Financials Select Sector SPDR",     er:"0.09%", aum:"$40B", flow:"inflow"},
    {t:"VFH",  n:"Vanguard Financials",                er:"0.10%", aum:"$11B", flow:"flat"},
    {t:"FNCL", n:"Fidelity MSCI Financials",           er:"0.084%",aum:"$2B",  flow:"flat"},
  ],
  "Health Care": [
    {t:"XLV",  n:"Health Care Select Sector SPDR",    er:"0.09%", aum:"$40B", flow:"inflow"},
    {t:"VHT",  n:"Vanguard Health Care",               er:"0.10%", aum:"$17B", flow:"flat"},
    {t:"FHLC", n:"Fidelity MSCI Health Care",          er:"0.084%",aum:"$3B",  flow:"flat"},
  ],
  "Consumer Discretionary": [
    {t:"XLY",  n:"Consumer Discretionary Select SPDR",er:"0.09%", aum:"$22B", flow:"flat"},
    {t:"VCR",  n:"Vanguard Consumer Discretionary",    er:"0.10%", aum:"$6B",  flow:"flat"},
    {t:"FDIS", n:"Fidelity MSCI Consumer Discretionary",er:"0.084%",aum:"$1.5B",flow:"flat"},
  ],
  "Industrials": [
    {t:"XLI",  n:"Industrial Select Sector SPDR",     er:"0.09%", aum:"$22B", flow:"flat"},
    {t:"VIS",  n:"Vanguard Industrials",               er:"0.10%", aum:"$6B",  flow:"flat"},
    {t:"FIDU", n:"Fidelity MSCI Industrials",          er:"0.084%",aum:"$1.5B",flow:"flat"},
  ],
  "Consumer Staples": [
    {t:"XLP",  n:"Consumer Staples Select SPDR",      er:"0.09%", aum:"$16B", flow:"inflow"},
    {t:"VDC",  n:"Vanguard Consumer Staples",          er:"0.10%", aum:"$7B",  flow:"flat"},
    {t:"FSTA", n:"Fidelity MSCI Consumer Staples",     er:"0.084%",aum:"$1.2B",flow:"flat"},
  ],
  "Energy": [
    {t:"XLE",  n:"Energy Select Sector SPDR",         er:"0.09%", aum:"$32B", flow:"inflow"},
    {t:"VDE",  n:"Vanguard Energy",                    er:"0.10%", aum:"$8B",  flow:"flat"},
    {t:"FENY", n:"Fidelity MSCI Energy",               er:"0.084%",aum:"$1.2B",flow:"flat"},
  ],
  "Materials": [
    {t:"XLB",  n:"Materials Select Sector SPDR",      er:"0.09%", aum:"$5B",  flow:"flat"},
    {t:"VAW",  n:"Vanguard Materials",                 er:"0.10%", aum:"$3B",  flow:"flat"},
    {t:"FMAT", n:"Fidelity MSCI Materials",            er:"0.084%",aum:"$0.6B",flow:"flat"},
  ],
  "Real Estate": [
    {t:"XLRE", n:"Real Estate Select Sector SPDR",    er:"0.09%", aum:"$7B",  flow:"flat"},
    {t:"VNQ",  n:"Vanguard Real Estate",               er:"0.13%", aum:"$35B", flow:"flat"},
    {t:"FREL", n:"Fidelity MSCI Real Estate",          er:"0.084%",aum:"$1.5B",flow:"flat"},
  ],
  "Utilities": [
    {t:"XLU",  n:"Utilities Select Sector SPDR",      er:"0.09%", aum:"$17B", flow:"inflow"},
    {t:"VPU",  n:"Vanguard Utilities",                 er:"0.10%", aum:"$6B",  flow:"flat"},
    {t:"FUTY", n:"Fidelity MSCI Utilities",            er:"0.084%",aum:"$1.6B",flow:"flat"},
  ],
};

// Per-IG ETFs + stocks (rich data for the modal) — keys match v10_allocation.json IG ids
const IG_DETAIL = {
  semis: {
    etfs: [
      {t:"SOXX", n:"iShares Semiconductor ETF",     er:"0.35%", aum:"$14B",  flow:"inflow"},
      {t:"SMH",  n:"VanEck Semiconductor ETF",      er:"0.35%", aum:"$19B",  flow:"strong inflow"},
      {t:"PSI",  n:"Invesco Dynamic Semiconductors",er:"0.57%", aum:"$0.8B", flow:"flat"},
    ],
    stocks: [
      {t:"NVDA",n:"NVIDIA",          px:"$1,024",d5:"+3.2%",flow:"strong inflow"},
      {t:"AVGO",n:"Broadcom",        px:"$1,840",d5:"+2.1%",flow:"moderate inflow"},
      {t:"TSM", n:"Taiwan Semi",     px:"$201",  d5:"+1.5%",flow:"moderate inflow"},
      {t:"AMD", n:"Advanced Micro",  px:"$162",  d5:"−0.8%",flow:"flat"},
      {t:"ASML",n:"ASML Holding",    px:"$795",  d5:"+0.9%",flow:"flat"},
    ],
  },
  software: {
    etfs: [
      {t:"IGV",  n:"iShares Expanded Tech-Software", er:"0.41%", aum:"$6B",  flow:"flat"},
      {t:"XSW",  n:"SPDR S&P Software & Services",   er:"0.35%", aum:"$0.5B",flow:"flat"},
      {t:"CLOU", n:"Global X Cloud Computing",        er:"0.68%", aum:"$0.4B",flow:"outflow"},
    ],
    stocks: [
      {t:"MSFT", n:"Microsoft",  px:"$432",d5:"+1.1%",flow:"inflow"},
      {t:"ORCL", n:"Oracle",     px:"$182",d5:"+0.6%",flow:"flat"},
      {t:"ADBE", n:"Adobe",      px:"$489",d5:"−1.2%",flow:"flat"},
      {t:"CRM",  n:"Salesforce", px:"$294",d5:"−0.4%",flow:"flat"},
      {t:"NOW",  n:"ServiceNow", px:"$881",d5:"+0.8%",flow:"inflow"},
    ],
  },
  hardware: {
    etfs: [
      {t:"IYW", n:"iShares US Technology (broad)",  er:"0.39%", aum:"$22B",flow:"flat"},
      {t:"XLK", n:"Tech Select Sector SPDR (broad)", er:"0.09%", aum:"$80B",flow:"inflow"},
    ],
    stocks: [
      {t:"AAPL",n:"Apple",        px:"$232",d5:"+0.4%",flow:"flat"},
      {t:"DELL",n:"Dell",         px:"$118",d5:"−2.0%",flow:"outflow"},
      {t:"HPQ", n:"HP Inc",       px:"$33", d5:"−0.5%",flow:"flat"},
      {t:"NTAP",n:"NetApp",       px:"$118",d5:"+0.2%",flow:"flat"},
      {t:"PSTG",n:"Pure Storage", px:"$57", d5:"+1.8%",flow:"inflow"},
    ],
  },
  pharma: {
    etfs: [
      {t:"PPH",n:"VanEck Pharmaceutical ETF", er:"0.36%",aum:"$0.5B",flow:"inflow"},
      {t:"IHE",n:"iShares US Pharmaceuticals",er:"0.39%",aum:"$0.6B",flow:"flat"},
      {t:"XPH",n:"SPDR S&P Pharmaceuticals",  er:"0.35%",aum:"$0.4B",flow:"flat"},
    ],
    stocks: [
      {t:"LLY", n:"Eli Lilly",        px:"$852", d5:"+2.4%",flow:"strong inflow"},
      {t:"JNJ", n:"Johnson & Johnson",px:"$157", d5:"+0.6%",flow:"inflow"},
      {t:"MRK", n:"Merck",            px:"$103", d5:"+0.3%",flow:"flat"},
      {t:"ABBV",n:"AbbVie",           px:"$181", d5:"+0.9%",flow:"inflow"},
      {t:"PFE", n:"Pfizer",           px:"$28",  d5:"−0.4%",flow:"flat"},
    ],
  },
  devices: {
    etfs: [
      {t:"IHI",n:"iShares US Medical Devices ETF", er:"0.39%",aum:"$5B",  flow:"inflow"},
      {t:"XHE",n:"SPDR S&P Health Care Equipment", er:"0.35%",aum:"$0.4B",flow:"flat"},
    ],
    stocks: [
      {t:"ABT",n:"Abbott",           px:"$118",d5:"+0.8%",flow:"inflow"},
      {t:"MDT",n:"Medtronic",        px:"$93", d5:"+0.3%",flow:"flat"},
      {t:"BSX",n:"Boston Scientific",px:"$95", d5:"+1.1%",flow:"inflow"},
      {t:"SYK",n:"Stryker",          px:"$393",d5:"+0.5%",flow:"flat"},
      {t:"ZBH",n:"Zimmer Biomet",    px:"$108",d5:"−0.2%",flow:"flat"},
    ],
  },
  biotech: {
    etfs: [
      {t:"IBB",n:"iShares Biotechnology ETF", er:"0.45%",aum:"$9B",  flow:"inflow"},
      {t:"XBI",n:"SPDR S&P Biotech",          er:"0.35%",aum:"$7B",  flow:"flat"},
      {t:"BBH",n:"VanEck Biotech ETF",        er:"0.35%",aum:"$0.6B",flow:"flat"},
    ],
    stocks: [
      {t:"AMGN",n:"Amgen",     px:"$294",d5:"+0.4%",flow:"flat"},
      {t:"VRTX",n:"Vertex",    px:"$487",d5:"+1.6%",flow:"inflow"},
      {t:"GILD",n:"Gilead",    px:"$94", d5:"+0.2%",flow:"flat"},
      {t:"REGN",n:"Regeneron", px:"$728",d5:"−0.3%",flow:"flat"},
    ],
  },
  banks: {
    etfs: [
      {t:"KBE",n:"SPDR S&P Bank ETF (large + regional)", er:"0.35%",aum:"$1.7B",flow:"inflow"},
      {t:"KRE",n:"SPDR S&P Regional Banking",            er:"0.35%",aum:"$3.5B",flow:"inflow"},
      {t:"IAT",n:"iShares US Regional Banks",            er:"0.41%",aum:"$0.8B",flow:"flat"},
    ],
    stocks: [
      {t:"JPM",n:"JPMorgan Chase",  px:"$248",d5:"+1.4%",flow:"inflow"},
      {t:"BAC",n:"Bank of America", px:"$48", d5:"+0.8%",flow:"flat"},
      {t:"WFC",n:"Wells Fargo",     px:"$74", d5:"+1.0%",flow:"inflow"},
      {t:"C",  n:"Citigroup",       px:"$73", d5:"+0.6%",flow:"flat"},
      {t:"GS", n:"Goldman Sachs",   px:"$596",d5:"+1.8%",flow:"inflow"},
      {t:"MS", n:"Morgan Stanley",  px:"$130",d5:"+1.1%",flow:"inflow"},
    ],
  },
  insurance: {
    etfs: [
      {t:"KIE",n:"SPDR S&P Insurance ETF", er:"0.35%",aum:"$0.8B",flow:"flat"},
      {t:"IAK",n:"iShares US Insurance",   er:"0.41%",aum:"$0.7B",flow:"flat"},
    ],
    stocks: [
      {t:"BRK.B",n:"Berkshire Hathaway B", px:"$461",d5:"+0.4%",flow:"flat"},
      {t:"PGR",  n:"Progressive",          px:"$259",d5:"+0.9%",flow:"inflow"},
      {t:"MMC",  n:"Marsh McLennan",       px:"$229",d5:"+0.3%",flow:"flat"},
      {t:"AIG",  n:"AIG",                  px:"$78", d5:"+0.6%",flow:"flat"},
    ],
  },
  divfin: {
    etfs: [
      {t:"IAI",n:"iShares US Broker-Dealers",  er:"0.41%",aum:"$0.5B",flow:"flat"},
      {t:"KCE",n:"SPDR S&P Capital Markets",   er:"0.35%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"V",   n:"Visa",          px:"$346", d5:"+0.2%",flow:"flat"},
      {t:"MA",  n:"Mastercard",    px:"$555", d5:"+0.5%",flow:"flat"},
      {t:"SCHW",n:"Charles Schwab",px:"$76",  d5:"+0.8%",flow:"inflow"},
      {t:"BLK", n:"BlackRock",     px:"$1042",d5:"+1.1%",flow:"inflow"},
      {t:"KKR", n:"KKR & Co",      px:"$159", d5:"+1.5%",flow:"inflow"},
    ],
  },
  intmedia: {
    etfs: [
      {t:"XLC",  n:"Comm Services SPDR (broad)", er:"0.09%",aum:"$22B", flow:"inflow"},
      {t:"PNQI", n:"Invesco NASDAQ Internet",     er:"0.60%",aum:"$0.7B",flow:"flat"},
    ],
    stocks: [
      {t:"META", n:"Meta",         px:"$589",d5:"+1.3%",flow:"inflow"},
      {t:"GOOGL",n:"Alphabet",     px:"$176",d5:"+0.8%",flow:"flat"},
      {t:"NFLX", n:"Netflix",      px:"$762",d5:"+1.7%",flow:"inflow"},
      {t:"TTD",  n:"Trade Desk",   px:"$118",d5:"+0.6%",flow:"flat"},
    ],
  },
  telecom: {
    etfs: [
      {t:"IYZ", n:"iShares US Telecommunications",er:"0.39%",aum:"$0.4B",flow:"flat"},
      {t:"FCOM",n:"Fidelity MSCI Communication", er:"0.084%",aum:"$1.5B",flow:"flat"},
    ],
    stocks: [
      {t:"VZ",   n:"Verizon",  px:"$43", d5:"+0.4%",flow:"flat"},
      {t:"T",    n:"AT&T",     px:"$22", d5:"+0.6%",flow:"inflow"},
      {t:"TMUS", n:"T-Mobile", px:"$219",d5:"+0.9%",flow:"inflow"},
      {t:"CMCSA",n:"Comcast",  px:"$42", d5:"−0.3%",flow:"flat"},
    ],
  },
  capgoods: {
    etfs: [
      {t:"XLI",n:"Industrial Select Sector SPDR (broad)",er:"0.09%",aum:"$22B",flow:"flat"},
      {t:"VIS",n:"Vanguard Industrials (broad)",          er:"0.10%",aum:"$6B", flow:"flat"},
    ],
    stocks: [
      {t:"GE", n:"GE Aerospace",px:"$215",d5:"+1.2%",flow:"inflow"},
      {t:"CAT",n:"Caterpillar", px:"$408",d5:"+0.7%",flow:"flat"},
      {t:"HON",n:"Honeywell",   px:"$211",d5:"+0.3%",flow:"flat"},
      {t:"DE", n:"Deere",       px:"$478",d5:"−0.4%",flow:"flat"},
      {t:"ETN",n:"Eaton",       px:"$345",d5:"+0.9%",flow:"inflow"},
    ],
  },
  transport: {
    etfs: [
      {t:"IYT",n:"iShares US Transportation", er:"0.39%",aum:"$0.7B",flow:"flat"},
      {t:"XTN",n:"SPDR S&P Transportation",   er:"0.35%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"UPS",n:"UPS",           px:"$130",d5:"+0.6%",flow:"flat"},
      {t:"FDX",n:"FedEx",         px:"$282",d5:"+0.8%",flow:"flat"},
      {t:"UNP",n:"Union Pacific", px:"$227",d5:"+0.3%",flow:"flat"},
      {t:"CSX",n:"CSX",           px:"$32", d5:"+0.5%",flow:"flat"},
      {t:"DAL",n:"Delta Airlines",px:"$57", d5:"+1.4%",flow:"inflow"},
    ],
  },
  defense: {
    etfs: [
      {t:"ITA",n:"iShares US Aerospace & Defense",er:"0.40%",aum:"$5B",flow:"inflow"},
      {t:"XAR",n:"SPDR S&P Aerospace & Defense",   er:"0.35%",aum:"$2B",flow:"inflow"},
      {t:"PPA",n:"Invesco Aerospace & Defense",    er:"0.58%",aum:"$2B",flow:"flat"},
    ],
    stocks: [
      {t:"RTX",n:"RTX Corp",         px:"$117",d5:"+0.5%",flow:"flat"},
      {t:"LMT",n:"Lockheed Martin",  px:"$542",d5:"+0.8%",flow:"inflow"},
      {t:"BA", n:"Boeing",           px:"$182",d5:"−1.2%",flow:"outflow"},
      {t:"NOC",n:"Northrop Grumman", px:"$486",d5:"+0.4%",flow:"flat"},
      {t:"GD", n:"General Dynamics", px:"$278",d5:"+0.6%",flow:"flat"},
    ],
  },
  foodbev: {
    etfs: [
      {t:"PBJ",n:"Invesco Food & Beverage",     er:"0.57%",aum:"$0.2B",flow:"flat"},
      {t:"XLP",n:"Cons Staples Select SPDR (broad)",er:"0.09%",aum:"$16B",flow:"inflow"},
    ],
    stocks: [
      {t:"KO",  n:"Coca-Cola",  px:"$66", d5:"+0.3%",flow:"flat"},
      {t:"PEP", n:"PepsiCo",    px:"$159",d5:"+0.4%",flow:"flat"},
      {t:"COST",n:"Costco",     px:"$904",d5:"+1.2%",flow:"inflow"},
      {t:"WMT", n:"Walmart",    px:"$95", d5:"+0.8%",flow:"inflow"},
      {t:"MDLZ",n:"Mondelez",   px:"$66", d5:"+0.2%",flow:"flat"},
    ],
  },
  household: {
    etfs: [
      {t:"XLP",n:"Cons Staples Select SPDR (broad)",er:"0.09%",aum:"$16B",flow:"inflow"},
      {t:"VDC",n:"Vanguard Cons Staples (broad)",   er:"0.10%",aum:"$7B", flow:"flat"},
    ],
    stocks: [
      {t:"PG", n:"Procter & Gamble", px:"$170",d5:"+0.4%",flow:"inflow"},
      {t:"CL", n:"Colgate-Palmolive",px:"$96", d5:"+0.3%",flow:"flat"},
      {t:"KMB",n:"Kimberly-Clark",   px:"$140",d5:"+0.2%",flow:"flat"},
      {t:"EL", n:"Estée Lauder",     px:"$80", d5:"−1.5%",flow:"outflow"},
    ],
  },
  retail: {
    etfs: [
      {t:"XRT",n:"SPDR S&P Retail",  er:"0.35%",aum:"$0.4B",flow:"flat"},
      {t:"RTH",n:"VanEck Retail ETF", er:"0.35%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"AMZN",n:"Amazon",     px:"$224",d5:"−0.8%",flow:"outflow"},
      {t:"HD",  n:"Home Depot", px:"$402",d5:"−1.2%",flow:"outflow"},
      {t:"MCD", n:"McDonald's", px:"$294",d5:"+0.4%",flow:"flat"},
      {t:"SBUX",n:"Starbucks",  px:"$96", d5:"−2.1%",flow:"outflow"},
      {t:"NKE", n:"Nike",       px:"$76", d5:"−1.4%",flow:"outflow"},
    ],
  },
  autos: {
    etfs: [
      {t:"CARZ",n:"First Trust Future Vehicles",        er:"0.70%",aum:"$0.05B",flow:"outflow"},
      {t:"DRIV",n:"Global X Autonomous & Electric Vehs",er:"0.68%",aum:"$0.5B", flow:"outflow"},
    ],
    stocks: [
      {t:"TSLA",n:"Tesla",          px:"$292",d5:"−2.4%",flow:"outflow"},
      {t:"F",   n:"Ford",           px:"$11", d5:"−1.8%",flow:"flat"},
      {t:"GM",  n:"General Motors", px:"$53", d5:"−1.2%",flow:"outflow"},
      {t:"RIVN",n:"Rivian",         px:"$11", d5:"−3.1%",flow:"outflow"},
    ],
  },
  oilgas: {
    etfs: [
      {t:"XOP",n:"SPDR S&P Oil & Gas E&P",         er:"0.35%",aum:"$2B", flow:"inflow"},
      {t:"IEO",n:"iShares US Oil & Gas Exploration",er:"0.39%",aum:"$0.7B",flow:"flat"},
      {t:"XLE",n:"Energy Select Sector SPDR (broad)",er:"0.09%",aum:"$32B",flow:"inflow"},
    ],
    stocks: [
      {t:"XOM",n:"ExxonMobil",     px:"$118",d5:"+1.4%",flow:"inflow"},
      {t:"CVX",n:"Chevron",        px:"$155",d5:"+0.9%",flow:"inflow"},
      {t:"COP",n:"ConocoPhillips", px:"$108",d5:"+1.6%",flow:"inflow"},
      {t:"EOG",n:"EOG Resources",  px:"$130",d5:"+1.1%",flow:"flat"},
      {t:"OXY",n:"Occidental",     px:"$50", d5:"+1.8%",flow:"inflow"},
    ],
  },
  oilfield: {
    etfs: [
      {t:"OIH",n:"VanEck Oil Services",            er:"0.35%",aum:"$1.5B",flow:"flat"},
      {t:"IEZ",n:"iShares US Oil Equipment & Svcs",er:"0.39%",aum:"$0.2B",flow:"flat"},
      {t:"XES",n:"SPDR S&P Oil & Gas Equipment",   er:"0.35%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"SLB",n:"Schlumberger", px:"$44",d5:"+0.6%",flow:"flat"},
      {t:"HAL",n:"Halliburton",  px:"$28",d5:"+1.0%",flow:"flat"},
      {t:"BKR",n:"Baker Hughes", px:"$43",d5:"+0.4%",flow:"flat"},
      {t:"FTI",n:"TechnipFMC",   px:"$30",d5:"+1.2%",flow:"inflow"},
    ],
  },
  mining: {
    etfs: [
      {t:"XME",n:"SPDR S&P Metals & Mining",er:"0.35%",aum:"$1.7B",flow:"inflow"},
      {t:"GDX",n:"VanEck Gold Miners",       er:"0.51%",aum:"$13B", flow:"strong inflow"},
      {t:"SLX",n:"VanEck Steel ETF",         er:"0.55%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"LIN",n:"Linde",            px:"$478",d5:"+0.4%",flow:"flat"},
      {t:"FCX",n:"Freeport-McMoRan", px:"$45", d5:"+1.6%",flow:"inflow"},
      {t:"NEM",n:"Newmont",          px:"$48", d5:"+1.2%",flow:"inflow"},
      {t:"NUE",n:"Nucor",            px:"$152",d5:"+0.8%",flow:"flat"},
    ],
  },
  chemicals: {
    etfs: [
      {t:"PYZ",n:"Invesco Basic Materials Momentum", er:"0.60%",aum:"$0.05B",flow:"flat"},
      {t:"XLB",n:"Materials Select Sector SPDR (broad)",er:"0.09%",aum:"$5B",flow:"flat"},
    ],
    stocks: [
      {t:"SHW",n:"Sherwin-Williams",px:"$365",d5:"+0.6%",flow:"flat"},
      {t:"APD",n:"Air Products",     px:"$305",d5:"+0.3%",flow:"flat"},
      {t:"ECL",n:"Ecolab",           px:"$253",d5:"+0.8%",flow:"flat"},
      {t:"DOW",n:"Dow Inc",          px:"$40", d5:"−0.4%",flow:"flat"},
    ],
  },
  reits: {
    etfs: [
      {t:"VNQ", n:"Vanguard Real Estate (broadest)",er:"0.13%",aum:"$35B", flow:"flat"},
      {t:"XLRE",n:"Real Estate Select Sector SPDR", er:"0.09%",aum:"$7B",  flow:"flat"},
      {t:"MORT",n:"VanEck Mortgage REIT",            er:"0.42%",aum:"$0.2B",flow:"flat"},
    ],
    stocks: [
      {t:"PLD", n:"Prologis",       px:"$112",d5:"+0.4%",flow:"flat"},
      {t:"AMT", n:"American Tower", px:"$203",d5:"+0.2%",flow:"flat"},
      {t:"EQIX",n:"Equinix",        px:"$894",d5:"+0.8%",flow:"inflow"},
      {t:"WELL",n:"Welltower",      px:"$140",d5:"+1.1%",flow:"inflow"},
      {t:"SPG", n:"Simon Property", px:"$176",d5:"+0.3%",flow:"flat"},
    ],
  },
  electric: {
    etfs: [
      {t:"XLU", n:"Utilities Select Sector SPDR",er:"0.09%",aum:"$17B",flow:"inflow"},
      {t:"VPU", n:"Vanguard Utilities",            er:"0.10%",aum:"$6B", flow:"flat"},
      {t:"FUTY",n:"Fidelity MSCI Utilities",       er:"0.084%",aum:"$1.6B",flow:"flat"},
    ],
    stocks: [
      {t:"NEE",n:"NextEra Energy",       px:"$74", d5:"+0.6%",flow:"flat"},
      {t:"SO", n:"Southern Company",     px:"$87", d5:"+0.3%",flow:"flat"},
      {t:"DUK",n:"Duke Energy",          px:"$117",d5:"+0.2%",flow:"flat"},
      {t:"CEG",n:"Constellation Energy", px:"$222",d5:"+1.8%",flow:"inflow"},
    ],
  },
  utilities: {  // alias for electric
    etfs: [
      {t:"XLU", n:"Utilities Select Sector SPDR",er:"0.09%",aum:"$17B",flow:"inflow"},
      {t:"VPU", n:"Vanguard Utilities",            er:"0.10%",aum:"$6B", flow:"flat"},
      {t:"FUTY",n:"Fidelity MSCI Utilities",       er:"0.084%",aum:"$1.6B",flow:"flat"},
    ],
    stocks: [
      {t:"NEE",n:"NextEra Energy",       px:"$74", d5:"+0.6%",flow:"flat"},
      {t:"SO", n:"Southern Company",     px:"$87", d5:"+0.3%",flow:"flat"},
      {t:"DUK",n:"Duke Energy",          px:"$117",d5:"+0.2%",flow:"flat"},
      {t:"CEG",n:"Constellation Energy", px:"$222",d5:"+1.8%",flow:"inflow"},
    ],
  },
};

// Defensive sleeve buckets (always shown as rows, $0 if defensive sleeve off)
const DEFENSIVE_BUCKETS = [
  {ticker:"BIL", name:"Cash · 1-3M Treasury Bills"},
  {ticker:"TLT", name:"Long Treasuries · 20+ Yr"},
  {ticker:"GLD", name:"Gold"},
  {ticker:"LQD", name:"IG Corporate Bonds"},
];


// Short editorial names for sector hero copy. GICS full names are accurate
// but read as boilerplate; these are how a PM actually says them.
const SECTOR_SHORT = {
  "Information Technology":  "Tech",
  "Communication Services":  "Comm Services",
  "Consumer Discretionary":  "Consumer Disc",
  "Consumer Staples":        "Staples",
  "Health Care":             "Healthcare",
  "Real Estate":             "REITs",
  "Financials":              "Financials",
  "Industrials":             "Industrials",
  "Energy":                  "Energy",
  "Materials":               "Materials",
  "Utilities":               "Utilities",
};
function tiltHero(sectors) {
  if (!sectors || !sectors.length) return null;
  const sorted = [...sectors].sort((a, b) => (b.vs_spy_pp ?? 0) - (a.vs_spy_pp ?? 0));
  const top = sorted[0];
  const bot = sorted[sorted.length - 1];
  if (!top || !bot) return null;
  const topMag = Math.round(Math.abs(top.vs_spy_pp ?? 0));
  const botMag = Math.round(Math.abs(bot.vs_spy_pp ?? 0));
  if (topMag < 1 && botMag < 1) return null;
  return {
    topShort: SECTOR_SHORT[top.sector] || top.sector,
    botShort: SECTOR_SHORT[bot.sector] || bot.sector,
    topFull: top.sector,
    botFull: bot.sector,
    topMag, botMag,
  };
}

function bandOf(score) {
  if (score < 25) return "risk-on";
  if (score < 50) return "neutral";
  if (score < 75) return "caution";
  return "risk-off";
}
function bandLabel(b) {
  return { "risk-on": "Risk On", "neutral": "Neutral", "caution": "Caution", "risk-off": "Risk Off" }[b];
}
function flowColor(f) {
  if (!f) return "var(--text-muted)";
  if (f.includes("strong inflow")) return "var(--green)";
  if (f.includes("inflow")) return "var(--green)";
  if (f.includes("outflow")) return "var(--red)";
  return "var(--text-muted)";
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StanceBadge({ stance }) {
  const color = STANCE_COLOR[stance] || "var(--text-muted)";
  const bg = stance === "Risk On" ? "rgba(47,157,106,0.14)" :
             stance === "Cautious" || stance === "Caution" ? "rgba(107,122,133,0.16)" :
             stance === "Risk Off" ? "rgba(200,70,88,0.16)" :
             "rgba(94,94,99,0.16)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px", borderRadius: 999, background: bg, color,
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
      letterSpacing: "0.10em", textTransform: "uppercase",
      border: `0.5px solid ${color}40`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {stance}
    </span>
  );
}

function MechanismCard({ mechanism, onClick }) {
  const b = bandOf(mechanism.score);
  return (
    <div onClick={() => onClick(mechanism)} style={{
      padding: "12px 14px", background: "var(--surface)",
      border: "0.5px solid var(--border)", borderRadius: 8,
      borderLeft: `3px solid ${BAND_COLOR[b]}`,
      cursor: "pointer", transition: "background 0.12s",
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2)"}
    onMouseLeave={(e) => e.currentTarget.style.background = "var(--surface)"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", letterSpacing: "0.10em", fontWeight: 600 }}>
          {mechanism.num} · {mechanism.name.toUpperCase()}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {mechanism.score}/100
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: BAND_COLOR[b], marginTop: 4 }}>
        {bandLabel(b)}
      </div>
    </div>
  );
}

function KPIBox({ label, value }) {
  return (
    <div style={{
      padding: "10px 14px", background: "var(--surface-2)",
      borderRadius: 6, borderLeft: "3px solid var(--accent)",
    }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.10em", fontWeight: 600, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function EtfChip({ etf, onClick }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(etf); }} style={{
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
      padding: "1px 7px", marginLeft: 4, marginRight: 1,
      background: "transparent", border: "0.5px solid var(--border)",
      borderRadius: 3, color: "var(--accent)", cursor: "pointer",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent)"; e.currentTarget.style.color = "#fff"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--accent)"; }}
    >{etf.t || etf}</button>
  );
}

// SectorTable — migrated to shared MTTable primitive (sweep PR, 2026-05-12).
// Bars in the Tilt-vs-SPY column killed per Joe directive — colored % numbers
// instead. IGs render as inline expanded child rows via MTTable's expandable
// API. Defensive buckets merged into the same rows array, tagged via
// _isDefensive so they render their own N/A markers.
function SectorTable({ sectors, igs, leverage, asOf, sectorPerf, defensiveBuckets, defensivePerBucket, onSectorClick, onIGClick, onEtfClick }) {
  const [openSectorKey, setOpenSectorKey] = useState(null);

  // Enrich each sector row with perf + vol from sector_perf.json
  const sectorRows = useMemo(() => sectors.map(sec => {
    const perf = sectorPerf?.sectors?.[sec.sector] || {};
    return {
      ...sec,
      tiltDollar: sec.dollar * leverage,
      perf_1m: perf.perf_1m ?? null,
      perf_3m: perf.perf_3m ?? null,
      perf_ttm: perf.perf_ttm ?? null,
      vol_ttm: perf.vol_ttm ?? null,
      proxy: perf.proxy || null,
      _isDefensive: false,
      _key: sec.sector,
    };
  }), [sectors, leverage, sectorPerf]);

  // Defensive bucket rows — same column shape; N/A for tilt + rating.
  const defensiveRows = useMemo(() => (defensiveBuckets || []).map(b => {
    const perf = sectorPerf?.sectors?.[b.ticker] || {};
    return {
      sector: b.name,
      ticker: b.ticker,
      tiltDollar: defensivePerBucket || 0,
      vs_spy_pp: null,
      rating: null,
      perf_1m: perf.perf_1m ?? null,
      perf_3m: perf.perf_3m ?? null,
      perf_ttm: perf.perf_ttm ?? null,
      vol_ttm: perf.vol_ttm ?? null,
      proxy: perf.proxy || b.ticker,
      _isDefensive: true,
      _key: "defensive:" + b.ticker,
    };
  }), [defensiveBuckets, defensivePerBucket, sectorPerf]);

  const allRows = useMemo(() => [...sectorRows, ...defensiveRows], [sectorRows, defensiveRows]);

  // Tooltip copy — plain English, exposed via InfoTip on the perf/vol headers
  const proxyDef = "Each sector is represented by its primary Select Sector SPDR ETF — Tech is XLK, Financials is XLF, Health Care is XLV, and so on. These are the most-traded sector funds, so the price you see is what an investor would actually capture if they bought the sector.";
  const returnDef = "Returns are price-only close-to-close (no dividends reinvested). 1M = trailing 21 trading days, 3M = trailing 63, TTM = trailing 252. Total-return numbers (including dividends) would be slightly higher.";
  const volDef = "Trailing 12-month annualized realized volatility. Standard deviation of daily log returns over the last 252 trading days, scaled to a yearly figure (multiplied by √252). This is the historical realized vol — not implied vol from options.";

  const fmtPct = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  const fmtVol = (v) => v == null ? "—" : v.toFixed(1) + "%";
  const pctColor = (v) => v == null ? "var(--text-muted)" : v < 0 ? "var(--red)" : v > 0 ? "var(--green)" : "var(--text-muted)";
  const tiltColor = (v) => v == null ? "var(--text-muted)" : v < 0 ? "var(--red)" : v > 0 ? "var(--green)" : "var(--text-muted)";

  const columns = [
    {
      key: "sector",
      label: "Equity sectors",
      defaultWidth: 230,
      headerExtra: <FreshnessDot indicatorId="v10_allocation" asOfIso={asOf} />,
      sortValue: (r) => r.sector,
      render: (r) => {
        const sectorIGs = !r._isDefensive ? igs.filter(ig => ig.sector === r.sector) : [];
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{r.sector}</span>
            {r._isDefensive && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{r.ticker}</span>
            )}
            {sectorIGs.length > 0 && (
              <span
                role="button"
                aria-label={openSectorKey === r.sector ? "Collapse industry groups" : "Expand industry groups"}
                onClick={(e) => { e.stopPropagation(); setOpenSectorKey(openSectorKey === r.sector ? null : r.sector); }}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 600,
                  color: "var(--text-muted)", background: "var(--surface-2)",
                  border: "0.5px solid var(--border)",
                  transition: "transform 0.15s",
                  transform: openSectorKey === r.sector ? "rotate(90deg)" : "rotate(0deg)",
                  cursor: "pointer",
                }}
              >▸</span>
            )}
          </span>
        );
      },
      renderChild: (ig) => (
        <span style={{ paddingLeft: 28, fontWeight: 500, color: "var(--text-2)" }}>{ig.name}</span>
      ),
    },
    {
      key: "vs_spy",
      label: "Tilt vs SPY",
      numeric: true,
      defaultWidth: 110,
      sortValue: (r) => r.vs_spy_pp,
      render: (r) => {
        if (r._isDefensive || r.vs_spy_pp == null) {
          return <span style={{ color: "var(--text-muted)" }}>N/A</span>;
        }
        return <span style={{ color: tiltColor(r.vs_spy_pp), fontWeight: 600 }}>{(r.vs_spy_pp > 0 ? "+" : "") + r.vs_spy_pp.toFixed(1) + "%"}</span>;
      },
      renderChild: (ig) => (
        ig.vs_spy_pp == null
          ? <span style={{ color: "var(--text-muted)" }}>—</span>
          : <span style={{ color: tiltColor(ig.vs_spy_pp) }}>{(ig.vs_spy_pp > 0 ? "+" : "") + ig.vs_spy_pp.toFixed(1) + "%"}</span>
      ),
    },
    {
      key: "alloc",
      label: "Recommended allocation",
      numeric: true,
      defaultWidth: 170,
      sortValue: (r) => r.tiltDollar,
      render: (r) => {
        const off = r._isDefensive && (r.tiltDollar || 0) < 0.01;
        return <span style={{ fontWeight: 600, color: off ? "var(--text-muted)" : "var(--text)" }}>${(r.tiltDollar || 0).toFixed(2)}</span>;
      },
      renderChild: (ig) => <span>${((ig.dollar || 0) * leverage).toFixed(2)}</span>,
    },
    {
      key: "p1m", label: "1M", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + returnDef} />,
      sortValue: (r) => r.perf_1m,
      render: (r) => <span style={{ color: pctColor(r.perf_1m) }}>{fmtPct(r.perf_1m)}</span>,
      renderChild: (ig) => {
        const p = sectorPerf?.industry_groups?.[ig.id]?.perf_1m;
        return <span style={{ color: pctColor(p) }}>{fmtPct(p)}</span>;
      },
    },
    {
      key: "p3m", label: "3M", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + returnDef} />,
      sortValue: (r) => r.perf_3m,
      render: (r) => <span style={{ color: pctColor(r.perf_3m) }}>{fmtPct(r.perf_3m)}</span>,
      renderChild: (ig) => {
        const p = sectorPerf?.industry_groups?.[ig.id]?.perf_3m;
        return <span style={{ color: pctColor(p) }}>{fmtPct(p)}</span>;
      },
    },
    {
      key: "pttm", label: "TTM", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + returnDef} />,
      sortValue: (r) => r.perf_ttm,
      render: (r) => <span style={{ color: pctColor(r.perf_ttm) }}>{fmtPct(r.perf_ttm)}</span>,
      renderChild: (ig) => {
        const p = sectorPerf?.industry_groups?.[ig.id]?.perf_ttm;
        return <span style={{ color: pctColor(p) }}>{fmtPct(p)}</span>;
      },
    },
    {
      key: "vol", label: "Vol", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + volDef} />,
      sortValue: (r) => r.vol_ttm,
      render: (r) => <span style={{ color: "var(--text-2)" }}>{fmtVol(r.vol_ttm)}</span>,
      renderChild: (ig) => {
        const v = sectorPerf?.industry_groups?.[ig.id]?.vol_ttm;
        return <span style={{ color: "var(--text-2)" }}>{fmtVol(v)}</span>;
      },
    },
    {
      key: "rating",
      label: "Rating",
      numeric: true,
      defaultWidth: 90,
      sortValue: (r) => ({ "OW": 2, "MW": 1, "UW": 0 }[r.rating] ?? -1),
      render: (r) => {
        if (r._isDefensive || !r.rating) {
          return <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>N/A</span>;
        }
        return (
          <span style={{
            display: "inline-block", padding: "3px 9px", fontSize: 10, fontWeight: 600,
            background: RATING_BG[r.rating], color: RATING_TEXT[r.rating], borderRadius: 999,
          }}>{r.rating}</span>
        );
      },
      renderChild: (ig) => (
        ig.rating
          ? <span style={{
              display: "inline-block", padding: "2px 7px", fontSize: 9, fontWeight: 600,
              background: RATING_BG[ig.rating], color: RATING_TEXT[ig.rating], borderRadius: 999,
            }}>{ig.rating}</span>
          : <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>—</span>
      ),
    },
  ];

  // Row click — defensive rows open the bucket ETF detail; sector rows open
  // the sector side panel. Click on the expand arrow inside the sector cell
  // is captured separately and stops propagation, so it doesn't reach here.
  const handleRowClick = (r) => {
    if (r._isDefensive) { onEtfClick && onEtfClick(r.ticker); }
    else { onSectorClick && onSectorClick(r); }
  };

  return (
    <MTTable
      columns={columns}
      rows={allRows}
      rowKey="_key"
      onRowClick={handleRowClick}
      storageKey="recommended-allocations-v1"
      expandable={{
        isExpanded: (r) => !r._isDefensive && openSectorKey === r.sector,
        childRows: (r) => igs.filter(ig => ig.sector === r.sector),
        onChildClick: (ig) => onIGClick && onIGClick(ig),
      }}
    />
  );
}

function DefensiveRow({ bucket, dollar }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.6fr 80px 80px 80px",
      gap: 12, padding: "10px 14px", fontSize: 13,
      borderBottom: "0.5px solid var(--border)",
      opacity: dollar < 0.01 ? 0.55 : 1,
    }}>
      <div>
        <strong>{bucket.ticker}</strong>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
          {bucket.name}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, dollar * 2.5)}%`, background: "var(--text-muted)" }} />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right" }}>
        ${dollar.toFixed(2)}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right", color: "var(--text-muted)" }}>
        {dollar < 0.01 ? "off" : "active"}
      </div>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────

function ModalShell({ title, subtitle, badge, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
      display: "flex", justifyContent: "center", alignItems: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", borderRadius: 12, padding: 24,
        maxWidth: 720, width: "92%", maxHeight: "85vh", overflowY: "auto",
        border: "0.5px solid var(--border)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500 }}>{title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {badge}
            <button onClick={onClose} style={{
              background: "transparent", border: "0.5px solid var(--border)",
              borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer", color: "var(--text)",
            }}>Close ✕</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ETFTable({ etfs, onEtfClick }) {
  if (!etfs || !etfs.length) return null;
  const columns = [
    { key: "t",    label: "Ticker",   render: (r) => <strong style={{ fontFamily: "var(--font-mono)", color: onEtfClick ? "var(--accent)" : "var(--text)" }}>{r.t}</strong> },
    { key: "n",    label: "Name" },
    { key: "er",   label: "Expense", render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.er}</span> },
    { key: "aum",  label: "AUM",     render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.aum}</span> },
    { key: "flow", label: "30d flow", render: (r) => <span style={{ color: flowColor(r.flow) }}>{r.flow}</span> },
  ];
  return (
    <MTTable
      columns={columns}
      rows={etfs}
      rowKey="t"
      onRowClick={onEtfClick}
      features="full"
      storageKey="aa_etfs"
    />
  );
}

function StockTable({ stocks, onTickerClick }) {
  if (!stocks || !stocks.length) return null;
  const d5Color = (v) => v.startsWith("+") ? "var(--green)" : v.startsWith("−") ? "var(--red)" : "var(--text-muted)";
  const columns = [
    { key: "t",    label: "Ticker",   render: (r) => <strong style={{ fontFamily: "var(--font-mono)", color: onTickerClick ? "var(--accent)" : "var(--text)" }}>{r.t}</strong> },
    { key: "n",    label: "Name" },
    { key: "px",   label: "Last", render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.px}</span> },
    { key: "d5",   label: "5d",   render: (r) => <span style={{ fontFamily: "var(--font-mono)", color: d5Color(r.d5) }}>{r.d5}</span> },
    { key: "flow", label: "30d flow", render: (r) => <span style={{ color: flowColor(r.flow) }}>{r.flow}</span> },
  ];
  return (
    <MTTable
      columns={columns}
      rows={stocks}
      rowKey="t"
      onRowClick={onTickerClick ? (r) => onTickerClick(r.t) : undefined}
      features="full"
      storageKey="aa_stocks"
    />
  );
}

function MechanismModal({ mechanism, onClose }) {
  if (!mechanism) return null;
  const b = bandOf(mechanism.score);
  return (
    <ModalShell
      title={`${mechanism.num} · ${mechanism.name}`}
      subtitle="Cycle mechanism"
      badge={<span style={{
        background: b === "risk-on" ? RATING_BG.OW : b === "risk-off" ? RATING_BG.UW : RATING_BG.MW,
        color: BAND_COLOR[b],
        fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
      }}>{bandLabel(b)} · {mechanism.score}/100</span>}
      onClose={onClose}
    >
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)", margin: "16px 0 0" }}>
        Mechanism score derived from quartile-based scoring of underlying indicators in
        the post-2011 historical sample. Bands: 0-25 Risk On · 25-50 Neutral · 50-75 Caution · 75-100 Risk Off.
        See methodology page for the input panel and threshold logic.
      </p>
    </ModalShell>
  );
}

function AllocationChart({ macroTiltWeight, benchmarkWeight, benchmarkLabel = "SPY weight" }) {
  // Two side-by-side horizontal bars: MacroTilt allocation vs benchmark.
  // Used inside Sector / IG modals to lead with a visual instead of a text table.
  const mt = Math.max(0, macroTiltWeight || 0);
  const bm = Math.max(0, benchmarkWeight || 0);
  const max = Math.max(mt, bm, 0.01);
  const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
  const delta = mt - bm;
  const deltaCol = delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text-muted)";
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.16em",
          textTransform: "uppercase", color: "var(--text-muted)",
        }}>Allocation vs benchmark</div>
        <div style={{
          fontSize: 12, fontWeight: 600, color: deltaCol,
          fontVariantNumeric: "tabular-nums",
        }}>
          {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
        </div>
      </div>
      {[
        { lbl: "MacroTilt", val: mt, col: "var(--accent)" },
        { lbl: benchmarkLabel, val: bm, col: "var(--text-muted)" },
      ].map((row) => (
        <div key={row.lbl} style={{
          display: "grid", gridTemplateColumns: "92px 1fr 56px",
          gap: 12, alignItems: "center", padding: "6px 0",
        }}>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{row.lbl}</div>
          <div style={{
            height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${(row.val / max) * 100}%`,
              background: row.col,
              transition: "width 220ms",
            }} />
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600, textAlign: "right",
            fontVariantNumeric: "tabular-nums", color: "var(--text)",
          }}>{fmtPct(row.val)}</div>
        </div>
      ))}
    </div>
  );
}

function CompositionChart({ rows, totalLabel = "Sector total" }) {
  // Stacked horizontal bar showing how this sector's $ allocation breaks down
  // across its industry groups. Used inside SectorModal under the AllocationChart.
  if (!rows || !rows.length) return null;
  const total = rows.reduce((s, r) => s + (r.dollar || 0), 0);
  if (total <= 0) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.16em",
          textTransform: "uppercase", color: "var(--text-muted)",
        }}>Industry group breakdown</div>
        <div style={{
          fontSize: 12, color: "var(--text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}>{totalLabel} ${total.toFixed(2)}</div>
      </div>
      <div style={{
        display: "flex", height: 14, borderRadius: 4,
        overflow: "hidden", background: "var(--surface-2)",
      }}>
        {rows.map((r, i) => {
          const pct = (r.dollar || 0) / total;
          // Monotone teal: each segment dims further so all are distinct.
          const op = Math.max(0.25, 0.90 - i * 0.20);
          return (
            <div key={r.id || r.name} title={`${r.name}: $${(r.dollar || 0).toFixed(2)} (${(pct * 100).toFixed(0)}%)`} style={{
              width: `${pct * 100}%`,
              background: "var(--accent)",
              opacity: op,
              transition: "opacity 160ms",
            }} />
          );
        })}
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10,
        fontSize: 11, color: "var(--text-2)",
      }}>
        {rows.map((r, i) => {
          const op = Math.max(0.25, 0.90 - i * 0.20);
          return (
          <span key={r.id || r.name} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: 2,
              background: "var(--accent)",
              opacity: op,
            }} />
            {r.name}
            <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              ${(r.dollar || 0).toFixed(2)}
            </span>
          </span>
          );
        })}
      </div>
    </div>
  );
}

export function SectorModal({ sector, igs, onClose, onIGClick, onEtfClick }) {
  if (!sector) return null;
  const sectorIGs = igs.filter(ig => ig.sector === sector.sector);
  const sectorEtfs = SECTOR_ETFS[sector.sector] || [];
  return (
    <ModalShell
      title={sector.sector}
      subtitle={`Sector · $${sector.dollar.toFixed(2)} of $100 capital · vs SPY ${sector.vs_spy_pp >= 0 ? "+" : ""}${sector.vs_spy_pp}%`}
      badge={null}
      onClose={onClose}
    >
      <AllocationChart macroTiltWeight={sector.weight} benchmarkWeight={sector.spy_weight} />
      <CompositionChart rows={sectorIGs} totalLabel="Sector total" />
      <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", margin: "26px 0 4px", fontWeight: 600 }}>
        ETFs that give exposure to this sector
      </h4>
      <ETFTable etfs={sectorEtfs} onEtfClick={onEtfClick} />
      <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", margin: "22px 0 4px", fontWeight: 600 }}>
        Industry groups inside this sector ({sectorIGs.length})
      </h4>
      <div style={{ display: "grid", gap: 6 }}>
        {sectorIGs.map(ig => (
          <button key={ig.id} onClick={() => onIGClick(ig)} style={{
            display: "grid", gridTemplateColumns: "1fr auto auto",
            gap: 12, alignItems: "center", textAlign: "left",
            padding: "10px 12px", border: "0.5px solid var(--border)",
            borderRadius: 6, background: "var(--surface-2)",
            cursor: "pointer", fontFamily: "var(--font-ui)",
          }}>
            <div>
              <strong>{ig.name}</strong>
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6 }}>
                via {(ig.tickers || []).join(" · ")}
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>${ig.dollar.toFixed(2)}</span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
              color: ig.vs_spy_pp != null && Math.abs(ig.vs_spy_pp) >= 2 ? "var(--accent)"
                     : ig.vs_spy_pp != null && Math.abs(ig.vs_spy_pp) >= 0.5 ? "rgba(0,113,227,0.65)"
                     : "var(--text-muted)",
            }}>{ig.vs_spy_pp != null ? `${ig.vs_spy_pp > 0 ? "+" : ""}${ig.vs_spy_pp}%` : "—"}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

export function IGModal({ ig, sectorIGs, parentSector, onClose, onEtfClick, onBackToSector, onTickerClick }) {
  if (!ig) return null;
  const detail = IG_DETAIL[ig.id] || { etfs: [], stocks: [] };
  // Real sector-avg-IG benchmark: total $ in this sector ÷ number of IGs in it.
  // Was 0% before (placeholder), which made every chart look like a +X.Xpp
  // "vs nothing" delta — meaningless.
  const siblings = sectorIGs && sectorIGs.length ? sectorIGs : [ig];
  const sectorTotal = siblings.reduce((s, x) => s + (x.dollar || 0), 0);
  const avgPerIG = sectorTotal > 0 ? sectorTotal / siblings.length : 0;
  return (
    <ModalShell
      title={ig.name}
      subtitle={
        <span>
          {parentSector && onBackToSector ? (
            <button
              onClick={() => onBackToSector(parentSector)}
              style={{
                background: "transparent", border: "none", padding: 0,
                color: "var(--accent)", cursor: "pointer", fontSize: 12,
                fontFamily: "inherit", marginRight: 6,
              }}
            >← {ig.sector}</button>
          ) : (
            <span style={{ marginRight: 6 }}>{ig.sector}</span>
          )}
          {" · Industry Group · $"}{ig.dollar.toFixed(2)}{" of $100 capital"}
        </span>
      }
      badge={null}
      onClose={onClose}
    >
      <AllocationChart macroTiltWeight={(ig.dollar || 0) / 100} benchmarkWeight={avgPerIG / 100} benchmarkLabel={`Avg IG in ${ig.sector}`} />
      <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", margin: "26px 0 4px", fontWeight: 600 }}>
        ETFs that give exposure
      </h4>
      <ETFTable etfs={detail.etfs} onEtfClick={onEtfClick} />
      <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", margin: "22px 0 4px", fontWeight: 600 }}>
        Top constituent stocks
      </h4>
      <StockTable stocks={detail.stocks} onTickerClick={onTickerClick} />
    </ModalShell>
  );
}


function HeatmapTile({ contributionMatrix, mechanismScores }) {
  if (!contributionMatrix) return null;
  const sectors = contributionMatrix.cols_sectors;
  const mechs = contributionMatrix.rows;
  const MECH_LABEL = {
    valuation: "Valuation", credit: "Credit", funding: "Funding",
    growth: "Growth", liquidity_policy: "Liquidity & Policy", positioning_breadth: "Positioning & Breadth",
  };
  const cellColor = (v) => {
    if (Math.abs(v) < 0.15) return { bg: "rgba(94,94,99,0.10)", color: "var(--text-muted)" };
    // Joe directive 2026-05-07 — heatmap = shades of teal by magnitude.
    // Direction (tailwind / headwind) read from the +/- sign in the number.
    const a = Math.abs(v);
    if (a > 0.7) return { bg: "rgba(0,113,227,0.55)", color: "#fff" };
    if (a > 0.3) return { bg: "rgba(0,113,227,0.30)", color: "var(--text)" };
    if (a > 0)   return { bg: "rgba(0,113,227,0.15)", color: "var(--text)" };
    return { bg: "transparent", color: "var(--text-muted)" };
  };
  return (
    <div style={{
      background: "var(--surface)", border: "0.5px solid var(--border)",
      borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{ padding: 16, fontSize: 13, lineHeight: 1.5, borderBottom: "0.5px solid var(--border)" }}>
        <strong>How to read this:</strong>{" "}
        Each cell shows how much each cycle mechanism is helping or hurting that sector right now.
        Darker teal = stronger effect; <span style={{ fontWeight: 600 }}>+</span> tailwind, <span style={{ fontWeight: 600 }}>−</span> headwind, blank = neutral.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, background: "var(--surface-2)" }}>
                Cycle mechanism
              </th>
              {sectors.map(s => (
                <th key={s} title={s} style={{ padding: "10px 6px 8px", textAlign:"center", fontWeight:500, fontFamily:"var(--font-display)", fontSize:11, background:"var(--surface-2)", color:"var(--text)", lineHeight:1.2, verticalAlign:"bottom" }}>
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mechs.map(m => (
              <tr key={m}>
                <td style={{ padding: "5px 12px", fontWeight: 500, fontSize: 12 }}>
                  <span style={{ color: "var(--text)" }}>{MECH_LABEL[m]}</span>
                  {mechanismScores && mechanismScores[m] != null && (
                    <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                      {Math.round(mechanismScores[m])} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/ 100</span>
                    </span>
                  )}
                </td>
                {sectors.map(s => {
                  const v = contributionMatrix.by_sector[s]?.[m] ?? 0;
                  const { bg, color } = cellColor(v);
                  return (
                    <td key={s} title={`${s} × ${MECH_LABEL[m]}: ${v >= 0 ? "+" : ""}${v.toFixed(2)}`} style={{
                      padding: "5px 4px", textAlign: "center",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      background: bg, color,
                    }}>
                      {v >= 0 ? "+" : ""}{v.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────



// ── Named events for "Historical reads near today's level" table ──────
// Curated from major market regime episodes. findNamedEvent(date) returns
// the descriptive label for a given YYYY-MM-DD date, falling back to a
// month/year date label if none match.
const NAMED_EVENTS = [
  // Crisis / stress episodes
  { start: "1987-08-01", end: "1988-03-01", name: "Black Monday & aftermath" },
  { start: "1990-07-01", end: "1991-04-01", name: "1990 recession" },
  { start: "1994-02-01", end: "1994-12-01", name: "Bond market massacre" },
  { start: "1997-07-01", end: "1997-12-01", name: "Asian financial crisis" },
  { start: "1998-08-01", end: "1999-01-15", name: "LTCM crisis" },
  { start: "2000-03-01", end: "2002-10-01", name: "Dot-com bust" },
  { start: "2007-07-01", end: "2009-03-15", name: "Global Financial Crisis" },
  { start: "2010-04-15", end: "2010-07-01", name: "Flash Crash & Eurozone" },
  { start: "2011-07-15", end: "2011-12-01", name: "S&P downgrade · Eurozone" },
  { start: "2013-05-15", end: "2013-09-30", name: "Taper tantrum" },
  { start: "2015-08-15", end: "2016-02-15", name: "China devaluation" },
  { start: "2018-02-01", end: "2018-04-15", name: "Volmageddon" },
  { start: "2018-09-15", end: "2019-01-15", name: "Q4 2018 selloff" },
  { start: "2020-02-15", end: "2020-04-30", name: "COVID crash" },
  { start: "2022-01-01", end: "2022-10-15", name: "Inflation · rate hikes" },
  { start: "2023-03-01", end: "2023-05-15", name: "SVB · banking stress" },
  { start: "2025-02-15", end: "2025-06-15", name: "Tariff fears" },
  // Calm-period labels — used when today's stress level is low and we
  // look for prior similar-low reads. Matches the live modal copy style.
  { start: "1995-06-01", end: "1996-06-01", name: "Mid-90s expansion calm" },
  { start: "2003-12-01", end: "2007-06-01", name: "Pre-GFC calm" },
  { start: "2012-04-01", end: "2013-04-01", name: "Post-Eurozone calm" },
  { start: "2014-01-01", end: "2014-08-01", name: "Tapering calm" },
  { start: "2017-04-01", end: "2018-01-15", name: "Pre-Volmageddon calm" },
  { start: "2019-04-01", end: "2020-02-14", name: "Pre-COVID calm" },
  { start: "2021-04-01", end: "2021-11-01", name: "Post-COVID calm" },
  { start: "2024-04-01", end: "2024-07-31", name: "Post-SVB calm" },
  { start: "2024-12-01", end: "2025-02-14", name: "Steady regime" },
  { start: "2025-09-01", end: "2026-01-01", name: "Late-cycle ease" },
  { start: "2026-02-01", end: "2026-05-31", name: "Current calm regime" },
]
function findNamedEvent(dateStr) {
  for (const e of NAMED_EVENTS) {
    if (dateStr >= e.start && dateStr <= e.end) return e.name;
  }
  // Fallback: month/year label
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── HistoryChart — interactive line chart with timeframe + crosshair ──
// Mirrors the live Macro Overview modal chart pattern. Used by both the
// Backtest Validation section and any other inline history view that
// needs the same brand-consistent look + feel.
//   props: series = [{ key, label, color, dashed?: bool }]
//          data   = full array of points keyed by `date` (YYYY-MM-DD)
//          yKey   = unused placeholder for clarity; each series reads its own `key`
//          fmtY   = (v) => label string (for axis + tooltip)
//          logY   = bool — log-scale y-axis
//          defaultTf = "1M" | "6M" | "1Y" | "5Y" | "Max"
function HistoryChart({ series, data, fmtY = (v) => v.toFixed(2), logY = false, defaultTf = "Max", height = 320, availableOverlays = [], horizontalLines = [] }) {
  const [tf, setTf] = useState(defaultTf);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [overlayKey, setOverlayKey] = useState(null);
  const svgRef = useRef(null);
  // Compose final series list: base series + active overlay (if any)
  const overlay = overlayKey ? availableOverlays.find(o => o.key === overlayKey) : null;
  const allSeries = overlay ? [...series, { ...overlay, dashed: true }] : series;

  const tfWeeks = { "1M": 4, "6M": 26, "1Y": 52, "5Y": 260, "Max": data.length };
  const w = data.slice(-tfWeeks[tf]);

  const W = 800, H = height, padL = 56, padR = 24, padT = 18, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // y-range across all series in the timeframe
  const allVals = [...w.flatMap(p => allSeries.map(s => p[s.key]).filter(v => v != null && (!logY || v > 0))), ...horizontalLines.map(h => h.value).filter(v => v != null)];
  let yMinRaw = Math.min(...allVals);
  let yMaxRaw = Math.max(...allVals);
  const yPad = (yMaxRaw - yMinRaw) * 0.08 || 1;
  let yMin = yMinRaw - yPad;
  let yMax = yMaxRaw + yPad;
  if (logY) { yMin = Math.max(yMin, 0.01); }

  const yScale = logY ? Math.log(yMax / yMin) : (yMax - yMin);
  const yToPx = (v) => {
    if (logY) return padT + (Math.log(yMax / v) / yScale) * innerH;
    return padT + ((yMax - v) / yScale) * innerH;
  };
  const xToPx = (i) => padL + (i / Math.max(1, w.length - 1)) * innerW;
  const pathFor = (key) => w.map((p, i) => {
    const v = p[key];
    if (v == null) return null;
    return [xToPx(i), yToPx(v)];
  }).filter(Boolean).map((pt, i) => (i === 0 ? "M " : "L ") + pt[0].toFixed(1) + " " + pt[1].toFixed(1)).join(" ");

  // y-axis ticks: 5 ticks evenly spaced (linear) or per-decade (log)
  const yTicks = [];
  if (logY) {
    const lo = Math.log(yMin), hi = Math.log(yMax);
    for (let i = 0; i <= 4; i++) {
      const lv = lo + (hi - lo) * (i / 4);
      const v = Math.exp(lv);
      yTicks.push({ v, y: yToPx(v) });
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4);
      yTicks.push({ v, y: yToPx(v) });
    }
  }
  // x-axis date labels (3 ticks)
  const xLabels = [
    { i: 0, d: w[0]?.date },
    { i: Math.floor(w.length / 2), d: w[Math.floor(w.length / 2)]?.date },
    { i: w.length - 1, d: w[w.length - 1]?.date },
  ].filter(p => p.d).map(p => ({ x: xToPx(p.i), label: (() => { const d = new Date(p.d); return d.toLocaleDateString("en-US", { month: "short", year: tf === "Max" || tf === "5Y" ? "numeric" : "2-digit" }); })() }));

  const handleMove = (e) => {
    if (!svgRef.current || w.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width * W;
    const xData = (xRel - padL) / innerW;
    const idx = Math.round(xData * (w.length - 1));
    if (idx >= 0 && idx < w.length) setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? w[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xToPx(hoverIdx) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>History · timeframe select · crosshair{availableOverlays.length > 0 ? " · overlay" : ""}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {availableOverlays.length > 0 && (
            <select value={overlayKey || ""} onChange={(e) => setOverlayKey(e.target.value || null)} style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 11, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", cursor: "pointer", marginRight: 8, letterSpacing: "0.04em",
            }}>
              <option value="">OVERLAY…</option>
              {availableOverlays.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          )}
          {["1M", "6M", "1Y", "5Y", "Max"].map(t => (
            <button key={t} onClick={() => setTf(t)} style={{
              background: t === tf ? "var(--accent-soft)" : "transparent",
              border: "1px solid " + (t === tf ? "var(--accent)" : "var(--border)"),
              color: t === tf ? "var(--accent)" : "var(--text-muted)",
              borderRadius: 11, padding: "4px 12px", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontWeight: 500,
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", cursor: "crosshair" }} onMouseMove={handleMove} onMouseLeave={handleLeave}>
          {/* y-axis gridlines + labels */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="rgba(14,17,21,0.06)" strokeWidth="1" />
              <text x={padL - 8} y={t.y + 4} fontSize="10" fill="var(--text-dim)" textAnchor="end" fontFamily="Inter">{fmtY(t.v)}</text>
            </g>
          ))}
          {/* x-axis labels */}
          {xLabels.map((l, i) => (
            <text key={i} x={l.x} y={H - padB + 18} fontSize="10.5" fill="var(--text-dim)" textAnchor="middle" fontFamily="Inter">{l.label}</text>
          ))}
          {/* horizontal reference lines */}
          {horizontalLines.map((h, i) => (
            <g key={"h" + i}>
              <line x1={padL} y1={yToPx(h.value)} x2={W - padR} y2={yToPx(h.value)} stroke={h.color || "var(--text-muted)"} strokeWidth="1.2" strokeDasharray="6 4" />
              <text x={W - padR - 6} y={yToPx(h.value) - 6} fontSize="10" fill={h.color || "var(--text-muted)"} textAnchor="end" fontFamily="Inter" fontWeight="500">{h.label || ""}</text>
            </g>
          ))}
          {/* series paths */}
          {allSeries.map(s => (
            <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={s.dashed ? "1.4" : "1.7"} strokeDasharray={s.dashed ? "4 4" : undefined} opacity={s.dashed ? 0.8 : 1} />
          ))}
          {/* crosshair */}
          {hoverIdx != null && hoverX != null && (
            <g>
              <line x1={hoverX} y1={padT} x2={hoverX} y2={H - padB} stroke="rgba(14,17,21,0.20)" strokeWidth="1" strokeDasharray="2 3" />
              {allSeries.map(s => {
                const v = w[hoverIdx][s.key];
                if (v == null) return null;
                return <circle key={s.key} cx={hoverX} cy={yToPx(v)} r="4" fill={s.color} stroke="#fff" strokeWidth="1.5" />;
              })}
            </g>
          )}
        </svg>
        {/* crosshair tooltip card */}
        {hover && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)", boxShadow: "0 2px 6px rgba(14,17,21,0.08)", minWidth: 220 }}>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>{(() => { const d = new Date(hover.date); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); })()}</div>
            {allSeries.map(s => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "2px 0" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
                  <span style={{ display: "inline-block", width: 10, height: 2, background: s.color, borderRadius: 1 }} />{s.label}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{hover[s.key] != null ? fmtY(hover[s.key]) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 11.5, color: "var(--text-muted)", flexWrap: "wrap" }}>
        {[...allSeries, ...horizontalLines.map((h, i) => ({ key: "hline" + i, label: h.label, color: h.color || "var(--text-muted)", dashed: true }))].map(s => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 14, height: s.dashed ? 0 : 2, borderTop: s.dashed ? "2px dashed " + s.color : "2px solid " + s.color }} />
            {s.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>{tf} window · {w.length} points</span>
      </div>
    </div>
  );
}

export default function AssetTilt({ onOpenTicker }) {
  const [cycleBoard, setCycleBoard] = useState(null);
  const [v10, setV10] = useState(null);
  const [macroEngine, setMacroEngine] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(null); // null | "stress" | "yield"
  const [historyTimeframe, setHistoryTimeframe] = useState("1Y");
  const [mechModal, setMechModal] = useState(null);
  const [sectorModal, setSectorModal] = useState(null);
  const [igModal, setIgModal] = useState(null);
  const [sectorPerf, setSectorPerf] = useState(null);

  useEffect(() => {
    fetch("/cycle_board_snapshot.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setCycleBoard).catch(() => setCycleBoard(null));
    fetch("/macrotilt_engine.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : null).then(setMacroEngine).catch(() => {});
    fetch("/macrotilt_engine_backtest.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : null).then(setBacktest).catch(() => {});
    fetch("/v10_allocation.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setV10).catch(() => setV10(null));
    fetch("/sector_perf.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setSectorPerf).catch(() => setSectorPerf(null));
  }, []);

  const stance = v10?.page_stance;
  const defensiveActive = (v10?.defensive_pct ?? 0) > 0;
  const stanceHeadline = useMemo(() => {
    if (stance === "Risk On") return "Risk on — full equity, modest leverage where conditions warrant.";
    if (stance === "Neutral") return "Neutral — full equity, no leverage, watch for transitions.";
    if (stance === "Cautious" || stance === "Caution") {
      return defensiveActive
        ? `Cautious — late-cycle positioning, defensive sleeve active at ${Math.round((v10?.defensive_pct ?? 0) * 100)}%.`
        : "Cautious — late-cycle positioning, defensive sleeve armed but not yet activating.";
    }
    if (stance === "Risk Off") return `Risk off — defensive sleeve active at ${Math.round((v10?.defensive_pct ?? 0) * 100)}%, no leverage.`;
    return "";
  }, [stance, defensiveActive, v10]);

  if (!v10 || !cycleBoard) {
    return (
      <main style={{ maxWidth: 1216, margin: "0 auto", padding: "60px 32px" }}>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Loading Asset Tilt…
        </div>
      </main>
    );
  }

  const lev = v10.leverage || 1;
  const grossDollar = (v10.equity_pct || 0) * lev * 100 + (v10.defensive_pct || 0) * 100;

  // Defensive bucket dollar amounts (always show all 4 buckets, $0 if defensive off)
  const defensiveTotal = (v10.defensive_pct || 0) * 100;
  const defensivePerBucket = defensiveTotal / DEFENSIVE_BUCKETS.length;

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "0 0 48px" }}>
      {/* HERO — Joe mockup 2026-05-08 v3:
          LEFT (~2/3): eyebrow + h1 + Engine subtitle.
          RIGHT (~1/3): "Key Statistics vs. S&P 500" card with 4 KPI cells. */}
      <PageHero
        eyebrow="Asset Tilt"
        title={<>A back-tested <em>asset allocation tool</em> that seeks to beat the S&amp;P 500 on a risk-adjusted basis over the long run.</>}
        bullets={[
          "Bond-market volatility (MOVE) and 3-month change in 10-year yield set the regime + equity exposure",
          "Factor-level reads on credit, valuation, breadth, growth and liquidity drive sector + industry-group tilts within the equity bucket",
          "Defensive sleeve fires only when stress crosses the Watch threshold; sleeve composition keys off yield direction (Inflationary / Neutral / Deflationary)",
          "Validated 1986 → 2026 over 2,056 weeks · Sharpe 0.61 vs SPY 0.50 · max drawdown 35% vs 55%",
        ]}
        right={
<aside style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px 14px", display: "flex", flexDirection: "column", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 14 }}>
            Key Statistics vs. S&amp;P 500
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, textAlign: "left" }}>
            {[
              { label: "CAGR",         value: backtest?.validation?.engine?.cagr != null ? backtest.validation.engine.cagr.toFixed(2) + "%" : "11.74%",  sub: "vs SPY " + (backtest?.validation?.spy?.cagr != null ? backtest.validation.spy.cagr.toFixed(2) + "%" : "10.86%") },
              { label: "Sharpe",       value: backtest?.validation?.engine?.sharpe != null ? backtest.validation.engine.sharpe.toFixed(2) : "0.61",    sub: "vs SPY " + (backtest?.validation?.spy?.sharpe != null ? backtest.validation.spy.sharpe.toFixed(2) : "0.50") },
              { label: "Max Drawdown", value: backtest?.validation?.engine?.max_drawdown != null ? (backtest.validation.engine.max_drawdown * 100).toFixed(1) + "%" : "−35.0%", sub: "vs SPY " + (backtest?.validation?.spy?.max_drawdown != null ? (backtest.validation.spy.max_drawdown * 100).toFixed(1) + "%" : "−54.6%") },
              { label: "Validated",    value: "1986 → 2026", sub: (backtest?.validation?.n_weeks || "2,056") + " weeks" },
            ].map(t => (
              <div key={t.label} style={{
                background: "var(--surface-2)", border: "0.5px solid var(--border-faint)",
                borderRadius: 8, padding: "12px 12px",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  {t.label}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: "var(--text)", lineHeight: 1.05, letterSpacing: "-0.015em" }}>
                  {t.value}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.3 }}>
                  {t.sub}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <a href="#methodology" style={{ fontSize: 11, fontWeight: 500, color: "var(--accent)", letterSpacing: "0.04em" }}>Read the full methodology &rarr;</a>
          </div>
        </aside>
        }
      />

      {/* TODAY'S ENGINE READ — new 2-axis regime engine (validated 1986-2026).
          Reads /macrotilt_engine.json. Two dials in MacroTilt's existing
          dial pattern: Stress (MOVE percentile) + Yield Regime (3-month change
          in 10Y yield, percentile-ranked). Sleeve composition hidden when
          defensive_pct = 0 (Risk On). */}
      {macroEngine && (
        <section style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "24px 28px", margin: "24px 32px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0, letterSpacing: "-0.005em" }}>Today's Engine Read</h2>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
              <FreshnessDot indicatorId="macrotilt_engine" asOfIso={macroEngine.as_of} />
              <span style={{ marginLeft: 8 }}>{macroEngine.sources?.stress_signal} · {macroEngine.sources?.yield_filter} · As of {macroEngine.as_of}</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gap: 18, alignItems: "stretch" }}>

            {/* STRESS DIAL */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontStyle: "italic", fontWeight: 400 }}>Stress signal</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em" }}>BOND-MARKET VOL · MOVE</div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {["Risk On", "Watch", "Risk Off"].map(s => (
                  <span key={s} style={{
                    fontSize: 9.5, letterSpacing: "0.095em", textTransform: "uppercase", padding: "3px 11px",
                    borderRadius: 11, fontWeight: 500,
                    background: s === macroEngine.stress?.state ? "rgba(0,113,227,0.10)" : "var(--surface-2)",
                    color: s === macroEngine.stress?.state ? "var(--accent)" : "var(--text-dim)",
                    border: s === macroEngine.stress?.state ? "1px solid var(--accent)" : "1px solid var(--border)",
                  }}>{s}</span>
                ))}
              </div>
              <div onClick={() => setHistoryOpen("stress")} style={{ position: "relative", textAlign: "center", marginTop: 12, cursor: "pointer" }}>
                <span style={{ position: "absolute", top: -4, right: 0, fontSize: 9.5, letterSpacing: "0.095em", color: "var(--text-dim)", fontWeight: 500 }}>CLICK FOR DETAIL ›</span>
                <svg viewBox="0 0 240 140" style={{ width: "100%", maxWidth: 240, display: "block", margin: "0 auto" }}>
                  <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)"/>
                  <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)"/>
                  <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)"/>
                  <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)"/>
                  {(() => {
                    const pct = (macroEngine.stress?.move_percentile_5y || 0);
                    const angle = 180 - (pct * 100 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const tipX = 120 + 100 * Math.cos(rad);
                    const tipY = 120 - 100 * Math.sin(rad);
                    return (<>
                      <line x1="120" y1="120" x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round"/>
                      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8"/>
                      <circle cx="120" cy="120" r="4.5" fill="var(--accent)"/>
                    </>);
                  })()}
                  {/* Watch threshold marker (75th pctile) */}
                  {(() => {
                    const angle = 180 - (75 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const x = 120 + 100 * Math.cos(rad);
                    const y = 120 - 100 * Math.sin(rad);
                    return (<><circle cx={x} cy={y} r="3" fill="var(--text)"/><text x={x + 8} y={y - 4} fontSize="9" fontFamily="Inter" fill="var(--text)" fontWeight="600">75th</text></>);
                  })()}
                  {/* Risk Off threshold marker (85th pctile) */}
                  {(() => {
                    const angle = 180 - (85 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const x = 120 + 100 * Math.cos(rad);
                    const y = 120 - 100 * Math.sin(rad);
                    return (<><circle cx={x} cy={y} r="3" fill="var(--text)"/><text x={x + 8} y={y + 8} fontSize="9" fontFamily="Inter" fill="var(--text)" fontWeight="600">85th</text></>);
                  })()}
                </svg>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1, marginTop: 4 }}>{macroEngine.stress?.move_value?.toFixed(1)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {Math.round((macroEngine.stress?.move_percentile_5y || 0) * 100)}th pctile · Watch {macroEngine.stress?.watch_threshold_value?.toFixed(0)} · Risk Off {macroEngine.stress?.risk_off_threshold_value?.toFixed(0)}
                </div>
              </div>
              {/* 24-week bar strip (matches Macro Overview AnchorTile) */}
              {backtest?.weekly?.length >= 24 && (() => {
                const weeks24 = backtest.weekly.slice(-24);
                const maxPct = 1.0;
                return (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      <span>24W</span><span>NOW</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, height: 32, alignItems: "flex-end", marginTop: 4 }}>
                      {weeks24.map((w) => {
                        const pct = w.move_pctile_5y || 0;
                        const h = Math.max(8, Math.min(95, pct * 100));
                        const opacity = pct >= 0.85 ? 0.92 : pct >= 0.75 ? 0.68 : pct >= 0.5 ? 0.42 : 0.30;
                        return (
                          <span key={w.date} title={`${w.date} · MOVE ${w.move?.toFixed(0)} · ${Math.round(pct * 100)}th pctile · ${w.stress_state}`}
                                style={{ flex: 1, height: `${h}%`, background: `rgba(0,113,227,${opacity})`, borderRadius: 1, cursor: "default" }} />
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 10, textAlign: "center" }}>
                      <a onClick={() => setHistoryOpen("stress")} style={{ fontSize: 10.5, letterSpacing: "0.095em", color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>
                        SEE FULL HISTORY (1986 – TODAY) ›
                      </a>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* YIELD REGIME DIAL */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontStyle: "italic", fontWeight: 400 }}>Yield regime</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em" }}>3M Δ · 10Y TREASURY</div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {["Deflationary", "Neutral", "Inflationary"].map(s => (
                  <span key={s} style={{
                    fontSize: 9.5, letterSpacing: "0.095em", textTransform: "uppercase", padding: "3px 11px",
                    borderRadius: 11, fontWeight: 500,
                    background: s === macroEngine.yield_regime?.state ? "rgba(0,113,227,0.10)" : "var(--surface-2)",
                    color: s === macroEngine.yield_regime?.state ? "var(--accent)" : "var(--text-dim)",
                    border: s === macroEngine.yield_regime?.state ? "1px solid var(--accent)" : "1px solid var(--border)",
                  }}>{s}</span>
                ))}
              </div>
              <div onClick={() => setHistoryOpen("yield")} style={{ position: "relative", textAlign: "center", marginTop: 12, cursor: "pointer" }}>
                <span style={{ position: "absolute", top: -4, right: 0, fontSize: 9.5, letterSpacing: "0.095em", color: "var(--text-dim)", fontWeight: 500 }}>CLICK FOR DETAIL ›</span>
                <svg viewBox="0 0 240 140" style={{ width: "100%", maxWidth: 240, display: "block", margin: "0 auto" }}>
                  <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)"/>
                  <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)"/>
                  <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)"/>
                  <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)"/>
                  {(() => {
                    const pct = (macroEngine.yield_regime?.delta_y_3m_percentile_5y || 0);
                    const angle = 180 - (pct * 100 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const tipX = 120 + 100 * Math.cos(rad);
                    const tipY = 120 - 100 * Math.sin(rad);
                    return (<>
                      <line x1="120" y1="120" x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round"/>
                      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8"/>
                      <circle cx="120" cy="120" r="4.5" fill="var(--accent)"/>
                    </>);
                  })()}
                  {(() => {
                    const angle = 180 - (30 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const x = 120 + 100 * Math.cos(rad);
                    const y = 120 - 100 * Math.sin(rad);
                    return (<><circle cx={x} cy={y} r="3" fill="var(--text)"/><text x={x - 24} y={y - 6} fontSize="9" fontFamily="Inter" fill="var(--text)" fontWeight="600">{macroEngine.yield_regime?.deflationary_threshold_bp?.toFixed(0)} bp</text></>);
                  })()}
                  {(() => {
                    const angle = 180 - (70 * 1.8);
                    const rad = angle * Math.PI / 180;
                    const x = 120 + 100 * Math.cos(rad);
                    const y = 120 - 100 * Math.sin(rad);
                    return (<><circle cx={x} cy={y} r="3" fill="var(--text)"/><text x={x + 8} y={y - 4} fontSize="9" fontFamily="Inter" fill="var(--text)" fontWeight="600">+{macroEngine.yield_regime?.inflationary_threshold_bp?.toFixed(0)} bp</text></>);
                  })()}
                </svg>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1, marginTop: 4 }}>{(macroEngine.yield_regime?.delta_y_3m_bp || 0) >= 0 ? "+" : ""}{macroEngine.yield_regime?.delta_y_3m_bp?.toFixed(0)} bp</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {Math.round((macroEngine.yield_regime?.delta_y_3m_percentile_5y || 0) * 100)}th pctile · Infl ≥ +{macroEngine.yield_regime?.inflationary_threshold_bp?.toFixed(0)} bp · Defl ≤ {macroEngine.yield_regime?.deflationary_threshold_bp?.toFixed(0)} bp
                </div>
              </div>
              {/* 24-week bar strip — yield regime */}
              {backtest?.weekly?.length >= 24 && (() => {
                const weeks24 = backtest.weekly.slice(-24);
                return (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      <span>24W</span><span>NOW</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, height: 32, alignItems: "flex-end", marginTop: 4 }}>
                      {weeks24.map((w) => {
                        const pct = w.delta_y_3m_pctile_5y || 0;
                        const h = Math.max(8, Math.min(95, pct * 100));
                        const opacity = pct >= 0.70 ? 0.68 : pct <= 0.30 ? 0.55 : 0.30;
                        return (
                          <span key={w.date} title={`${w.date} · ΔY-3M ${(w.delta_y_3m_bp >= 0 ? "+" : "") + (w.delta_y_3m_bp || 0).toFixed(0)} bp · ${Math.round(pct * 100)}th pctile · ${w.yield_regime}`}
                                style={{ flex: 1, height: `${h}%`, background: `rgba(0,113,227,${opacity})`, borderRadius: 1, cursor: "default" }} />
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 10, textAlign: "center" }}>
                      <a onClick={() => setHistoryOpen("yield")} style={{ fontSize: 10.5, letterSpacing: "0.095em", color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>
                        SEE FULL HISTORY (1986 – TODAY) ›
                      </a>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ALLOCATION SUMMARY */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontStyle: "italic", fontWeight: 400 }}>Allocation</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 2 }}>ENGINE STANCE</div>

              <div style={{ display: "flex", gap: 24, marginTop: 22, alignItems: "flex-end", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1 }}>{macroEngine.allocation?.equity_pct}<span style={{ fontStyle: "italic", fontSize: 20, color: "var(--text-muted)" }}>%</span></div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 4 }}>EQUITY</div>
                </div>
                <div style={{ textAlign: "center", color: macroEngine.allocation?.defensive_pct > 0 ? "var(--text)" : "var(--text-dim)" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1 }}>{macroEngine.allocation?.defensive_pct}<span style={{ fontStyle: "italic", fontSize: 20, color: "var(--text-muted)" }}>%</span></div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", marginTop: 4 }}>DEFENSIVE</div>
                </div>
              </div>

              {macroEngine.allocation?.defensive_pct > 0 ? (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-faint)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Active sleeve · {macroEngine.allocation?.active_sleeve_label}</div>
                  {Object.entries(macroEngine.allocation?.active_sleeve_composition || {}).filter(([_, v]) => v > 0).map(([leg, w]) => (
                    <div key={leg} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                      <span>{leg === "cash" ? "Cash" : leg}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{Math.round(w * 100)}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Defensive sleeve · <strong style={{ color: "var(--text)", fontWeight: 500 }}>standby</strong> — would activate as <strong style={{ color: "var(--text)", fontWeight: 500 }}>{macroEngine.allocation?.active_sleeve_label}</strong> mix if stress crosses Watch threshold.
                </div>
              )}
            </div>

          </div>
        </section>
      )}
      <div style={{ padding: "24px 32px 0" }}>
      {/* Recommended Allocations — Joe mockup 2026-05-08 v3. Wraps the
          sortable sector table + defensive sleeve + total row in a labeled
          card so the page reads as 3 distinct blocks: hero, allocations,
          heatmap. */}
      <section style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "14px 18px 12px", borderBottom: "0.5px solid var(--border)", background: "var(--surface)" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0, letterSpacing: "-0.005em" }}>Recommended Allocations</h2>
        </div>
        <SectorTable
          sectors={v10.sectors}
          igs={v10.industry_groups}
          leverage={lev}
          asOf={v10.as_of}
          sectorPerf={sectorPerf}
          defensiveBuckets={DEFENSIVE_BUCKETS}
          defensivePerBucket={defensivePerBucket}
          onSectorClick={setSectorModal}
          onIGClick={setIgModal}
          onEtfClick={(e) => onOpenTicker(e.t || e)}
        />
        {/* Total row — appears at the bottom of the unified table. */}
        <div style={{
          display: "grid", gridTemplateColumns: "1.55fr 1fr 110px 64px 64px 64px 64px 80px",
          gap: 10, padding: "12px 14px", fontSize: 13, fontWeight: 600,
          background: "var(--surface-2)", borderTop: "1px solid var(--border)",
        }}>
          <div>Total recommended allocation (equity × leverage + defensive)</div>
          <div></div>
          <div style={{ fontFamily: "var(--font-mono)", textAlign: "right" }}>${grossDollar.toFixed(2)}</div>
          <div></div><div></div><div></div><div></div>
          <div style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--text-muted)", fontWeight: 400, fontSize: 11 }}>
            {lev.toFixed(2)}× gross
          </div>
        </div>
      </section>

      {/* HEATMAP — wrapped in a labeled card to match Recommended Allocations. */}
      <section style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "14px 18px 12px", borderBottom: "0.5px solid var(--border)", background: "var(--surface)" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0, letterSpacing: "-0.005em" }}>Heatmap</h2>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Which mechanisms are tailwinds vs headwinds for each sector right now.</div>
        </div>
        <HeatmapTile contributionMatrix={v10.contribution_matrix} mechanismScores={v10.mechanism_scores} />
      </section>

      {/* Bottom methodology footer killed 2026-05-07 — methodology paragraph
          is now in the hero at the top of the page. */}


      {/* BACKTEST VALIDATION — full 1986-2026 data series powering the engine
          calibration. Reads /macrotilt_engine_backtest.json (2,056 weekly
          observations + per-drawdown attribution). */}
      {backtest && (
        <section style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20, marginTop: 0 }}>
          <div style={{ padding: "14px 18px 12px", borderBottom: "0.5px solid var(--border)", background: "var(--surface)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0, letterSpacing: "-0.005em" }}>Backtest Validation · 1986 → 2026</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              Every weekly observation used to calibrate the engine. {(backtest.weekly || []).length} weekly observations · {(backtest.drawdowns || []).length} major drawdown episodes documented.
            </div>
          </div>

          <div style={{ padding: "18px 22px" }}>
            {/* 3-strategy comparison KPI grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
              {["spy", "regime_only", "engine"].map(strat => {
                const v = backtest.validation?.[strat] || {};
                const labelMap = { spy: "SPY buy & hold", regime_only: "Regime + Cash", engine: "Regime + Sleeve" };
                const colorMap = { spy: "rgba(94,94,99,0.7)", regime_only: "#0071e3", engine: "var(--accent)" };
                return (
                  <div key={strat} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
                      <span style={{ display: "inline-block", width: 12, height: strat === "regime_only" ? 0 : 2, borderTop: strat === "regime_only" ? "2px dashed " + colorMap[strat] : "2px solid " + colorMap[strat] }} />
                      {labelMap[strat]}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><div style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>$1 →</div><div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.15 }}>${v.final_value?.toFixed(2) || "—"}</div></div>
                      <div><div style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>CAGR</div><div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.15 }}>{v.cagr?.toFixed(2) || "—"}%</div></div>
                      <div><div style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>Sharpe</div><div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.15 }}>{v.sharpe?.toFixed(2) || "—"}</div></div>
                      <div><div style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>Max DD</div><div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.15, color: "var(--red)" }}>{((v.max_drawdown || 0) * 100).toFixed(1)}%</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14, padding: "10px 14px", background: "rgba(0,113,227,0.04)", borderRadius: 8 }}>
              <strong style={{ color: "var(--text)", fontWeight: 500 }}>Three strategies compared.</strong>{" "}
              <em>SPY buy &amp; hold</em> is the passive benchmark. <em>Regime + Cash</em> uses the engine's stress signal to de-risk into cash when MOVE crosses the 75th-percentile (Watch) and 85th-percentile (Risk Off) marks — equity exposure scales 100 / 80 / 50%. <em>Regime + Sleeve</em> adds the yield-direction-aware defensive sleeve (Cash + GLD + SHY/TLT keyed off the 3-month change in 10-year yield). The big Sharpe lift comes from the regime signal; the sleeve adds incremental return through the 2000s and 2020 downturns by avoiding duration drag.
              {" "}<strong style={{ color: "var(--text)", fontWeight: 500 }}>Note:</strong> sector + IG tilts from the v9 factor model are NOT included in these strategy lines — those would require running v9 historically across all 2,056 weeks. This is queued for a Day 4 follow-up.
            </div>

            {/* Cumulative wealth chart — engine vs SPY, 1986 onward */}
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
              Cumulative wealth · $1 invested December 1986 (log scale)
            </div>
            <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "16px 20px", marginBottom: 18 }}>
              <HistoryChart
                data={backtest.weekly || []}
                series={[
                  { key: "engine_cumulative",      label: "Regime + Defensive Sleeve", color: "var(--accent)" },
                  { key: "regime_only_cumulative", label: "Regime + Cash (no sleeve)", color: "#0071e3", dashed: true },
                  { key: "spy_cumulative",         label: "SPY buy & hold",            color: "rgba(94,94,99,0.7)" },
                ]}
                fmtY={(v) => "$" + v.toFixed(v < 10 ? 1 : 0)}
                logY={true}
                defaultTf="Max"
                height={320}
              />
            </div>

            {/* Drawdown table — engine vs SPY at every major peak-to-trough */}
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
              Drawdown comparison · engine vs SPY at major peak-to-trough episodes
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Episode</th>
                  <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>SPY depth</th>
                  <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Engine depth</th>
                  <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Engine − SPY</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Dominant yield regime</th>
                </tr>
              </thead>
              <tbody>
                {(backtest.drawdowns || []).map(d => (
                  <tr key={d.name}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)" }}>{d.name}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", color: "var(--red)", fontFamily: "var(--font-mono)" }}>{(d.spy_depth * 100).toFixed(1)}%</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", color: "var(--red)", fontFamily: "var(--font-mono)" }}>{(d.engine_depth * 100).toFixed(1)}%</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", color: d.diff_pp > 0 ? "var(--green)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>+{d.diff_pp?.toFixed(1)} pp</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", color: "var(--text-muted)" }}>{d.yield_regime_dominant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* FULL HISTORY MODAL — opens from the dial wraps + the SEE FULL HISTORY links */}
      {historyOpen && backtest?.weekly && (() => {
        const allWeeks = backtest.weekly;
        const isStress = historyOpen === "stress";
        const valueKey  = isStress ? "move" : "delta_y_3m_bp";
        const pctileKey = isStress ? "move_pctile_5y" : "delta_y_3m_pctile_5y";
        const stateKey  = isStress ? "stress_state" : "yield_regime";
        const upperThrKey = isStress ? "risk_off_threshold" : "inflationary_threshold_bp";
        const midThrKey   = isStress ? "watch_threshold" : "deflationary_threshold_bp";

        const last = allWeeks[allWeeks.length - 1];
        const title  = isStress ? "Bond Volatility" : "Yield Regime";
        const eyebrow = isStress ? "Volatility trigger · stress signal" : "Yield direction · regime classifier";
        const fmtVal = (v) => v == null ? "—" : (isStress ? Math.round(v).toString() : ((v >= 0 ? "+" : "") + Math.round(v) + " bp"));

        const currentVal    = last[valueKey] || 0;
        const currentPctile = (last[pctileKey] || 0) * 100;
        const upperMark     = last[upperThrKey] || 0;
        const midMark       = last[midThrKey] || 0;
        const stateNow      = last[stateKey];

        // Days in state
        let daysInState = 1;
        for (let i = allWeeks.length - 2; i >= 0; i--) {
          if (allWeeks[i][stateKey] === stateNow) daysInState += 7; else break;
        }

        // Full sample range
        const allVals = allWeeks.map(p => p[valueKey] || 0).filter(v => v != null);
        const minVal = Math.min(...allVals);
        const maxVal = Math.max(...allVals);

        // Caption
        const captionState = isStress
          ? (stateNow === "Risk On" ? "calm" : stateNow === "Watch" ? "watching" : "stressed")
          : stateNow;
        const captionSentence = isStress
          ? `The trailing-5y 85th-percentile mark sits ${currentVal < upperMark ? "well above" : "below"} today's reading. The trigger has been in ${stateNow} for ${daysInState} trading days.`
          : `Today's 3-month change in 10-year yield sits at the ${Math.round(currentPctile)}th percentile of its trailing 5-year window. The yield regime has been ${stateNow} for ${daysInState} trading days.`;

        // Historical reads near today's level (similar-percentile-band episodes)
        const targetPct = currentPctile / 100;
        const band = 0.05;
        const matches = allWeeks.map((p, i) => ({ ...p, idx: i, similar: Math.abs((p[pctileKey] || 0) - targetPct) <= band }));
        const episodes = [];
        let inEp = false; let ep = null;
        for (const m of matches) {
          if (m.similar && !inEp) { ep = { startIdx: m.idx, peakIdx: m.idx, peakVal: m[valueKey], state: m[stateKey] }; inEp = true; }
          else if (m.similar && inEp) {
            if (Math.abs((m[pctileKey] || 0) - targetPct) < Math.abs((allWeeks[ep.peakIdx][pctileKey] - targetPct))) {
              ep.peakIdx = m.idx; ep.peakVal = m[valueKey]; ep.state = m[stateKey];
            }
          } else if (!m.similar && inEp) { ep.endIdx = m.idx - 1; episodes.push(ep); inEp = false; }
        }
        if (inEp && ep) { ep.endIdx = allWeeks.length - 1; episodes.push(ep); }
        const past = episodes.filter(e => (e.endIdx - e.startIdx + 1) >= 4 && (allWeeks.length - 1 - e.peakIdx) > 4);
        const enriched = past.map(e => {
          const peak = allWeeks[e.peakIdx];
          const i = e.peakIdx;
          const spx6  = (i + 26 < allWeeks.length) ? (allWeeks[i + 26].spy_cumulative / peak.spy_cumulative - 1) : null;
          const spx12 = (i + 52 < allWeeks.length) ? (allWeeks[i + 52].spy_cumulative / peak.spy_cumulative - 1) : null;
          return { ...e, peakDate: peak.date, peakPctile: (peak[pctileKey] || 0) * 100, spx6, spx12, eventNote: findNamedEvent(peak.date) };
        }).sort((a, b) => Math.abs(a.peakPctile - currentPctile) - Math.abs(b.peakPctile - currentPctile)).slice(0, 8);

        return (
          <div onClick={() => { setHistoryOpen(null); setHistoryTimeframe(null); }} style={{ position: "fixed", inset: 0, background: "rgba(14,17,21,0.45)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 48, paddingBottom: 48, overflowY: "auto" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, width: 920, maxWidth: "94vw", padding: 32, position: "relative" }}>

              {/* Header row */}
              <button onClick={() => { setHistoryOpen(null); setHistoryTimeframe(null); }} style={{ position: "absolute", top: 18, right: 22, background: "transparent", border: "none", fontSize: 14, color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>Close <span style={{ fontSize: 18 }}>×</span></button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--accent)", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>{eyebrow}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 400, margin: 0, color: "var(--text)" }}>{title}</h2>
                    <span style={{ background: "rgba(47,157,106,0.10)", color: "var(--green)", borderRadius: 11, padding: "3px 11px", fontSize: 10, letterSpacing: "0.095em", fontWeight: 500, textTransform: "uppercase" }}>● FRESH · {macroEngine?.as_of}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1, color: "var(--text)" }}>{fmtVal(currentVal)}</div>
                  <div style={{ fontSize: 11, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", marginTop: 6, fontWeight: 500 }}>{stateNow} · {daysInState} days in state</div>
                </div>
              </div>

              {/* Caption sentence */}
              <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, marginBottom: 22 }}>
                <strong style={{ fontWeight: 500 }}>{title} is {captionState}.</strong>{" "}{captionSentence}
              </div>

              {/* KPI strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
                {[
                  { lbl: "Current",                            val: fmtVal(currentVal), sub: "today's reading" },
                  { lbl: isStress ? "85th percentile (5y)" : "70th percentile (5y)", val: fmtVal(upperMark), sub: "recalibrated daily" },
                  { lbl: isStress ? "Stage" : "Regime",        val: stateNow,            sub: daysInState + " days" },
                  { lbl: "Full sample range",                  val: fmtVal(minVal) + "–" + fmtVal(maxVal), sub: "1986 to today" },
                ].map(k => (
                  <div key={k.lbl} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{k.lbl}</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1.15, marginTop: 6, color: "var(--text)" }}>{k.val}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "16px 20px", marginBottom: 22 }}>
                <HistoryChart
                  data={allWeeks}
                  series={[{ key: valueKey, label: title, color: "var(--accent)" }]}
                  horizontalLines={[
                    { value: upperMark, label: (isStress ? "85th-pct = " : "70th-pct = ") + fmtVal(upperMark), color: "rgba(14,17,21,0.55)" },
                    ...(!isStress ? [{ value: midMark, label: "30th-pct = " + fmtVal(midMark), color: "rgba(14,17,21,0.35)" }] : []),
                  ]}
                  fmtY={fmtVal}
                  defaultTf="1Y"
                  height={320}
                  availableOverlays={isStress ? [
                    { key: "delta_y_3m_bp",    label: "ΔY-3M (bp)",          color: "rgba(94,94,99,0.7)" },
                    { key: "engine_cumulative", label: "Strategy $ (engine)", color: "rgba(0,113,227,0.5)" },
                  ] : [
                    { key: "move",              label: "MOVE level",          color: "rgba(94,94,99,0.7)" },
                    { key: "engine_cumulative", label: "Strategy $ (engine)", color: "rgba(0,113,227,0.5)" },
                  ]}
                />
              </div>

              {/* Historical reads near today's level */}
              {enriched.length > 0 && (
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Historical reads near today's level · S&P forward returns</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 10 }}>Readings from other periods when {title} was at a similar level to today (±5 percentile points). Historical reference, not a forecast.</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left",  padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Period</th>
                        <th style={{ textAlign: "left",  padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Note</th>
                        <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Value</th>
                        <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>SPX 6M</th>
                        <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>SPX 12M</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enriched.map((e) => {
                        const d = new Date(e.peakDate);
                        const periodLabel = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
                        return (
                          <tr key={e.peakDate}>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)" }}>{periodLabel}</td>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", color: "var(--text-2)" }}>{e.eventNote}</td>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmtVal(e.peakVal)}</td>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", fontFamily: "var(--font-mono)", color: e.spx6 == null ? "var(--text-dim)" : (e.spx6 >= 0 ? "var(--green)" : "var(--red)") }}>{e.spx6 == null ? "—" : (e.spx6 >= 0 ? "+" : "") + (e.spx6 * 100).toFixed(1) + "%"}</td>
                            <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-faint)", textAlign: "right", fontFamily: "var(--font-mono)", color: e.spx12 == null ? "var(--text-dim)" : (e.spx12 >= 0 ? "var(--green)" : "var(--red)") }}>{e.spx12 == null ? "—" : (e.spx12 >= 0 ? "+" : "") + (e.spx12 * 100).toFixed(1) + "%"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Release Calendar */}
              <div style={{ marginBottom: 22, background: "var(--surface-2)", border: "0.5px solid var(--border-faint)", borderRadius: 8, padding: "16px 20px" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Release calendar</div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 32px", fontSize: 13 }}>
                  <div style={{ color: "var(--text-muted)" }}>Frequency</div>
                  <div>Daily after close</div>
                  <div style={{ color: "var(--text-muted)" }}>Last release</div>
                  <div>{macroEngine?.as_of}</div>
                  <div style={{ color: "var(--text-muted)" }}>Source</div>
                  <div>{isStress ? "ICE BofA via Yahoo (^MOVE)" : "FRED DGS10 (10-year Treasury constant maturity)"}</div>
                  <div style={{ color: "var(--text-muted)" }}>Next refresh</div>
                  <div>Fri {macroEngine?.next_refresh} 15:45 ET</div>
                </div>
              </div>

              {/* Formula · Source · Caveat */}
              <div style={{ paddingTop: 14, borderTop: "1px solid var(--border-faint)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
                <div style={{ marginBottom: 6 }}><strong style={{ color: "var(--text)", fontWeight: 500 }}>Formula.</strong>{" "}
                {isStress ? "Implied volatility on Treasury options, weighted across 2y / 5y / 10y / 30y. Captures rate-policy uncertainty." : "Change in 10-year Treasury constant maturity yield over the trailing 3 months, in basis points. Negative = yields falling; positive = yields rising."}</div>
                <div style={{ marginBottom: 6 }}><strong style={{ color: "var(--text)", fontWeight: 500 }}>Source.</strong>{" "}
                {isStress ? "ICE BofA · via Yahoo (^MOVE) for 2002-onward; rolling 21-day std of 10-year yield daily changes × √252, Z-standardized to MOVE, for 1986–2002 proxy." : "FRED · DGS10."}</div>
                <div style={{ fontStyle: "italic", color: "var(--text-muted)" }}><strong style={{ color: "var(--text)", fontWeight: 500, fontStyle: "normal" }}>Caveat.</strong>{" "}
                {isStress ? "Bond vol typically MIDDLE in the stress chain — follows funding stress on the way up and leads equity vol." : "ΔY-3M signal is the regime classifier, not the de-risking trigger. Stress (MOVE) drives the equity-bucket size; ΔY-3M only picks which defensive mix activates."}</div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* MODALS */}
      {mechModal && <MechanismModal mechanism={mechModal} onClose={() => setMechModal(null)} />}
      {sectorModal && <SectorModal sector={sectorModal} igs={v10.industry_groups} onClose={() => setSectorModal(null)} onIGClick={(ig) => { setSectorModal(null); setIgModal(ig); }} onEtfClick={(e) => onOpenTicker(e.t || e)} />}
      {igModal && <IGModal ig={igModal} sectorIGs={v10.industry_groups.filter(x => x.sector === igModal.sector)} parentSector={v10.sectors.find(s => s.sector === igModal.sector)} onClose={() => setIgModal(null)} onEtfClick={(e) => onOpenTicker(e.t || e)} onBackToSector={(sector) => { setIgModal(null); setSectorModal(sector); }} onTickerClick={(t) => onOpenTicker(t)} />}
      </div>
    </main>
  );
}
