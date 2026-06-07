#!/usr/bin/env python3
"""Grasp of Avarice: split the merged 'Rusted Gangplank + Sparrow Mines' file into
two traversal sections, renumber Shield Shutdown->5 / Avarokk->6. Plus retype two
mistyped traversal sections (Vespers Infiltration, Warlords imprisoned-and-climb)."""
import os, yaml, json, copy

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.join(HERE, "content", "dungeons", "grasp-of-avarice")


def dump(path, doc, fn=None):
    with open(path, "w") as f:
        f.write(f"# {os.path.relpath(path, HERE)} — schema v3.\n\n")
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)


m = yaml.safe_load(open(os.path.join(G, "3-rusted-gangplank.yaml")))
act, e = m["activity"], m["encounter"]
S = e["setup"]
jp_setup = S.split("SPARROW SECTION:")[0].strip() + "\n"
sp_setup = "SPARROW SECTION:\n" + S.split("SPARROW SECTION:")[1].strip() + "\n"

# ---- (a) Rusted Gangplank jumping puzzle (order 3) ----
jp = {
    "order": 3, "slug": "rusted-gangplank", "name": "Rusted Gangplank (spike-trap jumping puzzle)",
    "kind": "jumping-puzzle", "difficulty": "medium", "estimated_time": "6-12 min",
    "abstract": ("Spike-trap jumping puzzle through Wilhelm-7's booby-trapped facility: pressure-plate traps, "
                 "falling panels, a 4-door lever room, and a rolling-barrel staircase."),
    "setup": jp_setup,
    "callouts": [c for c in e["callouts"] if "Sparrow" not in str(c.get("when", "")) and "mine" not in str(c.get("when", "")).lower()],
    "wipe_triggers": ["Stepping on a pressure plate = instant death.",
                      "Falling off the platform climb = long respawn (no mid-section checkpoint)."],
    "permutations": e["permutations"], "cheese": e["cheese"],
    "common_mistakes": ["Sprinting the jumping puzzle — every section punishes haste."],
    "rewards": e["rewards"], "images": e.get("images", {}), "learner_path": e["learner_path"],
    "plain_language_steps": [
        "1. A spike-trap jumping puzzle through Wilhelm-7's booby-trapped facility. Go slow — every section punishes haste.",
        "2. Watch for pressure plates that trigger spike traps. Jump OVER them, never step on them (the cue is dust + a wall mechanism). Stepping on one is an instant kill.",
        "3. The lead player calls out each trap so distracted teammates don't wipe.",
        "4. On falling-panel platforms, land on the LEFT panel; the right one blocks the console once it falls.",
        "5. In the multi-door lever room, open the doors in sequence with a Scorch Cannon and call each door as you trigger it.",
        "6. On the rolling-barrel staircase, hide in the side alcoves as the barrel rolls past.",
        "7. Optional (Gjallarhorn Catalyst): in the 4-door lever room, look up at a vertical metal strut for a small chest platform reachable by a jump from a high beam (Catalyst fragment 2 of 3, no-checkpoint run).",
    ],
    "defense": {"incoming_damage": {"adds": [], "boss": []}, "champions": [],
                "recommended_defensive_mods": {"elemental": [], "concussive": []}},
    "damage": {"surges": ["No DPS phase — pure jumping puzzle."],
               "burst_windows": "No damage window; gated by completing the platforming.",
               "recommended_dps": ["No DPS weapon needed; movement-friendly mods."]},
    "sources": e["sources"],
}
dump(os.path.join(G, "3-rusted-gangplank.yaml"), {"activity": act, "encounter": jp})

