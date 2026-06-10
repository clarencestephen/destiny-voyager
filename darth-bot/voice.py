"""
darth-bot/voice.py
==================
Discord voice-message pipeline for Darth Bot.

A user drops a Discord voice message (or any audio attachment). This module
turns that audio into text with a LOCAL Whisper model (free, private), and —
after bot.py runs the transcript through the existing brain (router.answer) —
speaks the reply with ElevenLabs (premium voice). bot.py owns detection, the
brain call, and the Discord reply; this module owns STT + TTS only.

Why this works on plain discord.py: Discord voice messages arrive as ordinary
audio *attachments*, so there is no voice-channel receive plumbing to add —
discord.py can already download attachments. (The library can't *listen* in a
live voice channel; the voice-message model neatly avoids needing that.)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile

import httpx

import config

log = logging.getLogger("darth.voice")

_AUDIO_EXTS = (".ogg", ".oga", ".opus", ".mp3", ".wav", ".m4a", ".webm", ".flac")
_model = None  # lazily-loaded faster-whisper model (first transcription pays load cost)


def is_voice_attachment(att) -> bool:
    """True if a Discord attachment looks like speech audio."""
    ct = (getattr(att, "content_type", "") or "").lower()
    if ct.startswith("audio"):
        return True
    name = (getattr(att, "filename", "") or "").lower()
    return name.endswith(_AUDIO_EXTS)


# ── Speech-to-text (local Whisper) ───────────────────────────────────────────

def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel  # imported lazily — heavy
        log.info("loading faster-whisper %s (%s/%s)",
                 config.WHISPER_MODEL, config.WHISPER_DEVICE, config.WHISPER_COMPUTE)
        _model = WhisperModel(
            config.WHISPER_MODEL,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE,
        )
    return _model


def _transcribe_sync(path: str) -> str:
    # vad_filter trims silence; beam_size=1 keeps it fast for short clips.
    segments, _info = _get_model().transcribe(path, beam_size=1, vad_filter=True)
    return " ".join(seg.text for seg in segments).strip()


async def transcribe(audio_bytes: bytes, suffix: str = ".ogg") -> str:
    """Transcribe audio bytes to text off the event loop. '' if nothing heard."""
    with tempfile.NamedTemporaryFile(suffix=suffix or ".ogg", delete=False) as fh:
        fh.write(audio_bytes)
        path = fh.name
    try:
        return await asyncio.to_thread(_transcribe_sync, path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ── Text-to-speech (ElevenLabs) ──────────────────────────────────────────────

def _spoken_text(text: str) -> str:
    """Strip markdown + trim to a snappy spoken length (full text still posted)."""
    t = re.sub(r"```.*?```", " ", text, flags=re.S)          # code fences
    t = re.sub(r"[*_`#>|]", "", t)                            # md emphasis / headings
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)            # links → label
    t = re.sub(r"^\s*[-•]\s*", "", t, flags=re.M)             # bullet markers
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > config.VOICE_TTS_MAX_CHARS:
        t = t[: config.VOICE_TTS_MAX_CHARS].rsplit(" ", 1)[0] + "…"
    return t


async def synthesize(text: str) -> bytes | None:
    """ElevenLabs TTS → mp3 bytes. None on any failure (caller falls back to text-only)."""
    if not config.ELEVENLABS_API_KEY:
        log.info("no ELEVENLABS_API_KEY — skipping TTS, replying text-only")
        return None
    spoken = _spoken_text(text)
    if not spoken:
        return None
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{config.ELEVENLABS_VOICE_ID}"
    headers = {
        "xi-api-key": config.ELEVENLABS_API_KEY,
        "accept": "audio/mpeg",
        "content-type": "application/json",
    }
    payload = {
        "text": spoken,
        "model_id": config.ELEVENLABS_MODEL,
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.75, "style": 0.30},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.content
    except Exception as e:  # noqa: BLE001 — TTS is best-effort
        log.warning("ElevenLabs TTS failed: %s", e)
        return None
