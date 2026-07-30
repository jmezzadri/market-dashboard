import React from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import OverhaulApp from './overhaul/OverhaulApp.jsx'
import { installClientErrorLog } from './lib/clientErrorLog'

// Start collecting browser errors before anything renders, so a bug filed
// later carries the console evidence — including boot-time failures.
installClientErrorLog()

// The May-2026 overhaul shell is the only site. The legacy tab app and its
// ?v=2 escape hatch were retired in the 2026-06-15 cleanup (parity reached
// 2026-06-10). History holds the old tree if it is ever needed again.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OverhaulApp />
  </React.StrictMode>
)
