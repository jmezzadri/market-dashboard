// sectionComposites.js — per-section signal composites for the TickerDetailModal.
//
// Each of six sections (Technicals, Options, Insider, Congress, Analyst, Dark
// Pool) returns a score in [−100, +100] with a direction label. The overall
// composite is a weighted average of the sections.
//
// WEIGHTS — chosen to match the spirit of the existing 0–100 scorer.py caps:
//   insider (40) → 25%, congress (~25) → 15%, options (20) → 20%,
//   darkpool (15) → 5% (intentionally reduced per user feedback that dark
//   pool is a weak signal and should be tiebreaker only), volume (10)
//   → folded into options/technicals, technicals (additive) → 25%, analyst
//   (new slot) → 10%. Total = 100.
//
// The 0–100 `score_by_ticker` emitted by scorer.py is preserved as the
// "legacy bullish-only score"; these composites are additive context that
// expose signal DIRECTION (bullish / bearish / neutral) the legacy score
// cannot by design.

export const SECTION_WEIGHTS = {
  technicals: 25,
  insider:    25,
  options:    20,
  congress:   15,
  analyst:    10,
  darkpool:    5,
};
// Verify: 25 + 25 + 20 + 15 + 10 + 5 = 100.

export const SECTION_ORDER = ["technicals", "options", "insider", "congress", "analyst", "darkpool"];

