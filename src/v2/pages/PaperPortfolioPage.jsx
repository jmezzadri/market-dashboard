/* PaperPortfolioPage — Quality Trend cockpit, in the site's own skin.

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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useChartWidth from '../../overhaul/lib/useChartWidth';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../overhaul/styles/v13.css';
import '../../overhaul/styles/pages-v13.css';
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

/* ── injected CSS: layout + density of the cockpit (tokens only) ─────────── */
const CSS = `
.paper-v12 .qtt * { box-sizing: border-box; }
.paper-v12 .qtt-card { transition: background var(--dur-500); }
.paper-v12 .qtt-row { transition: background var(--dur-120) ease; }
.paper-v12 .qtt-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.paper-v12 .qtt-pill { transition: background var(--dur-120) ease, color var(--dur-120) ease; cursor: pointer; border: 1px solid var(--hair); background: transparent; color: var(--ink-soft); border-radius: var(--r-999); padding: var(--sp-2) var(--sp-9); font-size:var(--v13-t1); font-weight: var(--fw-600); letter-spacing: .04em; font-family: var(--mt-type-sans); }
.paper-v12 .qtt-pill:hover { color: var(--ink); }
.paper-v12 .qtt-pill.on { background: color-mix(in srgb, var(--gold-deep) 16%, transparent); border-color: var(--gold-deep); color: var(--gold-deep); }
.paper-v12 .qtt-search { background: var(--bg2); border: 1px solid var(--hair); border-radius: var(--r-10); color: var(--ink); padding: var(--sp-4) var(--sp-10); font-size:var(--v13-t2); width: 150px; outline: none; font-family: var(--mt-type-sans); }
.paper-v12 .qtt-search:focus { border-color: var(--gold-deep); }
.paper-v12 .qtt-search::placeholder { color: var(--mut); }

/* the ribbon — the page's ONE ink surface, pinned under the top bar */
.paper-v12 .ck-ribbon { position: sticky; top: calc(var(--ch-nav-h) + var(--lg-gap)); z-index: 30; background: var(--lg-sheet); color: var(--cream-text); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-10) var(--sp-18); align-items: start; margin-bottom: var(--lg-gap); }
.paper-v12 .ck-stat { min-width: 0; }
.paper-v12 .ck-eyebrow { font-size: var(--v13-t1); font-weight: var(--fw-700); letter-spacing: .14em; text-transform: uppercase; color: color-mix(in srgb, var(--cream-text) 72%, transparent); margin-bottom: var(--sp-3); white-space: nowrap; }
.paper-v12 .ck-hero { font-size: var(--v13-t5); font-weight: var(--fw-600); letter-spacing: -.01em; color: var(--cream-text); line-height: 1.15; white-space: nowrap; }
.paper-v12 .ck-sub { font-size: var(--v13-t2); color: color-mix(in srgb, var(--cream-text) 72%, transparent); margin-top: var(--sp-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.paper-v12 .ck-ribbon .term-u { border-bottom-color: var(--cream-text); }

/* three columns on a wide monitor; two on a tablet (the ledger spans); one on a phone */
.paper-v12 .ck-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.55fr); gap: var(--lg-gap); align-items: stretch; }
.paper-v12 .ck-col { display: flex; flex-direction: column; gap: var(--lg-gap); min-width: 0; }
.paper-v12 .ck-col > .qtt-card { margin-bottom: 0 !important; }
.paper-v12 .ck-col > .qtt-card.ck-fill { flex: 1 1 auto; }
@media (max-width: 1360px) {
  .paper-v12 .ck-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .paper-v12 .ck-col-3 { grid-column: 1 / -1; }
}
@media (max-width: 780px) {
  .paper-v12 .ck-grid { grid-template-columns: minmax(0, 1fr); }
  .paper-v12 .ck-ribbon { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .paper-v12 .ck-hero { white-space: normal; }
  /* the cockpit's own tables are narrow by design: keep them one full-width
     grid rather than the site's phone head/body split (which left them
     hugging the left edge) */
  .mt-overhaul .paper-v12 .ck-table { display: table; width: 100%; max-width: 100%; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .mt-overhaul .paper-v12 .ck-table thead { display: table-header-group; width: auto; min-width: 0; }
  .mt-overhaul .paper-v12 .ck-table tbody { display: table-row-group; width: auto; min-width: 0; }
  .mt-overhaul .paper-v12 .ck-table th, .mt-overhaul .paper-v12 .ck-table td { padding: var(--sp-4) var(--sp-6); }
  .mt-overhaul .paper-v12 .ck-table th:first-child, .mt-overhaul .paper-v12 .ck-table td:first-child { padding-left: 0; }
  .mt-overhaul .paper-v12 .dt-scroll { -webkit-mask-image: linear-gradient(to right, var(--c-000000) calc(100% - 18px), transparent 100%); mask-image: linear-gradient(to right, var(--c-000000) calc(100% - 18px), transparent 100%); }
  .mt-overhaul .paper-v12 .dt-table td { padding-top: var(--sp-3); padding-bottom: var(--sp-3); }
}

/* density: one card anatomy, tight rows, tabular numerals */
.paper-v12 .ck-card-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-10); margin-bottom: var(--sp-8); flex-wrap: wrap; }
.paper-v12 .ck-card-title { font-size: var(--v13-t1); font-weight: var(--fw-700); letter-spacing: .16em; text-transform: uppercase; color: var(--mut); }
.paper-v12 .ck-card-right { font-size: var(--v13-t2); color: var(--mut); }
.paper-v12 .ck-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.paper-v12 .ck-table th { text-align: right; padding: var(--sp-4) var(--sp-6); font-size: var(--v13-t1); font-weight: var(--fw-600); letter-spacing: .08em; text-transform: uppercase; color: var(--mut); white-space: nowrap; border-bottom: 1px solid var(--hair); vertical-align: bottom; }
.paper-v12 .ck-table th > span { white-space: normal; }
.paper-v12 .ck-table td { text-align: right; padding: var(--sp-4) var(--sp-6); font-size: var(--v13-t3); white-space: nowrap; border-bottom: 1px solid color-mix(in srgb, var(--hair) 60%, transparent); }
.paper-v12 .ck-table th:first-child, .paper-v12 .ck-table td:first-child { text-align: left; padding-left: 0; white-space: normal; }
.paper-v12 .ck-table th:last-child, .paper-v12 .ck-table td:last-child { padding-right: 0; }
.paper-v12 .ck-table tr.ck-strong td { font-weight: var(--fw-700); }
.paper-v12 .ck-table.ck-tight th, .paper-v12 .ck-table.ck-tight td { padding-left: var(--sp-3); padding-right: var(--sp-3); font-size: var(--v13-t2); }
.paper-v12 .ck-table.ck-tight td:first-child { font-size: var(--v13-t3); }
.paper-v12 .ck-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-8) var(--sp-10); }
.paper-v12 .ck-stat-k { font-size: var(--v13-t1); font-weight: var(--fw-600); letter-spacing: .08em; text-transform: uppercase; color: var(--mut); margin-bottom: var(--sp-2); line-height: 1.2; display: flex; align-items: flex-end; min-height: 2.4em; }
.paper-v12 .ck-stat-v { font-size: var(--v13-t4); font-weight: var(--fw-700); font-variant-numeric: tabular-nums; }
.paper-v12 .ck-stat-s { font-size: var(--v13-t1); color: var(--mut); margin-top: var(--sp-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.paper-v12 .ck-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) auto; gap: var(--sp-8); align-items: center; padding: var(--sp-5) 0; border-bottom: 1px solid color-mix(in srgb, var(--hair) 60%, transparent); font-size: var(--v13-t3); }
.paper-v12 .ck-row:last-child { border-bottom: 0; }
.paper-v12 .ck-bar { position: relative; height: 6px; border-radius: var(--r-999); background: color-mix(in srgb, var(--ink) 10%, transparent); overflow: hidden; }
.paper-v12 .ck-bar > span { position: absolute; top: 0; height: 100%; border-radius: var(--r-999); }
.paper-v12 .ck-bar.diverge::after { content: ""; position: absolute; left: 50%; top: 0; width: 1px; height: 100%; background: var(--mut); }
.paper-v12 .ck-stack { display: flex; height: 10px; border-radius: var(--r-999); overflow: hidden; margin: var(--sp-6) 0 var(--sp-8); }
.paper-v12 .ck-legend { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-8); font-size: var(--v13-t2); }
.paper-v12 .ck-alert { display: grid; grid-template-columns: auto 1fr; gap: var(--sp-8); align-items: start; padding: var(--sp-6) 0; border-bottom: 1px solid color-mix(in srgb, var(--hair) 60%, transparent); font-size: var(--v13-t2); line-height: 1.45; color: var(--ink-soft); }
.paper-v12 .ck-alert:last-child { border-bottom: 0; }
.paper-v12 .ck-alert-code { font-size: var(--v13-t1); font-weight: var(--fw-700); letter-spacing: .1em; text-transform: uppercase; padding: var(--sp-1) var(--sp-6); border-radius: var(--r-4); white-space: nowrap; margin-top: var(--sp-1); }
.paper-v12 .ck-alert.red .ck-alert-code { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
.paper-v12 .ck-alert.amber .ck-alert-code { color: var(--gold-deep); background: color-mix(in srgb, var(--gold-deep) 14%, transparent); }
.paper-v12 .ck-alert.grey .ck-alert-code { color: var(--mut); background: color-mix(in srgb, var(--ink) 8%, transparent); }
.paper-v12 .ck-scroll { overflow-x: auto; }
.paper-v12 .ck-twoup { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--sp-16); }
@media (max-width: 560px) { .paper-v12 .ck-twoup { grid-template-columns: minmax(0, 1fr); } }
.paper-v12 .dt-table th, .paper-v12 .dt-table td { padding: var(--sp-4) var(--sp-5); }
.paper-v12 .ck-note { font-size: var(--v13-t1); color: var(--mut); margin-top: var(--sp-8); line-height: 1.5; }
.paper-v12 .ck-link { color: var(--ink-soft); border-bottom: 1px solid var(--hair); text-decoration: none; }
.paper-v12 .ck-fill { display: flex; flex-direction: column; }
.paper-v12 .ck-fill > .ck-body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.paper-v12 .ck-fill > .ck-body > * { flex: none; }
.paper-v12 .ck-fill > .ck-body > .ck-chartfill { flex: 1 1 0; min-height: 204px; }
/* the holdings ledger: the shared table control, tightened to the cockpit's row height */
.paper-v12 .dt-table th, .paper-v12 .dt-table td { padding: var(--sp-4) var(--sp-6); font-size: var(--v13-t3); }
.paper-v12 .dt-table th { font-size: var(--v13-t1); letter-spacing: .06em; text-transform: uppercase; }
.paper-v12 .dt-toolbar { padding-bottom: var(--sp-6); }
.paper-v12 .dt-colbtn { padding: var(--sp-3) var(--sp-9); font-size: var(--v13-t2); }
.paper-v12 .qtt-secgrid { columns: 2; column-gap: var(--sp-10); }
.paper-v12 .qtt-sectile { break-inside: avoid; -webkit-column-break-inside: avoid; background: var(--bg2); border-radius: var(--r-14); padding: var(--sp-8) var(--sp-10); margin: 0 0 var(--sp-10); }
/* phone/tablet overrides, declared LAST so they beat the density rules above */
@media (max-width: 1180px) { .paper-v12 .ck-sub { white-space: normal; } }
@media (max-width: 480px) { .paper-v12 .ck-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .paper-v12 .ck-legend { grid-template-columns: 1fr; } }
`;

