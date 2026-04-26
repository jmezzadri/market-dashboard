"""
monitoring.alerts — email alerting via Resend.

Sends operator alerts when:
  - A pipeline run fails (any layer)
  - Anomaly detection produces warnings
  - Validation produces errors
  - SPY holdings pull fails for > 1 week consecutive

Falls back to console log if Resend is unreachable. Alerts never halt the
pipeline.

Configuration:
  RESEND_API_KEY env var (already in macrotilt env)
  ALERT_TO     env var (default: josephmezzadri@gmail.com)
  ALERT_FROM   env var (default: noreply@macrotilt.com)
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
DEFAULT_TO = "josephmezzadri@gmail.com"
DEFAULT_FROM = "noreply@macrotilt.com"


def send_email(subject: str, html_body: str,
               to: str | None = None, from_addr: str | None = None) -> bool:
    """Send an email via Resend. Returns True on success.

    Failure is logged but doesn't raise — alerts must not halt the pipeline.
    """
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set — alert printed to log instead:")
        logger.warning(f"  Subject: {subject}")
        logger.warning(f"  Body: {html_body[:500]}")
        return False

    to = to or os.environ.get("ALERT_TO", DEFAULT_TO)
    from_addr = from_addr or os.environ.get("ALERT_FROM", DEFAULT_FROM)

    payload = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }

    req = urllib.request.Request(
        RESEND_API_URL, method="POST",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                logger.info(f"Alert sent to {to}: {subject}")
                return True
            logger.error(f"Resend returned status {resp.status}")
            return False
    except Exception as exc:
        logger.error(f"Resend call failed: {exc}")
        return False


def alert_pipeline_failure(run_dict: dict) -> bool:
    """Compose + send an alert when a pipeline run fails."""
    run_id = run_dict.get("run_id", "?")
    mode = run_dict.get("mode", "?")
    started = run_dict.get("started_at", "?")
    errors = run_dict.get("errors", [])

    error_html = "".join(
        f"<li><strong>{e.get('layer')}</strong>: {e.get('message')}</li>"
        for e in errors
    )

    body = f"""
    <h2>MacroTilt v10 pipeline FAILED</h2>
    <p><strong>Run:</strong> {run_id} ({mode})</p>
    <p><strong>Started:</strong> {started}</p>
    <p><strong>Layers completed:</strong> {", ".join(run_dict.get("layers_completed", []))}</p>
    <p><strong>Errors ({len(errors)}):</strong></p>
    <ul>{error_html}</ul>
    <p>The previously-published allocation remains live in production. Investigate, fix, and re-run with the same run_dir for idempotency.</p>
    <p>See the runbook at <code>asset_allocation/docs/runbook.md</code> for diagnostic steps.</p>
    """
    return send_email(
        subject=f"[MacroTilt] Pipeline FAILED — {mode} run {run_id}",
        html_body=body,
    )


def alert_anomaly(allocation: dict, anomalies: list[dict]) -> bool:
    """Compose + send an alert when anomalies fire."""
    if not anomalies:
        return False

    as_of = allocation.get("as_of", "?")
    stance = allocation.get("stance", {}).get("label", "?")
    alpha = allocation.get("headline", {}).get("alpha", "?")

    anomaly_html = "".join(
        f"<li><strong>{a.get('type')}</strong> ({a.get('severity', 'info')}): "
        f"{a.get('description')}</li>"
        for a in anomalies
    )

    body = f"""
    <h2>MacroTilt v10 anomaly detected</h2>
    <p><strong>As of:</strong> {as_of}</p>
    <p><strong>Stance:</strong> {stance}</p>
    <p><strong>Alpha:</strong> {alpha}</p>
    <p><strong>Anomalies ({len(anomalies)}):</strong></p>
    <ul>{anomaly_html}</ul>
    <p>The new allocation has been published to production but may need operator review. Compare against last week's snapshot in <code>public/allocation_history/</code>.</p>
    """
    return send_email(
        subject=f"[MacroTilt] Anomaly — {len(anomalies)} flag(s) on {as_of} run",
        html_body=body,
    )


def alert_regime_watch(regime_alert: dict) -> bool:
    """Compose + send an alert when the daily regime watch fires."""
    if not regime_alert.get("alert_active"):
        return False

    body = f"""
    <h2>MacroTilt v10 regime watch alert</h2>
    <p><strong>Last formal rebalance:</strong> {regime_alert.get('last_rebalance')}</p>
    <p><strong>R&L at last rebalance:</strong> {regime_alert.get('rl_at_last_rebalance')}</p>
    <p><strong>R&L now:</strong> {regime_alert.get('current_rl')}</p>
    <p><strong>Move since rebalance:</strong> {regime_alert.get('rl_delta_since_rebalance'):+.1f} points</p>
    <p>{regime_alert.get('narrative')}</p>
    <p>The formal allocation has not changed. The next weekly rebalance will incorporate the regime move.</p>
    """
    return send_email(
        subject=f"[MacroTilt] Regime watch — R&L moved {regime_alert.get('rl_delta_since_rebalance'):+.1f} since last rebalance",
        html_body=body,
    )
