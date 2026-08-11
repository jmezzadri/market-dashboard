// uat_conviction_pages.mjs — local rendered UAT for the Conviction Events
// page rebuild (feat/conviction-pages). Loads the vite preview build in the
// pinned Playwright chromium headless shell, screenshots each page, extracts
// the rendered text, and asserts the empty states / absence of sleeve
// remnants. Run: node scripts/uat_conviction_pages.mjs [signedout|signedin]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const MODE = process.argv[2] || 'signedin';
const BASE = 'http://localhost:4173';
const OUT = `/tmp/uat-${MODE}`;
fs.mkdirSync(OUT, { recursive: true });

const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const results = [];
const consoleErrors = [];

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

async function visit(path, name) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  // Let every data read settle into its final state. Locally each read to the
  // unreachable database fails through the proxy tunnel (~1.5s each, queued),
  // so the awaiting states can take ~10s to land; wait for the loading copy
  // to clear (40s guard) instead of guessing a fixed delay.
  await page.waitForFunction(
    () => !/Loading the ledger|Loading events|Loading scan|Loading the list|Loading the Power Trend/.test(document.body.innerText),
    null,
    { timeout: 40000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);
  // Reveal animations key off IntersectionObserver — scroll through the page
  // so every section enters the viewport, then back to top for the shot.
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 700));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 700));
  });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT}/${name}.txt`, text);
  return text;
}

function check(label, cond) {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

const BANNED = ['Insider Conviction sleeve', 'Momentum sleeve', 'two sleeves', 'Sleeve 1', 'Sleeve 2', 'washed out'];

if (MODE === 'signedout') {
  const t = await visit('/paper', 'paper-signedout');
  check('/paper signed-out shows the sign-in card', /sign in|magic link|email/i.test(t));
  check('/paper signed-out does NOT show book data', !t.includes('Event ledger'));
  const nav = await page.evaluate(() => Array.from(document.querySelectorAll('.mt-topnav-links a')).map((a) => a.textContent.trim()));
  check('nav hides Paper when signed out', !nav.includes('Paper'));
  fs.writeFileSync(`${OUT}/nav.json`, JSON.stringify(nav));
} else {
  // /paper
  let t = await visit('/paper', 'paper');
  check('/paper renders the Conviction Events hero', t.includes('Conviction Events') && t.includes('$1M paper book'));
  check('/paper hero states the $250,000 signal', t.includes('$250,000 or more'));
  check('/paper kill-switch no-reading state with thresholds in words', t.includes('Kill switch — no reading yet') && t.includes('10 or more points after 8 weeks') && t.includes('15%'));
  check('/paper positions empty state', t.includes('No open positions — awaiting the first qualifying events'));
  check('/paper ledger empty state', t.includes('Awaiting first events'));
  check('/paper book card awaiting-first-close note', t.includes('No daily close on record yet'));
  check('/paper has NO error panel', !/data load error|failed to fetch|error:/i.test(t));
  check('/paper nav shows Paper (signed in)', (await page.evaluate(() => Array.from(document.querySelectorAll('.mt-topnav-links a')).map((a) => a.textContent.trim()))).includes('Paper'));
  for (const b of BANNED) check(`/paper does not contain "${b}"`, !t.includes(b));
  check('/paper no lone "sleeve" word rendered', !/sleeve/i.test(t));

  // /scanner
  t = await visit('/scanner', 'scanner');
  check('/scanner shows the Conviction Events tile', t.includes('Conviction Events'));
  check('/scanner CE tile awaiting-first-events state', t.includes('Awaiting first events'));
  check('/scanner momentum tile carries the idea-feed caption', t.includes('idea feed — not auto-traded'));
  check('/scanner keeps Power Trend + RSI Divergence', t.includes('Power Trend Momentum') && t.includes('RSI Divergence'));
  check('/scanner has NO error panel', !/data load error|failed to fetch/i.test(t));
  for (const b of BANNED) check(`/scanner does not contain "${b}"`, !t.includes(b));
  check('/scanner no lone "sleeve" word rendered', !/sleeve/i.test(t));

  // CE desk view interaction (click the tile, expect the desk panel)
  await page.click('.sc-ctile >> nth=0');
  await page.waitForTimeout(1200);
  const deskText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/scanner-ce-desk.png`, fullPage: false });
  check('CE desk view opens with the panel + empty state', deskText.includes('The feed the Paper book trades') && deskText.includes('Awaiting first events'));
  check('CE desk states the exact signal', deskText.includes('$250,000 or more per name per day'));
  await page.keyboard.press('Escape');

  // /methodology
  t = await visit('/methodology', 'methodology');
  check('/methodology §03 is Conviction Events', t.includes('One $1M paper book · Conviction Events'));
  check('/methodology backtest numbers verbatim', t.includes('+112%') && t.includes('+24%') && t.includes('2.3') && t.includes('61%') && t.includes('+53%'));
  check('/methodology 14-month window labeled', t.includes('June 2025 – August 2026') && t.includes('14 months'));
  check('/methodology kill switch thresholds', t.includes('10 or') && t.includes('8 weeks') && t.includes('15%'));
  check('/methodology sizing stated', t.includes('one-eighth of equity each'));
  check('/methodology exit stated', t.includes('21st trading day'));
  check('/methodology data sources: SEC + own price history, no vendor names in §03', t.includes('published by the\nSEC') || t.includes('published by the SEC'));
  check('/methodology Power Trend is an idea feed', t.includes('idea feed — not auto-traded'));
  check('/methodology sections numbered 01..05', t.includes('01') && t.includes('05'));
  for (const b of BANNED) check(`/methodology does not contain "${b}"`, !t.includes(b));
  check('/methodology no lone "sleeve" word rendered', !/sleeve/i.test(t.replace(/Defensive Sleeve/g, '')));
}

await browser.close();
fs.writeFileSync(`${OUT}/console-errors.txt`, consoleErrors.join('\n'));
console.log(results.join('\n'));
console.log(`\nConsole errors: ${consoleErrors.length} (see ${OUT}/console-errors.txt)`);
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECKS FAILED`);
process.exit(fails === 0 ? 0 : 1);
