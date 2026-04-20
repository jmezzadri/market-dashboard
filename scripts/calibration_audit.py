#!/usr/bin/env python3
"""
Bug #2b — Empirical SD calibration audit for the 25 MacroTilt indicators.

Pulls 10-year trailing history from FRED (2016-04 → 2026-04) for every
indicator that has a public FRED series, computes mean + sample SD, and
prints a side-by-side old-vs-new table plus a diff-flag for items whose
current calibration is more than 20% off on either param.

Indicators without FRED coverage are listed at the end — those need
alternate sourcing (CBOE direct, FDIC QBP, NY Fed, Shiller, Yahoo).
"""
from __future__ import annotations

import io
import sys
import csv
import urllib.request
import urllib.parse
import math
import datetime as dt
from dataclasses import dataclass

# Current SD config (mirrors App.jsx / macro_compute.py — April 2026).
CURRENT_SD = {
    "vix":          (19.5, 8.2, "hw"),
    "hy_ig":        (220,  95,  "hw"),
    "eq_cr_corr":   (0.38, 0.22,"hw"),
    "yield_curve":  (80,   95,  "nw"),
    "move":         (72,   28,  "hw"),
    "anfci":        (0,    0.38,"hw"),
    "stlfsi":       (0,    0.9, "hw"),
    "real_rates":   (0.5,  1.1, "hw"),
    "sloos_ci":     (5,    18,  "hw"),
    "cape":         (22,   7,   "hw"),
    "ism":          (52,   5.5, "lw"),
    "copper_gold":  (0.20, 0.03,"lw"),
    "bkx_spx":      (0.13, 0.03,"lw"),
    "bank_unreal":  (5,    8,   "hw"),
    "credit_3y":    (7,    5,   "hw"),
    "term_premium": (40,   70,  "hw"),
    "cmdi":         (0.1,  0.35,"hw"),
    "loan_syn":     (6.2,  2.5, "hw"),
    "usd":          (99,   7,   "hw"),
    "cpff":         (10,   28,  "hw"),
    "skew":         (128,  12,  "hw"),
    "sloos_cre":    (5,    20,  "hw"),
    "bank_credit":  (6.5,  3.2, "lw"),
    "jobless":      (340,  185, "hw"),
    "jolts_quits":  (2.1,  0.42,"lw"),
}

# FRED series mapping + any transforms needed to match the dashboard's unit.
# For indicators assembled from multiple FRED series, the fetch function takes a list.
FRED_MAP = {
    "vix":          {"series": ["VIXCLS"],                      "transform": "identity"},
    "hy_ig":        {"series": ["BAMLH0A0HYM2", "BAMLC0A0CM"],  "transform": "hy_ig_bps"},
    "yield_curve":  {"series": ["T10Y2Y"],                      "transform": "pct_to_bps"},
    "anfci":        {"series": ["ANFCI"],                       "transform": "identity"},
    "stlfsi":       {"series": ["STLFSI4"],                     "transform": "identity"},
    "real_rates":   {"series": ["DFII10"],                      "transform": "identity"},
    "sloos_ci":     {"series": ["DRTSCILM"],                    "transform": "identity"},
    "sloos_cre":    {"series": ["DRTSCLCC"],                    "transform": "identity"},
    "term_premium": {"series": ["THREEFYTP10"],                 "transform": "pct_to_bps"},
    "loan_syn":     {"series": ["BAMLH0A0HYM2EY"],              "transform": "identity"},
    "usd":          {"series": ["DTWEXBGS"],                    "transform": "identity"},
    "bank_credit":  {"series": ["TOTBKCR"],                     "transform": "yoy_pct"},
    "credit_3y":    {"series": ["TOTBKCR"],                     "transform": "cagr_3y"},
    "jobless":      {"series": ["IC4WSA"],                      "transform": "thousands"},
    "jolts_quits":  {"series": ["JTSQUR"],                      "transform": "identity"},
}

# Indicators NOT covered by this FRED pull — documented reasons below.
UNCOVERED = {
    "eq_cr_corr":  "Just empirically re-calibrated in Bug #2 (SPY/HYG daily returns, 63d rolling) — leave as-is.",
    "move":        "ICE BofA MOVE index — no free FRED mirror; bloomberg/paid feed.",
    "cape":        "Shiller CAPE — Yale downloadable XLS, not on FRED.",
    "ism":         "ISM Manufacturing PMI — discontinued from FRED in 2016; need ISM direct.",
    "copper_gold": "Ratio computed locally from copper + gold futures (Yahoo).",
    "bkx_spx":     "Ratio computed locally from KBE and SPY (Yahoo).",
    "bank_unreal": "FDIC Quarterly Banking Profile — short history (2022+), regime-specific.",
    "cmdi":        "NY Fed CMDI — public API different from FRED, skip for this pass.",
    "cpff":        "CP-FF spread — requires both CP rates and FEDFUNDS; CPFLN etc series discontinued 2022.",
    "skew":        "CBOE SKEW index — CBOE direct download, not FRED.",
}

TEN_YR_COSD = "2016-04-01"
TEN_YR_COED = "2026-04-15"


def fetch_fred_csv(series_id: str, cosd: str, coed: str) -> list[tuple[dt.date, float]]:
    """Returns [(date, value), …] with NaN/empty rows dropped. Reads cached CSVs from /tmp/fred/."""
    import os
    path = f"/tmp/fred/{series_id}.csv"
    if not os.path.exists(path):
        raise FileNotFoundError(f"cached CSV missing: {path} — pre-fetch with curl first")
    with open(path, "r") as f:
        raw = f.read()
    reader = csv.reader(io.StringIO(raw))
    rows = list(reader)
    header = rows[0]
    out: list[tuple[dt.date, float]] = []
    for r in rows[1:]:
        if len(r) < 2:
            continue
        d_str, v_str = r[0], r[1]
        if v_str in ("", ".", "NA"):
            continue
        try:
            d = dt.date.fromisoformat(d_str)
            v = float(v_str)
        except ValueError:
            continue
        out.append((d, v))
    return out


