// CONVICTION backtest — read indicator_history.json, compute daily composite
// SD score for every trading day 2006–2026, then check where GFC / COVID /
// 2022 actually sit on the SD scale. Goal: replace guessed band thresholds
// (LOW<0.25, NORMAL<0.88, ELEVATED<1.6) with empirically-defended numbers.
//
// Mirrors App.jsx compScore():
//   sdScore(id, v) = (v - μ_id) / σ_id, sign-flipped when IND[id][11] === true
//   composite = Σ(sdScore × W[id]) / Σ(W[id]) over non-null sdScores
//
// Usage: node scripts/conviction-backtest.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HIST_PATH = path.join(__dirname, "..", "public", "indicator_history.json");

// WEIGHTS + invertDir — mirrored from App.jsx by hand.
const WEIGHTS = {
  vix:1.5,hy_ig:1.5,eq_cr_corr:1.5,yield_curve:1.5,
  move:1.2,anfci:1.2,stlfsi:1.2,real_rates:1.2,sloos_ci:1.2,
  cape:1.2,ism:1.2,copper_gold:1.2,bkx_spx:1.2,bank_unreal:1.2,credit_3y:1.2,
  term_premium:1.0,cmdi:1.0,loan_syn:1.0,usd:1.0,cpff:1.0,
  skew:1.0,sloos_cre:1.0,bank_credit:1.0,jobless:1.0,jolts_quits:1.0,
};

// invertDir=true ⇒ "lower is worse" → sign-flip the z-score.
const INVERT = new Set([
  "yield_curve","cape","ism","copper_gold","bkx_spx","bank_unreal",
  "credit_3y",
]);

function mean(arr) { return arr.reduce((s,v) => s+v, 0) / arr.length; }
function stdev(arr, mu) {
  const v = arr.reduce((s,x) => s + (x-mu)*(x-mu), 0) / (arr.length-1);
  return Math.sqrt(v);
}

