"""
narrative.risks — risk scenario generator.

For each Most Favored bucket, generate a "kill factor" risk scenario:
"If {factor} {direction} {threshold}, {bucket} is most exposed because {reason}."

Kill factors come from industry_groups.json. Thresholds and directions are
hard-coded per factor (the move that historically triggers the kill).
"""

from __future__ import annotations


# Per-factor kill conditions — what move would damage the buckets that
# depend on this factor as a kill_factor.
# Format: {factor_name: (direction_phrase, threshold_label, mechanism)}
KILL_CONDITIONS = {
    "wti_crude": (
        "spikes above $120 per barrel",
        "or breaks below $55 per barrel",
        "fuel-cost inflation hits transports and consumer discretionary; "
        "low oil prices cap energy-stock margins",
    ),
    "natgas_henry": (
        "spikes meaningfully above $7 per MMBtu",
        None,
        "utility cost pressure plus energy-bucket dispersion",
    ),
    "yield_curve": (
        "inverts deeply (10y minus 3m below -50 basis points)",
        None,
        "banks lose net interest margin and recession signal becomes "
        "loud enough to hit cyclicals",
    ),
    "real_rates": (
        "rises above 2.5% real",
        None,
        "long-duration cash flows (software, biotech) get repriced; "
        "growth names lose relative valuation support",
    ),
    "term_premium": (
        "expands above 1.5%",
        None,
        "rate-sensitive sectors (utilities, REITs, biotech) face headwinds "
        "as discount rates rise across the curve",
    ),
    "breakeven_10y": (
        "rises above 3.5%",
        None,
        "inflation expectations becoming unanchored hits long-duration "
        "growth and forces Fed action",
    ),
    "industrial_prod": (
        "contracts year-over-year",
        None,
        "industrials, materials, and semiconductor capital spending all roll over",
    ),
    "capacity_util": (
        "drops below 75%",
        None,
        "weakening capacity utilization signals industrial slowdown — "
        "cyclicals at risk",
    ),
    "copper_gold": (
        "drops sharply (cyclical demand collapse)",
        None,
        "cyclical industries lose the underlying demand signal",
    ),
    "umich_sentiment": (
        "drops below 70",
        None,
        "consumer confidence collapse hits retail, consumer discretionary, "
        "restaurants",
    ),
    "retail_sales": (
        "contracts month-over-month for two consecutive prints",
        None,
        "retail and consumer discretionary lose the underlying demand signal",
    ),
    "real_pce": (
        "contracts year-over-year",
        None,
        "consumer-spending-driven sectors (retail, cons disc) face direct hit",
    ),
    "mortgage_30y": (
        "rises above 8%",
        None,
        "real estate, home builders, and mortgage-sensitive consumer "
        "discretionary are most exposed",
    ),
    "sloos_ci": (
        "tightens sharply (banks reporting tighter standards across loan types)",
        None,
        "small caps and credit-sensitive industries lose financing access",
    ),
    "sloos_cre": (
        "tightens sharply",
        None,
        "real estate and energy E&P are most exposed to commercial credit "
        "tightening",
    ),
    "credit_3y": (
        "widens above 200 basis points",
        None,
        "credit-sensitive financials and rate-sensitive sectors face stress",
    ),
    "anfci": (
        "rises above +1.5",
        None,
        "broad financial conditions tightening hits leveraged and "
        "credit-sensitive sectors most",
    ),
    "stlfsi": (
        "rises above +2",
        None,
        "St. Louis stress index above 2 historically precedes "
        "cross-asset drawdowns",
    ),
    "vix": (
        "spikes above 30 and stays there for a week",
        None,
        "sustained vol regime change typically triggers defensive rotation",
    ),
    "skew": (
        "rises above 150",
        None,
        "tail-risk demand spike — markets pricing higher probability of "
        "fat-tail outcomes",
    ),
    "loan_syn": (
        "contracts (syndicated loan activity rolling over)",
        None,
        "aerospace, defense, and other capex-cycle names lose the underlying "
        "credit signal",
    ),
    "fed_bs": (
        "contracts at an accelerating pace",
        None,
        "QT regime intensifying — risk assets broadly under pressure",
    ),
    "cpff": (
        "spikes (commercial paper risk premium widening)",
        None,
        "short-term funding stress hits credit-sensitive financials and "
        "REITs first",
    ),
    "m2_yoy": (
        "turns negative year-over-year",
        None,
        "money supply contraction is a slow-burning headwind for risk assets",
    ),
    "jobless": (
        "rises above 280k for several weeks",
        None,
        "labor market loosening signals consumer-discretionary demand stalling "
        "and recession risk rising",
    ),
}


