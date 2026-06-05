/* Economic data calendar — FREE dates layer.
   Curated from public government release schedules (BLS, Census, Federal
   Reserve). No paid vendor. "Expected/consensus" numbers are intentionally
   omitted (the only piece that costs money — see HOMEPAGE_EDITORIAL_SPEC).
   Nonfarm payrolls is computed (first Friday of each month); other releases are
   curated with confirmed 2026 dates. Update this list as the year rolls.
   Each item: { date:'YYYY-MM-DD', time, name, detail }. */

const CURATED = [
  { date: '2026-06-10', time: '8:30a ET', name: 'CPI (May)',          detail: 'Inflation — the key read on oil bleed-through' },
  { date: '2026-06-11', time: '8:30a ET', name: 'PPI (May)',          detail: 'Producer prices — pipeline inflation' },
  { date: '2026-06-16', time: '8:30a ET', name: 'Retail sales (May)', detail: 'Consumer spending health' },
  { date: '2026-06-17', time: '2:00p ET', name: 'FOMC + dot plot',    detail: 'Rate decision and new economic projections' },
  { date: '2026-07-15', time: '8:30a ET', name: 'CPI (Jun)',          detail: 'Inflation' },
  { date: '2026-07-16', time: '8:30a ET', name: 'PPI (Jun)',          detail: 'Producer prices' },
  { date: '2026-07-29', time: '2:00p ET', name: 'FOMC decision',      detail: 'Rate decision' },
  { date: '2026-08-12', time: '8:30a ET', name: 'CPI (Jul)',          detail: 'Inflation' },
];

function firstFridayISO(year, monthIdx) {
  const d = new Date(Date.UTC(year, monthIdx, 1));
  const shift = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + shift);
  return d.toISOString().slice(0, 10);
}

function payrollsEvents(fromISO) {
  const out = [];
  const start = new Date(fromISO + 'T00:00:00Z');
  for (let i = 0; i < 4; i++) {
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const prevMon = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1))
      .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    out.push({
      date: firstFridayISO(m.getUTCFullYear(), m.getUTCMonth()),
      time: '8:30a ET',
      name: `Jobs report (${prevMon})`,
      detail: 'Nonfarm payrolls and the unemployment rate',
    });
  }
  return out;
}

export function getUpcoming(todayISO, count = 5) {
  const all = [...CURATED, ...payrollsEvents(todayISO)]
    .filter((e) => e.date >= todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const seen = new Set();
  const uniq = all.filter((e) => {
    const k = e.date + e.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.slice(0, count).map((e) => ({ ...e, today: e.date === todayISO }));
}

export function fmtEventDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const wd = d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const mo = d.toLocaleString('en-US', { month: 'numeric', timeZone: 'UTC' });
  return `${wd} ${mo}/${d.getUTCDate()}`;
}
