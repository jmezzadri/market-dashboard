/* morningRead.js — the "Since yesterday's close" editorial engine.
   Joe-blessed trigger rulebook (2026-06-11), provisional pending volume
   right-sizing. Every bullet must be EARNED by a rule; nothing is ever
   hand-written; quiet days say so. Max 3 bullets per section, ranked by
   severity. All phrasing is factual register: level, change at the series'
   native cadence, and a scan-back anchor ("largest daily move since…",
   "lowest since…") instead of statistical jargon.

   Triggers (indicators — only elements whose latest print is current):
     T1 zone change      pill state changed vs the previous print
     T2 large move       |Δ| ≥ 2σ of the series' own print-to-print changes
                         (3y window) — phrased via scan-back, not sigma
     T3 new extreme      ≥99th / ≤1st pct, or highest/lowest in ≥ ~1 year
     T4 trend flip       first opposite-direction print after ≥5 in a row
     T5 divergence       defined pairs moving opposite, both ≥1σ
   Triggers (positioning — only when the COT report is ≤6 days old):
     P1 crowding cross   spec percentile crossed 90th / 10th vs prior week
     P2 big weekly shift |Δ net| ≥ 2σ of that market's weekly changes
     P3 both-sides       spec AND hedger at own extremes (producer div flag)
     P4 vs price         price up 4 straight weeks while specs cut, or inverse

   Exported pure functions so the same code runs in the page (useMemo) and in
   the calibration backtest harness. */

const DAY = 86400000;

