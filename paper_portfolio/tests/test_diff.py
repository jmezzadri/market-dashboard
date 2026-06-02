"""Tests for the SIGNAL-ONLY diff engine (2026-06-02)."""
from __future__ import annotations

from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.signals import AssetTiltIG, AssetTiltSnapshot, EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_a_target, build_sleeve_b_target


def _pos(ticker, qty, cost_basis, market_value=None):
    # market_value is set DELIBERATELY different from cost_basis to prove the
    # engine ignores market value (price) and uses cost basis (signal anchor).
    mv = market_value if market_value is not None else cost_basis
    return AlpacaPosition(ticker=ticker, qty=qty, avg_entry_price=(cost_basis/qty if qty else 0),
                          market_value=mv, cost_basis=cost_basis, unrealized_pl=mv-cost_basis, side="long")


def _at(weights, extra=None):
    extra = extra or {}
    igs = [AssetTiltIG(ig_id=e.lower(), name=e, sector="X", primary_etf=e, weight_pct=w, rating=r)
           for e, w, r in weights]
    raw = [{"id": e.lower(), "name": e, "sector": "X", "tickers": [e, *extra.get(e, [])]} for e, _, _ in weights]
    return AssetTiltSnapshot("2026-06-02", "test", 1.0, igs, {"industry_groups": raw})


def _scan(pairs):
    sigs = [EquitySignal(ticker=t, mt_score=s*10, buy_score=s, band="Strong Buy", scan_date="2026-06-02") for t, s in pairs]
    return EquityScannerSnapshot("2026-06-02", sigs, len(sigs), [])


def run():
    passed = failed = 0
    def ck(name, cond):
        nonlocal passed, failed
        if cond: passed += 1; print(f"  PASS {name}")
        else: failed += 1; print(f"  FAIL {name}")

    eod = {"SOXX": 100.0, "IGV": 100.0, "AMR": 50.0, "NVDA": 200.0, "XLE": 10.0}

    # 1. New signals, nothing held -> all buys
    a = build_sleeve_a_target(_at([("SOXX", 0.5, "OW"), ("IGV", 0.5, "MW")]), 500_000)
    b = build_sleeve_b_target(_scan([("AMR", 10)]), 500_000)
    ints = build_order_intents(a, b, [], eod_prices=eod)
    bt = {i.ticker: i for i in ints}
    ck("new signals -> buys", bt["SOXX"].side=="buy" and bt["AMR"].side=="buy")
    ck("buy qty from EOD price (SOXX $250k/$100=2500sh)", bt["SOXX"].target_quantity==2500.0)

    # 2. THE KEY ONE: held name, signal unchanged, PRICE moved a lot -> NO trade
    # Cost basis $250k (what we paid); market value $300k (price rose 20%). Signal target still $250k.
    held = [_pos("SOXX", 2500, cost_basis=250_000, market_value=300_000),
            _pos("IGV", 2500, cost_basis=250_000, market_value=180_000)]  # price fell
    ints = build_order_intents(a, b, held, eod_prices=eod)
    soxx = [i for i in ints if i.ticker=="SOXX"]
    igv = [i for i in ints if i.ticker=="IGV"]
    ck("price ROSE 20% but signal same -> NO trade", soxx==[])
    ck("price FELL 28% but signal same -> NO trade", igv==[])

    # 3. Signal GONE -> full exit (sell whole qty), at cost basis dollars
    # AMR held, but scanner no longer lists it
    a2 = build_sleeve_a_target(_at([("SOXX",0.5,"OW"),("IGV",0.5,"MW")]), 500_000)
    b2 = build_sleeve_b_target(_scan([]), 500_000)   # AMR dropped
    held2 = [_pos("SOXX",2500,250_000), _pos("IGV",2500,250_000), _pos("AMR",1000,50_000, market_value=90_000)]
    ints = build_order_intents(a2, b2, held2, eod_prices=eod)
    amr = [i for i in ints if i.ticker=="AMR"]
    ck("signal gone -> full exit", amr and amr[0].side=="sell" and amr[0].target_quantity==1000)

    # 4. Signal tier CHANGED -> resize. AMR target jumps $30k->$50k (basis $30k)
    b3 = build_sleeve_b_target(_scan([("AMR", 10)]), 500_000)  # tier1 = $50k
    held3 = [_pos("AMR", 600, cost_basis=30_000, market_value=33_000)]
    ints = build_order_intents(_at_empty(), b3, held3, eod_prices=eod)
    amr = [i for i in ints if i.ticker=="AMR"]
    ck("tier change $30k->$50k -> resize buy", amr and amr[0].side=="buy" and round(amr[0].target_notional)==20_000)

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed==0 else 1


def _at_empty():
    return build_sleeve_a_target(_at([]), 0)


if __name__ == "__main__":
    import sys
    sys.exit(run())
