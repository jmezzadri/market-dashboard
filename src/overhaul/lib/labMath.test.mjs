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
  ivAtHorizon, rescaleCovToImplied, riskCompensationER,
} from './labMath.js';
import { MIN_HISTORY_DAYS } from './labConfig.js';

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

test('frontier is monotone: return rises and volatility rises point-to-point (no zigzag)', () => {
  // correlated 3-asset case — the shape that produced optimizer jitter
  const S = [
    [0.09, 0.03, 0.02],
    [0.03, 0.04, 0.015],
    [0.02, 0.015, 0.0225],
  ];
  const { points, minVol } = efficientFrontier(S, [0.12, 0.09, 0.07], 0.04, 60);
  assert.ok(points.length >= 5, `only ${points.length} points survived`);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].ret > points[i - 1].ret, `ret not rising at ${i}`);
    assert.ok(points[i].vol > points[i - 1].vol - 1e-12, `vol dips at ${i}: ${points[i - 1].vol} -> ${points[i].vol}`);
  }
  // the curve starts AT the lowest-volatility point — no tail below it
  const volFloor = Math.min(...points.map((p) => p.vol));
  close(points[0].vol, volFloor, 1e-12);
  close(points[0].vol, minVol.vol, 1e-12);
  assert.ok(points.every((p) => p.ret >= minVol.ret - 1e-12), 'point below min-vol return survived');
  // concavity: slope only flattens as volatility rises — no elbows possible
  for (let i = 2; i < points.length; i++) {
    const s1 = (points[i - 1].ret - points[i - 2].ret) / (points[i - 1].vol - points[i - 2].vol);
    const s2 = (points[i].ret - points[i - 1].ret) / (points[i].vol - points[i - 1].vol);
    assert.ok(s2 <= s1 + 1e-7, `slope steepens at ${i}: ${s1} -> ${s2}`);
  }
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

/* ── implied-vol method paper checks (Phase 3, 2026-07-27) ─────────────── */

test('ivAtHorizon by hand: 20% at 30d, 25% at 90d → 60d = sqrt((1.2+0.5·4.425)/60)', () => {
  // Total variances (σ²·dte): 0.04·30 = 1.2 ; 0.0625·90 = 5.625.
  // At 60d (halfway): v = 1.2 + (5.625−1.2)·(30/60) = 3.4125.
  // σ(60d) = sqrt(3.4125/60) = sqrt(0.056875) = 0.238484800354…
  const term = [{ dte: 30, iv: 0.20 }, { dte: 90, iv: 0.25 }];
  close(ivAtHorizon(term, 60), 0.238484800354, 1e-9);
});

test('ivAtHorizon clamps: before first expiry and beyond last expiry are flat', () => {
  const term = [{ dte: 30, iv: 0.20 }, { dte: 90, iv: 0.25 }];
  close(ivAtHorizon(term, 10), 0.20, 1e-12);   // shorter than shortest listed
  close(ivAtHorizon(term, 365), 0.25, 1e-12);  // flat extrapolation past last
  assert.equal(ivAtHorizon([], 30), null);
  assert.equal(ivAtHorizon([{ dte: 0, iv: 0.3 }], 30), null); // dte 0 excluded
});

test('ivAtHorizon exact at a listed expiry returns that expiry\'s vol', () => {
  const term = [{ dte: 30, iv: 0.20 }, { dte: 90, iv: 0.25 }];
  close(ivAtHorizon(term, 90), 0.25, 1e-12);
});

