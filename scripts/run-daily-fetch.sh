#!/bin/bash
# Daily data fetch for Market Stress Dashboard (called by launchd).
#
# Python: launchd often runs /usr/bin/python3; Homebrew packages (anthropic, etc.) live under
#   /opt/homebrew/bin/python3 — we use that explicitly. Install deps with:
#     /opt/homebrew/bin/python3 -m pip install -r requirements.txt
#   Override: export MARKET_DASHBOARD_PYTHON=/path/to/python3 in ~/.config/market-dashboard.env
#
# Git push: launchd does not inherit SSH_AUTH_SOCK from Terminal; we attach to the GUI ssh-agent
#   socket when possible. For HTTPS remotes, set GITHUB_TOKEN (fine-grained PAT: Contents RW) in
#   ~/.config/market-dashboard.env so push works without ssh-agent.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Prefer Homebrew Python (same as `pip3 install` after `brew shellenv` in an interactive shell).
if [[ -n "${MARKET_DASHBOARD_PYTHON:-}" && -x "${MARKET_DASHBOARD_PYTHON}" ]]; then
  PYTHON="${MARKET_DASHBOARD_PYTHON}"
elif [[ -x /opt/homebrew/bin/python3 ]]; then
  PYTHON="/opt/homebrew/bin/python3"
elif [[ -x /usr/local/bin/python3 ]]; then
  PYTHON="/usr/local/bin/python3"
else
  PYTHON="$(command -v python3 || true)"
fi
if [[ -z "${PYTHON}" || ! -x "${PYTHON}" ]]; then
  echo "run-daily-fetch: no usable python3 (install Homebrew Python or set MARKET_DASHBOARD_PYTHON)" >&2
  exit 1
fi

# Let git/ssh use the login session's agent (non-interactive push over SSH).
if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  shopt -s nullglob
  for sock in /private/tmp/com.apple.launchd.*/Listeners; do
    [[ -S "$sock" ]] || continue
    _rc=0
    SSH_AUTH_SOCK="${sock}" ssh-add -l &>/dev/null || _rc=$?
    if [[ "${_rc}" -eq 0 || "${_rc}" -eq 1 ]]; then
      export SSH_AUTH_SOCK="${sock}"
      break
    fi
  done
  shopt -u nullglob
  unset _rc
fi

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
echo "Using Python: $("${PYTHON}" -c 'import sys; print(sys.executable)')"
exec "${PYTHON}" "${ROOT}/fetch_indicators.py"
