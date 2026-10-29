/* PaperPortfolioPage — Quality Trend, terminal skin (2026-10-28 redesign,
   from Joe's approved "MacroTilt Redesign" canvas: Portfolio /
   PortfolioMobile boards). Dense, data-first; light and dark by the site toggle.

   Desktop: the title bar, six key figures, then three columns — PERF (growth
   of $1,000,000 + the returns table) over HOLD (the ledger); ATTR over RISK;
   TILT, SRC and BT. Phone: title, figures 2×3, chart + returns, a four-
   column holdings list, risk 2×2, tilts, today's attribution, and one tap
   row to shock scenarios, sectors and the backtest.

   VISUAL REBUILD ONLY. Every figure is the one v6 computed: liveStats,
   perfTable, the risk cockpit row, factor loadings, attribution, the book
   roll-ups, the validated backtest constants. The ledger is the same shared
   DataTable with the same columns, sorting, column controls and amber rule.
   Styling lives in src/overhaul/styles/redesign.css.

   ── history ──
   v6 (2026-10-20, Joe: "more of a dashboard/cockpit"). Same data, same
   tokens, same glass; the page is now a pinned four-figure ribbon over three
   columns — performance · style factors and risk budget · the holdings ledger
   with its exception log — at institutional density. New figures (10-day 99%
   VaR, Sharpe in the ribbon, risk share per name, the variance decomposition,
   beta-scaled shock scenarios, factor z-scores vs the 500 largest US stocks)
   come from src/v2/lib/paperRisk.js and the qt_factor_exposure table; every
   one of them is re-derived and checked in
   paper_portfolio/qt/research/risk_cockpit_2026-10-20/.

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

   Data (read-only, RLS public): qt_target_book, qt_orders, qt_nav_daily, qt_brake_state.
   Backtest constant BT is the validated run, verbatim (LESSONS 8.3). */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useChartWidth from '../../overhaul/lib/useChartWidth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import DataTable from '../../overhaul/components/DataTable';
import { ALERT_RULES, primaryFactor } from '../lib/paperRisk';

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
// 2026-09-01: this was the literal '#14161a'. Hardcoded near-black, inline, and
// theme-blind, so in dark mode the single most important sentence on the page
// rendered black on a black ground — invisible. It is a token now, and it must
// stay one: a colour literal in a themed app is a bug with a delay on it.
const CREAM_INK = 'var(--v13-ink)';

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
const BADBR  = 'var(--down)';
const WARN   = 'var(--gold-deep)';
const INKCARD = 'var(--card-ink)';   // the ONE ink card (command band)
const CREAM  = 'var(--cream-text)';

/* "HF Sinclair Corporation" → "HF Sinclair": strip the legal suffix at a word
   boundary (an unanchored match once turned Sinclair into "S") and any
   punctuation it leaves behind. */
const shortName = (name) => String(name || '')
  .replace(/\s+(Common Stock|Ordinary Shares?|Class [A-C] Common Stock|Inc\.?|Corp\.?|Corporation|Incorporated|Holdings?|plc|Ltd\.?|N\.V\.|S\.A\.)\b.*$/i, '')
  .replace(/[\s,.]+$/, '');
