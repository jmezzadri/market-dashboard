#!/usr/bin/env node
/* check_layout.mjs — refuse pages that jam their content into part of the frame.
 *
 * Joe, 2026-09-01, on the Macro engine band: "Why are you jamming all this to
 * the left? I thought we already talked about this? Is this not a design rule?
 * It's so bad that I have to tell you this over and over again. How do we fix
 * this so you know to not do things like this?"
 *
 * He is right that repeating it is not the fix. Design rules that live only in
 * a prompt get obeyed until they do not; this one is now a script, run on every
 * UI PR the same way the brief's caps and voice guards run on every brief.
 *
 * Two checks, because the naive one gives a FALSE PASS on exactly the card that
 * triggered this. Measuring "does any content reach the right edge of the card"
 * passed the engine band at 99%, because a full-width history strip sits under
 * two columns that stop at 66%. Dead space is a per-ROW and per-TRACK property,
 * never a per-card one.
 *
 *   1. EMPTY GRID TRACK — a grid declares N columns and fills fewer. That is
 *      what the engine band was doing: three tracks, two children.
 *   2. SHORT ROW — within one grid/flex row, the rightmost content stops before
 *      MIN_FILL of the container's inner width, and the row is not deliberately
 *      a prose column (those are opted out with `data-measure="prose"`).
 *
 * Usage: node scripts/check_layout.mjs http://localhost:4321 /macro / /paper
 * Exit 1 if anything fails, with the offending selector and the numbers.
 */
import { chromium } from 'playwright-core';

const MIN_FILL = 0.70;        // a row must use 70% of its container's width
const MIN_W = 480;            // ignore small containers; only wide frames matter
const VIEWPORT = { width: 1600, height: 1100 };

const base = process.argv[2];
const routes = process.argv.slice(3);
if (!base || !routes.length) {
  console.error('usage: check_layout.mjs <baseUrl> <route> [route...]');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
let failures = 0;

for (const route of routes) {
  const page = await ctx.newPage();
  await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4500);

  const hits = await page.evaluate(({ minFill, minW }) => {
    const out = [];
    const sel = (el) => {
      const c = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return el.tagName.toLowerCase() + (c ? '.' + c : '');
    };
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width < minW || cs.display === 'none' || cs.visibility === 'hidden') return;
      // A row may opt out ONLY by declaring it in the markup, where a reviewer
      // sees it — never by a quiet exception inside this file. A chart legend
      // belongs at the left under its chart; a panel does not.
      if (el.dataset && el.dataset.layout === 'natural') return;

      // 1. empty grid tracks.
      //    Count SPANS, not children: a 12-column grid holding four children
      //    that each span 6 is full, not a third full. And only judge grids
      //    whose children all sit on ONE row — a wrapped grid with a partial
      //    last row (9 tiles in 12 columns) is normal, not a defect.
      if (cs.display.indexOf('grid') !== -1) {
        // Zero-width tracks are auto-fit doing its job — a collapsed spare
        // track occupies nothing and is not dead space. Count real tracks only.
        const tracks = cs.gridTemplateColumns.split(' ').filter(Boolean)
          .filter((t) => parseFloat(t) !== 0).length;
        const kids = [...el.children].filter((k) =>
          getComputedStyle(k).display !== 'none' && k.getBoundingClientRect().width > 0);
        const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)));
        const oneRow = tops.size === 1;
        let span = 0;
        kids.forEach((k) => {
          const gc = (getComputedStyle(k).gridColumn || '').trim();
          if (gc.indexOf('1 / -1') !== -1) { span += tracks; return; }
          const m = gc.match(/span\s+(\d+)/);
          span += m ? parseInt(m[1], 10) : 1;
        });
        if (oneRow && tracks > 1 && span > 0 && span < tracks) {
          out.push({ kind: 'EMPTY GRID TRACK', el: sel(el),
            detail: tracks + ' columns declared, ' + span + ' spanned — ' + (tracks - span) +
                    ' empty track(s) of ' + Math.round(box.width / tracks) + 'px each' });
        }
      }

      // 2. short rows
      if (!/grid|flex/.test(cs.display)) return;
      const inner = box.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (inner < minW) return;
      const rows = new Map();
      [...el.children].forEach((k) => {
        const b = k.getBoundingClientRect();
        if (!b.width || getComputedStyle(k).display === 'none') return;
        const key = Math.round(b.top);
        const r = rows.get(key) || { right: 0, n: 0 };
        r.right = Math.max(r.right, b.right - box.left - (parseFloat(cs.paddingLeft) || 0));
        r.n += 1;
        rows.set(key, r);
      });
      // A row of controls (buttons, inputs, pills) is legitimately packed left —
      // a toolbar is not a panel. Only content rows are judged.
      const allControls = [...el.children].every((k) =>
        /^(BUTTON|INPUT|SELECT|LABEL)$/.test(k.tagName) ||
        (k.tagName === 'A' && k.getBoundingClientRect().width < 260) ||
        !!k.querySelector('button, input, select'));
      if (allControls) return;
      // The LAST row of a wrapping container is allowed to be partial — four
      // tiles left over from twelve is arithmetic, not a design decision. Only
      // a container whose ONLY row is short, or whose non-final rows are short,
      // is jamming content.
      const rowKeys = [...rows.keys()].sort((a, b) => a - b);
      const lastKey = rowKeys[rowKeys.length - 1];
      rows.forEach((r, key) => {
        if (r.n < 2) return;
        if (rowKeys.length > 1 && key === lastKey) return;
        const fill = r.right / inner;
        if (fill < minFill) {
          out.push({ kind: 'SHORT ROW', el: sel(el),
            detail: 'row of ' + r.n + ' uses ' + Math.round(fill * 100) + '% of ' + Math.round(inner) +
                    'px — ' + Math.round(inner - r.right) + 'px dead to the right' });
        }
      });
    });
    return out;
  }, { minFill: MIN_FILL, minW: MIN_W });

  const seen = new Set();
  const uniq = hits.filter((h) => {
    const k = h.kind + h.el + h.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (uniq.length) {
    failures += uniq.length;
    console.log('\n' + route + '  —  ' + uniq.length + ' layout problem(s)');
    uniq.slice(0, 12).forEach((h) =>
      console.log('  ' + h.kind.padEnd(17) + ' ' + h.el.padEnd(32) + ' ' + h.detail));
  } else {
    console.log(route + '  —  clean');
  }
  await page.close();
}
await browser.close();
if (failures) {
  console.log('\n' + failures + ' layout problem(s). Content jammed into part of the frame is a defect, not a style preference.');
  process.exit(1);
}
