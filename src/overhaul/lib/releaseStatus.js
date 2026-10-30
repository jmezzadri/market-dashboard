/* releaseStatus — has a scheduled release happened yet, and what did it say?

   2026-10-29 audit: at 9 PM the homepage still listed the ECB decision
   (8:15 AM), PCE and GDP (8:30 AM) under "Today" exactly as it had at 6 AM,
   with no outcome — a released row read as still to come.

   A release is "released" once its scheduled New York time has passed. What
   it said comes from the release-history feed (built by
   scripts/build_econ_release_history.py), and is shown only when it belongs
   to THIS release:
     decision  a central bank's outcome, read from its own statement and keyed
               "<name>|<date>" (scripts/cb_decisions.py);
     print     a data release's headline figure, when FRED first published
               the newest print on the release's own date (released_on).
   Anything else shows "Released" and nothing more — never a stale print
   dressed as today's (LESSONS 4.9). No consensus is shown: no paid vendor
   (June 2026 decision). */

export function nowET() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value || '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
}

/* "8:30 AM" → "08:30". "overnight" (Bank of Japan, out before the US day
   starts) counts from the start of its date. Anything unparseable → null:
   such a row is released only once its date has passed. */
export function releaseHM(timeET) {
  const t = String(timeET || '').trim().toLowerCase();
  if (t === 'overnight') return '00:00';
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === 'pm') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function isReleased(ev, now = nowET()) {
  if (!ev?.date) return false;
  if (ev.date < now.date) return true;
  if (ev.date > now.date) return false;
  const hm = releaseHM(ev.time_et);
  return hm != null && hm <= now.hm;
}

function fmtNum(v, dec) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function unitSuffix(unit) {
  if (!unit) return '';
  return unit.startsWith('$') ? ` ${unit}` : unit;
}
function periodLabel(iso, freq) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (freq === 'M') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (freq === 'Q') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (freq === 'W') return `week ending ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* What the release said, if the feed holds it for this date. */
export function releaseResult(ev, hist) {
  if (!ev || !hist) return null;
  const dec = hist.decisions?.[`${ev.name}|${ev.date}`];
  if (dec?.label) {
    return { kind: 'decision', short: dec.label.replace(/ deposit rate/, ''), text: dec.label, source: dec.source, url: dec.url };
  }
  const ms = hist.series?.[ev.name]?.measures || [];
  const m = ms.find((x) => x?.released_on === ev.date && Array.isArray(x.points) && x.points.length);
  if (!m) return null;
  const last = m.points[m.points.length - 1];
  const v = Number(last?.[1]);
  if (!Number.isFinite(v)) return null;
  const value = `${fmtNum(v, m.decimals ?? 1)}${unitSuffix(m.unit || '')}`;
  return { kind: 'print', short: value, text: `${m.label}: ${value}`, period: periodLabel(last[0], m.frequency), label: m.label };
}
