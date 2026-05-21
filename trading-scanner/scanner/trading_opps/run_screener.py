#!/usr/bin/env python3
"""run_screener.py — nightly Trading Opportunities producer.

Pipeline: screener-trading-opps-daily.

Runs the Phase 2 backtest-calibrated dual-direction screener over the
eligible universe for the latest trading day and writes one dated snapshot
row per launched LONG name into public.trading_opps_signals.

Append-only: re-running for the same scan_date upserts that day's rows;
earlier scan_dates are never touched, so the page can read a ticker's score
one week / one month ago straight off an older snapshot.

The scoring math is the calibrated engine in backtest_engine.py — same
universe gate ($5 price floor, $1.5M 90-day median dollar-volume floor),
same indicators (200-day SMA, 14-day Wilder RSI), the same insider rules
A/B/C and trend overlay, and the 15-day-plateau insider age-decay folded
in 2026-05-20. This producer only adds the live-snapshot wiring and the
informational display columns (EMA/SMA, realized vol, 52-week range, etc.).

Data load reuses backtest_engine.load_data(): it reads ./data/*.pkl when a
cache is present and otherwise pulls straight from Supabase — so a cron run
with no cache just pulls through.

Usage:
    python3 run_screener.py            # produce today's snapshot
    python3 run_screener.py --dry-run  # build + score, print, do not write
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import backtest_engine as E
import darkpool_scoring as DP
import options_scoring as OP

HERE = os.path.dirname(os.path.abspath(__file__))
INSIDER_WINDOW_DAYS = 30          # locked spec / calibrated_config lookback
SPARK_POINTS = 16                 # closes in the sparkline
STAT_WINDOW = 21                  # trading days for the daily-return statistics


# ───────────────────────────────────────────────────────────────────────────
# config + supabase helpers
# ───────────────────────────────────────────────────────────────────────────
def load_config() -> dict:
    with open(os.path.join(HERE, "calibrated_config.json")) as f:
        return json.load(f)


def backtest_win_rate() -> float:
    """The launched-list T+21 win rate from the pinned backtest, as a percent.
    This is the empirical hit-rate the page shows in the Win Rate column."""
    try:
        with open(os.path.join(HERE, "backtest_results.json")) as f:
            res = json.load(f)
        wr = res["final_long_performance"]["21"]["win_rate"]
        return round(float(wr) * 100.0, 1)
    except Exception:
        return None


def _supabase_write(table: str, rows: list, on_conflict: str):
    """Upsert rows via the Supabase REST API (service role)."""
    env = E._env()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?on_conflict={on_conflict}",
        data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.status


def _supabase_get(path: str):
    return E._supabase_get(path)


def latest_complete_date(panel: pd.DataFrame):
    """The latest trade_date whose universe is fully ingested.

    End-of-day price data lands progressively, so the calendar's most recent
    date can carry only a partial slice of tickers for a few hours. Scanning a
    half-ingested day would silently shrink the universe and drop real signals.
    This picks the newest date whose ticker count is at least 60% of the median
    of the five prior trading days — which skips a partial ingest and lands on
    the last genuinely complete close."""
    counts = panel.groupby("trade_date").size().sort_index()
    if len(counts) < 7:
        return counts.index[-1]
    ref = float(counts.iloc[-6:-1].median())
    for d in counts.index[::-1]:
        if counts[d] >= 0.60 * ref:
            return d
    return counts.index[-1]


# ───────────────────────────────────────────────────────────────────────────
# insider rollup — evaluated AS OF the scan date (window ends at scan_date,
# not at the last filing date — that is the only difference from the
# backtest's insider_events, which evaluates the window at each filing date)
# ───────────────────────────────────────────────────────────────────────────
def insider_rollup_asof(ins: pd.DataFrame, asof: pd.Timestamp,
                        window_days: int) -> dict:
    """Per ticker: roll up eligible open-market buys in (asof-window, asof].
    Mirrors backtest_engine.insider_events rule logic exactly."""
    lo = asof - pd.Timedelta(days=window_days)
    buys = ins[(ins["transaction_code"] == "P")
               & (~ins["is_10b5_1"])
               & (~ins["is_ten_percent_owner"])
               & (ins["filing_date"] > lo)
               & (ins["filing_date"] <= asof)].copy()
    out = {}
    for ticker, win in buys.groupby("ticker", sort=False):
        # Rule A — a C-suite buy lifting personal stake >=10%, worth >=$100k
        a = win[(win["csuite"])
                & (win["stake_pct"] >= 0.10)
                & (win["dollar_value"] >= 100_000)]
        rule_a = len(a) > 0
        # Rule B — combined window buys >= 0.05% of market cap
        mcap_s = win["marketcap"].dropna()
        mcap = float(mcap_s.iloc[-1]) if len(mcap_s) else np.nan
        total_dollars = float(win["dollar_value"].sum())
        rule_b = bool(mcap and mcap > 0 and total_dollars >= 0.0005 * mcap)
        # Rule C — 3+ distinct insiders buying in the window
        rule_c = win["owner_name"].nunique() >= 3
        if not (rule_a or rule_b or rule_c):
            continue
        freshest = win["filing_date"].max()
        sector_s = win["sector"].dropna()
        out[ticker] = {
            "rule_a": rule_a, "rule_b": rule_b, "rule_c": rule_c,
            "age_days": int((asof - freshest).days),
            "n_insiders": int(win["owner_name"].nunique()),
            "marketcap": mcap if np.isfinite(mcap) else None,
            "sector": (str(sector_s.iloc[-1]) if len(sector_s) else None),
        }
    return out


# ───────────────────────────────────────────────────────────────────────────
# informational columns — all computed from the ticker's own price history
# ───────────────────────────────────────────────────────────────────────────
def price_extras(g: pd.DataFrame) -> dict:
    """g = one ticker's price bars, ascending by trade_date. Returns the
    informational display columns (moving averages, realized-vol stats,
    52-week range, change, relative volume, sparkline)."""
    close = g["close"].astype(float)
    vol = g["volume"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) >= 2 else None

    chg_usd = (last - prev) if prev is not None else None
    chg_pct = ((last - prev) / prev * 100.0) if prev else None

    vol_last = float(vol.iloc[-1]) if len(vol) else None
    vol90 = vol.tail(90).mean()
    rel_vol = (vol_last / vol90) if (vol90 and vol90 > 0) else None

    win52 = close.tail(252)
    lo52, hi52 = float(win52.min()), float(win52.max())

    ema9 = float(close.ewm(span=9, adjust=False).mean().iloc[-1])
    ema21 = float(close.ewm(span=21, adjust=False).mean().iloc[-1])
    sma50 = float(close.tail(50).mean()) if len(close) >= 50 else None

    rets = close.pct_change().dropna().tail(STAT_WINDOW)
    mean_r = float(rets.mean() * 100.0) if len(rets) else None
    std_r = float(rets.std(ddof=1) * 100.0) if len(rets) > 1 else None
    rvol = (float(rets.std(ddof=1) * np.sqrt(252) * 100.0)
            if len(rets) > 1 else None)

    spark = [round(float(x), 4) for x in close.tail(SPARK_POINTS).tolist()]

    return {
        "price": round(last, 4),
        "change_pct": round(chg_pct, 3) if chg_pct is not None else None,
        "change_usd": round(chg_usd, 4) if chg_usd is not None else None,
        "volume": vol_last,
        "rel_volume": round(rel_vol, 3) if rel_vol is not None else None,
        "week_52_low": round(lo52, 4),
        "week_52_high": round(hi52, 4),
        "ema9": round(ema9, 4),
        "ema21": round(ema21, 4),
        "sma50": round(sma50, 4) if sma50 is not None else None,
        "mean_return": round(mean_r, 3) if mean_r is not None else None,
        "std_dev": round(std_r, 3) if std_r is not None else None,
        "daily_sigma_pct": round(std_r, 3) if std_r is not None else None,
        "realized_vol": round(rvol, 2) if rvol is not None else None,
        "spark": spark,
    }


def fetch_reference(tickers: list) -> dict:
    """Company name + sector + market cap for the launched tickers."""
    ref = {}
    for i in range(0, len(tickers), 120):
        chunk = ",".join(tickers[i:i + 120])
        try:
            rows = _supabase_get(
                "ticker_reference?select=ticker,name,sic_description,market_cap"
                f"&ticker=in.({chunk})") or []
            for r in rows:
                ref[r["ticker"]] = r
        except Exception as exc:
            print(f"    ticker_reference fetch failed for a batch: {exc}")
    return ref


def fetch_earnings(tickers: list, asof: pd.Timestamp) -> dict:
    """Next upcoming earnings date per ticker, best-effort. Any failure or an
    unexpected feed shape leaves the column null — it never blocks a scan."""
    out = {}
    asof_s = str(asof.date())
    for i in range(0, len(tickers), 120):
        chunk = ",".join(tickers[i:i + 120])
        try:
            rows = _supabase_get(
                "earnings_history?select=ticker,earnings_date"
                f"&ticker=in.({chunk})&earnings_date=gte.{asof_s}"
                "&order=earnings_date.asc") or []
            for r in rows:
                t = r.get("ticker")
                if t and t not in out and r.get("earnings_date"):
                    out[t] = r["earnings_date"]
        except Exception:
            pass
    return out


# ───────────────────────────────────────────────────────────────────────────
# main
# ───────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="build + score + print, do not write to Supabase")
    args = ap.parse_args()
    t0 = time.time()
    cfg = load_config()

    ins_cfg = cfg["long"]["insider"]
    ipts = {"A": ins_cfg["rule_a_points"], "B": ins_cfg["rule_b_points"],
            "C": ins_cfg["rule_c_points"], "cap": ins_cfg["layer_cap"]}
    window = ins_cfg["lookback_window_days"]
    tr = cfg["long"]["trend"]
    trend_cfg = {"above_sma": tr["above_sma200_points"],
                 "below_sma_longpen": tr["below_sma200_points"],
                 "rsi_hot": tr["rsi_overbought_cutoff"],
                 "rsi_hot_pen": tr["rsi_overbought_points"]}
    launch_threshold = cfg["long"]["launch_threshold"]
    scoring_version = cfg.get("scoring_version", "unversioned")
    stop_pct = cfg["risk_levels"]["stop_pct"]
    target_pct = cfg["risk_levels"]["target_pct"]
    win_rate = backtest_win_rate()

    print("[1] loading production data ...")
    px, ins_raw = E.load_data()
    print(f"    prices: {len(px):,} rows, {px['ticker'].nunique():,} tickers")
    print(f"    insider: {len(ins_raw):,} filings")

    print("[2] building indicator panel + universe gate ...")
    panel = E.mark_eligible(E.build_panel(px))
    ins = E.prep_insider(ins_raw)

    scan_date = latest_complete_date(panel)
    if scan_date != panel["trade_date"].max():
        print(f"    note: {panel['trade_date'].max().date()} is only partially "
              f"ingested — scanning the last complete close instead")
    today = panel[panel["trade_date"] == scan_date].copy()
    universe_scanned = int(today["ticker"].nunique())
    gate = today[today["eligible"] == True].copy()
    gate_cleared = int(gate["ticker"].nunique())
    print(f"    scan_date {scan_date.date()}  universe {universe_scanned:,}  "
          f"cleared the $1.5M gate {gate_cleared:,}")

    print(f"[3] insider rollup as of {scan_date.date()} "
          f"({window}-day window, age-decay applied) ...")
    rollup = insider_rollup_asof(ins, scan_date, window)
    print(f"    {len(rollup):,} eligible names carry an insider signal")

    print("[4] scoring the eligible universe ...")
    gate_by_t = {r["ticker"]: r for r in gate.to_dict("records")}
    rows = []
    for ticker, ir in rollup.items():
        bar = gate_by_t.get(ticker)
        if bar is None:
            continue                       # has an insider signal but not liquid enough
        # ── insider layer, decayed ──
        raw = (ipts["A"] * int(ir["rule_a"])
               + ipts["B"] * int(ir["rule_b"])
               + ipts["C"] * int(ir["rule_c"]))
        decay = float(E.signal_age_decay(ir["age_days"]))
        insider_pts = min(raw, ipts["cap"]) * decay
        # ── trend layer ──
        trend_pts = E.trend_long(bar, trend_cfg)
        close = float(bar["close"])
        sma200 = bar.get("sma200")
        rsi = bar.get("rsi14")
        sma200_pts = (trend_cfg["above_sma"] if (pd.notna(sma200) and close > sma200)
                      else trend_cfg["below_sma_longpen"]
                      if (pd.notna(sma200) and close < sma200) else 0)
        rsi_pts = (trend_cfg["rsi_hot_pen"]
                   if (pd.notna(rsi) and rsi > trend_cfg["rsi_hot"]) else 0)
        long_score = round(insider_pts + trend_pts, 2)
        if long_score < launch_threshold:
            continue                       # not launched — not on the list
        # ── fired rule tags ──
        tags = [t for t, fired in (("A", ir["rule_a"]), ("B", ir["rule_b"]),
                                   ("C", ir["rule_c"])) if fired]
        rows.append({
            "_ticker": ticker, "_bar": bar, "_ir": ir,
            "score": long_score, "launch_score": long_score,
            "insider_pts": round(insider_pts, 2),
            "insider_rules": tags, "insider_age_days": ir["age_days"],
            "sma200": (float(sma200) if pd.notna(sma200) else None),
            "sma200_pts": sma200_pts, "rsi": (float(rsi) if pd.notna(rsi) else None),
            "rsi_pts": rsi_pts, "trend_pts": trend_pts,
        })
    print(f"    {len(rows)} names launched (score >= {launch_threshold})")

    if not rows:
        print("    no launches today — writing an empty snapshot is a no-op.")
        return

    launched_tickers = [r["_ticker"] for r in rows]
    scan_iso = str(scan_date.date())

    # ── [4b] dark-pool + options scoring layers ──────────────────────────
    # Joe's 2026-05-21 calibration call: these two layers enrich each name's
    # score and sharpen the ranking, but they NEVER move the launch decision
    # — the gate above (insider + trend >= launch_threshold) is unchanged.
    # Point values are from the spec and are NOT yet backtested (owner-
    # approved; shipped with an on-page "not yet backtested" disclaimer and
    # Senior-Quant sanity-checked candidate values). Reading darkpool_prints
    # and options_eod_daily from Supabase adds NO Unusual Whales API calls —
    # that raw data is already ingested nightly.
    print("[4b] scoring dark-pool + options layers for launched names ...")
    asof_dt = datetime(scan_date.year, scan_date.month, scan_date.day,
                       23, 59, 59, tzinfo=timezone.utc)
    dp_prints = DP.fetch_prints(launched_tickers, asof_dt, E._supabase_get)
    opt_rows = OP.fetch_options(launched_tickers, scan_iso, E._supabase_get)
    dp_by_t, opt_by_t = {}, {}
    for r in rows:
        t = r["_ticker"]
        close = float(r["_bar"]["close"])
        dp_by_t[t] = DP.score_darkpool(dp_prints.get(t, []), close, asof_dt)
        opt_by_t[t] = OP.score_options(
            (opt_rows.get(t) or {}).get("contracts"), close)
        r["score"] = round(min(10.0, r["launch_score"]
                           + dp_by_t[t]["points"] + opt_by_t[t]["points"]), 2)
    dp_hits = sum(1 for v in dp_by_t.values() if v["points"] > 0)
    opt_hits = sum(1 for v in opt_by_t.values() if v["points"] > 0)
    print(f"    dark-pool scored {dp_hits}/{len(rows)} names; "
          f"options scored {opt_hits}/{len(rows)} names; score ceiling 10")

    print("[5] fetching reference + earnings + price history for launches ...")
    ref = fetch_reference(launched_tickers)
    earn = fetch_earnings(launched_tickers, scan_date)
    px_launched = px[px["ticker"].isin(launched_tickers)].sort_values(
        ["ticker", "trade_date"])
    extras_by_t = {t: price_extras(g)
                   for t, g in px_launched.groupby("ticker", sort=False)}

    print("[6] assembling snapshot rows ...")
    snapshot = []
    for r in rows:
        t = r["_ticker"]
        ex = extras_by_t.get(t, {})
        ir = r["_ir"]
        price = ex.get("price")
        sma200 = r["sma200"]
        sma200_pct = (round((price - sma200) / sma200 * 100.0, 2)
                      if (price and sma200) else None)
        n_rules = sum([ir["rule_a"], ir["rule_b"], ir["rule_c"]])
        trend_word = "above" if (sma200_pct or 0) >= 0 else "below"
        so_what = (f"{n_rules} insider rule{'s' if n_rules != 1 else ''} fired, "
                   f"trade {trend_word} its 200-day line. "
                   + ("Signal fresh." if ir["age_days"] <= 15
                      else f"Signal aging — {round(E.signal_age_decay(ir['age_days'])*100)}% weight left."))
        refrow = ref.get(t, {})
        snapshot.append({
            "scan_date": scan_iso,
            "ticker": t,
            "direction": "long",
            "last_trade_ts": f"{scan_iso}T20:00:00Z",
            "signal": "BUY · LONG",
            "score": r["score"],
            "score_1w": None, "score_1m": None,    # backfilled below
            "score_1w_like_for_like": None,
            "score_1m_like_for_like": None,
            "scoring_version": scoring_version,
            "win_rate": win_rate,
            "insider_rules": r["insider_rules"],
            "insider_age_days": r["insider_age_days"],
            "insider_pts": r["insider_pts"],
            "dark_pool_anchor": dp_by_t[t]["anchor"],
            "dark_pool_pts": dp_by_t[t]["points"],
            "dark_pool_status": "live",
            "options_vol_shock": opt_by_t[t]["shock_multiple"],
            "options_pts": opt_by_t[t]["points"],
            "options_shock_status": "live",
            "sma200_pct": sma200_pct, "sma200_pts": r["sma200_pts"],
            "rsi": (round(r["rsi"], 1) if r["rsi"] is not None else None),
            "rsi_pts": r["rsi_pts"],
            "price": price,
            "change_pct": ex.get("change_pct"),
            "change_usd": ex.get("change_usd"),
            "volume": ex.get("volume"),
            "rel_volume": ex.get("rel_volume"),
            "week_52_low": ex.get("week_52_low"),
            "week_52_high": ex.get("week_52_high"),
            "market_cap": ir.get("marketcap") or refrow.get("market_cap"),
            "spark": ex.get("spark"),
            "pc_ratio": None, "net_premium": None, "iv": None, "iv_rank": None,
            "implied_7d_pct": None, "implied_7d_usd": None,
            "implied_30d_pct": None, "implied_30d_usd": None,
            "realized_vol": ex.get("realized_vol"),
            "mean_return": ex.get("mean_return"),
            "std_dev": ex.get("std_dev"),
            "daily_sigma_pct": ex.get("daily_sigma_pct"),
            "ema9": ex.get("ema9"), "ema21": ex.get("ema21"),
            "sma50": ex.get("sma50"),
            "company_name": refrow.get("name") or t,
            "sector": ir.get("sector") or refrow.get("sic_description"),
            "earnings_date": earn.get(t),
            "entry": price,
            "stop": (round(price * (1 - stop_pct), 2) if price else None),
            "target": (round(price * (1 + target_pct), 2) if price else None),
            "so_what": so_what,
            "universe_scanned": universe_scanned,
            "gate_cleared": gate_cleared,
        })

    # ── score 1W / 1M ago — read older snapshots of the SAME tickers ──
    for label, days, field, lfl in (
            ("1w", 7, "score_1w", "score_1w_like_for_like"),
            ("1m", 30, "score_1m", "score_1m_like_for_like")):
        prior_iso = str((scan_date - pd.Timedelta(days=days)).date())
        try:
            tlist = ",".join(launched_tickers)
            prior = _supabase_get(
                "trading_opps_signals?select=ticker,score,scoring_version"
                f"&scan_date=lte.{prior_iso}&ticker=in.({tlist})"
                "&order=scan_date.desc") or []
            seen = {}
            for p in prior:
                seen.setdefault(p["ticker"], p)
            for row in snapshot:
                hit = seen.get(row["ticker"])
                if hit is not None:
                    row[field] = hit["score"]
                    # Like-for-like ONLY when the older snapshot was scored
                    # under the same scoring version — otherwise the score
                    # moved because the method changed, not the signal.
                    row[lfl] = (hit.get("scoring_version") == scoring_version)
        except Exception as exc:
            print(f"    score {label} backfill skipped: {exc}")

    if args.dry_run:
        print(f"\n[dry-run] {len(snapshot)} rows — top 5 by score:")
        for row in sorted(snapshot, key=lambda x: -x["score"])[:5]:
            print(f"  {row['ticker']:<6} score {row['score']:>4}  "
                  f"insider {row['insider_rules']} {row['insider_age_days']}d  "
                  f"price {row['price']}  {row['company_name']}")
        print(f"\n[dry-run] done in {time.time()-t0:.1f}s — nothing written.")
        return

    print(f"[7] writing {len(snapshot)} rows to trading_opps_signals ...")
    status = _supabase_write("trading_opps_signals", snapshot,
                             on_conflict="scan_date,ticker")
    print(f"    write status {status}")
    print(f"\nDONE — {len(snapshot)} launched names for {scan_iso} "
          f"({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
