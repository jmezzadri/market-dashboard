/* Economic data calendar — FREE dates layer.
   Curated from public government release schedules (BLS, Census, Federal
   Reserve). No paid vendor. "Expected/consensus" numbers are intentionally
   omitted (the only piece that costs money). Nonfarm payrolls is computed
   (first Friday of each month); other releases are curated with confirmed 2026
   dates. Each item: { date, time, name, short, detail }. */

const CURATED = [
  { date: '2026-06-10', time: '8:30a ET', name: 'CPI (May)',          short: 'CPI',    detail: 'Inflation — the key read on oil bleed-through' },
  { date: '2026-06-11', time: '8:30a ET', name: 'PPI (May)',          short: 'PPI',    detail: 'Producer prices — pipeline inflation' },
  { date: '2026-06-16', time: '8:30a ET', name: 'Retail sales (May)', short: 'Retail', detail: 'Consumer spending health' },
  { date: '2026-06-17', time: '2:00p ET', name: 'FOMC + dot plot',    short: 'FOMC',   detail: 'Rate decision and new economic projections' },
  { date: '2026-07-15', time: '8:30a ET', name: 'CPI (Jun)',          short: 'CPI',    detail: 'Inflation' },
  { date: '2026-07-16', time: '8:30a ET', name: 'PPI (Jun)',          short: 'PPI',    detail: 'Producer prices' },
  { date: '2026-07-29', time: '2:00p ET', name: 'FOMC decision',      short: 'FOMC',   detail: 'Rate decision' },
  { date: '2026-08-12', time: '8:30a ET', name: 'CPI (Jul)',          short: 'CPI',    detail: 'Inflation' },
];

function firstFridayISO(year, monthIdx) {
  const d = new Date(Date.UTC(year, monthIdx, 1));
  d.setUTCDate(1 + ((5 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
function payrollsEvents(fromISO) {
  const out = [];
  const start = new Date(fromISO + 'T00:00:00Z');
  for (let i = -1; i < 4; i++) {
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const prevMon = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1))
      .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    out.push({ date: firstFridayISO(m.getUTCFullYear(), m.getUTCMonth()), time: '8:30a ET',
      name: `Jobs report (${prevMon})`, short: 'Jobs', detail: 'Nonfarm payrolls and the unemployment rate' });
  }
  return out;
}
function allEvents(fromISO) { return [...CURATED, ...payrollsEvents(fromISO)]; }

/* Week grid: `weeks` business weeks (Mon–Fri) starting the Monday of todayISO's
   week, each day carrying its events. */
export function getWeekGrid(todayISO, weeks = 2) {
  const today = new Date(todayISO + 'T00:00:00Z');
  const dow = today.getUTCDay();
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const startISO = monday.toISOString().slice(0, 10);
  const byDate = {};
  allEvents(startISO).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const week = [];
    for (let d = 0; d < 5; d++) {
      const cur = new Date(monday);
      cur.setUTCDate(monday.getUTCDate() + w * 7 + d);
      const iso = cur.toISOString().slice(0, 10);
      week.push({
        iso, dayNum: cur.getUTCDate(), weekday: WD[d],
        month: cur.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
        firstOfMonth: cur.getUTCDate() === 1,
        isToday: iso === todayISO, isPast: iso < todayISO,
        events: byDate[iso] || [],
      });
    }
    grid.push(week);
  }
  return grid;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
