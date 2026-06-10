#!/usr/bin/env python3
"""Merge the Pantheon boss-authoring workflow output into v3 encounter files.

    python3 merge_pantheon.py <workflow_output.json>

Writes content/raids/pantheon/<order>-<slug>.yaml for each authored boss, updates
_activity.yaml (lineup + status) and encounter_registry.json, then you re-run
bake_encounters.py. Every encounter is tagged tier-3 / _confidence: low — the
boss MECHANICS are historical fact, but the Pantheon-2.0 INCLUSION is an
UNVERIFIED community leak (not Bungie-confirmed as of 2026-06-10).
"""
import json, os, sys, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "content", "raids", "pantheon")
DATE = "2026-06-10"

raw = json.load(open(sys.argv[1]))
res = raw.get("result", raw)
results = res.get("results", [])

ACT = {"slug": "pantheon", "name": "Pantheon", "activity_type": "raid", "fireteam_size": 6}


def enc_doc(b):
    elemental = [f"{el} Resistance — vs {b['name']} damage" for el in b.get("incoming_elements", [])]
    concussive = ["Concussive Dampener — heavy AoE/slam/explosive damage"] if b.get("concussive") else []
    surges = [f"{el} — favored/locked DPS element" for el in b.get("surges", [])]
    champions = [f"{c} -> Anti-{c} (artifact)" for c in b.get("champions", [])]
    return {
        "activity": ACT,
        "encounter": {
            "order": b["order"],
            "slug": b["slug"],
            "name": b["name"],
            "ingame_name": b.get("ingame_name", ""),
            "abstract": b.get("abstract", ""),
            "plain_language_steps": b.get("plain_language_steps", []),
            "mechanics": b.get("mechanics", []),
            "defense": {
                "incoming_damage": {"adds": [], "boss": [f"{el}" for el in b.get("incoming_elements", [])]},
                "champions": champions,
                "recommended_defensive_mods": {"elemental": elemental, "concussive": concussive},
            },
            "damage": {
                "surges": surges,
                "burst_windows": "",
                "recommended_dps": b.get("recommended_dps", []),
            },
            "common_mistakes": b.get("common_mistakes", []),
            "_confidence": "low",
            "sources": [{
                "tier": 3,
                "name": f"UNVERIFIED community/leak lineup — Pantheon 2.0 (June 2026). Mechanics from the original {b.get('raid','')} encounter.",
                "note": "Boss inclusion in Pantheon 2.0 NOT Bungie-confirmed as of 2026-06-10; only Calus was hinted. "
                        "Mechanics are historical fact; Pantheon rescaling (champions/modifiers) unconfirmed.",
                "date_checked": DATE,
            }],
        },
    }


os.makedirs(OUTDIR, exist_ok=True)
lineup, reg_encs = [], []
for b in sorted(results, key=lambda x: x["order"]):
    if not b:
        continue
    path = os.path.join(OUTDIR, f"{b['order']}-{b['slug']}.yaml")
    with open(path, "w") as f:
        f.write(f"# raids/pantheon/{b['order']}-{b['slug']}.yaml — schema v3. UNVERIFIED Pantheon 2.0 lineup "
                f"(leak); mechanics from original {b.get('raid','')}. _confidence: low.\n\n")
        yaml.safe_dump(enc_doc(b), f, sort_keys=False, allow_unicode=True, width=100)
    lineup.append({"order": b["order"], "slug": b["slug"], "name": b["name"],
                   "source_raid": b.get("raid", ""), "confidence": "low", "verified": False})
    reg_encs.append({"order": b["order"], "slug": b["slug"], "name": b["name"], "ingame_name": b.get("ingame_name", "")})

# Update _activity.yaml lineup + status
act_path = os.path.join(OUTDIR, "_activity.yaml")
act = yaml.safe_load(open(act_path))
act["activity"]["status"] = "live-lineup-leak-authored-unverified"
act["overview"]["lineup"] = lineup
hdr = "".join(l for l in open(act_path) if l.startswith("#"))
with open(act_path, "w") as f:
    f.write(hdr)
    yaml.safe_dump(act, f, sort_keys=False, allow_unicode=True, width=100)

# Update registry
reg_path = os.path.join(HERE, "encounter_registry.json")
reg = json.load(open(reg_path))
reg["pantheon"]["encounter_count"] = len(reg_encs)
reg["pantheon"]["encounters"] = reg_encs
reg["pantheon"]["status"] = "live-lineup-leak-authored-unverified"
json.dump(reg, open(reg_path, "w"), indent=2)

print(f"wrote {len(reg_encs)} Pantheon encounter files + updated _activity.yaml + registry")
for b in sorted(results, key=lambda x: x["order"]):
    print(f"  {b['order']}-{b['slug']:18} in={b.get('incoming_elements')} conc={b.get('concussive')} "
          f"surge={b.get('surges')} champ={b.get('champions')} conf={b.get('confidence')}")
