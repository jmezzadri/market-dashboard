# Asset Tilt — Methodology Specification (v1)
**Owner:** Senior Quant · **Status:** Phase A design (calibration params filled by the backtest harness) · **Date:** 2026-06-16

This file is the single source of truth: the backtest harness, the live producers, and the page copy all read the parameters and definitions below. No number reaches the page that isn't produced here and validated by the backtest.

---

## 0 · What Asset Tilt answers (the "so what")
*How should I be positioned right now?* Two independent layers:
1. **Equity-vs-defensive split** (the macro engine): how much risk to carry (equity %) and, when defensive, in what (cash / gold / short or long Treasuries).
2. **Sector & industry-group tilts**: within the equity sleeve, which sectors to over/under-weight vs the S&P 500 cap weights, and why — each tilt traceable to a named macro cause confirmed by price.

Every tilt must read as one sentence a PM can act on (e.g. "Overweight Energy: macro favors it — oil and breakevens rising — price confirms with 3-month leadership, valuation not stretched").

---

## 1 · Data inputs (point-in-time, publication-lagged)
All factors are **lagged by their real publication delay** before they may predict (no look-ahead — INDICATOR_TIMING_REFERENCE). Calibration pulls the **deepest free history** per series (FRED direct for 1996+ where the stored file floors at 2006); the live producer reads the site's stored series.

**Prices (from `prices_eod`, deep to 1996/inception):** 11 sector ETFs (XLK XLF XLE XLI XLY XLP XLV XLU XLB XLRE XLC), the industry-group ETFs (SMH SOXX XBI IBB KRE KBE ITB XHB XOP OIH XME XRT JETS IGV CIBR GDX KIE IYT PAVE XAR TAN XTL), benchmark SPY, and defensive instruments TLT IEF SHY BIL GLD. Pre-inception sectors use the matched Fama-French/SPDR proxy only inside the backtest, never on the live page.

**Macro factors (deep FRED for calibration; stored series live), by group:**
- **Growth:** ISM (stored `ism_mfg`/`ism_svc`, lag ~1 business day), GDPNow, initial jobless claims (`DGS`→`ICSA`, weekly), CFNAI (monthly, ~3wk lag).
- **Rates & curve:** 10Y (`DGS10`), 2s10s (`T10Y2Y`), 10Y real (`DFII10`, from 2003).
- **Inflation / commodities:** 10Y breakeven (`T10YIE`, from 2003), copper/gold ratio (stored, deep to 2000), WTI (stored, deep to 2000).
- **Credit & financial conditions:** Chicago Fed ANFCI (`ANFCI`, weekly, deep), HY OAS (`BAMLH0A0HYM2`/stored to 2011), Baa–10Y credit spread (`BAA10Y`, deep — the deep IG-credit stand-in, since ICE IG OAS is vendor-capped at ~3y).
- **Dollar:** broad dollar (`DTWEXBGS`; splice `DTWEXB` pre-2006 with continuity check per LESSONS 5.1).

---

## 2 · Sector / industry-group factor model
Each sector (then each industry group, second pass) gets a composite of **four standardized, cross-sectionally z-ranked sleeves**:

