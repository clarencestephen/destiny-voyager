#!/usr/bin/env python3
"""Split modifier-only content out of the NORMAL base encounters into separate
per-activity category subfolders (challenges / solo / epic / feats).

Rule (user): base raids/dungeons encounters hold NORMAL content ONLY. Anything
that applies only to a challenge / epic / solo / feat moves OUT into its folder,
reduplicating base context (order/slug/name/abstract) so it stands alone.
Idempotent: re-running won't re-extract (fields are removed from base).
"""
import os, glob, re, shutil, json, yaml

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(HERE, "content")
REG = json.load(open(os.path.join(HERE, "encounter_registry.json")))
SOLO_RE = re.compile(r"solo|underman|low-?man|duo|trio|2-?man|3-?man", re.I)


def lead_header(path):
    out = []
    for ln in open(path):
        if ln.startswith("#"):
            out.append(ln)
        else:
            break
    return "".join(out)


def dump(path, doc, header):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(header)
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True, width=100)


def act_header(doc, category):
    a = dict(doc.get("activity", {}))
    a["category"] = category
    return a


stats = {"challenges": 0, "solo": 0, "feats": 0, "epic_moved": 0}

# ---- 1. epic: move desert-perpetual-epic content under desert-perpetual/epic/
epic_src = os.path.join(CONTENT, "raids", "desert-perpetual-epic")
epic_dst = os.path.join(CONTENT, "raids", "desert-perpetual", "epic")
if os.path.isdir(epic_src) and not os.path.isdir(epic_dst):
    os.makedirs(os.path.dirname(epic_dst), exist_ok=True)
    shutil.move(epic_src, epic_dst)
    # stamp category + vs_base on the epic _activity
    ap = os.path.join(epic_dst, "_activity.yaml")
    if os.path.exists(ap):
        d = yaml.safe_load(open(ap))
        d.setdefault("activity", {})["category"] = "epic"
        d["activity"]["variant_of"] = "desert-perpetual"
        d["vs_base"] = ("Epic is a DISTINCT, harder version of The Desert Perpetual — NOT the normal raid. "
                        "It runs an 'Undoing' final round that revisits all three mid-bosses, adds the "
                        "Banished debuff (recover by activating an Oracle within ~39s before platforms vanish), "
                        "capsule/Chronon-colour alignment, destructible crystals gated by the Absolute Temporality "
                        "buff, and a Final-Stand DPS check. Same bosses, different mechanics and loot.")
        dump(ap, d, lead_header(ap))
    stats["epic_moved"] = 1

# ---- 2/3. per base activity: extract challenges + solo, create feats stub
for slug, a in REG.items():
    if slug == "desert-perpetual-epic":
        continue  # handled as epic
    sub = "raids" if a["activity_type"] == "raid" else "dungeons"
    base_dir = os.path.join(CONTENT, sub, slug)
    if not os.path.isdir(base_dir):
        continue
    for path in sorted(glob.glob(os.path.join(base_dir, "*-*.yaml"))):
        doc = yaml.safe_load(open(path))
        enc = doc.get("encounter", {})
        if not enc:
            continue
        ctx = {k: enc.get(k) for k in ("order", "slug", "name", "abstract") if enc.get(k) is not None}
        fname = os.path.basename(path)
        changed = False

        # --- challenges: extract master_challenge ---
        mc = enc.get("master_challenge")
        if mc and (mc.get("name") or mc.get("requirement")):
            cdoc = {
                "activity": act_header(doc, "challenge"),
                "encounter": {**ctx, "master_challenge": mc},
                "differs_from_base": (
                    f"Adds the '{mc.get('name', 'weekly')}' constraint on top of the normal encounter: "
                    f"{(mc.get('requirement') or '').strip()} On Master, every encounter's challenge is "
                    f"active simultaneously, plus Champions, surges/threat, and Adept loot."),
            }
            dump(os.path.join(base_dir, "challenges", fname), cdoc, lead_header(path))
            del enc["master_challenge"]
            stats["challenges"] += 1
            changed = True

        # --- solo: extract solo/underman permutations ---
        perms = enc.get("permutations") or []
        solo_perms = [p for p in perms if SOLO_RE.search(str(p.get("name", "")))]
        if solo_perms:
            sdoc = {
                "activity": act_header(doc, "solo"),
                "encounter": {**ctx, "permutations": solo_perms},
                "differs_from_base": ("Solo / low-man approach to this encounter — different role split and survival "
                                      "demands than the normal full-fireteam version. See the base encounter for "
                                      "standard mechanics."),
            }
            dump(os.path.join(base_dir, "solo", fname), sdoc, lead_header(path))
            enc["permutations"] = [p for p in perms if not SOLO_RE.search(str(p.get("name", "")))]
            stats["solo"] += 1
            changed = True

        if changed:
            dump(path, doc, lead_header(path))

    # --- feats stub (per activity) ---
    feats_path = os.path.join(base_dir, "feats", "_feats.yaml")
    if not os.path.exists(feats_path):
        dump(feats_path, {
            "activity": {"slug": slug, "name": a["name"], "activity_type": a["activity_type"], "category": "feats"},
            "feats": [],
            "note": "Triumphs / special accomplishments (flawless, solo-flawless, day-one, secret triumphs, "
                    "collectibles). To be populated.",
        }, f"# {sub}/{slug}/feats/_feats.yaml — feats/triumphs (separate category)\n\n")
        stats["feats"] += 1

# ---- 4. registry: stamp category + content_path
for slug, a in REG.items():
    sub = "raids" if a["activity_type"] == "raid" else "dungeons"
    if slug == "desert-perpetual-epic":
        a["category"] = "epic"
        a["variant_of"] = "desert-perpetual"
        a["content_path"] = f"raid_context/content/raids/desert-perpetual/epic/"
    else:
        a.setdefault("category", "base")
        a["content_path"] = f"raid_context/content/{sub}/{slug}/"
json.dump(REG, open(os.path.join(HERE, "encounter_registry.json"), "w"), indent=2)

print("=== RESTRUCTURE DONE ===")
for k, v in stats.items():
    print(f"  {k}: {v}")
