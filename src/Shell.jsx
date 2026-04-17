/**
 * Shell.jsx — Apple-style chrome for the Market Dashboard.
 *
 * Provides:
 *   • Theme provider (auto / light / dark with localStorage persistence)
 *   • Hero header with date, regime badge, and theme toggle
 *   • Tile-grid HOME view with clickable, drill-in tiles
 *   • Drill-down chrome (back button, breadcrumb) when inside a section
 *
 * Inner content is provided via the `views` map prop:
 *   views = { tabId: { title, eyebrow, render: () => <jsx /> } }
 */
import { useState, useEffect, useMemo } from "react";

// ── Theme hook ────────────────────────────────────────────────────────────────
const THEME_KEY = "md_theme_pref";  // "light" | "dark"

export function useTheme() {
  const [pref, setPref] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // Migrate any legacy "auto" pref by resolving to current system pref
    const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return sysDark ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", pref);
    localStorage.setItem(THEME_KEY, pref);
  }, [pref]);

  return { pref, setPref, isDark: pref === "dark" };
}

// ── Theme toggle component ────────────────────────────────────────────────────
function SunIcon()  { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="8" y1="1.5" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="14.5" y2="8"/><line x1="3.2" y1="3.2" x2="4.3" y2="4.3"/><line x1="11.7" y1="11.7" x2="12.8" y2="12.8"/><line x1="3.2" y1="12.8" x2="4.3" y2="11.7"/><line x1="11.7" y1="4.3" x2="12.8" y2="3.2"/></g></svg>; }
function MoonIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.8A5.5 5.5 0 1 1 6.2 2.5a4.5 4.5 0 0 0 7.3 7.3z" fill="currentColor"/></svg>; }

export function ThemeToggle({ pref, setPref }) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button onClick={() => setPref("light")} aria-pressed={pref === "light"} title="Light">
        <SunIcon />
      </button>
      <button onClick={() => setPref("dark")}  aria-pressed={pref === "dark"}  title="Dark">
        <MoonIcon />
      </button>
    </div>
  );
}

// ── Tile (clickable) ──────────────────────────────────────────────────────────
export function Tile({ eyebrow, title, sub, accent, onClick, children, span = 1, kpi, status }) {
  const styleAccent = accent ? { borderColor: `${accent}55` } : undefined;
  // Span is now a CSS class so the mobile media query can override it without
  // fighting inline-style specificity.
  const spanClass = span === 2 ? "tile-span-2" : span === 3 ? "tile-span-3" : "";

  return (
    <button className={`tile fade-in${spanClass ? ` ${spanClass}` : ""}`} onClick={onClick} style={styleAccent}>
      {/* accent bar at top */}
      {accent && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: accent, opacity: 0.85,
          borderTopLeftRadius: "var(--radius-lg)", borderTopRightRadius: "var(--radius-lg)",
        }}/>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <span className="tile-eyebrow">{eyebrow}</span>
        {status && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: status.color || "var(--text-muted)",
            background: status.color ? `${status.color}1a` : "var(--surface-3)",
            border: `1px solid ${status.color ? status.color + "33" : "var(--border-faint)"}`,
            padding: "3px 8px",
            borderRadius: 999,
            letterSpacing: "0.04em",
          }}>{status.label}</span>
        )}
      </div>
      <div className="tile-title">{title}</div>
      {kpi && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="num" style={{
            fontSize: 38, fontWeight: 700, letterSpacing: "-0.03em",
            color: kpi.color || "var(--text)", lineHeight: 1,
          }}>{kpi.value}</span>
          {kpi.unit && <span className="num" style={{ fontSize: 14, color: "var(--text-muted)" }}>{kpi.unit}</span>}
          {kpi.delta && (
            <span className="num" style={{
              fontSize: 13, fontWeight: 600,
              color: kpi.deltaColor || "var(--text-muted)",
              marginLeft: 4,
            }}>{kpi.delta}</span>
          )}
        </div>
      )}
      {sub && <div className="tile-sub">{sub}</div>}
      {children}
      <div className="tile-cta">Open</div>
    </button>
  );
}

