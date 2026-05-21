#!/usr/bin/env python3
"""darkpool_scoring.py - Trading Opportunities dark-pool scoring engine.

Turns the raw off-exchange block prints in public.darkpool_prints into the
dark-pool layer of the screener score (locked spec Section 6).

PLAIN-ENGLISH SUMMARY
---------------------
Big investors trade large blocks of stock away from the public exchanges
("dark pools"). When a lot of that block volume piles up inside a narrow
price band over the last two days, that band is an institutional anchor -
a price level big money cared about. If the stock is now trading ABOVE
that band, the band sits beneath the price as a support floor, which is
constructive for a long. This engine finds that band and awards points.

THE TWO RULES (point values from the locked spec - NOT yet backtested)
----------------------------------------------------------------------
  * Clustering band active AND stock above it ............... 2 points
  * No tight band, but one standout large block below price  1 point
  * Otherwise .............................................. 0 points
  Layer cap: 2 points.

HOW EACH RULE IS DECIDED (Senior-Quant engine design, sanity-checked
against the spec; the engine logic itself is not backtested either -
see the page disclaimer):

  Clustering band - over the trailing 48 hours of non-cancelled prints we
  slide a +/-1.5% price window and find where the most block dollars
  cluster. The band is "active" when at least 60% of the 48h dark-pool
  dollar volume falls inside that single narrow window (a genuine, tight
  cluster - not volume smeared across the day's range). If the band is
  active and the latest close is above the top of the band, the band is a
  support floor: 2 points.

  Single large block - if there is no tight cluster, we look for one
  standout print: the largest block by dollar value, when that block is
  at least 3x the average print size in the window ("a single large block
  above the day's mean") and is at least $500k of stock. If such a block
  printed below the current price, it is a weaker lone anchor: 1 point.

  The layer only evaluates at all when the 48h window carries at least
  $1,000,000 of non-cancelled dark-pool volume - below that there is not
  enough institutional activity to anchor anything.

The anchor price is published for EVERY name that has dark-pool data
(spec Section 9: the anchor always powers the entry / stop levels), even
when the layer scores 0.

SO WHAT (the one-sentence "why a PM cares"): a live, supportive dark-pool
band says big money recently accumulated just below where the stock
trades now - a floor under a long.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# ---- tunables (CANDIDATE - locked-spec point values, engine thresholds
#      set by Senior-Quant design; neither is backtested yet) --------------
WINDOW_HOURS            = 72        # ~2 trading days; 72 calendar hours is
                                   # weekend-safe (spec Section 6 "last 48
                                   # hours" of trading)
BAND_HALFWIDTH_PCT      = 0.015     # +/-1.5% defines a "narrow price band"
CLUSTER_CONCENTRATION   = 0.60      # >=60% of 48h $-vol inside the band => cluster
MIN_WINDOW_PREMIUM      = 1_000_000.0   # layer is dark below this much 48h $-vol
MIN_PRINTS              = 3         # need at least this many prints to judge a band
SINGLE_BLOCK_MULT       = 3.0       # standout block: >= 3x the mean print value
SINGLE_BLOCK_MIN_PREMIUM = 500_000.0    # ...and >= $500k of stock in absolute terms
LAYER_CAP               = 2

SCORING_LAYER = "dark_pool"


def _print_premium(p: dict) -> float | None:
    """Dollar value of one print: the feed's `premium`, or size x price."""
    prem = p.get("premium")
    if prem is not None:
        try:
            prem = float(prem)
            if prem > 0:
                return prem
        except (TypeError, ValueError):
            pass
    size, price = p.get("size"), p.get("price")
    try:
        if size is not None and price is not None:
            v = float(size) * float(price)
            return v if v > 0 else None
    except (TypeError, ValueError):
        pass
    return None


