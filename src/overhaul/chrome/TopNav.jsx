/* TopNav — alternate nav layout, shown when data-mt-sidebar="top".
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';
import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/macro', label: 'Macro' },
  { to: '/tilt', label: 'Tilt' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/scenarios', label: 'Scenarios' },
  { to: '/indicators', label: 'All indicators' },
  { to: '/methodology', label: 'Methodology' },
];

export default function TopNav() {
  return (
    <div className="mt-topnav" aria-label="Primary">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `mt-pill ${isActive ? 'on' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
