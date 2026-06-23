"""Resilient Supabase Management-API query helper for the paper module.

The Management API query endpoint (api.supabase.com/.../database/query)
intermittently times out or returns 5xx. A single 30s attempt was crashing
live rebalances. This helper uses a longer timeout and bounded retry so a
transient blip no longer aborts the run.
"""
from __future__ import annotations

import os
import time
from typing import Any

import requests

PROJECT_REF = "yqaqqzseepebrocgibcw"
_RETRY_STATUS = (429, 500, 502, 503, 504)


def sb_query(sql: str, token: str | None = None, timeout: int = 90,
             tries: int = 5) -> list[dict[str, Any]]:
    token = token or os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set.")
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    last_exc: Exception | None = None
    for attempt in range(tries):
        try:
            resp = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
                json={"query": sql},
                timeout=timeout,
            )
            if resp.status_code in _RETRY_STATUS:
                last_exc = requests.exceptions.HTTPError(
                    f"{resp.status_code} from Supabase query endpoint", response=resp)
                time.sleep(2 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_exc = exc
            time.sleep(2 * (attempt + 1))
    raise last_exc if last_exc else RuntimeError("Supabase query failed")
