"""Persist lightweight state between scans (e.g. prior scores for collapse alerts)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from config import PROJECT_ROOT

logger = logging.getLogger(__name__)

LAST_SCORES_PATH = PROJECT_ROOT / "portfolio" / ".last_scan_scores.json"


def load_last_scores() -> dict[str, int]:
    """Ticker -> score from the previous successful scan."""
    if not LAST_SCORES_PATH.exists():
        return {}
    try:
        data: Any = json.loads(LAST_SCORES_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        out: dict[str, int] = {}
        for k, v in data.items():
            try:
                out[str(k).upper()] = int(v)
            except (TypeError, ValueError):
                continue
        return out
    except Exception as e:
        logger.warning("Could not read %s: %s", LAST_SCORES_PATH, e)
        return {}


def save_last_scores(scores: dict[str, int]) -> None:
    """Persist scores for all filtered tickers (used next run for score-collapse)."""
    try:
        LAST_SCORES_PATH.parent.mkdir(parents=True, exist_ok=True)
        ordered = {k: scores[k] for k in sorted(scores.keys())}
        LAST_SCORES_PATH.write_text(
            json.dumps(ordered, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning("Could not write %s: %s", LAST_SCORES_PATH, e)
