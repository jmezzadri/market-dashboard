"""log_pipeline_run.py — append a row to public.pipeline_fetch_log from any
recompute / aggregate Python script.

Phase 4 PR #15 (2026-05-01). Lead Developer + Data Steward sign-off.

Usage
─────
    from log_pipeline_run import log_pipeline_run
    log_pipeline_run(
        indicator_id="composite-rl-daily",
        status="green",
        run_kind="aggregate",
        run_duration_ms=1234,
        meta={"rows_written": 1500, "as_of": "2026-05-01"},
    )

Why this exists
───────────────
The Supabase edge function (pipeline-health-check) writes a row to
pipeline_fetch_log every 30 minutes for every ATOMIC element. But aggregate
elements (composite-rl/gr/ir, scenario-v9_allocation, etc.) are produced by
Python recompute jobs. Their "did the calc actually run today?" status is
INVISIBLE to the edge function — all it sees is the resulting JSON file's
asOf timestamp, which gives stale-input detection but not calc-failed
detection. Aggregate-level chips need both.

This helper closes that gap: every recompute job calls it once at end-of-run
(success or failure) and writes its own pipeline_fetch_log row. The
pipeline panel (PR #17) then shows the last 7 calc attempts alongside the
last 7 atomic fetches, both rendered the same way.

Auth: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env (already in
all GH Actions workflows that run recompute jobs). Falls back to silent
no-op if either is missing — never blocks a recompute over a logging
failure.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import Any, Optional


def log_pipeline_run(
    indicator_id: str,
    status: str,
    run_kind: str = "aggregate",
    age_minutes: Optional[int] = None,
    last_value: Any = None,
    error_message: Optional[str] = None,
    source: Optional[str] = None,
    run_duration_ms: Optional[int] = None,
    meta: Optional[dict] = None,
) -> bool:
    """Insert one row into public.pipeline_fetch_log. Returns True on success.

    Never raises — logging failures are downgraded to a stderr warning so
    they don't crash the calling recompute job."""
    if status not in ("green", "amber", "red"):
        print(f"[log_pipeline_run] WARN bad status '{status}' — skipping", file=sys.stderr)
        return False
    if run_kind not in ("atomic", "aggregate"):
        print(f"[log_pipeline_run] WARN bad run_kind '{run_kind}' — skipping", file=sys.stderr)
        return False

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        print(f"[log_pipeline_run] WARN missing SUPABASE_URL or SERVICE_ROLE_KEY — silent skip", file=sys.stderr)
        return False

    payload = {
        "indicator_id": indicator_id,
        "status": status,
        "run_kind": run_kind,
        "age_minutes": age_minutes,
        "last_value": last_value,
        "error_message": error_message,
        "source": source,
        "run_duration_ms": run_duration_ms,
        "meta": meta,
    }

    req = urllib.request.Request(
        f"{url}/rest/v1/pipeline_fetch_log",
        data=json.dumps(payload).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                return True
            print(f"[log_pipeline_run] WARN HTTP {resp.status}: {resp.read().decode()[:200]}", file=sys.stderr)
            return False
    except urllib.error.HTTPError as e:
        print(f"[log_pipeline_run] WARN HTTPError {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[log_pipeline_run] WARN {type(e).__name__}: {e}", file=sys.stderr)
        return False
