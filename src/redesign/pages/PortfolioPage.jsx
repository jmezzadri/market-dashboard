/**
 * v2 PortfolioPage — wired to real data.
 *
 * Drops the mock dataset and uses the production hooks the legacy
 * Insights tab already uses (useUserPortfolio + scanData + UniverseFreshness).
 * The PositionsTable, WatchlistTable, BulkImport, and PositionEditor
 * components are imported from src/components/ — same surface, full
 * feature parity (sub-composite scores, sortable, CRUD, rescan).
 */
import React, { useMemo, useState } from "react";
import { Tip } from "../atoms";

import { useSession } from "../../auth/useSession";
import { useUserPortfolio } from "../../hooks/useUserPortfolio";
import { useUniverseSnapshot } from "../../hooks/useUniverseSnapshot";
import useScanData from "../hooks/useScanData";

import PositionsTable from "../../components/PositionsTable";
import WatchlistTable from "../../components/WatchlistTable";
import UniverseFreshness from "../../components/UniverseFreshness";
import BulkImport from "../../components/BulkImport";
import PositionEditor from "../../components/PositionEditor";

function flattenPositions(accounts) {
  if (!Array.isArray(accounts)) return [];
  const out = [];
  for (const a of accounts) {
    if (!Array.isArray(a.positions)) continue;
    for (const p of a.positions) {
      out.push({ ...p, account: a.label, accountId: a.id, accountColor: a.color });
    }
  }
  return out;
}

function sumGrandTotal(accounts) {
  let total = 0;
  for (const a of accounts || []) {
    for (const p of a.positions || []) {
      const v = Number(p.value);
      if (Number.isFinite(v)) total += v;
    }
  }
  return total;
}

function bucketCandidates(scanData) {
  // scanData.signals.screener arrives as a dict keyed by ticker symbol, not
  // a list. Walk the values, not the object itself. (Bug fix from PR #1
  // first attempt — see LESSONS 2026-05-26.)
  const screenerObj = scanData?.signals?.screener || {};
  const rows = Object.values(screenerObj).map((row, i) => {
    if (row && !row.ticker) {
      // The dict key is the ticker; preserve it on the row so downstream
      // tables can render the symbol column.
      const t = Object.keys(screenerObj)[i];
      return { ...row, ticker: t };
    }
    return row;
  });
  const buy = [], near = [];
  for (const r of rows) {
    if (!r) continue;
    const score = Number(r.overall_score ?? r.score ?? 0);
    if (!Number.isFinite(score)) continue;
    if (score >= 60) buy.push(r);
    else if (score >= 40) near.push(r);
  }
  buy.sort((a, b) => (b.overall_score || b.score) - (a.overall_score || a.score));
  near.sort((a, b) => (b.overall_score || b.score) - (a.overall_score || a.score));
  return { buy, near };
}

function screenerInfoMaps(scanData) {
  // Both fields ship from the producer as dicts keyed by ticker symbol —
  // the same shape the legacy Insights tab consumes. Pass them straight
  // through. Bug fix from PR #1 first attempt.
  return {
    screener: scanData?.signals?.screener || {},
    info: scanData?.signals?.info || {},
  };
}

