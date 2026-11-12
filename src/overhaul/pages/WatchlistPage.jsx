/* WatchlistPage — the signed-in user's watchlists (Joe, 2026-11-11).

   His brief: add and remove tickers easily; choose any column from the data
   the site holds, including the Paper Portfolio's (1-yr trend, buybacks…);
   sort by any column; a custom order; reorder and resize every column, with
   a fit-to-contents; "replicate and BEAT the best watchlists on the market".

   What that became, after reading TradingView, Koyfin, thinkorswim and
   Stock Rover side by side:
     · paste many tickers at once; one click removes, with an undo
     · a searchable, grouped column menu over every stored fact
     · click to sort, shift-click to sort within a sort, drag rows for an
       order of your own
     · several lists; named views (a column set and a sort) usable on any list
     · group by industry or by your own tag; a summary line
     · a note, a tag, the close on the day you added it, and the move since
   The table is the site's shared DataTable; nothing here is a second table
   control. Lists, notes and the layout are saved to the sign-in, so they are
   the same on a phone and a laptop.

   Every market figure is read from stock_facts — one stored row per ticker,
   rebuilt after each close. Nothing is computed from price history on load
   (LESSONS 9.28). The old user watchlist retired 2026-06-17 fed a page that
   no longer exists; this is a new page, not that feed. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';
import DataTable from '../components/DataTable';
import FreshnessChip from '../components/FreshnessChip';
import useWatchlists, { useStockFacts, parseTickers, MAX_PER_LIST } from '../lib/useWatchlists';
import { primaryFactor } from '../../v2/lib/paperRisk';
import { PAGE_NAME } from '../chrome/siteNav';
import '../styles/watchlist.css';

const FACTS_ELEMENT = 'equity.stock-facts';
const UNDO_MS = 8000;
const DASH = '—';

/* ---------- formatters ---------- */
const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pct = (v, d = 1) => (n(v) == null ? DASH : `${n(v) > 0 ? '+' : ''}${(n(v) * 100).toFixed(d)}%`);
const pctPlain = (v, d = 1) => (n(v) == null ? DASH : `${(n(v) * 100).toFixed(d)}%`);
const usd = (v) => (n(v) == null ? DASH : `$${n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const big = (v) => {
  const x = n(v);
  if (x == null) return DASH;
  if (x >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
};
const count = (v) => {
  const x = n(v);
  if (x == null) return DASH;
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(0)}K`;
  return String(Math.round(x));
};
const day = (iso, withYear = false) => {
  if (!iso) return DASH;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
const weekday = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const daysUntil = (iso) => {
  if (!iso) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const d = Math.round((Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return d < 0 ? null : d;
};
const sign = (v) => (n(v) == null ? 'muted' : n(v) > 0 ? 'up' : n(v) < 0 ? 'dn' : '');
const titleCase = (s) => (s ? String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null);

/* ---------- small pieces ---------- */
function InlineEdit({ value, placeholder, onSave, maxLength, label }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  useEffect(() => { if (!editing) setText(value || ''); }, [value, editing]);
  if (!editing) {
    return (
      <button type="button" className={`wl-inline${value ? '' : ' empty'}`} onClick={() => setEditing(true)} aria-label={`${label}: ${value || 'add'}`}>
        {value || placeholder}
      </button>
    );
  }
  const done = (save) => { setEditing(false); if (save && text !== (value || '')) onSave(text); };
  return (
    <input
      className="wl-inline-input"
      autoFocus
      value={text}
      maxLength={maxLength}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }}
    />
  );
}

/* Built-in views: a starting set of column arrangements. A saved view of the
   user's own sits beside these in the same menu. */
const PRESETS = [
  { name: 'Overview', show: ['ticker', 'close', 'chg_1d', 'ret_1m', 'ret_ytd', 'pct_from_high', 'market_cap', 'next_earnings', 'next_ex_div', 'since_added', 'tag', 'note'] },
  { name: 'Performance', show: ['ticker', 'close', 'chg_1d', 'ret_1w', 'ret_1m', 'ret_3m', 'ret_ytd', 'ret_1y', 'since_added'] },
  { name: 'Technicals', show: ['ticker', 'close', 'chg_1d', 'pct_from_high', 'pct_from_low', 'pct_vs_ma50', 'pct_vs_ma200', 'vol_vs_avg', 'avg_dollar_vol'] },
  { name: 'Income and positioning', show: ['ticker', 'close', 'next_earnings', 'days_to_earnings', 'div_yield', 'next_ex_div', 'si_pct_float', 'days_to_cover', 'insider_buy_90d', 'insider_buyers_90d'] },
  { name: 'Paper Portfolio factors', show: ['ticker', 'close', 'paper_weight', 'style', 'trend_1y', 'profitability', 'buybacks', 'market_cap', 'industry'] },
];

function buildColumns({ onRemove, onUpdate, paperDate, factorDate }) {
  const f = (key) => (r) => n(r.f?.[key]);
  const num = (key, label, group, tip, render, extra = {}) => ({
    key, label, group, tip, align: 'r', width: 84, sortValue: f(key), render: (r) => render(r.f?.[key], r), ...extra,
  });
  const signed = (key, label, group, tip, extra) => num(key, label, group, tip, (v) => pct(v), { cellClass: (r) => sign(r.f?.[key]), ...extra });
  const paperAsOf = paperDate ? ` As of the ${day(paperDate)} close.` : '';
  const factorAsOf = factorDate ? ` Measured at the ${day(factorDate)} monthly scoring.` : '';
  return [
    { key: 'ticker', label: 'Ticker', group: 'Company', align: 'l', width: 190, maxWidth: 280, noHide: true, sortValue: (r) => r.ticker,
      render: (r) => (
        <Link to={`/ticker/${encodeURIComponent(r.ticker)}`} className="wl-name">
          <b>{r.ticker}</b>
          <span>{r.f?.name || (r.f ? '' : 'no price on file for the latest close')}</span>
        </Link>
      ) },
    num('close', 'Last close', 'Price and returns', 'The closing price on the most recent trading day on file. Not a live price.', (v) => usd(v), { width: 88 }),
    signed('chg_1d', 'Day', 'Price and returns', 'How much the stock moved on the most recent trading day, close to close.', { width: 70 }),
    signed('ret_1w', '1 week', 'Price and returns', 'Price change over the last 5 trading days.', { width: 74, hidden: true }),
    signed('ret_1m', '1 month', 'Price and returns', 'Price change over the last 21 trading days.', { width: 78 }),
    signed('ret_3m', '3 months', 'Price and returns', 'Price change over the last 63 trading days.', { width: 84, hidden: true }),
    signed('ret_ytd', 'YTD', 'Price and returns', 'Price change since the last close of the previous calendar year.', { width: 72 }),
    signed('ret_1y', '1 year', 'Price and returns', 'Price change over the last 252 trading days. Dividends are not included.', { width: 76, hidden: true }),

    signed('pct_from_high', 'From 52-wk high', 'Technicals', 'How far the last close sits below the highest price of the past year. Zero means it closed at the high.', { width: 118 }),
    signed('pct_from_low', 'From 52-wk low', 'Technicals', 'How far the last close sits above the lowest price of the past year.', { width: 114, hidden: true }),
    num('high_52w', '52-wk high', 'Technicals', 'The highest price traded in the past year.', (v) => usd(v), { width: 92, hidden: true }),
    num('low_52w', '52-wk low', 'Technicals', 'The lowest price traded in the past year.', (v) => usd(v), { width: 92, hidden: true }),
    signed('pct_vs_ma50', 'vs 50-day avg', 'Technicals', 'The last close compared with its average close over the past 50 trading days. Above zero, the stock is trading above its short-term trend.', { width: 104, hidden: true }),
    signed('pct_vs_ma200', 'vs 200-day avg', 'Technicals', 'The last close compared with its average close over the past 200 trading days. Above zero, the stock is in a long-term uptrend.', { width: 110, hidden: true }),
    num('vol_vs_avg', 'Volume vs avg', 'Technicals', 'Shares traded on the last trading day divided by the average day over the past three months. 2.0x means twice the usual volume.', (v) => (n(v) == null ? DASH : `${n(v).toFixed(1)}x`), { width: 106, hidden: true, cellClass: (r) => (n(r.f?.vol_vs_avg) >= 2 ? 'warn' : '') }),
    num('volume', 'Volume', 'Technicals', 'Shares traded on the most recent trading day.', (v) => count(v), { width: 82, hidden: true }),
    num('avg_dollar_vol', 'Daily $ volume', 'Technicals', 'Average dollars traded per day over the last three months — how easily the stock can be bought or sold.', (v) => big(v), { width: 108, hidden: true }),

    { key: 'next_earnings', label: 'Next earnings', group: 'Earnings', tip: 'The next date the company is expected to report results, and whether that is before the market opens or after it closes. A date several weeks out is an estimate until the company confirms it.', align: 'r', width: 150,
      sortValue: (r) => (r.f?.next_earnings ? Date.parse(r.f.next_earnings) : null),
      render: (r) => (r.f?.next_earnings ? <>{day(r.f.next_earnings)}{r.f.earnings_time ? <span className="wl-mut"> · {r.f.earnings_time === 'before the open' ? 'pre-open' : 'after close'}</span> : null}</> : DASH) },
    { key: 'days_to_earnings', label: 'Days to earnings', group: 'Earnings', tip: 'Calendar days from today until the next expected earnings report.', align: 'r', width: 124, hidden: true,
      sortValue: (r) => daysUntil(r.f?.next_earnings),
      cellClass: (r) => { const d = daysUntil(r.f?.next_earnings); return d != null && d <= 7 ? 'warn' : ''; },
      render: (r) => { const d = daysUntil(r.f?.next_earnings); return d == null ? DASH : d === 0 ? 'Today' : String(d); } },

    num('market_cap', 'Market cap', 'Company', 'The total market value of the company’s shares: the share count in the listing reference record times the last close shown in this row. Blank for funds and for companies the record does not cover.', (v) => big(v), { width: 96 }),
    { key: 'industry', label: 'Industry', group: 'Company', tip: 'The industry the company reports under in its regulatory filings.', align: 'l', width: 170, hidden: true,
      sortValue: (r) => r.industry || null, render: (r) => r.industry || DASH },

    { key: 'next_ex_div', label: 'Next ex-dividend', group: 'Dividends', tip: 'The next date on which the stock starts trading without its upcoming dividend. Buy before this date to receive it.', align: 'r', width: 122,
      sortValue: (r) => (r.f?.next_ex_div ? Date.parse(r.f.next_ex_div) : null), render: (r) => day(r.f?.next_ex_div) },
    num('div_yield', 'Dividend yield', 'Dividends', 'The latest regular dividend, annualized, as a percentage of the last close.', (v) => pctPlain(v, 2), { width: 108, hidden: true }),

    num('si_pct_float', 'Short interest', 'Short interest', 'The share of the freely traded shares that are sold short, from the exchange settlement reports published twice a month.', (v) => (n(v) == null ? DASH : `${n(v).toFixed(1)}%`), { width: 106, hidden: true }),
    num('days_to_cover', 'Days to cover', 'Short interest', 'How many days of normal trading it would take short sellers to buy back every share they are short.', (v) => (n(v) == null ? DASH : n(v).toFixed(1)), { width: 104, hidden: true }),

    num('insider_buy_90d', 'Insider buying', 'Insiders', 'Dollars of open-market share purchases by the company’s officers, directors and large holders over the last 90 days, from their regulatory filings.', (v) => (n(v) == null ? DASH : big(v)), { width: 108, hidden: true }),
    num('insider_buyers_90d', 'Insider buyers', 'Insiders', 'How many different officers, directors and large holders bought shares on the open market in the last 90 days.', (v) => (n(v) == null ? DASH : String(n(v))), { width: 108, hidden: true }),

    { key: 'paper_weight', label: 'In Paper Portfolio', group: PAGE_NAME.paper, tip: `Whether the paper portfolio holds this stock, and how much of the book it is.${paperAsOf}`, align: 'r', width: 128, hidden: true,
      sortValue: (r) => (r.paper != null ? r.paper : null), render: (r) => (r.paper != null ? pctPlain(r.paper, 1) : <span className="wl-mut">No</span>) },
    { key: 'style', label: 'Style', group: PAGE_NAME.paper, tip: `The style this stock shows most strongly — momentum, quality, buybacks, small size or value — compared with the 500 largest US stocks.${factorAsOf}`, align: 'l', width: 110, hidden: true,
      sortValue: (r) => r.style?.label ?? null, render: (r) => (r.style ? <span className={r.style.key ? '' : 'wl-mut'}>{r.style.label}</span> : DASH) },
    num('trend_1y', '1-yr trend', PAGE_NAME.paper, `How much the stock rose over the past 12 months, skipping the most recent month.${factorAsOf}`, (v) => (n(v) == null ? DASH : `${n(v) > 0 ? '+' : ''}${Math.round(n(v) * 100)}%`), { width: 88, hidden: true }),
    num('profitability', 'Profitability', PAGE_NAME.paper, 'Gross profit divided by total assets, from the company’s latest annual filing — how much profit the business earns on everything it owns.', (v) => (n(v) == null ? DASH : n(v).toFixed(2)), { width: 100, hidden: true }),
    num('buybacks', 'Buybacks', PAGE_NAME.paper, 'How much the share count shrank over the past year. Positive means the company bought back its own stock; negative means it issued more.', (v) => pct(v), { width: 88, hidden: true, cellClass: (r) => (n(r.f?.buybacks) < 0 ? 'dn' : '') }),

    { key: 'added_price', label: 'Price when added', group: 'Your list', tip: 'The closing price on file on the day you added this stock to the list.', align: 'r', width: 124, hidden: true,
      sortValue: (r) => n(r.item.added_price), render: (r) => usd(r.item.added_price) },
    { key: 'since_added', label: 'Since added', group: 'Your list', tip: 'How much the stock has moved from the close on the day you added it to the last close.', align: 'r', width: 98,
      sortValue: (r) => r.since, cellClass: (r) => sign(r.since), render: (r) => pct(r.since) },
    { key: 'added_at', label: 'Date added', group: 'Your list', tip: 'The day you added this stock to the list.', align: 'r', width: 96, hidden: true,
      sortValue: (r) => Date.parse(r.item.added_at), render: (r) => day(r.item.added_at, true) },
    { key: 'tag', label: 'Tag', group: 'Your list', tip: 'Your own label for this stock. Group the list by tag to gather stocks that share one.', align: 'l', width: 110,
      sortValue: (r) => r.item.tag || null,
      render: (r) => <InlineEdit value={r.item.tag} placeholder="Add tag" label={`Tag for ${r.ticker}`} maxLength={40} onSave={(v) => onUpdate(r.item.id, { tag: v })} /> },
    { key: 'note', label: 'Note', group: 'Your list', tip: 'Your own note on this stock.', align: 'l', width: 200,
      sortValue: (r) => r.item.note || null,
      render: (r) => <InlineEdit value={r.item.note} placeholder="Add note" label={`Note for ${r.ticker}`} maxLength={500} onSave={(v) => onUpdate(r.item.id, { note: v })} /> },
    { key: 'remove', label: '', menuLabel: 'Remove button', group: 'Your list', align: 'r', width: 44, minWidth: 44, noHide: true, sortValue: () => null,
      render: (r) => <button type="button" className="wl-x" aria-label={`Remove ${r.ticker} from this list`} onClick={() => onRemove(r.item)}>×</button> },
  ];
}

/* ---------- add box: type or paste; one symbol gets suggestions ---------- */
function AddBox({ onAdd, busy }) {
  const [text, setText] = useState('');
  const [sugg, setSugg] = useState([]);
  const reqId = useRef(0);
  const single = parseTickers(text).length <= 1 && !/[\s,;]/.test(text.trim());
  useEffect(() => {
    const term = text.trim().replace(/[%,()]/g, '');
    if (!term || !single) { setSugg([]); return undefined; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('ticker_reference').select('ticker,name,market_cap')
        .or(`ticker.ilike.${term}%,name.ilike.%${term}%`).order('market_cap', { ascending: false, nullsFirst: false }).limit(6);
      if (id === reqId.current) setSugg(data || []);
    }, 180);
    return () => clearTimeout(t);
  }, [text, single]);
  const submit = (value) => { const v = value ?? text; if (!v.trim()) return; setText(''); setSugg([]); onAdd(v); };
  return (
    <form className="wl-add" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input
        className="wl-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add tickers — type one, or paste many (AAPL, MSFT, NVDA)"
        aria-label="Add tickers to this list"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="wl-btn wl-btn--go" disabled={busy || !text.trim()}>Add</button>
      {sugg.length > 0 && (
        <ul className="wl-sugg" role="listbox">
          {sugg.map((s) => (
            <li key={s.ticker}>
              <button type="button" onClick={() => submit(s.ticker)}><b>{s.ticker}</b><span>{s.name}</span></button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function Lists({ wl, activeId, onPick }) {
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setConfirmDel(false); setRenaming(null); }, [activeId]);
  const counts = useMemo(() => {
    const c = {}; wl.items.forEach((i) => { c[i.watchlist_id] = (c[i.watchlist_id] || 0) + 1; }); return c;
  }, [wl.items]);
  return (
    <div className="wl-lists">
      <div className="wl-tabs" role="tablist" aria-label="Your watchlists">
        {wl.lists.map((l) => (renaming === l.id ? (
          <input key={l.id} className="wl-tab-input" autoFocus value={name} maxLength={60} aria-label="List name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { wl.renameList(l.id, name); setRenaming(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
        ) : (
          <button key={l.id} type="button" role="tab" aria-selected={l.id === activeId}
            className={`wl-tab${l.id === activeId ? ' on' : ''}`} onClick={() => onPick(l.id)}>
            {l.name}<span className="wl-tab-n">{counts[l.id] || 0}</span>
          </button>
        )))}
        {adding ? (
          <input className="wl-tab-input" autoFocus value={name} maxLength={60} placeholder="Name the new list" aria-label="New list name"
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => { setAdding(false); const made = await wl.createList(name); if (made) onPick(made.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(''); setAdding(false); } }} />
        ) : (
          <button type="button" className="wl-tab wl-tab--new" onClick={() => { setName(''); setAdding(true); }}>+ New list</button>
        )}
      </div>
      <div className="wl-listacts">
        <button type="button" className="wl-link" onClick={() => { const l = wl.lists.find((x) => x.id === activeId); setName(l?.name || ''); setRenaming(activeId); }}>Rename</button>
        {wl.lists.length > 1 && (confirmDel ? (
          <>
            <button type="button" className="wl-link wl-link--dn" onClick={() => { wl.deleteList(activeId); setConfirmDel(false); }}>Delete this list and its notes</button>
            <button type="button" className="wl-link" onClick={() => setConfirmDel(false)}>Keep it</button>
          </>
        ) : <button type="button" className="wl-link" onClick={() => setConfirmDel(true)}>Delete</button>)}
      </div>
    </div>
  );
}

function Views({ views, onApplyPreset, onApplyView, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="wl-views" ref={ref}>
      <button type="button" className="wl-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Views</button>
      {open && (
        <div className="wl-pop" role="menu">
          <div className="wl-pop-h">Ready-made</div>
          {PRESETS.map((p) => <button key={p.name} type="button" className="wl-pop-row" onClick={() => { onApplyPreset(p); setOpen(false); }}>{p.name}</button>)}
          <div className="wl-pop-h">Yours</div>
          {views.length === 0 && <div className="wl-pop-none">None saved yet.</div>}
          {views.map((v) => (
            <div key={v.name} className="wl-pop-pair">
              <button type="button" className="wl-pop-row" onClick={() => { onApplyView(v); setOpen(false); }}>{v.name}</button>
              <button type="button" className="wl-x" aria-label={`Delete the view ${v.name}`} onClick={() => onDelete(v.name)}>×</button>
            </div>
          ))}
          <form className="wl-pop-save" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); setOpen(false); } }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name this layout" aria-label="Name for the current layout" />
            <button type="submit" className="wl-btn wl-btn--go" disabled={!name.trim()}>Save</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function WatchlistPage() {
  const { user } = useSession();
  const wl = useWatchlists(user?.id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);

  const activeId = wl.lists.some((l) => l.id === wl.settings.active) ? wl.settings.active : wl.lists[0]?.id;
  const active = wl.lists.find((l) => l.id === activeId) || null;
  const mine = useMemo(() => wl.items.filter((i) => i.watchlist_id === activeId), [wl.items, activeId]);
  const tickers = useMemo(() => mine.map((i) => i.ticker), [mine]);
  const { facts, paper, priceDate, paperDate, loading: factsLoading, error: factsError } = useStockFacts(tickers);

  const rows = useMemo(() => mine.map((item) => {
    const f = facts[item.ticker] || null;
    const z = f ? { momentum: f.z_momentum, quality: f.z_quality, buybacks: f.z_buybacks, size: f.z_size, value: f.z_value } : null;
    const hasZ = z && Object.values(z).some((v) => v != null);
    const since = f && n(item.added_price) > 0 && n(f.close) != null ? n(f.close) / n(item.added_price) - 1 : null;
    return {
      id: item.id, ticker: item.ticker, item, f,
      industry: titleCase(f?.industry),
      paper: paper[item.ticker] ?? null,
      style: hasZ ? primaryFactor(z) : null,
      since,
    };
  }), [mine, facts, paper]);

  const factorDate = useMemo(() => Object.values(facts).map((f) => f.factor_date).filter(Boolean).sort().pop() || null, [facts]);

  const remove = (item) => {
    wl.removeItem(item);
    clearTimeout(undoTimer.current);
    setUndo(item);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const columns = useMemo(
    () => buildColumns({ onRemove: remove, onUpdate: wl.updateItem, paperDate, factorDate }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wl.updateItem, wl.removeItem, paperDate, factorDate],
  );

  const add = async (text) => {
    if (!activeId) return;
    setBusy(true);
    const r = await wl.addTickers(activeId, text);
    setBusy(false);
    const parts = [];
    if (r.added.length) parts.push(`Added ${r.added.join(', ')}.`);
    if (r.already.length) parts.push(`Already on this list: ${r.already.join(', ')}.`);
    if (r.unknown.length) parts.push(`Not a US-listed symbol we carry: ${r.unknown.join(', ')}.`);
    if (r.full) parts.push(`A list holds ${MAX_PER_LIST} stocks; the rest were not added.`);
    if (!parts.length) parts.push('Nothing to add — enter one or more ticker symbols.');
    setNotice({ text: parts.join(' '), bad: !r.added.length });
  };

  const groupMode = wl.settings.groupBy || 'none';
  const groupBy = useMemo(() => {
    if (groupMode === 'industry') return { value: (r) => r.industry, emptyLabel: 'No industry on file' };
    if (groupMode === 'tag') return { value: (r) => r.item.tag, emptyLabel: 'No tag' };
    return null;
  }, [groupMode]);

  const applyPreset = (p) => {
    const show = new Set(p.show);
    const keys = columns.map((c) => c.key);
    wl.setSettings((prev) => ({
      ...prev,
      layout: {
        order: [...p.show.filter((k) => keys.includes(k)), ...keys.filter((k) => !show.has(k) && k !== 'remove'), 'remove'].filter((k, i, a) => a.indexOf(k) === i),
        widths: prev.layout?.widths || {},
        hidden: keys.filter((k) => !show.has(k) && k !== 'remove' && k !== 'ticker'),
        sort: [],
      },
    }));
  };
  const views = wl.settings.views || [];

  const summary = useMemo(() => {
    if (!rows.length) return [];
    const avg = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const dayAvg = avg(rows.map((r) => n(r.f?.chg_1d)));
    const sinceAvg = avg(rows.map((r) => r.since));
    return [
      { label: `Average day move across ${rows.length} ${rows.length === 1 ? 'stock' : 'stocks'}`, at: 'chg_1d', value: pct(dayAvg), valueClass: sign(dayAvg) },
      { label: 'Average move since added', at: 'since_added', value: pct(sinceAvg), valueClass: sign(sinceAvg) },
    ];
  }, [rows]);

  if (wl.loading) return <div className="tm-main wl-page"><div className="tm-loading">Loading your watchlists…</div></div>;

  return (
    <div className="tm-main wl-page">
      <section className="tm-panel wl-panel">
        <div className="tm-phead">
          <span className="tm-code">WL</span>
          <span className="tm-ptitle">{PAGE_NAME.watchlist}</span>
          <span className="wl-asof">
            {priceDate ? `Prices are the ${weekday(priceDate)} close` : 'Prices are the last close on file'}
            <FreshnessChip elementId={FACTS_ELEMENT} variant="dot" />
          </span>
        </div>

        <div className="wl-body">
          <Lists wl={wl} activeId={activeId} onPick={(id) => wl.setSettings({ active: id })} />

          <div className="wl-bar">
            <AddBox onAdd={add} busy={busy} />
            <label className="wl-group">
              <span>Group by</span>
              <select value={groupMode} onChange={(e) => wl.setSettings({ groupBy: e.target.value })}>
                <option value="none">Nothing</option>
                <option value="industry">Industry</option>
                <option value="tag">Your tag</option>
              </select>
            </label>
            <Views
              views={views}
              onApplyPreset={applyPreset}
              onApplyView={(v) => wl.setSettings((prev) => ({ ...prev, layout: v.layout }))}
              onSave={(name) => wl.setSettings((prev) => ({ ...prev, views: [...(prev.views || []).filter((v) => v.name !== name), { name, layout: prev.layout || null }] }))}
              onDelete={(name) => wl.setSettings((prev) => ({ ...prev, views: (prev.views || []).filter((v) => v.name !== name) }))}
            />
          </div>

          {(notice || wl.error || factsError) && (
            <div className={`wl-note${(notice?.bad || wl.error || factsError) ? ' bad' : ''}`} role="status">
              <span>{wl.error || factsError || notice.text}</span>
              <button type="button" className="wl-x" aria-label="Dismiss this message" onClick={() => { setNotice(null); wl.clearError(); }}>×</button>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="wl-empty">
              <p><b>{active?.name || 'This list'} is empty.</b></p>
              <p>Type a ticker in the box above, or paste a whole list of them at once. Each stock is saved with the closing price on the day you add it, so the list shows how it has done since.</p>
            </div>
          ) : (
            <DataTable
              id="watchlist"
              className={`wl-table${factsLoading ? ' loading' : ''}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              layout={wl.settings.layout || null}
              onLayoutChange={(layout) => wl.setSettings({ layout })}
              onRowReorder={(from, to) => wl.moveItem(activeId, from, to)}
              groupBy={groupBy}
              summary={summary}
              toolbarLeft={<span className="wl-hint">Click a heading to sort; hold Shift and click another to sort within it. Drag a heading to move a column, drag its right edge to resize, double-click the edge to fit.</span>}
            />
          )}
        </div>
      </section>

      {undo && (
        <div className="wl-undo" role="status">
          <span>Removed {undo.ticker}.</span>
          <button type="button" className="wl-btn wl-btn--go" onClick={() => { wl.restoreItem(undo); setUndo(null); }}>Undo</button>
        </div>
      )}
    </div>
  );
}
