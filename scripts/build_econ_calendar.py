#!/usr/bin/env python3
"""Economic release calendar — builds public/econ_calendar.json.

WHY THIS EXISTS
---------------
The homepage "Upcoming data" tile ran off a hand-typed array inside
src/overhaul/lib/econCalendar.js. That array ended 2026-07-31, so from
2026-08-01 the tile said "No scheduled releases coming up." on every single
day — including 2026-08-13, the morning the Producer Price Index printed at
8:30. A calendar that has to be re-typed every month is a calendar that is
wrong most months. This script replaces it with a real feed.

SOURCES (all free, no vendor, no key beyond the FRED key we already hold)
------------------------------------------------------------------------
1. FRED release calendar — api.stlouisfed.org/fred/release/dates. FRED
   publishes FORWARD dates for the statistical agencies' releases (BLS, BEA,
   Census, Federal Reserve). One provider for the whole government block, in
   line with the ONE-provider-per-source governance rule.
2. federalreserve.gov/monetarypolicy/fomccalendars.htm — FOMC meeting dates.
   FRED's release 101 ("FOMC Press Release") stamps a date every calendar day
   and is useless as a schedule; the Board's own calendar is authoritative.
3. ISM Manufacturing / Services — ISM is a private body and is not in FRED.
   Its schedule is a rule, not a feed: Manufacturing on the 1st business day
   of the month, Services on the 3rd, both 10:00 AM ET. Computed here against
   the US federal holiday calendar.
4. UMich consumer sentiment PRELIMINARY — FRED's release 91 lists only the
   FINAL dates (bug #1251 found the Sep 11 2026 prelim missing). The prelim
   lands two Fridays before its final, 10:00 AM ET — computed off the FRED
   final dates; see build_umich_prelim_events for the seam proof.
(Later sources — ECB/BoE/BoJ, USDA, the US election and the Treasury
 quarterly refunding — are documented at their own blocks below.)

RULES THIS SCRIPT OBEYS (LESSONS 4.21 — sourced-or-omitted)
-----------------------------------------------------------
* No reference period is printed. FRED gives the release DATE, not the month
  the data covers, and the lag is not uniform (the jobs report on the 4th
  covers last month; factory orders on the 2nd covers the month before that).
  A derived "(Jul)" would be wrong for a whole class of releases, so the name
  carries no period at all. Accurate beats cute.
* Release TIMES are hardcoded per release. They are stable published policy
  (BLS/BEA/Census majors at 8:30 AM ET, ISM/JOLTS/home sales at 10:00 AM,
  FOMC at 2:00 PM), not data — but they are marked in the output so a future
  reader knows they did not come off the wire.
* Two FRED releases bundle two distinct reports under one release id. They are
  split by the pair rule documented at PAIRED_RELEASES, which is verified over
  three years of history before it is applied; when a date does not pair, the
  honest release-family label is used instead of a guess.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

FRED_API_KEY_DEFAULT = "e1696db1c3f8bb036993f40c61aad0d5"
FRED_BASE = "https://api.stlouisfed.org/fred"
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
OUT_PATH = "public/econ_calendar.json"

WEEKS_FORWARD = 10
DAYS_BACK = 7  # keep a short tail so "released this morning" is still visible

# US federal holidays — the calendar ISM and the statistical agencies observe.
# (Deliberately NOT the NYSE calendar: Good Friday is a market holiday but a
# normal working day for BLS, and Columbus/Veterans Day are the reverse.)
FEDERAL_HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26",
    "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18",
    "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25",
    "2027-12-24",
}

# tier 1 = the releases that move the whole market and that a PM plans around
# tier 2 = second-order but market-relevant
# tier 3 = background / weekly plumbing
RELEASES = {
    50:  dict(name="Jobs report",                 short="Jobs",      time="8:30 AM",  tier=1, cat="Labor",
              blurb="Nonfarm payrolls, the unemployment rate and average hourly earnings."),
    10:  dict(name="Consumer prices (CPI)",       short="CPI",       time="8:30 AM",  tier=1, cat="Inflation",
              blurb="Headline and core consumer inflation."),
    46:  dict(name="Producer prices (PPI)",       short="PPI",       time="8:30 AM",  tier=1, cat="Inflation",
              blurb="Prices received by producers — the pipeline into consumer inflation."),
    54:  dict(name="Personal income & PCE prices", short="PCE",      time="8:30 AM",  tier=1, cat="Inflation",
              blurb="Household income and spending with the PCE price index, the Fed's preferred inflation gauge."),
    53:  dict(name="GDP",                          short="GDP",      time="8:30 AM",  tier=1, cat="Growth",
              blurb="Quarterly economic growth, in three successive estimates."),
    9:   dict(name="Retail sales",                 short="Retail",   time="8:30 AM",  tier=1, cat="Consumer",
              blurb="Advance monthly retail and food-service sales — the timeliest read on the consumer."),
    192: dict(name="Job openings (JOLTS)",         short="JOLTS",    time="10:00 AM", tier=1, cat="Labor",
              blurb="Job openings, hires, quits and layoffs — labor demand rather than headcount."),
    180: dict(name="Jobless claims",               short="Claims",   time="8:30 AM",  tier=2, cat="Labor",
              blurb="Weekly initial and continuing unemployment claims — the highest-frequency labor signal."),
    13:  dict(name="Industrial production",        short="Ind Prod", time="9:15 AM",  tier=2, cat="Growth",
              blurb="Factory, mining and utility output plus capacity utilisation."),
    # 291 (Existing home sales) REMOVED 2026-10-13 (bug #1267): FRED's release
    # calendar returns no dates for it any more, silently, so the event vanished
    # from the calendar. It now comes from NAR's own published schedule below.
    97:  dict(name="New home sales",               short="New homes", time="10:00 AM", tier=2, cat="Housing",
              blurb="Contracts signed on newly built homes — the rate-sensitive edge of housing."),
    51:  dict(name="Trade balance",                short="Trade",    time="8:30 AM",  tier=2, cat="Trade",
              blurb="Goods and services imports versus exports."),
    188: dict(name="Import & export prices",       short="Imp/Exp",  time="8:30 AM",  tier=2, cat="Inflation",
              blurb="Traded-goods prices — where a weaker dollar or a tariff shows up first."),
    11:  dict(name="Employment cost index",        short="ECI",      time="8:30 AM",  tier=1, cat="Labor",
              blurb="Wages and benefits per hour worked — the cleanest read on labor-cost inflation."),
    47:  dict(name="Productivity & unit labor costs", short="Prod", time="8:30 AM",  tier=2, cat="Labor",
              blurb="Output per hour and what each unit of output costs in labor."),
    229: dict(name="Construction spending",        short="Constr",   time="10:00 AM", tier=3, cat="Housing",
              blurb="Value of construction put in place, residential and non-residential."),
    290: dict(name="Wholesale inventories",        short="Wholesale", time="10:00 AM", tier=3, cat="Growth",
              blurb="Wholesale-level sales and inventories — an input to the GDP inventory line."),
    25:  dict(name="Business inventories",         short="Invent.",  time="10:00 AM", tier=3, cat="Growth",
              blurb="Manufacturing and trade inventories and sales."),
    14:  dict(name="Consumer credit",              short="Credit",   time="3:00 PM",  tier=3, cat="Consumer",
              blurb="Revolving and non-revolving household borrowing."),
    219: dict(name="Chicago Fed activity index",   short="CFNAI",    time="8:30 AM",  tier=3, cat="Growth",
              blurb="An 85-indicator composite of national economic activity."),
    321: dict(name="Empire State survey",          short="Empire",   time="8:30 AM",  tier=2, cat="Surveys",
              blurb="New York Fed manufacturing survey — the first regional read each month."),
    351: dict(name="Philadelphia Fed survey",      short="Philly",   time="8:30 AM",  tier=2, cat="Surveys",
              blurb="Philadelphia Fed manufacturing outlook survey."),
    352: dict(name="Philadelphia Fed services survey", short="Philly Svc", time="8:30 AM", tier=3, cat="Surveys",
              blurb="Philadelphia Fed non-manufacturing outlook survey."),
    91:  dict(name="Consumer sentiment (Michigan, final)", short="UMich final", time="10:00 AM", tier=2, cat="Surveys",
              blurb="University of Michigan consumer sentiment and household inflation expectations, final reading."),
    435: dict(name="Advance goods trade & inventories", short="Adv Econ", time="8:30 AM", tier=3, cat="Trade",
              blurb="Early estimate of the goods trade gap and retail/wholesale inventories."),
    3:   dict(name="Foreign Treasury flows (TIC)", short="TIC",      time="4:00 PM",  tier=3, cat="Flows",
              blurb="Cross-border purchases of US securities — who is funding the deficit."),
    20:  dict(name="Fed balance sheet (H.4.1)",    short="H.4.1",    time="4:30 PM",  tier=3, cat="Liquidity",
              blurb="Federal Reserve assets, reserve balances and the Treasury General Account."),
}

# Two FRED release ids each carry two distinct market-facing reports. Verified
# over 2023-2026 (99 dates, 43 clean pairs): the reports always arrive as a
# late-month / early-next-month couple, in that order. When a date has no
# partner within 12 days the pair cannot be resolved and the honest
# release-family label is used instead of a coin flip.
PAIRED_RELEASES = {
    95: dict(
        first=dict(name="Durable goods orders", short="Durables", time="8:30 AM", tier=2, cat="Growth",
                   blurb="Advance report on orders for long-lived manufactured goods — a proxy for capex intent."),
        second=dict(name="Factory orders", short="Factory", time="10:00 AM", tier=3, cat="Growth",
                    blurb="Full manufacturers' shipments, inventories and orders."),
        fallback=dict(name="Durable goods / factory orders", short="M3", time="8:30 AM", tier=3, cat="Growth",
                      blurb="Census M3 survey of manufacturers' shipments, inventories and orders."),
        max_gap_days=12,
    ),
    27: dict(
        first=dict(name="Housing starts & permits", short="Starts", time="8:30 AM", tier=2, cat="Housing",
                   blurb="New residential construction — starts, permits and completions."),
        second=dict(name="Building permits (final)", short="Permits", time="8:30 AM", tier=3, cat="Housing",
                    blurb="Final building-permit counts for the prior month."),
        fallback=dict(name="New residential construction", short="Housing", time="8:30 AM", tier=2, cat="Housing",
                      blurb="Census new residential construction release."),
        max_gap_days=12,
    ),
}


# ── helpers ────────────────────────────────────────────────────────────────
def _get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "MacroTilt/econ-calendar"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "MacroTilt/econ-calendar"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def _get_browser_text(url: str, timeout: int = 30) -> str:
    """_get_text with ordinary browser headers, for hosts whose WAF rejects
    plain-UA scripts (nass.usda.gov, 2026-09-29)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/128.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def is_business_day(d: dt.date) -> bool:
    return d.weekday() < 5 and d.isoformat() not in FEDERAL_HOLIDAYS


