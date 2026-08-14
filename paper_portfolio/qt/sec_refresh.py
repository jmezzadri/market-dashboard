"""
paper_portfolio.qt.sec_refresh — refill qt_fundamentals from SEC XBRL.

    python -m paper_portfolio.qt.sec_refresh --since 2022-01-01

Downloads SEC's companyfacts bulk archive (~1.4 GB, free, no key) and keeps
only the nine tags the v3 scorer reads. Runs monthly; the archive is rebuilt
nightly by the SEC so a monthly cadence is never more than ~30 days stale, and
`filed` gating means stale data is simply invisible rather than wrong.

Ticker->CIK comes from SEC's company_tickers.json, which maps ONLY companies
that still exist. That file is why the first quality build was survivorship-
biased: joining on it silently deleted every company that had died. It is safe
HERE because production scores today's live universe — but any historical
research must match dead companies by name instead. See QUALITY_TREND_V3.md.
"""
from __future__ import annotations

import argparse
import io
import json
import zipfile
from datetime import date

import pandas as pd
import requests

from . import data as D

UA = {"User-Agent": "MacroTilt research contact@macrotilt.com"}
FACTS_ZIP = "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"
TICKERS = "https://www.sec.gov/files/company_tickers.json"
FORMS = ("10-K", "10-Q")


def ticker_map() -> dict[str, int]:
    j = requests.get(TICKERS, headers=UA, timeout=120).json()
    return {str(v["ticker"]).upper(): int(v["cik_str"]) for v in j.values()}


def refresh(since: str = "2022-01-01", limit: int | None = None) -> int:
    sym2cik = ticker_map()
    print(f"ticker map: {len(sym2cik):,} live companies", flush=True)

    print("downloading companyfacts.zip (~1.4 GB) …", flush=True)
    r = requests.get(FACTS_ZIP, headers=UA, timeout=3600, stream=True)
    r.raise_for_status()
    buf = io.BytesIO(r.content)
    z = zipfile.ZipFile(buf)

    rows, n = [], 0
    for sym, cik in sym2cik.items():
        if limit and n >= limit:
            break
        try:
            d = json.loads(z.read(f"CIK{cik:010d}.json"))
        except Exception:
            continue
        n += 1
        g = d.get("facts", {}).get("us-gaap", {})
        for tag in D.SEC_TAGS:
            for unit, arr in (g.get(tag, {}).get("units", {}) or {}).items():
                if unit not in ("USD", "shares"):
                    continue
                for it in arr:
                    if it.get("form") not in FORMS:
                        continue
                    if not it.get("filed") or it.get("val") is None or not it.get("end"):
                        continue
                    if it["filed"] < since:
                        continue
                    rows.append((sym, tag, it["end"], it["filed"], it.get("fp"), float(it["val"])))
        if n % 1000 == 0:
            print(f"  {n:,} companies · {len(rows):,} facts", flush=True)

    df = pd.DataFrame(rows, columns=["symbol", "tag", "period_end", "filed", "fp", "val"])
    df = df.sort_values("filed").drop_duplicates(["symbol", "tag", "period_end"], keep="last")
    print(f"parsed {len(df):,} facts across {df.symbol.nunique():,} companies", flush=True)

    h = dict(D._sb_headers())
    h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    url = f"{D.SB_URL}/rest/v1/qt_fundamentals?on_conflict=symbol,tag,period_end"
    recs = df.to_dict("records")
    for i in range(0, len(recs), 2000):
        resp = requests.post(url, headers=h, json=recs[i:i + 2000], timeout=300)
        resp.raise_for_status()
        if i % 50000 == 0:
            print(f"  upserted {i:,}/{len(recs):,}", flush=True)
    print(f"qt_fundamentals refreshed: {len(recs):,} rows", flush=True)
    return len(recs)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2022-01-01")
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    refresh(a.since, a.limit)
