/**
 * v2 BisectPage — isolation harness for the PR #1 "TypeError: t is not iterable"
 * crash.
 *
 * Reached at #v2/bisect[/<step>]. Each step mounts ONE live component from
 * src/components/ inside the v2 shell. If a step renders cleanly, that
 * component is innocent; if a step crashes, the bug lives in that component
 * or one of its child hooks when mounted inside the v2 shell context.
 *
 * Per LESSONS.md (2026-05-18 "open the browser console on the failing
 * route. Read the actual JavaScript error before guessing.") — this page
 * gives us a deterministic place to read the real error each component
 * produces, instead of inferring from the bundle.
 */
import React, { useState, useEffect } from "react";
import useScanData from "../hooks/useScanData";

import UniverseFreshness from "../../components/UniverseFreshness";
import WatchlistTable from "../../components/WatchlistTable";
import PositionsTable from "../../components/PositionsTable";
import TickerDetailModal from "../../components/TickerDetailModal";

const STEPS = [
  { id: "1", label: "1 · UniverseFreshness" },
  { id: "2", label: "2 · WatchlistTable" },
  { id: "3", label: "3 · PositionsTable" },
  { id: "4", label: "4 · TickerDetailModal" },
];

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    this.setState({ err, info });
    // eslint-disable-next-line no-console
    console.error("[v2 bisect] " + this.props.stepLabel + " crashed:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            border: "1px solid #c1394f",
            borderRadius: 8,
            padding: 16,
            background: "rgba(193, 57, 79, 0.05)",
            color: "var(--mt-ink-1)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {this.props.stepLabel} crashed
          </div>
          <div
            style={{
              fontFamily: "var(--mt-mono, monospace)",
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {String((this.state.err && this.state.err.message) || "unknown")}
          </div>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, opacity: 0.7 }}>
            {((this.state.err && this.state.err.stack) || "") +
              ((this.state.info && this.state.info.componentStack) || "")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BisectPage({ subpath, setPage, openTicker }) {
  const step = (subpath && subpath[0]) || null;
  const { data: scanData, loading: scanLoading, error: scanError } = useScanData();

  const [modalTicker, setModalTicker] = useState("NVDA");
  useEffect(() => {
    const keys =
      scanData && scanData.signals && scanData.signals.screener
        ? Object.keys(scanData.signals.screener)
        : null;
    if (Array.isArray(keys) && keys.length > 0) {
      setModalTicker(keys[0]);
    }
  }, [scanData]);

  return (
    <div>
      <section
        style={{
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid var(--mt-border)",
        }}
      >
        <div className="mt-eyebrow">PR #1 crash bisect</div>
        <h1 className="mt-h1">v2 shell · live-component isolation</h1>
        <p className="mt-deck" style={{ maxWidth: 640 }}>
          Each step mounts one production component from the legacy codebase
          inside the v2 shell. The error boundary below catches per-step crashes
          so the rest of the shell keeps rendering.
        </p>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {STEPS.map((s) => (
            <a
              key={s.id}
              href={"#v2/bisect/" + s.id}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--mt-border)",
                background: step === s.id ? "var(--mt-accent-bg, #0a5cd1)" : "transparent",
                color: step === s.id ? "#fff" : "var(--mt-ink-1)",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          Snapshot:{" "}
          {scanLoading
            ? "loading…"
            : scanError
            ? "error — " + String(scanError.message || scanError)
            : scanData
            ? "loaded · screener=" +
              Object.keys((scanData && scanData.signals && scanData.signals.screener) || {})
                .length +
              " tickers · info=" +
              Object.keys((scanData && scanData.signals && scanData.signals.info) || {})
                .length +
              " tickers"
            : "no data"}
        </div>
      </section>

      {!step && (
        <div style={{ padding: 24, textAlign: "center", opacity: 0.7 }}>
          Pick a step above.
        </div>
      )}

      {step === "1" && (
        <Boundary stepLabel="Step 1 · UniverseFreshness">
          <div className="mt-card" style={{ padding: 16 }}>
            <div className="mt-eyebrow">Live UniverseFreshness with stub timestamps</div>
            <div style={{ marginTop: 12 }}>
              <UniverseFreshness
                pricesTs={new Date().toISOString()}
                eventsTs={new Date().toISOString()}
              />
            </div>
          </div>
        </Boundary>
      )}

      {step === "2" && (
        <Boundary stepLabel="Step 2 · WatchlistTable">
          <div className="mt-card" style={{ padding: 0 }}>
            <WatchlistTable
              rows={[]}
              signals={scanData && scanData.signals}
              screener={(scanData && scanData.signals && scanData.signals.screener) || {}}
              info={(scanData && scanData.signals && scanData.signals.info) || {}}
              heldTickers={new Set()}
              onOpenTicker={openTicker}
              emptyMessage="Empty by design — we just want to know if it mounts."
              tableKey="v2_bisect_wl"
            />
          </div>
        </Boundary>
      )}

      {step === "3" && (
        <Boundary stepLabel="Step 3 · PositionsTable">
          <div className="mt-card" style={{ padding: 0 }}>
            <PositionsTable
              rows={[]}
              grandTotal={0}
              screener={(scanData && scanData.signals && scanData.signals.screener) || {}}
              info={(scanData && scanData.signals && scanData.signals.info) || {}}
              onOpenTicker={openTicker}
              emptyMessage="Empty by design — we just want to know if it mounts."
              pricesTs={null}
              eventsTs={null}
              tableKey="v2_bisect_pos"
            />
          </div>
        </Boundary>
      )}

      {step === "4" && (
        <Boundary stepLabel="Step 4 · TickerDetailModal">
          <div style={{ padding: 8 }}>
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>
              Mounting modal for {modalTicker}. The modal locks body scroll on
              mount; it will overlay this page intentionally.
            </div>
            <TickerDetailModal
              ticker={modalTicker}
              scanData={scanData}
              accounts={[]}
              watchlistRows={[]}
              portfolioAuthed={false}
              refetchPortfolio={async () => {}}
              onClose={() => {
                window.location.hash = "v2/bisect";
              }}
              onTickerAdded={() => {}}
              scanBusy={false}
            />
          </div>
        </Boundary>
      )}
    </div>
  );
}
