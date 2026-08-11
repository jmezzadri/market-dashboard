// useCeEvents — shared read layer for the Conviction Events strategy tables
// (strategy reset 2026-08: one book replaces the retired paper strategies).
//
// ONE fetch/shape family feeds every surface that shows these concepts — the
// Paper page's event ledger, positions "why" cells and kill-switch line, and
// the Scanner page's Conviction Events panel — so two surfaces can never
// disagree on the same event (LESSONS 2026-06-12b: one shared computation).
//
// Data contract (engine in build — code against it exactly):
//   ce_events (anon-readable): filing_date, ticker, total_usd, insider_names,
//     n_insiders, is_edgar_sourced, passed_gates, gate_fail_reason,
//     above_sma50, action in ('entered','skipped_full','skipped_gate',
//     'skipped_dup'), entered_at, entry_qty,
//     entry_price, exit_due_date, exited_at, exit_price, trade_return.
//     ('blocked_kill_switch' still passes the table's check constraint but the
//     engine stopped writing it on 2026-08-11 — the kill switch is a monitor.)
//   ce_kill_switch (single row): tripped, tripped_at, reason, book_return,
//     spy_return, max_drawdown, checked_at.
//
// Degrade contract: these tables will not exist until the engine cutover, so
// EVERY read failure resolves to the empty shape ({ rows: [] } / { row: null })
// with loading=false — consumers render their "awaiting first events" empty
// state, never an error panel. A console.warn keeps the failure visible to
// developers without surfacing dev-speak to readers.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Action → plain-English chip. tone drives the chip color class only:
// 'up' = the engine traded, 'mut' = a quiet skip.
// DB enum values never render raw (plain-English rule).
//
// 'skipped_full' no longer means "the book held its 8 names" — as of the
// 2026-08-11 engine change there is no fixed position count; it means the cash
// could not fund a full 10%-of-equity position, or the 13-position safety
// ceiling was already reached. 'blocked_kill_switch' is gone with the entry
// freeze the same change deleted — the kill switch alerts, it never blocks a
// trade, so the engine can no longer write that action.
export const CE_ACTIONS = {
  entered: { label: 'Entered', tone: 'up' },
  skipped_full: { label: 'Skipped — not enough cash', tone: 'mut' },
  skipped_gate: { label: 'Failed gates', tone: 'mut' },
  skipped_dup: { label: 'Skipped — already held', tone: 'mut' },
};
export const ceActionMeta = (action) =>
  CE_ACTIONS[action] || { label: String(action || '—').replace(/_/g, ' '), tone: 'mut' };

// gate_fail_reason arrives as engine text. Display it with any raw enum
// residue softened (underscores → spaces); never invent a reason.
export const ceReasonText = (r) => {
  const s = String(r || '').trim();
  return s ? s.replace(/_/g, ' ') : null;
};

// insider_names may land as an array, a "; "-joined string, or a single name.
// Returns a clean array of names (may be empty — the count column always
// renders n_insiders, which is the stored number).
export function ceInsiderNames(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.includes(';')) return s.split(';').map((x) => x.trim()).filter(Boolean);
  return [s];
}

// "Insider Jane Smith bought $412,367 on Aug 4, 2026" — the positions table's
// WHY cell. Verbatim shape from the strategy spec; plural lists the first
// name and counts the rest (full list belongs in the tooltip).
export function ceWhyText(ev, fmtMoney, fmtDate) {
  if (!ev) return null;
  const names = ceInsiderNames(ev.insider_names);
  const n = Number(ev.n_insiders) || names.length || 0;
  const first = names[0] || null;
  const who = n > 1
    ? `Insiders ${first ? `${first} and ${n - 1} more` : `(${n})`}`
    : `Insider ${first || ''}`.trim();
  return `${who} bought ${fmtMoney(Number(ev.total_usd))} on ${fmtDate(ev.filing_date)}`;
}

// Recent decision ledger, newest filing first. Empty on any failure.
export function useCeEvents(limit = 60) {
  const [state, setState] = useState({ rows: [], loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('ce_events')
          .select('filing_date, ticker, total_usd, insider_names, n_insiders, is_edgar_sourced, passed_gates, gate_fail_reason, above_sma50, action, entered_at, entry_qty, entry_price, exit_due_date, exited_at, exit_price, trade_return')
          .order('filing_date', { ascending: false })
          .limit(limit);
        if (!alive) return;
        if (error || !data) {
          // eslint-disable-next-line no-console
          if (error) console.warn('[ce_events] read failed:', error.message);
          setState({ rows: [], loading: false });
          return;
        }
        setState({ rows: data, loading: false });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ce_events] read failed:', e?.message || e);
        if (alive) setState({ rows: [], loading: false });
      }
    })();
    return () => { alive = false; };
  }, [limit]);
  return state;
}

// Open entered trades (entered, not yet exited), keyed by ticker — feeds the
// positions table's WHY cell and "exit due" column. A book holds at most 8.
export function useCeOpenEntries() {
  const [state, setState] = useState({ byTicker: {}, loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('ce_events')
          .select('filing_date, ticker, total_usd, insider_names, n_insiders, entered_at, entry_price, exit_due_date, exited_at')
          .eq('action', 'entered')
          .is('exited_at', null)
          .order('entered_at', { ascending: false })
          .limit(16);
        if (!alive) return;
        if (error || !data) {
          // eslint-disable-next-line no-console
          if (error) console.warn('[ce_events open] read failed:', error.message);
          setState({ byTicker: {}, loading: false });
          return;
        }
        const byTicker = {};
        for (const r of data) {
          // newest entry wins if a ticker somehow repeats
          if (!byTicker[r.ticker]) byTicker[r.ticker] = r;
        }
        setState({ byTicker, loading: false });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ce_events open] read failed:', e?.message || e);
        if (alive) setState({ byTicker: {}, loading: false });
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}

// The kill-switch row (single row). row === null → no reading yet.
export function useCeKillSwitch() {
  const [state, setState] = useState({ row: null, loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('ce_kill_switch')
          .select('tripped, tripped_at, reason, book_return, spy_return, max_drawdown, checked_at')
          .limit(1);
        if (!alive) return;
        if (error || !data) {
          // eslint-disable-next-line no-console
          if (error) console.warn('[ce_kill_switch] read failed:', error.message);
          setState({ row: null, loading: false });
          return;
        }
        setState({ row: data[0] || null, loading: false });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ce_kill_switch] read failed:', e?.message || e);
        if (alive) setState({ row: null, loading: false });
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}