// ── Hero header ───────────────────────────────────────────────────────────────
function MarketDot({ open }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: open ? "var(--green)" : "var(--text-dim)",
        boxShadow: open ? "0 0 8px var(--green)" : "none",
      }} className={open ? "pulse" : ""}/>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
        {open ? "MARKET OPEN" : "MARKET CLOSED"}
      </span>
    </span>
  );
}

function isMarketOpen(d = new Date()) {
  // ET market hours, naive: weekdays 9:30 - 16:00 ET. Approximate using local + offset.
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  // ET is UTC-5 (Nov-Mar) or UTC-4 (Mar-Nov DST). Approximate with -4 for now.
  const etMin = (utcMin - 4 * 60 + 60 * 24) % (60 * 24);
  return etMin >= 9 * 60 + 30 && etMin <= 16 * 60;
}

export function Hero({ regime, score, narrativeOneLine, pref, setPref, compact = false }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const open = isMarketOpen(today);

  return (
    <header className="hero-header" style={{
      padding: compact ? "var(--space-4) var(--space-8) var(--space-2)" : "var(--space-8) var(--space-8) var(--space-6)",
      maxWidth: 1440, margin: "0 auto",
      display: "flex", flexDirection: "column", gap: "var(--space-5)",
    }}>
      {/* Top row — date / market dot / theme toggle (always visible) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{dateStr}</span>
          <span style={{ width: 1, height: 14, background: "var(--border)" }}/>
          <MarketDot open={open}/>
        </div>
        <ThemeToggle pref={pref} setPref={setPref}/>
      </div>

      {/* Title + Regime KPI — only on home (full hero) */}
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Macro Dashboard · Trading Scanner</div>
            <h1 style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "clamp(34px, 4.2vw, 52px)",
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
              color: "var(--text)",
            }}>Today's market.<br/>
              <span style={{ color: "var(--text-muted)" }}>At a glance.</span>
            </h1>
          </div>

          {regime && (
            <div className="glass" style={{
              padding: "var(--space-4) var(--space-5)",
              display: "flex", alignItems: "center", gap: "var(--space-5)",
              borderColor: `${regime.color}55`,
              minWidth: 280,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                display: "grid", placeItems: "center",
                background: `radial-gradient(circle, ${regime.color}33 0%, ${regime.color}08 80%)`,
                border: `1px solid ${regime.color}66`,
              }}>
                <span className="num" style={{
                  fontSize: 22, fontWeight: 700, color: regime.color, letterSpacing: "-0.03em",
                }}>{score}</span>
              </div>
              <div>
                <div className="section-eyebrow" style={{ marginBottom: 4 }}>Regime</div>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                  color: regime.color, letterSpacing: "-0.02em", lineHeight: 1,
                }}>{regime.label}</div>
                {narrativeOneLine && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, maxWidth: 200 }}>
                    {narrativeOneLine}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

// ── Drill-down chrome (back button + section title) ───────────────────────────
export function SectionHeader({ eyebrow, title, sub, onBack, backLabel = "All sections" }) {
  return (
    <div className="section-header-inner" style={{
      maxWidth: 1440, margin: "0 auto",
      padding: "var(--space-6) var(--space-8) var(--space-4)",
      display: "flex", flexDirection: "column", gap: "var(--space-3)",
    }}>
      <button onClick={onBack} style={{
        alignSelf: "flex-start",
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 500, color: "var(--text-muted)",
        padding: "6px 12px", borderRadius: 999,
        background: "var(--surface-3)", border: "1px solid var(--border-faint)",
        transition: "all var(--dur-fast) var(--ease)",
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--hover)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <span style={{ fontSize: 14 }}>←</span> {backLabel}
      </button>
      <div>
        {eyebrow && <div className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h2 className="section-title">{title}</h2>
        {sub && <div style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 8, maxWidth: 720, lineHeight: 1.5 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
export function Footer({ leftText, rightText }) {
  return (
    <footer style={{
      maxWidth: 1440, margin: "0 auto",
      padding: "var(--space-8) var(--space-8) var(--space-6)",
      display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
      borderTop: "1px solid var(--border-faint)",
      marginTop: "var(--space-10)",
    }}>
      <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{leftText}</span>
      <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{rightText}</span>
    </footer>
  );
}
