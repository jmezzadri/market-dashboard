// render_page.cjs — load a LIVE macrotilt.com page in a real browser and read it.
//
// LESSONS 0.12 (Joe, 2026-08-27): "YOU CAN LOAD MT site... NEVER TELL ME THIS
// AGAIN." Sessions kept reporting the rendered-page check as impossible. It is
// not. Chromium cannot traverse this container's local CONNECT egress proxy
// (net::ERR_CONNECTION_RESET), and going around it with --no-proxy-server now
// fails the other way (net::ERR_CERT_AUTHORITY_INVALID -- direct egress is
// TLS-intercepted by a CA that Chromium's own trust store does not carry).
// node's fetch traverses the proxy fine and trusts the bundle, so serve every
// request to the page from node and Chromium never touches the network at all.
// That is why this file exists: it is immune to BOTH failures. Use it rather
// than re-deriving a browser launch flag every morning.
//
//   node scripts/render_page.cjs https://macrotilt.com/ /tmp/home.png
//
// Prints the page's innerText and writes a full-page screenshot. Works for the
// client-rendered React site; WebFetch does NOT (it returns only <head>).
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2], out = process.argv[3];
  // The sandbox ships Chromium at /opt/pw-browsers/chromium and sets
  // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, so playwright's own bundled
  // chrome-headless-shell is NOT on disk. Without an explicit executablePath
  // the launch dies with "Executable doesn't exist ... chrome-headless-shell"
  // and a session concludes the render is impossible. Never run
  // `playwright install` here -- point at the preinstalled binary instead.
  const fs = require('fs');
  const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const launchOpts = { args: ['--no-sandbox'] };
  if (fs.existsSync(CHROMIUM)) launchOpts.executablePath = CHROMIUM;
  const b = await chromium.launch(launchOpts);
  const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
  // Chromium can't traverse the container's CONNECT proxy, but node's fetch can.
  // Serve every request to the page from node instead of from Chromium's stack.
  await p.route('**/*', async (route) => {
    const req = route.request();
    try {
      const r = await fetch(req.url(), {
        method: req.method(),
        headers: req.headers(),
        body: ['GET','HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(),
        redirect: 'follow',
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const h = {};
      r.headers.forEach((v, k) => {
        if (!['content-encoding','content-length','transfer-encoding'].includes(k)) h[k] = v;
      });
      await route.fulfill({ status: r.status, headers: h, body: buf });
    } catch (e) { await route.abort(); }
  });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: out, fullPage: true });
  console.log(await p.evaluate(() => document.body.innerText));
  await b.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
