import React from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import OverhaulApp from './overhaul/OverhaulApp.jsx'

// Site overhaul cutover (2026-05-27).
// Joe gave verbal sign-off this evening — the May-2026 overhaul is now the
// DEFAULT site. macrotilt.com (no flag) and macrotilt.com/?v=3 both load
// the new overhaul shell. macrotilt.com/?v=2 is the legacy escape hatch and
// stays available indefinitely as a fallback while we shake out edge cases.
//
// Originally a per-URL flag (?v=3) opted users INTO the new shell while the
// legacy app was the default. With Asset Tilt polished, Scenarios at parity,
// chips reading correctly, and the historical backtest view shipped, the
// new shell is the canonical experience.
const LEGACY_REQUESTED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('v') === '2'

const RootApp = LEGACY_REQUESTED ? App : OverhaulApp

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
)
