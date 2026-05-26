"""
darth-bot/kb/manifest.py
========================
Reads the Bungie Destiny manifest cache from the Destiny Voyager toolkit
(`manifest_cache/DestinyInventoryItemDefinition.json`) and exposes
a tiny lookup function for item / perk / exotic detail.

This is the fastest, most authoritative source for:
  - Exotic descriptions ("what does Celestial Nighthawk do?")
  - Perk descriptions ("what is Triple Tap?")
  - Shader / cosmetic lookups ("is there an all black shader?")
  - Stat values, slot info

If the manifest isn't cached locally, this module silently returns
empty results — the bot will fall through to live search instead.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

from config import DESTINY_VOYAGER_MANIFEST, SCRAPE_DIR


_TABLE = "DestinyInventoryItemDefinition"


@lru_cache(maxsize=1)
def _items() -> dict:
    """
    Returns the item dict keyed by hash. Two sources:
      1. If Destiny Voyager's manifest JSON cache is present, use it
         (richer data: tierTypeName, itemTypeDisplayName, stats, etc.)
      2. Fallback to the scraped manifest .md files in
         data/scrape/manifest/ (~15k items, name + tier + type only).
    """
    f = DESTINY_VOYAGER_MANIFEST / f"{_TABLE}.json"
    if f.exists():
        try:
            return json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            pass
    return _items_from_scrape()


def _items_from_scrape() -> dict:
    """Build a compact item dict from the scraped manifest .md files.
    Each file has YAML frontmatter with title/source/url/tier/type/class
    plus a body with a flavor text section."""
    scrape_dir = SCRAPE_DIR / "manifest"
    if not scrape_dir.exists():
        return {}
    out: dict = {}
    fm_re = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
    line_re = re.compile(r"^([a-z_]+):\s*\"?(.*?)\"?$", re.MULTILINE)
    url_hash_re = re.compile(r"bungie:item:(\d+)")
    for path in scrape_dir.glob("*.md"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")[:1500]
        except OSError:
            continue
        m = fm_re.search(text)
        if not m:
            continue
        fields = dict(line_re.findall(m.group(1)))
        name = fields.get("title", "").strip()
        if not name:
            continue
        url = fields.get("url", "")
        hash_m = url_hash_re.search(url)
        item_hash = hash_m.group(1) if hash_m else path.stem
        out[item_hash] = {
            "hash": item_hash,
            "displayProperties": {
                "name": name,
                "description": _extract_flavor(text),
            },
            "itemTypeDisplayName": fields.get("type", "").strip(),
            "inventory": {"tierTypeName": fields.get("tier", "").strip() or None},
            "itemType": None,
        }
    return out


def _extract_flavor(md_text: str) -> str:
    """Pull the flavor text or first body paragraph out of a scraped .md."""
    m = re.search(r"## Flavor\s*\n(.+?)(?:\n##|\n---|$)", md_text, re.DOTALL)
    if m:
        return m.group(1).strip()[:280]
    # Fallback — first non-frontmatter, non-heading line
    body = re.sub(r"^---.*?---", "", md_text, count=1, flags=re.DOTALL).strip()
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and not line.startswith("-"):
            return line[:280]
    return ""


def lookup_by_name(query: str, *, limit: int = 10) -> list[dict]:
    """
    Fuzzy substring search over item names. Returns top matches as compact dicts.
    """
    items = _items()
    if not items:
        return []
    q = query.lower().strip()
    matches = []
    for h, defn in items.items():
        dp = defn.get("displayProperties", {})
        name = dp.get("name") or ""
        if not name or "REDACTED" in name.upper():
            continue
        nl = name.lower()
        score = 0
        if nl == q:
            score = 100
        elif nl.startswith(q):
            score = 80
        elif q in nl:
            score = 50
        else:
            continue
        matches.append((score, _compact(defn)))
    matches.sort(key=lambda t: -t[0])
    return [m[1] for m in matches[:limit]]


def _compact(defn: dict) -> dict:
    dp = defn.get("displayProperties") or {}
    inv = defn.get("inventory") or {}
    return {
        "hash": defn.get("hash"),
        "name": dp.get("name"),
        "description": (dp.get("description") or "").strip(),
        "type": defn.get("itemTypeDisplayName"),
        "tier": inv.get("tierTypeName"),
        "item_type": defn.get("itemType"),
    }


def format_for_context(query: str, *, limit: int = 6) -> str:
    """One-shot helper — returns plaintext suitable for LLM context."""
    results = lookup_by_name(query, limit=limit)
    if not results:
        return ""
    lines = [f"Manifest matches for '{query}':"]
    for r in results:
        bits = [r["name"], f"[{r.get('tier','?')}]", f"({r.get('type','?')})"]
        lines.append("  " + " ".join(b for b in bits if b))
        if r.get("description"):
            lines.append(f"    {r['description'][:280]}")
    return "\n".join(lines)


def extract_named_items(text: str, *, min_len: int = 4, max_results: int = 6) -> list[dict]:
    """
    Find item names from the manifest that appear (case-insensitively) as
    substrings in `text`. Used by the router to ground the LLM and by the
    post-hoc check to flag invented item names.

    Returns most-specific (longest-name) matches first. Filters out
    very short or generic names that produce false positives.
    """
    items = _items()
    if not items:
        return []
    t = text.lower()

    # Pre-built name index, cached per process
    pairs = _name_index()
    found = {}
    for name_lower, hashes in pairs.items():
        if len(name_lower) < min_len:
            continue
        if name_lower in t:
            # Pick a canonical entry — first hash
            for h in hashes:
                defn = items.get(h)
                if defn:
                    found.setdefault(name_lower, _compact(defn))
                    break
    # Longest match first (more specific)
    results = sorted(found.values(), key=lambda d: -len(d["name"] or ""))
    return results[:max_results]


@lru_cache(maxsize=1)
def _name_index() -> dict:
    """Build name_lower → [hash, ...] map for quick scanning."""
    items = _items()
    idx: dict[str, list] = {}
    common_words = {
        "void", "arc", "solar", "stasis", "strand", "kinetic", "energy", "power",
        "the", "and", "or", "of", "by", "to", "is", "a", "an",
        "weapon", "armor", "exotic", "legendary",
    }
    for h, defn in items.items():
        name = (defn.get("displayProperties", {}).get("name") or "").strip()
        if not name or len(name) < 4:
            continue
        # Skip names that are common English words by themselves
        if name.lower() in common_words:
            continue
        idx.setdefault(name.lower(), []).append(h)
    return idx


# Curated allowlists for verify_names. The manifest only covers items
# (DestinyInventoryItemDefinition); activities, expansions, NPCs, and
# locations are not in there and would otherwise be flagged as
# "invented". Source of truth for the activity roster is
# `darth-bot/kb/scrape_raid_sources.py` (ACTIVITIES tuple).
KNOWN_ACTIVITIES: frozenset[str] = frozenset(n.lower() for n in [
    # Raids — 10 currently playable in D2 (May 2026)
    "Last Wish", "Garden of Salvation", "Deep Stone Crypt", "Vault of Glass",
    "Vow of the Disciple", "King's Fall", "Kings Fall", "Root of Nightmares",
    "Crota's End", "Crotas End", "Salvation's Edge", "Salvations Edge",
    "Desert Perpetual",
    # Dungeons — 10 currently playable
    "Sundered Doctrine", "Warlord's Ruin", "Warlords Ruin", "Ghosts of the Deep",
    "Spire of the Watcher", "Duality", "Grasp of Avarice", "Prophecy",
    "Pit of Heresy", "Shattered Throne", "Equilibrium",
    # Common shorthand
    "Salvations Edge", "Kings Fall",
])

KNOWN_PROPER_NOUNS: frozenset[str] = frozenset(n.lower() for n in [
    # Project / brand
    "Destiny Voyager", "Darth Bot", "Order 66", "Bungie API", "Bungie",
    "Destiny", "Destiny 2",
    # Expansions & big content drops (current + recent + key historical references)
    "Edge of Fate", "The Final Shape", "Final Shape", "Lightfall",
    "The Witch Queen", "Witch Queen", "Beyond Light", "Shadowkeep",
    "Forsaken", "Curse of Osiris", "Warmind", "Rise of Iron",
    "The Taken King", "Taken King", "The Dark Below", "Dark Below",
    "House of Wolves",
    # Seasons & episodes
    "Season of the Witch", "Season of Plunder", "Season of the Splicer",
    "Season of the Deep", "Season of the Wish", "Season of Defiance",
    "Season of the Lost", "Season of the Hunt", "Season of the Chosen",
    "Season of the Worthy", "Season of Arrivals", "Season of the Splicer",
    "Season of the Haunted", "Season of the Seraph",
    "Episode Echoes", "Episode Revenant", "Episode Heresy", "Episode Renegades",
    # PvP / ritual activities
    "Iron Banner", "Trials of Osiris", "Crucible", "Vanguard Ops",
    "Onslaught", "Solo Operation", "Solo Operations", "Crimson Days",
    # Locations
    "The Pale Heart", "Pale Heart", "Dreaming City", "Last City", "The Tower",
    "Tower", "Cosmodrome", "EDZ", "Nessus", "Tangled Shore",
    # Key NPCs / commanders / vendors
    "Lord Shaxx", "Lord Saladin", "Master Rahool", "The Speaker", "The Drifter",
    "Eris Morn", "Zavala", "Ikora Rey", "Cayde-6", "Cayde", "Saint-14",
    "The Crow", "Mara Sov", "Uldren Sov", "Banshee-44", "Banshee",
    "Ada-1", "Xur", "Petra Venj", "Amanda Holliday", "Tess Everis",
    "The Stranger", "Osiris",
    # Raid / dungeon bosses (often referenced in walkthroughs)
    "Atheon", "Atheon, Time's Conflux", "Kalli", "Kalli, the Corrupted",
    "Shuro Chi", "Shuro Chi, the Corrupted", "Morgeth",
    "Morgeth, the Spirekeeper", "Riven", "Riven of a Thousand Voices",
    "Crota", "Crota, Son of Oryx", "Ir Yut", "Ir Yut, the Deathsinger",
    "Oryx", "Oryx, the Taken King", "Golgoroth", "Warpriest", "Rhulk",
    "Rhulk, Disciple of the Witness", "Nezarec", "Taniks",
    "Taniks, the Abomination", "Atraks-1", "Atraks", "Sanctified Mind",
    "Consecrated Mind", "Undying Mind", "Templar", "The Witness",
    "Caretaker", "Calus", "Calus Mini-Tool", "Calus Mini",
    # Boss titles / sub-names (the regex extracts these as standalone
    # title-case phrases even when the full "Boss, Title" is allowlisted)
    "Son of Oryx", "Disciple of the Witness", "the Deathsinger",
    "the Corrupted", "the Spirekeeper", "the Taken King",
    "the Abomination", "the Witness", "Time's Conflux",
    "of a Thousand Voices", "Daughters of Oryx", "Fallen Exo",
    # Factions / species (often capitalized)
    "Iron Lord", "Iron Lords", "Hive", "Vex", "Fallen", "Eliksni",
    "Cabal", "Taken", "Scorn", "Dread", "Shadow Legion",
    # Raid mechanic terms / buffs / debuffs that show up across the KB
    # and should not be flagged as "invented" by verify_names.
    "Chalice of Light", "Chalice", "Engulfed in Light", "Enlightened",
    "Build the Bridge", "Dunking the Chalice", "Sword Logic",
    "Oversoul", "Oversoul Throne", "Sword of Crota", "Cleaver", "Cleavers",
    "Presence of Crota", "Liturgy of Ruin", "Dark Procession",
    "Annihilator Totem", "Annihilator Totems", "Brand Claimer",
    "Touch of Malice", "Sync Plate", "Sync Plates", "Wipe Timer",
    "Unstoppable Ogre", "Unstoppable Ogres", "Revenant Knight",
    "Revenant Knights", "Gatekeeper", "Gatekeepers", "Swordbearer",
    "Swordbearers", "Hellmouth", "Tractor Cannon", "Divinity",
    "Cenotaph Mask", "Aeon Gauntlets", "Aeon Swift",
    # Crota's End — Ir Yût encounter
    "Shield Singer", "Shield Singer Wizard", "Shield Singer Wizards",
    "Shrieker", "Shriekers", "Hive Barrier", "Hive Barriers",
    "Dark Procession", "Dark Precession",
    # King's Fall encounter mechanics + named adds
    "Annihilator Totem", "Annihilator Totems", "Brand of the Weaver",
    "Brand of the Unraveler", "Brand of the Initiate", "Brand Claimer",
    "Deathsinger's Power", "Hallowed Knight", "Hallowed Knights",
    "Pool of Reclaimed Light", "Reclaimed Light", "Captures Gaze",
    "Pool of Light", "Unstable Light", "Torn Between Dimensions",
    "Aura of Immortality", "Corrupted Light", "Light-Eater",
    "Light-Eater Ogre", "Light-Eater Ogres", "Light-Eater Knight",
    "Light-Eater Knights", "Vessel of Oryx", "Blightguard",
    "Blightguard Knight", "Twin Wizard", "Ir Anûk", "Ir Halak",
    "Daughters of Oryx", "Golgoroth's Cellar",
])


def verify_names(text: str) -> dict:
    """
    Scan `text` for proper-noun-looking phrases that DON'T match any
    manifest item — these are likely hallucinated names. Returns
    {verified: [str], unverified_candidates: [str]}.

    Conservative: only flags Title Case phrases of 2+ words. Real
    activity / expansion / NPC names live in curated allowlists above
    (the manifest itself only covers items).
    """
    import re as _re
    # Greedy title-case phrase: starts with a title-case word; can chain
    # title-case words and lowercase connectors (of/the/and/…); then
    # post-process to (a) trim trailing connectors and (b) require ≥2
    # actual title-case words. This avoids false positives like
    # "Season of" (no closing title) or "Check the".
    _CONNECTORS = {"of", "the", "and", "in", "on", "to", "a", "an", "for"}
    phrases = _re.findall(
        r"\b[A-Z][a-zA-Z'’]+(?:\s+(?:of|the|and|in|on|to|a|an|for|[A-Z][a-zA-Z'’]+))+\b",
        text,
    )
    idx = _name_index()
    verified = []
    unverified = []
    seen = set()
    for raw in phrases:
        words = raw.split()
        while words and words[-1].lower() in _CONNECTORS:
            words.pop()
        title_word_count = sum(1 for w in words if w and w[0].isupper())
        if title_word_count < 2:
            continue
        p = " ".join(words)
        if p in seen:
            continue
        seen.add(p)
        # Normalize curly/typographic apostrophes so allowlist entries
        # written with straight ' still match phrases the model emits
        # with ’ (LLMs often render curly).
        pl = p.lower().replace("’", "'").replace("‘", "'")
        if pl in idx or pl in KNOWN_ACTIVITIES or pl in KNOWN_PROPER_NOUNS:
            verified.append(p)
        else:
            unverified.append(p)
    return {"verified": verified, "unverified_candidates": unverified}


if __name__ == "__main__":
    import sys
    q = " ".join(sys.argv[1:]) or "Crimson"
    print(format_for_context(q))
    print()
    extracted = extract_named_items(q)
    if extracted:
        print(f"Extracted named items ({len(extracted)}):")
        for it in extracted:
            print(f"  {it['name']}  [{it.get('tier')}, {it.get('type')}]")
