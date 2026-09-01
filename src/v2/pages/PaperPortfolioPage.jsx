/* PaperPortfolioPage — Quality Trend cockpit, in the site's own skin.

   v5 (2026-08-17, Joe: 'research a real hedge fund tear sheet'). v4 note: v3 hardcoded a dark terminal panel that ignored the
   site's theme system entirely — wrong in light mode, clashing in dark.
   This version is built ON the home-v12 cream system (cream-system.css):
   every surface and color is a v12 token (--putty, --ink, --gold-deep,
   --up/--down, --hair, --card-r, --sh), so the light/dark/navy toggle
   restyles this page exactly as it restyles Home and Macro.

   The page follows Home's surface HIERARCHY: putty cards throughout, ink
   reserved for exactly ONE card — the command band at the top, same as the
   Engine card on Home. That ink card IS the contrast tile; it doesn't need
   a foreign color scheme to stand out.

   Everything interactive from v3 is kept: 60s live polling with real mark
   timestamps, crosshair+tooltip charts with keyboard access, range pills,
   movers chips, sortable + drag-reorderable holdings with search, meters,
   plain-English Term tooltips. Series identity is never color-alone (end
   labels + legend + tooltip on every chart).

   Deploy stamp 2026-08-17T14:4x: Vercel promoted a stale queued build over
   the v4 commit; this line exists to force a fresh production build.

   Data (read-only, RLS public): qt_target_book, qt_orders, qt_nav_daily.
   Backtest constant BT is the validated run, verbatim (LESSONS 8.3). */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/* Monthly equity curve of the VALIDATED backtest run (Feb 2017 – Aug 2026),
   growth of $1,000,000. CAGR 21.2% vs 15.3%, Sharpe 0.97 vs 0.82. */
const BT = {"dates":["2017-02-28","2017-03-31","2017-04-28","2017-05-31","2017-06-30","2017-07-31","2017-08-31","2017-09-29","2017-10-31","2017-11-30","2017-12-29","2018-01-31","2018-02-28","2018-03-29","2018-04-30","2018-05-31","2018-06-29","2018-07-31","2018-08-31","2018-09-28","2018-10-31","2018-11-30","2018-12-31","2019-01-31","2019-02-28","2019-03-29","2019-04-30","2019-05-31","2019-06-28","2019-07-31","2019-08-30","2019-09-30","2019-10-31","2019-11-29","2019-12-31","2020-01-31","2020-02-28","2020-03-31","2020-04-30","2020-05-29","2020-06-30","2020-07-31","2020-08-31","2020-09-30","2020-10-30","2020-11-30","2020-12-31","2021-01-29","2021-02-26","2021-03-31","2021-04-30","2021-05-28","2021-06-30","2021-07-30","2021-08-31","2021-09-30","2021-10-29","2021-11-30","2021-12-31","2022-01-31","2022-02-28","2022-03-31","2022-04-29","2022-05-31","2022-06-30","2022-07-29","2022-08-31","2022-09-30","2022-10-31","2022-11-30","2022-12-30","2023-01-31","2023-02-28","2023-03-31","2023-04-28","2023-05-31","2023-06-30","2023-07-31","2023-08-31","2023-09-29","2023-10-31","2023-11-30","2023-12-29","2024-01-31","2024-02-29","2024-03-28","2024-04-30","2024-05-31","2024-06-28","2024-07-31","2024-08-30","2024-09-30","2024-10-31","2024-11-29","2024-12-31","2025-01-31","2025-02-28","2025-03-31","2025-04-30","2025-05-30","2025-06-30","2025-07-31","2025-08-29","2025-09-30","2025-10-31","2025-11-28","2025-12-31","2026-01-30","2026-02-27","2026-03-31","2026-04-30","2026-05-29","2026-06-30","2026-07-31","2026-08-11"],
"strategy":[1047946,1058227,1068817,1093401,1103635,1123706,1128257,1163338,1199620,1244937,1274535,1354769,1298973,1300723,1291317,1329842,1341976,1352391,1416992,1417318,1289902,1298108,1275438,1361427,1416742,1418202,1481942,1394186,1489759,1518507,1481818,1470529,1502141,1552170,1609670,1618294,1500984,1355677,1543931,1610441,1614739,1697374,1801709,1731618,1721270,1971968,2009068,2006269,2043059,2130276,2258599,2262609,2275137,2280019,2352481,2276415,2419475,2402180,2577995,2437347,2408111,2521315,2400162,2404882,2205161,2378138,2313928,2224302,2338522,2426733,2404847,2545785,2481712,2417020,2411559,2394297,2537891,2612778,2551311,2503818,2434777,2597260,2790924,2848275,2966328,3070764,3110807,3200586,3210232,3277889,3336392,3357575,3459736,3708506,3711512,3703630,3660797,3448310,3336794,3510022,3629421,3760979,3844166,3844696,3922764,4097867,4098688,4271617,4416322,4820595,5104506,5586060,6039621,6117068,6331646],
"spx":[1039300,1040556,1050923,1065729,1072430,1094487,1097756,1119936,1146336,1181330,1194642,1262172,1216629,1183872,1189631,1218327,1225220,1270888,1310997,1318444,1228776,1251534,1136978,1228287,1267844,1290936,1343699,1258094,1345756,1365468,1343353,1367880,1397407,1447990,1489728,1489572,1367016,1197166,1350303,1414595,1440815,1525838,1636022,1573988,1533158,1700975,1763333,1745231,1793870,1872099,1972166,1985117,2028923,2077107,2141577,2041717,2185295,2168073,2264977,2146189,2085664,2163430,1974821,1978859,1815326,1982314,1902148,1730212,1870376,1972564,1856706,1973408,1922764,1993901,2025222,2034201,2168066,2237989,2201512,2098300,2054001,2241558,2343320,2382953,2508926,2589711,2481077,2603638,2689991,2721687,2779668,2837726,2839168,3006218,2916904,2996690,2837661,2828379,2811175,2988518,3141918,3210531,3277500,3222235,3311169,3332163,3402804,3499466,3419522,3554988,3401962,3612321,3833676,3757891,3915646],
"years":{"2017":{"strategy":32.2,"spx":19.6},"2018":{"strategy":0.1,"spx":-5.0},"2019":{"strategy":26.2,"spx":31.1},"2020":{"strategy":24.8,"spx":18.5},"2021":{"strategy":28.3,"spx":28.6},"2022":{"strategy":-6.7,"spx":-18.2},"2023":{"strategy":28.0,"spx":26.2},"2024":{"strategy":32.9,"spx":24.9},"2025":{"strategy":10.4,"spx":17.7},"2026":{"strategy":35.2,"spx":13.6}}};

const BT_STATS = { cagr: '21.2%', vol: '19.1%', sharpe: '0.97', sortino: '1.57', maxdd: '−19.3%', ir: '0.58', worst: '−6.7%' };
const BT_SPX   = { cagr: '15.3%', vol: '15.6%', sharpe: '0.82', sortino: '1.18', maxdd: '−23.9%', worst: '−18.2%' };

// [2026-09-01] SPY_INCEPTION is RETIRED as the benchmark baseline. It froze
// the Aug 17 book's start into a constant, so the moment a NEW account's rows
// became the displayed epoch, every "vs S&P" figure would have been measured
// from the wrong day — the relaunched book would have inherited two weeks of
// benchmark drift on day one. The baseline is now the first S&P close INSIDE
// the displayed epoch (see spx0 where stats are computed), so it re-bases
// itself whenever the account-selection logic switches books. The constant
// remains only as documentation of the old book's baseline.
// Book inception = Mon Aug 17 2026. Benchmark baseline is SPY's LAST CLOSE
// before launch (Fri Aug 15 = 776.34). The since-inception S&P return is
// always measured against THIS fixed price, never nav[0].spy_close — with one
// nav row that self-reference makes S&P read 0.00%, which is what Joe caught.
const SPY_INCEPTION = 776.34;

/* ── Quality Trend is RETIRED (Joe, 2026-08-26) ────────────────────────
   Superseded by paper_portfolio/TACTICAL_BOOK_SPEC.md, which is design-only:
   nothing trades on this book and nothing will. Everything on this page is
   the CLOSED record of the one account that ever held stock — PA3G9FV5AN1G,
   Aug 17 to Aug 25 2026, $1,000,000 -> $935,536.63.

   Why this page published "live · 0.00% since inception · +0.76% vs S&P" on
   2026-08-28: a replacement account was funded to $1,000,000 on 8/26 for a
   relaunch that was then cancelled, and qt-live-sync kept snapshotting it
   every ten minutes. The epoch filter below took the NEWEST account, so an
   account that never held a share became "the book" — and the hardcoded
   Aug-17 inception with its Aug-15 SPY baseline got printed over it,
   publishing an outperformance that never happened. LESSONS 4.53(b) called
   this exact failure five days before it shipped.

   The fix is data-keyed, never date-keyed (4.53 rule 4): the book shown is
   the newest epoch that actually HELD something. An account that never held
   a position is not a book, whatever its account number is. */
const RETIRED_ON = 'August 26, 2026';
// Emphasis colour inside the retired notice — the live-cash sentence must not
// read as body text; it is the first thing a confused reader needs.
const CREAM_INK = '#14161a';

