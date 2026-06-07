#!/usr/bin/env python3
"""Vault of Glass: split the merged Confluxes+Oracles file into two encounters,
renumber the rest +1, retype Gorgon as traversal, update registry + subfolders."""
import os, yaml, json, copy

HERE = os.path.dirname(os.path.abspath(__file__))
VOG = os.path.join(HERE, "content", "raids", "vault-of-glass")
HDR = ("# raid_context/content/raids/vault-of-glass/{fn} — schema v3.\n"
       "# Vault of Glass: Confluxes and Oracles are SEPARATE encounters (split 2026-06-07).\n\n")


def dump(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(HDR.format(fn=os.path.basename(path)))
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)


merged = yaml.safe_load(open(os.path.join(VOG, "2-confluxes.yaml")))
act = merged["activity"]
m = merged["encounter"]

# ---------------------------------------------------------------- CONFLUXES (2)
conf = copy.deepcopy(m)
conf["order"] = 2
conf["slug"] = "confluxes"
conf["name"] = "Templar's Well — Confluxes (1st loot)"
conf["estimated_time"] = "8-12 min"
conf["abstract"] = ("Defend 3 Confluxes from Vex sacrifices. 4 sacrifices to a single Conflux = wipe. "
                    "Phase 1 = center Conflux only. Phase 2 = +left + right. Hold all three to complete — "
                    "the Oracles encounter follows immediately.")
conf["setup"] = (
    "WHAT YOU SEE:\n"
    "- Templar's Well arena — wide, with a center pool of light (cleanse pool).\n"
    "- 3 Conflux spawn points: center-front, far-left, far-right.\n"
    "- Cave areas near L+R Confluxes for Vex add-spawns.\n"
    "- Hobgoblins on distant platforms (sniper threat).\n\n"
    "PLATFORM MECHANICS:\n"
    "- Conflux defense: Vex (Wyvern / Overload Minotaur) try to walk INTO a Conflux. Each successful\n"
    "  sacrifice = 1/4 of that Conflux's tribute. 4 = wipe.\n"
    "- Cleanse pool: removes Marked for Negation. Despawns after several uses.\n"
    "- Fanatics (headless glowing Goblins) leave NEGATION POOLS — don't step in, don't melee them.\n\n"
    "START STATE: enter arena = encounter starts. Center Conflux spawns first.\n")
conf["callouts"] = [c for c in m["callouts"] if "Oracle" not in str(c.get("when", ""))]
conf["wipe_triggers"] = ["4 sacrifices to ANY Conflux.",
                         "All cleanse-pool charges exhausted with Marks active."]
conf["damage_phase_triggers"] = ["All 3 Confluxes defended → the Oracles encounter begins."]
conf["parallel_timeline"] = [p for p in m["parallel_timeline"] if "Oracle" not in str(p.get("phase", ""))]
conf["common_mistakes"] = ["Killing Fanatics mid-arena — pools cluster, can't navigate to the cleanse pool."]
conf["rewards"] = {"guaranteed": ["1× raid weapon or armor"], "hidden_chest": None,
                   "potential_drops": ["Vision of Confluence (scout rifle, Solar)",
                                       "Found Verdict (shotgun, Arc)",
                                       "Praedyth's Revenge (sniper rifle, Kinetic)",
                                       "Corrective Measure (machine gun, Void)",
                                       "Vault of Glass armor (random slot)"]}
conf["plain_language_steps"] = [
    "1. Enter Templar's Well — a wide arena with a center pool of light (the cleanse pool) and three Conflux spawn points: center-front, far-left, far-right.",
    "2. The encounter starts on entry. The center Conflux spawns first; defend it. Vex (Wyverns and Overload-style Minotaurs) walk toward the Conflux to sacrifice themselves.",
    "3. Stop every Vex before it reaches the Conflux. Four sacrifices to a single Conflux wipes the team, so call the tribute count out loud (e.g. 'Center 2 of 4').",
    "4. After the center phase, two more Confluxes activate left and right. Split into pairs — two players per Conflux — and defend all three at once.",
    "5. Avoid the Fanatics (headless glowing Goblins): don't melee them; killed, they leave a green negation pool. Kill them at range, away from where you walk.",
    "6. If you get Marked for Negation, step into the center cleanse pool to remove it, and call it out so the team doesn't exhaust the pool's limited charges.",
    "7. Once all three Confluxes are held, the Oracles encounter begins (next encounter).",
]
conf["meta_loadout"] = [x for x in (m.get("meta_loadout") or []) if not str(x).startswith("'Oracles")
                        and not str(x).startswith("Oracles")]
