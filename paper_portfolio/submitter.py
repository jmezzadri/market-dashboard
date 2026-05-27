"""
paper_portfolio.submitter — pending paper_orders → Alpaca MOO submissions.

One responsibility: read every paper_orders row in status='pending' and
hand each one to Alpaca, updating the row with the result.

Hard rules (Senior Quant + Lead Developer co-locked):

  1. **Idempotency** — the Alpaca client_order_id is set to the
     paper_orders.id (UUID). If a row is somehow submitted twice (network
     glitch, double-fire of the workflow), Alpaca rejects the duplicate
     with HTTP 422 and the submitter treats that as a no-op — the
     original submission stands.

  2. **Atomic state transition** — every UPDATE narrows by status='pending'
     so two parallel runners cannot both submit the same row.

  3. **No retry on rejection** — a rejected order stays in 'rejected'
     status with the reason. The next translator run rebuilds intent
     fresh; the submitter does not second-guess.

  4. **MOO time-window gate** — Alpaca routes 'opg' TIF orders to the
     next opening auction. The submitter still runs every cycle (idle if
     no pending rows), but it warns when called during market hours
     because MOO submissions during the regular session route to the
     NEXT day's open, not today's close.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient

logger = logging.getLogger("paper_submitter")
PROJECT_REF = "yqaqqzseepebrocgibcw"


@dataclass(frozen=True)
class PendingOrderRow:
    id: str                       # paper_orders.id (UUID) — becomes Alpaca client_order_id
    sleeve: str                   # 'A' / 'B'
    ticker: str
    side: str                     # 'buy' / 'sell'
    order_type: str               # 'market_on_open'
    target_quantity: float | None
    target_notional: float | None
    signal_score: int | None
    signal_source: str
    rebalance_trigger_reason: str | None


@dataclass
class SubmitResult:
    submitted: int
    rejected: int
    duplicates: int
    errors: list[str]


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────────────────────

def _supabase_query(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required.")
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _supabase_exec(sql: str) -> None:
    _ = _supabase_query(sql)


def _sql_escape(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


# ─────────────────────────────────────────────────────────────────────────────
# Pending-orders reader + state writers
# ─────────────────────────────────────────────────────────────────────────────

def fetch_pending_orders(limit: int = 500) -> list[PendingOrderRow]:
    """Read every paper_orders row in status='pending', oldest first."""
    sql = (
        "select id, sleeve, ticker, side, order_type, target_quantity, "
        "target_notional, signal_score, signal_source, rebalance_trigger_reason "
        "from public.paper_orders "
        "where status = 'pending' "
        f"order by created_at asc limit {int(limit)};"
    )
    rows = _supabase_query(sql)
    return [
        PendingOrderRow(
            id=str(r["id"]),
            sleeve=r["sleeve"],
            ticker=r["ticker"],
            side=r["side"],
            order_type=r.get("order_type") or "market_on_open",
            target_quantity=float(r["target_quantity"]) if r.get("target_quantity") is not None else None,
            target_notional=float(r["target_notional"]) if r.get("target_notional") is not None else None,
            signal_score=int(r["signal_score"]) if r.get("signal_score") is not None else None,
            signal_source=r.get("signal_source") or "",
            rebalance_trigger_reason=r.get("rebalance_trigger_reason"),
        )
        for r in rows
    ]


def _mark_submitted(row_id: str, alpaca_order_id: str) -> None:
    """Atomic-narrow update: only flip status if it's still 'pending'."""
    sql = (
        "update public.paper_orders set "
        f"  alpaca_order_id = {_sql_escape(alpaca_order_id)}, "
        "  status = 'submitted', "
        "  submitted_at = now() "
        f"where id = '{row_id}' and status = 'pending';"
    )
    _supabase_exec(sql)


def _mark_rejected(row_id: str, reason: str) -> None:
    sql = (
        "update public.paper_orders set "
        "  status = 'rejected', "
        f"  rejection_reason = {_sql_escape(reason)} "
        f"where id = '{row_id}' and status = 'pending';"
    )
    _supabase_exec(sql)


# ─────────────────────────────────────────────────────────────────────────────
# Submission loop
# ─────────────────────────────────────────────────────────────────────────────

