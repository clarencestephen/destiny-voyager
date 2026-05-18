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

from .config import MODEL, OLLAMA_HOST
from .meta_state import format_for_prompt as _meta_state_for_prompt


SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"


def _system_prompt() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def _format_context(*, inventory: str = "", knowledge: str = "", search: str = "") -> str:
    """Compose the retrieval context block. meta_state always leads —
    it's authoritative current-state data the model must trust over KB
    chunks (which can be months-stale Reddit guides)."""
    parts = [f"<current_state>\n{_meta_state_for_prompt()}\n</current_state>"]
    if inventory:
        parts.append(f"<inventory>\n{inventory}\n</inventory>")
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
    temperature: float = 0.4,
) -> str:
    """Single-shot chat. Returns the full assistant message."""
    context = _format_context(inventory=inventory, knowledge=knowledge, search=search)
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
    async with httpx.AsyncClient(timeout=180) as client:
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
    temperature: float = 0.4,
) -> AsyncIterator[str]:
    """Streaming chat. Yields chunks as they arrive — useful for live edits."""
    context = _format_context(inventory=inventory, knowledge=knowledge, search=search)
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
    async with httpx.AsyncClient(timeout=None) as client:
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
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            r.raise_for_status()
            models = {m["name"] for m in r.json().get("models", [])}
            return MODEL in models or any(m.startswith(MODEL.split(":")[0]) for m in models)
    except Exception:
        return False
