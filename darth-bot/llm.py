"""
darth-bot/llm.py
================
Thin wrapper around the Qwen 3 8B model served by ollama.

Install ollama: https://ollama.com  (one binary, free)
Then pull the model once:
    ollama pull qwen3:8b

The wrapper supports streaming so Discord responses can be edited
in-place as tokens arrive (or sent in full at end — both are fine).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator, Iterable

import httpx

from config import MODEL, OLLAMA_HOST, OLLAMA_TOKEN
from meta_state import format_for_prompt as _meta_state_for_prompt


SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"
_AUTH_HEADERS = {"Authorization": f"Bearer {OLLAMA_TOKEN}"} if OLLAMA_TOKEN else {}


def _system_prompt() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def _format_context(*, inventory: str = "", knowledge: str = "",
                    search: str = "", manifest: str = "") -> str:
    """Compose the retrieval context block. Priority order:
    current_state → inventory → manifest (authoritative for named items)
    → knowledge (reference) → search."""
    parts = [f"<current_state>\n{_meta_state_for_prompt()}\n</current_state>"]
    if inventory:
        parts.append(f"<inventory>\n{inventory}\n</inventory>")
    if manifest:
        parts.append(f"<manifest>\n{manifest}\n</manifest>")
    if knowledge:
        parts.append(f"<knowledge>\n{knowledge}\n</knowledge>")
    if search:
        parts.append(f"<search>\n{search}\n</search>")
    return "\n\n".join(parts)


async def chat(
    user_message: str,
    *,
    inventory: str = "",
    knowledge: str = "",
    search: str = "",
    manifest: str = "",
    temperature: float = 0.15,
) -> str:
    """Single-shot chat. Returns the full assistant message."""
    context = _format_context(inventory=inventory, knowledge=knowledge, search=search, manifest=manifest)
    user_block = f"{context}\n\nUser question:\n{user_message}"
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user",   "content": user_block},
        ],
        "stream": False,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=180, headers=_AUTH_HEADERS) as client:
        r = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
        return data["message"]["content"].strip()


async def chat_walkthrough(
    user_message: str,
    *,
    knowledge: str,
    temperature: float = 0.15,
) -> str:
    """Specialized raid/dungeon walkthrough call.

    The general `chat()` uses a system prompt that frames <knowledge> as
    "reference, not truth" — appropriate for build/meta questions where
    KB chunks can be stale. For walkthroughs the KB IS the truth (it's
    hand-curated wiki + raidsecrets content for these specific
    activities), so we use a tighter system prompt that tells the model
    to extract mechanics verbatim and forbids generic filler.
    """
    sys_prompt = (
        "You are Darth Bot, a Destiny 2 raid guide. The user asked about "
        "a specific raid/dungeon. Below are EXACT chunks from a curated "
        "raid-walkthrough knowledge base (destinypedia + raidsecrets). "
        "This IS your source of truth.\n\n"
        "RULES:\n"
        "1. Extract specific mechanic terms verbatim from the chunks: "
        "chalice, enlightened, swordbearer, gatekeeper, oversoul, "
        "sync plates, totems, relays, dunks, etc.\n"
        "2. One paragraph (or 2-3 bullets) per encounter. Name the "
        "actual mechanic — never write filler like 'dodge attacks', "
        "'defeat waves', 'manage adds'.\n"
        "3. If a specific encounter has no chunks below, just name it "
        "and write '(no KB detail — check the raid guide)'. Do NOT "
        "invent mechanics.\n"
        "4. Discord markdown: **bold** key terms, bullet lists, no #headers.\n"
        "5. End with one terse line of dry humor if useful, not required."
    )
    user_block = (
        f"## RAID WALKTHROUGH SOURCES\n{knowledge}\n\n"
        f"## QUESTION\n{user_message}"
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user",   "content": user_block},
        ],
        "stream": False,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=180, headers=_AUTH_HEADERS) as client:
        r = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
        return data["message"]["content"].strip()


async def chat_stream(
    user_message: str,
    *,
    inventory: str = "",
    knowledge: str = "",
    search: str = "",
    manifest: str = "",
    temperature: float = 0.15,
) -> AsyncIterator[str]:
    """Streaming chat. Yields chunks as they arrive — useful for live edits."""
    context = _format_context(inventory=inventory, knowledge=knowledge, search=search, manifest=manifest)
    user_block = f"{context}\n\nUser question:\n{user_message}"
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user",   "content": user_block},
        ],
        "stream": True,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=None, headers=_AUTH_HEADERS) as client:
        async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if chunk.get("done"):
                    return
                content = chunk.get("message", {}).get("content", "")
                if content:
                    yield content


async def check_ollama() -> bool:
    """Verify ollama is reachable and the model is pulled."""
    try:
        async with httpx.AsyncClient(timeout=10, headers=_AUTH_HEADERS) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            r.raise_for_status()
            models = {m["name"] for m in r.json().get("models", [])}
            return MODEL in models or any(m.startswith(MODEL.split(":")[0]) for m in models)
    except Exception:
        return False