def nth_business_day(year: int, month: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    count = 0
    while True:
        if is_business_day(d):
            count += 1
            if count == n:
                return d
        d += dt.timedelta(days=1)


# ── source 1: FRED release calendar ────────────────────────────────────────
def fred_release_dates(release_id: int, start: dt.date, end: dt.date, key: str):
    params = urllib.parse.urlencode({
        "release_id": release_id,
        "api_key": key,
        "file_type": "json",
        "realtime_start": start.isoformat(),
        "realtime_end": end.isoformat(),
        "include_release_dates_with_no_data": "true",
        "sort_order": "asc",
        "limit": 60,
    })
    data = _get_json(f"{FRED_BASE}/release/dates?{params}")
    return [dt.date.fromisoformat(x["date"]) for x in data.get("release_dates", [])]


def build_fred_events(start: dt.date, end: dt.date, key: str):
    events, problems = [], []

    for rid, meta in RELEASES.items():
        try:
            dates = fred_release_dates(rid, start, end, key)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"release {rid} ({meta['name']}): {exc}")
            continue
        # 2026-10-13 (bug #1267): FRED returned an empty list for release 291 and
        # existing home sales vanished with no trace. Every release here is at
        # least monthly except the quarterly ECI (11) and productivity (47), so
        # an empty list across a ten-week window is a problem, not a quiet month.
        if not dates and rid not in (11, 47):
            problems.append(f"release {rid} ({meta['name']}): FRED returned no dates in the window")
        for d in dates:
            events.append(dict(
                date=d.isoformat(), time_et=meta["time"], name=meta["name"], short=meta["short"],
                tier=meta["tier"], category=meta["cat"], blurb=meta["blurb"],
                source="FRED release calendar", time_source="published release policy",
            ))

    # Paired releases need a wider window than the display window so a pair that
    # straddles the edge still resolves.
    for rid, spec in PAIRED_RELEASES.items():
        try:
            dates = fred_release_dates(rid, start - dt.timedelta(days=20), end + dt.timedelta(days=20), key)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"release {rid} (paired): {exc}")
            continue
        labelled, i = [], 0
        while i < len(dates):
            if i + 1 < len(dates) and (dates[i + 1] - dates[i]).days <= spec["max_gap_days"]:
                labelled.append((dates[i], spec["first"]))
                labelled.append((dates[i + 1], spec["second"]))
                i += 2
            else:
                labelled.append((dates[i], spec["fallback"]))
                i += 1
        for d, meta in labelled:
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et=meta["time"], name=meta["name"], short=meta["short"],
                tier=meta["tier"], category=meta["cat"], blurb=meta["blurb"],
                source="FRED release calendar", time_source="published release policy",
            ))

    return events, problems


