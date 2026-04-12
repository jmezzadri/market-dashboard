#!/bin/bash
# Quick check that the 7:00 AM data fetch job is loaded and how to test it.
set -e
LABEL="com.joemezzadri.market-dashboard.fetch"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

echo "=== LaunchAgent: ${LABEL} ==="
if [[ -f "$PLIST" ]]; then
  echo "✓ Plist installed: $PLIST"
else
  echo "✗ Missing $PLIST — copy from market-dashboard/launchd/ and bootstrap (see fetch_indicators.py header)"
  exit 1
fi

echo ""
echo "=== launchctl status (excerpt) ==="
launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -25 || echo "(Could not read — try: launchctl list | grep market-dashboard)"

echo ""
echo "Scheduled: every day at 7:00 (local Mac time), runs:"
echo "  $(dirname "$0")/run-daily-fetch.sh"
echo ""
echo "Logs (main job output is here after run-daily-fetch redirects):"
echo "  ~/Library/Logs/market-dashboard-fetch.log"
echo "  ~/Library/Logs/market-dashboard-fetch.err.log"
echo "  (Older launchd-only lines may be in market-dashboard-fetch.launchd.out.log)"
echo ""
echo "If the job runs an old script path, reinstall:"
echo "  $(dirname "$0")/install-launchagent.sh"
echo ""
echo "=== Run the job NOW (same as tomorrow morning) ==="
echo "  launchctl kickstart -k gui/$(id -u)/${LABEL}"
echo ""
echo "=== Tomorrow ==="
echo "Leave the Mac awake or expect the job to run at next wake/login (LaunchAgents run when you're logged in)."
