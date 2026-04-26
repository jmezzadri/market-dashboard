"""
narrative.rationale — per-bucket rationale paragraphs.

For each rated bucket, generate a one-paragraph rationale grounded in the
bucket's regression factors and current rating. Templates are bucket-specific
and rating-specific.

Output structure per bucket:
  rationale: "Banks is Most Favored. Yield curve has steepened (50 bps,
              rising over 3 months), supporting net interest margin..."
  key_factors: list of {factor, value, direction, interpretation} for UI display

Sentence pattern:
  "{Bucket} is {rating}. {top_factor_phrase}, {context_phrase}.
   {secondary_factor_phrase}."

The templates are intentionally minimal — quality over quantity. Edge cases
where a factor is at an extreme produce a qualifier ("at a multi-year low").
"""

from __future__ import annotations

from typing import Any

from .templates import (
    fmt_index, fmt_pp, fmt_pct, sentence_case,
    direction_phrase, magnitude_phrase, comparison_phrase,
    label_rl, label_growth, label_ir,
)


# ──────────────────────────────────────────────────────────────────────────
# Per-bucket rationale templates
# ──────────────────────────────────────────────────────────────────────────


# Each template returns a sentence given (rating, bucket, factor_readings).
# factor_readings is a dict mapping factor names to current values (numeric).

def _rationale_software(rating: str, factor_readings: dict) -> str:
    real_rates = factor_readings.get("real_rates")
    term_premium = factor_readings.get("term_premium")
    if rating in ("Most Favored", "Favored"):
        if real_rates is not None and real_rates < 1.5:
            return (
                "Real rates are contained, supporting long-duration cash flows. "
                "Software's discount-rate sensitivity is currently a tailwind rather "
                "than a headwind."
            )
        return ("Software is rating above median on the model's regression — composite "
                "indicators support the long-duration growth thesis.")
    if rating in ("Less Favored", "Least Favored"):
        if real_rates is not None and real_rates > 2.0:
            return ("Real rates above 2% are pressuring software valuations. "
                    "Long-duration cash flows lose relative attractiveness as the "
                    "discount rate rises.")
        return ("Software's expected-return signal has weakened — likely a "
                "rate-discount-rate dynamic or weakening enterprise capex.")
    return "Software is rating in the middle of the universe — neither leader nor laggard this period."


def _rationale_semiconductors(rating: str, factor_readings: dict) -> str:
    cu = factor_readings.get("capacity_util")
    cg = factor_readings.get("copper_gold")
    if rating in ("Most Favored", "Favored"):
        if cu is not None and cu > 78:
            return ("Capacity utilization is supportive — capital spending cycles "
                    "tend to extend when factories are running hot, benefiting "
                    "semiconductor equipment and cyclical chip demand.")
        return ("Semiconductors are positioned favorably — combined indicator and "
                "momentum signals point to broad cyclical strength.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Semiconductor demand signals are rolling over — manufacturing "
                "PMIs softening or copper-gold ratio compressing usually leads "
                "this group.")
    return "Semiconductors are rating in the middle — no strong directional signal."


def _rationale_biotech(rating: str, factor_readings: dict) -> str:
    real_rates = factor_readings.get("real_rates")
    if rating in ("Most Favored", "Favored"):
        if real_rates is not None and real_rates < 1.5:
            return ("Biotech is benefiting from contained real rates. The sector's "
                    "long-duration cash flows are highly rate-sensitive — falling "
                    "real rates support multiples.")
        return "Biotech is rating above median on the model's regression."
    if rating in ("Less Favored", "Least Favored"):
        return ("Biotech is under pressure from rising real rates. Pre-revenue "
                "clinical-stage names amplify the rate sensitivity.")
    return "Biotech is rating neutrally."


def _rationale_banks(rating: str, factor_readings: dict) -> str:
    yc = factor_readings.get("yield_curve")
    if rating in ("Most Favored", "Favored"):
        if yc is not None and yc > 50:
            return (f"Banks benefit from a steepening curve. With the 10y-3m at "
                    f"{int(yc)} basis points, net interest margin compression risk is "
                    f"low and loan-book growth supports earnings.")
        return ("Banks are rating above median — improving lending-standards "
                "indicators and contained credit risk are tailwinds.")
    if rating in ("Less Favored", "Least Favored"):
        if yc is not None and yc < 0:
            return ("The yield curve is inverted, signaling recession risk and "
                    "compressing bank net interest margins. Credit-tightening "
                    "indicators are also pointing the wrong way.")
        return "Banks face headwinds from tightening lending standards and weak loan growth."
    return "Banks are rating in the middle — mixed signals from the curve and credit conditions."