def mean_sd(xs: list[float]) -> tuple[float, float]:
    n = len(xs)
    if n < 2:
        return (float("nan"), float("nan"))
    m = sum(xs) / n
    var = sum((x - m) ** 2 for x in xs) / (n - 1)
    return (m, math.sqrt(var))


def transform(series_data: dict[str, list[tuple[dt.date, float]]], kind: str) -> list[float]:
    if kind == "identity":
        sid = next(iter(series_data))
        return [v for _, v in series_data[sid]]
    if kind == "pct_to_bps":
        sid = next(iter(series_data))
        return [v * 100 for _, v in series_data[sid]]
    if kind == "thousands":
        sid = next(iter(series_data))
        return [v / 1000.0 for _, v in series_data[sid]]
    if kind == "hy_ig_bps":
        # HY OAS in %, IG OAS in %. Dashboard value is (HY - IG) in bps.
        hy = dict(series_data["BAMLH0A0HYM2"])
        ig = dict(series_data["BAMLC0A0CM"])
        common = sorted(set(hy.keys()) & set(ig.keys()))
        return [(hy[d] - ig[d]) * 100 for d in common]
    if kind == "yoy_pct":
        sid = next(iter(series_data))
        pts = series_data[sid]  # weekly
        # YoY % growth: value_t / value_{t-52} - 1, then *100.
        by_date = dict(pts)
        out = []
        for d, v in pts:
            past = dt.date(d.year - 1, d.month, d.day) if (d.month, d.day) != (2, 29) else dt.date(d.year - 1, 2, 28)
            # Find the closest weekly observation to `past` within ±7 days.
            cand = min((abs((k - past).days), k) for k in by_date.keys())
            if cand[0] <= 10:
                prior = by_date[cand[1]]
                if prior > 0:
                    out.append((v / prior - 1) * 100)
        return out
    if kind == "cagr_3y":
        sid = next(iter(series_data))
        pts = series_data[sid]
        by_date = dict(pts)
        out = []
        for d, v in pts:
            past = dt.date(d.year - 3, d.month, d.day) if (d.month, d.day) != (2, 29) else dt.date(d.year - 3, 2, 28)
            cand = min((abs((k - past).days), k) for k in by_date.keys())
            if cand[0] <= 15:
                prior = by_date[cand[1]]
                if prior > 0:
                    out.append(((v / prior) ** (1 / 3) - 1) * 100)
        return out
    raise ValueError(f"Unknown transform {kind}")


def format_row(name: str, old: tuple, new_mean: float, new_sd: float, n: int) -> str:
    old_m, old_s, direction = old
    # Flag if new diverges from old by more than 20% on either param.
    def pct_delta(a: float, b: float) -> float:
        if abs(b) < 1e-9:
            return float("inf") if abs(a - b) > 1e-9 else 0.0
        return (a - b) / abs(b) * 100
    dm = pct_delta(new_mean, old_m)
    ds = pct_delta(new_sd, old_s)
    flag = "**" if (abs(dm) > 20 or abs(ds) > 20) else "  "
    return (
        f"{flag} {name:<14} old(μ={old_m:>8.2f}, σ={old_s:>7.2f})  "
        f"new(μ={new_mean:>8.2f}, σ={new_sd:>7.2f})  "
        f"Δμ={dm:+6.1f}%  Δσ={ds:+6.1f}%  n={n}"
    )


def main() -> int:
    print(f"MacroTilt SD calibration audit — window {TEN_YR_COSD} → {TEN_YR_COED}\n")
    covered = []
    for name, cfg in FRED_MAP.items():
        try:
            series_data = {
                sid: fetch_fred_csv(sid, TEN_YR_COSD, TEN_YR_COED)
                for sid in cfg["series"]
            }
            values = transform(series_data, cfg["transform"])
            if not values:
                print(f"   {name:<14} — EMPTY after transform ({cfg['series']})")
                continue
            m, s = mean_sd(values)
            covered.append((name, m, s, len(values)))
            print(format_row(name, CURRENT_SD[name], m, s, len(values)))
        except Exception as e:
            print(f"   {name:<14} — FETCH FAIL ({cfg['series']}): {e}")

    print("\nIndicators without FRED coverage (need separate sourcing):")
    for name, why in UNCOVERED.items():
        old_m, old_s, _ = CURRENT_SD[name]
        print(f"   {name:<14} old(μ={old_m:>8.2f}, σ={old_s:>7.2f})  {why}")

    # Dump a python-ready suggested SD block for covered items.
    print("\n--- Suggested SD{} patch (FRED-covered only) ---")
    for name, m, s, n in covered:
        direction = CURRENT_SD[name][2]
        # Round to something sensible based on magnitude.
        digits_m = 2 if abs(m) < 5 else (1 if abs(m) < 50 else 0)
        digits_s = 2 if abs(s) < 5 else (1 if abs(s) < 50 else 0)
        fm = f"{m:.{digits_m}f}"
        fs = f"{s:.{digits_s}f}"
        print(f'    "{name}": {{"mean": {fm}, "sd": {fs}, "dir": "{direction}"}},')
    return 0


if __name__ == "__main__":
    sys.exit(main())