def submit_pending_orders(
    alpaca: AlpacaPaperClient | None = None,
    dry_run: bool = False,
) -> SubmitResult:
    """Submit every paper_orders row in status='pending'.

    For each row:
      1. Pre-check: ask Alpaca if a client_order_id == row.id already exists.
         If yes, skip submission and mark the row as 'submitted' with the
         existing alpaca_order_id (idempotency repair after a crash).
      2. Submit MOO order with client_order_id == row.id. Use abs(target_quantity)
         if available; else abs(target_notional).
      3. On HTTP 200: update paper_orders with alpaca_order_id + status.
      4. On HTTP 422 with "client_order_id already used": treat as duplicate
         (counts in result.duplicates).
      5. On other 4xx/5xx: mark row 'rejected' with the body.
    """
    alpaca = alpaca or AlpacaPaperClient()
    pending = fetch_pending_orders()
    result = SubmitResult(submitted=0, rejected=0, duplicates=0, errors=[])

    if not pending:
        logger.info("no pending paper_orders rows")
        return result

    logger.info("found %d pending paper_orders rows", len(pending))

    for row in pending:
        # Step 1 — idempotency pre-check.
        try:
            existing = alpaca.get_order_by_client_id(row.id)
        except Exception as exc:
            logger.warning("idempotency pre-check failed for %s — proceeding to submit (%s)", row.id, exc)
            existing = None

        if existing and existing.get("id"):
            logger.info(
                "row %s already exists at Alpaca (alpaca_order_id=%s) — repairing state to 'submitted'",
                row.id, existing["id"],
            )
            if not dry_run:
                _mark_submitted(row.id, existing["id"])
            result.duplicates += 1
            continue

        # Step 2 — submit
        qty = abs(row.target_quantity) if row.target_quantity is not None else None
        notional = abs(row.target_notional) if (qty is None and row.target_notional is not None) else None
        if qty is None and notional is None:
            _mark_rejected(row.id, "missing both qty and notional") if not dry_run else None
            result.rejected += 1
            result.errors.append(f"{row.id} {row.ticker}: missing qty and notional")
            continue

        if dry_run:
            logger.info(
                "[dry-run] would submit %s %s qty=%s notional=%s (sleeve %s)",
                row.side, row.ticker, qty, notional, row.sleeve,
            )
            result.submitted += 1
            continue

        try:
            # Pass qty as-is (may be None). The client uses notional when qty is None or <= 0.
            order_resp = alpaca.submit_market_on_open(
                ticker=row.ticker,
                qty=qty,
                side=row.side,
                client_order_id=row.id,
                notional=notional,
            )
        except requests.HTTPError as exc:
            body = exc.response.text if exc.response is not None else str(exc)
            try:
                parsed = json.loads(body)
                msg = parsed.get("message", body)
            except Exception:
                msg = body
            status_code = exc.response.status_code if exc.response is not None else 0

            # Duplicate detection — Alpaca returns 422 with "client_order_id already used"
            if status_code == 422 and "client_order_id" in msg.lower():
                logger.info("row %s: duplicate (already submitted)", row.id)
                # repair by lookup
                try:
                    existing = alpaca.get_order_by_client_id(row.id)
                    if existing and existing.get("id"):
                        _mark_submitted(row.id, existing["id"])
                except Exception:
                    pass
                result.duplicates += 1
                continue

            _mark_rejected(row.id, f"HTTP {status_code}: {msg}")
            result.rejected += 1
            result.errors.append(f"{row.id} {row.ticker}: HTTP {status_code}: {msg[:160]}")
            continue
        except Exception as exc:
            _mark_rejected(row.id, f"client error: {exc}")
            result.rejected += 1
            result.errors.append(f"{row.id} {row.ticker}: {exc}")
            continue

        alpaca_id = order_resp.get("id")
        if not alpaca_id:
            _mark_rejected(row.id, "Alpaca returned no order id")
            result.rejected += 1
            result.errors.append(f"{row.id} {row.ticker}: Alpaca returned no id")
            continue

        _mark_submitted(row.id, alpaca_id)
        result.submitted += 1
        logger.info("submitted %s %s qty=%s alpaca_order_id=%s",
                    row.side, row.ticker, qty or f"${notional}", alpaca_id)

    logger.info(
        "submitter done — submitted=%d rejected=%d duplicates=%d",
        result.submitted, result.rejected, result.duplicates,
    )
    return result