# ---- (b) Shroud Sparrow Mine Race (order 4, traversal) ----
sp = {
    "order": 4, "slug": "sparrow-mine-race", "name": "Shroud Sparrow Mine Race",
    "kind": "traversal", "difficulty": "medium", "estimated_time": "4-8 min",
    "abstract": ("Sparrow race to disarm 4 splinter mines before they detonate. Boost pads extend the timer; "
                 "Fallen gunfire and Web mines harass — race, don't fight."),
    "setup": sp_setup,
    "callouts": [c for c in e["callouts"] if "Sparrow" in str(c.get("when", "")) or "mine" in str(c.get("when", "")).lower()],
    "wipe_triggers": ["A splinter mine detonates = full section reset."],
    "permutations": [], "cheese": [],
    "common_mistakes": ["Trying to fight the Fallen instead of racing — they respawn, the mines don't wait."],
    "rewards": {"guaranteed": [], "hidden_chest": None, "potential_drops": []},
    "images": {"overview": "", "setup": ""}, "learner_path": ["1st: follow the front-runner's called route."],
    "plain_language_steps": [
        "1. There are 4 splinter mines on a sparrow track, each with a despawn timer.",
        "2. Race to each mine and disarm it before it detonates; ride boost pads to extend your time.",
        "3. Ignore the Web mines and Fallen gunfire — don't stop to fight.",
        "4. The front-runner calls the mine count and path (e.g. 'left fork'); if any mine detonates the section resets, so prioritize speed.",
    ],
    "defense": {"incoming_damage": {"adds": ["Arc (Fallen gunfire)", "Web mines (movement-slow hazard)"], "boss": []},
                "champions": [], "recommended_defensive_mods": {"elemental": [], "concussive": []}},
    "damage": {"surges": ["No DPS phase — sparrow disarm race."],
               "burst_windows": "No damage window; gated by disarming all 4 mines in time.",
               "recommended_dps": ["No DPS weapon needed; bring a sparrow + movement mods."]},
    "sources": e["sources"],
    "meta_loadout": [x for x in (e.get("meta_loadout") or []) if "parrow" in str(x) or "mine" in str(x).lower()],
}
dump(os.path.join(G, "4-sparrow-mine-race.yaml"), {"activity": act, "encounter": sp})

# ---- renumber Shield Shutdown 4->5, Avarokk 5->6 (base + solo) ----
for area in (G, os.path.join(G, "solo"), os.path.join(G, "challenges")):
    for old, slug, new in [("4-shield-shutdown", "shield-shutdown", 5), ("5-avarokk", "avarokk", 6)]:
        op = os.path.join(area, f"{old}.yaml")
        if not os.path.exists(op):
            continue
        d = yaml.safe_load(open(op)); d["encounter"]["order"] = new
        dump(os.path.join(area, f"{new}-{slug}.yaml"), d)
        os.remove(op)

# ---- retype 2 mistyped traversals (no renumber) ----
for f, kind in [(os.path.join(HERE, "content/dungeons/vespers-host/2-infiltration.yaml"), "traversal"),
                (os.path.join(HERE, "content/dungeons/warlords-ruin/2-imprisoned-and-climb.yaml"), "jumping-puzzle")]:
    d = yaml.safe_load(open(f)); d["encounter"]["kind"] = kind
    hdr = "".join(l for l in open(f) if l.startswith("#"))
    with open(f, "w") as fh:
        fh.write(hdr); yaml.safe_dump(d, fh, sort_keys=False, allow_unicode=True, width=100)

# ---- registry ----
REG = json.load(open(os.path.join(HERE, "encounter_registry.json")))
REG["grasp-of-avarice"]["encounters"] = [
    {"order": 1, "slug": "skywatch", "name": "Skywatch (Loot Cave intro)", "ingame_name": ""},
    {"order": 2, "slug": "phryzhia", "name": "Phry'zhia, the Insatiable", "ingame_name": ""},
    {"order": 3, "slug": "rusted-gangplank", "name": "Rusted Gangplank (spike-trap jumping puzzle)", "ingame_name": ""},
    {"order": 4, "slug": "sparrow-mine-race", "name": "Shroud Sparrow Mine Race", "ingame_name": ""},
    {"order": 5, "slug": "shield-shutdown", "name": "Shield Shutdown (Fallen Shield / Servitor cannon)", "ingame_name": ""},
    {"order": 6, "slug": "avarokk", "name": "Captain Avarokk, the Covetous", "ingame_name": ""},
]
REG["grasp-of-avarice"]["encounter_count"] = 6
json.dump(REG, open(os.path.join(HERE, "encounter_registry.json"), "w"), indent=2)
print("Grasp split (rusted-gangplank + sparrow-mine-race), renumbered to 6; Vespers/Warlords retyped.")
