# Signal Indicator Table — Spec for Cursor
**Scope:** `scanner/scorer.py`, `scanner/reporter.py`, `main.py`
**Goal:** Replace the freeform italic analysis paragraph in each card with a structured 4-column signal indicator table. Each signal category shows direction (Bullish / Bearish / Neutral / Mixed), conviction tier (High / Moderate / Routine), and a concise detail summary.
**Last updated:** 2026-04-14

---

## Design Philosophy

Professional-grade financial tool. No decorative emoji. Colored circles only for status indicators (green = bullish, amber = mixed/moderate, red = bearish, grey = neutral). Clean, dense, readable. Think Bloomberg terminal card, not a consumer app.

---

## Target Layout (per card, analysis row)

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ CONGRESS         │ INSIDER          │ OPTIONS FLOW     │ TECHNICAL        │
│ ● Bullish        │ ● Neutral        │ ● Bullish        │ ● Mixed          │
│ High Conviction  │ No activity      │ High Conviction  │ Moderate         │
│ 7 buys · 3 this  │                  │ Call sweep $912k │ RSI 65           │
│ week · Lgst $1M  │                  │ +1 alert         │ Above 50MA only  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

Four equal-width columns, always shown (even neutral). Category label → direction circle + label → conviction tier → detail lines.

---

## Direction + Color System

| Direction | Circle color | Label    |
|-----------|-------------|----------|
| Bullish   | `#27ae60` (green) | Bullish |
| Bearish   | `#e74c3c` (red)   | Bearish |
| Mixed     | `#e67e22` (amber) | Mixed   |
| Neutral   | `#95a5a6` (grey)  | Neutral |

Circle rendered as: `<span style="color:{color};">●</span> {label}`

No other emoji or icons anywhere in these cards.

---

## Conviction Tiers

### Congress conviction — based on total disclosed dollar volume + clustering

| Tier | Condition | Label |
|------|-----------|-------|
| High | Any single buy ≥ $250k OR total disclosed ≥ $500k | High Conviction |
| Moderate | Total $50k–$499k | Moderate |
| Routine | Total < $50k | Routine |

Also compute `days_span` = (latest buy date − earliest buy date) in the window. If multiple buys occurred within 7 days, append "clustered" to the detail.

Use `_congress_tier_value()` to convert UW amount strings to midpoint dollar values for summing.

### Insider conviction — dollar amount × role weight

| Tier | Condition | Label |
|------|-----------|-------|
| High | Any single buy ≥ $500k OR total ≥ $1M | High Conviction |
| Moderate | Total $100k–$999k | Moderate |
| Routine | Total < $100k | Routine |

Officer (is_officer=True) purchases carry more weight — flag role explicitly in detail.

### Options Flow conviction — premium size

| Tier | Condition | Label |
|------|-----------|-------|
| High | Any sweep premium ≥ $500k OR total flow premium ≥ $1M | High Conviction |
| Moderate | Sweep $100k–$499k OR total $250k–$999k | Moderate |
| Routine | Total < $100k | Routine |

### Technical conviction — mapped from tech_score

| Tier | Condition | Label |
|------|-----------|-------|
| High | abs(tech_score) ≥ 12 | High Conviction |
| Moderate | abs(tech_score) 5–11 | Moderate |
| Routine / Neutral | abs(tech_score) < 5 | Routine / Neutral |

---

## 1. New Functions in `scorer.py`

### `signal_indicators(ticker, signals)` — main entry point

```python
def signal_indicators(ticker: str, signals: dict[str, Any]) -> dict[str, dict]:
    """
    Returns a dict of 4 signal categories, each with:
        direction:  "bullish" | "bearish" | "neutral" | "mixed"
        conviction: "High Conviction" | "Moderate" | "Routine" | ""
        detail:     list[str]  — short phrases, max 3 items
    """
    sym = ticker.strip().upper()
    return {
        "congress":  _congress_indicator(sym, signals),
        "insider":   _insider_indicator(sym, signals),
        "options":   _options_indicator(sym, signals),
        "technical": _technical_indicator(sym),
    }
```

### `_congress_indicator(sym, signals)`

