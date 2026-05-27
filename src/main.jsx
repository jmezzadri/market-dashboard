import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import V2Shell from './redesign/Shell.jsx'

// Routing:
// - Default (no hash, no #v2/ prefix): the production App at macrotilt.com.
//   This is the polished site Joe has been working on for months — five
//   domain reads, engine gauges, sector allocation pie, etc.
// - #v2/* hash: the v2 redesign preview shell (parallel surface, not yet
//   intended to replace the production site).
//
// 2026-05-26 — REVERTED the v2 cutover. The redesign Shell was lower fidelity
// than the production App and made macrotilt.com worse for anyone visiting `/`.
function isV2Hash() {
  if (typeof window === 'undefined') return false
  const h = window.location.hash || ''
  return h.startsWith('#v2/') || h === '#v2'
}

function Root() {
  const [v2, setV2] = useState(isV2Hash)
  useEffect(() => {
    const onHash = () => setV2(isV2Hash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (v2) {
    return (
      <V2Shell
        onExit={() => {
          window.location.hash = 'home'
        }}
      />
    )
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