export default function PortfolioPage({ openTicker }) {
  const { session } = useSession();
  const portfolioAuthed = !!session;
  const { accounts: ACCOUNTS, watchlist: userWatchlistRows, refetch: refetchPortfolio } = useUserPortfolio();
  const { data: scanData } = useScanData();
  const uni = useUniverseSnapshot() || {};
  const { ts: universeSnapshotTs, pricesTs, eventsTs } = uni;

  const heldPositions = useMemo(() => flattenPositions(ACCOUNTS), [ACCOUNTS]);
  const grandTotal = useMemo(() => sumGrandTotal(ACCOUNTS), [ACCOUNTS]);
  const heldTickers = useMemo(
    () => new Set(heldPositions.map((p) => String(p.ticker || "").toUpperCase())),
    [heldPositions]
  );
  const { buy, near } = useMemo(() => bucketCandidates(scanData), [scanData]);
  const { screener, info } = useMemo(() => screenerInfoMaps(scanData), [scanData]);

  const [positionEditor, setPositionEditor] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);

  return (
    <>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Portfolio insights
            <UniverseFreshness ts={universeSnapshotTs} pricesTs={pricesTs} eventsTs={eventsTs} compact />
          </div>
          <h1 className="mt-h1">
            Your portfolio and watchlist — <i>augmented</i> with MacroTilt's signal intelligence.
          </h1>
          <p className="mt-deck">
            Time-weighted performance and position-level alerts. The same scoring you see on Trading
            Scanner applied to every position you hold across {ACCOUNTS?.length || 0} account
            {ACCOUNTS?.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="pf-keystats">
          <div className="mt-eyebrow">Snapshot</div>
          <div className="pf-keygrid">
            <div>
              <div className="mt-eyebrow">Total wealth</div>
              <b className="pf-keynum num">${(grandTotal / 1000).toFixed(0)}<i>K</i></b>
              <span className="num pf-keysub">{ACCOUNTS?.length || 0} accounts</span>
            </div>
            <div>
              <div className="mt-eyebrow">Held positions</div>
              <b className="pf-keynum num">{heldPositions.length}</b>
              <span className="num pf-keysub">across accounts</span>
            </div>
            <div>
              <div className="mt-eyebrow">Buy alerts</div>
              <b className="pf-keynum num up">{buy.length}</b>
              <span className="num pf-keysub">composite ≥ 60</span>
            </div>
            <div>
              <div className="mt-eyebrow">Near trigger</div>
              <b className="pf-keynum num" style={{ color: "var(--mt-warn)" }}>{near.length}</b>
              <span className="num pf-keysub">40 – 59</span>
            </div>
          </div>
        </div>
      </section>

      {!portfolioAuthed && (
        <section className="mt-pagesection">
          <div className="mt-card" style={{ padding: 24 }}>
            <div className="mt-eyebrow" style={{ marginBottom: 6 }}>Sign in required</div>
            <p style={{ margin: 0, color: "var(--mt-ink-1)", fontSize: 14 }}>
              Sign in on the current site to load your portfolio. Once you have, this page reads
              the same accounts &amp; watchlist live from Supabase — no separate login required.
            </p>
          </div>
        </section>
      )}

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Trading opportunities</div>
            <div className="mt-h2">Buy alerts &amp; near-trigger candidates from today's scan.</div>
          </div>
          <UniverseFreshness ts={universeSnapshotTs} pricesTs={pricesTs} eventsTs={eventsTs} />
        </div>
        <div className="mt-card" style={{ padding: 0, marginBottom: 14 }}>
          <WatchlistTable
            rows={buy}
            signals={scanData?.signals}
            screener={screener}
            info={info}
            heldTickers={heldTickers}
            onOpenTicker={openTicker}
            emptyMessage="No buy alerts in the latest scan."
            tableKey="v2_pf_buy"
          />
        </div>
        <div className="mt-card" style={{ padding: 0 }}>
          <WatchlistTable
            rows={near}
            signals={scanData?.signals}
            screener={screener}
            info={info}
            heldTickers={heldTickers}
            onOpenTicker={openTicker}
            emptyMessage="No near-trigger candidates in the latest scan."
            tableKey="v2_pf_near"
          />
        </div>
      </section>

      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Positions</div>
            <div className="mt-h2">Engine signal on every position you hold.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {portfolioAuthed && (
              <button className="mt-btn" onClick={() => setPositionEditor({ mode: "add" })}>+ Add position</button>
            )}
            {portfolioAuthed && (
              <button className="mt-btn" onClick={() => setShowBulkImport(true)}>Upload CSV</button>
            )}
            <Tip content="Coming soon — wire a brokerage directly via Plaid.">
              <button className="mt-btn" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                Connect via Plaid
              </button>
            </Tip>
          </div>
        </div>
        <div className="mt-card" style={{ padding: 0 }}>
          <PositionsTable
            rows={heldPositions}
            grandTotal={grandTotal}
            screener={screener}
            info={info}
            onOpenTicker={openTicker}
            emptyMessage={portfolioAuthed
              ? "No positions yet. Add one or upload a CSV to get started."
              : "Sign in to load your positions."}
            onAdd={portfolioAuthed ? () => setPositionEditor({ mode: "add" }) : undefined}
            onBulkImport={portfolioAuthed ? () => setShowBulkImport(true) : undefined}
            onEdit={portfolioAuthed ? (existing) => setPositionEditor({ mode: "edit", existing }) : undefined}
            pricesTs={pricesTs}
            eventsTs={eventsTs}
            footnoteSource="Unusual Whales · Yahoo Finance"
            tableKey="v2_pf_positions"
          />
        </div>
      </section>

      {positionEditor && portfolioAuthed && (
        <PositionEditor
          mode={positionEditor.mode}
          existing={positionEditor.existing}
          accounts={(ACCOUNTS || []).map((a) => ({ id: a.id, label: a.label }))}
          userId={session?.user?.id}
          onClose={() => setPositionEditor(null)}
          onSaved={async () => { await refetchPortfolio?.(); setPositionEditor(null); }}
          onDeleted={async () => { await refetchPortfolio?.(); setPositionEditor(null); }}
        />
      )}

      {showBulkImport && portfolioAuthed && (
        <BulkImport
          userId={session?.user?.id}
          onClose={() => setShowBulkImport(false)}
          onDone={async () => { await refetchPortfolio?.(); setShowBulkImport(false); }}
        />
      )}
    </>
  );
}
