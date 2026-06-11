#!/usr/bin/env python3
"""
update_pantheon_official.py
===========================
Pantheon 2.0 OFFICIALLY CONFIRMED (Monument of Triumph / Update 9.7.0, 2026-06-09).
The leak roster + source raids were EXACT — only the structure changed: Bungie ships
the 6 bosses as two named 3-boss activities + a full gauntlet.

This:
  • regroups + renumbers the 6 encounter YAMLs into the two confirmed activities
      Calus Resplendent : Argos → Gahlran → Calus
      Morgeth Surpassing: Warpriest → Consecrated Mind → Morgeth
  • sets verified:true / _confidence:high on boss identity + source raid
  • keeps champions/surges EMPTY + _confidence note (per-boss modifiers still TBD,
    not in patch notes; revisit after the June 16 weekly-rotation TWID)
  • re-cites: Bungie Update 9.7.0 patch notes + KackisHD gameplay walkthroughs
  • rewrites _activity.yaml and the encounter_registry.json pantheon entry

Sources: Gmail "Pantheon lineup REVEALED" watcher report (Bungie 9.7.0 patch notes
via shatteredvault mirror, TWID 05/29, gameplay) + KackisHD walkthrough videos.
Run bake_encounters.py afterwards.
"""
import glob
import json
import os
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
PANT = os.path.join(HERE, "content", "raids", "pantheon")

VID_CALUS = "https://www.youtube.com/watch?v=kftwS8zi0iU"   # KackisHD — Calus Resplendent walkthrough
VID_MORG = "https://www.youtube.com/watch?v=7gYoYn9k3kY"    # KackisHD — Morgeth Surpassing walkthrough

# order, slug, name, source_raid, activity_name, order_in_activity, walkthrough_video
BOSSES = [
    (1, "argos", "Argos, Planetary Core", "Leviathan: Spire of Stars (raid lair)", "Calus Resplendent", 1, VID_CALUS),
    (2, "gahlran", "Gahlran, the Sorrow-Bearer", "Leviathan: Crown of Sorrow (raid lair)", "Calus Resplendent", 2, VID_CALUS),
    (3, "calus", "Emperor Calus", "Leviathan (base raid final boss)", "Calus Resplendent", 3, VID_CALUS),
    (4, "warpriest", "The Warpriest", "King's Fall", "Morgeth Surpassing", 1, VID_MORG),
    (5, "consecrated-mind", "Consecrated Mind", "Garden of Salvation", "Morgeth Surpassing", 2, VID_MORG),
    (6, "morgeth", "Morgeth, the Spirekeeper", "Last Wish", "Morgeth Surpassing", 3, VID_MORG),
]


def dump(doc):
    return yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, default_flow_style=False, width=100)


def confirmed_sources(activity_name, video):
    return [
        {"tier": 1,
         "name": "Bungie — Update 9.7.0 patch notes (Monument of Triumph, 2026-06-09); officially names "
                 f'the activity "{activity_name}".',
         "url": "https://www.bungie.net/7/en/News/Article/destiny_update_9_7_0",
         "date_checked": "2026-06-11"},
        {"tier": 2,
         "name": f'KackisHD — "PANTHEON: {activity_name.upper()} FOR DUMMIES! | Complete Raid Guide & '
                 'Walkthrough!" — confirms in-game boss identity + walkthrough.',
         "url": video,
         "date_checked": "2026-06-11"},
        {"tier": 3,
         "name": "Per-boss MODIFIERS (champion types, surges, shields) for Pantheon 2.0 are NOT yet "
                 "documented (not in patch notes). champions/surges left EMPTY rather than guessed; "
                 "revisit after the weekly-rotation TWID (expected 2026-06-16+).",
         "date_checked": "2026-06-11"},
    ]


# 1) regroup + rewrite the encounter files -------------------------------------
existing = {}
for f in glob.glob(os.path.join(PANT, "[0-9]*-*.yaml")):
    slug = os.path.basename(f).split("-", 1)[1].rsplit(".", 1)[0]
    existing[slug] = f

for order, slug, name, raid, activity_name, oia, video in BOSSES:
    src = existing.get(slug)
    if not src:
        print(f"  ! missing existing file for {slug}")
        continue
    doc = yaml.safe_load(open(src))
    enc = doc["encounter"]
    enc["order"] = order
    enc["activity_name"] = activity_name
    enc["order_in_activity"] = oia
    enc["name"] = name
    enc["source_raid"] = raid
    enc["verified"] = True
    enc["_confidence"] = "high"            # boss identity + source raid (modifiers still TBD)
    enc["sources"] = confirmed_sources(activity_name, video)
    header = (f"# raids/pantheon/{order}-{slug}.yaml — schema v3. Pantheon 2.0 CONFIRMED "
              f"(Update 9.7.0, 2026-06-09). Activity: {activity_name} ({oia}/3). "
              f"Boss identity + source raid verified:true/_confidence:high; per-boss MODIFIERS TBD.\n\n")
    out = os.path.join(PANT, f"{order}-{slug}.yaml")
    open(out, "w").write(header + dump(doc))
    if os.path.abspath(src) != os.path.abspath(out):
        os.remove(src)
    print(f"  ✓ {activity_name}: {order}-{slug}.yaml")

