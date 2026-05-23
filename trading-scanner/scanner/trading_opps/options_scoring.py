#!/usr/bin/env python3
"""options_scoring.py - Trading Opportunities options scoring engine.

Turns the per-contract end-of-day options data in public.options_eod_daily
into the options layer of the screener score (locked spec Section 7).

PLAIN-ENGLISH SUMMARY
---------------------
When a trader is genuinely positioning for a stock to rise, two things
show up in the options tape at once: (1) FRESH POSITIONING - today's
volume on a contract is large versus how much was already open in that
contract, and (2) AGGRESSIVE EXECUTION - that volume printed at the ask,
meaning the trader paid up to get in rather than waiting. This engine
looks at medium-dated, moderately out-of-the-money CALL contracts and
rewards a contract that shows both.

THE TWO TIERS (point values from the locked spec - NOT yet backtested)
----------------------------------------------------------------------
  * Volume >= 3x prior open interest, with >=65% bought at the ask  4 points
  * Volume >= 1x prior open interest, with >=65% bought at the ask  3 points
  * Otherwise .................................................... 0 points
  Layer cap: 4 points.

HOW IT IS DECIDED (Senior-Quant engine design, sanity-checked against the
spec; the engine logic itself is not backtested either - see disclaimer):

  Candidate contracts are CALLS with 14-45 days to expiry that are
  moderately out-of-the-money - a strike between the current price and
  ~15% above it. A contract needs at least 100 contracts of prior open
  interest, so a near-empty contract cannot manufacture a giant ratio.

  "Bought at the ask" gate: the layer scores only contracts where at
  least 65% of the day's volume printed at the ask. Among contracts that
  clear that gate, the engine takes the strongest volume-to-open-interest
  multiple and reads the tier off it.

NOTE ON THE "MODERATELY OUT-OF-THE-MONEY" FILTER (Senior-Quant decision,
2026-05-21). The locked spec's draft expressed this filter as option
delta 0.35-0.50. That value was a CANDIDATE to be set by the Phase 2
backtest, which was never run for the options layer. In the live data the
stored delta is ~68% null (Unusual Whales does not return an implied
volatility for many contracts, and delta is computed from it), so gating
on delta would silently leave the layer scoring almost nothing. The
engine therefore expresses the same idea - "moderately out-of-the-money"
- as a strike-vs-price moneyness band, which is reliable for every
contract. This is documented on the methodology page as a not-yet-
backtested candidate filter.

SO WHAT (the one-sentence "why a PM cares"): a fresh, aggressively-bought
call position on a medium-dated out-of-the-money contract is real money
betting - today, paying up - that this specific stock rises.
"""
from __future__ import annotations

# ---- tunables (CANDIDATE - locked-spec point values + filters; engine
#      logic is Senior-Quant design; none of it is backtested yet) ----------
DTE_MIN, DTE_MAX        = 14, 45      # spec Section 7: medium-dated
MONEYNESS_MIN           = 1.00       # strike >= price (at-the-money floor)
MONEYNESS_MAX           = 1.15       # ...up to ~15% out-of-the-money
AT_ASK_THRESHOLD        = 0.65       # >=65% of volume printed at the ask
VOL_OI_STRONG           = 3.0        # >= 3x prior OI -> top tier
VOL_OI_BASE             = 1.0        # >= 1x prior OI -> base tier
MIN_PREV_OI             = 100        # ignore near-empty contracts
POINTS_STRONG           = 4
POINTS_BASE             = 3
LAYER_CAP               = 4

SCORING_LAYER = "options"


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _window_calls(contracts: list[dict], spot: float) -> list[dict]:
    """Calls inside the 14-45 DTE / moderately-OTM candidate window that
    carry enough prior open interest and a usable volume-to-OI multiple."""
    out = []
    for c in contracts or []:
        if (c.get("type") or "").lower() != "call":
            continue
        dte = c.get("dte")
        if dte is None or not (DTE_MIN <= dte <= DTE_MAX):
            continue
        strike = _num(c.get("strike"))
        if strike is None or strike <= 0:
            continue
        moneyness = strike / spot
        if not (MONEYNESS_MIN <= moneyness <= MONEYNESS_MAX):
            continue
        prev_oi = c.get("prev_oi")
        if prev_oi is None or prev_oi < MIN_PREV_OI:
            continue
        vol_oi = _num(c.get("vol_to_oi"))
        if vol_oi is None:
            continue
        out.append(c)
    return out