# ── source 2: the Board's own FOMC calendar ────────────────────────────────
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}


def build_fomc_events(start: dt.date, end: dt.date):
    """Parse federalreserve.gov's FOMC calendar.

    Each meeting row carries a month and a day range ("27-28", "17-18*"). The
    trailing asterisk marks a meeting that publishes the Summary of Economic
    Projections. The rate decision lands on the LAST day of the range at
    2:00 PM ET, so that is the date we schedule.
    """
    events, problems = [], []
    try:
        html = _get_text(FOMC_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"FOMC calendar fetch failed: {exc}"]

    for panel in re.finditer(
        r'<a id="\d+">(\d{4}) FOMC Meetings</a>([\s\S]*?)(?=<a id="\d+">\d{4} FOMC Meetings</a>|\Z)', html
    ):
        year = int(panel.group(1))
        block = panel.group(2)
        rows = re.findall(
            r'fomc-meeting__month[^>]*>\s*<strong>\s*([A-Za-z]+)[\s/A-Za-z]*</strong>'
            r'[\s\S]{0,400}?fomc-meeting__date[^>]*>\s*([0-9\-–\*\s]+?)\s*<',
            block)
        for month_name, day_txt in rows:
            month = MONTHS.get(month_name.strip().title())
            if not month:
                continue
            projections = "*" in day_txt
            nums = re.findall(r"\d+", day_txt)
            if not nums:
                continue
            day = int(nums[-1])
            # A range like "28-1" or "29-2" spills into the next month.
            m, y = month, year
            if len(nums) == 2 and int(nums[-1]) < int(nums[0]):
                m += 1
                if m == 13:
                    m, y = 1, y + 1
            try:
                d = dt.date(y, m, day)
            except ValueError:
                problems.append(f"FOMC row unparsed: {year} {month_name} {day_txt}")
                continue
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et="2:00 PM", name="Fed decision (FOMC)", short="FOMC",
                tier=1, category="Policy",
                blurb=("Federal Reserve rate decision and statement, with the quarterly rate and economic "
                       "projections and a 2:30 PM press conference." if projections
                       else "Federal Reserve rate decision and statement, followed by a 2:30 PM press conference."),
                source="Federal Reserve FOMC calendar", time_source="published release policy",
            ))
    if not events:
        problems.append("FOMC calendar parsed to zero meetings in window")
    return events, problems


# ── source 3: ISM, computed ────────────────────────────────────────────────
def build_ism_events(start: dt.date, end: dt.date):
    """ISM is private and absent from FRED. Its schedule is a published rule:
    Manufacturing on the 1st business day of each month, Services on the 3rd,
    both at 10:00 AM ET. Verified against the 2026 prints (Manufacturing for
    June landed 2026-07-01, Services 2026-07-06 — the 1st and 3rd business
    days of July)."""
    events = []
    y, m = start.year, start.month
    for _ in range(6):
        for n, meta in ((1, dict(name="ISM Manufacturing", short="ISM Mfg",
                                 blurb="Factory-sector survey; above 50 means the sector is expanding.")),
                        (3, dict(name="ISM Services", short="ISM Svc",
                                 blurb="Services-sector survey — the larger share of the economy."))):
            d = nth_business_day(y, m, n)
            if start <= d <= end:
                events.append(dict(
                    date=d.isoformat(), time_et="10:00 AM", name=meta["name"], short=meta["short"],
                    tier=1, category="Surveys", blurb=meta["blurb"],
                    source="ISM published schedule (computed)",
                    time_source="published release policy",
                ))
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return events


