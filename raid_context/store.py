"""
destiny-raid-context · retrieval engine (dependency-light, framework-free).

This is the isolation core. Every public function returns content for AT MOST
ONE activity / ONE encounter, selected by KEY — never by similarity search —
so a Verity request can never surface Last Wish (or any other encounter).

The MCP server (server.py) is a thin wrapper over these functions.
"""
from __future__ import annotations
import json
import os
import re
from functools import lru_cache

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
TK = os.path.dirname(HERE)  # destiny2-loadout-toolkit
REGISTRY_PATH = os.path.join(HERE, "encounter_registry.json")
CONTENT = os.path.join(HERE, "content")

# resource-folder typos already seen, plus common community nicknames -> slug
ACTIVITY_ALIASES = {
    "se": "salvations-edge", "salvation": "salvations-edge", "salvations": "salvations-edge",
    "edge": "salvations-edge", "witness raid": "salvations-edge",
    "ron": "root-of-nightmares", "root": "root-of-nightmares",
    "dsc": "deep-stone-crypt", "deepstone": "deep-stone-crypt",
    "kf": "kings-fall", "kings fall": "kings-fall",
    "vog": "vault-of-glass", "vault": "vault-of-glass",
    "votd": "vow-of-the-disciple", "vow": "vow-of-the-disciple",
    "lw": "last-wish", "wish": "last-wish",
    "gos": "garden-of-salvation", "garden": "garden-of-salvation",
    "crota": "crotas-end", "ce": "crotas-end",
    "dp": "desert-perpetual", "desert": "desert-perpetual",
    "warlords": "warlords-ruin", "wr": "warlords-ruin",
    "ghosts": "ghosts-of-the-deep", "gotd": "ghosts-of-the-deep",
    "spire": "spire-of-the-watcher", "sotw": "spire-of-the-watcher",
    "sundered": "sundered-doctrine", "sd": "sundered-doctrine",
    "grasp": "grasp-of-avarice", "goa": "grasp-of-avarice",
    "pit": "pit-of-heresy", "poh": "pit-of-heresy",
    "throne": "shattered-throne", "st": "shattered-throne",
}


@lru_cache(maxsize=1)
def registry() -> dict:
    with open(REGISTRY_PATH) as f:
        return json.load(f)


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9 ]", "", str(s if s is not None else "").lower()).strip()


class NotFound(Exception):
    pass


# ----------------------------------------------------------------- identify
def identify_activity(query: str) -> dict:
    """Map a free-text query to ONE activity. Deterministic; no LLM."""
    reg = registry()
    q = _norm(query)
    # 1. exact slug / alias
    qslug = q.replace(" ", "-")
    if qslug in reg:
        return _hit(reg[qslug], 1.0)
    if q in ACTIVITY_ALIASES:
        return _hit(reg[ACTIVITY_ALIASES[q]], 0.97)
    # 2. alias as a whole word (multi-word aliases match as a phrase) —
    #    prevents short aliases like "st" matching inside "ho-st".
    qtokens = set(q.split())
    for alias, slug in ACTIVITY_ALIASES.items():
        if (alias in q) if " " in alias else (alias in qtokens):
            return _hit(reg[slug], 0.9)
    # 3. display-name / slug token overlap
    best, score = None, 0.0
    for slug, a in reg.items():
        name_tokens = set(_norm(a["name"]).split()) | set(slug.split("-"))
        overlap = len(qtokens & name_tokens)
        if overlap > score:
            best, score = a, overlap
    if best and score > 0:
        return _hit(best, min(0.6 + 0.15 * score, 0.95))
    raise NotFound(f"no activity matched '{query}'")


def _hit(a: dict, conf: float) -> dict:
    return {"slug": a["slug"], "name": a["name"], "activity_type": a["activity_type"],
            "fireteam_size": a["fireteam_size"], "encounter_count": a["encounter_count"],
            "confidence": round(conf, 2)}


