// check_rendered_dom.mjs — RENDERED-page smoke test (LESSONS 4.32).
//
// Why this exists (2026-09-02): the pre-open tape stamped the S&P / Nasdaq /
// Dow tiles "live" while showing Tuesday's close. Every existing check was
// blind to it by construction: DAILY-HOME-SMOKE validates the JSON files,
// pipeline_health grades producers, and the cloud health-sweep session cannot
// reach the site with a real browser (its egress resets the connection, and a
// plain fetch gets an empty SPA shell). Joe found it with his eyes. The fix
// class is the one LESSONS 4.31 already names: grade what the reader SEES.
//
// This script runs where a real browser CAN see the site — GitHub Actions —
// renders / and /paper in headless Chromium, and:
//
//   1. PRINTS each page's rendered text between RENDERED-TEXT markers, so the
//      daily cloud health sweep can read the rendered page from this run's
//      log (ops-code-commit {"run_log": <id>}) instead of needing a browser.
//   2. ASSERTS label/semantic invariants that are bugs by construction:
//        - no tape tile stamped "live" when the session is known closed.
//          EXPECT_MARKET_CLOSED=1 is the schedule's INTENT (the cron fires
//          pre-open) — but GitHub delivers scheduled fires late by hours
//          (2026-09-03: the 11:10 UTC fire arrived 14:58 UTC = 10:58 ET,
//          market open, and the event-type proxy filed a false P0, #1250).
//          So the script re-checks the ACTUAL ET clock at run time and only
//          asserts when the regular session is provably closed (weekend, or
//          outside 09:30–16:00 ET). Inside regular hours it skips the
//          assertion and says why — a weekday holiday cannot be ruled out
//          without a calendar, and a monitor that cannot tell must stay
//          quiet rather than alarm (LESSONS 5.7, 5.19 rule 4, 4.32.1);
//        - the tape rendered at all, with real values (not an em-dash storm);
//        - no visible NaN / undefined / literal "null" on either page;
//        - no majority-"Unclassified" book on /paper (the 4.31 launch bug).
//      Data FRESHNESS is deliberately not asserted here — pipeline_health and
//      FRESHNESS-ALARM own that; this checker owns what the page CLAIMS.
//   3. FILES a P0 into Supabase bug_reports on any violation (same pattern as
//      scripts/check_producer_contracts.py), so triage sees it before Joe.
//
// Usage: node scripts/check_rendered_dom.mjs
// Env:   EXPECT_MARKET_CLOSED=1  → assert no "live" stamps (pre-open runs)
//        SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → enable bug filing

import { chromium } from 'playwright';

const LIVE_BASE = 'https://macrotilt.com';

// Session state comes from the actual clock, never from the event type.
// A "pre-open" cron delivered during market hours (GitHub delay, routinely
// hours — see 2026-09-03, run 33769946910) must not assert "closed" against
// an open session. Weekday inside 09:30–16:00 ET → possibly open (a holiday
// cannot be ruled out without a calendar) → the closed-session assertion is
// skipped, with a printed reason. Everything else the script checks still runs.
function etClock() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric',
    minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const EXPECT_CLOSED_INTENT = process.env.EXPECT_MARKET_CLOSED === '1';
const { weekday: ET_WD, minutes: ET_MIN } = etClock();
const IN_REGULAR_HOURS =
  !['Sat', 'Sun'].includes(ET_WD) && ET_MIN >= 9 * 60 + 30 && ET_MIN < 16 * 60;
const EXPECT_CLOSED = EXPECT_CLOSED_INTENT && !IN_REGULAR_HOURS;
if (EXPECT_CLOSED_INTENT && !EXPECT_CLOSED) {
  console.log(
    `NOTE: scheduled fire landed inside regular trading hours (${ET_WD} ${Math.floor(ET_MIN / 60)}:${String(ET_MIN % 60).padStart(2, '0')} ET) — ` +
    'the closed-session "live"-stamp assertion is skipped: the session cannot be presumed closed from the schedule (LESSONS 5.19 rule 4).',
  );
}

const violations = [];

function section(name, text) {
  console.log(`\n===== RENDERED-TEXT ${name} BEGIN =====`);
  console.log(text);
  console.log(`===== RENDERED-TEXT ${name} END =====\n`);
}

async function renderPage(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
  await page.goto(`${LIVE_BASE}${path}`, { waitUntil: 'networkidle', timeout: 90_000 });
  // The SPA hydrates and then polls; give the first data pass time to land.
  await page.waitForTimeout(8_000);
  return page;
}

