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

import React, { useMemo } from "react";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { useDataHealth, VENDOR_MONTHLY_COST } from "./hooks/useDataHealth";

// Preview deploys (everything outside macrotilt.com) skip the admin gate
// so the pages are reviewable without a sign-in. Production rendering on
// macrotilt.com is gated as before — useIsAdmin() still runs and its
// result is honoured. Live data on preview comes from the baked
// /admin_health_snapshot.json fallback inside useDataHealth.
const IS_PRODUCTION_HOST = typeof window !== "undefined"
  && /(^|\.)macrotilt\.com$/.test(window.location.hostname);

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

// Returns a plain-data shape with `feeds` as a COUNT (not the raw array
// that byVendor.get(v).feeds carries). The footer markup below renders
// `{feeds}` directly into a span, so an array there crashes React with
// the "Objects are not valid as a React child" invariant.
function vendorStats(byVendor, vendorName) {
  const g = byVendor.get(vendorName);
  if (!g) return { feeds: 0, green: 0, red: 0, amber: 0, lastGoodAt: null };
  return {
    feeds:     Array.isArray(g.feeds) ? g.feeds.length : (g.feeds || 0),
    green:     g.green || 0,
    red:       g.red || 0,
    amber:     g.amber || 0,
    lastGoodAt: g.lastGoodAt || null,
  };
}

export default function AdminLanding() {
  // useIsAdmin always runs (hooks-rules). On non-production hosts the
  // gate below is short-circuited so the page renders for everyone.
  const live = useIsAdmin();
  const isAdmin     = IS_PRODUCTION_HOST ? live.isAdmin : true;
  const adminLoading = IS_PRODUCTION_HOST ? live.loading : false;
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

      {/* Daily rebalance schedule — Joe directive 2026-05-27.
          Surfaces the four jobs that run in sequence Tue-Sat morning so the
          Paper Portfolio queue lands BEFORE the 9:30 AM open. Plain English,
          no internal workflow names — those live in the GitHub repo. */}
      <section style={{
        marginBottom: 18,
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 18px",
        background: "var(--surface)",
      }}>
        <div style={{
          fontSize: 11, color: MUTED, fontFamily: "monospace",
          letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6,
        }}>
          Daily rebalance schedule
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.55 }}>
          The full price batch from Polygon (which Massive ingests) doesn't
          land same-day — it arrives between 2&thinsp;AM and 8&thinsp;AM ET the
          next morning. So the rebalance pipeline runs in the morning, after
          everything is fresh and before the 9:30&thinsp;AM open.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 6, columnGap: 14, fontSize: 13 }}>
          {[
            ["8:00 AM ET", "Massive pulls Polygon's full overnight batch."],
            ["8:15 AM ET", "Asset Tilt recalculates the allocation."],
            ["8:30 AM ET", "Trading Ops scans the universe on last night's close."],
            ["9:00 AM ET", "Paper Portfolio queues trades into Alpaca for the 9:30 open."],
          ].map(([time, what]) => (
            <React.Fragment key={time}>
              <div className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{time}</div>
              <div style={{ color: "var(--text-2)" }}>{what}</div>
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: MUTED }}>
          Runs Tue–Sat (the morning after each weekday close). Each job is
          safe to re-run; backups fire if any one job misses.
        </div>
      </section>

      {/* Free public data sources — Joe directive 2026-05-27.
          The two paid vendor tiles above don't show the full picture; most
          of the macro indicator family runs on free public feeds. Treasury.gov
          was added 2026-05-27 to replace FRED for the daily yield indicators
          (10Y-2Y slope, 10Y TIPS, 10Y breakeven) because Treasury.gov is the
          upstream publisher and posts same-day — FRED posts T+1. */}
      <section style={{
        marginBottom: 18,
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 18px",
        background: "var(--surface)",
      }}>
        <div style={{
          fontSize: 11, color: MUTED, fontFamily: "monospace",
          letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6,
        }}>
          Free public data sources
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.55 }}>
          In addition to the two paid vendors above, the site reads from{" "}
          <b style={{ color: "var(--text)" }}>nine free public feeds</b>. They
          carry the macro indicator family — rates, spreads, credit, claims,
          M2, the dollar index, VIX/MOVE/SKEW, and so on.
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          rowGap: 6, columnGap: 18, fontSize: 13,
        }}>
          {[
            ["U.S. Treasury", "Daily Treasury yields and TIPS yields (10Y-2Y slope, 10Y TIPS real rate, 10Y inflation breakeven). Same-day publication."],
            ["FRED (St. Louis Fed)", "Most macro series — jobless claims, M2, balance sheet, term premium, RRP, SLOOS, etc. T+1 publication."],
            ["Yahoo Finance", "VIX, MOVE, SKEW, dollar index, copper/gold ratio. Same-day."],
            ["ICE BofA (via FRED)", "HY and IG credit spreads. T+1."],
            ["CBOE / Yahoo mirror", "Equity volatility indices."],
            ["ISM", "Manufacturing and Services PMI. Monthly."],
            ["FDIC Call Reports", "Bank balance-sheet unrealized losses. Quarterly."],
            ["Shiller (Yale)", "CAPE ratio. Monthly."],
            ["GitHub roster", "Members of Congress, used by the congress-trades drill."],
          ].map(([name, body]) => (
            <div key={name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{name}</span>
              <span style={{ color: "var(--text-2)", lineHeight: 1.5 }}>{body}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: MUTED }}>
          For the per-feed freshness state across all paid + free sources, open the Data Health tile below.
        </div>
      </section>

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
