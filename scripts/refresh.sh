#!/bin/bash
# Auto-refresh the RH Smart Money dashboard: re-seed the snapshot, redeploy.
# Run by launchd on a schedule (see com.tut.rhsm-refresh.plist).
# Logs to scripts/refresh.log so you can see the last run.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."          # project root
mkdir -p scripts
LOG="scripts/refresh.log"

echo "=== refresh $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

# Load the Alchemy key
set -a; source .env.local; set +a

# Re-seed (moderate: enough for a full board, gentle on rate limits)
POOL_PAGES=3 CANDIDATES=2500 /opt/homebrew/bin/node scripts/seed.js 1000 >> "$LOG" 2>&1 \
  || { echo "seed failed" >> "$LOG"; exit 1; }

# Redeploy to production (vercel CLI is authed on this machine)
/usr/local/bin/vercel --prod --yes >> "$LOG" 2>&1 \
  || { echo "deploy failed" >> "$LOG"; exit 1; }

echo "done $(date '+%H:%M:%S')" >> "$LOG"
