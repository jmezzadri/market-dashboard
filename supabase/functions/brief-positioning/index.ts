import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getJson(url: string) {
  try { const r = await fetch(url); if (!r.ok) return { err: r.status }; return await r.json(); }
  catch (e) { return { err: String(e) }; }
}
async function db(path: string) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return { err: r.status, msg: await r.text() };
    return await r.json();
  } catch (e) { return { err: String(e) }; }
}
// Copy rule (Joe 2026-06-26): never "washed out" / "crowded".
function lean(spec: number | null): string | null {
  if (spec == null) return null;
  if (spec <= 15) return "extended short (contrarian-bullish)";
  if (spec >= 85) return "extended long (contrarian-bearish)";
  return null;
}

// --- novelty helpers -------------------------------------------------------
// percentile rank of the last value of `arr` within a trailing window
function pctileRank(win: number[], v: number): number {
  if (!win.length) return 50;
  let below = 0;
  for (const x of win) if (x < v) below++;
  return Math.round((below / win.length) * 100);
}
// How many CONSECUTIVE weekly prints (ending with the latest) sat at the same
// side of the extreme. 1 = the extreme is NEW this week (genuinely news).
function extremeAge(history: any[], side: "low" | "high") {
  if (!Array.isArray(history) || history.length < 20) return { weeks: null, wow: null };
  const nets = history.map((h: any) => Number(h[1])).filter((n: number) => Number.isFinite(n));
  const WIN = 156; // 3 years of weekly prints
  const pct: number[] = [];
  for (let i = 0; i < nets.length; i++) {
    const start = Math.max(0, i - WIN);
    pct.push(pctileRank(nets.slice(start, i + 1), nets[i]));
  }
  let weeks = 0;
  for (let i = pct.length - 1; i >= 0; i--) {
    const hit = side === "low" ? pct[i] <= 15 : pct[i] >= 85;
    if (!hit) break;
    weeks++;
  }
  const wow = pct.length >= 2 ? pct[pct.length - 1] - pct[pct.length - 2] : null;
  // A published extreme whose recomputed print sits just inside the band is a
  // just-crossed extreme, not a zero-week one.
  return { weeks: Math.max(weeks, 1), wow };
}

