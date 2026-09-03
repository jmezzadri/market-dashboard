#!/usr/bin/env node
/* Every indicator in the registry must declare WHICH TAIL IS THE WARNING.
 *
 * Joe, 2026-09-03, on equity risk premium at the 0th percentile showing as
 * calm: "yes please fix." The cause was a default — `stats.direction || 'hw'`
 * — quietly deciding for 64 indicators that only a HIGH reading matters, so
 * every low-end warning on the site was invisible.
 *
 * A default is not a decision. This check makes the decision mandatory: add an
 * indicator without a DIRECTION entry and the build fails here, naming it.
 * LESSONS 7.15: a rule that has to be repeated becomes a check.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/data/indicatorRegistry.js', import.meta.url), 'utf8');
const cut = src.indexOf('export const DIRECTION');
if (cut < 0) { console.error('check_directions: no DIRECTION map in the registry'); process.exit(1); }

const ids = [...src.slice(0, cut).matchAll(/^([a-z0-9_]+):\[\s*"/gm)].map((m) => m[1]);
const dirs = new Map([...src.slice(cut).matchAll(/([a-z0-9_]+)\s*:\s*'(hw|lw|bw)'/g)].map((m) => [m[1], m[2]]));

const missing = ids.filter((i) => !dirs.has(i));
const orphan = [...dirs.keys()].filter((i) => !ids.includes(i));
const bad = [];
if (missing.length) bad.push(`no DIRECTION entry: ${missing.join(', ')}\n    Add 'hw' (only a high reading warns), 'lw' (only a low reading warns) or 'bw' (both tails).`);
if (orphan.length) bad.push(`DIRECTION entry for an id not in the registry: ${orphan.join(', ')}`);

if (bad.length) { console.error('check_directions FAILED\n  - ' + bad.join('\n  - ')); process.exit(1); }
console.log(`check_directions — clean (${ids.length} indicators, all declared)`);
