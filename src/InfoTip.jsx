/**
 * InfoTip — a small "ⓘ" / "?" icon that shows a tooltip on hover/focus.
 *
 * Used throughout the Scanner and Indicators pages to explain acronyms
 * (MACD, RSI, IVR, P/C, CAPE, SLOOS, ANFCI, …) without cluttering the UI.
 *
 * Usage:
 *   <InfoTip def="Moving Average Convergence Divergence. Trend-following momentum …" />
 *   <InfoTip term="MACD" />   // looks up DEFS["MACD"]
 *   <span>RSI <InfoTip term="RSI" /></span>
 */
import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

// ─── Definitions dictionary ────────────────────────────────────────────────
// Single source of truth. Keys are normalized to UPPERCASE and may include
// a path-separated scope (e.g. "SCANNER:MACD") if a term needs disambiguation.
export const DEFS = {
  // Scanner technicals
  MACD:
    "Moving Average Convergence Divergence. Momentum indicator: the 12-day EMA minus the 26-day EMA, plotted with a 9-day signal line. 'Bullish' = MACD line crossed above the signal line recently (buy signal); 'Bearish' = crossed below (sell signal); neutral = no recent cross.",
  RSI:
    "Relative Strength Index (14-day). Momentum oscillator measuring speed and change of price moves on a 0–100 scale. >70 = overbought (often reverses); <30 = oversold; 30–70 = neutral. Divergences from price can signal reversals.",
  IVR:
    "Implied Volatility Rank. Where the current 30-day implied vol sits in its 52-week range, 0–100. IVR 0 = IV at 1yr low (options cheap); IVR 100 = IV at 1yr high (options expensive). >70 favors premium selling (covered calls, cash-secured puts); <30 favors long options (buying calls/puts).",
  "P/C":
    "Put/Call ratio. Dollar volume of puts divided by dollar volume of calls in unusual options flow. P/C > 1 means bearish bets outweighing bullish; P/C < 1 means bullish bets dominate. Extremes are contrarian signals — very high P/C often marks a bottom.",
  "RVOL":
    "Relative Volume. Today's options volume divided by the 30-day average. 2.0× = twice typical activity. >3× often precedes news or a big price move. Combined with IVR spikes and directional skew, it's a leading indicator of informed positioning.",
  "REL VOL":
    "Relative Volume. Today's options volume divided by the 30-day average. 2.0× = twice typical activity. >3× often precedes news or a big price move.",
  "50MA":
    "50-day simple moving average. Medium-term trend benchmark. Price above the 50MA = intermediate uptrend; below = intermediate downtrend. The '50MA-to-200MA' cross (golden/death cross) is a classic regime signal.",
  "200MA":
    "200-day simple moving average. Long-term trend benchmark and the single most-watched technical level. Price above the 200MA = secular bull trend; below = secular bear. Historically, S&P 500 has rarely sustained moves below the 200MA outside recessions.",
  "VS 50MA":
    "Current price vs the 50-day moving average. ABOVE = intermediate uptrend (bullish); BELOW = intermediate downtrend (bearish).",
  "VS 200MA":
    "Current price vs the 200-day moving average. ABOVE = long-term uptrend (secular bull); BELOW = secular downtrend. Crossing below the 200MA is historically a recession signal.",
  YTD:
    "Year-to-date price change from the first trading day of the current calendar year to yesterday's close.",
  "1W":
    "One-week price change. Yesterday's close vs close one week ago.",
  "1M":
    "One-month price change. Yesterday's close vs close one month ago.",
  MONEYNESS:
    "How far in-the-money (ITM) or out-of-the-money (OTM) the strike sits relative to the underlying. For calls: positive % = OTM; for puts: positive % = ITM. Far-OTM strikes are cheaper but require bigger moves to pay off.",
  "VOL / OI":
    "Today's contract volume divided by open interest. Ratios >1 suggest fresh positioning (new contracts opened vs existing); ratios >5 are highly unusual and often precede news or catalyst events.",
  PREMIUM:
    "Total dollar premium paid on the trade — contract price × 100 shares per contract × number of contracts. Large premium prints (>$1M) signal institutional conviction.",
  STRIKE:
    "Contract strike price — the price at which the option can be exercised.",

  // Macro indicators — overlap with IND[] descriptions but kept here so the
  // tooltip reads identically in both the Scanner and the Indicators pages.
  VIX:
    "CBOE Volatility Index. 30-day expected volatility on the S&P 500, derived from SPX option prices. <15 = complacent; 15–20 = normal; 20–30 = elevated; >30 = crisis regime. VIX spikes precede and accompany equity drawdowns.",
  MOVE:
    "ICE BofA MOVE Index. Treasury-market equivalent of the VIX — 30-day implied volatility on the 2/5/10/30-year Treasury curve. Normal ~80; >120 signals bond-market stress, which has historically preceded credit events (SVB 2023 peak was 198).",
  SKEW:
    "CBOE SKEW Index. Measures the cost of far out-of-the-money SPX puts relative to at-the-money. Normal 100–125; >140 indicates institutions are paying up for tail-risk hedges. Tends to rise before VIX does.",
  SLOOS:
    "Senior Loan Officer Opinion Survey (Fed). Quarterly survey asking banks whether they've tightened or eased lending standards. Net % tightening >10% historically precedes credit contraction and recession by 1–2 quarters.",
  ANFCI:
    "Adjusted National Financial Conditions Index (Chicago Fed). Weekly composite of 100+ financial indicators (credit, equity, money market). Above 0 = tighter than average; below 0 = looser. Leads real activity by 1–2 quarters.",
  STLFSI:
    "St. Louis Fed Financial Stress Index. Weekly composite of 18 stress signals (yields, spreads, equity vol). 0 = normal, positive = stressed, negative = benign. Simpler and more volatile than ANFCI.",
  CAPE:
    "Cyclically Adjusted P/E (Shiller P/E). S&P 500 price divided by 10-year trailing real earnings. Long-term mean ~17; >25 = rich; >30 = very rich (only surpassed in 1929, 2000, 2021, 2024). Poor short-term timing tool but strong 10-year return predictor.",
  ISM:
    "Institute for Supply Management manufacturing PMI. Monthly diffusion index — >50 = expansion, <50 = contraction. Sub-45 prints have preceded every recession since 1970 except 1967. Leading indicator for earnings.",
  JOLTS:
    "Job Openings and Labor Turnover Survey (BLS). The 'quits rate' — % of employed workers who voluntarily leave each month — proxies labor market tightness and worker confidence. <2.0% signals weakening; 2.0–2.5% normal; >2.7% tight.",
  JOBLESS:
    "Initial unemployment insurance claims. Weekly count of new jobless filings. <250K = strong labor market; 250–350K = softening; >400K = recessionary. Leading indicator — turns up before payrolls roll over.",
  "HY-IG":
    "High-yield minus investment-grade credit spread. Difference in OAS between BB-rated and BBB-rated corporate bonds. Widening spreads = credit stress; compressing = risk-on. >300bps is a warning; >500bps has historically marked recession.",
  "BKX/SPX":
    "KBW Bank Index relative to S&P 500. Tracks whether bank stocks are leading or lagging the broad market. Sharp underperformance (BKX/SPX collapsing) signals banking-sector stress — the SVB collapse in March 2023 was preceded by a BKX/SPX breakdown.",
  TED:
    "TED spread. 3-month LIBOR (now SOFR) minus 3-month Treasury bill yield. Measures counterparty/funding risk. <50bps normal; >100bps funding stress. Historically spiked during the 2008 financial crisis.",
  OAS:
    "Option-Adjusted Spread. Credit spread over Treasury adjusted for embedded optionality. Standard way to compare bonds with call/put features.",
  FFR:
    "Federal Funds Rate. Overnight inter-bank lending rate set by the FOMC — the Fed's primary policy tool.",
  TIPS:
    "Treasury Inflation-Protected Securities. Government bonds whose principal indexes to CPI. The real yield on TIPS = market-implied real interest rate.",

  // ─── MacroTilt v2 site labels (bug #1162) ──────────────────────────────
  // Plain-English, one-sentence explanations for every label or statistic
  // on the v2 site that would not be obvious to a portfolio manager seeing
  // MacroTilt for the first time. Used by the v2 pages via <InfoTip term=…>
  // or <Tip def=…>.
  "TODAYS STANCE":
    "MacroTilt's overall read on the market today, scored 0–100 — higher means a more defensive backdrop. The label beneath (Risk On, Neutral, Cautionary, Risk Off) is the plain-English version of that score.",
  "CURRENT REGIME":
    "The market backdrop MacroTilt sees right now — Risk On, Neutral, Cautionary, or Risk Off — based on whether volatility and funding-stress triggers have crossed and how late in the cycle we are.",
  "RISK ON":
    "No volatility or funding-stress triggers are firing — the backdrop supports staying fully invested.",
  "NEUTRAL":
    "One stress trigger has crossed but not held — possibly a false alarm. The stance is to hold and watch.",
  "CAUTIONARY":
    "One or more stress triggers have been sustained — the backdrop argues for trimming risk.",
  "RISK OFF":
    "Stress triggers are sustained while the cycle is late — the backdrop argues for a defensive stance.",
  "EQUITY VOL":
    "How jumpy the stock market is right now, shown as where today's VIX sits in its own five-year range (0 = calmest, 100 = most volatile).",
  "BOND VOL":
    "How jumpy the bond market is right now, shown as where today's MOVE index sits in its own five-year range (0 = calmest, 100 = most volatile).",
  "FUNDING":
    "How expensive short-term corporate borrowing is, shown as where the commercial-paper spread sits in its own five-year range — a higher reading means tighter funding.",
  "CYCLE POSITION":
    "How far along the economic cycle MacroTilt judges we are, 0–100 — a higher reading means later in the cycle, when downside risk tends to build.",
  "EQUITY %":
    "The share of the portfolio the allocator wants invested in stocks right now.",
  "DEFENSIVE %":
    "The share of the portfolio the allocator wants held in defensive assets — short-term Treasuries, long Treasuries, gold, and investment-grade bonds.",
  "LEVERAGE":
    "How much total market exposure the allocator is taking versus the cash on hand — 1.0× means fully invested with no borrowing, above 1.0× means borrowing to add exposure.",
  "GROSS EXPOSURE":
    "Total market exposure counting both long and short positions added together, as a multiple of portfolio capital.",
  "STRESS":
    "How many of the six cycle mechanisms are currently reading above Neutral — the more that are, the more cautious the allocator becomes.",
  "MECHANISMS FLAGGED":
    "How many of the six cycle mechanisms are currently flagging stress, out of six.",
  "OVERWEIGHT":
    "Sectors the allocator wants to hold more of than a neutral benchmark would.",
  "UNDERWEIGHT":
    "Sectors the allocator wants to hold less of than a neutral benchmark would.",
  "MARKETWEIGHT":
    "Sectors the allocator wants to hold at roughly the same level as a neutral benchmark.",
  "TILT":
    "Which way and how strongly the allocator leans on this group — up for overweight, down for underweight.",
  "TILT SCORE":
    "A single number combining the six cycle mechanisms' votes on this group — positive means lean overweight, negative means lean underweight.",
  "$ EXPOSURE":
    "The dollar amount of the modeled portfolio the allocator assigns to this group.",
  "COMPOSITE SHARE":
    "How much this single indicator counts toward its mechanism's overall score, as a percentage — the indicators in one mechanism add up to 100%.",
  "MECHANISM":
    "One of the six building blocks of MacroTilt's cycle read — Valuation, Credit, Funding, Growth, Liquidity & Policy, and Positioning & Breadth.",
  "CONTRIBUTION BY MECHANISM":
    "How much each of the six cycle mechanisms pushes this group's tilt up or down — the bars add up to the overall lean.",
  "5Y PERCENTILE":
    "Where today's reading sits within the indicator's own range over the last five years — 0 = the lowest it's been, 100 = the highest.",
  "PERCENTILE":
    "Where the current reading sits within this indicator's own historical range — 0 = the lowest on record, 100 = the highest.",
  "IN ALERT TAIL":
    "How many indicators are currently reading at the extreme, alert-side end of their historical range.",
  "CALIBRATED SERIES":
    "The number of indicators that are fully calibrated and actively tracked.",
  "30-DAY Δ":
    "How much the reading has moved over the past 30 days.",
  "WIN RATE":
    "How often this kind of setup has worked out historically, measured in MacroTilt's backtest.",
  "TOTAL NET LIQUIDATION":
    "What the whole portfolio would be worth if every position were sold today at current prices.",
  "NET LIQUIDATION":
    "What the portfolio would be worth if every position were sold today at current prices, tracked over time.",
  "SCORE":
    "MacroTilt's overall conviction in this stock, out of 10 — built from insider buying, price trend, dark-pool clustering, and options activity.",
};

