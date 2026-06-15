// Dead-UI detector. Walks the real production bundle graph from src/main.jsx
// and reports any src/ file (.js/.jsx/.ts/.tsx/.css) that the live site cannot
// reach. Objective — uses the bundler's own module graph, so no false positives
// from import-syntax quirks. Exits 1 if dead files are found. Added 2026-06-15.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const live = new Set()
await build({
  root: process.cwd(),
  logLevel: 'silent',
  plugins: [react(), { name: 'collect', moduleParsed(i){ if (i.id && !i.id.includes('\0')) live.add(i.id) } }],
  build: { write: false, rollupOptions: { input: path.resolve('src/main.jsx') } }
})
const root = process.cwd() + '/'
const liveRel = new Set([...live].filter(p => p.startsWith(root)).map(p => p.slice(root.length)))

function walk(dir, acc){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(jsx?|tsx?|css)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) acc.push(p)
  }
  return acc
}
const all = walk('src', [])
const dead = all.filter(f => !liveRel.has(f)).sort()
if (dead.length){
  console.error(`Dead UI files unreachable from the live site (${dead.length}):`)
  dead.forEach(f => console.error('  ' + f))
  process.exit(1)
}
console.log('No dead UI files — every src file is reachable from the live entry.')
