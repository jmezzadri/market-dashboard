"""Brake overlay study on the Quality Trend daily book.
Signal at close t from data through t; executed at the OPEN of t+1 (the book's close->open leg
carries the old exposure, the open->close leg the new one). 5bp per side on the exposure change.
Cash earns nothing (Alpaca paper cash). Selection criterion, declared before running:
  full-sample Sharpe (excess over T-bills), must beat NO BRAKE in BOTH halves, and the
  neighbouring thresholds must not flip the sign of the improvement."""
import json, sys, itertools
import numpy as np, pandas as pd

TAG = sys.argv[1] if len(sys.argv) > 1 else "n20"
COST = 0.0005
book = pd.read_parquet(f"book_{TAG}.parquet").dropna(subset=["r_co", "r_oc"])
idx = book.index

# ── inputs ──
ih = json.load(open("indicator_history.json"))
def site(k):
    s = pd.Series({pd.Timestamp(d): v for d, v in ih[k]["points"] if v is not None}).sort_index()
    return s
vix, move = site("vix"), site("move")
hyg = pd.read_csv("hyg_yahoo.csv", parse_dates=["d"]).set_index("d").adjclose
oas = pd.read_csv("hyoas.csv", parse_dates=["observation_date"]).set_index("observation_date").iloc[:, 0]
oas = pd.to_numeric(oas, errors="coerce").dropna()
bench = pd.read_parquet("bench.parquet")
spy = bench[bench.symbol == "SPY"].set_index("d").c.sort_index()
bil = bench[bench.symbol == "BIL"].set_index("d").c.sort_index()
rf = bil.pct_change().reindex(idx).fillna(0.0)

def pct_rank(s: pd.Series, window: int) -> pd.Series:
    """Percentile of the last value in the trailing window, midrank ties (brake.py semantics)."""
    a = s.values; out = np.full(len(a), np.nan)
    for i in range(len(a)):
        lo = max(0, i - window + 1); tail = a[lo:i + 1]; tail = tail[~np.isnan(tail)]
        if len(tail) < window // 3: continue
        last = a[i]
        if np.isnan(last): continue
        out[i] = ((tail < last).sum() + 0.5 * (tail == last).sum()) / len(tail)
    return pd.Series(out, index=s.index)

def dd63(s: pd.Series) -> pd.Series:
    return 1.0 - s / s.rolling(63, min_periods=1).max()

W3, W5 = 756, 1260
sig = {
    "VIX+HYGdd (deployed)": (pct_rank(vix, W3).reindex(idx) + pct_rank(dd63(hyg), W3).reindex(idx)) / 2,
    "MOVE 3y":             pct_rank(move, W3).reindex(idx),
    "MOVE 5y":             pct_rank(move, W5).reindex(idx),
    "VIX 3y":              pct_rank(vix, W3).reindex(idx),
    "HYGdd 3y":            pct_rank(dd63(hyg), W3).reindex(idx),
    "HY OAS 3y":           pct_rank(oas, W3).reindex(idx),
    "VIX+MOVE":            (pct_rank(vix, W3).reindex(idx) + pct_rank(move, W3).reindex(idx)) / 2,
    "VIX+HYOAS":           (pct_rank(vix, W3).reindex(idx) + pct_rank(oas, W3).reindex(idx)) / 2,
    "VIX+HYGdd+MOVE":      (pct_rank(vix, W3).reindex(idx) + pct_rank(dd63(hyg), W3).reindex(idx) + pct_rank(move, W3).reindex(idx)) / 3,
}
for k in sig: sig[k] = sig[k].ffill()

def states(comp: pd.Series, on: float, off: float, confirm: int) -> pd.Series:
    st, cur, run = np.zeros(len(comp), dtype=bool), False, 0
    v = comp.values
    for i in range(len(v)):
        x = v[i]
        if np.isnan(x): st[i] = cur; continue
        if not cur:
            run = run + 1 if x > on else 0
            if run >= confirm: cur = True
        else:
            if x < off: cur = False; run = 0
        st[i] = cur
    return pd.Series(st, index=comp.index)

def simulate(state: pd.Series, scale: float) -> pd.Series:
    """state decided at close t -> exposure from the open of t+1."""
    e_new = np.where(state.shift(1).fillna(False).values, scale, 1.0)   # exposure during day t after the open
    e_prev = np.r_[1.0, e_new[:-1]]                                      # exposure during close(t-1)->open(t)
    cost = np.abs(e_new - e_prev) * COST
    r = (1 + e_prev * book.r_co.values) * (1 + e_new * book.r_oc.values) - 1 - cost
    return pd.Series(r, index=idx)

