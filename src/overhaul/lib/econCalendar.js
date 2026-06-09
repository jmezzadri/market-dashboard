/* Economic data calendar — FREE layer.
   Dates + prior prints are free government data (BLS, Census, Federal Reserve).
   "Expected" (consensus) has no free clean API, so the handful on screen are
   curated by hand — accurate as of the build, refreshed as releases pass. No
   paid vendor. Weekly jobless claims (Thursdays) are computed.
   Item: { date, time, name, short, expected, prior, detail }. */

const CURATED = [
  { date: '2026-06-10', time: '8:30a ET', name: 'CPI (May)', short: 'CPI', expected: '4.2% y/y', prior: '3.8% y/y',
    detail: 'Consumer inflation — the key read on whether the oil spike is leaking into core prices.' },
  { date: '2026-06-11', time: '8:30a ET', name: 'PPI (May)', short: 'PPI', expected: '', prior: '+1.4% m/m',
    detail: 'Producer prices — inflation in the pipeline before it reaches consumers.' },
  { date: '2026-06-17', time: '8:30a ET', name: 'Retail sales (May)', short: 'Retail', expected: '', prior: '+0.5% m/m',
    detail: 'Consumer spending — how resilient the household is.' },
  { date: '2026-06-17', time: '2:00p ET', name: 'FOMC decision', short: 'FOMC', expected: 'Hold 3.50–3.75%', prior: '3.50–3.75%',
    detail: 'Rate decision and a new dot plot. Markets price a near-certain hold (~99%).' },
  { date: '2026-07-02', time: '8:30a ET', name: 'Jobs report (Jun)', short: 'Jobs', expected: '', prior: '+172k',
    detail: 'Nonfarm payrolls and the unemployment rate.' },
  { date: '2026-07-15', time: '8:30a ET', name: 'CPI (Jun)', short: 'CPI', expected: '', prior: '',
    detail: 'Consumer inflation.' },
  { date: '2026-07-29', time: '2:00p ET', name: 'FOMC decision', short: 'FOMC', expected: '', prior: '3.50–3.75%',
    detail: 'Rate decision.' },
];

function firstFridayISO(y, m) { const d = new Date(Date.UTC(y, m, 1)); d.setUTCDate(1 + ((5 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); }
function payrollsEvents(fromISO) {
  const out = []; const s = new Date(fromISO + 'T00:00:00Z');
  for (let i = -1; i < 4; i++) {
    const m = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1));
    const prevMon = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    out.push({ date: firstFridayISO(m.getUTCFullYear(), m.getUTCMonth()), time: '8:30a ET', name: `Jobs report (${prevMon})`, short: 'Jobs', expected: '', prior: '', detail: 'Nonfarm payrolls and the unemployment rate.' });
  }
  return out;
}
function joblessEvents(fromISO) {
  const out = []; const s = new Date(fromISO + 'T00:00:00Z');
  for (let i = 0; i < 14; i++) {
    const d = new Date(s); d.setUTCDate(s.getUTCDate() + i);
    if (d.getUTCDay() === 4) out.push({ date: d.toISOString().slice(0, 10), time: '8:30a ET', name: 'Jobless claims', short: 'Claims', expected: '', prior: '', detail: 'Weekly initial jobless claims — the most timely read on the labor market.' });
  }
  return out;
}
function allEvents(fromISO) {
  const seen = new Set();
  return [...CURATED, ...payrollsEvents(fromISO), ...joblessEvents(fromISO)].filter((e) => { const k = e.date + e.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function getWeekGrid(todayISO, weeks = 2) {
  const today = new Date(todayISO + 'T00:00:00Z');
  const dow = today.getUTCDay();
  const monday = new Date(today); monday.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const startISO = monday.toISOString().slice(0, 10);
  const byDate = {};
  allEvents(startISO).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const week = [];
    for (let d = 0; d < 5; d++) {
      const cur = new Date(monday); cur.setUTCDate(monday.getUTCDate() + w * 7 + d);
      const iso = cur.toISOString().slice(0, 10);
      week.push({ iso, dayNum: cur.getUTCDate(), weekday: WD[d], month: cur.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), firstOfMonth: cur.getUTCDate() === 1, isToday: iso === todayISO, isPast: iso < todayISO, events: byDate[iso] || [] });
    }
    grid.push(week);
  }
  return grid;
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