function t(iso) { return Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z'); }

function ordSfx(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}
export function ord(n) { return `${Math.round(n)}${ordSfx(n)}`; }

function fmtVal(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 2 });
}
function signed(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = fmtVal(Math.abs(v), decimals);
  return (v >= 0 ? '+' : '−') + a;
}
function monthLabel(iso) {
  const d = new Date(t(iso));
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const CAD_WORD = { D: 'daily', W: 'weekly', M: 'monthly', Q: 'quarterly' };
const CAD_DELTA = { D: 'DoD', W: 'WoW', M: 'MoM', Q: 'QoQ' };

/* Window helpers — all 3y trailing, consistent with the pill basis. */
function window3y(points, endIdx) {
  const cut = t(points[endIdx][0]) - 3 * 365 * DAY;
  const out = [];
  for (let i = 0; i <= endIdx; i++) {
    if (t(points[i][0]) >= cut && Number.isFinite(points[i][1])) out.push(points[i][1]);
  }
  return out;
}
export function pctRankAt(points, endIdx) {
  if (endIdx < 0 || !points[endIdx] || !Number.isFinite(points[endIdx][1])) return null;
  const vals = window3y(points, endIdx);
  if (vals.length < 12) return null;
  const v = points[endIdx][1];
  return Math.round((vals.filter((x) => x < v).length / vals.length) * 100);
}
export function stateFor(pct, direction) {
  if (pct == null) return 'calm';
  if (direction === 'bw') return (pct >= 85 || pct <= 15) ? 'extreme' : (pct >= 75 || pct <= 25) ? 'elevated' : 'calm';
  if (direction === 'lw') return pct <= 15 ? 'extreme' : pct <= 25 ? 'elevated' : 'calm';
  return pct >= 85 ? 'extreme' : pct >= 75 ? 'elevated' : 'calm';
}
function sigmaOfDiffs(points, endIdx) {
  const cut = t(points[endIdx][0]) - 3 * 365 * DAY;
  const ds = [];
  for (let i = 1; i <= endIdx; i++) {
    if (t(points[i][0]) >= cut && Number.isFinite(points[i][1]) && Number.isFinite(points[i - 1][1])) {
      ds.push(points[i][1] - points[i - 1][1]);
    }
  }
  if (ds.length < 20) return null;
  const m = ds.reduce((s, x) => s + x, 0) / ds.length;
  return Math.sqrt(ds.reduce((s, x) => s + (x - m) ** 2, 0) / ds.length) || null;
}
/* Scan back: last index whose |single-print move| ≥ today's. Returns the iso
   date ONLY if that was ≥60 prints ago (so "largest daily move since X" is
   always literally true and genuinely rare); null otherwise. 90-day backtest
   2026-06-11: without the 60-print floor this fired near-daily on fat-tailed
   commodity series and produced untrue "in months" phrasing. */
function lastMoveAsBig(points, endIdx) {
  const cur = Math.abs(points[endIdx][1] - points[endIdx - 1][1]);
  for (let i = endIdx - 1; i > 0; i--) {
    if (Math.abs(points[i][1] - points[i - 1][1]) >= cur) {
      return endIdx - i >= 60 ? points[i][0] : null;
    }
  }
  return endIdx >= 60 ? points[1][0] : null;
}
/* Scan back: last time the LEVEL was ≥ (hi) / ≤ (lo) today's. */
function lastLevelSince(points, endIdx, hi) {
  const cur = points[endIdx][1];
  for (let i = endIdx - 1; i >= 0; i--) {
    const v = points[i][1];
    if (!Number.isFinite(v)) continue;
    if (hi ? v >= cur : v <= cur) {
      return (t(points[endIdx][0]) - t(points[i][0])) / DAY >= 350 ? points[i][0] : null;
    }
  }
  return (t(points[endIdx][0]) - t(points[0][0])) / DAY >= 350 ? points[0][0] : null;
}

/* ── Indicator bullets ──────────────────────────────────────────────────── */
export function analyzeIndicator(ind, endIdx) {
  const pts = ind.points;
  if (!pts || endIdx < 6) return null;
  const v = pts[endIdx][1];
  if (!Number.isFinite(v)) return null;
  const pct = pctRankAt(pts, endIdx);
  if (pct == null) return null;
  const prevPct = pctRankAt(pts, endIdx - 1);
  const st = stateFor(pct, ind.direction);
  const stPrev = stateFor(prevPct, ind.direction);
  const d1 = v - pts[endIdx - 1][1];
  const sig = sigmaOfDiffs(pts, endIdx);
  const freq = ind.freq || 'D';
  const cadD = CAD_DELTA[freq] || 'DoD';
  const cadW = CAD_WORD[freq] || 'daily';

  let sev = 0;
  let tail = '';
  const atExtreme = pct >= 99 || pct <= 1;
  const wasAtExtreme = prevPct != null && (prevPct >= 99 || prevPct <= 1);
  if (atExtreme && !wasAtExtreme) {
    // Fires on ENTRY only — a series parked at an extreme would otherwise
    // re-headline itself every print (Credit Distress pinned at 0 did exactly
    // that in the 90-day backtest).
    const since = lastLevelSince(pts, endIdx, pct >= 99);
    sev = 5;
    tail = `${ord(pct)} pct, ${pct >= 99 ? 'highest' : 'lowest'}${since ? ` since ${monthLabel(since)}` : ' of the last 3 years'}`;
  } else if (st !== stPrev && prevPct != null && Math.abs(pct - prevPct) >= 5) {
    // ≥5-pt move required so a 1-2 pt wobble across a boundary stays quiet
    // (right-sized after the 90-day backtest fired on 76th→73rd noise).
    const into = st === 'extreme' ? 5 : st === 'elevated' ? 3 : stPrev === 'extreme' ? 4 : 3;
    sev = into;
    const zone = st === 'extreme' ? 'the red zone' : st === 'elevated' ? 'the amber zone' : 'calm';
    tail = `${st === 'calm' ? 'back to' : 'entered'} ${zone} — ${ord(pct)} pct, was ${ord(prevPct)}`;
  } else if (sig && Math.abs(d1) >= 2.5 * sig) {
    // 2.5σ AND must actually be the largest move in ≥60 prints — both gates
    // from the right-sizing pass; the anchor date is then always true.
    const since = lastMoveAsBig(pts, endIdx);
    if (since) {
      sev = Math.abs(d1) >= 3.5 * sig ? 4 : 2;
      tail = `largest ${cadW} move since ${monthLabel(since)} — ${ord(pct)} pct`;
    }
  }
  if (!sev && freq !== 'D') {
    // Trend flip: count the run of consecutive same-direction prints that
    // PRECEDED today, then check today moved the other way.
    let run = 0, count = 0;
    for (let i = endIdx - 1; i > 0; i--) {
      const d = Math.sign(pts[i][1] - pts[i - 1][1]);
      if (d === 0) break;
      if (count === 0) { run = d; count = 1; continue; }
      if (d === run) count++; else break;
    }
    if (count >= 5 && Math.sign(d1) !== 0 && Math.sign(d1) !== run) {
      sev = 2;
      tail = `first ${d1 > 0 ? 'rise' : 'decline'} in ${count + 1} ${cadW.replace('ly', 's')}`;
    }
  }
  if (!sev) return null;

  const minTick = Math.pow(10, -(ind.decimals ?? 2));
  let head = `${ind.name} ${fmtVal(v, ind.decimals)}${ind.unit ? ' ' + ind.unit : ''}`;
  if (Math.abs(d1) >= minTick) head += `, ${signed(d1, ind.decimals)} ${cadD}`;
  if (freq === 'D' && endIdx >= 5 && Number.isFinite(pts[endIdx - 5][1])) {
    const wow = v - pts[endIdx - 5][1];
    if (Math.abs(wow) >= minTick) head += `, ${signed(wow, ind.decimals)} WoW`;
  }
  return { sev, text: `${head} — ${tail}` };
}

/* Divergence pairs — both legs printed, moved opposite, both ≥1σ. */
export const DIVERGENCE_PAIRS = [
  { a: 'spx_index', b: 'spx_above_200ema', label: (ua) => `S&P 500 ${ua ? 'rising' : 'falling'} while 200d breadth moves the other way — ${ua ? 'narrowing leadership' : 'breadth holding up'}` },
  { a: 'vix', b: 'skew', label: (ua) => `VIX and SKEW moving apart — ${ua ? 'spot fear up, tail bid easing' : 'spot fear easing, tail bid building'}` },
  { a: 'hy_ig', b: 'ig_oas', label: (ua) => `HY OAS and IG OAS diverging — stress ${ua ? 'concentrating in junk' : 'shifting toward quality'}` },
  { a: 'cmdty_copper', b: 'cmdty_gold', label: (ua) => `Copper and Gold diverging — ${ua ? 'growth bid over haven' : 'haven bid over growth'}` },
  { a: 'cmdty_gold', b: 'real_rates', label: (ua) => `Gold rising with real yields — the usual inverse link is broken`, sameDirAlert: true },
];
export function analyzePairs(byId, endIdxOf) {
  const out = [];
  DIVERGENCE_PAIRS.forEach((p) => {
    const A = byId[p.a], B = byId[p.b];
    if (!A || !B) return;
    const ia = endIdxOf(A), ib = endIdxOf(B);
    if (ia < 6 || ib < 6) return;
    const dA = A.points[ia][1] - A.points[ia - 1][1];
    const dB = B.points[ib][1] - B.points[ib - 1][1];
    const sA = sigmaOfDiffs(A.points, ia), sB = sigmaOfDiffs(B.points, ib);
    if (!sA || !sB) return;
    const big = Math.abs(dA) >= sA && Math.abs(dB) >= sB;
    if (!big) return;
    const opposite = Math.sign(dA) !== Math.sign(dB);
    if (p.sameDirAlert ? (!opposite && dA > 0) : opposite) {
      out.push({ sev: 3, text: p.label(dA > 0) });
    }
  });
  return out;
}

/* ── Positioning bullets ────────────────────────────────────────────────── */
function specPctAt(history, endIdx) {
  const w = history.slice(Math.max(0, endIdx - 155), endIdx + 1).map((r) => r[1]).filter(Number.isFinite);
  if (w.length < 30) return null;
  const cur = history[endIdx][1];
  return Math.round((w.filter((x) => x <= cur).length / w.length) * 100);
}
export function analyzeMarket(m, priceSeries) {
  const h = (m.history || []).filter((r) => Number.isFinite(r[1]));
  const n = h.length;
  if (n < 30) return null;
  const pct = specPctAt(h, n - 1);
  const prev = specPctAt(h, n - 2);
  const dNet = h[n - 1][1] - h[n - 2][1];
  const diffs = [];
  for (let i = Math.max(1, n - 156); i < n; i++) diffs.push(h[i][1] - h[i - 1][1]);
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const sig = Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / diffs.length) || null;

  if (pct != null && prev != null && ((pct >= 90 && prev < 90) || (pct <= 10 && prev > 10))) {
    return { sev: 5, text: `Specs entered crowded-${pct >= 90 ? 'long' : 'short'} ${m.market} — ${ord(pct)} pct, was ${ord(prev)}` };
  }
  if (pct != null && prev != null && ((prev >= 90 && pct < 90) || (prev <= 10 && pct > 10))) {
    return { sev: 4, text: `Specs left the crowded ${prev >= 90 ? 'long' : 'short'} in ${m.market} — ${ord(pct)} pct, was ${ord(prev)}` };
  }
  if (priceSeries && priceSeries.length > 10) {
    const px = [];
    let j = 0, last = null;
    for (const r of h.slice(-6)) {
      while (j < priceSeries.length && priceSeries[j][0] <= r[0]) { last = priceSeries[j][1]; j++; }
      px.push(last);
    }
    if (px.every(Number.isFinite) && px.length >= 5) {
      let pxUp = 0, pxDn = 0, spUp = 0, spDn = 0;
      const tail = h.slice(-5);
      for (let i = 1; i < 5; i++) {
        if (px[i + 1] > px[i]) pxUp++; else if (px[i + 1] < px[i]) pxDn++;
        if (tail[i][1] > tail[i - 1][1]) spUp++; else if (tail[i][1] < tail[i - 1][1]) spDn++;
      }
      if (pxUp === 4 && spDn === 4) return { sev: 5, text: `${m.market} up 4 straight weeks while specs cut — crowd exiting into strength` };
      if (pxDn === 4 && spUp === 4) return { sev: 5, text: `${m.market} down 4 straight weeks while specs add — crowd buying the decline` };
    }
  }
  if (sig && Math.abs(dNet) >= 2 * sig) {
    return { sev: 3, text: `${m.market} specs ${dNet > 0 ? 'added' : 'cut'} ${Math.abs(dNet).toFixed(1)} pts of open interest WoW — largest weekly shift in months · ${ord(pct)} pct` };
  }
  if (m.div) {
    return { sev: 3, text: `${m.market}: specs and hedgers at opposite extremes — ${ord(pct)} pct` };
  }
  return null;
}

