"""
discord/setup_server.py
=======================
One-shot Discord server builder. Reads server_layout.json and creates every
role, category, and channel in your Discord server. Sets up the basic
clan-only / mod-only permission overwrites.

Usage:
    pip install discord.py
    python3 discord/setup_server.py

Environment variables (or pass on CLI):
    DISCORD_BOT_TOKEN   — your bot token from https://discord.com/developers/applications
    DISCORD_GUILD_ID    — target server ID (default: from server_layout.json)

Setup:
1. Go to https://discord.com/developers/applications → New Application
2. Bot tab → Reset Token → copy token → set DISCORD_BOT_TOKEN
3. OAuth2 → URL Generator → check `bot` + `applications.commands` scopes
4. Bot Permissions: Administrator (simplest) — or specifically:
   Manage Roles, Manage Channels, Manage Messages, Add Reactions, Send Messages, Read Message History
5. Open the generated URL → invite the bot to your server
6. Run this script

The script is IDEMPOTENT for the role + category + channel structure:
  - Roles that already exist (by name) are skipped
  - Categories that already exist are reused
  - Channels that already exist inside a category are skipped
So you can re-run it safely after editing the JSON to add new things.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

try:
    import discord
except ImportError:
    sys.exit("ERROR: discord.py not installed. Run: pip install discord.py")

# Sibling module — content for posted messages
sys.path.insert(0, str(Path(__file__).parent))
import messages as msg_content  # noqa: E402

LAYOUT_PATH = Path(__file__).parent / "server_layout.json"

# Discord built-in color names + DARTH_BANKAI brand palette → discord.Color
COLOR_MAP = {
    "red":    discord.Color.red(),
    "blue":   discord.Color.blue(),
    "green":  discord.Color.green(),
    "yellow": discord.Color.gold(),
    "orange": discord.Color.orange(),
    "purple": discord.Color.purple(),
    "pink":   discord.Color.magenta(),
    "teal":   discord.Color.teal(),
    "gold":   discord.Color.gold(),
    "navy":   discord.Color.dark_blue(),
    "grey":   discord.Color.light_grey(),
    "gray":   discord.Color.light_grey(),
    # DARTH_BANKAI brand palette (see Darth_bankai - branding/darth-bankai-brand-guide.html)
    "sith-purple":    discord.Color(0xB432FF),  # primary accent
    "neon-saber":     discord.Color(0xFF3388),  # secondary, pink/magenta
    "dark-sith":      discord.Color(0x4411AA),  # gradient endpoint, shadows
    "holo-blue":      discord.Color(0x2244CC),  # AI/ML, tech elements
    "soft-sith":      discord.Color(0x8866AA),  # muted purple
    "star-light":     discord.Color(0xE0D0F0),  # pale, body text accent
}


def color_from(name):
    """Resolve a color name or hex string (#RRGGBB) to discord.Color."""
    if not name:
        return discord.Color.default()
    if name.startswith("#"):
        try:
            return discord.Color(int(name[1:], 16))
        except ValueError:
            return discord.Color.default()
    return COLOR_MAP.get(name, discord.Color.default())


def find_role(guild, name):
    return discord.utils.get(guild.roles, name=name)


def find_category(guild, name):
    return discord.utils.get(guild.categories, name=name)


def find_channel_in_cat(category, name):
    for ch in category.channels:
        if ch.name == name.lower().replace(" ", "-"):
            return ch
        if ch.name == name:
            return ch
    return None


async def ensure_roles(guild, role_defs):
    print(f"\n[Roles] Ensuring {len(role_defs)} roles exist...")
    # Discord creates roles at the bottom of the hierarchy by default.
    # Iterate reversed so the "top" role in JSON ends up highest in the list.
    for rd in reversed(role_defs):
        name = rd["name"]
        existing = find_role(guild, name)
        if existing:
            print(f"  ✓ exists: {name}")
            continue
        try:
            await guild.create_role(
                name=name,
                color=color_from(rd.get("color", "default")),
                hoist=rd.get("hoist", False),
                mentionable=rd.get("mentionable", False),
                reason="setup_server.py — initial server build",
            )
            print(f"  + created: {name}")
        except Exception as e:
            print(f"  ✗ failed: {name} — {e}")


async def ensure_category(guild, cat_def):
    name = cat_def["name"]
    existing = find_category(guild, name)
    if existing:
        print(f"\n[Category] ✓ exists: {name}")
        return existing
    cat = await guild.create_category(name=name, reason="setup_server.py")
    print(f"\n[Category] + created: {name}")
    return cat


async def ensure_channels(guild, category, channel_defs):
    """Create text/voice channels within a category if they don't exist."""
    for cd in channel_defs:
        ch_name = cd["name"]
        ch_type = cd["type"]
        existing = find_channel_in_cat(category, ch_name)
        if existing:
            print(f"    ✓ exists: {ch_type:6} #{existing.name}")
            continue
        try:
            if ch_type == "text":
                ch = await guild.create_text_channel(
                    name=ch_name, category=category,
                    topic=cd.get("topic"),
                    reason="setup_server.py",
                )
            elif ch_type == "voice":
                ch = await guild.create_voice_channel(
                    name=ch_name, category=category,
                    reason="setup_server.py",
                )
            else:
                print(f"    ? unknown type {ch_type!r} for {ch_name}")
                continue
            print(f"    + created: {ch_type:6} #{ch.name}")
        except Exception as e:
            print(f"    ✗ failed: {ch_name} — {e}")


async def apply_category_restrictions(guild, layout):
    """
    Apply basic permission overwrites for sensitive categories:
      - Imperial Troopers → @Imperial Trooper only
      - Death Star Command → @Death Star Commander + @Emperor + @Emperor's Royal Guard
      - The Imperial Armory → verified roles only
      - Imperial Declarations → everyone reads, mods write
    """
    print("\n[Permissions] Applying category overwrites...")
    everyone = guild.default_role
    trooper = find_role(guild, "Imperial Trooper")
    rebel = find_role(guild, "Rebel Ally")
    padawan = find_role(guild, "Padawan")
    death_star = find_role(guild, "Death Star Commander")
    emperor = find_role(guild, "Emperor")
    royal_guard = find_role(guild, "Emperor's Royal Guard")

    restrictions = {
        "⚔️ Imperial Troopers": {
            everyone: discord.PermissionOverwrite(view_channel=False),
            trooper:  discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True),
        },
        "💀 Death Star Command": {
            everyone:     discord.PermissionOverwrite(view_channel=False),
            death_star:   discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True),
            emperor:      discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True),
            royal_guard:  discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True),
        },
        "🚀 The Imperial Armory": {
            everyone: discord.PermissionOverwrite(view_channel=False),
            trooper:  discord.PermissionOverwrite(view_channel=True, send_messages=True),
            rebel:    discord.PermissionOverwrite(view_channel=True, send_messages=True),
            padawan:  discord.PermissionOverwrite(view_channel=True, send_messages=True),
        },
        "📣 Imperial Declarations": {
            everyone:    discord.PermissionOverwrite(view_channel=True, send_messages=False, add_reactions=True),
            death_star:  discord.PermissionOverwrite(view_channel=True, send_messages=True),
            emperor:     discord.PermissionOverwrite(view_channel=True, send_messages=True),
            royal_guard: discord.PermissionOverwrite(view_channel=True, send_messages=True),
        },
    }

    for cat_name, overwrites in restrictions.items():
        cat = find_category(guild, cat_name)
        if not cat:
            print(f"  ? skipped {cat_name} (not found)")
            continue
        # Strip None role keys (e.g. if a role didn't exist yet)
        clean = {k: v for k, v in overwrites.items() if k is not None}
        try:
            await cat.edit(overwrites=clean, reason="setup_server.py — restrict access")
            # Propagate to child channels
            for ch in cat.channels:
                await ch.edit(sync_permissions=True)
            print(f"  ✓ restricted: {cat_name}")
        except Exception as e:
            print(f"  ✗ failed: {cat_name} — {e}")