def identify_encounter(query: str, slug: str | None = None) -> dict:
    """Find ONE encounter, optionally scoped to an activity slug."""
    reg = registry()
    q = _norm(query)
    scopes = [reg[slug]] if slug and slug in reg else reg.values()
    best, score = None, 0
    for a in scopes:
        for e in a["encounters"]:
            cand = set(_norm(e.get("name", "")).split()) | set((e.get("slug") or "").split("-"))
            if e.get("ingame_name"):
                cand |= set(_norm(e["ingame_name"]).split())
            ov = len(set(q.split()) & cand)
            # also direct slug containment
            if e.get("slug") and e["slug"].replace("-", " ") in q:
                ov += 3
            if ov > score:
                best, score = (a, e), ov
    if not best:
        raise NotFound(f"no encounter matched '{query}'")
    a, e = best
    return {"activity_slug": a["slug"], "activity_type": a["activity_type"],
            "order": e["order"], "encounter_slug": e["slug"], "name": e["name"],
            "confidence": round(min(0.5 + 0.15 * score, 0.97), 2)}


def list_encounters(slug: str) -> list:
    reg = registry()
    if slug not in reg:
        raise NotFound(f"unknown activity '{slug}'")
    return [{"order": e["order"], "slug": e["slug"], "name": e["name"]} for e in reg[slug]["encounters"]]


# ----------------------------------------------------------------- retrieve (keyed)
def _resolve_encounter(slug: str, encounter: str) -> dict:
    reg = registry()
    if slug not in reg:
        raise NotFound(f"unknown activity '{slug}'")
    for e in reg[slug]["encounters"]:
        if e["slug"] == encounter or str(e["order"]) == str(encounter) or _norm(e["name"]) == _norm(encounter):
            return e
    raise NotFound(f"'{encounter}' is not an encounter of '{slug}'")


def _v3_path(slug: str, activity_type: str, order, enc_slug: str) -> str:
    sub = "raids" if activity_type == "raid" else "dungeons"
    return os.path.join(CONTENT, sub, slug, f"{order}-{enc_slug}.yaml")


def get_encounter(slug: str, encounter: str) -> dict:
    """Return EXACTLY ONE encounter. Prefers the authored v3 file; falls back to
    the v2 monolith, extracting only this encounter's block. Guaranteed single."""
    reg = registry()
    a = reg[slug] if slug in reg else None
    if not a:
        raise NotFound(f"unknown activity '{slug}'")
    e = _resolve_encounter(slug, encounter)
    p = _v3_path(slug, a["activity_type"], e["order"], e["slug"])
    if os.path.exists(p):
        with open(p) as f:
            doc = yaml.safe_load(f)
        doc["_source"] = "v3"
        _assert_isolation(doc, slug, e["slug"])
        return doc
    # v2 fallback — extract just this encounter
    with open(os.path.join(TK, a["yaml"])) as f:
        v2 = yaml.safe_load(f)
    block = next((x for x in v2.get("encounters", []) if x.get("slug") == e["slug"]), None)
    if block is None:
        raise NotFound(f"encounter block '{e['slug']}' missing in {a['yaml']}")
    doc = {
        "activity": {"slug": slug, "name": a["name"], "activity_type": a["activity_type"],
                     "fireteam_size": a["fireteam_size"]},
        "encounter": block,
        "_source": "v2-fallback",
    }
    _assert_isolation(doc, slug, e["slug"])
    return doc


def _assert_isolation(doc: dict, slug: str, enc_slug: str):
    """Hard guarantee: the returned doc is the requested activity + encounter, alone."""
    assert doc["activity"]["slug"] == slug, "activity isolation breach"
    assert doc["encounter"]["slug"] == enc_slug, "encounter isolation breach"


def get_role(slug: str, encounter: str, role_id: str) -> dict:
    doc = get_encounter(slug, encounter)
    for perm in doc["encounter"].get("permutations", []):
        for role in perm.get("roles", []):
            if _norm(str(role.get("id", ""))) == _norm(role_id) or _norm(role_id) in _norm(str(role.get("id", ""))):
                return {"permutation": perm.get("name"), "role": role}
    raise NotFound(f"role '{role_id}' not found in {slug}/{encounter}")


def get_overview(slug: str) -> dict:
    reg = registry()
    if slug not in reg:
        raise NotFound(f"unknown activity '{slug}'")
    a = reg[slug]
    actpath = os.path.join(CONTENT, "raids" if a["activity_type"] == "raid" else "dungeons", slug, "_activity.yaml")
    if os.path.exists(actpath):
        with open(actpath) as f:
            return yaml.safe_load(f)
    with open(os.path.join(TK, a["yaml"])) as f:
        v2 = yaml.safe_load(f)
    return {"activity": {"slug": slug, "name": a["name"], "activity_type": a["activity_type"]},
            "overview": v2.get("overview", {}), "overall_notes": v2.get("overall_notes", [])}
