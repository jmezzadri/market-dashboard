/* ImpactMark — the measured market-impact grade of a scheduled release.

   Joe, 2026-09-10: "I like how Macro Ops lays out their calendar also showing
   potential impact to markets." Ours is MEASURED, not opined: on the sessions
   this release landed over the last three years, how far the S&P 500, the
   10-year yield and the dollar moved against an ordinary session (see
   scripts/build_econ_release_history.py, MARKET IMPACT). Three bars, filled
   1 / 2 / 3 for low / medium / high; hollow when the release always lands
   alongside something bigger and cannot be separated from it. The instant
   tooltip carries the numbers, so the mark never asks to be trusted. */

import React from 'react';
import Tip from './Tip';

export const IMPACT_WORD = { high: 'High', medium: 'Medium', low: 'Low', shared: 'Shared' };
const FILL = { high: 3, medium: 2, low: 1, shared: 0 };


export function impactSentence(impact) {
  if (!impact?.rating) return null;
  if (impact.rating === 'shared') {
    return `Lands with ${impact.shared_with}; its market effect cannot be separated from it.`;
  }
  const ms = Object.values(impact.markets || {}).filter((m) => m.ratio != null);
  const parts = ms.map((m) => `${m.label} ${m.ratio.toFixed(2)}×${m.significant ? '' : '°'}`);
  const soft = ms.some((m) => !m.significant) ? ' ° not distinguishable from an ordinary day.' : '';
  return `Release-day move vs an ordinary session, ${impact.n_days} sessions: ${parts.join(' · ')}.${soft}`;
}

export default function ImpactMark({ impact, showWord = false }) {
  if (!impact?.rating) return null;
  const n = FILL[impact.rating] ?? 0;
  const word = IMPACT_WORD[impact.rating];
  const tip = (
    <div className="impact-tip">
      <b>{word} market impact</b>
      <div>{impactSentence(impact)}</div>
    </div>
  );
  return (
    <Tip content={tip} bare>
      <span className={`impact impact--${impact.rating}`} aria-label={`${word} market impact`}>
        <span className="impact-bars" aria-hidden="true">
          {[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
        </span>
        {showWord && <span className="impact-word">{word}</span>}
      </span>
    </Tip>
  );
}
