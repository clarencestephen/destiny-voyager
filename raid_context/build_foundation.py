#!/usr/bin/env python3
"""
Phase 0 — deterministic foundation for the raid/dungeon replan.

Does NOT use any LLM agents. Pure file ops + YAML parsing.

Outputs:
  raid_context/encounter_registry.json   canonical activity -> ordered encounters
  raid_context/asset_manifest.json        per-activity raw asset inventory
  raid_context/foundation_report.md       human-readable summary + edge-case flags

Side effect (additive, non-destructive):
  Creates "Encounter N - <Name>/" + "Overview/" skeleton folders inside each
  matched resource activity folder. Never moves or deletes existing files.
"""
import os, re, json, glob, sys

ROOT = "/home/cs/workspace/Destiny 2"
TK = os.path.join(ROOT, "destiny2-loadout-toolkit")
RAIDS_DIR = os.path.join(TK, "raids")
OUT_DIR = os.path.join(TK, "raid_context")
os.makedirs(OUT_DIR, exist_ok=True)

import yaml

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")

# Resource folder slug -> registry slug (handles typos / pluralization)
ALIAS = {
    "sundred-doctrine": "sundered-doctrine",
    "warlords-ruins": "warlords-ruin",
}
# Resource folders with no 1:1 authored guide — flag, do not skeleton.
EDGE = {
    "get-ready-to-raid": "meta folder (raid-readiness checklist) — no encounters",
    "desert-perpetual-epic": "variant of desert-perpetual — confirm if separate encounter set",
    "vespers-host": "NO authored YAML guide exists — needs a from-scratch guide",
}


def norm(folder_name):
    s = folder_name.lower().lstrip("#").strip()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9-]", "", s)
    return s


def sanitize_folder(name):
    # keep it filesystem-friendly but readable
    name = name.replace("/", "-").replace(":", " -").strip()
    name = re.sub(r"\s+", " ", name)
    return name


# ---------------------------------------------------------------- 1. registry
registry = {}
yaml_files = sorted(glob.glob(os.path.join(RAIDS_DIR, "*.yaml"))) + \
             sorted(glob.glob(os.path.join(RAIDS_DIR, "dungeons", "*.yaml")))
for yf in yaml_files:
    base = os.path.basename(yf)
    if base == "_template.yaml":
        continue
    try:
        with open(yf) as f:
            data = yaml.safe_load(f)
    except Exception as e:
        print(f"  !! failed to parse {base}: {e}", file=sys.stderr)
        continue
    if not isinstance(data, dict):
        continue
    slug = data.get("slug") or base[:-5]
    encs = []
    for e in (data.get("encounters") or []):
        if not isinstance(e, dict):
            continue
        encs.append({
            "order": e.get("order"),
            "slug": e.get("slug"),
            "name": e.get("name"),
            "ingame_name": e.get("ingame_name", ""),
        })
    registry[slug] = {
        "slug": slug,
        "name": data.get("name"),
        "activity_type": data.get("activity_type"),
        "fireteam_size": data.get("fireteam_size"),
        "yaml": os.path.relpath(yf, TK),
        "encounter_count": len(encs),
        "encounters": encs,
    }

with open(os.path.join(OUT_DIR, "encounter_registry.json"), "w") as f:
    json.dump(registry, f, indent=2)


# ------------------------------------------------- 2. map resources + skeleton
def inventory_activity(activity_dir):
    top_images, msgid_folders, json_exports, other = [], [], [], []
    for entry in sorted(os.listdir(activity_dir)):
        if entry.endswith(":Zone.Identifier"):
            continue
        full = os.path.join(activity_dir, entry)
        if os.path.isdir(full):
            if entry.startswith("Encounter ") or entry == "Overview":
                continue  # already-restructured target folders
            msgid_folders.append(entry)
        elif entry.lower().endswith(IMG_EXT):
            top_images.append(entry)
        elif entry.lower().endswith(".json"):
            json_exports.append(entry)
        else:
            other.append(entry)
    return {
        "top_level_images": top_images,
        "message_id_folders": msgid_folders,
        "json_exports": json_exports,
        "other": other,
    }


manifest = {}
matched, unmatched, edged = [], [], []
created_folders = []

