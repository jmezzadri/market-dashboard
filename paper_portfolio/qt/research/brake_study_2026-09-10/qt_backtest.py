"""Quality Trend v3 walk-forward backtest — production-twin logic, survivorship-free.

Inputs (built by pull_prices.py / extract_facts.py / insiders.parquet):
  prices_raw/*.parquet   symbol, d, o, c, v   (Alpaca, adjustment=all, SIP, delisted included)
  facts.parquet          cik, tag, period_end, filed, fp, val   (SEC companyfacts, all CIKs)
  entities.parquet       cik, name
  company_tickers.json   live ticker -> cik
  universe_assets.json   Alpaca assets (active + inactive, non-OTC, funds removed)
  insiders.parquet       as_of, ticker, conv  (Postgres replica of data.insiders())

Rules replicated from paper_portfolio/qt/score.py + strategy_config.py + qt_quality():
  score on the LAST close of the month, trade at the OPEN of the first session of the
  next month (signal lags execution by a session), equal weight, hold-until-out-of-top-25%.
Outputs: daily book series (close-to-close, plus the close->open and open->close legs
so an overlay can be executed at the open), holdings per rebalance, summary metrics.
"""
from __future__ import annotations
import glob, json, re, sys
import numpy as np, pandas as pd

N_POS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
COST = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0005   # per side, on traded notional
TAG = sys.argv[3] if len(sys.argv) > 3 else f"n{N_POS}"

W = {"mom12": 0.45, "mom6": 0.30, "trend": 0.15, "mdd": 0.10}
WF = {"gp_a": 0.15, "ocf_a": 0.10, "iss": 0.20}
W_INS = 0.20
EXIT_BAND = 0.25
MIN_ADDV, MIN_PRICE, MAX_VOL, MIN_LIQ, MIN_NZ = 100e6, 5.0, 0.70, 0.95, 0.90
LOWER = {"vol", "mdd"}

# ───────────────────────── prices ─────────────────────────
px = pd.concat([pd.read_parquet(f) for f in sorted(glob.glob("prices_raw/*.parquet"))], ignore_index=True)
px = px[(px.c > 0)]
C = px.pivot(index="d", columns="symbol", values="c").sort_index()
O = px.pivot(index="d", columns="symbol", values="o").sort_index().reindex(columns=C.columns)
V = px.pivot(index="d", columns="symbol", values="v").sort_index().reindex(columns=C.columns).fillna(0)
del px
print(f"panel {C.shape[0]} sessions x {C.shape[1]} symbols, {C.index[0].date()} .. {C.index[-1].date()}", flush=True)
last_valid = C.apply(lambda s: s.last_valid_index())

# ───────────────────────── fundamentals ─────────────────────────
facts = pd.read_parquet("facts.parquet")
ents = pd.read_parquet("entities.parquet")
tick = json.load(open("company_tickers.json"))
live = {str(v["ticker"]).upper(): int(v["cik_str"]) for v in tick.values()}
assets = json.load(open("universe_assets.json"))

SUFFIX = r"\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|llc|lp|l p|holdings|holding|group|the|common stock|ordinary shares|class a|class b|class c|depositary shares|american depositary shares|each representing|adr|ads|n v|nv|s a|sa|ag|se)\b"
def norm(n: str) -> str:
    n = str(n).lower()
    n = n.split(" - ")[0].split(" common ")[0].split(" class ")[0].split(" ordinary")[0].split(" american depositary")[0]
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(SUFFIX, " ", n)
    return re.sub(r"\s+", " ", n).strip()

ent_by_norm = {}
for cik, name in zip(ents.cik, ents.name):
    k = norm(name)
    if k and k not in ent_by_norm: ent_by_norm[k] = int(cik)
sym2cik, matched_by_name = {}, 0
for a in assets:
    s = a["symbol"].replace("_DELISTED", "")
    if s in live:
        sym2cik[s] = live[s]
    else:
        k = norm(a["name"])
        if k in ent_by_norm:
            sym2cik[s] = ent_by_norm[k]; matched_by_name += 1
