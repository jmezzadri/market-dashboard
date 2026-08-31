/* TradeIdeaNote — the full Trade Idea reader, in ONE place.

   Joe, 2026-08-17, looking at the scorecard: *"I can't see what your call was
   on 8/14 — 'The most one-sided trade in the market is not on any chart'? What
   was our call? You need a way to resurface the analysis and the call."*

   He is right, and the fix is not to paraphrase the note on the scorecard. A
   title is a hook, and a mark is an outcome; neither is the call. What the
   reader needs is the note itself — the claim, what was bought and sold, the
   horizon, the measured edge, the charts, and what would have killed it.

   So this component was lifted verbatim out of HomePage, where it had been the
   Home tile's modal, and is now imported by BOTH surfaces. That is the point of
   extracting it rather than writing a second, shorter version for the
   scorecard: a note that reads one way where it is published and another way
   where it is graded is exactly how a record stops being a record. One
   renderer, one text, whichever page you arrive from.

   Consumers supply `chartSeries` (the resolved series map from
   useIndicatorSeries) so the charts draw from the same data the evidence block
   cites and cannot disagree with it. */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import IdeaChart from './IdeaChart';

/* 2026-08-24 (Joe, on the tile): "NO IDEA WHAT THESE FUCKING PILLS AT THE TOP
   MEAN." Every label a reader sees must be a phrase a non-trader parses on
   sight. The category names what MARKET the idea lives in; the position label
   answers "am I being asked to short anything?" in plain words. The edge-source
   pill (e.g. "volatility structure") is methodology, not orientation — it is
   gone from the tile and lives inside the note under "The edge". */
export const KIND_LABEL = {
  macro: 'Big picture', 'cross-asset': 'Across markets', 'single-name': 'One stock',
  rates: 'Bonds', credit: 'Credit', fx: 'Currencies', commodity: 'Commodities', equity: 'Stocks',
};

export const POSITION_LABEL = {
  'allocation shift': 'A switch, nothing shorted',
  'outright long': 'Buy and hold',
  'outright short': 'A short',
  'long/short spread': 'Long one, short the other',
  hedge: 'Protection',
};

/* What the position IS, in one hover. The badge answers "am I shorting
   anything?" before the reader meets a single number — Joe, 2026-08-13. */
export const POSITION_NOTE = {
  'allocation shift': 'Move money from one asset to another. Nothing sold short, no leverage.',
  'outright long': 'Buy and hold it. Nothing sold short.',
  'outright short': 'A short position — sold with the intention of buying it back lower.',
  'long/short spread': 'Long one thing and short the other, sized against each other.',
  hedge: 'Protection bought against something already owned.',
  'watch only': 'Not a position yet — the setup to watch and what would make it one.',
};

export function Html({ html, tag = 'span', className }) {
  const T = tag;
  return <T className={className} dangerouslySetInnerHTML={{ __html: html || '' }} />;
}

export function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/* The note body without the modal chrome — so a page can render it inline if
   it ever wants to. The modal below is the usual entry point. */
