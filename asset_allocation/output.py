"""
asset_allocation/output.py — Layer 5: schema-validated UI-consumable output.

Reads the compute-layer allocation + state-layer deltas. Produces the
final v10_allocation.json that the React UI consumes. Validates against
the locked output schema before writing.

Critical: this layer does NOT generate narrative text. Phase 4 fills the
narrative and theme fields. For now, those fields are present but empty
or templated-with-placeholder.

Usage:
  python -m asset_allocation.output --run-dir /tmp/aa/2026-04-26 \\
      --output public/v10_allocation.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from asset_allocation.validation import validate_against_schema_file

logger = logging.getLogger(__name__)

# Defensive ETF descriptions — match what the UI shows
DEFENSIVE_FUND_NAMES = {
    "BIL": "SPDR 1-3 Month Treasury Bill ETF (cash proxy)",
    "TLT": "iShares 20+ Year Treasury Bond ETF (long duration)",
    "GLD": "SPDR Gold Shares",
    "LQD": "iShares Investment Grade Corporate Bond ETF",
}

# Locked back-test results (from v9 lock 2026-04-25)
LOCKED_BACKTEST = {
    "window": "2008-01 to 2026-04",
    "cagr": 0.1388,
    "sharpe": 0.610,
    "max_drawdown": -0.2364,
    "vs_spy_cagr": 0.0282,
}

# Locked methodology metadata
METHODOLOGY = {
    "version": "v10",
    "locked_at": "2026-04-25",
    "back_test": LOCKED_BACKTEST,
    "documentation_url": "/asset-allocation-methodology-v9-LOCKED.md",
    "raw_data_url": "/v10_allocation.json",
}


def shape_for_ui(allocation: dict, validation_report: dict | None = None) -> dict:
    """Transform the compute-layer allocation into the UI schema shape."""
    # Re-shape ratings into 5 tiers
    tiers = {"most_favored": [], "favored": [], "neutral": [],
             "less_favored": [], "least_favored": []}
    tier_map = {
        "Most Favored": "most_favored",
        "Favored": "favored",
        "Neutral": "neutral",
        "Less Favored": "less_favored",
        "Least Favored": "least_favored",
    }

    # Compute SPY benchmark weights by bucket from spy_comparison
    spy_by_bucket = {}
    if allocation.get("spy_comparison"):
        for entry in allocation["spy_comparison"].get("by_sector", []):
            # rough mapping — for the rated bucket we use sector-level SPY weight
            spy_by_bucket[entry["sector"]] = entry["spy_weight"] * 100  # to pct

    for entry in allocation.get("ratings", []):
        tier = tier_map.get(entry["rating"], "neutral")
        # Approximate benchmark weight — the strategy's bucket maps to a GICS
        # sector; multiple buckets can share a sector (e.g., IGV + SOXX both
        # map to InfoTech). Use the sector-level SPY weight as an approximation.
        from asset_allocation.compute import BUCKET_TO_SECTOR
        sector = BUCKET_TO_SECTOR.get(entry["bucket_name"], "Other")
        bench_pct = spy_by_bucket.get(sector)
        weight_pct = entry["weight"] * 100

        rated = {
            "bucket": entry["bucket_name"],
            "display_name": entry["display_name"],
            "industry_group": entry["gics_path"],
            "rating": entry["rating"],
            "rationale": "",  # Phase 4 fills this
            "key_factors": [],  # Phase 4 fills this
            "examples": entry["examples"],
            "weight_pct": round(weight_pct, 2),
            "benchmark_weight_pct": round(bench_pct, 2) if bench_pct is not None else None,
            "vs_benchmark_pp": round(weight_pct - bench_pct, 2) if bench_pct is not None else None,
            "implementation_notes": entry["implementation_notes"],
            "kill_factors": entry["kill_factors"],
            "rating_change_mom": None,  # State layer fills via what_changed
            "rating_change_qoq": None,
        }
        tiers[tier].append(rated)

    # Defensive entries
    defensive_entries = []
    for d in allocation.get("defensive", []):
        defensive_entries.append({
            "asset": d["ticker"],
            "fund": DEFENSIVE_FUND_NAMES.get(d["ticker"], d["ticker"]),
            "weight": round(d["weight"], 4),
            "weight_within_defensive": round(d["weight_within_defensive"], 4),
            "rationale_when_active": "",  # Phase 4 fills
        })
    defensive_active = any(d["weight"] > 0.001 for d in allocation.get("defensive", []))

    # Regime structure
    regime = allocation.get("regime", {})
    regime_obj = {
        "risk_liquidity": {
            "value": regime.get("risk_liquidity"),
            "label": _classify_composite(regime.get("risk_liquidity", 0), "rl"),
        },
        "growth": {
            "value": regime.get("growth"),
            "label": _classify_composite(regime.get("growth", 0), "growth"),
        },
        "inflation_rates": {
            "value": regime.get("inflation_rates"),
            "label": _classify_composite(regime.get("inflation_rates", 0), "ir"),
        },
        "rl_3mo_change": regime.get("rl_3mo_change", 0),
        "regime_flip_active": regime.get("regime_flip_active", False),
    }

    # Target allocation (by bucket + by sector + vs SPY)
    target = {
        "by_bucket": {e["display_name"]: e["weight_pct"]
                      for tier_list in tiers.values() for e in tier_list},
    }
    if allocation.get("spy_comparison"):
        sc = allocation["spy_comparison"]
        target["by_sector"] = {}
        target["spy_by_sector"] = {}
        for c in sc.get("by_sector", []):
            target["by_sector"][c["sector"]] = round(c["strategy_weight"] * 100, 2)
            target["spy_by_sector"][c["sector"]] = round(c["spy_weight"] * 100, 2)
        target["active_overweights_pp"] = sc.get("active_overweights_pp", [])
        target["active_underweights_pp"] = sc.get("active_underweights_pp", [])

    # Headline
    headline = {
        "alpha": round(allocation["alpha"], 4),
        "equity_share": round(allocation["equity_share"], 4),
        "leverage": round(allocation["leverage"], 4),
        "narrative": "",  # Phase 4 fills
        "active_themes": [],  # Phase 4 fills
    }

    # Data quality summary
    dq = {
        "factors_pulled": 0,
        "factors_with_warnings": [],
        "validation_passed": True,
    }
    if validation_report:
        dq["validation_passed"] = validation_report.get("passed", True)
        dq["factors_with_warnings"] = list({
            w.get("factor", "") for w in validation_report.get("warnings", [])
            if w.get("factor")
        })

    output = {
        "schema_version": "v10.0",
        "as_of": allocation["as_of"],
        "calculated_at": allocation["calculated_at"],
        "rebalance_frequency": "weekly",
        "previous_rebalance": allocation.get("what_changed", {}).get("previous_rebalance_date"),
        "next_rebalance": None,  # populated by scheduling layer in Phase 5
        "stance": allocation["stance"],
        "headline": headline,
        "regime": regime_obj,
        "macro_narrative": [],  # Phase 4 fills
        "themes": [],  # Phase 4 fills
        "ratings": tiers,
        "target_allocation": target,
        "defensive": {
            "active": defensive_active,
            "weights": defensive_entries,
        },
        "what_changed": allocation.get("what_changed", {}),
        "risk_scenarios": [],  # Phase 4 fills
        "implementation": {
            "guidance_paragraphs": [
                ("Use sector or industry-group ETFs for liquid implementation, "
                 "build the same exposure through individual stocks, or use a "
                 "model portfolio at your broker. The model is benchmark-agnostic "
                 "on ETF provider."),
                ("Strategy rebalances weekly. Holdings turnover is moderate — "
                 "expect 1-3 bucket changes per month under normal conditions, "
                 "more during regime transitions."),
            ],
            "rebalance_note": ("Strategy formally rebalances weekly. Mid-week "
                               "regime watch surfaces alerts when composites "
                               "move materially, but the formal allocation "
                               "only changes at the weekly rebalance."),
            "tax_note": ("In a taxable account, consider holding the strategy "
                         "in a tax-advantaged sleeve (IRA, 401k) or use "
                         "tax-loss harvesting on rebalance. Equal-weight "
                         "rebalancing creates short-term gains."),
        },
        "methodology": METHODOLOGY,
        "data_quality": dq,
    }
    return output


def _classify_composite(value: float, kind: str) -> str:
    """Plain-English label for a composite reading."""
    if kind == "rl":
        if value <= -10: return "calm"
        if value <= 20: return "neutral"
        if value <= 30: return "elevated"
        return "stressed"
    if kind == "growth":
        if value <= -10: return "supportive"
        if value <= 25: return "neutral"
        return "weakening"
    if kind == "ir":
        if value <= -10: return "cool"
        if value <= 25: return "neutral"
        return "hot"
    return "unknown"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--output", required=True,
                    help="Path to write the final v10_allocation.json")
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level),
                        format="%(asctime)s [%(levelname)s] %(message)s")

    run_dir = Path(args.run_dir)
    # Prefer allocation_with_state if state layer ran, else fall back
    allocation_path = run_dir / "allocation_with_state.json"
    if not allocation_path.exists():
        allocation_path = run_dir / "allocation.json"
    if not allocation_path.exists():
        logger.error(f"allocation.json not found in {run_dir}")
        return 2

    allocation = json.loads(allocation_path.read_text())

    validation_report_path = run_dir / "validation_report.json"
    validation_report = None
    if validation_report_path.exists():
        validation_report = json.loads(validation_report_path.read_text())

    output = shape_for_ui(allocation, validation_report)

    # Schema-validate before write
    schema_errors = validate_against_schema_file(output, "allocation_output.schema.json")
    if schema_errors:
        logger.error(f"Output failed schema validation ({len(schema_errors)} errors):")
        for err in schema_errors[:10]:
            logger.error(f"  {err}")
        return 1

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2))
    logger.info(f"Wrote schema-validated output to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
