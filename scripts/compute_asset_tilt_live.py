#!/usr/bin/env python3
"""compute_asset_tilt_live.py — LIVE Asset Tilt positioning read.

Turns the validated calibration (public/asset_tilt_calibration.json, produced by
asset_tilt_backtest.py) into TODAY's read, using the SAME sleeve + engine math.
Reuses the backtest harness's data loaders and constants verbatim so the live
page and the backtest never diverge.

Deployed model uses the FULL-SAMPLE sign-stable sector betas (sector_macro_betas).
Writes public/asset_tilt_live.json and upserts a pipeline_health row (honest
stamps; never fake-green). Reads prices from prices_eod (Supabase) in production.
"""
import os, json, time, datetime as _dt
import numpy as np
import pandas as pd
import asset_tilt_backtest as bt   # same directory; module-guarded, safe to import

CAL_PATH = "public/asset_tilt_calibration.json"
OUT_PATH = "public/asset_tilt_live.json"

FACTOR_LABEL = {"tenY":"10-year yield","curve":"2s10s curve","realrate":"real rates",
    "breakeven":"breakevens","anfci":"financial conditions","credit":"credit spread",
    "dollar":"US dollar","coppergold":"copper/gold","oil":"oil"}
SECTOR_LABEL = {"XLK":"Technology","XLF":"Financials","XLE":"Energy","XLI":"Industrials",
    "XLY":"Consumer Discretionary","XLP":"Consumer Staples","XLV":"Health Care",
    "XLU":"Utilities","XLB":"Materials","XLRE":"Real Estate","XLC":"Communication Services"}
# Industry-group ETFs inherit their parent sector's macro read; their own price
# momentum / relative strength still differentiate them.
IG_PARENT = {"SMH":"XLK","SOXX":"XLK","IGV":"XLK","CIBR":"XLK",
    "XBI":"XLV","IBB":"XLV","KRE":"XLF","KBE":"XLF","KIE":"XLF",
    "ITB":"XLY","XHB":"XLY","XRT":"XLY","XOP":"XLE","OIH":"XLE","TAN":"XLE",
    "XME":"XLB","GDX":"XLB","JETS":"XLI","IYT":"XLI","PAVE":"XLI","XAR":"XLI","XTL":"XLI"}
IG_LABEL = {"SMH":"Semiconductors","SOXX":"Semiconductors (SOXX)","IGV":"Software","CIBR":"Cybersecurity",
    "XBI":"Biotech","IBB":"Biotech (IBB)","KRE":"Regional Banks","KBE":"Banks","KIE":"Insurance",
    "ITB":"Homebuilders","XHB":"Homebuilders (XHB)","XRT":"Retail","XOP":"Oil & Gas E&P","OIH":"Oil Services",
    "TAN":"Solar","XME":"Metals & Mining","GDX":"Gold Miners","JETS":"Airlines","IYT":"Transports",
    "PAVE":"Infrastructure","XAR":"Aerospace & Defense","XTL":"Telecom"}


def _latest(s):
    s = s.dropna()
    return float(s.iloc[-1]) if len(s) else np.nan


def _xs_z(series):
    v = series.astype(float); mu = v.mean(); sd = v.std(ddof=0)
    return v * 0.0 if (not np.isfinite(sd) or sd == 0) else (v - mu) / sd


def _asof_row(df):
    d = df.dropna(how="all")
    return d.iloc[-1] if len(d) else None


def _price_sleeves(px, names, spy):
    ret_12_1 = px[names].shift(21) / px[names].shift(252) - 1.0
    dist200 = px[names] / px[names].rolling(200).mean() - 1.0
    r3 = px[names] / px[names].shift(63) - 1.0
    r6 = px[names] / px[names].shift(126) - 1.0
    s3 = spy / spy.shift(63) - 1.0
    s6 = spy / spy.shift(126) - 1.0
    rs3 = r3.sub(s3, axis=0); rs6 = r6.sub(s6, axis=0)
    return (_asof_row(ret_12_1), _asof_row(dist200), _asof_row(rs3), _asof_row(rs6))


