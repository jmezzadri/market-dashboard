/* siteNav — the ONE list of the site's pages and what each is called.

   Joe, 2026-10-08: the top bar is Home plus the three main areas of the
   site — Macro Landscape, Paper Portfolio, Macro Scorecard — and nothing
   else. Methodology, Data and Bugs are reference pages and live in the
   footer.

   Every surface that names a page reads it from here (top bar, mobile menu,
   footer, the Methodology contents rail), so a rename is one edit and the
   names can never drift apart again (LESSONS 9.11). */

export const PRIMARY_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/macro', label: 'Macro Landscape' },
  { to: '/paper', label: 'Paper Portfolio' },
  { to: '/scorecard', label: 'Macro Scorecard' },
];

// Footer only. Bugs is the one page behind sign-in, so it is listed only for
// a signed-in visitor — a signed-out one is never shown a link that bounces
// them to a login card.
export const REFERENCE_NAV = [
  { to: '/methodology', label: 'Methodology' },
  { to: '/admin/data', label: 'Data' },
  { to: '/admin/bugs', label: 'Bugs', signedInOnly: true },
];

export const PAGE_NAME = {
  home: 'Home',
  macro: 'Macro Landscape',
  paper: 'Paper Portfolio',
  scorecard: 'Macro Scorecard',
  methodology: 'Methodology',
  data: 'Data',
  bugs: 'Bugs',
};
