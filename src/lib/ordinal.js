// Returns the correct English ordinal suffix for an integer (st/nd/rd/th).
//   1 -> 'st', 2 -> 'nd', 3 -> 'rd', 4..10 -> 'th'
//   11, 12, 13 -> 'th' (special case)
//   21 -> 'st', 22 -> 'nd', 23 -> 'rd', etc.
//
// Returns '' for null / undefined / NaN.
//
// Example: `${n}${ordinalSuffix(n)}` -> "1st", "22nd", "33rd", "13th"
export function ordinalSuffix(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const v = Math.abs(Math.round(n));
  const lastTwo = v % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  switch (v % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// Convenience: `${n}st` / `${n}nd` / etc. — pass an integer in, get the
// number + suffix concatenated. `null` / `NaN` / `undefined` -> '—'.
export function withOrdinal(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.round(n);
  return `${v}${ordinalSuffix(v)}`;
}
