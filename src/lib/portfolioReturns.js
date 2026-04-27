// portfolioReturns — period-return calculation utilities for portfolio_history.
//
// Joe & Senior Quant agreed 2026-04-27 on the AGGREGATE-FIRST TWR rollup:
// at each month-end, sum NAVs / contributions / withdrawals across accounts,
// then chain Modified Dietz / TWR on the aggregate series. This avoids the
// weight-shift bias that comes from weighted-averaging per-account TWRs when
// account weights change over time (Chase grew from $52k to $213k between
// April and October, then drained to $106k — naive weighting drifts).
//
// Two row patterns coexist in the table:
//   • NAV rows (Chase): nav + contributions + withdrawals, no monthly_return
//   • RETURN rows (Fidelity tax-advantaged): monthly_return only, no nav (we
//     can derive a synthetic NAV walk by anchoring on the latest known NAV
//     and walking backward)
//
// The aggregator handles both:
//   1. For each (account_label, as_of) row that has a nav, use the nav
//      directly.
//   2. For rows with only monthly_return, synthesize a NAV by anchoring on
//      the latest known NAV for that account and walking backward through
//      the return series. (anchor_nav / Π(1+r) over the missing months.)
//   3. Aggregate by date: total NAV at each as_of = sum across accounts.
//   4. Walk the aggregate series with Modified Dietz to get period TWRs.
//
// Period returns we compute:
//   • 1W  → most recent ~5 trading days of NAV change (best effort with
//           monthly granularity — if no week-resolution data, fall back to
//           portion of latest month return)
//   • 1M  → most recent month
//   • YTD → aggregate from Jan 1 of current year
//   • TTM → trailing 12 months from latest as_of
//
// Returns are returned as decimals (0.0628 = +6.28%).

const MS_DAY = 24 * 3600 * 1000;

// Synthesize a per-account NAV time series. For each account, we have:
//   • monthly_return rows (Fidelity)
//   • optional nav rows (Chase, anchors)
// Result: { account_label: [{as_of, nav, contributions, withdrawals}] }
function buildAccountSeries(rows) {
  const byAcct = new Map();
  for (const r of rows) {
    if (!byAcct.has(r.account_label)) byAcct.set(r.account_label, []);
    byAcct.get(r.account_label).push(r);
  }
  // Sort each account's series by as_of ascending.
  for (const [label, series] of byAcct) {
    series.sort((a, b) => a.as_of < b.as_of ? -1 : 1);
  }
  // For accounts with only monthly_return rows, walk an anchor-based NAV.
  // Anchor = latest row that has a nav. If no anchor, this account contributes
  // returns but no NAV (we exclude from aggregate NAV but include in TWR
  // chain if we have its weight from the prior month).
  const result = new Map();
  for (const [label, series] of byAcct) {
    const filled = [];
    // Find the latest nav anchor.
    let anchorIdx = -1;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].nav != null) { anchorIdx = i; break; }
    }
    if (anchorIdx < 0) {
      // No anchor → emit raw rows (returns only). The aggregator will need
      // to handle these specially (they contribute return chains but not
      // absolute NAVs). For our seeded data every account has at least one
      // anchor so this branch is mostly defensive.
      result.set(label, series.map(r => ({ ...r, _synthetic: false })));
      continue;
    }
    // Walk forward from beginning, propagating NAV across return rows.
    // Strategy: copy NAVs where present; for return-only rows BEFORE the
    // anchor, walk backward from the anchor (nav_prev = nav_after / (1+r)).
    // For return-only rows AFTER the anchor (rare in our data), walk
    // forward (nav_next = nav_prev * (1+r)).
    const navByAsof = {};
    // First pass: known NAVs.
    for (const r of series) if (r.nav != null) navByAsof[r.as_of] = Number(r.nav);
    // Walk backward from anchor.
    let curNav = Number(series[anchorIdx].nav);
    navByAsof[series[anchorIdx].as_of] = curNav;
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const r = series[i];
      const next = series[i + 1];
      // The return on `next.as_of` describes the change from r.as_of → next.as_of.
      // So nav at r.as_of = nav at next.as_of / (1 + return_at_next_asof) - flows.
      // For tax-advantaged accounts our seed has flows=0 so this is clean.
      const nextR = next.monthly_return != null ? Number(next.monthly_return) : 0;
      const prevNav = (curNav - (Number(next.contributions || 0) - Number(next.withdrawals || 0))) / (1 + nextR);
      if (r.nav == null) navByAsof[r.as_of] = prevNav;
      curNav = navByAsof[r.as_of];
    }
    // Walk forward from anchor (in case anchor isn't latest — rare).
    curNav = Number(series[anchorIdx].nav);
    for (let i = anchorIdx + 1; i < series.length; i++) {
      const r = series[i];
      const rR = r.monthly_return != null ? Number(r.monthly_return) : 0;
      const nextNav = curNav * (1 + rR) + (Number(r.contributions || 0) - Number(r.withdrawals || 0));
      if (r.nav == null) navByAsof[r.as_of] = nextNav;
      curNav = navByAsof[r.as_of];
    }
    filled.push(...series.map(r => ({
      ...r,
      nav: r.nav != null ? Number(r.nav) : navByAsof[r.as_of],
      _synthetic: r.nav == null,
    })));
    result.set(label, filled);
  }
  return result;
}

