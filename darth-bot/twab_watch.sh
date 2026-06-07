#!/usr/bin/env bash
# Daily TWAB watcher — emails clarence.stephen@gmail.com on new Destiny updates.
# Email 1 (Bungie highlights) fires on a new /News/Destiny|DestinyUpdates post;
# Email 2 (Aztecross summary) fires ~2-3 days later when his video posts.
# Both idempotent via data/twab_watcher_state.json. MARATHON is hard-excluded.
set -uo pipefail
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO="$( cd "$SCRIPT_DIR/.." && pwd )"; cd "$REPO"
[[ -f /home/cs/.env ]] && { set -a; source /home/cs/.env; set +a; }
LOG="darth-bot/data/twab_watcher.log"
{ echo "=== twab_watch @ $(date -u +%FT%TZ) ==="
  python3 darth-bot/twab_watcher.py --check --aztecross
} >> "$LOG" 2>&1
