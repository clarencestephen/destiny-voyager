"""
darth-bot/kb/scrape_manifest.py
===============================
Convert the cached Bungie Destiny manifest (`DestinyInventoryItemDefinition.json`)
into ~30,000 markdown documents — one per item. This is the highest-quality,
zero-network corpus we can build.

Each doc contains the item's name, tier, type, slot, element, description,
and any flavor text. Embedded by kb/embed.py same as anything else.

Run:
    python3 -m darth_bot.kb.scrape_manifest
    python3 -m darth_bot.kb.scrape_manifest --tier exotic   # exotics only
    python3 -m darth_bot.kb.scrape_manifest --filter weapons
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from config import ORDER_66_MANIFEST, SCRAPE_DIR


_TABLE = "DestinyInventoryItemDefinition"

# itemType values from the manifest (subset)
ITEM_TYPES = {
    0: "None", 1: "Currency", 2: "Armor", 3: "Weapon", 4: "Message",
    5: "Engram", 6: "Consumable", 7: "ExchangeMaterial", 8: "MissionReward",
    9: "QuestStep", 10: "QuestStepComplete", 11: "Emblem", 12: "Quest",
    13: "Subclass", 14: "ClanBanner", 15: "Aura", 16: "Mod", 17: "Dummy",
    18: "Ship", 19: "Vehicle", 20: "Emote", 21: "Ghost", 22: "Package",
    23: "Bounty", 24: "Wrapper", 25: "SeasonalArtifact", 26: "Finisher",
    27: "Pattern",
}


def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:80] or "untitled"


def render_item(defn: dict) -> tuple[str, str, dict]:
    """Return (title, markdown_body, metadata_dict)."""
    dp = defn.get("displayProperties", {})
    inv = defn.get("inventory", {})
    name = dp.get("name", "").strip()
    if not name or "REDACTED" in name.upper() or "[]" in name:
        return None, None, None

    tier = inv.get("tierTypeName", "")
    item_type_name = defn.get("itemTypeDisplayName", "")
    item_type_num = defn.get("itemType", 0)
    description = (dp.get("description") or "").strip()
    flavor = (defn.get("flavorText") or "").strip()
    summary_hash = defn.get("summaryItemHash")
    class_type = {0: "Titan", 1: "Hunter", 2: "Warlock", 3: "Any"}.get(
        defn.get("classType", 3), "Any")

    if not description and not flavor:
        # Skip items with no useful text content
        return None, None, None

    body_lines = [
        f"# {name}",
        "",
        f"- **Tier:** {tier or '?'}",
        f"- **Type:** {item_type_name or ITEM_TYPES.get(item_type_num, '?')}",
        f"- **Class:** {class_type}",
    ]
    if description:
        body_lines += ["", "## Description", description]
    if flavor:
        body_lines += ["", "## Flavor", flavor]

    meta = {
        "tier": tier,
        "type": item_type_name,
        "class": class_type,
        "item_type_num": item_type_num,
        "hash": defn.get("hash"),
    }
    return name, "\n".join(body_lines), meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["exotic", "legendary", "rare", "common", "any"],
                    default="any")
    ap.add_argument("--filter", choices=["weapons", "armor", "mods", "subclass", "any"],
                    default="any")
    ap.add_argument("--max", type=int, default=999999, help="cap on items")
    args = ap.parse_args()

    f = ORDER_66_MANIFEST / f"{_TABLE}.json"
    if not f.exists():
        # Fallback: try the destiny-voyager renamed path
        for alt in [
            ORDER_66_MANIFEST.parent / "manifest_cache" / f"{_TABLE}.json",
            Path("/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit/manifest_cache") / f"{_TABLE}.json",
        ]:
            if alt.exists():
                f = alt
                break
    if not f.exists():
        raise SystemExit(f"ERROR: manifest cache not found at {f}. "
                         "Run `python3 decode_dim.py` in destiny-voyager first.")

    print(f"Loading manifest from {f}...")
    items = json.loads(f.read_text())
    print(f"  {len(items):,} item definitions")

    out_dir = SCRAPE_DIR / "manifest"
    out_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    skipped_no_text = 0
    seen_names = {}  # name → first hash, dedupe near-identical rolls

    for h, defn in items.items():
        if written >= args.max:
            break

        inv = defn.get("inventory", {}) or {}
        tier_name = (inv.get("tierTypeName") or "").lower()
        item_type_num = defn.get("itemType", 0)

        # Tier filter
        if args.tier != "any":
            if args.tier == "exotic"    and "exotic"    not in tier_name: continue
            if args.tier == "legendary" and "legendary" not in tier_name: continue
            if args.tier == "rare"      and "rare"      not in tier_name: continue
            if args.tier == "common"    and "common"    not in tier_name: continue

        # Category filter
        if args.filter != "any":
            if args.filter == "weapons"  and item_type_num != 3:                       continue
            if args.filter == "armor"    and item_type_num != 2:                       continue
            if args.filter == "mods"     and item_type_num != 16:                      continue
            if args.filter == "subclass" and item_type_num != 13:                      continue

        title, body, meta = render_item(defn)
        if title is None:
            skipped_no_text += 1
            continue

        # Dedupe by name — only keep the first hash with content for each name
        # (Bungie ships many duplicate "Throne World Helm" variants with identical text.)
        if title in seen_names:
            continue
        seen_names[title] = meta["hash"]

        # Frontmatter
        fm = [
            "---",
            f'title: "{title.replace(chr(34), chr(39))}"',
            "source: manifest",
            f'url: bungie:item:{meta["hash"]}',
            f"tier: {meta['tier']}",
            f"type: {meta['type']}",
            f"class: {meta['class']}",
            "---",
        ]
        fname = out_dir / f"{slugify(title)}-{meta['hash']}.md"
        fname.write_text("\n".join(fm) + "\n\n" + body, encoding="utf-8")
        written += 1

    print(f"  ✓ Wrote {written:,} manifest docs to {out_dir}")
    print(f"  (skipped {skipped_no_text:,} with no description / no flavor text)")


if __name__ == "__main__":
    main()
