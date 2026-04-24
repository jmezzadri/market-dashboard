"""Lightweight api_usage_log helper for workflows that don't need the full
UWUsageLogger context manager.

Bug #1032: three scheduled workflows — the daily scanner (main.py intraday),
the 3x/weekday universe snapshot, and the indicator-refresh — were calling
UW / FRED APIs without writing a row to public.api_usage_log. The admin API
Usage bar chart therefore had only ticker_events to plot.

This module exposes a single function `log_run_summary(...)` that posts one
row to public.api_usage_log via PostgREST. Safe to import from any Python
process with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
Never raises; failures are logged and swallowed so a flaky logger never
fails a scheduled run.
"""

from __future__ import annotations

import json
import logging
import os
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)


def log_run_summary(
    *,
    source: str,
    run_id: str | _uuid.UUID | None = None,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    calls_made: int | None = None,
    status: str = "success",
    notes: dict[str, Any] | None = None,
    endpoint: str | None = None,
    peak_rpm: float | None = None,
    limit_daily: int | None = None,
    remaining_daily: int | None = None,
) -> bool:
    """Insert one aggregate row into public.api_usage_log.

    Returns True on success, False if env isn't configured or the insert
    fails. Never raises.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.info("api_usage_helper: SUPABASE_URL/KEY not set — skipping")
        return False

    now = datetime.now(timezone.utc)
    row: dict[str, Any] = {
        "run_id": str(run_id or _uuid.uuid4()),
        "source": source,
        "endpoint": endpoint,
        "calls_made": calls_made,
        "started_at": (started_at or now).isoformat(),
        "completed_at": (completed_at or now).isoformat(),
        "status": status,
        "notes": notes or {},
    }
    if peak_rpm is not None:
        row["peak_rpm"] = peak_rpm
    if limit_daily is not None:
        row["limit_daily"] = limit_daily
    if remaining_daily is not None:
        row["remaining_daily"] = remaining_daily
    duration = None
    if started_at and completed_at:
        duration = (completed_at - started_at).total_seconds()
    elif started_at:
        duration = (now - started_at).total_seconds()
    if duration is not None:
        row["duration_seconds"] = round(duration, 2)

    try:
        r = requests.post(
            f"{url}/rest/v1/api_usage_log",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            data=json.dumps(row),
            timeout=30,
        )
        if r.status_code >= 300:
            logger.warning(
                "api_usage_helper insert failed status=%d body=%s",
                r.status_code, r.text[:200],
            )
            return False
        logger.info(
            "api_usage_helper logged: source=%s calls=%s status=%s",
            source, calls_made, status,
        )
        return True
    except Exception as exc:  # pragma: no cover — swallow everything
        logger.warning("api_usage_helper insert raised: %s", exc)
        return False
