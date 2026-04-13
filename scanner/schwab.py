"""
Schwab API integration — stub until SCHWAB_APP_KEY / SCHWAB_APP_SECRET are set.

When implementing:
- Use schwab.auth.easy_client() for OAuth flow
- Store token in token.json (schwab-py refreshes automatically)
- Use account number hash for API calls, not raw account numbers
"""


def get_positions() -> list:
    """
    Returns list of current Schwab account positions.
    Each item: { ticker, shares, avg_cost, current_price, pnl_pct, market_value }
    """
    # TODO: Implement with schwab-py when SCHWAB_APP_KEY and SCHWAB_APP_SECRET are set
    # Reference: https://schwab-py.readthedocs.io/en/latest/
    return []


def get_cash_balance() -> float:
    """Returns available cash for new positions."""
    # TODO: Implement
    return 0.0


def get_open_options() -> list:
    """
    Returns open covered call positions.
    Each item: { ticker, strike, expiry, contracts, current_value, pnl_pct }
    """
    # TODO: Implement
    return []