async def apply_unverified_gating(guild, layout):
    """
    Lock every non-gateway, non-already-restricted category behind the
    verified roles (Padawan / Rebel Ally / Imperial Trooper). Unverified
    users keep @everyone, which is denied — so they can only see the
    gateway category until they react to the imperial-law message.
    """
    print("\n[Gating] Locking non-gateway categories behind verified roles...")
    everyone = guild.default_role
    verified_roles = [
        find_role(guild, name)
        for name in ("Padawan", "Rebel Ally", "Imperial Trooper")
    ]
    verified_roles = [r for r in verified_roles if r is not None]

    if not verified_roles:
        print("  ✗ no verified roles found — run ensure_roles first")
        return

    for cat_def in layout["categories"]:
        name = cat_def["name"]
        if name in msg_content.GATEWAY_CATEGORIES:
            print(f"  · gateway (open): {name}")
            continue
        if name in msg_content.ALREADY_RESTRICTED_CATEGORIES:
            print(f"  · already restricted elsewhere: {name}")
            continue
        cat = find_category(guild, name)
        if not cat:
            print(f"  ? not found: {name}")
            continue
        overwrites = {everyone: discord.PermissionOverwrite(view_channel=False)}
        for role in verified_roles:
            overwrites[role] = discord.PermissionOverwrite(view_channel=True)
        try:
            await cat.edit(overwrites=overwrites, reason="setup_server.py — Unverified gating")
            for ch in cat.channels:
                await ch.edit(sync_permissions=True)
            print(f"  ✓ gated: {name}")
        except Exception as e:
            print(f"  ✗ failed: {name} — {e}")


