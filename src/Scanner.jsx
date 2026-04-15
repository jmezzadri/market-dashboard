/**
 * Trading Scanner Dashboard Tab
 * Fetches latest_scan_data.json from the trading-scanner GitHub repo
 * and renders Buy/Watch/Portfolio cards + detailed signal tabs.
 */
import { useState, useEffect } from "react";

const DATA_URL =
  "https://raw.githubusercontent.com/jmezzadri/trading-scanner/main/reports/latest_scan_data.json";

const TABS = [
  { id: "overview",    label: "📈 Overview" },
  { id: "congress",    label: "🏛️ Congress" },
  { id: "insiders",    label: "👤 Insiders" },
  { id: "flow",        label: "🌊 Options Flow" },
  { id: "technicals",  label: "📊 Technicals" },
  { id: "methodology", label: "📋 Methodology" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  if (n == null) return "—";
  const v = Number(n);
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return s; }
}
function fmtMoney(n) {
  if (n == null) return "—";
  const v = Math.abs(Number(n));
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toLocaleString();
}

function Badge({ label, color }) {
  const colors = {
    green:  { bg: "#d1fae5", text: "#065f46" },
    yellow: { bg: "#fef9c3", text: "#713f12" },
    red:    { bg: "#fee2e2", text: "#991b1b" },
    blue:   { bg: "#dbeafe", text: "#1e40af" },
    gray:   { bg: "#f3f4f6", text: "#374151" },
  };
  const c = colors[color] || colors.gray;
  return (
    <span style={{
      background: c.bg, color: c.text,
      fontSize: 11, fontWeight: 600, padding: "2px 8px",
      borderRadius: 10, display: "inline-block",
    }}>{label}</span>
  );
}

function ScoreBadge({ score }) {
  const color = score >= 60 ? "green" : score >= 35 ? "blue" : "gray";
  return <Badge label={`Score ${score}`} color={color} />;
}

function TierBadge({ tier }) {
  if (tier === "buy")   return <Badge label="BUY" color="green" />;
  if (tier === "watch") return <Badge label="WATCH" color="blue" />;
  return <Badge label={tier?.toUpperCase() || "—"} color="gray" />;
}

