import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import V2Shell from './redesign/Shell.jsx'

// MacroTilt v2 cutover (2026-05-26):
// The redesigned site is now the DEFAULT at macrotilt.com. Visiting `/`
// (no hash, no query) loads V2Shell. The legacy App is still reachable as
// an escape hatch via `?legacy=1` so anything we missed can be triaged
// directly. Hash routing under `#v2/*` continues to route inside V2Shell
// as it already did, so existing v2 bookmarks keep working.
function isLegacyEscape() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('legacy') === '1'
}
function isLegacyHash() {
  // Allow `#home`, `#scanner`, etc. to land on the legacy App for users
  // with bookmarks from the pre-cutover site. v2 routes use `#v2/*`.
  if (typeof window === 'undefined') return false
  const h = window.location.hash || ''
  if (!h) return false
  if (h.startsWith('#v2/') || h === '#v2') return false
  return true
}

function Root() {
  const [legacy, setLegacy] = useState(() => isLegacyEscape() || isLegacyHash())
  useEffect(() => {
    const onHash = () => setLegacy(isLegacyEscape() || isLegacyHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (legacy) {
    return <App />
  }
  return (
    <V2Shell
      onExit={() => {
        // Exit drops the user into the legacy App via `?legacy=1`.
        window.location.search = '?legacy=1'
      }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
