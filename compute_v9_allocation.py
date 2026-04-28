#!/usr/bin/env python3
"""
compute_v9_allocation.py — production calibration of v9.1 strategy.

Reads:
  - public/indicator_history.json  (existing daily indicator panel)
  - public/composite_history_daily.json  (R&L / Growth / Inflation & Rates)
  - Live FRED + Yahoo data for missing factors
  - yfinance for daily ETF/basket prices

Writes:
  - public/v9_allocation.json  (current allocation: picks, weights, regime,
                                 `all_industry_groups[]` covering all 25 IGs)

Designed to run weekly via V9-ALLOCATION-WEEKLY workflow.

Methodology: see asset-allocation-methodology-v9.md.

────────────────────────────────────────────────────────────────────────────
v9.1 EXTENSION (2026-04-26) — score all 25 GICS Industry Groups
────────────────────────────────────────────────────────────────────────────
Original v9 scored 14 ETF buckets and emitted a top-5 OW selection. v9.1
extends the scoring universe to ALL 25 GICS Industry Groups (post-March-2023
GICS structure: 11 sectors / 25 IGs / 74 industries / 163 sub-industries).

Picks logic is unchanged (top-5 OW selection) but now selects from the
broader 25-IG universe. Each IG is mapped to a tradable proxy (single ETF
when one cleanly maps to the GICS IG, equal-weight basket of representative
single names otherwise). Regression methodology is unchanged from v9:
60-month rolling factor regression, shrinkage 0.5, |std-coef| > 0.10
inclusion threshold.

────────────────────────────────────────────────────────────────────────────
v9.1 REFACTOR (2026-04-26) — compute_for_as_of() extracted
────────────────────────────────────────────────────────────────────────────
The core computation logic is now in `compute_for_as_of(as_of, factors,
composites, daily_ret)` so that both the live-rebalance entry point
(`main()`) and the historical replay tool (`backfill_allocation_history.py`)
call the same function. Every input is passed in and date-filtered inside
the function — no global today() lookups, no live yfinance/FRED pulls
inside the compute. This is what makes a strict walk-forward backfill
possible.
"""

from __future__ import annotations
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

