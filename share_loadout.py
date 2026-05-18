"""
share_loadout.py
================
Export and import portable loadouts as JSON files. Friends can share
loadouts by sending each other the .json — drop into ./loadouts/ and
load with `python3 share_loadout.py --import <file>`.

Format is self-describing — name, class, equipped item hashes, mods,
subclass overrides. Compatible with decode_dim.py's output structure.

Usage:
    # Export an in-game loadout by character + slot
    python3 share_loadout.py --export-game --char Hunter --slot 3 \\
        --name "My Crota DPS" --out loadouts/crota_dps.json

    # Export a DIM share URL into a portable JSON
    python3 share_loadout.py --export-dim https://dim.gg/xxx/Raid \\
        --out loadouts/imported.json

    # Import a friend's loadout (just adds to your user_config.json's saved_loadouts)
    python3 share_loadout.py --import loadouts/friend_build.json

    # List your saved + shared loadouts
    python3 share_loadout.py --list
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CONFIG_PATH = Path("user_config.json")
LOADOUTS_DIR = Path("loadouts")

CLASS_BY_TYPE = {0: "Titan", 1: "Hunter", 2: "Warlock"}
TYPE_BY_CLASS = {v: k for k, v in CLASS_BY_TYPE.items()}


def load_cfg():
    if not CONFIG_PATH.exists():
        sys.exit("ERROR: user_config.json not found.")
    return json.loads(CONFIG_PATH.read_text())


def save_cfg(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
    try:
        CONFIG_PATH.chmod(0o600)
    except Exception:
        pass


def export_from_dim(url, name, out_path):
    """Pull a DIM share URL → portable JSON."""
    print(f"  Fetching {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8")
    marker = "loadouts?loadout="
    idx = html.find(marker)
    if idx < 0:
        sys.exit("  Could not find loadout JSON in DIM page.")
    start = idx + len(marker)
    end = html.find('"', start)
    if end < 0:
        end = html.find(")", start)
    encoded = html[start:end].rstrip(")").rstrip('"')
    loadout = json.loads(urllib.parse.unquote(encoded))

    portable = {
        "version": 1,
        "source": "dim",
        "source_url": url,
        "name": name or loadout.get("name", "Unnamed"),
        "class": CLASS_BY_TYPE.get(loadout.get("classType"), "Unknown"),
        "exported_at": int(time.time()),
        "loadout": loadout,
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(portable, indent=2))
    print(f"  ✓ Wrote {out_path}")


def export_in_game_loadout(char_class, slot, name, out_path):
    """Pull an in-game saved loadout via Bungie API → portable JSON."""
    from auth import ensure_signed_in
    from bungie_client import BungieClient
    cfg = load_cfg()
    ensure_signed_in(client_id=cfg.get("oauth_client_id", "52250"))
    client = BungieClient()
    print("  Fetching in-game loadouts...")
    data = client.get_in_game_loadouts()
    target_type = TYPE_BY_CLASS.get(char_class)
    if target_type is None:
        sys.exit(f"  Invalid class {char_class}. Use Hunter/Titan/Warlock.")

    matched_char = None
    for char_id, c in data["characters"].items():
        if c.get("classType") == target_type:
            matched_char = char_id
            break
    if not matched_char:
        sys.exit(f"  No {char_class} character on your account.")

    loadouts = data["loadouts"].get(matched_char, {}).get("loadouts", [])
    if slot < 1 or slot > len(loadouts):
        sys.exit(f"  Slot {slot} out of range (1-{len(loadouts)})")
    ld = loadouts[slot - 1]

    portable = {
        "version": 1,
        "source": "in-game",
        "name": name or f"{char_class} Loadout #{slot}",
        "class": char_class,
        "slot": slot,
        "exported_at": int(time.time()),
        "loadout": ld,
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(portable, indent=2))
    print(f"  ✓ Wrote {out_path}")


def import_loadout(in_path):
    """Add a portable loadout JSON to user_config.json's saved_loadouts."""
    p = Path(in_path)
    if not p.exists():
        sys.exit(f"  {in_path} not found.")
    portable = json.loads(p.read_text())
    if portable.get("version") != 1:
        sys.exit(f"  Unsupported loadout format version: {portable.get('version')}")
    cfg = load_cfg()
    saved = cfg.setdefault("saved_loadouts", [])
    saved.append({
        "name": portable.get("name", "Unnamed"),
        "class": portable.get("class"),
        "source": portable.get("source"),
        "imported_from": str(p),
        "imported_at": int(time.time()),
        "loadout": portable.get("loadout"),
    })
    save_cfg(cfg)
    print(f"  ✓ Imported {portable.get('name')!r} ({portable.get('class')}) "
          f"into saved_loadouts ({len(saved)} total)")


def list_loadouts(cfg):
    saved = cfg.get("saved_loadouts", [])
    print(f"  {len(saved)} saved loadouts in user_config.json:")
    for i, ld in enumerate(saved, 1):
        print(f"    {i:3d}. {ld.get('class','?'):8} | {ld.get('name','?'):32} "
              f"(from {ld.get('source','?')})")
    print()
    if LOADOUTS_DIR.exists():
        files = sorted(LOADOUTS_DIR.glob("*.json"))
        print(f"  {len(files)} loadout JSON files in {LOADOUTS_DIR}/:")
        for f in files:
            try:
                p = json.loads(f.read_text())
                print(f"    {f.name:40} {p.get('class','?'):8} {p.get('name','?')}")
            except Exception:
                print(f"    {f.name}  (unreadable)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export-game", action="store_true",
                    help="Export an in-game saved loadout (Lightfall+)")
    ap.add_argument("--export-dim", help="DIM share URL to export")
    ap.add_argument("--import", dest="import_path", help="Import a portable JSON")
    ap.add_argument("--list", action="store_true", help="List saved loadouts")
    ap.add_argument("--char", help="Character class (Hunter/Titan/Warlock)")
    ap.add_argument("--slot", type=int, help="Loadout slot (1-10)")
    ap.add_argument("--name", help="Friendly name for the export")
    ap.add_argument("--out", help="Output JSON path")
    args = ap.parse_args()

    cfg = load_cfg()

    if args.list:
        list_loadouts(cfg)
    elif args.import_path:
        import_loadout(args.import_path)
    elif args.export_dim:
        if not args.out:
            sys.exit("  --out is required")
        export_from_dim(args.export_dim, args.name, args.out)
    elif args.export_game:
        if not (args.char and args.slot and args.out):
            sys.exit("  --char, --slot, and --out are required for --export-game")
        export_in_game_loadout(args.char.capitalize(), args.slot, args.name, args.out)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
