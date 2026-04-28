"""
CCAR US-Domestic 16 → v9 factor panel translation.

Spec: docs/scenario-analysis/translation-ccar-to-v9-v1.md (Joe-approved 2026-04-27).

Architectural Principle (binding):
  Scenario Analysis is a stress-test viewer onto v9's existing optimizer.
  This module translates user-facing CCAR shocks to v9 factor inputs so
  compute_v9_allocation can run UNCHANGED. Never duplicate v9's calibration.
  Tier-3 factors pass through at current observed value because CCAR has no
  analog for them; the translation function leaves those v9 inputs alone.

Joe sign-offs banked 2026-04-27:
  - 3 passthrough factors accepted: copper_gold, natgas_henry, skew.
  - ANFCI / STLFSI linear-combo weights are v1 eyeballs; refit during Phase 1.
  - Mixed-cadence handling kept (CCAR quarterly + weekly inputs are aggregated
    to weekly via Mariano-Murasawa state-space upstream of this function).
"""
from typing import Dict, List


# ════════════════════════════════════════════════════════════════════════
# Mapping table — per spec §3
# ════════════════════════════════════════════════════════════════════════

CCAR_TO_V9_MAPPING = {
    # Tier 1 — direct
    "vix":             {"tier": 1, "drivers": ["equity_vol"],                                "rule": "1to1"},
    "fed_funds":       {"tier": 1, "drivers": ["prime_rate"],                                "rule": "scale", "beta": 0.95},
    # Tier 2 — derived
    "yield_curve":     {"tier": 2, "drivers": ["t10y", "t3mo"],                              "rule": "diff"},
    "term_premium":    {"tier": 2, "drivers": ["t10y", "t5y"],                               "rule": "diff"},
    "real_rates":      {"tier": 2, "drivers": ["t10y", "cpi"],                               "rule": "diff"},
    "cpff":            {"tier": 2, "drivers": ["bbb10y"],                                    "rule": "scale", "beta": 0.42},
    "breakeven_10y":   {"tier": 2, "drivers": ["cpi"],                                       "rule": "scale", "beta": 1.0},
    "jobless":         {"tier": 2, "drivers": ["unemployment"],                              "rule": "scale", "beta": -2.5},
    "industrial_prod": {"tier": 2, "drivers": ["real_gdp"],                                  "rule": "scale", "beta": 1.85},
    "capacity_util":   {"tier": 2, "drivers": ["real_gdp"],                                  "rule": "scale", "beta": 1.20},
    "m2_yoy":          {"tier": 2, "drivers": ["nominal_gdp"],                               "rule": "scale", "beta": 0.85},
    "sloos_cre":       {"tier": 2, "drivers": ["cre_prices"],                                "rule": "scale", "beta": -1.4},
    "sloos_ci":        {"tier": 2, "drivers": ["real_gdp"],                                  "rule": "scale", "beta": -0.55},
    "anfci":           {"tier": 2, "drivers": ["equity_vol", "bbb10y_spread", "real_gdp"],   "rule": "linear_combo", "weights": [0.4, 0.3, -0.3]},
    "stlfsi":          {"tier": 2, "drivers": ["equity_vol", "bbb10y_spread", "t10y_3mo"],   "rule": "linear_combo", "weights": [0.5, 0.3, 0.2]},
    # Tier 3 — passthrough (CCAR has no analog)
    "copper_gold":     {"tier": 3, "rule": "passthrough"},
    "natgas_henry":    {"tier": 3, "rule": "passthrough"},
    "skew":            {"tier": 3, "rule": "passthrough"},
}

CCAR_US_16_IDS: List[str] = [
    "real_gdp", "nominal_gdp", "real_dpi", "nominal_dpi", "cpi", "unemployment",
    "house_prices", "cre_prices", "equity_prices", "equity_vol",
    "t3mo", "t5y", "t10y", "bbb10y", "mortgage30", "prime_rate",
]

V9_FACTOR_IDS: List[str] = list(CCAR_TO_V9_MAPPING.keys())  # 18 factors
TIER_3_PASSTHROUGH: List[str] = [k for k, v in CCAR_TO_V9_MAPPING.items() if v.get("tier") == 3]


# ════════════════════════════════════════════════════════════════════════
# Derived CCAR auxiliary variables
# ════════════════════════════════════════════════════════════════════════

def derive_aux(z_ccar: Dict[str, float]) -> Dict[str, float]:
    """Compute the derived quantities tier-2 rules reference."""
    aux: Dict[str, float] = {}
    if "t10y" in z_ccar and "t3mo" in z_ccar:
        aux["t10y_3mo"] = z_ccar["t10y"] - z_ccar["t3mo"]
    if "bbb10y" in z_ccar and "t10y" in z_ccar:
        aux["bbb10y_spread"] = z_ccar["bbb10y"] - z_ccar["t10y"]
    return aux


# ════════════════════════════════════════════════════════════════════════
# Main translation function
# ════════════════════════════════════════════════════════════════════════

