#!/bin/bash
# Daily data fetch for Market Stress Dashboard (called by launchd).
#
# Python: set MARKET_DASHBOARD_PYTHON in ~/.config/market-dashboard.env if needed.
#   Default order: CLT → Homebrew → PATH (anthropic must be installed for that interpreter):
#     /Library/Developer/CommandLineTools/usr/bin/python3 -m pip install -r requirements.txt
#
# Logs: default ~/Library/Logs/market-dashboard-fetch.log. When you run this script in Terminal
#   (interactive), output is also printed to the screen via tee — launchd runs non-interactively
#   and only writes the log file.
#
# Git: SSH_AUTH_SOCK discovery + optional GITHUB_TOKEN for https://github.com remotes.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${HOME:-}" ]]; then
	export HOME="/Users/$(id -un)"
fi
_u="/Users/$(id -un)"
if [[ ! -f "${HOME}/.config/market-dashboard.env" && -f "${_u}/.config/market-dashboard.env" ]]; then
	export HOME="${_u}"
fi
unset _u

LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$LOG_DIR"
MAIN_LOG="${LOG_DIR}/market-dashboard-fetch.log"
ERR_LOG="${LOG_DIR}/market-dashboard-fetch.err.log"
if [[ -t 1 ]]; then
	exec > >(tee -a "${MAIN_LOG}") 2> >(tee -a "${ERR_LOG}" >&2)
	echo "(Logging to ${MAIN_LOG} — you should see output below.)"
else
	exec >>"${MAIN_LOG}" 2>>"${ERR_LOG}"
fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
echo "run-daily-fetch: root=${ROOT}"
echo "run-daily-fetch: script_path=${BASH_SOURCE[0]}"

if [[ -x /opt/homebrew/bin/brew ]]; then
	eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ENV_FILE="${HOME}/.config/market-dashboard.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$ENV_FILE"
	set +a
fi

# Resolve Python AFTER sourcing env (MARKET_DASHBOARD_PYTHON from market-dashboard.env).
if [[ -n "${MARKET_DASHBOARD_PYTHON:-}" && -x "${MARKET_DASHBOARD_PYTHON}" ]]; then
	PYTHON="${MARKET_DASHBOARD_PYTHON}"
elif [[ -x /Library/Developer/CommandLineTools/usr/bin/python3 ]]; then
	PYTHON="/Library/Developer/CommandLineTools/usr/bin/python3"
elif [[ -x /opt/homebrew/bin/python3 ]]; then
	PYTHON="/opt/homebrew/bin/python3"
elif [[ -x /usr/local/bin/python3 ]]; then
	PYTHON="/usr/local/bin/python3"
else
	PYTHON="$(command -v python3 || true)"
fi
if [[ -z "${PYTHON}" || ! -x "${PYTHON}" ]]; then
	echo "run-daily-fetch: no usable python3 — set MARKET_DASHBOARD_PYTHON or install CLT/Homebrew Python" >&2
	exit 1
fi

# pip --user installs to ~/Library/Python/x.y/...; launchd may set PYTHONNOUSERSITE or omit user site.
unset PYTHONNOUSERSITE 2>/dev/null || true
_USP="$("${PYTHON}" -c "import site; print(site.getusersitepackages())" 2>/dev/null || true)"
if [[ -n "${_USP}" && -d "${_USP}" ]]; then
	export PYTHONPATH="${_USP}${PYTHONPATH:+:${PYTHONPATH}}"
fi
unset _USP

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

echo "Using Python: $("${PYTHON}" -c 'import sys; print(sys.executable)')"
if ! "${PYTHON}" -c "import anthropic" 2>/dev/null; then
	echo "WARNING: anthropic not importable with this interpreter — daily email will fail. Run:"
	echo "  ${PYTHON} -m pip install anthropic"
fi

exec "${PYTHON}" "${ROOT}/fetch_indicators.py"
