#!/usr/bin/env python3
"""Merge Phase-2 v3 additions into per-encounter v3 files (v2 mechanics + additions)."""
import json, os, sys, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
TK = os.path.dirname(HERE)
REG = json.load(open(os.path.join(HERE, "encounter_registry.json")))
OUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-1002/-home-cs-workspace-Destiny-2/44f42815-5f90-419a-b30b-39f6f2d7a7ba/tasks/wlu28zqk5.output"
DATE = "2026-06-07"

raw = json.load(open(OUT_FILE))
results = raw.get("result", raw)

# dedupe by slug, prefer non-null additions
bysl = {}
for r in results:
    if not r:
        continue
    s = r.get("slug")
    if not s:
        continue
    if s not in bysl or (r.get("additions") and not bysl[s].get("additions")):
        bysl[s] = r


def norm(x):
    return "".join(c for c in str(x).lower() if c.isalnum())


def v3_defense(d):
    return {
        "incoming_damage": {"adds": d.get("incoming_adds", []), "boss": d.get("incoming_boss", [])},
        "champions": d.get("champions", []),
        "recommended_defensive_mods": {
            "elemental": d.get("elemental_mods", []),
            "concussive": d.get("concussive_mods", []),
        },
    }


def v3_sources(srcs):
    out = []
    for s in srcs or []:
        out.append({"tier": s.get("tier", 1), "name": s.get("name", ""), "note": s.get("note", ""), "date_checked": DATE})
    return out


report, written = [], 0
for slug, r in sorted(bysl.items()):
    add = r.get("additions")
    verdict = r.get("verdict") or {}
    if not add:
        report.append((slug, "NO ADDITIONS (failed)", 0, verdict))
        continue
    a = REG[slug]
    sub = "raids" if a["activity_type"] == "raid" else "dungeons"
    v2 = yaml.safe_load(open(os.path.join(TK, a["yaml"])))
    v2_by_slug = {e.get("slug"): e for e in v2.get("encounters", [])}
    n = 0
    for enc_add in add.get("encounters", []):
        eslug = enc_add.get("encounter_slug")
        if slug == "salvations-edge" and eslug == "verity":
            continue  # already authored + verified
        block = v2_by_slug.get(eslug)
        if block is None:
            continue
        enc = dict(block)
        enc["plain_language_steps"] = enc_add.get("plain_language_steps", [])
        enc["defense"] = v3_defense(enc_add.get("defense", {}))
        enc["damage"] = enc_add.get("damage", {})
        enc["role_loadouts"] = enc_add.get("per_role_loadout", [])
        enc["sources"] = v3_sources(enc_add.get("sources", []))
        # attach loadout into matching permutation roles
        lo_by_id = {norm(l.get("role_id")): l for l in enc_add.get("per_role_loadout", [])}
        for perm in enc.get("permutations", []) or []:
            for role in perm.get("roles", []) or []:
                lo = lo_by_id.get(norm(role.get("id")))
                if lo:
                    role["loadout"] = {k: v for k, v in lo.items() if k != "role_id"}
        doc = {
            "activity": {"slug": slug, "name": a["name"], "activity_type": a["activity_type"], "fireteam_size": a["fireteam_size"]},
            "encounter": enc,
        }
        outdir = os.path.join(HERE, "content", sub, slug)
        os.makedirs(outdir, exist_ok=True)
        path = os.path.join(outdir, f"{block['order']}-{eslug}.yaml")
        header = (f"# raid_context/content/{sub}/{slug}/{block['order']}-{eslug}.yaml\n"
                  f"# Schema v3 (atomic). v2 mechanics + Phase-2 verified additions. EoF stat names.\n"
                  f"# Blank loadout fields = unverified (no guessing).\n\n")
        with open(path, "w") as f:
            f.write(header)
            yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)
        n += 1
        written += 1
    report.append((slug, verdict.get("overall", "?"), n, verdict))

print(f"=== MERGE COMPLETE — {written} encounter files written ===\n")
print(f"{'activity':22} {'verdict':16} {'files':5}  flags")
for slug, ov, n, vd in report:
    flags = []
    if vd.get("cross_activity_clean") is False:
        flags.append("CROSS-LEAK")
    if vd.get("eof_ok") is False:
        flags.append("OLD-STATS")
    if vd.get("guessing_flags"):
        flags.append(f"{len(vd['guessing_flags'])} guess")
    print(f"{slug:22} {str(ov):16} {n:<5}  {', '.join(flags) if flags else 'clean'}")
# surface guessing flags detail
print("\n=== flagged details ===")
for slug, ov, n, vd in report:
    for g in (vd.get("guessing_flags") or []):
        print(f"- [{slug}] {g[:200]}")
