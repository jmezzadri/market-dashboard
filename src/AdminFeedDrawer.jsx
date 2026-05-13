// AdminFeedDrawer — right-side drawer that opens on click of any feed row
// in the Admin Data Health or Polygon Massive tables.
//
// Answers the questions Joe was struggling to find on the site:
//   • Where does this data come from? (vendor + API / scrape / computed /
//     manual / file download)
//   • What columns / fields does it produce? (data_fields table)
//   • What table or file does it land in? (target_storage)
//   • Which pages on the site consume it? (consumer_surfaces)
//   • What breaks if it goes away? (failure_mode)
//   • What's its current health? (status, last refresh, coverage)
//
// Data sources:
//   1. pipeline_health row (passed in as `feed` prop) — live status,
//      last refresh, coverage, errors.
//   2. /data_manifest.json — schema metadata (vendor, schedule, target
//      storage, consumer surfaces, failure mode).
//   3. src/lib/feedLineage.js — pipeline_health.indicator_id → manifest
//      key mapping plus curated per-feed ingestion mechanism and data
//      field tables.

import { useEffect, useState } from "react";
import { canonicalVendor, VENDOR_MONTHLY_COST } from "./hooks/useDataHealth";
import { lookupFeed, ingestionFromManifest } from "./lib/feedLineage";

const GREEN = "#34d399";
const RED   = "#ef4444";
const AMBER = "#B8860B";
const MUTED = "var(--text-muted)";

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

function StatusPill({ status }) {
  const c = status === "green" ? GREEN : status === "red" ? RED : status === "amber" ? AMBER : MUTED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 10px", borderRadius: 999, border: `1px solid ${c}`, color: c,
      fontSize: 11, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: "0.05em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
      {status || "—"}
    </span>
  );
}

function IngestionBadge({ kind }) {
  const palette = {
    api:           { bg: "#3b82f615", border: "#3b82f6", label: "API CALL" },
    scrape:        { bg: "#f59e0b15", border: "#f59e0b", label: "WEB SCRAPE" },
    computed:      { bg: "#8b5cf615", border: "#8b5cf6", label: "COMPUTED" },
    derived:       { bg: "#06b6d415", border: "#06b6d4", label: "DERIVED" },
    file_download: { bg: "#14b8a615", border: "#14b8a6", label: "FILE DOWNLOAD" },
    manual:        { bg: "#ec489915", border: "#ec4899", label: "MANUAL ENTRY" },
    unknown:       { bg: "var(--surface-2)", border: "var(--border)", label: "UNKNOWN" },
  };
  const p = palette[kind] || palette.unknown;
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 4,
      background: p.bg, border: `1px solid ${p.border}`, color: p.border,
      fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.08em",
    }}>{p.label}</span>
  );
}