export function TradeIdeaNoteBody({ idea, chartSeries }) {
  if (!idea) return null;
  return (
    <div className="briefmodal-body">
      {idea.call && <p className="idea-modal-call">{idea.call}</p>}
      {/* Prose figures are point-in-time; charts are live (Joe, 2026-08-31). */}
      {idea.date && (
        <p className="idea-asof">Figures in this note are from {longDate(idea.date)}, the day it was published. The charts draw live data.</p>
      )}
      {idea.position_type && (
        <p className="idea-modal-pos">
          <span className="idea-pos">{POSITION_LABEL[idea.position_type] || idea.position_type}</span>
          <span>{POSITION_NOTE[idea.position_type]}</span>
        </p>
      )}
      {idea.dek && <p className="idea-modal-dek">{idea.dek}</p>}

      <div className="idea-modal-facts">
        {[['Buy', idea.the_trade?.buy], ['Sell to pay for it', idea.the_trade?.sell],
          ['Sell short', idea.the_trade?.short],
          ['What would make it a position', idea.the_trade?.what_would_make_it_a_position],
          ['How much', idea.the_trade?.sizing],
          ['The technical version', idea.instrument], ['Horizon', idea.horizon],
          ['Why now', idea.levels?.trigger], ['What proves it wrong', idea.levels?.invalidation],
          ['Where it goes if it works', idea.levels?.target]]
          .filter(([, v]) => v).map(([k, v]) => (
            <div className="idea-fact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
      </div>

      {/* The two blocks that separate research from an observation: what
          consensus believes, and the base rate the edge was measured
          against. Joe, 2026-08-14: "You keep coming back to such basic
          crap anyone can see." A hit rate with no unconditional baseline
          beside it is a statistic, so the baseline renders too. */}
      {idea.variant && (
        <>
          <p className="briefmodal-sec">Why this is not obvious</p>
          <p><Html html={idea.variant} /></p>
        </>
      )}

      {idea.edge && (
        <>
          <p className="briefmodal-sec">The edge, and how it was measured</p>
          {idea.edge.summary && <p><Html html={idea.edge.summary} /></p>}
          <div className="idea-backtest">
            {[['Signal', idea.edge.source], ['Sample', idea.edge.backtest?.window],
              ['Observations', idea.edge.backtest?.n],
              ['What followed', idea.edge.backtest?.result],
              ['Versus doing nothing', idea.edge.backtest?.baseline],
              ['Robustness', idea.edge.backtest?.robustness]]
              .filter(([, v]) => v || v === 0).map(([k, v]) => (
                <div className="idea-fact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
          </div>
        </>
      )}

      {idea.thesis?.length > 0 && (
        <>
          <p className="briefmodal-sec">The case</p>
          <ul>{idea.thesis.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
        </>
      )}

      {/* every chart the note names, drawn from the same series the
          evidence block cites — they cannot disagree */}
      {idea.charts?.length > 0 && (
        <>
          <p className="briefmodal-sec">The picture</p>
          <div className="idea-charts">
            {idea.charts.map((c) => (
              <IdeaChart key={c.series} spec={c} series={chartSeries?.[c.series]} width={640} height={230} />
            ))}
          </div>
        </>
      )}

      {idea.evidence?.length > 0 && (
        <>
          <p className="briefmodal-sec">What the data says</p>
          <ul className="idea-evidence">
            {idea.evidence.map((e, i) => (
              <li key={i}>
                <b>{e.value}</b> — {e.claim}{' '}
                <span className="idea-src">{e.source}{e.as_of ? `, as of ${e.as_of}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(idea.sections || []).map((sec, i) => (
        <div key={i}>
          <p className="briefmodal-sec">{sec.title}</p>
          {Array.isArray(sec.bullets) && sec.bullets.length > 0
            ? <ul>{sec.bullets.map((bt, jx) => <li key={jx}><Html html={bt} /></li>)}</ul>
            : <Html tag="p" html={sec.prose} />}
        </div>
      ))}

      {idea.other_side && (
        <>
          <p className="briefmodal-sec">The other side</p>
          <p><Html html={idea.other_side} /></p>
          {(idea.reconciles || []).map((r) => (
            <React.Fragment key={r.date}>
              <p className="briefmodal-sec">How this sits with the {longDate(r.date)} note</p>
              <p><Html html={r.prose} /></p>
            </React.Fragment>
          ))}
          {idea.book?.stance && (
            <>
              <p className="briefmodal-sec">The book, with this call in it</p>
              <p><Html html={idea.book.stance} /></p>
            </>
          )}
          {idea.book?.rebalance && (
            <>
              <p className="briefmodal-sec">If you hold the earlier calls</p>
              <p><Html html={idea.book.rebalance} /></p>
            </>
          )}
        </>
      )}

      {idea.risks?.length > 0 && (
        <>
          <p className="briefmodal-sec">What would kill it</p>
          <ul>{idea.risks.map((r, i) => <li key={i}><Html html={r} /></li>)}</ul>
        </>
      )}

      {idea.so_what && (
        <p className="idea-sowhat"><b>So what</b> — <Html html={idea.so_what} /></p>
      )}

      <p className="idea-disclaimer">
        MacroTilt research is published for information only. It is not investment advice and it is not a
        recommendation to buy or sell any security.
      </p>
    </div>
  );
}

export default function TradeIdeaNoteModal({ idea, chartSeries, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const target = (typeof document !== 'undefined'
    && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!idea || !target) return null;

  return createPortal(
    <div onClick={onClose} className="home-v12 briefmodal-veil">
      <div onClick={(e) => e.stopPropagation()} className="briefmodal">
        <button type="button" className="briefmodal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow2">
          <span className="dot dot--gold" />
          Trade idea · {longDate(idea.date)}{idea.kind ? ` · ${KIND_LABEL[idea.kind] || idea.kind}` : ''}
        </div>
        <h2 className="briefmodal-h">{idea.title}</h2>
        <TradeIdeaNoteBody idea={idea} chartSeries={chartSeries} />
      </div>
    </div>,
    target,
  );
}
