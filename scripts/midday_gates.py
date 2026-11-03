#!/usr/bin/env python3
"""midday_gates.py — the 11:30 ET gate check for the Midday Update.

Joe, 2026-11-03: "I don't want half-ass bullshit posted for the sake of
posting." The Midday Update therefore posts ONLY when one of the gates below
fires, and the check is arithmetic, not judgment: every gate's value, its
threshold and whether it fired is written to public/midday_gates.json so any
midday post can be audited after the fact. Nothing fired -> the file still
posts (the homepage prints "No midday update · nothing tripped at 11:30") and
no update is written. The product spec lives in the "MacroTilt Brief Editions
— Spec" doc; the gates there and here must match.

Market gates read live quotes from Yahoo's chart endpoint (the same vendor
scripts/fetch_market_indicators.py already uses) against the PRIOR CASH CLOSE
in the site's own brief-latest feed, so "vs prior close" means the same close
the homepage ticker shows.

Three gates cannot be computed from a feed and are ASSERTED by the session
with a timestamped source, which the log records verbatim:
  --release "ISM Manufacturing=55.5/54.5"   actual/consensus; sigma is the
                                             standard deviation of that series'
                                             period-over-period changes in
                                             public/econ_release_history.json
  --earnings "AAPL=-4.1"                     pre-market move, top-50 market cap
  --central-bank "BoE: hiked 25bp, consensus hold"
Omit them when nothing qualifies; an omitted assertion is a quiet gate.

Usage:
  python3 scripts/midday_gates.py --out /tmp/midday_gates.json [--release ...] [--earnings ...] [--central-bank ...]
Exit 0 = FIRED (write a Midday Update), 3 = QUIET (post the log only),
2 = not a trading day, 1 = error.
"""
import argparse
import datetime as dt
import json
import os
import statistics
import sys
import time
import urllib.request
import zoneinfo

ET = zoneinfo.ZoneInfo("America/New_York")
SITE = "https://macrotilt.com"
LATEST = "https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-latest"
YH = "https://query1.finance.yahoo.com/v8/finance/chart"

# Yahoo symbol, feed key for the prior close, label, unit.
QUOTES = {
    "spx":   ("^GSPC",    "spx_index",   "S&P 500",   "pct"),
    "vix":   ("^VIX",     "vix",         "VIX",       "pts"),
    "ust10": ("^TNX",     "ust_10y",     "10y yield", "bp"),
    "move":  ("^MOVE",    "move",        "MOVE",      "pts"),
    "brent": ("BZ=F",     "cmdty_brent", "Brent",     "pct"),
    "dxy":   ("DX-Y.NYB", "usd",         "DXY",       "pct"),
}

# The thresholds (spec, 2026-11-03). Change them here and in the spec together.
THRESH = {
    "spx_pct": 1.0, "vix_pct": 15.0, "vix_abs": 30.0,
    "ust10_bp": 10.0, "move_pts": 8.0,
    "brent_pct": 4.0, "dxy_pct": 0.75,
    "release_sigma": 1.0, "earnings_pct": 5.0,
}
SCHEDULED = ("Consumer prices (CPI)", "Jobs report", "Fed decision (FOMC)")
ELECTION = "US midterm elections"


def _get(url, params=None, timeout=25):
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()


def _json(url, params=None):
    return json.loads(_get(url, params))


def quote(symbol):
    """Last regular-session price and its timestamp, with retries (vendor flakes)."""
    last = None
    for pause in (0, 3, 8):
        if pause:
            time.sleep(pause)
        try:
            res = _json(f"{YH}/{symbol}", {"range": "1d", "interval": "5m"})["chart"]["result"][0]
            m = res["meta"]
            px = m.get("regularMarketPrice")
            ts = m.get("regularMarketTime")
            if px is None or ts is None:
                raise RuntimeError("no regularMarketPrice")
            return float(px), dt.datetime.fromtimestamp(int(ts), ET)
        except Exception as e:  # noqa: BLE001 — every failure retried the same way
            last = e
    raise RuntimeError(f"{symbol}: {last}")


def trading_day(d):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from build_daily_brief import is_trading_day, prev_trading_day
    except Exception:  # noqa: BLE001
        return d.weekday() < 5, None
    return is_trading_day(d), prev_trading_day