# ── source 3b: NAR existing home sales + NFIB, from the publishers ──────────
# 2026-10-13 (bug #1267): Existing home sales disappeared from the calendar
# because FRED's release calendar stopped listing NAR dates (no error, just an
# empty list), and NFIB was never carried. Both now come from the publisher.
#
# NAR publishes a fixed annual table, not a rule (2026 dates moved earlier in
# the month than the old ~20th-25th slot), so per LESSONS 5.14 it is FETCHED
# from NAR's rolling schedule page every run, not typed in. Rows read
# "Tue., Oct. 13 | September Existing-Home Sales"; all releases 10:00 AM ET.
# NAR_FALLBACK is the 2026 table as published ("NAR Releases 2026 Statistical
# News Release Schedule", nar.realtor/newsroom) — used ONLY when the fetch
# fails, and that use is always filed as a problem so it cannot go quietly stale.
NAR_SCHEDULE_URL = "https://www.nar.realtor/press-releases/nar-statistical-news-release-schedule"
NAR_FALLBACK = ["2026-01-14", "2026-02-12", "2026-03-10", "2026-04-13", "2026-05-11", "2026-06-09",
                "2026-07-09", "2026-08-11", "2026-09-10", "2026-10-13", "2026-11-12", "2026-12-09"]
_NAR_ROW_RE = re.compile(
    r"(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri)\.?,?\s+([A-Z][a-z]{2,8})\.?\s+(\d{1,2})\b"
    r"[\s|]*(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+Existing-Home\s+Sales")


def parse_nar_schedule(html: str):
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&nbsp;|&#160;", " ", text)
    text = re.sub(r"\s+", " ", text)
    ym = re.search(r"(20\d\d) Statistical News Release Schedule", text)
    if not ym:
        return []
    year, prev_month, out = int(ym.group(1)), 0, []
    for mon, day in _NAR_ROW_RE.findall(text):
        m = MONTHS_ABBR.get(mon[:3].lower())
        if not m:
            continue
        if m < prev_month:          # table ran past December into next year
            year += 1
        prev_month = m
        out.append(dt.date(year, m, int(day)))
    return out


def build_nar_events(start: dt.date, end: dt.date):
    events, problems = [], []
    try:
        dates = parse_nar_schedule(_get_browser_text(NAR_SCHEDULE_URL))
        if not dates:
            raise ValueError("no Existing-Home Sales rows parsed")
        source = "NAR statistical news release schedule"
    except Exception as exc:  # noqa: BLE001
        dates = [dt.date.fromisoformat(x) for x in NAR_FALLBACK]
        source = "NAR 2026 release schedule (stored copy)"
        problems.append(f"NAR existing home sales: live schedule fetch failed ({exc}); used stored 2026 table")
    for d in sorted(set(dates)):
        if start <= d <= end:
            events.append(dict(
                date=d.isoformat(), time_et="10:00 AM", name="Existing home sales", short="Existing",
                tier=2, category="Housing",
                blurb="Closed sales of previously owned homes — the bulk of the housing market.",
                source=source, time_source="published release policy",
            ))
    if dates and end > max(dates) + dt.timedelta(days=35):   # a month with no row = schedule not yet loaded
        problems.append(f"NAR existing home sales: schedule ends {max(dates).isoformat()}, "
                        f"window runs to {end.isoformat()}")
    return events, problems


def build_nfib_events(start: dt.date, end: dt.date):
    """NFIB Small Business Optimism Index: "released on the second Tuesday of
    each month" (nfib.com SBET page), 6:00 AM ET. Verified: Sep 2026 index
    landed Tue 2026-10-13, the second Tuesday of October."""
    events = []
    y, m = start.year, start.month
    for _ in range(6):
        d = dt.date(y, m, 1)
        d += dt.timedelta(days=(1 - d.weekday()) % 7)   # first Tuesday
        d += dt.timedelta(days=7)                        # second Tuesday
        while not is_business_day(d):
            d += dt.timedelta(days=1)
        if start <= d <= end:
            events.append(dict(
                date=d.isoformat(), time_et="6:00 AM", name="Small business optimism (NFIB)", short="NFIB",
                tier=3, category="Surveys",
                blurb="Monthly survey of small-business owners — hiring plans, prices charged and outlook.",
                source="NFIB published schedule (computed)", time_source="published release policy",
            ))
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return events


# ── source 4: UMich preliminary, computed off the FRED finals ──────────────
def build_umich_prelim_events(start: dt.date, end: dt.date, key: str):
    """Bug #1251: FRED's release 91 carries only the Michigan FINAL dates, so
    the preliminary reading — the market-moving print, whose household
    inflation-expectations gauge often lands inside FOMC week — was never on
    the calendar.

    UMich publishes each release date but no long forward schedule, so the
    prelim is computed: it lands exactly two Fridays (14 days) before its
    final, 10:00 AM ET. Seam proven per LESSONS 4.28 before trusting the rule:
    actual prelim dates 2025-09-12, 2025-10-10, 2025-11-07, 2025-12-05 are
    each their FRED final minus 14 days, and sca.isr.umich.edu itself lists
    the next release as Fri 2026-09-11 prelim = 2026-09-25 final minus 14.
    Finals are pulled 3 weeks past the display window so a prelim whose final
    falls outside it still lands. A computed date that is not a Friday means
    the rule broke — it is skipped and reported, never published as a guess."""
    events, problems = [], []
    try:
        finals = fred_release_dates(91, start, end + dt.timedelta(days=21), key)
    except Exception as exc:  # noqa: BLE001
        return [], [f"release 91 (UMich prelim derivation): {exc}"]
    for f in finals:
        p = f - dt.timedelta(days=14)
        if not (start <= p <= end):
            continue
        if p.weekday() != 4:
            problems.append(f"UMich prelim computed to a non-Friday ({p}) from final {f} — skipped")
            continue
        events.append(dict(
            date=p.isoformat(), time_et="10:00 AM",
            name="Consumer sentiment (Michigan, preliminary)", short="UMich prelim",
            tier=2, category="Surveys",
            blurb="University of Michigan consumer sentiment, preliminary reading — the first look at household inflation expectations for the month.",
            source="UMich release schedule (computed: two Fridays before the final)",
            time_source="published release policy",
        ))
    if not events:
        problems.append("UMich prelim derivation produced zero events in window")
    return events, problems


