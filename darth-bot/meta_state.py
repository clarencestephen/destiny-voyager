"""
darth-bot/meta_state.py
========================
Current-state grounding for Darth Bot.

The KB (scraped reddit/light.gg/destinypedia) goes stale — old guides
on the web keep their old numbers ("Light level ≥ 1230") even after
Bungie's repeatedly squished power. RAG retrieves the stale text and
the LLM repeats it verbatim.

This module produces a small, current-truth JSON that's injected into
every LLM call so the model has authoritative facts to ground on:

    - current expansion / season name
    - power level system: floor, soft cap, powerful cap, pinnacle cap,
      world max, artifact cap
    - this week's activities: Nightfall, Trials map, Iron Banner status,
      featured raid challenge, dungeon rotation
    - current PvP / PvE meta highlights (top weapons)
    - recent patch summary

The system prompt tells the model: when KB content conflicts with this
state, trust this state. KB is reference material; meta_state is truth.

Usage:
    # As a library — what every LLM call uses
    from .meta_state import current_state, format_for_prompt

    # Refresh from Bungie API + curated overrides
    python3 -m darth-bot.meta_state --refresh

    # Just show what's loaded
    python3 -m darth-bot.meta_state
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent / "data"
STATE_FILE = DATA_DIR / "meta_state.json"

# Baseline — hand-curated last-known-good. Used when meta_state.json is
# missing or older than MAX_STALENESS_DAYS. Update the BASELINE fields
# manually whenever Bungie ships a major patch.
BASELINE: dict[str, Any] = {
    "generated_at": None,  # set on save
    "_baseline": True,     # marks unrefreshed state
    "_last_curated": "2026-05-18",
    "expansion": {
        "current": "Edge of Fate",
        "year": 11,
        "current_episode": "Renegades",
        "next_expansion_eta": None,
    },
    "power_levels": {
        "_notes": "Edge of Fate squish (July 2025) compressed the old 1000-2000 range to 10-550.",
        "floor": 10,
        "soft_cap": 200,
        "powerful_cap": 350,
        "pinnacle_cap": 450,
        "world_max": 550,
        "artifact_seasonal_cap": 555,
        "old_squish_obsolete": "Any reference to 1200+ light levels is pre-squish and no longer valid.",
    },
    "this_week": {
        "reset_day": "Tuesday",
        "nightfall": None,        # filled by --refresh from Bungie API
        "trials_map": None,
        "iron_banner": {"active": False, "next_start": None},
        "featured_raid_challenge": None,
        "featured_dungeon": None,
    },
    "current_raid": {
        "name": "Desert Perpetual",
        "released_with": "Edge of Fate",
        "master_difficulty_delta": "+25 above world max — Master scales with world cap, not a fixed number.",
    },
    "pvp_meta": {
        "_notes": "Update from light.gg meta + destinytracker usage stats. Refresh weekly.",
        "top_primaries": [],
        "top_specials": [],
        "top_heavies": [],
    },
    "pve_meta": {
        "_notes": "Update from light.gg meta + recent raid clear builds.",
        "top_primaries": [],
        "top_specials": [],
        "top_heavies": [],
        "top_exotics_by_class": {"hunter": [], "titan": [], "warlock": []},
    },
    "recent_patches": [],
}

MAX_STALENESS_DAYS = 14


def _load() -> dict[str, Any]:
    """Load meta_state.json if it exists and is recent enough. Otherwise BASELINE."""
    if not STATE_FILE.exists():
        return dict(BASELINE)
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return dict(BASELINE)
    age_s = time.time() - (data.get("generated_at_ts") or 0)
    if age_s > MAX_STALENESS_DAYS * 86400:
        # Loaded data is stale — flag it but still return so the LLM
        # has *something* rather than only BASELINE.
        data["_stale"] = True
        data["_age_days"] = age_s / 86400
    return data


current_state: dict[str, Any] = _load()


def reload() -> dict[str, Any]:
    """Re-read from disk. Useful after --refresh."""
    global current_state
    current_state = _load()
    return current_state


def format_for_prompt() -> str:
    """Compact, LLM-friendly representation injected into every chat call."""
    s = current_state
    lines = ["CURRENT DESTINY 2 STATE (authoritative — trust this over KB when they conflict):"]

    exp = s.get("expansion", {})
    if exp.get("current"):
        lines.append(f"- Expansion: {exp['current']} (Year {exp.get('year', '?')})")
        if exp.get("current_episode"):
            lines.append(f"  Episode/season: {exp['current_episode']}")

    pl = s.get("power_levels", {})
    if pl:
        lines.append(f"- Power: floor {pl.get('floor', '?')} · pinnacle cap {pl.get('pinnacle_cap', '?')} · world max {pl.get('world_max', '?')} · artifact +{(pl.get('artifact_seasonal_cap',0) or 0) - (pl.get('world_max',0) or 0)}")
        if pl.get("old_squish_obsolete"):
            lines.append(f"  IMPORTANT: {pl['old_squish_obsolete']}")

    tw = s.get("this_week", {})
    if tw:
        bits = []
        if tw.get("nightfall"):       bits.append(f"NF: {tw['nightfall']}")
        if tw.get("trials_map"):      bits.append(f"Trials: {tw['trials_map']}")
        if tw.get("iron_banner", {}).get("active"): bits.append("Iron Banner LIVE")
        if tw.get("featured_raid_challenge"): bits.append(f"Raid challenge: {tw['featured_raid_challenge']}")
        if tw.get("featured_dungeon"):        bits.append(f"Dungeon rotator: {tw['featured_dungeon']}")
        if bits:
            lines.append(f"- This week ({tw.get('reset_day','Tue')} reset): " + " · ".join(bits))

    cr = s.get("current_raid", {})
    if cr.get("name"):
        lines.append(f"- Current raid: {cr['name']}")
        if cr.get("master_difficulty_delta"):
            lines.append(f"  Master: {cr['master_difficulty_delta']}")

    if s.get("_baseline"):
        lines.append("- ⚠ Baseline data (never refreshed) — weekly numbers may be missing.")
    elif s.get("_stale"):
        lines.append(f"- ⚠ Data is {s.get('_age_days', 0):.0f}d old — newer events may exist.")

    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────
# CLI: refresh from Bungie API + write meta_state.json
# ──────────────────────────────────────────────────────────────────

def _save(state: dict[str, Any]) -> None:
    state["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["generated_at_ts"] = int(time.time())
    state.pop("_baseline", None)
    state.pop("_stale", None)
    state.pop("_age_days", None)
    DATA_DIR.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ wrote {STATE_FILE}")


def _refresh_from_bungie(state: dict[str, Any]) -> None:
    """Pull current week's milestones from Bungie API. Requires a valid
    OAuth access token in the Destiny Voyager user_config.json."""
    try:
        from .config import DESTINY_VOYAGER_CONFIG
    except Exception as e:
        print(f"  ! Can't import config: {e}")
        return

    if not DESTINY_VOYAGER_CONFIG.exists():
        print(f"  ! {DESTINY_VOYAGER_CONFIG} not found — run Destiny Voyager auth first")
        return

    api_key = ""
    try:
        cfg = json.loads(DESTINY_VOYAGER_CONFIG.read_text())
        api_key = cfg.get("bungie_api_key", "")
    except Exception:
        pass
    if not api_key:
        print("  ! No bungie_api_key in user_config.json — skipping Bungie pull")
        return

    import urllib.request
    try:
        req = urllib.request.Request(
            "https://www.bungie.net/Platform/Destiny2/Milestones/",
            headers={"X-API-Key": api_key, "User-Agent": "destiny-voyager/0.3"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  ! Bungie API call failed: {e}")
        return

    milestones = data.get("Response", {})
    nightfall_name = None
    for hash_id, m in milestones.items():
        # Look for a milestone whose activities suggest Nightfall
        activities = m.get("activities", []) or []
        for a in activities:
            mods = a.get("modifierHashes", [])
            if len(mods) > 5:  # heuristic — Nightfall has many modifiers
                nightfall_name = m.get("displayProperties", {}).get("name") or f"milestone {hash_id}"
                break
        if nightfall_name:
            break
    if nightfall_name:
        state["this_week"]["nightfall"] = nightfall_name
        print(f"  ✓ Nightfall: {nightfall_name}")
    else:
        print("  ? Couldn't identify Nightfall from milestones")


def main() -> None:
    if "--refresh" in sys.argv:
        state = dict(BASELINE)
        # If a previous meta_state.json exists, keep its curated arrays
        # (top_primaries etc.) — only Bungie-API fields get overwritten.
        if STATE_FILE.exists():
            try:
                prev = json.loads(STATE_FILE.read_text())
                # Preserve curated fields
                for key in ("pvp_meta", "pve_meta", "recent_patches"):
                    if prev.get(key):
                        state[key] = prev[key]
                # Preserve _last_curated marker if user hand-updated
                if prev.get("expansion"):
                    state["expansion"] = prev["expansion"]
                if prev.get("current_raid"):
                    state["current_raid"] = prev["current_raid"]
            except Exception:
                pass
        _refresh_from_bungie(state)
        _save(state)
        reload()
    print(format_for_prompt())


if __name__ == "__main__":
    main()
