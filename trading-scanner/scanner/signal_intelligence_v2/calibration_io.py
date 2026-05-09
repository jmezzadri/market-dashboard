"""
Calibration IO — load and save the three calibration JSON files.

The producer (`rollup.compute_signal_intelligence`) reads three calibration
inputs at runtime; this module handles the conversion between the producer's
in-memory dict shapes and the on-disk JSON shapes pinned in `public/`.

The three files (per spec E):

    public/calibration_v2_magnitude_to_excess_return.json
        — Magnitude → mean 21-day excess return curve

    public/calibration_v2_conviction_table.json
        — 2-D (Agreement × |Magnitude|) → hit rate table

    public/calibration_v2_bands.json
        — Per-band stats (population %, mean excess, hit rate)

Initial values shipped match `PLACEHOLDER_*` in rollup.py so the producer
can run end-to-end before the back-test produces real numbers. Phase 9.5
backfills UW historical data; once that lands, `scripts/run_backtest_v2.py`
can replace these with real values nightly.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scanner.signal_intelligence_v2.rollup import (
    BAND_CUTOFFS,
    PLACEHOLDER_CONVICTION_TABLE,
    PLACEHOLDER_EXCESS_RETURN_CURVE,
)

CALIBRATION_FILENAMES: dict[str, str] = {
    "excess_return": "calibration_v2_magnitude_to_excess_return.json",
    "conviction":    "calibration_v2_conviction_table.json",
    "bands":         "calibration_v2_bands.json",
}


# ─────────────────────────────────────────────────────────────────────────────
# Serialization (in-memory → JSON dict)
# ─────────────────────────────────────────────────────────────────────────────


def excess_return_curve_to_json(
    curve: list[tuple[int, float]],
    source: str = "placeholder",
    n_obs_lookup: dict[int, int] | None = None,
) -> dict[str, Any]:
    """Convert an in-memory excess curve to JSON dict shape."""
    rows = []
    for mag, excess_pct in sorted(curve):
        rows.append({
            "magnitude_center": int(mag),
            "mean_excess_pct": float(excess_pct),
            "n_obs": int((n_obs_lookup or {}).get(mag, 0)),
        })
    return {
        "schema_version": 1,
        "source": source,
        "description": "Magnitude bucket center → mean historical 21-day excess return vs SPY (in %).",
        "rows": rows,
    }


def conviction_table_to_json(
    table: dict[int, list[tuple[int, float]]],
    source: str = "placeholder",
    n_obs_lookup: dict[tuple[int, int], int] | None = None,
) -> dict[str, Any]:
    """Convert an in-memory 2-D conviction table to JSON dict shape."""
    agreement_buckets = []
    for agr in sorted(table.keys(), reverse=True):
        rows = []
        for abs_mag, hit_rate_pct in sorted(table[agr]):
            rows.append({
                "abs_magnitude": int(abs_mag),
                "hit_rate_pct": float(hit_rate_pct),
                "n_obs": int((n_obs_lookup or {}).get((agr, abs_mag), 0)),
            })
        agreement_buckets.append({
            "agreement_pct": int(agr),
            "rows": rows,
        })
    return {
        "schema_version": 1,
        "source": source,
        "description": (
            "(Agreement %, |Magnitude|) → empirical hit rate (%) of beating SPY "
            "in the predicted direction over 21 days."
        ),
        "agreement_buckets": agreement_buckets,
    }


def bands_to_json(
    band_stats: list[dict[str, Any]] | None = None,
    source: str = "placeholder",
) -> dict[str, Any]:
    """Convert per-band stats to JSON dict shape, defaulting to empty stats."""
    bands = []
    # BAND_CUTOFFS is [(threshold, label), ...] sorted descending
    sorted_cutoffs = sorted(BAND_CUTOFFS, reverse=True)
    for i, (threshold, label) in enumerate(sorted_cutoffs):
        next_threshold = sorted_cutoffs[i + 1][0] if i + 1 < len(sorted_cutoffs) else -100
        # Pull stats if provided
        stat_row = next(
            (s for s in (band_stats or []) if s.get("band") == label),
            None,
        )
        bands.append({
            "label": label,
            "min_score": int(threshold) if threshold > -101 else -100,
            "max_score": 100 if i == 0 else int(sorted_cutoffs[i - 1][0]),
            "n_obs": int(stat_row.get("n_obs", 0)) if stat_row else 0,
            "population_pct": float(stat_row.get("population_pct", 0.0)) if stat_row else 0.0,
            "mean_excess_pct": float(stat_row.get("mean_excess_pct", 0.0)) if stat_row else 0.0,
            "hit_rate_pct": float(stat_row.get("hit_rate_pct", 0.0)) if stat_row else 0.0,
        })
    return {
        "schema_version": 1,
        "source": source,
        "description": (
            "8-band classifier on MT Score, with per-band historical population %, "
            "mean 21-day excess return, and hit rate (% beat SPY in predicted direction)."
        ),
        "bands": bands,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Deserialization (JSON dict → in-memory shapes the producer consumes)
# ─────────────────────────────────────────────────────────────────────────────


def excess_return_curve_from_json(doc: dict[str, Any]) -> list[tuple[int, float]]:
    return [(int(r["magnitude_center"]), float(r["mean_excess_pct"])) for r in doc["rows"]]


def conviction_table_from_json(doc: dict[str, Any]) -> dict[int, list[tuple[int, float]]]:
    table: dict[int, list[tuple[int, float]]] = {}
    for ab in doc["agreement_buckets"]:
        table[int(ab["agreement_pct"])] = [
            (int(r["abs_magnitude"]), float(r["hit_rate_pct"]))
            for r in ab["rows"]
        ]
    return table


# ─────────────────────────────────────────────────────────────────────────────
# Disk IO
# ─────────────────────────────────────────────────────────────────────────────


def write_calibration_files(
    out_dir: Path | str,
    excess_curve: list[tuple[int, float]] | None = None,
    conviction_table: dict[int, list[tuple[int, float]]] | None = None,
    band_stats: list[dict[str, Any]] | None = None,
    source: str = "placeholder",
) -> dict[str, str]:
    """
    Write all three calibration JSONs to `out_dir`.

    Defaults to the placeholder values in rollup.py — useful for
    bootstrapping the producer + UI before real back-test data exists.

    Returns: {"excess_return": <path>, "conviction": <path>, "bands": <path>}
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    excess_curve = excess_curve or PLACEHOLDER_EXCESS_RETURN_CURVE
    conviction_table = conviction_table or PLACEHOLDER_CONVICTION_TABLE

    paths: dict[str, str] = {}

    excess_path = out / CALIBRATION_FILENAMES["excess_return"]
    excess_path.write_text(json.dumps(
        excess_return_curve_to_json(excess_curve, source=source),
        indent=2,
    ))
    paths["excess_return"] = str(excess_path)

    conviction_path = out / CALIBRATION_FILENAMES["conviction"]
    conviction_path.write_text(json.dumps(
        conviction_table_to_json(conviction_table, source=source),
        indent=2,
    ))
    paths["conviction"] = str(conviction_path)

    bands_path = out / CALIBRATION_FILENAMES["bands"]
    bands_path.write_text(json.dumps(
        bands_to_json(band_stats=band_stats, source=source),
        indent=2,
    ))
    paths["bands"] = str(bands_path)

    return paths