function scanCommonText(name, text) {
  // Visible junk values. Word-bounded so e.g. "nullable" in prose can't trip it.
  for (const [re, label] of [
    [/\bNaN\b/, 'literal "NaN"'],
    [/\bundefined\b/, 'literal "undefined"'],
    [/(^|\s)null(\s|$)/, 'literal "null"'],
  ]) {
    if (re.test(text)) violations.push(`[${name}] visible ${label} in rendered page text`);
  }
  // The 4.31 launch bug: a book rendering majority-unclassified. A small
  // residual (a name missing from qt_gics) is legitimate and stays quiet.
  const m = text.match(/Unclassified\s+(\d{1,3}(?:\.\d+)?)%/);
  if (m && parseFloat(m[1]) >= 50) {
    violations.push(`[${name}] "Unclassified ${m[1]}%" rendered — classification writer is not running (LESSONS 4.31)`);
  }
}

async function checkHome(browser) {
  const page = await renderPage(browser, '/');
  const text = await page.evaluate(() => document.body.innerText);
  section('HOME', text.slice(0, 6000));

  // Tape tiles: label / value / stamp, straight from the DOM the reader sees.
  const tiles = await page.$$eval('.tape .row > *', (nodes) =>
    nodes.map((n) => ({
      label: n.querySelector('.tk')?.textContent?.trim() ?? null,
      value: n.querySelector('.tv')?.textContent?.trim() ?? null,
      stamp: n.querySelector('.td small')?.textContent?.trim() ?? null,
    })).filter((t) => t.label),
  ).catch(() => []);

  console.log('TAPE TILES:', JSON.stringify(tiles));

  if (tiles.length === 0) {
    violations.push('[home] market tape did not render (zero tiles found)');
  } else {
    const withValue = tiles.filter((t) => t.value && t.value !== '—');
    if (withValue.length === 0) {
      violations.push('[home] every tape tile renders an em-dash — no values reached the page');
    }
    if (EXPECT_CLOSED) {
      const liveWhileClosed = tiles.filter((t) => (t.stamp || '').toLowerCase() === 'live');
      if (liveWhileClosed.length > 0) {
        violations.push(
          `[home] ${liveWhileClosed.length} tile(s) stamped "live" while the session is closed: ` +
          liveWhileClosed.map((t) => t.label).join(', ') +
          ' — a closed-market quote is a close and must say so (LESSONS 4.32)',
        );
      }
    }
  }

  // Header freshness pill: REPORT, never assert — freshness alarms own truth
  // here, but the sweep reading this log should see what the header says.
  const headerPill = await page.$eval('header', (h) => h.innerText).catch(() => '(no header found)');
  console.log('HEADER TEXT:', JSON.stringify(headerPill.slice(0, 400)));

  scanCommonText('home', text);
  await page.close();
}

async function checkPaper(browser) {
  const page = await renderPage(browser, '/paper');
  const text = await page.evaluate(() => document.body.innerText);
  section('PAPER', text.slice(0, 6000));
  if (text.trim().length < 200) {
    violations.push('[paper] page rendered nearly empty (<200 chars of text)');
  }
  scanCommonText('paper', text);
  await page.close();
}

async function fileBug() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('  (cannot file bug: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)');
    return;
  }
  const body =
    'Rendered-DOM smoke test found the live site SAYING something wrong — ' +
    'these are label/semantic violations on the page as actually rendered in ' +
    'a real browser, not data-freshness reds.\n\nViolations:\n' +
    violations.map((v) => `  ${v}`).join('\n') +
    '\n\nFiled automatically by .github/workflows/RENDERED-DOM-SMOKE.yml ' +
    '(scripts/check_rendered_dom.mjs). See LESSONS 4.32.';
  const resp = await fetch(`${url}/rest/v1/bug_reports`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      title: 'P0 — rendered-page label/semantic violation on live site',
      description: body,
      url_full: LIVE_BASE,
      reporter_email: 'smoke-test@macrotilt.com',
      status: 'new',
    }),
  }).catch((e) => ({ ok: false, statusText: String(e) }));
  if (resp.ok) {
    const row = await resp.json();
    console.log(`  → filed bug #${row?.[0]?.report_number ?? '?'}`);
  } else {
    console.log(`  could not file bug: ${resp.status ?? ''} ${resp.statusText ?? ''}`);
  }
}

const browser = await chromium.launch();
try {
  await checkHome(browser);
  await checkPaper(browser);
} finally {
  await browser.close();
}

if (violations.length > 0) {
  console.log('\nRENDERED-DOM SMOKE: FAIL');
  for (const v of violations) console.log(`  ✗ ${v}`);
  await fileBug();
  process.exit(1);
}
console.log('\nRENDERED-DOM SMOKE: PASS (expect_market_closed intent=' + EXPECT_CLOSED_INTENT + ' effective=' + EXPECT_CLOSED + ')');
