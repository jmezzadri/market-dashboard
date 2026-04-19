"""
Index-membership loaders for the wide-universe technicals scan.

Sources (no API key required):
  - S&P 500      : Wikipedia "List of S&P 500 companies"
  - Nasdaq 100   : Wikipedia "Nasdaq-100"
  - Dow 30       : Wikipedia "Dow Jones Industrial Average"
  - Russell 2000 : iShares IWM holdings CSV (opt-in — ~2000 names, slow)

Index membership changes slowly (weekly at most for S&P / Nasdaq). We cache
results to reports/index_membership.json per calendar date so repeated scans
on the same day don't re-fetch Wikipedia.

Each loader is defensive — on network/parse failure it returns an empty list
and logs a warning. The caller unions across sources, so one broken fetch
degrades universe size rather than breaking the scan.
"""

from __future__ import annotations

import datetime as _dt
import io
import json as _json
import logging
import re
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; MacroTiltScanner/1.0; "
        "+https://github.com/macrotilt/trading-scanner)"
    )
}

# Cache on the trading-scanner repo root (same place reports/ lives).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CACHE_PATH = _PROJECT_ROOT / "reports" / "index_membership.json"

_SYM_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,6}$")


def _clean_symbols(syms: Iterable[str]) -> list[str]:
    """Normalize index-provider tickers: Wikipedia uses BRK.B, yfinance uses BRK-B."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in syms:
        if not raw:
            continue
        s = str(raw).strip().upper().replace(".", "-")
        if not _SYM_RE.match(s):
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _fetch_wikipedia_table(url: str, table_idx: int = 0, symbol_col: str | None = None) -> list[str]:
    """Pull the first table of Wikipedia page and return the symbol column."""
    try:
        r = requests.get(url, headers=_UA, timeout=20)
        r.raise_for_status()
        tables = pd.read_html(io.StringIO(r.text))
    except Exception as e:
        logger.warning("Wikipedia fetch failed for %s: %s", url, e)
        return []

    if not tables or table_idx >= len(tables):
        logger.warning("Wikipedia fetch: no table at index %d for %s", table_idx, url)
        return []

    df = tables[table_idx]
    # Try common column names first; fall back to any column that looks
    # ticker-like (short strings, all-caps-ish).
    candidate_cols = [symbol_col] if symbol_col else []
    candidate_cols += ["Symbol", "Ticker", "Ticker symbol", "Code"]
    col = None
    for c in candidate_cols:
        if c and c in df.columns:
            col = c
            break
    if col is None:
        # Heuristic: find a column whose string values mostly look like tickers.
        for c in df.columns:
            sample = df[c].astype(str).head(20).tolist()
            hits = sum(1 for v in sample if _SYM_RE.match(v.strip().upper().replace(".", "-")))
            if hits >= 10:
                col = c
                break

    if col is None:
        logger.warning("Wikipedia fetch: no ticker column found for %s", url)
        return []

    return _clean_symbols(df[col].astype(str).tolist())


def fetch_sp500() -> list[str]:
    return _fetch_wikipedia_table(
        "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        table_idx=0,
        symbol_col="Symbol",
    )


def fetch_nasdaq100() -> list[str]:
    # Nasdaq-100 constituents are in a later table on the page — try a few
    # indices until one yields ticker-shaped data.
    url = "https://en.wikipedia.org/wiki/Nasdaq-100"
    try:
        r = requests.get(url, headers=_UA, timeout=20)
        r.raise_for_status()
        tables = pd.read_html(io.StringIO(r.text))
    except Exception as e:
        logger.warning("Nasdaq-100 fetch failed: %s", e)
        return []
    for t in tables:
        for col in ("Ticker", "Symbol"):
            if col in t.columns:
                syms = _clean_symbols(t[col].astype(str).tolist())
                if len(syms) >= 90:  # Nasdaq-100 has ~101 names
                    return syms
    logger.warning("Nasdaq-100: could not locate constituents table")
    return []


def fetch_dow30() -> list[str]:
    url = "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average"
    try:
        r = requests.get(url, headers=_UA, timeout=20)
        r.raise_for_status()
        tables = pd.read_html(io.StringIO(r.text))
    except Exception as e:
        logger.warning("Dow 30 fetch failed: %s", e)
        return []
    for t in tables:
        for col in ("Symbol", "Ticker"):
            if col in t.columns:
                syms = _clean_symbols(t[col].astype(str).tolist())
                if 25 <= len(syms) <= 40:
                    return syms
    logger.warning("Dow 30: could not locate constituents table")
    return []


def fetch_russell2000() -> list[str]:
    """
    Russell 2000 via iShares IWM holdings CSV. Opt-in because the universe is
    ~2000 names and the batch yfinance fetch for their OHLCV dominates scan
    runtime.
    """
    url = (
        "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
        "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
    )
    try:
        r = requests.get(url, headers=_UA, timeout=45)
        r.raise_for_status()
        # iShares CSV has preamble rows before the real header. Scan for the
        # line beginning with 'Ticker,'.
        text = r.text
        lines = text.splitlines()
        start = None
        for i, ln in enumerate(lines):
            if ln.lstrip().startswith("Ticker"):
                start = i
                break
        if start is None:
            logger.warning("Russell 2000: could not locate header row in iShares CSV")
            return []
        df = pd.read_csv(io.StringIO("\n".join(lines[start:])))
    except Exception as e:
        logger.warning("Russell 2000 fetch failed: %s", e)
        return []

    col = "Ticker" if "Ticker" in df.columns else None
    if col is None:
        logger.warning("Russell 2000: Ticker column missing in iShares CSV")
        return []

    # iShares holdings include cash sleeves ('-', 'USD', 'SGOV', etc.). The
    # symbol regex + downstream liquidity gate will throw these out, but we
    # also drop obvious non-equity asset classes when the column is present.
    if "Asset Class" in df.columns:
        df = df[df["Asset Class"].astype(str).str.strip().str.lower() == "equity"]
    return _clean_symbols(df[col].astype(str).tolist())


def build_index_universe(include_russell_2000: bool = False) -> dict[str, list[str]]:
    """
    Return a dict of index → tickers (pre-dedup). Cached by calendar date.

    Shape:
      { "sp500": [...], "nasdaq100": [...], "dow30": [...], "russell2000": [...] }
    """
    today = _dt.date.today().isoformat()
    if _CACHE_PATH.exists():
        try:
            cached = _json.loads(_CACHE_PATH.read_text())
            if cached.get("date") == today and isinstance(cached.get("indices"), dict):
                # Respect opt-in: if we cached without R2000 but the caller
                # now wants it, fall through and rebuild. If we cached with
                # it and caller does not want it, still return the cache
                # (the caller can slice).
                have_r2k = bool(cached["indices"].get("russell2000"))
                if include_russell_2000 and not have_r2k:
                    pass
                else:
                    logger.info("Using cached index membership (%s)", today)
                    return cached["indices"]
        except Exception as e:
            logger.debug("Index membership cache read failed: %s", e)

    logger.info("Fetching index membership (S&P 500, Nasdaq 100, Dow 30%s)",
                ", Russell 2000" if include_russell_2000 else "")
    indices = {
        "sp500": fetch_sp500(),
        "nasdaq100": fetch_nasdaq100(),
        "dow30": fetch_dow30(),
        "russell2000": fetch_russell2000() if include_russell_2000 else [],
    }

    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(_json.dumps({
            "date": today,
            "indices": indices,
        }, indent=2))
    except Exception as e:
        logger.debug("Index membership cache write failed: %s", e)

    return indices


def deduped_universe(indices: dict[str, list[str]]) -> list[str]:
    """Union of all index constituents, deduped, sorted."""
    seen: set[str] = set()
    for syms in indices.values():
        for s in syms or []:
            seen.add(s)
    return sorted(seen)
