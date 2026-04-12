#!/bin/bash
# Install or refresh the LaunchAgent from launchd/*.plist (paths filled for this machine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.joemezzadri.market-dashboard.fetch"
SRC="${ROOT}/launchd/${LABEL}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -f "$SRC" ]]; then
	echo "Missing $SRC" >&2
	exit 1
fi
mkdir -p "${HOME}/Library/LaunchAgents"

sed -e "s|__HOME__|${HOME}|g" -e "s|__REPO__|${ROOT}|g" "$SRC" >"$DEST"
plutil -lint "$DEST"

AGENT_UID="$(id -u)"
echo "Installing LaunchAgent for gui/${AGENT_UID}…"
launchctl bootout "gui/${AGENT_UID}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${AGENT_UID}" "$DEST"
echo "✓ Loaded ${DEST}"
echo "  Logs: ${HOME}/Library/Logs/market-dashboard-fetch.log"
echo "  Test:  launchctl kickstart -k gui/${AGENT_UID}/${LABEL}"
