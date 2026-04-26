"""
asset_allocation/validation.py — Layer 2: validation.

Runs schema, freshness, and sanity checks on the acquisition output.
Validation failure halts the pipeline. Warnings (e.g., stale-by-1-day,
out-of-range single observation) are logged but don't halt.

Validation does NOT modify data. It produces a validation_report.json
and either passes or fails.

Usage:
  python -m asset_allocation.validation --run-dir /tmp/aa_run/2026-04-26
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

SCHEMAS_DIR = Path(__file__).parent / "schemas"


# ──────────────────────────────────────────────────────────────────────────
# Schema validation (no jsonschema dep — minimal validator inline)
# ──────────────────────────────────────────────────────────────────────────


def _check_type(value, expected_type) -> bool:
    """Minimal JSON Schema 'type' check."""
    if expected_type == "string": return isinstance(value, str)
    if expected_type == "number": return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_type == "integer": return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "boolean": return isinstance(value, bool)
    if expected_type == "array": return isinstance(value, list)
    if expected_type == "object": return isinstance(value, dict)
    if expected_type == "null": return value is None
    return False


def validate_schema(data: dict, schema: dict, path: str = "") -> list[str]:
    """Lightweight JSON-Schema-ish validator. Returns list of error messages."""
    errors = []

    if "required" in schema:
        for req in schema["required"]:
            if req not in data:
                errors.append(f"{path}.{req}: missing required field")

    if "properties" in schema:
        for prop, prop_schema in schema["properties"].items():
            if prop not in data:
                continue
            value = data[prop]
            child_path = f"{path}.{prop}" if path else prop

            if "type" in prop_schema:
                expected_types = prop_schema["type"] if isinstance(prop_schema["type"], list) else [prop_schema["type"]]
                if not any(_check_type(value, t) for t in expected_types):
                    errors.append(f"{child_path}: expected {expected_types}, got {type(value).__name__}")
                    continue

            if "const" in prop_schema and value != prop_schema["const"]:
                errors.append(f"{child_path}: expected const {prop_schema['const']!r}, got {value!r}")

            if "enum" in prop_schema and value not in prop_schema["enum"]:
                errors.append(f"{child_path}: value {value!r} not in enum {prop_schema['enum']}")

            if "minimum" in prop_schema and isinstance(value, (int, float)) and value < prop_schema["minimum"]:
                errors.append(f"{child_path}: value {value} < minimum {prop_schema['minimum']}")
            if "maximum" in prop_schema and isinstance(value, (int, float)) and value > prop_schema["maximum"]:
                errors.append(f"{child_path}: value {value} > maximum {prop_schema['maximum']}")

            if "minProperties" in prop_schema and isinstance(value, dict):
                if len(value) < prop_schema["minProperties"]:
                    errors.append(f"{child_path}: only {len(value)} properties, minimum {prop_schema['minProperties']}")

            if "minItems" in prop_schema and isinstance(value, list):
                if len(value) < prop_schema["minItems"]:
                    errors.append(f"{child_path}: only {len(value)} items, minimum {prop_schema['minItems']}")

            # Recurse into objects
            if isinstance(value, dict) and "properties" in prop_schema:
                errors.extend(validate_schema(value, prop_schema, child_path))

            if "additionalProperties" in prop_schema and isinstance(value, dict):
                ap = prop_schema["additionalProperties"]
                if isinstance(ap, dict):  # schema for additional values
                    for k, v in value.items():
                        if "properties" in prop_schema and k in prop_schema["properties"]:
                            continue
                        if isinstance(v, dict):
                            errors.extend(validate_schema(v, ap, f"{child_path}.{k}"))

    return errors


def validate_against_schema_file(data: dict, schema_filename: str) -> list[str]:
    schema = json.loads((SCHEMAS_DIR / schema_filename).read_text())
    return validate_schema(data, schema)


# ──────────────────────────────────────────────────────────────────────────
# Freshness checks
# ──────────────────────────────────────────────────────────────────────────


def check_factor_freshness(factor_panel: dict, today: datetime | None = None) -> list[dict]:
    """For each factor, check that the last observation is within expected_lag_days
    of today. Returns list of warning/error dicts."""
    if today is None:
        today = datetime.now(timezone.utc)
    issues = []
    for name, meta in factor_panel.get("factors", {}).items():
        points = meta.get("points", [])
        if not points:
            issues.append({"severity": "error", "factor": name, "issue": "no points"})
            continue
        last_date_str = points[-1][0]
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        lag_days = (today - last_date).days
        threshold = meta.get("expected_lag_days", 7)
        if lag_days > threshold * 2:
            issues.append({
                "severity": "error", "factor": name,
                "issue": f"stale: last observation {last_date_str} ({lag_days}d ago), threshold {threshold}d × 2"
            })
        elif lag_days > threshold:
            issues.append({
                "severity": "warning", "factor": name,
                "issue": f"slightly stale: last observation {last_date_str} ({lag_days}d ago), threshold {threshold}d"
            })
    return issues


def check_price_freshness(price_panel: dict, today: datetime | None = None) -> list[dict]:
    """ETF prices should be ≤ 5 days stale (covers weekends + 1 business day)."""
    if today is None:
        today = datetime.now(timezone.utc)
    issues = []
    for ticker, meta in price_panel.get("tickers", {}).items():
        last = datetime.strptime(meta["last_observation"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        lag_days = (today - last).days
        if lag_days > 7:
            issues.append({"severity": "error", "ticker": ticker, "issue": f"stale {lag_days}d"})
        elif lag_days > 5:
            issues.append({"severity": "warning", "ticker": ticker, "issue": f"stale {lag_days}d"})
    return issues


# ──────────────────────────────────────────────────────────────────────────
# Sanity checks
# ──────────────────────────────────────────────────────────────────────────


def check_factor_sanity(factor_panel: dict) -> list[dict]:
    """Check each factor's recent values against its declared min/max range."""
    issues = []
    for name, meta in factor_panel.get("factors", {}).items():
        points = meta.get("points", [])
        if not points:
            continue
        min_v = meta.get("min_value")
        max_v = meta.get("max_value")
        # Check the last 30 observations for out-of-range values
        recent = points[-30:]
        for date_str, value in recent:
            if value is None:
                continue
            if min_v is not None and value < min_v:
                issues.append({"severity": "error", "factor": name,
                               "issue": f"value {value} < min_value {min_v} on {date_str}"})
            if max_v is not None and value > max_v:
                issues.append({"severity": "error", "factor": name,
                               "issue": f"value {value} > max_value {max_v} on {date_str}"})
    return issues


