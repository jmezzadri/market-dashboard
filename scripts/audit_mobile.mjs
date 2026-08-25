import { chromium, devices } from 'playwright';

const ROUTES = ['/', '/macro', '/paper', '/portfolio-lab', '/methodology',
                '/scorecard', '/admin/data', '/ticker/AAPL', '/about'];
const VW = 393, VH = 852;   // iPhone 14/15 Pro logical viewport

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({
  viewport: { width: VW, height: VH }, deviceScaleFactor: 3, isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

const audit = async (route) => {
  const errs = [];
  page.removeAllListeners('pageerror');
  page.on('pageerror', e => errs.push(e.message.slice(0, 90)));
  try {
    await page.goto('http://localhost:4200' + route, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(3200);
  } catch (e) { return { route, fatal: String(e.message).slice(0, 80) }; }
  await page.addStyleTag({ content: '.rv{opacity:1!important;filter:none!important;transform:none!important}' });
  await page.waitForTimeout(600);

  return await page.evaluate((VW) => {
    const docW = document.documentElement.scrollWidth;
    const overflow = docW - VW;
    // elements that stick out past the viewport
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > VW + 2 || r.left < -2) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed') continue;
        // Inside a horizontally scrollable ancestor (a wide table that scrolls
        // in its own box), extending past the viewport is CORRECT, not a bug.
        let anc = el.parentElement, inScroller = false;
        while (anc && anc !== document.body) {
          const as = getComputedStyle(anc);
          if (/auto|scroll/.test(as.overflowX) && anc.scrollWidth > anc.clientWidth + 2) { inScroller = true; break; }
          anc = anc.parentElement;
        }
        if (inScroller) continue;
        wide.push({
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
          w: Math.round(r.width), right: Math.round(r.right),
        });
      }
    }
    // dedupe by selector, keep worst
    const worst = {};
    for (const w of wide) if (!worst[w.sel] || w.right > worst[w.sel].right) worst[w.sel] = w;
    const tiny = [], taps = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      const fs = parseFloat(s.fontSize);
      if (fs && fs < 11.5 && el.textContent.trim().length > 2 && el.children.length === 0) tiny.push(Math.round(fs*10)/10);
      if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')
          && (r.height < 40 || r.width < 32) && el.textContent.trim()) taps.push(Math.round(r.height));
    }
    return {
      docW, overflow,
      offenders: Object.values(worst).sort((a, b) => b.right - a.right).slice(0, 6),
      tinyFonts: tiny.length, minFont: tiny.length ? Math.min(...tiny) : null,
      smallTaps: taps.length, minTap: taps.length ? Math.min(...taps) : null,
      pageH: document.documentElement.scrollHeight,
    };
  }, VW).then(r => ({ route, ...r, errs: errs.length ? errs.slice(0,2) : undefined }));
};

for (const r of ROUTES) {
  const a = await audit(r);
  if (a.fatal) { console.log(`${r.padEnd(16)} FATAL ${a.fatal}`); continue; }
  const flag = a.overflow > 2 ? `OVERFLOW +${a.overflow}px` : 'no h-scroll';
  console.log(`${r.padEnd(16)} ${flag.padEnd(18)} tinyFonts=${String(a.tinyFonts).padEnd(4)} (min ${a.minFont||'-'}px)  smallTaps=${String(a.smallTaps).padEnd(4)}(min ${a.minTap||'-'}px)  h=${a.pageH}`);
  if (a.offenders.length) a.offenders.forEach(o => console.log(`      ${String(o.right).padStart(5)}px right  w=${String(o.w).padStart(5)}  ${o.sel}`));
  if (a.errs) a.errs.forEach(e => console.log(`      JS ERROR: ${e}`));
  await page.screenshot({ path: `/tmp/eq/m${r.replace(/\W/g,'_')}.png`, fullPage: false });
}
await b.close();