conf["role_loadouts"] = [r for r in (m.get("role_loadouts") or []) if r.get("role_id") == "conflux_defender"]
dump(os.path.join(VOG, "2-confluxes.yaml"), {"activity": act, "encounter": conf})

# ---------------------------------------------------------------- ORACLES (3)
ora = {
    "order": 3, "slug": "oracles", "name": "Templar's Well — Oracles (kill in order)",
    "difficulty": "medium", "estimated_time": "5-8 min",
    "abstract": ("Five waves of Vex Oracles. Kill them strictly in spawn order — wrong order Marks the "
                 "whole team for Negation. Cleanse Marks at the center pool. Clear all five waves for loot."),
    "setup": (
        "WHAT YOU SEE:\n"
        "- The same Templar's Well arena, center cleanse pool still active.\n"
        "- 7 Oracle spawn positions (map markers): mid, L1, R1, L2, R2, L3, R3.\n\n"
        "ORACLE MECHANICS:\n"
        "- 5 waves. Each Oracle spawn signals with a musical chime and a glowing Vex projection.\n"
        "- Kill in SPAWN ORDER (Destiny 2 rule). Wrong order = team-wide Marked for Negation.\n"
        "- Cleanse Marks in the center pool. Fanatics still leave negation pools — kill at range.\n"),
    "callouts": [c for c in m["callouts"] if str(c.get("when", "")) in ("Oracle spawned", "Marked for Negation")],
    "wipe_triggers": ["Wrong-order Oracle kills = team-wide Mark + death.",
                      "All cleanse-pool charges exhausted with Marks active."],
    "damage_phase_triggers": ["All 5 Oracle waves cleared → the Templar's Well section completes."],
    "parallel_timeline": [{"phase": "Oracle Phase (5 waves)",
                           "spotters": "Call spawn order each wave.",
                           "killers": "Kill strictly in order; an Aegis relic-carry (if held) can one-shot Oracles."}],
    "permutations": [{"name": "Standard caller + killers", "learner_friendly": True,
                      "summary": "One caller names the spawn order; the rest kill in that order.",
                      "roles": [{"id": "oracle_caller", "count": 1, "does": "Track and call the spawn order out loud."},
                                {"id": "oracle_killer", "count": 5, "does": "Destroy Oracles in the called order; cleanse Marks at the pool."}]}],
    "cheese": [],
    "common_mistakes": ["Forgetting the spawn order — call positions LOUDLY before shooting.",
                        "Killing Fanatics where you need to stand to cleanse."],
    "rewards": {"guaranteed": ["1× raid weapon or armor"], "hidden_chest": None,
                "potential_drops": ["Vision of Confluence (scout rifle, Solar)",
                                    "Found Verdict (shotgun, Arc)",
                                    "Praedyth's Revenge (sniper rifle, Kinetic)",
                                    "Corrective Measure (machine gun, Void)",
                                    "Vault of Glass armor (random slot)"]},
    "images": {"overview": "", "setup": "", "callouts": ""},
    "learner_path": ["1st: oracle_killer.", "2nd: oracle_caller."],
    "plain_language_steps": [
        "1. After the Confluxes are held, five waves of glowing Vex Oracles spawn, each signaled by a musical chime.",
        "2. Kill the Oracles strictly in the order they spawned. Out of order Marks the whole team for Negation. Assign one caller to name positions (mid, L1, R1, L2, R2, L3, R3).",
        "3. Anyone Marked steps into the center cleanse pool. Clear all five waves to finish Templar's Well and earn the loot drop.",
    ],
    "defense": m.get("defense"),
    "damage": {
        "surges": ["No surge — Oracles are destroyed by precision/heavy, not a boss DPS phase."],
        "burst_windows": "No boss window; the demand is fast, in-order Oracle destruction each wave.",
        "recommended_dps": ["Xenophage (one-shots Oracles)", "Precision scout/pulse for ranged Oracles + Hobgoblins",
                            "Anti-Barrier scout on Master to shoot Hobgoblins through immunity"],
    },
    "role_loadouts": [
        {"role_id": "oracle_killer", "subclass": "Any; precision-weapon focused",
         "weapons": "Xenophage or a heavy that one-shots Oracles + a precision primary (Hung Jury scout) for ranged Oracles/Hobgoblins",
         "exotic_armor": "", "armor_stats": ["Health", "Class"],
         "surges_mods": "Anti-Barrier Scout on Master; Machine Gun reserves/finder when running Xenophage"},
    ],
    "sources": m.get("sources"),
    "meta_loadout": [
        "Oracles (this encounter): swap to Xenophage (one-shots Oracles) as heavy, keep an Ikelos SMG, and "
        "add a scout rifle (Hung Jury) for the Hobgoblins. Mod changes: Anti-Barrier Scout Rifle on arms (to "
        "shoot Hobgoblins through immunity), Machine Gun Ammo Finder, and a Machine Gun Reserves chest.",
    ],
}
dump(os.path.join(VOG, "3-oracles.yaml"), {"activity": act, "encounter": ora})

