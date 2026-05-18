"""
setup.py
========
First-run install wizard. Walks you through:
  1. Entering your Bungie API key
  2. Entering your Bungie display name (e.g. Guardian#1234)
  3. Picking your primary class
  4. Adding your DIM share URLs (interactive loop — add as many as you want)
  5. Writing user_config.json (gitignored — never committed)
  6. Scaffolding a fresh workbook from the template
  7. Running decode_dim.py to populate the workbook with your DIM loadouts

Run it from the repo root:
    python3 setup.py

Re-running is safe — it asks before overwriting either file.
"""

import json
import shutil
import subprocess
import sys
import urllib.parse
import webbrowser
from pathlib import Path

BUNGIE_PORTAL_URL = "https://www.bungie.net/en/Application"

CONFIG_PATH = Path("user_config.json")
DEFAULT_WORKBOOK = "my_loadouts.xlsx"
DEFAULT_CACHE = "./manifest_cache"

CLASSES = ["Warlock", "Hunter", "Titan"]

# Current Destiny 2 armor archetypes (post-Edge of Fate). Each archetype boosts
# the stat shown, plus has 2 secondary stat tendencies. Names match in-game UI.
ARCHETYPES = {
    "Bulwark":    {"stat": "Health",  "desc": "Survivability — recovery, shield regen, DR"},
    "Brawler":    {"stat": "Melee",   "desc": "Melee builds — punch, hammer, Synthoceps stacks"},
    "Grenadier":  {"stat": "Grenade", "desc": "Grenade spam — Vortex / Sunspot / Storm grenades"},
    "Paragon":    {"stat": "Super",   "desc": "Super uptime — boss DPS, super-fueled builds"},
    "Specialist": {"stat": "Class",   "desc": "Class ability uptime — Rift / Barricade / Dodge"},
    "Gunner":     {"stat": "Weapons", "desc": "Weapon stats — reload, handling, airborne"},
}
STATS = ["Health", "Melee", "Grenade", "Super", "Class", "Weapons"]

from mod_recommender import GOALS


def banner(text):
    line = "=" * 72
    print(f"\n{line}\n  {text}\n{line}")


def prompt(label, default=None, validator=None, secret=False):
    """Prompt the user with optional default + validation."""
    while True:
        suffix = f" [{default}]" if default else ""
        raw = input(f"  {label}{suffix}: ").strip()
        if not raw and default is not None:
            raw = default
        if not raw:
            print("    (required — please enter a value)")
            continue
        if validator:
            ok, msg = validator(raw)
            if not ok:
                print(f"    {msg}")
                continue
        return raw


