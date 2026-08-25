"""
paper_portfolio.qt.reconcile — nightly custody check for the Quality Trend book.

Answers one question every night: did anything about our holdings change for a
reason we cannot point at a trade for?

Two independent tests, both run against the broker's own numbers:

  1. VALUE IDENTITY   sum(position market values) + cash == equity.
     If the broker reports an equity that its own positions and cash do not add
     up to, something has been written off outside the trade ledger.

  2. UNEXPLAINED HOLDING CHANGE   for every symbol, the change in share count
     since the previous snapshot must equal the net shares filled since that
     snapshot. A position that shrinks, grows or disappears with no matching
     fill is a custody error, not a trade.

WHY THIS EXISTS (2026-08-25): 243 shares of EBAY, bought 2026-08-17 and worth
$25,993.71 at the 8/24 close, vanished from paper account PA3G9FV5AN1G
overnight with no sell order, no fill record, no corporate action and no change
to cash. Nothing in the system compared one night's holdings to the next, so a
$26k hole sat in the book for six trading days until Joe asked why performance
looked wrong. Roughly a third of that week's reported drawdown was this hole.

    python -m paper_portfolio.qt.reconcile

Read-only at the broker. Raises ReconcileError when a test fails, which fails
its QT-EOD-DAILY step, which is what puts the alert in Joe's inbox. It runs as
its own step AFTER the pipeline-health stamp, on purpose: a vanished holding is
a custody problem, not a stale-data problem, and it must not turn the site's
freshness chip red.
"""
from __future__ import annotations

import sys

import requests

from . import data as D

# Lines tagged with this marker are lifted VERBATIM into the alert email Joe
# reads (see .github/workflows/WORKFLOW_FAILURE_ALERT.yml). Everything else a
# failing job prints — tracebacks, module paths, pip noise — is discarded.
# Write these in plain English: he is not an engineer and will not open a log.
PLAIN_MARK = "::macrotilt-plain::"

# Equity vs positions+cash never ties to the cent (quote timing across the
# snapshot). A dollar of drift is noise; a tenth of a percent is a hole.
VALUE_TOL_ABS = 25.0
VALUE_TOL_PCT = 0.0005
# Fractional-share rounding; anything at or above this is a real share count.
QTY_TOL = 0.001


class ReconcileError(RuntimeError):
    """A holding changed, or value went missing, with no trade behind it."""


def _prev_snapshot(today: str, account: str | None) -> dict | None:
    """The previous snapshot OF THE SAME ACCOUNT.

    Scoped to one account on purpose (2026-08-25). When the book restarts on a
    new paper account, the previous calendar day's snapshot belongs to a
    different book: comparing across that boundary would report all 40 holdings
    as vanished on day one. A new account simply has nothing to compare against
    yet, which is the honest answer.
    """
    params = {"select": "d,created_at,equity,cash,positions,account_number",
              "d": f"lt.{today}", "order": "d.desc", "limit": "1"}
    if account:
        params["account_number"] = f"eq.{account}"
    r = requests.get(f"{D.SB_URL}/rest/v1/qt_nav_daily",
                     headers=D._sb_headers(), params=params, timeout=60)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def _fills_since(cutoff_iso: str, until_iso: str | None = None) -> dict[str, float]:
    """Net signed shares filled per symbol in the window. Buys +, sells -."""
    H = D._alpaca_headers()
    net: dict[str, float] = {}
    page_token = None
    for _ in range(50):  # 50 x 100 fills is far beyond any real day
        params = {"after": cutoff_iso, "page_size": 100, "direction": "asc"}
        if until_iso:
            params["until"] = until_iso
        if page_token:
            params["page_token"] = page_token
        r = requests.get(f"{D.ALPACA_TRADE}/v2/account/activities/FILL",
                         headers=H, params=params, timeout=60)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        for a in batch:
            sym = a["symbol"]
            qty = float(a["qty"])
            net[sym] = net.get(sym, 0.0) + (qty if a["side"] == "buy" else -qty)
        if len(batch) < 100:
            break
        page_token = batch[-1]["id"]
    return net