def load_calibration_from_dir(in_dir: Path | str) -> dict[str, Any]:
    """
    Load all three calibration JSONs from a directory.

    Returns:
        {
            "excess_return_curve": list[tuple[int, float]],
            "conviction_table":    dict[int, list[tuple[int, float]]],
            "bands_doc":           dict (full JSON for band stats — UI consumes raw),
            "metadata":            {file: {"source": str, "schema_version": int}},
        }
    """
    inp = Path(in_dir)
    metadata: dict[str, dict[str, Any]] = {}

    excess_doc = json.loads((inp / CALIBRATION_FILENAMES["excess_return"]).read_text())
    metadata["excess_return"] = {
        "source": excess_doc.get("source"),
        "schema_version": excess_doc.get("schema_version"),
    }

    conv_doc = json.loads((inp / CALIBRATION_FILENAMES["conviction"]).read_text())
    metadata["conviction"] = {
        "source": conv_doc.get("source"),
        "schema_version": conv_doc.get("schema_version"),
    }

    bands_doc = json.loads((inp / CALIBRATION_FILENAMES["bands"]).read_text())
    metadata["bands"] = {
        "source": bands_doc.get("source"),
        "schema_version": bands_doc.get("schema_version"),
    }

    return {
        "excess_return_curve": excess_return_curve_from_json(excess_doc),
        "conviction_table": conviction_table_from_json(conv_doc),
        "bands_doc": bands_doc,
        "metadata": metadata,
    }
