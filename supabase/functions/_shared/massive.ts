// _shared/massive.ts
// Lightweight Massive (Polygon) REST client for Supabase Edge Functions.
//
// What it does
// ------------
//   - Reads MASSIVE_API_KEY from Edge Function env.
//   - Throttles to 5 requests/minute (Basic free tier).  Each call records
//     a timestamp; if 5 calls have occurred in the last 60s we block until
//     the oldest one ages out.
//   - Retries 429/5xx with exponential backoff (250ms → 1s → 4s, 3 tries).
//   - Returns parsed JSON or throws.
//
// Why Edge Function and not src/lib
// ---------------------------------
// The Massive API key is a server-side secret.  The frontend never talks
// to Massive directly — it queries Supabase tables that the ingest jobs
// populate.  Keeping the client here means the key never leaves the
// Supabase function runtime.

const BASE = "https://api.polygon.io";  // Massive uses Polygon's API surface.
const RATE_LIMIT_PER_MIN = 5;
const callTimestamps: number[] = [];

function getKey(): string {
  const k = Deno.env.get("MASSIVE_API_KEY");
  if (!k) throw new Error("MASSIVE_API_KEY not set in Edge Function secrets");
  return k;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  // Drop timestamps older than 60s.
  while (callTimestamps.length && now - callTimestamps[0] > 60_000) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_LIMIT_PER_MIN) {
    const waitMs = 60_000 - (now - callTimestamps[0]) + 250;  // small buffer
    console.log(`[massive] throttle: sleeping ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  callTimestamps.push(Date.now());
}

async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  await throttle();
  const r = await fetch(url);
  if (r.ok) return r;
  if ((r.status === 429 || r.status >= 500) && attempt < 3) {
    const backoff = 250 * Math.pow(4, attempt - 1);  // 250 → 1000 → 4000
    console.warn(`[massive] ${r.status} on ${url}, retry ${attempt}/3 in ${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchWithRetry(url, attempt + 1);
  }
  const body = await r.text();
  throw new Error(`Massive ${r.status} on ${url}: ${body.slice(0, 500)}`);
}

function withKey(path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${BASE}${path}`);
  u.searchParams.set("apiKey", getKey());
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// ─────────────────────────────────────────────────────────────────────────
// Endpoint wrappers
// ─────────────────────────────────────────────────────────────────────────

// Reference Tickers — full universe.  Paginated; we follow next_url until
// exhausted.  Returns the array of ticker rows.
//
// https://polygon.io/docs/rest/stocks/tickers
export async function listAllTickers(opts: {
  market?: string;     // "stocks" (default), "otc", "crypto", "fx", "indices"
  active?: boolean;    // default true
  limit?: number;      // page size, max 1000
} = {}): Promise<Array<Record<string, unknown>>> {
  const market = opts.market ?? "stocks";
  const active = opts.active ?? true;
  const limit = opts.limit ?? 1000;

  const all: Array<Record<string, unknown>> = [];
  let url: string | null = withKey(`/v3/reference/tickers`, {
    market, active: String(active), limit, order: "asc", sort: "ticker",
  });

  while (url) {
    const r = await fetchWithRetry(url);
    const j = await r.json();
    if (Array.isArray(j.results)) all.push(...j.results);
    // next_url returns the URL for the next page (without apiKey appended).
    url = j.next_url ? `${j.next_url}&apiKey=${getKey()}` : null;
  }
  return all;
}

// Daily Market Summary — OHLC for every US stock on a given trading date.
// One call returns the whole market.
//
// https://polygon.io/docs/rest/stocks/aggregates/daily-market-summary
export async function getDailyMarketSummary(
  date: string,  // "YYYY-MM-DD"
  opts: { adjusted?: boolean; includeOtc?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  const url = withKey(`/v2/aggs/grouped/locale/us/market/stocks/${date}`, {
    adjusted: String(opts.adjusted ?? true),
    include_otc: String(opts.includeOtc ?? false),
  });
  const r = await fetchWithRetry(url);
  const j = await r.json();
  return Array.isArray(j.results) ? j.results : [];
}

// Ticker Details — rich reference per ticker (description, branding, SIC).
// Used by Phase 3 backfill, throttled to fit the 5/min limit.
export async function getTickerDetails(
  ticker: string,
  date?: string,
): Promise<Record<string, unknown> | null> {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  const url = withKey(`/v3/reference/tickers/${encodeURIComponent(ticker)}`, params);
  const r = await fetchWithRetry(url);
  const j = await r.json();
  return j?.results ?? null;
}

// Dividends — paginated.
export async function listDividends(opts: {
  ticker?: string;
  ex_dividend_date_gte?: string;
  limit?: number;
} = {}): Promise<Array<Record<string, unknown>>> {
  const params: Record<string, string | number> = { limit: opts.limit ?? 1000 };
  if (opts.ticker) params.ticker = opts.ticker;
  if (opts.ex_dividend_date_gte) params["ex_dividend_date.gte"] = opts.ex_dividend_date_gte;
  const all: Array<Record<string, unknown>> = [];
  let url: string | null = withKey(`/v3/reference/dividends`, params);
  while (url) {
    const r = await fetchWithRetry(url);
    const j = await r.json();
    if (Array.isArray(j.results)) all.push(...j.results);
    url = j.next_url ? `${j.next_url}&apiKey=${getKey()}` : null;
  }
  return all;
}

// Splits — paginated.
export async function listSplits(opts: {
  ticker?: string;
  execution_date_gte?: string;
  limit?: number;
} = {}): Promise<Array<Record<string, unknown>>> {
  const params: Record<string, string | number> = { limit: opts.limit ?? 1000 };
  if (opts.ticker) params.ticker = opts.ticker;
  if (opts.execution_date_gte) params["execution_date.gte"] = opts.execution_date_gte;
  const all: Array<Record<string, unknown>> = [];
  let url: string | null = withKey(`/v3/reference/splits`, params);
  while (url) {
    const r = await fetchWithRetry(url);
    const j = await r.json();
    if (Array.isArray(j.results)) all.push(...j.results);
    url = j.next_url ? `${j.next_url}&apiKey=${getKey()}` : null;
  }
  return all;
}

// Smoke test — single Reference Tickers page, no pagination.  Used by
// Phase 1 UAT to confirm the API key is wired correctly without burning
// pagination calls.
export async function smokeTest(): Promise<{
  ok: boolean;
  status: number;
  count: number;
  sample: Array<Record<string, unknown>>;
  message?: string;
}> {
  try {
    const url = withKey(`/v3/reference/tickers`, {
      market: "stocks", active: "true", limit: 5,
    });
    const r = await fetch(url);
    const j = await r.json();
    return {
      ok: r.ok,
      status: r.status,
      count: Array.isArray(j.results) ? j.results.length : 0,
      sample: Array.isArray(j.results) ? j.results.slice(0, 3) : [],
      message: r.ok ? undefined : (j?.error ?? j?.message ?? "unknown error"),
    };
  } catch (e) {
    return { ok: false, status: 0, count: 0, sample: [], message: String(e) };
  }
}
