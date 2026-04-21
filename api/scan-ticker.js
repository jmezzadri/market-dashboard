// On-demand single-ticker scan. Fires when a user adds a ticker to their
// watchlist — pops the modal alive with news/info/analyst/screener right
// away rather than making them wait for the next scheduled cron scan
// (3:30 PM EDT Mon-Fri).
//
// What this does NOT do
// ---------------------
// - Technicals: OHLCV math lives in the Python scanner (yfinance + pandas).
//   Porting that to Node is big scope for marginal value. The TECH subcomposite
//   stays blank until the next scheduled scan backfills technicals_json.
// - INS/CON/OPT/DP: those are market-wide feeds (not per-ticker), already
//   captured in the public artifact. If the ticker isn't in those feeds,
//   the subcomposites stay at 0/neutral — that's accurate, not missing data.
//
// What this DOES populate
// -----------------------
// - screener_json: price, marketcap, sector via /api/screener/stocks?ticker=X
// - composite_json.info: company profile via /api/stock/{ticker}/info
// - composite_json.news: ticker headlines via /api/news/headlines?ticker=X
// - composite_json.analyst_ratings: recent actions via /api/screener/analysts?ticker=X
//
// Warm cache: if ANY user already has a row for this ticker < 1h old, we
// copy it into the new user's row immediately (no UW calls). Scores don't
// vary by user — they're ticker-level facts — so this is safe.

import { createClient } from "@supabase/supabase-js";

const UW_BASE = "https://api.unusualwhales.com";
const UW_CLIENT_API_ID = process.env.UW_CLIENT_API_ID || "100001";
const WARM_TTL_MS = 60 * 60 * 1000; // 1 hour

function uwHeaders() {
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) throw new Error("UNUSUAL_WHALES_API_KEY not configured on server");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "UW-CLIENT-API-ID": UW_CLIENT_API_ID,
  };
}

async function uwGet(path, params = {}) {
  const url = new URL(UW_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: uwHeaders() });
  if (!r.ok) throw new Error(`UW ${path} → ${r.status}`);
  return r.json();
}

// -- Normalizers: match the shapes scanner/supabase_io.py writes so the
//    frontend merge logic in usePrivateScanSupplement.mergeInto works identically.

function normalizeInfo(raw) {
  let data = raw?.data;
  if (Array.isArray(data)) data = data[0];
  if (!data || typeof data !== "object") return null;
  let tags = data.uw_tags;
  if (typeof tags === "string") tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!Array.isArray(tags)) tags = [];
  return {
    sector: data.sector ?? null,
    tags,
    short_description: data.short_description ?? null,
    long_description: null, // yfinance-sourced in Python; skip here
    full_name: data.full_name || data.name || null,
    short_name: data.short_name ?? null,
    next_earnings_date: data.next_earnings_date ?? null,
    announce_time: data.announce_time ?? null,
    marketcap: data.marketcap ?? null,
    marketcap_size: data.marketcap_size ?? null,
    beta: data.beta ?? null,
    issue_type: data.issue_type ?? null,
    has_options: data.has_options ?? null,
    has_dividend: data.has_dividend ?? null,
    logo: data.logo ?? null,
  };
}

function normalizeNews(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((row) => {
      const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
      return {
        headline: row.headline ?? null,
        source: row.source ?? null,
        sentiment: row.sentiment ?? null,
        is_major: Boolean(row.is_major),
        created_at: row.created_at ?? null,
        tickers: row.tickers || [],
        tags: row.tags || [],
        description: row.description || meta.description || meta.summary || "",
        url: row.url || meta.url || meta.link || "",
      };
    });
}

function normalizeAnalyst(raw, sym) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  return rows
    .filter((r) => r && typeof r === "object")
    .filter((r) => {
      const t = String(r.ticker || "").toUpperCase();
      return !t || t === sym;
    })
    .map((row) => ({
      timestamp: row.timestamp ?? null,
      firm: row.firm ?? null,
      analyst_name: row.analyst_name ?? null,
      action: row.action ?? null,
      recommendation: row.recommendation ?? null,
      target: row.target ?? null,
    }));
}

