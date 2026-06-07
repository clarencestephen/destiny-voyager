#!/usr/bin/env python3
"""Merge Pass-2/3 CITED loadout enrichment into v3 files — ADDITIVE + DISCIPLINED.

Before merging each activity:
  1. STRIP cross-activity raid names (weapon-origin tags like "(Last Wish)") so
     no other activity is named in this file.
  2. TRANSLATE any old stat names -> Edge of Fate names.
  3. POLICY GATE: merge only if isolation-clean-after-strip AND <= MAX_FLAGS
     uncited/invented flags. Heavily-flagged or fail activities are deferred.
Never overwrites authored mechanics; appends meta_loadout + cited source.
"""
import json, os, sys, glob, re, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
DATE = "2026-06-07"
MAX_FLAGS = int(os.environ.get("MAX_FLAGS", "2"))
raw = json.load(open(OUT))
results = raw.get("result", raw)

NAME2SLUG = {
    "last wish": "last-wish", "king's fall": "kings-fall", "kings fall": "kings-fall",
    "vault of glass": "vault-of-glass", "vow of the disciple": "vow-of-the-disciple",
    "deep stone crypt": "deep-stone-crypt", "garden of salvation": "garden-of-salvation",
    "root of nightmares": "root-of-nightmares", "salvation's edge": "salvations-edge",
    "salvations edge": "salvations-edge", "crota's end": "crotas-end", "crotas end": "crotas-end",
    "desert perpetual": "desert-perpetual", "ghosts of the deep": "ghosts-of-the-deep",
    "grasp of avarice": "grasp-of-avarice", "pit of heresy": "pit-of-heresy",
    "shattered throne": "shattered-throne", "spire of the watcher": "spire-of-the-watcher",
    "sundered doctrine": "sundered-doctrine", "warlord's ruin": "warlords-ruin",
    "warlords ruin": "warlords-ruin", "vesper's host": "vespers-host",
}
STAT = {"resilience": "Health", "recovery": "Class", "mobility": "Weapons",
        "discipline": "Grenade", "intellect": "Super", "strength": "Melee"}


def clean_str(s: str, own: str) -> str:
    for name, oslug in NAME2SLUG.items():
        if oslug == own or name not in s.lower():
            continue
        # drop a parenthetical that mentions the other activity
        s = re.sub(r"\s*\([^)]*" + re.escape(name) + r"[^)]*\)", "", s, flags=re.I)
        # drop "from <name>" / ", <name>" / "<name> raid weapon" clauses
        s = re.sub(r"[,;]?\s*(?:farmable\s+)?(?:from\s+)?" + re.escape(name) + r"(?:\s+raid)?(?:\s+weapon)?", "", s, flags=re.I)
    for old, new in STAT.items():
        s = re.sub(r"\b" + old + r"\b", new, s, flags=re.I)
    return re.sub(r"\s{2,}", " ", s).strip(" ,;")


def clean_list(lst, own):
    return [c for c in (clean_str(x, own) for x in (lst or [])) if c]


def still_leaks(enc_obj, own):
    blob = json.dumps(enc_obj).lower()
    return sorted({n for n, sl in NAME2SLUG.items() if sl != own and n in blob})


def dedup_extend(base, add):
    base = list(base or [])
    seen = {str(x).strip().lower() for x in base}
    for x in (add or []):
        if str(x).strip() and str(x).strip().lower() not in seen:
            base.append(x); seen.add(str(x).strip().lower())
    return base


report, touched = [], 0
for r in results:
    if not r or not r.get("enrichment"):
        report.append((r.get("slug", "?"), "no-enrichment", 0, "skip")); continue
    slug, enr, vd = r["slug"], r["enrichment"], (r.get("verdict") or {})
    # 1+2: clean every string
    for e in enr.get("encounters", []):
        for k in ("meta_loadout", "surges", "recommended_dps", "elemental_mods", "concussive_mods"):
            e[k] = clean_list(e.get(k), slug)
    # 3: policy gate
    leaks = still_leaks(enr, slug)
    nflags = len(vd.get("uncited_flags", []))
    if leaks:
        report.append((slug, vd.get("overall", "?"), 0, f"DEFER (residual leak {leaks})")); continue
    if nflags > MAX_FLAGS:
        report.append((slug, vd.get("overall", "?"), 0, f"DEFER ({nflags} uncited flags)")); continue

    src = {"tier": 1, "name": enr.get("source_name", ""), "url": enr.get("source_url", ""),
           "note": "current loadout/build guide (Pass 2/3, firecrawl)", "date_checked": DATE}
    n = 0
    for e in enr.get("encounters", []):
        m = glob.glob(os.path.join(HERE, "content", "*", slug, f"*-{e.get('encounter_slug')}.yaml"))
        if not m:
            continue
        doc = yaml.safe_load(open(m[0]))
        enc = doc.get("encounter", {})
        if e["meta_loadout"]:
            enc["meta_loadout"] = e["meta_loadout"]
        dmg = enc.setdefault("damage", {})
        if e["surges"]:
            dmg["surges"] = dedup_extend(dmg.get("surges"), e["surges"])
        if e["recommended_dps"]:
            dmg["recommended_dps"] = dedup_extend(dmg.get("recommended_dps"), e["recommended_dps"])
        mods = enc.setdefault("defense", {}).setdefault("recommended_defensive_mods", {})
        if e["elemental_mods"]:
            mods["elemental"] = dedup_extend(mods.get("elemental"), e["elemental_mods"])
        if e["concussive_mods"]:
            mods["concussive"] = dedup_extend(mods.get("concussive"), e["concussive_mods"])
        if any(e[k] for k in ("meta_loadout", "surges", "recommended_dps", "elemental_mods", "concussive_mods")):
            srcs = enc.setdefault("sources", [])
            if src["url"] and not any(isinstance(s, dict) and s.get("url") == src["url"] for s in srcs):
                srcs.append(src)
            n += 1; touched += 1
        header = "".join(l for l in open(m[0]) if l.startswith("#"))
        with open(m[0], "w") as f:
            f.write(header)
            yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)
    report.append((slug, vd.get("overall", "?"), n, "merged"))

print(f"=== ENRICHMENT MERGED — {touched} encounters enriched ===\n")
print(f"{'activity':24} {'verdict':16} {'enc':4} status")
for slug, ov, n, st in sorted(report, key=lambda x: (x[3] != "merged", x[0])):
    print(f"{slug:24} {str(ov):16} {n:<4} {st}")
PY = None
