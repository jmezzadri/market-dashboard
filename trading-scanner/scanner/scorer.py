"""Signal scoring engine — 0–100 score per ticker."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from config import (
    CONGRESS_AMOUNT_SCORES,
    CONGRESS_LOOKBACK_DAYS,
    CONGRESS_SCORE_CAP,
    INSIDER_LOOKBACK_DAYS,
    INSIDER_MIN_DOLLAR_FOR_SCORE,
    SCORE_WATCH_ALERT,
)

from scanner.technicals import get_technicals

__all__ = [
    "score_ticker",
    "score_breakdown",
    "format_score_breakdown",
    "get_insider_dollar_value",
    "qualifying_insider_rows",
    "congress_tier_points",
    "congress_score_for_ticker",
    "score_insider_signal",
    "signal_narrative",
    "signal_indicators",
    "_congress_tier_value",
]


def get_insider_dollar_value(row: dict[str, Any]) -> float:
    """
    Dollar notional for an insider P row: |amount| (shares) × stock_price.
    API `amount` is share count, not dollars.
    """
    try:
        shares = abs(float(row.get("amount") or 0))
    except (TypeError, ValueError):
        shares = 0.0
    try:
        price = float(row.get("stock_price") or 0)
    except (TypeError, ValueError):
        price = 0.0
    return shares * price


def qualifying_insider_rows(ticker_insiders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insider P rows that meet minimum dollar notional for scoring."""
    return [
        r
        for r in ticker_insiders
        if get_insider_dollar_value(r) >= INSIDER_MIN_DOLLAR_FOR_SCORE
    ]


def _congress_tier_value(amounts: str | None) -> int:
    """Numeric sort key for a congressional disclosure amount range (tier points)."""
    return congress_tier_points(amounts)


def _congress_amount_mid_dollars(amounts: str | None) -> float:
    """Midpoint dollar estimate for a disclosure `amounts` range string (for conviction tiers)."""
    if amounts is None:
        return 0.0
    key = " ".join(str(amounts).split())
    key = key.replace("–", "-").replace("—", "-")
    mids: dict[str, float] = {
        "$1,001 - $15,000": 8_000.5,
        "$15,001 - $50,000": 32_500.5,
        "$50,001 - $100,000": 75_000.5,
        "$100,001 - $250,000": 175_000.5,
        "$250,001 - $500,000": 375_000.5,
        "$500,001 - $1,000,000": 750_000.5,
        "$1,000,001 +": 1_500_000.0,
    }
    if key in mids:
        return mids[key]
    nk = key.replace("$", "").replace(",", "").lower()
    for ak, mid in mids.items():
        if ak.replace("$", "").replace(",", "").lower() == nk:
            return mid
    return 0.0


def congress_tier_points(amounts: str | None) -> int:
    """Points for one congressional disclosure row from its `amounts` range string."""
    if amounts is None:
        return 0
    key = " ".join(str(amounts).split())
    key = key.replace("–", "-").replace("—", "-")
    if key in CONGRESS_AMOUNT_SCORES:
        return CONGRESS_AMOUNT_SCORES[key]
    nk = key.replace("$", "").replace(",", "").lower()
    for ak, pts in CONGRESS_AMOUNT_SCORES.items():
        cand = ak.replace("$", "").replace(",", "").lower()
        if cand == nk:
            return pts
    return 0


def congress_score_for_ticker(sym: str, signals: dict[str, Any]) -> int:
    """Sum per-disclosure tier scores for this ticker; cap at CONGRESS_SCORE_CAP."""
    sym = sym.upper()
    rows = [
        r
        for r in (signals.get("congress_buys") or [])
        if (r.get("ticker") or "").upper() == sym
    ]
    raw = sum(congress_tier_points(r.get("amounts")) for r in rows)
    return min(raw, CONGRESS_SCORE_CAP)


