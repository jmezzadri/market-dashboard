import React from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import OverhaulApp from './overhaul/OverhaulApp.jsx'

// Site overhaul gate (PR-O1, 2026-05-26).
// The May-2026 site overhaul is built behind a per-URL flag so the legacy
// dashboard keeps shipping while the new design is built page by page.
// Append ?v=3 to any URL to bring up the overhaul. Default render is the
// legacy app until the overhaul reaches feature parity and Joe flips the
// default.
const OVERHAUL_ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('v') === '3'

const RootApp = OVERHAUL_ENABLED ? OverhaulApp : App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
)
