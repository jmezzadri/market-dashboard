/* Which history an indicator's percentile pill is ranked against.

   Site default (Joe, 2026-06-10): each indicator's own TRAILING 3 YEARS.

   Exception (Joe, 2026-10-08): the NY Fed corporate bond distress index
   (cmdi) ranks against its FULL history since 2005. The last three years were
   unusually calm for corporate bonds, so a reading at the series' long-run
   median (0.20) ranked in the 90s and the pill read "Distressed" on a market
   that was not distressed. Every surface that ranks, shades or describes a
   pill window reads it from here, so the pill, the chart bands, the tooltips
   and the morning read can never disagree about the basis. */
export const FULL_HISTORY_PCT_IDS = new Set(['cmdi']);

export const DEFAULT_PCT_WINDOW_DAYS = 3 * 365;

export function pctWindowDays(id) {
  return FULL_HISTORY_PCT_IDS.has(id) ? Infinity : DEFAULT_PCT_WINDOW_DAYS;
}

/* "3-year" or "full-history" — reads as "percentile of its 3-year range". */
export function pctWindowLabel(id) {
  return FULL_HISTORY_PCT_IDS.has(id) ? 'full-history' : '3-year';
}

/* Compact form for chips: "3-yr" or "full history". */
export function pctWindowShort(id) {
  return FULL_HISTORY_PCT_IDS.has(id) ? 'full history' : '3-yr';
}
