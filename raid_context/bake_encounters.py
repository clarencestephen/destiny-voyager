#!/usr/bin/env python3
"""Bake per-encounter mod hints from the raid KB → web/public/encounters.json.

The optimizer's encounter selector reads this to pre-set the element-matched
mod context: which incoming damage to resist (chest), whether the encounter is
explosive (Concussive Dampener), and the DPS surge element (legs). Source of
truth = content/{raids,dungeons}/<activity>/<N-slug>.yaml. Re-run after the
per-encounter enrichment pass updates those YAMLs.
"""
import json
import os
import re
import glob
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "public", "encounters.json")

# Verified overlay from the per-encounter fan-out (raid_context/workflows/
# verify_encounters.workflow.js). When present for "<aslug>/<eslug>", its
# isolation-clean structured profile overrides the free-text YAML parse.
OVERLAY_PATH = os.path.join(HERE, "encounters_verified.json")
OVERLAY = json.load(open(OVERLAY_PATH)) if os.path.exists(OVERLAY_PATH) else {}

ELEMENTS = ["Arc", "Solar", "Void", "Stasis", "Strand", "Kinetic"]
EL_RE = re.compile(r"\b(" + "|".join(ELEMENTS) + r")\b")
CHAMP_RE = re.compile(r"\b(Barrier|Overload|Unstoppable)\b")


def _elements(strings):
    seen, out = set(), []
    for s in strings or []:
        for m in EL_RE.findall(str(s)):
            if m not in seen:
                seen.add(m); out.append(m)
    return out


def _champions(strings):
    seen, out = set(), []
    for s in strings or []:
        for m in CHAMP_RE.findall(str(s)):
            if m not in seen:
                seen.add(m); out.append(m)
    return out


def _encounter(doc):
    enc = doc.get("encounter") or {}
    dfn = enc.get("defense") or {}
    mods = dfn.get("recommended_defensive_mods") or {}
    dmg = enc.get("damage") or {}
    concussive_list = mods.get("concussive") or []
    out = {
        "slug": enc.get("slug", ""),
        "name": enc.get("name", ""),
        "order": enc.get("order", 0),
        "incoming_elements": _elements(mods.get("elemental")),
        "concussive": bool(concussive_list),
        "surges": _elements(dmg.get("surges")),
        "champions": _champions(dfn.get("champions")),
    }
    if enc.get("activity_name"):                     # Pantheon's two named sub-activities
        out["activity_name"] = enc["activity_name"]
    return out


activities = []
for sub in ("raids", "dungeons"):
    base = os.path.join(HERE, "content", sub)
    for adir in sorted(glob.glob(os.path.join(base, "*"))):
        if not os.path.isdir(adir):
            continue
        slug = os.path.basename(adir)
        encs = []
        name = slug.replace("-", " ").title()
        for f in sorted(glob.glob(os.path.join(adir, "[0-9]*-*.yaml"))):
            try:
                doc = yaml.safe_load(open(f))
            except Exception as e:
                print("SKIP", f, e); continue
            if not doc or "encounter" not in doc:
                continue
            name = (doc.get("activity") or {}).get("name", name)
            e = _encounter(doc)
            ov = OVERLAY.get(f"{slug}/{e['slug']}")
            if ov:
                e["incoming_elements"] = ov["incoming_elements"]
                e["concussive"] = ov["concussive"]
                e["surges"] = ov["surges"]
                e["champions"] = ov["champions"]
                e["confidence"] = ov.get("confidence", "med")
                e["verified"] = True
            encs.append(e)
        if encs:
            encs.sort(key=lambda e: e["order"])
            activities.append({"slug": slug, "name": name, "type": sub[:-1], "encounters": encs})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as fh:
    json.dump({"activities": activities}, fh)

n_enc = sum(len(a["encounters"]) for a in activities)
with_data = sum(1 for a in activities for e in a["encounters"] if e["incoming_elements"] or e["surges"] or e["concussive"])
print(f"wrote {OUT}: {len(activities)} activities, {n_enc} encounters ({with_data} with mod hints)")