def metrics(r: pd.Series) -> dict:
    r = r.dropna(); ex = r - rf.reindex(r.index).fillna(0)
    nav = (1 + r).cumprod(); yrs = len(r) / 252
    cagr = nav.iloc[-1] ** (1 / yrs) - 1
    vol = r.std() * np.sqrt(252)
    sharpe = ex.mean() / ex.std() * np.sqrt(252) if ex.std() > 0 else np.nan
    dd = (nav / nav.cummax() - 1).min()
    down = r[r < 0].std() * np.sqrt(252)
    sortino = (r.mean() * 252 - (rf.reindex(r.index).mean() * 252)) / down if down > 0 else np.nan
    return {"cagr": cagr, "vol": vol, "sharpe": sharpe, "sortino": sortino, "maxdd": dd}

H1 = idx < pd.Timestamp("2022-01-01"); H2 = ~H1
def row(name, r, st=None):
    m = metrics(r); m1 = metrics(r[H1]); m2 = metrics(r[H2])
    yr = (1 + r).groupby(r.index.year).prod() - 1
    d = {"variant": name, "CAGR": m["cagr"], "Vol": m["vol"], "Sharpe": m["sharpe"], "Sortino": m["sortino"], "MaxDD": m["maxdd"],
         "Sh_H1": m1["sharpe"], "Sh_H2": m2["sharpe"], "CAGR_H1": m1["cagr"], "CAGR_H2": m2["cagr"], "worst_yr": yr.min(),
         "y2018": yr.get(2018, np.nan), "y2020": yr.get(2020, np.nan), "y2022": yr.get(2022, np.nan)}
    if st is not None:
        s = st.reindex(idx).fillna(False)
        d["pct_on"] = s.mean(); d["episodes"] = int(((s.astype(int).diff() == 1)).sum())
    return d

rows = []
base = simulate(pd.Series(False, index=idx), 1.0)
rows.append(row("NO BRAKE", base))
rows.append(row("S&P 500", spy.pct_change().reindex(idx).fillna(0)))
# SPY 200-day trend reference
tr = (spy < spy.rolling(200).mean()).reindex(idx).fillna(False)
rows.append(row("ref: SPY<200dma -> half", simulate(tr, 0.5), tr))
grid = [(0.80, 0.65), (0.85, 0.70), (0.90, 0.75), (0.95, 0.80), (0.90, 0.60), (0.95, 0.70)]
for name, comp in sig.items():
    for (on, off), conf, scale in itertools.product(grid, (1, 2, 5), (0.5, 0.0)):
        st = states(comp, on, off, conf)
        rows.append(row(f"{name} on{on:.2f}/off{off:.2f} conf{conf} scale{scale:.1f}", simulate(st, scale), st))
df = pd.DataFrame(rows)
df.to_csv(f"overlay_results_{TAG}.csv", index=False)
b = df.iloc[0]
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 500)
fmt = df.copy()
for c in ["CAGR", "Vol", "MaxDD", "CAGR_H1", "CAGR_H2", "worst_yr", "y2018", "y2020", "y2022", "pct_on"]:
    fmt[c] = (fmt[c] * 100).round(1)
for c in ["Sharpe", "Sortino", "Sh_H1", "Sh_H2"]: fmt[c] = fmt[c].round(3)
print(fmt.head(3).to_string(index=False))
ok = df[(df.Sh_H1 >= b.Sh_H1) & (df.Sh_H2 >= b.Sh_H2) & (df.Sharpe > b.Sharpe)].sort_values("Sharpe", ascending=False)
print(f"\n{len(ok)} variants beat NO BRAKE on Sharpe in the full sample AND both halves")
print(fmt.loc[ok.index].head(25).to_string(index=False))
print("\nTop 15 by full-sample Sharpe regardless of halves:")
print(fmt.sort_values("Sharpe", ascending=False).head(15).to_string(index=False))
print("\nDeployed rule and its neighbours:")
print(fmt[fmt.variant.str.startswith("VIX+HYGdd (deployed)") & fmt.variant.str.contains("conf1 scale0.5")].to_string(index=False))