```python
def _congress_indicator(sym: str, signals: dict) -> dict:
    rows = [r for r in (signals.get("congress_buys") or [])
            if (r.get("ticker") or "").upper() == sym]
    if not rows:
        return {"direction": "neutral", "conviction": "", "detail": ["No recent activity"]}

    total = len(rows)
    names = sorted({(r.get("name") or "Member").strip() for r in rows if r.get("name")})
    largest = max(rows, key=lambda r: _congress_tier_value(r.get("amounts")))
    largest_val = _congress_tier_value(largest.get("amounts"))
    total_val = sum(_congress_tier_value(r.get("amounts")) for r in rows)
    largest_amt_str = largest.get("amounts") or "undisclosed"

    # Conviction tier
    if largest_val >= 250_000 or total_val >= 500_000:
        conviction = "High Conviction"
    elif total_val >= 50_000:
        conviction = "Moderate"
    else:
        conviction = "Routine"

    # Clustering — check if multiple buys within 7 days
    clustered = False
    try:
        from datetime import datetime, timedelta
        dates = []
        for r in rows:
            d = r.get("date") or r.get("transaction_date") or ""
            if d:
                dates.append(datetime.strptime(str(d)[:10], "%Y-%m-%d"))
        if len(dates) >= 2:
            dates.sort()
            span = (dates[-1] - dates[0]).days
            recent = sum(1 for d in dates if (dates[-1] - d).days <= 7)
            if recent >= 2:
                clustered = True
    except Exception:
        pass

    detail = []
    name_str = names[0] if names else "Member"
    cluster_note = " · clustered" if clustered else ""
    detail.append(f"{total} buy{'s' if total > 1 else ''} ({CONGRESS_LOOKBACK_DAYS}d){cluster_note}")
    detail.append(f"Incl. {name_str}")
    detail.append(f"Largest: {largest_amt_str}")

    return {"direction": "bullish", "conviction": conviction, "detail": detail}
```

### `_insider_indicator(sym, signals)`

```python
def _insider_indicator(sym: str, signals: dict) -> dict:
    rows = qualifying_insider_rows(
        [r for r in (signals.get("insider_buys") or [])
         if (r.get("ticker") or "").upper() == sym]
    )
    if not rows:
        return {"direction": "neutral", "conviction": "", "detail": ["No qualifying activity"]}

    total_val = sum(get_insider_dollar_value(r) for r in rows)
    unique = len({(r.get("owner_name") or "").strip() for r in rows})
    officers = [r for r in rows if r.get("is_officer")]
    role = "officer" if officers else "insider"
    largest_val = max(get_insider_dollar_value(r) for r in rows)

    if largest_val >= 500_000 or total_val >= 1_000_000:
        conviction = "High Conviction"
    elif total_val >= 100_000:
        conviction = "Moderate"
    else:
        conviction = "Routine"

    detail = [
        f"{unique} {role}{'s' if unique > 1 else ''} · ${total_val:,.0f} total",
        f"Last {INSIDER_LOOKBACK_DAYS} days",
    ]
    return {"direction": "bullish", "conviction": conviction, "detail": detail}
```

### `_options_indicator(sym, signals)`

```python
def _options_indicator(sym: str, signals: dict) -> dict:
    flow = [r for r in (signals.get("flow_alerts") or [])
            if (r.get("ticker") or "").upper() == sym]
    screener_row = {}
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
    puts   = [r for r in flow if str(r.get("put_call") or "").lower() == "put"]
    calls  = [r for r in flow if str(r.get("put_call") or "").lower() == "call"]

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

    detail = []
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

    return {"direction": direction, "conviction": conviction, "detail": detail}
```

### `_technical_indicator(sym)`

```python
def _technical_indicator(sym: str) -> dict:
    from scanner.technicals import get_technicals
    tech = get_technicals(sym)
    score = tech.get("tech_score") or 0
    rsi   = tech.get("rsi_14")
    macd  = tech.get("macd_cross")
    a50   = tech.get("above_50ma")
    a200  = tech.get("above_200ma")

    if rsi is None and macd is None and a50 is None:
        return {"direction": "neutral", "conviction": "", "detail": ["No data"]}

    bull = 0
    bear = 0
    detail = []

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
```

---

## 2. New Function in `reporter.py`: `_signal_indicator_table_html()`

