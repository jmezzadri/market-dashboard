#!/bin/bash
# Publishes the latest scan JSON from trading-scanner to the market-dashboard
# public folder and pushes it to GitHub so the hosted dashboard can fetch it.
#
# Invocation:
#   - Called automatically by scripts/run-daily-fetch.sh (morning catch-up)
#   - Can be called manually right after a scan: ~/Developer/market-dashboard/scripts/publish-scan-data.sh
#
# Auth: uses GITHUB_TOKEN from ~/.config/market-dashboard.env, or whatever
# credential helper git is configured with.
set -eo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_SRC="${SCAN_SRC:-$HOME/Documents/Claude/Projects/Trading Recommendations/trading-scanner/reports/latest_scan_data.json}"
SCAN_DST="${REPO}/public/latest_scan_data.json"

# Load GITHUB_TOKEN if available
ENV_FILE="${HOME}/.config/market-dashboard.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$ENV_FILE"
	set +a
fi

if [[ ! -f "$SCAN_SRC" ]]; then
	echo "publish-scan-data: source missing: $SCAN_SRC" >&2
	exit 1
fi

mkdir -p "$(dirname "$SCAN_DST")"
cp "$SCAN_SRC" "$SCAN_DST"
echo "publish-scan-data: copied $(stat -f%z "$SCAN_DST" 2>/dev/null || stat -c%s "$SCAN_DST") bytes → public/latest_scan_data.json"

cd "$REPO"
git add public/latest_scan_data.json
if git diff --cached --quiet; then
	echo "publish-scan-data: no changes — skipping commit"
	exit 0
fi

SCAN_TIME="$(python3 -c "import json,sys; d=json.load(open('$SCAN_DST')); print(d.get('date_label',''))" 2>/dev/null || echo "")"
COMMIT_MSG="Scan data update${SCAN_TIME:+ - $SCAN_TIME} [skip ci]"
git commit -m "$COMMIT_MSG"
echo "publish-scan-data: committed — $(git log --oneline -1)"

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"

if [[ -n "$TOKEN" && "$ORIGIN_URL" == https://github.com/* ]]; then
	git -c "http.https://github.com/.extraheader=AUTHORIZATION: bearer $TOKEN" push origin HEAD:main
else
	git push origin HEAD:main
fi

echo "publish-scan-data: done"
