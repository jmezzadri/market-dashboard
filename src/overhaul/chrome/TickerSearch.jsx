/* TickerSearch — header search box with Google/Yahoo-Finance-style
   autocomplete. As you type a symbol or company name it suggests matching
   stocks from the ticker_reference table (13k US tickers, browser-readable),
   ranked by market cap. Enter or click opens that ticker's detail page.

   2026-10-29 audit: a search with no match showed nothing at all, and Enter
   then sent the reader to a page for a symbol that does not exist. The menu
   now always answers — "Searching…", the matches, or "No US-listed stock
   matches …" — and says where a pick goes. Enter opens the highlighted
   match (the exact symbol leads the list); with no match it stays put. */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const termOf = (s) => String(s || '').trim().replace(/[%,()]/g, '');

export default function TickerSearch({ className = '', autoFocus = false }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  // 'idle' | 'searching' | 'done' | 'error' — what the menu says when empty
  const [phase, setPhase] = useState('idle');
  const [doneFor, setDoneFor] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const timer = useRef(null);
  const reqId = useRef(0);
  const enterPending = useRef(false);
  /* Enter reads refs, never the last render's state. 2026-10-30 live check:
     clear the box, type "spy", press Enter at once — nothing happened, because
     the keystroke handler still held the cleared box's "idle" state. The menu's
     current list and the text it answers live here, and the text in the box is
     read from the box itself. */
  const shown = useRef({ term: '', list: [] });
  const latestTerm = useRef('');

  useEffect(() => {
    const term = termOf(q);
    if (!term) { shown.current = { term: '', list: [] }; setRes([]); setOpen(false); setPhase('idle'); return; }
    clearTimeout(timer.current);
    setPhase('searching');
    setOpen(true);
    timer.current = setTimeout(async () => {
      const id = ++reqId.current;
      // The exact symbol is asked for separately and leads the list, so
      // Enter on "F" opens Ford — not the largest company whose name or
      // symbol merely contains an F (2026-10-29).
      const [{ data, error }, { data: exactRows }] = await Promise.all([
        supabase
          .from('ticker_reference')
          .select('ticker,name,market_cap')
          .or(`ticker.ilike.${term}%,name.ilike.%${term}%`)
          .order('market_cap', { ascending: false, nullsFirst: false })
          .limit(8),
        /^[A-Za-z.-]{1,7}$/.test(term)
          ? supabase.from('ticker_reference').select('ticker,name,market_cap').eq('ticker', term.toUpperCase()).limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      // Drop out-of-order responses, and any answer to text no longer in the
      // box — a pending Enter must never open the top match of an older term.
      if (id !== reqId.current || term !== latestTerm.current) return;
      const exact = exactRows || [];
      const rest = (data || []).filter((r) => !exact.some((x) => x.ticker === r.ticker));
      const list = [...exact, ...rest].slice(0, 8);
      shown.current = { term, list };
      if (enterPending.current) {
        enterPending.current = false;
        if (list.length) { go(list[0].ticker); return; }
      }
      setRes(list);
      setPhase(error ? 'error' : 'done');
      setDoneFor(term);
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

  const go = (t) => {
    if (!t) return;
    enterPending.current = false; latestTerm.current = '';
    setQ(''); setRes([]); setOpen(false);
    navigate(`/ticker/${String(t).toUpperCase()}`);
  };

  const onChange = (e) => {
    latestTerm.current = termOf(e.target.value);
    enterPending.current = false; // typing after Enter means the reader is not done
    setQ(e.target.value);
  };

  /* Enter opens the highlighted match when the menu already answers the text
     in the box. Pressed before the matches arrive, it waits for them and opens
     the top one — the exact symbol when there is one — instead of navigating to
     whatever was typed ("apple" used to open /ticker/APPLE). With no match it
     stays put and the menu says so. */
  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || !res.length) return;
      e.preventDefault();
      setHi((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, res.length - 1) : Math.max(h - 1, 0)));
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = termOf(e.currentTarget.value);
    if (!term) return;
    if (shown.current.term === term) {
      const pick = shown.current.list[hi] || shown.current.list[0];
      if (pick) go(pick.ticker);
      return;
    }
    enterPending.current = true;
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
        onChange={onChange}
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
      {open && q.trim() && (
        <div className="rd-search-menu" role="listbox" aria-label="Matching stocks">
          {res.length > 0 ? (
            <>
              {res.map((r, i) => (
                <div
                  key={r.ticker}
                  role="option"
                  aria-selected={i === hi}
                  onMouseDown={() => go(r.ticker)}
                  onMouseEnter={() => setHi(i)}
                  className={`rd-search-item${i === hi ? ' is-hi' : ''}`}
                >
                  <span className="rd-search-tk">{r.ticker}</span>
                  <span className="rd-search-nm">{r.name}</span>
                  <span className="rd-search-cap">{fmtCap(r.market_cap)}</span>
                </div>
              ))}
              <div className="rd-search-foot">Opens the stock&rsquo;s page · ↑ ↓ to move, Enter to open</div>
            </>
          ) : phase === 'searching' ? (
            <div className="rd-search-empty">Searching…</div>
          ) : phase === 'error' ? (
            <div className="rd-search-empty">Search is not answering right now — try again in a moment.</div>
          ) : (
            <div className="rd-search-empty">No US-listed stock or fund matches &ldquo;{doneFor}&rdquo;. Try the ticker symbol or the company&rsquo;s name.</div>
          )}
        </div>
      )}
    </div>
  );
}