print(f"cik map: {len(sym2cik)} symbols ({matched_by_name} dead/unlisted matched by name)", flush=True)
facts = facts[facts.cik.isin(set(sym2cik.values()))].copy()
facts["filed"] = pd.to_datetime(facts.filed); facts["period_end"] = pd.to_datetime(facts.period_end)
STOCK_TAGS = {"Assets", "WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"}
facts = facts[facts.tag.isin(STOCK_TAGS) | (facts.fp == "FY")]
facts = facts.sort_values(["cik", "tag", "period_end"], ascending=[True, True, False]).reset_index(drop=True)
cik2syms = {}
for s, c in sym2cik.items(): cik2syms.setdefault(c, []).append(s)

def quality(as_of: pd.Timestamp) -> pd.DataFrame:
    f = facts[facts.filed <= as_of]
    f = f.assign(rn=f.groupby(["cik", "tag"]).cumcount() + 1)
    cur = f[f.rn == 1].pivot(index="cik", columns="tag", values="val")
    pri = f[(f.rn == 5) & f.tag.isin(["WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"])] \
        .pivot(index="cik", columns="tag", values="val")
    g = lambda df, col: df[col] if col in df.columns else pd.Series(np.nan, index=df.index)
    gp = g(cur, "GrossProfit").fillna(g(cur, "Revenues").fillna(g(cur, "RevenueFromContractWithCustomerExcludingAssessedTax"))
                                     - g(cur, "CostOfRevenue").fillna(g(cur, "CostOfGoodsAndServicesSold")))
    assets_ = g(cur, "Assets").replace(0, np.nan)
    sh = g(cur, "WeightedAverageNumberOfDilutedSharesOutstanding").fillna(g(cur, "CommonStockSharesOutstanding"))
    shp = g(pri, "WeightedAverageNumberOfDilutedSharesOutstanding").fillna(g(pri, "CommonStockSharesOutstanding")).reindex(cur.index).replace(0, np.nan)
    q = pd.DataFrame({"gp_a": gp / assets_, "ocf_a": g(cur, "NetCashProvidedByUsedInOperatingActivities") / assets_,
                      "iss": -(sh / shp - 1)}).replace([np.inf, -np.inf], np.nan)
    rows = []
    for cik, r in q.iterrows():
        for s in cik2syms.get(cik, []):
            rows.append((s, r.gp_a, r.ocf_a, r.iss))
    return pd.DataFrame(rows, columns=["symbol", "gp_a", "ocf_a", "iss"]).set_index("symbol")

ins = pd.read_parquet("insiders.parquet"); ins["as_of"] = pd.to_datetime(ins.as_of)

# ───────────────────────── scoring ─────────────────────────
def rank_score(s: pd.Series) -> pd.Series:
    return (s.rank(pct=True) - 0.5) * 2

def features(i_asof: int) -> pd.DataFrame:
    h = C.iloc[max(0, i_asof - 299):i_asof + 1]
    if len(h) < 260: raise ValueError("history")
    last = h.iloc[-1]; rets = h.pct_change(); win = 126
    dollar = (h * V.iloc[max(0, i_asof - 299):i_asof + 1]).rolling(63, min_periods=40).mean().iloc[-1]
    f = pd.DataFrame({
        "price": last, "addv": dollar,
        "liq": h.iloc[-win:].notna().mean(),
        "nz": (rets.iloc[-win:].abs() > 1e-9).mean(),
        "mom12": h.iloc[-22] / h.iloc[-253] - 1,
        "mom6": h.iloc[-22] / h.iloc[-127] - 1,
        "vol": rets.iloc[-win:].std() * np.sqrt(252),
        "trend": (h.iloc[-win:] > h.iloc[-win:].mean()).mean(),
        "mdd": (h.iloc[-252:] / h.iloc[-252:].cummax() - 1).min(),
    })
    ok = ((f.price >= MIN_PRICE) & (f.addv >= MIN_ADDV) & (f.liq >= MIN_LIQ) & (f.nz >= MIN_NZ)
          & f.mom12.notna() & f.vol.notna() & (f.vol > 0) & (f.vol <= MAX_VOL))
    return f[ok]

def score(f: pd.DataFrame, fund: pd.DataFrame, insv: pd.Series | None) -> pd.Series:
    f = f.join(fund, how="inner")
    sc = sum(w * rank_score(-f[k] if k in LOWER else f[k]) for k, w in W.items())
    for k, w in WF.items():
        sc = sc + w * rank_score(f[k])
    if insv is not None and len(insv):
        v = insv.reindex(sc.index).fillna(0.0).clip(lower=0)
        if v.max() > 0: sc = sc + W_INS * (v / v.max())
    return sc.dropna().sort_values(ascending=False)

