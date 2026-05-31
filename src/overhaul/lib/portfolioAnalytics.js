// portfolioAnalytics.js — the classification + options-decomposition foundation
// for the Portfolio Insights page.
//
// Three jobs, all pure functions (no React, no network):
//   1. classifyPosition(pos)  → correct asset class / sector / credit / geography
//      (fixes "HY bond fund tagged as a stock" and the "Unknown" bucket).
//   2. decomposeOption(pos, mkt) → underlier, long/short, delta-equivalent share
//      and dollar exposure, and downside-protection notional.
//   3. buildBook(positions, mkt) → every position enriched, PLUS portfolio
//      aggregates: allocation by ECONOMIC exposure (options netted into the
//      underlier, not bucketed as "Options"), and first-order risk contribution.
//
// On the live page, option delta + underlier spot come from the snapshot greeks
// feed; here they can be passed in (mkt.deltas / mkt.spots) and fall back to a
// moneyness estimate so the math is testable offline.

// ── canonical asset classes ─────────────────────────────────────────────────
export const ASSET_CLASSES = ["Equity", "Fixed Income", "Cash", "Commodity", "Crypto"];

// Known instruments (extend as the book grows). Keyed by ticker.
const KNOWN = {
  // fixed income
  JHYUX: { ac: "Fixed Income", sub: "High Yield credit", sector: "High Yield", geo: "US", credit: "B / BB", duration: 3.5, yld: 6.8 },
  // equity — funds
  NHXINT906: { ac: "Equity", sub: "International developed", sector: "International", geo: "Intl", yld: 1.6 },
  FXAIX: { ac: "Equity", sub: "US Large Blend (index)", sector: "Diversified", geo: "US", yld: 1.3 },
  FSKAX: { ac: "Equity", sub: "US Total Market (index)", sector: "Diversified", geo: "US", yld: 1.3 },
  // equity — single names
  PLSE: { ac: "Equity", sub: "Biotech", sector: "Health Care", geo: "US", yld: 0 },
  RCAT: { ac: "Equity", sub: "Defense / drones", sector: "Industrials", geo: "US", yld: 0 },
  // commodity
  GLD: { ac: "Commodity", sub: "Gold", sector: "Precious metals", geo: "—", yld: 0 },
  SLV: { ac: "Commodity", sub: "Silver", sector: "Precious metals", geo: "—", yld: 0 },
  // crypto
  FBTC: { ac: "Crypto", sub: "Bitcoin", sector: "Crypto", geo: "—", yld: 0 },
  ETHE: { ac: "Crypto", sub: "Ethereum", sector: "Crypto", geo: "—", yld: 0 },
  // cash
  SPAXX: { ac: "Cash", sub: "Money market", sector: "Cash", geo: "—", yld: 4.5 },
  CASH: { ac: "Cash", sub: "Sweep", sector: "Cash", geo: "—", yld: 4.5 },
};

const has = (s, ...words) => { const t = String(s || "").toLowerCase(); return words.some((w) => t.includes(w)); };

// ── 1) classification ───────────────────────────────────────────────────────
export function classifyPosition(pos) {
  const ticker = String(pos.ticker || "").toUpperCase();
  const name = pos.name || "";
  const rawClass = String(pos.asset_class || pos.assetClass || "").toLowerCase();

  if (KNOWN[ticker]) return { ...KNOWN[ticker], source: "known" };

  // cash
  if (rawClass === "cash" || has(ticker, "cash") || has(name, "money market", "sweep", "cash")) {
    return { ac: "Cash", sub: "Cash", sector: "Cash", geo: "—", yld: 4.5, source: "rule" };
  }
  // options are handled by decomposeOption — but if one slips through, mark it
  if (rawClass === "option" || pos.contract_type) {
    return { ac: "Option", sub: "Derivative", sector: "Derivative", geo: "—", yld: 0, source: "option" };
  }
  // fixed income heuristics
  if (has(name, "high yield", "hi yield") || has(pos.sector, "high yield", "hy bond")) {
    return { ac: "Fixed Income", sub: "High Yield credit", sector: "High Yield", geo: "US", credit: "B / BB", duration: 3.5, yld: 6.5, source: "rule" };
  }
  if (has(name, "bond", "treasury", "fixed income", "income fund", "credit", "aggregate", "munic", "tips", "corporate")) {
    return { ac: "Fixed Income", sub: "Bonds", sector: "Investment Grade", geo: "US", duration: 5, yld: 4.0, source: "rule" };
  }
  // crypto
  if (has(name, "bitcoin", "btc") || ticker === "BTC") return { ac: "Crypto", sub: "Bitcoin", sector: "Crypto", geo: "—", yld: 0, source: "rule" };
  if (has(name, "ethereum") || ticker === "ETH") return { ac: "Crypto", sub: "Ethereum", sector: "Crypto", geo: "—", yld: 0, source: "rule" };
  // commodity
  if (has(name, "gold")) return { ac: "Commodity", sub: "Gold", sector: "Precious metals", geo: "—", yld: 0, source: "rule" };
  if (has(name, "silver")) return { ac: "Commodity", sub: "Silver", sector: "Precious metals", geo: "—", yld: 0, source: "rule" };
  if (has(name, "oil", "commodity", "natural gas", "copper")) return { ac: "Commodity", sub: "Commodity", sector: "Commodity", geo: "—", yld: 0, source: "rule" };
  // international equity
  if (has(name, "international", "ex-us", "ex us", "emerging", "developed market", "world ex", "eafe")) {
    return { ac: "Equity", sub: "International", sector: "International", geo: "Intl", yld: 1.5, source: "rule" };
  }
  // default: US equity, keep any usable sector from the feed
  const sec = pos.sector && !has(pos.sector, "unknown", "hy bond") ? pos.sector : "Diversified";
  return { ac: "Equity", sub: sec, sector: sec, geo: "US", yld: 0, source: "default" };
}