def score_insider_signal(qualifying_insiders: list[dict[str, Any]]) -> int:
    """
    Insider score from total notional across qualifying rows (not per-row stacking).
    Capped at 40 points for this category.
    """
    if not qualifying_insiders:
        return 0

    total_notional = sum(get_insider_dollar_value(r) for r in qualifying_insiders)
    has_officer = any(r.get("is_officer") for r in qualifying_insiders)
    unique_buyers = len({(r.get("owner_name") or "").strip() for r in qualifying_insiders})
    role_mult = 1.5 if has_officer else 1.0

    if total_notional >= 1_000_000:
        base = 30
    elif total_notional >= 500_000:
        base = 22
    elif total_notional >= 250_000:
        base = 15
    elif total_notional >= 100_000:
        base = 10
    elif total_notional >= 25_000:
        base = 5
    else:
        base = 0

    cluster_bonus = 5 if unique_buyers >= 5 else (3 if unique_buyers >= 3 else 0)
    raw = int(base * role_mult) + cluster_bonus
    return min(raw, 40)


def signal_narrative(ticker: str, signals: dict[str, Any]) -> list[str]:
    """
    Plain-English bullet points explaining why this ticker scored as it did.
    Written for a non-technical reader.
    """
    sym = ticker.strip().upper()
    bullets: list[str] = []

    congress_rows = [
        r
        for r in (signals.get("congress_buys") or [])
        if (r.get("ticker") or "").upper() == sym
    ]
    if congress_rows:
        names = sorted(
            {
                (r.get("name") or "Member").strip()
                for r in congress_rows
                if (r.get("name") or "").strip()
            }
        )
        if not names:
            names = ["a member of Congress"]
        total = len(congress_rows)
        largest = max(congress_rows, key=lambda r: _congress_tier_value(r.get("amounts")))
        largest_amt = largest.get("amounts") or "undisclosed amount"
        if total >= 2:
            bullets.append(
                f"{total} members of Congress bought this stock in the last {CONGRESS_LOOKBACK_DAYS} days "
                f"(including {names[0]}). Largest disclosed purchase: {largest_amt}."
            )
        else:
            bullets.append(
                f"{names[0]} (Congress) bought this stock. "
                f"Disclosed amount: {largest_amt}."
            )

    insider_rows = qualifying_insider_rows(
        [
            t
            for t in (signals.get("insider_buys") or [])
            if (t.get("ticker") or "").upper() == sym
        ]
    )
    if insider_rows:
        total_notional = sum(get_insider_dollar_value(r) for r in insider_rows)
        officers = [r for r in insider_rows if r.get("is_officer")]
        unique = len({(r.get("owner_name") or "").strip() for r in insider_rows})
        role_desc = "corporate officers" if officers else "company insiders"
        bullets.append(
            f"{unique} {role_desc} made open-market purchases totaling "
            f"~${total_notional:,.0f} in the last {INSIDER_LOOKBACK_DAYS} days."
        )

    flow = [r for r in (signals.get("flow_alerts") or []) if (r.get("ticker") or "").upper() == sym]
    sweeps = [r for r in flow if r.get("has_sweep")]
    if sweeps:
        largest_sweep = max(sweeps, key=lambda r: float(r.get("total_premium") or 0))
        prem = float(largest_sweep.get("total_premium") or 0)
        strike = largest_sweep.get("strike")
        expiry = str(largest_sweep.get("expiry") or "")
        bullets.append(
            f"Unusual call options activity: a sweep order worth "
            f"${prem:,.0f} was placed on the ${strike} calls expiring {expiry}. "
            f"Sweep orders suggest an urgent, potentially informed buyer."
        )
    elif flow:
        bullets.append(f"{len(flow)} unusual call options alert(s) detected today.")

    dp = [r for r in (signals.get("darkpool") or []) if (r.get("ticker") or "").upper() == sym]
    if dp:
        total_dp = sum(float(r.get("premium") or 0) for r in dp)
        bullets.append(
            f"Large off-exchange (dark pool) purchase of ${total_dp:,.0f} detected. "
            f"Dark pool prints often indicate institutional accumulation."
        )

    screener_row: dict[str, Any] = {}
    sc = signals.get("screener")
    if isinstance(sc, dict):
        screener_row = sc.get(sym) or {}
    try:
        rel_vol = float(screener_row.get("relative_volume") or 0)
    except (TypeError, ValueError):
        rel_vol = 0.0
    if rel_vol >= 2.0:
        bullets.append(
            f"Trading volume is {rel_vol:.1f}x its 30-day average today — "
            f"significantly elevated activity."
        )

    tech = get_technicals(sym)
    bullets.extend(tech.get("tech_summary") or [])

    return bullets