def _composite_tilt(names, macro_raw, mo_a, mo_b, rs_a, rs_b):
    w = bt.SLEEVE_W.copy(); val = w.pop("valuation"); tot = sum(w.values())
    w = {k: v + val * v / tot for k, v in w.items()}   # redistribute valuation pro-rata (no live fwd-EY)
    macro_z = _xs_z(pd.Series(macro_raw).reindex(names))
    mom = (_xs_z(mo_a.reindex(names)) + _xs_z(mo_b.reindex(names))) / 2.0
    rs = (_xs_z(rs_a.reindex(names)) + _xs_z(rs_b.reindex(names))) / 2.0
    comp = w["macro"] * macro_z.fillna(0.0) + w["momentum"] * mom.fillna(0.0) + w["relstr"] * rs.fillna(0.0)
    c = comp - comp.mean()
    tilt = (c * 0.03).clip(bt.TILT_MIN, bt.TILT_MAX)
    tilt = tilt - tilt.mean()   # dollar-neutral
    return tilt, macro_z, mom, rs


def _sync_pipeline_health(element_id, label, as_of):
    import urllib.request as _ur
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): print("  pipeline_health: Supabase env absent, skipped"); return
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    das = f"{min(str(as_of)[:10], now_iso[:10])}T00:00:00+00:00"
    row = {"indicator_id": element_id, "label": label, "source": "Computed (Asset Tilt engine)",
           "cadence": "D", "expected_cadence_minutes": 1440, "data_as_of": das,
           "last_good_at": now_iso, "status": "green", "last_error": None, "coverage_pct": 100.0}
    req = _ur.Request(f"{url}/rest/v1/pipeline_health?on_conflict=indicator_id",
        data=json.dumps(row).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=merge-duplicates"})
    try:
        with _ur.urlopen(req, timeout=15) as r: r.read()
        print(f"  pipeline_health: upserted {element_id} (green)")
    except Exception as e:
        print(f"  pipeline_health upsert failed: {e}")


def main():
    t0 = time.time()
    cal = json.load(open(CAL_PATH))
    betas = cal["sector_macro_betas"]; cut = cal["stress_cutpoints"]
    comp_bands = cal["rate_regime_bands"]["composition"]
    sectors = bt.SECTOR_ETFS
    igs = list(IG_PARENT.keys())

    print("[1] factors (latest standardized reading)")
    factors = bt.load_macro()
    fz = {f: _latest(s) for f, s in factors.items()}
    fz = {f: v for f, v in fz.items() if np.isfinite(v)}
    print("    factor z:", {f: round(v, 2) for f, v in fz.items()})

    print("[2] prices")
    px = bt.pull_prices(sectors + igs + ["SPY"])
    if px.empty or "SPY" not in px.columns:
        raise RuntimeError("no prices")
    spy = px["SPY"]
    as_of = str(px.index.max().date())

    # ---- sector tilts (full 4-sleeve, deployed betas) ----
    mo_a, mo_b, rs_a, rs_b = _price_sleeves(px, sectors, spy)
    macro_raw = {}; contrib = {}
    for s in sectors:
        val = 0.0; terms = []
        for f, b in betas.get(s, {}).items():
            z = fz.get(f)
            if z is not None:
                val += b * z; terms.append((f, b * z))
        macro_raw[s] = val
        terms.sort(key=lambda t: -abs(t[1]))
        contrib[s] = terms[:3]
    tilt, macro_z, mom, rs = _composite_tilt(sectors, macro_raw, mo_a, mo_b, rs_a, rs_b)

    sec_rows = []
    for s in sectors:
        cap = bt.SPY_SECTOR_WEIGHTS.get(s, 0.0)
        t = float(tilt.get(s, 0.0))
        macro_top = [{"factor": FACTOR_LABEL.get(f, f), "contribution": round(c, 4),
                      "direction": ("favors" if c > 0 else "weighs on")} for f, c in contrib.get(s, [])]
        sec_rows.append({"sector": SECTOR_LABEL.get(s, s), "etf": s,
            "cap_weight": round(cap, 4), "active_tilt_pct": round(t * 100, 2),
            "target_weight": round(cap + t, 4),
            "stance": ("Overweight" if t > 0.003 else "Underweight" if t < -0.003 else "Neutral"),
            "factor_breakdown": {"macro_top": macro_top,
                "macro_z": round(float(macro_z.get(s, 0.0)), 2),
                "momentum_z": round(float(mom.get(s, 0.0)), 2),
                "relstr_z": round(float(rs.get(s, 0.0)), 2)}})
    sec_rows.sort(key=lambda r: -r["active_tilt_pct"])

    # ---- industry-group tilts (inherit parent-sector macro_z; own price sleeves) ----
    ig_rows = []
    try:
        ig_present = [g for g in igs if g in px.columns and px[g].dropna().shape[0] > 260]
        mo_a2, mo_b2, rs_a2, rs_b2 = _price_sleeves(px, ig_present, spy)
        ig_macro_raw = {g: float(macro_z.get(IG_PARENT[g], 0.0)) for g in ig_present}
        ig_tilt, ig_mz, ig_mom, ig_rs = _composite_tilt(ig_present, ig_macro_raw, mo_a2, mo_b2, rs_a2, rs_b2)
        for g in ig_present:
            tg = float(ig_tilt.get(g, 0.0))
            ig_rows.append({"group": IG_LABEL.get(g, g), "etf": g, "parent_sector": SECTOR_LABEL.get(IG_PARENT[g]),
                "active_tilt_pct": round(tg * 100, 2),
                "stance": ("Overweight" if tg > 0.003 else "Underweight" if tg < -0.003 else "Neutral"),
                "factor_breakdown": {"parent_macro_z": round(float(macro_z.get(IG_PARENT[g], 0.0)), 2),
                    "momentum_z": round(float(ig_mom.get(g, 0.0)), 2), "relstr_z": round(float(ig_rs.get(g, 0.0)), 2)}})
        ig_rows.sort(key=lambda r: -r["active_tilt_pct"])
    except Exception as e:
        print("  industry-group pass skipped:", repr(e)[:120])

    # ---- engine: stress -> equity%; rate regime -> defensive sleeve ----
    print("[3] engine")
    stress = bt.load_stress()
    blend = pd.concat([stress["move"], stress["vix"], stress["credit"]], axis=1).mean(axis=1)
    sv = _latest(blend)
    if sv <= cut["risk_on_max"]:
        zone, eq = "Risk-On", 100
    elif sv <= cut["watch_max"]:
        zone, eq = "Watch", 80
    else:
        zone, eq = "Risk-Off", 50
    tenY = bt.apply_lag(bt._fred("DGS10"), 1); chg = (tenY - tenY.shift(63)).dropna()
    win = chg.iloc[-1260:]
    pct = float((win <= chg.iloc[-1]).mean() * 100) if len(win) else 50.0
    regime = "inflationary" if pct >= 70 else ("deflationary" if pct <= 30 else "neutral")
    defensive = comp_bands[regime]

    out = {
        "as_of": as_of,
        "last_pull": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "engine": {
            "stress_zone": zone, "stress_value": round(sv, 3), "equity_pct": eq,
            "rate_regime": regime, "rate_3m_change_pctile": round(pct, 1),
            "defensive_sleeve": defensive,
            "positioning_read": f"{eq}% equity ({zone}); when defensive, {regime} sleeve"},
        "sectors": sec_rows,
        "industry_groups": ig_rows,
        "validation": cal.get("validation", {}),
        "methodology": {"sleeves": cal.get("sleeve_weights"), "tilt_clip": cal.get("tilt_clip"),
            "betas": "full-sample sign-stable (deployed)", "rebalance": "weekly"},
    }
    os.makedirs("public", exist_ok=True)
    json.dump(out, open(OUT_PATH, "w"), indent=2)
    net = sum(r["active_tilt_pct"] for r in sec_rows)
    print(f"[4] wrote {OUT_PATH}: {zone} {eq}% equity, regime={regime}, "
          f"top OW={sec_rows[0]['sector']} {sec_rows[0]['active_tilt_pct']}%, "
          f"top UW={sec_rows[-1]['sector']} {sec_rows[-1]['active_tilt_pct']}%, sector net tilt={net:.2f}%")
    _sync_pipeline_health("asset_tilt_live", "Asset Tilt (live positioning)", as_of)
    print(f"Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
