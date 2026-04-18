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
    background: "var(--surface-2, #eef0f3)",
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
            background: "var(--surface, #fff)",
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
