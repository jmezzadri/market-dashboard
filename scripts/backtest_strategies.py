#!/usr/bin/env python3
"""backtest_strategies.py — one-off study: can a systematic sleeve beat the
S&P 500 long-term on MacroTilt's own data? (Approved via popup 2026-07-13.)

Four strategies, monthly rebalance at each month's last panel-complete day,
equal weight, 10 bps per side trading costs, all PRICE returns (closes are
split-adjusted, not dividend-adjusted — same basis as the SPY benchmark):

  MOM     12-1 momentum: rank by total return from t-252 to t-21 trading days
          (skip the latest month, the standard reversal guard); own the top
          quintile, clamped to 20-50 names. (Jegadeesh & Titman 1993.)
  MOMG    Same portfolio, with a crash guard: when SPY closes below its
          200-day average at rebalance, hold cash (0%) instead. (Faber 2007.)
  LOWVOL  Rank by trailing 252-day daily volatility; own the LEAST volatile
          quintile, clamped 20-50. (Ang, Hodrick, Xing, Zhang 2006.)
  COMBO   Momentum top-quintile names that ALSO have >= 1 officer/director
          open-market buyer in the trailing 90 days (filing_date basis,
          10b5-1 plans excluded). Equal weight; 100% cash in a month with
          no qualifiers. Pre-declared rule — no parameter search. Only
          testable 2025-08 onward, like INSIDER.
  INSIDER Rank by distinct officer/director open-market buyers over the
          trailing 90 days (filing_date basis — information-available date),
          require >= 2 buyers, tiebreak by dollars bought. Only testable
          2025-08 onward (insider_history starts 2025-05). (Cohen, Malloy,
          Pomorski 2012 — "opportunistic" buys, 10b5-1 plans excluded.)

Benchmarks: SPY, and the equal-weight investable universe (EW) — the EW
comparison partially controls the survivorship bias in the deep panel.

Read-only; artifacts only (monthly returns, holdings, latest lists, meta).
Paging: SQL p_limit/p_offset everywhere (LESSONS 4.18).
"""

import csv
import json
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import rpc, rpc_paged   # noqa: E402 — shared REST helpers

COST_SIDE   = 0.001          # 10 bps per side
N_MIN, N_MAX = 20, 50        # portfolio size: universe//5 clamped here
MOM_LB, MOM_SKIP = 252, 21
VOL_LB      = 252
MIN_OBS     = 200
SMA_GUARD   = 200
INS_WINDOW  = 90             # days of trailing insider filings
INS_MIN_BUYERS = 2
CHUNK_BARS  = 50


def month_key(d):
    return (d.year, d.month)