test('rescaleCovToImplied by hand: 2-asset diagonal swap keeps correlation', () => {
  // Historical: σA=0.20 (var 0.04), σB=0.30 (var 0.09), cov 0.012 (ρ=0.2).
  // Implied σA′=0.30 → scaleA=1.5, B unchanged → scaleB=1.
  // S′ = [[0.04·2.25, 0.012·1.5], [0.012·1.5, 0.09]] = [[0.09, 0.018], [0.018, 0.09]].
  const S = [[0.04, 0.012], [0.012, 0.09]];
  const S2 = rescaleCovToImplied(S, ['A', 'B'], { A: 0.20, B: 0.30 }, { A: 0.30 });
  close(S2[0][0], 0.09, 1e-12);
  close(S2[0][1], 0.018, 1e-12);
  close(S2[1][0], 0.018, 1e-12);
  close(S2[1][1], 0.09, 1e-12);
  // Correlation preserved: 0.018 / (0.3·0.3) = 0.2 — same ρ as before.
  close(S2[0][1] / Math.sqrt(S2[0][0] * S2[1][1]), 0.2, 1e-12);
});

test('riskCompensationER by hand: rf 4%, ERP 4.23%, SPY IV 16.5%, stock IV 101%', () => {
  // lambda = 0.0423 / 0.165 = 0.2563636...; ER = 0.04 + 0.2563636 x 1.01
  //        = 0.04 + 0.25892727... = 0.29892727...
  close(riskCompensationER(0.04, 0.0423, 0.165, 1.01), 0.298927272727, 1e-9);
});

test('riskCompensationER: market-vol stock earns exactly rf + ERP; guards return null', () => {
  close(riskCompensationER(0.04, 0.0423, 0.165, 0.165), 0.0823, 1e-12);
  assert.equal(riskCompensationER(0.04, 0.0423, 0, 0.5), null);
  assert.equal(riskCompensationER(null, 0.0423, 0.165, 0.5), null);
  assert.equal(riskCompensationER(0.04, 0.0423, 0.165, null), null);
});

/* Regression — LESSONS 8.21 (Joe, 2026-07-30: "I just tried to build a new
   portfolio. Whats going on? Everything is blank.")

   The Lab used to align EVERY holding on one book-wide intersection and then
   gate history off that single length. Adding SPCX — a June-2026 listing with
   33 bars — cut all ten holdings to 33 aligned days, so every row failed the
   252-day gate ("insufficient history") and the volatility column annualized
   33 days of noise: MSFT printed 59% against a true 28%.

   A holding's history is a fact about that holding. Beta/vol/gating come from
   its own overlap with SPY; only the optimizer's covariance needs a shared
   window, and that window spans the names it actually uses. */
test('one young holding must not truncate the rest of the book', () => {
  const day = (i) => `2020-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
  const walk = (n, seed) => {
    let c = 100; const out = [];
    for (let i = 0; i < n; i++) { c *= 1 + Math.sin((i + seed) * 1.7) * 0.01; out.push({ d: day(i), c }); }
    return out;
  };
  const LONG = 600;
  const spy = walk(LONG, 0);
  const old = walk(LONG, 1);          // 600 days of history
  const young = walk(LONG, 2).slice(-33); // listed 33 days ago

  // Book-wide intersection: what the page used to do.
  const bookWide = alignSeries({ OLD: old, YOUNG: young, SPY: spy });
  assert.equal(bookWide.dates.length, 33, 'the young name defines the shared window');

  // Per-holding alignment: what it does now.
  const ownOld = alignSeries({ x: old, SPY: spy });
  const ownYoung = alignSeries({ x: young, SPY: spy });
  assert.equal(ownOld.dates.length, LONG, 'the old name keeps its own 600 days');
  assert.equal(ownYoung.dates.length, 33, 'the young name is still correctly short');

  // The gate applies per holding, so exactly one row is excluded — not both.
  assert.equal(ownOld.dates.length >= MIN_HISTORY_DAYS, true);
  assert.equal(ownYoung.dates.length >= MIN_HISTORY_DAYS, false);

  // And the vol the old name reports is its real vol, not 33 days of noise.
  const volOwn = annualVol(dailyReturns(ownOld.closes.x));
  const volTruncated = annualVol(dailyReturns(bookWide.closes.OLD));
  assert.notEqual(volOwn.toFixed(3), volTruncated.toFixed(3));

  // The optimizer window spans only the names it can use — here, just OLD.
  const cov = alignSeries({ OLD: old, SPY: spy });
  assert.equal(cov.dates.length, LONG);
});
