/* TickerSearch — header search box with Google/Yahoo-Finance-style
   autocomplete. As you type a symbol or company name it suggests matching
   stocks from the ticker_reference table (13k US tickers, browser-readable),
   ranked by market cap. Enter or click opens that ticker's detail page. */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function TickerSearch() {
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
    <div ref={boxRef} className="mt-tickersearch" style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420, margin: '0 16px' }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => { if (res.length) setOpen(true); }}
        placeholder="Search any ticker or company…"
        aria-label="Search tickers"
        spellCheck={false}
        autoComplete="off"
        /* 2026-09-01: was an inline style object with borderRadius 999 and a
           hardcoded 13px. Inline beats every stylesheet, so chrome-v13 could
           not touch it and the search stayed a cream-era pill on a v13 page.
           This is one of the 147 inline style objects the redesign is retiring:
           a style that cannot be themed is a style that will drift. */
        className="v13-search-input"
      />
      {open && res.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--mt-surface)', border: '1px solid var(--mt-line-1)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,.22)', overflow: 'hidden', zIndex: 9999 }}>
          {res.map((r, i) => (
            <div
              key={r.ticker}
              onMouseDown={() => go(r.ticker)}
              onMouseEnter={() => setHi(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', cursor: 'pointer', background: i === hi ? 'var(--mt-surface-2)' : 'transparent' }}
            >
              <span style={{ fontWeight: 700, fontFamily: 'var(--mt-font-mono)', fontSize: 12.5, minWidth: 58, color: 'var(--mt-ink-0)' }}>{r.ticker}</span>
              <span style={{ fontSize: 12, color: 'var(--mt-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mt-ink-3)', fontFamily: 'var(--mt-font-mono)' }}>{fmtCap(r.market_cap)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
