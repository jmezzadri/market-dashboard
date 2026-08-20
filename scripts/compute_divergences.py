#!/usr/bin/env python3
"""compute_divergences.py — nightly RSI divergence scanner producer.

Pipeline: equity-rsi_divergences-daily (DIVERGENCE_SCAN_DAILY.yml).
Writes:   public.divergence_scan (delete+rewrite per scan_date; append-only
          across dates). Stamps pipeline_health row `rsi_divergences` green
          only AFTER the publish is verified (stamp-after-publish rule);
          any failure exits non-zero and publishes NOTHING (no partial file).

Method (the spec — mirrors the validated prototype, 2026-07-13 handoff):
  RSI:        RSI(14) on daily closes, simple-average method (Cutler's RSI —
              SMA of gains/losses; window-local, so values are stable
              regardless of series start).
  Pivots:     pivot low/high = strict window extreme with 5 bars each side
              (5L/5R); confirmed only once 5 later bars exist.
  Bullish:    two most recent pivot lows — price lower low, RSI higher low.
  Bearish:    two most recent pivot highs — price higher high, RSI lower high.
  Fresh:      newer pivot within the last 15 bars.
  Separation: pivots 5-30 bars apart.
  Sanity:     pivot price ratio > 1.8x -> skip (split/artifact guard);
              current close outside 0.5x-2x of newer pivot -> skip;
              close vs vwap disagreeing > 50% on the scan day -> drop ticker
              (bad vendor row guard); ADV cap $40B enforced in universe SQL.
  Strong:     older pivot printed from an RSI extreme (<=30 bull / >=70 bear).

Universe (server-side, public.divergence_universe): active US common stock
only (universe_master.type = 'CS'; ETFs/ETNs/funds excluded), last close
>= $2, 45-trading-day avg dollar volume >= $50M, >= 40 of 45 days present,
panel-complete trading days only (>=5000 tickers on the day).

Fail-loud gates (silent-staleness rules 4.5 / 2026-07-13):
  - no panel-complete scan day in the last 6 calendar days -> abort red
  - universe < 500 names -> abort red
  - bar arrays missing for > 2% of universe -> abort red
  - post-write row-count verification mismatch -> cleanup + abort red
"""

import json
import os
import sys
import time
import urllib.parse
from datetime import date, datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upsert_pipeline_health import upsert as stamp_health          # noqa: E402
from log_pipeline_run import log_pipeline_run                     # noqa: E402

INDICATOR_ID   = "rsi_divergences"
TABLE          = "divergence_scan"
RSI_PERIOD     = 14
PIVOT_WING     = 5          # bars on each side of a pivot
FRESH_BARS     = 15         # newer pivot must be within this many bars
SEP_MIN        = 5
SEP_MAX        = 30
BARS_DAYS      = 70         # trading days of history per ticker
PIVOT_RATIO_MAX = 1.8       # px1 vs px2 disagreement guard (splits/artifacts)
CUR_VS_PIVOT_LO = 0.5       # current close sanity band vs newer pivot
CUR_VS_PIVOT_HI = 2.0
VWAP_DISAGREE   = 0.5       # |close/vwap - 1| beyond this = bad vendor row
MIN_UNIVERSE    = 500
MAX_MISSING_FRAC = 0.02
CHUNK_TICKERS   = 250
CHUNK_INSERT    = 500


# ── PostgREST helpers ────────────────────────────────────────────────────────

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
#     rpc divergence_universe HTTP 500 {"code":"57014", ...
#                              "canceling statement due to statement timeout"}
#     rpc divergence_universe HTTP 504: upstream request timeout
# The database was BUSY, not broken. All three failures (8/14, 8/17, 8/19)
# landed in the 21:21-21:22 UTC slot — the `workflow_run` chain off
# MASSIVE-DAILY's 21:00 fire, i.e. while that ingest is still writing
# prices_eod, the table divergence_universe scans.
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

def rsi_simple(closes, period=RSI_PERIOD):
    """Cutler's RSI: simple average of gains/losses over the last `period`
    price changes. out[i] is None until enough history exists (i >= period)."""
    n = len(closes)
    out = [None] * n
    if n <= period:
        return out
    diffs = [closes[k + 1] - closes[k] for k in range(n - 1)]
    gains = [d if d > 0 else 0.0 for d in diffs]
    losses = [-d if d < 0 else 0.0 for d in diffs]
    for i in range(period, n):
        ag = sum(gains[i - period:i]) / period
        al = sum(losses[i - period:i]) / period
        if al == 0:
            out[i] = 100.0
        else:
            rs = ag / al
            out[i] = 100.0 - 100.0 / (1.0 + rs)
    return out


