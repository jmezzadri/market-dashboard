/* TradingViewChart — official TradingView "Advanced Chart" embed.

   Added 2026-06-23. A separate, professional-grade interactive chart for the
   Ticker Detail page (candlesticks, intraday timeframes, 100+ indicators and
   drawing tools). It is deliberately NOT our system of record: the
   score-annotated BigHistoryChart above it (built from our own prices_eod
   feed) remains authoritative. This widget is a convenience layer only.

   Implementation notes:
   - Uses TradingView's public external-embedding script. No API key, no login,
     no cost. The script renders a self-contained chart inside its container.
   - Light theme to match MacroTilt's light-mode brand.
   - Mounted lazily by the parent (only when the user opens it), so the heavy
     TradingView bundle never loads on a normal page view.
   - Re-injects cleanly when the symbol changes; clears itself on unmount.
*/

import React, { useEffect, useRef } from 'react';

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

export default function TradingViewChart({ symbol, height = 520 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return undefined;

    container.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = `${height}px`;
    widget.style.width = '100%';
    container.appendChild(widget);

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
      theme: 'light',
      style: '1',
      locale: 'en',
      backgroundColor: '#ffffff',
      gridColor: 'rgba(42, 46, 57, 0.06)',
      hide_side_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, height]);

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
