// smoke_render.mjs — "actually open each page and look" check.
//
// Loads the live data surfaces in a real headless browser and fails if a page
// is broken or shows blanks where real values belong. This is the automated
// version of the manual page-by-page verification done on 2026-06-01; it runs
// on every PR against that PR's preview deployment and BLOCKS the merge if any
// surface is broken (Joe directive 2026-06-01: hard block, actually open each
// page).
//
// Usage:  node scripts/smoke_render.mjs [BASE_URL]
//         BASE_URL env var also accepted. Defaults to https://macrotilt.com
//
// Exit 0 = every checked page loaded and showed real content.
// Exit 1 = at least one page broken / blank / missing expected values.

import { chromium } from "playwright";

const BASE = (process.argv[2] || process.env.BASE_URL || "https://macrotilt.com").replace(/\/$/, "");

// Signatures that mean a page crashed / rendered an error boundary or a blank.
const ERROR_SIGNATURES = [
  "Something went wrong",
  "Application error",
  "This page could not be found",
  "Unexpected Application Error",
];

// Each surface: the route, a friendly name, the substrings that MUST be
// present (proves real content rendered), and substrings that must NOT appear
// (proves nothing is left as a placeholder/blank where data belongs).
const SURFACES = [
  {
    path: "/scanner",
    name: "Trading scanner",
    mustInclude: ["MacroTilt Score", "Insider"],
    mustMatch: [/\$\d[\d,.]*/], // at least one real price
    minPriceHits: 3,
  },
  {
    path: "/ticker/MTDR",
    name: "Ticker detail (MTDR)",
    mustInclude: ["Price history", "MACROTILT SCORE", "Key stats"],
    mustMatch: [/\$\d[\d,.]*/],
    mustNotInclude: ["No price history on file"],
  },
  {
    // A scanner discovery name that is NOT in universe_snapshots — guards the
    // 2026-06-01 regression where key stats (sourced only from the snapshot)
    // blanked out for small-caps. A populated Key-stats grid shows several
    // real prices (open/high/low/52w hi/lo + header), so require >=5.
    path: "/ticker/NEWT",
    name: "Ticker detail (NEWT, off-snapshot)",
    mustInclude: ["Price history", "Key stats"],
    mustMatch: [/\$\d[\d,.]*/],
    minPriceHits: 5,
    mustNotInclude: ["No price history on file"],
  },
  { path: "/", name: "Home", mustMatch: [/\S/] },
  { path: "/macro", name: "Macro overview", mustMatch: [/\S/] },
  { path: "/tilt", name: "Asset Tilt", mustMatch: [/\S/] },
  { path: "/indicators", name: "All indicators", mustMatch: [/\S/] },
];

const MIN_TEXT_CHARS = 400; // a real rendered page has plenty of text; a blank/white screen does not.

async function checkSurface(page, s) {
  const url = `${BASE}${s.path}`;
  const failures = [];
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    if (resp && resp.status() >= 400) failures.push(`HTTP ${resp.status()}`);
  } catch (e) {
    return [`navigation failed: ${e.message}`];
  }

  // Poll up to ~12s for the SPA to render the expected markers.
  let text = "";
  const deadline = Date.now() + 12000;
  do {
    text = await page.evaluate(() => document.body?.innerText || "");
    const lc = text.toLowerCase();
    const hasAll = (s.mustInclude || []).every((m) => lc.includes(m.toLowerCase()));
    if (text.length >= MIN_TEXT_CHARS && hasAll) break;
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);

  // Compare case-insensitively: many labels render in CSS uppercase
  // (text-transform), which the browser reflects in innerText.
  const lc = text.toLowerCase();
  if (text.length < MIN_TEXT_CHARS) failures.push(`page looks blank (only ${text.length} chars of text)`);
  for (const sig of ERROR_SIGNATURES) if (lc.includes(sig.toLowerCase())) failures.push(`error signature on page: "${sig}"`);
  for (const m of s.mustInclude || []) if (!lc.includes(m.toLowerCase())) failures.push(`missing expected text: "${m}"`);
  for (const m of s.mustNotInclude || []) if (lc.includes(m.toLowerCase())) failures.push(`unexpected placeholder text: "${m}"`);
  for (const rx of s.mustMatch || []) if (!rx.test(text)) failures.push(`expected pattern not found: ${rx}`);
  if (s.minPriceHits) {
    const hits = (text.match(/\$\d[\d,.]*/g) || []).length;
    if (hits < s.minPriceHits) failures.push(`expected >=${s.minPriceHits} real prices, found ${hits}`);
  }
  return failures;
}

async function main() {
  console.log(`Smoke-rendering surfaces against ${BASE}\n`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let broken = 0;
  for (const s of SURFACES) {
    const failures = await checkSurface(page, s);
    if (failures.length) {
      broken++;
      console.log(`✗ ${s.name}  (${s.path})`);
      failures.forEach((f) => console.log(`     - ${f}`));
    } else {
      console.log(`✓ ${s.name}  (${s.path})`);
    }
  }
  await browser.close();
  console.log("");
  if (broken) {
    console.log(`✗ ${broken} surface(s) broken — blocking.`);
    process.exit(1);
  }
  console.log("✓ All surfaces rendered real content.");
}

main().catch((e) => { console.error("smoke runner crashed:", e); process.exit(1); });