def translate_ccar_to_v9(
    z_ccar: Dict[str, float],
    current_v9: Dict[str, float],
) -> Dict[str, float]:
    """
    Translate a CCAR US-16 shock vector to a v9 factor panel.

    Side-effect-free: input dicts are not mutated.

    Parameters
    ----------
    z_ccar : Dict[str, float]
        Innovations for each of the 16 CCAR US-Domestic variables, keyed
        by ID per CCAR_US_16_IDS. Values are z-score units.
    current_v9 : Dict[str, float]
        Current v9 factor panel state — used as the BASE for tier-1/2
        accumulation AND as the passthrough value for tier-3 factors.
        Must contain keys for all of V9_FACTOR_IDS.

    Returns
    -------
    Dict[str, float]
        Stressed v9 factor panel. Same keys as current_v9, with deltas
        applied per the §3 mapping table. Tier-3 factors echo current_v9
        unchanged.
    """
    # Validate input completeness
    missing_ccar = [k for k in CCAR_US_16_IDS if k not in z_ccar]
    if missing_ccar:
        raise ValueError(f"missing CCAR variables: {missing_ccar}")
    missing_v9 = [k for k in V9_FACTOR_IDS if k not in current_v9]
    if missing_v9:
        raise ValueError(f"missing v9 factors in current_v9: {missing_v9}")

    aux = derive_aux(z_ccar)
    z_combined = {**z_ccar, **aux}

    z_v9 = dict(current_v9)  # start with current state; apply deltas

    for v9_factor, spec in CCAR_TO_V9_MAPPING.items():
        rule = spec["rule"]

        if rule == "passthrough":
            continue  # tier 3 — already at current value

        if rule == "1to1":
            driver = spec["drivers"][0]
            z_v9[v9_factor] += z_combined.get(driver, 0.0)

        elif rule == "scale":
            driver = spec["drivers"][0]
            z_v9[v9_factor] += z_combined.get(driver, 0.0) * spec["beta"]

        elif rule == "diff":
            a, b = spec["drivers"]
            z_v9[v9_factor] += z_combined.get(a, 0.0) - z_combined.get(b, 0.0)

        elif rule == "linear_combo":
            for d, w in zip(spec["drivers"], spec["weights"]):
                z_v9[v9_factor] += z_combined.get(d, 0.0) * w

        else:
            raise ValueError(f"unknown rule '{rule}' for v9 factor '{v9_factor}'")

    return z_v9


# ════════════════════════════════════════════════════════════════════════
# Diagnostics
# ════════════════════════════════════════════════════════════════════════

def get_translation_summary() -> Dict[str, List[str]]:
    """Return v9 factors grouped by tier — useful for unit tests + debugging."""
    return {
        "tier_1_direct":      [k for k, v in CCAR_TO_V9_MAPPING.items() if v.get("tier") == 1],
        "tier_2_derived":     [k for k, v in CCAR_TO_V9_MAPPING.items() if v.get("tier") == 2],
        "tier_3_passthrough": TIER_3_PASSTHROUGH,
    }


def get_passthrough_factors() -> List[str]:
    """Return list of v9 factors held at current state (no CCAR analog)."""
    return list(TIER_3_PASSTHROUGH)


# ════════════════════════════════════════════════════════════════════════
# Self-tests per spec §6
# ════════════════════════════════════════════════════════════════════════

def test_identity():
    """§6.1 — zero CCAR shock yields unchanged v9 panel (≤ 1e-9 residual)."""
    z_ccar_zero = {k: 0.0 for k in CCAR_US_16_IDS}
    current_v9 = {k: 1.0 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar_zero, current_v9)
    for k in current_v9:
        residual = abs(result[k] - current_v9[k])
        assert residual < 1e-9, f"identity failed at {k}: residual={residual}"
    return True


def test_direct_pass():
    """§6.2 — equity_vol +1σ → vix +1σ AND anfci +0.4 AND stlfsi +0.5 (linear_combo coverage)."""
    z_ccar = {k: 0.0 for k in CCAR_US_16_IDS}
    z_ccar["equity_vol"] = 1.0
    current_v9 = {k: 0.0 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar, current_v9)
    # Direct (tier-1)
    assert abs(result["vix"] - 1.0) < 1e-9, f"vix should be 1.0, got {result['vix']}"
    # Linear-combo (tier-2): anfci = 0.4*equity_vol + 0.3*bbb_spread + (-0.3)*real_gdp
    assert abs(result["anfci"] - 0.4) < 1e-9, f"anfci should be 0.4, got {result['anfci']}"
    # Linear-combo (tier-2): stlfsi = 0.5*equity_vol + 0.3*bbb_spread + 0.2*t10y_3mo
    assert abs(result["stlfsi"] - 0.5) < 1e-9, f"stlfsi should be 0.5, got {result['stlfsi']}"
    # Factors NOT driven by equity_vol should be 0
    untouched = ["fed_funds", "yield_curve", "term_premium", "real_rates", "cpff",
                 "breakeven_10y", "jobless", "industrial_prod", "capacity_util",
                 "m2_yoy", "sloos_cre", "sloos_ci",
                 "copper_gold", "natgas_henry", "skew"]
    for k in untouched:
        assert abs(result[k]) < 1e-9, f"{k} should be 0 but is {result[k]}"
    return True


