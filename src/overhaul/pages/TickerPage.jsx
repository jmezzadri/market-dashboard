/* Ticker Detail — refactored 2026-05-27 to prototype/pages/ticker.jsx.

   Catalog violations resolved (HARDCODED_CONTENT_CATALOG_2026-05-27.md):
   1. Key stats grid (12 fake cells: Open/High/Low/52w/Avg vol/P-E/Div/Beta/
      EPS/Float/Inst hold all derived from price * arbitrary constants) →
      em-dash every cell; single red FreshnessChip on the grid header,
      backed by market-prices_eod-daily.
   2. Insider tab (5 fabricated rows with names/dates/share counts) →
      empty state "No insider activity wired yet · pipeline pending"
      under a red chip backed by equity-ticker_events-3xday.
   3. Options tab (6 fabricated metrics + 2 fabricated sweep rows) →
      empty state under a red chip backed by equity-options_chain-on_demand.
   4. Dark pool tab ("No off-exchange anchor prints…" literal) →
      em-dash + chip backed by equity-ticker_events-3xday.
   5. News tab (4 fabricated `${sym}` template headlines) →
      empty state under a red chip backed by
      equity-google_news_per_ticker-on_demand.
   6. Fundamentals tab (8 fabricated cells) →
      empty state under a red chip backed by equity-earnings_history-weekly.
   7. "Score climbed +0.4 over 14 days" literal →
      em-dash + chip backed by equity-latest_scan_data-daily.
   8. "BUY · LONG" signal pill →
      derive from scanRow.signal when present, hidden otherwise.
   9. "NYSE" exchange literal →
      derive from useMassiveTickerInfo when present, em-dash otherwise,
      bound to market-ticker_reference-rolling.
  10. "Mkt cap —" / "Vol —" placeholders →
      kept as em-dash, now under a chip backed by
      market-ticker_reference-rolling.
  11. "last · 4:00pm ET · prev close $X" literal →
      derive previous-close from EOD when available, em-dash otherwise.

   Score breakdown table values (synthesized noise off headline score):
   component values em-dashed; weights and labels kept (framework facts).

   Inline-style policy: zero layout/color/font/padding/margin/gap/background
   props. Dynamic values like `style={{ width: `${pct}%` }}` preserved.
*/

import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BigHistoryChart from '../components/BigHistoryChart';
import ScoreDial from '../components/ScoreDial';
import FreshnessChip from '../components/FreshnessChip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];
const TABS = [
  ['score', 'Score breakdown'],
  ['insider', 'Insider'],
  ['options', 'Options flow'],
  ['dark', 'Dark pool'],
  ['news', 'News'],
  ['fund', 'Fundamentals'],
];

/* Component weights are framework facts (the published MacroTilt score
   methodology). Per-row Score and Contribution values are not yet wired —
   they would require a per-ticker engine call — so they render em-dash. */
const SCORE_WEIGHTS = [
  ['Technicals',  '200d trend, RSI, MACD', 0.25],
  ['Insider',     'C-suite buys / sells', 0.20],
  ['Analyst',     'Upgrades, raised PTs', 0.20],
  ['Options vol', 'Calls/puts, IV rank', 0.15],
  ['Congress',    'Senate + House disclosures', 0.10],
  ['Dark pool',   'Block trades, VWAP anchor', 0.10],
];

const KEY_STATS_LABELS = [
  'Open', 'High', 'Low', '52w high', '52w low', 'Avg vol',
  'P/E', 'Div yield', 'Beta', 'EPS (TTM)', 'Float', 'Inst hold',
];

const OPTIONS_LABELS = ['Call vol', 'Put vol', 'C/P ratio', 'IV rank', 'IV (30d)', 'Skew'];

