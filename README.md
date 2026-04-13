# Trading Signal Scanner

Python scanner that pulls data from the [Unusual Whales](https://unusualwhales.com) API, scores tickers against a defined signal model, screens covered-call candidates, and writes timestamped **Markdown + CSV** reports under `reports/`.

**Reports only** — this project does not place trades.

## Setup

1. Python 3.11+
2. Create a virtual environment and install dependencies:

```bash
cd trading-scanner
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and set `UNUSUAL_WHALES_API_KEY`. Optionally set `SCHWAB_APP_KEY`, `SCHWAB_APP_SECRET`, and `SCHWAB_REDIRECT_URI` when Schwab API access is approved.

## Usage

```bash
python main.py premarket
python main.py intraday
python main.py postmarket
python main.py weekly
```

Default scan type if omitted: `intraday`.

Scheduling is external (e.g. Cowork); this script is invoked on a schedule.

## Layout

| Path | Role |
|------|------|
| `main.py` | Entry point — full scan pipeline |
| `config.py` | Environment variables and strategy constants |
| `scanner/unusual_whales.py` | Unusual Whales REST calls |
| `scanner/schwab.py` | Schwab stubs (implement when credentials are available) |
| `scanner/scorer.py` | 0–100 signal score |
| `scanner/covered_calls.py` | Covered call screening from options chain |
| `scanner/reporter.py` | Markdown + CSV output |
| `reports/` | Generated `scan_YYYYMMDD_HHMMSS.md` / `.csv` |

## Options chain API

The technical spec referenced `GET /api/options/chain/{ticker}`. The live Unusual Whales API exposes option contracts at `GET /api/stock/{ticker}/option-contracts`; this project uses that endpoint and normalizes rows for the covered-call screener.

## Cloud setup (GitHub Actions)

Runs the scanner on GitHub’s runners on a schedule so it does not depend on your laptop. Reports are uploaded as workflow artifacts; email uses the same notifier as local runs.

### 1. Create a GitHub account

Sign up at [github.com](https://github.com) if needed.

### 2. Create a private repository

1. **+** → **New repository**
2. Name: `trading-scanner`
3. Set visibility to **Private**
4. **Create repository** (leave “Add README” unchecked if you are pushing existing code)

### 3. Push this project

From the `trading-scanner` directory:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/jmezzadri/trading-scanner.git
git push -u origin main
```

Or, with GitHub CLI: `gh repo create trading-scanner --private --source=. --remote=origin --push`

### 4. Add repository secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description |
|--------|-------------|
| `UNUSUAL_WHALES_API_KEY` | Unusual Whales API key |
| `ALERT_EMAIL_FROM` | Gmail address used to send mail |
| `ALERT_EMAIL_TO` | Destination inbox (e.g. josephmezzadri@gmail.com) |
| `GMAIL_APP_PASSWORD` | [Google App Password](https://myaccount.google.com/apppasswords) |

### 5. Test

**Actions** → choose a workflow → **Run workflow** → confirm a green run. Scheduled jobs use UTC cron (see `.github/workflows/*.yml`).

### Updating portfolio data in the cloud

Edit `portfolio/positions.csv` and `portfolio/covered_calls.csv` on GitHub (or push changes). The next workflow run reads the committed files.

---

## Disclaimer

This software is for informational purposes only and is not investment advice.
