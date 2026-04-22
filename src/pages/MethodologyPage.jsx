// MethodologyPage — one unified, searchable "how this works" page. Every
// data stream that feeds the dashboard is rendered as a tile; the top of
// the page carries a search input that filters tiles by a case-insensitive
// substring match across name, source, series ID, summary, details, and
// keywords (see buildSearchBlob in src/data/dataRegistry.js).
//
// Three sections rendered in order: Macro Indicators, Scanner Signals,
// Aggregation Streams. A section heading hides when all of its tiles are
// filtered out so the search experience stays clean.
//
// Tiles are collapsed by default (title row + source chip + frequency pill +
// one-line summary). Clicking a tile toggles it open to reveal the full
// description, series ID, downstream consumers, and — for macro entries —
// the live AS_OF timestamp.
//
// Props:
//   ind   — the IND registry (IND[id] = [...metadata, description, narrative]).
//           The page reads IND[indId][12] for the long description of macro
//           tiles so we don't duplicate that prose into the data registry.
//   asOf  — the AS_OF map ({ id: "Apr 15" }). Rendered on macro tile
//           expansion as "Latest data: Apr 15".

import React, { useMemo, useState } from "react";
import { DATA_REGISTRY, DATA_SECTIONS, buildSearchBlob } from "../data/dataRegistry";

// Mirror of the CATS map in App.jsx. Kept co-located here to keep the page
// self-contained — if category colors ever drift between surfaces, sync
// them explicitly rather than cross-importing.
const CAT_COLORS = {
  equity:  { label:"Equity & Vol",         color:"#8b5cf6" },
  credit:  { label:"Credit Markets",       color:"#f59e0b" },
  rates:   { label:"Rates & Duration",     color:"#06b6d4" },
  fincond: { label:"Financial Conditions", color:"#ec4899" },
  bank:    { label:"Bank & Money Supply",  color:"#14b8a6" },
  labor:   { label:"Labor & Economy",      color:"#3b82f6" },
};

// Frequency color accents — gentle visual grouping on the pill.
const FREQ_COLORS = {
  Daily:       "var(--accent)",
  Weekly:      "#14b8a6",
  Monthly:     "#f59e0b",
  Quarterly:   "#a78bfa",
};
function freqAccent(freq) {
  if (!freq) return "var(--text-dim)";
  for (const [k, v] of Object.entries(FREQ_COLORS)) {
    if (freq.startsWith(k)) return v;
  }
  // catch-all for 3x/weekday, On scan, etc.
  return "#ec4899";
}

// Precompute search blobs once per registry entry.
const REGISTRY_WITH_BLOBS = DATA_REGISTRY.map((row) => ({
  ...row,
  _blob: buildSearchBlob(row),
}));

