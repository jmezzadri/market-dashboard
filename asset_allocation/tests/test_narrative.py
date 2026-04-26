"""Unit tests for asset_allocation/narrative/ — templating engine.

Covers:
  templates.py — composite labels, direction/magnitude phrases, comparison,
                 trend phrases, number formatting, sentence assembly
  rationale.py — per-bucket rationale generators
  themes.py    — cross-bucket theme detection rules
  risks.py     — kill-factor risk scenario generation
  headline.py  — one-line headline + macro narrative paragraphs
  engine.py    — orchestrator end-to-end
"""

import math
import pytest

from asset_allocation.narrative.templates import (
    label_rl, label_growth, label_ir,
    direction_phrase, magnitude_phrase, comparison_phrase,
    trend_phrase, fmt_pct, fmt_pp, fmt_bp, fmt_index,
    join_sentence, sentence_case, truncate,
)
from asset_allocation.narrative.headline import (
    headline_one_liner, composite_snapshot_paragraph,
    implications_paragraph, macro_narrative, _month_label,
)
from asset_allocation.narrative.rationale import (
    generate_rationale, generate_key_factors,
)
from asset_allocation.narrative.themes import (
    detect_themes, top_theme_names, THEME_RULES,
)
from asset_allocation.narrative.risks import (
    generate_risk_scenarios, risk_scenario_for_bucket,
    aggregate_scenarios_by_kill_factor, KILL_CONDITIONS,
)
from asset_allocation.narrative.engine import (
    latest_factor_readings, fill_narrative,
)


# ──────────────────────────────────────────────────────────────────────────
# templates.py
# ──────────────────────────────────────────────────────────────────────────


def test_label_rl_calm():
    assert label_rl(-20) == "calm"
    assert label_rl(-10) == "calm"
    assert label_rl(-1) == "calm"


def test_label_rl_neutral():
    assert label_rl(0) == "neutral"
    assert label_rl(10) == "neutral"
    assert label_rl(20) == "neutral"


def test_label_rl_elevated():
    assert label_rl(25) == "elevated"
    assert label_rl(30) == "elevated"


def test_label_rl_stressed():
    assert label_rl(40) == "stressed"
    assert label_rl(50) == "stressed"


def test_label_rl_extreme():
    assert label_rl(75) == "extreme"


def test_label_growth_supportive_for_negative():
    assert label_growth(-15) == "supportive"


def test_label_growth_neutral_for_zero():
    assert label_growth(0) == "neutral"
    assert label_growth(10) == "neutral"


def test_label_growth_weakening_for_high():
    assert label_growth(40) == "weakening"


def test_label_ir_cool_for_negative():
    assert label_ir(-15) == "cool"


def test_label_ir_neutral():
    assert label_ir(0) == "neutral"
    assert label_ir(10) == "neutral"


def test_label_ir_hot_for_high():
    assert label_ir(30) == "hot"


def test_direction_phrase_rising():
    assert direction_phrase(5) == "rising"


def test_direction_phrase_falling():
    assert direction_phrase(-5) == "falling"


def test_direction_phrase_flat_at_zero():
    assert direction_phrase(0) == "flat"


def test_direction_phrase_threshold():
    """Below threshold = flat regardless of sign."""
    assert direction_phrase(0.3, magnitude_threshold=0.5) == "flat"


def test_direction_phrase_nan():
    assert direction_phrase(float("nan")) == "flat"


def test_magnitude_phrase_modest():
    assert magnitude_phrase(0.3) == "modestly"


def test_magnitude_phrase_meaningful():
    assert magnitude_phrase(1.0) == "meaningfully"


def test_magnitude_phrase_sharp():
    assert magnitude_phrase(2.0) == "sharply"


def test_magnitude_phrase_extreme():
    assert magnitude_phrase(3.0) == "extremely"


def test_comparison_phrase_above():
    assert comparison_phrase(110, 100) == "above"


def test_comparison_phrase_below():
    assert comparison_phrase(90, 100) == "below"


