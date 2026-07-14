#!/usr/bin/env python3
"""backtest_divergences.py — one-off historical study of the RSI divergence screen.

Approved 2026-07-13 (full study). Question: do the screen's signals predict
reversals? Method: re-run the SHIPPED detector (imported from
scripts/compute_divergences.py — the pure functions whose port was validated
17/17 against the prototype; NOT reimplemented here) over weekly historical
scan dates, then measure each signal's forward return vs SPY at 5 / 21 / 63
trading days, split bullish/bearish x extreme/non-extreme.

Read-only against the database. Produces workflow artifacts only:
  bt_signals.csv   one row per (scan_date, ticker, direction) signal
  bt_scans.csv     one row per scan date (universe size, signal counts)
  bt_meta.json     parameters, era map, reconcile result, gate outcomes

Data-shape facts this study is built around (measured 2026-07-13):
  prices_eod daily panel:  ~585-612 names/day  through Jan 2025
                           ~3,219-3,603        Feb 2025 .. Apr 2026
                           ~12,100-12,440      May 2026 onward
  A trading day is eligible under ITS OWN era's floor (450 / 2500 / 5000) —
  see migration 077 (divergence_bt_* helpers). Fixed floors would blank out
  every 45/70-day window that straddles an era cutover.

Paging: every set-returning call pages with EXPLICIT p_limit/p_offset SQL
params via rpc_paged (LESSONS 4.18 — PostgREST truncates at 1,000 silently;
Range headers on RPC are not honored). Table reads page with limit/offset
QUERY params, never Range headers.

Survivorship: universe_master type/active are TODAY'S flags applied
backward; delisted names are absent from history. Documented in the
deliverable's caveats tab — bearish hit rates are likely understated and
bullish ones flattered.
"""

import csv
import json
import os
import sys
import time
from datetime import date, timedelta

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import (            # noqa: E402  — shipped detector, reused verbatim
    RSI_PERIOD, PIVOT_WING, BARS_DAYS,
    detect_divergences, rpc, rpc_paged, _env, _headers,
)

HORIZONS      = (5, 21, 63)
CHUNK_BT_BARS = 100      # tickers per bt_bars call (rows per response << 1000 cap)
CHUNK_PROD    = 250      # tickers per production divergence_bars call (reconcile)
MIN_UNIVERSE  = 300      # fail-loud floor for any historical scan
MAX_MISSING   = 0.02     # max fraction of a scan's universe without bars
SPY_MIN_COVER = 0.99     # SPY must trade on >= 99% of eligible days


# ── small helpers ────────────────────────────────────────────────────────────

def get_rows(table, params, page=1000):
    """Read a TABLE via PostgREST, paging with limit/offset QUERY params
    (never Range headers — LESSONS 4.18), looping until a short page."""
    url, key = _env()
    out, offset = [], 0
    while True:
        q = dict(params)
        q["limit"], q["offset"] = page, offset
        r = requests.get(f"{url}/rest/v1/{table}", headers=_headers(key), params=q, timeout=120)
        if r.status_code >= 300:
            raise RuntimeError(f"GET {table} HTTP {r.status_code}: {r.text[:200]}")
        rows = r.json()
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


def pct(x):
    return None if x is None else round(100.0 * x, 4)


# ── reconcile: prove the study wiring reproduces the live scan exactly ──────

