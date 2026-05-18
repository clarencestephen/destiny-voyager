"""
darth-bot/bot.py
================
Discord bot entry point. Run with:

    cd darth-bot
    python3 -m darth-bot.bot

Or once you've set DARTH_BOT_DISCORD_TOKEN in /home/cs/.env, just:
    python3 bot.py

Commands:
    /ask <question>           — any Destiny question
    /build <activity>         — build recommendation (uses your inventory)
    /raid <name>              — encounter rundown
    /catalyst <weapon>        — catalyst quest steps
    /sanity                   — verify ollama + kb + inventory are reachable

The bot also responds to @mentions in any allowed channel.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import discord
from discord import app_commands

from .config import (ALLOWED_CHANNEL_NAMES, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID,
                     MODEL)
from .llm import check_ollama
from .router import answer, classify

logging.basicConfig(level=logging.INFO,
                    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("darth-bot")


# Discord setup — minimal intents
intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True


class DarthBot(discord.Client):
    def __init__(self):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.guild = discord.Object(id=DISCORD_GUILD_ID)

    async def setup_hook(self):
        self.tree.copy_global_to(guild=self.guild)
        await self.tree.sync(guild=self.guild)

    async def on_ready(self):
        log.info(f"Connected as {self.user} (id={self.user.id})")
        log.info(f"Model: {MODEL}")
        if not await check_ollama():
            log.warning("Ollama not reachable or model not pulled — answers will fail "
                        "until `ollama pull %s` is done.", MODEL)


bot = DarthBot()


# ============================================================
# Helpers
# ============================================================


def _is_allowed_channel(channel) -> bool:
    if isinstance(channel, discord.DMChannel):
        return True
    return getattr(channel, "name", "") in ALLOWED_CHANNEL_NAMES


async def _reply_long(interaction: discord.Interaction, text: str):
    """Send a possibly-long answer in 2000-char chunks."""
    chunks = []
    while text:
        if len(text) <= 1900:
            chunks.append(text)
            break
        # split on paragraph boundary if possible
        split = text.rfind("\n\n", 0, 1900)
        if split < 800:
            split = text.rfind("\n", 0, 1900)
        if split < 800:
            split = 1900
        chunks.append(text[:split])
        text = text[split:].lstrip()
    for i, chunk in enumerate(chunks):
        if i == 0:
            await interaction.followup.send(chunk)
        else:
            await interaction.channel.send(chunk)


# ============================================================
# Slash commands
# ============================================================


@bot.tree.command(name="ask", description="Ask Darth Bot a Destiny 2 question")
@app_commands.describe(question="What do you want to know?")
async def cmd_ask(interaction: discord.Interaction, question: str):
    ch = getattr(interaction.channel, "name", "DM")
    log.info(f"/ask in #{ch}: {question[:80]}")
    await interaction.response.defer(thinking=True)
    try:
        text = await answer(question)
        log.info(f"/ask reply ({len(text)} chars): {text[:100]}")
    except Exception as e:
        log.exception("ask failed")
        text = f"⚠️  Something broke: `{e}`"
    await _reply_long(interaction, text)


@bot.tree.command(name="build",
                  description="Recommend a build using your current inventory")
@app_commands.describe(activity="Activity context (pvp, pve, raid, gm, solo ops)")
async def cmd_build(interaction: discord.Interaction, activity: str = "pve"):
    await interaction.response.defer(thinking=True)
    question = f"What is a good {activity} build with my current weapons and armor?"
    try:
        text = await answer(question)
    except Exception as e:
        text = f"⚠️  {e}"
    await _reply_long(interaction, text)


@bot.tree.command(name="raid",
                  description="Summarize a raid's encounters")
@app_commands.describe(name="Raid name (e.g., 'salvations edge')")
async def cmd_raid(interaction: discord.Interaction, name: str):
    await interaction.response.defer(thinking=True)
    question = f"Can you summarize the main roles and encounters for the {name} raid?"
    try:
        text = await answer(question)
    except Exception as e:
        text = f"⚠️  {e}"
    await _reply_long(interaction, text)


@bot.tree.command(name="catalyst",
                  description="How to get a weapon's catalyst")
@app_commands.describe(weapon="Weapon name (e.g., 'crimson')")
async def cmd_catalyst(interaction: discord.Interaction, weapon: str):
    await interaction.response.defer(thinking=True)
    question = f"How do I get the {weapon} catalyst, step by step?"
    try:
        text = await answer(question)
    except Exception as e:
        text = f"⚠️  {e}"
    await _reply_long(interaction, text)


@bot.tree.command(
    name="inventory",
    description="Show a summary of your Destiny 2 inventory (vault + equipped)",
)
@app_commands.describe(focus="Filter: all, weapons, armor, hunter, titan, warlock")
async def cmd_inventory(interaction: discord.Interaction, focus: str = "all"):
    await interaction.response.defer(thinking=True)
    try:
        from .inventory import build_context, has_inventory
        if not has_inventory():
            await interaction.followup.send(
                "No inventory found. Link your Bungie account in Destiny Voyager first "
                "(`/link-bungie` to start) or run `python3 fetch_inventory.py`."
            )
            return
        text = build_context(focus=focus, max_items=40)
        if not text:
            await interaction.followup.send("Inventory is empty or unreadable.")
            return
        await _reply_long(interaction, f"```\n{text[:1800]}\n```")
    except Exception as e:
        await interaction.followup.send(f"⚠️ {e}")


@bot.tree.command(
    name="loadout-check",
    description="Analyze your current loadout vs the current meta",
)
@app_commands.describe(activity="pvp | pve | raid | gm (default: pve)")
async def cmd_loadout_check(interaction: discord.Interaction, activity: str = "pve"):
    await interaction.response.defer(thinking=True)
    q = (f"Analyze my current loadout against the current {activity} meta. "
         f"What am I doing right, what should I swap, what's missing?")
    try:
        text = await answer(q)
    except Exception as e:
        text = f"⚠️ {e}"
    await _reply_long(interaction, text)


@bot.tree.command(
    name="upgrade",
    description="What should you chase next, given your inventory?",
)
@app_commands.describe(activity="pvp | pve | raid | gm | trials (default: pve)")
async def cmd_upgrade(interaction: discord.Interaction, activity: str = "pve"):
    await interaction.response.defer(thinking=True)
    q = (f"Based on my current inventory, what specific items should I chase next "
         f"to improve my {activity} setup? Prioritize 3-5 specific items.")
    try:
        text = await answer(q)
    except Exception as e:
        text = f"⚠️ {e}"
    await _reply_long(interaction, text)


@bot.tree.command(
    name="link-bungie",
    description="Link your Discord account to your Bungie account via Destiny Voyager",
)
async def cmd_link_bungie(interaction: discord.Interaction):
    """Calls the backend /link/start endpoint, DMs the user the one-time URL."""
    import os
    import httpx

    backend = os.environ.get("BACKEND_BASE_URL", "http://localhost:8080")
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{backend}/link/start",
                json={"discord_id": str(interaction.user.id)},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        await interaction.followup.send(f"⚠️ Couldn't reach backend: `{e}`", ephemeral=True)
        return

    url = data.get("url", "")
    msg = (
        f"🔗  **Link your Bungie account**\n\n"
        f"Click here to sign in with Bungie (good for {data.get('expires_in', 600)//60} min):\n"
        f"<{url}>\n\n"
        f"After signing in, Destiny Voyager will see your inventory and Darth Bot can "
        f"answer personalized questions like `/loadout-check` and `/upgrade`."
    )
    # Try to DM, fall back to ephemeral channel reply
    try:
        dm = await interaction.user.create_dm()
        await dm.send(msg)
        await interaction.followup.send(
            "Check your DMs — I sent you a sign-in link.", ephemeral=True,
        )
    except discord.errors.Forbidden:
        await interaction.followup.send(msg, ephemeral=True)


@bot.tree.command(name="sanity",
                  description="Verify Darth Bot's backend services")
async def cmd_sanity(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)
    bits = []
    bits.append(f"Model: `{MODEL}`")
    bits.append(f"Ollama: {'✅ reachable' if await check_ollama() else '❌ unreachable / model not pulled'}")
    try:
        from .kb.retrieve import _collection
        n = _collection().count()
        bits.append(f"Knowledge base: {'✅' if n > 0 else '⚠️ empty'} ({n} chunks)")
    except Exception as e:
        bits.append(f"Knowledge base: ❌ {e}")
    try:
        from .inventory import has_inventory
        bits.append(f"Inventory cache: {'✅' if has_inventory() else '⚠️ not populated'}")
    except Exception as e:
        bits.append(f"Inventory cache: ❌ {e}")
    # Backend reachability
    import os
    backend = os.environ.get("BACKEND_BASE_URL", "http://localhost:8080")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{backend}/health")
        bits.append(f"Backend ({backend}): {'✅' if r.status_code == 200 else f'❌ HTTP {r.status_code}'}")
    except Exception as e:
        bits.append(f"Backend ({backend}): ❌ {type(e).__name__}")
    await interaction.followup.send("\n".join(bits))


# ============================================================
# @mention listener
# ============================================================


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if bot.user not in message.mentions:
        return
    if not _is_allowed_channel(message.channel):
        return

    # Strip the mention from the message
    content = message.content
    for mention in [f"<@{bot.user.id}>", f"<@!{bot.user.id}>"]:
        content = content.replace(mention, "")
    content = content.strip()
    if not content:
        return

    async with message.channel.typing():
        try:
            text = await answer(content)
        except Exception as e:
            text = f"⚠️  {e}"

    # Reply, chunked
    while text:
        chunk, text = text[:1900], text[1900:].lstrip()
        await message.reply(chunk, mention_author=False)


# ============================================================
# Bootstrap
# ============================================================


def main():
    if not DISCORD_BOT_TOKEN:
        raise SystemExit(
            "ERROR: DARTH_BOT_DISCORD_TOKEN (or DISCORD_BOT_TOKEN) not set. "
            "Create a bot at https://discord.com/developers/applications, copy "
            "the token, and add it to /home/cs/.env."
        )
    bot.run(DISCORD_BOT_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
