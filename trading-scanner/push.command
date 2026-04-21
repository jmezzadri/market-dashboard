#!/bin/bash
# One-shot: push current main to origin. Safe to re-run (no-op if up to date).
set -e
cd "$(dirname "$0")"
echo "Pushing $(git rev-parse --abbrev-ref HEAD) to origin …"
git push origin main
echo "✓ Done. Next 7am ET scan will use the updated code."
sleep 1