export const SECTION_LABELS = {
  technicals: "Technicals",
  options:    "Options",
  insider:    "Insider",
  congress:   "Congress",
  analyst:    "Analyst",
  darkpool:   "Dark Pool",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const signOf = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function dirFromScore(s) {
  if (s == null) return "neutral";
  if (s >=  30) return "bullish";
  if (s <= -30) return "bearish";
  if (s >=  10) return "tilt-bull";
  if (s <= -10) return "tilt-bear";
  return "neutral";
}

function labelFromScore(s) {
  if (s == null) return "NO DATA";
  if (s >=  60) return "STRONG BULL";
  if (s >=  30) return "BULLISH";
  if (s >=  10) return "TILT BULL";
  if (s <= -60) return "STRONG BEAR";
  if (s <= -30) return "BEARISH";
  if (s <= -10) return "TILT BEAR";
  return "NEUTRAL";
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-section composites
// ─────────────────────────────────────────────────────────────────────────────

// TECHNICALS — prefer scanner's SCTR-style composite (−100..+100) if present,
// else rescale legacy tech_score (roughly ±20) to ±100.
function technicalsComposite(tech) {
  if (!tech) {
    return { score: null, components: [{ label: "No technicals data" }], note: "no data" };
  }
  const comp = tech.composite;
  if (comp && typeof comp.score === "number") {
    // Guard: scanner has historically emitted components as an array, but
    // some builds emit it as a keyed object (e.g. {long:{...},mid:{...}}).
    // A non-array truthy value slips past `x || []` and blows up `.map`,
    // which previously blanked the whole app on ticker click. Coerce here.
    const rawComponents = Array.isArray(comp.components)
      ? comp.components
      : (comp.components && typeof comp.components === "object")
        ? Object.entries(comp.components).map(([k, v]) => ({ ...(v || {}), name: v?.name || v?.label || k }))
        : [];
    return {
      score: Math.round(clamp(comp.score, -100, 100)),
      source: "SCTR composite",
      regime: comp.regime || null,
      components: rawComponents.map(c => ({
        label: c.name || c.label || "component",
        points: c.score != null ? Math.round(c.score) : c.points,
      })),
      note: "Long (60%) / Mid (30%) / Short (10%) with ADX regime filter",
    };
  }
  if (typeof tech.tech_score === "number") {
    const s = clamp(tech.tech_score * 5, -100, 100);
    return {
      score: Math.round(s),
      source: "legacy tech_score rescaled",
      components: [{ label: `tech_score = ${tech.tech_score}`, points: Math.round(s) }],
      note: "RSI + MACD + moving averages + volume",
    };
  }
  return { score: null, components: [{ label: "No technicals data" }], note: "no data" };
}

// OPTIONS — premium skew + alert flow direction.
function optionsComposite(sc, flowCalls, flowPuts) {
  const netCall = Number(sc?.net_call_premium  || 0);
  const netPut  = Number(sc?.net_put_premium   || 0);
  const bullPr  = Number(sc?.bullish_premium   || 0);
  const bearPr  = Number(sc?.bearish_premium   || 0);

  // Net premium skew — log-scaled so $10M skew ≈ 60 points (capped).
  let premScore = 0;
  const skew = netCall - netPut;
  if (Math.abs(skew) > 1) {
    premScore = clamp(signOf(skew) * Math.log10(Math.abs(skew) + 1) * 10, -60, 60);
  }

  // Independent check — bullish/bearish premium mix.
  let mixScore = 0;
  if (bullPr + bearPr > 0) {
    const r = (bullPr - bearPr) / (bullPr + bearPr);
    mixScore = clamp(r * 20, -20, 20);
  }

  // Alert count (calls positive, puts negative; sweeps count 1.5×).
  const nCall = (flowCalls || []).length;
  const nPut  = (flowPuts  || []).length;
  const callSweeps = (flowCalls || []).filter(f => f.has_sweep).length;
  const putSweeps  = (flowPuts  || []).filter(f => f.has_sweep).length;
  const alertScore = clamp(
    (nCall * 8) + (callSweeps * 4) - (nPut * 8) - (putSweeps * 4),
    -40, 40
  );

  const haveAnyData = (bullPr + bearPr > 0) || (netCall || netPut) || nCall || nPut;
  if (!haveAnyData) {
    return { score: null, components: [{ label: "No flow data" }], note: "no data" };
  }

  const score = Math.round(clamp(premScore + mixScore + alertScore, -100, 100));

  return {
    score,
    components: [
      { label: "Net call − net put premium", points: Math.round(premScore) },
      { label: "Bullish vs bearish premium mix", points: Math.round(mixScore) },
      { label: `Flow alerts (${nCall}C ${callSweeps}sw / ${nPut}P ${putSweeps}sw)`, points: Math.round(alertScore) },
    ],
    note: "premium skew + alert flow mix",
  };
}

// DARK POOL — tiebreaker only; relative-to-average via relative_volume proxy.
// Cap at ±20 per user feedback ("weak signal, tiebreaker only").
function darkPoolComposite(sc, darkpoolRows) {
  const rows = darkpoolRows || [];
  if (rows.length === 0) {
    return {
      score: 0,
      components: [{ label: "No off-exchange prints today" }],
      note: "tiebreaker only — max ±20",
    };
  }

  const totalPrem = rows.reduce((s, r) => s + (Number(r.premium) || 0), 0);

  // Direction proxy: print price vs NBBO midpoint.
  //   price > mid → buyer lifted the offer (bullish)
  //   price < mid → seller hit the bid (bearish)
  let bullCt = 0, bearCt = 0;
  for (const r of rows) {
    const bid = Number(r.nbbo_bid);
    const ask = Number(r.nbbo_ask);
    const p   = Number(r.price);
    if (bid > 0 && ask > 0 && p > 0) {
      const mid = (bid + ask) / 2;
      if (p > mid) bullCt++;
      else if (p < mid) bearCt++;
    }
  }

  // Magnitude — log-scaled on total premium (tight cap for tiebreaker weight).
  const magFactor = Math.min(1, Math.log10(totalPrem + 1) / 7); // $10M ≈ 1.0
  const dirScore  = clamp(signOf(bullCt - bearCt) * magFactor * 14, -14, 14);

  // Relative elevation — use rel_vol as "vs 30d average" proxy.
  const relVol = Number(sc?.relative_volume) || 1;
  const elevation = clamp((relVol - 1) * 4, -6, 6);

  const score = Math.round(clamp(dirScore + elevation, -20, 20));

  return {
    score,
    components: [
      { label: `${rows.length} off-exchange print(s), $${(totalPrem / 1e6).toFixed(2)}M total` },
      { label: `Direction: ${bullCt} above-mid / ${bearCt} below-mid`, points: Math.round(dirScore) },
      { label: `Rel-vol vs 30d avg: ${relVol.toFixed(2)}×`, points: Math.round(elevation) },
    ],
    note: "tiebreaker only — max ±20 (relative to 30d avg)",
  };
}

// CONGRESS — buys (+) minus sells (−), weighted by disclosed amount tier.
const CONGRESS_AMOUNT_POINTS = {
  "$1,001 - $15,000":        2,
  "$15,001 - $50,000":       4,
  "$50,001 - $100,000":      7,
  "$100,001 - $250,000":    12,
  "$250,001 - $500,000":    18,
  "$500,001 - $1,000,000":  25,
  "$1,000,001 +":           30,
};
function normAmounts(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
}
function congressTierPts(amounts) {
  const k = normAmounts(amounts);
  if (!k) return 0;
  if (CONGRESS_AMOUNT_POINTS[k] != null) return CONGRESS_AMOUNT_POINTS[k];
  const nk = k.replace(/[$,]/g, "").toLowerCase();
  for (const [ak, pts] of Object.entries(CONGRESS_AMOUNT_POINTS)) {
    if (ak.replace(/[$,]/g, "").toLowerCase() === nk) return pts;
  }
  return 0;
}
function congressComposite(buys, sells) {
  const b = buys  || [];
  const s = sells || [];
  if (b.length === 0 && s.length === 0) {
    return { score: 0, components: [{ label: "No congressional activity" }], note: "no data" };
  }

  const buyPts  = b.reduce((a, r) => a + congressTierPts(r.amounts), 0);
  const sellPts = s.reduce((a, r) => a + congressTierPts(r.amounts), 0);

  // Cluster bonus: multiple unique buyers within the lookback window.
  const uniqueBuyers = new Set(b.map(r => (r.name || "").trim().toLowerCase())).size;
  const cluster = uniqueBuyers >= 5 ? 15 : uniqueBuyers >= 3 ? 10 : 0;

  // Raw tier net + cluster → normalize so ~30 raw pts ≈ 100.
  const raw = buyPts - sellPts + cluster;
  const score = Math.round(clamp(raw * 3.3, -100, 100));

  const components = [
    { label: `${b.length} buy(s)`,  points: +buyPts  },
    { label: `${s.length} sell(s)`, points: -sellPts },
  ];
  if (cluster) components.push({ label: `${uniqueBuyers} unique buyers (cluster)`, points: cluster });

  return { score, components, note: "tier-weighted buys minus sells + cluster" };
}

// INSIDER — log-scaled buy notional minus sell notional, officer 1.5× multiplier.
function insiderDollarValue(row) {
  const shares = Math.abs(Number(row?.amount) || 0);
  const price  = Number(row?.stock_price) || 0;
  return shares * price;
}
function insiderComposite(buys, sells) {
  const qualBuys  = (buys  || []).filter(r => insiderDollarValue(r) >= 25_000);
  const qualSells = (sells || []).filter(r => insiderDollarValue(r) >= 25_000);

  if (qualBuys.length === 0 && qualSells.length === 0) {
    return { score: 0, components: [{ label: "No qualifying insider activity" }], note: "no data" };
  }

  const buyTotal  = qualBuys.reduce((a, r) => a + insiderDollarValue(r), 0);
  const sellTotal = qualSells.reduce((a, r) => a + insiderDollarValue(r), 0);
  const hasOffBuy  = qualBuys.some(r => r.is_officer);
  const hasOffSell = qualSells.some(r => r.is_officer);
  const uniqueBuyers = new Set(qualBuys.map(r => (r.owner_name || "").trim().toLowerCase())).size;

  // Log-scaled notionals: $100k→~1, $1M→2, $10M→3.
  const buyLog  = buyTotal  > 0 ? Math.log10(buyTotal)  - 5 : 0;
  const sellLog = sellTotal > 0 ? Math.log10(sellTotal) - 5 : 0;
  const net = (buyLog * (hasOffBuy ? 1.5 : 1)) - (sellLog * (hasOffSell ? 1.5 : 1));
  const cluster = uniqueBuyers >= 5 ? 15 : uniqueBuyers >= 3 ? 8 : 0;

  const raw = net * 30 + cluster;
  const score = Math.round(clamp(raw, -100, 100));

  const components = [
    { label: `${qualBuys.length} buyer(s), $${(buyTotal / 1e6).toFixed(2)}M`,   points: Math.round(buyLog * 30 * (hasOffBuy ? 1.5 : 1)) },
    { label: `${qualSells.length} seller(s), $${(sellTotal / 1e6).toFixed(2)}M`, points: -Math.round(sellLog * 30 * (hasOffSell ? 1.5 : 1)) },
  ];
  if (hasOffBuy || hasOffSell) components.push({ label: "Officer present → 1.5× multiplier" });
  if (cluster) components.push({ label: `${uniqueBuyers} unique buyers (cluster)`, points: cluster });

  return { score, components, note: "log-scaled notional, officer ×1.5" };
}

// ANALYST — rec mix + PT upside (user's key requirement) + recent action bonus.
function analystComposite(ratings, currentPrice) {
  const R = ratings || [];
  if (R.length === 0) {
    return { score: null, components: [{ label: "No recent ratings" }], note: "no data" };
  }

  const BUY  = new Set(["buy", "strong_buy", "outperform", "overweight"]);
  const SELL = new Set(["sell", "strong_sell", "underperform", "underweight"]);
  const HOLD = new Set(["hold", "neutral", "equal_weight", "market_perform"]);

  let nBuy = 0, nHold = 0, nSell = 0;
  for (const r of R) {
    const rec = String(r.recommendation || "").toLowerCase();
    if (BUY.has(rec)) nBuy++;
    else if (SELL.has(rec)) nSell++;
    else if (HOLD.has(rec)) nHold++;
  }

  // Rec mix: ±30 range.
  const total = nBuy + nHold + nSell;
  const recMix = total > 0 ? ((nBuy - nSell) / total) * 30 : 0;

  // PT distance — user feedback: "stock at $50 with $200 avg PT = significant
  // upside, should have more weight." Apply a smooth linear curve: +1% upside
  // ≈ +1.1 pts, so 50% upside → +55, 100% upside → +60 (capped), −20% → −22.
  const targets = R.map(r => parseFloat(r.target)).filter(v => !isNaN(v) && v > 0);
  const avgPT   = targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : null;
  const upside  = (avgPT && currentPrice) ? ((avgPT - currentPrice) / currentPrice) * 100 : null;

  let ptScore = 0;
  if (upside != null) {
    ptScore = clamp(upside * 1.1, -50, 60);
  }

  // Recent action (60-day window): upgrades +5, downgrades −5 each.
  let actionScore = 0;
  const now = Date.now();
  const WINDOW_MS = 60 * 24 * 3600 * 1000;
  for (const r of R) {
    const act = String(r.action || "").toLowerCase();
    const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
    if (!t || now - t > WINDOW_MS) continue;
    if (act.includes("upgrade")   || act.includes("initiated_buy"))  actionScore += 5;
    if (act.includes("downgrade") || act.includes("initiated_sell")) actionScore -= 5;
  }
  actionScore = clamp(actionScore, -15, 15);

  const score = Math.round(clamp(recMix + ptScore + actionScore, -100, 100));

  const components = [
    { label: `${nBuy} Buy / ${nHold} Hold / ${nSell} Sell`, points: Math.round(recMix) },
  ];
  if (avgPT != null) {
    components.push({
      label: `Avg PT $${avgPT.toFixed(2)} — ${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% vs $${(currentPrice || 0).toFixed(2)}`,
      points: Math.round(ptScore),
    });
  } else {
    components.push({ label: "No disclosed price targets" });
  }
  if (actionScore !== 0) {
    components.push({ label: "Recent upgrades/downgrades (60d)", points: Math.round(actionScore) });
  }

  return { score, components, note: "rec mix + PT upside + action momentum" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeSectionComposites(ticker, scanData)
 *
 * Returns {
 *   overall: { score: number|null, direction, label, contribByKey },
 *   sections: {
 *     technicals | options | insider | congress | analyst | darkpool: {
 *       score: number|null,
 *       direction: string,
 *       label: string,
 *       weight: number,
 *       components: [{label, points?}],
 *       note: string,
 *     }
 *   },
 *   weights: SECTION_WEIGHTS,
 *   legacyScore: number|null,  // unchanged 0–100 score_by_ticker
 * }
 */
export function computeSectionComposites(ticker, scanData) {
  if (!ticker || !scanData) return null;
  const T = ticker.toUpperCase();

  const signals = scanData.signals || {};
  const sc      = (signals.screener || {})[T] || {};
  const tech    = (signals.technicals || {})[T] || null;
  const ratings = (signals.analyst_ratings || {})[T] || [];

  const filt = list => (list || []).filter(r => (r?.ticker || "").toUpperCase() === T);

  const raw = {
    technicals: technicalsComposite(tech),
    options:    optionsComposite(sc, filt(signals.flow_alerts), filt(signals.put_flow_alerts)),
    insider:    insiderComposite(filt(signals.insider_buys), filt(signals.insider_sales)),
    congress:   congressComposite(filt(signals.congress_buys), filt(signals.congress_sells)),
    analyst:    analystComposite(ratings, Number(sc.close || sc.prev_close) || null),
    darkpool:   darkPoolComposite(sc, filt(signals.darkpool)),
  };

  // Attach direction, label, weight, and contribution to overall.
  const sections = {};
  let wSum = 0, wTotal = 0;
  for (const key of SECTION_ORDER) {
    const r = raw[key];
    const weight = SECTION_WEIGHTS[key];
    const direction = dirFromScore(r.score);
    const label = labelFromScore(r.score);
    let contribution = null;
    if (r.score != null) {
      contribution = Math.round((r.score * weight) / 100 * 10) / 10;  // e.g. +12.5
      wSum   += r.score * weight;
      wTotal += weight;
    }
    sections[key] = {
      ...r,
      weight,
      direction,
      label,
      contribution,
      name: SECTION_LABELS[key],
    };
  }

  const overallScore = wTotal > 0 ? Math.round(wSum / wTotal) : null;

  return {
    overall: {
      score:     overallScore,
      direction: dirFromScore(overallScore),
      label:     labelFromScore(overallScore),
    },
    sections,
    weights: SECTION_WEIGHTS,
    order:   SECTION_ORDER,
    legacyScore: scanData.score_by_ticker?.[T] ?? null,
  };
}

// Color palette helper for direction — used by modal pills and badges.
export function colorForDirection(direction) {
  switch (direction) {
    case "bullish":    return "#30d158";
    case "tilt-bull":  return "#86d9a0";
    case "bearish":    return "#ff453a";
    case "tilt-bear":  return "#ff9580";
    default:           return "var(--text-dim)";
  }
}

export { labelFromScore, dirFromScore };
