import React from 'react';

/**
 * v2 ErrorBoundary — any render exception on a single page is caught here
 * and rendered as a friendly fallback. Without this, one bad component
 * tears down the entire app (sidebar, auth UI, every other tab).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }
  componentDidCatch(error, info) {
    // Surface to console for debugging; production also has Vercel runtime logs
    // and the bug-reporter floating button.
    if (typeof console !== 'undefined' && console.error) {
      console.error('[v2 ErrorBoundary] caught:', error, info);
    }
  }
  reset = () => this.setState({ hasError: false, message: '' });
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="v2-root" style={{ minHeight: '60vh' }}>
        <div className="v2-shell" style={{ padding: '64px 0' }}>
          <div className="t-eyebrow accent" style={{ marginBottom: 12 }}>This tab hit a snag</div>
          <h1 className="t-display" style={{ margin: 0 }}>Try another tab.</h1>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '52ch' }}>
            One of the panels on this tab failed to render. The rest of the
            site is still working — pick another tab from the side nav.
            If you'd like to log this, the Report Bug button bottom-right
            captures the page state.
          </p>
          <p className="t-body" style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-2)' }}>
            <code style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>
              {this.state.message.slice(0, 200)}
            </code>
          </p>
          <button
            type="button"
            onClick={this.reset}
            style={{
              marginTop: 18,
              padding: '8px 14px',
              background: 'var(--bg-1)',
              border: '1px solid var(--line-1)',
              borderRadius: 'var(--r-pill)',
              color: 'var(--ink-0)',
              font: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