# ── source 5: foreign central-bank decisions (bug #1254) ───────────────────
# The live Trade Idea book can carry FX and rates calls (a long EUR/USD call
# was live when the ECB's 2026-09-10 decision was absent from this feed), so
# the calendar carries the G3-ex-Fed decision dates: ECB, Bank of England,
# Bank of Japan. One provider per source, and the provider is the central
# bank itself — the same authority pattern as the FOMC block above.
#
# Times are the banks' standing publication times converted at the usual
# CET/UK/JST-to-ET offsets and marked as policy, not wire, per this script's
# standing rule. (For a few weeks a year DST transitions misalign by an hour;
# the date, which is what the calendar exists for, is unaffected.)

ECB_URL = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"
BOE_URL = "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates"
BOJ_URL = "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm"

MONTHS_ABBR = {m[:3].lower(): i for m, i in MONTHS.items()}


def build_ecb_events(start: dt.date, end: dt.date):
    """ECB Governing Council monetary policy decisions.

    The ECB's own calendar page lists every Governing Council entry as
    <dt>DD/MM/YYYY</dt><dd>description</dd>. The DECISION day is the entry
    described as a "monetary policy meeting ... followed by press conference"
    (Day 2). "Non-monetary policy" meetings and Day-1 entries never carry the
    press-conference clause, so that clause is the filter. Decision statement
    2:15 PM CET = 8:15 AM ET, press conference 2:45 PM CET."""
    events, problems = [], []
    try:
        html = _get_text(ECB_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"ECB calendar fetch failed: {exc}"]
    for m in re.finditer(r"<dt>\s*(\d{2})/(\d{2})/(\d{4})\s*</dt>\s*<dd>(.*?)</dd>", html, re.S):
        day, month, year, desc = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
        if "monetary policy meeting" not in desc.lower() or "non-monetary" in desc.lower():
            continue
        if "followed by press conference" not in desc.lower():
            continue  # Day 1 of the two-day meeting; the decision lands on Day 2
        try:
            d = dt.date(year, month, day)
        except ValueError:
            problems.append(f"ECB row unparsed: {m.group(0)[:80]}")
            continue
        if not (start <= d <= end):
            continue
        events.append(dict(
            date=d.isoformat(), time_et="8:15 AM", name="ECB decision (Governing Council)", short="ECB",
            tier=1, category="Policy",
            blurb="European Central Bank rate decision and statement, with a 8:45 AM ET press conference.",
            source="ECB Governing Council calendar (ecb.europa.eu)", time_source="published release policy",
        ))
    if not events:
        problems.append("ECB calendar parsed to zero decisions in window")
    return events, problems


def build_boe_events(start: dt.date, end: dt.date):
    """Bank of England MPC announcements.

    The Bank's "upcoming MPC dates" page lists, per year block ("2026
    confirmed dates", "2027 provisional dates"), each announcement as
    "Thursday 18 June — June MPC Summary and minutes". The weekday-prefixed
    date followed by "MPC Summary" is the filter; the news list further down
    the page carries bare dates and never the weekday prefix, so it cannot
    leak in. Announcements land 12:00 London = 7:00 AM ET."""
    events, problems = [], []
    try:
        html = _get_text(BOE_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"BoE calendar fetch failed: {exc}"]
    import html as _html
    txt = re.sub(r"<[^>]+>", " ", _html.unescape(html)).replace("\xa0", " ")
    txt = re.sub(r"\s+", " ", txt)
    blocks = re.split(r"(\d{4})\s+(?:confirmed|provisional)\s+dates", txt)
    # re.split leaves [pre, year, block, year, block, ...]
    for year_s, block in zip(blocks[1::2], blocks[2::2]):
        year = int(year_s)
        for wm in re.finditer(
            r"(?:Monday|Tuesday|Wednesday|Thursday|Friday)\s+(\d{1,2})\s+([A-Za-z]+)"
            r"(?=[\sA-Za-z]{0,40}MPC Summary)", block):
            day, month = int(wm.group(1)), MONTHS.get(wm.group(2).title())
            if not month:
                problems.append(f"BoE month unparsed: {wm.group(0)[:60]}")
                continue
            try:
                d = dt.date(year, month, day)
            except ValueError:
                problems.append(f"BoE row unparsed: {wm.group(0)[:60]}")
                continue
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et="7:00 AM", name="Bank of England decision (MPC)", short="BoE",
                tier=1, category="Policy",
                blurb="Bank of England rate decision with the MPC vote split, published at noon London time.",
                source="Bank of England MPC dates (bankofengland.co.uk)", time_source="published release policy",
            ))
    if not events:
        problems.append("BoE calendar parsed to zero decisions in window")
    return events, problems


