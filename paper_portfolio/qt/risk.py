"""
paper_portfolio.qt.risk — the Paper Portfolio cockpit's risk figures, computed
ONCE after each close and stored. The page reads one row.

    python -m paper_portfolio.qt.risk            # compute for the latest close, write qt_risk_daily
    python -m paper_portfolio.qt.risk --dry-run  # compute, print, write nothing

Why this exists (2026-10-21). The first cockpit computed these figures in the
browser on every page load: ~27 one-year price series pulled through one SQL
call. It worked all afternoon and timed out the next morning, when the
nightly ingest had drained the database's disk-IO budget — and the page
printed the raw database error to the reader. A risk figure is an end-of-day
number; it is computed by the job that records the close (QT-EOD-DAILY), with
its own health row, and the page never computes anything.

What is computed, at the CLOSE's weights, from one year (252 sessions) of
daily closes in prices_eod — the formulas are the ones re-derived and checked
in paper_portfolio/qt/research/risk_cockpit_2026-10-20/:

  vol        annualized volatility of the book's weighted daily return
  var1       1-day 99% VaR, historical simulation (1% quantile, linear
             interpolation), as a positive fraction of equity
  var10      var1 × √10 (the Basel 10-day convention)
  var1_norm  the normal-distribution cross-check
  risk_share per name: w·(Σw) / σ², sums to 1
  mctr       per name: (Σw) / σ
  beta, market, style, specific   two-stage regression: book on the S&P 500
             fund; the residual on five style funds minus the market
  shocks     per episode: the S&P 500 fund's peak-to-trough fall; the book at
             beta with NO brake (the old, index-mirroring figure); and the book
             at beta WITH the live crash brake replayed day by day through the
             episode (paper_portfolio/qt/brake.py rule: MOVE rank vs its last
             5 years > 0.95 two closes running -> cash at the next open; < 0.80
             -> back in). Cash earns nothing. The brake needs MOVE history,
             which starts 2002-11-12, so the 2000-02 row has no brake figure.
             Joe, 2026-10-29: the old table "basically mirrored the index" —
             it ignored the book's own risk control. Replay study:
             research/risk_cockpit_2026-10-20/shock_brake_replay.py.
  vix        S&P fund elasticity to Δln(VIX) since 2006 × ln(40 / VIX) × beta
  alerts     the exception rules the page prints (same thresholds); leverage
             fires at 105% gross, never on a small margin debit

Names with less than a year of prices are excluded and listed, never guessed
(LESSONS 4.9).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from . import data as D

SB_URL = D.SB_URL
FACT = {"momentum": "MTUM", "quality": "QUAL", "buybacks": "PKW", "size": "IWM", "value": "VLUE"}
WIN, CONF, HORIZON = 252, 0.99, 10
EPISODES = [
    ("gfc",   "2008 financial crisis", "2007-10-09", "2009-03-09"),
    ("tech",  "2000–02 tech bust",     "2000-03-24", "2002-10-09"),
    ("covid", "2020 COVID crash",      "2020-02-19", "2020-03-23"),
    ("y2022", "2022 rate shock",       "2022-01-03", "2022-10-12"),
]
# leverage: gross exposure (long market value / equity) above 105% — i.e. the
# account is borrowing more than 5% of the book. A few hundred dollars of
# margin debit from whole-share rounding is not a risk on a $1M book (Joe,
# 2026-10-21: "a rounding error you're highlighting as a risk").
RULES = {"concentration": 2.0, "drift": 1.5, "drawdown": -0.10, "liquidity_days": 1.0, "leverage": 1.05}


def _get(q: str):
    r = requests.get(f"{SB_URL}/rest/v1/{q}", headers=D._sb_headers(), timeout=120)
    r.raise_for_status()
    return r.json()


def brake_states(move: pd.Series) -> pd.Series:
    """ON/OFF after each close, evaluated exactly as the live brake does it:
    percentile of the close within the trailing window, two consecutive readings
    above ON to switch on, one reading below OFF to switch off."""
    from .brake import next_state, pct_rank_last
    from paper_portfolio.strategy_config import CONFIG
    vals = [float(v) for v in move.values]
    out, prev, on = [], None, False
    for i in range(len(vals)):
        try:
            r = pct_rank_last(vals[: i + 1], CONFIG.BRAKE_WINDOW)
        except ValueError:
            out.append(False); prev = None; continue
        on = next_state(r, prev, on, CONFIG.BRAKE_ON, CONFIG.BRAKE_OFF)
        out.append(on); prev = r
    return pd.Series(out, index=move.index, dtype=bool)


def shock_with_brake(spy: pd.Series, state: pd.Series, beta: float, a: str, b: str) -> dict | None:
    """Replay one episode: the index's peak-to-trough fall over [a, b], the book at
    beta with no brake, and the book at beta with the brake applied day by day.
    The state decided at close t governs day t+1's return (acts at the next open).
    Returns None when the window has no S&P or MOVE data."""
    j = pd.concat([spy.rename("spy"), state.rename("on")], axis=1, sort=True).dropna()
    win = j.loc[a:b]
    if len(win) < 2:
        return None
    ret = j.spy.pct_change()
    invested = (~j.on.shift(1).fillna(False).astype(bool)).astype(float)
    idx = (1 + ret).loc[a:b].cumprod()
    book = (1 + beta * ret * invested).loc[a:b].cumprod()
    p2t = lambda s: float((s / s.cummax() - 1).min())
    return {"index": p2t(idx), "book": beta * p2t(idx), "book_brake": p2t(book),
            "sessions": int(len(win)), "sessions_in_cash": int((invested.loc[a:b] == 0).sum())}


def closes(ticker: str, since: str) -> pd.Series:
    """One ticker's closes since a date, paged — one index probe per name."""
    df = D._sb_select("prices_eod", {"select": "trade_date,close", "ticker": f"eq.{ticker}",
                                     "trade_date": f"gte.{since}", "order": "trade_date.asc"})
    if df.empty:
        return pd.Series(dtype=float)
    s = pd.Series(df.close.astype(float).values, index=pd.to_datetime(df.trade_date))
    return s[s > 0]


