#!/usr/bin/env python3
"""Duality: add the 2 missing traversal sections (opening descent, vault->Caiatl)
and renumber so the combat encounters keep correct positions."""
import os, yaml, json

HERE = os.path.dirname(os.path.abspath(__file__))
DUA = os.path.join(HERE, "content", "dungeons", "duality")
HDR = "# raid_context/content/dungeons/duality/{fn} — schema v3.\n\n"
act = yaml.safe_load(open(os.path.join(DUA, "1-gahlran.yaml")))["activity"]


def dump(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(HDR.format(fn=os.path.basename(path)))
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)


def traversal(order, slug, name, abstract, setup, steps):
    return {"activity": act, "encounter": {
        "order": order, "slug": slug, "name": name, "kind": "traversal",
        "difficulty": "easy", "estimated_time": "3-6 min",
        "abstract": abstract, "setup": setup, "plain_language_steps": steps,
        "sources": [{"tier": 1, "name": "In-repo authored guide: encounter audit (2026-06-07)",
                     "note": "Traversal section that was missing from the encounter division.",
                     "date_checked": "2026-06-07"}]}}

# ---- renumber existing combat/puzzle encounters (+1, then Caiatl +2) ----
renames = [("1-gahlran", "gahlran", 2, None),
           ("2-statue-puzzle", "statue-puzzle", 3, "jumping-puzzle"),
           ("3-unlock-the-vault", "unlock-the-vault", 4, None),
           ("4-caiatl", "caiatl", 6, None)]
for area in (DUA, os.path.join(DUA, "solo"), os.path.join(DUA, "challenges")):
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

# ---- new traversals ----
dump(os.path.join(DUA, "1-opening-descent.yaml"), traversal(
    1, "opening-descent", "Opening Descent (to Gahlran)",
    "Fall through the statue into the Cabal mausoleum and traverse the halls to the Gahlran arena, "
    "swapping between the Waking and Nightmare realms by shooting bells.",
    "WHAT YOU SEE:\n- A long series of hallways, platforms and ledges after the opening drop.\n"
    "- Bells: shooting a bell flips you between the Waking world and the Nightmare realm.\n\n"
    "TRAVERSAL MECHANICS:\n- Some gaps/paths only exist in ONE realm — ring a bell to swap and cross.\n"
    "- A short timer returns you to the Waking world; ring again as needed. No combat checkpoint here.\n",
    ["1. After you drop through the statue, follow the hallways forward.",
     "2. When a path is blocked, shoot a bell to swap between the Waking world and the Nightmare realm — the missing platforms appear in the other realm.",
     "3. Keep swapping realms to cross the gaps until you reach the Gahlran arena (first encounter)."]))

dump(os.path.join(DUA, "5-vault-descent.yaml"), traversal(
    5, "vault-descent", "Vault Descent (to Caiatl)",
    "After unlocking the Vault, drop down into the long room with the shrouded central cube to reach "
    "the Caiatl arena. Hidden Chest 2 sits in the cramped passage below the cube.",
    "WHAT YOU SEE:\n- A long descent room dominated by a large shrouded central object (the cube).\n"
    "- A cramped passage below the cube holding Hidden Chest 2.\n\n"
    "TRAVERSAL MECHANICS:\n- Simple drop-down/navigation; no combat. Grab the hidden chest on the way if wanted.\n",
    ["1. Once the Vault is unlocked, drop into the long room with the big shrouded cube in the middle.",
     "2. (Optional) Duck into the cramped passage below the cube for Hidden Chest 2.",
     "3. Continue down into the Caiatl arena (final boss)."]))

# ---- registry ----
REG = json.load(open(os.path.join(HERE, "encounter_registry.json")))
REG["duality"]["encounters"] = [
    {"order": 1, "slug": "opening-descent", "name": "Opening Descent (to Gahlran)", "ingame_name": ""},
    {"order": 2, "slug": "gahlran", "name": "Nightmare of Gahlran, Sorrow Bearer", "ingame_name": ""},
    {"order": 3, "slug": "statue-puzzle", "name": "Four Gladiator Statue Puzzle", "ingame_name": ""},
    {"order": 4, "slug": "unlock-the-vault", "name": "Unlock the Vault (3 Nightmares)", "ingame_name": ""},
    {"order": 5, "slug": "vault-descent", "name": "Vault Descent (to Caiatl)", "ingame_name": ""},
    {"order": 6, "slug": "caiatl", "name": "Nightmare of Caiatl (final boss)", "ingame_name": ""},
]
REG["duality"]["encounter_count"] = 6
json.dump(REG, open(os.path.join(HERE, "encounter_registry.json"), "w"), indent=2)
print("Duality: added opening-descent + vault-descent traversals; 6 entries; renumbered.")
