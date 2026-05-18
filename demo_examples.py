"""
demo_examples.py
================
Quick demo: builds an example_workbook.xlsx populated with the 25
community-shared loadouts in examples/example_loadouts.json.

Doesn't touch your user_config.json or my_loadouts.xlsx — so it's safe
to run alongside your real setup.

Usage:
    python3 demo_examples.py

You'll need a Bungie API key for the manifest download. The key is prompted
in-memory only — not written to disk.
"""

import getpass
import json
import sys
from pathlib import Path

EXAMPLES_PATH = Path("examples/example_loadouts.json")
OUTPUT_WORKBOOK = "example_workbook.xlsx"


def main():
    if not EXAMPLES_PATH.exists():
        sys.exit(f"ERROR: {EXAMPLES_PATH} not found")

    examples = json.loads(EXAMPLES_PATH.read_text())
    loadouts = examples["dim_loadouts"]
    print(f"  Loaded {len(loadouts)} example loadouts")
    print(f"  Output: {OUTPUT_WORKBOOK}")
    print()
    print("  Need your Bungie API key (used in-memory for the manifest fetch,")
    print("  NOT saved to disk). Get one in 30s: https://www.bungie.net/en/Application")
    print()
    api_key = getpass.getpass("  API key (hidden): ").strip()
    if len(api_key) < 16:
        sys.exit("  Invalid API key.")

    # Build a fresh workbook
    print()
    print("  Building example workbook...")
    from init_workbook import build_workbook
    demo_cfg = {
        "primary_class": "Warlock",  # arbitrary — most examples are Warlock
        "build_focus": {
            "archetype": "Grenadier",
            "target_stats": ["Grenade"],
            "goals": ["PvE", "DPS"],
        },
    }
    build_workbook(OUTPUT_WORKBOOK, user_cfg=demo_cfg)

    # Run the decoder with a temporary config (in-memory only)
    print("  Fetching Bungie manifest (~30-60s first time)...")
    import decode_dim
    # Monkey-patch CONFIG_PATH and load_config so we can run in-memory
    decode_dim.CONFIG_PATH = Path("/dev/null")  # never read
    cfg = {
        "api_key": api_key,
        "workbook_path": OUTPUT_WORKBOOK,
        "manifest_cache_dir": "./manifest_cache",
        "dim_loadouts": loadouts,
    }
    decode_dim.load_config = lambda: cfg
    decode_dim.main()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Aborted.")
        sys.exit(130)