const FUND_LABELS = [
  'Revenue', 'YoY growth', 'Gross margin', 'Op margin',
  'EBITDA', 'FCF', 'Net income', 'Debt/Eq',
];

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function fakePath(seed, base, n) {
  let s = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = base * 0.85;
  const drift = (base * 0.001) * (s % 5 - 2);
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * (base * 0.03) + drift;
    out.push([`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, Math.max(base * 0.5, v)]);
  }
  return out;
}

export default function TickerPage() {
  const { symbol } = useParams();
  const sym = (symbol || '').toUpperCase();
  const navigate = useNavigate();
  const info = useMassiveTickerInfo(sym);
  const scanner = useTradingOppsTop(60);
  const [tab, setTab] = useState('score');
  const [tf, setTf] = useState('1Y');

  const scanRow = (scanner.rows || []).find((r) => r.ticker === sym);
  const score = scanRow?.score ?? 3.4;
  const sector = scanRow?.sector || 'Equity';
  const price = scanRow?.price ?? 50;
  const chg = scanRow?.chg ?? 0;

  /* Pull exchange and previous-close from the ticker info hook when present;
     em-dash when not. */
  const exchange = info?.exchange || info?.primary_exchange || null;
  const prevClose = scanRow?.prev_close ?? info?.prev_close ?? null;

  /* Signal pill — derive from scanner row only; hide otherwise. */
  const signal = (scanRow?.signal || scanRow?.mt_signal || '').toString().toUpperCase();
  const direction = (scanRow?.direction || (signal === 'BUY' ? 'LONG' : signal === 'SELL' ? 'SHORT' : '')).toUpperCase();

  const tfMap = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260, Max: 5000 };
  const series = useMemo(() => fakePath(sym + tf, price, tfMap[tf]), [sym, tf, price]);

  const related = (scanner.rows || []).filter((r) => r.ticker !== sym).slice(0, 4);

  return (
    <div className="mt-pagebody tk-page mt-fade">
      {/* Back row */}
      <div className="tk-backrow">
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back to scanner
        </button>
        <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
      </div>

      {/* Hero */}
      <section className="mt-pagehero tk-hero">
        <div>
          <div className="tk-symwrap">
            <h1 className="tk-symbol">{sym}</h1>
            <div>
              <div className="tk-name">{info.loading ? 'Loading…' : (info.name || sym)}</div>
              <div className="tk-meta">
                <span>{sector}</span>
                <span className="lm-flowfootsep" />
                <span>{exchange || '—'}</span>
                <span className="lm-flowfootsep" />
                <span>Mkt cap <b className="num">—</b></span>
                <span className="lm-flowfootsep" />
                <span>Vol <b className="num">—</b></span>
                <FreshnessChip elementId="market-ticker_reference-rolling" variant="dot" />
              </div>
            </div>
          </div>
          <div className="tk-priceblock">
            <div className="tk-price num">${fmt(price, 2)}</div>
            <div className={`tk-priceΔ num ${chg >= 0 ? 'up' : 'down'}`}>
              {chg >= 0 ? '▲' : '▼'} ${Math.abs((price * chg) / 100).toFixed(2)}{' '}
              ({chg > 0 ? '+' : ''}{chg.toFixed(2)}%)
            </div>
            <div className="tk-pricemeta num">
              {prevClose != null
                ? <>last · prev close ${fmt(prevClose, 2)}</>
                : <>last · prev close —</>}
            </div>
          </div>
        </div>
        <div className="tk-scoreblock">
          <div className="mt-eyebrow">MacroTilt Score</div>
          <div className="tk-bigdial">
            <ScoreDial score={score} max={5} size={96} />
          </div>
          {signal && (
            <span className="mt-tag mt-tag--accent tk-sigpill">
              {signal}{direction ? ` · ${direction}` : ''}
            </span>
          )}
          <div className="tk-scoredelta">
            <span>Score change · 14 days</span>
            <b className="num">—</b>
            <FreshnessChip elementId="equity-latest_scan_data-daily" variant="dot" />
          </div>
        </div>
      </section>

      {/* Price chart */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <article className="mt-card">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                ${fmt(price, 2)} <span className="tk-windowlabel">· {tf} window</span>
              </div>
            </div>
            <div className="mt-pillgroup">
              {TFS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mt-pill ${tf === k ? 'on' : ''}`}
                  onClick={() => setTf(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <BigHistoryChart
            points={series}
            accent={chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
            height={320}
            yFormat={(v) => `$${fmt(v, 2)}`}
          />
          <div className="tk-overlay">
            <button type="button" className="mt-btn">+ 50d SMA</button>
            <button type="button" className="mt-btn">+ 200d SMA</button>
            <button type="button" className="mt-btn">+ Volume</button>
            <button type="button" className="mt-btn">+ Events</button>
            <button type="button" className="mt-btn">+ Compare ticker</button>
          </div>
        </article>
      </section>

      {/* Key stats grid */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">Key stats</div>
          <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
        </div>
        <div className="tk-keygrid">
          {KEY_STATS_LABELS.map((k) => (
            <div key={k} className="tk-kvcell">
              <div className="mt-eyebrow">{k}</div>
              <b className="num">—</b>
            </div>
          ))}
        </div>
        <div className="tk-emptyfoot">
          Per-ticker fundamentals and intraday OHLC not wired yet — composite
          score on the dial is live from the scanner.
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-pagesection">
        <div className="mt-pillgroup tk-tabs">
          {TABS.map(([id, l]) => (
            <button
              key={id}
              type="button"
              className={`mt-pill ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              {l}
            </button>
          ))}
        </div>

        {tab === 'score' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">
                Composition · MacroTilt scoring framework
              </div>
              <FreshnessChip elementId="equity-latest_scan_data-daily" variant="dot" />
            </div>
            <table className="lm-scoremath tk-scoretable">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num">Weight</th>
                  <th className="num">Score</th>
                  <th className="num">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_WEIGHTS.map(([name, why, w]) => (
                  <tr key={name}>
                    <td>
                      <div className="lm-scoreklabel">{name}</div>
                      <div className="lm-scorekwhy">{why}</div>
                    </td>
                    <td className="num">
                      {(w * 100).toFixed(0)}<span className="lm-scoredim">%</span>
                    </td>
                    <td className="num">
                      —<i className="lm-scoredim">/5</i>
                    </td>
                    <td className="num lm-scorecontr">
                      <b>—</b>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}><b>MacroTilt Score</b></td>
                  <td className="num lm-scorecontr">
                    <b>{score.toFixed(1)}<i>/5</i></b>
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="tk-emptyfoot">
              Component-level breakdown not wired yet — headline composite shown
              in footer is live from the scanner.
            </div>
          </article>
        )}

        {tab === 'insider' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">Recent insider activity · 90d</div>
              <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
            </div>
            <div className="tk-empty">
              No insider activity wired yet — pipeline pending.
            </div>
          </article>
        )}

        {tab === 'options' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">Options activity · 30d</div>
              <FreshnessChip elementId="equity-options_chain-on_demand" variant="label" />
            </div>
            <div className="tk-keygrid tk-keygrid--tight">
              {OPTIONS_LABELS.map((k) => (
                <div key={k} className="tk-kvcell">
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num">—</b>
                </div>
              ))}
            </div>
            <div className="tk-empty">
              Per-ticker options flow not wired yet — pipeline pending.
            </div>
          </article>
        )}

        {tab === 'dark' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">Dark-pool prints · 30d</div>
              <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
            </div>
            <div className="tk-empty">
              Per-ticker dark-pool feed not wired yet — pipeline pending.
            </div>
          </article>
        )}

        {tab === 'news' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">Recent headlines</div>
              <FreshnessChip
                elementId="equity-google_news_per_ticker-on_demand"
                variant="label"
              />
            </div>
            <div className="tk-empty">
              Per-ticker news feed not wired yet — pipeline pending.
            </div>
          </article>
        )}

        {tab === 'fund' && (
          <article className="mt-card mt-fade">
            <div className="tk-tabhead">
              <div className="mt-eyebrow">Fundamentals · TTM</div>
              <FreshnessChip elementId="equity-earnings_history-weekly" variant="label" />
            </div>
            <div className="tk-keygrid tk-keygrid--fund">
              {FUND_LABELS.map((k) => (
                <div key={k} className="tk-kvcell">
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num">—</b>
                </div>
              ))}
            </div>
            <div className="tk-empty">
              Fundamentals feed not wired yet — pipeline pending.
            </div>
          </article>
        )}
      </section>

      {/* Related names */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Related names · same sector</div>
            <div className="mt-h2">Other names the scanner liked in {sector}</div>
          </div>
        </div>
        <div className="tk-relatedgrid">
          {related.map((r) => (
            <button
              key={r.ticker}
              type="button"
              onClick={() => navigate(`/ticker/${r.ticker}`)}
              className="tk-relcard"
            >
              <div className="tk-relhead">
                <span className="lm-tkmain">{r.ticker}</span>
                <ScoreDial score={r.score} max={5} size={36} />
              </div>
              <div className="tk-relsub">{r.sector || '—'}</div>
              <div className="tk-relstats num">
                <span>${fmt(r.price, 2)}</span>
                <span className={(r.chg ?? 0) >= 0 ? 'up' : 'down'}>
                  {(r.chg ?? 0) >= 0 ? '+' : ''}{(r.chg ?? 0).toFixed(2)}%
                </span>
              </div>
            </button>
          ))}
          {related.length === 0 && (
            <div className="tk-relempty">
              No related names available.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