/* ── v12 tokens (cream-system.css) — the theme toggle swaps these ─────── */
const CARD   = 'var(--putty)';
const CARD2  = 'var(--bg2)';
const EDGE   = 'var(--hair)';
const HAIR   = 'var(--hair)';
const INK    = 'var(--ink)';
const INK2   = 'var(--ink-soft)';
const INK3   = 'var(--mut)';
const GOLD   = 'var(--gold-deep)';   // strategy series — gold in both themes
const BLUE   = 'var(--ink-soft)';    // benchmark series — slate/warm-gray
const GOOD   = 'var(--up)';
const GOODBR = 'var(--up)';
const BAD    = 'var(--down)';
const BADBR  = 'var(--down)';
const WARN   = 'var(--gold-deep)';
const INKCARD = 'var(--card-ink)';   // the ONE ink card (command band)
const CREAM  = 'var(--cream-text)';

const fmtUsd = (v, dp = 0) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
const fmtSignedUsd = (v) =>
  v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtPct = (v, dp = 1) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${v > 0 ? '+' : ''}${(Number(v) * 100).toFixed(dp)}%`;
const fmtPctPlain = (v, dp = 1) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${(Number(v) * 100).toFixed(dp)}%`;
const fmtDate = (d) => d ? new Date(`${String(d).slice(0, 10)}T12:00:00`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtTimeET = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US',
  { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
/* The ET CALENDAR DAY of an instant. The page's own header already knows which
   session it is ("Friday, August 21 · Market pre-open"); before this existed the
   stat tiles did not, so between the 4pm close and the next session's first mark
   — ~17.7h every weekday and the whole weekend — the tile rendered the PREVIOUS
   session's move under the word "today". LESSONS 4.43 (a stale % is a lie the
   moment it renders without its session) and 4.41 rule 6 (one clock, one
   reader). en-CA gives YYYY-MM-DD, which is directly comparable. */
const etDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fmtDayET = (iso) => iso ? new Date(iso).toLocaleDateString('en-US',
  { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }) : '';
const upDown = (v) => (v == null ? INK : v >= 0 ? GOODBR : BADBR);

/* ── plain-English explanations (tooltips + the visible legend) ───────── */
const TIPS = {
  rank: 'Position in the strategy’s ranking at the last monthly scoring. 1 = highest-scoring name in the book.',
  weight: 'This position’s share of the whole portfolio today. Every name targets 2.5% — one fortieth.',
  value: 'What the position is worth at the latest mark.',
  cost: 'Average price actually paid at the broker, from the official fill records.',
  last: 'Latest price from the broker’s most recent snapshot.',
  pnl: 'Profit or loss since purchase — dollars, and percent of what was paid.',
  trend1y: 'How much the stock rose over the past 12 months, skipping the most recent month (recent-month moves tend to reverse). The strategy buys established winners.',
  profitability: 'Gross profit divided by total assets, from the company’s latest SEC filing — how much profit the business earns on everything it owns. Above ~0.35 is strong; 1.0+ is exceptional.',
  buybacks: 'How much the share count shrank over the past year. Positive = the company bought back its own stock; negative = it diluted holders.',
  insider: 'Score for recent open-market purchases by the company’s own executives and board members, weighted by size relative to what they already owned — a doubled stake is conviction, a 2% top-up is noise. A dot means none.',
  sharpe: 'Return earned per unit of risk taken, above what cash pays. Rule of thumb: 0.5 is decent, 1.0 is very good.',
  sortino: 'Like Sharpe, but only counts DOWNSIDE swings as risk — upside volatility isn’t penalized.',
  vol: 'How much returns swing, annualized. The S&P 500 runs ~15–16% in a normal year.',
  maxdd: 'The worst peak-to-trough decline — the most an investor who bought the top would have been down.',
  beta: 'How much the book moves when the market moves. 1.0 = with the market; 0.5 = half as much.',
  te: 'How differently the book behaves from the S&P 500, annualized. Higher = more independent of the index.',
  ir: 'Excess return over the S&P 500 per unit of that difference — the benchmark-relative Sharpe.',
  ddpeak: 'How far the account sits below its own all-time high right now. 0% = at the high.',
  medvol: 'The middle holding’s price volatility at selection. The strategy caps this at 70% per name.',
  worst: 'The single worst calendar year in the period.',
  gross: 'Total market exposure as a share of equity. This book is long-only with no leverage, so gross and net are the same number.',
  contrib: 'How much this position moved the WHOLE portfolio, in basis points of equity (1bp = 0.01%). A 2.5% position up 4% contributes ~10bp.',
  dtl: 'Days to exit the position trading 20% of the stock’s average daily dollar volume — the standard liquidity yardstick. Under 0.1 = can be sold in minutes.',
  mcap: 'Total market value of the company’s shares. Mega ≥ $200B · Large $10–200B · Mid $2–10B · Small < $2B.',
  sector: 'GICS sector (top line) and GICS industry — the 74-industry level below sector — for each holding.',
};

const HCOLS = [
  { key: 'rank', label: '#', tip: TIPS.rank, align: 'left' },
  { key: 'company', label: 'Company', tip: null, align: 'left' },
  { key: 'weight', label: 'Weight', tip: TIPS.weight },
  { key: 'value', label: 'Value', tip: TIPS.value },
  { key: 'cost', label: 'Avg cost', tip: TIPS.cost },
  { key: 'last', label: 'Last', tip: TIPS.last },
  { key: 'pnl', label: 'P&L', tip: TIPS.pnl },
  { key: 'sector', label: 'Sector / industry', tip: TIPS.sector, align: 'left' },
  { key: 'trend1y', label: '1-yr trend', tip: TIPS.trend1y },
  { key: 'profitability', label: 'Profitability', tip: TIPS.profitability },
  { key: 'buybacks', label: 'Buybacks', tip: TIPS.buybacks },
  { key: 'insider', label: 'Insider buying', tip: TIPS.insider },
];

/* ── injected CSS: hover states + animations (inline styles can't) ────── */
const CSS = `
.paper-v12 .qtt * { box-sizing: border-box; }
.paper-v12 .qtt-card { transition: transform .35s, background .5s; }
.paper-v12 .qtt-card:hover { transform: translateY(-2px); }
.paper-v12 .qtt-tile { transition: transform .25s ease, background .5s; }
.paper-v12 .qtt-tile:hover { transform: translateY(-2px); }
.paper-v12 .qtt-row { transition: background .12s ease; }
.paper-v12 .qtt-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.paper-v12 .qtt-pill { transition: background .12s ease, color .12s ease; cursor: pointer; border: 1px solid var(--hair); background: transparent; color: var(--ink-soft); border-radius: 999px; padding: 3px 12px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; font-family: var(--sans); }
.paper-v12 .qtt-pill:hover { color: var(--ink); }
.paper-v12 .qtt-pill.on { background: color-mix(in srgb, var(--gold-deep) 16%, transparent); border-color: var(--gold-deep); color: var(--gold-deep); }
.paper-v12 .qtt-search { background: var(--bg2); border: 1px solid var(--hair); border-radius: 10px; color: var(--ink); padding: 6px 12px; font-size: 13px; width: 190px; outline: none; font-family: var(--sans); }
.paper-v12 .qtt-search:focus { border-color: var(--gold-deep); }
.paper-v12 .qtt-search::placeholder { color: var(--mut); }
.paper-v12 .qtt-secgrid { columns: 250px; column-gap: 18px; }
.paper-v12 .qtt-sectile { break-inside: avoid; -webkit-column-break-inside: avoid; background: var(--bg2); border-radius: 14px; padding: 13px 15px; margin: 0 0 16px; }
`;

/* ── small primitives ─────────────────────────────────────────────────── */
function Term({ children, tip, placement = 'top', alignRight = false, labelOpacity = 1 }) {
  const [open, setOpen] = useState(false);
  const pos = placement === 'bottom' ? { top: '145%' } : { bottom: '135%' };
  const side = alignRight ? { right: 0 } : { left: 0 };
  return (
    <span tabIndex={0} style={{ position: 'relative', cursor: 'help', outline: 'none' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span style={{ borderBottom: `1px dotted ${INK3}`, opacity: labelOpacity }}>{children}</span>
      {open && (
        <span style={{
          position: 'absolute', ...pos, ...side, zIndex: 40, background: CARD2,
          border: `1px solid ${EDGE}`, borderRadius: 10, padding: '9px 12px',
          width: 250, whiteSpace: 'normal', boxShadow: 'var(--sh)',
          fontSize: 12, lineHeight: 1.55, fontWeight: 400, letterSpacing: 0,
          textTransform: 'none', color: INK,
        }}>{tip}</span>
      )}
    </span>
  );
}

function Card({ title, right, children, style, className }) {
  return (
    <div className={`qtt-card ${className || ''}`} style={{ background: CARD, borderRadius: 28, padding: '26px 30px', ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK3 }}>{title}</div>
          {right ? <div style={{ fontSize: 12.5, color: INK3 }}>{right}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}
function Meter({ frac, color = BLUE }) {
  return (
    <div style={{ height: 5, borderRadius: 999, background: 'color-mix(in srgb, var(--ink) 12%, transparent)', overflow: 'hidden', marginTop: 9 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, frac * 100))}%`, height: '100%', background: color, borderRadius: 999 }} />
    </div>
  );
}

/* ── interactive chart (crosshair + tooltip + keyboard) ───────────────── */
function LineChart({ series, dates, height = 250, log = false, yFmt }) {
  const [hov, setHov] = useState(null);
  const wrapRef = useRef(null);
  const W = 1000, H = height, padL = 8, padR = 74, padT = 12, padB = 26;
  const all = series.flatMap((s) => s.values).filter((v) => v > 0);
  if (!all.length) return null;
  const t = (v) => (log ? Math.log(v) : v);
  const lo = Math.min(...all.map(t)), hi = Math.max(...all.map(t));
  const n = series[0].values.length;
  const x = (i) => padL + (i / Math.max(n - 1, 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (t(v) - lo) / Math.max(hi - lo, 1e-9)) * (H - padT - padB);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const gridVals = [0.25, 0.5, 0.75].map((f) => (log ? Math.exp(lo + f * (hi - lo)) : lo + f * (hi - lo)));
  const fmt = yFmt || ((v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000).toLocaleString()}k`));
  const endYs = series.map((s) => y(s.values[s.values.length - 1]));
  const dateLbl = (i) => (dates && dates[i]
    ? new Date(`${String(dates[i]).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', ...(n < 60 ? { day: 'numeric' } : {}) })
    : '');
  const xTicks = n > 1 ? [0, Math.floor(n / 2), n - 1] : [0];
  const idxFromEvent = (e) => {
    const el = wrapRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1))));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') { setHov((h) => Math.max(0, (h ?? n - 1) - 1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setHov((h) => Math.min(n - 1, (h ?? 0) + 1)); e.preventDefault(); }
    if (e.key === 'Escape') setHov(null);
  };
  const tipLeftPct = hov != null ? (x(hov) / W) * 100 : 0;
  const flip = tipLeftPct > 62;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} tabIndex={0} role="application"
      aria-label="Performance chart — arrow keys move the readout"
      onKeyDown={onKey} onPointerMove={(e) => setHov(idxFromEvent(e))}
      onPointerLeave={() => setHov(null)} onBlur={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="performance chart">
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke={HAIR} />
            {endYs.every((ey) => Math.abs(y(gv) - ey) > 16) ? (
              <text x={W - padR + 6} y={y(gv) + 4} fontSize="12" fill={INK3}>{fmt(gv)}</text>
            ) : null}
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize="11.5" fill={INK3}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dateLbl(i)}</text>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity || 1} />
        ))}
        {series.map((s) => (
          <text key={`${s.name}-end`} x={W - padR + 6} y={y(s.values[s.values.length - 1]) + 4} fontSize="12.5" fontWeight="600" fill={s.color}>
            {fmt(s.values[s.values.length - 1])}
          </text>
        ))}
        {hov != null && (
          <g>
            <line x1={x(hov)} x2={x(hov)} y1={padT} y2={H - padB} stroke="var(--mut)" strokeWidth="1" opacity="0.7" />
            {series.map((s) => (
              <circle key={`${s.name}-dot`} cx={x(hov)} cy={y(s.values[hov])} r="4" fill={s.color} stroke={CARD} strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hov != null && (
        <div style={{
          position: 'absolute', top: 6,
          left: flip ? undefined : `calc(${tipLeftPct}% + 12px)`,
          right: flip ? `calc(${100 - tipLeftPct}% + 12px)` : undefined,
          background: CARD2, border: `1px solid ${EDGE}`, borderRadius: 10,
          padding: '8px 11px', pointerEvents: 'none', boxShadow: 'var(--sh)',
          fontSize: 12.5, whiteSpace: 'nowrap', zIndex: 5, color: INK,
        }}>
          <div style={{ color: INK3, marginBottom: 4 }}>{dateLbl(hov)}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '1px 0' }}>
              <span style={{ width: 12, height: 2.5, background: s.color, borderRadius: 2, flex: 'none' }} />
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.values[hov])}</span>
              <span style={{ color: INK3 }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function ChartLegend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
      {items.map(([name, color]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: INK2 }}>
          <span style={{ width: 16, height: 3, background: color, borderRadius: 2, display: 'inline-block' }} />{name}
        </div>
      ))}
    </div>
  );
}

/* ── live stats from qt_nav_daily ─────────────────────────────────────── */
function liveStats(nav) {
  if (!nav || nav.length < 1) return null;
  const eq = nav.map((r) => Number(r.equity));
  const spx = nav.map((r) => (r.spy_close == null ? null : Number(r.spy_close)));
  const ret = [], sret = [];
  for (let i = 1; i < eq.length; i++) {
    ret.push(eq[i] / eq[i - 1] - 1);
    sret.push(spx[i] != null && spx[i - 1] != null ? spx[i] / spx[i - 1] - 1 : null);
  }
  const n = ret.length;
  let peak = 1_000_000, mdd = 0;
  eq.forEach((v) => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
  const last = eq[eq.length - 1];
  const prev = eq.length >= 2 ? eq[eq.length - 2] : 1_000_000;   // day 1: vs inception
  // True intraday day-P&L when the broker marks carry it (upl_day per position)
  const lastPos = nav[nav.length - 1]?.positions || [];
  const dayFromMarks = lastPos.length && lastPos.some((p) => p.upl_day != null)
    ? lastPos.reduce((t, p) => t + Number(p.upl_day || 0), 0) : null;
  const out = {
    n,
    since: last / 1_000_000 - 1,
    sinceUsd: last - 1_000_000,
    spxSince: (() => { const nz = spx.filter((v) => v != null); return nz.length >= 2 ? nz[nz.length - 1] / nz[0] - 1 : null; })(),
    day: dayFromMarks ?? (last - prev),
    dayPct: (dayFromMarks ?? (last - prev)) / (prev || 1_000_000),
    bestDay: n >= 2 ? Math.max(...ret) : null,
    worstDay: n >= 2 ? Math.min(...ret) : null,
    pctUp: n >= 2 ? ret.filter((r) => r > 0).length / n : null,
    ddFromPeak: last / peak - 1,
    maxdd: mdd,
    vol: null, beta: null, te: null, sharpe: null,
  };
  if (n >= 20) {
    out.vol = sd(ret) * Math.sqrt(252);
    const pairs = ret.map((r, i) => [r, sret[i]]).filter(([, s]) => s != null);
    if (pairs.length >= 20) {
      const a = pairs.map((p) => p[0]), b = pairs.map((p) => p[1]);
      const ma = mean(a), mb = mean(b);
      const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
      const vb = sd(b) ** 2;
      out.beta = vb > 0 ? cov / vb : null;
      out.te = sd(a.map((v, i) => v - b[i])) * Math.sqrt(252);
    }
  }
  if (n >= 60) {
    const rf = 0.04 / 252;
    out.sharpe = (mean(ret) - rf) / sd(ret) * Math.sqrt(252);
  }
  return out;
}

const th = { textAlign: 'right', padding: '9px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td = { textAlign: 'right', padding: '10px 10px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/* ══════════════════════════════════════════════════════════════════════ */
export default function PaperPortfolioPage({ onOpenTicker }) {
  const [book, setBook] = useState(null);
  const [orders, setOrders] = useState({});
  const [nav, setNav] = useState(null);
  const [brake, setBrake] = useState(null);   // latest qt_brake_state row (live book only)
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState(1);
  const [colOrder, setColOrder] = useState(HCOLS.map((c) => c.key));
  const [query, setQuery] = useState('');
  const [btRange, setBtRange] = useState('All');
  const [openSectors, setOpenSectors] = useState(null); // null = default (top sector open)

  const load = useCallback(async () => {
    try {
      const { data: latest, error: e1 } = await supabase
        .from('qt_target_book').select('rebalance_date')
        .order('rebalance_date', { ascending: false }).limit(1);
      if (e1) throw e1;
      const rd = latest?.[0]?.rebalance_date;
      const [bk, od, nv, brk] = await Promise.all([
        rd ? supabase.from('qt_target_book').select('*').eq('rebalance_date', rd).order('rank') : { data: [] },
        rd ? supabase.from('qt_orders').select('symbol,side,qty,status,filled_qty,filled_avg_price,time_in_force')
          .eq('rebalance_date', rd).neq('status', 'dry_run') : { data: [] },
        supabase.from('qt_nav_daily').select('d,equity,cash,long_mv,n_positions,spy_close,positions,created_at,account_number').order('d'),
        supabase.from('qt_brake_state').select('d,composite,stress_on').order('d', { ascending: false }).limit(1),
      ]);
      if (bk.error) throw bk.error;
      setBook(bk.data || []);
      // Several order rows can exist per symbol (an expired opening order plus
      // the day order that actually filled) — a FILLED row always wins.
      const om = {};
      (od.data || []).forEach((o) => {
        if (!om[o.symbol] || (o.status === 'filled' && om[o.symbol].status !== 'filled')) om[o.symbol] = o;
      });
      setOrders(om);
      setBrake(brk?.data?.[0] ?? null);
      // Show ONE book. qt_nav_daily keeps every epoch, but a paper account
      // restart (new account, funded back to $1,000,000) is a new book, not a
      // continuation: charting across the boundary would splice the retired
      // book's closing equity onto the new book's opening $1M and draw a jump
      // that never happened. Keep only rows from the most recent account.
      const navRows = nv.data || [];
      // 2026-08-28: pick the newest account that ACTUALLY HELD SOMETHING, not
      // simply the newest account. A funded-but-never-traded account produces
      // perfectly valid $1,000,000 / 0-position rows, and taking those as "the
      // book" is what made this page report a flat return and a positive
      // benchmark spread for a strategy that had been retired two days earlier.
      const heldAccounts = new Set(
        navRows.filter((r) => Number(r.n_positions) > 0).map((r) => r.account_number),
      );
      const tradedRows = navRows.filter((r) => heldAccounts.has(r.account_number));
      const srcRows = tradedRows.length ? tradedRows : navRows;
      const liveAccount = srcRows.length
        ? srcRows[srcRows.length - 1].account_number
        : null;
      // FAIL SAFE on an untagged newest row (2026-08-26). The old fallback
      // showed EVERY row when the newest one had no account_number, which is
      // the one case where splicing is guaranteed wrong — an untagged row is
      // almost always a fresh account whose writer forgot to stamp it. On
      // 2026-08-26 qt-live-sync inserted exactly such a row and this page
      // published a Day P&L of +$64,463 / +6.89% on an account holding
      // nothing: the new book's $1,000,000 cash minus the deleted book's last
      // equity of $935,537. Showing one lonely row is a cosmetic loss; showing
      // a return that never happened is not. Never fall back to unfiltered.
      setNav(liveAccount
        ? srcRows.filter((r) => r.account_number === liveAccount)
        : srcRows.slice(-1));
      setErr(null);
    } catch (ex) { setErr((prev) => prev ?? String(ex?.message || ex)); }
  }, []);

  // Live polling: refetch every 60s, keeping the previous frame while loading.
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const latestNav = nav && nav.length ? nav[nav.length - 1] : null;
  const ls = useMemo(() => liveStats(nav), [nav]);
  const marks = useMemo(() => {
    const m = {}; (latestNav?.positions || []).forEach((p) => { m[p.symbol] = p; }); return m;
  }, [latestNav]);

  // NOTHING HELD (2026-08-26). This whole page is built from qt_target_book —
  // the SCORED list — with live broker marks overlaid where they exist. When no
  // marks exist it silently fell back to each row's target_dollars, so a book
  // holding nothing rendered a full 40-name table titled "Holdings", with
  // weights, values and a sector breakdown. Joe read that as owning 40 stocks
  // while the account was 100% cash and had never traded. The list is a
  // shopping list until the orders fill; say so, loudly, everywhere.
  const nHeld = Object.keys(marks).length;
  const nothingHeld = nHeld === 0;

  // "Aug 17 – Aug 25, 2026" — the dates of the epoch actually being shown, read
  // off the rows themselves. Nothing about the book's window is hardcoded any
  // more: a hardcoded inception is what survived its own account and printed a
  // return that never happened.
  // Live vs closed copy (2026-08-28, relaunch). The account-selection logic
  // above already switches the DATA to the newest account that actually holds
  // stock, so on launch morning this page starts charting the new book with no
  // deploy. The copy must flip with it: the retirement notice, "closed book"
  // eyebrow and card titles describe the Aug 17-25 book and would be lies over
  // a live one. One flag, derived from the displayed data itself — the book is
  // live when the latest displayed mark holds positions.
  const bookIsLive = !!(latestNav && Number(latestNav.n_positions) > 0);

  const bookRan = (nav && nav.length)
    ? (() => {
        const a = fmtDate(nav[0].d);
        const b = fmtDate(nav[nav.length - 1].d);
        return a === b ? a : `${a.slice(0, -6)} – ${b}`;
      })()
    : null;

  const equity = latestNav ? Number(latestNav.equity) : 1_000_000;
  const cash = latestNav ? Number(latestNav.cash) : 1_000_000;
  const longMv = latestNav ? Number(latestNav.long_mv) : 0;
  const invested = equity > 0 ? longMv / equity : 0;
  const rebalDate = book && book.length ? book[0].rebalance_date : null;
  // A bare time ("marked 3:50 PM ET") cannot say WHICH 3:50 PM. Stamp the day
  // whenever the latest mark is not from today's ET session; on a live intraday
  // day this renders exactly as it always did.
  const markIsToday = latestNav?.created_at ? etDay(latestNav.created_at) === etDay(Date.now()) : false;
  const markDayET = latestNav?.created_at ? fmtDayET(latestNav.created_at) : null;
  const markedAt = latestNav?.created_at
    ? `marked ${markIsToday ? '' : `${markDayET}, `}${fmtTimeET(latestNav.created_at)}`
    : null;
  // What the day-change figures are ABOUT. Never the bare word "today" unless
  // the mark really is today's.
  const daySession = markIsToday ? 'today' : (markDayET ? `${markDayET} session` : 'last session');

  const weights = (latestNav?.positions || [])
    .map((p) => ({ s: p.symbol, w: Number(p.mv) / equity })).sort((a, b) => b.w - a.w);
  const top5 = weights.slice(0, 5).reduce((s, x) => s + x.w, 0);
  const largest = weights[0] || null;
  const medVol = useMemo(() => {
    const vs = (book || []).map((r) => Number(r.vol)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    return vs.length ? vs[Math.floor(vs.length / 2)] : null;
  }, [book]);

  const filled = Object.values(orders).filter((o) => o.status === 'filled').length;
  const working = Object.values(orders).filter((o) => !['filled', 'canceled', 'rejected', 'expired'].includes(o.status)).length;

  // Contributors/detractors in bp of NAV — day figures when the broker marks
  // carry them, else since-entry (labeled either way).
  const attribution = useMemo(() => {
    const ps = (latestNav?.positions || []).map((p) => {
      const day = p.upl_day != null ? Number(p.upl_day) : null;
      const usd = day ?? Number(p.upl || 0);
      return { s: p.symbol, usd, bp: (usd / equity) * 10000, isDay: day != null };
    }).filter((p) => Number.isFinite(p.bp));
    if (ps.length < 8) return null;
    const sorted = [...ps].sort((a, b) => b.bp - a.bp);
    return { top: sorted.slice(0, 5), bottom: sorted.slice(-5).reverse(), isDay: ps[0].isDay };
  }, [latestNav, equity]);

  // Sector / market-cap / liquidity rollups from the book + live weights.
  const bookMeta = useMemo(() => {
    if (!book || !book.length) return null;
    const w = (sym) => (marks[sym] ? Number(marks[sym].mv) / equity : 1 / book.length);
    const sectors = {};
    book.forEach((r) => {
      const k = r.sector || 'Unclassified';
      const ind = r.industry || 'Other';
      const sk = sectors[k] || (sectors[k] = { weight: 0, n: 0, inds: {} });
      sk.weight += w(r.symbol); sk.n += 1;
      const ik = sk.inds[ind] || (sk.inds[ind] = { weight: 0, n: 0, syms: [] });
      ik.weight += w(r.symbol); ik.n += 1; ik.syms.push(r.symbol);
    });
    const secList = Object.entries(sectors).map(([name, v]) => ({
      name, weight: v.weight, n: v.n,
      industries: Object.entries(v.inds)
        .map(([iname, iv]) => ({ name: iname, weight: iv.weight, n: iv.n, syms: iv.syms }))
        .sort((a, b) => b.weight - a.weight),
    })).sort((a, b) => b.weight - a.weight);
    const nIndustries = new Set(book.map((r) => r.industry).filter(Boolean)).size;
    const BUCKETS = [['Mega (≥$200B)', 200e9, Infinity], ['Large ($10–200B)', 10e9, 200e9],
                     ['Mid ($2–10B)', 2e9, 10e9], ['Small (<$2B)', 0, 2e9]];
    const caps = BUCKETS.map(([name, lo, hi]) => {
      const rows = book.filter((r) => r.market_cap != null && Number(r.market_cap) >= lo && Number(r.market_cap) < hi);
      return { name, n: rows.length, weight: rows.reduce((t, r) => t + w(r.symbol), 0) };
    }).filter((b) => b.n > 0);
    const mcaps = book.map((r) => Number(r.market_cap)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const medMcap = mcaps.length ? mcaps[Math.floor(mcaps.length / 2)] : null;
    const dtl = book.map((r) => {
      const mv = marks[r.symbol] ? Number(marks[r.symbol].mv) : Number(r.target_dollars);
      const a = Number(r.addv);
      return Number.isFinite(a) && a > 0 ? mv / (0.2 * a) : null;
    }).filter((v) => v != null);
    const worstDtl = dtl.length ? Math.max(...dtl) : null;
    const wavgAddv = book.reduce((t, r) => t + (Number(r.addv) || 0) * w(r.symbol), 0);
    return { secList, caps, medMcap, worstDtl, wavgAddv, covered: mcaps.length, nIndustries };
  }, [book, marks, equity]);

  const liveCurve = useMemo(() => {
    if (!nav || nav.length < 2) return null;
    // Both series indexed to 100 at INCEPTION — strategy off $1.0M, S&P off its
    // pre-launch close — so the chart and the header agree on the same origin.
    return {
      strategy: nav.map((r) => (Number(r.equity) / 1_000_000) * 100),
      spx: nav.some((r) => r.spy_close != null)
        ? (() => { const b = nav.find((r) => r.spy_close != null)?.spy_close;
             return nav.map((r) => (r.spy_close != null && b ? (Number(r.spy_close) / Number(b)) * 100 : null)).map((v, i, a) => v ?? a[i - 1] ?? 100); })()
        : null,
    };
  }, [nav]);

  const btSlice = useMemo(() => {
    const yrs = { '1Y': 12, '3Y': 36, '5Y': 60 }[btRange];
    if (!yrs) return BT;
    const k = Math.max(BT.dates.length - yrs, 0);
    const rebase = (arr) => { const b = arr[k]; return arr.slice(k).map((v) => (v / b) * 1_000_000); };
    return { dates: BT.dates.slice(k), strategy: rebase(BT.strategy), spx: rebase(BT.spx) };
  }, [btRange]);

  const sortedBook = useMemo(() => {
    if (!book) return [];
    const q = query.trim().toUpperCase();
    let rows = q ? book.filter((r) => r.symbol.toUpperCase().includes(q) || String(r.company || '').toUpperCase().includes(q)) : book;
    const val = (r) => {
      const m = marks[r.symbol]; const o = orders[r.symbol];
      switch (sortKey) {
        case 'rank': return Number(r.rank);
        case 'company': return r.symbol;
        case 'weight': return m ? Number(m.mv) / equity : 0.025;
        case 'value': return m ? Number(m.mv) : Number(r.target_dollars);
        case 'cost': return m?.avg_entry ? Number(m.avg_entry) : (o?.status === 'filled' ? Number(o.filled_avg_price) : -Infinity);
        case 'last': return m ? Number(m.price) : -Infinity;
        case 'pnl': return m ? Number(m.upl) : -Infinity;
        case 'sector': return r.sector || 'zz';
        case 'trend1y': return Number(r.mom12 ?? -Infinity);
        case 'profitability': return Number(r.gp_a ?? -Infinity);
        case 'buybacks': return Number(r.iss ?? -Infinity);
        case 'insider': return Number(r.insider ?? 0);
        default: return Number(r.rank);
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : (va === vb ? 0 : va < vb ? -1 : 1);
      return c * sortDir;
    });
  }, [book, marks, orders, equity, sortKey, sortDir, query]);

  const needs = (have, want) => `needs ${Math.max(want - have, 0)} more trading days`;
  const grid = (min, gap = 14) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap });

  const fillCell = (r) => {
    const o = orders[r.symbol]; const m = marks[r.symbol];
    const px = m?.avg_entry ? Number(m.avg_entry) : (o?.status === 'filled' ? Number(o.filled_avg_price) : null);
    if (px) return <span style={{ color: INK }}>{fmtUsd(px, 2)}</span>;
    if (o && !['filled', 'expired'].includes(o.status)) {
      return <span style={{ color: WARN, fontSize: 12 }}>◷ {o.status.replace(/_/g, ' ')}</span>;
    }
    return <span style={{ color: INK3 }}>—</span>;
  };

  // Inside the ink command card: cream-family text tones matched to Home's
  // Engine card (its eyebrow color is the same literal #9BA6AC in v12 CSS).
  const inkSub = '#9BA6AC';
  const inkHair = '1px solid rgba(247,243,232,0.16)';
  const inkUpDown = (v) => (v == null ? CREAM : v >= 0 ? 'var(--gold-bar)' : BAD);

  return (
    <div className="home-v12 paper-v12">
      <style>{CSS}</style>
      <div className="wrap qtt" style={{ padding: '44px 40px 96px' }}>

        {/* ── page header (v12 vocabulary) ───────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 26 }}>
          <div>
            <div className="eyebrow2" style={{ marginBottom: 10 }}>
              <span className="dot" />
              {bookIsLive
                ? `Paper Portfolio · live · marks sync every 10 min in market hours${markedAt ? ` · ${markedAt}` : ''}`
                : `Paper Portfolio · closed book · retired ${RETIRED_ON}${markedAt ? ` · final ${markedAt.replace(/^marked /, 'marks ')}` : ''}`}
            </div>
            <h1 className="serif" style={{ fontSize: 'clamp(34px, 3.8vw, 48px)', lineHeight: 1.08, margin: 0 }}>
              Quality Trend<em style={{ fontStyle: 'italic', color: GOLD }}>.</em>
            </h1>
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, color: INK2, lineHeight: 1.7 }}>
            {bookIsLive
              ? '20 US companies · equal weight · monthly rebalance · crash brake · no leverage'
              : '40 US companies · equal weight · monthly rebalance · no leverage'}
            <br />
            {bookIsLive
              ? '$1,000,000 paper account, inception Sep 1, 2026'
              : `$1,000,000 paper account, ${bookRan || 'now closed'} · closed`}{' · '}
            <Link to="/methodology#portfolio" style={{ color: INK2, fontWeight: 600, borderBottom: `1px solid ${EDGE}`, textDecoration: 'none', paddingBottom: 2 }}>Methodology</Link>
            <br />
            <span style={{ color: INK3 }}>Paper money — not investment advice.</span>
          </div>
        </div>

        {/* ── retired notice ─────────────────────────────────────────────
              Reader-facing, so plain English: no account numbers, no table
              names, no status words. Placed ABOVE the headline figures on
              purpose — a reader must not meet a portfolio value before
              learning the strategy behind it has been retired. */}
        {!bookIsLive && <div style={{
          border: `1px solid ${EDGE}`, borderLeft: `3px solid ${GOLD}`,
          borderRadius: 'var(--card-r)', background: CARD2,
          padding: '18px 22px', marginBottom: 'var(--mt-gap-card, 22px)',
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>
            Retired — nothing here is trading
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.65, color: INK2, maxWidth: '72ch' }}>
            <strong style={{ color: CREAM_INK }}>The paper account today holds $1,000,000
            in cash and owns nothing.</strong> Every number below belongs to a DIFFERENT,
            now-deleted account — the one that ran {bookRan || 'until it was closed'}. It is
            history, not a position, and nobody is down any money today.
            <br /><br />
            Quality Trend was retired on {RETIRED_ON}. Read the closing figure with one
            caveat: the book was liquidated in error on its final day, so a large part of
            that last move is an operating mistake rather than the strategy losing money.
            Treating it as the strategy's track record overstates how badly the strategy
            itself did.
            <br /><br />
            The relaunched book — 20 names with an automatic crash brake — starts
            September 1, 2026. Nothing trades before then. When it starts, it starts at
            zero, with its own record, and the two are never blended.
          </div>
        </div>}

        {/* ── command band — the page's ONE ink card (like Home's Engine
              card): every headline number in a single dark surface ────── */}
        <div className="qtt-card" style={{
          background: INKCARD, color: CREAM, borderRadius: 'var(--card-r)',
          boxShadow: 'var(--sh)', padding: '34px 44px', marginBottom: 'var(--mt-gap-card, 22px)',
        }}>
          <div style={{ ...grid(158, 22) }}>
            {[
              // hero = ONE number per tile (no crammed "$ · %"); the secondary
              // value + its context live on the sub-line. Day P&L is a dollar
              // figure, returns are percentages — labeled so the unit is never
              // ambiguous and the two tiles never look "reversed".
              // "· 10-min sync" describes what happens DURING a session. Once the
              // mark is a previous session's it is not only long, it is untrue —
              // nothing is syncing every ten minutes at 9am Monday.
              { k: 'Portfolio value', hero: fmtUsd(equity),
                sub: markedAt ? `final ${markedAt.replace(/^marked /, 'mark ')}` : 'at inception', color: CREAM },
              { k: 'Day P&L', hero: ls ? fmtSignedUsd(ls.day) : '—',
                sub: ls ? `${fmtPct(ls.dayPct, 2)} · ${daySession}` : 'from broker marks', color: inkUpDown(ls?.day) },
              { k: 'Since inception', hero: ls ? fmtPct(ls.since, 2) : '—',
                sub: ls ? `${fmtSignedUsd(ls.sinceUsd)} · ${bookRan || 'whole book'}` : 'vs $1,000,000 start', color: inkUpDown(ls?.since) },
              { k: 'vs S&P 500', hero: (ls && ls.spxSince != null) ? fmtPct(ls.since - ls.spxSince, 2) : '—',
                sub: (ls && ls.spxSince != null) ? `book ${fmtPct(ls.since, 2)} · S&P ${fmtPct(ls.spxSince, 2)}` : 'benchmark spread',
                color: inkUpDown(ls ? (ls.since - ls.spxSince) : null) },
              { k: 'Exposure', hero: latestNav ? fmtPctPlain(invested, 1) : '—',
                sub: `gross · net long · cash ${fmtUsd(cash)}`, color: CREAM, meter: invested },
              { k: 'Liquidity', hero: bookMeta?.worstDtl != null ? (bookMeta.worstDtl < 0.1 ? '< 0.1 day' : `${bookMeta.worstDtl.toFixed(1)} days`) : '—',
                sub: 'slowest exit at 20% of volume', color: CREAM },
              // The brake is part of the deployed system, so it belongs on the
              // page, state and reading both — a risk control the reader cannot
              // see is indistinguishable from one that does not exist. Before
              // the first evaluation (launch day, 5:25pm ET) it says so rather
              // than faking a reading.
              ...(bookIsLive ? [{
                k: 'Crash brake',
                hero: brake ? (brake.stress_on ? 'ON — half size' : 'Off') : 'Armed',
                sub: brake
                  ? `stress ${Number(brake.composite).toFixed(2)} · trips at 0.80, releases at 0.65`
                  : 'first reading today, 5:25 PM ET',
                color: brake?.stress_on ? '#e8b04b' : CREAM,
              }] : []),
            ].map((t) => (
              <div key={t.k}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: inkSub, marginBottom: 8 }}>{t.k}</div>
                <div className="num" style={{ fontSize: 23, fontWeight: 600, letterSpacing: '-0.01em', color: t.color }}>{t.hero}</div>
                {t.meter != null && (
                  <div style={{ height: 4, borderRadius: 999, background: 'rgba(247,243,232,0.18)', overflow: 'hidden', margin: '8px 0 2px', maxWidth: 140 }}>
                    <div style={{ width: `${Math.min(t.meter * 100, 100)}%`, height: '100%', background: 'var(--gold-bar)' }} />
                  </div>
                )}
                <div style={{ fontSize: 12, color: inkSub, marginTop: 6 }}>{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── attribution + size — two short, height-matched cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 22, marginBottom: 22, alignItems: 'start' }}>
          <Card title={attribution ? (attribution.isDay ? `Contributors & detractors — ${daySession}` : 'Contributors & detractors — since entry') : 'Contributors & detractors'}
            right={<Term tip={TIPS.contrib} labelOpacity={0.9}>bp of portfolio</Term>}>
            {attribution ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                {[['Top', attribution.top], ['Bottom', attribution.bottom]].map(([lbl, rows]) => (
                  <div key={lbl}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3, marginBottom: 8 }}>{lbl} 5</div>
                    {rows.map((p) => (
                      <button key={p.s} type="button" onClick={() => onOpenTicker && onOpenTicker(p.s)} className="qtt-row"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${HAIR}`, padding: '7px 4px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{p.s}</span>
                        <span className="num" style={{ fontSize: 13, color: upDown(p.bp) }}>
                          {p.bp > 0 ? '+' : ''}{p.bp.toFixed(1)}bp · {fmtSignedUsd(p.usd)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: 13, color: INK3, padding: 8 }}>Populates from the first broker marks.</div>}
          </Card>
          <Card title="Market cap & liquidity" right={<Term tip={TIPS.mcap} labelOpacity={0.9}>buckets</Term>}>
            {bookMeta ? (
              <>
                {bookMeta.caps.map((b) => (
                  <div key={b.name} style={{ padding: '6px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: INK2 }}>{b.name}</span>
                      <span className="num" style={{ fontWeight: 600 }}>{fmtPctPlain(b.weight, 1)} <span style={{ color: INK3, fontWeight: 400 }}>· {b.n}</span></span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'color-mix(in srgb, var(--ink) 10%, transparent)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(b.weight * 100, 100)}%`, height: '100%', background: BLUE, borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${HAIR}`, marginTop: 12, paddingTop: 10, fontSize: 12.5, color: INK2, lineHeight: 1.8 }}>
                  Median market cap <b className="num" style={{ color: INK }}>{bookMeta.medMcap ? `$${(bookMeta.medMcap / 1e9).toFixed(0)}B` : '—'}</b>
                  <br />
                  Weighted avg daily volume <b className="num" style={{ color: INK }}>{bookMeta.wavgAddv ? `$${(bookMeta.wavgAddv / 1e6).toFixed(0)}M` : '—'}</b>
                  <br />
                  <Term tip={TIPS.dtl} labelOpacity={0.9}>Slowest exit</Term>{' '}
                  <b className="num" style={{ color: INK }}>{bookMeta.worstDtl != null ? (bookMeta.worstDtl < 0.1 ? '< 0.1 day' : `${bookMeta.worstDtl.toFixed(1)} days`) : '—'}</b>
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: INK3 }}>Loading…</div>}
          </Card>
        </div>

        {/* ── sector & industry allocation — full-width masonry so every
            holding's industry shows at once and tiles pack with no dead space ── */}
        <Card title="Sector & industry allocation"
          right={bookMeta ? `${bookMeta.secList.length} sectors · ${bookMeta.nIndustries} of 74 GICS industries` : ''}
          style={{ marginBottom: 22 }}>
          {bookMeta ? (
            <div className="qtt-secgrid">
              {bookMeta.secList.map((sec) => (
                <div className="qtt-sectile" key={sec.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: INK }}>{sec.name}</span>
                    <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmtPctPlain(sec.weight, 1)} <span style={{ color: INK3, fontWeight: 400 }}>· {sec.n}</span></span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'color-mix(in srgb, var(--ink) 12%, transparent)', overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ width: `${Math.min((sec.weight / (bookMeta.secList[0]?.weight || 1)) * 100, 100)}%`, height: '100%', background: GOLD, borderRadius: 999 }} />
                  </div>
                  {sec.industries.map((ind) => (
                    <div key={ind.name} style={{ padding: '5px 0', borderTop: `1px solid ${HAIR}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, gap: 8 }}>
                        <span style={{ color: INK2 }}>{ind.name}</span>
                        <span className="num" style={{ color: INK2, whiteSpace: 'nowrap' }}>{fmtPctPlain(ind.weight, 1)} <span style={{ color: INK3 }}>· {ind.n}</span></span>
                      </div>
                      <div style={{ fontSize: 11, color: INK3, marginTop: 2 }}>
                        {ind.syms.map((sym, i) => (
                          <React.Fragment key={sym}>
                            <button type="button" onClick={() => onOpenTicker && onOpenTicker(sym)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: INK3 }}>{sym}</button>
                            {i < ind.syms.length - 1 ? ' · ' : ''}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 13, color: INK3 }}>Loading…</div>}
          <div style={{ fontSize: 11.5, color: INK3, marginTop: 12, lineHeight: 1.55 }}>
            Every holding shown at its GICS industry — click any ticker to open it. Tilts are an
            OUTPUT of the stock-level score, not a target: the book owns wherever momentum and
            profitability currently live.
          </div>
        </Card>

        {/* ── performance + risk ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(250px, 1fr)', gap: 22, marginBottom: 22 }}>
          <Card title={bookIsLive ? 'Performance' : 'Performance — closed book'} right={ls ? `${(ls.n ?? 0) + 1} marks · ${markedAt || ''}` : 'no marks yet'}>
            {liveCurve ? (
              <>
                <LineChart
                  series={[
                    { name: 'Quality Trend', color: GOLD, values: liveCurve.strategy },
                    ...(liveCurve.spx ? [{ name: 'S&P 500', color: BLUE, values: liveCurve.spx, width: 1.8, opacity: 0.9 }] : []),
                  ]}
                  dates={nav.map((r) => r.d)}
                  yFmt={(v) => v.toFixed(1)}
                />
                <ChartLegend items={[['Quality Trend (indexed to 100)', GOLD], ['S&P 500', BLUE]]} />
              </>
            ) : (
              <div style={{ padding: '22px 4px', fontSize: 13.5, lineHeight: 1.65, color: INK2 }}>
                The live line starts drawing at the second daily mark — tomorrow. Today&rsquo;s book,
                fills and P&amp;L are already live below; the backtest reference chart carries the
                long history until the real one exists.
              </div>
            )}
            <div style={{ ...grid(118, 14), borderTop: `1px solid ${HAIR}`, paddingTop: 14, marginTop: 14 }}>
              {[
                [<Term key="v" tip={TIPS.vol} labelOpacity={0.8}>Volatility</Term>, ls?.vol != null ? fmtPctPlain(ls.vol) : '—', ls?.vol == null ? needs(ls?.n ?? 0, 20) : 'annualized'],
                [<Term key="s" tip={TIPS.sharpe} labelOpacity={0.8}>Sharpe</Term>, ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—', ls?.sharpe == null ? needs(ls?.n ?? 0, 60) : 'vs ~4% cash'],
                [<Term key="b" tip={TIPS.beta} labelOpacity={0.8}>Beta vs S&P</Term>, ls?.beta != null ? ls.beta.toFixed(2) : '—', ls?.beta == null ? needs(ls?.n ?? 0, 20) : 'daily marks'],
                [<Term key="t" tip={TIPS.te} labelOpacity={0.8}>Tracking error</Term>, ls?.te != null ? fmtPctPlain(ls.te) : '—', ls?.te == null ? needs(ls?.n ?? 0, 20) : 'ann., vs S&P'],
                [<Term key="d" tip={TIPS.maxdd} labelOpacity={0.8}>Max drawdown</Term>, ls ? fmtPctPlain(ls.maxdd) : '—', 'live, mark-to-mark'],
                ['Best day', ls?.bestDay != null ? fmtPct(ls.bestDay, 2) : '—', ls?.bestDay == null ? needs(ls?.n ?? 0, 2) : 'close-to-close'],
                ['Worst day', ls?.worstDay != null ? fmtPct(ls.worstDay, 2) : '—', ls?.worstDay == null ? needs(ls?.n ?? 0, 2) : 'close-to-close'],
                ['% up days', ls?.pctUp != null ? fmtPctPlain(ls.pctUp, 0) : '—', ls?.pctUp == null ? needs(ls?.n ?? 0, 2) : 'of trading days'],
              ].map(([label, value, sub], i) => (
                <div key={i}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.11em', textTransform: 'uppercase', color: INK3, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                  <div style={{ fontSize: 11.5, color: INK3, marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Risk" right={markedAt || 'pre-first-mark'}>
            {[
              ['Invested', null, latestNav ? fmtPctPlain(invested, 1) : '—', 'target 100%, no leverage', invested, BLUE],
              ['Cash', null, fmtUsd(cash), latestNav ? fmtPctPlain(cash / equity, 1) + ' of equity' : 'pre-open', null, null],
              ['Drawdown from peak', TIPS.ddpeak, ls ? fmtPctPlain(ls.ddFromPeak, 2) : '—', 'equity vs its own high', null, null],
              ['Largest position', null, largest ? `${largest.s} · ${fmtPctPlain(largest.w, 2)}` : '2.50% target', 'equal-weight book', largest ? largest.w / 0.05 : null, GOLD],
              ['Top 5 concentration', null, weights.length ? fmtPctPlain(top5, 1) : '12.5% target', 'sum of largest five', weights.length ? top5 / 0.25 : null, GOLD],
              ['Typical holding volatility', TIPS.medvol, medVol != null ? fmtPctPlain(medVol, 0) : '—', 'median, capped at 70%', medVol != null ? medVol / 0.7 : null, BLUE],
            ].map(([k, tip, v, sub, frac, mcolor]) => (
              <div key={k} style={{ padding: '9px 0', borderBottom: `1px solid ${HAIR}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 13, color: INK2 }}>{tip ? <Term tip={tip} labelOpacity={0.9}>{k}</Term> : k}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</div>
                </div>
                <div style={{ fontSize: 11, color: INK3, marginTop: 1 }}>{sub}</div>
                {frac != null && <Meter frac={frac} color={mcolor} />}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: INK3, paddingTop: 10, lineHeight: 1.55 }}>
              Risk is structural — diversification, the volatility gate at selection, the monthly
              exit band. No stops, no book-level alarm, by design.
            </div>
          </Card>
        </div>

        {/* ── benchmark comp ──────────────────────────────────────────── */}
        <Card title="Versus benchmark" right="live book is 20 names; the backtest is the 40-name variant — separate records, never blended" style={{ marginBottom: 22 }}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${EDGE}` }}>
                  <th style={{ ...th, textAlign: 'left' }}></th>
                  <th style={{ ...th, color: INK3 }}>Return</th>
                  <th style={th}><Term tip={TIPS.vol} placement="bottom" alignRight labelOpacity={0.7}>Volatility</Term></th>
                  <th style={th}><Term tip={TIPS.sharpe} placement="bottom" alignRight labelOpacity={0.7}>Sharpe</Term></th>
                  <th style={th}><Term tip={TIPS.sortino} placement="bottom" alignRight labelOpacity={0.7}>Sortino</Term></th>
                  <th style={th}><Term tip={TIPS.maxdd} placement="bottom" alignRight labelOpacity={0.7}>Max drawdown</Term></th>
                  <th style={th}><Term tip={TIPS.worst} placement="bottom" alignRight labelOpacity={0.7}>Worst year</Term></th>
                </tr>
              </thead>
              <tbody>
                <tr className="qtt-row" style={{ borderBottom: `1px solid ${HAIR}` }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>
                    <span style={{ width: 10, height: 3, background: GOLD, display: 'inline-block', borderRadius: 2, marginRight: 8, verticalAlign: 'middle' }} />
                    {bookIsLive ? 'Quality Trend — live' : 'Quality Trend — closed book'} <span style={{ color: INK3, fontWeight: 400 }}>{bookRan || ''}</span>
                  </td>
                  <td style={{ ...td, color: upDown(ls?.since) }}>{ls ? fmtPct(ls.since, 2) : '—'}</td>
                  <td style={td}>{ls?.vol != null ? fmtPctPlain(ls.vol) : '—'}</td>
                  <td style={td}>{ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—'}</td>
                  <td style={td}>—</td>
                  <td style={td}>{ls ? fmtPctPlain(ls.maxdd) : '—'}</td>
                  <td style={td}>—</td>
                </tr>
                <tr className="qtt-row" style={{ borderBottom: `1px solid ${HAIR}`, color: INK2 }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <span style={{ width: 10, height: 3, background: BLUE, display: 'inline-block', borderRadius: 2, marginRight: 8, verticalAlign: 'middle' }} />
                    S&P 500 — <span style={{ color: INK3 }}>same window</span>
                  </td>
                  <td style={td}>{ls?.spxSince != null ? fmtPct(ls.spxSince, 2) : '—'}</td>
                  <td style={td}>—</td><td style={td}>—</td><td style={td}>—</td><td style={td}>—</td><td style={td}>—</td>
                </tr>
                <tr className="qtt-row" style={{ borderBottom: `1px solid ${HAIR}` }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>
                    Quality Trend — backtest, 40-name variant <span style={{ color: INK3, fontWeight: 400 }}>Feb 2017 – Aug 2026, ann.</span>
                  </td>
                  <td style={td}>{BT_STATS.cagr}</td><td style={td}>{BT_STATS.vol}</td><td style={td}>{BT_STATS.sharpe}</td>
                  <td style={td}>{BT_STATS.sortino}</td><td style={td}>{BT_STATS.maxdd}</td><td style={td}>{BT_STATS.worst}</td>
                </tr>
                <tr className="qtt-row" style={{ color: INK2 }}>
                  <td style={{ ...td, textAlign: 'left' }}>S&P 500 — same backtest window</td>
                  <td style={td}>{BT_SPX.cagr}</td><td style={td}>{BT_SPX.vol}</td><td style={td}>{BT_SPX.sharpe}</td>
                  <td style={td}>{BT_SPX.sortino}</td><td style={td}>{BT_SPX.maxdd}</td><td style={td}>{BT_SPX.worst}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: INK3, marginTop: 10 }}>
            <Term tip={TIPS.ir}>Information ratio</Term> (backtest): {BT_STATS.ir}. Live Sharpe appears after
            60 trading days — a ratio annualized from a few days is noise. Hover any dotted term for a
            plain-English definition.
          </div>
        </Card>

        {/* ── monthly returns (tear-sheet grid; fills as months accrue) ── */}
        <Card title={bookIsLive ? 'Monthly returns' : 'Monthly returns — closed book'} right={bookIsLive ? 'net paper returns, live book' : 'net paper returns, as far as the book ran'} style={{ marginBottom: 22 }}>
          {(() => {
            const months = {};
            (nav || []).forEach((r, i) => {
              if (i === 0) return;
              const prev = Number(nav[i - 1].equity), cur = Number(r.equity);
              const key = String(r.d).slice(0, 7);
              months[key] = (1 + (months[key] ?? 0)) * (cur / prev) - 1;
            });
            if (nav && nav.length >= 1) {
              const first = nav[0];
              const key = String(first.d).slice(0, 7);
              const dayOne = Number(first.equity) / 1_000_000 - 1;
              months[key] = (1 + dayOne) * (1 + (months[key] ?? 0)) - 1;
            }
            const years = [...new Set(Object.keys(months).map((k) => k.slice(0, 4)))].sort();
            const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (!years.length) return <div style={{ fontSize: 13, color: INK3 }}>The first month prints after the first close.</div>;
            return (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${EDGE}` }}>
                      <th style={{ ...th, textAlign: 'left', color: INK3 }}>Year</th>
                      {MN.map((m) => <th key={m} style={{ ...th, color: INK3 }}>{m}</th>)}
                      <th style={{ ...th, color: INK3 }}>YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((y) => {
                      let ytd = 1;
                      return (
                        <tr key={y} className="qtt-row">
                          <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{y}</td>
                          {MN.map((m, i) => {
                            const v = months[`${y}-${String(i + 1).padStart(2, '0')}`];
                            if (v != null) ytd *= 1 + v;
                            return <td key={m} style={{ ...td, color: v == null ? INK3 : upDown(v) }}>{v == null ? '·' : fmtPct(v, 1)}</td>;
                          })}
                          <td style={{ ...td, fontWeight: 700, color: upDown(ytd - 1) }}>{fmtPct(ytd - 1, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Card>

        {/* ── backtest reference ──────────────────────────────────────── */}
        <Card
          title="Backtest reference — 40-name research variant, growth of $1,000,000"
          right={
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ marginRight: 6 }}>survivorship-free · log scale</span>
              {['1Y', '3Y', '5Y', 'All'].map((r) => (
                <button key={r} type="button" className={`qtt-pill${btRange === r ? ' on' : ''}`} onClick={() => setBtRange(r)}>{r}</button>
              ))}
            </span>
          }
          style={{ marginBottom: 22 }}
        >
          <LineChart
            log
            series={[
              { name: 'Quality Trend', color: GOLD, values: btSlice.strategy },
              { name: 'S&P 500', color: BLUE, values: btSlice.spx, width: 1.8, opacity: 0.9 },
            ]}
            dates={btSlice.dates}
          />
          <ChartLegend items={[
            [`Quality Trend → ${fmtUsd(btSlice.strategy[btSlice.strategy.length - 1])}`, GOLD],
            [`S&P 500 → ${fmtUsd(btSlice.spx[btSlice.spx.length - 1])}`, BLUE],
          ]} />
          <div style={{ overflow: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${EDGE}` }}>
                  <th style={{ ...th, textAlign: 'left', color: INK3 }}>Year</th>
                  {Object.keys(BT.years).map((y) => <th key={y} style={{ ...th, color: INK3 }}>{y === '2026' ? '2026*' : y}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="qtt-row" style={{ borderBottom: `1px solid ${HAIR}` }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Quality Trend</td>
                  {Object.values(BT.years).map((r, i) => (
                    <td key={i} style={{ ...td, color: r.strategy >= 0 ? INK : BADBR, fontWeight: r.strategy >= r.spx ? 700 : 400 }}>
                      {r.strategy > 0 ? '+' : ''}{r.strategy.toFixed(1)}%
                    </td>
                  ))}
                </tr>
                <tr className="qtt-row">
                  <td style={{ ...td, textAlign: 'left', color: INK2 }}>S&P 500</td>
                  {Object.values(BT.years).map((r, i) => (
                    <td key={i} style={{ ...td, color: r.spx >= 0 ? INK2 : BADBR }}>
                      {r.spx > 0 ? '+' : ''}{r.spx.toFixed(1)}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: INK3, marginTop: 10, lineHeight: 1.6 }}>
            *2026 through Aug 11, the backtest's last mark. Bold = beat the index that year (7 of 10).
            A backtest is not a live record: it includes 2,011 companies that no longer exist, uses
            financials only from their SEC filing dates, and survives 40bp costs — and the live book
            should still be expected to run below it. Three backtest years trailed the index; more will come.
          </div>
        </Card>

        {/* ── holdings ────────────────────────────────────────────────── */}
        <Card
          title={nothingHeld ? 'Target book — nothing held' : 'Holdings at close'}
          right={
            <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                {nothingHeld
                  ? `the ${book?.length ?? 0} names below are scored, not owned · scored ${fmtDate(rebalDate)}`
                  : `final holdings · scored ${fmtDate(rebalDate)} · no further rebalance`}
              </span>
              <input
                className="qtt-search" type="search" placeholder="Filter ticker or name…"
                value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter holdings"
              />
            </span>
          }
        >
          {nothingHeld && !err && book && book.length ? (
            <div style={{
              margin: '0 0 14px', padding: '12px 14px', borderRadius: 10,
              background: 'rgba(184,151,92,0.10)', border: '1px solid rgba(184,151,92,0.45)',
              fontSize: 14, lineHeight: 1.5, color: INK2,
            }}>
              <strong>These are not holdings.</strong> The account holds no shares and has
              placed no orders — it is 100% cash. The list below is what the model scored,
              i.e. what it intends to buy. Values and weights show the intended size, not
              money at risk.
            </div>
          ) : null}
          {err ? (
            <div style={{ padding: 20, fontSize: 14, color: INK2 }}>The book could not be loaded ({err}). Refresh to retry.</div>
          ) : !book ? (
            <div style={{ padding: 20, fontSize: 14, color: INK3 }}>Loading…</div>
          ) : (
            <>
              <div style={{ overflow: 'auto', margin: '0 -6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${EDGE}` }}>
                      {colOrder.map((key) => {
                        const c = HCOLS.find((x) => x.key === key);
                        const active = sortKey === key;
                        return (
                          <th key={key} draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/col', key); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = e.dataTransfer.getData('text/col');
                              if (!from || from === key) return;
                              setColOrder((ord) => {
                                const next = ord.filter((k) => k !== from);
                                next.splice(next.indexOf(key), 0, from);
                                return next;
                              });
                            }}
                            onClick={() => {
                              if (active) setSortDir((d) => -d);
                              else { setSortKey(key); setSortDir(key === 'rank' || key === 'company' ? 1 : -1); }
                            }}
                            style={{ ...th, textAlign: c.align || 'right', cursor: 'pointer', userSelect: 'none' }}
                            title="Click to sort · drag to rearrange"
                            aria-sort={active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
                            {c.tip
                              ? <Term tip={c.tip} placement="bottom" alignRight={!c.align} labelOpacity={active ? 0.95 : 0.6}>{c.label}</Term>
                              : <span style={{ opacity: active ? 0.95 : 0.6 }}>{c.label}</span>}
                            <span style={{ marginLeft: 4, fontSize: 9, color: active ? GOLD : INK3 }}>{active ? (sortDir === 1 ? '▲' : '▼') : '⇅'}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBook.map((r) => {
                      const m = marks[r.symbol];
                      const w = m ? Number(m.mv) / equity : null;
                      const cells = {
                        rank: <td key="rank" style={{ ...td, textAlign: 'left', color: INK3 }}>{r.rank}</td>,
                        company: (
                          <td key="company" style={{ ...td, textAlign: 'left' }}>
                            <button type="button" onClick={() => onOpenTicker && onOpenTicker(r.symbol)}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
                              title={`Open ${r.symbol}`}>
                              <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                              <span style={{ color: INK3, marginLeft: 8, fontSize: 12.5 }}>
                                {(r.company || '').replace(/\s*(Common Stock|Ordinary Share|Class A Common Stock).*$/i, '')}
                              </span>
                            </button>
                          </td>
                        ),
                        weight: (
                          <td key="weight" style={td}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ width: 34, height: 4, borderRadius: 99, background: 'color-mix(in srgb, var(--ink) 12%, transparent)', overflow: 'hidden', display: 'inline-block' }}>
                                <span style={{ display: 'block', width: `${Math.min(((w ?? 0.025) / 0.05) * 100, 100)}%`, height: '100%', background: GOLD }} />
                              </span>
                              {w != null ? fmtPctPlain(w, 2) : '2.50%'}
                            </span>
                          </td>
                        ),
                        value: <td key="value" style={td}>{m ? fmtUsd(m.mv) : fmtUsd(r.target_dollars)}</td>,
                        cost: <td key="cost" style={td}>{fillCell(r)}</td>,
                        last: <td key="last" style={td}>{m ? fmtUsd(m.price, 2) : <span style={{ color: INK3 }}>—</span>}</td>,
                        pnl: (
                          <td key="pnl" style={{ ...td, color: m ? upDown(m.upl) : INK3 }}>
                            {m ? `${fmtSignedUsd(m.upl)} (${fmtPct(m.uplpc, 1)})` : '—'}
                          </td>
                        ),
                        sector: (
                          <td key="sector" style={{ ...td, textAlign: 'left', fontSize: 12.5, lineHeight: 1.35 }}>
                            <div style={{ color: INK2 }}>{r.sector || '—'}</div>
                            {r.industry ? <div style={{ color: INK3, fontSize: 11 }}>{r.industry}</div> : null}
                          </td>
                        ),
                        trend1y: <td key="trend1y" style={td}>{r.mom12 == null ? '—' : `${r.mom12 > 0 ? '+' : ''}${Math.round(r.mom12 * 100)}%`}</td>,
                        profitability: <td key="profitability" style={td}>{r.gp_a == null ? '—' : Number(r.gp_a).toFixed(2)}</td>,
                        buybacks: (
                          <td key="buybacks" style={{ ...td, color: r.iss == null ? INK3 : Number(r.iss) >= 0 ? INK : BADBR }}>
                            {r.iss == null ? '—' : fmtPct(Number(r.iss), 1)}
                          </td>
                        ),
                        insider: (
                          <td key="insider" style={{ ...td, color: Number(r.insider) > 0 ? GOLD : INK3 }}>
                            {Number(r.insider) > 0 ? Number(r.insider).toFixed(2) : '·'}
                          </td>
                        ),
                      };
                      return <tr key={r.symbol} className="qtt-row" style={{ borderBottom: `1px solid ${HAIR}` }}>{colOrder.map((k) => cells[k])}</tr>;
                    })}
                  </tbody>
                </table>
              </div>
              {query && sortedBook.length === 0 && (
                <div style={{ padding: 16, fontSize: 13, color: INK3 }}>No holdings match “{query}”.</div>
              )}
              <details style={{ marginTop: 12, fontSize: 12.5, color: INK2 }}>
                <summary style={{ cursor: 'pointer', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3 }}>
                  What these columns mean
                </summary>
                <div style={{ padding: '10px 2px 0', lineHeight: 1.65, maxWidth: 880 }}>
                  {HCOLS.filter((c) => c.tip).map((c) => (
                    <p key={c.key} style={{ margin: '0 0 7px' }}><b style={{ color: INK }}>{c.label}.</b> {c.tip}</p>
                  ))}
                  <p style={{ margin: 0, color: INK3 }}>
                    Click any column header to sort; click again to flip. Drag a header to rearrange.
                    Type in the filter box to find a name. Click a ticker to open its page.
                  </p>
                </div>
              </details>
            </>
          )}
        </Card>

        <div style={{ fontSize: 12, color: INK3, marginTop: 16, lineHeight: 1.65, maxWidth: 900 }}>
          Scored on 12- and 6-month momentum (skipping the most recent month), trend consistency,
          drawdown resilience, gross profitability, cash generation and buybacks from point-in-time
          SEC filings, plus a bonus for meaningful insider buying. Marks and P&amp;L are the paper
          broker&rsquo;s official records at the last sync — this page never estimates prices itself.
          Signal columns are as-of the scoring date.
        </div>
      </div>
    </div>
  );
}
