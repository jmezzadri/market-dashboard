// freshnessClock.ts — calendar-aware age math for the freshness chip.
//
// Phase 4 PR #14 (2026-05-01). Lead Developer + Data Steward sign-off.
//
// Deno-compatible mirror of src/lib/freshnessClock.js. THE TWO FILES MUST
// STAY IN SYNC — change one, change the other. Tests in
// scripts/test_freshnessClock.mjs cover the JS side and assume parity.
//
// See src/lib/freshnessClock.js for the full design rationale (why
// calendar age, three-calendar model, etc.).

export const NYSE_HOLIDAYS = new Set<string>([
  "2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27",
  "2024-06-19","2024-07-04","2024-09-02","2024-11-28","2024-12-25",
  "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-04-18",
  "2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
  "2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19",
  "2028-07-04","2028-09-04","2028-11-23","2028-12-25",
]);

export const NYSE_EARLY_CLOSES = new Set<string>([
  "2024-07-03","2024-11-29","2024-12-24",
  "2025-07-03","2025-11-28","2025-12-24",
  "2026-11-27","2026-12-24",
  "2027-07-02","2027-11-26","2027-12-23",
]);

export const US_FEDERAL_HOLIDAYS = new Set<string>([
  "2024-01-01","2024-01-15","2024-02-19","2024-05-27","2024-06-19",
  "2024-07-04","2024-09-02","2024-10-14","2024-11-11","2024-11-28","2024-12-25",
  "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-05-26",
  "2025-06-19","2025-07-04","2025-09-01","2025-10-13","2025-11-11","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18",
  "2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24",
  "2028-01-17","2028-02-21","2028-05-29","2028-06-19","2028-07-04",
  "2028-09-04","2028-10-09","2028-11-10","2028-11-23","2028-12-25",
]);

export type ReleaseCalendar = "nyse-trading-day" | "us-business-day" | "wall-clock";

function isoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isWeekendUTC(d: Date): boolean {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

export function isNYSETradingDay(date: Date): boolean {
  if (isWeekendUTC(date)) return false;
  return !NYSE_HOLIDAYS.has(isoDateUTC(date));
}

export function isUSBusinessDay(date: Date): boolean {
  if (isWeekendUTC(date)) return false;
  return !US_FEDERAL_HOLIDAYS.has(isoDateUTC(date));
}

export function isCalendarDay(date: Date, calendar: ReleaseCalendar): boolean {
  if (calendar === "nyse-trading-day") return isNYSETradingDay(date);
  if (calendar === "us-business-day")  return isUSBusinessDay(date);
  return true;
}

export function ageHoursAgainstCalendar(
  asOfIso: string | null | undefined,
  calendar: ReleaseCalendar | null | undefined,
  nowMs?: number,
): number {
  if (!asOfIso) return Number.NaN;
  const tIso = asOfIso.length === 10 ? `${asOfIso}T00:00:00Z` : asOfIso;
  const asOfMs = new Date(tIso).getTime();
  if (!Number.isFinite(asOfMs)) return Number.NaN;
  const end = (typeof nowMs === "number") ? nowMs : Date.now();
  if (end <= asOfMs) return 0;
  const totalH = (end - asOfMs) / 3600000;
  if (calendar === "wall-clock" || !calendar) return totalH;

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

export function isStaleAgainstSLA(
  asOfIso: string | null | undefined,
  slaHours: number | null | undefined,
  calendar: ReleaseCalendar | null | undefined,
  nowMs?: number,
): boolean {
  if (!slaHours || slaHours <= 0) return false;
  const age = ageHoursAgainstCalendar(asOfIso, calendar, nowMs);
  if (!Number.isFinite(age)) return false;
  return age > slaHours;
}

export function formatRelativeAge(
  asOfIso: string | null | undefined,
  nowMs?: number,
): string {
  if (!asOfIso) return "never";
  const tIso = asOfIso.length === 10 ? `${asOfIso}T00:00:00Z` : asOfIso;
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
