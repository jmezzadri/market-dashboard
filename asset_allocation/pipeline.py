"""
asset_allocation/pipeline.py — full pipeline orchestrator.

Runs all six layers in sequence with proper error handling, logging, and
state tracking:

  L1 acquisition    → factor_panel + price_panel + spy_holdings + reference
  L2 validation     → schema + freshness + sanity + anomaly
  L3 compute        → ratings + stance + selected picks + benchmark
  L4 state          → append history, attach MoM/QoQ deltas
  L5 output         → schema-validated UI JSON
  L6 narrative      → fill rationale, themes, risk scenarios

Either everything runs cleanly or the run fails and last-known-good stays
live in production. No partial-state shipments.

Modes:
  --mode weekly  — full pipeline, writes public/v10_allocation.json
  --mode watch   — lighter run, refreshes regime only, writes regime_alert.json

Usage:
  python -m asset_allocation.pipeline --mode weekly --run-dir runs/2026-04-26
  python -m asset_allocation.pipeline --mode watch  --run-dir runs/2026-04-29
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import traceback
import uuid
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"
HISTORY_DIR = PUBLIC_DIR / "allocation_history"
RUN_LOG_PATH = REPO_ROOT / "asset_allocation" / "run_log.jsonl"
PUBLIC_OUTPUT_PATH = PUBLIC_DIR / "v10_allocation.json"
REGIME_ALERT_PATH = PUBLIC_DIR / "v10_regime_alert.json"


# ──────────────────────────────────────────────────────────────────────────
# Run tracking
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class PipelineRun:
    run_id: str
    mode: str
    started_at: str
    run_dir: Path
    layers_completed: list[str] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    finished_at: str | None = None
    exit_status: str = "in_progress"

    def log_layer_start(self, layer: str):
        logger.info(f"[{self.run_id}] {layer.upper()} starting")

    def log_layer_complete(self, layer: str, summary: str = ""):
        self.layers_completed.append(layer)
        logger.info(f"[{self.run_id}] {layer.upper()} complete {summary}")

    def log_warning(self, layer: str, msg: str):
        self.warnings.append({"layer": layer, "message": msg,
                              "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        logger.warning(f"[{self.run_id}] WARN  {layer}: {msg}")

    def log_error(self, layer: str, msg: str, exc: Exception | None = None):
        entry = {"layer": layer, "message": msg,
                 "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if exc:
            entry["exception_type"] = type(exc).__name__
            entry["traceback"] = traceback.format_exc(limit=10)
        self.errors.append(entry)
        logger.error(f"[{self.run_id}] ERROR {layer}: {msg}")

    def finalize(self):
        self.finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if self.errors:
            self.exit_status = "failed"
        elif self.warnings:
            self.exit_status = "completed_with_warnings"
        else:
            self.exit_status = "success"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["run_dir"] = str(d["run_dir"])
        return d


# ──────────────────────────────────────────────────────────────────────────
# Run log (append-only JSONL)
# ──────────────────────────────────────────────────────────────────────────


def append_run_log(run: PipelineRun, log_path: Path = RUN_LOG_PATH):
    """Append a single run's metadata to the JSONL run history."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(run.to_dict()) + "\n"
    with log_path.open("a") as f:
        f.write(line)


def load_recent_runs(log_path: Path = RUN_LOG_PATH, limit: int = 30) -> list[dict]:
    """Read the last N runs from the JSONL log."""
    if not log_path.exists():
        return []
    lines = log_path.read_text().splitlines()
    return [json.loads(l) for l in lines[-limit:] if l.strip()]


# ──────────────────────────────────────────────────────────────────────────
# Weekly pipeline
# ──────────────────────────────────────────────────────────────────────────


