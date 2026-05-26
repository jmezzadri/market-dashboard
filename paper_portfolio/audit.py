"""
paper_portfolio.audit — writers for paper_signal_capture + paper_orders.

Two responsibilities:

  1. write_signal_capture(...) — one row per translator run, carries the
     signal payload JSON (Asset Tilt snapshot summary + scanner sample)
     and a count of orders triggered. The Phase 4 execution layer can
     replay any historical run from these rows.

  2. write_order_intents(...) — one row per OrderIntent in paper_orders
     with status='pending'. Phase 2 NEVER writes status='submitted' or
     above; that's Phase 4's job.

All writes use service-role auth via the Supabase Management API. The
translator service is single-tenant (Joe's paper account only).
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Iterable

import requests

from paper_portfolio.diff import OrderIntent
from paper_portfolio.signals import AssetTiltSnapshot, EquityScannerSnapshot

PROJECT_REF = "yqaqqzseepebrocgibcw"


def _supabase_exec(sql: str) -> None:
    """Run a non-returning SQL statement (INSERT/UPDATE) via the Management API."""
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError(
            "SUPABASE_ACCESS_TOKEN must be set to write paper_orders rows."
        )
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"query": sql},
        timeout=30,
    )
    resp.raise_for_status()


def _sql_escape(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def _sql_jsonb(payload: dict) -> str:
    return "'" + json.dumps(payload).replace("'", "''") + "'::jsonb"


def write_signal_capture(
    signal_source: str,             # 'asset_tilt' or 'equity_scanner'
    signal_payload: dict,
    triggered_orders_count: int,
    captured_at: datetime | None = None,
) -> str:
    """Insert one paper_signal_capture row, return the generated UUID."""
    if signal_source not in ("asset_tilt", "equity_scanner"):
        raise ValueError(f"invalid signal_source: {signal_source}")
    cap_id = str(uuid.uuid4())
    ts = (captured_at or datetime.now(tz=timezone.utc)).isoformat()
    sql = (
        "insert into public.paper_signal_capture "
        "(id, captured_at, signal_source, signal_payload, triggered_orders_count) "
        f"values ('{cap_id}', '{ts}', '{signal_source}', "
        f"{_sql_jsonb(signal_payload)}, {int(triggered_orders_count)});"
    )
    _supabase_exec(sql)
    return cap_id


def write_order_intents(intents: Iterable[OrderIntent]) -> int:
    """Insert each OrderIntent into paper_orders with status='pending'.

    Returns the number of rows written. Phase 2 NEVER sets status beyond
    'pending' and NEVER writes alpaca_order_id — those are Phase 4 fields.
    """
    intents = list(intents)
    if not intents:
        return 0

    values_sql: list[str] = []
    for o in intents:
        qty_sql = "NULL" if o.target_quantity is None else f"{o.target_quantity}"
        score_sql = "NULL" if o.signal_score is None else f"{int(o.signal_score)}"
        values_sql.append(
            "("
            f"gen_random_uuid(), now(), "
            f"{_sql_escape(o.sleeve)}, "
            f"{_sql_escape(o.ticker)}, "
            f"{_sql_escape(o.side)}, "
            f"'market_on_open', "
            f"{qty_sql}, "
            f"{o.target_notional}, "
            f"{score_sql}, "
            f"{_sql_escape(o.signal_source)}, "
            f"{_sql_escape(o.rebalance_trigger_reason)}, "
            f"'pending'"
            ")"
        )

    sql = (
        "insert into public.paper_orders "
        "(id, created_at, sleeve, ticker, side, order_type, target_quantity, "
        " target_notional, signal_score, signal_source, rebalance_trigger_reason, status) "
        "values " + ", ".join(values_sql) + ";"
    )
    _supabase_exec(sql)
    return len(intents)


def build_audit_payload(
    asset_tilt: AssetTiltSnapshot,
    scanner: EquityScannerSnapshot,
    sleeve_a_summary: dict,
    sleeve_b_summary: dict,
) -> dict:
    """Pack a compact JSON payload for paper_signal_capture.signal_payload.

    Keeps the row size small (<10 KB typical) by including only the IG
    list (24 rows) and the top-25 scanner sample, plus the sleeve summaries.
    """
    return {
        "asset_tilt": {
            "as_of": asset_tilt.as_of,
            "engine_version": asset_tilt.engine_version,
            "equity_pct": asset_tilt.equity_pct,
            "industry_groups": [
                {
                    "id": ig.ig_id,
                    "name": ig.name,
                    "sector": ig.sector,
                    "primary_etf": ig.primary_etf,
                    "weight_pct": ig.weight_pct,
                    "rating": ig.rating,
                }
                for ig in asset_tilt.industry_groups
            ],
        },
        "equity_scanner": {
            "scan_date": scanner.scan_date,
            "qualifying_signals_count": len(scanner.signals),
            "all_rows_count": scanner.all_count,
            "top_25_sample": scanner.raw_payload_sample,
            "qualifying_signals": [
                {"ticker": s.ticker, "mt_score": s.mt_score,
                 "buy_score": s.buy_score, "band": s.band}
                for s in scanner.signals
            ],
        },
        "sleeve_a_summary": sleeve_a_summary,
        "sleeve_b_summary": sleeve_b_summary,
    }
