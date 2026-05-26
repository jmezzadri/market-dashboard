"""
Options end-of-day ingest — UW per-ticker options feed -> options_eod_daily.

Part of Phase 1 of the Trading Opportunities overhaul
(TRADING_OPPS_OVERHAUL_PLAN_2026-05-20.md). Produces one row per
(ticker, as_of_date) carrying:

  Scoring inputs (feed the rebuilt screener's options layer, spec Sec. 7)
    best_call_vol_oi / best_put_vol_oi  — strongest "fresh positioning"
        multiple (today's volume vs. prior open interest) in the chain.
    contracts (jsonb)                   — per-contract detail for the
        Phase 2 engine + backtest: a 7-60 DTE superset so the backtest can
        move its 14-45 DTE candidate window without a re-ingest.

  Informational metrics (feed the Group-3 options columns, spec Sec. 12.4)
    put_call_ratio, net_premium, atm_iv, implied_move_7d / 30d,
    realized_vol_30d, call_volume, put_volume.

Per-ticker calls (UW streams these per-ticker, not in bulk):
    /stock/{t}/option-contracts        per-contract volume / OI / greeks
    /stock/{t}/options-volume          day call/put volume + premium split
    /stock/{t}/volatility/realized     ATM implied vol + realized vol + spot
    /stock/{t}/volatility/term-structure   implied move by expiry

Note on `oi-change`: that endpoint returns only a ranked subset of
contracts. option-contracts already carries `prev_oi` for every contract,
which is all the "volume vs. prior OI" math needs — so oi-change is not
called.

Contract delta is computed Black-Scholes from the contract's implied
volatility (option-contracts has no delta field): for a call,
delta = N(d1) with d1 = [ln(S/K) + (r + sigma^2/2)*T] / (sigma*sqrt(T));
for a put, delta = N(d1) - 1. N is the standard normal CDF, evaluated via
the error function N(x) = 0.5*(1 + erf(x / sqrt(2))) — no SciPy dependency.
S = spot, K = strike, T = years to expiry, sigma = implied vol, r = the
risk-free rate. These contracts are short-dated (7-60 DTE) so the choice
of r and the omission of dividend yield are immaterial to delta.

Service-only table (Pattern C). No front-end tile reads options_eod_daily
directly; the Phase 2 screener engine reads it.

Resume-friendly via --max-seconds. Idempotent UPSERT on (ticker, as_of_date).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from datetime import date, datetime, timezone
from typing import Any

import requests
import uuid
from scanner.api_usage_helper import log_run_summary

from scanner.trading_opps.universe import build_screener_candidate_universe


UW_BASE = "https://api.unusualwhales.com/api"
TABLE = "options_eod_daily"

# Contract storage window — the migration's "7-60 DTE superset".
MIN_DTE, MAX_DTE = 7, 60
# Moneyness band for the stored superset: strikes within +/-35% of spot.
# Comfortably contains the spec's CANDIDATE delta 0.35-0.50 window and any
# plausible alternative the Phase 2 backtest might test.
MONEYNESS_LO, MONEYNESS_HI = 0.65, 1.35
# Hard cap on stored contracts per ticker (keep the nearest-the-money ones).
MAX_STORED_CONTRACTS = 1500
# A contract needs at least this much prior open interest to qualify for
# the best_*_vol_oi headline — guards against a near-zero OI denominator
# turning a handful of contracts into a meaningless "infinite" multiple.
MIN_OI_FOR_BEST = 100
# Risk-free rate for the Black-Scholes delta. Delta is only weakly
# sensitive to r over a 7-60 day horizon.
RISK_FREE_RATE = 0.043

PAGE_LIMIT = 500          # UW option-contracts page size (endpoint max)
MAX_CONTRACT_PAGES = 12   # safety cap per option_type
SLEEP_PER_CALL = 0.30


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _uw_headers() -> dict[str, str]:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY", "")
    if not key:
        raise RuntimeError("UNUSUAL_WHALES_API_KEY is not set")
    return {
        "Authorization": f"Bearer {key}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
        "Accept": "application/json",
    }


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _uw_get(path: str, params: dict[str, Any] | None = None,
            retries: int = 3) -> list[dict[str, Any]]:
    """GET a UW endpoint, returning the `data` list. Retries 429 with backoff."""
    url = f"{UW_BASE}{path}"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=_uw_headers(), params=params or {}, timeout=30)
        except requests.RequestException:
            if attempt < retries:
                time.sleep(1.5 ** attempt)
                continue
            return []
        if r.status_code == 429 and attempt < retries:
            time.sleep(2.0 ** attempt)
            continue
        if r.status_code != 200:
            return []
        body = r.json() or {}
        data = body.get("data")
        return data if isinstance(data, list) else []
    return []


# ── value coercion ───────────────────────────────────────────────────────────

def _f(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    f = _f(v)
    return int(f) if f is not None else None


# ── OCC option-symbol parsing ────────────────────────────────────────────────

_OCC_RE = re.compile(r"^([A-Z][A-Z0-9]{0,5})(\d{6})([CP])(\d{8})$")


def _parse_occ(symbol: str) -> dict[str, Any] | None:
    """Parse an OCC symbol like AAPL260619C00300000 -> type / strike / expiry."""
    m = _OCC_RE.match(str(symbol).strip().upper())
    if not m:
        return None
    _, ymd, cp, strike_str = m.groups()
    try:
        expiry = datetime.strptime(ymd, "%y%m%d").date()
    except ValueError:
        return None
    return {
        "type": "call" if cp == "C" else "put",
        "strike": int(strike_str) / 1000.0,
        "expiry": expiry,
    }


# ── Black-Scholes delta ──────────────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    """Standard normal CDF via the error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_delta(opt_type: str, spot: float | None, strike: float,
             iv: float | None, dte: int) -> float | None:
    """
    Black-Scholes delta. Returns None when an input is missing or degenerate.
    call: N(d1); put: N(d1) - 1.
    """
    if spot is None or spot <= 0 or strike <= 0 or iv is None or iv <= 0 or dte <= 0:
        return None
    T = dte / 365.0
    sigma_root_t = iv * math.sqrt(T)
    if sigma_root_t <= 0:
        return None
    d1 = (math.log(spot / strike) + (RISK_FREE_RATE + 0.5 * iv * iv) * T) / sigma_root_t
    n_d1 = _norm_cdf(d1)
    delta = n_d1 if opt_type == "call" else n_d1 - 1.0
    return round(delta, 4)


