/* ConvictionEventsPanel — the Conviction Events desk view on the Scanner
   page (strategy reset 2026-08: replaces the retired insider-score scanner
   panel). Renders on the EXACT tile anatomy the other desk panels use —
   .sc-tablecard shell, .sc-kicker / .sc-paneltitle / .sc-rule header,
   .sc-scanmeta chip line (dot chip first, same spot), and the shared
   .sc-inset / .sc-insetscroll / .sc-table surface (row hover, 16px gold
   tickers, green/red numerics) — LESSONS 8.12: component-level parity.

   Data: ce_events via the shared useCeEvents hook — the SAME read the Paper
   page's event ledger uses, so the two surfaces can never disagree on an
   event (LESSONS 2026-06-12b). Every action renders as a plain-English chip;
   a gate failure carries its reason on hover (instant CSS tooltip, never the
   native title attribute — LESSONS 6.13).

   Degrade: ce_events will not resolve until the engine cutover — the read
   fails quietly and the panel renders its awaiting-first-events state, never
   an error. */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from './FreshnessChip';
import {
  useCeEvents,
  ceActionMeta,
  ceReasonText,
  ceInsiderNames,
} from '../../hooks/useCeEvents';

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '—';
};
const fmtUsd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
};

export default function ConvictionEventsPanel() {
  const { rows, loading } = useCeEvents(60);
  const navigate = useNavigate();
  const latest = rows.length ? rows[0].filing_date : null;

  const chip = (r) => {
    const meta = ceActionMeta(r.action);
    const reason = r.action === 'skipped_gate' ? ceReasonText(r.gate_fail_reason) : null;
    const tip = reason
      || (r.action === 'skipped_full' ? 'The book did not have the cash for a full position when this event qualified (or was already at its 13-position ceiling).' : null)
      || (r.action === 'skipped_dup' ? 'The book already held this name.' : null);
    const el = <span className={`ce-chip ${meta.tone}`}>{meta.label}</span>;
    return tip ? <span className="ce-tip" data-tip={tip}>{el}</span> : el;
  };

  return (
    <section className="wrap ce-sec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-kicker">Book feed · Daily events</div>
            <h2 className="sc-paneltitle">Conviction Events</h2>
            <div className="sc-rule">
              The feed the Paper book trades: large real insider purchases — aggregated open-market
              buys of $250,000 or more per name per day, automatic (10b5-1) plan purchases
              excluded — confirmed by the stock trading above its 50-day average.
            </div>
            <div className="sc-rule">
              A qualifying event is bought at the next morning&rsquo;s open, sized at 10% of the
              book&rsquo;s equity, and exits at the open of the 21st trading day — or sooner, at
              the next open, if it closes 15% or more below the price it was bought at. Each row
              below carries the action the engine took — hover a chip for the reason.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="portfolio.ce-events-daily"
                variant="dot"
                fallback={{ asOfIso: latest, calendar: 'nyse-trading-day' }}
              />
              <span>{latest ? `Latest event · ${fmtDay(latest)}` : 'Awaiting first events'}</span>
              <button type="button" className="sc-metalink" onClick={() => navigate('/methodology#scanner')}>
                Methodology →
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="sc-loading">Loading events…</div>
        ) : rows.length === 0 ? (
          <div className="sc-loading">
            Awaiting first events — qualifying insider purchases appear here as the engine records
            them, with the action it took on each.
          </div>
        ) : (
          <div className="sc-inset">
            <div className="sc-insetscroll">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Filed</th>
                    <th>Ticker</th>
                    <th className="num-h">Buy total</th>
                    <th className="num-h">Insiders</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const names = ceInsiderNames(r.insider_names);
                    const n = r.n_insiders != null ? Number(r.n_insiders) : (names.length || null);
                    return (
                      <tr key={`${r.ticker}-${r.filing_date}-${i}`} className="sc-trow" onClick={() => navigate(`/ticker/${r.ticker}`)}>
                        <td className="num">{fmtDay(r.filing_date)}</td>
                        <td>
                          <button type="button" className="sc-tk" onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}>
                            <b>{r.ticker}</b>
                          </button>
                        </td>
                        <td className="num">{fmtUsd(r.total_usd)}</td>
                        <td className="num">
                          {n == null ? '—'
                            : names.length
                              ? <span className="ce-tip" data-tip={names.join(' · ')}>{n}</span>
                              : n}
                        </td>
                        <td>{chip(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
