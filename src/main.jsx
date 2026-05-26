import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import V2Shell from './redesign/Shell.jsx'

// MacroTilt v2 overhaul (May 2026):
// The redesigned site lives behind the hash prefix `#v2/`. Anything else
// loads the production App as-is, so the legacy site is unaffected.
// When the user lands on `#v2/home`, V2Shell takes over the screen.
// Clicking the sidebar's "Current site" exits the v2 shell and goes home.
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