def test_comparison_phrase_in_line():
    """Within 5% tolerance of baseline."""
    assert comparison_phrase(102, 100) == "in line with"


def test_comparison_phrase_zero_baseline():
    assert comparison_phrase(0.0001, 0) == "in line with"


def test_trend_phrase_improving_for_negative_change():
    """Composite reading falling = stress receding = improving."""
    assert trend_phrase(value=20, change=-10) == "improving"


def test_trend_phrase_deteriorating_for_positive_change():
    """Composite rising = stress increasing = deteriorating."""
    assert trend_phrase(value=20, change=10) == "deteriorating"


def test_trend_phrase_stable_below_threshold():
    assert trend_phrase(value=20, change=2, threshold=5) == "stable"


def test_fmt_pct_signed():
    assert fmt_pct(0.025) == "+2.5%"
    assert fmt_pct(-0.025) == "-2.5%"


def test_fmt_pct_zero():
    assert fmt_pct(0) == "+0.0%"


def test_fmt_pct_nan():
    assert fmt_pct(float("nan")) == "n/a"


def test_fmt_pp():
    assert fmt_pp(2.5) == "+2.5pp"


def test_fmt_bp():
    assert fmt_bp(50) == "+50 bps"


def test_fmt_index():
    assert fmt_index(18.55) == "18.6"


def test_join_sentence_filters_empty():
    s = join_sentence("first.", "", None, "second.")
    assert s == "first. second."


def test_sentence_case_capitalizes_first():
    assert sentence_case("foo bar.") == "Foo bar."


def test_sentence_case_empty_string():
    assert sentence_case("") == ""


def test_truncate_under_max_unchanged():
    assert truncate("short", max_chars=10) == "short"


def test_truncate_over_max():
    long_text = "the quick brown fox jumps over the lazy dog several times in a row."
    out = truncate(long_text, max_chars=20)
    assert len(out) <= 21  # +1 for ellipsis
    assert out.endswith("…")


# ──────────────────────────────────────────────────────────────────────────
# headline.py
# ──────────────────────────────────────────────────────────────────────────


def test_month_label_formats_iso_date():
    assert _month_label("2026-04-26") == "April 2026"


def test_month_label_handles_invalid():
    assert _month_label("not-a-date") == "not-a-date"


def test_headline_one_liner_aggressive_with_themes():
    s = headline_one_liner("2026-04-26", "Aggressive", ["AI infrastructure", "Energy discipline"])
    assert "April 2026" in s
    assert "aggressive equity tilt" in s.lower()
    assert "ai infrastructure" in s.lower()


def test_headline_one_liner_no_themes():
    s = headline_one_liner("2026-04-26", "Defensive", [])
    assert s.endswith(".")
    assert "April 2026" in s


def test_composite_snapshot_paragraph_calm_regime():
    p = composite_snapshot_paragraph({
        "risk_liquidity": -6.7, "growth": 1.4, "inflation_rates": -14.2,
        "rl_3mo_change": 12.8,  # > threshold so should mention trend
    })
    assert "calm" in p.lower()  # R&L = -6.7 → calm
    assert "neutral" in p.lower()  # Growth = 1.4 → neutral
    assert "cool" in p.lower()  # IR = -14.2 → cool
    assert "deteriorating" in p.lower()  # 12.8 positive change


def test_composite_snapshot_paragraph_stress_regime():
    p = composite_snapshot_paragraph({
        "risk_liquidity": 60, "growth": 30, "inflation_rates": 30,
        "rl_3mo_change": 0,
    })
    assert "stressed" in p.lower() or "extreme" in p.lower()


def test_composite_snapshot_paragraph_includes_regime_flip_when_active():
    p = composite_snapshot_paragraph({
        "risk_liquidity": -5, "growth": 0, "inflation_rates": 0,
        "rl_3mo_change": -20,
        "regime_flip_active": True,
    })
    assert "regime flip" in p.lower()


