"""
darth-bot/router.py
===================
Classify the user question and decide which context layers to pull.
Then assemble the LLM call.

Classifier is a tiny rule-based first pass — fast, cheap, deterministic.
Keywords-based for now; can swap to a small classifier model later.

Tested against the canonical question set:
  - "How do I get crimson catalyst?"          → quest    → KB + manifest
  - "What is a good pvp build with my…?"      → build    → inventory + KB
  - "What should I do next?"                  → advisory → inventory + KB
  - "How do I raise my light level…?"         → grind    → search + KB
  - "I need more enhanced cores…"             → grind    → search + KB
  - "summarize Salvation's edge encounters"   → raid     → KB
  - "Easiest solo ops map?"                   → meta     → search
  - "How do I become better at raiding?"      → general  → KB
  - "Why do I keep dying?"                    → diagnostic → ask follow-up
  - "How do I learn how to jump better?"      → mechanic → KB + general
  - "Is there an all black shader?"           → cosmetic → manifest + search
  - "How do I get Conditional Finality?"      → quest    → KB + search
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from typing import Set

# Make the sibling `raid_context` package importable in BOTH runtimes (the
# Discord bot runs from darth-bot/; the FastAPI backend puts darth-bot/ on
# sys.path). Neither puts the repo root on the path, so add it here.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


@dataclass
class Plan:
    category: str
    use_inventory: bool = False
    inventory_focus: str = "all"
    use_kb: bool = True
    use_search: bool = False
    use_manifest: bool = False
    ask_clarifying: str | None = None
    notes: Set[str] = field(default_factory=set)


_KW = {
    "build": re.compile(
        r"\b(build|loadout|setup|equip|run with|pair with|good with|best.*for)\b", re.I),
    "pvp":   re.compile(r"\b(pvp|crucible|trials|comp|competitive|iron banner)\b", re.I),
    "pve":   re.compile(r"\b(pve|raid|dungeon|nightfall|gm|grandmaster|onslaught)\b", re.I),
    "personal": re.compile(
        r"\b(my|i have|i own|i got|my (current|gear|weapons|build))\b", re.I),
    "quest": re.compile(
        r"\b(how (do|to) (i )?(get|unlock|obtain|farm|complete)|catalyst|exotic mission|quest)\b",
        re.I),
    "meta": re.compile(
        r"\b(current|this week|right now|right-now|weekly|nightfall this week|featured|rotation|easiest)\b",
        re.I),
    # Note: apostrophes are normalized in classify() before matching, so
    # `'?` here only needs to handle straight-apostrophe variants.
    "raid_name": re.compile(
        r"\b(salvation'?s edge|root of nightmares|vow of the disciple|deep stone crypt|"
        r"garden of salvation|last wish|king'?s? fall|vault of glass|crota'?s end|"
        r"desert perpetual)\b", re.I),
    "encounter": re.compile(
        r"\b(encounter|boss|mechanic|callout|wipe|first encounter|final boss)\b", re.I),
    "grind": re.compile(
        r"\b(grind|farm|level up|light level|power level|enhanced cores?|prisms?|ascendant)\b",
        re.I),
    "diagnostic": re.compile(r"\b(why (am|do) i|why does my|i keep)\b", re.I),
    "mechanic": re.compile(
        r"\b(jump|movement|aim assist|recoil|stat|stats|stat tier|tiers|how (does|do))\b",
        re.I),
    "cosmetic": re.compile(
        r"\b(shader|ornament|emblem|ghost shell|sparrow|ship|fashion|transmog)\b", re.I),
    "non_destiny": re.compile(
        r"\b(weather|recipe|movie|stock|crypto|sports|election|coding)\b", re.I),
}


def classify(question: str) -> Plan:
    """Decide which layers to pull. Cheap heuristic, no LLM call."""
    # Normalize typographic apostrophes so "King's Fall" matches the
    # raid_name regex regardless of which apostrophe glyph the user typed.
    q = question.strip().replace("’", "'").replace("‘", "'")
    is_personal = bool(_KW["personal"].search(q))

    # Diagnostic — ask follow-up rather than guess
    if _KW["diagnostic"].search(q):
        return Plan(
            category="diagnostic",
            ask_clarifying=(
                "Real quick — is this in **PvE** (Crucible/Trials) or **PvP**? "
                "And what subclass + exotic are you running? "
                "(I'll give you a sharper answer once I know.)"
            ),
        )

    if _KW["non_destiny"].search(q):
        return Plan(
            category="off-topic",
            use_kb=False,
            ask_clarifying="I only do Destiny. Try one of the other channels for that.",
        )

    # Cosmetic lookup
    if _KW["cosmetic"].search(q):
        return Plan(
            category="cosmetic",
            use_manifest=True,
            use_kb=True,
            use_search=True,
        )

    # Quest / catalyst
    if _KW["quest"].search(q):
        return Plan(
            category="quest",
            use_kb=True,
            use_manifest=True,
            use_search=True,  # quest paths change with seasons
        )

    # Raid encounter — mechanics are stable but availability, reprise
    # status, and seasonal modifiers shift. Search supplements the KB.
    # The keyed store is also consulted so a bare encounter name ("how do
    # I do verity") routes to the isolated walkthrough path, not "mechanic".
    if _KW["raid_name"].search(q) or _KW["encounter"].search(q) or _store_raid_match(q):
        plan = Plan(
            category="raid",
            use_kb=True,
            use_search=True,
            use_manifest=True,
        )
        # Raid walkthroughs need more KB coverage than the default — a
        # 6-chunk top_k bias toward the final boss name (the question
        # usually contains the raid title) and starves the other
        # encounters. Mark the plan so the orchestrator pulls more.
        plan.notes.add("raid_walkthrough")
        return plan

    # Build (personalized)
    if _KW["build"].search(q):
        focus = "pvp" if _KW["pvp"].search(q) else ("pve" if _KW["pve"].search(q) else "all")
        return Plan(
            category="build",
            use_inventory=is_personal,
            inventory_focus=focus,
            use_kb=True,
            use_search=_KW["meta"].search(q) is not None,
        )

    # Grind / light level / cores
    if _KW["grind"].search(q):
        return Plan(
            category="grind",
            use_kb=True,
            use_search=True,
        )

    # Meta / weekly
    if _KW["meta"].search(q):
        return Plan(
            category="meta",
            use_kb=True,
            use_search=True,
        )

    # Mechanic ("jump better", "how do stats work")
    if _KW["mechanic"].search(q):
        return Plan(
            category="mechanic",
            use_kb=True,
            use_search=False,
        )

    # "What should I do next?" — advisory, leverage inventory
    if "next" in q.lower() or "what should i" in q.lower():
        return Plan(
            category="advisory",
            use_inventory=True,
            use_kb=True,
            use_search=True,
        )

    # Default — general Destiny knowledge
    return Plan(
        category="general",
        use_kb=True,
        use_search=False,
    )


# ============================================================
# Raid/dungeon context — KEYED, isolated (raid_context.store)
# ============================================================


def _store_raid_match(q: str) -> bool:
    """True if the keyed store confidently recognizes a raid/dungeon activity
    OR a specific encounter in the query. Lets bare encounter names (e.g.
    'how do I do verity') route to the isolated walkthrough path. Never raises."""
    try:
        from raid_context.store import identify_activity, identify_encounter
    except Exception:
        return False
    try:
        if identify_activity(q).get("confidence", 0) >= 0.6:
            return True
    except Exception:
        pass
    try:
        if identify_encounter(q).get("confidence", 0) >= 0.7:
            return True
    except Exception:
        pass
    return False


def _collect_loadouts(enc: dict) -> list[str]:
    """Per-role loadout lines from any of the v3 shapes (role_loadouts /
    roles[] / permutations[].roles[].loadout). Skips blank fields."""
    def fmt(rid, lo):
        parts = []
        if lo.get("subclass"):
            parts.append(f"subclass {lo['subclass']}")
        w = lo.get("weapons")
        if isinstance(w, dict):
            w = "; ".join(f"{k}: {v}" for k, v in w.items() if v)
        if w:
            parts.append(f"weapons {w}")
        if lo.get("exotic_armor"):
            parts.append(f"exotic {lo['exotic_armor']}")
        if lo.get("armor_stats"):
            parts.append("stats " + "/".join(lo["armor_stats"]))
        if lo.get("surges_mods"):
            parts.append(str(lo["surges_mods"]))
        return f"- {rid}: " + "; ".join(parts) if parts else ""

    lines: list[str] = []
    for r in (enc.get("role_loadouts") or []):
        ln = fmt(r.get("role_id", "role"), r)
        if ln:
            lines.append(ln)
    if not lines:
        for r in (enc.get("roles") or []):
            ln = fmt(r.get("id") or r.get("role_id", "role"), r.get("loadout") or r)
            if ln:
                lines.append(ln)
    if not lines:
        for perm in (enc.get("permutations") or []):
            for r in (perm.get("roles") or []):
                if r.get("loadout"):
                    ln = fmt(r.get("id", "role"), r["loadout"])
                    if ln:
                        lines.append(ln)
    return lines


def _fmt_encounter_doc(doc: dict) -> str:
    """Render ONE store encounter doc into ORGANIZED, ATTRIBUTED plaintext —
    consistent labeled blocks + a SOURCES section so the model can cite."""
    enc = doc.get("encounter", {})
    out: list[str] = []
    if enc.get("abstract"):
        out.append(str(enc["abstract"]).strip())
    if enc.get("plain_language_steps"):
        out.append("STEPS:\n" + "\n".join(f"- {s}" for s in enc["plain_language_steps"]))
    if enc.get("mechanics"):
        out.append("MECHANICS:\n" + "\n".join(f"- {m}" for m in enc["mechanics"]))
    strategies = enc.get("strategies") or enc.get("boss_strategies") or []
    if strategies:
        slines = []
        for s in strategies:
            if isinstance(s, dict):
                slines.append(f"• {s.get('name', '')}: {s.get('summary', '')}")
                for st in (s.get("steps") or []):
                    slines.append(f"    - {st}")
        if slines:
            out.append("STRATEGIES (more than one valid solution):\n" + "\n".join(slines))
    roles_bd = enc.get("role_breakdown") or enc.get("boss_roles") or []
    if roles_bd:
        rl = [f"- {r.get('role', '')} (x{r.get('count', '')}): {r.get('does', '')}"
              for r in roles_bd if isinstance(r, dict)]
        if rl:
            out.append("ROLE BREAKDOWN (per player):\n" + "\n".join(rl))
    cl = [f"- {(c.get('say') or '').strip()}" + (f" — {c['why'].strip()}" if c.get("why") else "")
          for c in (enc.get("callouts") or []) if isinstance(c, dict) and c.get("say")]
    if cl:
        out.append("CALLOUTS:\n" + "\n".join(cl))
    if enc.get("wipe_triggers"):
        out.append("WIPE TRIGGERS:\n" + "\n".join(f"- {w}" for w in enc["wipe_triggers"]))
    loadouts = _collect_loadouts(enc)
    if loadouts:
        out.append("LOADOUTS BY ROLE:\n" + "\n".join(loadouts))
    if enc.get("meta_loadout"):
        out.append("META LOADOUT (sourced — current build guide):\n"
                   + "\n".join(f"- {m}" for m in enc["meta_loadout"]))
    dfn = enc.get("defense") or {}
    if dfn.get("champions"):
        out.append("CHAMPIONS:\n" + "\n".join(f"- {c}" for c in dfn["champions"]))
    mods = (dfn.get("recommended_defensive_mods") or {})
    dmod = [f"- {m}" for m in (mods.get("elemental") or [])] + [f"- {m}" for m in (mods.get("concussive") or [])]
    if dmod:
        out.append("DEFENSIVE MODS:\n" + "\n".join(dmod))
    dmg = enc.get("damage") or {}
    dl = []
    if dmg.get("surges"):
        dl.append("Surges: " + "; ".join(dmg["surges"]))
    if dmg.get("burst_windows"):
        dl.append("Window: " + str(dmg["burst_windows"]))
    if dmg.get("recommended_dps"):
        dl.append("DPS: " + "; ".join(dmg["recommended_dps"]))
    if dl:
        out.append("DAMAGE:\n" + "\n".join(f"- {x}" for x in dl))
    rw = enc.get("rewards")
    if isinstance(rw, dict):
        rw = rw.get("guaranteed") or []
    if rw:
        out.append("REWARDS:\n" + "\n".join(f"- {r}" for r in rw))
    srcs = [f"- [tier {s.get('tier', '?')}] {s.get('name', '')}" + (f" — {s['note']}" if s.get("note") else "")
            for s in (enc.get("sources") or []) if isinstance(s, dict)]
    if srcs:
        out.append("SOURCES (attribution — cite these, credit the author):\n" + "\n".join(srcs))
    return "\n\n".join(out).strip()


def raid_context_from_store(question: str):
    """Deterministic, KEYED raid/dungeon context. Returns a formatted
    per-encounter walkthrough (one activity only, isolation enforced by the
    store's _assert_isolation) or None so the caller falls back. Never raises."""
    try:
        from raid_context.store import (
            identify_activity, identify_encounter, list_encounters, get_encounter,
        )
    except Exception as e:
        print(f"[router] raid_context import failed: {e}")
        return None

    def _encounter_block(slug, enc_slug, order, name, header):
        try:
            body = _fmt_encounter_doc(get_encounter(slug, enc_slug))
        except Exception as e:
            print(f"[router] get_encounter({slug}/{enc_slug}): {e}")
            return None
        return f"{header}\n\n## ENCOUNTER {order} — {name}\n{body}" if body else None

    # Resolve the activity. If the query names ONLY an encounter (no raid
    # title, e.g. "how do I do verity"), find its activity via the encounter
    # and serve just that one — still keyed and isolated.
    slug = act_name = act_type = None
    try:
        a = identify_activity(question)
        if a.get("confidence", 0) >= 0.6:
            slug, act_name, act_type = a["slug"], a["name"], a["activity_type"]
    except Exception:
        pass

    if slug is None:
        try:
            ie = identify_encounter(question)
        except Exception:
            return None
        if ie.get("confidence", 0) < 0.7:
            return None
        try:
            am = get_encounter(ie["activity_slug"], ie["encounter_slug"]).get("activity", {})
        except Exception:
            return None
        header = (f"## ACTIVITY — {am.get('name', ie['activity_slug'])} "
                  f"({am.get('activity_type', '')}) [keyed · isolated · single-activity]")
        return _encounter_block(ie["activity_slug"], ie["encounter_slug"], ie["order"], ie["name"], header)

    header = (f"## ACTIVITY — {act_name} ({act_type}) "
              f"[keyed · isolated · single-activity]")

    # If the query names a SPECIFIC encounter within the activity, serve ONLY
    # that one — people ask per-encounter ("verity"), not for the whole raid.
    try:
        ie = identify_encounter(question, slug)
    except Exception:
        ie = None
    if ie and ie.get("confidence", 0) >= 0.7:
        block = _encounter_block(slug, ie["encounter_slug"], ie["order"], ie["name"], header)
        if block:
            return block

    # Otherwise serve every encounter of the (single) activity.
    try:
        encs = list_encounters(slug)
    except Exception:
        return None
    sections = []
    for enc in encs:
        block_body = None
        try:
            block_body = _fmt_encounter_doc(get_encounter(slug, enc["name"]))
        except Exception as e:
            print(f"[router] get_encounter({slug}/{enc['name']}): {e}")
            continue
        if block_body:
            sections.append(f"## ENCOUNTER {enc['order']} — {enc['name']}\n{block_body}")
    if not sections:
        return None
    return f"{header}\n\n" + "\n\n".join(sections)


def _legacy_raid_context(question: str) -> str:
    """Legacy ChromaDB per-encounter fan-out — fallback ONLY when the keyed
    store can't serve the query. Behavior preserved from the original inline
    block (meta_state match + curated overrides + vector fan-out)."""
    from kb.retrieve import format_for_context
    from meta_state import current_state
    matched = None
    for r in (current_state.get("raids") or {}).get("playable") or []:
        if r["name"].lower() in question.lower():
            matched = r
            break
    if matched and matched.get("encounters"):
        sections: list[str] = []
        curated_map = matched.get("encounter_mechanics") or {}
        curated_count = sum(
            1 for enc in matched["encounters"]
            if curated_map.get(enc) and not curated_map[enc].startswith("_")
        )
        if curated_count < len(matched["encounters"]):
            overview = format_for_context(f"{matched['name']} raid overview", top_k=2)
            if overview:
                sections.append(f"## OVERVIEW — {matched['name']}\n{overview}")
        for enc in matched["encounters"]:
            curated = curated_map.get(enc)
            if curated and not curated.startswith("_"):
                sections.append(
                    f"## ENCOUNTER — {enc}\n"
                    f"[curated authoritative mechanics — quote these verbatim]\n"
                    f"{curated}"
                )
                continue
            enc_tokens = [t for t in enc.replace(",", "").split()
                          if len(t) > 3 and t[0].isupper()]
            enc_keyword = enc_tokens[0] if enc_tokens else enc.split()[0]
            chunks = format_for_context(
                f"{matched['name']} {enc} encounter mechanics callouts strategy",
                top_k=3, must_contain=enc_keyword,
            )
            if chunks:
                sections.append(f"## ENCOUNTER — {enc}\n{chunks}")
        return "\n\n".join(sections)
    return format_for_context(question, top_k=12)


# ============================================================
# Orchestrator — wires everything together
# ============================================================


async def answer(question: str) -> str:
    """End-to-end: classify, gather context, call LLM, return response."""
    # Normalize typographic apostrophes so substring matches against
    # meta_state raid names work regardless of which apostrophe the
    # user typed. classify() does the same normalization internally.
    question = question.replace("’", "'").replace("‘", "'")
    plan = classify(question)

    # Short-circuit on clarifying-needed plans
    if plan.ask_clarifying and not (plan.use_inventory or plan.use_kb or plan.use_search):
        return plan.ask_clarifying

    # Gather context
    inventory_ctx = ""
    knowledge_ctx = ""
    search_ctx = ""

    if plan.use_inventory:
        try:
            from inventory import build_context
            inventory_ctx = build_context(focus=plan.inventory_focus)
        except Exception as e:
            print(f"[router] inventory error: {e}")

    if plan.use_kb:
        try:
            from kb.retrieve import format_for_context
            if "raid_walkthrough" in plan.notes:
                # KEYED, context-isolated retrieval first (raid_context.store):
                # returns exactly the matched activity's encounters by key, so
                # cross-raid contamination is structurally impossible. Falls back
                # to the legacy ChromaDB fan-out only if the store can't serve it.
                knowledge_ctx = raid_context_from_store(question) or _legacy_raid_context(question)
            else:
                knowledge_ctx = format_for_context(question)
        except Exception as e:
            print(f"[router] kb error: {e}")

    # Manifest lookup — always runs (cheap), feeds the dedicated
    # <manifest> context slot. Extracts named items that appear in the
    # question and resolves them to authoritative descriptions. This is
    # the primary anti-hallucination grounding for item-specific queries.
    manifest_ctx_str = ""
    try:
        from kb.manifest import extract_named_items, _compact
        hits = extract_named_items(question, max_results=8)
        if hits:
            lines = ["Authoritative item data (Bungie manifest):"]
            for h in hits:
                bits = [h["name"]]
                if h.get("tier"):  bits.append(f"[{h['tier']}]")
                if h.get("type"):  bits.append(f"({h['type']})")
                lines.append("  " + " ".join(b for b in bits if b))
                if h.get("description"):
                    lines.append(f"    {h['description'][:280]}")
            manifest_ctx_str = "\n".join(lines)
    except Exception as e:
        print(f"[router] manifest error: {e}")

    if plan.use_search:
        try:
            from search import search_context
            search_ctx = await search_context(question)
        except Exception as e:
            print(f"[router] search error: {e}")

    # Call LLM. Raid walkthroughs use a specialized prompt that tells
    # the model the KB IS the source of truth — the general chat() uses
    # a prompt that frames KB as "reference, not truth" which kills
    # mechanic extraction even when the chunks are great.
    if "raid_walkthrough" in plan.notes and knowledge_ctx:
        from llm import chat_walkthrough
        response = await chat_walkthrough(question, knowledge=knowledge_ctx)
    else:
        from llm import chat
        response = await chat(
            question,
            inventory=inventory_ctx,
            knowledge=knowledge_ctx,
            search=search_ctx,
            manifest=manifest_ctx_str,
        )

    # NOTE: the old manifest-based "possibly invented names" post-check was
    # REMOVED. The Bungie manifest is an ITEM database — it has no entries for
    # raid geography / encounter terms ("Outside Room", "Inside Rooms",
    # "Verity Encounter Diagram"), so it falsely flagged legitimate content and
    # undercut user confidence. The manifest is NOT a source of truth for
    # mechanics; the keyed encounter content + web guides are. No post-check.

    # If we had a clarifier AND useful context, prepend the question
    if plan.ask_clarifying and (inventory_ctx or knowledge_ctx or search_ctx):
        return f"{response}\n\n_{plan.ask_clarifying}_"
    return response


if __name__ == "__main__":
    # CLI test mode — runs the router on a question and prints the plan
    import sys
    q = " ".join(sys.argv[1:]) or "How do I get Crimson catalyst?"
    plan = classify(q)
    print(f"Question: {q}")
    print(f"Plan: {plan}")