def reconcile_against_live():
    """Re-run the PRODUCTION path (production universe + production bars fns,
    imported detector) for the latest live scan_date and diff against the
    published divergence_scan rows. Same inputs + same functions must give
    the same output; any diff means the study's wiring is broken (4.18d:
    validate on the same transport production uses)."""
    scan_day = rpc("divergence_latest_complete_day", {})
    if not scan_day:
        raise RuntimeError("reconcile: no live complete day")
    live = get_rows("divergence_scan", {"scan_date": f"eq.{scan_day}", "select": "ticker,direction"})
    live_set = {(r["ticker"], r["direction"]) for r in live}

    universe = rpc_paged("divergence_universe", {"p_scan_date": scan_day})
    tickers = sorted(u["ticker"] for u in universe)
    mine = set()
    for i in range(0, len(tickers), CHUNK_PROD):
        chunk = tickers[i:i + CHUNK_PROD]
        rows = rpc("divergence_bars", {"p_scan_date": scan_day, "p_tickers": chunk, "p_days": BARS_DAYS})
        if isinstance(rows, list) and len(rows) >= 1000:
            raise RuntimeError("reconcile: cap-sized bars response — presumptively truncated")
        for b in rows or []:
            closes = [float(x) for x in b["closes"]]
            if len(closes) < RSI_PERIOD + 2 * PIVOT_WING + 2:
                continue
            highs = [float(x) for x in b["highs"]]
            lows = [float(x) for x in b["lows"]]
            vwaps = [float(x) if x is not None else None for x in (b.get("vwaps") or [None] * len(closes))]
            for d in detect_divergences(highs, lows, closes, vwaps):
                mine.add((b["ticker"], d["direction"]))

    missing, extra = live_set - mine, mine - live_set
    ok = not missing and not extra
    print(f"reconcile vs live {scan_day}: live={len(live_set)} study-path={len(mine)} "
          f"{'EXACT MATCH' if ok else f'MISMATCH missing={sorted(missing)[:6]} extra={sorted(extra)[:6]}'}")
    return {"scan_date": scan_day, "live": len(live_set), "reproduced": len(mine), "exact": ok,
            "missing": sorted(map(list, missing))[:20], "extra": sorted(map(list, extra))[:20]}