def _rationale_insurance(rating: str, factor_readings: dict) -> str:
    yc = factor_readings.get("yield_curve")
    if rating in ("Most Favored", "Favored"):
        if yc is not None and yc > 0:
            return ("Insurance carriers benefit from rising long-end yields, "
                    "which boost investment-book yields and improve P&C margins.")
        return ("Insurance is rating above median — equity vol and credit "
                "spreads supportive for P&C pricing.")
    if rating in ("Less Favored", "Least Favored"):
        return "Insurance is under pressure from low yields or credit spread widening."
    return "Insurance is rating neutrally."


def _rationale_med_devices(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Medical devices is favored — defensive characteristics combined "
                "with secular demographic tailwinds. Less rate-sensitive than biotech.")
    if rating in ("Less Favored", "Least Favored"):
        return "Medical devices is rating below median — likely real-rate pressure on long-duration cash flows."
    return "Medical devices is rating neutrally."


def _rationale_industrials(rating: str, factor_readings: dict) -> str:
    pmi = factor_readings.get("industrial_prod")
    cu = factor_readings.get("capacity_util")
    if rating in ("Most Favored", "Favored"):
        if pmi is not None or cu is not None:
            return ("Industrial production and capacity utilization point to "
                    "cyclical strength. Industrials' earnings cycle is leveraged "
                    "to manufacturing demand.")
        return "Industrials are rating above median on cyclical indicators."
    if rating in ("Less Favored", "Least Favored"):
        return ("Industrial demand signals are weakening — manufacturing is "
                "rolling over or VIX is elevated.")
    return "Industrials are rating neutrally."


