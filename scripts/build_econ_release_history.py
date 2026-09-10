#!/usr/bin/env python3
"""Economic release history + nowcasts — builds public/econ_release_history.json.

WHY THIS EXISTS
---------------
Clicking a release on the homepage "Upcoming data" tile used to send the reader
to the Macro Overview page — a generic destination that says nothing about the
release they clicked (Joe, 2026-09-10: "It should open a modal that shows a
chart of historical readings vs. expectations"). This file is the feed behind
that modal: for every release the calendar names, the last three years of
actual prints, and — where a FREE, PUBLIC, NAMED forecaster publishes one — a
nowcast for the print that has not landed yet.

There is deliberately NO street consensus here. Consensus is a paid product and
the June 2026 decision stands (no paid vendor). What is shown instead is
labelled by its author, never as "expectations":

  * Cleveland Fed inflation nowcast  — CPI / core CPI / PCE / core PCE, MoM %
  * Atlanta Fed GDPNow               — real GDP, QoQ SAAR %, via FRED (GDPNOW)
  * Fed funds futures (CME, via Yahoo) — the rate the market has priced for the
    month AFTER the next FOMC meeting. That month contains no meeting, so the
    contract's implied average rate IS the post-meeting rate — the textbook
    CME FedWatch construction without the within-month blend.

SOURCES (one provider per source — governance rule 4.1)
--------------------------------------------------------
  actual prints     FRED series observations (api.stlouisfed.org). These are the
                    CURRENT VINTAGE — revisions included — not the number as
                    first printed. Said so on every chart's source line.
  ISM actuals       public/indicator_history.json (ISM is not on FRED; the site
                    already holds its own ISM series from the indicator feed).
  Cleveland nowcast clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json
  GDPNow            FRED series GDPNOW (the Atlanta Fed publishes to FRED)
  Fed funds futures query2.finance.yahoo.com/v8/finance/chart/ZQ<mon><yy>.CBT
  next FOMC date    public/econ_calendar.json (built by the step before this one)

RULES THIS SCRIPT OBEYS
-----------------------
* Points are dated by the PERIOD they describe (FRED's convention: 2026-07-01 is
  July). A nowcast is dated the same way, so on the chart it sits exactly one
  step to the right of the last print — the reader sees "last print, then what
  the forecaster expects next", on one axis, with nothing invented between.
* A nowcast that cannot be fetched is a FAILED RUN (exit 1), never a silently
  absent value. The site keeps the last good file and its chip goes red — the
  reader is told "last refreshed <when>" rather than shown a blank that reads
  the same as "no forecaster covers this release" (LESSONS 4.10, 5.14).
* A release with no series behind it is listed with an empty measures list so
  the modal can say, honestly, that no history is held for it. It is not
  silently missing from the file.
* Exits 1 if fewer than 20 measures carry at least 24 points — a broken FRED
  fetch must not publish a file of empty charts.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

FRED_API_KEY_DEFAULT = "e1696db1c3f8bb036993f40c61aad0d5"
FRED_BASE = "https://api.stlouisfed.org/fred"
CLEVELAND_URL = "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json?sc_lang=en"
YAHOO_CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=1d"
OUT_PATH = "public/econ_release_history.json"
CALENDAR_PATH = "public/econ_calendar.json"
INDICATOR_HISTORY_PATH = "public/indicator_history.json"

YEARS = 3          # prints kept per measure
UA = "MacroTilt/econ-release-history"

FRED_VINTAGE_NOTE = "FRED, current vintage (revisions included)"

# ── the release → measure map ──────────────────────────────────────────────
# Keyed by the calendar's exact event `name` — that string is already the
# contract the brief and the trade-idea checker validate against, so the modal
# needs no second identifier. Each measure is ONE headline number a desk
# actually trades on release, expressed the way the wire quotes it.
#
#   fred      FRED series id
#   transform level | pct (change vs prior obs, %) | diff (change vs prior obs)
#   scale     multiplier applied AFTER the transform (units → display units)
#   unit      display suffix
#   decimals  display precision
#   nowcast   which forecaster covers this measure (see NOWCASTS below), or None
def M(label, fred, transform="level", unit="", decimals=1, scale=1.0, nowcast=None, source=None):
    return dict(label=label, fred=fred, transform=transform, unit=unit, decimals=decimals,
                scale=scale, nowcast=nowcast, source=source)


RELEASES = {
    "Jobs report": [
        M("Nonfarm payrolls, monthly change", "PAYEMS", "diff", "K", 0),
        M("Unemployment rate", "UNRATE", "level", "%", 1),
    ],
    "Consumer prices (CPI)": [
        M("CPI, month over month", "CPIAUCSL", "pct", "%", 2, nowcast="cleveland:CPI Inflation"),
        M("Core CPI, month over month", "CPILFESL", "pct", "%", 2, nowcast="cleveland:Core CPI Inflation"),
    ],
    "Producer prices (PPI)": [
        M("PPI final demand, month over month", "PPIFIS", "pct", "%", 2),
        M("Core PPI, month over month", "PPIFES", "pct", "%", 2),
    ],
    "Personal income & PCE prices": [
        M("PCE prices, month over month", "PCEPI", "pct", "%", 2, nowcast="cleveland:PCE Inflation"),
        M("Core PCE prices, month over month", "PCEPILFE", "pct", "%", 2, nowcast="cleveland:Core PCE Inflation"),
    ],
    "GDP": [
        M("Real GDP, annualised quarterly growth", "A191RL1Q225SBEA", "level", "%", 1, nowcast="gdpnow"),
    ],
    "Retail sales": [
        M("Retail sales, month over month", "RSAFS", "pct", "%", 1),
    ],
    "Job openings (JOLTS)": [
        M("Job openings", "JTSJOL", "level", "M", 2, scale=1 / 1000),
    ],
    "Jobless claims": [
        M("Initial claims, weekly", "ICSA", "level", "K", 0, scale=1 / 1000),
    ],
    "Industrial production": [
        M("Industrial production, month over month", "INDPRO", "pct", "%", 1),
    ],
    "Existing home sales": [
        M("Existing home sales, annualised", "EXHOSLUSM495S", "level", "M", 2, scale=1 / 1_000_000),
    ],
    "New home sales": [
        M("New home sales, annualised", "HSN1F", "level", "K", 0),
    ],
    "Trade balance": [
        M("Goods and services trade balance", "BOPGSTB", "level", "$bn", 1, scale=1 / 1000),
    ],
    "Import & export prices": [
        M("Import prices, month over month", "IR", "pct", "%", 1),
    ],
    "Employment cost index": [
        M("Employment cost index, quarter over quarter", "ECIALLCIV", "pct", "%", 1),
    ],
    "Productivity & unit labor costs": [
        M("Nonfarm productivity, annualised quarterly change", "PRS85006092", "level", "%", 1),
    ],
    "Construction spending": [
        M("Construction spending, month over month", "TTLCONS", "pct", "%", 1),
    ],
    "Wholesale inventories": [
        M("Wholesale inventories, month over month", "WHLSLRIMSA", "pct", "%", 1),
    ],
    "Business inventories": [
        M("Business inventories, month over month", "BUSINV", "pct", "%", 1),
    ],
    "Consumer credit": [
        M("Consumer credit, monthly change", "TOTALSL", "diff", "$bn", 1, scale=1 / 1000),
    ],
    "Chicago Fed activity index": [
        M("CFNAI", "CFNAI", "level", "", 2),
    ],
    "Empire State survey": [
        M("General business conditions index", "GACDISA066MSFRBNY", "level", "", 1),
    ],
    "Philadelphia Fed survey": [
        M("General activity index", "GACDFSA066MSFRBPHI", "level", "", 1),
    ],
    "Consumer sentiment (Michigan, final)": [
        M("Consumer sentiment index", "UMCSENT", "level", "", 1),
    ],
    "Consumer sentiment (Michigan, preliminary)": [
        M("Consumer sentiment index (final readings)", "UMCSENT", "level", "", 1),
    ],
    "Fed balance sheet (H.4.1)": [
        M("Total Fed assets", "WALCL", "level", "$tn", 2, scale=1 / 1_000_000),
    ],
    "Fed decision (FOMC)": [
        # The EFFECTIVE rate, not the target band: it is the number the futures
        # contract settles on, so the priced post-meeting rate sits on the same
        # scale as the line it is drawn against.
        M("Effective fed funds rate", "EFFR", "level", "%", 2, nowcast="fedfunds"),
    ],
    "Housing starts & permits": [
        M("Housing starts, annualised", "HOUST", "level", "K", 0),
        M("Building permits, annualised", "PERMIT", "level", "K", 0),
    ],
    "Building permits (final)": [
        M("Building permits, annualised", "PERMIT", "level", "K", 0),
    ],
    "Durable goods orders": [
        M("Durable goods orders, month over month", "DGORDER", "pct", "%", 1),
    ],
    "Factory orders": [
        M("Factory orders, month over month", "AMTMNO", "pct", "%", 1),
    ],
    # ISM is a private body and is not on FRED; the site's own ISM series
    # (indicator feed → public/indicator_history.json) is the single source.
    "ISM Manufacturing": [
        dict(label="ISM Manufacturing PMI", indicator="ism_mfg", transform="level", unit="", decimals=1, scale=1.0, nowcast=None),
    ],
    "ISM Services": [
        dict(label="ISM Services PMI", indicator="ism_svc", transform="level", unit="", decimals=1, scale=1.0, nowcast=None),
    ],
    # Listed with NO measures on purpose: no free series describes the headline
    # number. The modal says so rather than drawing something adjacent.
    "Philadelphia Fed services survey": [],
    "Advance goods trade & inventories": [],
    "Foreign Treasury flows (TIC)": [],
    "Durable goods / factory orders": [],
    "New residential construction": [],
}


# ── fetch helpers ──────────────────────────────────────────────────────────
def _get_json(url: str, timeout: int = 40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fred_observations(series_id: str, start: dt.date, key: str):
    q = urllib.parse.urlencode(dict(series_id=series_id, api_key=key, file_type="json",
                                    observation_start=start.isoformat(), sort_order="asc"))
    d = _get_json(f"{FRED_BASE}/series/observations?{q}")
    out = []
    for o in d.get("observations", []):
        v = o.get("value")
        if v in (None, "", "."):
            continue
        out.append((o["date"], float(v)))
    return out


def fred_series_meta(series_id: str, key: str):
    q = urllib.parse.urlencode(dict(series_id=series_id, api_key=key, file_type="json"))
    d = _get_json(f"{FRED_BASE}/series?{q}")
    s = (d.get("seriess") or [{}])[0]
    return dict(title=s.get("title"), last_updated=s.get("last_updated"), frequency=s.get("frequency_short"))


def transform(points, how: str, scale: float, decimals: int):
    """level / pct / diff, then scale, then round to one extra decimal so the
    JSON stays small without pre-rounding what the page will format."""
    out = []
    if how == "level":
        out = [(d, v * scale) for d, v in points]
    elif how == "pct":
        for i in range(1, len(points)):
            p0, p1 = points[i - 1][1], points[i][1]
            if p0:
                out.append((points[i][0], (p1 / p0 - 1.0) * 100.0 * scale))
    elif how == "diff":
        for i in range(1, len(points)):
            out.append((points[i][0], (points[i][1] - points[i - 1][1]) * scale))
    else:
        raise ValueError(how)
    return [[d, round(v, decimals + 2)] for d, v in out]


def window(points, years: int):
    if not points:
        return points
    last = dt.date.fromisoformat(points[-1][0])
    cut = last.replace(year=last.year - years).isoformat()
    kept = [p for p in points if p[0] >= cut]
    return kept if len(kept) >= 4 else points


# ── nowcasts ───────────────────────────────────────────────────────────────
def cleveland_nowcasts():
    """Cleveland Fed monthly nowcasts, keyed by (series name, period 'YYYY-MM-01').

    The file is one chart per month back to 2013-7. Each chart carries the
    nowcast path (daily updates, MM/DD labels) and an 'Actual …' series that is
    empty until the print lands. Which month is PENDING is decided by the
    caller from the last FRED print (next month after it) — NOT by "first chart
    with an empty Actual": October 2025 has no actual at all (the shutdown
    cancelled that CPI) and that rule picked it, a year stale. The as-of is the
    LAST dated label carrying a value; the year comes from the chart's own
    'YYYY-M' subcaption (labels have no year)."""
    charts = _get_json(CLEVELAND_URL)
    out = {}
    for ch in charts:
        sub = str(ch["chart"].get("subcaption", ""))   # 'YYYY-M'
        try:
            y, m = (int(x) for x in sub.split("-"))
        except ValueError:
            continue
        period = dt.date(y, m, 1).isoformat()
        cats = [c.get("label", "") for c in ch["categories"][0]["category"]]
        series = {s["seriesname"]: s["data"] for s in ch["dataset"]}
        for name in ("CPI Inflation", "Core CPI Inflation", "PCE Inflation", "Core PCE Inflation"):
            actual = series.get(f"Actual {name}") or []
            printed = any(x.get("value") not in ("", None) for x in actual)
            path = series.get(name) or []
            last_i = max((i for i, x in enumerate(path) if x.get("value") not in ("", None)), default=None)
            if last_i is None:
                continue
            try:
                mm, dd = (int(x) for x in cats[last_i].split("/"))
            except ValueError:
                continue
            # A nowcast for month M is updated during M and the month after it;
            # the label's year is the chart year unless it wrapped past December.
            yr = y + (1 if mm < m - 1 else 0)
            out[(name, period)] = dict(
                value=round(float(path[last_i]["value"]), 3),
                as_of=dt.date(yr, mm, dd).isoformat(),
                period=period,
                printed=printed,
                label="Cleveland Fed nowcast",
                short="nowcast",
                source="Federal Reserve Bank of Cleveland, Inflation Nowcasting",
            )
    if not out:
        raise RuntimeError("Cleveland Fed nowcast file parsed to nothing")
    return out


def next_period(last_iso: str, frequency: str | None):
    d = dt.date.fromisoformat(last_iso)
    if frequency == "Q":
        m = d.month + 3
    else:
        m = d.month + 1
    y = d.year + (m - 1) // 12
    return dt.date(y, (m - 1) % 12 + 1, 1).isoformat()


def gdpnow(key: str):
    pts = fred_observations("GDPNOW", dt.date.today() - dt.timedelta(days=200), key)
    if not pts:
        raise RuntimeError("GDPNOW returned no observations")
    meta = fred_series_meta("GDPNOW", key)
    d, v = pts[-1]
    q = (int(d[5:7]) - 1) // 3 + 1
    return dict(value=round(v, 2), as_of=(meta.get("last_updated") or "")[:10] or d, period=d,
                label=f"Atlanta Fed GDPNow, Q{q} {d[:4]}", short="GDPNow",
                source="Federal Reserve Bank of Atlanta, GDPNow (via FRED)")


MONTH_CODES = "FGHJKMNQUVXZ"


def fedfunds_implied(next_meeting: str, key: str):
    """Rate priced for the month AFTER the next FOMC meeting, from the CME 30-day
    fed funds future for that month (Yahoo symbol ZQ<code><yy>.CBT). No meeting
    falls inside that month, so the contract's implied average = the
    post-meeting rate. Compared against the current effective rate (FRED EFFR)
    to state the move priced, in basis points."""
    d = dt.date.fromisoformat(next_meeting)
    nm = dt.date(d.year + (1 if d.month == 12 else 0), 1 if d.month == 12 else d.month + 1, 1)
    sym = f"ZQ{MONTH_CODES[nm.month - 1]}{nm.year % 100:02d}.CBT"
    resp = _get_json(YAHOO_CHART.format(sym=sym))
    res = (resp.get("chart") or {}).get("result") or []
    if not res:
        raise RuntimeError(f"Yahoo returned no result for {sym}: {(resp.get('chart') or {}).get('error')}")
    meta = res[0]["meta"]
    price = float(meta["regularMarketPrice"])
    ts = int(meta["regularMarketTime"])
    as_of = dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    implied = round(100.0 - price, 3)
    effr = fred_observations("EFFR", dt.date.today() - dt.timedelta(days=20), key)
    if not effr:
        raise RuntimeError("EFFR returned no observations")
    effr_d, effr_v = effr[-1]
    return dict(
        value=implied, as_of=as_of, period=next_meeting,
        label=f"Fed funds futures, {nm.strftime('%b %Y')} contract", short="futures",
        source=f"CME 30-day fed funds future for {nm.strftime('%B %Y')}, via Yahoo Finance; the current effective rate is from FRED",
        detail=dict(contract=sym, price=price, effr=effr_v, effr_as_of=effr_d,
                    priced_bp=round((implied - effr_v) * 100.0, 1)),
    )


# ── build ──────────────────────────────────────────────────────────────────
def load_indicator_history(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def build(key: str | None = None, calendar_path: str = CALENDAR_PATH,
          indicator_history_path: str = INDICATOR_HISTORY_PATH):
    key = key or os.environ.get("FRED_API_KEY", FRED_API_KEY_DEFAULT)
    today = dt.date.today()
    start = today.replace(year=today.year - YEARS - 1)   # one extra year so pct/diff have a prior obs
    problems: list[str] = []

    # Nowcasts first — a failure here is a failed run.
    cleveland = cleveland_nowcasts()
    gdp_nc = gdpnow(key)
    try:
        with open(calendar_path, encoding="utf-8") as f:
            cal = json.load(f)
        fomc_dates = sorted(e["date"] for e in cal.get("events", [])
                            if e.get("name") == "Fed decision (FOMC)" and e["date"] >= today.isoformat())
    except FileNotFoundError:
        fomc_dates = []
    if not fomc_dates:
        raise RuntimeError("no forward FOMC date in the calendar — cannot price the next meeting")
    ff_nc = fedfunds_implied(fomc_dates[0], key)

    ind_hist = load_indicator_history(indicator_history_path)
    fred_cache: dict[str, tuple[list, dict]] = {}

    series_out = {}
    good = 0
    for name, measures in RELEASES.items():
        ms = []
        for m in measures:
            entry = dict(label=m["label"], unit=m["unit"], decimals=m["decimals"], transform=m["transform"])
            if m.get("indicator"):
                s = ind_hist.get(m["indicator"]) or {}
                pts = [[p[0], float(p[1])] for p in (s.get("points") or []) if p[1] is not None]
                pts = window([[d, v * m["scale"]] for d, v in pts], YEARS)
                entry.update(points=pts, as_of=s.get("as_of"), frequency=s.get("freq"),
                             source=f"MacroTilt indicator feed ({s.get('source') or 'ISM'})")
            else:
                sid = m["fred"]
                if sid not in fred_cache:
                    fred_cache[sid] = (fred_observations(sid, start, key), fred_series_meta(sid, key))
                raw, meta = fred_cache[sid]
                pts = window(transform(raw, m["transform"], m["scale"], m["decimals"]), YEARS)
                entry.update(points=pts, as_of=(meta.get("last_updated") or "")[:10] or None,
                             frequency=meta.get("frequency"), fred_series=sid,
                             source=f"{FRED_VINTAGE_NOTE} — series {sid}")
            if len(entry["points"]) >= 24:
                good += 1
            elif len(entry["points"]) < 4:
                problems.append(f"{name} / {m['label']}: only {len(entry['points'])} points")

            nc = None
            spec = m.get("nowcast")
            if spec == "gdpnow":
                nc = gdp_nc
            elif spec == "fedfunds":
                nc = ff_nc
            elif spec and spec.startswith("cleveland:"):
                # The pending month is the one after the last print. A nowcast
                # for any other month — or for a month whose actual already
                # landed — is not "what comes next" and is not shown.
                want = next_period(entry["points"][-1][0], "M") if entry["points"] else None
                nc = cleveland.get((spec.split(":", 1)[1], want))
                if nc is None or nc.get("printed"):
                    raise RuntimeError(f"Cleveland nowcast for {name} / {m['label']} period {want} not found")
                nc = {k: v for k, v in nc.items() if k != "printed"}
            entry["nowcast"] = nc
            ms.append(entry)
        series_out[name] = dict(measures=ms)

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_years": YEARS,
        "counts": {"releases": len(series_out), "measures": sum(len(v["measures"]) for v in series_out.values()),
                   "measures_with_history": good},
        "sources": [
            "FRED series observations (api.stlouisfed.org) — actual prints, current vintage",
            "MacroTilt indicator feed — ISM Manufacturing and Services",
            "Federal Reserve Bank of Cleveland — inflation nowcast (CPI, core CPI, PCE, core PCE)",
            "Federal Reserve Bank of Atlanta — GDPNow, via FRED",
            "CME 30-day fed funds futures via Yahoo Finance — rate priced for the month after the next FOMC meeting",
        ],
        "notes": [
            "Actual prints are the current FRED vintage, revisions included — not the number as first released.",
            "No street consensus is shown (June 2026 decision: no paid vendor). Every forecast shown names its author.",
            "Points are dated by the period they describe; a nowcast is dated the same way and sits one period after the last print.",
        ],
        "problems": problems,
        "series": series_out,
    }
    return payload


def main(argv):
    out_path = argv[1] if len(argv) > 1 else OUT_PATH
    try:
        payload = build()
    except (RuntimeError, urllib.error.URLError, KeyError, ValueError) as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1
    if payload["counts"]["measures_with_history"] < 20:
        print(f"FATAL: only {payload['counts']['measures_with_history']} measures carry history", file=sys.stderr)
        for p in payload["problems"]:
            print(f"  problem: {p}", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    c = payload["counts"]
    print(f"wrote {out_path}: {c['releases']} releases, {c['measures']} measures, "
          f"{c['measures_with_history']} with 24+ prints")
    for p in payload["problems"]:
        print(f"  problem: {p}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