def score_breakdown(ticker: str, signals: dict[str, Any]) -> dict[str, Any]:
    """
    Itemized breakdown matching score_ticker() — for debugging / SME review.
    Does not mutate signals.
    """
    sym = ticker.strip().upper()
    parts: list[dict[str, Any]] = []
    total = 0

    congress_buys = signals.get("congress_buys") or []
    congress_rows = [t for t in congress_buys if (t.get("ticker") or "").upper() == sym]
    raw_cong = sum(congress_tier_points(r.get("amounts")) for r in congress_rows)
    capped_cong = min(raw_cong, CONGRESS_SCORE_CAP)
    if congress_rows:
        parts.append(
            {
                "category": "congress",
                "points": capped_cong,
                "reason": (
                    f"sum of amount-tier points = {raw_cong}, cap {CONGRESS_SCORE_CAP} → +{capped_cong} "
                    f"({len(congress_rows)} disclosure(s))"
                ),
            }
        )
    else:
        parts.append(
            {
                "category": "congress",
                "points": 0,
                "reason": "no congressional buys for this ticker",
            }
        )
    total += capped_cong

    insider_buys = signals.get("insider_buys") or []
    ticker_insiders = [t for t in insider_buys if (t.get("ticker") or "").upper() == sym]
    qualifying = qualifying_insider_rows(ticker_insiders)
    ins_pts = score_insider_signal(qualifying)
    if qualifying:
        tn = sum(get_insider_dollar_value(r) for r in qualifying)
        has_o = any(r.get("is_officer") for r in qualifying)
        ub = len({(r.get("owner_name") or "").strip() for r in qualifying})
        parts.append(
            {
                "category": "insider",
                "points": ins_pts,
                "reason": (
                    f"total notional ${tn:,.0f}, officer present={has_o}, unique buyers={ub} "
                    f"→ +{ins_pts} (cap 40)"
                ),
            }
        )
    else:
        detail = "no qualifying insider P-buys"
        if ticker_insiders:
            detail = (
                f"0 rows ≥ ${INSIDER_MIN_DOLLAR_FOR_SCORE:,} notional "
                f"({len(ticker_insiders)} row(s) below threshold or bad price data)"
            )
        parts.append({"category": "insider", "points": 0, "reason": detail})
    total += ins_pts

    flow_alerts = signals.get("flow_alerts") or []
    ticker_flow = [t for t in flow_alerts if (t.get("ticker") or "").upper() == sym]
    sweep_alerts = [t for t in ticker_flow if t.get("has_sweep")]

    if len(ticker_flow) >= 3:
        pts = 20
        parts.append(
            {
                "category": "options_flow",
                "points": pts,
                "reason": f"{len(ticker_flow)} call flow alert(s) (≥3) → +{pts}",
            }
        )
        total += pts
    elif sweep_alerts:
        pts = 15
        parts.append(
            {
                "category": "options_flow",
                "points": pts,
                "reason": f"{len(sweep_alerts)} sweep alert(s) → +{pts}",
            }
        )
        total += pts
    elif ticker_flow:
        pts = 10
        parts.append(
            {
                "category": "options_flow",
                "points": pts,
                "reason": f"{len(ticker_flow)} call flow alert(s), no sweep/3+ branch → +{pts}",
            }
        )
        total += pts
    else:
        parts.append(
            {
                "category": "options_flow",
                "points": 0,
                "reason": "no qualifying call flow alerts",
            }
        )

    darkpool = signals.get("darkpool") or []
    ticker_dp = [t for t in darkpool if (t.get("ticker") or "").upper() == sym]
    large_prints = [t for t in ticker_dp if float(t.get("premium") or 0) >= 1_000_000]

    if large_prints:
        pts = 15
        parts.append(
            {
                "category": "dark_pool",
                "points": pts,
                "reason": f"{len(large_prints)} print(s) ≥$1M premium → +{pts}",
            }
        )
        total += pts
    elif ticker_dp:
        pts = 8
        parts.append(
            {
                "category": "dark_pool",
                "points": pts,
                "reason": f"{len(ticker_dp)} print(s) ≥$500k (none ≥$1M) → +{pts}",
            }
        )
        total += pts
    else:
        parts.append(
            {
                "category": "dark_pool",
                "points": 0,
                "reason": "no dark pool rows for ticker",
            }
        )

    screener = signals.get("screener") or {}
    if isinstance(screener, dict):
        row = screener.get(sym) or {}
    else:
        row = {}
    try:
        rel_vol = float(row.get("relative_volume") or 0)
    except (TypeError, ValueError):
        rel_vol = 0.0

    if rel_vol >= 3.0:
        pts = 10
        parts.append(
            {
                "category": "volume",
                "points": pts,
                "reason": f"relative_volume={rel_vol:.3f} (≥3.0) → +{pts}",
            }
        )
        total += pts
    elif rel_vol >= 2.0:
        pts = 5
        parts.append(
            {
                "category": "volume",
                "points": pts,
                "reason": f"relative_volume={rel_vol:.3f} (≥2.0) → +{pts}",
            }
        )
        total += pts
    else:
        parts.append(
            {
                "category": "volume",
                "points": 0,
                "reason": f"relative_volume={rel_vol:.3f} (<2.0 or missing)",
            }
        )

    base_raw = total
    tech = get_technicals(sym)
    tech_pts = int(tech.get("tech_score") or 0)
    parts.append(
        {
            "category": "technicals",
            "points": tech_pts,
            "reason": (
                f"RSI/MACD/MA/volume overlay → {tech_pts:+d} "
                f"(RSI={tech.get('rsi_14')}, MACD={tech.get('macd_cross')})"
            ),
        }
    )
    raw_total = base_raw + tech_pts
    combined = raw_total
    # Mirror score_ticker's fundamentals floor (10 pts).
    if base_raw < 10 and combined >= SCORE_WATCH_ALERT:
        combined = SCORE_WATCH_ALERT - 1
    final = max(0, min(100, combined))

    return {
        "ticker": sym,
        "components": parts,
        "raw_total": raw_total,
        "cap_applied": raw_total > 100 or (base_raw < 10 and base_raw + tech_pts >= SCORE_WATCH_ALERT),
        "final_score": final,
        "congress_rows_sample": congress_rows[:5],
        "insider_rows_sample": qualifying[:5],
        "insider_non_qualifying_count": max(0, len(ticker_insiders) - len(qualifying)),
        "flow_rows_sample": ticker_flow[:5],
        "darkpool_rows_sample": ticker_dp[:3],
    }


