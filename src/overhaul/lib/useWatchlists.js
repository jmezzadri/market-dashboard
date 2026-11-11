/* useWatchlists — the signed-in user's watchlists (Joe, 2026-11-11).

   Everything here is the user's own data, kept against their sign-in so it
   follows them from laptop to phone: the lists, the tickers in each (with
   the close on the day each was added, a note and a tag), the manual row
   order, and one settings record (table layout, saved views, grouping,
   which list was open). Row-level security scopes every read and write to
   auth.uid(); nothing here can see another user's rows.

   Market facts are NOT computed here. They are read from stock_facts, one
   stored row per ticker, rebuilt after each close (LESSONS 9.28). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

const DEFAULT_LIST = 'My watchlist';
export const MAX_PER_LIST = 200;
const SAVE_DELAY_MS = 700;

export const parseTickers = (text) => [...new Set(
  String(text || '').toUpperCase().split(/[\s,;]+/).map((t) => t.replace(/^\$/, '').trim())
    .filter((t) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(t)),
)];

export default function useWatchlists(userId) {
  const [lists, setLists] = useState([]);
  const [items, setItems] = useState([]);
  const [settings, setSettingsState] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const saveTimer = useRef(null);
  const latestSettings = useRef({});

  useEffect(() => {
    if (!userId) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [l, it, st] = await Promise.all([
        supabase.from('watchlists').select('id,name,position,created_at').order('position').order('created_at'),
        supabase.from('watchlist_items').select('id,watchlist_id,ticker,position,added_at,added_price,added_price_date,note,tag').order('position').order('added_at'),
        supabase.from('watchlist_settings').select('settings').maybeSingle(),
      ]);
      if (cancelled) return;
      const err = l.error || it.error || st.error;
      if (err) { setError(err.message || 'Could not load your watchlists.'); setLoading(false); return; }
      let ls = l.data || [];
      if (!ls.length) {
        const made = await supabase.from('watchlists').insert({ name: DEFAULT_LIST, position: 0 }).select('id,name,position,created_at').single();
        if (cancelled) return;
        if (made.error) { setError(made.error.message); setLoading(false); return; }
        ls = [made.data];
      }
      setLists(ls);
      setItems(it.data || []);
      latestSettings.current = st.data?.settings || {};
      setSettingsState(latestSettings.current);
      setError(null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Settings are written a moment after the last change, so dragging a column
  // edge is one write, not fifty.
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!userId) return;
    supabase.from('watchlist_settings')
      .upsert({ user_id: userId, settings: latestSettings.current, updated_at: new Date().toISOString() })
      .then(({ error: e }) => { if (e) setError('Your layout could not be saved. It will be kept on this device until the next change.'); });
  }, [userId]);
  const setSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      latestSettings.current = next;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
      return next;
    });
  }, [flush]);
  useEffect(() => () => { if (saveTimer.current) flush(); }, [flush]);

  const createList = useCallback(async (name) => {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return null;
    const position = lists.reduce((m, x) => Math.max(m, x.position), -1) + 1;
    const { data, error: e } = await supabase.from('watchlists').insert({ name: clean, position }).select('id,name,position,created_at').single();
    if (e) { setError(e.message); return null; }
    setLists((p) => [...p, data]);
    return data;
  }, [lists]);

  const renameList = useCallback(async (id, name) => {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return;
    setLists((p) => p.map((x) => (x.id === id ? { ...x, name: clean } : x)));
    const { error: e } = await supabase.from('watchlists').update({ name: clean }).eq('id', id);
    if (e) setError(e.message);
  }, []);

  const deleteList = useCallback(async (id) => {
    const { error: e } = await supabase.from('watchlists').delete().eq('id', id);
    if (e) { setError(e.message); return; }
    setLists((p) => p.filter((x) => x.id !== id));
    setItems((p) => p.filter((x) => x.watchlist_id !== id));
  }, []);

  /* Add many tickers at once. Each symbol is checked against the stored
     facts (which also gives the close it is added at) and, failing that,
     against the listed-securities master, so a typo is reported back rather
     than saved. Returns { added, already, unknown, full }. */
  const addTickers = useCallback(async (listId, text) => {
    const wanted = parseTickers(text);
    const mine = items.filter((x) => x.watchlist_id === listId);
    const have = new Set(mine.map((x) => x.ticker));
    const already = wanted.filter((t) => have.has(t));
    const fresh = wanted.filter((t) => !have.has(t));
    if (!fresh.length) return { added: [], already, unknown: [], full: false };
    const [facts, master] = await Promise.all([
      supabase.from('stock_facts').select('ticker,close,price_date').in('ticker', fresh),
      supabase.from('universe_master').select('ticker').in('ticker', fresh),
    ]);
    if (facts.error && master.error) { setError('Could not check those symbols. Nothing was added.'); return { added: [], already, unknown: [], full: false }; }
    const fact = Object.fromEntries((facts.data || []).map((r) => [r.ticker, r]));
    const known = new Set([...(master.data || []).map((r) => r.ticker), ...Object.keys(fact)]);
    const unknown = fresh.filter((t) => !known.has(t));
    const room = Math.max(0, MAX_PER_LIST - mine.length);
    const ok = fresh.filter((t) => known.has(t)).slice(0, room);
    const full = fresh.filter((t) => known.has(t)).length > ok.length;
    if (!ok.length) return { added: [], already, unknown, full };
    let position = mine.reduce((m, x) => Math.max(m, x.position), -1);
    const rows = ok.map((t) => {
      position += 1;
      return { watchlist_id: listId, ticker: t, position, added_price: fact[t]?.close ?? null, added_price_date: fact[t]?.price_date ?? null };
    });
    const { data, error: e } = await supabase.from('watchlist_items').insert(rows)
      .select('id,watchlist_id,ticker,position,added_at,added_price,added_price_date,note,tag');
    if (e) { setError(e.message); return { added: [], already, unknown, full }; }
    setItems((p) => [...p, ...(data || [])]);
    return { added: ok, already, unknown, full };
  }, [items]);

  // A removal still on its way to the database is remembered, so an Undo
  // clicked straight away waits for it instead of racing it.
  const pendingRemovals = useRef({});
  const removeItem = useCallback(async (item) => {
    setItems((p) => p.filter((x) => x.id !== item.id));
    const work = supabase.from('watchlist_items').delete().eq('id', item.id).then(({ error: e }) => {
      delete pendingRemovals.current[item.id];
      if (e) { setError(e.message); setItems((p) => [...p, item]); return false; }
      return true;
    });
    pendingRemovals.current[item.id] = work;
    return work;
  }, []);

  // Undo puts back the very row that was removed — same date added, same
  // price when added, same note and tag.
  const restoreItem = useCallback(async (item) => {
    const pending = pendingRemovals.current[item.id];
    if (pending && !(await pending)) return;   // the removal failed, the row is still there
    const { data, error: e } = await supabase.from('watchlist_items').insert(item)
      .select('id,watchlist_id,ticker,position,added_at,added_price,added_price_date,note,tag').single();
    if (e) { setError(e.message); return; }
    setItems((p) => [...p.filter((x) => x.id !== data.id), data].sort((x, y) => x.position - y.position));
  }, []);

  const updateItem = useCallback(async (id, patch) => {
    const clean = {};
    if ('note' in patch) clean.note = String(patch.note || '').trim().slice(0, 500) || null;
    if ('tag' in patch) clean.tag = String(patch.tag || '').trim().slice(0, 40) || null;
    setItems((p) => p.map((x) => (x.id === id ? { ...x, ...clean } : x)));
    const { error: e } = await supabase.from('watchlist_items').update(clean).eq('id', id);
    if (e) setError(e.message);
  }, []);

  // Manual order: move one row to sit where another is, then renumber.
  const moveItem = useCallback(async (listId, fromId, toId) => {
    const mine = items.filter((x) => x.watchlist_id === listId).sort((a, b) => a.position - b.position);
    const from = mine.findIndex((x) => x.id === fromId);
    const to = mine.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = mine.splice(from, 1);
    mine.splice(to, 0, moved);
    const changed = [];
    mine.forEach((x, i) => { if (x.position !== i) changed.push({ id: x.id, position: i }); });
    const pos = Object.fromEntries(mine.map((x, i) => [x.id, i]));
    setItems((p) => p.map((x) => (x.id in pos ? { ...x, position: pos[x.id] } : x)).sort((a, b) => a.position - b.position));
    const results = await Promise.all(changed.map((c) => supabase.from('watchlist_items').update({ position: c.position }).eq('id', c.id)));
    const bad = results.find((r) => r.error);
    if (bad) setError(bad.error.message);
  }, [items]);

  return useMemo(() => ({
    loading, error, clearError: () => setError(null),
    lists, items, settings, setSettings,
    createList, renameList, deleteList,
    addTickers, removeItem, restoreItem, updateItem, moveItem,
  }), [loading, error, lists, items, settings, setSettings, createList, renameList, deleteList, addTickers, removeItem, restoreItem, updateItem, moveItem]);
}

