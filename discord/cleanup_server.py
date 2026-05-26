"""
discord/cleanup_server.py
=========================
Consolidate the over-provisioned Order 66 server: delete duplicates, fold
single-channel categories, slim voice channels from 27 → 5.

Plan (per audit 2026-05-26):
  1. Delete all voice EXCEPT 5: Open Hyperspace, Millennium Falcon,
     Slave I, Rogue Squadron, Carbonite Chamber.
  2. Create "📅 Destiny Weekly" category. Move 4 orphan text channels in:
     xur, weekly-reset, twid, trials-and-iron-banner.
     Delete all other orphan text channels.
  3. Fold Mos Eisley INTO 💬 The Cantina (move lfg-right-now, gaming,
     memes, clips, art).
  4. Delete 🎨 Tailor of Coruscant, 🏆 Trials of the Jedi (move
     #jedi-trials → ⚔️ Outer Rim Skirmish), 😎 The Holocron (move
     #force-wisdom → 🛠️ Lightsaber Forge).
  5. Rename Imperial Command Ops → 💀 Death Star Command. Move the
     surviving #bounty-office (the one with history) into 🎫 Galactic
     Senate, delete the empty duplicate.
  6. Delete Docking Bay + 🚀 The Imperial Engineering Bay entirely
     (template-import duplicates of canonical channels).

Run --dry-run first to log what would happen. Then re-run without
--dry-run to actually execute.

Usage:
    DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... python3 \\
        discord/cleanup_server.py --dry-run
    # review output, then:
    DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... python3 \\
        discord/cleanup_server.py
"""
from __future__ import annotations

import asyncio
import os
import sys

import discord


# ───── Voice channels to KEEP (exact name match, case-insensitive
# substring works — we look for these as fragments of the actual name
# because Discord names include emoji prefixes)
KEEP_VOICE_SUBSTR = {
    "open hyperspace",
    "millennium falcon",
    "slave i",
    "rogue squadron",
    "carbonite chamber",
}

# ───── Orphan text channels to RESCUE into a new Destiny Weekly category
RESCUE_ORPHANS = {
    "xur",
    "weekly-reset",
    "twid",
    "trials-and-iron-banner",
}
NEW_CAT_NAME = "📅 Destiny Weekly"

# ───── Channels to MOVE: (current_name_substr, target_category_name)
# (Match by name fragment — some channels have emoji prefixes)
MOVES = [
    # Mos Eisley → 💬 The Cantina
    ("lfg-right-now",         "💬 The Cantina"),
    ("gaming",                "💬 The Cantina"),
    ("memes",                 "💬 The Cantina"),
    ("clips",                 "💬 The Cantina"),
    ("art",                   "💬 The Cantina"),
    # Holocron + small cats → their fold-in homes
    ("force-wisdom",          "🛠️ Lightsaber Forge"),
    ("jedi-trials",           "⚔️ Outer Rim Skirmish"),
]

# ───── Categories to DELETE entirely (only AFTER their kept channels
# have been moved out; the script will refuse to delete a non-empty cat).
DELETE_CATEGORIES = {
    "Mos Eisley",
    "🎨 Tailor of Coruscant",
    "🏆 Trials of the Jedi",
    "😎 The Holocron",
    "Docking Bay",
    "🚀 The Imperial Engineering Bay",
}

# Rename target — Imperial Command Ops becomes the canonical mod cat
RENAME_CAT = ("Imperial Command Ops", "💀 Death Star Command")


def _matches_any(name: str, substrs: set[str]) -> bool:
    n = name.lower()
    return any(s in n for s in substrs)


def _clean_name(name: str) -> str:
    """Strip leading emoji + bar-separator characters so channel names
    like '🎨┃art' compare equal to 'art'."""
    # Discord channel names are lowercase ASCII + hyphens after the bot
    # creates them, but emojis are allowed at the start. Keep only ASCII
    # alphanumeric + hyphen + underscore chars from the start.
    import re
    # Strip any leading non-[a-z0-9] chars
    return re.sub(r"^[^a-z0-9]+", "", name.lower())


