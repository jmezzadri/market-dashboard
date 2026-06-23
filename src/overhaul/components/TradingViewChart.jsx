/* TradingViewChart — official TradingView "Advanced Chart" embed.

   Added 2026-06-23. A separate, professional-grade interactive chart for the
   Ticker Detail page (candlesticks, intraday timeframes, 100+ indicators and
   drawing tools). It is deliberately NOT our system of record: the
   score-annotated BigHistoryChart (built from our own prices_eod feed)
   remains authoritative. This widget is a convenience layer only.

   Implementation notes:
   - Uses TradingView's public external-embedding script. No API key, no login,
     no cost. The script renders a self-contained chart inside its container.
   - THEME-AWARE: follows the site theme. We read `data-mt-theme` on <html>
     (light vs navy/dark variants) and tell TradingView to render light or
     dark, with a background matched to the surrounding card so the chart
     never shows a bright white panel in dark mode. It also re-renders when
     the user flips the theme while the chart is open.
   - Mounted lazily by the parent (only when the user opens it), so the heavy
     TradingView bundle never loads on a normal page view.
   - Re-injects cleanly when the symbol or theme changes; clears on unmount.
*/

import React, { useEffect, useRef, useState } from 'react';

/* Map our stored exchange string to a TradingView exchange prefix. We only
   prefix when we're confident; otherwise we pass the bare symbol and let
   TradingView resolve it (the user can also switch symbols in the widget). */
export function tvSymbolFor(sym, exchange) {
  const s = (sym || '').toUpperCase().trim();
  if (!s) return '';
  const ex = (exchange || '').toUpperCase();
  if (/(NASDAQ|XNAS|NASD)/.test(ex)) return `NASDAQ:${s}`;
  if (/(NYSE|XNYS)/.test(ex)) return `NYSE:${s}`;
  return s;
}

/* The site has one light theme and several dark variants (e.g. "navy",
   "dark"). Anything that isn't explicitly "light" is treated as dark. */
function readSiteTheme() {
  if (typeof document === 'undefined') return 'light';
  const t = document.documentElement.getAttribute('data-mt-theme') || 'light';
  return t === 'light' ? 'light' : 'dark';
}

/* Find the effective (non-transparent) background colour of the nearest
   ancestor, so the chart's backdrop matches whatever card it sits in across
   every theme variant. Falls back to TradingView's own theme default. */
function effectiveBg(el, mode) {
  let n = el;
  while (n) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    n = n.parentElement;
  }
  return mode === 'dark' ? '#131722' : '#ffffff';
}

export default function TradingViewChart({ symbol, height = 480 }) {
  const containerRef = useRef(null);
  const [mode, setMode] = useState(readSiteTheme);

  // Re-render the widget if the user flips the site theme while it's open.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const obs = new MutationObserver(() => {
      const next = readSiteTheme();
      setMode((prev) => (prev === next ? prev : next));
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mt-theme'],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return undefined;

    container.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = `${height}px`;
    widget.style.width = '100%';
    container.appendChild(widget);

    const bg = effectiveBg(container, mode);
    const grid =
      mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(42, 46, 57, 0.06)';

    const script = document.createElement('script');
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: false,
      width: '100%',
      height,
      symbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: mode,
      style: '1',
      locale: 'en',
      backgroundColor: bg,
      gridColor: grid,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, height, mode]);

  return (
    <div style={{ height, width: '100%' }}>
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
