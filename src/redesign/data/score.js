/**
 * MacroTilt v2 — score math + map positioning.
 *
 * Senior Quant note: MT_SCORE_WEIGHTS must always sum to 1.00. The contribution
 * for each component on the /10 headline scale is (score_on_5 / 5) * weight * 10
 * which simplifies to score5 * weight * 2. breakdownForTicker() then normalizes
 * so the sum of contributions equals the row's headline score exactly — that
 * reconciliation is the spec requirement for the scanner drill table.
 */

export const MT_SCORE_WEIGHTS = [
  { key: "Technicals",  weight: 0.25, why: "200d trend up · RSI 62 · MACD bullish cross" },
  { key: "Insider",     weight: 0.20, why: "3 buys · 1 sale · 60d ratio" },
  { key: "Analyst",     weight: 0.20, why: "2 upgrades · raised PT consensus" },
  { key: "Options vol", weight: 0.15, why: "Calls 2.4× puts · IV rank 31" },
  { key: "Congress",    weight: 0.10, why: "1 senate buy · last week" },
  { key: "Dark pool",   weight: 0.10, why: "Block prints below VWAP" },
];

export function breakdownForTicker(row) {
  const meanFive = row.score / 2;
  const offsets = [0.65, 0.78, 0.32, 0.10, -0.55, -0.30];
  const items = MT_SCORE_WEIGHTS.map((c, i) => {
    const s5 = Math.max(0.5, Math.min(5, meanFive + offsets[i]));
    return { ...c, score5: s5, contribution: s5 * c.weight * 2 };
  });
  const sum = items.reduce((s, x) => s + x.contribution, 0);
  const k = row.score / sum;
  return items.map((x) => ({
    ...x,
    contribution: x.contribution * k,
    score5: Math.min(5, x.score5 * k),
  }));
}

/* RegimeCanvas positioning. X = stress (right = high), Y = inflationary axis
   (up = inflationary). Position derived from STATE so red dots always land
   on the right side of the map — never from raw percentile, which produces
   nonsense like a "calm" indicator showing up in the extreme quadrant. */
export function positionIndicators(inds) {
  return inds.map((ind, i) => {
    const xBase =
      ind.state === "extreme"  ? 0.62 :
      ind.state === "elevated" ? 0.18 :
      -0.55;
    const yBase =
      ind.domain === "Rates"    ?  0.40 :
      ind.domain === "Equities" ?  0.10 :
      ind.domain === "Credit"   ? -0.05 :
      ind.domain === "Money"    ? -0.25 :
      ind.domain === "Economy"  ? -0.42 : 0;
    return {
      ...ind,
      x: xBase + Math.sin(i * 1.7) * 0.12,
      y: yBase + Math.cos(i * 1.3) * 0.18,
    };
  });
}