/* The stored facts for a set of tickers, plus the paper book's latest
   holdings (weight = market value / equity, the same division the Paper
   Portfolio ledger makes from the same record). */
export function useStockFacts(tickers) {
  const key = [...tickers].sort().join(',');
  const [state, setState] = useState({ facts: {}, paper: {}, priceDate: null, paperDate: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = key ? key.split(',') : [];
      const [f, nav] = await Promise.all([
        list.length ? supabase.from('stock_facts').select('*').in('ticker', list) : Promise.resolve({ data: [] }),
        supabase.from('qt_nav_daily').select('d,equity,positions').order('d', { ascending: false }).order('created_at', { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      const facts = Object.fromEntries((f.data || []).map((r) => [r.ticker, r]));
      const row = (nav.data || [])[0];
      const paper = {};
      const equity = row ? Number(row.equity) : null;
      if (row && equity > 0) {
        (row.positions || []).forEach((p) => { if (Number(p.qty) > 0 && p.mv != null) paper[p.symbol] = Number(p.mv) / equity; });
      }
      const dates = (f.data || []).map((r) => r.price_date).filter(Boolean).sort();
      setState({
        facts, paper,
        priceDate: dates.length ? dates[dates.length - 1] : null,
        paperDate: row ? String(row.d).slice(0, 10) : null,
        loading: false,
        error: f.error ? 'Market facts could not be loaded.' : null,
      });
    })();
    return () => { cancelled = true; };
  }, [key]);
  return state;
}
