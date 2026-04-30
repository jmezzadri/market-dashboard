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
import { Tip } from "./InfoTip";
import HeaderAuth from "./auth/HeaderAuth";
import { Monogram, Wordmark } from "./components/Logo";

// ── Theme hook ────────────────────────────────────────────────────────────────
const THEME_KEY = "md_theme_pref";  // "light" | "dark"

export function useTheme() {
  const [pref, setPref] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // First-time visitors land on light. Brand rule: "favor light" — light
    // is the default; dark is opt-in via the toggle. (Joe directive 2026-04-29.)
    return "light";
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
  // Use aria-label (screen-reader only) instead of <Tip> or title (browser-native
  // tooltip). Both caused a visible "Light"/"Dark" text bubble to flash on
  // click — Joe flagged 2026-04-27.
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button onClick={() => setPref("light")} aria-pressed={pref === "light"} aria-label="Light theme">
        <SunIcon />
      </button>
      <button onClick={() => setPref("dark")}  aria-pressed={pref === "dark"}  aria-label="Dark theme">
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

export function Hero({ regime, score, narrativeOneLine, pref, setPref, compact = false, menuButton = null }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const open = isMarketOpen(today);

  return (
    <header className="hero-header" style={{
      padding: compact ? "var(--space-4) var(--space-8) var(--space-2)" : "var(--space-8) var(--space-8) var(--space-6)",
      maxWidth: 1440, margin: "0 auto",
      display: "flex", flexDirection: "column", gap: "var(--space-5)",
    }}>
      {/* Top row — menu / brand logo / date / market dot / auth / theme toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {menuButton}
          <a href="#home" className="hero-brand" aria-label="MacroTilt home" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Monogram size={28} color="var(--accent, #d9b27a)" />
            <Wordmark size={13} />
          </a>
          <span className="hero-meta-divider" aria-hidden="true"/>
          <span className="hero-meta-date">{dateStr}</span>
          <span className="hero-meta-dot-sep" aria-hidden="true"/>
          <MarketDot open={open}/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HeaderAuth />
          <ThemeToggle pref={pref} setPref={setPref}/>
        </div>
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
export function SectionHeader({ eyebrow, title, sub, onBack, backLabel = "Home" }) {
  return (
    <div className="section-header-inner" style={{
      maxWidth: 1440, margin: "0 auto",
      padding: "var(--space-6) var(--space-8) var(--space-4)",
      display: "flex", flexDirection: "column", gap: "var(--space-3)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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
        <span className="section-brand-mark" aria-hidden="true" style={{ display: "inline-flex", marginLeft: 4 }}>
          <Monogram size={22} color="var(--accent, #d9b27a)" />
        </span>
      </div>
      <div>
        {eyebrow && <div className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h2 className="section-title">{title}</h2>
        {sub && <div style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 8, maxWidth: 720, lineHeight: 1.5 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Sidebar nav icons (16×16, stroke-based to match Apple-system feel) ───────
export function NavIconHome()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7.5 L8 2.5 L14 7.5 V13 A1 1 0 0 1 13 14 H3 A1 1 0 0 1 2 13 Z"/><path d="M6.5 14 V10 H9.5 V14"/></svg>; }
export function NavIconGauge()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 11 A5.5 5.5 0 0 1 13.5 11"/><path d="M8 11 L11 6.5" strokeWidth="1.6"/><circle cx="8" cy="11" r="1" fill="currentColor" stroke="none"/></svg>; }
export function NavIconGrid()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>; }
export function NavIconHeat()    { return <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.75"/><rect x="6.2" y="2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.4"/><rect x="10.4" y="2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.22"/><rect x="2" y="6.2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.4"/><rect x="6.2" y="6.2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.75"/><rect x="10.4" y="6.2" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.4"/><rect x="2" y="10.4" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.22"/><rect x="6.2" y="10.4" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.4"/><rect x="10.4" y="10.4" width="3.6" height="3.6" rx="0.6" fill="currentColor" opacity="0.75"/></svg>; }
export function NavIconPie()     { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2.5 A5.5 5.5 0 1 0 13.5 8 L8 8 Z" fill="currentColor" fillOpacity="0.18" stroke="none"/><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5 V8 H13.5" strokeLinecap="round"/></svg>; }
export function NavIconList()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="5" y1="4" x2="14" y2="4"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="5" y1="12" x2="14" y2="12"/><circle cx="2.7" cy="4" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.7" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.7" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>; }
export function NavIconRadar()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.8"/><line x1="8" y1="8" x2="12.2" y2="3.8" strokeLinecap="round"/></svg>; }
export function NavIconBook()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M3 3 H7 A1.5 1.5 0 0 1 8 4.5 V13.5 A1.2 1.2 0 0 0 6.8 12.3 H3 Z"/><path d="M13 3 H9 A1.5 1.5 0 0 0 8 4.5 V13.5 A1.2 1.2 0 0 1 9.2 12.3 H13 Z"/></svg>; }

// ── Sidebar ───────────────────────────────────────────────────────────────────
//   items   = [{ id, label, icon, eyebrow? }]   — single source of truth for nav
//   activeId= currently-selected tab id
//   onSelect= (id) => void — called when user clicks an item
//   open    = mobile drawer open state (desktop: sidebar is always visible)
//   onClose = () => void — called to close drawer (backdrop click or nav select)
//   footer  = optional JSX rendered in the bottom slot (reserved for account/sign-out)
export function Sidebar({ items, activeId, onSelect, open = false, onClose, footer }) {
  const handleSelect = (id) => {
    onSelect(id);
    if (open && onClose) onClose();  // auto-close drawer on mobile after navigate
  };
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose}/>}
      <aside className={`sidebar${open ? " sidebar--open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Monogram size={30} color="var(--accent, #d9b27a)" />
          <Wordmark size={14} />
        </div>
        <nav className="sidebar-nav">
          {items.map((item, idx) => {
            // Section divider — { divider: true, label?: "Admin" }. Renders a
            // hairline rule with optional JetBrains-Mono uppercase microcopy
            // so client-facing tabs and admin tabs sit visually separate.
            if (item.divider) {
              return (
                <div key={`divider-${idx}`} className="sidebar-divider" role="separator" aria-orientation="horizontal">
                  {item.label && <span className="sidebar-divider-label">{item.label}</span>}
                </div>
              );
            }
            const active = activeId === item.id;
            return (
              <button
                key={item.id}
                className={`sidebar-link${active ? " sidebar-link--active" : ""}`}
                onClick={() => handleSelect(item.id)}
                aria-current={active ? "page" : undefined}
                title={item.label}
              >
                <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">{footer}</div>
      </aside>
    </>
  );
}

// Hamburger toggle — only visible on narrow screens (CSS handles display)
export function SidebarToggleButton({ onClick }) {
  return (
    <button className="sidebar-toggle" onClick={onClick} aria-label="Open navigation menu" type="button">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="3" y1="5" x2="15" y2="5"/>
        <line x1="3" y1="9" x2="15" y2="9"/>
        <line x1="3" y1="13" x2="15" y2="13"/>
      </svg>
    </button>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
export function Footer({ leftText, rightText }) {
  const year = new Date().getFullYear();
  return (
    <footer style={{
      maxWidth: 1440, margin: "var(--space-10) auto 0",
      padding: "var(--space-8) var(--space-8) var(--space-6)",
      borderTop: "1px solid var(--border-faint)",
      display: "flex", flexDirection: "column", gap: "var(--space-6)",
    }}>
      {/* 4-column editorial grid */}
      <div className="mt-foot-grid" style={{
        display: "grid",
        gridTemplateColumns: "1.3fr 1fr 1fr 1.2fr",
        gap: "var(--space-7)",
        alignItems: "start",
      }}>
        {/* Col 1 · Brand */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Monogram size={32} color="var(--accent, #d9b27a)" />
            <Wordmark size={13} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 260 }}>
            Macro regime dashboard + trading scanner.
            <br/>Built in NY, NY · 2026.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            © {year} MACROTILT
          </div>
        </div>

        {/* Col 2 · Reach Us */}
        <div>
          <div style={{
            fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em", textTransform: "uppercase",
            paddingBottom: 12, marginBottom: 14,
            borderBottom: "1px solid var(--border-faint)",
          }}>Reach Us</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <a href="mailto:admin@macrotilt.com" style={{ color: "var(--text)", fontSize: 13, textDecoration: "none", fontWeight: 500 }}>
              Contact <span style={{ color: "var(--accent)", marginLeft: 4 }}>→</span>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 400, marginTop: 3 }}>admin@macrotilt.com</div>
            </a>
            <div>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>About us</div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic", lineHeight: 1.45 }}>
                Founded in a home office. Team size: one human, one LLM, a lot of ZeroHedge headlines.
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Careers</div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic", lineHeight: 1.45 }}>
                Zero open roles. The intern is an LLM. No PTO policy because nobody takes PTO.
              </div>
            </div>
          </div>
        </div>

        {/* Col 3 · Product */}
        <div>
          <div style={{
            fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em", textTransform: "uppercase",
            paddingBottom: 12, marginBottom: 14,
            borderBottom: "1px solid var(--border-faint)",
          }}>Product</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Request a Feature</div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic", lineHeight: 1.45 }}>
                Press the Report Bug button and yell. All yells route to one inbox, which is also the only inbox.
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Customer Care</div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic", lineHeight: 1.45 }}>
                Best-in-class — the customer and the care team are the same human.
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>Advertise with us</div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic", lineHeight: 1.45 }}>
                Ad inventory: this link. Rates: your self-respect. Pass.
              </div>
            </div>
          </div>
        </div>

        {/* Col 4 · Sources */}
        <div>
          <div style={{
            fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em", textTransform: "uppercase",
            paddingBottom: 12, marginBottom: 14,
            borderBottom: "1px solid var(--border-faint)",
          }}>Sources</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
            <div>
              <span style={{ color: "var(--text-2)", fontWeight: 500 }}>Market data · </span>
              Unusual Whales, FRED
            </div>
            <div>
              <span style={{ color: "var(--text-2)", fontWeight: 500 }}>News · </span>
              ZeroHedge, CNBC, Bloomberg, Reuters, Financial Times, Wall Street Journal
            </div>
            <div>
              <span style={{ color: "var(--text-2)", fontWeight: 500 }}>Portfolio · </span>
              Plaid (account sync), Supabase (storage)
            </div>
            <a href="#readme" style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none", marginTop: 6, fontWeight: 500 }}>
              Full methodology <span style={{ marginLeft: 2 }}>→</span>
            </a>
          </div>
        </div>
      </div>

      {/* Bottom strip — status + disclaimer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: "var(--space-4)",
        borderTop: "1px solid var(--border-faint)",
        flexWrap: "wrap", gap: 8,
      }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
          {leftText}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", fontStyle: "italic", paddingRight: 160 }}>
          Not investment advice. Not a broker. Not a person in most ways.
        </span>
      </div>
    </footer>
  );
}