// ── Ticker card (Overview) ────────────────────────────────────────────────────
function TickerCard({ item, tier, signals }) {
  const t = item.ticker;
  const screener = (signals?.screener || {})[t] || {};
  const price = item.current_price ?? screener.prev_close;
  const cc = item.covered_call;

  const congressBuys = (signals?.congress_buys || []).filter(r => r.ticker === t);
  const insiderBuys  = (signals?.insider_buys  || []).filter(r => r.ticker === t);
  const flows        = (signals?.flow_alerts   || []).filter(r => r.ticker === t);

  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: "14px 16px", marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 18, marginRight: 8 }}>{t}</span>
          <span style={{ color: "#6b7280", fontSize: 13 }}>{screener.company_name || ""}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt$(price)}</div>
          <ScoreBadge score={item.score} />
          {" "}<TierBadge tier={tier} />
        </div>
      </div>

      {/* CC recommendation */}
      {cc ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, color: "#065f46", fontSize: 13 }}>
            📝 Covered Call: Sell {fmtDate(cc.expiry)} {fmt$(cc.strike)} Call
          </div>
          <div style={{ color: "#374151", fontSize: 12, marginTop: 2 }}>
            Bid {fmt$(cc.bid)} · Mid {fmt$(cc.mid)} · {cc.annualized_yield}% yield · {cc.days_to_expiry} DTE · {cc.otm_pct}% OTM
          </div>
        </div>
      ) : item.cc_note ? (
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>CC: {item.cc_note}</div>
      ) : null}

      {/* Signal summary row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#374151" }}>
        {congressBuys.length > 0 && (
          <span>🏛️ <strong>{congressBuys.length}</strong> Congress buy{congressBuys.length > 1 ? "s" : ""}</span>
        )}
        {insiderBuys.length > 0 && (
          <span>👤 <strong>{insiderBuys.length}</strong> insider buy{insiderBuys.length > 1 ? "s" : ""}</span>
        )}
        {flows.length > 0 && (
          <span>🌊 <strong>{flows.length}</strong> flow alert{flows.length > 1 ? "s" : ""}</span>
        )}
        {screener.iv_rank != null && (
          <span>IVR <strong>{Number(screener.iv_rank).toFixed(0)}</strong></span>
        )}
        {screener.relative_volume != null && (
          <span>RVol <strong>{Number(screener.relative_volume).toFixed(1)}×</strong></span>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ data }) {
  const { buy_opportunities = [], watch_items = [], portfolio_positions = [], signals } = data;

  return (
    <div>
      {buy_opportunities.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#065f46", marginBottom: 10 }}>
            ✅ Recommendations (Triggered)
          </h3>
          {buy_opportunities.map(item => (
            <TickerCard key={item.ticker} item={item} tier="buy" signals={signals} />
          ))}
        </div>
      )}

      {watch_items.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e40af", marginBottom: 10 }}>
            👀 Watchlist (Near Trigger)
          </h3>
          {watch_items.map(item => (
            <TickerCard key={item.ticker} item={item} tier="watch" signals={signals} />
          ))}
        </div>
      )}

      {portfolio_positions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
            💼 Current Portfolio
          </h3>
          {portfolio_positions.map(pos => {
            const t = pos.ticker;
            const screener = (signals?.screener || {})[t] || {};
            const score = (data.score_by_ticker || {})[t];
            return (
              <div key={t} style={{
                background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
                padding: "12px 16px", marginBottom: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontWeight: 700, marginRight: 8 }}>{t}</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>{pos.shares} shares @ {fmt$(pos.avg_cost)}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  {fmt$(screener.prev_close)}
                  {score != null && <><br /><ScoreBadge score={score} /></>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {buy_opportunities.length === 0 && watch_items.length === 0 && (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
          No buy or watch signals in the latest scan.
        </div>
      )}
    </div>
  );
}

// ── Congress tab ──────────────────────────────────────────────────────────────
function CongressTab({ data }) {
  const buys  = data.signals?.congress_buys  || [];
  const sells = data.signals?.congress_sells || [];
  const all   = [
    ...buys.map(r  => ({ ...r, _dir: "Buy"  })),
    ...sells.map(r => ({ ...r, _dir: "Sell" })),
  ].sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));

  if (!all.length) return (
    <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
      No congressional trades in the lookback window (last 45 days).
    </div>
  );

  return (
    <div>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>
        Congressional trades disclosed under the STOCK Act (45-day lookback). Buys may signal conviction; sells may signal concern.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              {["Date","Member","Party","Ticker","Direction","Amount","Type"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "7px 10px" }}>{fmtDate(r.transaction_date || r.disclosure_date)}</td>
                <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.representative || r.senator || "—"}</td>
                <td style={{ padding: "7px 10px" }}>{r.party || "—"}</td>
                <td style={{ padding: "7px 10px", fontWeight: 700 }}>{r.ticker}</td>
                <td style={{ padding: "7px 10px" }}>
                  <Badge label={r._dir} color={r._dir === "Buy" ? "green" : "red"} />
                </td>
                <td style={{ padding: "7px 10px" }}>{r.amount || "—"}</td>
                <td style={{ padding: "7px 10px", color: "#6b7280" }}>{r.asset_type || "Stock"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Insiders tab ──────────────────────────────────────────────────────────────
function InsidersTab({ data }) {
  const buys  = data.signals?.insider_buys  || [];
  const sales = data.signals?.insider_sales || [];
  const all   = [
    ...buys.map(r  => ({ ...r, _dir: "Purchase" })),
    ...sales.map(r => ({ ...r, _dir: "Sale"     })),
  ].sort((a, b) => new Date(b.filing_date || b.transaction_date || 0) - new Date(a.filing_date || a.transaction_date || 0));

  if (!all.length) return (
    <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
      No insider transactions in the lookback window.
    </div>
  );

  return (
    <div>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>
        SEC Form 4 filings — open-market purchases (code P) and sales (code S).
        Excludes Rule 10b5-1 automatic plan transactions. Purchases by officers and directors carry stronger signal.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              {["Filing Date","Insider","Title","Ticker","Direction","Shares","Value","Price"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((r, i) => {
              const shares = r.shares ? Number(r.shares) : null;
              const price  = r.price  ? Number(r.price)  : null;
              const value  = r.amount ? Number(r.amount) : (shares && price ? shares * price : null);
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ padding: "7px 10px" }}>{fmtDate(r.filing_date || r.transaction_date)}</td>
                  <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.insider_name || r.name || "—"}</td>
                  <td style={{ padding: "7px 10px", color: "#6b7280", fontSize: 12 }}>{r.insider_title || r.title || "—"}</td>
                  <td style={{ padding: "7px 10px", fontWeight: 700 }}>{r.ticker}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <Badge label={r._dir} color={r._dir === "Purchase" ? "green" : "red"} />
                  </td>
                  <td style={{ padding: "7px 10px" }}>{shares ? shares.toLocaleString() : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>{fmtMoney(value)}</td>
                  <td style={{ padding: "7px 10px" }}>{fmt$(price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Options Flow tab ──────────────────────────────────────────────────────────
function FlowTab({ data }) {
  const flows = data.signals?.flow_alerts || [];

  if (!flows.length) return (
    <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
      No unusual options flow in the current lookback window.
    </div>
  );

  return (
    <div>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>
        Unusual Whales flow alerts — large or unusual options orders flagged by the platform.
        Minimum premium ${(50000).toLocaleString()}. Calls only shown (put flow excluded from scanner).
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              {["Time","Ticker","Type","Strike","Expiry","Premium","Vol/OI","Underlying"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flows.map((r, i) => {
              const prem = r.total_premium ? Number(r.total_premium) : null;
              const oi   = r.open_interest ? Number(r.open_interest) : null;
              const vol  = r.volume        ? Number(r.volume)        : null;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ padding: "7px 10px", color: "#6b7280", fontSize: 12 }}>
                    {r.executed_at ? new Date(r.executed_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td style={{ padding: "7px 10px", fontWeight: 700 }}>{r.ticker}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <Badge label={(r.type || "call").toUpperCase()} color="green" />
                  </td>
                  <td style={{ padding: "7px 10px" }}>{fmt$(r.strike)}</td>
                  <td style={{ padding: "7px 10px" }}>{fmtDate(r.expiry || r.expires)}</td>
                  <td style={{ padding: "7px 10px", fontWeight: 600 }}>{fmtMoney(prem)}</td>
                  <td style={{ padding: "7px 10px" }}>{vol ? vol.toLocaleString() : "—"} / {oi ? oi.toLocaleString() : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>{fmt$(r.underlying_price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Technicals tab ────────────────────────────────────────────────────────────
function TechnicalsTab({ data }) {
  const { buy_opportunities = [], watch_items = [], portfolio_positions = [], signals } = data;
  const allTickers = [
    ...buy_opportunities.map(o => o.ticker),
    ...watch_items.map(w => w.ticker),
    ...portfolio_positions.map(p => p.ticker),
  ].filter((t, i, a) => a.indexOf(t) === i);

  const screener = signals?.screener || {};

  if (!allTickers.length) return (
    <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>No tickers to display.</div>
  );

  return (
    <div>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>
        Screener data from Unusual Whales — price momentum, volume, IV rank, and moving averages for all scanned tickers.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              {["Ticker","Price","1W","1M","YTD","IVR","Rel Vol","Mkt Cap"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTickers.map((t, i) => {
              const sc = screener[t] || {};
              const p1w  = sc.week_change   != null ? Number(sc.week_change)   : null;
              const p1m  = sc.month_change  != null ? Number(sc.month_change)  : null;
              const pytd = sc.ytd_change    != null ? Number(sc.ytd_change)    : null;
              const ivr  = sc.iv_rank       != null ? Number(sc.iv_rank)       : null;
              const rvol = sc.relative_volume != null ? Number(sc.relative_volume) : null;
              const mcap = sc.marketcap     != null ? Number(sc.marketcap)     : null;
              return (
                <tr key={t} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ padding: "7px 10px", fontWeight: 700 }}>{t}</td>
                  <td style={{ padding: "7px 10px" }}>{fmt$(sc.prev_close)}</td>
                  <td style={{ padding: "7px 10px", color: p1w  == null ? "#9ca3af" : p1w  >= 0 ? "#059669" : "#dc2626" }}>{p1w  != null ? fmtPct(p1w  * 100) : "—"}</td>
                  <td style={{ padding: "7px 10px", color: p1m  == null ? "#9ca3af" : p1m  >= 0 ? "#059669" : "#dc2626" }}>{p1m  != null ? fmtPct(p1m  * 100) : "—"}</td>
                  <td style={{ padding: "7px 10px", color: pytd == null ? "#9ca3af" : pytd >= 0 ? "#059669" : "#dc2626" }}>{pytd != null ? fmtPct(pytd * 100) : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>{ivr  != null ? ivr.toFixed(0)  : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>{rvol != null ? rvol.toFixed(1) + "×" : "—"}</td>
                  <td style={{ padding: "7px 10px" }}>{fmtMoney(mcap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Methodology tab ────────────────────────────────────────────────────────────
function MethodologyTab({ data }) {
  const cfg = data.config || {};
  const sections = [
    {
      title: "📡 Data Sources",
      content: [
        ["Unusual Whales API", "Options flow alerts, dark pool prints, stock screener (price, IV rank, relative volume), and option contract chains."],
        ["Congress.gov / SEC EDGAR", "Congressional trade disclosures (STOCK Act) and insider Form 4 filings. Congressional lookback: 45 days (disclosures can lag trades by up to 45 days). Insider lookback: 14 days."],
        ["Yahoo Finance (yfinance)", "Price history, RSI, moving averages, and company names as a supplementary data source."],
      ],
    },
    {
      title: "🎯 Scoring System (0–100)",
      content: [
        ["Options Flow", "Large or unusual call flow from Unusual Whales flow alerts. Minimum premium $50K. Weighted by total premium and number of alerts."],
        ["Congressional Buys", "Open-market purchases disclosed by members of Congress. Scored by disclosed dollar amount and number of buyers. Cap of 40 points."],
        ["Insider Buys", "Open-market purchases (Form 4 code P) by corporate officers and directors. Excludes Rule 10b5-1 automatic plan transactions. Scored by total notional value and number of unique buyers."],
        ["Dark Pool", "Large off-exchange prints ($500K+ minimum). Treated as an additional confirmation signal."],
        ["Technicals", "RSI, moving average positioning, and relative volume as tiebreakers."],
        [`Buy Tier (≥ ${cfg.score_buy_alert || 60})`, "Triggers a recommendation and covered call screening."],
        [`Watch Tier (${cfg.score_watch_alert || 35}–${(cfg.score_buy_alert || 60) - 1})`, "Near-trigger — worth monitoring for a developing setup."],
      ],
    },
    {
      title: "📝 Covered Call Criteria",
      content: [
        ["Minimum IV Rank", `≥ ${cfg.cc_min_iv_rank || 30} — ensures we're selling premium when implied volatility is elevated relative to its own history.`],
        ["Minimum Annualized Yield", `≥ ${cfg.cc_min_annualized_yield_pct || 25}% — the bid premium divided by stock price, annualized over DTE.`],
        ["OTM Rule (1-sigma)", `Strike must be at least IV × √(DTE/365) out of the money — the 1 standard-deviation expected move. Higher-vol names (MU, CCJ) require further OTM strikes than low-vol names (MSFT). This scales automatically with both volatility and time.`],
        ["DTE Window", `${cfg.cc_min_dte || 14}–${cfg.cc_max_dte || 42} days to expiration.`],
        ["Bid-Ask Spread", "≤ 10% of mid-price. Moderately wide spreads (5–10%) flag a liquidity note suggesting a limit order."],
        ["Earnings Avoidance", "No calls selling through an earnings window (±7 days from the next earnings date)."],
        ["Best Bid Selection", "Among all passing contracts, the one with the highest bid (most income) is selected."],
      ],
    },
    {
      title: "💼 Portfolio Triggers (PT / SL)",
      content: [
        ["Profit Target (PT)", `Current price × ${1 + (cfg.profit_target_pct || 20) / 100} — ${cfg.profit_target_pct || 20}% above the average cost basis. Informational only; not an automatic sell signal.`],
        ["Stop Loss (SL)", `Current price × ${1 - (cfg.stop_loss_pct || 15) / 100} — ${cfg.stop_loss_pct || 15}% below the average cost basis. Triggers an alert in the scan email.`],
        ["Score Collapse", "An alert fires if a position's signal score drops significantly from the prior scan — suggesting the original thesis may be reversing."],
        ["Insider / Congress Reversal", "An alert fires if the same insider or politician who bought is now selling (within the lookback window)."],
      ],
    },
    {
      title: "⏰ Scan Schedule",
      content: [
        ["Daily scan", "Runs at 3:45 PM EDT, Monday–Friday via GitHub Actions."],
        ["Email delivery", "Sent automatically when buy or watch signals are present."],
        ["Data freshness", "Options flow and dark pool reflect intraday data at scan time. Congressional and insider data can lag by up to 45 days due to disclosure requirements."],
      ],
    },
    {
      title: "⚠️ Disclaimer",
      content: [
        ["Not financial advice", "This dashboard is a personal research tool for informational purposes only. Nothing here constitutes investment advice. Always do your own due diligence before making any investment decision."],
        ["Signal lag", "Congressional disclosures can be filed up to 45 days after the actual trade. Insider disclosures are typically filed within 2 business days but may be delayed."],
        ["Data accuracy", "Data is sourced from third-party APIs and may contain errors, delays, or omissions. Verify all data independently before acting."],
      ],
    },
  ];

  return (
    <div>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: "#111827" }}>{sec.title}</h3>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            {sec.content.map(([label, desc], i) => (
              <div key={label} style={{
                display: "flex", gap: 12, padding: "10px 14px",
                borderBottom: i < sec.content.length - 1 ? "1px solid #f3f4f6" : "none",
                background: i % 2 === 0 ? "#fff" : "#fafafa",
              }}>
                <div style={{ minWidth: 200, fontWeight: 600, fontSize: 13, color: "#374151" }}>{label}</div>
                <div style={{ fontSize: 13, color: "#6b7280", flex: 1 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Scanner component ─────────────────────────────────────────────────────
export default function Scanner() {
  const [activeTab, setActiveTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(DATA_URL + "?t=" + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
      Loading latest scan data…
    </div>
  );

  if (error) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>Could not load scan data</div>
      <div style={{ color: "#6b7280", fontSize: 13 }}>{error}</div>
      <div style={{ color: "#6b7280", fontSize: 13, marginTop: 8 }}>
        The scanner runs at 3:45 PM ET weekdays. Data may not be available yet.
      </div>
    </div>
  );

  const scanTime = data?.scan_time ? new Date(data.scan_time) : null;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Trading Signal Scanner</h2>
          {scanTime && (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              Last scan: {scanTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}{" "}
              {scanTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
            </span>
          )}
        </div>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "6px 0 0" }}>
          Scans options flow, congressional trades, and insider activity daily at 3:45 PM ET.
          Scores each ticker 0–100 and surfaces the highest-conviction setups.
        </p>
      </div>

      {/* Summary pills */}
      {data && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <Badge label={`${data.buy_opportunities?.length || 0} Buy`} color="green" />
          <Badge label={`${data.watch_items?.length || 0} Watch`} color="blue" />
          <Badge label={`${data.signals?.congress_buys?.length || 0} Congress buys`} color="gray" />
          <Badge label={`${data.signals?.insider_buys?.length || 0} Insider buys`} color="gray" />
          <Badge label={`${data.signals?.flow_alerts?.length || 0} Flow alerts`} color="gray" />
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e5e7eb", marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
              background: "none", border: "none", cursor: "pointer",
              borderBottom: activeTab === tab.id ? "2px solid #1d4ed8" : "2px solid transparent",
              color: activeTab === tab.id ? "#1d4ed8" : "#6b7280",
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {data && (
        <>
          {activeTab === "overview"    && <OverviewTab    data={data} />}
          {activeTab === "congress"    && <CongressTab    data={data} />}
          {activeTab === "insiders"    && <InsidersTab    data={data} />}
          {activeTab === "flow"        && <FlowTab        data={data} />}
          {activeTab === "technicals"  && <TechnicalsTab  data={data} />}
          {activeTab === "methodology" && <MethodologyTab data={data} />}
        </>
      )}
    </div>
  );
}
