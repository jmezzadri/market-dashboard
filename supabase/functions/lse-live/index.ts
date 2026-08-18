// lse-live — London Strategic Edge production feed (built 2026-07-27, Joe-approved scope).
//
// One function, three modes (POST JSON body):
//   { mode: "quotes", symbols: ["SPY", ...] }  -> live 1m-bar last prices (shared cache)
//   { mode: "iv", symbol: "AAPL" }             -> ATM implied-vol term structure (per expiry)
//   { mode: "scan_iv" }                        -> daily batch: ATM IV + vol rank for scanner names
//
// verify_jwt is OFF (site convention — the prod client ships the new
// sb_publishable key, which the platform JWT check rejects; every other
// site-called function here is verify_jwt=false too). Abuse is bounded
// server-side: shared cache TTLs gate vendor calls, 45-symbol cap per
// request, negative-cache for unknown symbols.
//
// Design rules (LESSONS-driven):
// - The LSE key NEVER leaves the server: read via public.get_lse_api_key()
//   (security definer, service-role-only) using this function's service key.
// - Secrets read lazily in-handler; Deno.serve; no boot-time fetch (2026-07-13).
// - All vendor reads go through the shared cache tables so N viewers cost the
//   same as one. TTLs: quotes 45s open / 30min closed; IV term 30min open / 6h
//   closed. Uncovered symbols negative-cache for 24h (em-dash on the site —
//   never a fabricated value, LESSONS 4.4).
// - Free-tier budget (verified 2026-07-27 via /vault/usage): 200 calls/min,
//   concurrency 2, 50 GB/month. Vendor fan-out here uses concurrency 2.
// - pipeline_health stamped green ONLY AFTER the cache write lands
//   (stamp-after-publish, 2026-06-12); red stamp with the error on failure.
// - LSE quirks (shadow trial, memory 2026-07-27): 1m-bar ts is
//   "YYYY-MM-DD HH:MM:SS" (space, no T/Z, UTC) — normalize; always order=desc;
//   options chain includes long-expired contracts and per-row underlying_price
//   stamped at ITS OWN last update — anchor ATM to the freshest contract.
// - v8 (2026-07-28, Joe-approved): archive EOD IV rows (source='archive',
//   nightly LSE-ARCHIVE-IV job, migration 088) for names the live chain
//   doesn't cover. Live rows always win; archive rows are preserved when the
//   live chain is empty and served with their data date.
//   (Comment restored to the repo 2026-08-18: the deployed v10 carried it and
//   this file did not, so the version-controlled copy was not quite the source
//   of record. LESSONS 4.29's open item, in miniature — diff the deployed
//   function against the repo BEFORE redeploying, or a redeploy silently
//   reverts whatever only production knew.)

const VAULT = "https://api.londonstrategicedge.com/vault";
const UA = "macrotilt-live";

const QUOTE_TTL_OPEN_S = 45;
const QUOTE_TTL_CLOSED_S = 30 * 60;
const IV_TTL_OPEN_S = 30 * 60;
const IV_TTL_CLOSED_S = 6 * 60 * 60;
const UNCOVERED_TTL_S = 24 * 60 * 60;
const MAX_SYMBOLS = 45;

type Json = Record<string, unknown>;

const tsNorm = (v: unknown) => String(v ?? "").replace(" ", "T");
const tsParse = (v: unknown) => {
  const s = tsNorm(v);
  return Date.parse(s.endsWith("Z") || s.includes("+") ? s : s + "Z");
};

// NYSE regular session, approximated in real ET (handles DST via Intl):
// Mon-Fri 09:30-16:05 ET. Holidays fall through to the closed TTL naturally
// (bars stop advancing; cache refreshes are cheap and harmless).
function marketOpen(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins <= 16 * 60 + 5;
}

async function lse(path: string, params: Record<string, string>, key: string) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${VAULT}${path}?${qs}`, { headers: { "x-api-key": key, "User-Agent": UA } });
  if (!r.ok) throw new Error(`LSE ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

