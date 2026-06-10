# Darth Bot — Voice Messages

Drop a **Discord voice message** (or any audio attachment) in a DM or an
allowed channel. The bot transcribes it, answers with the existing Destiny
brain, and replies with **text + a spoken audio clip**.

```
voice clip ──► download attachment ──► Whisper (local STT)
                                            │  transcript
                                            ▼
                                     router.answer()  ← existing bot brain
                                            │  text answer
                            ┌───────────────┴───────────────┐
                            ▼                                ▼
                  ElevenLabs TTS (mp3)              full text (chunked)
                            └───────────► reply: "🎙️ heard: …" + 🔊 clip
```

No voice-channel plumbing — Discord voice messages are ordinary audio
attachments, so plain discord.py handles them (the library can't *listen*
in a live VC; the voice-message model avoids needing that).

## Pieces
- `voice.py` — local Whisper STT (`faster-whisper`) + ElevenLabs TTS. TTS is
  best-effort: on any failure it logs and the bot replies text-only.
- `bot.py` `on_message` — a voice branch (before the @mention gate) that runs
  the pipeline for audio attachments in a DM or allowed channel.
- `config.py` — the knobs below.

## Config (env, all optional — sensible defaults)
| var | default | note |
|---|---|---|
| `DARTH_VOICE_ENABLED` | `1` | master on/off |
| `WHISPER_MODEL` | `base.en` | `small.en` = more accurate, slower |
| `WHISPER_DEVICE` / `WHISPER_COMPUTE` | `cpu` / `int8` | set `cuda`/`float16` if a GPU is free |
| `ELEVENLABS_API_KEY` | from `/home/cs/.env` | already present |
| `ELEVENLABS_VOICE_ID` | `VR6AewLTigWG4xSOukaG` | **set to a voice from your ElevenLabs account** |
| `ELEVENLABS_MODEL` | `eleven_turbo_v2_5` | low-latency |
| `VOICE_TTS_MAX_CHARS` | `700` | spoken length cap (full text always posted) |

## Activate
The bot runs as a user systemd unit. After deploying this code:
```
systemctl --user restart darth-bot
journalctl --user -u darth-bot -f      # watch first run (Whisper model downloads once)
```

## Smoke test (no Discord)
Round-trips a sentence through the real `synthesize()` + `transcribe()`:
```
python3 voice_smoketest.py            # or: python3 voice_smoketest.py "your sentence"
```
Verified 2026-06-10: ElevenLabs "Adam" → mp3 → Whisper base.en transcribed back at 100% similarity.

## Live test (Discord)
1. Create a `#darth-voice` channel (or set `DARTH_VOICE_CHANNELS`).
2. `systemctl --user restart darth-bot`
3. In `#darth-voice` (or a DM), send a voice message: *"What's the best void titan build?"*
4. It replies with text + a spoken clip. (Model is already warmed from the smoke test.)