/**
 * Look up a term in DEFS with forgiving matching.
 */
export function lookupDef(term) {
  if (!term) return null;
  const norm = String(term).toUpperCase().trim();
  if (DEFS[norm]) return DEFS[norm];
  // Strip trailing % / · and retry
  const stripped = norm.replace(/[%·\s]+$/, "").trim();
  if (stripped !== norm && DEFS[stripped]) return DEFS[stripped];
  return null;
}

// ─── Tooltip component ─────────────────────────────────────────────────────
export function InfoTip({ term, def, size = 12, inline = true, style }) {
  const text = def || lookupDef(term) || null;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, flip: false });
  const anchorRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const TT_W = 280;
    const margin = 8;
    const wantX = r.left + r.width / 2 - TT_W / 2;
    const clampedX = Math.max(margin, Math.min(wantX, window.innerWidth - TT_W - margin));
    const flipAbove = r.bottom + 140 > window.innerHeight;
    setPos({ x: clampedX, y: flipAbove ? r.top - 8 : r.bottom + 8, flip: flipAbove });
  }, [open]);

  if (!text) return null;

  const iconCommon = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size + 2,
    height: size + 2,
    borderRadius: "50%",
    background: "var(--surface-solid, #fff)",
    color: "var(--text-muted, #6b7280)",
    border: "1px solid var(--border-faint, #d4d7db)",
    fontSize: size - 3,
    fontWeight: 700,
    fontFamily: "var(--font-mono, monospace)",
    cursor: "help",
    userSelect: "none",
    lineHeight: 1,
    marginLeft: 4,
    verticalAlign: inline ? "middle" : "baseline",
    transition: "background 120ms, color 120ms",
    ...style,
  };

  return (
    <>
      <span
        ref={anchorRef}
        role="button"
        tabIndex={0}
        aria-label={`Definition: ${text.slice(0, 60)}…`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={iconCommon}
      >
        ?
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.flip ? undefined : pos.y,
            bottom: pos.flip ? window.innerHeight - pos.y : undefined,
            width: 280,
            padding: "10px 12px",
            background: "var(--surface-solid, #fff)",
            color: "var(--text, #111)",
            border: "1px solid var(--border, #d4d7db)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "var(--font-ui, system-ui, sans-serif)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "pre-wrap",
            letterSpacing: 0,
            textTransform: "none",
          }}
        >
          {term && (
            <div style={{ fontWeight: 700, fontFamily: "var(--font-mono, monospace)", fontSize: 11, letterSpacing: "0.06em", color: "var(--text-muted, #6b7280)", marginBottom: 4 }}>
              {String(term).toUpperCase()}
            </div>
          )}
          {text}
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * HeadWithTip — convenience wrapper for a table column header with an inline
 * tooltip icon. Used in SortableTable or anywhere a <th> needs a "?".
 */
