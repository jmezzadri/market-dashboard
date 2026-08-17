/* PaperPortfolioPage — the Quality Trend book as a portfolio manager's cockpit.

   2026-08-17 (Joe): "make it look and feel like a real portfolio manager's
   cockpit — total portfolio, performance, risk, comps to benchmarks."

   Layout, top to bottom:
     1. Command band — portfolio value, day P&L, since-inception vs S&P,
        exposure, positions.
     2. Performance — live equity curve vs S&P (indexed), with live stats
        that unlock honestly as history accrues (a Sharpe needs ~60 trading
        days; showing one after five is noise dressed as precision).
     3. Risk — exposure, cash, concentration, drawdown from peak, median
        holding volatility.
     4. Benchmark comp — live column and backtest column, side by side,
        each labeled for what it is. Live and backtest numbers are NEVER
        blended into one figure.
     5. Backtest reference — growth of $1M (log scale) + year-by-year vs
        the S&P. The BT constant below is the monthly equity curve of the
        validated run itself (survivorship-free, 2,011 delisted companies);
        its stats match paper_portfolio/QUALITY_TREND_V3.md to the digit
        (LESSONS 8.3: figures ship verbatim, never re-derived at render).
     6. Holdings — every name with weight, fill, mark, P&L, and the inputs
        that put it in the book.

   Data (all read-only, RLS-protected public tables):
     qt_target_book — the 40 names of the current rebalance (QT-REBALANCE)
     qt_orders      — order intents + fill state (QT-PLACE-ORDERS / QT-EOD-DAILY)
     qt_nav_daily   — one close snapshot per trading day incl. positions
                      jsonb + spy_close (QT-EOD-DAILY)

   Design: self-contained inline styles on the cream ground; neutral rgba
   grays so light/dark/navy themes all read; charts are handwritten SVG —
   no chart lib, nothing new to bundle. */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/* Monthly equity curve of the VALIDATED backtest run (Feb 2017 – Aug 2026),
   growth of $1,000,000. Generated 2026-08-17 from the locked V3 series;
   CAGR 21.2% vs 15.3%, Sharpe 0.97 vs 0.82, maxDD −19.3% vs −23.9%. */