# ════════════════════════════════════════════════════════════════════════════
# 25 GICS INDUSTRY GROUPS (post-March-2023 GICS structure)
# ════════════════════════════════════════════════════════════════════════════
INDUSTRY_GROUPS = [
    {"key": "ENRG", "code": "1010", "sector": "Energy",       "name": "Energy",
     "kind": "etf",    "proxy": "XLE",
     "fund": "SPDR Energy Select Sector — XOM, CVX, COP, EOG, MPC, PSX",
     "rationale": "XLE is the canonical large-cap US energy ETF; covers integrated, E&P, refining, midstream."},
    {"key": "MTLS", "code": "1510", "sector": "Materials",    "name": "Materials",
     "kind": "etf",    "proxy": "XLB",
     "fund": "SPDR Materials Select Sector — LIN, SHW, FCX, ECL, NEM",
     "rationale": "XLB is the canonical Materials ETF."},
    {"key": "CAPG", "code": "2010", "sector": "Industrials",  "name": "Capital Goods",
     "kind": "etf",    "proxy": "XLI",
     "fund": "SPDR Industrials Select Sector — CAT, HON, GE, RTX, BA, DE, LMT",
     "rationale": "XLI is dominated by Capital Goods constituents (~70%); imperfect but liquid proxy."},
    {"key": "CMSV", "code": "2020", "sector": "Industrials",  "name": "Commercial & Professional Services",
     "kind": "basket", "proxy": ["WM","RSG","CTAS","RHI","EFX","VRSK","BAH","RBA"],
     "fund": "Equal-weight basket — Waste Mgmt / Republic Svcs / Cintas / Robert Half / Equifax / Verisk / Booz Allen / RB Global",
     "rationale": "No clean ETF for GICS 2020; spans environmental, business, data/analytics services."},
    {"key": "TRNS", "code": "2030", "sector": "Industrials",  "name": "Transportation",
     "kind": "etf",    "proxy": "IYT",
     "fund": "iShares US Transportation — UPS, FDX, UNP, NSC, CSX, DAL, UAL",
     "rationale": "IYT is the canonical transports ETF; rails, airlines, parcels, trucking. Inception 2003."},
    {"key": "AUTO", "code": "2510", "sector": "Cons Disc",    "name": "Automobiles & Components",
     "kind": "etf",    "proxy": "CARZ",
     "fund": "First Trust S&P Global Auto Index — TSLA, TM, GM, F, STLA, HMC",
     "rationale": "Tesla-heavy, includes major OEMs + parts. Inception 2011."},
    {"key": "DURB", "code": "2520", "sector": "Cons Disc",    "name": "Consumer Durables & Apparel",
     "kind": "basket", "proxy": ["NKE","LULU","DECK","ONON","RL","TPR","CPRI","WHR","MHK","LEG","HAS"],
     "fund": "Equal-weight basket — Nike / Lululemon / Deckers / On / Ralph Lauren / Tapestry / Capri / Whirlpool / Mohawk / Leggett / Hasbro",
     "rationale": "Apparel + footwear + accessories + household durables + leisure products. No clean ETF."},
    {"key": "CSRV", "code": "2530", "sector": "Cons Disc",    "name": "Consumer Services",
     "kind": "etf",    "proxy": "PEJ",
     "fund": "Invesco Dynamic Leisure & Entertainment — MAR, HLT, BKNG, MGM, MCD",
     "rationale": "PEJ aligns ~70% with GICS 2530 (hotels, restaurants, leisure). Inception 2005."},
    {"key": "CRTL", "code": "2550", "sector": "Cons Disc",    "name": "Consumer Discretionary Distribution & Retail",
     "kind": "etf",    "proxy": "XRT",
     "fund": "SPDR S&P Retail — equal-weight retailers, AAP/BBY/ORLY/ROST/TJX/ULTA",
     "rationale": "XRT equal-weights retailers; better captures the IG than a cap-weighted alternative."},
    {"key": "STDR", "code": "3010", "sector": "Cons Staples", "name": "Consumer Staples Distribution & Retail",
     "kind": "basket", "proxy": ["WMT","COST","KR","TGT","DG","DLTR","BJ","ACI"],
     "fund": "Equal-weight basket — Walmart / Costco / Kroger / Target / Dollar General / Dollar Tree / BJ's / Albertsons",
     "rationale": "Mass merchants + grocery + dollar stores. No clean ETF."},
    {"key": "FBVT", "code": "3020", "sector": "Cons Staples", "name": "Food, Beverage & Tobacco",
     "kind": "etf",    "proxy": "PBJ",
     "fund": "Invesco Food & Beverage — KO, PEP, MO, PM, MDLZ, KHC, KDP, GIS",
     "rationale": "PBJ holds ~30 large food/beverage/tobacco names. Inception 2005."},
    {"key": "HHPP", "code": "3030", "sector": "Cons Staples", "name": "Household & Personal Products",
     "kind": "basket", "proxy": ["PG","CL","KMB","CHD","EL","COTY","CLX","CHWY","HRL"],
     "fund": "Equal-weight basket — P&G / Colgate / Kimberly-Clark / Church & Dwight / Estée Lauder / Coty / Clorox / Chewy / Hormel",
     "rationale": "Personal care + household products. No clean ETF."},
    {"key": "HCEQ", "code": "3510", "sector": "Health Care",  "name": "Health Care Equipment & Services",
     "kind": "etf",    "proxy": "IHI",
     "fund": "iShares US Medical Devices — TMO, ABT, MDT, BSX, SYK, ISRG, EW, BDX",
     "rationale": "IHI captures the equipment slice cleanly; services slice (UNH/CVS) under-represented (documented limitation)."},
    {"key": "PHRM", "code": "3520", "sector": "Health Care",  "name": "Pharmaceuticals, Biotechnology & Life Sciences",
     "kind": "etf",    "proxy": "XLV",
     "fund": "SPDR Health Care — JNJ, LLY, MRK, ABBV, PFE, TMO, AMGN, GILD",
     "rationale": "XLV dominated by pharma/biotech/life sciences (~75%). v9.1 collapses the v9 split (XLV+IBB) to one IG."},
    {"key": "BANK", "code": "4010", "sector": "Financials",   "name": "Banks",
     "kind": "etf",    "proxy": "XLF",
     "fund": "SPDR Financials — JPM, BRK.B, BAC, WFC, GS, MS, C, USB, PNC",
     "rationale": "XLF is bank-heavy. Insurance/Financial Services slices represented separately in 4030/4020."},
    {"key": "FNSV", "code": "4020", "sector": "Financials",   "name": "Financial Services",
     "kind": "etf",    "proxy": "IYG",
     "fund": "iShares US Financial Services — V, MA, JPM, BLK, AXP, SPGI, MCO, ICE",
     "rationale": "Payments + exchanges + data/index + asset mgrs. Inception 2000."},
    {"key": "INSR", "code": "4030", "sector": "Financials",   "name": "Insurance",
     "kind": "etf",    "proxy": "KIE",
     "fund": "SPDR S&P Insurance — PGR, CB, AIG, MET, AFL, ALL, TRV, PRU, HIG",
     "rationale": "Equal-weights US insurance carriers (P&C, life, multiline). Inception 2005."},
    {"key": "SOFT", "code": "4510", "sector": "Info Tech",    "name": "Software & Services",
     "kind": "etf",    "proxy": "IGV",
     "fund": "iShares Expanded Tech-Software — MSFT, ORCL, ADBE, CRM, INTU, NOW, SNOW, PANW",
     "rationale": "IGV is canonical software ETF; underweights services slightly but cleanest proxy."},
    {"key": "HRDW", "code": "4520", "sector": "Info Tech",    "name": "Technology Hardware & Equipment",
     "kind": "basket", "proxy": ["AAPL","CSCO","HPQ","DELL","STX","WDC","JNPR","NTAP","ZBRA","CDW","ANET","MSI"],
     "fund": "Equal-weight basket — Apple / Cisco / HP / Dell / Seagate / WD / Juniper / NetApp / Zebra / CDW / Arista / Motorola Solutions",
     "rationale": "AAPL dominates GICS 4520 by mcap (~60%); equal-weight basket reduces single-name distortion."},
    {"key": "SEMI", "code": "4530", "sector": "Info Tech",    "name": "Semiconductors & Semiconductor Equipment",
     "kind": "etf",    "proxy": "SOXX",
     "fund": "iShares Semiconductor — NVDA, AVGO, AMD, TSM, LRCX, KLAC, ASML, MU, INTC",
     "rationale": "SOXX is canonical semi ETF. Inception 2001."},
    {"key": "TLCM", "code": "5010", "sector": "Comm Svcs",    "name": "Telecommunication Services",
     "kind": "etf",    "proxy": "IYZ",
     "fund": "iShares US Telecommunications — T, VZ, TMUS",
     "rationale": "Canonical telecoms ETF; slight inflation vs strict GICS 5010 but standard proxy."},
    {"key": "MEDI", "code": "5020", "sector": "Comm Svcs",    "name": "Media & Entertainment",
     "kind": "etf",    "proxy": "XLC",
     "fund": "SPDR Communication Services — META, GOOGL, NFLX, DIS, EA, TTWO, WBD",
     "rationale": "Dominant exposure is Media & Entertainment (~80%); slight overlap with IYZ on telecoms. Inception 2018."},
    {"key": "UTIL", "code": "5510", "sector": "Utilities",    "name": "Utilities",
     "kind": "etf",    "proxy": "XLU",
     "fund": "SPDR Utilities — NEE, SO, DUK, CEG, AEP, SRE, D, EXC",
     "rationale": "Canonical utilities ETF."},
    {"key": "REIT", "code": "6010", "sector": "Real Estate",  "name": "Equity REITs",
     "kind": "etf",    "proxy": "IYR",
     "fund": "iShares US Real Estate — PLD, AMT, EQIX, WELL, SPG, O, DLR, PSA",
     "rationale": "Covers all REIT subsectors."},
    {"key": "REMG", "code": "6020", "sector": "Real Estate",  "name": "Real Estate Management & Development",
     "kind": "basket", "proxy": ["CBRE","JLL","Z","EXP","OPEN","RDFN","NMRK","KW"],
     "fund": "Equal-weight basket — CBRE / JLL / Zillow / eXp / Opendoor / Redfin / Newmark / Kennedy-Wilson",
     "rationale": "Non-REIT real estate (brokerages + online platforms + holding). No clean ETF."},
]

