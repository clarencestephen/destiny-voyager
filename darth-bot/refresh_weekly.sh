#!/usr/bin/env bash
# darth-bot/refresh_weekly.sh
# ===========================
# Weekly refresh of Darth Bot's knowledge.
#
# Order of operations:
#   1. Re-scrape all KB sources (light.gg, reddit, destinypedia)
#   2. Re-embed scraped Markdown into chromadb
#   3. Pull current week's Bungie API state into meta_state.json
#
# Logs to data/refresh.log (rotated by date — last 4 weeks kept).
#
# Cron suggestion (after Tuesday weekly reset at 1pm Pacific = 21:00 UTC):
#   30 21 * * 2  cd "/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit" && \
#                  bash darth-bot/refresh_weekly.sh
#
# Test manually:
#   bash darth-bot/refresh_weekly.sh

set -euo pipefail

# Locate repo root (this script lives in darth-bot/)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# Source env (Bungie API key, model name, etc.)
if [[ -f /home/cs/.env ]]; then
    set -a; source /home/cs/.env; set +a
fi

# Rotate log: keep last 4 weeks
LOG_DIR="darth-bot/data/refresh-logs"
mkdir -p "$LOG_DIR"
WEEK_TAG=$(date -u +%Y-W%V)
LOG="$LOG_DIR/refresh-$WEEK_TAG.log"

# Trim old logs (keep most recent 4)
ls -1t "$LOG_DIR"/refresh-*.log 2>/dev/null | tail -n +5 | xargs -r rm -f

{
    echo "===== refresh_weekly.sh @ $(date -u +%FT%TZ) ====="

    echo
    echo "[1/3] Re-scraping KB sources (light.gg, reddit, destinypedia)"
    python3 -m darth-bot.kb.scrape --source all || echo "  ⚠ scrape exited non-zero"

    echo
    echo "[2/3] Re-embedding into chromadb"
    python3 -m darth-bot.kb.embed || echo "  ⚠ embed exited non-zero"

    echo
    echo "[3/3] Refreshing meta_state.json from Bungie API"
    python3 -m darth-bot.meta_state --refresh || echo "  ⚠ meta_state --refresh exited non-zero"

    echo
    echo "===== done @ $(date -u +%FT%TZ) ====="
} 2>&1 | tee -a "$LOG"