const BT = {"dates":["2017-02-28","2017-03-31","2017-04-28","2017-05-31","2017-06-30","2017-07-31","2017-08-31","2017-09-29","2017-10-31","2017-11-30","2017-12-29","2018-01-31","2018-02-28","2018-03-29","2018-04-30","2018-05-31","2018-06-29","2018-07-31","2018-08-31","2018-09-28","2018-10-31","2018-11-30","2018-12-31","2019-01-31","2019-02-28","2019-03-29","2019-04-30","2019-05-31","2019-06-28","2019-07-31","2019-08-30","2019-09-30","2019-10-31","2019-11-29","2019-12-31","2020-01-31","2020-02-28","2020-03-31","2020-04-30","2020-05-29","2020-06-30","2020-07-31","2020-08-31","2020-09-30","2020-10-30","2020-11-30","2020-12-31","2021-01-29","2021-02-26","2021-03-31","2021-04-30","2021-05-28","2021-06-30","2021-07-30","2021-08-31","2021-09-30","2021-10-29","2021-11-30","2021-12-31","2022-01-31","2022-02-28","2022-03-31","2022-04-29","2022-05-31","2022-06-30","2022-07-29","2022-08-31","2022-09-30","2022-10-31","2022-11-30","2022-12-30","2023-01-31","2023-02-28","2023-03-31","2023-04-28","2023-05-31","2023-06-30","2023-07-31","2023-08-31","2023-09-29","2023-10-31","2023-11-30","2023-12-29","2024-01-31","2024-02-29","2024-03-28","2024-04-30","2024-05-31","2024-06-28","2024-07-31","2024-08-30","2024-09-30","2024-10-31","2024-11-29","2024-12-31","2025-01-31","2025-02-28","2025-03-31","2025-04-30","2025-05-30","2025-06-30","2025-07-31","2025-08-29","2025-09-30","2025-10-31","2025-11-28","2025-12-31","2026-01-30","2026-02-27","2026-03-31","2026-04-30","2026-05-29","2026-06-30","2026-07-31","2026-08-11"],
"strategy":[1047946,1058227,1068817,1093401,1103635,1123706,1128257,1163338,1199620,1244937,1274535,1354769,1298973,1300723,1291317,1329842,1341976,1352391,1416992,1417318,1289902,1298108,1275438,1361427,1416742,1418202,1481942,1394186,1489759,1518507,1481818,1470529,1502141,1552170,1609670,1618294,1500984,1355677,1543931,1610441,1614739,1697374,1801709,1731618,1721270,1971968,2009068,2006269,2043059,2130276,2258599,2262609,2275137,2280019,2352481,2276415,2419475,2402180,2577995,2437347,2408111,2521315,2400162,2404882,2205161,2378138,2313928,2224302,2338522,2426733,2404847,2545785,2481712,2417020,2411559,2394297,2537891,2612778,2551311,2503818,2434777,2597260,2790924,2848275,2966328,3070764,3110807,3200586,3210232,3277889,3336392,3357575,3459736,3708506,3711512,3703630,3660797,3448310,3336794,3510022,3629421,3760979,3844166,3844696,3922764,4097867,4098688,4271617,4416322,4820595,5104506,5586060,6039621,6117068,6331646],
"spx":[1039300,1040556,1050923,1065729,1072430,1094487,1097756,1119936,1146336,1181330,1194642,1262172,1216629,1183872,1189631,1218327,1225220,1270888,1310997,1318444,1228776,1251534,1136978,1228287,1267844,1290936,1343699,1258094,1345756,1365468,1343353,1367880,1397407,1447990,1489728,1489572,1367016,1197166,1350303,1414595,1440815,1525838,1636022,1573988,1533158,1700975,1763333,1745231,1793870,1872099,1972166,1985117,2028923,2077107,2141577,2041717,2185295,2168073,2264977,2146189,2085664,2163430,1974821,1978859,1815326,1982314,1902148,1730212,1870376,1972564,1856706,1973408,1922764,1993901,2025222,2034201,2168066,2237989,2201512,2098300,2054001,2241558,2343320,2382953,2508926,2589711,2481077,2603638,2689991,2721687,2779668,2837726,2839168,3006218,2916904,2996690,2837661,2828379,2811175,2988518,3141918,3210531,3277500,3222235,3311169,3332163,3402804,3499466,3419522,3554988,3401962,3612321,3833676,3757891,3915646],
"years":{"2017":{"strategy":32.2,"spx":19.6},"2018":{"strategy":0.1,"spx":-5.0},"2019":{"strategy":26.2,"spx":31.1},"2020":{"strategy":24.8,"spx":18.5},"2021":{"strategy":28.3,"spx":28.6},"2022":{"strategy":-6.7,"spx":-18.2},"2023":{"strategy":28.0,"spx":26.2},"2024":{"strategy":32.9,"spx":24.9},"2025":{"strategy":10.4,"spx":17.7},"2026":{"strategy":35.2,"spx":13.6}}};

const BT_STATS = { cagr: '21.2%', vol: '19.1%', sharpe: '0.97', sortino: '1.57', maxdd: '−19.3%', ir: '0.58', worst: '−6.7%' };
const BT_SPX   = { cagr: '15.3%', vol: '15.6%', sharpe: '0.82', sortino: '1.18', maxdd: '−23.9%', worst: '−18.2%' };

const BORDER = '1px solid rgba(128,128,128,0.25)';
const HAIRLINE = '1px solid rgba(128,128,128,0.16)';
const UP = 'var(--up, #1a7f4e)';
const DOWN = 'var(--down, #b3403a)';
const ACCENT = 'var(--mt-accent, #b08d4c)';
const MUTED = 'rgba(128,128,128,0.85)';