Deno.serve(async () => {
  const cot: any = await getJson("https://macrotilt.com/cot_positioning.json");
  const ih: any = await getJson("https://macrotilt.com/indicator_history.json");

  // 1) COT positioning extremes, now AGE-AWARE.
  //    weeks_at_extreme = 1 means the extreme is new this week; a 12-week-old
  //    extreme is background, not news, and must not be narrated as fresh.
  const cotOut: any = { as_of: cot?.as_of ?? null, domains: {} };
  for (const d of Object.keys(cot?.domains ?? {})) {
    const dom = cot.domains[d];
    const extremes = (dom?.markets ?? [])
      .filter((m: any) => (m.spec != null && (m.spec <= 15 || m.spec >= 85)) || m.div === true)
      .map((m: any) => {
        const side = (m.spec != null && m.spec <= 15) ? "low" : "high";
        const age = (m.spec != null && (m.spec <= 15 || m.spec >= 85))
          ? extremeAge(m.history, side as "low" | "high")
          : { weeks: null, wow: null };
        return {
          market: m.market, spec_pctile: m.spec, net_pct_oi: m.specNet,
          divergence: m.div === true, lean: lean(m.spec),
          weeks_at_extreme: age.weeks,
          pctile_change_wow: age.wow,
          is_new_this_week: age.weeks === 1,
          novelty: age.weeks == null ? "unknown"
            : age.weeks === 1 ? "NEW this week"
            : `unchanged for ${age.weeks} weeks - background, not news`,
        };
      });
    cotOut.domains[d] = { takeaway: dom?.takeaway ?? null, extremes };
  }

  // 2) Price crowding from the indicator file.
  //    NOTE (2026-07-29): this block read v.pctile_3yr, but the percentile lives
  //    under v.stats -- so it returned an EMPTY array on every call since it was
  //    written. Reading the right path revives a whole rotating input to the brief.
  //    Each entry now also carries how long it has been at the extreme, so a
  //    percentile that has been pinned for months cannot be narrated as news.
  const root = (ih?.indicators && typeof ih.indicators === "object") ? ih.indicators : ih;
  const crowding: any[] = [];
  for (const k of Object.keys(root ?? {})) {
    if (!/^(cmdty_|fx_)/.test(k)) continue;
    const v: any = root[k];
    const st: any = v?.stats ?? {};
    const p = st.pctile_3yr ?? v?.pctile_3yr;
    if (p == null || (p < 85 && p > 15)) continue;
    const pts: any[] = Array.isArray(v?.points) ? v.points : [];
    const vals = pts.map((x: any) => Number(x[1])).filter((n: number) => Number.isFinite(n));
    const side = p <= 15 ? "low" : "high";
    let daysAt: number | null = null, chg5: number | null = null;
    if (vals.length > 60) {
      const W = 756; // ~3 years of daily prints
      const look = Math.min(90, vals.length - 1);
      const series: number[] = [];
      for (let i = vals.length - look; i < vals.length; i++) {
        series.push(pctileRank(vals.slice(Math.max(0, i - W), i + 1), vals[i]));
      }
      let n = 0;
      for (let i = series.length - 1; i >= 0; i--) {
        const hit = side === "low" ? series[i] <= 15 : series[i] >= 85;
        if (!hit) break;
        n++;
      }
      daysAt = Math.max(n, 1);
      chg5 = series.length > 5 ? series[series.length - 1] - series[series.length - 6] : null;
    }
    crowding.push({
      key: k, label: st.label ?? v?.label ?? k, value: pts.length ? pts[pts.length - 1][1] : null,
      as_of: v?.as_of ?? null, unit: v?.unit ?? null, pctile_3yr: p, state: st.state ?? null,
      trading_days_at_extreme: daysAt,
      pctile_change_5d: chg5,
      is_new_extreme: daysAt != null && daysAt <= 3,
      novelty: daysAt == null ? "unknown"
        : daysAt <= 3 ? "NEW extreme (last 3 sessions)"
        : `pinned at this extreme for ${daysAt} sessions - background, not news`,
    });
  }
  crowding.sort((a, b) => (a.trading_days_at_extreme ?? 999) - (b.trading_days_at_extreme ?? 999));

  // 3) Single-name setups, now with AGE ON THE LIST.
  //    The screener list is very sticky (one name sat on it 30 sessions running),
  //    so score alone re-nominates the same ticker every morning. days_on_list is
  //    the novelty dimension: a setup that has been visible for two weeks is not
  //    new information to a reader who gets this brief daily.
  const hist: any = await db("trading_opps_signals?select=scan_date,ticker&order=scan_date.desc&limit=1200");
  const byTicker = new Map<string, string[]>();
  const dateSet = new Set<string>();
  if (Array.isArray(hist)) {
    for (const r of hist) { dateSet.add(r.scan_date); }
    const dates = [...dateSet].sort().reverse().slice(0, 40);
    const keep = new Set(dates);
    for (const r of hist) {
      if (!keep.has(r.scan_date)) continue;
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
      byTicker.get(r.ticker)!.push(r.scan_date);
    }
  }
  const allDates = [...dateSet].sort().reverse();
  const latestDate = allDates[0] ?? null;
  function daysOnList(t: string): number {
    const seen = new Set(byTicker.get(t) ?? []);
    let n = 0;
    for (const d of allDates) { if (!seen.has(d)) break; n++; }
    return n;
  }

  // Pin to the LATEST scan date only. Ordering by scan_date desc with a flat row
  // limit silently mixed in yesterday's rows, which produced duplicate tickers and
  // a days_on_list of 0 for names not actually on today's list.
  const SETUP_COLS = "scan_date,ticker,company_name,sector,direction,score,dark_pool_status,options_shock_status,si_days_to_cover,si_cost_to_borrow_pct,so_what";
  const setupsRaw: any = latestDate
    ? await db(`trading_opps_signals?select=${SETUP_COLS}&scan_date=eq.${latestDate}&order=score.desc&limit=25`)
    : await db(`trading_opps_signals?select=${SETUP_COLS}&order=scan_date.desc,score.desc&limit=14`);

  // Latest insider BUY filing per candidate = the freshness of the underlying catalyst.
  const tickers = Array.isArray(setupsRaw) ? [...new Set(setupsRaw.map((s: any) => s.ticker))] : [];
  const filings: any = tickers.length
    ? await db(`insider_history_edgar?select=ticker,filing_date&transaction_code=eq.P&ticker=in.(${tickers.join(",")})&order=filing_date.desc&limit=800`)
    : [];
  const lastBuy = new Map<string, string>();
  if (Array.isArray(filings)) for (const f of filings) if (!lastBuy.has(f.ticker)) lastBuy.set(f.ticker, f.filing_date);

  const today = new Date().toISOString().slice(0, 10);
  function ageDays(d?: string | null) {
    if (!d) return null;
    return Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
  }

  const setups = (Array.isArray(setupsRaw) ? setupsRaw : []).map((s: any) => {
    const dol = daysOnList(s.ticker);
    const lb = lastBuy.get(s.ticker) ?? null;
    const lbAge = ageDays(lb);
    // Eligible to be NAMED in the brief only if the setup itself is new to the
    // list, or a fresh insider filing landed in the last 3 days. Everything else
    // has already been told to this reader.
    const eligible = dol <= 3 || (lbAge != null && lbAge <= 3);
    return {
      ...s,
      days_on_list: dol,
      first_seen: (byTicker.get(s.ticker) ?? []).slice(-1)[0] ?? null,
      latest_insider_buy_filing: lb,
      insider_filing_age_days: lbAge,
      is_new_today: dol <= 1,
      eligible_to_feature: eligible,
      novelty: dol <= 1 ? "NEW to the list today"
        : eligible ? `on the list ${dol} sessions, fresh filing ${lbAge} days ago`
        : `on the list ${dol} sessions with no new filing - ALREADY COVERED, do not feature again`,
    };
  });

  const featurable = setups.filter((s: any) => s.eligible_to_feature)
    .sort((a: any, b: any) => (a.days_on_list - b.days_on_list) || (b.score - a.score));
  const already_covered = setups.filter((s: any) => !s.eligible_to_feature).map((s: any) => s.ticker);

  // 4) Genuinely-daily material: insider BUY filings that landed in the last 3
  //    filing days across the whole universe (14-24 fresh tickers a day), not
  //    just the handful the sticky screener happens to score.
  const recent: any = await db("insider_history_edgar?select=ticker,filing_date,transaction_date,amount,owner_name,officer_title,sector,is_officer,is_director&transaction_code=eq.P&order=filing_date.desc&limit=400");
  const freshMap = new Map<string, any>();
  let newestFiling: string | null = null;
  if (Array.isArray(recent)) {
    const fdates = [...new Set(recent.map((r: any) => r.filing_date))].sort().reverse().slice(0, 3);
    newestFiling = fdates[0] ?? null;
    for (const r of recent) {
      if (!fdates.includes(r.filing_date)) continue;
      const cur = freshMap.get(r.ticker) ?? { ticker: r.ticker, sector: r.sector, filing_date: r.filing_date, buys: 0, total_usd: 0, buyers: new Set<string>() };
      cur.buys += 1;
      cur.total_usd += Number(r.amount) || 0;
      if (r.owner_name) cur.buyers.add(r.owner_name);
      if (r.filing_date > cur.filing_date) cur.filing_date = r.filing_date;
      freshMap.set(r.ticker, cur);
    }
  }
  const fresh_insider_buys = [...freshMap.values()]
    .map((c: any) => ({ ticker: c.ticker, sector: c.sector, filing_date: c.filing_date, buy_filings: c.buys, total_usd: Math.round(c.total_usd), distinct_buyers: c.buyers.size }))
    .sort((a, b) => b.total_usd - a.total_usd)
    .slice(0, 12);

  return new Response(JSON.stringify({
    generated_at: new Date().toISOString(),
    novelty_rules: {
      purpose: "Fields below exist so the daily brief does not repeat itself. A reader gets this every morning; anything unchanged since yesterday is not news to them.",
      single_name: "Name a ticker ONLY from featurable[]. Never name anything in already_covered[]. If featurable[] is empty, run NO single name that day - that is correct, not a gap.",
      positioning: "Only lead on a COT extreme where is_new_this_week is true or pctile_change_wow is large. An extreme with weeks_at_extreme > 2 may be referenced as standing background but must NOT be presented as a new development or a 'what to watch' item.",
      freshness: "fresh_insider_buys[] and the newest filing date change every day - prefer this material over restating the screener.",
    },
    latest_scan_date: latestDate,
    newest_insider_filing_date: newestFiling,
    cot: cotOut,
    crowding,
    setups,
    featurable,
    already_covered,
    fresh_insider_buys,
  }, null, 2), { headers: { "content-type": "application/json" } });
});
