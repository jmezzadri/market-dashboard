// AdminDataHealth — cross-vendor scorecard.
//
// Reached from #admin?view=health (clicked from the Admin landing tile).
//
// Three sections:
//   1. Vendor scorecard — one row per canonical vendor. Columns:
//      vendor, monthly cost, feeds tracked, healthy now (green/total),
//      last successful refresh across the vendor, removal blast radius
//      (what goes blank if this vendor disappears).
//   2. Feed table — one row per pipeline_health entry (currently 52).
//      Columns: feed name, vendor, cadence, status, last refresh,
//      data through, coverage %, last error if any. Filter chips at
//      the top for "all / red / amber / green" and per-vendor.
//   3. Recent run log — the 30 most recent pipeline check timestamps,
//      sorted descending. Same row shape as the feed table but
//      time-ordered. Gives Joe an "is anything failing right now"
//      view across the whole site without scanning section 2.
//
// Data Steward sign-off: section 2 is the canonical user-facing
// surface for "where does this number on the site come from." The
// row count must equal pipeline_health.count() — if a feed exists
// in production but isn't listed here, it isn't being monitored
// and that's a bug to file.

import { useMemo, useState } from "react";
import { useIsAdmin } from "./hooks/useIsAdmin";
import {
  useDataHealth,
  VENDOR_BLAST_RADIUS,
  VENDOR_MONTHLY_COST,
  canonicalVendor,
} from "./hooks/useDataHealth";
import AdminFeedDrawer from "./AdminFeedDrawer";

// Preview deploys skip the admin gate so the page is reviewable without
// a sign-in. Production (macrotilt.com) keeps the gate.
const IS_PRODUCTION_HOST = typeof window !== "undefined"
  && /(^|\.)macrotilt\.com$/.test(window.location.hostname);

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

function Breadcrumb() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontSize: 12, color: MUTED }}>
      <button
        onClick={() => navigate(null)}
        style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", padding: 0, fontSize: 12, textDecoration: "underline" }}
      >‹ Admin overview</button>
      <span>·</span>
      <span style={{ color: "var(--text)" }}>Data Health</span>
    </div>
  );
}

function FilterChip({ active, label, count, onClick, tone }) {
  const c = tone === "green" ? GREEN : tone === "red" ? RED : tone === "amber" ? AMBER : "var(--text-2)";
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        border: active ? `1px solid ${c}` : "1px solid var(--border)",
        background: active ? `${c}15` : "var(--surface)",
        color: active ? c : "var(--text-2)",
        fontSize: 11, cursor: "pointer", fontFamily: "monospace", letterSpacing: "0.02em",
      }}
    >
      {tone && <StatusDot tone={tone} size={6} />}
      {label}
      {count != null && <span style={{ opacity: 0.7 }}>· {count}</span>}
    </button>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Th({ children, align = "left" }) {
  return <th style={{ textAlign: align, padding: "8px 10px", borderBottom: "1px solid var(--border)", textTransform: "uppercase", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: MUTED }}>{children}</th>;
}
function Td({ children, align = "left", style }) {
  return <td style={{ textAlign: align, padding: "9px 10px", color: "var(--text)", fontVariantNumeric: "tabular-nums", verticalAlign: "top", ...style }}>{children}</td>;
}

