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
