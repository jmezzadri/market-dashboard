// scripts/test_freshnessClock.mjs — unit tests for src/lib/freshnessClock.js.
//
// Run: `node scripts/test_freshnessClock.mjs`. Exit 0 = pass, 1 = fail.
// Wired into PR-CONTRACT-CHECK.yml so CI runs it on every PR.

import {
  isNYSETradingDay,
  isUSBusinessDay,
  ageHoursAgainstCalendar,
  isStaleAgainstSLA,
  formatRelativeAge,
  gradeByLastPull,
  lastPullInvariantViolated,
  formatSlaDaysHours,
} from '../src/lib/freshnessClock.js';

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  if (Number.isNaN(expected) && Number.isNaN(actual)) {
    pass++; console.log(`  PASS  ${name}`); return;
  }
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) < 0.01
    : actual === expected;
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else    { fail++; console.log(`  FAIL  ${name}  expected=${expected}  actual=${actual}`); }
}

console.log('NYSE trading day:');
eq(isNYSETradingDay(new Date(Date.UTC(2026,4,1))),  true,  'Fri 2026-05-01 -> trading day');
eq(isNYSETradingDay(new Date(Date.UTC(2026,4,2))),  false, 'Sat 2026-05-02 -> not');
eq(isNYSETradingDay(new Date(Date.UTC(2026,4,3))),  false, 'Sun 2026-05-03 -> not');
eq(isNYSETradingDay(new Date(Date.UTC(2026,4,25))), false, 'Mon 2026-05-25 (Memorial) -> NYSE holiday');
eq(isNYSETradingDay(new Date(Date.UTC(2026,11,25))),false, 'Fri 2026-12-25 (Christmas) -> NYSE holiday');

console.log('US business day:');
eq(isUSBusinessDay(new Date(Date.UTC(2026,4,1))),  true,  'Fri 2026-05-01');
eq(isUSBusinessDay(new Date(Date.UTC(2026,9,12))), false, 'Mon 2026-10-12 (Columbus Day) -> not for FRED');
eq(isNYSETradingDay(new Date(Date.UTC(2026,9,12))),true,  'Mon 2026-10-12 (Columbus Day) -> IS trading on NYSE');

console.log('ageHoursAgainstCalendar (wall-clock):');
const NOW1 = Date.UTC(2026, 4, 1, 16, 0, 0);
eq(ageHoursAgainstCalendar('2026-05-01T15:00:00Z', 'wall-clock', NOW1), 1, 'asOf 1h ago');
// Intraday timestamp (not exactly midnight UTC — that is treated as a date-only
// "close" anchor by the 2026-06-11 honest-stamp fix, so it would read 0 here).
eq(ageHoursAgainstCalendar('2026-05-01T10:00:00Z', 'wall-clock', NOW1), 6, 'asOf 6h ago (intraday)');

console.log('ageHoursAgainstCalendar (nyse-trading-day):');
const FRI_CLOSE = '2026-05-01T20:00:00Z';
eq(ageHoursAgainstCalendar(FRI_CLOSE, 'nyse-trading-day', Date.UTC(2026,4,3,22,0,0)), 4, 'Fri close -> Sun 6pm = 4h calendar (Joe case: green)');
eq(ageHoursAgainstCalendar(FRI_CLOSE, 'nyse-trading-day', Date.UTC(2026,4,4,19,0,0)), 23, 'Fri close -> Mon 3pm = 23h calendar (within SLA 25h)');
eq(ageHoursAgainstCalendar(FRI_CLOSE, 'nyse-trading-day', Date.UTC(2026,4,5,13,0,0)), 41, 'Fri close -> Tue 9am = 41h calendar (RED at SLA 25h)');

const MEM_FRI_CLOSE = '2026-05-22T20:00:00Z';
eq(ageHoursAgainstCalendar(MEM_FRI_CLOSE, 'nyse-trading-day', Date.UTC(2026,4,26,13,30,0)), 17.5, 'Memorial Day weekend (Fri->Tue 9:30am) = 17.5h calendar');

console.log('isStaleAgainstSLA:');
eq(isStaleAgainstSLA(FRI_CLOSE, 25, 'nyse-trading-day', Date.UTC(2026,4,3,22,0,0)), false, 'Sun night -> not stale');
eq(isStaleAgainstSLA(FRI_CLOSE, 25, 'nyse-trading-day', Date.UTC(2026,4,5,13,0,0)), true,  'Tue 9am after Fri close -> STALE');
eq(isStaleAgainstSLA(MEM_FRI_CLOSE, 25, 'nyse-trading-day', Date.UTC(2026,4,26,13,30,0)), false, 'Memorial Day Tue open -> still green');
eq(isStaleAgainstSLA('2026-05-01T15:00:00Z', 0, 'wall-clock', NOW1), false, 'SLA 0 -> never stale');