function Section({ title, hint, children }) {
  return (
    <section style={{ borderTop: "1px solid var(--border)", padding: "16px 20px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>{title}</div>
        {hint && <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{hint}</div>}
      </div>
      {children}
    </section>
  );
}

function KV({ label, value, mono = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, padding: "5px 0", alignItems: "baseline" }}>
      <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontFamily: mono ? "monospace" : "inherit", lineHeight: 1.5, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

export default function AdminFeedDrawer({ feed, onClose }) {
  // Load /data_manifest.json once per session for the schema metadata.
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    let mounted = true;
    fetch("/data_manifest.json", { cache: "default" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (mounted) setManifest(j); })
      .catch(() => { if (mounted) setManifest(null); });
    return () => { mounted = false; };
  }, []);

  // ESC to close.
  useEffect(() => {
    if (!feed) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feed, onClose]);

  if (!feed) return null;

  const { manifestKeys, detail } = lookupFeed(feed.indicator_id);
  const manifestEntries = (manifest?.elements && manifestKeys.length)
    ? manifestKeys.map((k) => manifest.elements[k]).filter(Boolean)
    : [];
  // For the ingestion-mechanism fallback when detail.ingestion isn't set,
  // pick the first matched manifest entry.
  const ingestion = detail?.ingestion
    ? { kind: detail._ingestion_kind || guessKindFromText(detail.ingestion), explain: detail.ingestion }
    : ingestionFromManifest(manifestEntries[0]);

  const vendorName = canonicalVendor(feed.source);
  const cost = VENDOR_MONTHLY_COST[vendorName] || "—";

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(11, 14, 20, 0.45)",
          backdropFilter: "blur(2px)",
          zIndex: 60,
        }}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-label={`Feed details for ${feed.label || feed.indicator_id}`}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(640px, 100vw)",
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          zIndex: 61,
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Sticky header */}
        <header style={{ padding: "16px 20px 14px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                Feed lineage
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em", lineHeight: 1.3 }}>
                {feed.label || feed.indicator_id}
              </div>
              <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", marginTop: 4 }}>
                {feed.indicator_id}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                <StatusPill status={feed.status} />
                <IngestionBadge kind={ingestion.kind} />
                <span style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>· last refresh {fmtRelative(feed.last_good_at)}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text-2)", cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}
            >Close ✕</button>
          </div>
        </header>

        {/* Body */}
        <Section title="Where it comes from">
          <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: "0 0 12px" }}>
            {ingestion.explain}
          </p>
          <KV label="Vendor"        value={vendorName} />
          <KV label="Monthly cost"  value={cost} mono />
          {detail?.api_endpoint && <KV label="API endpoint" value={detail.api_endpoint} mono />}
          {(detail?.triggered_by || manifestEntries[0]?.refresh_trigger) && (
            <KV label="Triggered by" value={detail?.triggered_by || manifestEntries[0].refresh_trigger} />
          )}
          {(manifestEntries[0]?.schedule_et) && (
            <KV label="Schedule"     value={manifestEntries[0].schedule_et} />
          )}
          {(manifestEntries[0]?.cadence) && (
            <KV label="Cadence"      value={manifestEntries[0].cadence} />
          )}
        </Section>

        <Section title="Where it lands">
          {manifestEntries.length === 0 && (
            <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic" }}>
              No manifest entry mapped for this feed yet. Falling back to live pipeline_health row only.
            </div>
          )}
          {manifestEntries.map((m, i) => (
            <div key={i} style={{ marginBottom: i < manifestEntries.length - 1 ? 14 : 0 }}>
              <KV label="Target storage" value={m.target_storage || "—"} mono />
              {m.freshness_sla_hours != null && (
                <KV label="Freshness deadline" value={`${m.freshness_sla_hours} hours`} mono />
              )}
              {m.category && <KV label="Category" value={m.category} />}
            </div>
          ))}

          {/* Live snapshot from pipeline_health */}
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: MUTED, fontFamily: "monospace" }}>
            Live snapshot · status <strong style={{ color: "var(--text)" }}>{feed.status}</strong>
            {" · "}last refresh <strong style={{ color: "var(--text)" }}>{fmtDateTime(feed.last_good_at)}</strong>
            {feed.data_as_of && <> · data through <strong style={{ color: "var(--text)" }}>{fmtDateTime(feed.data_as_of)}</strong></>}
            {feed.coverage_pct != null && <> · coverage <strong style={{ color: "var(--text)" }}>{Number(feed.coverage_pct).toFixed(1)}%</strong></>}
            {feed.last_error && <div style={{ marginTop: 6, color: RED }}>error: {String(feed.last_error).slice(0, 200)}</div>}
          </div>
        </Section>

        {/* Data fields produced */}
        {detail?.data_fields?.length > 0 && (
          <Section title="Data fields produced" hint={`${detail.data_fields.length} columns`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: MUTED, fontFamily: "monospace", fontSize: 10, letterSpacing: "0.05em" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", textTransform: "uppercase", fontWeight: 600 }}>Field</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", textTransform: "uppercase", fontWeight: 600 }}>Example</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", textTransform: "uppercase", fontWeight: 600 }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data_fields.map((f, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "7px 8px", color: "var(--text)", fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{f.name}</td>
                      <td style={{ padding: "7px 8px", color: "var(--text-2)", fontFamily: "monospace", fontSize: 11 }}>{f.example}</td>
                      <td style={{ padding: "7px 8px", color: "var(--text-2)", lineHeight: 1.5 }}>{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {!detail?.data_fields?.length && (
          <Section title="Data fields produced">
            <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic", lineHeight: 1.6 }}>
              Field-level lineage for this feed isn't curated yet. Add an entry under <code style={{ fontFamily: "monospace" }}>src/lib/feedLineage.js → FEED_DETAILS</code> to expose the column list here.
            </div>
          </Section>
        )}

        {/* Consumer surfaces */}
        {manifestEntries.length > 0 && (
          <Section title="Where it shows up on the site" hint={
            manifestEntries.reduce((a, m) => a + (m.consumer_surfaces?.length || 0), 0) + " surfaces"
          }>
            {manifestEntries.map((m, mi) => (
              <div key={mi} style={{ marginBottom: mi < manifestEntries.length - 1 ? 14 : 0 }}>
                {manifestEntries.length > 1 && (
                  <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", marginBottom: 6 }}>
                    {m.element || manifestKeys[mi]}
                  </div>
                )}
                {(m.consumer_surfaces || []).length === 0 && (
                  <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic" }}>No live consumer surfaces listed.</div>
                )}
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  {(m.consumer_surfaces || []).map((s, i) => (
                    <li key={i} style={{ fontSize: 13, color: "var(--text)" }}>{s}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        )}

        {/* Failure mode */}
        {manifestEntries.some((m) => m.failure_mode) && (
          <Section title="If this feed dies">
            {manifestEntries.map((m, i) => m.failure_mode ? (
              <p key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: i === 0 ? "0 0 8px" : "8px 0 0" }}>
                {manifestEntries.length > 1 && <span style={{ fontFamily: "monospace", color: MUTED, fontSize: 11, display: "block", marginBottom: 4 }}>{m.element || manifestKeys[i]}:</span>}
                {m.failure_mode}
              </p>
            ) : null)}
          </Section>
        )}

        {/* Footer */}
        <footer style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", marginTop: "auto", fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: "0.05em" }}>
          Lineage data combines /data_manifest.json + curated entries in src/lib/feedLineage.js. Live row from Supabase pipeline_health.
        </footer>
      </aside>
    </>
  );
}

// Best-effort kind classification from a curated explain string, for the
// badge colour. Used when FEED_DETAILS provides custom prose but no
// _ingestion_kind field. Falls back to 'api' (the most common case).
function guessKindFromText(text = "") {
  const t = text.toLowerCase();
  if (t.includes("scrape"))   return "scrape";
  if (t.includes("computed") || t.includes("calculated"))  return "computed";
  if (t.includes("derived"))  return "derived";
  if (t.includes("manual"))   return "manual";
  if (t.includes("file") && t.includes("downloaded")) return "file_download";
  return "api";
}
