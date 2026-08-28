"""Guard rails for the tactical engine. Run: python3 -m pytest tactical/test_engine.py -q
The solver test exists because the first implementation silently zeroed gold,
silver, commodities and SCHD (naive fixed point oscillates; then per-cycle
renormalisation stalled CCD ~8pp off budget). Never again without a red test."""
import numpy as np, pandas as pd
from paper_portfolio.tactical.engine import risk_budget_weights, shrunk_cov, stress_state, apply_caps

def _rand_cov(n, seed):
    rng = np.random.default_rng(seed)
    A = rng.normal(size=(n, n + 6))
    S = A @ A.T / (n + 6)
    d = np.sqrt(np.diag(S))
    return pd.DataFrame(S, index=[f"A{i}" for i in range(n)], columns=[f"A{i}" for i in range(n)])

def test_risk_contributions_match_budgets():
    for seed in (1, 7, 42):
        cov = _rand_cov(11, seed)
        budgets = pd.Series(np.linspace(1, 2, 11), index=cov.index)
        w = risk_budget_weights(cov, budgets)
        rc = w.values * (cov.values @ w.values); rc = rc / rc.sum()
        b = (budgets / budgets.sum()).values
        assert np.abs(rc - b).max() < 1e-6, f"solver off budget (seed {seed})"
        assert (w.values > 0).all(), "solver zeroed an asset"

def test_diversifier_not_deleted():
    # A low-correlation asset must get MORE weight than its vol rank implies,
    # never zero — this is the exact failure mode of the first implementation.
    n = 8
    corr = np.full((n, n), 0.8); np.fill_diagonal(corr, 1.0)
    corr[-1, :-1] = corr[:-1, -1] = 0.0        # last asset uncorrelated
    vols = np.full(n, 0.20); vols[-1] = 0.25   # and slightly higher vol
    S = corr * np.outer(vols, vols)
    cov = pd.DataFrame(S, index=[f"A{i}" for i in range(n)], columns=[f"A{i}" for i in range(n)])
    w = risk_budget_weights(cov, pd.Series(1.0, index=cov.index))
    assert w.iloc[-1] > w.iloc[0], "diversifier under-weighted"

def test_stress_hysteresis():
    comp = pd.Series([0.5, 0.85, 0.75, 0.70, 0.60, 0.85, 0.5])
    st = stress_state(comp).tolist()
    assert st == [False, True, True, True, False, True, False]

def test_caps():
    # After capping, weights sum to 1 and respect the 25% ceiling; a tiny
    # position is dropped when it stays under 2% post-redistribution.
    w = apply_caps(pd.Series({"a": 0.30, "b": 0.30, "c": 0.25, "d": 0.14, "e": 0.01}))
    assert abs(w.sum() - 1) < 1e-9
    assert w.max() <= 0.25 + 1e-6
    assert "e" not in w.index