def format_score_breakdown(ticker: str, signals: dict[str, Any]) -> str:
    b = score_breakdown(ticker, signals)
    lines = [
        f"Score breakdown for {b['ticker']}",
        f"  Raw sum: {b['raw_total']}  →  final (capped): {b['final_score']}/100",
        "",
        "  By category:",
    ]
    for p in b["components"]:
        lines.append(f"    [{p['category']}] +{p['points']}: {p['reason']}")
    lines.append("")
    lines.append(f"  Verify score_ticker(): {score_ticker(ticker, signals)} (includes technicals)")
    return "\n".join(lines)


def score_ticker(ticker: str, signals: dict[str, Any]) -> int:
    sym = ticker.strip().upper()
    score = 0

    score += congress_score_for_ticker(sym, signals)

    insider_buys = signals.get("insider_buys") or []
    ticker_insiders = [t for t in insider_buys if (t.get("ticker") or "").upper() == sym]
    qualifying = qualifying_insider_rows(ticker_insiders)
    score += score_insider_signal(qualifying)

    flow_alerts = signals.get("flow_alerts") or []
    ticker_flow = [t for t in flow_alerts if (t.get("ticker") or "").upper() == sym]
    sweep_alerts = [t for t in ticker_flow if t.get("has_sweep")]

    if len(ticker_flow) >= 3:
        score += 20
    elif sweep_alerts:
        score += 15
    elif ticker_flow:
        score += 10

    darkpool = signals.get("darkpool") or []
    ticker_dp = [t for t in darkpool if (t.get("ticker") or "").upper() == sym]
    large_prints = [t for t in ticker_dp if float(t.get("premium") or 0) >= 1_000_000]

    if large_prints:
        score += 15
    elif ticker_dp:
        score += 8

    screener = signals.get("screener") or {}
    if isinstance(screener, dict):
        row = screener.get(sym) or {}
    else:
        row = {}
    try:
        rel_vol = float(row.get("relative_volume") or 0)
    except (TypeError, ValueError):
        rel_vol = 0.0

    if rel_vol >= 3.0:
        score += 10
    elif rel_vol >= 2.0:
        score += 5

    base_score = min(score, 100)
    tech = get_technicals(sym)
    tech_pts = int(tech.get("tech_score") or 0)
    total = base_score + tech_pts
    # Fundamentals floor: tech alone cannot flag a name into Watch/Buy. Requires
    # at least 10 pts of fundamental signal (≈ one small insider buy, one sweep,
    # or 2 small congress disclosures) before technicals can lift into tier.
    # Was 20 — lowered so small insider+congress pairs with strong tech reach Watch.
    if base_score < 10 and total >= SCORE_WATCH_ALERT:
        total = SCORE_WATCH_ALERT - 1
    return max(0, min(100, total))


