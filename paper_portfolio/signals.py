"""
paper_portfolio.signals — signal source readers.

Sleeve A signal source: public/v10_allocation.json (the live Asset Tilt
engine output that the React Asset Tilt page renders from). Has 24
industry-group entries; each entry carries a `dollar` field (= weight %
× 100, sums to 100 across all IGs when equity_pct == 1.0) and a `tickers`
list. We use `tickers[0]` as the calibration ETF for each IG (the file's
ordering is the engine's preferred primary).

Sleeve B signal source: public.trading_opps_signals — the scanner the
Trading Opportunities page renders from. score field is already on a 0–10
scale (raised from 5 to 10 on 2026-05-21 when dark-pool + options layers
went live; current data still caps at 5 until those layers surface). We
filter on direction='long' (Sleeve B is long-only by spec) and
signal='BUY · LONG' (the producer also emits WATCHLIST rows we ignore).

Buy threshold and tier sizes (per locked Joe spec):
    buy_score ≥ 5 : buy (≥ 5 is the launch + size threshold)
    9 ≤ buy_score ≤ 10 : tier 1, $50K per name
    7 ≤ buy_score < 9  : tier 2, $40K per name
    5 ≤ buy_score < 7  : tier 3, $30K per name

CHANGED 2026-05-27: previous version read signal_intel_v5_daily (mt_score
on -100..+100). Joe flagged the mismatch with what the page shows; today's
fix aligns Sleeve B to the same scanner that drives the user-visible
Trading Opps surface.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

PROJECT_REF = "yqaqqzseepebrocgibcw"


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve A — Asset Tilt IG signals from v10_allocation.json
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AssetTiltIG:
    ig_id: str               # e.g. 'semis'
    name: str                # e.g. 'Semiconductors'
    sector: str              # e.g. 'Information Technology'
    primary_etf: str         # first ticker in the engine's tickers list
    weight_pct: float        # 0.0987 means 9.87% of equity-sleeve
    rating: str              # 'OW' / 'MW' / 'UW'


@dataclass(frozen=True)
class AssetTiltSnapshot:
    as_of: str               # e.g. '2026-05-25'
    engine_version: str      # e.g. 'v10.2'
    equity_pct: float        # 1.0 means full equity; 0.7 means 30% defensive
    industry_groups: list[AssetTiltIG]
    raw: dict[str, Any]      # the entire allocation dict for downstream audit


def load_asset_tilt_snapshot(
    allocation_path: str | Path = "public/v10_allocation.json",
) -> AssetTiltSnapshot:
    """Load the canonical Asset Tilt allocation snapshot.

    Default path is repo-relative; pass an absolute path for tests / replay.
    """
    p = Path(allocation_path)
    if not p.exists():
        raise FileNotFoundError(
            f"Asset Tilt allocation file not found at {p}. The translator "
            "requires the live Asset Tilt engine output."
        )
    with open(p) as f:
        d = json.load(f)

    igs: list[AssetTiltIG] = []
    for row in d.get("industry_groups", []):
        tickers = row.get("tickers") or []
        if not tickers:
            # Skip any IG without an ETF mapping — surfaced upstream by
            # the engine validation layer; the translator does not silently
            # default to anything else.
            continue
        igs.append(AssetTiltIG(
            ig_id=row["id"],
            name=row["name"],
            sector=row["sector"],
            primary_etf=tickers[0],
            weight_pct=float(row.get("dollar", 0.0)) / 100.0,  # dollar field is %, /100 → fraction
            rating=row.get("rating", "MW"),
        ))

    return AssetTiltSnapshot(
        as_of=d.get("as_of", ""),
        engine_version=d.get("version", ""),
        equity_pct=float(d.get("equity_pct", 1.0)),
        industry_groups=igs,
        raw=d,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve B — Equity Scanner buy signals from signal_intel_v5_daily
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EquitySignal:
    ticker: str
    mt_score: float          # raw scanner score on [-100, +100]
    buy_score: float         # normalized 0–10 buy-side scale
    band: str                # 'Strong Buy' / 'Watch Buy' / 'Neutral' / ...
    scan_date: str


@dataclass(frozen=True)
class EquityScannerSnapshot:
    scan_date: str
    signals: list[EquitySignal]    # ONLY signals with buy_score >= buy_threshold
    all_count: int                 # total rows on scan_date for sanity
    raw_payload_sample: list[dict[str, Any]]  # first 25 rows, for audit


def _normalize_buy_score(score: float | None) -> float:
    """trading_opps_signals.score is already on a 0–10 scale (score ceiling
    raised from 5 to 10 on 2026-05-21 when dark-pool + options layers came
    live; current data caps at 5 until those layers surface higher scores).
    Long-only: clamp negatives to 0."""
    if score is None:
        return 0.0
    return max(0.0, float(score))


def _supabase_query(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError(
            "SUPABASE_ACCESS_TOKEN must be set to read signal_intel_v5_daily."
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
    return resp.json()


def load_equity_scanner_snapshot(
    scan_date: str | None = None,
    buy_threshold: float = 5.0,
) -> EquityScannerSnapshot:
    """Read the latest scan (or the named scan_date) from signal_intel_v5_daily.

    Returns only rows whose normalized buy_score >= buy_threshold. The
    audit_payload_sample carries the top 25 rows of the source scan so the
    translator can persist a useful slice in paper_signal_capture without
    blowing up the JSONB size.
    """
    if scan_date is None:
        # Pick the most recent scan_date with data.
        latest = _supabase_query(
            "select max(scan_date)::text as scan_date "
            "from public.trading_opps_signals;"
        )
        scan_date = latest[0]["scan_date"] if latest and latest[0]["scan_date"] else None
        if not scan_date:
            raise RuntimeError("trading_opps_signals has no rows.")

    # CHANGED 2026-05-27: source switched from signal_intel_v5_daily to
    # trading_opps_signals — the scanner the user sees on /#portopps. The
    # v5 scanner had a -100..+100 score scale we were normalizing; the
    # trading_opps scanner is already on a 0–10 scale. We also filter
    # to direction='long' (Sleeve B is long-only by spec) and to
    # signal='BUY · LONG' so we only act on launched-name buys (the
    # producer also writes WATCHLIST rows we should ignore).
    rows = _supabase_query(
        "select scan_date::text as scan_date, ticker, score, signal, direction "
        "from public.trading_opps_signals "
        f"where scan_date = '{scan_date}' "
        "and direction = 'long' "
        "and signal = 'BUY · LONG' "
        "order by score desc nulls last;"
    )
    signals: list[EquitySignal] = []
    for r in rows:
        score = r.get("score")
        bs = _normalize_buy_score(score)
        if bs >= buy_threshold:
            signals.append(EquitySignal(
                ticker=r["ticker"],
                mt_score=float(score) * 10.0 if score is not None else 0.0,  # rescaled for downstream code that thought it was -100..+100
                buy_score=bs,
                band=r.get("signal", "BUY · LONG"),
                scan_date=r["scan_date"],
            ))

    return EquityScannerSnapshot(
        scan_date=scan_date,
        signals=signals,
        all_count=len(rows),
        raw_payload_sample=rows[:25],
    )
