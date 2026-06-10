"""
darth-bot/memory.py
===================
Per-conversation rolling memory so Darth Bot's replies have context —
follow-ups like "what about the Warlock version?" work without repeating
everything. Keeps the last MAX_TURNS messages (user + assistant) per
conversation, keyed by channel (or by user in DMs).

In-memory only — resets when the bot restarts. That's fine for a live
conversation; nothing here is worth persisting.
"""
from __future__ import annotations

from collections import deque, defaultdict

MAX_TURNS = 250  # messages remembered per conversation (user + assistant combined)

_HISTORY: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_TURNS))


def conv_key(channel_id, guild_id, user_id) -> str:
    """One conversation per channel; DMs are per-user."""
    return f"dm:{user_id}" if guild_id is None else f"ch:{channel_id}"


def history(key: str) -> list[dict]:
    """Prior turns, oldest→newest: [{'role': 'user'|'assistant', 'content': str}, …]."""
    return list(_HISTORY[key])


def remember(key: str, role: str, content: str) -> None:
    if content and content.strip():
        _HISTORY[key].append({"role": role, "content": content.strip()})


def clear(key: str) -> None:
    _HISTORY.pop(key, None)