def build_boj_events(start: dt.date, end: dt.date):
    """Bank of Japan Monetary Policy Meeting decisions.

    The BoJ's English MPM schedule page carries one table per year
    (id="p2026", ...); the first cell of each row is the meeting date range,
    e.g. "Sept. 17 (Thurs.), 18 (Fri.)". The statement is released around
    midday Tokyo on the FINAL day — overnight in New York — so the entry is
    dated to the final meeting day (JST) and the time reads "overnight"."""
    events, problems = [], []
    try:
        html = _get_text(BOJ_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"BoJ calendar fetch failed: {exc}"]
    for ym in re.finditer(r'id="p(\d{4})"', html):
        year = int(ym.group(1))
        seg = html[ym.end():html.find("</table>", ym.end())]
        for row in re.finditer(r"<tr>\s*<td[^>]*>(.*?)</td>", seg, re.S):
            cell = re.sub(r"<[^>]+>", " ", row.group(1))
            cell = re.sub(r"\s+", " ", cell).strip()
            toks = re.findall(r"(?:([A-Z][a-z]+)\.?\s*)?(\d{1,2})\s*\(", cell)
            if not toks:
                continue
            month = None
            last = None
            ok = True
            for mon_s, day_s in toks:
                if mon_s:
                    month = MONTHS_ABBR.get(mon_s[:3].lower())
                if not month:
                    ok = False
                    break
                last = (month, int(day_s))
            if not ok or last is None:
                problems.append(f"BoJ row unparsed: {cell[:60]}")
                continue
            try:
                d = dt.date(year, last[0], last[1])
            except ValueError:
                problems.append(f"BoJ row unparsed: {cell[:60]}")
                continue
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et="overnight", name="Bank of Japan decision (MPM)", short="BoJ",
                tier=1, category="Policy",
                blurb="Bank of Japan rate decision, released around midday Tokyo on the meeting's final day — overnight for US markets.",
                source="Bank of Japan MPM schedule (boj.or.jp)", time_source="published release policy",
            ))
    if not events:
        problems.append("BoJ calendar parsed to zero decisions in window")
    return events, problems


def build_foreign_cb_events(start: dt.date, end: dt.date):
    events, problems = [], []
    for fn in (build_ecb_events, build_boe_events, build_boj_events):
        ev, pr = fn(start, end)
        events += ev
        problems += pr
    return events, problems


# ── source 6: USDA releases (bug #1258) ────────────────────────────────────
# The live Trade Idea book can carry agricultural commodity calls (a WEAT
# short was live when the Sep 30 2026 quarterly Grain Stocks — direct event
# risk to it — was absent from this feed), so the calendar carries the two
# tier-1 USDA reports that move the grain complex: quarterly Grain Stocks and
# the monthly WASDE. One provider per source, and the provider is the agency
# itself — the same authority pattern as the FOMC and foreign-CB blocks above.
#
# Grain Stocks comes from NASS's own release calendar (list view — one table
# row per release: "Wed, 09/30/26 | 12:00 pm ET | Grain Stocks"). WASDE is a
# WAOB/OCE report and is NOT in the NASS calendar; its dates come from the
# OCE WASDE page, which publishes the year's dates as a single sentence:
# "In 2026 the WASDE report will be released on Jan. 12, Feb. 10, ... and
# Dec. 10." (verified 2026-09-29). Both land 12:00 noon ET per the agencies'
# standing release policy.

NASS_CAL_URL = ("https://www.nass.usda.gov/Publications/Calendar/"
                "reports_by_date.php?view=l&month={month:02d}&year={year}")
WASDE_URL = ("https://www.usda.gov/about-usda/general-information/staff-offices/"
             "office-chief-economist/commodity-markets/wasde-report")

_NASS_ROW_RE = re.compile(
    r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{2})/(\d{2})/(\d{2})\s+"
    r"(\d{1,2}):(\d{2})\s*([ap]m)\s*ET\s*(.*?)"
    r"(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d{2}/\d{2}/\d{2}|$)", re.S)


def build_usda_nass_events(start: dt.date, end: dt.date):
    """Quarterly Grain Stocks from the NASS release calendar (list view).

    Parses the tag-stripped page text rather than the table markup so a
    markup reshuffle degrades to "parsed zero rows" (a named problem) rather
    than a silent miss. The title is whatever follows the time up to the next
    weekday-date token; the trailing status column ("Report Pending") is
    ignored by matching the report name at the start of that span."""
    events, problems = [], []
    months, cur = [], dt.date(start.year, start.month, 1)
    while cur <= end:
        months.append(cur)
        cur = (cur + dt.timedelta(days=32)).replace(day=1)
    rows_parsed = 0
    for mth in months:
        url = NASS_CAL_URL.format(month=mth.month, year=mth.year)
        try:
            # nass.usda.gov sits behind a WAF that 403s non-browser user
            # agents (verified 2026-09-29: the plain MacroTilt UA drew 403 on
            # every month from the Actions runner while the page served fine
            # to a browser). Send ordinary browser headers for this host only.
            html = _get_browser_text(url)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"NASS calendar fetch failed ({mth:%Y-%m}): {exc}")
            continue
        txt = re.sub(r"<[^>]+>", " ", html)
        txt = re.sub(r"\s+", " ", txt)
        for m in _NASS_ROW_RE.finditer(txt):
            rows_parsed += 1
            title_span = m.group(7).strip()
            if not re.match(r"[-\s]*Grain Stocks\b", title_span):
                continue
            mo, dy, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                d = dt.date(2000 + yy, mo, dy)
            except ValueError:
                problems.append(f"NASS row unparsed: {m.group(0)[:60]}")
                continue
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et="12:00 PM", name="USDA Grain Stocks", short="Grain Stk",
                tier=1, category="Agriculture",
                blurb="USDA's quarterly count of corn, soybean and wheat inventories — a recurring source of limit moves in grain futures, released at noon ET.",
                source="USDA NASS release calendar (nass.usda.gov)", time_source="published release policy",
            ))
    if rows_parsed == 0 and months:
        problems.append("NASS calendar parsed to zero rows across the window")
    # Zero GRAIN STOCKS events is NOT a problem by itself: the report is
    # quarterly and a ten-week window can legitimately contain none.
    return events, problems