/* A chart that fills the height its tile has left over, so the column it sits
   in ends on the same line as its neighbours without a blank band (LESSONS
   9.25 rule 3: size the chart to the stack, never to a fixed number). The
   wrapper's height is set by flex, not by the chart, so measuring it is stable. */
function useFillHeight(min = 170) {
  // A callback ref, not useRef: the tile mounts AFTER the page's loading
  // state, so an effect keyed on mount would observe nothing.
  const [node, setNode] = useState(null);
  const [h, setH] = useState(min);
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setH(Math.max(min, Math.floor(e.contentRect.height))));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, min]);
  return [setNode, h];
}

/* ── small primitives ─────────────────────────────────────────────────── */

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

/* One card anatomy for every tile on the page: a 2-line header band (title
   left, context right) and a body. `fill` lets the last card in a column
   grow so the three columns end on the same line (LESSONS 9.25 rule 3). */
function Card({ title, right, children, style, className, fill = false }) {
  return (
    <div className={`qtt-card ${fill ? 'ck-fill' : ''} ${className || ''}`} style={{ background: CARD, borderRadius: 'var(--r-card)', padding: 'var(--sp-12) var(--sp-14)', ...style }}>
      {(title || right) && (
        <div className="ck-card-head">
          <div className="ck-card-title">{title}</div>
          {right ? <div className="ck-card-right">{right}</div> : null}
        </div>
      )}
      <div className="ck-body">{children}</div>
    </div>
  );
}
function Meter({ frac, color = BLUE }) {
  return (
    <div style={{ height: 5, borderRadius: 'var(--r-999)', background: 'color-mix(in srgb, var(--ink) 12%, transparent)', overflow: 'hidden', marginTop: 'var(--sp-5)' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, frac * 100))}%`, height: '100%', background: color, borderRadius: 'var(--r-999)' }} />
    </div>
  );
}

function LineChart({ series, dates, height = 250, log = false, yFmt }) {
  const [hov, setHov] = useState(null);
  /* One user unit = one CSS pixel — a fixed 1000-unit canvas stretched to the
     card rendered these labels at 16.3px (Joe, 2026-09-09). */
  const [wrapRef, W] = useChartWidth(1000);
  const H = height, padL = 8, padR = 74, padT = 12, padB = 26;
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
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', maxWidth: '100%' }} role="img" aria-label="performance chart">
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke={HAIR} />
            {endYs.every((ey) => Math.abs(y(gv) - ey) > 16) ? (
              <text x={W - padR + 6} y={y(gv) + 4} fontSize="11" fill={INK3}>{fmt(gv)}</text>
            ) : null}
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize="11" fill={INK3}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dateLbl(i)}</text>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity || 1} />
        ))}
        {series.map((s) => (
          <text key={`${s.name}-end`} x={W - padR + 6} y={y(s.values[s.values.length - 1]) + 4} fontSize="13" fontWeight="600" fill={s.color}>
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
          background: CARD2, border: `1px solid ${EDGE}`, borderRadius: 'var(--r-10)',
          padding: 'var(--sp-8) var(--sp-11)', pointerEvents: 'none', boxShadow: 'var(--sh)',
          fontSize: 'var(--v13-t3)', whiteSpace: 'nowrap', zIndex: 5, color: INK,
        }}>
          <div style={{ color: INK3, marginBottom: 'var(--sp-4)' }}>{dateLbl(hov)}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-7)', padding: 'var(--sp-1) 0' }}>
              <span style={{ width: 12, height: 2.5, background: s.color, borderRadius: 'var(--r-2)', flex: 'none' }} />
              <span style={{ fontWeight: 'var(--fw-600)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.values[hov])}</span>
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
    // A legend sits at its natural width under its chart — declared so the
    // layout check does not read it as a jammed row. See scripts/check_layout.mjs.
    <div data-layout="natural" style={{ display: 'flex', gap: 'var(--sp-20)', flexWrap: 'wrap', marginTop: 'var(--sp-10)' }}>
      {items.map(([name, color]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-7)', fontSize: 'var(--v13-t3)', color: INK2 }}>
          <span style={{ width: 16, height: 3, background: color, borderRadius: 'var(--r-2)', display: 'inline-block' }} />{name}
        </div>
      ))}
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

const th = { textAlign: 'right', padding: 'var(--sp-9) var(--sp-10)', fontSize: 'var(--v13-t1)', fontWeight: 'var(--fw-600)', letterSpacing: '0.09em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td = { textAlign: 'right', padding: 'var(--sp-10) var(--sp-10)', fontSize: 'var(--v13-t3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };


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
  // 2026-09-01: `auto-fit` fits as many 1fr tracks as the width allows, so a
  // six-item row in a 1432px frame got EIGHT equal tracks and two of them sat
  // empty — 440px of dead space. When the item count is known, state it; pass
  // `n` and the row spreads across exactly that many columns and no more.
  // scripts/check_layout.mjs fails the build on an empty track.
  const grid = (min, gap = 14, n = null) => ({ // kept for the stat grids
    display: 'grid',
    gridTemplateColumns: n
      ? `repeat(${n}, minmax(0, 1fr))`
      : `repeat(auto-fit, minmax(${min}px, 1fr))`,
    gap,
  });

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
  const [growthRef, growthH] = useFillHeight(204);
  const [btRef, btH] = useFillHeight(204);
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

  if (loading) {
    return (
      <div className="home-v12 v13 paper-v12">
        <style>{CSS}</style>
        <div className="wrap qtt" style={{ padding: 'var(--sp-44) var(--sp-40) var(--sp-96)', minHeight: '70vh' }}>
          <div className="eyebrow2" style={{ marginBottom: 'var(--sp-10)' }}>
            <span className="dot" />
            Paper Portfolio
          </div>
          <h1 className="serif" style={{ fontSize: 'var(--v13-t6)', lineHeight: 1.08, margin: 0 }}>
            Quality Trend<em style={{ fontStyle: 'italic', color: GOLD }}>.</em>
          </h1>
          <div aria-live="polite" style={{ marginTop: 'var(--sp-26)', fontSize: 'var(--v13-t3)', color: INK3 }}>{err ? `The book could not be loaded (${err}). Refresh to retry.` : 'Loading the book…'}</div>
        </div>
      </div>
    );
  }

  const periods = [
    { id: 'day', label: 'Day', sub: dayShort },
    { id: 'ytd', label: 'YTD', sub: perf ? (perf.ytdFromStart ? (inceptionShort ? `from ${inceptionShort}` : 'from start') : perf.year) : '' },
    { id: 'since', label: 'Inception', sub: inceptionShort ? `since ${inceptionShort}` : '' },
  ];
  const perfRows = perf ? perf.rows : PERF_ROWS.map((r) => ({ ...r, day: {}, ytd: {}, since: {} }));
  const cellUsd = (c) => (c?.usd == null ? '—' : fmtSignedUsd(c.usd));
  const cellPct = (c) => (c?.pct == null ? '—' : fmtPct(c.pct, 2));
  const cellTone = (c) => (c?.usd == null ? INK : upDown(c.usd));
  const cr = cockpit.risk; const dc = cockpit.decomp;
  const riskNote = cockpit.status === 'loading' ? 'loading…'
    : cockpit.status === 'error' ? 'risk figures could not be loaded — refresh to retry'
      : cockpit.row == null ? 'risk figures print after the first close'
        : null;
  const needsDays = (want) => `prints after ${Math.max(want - (cockpit.have || 0), 0)} more sessions of price history`;

  // Monthly returns, transposed for a column: one row per month, one column
  // per year (the book is weeks old; a 13-column row would scroll).
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
    const years = [...new Set(Object.keys(months).map((k) => k.slice(0, 4)))].sort();
    const ytd = {};
    years.forEach((y) => { let acc = 1; for (let i = 1; i <= 12; i++) { const v = months[`${y}-${String(i).padStart(2, '0')}`]; if (v != null) acc *= 1 + v; } ytd[y] = acc - 1; });
    // Only the months since the book began (in its first year) — ten rows of
    // dots before the first print is not a matrix, it is padding.
    const keys = Object.keys(months).sort();
    const firstMonth = keys.length && years.length === 1 ? Number(keys[0].slice(5, 7)) - 1 : null;
    return { months, years, ytd, firstMonth };
  })();
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const benchCols = [
    { k: 'live', h: 'Book', sub: inceptionShort ? `since ${inceptionShort}` : '', v: { ret: ls ? fmtPct(ls.since, 2) : '—', vol: ls?.vol != null ? fmtPctPlain(ls.vol) : '—', sharpe: ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—', sortino: '—', maxdd: ls ? fmtPctPlain(ls.maxdd) : '—', worst: '—' }, retTone: upDown(ls?.since) },
    { k: 'spx', h: 'S&P 500', sub: 'same days', v: { ret: ls?.spxSince != null ? fmtPct(ls.spxSince, 2) : '—', vol: '—', sharpe: '—', sortino: '—', maxdd: '—', worst: '—' } },
    { k: 'bt', h: 'Book', sub: '40 names', v: { ret: BT_STATS.cagr, vol: BT_STATS.vol, sharpe: BT_STATS.sharpe, sortino: BT_STATS.sortino, maxdd: BT_STATS.maxdd, worst: BT_STATS.worst } },
    { k: 'btspx', h: 'S&P 500', sub: '2017–26', v: { ret: BT_SPX.cagr, vol: BT_SPX.vol, sharpe: BT_SPX.sharpe, sortino: BT_SPX.sortino, maxdd: BT_SPX.maxdd, worst: BT_SPX.worst } },
  ];
  const benchRows = [
    ['ret', 'Return', null], ['vol', 'Volatility', TIPS.vol], ['sharpe', 'Sharpe', TIPS.sharpe], ['sortino', 'Sortino', TIPS.sortino], ['maxdd', 'Max drawdown', TIPS.maxdd], ['worst', 'Worst year', TIPS.worst],
  ];

  return (
    <div className="home-v12 v13 paper-v12">
      <style>{CSS}</style>
      <div className="wrap qtt" style={{ padding: 'var(--sp-44) var(--sp-40) var(--sp-96)' }}>

        {/* ── page header, one line of context each side ─────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-10)', marginBottom: 'var(--lg-gap)' }}>
          <div>
            <div className="eyebrow2" style={{ marginBottom: 'var(--sp-6)' }}>
              <span className="dot" />
              {bookIsLive
                ? `Paper Portfolio · live · marks sync every 10 min in market hours${markedAt ? ` · ${markedAt}` : ''}`
                : `Paper Portfolio · closed book · retired ${RETIRED_ON}${markedAt ? ` · final ${markedAt.replace(/^marked /, 'marks ')}` : ''}`}
            </div>
            <h1 className="serif" style={{ fontSize: 'var(--v13-t6)', lineHeight: 1.08, margin: 0 }}>
              Quality Trend<em style={{ fontStyle: 'italic', color: GOLD }}>.</em>
            </h1>
          </div>
          <div style={{ textAlign: 'right', fontSize: 'var(--v13-t2)', color: INK2, lineHeight: 1.6 }}>
            {bookIsLive
              ? '20 US companies · equal weight · monthly rebalance · crash brake · no leverage'
              : '40 US companies · equal weight · monthly rebalance · no leverage'}
            <br />
            {bookIsLive && brake && (
              <>
                {brake.stress_on
                  ? `Crash brake ON — book in cash · bond-market stress ${Number(brake.composite).toFixed(2)} (back in below 0.80)`
                  : `Crash brake off · bond-market stress ${Number(brake.composite).toFixed(2)} (to cash above 0.95, two days running)`}
                {' · '}
                <Link to="/methodology#portfolio" className="ck-link">how it works</Link>
                <br />
              </>
            )}
            {bookIsLive
              ? `$1,000,000 paper account, inception ${inceptionD ? fmtDate(inceptionD) : '—'}`
              : `$1,000,000 paper account, ${bookRan || 'now closed'} · closed`}{' · '}
            <Link to="/methodology#portfolio" className="ck-link" style={{ fontWeight: 'var(--fw-600)' }}>Methodology</Link>
            {' · '}<span style={{ color: INK3 }}>Paper money — not investment advice.</span>
          </div>
        </div>

        {/* ── retired notice (closed book only) ─────────────────────────── */}
        {!bookIsLive && <div style={{
          border: `1px solid ${EDGE}`, borderLeft: `3px solid ${GOLD}`,
          borderRadius: 'var(--card-r)', background: CARD2,
          padding: 'var(--sp-14) var(--sp-18)', marginBottom: 'var(--lg-gap)', maxWidth: '96ch',
        }}>
          <div style={{ fontSize: 'var(--v13-t1)', fontWeight: 'var(--fw-700)', letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD, marginBottom: 'var(--sp-6)' }}>
            Retired — nothing here is trading
          </div>
          <div style={{ fontSize: 'var(--v13-t3)', lineHeight: 1.6, color: INK2, maxWidth: '72ch' }}>
            <strong style={{ color: CREAM_INK }}>The paper account today holds $1,000,000
            in cash and owns nothing.</strong> Every number below belongs to a DIFFERENT,
            now-deleted account — the one that ran {bookRan || 'until it was closed'}. It is
            history, not a position, and nobody is down any money today.
            <br /><br />
            Quality Trend was retired on {RETIRED_ON}. Read the closing figure with one
            caveat: the book was liquidated in error on its final day, so a large part of
            that last move is an operating mistake rather than the strategy losing money.
          </div>
        </div>}

        {/* ── the ribbon: four facts, pinned under the top bar ──────────── */}
        <div className="qtt-card ck-ribbon" style={{ borderRadius: 'var(--card-r)', boxShadow: 'var(--sh)', padding: 'var(--sp-12) var(--sp-18)' }}>
          <div className="ck-stat">
            <div className="ck-eyebrow">Portfolio value</div>
            <div className="num ck-hero">{fmtUsd(equity)}</div>
            <div className="ck-sub">{priceBasis ? (bookIsLive ? priceBasis : `final · ${priceBasis}`) : 'at inception'}</div>
          </div>
          <div className="ck-stat">
            <div className="ck-eyebrow">Exposure</div>
            <div className="num ck-hero">{latestNav ? fmtPctPlain(invested, 1) : '—'}</div>
            <div className="ck-sub">gross · net long · cash {fmtUsd(cash)}</div>
          </div>
          <div className="ck-stat">
            <div className="ck-eyebrow"><Term tip={RISK_TIPS.sharpe} placement="bottom" wide labelOpacity={1}>Sharpe ratio</Term></div>
            <div className="num ck-hero">{ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—'}</div>
            <div className="ck-sub">{ls?.sharpe == null ? `${(ls?.n ?? 0) + 1} of 60 marks — prints at 60` : 'since inception · vs ~4% cash'}</div>
          </div>
          <div className="ck-stat">
            <div className="ck-eyebrow"><Term tip={RISK_TIPS.var} placement="bottom" wide alignRight labelOpacity={1}>10-day Value at Risk</Term></div>
            <div className="num ck-hero">{cr ? `−${fmtUsd(cr.var10 * equity)}` : '—'}</div>
            <div className="ck-sub">{cr ? `${fmtPctPlain(cr.var10, 1)} of the book · 99% · as of ${riskAsOf}` : (riskNote || needsDays(250))}</div>
          </div>
        </div>

        {/* ── three columns ─────────────────────────────────────────────── */}
        <div className="ck-grid">

          {/* ════ column 1 — performance & progress ════ */}
          <div className="ck-col ck-col-1">
            <Card title="Performance" right={ls ? `${(ls.n ?? 0) + 1} ${(ls.n ?? 0) + 1 === 1 ? 'mark' : 'marks'}` : 'no marks yet'}>
              <table className="ck-table num">
                <thead>
                  <tr>
                    <th />
                    {periods.map((p) => (
                      <th key={p.id}>{p.label}<span style={{ display: 'block', fontWeight: 'var(--fw-400)', letterSpacing: 0, textTransform: 'none' }}>{p.sub}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perfRows.map((r) => (
                    <tr key={r.id} className={r.id === 'paper' ? 'ck-strong' : ''}>
                      <td style={{ color: r.id === 'paper' ? INK : INK2 }}>{r.label}</td>
                      {periods.map((p) => (
                        <td key={p.id} style={{ color: cellTone(r[p.id]) }}>
                          {cellPct(r[p.id])}
                          <span style={{ display: 'block', fontSize: 'var(--v13-t1)', fontWeight: 'var(--fw-400)', opacity: 0.8 }}>{cellUsd(r[p.id])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ck-note">
                Index rows: $1,000,000 in each index’s fund (SPY, QQQ, DIA) at the close before the book’s first day.
                {perf && perf.ytdFromStart ? ' The book started this year, so YTD and Inception match until January.' : ''}
              </div>
            </Card>

            <Card title="Growth · indexed to 100" right={priceBasis || 'no marks yet'} fill>
              <div ref={growthRef} className="ck-chartfill">
                {liveCurve ? (
                  <>
                    <LineChart
                      height={Math.max(growthH - 34, 150)}
                      series={[
                        { name: 'Quality Trend', color: GOLD, values: liveCurve.strategy },
                        ...(liveCurve.spx ? [{ name: 'S&P 500', color: BLUE, values: liveCurve.spx, width: 1.8, opacity: 0.9 }] : []),
                      ]}
                      dates={heldNav.map((r) => r.d)}
                      yFmt={(v) => v.toFixed(1)}
                    />
                    <ChartLegend items={[['Quality Trend', GOLD], ['S&P 500', BLUE]]} />
                  </>
                ) : (
                  <div style={{ padding: 'var(--sp-10) 0', fontSize: 'var(--v13-t3)', lineHeight: 1.6, color: INK2 }}>
                    The live line starts drawing at the second daily mark.
                  </div>
                )}
              </div>
              <div className="ck-stats" style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 'var(--sp-8)', marginTop: 'var(--sp-8)' }}>
                {[
                  [<Term key="v" tip={TIPS.vol} labelOpacity={0.9}>Volatility</Term>, ls?.vol != null ? fmtPctPlain(ls.vol) : '—', ls?.vol == null ? needs(ls?.n ?? 0, 20) : 'annualized'],
                  [<Term key="b" tip={TIPS.beta} labelOpacity={0.9}>Beta vs S&P</Term>, ls?.beta != null ? ls.beta.toFixed(2) : '—', ls?.beta == null ? needs(ls?.n ?? 0, 20) : 'daily marks'],
                  [<Term key="t" tip={TIPS.te} labelOpacity={0.9}>Tracking error</Term>, ls?.te != null ? fmtPctPlain(ls.te) : '—', ls?.te == null ? needs(ls?.n ?? 0, 20) : 'ann., vs S&P'],
                  [<Term key="i" tip={TIPS.ir} labelOpacity={0.9}>Information ratio</Term>, ls?.ir != null ? ls.ir.toFixed(2) : '—', ls?.ir == null ? needs(ls?.n ?? 0, 20) : 'vs S&P, annualized'],
                  [<Term key="d" tip={TIPS.maxdd} labelOpacity={0.9}>Max drawdown</Term>, ls ? fmtPctPlain(ls.maxdd) : '—', 'mark-to-mark'],
                  [<Term key="p" tip={TIPS.ddpeak} labelOpacity={0.9}>Off peak</Term>, ls ? fmtPctPlain(ls.ddFromPeak, 2) : '—', 'equity vs own high'],
                  ['Best day', ls?.bestDay != null ? fmtPct(ls.bestDay, 2) : '—', ls?.bestDay == null ? needs(ls?.n ?? 0, 2) : 'close-to-close'],
                  ['Worst day', ls?.worstDay != null ? fmtPct(ls.worstDay, 2) : '—', ls?.worstDay == null ? needs(ls?.n ?? 0, 2) : 'close-to-close'],
                  ['% up days', ls?.pctUp != null ? fmtPctPlain(ls.pctUp, 0) : '—', ls?.pctUp == null ? needs(ls?.n ?? 0, 2) : 'of trading days'],
                ].map(([label, value, sub], i) => (
                  <div key={i}>
                    <div className="ck-stat-k">{label}</div>
                    <div className="ck-stat-v">{value}</div>
                    <div className="ck-stat-s">{sub}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title={bookIsLive ? 'Net monthly returns' : 'Net monthly returns — closed book'} right="net paper returns">
              {monthly.years.length ? (
                <table className="ck-table num">
                  <thead>
                    <tr><th>Month</th>{monthly.years.map((y) => <th key={y}>{y}</th>)}</tr>
                  </thead>
                  <tbody>
                    {MN.map((m, i) => (monthly.firstMonth != null && i < monthly.firstMonth ? null : (
                      <tr key={m}>
                        <td style={{ color: INK2 }}>{m}</td>
                        {monthly.years.map((y) => {
                          const v = monthly.months[`${y}-${String(i + 1).padStart(2, '0')}`];
                          return <td key={y} style={{ color: v == null ? INK3 : upDown(v) }}>{v == null ? '·' : fmtPct(v, 1)}</td>;
                        })}
                      </tr>
                    )))}
                    <tr className="ck-strong">
                      <td>YTD</td>
                      {monthly.years.map((y) => <td key={y} style={{ color: upDown(monthly.ytd[y]) }}>{fmtPct(monthly.ytd[y], 1)}</td>)}
                    </tr>
                  </tbody>
                </table>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>The first month prints after the first close.</div>}
            </Card>

            <Card title="Risk & return" right="live book vs the S&P 500 · then the backtest">
              {[
                { id: 'live', head: bookIsLive ? 'Live book' : 'Closed book', sub: inceptionShort ? `since ${inceptionShort}, same days` : '', a: benchCols[0], b: benchCols[1] },
                { id: 'bt', head: 'Backtest · 40 names', sub: 'Feb 2017 – Aug 2026, annualized', a: benchCols[2], b: benchCols[3] },
              ].map((blk, bi) => (
                <table className="ck-table" key={blk.id} style={bi ? { marginTop: 'var(--sp-10)' } : undefined}>
                  <thead>
                    <tr>
                      <th style={{ textTransform: 'none', letterSpacing: 0 }}><span style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>{blk.head}</span><span style={{ display: 'block', fontWeight: 'var(--fw-400)' }}>{blk.sub}</span></th>
                      <th>{blk.a.h}</th>
                      <th>S&P 500</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchRows.filter(([k]) => blk.id === 'bt' || blk.a.v[k] !== '—' || blk.b.v[k] !== '—').map(([k, label, tip]) => (
                      <tr key={k} className={k === 'ret' ? 'ck-strong' : ''}>
                        <td style={{ color: INK2 }}>{tip ? <Term tip={tip} labelOpacity={0.9}>{label}</Term> : label}</td>
                        <td className="num" style={{ color: k === 'ret' && blk.a.retTone ? blk.a.retTone : INK }}>{blk.a.v[k]}</td>
                        <td className="num" style={{ color: INK2 }}>{blk.b.v[k]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
              <div className="ck-note">
                Live figures need 20 marks (volatility, drawdown) or 60 (Sharpe) before they print; the S&P 500 is measured over the same days.
                Backtest <Term tip={TIPS.ir}>information ratio</Term> {BT_STATS.ir}.
              </div>
            </Card>

          </div>

          {/* ════ column 2 — style factors & variance risk budgeting ════ */}
          <div className="ck-col ck-col-2">
            <Card title="Risk & exception alerts" right={cockpit.alerts ? `${cockpit.alerts.length} flagged · as of ${riskAsOf || markedAt || ''}` : ''}>
              {cockpit.alerts ? (
                cockpit.alerts.length ? cockpit.alerts.map((a, i) => (
                  <div className={`ck-alert ${a.level}`} key={`${a.code}-${a.sym || i}`}>
                    <span className="ck-alert-code">{a.code}</span>
                    <span>{a.sym ? <button type="button" onClick={() => onOpenTicker && onOpenTicker(a.sym)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: INK, fontWeight: 'var(--fw-700)' }}>{a.sym}</button> : null}{a.sym ? ' — ' : ''}{a.text.replace(new RegExp(`^${a.sym} `), '')}</span>
                  </div>
                )) : <div style={{ fontSize: 'var(--v13-t3)', color: INK2 }}>No exceptions — every name inside its risk, weight and liquidity limits; cash positive; brake off.</div>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>{riskNote || 'Alerts print with the risk figures.'}</div>}
              <div className="ck-note">
                What gets flagged: a stock whose share of the book’s risk is more than double its share of the money · a position more than 1.5× its 5% target · the book 10% below its own high · the book more than 105% invested (borrowing over 5% of its equity) · the crash brake switched on · a stock that would take more than a day to sell · a stock with less than a year of price history.
              </div>
            </Card>
            <Card title="Variance risk decomposition" right={dc ? `β ${dc.beta.toFixed(2)} · 252 sessions to ${riskAsOf}` : ''}>
              {dc ? (
                <>
                  <div className="ck-stack">
                    <span style={{ width: `${dc.market * 100}%`, background: GOLD }} />
                    <span style={{ width: `${dc.style * 100}%`, background: BLUE }} />
                    <span style={{ width: `${dc.specific * 100}%`, background: 'color-mix(in srgb, var(--ink) 22%, transparent)' }} />
                  </div>
                  {[
                    ['market', 'Systematic market risk', dc.market, GOLD],
                    ['style', 'Style factor exposure', dc.style, BLUE],
                    ['specific', 'Idiosyncratic selection', dc.specific, 'color-mix(in srgb, var(--ink) 22%, transparent)'],
                  ].map(([k, label, v, color]) => (
                    <div className="ck-row" key={k} style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 'var(--r-2)', background: color, display: 'inline-block' }} />
                      <div><Term tip={RISK_TIPS[k]} placement="bottom" wide labelOpacity={0.95}>{label}</Term></div>
                      <div className="num" style={{ fontWeight: 'var(--fw-700)' }}>{fmtPctPlain(v, 1)}</div>
                    </div>
                  ))}
                  <div className="ck-note">
                    Book volatility {fmtPctPlain(cr.vol, 1)} annualized at today’s weights; the market explains {fmtPctPlain(dc.r2Market, 0)} of daily moves.
                    Style funds: MTUM, QUAL, PKW, IWM, VLUE.
                  </div>
                </>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>{riskNote || needsDays(250)}</div>}
            </Card>

            <Card title="Historical shock stress" right={dc ? `projected at β ${dc.beta.toFixed(2)}` : ''}>
              {cockpit.shocks ? (
                <>
                  <table className="ck-table">
                    <thead><tr><th>Scenario</th><th>S&P 500</th><th>Book</th></tr></thead>
                    <tbody>
                      {cockpit.shocks.map((e) => (
                        <tr key={e.id}>
                          <td style={{ color: INK2, whiteSpace: 'normal' }}><Term tip={RISK_TIPS.stress} placement="bottom" wide labelOpacity={0.95}>{e.label}</Term></td>
                          <td className="num" style={{ color: INK2 }}>{e.index == null ? '—' : fmtPct(e.index, 1)}</td>
                          <td className="num" style={{ color: BADBR, fontWeight: 'var(--fw-700)' }}>{e.book == null ? '—' : fmtPct(e.book, 1)}</td>
                        </tr>
                      ))}
                      {cockpit.vix && (
                        <tr>
                          <td style={{ color: INK2, whiteSpace: 'normal' }}><Term tip={RISK_TIPS.vixshock} placement="bottom" wide labelOpacity={0.95}>VIX spike to 40 (from {Number(cockpit.vix.vix_now ?? cockpit.vix.vixNow).toFixed(1)})</Term></td>
                          <td className="num" style={{ color: INK2 }}>{fmtPct(cockpit.vix.index, 1)}</td>
                          <td className="num" style={{ color: BADBR, fontWeight: 'var(--fw-700)' }}>{fmtPct(cockpit.vix.book, 1)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="ck-note">
                    Each episode is the S&P 500 fund’s actual peak-to-trough fall, read from the price feed, scaled by the book’s one-year beta — a projection, not a backtest.
                    {cockpit.vix ? ` The VIX line uses the fund’s measured elasticity to fear (${Number(cockpit.vix.elasticity).toFixed(3)} per unit of ln VIX, ${Number(cockpit.vix.n).toLocaleString()} days).` : ''}
                  </div>
                </>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>{riskNote || needsDays(250)}</div>}
            </Card>

            <Card title="Active style factor loading" right={cockpit.factorLoading ? `vs 500 largest US stocks · scored ${fmtDate(rebalDate)}` : ''}>
              {cockpit.factorLoading && FACTOR_ORDER.some((f) => cockpit.factorLoading[f]) ? (
                <>
                  {FACTOR_ORDER.map((f) => {
                    const L = cockpit.factorLoading[f];
                    const a = L?.active;
                    const pct = a == null ? 0 : Math.min(Math.abs(a) / 2.5, 1) * 50;
                    return (
                      <div className="ck-row" key={f}>
                        <div><Term tip={RISK_TIPS[f]} placement="bottom" wide labelOpacity={0.95}>{FACTOR_NAMES[f]}</Term></div>
                        <div className="ck-bar diverge">
                          {a != null && <span style={{ left: a >= 0 ? '50%' : `${50 - pct}%`, width: `${pct}%`, background: a >= 0 ? GOLD : BLUE }} />}
                        </div>
                        <div className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 'var(--fw-700)' }}>{a == null ? '—' : `${a >= 0 ? '+' : '−'}${Math.abs(a).toFixed(2)}`}</span>
                          <span style={{ display: 'block', fontSize: 'var(--v13-t1)', color: INK3 }}>{L ? `book ${L.book >= 0 ? '+' : '−'}${Math.abs(L.book).toFixed(2)} · index ${L.bench >= 0 ? '+' : '−'}${Math.abs(L.bench).toFixed(2)}` : 'no data'}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="ck-note">
                    Active z-score = the book’s weighted z minus the cap-weighted z of the 500 largest US common stocks (the site holds no official
                    S&P 500 list; this is the nearest honest proxy). Gold = more than the index, slate = less. ±1 is one standard deviation of that universe.
                  </div>
                </>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>{cockpit.status === 'loading' ? 'Loading…' : 'Factor scores print with the next monthly scoring.'}</div>}
            </Card>

            <Card
              title="Backtest · growth of $1,000,000"
              fill
              right={
                <span style={{ display: 'inline-flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
                  {['1Y', '3Y', '5Y', 'All'].map((r) => (
                    <button key={r} type="button" className={`qtt-pill${btRange === r ? ' on' : ''}`} onClick={() => setBtRange(r)}>{r}</button>
                  ))}
                </span>
              }
            >
              <div ref={btRef} className="ck-chartfill">
              <LineChart
                log
                height={Math.max(btH - 34, 150)}
                series={[
                  { name: 'Quality Trend', color: GOLD, values: btSlice.strategy },
                  { name: 'S&P 500', color: BLUE, values: btSlice.spx, width: 1.8, opacity: 0.9 },
                ]}
                dates={btSlice.dates}
              />
              <ChartLegend items={[['Quality Trend', GOLD], ['S&P 500', BLUE]]} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-12)', marginTop: 'var(--sp-8)' }}>
                {[Object.entries(BT.years).slice(0, 5), Object.entries(BT.years).slice(5)].map((half, hi) => (
                  <table className="ck-table ck-tight num" key={hi}>
                    <thead><tr><th>Year</th><th>QT</th><th>S&P</th></tr></thead>
                    <tbody>
                      {half.map(([y, r]) => (
                        <tr key={y}>
                          <td style={{ color: INK2 }}>{y === '2026' ? '2026*' : y}</td>
                          <td style={{ color: r.strategy >= 0 ? INK : BADBR, fontWeight: r.strategy >= r.spx ? 'var(--fw-700)' : 'var(--fw-400)' }}>{r.strategy > 0 ? '+' : ''}{r.strategy.toFixed(1)}%</td>
                          <td style={{ color: r.spx >= 0 ? INK2 : BADBR }}>{r.spx > 0 ? '+' : ''}{r.spx.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
              <div className="ck-note">
                *2026 through Aug 11. Bold = beat the index that year (7 of 10). Survivorship-free, log scale, 40bp costs;
                a backtest is not a live record and the live book should be expected to run below it.
              </div>
            </Card>
          </div>

          {/* ════ column 3 — the ledger ════ */}
          <div className="ck-col ck-col-3">
            <Card
              title={nothingHeld ? 'Target book — nothing held' : 'Holdings'}
              right={nothingHeld
                ? `${book?.length ?? 0} names scored, not owned · ${fmtDate(rebalDate)}`
                : bookIsLive ? (priceBasis || 'no marks yet') : `final holdings · ${priceBasis || ''}`}
            >
              {nothingHeld && !err && book && book.length ? (
                <div style={{ margin: '0 0 var(--sp-10)', padding: 'var(--sp-8) var(--sp-10)', borderRadius: 'var(--r-10)', background: 'var(--c-b8975c-a10)', border: '1px solid var(--c-b8975c-a45)', fontSize: 'var(--v13-t2)', lineHeight: 1.5, color: INK2 }}>
                  <strong>These are not holdings.</strong> The account holds no shares — the list is what the model scored, i.e. what it intends to buy.
                </div>
              ) : null}
              {err ? (
                <div style={{ padding: 'var(--sp-12)', fontSize: 'var(--v13-t3)', color: INK2 }}>The book could not be loaded ({err}). Refresh to retry.</div>
              ) : !book ? (
                <div style={{ padding: 'var(--sp-12)', fontSize: 'var(--v13-t3)', color: INK3 }}>Loading…</div>
              ) : (
                <>
                  <DataTable
                    id="paper-cockpit-holdings"
                    columns={holdingsColumns}
                    rows={filteredBook}
                    rowKey={(r) => r.symbol}
                    initialSort={{ key: 'weight', dir: 'desc' }}
                    toolbarLeft={
                      <input className="qtt-search" type="search" placeholder="Filter ticker or name…"
                        value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter holdings" />
                    }
                  />
                  {query && filteredBook.length === 0 && (
                    <div style={{ padding: 'var(--sp-10)', fontSize: 'var(--v13-t3)', color: INK3 }}>No holdings match “{query}”.</div>
                  )}
                  <div className="ck-note">
                    Risk share is how much of the book’s day-to-day swings come from each stock (the twenty add up to 100%); amber = more than double its share of the money. Style = the tilt the stock brings most strongly. Marks and P&L are the paper broker’s official records at the last sync. Columns can be sorted, dragged,
                    resized and shown or hidden under “Columns”.
                  </div>
                </>
              )}
            </Card>

            <Card title={attribution ? (attribution.isDay ? `Contributors & detractors — ${daySession}` : 'Contributors & detractors — since entry') : 'Contributors & detractors'}
              right={<Term tip={TIPS.contrib} labelOpacity={0.9}>bp of portfolio</Term>}>
              {attribution ? (
                <div className="ck-twoup">
                  {[['Top 5', attribution.top], ['Bottom 5', attribution.bottom]].map(([lbl, rows]) => (
                    <table className="ck-table num" key={lbl}>
                      <thead><tr><th>{lbl}</th><th>bp</th><th>$</th></tr></thead>
                      <tbody>
                        {rows.map((p) => (
                          <tr key={p.s} className="qtt-row" onClick={() => onOpenTicker && onOpenTicker(p.s)} style={{ cursor: 'pointer' }}>
                            <td style={{ fontWeight: 'var(--fw-700)', color: INK }}>{p.s}</td>
                            <td style={{ color: upDown(p.bp) }}>{p.bp > 0 ? '+' : ''}{p.bp.toFixed(1)}</td>
                            <td style={{ color: upDown(p.bp) }}>{fmtSignedUsd(p.usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>Populates from the first broker marks.</div>}
            </Card>

            <Card title="Market cap" right={bookMeta?.medMcap ? <span>median <Term tip={TIPS.mcap} labelOpacity={0.9}>${(bookMeta.medMcap / 1e9).toFixed(0)}B</Term></span> : ''}>
              {bookMeta ? (
                <>
                  {bookMeta.caps.map((b) => (
                    <div key={b.name} style={{ padding: 'var(--sp-3) 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--v13-t2)', marginBottom: 'var(--sp-2)' }}>
                        <span style={{ color: INK2 }}>{b.name}</span>
                        <span className="num" style={{ fontWeight: 'var(--fw-600)' }}>{fmtPctPlain(b.weight, 1)} <span style={{ color: INK3, fontWeight: 'var(--fw-400)' }}>· {b.n}</span></span>
                      </div>
                      <div className="ck-bar"><span style={{ left: 0, width: `${Math.min(b.weight * 100, 100)}%`, background: BLUE }} /></div>
                    </div>
                  ))}
                  <div className="ck-note">Share of the book by company size; the count is names in the bucket. Mega ≥ $200B · Large $10–200B · Mid $2–10B · Small &lt; $2B.</div>
                </>
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>Loading…</div>}
            </Card>

            <Card title="Sector & industry" right={bookMeta ? `${bookMeta.secList.length} sectors · ${bookMeta.nIndustries} of 74 industries` : ''}>
              {bookMeta ? (
                <div className="qtt-secgrid">
                  {bookMeta.secList.map((sec) => (
                    <div className="qtt-sectile" key={sec.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-4)' }}>
                        <span style={{ fontWeight: 'var(--fw-700)', fontSize: 'var(--v13-t2)', color: INK }}>{sec.name}</span>
                        <span className="num" style={{ fontSize: 'var(--v13-t2)', fontWeight: 'var(--fw-700)' }}>{fmtPctPlain(sec.weight, 1)} <span style={{ color: INK3, fontWeight: 'var(--fw-400)' }}>· {sec.n}</span></span>
                      </div>
                      <div className="ck-bar" style={{ marginBottom: 'var(--sp-4)' }}><span style={{ left: 0, width: `${Math.min((sec.weight / (bookMeta.secList[0]?.weight || 1)) * 100, 100)}%`, background: GOLD }} /></div>
                      {sec.industries.map((ind) => (
                        <div key={ind.name} style={{ padding: 'var(--sp-3) 0', borderTop: `1px solid ${HAIR}`, fontSize: 'var(--v13-t1)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-6)' }}>
                            <span style={{ color: INK2 }}>{ind.name}</span>
                            <span className="num" style={{ color: INK2, whiteSpace: 'nowrap' }}>{fmtPctPlain(ind.weight, 1)}</span>
                          </div>
                          <div style={{ color: INK3, marginTop: 'var(--sp-1)' }}>
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
              ) : <div style={{ fontSize: 'var(--v13-t3)', color: INK3 }}>Loading…</div>}
            </Card>
          </div>
        </div>

        <div style={{ fontSize: 'var(--v13-t1)', color: INK3, marginTop: 'var(--lg-gap)', lineHeight: 1.6 }}>
          Scored on 12- and 6-month momentum (skipping the most recent month), trend consistency, drawdown resilience, gross profitability, cash generation and buybacks from point-in-time
          SEC filings, plus a bonus for meaningful insider buying. Risk figures are computed once after each close from one year of daily closes at that close’s weights, and re-derived in the repository’s calibration check;
          this page never estimates prices itself. Signal columns are as-of the scoring date.
        </div>
      </div>
    </div>
  );
}