# ---------------------------------------------------------------- renumber 3..7 -> 4..8
renames = [("3-templar", "templar", 4, None),
           ("4-gorgon-labyrinth", "gorgon-labyrinth", 5, "traversal"),
           ("5-jumping-puzzle", "jumping-puzzle", 6, "jumping-puzzle"),
           ("6-gatekeeper", "gatekeeper", 7, None),
           ("7-atheon", "atheon", 8, None)]
for area in (VOG, os.path.join(VOG, "challenges"), os.path.join(VOG, "solo")):
    for oldp, slug, neworder, kind in renames:
        old = os.path.join(area, f"{oldp}.yaml")
        if not os.path.exists(old):
            continue
        d = yaml.safe_load(open(old))
        d["encounter"]["order"] = neworder
        if kind:
            d["encounter"]["kind"] = kind
        new = os.path.join(area, f"{neworder}-{slug}.yaml")
        with open(new, "w") as f:
            f.write(HDR.format(fn=os.path.basename(new)))
            yaml.safe_dump(d, f, sort_keys=False, allow_unicode=True, width=100)
        os.remove(old)

# ---------------------------------------------------------------- split challenge file
chal = yaml.safe_load(open(os.path.join(VOG, "challenges", "2-confluxes.yaml")))
ce = chal["encounter"]
# keep confluxes challenge ("Wait for It…"); build oracles challenge from the known one
oracle_chal = {
    "activity": {**act, "category": "challenge"},
    "encounter": {"order": 3, "slug": "oracles", "name": "Templar's Well — Oracles (kill in order)",
                  "abstract": ora["abstract"],
                  "master_challenge": {"name": "The Only Oracle for You",
                                       "requirement": "Each Oracle may only be destroyed ONCE across the encounter — "
                                                      "no player may shoot a repeated Oracle position, so kills must be "
                                                      "distributed across the fireteam.",
                                       "enforced_on": "Master (always) / weekly rotator"}},
    "differs_from_base": ("Adds the 'The Only Oracle for You' constraint: each Oracle may only be destroyed once, "
                          "forcing the team to spread Oracle kills. On Master every challenge is active plus Champions "
                          "(Barrier Hydra / Overload Minotaur) and Adept loot."),
}
with open(os.path.join(VOG, "challenges", "3-oracles.yaml"), "w") as f:
    f.write(HDR.format(fn="3-oracles.yaml"))
    yaml.safe_dump(oracle_chal, f, sort_keys=False, allow_unicode=True, width=100)

# ---------------------------------------------------------------- registry
REG = json.load(open(os.path.join(HERE, "encounter_registry.json")))
REG["vault-of-glass"]["encounters"] = [
    {"order": 1, "slug": "opening-spire", "name": "Opening — Waking Ruins (Spire)", "ingame_name": ""},
    {"order": 2, "slug": "confluxes", "name": "Templar's Well — Confluxes (1st loot)", "ingame_name": ""},
    {"order": 3, "slug": "oracles", "name": "Templar's Well — Oracles (kill in order)", "ingame_name": ""},
    {"order": 4, "slug": "templar", "name": "The Templar", "ingame_name": ""},
    {"order": 5, "slug": "gorgon-labyrinth", "name": "Gorgon Labyrinth (stealth traversal)", "ingame_name": ""},
    {"order": 6, "slug": "jumping-puzzle", "name": "Jumping Puzzle", "ingame_name": ""},
    {"order": 7, "slug": "gatekeeper", "name": "Gatekeeper (Venus + Mars portals)", "ingame_name": ""},
    {"order": 8, "slug": "atheon", "name": "Atheon, Time's Conflux (final boss)", "ingame_name": ""},
]
REG["vault-of-glass"]["encounter_count"] = 8
json.dump(REG, open(os.path.join(HERE, "encounter_registry.json"), "w"), indent=2)

print("VoG split complete: 8 encounters (Confluxes + Oracles separated), Gorgon retyped traversal.")