EQUITY = {ig["key"]: ig for ig in INDUSTRY_GROUPS}

DEFENSIVE = {
    "BIL": "SPDR 1-3 Month Treasury Bill ETF (cash proxy)",
    "TLT": "iShares 20+ Year Treasury Bond ETF (long duration)",
    "GLD": "SPDR Gold Shares",
    "LQD": "iShares Investment Grade Corporate Bond ETF",
}

PER_BUCKET_MV = {
    "SOFT": ["jobless", "m2_yoy", "industrial_prod"],
    "SEMI": ["copper_gold"],
    "PHRM": ["jobless"],
    "BANK": ["anfci", "capacity_util"],
    "CAPG": ["jobless", "stlfsi", "vix", "breakeven_10y"],
    "ENRG": ["jobless", "sloos_cre"],
    "CSRV": ["jobless", "natgas_henry"],
    "FBVT": ["sloos_ci", "jobless"],
    "UTIL": ["sloos_ci"],
    "MTLS": ["jobless", "stlfsi", "vix", "breakeven_10y", "skew"],
    "REIT": ["anfci", "capacity_util"],
    "TLCM": ["sloos_ci", "vix", "capacity_util", "real_rates", "anfci", "cpff"],
    "CMSV": ["jobless", "capacity_util", "anfci"],
    "TRNS": ["natgas_henry", "capacity_util", "jobless"],
    "AUTO": ["natgas_henry", "jobless", "breakeven_10y", "real_rates"],
    "DURB": ["jobless", "real_rates", "breakeven_10y"],
    "CRTL": ["jobless", "sloos_ci", "m2_yoy"],
    "STDR": ["sloos_ci", "breakeven_10y", "jobless"],
    "HHPP": ["sloos_ci", "breakeven_10y", "vix"],
    "HCEQ": ["jobless", "sloos_ci", "capacity_util"],
    "FNSV": ["anfci", "capacity_util", "vix"],
    "INSR": ["anfci", "real_rates", "vix"],
    "HRDW": ["jobless", "real_rates", "breakeven_10y", "capacity_util"],
    "MEDI": ["jobless", "real_rates", "vix", "breakeven_10y"],
    "REMG": ["anfci", "real_rates", "capacity_util", "breakeven_10y"],
}
UNIVERSAL_BG = ["yield_curve", "term_premium"]