function sb(pathAndQuery: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(`${url}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: svc,
      Authorization: `Bearer ${svc}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
}

async function sbJson(pathAndQuery: string): Promise<Json[]> {
  const r = await sb(pathAndQuery, { headers: { Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`supabase ${pathAndQuery.split("?")[0]} HTTP ${r.status}`);
  return await r.json();
}

let _key: string | null = null;
async function lseKey(): Promise<string> {
  if (_key) return _key;
  const r = await sb("rpc/get_lse_api_key", { method: "POST", body: "{}", headers: { Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`get_lse_api_key HTTP ${r.status}`);
  const k = (await r.json()) as string;
  if (!k || typeof k !== "string") throw new Error("LSE key missing from vault");
  _key = k;
  return k;
}

// Stamp AFTER publish (cache rows written). Green advances last_good_at with
// the real wall-clock run time; red records the error and leaves the last
// good stamp untouched (honest-stamp rules 4.2 / 2026-06-12).
async function stamp(id: string, ok: boolean, dataAsOfIso: string | null, err?: string, coveragePct?: number) {
  const now = new Date().toISOString();
  const body: Json = ok
    ? { status: "green", last_good_at: now, last_check_at: now, last_error: null, updated_at: now }
    : { status: "red", last_check_at: now, last_error: String(err ?? "unknown").slice(0, 400), updated_at: now };
  if (ok && dataAsOfIso) body.data_as_of = dataAsOfIso;
  if (ok && coveragePct != null) body.coverage_pct = Math.round(coveragePct * 10) / 10;
  await sb(`pipeline_health?indicator_id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
}

// Small fixed-concurrency pool (vendor cap: concurrency 2).
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ── mode: quotes ─────────────────────────────────────────────────────── */

async function modeQuotes(symbols: string[]) {
  const syms = [...new Set(symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!syms.length) return { quotes: [], marketOpen: marketOpen() };

  const open = marketOpen();
  const ttlS = open ? QUOTE_TTL_OPEN_S : QUOTE_TTL_CLOSED_S;
  const nowMs = Date.now();

  const cached = await sbJson(`lse_live_quotes?select=*&symbol=in.(${syms.map(encodeURIComponent).join(",")})`);
  const bySym = new Map(cached.map((r) => [String(r.symbol), r]));

  const stale = syms.filter((s) => {
    const row = bySym.get(s);
    if (!row) return true;
    const age = (nowMs - (Date.parse(String(row.fetched_at)) || 0)) / 1000;
    if (row.covered === false) return age > UNCOVERED_TTL_S;
    return age > ttlS;
  });

  let vendorErr: string | null = null;
  let refreshed = 0;
  if (stale.length) {
    const key = await lseKey();
    const nowIso = new Date().toISOString();
    const fetchOne = async (sym: string): Promise<Json | null> => {
      try {
        const bars = await lse("/candles", { symbol: sym, timeframe: "1m", order: "desc", limit: "1" }, key);
        const b = Array.isArray(bars) ? bars[0] : null;
        if (!b) {
          return { symbol: sym, price: null, bar_ts: null, covered: false, fetched_at: nowIso, updated_at: nowIso };
        }
        const ts = tsParse(b.ts ?? b.timestamp);
        const price = Number(b.close ?? b.open);
        return {
          symbol: sym,
          price: Number.isFinite(price) ? price : null,
          bar_ts: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
          covered: true,
          fetched_at: nowIso,
          updated_at: nowIso,
        };
      } catch (e) {
        const msg = String(e);
        // 404 "'X' has no candle data" = the symbol simply isn't in LSE's
        // universe — that's coverage, not an outage. Negative-cache it so the
        // site shows an em-dash and we don't re-probe for 24h.
        if (msg.includes("HTTP 404")) {
          return { symbol: sym, price: null, bar_ts: null, covered: false, fetched_at: nowIso, updated_at: nowIso };
        }
        vendorErr = msg.slice(0, 300);
        return null;
      }
    };
    let updates = await pool(stale, 2, fetchOne);
    // One retry round for transient vendor errors — live UAT (2026-07-27)
    // caught a batch where half the book errored on the first pass and every
    // one succeeded seconds later; a covered name must not read as an
    // em-dash because of a single hiccup.
    const failedSyms = stale.filter((_, i) => updates[i] === null);
    if (failedSyms.length) {
      await new Promise((res) => setTimeout(res, 400));
      const second = await pool(failedSyms, 2, fetchOne);
      updates = updates.concat(second);
    }
    const rows = updates.filter(Boolean) as Json[];
    if (rows.length) {
      const r = await sb("lse_live_quotes?on_conflict=symbol", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error(`quote cache write HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      refreshed = rows.length;
      for (const row of rows) bySym.set(String(row.symbol), row);
    }
  }

  // Stamp only when we actually pulled from the vendor this call.
  if (refreshed > 0) {
    const newest = [...bySym.values()].reduce((m, r) => {
      const t = Date.parse(String(r.bar_ts ?? "")) || 0;
      return t > m ? t : m;
    }, 0);
    await stamp("lse_intraday", true, newest ? new Date(newest).toISOString() : null);
  } else if (vendorErr && stale.length) {
    await stamp("lse_intraday", false, null, vendorErr);
  }

  return {
    marketOpen: open,
    quotes: syms.map((s) => {
      const r = bySym.get(s);
      return r
        ? { symbol: s, price: r.price == null ? null : Number(r.price), barTs: r.bar_ts ?? null, covered: r.covered !== false, fetchedAt: r.fetched_at }
        : { symbol: s, price: null, barTs: null, covered: false, fetchedAt: null };
    }),
    vendorError: vendorErr,
  };
}

/* ── ATM IV helpers (shared by iv + scan_iv) ──────────────────────────── */

type ChainRow = Record<string, unknown>;

function liveRows(chain: ChainRow[], todayIso: string): ChainRow[] {
  return (chain || []).filter((o) => String(o.expiry ?? "") >= todayIso && o.iv != null && o.underlying_price != null);
}

// Freshest contract's underlying price is the only trustworthy anchor —
// per-row underlying_price is stamped at that row's own last update and can
// be weeks old (shadow-trial finding).
function anchorPrice(rows: ChainRow[]): number {
  const freshest = rows.reduce((a, b) =>
    (tsParse(a.updated_at ?? a.last_trade_at) || 0) >= (tsParse(b.updated_at ?? b.last_trade_at) || 0) ? a : b);
  return Number(freshest.underlying_price);
}

function atmPerExpiry(rows: ChainRow[], und: number) {
  const byExpiry = new Map<string, ChainRow[]>();
  for (const o of rows) {
    const e = String(o.expiry);
    if (!byExpiry.has(e)) byExpiry.set(e, []);
    byExpiry.get(e)!.push(o);
  }
  const out: { expiry: string; dte: number; iv: number; strike: number; updated: string | null }[] = [];
  for (const [expiry, list] of byExpiry) {
    list.sort((a, b) => Math.abs(Number(a.strike) - und) - Math.abs(Number(b.strike) - und));
    const atm = list[0];
    const iv = Number(atm.iv);
    if (!Number.isFinite(iv) || iv <= 0) continue;
    const strike = Number(atm.strike);
    // "At the money" must mean it: if the nearest live strike for this expiry
    // sits >10% from the anchor price, its IV is a smile point, not ATM —
    // drop the expiry (verified live 2026-07-27: a thin AAPL weekly's nearest
    // strike was 8% OTM).
    if (!Number.isFinite(strike) || und <= 0 || Math.abs(strike / und - 1) > 0.10) continue;
    // LSE's per-row dte is stamped at the CONTRACT's last update and can be
    // days stale (verified live: same-day expiry carried dte 3). Compute
    // days-to-expiry from the expiry date ourselves.
    const dte = Math.round((Date.parse(expiry + "T20:00:00Z") - Date.now()) / 86400000);
    out.push({ expiry, dte, iv, strike, updated: (atm.updated_at ?? atm.last_trade_at ?? null) as string | null });
  }
  out.sort((a, b) => a.dte - b.dte);
  return out;
}

/* ── mode: iv (term structure for one underlying — Portfolio Lab) ─────── */

async function modeIv(symbol: string) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("symbol required");
  const open = marketOpen();
  const ttlS = open ? IV_TTL_OPEN_S : IV_TTL_CLOSED_S;

  const cached = await sbJson(`lse_iv_term?select=*&symbol=eq.${encodeURIComponent(sym)}&order=dte.asc`);
  // Archive rows (nightly EOD derivation for live-feed-uncovered names, 088)
  // run on their own clock: fresh until ~30h old (next nightly run + grace).
  const isArchive = cached.length > 0 && String(cached[0].source ?? "live") === "archive";
  const archivePayload = () => ({
    symbol: sym, cached: true, source: "archive",
    asOf: cached.reduce((m, r) => (String(r.as_of ?? "") > m ? String(r.as_of) : m), ""),
    underlyingPrice: cached[0].underlying_price == null ? null : Number(cached[0].underlying_price),
    term: cached.filter((r) => Number(r.dte) >= 0).map((r) => ({ expiry: r.expiry, dte: Number(r.dte), iv: Number(r.iv), strike: Number(r.strike) })),
    fetchedAt: cached[0].fetched_at,
  });
  if (cached.length) {
    const age = (Date.now() - (Date.parse(String(cached[0].fetched_at)) || 0)) / 1000;
    if (isArchive && age <= 30 * 3600) return archivePayload();
    if (!isArchive && age <= ttlS) {
      return {
        symbol: sym, cached: true, source: "live",
        underlyingPrice: cached[0].underlying_price == null ? null : Number(cached[0].underlying_price),
        term: cached.filter((r) => Number(r.dte) >= 0).map((r) => ({ expiry: r.expiry, dte: Number(r.dte), iv: Number(r.iv), strike: Number(r.strike) })),
        fetchedAt: cached[0].fetched_at,
      };
    }
  }

  const key = await lseKey();
  const todayIso = new Date().toISOString().slice(0, 10);
  try {
    // One wide pull: every listed call expiry out to ~1.5 years. 5,000-row cap
    // per request (plan limit); order=desc so the most recently updated rows
    // survive any truncation. A 404 means the underlying isn't in LSE's
    // options universe — treated as an empty (uncovered) term structure.
    let chain: ChainRow[] = [];
    try {
      chain = await lse("/options/chain", {
        underlying: sym, type: "call", min_dte: "3", max_dte: "550", limit: "5000", order: "desc",
      }, key) as ChainRow[];
    } catch (e) {
      if (!String(e).includes("HTTP 404")) throw e;
    }
    const live = liveRows(chain, todayIso);
    const nowIso = new Date().toISOString();
    if (!live.length) {
      // No live contracts. If the nightly archive job (088) has rows for this
      // name, they stay authoritative — serve them and DO NOT overwrite (the
      // pre-088 behavior deleted them here on every cache expiry, silently
      // reverting the name to the CAPM fallback until the next night).
      // Tolerate up to 6 days of archive age (long weekend + one missed run);
      // beyond that the honest answer is uncovered.
      if (isArchive && cached.some((r) => String(r.as_of ?? "") >= new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))) {
        return archivePayload();
      }
      // Truly uncovered: cache an empty marker row so repeat views don't
      // hammer the vendor. (dte -1 marker, filtered on read.)
      await sb(`lse_iv_term?symbol=eq.${encodeURIComponent(sym)}`, { method: "DELETE" });
      await sb("lse_iv_term", {
        method: "POST",
        body: JSON.stringify([{ symbol: sym, expiry: todayIso, dte: -1, iv: null, strike: null, underlying_price: null, fetched_at: nowIso }]),
      });
      return { symbol: sym, cached: false, underlyingPrice: null, term: [], fetchedAt: nowIso };
    }
    const und = anchorPrice(live);
    const term = atmPerExpiry(live, und).filter((t) => t.dte >= 3);
    await sb(`lse_iv_term?symbol=eq.${encodeURIComponent(sym)}`, { method: "DELETE" });
    const r = await sb("lse_iv_term", {
      method: "POST",
      body: JSON.stringify(term.map((t) => ({
        symbol: sym, expiry: t.expiry, dte: t.dte, iv: t.iv, strike: t.strike,
        underlying_price: und, contract_updated_at: t.updated ? new Date(tsParse(t.updated)).toISOString() : null,
        fetched_at: nowIso,
      }))),
    });
    if (!r.ok) throw new Error(`iv cache write HTTP ${r.status}`);
    const newest = term.reduce((m, t) => {
      const x = t.updated ? tsParse(t.updated) : 0;
      return x > m ? x : m;
    }, 0);
    await stamp("lse_atm_iv", true, newest ? new Date(newest).toISOString() : nowIso);
    return {
      symbol: sym, cached: false, source: "live", underlyingPrice: und,
      term: term.map(({ expiry, dte, iv, strike }) => ({ expiry, dte, iv, strike })),
      fetchedAt: nowIso,
    };
  } catch (e) {
    await stamp("lse_atm_iv", false, null, String(e));
    // Serve stale cache rather than nothing (age is visible in fetchedAt).
    if (isArchive) return archivePayload();
    if (cached.length) {
      return {
        symbol: sym, cached: true, stale: true, source: "live",
        underlyingPrice: cached[0].underlying_price == null ? null : Number(cached[0].underlying_price),
        term: cached.filter((r) => Number(r.dte) >= 0).map((r) => ({ expiry: r.expiry, dte: Number(r.dte), iv: Number(r.iv), strike: Number(r.strike) })),
        fetchedAt: cached[0].fetched_at,
      };
    }
    throw e;
  }
}

/* ── mode: scan_iv (daily batch for scanner names) ────────────────────── */

async function modeScanIv() {
  // Scanner universe = latest Insider Conviction scan + current Power Trend
  // list. Coverage gaps (foreign names, some funds) are expected and accepted
  // (Joe, 2026-07-27) — uncovered names simply have no row; the site shows an
  // em-dash.
  const scan = await sbJson("trading_opps_signals?select=ticker,scan_date&order=scan_date.desc&limit=1");
  if (!scan.length) throw new Error("no scan rows");
  const scanDate = String(scan[0].scan_date).slice(0, 10);
  const scanRows = await sbJson(`trading_opps_signals?select=ticker&scan_date=eq.${scanDate}&limit=500`);
  // Current Power Trend list = the latest rebalance_date's rows.
  const ptLatest = await sbJson("power_trend_list?select=rebalance_date&order=rebalance_date.desc&limit=1").catch(() => [] as Json[]);
  const pt = ptLatest.length
    ? await sbJson(`power_trend_list?select=ticker&rebalance_date=eq.${String(ptLatest[0].rebalance_date).slice(0, 10)}&limit=100`).catch(() => [] as Json[])
    : [] as Json[];
  const tickers = [...new Set([
    ...scanRows.map((r) => String(r.ticker).toUpperCase()),
    ...pt.map((r) => String(r.ticker).toUpperCase()),
  ])].filter(Boolean);
  if (!tickers.length) throw new Error("empty scanner universe");

  const key = await lseKey();
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  const results = await pool(tickers, 2, async (sym) => {
    try {
      // 30-day ATM IV convention. The vendor-side dte window filters on
      // LSE's own (often stale) dte stamps, so request WIDE (1-120) and do
      // the real 10-60-day selection ourselves below.
      const chain = await lse("/options/chain", {
        underlying: sym, type: "call", min_dte: "1", max_dte: "120", limit: "2000", order: "desc",
      }, key) as ChainRow[];
      const live = liveRows(chain, todayIso);
      if (!live.length) return null; // uncovered / no live options -> no row (em-dash on site)
      const und = anchorPrice(live);
      // ~30-day convention on REAL days-to-expiry: LSE's request window works
      // off its own stale dte stamps, so re-filter on computed dte (10-60)
      // and take the expiry closest to 30 days (first run caught a 4-day
      // weekly being stored as the "30-day" IV).
      const atm = atmPerExpiry(live, und)
        .filter((t) => t.dte >= 10 && t.dte <= 60)
        .sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
      if (!atm) return null;
      return { ticker: sym, atm_iv: atm.iv, dte: atm.dte, expiry: atm.expiry, strike: atm.strike };
    } catch (e) {
      // 404 = not in LSE's options universe — a coverage gap (accepted), not an error.
      if (!String(e).includes("HTTP 404")) errors.push(`${sym}: ${String(e).slice(0, 120)}`);
      return null;
    }
  });

  const covered = results.filter(Boolean) as { ticker: string; atm_iv: number; dte: number; expiry: string; strike: number }[];
  if (!covered.length) {
    await stamp("lse_iv_scan", false, null, `0/${tickers.length} covered; first errors: ${errors.slice(0, 3).join(" | ")}`);
    throw new Error("scan_iv: no names covered");
  }

  // Cross-sectional volatility rank: percentile of ATM IV among today's
  // covered scan names (0 = calmest, 100 = most volatile). Senior Quant
  // definition — see Methodology.
  const sorted = [...covered].sort((a, b) => a.atm_iv - b.atm_iv);
  const rankOf = new Map(sorted.map((r, i) => [r.ticker, sorted.length === 1 ? 50 : Math.round((i / (sorted.length - 1)) * 1000) / 10]));

  const rows = covered.map((r) => ({
    ticker: r.ticker, trade_date: scanDate, atm_iv: r.atm_iv, dte: r.dte, expiry: r.expiry,
    strike: r.strike, vol_rank: rankOf.get(r.ticker), fetched_at: nowIso,
  }));
  const w = await sb("lse_iv_daily?on_conflict=ticker,trade_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!w.ok) {
    const msg = `lse_iv_daily write HTTP ${w.status}: ${(await w.text()).slice(0, 200)}`;
    await stamp("lse_iv_scan", false, null, msg);
    throw new Error(msg);
  }
  await stamp("lse_iv_scan", true, scanDate, undefined, (covered.length / tickers.length) * 100);
  // The scan just exercised the SAME vendor endpoint + ATM extraction the
  // on-demand Portfolio Lab feed uses, green — an honest daily heartbeat for
  // lse_atm_iv too, so a quiet week without a Lab visit never false-reds its
  // chip (Joe 0.9: red is reserved for actual breakage). Lab views still
  // stamp it on their own real pulls.
  await stamp("lse_atm_iv", true, nowIso);

  // 2026-08-18 — the same heartbeat for lse_intraday, which is the OTHER
  // on-demand feed this function serves and was the one site left without one.
  // It is stamped only when somebody loads a page that asks for quotes, so
  // `last_good_at` recorded when a HUMAN last looked, not when a producer last
  // ran — and it was graded against a 3-hour SLA. Any quiet stretch of three
  // hours therefore put "1 feed stale · Live intraday price (1-minute bars)" in
  // the site header, which Joe's own page load then cleared before he could
  // refresh. Reproduced deterministically by serving the page a pipeline_health
  // row aged four hours: the pill reads red on the first load, green on the
  // second. Nothing was ever broken; the deadline was measuring quiet.
  //
  // The honest fix is a real pull, not a stamp: modeQuotes() only stamps when
  // it actually refreshed from the vendor (`refreshed > 0`), and stamps RED
  // with the vendor error when it could not — so routing one symbol through it
  // here makes the daily stamp a record of something that happened. Stamping
  // lse_intraday off the IV scan instead would be claiming a quotes pull this
  // batch never made (LESSONS 4.28 rule 4). One symbol, once a weekday, inside
  // a batch that is already talking to this vendor.
  //
  // Caught, never thrown: a quotes outage is real breakage and modeQuotes has
  // already stamped it red by the time we get here. It must not also discard a
  // completed IV scan. LESSONS 4.33 — the pattern for lse_atm_iv existed four
  // lines up and had simply never been applied to the second site.
  try {
    await modeQuotes(["SPY"]);
  } catch (e) {
    errors.push(`intraday heartbeat: ${String(e).slice(0, 160)}`);
  }
  return { scanDate, universe: tickers.length, covered: covered.length, errors: errors.slice(0, 5) };
}

/* ── entry ────────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: { mode?: string; symbols?: string[]; symbol?: string } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  try {
    let out: unknown;
    if (body.mode === "iv") out = await modeIv(body.symbol ?? "");
    else if (body.mode === "scan_iv") out = await modeScanIv();
    else out = await modeQuotes(body.symbols ?? []);
    return new Response(JSON.stringify(out), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers: cors });
  }
});