def score_options(contracts: list[dict], spot: float | None) -> dict:
    """Score one ticker's options layer for the LONG side from its stored
    per-contract `contracts` array (public.options_eod_daily.contracts).

    spot - the latest EOD close, used to judge a call's moneyness.

    Returns a dict: points (0/3/4), shock_multiple (the headline
    volume-to-open-interest multiple shown in the column), and a
    plain-English `detail`.
    """
    out = {
        "layer": SCORING_LAYER, "points": 0, "shock_multiple": None,
        "tier": None, "n_window": 0, "n_qualifying": 0,
        "best_contract": None, "detail": "no options data",
    }
    if not contracts:
        return out
    if spot is None or spot <= 0:
        out["detail"] = "current price unavailable - cannot judge moneyness"
        return out

    window = _window_calls(contracts, spot)
    out["n_window"] = len(window)
    if not window:
        out["detail"] = "no medium-dated, moderately out-of-the-money calls"
        return out

    # Strongest fresh-positioning multiple in the candidate window (display).
    window_best = max(window, key=lambda c: _num(c.get("vol_to_oi")) or 0.0)
    window_best_voi = _num(window_best.get("vol_to_oi")) or 0.0

    # Contracts that ALSO clear the "bought at the ask" gate -> scoreable.
    qualifying = [c for c in window
                  if (_num(c.get("pct_at_ask")) or 0.0) >= AT_ASK_THRESHOLD]
    out["n_qualifying"] = len(qualifying)

    if not qualifying:
        # A spike may exist, but it was not aggressively bought - 0 points,
        # still surface the multiple so the column is informative.
        out["shock_multiple"] = round(window_best_voi, 2)
        out["detail"] = (
            f"volume-to-open-interest up to {window_best_voi:.1f}x, but under "
            f"65% printed at the ask - not aggressive enough to score")
        return out

    best = max(qualifying, key=lambda c: _num(c.get("vol_to_oi")) or 0.0)
    voi = _num(best.get("vol_to_oi")) or 0.0
    at_ask = _num(best.get("pct_at_ask")) or 0.0
    out["shock_multiple"] = round(voi, 2)
    out["best_contract"] = {
        "option_symbol": best.get("option_symbol"),
        "dte": best.get("dte"), "delta": _num(best.get("delta")),
        "strike": _num(best.get("strike")),
        "vol_to_oi": round(voi, 2), "pct_at_ask": round(at_ask, 3),
    }

    if voi >= VOL_OI_STRONG:
        out["points"] = min(POINTS_STRONG, LAYER_CAP)
        out["tier"] = "strong"
        out["detail"] = (
            f"call volume {voi:.1f}x prior open interest, "
            f"{round(at_ask*100)}% bought at the ask - fresh, aggressive buying")
    elif voi >= VOL_OI_BASE:
        out["points"] = min(POINTS_BASE, LAYER_CAP)
        out["tier"] = "base"
        out["detail"] = (
            f"call volume {voi:.1f}x prior open interest, "
            f"{round(at_ask*100)}% bought at the ask - fresh positioning")
    else:
        out["detail"] = (
            f"aggressively-bought calls present but volume only {voi:.1f}x "
            f"prior open interest - below the 1x fresh-positioning bar")
    return out


