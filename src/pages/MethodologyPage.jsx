// MethodologyPage — Signal Intelligence rewrite (2026-05-12).
//
// Methodology content has been completely rewritten around the Signal
// Intelligence framework: three volatility triggers (Layer 1) plus a
// seven-indicator cycle composite (Layer 2), rolled into a single four-state
// regime label. The old framework copy (cycle mechanisms / NORMAL-ELEVATED-
// EXTREME bands / composite scoring tier weights / six categories) is gone.
//
// To keep the default route (/#readme) and the v2 preview route in sync, both
// pages now render the same body component. This file is a thin wrapper that
// matches the legacy page's call signature (it accepts the legacy props but
// does not use them — the body sources data from the registry directly).

import MethodologyBody from '../v2/components/MethodologyBody';

export default function MethodologyPage(/* legacy props ignored */) {
  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: '0 24px 48px' }}>
      <MethodologyBody />
    </main>
  );
}
