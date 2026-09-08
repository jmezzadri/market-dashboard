#!/usr/bin/env node
/* check_fonts.mjs — refuse a fourth typeface.
 *
 * Joe, 2026-09-08, on the Home cockpit: "I thought we went over all the
 * different font usages?! This looks ridiculous. Please can we fix this and
 * mark a hard rule around fonts we use on the site? We need some consistency."
 *
 * He was right, and it had already been written down twice — v13.css says
 * "three roles, no more" in a comment, and tokens.css says the display face
 * was unified in July. Both were comments. Neither was a check. Meanwhile four
 * token systems named six families (Inter, Geist, JetBrains Mono, Instrument
 * Serif, Fraunces, IBM Plex), and the three the pages actually asked for were
 * never loaded, so every visitor saw system fallbacks: San Francisco for the
 * UI, Iowan Old Style for the headlines, Menlo for the numbers.
 *
 * LESSONS 7.15: a design rule that lives only in a prompt is a rule you will
 * be told about again. So this is the check.
 *
 * 2026-09-08, same day, second round. Joe: "The fonts are not fixed!!! They're
 * all different fucking sizes! Why all different sizes, some bold, others not."
 * He was right again — round one fixed WHICH faces, not the sizes and weights.
 * Home alone rendered 14 distinct sizes, 8 of them off the declared six-step
 * scale, and 4 weights with no rule about which meant what. The mechanism was
 * two size systems: the v12 stylesheets set arbitrary px and clamp() values,
 * and v13 overrode only some of them. A clamp() font-size derives its value
 * from the window width, so it can NEVER land on a step — two headlines set
 * that way cannot match at any width.
 *
 * STATIC checks (no browser, run on every PR):
 *   1. ONE DECLARATION SITE. A quoted font family name may appear only in
 *      src/overhaul/styles/type.css. Anywhere else in src/ it is a defect.
 *   2. TOKENS ONLY. Every font-family / fontFamily in src/ resolves to
 *      --mt-type-sans | -serif | -mono, or is `inherit`.
 *   3. LOADED == DECLARED. Every family named in type.css is either requested
 *      by the Google Fonts <link> in index.html, or is a generic/system
 *      fallback. A family we ask for and never load is the original bug.
 *   4. NO STRAY FONT FILES. public/fonts holds no face we do not declare.
 *
 * LIVE check (needs a URL; run against a preview or prod):
 *   5. NO MONO PROSE. No visible element longer than PROSE_WORDS words renders
 *      in the mono face. Mono is for figures. The one opt-out is declared in
 *      the markup: data-mono="code" (or a <code>/<pre> ancestor) for a formula
 *      or code block, where a reviewer sees it. This is what put
 *      "US Treasury bills, held as collateral against the futures margin"
 *      into a monospace face at 600 on the Home cockpit.
 *   6. THREE FAMILIES ON SCREEN. The set of first-choice families actually
 *      computed across the page is a subset of the three.
 *
 * Usage:
 *   node scripts/check_fonts.mjs                       # static only
 *   node scripts/check_fonts.mjs https://macrotilt.com / /macro /paper
 * Exit 1 on any failure, naming the file, line and value.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT       = process.cwd();
const TYPE_CSS   = 'src/overhaul/styles/type.css';
const INDEX_HTML = 'index.html';
const TOKENS     = ['--mt-type-sans', '--mt-type-serif', '--mt-type-mono'];
const PROSE_WORDS = 6;

/* Generic CSS families and system fallbacks are not "a typeface we chose". */
const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'cursive',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica',
  'arial', 'menlo', 'georgia', 'iowan old style', 'sf pro text', 'times new roman',
]);

const fails = [];
const fail = (where, msg) => fails.push(`${where}\n    ${msg}`);

/* ── walk src/ ─────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|jsx|js|tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'src'));

const QUOTED_NAME = /['"]([A-Za-z][A-Za-z0-9 +\-]{2,})['"]/g;

/* ── 1 + 2 ─────────────────────────────────────────────────────────────── */
/* Pull out only the VALUE of a font declaration. Scanning whole lines for
   quoted strings reads every other JSX style property as a typeface, and a
   shorthand read to end-of-line swallows the properties that follow it. */
