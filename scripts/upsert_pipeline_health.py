"""upsert_pipeline_health.py — keep a pipeline_health row's freshness columns
current after a recompute job commits its output file.

Why this exists
───────────────
The freshness chip (useFreshness) grades against public.pipeline_health
(data_as_of / last_good_at). The Supabase edge function only refreshes
pipeline_health for ATOMIC vendor feeds — it does NOT touch rows owned by
in-house recompute jobs like v10-allocation-daily or macrotilt-engine-daily.
Result (Joe 2026-06-03): the v10_allocation file refreshed fine every day, but
its pipeline_health.data_as_of was frozen at 2026-05-26, so the Recommended
Allocation chip read a fake "6D ago". A producer that commits a fresh file MUST
also stamp its own pipeline_health row, or the chip lies.

This helper updates an EXISTING pipeline_health row (per the binding rule:
the freshness checker only updates existing rows — new feeds need a seed row).
It never inserts and never raises; a logging failure must not fail the
recompute job.

Usage
─────
    python scripts/upsert_pipeline_health.py <indicator_id> <data_as_of_iso> [status]

Auth: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone


def upsert(indicator_id: str, data_as_of: str, status: str = "green") -> bool:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        print("[upsert_pipeline_health] WARN missing SUPABASE_URL/SERVICE_ROLE_KEY — skip", file=sys.stderr)
        return False

    # Normalise a date-only as_of to midnight UTC ISO.
    as_of = f"{data_as_of}T00:00:00+00:00" if len(data_as_of) == 10 else data_as_of
    now = datetime.now(timezone.utc).isoformat()
    body = json.dumps({
        "data_as_of": as_of,
        "last_good_at": as_of,
        "last_check_at": now,
        "status": status,
        "last_error": None,
        "updated_at": now,
    }).encode()

    endpoint = (
        f"{url}/rest/v1/pipeline_health?indicator_id=eq."
        + urllib.parse.quote(indicator_id, safe="")
    )
    req = urllib.request.Request(endpoint, data=body, method="PATCH")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read().decode() or "[]")
        if rows:
            print(f"[upsert_pipeline_health] {indicator_id} data_as_of -> {as_of} ({status})")
            return True
        print(f"[upsert_pipeline_health] WARN no existing row for '{indicator_id}' — seed it first", file=sys.stderr)
        return False
    except urllib.error.HTTPError as e:
        print(f"[upsert_pipeline_health] WARN HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False
    except Exception as e:  # noqa: BLE001
        print(f"[upsert_pipeline_health] WARN {e}", file=sys.stderr)
        return False


import urllib.parse  # noqa: E402  (after func def to keep header tidy)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(0)  # never fail the job
    _id = sys.argv[1]
    _as_of = sys.argv[2]
    _status = sys.argv[3] if len(sys.argv) > 3 else "green"
    upsert(_id, _as_of, _status)
