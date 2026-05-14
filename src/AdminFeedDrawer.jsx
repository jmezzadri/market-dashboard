// AdminFeedDrawer — right-side drawer that opens on click of any feed row
// in the Admin Data Health or Polygon Massive tables.
//
// Reads:
//   1. pipeline_health row (passed in as `feed` prop) — live status.
//   2. /data_manifest.json — the deployed 86-element manifest with rich
//      source / target / consumer metadata.
//   3. src/lib/feedLineage.js — pipeline_health.indicator_id → manifest
//      element mapping plus curated extras (API endpoint URLs, column lists).
//
// Surfaces the questions Joe asked: vendor, API vs scrape vs computed,
// which Supabase table or JSON file it lands in, which pages on the site
// read it, what breaks if it dies.

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
    computed:      { bg: "#8b5cf615", border: "#8b5cf6", label: "COMPUTED IN-HOUSE" },
    derived:       { bg: "#06b6d415", border: "#06b6d4", label: "DERIVED" },
    file_download: { bg: "#14b8a615", border: "#14b8a6", label: "FILE DOWNLOAD" },
    manual:        { bg: "#ec489915", border: "#ec4899", label: "USER-ENTERED" },
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
    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10, padding: "5px 0", alignItems: "baseline" }}>
      <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontFamily: mono ? "monospace" : "inherit", lineHeight: 1.5, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