export default function MethodologyPage({ ind, asOf }) {
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return REGISTRY_WITH_BLOBS;
    return REGISTRY_WITH_BLOBS.filter((row) => row._blob.includes(q));
  }, [q]);

  // Group by section in DATA_SECTIONS order so the render is stable and
  // sections without any matches drop out entirely.
  const bySection = useMemo(() => {
    const map = new Map(DATA_SECTIONS.map((s) => [s.key, []]));
    for (const row of filtered) {
      const bucket = map.get(row.section);
      if (bucket) bucket.push(row);
    }
    return map;
  }, [filtered]);

  const totalCount = REGISTRY_WITH_BLOBS.length;
  const matchCount = filtered.length;

  function toggle(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllVisible() {
    setOpenKeys(new Set(filtered.map((r) => r.key)));
  }
  function collapseAll() {
    setOpenKeys(new Set());
  }

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ────── HEADER + SEARCH ────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Data & Methodology</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, maxWidth: 860 }}>
          Every data stream that feeds MacroTilt, in one place. Each tile is a single source:
          where it comes from, how often it updates, and what part of the dashboard it powers.
          Click a tile to expand; use the search box to filter by name, source, series ID, or keyword.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search streams, sources, series IDs, keywords…"
            aria-label="Search data streams"
            data-testid="methodology-search"
            style={{
              flex: "1 1 320px",
              minWidth: 260,
              maxWidth: 560,
              fontSize: 13,
              padding: "9px 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface-2)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
          <span
            data-testid="methodology-match-count"
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
            }}
          >
            {q ? `${matchCount} / ${totalCount} streams` : `${totalCount} streams`}
          </span>
          <button
            type="button"
            onClick={expandAllVisible}
            style={{
              fontSize: 11, fontFamily: "var(--font-mono)",
              padding: "6px 10px", borderRadius: 4,
              background: "var(--surface-2)", color: "var(--text-2)",
              border: "1px solid var(--border)", cursor: "pointer",
            }}
          >
            Expand visible
          </button>
          <button
            type="button"
            onClick={collapseAll}
            style={{
              fontSize: 11, fontFamily: "var(--font-mono)",
              padding: "6px 10px", borderRadius: 4,
              background: "var(--surface-2)", color: "var(--text-2)",
              border: "1px solid var(--border)", cursor: "pointer",
            }}
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* ────── SECTIONS ────── */}
      {DATA_SECTIONS.map((sec) => {
        const rows = bySection.get(sec.key) || [];
        if (q && rows.length === 0) return null; // hide empty sections when filtering
        return (
          <div key={sec.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{
              display: "flex", alignItems: "baseline", gap: 10,
              paddingBottom: 6, borderBottom: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
                {sec.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                · {rows.length} {rows.length === 1 ? "stream" : "streams"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55, maxWidth: 820, marginBottom: 4 }}>
              {sec.blurb}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 10 }}>
              {rows.map((row) => (
                <Tile
                  key={row.key}
                  row={row}
                  open={openKeys.has(row.key)}
                  onToggle={() => toggle(row.key)}
                  ind={ind}
                  asOf={asOf}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Empty state when search matches nothing */}
      {q && matchCount === 0 && (
        <div style={{
          background: "var(--surface)", border: "1px dashed var(--border)",
          borderRadius: 8, padding: "16px 18px",
          fontSize: 13, color: "var(--text-muted)", textAlign: "center",
        }}>
          No streams match <code style={{ color: "var(--text)" }}>{JSON.stringify(query)}</code>. Try a broader term like <code>fred</code>, <code>options</code>, or <code>quarterly</code>.
        </div>
      )}

      {/* ────── DISCLAIMER ────── */}
      <div style={{
        background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
        padding: "12px 14px", marginTop: 8,
      }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", marginBottom: 6 }}>
          DISCLAIMER
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.75 }}>
          This dashboard is for informational and educational purposes only. It is not financial advice,
          investment advice, or a solicitation to buy or sell any security. All data is sourced from public
          databases and third-party providers and may have errors or delays. Past relationships between
          indicators and market outcomes do not guarantee future results.
        </div>
      </div>
    </div>
  );
}

function Tile({ row, open, onToggle, ind, asOf }) {
  const cat = row.category ? CAT_COLORS[row.category] : null;
  const freqColor = freqAccent(row.freq);

  // Macro tiles borrow their long description from IND[indId][12]; scanner
  // and infra tiles use the inline `details` string from the registry.
  const longDescription = row.section === "macro" && row.indId
    ? (ind?.[row.indId]?.[12] || row.details || row.summary)
    : (row.details || row.summary);
  const latestData = row.section === "macro" && row.indId ? (asOf?.[row.indId] || null) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
      }}
      aria-expanded={open}
      data-testid={`methodology-tile-${row.key}`}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {cat && (
          <div
            title={cat.label}
            style={{ width: 10, height: 10, borderRadius: 2, background: cat.color, marginTop: 5, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
              {row.name}
            </div>
            {row.tier && (
              <span style={{ fontSize: 9, color: cat?.color || "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", fontWeight: 700 }}>
                T{row.tier}
              </span>
            )}
          </div>
          {row.longName && row.longName !== row.name && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {row.longName}
            </div>
          )}
        </div>
        <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1, marginTop: 2, flexShrink: 0 }}>
          {open ? "▾" : "▸"}
        </div>
      </div>

      {/* Chips row: source + frequency + (optional) category label on non-macro when no color chip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Chip label={row.source} tone="neutral" />
        <Chip label={row.freq} tone="accent" color={freqColor} />
      </div>

      {/* Summary */}
      <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.65, marginTop: 8 }}>
        {row.summary}
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          {row.seriesId && (
            <Field label="Series / endpoint" value={row.seriesId} mono />
          )}
          {latestData && (
            <Field label="Latest data" value={latestData} mono />
          )}
          {row.powers?.length > 0 && (
            <Field
              label="Powers"
              valueNode={
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
                  {row.powers.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              }
            />
          )}
          <Field
            label="Detail"
            valueNode={
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.75 }}>
                {longDescription}
              </div>
            }
          />
          {cat && (
            <Field label="Category" value={cat.label} />
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone, color }) {
  if (!label) return null;
  const baseColor = color || (tone === "accent" ? "var(--accent)" : "var(--text-muted)");
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        color: baseColor,
        border: `1px solid ${baseColor}`,
        borderRadius: 3,
        padding: "2px 6px",
        lineHeight: 1.45,
        whiteSpace: "nowrap",
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
}

function Field({ label, value, valueNode, mono }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
        {label.toUpperCase()}
      </div>
      {valueNode ? (
        valueNode
      ) : (
        <div style={{
          fontSize: 12, color: "var(--text-2)",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          lineHeight: 1.6,
        }}>
          {value}
        </div>
      )}
    </div>
  );
}
