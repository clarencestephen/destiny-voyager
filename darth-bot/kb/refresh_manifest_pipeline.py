"""
darth-bot/kb/refresh_manifest_pipeline.py
==========================================
End-to-end manifest refresh + bake pipeline.

Bungie's manifest is the source of truth for every weapon / armor /
mod / ghost / etc. in Destiny 2. It's versioned and refreshed on a
schedule (typically each season + hotfix). This script makes the
toolkit's local manifest cache + every derived artifact fully
automated:

    1. GET  /Destiny2/Manifest                — checks current version
    2. compare against cached `.version` files
    3. if newer: download
         DestinyInventoryItemDefinition.json
         DestinyEquipableItemSetDefinition.json
       to /home/cs/workspace/Destiny 2/manifest_cache/
    4. node web/scripts/bake-slim-manifest.mjs  — emit web/public/manifest.json
    5. python3 -m darth_bot.kb.scrape_foundries — emit web/public/foundries.json
    6. python3 -m darth_bot.kb.scrape_manifest  — refresh the bot KB docs

Run weekly via cron, or once on bot startup. Idempotent — no-op when
the manifest hasn't changed.

Usage:
    python3 -m darth_bot.kb.refresh_manifest_pipeline           # full pipeline
    python3 -m darth_bot.kb.refresh_manifest_pipeline --force   # re-bake even if cached
    python3 -m darth_bot.kb.refresh_manifest_pipeline --check   # version check only

Cron (refresh every Tuesday + Friday at 11:00 UTC, aligned with
weekly/Trials resets so the bot's data is fresh by the time players
ask):
    0 11 * * 2,5  cd /path/to/destiny2-loadout-toolkit/darth-bot && \
        PYTHONPATH=. python3 -m kb.refresh_manifest_pipeline >> refresh.log 2>&1
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx


# Paths — adjust if the toolkit moves
TOOLKIT_DIR     = Path("/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit")
MANIFEST_CACHE  = Path("/home/cs/workspace/Destiny 2/manifest_cache")
WEB_SCRIPTS_DIR = TOOLKIT_DIR / "web" / "scripts"

BUNGIE_API_BASE = "https://www.bungie.net/Platform"
BUNGIE_CDN      = "https://www.bungie.net"

# Definition files we pull. The full manifest has ~50 — only these
# feed downstream scripts. Add more here if a future scraper needs
# something new (e.g. DestinyPlugSetDefinition for socket data).
TARGETED_DEFINITIONS = [
    "DestinyInventoryItemDefinition",
    "DestinyEquipableItemSetDefinition",
    "DestinyStatDefinition",
    "DestinyStatGroupDefinition",
    # bake-armor.mjs inputs — keep the whole cache in lockstep so a
    # post-refresh armor bake never mixes manifest versions:
    "DestinyPlugSetDefinition",
    "DestinySandboxPerkDefinition",
    "DestinyDamageTypeDefinition",
    "DestinyCollectibleDefinition",
    # bake-activities.mjs inputs — featured raid/dungeon name resolution
    # for the web "This Week" pages:
    "DestinyActivityDefinition",
    "DestinyActivityTypeDefinition",
]


def get_api_key() -> str:
    key = os.environ.get("BUNGIE_API_KEY", "")
    if key:
        return key
    # Fall back to reading from /home/cs/.env per the project's secret
    # workflow (see CLAUDE.md memory).
    env_path = Path("/home/cs/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("BUNGIE_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "BUNGIE_API_KEY not in environment or /home/cs/.env. "
        "Get one at https://www.bungie.net/en/Application."
    )


def fetch_manifest_meta(api_key: str) -> dict:
    """GET /Destiny2/Manifest → version + per-definition paths."""
    r = httpx.get(
        f"{BUNGIE_API_BASE}/Destiny2/Manifest/",
        headers={"X-API-Key": api_key},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("ErrorCode") != 1:
        raise RuntimeError(
            f"Bungie API error {data.get('ErrorCode')}: {data.get('Message')}"
        )
    return data["Response"]


def cached_version(def_name: str) -> str:
    v = MANIFEST_CACHE / f"{def_name}.version"
    return v.read_text().strip() if v.exists() else ""


def write_version(def_name: str, version: str) -> None:
    (MANIFEST_CACHE / f"{def_name}.version").write_text(version)


def download_definition(api_key: str, def_name: str, path_url: str) -> Path:
    """Download a single JSON definition file and atomic-write it."""
    out = MANIFEST_CACHE / f"{def_name}.json"
    tmp = MANIFEST_CACHE / f"{def_name}.json.tmp"
    print(f"  · {def_name}: downloading {BUNGIE_CDN + path_url} ...")
    with httpx.stream(
        "GET", BUNGIE_CDN + path_url,
        headers={"X-API-Key": api_key},
        timeout=120,
    ) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_bytes(chunk_size=64 * 1024):
                fh.write(chunk)
    tmp.replace(out)
    size_mb = out.stat().st_size / 1024 / 1024
    print(f"    ✓ {size_mb:.1f} MB")
    return out


def run(cmd: list[str], cwd: Path | None = None) -> bool:
    """Run a subprocess; return True on success."""
    print(f"  ▸ {' '.join(cmd)}{f'  (cwd={cwd})' if cwd else ''}")
    try:
        subprocess.run(cmd, cwd=cwd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"    ✗ exit {e.returncode}")
        return False
    except FileNotFoundError as e:
        print(f"    ✗ command not found: {e}")
        return False


def main(force: bool = False, check_only: bool = False) -> int:
    api_key = get_api_key()
    MANIFEST_CACHE.mkdir(parents=True, exist_ok=True)

    print("Bungie manifest pipeline\n" + "─" * 24)
    print("Step 1/6 — checking remote manifest version ...")
    meta = fetch_manifest_meta(api_key)
    remote_version = meta.get("version", "")
    print(f"  remote version: {remote_version}")

    en_paths = meta.get("jsonWorldComponentContentPaths", {}).get("en", {})

    refreshed = []
    print("\nStep 2/6 — per-definition refresh decisions:")
    for def_name in TARGETED_DEFINITIONS:
        local_version = cached_version(def_name)
        remote_path = en_paths.get(def_name)
        if not remote_path:
            print(f"  ! {def_name}: not present in this manifest version (skipped)")
            continue
        # The path itself encodes the version, so a string compare is enough.
        if not force and local_version == remote_path:
            print(f"  · {def_name}: up to date ({local_version[-12:]})")
            continue
        if check_only:
            print(f"  → {def_name}: WOULD refresh ({local_version[-12:] or '(none)'} → {remote_path[-12:]})")
            continue
        download_definition(api_key, def_name, remote_path)
        write_version(def_name, remote_path)
        refreshed.append(def_name)

    if check_only:
        print("\nCheck-only mode: no downloads, no derived artifacts. Done.")
        return 0

    if not refreshed and not force:
        print("\nNothing to refresh — every definition is current.")
        return 0

    print(f"\nStep 3/6 — refreshed: {', '.join(refreshed) or '(force re-bake)'}")

    print("\nStep 4/6 — baking slim manifest (web/public/manifest.json) ...")
    ok_slim = run(
        ["node", str(WEB_SCRIPTS_DIR / "bake-slim-manifest.mjs")],
        cwd=WEB_SCRIPTS_DIR,
    )

    print("\nStep 5/6 — extracting foundries (web/public/foundries.json) ...")
    bot_dir = Path(__file__).parent.parent
    ok_foundries = run(
        ["python3", "-m", "kb.scrape_foundries"],
        cwd=bot_dir,
    )

    print("\nStep 6/6 — refreshing bot KB docs (scrape_manifest) ...")
    ok_kb = run(
        ["python3", "-m", "kb.scrape_manifest"],
        cwd=bot_dir,
    )

    summary = {
        "ts":               int(time.time()),
        "iso":              time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "manifest_version": remote_version,
        "refreshed":        refreshed,
        "slim_manifest":    "ok" if ok_slim else "fail",
        "foundries":        "ok" if ok_foundries else "fail",
        "kb_docs":          "ok" if ok_kb else "fail",
    }
    (MANIFEST_CACHE / "last_pipeline_run.json").write_text(
        json.dumps(summary, indent=2)
    )
    print("\nPipeline summary:")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    return 0 if (ok_slim and ok_foundries and ok_kb) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--force", action="store_true",
        help="Re-bake every artifact even if the manifest hasn't changed.",
    )
    ap.add_argument(
        "--check", action="store_true",
        help="Print refresh decisions without downloading anything.",
    )
    args = ap.parse_args()
    sys.exit(main(force=args.force, check_only=args.check))