# 2) rewrite _activity.yaml ----------------------------------------------------
activity = {
    "activity": {
        "slug": "pantheon", "name": "Pantheon", "activity_type": "raid",
        "fireteam_size": 6, "category": "boss-rush",
        "status": "live-confirmed-official",
    },
    "overview": {
        "abstract": (
            "Pantheon (\"Pantheon 2.0\") is a PERMANENT raid-boss-rush activity that launched with the "
            "2026-06-09 Monument of Triumph update (Update 9.7.0). The six confirmed bosses are reprised "
            "raid bosses fought back-to-back under escalating Power handicaps + modifiers. Bungie ships "
            "them as TWO named 3-boss activities (Calus Resplendent, Morgeth Surpassing) plus a full "
            "6-boss Gauntlet that unlocks 2026-06-13. The roster + source raids are CONFIRMED; per-boss "
            "modifiers (champions/surges/shields) are not yet documented as of 2026-06-11."),
        "structure": {
            "Calus Resplendent": ["Argos, Planetary Core", "Gahlran, the Sorrow-Bearer", "Emperor Calus"],
            "Morgeth Surpassing": ["The Warpriest", "Consecrated Mind, Sol Inherent", "Morgeth, the Spirekeeper"],
            "The Gauntlet": "All 6 bosses back-to-back; unlocks Saturday 2026-06-13 10 AM PT.",
        },
        "schedule_2026": [
            "2026-06-09: Calus Resplendent + Morgeth Surpassing launch (Update 9.7.0).",
            "2026-06-13 (Sat, 10 AM PT): The Gauntlet (all 6) unlocks.",
            "2026-06-16 (Tue reset): weekly featured single-boss rotators begin (two bosses/week).",
        ],
        "difficulty": [
            "Escalating Power handicap per boss as you progress the gauntlet (boss is +N Power over the player).",
            "Adventure-style accessibility (raised Power cap, revives) in exchange for lower-Tier rewards on the easier tier.",
            "Per-boss champion/surge/shield modifiers NOT yet documented — gather from in-game / a future TWID.",
        ],
        "rewards": [
            "Per boss: one Adept weapon (weekly, via the Bonus/Platinum timer) + Spoils of Conquest + Trophy of Bravery.",
            "Monument-of-Triumph loot overhaul: raid/dungeon weapons gain Tier parity, set bonuses, new perks; crafted raid weapons gain a Tier 1-5 path.",
            "Divine Weaponry quest (Arcite 99-40, Hall of Champions, after the Gauntlet) → a raid Exotic of choice.",
            "Emblems: Atraks Dethroned / Exalted Beyond Oryx / Rhulk Subdued / Elevated Above Nezarec — NOTE: these are the ORIGINAL-Pantheon emblem names some guides still list; treat as unverified for 2.0.",
            "Godslayer title (10 triumphs: completion + Platinum-timer per boss).",
        ],
        "loadout_guidance": (
            "Endgame boss-DPS gauntlet: bring strong, flexible burst DPS + survivability. Anti-Champion is "
            "artifact-based this era. Per-boss element-specific resist/surge recommendations are deferred "
            "until Bungie/TWID publishes the Pantheon-2.0 modifiers (expected 2026-06-16+)."),
        "lineup": [
            {"order": o, "slug": s, "name": n, "source_raid": r, "activity": a, "order_in_activity": oia,
             "confidence": "high", "verified": True}
            for (o, s, n, r, a, oia, _v) in BOSSES
        ],
        "sources": [
            {"tier": 1, "name": "Bungie — Update 9.7.0 patch notes (Monument of Triumph, 2026-06-09); names "
             '"Calus Resplendent" + "Morgeth Surpassing".',
             "url": "https://www.bungie.net/7/en/News/Article/destiny_update_9_7_0", "date_checked": "2026-06-11"},
            {"tier": 1, "name": "Bungie — This Week in Destiny 05/29/2026 (structure: two activities, Gauntlet 06-13, rotations 06-16).",
             "url": "https://www.bungie.net/7/en/News/Article/twid_05_29_2026", "date_checked": "2026-06-11"},
            {"tier": 2, "name": "KackisHD — Calus Resplendent + Morgeth Surpassing complete walkthroughs (gameplay confirms boss identities).",
             "url": VID_CALUS, "date_checked": "2026-06-11"},
            {"tier": 2, "name": "Pantheon 2.0 release watcher report (Gmail, 2026-06-11) — patch-note verification + leak/confirmed comparison.",
             "date_checked": "2026-06-11"},
        ],
    },
}
header = ("# pantheon — activity header. Pantheon 2.0 OFFICIALLY CONFIRMED via Bungie Update 9.7.0\n"
          "# (Monument of Triumph, 2026-06-09). The earlier leak roster + source raids were EXACT;\n"
          "# Bungie groups the 6 bosses into two named 3-boss activities + a full Gauntlet (06-13).\n"
          "# Boss identity + source raid: verified. Per-boss MODIFIERS (champions/surges/shields): TBD.\n\n")
open(os.path.join(PANT, "_activity.yaml"), "w").write(header + dump(activity))
print("  ✓ _activity.yaml")

# 3) update the registry pantheon entry ----------------------------------------
REG = os.path.join(HERE, "encounter_registry.json")
reg = json.load(open(REG))
if "pantheon" in reg:
    reg["pantheon"]["status"] = "confirmed"
    reg["pantheon"]["encounters"] = [
        {"order": o, "slug": s, "name": n, "activity": a, "verified": True}
        for (o, s, n, r, a, oia, _v) in BOSSES
    ]
    json.dump(reg, open(REG, "w"), indent=2, ensure_ascii=False)
    print("  ✓ encounter_registry.json")

print("done — now run: python3 bake_encounters.py")
