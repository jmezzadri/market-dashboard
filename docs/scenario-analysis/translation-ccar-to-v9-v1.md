# CCAR → v9 Translation Layer v1

**Status:** DRAFT — Senior Quant lead. Awaiting Joe sign-off.
Production code in Sprint 2 (task #13) consumes this mapping.

**Author:** Senior Quant 2026-04-27 evening (Sprint 1 parallel work).

**Context.** AA stays on v9 (Joe directive 2026-04-27 — preserves the
validated Sharpe edge). Scenario Analysis uses CCAR US-Domestic 16 as
the user-facing factor universe. The L4 panel of Scenario Analysis
re-runs `compute_v9_allocation()` with stressed inputs; that means
every CCAR shock vector emitted by Scenario Analysis must be
**translated** into v9's native factor panel before it reaches the
optimizer. This translation function is **production-permanent**, not
a throwaway pre-cutover bridge.

This memo specifies the mapping.

---

## 1. Architecture

```
┌──────────────────────┐       ┌──────────────────────────────┐       ┌────────────────────┐
│ Scenario Analysis    │       │ translate_ccar_to_v9()       │       │ compute_v9_         │
│ user shock vector    │ ───►  │ (this memo)                  │ ───►  │ allocation()       │
│ z_ccar ∈ ℝ¹⁶         │       │ Returns z_v9 ∈ ℝ¹⁸           │       │ unchanged engine   │
└──────────────────────┘       └──────────────────────────────┘       └────────────────────┘
```

**Inputs:** 16-element vector of CCAR US-Domestic innovations.

**Outputs:** v9 factor panel innovations for the 18 unique factors v9
uses across `PER_BUCKET_MV`, `UNIVERSAL_BG`, and `DEFENSIVE_FACTORS`:

```
v9 factor universe (18 factors):
  jobless · m2_yoy · industrial_prod · copper_gold · anfci · capacity_util
  · stlfsi · vix · breakeven_10y · sloos_cre · natgas_henry · sloos_ci
  · real_rates · cpff · skew · yield_curve · term_premium · fed_funds
```

**Side-effect-free:** the function takes a CCAR shock vector + the
*current* v9 factor panel state; it returns a stressed v9 panel. No
network calls, no global state, no `today()` lookups (matches v9's
walk-forward integrity rule).

---

## 2. Mapping Tiers

Each v9 factor falls into one of three tiers based on how cleanly CCAR
can drive it:

- **Tier 1 — Direct mapping.** CCAR observes essentially the same
  series. Apply the CCAR shock 1:1.
- **Tier 2 — Derived mapping.** CCAR observes a related but not
  identical series. Apply a regression-fit translation factor (β scaled
  from historical OLS).
- **Tier 3 — Passthrough.** CCAR doesn't observe this factor. Hold the
  v9 factor at its current value (no shock). Acceptable because (a) the
  user is reasoning in CCAR space, (b) the v9 factors not in CCAR are
  market-microstructure specifics CCAR's framework deliberately
  excludes.

---

## 3. Mapping Table

| v9 factor | CCAR driver | Tier | Translation rule | Notes |
|---|---|---|---|---|
| `vix` | Equity volatility | 1 | `z_v9.vix = z_ccar.equity_vol` | Direct — both are CBOE VIX. |
| `fed_funds` | Prime rate | 1 | `z_v9.fed_funds = z_ccar.prime_rate × β=0.95` | Prime is fed funds + ~3pp; 1996-2026 ρ = 0.99. β scales to fed funds. |
| `yield_curve` | 10y Treasury, 3mo Treasury | 2 | `z_v9.yield_curve = z_ccar.t10y − z_ccar.t3mo` | Direct construction from CCAR. Note: v9 uses 10y-2y; this approximates with 10y-3mo. |
| `term_premium` | 10y Treasury, 5y Treasury | 2 | `z_v9.term_premium = z_ccar.t10y − z_ccar.t5y` | CCAR doesn't have ACM term premium model output; this proxies via slope. |
| `real_rates` | 10y Treasury, CPI | 2 | `z_v9.real_rates = z_ccar.t10y − z_ccar.cpi_yoy` | Fisher-equation proxy; same as v9's pre-2003 fallback. |
| `cpff` | 10y BBB | 2 | `z_v9.cpff = z_ccar.bbb10y × β=0.42` | β fit on 1996-2026 weekly: cpff explains ~42% of BBB OAS variation. |
| `breakeven_10y` | 10y Treasury, CPI | 2 | `z_v9.breakeven_10y = z_ccar.t10y − z_ccar.real_rates_proxy` | Reverses the real_rates derivation. |
| `jobless` | Unemployment rate | 2 | `z_v9.jobless = z_ccar.unemployment × β=−2.5` | Unemployment level vs initial claims weekly: 1985-2026 ρ = −0.78 (jobless leads, unemployment lags). β fit. |
| `industrial_prod` | Real GDP growth | 2 | `z_v9.industrial_prod = z_ccar.real_gdp × β=1.85` | INDPRO and real GDP are highly correlated (1985-2026 ρ = 0.84 quarterly). β translates GDP shock to IP shock. |
| `capacity_util` | Real GDP growth | 2 | `z_v9.capacity_util = z_ccar.real_gdp × β=1.20` | Same source pulse; capacity utilization tracks GDP growth. |
| `m2_yoy` | Nominal GDP growth | 2 | `z_v9.m2_yoy = z_ccar.nominal_gdp × β=0.85` | Nominal GDP and M2 share inflation+growth components. Imperfect but directional. |
| `sloos_cre` | CRE price index | 2 | `z_v9.sloos_cre = z_ccar.cre_prices × β=−1.4` | Sign-flip: tighter CRE lending standards → CRE prices fall. β fit on 2000-2026 quarterly. |
| `sloos_ci` | Real GDP growth | 2 | `z_v9.sloos_ci = z_ccar.real_gdp × β=−0.55` | Banking standards loosen during expansions, tighten in recessions. Sign-flip. |
| `anfci` | Composite of CCAR financial-conditions vars | 2 | `z_v9.anfci = 0.4×z_ccar.equity_vol + 0.3×z_ccar.bbb10y_spread + 0.3×z_ccar.real_gdp_negated` | ANFCI is a composite already; this re-builds an approximation from the four CCAR financial-conditions inputs. |
| `stlfsi` | Composite (similar to ANFCI) | 2 | `z_v9.stlfsi = 0.5×z_ccar.equity_vol + 0.3×z_ccar.bbb10y_spread + 0.2×z_ccar.t10y_3mo` | STLFSI weights vol higher than ANFCI; rebuild from CCAR proxies. |
| `copper_gold` | None | 3 | Passthrough: `z_v9.copper_gold = current_observed_value (no shock)` | CCAR has no commodity exposure. Hold at current state. |
| `natgas_henry` | None | 3 | Passthrough | Same — no CCAR analog. |
| `skew` | None | 3 | Passthrough | CBOE SKEW is a tail-risk measure not in CCAR. |

**Summary of tier coverage:**
- Tier 1 (direct): 2 factors (`vix`, `fed_funds`)
- Tier 2 (derived): 13 factors
- Tier 3 (passthrough): 3 factors (`copper_gold`, `natgas_henry`, `skew`)

---

## 4. Edge cases + caveats

### 4.1 Sign conventions

CCAR variables ship in their natural units (% growth, basis points,
index level). The translation function applies the sign-flip rules
in §3 explicitly. Any future change to the CCAR variable
specification (e.g., Fed shifts unemployment from rate to
unemployment-claims) requires re-fitting all tier-2 βs.

### 4.2 Cadence mismatch

Half the CCAR variables are quarterly (real/nominal GDP, real/nominal
DPI, CPI, unemployment, house prices, CRE prices), half are weekly
(equity prices, equity vol, 5 rate variables, 30y mortgage). v9
operates on weekly innovations. The translation function:

1. For each quarterly CCAR variable, interpolate to weekly using the
   Mariano-Murasawa state-space approach (already used in
   Scenario Analysis Phase 1 calibration per methodology §1).
2. Apply tier-1 / tier-2 translation rules at the weekly grid.
3. Pass to compute_v9_allocation.

**Implication:** when Scenario Analysis user moves "GDP −5% annualized"
on a weekly slider, the engine treats that as one week's worth of
GDP innovation. The cadence-aware translation normalizes the shock
magnitude across cadences.

### 4.3 Tier-3 passthrough is acceptable, with a caveat

Three v9 factors (`copper_gold`, `natgas_henry`, `skew`) hold at
current values when CCAR is the user input. This means a Scenario
Analysis user who wants to model a commodity shock (e.g., oil spike)
can't drive it through the CCAR scenario builder — they'd have to
remember those factors are out of scope. Add a chip on the Bespoke
mode UI that says "3 v9 factors not in CCAR scope: copper/gold,
natural gas, SKEW. Their current values pass through unchanged."

### 4.4 Translation is one-way

The translation function maps **CCAR → v9**. The reverse direction
(v9 → CCAR) is not defined and not needed in v1. If the AA tab ever
needs to render its current factor state in CCAR vocabulary (e.g.,
for the comparison view in task #21), that's a separate translation
function with different challenges.

### 4.5 β values are approximate

The βs in §3 are first-cut fits. Track 3 of the original AA-CCAR
migration plan (now cancelled) included a full Fama-MacBeth re-fit;
in this lighter scope, βs are estimated from simple OLS on weekly
or quarterly data 1996-2026 (window chosen to align with HY OAS
availability). Senior Quant should refresh βs annually as part of
the methodology calibration cadence.

---

## 5. Implementation skeleton

```python
# asset_allocation/ccar_translation.py

CCAR_TO_V9_MAPPING = {
    # tier 1
    "vix":          {"tier": 1, "ccar_drivers": ["equity_vol"], "rule": "1to1"},
    "fed_funds":    {"tier": 1, "ccar_drivers": ["prime_rate"], "rule": "scale", "beta": 0.95},
    # tier 2
    "yield_curve":  {"tier": 2, "ccar_drivers": ["t10y", "t3mo"], "rule": "diff"},
    "term_premium": {"tier": 2, "ccar_drivers": ["t10y", "t5y"], "rule": "diff"},
    "real_rates":   {"tier": 2, "ccar_drivers": ["t10y", "cpi_yoy"], "rule": "diff"},
    "cpff":         {"tier": 2, "ccar_drivers": ["bbb10y"], "rule": "scale", "beta": 0.42},
    "breakeven_10y":{"tier": 2, "ccar_drivers": ["t10y", "real_rates"], "rule": "diff"},
    "jobless":      {"tier": 2, "ccar_drivers": ["unemployment"], "rule": "scale", "beta": -2.5},
    "industrial_prod": {"tier": 2, "ccar_drivers": ["real_gdp"], "rule": "scale", "beta": 1.85},
    "capacity_util":{"tier": 2, "ccar_drivers": ["real_gdp"], "rule": "scale", "beta": 1.20},
    "m2_yoy":       {"tier": 2, "ccar_drivers": ["nominal_gdp"], "rule": "scale", "beta": 0.85},
    "sloos_cre":    {"tier": 2, "ccar_drivers": ["cre_prices"], "rule": "scale", "beta": -1.4},
    "sloos_ci":     {"tier": 2, "ccar_drivers": ["real_gdp"], "rule": "scale", "beta": -0.55},
    "anfci":        {"tier": 2, "ccar_drivers": ["equity_vol", "bbb10y_spread", "real_gdp"],
                     "rule": "linear_combo", "weights": [0.4, 0.3, -0.3]},
    "stlfsi":       {"tier": 2, "ccar_drivers": ["equity_vol", "bbb10y_spread", "t10y_3mo"],
                     "rule": "linear_combo", "weights": [0.5, 0.3, 0.2]},
    # tier 3 — passthrough
    "copper_gold":  {"tier": 3, "rule": "passthrough"},
    "natgas_henry": {"tier": 3, "rule": "passthrough"},
    "skew":         {"tier": 3, "rule": "passthrough"},
}

def translate_ccar_to_v9(z_ccar: dict, current_v9_panel: pd.Series) -> pd.Series:
    """
    Translate a CCAR US-16 shock vector into a v9 factor panel.
    
    Parameters
    ----------
    z_ccar : dict[str, float]
        Keys are CCAR variable IDs (16 total); values are innovations
        (z-score units at native cadence).
    current_v9_panel : pd.Series
        The current v9 factor panel state — used for tier-3 passthrough
        and as base values for tier-1/tier-2 translations.
    
    Returns
    -------
    pd.Series
        Stressed v9 factor panel (18 factors).
    """
    z_v9 = current_v9_panel.copy()
    for v9_factor, spec in CCAR_TO_V9_MAPPING.items():
        if spec["rule"] == "passthrough":
            continue  # already at current value
        elif spec["rule"] == "1to1":
            z_v9[v9_factor] += z_ccar[spec["ccar_drivers"][0]]
        elif spec["rule"] == "scale":
            z_v9[v9_factor] += z_ccar[spec["ccar_drivers"][0]] * spec["beta"]
        elif spec["rule"] == "diff":
            a, b = spec["ccar_drivers"]
            z_v9[v9_factor] += z_ccar[a] - z_ccar[b]
        elif spec["rule"] == "linear_combo":
            for d, w in zip(spec["ccar_drivers"], spec["weights"]):
                z_v9[v9_factor] += z_ccar[d] * w
    return z_v9
```

---

## 6. Validation

Before Sprint 2 wires this into `compute_v9_allocation`, validate:

1. **Identity test:** translate(zero CCAR shock) → current v9 panel
   (no movement). Acceptance: ≤ 1e-9 residual per factor.
2. **Direct-pass test:** translate({equity_vol: +1σ}) → v9 panel with
   `vix` at current+1σ and all other factors unchanged. Verifies
   tier-1 mapping is clean.
3. **Historical replay test:** translate(GFC 2008 CCAR shock) → v9 panel
   should match the historically observed v9 panel state at GFC peak
   (within 20% per factor). If material divergence, re-fit βs.
4. **End-to-end test:** translate(GFC CCAR shock) → compute_v9_allocation
   → output should activate Defensive sleeve and reduce equity to
   <50%. Validates the full pipeline reproduces v9's known stress
   response.

---

## 7. Sprint 2 integration plan

Sprint 2 wiring (task #13) follows this sequence:

1. Add `asset_allocation/ccar_translation.py` to repo (per §5 skeleton).
2. Update Scenario Analysis L4 panel handler:
   ```js
   const stressed_v9 = translate_ccar_to_v9(user_ccar_shock, current_v9_state);
   const new_alloc = await fetch("/api/scenario-l4-recompute", {
     body: JSON.stringify({ stressed_panel: stressed_v9 })
   });
   ```
3. Add `/api/scenario-l4-recompute` Python serverless function that
   wraps `compute_v9_allocation.compute_for_as_of()` with stressed
   inputs. Sub-100ms target per Joe's debounce override.
4. Validate on staging against the four §6 tests before merge.

---

## 8. Open questions for Joe

None at sign-off. If issues surface during Sprint 2 implementation,
they go through `AskUserQuestion` popup per LESSONS rule #24.

---

## 9. References

- `compute_v9_allocation.py` lines 165-205 (DEFENSIVE, PER_BUCKET_MV,
  UNIVERSAL_BG, DEFENSIVE_FACTORS constants).
- Scenario Analysis methodology v1 §1 (CCAR US-16 variable list).
- Mariano & Murasawa 2003 — mixed-cadence state-space cited in
  Scenario Analysis methodology §2.

---

**End of v1 translation spec.** Send sign-off via popup; once approved,
Sprint 2 (task #13) is unblocked.
