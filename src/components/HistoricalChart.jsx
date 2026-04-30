// HistoricalChart — daily price chart for the stock-modal "Historical" section.
//
// Features (P4 #14 + #15):
//   • Period presets: 1M / 3M / 6M / YTD / 1Y / 5Y / MAX (max anchored at 2002-01-01)
//   • Custom date-range picker (from / to)
//   • Compare overlay: up to 3 additional tickers/indices, all price-rebased to
//     100 at the chart's start date so the visual reads as relative performance
//   • Hover crosshair → shows date + value for each visible series
//
// Data:
//   GET /api/price-history?ticker=XXX&period=1y  (or &from=…&to=…)
//   Yahoo chart API under the hood, cached 1h at the edge.
//
// Joe spec 2026-04-27: "Daily chart with the same abilities as the other
// charts on the website (i.e., select time period (1M, 1Y, etc.) and
// timeframe (2002 to 2005). The charts should also have the ability to
// compare to another ticker and index."

import { useEffect, useMemo, useRef, useState } from "react";

const PRESETS = [
  { key: "1mo", label: "1M"  },
  { key: "3mo", label: "3M"  },
  { key: "6mo", label: "6M"  },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1Y"  },
  { key: "5y",  label: "5Y"  },
  { key: "max", label: "MAX" },
];

// Color palette — main ticker + 3 comparators. Picked for theme contrast.
const SERIES_COLORS = [
  "var(--accent)",   // primary ticker — house gold
  "#4a6fa5",         // comparator 1 — blue
  "#1f9d60",         // comparator 2 — green
  "#a855f7",         // comparator 3 — purple
];

// Picker presets — Phase 4b PR-D. Indexes always available; suggested peers
// vary by the open ticker's sector.
const PICKER_INDEXES = [
  { ticker: "SPY",  name: "S&P 500" },
  { ticker: "QQQ",  name: "Nasdaq-100" },
  { ticker: "DIA",  name: "Dow Jones" },
  { ticker: "RSP",  name: "S&P Equal-Weight" },
  { ticker: "IWM",  name: "Russell 2000" },
];
const SUGGESTED_PEERS_BY_SECTOR = {
  "Technology":            ["AAPL","MSFT","NVDA","AVGO","ORCL"],
  "Information Technology":["AAPL","MSFT","NVDA","AVGO","ORCL"],
  "Semiconductors":        ["NVDA","AMD","AVGO","TSM","INTC"],
  "Consumer Discretionary":["AMZN","TSLA","HD","MCD","NKE"],
  "Consumer Staples":      ["WMT","PG","KO","PEP","COST"],
  "Communication Services":["GOOGL","META","NFLX","DIS","T"],
  "Health Care":           ["UNH","JNJ","LLY","ABBV","PFE"],
  "Financials":            ["JPM","BAC","WFC","V","MA"],
  "Financial Services":    ["JPM","BAC","WFC","V","MA"],
  "Energy":                ["XOM","CVX","COP","EOG","SLB"],
  "Industrials":           ["CAT","UNH","HON","GE","BA"],
  "Real Estate":           ["AMT","EQIX","PLD","SPG","O"],
  "Utilities":             ["NEE","SO","DUK","AEP","EXC"],
  "Materials":             ["LIN","SHW","FCX","NEM","ECL"],
};