def risk_scenario_for_bucket(bucket: dict) -> dict | None:
    """Generate a single risk scenario for a Most Favored bucket. Picks the
    most relevant kill_factor from the bucket's reference data."""
    kill_factors = bucket.get("kill_factors", [])
    if not kill_factors:
        return None

    # Use the FIRST kill factor as the primary trigger. Industry groups
    # in industry_groups.json list kill_factors in priority order.
    primary = kill_factors[0]
    cond = KILL_CONDITIONS.get(primary)
    if cond is None:
        return None

    trigger_phrase, alt_phrase, mechanism = cond

    bucket_name = bucket.get("display_name", bucket.get("bucket", "this group"))
    triggers = [trigger_phrase]
    if alt_phrase:
        triggers.append(alt_phrase)
    full_trigger = "; ".join(triggers)

    return {
        "trigger": f"{primary.replace('_', ' ').title()} {full_trigger}",
        "impacted_buckets": [bucket_name],
        "narrative": (
            f"If {primary.replace('_', ' ')} {full_trigger}, "
            f"{bucket_name} is most exposed because {mechanism}."
        ),
    }


def aggregate_scenarios_by_kill_factor(buckets: list[dict]) -> list[dict]:
    """Group Most Favored buckets that share a primary kill factor — one
    scenario per kill factor, not per bucket. Reduces duplication for the UI."""
    by_factor = {}
    for bucket in buckets:
        kill_factors = bucket.get("kill_factors", [])
        if not kill_factors:
            continue
        primary = kill_factors[0]
        bucket_name = bucket.get("display_name", bucket.get("bucket", ""))
        by_factor.setdefault(primary, []).append(bucket_name)

    scenarios = []
    for factor, bucket_names in by_factor.items():
        cond = KILL_CONDITIONS.get(factor)
        if cond is None:
            continue
        trigger_phrase, alt_phrase, mechanism = cond
        triggers = [trigger_phrase]
        if alt_phrase:
            triggers.append(alt_phrase)
        full_trigger = "; ".join(triggers)
        names_phrase = " and ".join(bucket_names) if len(bucket_names) <= 2 \
            else ", ".join(bucket_names[:-1]) + ", and " + bucket_names[-1]
        scenarios.append({
            "trigger": f"{factor.replace('_', ' ').title()} {full_trigger}",
            "impacted_buckets": bucket_names,
            "narrative": (
                f"If {factor.replace('_', ' ')} {full_trigger}, "
                f"{names_phrase} {'is' if len(bucket_names) == 1 else 'are'} "
                f"most exposed because {mechanism}."
            ),
        })
    return scenarios


def generate_risk_scenarios(ratings_by_tier: dict[str, list[dict]],
                             max_scenarios: int = 5) -> list[dict]:
    """Generate up to N risk scenarios for the Most Favored buckets,
    aggregated by kill factor to avoid duplication."""
    most_favored = ratings_by_tier.get("most_favored", [])
    if not most_favored:
        return []
    scenarios = aggregate_scenarios_by_kill_factor(most_favored)
    return scenarios[:max_scenarios]
