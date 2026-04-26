"""
narrative.engine — orchestrator that fills the UI schema with templated prose.

Reads the schema-shaped allocation_output JSON (from output.py) plus the
factor panel (for current factor readings used by per-bucket rationale).
Fills:
  headline.narrative
  headline.active_themes
  macro_narrative[]
  themes[]
  ratings.<tier>[].rationale
  ratings.<tier>[].key_factors
  risk_scenarios[]

Returns the same dict with narrative fields populated. Schema-validated
on output.

Usage:
  python -m asset_allocation.narrative.engine \\
      --input public/v10_allocation.json \\
      --factor-panel /tmp/aa/2026-04-26/factor_panel.json \\
      --output public/v10_allocation.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from .headline import (
    macro_narrative as gen_macro_narrative,
    headline_one_liner,
)
from .rationale import generate_rationale, generate_key_factors
from .themes import detect_themes, top_theme_names
from .risks import generate_risk_scenarios

logger = logging.getLogger(__name__)


def latest_factor_readings(factor_panel: dict) -> dict[str, float]:
    """Extract the most recent value of each factor."""
    out = {}
    for name, meta in factor_panel.get("factors", {}).items():
        points = meta.get("points", [])
        if points and points[-1][1] is not None:
            out[name] = float(points[-1][1])
    return out


def fill_narrative(allocation: dict, factor_readings: dict[str, float]) -> dict:
    """Populate all narrative fields. Returns the same dict (mutated).

    Operates in place — caller can also use the returned reference."""
    # Themes first — needed by the headline
    themes = detect_themes(allocation.get("ratings", {}))
    allocation["themes"] = themes
    allocation.setdefault("headline", {})
    allocation["headline"]["active_themes"] = top_theme_names(themes, limit=3)

    # Macro narrative paragraphs
    allocation["macro_narrative"] = gen_macro_narrative(
        regime=allocation.get("regime", {}),
        ratings_by_tier=allocation.get("ratings", {}),
        stance=allocation.get("stance", {}),
        themes=themes,
    )

    # One-line headline
    allocation["headline"]["narrative"] = headline_one_liner(
        as_of=allocation.get("as_of", ""),
        stance_label=allocation.get("stance", {}).get("label", "Balanced"),
        top_themes=top_theme_names(themes),
    )

    # Per-bucket rationale + key factors
    for tier_key, tier_buckets in allocation.get("ratings", {}).items():
        for bucket in tier_buckets:
            bucket["rationale"] = generate_rationale(bucket, factor_readings)
            bucket["key_factors"] = generate_key_factors(bucket, factor_readings)

    # Risk scenarios
    allocation["risk_scenarios"] = generate_risk_scenarios(
        allocation.get("ratings", {})
    )

    return allocation


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, help="Path to allocation JSON to enrich")
    ap.add_argument("--factor-panel", required=True, help="Path to factor_panel.json for factor readings")
    ap.add_argument("--output", required=True, help="Path to write the enriched JSON")
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level),
                        format="%(asctime)s [%(levelname)s] %(message)s")

    allocation = json.loads(Path(args.input).read_text())
    factor_panel = json.loads(Path(args.factor_panel).read_text())
    factor_readings = latest_factor_readings(factor_panel)

    enriched = fill_narrative(allocation, factor_readings)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(enriched, indent=2))
    logger.info(f"Wrote enriched output to {out_path}")
    logger.info(f"  themes: {len(enriched.get('themes', []))}")
    logger.info(f"  risk scenarios: {len(enriched.get('risk_scenarios', []))}")
    logger.info(f"  rationale paragraphs: "
                f"{sum(len(t) for t in enriched.get('ratings', {}).values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