function fontValues(src, isCss) {
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const push = (i, v, shorthand) => out.push({ line: lineOf(i), value: v.trim(), shorthand });

  if (isCss) {
    for (const m of src.matchAll(/font-family\s*:\s*([^;}\n]+)/g)) push(m.index, m[1], false);
    for (const m of src.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}\n]+)/g)) push(m.index, m[1], true);
    return out;
  }
  /* JSX / JS: the value is always a quoted string or a plain identifier. */
  for (const m of src.matchAll(/fontFamily\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) push(m.index, m[2], false);
  for (const m of src.matchAll(/\bfont\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) push(m.index, m[2], true);
  for (const m of src.matchAll(/fontFamily\s*:\s*([A-Za-z_$][\w.$]*)/g)) push(m.index, m[1], false);
  return out;
}

for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === TYPE_CSS) continue;
  const src = readFileSync(file, 'utf8');
  const isCss = rel.endsWith('.css');

  for (const { line, value: raw, shorthand } of fontValues(src, isCss)) {
    const at = `${rel}:${line}`;
    let value = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!value || /^(inherit|unset|initial|revert)$/i.test(value)) continue;
    if (/^[A-Za-z_$][\w.$]*$/.test(value) && !GENERIC.has(value.toLowerCase())) continue;  /* a JS variable */

    /* the shorthand carries style/weight/size before the family; drop them */
    if (shorthand) value = value.replace(/^(?:(?:normal|italic|oblique|small-caps|bold|lighter|bolder|[1-9]00)\s+)*(?:var\(\s*--v13-t[1-6]\s*\)|[\d.]+(?:px|rem|em|%)?)(?:\s*\/\s*[\d.]+\w*)?\s*/i, '');

    for (const m of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      if (!TOKENS.includes(m[1])) {
        fail(at, `font-family uses ${m[1]}. The only font tokens are ${TOKENS.join(', ')}.`);
      }
    }

    /* anything named outside a var() is a family that never went through type.css */
    const outside = value.replace(/var\([^)]*\)/g, '');
    for (const m of outside.matchAll(/['"]([^'"]+)['"]/g)) {
      fail(at, `names a typeface directly: "${m[1]}". Every family is declared once, in ${TYPE_CSS}. Use var(--mt-type-sans|serif|mono).`);
    }
    for (const part of outside.split(',')) {
      const bare = part.trim();
      if (!bare || !/^[a-z][a-z-]*$/i.test(bare)) continue;
      if (GENERIC.has(bare.toLowerCase())) {
        fail(at, `falls back to the bare generic "${bare}" — that renders as the visitor's system face, not ours. Use var(--mt-type-sans|serif|mono).`);
      } else {
        fail(at, `names a typeface directly: "${bare}". Every family is declared once, in ${TYPE_CSS}.`);
      }
    }
  }
}

/* ── 2b — SIZES AND WEIGHTS ARE ON THE SCALE ───────────────────────────────
   Six type steps, three weights, declared once in v13.css. A literal px size
   or a clamp() in a component stylesheet is how the scale came apart. */
