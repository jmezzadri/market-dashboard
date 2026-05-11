#!/usr/bin/env python3
"""
refresh_ism.py — monthly scraper for ISM Manufacturing + Services PMI.

ISM data is license-restricted on FRED. We scrape the public investing.com
economic-calendar pages once a month (around the 5th, after both Mfg and Svc
have been published). Each page returns the most recent ~10 monthly releases
in raw HTML; we parse the headline value and the period date, compare against
public/indicator_history.json, and append any new readings.

Idempotent: re-running with no new releases is a no-op (writes nothing,
exits 0).

Sources:
  Manufacturing: https://www.investing.com/economic-calendar/ism-manufacturing-pmi-173
  Services:      https://www.investing.com/economic-calendar/ism-non-manufacturing-pmi-176

If investing.com layout changes or returns nothing parseable, the script
exits non-zero so the freshness watchdog can flag it (file a bug, drop the
latest XLSX manually as a fallback).

Joe directive 2026-05-10: this is path (a) — free scrape, monthly cron,
break-and-fix maintenance model.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"

UA = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

SOURCES = {
    "ism_mfg": "https://www.investing.com/economic-calendar/ism-manufacturing-pmi-173",
    "ism_svc": "https://www.investing.com/economic-calendar/ism-non-manufacturing-pmi-176",
}

MON3 = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,"Jul":7,"Aug":8,
        "Sep":9,"Oct":10,"Nov":11,"Dec":12}

# Two date formats appear in the page:
#   "May 01, 2026 (Apr)"  → release May 1 2026, period = Apr 2026
#   "2-Sep-14"            → release Sep 2 2014, period = release-month minus 1
PAT_LONG = re.compile(
    r"^([A-Z][a-z]{2})\s+\d+,\s*(\d{4})\s*\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\)"
)
PAT_SHORT = re.compile(r"^(\d+)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})")

# Each historic-row in the page is shaped:
#   <td>date</td> <td>time</td> <td...>actual</td> ...
# The date matches one of the two PAT_* patterns above. The actual is a
# number in xx.x or xx form, sanity-bound to the PMI [20, 80] range.
ROW_RE = re.compile(
    r"<td[^>]*>(?P<date>[A-Z][a-z]{2}\s+\d+,\s*\d{4}[^<]*?\([A-Z][a-z]{2}\)|\d{1,2}-[A-Z][a-z]{2}-\d{2})</td>"
    r"\s*<td[^>]*>[^<]*</td>"
    r"\s*<td[^>]*>(?P<actual>\d{2}\.\d|\d{2})</td>"
)


def parse_period(s: str) -> Optional[dt.date]:
    s = s.strip()
    m = PAT_LONG.match(s)
    if m:
        period_mon = MON3[m.group(3)]
        rel_mon = MON3[m.group(1)]
        rel_year = int(m.group(2))
        period_year = rel_year - 1 if (rel_mon == 1 and period_mon == 12) else rel_year
        return dt.date(period_year, period_mon, 1)
    m = PAT_SHORT.match(s)
    if m:
        rel_mon = MON3[m.group(2)]
        rel_yr = 2000 + int(m.group(3))
        period_mon = rel_mon - 1
        period_year = rel_yr
        if period_mon == 0:
            period_mon, period_year = 12, period_year - 1
        return dt.date(period_year, period_mon, 1)
    return None


def fetch_html(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def scrape(url: str) -> List[Tuple[str, float]]:
    """Return [(period_iso, value), ...] from one investing.com PMI page."""
    html = fetch_html(url)
    out: List[Tuple[str, float]] = []
    for m in ROW_RE.finditer(html):
        period = parse_period(m.group("date"))
        if period is None:
            continue
        try:
            v = float(m.group("actual"))
        except ValueError:
            continue
        if not (20 <= v <= 80):
            continue
        out.append((period.isoformat(), round(v, 1)))
    return out


def main() -> int:
    if not INDICATOR_HISTORY.exists():
        print(f"FATAL: {INDICATOR_HISTORY} missing", file=sys.stderr)
        return 2

    hist = json.loads(INDICATOR_HISTORY.read_text())
    appended = 0
    new_readings: Dict[str, List[Tuple[str, float]]] = {}

    for ind_id, url in SOURCES.items():
        print(f"\n[{ind_id}] scraping {url}")
        try:
            scraped = scrape(url)
        except Exception as e:
            print(f"  FETCH/PARSE FAILED: {e}", file=sys.stderr)
            return 2
        if not scraped:
            print(f"  no rows parsed — page layout may have changed", file=sys.stderr)
            return 2

        # Existing series (or empty list if first run)
        series = hist.setdefault(ind_id, {
            "freq": "M",
            "unit": "index (50=expand)",
            "as_of": dt.date.today().isoformat(),
            "source": "investing.com (refresh_ism.py monthly scrape)",
            "points": [],
        })
        existing_dates = {d for d, _ in series.get("points", [])}

        added: List[Tuple[str, float]] = []
        for period_iso, value in scraped:
            if period_iso in existing_dates:
                continue
            added.append((period_iso, value))

        if added:
            print(f"  NEW readings to append:")
            for p, v in sorted(added):
                print(f"    {p} = {v}")
            new_readings[ind_id] = added
            # Merge + sort
            merged = list(series.get("points") or []) + [[p, v] for p, v in added]
            merged.sort()
            series["points"] = merged
            series["as_of"] = dt.date.today().isoformat()
            appended += len(added)
        else:
            print(f"  no new readings (latest scraped: {scraped[0][0]} = {scraped[0][1]})")

    if appended == 0:
        print(f"\nNo new ISM data — exiting cleanly without writing.")
        return 0

    # Preserve compact format (file uses single-line JSON convention)
    src = INDICATOR_HISTORY.read_text()
    is_compact = src.count("\n") < 5
    out = (json.dumps(hist, separators=(",", ":")) if is_compact
           else json.dumps(hist, indent=2, ensure_ascii=False))
    INDICATOR_HISTORY.write_text(out + "\n")

    print(f"\nWrote {appended} new ISM reading(s) to {INDICATOR_HISTORY}")
    for ind, rows in new_readings.items():
        for p, v in sorted(rows):
            print(f"  {ind}: {p} = {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
