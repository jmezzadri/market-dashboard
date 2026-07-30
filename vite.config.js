import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BUILD_SHA — the commit this bundle was built from. Vercel exports
// VERCEL_GIT_COMMIT_SHA into the build environment; a local `vite build` has
// no commit context and reports "dev". Bug reports carry this value so a
// report filed from a stale cached bundle is identifiable as such
// (LESSONS 3.3 — "broken right after deploy" is a browser-cache suspect).
const BUILD_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VITE_BUILD_SHA ||
  'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(BUILD_SHA.slice(0, 12)),
  },
})