DEFENSIVE_FACTORS = {
    "BIL": ["yield_curve", "fed_funds"],
    "TLT": ["yield_curve", "term_premium", "real_rates"],
    "GLD": ["copper_gold", "real_rates"],
    "LQD": ["yield_curve", "term_premium"],
}

# ════════════════════════════════════════════════════════════════════════════
# Config
# ════════════════════════════════════════════════════════════════════════════

WINDOW = 60
MOMENTUM_WINDOW = 6
SHRINK = 0.5
RF_ANN = 0.04
RF_M = (1 + RF_ANN) ** (1 / 12) - 1
LEV_FIN_M = (1.005) ** (1 / 12) - 1
DEF_CAP = 0.70
N_PICKS = 5
RL_FLIP_THRESHOLD = -15
MIN_HISTORY_MONTHS = 24

REPO_ROOT = Path(__file__).resolve().parent
PUBLIC = REPO_ROOT / "public"

FRED_EXTRAS = {
    "fed_funds":      "DFF",
    "industrial_prod":"INDPRO",
    "capacity_util":  "TCU",
    "natgas_henry":   "DHHNGSP",
}

# ════════════════════════════════════════════════════════════════════════════
# Data loaders
# ════════════════════════════════════════════════════════════════════════════


def load_factor_panel():
    """Combine indicator_history.json + live FRED extras into a single panel.

    Returns the FULL panel up to the current date — date filtering for
    walk-forward replay is done by the caller (compute_for_as_of) via
    `factors.loc[:as_of]`.
    """
    out = {}
    ih = json.loads((PUBLIC / "indicator_history.json").read_text())
    for k, blob in ih.items():
        if k == "__meta__":
            continue
        pts = blob.get("points", [])
        if not pts:
            continue
        s = pd.Series([v for _, v in pts], index=pd.to_datetime([d for d, _ in pts]))
        out[k] = s.astype(float)

    for label, sid in FRED_EXTRAS.items():
        if label in out:
            continue
        try:
            url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2001-01-01"
            df = pd.read_csv(url)
            df.columns = ["date", "value"]
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
            df["value"] = pd.to_numeric(df["value"], errors="coerce")
            out[label] = df["value"].dropna()
        except Exception as e:
            print(f"  [warn] FRED pull failed for {label}: {e}")

    return pd.DataFrame(out).ffill().dropna(how="all")


def load_composites():
    cd = json.loads((PUBLIC / "composite_history_daily.json").read_text())
    df = pd.DataFrame(cd)
    df["d"] = pd.to_datetime(df["d"])
    return df.set_index("d")[["RL", "GR", "IR"]].astype(float)


def all_proxy_tickers():
    tickers = set()
    for ig in INDUSTRY_GROUPS:
        if ig["kind"] == "etf":
            tickers.add(ig["proxy"])
        else:
            tickers.update(ig["proxy"])
    tickers.update(DEFENSIVE.keys())
    return sorted(tickers)