def pivot_indices(vals, mode, wing=PIVOT_WING):
    """Confirmed pivot indexes: vals[i] equals the window extreme over
    [i-wing, i+wing], with `wing` full bars on BOTH sides."""
    n = len(vals)
    out = []
    for i in range(wing, n - wing):
        w = vals[i - wing:i + wing + 1]
        v = vals[i]
        if mode == "low" and v == min(w):
            out.append(i)
        elif mode == "high" and v == max(w):
            out.append(i)
    return out


def detect_divergences(highs, lows, closes, vwaps=None):
    """Regular divergences on the two most recent confirmed pivots.
    Returns list of dicts (direction bull|bear) after sanity filters."""
    n = len(closes)
    last = n - 1
    rsi = rsi_simple(closes)
    results = []

    # bad-vendor-row guard: scan-day close and vwap should roughly agree
    if vwaps is not None and vwaps[last] and closes[last]:
        try:
            if abs(closes[last] / vwaps[last] - 1.0) > VWAP_DISAGREE:
                return []
        except ZeroDivisionError:
            pass

    def emit(direction, series):
        piv = [i for i in pivot_indices(series, "low" if direction == "bull" else "high")
               if rsi[i] is not None]
        if len(piv) < 2:
            return
        p1, p2 = piv[-2], piv[-1]
        if not (SEP_MIN <= (p2 - p1) <= SEP_MAX):
            return
        if (last - p2) > FRESH_BARS:
            return
        px1, px2 = series[p1], series[p2]
        if direction == "bull" and not (px2 < px1 and rsi[p2] > rsi[p1]):
            return
        if direction == "bear" and not (px2 > px1 and rsi[p2] < rsi[p1]):
            return
        # sanity: split/data artifacts
        lo, hi = min(px1, px2), max(px1, px2)
        if lo <= 0 or hi / lo > PIVOT_RATIO_MAX:
            return
        if not (CUR_VS_PIVOT_LO * px2 <= closes[last] <= CUR_VS_PIVOT_HI * px2):
            return
        rsi_gap = abs(rsi[p2] - rsi[p1])
        strong = (rsi[p1] <= 30.0) if direction == "bull" else (rsi[p1] >= 70.0)
        results.append({
            "direction": direction,
            "px1": round(px1, 4), "rsi1": round(rsi[p1], 2),
            "px2": round(px2, 4), "rsi2": round(rsi[p2], 2),
            "cur_close": round(closes[last], 4),
            "cur_rsi": round(rsi[last], 2) if rsi[last] is not None else None,
            "bars_ago": last - p2,
            "sep_bars": p2 - p1,
            "rsi_gap": round(rsi_gap, 2),
            "strong": strong,
        })

    emit("bull", lows)
    emit("bear", highs)
    return results


# ── producer ─────────────────────────────────────────────────────────────────

def fail_red(msg, t0):
    print(f"FATAL: {msg}", file=sys.stderr)
    stamp_health(INDICATOR_ID, "-", "red", msg[:400])
    log_pipeline_run(indicator_id=INDICATOR_ID, status="red", run_kind="scan",
                     run_duration_ms=int((time.time() - t0) * 1000), meta={"error": msg[:400]})
    sys.exit(1)


