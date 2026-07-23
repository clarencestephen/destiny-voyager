#!/usr/bin/env bash
# dv-manifest-refresh.sh — keep the LIVE site's manifest in lockstep with Bungie.
#
#   1. kb/refresh_manifest_pipeline.py: version-check Bungie → download changed
#      definitions → bake slim manifest + foundries + bot KB. No-op when the
#      manifest version hasn't changed (one cheap API call).
#   2. Only when the version DID change (or --force): rebuild the web frontend
#      (prebuild re-bakes slim manifest + armor catalogs) and deploy straight
#      to Cloudflare Pages PRODUCTION (--branch=main).
#
# Driven every 15 min by the dv-manifest-refresh.timer user unit, so whenever
# a user logs into the site the baked manifest is at most ~15 min behind
# Bungie. Safe to run by hand:  deploy/dv-manifest-refresh.sh [--force]
set -uo pipefail

TOOLKIT="/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit"
CACHE="/home/cs/workspace/Destiny 2/manifest_cache"
MARKER="$CACHE/DestinyInventoryItemDefinition.version"
LOCK="/tmp/dv-manifest-refresh.lock"

# darth-bot conda env (has httpx + the kb.* modules' deps); nvm node for bakes
# + wrangler. systemd's default PATH has neither.
PYTHON="/home/cs/anaconda3/envs/darth-bot/bin/python"
export PATH="/home/cs/.nvm/versions/node/v20.20.2/bin:$PATH"

# BUNGIE_API_KEY + CLOUDFLARE_EMAIL/CLOUDFLARE_API_KEY (wrangler Global-Key
# auth). The systemd unit also sets these via EnvironmentFile; sourcing here
# keeps manual runs working too.
set -a; source /home/cs/.env 2>/dev/null; set +a
# Two Cloudflare accounts on this login — destiny-voyager lives in this one.
export CLOUDFLARE_ACCOUNT_ID="6bbf1ec878c89f895d001b48937cd4ef"

# Never two refreshes at once (timer tick + manual run, or a slow download).
exec 9>"$LOCK"
flock -n 9 || { echo "[skip] another refresh is already running"; exit 0; }

force=0
for a in "$@"; do [ "$a" = "--force" ] && force=1; done

before=$(cat "$MARKER" 2>/dev/null || echo "")

cd "$TOOLKIT/darth-bot"
PYTHONPATH=. "$PYTHON" -m kb.refresh_manifest_pipeline "$@"
pipeline_rc=$?

after=$(cat "$MARKER" 2>/dev/null || echo "")

if [ "$before" = "$after" ] && [ "$force" -eq 0 ]; then
    # Version unchanged → the site's baked manifest is already current.
    exit 0
fi

# KB/foundries failures (pipeline_rc != 0) affect the Discord bot, not the
# site — still deploy the site if the manifest itself refreshed.
[ "$pipeline_rc" -ne 0 ] && echo "[warn] pipeline exited $pipeline_rc (bot KB steps?) — deploying site anyway"

echo "[deploy] manifest ${after:+→ ${after##*/}} — rebuilding + deploying Pages production"
cd "$TOOLKIT/web"
npm run build || { echo "[fail] web build failed — production NOT updated"; exit 1; }
npx wrangler pages deploy dist --project-name=destiny-voyager --branch=main --commit-dirty=true \
    || { echo "[fail] Pages deploy failed"; exit 1; }
echo "[done] production updated"
