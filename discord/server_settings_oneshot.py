"""
discord/server_settings_oneshot.py
==================================
One-shot script that does the Discord-side housekeeping setup_server.py
can't (because it deals with server-level settings + role positions +
bot audit, not channel/role creation).

What it does:
  1. Sets the AFK / inactive channel to 💤 Carbonite Chamber
  2. Moves the Emperor role to the top of the role list (just below
     bot-managed roles, which can't be unseated)
  3. Lists every bot member in the server, flagging known ones
     (Sapphire, MEE6, FlaviBot, TicketTool, Charlemagne, Darth Bot)
     and prompting for kick decisions on stdout

Idempotent — re-run safely.

Usage:
    DISCORD_BOT_TOKEN=<token> DISCORD_GUILD_ID=<id> python3 \\
        discord/server_settings_oneshot.py [--kick-redundant]
"""
from __future__ import annotations

import asyncio
import os
import sys

import discord


KNOWN_REDUNDANT_BOTS = {
    # Bots whose function Darth Bot now covers natively, or that the
    # clan owner has decided to remove (audit 2026-05-25).
    "Sapphire": "reaction-roles (Darth Bot does this natively now)",
    "MEE6": "reaction-roles + welcome (both covered by Darth Bot)",
    "FlaviBot": "reaction-roles (Darth Bot does this natively now)",
    "Carl-bot": "reaction-roles + custom commands (covered by Darth Bot)",
    "Destiny Director": "Destiny stats (covered by Charlemagne)",
    "BetterInvites": "invite tracking — not a clan priority",
    "Eklipse": "streaming clipper — not a clan priority",
}

KEEP_BOTS = {
    "Darth Bot": "core clan bot — KB, raids, /verify-clan, reaction-roles",
    "Ticket Tool": "ticket panel in #bounty-office",
    "TicketTool": "ticket panel in #bounty-office",
    "Charlemagne": "Destiny 2 stats / clan event signups",
    "Apollo": "event scheduling for raid nights",
    "Friend Time": "auto-timezone conversion across clan members",
    "Teamplay_LFG": "LFG-specific signups (until /raid-start ships)",
    "Order 66 Setup Bot": "this script's controller",
}


class SettingsClient(discord.Client):
    def __init__(self, guild_id: int, kick_redundant: bool):
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        super().__init__(intents=intents)
        self.guild_id = guild_id
        self.kick_redundant = kick_redundant

    async def on_ready(self):
        print(f"[connected] {self.user} (id={self.user.id})")
        guild = self.get_guild(self.guild_id)
        if not guild:
            print(f"ERROR: bot is not in guild {self.guild_id}")
            await self.close()
            return
        print(f"[guild] {guild.name} ({guild.id})")

        await self._set_afk_channel(guild)
        await self._move_emperor_top(guild)
        await self._audit_bots(guild)

        print("\n[done]")
        await self.close()

    async def _set_afk_channel(self, guild: discord.Guild):
        print("\n[AFK] looking for 💤 Carbonite Chamber...")
        target = None
        for ch in guild.voice_channels:
            if "carbonite" in ch.name.lower():
                target = ch
                break
        if not target:
            print("  ? no voice channel matching 'carbonite' — skipping")
            return

        if guild.afk_channel and guild.afk_channel.id == target.id:
            print(f"  ✓ already set: {target.name}")
            return

        try:
            await guild.edit(afk_channel=target, afk_timeout=900,
                             reason="server_settings_oneshot.py")
            print(f"  + set AFK channel: {target.name} (15min timeout)")
        except discord.Forbidden:
            print("  ✗ Forbidden — bot lacks Manage Server permission")
        except Exception as e:
            print(f"  ✗ failed: {e}")

    async def _move_emperor_top(self, guild: discord.Guild):
        print("\n[Roles] moving Emperor to top...")
        emperor = discord.utils.get(guild.roles, name="Emperor")
        if not emperor:
            print("  ? no 'Emperor' role found")
            return

        bot_role = guild.me.top_role
        # Discord rule: a bot can move roles only BELOW its highest role.
        # We aim to put Emperor as high as we can — just below the bot's
        # highest managed role (which is unmovable by definition).
        target_pos = max(1, bot_role.position - 1)
        if emperor.position == target_pos:
            print(f"  ✓ already at position {emperor.position}")
            return

        try:
            await emperor.edit(position=target_pos,
                               reason="server_settings_oneshot.py")
            print(f"  + moved Emperor: {emperor.position} → {target_pos}")
        except discord.Forbidden:
            print("  ✗ Forbidden — bot's role must be ABOVE Emperor's "
                  "target position. Drag the bot role higher in Discord "
                  "Server Settings → Roles, then re-run.")
        except Exception as e:
            print(f"  ✗ failed: {e}")

    async def _audit_bots(self, guild: discord.Guild):
        print("\n[Bots] enumerating bot members...")
        bots = [m for m in guild.members if m.bot]
        if not bots:
            print("  (no bot members found)")
            return

        for m in bots:
            status = "❓ unknown"
            reason = ""
            for keep_name, keep_reason in KEEP_BOTS.items():
                if keep_name.lower() in m.name.lower():
                    status = "✅ KEEP"
                    reason = keep_reason
                    break
            else:
                for redundant_name, redundant_reason in KNOWN_REDUNDANT_BOTS.items():
                    if redundant_name.lower() in m.name.lower():
                        status = "⚠️  REDUNDANT"
                        reason = redundant_reason
                        break
            print(f"  {status}  {m.name:<25}  {reason}")

            if self.kick_redundant and status.startswith("⚠️"):
                try:
                    await m.kick(reason=f"redundant — {reason}")
                    print(f"    + kicked")
                except discord.Forbidden:
                    print(f"    ✗ Forbidden — can't kick (role hierarchy?)")
                except Exception as e:
                    print(f"    ✗ failed to kick: {e}")

        if not self.kick_redundant:
            redundant = [m for m in bots
                         if any(r.lower() in m.name.lower()
                                for r in KNOWN_REDUNDANT_BOTS)]
            if redundant:
                print(f"\n  → {len(redundant)} redundant bot(s) found. "
                      f"Re-run with --kick-redundant to remove them.")


def main():
    token = os.environ.get("DISCORD_BOT_TOKEN") \
            or os.environ.get("DARTH_BOT_DISCORD_TOKEN")
    if not token:
        sys.exit("ERROR: DISCORD_BOT_TOKEN (or DARTH_BOT_DISCORD_TOKEN) "
                 "not set.")
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    if not guild_id:
        sys.exit("ERROR: DISCORD_GUILD_ID not set.")

    kick = "--kick-redundant" in sys.argv
    client = SettingsClient(int(guild_id), kick_redundant=kick)
    client.run(token)


if __name__ == "__main__":
    main()
