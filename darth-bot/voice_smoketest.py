#!/usr/bin/env python3
"""Local smoke test for the voice pipeline — no Discord required.

Round-trips a sentence through the SAME functions the bot uses:
    ElevenLabs TTS  (voice.synthesize)  →  mp3 bytes
    local Whisper   (voice.transcribe)  →  text
…then checks the transcript matches the input. Proves both halves work and
warms the Whisper model for production.

    python3 voice_smoketest.py
    python3 voice_smoketest.py "your own test sentence"

Needs ELEVENLABS_API_KEY in /home/cs/.env (already set). First run downloads
the faster-whisper model (~150 MB), so it may take a minute.
"""
import asyncio
import difflib
import re
import sys

import voice
import config

SENTENCE = (
    sys.argv[1] if len(sys.argv) > 1
    else "What is the best Void Titan build for Salvation's Edge?"
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", (s or "").lower())).strip()


async def main() -> int:
    print("── Darth Bot voice pipeline · smoke test ──")
    print(f"  ElevenLabs voice : {config.ELEVENLABS_VOICE_ID}  ({config.ELEVENLABS_MODEL})")
    print(f"  Whisper          : {config.WHISPER_MODEL}  ({config.WHISPER_DEVICE}/{config.WHISPER_COMPUTE})")
    print(f"  ElevenLabs key   : {'present' if config.ELEVENLABS_API_KEY else 'MISSING — set ELEVENLABS_API_KEY'}")
    print()

    print(f'[1/3] TTS   input  : "{SENTENCE}"')
    audio = await voice.synthesize(SENTENCE)
    if not audio:
        print("  ✗ TTS returned no audio — missing key or ElevenLabs API error (see log above).")
        return 1
    out = "/tmp/voice_smoketest.mp3"
    with open(out, "wb") as fh:
        fh.write(audio)
    print(f"  ✓ {len(audio):,} bytes of mp3 → {out}")

    print("[2/3] STT   (first run downloads the Whisper model ~150 MB — please wait)…")
    transcript = await voice.transcribe(audio, suffix=".mp3")
    print(f'  ✓ heard           : "{transcript}"')

    print("[3/3] compare")
    ratio = difflib.SequenceMatcher(None, _norm(SENTENCE), _norm(transcript)).ratio()
    ok = bool(transcript) and ratio >= 0.6
    print(f"  similarity        : {ratio:.0%}  →  {'PASS ✓' if ok else 'FAIL ✗'}")
    if not ok:
        print("  (low similarity can mean a wrong voice id, a quiet/odd TTS render, or a Whisper miss)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