function normalizeScreener(raw, sym) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  for (const row of rows) {
    if (String(row?.ticker || "").toUpperCase() === sym) return row;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Supabase env not configured" });
  }

  // Auth — verify the JWT that the browser sent so we can't be used as a
  // random-user data-write endpoint.
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ error: "Invalid session" });
  }
  const userId = userData.user.id;

  // Input
  const body = req.body || {};
  const rawTicker = String(body.ticker || "").trim().toUpperCase();
  const sym = rawTicker.replace(/[^A-Z0-9.\-]/g, "");
  if (!sym || sym.length > 10) {
    return res.status(400).json({ error: "Invalid ticker" });
  }

  try {
    // ─ Warm cache ──────────────────────────────────────────────────────────
    // See if any user has a recent row for this ticker. If yes, copy it —
    // no UW calls, ~100ms response time.
    const { data: warm } = await admin
      .from("user_scan_data")
      .select("technicals_json,screener_json,composite_json,scan_time")
      .eq("ticker", sym)
      .order("scan_time", { ascending: false })
      .limit(1);

    const warmRow = warm?.[0];
    const warmAge = warmRow?.scan_time
      ? Date.now() - new Date(warmRow.scan_time).getTime()
      : Infinity;
    const isWarm = warmRow && warmAge < WARM_TTL_MS;

    let payload;
    if (isWarm) {
      payload = {
        user_id: userId,
        ticker: sym,
        technicals_json: warmRow.technicals_json || null,
        screener_json: warmRow.screener_json || null,
        composite_json: warmRow.composite_json || null,
      };
    } else {
      // ─ Cold scan ────────────────────────────────────────────────────────
      // 4 UW calls in parallel. Each settles independently so one bad
      // endpoint doesn't nuke the whole scan.
      const [infoRes, newsRes, analystRes, screenerRes] = await Promise.allSettled([
        uwGet(`/api/stock/${encodeURIComponent(sym)}/info`),
        uwGet(`/api/news/headlines`, { ticker: sym, limit: 10 }),
        uwGet(`/api/screener/analysts`, { ticker: sym, limit: 10 }),
        uwGet(`/api/screener/stocks`, { ticker: sym, limit: 50, order_by: "relative_volume" }),
      ]);

      const info = infoRes.status === "fulfilled" ? normalizeInfo(infoRes.value) : null;
      const news = newsRes.status === "fulfilled" ? normalizeNews(newsRes.value) : [];
      const analyst_ratings =
        analystRes.status === "fulfilled" ? normalizeAnalyst(analystRes.value, sym) : [];
      const screener =
        screenerRes.status === "fulfilled" ? normalizeScreener(screenerRes.value, sym) : null;

      const composite =
        info || (news && news.length) || (analyst_ratings && analyst_ratings.length)
          ? { analyst_ratings, info, news }
          : null;

      payload = {
        user_id: userId,
        ticker: sym,
        // Skip technicals — next scheduled scan populates them. Don't null
        // out a previously-written value if upsert collides on PK.
        screener_json: screener,
        composite_json: composite,
      };
    }

    const { error: upErr } = await admin
      .from("user_scan_data")
      .upsert(payload, { onConflict: "user_id,ticker" });
    if (upErr) throw upErr;

    // ─ 35A/35B: backfill the user's `positions` rows for this ticker ─────
    // The scheduled Python scanner does this on its daily run. We replicate
    // here so a freshly-added / freshly-edited position doesn't show Port
    // Beta 0 / blank sector / cost-basis-driven %-of-wealth until the
    // next scheduled scan. Best-effort: errors here are logged but do not
    // fail the scan-ticker call (the user_scan_data row was already written,
    // which is the primary contract).
    try {
      const info = payload.composite_json?.info || null;
      const screener = payload.screener_json || null;
      const name =
        info?.full_name ||
        info?.short_name ||
        screener?.full_name ||
        screener?.name ||
        null;
      const sector = info?.sector || screener?.sector || null;
      const betaRaw = info?.beta != null ? Number(info.beta)
                      : screener?.beta != null ? Number(screener.beta) : null;
      const beta = Number.isFinite(betaRaw) ? betaRaw : null;
      // screener.price does not exist in UW's /screener response; the
      // live session close is the correct post-market reference price.
      // Fall-through order: explicit price → close → info.price → null.
      const priceRaw = screener?.price != null ? Number(screener.price)
                       : screener?.close != null ? Number(screener.close)
                       : info?.price != null ? Number(info.price) : null;
      const price = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;

      const { data: posRows } = await admin
        .from("positions")
        .select("id, shares")
        .eq("user_id", userId)
        .eq("ticker", sym);

      if (posRows && posRows.length) {
        const updates = posRows.map((row) => {
          const patch = {};
          if (name)   patch.name   = name;
          if (sector) patch.sector = sector;
          if (beta != null)  patch.beta  = beta;
          if (price != null) {
            patch.price = price;
            if (row.shares != null) patch.value = Number(row.shares) * price;
          }
          if (!Object.keys(patch).length) return Promise.resolve({ error: null });
          return admin.from("positions").update(patch).eq("id", row.id);
        });
        const results = await Promise.allSettled(updates);
        const firstErr = results.find((r) => r.status === "rejected" ||
          (r.status === "fulfilled" && r.value?.error));
        if (firstErr) {
          // eslint-disable-next-line no-console
          console.error("[scan-ticker] positions backfill partial failure:",
            firstErr.reason || firstErr.value?.error);
        }
      }
    } catch (backfillErr) {
      // eslint-disable-next-line no-console
      console.error("[scan-ticker] positions backfill threw:", backfillErr);
    }

    return res.status(200).json({
      ok: true,
      ticker: sym,
      warm: isWarm,
      has_info: !!payload.composite_json?.info,
      has_news: !!(payload.composite_json?.news?.length),
      has_analyst: !!(payload.composite_json?.analyst_ratings?.length),
      has_screener: !!payload.screener_json,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[scan-ticker] failed:", e);
    return res.status(500).json({ error: e.message || "scan failed" });
  }
}
