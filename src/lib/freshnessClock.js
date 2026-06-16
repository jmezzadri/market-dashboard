// freshnessClock.js — calendar-aware age math for the freshness chip.
//
// Phase 4 PR #14 (2026-05-01). Lead Developer + Data Steward sign-off.
//
// One source of truth that both the React chip (FreshnessDot.jsx) and the
// pipeline-health-check edge function consume. Mirror at
// supabase/functions/_shared/freshnessClock.ts MUST stay in sync (the two
// files are byte-identical apart from .ts type annotations and the
// Deno-style `export` placement; if you change one, change the other).
//
// Why "calendar age" not "wall-clock age"
// ───────────────────────────────────────
// Joe directive 2026-05-01: "I do not wanna see a stale chip on daily data
// on Sunday night." Trading-calendar elements (VIX, equity prices, etc.)
// don't refresh on weekends or NYSE holidays. Their freshness clock
// should pause on those days. Same for FRED/FDIC: they don't release on
// weekends or US federal holidays.
//
// Three calendars
// ───────────────
//   "nyse-trading-day"  — NYSE trading days only. Skips weekends + NYSE
//                         holidays + the half-day "early close" Saturdays.
//   "us-business-day"   — US business days. Skips weekends + US federal
//                         holidays.
//   "wall-clock"        — straight wall-clock hours. RSS scrapes, web
//                         pulls, internal calculations that run 24/7.
//
// API
// ───
//   ageHoursAgainstCalendar(asOfIso, calendar) → number (hours)
//     Calendar-aware elapsed hours since asOfIso. For nyse / business-day
//     calendars, subtracts the time spent on non-calendar days from the
//     wall-clock elapsed hours.
//
//   isStaleAgainstSLA(asOfIso, slaHours, calendar) → boolean
//     true if calendar-age exceeds slaHours. Used by both the chip
//     (red vs green) and the edge function (auto-bug-fire decision).
//
//   isCalendarDay(date, calendar) → boolean
//     true if the given Date falls on a calendar day. Lookup primitive.
//
// Holiday tables are hand-baked through 2028. Refresh annually before
// the new-year roll. See HOLIDAY_REFRESH.md for the source of truth.

// ─── NYSE holidays (2024-2028) ──────────────────────────────────────────────
export const NYSE_HOLIDAYS = new Set([
  // 2024
  "2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27",
  "2024-06-19","2024-07-04","2024-09-02","2024-11-28","2024-12-25",
  // 2025
  "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-04-18",
  "2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25",
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
  // 2028
  "2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19",
  "2028-07-04","2028-09-04","2028-11-23","2028-12-25",
]);

// Half-day closes: NYSE closes at 1pm ET (vs 4pm ET on a normal day).
// These are still trading days for our calendar — just shorter.
export const NYSE_EARLY_CLOSES = new Set([
  "2024-07-03","2024-11-29","2024-12-24",
  "2025-07-03","2025-11-28","2025-12-24",
  "2026-11-27","2026-12-24",
  "2027-07-02","2027-11-26","2027-12-23",
]);

// ─── US federal holidays (2024-2028) — superset of NYSE for biz-day calc ───
// Includes Columbus Day + Veterans Day (NYSE doesn't observe; FRED does
// when they fall on a weekday). Inauguration Day (every 4 years on Jan 20)
// is included for 2025.
export const US_FEDERAL_HOLIDAYS = new Set([
  // 2024 (NYSE list + Columbus Day Oct 14 + Veterans Day Nov 11)
  "2024-01-01","2024-01-15","2024-02-19","2024-05-27","2024-06-19",
  "2024-07-04","2024-09-02","2024-10-14","2024-11-11","2024-11-28","2024-12-25",
  // 2025 (NYSE list + Inauguration Jan 20 + Columbus Day Oct 13 + Veterans Day Nov 11)
  "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-05-26",
  "2025-06-19","2025-07-04","2025-09-01","2025-10-13","2025-11-11","2025-11-27","2025-12-25",
  // 2026 (Columbus Day Oct 12 + Veterans Day Nov 11)
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
  // 2027 (Columbus Day Oct 11 + Veterans Day Nov 11)
  "2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18",
  "2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24",
  // 2028 (Columbus Day Oct 9 + Veterans Day Nov 10 (Friday observance))
  "2028-01-17","2028-02-21","2028-05-29","2028-06-19","2028-07-04",
  "2028-09-04","2028-10-09","2028-11-10","2028-11-23","2028-12-25",
]);