// ── 2) option decomposition ─────────────────────────────────────────────────
// Rough delta from moneyness when no live greek is supplied. Not for pricing —
// only so the decomposition is demonstrable offline. Live page passes real delta.
function estimateDelta(contractType, strike, spot) {
  if (!spot || !strike) return contractType === "put" ? -0.4 : 0.5;
  const m = spot / strike; // >1 = call ITM / put OTM
  // crude logistic-ish mapping centered at the money
  let callDelta = 1 / (1 + Math.exp(-6 * (m - 1)));
  callDelta = Math.max(0.02, Math.min(0.98, callDelta));
  return contractType === "put" ? callDelta - 1 : callDelta;
}

export function decomposeOption(pos, mkt = {}) {
  const ct = (pos.contract_type || "").toLowerCase();
  const underlier = String(pos.ticker || "").toUpperCase();
  const qty = Number(pos.quantity) || 0;            // signed: + long, - short
  const mult = Number(pos.multiplier) || 100;
  const strike = Number(pos.strike) || 0;
  const spot = (mkt.spots && mkt.spots[underlier]) || Number(pos.underlier_spot) || 0;
  const optDelta = (mkt.deltas && mkt.deltas[underlier + ":" + strike + ":" + ct]) ??
                   (pos.delta != null ? Number(pos.delta) : estimateDelta(ct, strike, spot));

  const direction = qty >= 0 ? "long" : "short";
  // position delta (signed shares of the underlier)
  const deltaEquivShares = qty * mult * optDelta;
  const deltaEquivNotional = spot ? deltaEquivShares * spot : null;
  // a long put / short call hedges downside on |qty|*mult*strike of underlier
  const isDownsideHedge = (ct === "put" && qty > 0) || (ct === "call" && qty < 0);
  const protectionNotional = isDownsideHedge ? Math.abs(qty) * mult * strike : 0;

  return {
    kind: "option",
    underlier,
    contractType: ct,
    direction,
    label: `${direction} ${ct}`,                    // e.g. "long put"
    optDelta,
    deltaEquivShares,
    deltaEquivNotional,                              // signed $; negative = short exposure
    protectionNotional,                              // $ of underlier hedged
    isDownsideHedge,
    underlierAssetClass: "Equity",                   // QQQ/SPY/etc.; refine per underlier if needed
  };
}

const isOption = (pos) => String(pos.asset_class || pos.assetClass || "").toLowerCase() === "option" || !!pos.contract_type;

// ── 3) build the enriched book + aggregates ─────────────────────────────────
export function buildBook(positions, mkt = {}) {
  const total = positions.reduce((s, p) => s + (Number(p.value) || 0), 0);

  const rows = positions.map((p) => {
    const val = Number(p.value) || 0;
    if (isOption(p)) {
      const opt = decomposeOption(p, mkt);
      return {
        ...p, value: val, weight: total ? val / total * 100 : 0,
        cls: { ac: "Option", sub: opt.label + " · " + opt.underlier, sector: "Derivative", geo: "US" },
        option: opt,
      };
    }
    return { ...p, value: val, weight: total ? val / total * 100 : 0, cls: classifyPosition(p) };
  });

  // Allocation by ECONOMIC exposure: options fold into their underlier's asset
  // class via delta-equivalent notional (a long put REDUCES net equity).
  const econ = {};
  for (const r of rows) {
    if (r.option) {
      const ac = r.option.underlierAssetClass;
      const expo = r.option.deltaEquivNotional != null ? r.option.deltaEquivNotional : 0;
      econ[ac] = (econ[ac] || 0) + expo;
    } else {
      econ[r.cls.ac] = (econ[r.cls.ac] || 0) + r.value;
    }
  }

  // Headline allocation by asset class (value-based, options as their own line
  // for the raw view; econ view above nets them in).
  const byClass = {};
  for (const r of rows) { const ac = r.option ? "Options" : r.cls.ac; byClass[ac] = (byClass[ac] || 0) + r.value; }

  // First-order risk contribution: weight × |beta| (cash/puts ≈ 0 directional).
  const risk = rows.map((r) => {
    const beta = r.option ? (r.option.deltaEquivNotional ? Math.abs(r.option.deltaEquivNotional) / total : 0)
                          : Math.abs(Number(r.beta) || defaultBeta(r.cls.ac));
    return { ticker: r.ticker, ac: r.option ? "Options" : r.cls.ac, weight: r.weight, rc: r.weight * (r.option ? 1 : beta) };
  });
  const rcTot = risk.reduce((s, x) => s + x.rc, 0) || 1;
  risk.forEach((x) => { x.riskPct = x.rc / rcTot * 100; });
  risk.sort((a, b) => b.riskPct - a.riskPct);

  return { total, rows, allocByClass: byClass, allocByEconomic: econ, riskContribution: risk };
}

function defaultBeta(ac) {
  return ({ Equity: 1.0, "Fixed Income": 0.3, Cash: 0, Commodity: 0.4, Crypto: 2.2 })[ac] ?? 1.0;
}