def latest_close() -> dict | None:
    rows = _get("qt_nav_daily?select=d,equity,cash,long_mv,positions,account_number,created_at"
                "&n_positions=gt.0&order=d.desc&limit=1")
    return rows[0] if rows else None


def book_meta(rebalance_date: str) -> pd.DataFrame:
    rows = _get(f"qt_target_book?select=symbol,addv,target_dollars&rebalance_date=eq.{rebalance_date}")
    return pd.DataFrame(rows).set_index("symbol") if rows else pd.DataFrame()


def compute(nav: dict, vix: pd.Series | None, brake: dict | None, meta: pd.DataFrame,
            n_book: int, move: pd.Series | None = None) -> dict:
    equity = float(nav["equity"])
    w = pd.Series({p["symbol"]: float(p["mv"]) / equity for p in nav["positions"]})
    syms = list(w.index)
    since = (pd.Timestamp(nav["d"]) - pd.Timedelta(days=420)).date().isoformat()
    px = {t: closes(t, since) for t in syms + ["SPY"] + list(FACT.values())}
    short = [t for t in syms if len(px[t]) < WIN + 1]
    usable = [t for t in syms if t not in short]
    out: dict = {"d": nav["d"], "account_number": nav.get("account_number"), "equity": equity,
                 "weights": {k: round(float(v), 6) for k, v in w.items()},
                 "excluded": short, "n_sessions": 0}
    if not usable:
        return out
    panel = pd.DataFrame({t: px[t] for t in usable + ["SPY"] + list(FACT.values())}).dropna()
    rets = panel.pct_change().dropna().iloc[-WIN:]
    if len(rets) < 250:
        out["n_sessions"] = int(len(rets))
        return out
    R = rets[usable]
    wu = w[usable]
    rp = R @ wu
    out["n_sessions"] = int(len(rets))
    out["as_of"] = rets.index[-1].date().isoformat()
    sd = float(rp.std(ddof=1))
    out["vol"] = sd * math.sqrt(252)
    var1 = float(-np.quantile(rp, 1 - CONF))
    out["var1"], out["var10"] = var1, var1 * math.sqrt(HORIZON)
    out["var1_norm"] = 2.3263 * sd
    out["var10_usd"] = out["var10"] * equity
    cov = R.cov() * 252
    sigma_w = cov @ wu
    port_var = float(wu @ sigma_w)
    sigma = math.sqrt(port_var)
    out["risk_share"] = {s: round(float(wu[s] * sigma_w[s] / port_var), 6) for s in usable}
    out["mctr"] = {s: round(float(sigma_w[s] / sigma), 6) for s in usable}
    # decomposition
    rm = rets["SPY"]
    X1 = np.column_stack([np.ones(len(rm)), rm.values])
    b1, *_ = np.linalg.lstsq(X1, rp.values, rcond=None)
    e1 = rp.values - X1 @ b1
    beta = float(b1[1])
    var_p = float(rp.var(ddof=1))
    F = np.column_stack([rets[FACT[k]].values - rm.values for k in FACT])
    X2 = np.column_stack([np.ones(len(F)), F])
    b2, *_ = np.linalg.lstsq(X2, e1, rcond=None)
    e2 = e1 - X2 @ b2
    market = beta ** 2 * float(rm.var(ddof=1)) / var_p
    style = max((float(np.var(e1, ddof=1)) - float(np.var(e2, ddof=1))) / var_p, 0.0)
    specific = float(np.var(e2, ddof=1)) / var_p
    out.update({"beta": beta, "market": market, "style": style, "specific": specific,
                "r2_market": 1 - float(np.var(e1, ddof=1)) / var_p,
                "loadings": {k: round(float(b2[i + 1]), 6) for i, k in enumerate(FACT)}})
    # shocks off the full SPY history, with the live brake replayed through each
    spy = closes("SPY", "1996-01-01")
    state = brake_states(move) if move is not None and len(move) else None
    shocks = []
    for sid, label, a, b in EPISODES:
        try:
            ia, ib = float(spy[:a].iloc[-1]), float(spy[:b].iloc[-1])
            idx = ib / ia - 1
            row = {"id": sid, "label": label, "index": idx, "book": beta * idx, "book_brake": None}
            rep = shock_with_brake(spy, state, beta, a, b) if state is not None else None
            if rep:
                row.update({"book_brake": rep["book_brake"], "sessions": rep["sessions"],
                            "sessions_in_cash": rep["sessions_in_cash"]})
            shocks.append(row)
        except IndexError:
            shocks.append({"id": sid, "label": label, "index": None, "book": None, "book_brake": None})
    out["shocks"] = shocks
    if vix is not None and len(vix):
        j = pd.concat([spy.rename("spy"), vix.rename("vix")], axis=1, sort=True).dropna()
        if len(j) > 500:
            y = j.spy.pct_change().dropna().values
            x = np.log(j.vix).diff().dropna().values
            Xv = np.column_stack([np.ones(len(x)), x])
            bv, *_ = np.linalg.lstsq(Xv, y, rcond=None)
            now = float(j.vix.iloc[-1])
            move = float(bv[1]) * math.log(40 / now) if now < 40 else 0.0
            out["vix"] = {"elasticity": float(bv[1]), "vix_now": now, "index": move,
                          "book": beta * move, "n": int(len(y))}
    # alerts
    alerts = []
    cash = float(nav["cash"])
    if brake and brake.get("stress_on"):
        alerts.append({"level": "red", "code": "BRAKE", "text": f"Crash brake is ON — the book is in cash (bond-market stress {float(brake.get('composite') or 0):.2f}; it buys back below 0.80)."})
    gross = float(nav.get("long_mv") or 0) / equity if equity else 0.0
    out["gross_exposure"] = gross
    if gross >= RULES["leverage"]:
        alerts.append({"level": "amber", "code": "LEVERAGE", "text": f"The book is {gross * 100:.0f}% invested — it is borrowing ${abs(cash):,.0f} ({(gross - 1) * 100:.0f}% of equity) and paying interest on it until the next monthly rebalance."})
    peak = _get(f"qt_nav_daily?select=equity&account_number=eq.{nav.get('account_number')}&n_positions=gt.0&order=equity.desc&limit=1")
    if peak:
        dd = equity / max(float(peak[0]["equity"]), 1_000_000) - 1
        out["dd_from_peak"] = dd
        if dd <= RULES["drawdown"]:
            alerts.append({"level": "red", "code": "DRAWDOWN", "text": f"Book is {dd * 100:.1f}% below its own high (alert at {RULES['drawdown'] * 100:.0f}%)."})
    for s in usable:
        ratio = out["risk_share"][s] / float(w[s])
        if ratio >= RULES["concentration"]:
            alerts.append({"level": "amber", "code": "CONCENTRATION", "sym": s, "text": f"causes {out['risk_share'][s] * 100:.1f}% of the book's day-to-day swings while holding {w[s] * 100:.1f}% of the money — {ratio:.1f} times its share."})
    target = 1.0 / n_book if n_book else None
    for s in syms:
        if target and w[s] >= RULES["drift"] * target:
            alerts.append({"level": "amber", "code": "DRIFT", "sym": s, "text": f"has grown to {w[s] * 100:.1f}% of the book against a {target * 100:.1f}% target — it is trimmed back at the next monthly rebalance."})
    dtl = {}
    for s in syms:
        if s in meta.index and pd.notna(meta.loc[s, "addv"]) and float(meta.loc[s, "addv"]) > 0:
            mv = w[s] * equity
            dtl[s] = mv / (0.2 * float(meta.loc[s, "addv"]))
            if dtl[s] > RULES["liquidity_days"]:
                alerts.append({"level": "amber", "code": "LIQUIDITY", "sym": s, "text": f"would take about {dtl[s]:.1f} days to sell without moving the price."})
    out["exit_days"] = {k: round(float(v), 3) for k, v in dtl.items()}
    for s in short:
        alerts.append({"level": "grey", "code": "DATA", "sym": s, "text": "has less than a year of price history, so it is left out of the risk figures until it has one."})
    order = {"red": 0, "amber": 1, "grey": 2}
    out["alerts"] = sorted(alerts, key=lambda a: order[a["level"]])
    return out


