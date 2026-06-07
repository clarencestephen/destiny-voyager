#!/usr/bin/env python3
"""Merge the Aztecross-sourced per-encounter authoring into the Salvation's Edge
v3 files. Aztecross = source of truth: upgrade mechanics/steps/callouts, add
multiple strategies + per-player role breakdown, merge DPS, cite Aztecross.
Keeps existing loadout enrichment + defense intact."""
import json, glob, yaml, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = "/tmp/claude-1002/-home-cs-workspace-Destiny-2/44f42815-5f90-419a-b30b-39f6f2d7a7ba/tasks/wtzgs1rff.output"
o = json.load(open(OUT))


def dedup_extend(base, add):
    base = list(base or []); seen = {str(x).strip().lower() for x in base}
    for x in (add or []):
        if str(x).strip() and str(x).strip().lower() not in seen:
            base.append(x); seen.add(str(x).strip().lower())
    return base


n = 0
for r in o["result"]:
    c = r.get("content")
    if not c:
        continue
    enc_slug = c["encounter_slug"]
    m = glob.glob(os.path.join(HERE, f"content/raids/salvations-edge/[0-9]*-{enc_slug}.yaml"))
    if not m:
        print("MISS", enc_slug); continue
    doc = yaml.safe_load(open(m[0])); e = doc["encounter"]
    # Aztecross-sourced upgrades (truth)
    e["mechanics"] = c["mechanics"]
    e["plain_language_steps"] = c["plain_language_steps"]
    e["callouts"] = [{"when": x.get("when", ""), "say": x.get("say", ""), "why": x.get("why", "")} for x in c.get("callouts", [])]
    e["strategies"] = c["strategies"]            # multiple cross-referenced solutions
    e["role_breakdown"] = c["per_role"]          # per-player roles
    e.setdefault("damage", {})["recommended_dps"] = dedup_extend(e.get("damage", {}).get("recommended_dps"), c.get("dps_options"))
    # citation: Aztecross truth + cross-ref
    srcs = e.setdefault("sources", [])
    srcs.append({"tier": 1, "name": "Aztecross (source of truth) — per-encounter video, cross-referenced",
                 "note": "Mechanics / steps / strategies / 6-player roles authored from Aztecross's "
                         "encounter video + cross-referenced sources. REGULAR mode. Loadouts: verify for "
                         "the 6/9 Monument of Triumph sandbox.",
                 "date_checked": "2026-06-07"})
    if c.get("needs_clarification"):
        e["needs_clarification"] = c["needs_clarification"]
    hdr = "".join(l for l in open(m[0]) if l.startswith("#"))
    open(m[0], "w").write(hdr)
    with open(m[0], "a") as f:
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)
    n += 1
    print(f"  {enc_slug}: {len(c['mechanics'])} mechanics, {len(c['strategies'])} strategies, {len(c['per_role'])} roles")
print(f"merged {n} SE encounters (Aztecross-sourced)")