def test_implications_paragraph_aggressive_includes_leverage():
    p = implications_paragraph("Aggressive", n_most_favored=4, n_least_favored=2,
                                defensive_active=False)
    assert "leverage" in p.lower()


def test_implications_paragraph_defensive_mentions_rotation():
    p = implications_paragraph("Defensive", n_most_favored=2, n_least_favored=4,
                                defensive_active=True)
    assert "rotat" in p.lower() or "defensive" in p.lower()


def test_macro_narrative_returns_paragraphs():
    paragraphs = macro_narrative(
        regime={"risk_liquidity": -5, "growth": 0, "inflation_rates": 0,
                "rl_3mo_change": 0},
        ratings_by_tier={"most_favored": [{"bucket": "Software"}] * 3,
                         "least_favored": [{"bucket": "Utilities"}]},
        stance={"label": "Aggressive"},
        themes=[],
    )
    assert isinstance(paragraphs, list)
    assert len(paragraphs) >= 2
    assert all(isinstance(p, str) and len(p) > 20 for p in paragraphs)


# ──────────────────────────────────────────────────────────────────────────
# themes.py
# ──────────────────────────────────────────────────────────────────────────


def test_theme_rules_have_required_fields():
    for rule in THEME_RULES:
        assert "name" in rule
        assert "trigger_buckets" in rule
        assert "min_most_favored" in rule
        assert "narrative" in rule
        assert isinstance(rule["trigger_buckets"], list)
        assert len(rule["trigger_buckets"]) >= 1
        assert rule["min_most_favored"] >= 1
        assert len(rule["narrative"]) > 30


def test_detect_themes_ai_infrastructure_fires():
    """When Software + Semis + MegaCapGrowth all rate Most Favored, fire AI theme."""
    ratings = {
        "most_favored": [{"bucket": "Software"}, {"bucket": "Semiconductors"},
                         {"bucket": "MegaCapGrowth"}],
        "favored": [], "neutral": [], "less_favored": [], "least_favored": [],
    }
    themes = detect_themes(ratings)
    names = [t["name"] for t in themes]
    assert "AI infrastructure" in names


def test_detect_themes_cyclical_recovery_requires_three_buckets():
    """Cyclical recovery rule requires ≥ 3 of trigger buckets in Most Favored."""
    only_two = {
        "most_favored": [{"bucket": "Industrials"}, {"bucket": "Materials"}],
        "favored": [], "neutral": [], "less_favored": [], "least_favored": [],
    }
    themes = detect_themes(only_two)
    names = [t["name"] for t in themes]
    assert "Cyclical recovery" not in names

    three = {
        "most_favored": [{"bucket": "Industrials"}, {"bucket": "Materials"},
                         {"bucket": "Energy"}],
        "favored": [], "neutral": [], "less_favored": [], "least_favored": [],
    }
    themes = detect_themes(three)
    names = [t["name"] for t in themes]
    assert "Cyclical recovery" in names


def test_detect_themes_steepener_trade_fires():
    ratings = {
        "most_favored": [{"bucket": "Banks"}, {"bucket": "Insurance"}],
        "favored": [], "neutral": [], "less_favored": [], "least_favored": [],
    }
    themes = detect_themes(ratings)
    names = [t["name"] for t in themes]
    assert "Steepener trade" in names


def test_detect_themes_no_buckets_no_themes():
    themes = detect_themes({"most_favored": [], "favored": [], "neutral": [],
                              "less_favored": [], "least_favored": []})
    assert themes == []


def test_detect_themes_only_least_favored_no_themes():
    """Themes only fire on Most Favored — Least Favored doesn't trigger them."""
    themes = detect_themes({
        "most_favored": [],
        "favored": [],
        "neutral": [],
        "less_favored": [],
        "least_favored": [{"bucket": "Software"}, {"bucket": "Semiconductors"}],
    })
    assert themes == []


def test_top_theme_names_limit():
    themes = [{"name": f"T{i}"} for i in range(10)]
    out = top_theme_names(themes, limit=3)
    assert out == ["T0", "T1", "T2"]


