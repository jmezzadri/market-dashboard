// ProvenanceStamp — small monospace footer rendering "<SOURCE> · <prefix> <asOf>".
//
// Purpose (Bug #5d): give users a visual cue about where each tile's data
// comes from and how fresh it is, so stale feeds are obvious without having
// to dig into the methodology page or the scanner log. Designed to sit under
// a tile's sub-title or as a table footer — deliberately low-contrast so it
// doesn't compete with primary content.
//
// Props:
//   source  — short uppercase label, e.g. "UW", "FRED", "CBOE". Optional.
//   asOf    — human-readable date/time string, e.g. "Apr 16 2026" or
//             "2026-04-20 07:54 AM EDT". Optional.
//   prefix  — text before asOf. Default "as of". Common: "as of" | "scanned" | "updated".
//   align   — "left" | "right" | "center". Default "left".
//   style   — override/extension.
//
// Renders NOTHING if both source and asOf are empty (opt-out by omission).
export default function ProvenanceStamp({
  source, asOf, prefix = "as of", align = "left", style = {},
}) {
  if (!source && !asOf) return null;
  return (
    <div style={{
      fontSize: 10,
      color: "var(--text-dim)",
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.04em",
      textAlign: align,
      ...style,
    }}>
      {source && <span style={{ fontWeight: 600 }}>{source}</span>}
      {source && asOf && <span style={{ margin: "0 5px" }}>·</span>}
      {asOf && <span>{prefix} {asOf}</span>}
    </div>
  );
}