/* ── Top-level: build the strip model from live page data ───────────────── */
export function buildMorningRead({ indicators, cotPos, indexSeries }) {
  const fresh = [];
  const byId = {};
  let maxAsOf = '';
  indicators.forEach((i) => { byId[i.id] = i; if (i.asOf && String(i.asOf) > maxAsOf) maxAsOf = String(i.asOf); });
  (indexSeries || []).forEach((s) => { byId[s.key] = { id: s.key, name: s.label, points: s.points, freq: 'D', direction: 'hw', decimals: 0, unit: '' }; });
  const freshCut = maxAsOf ? t(maxAsOf) - 2 * DAY : null;
  let printed = 0;
  const indBullets = [];
  indicators.forEach((i) => {
    if (!i.points || i.points.length < 8 || freshCut == null) return;
    const own = t(i.asOf);
    if (!Number.isFinite(own) || own < freshCut) return;
    printed++;
    const b = analyzeIndicator({ ...i, direction: i.direction }, i.points.length - 1);
    if (b) indBullets.push({ ...b, dom: i.domain || 'other' });
  });
  analyzePairs(byId, (x) => (x.points ? x.points.length - 1 : -1)).forEach((b) => indBullets.push({ ...b, dom: 'divergence' }));
  indBullets.sort((a, b) => b.sev - a.sev);

  const posFresh = (() => {
    const iso = cotPos && cotPos.as_of;
    if (!iso) return false;
    return (Date.now() - t(iso)) / DAY <= 6;
  })();
  const posBullets = [];
  if (posFresh && cotPos && cotPos.domains) {
    const priceFor = (market) => {
      const MAP = { 'S&P 500': 'spx_index', 'Nasdaq 100': 'ndx_index', 'Gold': 'cmdty_gold', 'Silver': 'cmdty_silver', 'Copper': 'cmdty_copper', 'WTI Crude': 'cmdty_oil', 'Natural Gas': 'cmdty_natgas', 'Corn': 'cmdty_corn', 'Soybeans': 'cmdty_soybeans', 'Wheat': 'cmdty_wheat', 'Euro': 'fx_eur', 'Japanese Yen': 'fx_jpy', 'British Pound': 'fx_gbp', 'Dollar index': 'usd' };
      const k = MAP[market];
      return k && byId[k] ? byId[k].points : null;
    };
    Object.values(cotPos.domains).forEach((d) => (d.markets || []).forEach((m) => {
      const b = analyzeMarket(m, priceFor(m.market));
      if (b) posBullets.push(b);
    }));
    posBullets.sort((a, b) => b.sev - a.sev);
  }

  // Top-3 with domain diversity: one hot domain can't fill the whole read
  // (the 90-day backtest had gold+silver+oil+brent narrating one rally).
  // Highest severity per domain first, then fill remaining slots by severity.
  const pickDiverse = (list, cap) => {
    const used = new Set();
    const picked = [];
    list.forEach((b) => { if (picked.length < cap && !used.has(b.dom)) { picked.push(b); used.add(b.dom); } });
    list.forEach((b) => { if (picked.length < cap && !picked.includes(b)) picked.push(b); });
    return picked;
  };
  const indTop = pickDiverse(indBullets, 3);
  return {
    printed,
    total: indicators.length,
    flagged: indBullets.length + posBullets.length,
    indicatorBullets: indTop.map((b) => b.text),
    positioningBullets: posBullets.slice(0, 3).map((b) => b.text),
    indicatorOverflow: Math.max(0, indBullets.length - indTop.length),
    positioningOverflow: Math.max(0, posBullets.length - 3),
    posFresh,
  };
}
