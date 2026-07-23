#!/usr/bin/env python3
"""
audit-builds.py — structural/factual audit of web/public/builds.json
against the freshly-baked manifest. Run any time; zero judgment calls —
synergy/mechanics stay the curator's domain. Exit 1 if any ERRORs.

  python3 web/scripts/audit-builds.py [--json]

Checks
  E1  exotic_armor option doesn't resolve to an Exotic armor piece
  E2  exotic_armor slot mismatch (manifest says different slot)
  E3  weapon name doesn't resolve to a weapon
  E4  weapon listed in the wrong slot bucket (kinetic/energy/heavy)
  E5  aspect/fragment name doesn't resolve in manifest
  E6  armor_set / theme_locks set name not in armor_sets.json
  E7  invalid target_stats key or value out of 1..200 (EoF caps at 200)
  E8  duplicate build id / missing required field
  W1  two or more weapon slots offer ONLY exotic options (fitter conflict risk)
  W2  playstyle/perk text uses pre-EoF stat names (Mobility/Resilience/...)
  W3  fragment family doesn't match the build's subclass element
  W4  no source cited / _confidence missing
  W5  theme_locks total > 5
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

PUB = Path(__file__).resolve().parent.parent / "public"
STAT_KEYS = {"weapons", "health", "class", "grenade", "super", "melee"}
OLD_STATS = re.compile(r"\b(Mobility|Resilience|Recovery|Discipline|Intellect)\b")
# "Strength" appears in normal prose too often — only flag "Strength stat".
OLD_STRENGTH = re.compile(r"\bStrength\s+stat\b", re.I)
FRAG_FAMILY = {"Arc": "Spark", "Solar": "Ember", "Void": "Echo", "Stasis": "Whisper",
               "Strand": "Thread", "Stormcaller": "Spark", "Dawnblade": "Ember",
               "Voidwalker": "Echo", "Shadebinder": "Whisper", "Broodweaver": "Thread",
               "Prismatic": "Facet"}
WEAPON_SLOT_KEY = {"kinetic": "Kinetic", "energy": "Energy", "heavy": "Power"}

manifest = json.load(open(PUB / "manifest.json"))
sets_ok = {s["n"] for s in json.load(open(PUB / "armor_sets.json"))}
weapons_raw = json.load(open(PUB / "weapons.json"))
weapons_list = weapons_raw if isinstance(weapons_raw, list) else (
    weapons_raw.get("weapons") or list(weapons_raw.values()))

by_name = {}          # name -> list of manifest entries
for e in manifest.values():
    n = e.get("n")
    if n:
        by_name.setdefault(n.lower(), []).append(e)

wpn_by_name = {}
for w in weapons_list:
    if isinstance(w, dict):
        n = (w.get("name") or w.get("n") or "").lower()
        if n:
            wpn_by_name.setdefault(n, []).append(w)

def is_exotic_armor(name, slot=None):
    for e in by_name.get(name.lower(), []):
        if e.get("r") == "Exotic" and e.get("s") in ("Helmet", "Gauntlets", "Chest", "Legs", "Class"):
            return e if (slot is None or e.get("s") == slot) else e
    return None

def weapon_slot(name):
    """Best-known slot bucket for a weapon name ('Kinetic'/'Energy'/'Power'), or None."""
    slots = {w.get("slot") for w in wpn_by_name.get(name.lower(), []) if w.get("slot")}
    slots.discard("")
    if slots:
        return slots
    # fall back to manifest
    s = {e.get("s") for e in by_name.get(name.lower(), []) if e.get("s") in ("Kinetic", "Energy", "Power", "Heavy")}
    return {("Power" if x == "Heavy" else x) for x in s} or None

data = json.load(open(PUB / "builds.json"))
findings = []           # (severity, build_id, code, message)
ids = Counter(b.get("id", "?") for b in data["builds"])

for b in data["builds"]:
    bid = b.get("id", "?")
    def add(sev, code, msg):
        findings.append((sev, bid, code, msg))

    for req in ("id", "name", "class", "subclass", "exotic_armor", "weapons"):
        if req not in b:
            add("ERROR", "E8", f"missing required field '{req}'")
    if ids[bid] > 1:
        add("ERROR", "E8", "duplicate build id")

    ex = b.get("exotic_armor") or {}
    for opt in ex.get("options", []):
        base = opt.split("(")[0].strip()   # allow "Name (note)" style
        hit = is_exotic_armor(base)
        if not hit:
            add("ERROR", "E1", f"exotic_armor option '{opt}' doesn't resolve to an Exotic armor piece")
        elif ex.get("slot") and hit.get("s") != ex["slot"]:
            add("ERROR", "E2", f"'{base}' is a {hit.get('s')} exotic but build says slot {ex['slot']}")

    exotic_only_slots = 0
    for key, want in WEAPON_SLOT_KEY.items():
        opts = (b.get("weapons") or {}).get(key, []) or []
        tiers = []
        for wname in opts:
            slots = weapon_slot(wname)
            if slots is None:
                add("ERROR", "E3", f"weapon '{wname}' not found in weapons/manifest data")
                continue
            if want not in slots:
                add("ERROR", "E4", f"'{wname}' is a {'/'.join(sorted(slots))} weapon but listed under '{key}'")
            tiers += [e.get("r") for e in by_name.get(wname.lower(), [])]
        if opts and tiers and all(t == "Exotic" for t in tiers if t):
            exotic_only_slots += 1
    if exotic_only_slots >= 2:
        add("WARN", "W1", f"{exotic_only_slots} weapon slots offer only Exotic options — fitter may equip 2 exotics")

    fam = FRAG_FAMILY.get(b.get("subclass", ""), None)
    for kind in ("aspects", "fragments"):
        for raw in b.get(kind, []) or []:
            name = raw.split("—")[0].split(" - ")[0].strip()
            if name.lower() not in by_name:
                add("ERROR", "E5", f"{kind[:-1]} '{name}' not found in manifest")
            elif kind == "fragments" and fam and not name.startswith(fam):
                add("WARN", "W3", f"fragment '{name}' doesn't match subclass family '{fam} of…'")

    for src in ([b.get("armor_set", {}).get("name")] if b.get("armor_set") else []) + \
               [t.get("set") for t in b.get("theme_locks", []) or []]:
        if src and src not in sets_ok:
            add("ERROR", "E6", f"armor set '{src}' not in armor_sets.json catalog")
    total_lock = sum(t.get("count", 0) for t in b.get("theme_locks", []) or [])
    if total_lock > 5:
        add("WARN", "W5", f"theme_locks total {total_lock} > 5")

    for k, v in (b.get("target_stats") or {}).items():
        if k not in STAT_KEYS:
            add("ERROR", "E7", f"target_stats key '{k}' is not an EoF stat ({'/'.join(sorted(STAT_KEYS))})")
        elif not (isinstance(v, (int, float)) and 1 <= v <= 200):
            add("ERROR", "E7", f"target_stats {k}={v} outside 1..200")

    text = " ".join(str(b.get(f, "")) for f in ("playstyle", "name")) + " " + str(ex.get("perk", ""))
    hits = set(OLD_STATS.findall(text)) | ({"Strength"} if OLD_STRENGTH.search(text) else set())
    if hits:
        add("WARN", "W2", f"pre-EoF stat names in text: {', '.join(sorted(hits))}")

    if not b.get("source"):
        add("WARN", "W4", "no source cited")
    if not b.get("_confidence"):
        add("WARN", "W4", "_confidence missing")

errors = [f for f in findings if f[0] == "ERROR"]
warns = [f for f in findings if f[0] == "WARN"]

if "--json" in sys.argv:
    print(json.dumps([{"severity": s, "build": b, "code": c, "msg": m} for s, b, c, m in findings], indent=1))
else:
    print(f"Audited {len(data['builds'])} builds — {len(errors)} errors, {len(warns)} warnings\n")
    cur = None
    for s, bid, code, msg in sorted(findings, key=lambda f: (f[1], f[0] != "ERROR")):
        if bid != cur:
            print(f"▸ {bid}")
            cur = bid
        print(f"    {s:5} {code}  {msg}")
    clean = len(data["builds"]) - len({f[1] for f in findings})
    print(f"\n{clean} builds fully clean.")
sys.exit(1 if errors else 0)