def build_wasde_events(start: dt.date, end: dt.date):
    """Monthly WASDE from the OCE WASDE page's published date list."""
    events, problems = [], []
    try:
        html = _get_text(WASDE_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"WASDE page fetch failed: {exc}"]
    txt = re.sub(r"<[^>]+>", " ", html)
    txt = re.sub(r"\s+", " ", txt)
    for ym in re.finditer(
            r"In (\d{4})[^.!?]{0,120}?WASDE report will be released on"
            r"((?:\s*(?:and\s+)?[A-Z][a-z]{2,8}\.?\s+\d{1,2},?)+)", txt):
        year = int(ym.group(1))
        for tok in re.finditer(r"([A-Z][a-z]{2,8})\.?\s+(\d{1,2})", ym.group(2)):
            month = MONTHS_ABBR.get(tok.group(1)[:3].lower())
            if not month:
                problems.append(f"WASDE month unparsed: {tok.group(0)[:40]}")
                continue
            try:
                d = dt.date(year, month, int(tok.group(2)))
            except ValueError:
                problems.append(f"WASDE date unparsed: {tok.group(0)[:40]}")
                continue
            if not (start <= d <= end):
                continue
            events.append(dict(
                date=d.isoformat(), time_et="12:00 PM", name="WASDE (USDA)", short="WASDE",
                tier=1, category="Agriculture",
                blurb="USDA's World Agricultural Supply and Demand Estimates — the monthly balance-sheet update for the grain and oilseed markets, released at noon ET.",
                source="USDA OCE WASDE schedule (usda.gov)", time_source="published release policy",
            ))
    if not events:
        # WASDE is monthly, so a ten-week window with zero dates is a broken
        # parse (or the year rolled and USDA has not published next year's
        # schedule yet — visible in the log either way, never fatal).
        problems.append("WASDE schedule parsed to zero dates in window")
    return events, problems


def build_usda_events(start: dt.date, end: dt.date):
    events, problems = [], []
    for fn in (build_usda_nass_events, build_wasde_events):
        ev, pr = fn(start, end)
        events += ev
        problems += pr
    return events, problems


# ── source 7: US federal general election, computed by statute (bug #1268) ──
# The date is fixed by federal law (2 U.S.C. section 7 for the House, 3 U.S.C.
# section 1 for presidential electors): the Tuesday after the first Monday in
# November of every even-numbered year. Like ISM, the schedule is a rule, not
# a feed, so it is computed — the statute is the authority. Presidential
# years are the even years divisible by four; the rest are midterms.
def us_general_election_date(year: int) -> dt.date:
    d = dt.date(year, 11, 1)
    first_monday = d + dt.timedelta(days=(0 - d.weekday()) % 7)
    return first_monday + dt.timedelta(days=1)


def build_us_election_events(start: dt.date, end: dt.date):
    events = []
    for year in range(start.year, end.year + 1):
        if year % 2:
            continue
        d = us_general_election_date(year)
        if not (start <= d <= end):
            continue
        presidential = year % 4 == 0
        events.append(dict(
            date=d.isoformat(), time_et="6:00 PM",
            name="US presidential election" if presidential else "US midterm elections",
            short="Election" if presidential else "Midterms",
            tier=1, category="Politics",
            blurb=("Presidential, House and Senate races. First polls close at 6:00 PM ET (Indiana, Kentucky) and most of the East by 8:00 PM; "
                   "results arrive overnight, so markets price the outcome at the next session's open."
                   if presidential else
                   "All 435 House seats and about a third of the Senate. First polls close at 6:00 PM ET (Indiana, Kentucky) and most of the East by 8:00 PM; "
                   "results arrive overnight, so markets price the outcome at the next session's open."),
            source="US federal election day (2 U.S.C. section 7, computed)",
            time_source="published poll-closing time (first states, ET)",
        ))
    return events


# ── source 8: US Treasury quarterly refunding announcement (bug #1271) ─────
# The refunding announcement (8:30 AM ET, Wednesday, early Feb/May/Aug/Nov)
# sets coupon auction sizes and the forward guidance on them — direct event
# risk for the 10- and 30-year. The date is NOT a clean rule (it shifts around
# the FOMC: Jul 31 2024, Feb 5 2025, Apr 30 2025, Aug 5 2026, Nov 4 2026), so
# it is sourced, never computed: Treasury itself states the next date in two
# places, and the authority pattern is the same as the FOMC block.
#   1. The current Policy Statement (the refunding statement) ends with
#      "The next quarterly refunding announcement will take place on
#      Wednesday, November 4, 2026." (sb0590, 2026-08-05, verified 2026-10-16)
#   2. The "Most Recent Quarterly Refunding Documents" page links that
#      statement (and the quarter's other press releases). Its own "next
#      release is scheduled for" lines are per-block and were NOT used: on
#      2026-10-16 a block parse latched onto Nov 2 (financing estimates) and
#      then Oct 16 (dealer agenda). The builder opens each linked press
#      release and takes the date only from the statement sentence (1), and
#      rejects any date that is not a Wednesday.
TREASURY_QR_LATEST_URL = ("https://home.treasury.gov/policy-issues/financing-the-government/"
                          "quarterly-refunding/most-recent-quarterly-refunding-documents")
_QR_NEXT_RE = re.compile(
    r"next quarterly refunding announcement will take place on\s+"
    r"(?:[A-Z][a-z]+,\s*)?([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})")
_QR_PR_RE = re.compile(r"(?:https://home\.treasury\.gov)?/news/press-releases/([a-z]{1,3}\d+)", re.I)


def _qr_date(month_name: str, day: str, year: str):
    month = MONTHS.get(month_name)
    if not month:
        return None
    try:
        return dt.date(int(year), month, int(day))
    except ValueError:
        return None