const fmtUsd = (v, dp = 0) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
const fmtSignedUsd = (v) =>
  v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtPct = (v, dp = 1) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${v > 0 ? '+' : ''}${(Number(v) * 100).toFixed(dp)}%`;
const fmtPctPlain = (v, dp = 1) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${(Number(v) * 100).toFixed(dp)}%`;
const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(`${String(d).slice(0, 10)}T12:00:00`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const pnlColor = (v) => (v == null ? 'inherit' : v >= 0 ? UP : DOWN);

/* ── tiny stat primitives ─────────────────────────────────────────────── */
function Label({ children, style }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.13em', textTransform: 'uppercase', opacity: 0.5, marginBottom: 7, ...style }}>
      {children}
    </div>
  );
}
function Stat({ label, value, sub, color, big }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ fontSize: big ? 27 : 21, fontWeight: 600, letterSpacing: '-0.01em', color: color || 'inherit', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub ? <div style={{ fontSize: 12.5, opacity: 0.55, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}
function Panel({ title, right, children, style }) {
  return (
    <div style={{ border: BORDER, borderRadius: 12, padding: '20px 22px', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Label style={{ marginBottom: 0 }}>{title}</Label>
        {right ? <div style={{ fontSize: 12, opacity: 0.5 }}>{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

/* ── handwritten SVG line chart ───────────────────────────────────────── */
function LineChart({ series, height = 240, log = false, yFmt }) {
  const W = 1000, H = height, padL = 8, padR = 66, padT = 10, padB = 22;
  const all = series.flatMap((s) => s.values).filter((v) => v > 0);
  if (!all.length) return null;
  const t = (v) => (log ? Math.log(v) : v);
  const lo = Math.min(...all.map(t)), hi = Math.max(...all.map(t));
  const n = series[0].values.length;
  const x = (i) => padL + (i / Math.max(n - 1, 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (t(v) - lo) / Math.max(hi - lo, 1e-9)) * (H - padT - padB);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const gridVals = [0.25, 0.5, 0.75].map((f) => (log ? Math.exp(lo + f * (hi - lo)) : lo + f * (hi - lo)));
  const fmt = yFmt || ((v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`));
  // Skip a gridline's y-axis label when a series end-label would sit on top of
  // it (the line itself still draws) — otherwise $4.9M prints over the S&P's
  // end value at the right edge.
  const endYs = series.map((s) => y(s.values[s.values.length - 1]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="performance chart">
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="rgba(128,128,128,0.18)" strokeDasharray="3 5" />
          {endYs.every((ey) => Math.abs(y(gv) - ey) > 16) ? (
            <text x={W - padR + 6} y={y(gv) + 4} fontSize="12" fill="rgba(128,128,128,0.8)">{fmt(gv)}</text>
          ) : null}
        </g>
      ))}
      {series.map((s) => (
        <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity || 1} />
      ))}
      {series.map((s) => (
        <text key={`${s.name}-end`} x={W - padR + 6} y={y(s.values[s.values.length - 1]) + 4} fontSize="12.5" fontWeight="600" fill={s.color}>
          {fmt(s.values[s.values.length - 1])}
        </text>
      ))}
    </svg>
  );
}
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
      {items.map(([name, color]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, opacity: 0.75 }}>
          <span style={{ width: 16, height: 3, background: color, borderRadius: 2, display: 'inline-block' }} />{name}
        </div>
      ))}
    </div>
  );
}

/* ── live-statistics helpers (all from qt_nav_daily) ──────────────────── */
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
  let peak = -Infinity, mdd = 0;
  eq.forEach((v) => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
  const out = {
    n,
    since: eq[eq.length - 1] / 1_000_000 - 1,
    spxSince: spx[0] != null && spx[spx.length - 1] != null ? spx[spx.length - 1] / spx[0] - 1 : null,
    day: n >= 1 ? eq[eq.length - 1] - eq[eq.length - 2] : null,
    dayPct: n >= 1 ? ret[n - 1] : null,
    ddFromPeak: eq[eq.length - 1] / peak - 1,
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
    const rf = 0.04 / 252;                       // T-bill approx; footnoted
    out.sharpe = (mean(ret) - rf) / sd(ret) * Math.sqrt(252);
  }
  return out;
}

const th = { textAlign: 'right', padding: '8px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', opacity: 0.5, whiteSpace: 'nowrap' };
const td = { textAlign: 'right', padding: '9px 10px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/* ══════════════════════════════════════════════════════════════════════ */
export default function PaperPortfolioPage({ onOpenTicker }) {
  const [book, setBook] = useState(null);
  const [orders, setOrders] = useState({});
  const [nav, setNav] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { data: latest, error: e1 } = await supabase
          .from('qt_target_book').select('rebalance_date')
          .order('rebalance_date', { ascending: false }).limit(1);
        if (e1) throw e1;
        const rd = latest?.[0]?.rebalance_date;
        const [bk, od, nv] = await Promise.all([
          rd ? supabase.from('qt_target_book').select('*').eq('rebalance_date', rd).order('rank') : { data: [] },
          rd ? supabase.from('qt_orders').select('symbol,side,qty,status,filled_qty,filled_avg_price')
            .eq('rebalance_date', rd).neq('status', 'dry_run') : { data: [] },
          supabase.from('qt_nav_daily').select('d,equity,cash,long_mv,n_positions,spy_close,positions').order('d'),
        ]);
        if (bk.error) throw bk.error;
        if (dead) return;
        setBook(bk.data || []);
        const om = {};
        (od.data || []).forEach((o) => { om[o.symbol] = o; });
        setOrders(om);
        setNav(nv.data || []);
      } catch (ex) { if (!dead) setErr(String(ex?.message || ex)); }
    })();
    return () => { dead = true; };
  }, []);

  const latestNav = nav && nav.length ? nav[nav.length - 1] : null;
  const ls = useMemo(() => liveStats(nav), [nav]);
  const marks = useMemo(() => {
    const m = {}; (latestNav?.positions || []).forEach((p) => { m[p.symbol] = p; }); return m;
  }, [latestNav]);

  const equity = latestNav ? Number(latestNav.equity) : 1_000_000;
  const cash = latestNav ? Number(latestNav.cash) : 1_000_000;
  const longMv = latestNav ? Number(latestNav.long_mv) : 0;
  const invested = equity > 0 ? longMv / equity : 0;
  const rebalDate = book && book.length ? book[0].rebalance_date : null;

  const weights = (latestNav?.positions || [])
    .map((p) => ({ s: p.symbol, w: Number(p.mv) / equity }))
    .sort((a, b) => b.w - a.w);
  const top5 = weights.slice(0, 5).reduce((s, x) => s + x.w, 0);
  const largest = weights[0] || null;

  const medVol = useMemo(() => {
    const vs = (book || []).map((r) => Number(r.vol)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    return vs.length ? vs[Math.floor(vs.length / 2)] : null;
  }, [book]);

  const filled = Object.values(orders).filter((o) => o.status === 'filled').length;
  const working = Object.values(orders).filter((o) => !['filled', 'canceled', 'rejected', 'expired'].includes(o.status)).length;

  // Live curve, indexed to 100 at inception, only when there are ≥2 closes.
  const liveCurve = useMemo(() => {
    if (!nav || nav.length < 2) return null;
    const base = Number(nav[0].equity);
    const sBase = nav[0].spy_close != null ? Number(nav[0].spy_close) : null;
    return {
      strategy: nav.map((r) => (Number(r.equity) / base) * 100),
      spx: sBase ? nav.map((r) => (r.spy_close != null ? (Number(r.spy_close) / sBase) * 100 : null)).map((v, i, a) => v ?? a[i - 1] ?? 100) : null,
    };
  }, [nav]);

  const needs = (have, want) => `needs ${Math.max(want - have, 0)} more trading days`;
  const grid = (min, gap = 20) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap });

  return (
    <div className="cream-page paper-qt">
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '58px 24px 120px' }}>

        {/* ── header ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          <div>
            <Label>Paper Portfolio · live since Aug 17, 2026</Label>
            <h1 style={{ fontSize: 'clamp(30px, 4vw, 40px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
              Quality Trend
            </h1>
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.6, textAlign: 'right' }}>
            40 US companies · equal weight · monthly rebalance · no leverage<br />
            <Link to="/methodology#portfolio" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>full methodology</Link>
            {' '}· paper money, not investment advice
          </div>
        </div>

        {/* ── 1 · command band ────────────────────────────────────────── */}
        <div style={{ ...grid(170, 24), borderTop: BORDER, borderBottom: BORDER, padding: '22px 0', margin: '18px 0 26px' }}>
          <Stat big label="Portfolio value" value={fmtUsd(equity)}
            sub={latestNav ? `close of ${fmtDate(latestNav.d)}` : 'opening equity'} />
          <Stat big label="Day P&L" value={ls?.day != null ? fmtSignedUsd(ls.day) : '—'}
            sub={ls?.dayPct != null ? fmtPct(ls.dayPct, 2) : 'first close lands tonight'} color={pnlColor(ls?.day)} />
          <Stat big label="Since inception" value={ls ? fmtPct(ls.since, 2) : '—'}
            sub={ls?.spxSince != null ? `S&P 500 ${fmtPct(ls.spxSince, 2)} · spread ${fmtPct(ls.since - ls.spxSince, 2)}` : 'vs $1,000,000 start'}
            color={pnlColor(ls?.since)} />
          <Stat big label="Exposure" value={latestNav ? fmtPctPlain(invested, 1) : '—'}
            sub={latestNav ? `cash ${fmtUsd(cash)}` : working > 0 ? `${working} orders queued for the open` : 'cash $1,000,000'} />
          <Stat big label="Positions" value={latestNav ? latestNav.n_positions : (book ? book.length : '—')}
            sub={working > 0 ? `${filled} filled · ${working} working` : '$25,000 target each'} />
        </div>

        {/* ── 2+3 · performance + risk ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: 20, marginBottom: 20 }}>
          <Panel title="Performance — live" right={ls ? `${ls.n + 1} closes · marked at each session close` : 'no closes yet'}>
            {liveCurve ? (
              <>
                <LineChart
                  series={[
                    { name: 'Quality Trend', color: ACCENT, values: liveCurve.strategy },
                    ...(liveCurve.spx ? [{ name: 'S&P 500', color: MUTED, values: liveCurve.spx, width: 1.8, opacity: 0.85 }] : []),
                  ]}
                  yFmt={(v) => v.toFixed(1)}
                />
                <Legend items={[['Quality Trend (indexed to 100)', ACCENT], ['S&P 500', MUTED]]} />
              </>
            ) : (
              <div style={{ padding: '26px 4px', fontSize: 14, lineHeight: 1.65, opacity: 0.65 }}>
                The live curve draws itself from daily closing marks and begins once two closes are on
                the book — the first lands tonight after 4 PM ET. Until then the backtest reference
                below is the only performance record, and it is labeled as exactly that.
              </div>
            )}
            <div style={{ ...grid(120, 16), borderTop: HAIRLINE, paddingTop: 16, marginTop: 16 }}>
              <Stat label="Volatility (ann.)" value={ls?.vol != null ? fmtPctPlain(ls.vol) : '—'}
                sub={ls?.vol == null ? needs(ls?.n ?? 0, 20) : 'daily closes'} />
              <Stat label="Sharpe" value={ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—'}
                sub={ls?.sharpe == null ? needs(ls?.n ?? 0, 60) : 'vs ~4% cash'} />
              <Stat label="Beta vs S&P" value={ls?.beta != null ? ls.beta.toFixed(2) : '—'}
                sub={ls?.beta == null ? needs(ls?.n ?? 0, 20) : 'daily closes'} />
              <Stat label="Tracking error" value={ls?.te != null ? fmtPctPlain(ls.te) : '—'}
                sub={ls?.te == null ? needs(ls?.n ?? 0, 20) : 'ann., vs S&P'} />
              <Stat label="Max drawdown" value={ls ? fmtPctPlain(ls.maxdd) : '—'}
                sub="live, close-to-close" color={ls && ls.maxdd < -0.005 ? DOWN : undefined} />
            </div>
          </Panel>

          <Panel title="Risk" right={latestNav ? `as of ${fmtDate(latestNav.d)}` : 'pre-first-close'}>
            {[
              ['Invested', latestNav ? fmtPctPlain(invested, 1) : '—', 'target 100%, no leverage'],
              ['Cash', fmtUsd(cash), latestNav ? fmtPctPlain(cash / equity, 1) + ' of equity' : 'pre-open'],
              ['Drawdown from peak', ls ? fmtPctPlain(ls.ddFromPeak, 2) : '—', 'live equity vs its high'],
              ['Largest position', largest ? `${largest.s} · ${fmtPctPlain(largest.w, 2)}` : book?.length ? '2.50% target' : '—', 'equal-weight book'],
              ['Top 5 concentration', weights.length ? fmtPctPlain(top5, 1) : book?.length ? '12.5% target' : '—', 'sum of largest five'],
              ['Median holding vol', medVol != null ? fmtPctPlain(medVol, 0) : '—', 'annualized, at selection'],
            ].map(([k, v, sub]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: HAIRLINE, gap: 10 }}>
                <div style={{ fontSize: 13, opacity: 0.65 }}>{k}<div style={{ fontSize: 11, opacity: 0.65 }}>{sub}</div></div>
                <div style={{ fontSize: 15.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</div>
              </div>
            ))}
            <div style={{ fontSize: 11.5, opacity: 0.5, paddingTop: 10, lineHeight: 1.55 }}>
              Risk in this book is structural — diversification, the volatility gate at selection, and
              the monthly exit band. No stops, no book-level alarm, by design.
            </div>
          </Panel>
        </div>

        {/* ── 4 · benchmark comp ──────────────────────────────────────── */}
        <Panel title="Versus benchmark" right="live and backtest are separate records — never blended" style={{ marginBottom: 20 }}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  <th style={{ ...th, textAlign: 'left' }}></th>
                  <th style={th}>Return</th>
                  <th style={th}>Volatility</th>
                  <th style={th}>Sharpe</th>
                  <th style={th}>Sortino</th>
                  <th style={th}>Max drawdown</th>
                  <th style={th}>Worst year</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: HAIRLINE }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>Quality Trend — live <span style={{ opacity: 0.5, fontWeight: 400 }}>since Aug 17, 2026</span></td>
                  <td style={{ ...td, color: pnlColor(ls?.since) }}>{ls ? fmtPct(ls.since, 2) : '—'}</td>
                  <td style={td}>{ls?.vol != null ? fmtPctPlain(ls.vol) : '—'}</td>
                  <td style={td}>{ls?.sharpe != null ? ls.sharpe.toFixed(2) : '—'}</td>
                  <td style={td}>—</td>
                  <td style={td}>{ls ? fmtPctPlain(ls.maxdd) : '—'}</td>
                  <td style={td}>—</td>
                </tr>
                <tr style={{ borderBottom: HAIRLINE, opacity: 0.75 }}>
                  <td style={{ ...td, textAlign: 'left' }}>S&P 500 — live <span style={{ opacity: 0.6 }}>same window</span></td>
                  <td style={td}>{ls?.spxSince != null ? fmtPct(ls.spxSince, 2) : '—'}</td>
                  <td style={td}>—</td><td style={td}>—</td><td style={td}>—</td><td style={td}>—</td><td style={td}>—</td>
                </tr>
                <tr style={{ borderBottom: HAIRLINE }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>Quality Trend — backtest <span style={{ opacity: 0.5, fontWeight: 400 }}>Feb 2017 – Aug 2026, ann.</span></td>
                  <td style={td}>{BT_STATS.cagr}</td>
                  <td style={td}>{BT_STATS.vol}</td>
                  <td style={td}>{BT_STATS.sharpe}</td>
                  <td style={td}>{BT_STATS.sortino}</td>
                  <td style={td}>{BT_STATS.maxdd}</td>
                  <td style={td}>{BT_STATS.worst}</td>
                </tr>
                <tr style={{ opacity: 0.75 }}>
                  <td style={{ ...td, textAlign: 'left' }}>S&P 500 — same backtest window</td>
                  <td style={td}>{BT_SPX.cagr}</td>
                  <td style={td}>{BT_SPX.vol}</td>
                  <td style={td}>{BT_SPX.sharpe}</td>
                  <td style={td}>{BT_SPX.sortino}</td>
                  <td style={td}>{BT_SPX.maxdd}</td>
                  <td style={td}>{BT_SPX.worst}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: 10 }}>
            Information ratio (backtest): {BT_STATS.ir}. Live Sharpe is shown only after 60 trading days; a
            ratio annualized from a few days is noise. Backtest figures are the validated run, verbatim.
          </div>
        </Panel>

        {/* ── 5 · backtest reference ──────────────────────────────────── */}
        <Panel title="Backtest reference — growth of $1,000,000" right="Feb 2017 – Aug 2026 · survivorship-free (2,011 delisted companies) · log scale" style={{ marginBottom: 20 }}>
          <LineChart
            log
            series={[
              { name: 'Quality Trend', color: ACCENT, values: BT.strategy },
              { name: 'S&P 500', color: MUTED, values: BT.spx, width: 1.8, opacity: 0.85 },
            ]}
          />
          <Legend items={[[`Quality Trend → ${fmtUsd(BT.strategy[BT.strategy.length - 1])}`, ACCENT], [`S&P 500 → ${fmtUsd(BT.spx[BT.spx.length - 1])}`, MUTED]]} />
          <div style={{ overflow: 'auto', marginTop: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  <th style={{ ...th, textAlign: 'left' }}>Year</th>
                  {Object.keys(BT.years).map((y) => <th key={y} style={th}>{y === '2026' ? '2026*' : y}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: HAIRLINE }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>Quality Trend</td>
                  {Object.values(BT.years).map((r, i) => (
                    <td key={i} style={{ ...td, color: r.strategy >= 0 ? 'inherit' : DOWN, fontWeight: r.strategy >= r.spx ? 600 : 400 }}>
                      {r.strategy > 0 ? '+' : ''}{r.strategy.toFixed(1)}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ ...td, textAlign: 'left', opacity: 0.7 }}>S&P 500</td>
                  {Object.values(BT.years).map((r, i) => (
                    <td key={i} style={{ ...td, opacity: 0.7, color: r.spx >= 0 ? 'inherit' : DOWN }}>
                      {r.spx > 0 ? '+' : ''}{r.spx.toFixed(1)}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: 10, lineHeight: 1.6 }}>
            *2026 through Aug 11, the backtest's last mark. Bold = beat the index that year (7 of 10). A
            backtest is not a live record: it includes the companies that died, uses financials only from
            their SEC filing dates, and survives 40bp costs — and the live book should still be expected
            to run below it. Three backtest years trailed the index (2019, 2021, 2025); more will come.
          </div>
        </Panel>

        {/* ── 6 · holdings ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Holdings</h2>
          <div style={{ fontSize: 12.5, opacity: 0.55 }}>
            scored {fmtDate(rebalDate)} · next rebalance: first trading day of the month · sell when a name leaves the top 25% of the ranking
          </div>
        </div>
        {err ? (
          <div style={{ border: BORDER, borderRadius: 12, padding: 24, fontSize: 14, opacity: 0.7 }}>
            The book could not be loaded ({err}). Refresh to retry.
          </div>
        ) : !book ? (
          <div style={{ border: BORDER, borderRadius: 12, padding: 24, fontSize: 14, opacity: 0.6 }}>Loading…</div>
        ) : (
          <div style={{ border: BORDER, borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  <th style={{ ...th, textAlign: 'left' }}>#</th>
                  <th style={{ ...th, textAlign: 'left' }}>Company</th>
                  <th style={th}>Weight</th>
                  <th style={th}>Value</th>
                  <th style={th}>Avg cost</th>
                  <th style={th}>Last</th>
                  <th style={th}>P&L</th>
                  <th style={th}>12-mo mom</th>
                  <th style={th}>GP / assets</th>
                  <th style={th}>Buyback</th>
                  <th style={th}>Insider</th>
                </tr>
              </thead>
              <tbody>
                {book.map((r) => {
                  const o = orders[r.symbol];
                  const m = marks[r.symbol];
                  const w = m ? Number(m.mv) / equity : null;
                  return (
                    <tr key={r.symbol} style={{ borderBottom: HAIRLINE }}>
                      <td style={{ ...td, textAlign: 'left', opacity: 0.5 }}>{r.rank}</td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <button type="button" onClick={() => onOpenTicker && onOpenTicker(r.symbol)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
                          title={`Open ${r.symbol}`}>
                          <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                          <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 12.5 }}>
                            {(r.company || '').replace(/\s*(Common Stock|Ordinary Share|Class A Common Stock).*$/i, '')}
                          </span>
                        </button>
                      </td>
                      <td style={td}>{w != null ? fmtPctPlain(w, 2) : '2.50%'}</td>
                      <td style={td}>{m ? fmtUsd(m.mv) : fmtUsd(r.target_dollars)}</td>
                      <td style={{ ...td, opacity: o?.status === 'filled' ? 1 : 0.55 }}>
                        {o?.status === 'filled' ? fmtUsd(o.filled_avg_price, 2) : (o ? o.status.replace(/_/g, ' ') : '—')}
                      </td>
                      <td style={td}>{m ? fmtUsd(m.price, 2) : '—'}</td>
                      <td style={{ ...td, color: m ? pnlColor(m.upl) : 'inherit', opacity: m ? 1 : 0.45 }}>
                        {m ? `${fmtSignedUsd(m.upl)} (${fmtPct(m.uplpc, 1)})` : '—'}
                      </td>
                      <td style={td}>{r.mom12 == null ? '—' : `${r.mom12 > 0 ? '+' : ''}${Math.round(r.mom12 * 100)}%`}</td>
                      <td style={td}>{r.gp_a == null ? '—' : Number(r.gp_a).toFixed(2)}</td>
                      <td style={td}>{r.iss == null ? '—' : fmtPct(Number(r.iss), 1)}</td>
                      <td style={{ ...td, opacity: Number(r.insider) > 0 ? 1 : 0.35 }}>
                        {Number(r.insider) > 0 ? Number(r.insider).toFixed(2) : '·'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ borderLeft: '2px solid rgba(128,128,128,0.3)', paddingLeft: 22, margin: '40px 0 0', maxWidth: 860 }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.7, margin: 0 }}>
            Every company is scored on 12- and 6-month momentum (skipping the most recent month), trend
            consistency, drawdown resilience, gross profitability, cash generation and buybacks from
            point-in-time SEC filings, plus a bonus for <i>meaningful</i> insider buying — officers and
            directors making open-market purchases large relative to what they already own. Marks and
            P&amp;L are the paper broker&rsquo;s official records, snapshotted after each close; this
            page never estimates intraday. Signal columns are as-of the scoring date.
          </p>
        </div>
      </div>
    </div>
  );
}
