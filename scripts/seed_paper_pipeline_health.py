"""seed_paper_pipeline_health.py — one-shot, standalone seed/refresh of the
three paper pipeline_health rows so the Paper Portfolio freshness chips read
real status (not fake-green) and the Recent-rebalances chip's positions
dependency resolves.

Standalone on purpose: it does NOT import paper_portfolio (no Alpaca / heavy
deps), so the dispatch-only workflow needs nothing but `requests`. Mirrors the
logic of paper_portfolio.mirror.stamp_paper_pipeline_health.

Auth: SUPABASE_ACCESS_TOKEN (Supabase Management API). No trading, no vendors —
touches only the pipeline_health table.
"""
import os
import sys
import requests

PROJECT_REF = "yqaqqzseepebrocgibcw"
FEEDS = [
    ("paper-nav-daily",          "public.paper_nav_daily",  "snapshot_date",
     "Paper Portfolio · Daily NAV",          "Alpaca paper account"),
    ("paper-positions-snapshot", "public.paper_positions",  "snapshot_date",
     "Paper Portfolio · Positions snapshot", "Alpaca + prices_eod"),
    ("paper-orders-intent",      "public.paper_orders",     "created_at",
     "Paper Portfolio · Order intents",      "Paper engine + Alpaca"),
]


def _q(sql: str):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN required")
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql}, timeout=30,
    )
    r.raise_for_status()
    return r.json()


def _esc(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def main():
    rows = []
    for ind_id, table, col, label, source in FEEDS:
        res = _q(f"select max({col})::text as d from {table};")
        d = res[0].get("d") if res else None
        if not d:
            print(f"  skip {ind_id}: no rows in {table}")
            continue
        as_of = f"{d}T00:00:00+00:00" if len(d) == 10 else d
        rows.append("(" + ", ".join([
            _esc(ind_id), _esc(label), _esc(source), "'D'", "'green'",
            _esc(as_of), "now()", _esc(as_of), "NULL", "now()",
        ]) + ")")
        print(f"  stamp {ind_id}: data_as_of={as_of}")
    if not rows:
        sys.exit("no paper source dates found — nothing to stamp")
    ids = ", ".join(_esc(f[0]) for f in FEEDS)
    sql = (
        f"delete from public.pipeline_health where indicator_id in ({ids}); "
        "insert into public.pipeline_health "
        "(indicator_id, label, source, cadence, status, last_good_at, "
        " last_check_at, data_as_of, last_error, updated_at) values "
        + ", ".join(rows) + ";"
    )
    _q(sql)
    print(f"done: stamped {len(rows)} paper pipeline_health rows")


if __name__ == "__main__":
    main()
