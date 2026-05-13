// AdminLanding — admin home page with three tile cards.
//
// Tile 1: Polygon Massive  → /admin?view=massive   (vendor detail)
// Tile 2: Unusual Whales   → /admin?view=uw        (vendor detail — existing
//                                                    AdminUsage view, kept
//                                                    intact under a new
//                                                    route label)
// Tile 3: Data Health      → /admin?view=health    (cross-vendor scorecard
//                                                    + feed table + run log)
//
// Each tile is a clickable card that shows a tiny live health summary
// pulled from useDataHealth() — number of feeds for the vendor, count of
// green vs red right now, latest successful refresh. The intent is for
// Joe to see "all green" or "1 red at FRED" at a glance, then click into
// the detail page to diagnose.
//
// Design notes (UX Designer):
// - Layout is a single CSS grid (1 col on mobile, 3 cols at md+) so the
//   page reads top-to-bottom on a phone and side-by-side on a laptop.
// - Tiles use the same chrome as the rest of the site (var(--surface) +
//   var(--border) + 8px radius). No new design tokens introduced.
// - Status colour uses the existing green/red palette already in the
//   site (FreshnessChip uses the same).
// - The Data Health tile is visually distinct (slightly heavier border)
//   so it reads as the cross-cutting destination, not "another vendor."

import { useMemo } from "react";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { useDataHealth, VENDOR_MONTHLY_COST } from "./hooks/useDataHealth";

const GREEN = "#34d399";
const RED   = "#ef4444";
const AMBER = "#B8860B";
const MUTED = "var(--text-muted)";

function navigate(view) {
  // Hash-based routing — matches the rest of App.jsx. URLSearchParams keeps
  // existing #admin?id=... patterns happy.
  const next = view ? `admin?view=${view}` : "admin";
  if (window.location.hash.slice(1) !== next) window.location.hash = next;
}

function formatRelative(iso) {
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

function StatusDot({ tone, size = 8 }) {
  const c = tone === "green" ? GREEN : tone === "red" ? RED : tone === "amber" ? AMBER : MUTED;
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: c, flexShrink: 0 }} />;
}

function Tile({ title, eyebrow, body, footer, accent, onClick, big = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "var(--surface)",
        border: `1px solid ${big ? "var(--text-2)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: "pointer",
        transition: "transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        minHeight: 200,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 6px 14px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = big ? "var(--text-2)" : "var(--border)";
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
      }}
    >
      <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, flex: 1 }}>
        {body}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 11, color: MUTED, fontFamily: "monospace", flexWrap: "wrap" }}>
        {footer}
        <span style={{ marginLeft: "auto", color: accent || "var(--text-2)" }}>Open ›</span>
      </div>
    </button>
  );
}

function vendorStats(byVendor, vendorName) {
  const g = byVendor.get(vendorName);
  if (!g) return { feeds: 0, green: 0, red: 0, amber: 0, lastGoodAt: null };
  return g;
}

export default function AdminLanding() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const { byVendor, rows, loading } = useDataHealth();

  // Cross-vendor rollups for the Data Health tile.
  const totals = useMemo(() => {
    let green = 0, red = 0, amber = 0;
    for (const r of rows) {
      if (r.status === "green") green += 1;
      else if (r.status === "red") red += 1;
      else if (r.status === "amber") amber += 1;
    }
    const vendors = byVendor.size;
    return { total: rows.length, green, red, amber, vendors };
  }, [rows, byVendor]);

  if (adminLoading) {
    return <div style={{ padding: "40px 20px", color: MUTED, textAlign: "center" }}>Checking access…</div>;
  }
  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 20px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Not authorized</div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
            This area is visible only to MacroTilt admins. If you think this is a mistake, sign in with the admin account.
          </div>
        </div>
      </div>
    );
  }

  // ─ Per-vendor stats for the two vendor tiles ─
  const massive = vendorStats(byVendor, "Polygon Massive");
  const uw      = vendorStats(byVendor, "Unusual Whales");

  // Tile body builders so the markup below stays readable.
  const tileFooter = (g) => {
    const allGreen = g.red === 0 && g.amber === 0 && g.feeds > 0;
    const tone = allGreen ? "green" : g.red > 0 ? "red" : g.amber > 0 ? "amber" : "muted";
    const summary = g.feeds === 0
      ? "no feeds tracked"
      : allGreen
        ? `all ${g.feeds} healthy`
        : `${g.red} red · ${g.green} green${g.amber > 0 ? ` · ${g.amber} amber` : ""}`;
    return (
      <>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <StatusDot tone={tone} />
          {summary}
        </span>
        <span>·</span>
        <span>last refresh {formatRelative(g.lastGoodAt)}</span>
      </>
    );
  };

  return (
    <main className="fade-in main-padded" style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: MUTED, fontFamily: "monospace", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
          Admin
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", color: "var(--text)", margin: 0 }}>
          Data sources &amp; pipeline health
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, marginBottom: 0, lineHeight: 1.55, maxWidth: 720 }}>
          Three destinations: the two paid vendors that account for most of the data on the site, and a cross-cutting view of every feed.
        </p>
      </header>

      {loading && (
        <div style={{ padding: "12px 14px", color: MUTED, fontSize: 12, marginBottom: 12 }}>Loading pipeline health…</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <Tile
          eyebrow="Vendor · paid"
          title="Polygon Massive"
          body="End-of-day prices, ticker reference, sectors, dividends, splits — ~12,600 US-listed names. The market data backbone for Trading Opportunities and Portfolio Insights."
          accent="var(--accent)"
          onClick={() => navigate("massive")}
          footer={
            <>
              <span>{massive.feeds || "—"} feeds</span>
              <span>·</span>
              <span>{VENDOR_MONTHLY_COST["Polygon Massive"]}/mo</span>
              <span>·</span>
              {tileFooter(massive)}
            </>
          }
        />

        <Tile
          eyebrow="Vendor · paid"
          title="Unusual Whales"
          body="Options flow, insider buys, congress trades, analyst ratings, screener universe. Powers the v5 scanner and the Trading Opportunities composites."
          accent="var(--accent)"
          onClick={() => navigate("uw")}
          footer={
            <>
              <span>{uw.feeds || "—"} feeds</span>
              <span>·</span>
              <span>{VENDOR_MONTHLY_COST["Unusual Whales"]}/mo</span>
              <span>·</span>
              {tileFooter(uw)}
            </>
          }
        />

        <Tile
          eyebrow="Cross-vendor view"
          title="Data Health"
          body="Every feed, every vendor, every scheduled pipeline. Per-feed freshness scored against the manifest deadline, plus the most recent scheduled runs across the whole site."
          accent="var(--text)"
          big
          onClick={() => navigate("health")}
          footer={
            <>
              <span>{totals.vendors || "—"} vendors</span>
              <span>·</span>
              <span>{totals.total || "—"} feeds</span>
              <span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <StatusDot tone={totals.red > 0 ? "red" : totals.amber > 0 ? "amber" : "green"} />
                {totals.red > 0 ? `${totals.red} red` : totals.amber > 0 ? `${totals.amber} amber` : "all healthy"}
              </span>
            </>
          }
        />
      </div>

      <footer style={{ marginTop: 16, fontSize: 11, color: MUTED, fontFamily: "monospace" }}>
        Pipeline health refreshes every 60 seconds · admin-only view · backed by Supabase pipeline_health.
      </footer>
    </main>
  );
}