# ── per-ticker fetch ─────────────────────────────────────────────────────────

def fetch_contracts(ticker: str, opt_type: str) -> list[dict[str, Any]]:
    """Page through option-contracts for one ticker + option type."""
    sym = ticker.strip().upper()
    rows: list[dict[str, Any]] = []
    for page in range(MAX_CONTRACT_PAGES):
        batch = _uw_get(
            f"/stock/{sym}/option-contracts",
            {"option_type": opt_type, "limit": PAGE_LIMIT,
             "page": page, "exclude_zero_dte": "true"},
        )
        time.sleep(SLEEP_PER_CALL)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_LIMIT:
            break
    return rows


def _term_structure_implied_move(rows: list[dict[str, Any]],
                                 target_dte: int) -> float | None:
    """Linear-interpolate the dollar implied move at target_dte from the
    UW volatility/term-structure rows (one row per expiry)."""
    pts = sorted(
        ((_i(r.get("dte")), _f(r.get("implied_move")))
         for r in rows
         if _i(r.get("dte")) is not None and _f(r.get("implied_move")) is not None),
        key=lambda p: p[0],
    )
    if not pts:
        return None
    if target_dte <= pts[0][0]:
        return round(pts[0][1], 4)
    if target_dte >= pts[-1][0]:
        return round(pts[-1][1], 4)
    for (d0, m0), (d1, m1) in zip(pts, pts[1:]):
        if d0 <= target_dte <= d1:
            if d1 == d0:
                return round(m0, 4)
            frac = (target_dte - d0) / (d1 - d0)
            return round(m0 + frac * (m1 - m0), 4)
    return round(pts[-1][1], 4)