def _congress_indicator(sym: str, signals: dict[str, Any]) -> dict[str, Any]:
    rows = [
        r
        for r in (signals.get("congress_buys") or [])
        if (r.get("ticker") or "").upper() == sym
    ]
    if not rows:
        return {"direction": "neutral", "conviction": "", "detail": ["No recent activity"]}

    total = len(rows)
    names = sorted(
        {(r.get("name") or "Member").strip() for r in rows if r.get("name")}
    )
    largest = max(rows, key=lambda r: _congress_amount_mid_dollars(r.get("amounts")))
    largest_val = _congress_amount_mid_dollars(largest.get("amounts"))
    total_val = sum(_congress_amount_mid_dollars(r.get("amounts")) for r in rows)
    largest_amt_str = largest.get("amounts") or "undisclosed"

    if largest_val >= 250_000 or total_val >= 500_000:
        conviction = "High Conviction"
    elif total_val >= 50_000:
        conviction = "Moderate"
    else:
        conviction = "Routine"

    clustered = False
    try:
        dates: list[datetime] = []
        for r in rows:
            d = r.get("date") or r.get("transaction_date") or ""
            if d:
                dates.append(datetime.strptime(str(d)[:10], "%Y-%m-%d"))
        if len(dates) >= 2:
            dates.sort()
            recent = sum(1 for d in dates if (dates[-1] - d).days <= 7)
            if recent >= 2:
                clustered = True
    except (TypeError, ValueError):
        pass

    name_str = names[0] if names else "Member"
    cluster_note = " · clustered" if clustered else ""
    detail = [
        f"{total} buy{'s' if total > 1 else ''} ({CONGRESS_LOOKBACK_DAYS}d){cluster_note}",
        f"Incl. {name_str}",
        f"Largest: {largest_amt_str}",
    ]
    return {"direction": "bullish", "conviction": conviction, "detail": detail[:3]}


def _insider_indicator(sym: str, signals: dict[str, Any]) -> dict[str, Any]:
    rows = qualifying_insider_rows(
        [
            r
            for r in (signals.get("insider_buys") or [])
            if (r.get("ticker") or "").upper() == sym
        ]
    )
    if not rows:
        return {"direction": "neutral", "conviction": "", "detail": ["No qualifying activity"]}

    total_val = sum(get_insider_dollar_value(r) for r in rows)
    unique = len({(r.get("owner_name") or "").strip() for r in rows})
    officers = [r for r in rows if r.get("is_officer")]
    if officers:
        role = "officer" if unique == 1 else "officers"
    else:
        role = "insider" if unique == 1 else "insiders"
    largest_val = max(get_insider_dollar_value(r) for r in rows)

    if largest_val >= 500_000 or total_val >= 1_000_000:
        conviction = "High Conviction"
    elif total_val >= 100_000:
        conviction = "Moderate"
    else:
        conviction = "Routine"

    detail = [
        f"{unique} {role} · ${total_val:,.0f} total",
        f"Last {INSIDER_LOOKBACK_DAYS} days",
    ]
    return {"direction": "bullish", "conviction": conviction, "detail": detail[:3]}


