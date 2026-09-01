/* RETIRED 2026-08-11 (Joe) — THIS PAGE IS NO LONGER ROUTED.

   /scanner now redirects to the homepage (see OverhaulApp.jsx). The desk and
   the Paper page's event ledger were reading the same ce_events rows through
   the same hook; the book's own page won. Nothing imports this file or
   ConvictionEventsPanel.jsx any more, so neither is bundled. Both are left on
   disk rather than deleted only because this session ships through an API that
   can write files but not remove them — delete them in any local commit.

   ─── original header follows ───

   Trading Scanner — the CONVICTION EVENTS DESK, full width (Joe 2026-08-11).

   Until today this page was a three-tile cockpit: Conviction Events, Power
   Trend Momentum and RSI Divergence sat as visual equals, while only the
   first one was live machinery feeding the Paper book. Joe's decision: the
   two idea scanners come off the site entirely and the Scanner page becomes
   one page answering one question — what is the book seeing and doing today?

   The producing pipelines for the deleted panels (the daily divergence scan,
   the monthly power-trend list) keep running and keep their manifest
   entries; what was removed here is the SITE SURFACE, not the feed.

   Layout: editorial hero (the strategy in one line, plus the two links a
   reader needs — the book these events feed, and the methodology) over the
   Conviction Events desk, which owns today's events and the recent history.
   Visual vocabulary is unchanged: the cream v12 system's .sc-hero / .sc-ed
   hero and the .sc-tablecard / .sc-panelhead / .sc-inset / .sc-table desk
   anatomy. History: refactored 2026-05-27 (Path-A); cream reskin 2026-07-07;
   cockpit 2026-07-30; conviction desk 2026-08-11. */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConvictionEventsPanel from '../components/ConvictionEventsPanel';
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';
import '../styles/scanner-v12.css';

/* Reveal — scroll-reveal wrapper, same pattern as HomePage/MacroPage (v12
   system). Replays in BOTH directions; state lives in React so data-poll
   re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

export default function ScannerPage() {
  const navigate = useNavigate();

  return (
    <div className="home-v12 v13 scanner-v12">
      <section className="wrap sc-hero">
        <Reveal className="sc-ed">
          <div className="eyebrow2"><span className="dot" />Conviction Events</div>
          <h1>What the book saw today &mdash; <i>and what it did about it</i>.</h1>
          <div className="sc-sub">
            Insider purchases of $250,000 or more per name per day, automatic (10b5-1) plan
            purchases excluded, confirmed above the 50-day average. A qualifying event is bought at
            the next open at 10% of the book&rsquo;s equity, and sold at the open of the 21st
            trading day &mdash; or sooner, at the next open, if it closes 15% or more below the
            price it was bought at.
          </div>
          <div className="sc-links">
            <button type="button" className="sc-metalink" onClick={() => navigate('/paper')}>
              The book these events feed &rarr;
            </button>
            <button type="button" className="sc-metalink" onClick={() => navigate('/methodology#scanner')}>
              Methodology &rarr;
            </button>
          </div>
        </Reveal>
      </section>

      <ConvictionEventsPanel />
    </div>
  );
}