def load_prices(start="2003-01-01"):
    """One yfinance pull for every proxy ticker. Returns daily Close DataFrame."""
    tickers = all_proxy_tickers()
    df = yf.download(tickers, start=start, progress=False, auto_adjust=True, threads=True)
    if isinstance(df.columns, pd.MultiIndex):
        df = df["Close"]
    return df


def build_basket_returns(constituents, daily_ret):
    avail = [t for t in constituents if t in daily_ret.columns]
    if not avail:
        return pd.Series(dtype=float)
    sub = daily_ret[avail]
    monthly = sub.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    return monthly.mean(axis=1, skipna=True)


# ════════════════════════════════════════════════════════════════════════════
# Math
# ════════════════════════════════════════════════════════════════════════════


def per_bucket_factors(key):
    return list(dict.fromkeys(UNIVERSAL_BG + PER_BUCKET_MV.get(key, [])))


def fit_per_asset_forecast(asset_returns, factor_panel, factor_names):
    cols = [c for c in factor_names if c in factor_panel.columns]
    if not cols:
        return None
    X = factor_panel[cols].shift(1)
    aligned = pd.concat([asset_returns.rename("r"), X], axis=1).dropna()
    if len(aligned) < MIN_HISTORY_MONTHS:
        return None
    y_arr = aligned["r"].values
    X_raw = aligned.drop(columns="r").values
    col_mean = X_raw.mean(axis=0)
    col_sd = X_raw.std(axis=0)
    col_sd = np.where(col_sd < 1e-9, 1.0, col_sd)
    X_std = (X_raw - col_mean) / col_sd
    Xa = np.column_stack([np.ones(len(aligned)), X_std])
    try:
        coefs, *_ = np.linalg.lstsq(Xa, y_arr, rcond=None)
    except Exception:
        return None
    last_X_raw = aligned.drop(columns="r").iloc[-1].values
    last_X_std = (last_X_raw - col_mean) / col_sd
    raw = coefs[0] + coefs[1:] @ last_X_std
    long_run = float(asset_returns.mean())
    return float((1 - SHRINK) * raw + SHRINK * long_run)


def equity_share_from_RL(rl):
    if rl <= 20: return 1.0
    if rl <= 30: return 1.0 - (rl - 20) * 0.015
    if rl <= 50: return 0.85 - (rl - 30) * 0.0125
    return 0.60


def leverage_from_IR(ir):
    if ir > 30: return 1.0
    if ir > 0:  return 1.0 + (1 - ir / 30) * 0.10
    if ir > -10: return 1.10 + (-ir / 10) * 0.15
    if ir > -50: return 1.25 + min(1, (-ir - 10) / 40) * 0.25
    return 1.50


def max_sharpe(mu, sigma, cap, rf):
    from scipy.optimize import minimize
    import math
    n = len(mu)
    def neg(w): return -(w @ mu - rf) / max(1e-12, math.sqrt(w @ sigma @ w))
    res = minimize(neg, np.ones(n) / n, method="SLSQP",
                   bounds=[(0, cap)] * n,
                   constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}])
    return res.x if res.success else np.ones(n) / n


def select_picks(avail_keys, mu_dict, mom_dict, regime_flip):
    n = len(avail_keys)
    if n < N_PICKS:
        return [(k, 1 / n) for k in avail_keys], "TOO_SMALL"

    mu_arr = np.array([mu_dict[k] for k in avail_keys])
    indicator_ranks = (-mu_arr).argsort().argsort() + 1

    if regime_flip:
        indexed = sorted([(k, indicator_ranks[i]) for i, k in enumerate(avail_keys)],
                         key=lambda x: x[1])
        picks = [(k, 1 / N_PICKS) for k, _ in indexed[:N_PICKS]]
        return picks, "FLIP_OVERRIDE"

    mom_arr = np.array([mom_dict.get(k, 0) for k in avail_keys])
    momentum_ranks = (-mom_arr).argsort().argsort() + 1
    median = n / 2

    eligible, indicator_only = [], []
    for i, k in enumerate(avail_keys):
        ind_top = indicator_ranks[i] <= median
        mom_top = momentum_ranks[i] <= median
        combined = indicator_ranks[i] + momentum_ranks[i]
        if ind_top and mom_top:
            eligible.append((k, combined, indicator_ranks[i], momentum_ranks[i]))
        elif ind_top:
            indicator_only.append((k, combined, indicator_ranks[i], momentum_ranks[i]))
    eligible.sort(key=lambda x: x[1])
    indicator_only.sort(key=lambda x: x[1])

    if len(eligible) >= N_PICKS:
        return [(k, 1 / N_PICKS, ind_r, mom_r)
                for k, _, ind_r, mom_r in eligible[:N_PICKS]], "STRONG"
    picks = eligible[:]
    n_short = N_PICKS - len(picks)
    picks += indicator_only[:n_short]
    if len(picks) < N_PICKS:
        return [(k, 1 / len(picks), ind_r, mom_r)
                for k, _, ind_r, mom_r in picks], "PARTIAL"
    return [(k, 1 / N_PICKS, ind_r, mom_r)
            for k, _, ind_r, mom_r in picks], "MIXED"


