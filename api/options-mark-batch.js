// ============================================================================
// api/options-mark-batch.js — bug #1185
// ============================================================================
// Refreshes positions.price for every OPEN option position by pulling NBBO
// from Unusual Whales' per-contract historic endpoint, computing mark as
// midpoint of bid/ask, and writing it back.
//
// Why this exists
// ---------------
// Before this function, every option row on MacroTilt had a hand-typed
// CURRENT MARK / SHARE on the PositionEditor form. Options move every day;
// stale marks made unrealized P/L meaningless. UW exposes per-contract NBBO
// via /api/option-contract/{OCC}/historic — already paid for under the
// existing Massive tier; vendor cost impact = $0.
//
// What this does
// --------------
//   1. Query public.positions for every row where:
//        - asset_class = 'option'
//        - closed_at IS NULL
//        - ticker / strike / expiration / contract_type all present
//   2. For each, build the OCC symbol (e.g. LUNR260515C00035000) and call
//      GET https://api.unusualwhales.com/api/option-contract/{OCC}/historic?limit=1
//   3. Mark = (nbbo_bid + nbbo_ask) / 2 when both > 0;
//      fall back to last_price when NBBO is one-sided / missing.
//   4. UPDATE positions row with price = mark × multiplier (per-contract
//      storage convention per LESSONS rule 25) and manual_price = mark
//      (per-share), updated_at = now().
//   5. Returns summary { positions_seen, updated, failed, details: [...] }.
//
// Schedule
// --------
// Cron entries live in vercel.json:
//   - 16:30 ET intraday refresh (cron "30 16 * * 1-5", weekdays only)
//   - 20:30 UTC ≈ 16:30 ET post-close EDT refresh (cron "30 20 * * 1-5")
// Single cron run is idempotent so re-running on demand is safe.
//
// Auth
// ----
// Service-role Supabase client (SUPABASE_SERVICE_ROLE_KEY) so RLS is
// bypassed and every user's rows are refreshed in one pass. Function is
// reachable at /api/options-mark-batch but a SHARED_BATCH_TOKEN query
// param is required when CRON_SECRET is set — prevents a random visitor
// from kicking off N UW calls.
//
// Failure mode
// ------------
// Per-position try/catch so one bad OCC symbol or one transient 429 from
// UW doesn't take down the whole batch. Errors are accumulated into
// details[].error and reported in the response body. Re-running the
// function picks up where it left off (no checkpoint state required).
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const UW_BASE = "https://api.unusualwhales.com";
const UW_CLIENT_API_ID = process.env.UW_CLIENT_API_ID || "100001";

// ── helpers ──────────────────────────────────────────────────────────────

// Build OCC option symbol from position row.
//   ticker     LUNR
//   expiration 2026-05-15  -> 260515
//   type       call         -> C
//   strike     35.00        -> 035000 -> 00035000 (×1000, 8-digit zero-pad)
// Returns e.g. "LUNR260515C00035000".
function occSymbol(row) {
  const t = String(row.ticker || "").trim().toUpperCase();
  const exp = String(row.expiration || "").trim(); // "YYYY-MM-DD"
  const [y, m, d] = exp.split("-");
  if (!y || !m || !d) throw new Error(`bad expiration: ${exp}`);
  const yymmdd = y.slice(2) + m + d;
  const cp = String(row.contract_type || "").trim().toLowerCase().startsWith("p") ? "P" : "C";
  const strikeTimes1000 = Math.round(Number(row.strike) * 1000);
  if (!Number.isFinite(strikeTimes1000) || strikeTimes1000 <= 0) {
    throw new Error(`bad strike: ${row.strike}`);
  }
  const strikePadded = String(strikeTimes1000).padStart(8, "0");
  return `${t}${yymmdd}${cp}${strikePadded}`;
}

// Call UW with retry on 429 / 5xx. Mirrors the resilience pattern in
// api/scan-ticker.js so transient blips don't fail the whole batch.
async function uwGet(path, params = {}, { retries = 2 } = {}) {
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) throw new Error("UNUSUAL_WHALES_API_KEY not configured on server");
  const url = new URL(UW_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "UW-CLIENT-API-ID": UW_CLIENT_API_ID,
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url.toString(), { headers });
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        lastErr = new Error(`UW ${path} -> ${r.status}`);
        if (attempt < retries) {
          await new Promise((res) => setTimeout(res, 800 * Math.pow(2, attempt)));
          continue;
        }
        throw lastErr;
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`UW ${path} -> ${r.status} ${body.slice(0, 200)}`);
      }
      return r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, 800 * Math.pow(2, attempt)));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