# ── study ────────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    study_start = date.fromisoformat(os.environ.get("STUDY_START", "2021-01-01"))
    scan_limit = int(os.environ.get("SCAN_LIMIT", "0") or 0)
    out_dir = os.environ.get("OUT_DIR", "bt_out")
    os.makedirs(out_dir, exist_ok=True)

    meta = {"study_start": str(study_start), "horizons": list(HORIZONS),
            "detector": "scripts/compute_divergences.py (imported, unmodified)",
            "scan_limit": scan_limit}

    # 0) port-fidelity gate
    meta["reconcile"] = reconcile_against_live()
    if not meta["reconcile"]["exact"]:
        print("FATAL: study wiring does not reproduce the live scan — stopping before any study output",
              file=sys.stderr)
        json.dump(meta, open(os.path.join(out_dir, "bt_meta.json"), "w"), indent=2)
        sys.exit(1)

    # 1) eligible trading-day calendar (lookback cushion for the first scans)
    cal_start = study_start - timedelta(days=160)
    calendar_rows = rpc_paged("divergence_bt_calendar",
                              {"p_start": str(cal_start), "p_end": str(date.today())})
    cal = [date.fromisoformat(r["trade_date"]) for r in calendar_rows]
    n_by_day = {date.fromisoformat(r["trade_date"]): r["n_tickers"] for r in calendar_rows}
    if len(cal) < 300:
        print(f"FATAL: calendar has only {len(cal)} eligible days", file=sys.stderr)
        sys.exit(1)
    idx_of = {d: i for i, d in enumerate(cal)}
    print(f"calendar: {len(cal)} eligible trading days {cal[0]} .. {cal[-1]}")

    # 2) weekly scan dates = last eligible day of each ISO week
    by_week = {}
    for d in cal:
        if d >= study_start:
            by_week[d.isocalendar()[:2]] = max(d, by_week.get(d.isocalendar()[:2], d))
    scans = sorted(by_week.values())
    scans = [d for d in scans if idx_of[d] + min(HORIZONS) <= len(cal) - 1]
    if scan_limit:
        scans = scans[:scan_limit]
    print(f"scan dates: {len(scans)} weekly ({scans[0]} .. {scans[-1]})")

    # 3) universe per scan date (paged in SQL)
    uni_by_scan, all_tickers = {}, set()
    for k, sd in enumerate(scans):
        u = rpc_paged("divergence_bt_universe", {"p_scan_date": str(sd)})
        if len(u) < MIN_UNIVERSE:
            print(f"FATAL: universe {len(u)} < {MIN_UNIVERSE} on {sd}", file=sys.stderr)
            sys.exit(1)
        uni_by_scan[sd] = {r["ticker"]: float(r["adv_usd"]) for r in u}
        all_tickers.update(uni_by_scan[sd])
        if (k + 1) % 25 == 0 or k == len(scans) - 1:
            print(f"  universes {k + 1}/{len(scans)} (latest {sd}: {len(u)} names)")
    all_tickers.add("SPY")
    print(f"union universe: {len(all_tickers)} tickers")

    # 4) bars for every ticker over the full range, aligned to the calendar
    bars = {}   # ticker -> 4 parallel lists aligned to cal (None where absent)
    tickers_sorted = sorted(all_tickers)
    n_days = len(cal)
    for i in range(0, len(tickers_sorted), CHUNK_BT_BARS):
        chunk = tickers_sorted[i:i + CHUNK_BT_BARS]
        rows = rpc("divergence_bt_bars",
                   {"p_start": str(cal[0]), "p_end": str(cal[-1]), "p_tickers": chunk})
        if isinstance(rows, list) and len(rows) >= 1000:
            raise RuntimeError("bt_bars: cap-sized response — presumptively truncated")
        for b in rows or []:
            h = [None] * n_days; lo = [None] * n_days; c = [None] * n_days; vw = [None] * n_days
            for dt, bh, bl, bc, bv in zip(b["dates"], b["highs"], b["lows"], b["closes"], b["vwaps"]):
                j = idx_of.get(date.fromisoformat(dt))
                if j is not None:
                    h[j] = float(bh); lo[j] = float(bl); c[j] = float(bc)
                    vw[j] = float(bv) if bv is not None else None
            bars[b["ticker"]] = (h, lo, c, vw)
        print(f"  bars {min(i + CHUNK_BT_BARS, len(tickers_sorted))}/{len(tickers_sorted)}")

    spy = bars.get("SPY")
    if not spy:
        print("FATAL: SPY bars missing", file=sys.stderr); sys.exit(1)
    spy_cover = sum(1 for x in spy[2] if x is not None) / n_days
    if spy_cover < SPY_MIN_COVER:
        print(f"FATAL: SPY covers only {spy_cover:.1%} of eligible days", file=sys.stderr)
        sys.exit(1)

    def close_at(tkr_c, j, back=3):
        """Close at calendar index j, walking back up to `back` eligible days."""
        for jj in range(j, max(-1, j - back - 1), -1):
            if tkr_c[jj] is not None:
                return tkr_c[jj]
        return None

    # 5) run the detector at every scan date; measure forward excess vs SPY
    signals, seen_keys = [], set()
    scan_rows = []
    for k, sd in enumerate(scans):
        i_scan = idx_of[sd]
        lo_i = max(0, i_scan - (BARS_DAYS - 1))
        n_bull = n_bear = missing_bars = 0
        for tkr, adv in uni_by_scan[sd].items():
            tb = bars.get(tkr)
            if tb is None:
                missing_bars += 1
                continue
            hh, ll, cc, vv = tb
            w_dates, wh, wl, wc, wv = [], [], [], [], []
            for j in range(lo_i, i_scan + 1):
                if cc[j] is not None and hh[j] is not None and ll[j] is not None:
                    w_dates.append(cal[j]); wh.append(hh[j]); wl.append(ll[j])
                    wc.append(cc[j]); wv.append(vv[j])
            if len(wc) < RSI_PERIOD + 2 * PIVOT_WING + 2 or w_dates[-1] != sd:
                continue
            for d in detect_divergences(wh, wl, wc, wv):
                p2_date = w_dates[len(w_dates) - 1 - d["bars_ago"]]
                key = (tkr, d["direction"], str(p2_date))
                first_seen = key not in seen_keys
                seen_keys.add(key)
                row = {"scan_date": str(sd), "year": sd.year, "ticker": tkr,
                       "direction": d["direction"], "strong": d["strong"],
                       "first_seen": first_seen, "p2_date": str(p2_date),
                       "rsi1": d["rsi1"], "rsi2": d["rsi2"], "px1": d["px1"], "px2": d["px2"],
                       "cur_close": d["cur_close"], "cur_rsi": d["cur_rsi"],
                       "bars_ago": d["bars_ago"], "sep_bars": d["sep_bars"],
                       "rsi_gap": d["rsi_gap"], "adv_usd": round(adv, 0)}
                base = cc[i_scan]; spy_base = spy[2][i_scan]
                for hz in HORIZONS:
                    jt = i_scan + hz
                    r_t = r_s = None
                    if jt <= n_days - 1 and base and spy_base:
                        ct = close_at(cc, jt); st = close_at(spy[2], jt)
                        if ct is not None and st is not None:
                            r_t = ct / base - 1.0
                            r_s = st / spy_base - 1.0
                    row[f"ret{hz}"] = pct(r_t); row[f"spy{hz}"] = pct(r_s)
                    row[f"ex{hz}"] = None if r_t is None else round(100.0 * (r_t - r_s), 4)
                signals.append(row)
                if d["direction"] == "bull":
                    n_bull += 1
                else:
                    n_bear += 1
        if missing_bars > MAX_MISSING * len(uni_by_scan[sd]):
            print(f"FATAL: {missing_bars}/{len(uni_by_scan[sd])} universe names w/o bars on {sd}",
                  file=sys.stderr)
            sys.exit(1)
        scan_rows.append({"scan_date": str(sd), "year": sd.year,
                          "universe": len(uni_by_scan[sd]), "panel_n": n_by_day[sd],
                          "bull": n_bull, "bear": n_bear})
        if (k + 1) % 25 == 0 or k == len(scans) - 1:
            print(f"  scans {k + 1}/{len(scans)} — signals so far {len(signals)}")

    print(f"signals: {len(signals)} rows "
          f"({sum(1 for s in signals if s['first_seen'])} first-seen) "
          f"across {len(scans)} scans")

    # 6) write artifacts
    sig_path = os.path.join(out_dir, "bt_signals.csv")
    with open(sig_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(signals[0].keys()))
        w.writeheader(); w.writerows(signals)
    with open(os.path.join(out_dir, "bt_scans.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(scan_rows[0].keys()))
        w.writeheader(); w.writerows(scan_rows)

    # 7) headline stats into the run log (verification aid; the Excel
    #    deliverable is built from bt_signals.csv afterwards)
    def stats(rows, hz):
        ex = [r[f"ex{hz}"] for r in rows if r[f"ex{hz}"] is not None]
        if not ex:
            return None
        ex.sort()
        n = len(ex); mean = sum(ex) / n
        med = ex[n // 2] if n % 2 else 0.5 * (ex[n // 2 - 1] + ex[n // 2])
        var = sum((x - mean) ** 2 for x in ex) / (n - 1) if n > 1 else 0.0
        t = mean / ((var / n) ** 0.5) if var > 0 else 0.0
        return n, mean, med, t

    print("\nheadline (FIRST-SEEN signals only; excess vs SPY, %):")
    fs = [s for s in signals if s["first_seen"]]
    for direction in ("bull", "bear"):
        for strong in (True, False):
            grp = [s for s in fs if s["direction"] == direction and s["strong"] == strong]
            for hz in HORIZONS:
                st = stats(grp, hz)
                if not st:
                    continue
                n, mean, med, t = st
                wins = sum(1 for s in grp if s[f"ex{hz}"] is not None and
                           (s[f"ex{hz}"] > 0 if direction == "bull" else s[f"ex{hz}"] < 0))
                denom = sum(1 for s in grp if s[f"ex{hz}"] is not None)
                print(f"  {direction:4} {'extreme' if strong else 'regular':8} {hz:>2}d  "
                      f"n={n:<6} hit={wins / denom:5.1%} mean={mean:+.2f} med={med:+.2f} t={t:+.2f}")

    meta.update({"scans": len(scans), "signals": len(signals),
                 "first_seen": len(fs), "union_universe": len(all_tickers) - 1,
                 "calendar_days": n_days, "spy_coverage": round(spy_cover, 4),
                 "runtime_s": round(time.time() - t0, 1)})
    json.dump(meta, open(os.path.join(out_dir, "bt_meta.json"), "w"), indent=2)
    print(f"\nartifacts in {out_dir}/; done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
