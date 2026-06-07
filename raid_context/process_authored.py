#!/usr/bin/env python3
"""Write from-scratch v3 activities (Vespers Host, DP Epic) + register them."""
import json, os, sys, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-1002/-home-cs-workspace-Destiny-2/44f42815-5f90-419a-b30b-39f6f2d7a7ba/tasks/wtlb023yu.output"
DATE = "2026-06-07"
raw = json.load(open(OUT))
results = raw.get("result", raw)

reg_path = os.path.join(HERE, "encounter_registry.json")
REG = json.load(open(reg_path))


def enc_doc(a, enc):
    d = enc["defense"]
    defense = {
        "incoming_damage": {"adds": d["incoming_adds"], "boss": d["incoming_boss"]},
        "champions": d["champions"],
        "recommended_defensive_mods": {"elemental": d["elemental_mods"], "concussive": d["concussive_mods"]},
    }
    roles = [{
        "id": r["role_id"], "does": r["does"],
        "loadout": {"subclass": r["subclass"], "weapons": r["weapons"], "exotic_armor": r["exotic_armor"],
                    "armor_stats": r["armor_stats"], "surges_mods": r["surges_mods"]},
    } for r in enc["roles"]]
    encounter = {
        "order": enc["order"], "slug": enc["slug"], "name": enc["name"],
        "abstract": enc["abstract"], "setup": enc["setup"],
        "plain_language_steps": enc["plain_language_steps"], "mechanics": enc["mechanics"],
        "defense": defense, "damage": enc["damage"], "roles": roles,
        "rewards": enc["rewards"], "common_mistakes": enc["common_mistakes"],
        "sources": [{"tier": s["tier"], "name": s["name"], "note": s["note"], "date_checked": DATE} for s in enc["sources"]],
    }
    return {"activity": {"slug": a["slug"], "name": a["name"], "activity_type": a["activity_type"], "fireteam_size": a["fireteam_size"]},
            "encounter": encounter}


report = []
for r in results:
    if not r or not r.get("authored"):
        report.append((r.get("item", {}).get("slug", "?"), "NO OUTPUT", 0, r.get("verdict")))
        continue
    a = r["authored"]
    vd = r.get("verdict") or {}
    sub = "raids" if a["activity_type"] == "raid" else "dungeons"
    outdir = os.path.join(HERE, "content", sub, a["slug"])
    os.makedirs(outdir, exist_ok=True)
    # _activity.yaml
    with open(os.path.join(outdir, "_activity.yaml"), "w") as f:
        f.write(f"# {a['slug']} — activity header (authored from scratch, isolated source)\n\n")
        yaml.safe_dump({"activity": {"slug": a["slug"], "name": a["name"], "activity_type": a["activity_type"], "fireteam_size": a["fireteam_size"]},
                        "overview": {"abstract": a["overview_abstract"]}}, f, sort_keys=False, allow_unicode=True, width=100)
    n = 0
    encs_meta = []
    for enc in a["encounters"]:
        doc = enc_doc(a, enc)
        path = os.path.join(outdir, f"{enc['order']}-{enc['slug']}.yaml")
        with open(path, "w") as f:
            f.write(f"# {sub}/{a['slug']}/{enc['order']}-{enc['slug']}.yaml — schema v3, authored from scratch (isolated). No guessing.\n\n")
            yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)
        encs_meta.append({"order": enc["order"], "slug": enc["slug"], "name": enc["name"], "ingame_name": ""})
        n += 1
    # register
    REG[a["slug"]] = {
        "slug": a["slug"], "name": a["name"], "activity_type": a["activity_type"],
        "fireteam_size": a["fireteam_size"], "yaml": f"raid_context/content/{sub}/{a['slug']}/",
        "encounter_count": len(encs_meta), "encounters": encs_meta,
    }
    report.append((a["slug"], vd.get("overall", "?"), n, vd))

json.dump(REG, open(reg_path, "w"), indent=2)

print(f"=== AUTHORED ACTIVITIES WRITTEN + REGISTERED ===")
print(f"registry now has {len(REG)} activities\n")
print(f"{'activity':24} {'verdict':16} {'enc':4}  isolation/eof/halluc")
for slug, ov, n, vd in report:
    vd = vd or {}
    iso = "ISO-LEAK" if vd.get("isolation_clean") is False else "iso-ok"
    eof = "OLD-STATS" if vd.get("eof_ok") is False else "eof-ok"
    hl = f"{len(vd.get('hallucination_flags', []))} halluc" if vd.get("hallucination_flags") else "no-halluc"
    print(f"{slug:24} {str(ov):16} {n:<4}  {iso} / {eof} / {hl}")
print("\n=== hallucination flags ===")
for slug, ov, n, vd in report:
    for h in ((vd or {}).get("hallucination_flags") or []):
        print(f"- [{slug}] {h[:200]}")