const fmtUsd = (v, dp = 0) =>
  v == null ? '—' : `${Number(v) < 0 ? '−' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
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
  last: 'The price the position is marked at: the live price during market hours (synced every 10 minutes), the official close after the bell. The tile header says which.',
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


/* ── bilingual tooltips: one plain-English line, one formula line ────────
   Joe, 2026-10-20: every risk metric carries both. Term renders them as two
   lines; the holdings table's headers get the same text flattened to a
   string (its tooltip is an instant CSS one — LESSONS 7.13). */
const RISK_TIPS = {
  var: 'The most the book would be expected to lose over the next ten trading days on a bad-but-not-extreme stretch — a loss this size or worse should happen about one ten-day period in a hundred. Based on how this book’s own holdings moved over the past year. Formulas are on the Methodology page.',
  sharpe: 'Return earned per unit of risk taken, above what cash pays. Rule of thumb: 0.5 is decent, 1.0 is very good. Prints after 60 trading days — a ratio from a few days is noise.',
  momentum: 'Whether the book owns stocks that have been rising faster than the market over the past year. Above zero: more momentum than the 500 largest US stocks; below zero: less.',
  quality: 'Whether the book’s companies earn more profit on their assets than the 500 largest US stocks do. Above zero: more profitable than the index.',
  buybacks: 'Whether the book’s companies are shrinking their share count (buying back stock) more than the 500 largest US stocks are. Below zero: they are issuing more shares than the index does.',
  size: 'Whether the book’s companies are bigger or smaller than the index’s. Below zero: smaller companies than the 500 largest US stocks, which are dominated by giants.',
  value: 'Whether the book pays less per dollar of company sales than the index does. Above zero: cheaper on sales than the 500 largest US stocks.',
  market: 'The share of the book’s day-to-day swings that come from the whole stock market moving up and down. 50% means half of the book’s volatility is simply the market.',
  style: 'The share of the book’s swings that come from its deliberate tilts — owning momentum, quality, buyback, smaller or cheaper stocks — rather than the market as a whole.',
  specific: 'The share of the book’s swings that come from company-specific news — earnings, deals, drug trials — that neither the market nor the style tilts explain. Pure stock-picking risk. The three shares add up to 100%.',
  mctr: 'How much of the whole book’s day-to-day swings come from this one stock. The twenty shares add up to 100%. A stock whose share of risk is double its share of the money (for example 10% of the risk on 5% of the money) is flagged in amber — it moves the book more than its size suggests.',
  factor: 'The style this stock brings to the book most strongly — momentum, quality, buybacks, small size or value — compared with the 500 largest US stocks. “None dominant” means it does not stand out on any of them.',
  stress: 'What the book would be expected to lose if that past crash repeated in full, assuming the book keeps moving about as much as the market as it has over the past year. A projection, not a forecast.',
  vixshock: 'What the book would be expected to lose if the VIX — the market’s fear gauge — jumped to 40 in a single day from where it is now. Based on how the S&P 500 has reacted to VIX moves since 2006.',
};
const flatTip = (t) => t;
function BiTip({ tip }) { return <>{tip}</>; }

const FACTOR_FUNDS = { momentum: 'MTUM', quality: 'QUAL', buybacks: 'PKW', size: 'IWM', value: 'VLUE' };
const FACTOR_ORDER = ['momentum', 'quality', 'buybacks', 'size', 'value'];
const FACTOR_NAMES = {
  momentum: 'Momentum (12M)', quality: 'Quality', buybacks: 'Buybacks', size: 'Size', value: 'Value',
};

/* ── the risk cockpit's data: ONE stored row + the factor z-scores ─────────
   Nothing is computed here. paper_portfolio/qt/risk.py computes every risk
   figure once after each close (QT-EOD-DAILY) and stores it in qt_risk_daily;
   the factor z-scores are written at each monthly scoring. The page reads the
   newest row and renders it. A missing row renders dashes and says so in
   plain words — never an error string (LESSONS 4.9, 9.28). */
function useRiskCockpit({ latestNav, rebalDate }) {
  const [state, setState] = useState({ status: 'loading' });
  const key = `${latestNav?.d || ''}|${latestNav?.account_number || ''}|${rebalDate || ''}`;
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const acct = latestNav?.account_number;
        const [rr, fx] = await Promise.all([
          supabase.from('qt_risk_daily').select('*').order('d', { ascending: false }).limit(1)
            .then((q) => q)
            .then((q) => (acct && q.data?.[0] && q.data[0].account_number !== acct
              ? supabase.from('qt_risk_daily').select('*').eq('account_number', acct).order('d', { ascending: false }).limit(1)
              : q)),
          rebalDate
            ? supabase.from('qt_factor_exposure').select('symbol,factor,z,bench_z,base_n').eq('rebalance_date', rebalDate)
            : { data: [] },
        ]);
        if (dead) return;
        if (rr.error) throw rr.error;
        const row = rr.data?.[0] || null;
        const out = { status: 'ok', row, asOf: row?.as_of || null };
        if (row && row.n_sessions >= 250) {
          const d = row.detail || {};
          out.risk = {
            vol: row.vol, var1: row.var1, var10: row.var10, var1Normal: row.var1_norm,
            riskShare: d.risk_share || {}, mctr: d.mctr || {}, weights: d.weights || {},
          };
          out.decomp = { beta: row.beta, market: row.market, style: row.style, specific: row.specific, r2Market: row.r2_market, loadings: d.loadings || {} };
          out.shocks = d.shocks || null;
          out.vix = d.vix || null;
          out.alerts = d.alerts || [];
          out.missing = d.excluded || [];
        } else if (row) {
          out.have = row.n_sessions;
          out.alerts = (row.detail && row.detail.alerts) || [];
        }
        const byName = {}; const bench = {}; const baseN = {};
        (fx.data || []).forEach((r) => {
          (byName[r.symbol] = byName[r.symbol] || {})[r.factor] = r.z;
          bench[r.factor] = r.bench_z; baseN[r.factor] = r.base_n;
        });
        const weights = (out.risk && out.risk.weights) || {};
        const loading = {};
        FACTOR_ORDER.forEach((f) => {
          let num = 0, den = 0;
          Object.keys(byName).forEach((sym) => {
            const z = byName[sym][f]; const w = weights[sym] ?? (1 / Math.max(Object.keys(byName).length, 1));
            if (z != null) { num += w * z; den += w; }
          });
          loading[f] = den > 0 ? { book: num / den, bench: bench[f] ?? null, active: bench[f] != null ? num / den - bench[f] : null, baseN: baseN[f] } : null;
        });
        out.factorZ = byName; out.factorLoading = loading;
        setState(out);
      } catch (ex) {
        if (!dead) setState({ status: 'error' });
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}


function Term({ children, tip, placement = 'top', alignRight = false, labelOpacity = 1, wide = false }) {
  const [open, setOpen] = useState(false);
  const pos = placement === 'bottom' ? { top: '145%' } : { bottom: '135%' };
  const side = alignRight ? { right: 0 } : { left: 0 };
  return (
    <span tabIndex={0} style={{ position: 'relative', cursor: 'help', outline: 'none' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span className="term-u" style={{ borderBottom: `1px dotted ${INK3}`, opacity: labelOpacity }}>{children}</span>
      {open && (
        <span style={{
          position: 'absolute', ...pos, ...side, zIndex: 40, background: 'var(--mt-tip-bg)',
          border: '1px solid var(--mt-tip-line)', borderRadius: 'var(--r-10)', padding: 'var(--sp-9) var(--sp-12)',
          width: wide ? 300 : 250, whiteSpace: 'normal', boxShadow: 'var(--sh)',
          fontSize: 'var(--v13-t2)', lineHeight: 1.5, fontWeight: 'var(--fw-400)', letterSpacing: 0,
          textTransform: 'none', color: INK, textAlign: 'left',
        }}>{typeof tip === 'string' ? tip : tip}</span>
      )}
    </span>
  );
}


/* ── the PERF chart: growth of $1,000,000, book in amber and S&P 500 in
   grey, end-value price tags on the right edge, crosshair readout on hover
   and arrow keys (2026-10-28 terminal board). One SVG unit = one CSS pixel
   (LESSONS 9.20), so the axis labels render on the type scale. The lines
   draw themselves left to right on load; the tags fade in after. */
function TmLineChart({ series, dates, height = 240, log = false, yFmt, animate = true }) {
  const [hov, setHov] = useState(null);
  const [wrapRef, W] = useChartWidth(800);
  const H = height, padL = 12, padR = 64, padT = 10, padB = 22;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && v > 0);
  if (!all.length) return null;
  const t = (v) => (log ? Math.log(v) : v);
  const lo = Math.min(...all.map(t)), hi = Math.max(...all.map(t));
  const n = series[0].values.length;
  const x = (i) => padL + (i / Math.max(n - 1, 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (t(v) - lo) / Math.max(hi - lo, 1e-9)) * (H - padT - padB);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const gridVals = [0.25, 0.5, 0.75].map((f) => (log ? Math.exp(lo + f * (hi - lo)) : lo + f * (hi - lo)));
  const fmt = yFmt || ((v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000).toLocaleString()}k`));
  const dateLbl = (i) => (dates && dates[i]
    ? new Date(`${String(dates[i]).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(n > 400 ? { year: 'numeric', day: undefined } : {}) }).toUpperCase()
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
  // Price tags: keep two tags from overlapping by nudging the lower one down.
  const tags = series.map((s, i) => ({ s, i, cy: y(s.values[s.values.length - 1]), txt: fmt(s.values[s.values.length - 1]) }))
    .sort((a, b) => a.cy - b.cy);
  for (let i = 1; i < tags.length; i++) if (tags[i].cy - tags[i - 1].cy < 20) tags[i].cy = tags[i - 1].cy + 20;
  return (
    <div ref={wrapRef} className="tm-chart" tabIndex={0} role="application"
      aria-label="Performance chart — arrow keys move the readout"
      onKeyDown={onKey} onPointerMove={(e) => setHov(idxFromEvent(e))}
      onPointerLeave={() => setHov(null)} onBlur={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="performance chart">
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line className="tm-chart-grid" x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} />
            {tags.every((tg) => Math.abs(y(gv) - tg.cy) > 14) ? (
              <text className="tm-chart-lbl" x={W - padR + 6} y={y(gv) + 4}>{fmt(gv)}</text>
            ) : null}
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className="tm-chart-lbl" x={x(i)} y={H - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dateLbl(i)}</text>
        ))}
        {series.map((s) => (
          <path key={s.name} className={`tm-chart-line${animate ? ' tm-draw' : ''}`} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity || 1} pathLength={animate ? 1 : undefined} />
        ))}
        {tags.map((tg) => (
          <g key={`${tg.s.name}-tag`} className={animate ? 'tm-pop' : ''}>
            <rect x={W - padR + 4} y={tg.cy - 9} width={padR - 6} height={18} fill={tg.s.tagBg || tg.s.color} />
            <text className="tm-chart-tag" x={W - padR + 4 + (padR - 6) / 2} y={tg.cy + 4} textAnchor="middle" fill={tg.s.tagInk || 'var(--tm-page)'}>{tg.txt}</text>
          </g>
        ))}
        {hov != null && (
          <g>
            <line x1={x(hov)} x2={x(hov)} y1={padT} y2={H - padB} className="tm-chart-cross" />
            {series.map((s) => (
              <circle key={`${s.name}-dot`} cx={x(hov)} cy={y(s.values[hov])} r="4" fill={s.color} className="tm-chart-hovdot" />
            ))}
          </g>
        )}
      </svg>
      {hov != null && (
        <div className="tm-chart-tip" style={{ left: flip ? undefined : `calc(${tipLeftPct}% + 12px)`, right: flip ? `calc(${100 - tipLeftPct}% + 12px)` : undefined }}>
          <div className="tm-chart-tip-d">{dateLbl(hov)}</div>
          {series.map((s) => (
            <div key={s.name} className="tm-chart-tip-r"><span className="tm-chart-sw" style={{ background: s.color }} /><b>{fmt(s.values[hov])}</b><span>{s.name}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── live stats from qt_nav_daily ─────────────────────────────────────────
   `nav` here is the HELD window — rows from the first day the account owned
   stock. `spyBase` is the S&P close from the session BEFORE that first day,
   read off the same epoch's earlier (cash) rows. Day-one returns for book and
   benchmark are then measured over the same interval: the book from its $1M
   start, the S&P from its prior close — never from a same-day quote, which
   made the S&P read 0.00% on day one (Joe caught it, Aug 2026). */
function liveStats(nav, spyBase = null) {
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
  // S&P since inception. Baseline priority: the pre-launch close handed in as
  // `spyBase`; failing that, the first close inside the window (needs >= 2
  // points so a single row cannot benchmark against itself).
  const spxNz = spx.filter((v) => v != null);
  const lastSpy = spxNz.length ? spxNz[spxNz.length - 1] : null;
  const spx0 = spyBase ?? (spxNz.length >= 2 ? spxNz[0] : null);
  const out = {
    n,
    since: last / 1_000_000 - 1,
    spxSince: lastSpy != null && spx0 != null ? lastSpy / spx0 - 1 : null,
    bestDay: n >= 2 ? Math.max(...ret) : null,
    worstDay: n >= 2 ? Math.min(...ret) : null,
    pctUp: n >= 2 ? ret.filter((r) => r > 0).length / n : null,
    ddFromPeak: last / peak - 1,
    maxdd: mdd,
    vol: null, beta: null, te: null, sharpe: null, ir: null,
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
      // Information ratio: annualized excess return over the S&P 500 per unit
      // of tracking error — the benchmark-relative Sharpe (TIPS.ir).
      out.ir = out.te > 0 ? (mean(a.map((v, i) => v - b[i])) * 252) / out.te : null;
    }
  }
  if (n >= 60) {
    const rf = 0.04 / 252;
    out.sharpe = (mean(ret) - rf) / sd(ret) * Math.sqrt(252);
  }
  return out;
}

/* ── headline performance table (Joe, 2026-10-07) ─────────────────────────
   Four rows — the book and three indices — across Day / YTD / Inception, each
   in dollars and percent. Every row is the SAME object: what $1,000,000 is
   worth now. For the book that is the account's equity; for an index it is
   $1,000,000 put into that index's fund at the close before the book's first
   day (the same starting bell liveStats uses for the S&P). One series per row
   means every dollar and percent in a row comes off one base (LESSONS 4.24)
   and the six cells of a row cannot disagree with each other:

     Day        worth now − worth at the prior close
     YTD        worth now − worth at the last close of the prior year; in the
                book's first calendar year there is no such close, so YTD runs
                from the book's start for EVERY row — never the index's full
                calendar year against five weeks of the book
     Inception  worth now − $1,000,000

   A row whose latest mark is missing renders dashes, never a stale figure. */
const START_CAPITAL = 1_000_000;
const PERF_ROWS = [
  { id: 'paper', label: 'Paper' },
  { id: 'spx', label: 'S&P 500', col: 'spy_close' },
  { id: 'ndx', label: 'Nasdaq 100', col: 'qqq_close' },
  { id: 'dji', label: 'Dow', col: 'dia_close' },
];
function perfTable(nav, heldIdx) {
  if (!nav || !nav.length) return null;
  const i0 = heldIdx > 0 ? heldIdx : 0;
  const held = nav.slice(i0);
  const n = held.length;
  const year = String(held[n - 1].d).slice(0, 4);
  const y0 = held.findIndex((r) => String(r.d).slice(0, 4) === year);
  const ytdFromStart = y0 <= 0;
  const num = (v) => (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
  const rows = PERF_ROWS.map((def) => {
    let worth;
    if (!def.col) {
      worth = held.map((r) => num(r.equity));
    } else {
      // Baseline: the last mark BEFORE the first held day; with no pre-launch
      // row, the first mark inside the window (a lone row then reads dashes
      // rather than benchmarking against itself).
      let base = null;
      for (let i = i0 - 1; i >= 0 && base == null; i--) base = num(nav[i][def.col]);
      if (base == null && n >= 2) base = num(held[0][def.col]);
      worth = held.map((r) => (base != null && num(r[def.col]) != null
        ? START_CAPITAL * (num(r[def.col]) / base) : null));
    }
    const cur = worth[n - 1];
    // Most recent known worth strictly before index i; the start before that.
    const before = (i) => {
      for (let j = i - 1; j >= 0; j--) if (worth[j] != null) return worth[j];
      return START_CAPITAL;
    };
    const cell = (from) => (cur == null || from == null
      ? { usd: null, pct: null }
      : { usd: cur - from, pct: cur / from - 1 });
    return {
      ...def,
      day: cell(before(n - 1)),
      ytd: cell(ytdFromStart ? START_CAPITAL : before(y0)),
      since: cell(START_CAPITAL),
    };
  });
  return { rows, ytdFromStart, year };
}

export default function PaperPortfolioPage({ onOpenTicker }) {
  const [book, setBook] = useState(null);
  const [orders, setOrders] = useState({});
  const [nav, setNav] = useState(null);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
  const [btRange, setBtRange] = useState('All');
  const [brake, setBrake] = useState(null);   // latest qt_brake_state row: {d, composite, stress_on}

  const load = useCallback(async () => {
    try {
      const { data: latest, error: e1 } = await supabase
        .from('qt_target_book').select('rebalance_date')
        .order('rebalance_date', { ascending: false }).limit(1);
      if (e1) throw e1;
      const rd = latest?.[0]?.rebalance_date;
      const [bk, od, nv, br] = await Promise.all([
        rd ? supabase.from('qt_target_book').select('*').eq('rebalance_date', rd).order('rank') : { data: [] },
        rd ? supabase.from('qt_orders').select('symbol,side,qty,status,filled_qty,filled_avg_price,time_in_force')
          .eq('rebalance_date', rd).neq('status', 'dry_run') : { data: [] },
        supabase.from('qt_nav_daily').select('d,equity,cash,long_mv,n_positions,spy_close,qqq_close,dia_close,positions,created_at,account_number').order('d'),
        supabase.from('qt_brake_state').select('d,composite,stress_on,action').order('d', { ascending: false }).limit(1),
      ]);
      if (bk.error) throw bk.error;
      setBook(bk.data || []);
      setBrake(br?.data?.[0] || null);
      // Several order rows can exist per symbol (an expired opening order plus
      // the day order that actually filled) — a FILLED row always wins.
      const om = {};
      (od.data || []).forEach((o) => {
        if (!om[o.symbol] || (o.status === 'filled' && om[o.symbol].status !== 'filled')) om[o.symbol] = o;
      });
      setOrders(om);
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
  // The strategy's record starts the first day the account HELD stock. The
  // epoch's earlier rows are the funded account parking $1,000,000 in cash
  // before launch — account setup, not the strategy — so stats and the chart
  // begin at the first held row. Those cash rows still do one job: the S&P
  // close on the last of them is the benchmark's pre-launch baseline, so book
  // and index are measured from the same starting bell. Data-keyed, never
  // date-keyed (LESSONS 4.53): a memorial epoch that held stock from its first
  // row passes through unchanged.
  const heldIdx = nav ? nav.findIndex((r) => Number(r.n_positions) > 0) : -1;
  const heldNav = nav && heldIdx > 0 ? nav.slice(heldIdx) : nav;
  const spyBase = (() => {
    if (!nav || heldIdx <= 0) return null;
    for (let i = heldIdx - 1; i >= 0; i--) {
      if (nav[i].spy_close != null) return Number(nav[i].spy_close);
    }
    return null;
  })();
  const inceptionD = heldNav && heldNav.length ? heldNav[0].d : null;
  const inceptionShort = inceptionD
    ? fmtDate(inceptionD).replace(/, \d{4}$/, '')
    : null;
  const ls = useMemo(() => liveStats(heldNav, spyBase), [heldNav, spyBase]);
  const perf = useMemo(() => perfTable(nav, heldIdx), [nav, heldIdx]);
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
  // Live means BOTH: the displayed epoch holds stock AND its data is current.
  // The holdings-only version dressed the CLOSED book (whose final row holds
  // 40 positions) in live copy the moment it deployed — "LIVE · inception
  // Sep 1" over the dead book's -6.45%. Caught on the rendered page,
  // launch eve. Five calendar days clears any weekend+holiday gap; a book
  // stale beyond that has a dead pipeline and must not present itself as live.
  const lastMarkAgeDays = latestNav
    ? (Date.now() - new Date(latestNav.created_at || latestNav.d).getTime()) / 86_400_000
    : Infinity;
  // 2026-10-11: a current book the crash brake has moved to cash holds no
  // positions but is still the live book — without this it wore the retired
  // notice for as long as the brake stayed on.
  const brakeInCash = !!(brake && brake.stress_on);
  const bookIsLive = !!(latestNav && lastMarkAgeDays <= 5
    && (Number(latestNav.n_positions) > 0 || brakeInCash));
  // 2026-10-11 (Joe: "when the page loads it's some old crap on there").
  // Until the first fetch lands there is no book to describe, and "not live"
  // is not the same as "retired": the page painted the full closed-book
  // notice and a $1,000,000 "at inception" figure for the second or two
  // before the data arrived. While loading, say nothing about the book.
  // The same holds when the first fetch fails: report the failure, not a retirement.
  const loading = nav === null;

  // The dates of the record being shown — the HELD window, so a live book
  // reads "since Sep 1" rather than counting the pre-launch cash-parking days.
  const bookRan = (heldNav && heldNav.length)
    ? (() => {
        const a = fmtDate(heldNav[0].d);
        const b = fmtDate(heldNav[heldNav.length - 1].d);
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
  const dayShort = markIsToday ? 'today' : (markDayET ? markDayET.replace(/^\w+, /, '') : 'last session');
  // Joe, 2026-10-20: "Are these live prices or prices at close?" Say which.
  // A mark taken inside the regular session (9:30-16:00 ET) is a live price;
  // anything later is the day's close (the 16:50 ET snapshot) and is labelled
  // with the day it closed.
  const markIsLivePrice = (() => {
    if (!latestNav?.created_at || !markIsToday) return false;
    const t = new Date(latestNav.created_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    return t >= '09:30' && t < '16:01';
  })();
  const priceBasis = latestNav?.created_at
    ? (markIsLivePrice ? `live prices · ${fmtTimeET(latestNav.created_at)}` : `closing prices · ${markDayET || fmtDayET(latestNav.created_at)}`)
    : null;

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

  // Contributors/detractors in bp of NAV — two rankings, both shown: the
  // session's movers (when the broker marks carry a day P&L) and the winners
  // and losers since entry.
  const attribution = useMemo(() => {
    const ps = (latestNav?.positions || []).map((p) => ({
      s: p.symbol,
      day: p.upl_day != null && Number.isFinite(Number(p.upl_day)) ? Number(p.upl_day) : null,
      since: Number.isFinite(Number(p.upl)) ? Number(p.upl || 0) : null,
    }));
    if (ps.length < 8) return null;
    const rank = (key) => {
      const xs = ps.filter((p) => p[key] != null).map((p) => ({ s: p.s, usd: p[key], bp: (p[key] / equity) * 10000 }))
        .filter((p) => Number.isFinite(p.bp)).sort((a, b) => b.bp - a.bp);
      return xs.length >= 8 ? { top: xs.slice(0, 5), bottom: xs.slice(-5).reverse() } : null;
    };
    const day = rank('day'), since = rank('since');
    return day || since ? { day, since } : null;
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
    if (!heldNav || heldNav.length < 2) return null;
    // Both series indexed to 100 at INCEPTION — strategy off $1.0M, S&P off its
    // pre-launch close — so the chart and the header agree on the same origin.
    return {
      strategy: heldNav.map((r) => (Number(r.equity) / 1_000_000) * 100),
      spx: (() => {
        const b = spyBase ?? heldNav.find((r) => r.spy_close != null)?.spy_close;
        if (!b) return null;
        return heldNav.map((r) => (r.spy_close != null ? (Number(r.spy_close) / Number(b)) * 100 : null))
          .map((v, i, a) => v ?? a[i - 1] ?? 100);
      })(),
    };
  }, [heldNav, spyBase]);

  const btSlice = useMemo(() => {
    const yrs = { '1Y': 12, '3Y': 36, '5Y': 60 }[btRange];
    if (!yrs) return BT;
    const k = Math.max(BT.dates.length - yrs, 0);
    const rebase = (arr) => { const b = arr[k]; return arr.slice(k).map((v) => (v / b) * 1_000_000); };
    return { dates: BT.dates.slice(k), strategy: rebase(BT.strategy), spx: rebase(BT.spx) };
  }, [btRange]);

  const needs = (have, want) => `needs ${Math.max(want - have, 0)} more trading days`;
  const fillCell = (r) => {
    const o = orders[r.symbol]; const m = marks[r.symbol];
    const px = m?.avg_entry ? Number(m.avg_entry) : (o?.status === 'filled' ? Number(o.filled_avg_price) : null);
    if (px) return <span style={{ color: INK }}>{fmtUsd(px, 2)}</span>;
    if (o && !['filled', 'expired'].includes(o.status)) {
      return <span style={{ color: WARN, fontSize: 'var(--v13-t2)' }}>◷ {o.status.replace(/_/g, ' ')}</span>;
    }
    return <span style={{ color: INK3 }}>—</span>;
  };


  // Days-to-liquidate per name, for the liquidity alert (same yardstick as the
  // Market cap & liquidity card: 20% of average daily dollar volume).
  const dtlBySym = useMemo(() => {
    const out = {};
    (book || []).forEach((r) => {
      const mv = marks[r.symbol] ? Number(marks[r.symbol].mv) : Number(r.target_dollars);
      const a = Number(r.addv);
      out[r.symbol] = Number.isFinite(a) && a > 0 ? mv / (0.2 * a) : null;
    });
    return out;
  }, [book, marks]);

  const cockpit = useRiskCockpit({ latestNav, rebalDate });
  const riskAsOf = cockpit.asOf ? fmtDate(cockpit.asOf).replace(/, \d{4}$/, '') : null;

  const filteredBook = useMemo(() => {
    if (!book) return [];
    const q = query.trim().toUpperCase();
    return q ? book.filter((r) => r.symbol.toUpperCase().includes(q) || String(r.company || '').toUpperCase().includes(q)) : book;
  }, [book, query]);

  // The ledger's columns. Risk % and Factor sit beside price and P&L (Joe,
  // 2026-10-20); the scoring inputs stay one click away under "Columns".
  const holdingsColumns = useMemo(() => {
    const rs = cockpit.risk?.riskShare || {};
    const fz = cockpit.factorZ || {};
    const num = (v) => (v == null ? null : Number(v));
    return [
      { key: 'rank', label: '#', tip: TIPS.rank, align: 'r', width: 40, hidden: true, sortValue: (r) => num(r.rank), render: (r) => <span style={{ color: INK3 }}>{r.rank}</span> },
      { key: 'company', label: 'Name', align: 'l', width: 120, noHide: true, sortValue: (r) => r.symbol,
        render: (r) => (
          <button type="button" onClick={() => onOpenTicker && onOpenTicker(r.symbol)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 'var(--fw-700)' }}>{r.symbol}</span>
            <span style={{ color: INK3, marginLeft: 'var(--sp-5)', fontSize: 'var(--v13-t1)' }}>
              {shortName(r.company)}
            </span>
          </button>
        ) },
      { key: 'weight', label: 'Weight', tip: TIPS.weight, align: 'r', width: 66, sortValue: (r) => (marks[r.symbol] ? Number(marks[r.symbol].mv) / equity : null),
        render: (r) => (marks[r.symbol] ? fmtPctPlain(Number(marks[r.symbol].mv) / equity, 1) : <span style={{ color: INK3 }}>—</span>) },
      { key: 'risk', label: 'Risk share', tip: RISK_TIPS.mctr, align: 'r', width: 78, sortValue: (r) => (rs[r.symbol] != null ? rs[r.symbol] : null),
        render: (r) => (rs[r.symbol] != null ? fmtPctPlain(rs[r.symbol], 1) : <span style={{ color: INK3 }}>—</span>),
        cellClass: (r) => {
          const w = marks[r.symbol] ? Number(marks[r.symbol].mv) / equity : null;
          return rs[r.symbol] != null && w && rs[r.symbol] / w >= ALERT_RULES.concentration ? 'warn' : '';
        } },
      { key: 'factor', label: 'Style', tip: RISK_TIPS.factor, align: 'l', width: 72, sortValue: (r) => (primaryFactor(fz[r.symbol])?.label ?? null),
        render: (r) => { const p = primaryFactor(fz[r.symbol]); return p ? <span style={{ color: p.key ? INK : INK3 }}>{p.label}</span> : <span style={{ color: INK3 }}>—</span>; } },
      { key: 'last', label: 'Price', tip: TIPS.last, align: 'r', width: 64, sortValue: (r) => (marks[r.symbol] ? Number(marks[r.symbol].price) : null),
        render: (r) => (marks[r.symbol] ? fmtUsd(marks[r.symbol].price, 2) : <span style={{ color: INK3 }}>—</span>) },
      { key: 'pnl', label: 'P&L $', tip: TIPS.pnl, align: 'r', width: 76, sortValue: (r) => (marks[r.symbol] ? Number(marks[r.symbol].upl) : null),
        cellClass: (r) => (marks[r.symbol] ? (Number(marks[r.symbol].upl) >= 0 ? 'up' : 'dn') : 'muted'),
        render: (r) => (marks[r.symbol] ? fmtSignedUsd(Number(marks[r.symbol].upl)) : '—') },
      { key: 'pnlpc', label: 'P&L %', tip: TIPS.pnl, align: 'r', width: 58, sortValue: (r) => (marks[r.symbol] ? Number(marks[r.symbol].uplpc) : null),
        cellClass: (r) => (marks[r.symbol] ? (Number(marks[r.symbol].uplpc) >= 0 ? 'up' : 'dn') : 'muted'),
        render: (r) => (marks[r.symbol] ? fmtPct(marks[r.symbol].uplpc, 1) : '—') },
      { key: 'value', label: 'Value', tip: TIPS.value, align: 'r', width: 80, hidden: true, sortValue: (r) => (marks[r.symbol] ? Number(marks[r.symbol].mv) : Number(r.target_dollars)),
        render: (r) => (marks[r.symbol] ? fmtUsd(marks[r.symbol].mv) : fmtUsd(r.target_dollars)) },
      { key: 'cost', label: 'Avg cost', tip: TIPS.cost, align: 'r', width: 76, hidden: true,
        sortValue: (r) => { const m = marks[r.symbol]; const o = orders[r.symbol]; return m?.avg_entry ? Number(m.avg_entry) : (o?.status === 'filled' ? Number(o.filled_avg_price) : null); },
        render: (r) => fillCell(r) },
      { key: 'sector', label: 'Sector', tip: TIPS.sector, align: 'l', width: 120, hidden: true, sortValue: (r) => r.sector || null,
        render: (r) => <span title={undefined}>{r.sector || '—'}{r.industry ? <span style={{ color: INK3 }}> · {r.industry}</span> : null}</span> },
      { key: 'trend1y', label: '1-yr trend', tip: TIPS.trend1y, align: 'r', width: 76, hidden: true, sortValue: (r) => num(r.mom12),
        render: (r) => (r.mom12 == null ? '—' : `${r.mom12 > 0 ? '+' : ''}${Math.round(r.mom12 * 100)}%`) },
      { key: 'profitability', label: 'Profitability', tip: TIPS.profitability, align: 'r', width: 86, hidden: true, sortValue: (r) => num(r.gp_a),
        render: (r) => (r.gp_a == null ? '—' : Number(r.gp_a).toFixed(2)) },
      { key: 'buybacks', label: 'Buybacks', tip: TIPS.buybacks, align: 'r', width: 76, hidden: true, sortValue: (r) => num(r.iss),
        cellClass: (r) => (r.iss != null && Number(r.iss) < 0 ? 'dn' : ''),
        render: (r) => (r.iss == null ? '—' : fmtPct(Number(r.iss), 1)) },
      { key: 'exit', label: 'Exit days', tip: TIPS.dtl, align: 'r', width: 76, hidden: true, sortValue: (r) => (dtlBySym[r.symbol] ?? null),
        cellClass: (r) => (dtlBySym[r.symbol] != null && dtlBySym[r.symbol] > ALERT_RULES.liquidityDays ? 'warn' : ''),
        render: (r) => (dtlBySym[r.symbol] == null ? '—' : dtlBySym[r.symbol] < 0.1 ? '< 0.1' : dtlBySym[r.symbol].toFixed(1)) },
      { key: 'addv', label: 'Daily $ vol', tip: 'Average dollars traded per day over the last three months — how easily the name can be bought or sold.', align: 'r', width: 84, hidden: true, sortValue: (r) => (Number.isFinite(Number(r.addv)) ? Number(r.addv) : null),
        render: (r) => (Number.isFinite(Number(r.addv)) ? `$${(Number(r.addv) / 1e6).toFixed(0)}M` : '—') },
      { key: 'insider', label: 'Insider', tip: TIPS.insider, align: 'r', width: 64, hidden: true, sortValue: (r) => num(r.insider) || null,
        render: (r) => (Number(r.insider) > 0 ? <span style={{ color: GOLD }}>{Number(r.insider).toFixed(2)}</span> : <span style={{ color: INK3 }}>·</span>) },
    ];
  }, [cockpit.risk, cockpit.factorZ, marks, orders, equity, onOpenTicker, fillCell, dtlBySym]);


  // Phone layout: the holdings ledger becomes a four-column tap list and the
  // secondary panels sit behind one tap row (the approved PortfolioMobile board).
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 860 : false));
  useEffect(() => {
    const on = () => setPhone(window.innerWidth <= 860);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [btOpen, setBtOpen] = useState(false);

  if (loading) {
    return (
      <div className="mt-terminal tm-paper">
        <main className="tm-main">
          <section className="tm-titlebar"><span className="tm-title">QUALITY TREND</span><span className="tm-tag">PAPER BOOK</span></section>
          <div aria-live="polite" className="tm-loading">{err ? `The book could not be loaded (${err}). Refresh to retry.` : 'LOADING THE BOOK…'}</div>
        </main>
      </div>
    );
  }

  const periods = [
    { id: 'day', label: 'DAY' },
    { id: 'ytd', label: 'YTD' },
    { id: 'since', label: 'INCEPT' },
  ];
  const perfRows = perf ? perf.rows : PERF_ROWS.map((r) => ({ ...r, day: {}, ytd: {}, since: {} }));
  const cellPct = (c) => (c?.pct == null ? '—' : fmtPct(c.pct, 2));
  const cellCls = (c) => (c?.pct == null ? 'fl' : c.pct >= 0 ? 'up' : 'down');
  const cr = cockpit.risk; const dc = cockpit.decomp;
  const riskNote = cockpit.status === 'loading' ? 'loading…'
    : cockpit.status === 'error' ? 'risk figures could not be loaded — refresh to retry'
      : cockpit.row == null ? 'risk figures print after the first close'
        : null;
  const needsDays = (want) => `prints after ${Math.max(want - (cockpit.have || 0), 0)} more sessions of price history`;

  // Monthly returns, one cell per month (the first month runs from inception).
  const monthly = (() => {
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
    const keys = Object.keys(months).sort();
    return { months, keys, n: keys.length };
  })();
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const oneYear = new Set(monthly.keys.map((k) => k.slice(0, 4))).size <= 1;
  const monthLbl = (k) => `${MN[Number(k.slice(5, 7)) - 1].toUpperCase()}${oneYear ? '' : ` ${k.slice(2, 4)}`}`;

  // The backtest's own statistics — a different book (40 names, 2017–26).
  const btRows = [
    ['ret', 'Return per year', BT_STATS.cagr, BT_SPX.cagr], ['vol', 'Volatility', BT_STATS.vol, BT_SPX.vol],
    ['sharpe', 'Sharpe', BT_STATS.sharpe, BT_SPX.sharpe], ['sortino', 'Sortino', BT_STATS.sortino, BT_SPX.sortino],
    ['maxdd', 'Max drawdown', BT_STATS.maxdd, BT_SPX.maxdd], ['worst', 'Worst year', BT_STATS.worst, BT_SPX.worst],
    ['ir', 'Information ratio', BT_STATS.ir, '—'],
  ];

  const rsSorted = Object.entries(cockpit.risk?.riskShare || {}).map(([s, v]) => ({ s, v: Number(v) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
  const topRisk = rsSorted[0] || null;
  const bookBeta = dc?.beta ?? ls?.beta ?? null;
  const nSectors = bookMeta ? bookMeta.secList.length : null;
  const marksN = (ls?.n ?? 0) + 1;
  const signPct = (v, dp = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Number(v) * 100).toFixed(dp)}%`);
  const signCls = (v) => (v == null || !Number.isFinite(Number(v)) ? 'fl' : v > 0 ? 'up' : v < 0 ? 'down' : 'fl');
  const alerts = cockpit.alerts || null;
  const nAlerts = alerts ? alerts.length : null;

  const kpis = [
    { l: 'PORTFOLIO VALUE', v: fmtUsd(equity), s: priceBasis ? (bookIsLive ? priceBasis : `final · ${priceBasis}`) : 'at inception', cls: '' },
    { l: `TOTAL RETURN${inceptionShort ? ` SINCE ${inceptionShort.toUpperCase()}` : ''}`, v: ls ? signPct(ls.since) : '—', s: ls?.spxSince != null ? `S&P 500 ${signPct(ls.spxSince)} over the same period` : 'S&P 500 comparison prints with the first mark', cls: ls ? signCls(ls.since) : 'fl' },
    { l: 'EXPOSURE', v: latestNav ? fmtPctPlain(invested, 1) : '—', s: `Gross, net long · cash ${fmtUsd(cash)}`, cls: '' },
    { l: 'INFORMATION RATIO', v: ls?.ir != null ? ls.ir.toFixed(2) : '—', s: ls?.ir == null ? needs(ls?.n ?? 0, 20) : 'vs S&P 500, annualized', cls: '' },
    { l: 'SHARPE RATIO', v: ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—', s: ls?.sharpe == null ? `${marksN} of 60 marks; prints at 60` : 'since inception · vs ~4% cash', cls: ls?.sharpe == null ? 'fl' : '' },
    { l: '10-DAY VALUE AT RISK', v: cr ? `−${fmtUsd(cr.var10 * equity)}` : '—', s: cr ? `${fmtPctPlain(cr.var10, 1)} of the book · 99% · as of ${riskAsOf}` : (riskNote || needsDays(250)), cls: cr ? 'down' : 'fl' },
  ];

  const attrBlock = (title, blk) => (
    <div key={title}>
      <div className="tm-ghead">{title}</div>
      <div className="tm-attrcols">
        {[blk.top, blk.bottom].map((rows, k) => (
          <div key={k} className="tm-attr-col">
            {rows.map((p) => (
              <button key={p.s} type="button" className="tm-row tm-attr-row rd-num" onClick={() => onOpenTicker && onOpenTicker(p.s)}>
                <span className="tm-attr-t">{p.s}</span>
                <span className={signCls(p.bp)}>{p.bp > 0 ? '+' : p.bp < 0 ? '−' : ''}{Math.abs(p.bp).toFixed(1)}</span>
                <span className={signCls(p.bp)}>{fmtSignedUsd(p.usd)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  const riskCells = [
    ['VOLATILITY', ls?.vol != null ? fmtPctPlain(ls.vol) : '—', ls?.vol == null ? needs(ls?.n ?? 0, 20) : 'annualized', ''],
    ['BETA VS S&P', bookBeta != null ? bookBeta.toFixed(2) : '—', dc?.beta != null ? '1-yr daily' : (ls?.beta != null ? 'daily marks' : needs(ls?.n ?? 0, 20)), ''],
    ['TRACKING ERROR', ls?.te != null ? fmtPctPlain(ls.te) : '—', ls?.te == null ? needs(ls?.n ?? 0, 20) : 'annualized', ''],
    ['MAX DRAWDOWN', ls ? fmtPctPlain(ls.maxdd) : '—', 'mark-to-mark', ls && ls.maxdd < 0 ? 'down' : ''],
    ['OFF PEAK', ls ? fmtPctPlain(ls.ddFromPeak, 2) : '—', 'vs own high', ls && ls.ddFromPeak < 0 ? 'down' : ''],
    ['LARGEST RISK SHARE', topRisk ? fmtPctPlain(topRisk.v, 1) : '—', topRisk ? `${topRisk.s} · ${fmtPctPlain(weights.find((w) => w.s === topRisk.s)?.w ?? 0, 1)} of money` : (riskNote || needsDays(250)), topRisk ? 'is-amber' : ''],
  ];

  const tiltRows = FACTOR_ORDER.map((f) => {
    const L = cockpit.factorLoading?.[f];
    const a = L?.active;
    const w = a == null ? 0 : Math.min(Math.abs(a) / 2.5, 1) * 50;
    return { f, name: FACTOR_NAMES[f], a, w, left: a == null ? 50 : a >= 0 ? 50 : 50 - w, L };
  });
  const srcRows = dc ? [
    ['The whole market moving', dc.market, 'market'], ['Company-specific news', dc.specific, 'specific'], ['The book’s style tilts', dc.style, 'style'],
  ] : null;
  const shockRows = cockpit.shocks ? [
    ...cockpit.shocks.map((e) => ({ k: e.id, n: e.label, a: e.index, b: e.book, tip: RISK_TIPS.stress })),
    ...(cockpit.vix ? [{ k: 'vix', n: `VIX spike to 40 (from ${Number(cockpit.vix.vix_now ?? cockpit.vix.vixNow).toFixed(1)})`, a: cockpit.vix.index, b: cockpit.vix.book, tip: RISK_TIPS.vixshock }] : []),
  ] : null;

  const notice = (
    <>
      {!bookIsLive && (
        <section className="tm-panel tm-notice rd-rise d1">
          <div className="tm-phead"><span className="tm-code tm-code--red">RETIRED</span><span className="tm-ptitle">NOTHING HERE IS TRADING</span></div>
          <div className="tm-notice-body">
            <b>The paper account today holds $1,000,000 in cash and owns nothing.</b> Every number below belongs to a DIFFERENT,
            now-deleted account — the one that ran {bookRan || 'until it was closed'}. It is history, not a position, and nobody is down any money today.
            {' '}Quality Trend was retired on {RETIRED_ON}. Read the closing figure with one caveat: the book was liquidated in error on its
            final day, so a large part of that last move is an operating mistake rather than the strategy losing money.
          </div>
        </section>
      )}
      {nothingHeld && !err && book && book.length ? (
        <section className="tm-panel tm-notice rd-rise d1">
          <div className="tm-notice-body"><b>These are not holdings.</b> The account holds no shares — the list is what the model scored, i.e. what it intends to buy.</div>
        </section>
      ) : null}
    </>
  );

  const returnsBlock = (
    <div className="tm-returns">
      <div className="tm-cols tm-cols--ret rd-num"><span>RETURNS</span>{periods.map((p) => <span key={p.id} className="r">{p.label}</span>)}</div>
      {perfRows.map((r) => (
        <div key={r.id} className="tm-row tm-row--ret rd-num">
          <span className={r.id === 'paper' ? 'is-amber' : ''}>{r.id === 'paper' ? 'Book' : r.label}</span>
          {periods.map((p) => <span key={p.id} className={`r ${cellCls(r[p.id])}`}>{cellPct(r[p.id])}</span>)}
        </div>
      ))}
      <div className="tm-retstats rd-num">
        <div><div className="tm-k">BEST DAY</div><div className={`tm-v ${ls?.bestDay != null ? signCls(ls.bestDay) : 'fl'}`}>{ls?.bestDay != null ? signPct(ls.bestDay) : '—'}</div></div>
        <div><div className="tm-k">WORST DAY</div><div className={`tm-v ${ls?.worstDay != null ? signCls(ls.worstDay) : 'fl'}`}>{ls?.worstDay != null ? signPct(ls.worstDay) : '—'}</div></div>
        <div><div className="tm-k">UP DAYS</div><div className="tm-v">{ls?.pctUp != null ? fmtPctPlain(ls.pctUp, 0) : '—'}</div></div>
        <div><div className="tm-k">MONTHLY{monthly.n ? ` · ${monthly.keys.map(monthLbl).join(' / ')}` : ''}</div><div className="tm-v tm-monthly">{monthly.n ? monthly.keys.map((k) => <span key={k} className={signCls(monthly.months[k])}>{signPct(monthly.months[k], 1)}</span>) : '—'}</div></div>
      </div>
      {perf && perf.ytdFromStart && <div className="tm-pnote tm-pnote--block">Index rows: $1,000,000 in each index’s fund (SPY, QQQ, DIA) at the close before the book’s first day. The book started this year, so YTD and inception match until January.</div>}
    </div>
  );

  const holdingsPhone = (
    <div className="tm-hold-phone">
      <div className="tm-cols tm-cols--hp rd-num"><span>NAME</span><span className="r">WEIGHT</span><span className="r">P&amp;L $</span><span className="r">P&amp;L %</span></div>
      {(book || []).slice().sort((a, b) => (marks[b.symbol] ? Number(marks[b.symbol].mv) : 0) - (marks[a.symbol] ? Number(marks[a.symbol].mv) : 0)).map((r) => {
        const m = marks[r.symbol];
        return (
          <button key={r.symbol} type="button" className="tm-row tm-row--hp rd-num" onClick={() => onOpenTicker && onOpenTicker(r.symbol)}>
            <span className="tm-hp-name"><span className="is-amber">{r.symbol}</span><span className="tm-hp-co">{shortName(r.company)}</span></span>
            <span className="r">{m ? fmtPctPlain(Number(m.mv) / equity, 1) : '—'}</span>
            <span className={`r ${m ? signCls(Number(m.upl)) : 'fl'}`}>{m ? fmtSignedUsd(Number(m.upl)) : '—'}</span>
            <span className={`r ${m ? signCls(Number(m.uplpc)) : 'fl'}`}>{m ? fmtPct(m.uplpc, 1) : '—'}</span>
          </button>
        );
      })}
    </div>
  );

  const riskPanel = (
    <section className="tm-panel rd-rise d4" aria-label="Risk measures">
      <div className="tm-phead">
        <span className="tm-code">RISK</span><span className="tm-ptitle">RISK MEASURES{riskAsOf ? ` · AFTER ${riskAsOf.toUpperCase()} CLOSE` : ''}</span>
        <span className="tm-pfill" />
        {phone && nAlerts != null && <span className={`tm-alerts ${nAlerts ? 'is-red' : 'is-green'}`}>{nAlerts} ALERT{nAlerts === 1 ? '' : 'S'}</span>}
      </div>
      {!phone && (
        <div className="tm-alertline">
          {nAlerts != null ? <span className={`tm-alerts ${nAlerts ? 'is-red' : 'is-green'}`}>{nAlerts} ALERT{nAlerts === 1 ? '' : 'S'}</span> : <span className="tm-alerts is-grey">—</span>}
          <span className="tm-alerttext">
            {alerts
              ? (alerts.length
                ? alerts.map((a, i) => <span key={`${a.code}-${a.sym || i}`}>{i ? ' · ' : ''}{a.sym ? <button type="button" className="tm-tklink" onClick={() => onOpenTicker && onOpenTicker(a.sym)}>{a.sym}</button> : null}{a.sym ? ' ' : ''}{a.text.replace(new RegExp(`^${a.sym} `), '')}</span>)
                : 'Every name inside its risk, weight and liquidity limits; cash positive; crash brake off.')
              : (riskNote || 'Alerts print with the risk figures.')}
          </span>
        </div>
      )}
      <div className="tm-riskgrid rd-num">
        {riskCells.map(([k, v, s, cls]) => (
          <div key={k} className="tm-riskcell"><div className="tm-k">{k}</div><div className={`tm-v ${cls}`}>{v}</div><div className="tm-s">{s}</div></div>
        ))}
      </div>
      {!phone && (
        <>
          <div className="tm-ghead">SHOCK SCENARIOS · IF IT HAPPENED AGAIN</div>
          {shockRows ? (
            <>
              <div className="tm-cols tm-cols--shock rd-num"><span>SCENARIO</span><span className="r">S&amp;P 500</span><span className="r">BOOK</span></div>
              {shockRows.map((e) => (
                <div key={e.k} className="tm-row tm-row--shock rd-num">
                  <span className="tm-c-name"><Term tip={e.tip} placement="bottom" wide labelOpacity={0.95}>{e.n}</Term></span>
                  <span className="r fl">{e.a == null ? '—' : fmtPct(e.a, 1)}</span>
                  <span className="r down tm-strong">{e.b == null ? '—' : fmtPct(e.b, 1)}</span>
                </div>
              ))}
              <div className="tm-pnote tm-pnote--block">Each episode is the S&P 500 fund’s actual peak-to-trough fall, scaled by the book’s beta — a projection, not a backtest.{cockpit.vix ? ' The VIX line uses how much the fund has historically fallen when fear jumped.' : ''}</div>
            </>
          ) : <div className="tm-empty">{riskNote || needsDays(250)}</div>}
        </>
      )}
    </section>
  );

  const tiltBlock = (
    <div className="tm-tilts">
      {cockpit.factorLoading && FACTOR_ORDER.some((f) => cockpit.factorLoading[f]) ? tiltRows.map((t) => (
        <div key={t.f} className="tm-tilt rd-num">
          <span className="tm-tilt-n"><Term tip={RISK_TIPS[t.f]} placement="bottom" wide labelOpacity={0.95}>{t.name}</Term></span>
          <span className="tm-tilt-bar" aria-hidden="true"><span className="tm-tilt-mid" />{t.a != null && <span className={`tm-tilt-fill tm-grow ${t.a >= 0 ? 'is-pos' : 'is-neg'}`} style={{ left: `${t.left}%`, width: `${t.w}%` }} />}</span>
          <span className={`tm-tilt-v ${t.a == null ? 'fl' : t.a >= 0 ? 'is-amber' : 'is-slate'}`}>{t.a == null ? '—' : `${t.a >= 0 ? '+' : '−'}${Math.abs(t.a).toFixed(2)}`}</span>
        </div>
      )) : <div className="tm-empty">{cockpit.status === 'loading' ? 'Loading…' : 'Factor scores print with the next monthly scoring.'}</div>}
      <div className="tm-pnote tm-pnote--block">±1 = one standard deviation of that universe. Amber = more than the index, slate = less.{rebalDate ? ` Scored ${fmtDate(rebalDate)}.` : ''}</div>
    </div>
  );

  const srcBlock = (
    <>
      <div className="tm-src">
        {srcRows ? srcRows.map(([n, v, k]) => (
          <div key={k} className="tm-srcrow rd-num">
            <div className="tm-srchead"><span><Term tip={RISK_TIPS[k]} placement="bottom" wide labelOpacity={0.95}>{n}</Term></span><b>{fmtPctPlain(v, 1)}</b></div>
            <div className="tm-srcbar"><div className="tm-srcfill tm-grow" style={{ width: `${Math.max(0, Math.min(100, v * 100))}%` }} /></div>
          </div>
        )) : <div className="tm-empty">{riskNote || needsDays(250)}</div>}
        {dc && <div className="tm-pnote tm-pnote--block">Shares of the book’s day-to-day swings. The market alone explains {fmtPctPlain(dc.r2Market, 0)} of its daily moves.</div>}
      </div>
      <div className="tm-ghead">SECTOR · SHARE OF BOOK</div>
      <div className="tm-sectors">
        {bookMeta ? bookMeta.secList.map((sec) => (
          <div key={sec.name} className="tm-sector rd-num">
            <span className="tm-sector-n">{sec.name}</span>
            <span className="tm-sector-bar"><span className="tm-sector-fill tm-grow" style={{ width: `${(sec.weight / (bookMeta.secList[0]?.weight || 1)) * 100}%` }} /></span>
            <span className="tm-sector-v">{fmtPctPlain(sec.weight, 1)} · {sec.n}</span>
          </div>
        )) : <div className="tm-empty">Loading…</div>}
      </div>
    </>
  );

  const btBlock = (
    <>
      <div className="tm-cols tm-cols--bt rd-num"><span>ANNUALIZED</span><span className="r">BOOK</span><span className="r">S&amp;P 500</span></div>
      {btRows.map(([k, label, a, b]) => (
        <div key={k} className="tm-row tm-row--bt rd-num">
          <span className="tm-c-name">{label}</span>
          <span className="r tm-strong">{a}</span>
          <span className="r fl">{b}</span>
        </div>
      ))}
      <div className="tm-pnote tm-pnote--block">40 names, survivorship-free, after 40bp of costs. A backtest is not a live record and the live book should be expected to run below it.</div>
      {btOpen && (
        <div className="tm-btdetail">
          <div className="tm-ghead">GROWTH OF $1,000,000 · LOG SCALE</div>
          <div className="tm-btrange">
            {['1Y', '3Y', '5Y', 'All'].map((r) => (
              <button key={r} type="button" className={`tm-pill${btRange === r ? ' on' : ''}`} onClick={() => setBtRange(r)}>{r}</button>
            ))}
          </div>
          <div className="tm-chartwrap">
            <TmLineChart log height={220} animate={false}
              series={[
                { name: 'Book', color: 'var(--tm-amber)', values: btSlice.strategy, width: 2 },
                { name: 'S&P 500', color: 'var(--tm-text-5)', values: btSlice.spx, width: 1.75, tagBg: 'var(--tm-midline)', tagInk: 'var(--tm-num)' },
              ]}
              dates={btSlice.dates}
            />
          </div>
          <div className="tm-ghead">CALENDAR YEARS</div>
          <div className="tm-cols tm-cols--bt rd-num"><span>YEAR</span><span className="r">BOOK</span><span className="r">S&amp;P 500</span></div>
          {Object.entries(BT.years).map(([y, r]) => (
            <div key={y} className="tm-row tm-row--bt rd-num">
              <span className="tm-c-name">{y === '2026' ? '2026*' : y}</span>
              <span className={`r ${r.strategy >= 0 ? (r.strategy >= r.spx ? 'tm-strong' : '') : 'down'}`}>{r.strategy > 0 ? '+' : ''}{r.strategy.toFixed(1)}%</span>
              <span className={`r ${r.spx >= 0 ? 'fl' : 'down'}`}>{r.spx > 0 ? '+' : ''}{r.spx.toFixed(1)}%</span>
            </div>
          ))}
          <div className="tm-pnote tm-pnote--block">*2026 through Aug 11. Bold = beat the index that year.</div>
        </div>
      )}
    </>
  );

  return (
    <div className="mt-terminal tm-paper">
      <main className="tm-main">

        {/* ── title bar ───────────────────────────────────────────────── */}
        <section className="tm-titlebar rd-rise d1" aria-label="Quality Trend paper book">
          <div className="tm-titleleft">
            <span className="tm-title">QUALITY TREND</span>
            <span className="tm-tag">{phone ? 'PAPER' : 'PAPER BOOK'}</span>
          </div>
          <div className="tm-titledesc">
            An AI-driven automated portfolio rebalancer — high-quality names with strong momentum.{' '}
            <Link to="/methodology#portfolio" className="tm-plink">Methodology ▸</Link>
          </div>
          <div className="tm-pfill" />
          <div className="tm-marks rd-num">{priceBasis ? priceBasis.toUpperCase() : 'NO MARKS YET'}{ls ? ` · ${marksN} DAILY ${marksN === 1 ? 'MARK' : 'MARKS'}${inceptionShort ? ` SINCE ${inceptionShort.toUpperCase()}` : ''}` : ''}</div>
        </section>

        {notice}

        {/* ── six key figures ─────────────────────────────────────────── */}
        <section className="tm-kpis rd-rise d2" aria-label="Key figures">
          {kpis.map((k) => (
            <div key={k.l} className="tm-kpi">
              <div className="tm-k">{k.l}</div>
              <div className={`tm-kpi-v rd-num ${k.cls}`}>{k.v}</div>
              <div className="tm-s">{k.s}</div>
            </div>
          ))}
        </section>

        {phone ? (
          <>
            <section className="tm-panel rd-rise d3" aria-label="Performance">
              <div className="tm-phead"><span className="tm-code">PERF</span><span className="tm-ptitle">GROWTH OF $1M</span><span className="tm-pfill" /><span className="tm-legend"><span className="is-amber">━ BOOK</span> <span className="fl">━ S&amp;P</span></span></div>
              <div className="tm-chartwrap">
                {liveCurve ? (
                  <TmLineChart height={220}
                    series={[
                      { name: 'Book', color: 'var(--tm-amber)', values: liveCurve.strategy, width: 2.25 },
                      ...(liveCurve.spx ? [{ name: 'S&P 500', color: 'var(--tm-text-5)', values: liveCurve.spx, width: 1.75, tagBg: 'var(--tm-midline)', tagInk: 'var(--tm-num)' }] : []),
                    ]}
                    dates={heldNav.map((r) => r.d)} yFmt={(v) => v.toFixed(1)} />
                ) : <div className="tm-empty">The live line starts drawing at the second daily mark.</div>}
              </div>
              {returnsBlock}
            </section>
            <section className="tm-panel rd-rise d3" aria-label="Holdings">
              <div className="tm-phead"><span className="tm-code">HOLD</span><span className="tm-ptitle">{nothingHeld ? `TARGET BOOK · ${book?.length ?? 0} NAMES SCORED, NOT OWNED` : `HOLDINGS · ${nHeld} NAMES`}</span></div>
              {err ? <div className="tm-empty">The book could not be loaded ({err}). Refresh to retry.</div> : !book ? <div className="tm-empty">Loading…</div> : holdingsPhone}
            </section>
            {riskPanel}
            <section className="tm-panel rd-rise d4" aria-label="Style tilts">
              <div className="tm-phead"><span className="tm-code">TILT</span><span className="tm-ptitle">STYLE TILTS VS 500 LARGEST US STOCKS</span></div>
              {tiltBlock}
            </section>
            <section className="tm-panel rd-rise d4" aria-label="Attribution">
              <div className="tm-phead"><span className="tm-code">ATTR</span><span className="tm-ptitle">{attribution?.day ? `${daySession === 'today' ? 'TODAY' : daySession.toUpperCase()} · BP OF BOOK` : 'SINCE ENTRY · BP OF BOOK'}</span></div>
              {attribution ? (attribution.day ? attrBlock('TOP 5 / BOTTOM 5', attribution.day) : attribution.since ? attrBlock('TOP 5 / BOTTOM 5', attribution.since) : null) : <div className="tm-empty">Populates from the first broker marks.</div>}
            </section>
            <button type="button" className="tm-morebtn" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
              {moreOpen ? 'HIDE' : 'SHOCK SCENARIOS · SECTORS · BACKTEST ▸'}
            </button>
            {moreOpen && (
              <>
                <section className="tm-panel" aria-label="Shock scenarios">
                  <div className="tm-phead"><span className="tm-code">RISK</span><span className="tm-ptitle">SHOCK SCENARIOS · IF IT HAPPENED AGAIN</span></div>
                  {shockRows ? (
                    <>
                      <div className="tm-cols tm-cols--shock rd-num"><span>SCENARIO</span><span className="r">S&amp;P 500</span><span className="r">BOOK</span></div>
                      {shockRows.map((e) => (
                        <div key={e.k} className="tm-row tm-row--shock rd-num"><span className="tm-c-name">{e.n}</span><span className="r fl">{e.a == null ? '—' : fmtPct(e.a, 1)}</span><span className="r down tm-strong">{e.b == null ? '—' : fmtPct(e.b, 1)}</span></div>
                      ))}
                    </>
                  ) : <div className="tm-empty">{riskNote || needsDays(250)}</div>}
                </section>
                <section className="tm-panel" aria-label="Where the risk comes from">
                  <div className="tm-phead"><span className="tm-code">SRC</span><span className="tm-ptitle">WHERE THE RISK COMES FROM</span></div>
                  {srcBlock}
                </section>
                <section className="tm-panel" aria-label="Backtest">
                  <div className="tm-phead"><span className="tm-code">BT</span><span className="tm-ptitle">BACKTEST · FEB 2017 – AUG 2026</span><span className="tm-pfill" /><button type="button" className="tm-plink" onClick={() => setBtOpen((v) => !v)}>{btOpen ? 'LESS ▴' : 'DETAIL ▸'}</button></div>
                  {btBlock}
                </section>
              </>
            )}
          </>
        ) : (
          <div className="tm-paper-grid">
            {/* ── left: PERF + HOLD ──────────────────────────────────────── */}
            <div className="tm-col">
              <section className="tm-panel rd-rise d3" aria-label="Performance">
                <div className="tm-phead"><span className="tm-code">PERF</span><span className="tm-ptitle">GROWTH OF $1,000,000 · INDEXED TO 100</span><span className="tm-pfill" /><span className="tm-legend"><span className="is-amber">━ BOOK</span> <span className="fl">━ S&amp;P 500</span></span></div>
                <div className="tm-perf">
                  <div className="tm-chartwrap">
                    {liveCurve ? (
                      <TmLineChart height={236}
                        series={[
                          { name: 'Book', color: 'var(--tm-amber)', values: liveCurve.strategy, width: 2.25 },
                          ...(liveCurve.spx ? [{ name: 'S&P 500', color: 'var(--tm-text-5)', values: liveCurve.spx, width: 1.75, tagBg: 'var(--tm-midline)', tagInk: 'var(--tm-num)' }] : []),
                        ]}
                        dates={heldNav.map((r) => r.d)} yFmt={(v) => v.toFixed(1)} />
                    ) : <div className="tm-empty">The live line starts drawing at the second daily mark.</div>}
                  </div>
                  {returnsBlock}
                </div>
              </section>

              <section className="tm-panel rd-rise d4" aria-label="Holdings">
                <div className="tm-phead">
                  <span className="tm-code">HOLD</span>
                  <span className="tm-ptitle">{nothingHeld ? `TARGET BOOK · ${book?.length ?? 0} NAMES SCORED, NOT OWNED` : `HOLDINGS · ${nHeld} NAMES${nSectors != null ? ` · ${nSectors} SECTORS` : ''}${bookMeta ? ` · ${bookMeta.nIndustries} OF 74 INDUSTRIES` : ''}`}</span>
                  <span className="tm-pfill" />
                  <span className="tm-pnote">{bookIsLive ? (priceBasis || 'no marks yet') : `final holdings · ${priceBasis || ''}`}</span>
                </div>
                <div className="tm-holdbody">
                  {err ? (
                    <div className="tm-empty">The book could not be loaded ({err}). Refresh to retry.</div>
                  ) : !book ? (
                    <div className="tm-empty">Loading…</div>
                  ) : (
                    <>
                      <DataTable
                        id="paper-cockpit-holdings"
                        columns={holdingsColumns}
                        rows={filteredBook}
                        rowKey={(r) => r.symbol}
                        initialSort={{ key: 'weight', dir: 'desc' }}
                        toolbarLeft={
                          <input className="tm-search" type="search" placeholder="Filter ticker or name…"
                            value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter holdings" />
                        }
                      />
                      {query && filteredBook.length === 0 && (
                        <div className="tm-empty">No holdings match “{query}”.</div>
                      )}
                      <div className="tm-pnote tm-pnote--block">
                        Risk = the stock’s share of the book’s day-to-day swings (the names add to 100%); amber = more than double its share of the money. Style = the tilt the stock brings most strongly. Marks and P&L are the paper broker’s official records at the last sync. Columns can be sorted, dragged, resized and shown or hidden under “Columns”.
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* ── middle: ATTR + RISK ────────────────────────────────────── */}
            <div className="tm-col">
              <section className="tm-panel rd-rise d3" aria-label="Contributors and detractors">
                <div className="tm-phead"><span className="tm-code">ATTR</span><span className="tm-ptitle">CONTRIBUTORS &amp; DETRACTORS · BP</span></div>
                {attribution ? (
                  <>
                    {attribution.day ? attrBlock(`${daySession === 'today' ? 'TODAY' : daySession.toUpperCase()} · TOP 5 / BOTTOM 5`, attribution.day) : null}
                    {attribution.since ? attrBlock('SINCE ENTRY · TOP 5 / BOTTOM 5', attribution.since) : null}
                    {!attribution.day && <div className="tm-pnote tm-pnote--block">Session movers print while the market is open; the after-close snapshot carries each position’s total P&amp;L only.</div>}
                  </>
                ) : <div className="tm-empty">Populates from the first broker marks.</div>}
              </section>
              {riskPanel}
            </div>

            {/* ── right: TILT + SRC + BT ─────────────────────────────────── */}
            <div className="tm-col">
              <section className="tm-panel rd-rise d3" aria-label="Style tilts">
                <div className="tm-phead"><span className="tm-code">TILT</span><span className="tm-ptitle">STYLE TILTS VS 500 LARGEST US STOCKS</span></div>
                {tiltBlock}
              </section>
              <section className="tm-panel rd-rise d4" aria-label="Where the risk comes from">
                <div className="tm-phead"><span className="tm-code">SRC</span><span className="tm-ptitle">WHERE THE RISK COMES FROM</span></div>
                {srcBlock}
              </section>
              <section className="tm-panel rd-rise d5" aria-label="Backtest">
                <div className="tm-phead"><span className="tm-code">BT</span><span className="tm-ptitle">BACKTEST · FEB 2017 – AUG 2026</span><span className="tm-pfill" /><button type="button" className="tm-plink" onClick={() => setBtOpen((v) => !v)}>{btOpen ? 'LESS ▴' : 'DETAIL ▸'}</button></div>
                {btBlock}
              </section>
            </div>
          </div>
        )}

        <p className="tm-footnote">
          Marks and P&amp;L are the paper broker’s official records at the last sync. Scored on 12- and 6-month momentum (skipping the most recent month),
          trend consistency, drawdown resilience, gross profitability, cash generation and buybacks from point-in-time SEC filings, plus a bonus for meaningful
          insider buying. Risk figures are computed once after each close from one year of daily closes at that close’s weights; this page never estimates prices itself.
        </p>
      </main>
    </div>
  );
}
