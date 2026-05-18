"""
examples/reclassify.py
======================
Re-fetch every DIM URL in example_loadouts.json and update the `class` field
based on the current classType in the loadout JSON. Useful if DIM ever
changes its page format or if a loadout is moved between characters.

Usage:
    python3 examples/reclassify.py
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

EXAMPLES_PATH = Path(__file__).parent / "example_loadouts.json"
CLASS_BY_TYPE = {0: "Titan", 1: "Hunter", 2: "Warlock"}


def fetch_class(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8")
    idx = html.find("loadouts?loadout=")
    if idx < 0:
        return "Unknown"
    start = idx + len("loadouts?loadout=")
    end = html.find('"', start)
    if end < 0:
        end = html.find(")", start)
    encoded = html[start:end].rstrip(")").rstrip('"')
    loadout = json.loads(urllib.parse.unquote(encoded))
    return CLASS_BY_TYPE.get(loadout.get("classType"), "Unknown")


def main():
    data = json.loads(EXAMPLES_PATH.read_text())
    changes = 0
    for ld in data["dim_loadouts"]:
        old = ld["class"]
        try:
            new = fetch_class(ld["url"])
        except Exception as e:
            print(f"  [err] {ld['name']}: {e}")
            continue
        if new != old:
            print(f"  {old:8} → {new:8}  {ld['name']}")
            ld["class"] = new
            changes += 1
        else:
            print(f"  {old:8}        {ld['name']}")
    EXAMPLES_PATH.write_text(json.dumps(data, indent=2) + "\n")
    print(f"\n  Updated {changes} classifications.")


if __name__ == "__main__":
    main()