def _clean_window(prints: list[dict], asof: datetime) -> list[dict]:
    """Keep non-cancelled, well-formed prints inside the 48h window ending at
    `asof`. Each kept print is annotated with a numeric `_prem` and `_price`."""
    lo = asof - timedelta(hours=WINDOW_HOURS)
    out = []
    for p in prints:
        if p.get("canceled"):
            continue
        price = p.get("price")
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        prem = _print_premium(p)
        if prem is None:
            continue
        ts = p.get("executed_at")
        if ts is not None:
            dt = _parse_ts(ts)
            if dt is not None and not (lo <= dt <= asof + timedelta(hours=6)):
                continue
        out.append({**p, "_price": price, "_prem": prem})
    return out


def _parse_ts(ts) -> datetime | None:
    """Parse a Supabase ISO timestamp into an aware UTC datetime."""
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    try:
        s = str(ts).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _densest_band(rows: list[dict]) -> dict:
    """Slide a +/-1.5% price window across the prints and return the band that
    encloses the most dark-pool dollars. O(n log n) - sort then two pointers."""
    rows = sorted(rows, key=lambda r: r["_price"])
    n = len(rows)
    prices = [r["_price"] for r in rows]
    prems = [r["_prem"] for r in rows]
    # prefix sums of premium for O(1) range totals
    pref = [0.0] * (n + 1)
    for i in range(n):
        pref[i + 1] = pref[i] + prems[i]
    total = pref[n]

    ref = prices[n // 2]                       # median price - band-width ref
    width = 2.0 * BAND_HALFWIDTH_PCT * ref     # full width of a +/-1.5% band

    best = {"premium": 0.0, "lo_idx": 0, "hi_idx": 0}
    j = 0
    for i in range(n):
        if j < i:
            j = i
        while j + 1 < n and prices[j + 1] - prices[i] <= width:
            j += 1
        enclosed = pref[j + 1] - pref[i]
        if enclosed > best["premium"]:
            best = {"premium": enclosed, "lo_idx": i, "hi_idx": j}

    lo_i, hi_i = best["lo_idx"], best["hi_idx"]
    enclosed_rows = rows[lo_i:hi_i + 1]
    wsum = sum(r["_prem"] for r in enclosed_rows) or 1.0
    band_price = sum(r["_price"] * r["_prem"] for r in enclosed_rows) / wsum
    return {
        "band_price": band_price,
        "band_low": prices[lo_i],
        "band_high": prices[hi_i],
        "enclosed_premium": best["premium"],
        "concentration": (best["premium"] / total) if total > 0 else 0.0,
    }


def score_darkpool(prints: list[dict], current_close: float | None,
                   asof: datetime | None = None) -> dict:
    """Score one ticker's dark-pool layer for the LONG side.

    prints         - raw public.darkpool_prints rows for this ticker
    current_close  - the latest EOD close (the screener's `price`)
    asof           - end of the 48h window (defaults to now, UTC)

    Returns a dict: points (0/1/2), anchor (price or None), band_active,
    rule ('band' / 'block' / None), and a plain-English `detail`.
    """
    out = {
        "layer": SCORING_LAYER, "points": 0, "anchor": None,
        "band_active": False, "rule": None, "n_prints": 0,
        "window_premium": 0.0, "concentration": 0.0, "detail": "no dark-pool data",
    }
    if not prints:
        return out
    asof = asof or datetime.now(timezone.utc)
    rows = _clean_window(prints, asof)
    out["n_prints"] = len(rows)
    if len(rows) < MIN_PRINTS:
        out["detail"] = "too few dark-pool prints in the 48h window"
        return out

    total_prem = sum(r["_prem"] for r in rows)
    out["window_premium"] = total_prem
    # volume-weighted anchor is always published (spec Section 9)
    vwap = sum(r["_price"] * r["_prem"] for r in rows) / (total_prem or 1.0)
    out["anchor"] = round(vwap, 4)

    if total_prem < MIN_WINDOW_PREMIUM:
        out["detail"] = "dark-pool volume too thin to anchor (under $1M in 48h)"
        return out

    band = _densest_band(rows)
    out["concentration"] = round(band["concentration"], 4)
    band_active = band["concentration"] >= CLUSTER_CONCENTRATION
    out["band_active"] = band_active

    # ---- Rule 1: tight clustering band, stock above it -> 2 points ----------
    if band_active:
        out["anchor"] = round(band["band_price"], 4)
        if current_close is not None and current_close > band["band_high"]:
            out["points"] = min(2, LAYER_CAP)
            out["rule"] = "band"
            out["detail"] = (
                f"institutional clustering band at ${band['band_price']:.2f} "
                f"({round(band['concentration']*100)}% of 48h block dollars); "
                f"price ${current_close:.2f} sits above it as support")
            return out
        out["detail"] = (
            f"clustering band at ${band['band_price']:.2f} but price is not "
            f"clearly above it - no long support edge")
        return out

    # ---- Rule 2: one standout large block below the price -> 1 point --------
    largest = max(rows, key=lambda r: r["_prem"])
    mean_prem = total_prem / len(rows)
    is_standout = (largest["_prem"] >= SINGLE_BLOCK_MULT * mean_prem
                   and largest["_prem"] >= SINGLE_BLOCK_MIN_PREMIUM)
    if is_standout and current_close is not None and current_close > largest["_price"]:
        out["points"] = min(1, LAYER_CAP)
        out["anchor"] = round(largest["_price"], 4)
        out["rule"] = "block"
        out["detail"] = (
            f"single ${largest['_prem']/1e6:.1f}M block at "
            f"${largest['_price']:.2f} below the price - a lone support anchor")
        return out

    out["detail"] = "dark-pool volume present but dispersed - no scoring anchor"
    return out


# ---------------------------------------------------------------------------
# Supabase fetch helper - reads public.darkpool_prints (NO Unusual Whales
# calls: the raw prints are already ingested nightly; this only reads them
# back out of Supabase).
# ---------------------------------------------------------------------------
def fetch_prints(tickers: list[str], asof: datetime,
                 supabase_get) -> dict[str, list[dict]]:
    """Pull the trailing-48h dark-pool prints for `tickers` from Supabase.

    `supabase_get` is backtest_engine._supabase_get (passed in to avoid an
    import cycle). Returns {ticker: [print, ...]}.
    """
    lo = (asof - timedelta(hours=WINDOW_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    by_ticker: dict[str, list[dict]] = {}
    cols = "ticker,executed_at,price,size,premium,canceled"
    # One request per ticker: the launched set is small (dozens of names),
    # and a per-ticker query with its own 1000-row limit cannot let a busy
    # name crowd a quiet one out of a shared batch.
    for t in tickers:
        path = (f"darkpool_prints?select={cols}"
                f"&ticker=eq.{t}&canceled=eq.false"
                f"&executed_at=gte.{lo}&order=executed_at.desc&limit=1000")
        try:
            by_ticker[t] = supabase_get(path) or []
        except Exception as exc:                       # noqa: BLE001
            print(f"    darkpool fetch failed for {t}: {exc}")
            by_ticker[t] = []
    return by_ticker


if __name__ == "__main__":
    # Tiny self-test on synthetic prints (no network).
    base = datetime.now(timezone.utc)
    clustered = [{"ticker": "T", "executed_at": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "price": 100.0 + (i % 3) * 0.1, "size": 50000,
                  "premium": 5_000_000.0, "canceled": False} for i in range(8)]
    print("clustered, price above:", score_darkpool(clustered, 105.0, base))
    print("clustered, price inside:", score_darkpool(clustered, 100.1, base))
    block = [{"ticker": "T", "executed_at": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
              "price": 90.0 + i, "size": 1000, "premium": 100_000.0,
              "canceled": False} for i in range(10)]
    block.append({"ticker": "T", "executed_at": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "price": 92.0, "size": 1, "premium": 4_000_000.0, "canceled": False})
    print("single block below price:", score_darkpool(block, 110.0, base))