def test_uncovered_ccar_var_no_effect():
    """CCAR vars not in any mapping (real_dpi, nominal_dpi, house_prices, mortgage30) → no v9 movement."""
    for uncov in ["real_dpi", "nominal_dpi", "house_prices", "mortgage30"]:
        z_ccar = {k: 0.0 for k in CCAR_US_16_IDS}
        z_ccar[uncov] = 5.0  # large shock
        current_v9 = {k: 0.0 for k in V9_FACTOR_IDS}
        result = translate_ccar_to_v9(z_ccar, current_v9)
        for k in result:
            assert abs(result[k]) < 1e-9, f"{uncov} +5σ should not move v9.{k}, got {result[k]}"
    return True


def test_passthrough_tier3():
    """§3 — tier-3 factors must echo current_v9 regardless of CCAR shocks."""
    z_ccar = {k: 1.0 for k in CCAR_US_16_IDS}  # all CCAR vars +1σ
    current_v9 = {k: 0.5 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar, current_v9)
    for tier3 in TIER_3_PASSTHROUGH:
        assert abs(result[tier3] - 0.5) < 1e-9, f"tier-3 {tier3} should pass through 0.5, got {result[tier3]}"
    return True


def test_diff_rule():
    """diff rule: yield_curve = t10y − t3mo."""
    z_ccar = {k: 0.0 for k in CCAR_US_16_IDS}
    z_ccar["t10y"] = 1.0
    z_ccar["t3mo"] = -0.5
    current_v9 = {k: 0.0 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar, current_v9)
    expected = 1.0 - (-0.5)  # = 1.5
    assert abs(result["yield_curve"] - expected) < 1e-9, f"yield_curve {result['yield_curve']} != {expected}"
    return True


def test_scale_rule():
    """scale rule: jobless = -2.5 × unemployment."""
    z_ccar = {k: 0.0 for k in CCAR_US_16_IDS}
    z_ccar["unemployment"] = 1.0
    current_v9 = {k: 0.0 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar, current_v9)
    expected = 1.0 * -2.5
    assert abs(result["jobless"] - expected) < 1e-9, f"jobless {result['jobless']} != {expected}"
    return True


def test_linear_combo_rule():
    """linear_combo: anfci = 0.4*equity_vol + 0.3*bbb10y_spread − 0.3*real_gdp."""
    z_ccar = {k: 0.0 for k in CCAR_US_16_IDS}
    z_ccar["equity_vol"] = 1.0
    z_ccar["bbb10y"] = 1.0   # bbb10y_spread = bbb10y - t10y = 1 - 0 = 1
    z_ccar["t10y"] = 0.0
    z_ccar["real_gdp"] = -1.0  # negative GDP → positive ANFCI contribution (sign-flip)
    current_v9 = {k: 0.0 for k in V9_FACTOR_IDS}
    result = translate_ccar_to_v9(z_ccar, current_v9)
    expected = 0.4 * 1.0 + 0.3 * 1.0 - 0.3 * (-1.0)  # = 0.4 + 0.3 + 0.3 = 1.0
    assert abs(result["anfci"] - expected) < 1e-9, f"anfci {result['anfci']} != {expected}"
    return True


def test_validation_errors():
    """Missing inputs raise ValueError."""
    try:
        translate_ccar_to_v9({}, {k: 0 for k in V9_FACTOR_IDS})
        return False  # should have raised
    except ValueError as e:
        return "missing CCAR variables" in str(e)


def run_self_tests():
    tests = [
        ("identity",                  test_identity),
        ("direct_pass + linear_combo",test_direct_pass),
        ("uncovered_ccar_no_effect",  test_uncovered_ccar_var_no_effect),
        ("passthrough_tier3",         test_passthrough_tier3),
        ("diff_rule",                 test_diff_rule),
        ("scale_rule",                test_scale_rule),
        ("linear_combo",              test_linear_combo_rule),
        ("validation",                test_validation_errors),
    ]
    print("Running CCAR → v9 translation self-tests")
    print("=" * 50)
    all_pass = True
    for name, fn in tests:
        try:
            ok = fn()
            print(f"  {'PASS' if ok else 'FAIL'}: {name}")
            if not ok:
                all_pass = False
        except AssertionError as e:
            print(f"  FAIL: {name} — {e}")
            all_pass = False
        except Exception as e:
            print(f"  ERROR: {name} — {type(e).__name__}: {e}")
            all_pass = False
    return all_pass


if __name__ == "__main__":
    summary = get_translation_summary()
    print("CCAR US-Domestic 16 → v9 factor panel (18 factors)")
    print("-" * 50)
    for tier, factors in summary.items():
        print(f"  {tier}: {len(factors)} — {', '.join(factors)}")
    print()
    if run_self_tests():
        print("\nALL SELF-TESTS PASS")
    else:
        print("\nSOME TESTS FAILED")
        exit(1)