# ──────────────────────────────────────────────────────────────────────────
# risks.py
# ──────────────────────────────────────────────────────────────────────────


def test_kill_conditions_all_required_fields():
    for factor, cond in KILL_CONDITIONS.items():
        assert isinstance(cond, tuple)
        assert len(cond) == 3
        trigger, alt, mechanism = cond
        assert isinstance(trigger, str) and len(trigger) > 5
        assert alt is None or isinstance(alt, str)
        assert isinstance(mechanism, str) and len(mechanism) > 10


def test_risk_scenario_for_bucket_uses_first_kill_factor():
    bucket = {
        "bucket": "Banks", "display_name": "Banks",
        "kill_factors": ["yield_curve", "real_rates"],
    }
    sc = risk_scenario_for_bucket(bucket)
    assert sc is not None
    assert "Yield Curve" in sc["trigger"]
    assert "Banks" in sc["impacted_buckets"]


def test_risk_scenario_for_bucket_no_kill_factors():
    sc = risk_scenario_for_bucket({"bucket": "X", "kill_factors": []})
    assert sc is None


def test_risk_scenario_for_bucket_unknown_factor():
    sc = risk_scenario_for_bucket({"bucket": "X", "kill_factors": ["unknown_factor"]})
    assert sc is None


def test_aggregate_scenarios_groups_by_factor():
    """Two buckets sharing the same primary kill factor → one scenario."""
    buckets = [
        {"display_name": "Banks", "kill_factors": ["yield_curve"]},
        {"display_name": "Insurance", "kill_factors": ["yield_curve"]},
    ]
    scenarios = aggregate_scenarios_by_kill_factor(buckets)
    assert len(scenarios) == 1
    assert "Banks" in scenarios[0]["impacted_buckets"]
    assert "Insurance" in scenarios[0]["impacted_buckets"]


def test_generate_risk_scenarios_caps_at_max():
    most_favored = [
        {"display_name": f"B{i}", "kill_factors": [f"factor_{i}"]}
        for i in range(10)
    ]
    out = generate_risk_scenarios({"most_favored": most_favored}, max_scenarios=3)
    assert len(out) <= 3


def test_generate_risk_scenarios_empty_when_no_most_favored():
    assert generate_risk_scenarios({"most_favored": []}) == []


# ──────────────────────────────────────────────────────────────────────────
# rationale.py
# ──────────────────────────────────────────────────────────────────────────


def test_generate_rationale_software_most_favored_low_real_rates():
    bucket = {"bucket": "Software", "display_name": "Software", "rating": "Most Favored"}
    factor_readings = {"real_rates": 1.0}
    out = generate_rationale(bucket, factor_readings)
    assert "Software" in out
    assert "Most Favored" in out
    assert "long-duration" in out.lower() or "discount" in out.lower()


def test_generate_rationale_banks_includes_curve_value():
    bucket = {"bucket": "Banks", "display_name": "Banks", "rating": "Most Favored"}
    factor_readings = {"yield_curve": 75.0}
    out = generate_rationale(bucket, factor_readings)
    assert "Banks" in out
    assert "Most Favored" in out
    assert "75" in out  # the actual curve value


def test_generate_rationale_unknown_bucket_falls_back():
    bucket = {"bucket": "UnknownGroup", "display_name": "UnknownGroup", "rating": "Neutral"}
    out = generate_rationale(bucket, {})
    assert out  # non-empty
    assert "UnknownGroup" in out


def test_generate_rationale_starts_with_capital():
    bucket = {"bucket": "Software", "display_name": "Software", "rating": "Most Favored"}
    out = generate_rationale(bucket, {"real_rates": 1.0})
    assert out[0].isupper()


