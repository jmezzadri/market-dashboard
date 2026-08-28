"""
MacroTilt Tactical — cross-asset allocation engine. v1, 2026-08-28.

NO SLEEVES (Joe, 2026-08-28). One flat universe of 14 ETFs + T-bill cash.
Nothing is grouped or labeled; every asset competes on the same two questions:
  1. Is it trending up, net of cash?         (momentum gate + risk budget tilt)
  2. What does it add to the book's risk?    (shrunk covariance -> risk budgeting)
Then one book-level throttle:
  3. How much total risk is allowed today?   (vol target, halved under stress)

Rebalance: monthly (first trading day). Risk check: weekly (overlay only —
between monthlies the engine may cut or restore total exposure, never reselect).

Design choices, stated so they can be argued with:
- Momentum = average of 1/3/6/12-month total returns, minus the same for cash.
  Eligible only if positive. The most boring, most replicated signal in the
  cross-asset literature — chosen exactly because it is not clever.
- Covariance = 126-day sample, shrunk 30% toward the constant-correlation
  target. Raw sample cov on 14 assets is estimation noise the optimiser would
  otherwise eat; heavy shrinkage beats clever shrinkage out of sample.
- Weights = risk budgeting (each asset contributes its budgeted share of book
  risk; budgets scale 1..2 by momentum rank). NOT mean-variance: no expected
  returns are fed to an optimiser, because confident mu is how you get absurd
  corner portfolios. Momentum only tilts risk shares.
- Caps: max 25% weight per asset, min 2% (else dropped). Long-only, no leverage.
- Vol target 10% annualised; whatever risk budget is unused sits in BIL and
  earns the front-end rate. Cash is a position, not a failure.
- Stress overlay: composite of VIX percentile and high-yield drawdown percentile
  (3y windows). ON above 0.80, OFF below 0.65 (hysteresis so it doesn't flap).
  ON => vol target halves. In production the overlay reads the site's live VIX /
  MOVE / HY-OAS feeds; the backtest proxies credit with HYG's own drawdown
  because the OAS series on file only starts in 2011.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

RISK_ASSETS = ["SPY","QQQ","IWM","SCHD","EFA","EEM","TLT","IEF","TIP",
               "HYG","GLD","SLV","DBC","VNQ"]
CASH = "BIL"

MOM_WINDOWS   = (21, 63, 126, 252)   # 1/3/6/12 months
COV_WINDOW    = 126
MIN_HISTORY   = 260                  # an asset needs a full year before it can enter
SHRINK        = 0.30
BUDGET_SPAN   = (1.0, 2.0)           # worst..best momentum risk budget
MAX_W, MIN_W  = 0.25, 0.02
VOL_TARGET    = 0.10                 # annualised
STRESS_ON, STRESS_OFF = 0.80, 0.65
COST_PER_SIDE = 0.0005               # 5 bps

def momentum(prices: pd.DataFrame, date) -> pd.Series:
    """Blend of total returns over MOM_WINDOWS ending at `date` (inclusive)."""
    px = prices.loc[:date]
    out = {}
    for a in px.columns:
        s = px[a].dropna()
        if len(s) < MIN_HISTORY: continue
        rs = [s.iloc[-1] / s.iloc[-w-1] - 1 for w in MOM_WINDOWS]
        out[a] = float(np.mean(rs))
    return pd.Series(out)

def shrunk_cov(rets: pd.DataFrame) -> pd.DataFrame:
    """126d sample covariance shrunk toward constant-correlation, annualised."""
    S = rets.cov().values
    sd = np.sqrt(np.diag(S))
    corr = S / np.outer(sd, sd)
    n = len(sd)
    rbar = (corr.sum() - n) / (n * (n - 1)) if n > 1 else 0.0
    F = rbar * np.outer(sd, sd)
    np.fill_diagonal(F, sd ** 2)
    Sh = SHRINK * F + (1 - SHRINK) * S
    return pd.DataFrame(Sh * 252, index=rets.columns, columns=rets.columns)

def risk_budget_weights(cov: pd.DataFrame, budgets: pd.Series, cycles=500, tol=1e-10) -> pd.Series:
    """Risk budgeting via cyclical coordinate descent (Griveau-Billion et al.,
    2013): minimise 1/2 w'Sw - sum(b_i ln w_i), whose stationary point is exactly
    "asset i contributes b_i of the variance". Each coordinate update solves its
    quadratic in closed form, so the iteration is monotone and converges for any
    PSD covariance.

    The first implementation here used the naive fixed point w <- b/(Sw), which
    OSCILLATES on realistic covariances. It collapsed gold, silver, commodities
    and SCHD to exactly zero while equities absorbed triple their risk budgets -
    i.e. it silently deleted the diversifiers this engine exists to hold, and the
    2%-minimum cap then froze that wreckage in place (caught 2026-08-28 because
    a 2026 book with zero gold failed the smell test). Verify risk contributions
    against budgets after any change to this function; there is a check in the
    test file that does exactly that."""
    assets = cov.index
    b = (budgets.reindex(assets) / budgets.reindex(assets).sum()).values
    S = cov.values
    n = len(assets)
    # Solve UNNORMALISED (the lambda=1 problem), normalise once at the end.
    # Risk-contribution shares are invariant to scaling w, so normalising at the
    # end preserves them exactly; renormalising inside the loop perturbs the
    # fixed point every cycle and the iteration stalls ~8pp off budget (the
    # second bug caught on 2026-08-28, right after the oscillation bug).
    w = np.sqrt(b) / np.sqrt(np.diag(S))
    for _ in range(cycles):
        w_prev = w.copy()
        for i in range(n):
            c = S[i] @ w - S[i, i] * w[i]          # cross term, current weights
            w[i] = (-c + np.sqrt(c * c + 4.0 * S[i, i] * b[i])) / (2.0 * S[i, i])
        if np.abs(w - w_prev).max() < tol * max(1.0, np.abs(w).max()): break
    w = w / w.sum()
    return pd.Series(w, index=assets)

def _cap_waterfill(w: pd.Series, cap: float) -> pd.Series:
    """Cap at `cap` and redistribute the excess among uncapped assets, repeating
    until stable. clip-then-renormalise does NOT do this — renormalising pushes
    capped assets straight back over the cap (a 90% weight 'capped' that way
    lands at 47%, found by the guard-rail test on 2026-08-28). If everything
    ends up capped, the book is deliberately left under-invested; the remainder
    becomes cash rather than silently breaching the cap."""
    w = w.copy()
    for _ in range(len(w) + 1):
        over = w > cap + 1e-12
        if not over.any(): return w
        excess = float((w[over] - cap).sum())
        w[over] = cap
        free = ~over
        if not free.any() or w[free].sum() <= 0: return w
        w[free] = w[free] + excess * (w[free] / w[free].sum())
    return w

def apply_caps(w: pd.Series) -> pd.Series:
    if len(w) == 0: return w
    w = w / w.sum()
    w = _cap_waterfill(w, MAX_W)
    w = w[w >= MIN_W]                      # drop dust
    if len(w) == 0: return w
    if w.sum() > 0: w = w / w.sum()        # renormalise after the drop...
    return _cap_waterfill(w, MAX_W)        # ...then re-enforce the cap properly

def target_book(prices: pd.DataFrame, signal_date) -> tuple[pd.Series, float]:
    """Risk-asset weights (within the risk sleeve) and the book vol at scale=1."""
    mom = momentum(prices[RISK_ASSETS + [CASH]], signal_date)
    if CASH not in mom.index: return pd.Series(dtype=float), 0.0
    excess = mom.drop(CASH) - mom[CASH]
    elig = excess[excess > 0].sort_values(ascending=False)
    if len(elig) == 0: return pd.Series(dtype=float), 0.0
    ranks = elig.rank(pct=True)          # 1.0 = best
    budgets = BUDGET_SPAN[0] + (BUDGET_SPAN[1] - BUDGET_SPAN[0]) * ranks
    px = prices[elig.index].loc[:signal_date]
    rets = px.pct_change().dropna().tail(COV_WINDOW)
    rets = rets.dropna(axis=1)
    if rets.shape[1] == 0 or rets.shape[0] < 60: return pd.Series(dtype=float), 0.0
    cov = shrunk_cov(rets)
    w = risk_budget_weights(cov, budgets.reindex(cov.index).fillna(BUDGET_SPAN[0]))
    w = apply_caps(w)
    if len(w) == 0: return w, 0.0
    vol = float(np.sqrt(w.values @ cov.loc[w.index, w.index].values @ w.values))
    return w, vol

def stress_series(vix: pd.Series, hyg_px: pd.Series) -> pd.Series:
    """Composite in [0,1]: mean of VIX 3y percentile and HYG 63d-drawdown 3y percentile."""
    vix_pct = vix.rolling(756, min_periods=252).rank(pct=True)
    dd = hyg_px / hyg_px.rolling(63, min_periods=21).max() - 1
    dd_pct = (-dd).rolling(756, min_periods=252).rank(pct=True)
    comp = pd.concat([vix_pct, dd_pct], axis=1).mean(axis=1)
    return comp.rename("stress")

def stress_state(comp: pd.Series) -> pd.Series:
    """Hysteresis: ON above STRESS_ON, stays ON until below STRESS_OFF."""
    state, on = [], False
    for v in comp.values:
        if np.isnan(v): state.append(on); continue
        if not on and v > STRESS_ON: on = True
        elif on and v < STRESS_OFF: on = False
        state.append(on)
    return pd.Series(state, index=comp.index, name="stress_on")