// Build aggregate NAV series across all accounts. Sums NAVs at each unique
// as_of date. Accounts that don't have a row on a given date are forward-
// filled from their last known NAV (so a Fidelity account with month-end-only
// data still contributes to a Chase weekly NAV row, etc.).
function buildAggregateSeries(accountSeries) {
  // Collect all distinct dates.
  const dateSet = new Set();
  for (const series of accountSeries.values()) {
    for (const r of series) dateSet.add(r.as_of);
  }
  const dates = Array.from(dateSet).sort();
  // For each date, sum NAVs (forward-filling per account).
  const aggregate = [];
  const lastNav = {};   // per account
  for (const d of dates) {
    let totalNav = 0;
    let totalContrib = 0;
    let totalWithdraw = 0;
    let anyNav = false;
    for (const [label, series] of accountSeries) {
      const row = series.find(r => r.as_of === d);
      if (row && row.nav != null) {
        lastNav[label] = row.nav;
        anyNav = true;
        totalContrib += Number(row.contributions || 0);
        totalWithdraw += Number(row.withdrawals || 0);
      }
      if (lastNav[label] != null) totalNav += lastNav[label];
    }
    if (anyNav) {
      aggregate.push({
        as_of: d, nav: totalNav,
        contributions: totalContrib, withdrawals: totalWithdraw,
      });
    }
  }
  return aggregate;
}

// Modified Dietz return on a span [start, end] of the aggregate series.
// Net flow = sum of period contributions - withdrawals.
// r = (V_end - V_start - net_flow) / (V_start + net_flow * weight)
// We use the simple flows-at-period-start convention:
//   r = (V_end - V_start - net_flow) / (V_start + net_flow)
// Chained over months when start..end spans multiple periods.
function chainTWR(aggregate, startIdx, endIdx) {
  if (startIdx < 0 || endIdx <= startIdx || endIdx >= aggregate.length) return null;
  let twr = 1.0;
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const prev = aggregate[i - 1];
    const cur = aggregate[i];
    const netFlow = (Number(cur.contributions) - Number(cur.withdrawals)) || 0;
    const denom = prev.nav + netFlow;
    if (denom <= 0) continue;
    const r = (cur.nav - prev.nav - netFlow) / denom;
    twr *= (1 + r);
  }
  return twr - 1;
}

