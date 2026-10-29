"""
Shock scenarios WITH the crash brake — replay of the live rule through each episode.

Joe, 2026-10-29: "Is this scenario analysis calibrated correctly? It looks like
it's basically mirroring the index. I'd think we'd do better under stress given
our risk limits — risk reducing when MOVE index increases above certain
thresholds?"

He is right. The published table is S&P 500 peak-to-trough × beta, with no brake.
This script replays the LIVE brake rule (paper_portfolio/qt/brake.py, v2):

    stress = percentile of today's MOVE within its trailing 1,260 sessions
    ON  when stress > 0.95 on two consecutive closes -> sell everything at the NEXT open
    OFF when stress < 0.80                           -> buy back at the next open
    hysteresis between 0.80 and 0.95

through each episode, day by day, from the first day of the episode window with
the book fully invested, and reports the book's peak-to-trough fall WITH the
brake versus the no-brake beta-scaled figure.

Book daily return = beta x S&P 500 daily return when invested, 0 when in cash
(the paper account earns nothing on cash). The brake decision on day t uses
the close of day t and acts at the open of day t+1, so day t+1's return is
earned (or avoided) under the NEW state — the same one-day lag the 2026-09-10
study tested.

Data: public/indicator_history.json — `move` (ICE BofA MOVE, 2002-11-12 onward)
and `spx_index` (S&P 500 price index, 2006-01-03 onward). The 2000-02 episode
cannot be replayed: there is no MOVE data before November 2002 and no S&P
series before 2006 in the site's data, so that row stays at beta only and the
page says so.

Run:  python -m paper_portfolio.qt.research.risk_cockpit_2026-10-20.shock_brake_replay
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))
from paper_portfolio.qt.brake import next_state, pct_rank_last  # noqa: E402
from paper_portfolio.strategy_config import CONFIG  # noqa: E402

EPISODES = [
    ("gfc",   "2008 financial crisis", "2007-10-09", "2009-03-09"),
    ("tech",  "2000–02 tech bust",     "2000-03-24", "2002-10-09"),
    ("covid", "2020 COVID crash",      "2020-02-19", "2020-03-23"),
    ("y2022", "2022 rate shock",       "2022-01-03", "2022-10-12"),
]
WINDOW, ON, OFF = CONFIG.BRAKE_WINDOW, CONFIG.BRAKE_ON, CONFIG.BRAKE_OFF


def series(key: str) -> pd.Series:
    h = json.load(open(REPO / "public" / "indicator_history.json"))
    pts = [(d, v) for d, v in h[key]["points"] if v is not None]
    s = pd.Series({d: float(v) for d, v in pts})
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


def brake_states(move: pd.Series) -> pd.Series:
    """ON/OFF after each close, exactly as brake.py evaluates it (percentile of the
    trailing window, two consecutive readings to switch on, one to switch off)."""
    vals = move.values.tolist()
    out, prev, on = [], None, False
    for i in range(len(vals)):
        try:
            r = pct_rank_last(vals[: i + 1], WINDOW)
        except ValueError:
            out.append(False); prev = None; continue
        on = next_state(r, prev, on, ON, OFF)
        out.append(on); prev = r
    return pd.Series(out, index=move.index)


def replay(spx: pd.Series, state: pd.Series, beta: float, a: str, b: str, lead_days: int = 260):
    """Peak-to-trough of the index and of the beta-scaled book with the brake,
    over the episode window. `lead_days` of history before the window are used
    so the brake's state entering the window is the real one, not 'off'."""
    j = pd.concat([spx.rename("spx"), state.rename("on")], axis=1).dropna()
    win = j.loc[a:b]
    if win.empty:
        return None
    ret = j.spx.pct_change()
    # state decided at close t applies to return t+1
    invested = (~j.on.shift(1).fillna(False).astype(bool)).astype(float)
    book = (1 + beta * ret * invested).loc[a:b].cumprod()
    idx = (1 + ret).loc[a:b].cumprod()
    dd = lambda s: float((s / s.cummax() - 1).min())
    days_out = int((invested.loc[a:b] == 0).sum())
    flips = j.on.loc[a:b].astype(int).diff().fillna(0)
    on_dates = [d.date().isoformat() for d in flips[flips == 1].index]
    off_dates = [d.date().isoformat() for d in flips[flips == -1].index]
    entered_on = bool(j.on.shift(1).loc[a:b].iloc[0])
    return {
        "index_p2t": dd(idx), "book_beta_only": beta * dd(idx), "book_with_brake": dd(book),
        "book_end_to_end": float(book.iloc[-1] - 1),
        "sessions": int(len(win)), "sessions_in_cash": days_out,
        "entered_window_in_cash": entered_on, "brake_on": on_dates, "brake_off": off_dates,
    }


def main(beta: float = 1.03) -> dict:
    move, spx = series("move"), series("spx_index")
    state = brake_states(move)
    out = {}
    for sid, label, a, b in EPISODES:
        r = replay(spx, state, beta, a, b)
        out[sid] = {"label": label, **(r or {"note": "no MOVE/S&P data for this window"})}
    return out


if __name__ == "__main__":
    beta = float(sys.argv[1]) if len(sys.argv) > 1 else 1.03
    res = main(beta)
    print(f"beta {beta:.2f}; brake window {WINDOW} sessions, on >{ON} x2, off <{OFF}\n")
    print(f"{'episode':24} {'S&P p2t':>9} {'book@beta':>10} {'book+brake':>11} {'in cash':>8}  flips")
    for sid, r in res.items():
        if "note" in r:
            print(f"{r['label']:24} {'—':>9} {'—':>10} {'—':>11} {'—':>8}  {r['note']}"); continue
        print(f"{r['label']:24} {r['index_p2t']:>9.1%} {r['book_beta_only']:>10.1%} {r['book_with_brake']:>11.1%} "
              f"{r['sessions_in_cash']:>3}/{r['sessions']:<4}  on {r['brake_on']} off {r['brake_off']}"
              + ("  (entered window already in cash)" if r["entered_window_in_cash"] else ""))