def _options_indicator(sym: str, signals: dict[str, Any]) -> dict[str, Any]:
    flow = [
        r
        for r in (signals.get("flow_alerts") or [])
        if (r.get("ticker") or "").upper() == sym
    ]
    screener_row: dict[str, Any] = {}
    sc = signals.get("screener")
    if isinstance(sc, dict):
        screener_row = sc.get(sym) or {}
    try:
        rel_vol = float(screener_row.get("relative_volume") or 0)
    except (TypeError, ValueError):
        rel_vol = 0.0

    if not flow and rel_vol < 2.0:
        return {"direction": "neutral", "conviction": "", "detail": ["No unusual flow"]}

    sweeps = [r for r in flow if r.get("has_sweep")]
    puts = [r for r in flow if str(r.get("put_call") or "").lower() == "put"]
    calls = [r for r in flow if str(r.get("put_call") or "").lower() == "call"]

    total_prem = sum(float(r.get("total_premium") or 0) for r in flow)
    max_sweep_prem = max((float(r.get("total_premium") or 0) for r in sweeps), default=0)

    if max_sweep_prem >= 500_000 or total_prem >= 1_000_000:
        conviction = "High Conviction"
    elif max_sweep_prem >= 100_000 or total_prem >= 250_000:
        conviction = "Moderate"
    else:
        conviction = "Routine"

    if calls and not puts:
        direction = "bullish"
    elif puts and not calls:
        direction = "bearish"
    elif calls and puts:
        direction = "mixed"
    else:
        direction = "neutral"

    detail: list[str] = []
    if sweeps:
        largest = max(sweeps, key=lambda r: float(r.get("total_premium") or 0))
        prem = float(largest.get("total_premium") or 0)
        side = "Call" if str(largest.get("put_call") or "").lower() == "call" else "Put"
        detail.append(f"{side} sweep ${prem:,.0f}")
    if len(flow) > 1:
        detail.append(f"{len(flow)} alerts total")
    if rel_vol >= 2.0:
        detail.append(f"Vol {rel_vol:.1f}x avg")
    if not detail:
        detail = ["Unusual activity"]
    return {"direction": direction, "conviction": conviction, "detail": detail[:3]}


def _technical_indicator(sym: str) -> dict[str, Any]:
    tech = get_technicals(sym)
    score = int(tech.get("tech_score") or 0)
    rsi = tech.get("rsi_14")
    macd = tech.get("macd_cross")
    a50 = tech.get("above_50ma")
    a200 = tech.get("above_200ma")

    if rsi is None and macd is None and a50 is None:
        return {"direction": "neutral", "conviction": "", "detail": ["No data"]}

    bull = 0
    bear = 0
    detail: list[str] = []

    if rsi is not None:
        if rsi < 40:
            bull += 1
            detail.append(f"RSI {rsi:.0f} — oversold")
        elif rsi > 70:
            bear += 1
            detail.append(f"RSI {rsi:.0f} — overbought")
        else:
            detail.append(f"RSI {rsi:.0f}")

    if macd == "bullish":
        bull += 1
        detail.append("MACD bullish cross")
    elif macd == "bearish":
        bear += 1
        detail.append("MACD bearish cross")

    if a50 is True and a200 is True:
        bull += 1
        detail.append("Above 50 & 200MA")
    elif a50 is True and a200 is False:
        detail.append("Above 50MA, below 200MA")
    elif a50 is False and a200 is False:
        bear += 1
        detail.append("Below 50 & 200MA")
    elif a50 is False and a200 is True:
        detail.append("Below 50MA, above 200MA")

    vol = tech.get("vol_surge")
    if vol is not None and vol >= 2.0:
        bull += 1
        detail.append(f"Vol {vol:.1f}x avg")

    abs_score = abs(score)
    if abs_score >= 12:
        conviction = "High Conviction"
    elif abs_score >= 5:
        conviction = "Moderate"
    else:
        conviction = "Routine" if (bull + bear) > 0 else ""

    if bull > 0 and bear == 0:
        direction = "bullish"
    elif bear > 0 and bull == 0:
        direction = "bearish"
    elif bull > 0 and bear > 0:
        direction = "mixed"
    else:
        direction = "neutral"

    return {"direction": direction, "conviction": conviction, "detail": detail[:3]}


def signal_indicators(ticker: str, signals: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """
    Four signal categories for the HTML indicator table:
        direction: bullish | bearish | neutral | mixed
        conviction: High Conviction | Moderate | Routine | ""
        detail: short phrases, max 3 items
    """
    sym = ticker.strip().upper()
    return {
        "congress": _congress_indicator(sym, signals),
        "insider": _insider_indicator(sym, signals),
        "options": _options_indicator(sym, signals),
        "technical": _technical_indicator(sym),
    }
