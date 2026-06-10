"""
darth-bot/config.py
===================
All configurable knobs. Reads from environment first, then sensible defaults.

Required env vars (set in /home/cs/.env, mirrored in master_secrets.md):
    DISCORD_BOT_TOKEN       — Darth Bot's Discord token
    DISCORD_GUILD_ID        — your server ID (1471072707524296767)
    BRAVE_SEARCH_API_KEY    — for live web search fallback (free 2k/mo tier)

Optional:
    OLLAMA_HOST             — default http://localhost:11434
    DARTH_BOT_MODEL         — default "qwen3:8b" (matches `ollama pull qwen3:8b`)
    DARTH_BOT_KB_DIR        — where chromadb lives, default ./data/chroma
    DESTINY_VOYAGER_CONFIG_PATH — path to user_config.json from the Destiny Voyager toolkit
                                  (legacy alias ORDER_66_CONFIG_PATH also accepted)
"""

from __future__ import annotations

import os
from pathlib import Path

# Load .env from repo root if present
try:
    from dotenv import load_dotenv
    load_dotenv("/home/cs/.env")
    load_dotenv(Path(__file__).parent / ".env")  # bot-local override
except ImportError:
    pass


HERE = Path(__file__).parent
DATA_DIR = Path(os.environ.get("DARTH_BOT_KB_DIR", HERE / "data"))
CHROMA_DIR = DATA_DIR / "chroma"
SCRAPE_DIR = DATA_DIR / "scrape"
DATA_DIR.mkdir(exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
SCRAPE_DIR.mkdir(parents=True, exist_ok=True)

# Discord
DISCORD_BOT_TOKEN = os.environ.get("DARTH_BOT_DISCORD_TOKEN") or os.environ.get("DISCORD_BOT_TOKEN", "")
DISCORD_GUILD_ID = int(os.environ.get("DISCORD_GUILD_ID", "1471072707524296767"))
ALLOWED_CHANNEL_NAMES = {
    "destiny-voyager",
    "smugglers-cache", "engineering-bay", "trooper-comms",
    "the-cantina", "lfg-storyline", "lfg-raids", "lfg-dungeons",
}

# LLM
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_TOKEN = os.environ.get("OLLAMA_TOKEN", "")
MODEL = os.environ.get("DARTH_BOT_MODEL", "qwen3:8b")
EMBED_MODEL = os.environ.get("DARTH_BOT_EMBED", "BAAI/bge-small-en-v1.5")

# Search
BRAVE_SEARCH_API_KEY = os.environ.get("BRAVE_SEARCH_API_KEY", "")
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

# Destiny Voyager toolkit data — used for personalized "with my inventory" questions.
# Reads DESTINY_VOYAGER_* env vars first; falls back to legacy ORDER_66_* names.
def _env_path(primary: str, legacy: str, default: Path) -> Path:
    return Path(os.environ.get(primary) or os.environ.get(legacy) or default)

DESTINY_VOYAGER_CONFIG = _env_path(
    "DESTINY_VOYAGER_CONFIG_PATH", "ORDER_66_CONFIG_PATH",
    HERE.parent / "user_config.json",
)
DESTINY_VOYAGER_WORKBOOK = _env_path(
    "DESTINY_VOYAGER_WORKBOOK_PATH", "ORDER_66_WORKBOOK_PATH",
    HERE.parent / "my_loadouts.xlsx",
)
DESTINY_VOYAGER_MANIFEST = _env_path(
    "DESTINY_VOYAGER_MANIFEST_DIR", "ORDER_66_MANIFEST_DIR",
    HERE.parent / "manifest_cache",
)

ORDER_66_CONFIG = DESTINY_VOYAGER_CONFIG
ORDER_66_WORKBOOK = DESTINY_VOYAGER_WORKBOOK
ORDER_66_MANIFEST = DESTINY_VOYAGER_MANIFEST

# Retrieval knobs
TOP_K = 6
CHUNK_SIZE = 512
CHUNK_OVERLAP = 80

# Brand voice
PERSONA = "DARTH_BANKAI"  # used in prompts

# Voice messages — drop a Discord voice clip; the bot transcribes it
# (local Whisper), answers with the existing brain, and replies with both
# text and an ElevenLabs-spoken audio clip. No voice-channel plumbing —
# Discord voice messages arrive as ordinary audio attachments.
VOICE_ENABLED = os.environ.get("DARTH_VOICE_ENABLED", "1") not in ("0", "false", "False", "")
# STT — faster-whisper, runs locally on this box (free/private).
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
# TTS — ElevenLabs (premium voice). Override the voice via ELEVENLABS_VOICE_ID;
# default is a deep male voice fitting the DARTH_BANKAI persona.
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # "Adam" — deep male premade
ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_turbo_v2_5")
# Cap spoken length (chars) so replies stay snappy + cheap; full text is
# always posted regardless.
VOICE_TTS_MAX_CHARS = int(os.environ.get("VOICE_TTS_MAX_CHARS", "700"))
# Scope where voice notes are handled — a DEDICATED channel (or any DM), so the
# bot doesn't transcribe every voice note dropped in shared channels. Create a
# channel (e.g. #darth-voice, or a voice channel's built-in text chat) and add
# its name here (or set DARTH_VOICE_CHANNELS / DARTH_VOICE_CHANNEL_IDS in env).
VOICE_CHANNEL_NAMES = {
    c.strip() for c in os.environ.get("DARTH_VOICE_CHANNELS", "darth-voice,voice-darth").split(",")
    if c.strip()
}
VOICE_CHANNEL_IDS = {
    int(x) for x in os.environ.get("DARTH_VOICE_CHANNEL_IDS", "").split(",") if x.strip().isdigit()
}
# Allow voice notes in DMs too (1:1 with the bot is unambiguous).
VOICE_ALLOW_DMS = os.environ.get("DARTH_VOICE_ALLOW_DMS", "1") not in ("0", "false", "False", "")
