import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  cacheDir: '/tmp/vite-cache',
  root: '/sessions/clever-lucid-lovelace/mnt/market-dashboard',
  server: { host: '127.0.0.1', port: 5180 },
})