async def _find_existing(channel, marker):
    """Scan recent channel history for a bot message containing `marker`
    (in embed footer or message body). Returns the message or None."""
    me = channel.guild.me
    async for m in channel.history(limit=30):
        if m.author != me:
            continue
        # Plain text message
        if marker in (m.content or ""):
            return m
        # Embed footer
        for e in m.embeds:
            footer_text = (e.footer.text or "") if e.footer else ""
            if marker in footer_text:
                return m
    return None


async def post_darth_bot_guide(guild):
    """Post the pinned 'DARTH BOT — COMMAND DOSSIER' embed in
    #destiny-voyager so members see it on entry. Idempotent."""
    print("\n[Posts] Darth Bot command dossier in #destiny-voyager...")
    ch = discord.utils.get(guild.text_channels, name="destiny-voyager")
    if not ch:
        print("  ? #destiny-voyager not found")
        return
    existing = await _find_existing(ch, msg_content.DARTH_BOT_GUIDE_MARKER)
    if existing:
        print(f"  ✓ already posted (msg id {existing.id})")
        return
    embed = discord.Embed(
        title=msg_content.DARTH_BOT_GUIDE_TITLE,
        description=msg_content.DARTH_BOT_GUIDE_BODY,
        color=msg_content.SITH_PURPLE,
    )
    embed.set_footer(text=msg_content.DARTH_BOT_GUIDE_MARKER)
    m = await ch.send(embed=embed)
    try:
        await m.pin(reason="setup_server.py — Darth Bot dossier")
    except Exception:
        pass
    print(f"  + posted (msg id {m.id})")


async def post_welcome_and_rules(guild):
    """Post the #welcome and #imperial-law embeds, idempotently. Adds the
    ✅ verification reaction to the imperial-law message so reaction-role
    bots can wire it."""
    print("\n[Posts] Welcome + Imperial Law...")

    welcome_ch = discord.utils.get(guild.text_channels, name="welcome")
    rules_ch = discord.utils.get(guild.text_channels, name="imperial-law")

    if welcome_ch:
        existing = await _find_existing(welcome_ch, msg_content.WELCOME_MARKER)
        if existing:
            print(f"  ✓ already posted in #welcome (msg id {existing.id})")
        else:
            embed = discord.Embed(
                title=msg_content.WELCOME_TITLE,
                description=msg_content.WELCOME_BODY,
                color=msg_content.SITH_PURPLE,
            )
            embed.set_footer(text=msg_content.WELCOME_MARKER)
            m = await welcome_ch.send(embed=embed)
            try:
                await m.pin(reason="setup_server.py — welcome")
            except Exception:
                pass
            print(f"  + posted in #welcome (msg id {m.id})")
    else:
        print("  ? #welcome not found")

    rules_msg = None
    if rules_ch:
        existing = await _find_existing(rules_ch, msg_content.RULES_MARKER)
        if existing:
            print(f"  ✓ already posted in #imperial-law (msg id {existing.id})")
            rules_msg = existing
        else:
            embed = discord.Embed(
                title=msg_content.RULES_TITLE,
                description=msg_content.RULES_BODY,
                color=msg_content.SITH_PURPLE,
            )
            embed.set_footer(text=msg_content.RULES_MARKER)
            rules_msg = await rules_ch.send(embed=embed)
            try:
                await rules_msg.pin(reason="setup_server.py — imperial-law")
            except Exception:
                pass
            print(f"  + posted in #imperial-law (msg id {rules_msg.id})")

        if rules_msg:
            try:
                await rules_msg.add_reaction(msg_content.VERIFY_REACTION)
                print(f"  + ensured {msg_content.VERIFY_REACTION} reaction on imperial-law")
            except discord.errors.HTTPException as e:
                print(f"  ✗ couldn't add ✅ reaction: {e}")
            print(f"\n  >> WIRE THIS IN SAPPHIRE/MEE6:")
            print(f"     message_id={rules_msg.id} emoji=✅ role=@Padawan")
    else:
        print("  ? #imperial-law not found")