def yes_no(label, default=False):
    suffix = "[Y/n]" if default else "[y/N]"
    while True:
        raw = input(f"  {label} {suffix}: ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print("    (please answer y or n)")


def valid_api_key(s):
    s = s.strip()
    if len(s) < 16 or " " in s:
        return False, "that doesn't look like a Bungie API key (32 hex chars, no spaces)"
    return True, ""


def valid_bungie_name(s):
    if "#" not in s:
        return False, "expected format: DisplayName#1234"
    return True, ""


def valid_class(s):
    s_norm = s.strip().capitalize()
    if s_norm not in CLASSES:
        return False, f"pick one of: {', '.join(CLASSES)}"
    return True, ""


def valid_dim_url(s):
    s = s.strip()
    if not s.startswith("https://dim.gg/"):
        return False, "expected a https://dim.gg/... share URL (from DIM → Loadout → Share)"
    return True, ""


def valid_archetype(s):
    s_norm = s.strip().capitalize()
    if s_norm not in ARCHETYPES:
        return False, f"pick one of: {', '.join(ARCHETYPES)}"
    return True, ""


def collect_build_focus():
    """Prompt for armor archetype + 2-3 target stats."""
    print()
    print("  Armor archetypes (post-Edge of Fate). Each prioritizes one stat:")
    print()
    print(f"    {'Name':<12} {'Boosts':<10}  Read")
    print(f"    {'-'*12} {'-'*10}  {'-'*48}")
    for name, info in ARCHETYPES.items():
        print(f"    {name:<12} {info['stat']:<10}  {info['desc']}")
    print()
    arch = prompt("Pick an archetype",
                  default="Grenadier", validator=valid_archetype).capitalize()
    primary = ARCHETYPES[arch]["stat"]

    print()
    print(f"  Default primary stat from {arch}: {primary}")
    print(f"  Pick 1-2 additional stats to target (comma-separated, optional):")
    print(f"    Options: {', '.join(s for s in STATS if s != primary)}")
    print(f"  Examples:  Class,Weapons   |   Super   |   (leave blank)")
    print()
    raw = input("  Secondary target stats: ").strip()
    targets = [primary]
    if raw:
        for piece in raw.split(","):
            piece = piece.strip().capitalize()
            if piece in STATS and piece not in targets:
                targets.append(piece)

    # Build goals — multi-select
    print()
    print("  What are your build goals? (Pick 1 or more, comma-separated by number.)")
    for i, g in enumerate(GOALS, 1):
        print(f"    {i}. {g}")
    print()
    goals_raw = input("  Goals (e.g. 1,3 or just 3): ").strip()
    chosen_goals = []
    if goals_raw:
        for piece in goals_raw.split(","):
            piece = piece.strip()
            try:
                idx = int(piece) - 1
                if 0 <= idx < len(GOALS) and GOALS[idx] not in chosen_goals:
                    chosen_goals.append(GOALS[idx])
            except ValueError:
                # allow typing the name directly
                for g in GOALS:
                    if g.lower() == piece.lower() and g not in chosen_goals:
                        chosen_goals.append(g)
    if not chosen_goals:
        chosen_goals = ["PvE"]
        print("  (no selection — defaulting to PvE)")

    return {
        "archetype": arch,
        "target_stats": targets,
        "goals": chosen_goals,
    }


def collect_dim_loadouts():
    print()
    print("  We'll add your DIM share URLs now. For each loadout:")
    print("    1. Open DIM at https://app.destinyitemmanager.com")
    print("    2. Loadouts tab → click a loadout → Share → Copy URL")
    print("    3. Paste it here")
    print()
    print("  Press Enter on an empty class name when you're done adding loadouts.")
    print()

    loadouts = []
    n = 0
    while True:
        n += 1
        print(f"  --- Loadout #{n} ---")
        cls_raw = input(f"  Class (Warlock/Hunter/Titan, or blank to finish): ").strip()
        if not cls_raw:
            break
        cls_norm = cls_raw.capitalize()
        if cls_norm not in CLASSES:
            print(f"    (pick one of: {', '.join(CLASSES)}) — skipping")
            n -= 1
            continue

        name = prompt('Name (e.g. "Still Hunt Raid", "Solar PvP")')
        activity = prompt('Activity (Raid / PvP / Solo Ops / GM / etc.)',
                          default="General")
        url = prompt("DIM share URL", validator=valid_dim_url)

        loadouts.append({
            "class": cls_norm,
            "name": name,
            "activity": activity,
            "url": url,
        })
        print(f"    ✓ Added: {cls_norm} — {name}")
        print()

    return loadouts


def write_config(cfg):
    if CONFIG_PATH.exists():
        if not yes_no(f"{CONFIG_PATH} already exists. Overwrite?", default=False):
            print("  (keeping existing config — exiting setup)")
            sys.exit(0)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
    # chmod 600 — best-effort on POSIX; ignored on Windows
    try:
        CONFIG_PATH.chmod(0o600)
    except Exception:
        pass
    print(f"  ✓ Wrote {CONFIG_PATH}  (gitignored — will never be committed)")


def init_workbook(workbook_path, cfg):
    workbook = Path(workbook_path)
    if workbook.exists():
        if not yes_no(f"{workbook} already exists. Overwrite with fresh template?",
                      default=False):
            print(f"  (keeping existing workbook at {workbook})")
            return
    print(f"  Building fresh workbook at {workbook}...")
    try:
        from init_workbook import build_workbook
    except ImportError as e:
        sys.exit(f"ERROR: openpyxl not installed. Run: pip install -r requirements.txt\n({e})")
    build_workbook(workbook, user_cfg=cfg)
    print(f"  ✓ Workbook created: {workbook}")


def run_decoder():
    print()
    print("  Running decode_dim.py to populate the DIM LOADOUTS (FULL) tab...")
    print("  (First run downloads the Bungie manifest — ~150 MB, 30-60 seconds.)")
    print()
    result = subprocess.run([sys.executable, "decode_dim.py"])
    return result.returncode == 0


def main():
    banner("DESTINY VOYAGER — INSTALL WIZARD")
    print()
    print("  This will set up your personal config + workbook.")
    print("  Your Bungie API key is saved to user_config.json (gitignored — never")
    print("  uploaded, never committed). Press Ctrl+C anytime to abort.")
    print()

    # --- 1. Bungie API key
    banner("1/4  Bungie API key")
    print()
    print("  You need a free Bungie API key. Takes about 30 seconds.")
    print()
    print(f"    →  {BUNGIE_PORTAL_URL}")
    print()
    print("  On that page:")
    print("    1. Sign in with your Bungie account")
    print("    2. Click 'Create New App' (top right)")
    print("    3. Application Name: anything (e.g. 'My Loadout Tool')")
    print("    4. Website: anything (e.g. https://localhost)")
    print("    5. OAuth Client Type: Public  (or Confidential — either works)")
    print("    6. Redirect URL: https://localhost")
    print("    7. Origin Header: leave blank")
    print("    8. Scope: 'Read your Destiny 2 information' (default is fine)")
    print("    9. Agree to terms → Create")
    print("   10. Copy the 'API Key' value at the top of the new app page")
    print()
    print("  Full walkthrough with screenshots: docs/getting-bungie-api-key.md")
    print()

    if yes_no("Open the Bungie portal in your browser now?", default=True):
        try:
            webbrowser.open(BUNGIE_PORTAL_URL)
            print(f"    Opened {BUNGIE_PORTAL_URL}")
        except Exception:
            print(f"    Couldn't open automatically — visit {BUNGIE_PORTAL_URL} manually")
        print()
        input("  Press Enter once you've copied your API key, ready to paste...  ")
        print()
    api_key = prompt("Paste your Bungie API key", validator=valid_api_key)

    # --- 2. Bungie name
    banner("2/4  Your Bungie display name")
    print()
    print("  This is just for labelling output — not for OAuth.")
    print('  Format: DisplayName#1234   (e.g. "Guardian#0421")')
    print()
    bungie_name = prompt("Your Bungie name", validator=valid_bungie_name)

    # --- 3. Primary class
    banner("3/5  Your primary class")
    print()
    print(f"  Which class do you main? Pick one: {', '.join(CLASSES)}")
    print("  (This just sets which class sheet opens first in the workbook.)")
    print()
    primary_cls = prompt("Primary class", default="Warlock",
                         validator=valid_class).capitalize()

    # --- 4. Build focus
    banner("4/5  Build focus  —  armor archetype + target stats")
    build_focus = collect_build_focus()

    # --- 5. DIM loadouts
    banner("5/5  Your DIM share URLs")
    loadouts = collect_dim_loadouts()
    if not loadouts:
        print("  No loadouts entered — that's fine, you can add them later with:")
        print("    python3 add_loadout.py")

    # --- Write config
    cfg = {
        "_comment": "Personal config — gitignored. Generated by setup.py.",
        "api_key": api_key,
        "bungie_name": bungie_name,
        "primary_class": primary_cls,
        "build_focus": build_focus,
        "workbook_path": f"./{DEFAULT_WORKBOOK}",
        "manifest_cache_dir": DEFAULT_CACHE,
        "dim_loadouts": loadouts,
    }

    banner("Writing config + scaffolding workbook")
    print()
    write_config(cfg)
    init_workbook(cfg["workbook_path"], cfg)

    # --- Run decoder if we have any loadouts
    if loadouts:
        if yes_no("Run decode_dim.py now to populate the workbook?", default=True):
            ok = run_decoder()
            if not ok:
                print()
                print("  Decoder failed. You can re-run it later with: python3 decode_dim.py")

    # --- Done
    banner("DONE")
    print()
    print(f"  Config:   {CONFIG_PATH.resolve()}")
    print(f"  Workbook: {Path(cfg['workbook_path']).resolve()}")
    print()
    print("  Next steps:")
    print(f"    • Open {DEFAULT_WORKBOOK} and fill in PRIORITIES, WISHLIST, and class build sheets")
    print(f"    • Add more DIM URLs anytime:  python3 add_loadout.py")
    print(f"    • Re-decode after DIM changes:  python3 decode_dim.py")
    print()
    print("  Reminder: user_config.json is gitignored. Your API key never leaves your machine.")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Aborted.")
        sys.exit(130)