export default function AdminDataHealth() {
  const live = useIsAdmin();
  const isAdmin     = IS_PRODUCTION_HOST ? live.isAdmin : true;
  const adminLoading = IS_PRODUCTION_HOST ? live.loading : false;
  const { rows, byVendor, loading, error, reload } = useDataHealth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [selectedFeed, setSelectedFeed] = useState(null);

  // ─ Section 1 inputs: per-vendor rollup table ─
  const vendorRows = useMemo(() => {
    const arr = [...byVendor.values()].map((g) => {
      const healthyPct = g.feeds.length ? Math.round((g.green / g.feeds.length) * 100) : 0;
      return {
        vendor: g.vendor,
        cost: VENDOR_MONTHLY_COST[g.vendor] || "—",
        feeds: g.feeds.length,
        green: g.green,
        red: g.red,
        amber: g.amber,
        healthyPct,
        lastGoodAt: g.lastGoodAt,
        blast: VENDOR_BLAST_RADIUS[g.vendor] || "—",
      };
    });
    // Sort: any vendor with a red row first; then by feed count desc.
    return arr.sort((a, b) => {
      if ((b.red > 0) !== (a.red > 0)) return b.red > 0 ? 1 : -1;
      return b.feeds - a.feeds;
    });
  }, [byVendor]);

  // ─ Section 2 inputs: filtered feed list ─
  const filteredFeeds = useMemo(() => {
    let arr = rows;
    if (statusFilter !== "all") arr = arr.filter((r) => r.status === statusFilter);
    if (vendorFilter !== "all") arr = arr.filter((r) => canonicalVendor(r.source) === vendorFilter);
    return [...arr].sort((a, b) => {
      const sa = a.status === "red" ? 0 : a.status === "amber" ? 1 : 2;
      const sb = b.status === "red" ? 0 : b.status === "amber" ? 1 : 2;
      if (sa !== sb) return sa - sb;
      const va = canonicalVendor(a.source);
      const vb = canonicalVendor(b.source);
      if (va !== vb) return va.localeCompare(vb);
      return (a.indicator_id || "").localeCompare(b.indicator_id || "");
    });
  }, [rows, statusFilter, vendorFilter]);

  // ─ Section 3 inputs: most recent runs ─
  const recentRuns = useMemo(() => {
    return [...rows]
      .filter((r) => r.last_check_at)
      .sort((a, b) => (b.last_check_at || "").localeCompare(a.last_check_at || ""))
      .slice(0, 30);
  }, [rows]);

  // Counts for the filter chips.
  const statusCounts = useMemo(() => {
    let g = 0, r = 0, a = 0;
    for (const row of rows) {
      if (row.status === "green") g += 1;
      else if (row.status === "red") r += 1;
      else if (row.status === "amber") a += 1;
    }
    return { green: g, red: r, amber: a, total: rows.length };
  }, [rows]);

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

  const vendorOptions = ["all", ...[...byVendor.keys()].sort()];

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      <Breadcrumb />
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0, letterSpacing: "-0.015em" }}>
          Data Health
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, marginBottom: 0, lineHeight: 1.55, maxWidth: 760 }}>
          Every feed on the site, every vendor it depends on, scored against the manifest deadline. {statusCounts.total} feeds tracked across {byVendor.size} vendors.
        </p>
      </header>

      {error && (
        <div style={{ background: "var(--surface)", border: `1px solid ${RED}`, borderRadius: 8, padding: "12px 14px", color: RED, fontSize: 12, marginBottom: 12, fontFamily: "monospace" }}>
          Pipeline health query failed: {error.message || String(error)}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ padding: "40px 20px", color: MUTED, textAlign: "center" }}>Loading…</div>
      )}

      {/* ─── Section 1: Vendor scorecard ─────────────────────────────── */}
      <Section
        title="Vendor scorecard"
        subtitle={`${vendorRows.length} vendors`}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th align="right">Cost / mo</Th>
                <Th align="right">Feeds</Th>
                <Th align="right">Healthy now</Th>
                <Th>Last refresh</Th>
                <Th>Blast radius (what goes blank if this dies)</Th>
              </tr>
            </thead>
            <tbody>
              {vendorRows.map((v) => {
                const tone = v.red > 0 ? "bad" : v.amber > 0 ? "warn" : "good";
                const c = tone === "good" ? GREEN : tone === "warn" ? AMBER : RED;
                return (
                  <tr key={v.vendor} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusDot tone={v.red > 0 ? "red" : v.amber > 0 ? "amber" : "green"} />
                        <span style={{ fontWeight: 600 }}>{v.vendor}</span>
                      </div>
                    </Td>
                    <Td align="right" style={{ fontFamily: "monospace" }}>{v.cost}</Td>
                    <Td align="right">{v.feeds}</Td>
                    <Td align="right" style={{ color: c, fontWeight: 600 }}>
                      {v.green} / {v.feeds} ({v.healthyPct}%)
                    </Td>
                    <Td>
                      <div>{fmtRelative(v.lastGoodAt)}</div>
                      <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{fmtDateTime(v.lastGoodAt)}</div>
                    </Td>
                    <Td style={{ color: "var(--text-2)", lineHeight: 1.5, maxWidth: 460 }}>{v.blast}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── Section 2: Feed table with filters ─────────────────────── */}
      <Section
        title="Feed table"
        subtitle={`${filteredFeeds.length} of ${rows.length} feeds`}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <FilterChip active={statusFilter === "all"}   label="All"    count={statusCounts.total} onClick={() => setStatusFilter("all")} />
          <FilterChip active={statusFilter === "red"}   label="Red"    count={statusCounts.red}   tone="red"   onClick={() => setStatusFilter("red")} />
          <FilterChip active={statusFilter === "amber"} label="Amber"  count={statusCounts.amber} tone="amber" onClick={() => setStatusFilter("amber")} />
          <FilterChip active={statusFilter === "green"} label="Green"  count={statusCounts.green} tone="green" onClick={() => setStatusFilter("green")} />
          <div style={{ width: 1, background: "var(--border)", margin: "0 6px" }} />
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}
          >
            {vendorOptions.map((v) => (
              <option key={v} value={v}>{v === "all" ? "All vendors" : v}</option>
            ))}
          </select>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <Th>Feed</Th>
                <Th>Vendor</Th>
                <Th>Cadence</Th>
                <Th>Status</Th>
                <Th>Last refresh</Th>
                <Th>Data through</Th>
                <Th align="right">Coverage</Th>
                <Th>Last error</Th>
              </tr>
            </thead>
            <tbody>
              {filteredFeeds.map((r) => (
                <tr
                  key={r.indicator_id}
                  onClick={() => setSelectedFeed(r)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  title="Click for source-to-target lineage"
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Td>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.label || r.indicator_id}</div>
                    <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{r.indicator_id} <span style={{ color: "var(--accent)", marginLeft: 6 }}>· details ›</span></div>
                  </Td>
                  <Td style={{ color: "var(--text-2)" }}>{canonicalVendor(r.source)}</Td>
                  <Td style={{ color: MUTED, fontFamily: "monospace" }}>{r.cadence || "—"}</Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td>
                    <div>{fmtRelative(r.last_good_at)}</div>
                    <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{fmtDateTime(r.last_good_at)}</div>
                  </Td>
                  <Td>{r.data_as_of ? fmtDateTime(r.data_as_of) : <span style={{ color: MUTED }}>—</span>}</Td>
                  <Td align="right">{fmtPct(r.coverage_pct)}</Td>
                  <Td>
                    {r.last_error
                      ? <span style={{ color: RED, fontFamily: "monospace", fontSize: 11 }}>{String(r.last_error).slice(0, 60)}{String(r.last_error).length > 60 ? "…" : ""}</span>
                      : <span style={{ color: MUTED }}>—</span>}
                  </Td>
                </tr>
              ))}
              {filteredFeeds.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "24px 10px", textAlign: "center", color: MUTED, fontSize: 12 }}>No feeds match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── Section 3: Recent run log ─────────────────────────────── */}
      <Section
        title="Recent runs"
        subtitle={`Last ${recentRuns.length} pipeline checks · most recent first`}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Feed</Th>
                <Th>Vendor</Th>
                <Th>Status</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr
                  key={r.indicator_id + ":" + r.last_check_at}
                  onClick={() => setSelectedFeed(r)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  title="Click for source-to-target lineage"
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Td>
                    <div>{fmtRelative(r.last_check_at)}</div>
                    <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{fmtDateTime(r.last_check_at)}</div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.label || r.indicator_id}</div>
                    <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{r.indicator_id} <span style={{ color: "var(--accent)", marginLeft: 6 }}>· details ›</span></div>
                  </Td>
                  <Td style={{ color: "var(--text-2)" }}>{canonicalVendor(r.source)}</Td>
                  <Td><StatusPill status={r.status} /></Td>
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
      </Section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 11, color: MUTED }}>
        <div>Refreshes every 60 seconds from Supabase pipeline_health. Click any feed row for source-to-target lineage.</div>
        <button onClick={reload} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", color: "var(--text-2)", fontSize: 11, cursor: "pointer" }}>Reload</button>
      </div>

      <AdminFeedDrawer feed={selectedFeed} onClose={() => setSelectedFeed(null)} />
    </main>
  );
}