# ---------------------------------------------------------------------------
# Supabase fetch helper - reads public.options_eod_daily (NO Unusual Whales
# calls: the per-contract data is already ingested nightly; this only reads
# it back out of Supabase).
# ---------------------------------------------------------------------------
def informational_columns(opt_row, spot):
    """Map an options_eod_daily row to the Group-3 informational display
    columns the Trading Opportunities page reads (P/C, Net Prem, IV,
    Implied 7D, Implied 30D). These are context-only metrics — they do NOT
    feed the score. opt_row may be None. Units match the page renderers:
    net premium in $millions, IV as a percent, implied moves carried as
    both a percent and a dollar figure. iv_rank is not derivable from the
    current feed (it needs an IV history we do not yet retain) and stays
    None — a separate follow-up.
    """
    out = {"pc_ratio": None, "net_premium": None, "iv": None,
           "iv_rank": None, "implied_7d_pct": None, "implied_7d_usd": None,
           "implied_30d_pct": None, "implied_30d_usd": None}
    if not opt_row:
        return out
    pc = _num(opt_row.get("put_call_ratio"))
    netp = _num(opt_row.get("net_premium"))
    iv = _num(opt_row.get("atm_iv"))
    im7 = _num(opt_row.get("implied_move_7d"))
    im30 = _num(opt_row.get("implied_move_30d"))
    if pc is not None:
        out["pc_ratio"] = round(pc, 4)
    if netp is not None:
        out["net_premium"] = round(netp / 1e6, 4)      # page shows "$x.xM"
    if iv is not None:
        out["iv"] = round(iv * 100.0, 2)               # page shows "x%"
    if im7 is not None:
        out["implied_7d_usd"] = round(im7, 4)
        if spot:
            out["implied_7d_pct"] = round(im7 / spot * 100.0, 3)
    if im30 is not None:
        out["implied_30d_usd"] = round(im30, 4)
        if spot:
            out["implied_30d_pct"] = round(im30 / spot * 100.0, 3)
    return out


def fetch_options(tickers: list[str], asof_date: str,
                  supabase_get) -> dict[str, dict]:
    """Pull the latest options_eod_daily row (on or before `asof_date`) for
    each ticker. `supabase_get` is backtest_engine._supabase_get.

    Returns {ticker: {as_of_date, contracts:[...]}}.
    """
    by_ticker: dict[str, dict] = {}
    cols = ("ticker,as_of_date,contracts,put_call_ratio,net_premium,"
            "atm_iv,implied_move_7d,implied_move_30d")
    for i in range(0, len(tickers), 20):
        chunk = ",".join(tickers[i:i + 20])
        path = (f"options_eod_daily?select={cols}"
                f"&ticker=in.({chunk})&as_of_date=lte.{asof_date}"
                f"&order=as_of_date.desc")
        try:
            rows = supabase_get(path) or []
        except Exception as exc:                       # noqa: BLE001
            print(f"    options fetch failed for a batch: {exc}")
            rows = []
        for r in rows:
            t = r.get("ticker")
            if t and t not in by_ticker:        # first = most recent date
                by_ticker[t] = r
    return by_ticker


if __name__ == "__main__":
    # Tiny self-test on synthetic contracts (no network). spot = 100.
    strong = [{"type": "call", "dte": 30, "strike": 105.0, "prev_oi": 5000,
               "vol_to_oi": 4.5, "pct_at_ask": 0.74, "delta": 0.42,
               "option_symbol": "T260101C00105000"}]
    base = [{"type": "call", "dte": 21, "strike": 108.0, "prev_oi": 800,
             "vol_to_oi": 1.6, "pct_at_ask": 0.70, "option_symbol": "T"}]
    notask = [{"type": "call", "dte": 21, "strike": 110.0, "prev_oi": 800,
               "vol_to_oi": 6.0, "pct_at_ask": 0.40, "option_symbol": "T"}]
    deep = [{"type": "call", "dte": 21, "strike": 70.0, "prev_oi": 800,
             "vol_to_oi": 9.0, "pct_at_ask": 0.95, "option_symbol": "T"}]
    print("strong:", score_options(strong, 100.0))
    print("base:  ", score_options(base, 100.0))
    print("spike not at ask:", score_options(notask, 100.0))
    print("deep ITM (out of moneyness band):", score_options(deep, 100.0))
    print("empty: ", score_options([], 100.0))
