// AdminMassive — Polygon Massive vendor detail page.
//
// Reached from #admin?view=massive (clicked from the Admin landing tile).
//
// Top: breadcrumb back to /admin landing.
// Section 1 — KPI strip (4 tiles): feeds tracked · feeds green now · last
//             successful refresh · most recent coverage % (a Polygon-
//             specific freshness indicator that tells us how much of the
//             expected ~12,600-ticker universe actually came through on
//             the most recent end-of-day pull).
// Section 2 — Feed table: one row per Polygon-Massive-backed feed in
//             pipeline_health (typically massive-eod, massive-universe,
//             massive-corporate-actions, massive-ticker-details, plus
//             the sector-perf rollup which is computed from Massive EOD
//             but routes through MacroTilt in-house — shown here for
//             completeness). Columns: feed, status, last refresh,
//             coverage %, last error if any, expected next refresh.
//
// Data source: public.pipeline_health filtered to canonical vendor
// "Polygon Massive". Reuses useDataHealth() so the landing tile and
// this page show identical numbers.
//
// Quant sign-off: coverage % is read straight from pipeline_health
// (computed by the producer side at ingest time — see migration 011
// + pipeline_health update path). 100% means every expected ticker
// arrived; 96.77% (current) means ~3% of the universe was missing
// on the last EOD pull, typically late-listed or recently-delisted
// names that the producer accepts as expected slippage.

import { useMemo } from "react";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { useDataHealth } from "./hooks/useDataHealth";

const GREEN = "#34d399";
const RED   = "#ef4444";
const AMBER = "#B8860B";
const MUTED = "var(--text-muted)";

function navigate(view) {
  const next = view ? `admin?view=${view}` : "admin";
  if (window.location.hash.slice(1) !== next) window.location.hash = next;
}