// Mid = (bid + ask) / 2 when both sided. Fall back to last_price when NBBO
// is missing or one-sided. UW returns numbers as strings or numbers — coerce.
function computeMark(row) {
  const bid = Number(row?.nbbo_bid);
  const ask = Number(row?.nbbo_ask);
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
    return { mark: (bid + ask) / 2, source: "mid" };
  }
  const last = Number(row?.last_price);
  if (Number.isFinite(last) && last > 0) return { mark: last, source: "last" };
  return { mark: null, source: "none" };
}

// ── handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Lightweight access control. In prod we require a CRON_SECRET. Vercel
  // cron jobs auto-send `Authorization: Bearer <CRON_SECRET>` when the env
  // var is set on the project, so we accept that. Manual triggers can also
  // pass `x-cron-secret: <secret>` or `?token=<secret>`.
  const secret = process.env.CRON_SECRET || process.env.SHARED_BATCH_TOKEN;
  if (secret) {
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const sent = bearer || req.headers["x-cron-secret"] || (req.query && req.query.token);
    if (sent !== secret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Pull every open option row across all users. Service role bypasses RLS.
  const { data: rows, error: qErr } = await supabase
    .from("positions")
    .select("id, ticker, contract_type, strike, expiration, multiplier")
    .eq("asset_class", "option")
    .is("closed_at", null);
  if (qErr) {
    res.status(500).json({ error: "positions query failed", detail: qErr.message });
    return;
  }

  const details = [];
  let updated = 0;
  let failed = 0;

  for (const row of rows || []) {
    let occ;
    try {
      occ = occSymbol(row);
    } catch (e) {
      failed++;
      details.push({ position_id: row.id, ticker: row.ticker, error: `occ build: ${e.message}` });
      continue;
    }
    try {
      const json = await uwGet(`/api/option-contract/${encodeURIComponent(occ)}/historic`, { limit: 1 });
      // UW returns either an array or { data: [...] } depending on endpoint.
      const histRow = Array.isArray(json) ? json[0] : (json?.data?.[0] || json);
      const { mark, source } = computeMark(histRow);
      if (mark == null) {
        failed++;
        details.push({ position_id: row.id, ticker: row.ticker, occ, error: "no mark in UW response (bid/ask/last all blank)" });
        continue;
      }
      const mult = Number(row.multiplier) || 100;
      const perContract = mark * mult;
      const { error: uErr } = await supabase
        .from("positions")
        .update({
          price:        perContract,
          manual_price: mark,
          updated_at:   new Date().toISOString(),
        })
        .eq("id", row.id);
      if (uErr) {
        failed++;
        details.push({ position_id: row.id, ticker: row.ticker, occ, error: `update failed: ${uErr.message}` });
        continue;
      }
      // Recompute value column too (= quantity × price) so the position card
      // doesn't show a stale value. Supabase doesn't auto-recompute; we do it
      // in a second pass to avoid two write-amp on every refresh.
      const { data: full } = await supabase
        .from("positions")
        .select("quantity")
        .eq("id", row.id)
        .single();
      if (full && Number.isFinite(Number(full.quantity))) {
        await supabase
          .from("positions")
          .update({ value: Number(full.quantity) * perContract })
          .eq("id", row.id);
      }
      updated++;
      details.push({ position_id: row.id, ticker: row.ticker, occ, mark_per_share: mark, per_contract: perContract, source });
    } catch (e) {
      failed++;
      details.push({ position_id: row.id, ticker: row.ticker, occ, error: e.message });
    }
  }

  res.status(200).json({
    ok: failed === 0,
    positions_seen: (rows || []).length,
    updated,
    failed,
    details,
  });
}

export const config = {
  // 30 second max — even with 100 open option positions and 2 UW calls each
  // we should finish well under this. UW retry adds ~3s worst case per call.
  maxDuration: 30,
};
