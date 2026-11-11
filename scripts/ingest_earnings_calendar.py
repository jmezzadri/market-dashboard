#!/usr/bin/env python3
"""Next earnings date for US-listed companies — Watchlist page (Joe, 2026-11-11).

Source: Alpha Vantage's EARNINGS_CALENDAR, a documented data API built to be
read by programs, on its free tier. ONE request a run returns every company
expected to report in the next three months, with the report date and, where
known, whether it is before the open or after the close. No cost.

The key is free but tied to an e-mail address; it is read from ops_secrets
(name 'alphavantage_api_key'), with the ALPHAVANTAGE_API_KEY environment
variable as a fallback. With no key on file the job stamps the feed red with
a plain reason and writes nothing — it never guesses a date (LESSONS 3.1).

What is stored (public.earnings_calendar, one row per ticker): the EARLIEST
upcoming report date, its time of day, the fiscal period it covers and the
consensus EPS estimate.

A date is confirmed once the company announces it; further out it is the
calendar's projection from the company's reporting history and can move. The
Methodology page says so.

  python3 scripts/ingest_earnings_calendar.py            # fetch + write
  python3 scripts/ingest_earnings_calendar.py --dry-run  # fetch only
"""
import csv
import datetime as dt
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

HEALTH_ID = 'earnings-calendar'
MIN_TICKERS = 300      # a three-month window always holds well over a thousand
URL = 'https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={key}'
WHEN = {'pre-market': 'before the open', 'post-market': 'after the close'}


def rest(method, path, payload=None, prefer=None):
    base = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/'
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=150) as r:
        body = r.read()
    return json.loads(body) if body else None


def stamp(*args):
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run([sys.executable, os.path.join(here, 'upsert_pipeline_health.py'), HEALTH_ID, *args], check=False)


def api_key():
    try:
        rows = rest('GET', 'ops_secrets?name=eq.alphavantage_api_key&select=value')
        if rows and rows[0].get('value'):
            return rows[0]['value'].strip()
    except Exception as e:
        print(f'ops_secrets could not be read: {e}')
    return (os.environ.get('ALPHAVANTAGE_API_KEY') or '').strip() or None


def parse(text, today):
    """CSV -> {ticker: row}, keeping each ticker's earliest date from today on."""
    if not text.lstrip().lower().startswith('symbol,'):
        # The API answers a bad key or a spent daily allowance with JSON prose.
        raise ValueError('not a calendar: ' + ' '.join(text.split())[:200])
    best = {}
    for r in csv.DictReader(io.StringIO(text)):
        sym = (r.get('symbol') or '').strip().upper()
        day = (r.get('reportDate') or '').strip()
        if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,11}', sym) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
            continue
        if day < today.isoformat():
            continue
        if sym in best and best[sym]['report_date'] <= day:
            continue
        est = (r.get('estimate') or '').strip()
        try:
            est = float(est) if est else None
        except ValueError:
            est = None
        best[sym] = {
            'ticker': sym,
            'report_date': day,
            'report_time': WHEN.get((r.get('timeOfTheDay') or '').strip()),
            'fiscal_period_end': (r.get('fiscalDateEnding') or '').strip() or None,
            'eps_estimate': est,
            'source': 'alphavantage',
        }
    return best


def main():
    dry = '--dry-run' in sys.argv
    today = dt.datetime.now(ZoneInfo('America/New_York')).date()
    key = api_key()
    if not key:
        msg = 'No Alpha Vantage key is on file, so next earnings dates cannot be read'
        print(msg)
        if not dry:
            stamp('-', 'red', msg)
        return 1
    try:
        with urllib.request.urlopen(URL.format(key=urllib.parse.quote(key)), timeout=60) as r:
            text = r.read().decode('utf-8', 'replace')
        best = parse(text, today)
    except Exception as e:
        print(f'earnings calendar could not be read: {e}')
        if not dry:
            stamp('-', 'red', 'The earnings calendar could not be read today - the Watchlist page shows the previous dates')
        return 1
    print(f'{len(best)} companies with an upcoming report date')
    for s in ('NVDA', 'WMT', 'HD', 'CSCO', 'AAPL'):
        if s in best:
            print(f"  {s}: {best[s]['report_date']} {best[s]['report_time'] or ''}")
    if len(best) < MIN_TICKERS:
        print(f'only {len(best)} companies - refusing to write')
        if not dry:
            stamp('-', 'red', f'The earnings calendar returned only {len(best)} companies - nothing was written')
        return 1
    if dry:
        print('dry run: nothing written')
        return 0
    rows = list(best.values())
    ts = dt.datetime.now(dt.timezone.utc).isoformat()
    for r in rows:
        r['fetched_at'] = ts
    for i in range(0, len(rows), 500):
        rest('POST', 'earnings_calendar?on_conflict=ticker', rows[i:i + 500],
             prefer='resolution=merge-duplicates,return=minimal')
    # A ticker the calendar no longer lists (it has reported, or the date was
    # withdrawn) must not keep a stale date: drop every row this run did not write.
    rest('DELETE', 'earnings_calendar?fetched_at=lt.' + urllib.parse.quote(ts), prefer='return=minimal')
    stamp(today.isoformat(), 'green')
    try:   # fold the new dates into the page's stored facts straight away
        print(f"stock_facts_build: {rest('POST', 'rpc/stock_facts_build', {})} rows")
    except Exception as e:   # the nightly rebuild will pick them up
        print(f'stock_facts_build skipped: {e}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
