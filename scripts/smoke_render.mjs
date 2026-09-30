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
//
// 2026-09-30 rebuild. This list had not been touched since June and the gate
// had been red on EVERY pull request for weeks: it still opened /scanner
// (retired 2026-08-11, now a redirect to Home) and demanded a "MacroTilt
// Score" tile on the ticker page (scoped away 2026-07-20). A gate that is
// always red is bypassed every time, which is the same as no gate. Meanwhile
// Home, Macro and "All indicators" only had to contain one non-space
// character. The list now mirrors the top navigation, page for page, and each
// page must show the structural labels a reader would see plus real numbers.
//
// RULE: when a page is added to, renamed in, or retired from the top
// navigation, this list changes in the SAME pull request (LESSONS 0.10).
// Portfolio Lab is not listed: signed out it shows the sign-in screen, and
// this check has no login.
const PRICE = /\$\d[\d,.]*/;
const SURFACES = [
  {
    path: "/",
    name: "Home",
    mustInclude: ["The Engine", "Stress signal", "Yield regime"],
    mustMatch: [/\d/],
  },
  {
    path: "/macro",
    name: "Macro",
    mustInclude: ["The Engine", "Stress signal", "Yield regime", "Regime history"],
    mustMatch: [/\d/],
  },
  {
    path: "/paper",
    name: "Paper",
    mustInclude: ["Paper portfolio", "Portfolio value"],
    mustMatch: [PRICE],
    minPriceHits: 5,
  },
  {
    path: "/methodology",
    name: "Methodology",
    mustInclude: ["How MacroTilt actually works", "Sections"],
  },
  {
    path: "/admin/data",
    name: "Data",
    mustInclude: ["tracked elements", "External sources"],
    mustMatch: [/\d/],
  },
  {
    path: "/scorecard",
    name: "Scorecard",
    mustInclude: ["Trade Idea scorecard", "Published"],
    mustMatch: [/\d/],
  },
  {
    path: "/ticker/MTDR",
    name: "Ticker detail (MTDR)",
    mustInclude: ["Price history", "Key stats"],
    mustMatch: [PRICE],
    minPriceHits: 5,
    mustNotInclude: ["No price history on file"],
  },
  {
    // A small-cap that is NOT in universe_snapshots — guards the 2026-06-01
    // regression where key stats (sourced only from the snapshot) blanked out.
    // A populated Key-stats grid shows several real prices, so require >=5.
    path: "/ticker/NEWT",
    name: "Ticker detail (NEWT, off-snapshot)",
    mustInclude: ["Price history", "Key stats"],
    mustMatch: [PRICE],
    minPriceHits: 5,
    mustNotInclude: ["No price history on file"],
  },
];

let netErrors = 0;
const MIN_TEXT_CHARS = 400; // a real rendered page has plenty of text; a blank/white screen does not.

async function checkSurface(page, s) {
  const url = `${BASE}${s.path}`;
  const failures = [];
  // Network-level trouble seen while this page loaded (a request that never
  // completed, or a 5xx). Used only to decide whether one retry is fair.
  netErrors = 0;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    if (resp && resp.status() >= 400) failures.push(`HTTP ${resp.status()}`);
  } catch (e) {
    netErrors++;
    return [`navigation failed: ${e.message}`];
  }

  // Poll up to ~20s for the SPA to settle. "Settled" means every expected
  // marker is present, enough real prices have arrived, AND no loading
  // placeholder is still on screen. The old loop stopped as soon as the labels
  // appeared, so a chart still fetching its history was graded mid-load and
  // "No price history on file" failed a healthy page (2026-09-30).
  let text = "";
  const deadline = Date.now() + 20000;
  do {
    text = await page.evaluate(() => document.body?.innerText || "");
    const lc = text.toLowerCase();
    const hasAll = (s.mustInclude || []).every((m) => lc.includes(m.toLowerCase()));
    const noPlaceholder = (s.mustNotInclude || []).every((m) => !lc.includes(m.toLowerCase()));
    const enoughPrices = !s.minPriceHits || (text.match(/\$\d[\d,.]*/g) || []).length >= s.minPriceHits;
    if (text.length >= MIN_TEXT_CHARS && hasAll && noPlaceholder && enoughPrices) break;
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);

  // The page we asked for must be the page we got: a retired route that
  // redirects elsewhere would otherwise pass on the other page's content.
  const landed = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  if (landed !== s.path) failures.push(`redirected to ${landed}`);

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
  page.on("response", (r) => { if (r.status() >= 500) netErrors++; });
  page.on("requestfailed", (r) => { if ((r.failure()?.errorText || "").indexOf("ERR_ABORTED") === -1) netErrors++; });
  let broken = 0;
  for (const s of SURFACES) {
    let failures = await checkSurface(page, s);
    // One retry, only when the network itself misbehaved while the page
    // loaded (a request failed outright, or a server answered 5xx). A page
    // that loads cleanly and shows the wrong thing is never retried; a real
    // outage fails twice and still blocks.
    if (failures.length && netErrors > 0) {
      console.log(`  … ${s.name}: ${netErrors} network error(s) during load, retrying once`);
      await page.waitForTimeout(3000);
      failures = await checkSurface(page, s);
    }
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
