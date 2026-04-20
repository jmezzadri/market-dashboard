"""
Stress math mirrored from src/App.jsx (SD, WEIGHTS, compScore, sdTo100, conviction).
If you change WEIGHTS or SD in App.jsx, update this file to match.
"""
from __future__ import annotations

# SD calibration — see docs/CALIBRATION_METHODOLOGY.md for empirical
# re-grounding (Bug #2 / Bug #2b, FRED 2016-04 → 2026-04 window).
SD = {
    "vix": {"mean": 18.5, "sd": 7.3, "dir": "hw"},
    "hy_ig": {"mean": 220, "sd": 95, "dir": "hw"},
    "eq_cr_corr": {"mean": 0.75, "sd": 0.09, "dir": "hw"},  # Bug #2 recal: SPY/HYG 63d returns corr. Empirical 2015-2026 daily: mean 0.747, sd 0.087.
    "yield_curve": {"mean": 80, "sd": 95, "dir": "nw"},
    "move": {"mean": 72, "sd": 28, "dir": "hw"},
    "anfci": {"mean": 0, "sd": 0.38, "dir": "hw"},
    "stlfsi": {"mean": 0, "sd": 0.9, "dir": "hw"},
    "real_rates": {"mean": 0.7, "sd": 1.0, "dir": "hw"},
    "sloos_ci": {"mean": 9, "sd": 22, "dir": "hw"},
    "cape": {"mean": 22, "sd": 7, "dir": "hw"},
    "ism": {"mean": 52, "sd": 5.5, "dir": "lw"},
    "copper_gold": {"mean": 0.20, "sd": 0.03, "dir": "lw"},
    "bkx_spx": {"mean": 0.13, "sd": 0.03, "dir": "lw"},
    "bank_unreal": {"mean": 5, "sd": 8, "dir": "hw"},
    "credit_3y": {"mean": 7, "sd": 5, "dir": "hw"},
    "term_premium": {"mean": 40, "sd": 70, "dir": "hw"},
    "cmdi": {"mean": 0.1, "sd": 0.35, "dir": "hw"},
    "loan_syn": {"mean": 6.2, "sd": 2.5, "dir": "hw"},
    "usd": {"mean": 99, "sd": 7, "dir": "hw"},
    "cpff": {"mean": 10, "sd": 28, "dir": "hw"},
    "skew": {"mean": 128, "sd": 12, "dir": "hw"},
    "sloos_cre": {"mean": 5, "sd": 20, "dir": "hw"},
    "bank_credit": {"mean": 6.5, "sd": 3.2, "dir": "lw"},
    "jobless": {"mean": 340, "sd": 185, "dir": "hw"},
    "jolts_quits": {"mean": 2.1, "sd": 0.42, "dir": "lw"},
}

WEIGHTS = {
    "vix": 1.5,
    "hy_ig": 1.5,
    "eq_cr_corr": 1.5,
    "yield_curve": 1.5,
    "move": 1.2,
    "anfci": 1.2,
    "stlfsi": 1.2,
    "real_rates": 1.2,
    "sloos_ci": 1.2,
    "cape": 1.2,
    "ism": 1.2,
    "copper_gold": 1.2,
    "bkx_spx": 1.2,
    "bank_unreal": 1.2,
    "credit_3y": 1.2,
    "term_premium": 1.0,
    "cmdi": 1.0,
    "loan_syn": 1.0,
    "usd": 1.0,
    "cpff": 1.0,
    "skew": 1.0,
    "sloos_cre": 1.0,
    "bank_credit": 1.0,
    "jobless": 1.0,
    "jolts_quits": 1.0,
}

# id -> (display name, unit, decimals) — keep in sync with IND in App.jsx
IND_META = {
    "vix": ("VIX", "index", 1),
    "hy_ig": ("HY–IG Spread", "bps", 0),
    "eq_cr_corr": ("EQ–Credit Corr", "corr", 2),
    "yield_curve": ("10Y–2Y Slope", "bps", 0),
    "move": ("MOVE Index", "index", 0),
    "anfci": ("ANFCI", "z-score", 2),
    "stlfsi": ("STLFSI", "index", 2),
    "real_rates": ("10Y TIPS", "%", 2),
    "sloos_ci": ("SLOOS C&I", "%", 1),
    "cape": ("Shiller CAPE", "ratio", 1),
    "ism": ("ISM Mfg. PMI", "index", 1),
    "copper_gold": ("Copper/Gold Ratio", "ratio", 3),
    "bkx_spx": ("BKX/SPX Ratio", "ratio", 3),
    "bank_unreal": ("Bank Unreal. Loss", "% T1", 1),
    "credit_3y": ("3Y Credit Growth", "% 3yr", 1),
    "term_premium": ("Kim–Wright 10Y", "bps", 0),
    "cmdi": ("CMDI", "index", 2),
    "loan_syn": ("HY Eff. Yield", "%", 2),
    "usd": ("USD Index", "index", 1),
    "cpff": ("USD Funding", "bps", 0),
    "skew": ("SKEW Index", "index", 0),
    "sloos_cre": ("SLOOS CRE", "%", 1),
    "bank_credit": ("Bank Credit", "% YoY", 1),
    "jobless": ("Init. Claims", "K", 0),
    "jolts_quits": ("JOLTS Quits", "%", 1),
}


def sd_score(ind_id: str, v: float | None) -> float | None:
    p = SD.get(ind_id)
    if not p or v is None:
        return None
    r = (v - p["mean"]) / p["sd"]
    if p["dir"] in ("lw", "nw"):
        return -r
    return r


def sd_to_100(s: float) -> int:
    return round(max(0, min(100, ((s + 1) / 4) * 100)))


def sd_label(s: float | None) -> str:
    if s is None:
        return "No Data"
    if s < 0.5:
        return "Low"
    if s < 1.0:
        return "Normal"
    if s < 1.75:
        return "Elevated"
    return "Extreme"


def comp_score(snap: dict[str, float | None]) -> float:
    ws, wt = 0.0, 0.0
    for ind_id, w in WEIGHTS.items():
        s = sd_score(ind_id, snap.get(ind_id))
        if s is None:
            continue
        ws += s * w
        wt += w
    return ws / wt if wt > 0 else 0.0


def get_conv_label(s: float) -> str:
    if s < 0.25:
        return "LOW"
    if s < 0.88:
        return "NORMAL"
    if s < 1.6:
        return "ELEVATED"
    return "EXTREME"


def trend_signal_velocity(vel: float) -> tuple[str, str, str]:
    if vel > 0.12:
        return ("▲▲", "Rising Fast", "#ef4444")
    if vel > 0.05:
        return ("▲", "Rising", "#f97316")
    if vel > 0.02:
        return ("↗", "Edging Up", "#eab308")
    if vel < -0.12:
        return ("▼▼", "Easing Fast", "#22c55e")
    if vel < -0.05:
        return ("▼", "Easing", "#22c55e")
    if vel < -0.02:
        return ("↘", "Edging Down", "#86efac")
    return ("→", "Stable", "#c0c0c0")


def fmt_v(ind_id: str, v: float | None) -> str:
    if v is None:
        return "—"
    label, unit, dec = IND_META.get(ind_id, (ind_id, "", 2))
    if unit == "K":
        return f"{round(v)}K"
    if unit == "bps":
        return f"{round(v)}bps"
    if unit == "z-score":
        sign = "+" if v > 0 else ""
        return f"{sign}{float(v):.{dec}f}"
    if unit in ("% T1", "% 3yr", "% YoY", "%"):
        return f"{float(v):.{dec}f}%"
    return f"{float(v):.{dec}f}"
