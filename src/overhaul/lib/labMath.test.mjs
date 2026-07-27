/* labMath.test.mjs — hand-computed paper checks for the Portfolio Lab math
   (LESSONS 3.4: expected values derived from the math BY HAND, not from
   running the code). Run: node --test src/overhaul/lib/labMath.test.mjs */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSeries, dailyReturns, variance, annualVol, betaVs,
  capmAnnualER, scenarioHorizonER, horizonFromAnnual, annualFromHorizon,
  portfolioER, portfolioVol, riskContribution, portfolioPath, maxDrawdown,
  projectSimplex, minVarianceForTarget, efficientFrontier, sicToSectorEtf,
} from './labMath.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (tol ${tol})`);

test('dailyReturns: 100→110→99 gives +10%, −10%', () => {
  const r = dailyReturns([100, 110, 99]);
  close(r[0], 0.10); close(r[1], -0.10);
});

test('sample variance by hand: [.01,.03,-.01] → 0.0004; annualVol √(0.0004·252)', () => {
  const xs = [0.01, 0.03, -0.01];
  close(variance(xs), 0.0004, 1e-12);
  close(annualVol(xs), Math.sqrt(0.0004 * 252), 1e-12);
});

test('beta: stock = 2× benchmark returns → beta exactly 2', () => {
  const b = [0.01, 0.02, -0.01, 0.03];
  close(betaVs(b.map((x) => 2 * x), b), 2, 1e-12);
});

test('CAPM: rf 4% + 1.2 × 5% = 10%; 3y horizon (1.1³−1) = 33.1%', () => {
  const er = capmAnnualER(1.2, 0.04, 0.05);
  close(er, 0.10, 1e-12);
  close(horizonFromAnnual(er, 3), 0.331, 1e-12);
  close(annualFromHorizon(0.331, 3), 0.10, 1e-9);
});

test('scenario ER: 30%→+30%, 50%→+10%, 20%→−20% on last 100 = +10%', () => {
  const er = scenarioHorizonER(
    { bull: { price: 130, prob: 30 }, base: { price: 110, prob: 50 }, bear: { price: 80, prob: 20 } },
    100,
  );
  close(er, 0.10, 1e-12);
});

test('scenario ER rejects probabilities that do not sum to 100', () => {
  assert.equal(scenarioHorizonER(
    { bull: { price: 130, prob: 30 }, base: { price: 110, prob: 50 }, bear: { price: 80, prob: 10 } },
    100,
  ), null);
});

test('2-asset portfolio vol by hand: σ=20%/10%, ρ=0.5, 50/50 → √0.0175', () => {
  const S = [[0.04, 0.01], [0.01, 0.01]]; // cov12 = 0.5·0.2·0.1 = 0.01
  close(portfolioVol([0.5, 0.5], S), Math.sqrt(0.0175), 1e-12);
  close(portfolioER([0.5, 0.5], [0.10, 0.05]), 0.075, 1e-12);
});

test('risk contribution by hand: 80/20, σ 20%/10%, ρ=0 → 98.46% / 1.54%', () => {
  const S = [[0.04, 0], [0, 0.01]];
  const rc = riskContribution([0.8, 0.2], S);
  close(rc[0], 0.0256 / 0.026, 1e-9);
  close(rc[1], 0.0004 / 0.026, 1e-9);
  close(rc[0] + rc[1], 1, 1e-12);
});

test('simplex projection: [2,0]→[1,0]; [0.6,0.6]→[0.5,0.5]', () => {
  const a = projectSimplex([2, 0]);
  close(a[0], 1, 1e-9); close(a[1], 0, 1e-9);
  const b = projectSimplex([0.6, 0.6]);
  close(b[0], 0.5, 1e-9); close(b[1], 0.5, 1e-9);
});

test('min-vol 2-asset analytic: uncorrelated σ²=0.04/0.01 → w=[0.2,0.8]', () => {
  const S = [[0.04, 0], [0, 0.01]];
  const w = minVarianceForTarget(S, [0.10, 0.05], 0, 0);
  close(w[0], 0.2, 0.01);
  close(w[1], 0.8, 0.01);
});

test('frontier hits the hand-computed 50/50 point at target ER 7.5%', () => {
  const S = [[0.04, 0], [0, 0.01]];
  const { points, minVol } = efficientFrontier(S, [0.10, 0.05], 0.04, 41);
  // Long-only 2-asset frontier: ER 7.5% ⇒ weights exactly 50/50 ⇒ vol √0.0125.
  const p = points.reduce((b, x) => (Math.abs(x.ret - 0.075) < Math.abs(b.ret - 0.075) ? x : b));
  close(p.vol, Math.sqrt(0.0125), 0.005);
  // Min-vol portfolio vol must be ≤ every single asset's vol.
  assert.ok(minVol.vol <= 0.1 + 1e-6);
  assert.ok(minVol.vol <= 0.2 + 1e-6);
});

test('3-asset frontier: top point concentrates in the highest-ER asset', () => {
  const S = [[0.09, 0, 0], [0, 0.04, 0], [0, 0, 0.01]];
  const mu = [0.12, 0.08, 0.04];
  const { points, minVol, equalWeight } = efficientFrontier(S, mu, 0.04, 31);
  const top = points[points.length - 1];
  assert.ok(top.ret > 0.115, `top ret ${top.ret}`);
  assert.ok(minVol.vol <= Math.sqrt(0.01) + 1e-6);
  close(equalWeight.ret, (0.12 + 0.08 + 0.04) / 3, 1e-12);
});

test('max drawdown by hand: [1, 1.2, 0.9, 1.1] → −25%', () => {
  close(maxDrawdown([1, 1.2, 0.9, 1.1]), -0.25, 1e-12);
});

test('portfolioPath: flat prices → flat NAV; single asset doubling → NAV 2', () => {
  const dates = ['2025-01-02', '2025-01-03', '2025-02-03'];
  const flat = portfolioPath(dates, { A: [10, 10, 10], B: [20, 20, 20] }, ['A', 'B'], [0.5, 0.5]);
  close(flat[2], 1, 1e-12);
  const dbl = portfolioPath(dates, { A: [10, 15, 20] }, ['A'], [1]);
  close(dbl[2], 2, 1e-12);
});

test('alignSeries intersects on common dates only', () => {
  const { dates, closes } = alignSeries({
    A: [{ d: '2025-01-02', c: 1 }, { d: '2025-01-03', c: 2 }, { d: '2025-01-06', c: 3 }],
    B: [{ d: '2025-01-03', c: 5 }, { d: '2025-01-06', c: 6 }, { d: '2025-01-07', c: 7 }],
  });
  assert.deepEqual(dates, ['2025-01-03', '2025-01-06']);
  assert.deepEqual(closes.A, [2, 3]);
  assert.deepEqual(closes.B, [5, 6]);
});

test('SIC → sector ETF: software→XLK, banks→XLF, pharma→XLV, none→SPY', () => {
  assert.equal(sicToSectorEtf(7372), 'XLK');
  assert.equal(sicToSectorEtf(6022), 'XLF');
  assert.equal(sicToSectorEtf(2836), 'XLV');
  assert.equal(sicToSectorEtf(2911), 'XLE');
  assert.equal(sicToSectorEtf(null), 'SPY');
});
