/* Economic data calendar — FREE layer.
   Dates + prior prints are free government data (BLS, Census, Federal Reserve).
   "Expected" (consensus) has no free clean API, so the handful on screen are
   curated by hand — accurate as of the build, refreshed as releases pass. No
   paid vendor. Weekly jobless claims (Thursdays) are computed.
   Item: { date, time, name, short, expected, prior, detail }. */

const CURATED = [
  // Major US releases, dates from the Federal Reserve / BLS / BEA / Census
  // published schedules. Curated forward ~6 weeks; refreshed as months roll.
  { date: '2026-06-30', time: '10:00a ET', name: 'Consumer confidence (Jun)', short: 'Conf.', expected: '', prior: '',
    detail: 'Conference Board consumer confidence — how households feel about jobs and the economy.' },
  { date: '2026-06-30', time: '10:00a ET', name: 'JOLTS job openings (May)', short: 'JOLTS', expected: '', prior: '',
    detail: 'Job openings and labor turnover — a read on labor demand.' },
  { date: '2026-07-01', time: '10:00a ET', name: 'ISM Manufacturing (Jun)', short: 'ISM Mfg', expected: '', prior: '',
    detail: 'Factory-sector activity index — above 50 signals expansion.' },
  { date: '2026-07-02', time: '8:30a ET', name: 'Jobs report (Jun)', short: 'Jobs', expected: '', prior: '',
    detail: 'Nonfarm payrolls and the unemployment rate — released early this month ahead of the July 4 holiday.' },
  { date: '2026-07-06', time: '10:00a ET', name: 'ISM Services (Jun)', short: 'ISM Svc', expected: '', prior: '',
    detail: 'Services-sector activity index — the larger share of the economy; above 50 signals expansion.' },
  { date: '2026-07-14', time: '8:30a ET', name: 'CPI (Jun)', short: 'CPI', expected: '', prior: '',
    detail: 'Consumer inflation — the key read on whether price pressure is cooling.' },
  { date: '2026-07-16', time: '8:30a ET', name: 'Retail sales (Jun)', short: 'Retail', expected: '', prior: '',
    detail: 'Consumer spending — how resilient the household is.' },
  { date: '2026-07-17', time: '8:30a ET', name: 'Housing starts (Jun)', short: 'Housing', expected: '', prior: '',
    detail: 'New residential construction — a rate-sensitive read on housing.' },
  { date: '2026-07-27', time: '8:30a ET', name: 'Durable goods (Jun)', short: 'Durables', expected: '', prior: '',
    detail: 'Orders for long-lasting manufactured goods — a gauge of business investment.' },
  { date: '2026-07-28', time: '10:00a ET', name: 'Consumer confidence (Jul)', short: 'Conf.', expected: '', prior: '',
    detail: 'Conference Board consumer confidence.' },
  { date: '2026-07-29', time: '2:00p ET', name: 'FOMC decision', short: 'FOMC', expected: '', prior: '3.50-3.75%',
    detail: 'Federal Reserve interest-rate decision and statement.' },
  { date: '2026-07-30', time: '8:30a ET', name: 'GDP (Q2 advance)', short: 'GDP', expected: '', prior: '',
    detail: 'First estimate of second-quarter economic growth.' },
  { date: '2026-07-30', time: '8:30a ET', name: 'PCE inflation (Jun)', short: 'PCE', expected: '', prior: '',
    detail: 'Personal income, spending and the PCE price index — the Fed\'s preferred inflation gauge.' },
  { date: '2026-07-31', time: '8:30a ET', name: 'Employment cost index (Q2)', short: 'ECI', expected: '', prior: '',
    detail: 'Wage and benefit cost growth — a closely watched labor-cost inflation read.' },
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
  return [...CURATED, ...joblessEvents(fromISO)].filter((e) => { const k = e.date + e.name; if (seen.has(k)) return false; seen.add(k); return true; });
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