def main():
    t0 = time.time()
    start = date.fromisoformat(os.environ.get("STUDY_START", "2003-01-02"))
    rebal_limit = int(os.environ.get("REBAL_LIMIT", "0") or 0)
    out_dir = os.environ.get("OUT_DIR", "bt_out")
    os.makedirs(out_dir, exist_ok=True)

    # 1) calendar
    cal_rows = rpc_paged("strategy_bt_calendar", {"p_start": str(start), "p_end": str(date.today())})
    cal = [date.fromisoformat(r["trade_date"]) for r in cal_rows]
    idx_of = {d: i for i, d in enumerate(cal)}
    print(f"calendar: {len(cal)} eligible days {cal[0]} .. {cal[-1]}")

    # 2) rebalance dates = last eligible day of each month, with enough
    #    lookback for the 12-1 rank and at least one forward month
    month_last = {}
    for d in cal:
        month_last[month_key(d)] = d
    rebals = sorted(month_last.values())
    rebals = [d for d in rebals if idx_of[d] >= MOM_LB and d != cal[-1]]
    if rebal_limit:
        rebals = rebals[-rebal_limit:]
    print(f"rebalances: {len(rebals)} monthly ({rebals[0]} .. {rebals[-1]})")

    # 3) universe per rebalance
    uni_by_reb, all_tickers = {}, set()
    for k, rd in enumerate(rebals):
        u = rpc_paged("strategy_bt_universe", {"p_scan_date": str(rd)})
        if len(u) < 100:
            print(f"FATAL: universe {len(u)} names on {rd}", file=sys.stderr); sys.exit(1)
        uni_by_reb[rd] = sorted(r["ticker"] for r in u)
        all_tickers.update(uni_by_reb[rd])
        if (k + 1) % 40 == 0 or k == len(rebals) - 1:
            print(f"  universes {k + 1}/{len(rebals)} (latest {rd}: {len(u)})")
    all_tickers.add("SPY")
    print(f"union universe: {len(all_tickers)} tickers")

    # 4) bars (closes) aligned to calendar
    n_days = len(cal)
    px = {}
    ts = sorted(all_tickers)
    for i in range(0, len(ts), CHUNK_BARS):
        chunk = ts[i:i + CHUNK_BARS]
        rows = rpc("strategy_bt_bars", {"p_start": str(cal[0]), "p_end": str(cal[-1]), "p_tickers": chunk})
        if isinstance(rows, list) and len(rows) >= 1000:
            raise RuntimeError("bars: cap-sized response — presumptively truncated")
        for b in rows or []:
            arr = [None] * n_days
            for dt, c in zip(b["dates"], b["closes"]):
                j = idx_of.get(date.fromisoformat(dt))
                if j is not None:
                    arr[j] = float(c)
            px[b["ticker"]] = arr
        print(f"  bars {min(i + CHUNK_BARS, len(ts))}/{len(ts)}")
    spy = px["SPY"]
    if sum(1 for x in spy if x is not None) < 0.99 * n_days:
        print("FATAL: SPY coverage < 99%", file=sys.stderr); sys.exit(1)

    # SPY 200-day average on the eligible-day calendar (guard input)
    spy_sma = [None] * n_days
    run = 0.0
    for j in range(n_days):
        run += spy[j]
        if j >= SMA_GUARD:
            run -= spy[j - SMA_GUARD]
            spy_sma[j] = run / SMA_GUARD
        elif j == SMA_GUARD - 1:
            spy_sma[j] = run / SMA_GUARD

    # 5) insider buy events -> per-ticker sorted filing lists
    ins_rows = rpc_paged("strategy_bt_insider_buys", {})
    ins = {}
    for r in ins_rows:
        ins.setdefault(r["ticker"], []).append(
            (date.fromisoformat(r["filing_date"]), r["buyer"], float(r["buy_usd"])))
    for v in ins.values():
        v.sort()
    print(f"insider buy events: {len(ins_rows)} across {len(ins)} tickers")

    def close_near(tkr, j, back=5):
        arr = px.get(tkr)
        if arr is None:
            return None
        for jj in range(j, max(-1, j - back - 1), -1):
            if arr[jj] is not None:
                return arr[jj]
        return None

    def fwd_ret(tkr, j0, j1):
        a, b = close_near(tkr, j0, 0), close_near(tkr, j1)
        return None if a is None or b is None or a <= 0 else b / a - 1.0

    # 6) rank builders (use data at or before the rebalance day only)
    def mom_ranks(rd):
        j = idx_of[rd]
        out = []
        for t in uni_by_reb[rd]:
            arr = px.get(t)
            if arr is None:
                continue
            j_now, j_then = j - MOM_SKIP, j - MOM_LB
            if j_then < 0:
                continue
            a = close_near(t, j_then)
            b = close_near(t, j_now)
            window = [x for x in arr[j_then:j + 1] if x is not None]
            if a and b and a > 0 and len(window) >= MIN_OBS:
                out.append((b / a - 1.0, t))
        out.sort(reverse=True)
        return out

    def vol_ranks(rd):
        j = idx_of[rd]
        out = []
        for t in uni_by_reb[rd]:
            arr = px.get(t)
            if arr is None or j - VOL_LB < 0:
                continue
            rets = []
            prev = None
            for x in arr[j - VOL_LB:j + 1]:
                if x is not None:
                    if prev is not None:
                        rets.append(x / prev - 1.0)
                    prev = x
            if len(rets) >= MIN_OBS:
                m = sum(rets) / len(rets)
                v = (sum((r - m) ** 2 for r in rets) / (len(rets) - 1)) ** 0.5
                out.append((v, t))
        out.sort()
        return out

    def insider_picks(rd):
        lo = rd - timedelta(days=INS_WINDOW)
        scored = []
        for t in uni_by_reb[rd]:
            evs = [e for e in ins.get(t, []) if lo < e[0] <= rd]
            if not evs:
                continue
            buyers = len({e[1] for e in evs})
            usd = sum(e[2] for e in evs)
            if buyers >= INS_MIN_BUYERS:
                scored.append(((buyers, usd), t))
        scored.sort(reverse=True)
        return [t for _, t in scored[:N_MAX]]

    def insider_any_buyers(rd):
        lo = rd - timedelta(days=INS_WINDOW)
        out = set()
        for t in uni_by_reb[rd]:
            if any(lo < e[0] <= rd for e in ins.get(t, [])):
                out.add(t)
        return out

    # 7) simulate
    strat_names = ("MOM", "MOMG", "LOWVOL", "INSIDER", "COMBO")
    prev_hold = {s: set() for s in strat_names}
    prev_exposed = True
    monthly, holdings_log = [], []
    ins_start = date(2025, 8, 1)

    for k, rd in enumerate(rebals):
        j0 = idx_of[rd]
        nxt = rebals[k + 1] if k + 1 < len(rebals) else cal[-1]
        j1 = idx_of[nxt]
        n_port = max(N_MIN, min(N_MAX, len(uni_by_reb[rd]) // 5))

        mom_list = [t for _, t in mom_ranks(rd)][:n_port]
        vol_list = [t for _, t in vol_ranks(rd)][:n_port]
        ins_list = insider_picks(rd) if rd >= ins_start else None
        combo_list = ([t for t in mom_list if t in insider_any_buyers(rd)]
                      if rd >= ins_start else None)
        exposed = spy_sma[j0] is not None and spy[j0] > spy_sma[j0]

        rets_u = [r for r in (fwd_ret(t, j0, j1) for t in uni_by_reb[rd]) if r is not None]
        ew_ret = sum(rets_u) / len(rets_u) if rets_u else None
        spy_ret = fwd_ret("SPY", j0, j1)

        row = {"rebalance": str(rd), "next": str(nxt), "year": rd.year,
               "universe": len(uni_by_reb[rd]), "n_port": n_port,
               "spy": spy_ret, "ew_universe": ew_ret, "guard_exposed": int(exposed)}
        for s, picks in (("MOM", mom_list), ("MOMG", mom_list), ("LOWVOL", vol_list),
                         ("INSIDER", ins_list), ("COMBO", combo_list)):
            if picks is None:
                row[s.lower()] = None
                continue
            if s == "COMBO" and not picks:
                row[s.lower()] = 0.0          # no qualifiers -> cash for the month
                prev_hold[s] = set()
                continue
            held = set(picks)
            turn = 1.0 if not prev_hold[s] else 1.0 - len(held & prev_hold[s]) / max(len(held), 1)
            if s == "MOMG":
                if not exposed:
                    cost = COST_SIDE if prev_exposed else 0.0   # sell out once
                    row[s.lower()] = -cost
                    prev_hold[s] = set()
                    continue
                if not prev_exposed:
                    turn = 1.0                                   # re-enter fully
            rr = [r for r in (fwd_ret(t, j0, j1) for t in picks) if r is not None]
            if not rr:
                row[s.lower()] = None
                continue
            gross = sum(rr) / len(rr)
            row[s.lower()] = gross - 2.0 * COST_SIDE * turn
            prev_hold[s] = held
            holdings_log.append({"rebalance": str(rd), "strategy": s,
                                 "names": " ".join(sorted(held)), "turnover": round(turn, 3)})
        prev_exposed = exposed
        monthly.append(row)
        if (k + 1) % 40 == 0 or k == len(rebals) - 1:
            print(f"  simulated {k + 1}/{len(rebals)}")

    # 8) artifacts
    with open(os.path.join(out_dir, "strat_monthly.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(monthly[0].keys()))
        w.writeheader(); w.writerows(monthly)
    with open(os.path.join(out_dir, "strat_holdings.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["rebalance", "strategy", "names", "turnover"])
        w.writeheader(); w.writerows(holdings_log)

    latest = {}
    rd = rebals[-1]
    latest["as_of"] = str(rd)
    latest["MOM"] = [t for _, t in mom_ranks(rd)][:max(N_MIN, min(N_MAX, len(uni_by_reb[rd]) // 5))]
    latest["LOWVOL"] = [t for _, t in vol_ranks(rd)][:max(N_MIN, min(N_MAX, len(uni_by_reb[rd]) // 5))]
    latest["INSIDER"] = insider_picks(rd)
    latest["COMBO"] = [t for t in latest["MOM"] if t in insider_any_buyers(rd)]
    latest["MOMG_exposed"] = bool(spy_sma[idx_of[rd]] and spy[idx_of[rd]] > spy_sma[idx_of[rd]])
    json.dump(latest, open(os.path.join(out_dir, "strat_latest.json"), "w"), indent=1)

    # 9) headline into the log
    def perf(col, rows):
        rs = [(r[col], r["spy"]) for r in rows if r[col] is not None and r["spy"] is not None]
        if len(rs) < 6:
            return None
        n = len(rs)
        wealth = spyw = 1.0
        for a, b in rs:
            wealth *= 1 + a; spyw *= 1 + b
        yrs = n / 12.0
        cagr = wealth ** (1 / yrs) - 1
        scagr = spyw ** (1 / yrs) - 1
        ex = [a - b for a, b in rs]
        m = sum(ex) / n
        sd = (sum((x - m) ** 2 for x in ex) / (n - 1)) ** 0.5
        t = m / (sd / n ** 0.5) if sd > 0 else 0
        dd, peak, w = 0.0, 1.0, 1.0
        for a, _ in rs:
            w *= 1 + a; peak = max(peak, w); dd = min(dd, w / peak - 1)
        return dict(months=n, cagr=round(100 * cagr, 2), spy_cagr=round(100 * scagr, 2),
                    excess_cagr=round(100 * (cagr - scagr), 2), t_monthly_excess=round(t, 2),
                    max_dd=round(100 * dd, 1))

    summary = {}
    for s in ("mom", "momg", "lowvol", "ew_universe"):
        summary[s] = perf(s, monthly)
    summary["insider"] = perf("insider", [r for r in monthly if r["insider"] is not None])
    summary["combo"] = perf("combo", [r for r in monthly if r["combo"] is not None])
    print("\nheadline (net of 10bps/side, price returns):")
    print(json.dumps(summary, indent=1))
    json.dump({"summary": summary, "params": {"cost_side": COST_SIDE, "n_min": N_MIN, "n_max": N_MAX,
               "rebalances": len(rebals), "start": str(rebals[0]), "end": str(rebals[-1]),
               "union_universe": len(all_tickers) - 1},
               "runtime_s": round(time.time() - t0, 1)},
              open(os.path.join(out_dir, "strat_meta.json"), "w"), indent=1)
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