// Find the index of the row at-or-before a given date (binary search on sorted dates).
function indexAtOrBefore(aggregate, dateStr) {
  let lo = 0, hi = aggregate.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (aggregate[mid].as_of <= dateStr) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

// Public API: compute period returns from portfolio_history rows.
// Returns { aggregate, periodReturns: { "1W", "1M", "YTD", "TTM" }, latestNav }
export function computePortfolioReturns(rows) {
  if (!rows || rows.length === 0) {
    return { aggregate: [], periodReturns: null, latestNav: null };
  }
  const accountSeries = buildAccountSeries(rows);
  const aggregate = buildAggregateSeries(accountSeries);
  if (aggregate.length === 0) {
    return { aggregate: [], periodReturns: null, latestNav: null };
  }
  const latest = aggregate[aggregate.length - 1];
  const latestIdx = aggregate.length - 1;
  const latestDate = new Date(latest.as_of + "T00:00:00Z");

  // Find period start indices.
  // 1W: row ~7 days ago
  // 1M: row ~30 days ago
  // YTD: row at-or-before Jan 1 of current year
  // TTM: row at-or-before 365 days ago
  const dateMinus = (days) => {
    const d = new Date(latestDate.getTime() - days * MS_DAY);
    return d.toISOString().slice(0, 10);
  };
  const yearStart = `${latestDate.getUTCFullYear()}-01-01`;
  // For YTD we want the LAST row of the prior year (Dec 31) as the baseline.
  // indexAtOrBefore finds the last row <= given date; pass yearStart with one
  // day subtracted equivalent: just find at-or-before yearStart.
  const ytdBase = indexAtOrBefore(aggregate, yearStart);
  const oneWBase = indexAtOrBefore(aggregate, dateMinus(7));
  const oneMBase = indexAtOrBefore(aggregate, dateMinus(30));
  const ttmBase = indexAtOrBefore(aggregate, dateMinus(365));

  return {
    aggregate,
    latestNav: latest.nav,
    latestDate: latest.as_of,
    periodReturns: {
      "1W":  chainTWR(aggregate, oneWBase, latestIdx),
      "1M":  chainTWR(aggregate, oneMBase, latestIdx),
      "YTD": chainTWR(aggregate, ytdBase, latestIdx),
      "TTM": chainTWR(aggregate, ttmBase, latestIdx),
    },
  };
}

// SPY period returns from composite_history_daily.json (preloaded array of
// {d, spx} entries). Same API shape so the caller can compute the diff.
export function computeSpyReturns(spxHistory, anchorDate) {
  if (!spxHistory || spxHistory.length === 0) return null;
  // anchorDate optional — defaults to last entry. For aligning with portfolio
  // latest_date we look for the SPX entry on-or-before that date.
  let lastIdx = spxHistory.length - 1;
  if (anchorDate) {
    let lo = 0, hi = lastIdx, best = lastIdx;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spxHistory[mid].d <= anchorDate) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    lastIdx = best;
  }
  const lastSpx = spxHistory[lastIdx].spx;
  const lastDate = new Date(spxHistory[lastIdx].d + "T00:00:00Z");
  const dateMinus = (days) => {
    const d = new Date(lastDate.getTime() - days * MS_DAY);
    return d.toISOString().slice(0, 10);
  };
  const yearStart = `${lastDate.getUTCFullYear()}-01-01`;
  const findOnOrBefore = (dStr) => {
    let lo = 0, hi = spxHistory.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spxHistory[mid].d <= dStr) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  };
  const r = (idx) => idx >= 0 && spxHistory[idx].spx > 0
    ? (lastSpx - spxHistory[idx].spx) / spxHistory[idx].spx
    : null;
  return {
    "1W":  r(findOnOrBefore(dateMinus(7))),
    "1M":  r(findOnOrBefore(dateMinus(30))),
    "YTD": r(findOnOrBefore(yearStart)),
    "TTM": r(findOnOrBefore(dateMinus(365))),
  };
}
