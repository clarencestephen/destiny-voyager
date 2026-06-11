"""
darth-bot/weapons.py
====================
Weapon + perk lookup for Darth Bot's /weapon and /perk commands. Reads the same
baked data the web app uses (web/public/weapons.json + perks.json) so there's a
single source of truth.

Data: Bungie manifest + DIM season enums (weapons) · Clarity (perk descriptions).
See /credits.
"""
from __future__ import annotations

import functools
import json
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "web" / "public"

# Heuristic column labels for the common random-roll layouts.
_LABELS = {
    5: ["Barrel", "Magazine", "Trait 1", "Trait 2", "Origin"],
    4: ["Barrel", "Magazine", "Trait 1", "Trait 2"],
}


@functools.lru_cache(maxsize=1)
def _weapons() -> list[dict]:
    raw = json.loads((_DATA / "weapons.json").read_text())
    return [{"hash": h, **v} for h, v in raw.items()]


@functools.lru_cache(maxsize=1)
def _perks() -> dict:
    try:
        return json.loads((_DATA / "perks.json").read_text())
    except Exception:
        return {}


@functools.lru_cache(maxsize=1)
def _wishrolls() -> dict:
    """DIM community god-roll wishlist (voltron), baked → wishrolls.json."""
    try:
        return json.loads((_DATA / "wishrolls.json").read_text())
    except Exception:
        return {"rolls": {}, "perkPop": {}}


def god_roll(weapon: dict) -> dict | None:
    """Per-column god-roll perks for a weapon, by mode — intersect the community
    wishlist's recommended perks with the weapon's actual perk columns."""
    wr = _wishrolls().get("rolls", {}).get(str(weapon["hash"]))
    if not wr:
        return None
    cols = weapon.get("columns", [])

    def resolve(perk_hashes):
        ps = {int(p) for p in perk_hashes}
        return [[p["n"] for p in col if p["h"] in ps] for col in cols]  # per-column (may be empty)

    pve, pvp = resolve(wr.get("pve", [])), resolve(wr.get("pvp", []))
    if not any(pve) and not any(pvp):
        return None
    return {"pve": pve, "pvp": pvp}


def _live(w: dict) -> bool:
    """A weapon with current rolls or a craftable recipe (vs a sunset copy)."""
    return bool(w.get("craftable")) or any(
        p.get("c") for col in w.get("columns", []) for p in col
    )


def find_weapons(name: str, limit: int = 5) -> list[dict]:
    """Best-match weapons for a name: exact → starts-with → contains, with
    'live' (currently-obtainable / craftable) copies preferred within each tier."""
    q = name.lower().strip()
    if not q:
        return []
    items = _weapons()
    exact = [w for w in items if w["n"].lower() == q]
    starts = [w for w in items if w["n"].lower().startswith(q) and w not in exact]
    contains = [w for w in items if q in w["n"].lower() and w not in exact and w not in starts]
    key = lambda w: not _live(w)  # noqa: E731 — live weapons sort first
    return (sorted(exact, key=key) + sorted(starts, key=key) + sorted(contains, key=key))[:limit]


def column_label(n_cols: int, i: int) -> str:
    labels = _LABELS.get(n_cols)
    return labels[i] if labels and i < len(labels) else f"Perk {i + 1}"


def perk_desc(perk_hash) -> str:
    return _perks().get(str(perk_hash), {}).get("d", "")


def find_perk(name: str) -> dict | None:
    """Best-match perk by name from Clarity data."""
    q = name.lower().strip()
    if not q:
        return None
    p = _perks()
    exact = [v for v in p.values() if v.get("n", "").lower() == q]
    if exact:
        return exact[0]
    contains = [v for v in p.values() if q in v.get("n", "").lower()]
    return contains[0] if contains else None