def run_weekly(run: PipelineRun) -> bool:
    """Execute the full weekly pipeline. Returns True on success.

    Each layer is wrapped so an exception in one layer halts subsequent
    layers (no partial-state shipping) but is logged for observability."""
    from asset_allocation.acquisition import (
        acquire_factor_panel, acquire_price_panel, acquire_spy_holdings,
        load_industry_groups, AcquisitionRun,
    )
    from asset_allocation.validation import run_validation
    from asset_allocation.compute import compute_allocation
    from asset_allocation.state import attach_state
    from asset_allocation.output import shape_for_ui
    from asset_allocation.validation import validate_against_schema_file
    from asset_allocation.narrative.engine import (
        latest_factor_readings, fill_narrative,
    )

    run.run_dir.mkdir(parents=True, exist_ok=True)

    # L1 — Acquisition
    run.log_layer_start("acquisition")
    try:
        acq_run = AcquisitionRun(
            run_id=run.run_id,
            start_time=run.started_at,
            run_dir=run.run_dir,
        )
        factor_panel = acquire_factor_panel(acq_run)
        (run.run_dir / "factor_panel.json").write_text(json.dumps(factor_panel, indent=2))
        price_panel = acquire_price_panel(acq_run)
        (run.run_dir / "price_panel.json").write_text(json.dumps(price_panel, indent=2))
        spy_holdings = acquire_spy_holdings(acq_run)
        if spy_holdings:
            (run.run_dir / "spy_holdings.json").write_text(json.dumps(spy_holdings, indent=2))
        else:
            run.log_warning("acquisition", "spy_holdings unavailable; downstream uses fallback")
        reference = load_industry_groups()
        (run.run_dir / "reference_groups.json").write_text(json.dumps(reference, indent=2))
        # Carry over per-step warnings + failures from the AcquisitionRun
        for w in acq_run.warnings:
            run.log_warning("acquisition", f"{w['name']}: {w['detail']}")
        for f in acq_run.failures:
            run.log_error("acquisition", f"{f['name']}: {f['detail']}")
        if acq_run.failures and not acq_run.successes:
            return False
        run.log_layer_complete("acquisition",
                               f"{len(acq_run.successes)} ok, {len(acq_run.warnings)} warn, "
                               f"{len(acq_run.failures)} fail")
    except Exception as exc:
        run.log_error("acquisition", "unhandled exception", exc)
        return False

    # L2 — Validation
    run.log_layer_start("validation")
    try:
        passed, report = run_validation(run.run_dir)
        (run.run_dir / "validation_report.json").write_text(json.dumps(report, indent=2))
        for w in report.get("warnings", []):
            run.log_warning("validation", str(w))
        for e in report.get("errors", []):
            run.log_error("validation", str(e))
        if not passed:
            return False
        run.log_layer_complete("validation",
                               f"{report['error_count']} errors, {report['warning_count']} warnings, "
                               f"{len(report['checks_run'])} checks")
    except Exception as exc:
        run.log_error("validation", "unhandled exception", exc)
        return False

    # L3 — Compute
    run.log_layer_start("compute")
    try:
        allocation = compute_allocation(run.run_dir)
        (run.run_dir / "allocation.json").write_text(json.dumps(allocation, indent=2))
        n_picks = sum(1 for r in allocation["ratings"] if r["is_picked"])
        n_most_favored = sum(1 for r in allocation["ratings"] if r["rating"] == "Most Favored")
        run.log_layer_complete("compute",
                               f"stance={allocation['stance']['label']}, "
                               f"alpha={allocation['alpha']:.3f}, "
                               f"picks={n_picks}, most_favored={n_most_favored}")
    except Exception as exc:
        run.log_error("compute", "unhandled exception", exc)
        return False

    # L4 — State (append history, attach deltas)
    run.log_layer_start("state")
    try:
        allocation = attach_state(allocation, HISTORY_DIR)
        (run.run_dir / "allocation_with_state.json").write_text(json.dumps(allocation, indent=2))
        n_deltas = len(allocation.get("what_changed", {}).get("vs_last_rebalance", []))
        run.log_layer_complete("state", f"{n_deltas} deltas vs last rebalance")
    except Exception as exc:
        run.log_error("state", "unhandled exception", exc)
        return False

    # L5 — Output (schema-validated UI JSON)
    run.log_layer_start("output")
    try:
        validation_report = json.loads((run.run_dir / "validation_report.json").read_text())
        ui_output = shape_for_ui(allocation, validation_report)
        schema_errors = validate_against_schema_file(ui_output, "allocation_output.schema.json")
        if schema_errors:
            for err in schema_errors[:10]:
                run.log_error("output", f"schema: {err}")
            return False
        (run.run_dir / "v10_allocation.json").write_text(json.dumps(ui_output, indent=2))
        run.log_layer_complete("output", f"{len(ui_output)} top-level fields")
    except Exception as exc:
        run.log_error("output", "unhandled exception", exc)
        return False

    # L6 — Narrative (fill the empty fields)
    run.log_layer_start("narrative")
    try:
        factor_readings = latest_factor_readings(factor_panel)
        enriched = fill_narrative(ui_output, factor_readings)
        # Re-validate after narrative fill
        schema_errors = validate_against_schema_file(enriched, "allocation_output.schema.json")
        if schema_errors:
            for err in schema_errors[:10]:
                run.log_error("narrative", f"post-fill schema: {err}")
            return False
        (run.run_dir / "v10_allocation.json").write_text(json.dumps(enriched, indent=2))

        # Publish to public/
        PUBLIC_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        PUBLIC_OUTPUT_PATH.write_text(json.dumps(enriched, indent=2))

        n_themes = len(enriched.get("themes", []))
        n_risks = len(enriched.get("risk_scenarios", []))
        run.log_layer_complete("narrative", f"{n_themes} themes, {n_risks} risks")
    except Exception as exc:
        run.log_error("narrative", "unhandled exception", exc)
        return False

    # Anomaly detection (post-pipeline, doesn't halt)
    try:
        from asset_allocation.monitoring.anomaly import detect_anomalies
        prior = _load_prior_published()
        anomalies = detect_anomalies(enriched, prior)
        if anomalies:
            for a in anomalies:
                run.log_warning("anomaly", f"{a['type']}: {a['description']}")
        (run.run_dir / "anomaly_report.json").write_text(json.dumps({"anomalies": anomalies}, indent=2))
    except Exception as exc:
        run.log_warning("anomaly", f"anomaly detection failed: {exc}")

    return True