def check_factor_anomaly(factor_panel: dict) -> list[dict]:
    """Flag the latest observation if it's > N std devs from the historical
    distribution of month-over-month changes."""
    issues = []
    for name, meta in factor_panel.get("factors", {}).items():
        points = meta.get("points", [])
        if len(points) < 60:
            continue
        threshold = meta.get("max_mom_zscore", 5.0)
        # Use the last 30 observations as MoM cadence proxy, depending on cadence
        # For daily series, take the diff of the last value vs 30-obs-prior; std over the diffs
        values = np.array([p[1] for p in points if p[1] is not None])
        if len(values) < 60:
            continue
        diffs = np.diff(values)
        if diffs.std() == 0:
            continue
        latest_diff = values[-1] - values[-2] if len(values) >= 2 else 0
        z = abs(latest_diff) / diffs.std()
        if z > threshold:
            issues.append({"severity": "warning", "factor": name,
                           "issue": f"anomaly: latest change |z|={z:.2f} > {threshold}"})
    return issues


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────


def run_validation(run_dir: Path) -> tuple[bool, dict]:
    """Run all validation checks. Returns (passed, report)."""
    report = {
        "validated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "errors": [],
        "warnings": [],
        "checks_run": [],
    }

    # 1. Factor panel — schema + freshness + sanity + anomaly
    factor_panel_path = run_dir / "factor_panel.json"
    if not factor_panel_path.exists():
        report["errors"].append({"check": "schema:factor_panel", "issue": "file missing"})
    else:
        factor_panel = json.loads(factor_panel_path.read_text())
        schema_errors = validate_against_schema_file(factor_panel, "factor_panel.schema.json")
        report["checks_run"].append("schema:factor_panel")
        for err in schema_errors:
            report["errors"].append({"check": "schema:factor_panel", "issue": err})

        for issue in check_factor_freshness(factor_panel):
            target = "errors" if issue["severity"] == "error" else "warnings"
            report[target].append({"check": "freshness", **issue})
        report["checks_run"].append("freshness:factors")

        for issue in check_factor_sanity(factor_panel):
            target = "errors" if issue["severity"] == "error" else "warnings"
            report[target].append({"check": "sanity", **issue})
        report["checks_run"].append("sanity:factors")

        for issue in check_factor_anomaly(factor_panel):
            report["warnings"].append({"check": "anomaly", **issue})
        report["checks_run"].append("anomaly:factors")

    # 2. Price panel — schema + freshness
    price_panel_path = run_dir / "price_panel.json"
    if not price_panel_path.exists():
        report["errors"].append({"check": "schema:price_panel", "issue": "file missing"})
    else:
        price_panel = json.loads(price_panel_path.read_text())
        schema_errors = validate_against_schema_file(price_panel, "price_panel.schema.json")
        report["checks_run"].append("schema:price_panel")
        for err in schema_errors:
            report["errors"].append({"check": "schema:price_panel", "issue": err})
        for issue in check_price_freshness(price_panel):
            target = "errors" if issue["severity"] == "error" else "warnings"
            report[target].append({"check": "freshness", **issue})
        report["checks_run"].append("freshness:prices")

    # 3. SPY holdings — schema (optional file)
    spy_path = run_dir / "spy_holdings.json"
    if spy_path.exists():
        spy_holdings = json.loads(spy_path.read_text())
        schema_errors = validate_against_schema_file(spy_holdings, "spy_holdings.schema.json")
        report["checks_run"].append("schema:spy_holdings")
        for err in schema_errors:
            report["errors"].append({"check": "schema:spy_holdings", "issue": err})
        # Sanity: total weight should be 0.95-1.05
        total = spy_holdings.get("total_weight_check")
        if total is not None and not (0.95 <= total <= 1.05):
            report["warnings"].append({"check": "sanity", "issue": f"SPY total weight {total:.4f} outside 0.95-1.05"})
    else:
        report["warnings"].append({"check": "schema:spy_holdings", "issue": "file missing — fallback expected"})

    # 4. Reference groups
    ref_path = run_dir / "reference_groups.json"
    if not ref_path.exists():
        report["errors"].append({"check": "schema:reference_groups", "issue": "file missing"})
    else:
        ref = json.loads(ref_path.read_text())
        schema_errors = validate_against_schema_file(ref, "industry_group_reference.schema.json")
        report["checks_run"].append("schema:reference_groups")
        for err in schema_errors:
            report["errors"].append({"check": "schema:reference_groups", "issue": err})

    passed = len(report["errors"]) == 0
    report["passed"] = passed
    report["error_count"] = len(report["errors"])
    report["warning_count"] = len(report["warnings"])
    return passed, report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        logger.error(f"run-dir {run_dir} does not exist")
        return 2

    passed, report = run_validation(run_dir)
    (run_dir / "validation_report.json").write_text(json.dumps(report, indent=2))

    logger.info(f"Validation: {'PASSED' if passed else 'FAILED'} "
                f"({report['error_count']} errors, {report['warning_count']} warnings, "
                f"{len(report['checks_run'])} checks)")
    if report["errors"]:
        for e in report["errors"][:10]:
            logger.error(f"  {e}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
