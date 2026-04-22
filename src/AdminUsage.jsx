// AdminUsage — admin-only UW API usage dashboard.
//
// Data: public.api_usage_log (one row per scheduled scanner run, 90-day
// retention). Read access is RLS-gated on public.is_admin() so a non-admin
// session gets an empty array; we also soft-gate in the component via
// useIsAdmin() so non-admins see a friendly "Not authorized" screen instead
// of an empty dashboard.
//
// Sources tracked (per api_usage_log_source_check in migration 011):
//   universe_snapshot | ticker_events | daily_scanner |
//   scan_on_add       | indicator_refresh | ad_hoc
//
// Charts are hand-rolled SVG (no recharts dep) to match the rest of the app.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { useIsAdmin } from "./hooks/useIsAdmin";

const SOURCE_COLORS = {
  universe_snapshot:  "#60a5fa",   // blue
  ticker_events:      "#a78bfa",   // violet
  daily_scanner:      "#34d399",   // green
  scan_on_add:        "#fbbf24",   // amber
  indicator_refresh:  "#f472b6",   // pink
  ad_hoc:             "#9ca3af",   // gray
};
const SOURCE_LABELS = {
  universe_snapshot:  "Universe snapshot",
  ticker_events:      "Ticker events",
  daily_scanner:      "Daily scanner",
  scan_on_add:        "Scan on add",
  indicator_refresh:  "Indicator refresh",
  ad_hoc:             "Ad-hoc",
};
const SOURCE_ORDER = ["universe_snapshot","ticker_events","daily_scanner","scan_on_add","indicator_refresh","ad_hoc"];

const STATUS_COLORS = { success:"#34d399", partial:"#fbbf24", failed:"#ef4444" };

// ET day key — matches the convention used elsewhere in the app.
function etDayKey(iso) {
  try {
    const d = new Date(iso);
    // Format as YYYY-MM-DD in America/New_York.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" });
    return fmt.format(d); // en-CA gives YYYY-MM-DD directly
  } catch { return iso?.slice(0,10) || ""; }
}

