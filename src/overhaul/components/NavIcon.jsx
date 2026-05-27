/* NavIcon — sidebar/topnav SVG glyph set.
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';

const PATHS = {
  home: 'M3 11 L12 4 L21 11 V20 H14 V14 H10 V20 H3 Z',
  macro: 'M3 18 L9 12 L13 15 L21 6',
  tilt: 'M4 4 V20 H20 M4 14 L9 8 L13 11 L20 6',
  scanner: 'M11 18 A7 7 0 1 1 11 4 A7 7 0 0 1 11 18 M16 16 L21 21',
  portfolio: 'M3 12 A9 9 0 1 1 12 21 V12 Z M12 3 A9 9 0 0 1 21 12 H12 Z',
  scenarios: 'M4 20 L4 4 H20 V20 Z M4 14 L9 9 L13 13 L20 6',
  indicators: 'M4 6 H20 M4 12 H20 M4 18 H20',
  methodology: 'M5 4 H17 L19 6 V20 H5 Z M8 9 H14 M8 13 H14 M8 17 H12',
  admin: 'M12 4 L20 8 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V8 Z',
  bugs: 'M12 7 V13 M9 19 H15 M7 10 L17 10 M8 14 A4 4 0 0 0 16 14 V11 A4 4 0 0 0 8 11 Z',
};

export default function NavIcon({ k }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[k] || PATHS.home} />
    </svg>
  );
}