def check(today_row: dict, *, until: str | None = None) -> list[str]:
    """Return a list of human-readable problems. Empty list means clean."""
    problems: list[str] = []

    equity = float(today_row["equity"])
    cash = float(today_row["cash"])
    positions = today_row.get("positions") or []
    mv = sum(float(p["mv"]) for p in positions)

    # ── test 1: value identity ───────────────────────────────────────────
    gap = equity - (mv + cash)
    tol = max(VALUE_TOL_ABS, VALUE_TOL_PCT * equity)
    if abs(gap) > tol:
        problems.append(
            f"Account value does not add up. Holdings ${mv:,.2f} plus cash "
            f"${cash:,.2f} is ${mv + cash:,.2f}, but the broker reports equity "
            f"of ${equity:,.2f} — a gap of ${gap:,.2f}."
        )

    # ── test 2: every holding change explained by a fill ─────────────────
    account = today_row.get("account_number")
    prev = _prev_snapshot(today_row["d"], account)
    if not prev:
        print(f"reconcile: first snapshot for account {account or '(unknown)'} — "
              f"nothing to compare holdings against yet, value check only",
              flush=True)
        return problems

    cutoff = prev.get("created_at") or f"{prev['d']}T20:00:00Z"
    cutoff = cutoff.replace(" ", "T")
    if not cutoff.endswith("Z") and "+" not in cutoff[10:]:
        cutoff += "Z"

    prev_qty = {p["symbol"]: float(p["qty"]) for p in (prev.get("positions") or [])}
    today_qty = {p["symbol"]: float(p["qty"]) for p in positions}
    fills = _fills_since(cutoff, until_iso=until)

    for sym in sorted(set(prev_qty) | set(today_qty) | set(fills)):
        before = prev_qty.get(sym, 0.0)
        after = today_qty.get(sym, 0.0)
        traded = fills.get(sym, 0.0)
        expected = before + traded
        drift = after - expected
        if abs(drift) < QTY_TOL:
            continue
        if after == 0 and before > 0 and traded == 0:
            problems.append(
                f"{sym}: {before:,.0f} shares disappeared. Held at the previous "
                f"snapshot ({prev['d']}), absent now, and no trade in {sym} since."
            )
        elif before == 0 and traded == 0:
            problems.append(
                f"{sym}: {after:,.0f} shares appeared with no purchase since "
                f"the previous snapshot ({prev['d']})."
            )
        else:
            problems.append(
                f"{sym}: share count does not reconcile. Held {before:,.0f} at "
                f"{prev['d']}, net {traded:+,.0f} traded since, so {expected:,.0f} "
                f"expected — but the broker shows {after:,.0f} "
                f"({drift:+,.0f} unaccounted for)."
            )
    return problems


def run(today_row: dict, *, raise_on_fail: bool = True) -> list[str]:
    problems = check(today_row)
    if not problems:
        print(f"reconcile {today_row['d']}: clean — "
              f"{len(today_row.get('positions') or [])} holdings, "
              f"value ties, every share change matched to a trade", flush=True)
        return problems
    header = (f"Something changed in the paper book on {today_row['d']} that no "
              f"trade explains:")
    for line in [header] + [f"\u2022 {p}" for p in problems]:
        print(f"{PLAIN_MARK}{line}", flush=True)
    if raise_on_fail:
        raise ReconcileError(header + " " + " ".join(problems))
    return problems


def _latest_row() -> dict:
    r = requests.get(
        f"{D.SB_URL}/rest/v1/qt_nav_daily",
        headers=D._sb_headers(),
        params={"select": "d,equity,cash,positions,account_number",
                "order": "d.desc", "limit": "1"},
        timeout=60,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise ReconcileError("qt_nav_daily is empty — nothing to reconcile.")
    return rows[0]


if __name__ == "__main__":
    # Exit non-zero WITHOUT a traceback: the job must fail (that is what sends the
    # alert), but a Python stack trace interleaves with the message in the GitHub
    # log and is noise to the person who ends up reading it.
    try:
        run(_latest_row())
    except ReconcileError:
        sys.exit(1)
