#!/usr/bin/env python3
"""
LSE-ARCHIVE-IV — nightly EOD implied vol for names the LIVE options feed skips.

Joe-approved 2026-07-28 (chat), sized in the skew-density study's Coverage tab:
KTOS/RCAT/HUT get a real ATM-IV term structure on ~93-100% of days from the
LSE research archive (previous close, one-day lag); PLSE ~46%. The skew
SIGNAL was NO-GO — this job ships ONLY coverage: dated archive IV rows into
lse_iv_term (source='archive'), replacing the Portfolio Lab CAPM fallback.

Design (LESSONS-driven):
- Targets = tickers in saved Lab portfolios on the Implied vol method, plus
  any symbol lse_iv_term currently marks uncovered (dte=-1) or already serves
  from the archive. Names with fresh LIVE rows are skipped (live wins).
- Vendor budget: archive exports are capped at 5/hour account-wide; this job
  submits at most MAX_EXPORTS per run, oldest-served-first. Tiny payloads
  (<1 MB/name/week) — irrelevant vs the 50 GB/month cap.
- IV math mirrors the study pipeline (validated by hand-computed paper
  checks 2026-07-28): computed dte from expiry (vendor dte stamps are stale),
  strike within ±10% of the day's close, discounted Black-76 against
  F = S·e^{rT} with the 3M Treasury rate. Trade closes, OTM side preferred.
- Stamp-after-publish (4.2 / 2026-06-12): pipeline_health 'lse_archive_iv'
  goes green only AFTER rows land; red with the error on any failure.
- Partial-run honesty (4.5): a name that yields no usable IVs is logged and
  left untouched (its live marker stands -> site keeps the honest CAPM
  fallback). The run only FAILS on infrastructure errors, not thin chains.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import pandas as pd

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
VAULT = "https://api.londonstrategicedge.com/vault"
MAX_EXPORTS = 4          # per run; account cap is 5/hour shared
EXPORT_LOOKBACK_D = 7    # calendar days of prints to request
MIN_DTE, MAX_DTE = 3, 550
ATM_BAND = 0.10          # strike within ±10% of close (site convention)


def sb(path, method="GET", body=None, prefer="return=representation"):
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/{path}", method=method,
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                 "Content-Type": "application/json", "Prefer": prefer},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else None


def lse(path, method="GET", body=None, raw=False, params=""):
    req = urllib.request.Request(
        f"{VAULT}{path}{params}", method=method,
        headers={"x-api-key": LSE_KEY, "Content-Type": "application/json",
                 "User-Agent": "macrotilt-archive-iv"},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read() if raw else json.load(r)


def stamp(ok, data_as_of=None, err=None):
    now = datetime.now(timezone.utc).isoformat()
    body = ({"status": "green", "last_good_at": now, "last_check_at": now,
             "last_error": None, "updated_at": now}
            if ok else
            {"status": "red", "last_check_at": now,
             "last_error": str(err)[:400], "updated_at": now})
    if ok and data_as_of:
        body["data_as_of"] = f"{data_as_of}T20:00:00Z"  # NYSE close of the print date
    sb("pipeline_health?indicator_id=eq.lse_archive_iv", "PATCH", body,
       prefer="return=minimal")


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def b76_iv(price_undisc, F, K, T, cp):
    """Implied vol via bisection on undiscounted Black-76. None if unpriceable."""
    intrinsic = max((F - K) * cp, 0.0)
    upper = F if cp == 1 else K
    if not (intrinsic < price_undisc < upper):
        return None
    lo, hi = 1e-4, 15.0
    def px(s):
        v = s * math.sqrt(T)
        d1 = (math.log(F / K) + 0.5 * v * v) / v
        return cp * (F * norm_cdf(cp * d1) - K * norm_cdf(cp * (d1 - v)))
    if not (px(lo) <= price_undisc <= px(hi)):
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if px(mid) < price_undisc:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def targets():
    """Symbols needing archive IV, oldest-served first. Live-covered names skip."""
    rows = sb("lse_iv_term?select=symbol,dte,source,as_of,fetched_at")
    by_sym = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], []).append(r)
    # Saved Lab portfolios: tickers on the Implied vol method
    lab = sb("portfolio_lab_portfolios?select=holdings")
    lab_ivol = set()
    for p in lab or []:
        for h in (p.get("holdings") or []):
            if isinstance(h, dict) and str(h.get("method", "")).lower() in ("ivol", "implied vol", "impliedvol"):
                lab_ivol.add(str(h.get("ticker", "")).upper())
    out = []
    for sym in sorted(lab_ivol | set(by_sym)):
        rows_s = by_sym.get(sym, [])
        has_live = any(r["source"] == "live" and (r["dte"] or -1) >= 0 for r in rows_s)
        if has_live:
            continue  # live feed covers it — nothing to do
        last_asof = max((str(r.get("as_of") or "") for r in rows_s), default="")
        out.append((last_asof, sym))
    out.sort()  # oldest archive data (or never-served: '') first
    return [s for _, s in out]


def underlying_close(sym, upto_date):
    bars = lse("/candles", params=f"?symbol={sym}&timeframe=1d&order=desc&limit=10")
    for b in bars:
        d = str(b.get("ts", ""))[:10]
        if d <= upto_date:
            return d, float(b["close"])
    return None, None


def archive_prints(sym, start, end):
    job = lse("/export", "POST", {"dataset": "options", "symbol": sym,
                                  "start": start, "end": end,
                                  "timeframe": "1d", "format": "parquet"})
    jid = job.get("job_id")
    if not jid:
        raise RuntimeError(f"export submit: {str(job)[:200]}")
    for _ in range(30):
        time.sleep(6)
        st = lse(f"/export/{jid}")
        if st.get("status") == "ready":
            break
        if st.get("status") in ("failed", "error"):
            raise RuntimeError(f"export failed: {st.get('error')}")
    else:
        raise RuntimeError("export poll timeout")
    blob = lse(f"/export/{jid}/download", raw=True)
    tmp = f"/tmp/aiv_{sym}.parquet"
    with open(tmp, "wb") as f:
        f.write(blob)
    df = pd.read_parquet(tmp)
    df["date"] = df["ts"].astype(str).str[:10]
    df["expiry"] = df["expiry"].astype(str).str[:10]
    return df


def term_structure(sym, r3m):
    """Latest print day's ATM IV per expiry from the archive. ([], asof) if thin."""
    end = datetime.now(timezone.utc).date().isoformat()
    start = (datetime.now(timezone.utc).date() - timedelta(days=EXPORT_LOOKBACK_D)).isoformat()
    df = archive_prints(sym, start, end)
    if df.empty:
        return [], None, None
    asof = df["date"].max()
    px_date, S = underlying_close(sym, asof)
    if S is None:
        return [], None, None
    day = df[df["date"] == asof]
    out = []
    for expiry, g in day.groupby("expiry"):
        T_days = (pd.Timestamp(expiry) - pd.Timestamp(asof)).days  # computed, never vendor dte
        if not (MIN_DTE <= T_days <= MAX_DTE):
            continue
        T = T_days / 365.0
        F = S * math.exp(r3m * T)
        # nearest strike to close within the ATM band; prefer the OTM side's contract
        g = g.assign(dist=(g["strike"].astype(float) / S - 1).abs()).sort_values("dist")
        got = None
        for _, o in g.iterrows():
            K = float(o["strike"])
            if abs(K / S - 1) > ATM_BAND:
                break
            cp = 1 if str(o["opt_type"]).upper().startswith("C") else -1
            iv = b76_iv(float(o["close"]) * math.exp(r3m * T), F, K, T, cp)
            if iv and 0.01 < iv < 5.0:
                got = {"expiry": expiry, "dte": T_days, "iv": round(iv, 6), "strike": K}
                break
        if got:
            out.append(got)
    out.sort(key=lambda x: x["dte"])
    return out, asof, S