def write(row: dict) -> None:
    h = dict(D._sb_headers())
    h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    body = {
        "d": row["d"], "account_number": row.get("account_number"), "equity": row["equity"],
        "as_of": row.get("as_of"), "n_sessions": row["n_sessions"],
        "vol": row.get("vol"), "var1": row.get("var1"), "var10": row.get("var10"),
        "var1_norm": row.get("var1_norm"), "beta": row.get("beta"), "market": row.get("market"),
        "style": row.get("style"), "specific": row.get("specific"), "r2_market": row.get("r2_market"),
        "dd_from_peak": row.get("dd_from_peak"),
        # gross_exposure is the figure the leverage alert was checked against;
        # the Paper page prints it in the all-clear line (2026-10-29), so the
        # sentence can never contradict the Exposure tile beside it.
        "detail": {k: row.get(k) for k in ("weights", "risk_share", "mctr", "loadings", "shocks", "vix",
                                           "alerts", "excluded", "exit_days", "gross_exposure")},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{SB_URL}/rest/v1/qt_risk_daily?on_conflict=d,account_number",
                      headers=h, json=[body], timeout=120)
    r.raise_for_status()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    nav = latest_close()
    if not nav:
        print("no held close to measure", flush=True)
        return 0
    book = _get("qt_target_book?select=rebalance_date&order=rebalance_date.desc&limit=1")
    rd = book[0]["rebalance_date"] if book else None
    meta = book_meta(rd) if rd else pd.DataFrame()
    brake = (_get("qt_brake_state?select=stress_on,composite&order=d.desc&limit=1") or [None])[0]
    vix = move = None
    try:
        # The repo's own indicator history (the workflow runs on a checkout); the
        # live site's copy is the fallback. Its absence costs one line, not the run.
        # MOVE is the same series the live brake reads, so the replayed brake in
        # the shock table and the real brake see identical data.
        from pathlib import Path
        f = Path(__file__).resolve().parents[2] / "public" / "indicator_history.json"
        hist = (json.loads(f.read_text()) if f.exists()
                else requests.get("https://www.macrotilt.com/indicator_history.json", timeout=60).json())
        vix = pd.Series({pd.Timestamp(d): float(c) for d, c in hist["vix"]["points"] if c is not None}).sort_index()
        move = pd.Series({pd.Timestamp(d): float(c) for d, c in hist["move"]["points"] if c is not None}).sort_index()
    except Exception as e:  # noqa: BLE001
        print(f"indicator history unavailable ({e}); VIX shock and brake replay omitted", flush=True)
    row = compute(nav, vix, brake, meta, len(meta), move)
    summary = {k: row.get(k) for k in ("d", "as_of", "n_sessions", "vol", "var1", "var10", "beta", "market", "style", "specific", "excluded")}
    print(json.dumps(summary, indent=1, default=str), flush=True)
    if args.dry_run:
        json.dump(row, open("/tmp/qt_risk_row.json", "w"), default=str)
        return 0
    write(row)
    print(f"wrote qt_risk_daily for {row['d']} ({row['n_sessions']} sessions)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