def assign_rating(combined_rank, total_n):
    if combined_rank <= 5: return "ow"
    if combined_rank > total_n - 5: return "uw"
    return "mw"


# ════════════════════════════════════════════════════════════════════════════
# Core compute — takes as_of + pre-loaded data, returns the full output dict.
# Used by both main() (live) and backfill_allocation_history.py (replay).
# ════════════════════════════════════════════════════════════════════════════


def compute_for_as_of(as_of, factors, composites, daily_ret, calculated_at=None):
    """Compute v9.1 allocation as of a specific date.

    Walk-forward integrity: every input is filtered to data ≤ as_of inside
    this function. No live network calls. No `today()` lookups.

    Args:
      as_of:        pd.Timestamp — date the recommendation is dated as of
      factors:      pd.DataFrame — full factor panel (columns = factor names,
                                   index = daily DatetimeIndex)
      composites:   pd.DataFrame — full daily composite panel (RL/GR/IR)
      daily_ret:    pd.DataFrame — full daily return panel for all proxy
                                   tickers (columns = tickers)
      calculated_at: optional ISO string for the `calculated_at` field;
                     defaults to "now" if None.

    Returns the full output dict (matches v9_allocation.json schema).
    """
    as_of = pd.Timestamp(as_of)

    # ── Filter all inputs to data ≤ as_of (strict walk-forward) ──────────
    factors_f = factors.loc[:as_of]
    composites_f = composites.loc[:as_of]
    daily_ret_f = daily_ret.loc[:as_of]

    # ── Build IG return series (ETF or basket) ──────────────────────────
    monthly_ret_etf = daily_ret_f.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    ig_monthly_returns = {}
    for ig in INDUSTRY_GROUPS:
        if ig["kind"] == "etf":
            t = ig["proxy"]
            if t in monthly_ret_etf.columns:
                ig_monthly_returns[ig["key"]] = monthly_ret_etf[t]
        else:
            ig_monthly_returns[ig["key"]] = build_basket_returns(ig["proxy"], daily_ret_f)

    def_monthly_returns = {t: monthly_ret_etf[t] for t in DEFENSIVE if t in monthly_ret_etf.columns}

    # ── Determine rebalance month (last complete month ≤ as_of) ──────────
    if len(monthly_ret_etf.index) < 2:
        raise RuntimeError(f"as_of {as_of} too early — not enough monthly data")
    last_complete_month = (
        monthly_ret_etf.index[-2] if as_of.day < 28 else monthly_ret_etf.index[-1]
    )
    if (monthly_ret_etf.index <= last_complete_month).sum() < WINDOW:
        raise RuntimeError(
            f"Not enough history at as_of {as_of}: need {WINDOW} months ≤ {last_complete_month.date()}"
        )

    monthly_factors = factors_f.resample("ME").last().dropna(how="all")
    wf = monthly_factors.loc[:last_complete_month]
    monthly_comp = composites_f.resample("ME").last().dropna()

    # ── Forecast each IG ─────────────────────────────────────────────────
    mu = {}
    for ig in INDUSTRY_GROUPS:
        k = ig["key"]
        if k not in ig_monthly_returns:
            continue
        series = ig_monthly_returns[k].loc[:last_complete_month].dropna()
        if len(series) < MIN_HISTORY_MONTHS:
            continue
        win_series = series.iloc[-WINDOW:] if len(series) >= WINDOW else series
        f = fit_per_asset_forecast(win_series, wf, per_bucket_factors(k))
        if f is not None:
            mu[k] = f

    for tkr, ret_series in def_monthly_returns.items():
        win = ret_series.loc[:last_complete_month].dropna()
        if len(win) < MIN_HISTORY_MONTHS:
            continue
        win = win.iloc[-WINDOW:] if len(win) >= WINDOW else win
        f = fit_per_asset_forecast(win, wf, DEFENSIVE_FACTORS[tkr])
        if f is not None:
            mu[tkr] = f

    avail_e = [ig["key"] for ig in INDUSTRY_GROUPS if ig["key"] in mu]
    avail_d = [t for t in DEFENSIVE if t in mu]

    # ── Momentum (6-month trailing return ending at last_complete_month) ─
    mom = {}
    for k, series in ig_monthly_returns.items():
        s_in = series.loc[:last_complete_month].dropna()
        if len(s_in) >= MOMENTUM_WINDOW:
            w = s_in.iloc[-MOMENTUM_WINDOW:]
            mom[k] = float((1 + w).prod() - 1)

    # ── Composites — use prior-month-end (lookahead-safe) ────────────────
    prior_dt = last_complete_month - pd.offsets.MonthEnd(1)
    comp_subset = monthly_comp.loc[:prior_dt]
    if comp_subset.empty:
        raise RuntimeError(f"No composites available before {prior_dt}")
    comp_t = comp_subset.iloc[-1]
    rl_now = float(comp_t["RL"])
    gr_now = float(comp_t["GR"])
    ir_now = float(comp_t["IR"])

    rl_3mo_change = 0.0
    if len(comp_subset) >= 4:
        rl_3mo_change = rl_now - float(comp_subset.iloc[-4]["RL"])
    regime_flip = (rl_3mo_change < RL_FLIP_THRESHOLD) and (rl_now < 30)

    # ── Picks ────────────────────────────────────────────────────────────
    picks_info, confidence = select_picks(avail_e, mu, mom, regime_flip)

    # ── Defensive sub-portfolio ──────────────────────────────────────────
    if avail_d:
        def_win = pd.DataFrame({t: def_monthly_returns[t].loc[:last_complete_month] for t in avail_d})
        def_win = def_win.iloc[-WINDOW:].dropna()
        cov_D = def_win.cov().values
        cov_D = 0.7 * cov_D + 0.3 * np.diag(np.diag(cov_D))
        mu_d_vec = np.array([mu[t] for t in avail_d])
        w_D = max_sharpe(mu_d_vec, cov_D, DEF_CAP, RF_M)
    else:
        w_D = np.array([])

    # ── Equity share + leverage ──────────────────────────────────────────
    equity_share = equity_share_from_RL(rl_now)
    leverage = leverage_from_IR(ir_now)
    if rl_now > 20:
        leverage = 1.0
    alpha = equity_share * leverage

    if alpha <= 1.0:
        w_eq_total, w_def_total, financing = alpha, 1 - alpha, 0.0
    else:
        w_eq_total, w_def_total = alpha, 0.0
        financing = (alpha - 1.0) * (RF_M + LEV_FIN_M)

    # ── all_industry_groups output ───────────────────────────────────────
    if avail_e:
        mu_arr = np.array([mu[k] for k in avail_e])
        mom_arr = np.array([mom.get(k, 0.0) for k in avail_e])
        ind_ranks = (-mu_arr).argsort().argsort() + 1
        mom_ranks = (-mom_arr).argsort().argsort() + 1
        combined_arr = ind_ranks + mom_ranks
        combined_ranks = combined_arr.argsort().argsort() + 1
    else:
        ind_ranks = mom_ranks = combined_ranks = np.array([])

    rank_lookup = {
        k: {
            "indicator_rank": int(ind_ranks[i]),
            "momentum_rank":  int(mom_ranks[i]),
            "combined_rank":  int(combined_ranks[i]),
        }
        for i, k in enumerate(avail_e)
    }

    all_ig_rows = []
    for ig in INDUSTRY_GROUPS:
        k = ig["key"]
        ranks = rank_lookup.get(k, {})
        scored = k in mu
        kind = ig["kind"]
        if kind == "etf":
            primary_ticker = ig["proxy"]
            ticker_repr    = ig["proxy"]
        else:
            primary_ticker = ig["proxy"][0]
            ticker_repr    = ",".join(ig["proxy"])
        all_ig_rows.append({
            "key": k,
            "code": ig["code"],
            "sector": ig["sector"],
            "name": ig["name"],
            "proxy_kind": kind,
            "primary_ticker": primary_ticker,
            "ticker": ticker_repr,
            "fund": ig["fund"],
            "rationale_proxy": ig["rationale"],
            "scored": scored,
            "expected_return_monthly": float(mu.get(k, 0.0)) if scored else None,
            "trailing_6mo_return":     float(mom.get(k, 0.0)) if k in mom else None,
            "indicator_rank": ranks.get("indicator_rank"),
            "momentum_rank":  ranks.get("momentum_rank"),
            "combined_rank":  ranks.get("combined_rank"),
            "rating": assign_rating(ranks["combined_rank"], len(avail_e)) if scored else "mw",
        })

    # ── Picks rows ───────────────────────────────────────────────────────
    pick_rows = []
    for entry in picks_info:
        if len(entry) == 4:
            k, w_in, ind_r, mom_r = entry
        else:
            k, w_in = entry
            ind_r, mom_r = None, None
        ig = next(x for x in INDUSTRY_GROUPS if x["key"] == k)
        primary_ticker = ig["proxy"] if ig["kind"] == "etf" else ig["proxy"][0]
        pick_rows.append({
            "key": k,
            "ticker": primary_ticker,
            "name": ig["name"],
            "sector": ig["sector"],
            "fund": ig["fund"],
            "weight": float(w_eq_total * w_in),
            "weight_within_equity": float(w_in),
            "indicator_rank": int(ind_r) if ind_r is not None else None,
            "momentum_rank":  int(mom_r) if mom_r is not None else None,
            "expected_return_monthly": float(mu.get(k, 0.0)),
            "trailing_6mo_return":     float(mom.get(k, 0.0)),
        })

    # ── Defensive rows ───────────────────────────────────────────────────
    def_rows = []
    for j, t in enumerate(avail_d):
        def_rows.append({
            "ticker": t,
            "fund": DEFENSIVE[t],
            "weight": float(w_def_total * w_D[j]),
            "weight_within_defensive": float(w_D[j]),
        })

    return {
        "as_of": str(last_complete_month.date()),
        "calculated_at": calculated_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "regime": {
            "risk_liquidity": rl_now,
            "growth": gr_now,
            "inflation_rates": ir_now,
            "rl_3mo_change": rl_3mo_change,
            "regime_flip_active": regime_flip,
        },
        "alpha": float(alpha),
        "equity_share": float(equity_share),
        "leverage": float(leverage),
        "financing_drag_monthly": float(financing),
        "selection_confidence": confidence,
        "picks": pick_rows,
        "defensive": def_rows,
        "all_industry_groups": all_ig_rows,
        "methodology": {
            "version": "v9.1",
            "locked_at": "2026-04-25",
            "extension_locked_at": "2026-04-26",
            "back_test_window": "2008-01 to 2026-04",
            "back_test_cagr": 0.1388,
            "back_test_sharpe": 0.610,
            "back_test_max_drawdown": -0.2364,
            "vs_spy_cagr_diff": 0.0282,
            # SPX (S&P 500 price index) benchmark stats — computed from
            # public/composite_history_daily.json over the same window.
            "back_test_spx_cagr": 0.0916,
            "back_test_spx_sharpe": 0.540,
            "back_test_spx_max_drawdown": -0.533,
            "vs_spx_cagr_diff": 0.0472,
            "ig_universe_size": len(INDUSTRY_GROUPS),
            "igs_scored":       len(avail_e),
        },
    }