function fmtDate(d) {
  if (!d) return "";
  // d is "YYYY-MM-DD" string
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

async function fetchHistory({ ticker, period, from, to }) {
  const params = new URLSearchParams();
  params.set("ticker", ticker);
  if (from) {
    params.set("from", from);
    if (to) params.set("to", to);
  } else if (period) {
    params.set("period", period);
  }
  const r = await fetch(`/api/price-history?${params.toString()}`);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json();
}

export default function HistoricalChart({ ticker, defaultPeriod = "1y", height = 280, sector, accounts, watchlistRows, nextEarnDate, dividends, splits }) {
  const [period, setPeriod]       = useState(defaultPeriod);
  const [fromDate, setFromDate]   = useState("");
  const [toDate, setToDate]       = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [comparators, setComparators] = useState([]);   // ["SPY", "QQQ"]
  const [compInput, setCompInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  // Outside-click close — refs anchor the popover + the pill that opens it.
  const pickerRef = useRef(null);
  const pickerBtnRef = useRef(null);

  // ─── Customize chart state — collapsed-by-default panel (PR-D2) ───
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef(null);
  const customizeBtnRef = useRef(null);
  const DEFAULT_OVERLAYS = { ma50: true, ma200: true, bollinger: false };
  const DEFAULT_SUBPANES = { rsi: false, volume: false };
  const DEFAULT_MARKERS  = { earnings: false, dividends: false, splits: false };
  const DEFAULT_DISPLAY  = { crosshair: true, logScale: false };
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [subPanes, setSubPanes] = useState(DEFAULT_SUBPANES);
  const [markers, setMarkers] = useState(DEFAULT_MARKERS);
  const [display, setDisplay] = useState(DEFAULT_DISPLAY);

  const activeCount = Object.values(overlays).filter(Boolean).length
                    + Object.values(subPanes).filter(Boolean).length
                    + Object.values(markers).filter(Boolean).length
                    + Object.values(display).filter(Boolean).length;

  const resetToClean = () => {
    setOverlays(DEFAULT_OVERLAYS);
    setSubPanes(DEFAULT_SUBPANES);
    setMarkers(DEFAULT_MARKERS);
    setDisplay(DEFAULT_DISPLAY);
  };

  // seriesData: { TICKER: [{d,c,...}, ...] }
  const [seriesData, setSeriesData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // Reset comparators when ticker changes (modal switched to different stock).
  useEffect(() => { setComparators([]); setSeriesData({}); }, [ticker]);

  // Fetch each ticker's history when period / range / comparators change.
  useEffect(() => {
    if (!ticker) return;
    const wanted = [ticker, ...comparators];
    const need = wanted.filter(t => !seriesData[t]?._key || seriesData[t]?._key !== periodKey());
    if (need.length === 0) return;
    setLoading(true);
    setError(null);
    const args = useCustom && fromDate
      ? { from: fromDate, to: toDate || undefined }
      : { period };
    Promise.allSettled(
      need.map(t => fetchHistory({ ticker: t, ...args }).then(d => [t, d]))
    ).then(results => {
      const next = { ...seriesData };
      let firstErr = null;
      for (const r of results) {
        if (r.status === "fulfilled") {
          const [t, d] = r.value;
          next[t] = { ...d, _key: periodKey() };
        } else if (!firstErr) {
          firstErr = r.reason?.message || "fetch failed";
        }
      }
      setSeriesData(next);
      if (firstErr && Object.keys(next).length === 0) setError(firstErr);
      setLoading(false);
    });
    function periodKey() {
      return useCustom && fromDate ? `from-${fromDate}-${toDate||"now"}` : `period-${period}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, period, fromDate, toDate, useCustom, comparators]);

  // Whenever period/range/ticker changes, invalidate cached series so re-fetch fires.
  useEffect(() => {
    setSeriesData({});
  }, [period, fromDate, toDate, useCustom, ticker]);

  // ─── Outside-click close — Compare picker + Customize panel ─────────────
  // Both popovers used to require clicking the same pill that opened them.
  // This effect closes whichever is open if the click lands outside both
  // the panel and its trigger button. ESC also closes both.
  useEffect(() => {
    if (!pickerOpen && !customizeOpen) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (pickerOpen) {
        const inPanel = pickerRef.current && pickerRef.current.contains(t);
        const onBtn   = pickerBtnRef.current && pickerBtnRef.current.contains(t);
        if (!inPanel && !onBtn) setPickerOpen(false);
      }
      if (customizeOpen) {
        const inPanel = customizeRef.current && customizeRef.current.contains(t);
        const onBtn   = customizeBtnRef.current && customizeBtnRef.current.contains(t);
        if (!inPanel && !onBtn) setCustomizeOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") { setPickerOpen(false); setCustomizeOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen, customizeOpen]);

  // Compute series. Each ticker keeps `raw` (real dollar close), `pct`
  // (percent change from start of the window), and `v` (rebased index =
  // 100 at start). The plot uses `pct` when in compare mode, `raw` when
  // showing a single ticker.
  const rebased = useMemo(() => {
    const out = [];
    const all = [ticker, ...comparators];
    all.forEach((t, i) => {
      const d = seriesData[t];
      if (!d?.prices?.length) return;
      const baseClose = d.prices[0].c;
      if (!baseClose) return;
      const points = d.prices.map(p => ({
        d:   p.d,
        raw: p.c,
        pct: (p.c / baseClose - 1) * 100,
        v:   (p.c / baseClose) * 100,
      }));
      out.push({
        ticker: t,
        color:  SERIES_COLORS[i] || "var(--text-muted)",
        baseDate: d.prices[0].d,
        baseClose,
        points,
      });
    });
    return out;
  }, [seriesData, ticker, comparators]);

  // ─── Indicator computations — derived from primary ticker's prices (PR-D2) ───
  const primaryPrices = seriesData[ticker]?.prices || [];
  const sma = (arr, period) => {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= period) sum -= arr[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  };
  const closes = useMemo(() => primaryPrices.map(p => p.c), [primaryPrices]);
  const volumes = useMemo(() => primaryPrices.map(p => p.v || 0), [primaryPrices]);
  const sma50 = useMemo(() => sma(closes, 50), [closes]);
  const sma200 = useMemo(() => sma(closes, 200), [closes]);
  const bollinger = useMemo(() => {
    const period = 20, k = 2;
    const ma = sma(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = ma[i];
      const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
      const sd = Math.sqrt(variance);
      upper[i] = mean + k * sd;
      lower[i] = mean - k * sd;
    }
    return { upper, lower, mid: ma };
  }, [closes]);
  const rsi14 = useMemo(() => {
    const period = 14;
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch >= 0) gain += ch; else loss -= ch;
    }
    let avgGain = gain / period, avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = ch >= 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return out;
  }, [closes]);
  const dateToIdx = useMemo(() => {
    const m = new Map();
    primaryPrices.forEach((p, i) => m.set(p.d, i));
    return m;
  }, [primaryPrices]);


  // Axis mode — switches what the y-axis shows based on context.
  //   "price"  : single ticker, real dollar prices (no rebase confusion)
  //   "pct"    : 2+ tickers, percent change from start (compare apples-to-apples)
  const axisMode = comparators.length > 0 ? "pct" : "price";

  // Layout
  const W = 800;     // viewBox width — scales via CSS
  const H = height;
  const pL = 44, pR = 16, pT = 12, pB = 28;

  // X / Y domain
  const yField = axisMode === "price" ? "raw" : "pct";
  const allValues = rebased.flatMap(s => s.points.map(p => p[yField]));
  const yMin = allValues.length ? Math.min(...allValues) : 0;
  const yMax = allValues.length ? Math.max(...allValues) : 100;
  const yPad = (yMax - yMin) * 0.06 || 1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const allDates = rebased[0]?.points.map(p => p.d) || [];
  const xMin = 0;
  const xMax = Math.max(0, allDates.length - 1);
  const xToPx = i => pL + (i / (xMax || 1)) * (W - pL - pR);
  const yToPx = v => pT + ((yHi - v) / (yHi - yLo)) * (H - pT - pB);

  // Hover crosshair
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const onMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - pL) / (W - pL - pR)) * (xMax || 1));
    if (i >= 0 && i <= xMax) setHoverIdx(i);
  };
  const onLeave = () => setHoverIdx(null);

  // Add comparator
  const addComparator = (e) => {
    e?.preventDefault?.();
    const t = compInput.trim().toUpperCase();
    if (!t || !/^[A-Z0-9.\-^]{1,10}$/.test(t)) return;
    if (t === ticker || comparators.includes(t)) return;
    if (comparators.length >= 3) return;
    setComparators([...comparators, t]);
    setCompInput("");
  };
  const removeComparator = (t) => setComparators(comparators.filter(x => x !== t));

  return (
    <div style={{
      background: "var(--surface-2)",
      border: "1px solid var(--border-faint)",
      borderRadius: "var(--radius-md)",
      padding: "var(--space-3)",
      marginBottom: "var(--space-3)",
    }}>
      {/* Header row: title + period picker + custom range toggle + comparator input */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
        marginBottom: "var(--space-3)",
      }}>
        <div style={{
          fontSize: 10, fontFamily: "var(--font-mono)",
          color: "var(--text-muted)", letterSpacing: "0.08em",
          fontWeight: 600, textTransform: "uppercase", marginRight: 8,
        }}>{axisMode === "price" ? "Historical · daily · adjusted close ($)" : "Historical · daily · % change from start"}</div>

        {/* Period preset buttons */}
        <div style={{ display: "inline-flex", gap: 2, background: "var(--surface-3)", padding: 2, borderRadius: 4 }}>
          {PRESETS.map(p => (
            <button key={p.key} type="button"
              onClick={() => { setPeriod(p.key); setUseCustom(false); }}
              style={{
                fontFamily: "var(--font-mono)", fontSize: 11,
                padding: "4px 10px", border: "none",
                background: !useCustom && period === p.key ? "var(--surface-solid)" : "transparent",
                color: !useCustom && period === p.key ? "var(--text)" : "var(--text-muted)",
                borderRadius: 3, cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em",
              }}>{p.label}</button>
          ))}
        </div>

        {/* Custom range toggle */}
        <button type="button" onClick={() => setUseCustom(!useCustom)} style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          padding: "4px 10px", border: "1px solid var(--border)",
          background: useCustom ? "var(--surface-solid)" : "transparent",
          color: useCustom ? "var(--text)" : "var(--text-muted)",
          borderRadius: 3, cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em",
        }}>CUSTOM</button>
        {useCustom && (
          <>
            <input type="date" value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              min="2002-01-01" max={toDate || undefined}
              style={{ fontFamily:"var(--font-mono)", fontSize:11, padding:"3px 6px", border:"1px solid var(--border)", borderRadius:3, color:"var(--text)", background:"var(--surface)" }}/>
            <span style={{fontSize:11, color:"var(--text-muted)"}}>to</span>
            <input type="date" value={toDate}
              onChange={e => setToDate(e.target.value)}
              min={fromDate || "2002-01-01"}
              style={{ fontFamily:"var(--font-mono)", fontSize:11, padding:"3px 6px", border:"1px solid var(--border)", borderRadius:3, color:"var(--text)", background:"var(--surface)" }}/>
          </>
        )}

        {/* Compare bar — Phase 4b PR-D v5 spec: pill chips for active overlays
            + "+ Add ticker / index" picker with sector-aware suggested peers
            and a fixed list of indexes. Replaces the free-text input. */}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
          <span style={{
            fontFamily:"var(--font-mono)", fontSize:10, fontWeight:600,
            textTransform:"uppercase", letterSpacing:"0.16em",
            color:"var(--text-dim)", marginRight:2,
          }}>Compare</span>

          {/* Primary-ticker pill (cannot be removed) */}
          <span style={{
            display:"inline-flex", alignItems:"center", gap:6,
            fontFamily:"var(--font-mono)", fontSize:11, fontWeight:600,
            background:"var(--surface-solid, var(--paper, #fff))",
            border:"1px solid var(--border)",
            color:"var(--text)",
            padding:"4px 10px", borderRadius:14,
          }}>
            <span style={{display:"inline-block", width:10, height:2, borderRadius:1, background:SERIES_COLORS[0]}}/>
            {ticker}
          </span>

          {/* Comparator pills */}
          {comparators.map((c, i) => (
            <span key={c} style={{
              display:"inline-flex", alignItems:"center", gap:6,
              fontFamily:"var(--font-mono)", fontSize:11, fontWeight:600,
              background:"var(--surface-solid, var(--paper, #fff))",
              border:"1px solid var(--border)",
              color:"var(--text)",
              padding:"4px 6px 4px 10px", borderRadius:14,
            }}>
              <span style={{display:"inline-block", width:10, height:2, borderRadius:1, background:SERIES_COLORS[i+1]}}/>
              {c}
              <span onClick={() => removeComparator(c)} style={{
                cursor:"pointer", fontSize:13, lineHeight:1,
                color:"var(--text-dim)", padding:"0 4px", borderRadius:"50%",
              }}>×</span>
            </span>
          ))}

          {/* "+ Add ticker / index" button → opens picker */}
          {comparators.length < 3 && (
            <button type="button" ref={pickerBtnRef} onClick={() => setPickerOpen(o => !o)} style={{
              display:"inline-flex", alignItems:"center", gap:4,
              fontFamily:"var(--font-mono)", fontSize:11, fontWeight:600,
              background:"transparent",
              border:"1px dashed var(--border-strong, var(--border))",
              color:"var(--text-muted)",
              padding:"4px 12px", borderRadius:14,
              cursor:"pointer",
            }}>+ Add ticker / index</button>
          )}

          {/* Picker dropdown */}
          {pickerOpen && comparators.length < 3 && (() => {
            const peers = (sector && SUGGESTED_PEERS_BY_SECTOR[sector])
              ? SUGGESTED_PEERS_BY_SECTOR[sector].filter(t => t !== ticker && !comparators.includes(t))
              : [];
            const filt = pickerFilter.trim().toUpperCase();
            const matchesFilt = (t, n) => !filt || t.includes(filt) || (n||"").toUpperCase().includes(filt);
            const indexes = PICKER_INDEXES.filter(({ticker:t,name}) => t !== ticker && !comparators.includes(t) && matchesFilt(t,name));
            const peersFiltered = peers.filter(t => matchesFilt(t,""));
            // Held + watchlist tickers — Joe should be able to compare against
            // anything he holds or watches without typing the full ticker.
            const heldTickers = new Set();
            (accounts || []).forEach(a => (a.positions || []).forEach(p => {
              if (p.ticker && p.ticker !== "CASH") heldTickers.add(p.ticker);
            }));
            const wlTickers = new Set();
            (watchlistRows || []).forEach(w => {
              if (w.ticker) wlTickers.add(w.ticker);
            });
            const userTickers = [...heldTickers, ...wlTickers]
              .filter(t => t !== ticker && !comparators.includes(t)
                       && !peers.includes(t)
                       && !PICKER_INDEXES.some(p => p.ticker === t)
                       && matchesFilt(t, ""));
            // Free-text fallback — if the user typed something and nothing
            // in the curated lists matched, offer it as a 'try anyway' row.
            // The chart fetch will fail gracefully if the symbol does not
            // exist on Yahoo.
            const freeTextRow = filt && filt.length >= 1 && filt.length <= 6
              && /^[A-Z][A-Z0-9.\-]*$/.test(filt)
              && filt !== ticker
              && !comparators.includes(filt)
              && !peers.includes(filt)
              && !PICKER_INDEXES.some(p => p.ticker === filt)
              && !heldTickers.has(filt) && !wlTickers.has(filt)
              ? filt : null;
            const pick = (t) => {
              if (comparators.length >= 3) return;
              setComparators([...comparators, t]);
              setPickerFilter("");
              setPickerOpen(false);
            };
            return (
              <div ref={pickerRef} style={{
                position:"absolute", top:"100%", right:0, marginTop:6,
                background:"var(--surface-solid, var(--paper, #fff))",
                border:"1px solid var(--border)",
                borderRadius:"var(--radius-xs, 6px)",
                boxShadow:"var(--shadow-md)",
                width:280, zIndex:50, padding:8,
              }} onClick={e=>e.stopPropagation()}>
                <input
                  type="text" value={pickerFilter}
                  onChange={e=>setPickerFilter(e.target.value)}
                  placeholder="Search ticker or index…"
                  style={{
                    width:"100%", border:"1px solid var(--border)", borderRadius:4,
                    padding:"7px 10px", fontFamily:"var(--font-mono)", fontSize:12,
                    background:"var(--surface)", color:"var(--text)", outline:"none",
                    marginBottom:8,
                  }}
                  autoFocus
                />
                {peersFiltered.length > 0 && (
                  <>
                    <div style={{
                      fontFamily:"var(--font-mono)", fontSize:9.5, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.14em",
                      color:"var(--text-dim)", padding:"6px 6px 4px",
                    }}>Suggested peers · {sector}</div>
                    {peersFiltered.map(t => (
                      <div key={t} onClick={()=>pick(t)} style={{
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"6px 8px", cursor:"pointer", borderRadius:4,
                        fontFamily:"var(--font-mono)", fontSize:12,
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background="var(--hover, rgba(0,0,0,0.04))";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                        <span style={{fontWeight:600,color:"var(--text)"}}>{t}</span>
                      </div>
                    ))}
                  </>
                )}
                {indexes.length > 0 && (
                  <>
                    <div style={{
                      fontFamily:"var(--font-mono)", fontSize:9.5, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.14em",
                      color:"var(--text-dim)", padding:"10px 6px 4px",
                    }}>Indexes</div>
                    {indexes.map(({ticker:t,name}) => (
                      <div key={t} onClick={()=>pick(t)} style={{
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"6px 8px", cursor:"pointer", borderRadius:4,
                        fontFamily:"var(--font-mono)", fontSize:12,
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background="var(--hover, rgba(0,0,0,0.04))";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                        <span style={{fontWeight:600,color:"var(--text)"}}>{t}</span>
                        <span style={{color:"var(--text-muted)",fontSize:11}}>{name}</span>
                      </div>
                    ))}
                  </>
                )}
                {userTickers.length > 0 && (
                  <>
                    <div style={{
                      fontFamily:"var(--font-mono)", fontSize:9.5, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.14em",
                      color:"var(--text-dim)", padding:"10px 6px 4px",
                    }}>Your holdings & watchlist</div>
                    {userTickers.map(t => (
                      <div key={t} onClick={()=>pick(t)} style={{
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"6px 8px", cursor:"pointer", borderRadius:4,
                        fontFamily:"var(--font-mono)", fontSize:12,
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background="var(--hover, rgba(0,0,0,0.04))";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                        <span style={{fontWeight:600,color:"var(--text)"}}>{t}</span>
                        <span style={{color:"var(--text-muted)",fontSize:11}}>
                          {heldTickers.has(t) ? "owned" : "watching"}
                        </span>
                      </div>
                    ))}
                  </>
                )}
                {freeTextRow && (
                  <>
                    <div style={{
                      fontFamily:"var(--font-mono)", fontSize:9.5, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.14em",
                      color:"var(--text-dim)", padding:"10px 6px 4px",
                    }}>Try this ticker</div>
                    <div onClick={()=>pick(freeTextRow)} style={{
                      display:"flex", justifyContent:"space-between", alignItems:"center",
                      padding:"6px 8px", cursor:"pointer", borderRadius:4,
                      fontFamily:"var(--font-mono)", fontSize:12,
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background="var(--hover, rgba(0,0,0,0.04))";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                      <span style={{fontWeight:600,color:"var(--text)"}}>{freeTextRow}</span>
                      <span style={{color:"var(--text-muted)",fontSize:11}}>add anyway</span>
                    </div>
                  </>
                )}
                {peersFiltered.length === 0 && indexes.length === 0 && userTickers.length === 0 && !freeTextRow && (
                  <div style={{padding:"8px 10px",color:"var(--text-muted)",fontSize:12}}>
                    Type a ticker symbol to add it to the chart.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* SVG chart */}
      {error && rebased.length === 0 ? (
        <div style={{padding: 28, textAlign:"center", color:"var(--text-muted)", fontSize:12}}>
          Couldn't load price history: {error}
        </div>
      ) : loading && rebased.length === 0 ? (
        <div style={{padding: 28, textAlign:"center", color:"var(--text-muted)", fontSize:12}}>
          Loading…
        </div>
      ) : (<>
        {/* Customize chart toolbar (collapsed by default; PR-D2). */}
        <div style={{
          display:"flex", alignItems:"center", gap:6, marginBottom:6,
          paddingBottom:6, borderBottom: customizeOpen ? "1px dashed var(--border-faint)" : "none",
        }}>
          <button type="button" ref={customizeBtnRef} onClick={()=>setCustomizeOpen(o=>!o)} style={{
            display:"inline-flex", alignItems:"center", gap:4,
            fontFamily:"var(--font-mono)", fontSize:11, fontWeight:600,
            background:"transparent", border:"1px solid var(--border)",
            color:"var(--text-2)", padding:"4px 12px", borderRadius:4, cursor:"pointer",
            letterSpacing:"0.04em",
          }}>
            <span>Customize chart</span>
            <span style={{opacity:0.7}}>{customizeOpen ? "▴" : "▾"}</span>
            <span style={{opacity:0.5, marginLeft:4}}>· {activeCount} active</span>
          </button>
          <button type="button" onClick={resetToClean} style={{
            fontFamily:"var(--font-mono)", fontSize:11, fontWeight:600,
            background:"transparent", border:"1px dashed var(--border-strong, var(--border))",
            color:"var(--text-muted)", padding:"4px 12px", borderRadius:4, cursor:"pointer",
            letterSpacing:"0.04em",
          }}>
            ⟲ Reset to clean view
          </button>
        </div>

        {customizeOpen && (
          <div ref={customizeRef} style={{
            background:"var(--surface-3, rgba(0,0,0,0.025))",
            border:"1px solid var(--border-faint)",
            borderRadius:6, padding:"10px 12px",
            marginBottom:8,
          }}>
            <CustomizeGroup label="Moving averages & bands"
              items={[
                {key:"ma50",      label:"50d MA",         on:overlays.ma50},
                {key:"ma200",     label:"200d MA",        on:overlays.ma200},
                {key:"bollinger", label:"Bollinger 20/2", on:overlays.bollinger},
              ]}
              onToggle={k => setOverlays(o => ({ ...o, [k]: !o[k] }))}
            />
            <CustomizeGroup label="Sub-pane indicators"
              items={[
                {key:"rsi",    label:"RSI(14)",      on:subPanes.rsi},
                {key:"volume", label:"Volume bars",  on:subPanes.volume},
              ]}
              onToggle={k => setSubPanes(s => ({ ...s, [k]: !s[k] }))}
            />
            <CustomizeGroup label="Event markers on price line"
              items={[
                {key:"earnings",  label:"Earnings ◆",  on:markers.earnings},
                {key:"dividends", label:"Dividends ●", on:markers.dividends},
                {key:"splits",    label:"Splits ▲",    on:markers.splits},
              ]}
              onToggle={k => setMarkers(m => ({ ...m, [k]: !m[k] }))}
            />
            <CustomizeGroup label="Display"
              items={[
                {key:"crosshair", label:"Crosshair", on:display.crosshair},
                {key:"logScale",  label:"Log scale", on:display.logScale},
              ]}
              onToggle={k => setDisplay(d => ({ ...d, [k]: !d[k] }))}
            />
          </div>
        )}

        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
             onMouseMove={onMove} onMouseLeave={onLeave}
             style={{width:"100%", height:H, display:"block"}}>
          {/* Y-grid + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => {
            const v = yLo + t * (yHi - yLo);
            const y = yToPx(v);
            return (
              <g key={t}>
                <line x1={pL} y1={y} x2={W-pR} y2={y} stroke="var(--border-faint)" strokeWidth="0.5"/>
                <text x={pL-6} y={y+3} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-muted)">
                  {axisMode === "price" ? `$${v.toFixed(0)}` : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                </text>
              </g>
            );
          })}
          {/* Reference line — anchor at 0% in compare mode (rebase start). */}
          {axisMode === "pct" && yLo <= 0 && yHi >= 0 && (
            <>
              <line x1={pL} y1={yToPx(0)} x2={W-pR} y2={yToPx(0)}
                    stroke="var(--text-dim)" strokeDasharray="2,2" strokeWidth="0.7"/>
              <text x={W-pR-4} y={yToPx(0)-3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-dim)">
                start = 0% ({rebased[0]?.baseDate ? fmtDate(rebased[0].baseDate) : ""})
              </text>
            </>
          )}

          {/* Series lines — y from `raw` (price mode) or `pct` (compare mode). */}
          {rebased.map(s => {
            const path = s.points.map((p, i) => `${i===0?"M":"L"} ${xToPx(i).toFixed(2)} ${yToPx(p[yField]).toFixed(2)}`).join(" ");
            return (
              <path key={s.ticker} d={path} fill="none" stroke={s.color} strokeWidth="1.6" />
            );
          })}

          {/* Indicator overlays — render on the primary ticker only, in PRICE
              mode only. Compare mode (% change) skips them. */}
          {axisMode === "price" && primaryPrices.length > 0 && (
            <>
              {overlays.ma50 && (
                <path
                  d={primaryPrices.map((p, i) => sma50[i] != null
                    ? `${i===0||sma50[i-1]==null?"M":"L"} ${xToPx(i).toFixed(2)} ${yToPx(sma50[i]).toFixed(2)}`
                    : null
                  ).filter(Boolean).join(" ")}
                  fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.7"
                />
              )}
              {overlays.ma200 && (
                <path
                  d={primaryPrices.map((p, i) => sma200[i] != null
                    ? `${sma200[i-1]==null?"M":"L"} ${xToPx(i).toFixed(2)} ${yToPx(sma200[i]).toFixed(2)}`
                    : null
                  ).filter(Boolean).join(" ")}
                  fill="none" stroke="var(--text-dim)" strokeWidth="1.2" opacity="0.6" strokeDasharray="3 3"
                />
              )}
              {overlays.bollinger && (
                <>
                  <path
                    d={primaryPrices.map((p, i) => bollinger.upper[i] != null
                      ? `${bollinger.upper[i-1]==null?"M":"L"} ${xToPx(i).toFixed(2)} ${yToPx(bollinger.upper[i]).toFixed(2)}`
                      : null
                    ).filter(Boolean).join(" ")}
                    fill="none" stroke="#8a3ed1" strokeWidth="1" opacity="0.55"
                  />
                  <path
                    d={primaryPrices.map((p, i) => bollinger.lower[i] != null
                      ? `${bollinger.lower[i-1]==null?"M":"L"} ${xToPx(i).toFixed(2)} ${yToPx(bollinger.lower[i]).toFixed(2)}`
                      : null
                    ).filter(Boolean).join(" ")}
                    fill="none" stroke="#8a3ed1" strokeWidth="1" opacity="0.55"
                  />
                </>
              )}
            </>
          )}

          {/* Event markers on the price line — only when in price mode. */}
          {axisMode === "price" && primaryPrices.length > 0 && (
            <>
              {markers.earnings && nextEarnDate && (() => {
                const idx = dateToIdx.get(String(nextEarnDate).slice(0,10));
                if (idx == null || primaryPrices[idx] == null) return null;
                const cx = xToPx(idx), cy = yToPx(primaryPrices[idx].c);
                return <polygon points={`${cx},${cy-6} ${cx+5},${cy} ${cx},${cy+6} ${cx-5},${cy}`}
                                fill="var(--gold, #c89834)" stroke="var(--surface-solid)" strokeWidth="1.5"/>;
              })()}
              {markers.dividends && (dividends || []).map((d, i) => {
                const idx = dateToIdx.get(String(d.ex_dividend_date).slice(0,10));
                if (idx == null || primaryPrices[idx] == null) return null;
                const cx = xToPx(idx), cy = yToPx(primaryPrices[idx].c) + 14;
                return <circle key={"div"+i} cx={cx} cy={cy} r="3.5" fill="var(--accent)" stroke="var(--surface-solid)" strokeWidth="1.5"/>;
              })}
              {markers.splits && (splits || []).map((s, i) => {
                const idx = dateToIdx.get(String(s.execution_date).slice(0,10));
                if (idx == null || primaryPrices[idx] == null) return null;
                const cx = xToPx(idx), cy = yToPx(primaryPrices[idx].c) - 14;
                return <polygon key={"spl"+i} points={`${cx},${cy-5} ${cx+5},${cy+3} ${cx-5},${cy+3}`}
                                fill="var(--gold, #c89834)" stroke="var(--surface-solid)" strokeWidth="1.5"/>;
              })}
            </>
          )}

          {/* X-axis date labels (3 ticks: start, middle, end) */}
          {allDates.length > 0 && [0, Math.floor(allDates.length/2), allDates.length-1].map(i => (
            <text key={i} x={xToPx(i)} y={H-8} textAnchor={i===0?"start":i===allDates.length-1?"end":"middle"}
                  fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-muted)">
              {fmtDate(allDates[i])}
            </text>
          ))}

          {/* Hover crosshair */}
          {hoverIdx != null && allDates[hoverIdx] && (
            <g>
              <line x1={xToPx(hoverIdx)} y1={pT} x2={xToPx(hoverIdx)} y2={H-pB}
                    stroke="var(--text-dim)" strokeWidth="0.6" strokeDasharray="3,3"/>
              {rebased.map(s => {
                const p = s.points[hoverIdx];
                if (!p) return null;
                return <circle key={s.ticker} cx={xToPx(hoverIdx)} cy={yToPx(p[yField])} r="3" fill={s.color} stroke="var(--surface)" strokeWidth="1"/>;
              })}
              {(() => {
                // Smart anchor — when the crosshair is past 70% of chart width,
                // flip the labels to the LEFT side so they don't overflow.
                const cx = xToPx(hoverIdx);
                const flip = cx > pL + (W - pL - pR) * 0.70;
                const labelX = flip ? cx - 6 : cx + 6;
                const anchor = flip ? "end" : "start";
                return (
                  <>
                    <text x={labelX} y={pT+12} textAnchor={anchor} fontSize="10" fontFamily="var(--font-mono)" fill="var(--text)">
                      {fmtDate(allDates[hoverIdx])}
                    </text>
                    {rebased.map((s, idx) => {
                      const pt = s.points[hoverIdx];
                      if (!pt) return null;
                      const yt = pT + 26 + idx * 12;
                      return (
                        <text key={s.ticker} x={labelX} y={yt} textAnchor={anchor} fontSize="10" fontFamily="var(--font-mono)" fill={s.color}>
                          {s.ticker} · ${pt.raw.toFixed(2)} ({pt.pct >= 0 ? "+" : ""}{pt.pct.toFixed(1)}%)
                        </text>
                      );
                    })}
                  </>
                );
              })()}
            </g>
          )}
        </svg>

        {/* RSI(14) sub-pane — toggled via Customize panel. */}
        {subPanes.rsi && primaryPrices.length > 14 && (
          <div style={{marginTop:6, paddingTop:4, borderTop:"1px dashed var(--border-faint)"}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2}}>
              <span style={{fontFamily:"var(--font-mono)", fontSize:9.5, textTransform:"uppercase", letterSpacing:"0.14em", color:"var(--text-dim)"}}>RSI(14)</span>
              <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-2)"}}>
                {(() => {
                  const last = rsi14[rsi14.length-1];
                  return last != null ? last.toFixed(0) : "—";
                })()}
              </span>
            </div>
            <svg viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" style={{width:"100%", height:60, display:"block"}}>
              <line x1="0" y1="18" x2={W} y2="18" stroke="var(--red-text, #c8302a)" strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
              <line x1="0" y1="42" x2={W} y2="42" stroke="var(--green-text, #1a8c39)" strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
              <line x1="0" y1="30" x2={W} y2="30" stroke="var(--text-dim)" strokeWidth="0.5" strokeDasharray="2 4" opacity="0.5"/>
              <path d={primaryPrices.map((p, i) => rsi14[i] != null
                ? `${rsi14[i-1]==null?"M":"L"} ${xToPx(i).toFixed(2)} ${(60 - rsi14[i] * 0.6).toFixed(2)}`
                : null
              ).filter(Boolean).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.4"/>
              <text x="6" y="48" fill="var(--text-dim)" fontFamily="var(--font-mono)" fontSize="8">30</text>
              <text x="6" y="22" fill="var(--text-dim)" fontFamily="var(--font-mono)" fontSize="8">70</text>
            </svg>
          </div>
        )}

        {/* Volume bars sub-pane — toggled via Customize panel. */}
        {subPanes.volume && primaryPrices.length > 0 && (() => {
          const maxV = Math.max(...volumes);
          if (!maxV) return null;
          const barW = Math.max(0.5, (W - pL - pR) / volumes.length * 0.7);
          return (
            <div style={{marginTop:6, paddingTop:4, borderTop:"1px dashed var(--border-faint)"}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2}}>
                <span style={{fontFamily:"var(--font-mono)", fontSize:9.5, textTransform:"uppercase", letterSpacing:"0.14em", color:"var(--text-dim)"}}>Volume</span>
                <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-2)"}}>
                  {(volumes[volumes.length-1] / 1e6).toFixed(1)}M
                </span>
              </div>
              <svg viewBox={`0 0 ${W} 50`} preserveAspectRatio="none" style={{width:"100%", height:50, display:"block"}}>
                {volumes.map((v, i) => {
                  const h = (v / maxV) * 44;
                  const x = xToPx(i) - barW / 2;
                  const up = i > 0 && primaryPrices[i].c >= primaryPrices[i-1].c;
                  return <rect key={i} x={x} y={50 - h} width={barW} height={h}
                               fill={up ? "var(--green-text, #1a8c39)" : "var(--red-text, #c8302a)"}
                               opacity="0.5"/>;
                })}
              </svg>
            </div>
          );
        })()}
      </>)}

      {/* Footer note */}
      <div style={{
        fontSize: 10, color: "var(--text-dim)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
        marginTop: 6,
      }}>
        Yahoo Finance · adjusted close · all series rebased to 100 at the start of the window. Max history goes back to 2002-01-01.
      </div>
    </div>
  );
}


// CustomizeGroup — labelled group of pill-toggle checkboxes for the chart panel.
function CustomizeGroup({ label, items, onToggle }) {
  return (
    <div style={{marginBottom:8}}>
      <div style={{
        fontFamily:"var(--font-mono)", fontSize:9.5, fontWeight:600,
        textTransform:"uppercase", letterSpacing:"0.14em",
        color:"var(--text-dim)", marginBottom:5,
      }}>{label}</div>
      <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
        {items.map(it => (
          <label key={it.key} onClick={() => onToggle(it.key)} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            fontFamily:"var(--font-mono)", fontSize:11, fontWeight:500,
            padding:"4px 10px", borderRadius:14,
            border: it.on ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: it.on ? "var(--accent-soft)" : "transparent",
            color: it.on ? "var(--accent)" : "var(--text-2)",
            cursor:"pointer", userSelect:"none",
            transition:"background var(--dur-fast, 160ms) ease, border-color var(--dur-fast, 160ms) ease",
          }}>
            <span style={{
              display:"inline-block", width:10, height:10,
              borderRadius:2, border:"1px solid currentColor",
              background: it.on ? "currentColor" : "transparent",
              transition:"background var(--dur-fast, 160ms) ease",
            }}/>
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}