def main():
    t0 = time.time()
    dry = os.environ.get("DRY_RUN", "false").strip().lower() == "true"
    url, key = _env()

    # 1) scan day
    scan_day = rpc("divergence_latest_complete_day", {})
    if not scan_day:
        fail_red("no panel-complete trading day found in prices_eod (last 15 days)", t0)
    age_days = (date.today() - date.fromisoformat(scan_day)).days
    if age_days > 6:
        fail_red(f"latest complete close {scan_day} is {age_days} days old — upstream ingest stale", t0)
    print(f"scan day: {scan_day} (complete-panel close, {age_days}d old)")

    # 2) universe
    universe = rpc_paged("divergence_universe", {"p_scan_date": scan_day})
    if not isinstance(universe, list) or len(universe) < MIN_UNIVERSE:
        fail_red(f"universe too small: {0 if not isinstance(universe, list) else len(universe)} names (< {MIN_UNIVERSE})", t0)
    meta_by_ticker = {u["ticker"]: u for u in universe}
    tickers = sorted(meta_by_ticker)
    print(f"universe: {len(tickers)} liquid US common stocks")

    # 3) bars
    bars_by_ticker = {}
    for i in range(0, len(tickers), CHUNK_TICKERS):
        chunk = tickers[i:i + CHUNK_TICKERS]
        rows = rpc("divergence_bars", {"p_scan_date": scan_day, "p_tickers": chunk, "p_days": BARS_DAYS})
        if isinstance(rows, list) and len(rows) >= PAGE:
            # one row per ticker and chunks are 250 — a cap-sized response
            # here means the response was truncated some new way; fail loud.
            raise RuntimeError(f"bars chunk returned {len(rows)} rows (>= cap) for {len(chunk)} tickers")
        for r in rows or []:
            bars_by_ticker[r["ticker"]] = r
    missing = [t for t in tickers if t not in bars_by_ticker]
    if len(missing) > MAX_MISSING_FRAC * len(tickers):
        fail_red(f"bar arrays missing for {len(missing)}/{len(tickers)} tickers — refusing partial publish", t0)
    if missing:
        print(f"  note: {len(missing)} tickers had no usable bars (skipped): {missing[:8]}")

    # 4) compute
    out_rows, thin = [], 0
    for t in tickers:
        b = bars_by_ticker.get(t)
        if not b:
            continue
        closes = [float(x) for x in b["closes"]]
        if len(closes) < RSI_PERIOD + 2 * PIVOT_WING + 2:
            thin += 1
            continue
        highs = [float(x) for x in b["highs"]]
        lows = [float(x) for x in b["lows"]]
        vwaps = [float(x) if x is not None else None for x in (b.get("vwaps") or [None] * len(closes))]
        for d in detect_divergences(highs, lows, closes, vwaps):
            m = meta_by_ticker[t]
            out_rows.append({
                "scan_date": scan_day, "ticker": t, "name": m.get("name"),
                "adv_usd": round(float(m["adv_usd"]), 0), **d,
            })
    out_rows.sort(key=lambda r: (r["bars_ago"], -r["rsi_gap"]))
    n_bull = sum(1 for r in out_rows if r["direction"] == "bull")
    n_bear = len(out_rows) - n_bull
    print(f"divergences: {len(out_rows)} total — {n_bull} bullish, {n_bear} bearish (thin-history skips: {thin})")
    for r in out_rows[:12]:
        print(f"  {r['direction']:4} {r['ticker']:6} rsi {r['rsi1']:>5.1f}->{r['rsi2']:>5.1f} "
              f"px {r['px1']:>8.2f}->{r['px2']:>8.2f} age {r['bars_ago']}b sep {r['sep_bars']}b"
              f"{' STRONG' if r['strong'] else ''}")

    if dry:
        print("DRY RUN — no write, no stamp.")
        log_pipeline_run(indicator_id=INDICATOR_ID, status="green", run_kind="scan-dry",
                         run_duration_ms=int((time.time() - t0) * 1000),
                         meta={"scan_date": scan_day, "rows": len(out_rows), "universe": len(tickers), "dry_run": True})
        return

    # 5) publish (idempotent within scan_date: delete then insert)
    h = _headers(key, {"Prefer": "return=minimal"})
    rdel = requests.delete(f"{url}/rest/v1/{TABLE}?scan_date=eq.{scan_day}", headers=h, timeout=120)
    if rdel.status_code >= 300:
        fail_red(f"delete of prior {scan_day} rows failed: HTTP {rdel.status_code} {rdel.text[:200]}", t0)
    for i in range(0, len(out_rows), CHUNK_INSERT):
        chunk = out_rows[i:i + CHUNK_INSERT]
        rins = requests.post(f"{url}/rest/v1/{TABLE}", headers=h, data=json.dumps(chunk), timeout=120)
        if rins.status_code >= 300:
            requests.delete(f"{url}/rest/v1/{TABLE}?scan_date=eq.{scan_day}", headers=h, timeout=120)
            fail_red(f"insert failed (HTTP {rins.status_code}: {rins.text[:200]}) — day's rows cleaned up, nothing published", t0)

    # 6) verify at the layer that matters: count what a reader would see
    rv = requests.get(f"{url}/rest/v1/{TABLE}?scan_date=eq.{scan_day}&select=ticker",
                      headers=_headers(key, {"Prefer": "count=exact", "Range": "0-0", "Range-Unit": "items"}),
                      timeout=60)
    got = int((rv.headers.get("Content-Range") or "/0").split("/")[-1] or 0)
    if got != len(out_rows):
        fail_red(f"post-write verification mismatch: wrote {len(out_rows)}, table shows {got}", t0)
    print(f"published {got} rows for {scan_day}; verified by read-back count")

    # 7) stamp green only after verified publish
    stamp_health(INDICATOR_ID, scan_day, "green")
    log_pipeline_run(indicator_id=INDICATOR_ID, status="green", run_kind="scan",
                     run_duration_ms=int((time.time() - t0) * 1000),
                     meta={"scan_date": scan_day, "rows": len(out_rows), "bull": n_bull,
                           "bear": n_bear, "universe": len(tickers)})
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