def _rationale_energy(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Energy is favored — supportive macro (jobless claims contained, "
                "credit spreads compressing) plus underlying commodity strength.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Energy is under pressure — recession-risk indicators are firing "
                "or oil supply expectations are softening.")
    return "Energy is rating neutrally."


def _rationale_cons_disc(rating: str, factor_readings: dict) -> str:
    sentiment = factor_readings.get("umich_sentiment")
    if rating in ("Most Favored", "Favored"):
        if sentiment is not None and sentiment > 80:
            return ("Consumer discretionary is favored — consumer sentiment is "
                    "holding up, retail sales steady. Real wages supporting spending.")
        return "Consumer discretionary is rating above median."
    if rating in ("Less Favored", "Least Favored"):
        return ("Consumer discretionary is under pressure — sentiment falling, "
                "retail sales weakening, or mortgage rates pressuring housing-related demand.")
    return "Consumer discretionary is rating neutrally."


def _rationale_cons_staples(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Consumer staples is rating Most Favored — typically a defensive "
                "signal. Counter-cyclical demand stability is being valued by the "
                "model.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Consumer staples is rating below median — cyclicals are "
                "outperforming, signaling risk-on regime.")
    return "Consumer staples is rating neutrally."


def _rationale_utilities(rating: str, factor_readings: dict) -> str:
    yc = factor_readings.get("yield_curve")
    if rating in ("Most Favored", "Favored"):
        return ("Utilities is favored — bond-proxy characteristics are working. "
                "Long Treasury yields supportive, and the sector offers defensive "
                "cash flow.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Utilities is rating below median — likely rising long Treasury "
                "yields or term premium expansion.")
    return "Utilities is rating neutrally."


def _rationale_real_estate(rating: str, factor_readings: dict) -> str:
    mortgage = factor_readings.get("mortgage_30y")
    if rating in ("Most Favored", "Favored"):
        if mortgage is not None and mortgage < 6:
            return f"Real estate is favored — mortgage rates at {mortgage:.2f}% support property valuations."
        return "Real estate is rating above median."
    if rating in ("Less Favored", "Least Favored"):
        if mortgage is not None and mortgage > 7:
            return (f"Real estate is under pressure with mortgage rates at "
                    f"{mortgage:.2f}%. Rate-sensitive REITs face cap-rate "
                    f"expansion risk.")
        return "Real estate is rating below median — likely rising long-end yields or term-premium pressure."
    return "Real estate is rating neutrally."


def _rationale_comm_svcs(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Communication services is rating above median — telecom "
                "infrastructure resilient or media advertising recovering.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Communication services is under pressure — possibly tightening "
                "lending standards or weakening commercial credit indicators.")
    return "Communication services is rating neutrally."


def _rationale_materials(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Materials is favored — cyclical demand indicators (jobless "
                "claims, commodity proxies) supporting industrial inputs.")
    if rating in ("Less Favored", "Least Favored"):
        return "Materials is under pressure — vol elevated and cyclical signals weakening."
    return "Materials is rating neutrally."


def _rationale_megacap_growth(rating: str, factor_readings: dict) -> str:
    if rating in ("Most Favored", "Favored"):
        return ("Mega-cap growth (Apple, Microsoft, Nvidia, and the rest of the "
                "Magnificent 7) is rating Most Favored. The model is participating "
                "in the index-leading concentration trade — useful when "
                "cap-weighted benchmarks are being driven by a handful of names.")
    if rating in ("Less Favored", "Least Favored"):
        return ("Mega-cap growth is rating below median — possibly real-rate "
                "pressure on long-duration cash flows or breadth signals "
                "warning of concentration risk.")
    return "Mega-cap growth is rating neutrally."


_RATIONALE_FNS = {
    "Software": _rationale_software,
    "Semiconductors": _rationale_semiconductors,
    "Biotech": _rationale_biotech,
    "Banks": _rationale_banks,
    "Insurance": _rationale_insurance,
    "MedDevices": _rationale_med_devices,
    "Industrials": _rationale_industrials,
    "Transports": _rationale_industrials,  # similar drivers
    "AeroDefense": _rationale_industrials,  # similar drivers
    "Energy": _rationale_energy,
    "OilExploration": _rationale_energy,  # similar drivers
    "ConsDisc": _rationale_cons_disc,
    "Retail": _rationale_cons_disc,  # similar drivers
    "ConsStaples": _rationale_cons_staples,
    "Utilities": _rationale_utilities,
    "RealEstate": _rationale_real_estate,
    "CommSvcs": _rationale_comm_svcs,
    "Materials": _rationale_materials,
    "HealthCare": _rationale_med_devices,  # similar drivers
    "MegaCapGrowth": _rationale_megacap_growth,
}


def generate_rationale(bucket: dict, factor_readings: dict[str, float]) -> str:
    """Generate a rationale paragraph for a single bucket.

    Args:
        bucket: bucket dict with at least 'bucket' (or 'bucket_name') and
                'rating' fields
        factor_readings: dict of factor_name -> current value

    Returns: a single paragraph string. Always returns something — falls back
    to a generic rating sentence if no specific template exists."""
    name = bucket.get("bucket") or bucket.get("bucket_name") or ""
    rating = bucket.get("rating", "Neutral")

    fn = _RATIONALE_FNS.get(name)
    if fn is None:
        return f"{name or 'This group'} is rating {rating}."

    body = fn(rating, factor_readings or {})
    # Lead with the bucket + rating, then the body
    display = bucket.get("display_name", name)
    headline = f"{display} is {rating}."
    return sentence_case(f"{headline} {body}")


def generate_key_factors(bucket: dict, factor_readings: dict[str, float],
                         max_factors: int = 3) -> list[dict]:
    """Build the structured key_factors list for a bucket — used by the UI's
    drill-down view.

    Returns up to max_factors entries:
        [{factor: 'jobless', value: 213000, direction: 'falling',
          interpretation: 'labor market resilience'}, ...]
    """
    kill_factors = bucket.get("kill_factors", [])
    out = []
    for factor in kill_factors[:max_factors]:
        value = factor_readings.get(factor)
        if value is None:
            continue
        out.append({
            "factor": factor,
            "value": value,
            "direction": "current",  # Phase 4.5: compute MoM direction from history
            "interpretation": _factor_interpretation(factor, value),
        })
    return out


def _factor_interpretation(factor: str, value: float) -> str:
    """Plain-English interpretation of a factor's current value."""
    interpretations = {
        "jobless": (
            "labor market resilience" if value < 250 else
            "labor market loosening" if value < 350 else
            "labor market stress"
        ),
        "vix": (
            "low equity vol" if value < 18 else
            "normal vol" if value < 25 else
            "elevated vol regime"
        ),
        "real_rates": (
            "supportive for long-duration" if value < 1.5 else
            "neutral discount rate" if value < 2.5 else
            "headwind for long-duration"
        ),
        "yield_curve": (
            "inverted — recession risk" if value < 0 else
            "flat — late cycle" if value < 50 else
            "steep — supportive for banks"
        ),
        "mortgage_30y": (
            "supportive for housing" if value < 6 else
            "neutral mortgage rate" if value < 7.5 else
            "headwind for housing"
        ),
    }
    return interpretations.get(factor, f"{factor} = {value:.2f}")