def test_generate_key_factors_uses_kill_factors():
    bucket = {
        "bucket": "Banks", "display_name": "Banks", "rating": "Most Favored",
        "kill_factors": ["yield_curve", "real_rates", "sloos_ci"],
    }
    factor_readings = {"yield_curve": 50.0, "real_rates": 1.5, "sloos_ci": 0.0}
    out = generate_key_factors(bucket, factor_readings)
    assert len(out) <= 3
    factors_returned = [k["factor"] for k in out]
    assert "yield_curve" in factors_returned


def test_generate_key_factors_skips_missing():
    bucket = {"kill_factors": ["yield_curve", "missing_factor"]}
    out = generate_key_factors(bucket, {"yield_curve": 50.0})
    factors = [k["factor"] for k in out]
    assert "missing_factor" not in factors


def test_generate_key_factors_includes_interpretation():
    bucket = {"kill_factors": ["jobless"]}
    out = generate_key_factors(bucket, {"jobless": 220})
    assert len(out) == 1
    assert "interpretation" in out[0]
    assert "labor market" in out[0]["interpretation"].lower()


# ──────────────────────────────────────────────────────────────────────────
# engine.py — end-to-end
# ──────────────────────────────────────────────────────────────────────────


def test_latest_factor_readings():
    fp = {"factors": {
        "vix": {"points": [["2026-01-01", 18.0], ["2026-04-26", 19.5]]},
        "yield_curve": {"points": [["2026-04-26", 50.0]]},
        "empty": {"points": []},
    }}
    out = latest_factor_readings(fp)
    assert out["vix"] == 19.5
    assert out["yield_curve"] == 50.0
    assert "empty" not in out


def test_fill_narrative_populates_all_fields():
    """End-to-end: an allocation passed through fill_narrative comes back
    with all narrative fields populated."""
    allocation = {
        "as_of": "2026-04-26",
        "stance": {"label": "Aggressive", "color": "calm", "description": "test"},
        "headline": {"alpha": 1.28, "equity_share": 1.0, "leverage": 1.28},
        "regime": {
            "risk_liquidity": -6.7, "growth": 1.4, "inflation_rates": -14.2,
            "rl_3mo_change": 12.8, "regime_flip_active": False,
        },
        "ratings": {
            "most_favored": [{
                "bucket": "Software", "display_name": "Software",
                "rating": "Most Favored",
                "kill_factors": ["real_rates", "term_premium"],
            }],
            "favored": [], "neutral": [], "less_favored": [],
            "least_favored": [],
        },
    }
    factor_readings = {"real_rates": 1.2, "term_premium": 0.5, "yield_curve": 50}
    enriched = fill_narrative(allocation, factor_readings)

    assert enriched["headline"]["narrative"]
    assert isinstance(enriched["headline"]["active_themes"], list)
    assert len(enriched["macro_narrative"]) >= 2
    assert isinstance(enriched["themes"], list)

    for entry in enriched["ratings"]["most_favored"]:
        assert entry["rationale"]
        assert isinstance(entry["key_factors"], list)


def test_fill_narrative_idempotent():
    """Running fill_narrative twice should produce the same output (within
    deterministic templates)."""
    allocation = {
        "as_of": "2026-04-26",
        "stance": {"label": "Aggressive", "color": "calm", "description": "x"},
        "headline": {"alpha": 1.28, "equity_share": 1.0, "leverage": 1.28},
        "regime": {"risk_liquidity": -6.7, "growth": 1.4, "inflation_rates": -14.2,
                   "rl_3mo_change": 12.8, "regime_flip_active": False},
        "ratings": {
            "most_favored": [{"bucket": "Banks", "display_name": "Banks",
                              "rating": "Most Favored", "kill_factors": ["yield_curve"]}],
            "favored": [], "neutral": [], "less_favored": [], "least_favored": [],
        },
    }
    factor_readings = {"yield_curve": 60}
    a = fill_narrative(dict(allocation), factor_readings)
    b = fill_narrative(dict(allocation), factor_readings)
    # Compare the narrative-relevant fields
    import json as _json
    assert _json.dumps(a, sort_keys=True) == _json.dumps(b, sort_keys=True)
