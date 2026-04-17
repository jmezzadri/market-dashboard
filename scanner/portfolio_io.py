"""Load portfolio CSVs (read-only)."""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from config import PROJECT_ROOT

logger = logging.getLogger(__name__)

PORTFOLIO_DIR = PROJECT_ROOT / "portfolio"


def load_portfolio_positions(path: Path | None = None) -> list[dict[str, Any]]:
    """Read portfolio/positions.csv. Returns [] if missing or empty."""
    p = path or PORTFOLIO_DIR / "positions.csv"
    if not p.exists():
        return []
    try:
        df = pd.read_csv(p)
    except Exception as e:
        logger.warning("Could not read %s: %s", p, e)
        return []
    if df.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        ticker = str(row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        try:
            shares = int(float(row.get("shares") or 0))
        except (TypeError, ValueError):
            shares = 0
        ac = row.get("avg_cost")
        try:
            avg_cost = float(ac) if ac is not None and str(ac).strip() != "" else None
        except (TypeError, ValueError):
            avg_cost = None
        ed = row.get("entry_date")
        entry_date: date | None = None
        if ed is not None and str(ed).strip() != "" and str(ed).strip().lower() != "nan":
            try:
                entry_date = datetime.strptime(str(ed).strip()[:10], "%Y-%m-%d").date()
            except ValueError:
                entry_date = None
        out.append(
            {
                "ticker": ticker,
                "shares": shares,
                "avg_cost": avg_cost,
                "entry_date": entry_date,
                "notes": str(row.get("notes") or ""),
            }
        )
    return out


def load_watchlist(path: Path | None = None) -> list[dict[str, Any]]:
    """Read portfolio/watchlist.csv. Manual list of tickers Joe is tracking but
    doesn't (yet) hold. These tickers should always get Congress / Insider /
    Flow / Technical intel pulled, regardless of whether they appear in the UW
    bulk signal sources or pass the buy/watch score thresholds."""
    p = path or PORTFOLIO_DIR / "watchlist.csv"
    if not p.exists():
        return []
    try:
        df = pd.read_csv(p)
    except Exception as e:
        logger.warning("Could not read %s: %s", p, e)
        return []
    if df.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        ticker = str(row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        out.append(
            {
                "ticker": ticker,
                "name": str(row.get("name") or "").strip(),
                "theme": str(row.get("theme") or "").strip(),
                "notes": str(row.get("notes") or "").strip(),
            }
        )
    return out


def load_covered_calls(path: Path | None = None) -> list[dict[str, Any]]:
    """Read portfolio/covered_calls.csv."""
    p = path or PORTFOLIO_DIR / "covered_calls.csv"
    if not p.exists():
        return []
    try:
        df = pd.read_csv(p)
    except Exception as e:
        logger.warning("Could not read %s: %s", p, e)
        return []
    if df.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        t = str(row.get("ticker") or "").strip().upper()
        if not t:
            continue
        try:
            strike = float(row.get("strike") or 0)
        except (TypeError, ValueError):
            continue
        exp_s = str(row.get("expiry") or "").strip()[:10]
        if not exp_s:
            continue
        try:
            prem = float(row.get("premium_received") or 0)
        except (TypeError, ValueError):
            prem = 0.0
        try:
            contracts = int(float(row.get("contracts") or 1))
        except (TypeError, ValueError):
            contracts = 1
        ed = row.get("entry_date")
        entry_date: date | None = None
        if ed is not None and str(ed).strip() and str(ed).strip().lower() != "nan":
            try:
                entry_date = datetime.strptime(str(ed).strip()[:10], "%Y-%m-%d").date()
            except ValueError:
                entry_date = None
        out.append(
            {
                "ticker": t,
                "contracts": contracts,
                "strike": strike,
                "expiry": exp_s,
                "premium_received": prem,
                "entry_date": entry_date,
                "notes": str(row.get("notes") or ""),
            }
        )
    return out