function fmtRelative(iso) {
  if (!iso) return "never";
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 1)   return "just now";
  if (min < 60)  return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24)   return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 7)   return `${Math.round(day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    return `${date} · ${time} ET`;
  } catch { return iso?.slice(0, 16) || "—"; }
}
function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function StatusDot({ tone, size = 8 }) {
  const c = tone === "green" ? GREEN : tone === "red" ? RED : tone === "amber" ? AMBER : MUTED;
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: c, flexShrink: 0 }} />;
}
function StatusPill({ status }) {
  const c = status === "green" ? GREEN : status === "red" ? RED : status === "amber" ? AMBER : MUTED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px", borderRadius: 999, border: `1px solid ${c}`, color: c,
      fontSize: 10, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: "0.05em",
    }}>
      <StatusDot tone={status} size={6} />
      {status || "—"}
    </span>
  );
}

function KpiTile({ label, value, sub, tone }) {
  const toneColor = tone === "good" ? GREEN : tone === "warn" ? AMBER : tone === "bad" ? RED : "var(--text)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: toneColor, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>}
    </div>
  );
}

function Breadcrumb({ children }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontSize: 12, color: MUTED }}>
      <button
        onClick={() => navigate(null)}
        style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", padding: 0, fontSize: 12, textDecoration: "underline" }}
      >‹ Admin overview</button>
      <span>·</span>
      <span style={{ color: "var(--text)" }}>{children}</span>
    </div>
  );
}

export default function AdminMassive() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const { byVendor, loading, error, reload } = useDataHealth();

  const feeds = useMemo(() => {
    const g = byVendor.get("Polygon Massive");
    if (!g) return [];
    return [...g.feeds].sort((a, b) => (a.indicator_id || "").localeCompare(b.indicator_id || ""));
  }, [byVendor]);

  const summary = useMemo(() => {
    const totalFeeds = feeds.length;
    const greenFeeds = feeds.filter((r) => r.status === "green").length;
    const redFeeds   = feeds.filter((r) => r.status === "red").length;
    const lastGoodAt = feeds.reduce((acc, r) => (r.last_good_at && (!acc || r.last_good_at > acc)) ? r.last_good_at : acc, null);
    const eodRow = feeds.find((r) => r.indicator_id === "massive-eod");
    const coveragePct = eodRow?.coverage_pct;
    return { totalFeeds, greenFeeds, redFeeds, lastGoodAt, coveragePct };
  }, [feeds]);

  if (adminLoading) return <div style={{ padding: "40px 20px", color: MUTED, textAlign: "center" }}>Checking access…</div>;
  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 20px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Not authorized</div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>This page is admin-only.</div>
        </div>
      </div>
    );
  }

  const coverageTone = summary.coveragePct == null ? "neutral"
    : summary.coveragePct >= 95 ? "good"
    : summary.coveragePct >= 85 ? "warn" : "bad";
  const healthTone = summary.redFeeds > 0 ? "bad" : summary.greenFeeds === summary.totalFeeds ? "good" : "warn";

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      <Breadcrumb>Polygon Massive</Breadcrumb>

      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0, letterSpacing: "-0.015em" }}>
          Polygon Massive
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, marginBottom: 0, lineHeight: 1.55, maxWidth: 760 }}>
          End-of-day equity prices, the ticker reference table, dividends, splits, and the master universe of ~12,600 US-listed names. Daily refresh runs at 18:00 ET on weekdays with 20:00 and 23:00 ET backups.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiTile label="Feeds tracked" value={summary.totalFeeds || "—"} sub="from pipeline_health" />
        <KpiTile
          label="Healthy now"
          value={`${summary.greenFeeds} / ${summary.totalFeeds || "—"}`}
          sub={summary.redFeeds > 0 ? `${summary.redFeeds} stale` : "all within deadline"}
          tone={healthTone}
        />
        <KpiTile
          label="Last refresh"
          value={fmtRelative(summary.lastGoodAt)}
          sub={summary.lastGoodAt ? fmtDateTime(summary.lastGoodAt) : "no successful runs"}
          tone={healthTone}
        />
        <KpiTile
          label="Most recent coverage"
          value={fmtPct(summary.coveragePct)}
          sub="of expected universe"
          tone={coverageTone}
        />
      </div>

      {error && (
        <div style={{ background: "var(--surface)", border: `1px solid ${RED}`, borderRadius: 8, padding: "12px 14px", color: RED, fontSize: 12, marginBottom: 12, fontFamily: "monospace" }}>
          Pipeline health query failed: {error.message || String(error)}
        </div>
      )}

      {loading && feeds.length === 0 && (
        <div style={{ padding: "40px 20px", color: MUTED, textAlign: "center" }}>Loading feed status…</div>
      )}

      {/* Feed table */}
      {feeds.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Feeds powered by Polygon Massive</div>
            <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>{feeds.length} feeds · scored against the manifest deadline</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: MUTED, fontFamily: "monospace", fontWeight: 600 }}>
                  <Th>Feed</Th>
                  <Th>Status</Th>
                  <Th>Last refresh</Th>
                  <Th align="right">Coverage</Th>
                  <Th>Data through</Th>
                  <Th>Next refresh</Th>
                  <Th>Last error</Th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((r) => (
                  <tr key={r.indicator_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.label || r.indicator_id}</div>
                      <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{r.indicator_id}</div>
                    </Td>
                    <Td><StatusPill status={r.status} /></Td>
                    <Td>
                      <div style={{ color: "var(--text)" }}>{fmtRelative(r.last_good_at)}</div>
                      <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{fmtDateTime(r.last_good_at)}</div>
                    </Td>
                    <Td align="right">{fmtPct(r.coverage_pct)}</Td>
                    <Td>{r.data_as_of ? fmtDateTime(r.data_as_of) : <span style={{ color: MUTED }}>—</span>}</Td>
                    <Td>{r.expected_next_run ? fmtDateTime(r.expected_next_run) : <span style={{ color: MUTED }}>—</span>}</Td>
                    <Td>
                      {r.last_error
                        ? <span style={{ color: RED, fontFamily: "monospace", fontSize: 11 }}>{String(r.last_error).slice(0, 80)}{String(r.last_error).length > 80 ? "…" : ""}</span>
                        : <span style={{ color: MUTED }}>—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 11, color: MUTED }}>
        <div>Refreshes every 60 seconds from Supabase pipeline_health.</div>
        <button onClick={reload} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", color: "var(--text-2)", fontSize: 11, cursor: "pointer" }}>Reload</button>
      </div>
    </main>
  );
}

function Th({ children, align = "left" }) {
  return <th style={{ textAlign: align, padding: "8px 10px", borderBottom: "1px solid var(--border)", textTransform: "uppercase", fontSize: 10 }}>{children}</th>;
}
function Td({ children, align = "left", style }) {
  return <td style={{ textAlign: align, padding: "9px 10px", color: "var(--text)", fontVariantNumeric: "tabular-nums", verticalAlign: "top", ...style }}>{children}</td>;
}
