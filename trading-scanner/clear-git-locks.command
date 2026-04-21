#!/bin/bash
# Clears stale .git/*.lock files that block commits from GitHub Desktop.
# Safe — .lock files are meant to be transient; this only affects stale ones.
set -e
cd "$(dirname "$0")"
echo "Clearing stale git lock files in $(pwd)/.git …"
rm -f .git/*.lock .git/refs/*.lock .git/refs/heads/*.lock
echo "✓ Done. You can close this window and retry the commit."
sleep 1