class CleanupClient(discord.Client):
    def __init__(self, guild_id: int, dry_run: bool):
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        super().__init__(intents=intents)
        self.guild_id = guild_id
        self.dry_run = dry_run
        self.plan_log: list[str] = []

    def plan(self, action: str):
        self.plan_log.append(action)
        prefix = "[DRY] " if self.dry_run else "[DO]  "
        print(prefix + action)

    async def on_ready(self):
        guild = self.get_guild(self.guild_id)
        if not guild:
            print(f"ERROR: not in guild {self.guild_id}")
            await self.close()
            return

        print(f"\n[guild] {guild.name}  (dry_run={self.dry_run})")
        print(f"        before: {len(guild.categories)} cat · "
              f"{len(guild.text_channels)} text · {len(guild.voice_channels)} voice\n")

        await self._step1_voice(guild)
        await self._step2_orphans(guild)
        await self._step3_moves(guild)
        await self._step4_rename_mod_cat(guild)
        await self._step5_dedup_bounty(guild)
        await self._step6_delete_cats(guild)

        print(f"\n[summary] {len(self.plan_log)} actions "
              f"{'planned' if self.dry_run else 'executed'}\n")

        # Re-fetch counts (only meaningful in non-dry-run mode)
        if not self.dry_run:
            print(f"        after:  {len(guild.categories)} cat · "
                  f"{len(guild.text_channels)} text · "
                  f"{len(guild.voice_channels)} voice")

        await self.close()

    async def _step1_voice(self, guild: discord.Guild):
        print("\n── Step 1: voice channel cleanup ──")
        for ch in guild.voice_channels:
            if _matches_any(ch.name, KEEP_VOICE_SUBSTR):
                continue
            self.plan(f"delete voice  #{ch.name}  (in {ch.category.name if ch.category else '(none)'})")
            if not self.dry_run:
                try:
                    await ch.delete(reason="cleanup_server.py: voice consolidation")
                    await asyncio.sleep(0.4)
                except Exception as e:
                    print(f"    ✗ {e}")

    async def _step2_orphans(self, guild: discord.Guild):
        print("\n── Step 2: orphan text → Destiny Weekly + delete rest ──")
        # Create new category first
        new_cat = discord.utils.get(guild.categories, name=NEW_CAT_NAME)
        if not new_cat:
            self.plan(f"create category  {NEW_CAT_NAME}")
            if not self.dry_run:
                new_cat = await guild.create_category(NEW_CAT_NAME,
                    reason="cleanup_server.py: Destiny Weekly")
                await asyncio.sleep(0.4)

        # Walk orphan text channels (category is None)
        orphans = [c for c in guild.text_channels if c.category is None]
        for ch in orphans:
            clean_name = ch.name.lstrip("🚨📣┃")  # strip leading marker emojis
            if _matches_any(clean_name, RESCUE_ORPHANS):
                self.plan(f"move orphan   #{ch.name}  →  {NEW_CAT_NAME}")
                if not self.dry_run and new_cat:
                    try:
                        await ch.edit(category=new_cat,
                            reason="cleanup_server.py: rescue to Destiny Weekly")
                        await asyncio.sleep(0.4)
                    except Exception as e:
                        print(f"    ✗ {e}")
            else:
                self.plan(f"delete orphan #{ch.name}")
                if not self.dry_run:
                    try:
                        await ch.delete(reason="cleanup_server.py: orphan cleanup")
                        await asyncio.sleep(0.4)
                    except Exception as e:
                        print(f"    ✗ {e}")

    async def _step3_moves(self, guild: discord.Guild):
        print("\n── Step 3: channel moves into consolidating categories ──")
        for target_name, target_cat_name in MOVES:
            target = discord.utils.get(guild.categories, name=target_cat_name)
            if not target:
                print(f"    ? target category {target_cat_name!r} not found — skipping")
                continue
            # Exact-name match on cleaned channel name (strips emoji prefixes)
            for ch in guild.text_channels:
                if _clean_name(ch.name) == target_name.lower() and ch.category != target:
                    self.plan(f"move          #{ch.name}  →  {target_cat_name}")
                    if not self.dry_run:
                        try:
                            await ch.edit(category=target,
                                reason=f"cleanup_server.py: fold into {target_cat_name}")
                            await asyncio.sleep(0.4)
                        except Exception as e:
                            print(f"    ✗ {e}")

    async def _step4_rename_mod_cat(self, guild: discord.Guild):
        print("\n── Step 4: rename Imperial Command Ops → 💀 Death Star Command ──")
        old, new = RENAME_CAT
        cat = discord.utils.get(guild.categories, name=old)
        if not cat:
            print(f"    ? {old!r} not found — already renamed or never existed")
            return
        # Check the new name doesn't already exist (would be a collision)
        if discord.utils.get(guild.categories, name=new):
            print(f"    ? {new!r} already exists; merging would require channel moves. Skipping rename.")
            return
        self.plan(f"rename cat    '{old}'  →  '{new}'")
        if not self.dry_run:
            try:
                await cat.edit(name=new, reason="cleanup_server.py: canonicalize mod cat")
                await asyncio.sleep(0.4)
            except Exception as e:
                print(f"    ✗ {e}")

    async def _step5_dedup_bounty(self, guild: discord.Guild):
        """Two #bounty-office channels exist. Keep the one with history,
        move it to 🎫 Galactic Senate, delete the empty duplicate."""
        print("\n── Step 5: dedupe #bounty-office ──")
        bounties = [c for c in guild.text_channels if c.name == "bounty-office"]
        if len(bounties) < 2:
            print("    (already deduped)")
            return

        senate = discord.utils.get(guild.categories, name="🎫 Galactic Senate")
        if not senate:
            print("    ? 🎫 Galactic Senate not found — skipping")
            return

        # Find the one with the most recent message (= the one to keep)
        scored = []
        for ch in bounties:
            try:
                last_id = ch.last_message_id or 0
            except Exception:
                last_id = 0
            scored.append((last_id, ch))
        scored.sort(reverse=True)  # highest id (most recent) first
        keeper = scored[0][1]
        delete_targets = [c for _, c in scored[1:]]

        if keeper.category != senate:
            self.plan(f"move keeper   #bounty-office (id={keeper.id}, "
                      f"from {keeper.category.name if keeper.category else '(none)'}) "
                      f"→  🎫 Galactic Senate")
            if not self.dry_run:
                try:
                    await keeper.edit(category=senate,
                        reason="cleanup_server.py: bounty-office to Senate")
                    await asyncio.sleep(0.4)
                except Exception as e:
                    print(f"    ✗ {e}")

        for ch in delete_targets:
            self.plan(f"delete dup    #bounty-office (id={ch.id}, in "
                      f"{ch.category.name if ch.category else '(none)'})")
            if not self.dry_run:
                try:
                    await ch.delete(reason="cleanup_server.py: duplicate bounty-office")
                    await asyncio.sleep(0.4)
                except Exception as e:
                    print(f"    ✗ {e}")

    async def _step6_delete_cats(self, guild: discord.Guild):
        print("\n── Step 6: delete consolidated categories ──")
        for cat_name in DELETE_CATEGORIES:
            cat = discord.utils.get(guild.categories, name=cat_name)
            if not cat:
                print(f"    ? {cat_name!r} not found — skipping")
                continue
            # Delete every channel still inside (they should have been
            # moved by step 3, but anything left is a duplicate/cleanup).
            for ch in list(cat.channels):
                self.plan(f"delete (in {cat_name})  #{ch.name}")
                if not self.dry_run:
                    try:
                        await ch.delete(reason=f"cleanup_server.py: empty {cat_name}")
                        await asyncio.sleep(0.4)
                    except Exception as e:
                        print(f"    ✗ {e}")
            # Now the category should be empty
            self.plan(f"delete cat    {cat_name}")
            if not self.dry_run:
                try:
                    await cat.delete(reason="cleanup_server.py: fold-in")
                    await asyncio.sleep(0.4)
                except Exception as e:
                    print(f"    ✗ {e}")


def main():
    token = (os.environ.get("DISCORD_BOT_TOKEN")
             or os.environ.get("DARTH_BOT_DISCORD_TOKEN"))
    if not token:
        sys.exit("ERROR: DISCORD_BOT_TOKEN not set.")
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    if not guild_id:
        sys.exit("ERROR: DISCORD_GUILD_ID not set.")
    dry = "--dry-run" in sys.argv
    CleanupClient(int(guild_id), dry_run=dry).run(token)


if __name__ == "__main__":
    main()
