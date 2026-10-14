"""supabase_rest — the PostgREST / RPC helpers the nightly scripts share.

Lifted out of compute_divergences.py when the RSI-divergence scan was
retired (2026-10-13); compute_power_trend_list.py and backtest_strategies.py
import them from here. Behaviour unchanged.
"""
import json
import os
import sys
import time
import urllib.parse

import requests

def _env():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)
    return url, key


def _headers(key, extra=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


PAGE = 1000  # PostgREST caps a single response at max-rows (1000 here)

# 2026-08-20 (weekday health sweep — LESSONS 4.52; this supersedes the
# UNCONFIRMED structural suspect recorded in 4.51, which guessed at a GitHub
# concurrency collision and was wrong).
#
# Every failure this job has had came back the same way — read from the run
# log, not inferred:
#     rpc <name> HTTP 500 {"code":"57014", ...
#                              "canceling statement due to statement timeout"}
#     rpc <name> HTTP 504: upstream request timeout
# The database was BUSY, not broken. All three failures (8/14, 8/17, 8/19)
# landed in the 21:21-21:22 UTC slot — the `workflow_run` chain off
# MASSIVE-DAILY's 21:00 fire, i.e. while that ingest is still writing
# prices_eod, the table the universe RPCs scan.
#
# The old retry was `time.sleep(4 * attempt)` — 4s, then 8s. Against contention
# that lasts minutes, three attempts four seconds apart are not three chances;
# they are one chance taken three times. The whole sequence finished inside a
# single ~4.5-minute window and the job died with the feed red-stamped, every
# time. A retry only means something if it outlasts the thing that caused the
# failure, so busy-class backoff is now measured in minutes.
#
# The patience is BOUNDED and shared across the whole run (BUSY_RETRY_BUDGET_S)
# so the job can never spin past its own `timeout-minutes` and sit on the
# concurrency group. A non-busy error keeps the old short backoff: a genuine
# 4xx should surface quickly rather than spin (LESSONS 4.29 rule 1).
REQ_TIMEOUT_S       = 180
RETRIES             = 4
BUSY_BACKOFF_S      = (45, 150, 300)
BUSY_RETRY_BUDGET_S = 900      # 15 minutes of total waiting, per process
_busy_spent = [0]              # list so the helper below can mutate it


def _is_busy(err) -> bool:
    """True when the error says 'the database is busy', not 'the query is wrong'."""
    t = str(err)
    return (
        "57014" in t
        or "statement timeout" in t
        or "upstream request timeout" in t
        or "HTTP 502" in t
        or "HTTP 503" in t
        or "HTTP 504" in t
        or "timed out" in t.lower()
    )


def rpc(name, payload, retries=RETRIES, headers_extra=None):
    url, key = _env()
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(f"{url}/rest/v1/rpc/{name}", headers=_headers(key, headers_extra),
                              data=json.dumps(payload), timeout=REQ_TIMEOUT_S)
            if r.status_code < 300:
                return r.json()
            raise RuntimeError(f"rpc {name} HTTP {r.status_code}: {r.text[:300]}")
        except Exception as e:  # noqa: BLE001 — retry then re-raise
            if attempt == retries:
                raise
            if _is_busy(e):
                remaining = BUSY_RETRY_BUDGET_S - _busy_spent[0]
                if remaining <= 0:
                    print(f"  rpc {name} attempt {attempt} failed ({e}); the "
                          f"{BUSY_RETRY_BUDGET_S}s busy-retry budget is spent — giving up",
                          file=sys.stderr)
                    raise
                wait = min(BUSY_BACKOFF_S[min(attempt - 1, len(BUSY_BACKOFF_S) - 1)], remaining)
                _busy_spent[0] += wait
                print(f"  rpc {name} attempt {attempt}/{retries} failed ({e}); database busy — "
                      f"waiting {wait}s ({_busy_spent[0]}/{BUSY_RETRY_BUDGET_S}s of budget used)",
                      file=sys.stderr)
            else:
                wait = 4 * attempt
                print(f"  rpc {name} attempt {attempt}/{retries} failed ({e}); retrying in {wait}s",
                      file=sys.stderr)
            time.sleep(wait)
    return None


def rpc_paged(name, payload):
    """Set-returning RPC paged with EXPLICIT p_limit/p_offset SQL params.

    Two hard-won rules from 2026-07-13, first production day:
    (1) PostgREST silently truncates any response at its max-rows cap — the
        universe came back as exactly 1,000 of 1,486 names and the run
        "succeeded" on a partial universe. Never trust a single page.
    (2) Range-header paging on RPC calls is NOT honored here — every "page"
        returned the same first 1,000 rows and the pager looped forever.
        Page in SQL (limit/offset function params), never in headers.
    """
    out = []
    offset = 0
    while True:
        page = rpc(name, {**payload, "p_limit": PAGE, "p_offset": offset})
        if not isinstance(page, list):
            raise RuntimeError(f"rpc {name} returned non-list page: {type(page)}")
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


# ── math (pure; unit-tested in scripts/test_divergences.py) ─────────────────

