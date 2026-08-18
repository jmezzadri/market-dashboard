/* IndicatorDrillModal — open an indicator's full detail WHERE THE USER IS.

   Why this exists (Joe, 2026-08-18): "If I click the headers on the home page
   it pops a modal, but also brings me to Macro Tab. I dont want that. I just
   want to stay on home page." Every drill entry point on Home was an
   `<a href="/macro?ind=…">`, so a click did two things at once — navigated to
   another page AND opened a modal over it. The modal was what he wanted; the
   navigation was collateral. Reading a level on the home page is not a reason
   to leave the home page.

   Self-contained on purpose: give it an indicator id and it resolves the
   indicator, its overlay catalog and the index overlay series itself. The
   caller holds one piece of state (which id, or null).

   Overlay catalog note: Macro's dropdown additionally carries COT positioning
   series, because Macro already loads them. Home does not load positioning at
   all, so those entries are absent here rather than costing every home visitor
   a 185 KB fetch for a dropdown option. Index + indicator overlays — the ones
   the chart's own toggle pills use — are identical on both surfaces. */

import React, { useMemo } from 'react';
import useIndicators from '../lib/useIndicators';
import DetailModal from './DetailModal';
import IndicatorDetail from './IndicatorDetail';

export default function IndicatorDrillModal({ indId, onClose }) {
  const { indicators, indexSeries } = useIndicators();

  const ind = useMemo(
    () => (indId ? (indicators || []).find((i) => i.id === indId) || null : null),
    [indId, indicators],
  );

  const catalog = useMemo(() => {
    const out = [];
    (indexSeries || []).forEach((x) => {
      if (x.points?.length) out.push({ key: 'idx:' + x.key, label: x.label + ' (index)', points: x.points });
    });
    (indicators || []).forEach((i) => {
      if (i.points?.length) out.push({ key: 'ind:' + i.id, label: i.name, points: i.points });
    });
    return out;
  }, [indicators, indexSeries]);

  // Nothing asked for, or the history file hasn't landed yet: render nothing.
  // A half-built modal that pops open empty and then fills in is worse than a
  // click that takes a beat.
  if (!indId || !ind) return null;

  return (
    <DetailModal onClose={onClose}>
      <IndicatorDetail ind={ind} onClose={onClose} catalog={catalog} indexSeries={indexSeries} />
    </DetailModal>
  );
}