console.log('Edge cases:');
eq(ageHoursAgainstCalendar(null, 'wall-clock', NOW1), NaN, 'null asOf -> NaN');
eq(ageHoursAgainstCalendar('garbage', 'wall-clock', NOW1), NaN, 'garbage asOf -> NaN');
eq(isStaleAgainstSLA(null, 25, 'nyse-trading-day', NOW1), false, 'null asOf -> not stale (default green)');

console.log('formatRelativeAge:');
eq(formatRelativeAge('2026-05-01T15:30:00Z', NOW1), '30 minutes ago', '30 min');
eq(formatRelativeAge('2026-05-01T13:00:00Z', NOW1), '3 hours ago',    '3h');
eq(formatRelativeAge('2026-04-25T16:00:00Z', NOW1), '6 days ago',     '6d');

console.log('gradeByLastPull (one-clock: grade off LAST PULL vs SLA — FRESHNESS_CHIP_SPEC 2026-06-16):');
const NOW_JUN16 = Date.UTC(2026, 5, 16, 17, 0, 0); // Tue 2026-06-16 ~1pm ET
const gs = (o, now = NOW_JUN16) => gradeByLastPull(o, now).status;
eq(gs({ lastPullIso:'2026-06-15T23:29:40Z', asOfIso:'2026-06-15', slaHours:49, calendar:'us-business-day' }), 'green', 'daily indicator pulled last night -> green');
eq(gs({ lastPullIso:'2026-06-15T23:29:43Z', asOfIso:'2026-04-01', slaHours:49, calendar:'us-business-day' }), 'green', 'monthly data (Apr 1) but daily job pulled -> green (no publication-lag false-red)');
eq(gs({ lastPullIso:'2026-06-12T13:49:00Z', asOfIso:'2026-06-12', slaHours:49, calendar:'us-business-day' }), 'red', 'daily job no pull since Fri -> RED (real stale feed caught)');
eq(gs({ lastPullIso:'2026-06-12T12:57:00Z', asOfIso:'2026-06-12', slaHours:480, calendar:'us-business-day' }), 'green', 'bi-monthly job within its SLA -> green');
eq(gs({ lastPullIso:'2026-06-15T23:29:00Z', asOfIso:'2026-06-09', slaHours:192, calendar:'wall-clock' }), 'green', 'weekly job fresh -> green');
eq(gs({ lastPullIso:'2026-06-12T23:00:00Z', asOfIso:'2026-06-12', slaHours:49, calendar:'us-business-day' }, Date.UTC(2026,5,15,12,0,0)), 'green', 'Mon 8am after Fri pull -> green (no weekend false-red)');
eq(gs({ lastPullIso:'2026-06-15T11:00:00Z', asOfIso:'2026-06-15', slaHours:49, calendar:'us-business-day' }, Date.UTC(2026,5,17,18,0,0)), 'red', 'Wed after Mon-only pull -> RED (dead daily caught in 2 business days)');
eq(gs({ lastPullIso:'2026-06-16T10:00:00Z', asOfIso:'2026-06-16', slaHours:49, calendar:'wall-clock', lastError:'429 throttle' }), 'red', 'upstream error -> RED');
eq(gs({ lastPullIso:'2026-06-15T12:00:00Z', asOfIso:'2026-06-16', slaHours:49, calendar:'wall-clock' }), 'red', 'invariant: data dated after last pull -> RED');
eq(gs({ lastPullIso:null, asOfIso:'2026-06-15', slaHours:49, calendar:'wall-clock' }), 'red', 'no last pull on record -> RED');
eq(gs({ lastPullIso:'2026-06-16T10:00:00Z', asOfIso:'2026-06-16', slaHours:0, calendar:'wall-clock' }), 'unknown', 'no SLA configured -> unknown (never fake-green)');
eq(lastPullInvariantViolated('2026-06-16', '2026-06-15T23:00:00Z'), true,  'invariant helper: as-of date after pull date -> violated');
eq(lastPullInvariantViolated('2026-06-15', '2026-06-15T23:00:00Z'), false, 'invariant helper: same ET date -> ok');
eq(formatSlaDaysHours(49),  '2d 1h', 'SLA 49h -> 2d 1h');
eq(formatSlaDaysHours(192), '8d',    'SLA 192h -> 8d');
eq(formatSlaDaysHours(480), '20d',   'SLA 480h -> 20d');

console.log(`\nTOTAL: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