def target_book(sc: pd.Series, held: list[str]) -> list[str]:
    cut = set(sc.index[:max(int(len(sc) * EXIT_BAND), N_POS)])
    keep = [s for s in held if s in cut]
    new = [s for s in sc.index if s not in keep][:max(0, N_POS - len(keep))]
    return (keep + new)[:N_POS]

# ───────────────────────── walk-forward ─────────────────────────
dates = C.index
month = dates.to_period("M")
first_idx = [i for i in range(1, len(dates)) if month[i] != month[i - 1]]   # first session of each month
first_idx = [i for i in first_idx if i - 1 >= 259 and dates[i] >= pd.Timestamp("2017-02-01")]
print(f"{len(first_idx)} rebalances, {dates[first_idx[0]].date()} .. {dates[first_idx[-1]].date()}", flush=True)

Cf = C.ffill()
cash, shares = 1.0, pd.Series(dtype=float)
held: list[str] = []
nav = pd.Series(np.nan, index=dates); nav_open = pd.Series(np.nan, index=dates)
holdings_log, turnover_log = [], []
rebal_set = set(first_idx)
start_i = first_idx[0]
for i in range(start_i, len(dates)):
    d = dates[i]
    # 1) delistings: a name whose last bar has passed is cashed out at its last close
    for s in list(shares.index):
        lv = last_valid[s]
        if lv < d:
            cash += shares[s] * Cf.at[lv, s]; shares = shares.drop(s)
    # 2) rebalance at the open
    if i in rebal_set:
        asof = i - 1
        f = features(asof)
        fund = quality(dates[asof])
        iv = ins[ins.as_of <= dates[asof]]
        insv = None
        if len(iv):
            iv = iv[iv.as_of == iv.as_of.max()]
            insv = iv.set_index("ticker").conv
        sc = score(f, fund, insv)
        names = target_book(sc, [s for s in held if s in shares.index])
        op = O.iloc[i]
        eq_open = cash + sum(shares[s] * (op[s] if pd.notna(op[s]) else Cf.iat[i - 1, C.columns.get_loc(s)]) for s in shares.index)
        target = eq_open / N_POS
        new_sh = pd.Series(dtype=float); traded = 0.0
        for s in names:
            p = op[s]
            if pd.isna(p) or p <= 0: continue
            new_sh[s] = target / p
        # sells
        for s in shares.index:
            p = op[s] if pd.notna(op[s]) else Cf.iat[i - 1, C.columns.get_loc(s)]
            tgt = new_sh.get(s, 0.0)
            delta = (tgt - shares[s]) * p
            traded += abs(delta)
        for s in new_sh.index:
            if s not in shares.index: traded += new_sh[s] * op[s]
        cost = traded * COST
        cash = eq_open - cost - sum(new_sh[s] * op[s] for s in new_sh.index)
        shares = new_sh; held = names
        holdings_log.append({"date": str(d.date()), "names": names, "n_scored": int(len(sc)), "n_eligible": int(len(f))})
        turnover_log.append(traded / eq_open)
        nav_open[d] = eq_open
        print(f"{d.date()} eligible {len(f):4d} scored {len(sc):4d} book {len(names)} turnover {traded/eq_open:.2f} nav {cash + sum(shares[s]*Cf.iat[i, C.columns.get_loc(s)] for s in shares.index):.3f}", flush=True)
    else:
        op = O.iloc[i]
        nav_open[d] = cash + sum(shares[s] * (op[s] if pd.notna(op[s]) else Cf.iat[i - 1, C.columns.get_loc(s)]) for s in shares.index)
    nav[d] = cash + sum(shares[s] * Cf.iat[i, C.columns.get_loc(s)] for s in shares.index)

nav = nav.dropna(); nav_open = nav_open.reindex(nav.index)
out = pd.DataFrame({"nav": nav, "nav_open": nav_open})
out["r_cc"] = out.nav.pct_change()
out["r_co"] = out.nav_open / out.nav.shift(1) - 1      # prior close -> today's open
out["r_oc"] = out.nav / out.nav_open - 1               # today's open -> close
out.to_parquet(f"book_{TAG}.parquet")
json.dump({"holdings": holdings_log, "turnover": turnover_log}, open(f"holdings_{TAG}.json", "w"))
print("DONE", TAG, "avg monthly turnover", np.mean(turnover_log), flush=True)