const SIZE_TOKENS = ['--v13-t1','--v13-t2','--v13-t3','--v13-t4','--v13-t5','--v13-t6'];
const WEIGHTS = ['400', '600', '700'];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === TYPE_CSS || rel.endsWith('v13.css') || rel.endsWith('tokens.css')) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    const code = line.replace(/\/\*.*?\*\//g, '');

    /* CSS font-size */
    const fs = code.match(/font-size:\s*([^;}!]+)/);
    if (fs) {
      const v = fs[1].trim();
      if (/clamp\(/.test(v)) {
        fail(at, `font-size uses clamp(): "${v}". A viewport-derived size never lands on a step, so two elements set this way cannot match. Use one of ${SIZE_TOKENS.join(', ')}.`);
      } else if (!v.startsWith('var(') && !/^(inherit|100%|1em)$/.test(v)) {
        fail(at, `font-size "${v}" is a literal. The scale is ${SIZE_TOKENS.join(', ')} and there is no seventh step.`);
      } else if (v.startsWith('var(')) {
        const t = v.match(/var\(\s*(--[a-z0-9-]+)/i);
        if (t && !SIZE_TOKENS.includes(t[1])) fail(at, `font-size uses ${t[1]}, which is not a type step.`);
      }
    }

    /* JSX fontSize */
    const jf = code.match(/fontSize:\s*([^,}\n]+)/);
    if (jf) {
      const v = jf[1].trim().replace(/^['"`]|['"`]$/g, '');
      if (/^[\d.]+(px)?$/.test(v) || /clamp\(|\dpx|\drem|\dem\b/.test(v)) {
        fail(at, `fontSize "${v}" is a literal or a clamp(). Use var(--v13-t1..t6).`);
      } else if (v.startsWith('var(')) {
        const t = v.match(/var\(\s*(--[a-z0-9-]+)/i);
        if (t && !SIZE_TOKENS.includes(t[1])) fail(at, `fontSize uses ${t[1]}, which is not a type step.`);
      }
    }

    /* weights, CSS and JSX */
    for (const m of code.matchAll(/font-weight:\s*([^;}!]+)/g)) {
      const v = m[1].trim();
      if (v.startsWith('var(') || v === 'inherit') continue;
      if (!WEIGHTS.includes(v)) fail(at, `font-weight ${v} is not allowed. Three weights: 400 body and headlines, 600 emphasis and values, 700 uppercase labels.`);
    }
    for (const m of code.matchAll(/fontWeight:\s*['"]?(\w+)['"]?/g)) {
      const v = m[1];
      if (!/^\d+$/.test(v)) continue;            /* a JS expression, judged where it is defined */
      if (!WEIGHTS.includes(v)) fail(at, `fontWeight ${v} is not allowed. Three weights: 400, 600, 700.`);
    }
  });
}

/* ── 3 — every declared family is actually loaded ──────────────────────── */
const typeCss = readFileSync(join(ROOT, TYPE_CSS), 'utf8');
const declared = new Set();
for (const line of typeCss.split('\n')) {
  if (!/^\s*--mt-type-(sans|serif|mono)\s*:/.test(line)) continue;
  let m;
  QUOTED_NAME.lastIndex = 0;
  while ((m = QUOTED_NAME.exec(line))) {
    if (!GENERIC.has(m[1].toLowerCase())) declared.add(m[1]);
  }
}
if (declared.size !== 3) {
  fail(TYPE_CSS, `expected exactly 3 chosen families, found ${declared.size}: ${[...declared].join(', ') || '(none)'}`);
}

const html = readFileSync(join(ROOT, INDEX_HTML), 'utf8');
const linkTags = [...html.matchAll(/<link[^>]+fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0]);
const requested = new Set();
for (const tag of linkTags) {
  for (const m of tag.matchAll(/family=([A-Za-z0-9+]+)/g)) requested.add(m[1].replace(/\+/g, ' '));
}
for (const fam of declared) {
  if (!requested.has(fam)) {
    fail(INDEX_HTML, `"${fam}" is declared in ${TYPE_CSS} but never loaded. Visitors without it installed get a system fallback — that is exactly the 2026-09-08 bug.`);
  }
}
for (const fam of requested) {
  if (!declared.has(fam)) {
    fail(INDEX_HTML, `loads "${fam}", which no token uses. Delete the request or delete the family — never both states at once.`);
  }
}

/* ── 4 — no stray self-hosted faces ────────────────────────────────────── */
const fontDir = join(ROOT, 'public', 'fonts');
if (existsSync(fontDir)) {
  for (const name of readdirSync(fontDir)) {
    if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) {
      fail(`public/fonts/${name}`, 'a self-hosted face nothing declares. The site loads its three faces from the one <link> in index.html.');
    }
  }
}

/* ── 5 + 6 — live check ────────────────────────────────────────────────── */
const [base, ...paths] = process.argv.slice(2);
if (base) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const path of (paths.length ? paths : ['/'])) {
    const url = base.replace(/\/$/, '') + path;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    const found = await page.evaluate((words) => {
      const first = (f) => f.split(',')[0].replace(/["']/g, '').trim();
      const fams = new Set(); const prose = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent) continue;
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        const fam = first(cs.fontFamily);
        fams.add(fam);
        const isMono = /mono/i.test(fam) || cs.fontFamily.includes('monospace');
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const numeric = /^[^A-Za-z]*$/.test(text);
        /* The one opt-out, declared in the markup where a reviewer sees it:
           data-mono="code" on a formula or code block. Never a quiet special
           case inside this script. <code> and <pre> count as declared too. */
        const isCode = !!el.closest('[data-mono="code"], code, pre');
        if (isMono && !numeric && !isCode && wordCount >= words) {
          prose.push({ sel: el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), text: text.slice(0, 70) });
        }
      }
      const STEPS = [10, 11, 13, 15, 18, 26], WS = ['400', '600', '700'];
      const offScale = []; const seen = new Set();
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent) continue;
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
        const weight = cs.fontWeight;
        if (STEPS.includes(size) && WS.includes(weight)) continue;
        const sel = el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
        const k = sel + size + weight;
        if (seen.has(k)) continue;
        seen.add(k);
        offScale.push({ sel, size, weight, text: text.slice(0, 40) });
      }
      return { fams: [...fams], prose, offScale };
    }, PROSE_WORDS);

    for (const p of found.offScale) {
      fail(`${url} ${p.sel}`, `renders at ${p.size}px / ${p.weight} — off the six-step scale (10, 11, 13, 15, 18, 26) or not one of the three weights (400, 600, 700). "${p.text}…"`);
    }
    for (const p of found.prose) {
      fail(`${url} ${p.sel}`, `prose set in the mono face: "${p.text}…". Mono is for figures only.`);
    }
    for (const fam of found.fams) {
      if (!declared.has(fam) && !GENERIC.has(fam.toLowerCase())) {
        fail(url, `renders a fourth family: "${fam}".`);
      }
    }
  }
  await browser.close();
}

/* ── report ────────────────────────────────────────────────────────────── */
if (fails.length) {
  console.error(`\nFONT CHECK FAILED — ${fails.length} problem${fails.length > 1 ? 's' : ''}\n`);
  for (const f of fails) console.error('  ' + f + '\n');
  console.error('  The site has three typefaces and three tokens. See docs/TYPOGRAPHY_STANDARD.md.\n');
  process.exit(1);
}
console.log(`Font check passed. ${declared.size} families, all loaded: ${[...declared].join(', ')}.`);