# ════════════════════════════════════════════════════════════════════════════
# Entry point — live rebalance
# ════════════════════════════════════════════════════════════════════════════


def main():
    print("[v9.1] computing current allocation across 25 GICS Industry Groups…")

    print("  loading factor panel…")
    factors = load_factor_panel()
    print(f"    {len(factors.columns)} factors, latest: {factors.index[-1].date()}")

    print("  loading composites…")
    composites = load_composites()
    print(f"    composites latest: {composites.index[-1].date()}")

    print("  pulling daily ETF + basket constituent prices (yfinance)…")
    df = load_prices()
    daily_ret = df.pct_change().dropna(how="all")
    print(f"    {len(daily_ret.columns)} tickers, latest: {daily_ret.index[-1].date()}")

    today = pd.Timestamp.today()
    out = compute_for_as_of(today, factors, composites, daily_ret)

    out_path = PUBLIC / "v9_allocation.json"
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"\n[done] wrote {out_path}")
    print(f"  alpha = {out['alpha']:.3f} (equity_share {out['equity_share']:.2f} × leverage {out['leverage']:.2f})")
    print(f"  picks: {[p['ticker'] for p in out['picks']]}")
    print(f"  selection: {out['selection_confidence']}")
    print(f"  IGs scored: {out['methodology']['igs_scored']}/{out['methodology']['ig_universe_size']}")


if __name__ == "__main__":
    main()