// Grain-aware bucket key (YYYY-MM-DD for day, W:YYYY-MM-DD-Mon for week,
// YYYY-MM for month). Week key uses the Monday-of-week in ET so the label
// sorts cleanly.
function bucketKey(iso, grain) {
  const day = etDayKey(iso);
  if (!day) return "";
  if (grain === "day") return day;
  const [y, m, d] = day.split("-").map(Number);
  if (grain === "month") return `${y}-${String(m).padStart(2,"0")}`;
  // week: ISO week (Monday start) — use the ET-day components to build a
  // neutral Date, then walk back to Monday.
  const local = new Date(Date.UTC(y, m-1, d));
  const wd = local.getUTCDay() || 7; // Sun=0 → 7
  local.setUTCDate(local.getUTCDate() - (wd - 1));
  const wy = local.getUTCFullYear();
  const wm = String(local.getUTCMonth()+1).padStart(2,"0");
  const wdd = String(local.getUTCDate()).padStart(2,"0");
  return `W:${wy}-${wm}-${wdd}`;
}
function bucketLabel(key, grain) {
  if (!key) return "";
  if (grain === "day") return key.slice(5); // MM-DD
  if (grain === "month") {
    const [y,m] = key.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[Number(m)-1]} '${String(y).slice(2)}`;
  }
  // week key: W:YYYY-MM-DD (Monday) → "MM-DD" of week start
  // "W:" (2) + "YYYY" (4) + "-" (1) = 7 chars to skip, leaving "MM-DD".
  return key.slice(7);
}
function currentBucketKey(grain) {
  return bucketKey(new Date().toISOString(), grain);
}
function previousBucketKey(grain) {
  const now = new Date();
  const d = new Date(now);
  if (grain === "day")   d.setUTCDate(d.getUTCDate() - 1);
  if (grain === "week")  d.setUTCDate(d.getUTCDate() - 7);
  if (grain === "month") d.setUTCMonth(d.getUTCMonth() - 1);
  return bucketKey(d.toISOString(), grain);
}
function etTimeShort(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"numeric", minute:"2-digit", hour12:true }).format(d) + " ET";
  } catch { return ""; }
}
function etDateTimeShort(iso) {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", month:"short", day:"numeric" }).format(d);
    return `${date} · ${etTimeShort(iso)}`;
  } catch { return ""; }
}
function fmtInt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US");
}
function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Math.round(Number(n))}%`;
}
function fmtDuration(s) {
  if (s == null) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  if (n < 60) return `${n.toFixed(1)}s`;
  const m = Math.floor(n/60), sec = Math.round(n%60);
  return `${m}m ${sec}s`;
}

// ── DATA HOOK ───────────────────────────────────────────────────────────────
function useApiUsageLog(days = 30) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    supabase
      .from("api_usage_log")
      .select("id, run_id, source, endpoint, calls_made, remaining_daily, limit_daily, peak_rpm, started_at, completed_at, duration_seconds, status, notes")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) { setError(error); setRows([]); }
        else { setError(null); setRows(data || []); }
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [days, reloadTick]);

  return { rows, error, loading, reload: () => setReloadTick(x => x+1) };
}

// ── KPI TILE ────────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, tone }) {
  const toneColor = tone === "good" ? "#34d399" : tone === "warn" ? "#fbbf24" : tone === "bad" ? "#ef4444" : "var(--text)";
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",letterSpacing:"0.1em",textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:toneColor,fontVariantNumeric:"tabular-nums"}}>{value}</div>
      {sub && <div style={{fontSize:11,color:"var(--text-muted)"}}>{sub}</div>}
    </div>
  );
}

// ── STACKED BAR CHART (calls_made by source, bucketed by grain) ────────────
function StackedCalls({ rows, grain }) {
  // Aggregate by ET-bucket × source.
  const { buckets, perBucket, maxTotal } = useMemo(() => {
    const m = new Map(); // bucketKey -> Map(source -> sumCalls)
    (rows || []).forEach(r => {
      const key = bucketKey(r.started_at, grain);
      if (!key) return;
      if (!m.has(key)) m.set(key, new Map());
      const s = m.get(key);
      s.set(r.source, (s.get(r.source) || 0) + (Number(r.calls_made) || 0));
    });
    const buckets = [...m.keys()].sort(); // ascending
    let maxTotal = 0;
    const perBucket = buckets.map(k => {
      const s = m.get(k);
      const total = SOURCE_ORDER.reduce((a,src) => a + (s.get(src) || 0), 0);
      if (total > maxTotal) maxTotal = total;
      return { key:k, parts:SOURCE_ORDER.map(src => ({ src, v:(s.get(src) || 0) })), total };
    });
    return { buckets, perBucket, maxTotal };
  }, [rows, grain]);

  const grainLabel = grain === "week" ? "Weekly" : grain === "month" ? "Monthly" : "Daily";
  const subtitle = `Stacked by source · ${grain === "day" ? "ET days" : grain === "week" ? "ET weeks (Mon–Sun)" : "ET months"}`;

  if (!perBucket.length) return <ChartPanel title={`${grainLabel} UW API calls`} subtitle={subtitle}><EmptyPanel msg="No runs in the selected window." /></ChartPanel>;

  const W = 720, H = 200, PAD_L = 40, PAD_R = 12, PAD_T = 10, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const barW = Math.max(4, plotW / Math.max(1, perBucket.length) * 0.78);
  const step = plotW / Math.max(1, perBucket.length);
  const yScale = v => plotH - (v / Math.max(1, maxTotal)) * plotH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxTotal * f));
  const labelEvery = Math.max(1, Math.floor(perBucket.length / 8));

  return (
    <ChartPanel title={`${grainLabel} UW API calls (last 90d)`} subtitle={subtitle}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {/* y gridlines + labels */}
        {yTicks.map((t,i) => {
          const y = PAD_T + yScale(t);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W-PAD_R} y2={y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray={i===0?"0":"2 3"} />
              <text x={PAD_L - 6} y={y+3} textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">{fmtInt(t)}</text>
            </g>
          );
        })}
        {/* bars */}
        {perBucket.map((b,i) => {
          const x = PAD_L + i*step + (step - barW)/2;
          let acc = 0;
          return (
            <g key={b.key}>
              {b.parts.map(p => {
                if (!p.v) return null;
                const h = (p.v / Math.max(1,maxTotal)) * plotH;
                const y = PAD_T + plotH - acc - h;
                acc += h;
                return <rect key={p.src} x={x} y={y} width={barW} height={h} fill={SOURCE_COLORS[p.src]||"#9ca3af"} />;
              })}
              {(i===0 || i===perBucket.length-1 || i%labelEvery===0) && (
                <text x={x+barW/2} y={H-8} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">
                  {bucketLabel(b.key, grain)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Legend sources={SOURCE_ORDER.filter(s => (rows||[]).some(r => r.source===s))} />
    </ChartPanel>
  );
}

// ── PEAK-RPM LINE (bucketed by grain — peak-of-peaks within bucket) ────────
function PeakRpm({ rows, grain }) {
  const { pts, dmax } = useMemo(() => {
    const m = new Map();
    (rows || []).forEach(r => {
      if (r.peak_rpm == null) return;
      const key = bucketKey(r.started_at, grain);
      if (!key) return;
      const cur = m.get(key) || 0;
      const v = Number(r.peak_rpm) || 0;
      if (v > cur) m.set(key, v);
    });
    const pts = [...m.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([key,v]) => ({ key, v }));
    const dmax = Math.max(120, ...pts.map(p => p.v)); // 120/min UW Basic ceiling — anchor
    return { pts, dmax };
  }, [rows, grain]);

  const grainLabel = grain === "week" ? "week" : grain === "month" ? "month" : "day";
  const title = `Peak requests/min per ${grainLabel}`;

  if (!pts.length) return <ChartPanel title={title} subtitle="UW Basic tier ceiling: 120/min · red line"><EmptyPanel msg="No peak-RPM data logged yet." /></ChartPanel>;

  const W = 720, H = 180, PAD_L = 40, PAD_R = 12, PAD_T = 10, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xScale = i => PAD_L + (pts.length>1 ? (i/(pts.length-1))*plotW : plotW/2);
  const yScale = v => PAD_T + plotH - (v / dmax) * plotH;
  const d = pts.map((p,i) => `${i===0?"M":"L"}${xScale(i)},${yScale(p.v)}`).join(" ");
  const yTicks = [0, 30, 60, 90, 120];
  const labelEvery = Math.max(1, Math.floor(pts.length / 6));

  return (
    <ChartPanel title={title} subtitle="UW Basic tier ceiling: 120/min · red line">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {yTicks.map((t,i) => {
          const y = yScale(t);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W-PAD_R} y2={y} stroke={t===120?"#ef4444":"var(--border)"} strokeWidth={t===120?"1":"0.5"} strokeDasharray={t===0||t===120?"0":"2 3"} />
              <text x={PAD_L - 6} y={y+3} textAnchor="end" fontSize="9" fill={t===120?"#ef4444":"var(--text-muted)"} fontFamily="monospace">{t}</text>
            </g>
          );
        })}
        <path d={d} stroke="var(--accent)" strokeWidth="1.5" fill="none" />
        {pts.map((p,i) => <circle key={i} cx={xScale(i)} cy={yScale(p.v)} r="2.5" fill="var(--accent)" />)}
        {pts.map((p,i) => {
          if (i===0 || i===pts.length-1 || i%labelEvery===0) {
            return <text key={`x${i}`} x={xScale(i)} y={H-8} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">{bucketLabel(p.key, grain)}</text>;
          }
          return null;
        })}
      </svg>
    </ChartPanel>
  );
}

// ── REMAINING-DAILY BY SOURCE (latest reading) ──────────────────────────────
function RemainingDailyByEndpoint({ rows }) {
  const latest = useMemo(() => {
    // Latest row per source that reported remaining_daily + limit_daily.
    const byKey = new Map();
    (rows || []).forEach(r => {
      if (r.remaining_daily == null || r.limit_daily == null) return;
      const k = r.source;
      const prev = byKey.get(k);
      if (!prev || new Date(r.started_at) > new Date(prev.started_at)) byKey.set(k, r);
    });
    return SOURCE_ORDER.map(s => byKey.get(s)).filter(Boolean);
  }, [rows]);

  if (!latest.length) return <EmptyPanel msg="No rate-limit headers observed yet." />;

  return (
    <ChartPanel title="Daily quota remaining (latest reading by source)" subtitle="UW Basic: 20,000 calls/day shared across all scanners">
      <div style={{padding:"6px 14px 14px",display:"flex",flexDirection:"column",gap:8}}>
        {latest.map(r => {
          const used = Math.max(0, (Number(r.limit_daily)||0) - (Number(r.remaining_daily)||0));
          const pct = r.limit_daily > 0 ? Math.min(100, Math.round((used / r.limit_daily) * 100)) : 0;
          const tone = pct >= 85 ? "#ef4444" : pct >= 60 ? "#fbbf24" : "#34d399";
          return (
            <div key={r.source} style={{display:"grid",gridTemplateColumns:"140px 1fr 140px",alignItems:"center",gap:10}}>
              <div style={{fontSize:12,color:"var(--text-2)"}}>{SOURCE_LABELS[r.source]||r.source}</div>
              <div style={{height:10,background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:4,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",background:tone}}/>
              </div>
              <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",textAlign:"right"}}>
                {fmtInt(used)} / {fmtInt(r.limit_daily)} ({fmtPct(pct)})
              </div>
            </div>
          );
        })}
      </div>
    </ChartPanel>
  );
}

// ── RECENT RUNS TABLE ───────────────────────────────────────────────────────
function RecentRunsTable({ rows }) {
  const latest = (rows || []).slice(0, 60);
  if (!latest.length) return <EmptyPanel msg="No runs yet." />;
  return (
    <ChartPanel title="Recent runs" subtitle={`Last ${latest.length} runs · most recent first`}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{color:"var(--text-muted)",fontFamily:"monospace",fontWeight:600,letterSpacing:"0.05em"}}>
              <Th>Started</Th>
              <Th>Source</Th>
              <Th>Endpoint</Th>
              <Th align="right">Calls</Th>
              <Th align="right">Remaining</Th>
              <Th align="right">Peak RPM</Th>
              <Th align="right">Duration</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {latest.map(r => (
              <tr key={r.id} style={{borderTop:"1px solid var(--border)"}}>
                <Td>{etDateTimeShort(r.started_at)}</Td>
                <Td><SourceChip source={r.source}/></Td>
                <Td style={{color:"var(--text-muted)",fontFamily:"monospace"}}>{r.endpoint || "—"}</Td>
                <Td align="right">{fmtInt(r.calls_made)}</Td>
                <Td align="right">{fmtInt(r.remaining_daily)}</Td>
                <Td align="right">{r.peak_rpm!=null ? Number(r.peak_rpm).toFixed(0) : "—"}</Td>
                <Td align="right">{fmtDuration(r.duration_seconds)}</Td>
                <Td><StatusPill status={r.status}/></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartPanel>
  );
}
function Th({ children, align="left" }) {
  return <th style={{textAlign:align,padding:"8px 10px",borderBottom:"1px solid var(--border)",textTransform:"uppercase",fontSize:10}}>{children}</th>;
}
function Td({ children, align="left", style }) {
  return <td style={{textAlign:align,padding:"7px 10px",color:"var(--text)",fontVariantNumeric:"tabular-nums",...style}}>{children}</td>;
}
function SourceChip({ source }) {
  const color = SOURCE_COLORS[source] || "#9ca3af";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:"var(--text-2)"}}>
      <span style={{width:8,height:8,borderRadius:2,background:color}}/>
      {SOURCE_LABELS[source] || source}
    </span>
  );
}
function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || "#9ca3af";
  return (
    <span style={{display:"inline-block",padding:"2px 8px",borderRadius:999,border:`1px solid ${c}`,color:c,fontSize:10,textTransform:"uppercase",fontFamily:"monospace",letterSpacing:"0.05em"}}>
      {status || "—"}
    </span>
  );
}

// ── PANEL CHROME + HELPERS ──────────────────────────────────────────────────
function ChartPanel({ title, subtitle, children }) {
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{title}</div>
        {subtitle && <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
function Legend({ sources }) {
  if (!sources?.length) return null;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:12,padding:"4px 2px 0",fontSize:11,color:"var(--text-muted)"}}>
      {sources.map(s => (
        <span key={s} style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <span style={{width:10,height:10,borderRadius:2,background:SOURCE_COLORS[s]||"#9ca3af"}}/>
          {SOURCE_LABELS[s]||s}
        </span>
      ))}
    </div>
  );
}
function EmptyPanel({ msg }) {
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"24px 16px",textAlign:"center",color:"var(--text-muted)",fontSize:12}}>
      {msg}
    </div>
  );
}

// ── GRAIN SEGMENTED CONTROL ─────────────────────────────────────────────────
function GrainSelect({ value, onChange }) {
  const opts = [
    { id:"day",   label:"Day"   },
    { id:"week",  label:"Week"  },
    { id:"month", label:"Month" },
  ];
  return (
    <div style={{display:"inline-flex",background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:8,padding:2,gap:0}}>
      {opts.map(o => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#0b0e14" : "var(--text-2)",
              border: "none",
              borderRadius: 6,
              padding: "4px 14px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

// ── PERIOD-TOTALS BAND (this/last/90d) ──────────────────────────────────────
function PeriodTotals({ rows, grain }) {
  const { thisT, lastT, windowT } = useMemo(() => {
    const cur = currentBucketKey(grain);
    const prev = previousBucketKey(grain);
    let a=0, b=0, c=0;
    (rows || []).forEach(r => {
      const calls = Number(r.calls_made) || 0;
      c += calls;
      const k = bucketKey(r.started_at, grain);
      if (k === cur)  a += calls;
      if (k === prev) b += calls;
    });
    return { thisT:a, lastT:b, windowT:c };
  }, [rows, grain]);

  const labels = grain === "week"
    ? ["This week", "Last week"]
    : grain === "month"
    ? ["This month", "Last month"]
    : ["Today", "Yesterday"];

  return (
    <div style={{display:"flex",gap:18,alignItems:"baseline",flexWrap:"wrap",fontSize:12,color:"var(--text-muted)",fontFamily:"monospace"}}>
      <span>{labels[0]}: <strong style={{color:"var(--text)"}}>{fmtInt(thisT)}</strong></span>
      <span>{labels[1]}: <strong style={{color:"var(--text)"}}>{fmtInt(lastT)}</strong></span>
      <span>90d total: <strong style={{color:"var(--text)"}}>{fmtInt(windowT)}</strong></span>
    </div>
  );
}

// ── TOP-LEVEL COMPONENT ─────────────────────────────────────────────────────
export default function AdminUsage() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const { rows, error, loading, reload } = useApiUsageLog(90);
  const [grain, setGrain] = useState("day");

  if (adminLoading) {
    return <div style={{padding:"40px 20px",color:"var(--text-muted)",textAlign:"center"}}>Checking access…</div>;
  }
  if (!isAdmin) {
    return (
      <div style={{padding:"40px 20px",display:"flex",justifyContent:"center"}}>
        <div style={{maxWidth:460,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"24px",textAlign:"center"}}>
          <div style={{fontSize:15,fontWeight:700,color:"var(--text)",marginBottom:6}}>Not authorized</div>
          <div style={{fontSize:13,color:"var(--text-muted)",lineHeight:1.6}}>
            This page is visible only to MacroTilt admins. If you think this is a mistake, sign in with the admin account.
          </div>
        </div>
      </div>
    );
  }

  // Top-line KPIs (today only, in ET).
  const today = etDayKey(new Date().toISOString());
  const todaysRows = (rows || []).filter(r => etDayKey(r.started_at) === today);
  const callsToday = todaysRows.reduce((a,r) => a + (Number(r.calls_made)||0), 0);
  const peakRpmToday = todaysRows.reduce((m,r) => Math.max(m, Number(r.peak_rpm)||0), 0);
  const latestRow = (rows || [])[0];
  const minRemaining = (rows || [])
    .filter(r => r.remaining_daily != null && etDayKey(r.started_at) === today)
    .reduce((m,r) => m==null ? r.remaining_daily : Math.min(m, r.remaining_daily), null);
  const failuresToday = todaysRows.filter(r => r.status === "failed").length;

  return (
    <main className="fade-in main-padded" style={{maxWidth:1200, margin:"0 auto", padding:"var(--space-4) var(--space-8) var(--space-10)"}}>
      {/* KPI strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4, minmax(0,1fr))",gap:12,marginBottom:16}}>
        <KpiTile label="Calls today" value={fmtInt(callsToday)} sub={`${todaysRows.length} runs`} />
        <KpiTile label="Remaining (min)" value={minRemaining!=null ? fmtInt(minRemaining) : "—"} sub="across sources reporting" tone={minRemaining!=null && minRemaining < 2000 ? "bad" : minRemaining!=null && minRemaining < 5000 ? "warn" : "good"} />
        <KpiTile label="Peak RPM today" value={peakRpmToday ? peakRpmToday.toFixed(0) : "—"} sub="Basic tier ceiling: 120/min" tone={peakRpmToday>=100?"bad":peakRpmToday>=80?"warn":"good"} />
        <KpiTile label="Last run" value={latestRow ? etTimeShort(latestRow.started_at) : "—"} sub={latestRow ? `${SOURCE_LABELS[latestRow.source]||latestRow.source} · ${latestRow.status}` : "no runs yet"} tone={failuresToday>0?"warn":"good"} />
      </div>

      {error && (
        <div style={{background:"var(--surface)",border:"1px solid #ef4444",borderRadius:8,padding:"12px 14px",color:"#ef4444",fontSize:12,marginBottom:12,fontFamily:"monospace"}}>
          Query failed: {error.message || String(error)}
        </div>
      )}

      {loading && !rows && (
        <div style={{padding:"40px 20px",color:"var(--text-muted)",textAlign:"center"}}>Loading usage data…</div>
      )}

      {/* Grain selector + period totals */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10,flexWrap:"wrap"}}>
        <GrainSelect value={grain} onChange={setGrain} />
        <PeriodTotals rows={rows} grain={grain} />
      </div>

      {/* Main charts */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <StackedCalls rows={rows} grain={grain} />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <PeakRpm rows={rows} grain={grain} />
          <RemainingDailyByEndpoint rows={rows} />
        </div>
        <RecentRunsTable rows={rows} />
      </div>

      {/* Footer / reload */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,fontSize:11,color:"var(--text-muted)"}}>
        <div>Window: last 90 days · RLS-gated via <code style={{fontFamily:"monospace"}}>public.is_admin()</code> · 90-day retention on <code style={{fontFamily:"monospace"}}>api_usage_log</code>.</div>
        <button onClick={reload} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"5px 10px",color:"var(--text-2)",fontSize:11,cursor:"pointer"}}>Reload</button>
      </div>
    </main>
  );
}
