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
    291: dict(name="Existing home sales",          short="Existing", time="10:00 AM", tier=2, cat="Housing",
              blurb="Closed sales of previously owned homes — the bulk of the housing market."),
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
    umich, umich_problems = build_umich_prelim_events(start, end, key)
    events += umich
    problems += umich_problems
    fcb, fcb_problems = build_foreign_cb_events(start, end)
    events += fcb
    problems += fcb_problems

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
            "UMich preliminary schedule — two Fridays before each FRED final date, computed",
            "ECB Governing Council calendar (ecb.europa.eu) — decision dates",
            "Bank of England MPC dates (bankofengland.co.uk) — decision dates",
            "Bank of Japan MPM schedule (boj.or.jp) — decision dates",
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
