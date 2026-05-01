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
eq(ageHoursAgainstCalendar('2026-05-01T00:00:00Z', 'wall-clock', NOW1), 16, 'asOf 16h ago');

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

console.log(`\nTOTAL: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