def build_row(ticker: str, as_of: date) -> dict[str, Any] | None:
    """Assemble one options_eod_daily row for a ticker. None if it has no
    options data at all."""
    sym = ticker.strip().upper()

    # 1) spot + ATM implied vol + realized vol. The realized series is
    #    returned oldest-first, so the latest reading is the LAST element.
    realized = _uw_get(f"/stock/{sym}/volatility/realized")
    time.sleep(SLEEP_PER_CALL)
    spot = atm_iv = realized_vol = None
    if realized:
        latest = realized[-1]
        spot = _f(latest.get("price"))
        atm_iv = _f(latest.get("implied_volatility"))
        # UW's realized_volatility is forward-shifted (~30d): the latest
        # rows are null until their forward window closes. Walk back to the
        # most recent row that actually carries a realized-vol reading.
        for rrow in reversed(realized):
            rv = _f(rrow.get("realized_volatility"))
            if rv is not None:
                realized_vol = rv
                break

    # 2) day call/put volume + premium split.
    vol_rows = _uw_get(f"/stock/{sym}/options-volume", {"limit": 1})
    time.sleep(SLEEP_PER_CALL)
    call_volume = put_volume = put_call_ratio = net_premium = None
    if vol_rows:
        v = vol_rows[0]
        call_volume = _i(v.get("call_volume"))
        put_volume = _i(v.get("put_volume"))
        if call_volume is not None and put_volume is not None and call_volume > 0:
            put_call_ratio = round(put_volume / call_volume, 4)
        bull = _f(v.get("bullish_premium"))
        bear = _f(v.get("bearish_premium"))
        if bull is not None and bear is not None:
            # Net premium: ask-side calls + bid-side puts (bullish) minus
            # ask-side puts + bid-side calls (bearish). Positive => bullish.
            net_premium = round(bull - bear, 2)

    # 3) implied move term structure.
    term = _uw_get(f"/stock/{sym}/volatility/term-structure")
    time.sleep(SLEEP_PER_CALL)
    implied_move_7d = _term_structure_implied_move(term, 7)
    implied_move_30d = _term_structure_implied_move(term, 30)

    # 4) per-contract detail (calls then puts).
    raw_contracts = fetch_contracts(sym, "call") + fetch_contracts(sym, "put")

    # If the ticker returned nothing on any endpoint, it has no options.
    if not raw_contracts and not vol_rows and not realized:
        return None

    contracts: list[dict[str, Any]] = []
    for c in raw_contracts:
        if not isinstance(c, dict):
            continue
        parsed = _parse_occ(c.get("option_symbol") or c.get("symbol") or "")
        if not parsed:
            continue
        dte = (parsed["expiry"] - as_of).days
        if dte < MIN_DTE or dte > MAX_DTE:
            continue
        strike = parsed["strike"]
        if spot and spot > 0:
            ratio = strike / spot
            if ratio < MONEYNESS_LO or ratio > MONEYNESS_HI:
                continue
        volume = _i(c.get("volume")) or 0
        prev_oi = _i(c.get("prev_oi"))
        iv = _f(c.get("implied_volatility"))
        ask_vol = _i(c.get("ask_volume")) or 0
        bid_vol = _i(c.get("bid_volume")) or 0
        vol_to_oi = None
        if prev_oi is not None and prev_oi > 0:
            vol_to_oi = round(min(volume / prev_oi, 9999.0), 4)
        two_sided = ask_vol + bid_vol
        pct_at_ask = round(ask_vol / two_sided, 4) if two_sided > 0 else None
        contracts.append({
            "option_symbol": c.get("option_symbol") or c.get("symbol"),
            "type": parsed["type"],
            "strike": strike,
            "expiry": parsed["expiry"].isoformat(),
            "dte": dte,
            "volume": volume,
            "prev_oi": prev_oi,
            "open_interest": _i(c.get("open_interest")),
            "ask_volume": ask_vol,
            "bid_volume": bid_vol,
            "sweep_volume": _i(c.get("sweep_volume")),
            "implied_volatility": round(iv, 6) if iv is not None else None,
            "delta": bs_delta(parsed["type"], spot, strike, iv, dte),
            "total_premium": _f(c.get("total_premium")),
            "vol_to_oi": vol_to_oi,
            "pct_at_ask": pct_at_ask,
        })

    # Cap row size: keep the nearest-the-money contracts.
    if spot and spot > 0 and len(contracts) > MAX_STORED_CONTRACTS:
        contracts.sort(key=lambda x: abs(x["strike"] / spot - 1.0))
        contracts = contracts[:MAX_STORED_CONTRACTS]

    # Scoring-input headlines: strongest fresh-positioning multiple across
    # the full stored superset (Phase 2 recomputes within its calibrated
    # window from the contracts array itself).
    def _best(side: str) -> float | None:
        vals = [c["vol_to_oi"] for c in contracts
                if c["type"] == side and c["vol_to_oi"] is not None
                and (c["prev_oi"] or 0) >= MIN_OI_FOR_BEST]
        return max(vals) if vals else None

    return {
        "ticker": sym,
        "as_of_date": as_of.isoformat(),
        "call_volume": call_volume,
        "put_volume": put_volume,
        "put_call_ratio": put_call_ratio,
        "net_premium": net_premium,
        "atm_iv": round(atm_iv, 6) if atm_iv is not None else None,
        "implied_move_7d": implied_move_7d,
        "implied_move_30d": implied_move_30d,
        "realized_vol_30d": round(realized_vol, 6) if realized_vol is not None else None,
        "best_call_vol_oi": _best("call"),
        "best_put_vol_oi": _best("put"),
        "contracts": contracts,
    }


