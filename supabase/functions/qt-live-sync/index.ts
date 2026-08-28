// qt-live-sync — intraday mark + fill sync for the Quality Trend paper book.
//
// RETIRED 2026-08-28. Quality Trend was retired by Joe on 2026-08-26 and its
// pg_cron caller, `qt-live-sync-10min`, was unscheduled in
// supabase/migrations/20260828_retire_quality_trend.sql. Nothing calls this any
// more and nothing should: for two days after the retirement it kept writing
// $1,000,000 / zero-position snapshots for a replacement account that was
// funded and then cancelled, and /paper turned those into a published "0.00%
// since inception, +0.76% vs the S&P" for a book whose real record was -6.45%.
// The source is kept because the deployed function is kept (LESSONS: deployed
// source and committed source are one artifact) — do not re-schedule it.
//
// Why: the /paper page promised "updates every 60s" but its DATA only moved
// when someone manually dispatched the EOD workflow — Joe caught the page
// claiming a 9:47 AM mark at 10:53. This function runs on pg_cron every 10
// minutes during market hours and does exactly what the EOD job does: read
// the account, upsert today's qt_nav_daily row, sync fill states. READ-ONLY
// at the broker — it cannot submit, cancel or modify an order.
//
// Auth: Bearer <qt_sync_key> (vault + ops_secrets, the lse-shadow pattern)
// or the service-role key. Alpaca keys come from ops_secrets.
//
// SOURCE-OF-TRUTH NOTE (2026-08-26): this file did not exist in the repo until
// today. The function was live in production with no source in git, so the
// account_number bug below could not be found by reading the codebase — only
// by dumping the deployed function. Do not edit this in the dashboard; edit
// here and deploy, or the drift comes straight back.

import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SB_URL, SR_KEY);
const TRADE = "https://paper-api.alpaca.markets";
const DATA = "https://data.alpaca.markets";
const TERMINAL = ["filled", "canceled", "expired", "rejected", "dry_run"];

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  // AUTH (reworked 2026-08-26). This function is deployed with verify_jwt ON,
  // so Supabase's gateway rejects anything in Authorization that is not a valid
  // JWT before this code runs. The pg_cron job therefore sends the ANON key in
  // Authorization (satisfies the gateway, grants nothing on its own) and the
  // real shared secret in x-qt-sync-key, which is what is actually checked here.
  //
  // Why not just turn verify_jwt back off: the deploy path available to a cloud
  // session cannot set that flag, so a redeploy silently turns it back ON and
  // the cron 401s with nobody watching. That is precisely how this broke today.
  // Working WITH the flag makes the function survive any future redeploy.
  // Authorization is still accepted as a fallback for the service-role key and
  // for manual calls made before the cron was migrated.
  const authHeader = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const headerKey = req.headers.get("x-qt-sync-key") || "";
  const { data: sk } = await supabase.from("ops_secrets").select("value").eq("name", "qt_sync_key").maybeSingle();
  const shared = sk?.value || "";
  const ok = (shared && (headerKey === shared || authHeader === shared)) || authHeader === SR_KEY;
  if (!ok) return json({ error: "unauthorized" }, 401);

  const { data: keys } = await supabase.from("ops_secrets").select("name,value")
    .in("name", ["alpaca_paper_key_id", "alpaca_paper_secret"]);
  const kid = keys?.find((k) => k.name === "alpaca_paper_key_id")?.value;
  const sec = keys?.find((k) => k.name === "alpaca_paper_secret")?.value;
  if (!kid || !sec) return json({ error: "no alpaca keys in ops_secrets" }, 500);
  const H = { "APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec };

  try {
    // Market-hours guard: outside RTH the EOD workflow owns the close stamp.
    const body = await req.json().catch(() => ({}));
    const clock = await (await fetch(`${TRADE}/v2/clock`, { headers: H })).json();
    if (!clock.is_open && body?.force !== true) {
      return json({ ok: true, skipped: "market closed" });
    }

    const [acct, pos] = await Promise.all([
      (await fetch(`${TRADE}/v2/account`, { headers: H })).json(),
      (await fetch(`${TRADE}/v2/positions`, { headers: H })).json(),
    ]);

    // A snapshot with no account number is worse than no snapshot. The /paper
    // page keeps only rows matching the newest row's account_number so a paper
    // restart charts as its own book; when the newest row has NO account it
    // cannot filter, falls back to every row, and splices the retired book's
    // closing equity onto the new book's opening $1,000,000.
    //
    // That is exactly what happened on 2026-08-26. This function inserted the
    // day's first row (the EOD workflow had failed the night before, so no
    // stamped row existed) WITHOUT account_number, and /paper published a Day
    // P&L of +$64,463 / +6.89% on an account holding nothing at all —
    // $1,000,000 cash minus the deleted account's last equity of $935,537.
    // Refuse to write an unattributable row rather than publish a fiction.
    const accountNumber = acct?.account_number;
    if (!accountNumber) {
      return json({ ok: false, error: "alpaca returned no account_number — refusing to write an untagged snapshot" }, 502);
    }

    let spy: number | null = null;
    try {
      const r = await fetch(`${DATA}/v2/stocks/trades/latest?symbols=SPY&feed=delayed_sip`, { headers: H });
      if (r.ok) spy = Number((await r.json()).trades?.SPY?.p) || null;
    } catch (_) { /* fine */ }

    const today = new Date(clock.timestamp).toISOString().slice(0, 10);
    const row = {
      d: today,
      account_number: accountNumber,
      equity: Number(acct.equity),
      cash: Number(acct.cash),
      long_mv: Number(acct.long_market_value || 0),
      n_positions: Array.isArray(pos) ? pos.length : 0,
      spy_close: spy,
      positions: (Array.isArray(pos) ? pos : []).map((p: any) => ({
        symbol: p.symbol, qty: Number(p.qty), avg_entry: Number(p.avg_entry_price),
        price: Number(p.current_price || 0), mv: Number(p.market_value),
        upl: Number(p.unrealized_pl), uplpc: Number(p.unrealized_plpc || 0),
        upl_day: Number(p.unrealized_intraday_pl || 0), upl_day_pc: Number(p.unrealized_intraday_plpc || 0),
        chg_today: Number(p.change_today || 0),
      })),
      created_at: new Date().toISOString(),   // "marked at" — refreshed each sync
    };
    const { error: e1 } = await supabase.from("qt_nav_daily").upsert(row, { onConflict: "d" });
    if (e1) throw e1;

    // Fill sync for any non-terminal logged order.
    const { data: open } = await supabase.from("qt_orders")
      .select("id,client_order_id,status")
      .not("status", "in", `(${TERMINAL.join(",")})`);
    let synced = 0;
    for (const o of open || []) {
      if (!o.client_order_id) continue;
      const r = await fetch(`${TRADE}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(o.client_order_id)}`, { headers: H });
      if (!r.ok) continue;
      const j = await r.json();
      await supabase.from("qt_orders").update({
        alpaca_order_id: j.id, status: j.status,
        filled_qty: Number(j.filled_qty || 0),
        filled_avg_price: j.filled_avg_price ? Number(j.filled_avg_price) : null,
      }).eq("id", o.id);
      synced++;
    }

    return json({ ok: true, d: today, account: accountNumber, equity: row.equity, n_positions: row.n_positions, fills_synced: synced });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 400) }, 500);
  }
});