export function HeadWithTip({ label, term }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {label}
      <InfoTip term={term || label} size={11} />
    </span>
  );
}

/**
 * Tip — a wrapper that attaches a portal-rendered tooltip to any child element.
 *
 * Use this when a chip/badge/icon is itself the hover target (rather than
 * adding a separate "?" icon). Replaces the native HTML `title` attribute,
 * which has a long delay (~1.5s) and unstyled appearance on most browsers.
 *
 * Usage:
 *   <Tip label="TIER 2" def="Tier 2 — important but less real-time, weighted 1.2× …">
 *     <span style={{...badge styles}}>TIER 2</span>
 *   </Tip>
 */
export function Tip({ children, def, label }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, flip: false });
  const anchorRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const TT_W = 280;
    const margin = 8;
    const wantX = r.left + r.width / 2 - TT_W / 2;
    const clampedX = Math.max(margin, Math.min(wantX, window.innerWidth - TT_W - margin));
    const flipAbove = r.bottom + 140 > window.innerHeight;
    setPos({ x: clampedX, y: flipAbove ? r.top - 8 : r.bottom + 8, flip: flipAbove });
  }, [open]);

  if (!def) return children;

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {children}
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.flip ? undefined : pos.y,
            bottom: pos.flip ? window.innerHeight - pos.y : undefined,
            width: 280,
            padding: "10px 12px",
            background: "var(--surface-solid, #fff)",
            color: "var(--text, #111)",
            border: "1px solid var(--border, #d4d7db)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "var(--font-ui, system-ui, sans-serif)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "pre-wrap",
            letterSpacing: 0,
            textTransform: "none",
          }}
        >
          {label && (
            <div style={{ fontWeight: 700, fontFamily: "var(--font-mono, monospace)", fontSize: 11, letterSpacing: "0.06em", color: "var(--text-muted, #6b7280)", marginBottom: 4 }}>
              {label}
            </div>
          )}
          {def}
        </div>,
        document.body
      )}
    </>
  );
}