# ── Supabase writes ──────────────────────────────────────────────────────────

def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 100) -> int:
    """Idempotent UPSERT on (ticker, as_of_date)."""
    if not rows:
        return 0
    url = f"{_supa_url()}/rest/v1/{TABLE}?on_conflict=ticker,as_of_date"
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"options UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def _log_pipeline_fetch(indicator_id: str, status: str, meta: dict[str, Any]) -> None:
    """Best-effort freshness-log row in pipeline_fetch_log. Never raises."""
    url, key = _supa_url(), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return
    try:
        requests.post(
            f"{url}/rest/v1/pipeline_fetch_log",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={"indicator_id": indicator_id, "status": status,
                  "run_kind": "aggregate", "source": "unusual_whales", "meta": meta},
            timeout=10,
        )
    except Exception:
        pass


# ── Driver ───────────────────────────────────────────────────────────────────

def pull_and_upsert(tickers: list[str],
                    as_of: date | None = None,
                    max_seconds: float = 7200.0) -> dict[str, Any]:
    as_of = as_of or date.today()
    t0 = time.time()

    tickers_done = 0
    tickers_with_data = 0
    rows_upserted = 0
    contracts_total = 0
    pending: list[dict[str, Any]] = []

    for sym in tickers:
        if time.time() - t0 > max_seconds:
            break
        try:
            row = build_row(sym, as_of)
        except Exception:
            row = None
        if row is not None:
            pending.append(row)
            tickers_with_data += 1
            contracts_total += len(row.get("contracts") or [])
        tickers_done += 1
        # Flush periodically so a mid-run timeout still persists work.
        if len(pending) >= 100:
            rows_upserted += upsert_rows(pending)
            pending = []

    if pending:
        rows_upserted += upsert_rows(pending)

    full_run = tickers_done >= len(tickers)
    result = {
        "as_of": as_of.isoformat(),
        "tickers_total": len(tickers),
        "tickers_done": tickers_done,
        "tickers_with_data": tickers_with_data,
        "rows_upserted": rows_upserted,
        "contracts_stored": contracts_total,
        "full_run": full_run,
        "elapsed_sec": round(time.time() - t0, 1),
    }
    _log_pipeline_fetch(
        "scanner.options-eod-uw",
        "green" if (full_run and rows_upserted > 0) else "amber",
        result,
    )
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--as-of", help="YYYY-MM-DD as-of date (default: today)", default=None)
    p.add_argument("--max-seconds", type=float, default=7200.0)
    p.add_argument("--limit", type=int, default=None,
                   help="Cap the universe size (testing)")
    p.add_argument("--tickers", help="Comma-separated explicit ticker list")
    args = p.parse_args()

    if args.tickers:
        ts = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        ts = build_screener_candidate_universe()
        if args.limit:
            ts = ts[:args.limit]

    as_of = date.fromisoformat(args.as_of) if args.as_of else None

    # Bug #1032 follow-up: write one row per run to api_usage_log so the
    # Admin API Usage bar chart shows this pipeline's daily UW call volume.
    _run_id = uuid.uuid4()
    _started_at = datetime.now(timezone.utc)
    try:
        _result = pull_and_upsert(ts, as_of=as_of, max_seconds=args.max_seconds)
        print(json.dumps(_result, indent=2))
        # Estimate UW calls: ~4 endpoints per ticker (option-contracts,
        # options-volume, volatility/realized, volatility/term-structure).
        _calls = int((_result.get("tickers_done") or 0) * 4)
        log_run_summary(
            source="options_eod",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            calls_made=_calls,
            status="success" if _result.get("full_run") else "partial",
            notes={
                "tickers_done": _result.get("tickers_done"),
                "tickers_with_data": _result.get("tickers_with_data"),
                "rows_upserted": _result.get("rows_upserted"),
                "contracts_stored": _result.get("contracts_stored"),
            },
        )
    except Exception as _exc:
        log_run_summary(
            source="options_eod",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            status="failed",
            notes={"error": str(_exc)[:500]},
        )
        raise