// ─── Date primitives ────────────────────────────────────────────────────────
function isoDateUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isWeekendUTC(d) {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

// ─── Calendar predicates ────────────────────────────────────────────────────
export function isNYSETradingDay(date) {
  if (isWeekendUTC(date)) return false;
  return !NYSE_HOLIDAYS.has(isoDateUTC(date));
}

export function isUSBusinessDay(date) {
  if (isWeekendUTC(date)) return false;
  return !US_FEDERAL_HOLIDAYS.has(isoDateUTC(date));
}

export function isCalendarDay(date, calendar) {
  if (calendar === "nyse-trading-day") return isNYSETradingDay(date);
  if (calendar === "us-business-day")  return isUSBusinessDay(date);
  // wall-clock: every day counts
  return true;
}

// ─── Core age math ──────────────────────────────────────────────────────────
// Returns the calendar-aware hours elapsed between asOfIso and "now"
// (or a supplied nowMs for tests). Skips the time spent on non-calendar
// days for the trading / business-day calendars.
//
// Returns NaN if asOfIso is unparseable.
export function ageHoursAgainstCalendar(asOfIso, calendar, nowMs) {
  if (!asOfIso) return NaN;
  // Anchor a date-only as-of at that day's US close of business (20:00 UTC),
  // never midnight. A business-date observation exists "as of" its day's
  // close, and every SLA in the manifest was calibrated against close-anchored
  // ages — midnight anchoring makes a 49h daily budget expire ~9 PM ET the
  // following evening, 20 hours early. (2026-05-01 server-side lesson,
  // reintroduced by the 2026-06-11 midnight date stamps, re-fixed here at the
  // clock itself so every caller gets the correct anchor.) A timestamp at
  // exactly midnight UTC is date-only INTENT and gets the same anchor.
  const _dOnly = asOfIso.length === 10 ? asOfIso
    : (/T00:00:00(\.0+)?(\+00:00|Z)$/.test(String(asOfIso)) ? String(asOfIso).slice(0, 10) : null);
  const tIso = _dOnly ? `${_dOnly}T20:00:00Z` : asOfIso;
  const asOfMs = new Date(tIso).getTime();
  if (!Number.isFinite(asOfMs)) return NaN;
  const end = (typeof nowMs === "number") ? nowMs : Date.now();
  if (end <= asOfMs) return 0;
  const totalH = (end - asOfMs) / 3600000;
  if (calendar === "wall-clock" || !calendar) return totalH;

  // Walk each whole UTC day in [asOf-day, now-day], compute the overlap
  // of the day with the [asOf, now] window if the day is non-calendar.
  const dayMs = 86400000;
  const startDay = Math.floor(asOfMs / dayMs) * dayMs;
  const endDay   = Math.floor(end    / dayMs) * dayMs;
  let skippedH = 0;
  for (let d = startDay; d <= endDay; d += dayMs) {
    const dateObj = new Date(d);
    if (isCalendarDay(dateObj, calendar)) continue;
    const overlapStart = Math.max(asOfMs, d);
    const overlapEnd   = Math.min(end, d + dayMs);
    if (overlapEnd > overlapStart) {
      skippedH += (overlapEnd - overlapStart) / 3600000;
    }
  }
  return Math.max(0, totalH - skippedH);
}

// ─── SLA check ──────────────────────────────────────────────────────────────
// true if the element is stale (calendar age exceeds the SLA in hours).
// SLA value of 0 means "no SLA" — element is never stale by time alone.
export function isStaleAgainstSLA(asOfIso, slaHours, calendar, nowMs) {
  if (!slaHours || slaHours <= 0) return false;
  const age = ageHoursAgainstCalendar(asOfIso, calendar, nowMs);
  if (!Number.isFinite(age)) return false;  // unknown asOf → can't decide → green by default
  return age > slaHours;
}


// ─── ONE-CLOCK grade: did the JOB pull within SLA? (FRESHNESS_CHIP_SPEC 2026-06-16)
// ────────────────────────────────────────────────────────────────────────────
// The single grading rule shared by every chip on the site, and mirrored
// server-side in supabase/functions/_shared/freshnessClock.ts (change one,
// change the other). It grades off the LAST PULL — the real time the producing
// job last ran successfully (pipeline_health.last_good_at) — NOT off the age of
// the data. A monthly series whose observation is six weeks old is GREEN as
// long as its daily reader job pulled on schedule; a daily feed whose job
// stopped goes RED within one extra business-day cadence even if its last value
// still looks recent. This is the fix for fake-green (Uranium), false-red on
// lagged feeds, and the "refresh older than data" impossible pair.
//
// Inputs (one object):
//   lastPullIso  the job's last successful run time (a real wall-clock stamp)
//   asOfIso      the data's own as-of date/datetime — used ONLY for the invariant
//   slaHours     the job-cadence + grace budget in hours, sized to how often the
//                JOB runs (not the data's publication lag)
//   calendar     "nyse-trading-day" | "us-business-day" | "wall-clock" — the
//                job's run calendar, so weekend/holiday hours are not counted
//                (no Monday false-reds on weekday-only jobs)
//   lastError    the upstream error string, if the last run errored
//
// Returns { status: "green" | "red" | "unknown", reason: string | null, ageHours }.
export function gradeByLastPull(input, nowMs) {
  const o = input || {};
  if (o.lastError) {
    return { status: "red", reason: `Upstream error: ${o.lastError}`, ageHours: null };
  }
  const sla = Number(o.slaHours);
  if (!Number.isFinite(sla) || sla <= 0) {
    // No freshness target configured — cannot confirm fresh. Never silently
    // green (Hard Rule 0.1: fake green forbidden).
    return { status: "unknown", reason: "No freshness target configured", ageHours: null };
  }
  if (!o.lastPullIso) {
    return { status: "red", reason: "No successful pull on record", ageHours: null };
  }
  // Hard invariant: the data can never be dated after the pull that produced it.
  if (o.asOfIso && lastPullInvariantViolated(o.asOfIso, o.lastPullIso)) {
    return {
      status: "red",
      reason: "Data is dated after its last successful pull — a producer stamp bug (flagged for repair)",
      ageHours: null,
    };
  }
  const age = ageHoursAgainstCalendar(o.lastPullIso, o.calendar, nowMs);
  if (!Number.isFinite(age)) {
    return { status: "red", reason: "Last-pull timestamp unreadable", ageHours: null };
  }
  if (age > sla) {
    return {
      status: "red",
      reason: `No successful pull in ${Math.round(age)}h (SLA ${formatSlaDaysHours(sla)})`,
      ageHours: age,
    };
  }
  return { status: "green", reason: null, ageHours: age };
}

// True when the data's as-of is later than the last successful pull — an
// impossible pair (you cannot hold data dated after the run that fetched it).
// Date-only as-ofs compare by ET session date so a same-day close stamp written
// hours before the evening run does not trip it.
export function lastPullInvariantViolated(asOfIso, lastPullIso) {
  if (!asOfIso || !lastPullIso) return false;
  const refMs = new Date(lastPullIso).getTime();
  if (!Number.isFinite(refMs)) return false;
  if (String(asOfIso).length === 10) {
    const refEtDate = new Date(refMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return String(asOfIso) > refEtDate;
  }
  const asOfMs = new Date(asOfIso).getTime();
  return Number.isFinite(asOfMs) && asOfMs > refMs + 5 * 60 * 1000;
}

// Format an hour budget as days + hours for the chip's SLA line: 49 → "2d 1h",
// 192 → "8d", 480 → "20d" (FRESHNESS_CHIP_SPEC field 5: SLA in days & hours).
export function formatSlaDaysHours(hours) {
  const h0 = Number(hours);
  if (!Number.isFinite(h0) || h0 <= 0) return "—";
  const d = Math.floor(h0 / 24);
  const h = Math.round(h0 - d * 24);
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  return `${h}h`;
}


// ─── Session-frontier grading for DAILY elements ────────────────────────────
// Joe doctrine 2026-06-12 (supersedes hour-budget SLAs for daily cadence):
// a daily element is GREEN only when it carries the newest session its source
// can have published by now; AMBER when exactly one session behind that
// (today's pull missed or is late); RED two or more sessions behind. The
// reference is the element's FETCH DEADLINE (scheduled fetch ET + grace), and
// deadlines only occur on business days — so weekends and holidays are the
// only times a daily value may legitimately sit more than one session old,
// and they never count against it.
//
//   expected(now) = last closed session as of the most recent passed fetch
//                   deadline, walked back lag_sessions (documented source
//                   publication lag, e.g. the NY Fed term-premium series)
//   behind        = trading sessions from the data date up to expected
//   grade         = 0 behind → green · 1 → amber · ≥2 → red
export function dailySessionGrade(asOfIso, opts, nowMs) {
  const o = opts || {};
  const fetchTime = (typeof o.fetchTimeET === "string" && /^\d{1,2}:\d{2}$/.test(o.fetchTimeET)) ? o.fetchTimeET : "06:00";
  const grace = Number.isFinite(o.graceHours) ? o.graceHours : 3;
  const lag = Number.isFinite(o.lagSessions) ? o.lagSessions : 0;
  const now = (typeof nowMs === "number") ? new Date(nowMs) : new Date();

  // "now" as ET wall-clock (same convention as latestTradingSessionDate).
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const parts = fetchTime.split(":");
  const deadlineMins = Number(parts[0]) * 60 + Number(parts[1]) + Math.round(grace * 60);

  // Most recent BUSINESS day whose fetch deadline has already passed.
  const probe = new Date(etNow);
  const nowMins = etNow.getHours() * 60 + etNow.getMinutes();
  if (!(isUSBusinessDay(probe) && nowMins >= deadlineMins)) {
    do { probe.setDate(probe.getDate() - 1); } while (!isUSBusinessDay(probe));
  }
  const refIsFetchDay = probe.getFullYear() === etNow.getFullYear()
    && probe.getMonth() === etNow.getMonth() && probe.getDate() === etNow.getDate();
  const refMins = refIsFetchDay ? deadlineMins : deadlineMins; // deadline time on the ref day

  // Expected session: last NYSE session whose close (4 PM ET) precedes the
  // ref deadline, then walked back lag sessions.
  const exp = new Date(probe);
  if (!(isNYSETradingDay(exp) && refMins >= 16 * 60)) {
    do { exp.setDate(exp.getDate() - 1); } while (!isNYSETradingDay(exp));
  }
  for (let i = 0; i < lag; i++) {
    do { exp.setDate(exp.getDate() - 1); } while (!isNYSETradingDay(exp));
  }
  const pad = (n) => String(n).padStart(2, "0");
  const expectedDate = `${exp.getFullYear()}-${pad(exp.getMonth() + 1)}-${pad(exp.getDate())}`;

  const asOfDate = asOfIso ? String(asOfIso).slice(0, 10) : null;
  if (!asOfDate) return { expectedDate, behind: null, grade: "unknown" };
  if (asOfDate >= expectedDate) return { expectedDate, behind: 0, grade: "green" };
  let behind = 0;
  const walk = new Date(`${asOfDate}T12:00:00Z`);
  const end = new Date(`${expectedDate}T12:00:00Z`);
  while (walk < end && behind < 30) {
    walk.setUTCDate(walk.getUTCDate() + 1);
    if (isNYSETradingDay(walk)) behind++;
  }
  return { expectedDate, behind, grade: behind <= 0 ? "green" : behind === 1 ? "amber" : "red" };
}

// ─── Whole-day age for the relative-age label ───────────────────────────────
// Counts the number of calendar-of-record days between the as-of DATE and
// today, both taken as ET calendar dates. This is time-of-day independent: a
// value dated "yesterday" is always 1, no matter the current hour or whether
// UTC has already rolled past midnight while it is still the prior day in ET.
// Weekends and holidays are not counted for trading/business calendars, so a
// Friday value read on Monday is 1, not 3. This is what the chip shows as
// "Nd ago", so the words always agree with the green/red dot.
export function calendarDaysSince(asOfIso, calendar, nowMs) {
  if (!asOfIso) return null;
  const asOfDateStr = String(asOfIso).slice(0, 10);
  const now = (typeof nowMs === "number") ? new Date(nowMs) : new Date();
  // "today" as an ET calendar date (YYYY-MM-DD via the en-CA locale).
  const todayET = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const start = new Date(`${asOfDateStr}T00:00:00Z`).getTime();
  const end = new Date(`${todayET}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const dayMs = 86400000;
  let count = 0;
  for (let t = start + dayMs; t <= end; t += dayMs) {
    if (isCalendarDay(new Date(t), calendar)) count++;
  }
  return count;
}

// ─── Convenience formatter ──────────────────────────────────────────────────
// Returns a plain-English age string. Used by the chip tooltip.
//   "just now" / "12 minutes ago" / "3 hours ago" / "2 days ago"
export function formatRelativeAge(asOfIso, nowMs) {
  if (!asOfIso) return "never";
  const _d2 = asOfIso.length === 10 ? asOfIso : (/T00:00:00(\.0+)?(\+00:00|Z)$/.test(String(asOfIso)) ? String(asOfIso).slice(0, 10) : null);
  const tIso = _d2 ? `${_d2}T20:00:00Z` : asOfIso; // close-of-business anchor — see ageHoursAgainstCalendar
  const t = new Date(tIso).getTime();
  if (!Number.isFinite(t)) return "never";
  const end = (typeof nowMs === "number") ? nowMs : Date.now();
  const mins = Math.round((end - t) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30)  return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}


// ─── Trading-session date helpers ────────────────────────────────────────────
// Phase 4 follow-up (2026-05-04, Joe directive): UI footers + chips that label
// what data IS rather than when a script ran. Returns the most recent NYSE
// trading-session date as of `now`, in the user's mental model:
//
//   - Past 4:00 PM ET on a trading day  → that day
//   - Pre-4:00 PM ET on a trading day   → previous trading day (today's close
//                                         hasn't happened yet)
//   - Weekend / NYSE holiday            → most recent trading day
//
// Returns a Date anchored to ET midnight of the trading-session date. Caller
// formats. Useful as the freshness anchor for end-of-day data: "Prices: latest
// close · Mon, May 4, 2026" rather than "Prices: Updated 4:06 PM ET" (which
// described when the script ran, not when the data is from).
export function latestTradingSessionDate(nowMs) {
  const _now = nowMs ? new Date(nowMs) : new Date();
  // Compute "now" expressed in ET wall-clock so we can compare against 4 PM ET.
  const etNow = new Date(_now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const closedToday = etNow.getHours() >= 16; // 4 PM ET = market close
  // Walk back from today (or yesterday if pre-close) until we hit a trading day.
  const probe = new Date(etNow);
  if (!closedToday) probe.setDate(probe.getDate() - 1);
  for (let i = 0; i < 14; i++) {
    if (isNYSETradingDay(probe)) return probe;
    probe.setDate(probe.getDate() - 1);
  }
  return etNow; // fallback (would only hit on a 14-day market closure)
}

// Format helper — "Mon, May 4, 2026" style. Anchored to ET so the label means
// the same thing for every user regardless of browser locale.
export function formatTradingDayLabel(date, opts) {
  if (!date) return null;
  const _opts = opts || {};
  const _date = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(_date.getTime())) return null;
  return _date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: _opts.weekday === false ? undefined : "short",
    month:   "short",
    day:     "numeric",
    year:    _opts.year === false ? undefined : "numeric",
  });
}
