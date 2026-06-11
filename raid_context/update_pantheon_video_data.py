#!/usr/bin/env python3
"""
update_pantheon_video_data.py
=============================
Enriches the Pantheon 2.0 encounter KB with data EXTRACTED from the KackisHD
launch walkthroughs (transcripts) the user provided:
  • Calus Resplendent — youtube.com/watch?v=kftwS8zi0iU
  • Morgeth Surpassing — youtube.com/watch?v=7gYoYn9k3kY

KEY FINDING: the launch walkthroughs show NO Champions, NO surges/burns, and NO
elemental shields — only mechanic-based immunity shields. So champions/surges
stay EMPTY (now gameplay-verified, not just "undocumented"). Weekly per-boss
modifiers remain TBD (06-16+). What the videos add is current DPS + per-boss
Pantheon-2.0 tactics (Truth Exotic Rocket is the standout post-Monument buff).

Run bake_encounters.py afterwards.
"""
import glob
import os
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
PANT = os.path.join(HERE, "content", "raids", "pantheon")
VID = {"calus": "https://www.youtube.com/watch?v=kftwS8zi0iU",
       "morgeth": "https://www.youtube.com/watch?v=7gYoYn9k3kY"}

MODIFIERS_NOTE = ("None observed at launch — no Champions, surges/burns, or elemental shields appeared in "
                  "the KackisHD launch walkthroughs; the only 'shields' are mechanic-based immunity shields. "
                  "Per-boss weekly modifiers remain TBD (expected 2026-06-16+).")

BOSS = {
    "argos": {"vid": "calus", "dps": [
        "Truth (Exotic Rocket Launcher) — massively buffed in Monument of Triumph (returns a rocket on hit + cluster bombs); the standout Pantheon 2.0 heavy DPS.",
        "Banner Shield (Titan) / Well of Radiance (Warlock) for the stationary open-eye window.",
        "Avoid Hand Cannons — Arc Souls auto-fire at the elemental orbs and can mis-trigger the orb mechanic.",
    ], "tactics": [
        "Lower the shield by shooting the three elemental orbs (two Arc on the sides, one Void at the top) — only the central vantage sees all three.",
        "First damage: jump up and shoot the boss's lower arms.",
        "Standing in the open during the psionic discharge is an instant kill — hold the lit safe plates.",
    ]},
    "gahlran": {"vid": "calus", "dps": [
        "Truth (Exotic Rocket) for the main window; Snipers to destroy the hands quickly.",
        "Set up Well / Banner Shield once the real Gahlran is found.",
    ], "tactics": [
        "Lower Gahlran's Deception's shield by meleeing it — one player WITH the Witch's Blessing buff, one without.",
        "During damage, Gahlran raises his hands — shoot BOTH hands to EXTEND the damage phase (skipping this ends DPS early).",
        "Gahlran fakes his identity (psychic faces) — find and shoot the real one.",
    ]},
    "calus": {"vid": "calus", "dps": [
        "Truth (Exotic Rocket) early; it falls off once Calus exposes the central chest crit mid-phase — swap to a precision heavy then.",
        "Banner Shield / Well for the shared-room DPS.",
    ], "tactics": [
        "Shadow Realm / Normal Room split: shadow players destroy skulls for Force of Will; normal-room players destroy Calus's overshield to pull the shadow players back.",
        "Destroy the overshield but back off around 70-80 Force of Will so the shadow team banks more skulls before the big explosion.",
        "Final stand: Calus builds a charge + shield — keep damaging to rip through it.",
    ]},
    "warpriest": {"vid": "morgeth", "dps": [
        "Truth (Exotic Rocket) — immense Monument-of-Triumph buff, slays the Warpriest.",
        "Well / Banner Shield during the damage window.",
    ], "tactics": [
        "King's Fall flow: brand claimer hot-potato, kill Wizards to spawn Knights for brands, hit the totems in the called order to open damage.",
    ]},
    "consecrated-mind": {"vid": "morgeth", "dps": [
        "Long-range weapons shine — Sniper Rifles are fantastic as the boss backs away; Truth (Exotic Rocket) for burst.",
        "Well / Banner for the deposit-and-DPS window.",
    ], "tactics": [
        "The boss is drawn to the 'overloaded relay' (moves to the arena center).",
        "Vex spawn with immunity shields — destroy them with the Enlightened buff.",
        "Stand in a relay's physical shadow to survive the wipe mechanic; deposit Death Singer's Power to trigger the DPS phase.",
    ]},
    "morgeth": {"vid": "morgeth", "dps": [
        "Truth (Exotic Rocket); SAVE Heavy for the final-stand mechanic — running dry there resets the encounter.",
        "Well / Banner in the Queenswalk DPS area.",
    ], "tactics": [
        "Pick up Taken Strength (x2) + the brand; DPS in the Queenswalk area.",
        "A Taken relic spawns — use its SUPER on Morgeth to END the damage phase BEFORE he hits 100% Taken Strength (100% = team wipe).",
        "TIP: run Calus Resplendent BEFORE Morgeth Surpassing (Drifter synergy).",
    ]},
}

for f in glob.glob(os.path.join(PANT, "[0-9]*-*.yaml")):
    slug = os.path.basename(f).split("-", 1)[1].rsplit(".", 1)[0]
    data = BOSS.get(slug)
    if not data:
        continue
    doc = yaml.safe_load(open(f))
    enc = doc["encounter"]
    enc.setdefault("damage", {})["recommended_dps"] = data["dps"]
    enc["pantheon_2_0"] = {
        "tactics": data["tactics"],
        "modifiers_observed": MODIFIERS_NOTE,
        "dps_meta_note": "Truth (Exotic Rocket Launcher) is the post-Monument-of-Triumph DPS standout across all bosses.",
    }
    # add the walkthrough video as a tier-2 source
    src = enc.setdefault("sources", [])
    vid_url = VID[data["vid"]]
    if not any(s.get("url") == vid_url for s in src):
        src.append({"tier": 2,
                    "name": "KackisHD launch walkthrough — Pantheon 2.0 mechanics + DPS confirmed via gameplay transcript.",
                    "url": vid_url, "date_checked": "2026-06-11"})
    # mechanics are now gameplay-verified
    enc["_confidence"] = "high"
    header_lines = open(f).read().split("\n")
    header = "\n".join(l for l in header_lines if l.startswith("#"))
    open(f, "w").write(header + "\n\n" + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, default_flow_style=False, width=100))
    print(f"  ✓ {slug}: +{len(data['tactics'])} tactics, DPS updated, video cited")

print("done — run bake_encounters.py")