for res_root in ("Raid resources", "dungeon resources"):
    res_path = os.path.join(ROOT, res_root)
    if not os.path.isdir(res_path):
        continue
    for folder in sorted(os.listdir(res_path)):
        activity_dir = os.path.join(res_path, folder)
        if not os.path.isdir(activity_dir):
            continue
        slug = norm(folder)
        slug = ALIAS.get(slug, slug)

        inv = inventory_activity(activity_dir)
        record = {
            "resource_folder": f"{res_root}/{folder}",
            "normalized_slug": slug,
            "matched_registry": None,
            "assets": inv,
            "image_count": len(inv["top_level_images"]),
            "msgid_folder_count": len(inv["message_id_folders"]),
        }

        if slug in EDGE:
            record["status"] = "EDGE_CASE"
            record["note"] = EDGE[slug]
            edged.append((f"{res_root}/{folder}", EDGE[slug]))
            manifest[f"{res_root}/{folder}"] = record
            continue

        if slug not in registry:
            record["status"] = "UNMATCHED"
            unmatched.append(f"{res_root}/{folder} (norm={slug})")
            manifest[f"{res_root}/{folder}"] = record
            continue

        record["status"] = "MATCHED"
        record["matched_registry"] = slug
        matched.append(f"{res_root}/{folder} -> {slug}")

        # create skeleton: Overview/ + Encounter N - Name/
        ov = os.path.join(activity_dir, "Overview")
        if not os.path.isdir(ov):
            os.makedirs(ov, exist_ok=True)
            created_folders.append(os.path.relpath(ov, ROOT))
        planned = []
        for e in registry[slug]["encounters"]:
            order = e["order"]
            name = e["name"] or e["slug"] or f"encounter-{order}"
            fname = f"Encounter {order} - {sanitize_folder(str(name))}"
            target = os.path.join(activity_dir, fname)
            planned.append(fname)
            if not os.path.isdir(target):
                os.makedirs(target, exist_ok=True)
                created_folders.append(os.path.relpath(target, ROOT))
        record["encounter_folders"] = planned
        manifest[f"{res_root}/{folder}"] = record

with open(os.path.join(OUT_DIR, "asset_manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)


# ---------------------------------------------------------------- 3. report
lines = []
lines.append("# Phase 0 — Foundation Report\n")
lines.append(f"- Activities in registry: **{len(registry)}** "
             f"({sum(1 for v in registry.values() if v['activity_type']=='raid')} raids, "
             f"{sum(1 for v in registry.values() if v['activity_type']=='dungeon')} dungeons)")
total_encs = sum(v["encounter_count"] for v in registry.values())
lines.append(f"- Total encounters: **{total_encs}**")
lines.append(f"- Resource folders matched: **{len(matched)}**")
lines.append(f"- Skeleton folders created this run: **{len(created_folders)}**\n")

lines.append("## Registry (activity -> encounters)\n")
for slug, v in registry.items():
    encs = ", ".join(f"{e['order']}·{e['name']}" for e in v["encounters"])
    lines.append(f"- **{v['name']}** (`{slug}`, {v['activity_type']}, fireteam {v['fireteam_size']}): {encs}")

lines.append("\n## Edge cases (need a decision — NOT skeletoned)\n")
for folder, note in edged:
    lines.append(f"- `{folder}` — {note}")

if unmatched:
    lines.append("\n## Unmatched resource folders\n")
    for u in unmatched:
        lines.append(f"- {u}")

lines.append("\n## Asset coverage (images / msg-id folders per matched activity)\n")
for k, rec in manifest.items():
    if rec.get("status") != "MATCHED":
        continue
    lines.append(f"- `{k}` → {rec['image_count']} top-level images, "
                 f"{rec['msgid_folder_count']} message-id folders")

with open(os.path.join(OUT_DIR, "foundation_report.md"), "w") as f:
    f.write("\n".join(lines) + "\n")

print("\n".join(lines))
print(f"\n[written] {OUT_DIR}/encounter_registry.json")
print(f"[written] {OUT_DIR}/asset_manifest.json")
print(f"[written] {OUT_DIR}/foundation_report.md")
print(f"[created] {len(created_folders)} skeleton folders")