```python
_DIRECTION_STYLE = {
    "bullish": ("#27ae60", "Bullish"),
    "bearish": ("#e74c3c", "Bearish"),
    "mixed":   ("#e67e22", "Mixed"),
    "neutral": ("#95a5a6", "Neutral"),
}

def _signal_indicator_table_html(indicators: dict) -> str:
    """4-column signal indicator table for the card analysis row."""
    cols = [
        ("Congress",     indicators.get("congress")  or {}),
        ("Insider",      indicators.get("insider")   or {}),
        ("Options Flow", indicators.get("options")   or {}),
        ("Technical",    indicators.get("technical") or {}),
    ]

    cells = []
    for i, (label, ind) in enumerate(cols):
        direction  = ind.get("direction") or "neutral"
        conviction = ind.get("conviction") or ""
        color, dir_label = _DIRECTION_STYLE.get(direction, ("#95a5a6", "Neutral"))
        detail_lines = ind.get("detail") or []
        detail_html = "<br/>".join(_escape_html(d) for d in detail_lines)
        border = "" if i == len(cols) - 1 else "border-right:1px solid #eee;"

        cells.append(
            f'<td style="padding:7px 10px;width:25%;vertical-align:top;{border}">'
            f'<div style="font-size:10px;font-weight:700;color:#888;'
            f'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">'
            f'{_escape_html(label)}</div>'
            f'<div style="margin-bottom:2px;">'
            f'<span style="color:{color};font-size:12px;">&#9679;</span>'
            f'<span style="font-size:11px;font-weight:700;color:#333;margin-left:4px;">'
            f'{dir_label}</span>'
            f'</div>'
            f'{"<div style=\\"font-size:10px;color:#888;margin-bottom:3px;\\">" + _escape_html(conviction) + "</div>" if conviction else ""}'
            f'<div style="font-size:11px;color:#555;line-height:1.5;">{detail_html}</div>'
            f'</td>'
        )

    return (
        '<table style="border-collapse:collapse;width:100%;'
        'border-top:1px solid #eee;background:#fafafa;">'
        f'<tr>{"".join(cells)}</tr>'
        '</table>'
    )
```

---

## 3. Changes to card builders in `reporter.py`

### Update `_stock_card_html()` and `_stock_card_html_portfolio()`

Both functions need a `signals` parameter added. Replace the `analysis_row` block:

```python
# OLD — remove:
analysis_row = ""
if analysis:
    analysis_row = (
        f'<tr style="background:#fafafa;">'
        f'<td colspan="2" style="...italic...">{analysis}</td></tr>'
    )

# NEW:
from scanner import scorer as _scorer
indicators = _scorer.signal_indicators(row.get("ticker_raw", row["ticker"]), signals)
indicator_html = _signal_indicator_table_html(indicators)
analysis_row = f'<tr><td colspan="2" style="padding:0;">{indicator_html}</td></tr>'
```

Add `"ticker_raw": t` (unescaped ticker string) to each row dict alongside `"ticker": _escape_html(sym)`.

Update `_build_section_html()` to accept and pass through `signals`.

Update `build_scan_report_body_html()` to pass `signals` into `_build_section_html()`.

---

## 4. Remove old analysis fields

Remove `"analysis"` key from triggered/watch/portfolio row dicts in `build_scan_report_body_html()`.

Keep `signal_narrative()` and `_analysis_two_sentences()` — still used by `build_plain_text_email()`.

---

## 5. Remove temp debug print from `main.py`

Delete this block entirely:
```python
# TEMP DEBUG: show tech results for watch/buy tickers
for t, s in list(buy_scored) + list(watch_scored):
    tech = get_technicals(t)
    print(f"TECH {t}: ...")
    for b in (tech.get("tech_summary") or []):
        print(f"  BULLET: {b[:100]}")
```

---

## 6. Example Output

**MSFT** — Congress + Options + Mixed Technical:
```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ CONGRESS         │ INSIDER          │ OPTIONS FLOW     │ TECHNICAL        │
│ ● Bullish        │ ● Neutral        │ ● Bullish        │ ● Mixed          │
│ High Conviction  │                  │ High Conviction  │ Moderate         │
│ 7 buys (45d)     │ No qualifying    │ Call sweep $912k │ RSI 65           │
│ Incl. Cisneros   │ activity         │ 2 alerts total   │ Above 50MA,      │
│ Largest: $500k–  │                  │                  │ below 200MA      │
│ $1M              │                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

**MNR** — Insider only + Oversold:
```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ CONGRESS         │ INSIDER          │ OPTIONS FLOW     │ TECHNICAL        │
│ ● Neutral        │ ● Bullish        │ ● Neutral        │ ● Bullish        │
│                  │ High Conviction  │                  │ Moderate         │
│ No recent        │ 1 officer        │ No unusual flow  │ RSI 37 — oversold│
│ activity         │ $1.9M total      │                  │                  │
│                  │ Last 14 days     │                  │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

---

## 7. Testing

```bash
python main.py intraday --debug
```

Verify in the received email:
1. Every card has a 4-column indicator table
2. Neutral columns show grey ● Neutral with a brief "No activity" line
3. Conviction tier appears below direction for non-neutral signals
4. No emoji other than colored circles (●) — no flames, checkmarks, etc.
5. Color coding: green=bullish, red=bearish, amber=mixed, grey=neutral
6. Plain-text email still readable (uses signal_narrative fallback)

---

*Signal indicator table spec authored by Claude (Subject Matter Expert) | April 14, 2026*
