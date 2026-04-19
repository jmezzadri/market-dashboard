// Minimal error boundary. Keeps a single render failure (e.g. inside the
// TickerDetailModal) from blanking the whole app. React's default behavior on
// uncaught render errors is to unmount the tree, which presents to users as a
// blank white screen with no way back — this boundary catches the throw,
// logs it, and shows a small dismissable error card instead.
//
// Usage:
//   <ErrorBoundary label="Ticker detail" onDismiss={closeFn}>
//     <TickerDetailModal .../>
//   </ErrorBoundary>

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    // Surface to console + the global console-error ring used by ReportBug so
    // a user who hits this can file a bug that includes the stack.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary: ${this.props.label || "unknown"}]`, err, info?.componentStack);
  }
  render() {
    if (this.state.err) {
      const msg = String(this.state.err?.message || this.state.err || "Unknown error");
      const dismiss = () => {
        this.setState({ err: null });
        this.props.onDismiss?.();
      };
      return (
        <div
          onClick={dismiss}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 480, background: "var(--surface,#1a1a1a)",
              border: "1px solid var(--border,#333)", borderRadius: 10,
              padding: "18px 20px", color: "var(--text,#eee)",
              fontFamily: "system-ui, -apple-system, sans-serif",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ff9f0a", letterSpacing: "0.06em", marginBottom: 6 }}>
              SOMETHING WENT WRONG
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>
              {this.props.label ? `${this.props.label} hit an error while rendering.` : "This panel hit an error while rendering."}{" "}
              The rest of the dashboard is still OK — you can close this and continue.
            </div>
            <div style={{
              fontSize: 11, fontFamily: "var(--font-mono,monospace)",
              color: "var(--text-muted,#888)",
              background: "var(--surface-2,#222)", border: "1px solid var(--border-faint,#2a2a2a)",
              borderRadius: 5, padding: "6px 8px", marginBottom: 12,
              wordBreak: "break-word",
            }}>
              {msg}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={dismiss}
                style={{
                  background: "var(--accent,#0a84ff)", color: "#fff", border: 0,
                  borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim,#777)", marginTop: 10 }}>
              If this keeps happening, tap the Report Bug button and we'll look into it.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