def fmt(v, unit):
    if unit == "pct":
        return f"{v:+.2f}%"
    if unit == "bp":
        return f"{v:+.1f}bp"
    return f"{v:+.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--release", action="append", default=[], help='"<calendar name>=<actual>/<consensus>"')
    ap.add_argument("--earnings", action="append", default=[], help='"<TICKER>=<pre-market pct>"')
    ap.add_argument("--central-bank", action="append", default=[], help='"<bank>: <decision>, consensus <x>"')
    ap.add_argument("--source", default="", help="one line naming where the asserted figures came from, with their timestamps")
    a = ap.parse_args()

    now = dt.datetime.now(ET)
    today = now.date()
    ok, prev_fn = trading_day(today)
    if not ok:
        print(f"not a trading day ({today:%Y-%m-%d %a}) — no gate check", file=sys.stderr)
        sys.exit(2)

    gates = []
    problems = []

    # --- 1. Scheduled day ----------------------------------------------------
    cal = _json(f"{SITE}/econ_calendar.json").get("events") or []
    today_s = today.isoformat()
    names_today = [e.get("name", "") for e in cal if e.get("date") == today_s]
    hit = [n for n in names_today if n in SCHEDULED]
    if prev_fn is not None:
        prev = prev_fn(today).isoformat()
        if any(e.get("name") == ELECTION and e.get("date") == prev for e in cal):
            hit.append("trading day after a US election")
    gates.append({"name": "Scheduled day", "measure": "CPI, jobs report, FOMC, or the day after a US election",
                  "value": ", ".join(hit) if hit else "none", "threshold": "any", "fired": bool(hit),
                  "source": "macrotilt.com/econ_calendar.json"})

    # --- 2. Data surprise (asserted actual/consensus, sigma from history) -----
    hist = {}
    try:
        hist = (_json(f"{SITE}/econ_release_history.json").get("series") or {})
    except Exception as e:  # noqa: BLE001
        problems.append(f"release history unreachable: {e}")
    for spec in a.release:
        try:
            name, nums = spec.split("=", 1)
            actual, cons = (float(x) for x in nums.split("/", 1))
        except ValueError:
            problems.append(f"bad --release {spec!r}; want NAME=actual/consensus")
            continue
        series = hist.get(name.strip())
        sigma = None
        if series and series.get("measures"):
            pts = [p[1] for p in series["measures"][0].get("points", []) if p[1] is not None]
            diffs = [b - a_ for a_, b in zip(pts, pts[1:])]
            if len(diffs) >= 8:
                sigma = statistics.pstdev(diffs)
        if not sigma:
            problems.append(f"no surprise sigma for {name.strip()!r}; gate left quiet")
            gates.append({"name": "Data surprise", "measure": name.strip(), "value": f"{actual} vs {cons} consensus",
                          "threshold": "1.0 sigma (unavailable)", "fired": False, "source": a.source})
            continue
        z = (actual - cons) / sigma
        gates.append({"name": "Data surprise", "measure": name.strip(),
                      "value": f"{actual} vs {cons} consensus = {z:+.2f} sigma", "threshold": f"±{THRESH['release_sigma']} sigma",
                      "fired": abs(z) >= THRESH["release_sigma"], "source": a.source})
    if not a.release:
        gates.append({"name": "Data surprise", "measure": "tier-1 release vs consensus", "value": "no tier-1 release asserted",
                      "threshold": f"±{THRESH['release_sigma']} sigma", "fired": False, "source": ""})

    # --- 3-5. Market gates ----------------------------------------------------
    latest = _json(LATEST).get("indicators") or {}
    q = {}
    for key, (sym, feed_key, label, unit) in QUOTES.items():
        prior = (latest.get(feed_key) or {}).get("value")
        prior_asof = (latest.get(feed_key) or {}).get("as_of")
        try:
            px, ts = quote(sym)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{label}: quote failed ({e}); gate left quiet")
            q[key] = None
            continue
        if prior is None:
            problems.append(f"{label}: no prior close in brief-latest; gate left quiet")
            q[key] = None
            continue
        prior = float(prior)
        if unit == "pct":
            chg = (px / prior - 1.0) * 100.0
        elif unit == "bp":
            chg = (px - prior) * 100.0
        else:
            chg = px - prior
        q[key] = {"px": px, "prior": prior, "chg": chg, "ts": ts, "prior_asof": prior_asof, "label": label, "unit": unit}

    def mk(name, measure, keys, test, threshold):
        vals = [q.get(k) for k in keys]
        if any(v is None for v in vals):
            gates.append({"name": name, "measure": measure, "value": "unavailable", "threshold": threshold, "fired": False,
                          "source": "Yahoo chart endpoint vs brief-latest prior close"})
            return
        fired, text = test(*vals)
        gates.append({"name": name, "measure": measure, "value": text, "threshold": threshold, "fired": fired,
                      "as_of": max(v["ts"] for v in vals).strftime("%-I:%M %p ET"),
                      "source": "Yahoo chart endpoint vs brief-latest prior close"})

    def t_eq(spx, vix):
        vix_pct = (vix["px"] / vix["prior"] - 1.0) * 100.0
        text = f"S&P {spx['px']:,.0f}, {fmt(spx['chg'], 'pct')} vs {spx['prior_asof']} close; VIX {vix['px']:.1f}, {vix_pct:+.1f}%"
        return (abs(spx["chg"]) >= THRESH["spx_pct"] or vix_pct >= THRESH["vix_pct"] or vix["px"] >= THRESH["vix_abs"]), text

    def t_rates(u, m):
        text = f"10y {u['px']:.2f}%, {fmt(u['chg'], 'bp')} vs {u['prior_asof']} close; MOVE {m['px']:.1f}, {fmt(m['chg'], 'pts')}"
        return (abs(u["chg"]) >= THRESH["ust10_bp"] or m["chg"] >= THRESH["move_pts"]), text

    def t_oil(b, d):
        text = f"Brent ${b['px']:.2f}, {fmt(b['chg'], 'pct')} vs {b['prior_asof']} close; DXY {d['px']:.2f}, {fmt(d['chg'], 'pct')}"
        return (abs(b["chg"]) >= THRESH["brent_pct"] or abs(d["chg"]) >= THRESH["dxy_pct"]), text

    mk("Equities", "S&P 500 vs prior close; VIX", ("spx", "vix"), t_eq,
       f"S&P ±{THRESH['spx_pct']}% or VIX +{THRESH['vix_pct']:.0f}% or VIX ≥{THRESH['vix_abs']:.0f}")
    mk("Rates", "10y yield; MOVE", ("ust10", "move"), t_rates,
       f"10y ±{THRESH['ust10_bp']:.0f}bp or MOVE +{THRESH['move_pts']:.0f}pts")
    mk("Oil and dollar", "Brent; DXY", ("brent", "dxy"), t_oil,
       f"Brent ±{THRESH['brent_pct']:.0f}% or DXY ±{THRESH['dxy_pct']}%")

    # --- 6. Earnings (asserted) -------------------------------------------------
    if a.earnings:
        for spec in a.earnings:
            try:
                tk, pct = spec.split("=", 1)
                pct = float(pct)
            except ValueError:
                problems.append(f"bad --earnings {spec!r}; want TICKER=pct")
                continue
            gates.append({"name": "Earnings", "measure": f"{tk.strip().upper()} pre-market move (top-50 market cap)",
                          "value": f"{pct:+.1f}%", "threshold": f"±{THRESH['earnings_pct']:.0f}%",
                          "fired": abs(pct) >= THRESH["earnings_pct"], "source": a.source})
    else:
        gates.append({"name": "Earnings", "measure": "top-50 market-cap pre-market report", "value": "none asserted",
                      "threshold": f"±{THRESH['earnings_pct']:.0f}%", "fired": False, "source": ""})

    # --- 7. Central bank (asserted) --------------------------------------------
    if a.central_bank:
        for spec in a.central_bank:
            gates.append({"name": "Central bank", "measure": "ECB / BoE / BoJ decision vs consensus",
                          "value": spec, "threshold": "differs from consensus", "fired": True, "source": a.source})
    else:
        gates.append({"name": "Central bank", "measure": "ECB / BoE / BoJ decision vs consensus",
                      "value": "no off-consensus decision", "threshold": "differs from consensus", "fired": False, "source": ""})

    fired = [g["name"] for g in gates if g["fired"]]
    out = {
        "date": today_s,
        "checked_at": now.isoformat(timespec="seconds"),
        "fired": bool(fired),
        "fired_gates": fired,
        "gates": gates,
        "problems": problems,
        "thresholds": THRESH,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    for g in gates:
        print(f"{'FIRED ' if g['fired'] else 'quiet '} {g['name']:16s} {g['value']}  [{g['threshold']}]")
    for p in problems:
        print(f"WARN: {p}", file=sys.stderr)
    print("RESULT:", "FIRED " + ", ".join(fired) if fired else "QUIET — nothing tripped")
    sys.exit(0 if fired else 3)


if __name__ == "__main__":
    main()
