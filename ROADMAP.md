# Trading Scanner — Roadmap

Tracked list of future enhancements so ideas don't get lost between builds.
Ordered roughly by priority / sequencing, not by ease. Items at the top are
the next natural follow-ups to what landed in the April 2026 universe-trim +
composite-score build.

---

## Technicals composite — next-level indicators

The current composite mirrors StockCharts SCTR (long-term trend 60% /
mid 30% / short 10%) with ADX regime filter, IBD-style SPY-relative
strength, and volume confirmation. Professional equivalents (SCTR,
TradingView Technical Rating, Barchart Opinion, IBD Composite) layer in
more dimensions we haven't adopted yet. Candidates, in priority order:

1. **Industry Group / Sector RS (IBD style).**
   IBD publishes an Industry Group RS rank alongside the individual RS
   rank — it answers "is this stock leading its group, and is the group
   itself leading the market?" Two-axis strength beats single-axis. Needs
   a GICS (or UW sector) → constituents mapping to compute group RS on
   the fly.

2. **Extended oscillator stack.**
   TradingView's 11-oscillator composite includes Stochastic %K/%D, CCI,
   Awesome Oscillator, Momentum, Williams %R, and Ultimate Oscillator in
   addition to RSI + MACD. Individually noisy; collectively much smoother
   — a weak "neutral" vote from 11 oscillators is more information than a
   binary RSI zone flag. Drop-in with pandas-ta; worth a back-test to see
   if it actually moves the composite.

3. **Ichimoku Cloud.**
   Kumo position is a cleaner long-horizon trend filter than a pair of
   SMAs (cloud incorporates 26-period high/low midpoints — price versus
   support/resistance bands, not just means). Makes the long-term
   component of the composite less noise-prone for mid-cap names with
   thin histories.

4. **On-Balance Volume / Accumulation-Distribution trend.**
   Volume-weighted price trend — catches "price flat but smart money
   accumulating" setups that RSI and MACD miss entirely. Currently we
   only have a binary RVOL spike flag.

5. **Beta / correlation adjustment for SPY-relative returns.**
   Right now we subtract SPY returns straight. For a 1.5-beta tech name
   this understates relative strength in up markets and overstates it in
   down markets. A simple 60-day rolling beta to de-market the relative
   return would be more faithful to IBD's RS definition.

6. **Per-industry ADX regime filter.**
   ADX works best as a *relative* measure against the regime of the
   broader group (e.g. semis vs. SPY vs. the semi ETF). Today we use a
   single ticker ADX. A second-axis ADX on the sector ETF would flag
   "strong trend in name, but weak trend in group" cases.

## Universe expansion

- **User-specified personal tickers contributing composite scores.** Right
  now the Technicals tab overlays the user's portfolio + watchlist
  tickers, but composite scores only exist for tickers that made the
  public scan universe. Either compute a lightweight per-user composite
  on the client (yfinance via a serverless function) or extend the
  scanner to emit a per-user tech-only file scoped by Supabase user_id.
  Decision needed: where does the compute live?

- **Insider-buy 90d reversal surface.** The scanner already pulls a
  90-day insider-buy window (`INSIDER_REVERSAL_LOOKBACK`) but doesn't
  surface it — the intent was to flag oversold names where an insider
  stepped in during the last 90 days. Add a dedicated surface on the
  Insiders tab.

- **Short interest / borrow-fee signal.** UW has short-interest data —
  high short interest on a technically-breaking-out name is a classic
  squeeze signal. Would plug into the existing composite as a regime
  modifier (x1.2 on strong-bull + high-SI combo).

## Data quality / hygiene

- **Sector / GICS normalization.** Some UW screener rows have
  `sector: null`. Downstream groupings (e.g. concentration by sector on
  the Portfolio tab) lose fidelity. Cross-reference against a cached
  yfinance `get_info()['sector']` fallback.

- **Delisted / mergered ticker handling.** Occasionally UW returns
  tickers that have been delisted (shows up as `no_price` in the
  rejection log). Today we just drop them silently. Would be useful to
  emit a "delisted_or_missing" section in the daily email so Joe knows
  his watchlist has gone stale.

- **Market-cap backstop.** `_market_cap_for_ticker` falls back to
  `flow_alerts`/`screener` rows but misses tickers that only appear in
  `congress_buys` / `darkpool`. Those slip past the mcap filter. Add a
  one-off yfinance fetch when mcap is missing for anything making it
  into the filtered universe.

## Dashboard UX

- **Per-user persistent dashboard state.** Right now Scanner.jsx defaults
  to the tile landing and doesn't remember which tab the user was on.
  Persist last-viewed tab in Supabase `user_preferences`.

- **Composite score history / sparkline.** Retain the last N composite
  scores per ticker so the dashboard can render a 5-day sparkline —
  trend in the score matters as much as the current value. Would need a
  small rolling table in Supabase with an RLS policy scoped to the admin
  role (since these are public scanner outputs, not user data).

- **Ticker-detail modal: add composite breakdown.** The current modal
  shows flow, technicals, and short interest but doesn't break out which
  components (trend/momentum/performance) are driving the composite.
  Add a four-bar mini-chart showing each component's signed contribution.

## Email / notification

- **Digest cadence preference.** Today the daily email is hardwired.
  Support a per-user cadence (daily / weekly / on-trigger-only) once the
  B2 Supabase user_preferences table exists.

- **Threshold-crossing alerts.** Email only when a held ticker crosses
  from NEUTRAL → STRONG BEAR or from BULL → STRONG BULL on the composite.
  Silent in between — much higher signal-to-noise.

## Track B3 — later

- **CSV import for positions.** Today Joe edits
  `trading-scanner/portfolio/positions.csv` locally. Track B2 added
  per-user Supabase positions, but the import path is manual paste-
  tickers. A CSV upload → Supabase insert flow would onboard new users
  in seconds.

- **Broker-API sync (read-only).** Plaid / SnapTrade integration for
  live portfolio pull. Public-facing version needs a risk review first
  (read-only scope, no order routing).

---

**Process note:** when a new enhancement surfaces mid-build, add it here
rather than inlining a TODO in code — keeps this doc as the single
source of truth for "what's next" and avoids TODO-comment rot. After
shipping an item, strike it through (don't delete) so the history of
scope changes is auditable.
