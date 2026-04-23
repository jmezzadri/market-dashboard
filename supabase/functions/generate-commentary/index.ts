// generate-commentary — threshold-gated editorial blurbs for the Home
// Macro Overview and Sector Outlook tiles.
//
// Design rules
// ------------
// 1. Detect material moves first. If nothing is material, write NULL rows
//    and return — the UI will render nothing. We NEVER force narrative.
// 2. When a material move is detected, pull recent market headlines and
//    ask Claude to write ONE sentence tying the move to a specific
//    headline, OR return null if no clear link exists. The LLM is told
//    explicitly: null is a valid answer.
// 3. Output is capped to ~25 words per sentence. Anthropic is instructed
//    to keep blurbs terse and avoid AI-cliché phrasing.
// 4. If ANTHROPIC_API_KEY is not set, we still write rows — just with
//    everything NULL. The UI degrades cleanly to "no commentary".
//
// Invocation
// ----------
//   curl -X POST -H "Authorization: Bearer $TRIAGE_WEBHOOK_TOKEN" \
//        https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/generate-commentary
//
// Wire to pg_cron later (e.g. nightly 23:00 ET) via trigger-workflow +
// a GH Actions job, OR pg_net direct call.
//
// Thresholds
// ----------
//   short_term  — indicator SD z-score moved ≥ 1.0 over 1–5 trading days
//   medium_term — indicator SD z-score moved ≥ 1.5 over 20+ trading days
//   sector      — sector's absolute overall rank shifted ≥ 3 positions
//                 OR its score crossed 0.5 (neutral line)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY   = Deno.env.get("ANTHROPIC_API_KEY") || "";
const WH_TOKEN            = Deno.env.get("TRIAGE_WEBHOOK_TOKEN") || "";

// Hard thresholds — intentionally conservative so we never fill tiles
// with weak moves. Lowering these should be a deliberate, product
// decision, not drift.
const SHORT_TERM_SD       = 1.0;   // |Δ SD-score| over last 1–5 trading days
const MEDIUM_TERM_SD      = 1.5;   // |Δ SD-score| over last 20+ trading days
const SECTOR_RANK_JUMP    = 3;     // absolute rank positions

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Fetch indicator history ───────────────────────────────────────────
// Reads the public snapshot (same artifact the frontend consumes) so we
// don't need a separate DB table. The snapshot lives at /public/
// indicator_history.json relative to the Vercel-hosted frontend; we
// fetch it via the production URL.
async function fetchIndicatorHistory() {
  const url = "https://macrotilt.com/indicator_history.json";
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`indicator_history.json ${r.status}`);
  return await r.json();
}

// Normalize a raw indicator point to an SD-score using the snapshot's
// cached stats.mean / stats.sd. direction ∈ { "hw" (higher-worse),
// "hb" (higher-better) } — sign-flip so HIGHER score always means
// MORE STRESS. Mirrors the client-side sdScore().
function sdScore(value: number | null, stats: { mean: number; sd: number; direction?: string }): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const z = (value - stats.mean) / stats.sd;
  if (!Number.isFinite(z)) return null;
  return stats.direction === "hb" ? -z : z;
}

// Pick the nearest historical point to N trading days ago. Approximates
// trading days as calendar days * 7/5.
function historyValueAt(points: [string, number][], daysAgo: number): number | null {
  if (!Array.isArray(points) || !points.length) return null;
  const last = points[points.length - 1];
  const lastMs = new Date(String(last[0]) + "T00:00:00Z").getTime();
  if (!Number.isFinite(lastMs)) return null;
  const targetMs = lastMs - daysAgo * (7 / 5) * 24 * 3600 * 1000;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (let i = points.length - 1; i >= 0; i--) {
    const [ds, v] = points[i];
    if (v == null || !Number.isFinite(v)) continue;
    const ms = new Date(String(ds) + "T00:00:00Z").getTime();
    if (!Number.isFinite(ms)) continue;
    const d = Math.abs(ms - targetMs);
    if (d < bestDiff) { bestDiff = d; best = v as number; }
    if (ms < targetMs - 14 * 24 * 3600 * 1000) break;
  }
  return best;
}

// ── Detect material indicator moves ───────────────────────────────────
// Returns { short: best short-term move, medium: best medium-term move }
// where each is either { id, label, from, to, days, sdDelta } or null.
// We pick the single largest |sdDelta| move that clears the threshold.
interface MoveDetection {
  id: string;
  label: string;
  from: number;
  to: number;
  fromSD: number;
  toSD: number;
  days: number;
  sdDelta: number;
}
function detectMoves(hist: Record<string, any>): {
  short: MoveDetection | null;
  medium: MoveDetection | null;
} {
  const shortWindows = [1, 3, 5];
  const medWindows = [20, 40, 60];
  let bestShort: MoveDetection | null = null;
  let bestMed:   MoveDetection | null = null;
  for (const [id, entry] of Object.entries(hist)) {
    const pts = entry && (entry as any).points;
    const stats = entry && (entry as any).stats;
    const label = (entry as any)?.label || id;
    if (!Array.isArray(pts) || pts.length < 30 || !stats?.mean || !stats?.sd) continue;
    const now = pts[pts.length - 1];
    const nowVal = now?.[1];
    const nowSD = sdScore(nowVal, stats);
    if (nowSD == null) continue;

    for (const w of shortWindows) {
      const thenVal = historyValueAt(pts, w);
      const thenSD = sdScore(thenVal, stats);
      if (thenSD == null) continue;
      const delta = nowSD - thenSD;
      if (Math.abs(delta) >= SHORT_TERM_SD &&
          (!bestShort || Math.abs(delta) > Math.abs(bestShort.sdDelta))) {
        bestShort = { id, label, from: thenVal!, to: nowVal!, fromSD: thenSD, toSD: nowSD, days: w, sdDelta: delta };
      }
    }
    for (const w of medWindows) {
      const thenVal = historyValueAt(pts, w);
      const thenSD = sdScore(thenVal, stats);
      if (thenSD == null) continue;
      const delta = nowSD - thenSD;
      if (Math.abs(delta) >= MEDIUM_TERM_SD &&
          (!bestMed || Math.abs(delta) > Math.abs(bestMed.sdDelta))) {
        bestMed = { id, label, from: thenVal!, to: nowVal!, fromSD: thenSD, toSD: nowSD, days: w, sdDelta: delta };
      }
    }
  }
  return { short: bestShort, medium: bestMed };
}

