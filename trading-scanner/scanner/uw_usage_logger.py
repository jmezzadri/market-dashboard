"""UW API rate-limit logger.

Purpose
-------
Every scheduled scanner run should answer "how much of the UW daily budget
did I burn?" and "did I ever get close to the per-minute ceiling?". This
utility wraps the UW HTTP client with bookkeeping that:

  - Captures X-RateLimit-Remaining / -Limit / -Reset headers on every call
  - Counts calls per (source, endpoint)
  - Tracks peak RPM by bucketing timestamps into 60-second windows
  - Flushes one row per (run_id, source) to public.api_usage_log at exit

The logger is an OPTIONAL layer — callers that don't care can use plain
requests.get as before. ticker_events.py, universe_snapshot.py, and the
daily scanner all opt in.

Usage
-----
    from scanner.uw_usage_logger import UWUsageLogger

    with UWUsageLogger(source="ticker_events") as logger:
        r = logger.get("/api/news/headlines", params={"limit": 100})
        ...
    # On __exit__, one row flushed to public.api_usage_log.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

UW_BASE_URL = "https://api.unusualwhales.com"
DEFAULT_TIMEOUT = 60
MAX_RETRIES = 3
RETRY_BACKOFF = (1.0, 2.0, 4.0)


def _headers() -> dict[str, str]:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY")
    if not key:
        raise RuntimeError("UNUSUAL_WHALES_API_KEY not set")
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _coerce_int_header(v: str | None) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class UWUsageLogger:
    """Context manager that wraps UW HTTP calls and records usage.

    Attributes captured per call:
      - endpoint path (e.g. "/api/news/headlines")
      - response status
      - rate-limit headers at response time

    On exit:
      - Computes peak RPM across all call timestamps
      - Takes the final X-RateLimit-Remaining as the run's residual budget
      - Upserts one row per (run_id, source) to public.api_usage_log
    """

    def __init__(
        self,
        source: str,
        *,
        run_id: uuid.UUID | None = None,
        flush_to_db: bool = True,
    ):
        self.source = source
        self.run_id = run_id or uuid.uuid4()
        self.flush_to_db = flush_to_db

        self.started_at = datetime.now(timezone.utc)
        self.completed_at: datetime | None = None
        self.status: str = "success"

        self.calls: list[tuple[float, str, int]] = []  # (monotonic_ts, endpoint, status_code)
        self.endpoint_counts: dict[str, int] = {}
        self.last_remaining: int | None = None
        self.last_limit: int | None = None
        self.last_reset_epoch: int | None = None
        self.errors: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------
    def __enter__(self) -> "UWUsageLogger":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.completed_at = datetime.now(timezone.utc)
        if exc_type is not None:
            self.status = "failed"
            self.errors.append({"type": str(exc_type.__name__), "message": str(exc)[:500]})

        if self.flush_to_db:
            try:
                self._flush()
            except Exception as flush_exc:
                # Never let logger failure mask the real exception.
                logger.warning("UWUsageLogger flush failed: %s", flush_exc)

    # ------------------------------------------------------------------
    # HTTP
    # ------------------------------------------------------------------
    def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> requests.Response:
        """GET with retries, header capture, and call bookkeeping.

        Raises requests.RequestException on unrecoverable failure after
        MAX_RETRIES. Returns the Response (caller inspects .json() etc.).
        """
        url = path if path.startswith("http") else f"{UW_BASE_URL}{path}"
        last_exc: Exception | None = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = requests.get(url, headers=_headers(), params=params, timeout=timeout)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                    continue
                self.errors.append({"path": path, "network_error": str(exc)})
                raise

            self._record_call(path, resp)

            if resp.status_code == 429 and attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning(
                    "UW %s 429 — retry %d/%d after %.0fs (remaining=%s)",
                    path, attempt + 1, MAX_RETRIES, wait, self.last_remaining,
                )
                time.sleep(wait)
                continue

            if 500 <= resp.status_code < 600 and attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning(
                    "UW %s %d — retry %d/%d after %.0fs",
                    path, resp.status_code, attempt + 1, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                continue

            if not resp.ok:
                self.errors.append({"path": path, "status": resp.status_code})
            return resp

        if last_exc:
            raise last_exc
        raise RuntimeError(f"UW request to {path} exhausted retries without response")

    # ------------------------------------------------------------------
    # Bookkeeping
    # ------------------------------------------------------------------
    def _record_call(self, path: str, resp: requests.Response) -> None:
        self.calls.append((time.monotonic(), path, resp.status_code))
        self.endpoint_counts[path] = self.endpoint_counts.get(path, 0) + 1

        # UW uses standard X-RateLimit-* headers. Take the latest values —
        # the final call's residual is what we'd quote to the user.
        rem = _coerce_int_header(resp.headers.get("X-RateLimit-Remaining"))
        lim = _coerce_int_header(resp.headers.get("X-RateLimit-Limit"))
        reset = _coerce_int_header(resp.headers.get("X-RateLimit-Reset"))
        if rem is not None:
            self.last_remaining = rem
        if lim is not None:
            self.last_limit = lim
        if reset is not None:
            self.last_reset_epoch = reset

    def _peak_rpm(self) -> float:
        """Peak calls-per-minute observed during the run.

        Slides a 60-second window across the call timestamps and returns
        the maximum count. Uses monotonic clock (immune to wall-clock
        adjustments).
        """
        if not self.calls:
            return 0.0
        times = sorted(t for t, _p, _s in self.calls)
        best = 0
        j = 0
        for i in range(len(times)):
            while j < len(times) and times[j] - times[i] <= 60.0:
                j += 1
            window_count = j - i
            if window_count > best:
                best = window_count
        return float(best)

    # ------------------------------------------------------------------
    # Flush
    # ------------------------------------------------------------------
    def _flush(self) -> None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            logger.info("UWUsageLogger: SUPABASE_URL/KEY not set — skipping flush")
            return

        try:
            from supabase import create_client  # type: ignore
        except ImportError:
            logger.warning("UWUsageLogger: supabase-py not installed — skipping flush")
            return

        duration = (self.completed_at - self.started_at).total_seconds() if self.completed_at else None
        row = {
            "run_id":            str(self.run_id),
            "source":            self.source,
            "endpoint":          None,  # aggregate row; per-endpoint breakdown in notes
            "calls_made":        len(self.calls),
            "remaining_daily":   self.last_remaining,
            "limit_daily":       self.last_limit,
            "peak_rpm":          self._peak_rpm(),
            "started_at":        self.started_at.isoformat(),
            "completed_at":      (self.completed_at or datetime.now(timezone.utc)).isoformat(),
            "duration_seconds":  round(duration, 2) if duration is not None else None,
            "status":            self.status,
            "notes": {
                "endpoint_counts": self.endpoint_counts,
                "reset_epoch":     self.last_reset_epoch,
                "errors":          self.errors[:20],  # cap to keep jsonb tidy
            },
        }
        client = create_client(url, key)
        client.table("api_usage_log").insert(row).execute()
        logger.info(
            "UWUsageLogger flushed: source=%s calls=%d remaining=%s peak_rpm=%.0f status=%s",
            self.source, len(self.calls), self.last_remaining, row["peak_rpm"], self.status,
        )
