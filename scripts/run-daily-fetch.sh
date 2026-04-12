#!/bin/bash
# Daily data fetch for Market Stress Dashboard (called by launchd).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# launchd often runs with HOME unset; GUI jobs usually have /Users/<short name>
if [[ -z "${HOME:-}" ]]; then
	export HOME="/Users/$(id -un)"
fi
# If the env file isn't under $HOME but exists in the usual macOS home, use that
_u="/Users/$(id -un)"
if [[ ! -f "${HOME}/.config/market-dashboard.env" && -f "${_u}/.config/market-dashboard.env" ]]; then
	export HOME="${_u}"
fi
unset _u

ENV_FILE="${HOME}/.config/market-dashboard.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$LOG_DIR"
exec >>"${LOG_DIR}/market-dashboard-fetch.log" 2>>"${LOG_DIR}/market-dashboard-fetch.err.log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
exec python3 "${ROOT}/fetch_indicators.py"
