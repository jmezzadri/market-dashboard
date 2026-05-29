"""
paper_portfolio.alpaca_client — Alpaca paper REST wrapper.

Phase 2 used reads only. Phase 4 added write methods:
  * submit_market_on_open(...) — submits an MOO order with a
    client_order_id derived from the paper_orders.id (UUID), giving the
    submitter idempotency: the same intent UUID can be retried safely
    and Alpaca will reject the duplicate with HTTP 422.
  * cancel_order(...) — cancel an open order.
  * get_order(...) — pull a single order's current status (used for
    fill confirmation in the mirror step).
  * list_orders(...) — paginated order history (used by the fill
    reconciler).

Auth: reads ALPACA_PAPER_KEY_ID / ALPACA_PAPER_SECRET / ALPACA_PAPER_BASE_URL
from the environment. All three exist in both the local secret store and
Supabase Edge Function secrets (per Phase 1 setup) — no prompt for keys.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AlpacaPosition:
    ticker: str
    qty: float
    avg_entry_price: float
    market_value: float
    cost_basis: float
    unrealized_pl: float            # total open P&L in $ (since entry)
    side: str  # 'long' / 'short'
    unrealized_plpc: float = 0.0    # total open P&L as a fraction (0.05 = +5%)
    unrealized_intraday_pl: float = 0.0    # today's P&L in $
    unrealized_intraday_plpc: float = 0.0  # today's P&L as a fraction
    current_price: float = 0.0      # latest price
    lastday_price: float = 0.0      # prior session close
    change_today: float = 0.0       # price move today as a fraction


@dataclass(frozen=True)
class AlpacaAccountSnapshot:
    account_number: str
    cash: float
    equity: float
    buying_power: float
    portfolio_value: float
    long_market_value: float
    short_market_value: float
    initial_margin: float
    maintenance_margin: float
    status: str


class AlpacaPaperClient:
    """Minimal REST wrapper. No retry logic in v1 — the translator runs
    in a workflow that already has retries at the workflow level."""

    def __init__(
        self,
        key_id: str | None = None,
        secret: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.key_id = key_id or os.environ.get("ALPACA_PAPER_KEY_ID", "")
        self.secret = secret or os.environ.get("ALPACA_PAPER_SECRET", "")
        self.base_url = (base_url or os.environ.get(
            "ALPACA_PAPER_BASE_URL", "https://paper-api.alpaca.markets")
        ).rstrip("/")
        if not self.key_id or not self.secret:
            raise RuntimeError(
                "ALPACA_PAPER_KEY_ID and ALPACA_PAPER_SECRET must be set in the "
                "environment. Both exist in Supabase Edge Function secrets and "
                "the local secret store per Phase 1 setup."
            )
        self.timeout = timeout

    # ── private ──
    def _headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": self.key_id,
            "APCA-API-SECRET-KEY": self.secret,
            "accept": "application/json",
        }

    def _get(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        resp = requests.get(url, headers=self._headers(), timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    # ── public READS ──
    def get_account(self) -> AlpacaAccountSnapshot:
        data = self._get("/v2/account")
        return AlpacaAccountSnapshot(
            account_number=data.get("account_number", ""),
            cash=float(data.get("cash", 0)),
            equity=float(data.get("equity", 0)),
            buying_power=float(data.get("buying_power", 0)),
            portfolio_value=float(data.get("portfolio_value", 0)),
            long_market_value=float(data.get("long_market_value", 0)),
            short_market_value=float(data.get("short_market_value", 0)),
            initial_margin=float(data.get("initial_margin", 0)),
            maintenance_margin=float(data.get("maintenance_margin", 0)),
            status=data.get("status", ""),
        )

    def get_positions(self) -> list[AlpacaPosition]:
        data = self._get("/v2/positions")
        positions: list[AlpacaPosition] = []
        for p in data or []:
            positions.append(AlpacaPosition(
                ticker=p["symbol"],
                qty=float(p.get("qty", 0)),
                avg_entry_price=float(p.get("avg_entry_price", 0)),
                market_value=float(p.get("market_value", 0)),
                cost_basis=float(p.get("cost_basis", 0)),
                unrealized_pl=float(p.get("unrealized_pl", 0)),
                side=p.get("side", "long"),
                unrealized_plpc=float(p.get("unrealized_plpc", 0) or 0),
                unrealized_intraday_pl=float(p.get("unrealized_intraday_pl", 0) or 0),
                unrealized_intraday_plpc=float(p.get("unrealized_intraday_plpc", 0) or 0),
                current_price=float(p.get("current_price", 0) or 0),
                lastday_price=float(p.get("lastday_price", 0) or 0),
                change_today=float(p.get("change_today", 0) or 0),
            ))
        return positions

    def get_last_trade_price(self, ticker: str) -> float | None:
        """Best-effort last-trade price for an exit/sizing notional. Returns
        None if Alpaca has no recent trade for the symbol on the paper feed."""
        try:
            data = self._get(f"/v2/stocks/{ticker}/trades/latest")
        except requests.HTTPError:
            return None
        return float(data.get("trade", {}).get("p", 0)) or None

    def get_close_price(self, ticker: str) -> float | None:
        """Latest daily close from Alpaca's MARKET-DATA host
        (data.alpaca.markets, free IEX feed). The trading host used elsewhere
        (paper-api.alpaca.markets) does NOT serve market data — querying it for
        prices silently returns nothing, which is why the old SPY benchmark
        never had data. Used for benchmark prices (SPY, AGG)."""
        data_base = os.environ.get(
            "ALPACA_DATA_BASE_URL", "https://data.alpaca.markets"
        ).rstrip("/")
        # Prefer the most recent daily bar's close.
        try:
            resp = requests.get(
                f"{data_base}/v2/stocks/{ticker}/bars",
                headers=self._headers(),
                params={"timeframe": "1Day", "limit": 1, "feed": "iex"},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            bars = resp.json().get("bars") or []
            if bars:
                c = float(bars[-1].get("c") or 0)
                if c:
                    return c
        except requests.RequestException:
            pass
        # Fallback: latest trade on the data host.
        try:
            resp = requests.get(
                f"{data_base}/v2/stocks/{ticker}/trades/latest",
                headers=self._headers(), params={"feed": "iex"}, timeout=self.timeout,
            )
            resp.raise_for_status()
            return float(resp.json().get("trade", {}).get("p", 0)) or None
        except requests.RequestException:
            return None

    def get_clock(self) -> dict:
        """Returns Alpaca's market clock with keys: is_open, next_open,
        next_close. Used by the runner to gate MOO submissions to the
        post-close / pre-open window."""
        return self._get("/v2/clock")

    # ── private POST/DELETE ──
    def _post(self, path: str, body: dict) -> Any:
        url = f"{self.base_url}{path}"
        headers = {**self._headers(), "Content-Type": "application/json"}
        resp = requests.post(url, headers=headers, json=body, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        resp = requests.delete(url, headers=self._headers(), timeout=self.timeout)
        # 204 No Content is the success path for cancel.
        if resp.status_code in (200, 204):
            return resp.json() if resp.content else {}
        resp.raise_for_status()
        return resp.json()

    # ── public WRITES ──
    def submit_market_on_open(
        self,
        ticker: str,
        qty: float,
        side: str,                    # 'buy' or 'sell'
        client_order_id: str,         # paper_orders.id (UUID) — idempotency key
        notional: float | None = None,
        extended_hours: bool = False,
    ) -> dict:
        """Submit a market-on-open order. Alpaca routes 'opg' TIF orders to
        the next opening auction.

        Either `qty` (whole shares) OR `notional` (dollar amount) must be
        non-None. Alpaca accepts notional orders for many symbols, which
        is convenient when the translator carries a target dollar value.

        Returns Alpaca's order JSON. The caller MUST update paper_orders
        with the returned `id` field as alpaca_order_id.
        """
        if side not in ("buy", "sell"):
            raise ValueError(f"side must be 'buy' or 'sell', got {side}")
        if qty is None and notional is None:
            raise ValueError("must pass either qty or notional")
        body: dict[str, Any] = {
            "symbol": ticker,
            "side": side,
            "type": "market",
            "time_in_force": "opg",         # opening auction
            "client_order_id": client_order_id,
            "extended_hours": extended_hours,
        }
        if qty is not None:
            body["qty"] = str(qty)
        else:
            body["notional"] = str(notional)
        return self._post("/v2/orders", body)

    def get_order(self, alpaca_order_id: str) -> dict:
        """Fetch one order by Alpaca's id (UUID). Used by the mirror step
        to confirm fill status."""
        return self._get(f"/v2/orders/{alpaca_order_id}")

    def get_order_by_client_id(self, client_order_id: str) -> dict | None:
        """Look up an order by client_order_id (the paper_orders.id we
        passed at submission). Returns None if not found.

        This is the idempotency check: before re-submitting, the
        submitter can check whether Alpaca already has this client_order_id.
        """
        try:
            return self._get(f"/v2/orders:by_client_order_id?client_order_id={client_order_id}")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                return None
            raise

    def cancel_order(self, alpaca_order_id: str) -> dict:
        """Cancel an open order. Returns {} on success."""
        return self._delete(f"/v2/orders/{alpaca_order_id}")

    def list_orders(
        self,
        status: str = "all",
        after: str | None = None,
        until: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """Paginated order history. status ∈ {open, closed, all}.
        after / until are ISO timestamps."""
        params = [f"status={status}", f"limit={limit}"]
        if after:
            params.append(f"after={after}")
        if until:
            params.append(f"until={until}")
        path = f"/v2/orders?{'&'.join(params)}"
        return self._get(path)
