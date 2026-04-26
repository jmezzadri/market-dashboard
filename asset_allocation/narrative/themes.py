"""
narrative.themes — cross-bucket theme detection.

Rules-based pattern matching across the 16 bucket ratings. When 2+ buckets
in a thematic cluster are Most Favored, emit the theme.

Each theme has a name, a narrative paragraph, and the list of buckets that
triggered it. The UI shows themes as chips at the top of the page.

Senior Quant signs off on the theme rules. Adding/changing rules requires:
1. Backtest the rule on 12 historical regimes
2. Confirm it doesn't fire spuriously in normal markets
3. Test fixture for known-good firing pattern
"""

from __future__ import annotations

from typing import Any

THEME_RULES = [
    {
        "name": "AI infrastructure",
        "trigger_buckets": ["Software", "Semiconductors", "MegaCapGrowth"],
        "min_most_favored": 2,
        "narrative": (
            "The model is leaning into the AI infrastructure theme: software, "
            "semiconductors, and mega-cap growth names are receiving above-median "
            "ratings simultaneously. Historically this clustering signals broad-based "
            "tech leadership rather than narrow factor concentration."
        ),
    },
    {
        "name": "Cyclical recovery",
        "trigger_buckets": ["Industrials", "Materials", "Energy", "Transports", "AeroDefense"],
        "min_most_favored": 3,
        "narrative": (
            "The model is positioned for a cyclical recovery: multiple cyclical "
            "industry groups (industrials, materials, energy) rate Most Favored "
            "simultaneously. Late-cycle inflection points typically show this pattern, "
            "as does early-cycle reflation."
        ),
    },
    {
        "name": "Defensive positioning",
        "trigger_buckets": ["Utilities", "ConsStaples", "RealEstate", "MedDevices"],
        "min_most_favored": 2,
        "narrative": (
            "Defensive groups (utilities, staples, real estate) are rating above "
            "median — typically a late-cycle warning sign. The model is preparing "
            "for a regime shift even if the formal defensive bucket has not yet "
            "activated."
        ),
    },
    {
        "name": "Steepener trade",
        "trigger_buckets": ["Banks", "Insurance", "Financials"],
        "min_most_favored": 2,
        "narrative": (
            "Financials are rating Most Favored — banks and insurance both benefit "
            "from a steeper yield curve and rising real rates. The model is tilted "
            "toward the rate-sensitive winners."
        ),
    },
    {
        "name": "Energy discipline",
        "trigger_buckets": ["Energy", "OilExploration"],
        "min_most_favored": 2,
        "narrative": (
            "Energy and oil exploration both rate Most Favored — supportive macro "
            "(jobless claims contained, credit spreads compressing) plus underlying "
            "commodity strength is driving the sector."
        ),
    },
    {
        "name": "Health and demographics",
        "trigger_buckets": ["Biotech", "MedDevices", "HealthCare"],
        "min_most_favored": 2,
        "narrative": (
            "Health care groups (biotech, medical devices) rate Most Favored. The "
            "model is positioning for the long-term aging-demographics tailwind plus "
            "near-term rate support for long-duration biotech cash flows."
        ),
    },
    {
        "name": "Consumer resilience",
        "trigger_buckets": ["ConsDisc", "Retail"],
        "min_most_favored": 1,
        "narrative": (
            "Consumer discretionary and retail are rating above median, suggesting "
            "the model sees consumer spending power holding up — typically tied to "
            "real wage growth and contained jobless claims."
        ),
    },
    {
        "name": "Mega-cap concentration",
        "trigger_buckets": ["MegaCapGrowth"],
        "min_most_favored": 1,
        "narrative": (
            "Mega-cap growth (Apple, Microsoft, Nvidia, and the rest of the "
            "Magnificent 7) is rating Most Favored. The model is participating in "
            "the index-leading concentration trade."
        ),
    },
]


def detect_themes(ratings_by_tier: dict[str, list[dict]]) -> list[dict]:
    """Apply theme rules to a tier-organized ratings dict.

    Returns list of theme dicts: [{name, narrative, buckets}]"""
    most_favored = {entry["bucket"] for entry in ratings_by_tier.get("most_favored", [])}
    favored = {entry["bucket"] for entry in ratings_by_tier.get("favored", [])}
    above_median = most_favored | favored

    detected = []
    for rule in THEME_RULES:
        triggers = set(rule["trigger_buckets"])
        active_buckets = triggers & most_favored
        if len(active_buckets) >= rule["min_most_favored"]:
            detected.append({
                "name": rule["name"],
                "narrative": rule["narrative"],
                "buckets": sorted(active_buckets),
            })
    return detected


def top_theme_names(themes: list[dict], limit: int = 3) -> list[str]:
    """Return just the names of the top N themes — used in the headline chip."""
    return [t["name"] for t in themes[:limit]]