# ──────────────────────────────────────────────────────────────────────────
# Daily watch (regime check only)
# ──────────────────────────────────────────────────────────────────────────


def run_watch(run: PipelineRun) -> bool:
    """Lightweight daily run — refreshes composite values and flags if regime
    has shifted meaningfully since last weekly rebalance.

    Does NOT modify the allocation. Writes regime_alert.json that the UI can
    surface as a banner."""
    from asset_allocation.acquisition import (
        acquire_factor_panel, AcquisitionRun,
    )

    run.run_dir.mkdir(parents=True, exist_ok=True)

    run.log_layer_start("watch:acquire")
    try:
        acq_run = AcquisitionRun(run_id=run.run_id, start_time=run.started_at, run_dir=run.run_dir)
        factor_panel = acquire_factor_panel(acq_run)
        (run.run_dir / "factor_panel.json").write_text(json.dumps(factor_panel, indent=2))
        for w in acq_run.warnings:
            run.log_warning("watch", f"{w['name']}: {w['detail']}")
        for f in acq_run.failures:
            run.log_error("watch", f"{f['name']}: {f['detail']}")
        if acq_run.failures and not acq_run.successes:
            return False
        run.log_layer_complete("watch:acquire")
    except Exception as exc:
        run.log_error("watch", "factor pull failed", exc)
        return False

    # Compare current composite reading to what was published in the last
    # weekly run
    run.log_layer_start("watch:compare")
    try:
        prior = _load_prior_published()
        if prior is None:
            run.log_warning("watch", "no prior published allocation — nothing to compare against")
            REGIME_ALERT_PATH.write_text(json.dumps({"alert_active": False}, indent=2))
            run.log_layer_complete("watch:compare")
            return True

        # Load current composites from composite_history_daily.json
        comp_path = PUBLIC_DIR / "composite_history_daily.json"
        if not comp_path.exists():
            run.log_warning("watch", "composite_history_daily.json not found — skipping regime check")
            return True
        comps = json.loads(comp_path.read_text())
        latest_comp = comps[-1] if comps else None
        if latest_comp is None:
            return True

        current_rl = float(latest_comp.get("RL", 0))
        published_rl = prior.get("regime", {}).get("risk_liquidity", {}).get("value", 0)
        if isinstance(published_rl, dict):
            published_rl = published_rl.get("value", 0)
        rl_delta = current_rl - published_rl

        alert_active = abs(rl_delta) > 15
        alert = {
            "alert_active": alert_active,
            "current_rl": current_rl,
            "rl_at_last_rebalance": published_rl,
            "rl_delta_since_rebalance": rl_delta,
            "last_rebalance": prior.get("as_of"),
            "as_of": latest_comp.get("d"),
            "narrative": (
                f"Risk & Liquidity composite has moved {rl_delta:+.1f} points since "
                f"last rebalance ({prior.get('as_of')}). Allocation may need review at "
                f"next weekly rebalance."
            ) if alert_active else None,
        }
        REGIME_ALERT_PATH.write_text(json.dumps(alert, indent=2))
        run.log_layer_complete("watch:compare", f"rl_delta={rl_delta:+.1f}, alert_active={alert_active}")
        return True
    except Exception as exc:
        run.log_error("watch:compare", "unhandled exception", exc)
        return False


def _load_prior_published() -> dict | None:
    if not PUBLIC_OUTPUT_PATH.exists():
        return None
    try:
        return json.loads(PUBLIC_OUTPUT_PATH.read_text())
    except json.JSONDecodeError:
        return None


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", required=True, choices=["weekly", "watch"])
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level),
                        format="%(asctime)s [%(levelname)s] %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")

    run = PipelineRun(
        run_id=str(uuid.uuid4())[:8],
        mode=args.mode,
        started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        run_dir=Path(args.run_dir),
    )
    logger.info(f"=== Pipeline run {run.run_id} ({args.mode}) → {run.run_dir} ===")

    if args.mode == "weekly":
        success = run_weekly(run)
    else:
        success = run_watch(run)

    run.finalize()
    append_run_log(run)
    (run.run_dir / "pipeline_run.json").write_text(json.dumps(run.to_dict(), indent=2))
    logger.info(f"=== Run {run.run_id} {run.exit_status} "
                f"({len(run.warnings)} warnings, {len(run.errors)} errors) ===")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