def main():
    global LSE_KEY
    LSE_KEY = sb("rpc/get_lse_api_key", "POST", {})
    if not isinstance(LSE_KEY, str) or not LSE_KEY:
        raise RuntimeError("LSE key unavailable from vault accessor")
    r3m_rows = lse("/series", params="?symbol=US3M&order=desc&limit=1")
    r3m = float(r3m_rows[0]["value"]) / 100.0 if r3m_rows else 0.04

    syms = targets()[:MAX_EXPORTS]
    print(f"targets this run: {syms}")
    written, skipped, newest_asof = [], [], None
    for sym in syms:
        try:
            term, asof, S = term_structure(sym, r3m)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"{sym}: export quota hit — remaining names carry to next run")
                break
            raise
        if not term:
            skipped.append(sym)
            print(f"{sym}: no usable ATM prints in window — leaving honest fallback")
            continue
        now_iso = datetime.now(timezone.utc).isoformat()
        rows = [{"symbol": sym, "expiry": t["expiry"], "dte": t["dte"], "iv": t["iv"],
                 "strike": t["strike"], "underlying_price": S, "contract_updated_at": None,
                 "fetched_at": now_iso, "source": "archive", "as_of": asof} for t in term]
        sb(f"lse_iv_term?symbol=eq.{sym}", "DELETE", prefer="return=minimal")
        sb("lse_iv_term", "POST", rows, prefer="return=minimal")
        written.append(sym)
        newest_asof = max(newest_asof or "", asof)
        print(f"{sym}: {len(rows)} expiries, as of {asof}, close {S}")

    # Green even on a quiet night (job ran; nothing needed writing is healthy).
    stamp(True, data_as_of=newest_asof)
    print(f"done: wrote {written or 'none'}, thin/skipped {skipped or 'none'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — red-stamp then fail loud
        try:
            stamp(False, err=e)
        finally:
            print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)
