// AssetTilt — Phase 5 React page reading live v10.1c allocator output.
//
// Consumes:
//   /cycle_board_snapshot.json  — 6 mechanism scores (refreshed nightly at 22:30 UTC)
//   /v10_allocation.json        — today's recommended allocation (refreshed nightly at 22:45 UTC)

import { useState, useEffect, useMemo } from "react";
import FreshnessDot from "../components/FreshnessDot";
import { InfoTip } from "../InfoTip";
import MTTable from "../components/MTTable";

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
      renderChild: () => <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      key: "p3m", label: "3M", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + returnDef} />,
      sortValue: (r) => r.perf_3m,
      render: (r) => <span style={{ color: pctColor(r.perf_3m) }}>{fmtPct(r.perf_3m)}</span>,
      renderChild: () => <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      key: "pttm", label: "TTM", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + returnDef} />,
      sortValue: (r) => r.perf_ttm,
      render: (r) => <span style={{ color: pctColor(r.perf_ttm) }}>{fmtPct(r.perf_ttm)}</span>,
      renderChild: () => <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      key: "vol", label: "Vol", numeric: true, defaultWidth: 70,
      headerExtra: <InfoTip def={proxyDef + " " + volDef} />,
      sortValue: (r) => r.vol_ttm,
      render: (r) => <span style={{ color: "var(--text-2)" }}>{fmtVol(r.vol_ttm)}</span>,
      renderChild: () => <span style={{ color: "var(--text-muted)" }}>—</span>,
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
                     : ig.vs_spy_pp != null && Math.abs(ig.vs_spy_pp) >= 0.5 ? "rgba(14,85,96,0.65)"
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
    if (a > 0.7) return { bg: "rgba(14,85,96,0.55)", color: "#fff" };
    if (a > 0.3) return { bg: "rgba(14,85,96,0.30)", color: "var(--text)" };
    if (a > 0)   return { bg: "rgba(14,85,96,0.15)", color: "var(--text)" };
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

export default function AssetTilt({ onOpenTicker }) {
  const [cycleBoard, setCycleBoard] = useState(null);
  const [v10, setV10] = useState(null);
  const [mechModal, setMechModal] = useState(null);
  const [sectorModal, setSectorModal] = useState(null);
  const [igModal, setIgModal] = useState(null);
  const [sectorPerf, setSectorPerf] = useState(null);

  useEffect(() => {
    fetch("/cycle_board_snapshot.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setCycleBoard).catch(() => setCycleBoard(null));
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
    <main style={{ maxWidth: 1216, margin: "0 auto", padding: "24px 32px 48px" }}>
      {/* HERO — Joe mockup 2026-05-08 v3:
          LEFT (~2/3): eyebrow + h1 + Engine subtitle.
          RIGHT (~1/3): "Key Statistics vs. S&P 500" card with 4 KPI cells. */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 36, alignItems: "start", marginBottom: 32 }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, marginBottom: 14 }}>
            Asset Tilt
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 3.4vw, 38px)", fontWeight: 400, margin: "0 0 12px", letterSpacing: "-0.012em", lineHeight: 1.18, color: "var(--text)" }}>
            A back-tested model that seeks to <em style={{fontStyle:"italic", color:"var(--accent)", fontWeight:500}}>beat the S&P 500 on a risk-adjusted basis</em> over the long run.
          </h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 16, lineHeight: 1.55, color: "var(--text-2)", margin: "10px 0 0", maxWidth: 720, fontWeight: 400 }}>
            Thousands of back-tested risk factors and macro variables, overlaid with the live <a href="#overview" style={{color:"var(--accent)", fontWeight:500, textDecoration:"none", borderBottom:"1px solid var(--accent)"}}>Cycle Mechanisms</a> readings from Macro Overview, produce a recommended portfolio. Hard rules keep it in the fairway &mdash; e.g., max leverage 150%, max defensive 50%.
          </p>
        </div>
        <aside style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px 14px", display: "flex", flexDirection: "column", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 14 }}>
            Key Statistics vs. S&amp;P 500
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, textAlign: "left" }}>
            {[
              { label: "CAGR",         value: "13.85%",  sub: "vs SPY 11.61%" },
              { label: "Sharpe",       value: "1.034",    sub: "annualized" },
              { label: "Max Drawdown", value: "−20.81%", sub: "peak-to-trough" },
              { label: "Calibration",  value: "Jan 2012", sub: "through May 2026" },
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
      </section>


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

      {/* MODALS */}
      {mechModal && <MechanismModal mechanism={mechModal} onClose={() => setMechModal(null)} />}
      {sectorModal && <SectorModal sector={sectorModal} igs={v10.industry_groups} onClose={() => setSectorModal(null)} onIGClick={(ig) => { setSectorModal(null); setIgModal(ig); }} onEtfClick={(e) => onOpenTicker(e.t || e)} />}
      {igModal && <IGModal ig={igModal} sectorIGs={v10.industry_groups.filter(x => x.sector === igModal.sector)} parentSector={v10.sectors.find(s => s.sector === igModal.sector)} onClose={() => setIgModal(null)} onEtfClick={(e) => onOpenTicker(e.t || e)} onBackToSector={(sector) => { setIgModal(null); setSectorModal(sector); }} onTickerClick={(t) => onOpenTicker(t)} />}
    </main>
  );
}