| Sleeve | Weight | Definition |
|---|---|---|
| **Macro-regime (primary)** | **45%** | Σ over macro factors of (sector's estimated sensitivity βᵢ) × (current standardized factor reading). βᵢ estimated from history (§3). |
| **Momentum** | **25%** | 12-1 total return (12-mo ex the latest month) + distance from 200-day average, equally blended, z-ranked. |
| **Relative strength** | **20%** | Trailing 3- and 6-mo return vs SPY, equally blended, z-ranked. |
| **Valuation brake** | **10%** | Forward earnings-yield percentile vs the sector's own 5-yr range (high EY = cheap = positive; brakes expensive favored sectors). Forward-EY unavailable pre-coverage → sleeve weight redistributed pro-rata to the other three for that date. |

**Composite → tilt:** composite score `C_s` (weighted sum of the four z-scores) is mapped to an **active tilt vs the sector's S&P cap weight**, scaled so the cross-section is dollar-neutral (Σ tilts = 0) and **clipped to [−4%, +6%]**. Rebalanced **weekly** (Friday close). Cap-weight reference = live SPY sector weights (stored `SPY_SECTOR_WEIGHTS_DAILY`).

**Industry-group pass:** identical machinery on the industry-group ETFs, tilts expressed within their parent sector, same clip and weekly cadence.

---

## 3 · Macro-regime sleeve — sensitivity estimation (the core)
For each sector × macro factor: estimate βᵢ = sensitivity of the sector's **forward excess return** (vs SPY) to a standardized move in the factor, **point-in-time and publication-lagged**, over the full history.
- Standardize each factor as a trailing z-score (expanding/long-window, no look-ahead).
- Estimate βᵢ by rank/robust regression of forward 1-, 3-, 6-mo sector excess returns on the lagged factor z-scores; horizon weighting per the factor's best AUC horizon (§5).
- **Sign-stability gate:** re-estimate βᵢ on disjoint sub-periods (e.g. 1996–2007, 2008–2015, 2016–2026). A factor's βᵢ for a sector is kept ONLY if its **sign is stable across all sub-periods** (no era-curve-fitting). Unstable βᵢ → set to 0 (factor not used for that sector). Documented in the calibration output.
- Current expected tilt = Σᵢ βᵢ × (current factor z). This is the macro sleeve score before cross-sectional ranking.

**Plain-English trace requirement:** the producer emits, per sector, the top ±2 contributing (factor, β·z) terms so the page can name *why* ("oil + breakevens rising" etc.).

---

## 4 · Equity-vs-defensive engine — rework
Two axes (unchanged architecture; recalibrated and stress-signal revisited):
- **Stress axis (how much equity):** test a **blend** = standardized(MOVE) + standardized(equity vol, VIX) + standardized(credit spread, HY OAS) vs **MOVE alone**, on drawdown discrimination (§5 AUC at 1/3/6/12m). Adopt the blend only if it beats MOVE-alone on AUC out of sample. Map stress to equity %: **Risk-On 100% / Watch 80% / Risk-Off 50%**, cut-points **re-fit on full 1996+** (percentile thresholds of the chosen stress signal, chosen to maximize forward-drawdown separation, not hand-set).
- **Rate-regime axis (defensive sleeve type), per LESSONS 5.5:** trailing 3-mo change in 10Y, percentile-ranked vs trailing 5y. **Inflationary (≥70th pct):** cash + gold + **short-duration** Treasuries (avoid duration). **Deflationary (≤30th):** cash + gold + **long** Treasuries. **Neutral:** balanced. Must hold through 2000/2008/2020/**2022** (the 2022 case that broke a long-Treasury default).

---

## 5 · Backtest protocol (the gate — non-negotiable)
- **Period:** 1996→today where data exists; factors that start later (real rates/breakevens 2003) enter when available; full sector set dense from ~2006 (note honestly, never floor display at 2006).
- **Benchmarks:** (a) S&P 500 (SPY), (b) equal-weight sectors. Report the tilted sector portfolio AND the full engine (equity% × tilts + defensive sleeve).
- **Costs/turnover:** weekly turnover reported; transaction-cost drag modeled at **5 bps per side** on traded notional; results shown gross AND net.
- **Per-sleeve discrimination (LESSONS 5.4):** AUC of each sleeve (and each macro factor) vs forward sector excess-return sign at 1/3/6/12m. **A sleeve/factor earns its weight only if AUC > 0.55** at its target horizon; flag and drop dead weight.
- **Correlation audit (LESSONS 5.3):** Pearson + Spearman across the four sleeves; flag pairs > 0.85 (double-counting).
- **Gates to pass:** net risk-adjusted return (Sharpe) > both benchmarks; max drawdown ≤ S&P; every sleeve adds discrimination; macro βᵢ sign-stable. **Report CAGR, Sharpe, max DD, turnover, cost drag vs both benchmarks. Then continue to Phase B** (do not halt for approval unless the model cannot clear benchmarks after honest iteration).

---

## 6 · Calibration outputs (filled by the harness, checked back in)
```
CALIBRATION (populated by scripts/asset_tilt_backtest.py):
  sector_macro_betas:   { sector: { factor: beta, ... }, ... }   # sign-stable only
  stress_signal:        MOVE_only | blend
  stress_cutpoints:     { risk_on_max, watch_max }               # percentile of stress signal
  rate_regime_bands:    { inflationary_pct: 70, deflationary_pct: 30 }
  sleeve_weights:       { macro: .45, momentum: .25, relstr: .20, valuation: .10 }
  tilt_clip:            { min: -0.04, max: +0.06 }
  validation:           { cagr, sharpe, maxdd, turnover, cost_drag, vs_spy, vs_ew }
  per_sleeve_auc:       { sleeve: {h1,h3,h6,h12}, ... }
```
