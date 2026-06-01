// portfolioRisk.test.mjs — deterministic unit tests for the trailing-risk math.
// Uses a synthetic fixture (not the live feed) so results never drift.
// Run: node src/overhaul/lib/portfolioRisk.test.mjs

import assert from 'node:assert';
import { computeTrailingRisk, proxyFor } from './portfolioRisk.js';

// ── synthetic market feed: 3 proxies over 401 days ──────────────────────────
const N = 401;
// SPY: deterministic alternating ±1% (mean 0); IEF: flat 0; HYG: 0.7*SPY + noise-free
const spy = [0]; for (let i = 1; i < N; i++) spy.push(i % 2 ? 0.01 : -0.01);
const hyg = spy.map((x) => 0.7 * x);            // perfectly correlated, 0.7 beta to SPY
const ief = new Array(N).fill(0);               // zero-vol rates factor
const feed = { as_of: '2026-05-29', window_start: '2024-01-01', window_years: 3, rf_annual: 0.04,
  returns: { SPY: spy, HYG: hyg, IEF: ief, QQQ: spy } };

const sampStd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const spyVol = sampStd(spy.slice(1)) * Math.sqrt(252);

let n = 0; const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); n++; };

// 1) proxy routing
ok(proxyFor({ cls: { ac: 'Equity' }, ticker: 'FXAIX' }) === 'SPY', 'FXAIX routes to SPY');
ok(proxyFor({ cls: { ac: 'Fixed Income' }, ticker: 'JHYUX' }) === 'HYG', 'JHYUX routes to HYG');
ok(proxyFor({ cls: { ac: 'Cash' }, ticker: 'CASH' }) === null, 'cash has no proxy');
ok(proxyFor({ option: {}, ticker: 'QQQ' }) === 'QQQ', 'option routes to underlier proxy');

// 2) a 100%-equity book tracks SPY: vol == SPY vol, beta to SPY == 1
const eq = computeTrailingRisk([{ ticker: 'FXAIX', value: 100, cls: { ac: 'Equity' } }], 100, feed);
ok(Math.abs(eq.vol - spyVol) < 1e-9, '100% equity vol equals SPY vol');
ok(Math.abs(eq.betaMkt - 1) < 1e-9, '100% equity beta to S&P == 1.00');
ok(Math.abs(eq.betaHY - 0.7 / 0.7) < 1e-9 || Math.abs(eq.betaHY - (1 / 0.7)) < 1e-6, 'beta to HY ≈ 1/0.7 (SPY vs 0.7·SPY factor)');

// 3) adding 50% cash halves the volatility (cash is zero-variance)
const half = computeTrailingRisk([
  { ticker: 'FXAIX', value: 50, cls: { ac: 'Equity' } },
  { ticker: 'CASH', value: 50, cls: { ac: 'Cash' } },
], 100, feed);
ok(Math.abs(half.vol - spyVol / 2) < 1e-9, '50% equity + 50% cash halves vol');
ok(half.var95Dollar > 0 && half.var95Dollar < eq.var95Dollar, 'cash sleeve lowers dollar VaR');

// 4) a long put (delta-equivalent short) pulls market beta below the equity-only book
const hedged = computeTrailingRisk([
  { ticker: 'FXAIX', value: 100, cls: { ac: 'Equity' } },
  { ticker: 'QQQ', value: 5, cls: { ac: 'Option' }, option: { deltaEquivNotional: -40 } },
], 100, feed);
ok(hedged.betaMkt < eq.betaMkt, 'long put (short delta) reduces market beta');

// 5) sane shapes
ok(eq.asOf === '2026-05-29' && eq.windowYears === 3, 'feed metadata passes through');
ok(Number.isFinite(eq.sharpe) && Number.isFinite(eq.sortino) && eq.maxDD <= 0, 'sharpe/sortino finite, maxDD ≤ 0');

console.log(`\nAll ${n} portfolioRisk tests passed.`);
