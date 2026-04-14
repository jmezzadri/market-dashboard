# Trading Scanner
A Python-based trading opportunity scanner that pulls data from the Unusual Whales API to identify buy/watch signals and manage open portfolio positions. Runs automatically via GitHub Actions — no local machine required.

## Scan Schedule
| Scan | Schedule |
|---|---|
| Pre-market | Weekdays ~8 AM ET |
| Afternoon | Weekdays ~1 PM ET |
| Post-market | Weekdays ~4:30 PM ET |
| Weekly Review | Sundays ~6 PM ET |

## Scoring
- 60+ → Buy alert
- 35-59 → Watch list
- Below 35 → No action

## Running Manually
python3 main.py premarket
python3 main.py afternoon
python3 main.py postmarket
python3 main.py weekly

## Portfolio Files (keep current)
- portfolio/positions.csv — open positions
- portfolio/covered_calls.csv — active covered calls
- portfolio/cash.txt — available cash