// ── Fetch recent headlines ────────────────────────────────────────────
// Uses the frontend's scan-data artifact which already carries a
// ZeroHedge feed. Keeps the edge function's external dependencies
// minimal and avoids holding a second UW key here.
async function fetchRecentHeadlines(): Promise<Array<{ headline: string; source: string; published?: string }>> {
  try {
    const r = await fetch("https://macrotilt.com/latest_scan_data.json", { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    const zh = j?.signals?.market_news?.zerohedge_public || [];
    return zh.slice(0, 20).map((n: any) => ({
      headline: String(n.headline || "").slice(0, 200),
      source:   String(n.source   || "ZeroHedge"),
      published: n.published,
    })).filter((n: any) => n.headline);
  } catch {
    return [];
  }
}

// ── Call Claude to write ONE sentence tying move → headline ───────────
// Returns string or null. `null` is an explicit valid answer.
async function writeBlurb(
  move: MoveDetection,
  horizon: "short_term" | "medium_term",
  headlines: Array<{ headline: string; source: string }>,
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  if (!headlines.length) return null;
  const horizonLabel = horizon === "short_term" ? "short-term (1–5 trading days)" : "medium-term (20–60 trading days)";
  const direction = move.sdDelta > 0 ? "moved higher (more stress)" : "moved lower (less stress)";
  const headlineList = headlines.slice(0, 15).map((h, i) => `  ${i + 1}. ${h.headline}`).join("\n");
  const prompt = `You are a buy-side macro strategist writing a ${horizonLabel} observation for a hedge-fund PM.

A MATERIAL MOVE has been detected:
  - Indicator: ${move.label} (id=${move.id})
  - Direction: ${direction}
  - Change: from ${move.from} to ${move.to} over ${move.days} trading days
  - Z-score delta: ${move.sdDelta.toFixed(2)} SD

Here are the most recent market headlines:
${headlineList}

Write ONE sentence, ≤ 25 words, tying the move to ONE specific current event from the headlines above. Requirements:
  - Plain English. No AI clichés ("amidst", "in light of", "notably"). No hedging language.
  - Must reference a specific event named in the headlines, not a generic theme.
  - If NO headline credibly relates to this move, return the literal string: null
  - Do not explain, apologize, or preface. Output ONE sentence OR the word null. Nothing else.

Your response:`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 80,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = (j?.content?.[0]?.text || "").trim();
    if (!text || text.toLowerCase() === "null" || text.length < 10) return null;
    // Trim to ~400 chars for the DB constraint.
    return text.slice(0, 400);
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
serve(async (req) => {
  // Bearer-token gate — same shared secret used by the other triage
  // functions. Prevents random clients from burning Anthropic credits.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (WH_TOKEN && token !== WH_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const hist = await fetchIndicatorHistory();
  const moves = detectMoves(hist);
  const headlines = await fetchRecentHeadlines();

  let shortBlurb: string | null = null;
  let medBlurb:   string | null = null;
  let shortReason = "no_material_move";
  let medReason   = "no_material_move";
  if (moves.short) {
    shortReason = ANTHROPIC_API_KEY ? "llm_returned_null" : "no_anthropic_key";
    shortBlurb = await writeBlurb(moves.short, "short_term", headlines);
    if (shortBlurb) shortReason = "ok";
  }
  if (moves.medium) {
    medReason = ANTHROPIC_API_KEY ? "llm_returned_null" : "no_anthropic_key";
    medBlurb = await writeBlurb(moves.medium, "medium_term", headlines);
    if (medBlurb) medReason = "ok";
  }

  const macroRow = {
    generated_date: new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    short_term: shortBlurb,
    medium_term: medBlurb,
    short_term_reason: shortReason,
    medium_term_reason: medReason,
    evidence: {
      short: moves.short,
      medium: moves.medium,
      headline_count: headlines.length,
    },
  };

  // Upsert the daily row. `unique(generated_date)` ensures we overwrite
  // if the function is re-run on the same day.
  const { error: mErr } = await sb
    .from("macro_commentary")
    .upsert(macroRow, { onConflict: "generated_date" });
  if (mErr) return json({ error: "macro_write_failed", detail: mErr.message }, 500);

  // Sector commentary is TODO in this first-cut ship — null row so the
  // frontend renders nothing today. When sector rank history is wired
  // in (task 5 follow-on), extend below.
  const sectorRow = {
    generated_date: new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    headline: null,
    per_sector: null,
    reason: "sector_rank_history_not_wired",
    evidence: null,
  };
  const { error: sErr } = await sb
    .from("sector_commentary")
    .upsert(sectorRow, { onConflict: "generated_date" });
  if (sErr) return json({ error: "sector_write_failed", detail: sErr.message }, 500);

  return json({
    ok: true,
    anthropic_available: !!ANTHROPIC_API_KEY,
    headline_count: headlines.length,
    short_detected: !!moves.short,
    medium_detected: !!moves.medium,
    short_written: !!shortBlurb,
    medium_written: !!medBlurb,
    short_reason: shortReason,
    medium_reason: medReason,
  });
});
