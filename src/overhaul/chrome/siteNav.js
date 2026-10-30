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
// 2026-10-29: the Data page is public, so it lives at /data. Its old address
// (/admin/data) read as a back-office page behind a login; it now redirects
// here so old links and bookmarks still land.
export const REFERENCE_NAV = [
  { to: '/methodology', label: 'Methodology' },
  { to: '/data', label: 'Data' },
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
  about: 'About',
  terms: 'Terms',
  privacy: 'Privacy',
  disclaimer: 'Disclaimer',
  signin: 'Sign in',
};

/* The browser-tab title for every address (2026-10-29: every page used to
   read "MacroTilt — Market Dashboard", so five open tabs were five identical
   tabs). Built from PAGE_NAME so a rename here renames the tab too. */
const TITLE_BY_PATH = {
  '/macro': PAGE_NAME.macro,
  '/paper': PAGE_NAME.paper,
  '/scorecard': PAGE_NAME.scorecard,
  '/methodology': PAGE_NAME.methodology,
  '/data': PAGE_NAME.data,
  '/admin/bugs': PAGE_NAME.bugs,
  '/about': PAGE_NAME.about,
  '/terms': PAGE_NAME.terms,
  '/privacy': PAGE_NAME.privacy,
  '/disclaimer': PAGE_NAME.disclaimer,
  '/signin': PAGE_NAME.signin,
};
export const SITE_NAME = 'MacroTilt';
export function pageTitle(pathname) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return `${SITE_NAME} — Macro research and market dashboard`;
  const tk = p.match(/^\/ticker\/([^/]+)$/);
  if (tk) return `${decodeURIComponent(tk[1]).toUpperCase()} — ${SITE_NAME}`;
  return TITLE_BY_PATH[p] ? `${TITLE_BY_PATH[p]} — ${SITE_NAME}` : SITE_NAME;
}
