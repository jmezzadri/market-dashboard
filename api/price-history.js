// price-history — daily OHLCV for any ticker, served from Yahoo's public chart
// API. Used by the stock-modal historical chart (#14 / #15).
//
// Why Yahoo's public chart endpoint:
//   • Free — no auth required, same source yfinance wraps server-side
//   • Daily granularity, history goes back to ticker inception
//   • Stable for 10+ years; the response shape is documented and unchanged
//   • Single call per ticker × period — cheap to cache at the edge
//
// Request:
//   GET /api/price-history?ticker=AAPL&period=1y
//   GET /api/price-history?ticker=AAPL&from=2002-01-01&to=2005-12-31
//
//   ticker  — required, uppercase symbol
//   period  — one of: 1mo, 3mo, 6mo, ytd, 1y, 5y, max
//             Default: 1y
//   from    — ISO date (overrides period)
//   to      — ISO date (defaults to today; only used with from)
//
// Response:
//   {
//     ticker: "AAPL",
//     period: "1y" | null,
//     from:   "2025-04-27",
//     to:     "2026-04-27",
//     prices: [
//       { d: "2025-04-28", o:..., h:..., l:..., c:..., v:..., adj:... },
//       ...
//     ]
//   }
//
// Errors return JSON { error: "..." } with appropriate HTTP status.

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const PERIOD_TO_DAYS = {
  "1mo":  30,
  "3mo":  90,
  "6mo":  180,
  "ytd":  -1,   // computed against current year start
  "1y":   365,
  "5y":   1825,
  "max":  -2,   // anchor at 2002-01-01 per Joe's spec
};

function isoDate(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toEpochSec(dStr) {
  return Math.floor(new Date(dStr + "T00:00:00Z").getTime() / 1000);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ticker = String(req.query.ticker || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-^]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: "ticker required (1-10 chars, alphanum.-^)" });
  }

  const period = String(req.query.period || "1y").toLowerCase();
  const fromArg = req.query.from ? String(req.query.from) : null;
  const toArg   = req.query.to   ? String(req.query.to)   : null;

  // Resolve epoch range from inputs.
  const today = new Date();
  let p1, p2;
  if (fromArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    p1 = toEpochSec(fromArg);
    p2 = toArg ? toEpochSec(toArg) : Math.floor(today.getTime() / 1000);
  } else {
    const days = PERIOD_TO_DAYS[period];
    if (days === undefined) return res.status(400).json({ error: "invalid period" });
    if (days === -1) {
      // YTD
      p1 = toEpochSec(`${today.getUTCFullYear()}-01-01`);
    } else if (days === -2) {
      // Max — anchor at 2002-01-01 per Joe's spec
      p1 = toEpochSec("2002-01-01");
    } else {
      const start = new Date(today.getTime() - days * 86400 * 1000);
      p1 = Math.floor(start.getTime() / 1000);
    }
    p2 = Math.floor(today.getTime() / 1000);
  }
  if (p2 <= p1) return res.status(400).json({ error: "to must be after from" });

  // Yahoo Chart API. interval=1d for daily.
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}` +
              `?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`;

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MacroTiltBot/1.0)",
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `Yahoo chart ${r.status}` });
    }
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: `no data for ${ticker}` });

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const adj = result.indicators?.adjclose?.[0]?.adjclose || [];

    const prices = ts.map((tEpoch, i) => {
      const dt = new Date(tEpoch * 1000);
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const v = q.volume?.[i];
      const a = adj[i];
      // Skip rows where close is null (Yahoo sometimes includes empty rows).
      if (c == null) return null;
      return {
        d: isoDate(dt),
        o: o != null ? +Number(o).toFixed(4) : null,
        h: h != null ? +Number(h).toFixed(4) : null,
        l: l != null ? +Number(l).toFixed(4) : null,
        c: +Number(c).toFixed(4),
        v: v != null ? Number(v) : null,
        adj: a != null ? +Number(a).toFixed(4) : null,
      };
    }).filter(Boolean);

    // Cache aggressively at the edge — daily prices don't change intraday
    // for closed sessions. 1 hour during market hours, 24 hours otherwise.
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ticker,
      period: fromArg ? null : period,
      from: prices[0]?.d || null,
      to:   prices[prices.length - 1]?.d || null,
      prices,
    });
  } catch (e) {
    return res.status(502).json({ error: `fetch failed: ${e.message}` });
  }
}
