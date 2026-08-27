// render_page.cjs — load a LIVE macrotilt.com page in a real browser and read it.
//
// LESSONS 0.12 (Joe, 2026-08-27): "YOU CAN LOAD MT site... NEVER TELL ME THIS
// AGAIN." Sessions kept reporting the rendered-page check as impossible. It is
// not. Chromium cannot traverse this container's local CONNECT egress proxy
// (net::ERR_CONNECTION_RESET), but node's fetch traverses it fine — so serve
// every request to the page from node and Chromium never touches the network.
//
//   node scripts/render_page.cjs https://macrotilt.com/ /tmp/home.png
//
// Prints the page's innerText and writes a full-page screenshot. Works for the
// client-rendered React site; WebFetch does NOT (it returns only <head>).
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2], out = process.argv[3];
  const b = await chromium.launch({ args: ['--no-sandbox'] });
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