def build_treasury_refunding_events(start: dt.date, end: dt.date):
    events, problems = [], []
    try:
        html = _get_browser_text(TREASURY_QR_LATEST_URL)
    except Exception as exc:  # noqa: BLE001
        return [], [f"Treasury refunding documents page fetch failed: {exc}"]
    # Markup-independent: the documents page's markup did not match two
    # anchor/text parses in a row (2026-10-16 — the converted text verified
    # in-session differs from the raw HTML the runner sees), and a "next
    # release" date on that page belongs to whichever block it sits in. So
    # every press release the page links is opened, and only the refunding
    # statement carries the sentence below — it identifies itself.
    d, source, checked = None, None, []
    for pr_id in dict.fromkeys(m.group(1).lower() for m in _QR_PR_RE.finditer(html)):
        if len(checked) >= 10:
            break
        url = f"https://home.treasury.gov/news/press-releases/{pr_id}"
        checked.append(pr_id)
        try:
            ptxt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _get_browser_text(url)))
        except Exception as exc:  # noqa: BLE001
            problems.append(f"Treasury press release {pr_id} fetch failed: {exc}")
            continue
        pm = _QR_NEXT_RE.search(ptxt)
        if pm:
            d = _qr_date(*pm.groups())
            source = "US Treasury quarterly refunding statement (home.treasury.gov)"
            break
    if d is None:
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
        problems.append("Treasury refunding: next announcement date not found in any linked press release "
                        f"(page {len(html)} bytes, press releases checked: {', '.join(checked) or 'none linked'}, "
                        f"starts: {txt[:120]!r})")
        return events, problems
    if d.weekday() != 2:
        # Every refunding announcement is a Wednesday. Any other weekday means
        # the parse latched onto a sibling release (the Monday financing
        # estimates block carries its own "next release" date) — refuse it.
        problems.append(f"Treasury refunding: parsed {d.isoformat()} is not a Wednesday — rejected "
                        f"(source: {source})")
        return events, problems
    if start <= d <= end:
        events.append(dict(
            date=d.isoformat(), time_et="8:30 AM", name="Treasury quarterly refunding", short="Refunding",
            tier=2, category="Rates",
            blurb="Treasury's quarterly statement of coupon auction sizes and its guidance on future sizes — direct event risk for the 10- and 30-year yields.",
            source=source, time_source="published release policy",
        ))
    return events, problems


# ── assemble ───────────────────────────────────────────────────────────────
def build(today: dt.date | None = None, key: str | None = None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    key = key or os.environ.get("FRED_API_KEY", FRED_API_KEY_DEFAULT)
    start = today - dt.timedelta(days=DAYS_BACK)
    end = today + dt.timedelta(weeks=WEEKS_FORWARD)

    events, problems = build_fred_events(start, end, key)
    fomc, fomc_problems = build_fomc_events(start, end)
    events += fomc
    problems += fomc_problems
    events += build_ism_events(start, end)
    nar, nar_problems = build_nar_events(start, end)
    events += nar
    problems += nar_problems
    events += build_nfib_events(start, end)
    umich, umich_problems = build_umich_prelim_events(start, end, key)
    events += umich
    problems += umich_problems
    fcb, fcb_problems = build_foreign_cb_events(start, end)
    events += fcb
    problems += fcb_problems
    usda, usda_problems = build_usda_events(start, end)
    events += usda
    problems += usda_problems
    events += build_us_election_events(start, end)
    qr, qr_problems = build_treasury_refunding_events(start, end)
    events += qr
    problems += qr_problems

    # De-dupe on (date, name); sort by date then time then tier.
    seen, out = set(), []
    def _t(e):
        m = re.match(r"(\d+):(\d+)\s*(AM|PM)", e["time_et"])
        if not m:
            return 9 * 60
        h, mi, ap = int(m.group(1)) % 12, int(m.group(2)), m.group(3)
        return (h + (12 if ap == "PM" else 0)) * 60 + mi
    for e in sorted(events, key=lambda e: (e["date"], _t(e), e["tier"])):
        k = (e["date"], e["name"])
        if k in seen:
            continue
        seen.add(k)
        out.append(e)

    tier1 = sum(1 for e in out if e["tier"] == 1)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "counts": {"total": len(out), "tier1": tier1},
        "sources": [
            "FRED release calendar (api.stlouisfed.org) — BLS, BEA, Census and Federal Reserve releases",
            "Federal Reserve FOMC calendar (federalreserve.gov) — meeting dates",
            "ISM published schedule — 1st and 3rd business day of the month, computed",
            "NAR statistical news release schedule (nar.realtor) — existing home sales dates",
            "NFIB published schedule — second Tuesday of the month, computed",
            "UMich preliminary schedule — two Fridays before each FRED final date, computed",
            "ECB Governing Council calendar (ecb.europa.eu) — decision dates",
            "Bank of England MPC dates (bankofengland.co.uk) — decision dates",
            "Bank of Japan MPM schedule (boj.or.jp) — decision dates",
            "USDA NASS release calendar (nass.usda.gov) — quarterly Grain Stocks",
            "USDA OCE WASDE schedule (usda.gov) — monthly WASDE dates",
            "US federal election day — Tuesday after the first Monday in November, even years (2 U.S.C. section 7), computed",
            "US Treasury quarterly refunding documents (home.treasury.gov) — next refunding announcement date",
        ],
        "notes": [
            "Times are US Eastern and come from each agency's standing release policy, not from the wire.",
            "No reference period is shown: the release calendar gives the date a report lands, not the month "
            "it covers, and that lag is not uniform across releases.",
            "Consensus expectations are not shown — there is no free source for them (June 2026 decision: no paid vendor).",
        ],
        "problems": problems,
        "events": out,
    }
    return payload


def main(argv):
    out_path = argv[1] if len(argv) > 1 else OUT_PATH
    payload = build()
    if payload["counts"]["tier1"] < 3:
        # A calendar with almost no majors in ten weeks is a broken fetch, not a
        # quiet season. Fail loudly rather than publish an empty tile.
        print(f"FATAL: only {payload['counts']['tier1']} tier-1 releases in the window", file=sys.stderr)
        for p in payload["problems"]:
            print(f"  problem: {p}", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    print(f"wrote {out_path}: {payload['counts']['total']} events "
          f"({payload['counts']['tier1']} major) through {payload['window']['to']}")
    for p in payload["problems"]:
        print(f"  problem: {p}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