async def post_recruitment_messages(guild):
    """Post the 8 reaction-role messages into #recruitment-roles and add
    their reactions so they're pre-populated and ready to be wired in
    Sapphire/MEE6."""
    print("\n[Posts] Recruitment role messages...")
    ch = discord.utils.get(guild.text_channels, name="recruitment-roles")
    if not ch:
        print("  ? #recruitment-roles not found")
        return

    print(f"\n  >> WIRE THESE IN SAPPHIRE/MEE6 (emoji → role mappings in")
    print(f"     discord/pick_roles_messages.md):")

    for marker, body, reactions in msg_content.RECRUITMENT_MESSAGES:
        existing = await _find_existing(ch, marker)
        if existing:
            m = existing
            print(f"  ✓ already posted: {marker} (msg id {m.id})")
        else:
            m = await ch.send(body)
            try:
                await m.pin(reason="setup_server.py — recruitment-roles")
            except Exception:
                pass
            print(f"  + posted: {marker} (msg id {m.id})")

        for emoji in reactions:
            try:
                await m.add_reaction(emoji)
            except discord.errors.HTTPException as e:
                print(f"    ✗ couldn't add {emoji} reaction: {e}")

        if reactions:
            print(f"     message_id={m.id}  reactions: {' '.join(reactions)}")


class SetupClient(discord.Client):
    def __init__(self, layout, guild_id, skip_posts=False, **kw):
        intents = discord.Intents.default()
        intents.message_content = True  # needed to read existing posts for idempotency
        super().__init__(intents=intents, **kw)
        self.layout = layout
        self.guild_id = int(guild_id)
        self.skip_posts = skip_posts

    async def on_ready(self):
        print(f"\n[ready] Logged in as {self.user} (id={self.user.id})")
        guild = self.get_guild(self.guild_id)
        if not guild:
            print(f"ERROR: bot is not in guild {self.guild_id}. "
                  "Invite the bot first (OAuth2 → URL Generator with 'bot' scope).")
            await self.close()
            return

        print(f"[guild] {guild.name} ({guild.id}) — {len(guild.members)} members")

        await ensure_roles(guild, self.layout["roles"])

        for cat_def in self.layout["categories"]:
            cat = await ensure_category(guild, cat_def)
            await ensure_channels(guild, cat, cat_def.get("channels", []))

        await apply_category_restrictions(guild, self.layout)
        await apply_unverified_gating(guild, self.layout)

        if not self.skip_posts:
            await post_welcome_and_rules(guild)
            await post_recruitment_messages(guild)
            await post_darth_bot_guide(guild)
        else:
            print("\n[Posts] Skipped (--skip-posts).")

        print("\n[done] Server structure built. Next steps:")
        print("  1. Invite TicketTool.xyz and run /setup in #bounty-office")
        print("  2. Invite Sapphire (https://sapphirebot.dev) or MEE6 and wire the")
        print("     emoji → role mappings using the message IDs printed above")
        print("     (see discord/pick_roles_messages.md for the emoji table)")
        print("  3. Invite Charlemagne (https://warmind.io) — Destiny 2 stats bot")
        print("  4. Server Settings → Overview → set 'Inactive Channel' to '💤 Carbonite Chamber'")
        print("  5. Server Settings → Roles → drag 'Emperor' to the top above any bot roles")
        print()
        await self.close()


def main():
    layout = json.loads(LAYOUT_PATH.read_text())
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        sys.exit("ERROR: DISCORD_BOT_TOKEN env var not set. "
                 "Create a bot at https://discord.com/developers/applications "
                 "and export DISCORD_BOT_TOKEN=<token>")
    guild_id = os.environ.get("DISCORD_GUILD_ID") or layout.get("_target_server_id")
    if not guild_id:
        sys.exit("ERROR: DISCORD_GUILD_ID env var not set and no _target_server_id in JSON.")

    skip_posts = "--skip-posts" in sys.argv
    client = SetupClient(layout, guild_id, skip_posts=skip_posts)
    client.run(token)


if __name__ == "__main__":
    main()