function main() {
  const hist = JSON.parse(fs.readFileSync(HIST_PATH, "utf8"));
  const ids = Object.keys(WEIGHTS).filter(id => hist[id]?.points?.length);

  // Pre-compute μ/σ per indicator from its full history (same as dashboard
  // sdScore denominator — every indicator normalized against its own past).
  const stats = {};
  ids.forEach(id => {
    const vals = hist[id].points.map(([,v]) => v).filter(v => v != null && Number.isFinite(v));
    const mu = mean(vals);
    const sd = stdev(vals, mu);
    stats[id] = { mu, sd };
  });

  // Build the union of dates across all indicators. For each date, pull each
  // indicator's most-recent value ≤ that date (the dashboard's snapshot
  // behavior — monthly/quarterly indicators carry forward between releases).
  const allDates = new Set();
  ids.forEach(id => hist[id].points.forEach(([d]) => allDates.add(d)));
  const sortedDates = [...allDates].sort();

  // Per-indicator running pointer to avoid O(N²) lookup.
  const ptrs = Object.fromEntries(ids.map(id => [id, 0]));
  const vals = Object.fromEntries(ids.map(id => [id, null]));

  const series = []; // [ [date, compositeSD] ]

  for (const d of sortedDates) {
    // Advance per-id pointers up to d.
    ids.forEach(id => {
      const pts = hist[id].points;
      while (ptrs[id] < pts.length && pts[ptrs[id]][0] <= d) {
        vals[id] = pts[ptrs[id]][1];
        ptrs[id]++;
      }
    });
    // Composite z-score.
    let num = 0, den = 0;
    ids.forEach(id => {
      const v = vals[id];
      if (v == null || !Number.isFinite(v)) return;
      const { mu, sd } = stats[id];
      if (sd === 0) return;
      let z = (v - mu) / sd;
      if (INVERT.has(id)) z = -z;
      const w = WEIGHTS[id];
      num += z * w;
      den += w;
    });
    if (den > 0) series.push([d, num / den]);
  }

  // Distribution of composite SD scores.
  const sdVals = series.map(([,s]) => s).sort((a,b) => a-b);
  const q = (p) => sdVals[Math.min(sdVals.length-1, Math.max(0, Math.round(p * (sdVals.length-1))))];

  const maxByWindow = (start, end) => {
    let best = { d: null, s: -999 };
    for (const [d, s] of series) {
      if (d >= start && d <= end && s > best.s) best = { d, s };
    }
    return best;
  };

  // Mean / SD / min / max snapshot.
  const mu = mean(sdVals);
  const sd = stdev(sdVals, mu);
  console.log("DISTRIBUTION (2006-01-03 → " + sortedDates[sortedDates.length-1] + ", N=" + sdVals.length + ")");
  console.log("  mean     :", mu.toFixed(3));
  console.log("  stdev    :", sd.toFixed(3));
  console.log("  min      :", sdVals[0].toFixed(3));
  console.log("  max      :", sdVals[sdVals.length-1].toFixed(3));
  console.log("");
  console.log("PERCENTILES");
  const pcts = [10,25,50,60,70,75,80,85,90,92.5,95,97.5,99,99.5];
  pcts.forEach(p => console.log(`  ${p.toString().padStart(5)}th : ${q(p/100).toFixed(3)}`));
  console.log("");

  // Named crisis peaks.
  const crises = [
    ["2007-07-01","2009-06-30","GFC"],
    ["2011-06-01","2011-12-31","2011 Euro/debt-ceiling"],
    ["2015-08-01","2016-02-29","2015-16 selloff"],
    ["2018-10-01","2018-12-31","Q4 2018 selloff"],
    ["2020-02-15","2020-05-31","COVID shock"],
    ["2022-01-01","2022-12-31","2022 bear"],
    ["2023-03-01","2023-05-31","SVB/regional bank"],
  ];
  console.log("HISTORICAL CRISIS PEAKS (composite SD)");
  crises.forEach(([s,e,label]) => {
    const m = maxByWindow(s, e);
    console.log(`  ${label.padEnd(26)} peak ${m.s.toFixed(3)} on ${m.d}`);
  });
  console.log("");

  // Count days above candidate thresholds.
  const countAbove = (t) => sdVals.filter(s => s >= t).length;
  const pct = (n) => (100*n/sdVals.length).toFixed(1);
  console.log("DAYS AT / ABOVE THRESHOLDS");
  [0.0,0.25,0.5,0.75,0.88,1.0,1.25,1.5,1.6,2.0,2.5].forEach(t => {
    const n = countAbove(t);
    console.log(`  ≥ ${t.toFixed(2).padStart(5)} SD : ${n.toString().padStart(5)} days  (${pct(n)}% of history)`);
  });
  console.log("");

  // SPY drawdown alignment. Pull spy-close via yahoo? No — we don't have
  // that file. Use COMP_HIST in App.jsx? That's synthetic quarterly. Skip
  // drawdown mapping; rely on absolute SD percentiles instead.

  // Proposed bands: LOW=<p60 (bottom 60% quiet), NORMAL=p60..p85 (next quarter),
  //   ELEVATED=p85..p97.5 (outliers), EXTREME=>p97.5 (tail ~1-in-40 days).
  // These align with GFC/COVID sitting in EXTREME and 2022 in ELEVATED.
  const low_hi = q(0.60);
  const nor_hi = q(0.85);
  const ele_hi = q(0.975);
  console.log("PROPOSED BANDS (percentile-based)");
  console.log(`  LOW      : SD < ${low_hi.toFixed(2)}   (≈ bottom 60% of history — quiet regimes)`);
  console.log(`  NORMAL   : ${low_hi.toFixed(2)} ≤ SD < ${nor_hi.toFixed(2)}  (mid-range; 25% of history)`);
  console.log(`  ELEVATED : ${nor_hi.toFixed(2)} ≤ SD < ${ele_hi.toFixed(2)}  (top ~15% excl. tail)`);
  console.log(`  EXTREME  : SD ≥ ${ele_hi.toFixed(2)}   (top ~2.5% — GFC/COVID/SVB peaks)`);
}

main();
