"""
discord/channel_audit.py
========================
Enumerate every channel in the Order 66 server, grouped by category, with
type and (for voice) member-count + bitrate. Read-only — does not delete.

Usage:
    DISCORD_BOT_TOKEN=<token> DISCORD_GUILD_ID=<id> python3 \\
        discord/channel_audit.py
"""
from __future__ import annotations

import os
import sys
from collections import Counter

import discord


class AuditClient(discord.Client):
    def __init__(self, guild_id: int):
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        super().__init__(intents=intents)
        self.guild_id = guild_id

    async def on_ready(self):
        guild = self.get_guild(self.guild_id)
        if not guild:
            print(f"ERROR: not in guild {self.guild_id}")
            await self.close()
            return

        text_total = len(guild.text_channels)
        voice_total = len(guild.voice_channels)
        cat_total = len(guild.categories)
        print(f"{guild.name}: {cat_total} categories · {text_total} text · {voice_total} voice")
        print("=" * 70)

        # Group by category
        for cat in sorted(guild.categories, key=lambda c: c.position):
            txt = [c for c in cat.text_channels]
            voc = [c for c in cat.voice_channels]
            print(f"\n📂 {cat.name}   ({len(txt)} text · {len(voc)} voice)")
            for ch in txt:
                msgs = "?"
                # show last message timestamp summary
                try:
                    last = None
                    async for m in ch.history(limit=1):
                        last = m
                    if last:
                        msgs = f"last msg {last.created_at:%Y-%m-%d}"
                    else:
                        msgs = "EMPTY"
                except Exception:
                    msgs = "no read access"
                print(f"   #  {ch.name:35} {msgs}")
            for ch in voc:
                conn = len(ch.members)
                print(f"   🔊 {ch.name:35} {ch.bitrate//1000}kbps · {conn} connected")

        # Orphan channels (not in any category)
        orphans = [c for c in guild.channels if c.category is None
                   and not isinstance(c, discord.CategoryChannel)]
        if orphans:
            print(f"\n⚠️  Orphan (no category):")
            for ch in orphans:
                typ = "text" if isinstance(ch, discord.TextChannel) else "voice"
                print(f"   {typ}  {ch.name}")

        # Duplicate detection — channels with similar names across categories
        print("\n" + "=" * 70)
        print("Potential duplicates / near-duplicates by name:")
        all_text = [(c.name, c.category.name if c.category else "(none)")
                    for c in guild.text_channels]
        all_voice = [(c.name, c.category.name if c.category else "(none)")
                     for c in guild.voice_channels]
        # Same channel name in multiple categories
        text_count = Counter(n for n, _ in all_text)
        for name, count in text_count.items():
            if count > 1:
                locations = [c for n, c in all_text if n == name]
                print(f"   text '{name}' appears in: {locations}")
        voice_count = Counter(n for n, _ in all_voice)
        for name, count in voice_count.items():
            if count > 1:
                locations = [c for n, c in all_voice if n == name]
                print(f"   voice '{name}' appears in: {locations}")

        await self.close()


def main():
    token = (os.environ.get("DISCORD_BOT_TOKEN")
             or os.environ.get("DARTH_BOT_DISCORD_TOKEN"))
    if not token:
        sys.exit("ERROR: DISCORD_BOT_TOKEN not set.")
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    if not guild_id:
        sys.exit("ERROR: DISCORD_GUILD_ID not set.")
    AuditClient(int(guild_id)).run(token)


if __name__ == "__main__":
    main()