export default function AdminFeedDrawer({ feed, onClose }) {
  // Load /data_manifest.json (list of 86 elements).
  const [elementsList, setElementsList] = useState(null);
  useEffect(() => {
    let mounted = true;
    fetch("/data_manifest.json", { cache: "default" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (!mounted) return;
        // Manifest schema: { _meta, elements: [...], ... }
        const list = Array.isArray(j?.elements) ? j.elements : [];
        setElementsList(list);
      })
      .catch(() => { if (mounted) setElementsList([]); });
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

  const { manifestEntries, detail, unregistered } = lookupFeed(feed.indicator_id, elementsList || []);
  const primary = manifestEntries[0];

  // Ingestion mechanism: prefer the curated explain string, then derive
  // from manifest if we have one, else fall back to "unknown".
  let ingestion;
  if (detail?.ingestion_explain) {
    ingestion = { kind: detail.ingestion_kind || "api", explain: detail.ingestion_explain };
  } else {
    ingestion = ingestionFromManifest(primary);
  }

  const vendorName = canonicalVendor(feed.source);
  const cost = primary?.monthly_cost_usd != null
    ? (primary.monthly_cost_usd === 0 ? "Free" : `$${primary.monthly_cost_usd}/mo`)
    : (VENDOR_MONTHLY_COST[vendorName] || "—");
  const loadingManifest = elementsList === null;

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
          width: "min(680px, 100vw)",
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

        {loadingManifest && (
          <div style={{ padding: "20px", color: MUTED, fontSize: 12, fontStyle: "italic" }}>Loading manifest…</div>
        )}

        {/* Where it comes from */}
        <Section title="Where it comes from">
          <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: "0 0 12px" }}>
            {ingestion.explain}
          </p>
          <KV label="Vendor"          value={primary?.source_vendor || vendorName} />
          <KV label="Monthly cost"    value={cost} mono />
          {detail?.api_endpoint && <KV label="API endpoint" value={detail.api_endpoint} mono />}
          {!detail?.api_endpoint && primary?.source_endpoint && (
            <KV label="Source"        value={primary.source_endpoint} mono />
          )}
          {(primary?.scheduled_fetch_time_et) && (
            <KV label="Scheduled at"   value={`${primary.scheduled_fetch_time_et} ET`} mono />
          )}
          {(primary?.refresh_trigger) && (
            <KV label="Triggered by"   value={primary.refresh_trigger} mono />
          )}
          {(primary?.producer_script) && (
            <KV label="Producer script" value={primary.producer_script} mono />
          )}
          {(primary?.cadence) && <KV label="Cadence" value={primary.cadence} />}
          {(primary?.license_tier) && <KV label="License tier" value={primary.license_tier} />}
        </Section>

        {/* Where it lands */}
        <Section title="Where it lands">
          {!primary && (
            <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic", lineHeight: 1.6, marginBottom: 10 }}>
              {unregistered
                ? "Not yet registered in the data manifest. Add an element entry to /public/data_manifest.json to surface schema metadata here."
                : "No matching manifest entry found for this feed's indicator_id. Try adding a mapping in src/lib/feedLineage.js."}
            </div>
          )}
          {manifestEntries.map((m, i) => (
            <div key={i} style={{ marginBottom: i < manifestEntries.length - 1 ? 14 : 0, paddingBottom: i < manifestEntries.length - 1 ? 12 : 0, borderBottom: i < manifestEntries.length - 1 ? "1px dashed var(--border)" : "none" }}>
              {manifestEntries.length > 1 && (
                <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", marginBottom: 6 }}>{m.name}</div>
              )}
              <KV label="Output destination" value={m.output_destination || "—"} mono />
              {m.freshness_sla_hours != null && (
                <KV label="Freshness deadline" value={`${m.freshness_sla_hours} hours`} mono />
              )}
              {m.category && <KV label="Category" value={m.category} />}
              {m.description && (
                <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, marginTop: 8, fontStyle: "italic" }}>
                  {m.description}
                </div>
              )}
            </div>
          ))}

          {/* Live snapshot from pipeline_health */}
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: MUTED, fontFamily: "monospace" }}>
            Live · status <strong style={{ color: "var(--text)" }}>{feed.status}</strong>
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
              Field-level lineage for this feed isn't curated yet. Add an entry under src/lib/feedLineage.js → FEED_DETAILS to expose the column list here.
            </div>
          </Section>
        )}

        {/* Consumer surfaces — the manifest schema is a list of {tab, tile} */}
        {manifestEntries.some((m) => Array.isArray(m.consumer_surfaces) && m.consumer_surfaces.length > 0) && (
          <Section title="Where it shows up on the site" hint={
            manifestEntries.reduce((a, m) => a + (m.consumer_surfaces?.length || 0), 0) + " surfaces"
          }>
            {manifestEntries.map((m, mi) => (
              <div key={mi} style={{ marginBottom: mi < manifestEntries.length - 1 ? 14 : 0 }}>
                {manifestEntries.length > 1 && (
                  <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", marginBottom: 6 }}>{m.name}</div>
                )}
                <ul style={{ margin: 0, padding: "0 0 0 18px", lineHeight: 1.7 }}>
                  {(m.consumer_surfaces || []).map((s, i) => {
                    // The manifest uses several shapes across rows:
                    //   { tab, tile }                 — most older rows
                    //   { component }                 — newer rows
                    //   { tab, surface }              — alternate
                    //   { route, where, surface, … } — richer ops rows
                    // Render whichever non-null leaf strings are present.
                    if (typeof s === "string") {
                      return <li key={i} style={{ fontSize: 13, color: "var(--text)" }}>{s}</li>;
                    }
                    if (!s || typeof s !== "object") return null;
                    const labelParts = [];
                    if (s.tab)       labelParts.push(<strong key="tab" style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-2)" }}>{s.tab}</strong>);
                    if (s.route)     labelParts.push(<strong key="rt"  style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-2)" }}>{s.route}</strong>);
                    const body = s.tile || s.surface || s.component || s.where || s.element || JSON.stringify(s);
                    return (
                      <li key={i} style={{ fontSize: 13, color: "var(--text)", marginBottom: 4 }}>
                        {labelParts.length > 0 && <>{labelParts.reduce((acc, el, idx) => acc.length ? [...acc, " · ", el] : [el], [])} <span style={{ color: MUTED }}>—</span> </>}
                        {body}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </Section>
        )}

        {/* Failure mode (when present in manifest entry) */}
        {manifestEntries.some((m) => m.failure_mode) && (
          <Section title="If this feed dies">
            {manifestEntries.map((m, i) => m.failure_mode ? (
              <p key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, margin: i === 0 ? "0 0 8px" : "8px 0 0" }}>
                {manifestEntries.length > 1 && <span style={{ fontFamily: "monospace", color: MUTED, fontSize: 11, display: "block", marginBottom: 4 }}>{m.name}:</span>}
                {m.failure_mode}
              </p>
            ) : null)}
          </Section>
        )}

        {/* Footer */}
        <footer style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", marginTop: "auto", fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: "0.05em" }}>
          Lineage from /data_manifest.json + curated extras in src/lib/feedLineage.js. Live row from Supabase pipeline_health.
        </footer>
      </aside>
    </>
  );
}
