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

import re
from dataclasses import dataclass, field
from typing import Set


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
    if _KW["raid_name"].search(q) or _KW["encounter"].search(q):
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
                # Build a STRUCTURED per-encounter context. Token-overlap
                # retrieval biases everything toward the final-boss name
                # (the question contains the raid title), so we fan out
                # one sub-query per encounter and label each section.
                from meta_state import current_state
                matched = None
                for r in (current_state.get("raids") or {}).get("playable") or []:
                    if r["name"].lower() in question.lower():
                        matched = r
                        break
                if matched and matched.get("encounters"):
                    sections: list[str] = []
                    curated_map = matched.get("encounter_mechanics") or {}
                    # Count encounters with curated content (ignoring _-prefixed keys)
                    curated_count = sum(
                        1 for enc in matched["encounters"]
                        if curated_map.get(enc) and not curated_map[enc].startswith("_")
                    )
                    # Only include the OVERVIEW chunk pull when NOT all
                    # encounters are curated — otherwise the overview can
                    # surface a competing encounter list from a different
                    # walkthrough source and confuse the model.
                    if curated_count < len(matched["encounters"]):
                        overview = format_for_context(
                            f"{matched['name']} raid overview", top_k=2,
                        )
                        if overview:
                            sections.append(f"## OVERVIEW — {matched['name']}\n{overview}")
                    for enc in matched["encounters"]:
                        # Hand-curated mechanics (when present) override
                        # KB retrieval — used for encounters where the
                        # vector search leaks content from other raids
                        # (e.g. Ir Yût pulling King's Fall Deathsinger
                        # material via the shared "Deathsinger" token).
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
                    knowledge_ctx = "\n\n".join(sections)
                else:
                    knowledge_ctx = format_for_context(question, top_k=12)
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

    # Fix 3: post-hoc fact check — scan response for title-case item
    # phrases that don't match the manifest. Append a soft caveat
    # rather than rewriting, so the user sees what's suspect.
    try:
        from kb.manifest import verify_names
        check = verify_names(response)
        # The activity / proper-noun allowlist lives in kb/manifest.py
        # (KNOWN_ACTIVITIES, KNOWN_PROPER_NOUNS) so verify_names handles
        # most filtering. Anything that slips through still has to clear
        # the 2-4 word length guard before being flagged.
        suspects = [s for s in check["unverified_candidates"]
                    if 2 <= len(s.split()) <= 4]
        if suspects:
            response += (
                "\n\n_⚠ Possibly invented names (not found in manifest): "
                + ", ".join(f"`{s}`" for s in suspects[:5])
                + ". Verify on light.gg/db before relying on these._"
            )
    except Exception as e:
        print(f"[router] verify_names error: {e}")

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
