/* TickerSearch — header search box with Google/Yahoo-Finance-style
   autocomplete. As you type a symbol or company name it suggests matching
   stocks from the ticker_reference table (13k US tickers, browser-readable),
   ranked by market cap. Enter or click opens that ticker's detail page. */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function TickerSearch({ className = '', autoFocus = false }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const timer = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim().replace(/[%,]/g, '');
    if (!term) { setRes([]); setOpen(false); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = ++reqId.current;
      const { data } = await supabase
        .from('ticker_reference')
        .select('ticker,name,market_cap')
        .or(`ticker.ilike.${term}%,name.ilike.%${term}%`)
        .order('market_cap', { ascending: false, nullsFirst: false })
        .limit(8);
      if (id !== reqId.current) return; // drop out-of-order responses
      setRes(data || []);
      setOpen(true);
      setHi(0);
    }, 140);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = (t) => { if (!t) return; setQ(''); setRes([]); setOpen(false); navigate(`/ticker/${String(t).toUpperCase()}`); };

  const onKey = (e) => {
    if (!open || !res.length) { if (e.key === 'Enter' && q.trim()) go(q.trim()); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(res[hi]?.ticker); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const fmtCap = (c) => { const n = Number(c); if (!Number.isFinite(n) || n <= 0) return ''; if (n >= 1e12) return '$' + (n/1e12).toFixed(1) + 'T'; if (n >= 1e9) return '$' + (n/1e9).toFixed(1) + 'B'; if (n >= 1e6) return '$' + (n/1e6).toFixed(0) + 'M'; return ''; };

  return (
    /* 2026-10-28: the box's width and placement belong to the header that
       holds it (styles/redesign.css), not to an inline style here — the
       editorial header gives it 260px, the terminal header 280px with a
       prompt and a blinking cursor, the phone its own full-width row. */
    <div ref={boxRef} className={`mt-tickersearch ${className}`}>
      <span className="rd-search-prompt" aria-hidden="true">&gt;</span>
      <svg className="rd-search-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => { if (res.length) setOpen(true); }}
        placeholder="Search ticker or company"
        aria-label="Search tickers"
        spellCheck={false}
        autoComplete="off"
        /* 2026-09-01: was an inline style object with borderRadius 999 and a
           hardcoded 13px. Inline beats every stylesheet, so chrome-v13 could
           not touch it and the search stayed a cream-era pill on a v13 page.
           This is one of the 147 inline style objects the redesign is retiring:
           a style that cannot be themed is a style that will drift. */
        className="v13-search-input rd-search-input"
      />
      <span className="rd-search-cursor" aria-hidden="true" />
      {open && res.length > 0 && (
        <div className="rd-search-menu">
          {res.map((r, i) => (
            <div
              key={r.ticker}
              onMouseDown={() => go(r.ticker)}
              onMouseEnter={() => setHi(i)}
              className={`rd-search-item${i === hi ? ' is-hi' : ''}`}
            >
              <span className="rd-search-tk">{r.ticker}</span>
              <span className="rd-search-nm">{r.name}</span>
              <span className="rd-search-cap">{fmtCap(r.market_cap)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
