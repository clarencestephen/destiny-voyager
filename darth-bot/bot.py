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

from config import (ALLOWED_CHANNEL_NAMES, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID,
                     MODEL)
from llm import check_ollama
from router import answer, classify

logging.basicConfig(level=logging.INFO,
                    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("darth-bot")


# Discord setup — intents needed for: messages (KB answers), members
# (role assignment for /verify-clan + reaction-roles), reactions
# (native reaction-role handling, replaces MEE6/Sapphire).
intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True
intents.reactions = True


class DarthBot(discord.Client):
    def __init__(self):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.guild = discord.Object(id=DISCORD_GUILD_ID)
        self.reaction_roles = None  # set in on_ready after attach()

    async def setup_hook(self):
        self.tree.copy_global_to(guild=self.guild)
        await self.tree.sync(guild=self.guild)

    async def on_ready(self):
        log.info(f"Connected as {self.user} (id={self.user.id})")
        log.info(f"Model: {MODEL}")
        if not await check_ollama():
            log.warning("Ollama not reachable or model not pulled — answers will fail "
                        "until `ollama pull %s` is done.", MODEL)
        if self.reaction_roles:
            await self.reaction_roles.refresh()


bot = DarthBot()

# Wire native reaction-role handling (replaces MEE6/Sapphire).
import reaction_roles
bot.reaction_roles = reaction_roles.attach(bot, DISCORD_GUILD_ID)


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
    name="help",
    description="Show what Darth Bot can do (all commands grouped by purpose)",
)
async def cmd_help(interaction: discord.Interaction):
    text = (
        "**▲ DARTH BOT — COMMAND DOSSIER**\n"
        "_The Empire's Destiny 2 assistant. Anti-hallucination, manifest-grounded, "
        "current-meta aware._\n\n"
        "**ASK ANYTHING**\n"
        "`/ask <question>` — any Destiny 2 question. Catalyst quests, raid mechanics, "
        "mod descriptions, current meta. Replies in the same channel.\n"
        "`@Darth Bot <question>` — same as `/ask`, but mention-style.\n\n"
        "**INVENTORY-AWARE** (link your account first with `/link-bungie`)\n"
        "`/inventory [focus]` — your vault + equipped gear, filtered by all / weapons / "
        "armor / hunter / titan / warlock.\n"
        "`/loadout-check [activity]` — analyze your current loadout vs the current "
        "PvP/PvE meta. Defaults to PvE.\n"
        "`/upgrade [activity]` — your next 3-5 chase items based on gaps in your "
        "inventory vs meta lists.\n"
        "`/build [activity]` — recommend a full build using your inventory.\n\n"
        "**LOOKUPS**\n"
        "`/raid <name>` — encounter rundown for any raid.\n"
        "`/catalyst <weapon>` — how to get a weapon's catalyst.\n\n"
        "**STRUCTURED BUILDS** (no LLM — fast, deterministic)\n"
        "`/builds [class]` — list curated builds (46 entries). Filter: hunter / titan / warlock / all.\n"
        "`/build-show <id>` — full detail for one build (exotic, weapons, target stats, playstyle).\n"
        "`/recipes <encounter> [role]` — weapon loadout for a raid/dungeon encounter "
        "(e.g. `/recipes crota` or `/recipes oryx role:DPS`).\n"
        "`/fireteam <names>` — public equipped gear for 1-6 Bungie names "
        "(format: `Name#1234, Other#5678`).\n"
        "`/equip <build_id> [character]` — equip a build's items in-game on your guardian "
        "(needs `/link-bungie` first).\n\n"
        "**ACCOUNT**\n"
        "`/link-bungie` — DM yourself a one-time URL. Sign in with Bungie once on "
        "the Destiny Voyager web. Stays signed in for 30 days. Required for the "
        "inventory-aware commands above.\n\n"
        "**TROUBLESHOOTING**\n"
        "`/sanity` — verify ollama + KB + inventory cache + backend are all healthy.\n\n"
        "**WEB (same brain, browser UI)**\n"
        "https://destiny-voyager.clarencestephen.com/chat — chatbot in your browser, "
        "same answers as Discord, no install required."
    )
    await interaction.response.send_message(text, ephemeral=True)


@bot.tree.command(
    name="inventory",
    description="Show a summary of your Destiny 2 inventory (vault + equipped)",
)
@app_commands.describe(focus="Filter: all, weapons, armor, hunter, titan, warlock")
async def cmd_inventory(interaction: discord.Interaction, focus: str = "all"):
    await interaction.response.defer(thinking=True)
    try:
        from inventory import build_context, has_inventory
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


@bot.tree.command(
    name="verify-clan",
    description="Check your Bungie account against Order 66 — auto-assigns @Imperial Trooper if you're in",
)
async def cmd_verify_clan(interaction: discord.Interaction):
    """Looks up the user's linked Bungie account, checks if they're in
    Order 66 (groupId 5421866). If yes, assigns @Imperial Trooper."""
    import bungie_clan
    await interaction.response.defer(ephemeral=True, thinking=True)

    result = await bungie_clan.check_clan_membership(str(interaction.user.id))
    if result.get("error") and not result.get("bungie_id"):
        # Not linked, or backend down
        await interaction.followup.send(
            f"⚠️  {result['error']}\n\n"
            f"Once linked, re-run `/verify-clan` to claim `@Imperial Trooper`.",
            ephemeral=True,
        )
        return
    if result.get("error"):
        await interaction.followup.send(
            f"⚠️  Couldn't check Bungie clan membership: {result['error']}\n"
            f"Bungie ID: `{result['bungie_id']}`",
            ephemeral=True,
        )
        return

    display = result.get("display_name") or "Guardian"

    if not result["in_clan"]:
        await interaction.followup.send(
            f"❌  **{display}**, your Bungie account isn't a member of Order 66 yet.\n\n"
            f"Apply for the in-game clan here:\n"
            f"🔗  https://www.bungie.net/7/en/Clan/Profile/5421866\n\n"
            f"Once an officer accepts you in-game, re-run `/verify-clan` and "
            f"I'll auto-promote you to `@Imperial Trooper`.",
            ephemeral=True,
        )
        return

    # In the clan — assign @Imperial Trooper
    guild = interaction.guild
    if not guild:
        await interaction.followup.send("⚠️  Run this in the server, not DM.", ephemeral=True)
        return
    role = discord.utils.get(guild.roles, name="Imperial Trooper")
    if not role:
        await interaction.followup.send(
            "⚠️  `@Imperial Trooper` role doesn't exist on this server. "
            "Tell a mod.", ephemeral=True,
        )
        return
    member = interaction.user if isinstance(interaction.user, discord.Member) \
             else guild.get_member(interaction.user.id)
    if not member:
        await interaction.followup.send("⚠️  Couldn't resolve your guild membership.", ephemeral=True)
        return
    if role in member.roles:
        await interaction.followup.send(
            f"✅  **{display}**, you're already in Order 66 and already have "
            f"`@Imperial Trooper`. Welcome back.",
            ephemeral=True,
        )
        return
    try:
        await member.add_roles(role, reason="/verify-clan: verified Order 66 member")
    except discord.Forbidden:
        await interaction.followup.send(
            "⚠️  I don't have permission to assign roles. Tell a mod to give "
            "Darth Bot the `Manage Roles` permission, and ensure my role sits "
            "ABOVE `@Imperial Trooper` in the role list.", ephemeral=True,
        )
        return

    await interaction.followup.send(
        f"⚔️  **{display}**, welcome to the Empire. You've been promoted to "
        f"`@Imperial Trooper` — full clan-channel access is unlocked.\n\n"
        f"*Together we will rule the galaxy.*",
        ephemeral=True,
    )


@bot.tree.command(name="sanity",
                  description="Verify Darth Bot's backend services")
async def cmd_sanity(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)
    bits = []
    bits.append(f"Model: `{MODEL}`")
    bits.append(f"Ollama: {'✅ reachable' if await check_ollama() else '❌ unreachable / model not pulled'}")
    try:
        from kb.retrieve import _collection
        n = _collection().count()
        bits.append(f"Knowledge base: {'✅' if n > 0 else '⚠️ empty'} ({n} chunks)")
    except Exception as e:
        bits.append(f"Knowledge base: ❌ {e}")
    try:
        from inventory import has_inventory
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
# Web-app parity commands — read shared JSON sources
# ============================================================
#
# These commands surface the structured data that powers the
# destiny-voyager.clarencestephen.com web app — /builds, /optimizer,
# /play, /fireteam — so Discord users get parity without leaving the
# server. They DO NOT call the LLM — they're fast deterministic lookups
# against builds.json + weapon-recipes.json on the public site.
#
# Net new commands:
#   /builds [class]        — list curated builds (46 currently)
#   /build-show <id>       — full detail for one build
#   /recipes <encounter>   — weapon loadout for a raid/dungeon encounter
#   /fireteam <names>      — equipped gear summary for 1-6 Bungie names
# ============================================================

_WEB_BASE = "https://destiny-voyager.clarencestephen.com"


async def _resolve_bungie_id(discord_id: str) -> dict | None:
    """Call the FastAPI backend's link DB to get this Discord user's Bungie pairing.
    Returns the link record dict or None if not linked / backend down.
    """
    import os, httpx
    backend = os.environ.get("BACKEND_BASE_URL", "http://localhost:8090")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{backend}/link/discord/{discord_id}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
    except Exception:
        return None


async def _bot_internal_post(path: str, body: dict) -> dict:
    """POST to the Worker's /api/internal/* routes with the shared bot secret.
    Raises on non-2xx; returns parsed JSON.
    """
    import os, httpx
    secret = os.environ.get("DV_BOT_SECRET", "")
    if not secret:
        raise RuntimeError("DV_BOT_SECRET not set in environment")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{_WEB_BASE}{path}",
            json=body,
            headers={"X-Internal-Bot-Secret": secret, "Content-Type": "application/json"},
        )
        r.raise_for_status()
        return r.json()


async def _fetch_json(path: str) -> dict:
    """Cache-friendly fetch of a public JSON asset on the web app."""
    import httpx
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_WEB_BASE}{path}")
        r.raise_for_status()
        return r.json()


def _class_emoji(cls: str) -> str:
    return {"Hunter": "🏹", "Titan": "🛡", "Warlock": "✨"}.get(cls, "•")


@bot.tree.command(
    name="builds",
    description="List curated builds (filtered by class)",
)
@app_commands.describe(klass="Class filter: hunter | titan | warlock | all (default: all)")
async def cmd_builds(interaction: discord.Interaction, klass: str = "all"):
    await interaction.response.defer(thinking=True)
    try:
        data = await _fetch_json("/builds.json")
    except Exception as e:
        await interaction.followup.send(f"⚠️ Couldn't load builds.json: {e}")
        return
    builds = data.get("builds", [])
    klass_norm = klass.strip().lower()
    if klass_norm not in ("all", "hunter", "titan", "warlock"):
        klass_norm = "all"
    target_cls = klass_norm.capitalize() if klass_norm != "all" else None
    filtered = [b for b in builds if target_cls is None or b.get("class") == target_cls or b.get("class") == "Any"]
    if not filtered:
        await interaction.followup.send(f"No builds for `{klass_norm}`.")
        return

    # Group by source-prefix so the user sees Personal, darth_bankai,
    # Community, Starter cleanly.
    def src(b: dict) -> str:
        bid = b.get("id", "")
        if bid.startswith("personal-"):     return "Personal"
        if bid.startswith("darth-bankai-"): return "darth_bankai"
        if bid.startswith("community-"):    return "Community"
        return "Starter"

    groups: dict[str, list[dict]] = {}
    for b in filtered:
        groups.setdefault(src(b), []).append(b)

    embed = discord.Embed(
        title=f"▲ BUILDS — {target_cls or 'all classes'}",
        description=f"{len(filtered)} curated builds. Use `/build-show <id>` for the full detail.",
        color=0xB432FF,
    )
    for src_name in ["darth_bankai", "Personal", "Community", "Starter"]:
        group = groups.get(src_name)
        if not group:
            continue
        lines = []
        for b in group[:12]:  # cap to keep embed under 6000 chars
            ex_opts = b.get("exotic_armor", {}).get("options", [])
            ex = ex_opts[0] if ex_opts else "—"
            lines.append(f"`{b['id']}`  {_class_emoji(b['class'])} **{b['name'][:55]}** · {ex[:35]}")
        if len(group) > 12:
            lines.append(f"_…and {len(group) - 12} more in this source_")
        embed.add_field(name=f"{src_name} ({len(group)})", value="\n".join(lines), inline=False)
    embed.set_footer(text=f"Full list + Equip button at {_WEB_BASE}/builds")
    await interaction.followup.send(embed=embed)


@bot.tree.command(
    name="build-show",
    description="Show the full detail of one build by id",
)
@app_commands.describe(build_id="Build id (run /builds to see ids)")
async def cmd_build_show(interaction: discord.Interaction, build_id: str):
    await interaction.response.defer(thinking=True)
    try:
        data = await _fetch_json("/builds.json")
    except Exception as e:
        await interaction.followup.send(f"⚠️ {e}")
        return
    b = next((x for x in data.get("builds", []) if x.get("id") == build_id.strip()), None)
    if not b:
        await interaction.followup.send(f"No build with id `{build_id}`. Run `/builds` to see ids.")
        return

    ex_opts = b.get("exotic_armor", {}).get("options", []) or ["(none)"]
    weps = b.get("weapons", {})
    target_stats = b.get("target_stats", {})

    embed = discord.Embed(
        title=f"{_class_emoji(b['class'])}  {b['name']}",
        description=b.get("playstyle", "")[:1900],
        color=0xB432FF,
        url=f"{_WEB_BASE}/builds",
    )
    embed.add_field(
        name="Class · Subclass · Focus",
        value=f"{b['class']} · {b.get('subclass','')} · {b.get('focus','')}",
        inline=False,
    )
    embed.add_field(
        name="Exotic Armor",
        value=" / ".join(ex_opts),
        inline=False,
    )
    embed.add_field(name="Kinetic", value=" / ".join(weps.get("kinetic", [])) or "—", inline=True)
    embed.add_field(name="Energy",  value=" / ".join(weps.get("energy",  [])) or "—", inline=True)
    embed.add_field(name="Heavy",   value=" / ".join(weps.get("heavy",   [])) or "—", inline=True)
    if b.get("aspects"):
        embed.add_field(name="Aspects",   value=" · ".join(b["aspects"])[:1024], inline=False)
    if b.get("fragments"):
        embed.add_field(name="Fragments", value=" · ".join(b["fragments"])[:1024], inline=False)
    if target_stats:
        ts = " · ".join(f"{k.capitalize()} {v}+" for k, v in target_stats.items() if v)
        embed.add_field(name="Target stats", value=ts or "—", inline=False)
    if b.get("source"):
        embed.set_footer(text=b["source"][:200])
    await interaction.followup.send(embed=embed)


@bot.tree.command(
    name="recipes",
    description="Weapon loadout for a specific raid/dungeon encounter",
)
@app_commands.describe(
    encounter="Encounter name (e.g. 'crota', 'oryx', 'atheon'). Substring match.",
    role="Optional role filter: DPS | Add-clear | Support",
)
async def cmd_recipes(interaction: discord.Interaction, encounter: str, role: str = ""):
    await interaction.response.defer(thinking=True)
    try:
        data = await _fetch_json("/weapon-recipes.json")
    except Exception as e:
        await interaction.followup.send(f"⚠️ {e}")
        return
    recipes = data.get("recipes", [])
    q = encounter.strip().lower()
    role_q = role.strip().lower() if role else ""
    matches = [
        r for r in recipes
        if q in r.get("encounter", "").lower() or q in r.get("raid", "").lower()
    ]
    if role_q:
        matches = [r for r in matches if r.get("role", "").lower() == role_q]
    if not matches:
        await interaction.followup.send(
            f"No recipes matching `{encounter}`"
            + (f" with role `{role}`" if role else "")
            + f". See {_WEB_BASE}/play for the full list."
        )
        return

    embed = discord.Embed(
        title=f"▲ WEAPONS — {encounter}",
        description=f"{len(matches)} loadout(s). Full per-slot ownership + Equip at {_WEB_BASE}/play",
        color=0xB432FF,
    )
    for r in matches[:6]:
        weps = r.get("weapons", {})
        v = (
            f"**K:** {' / '.join(weps.get('kinetic', [])) or '—'}\n"
            f"**E:** {' / '.join(weps.get('energy',  [])) or '—'}\n"
            f"**H:** {' / '.join(weps.get('heavy',   [])) or '—'}\n"
            f"_{r.get('rationale','')[:300]}_"
        )
        embed.add_field(
            name=f"{r.get('role','?')} · {r.get('raid','?')} → {r.get('encounter','?')}",
            value=v[:1024],
            inline=False,
        )
    await interaction.followup.send(embed=embed)


@bot.tree.command(
    name="fireteam",
    description="Look up the public equipped gear for 1-6 Bungie names (Name#1234)",
)
@app_commands.describe(names="Comma- or space-separated Bungie names (e.g., 'Foo#1234, Bar#5678')")
async def cmd_fireteam(interaction: discord.Interaction, names: str):
    await interaction.response.defer(thinking=True)
    import re, httpx, os
    # Split on commas, spaces, or newlines
    name_list = [n.strip() for n in re.split(r"[,\n]+", names) if n.strip()]
    if not name_list:
        await interaction.followup.send("No names parsed. Use `Name#1234` format.")
        return
    if len(name_list) > 6:
        name_list = name_list[:6]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{_WEB_BASE}/api/fireteam",
                json={"bungie_names": name_list},
            )
            r.raise_for_status()
            resp = r.json()
    except Exception as e:
        await interaction.followup.send(f"⚠️ Fireteam lookup failed: {e}")
        return

    members = resp.get("members", [])
    if not members:
        await interaction.followup.send("No results.")
        return

    embed = discord.Embed(
        title="▲ FIRETEAM",
        description=f"Public equipment for {len(members)} guardian(s). Click-to-expand at {_WEB_BASE}/fireteam",
        color=0xB432FF,
    )
    for m in members:
        if "error" in m:
            embed.add_field(
                name=m.get("bungie_name", "?"),
                value=f"⚠️ {m['error']}",
                inline=False,
            )
            continue
        chars = m.get("characters", [])
        if not chars:
            continue
        top = chars[0]  # highest light
        eq = {it.get("slot", ""): it for it in top.get("equipped", [])}
        # We don't have item names without the manifest, so just show
        # slot occupancy + power. Web app does the decoration.
        slots = ["Kinetic", "Energy", "Heavy", "Helmet", "Gauntlets", "Chest", "Legs", "Class"]
        lines = []
        for s in slots:
            it = eq.get(s)
            if it:
                lines.append(f"**{s[:4]}** pw {it.get('power', '?')}")
            else:
                lines.append(f"_{s[:4]} —_")
        embed.add_field(
            name=f"{_class_emoji(top['class'].capitalize())}  {m.get('display_name','?')}  ·  {top['class']}  ·  pw {top.get('light', '?')}",
            value=" · ".join(lines),
            inline=False,
        )
    await interaction.followup.send(embed=embed)


@bot.tree.command(
    name="equip",
    description="Equip a build onto your Bungie account (needs /link-bungie first)",
)
@app_commands.describe(
    build_id="Build id (run /builds to see ids)",
    character="Optional: hunter | titan | warlock (defaults to your highest-light)",
)
async def cmd_equip(interaction: discord.Interaction, build_id: str, character: str = ""):
    await interaction.response.defer(ephemeral=True, thinking=True)
    discord_id = str(interaction.user.id)

    # 1. Resolve linked Bungie account
    link = await _resolve_bungie_id(discord_id)
    if not link:
        await interaction.followup.send(
            "⚠️ You haven't linked a Bungie account yet. Run `/link-bungie` first.",
            ephemeral=True,
        )
        return
    bungie_id = link.get("bungie_id")

    # 2. Load build + user's inventory in parallel
    try:
        import asyncio
        builds_data, inv = await asyncio.gather(
            _fetch_json("/builds.json"),
            _bot_internal_post("/api/internal/inventory", {"bungie_id": bungie_id}),
        )
    except Exception as e:
        await interaction.followup.send(f"⚠️ Couldn't fetch inventory or builds: `{e}`", ephemeral=True)
        return
    build = next((b for b in builds_data.get("builds", []) if b.get("id") == build_id.strip()), None)
    if not build:
        await interaction.followup.send(f"No build `{build_id}`. Run `/builds`.", ephemeral=True)
        return

    # 3. Pick target character
    chars = inv.get("characters", [])
    if not chars:
        await interaction.followup.send("⚠️ Your linked profile has no characters.", ephemeral=True)
        return
    target_char = None
    if character:
        cls_match = character.strip().capitalize()
        target_char = next((c for c in chars if c["class"] == cls_match), None)
    if not target_char:
        # Default: highest-light. Worker already sorts chars desc.
        target_char = chars[0]

    # 4. Build needs the slim manifest to match item names → instance IDs
    try:
        manifest = await _fetch_json("/manifest.json")
    except Exception as e:
        await interaction.followup.send(f"⚠️ Couldn't load manifest: `{e}`", ephemeral=True)
        return

    # 5. Match build items → owned instance IDs (best-effort, name-based)
    def name_of(hash_: int) -> str:
        return (manifest.get(str(hash_)) or {}).get("n") or ""

    items_by_hash: dict[int, list[dict]] = {}
    for it in inv.get("items", []):
        items_by_hash.setdefault(it["hash"], []).append(it)

    def find_first_owned(option_names: list[str]) -> dict | None:
        wanted = {n.lower().strip() for n in option_names if n}
        if not wanted:
            return None
        for hash_, instances in items_by_hash.items():
            n = name_of(hash_).lower().strip()
            if n and n in wanted:
                return instances[0]  # take the first instance (any works for equip)
        return None

    weapons = build.get("weapons", {})
    matched: list[tuple[str, dict | None]] = [
        ("Kinetic",  find_first_owned(weapons.get("kinetic", []))),
        ("Energy",   find_first_owned(weapons.get("energy",  []))),
        ("Heavy",    find_first_owned(weapons.get("heavy",   []))),
    ]
    # Exotic armor
    ex_opts = build.get("exotic_armor", {}).get("options", [])
    if ex_opts:
        matched.append(("Exotic Armor", find_first_owned(ex_opts)))

    instance_ids = [m[1]["instance_id"] for m in matched if m[1]]
    if not instance_ids:
        slots_missing = ", ".join(label for label, _ in matched)
        await interaction.followup.send(
            f"⚠️ Couldn't find any owned items for build **{build['name']}** "
            f"(missing: {slots_missing}). Browse `/build-show {build_id}` for the requirements.",
            ephemeral=True,
        )
        return

    # 6. Equip via Worker internal route
    try:
        result = await _bot_internal_post("/api/internal/equip", {
            "bungie_id": bungie_id,
            "character_id": target_char["id"],
            "item_instance_ids": instance_ids,
        })
    except Exception as e:
        await interaction.followup.send(f"⚠️ Equip failed: `{e}`", ephemeral=True)
        return

    # 7. Report
    owned_lines = "\n".join(
        f"  ✓ **{label}** → {(item and name_of(item['hash'])) or '(skipped)'}"
        for label, item in matched if item
    )
    missing_lines = "\n".join(
        f"  ✗ **{label}** — none of: {', '.join(opts) or '—'}"
        for (label, item), opts in zip(
            matched,
            [weapons.get("kinetic", []), weapons.get("energy", []),
             weapons.get("heavy", []), ex_opts],
        ) if not item
    )
    skipped_txt = ""
    if result.get("skipped"):
        skipped_txt = "\n_Skipped:_ " + " · ".join(s["reason"] for s in result["skipped"][:4])

    embed = discord.Embed(
        title=f"▲ Equipped — {build['name']}",
        description=(
            f"On **{target_char['class']}** (pw {target_char['light']}). "
            f"Equipped **{result['equipped_count']}/{len(instance_ids)}**.\n\n"
            f"{owned_lines}\n{missing_lines}{skipped_txt}"
        )[:4000],
        color=0xB432FF,
    )
    await interaction.followup.send(embed=embed, ephemeral=True)


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
# /this-week — Kyber-Community-parity vendor rotation feed.
# Phase 1+2: vendors only (Xur / Ada-1 / Banshee / Rahool / Eververse).
# Phase 3 (milestones) + Phase 4 (TWID) land in future updates — see
# THIS_WEEK_PLAN.md at the repo root.
# ============================================================

_VENDOR_KEYS = ["xur", "ada1", "banshee", "rahool", "eververse"]

_VENDOR_EMOJI = {
    "xur":       "🛸",
    "ada1":      "🛡️",
    "banshee":   "🔧",
    "rahool":    "🔮",
    "eververse": "✨",
}


def _format_refresh(seconds: int) -> str:
    if seconds <= 0:
        return "any moment"
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m, _   = divmod(rem, 60)
    if d > 0: return f"{d}d {h}h"
    if h > 0: return f"{h}h {m}m"
    return f"{m}m"


@bot.tree.command(
    name="this-week",
    description="Weekly vendor rotations — Xur, Ada-1, Banshee, Rahool, Eververse",
)
@app_commands.describe(
    vendor="Optional: focus one vendor (xur / ada1 / banshee / rahool / eververse)",
)
async def cmd_this_week(
    interaction: discord.Interaction, vendor: str = "",
):
    await interaction.response.defer(ephemeral=False, thinking=True)
    discord_id = str(interaction.user.id)

    link = await _resolve_bungie_id(discord_id)
    if not link:
        await interaction.followup.send(
            "⚠️ You haven't linked a Bungie account yet. Run `/link-bungie` first.",
            ephemeral=True,
        )
        return
    bungie_id = link.get("bungie_id")

    try:
        import asyncio
        data, manifest = await asyncio.gather(
            _bot_internal_post("/api/internal/this-week", {"bungie_id": bungie_id}),
            _fetch_json("/manifest.json"),
        )
    except Exception as e:
        await interaction.followup.send(f"⚠️ This-week fetch failed: `{e}`", ephemeral=True)
        return

    vendors = data.get("vendors", {}) or {}
    vendor_key = vendor.strip().lower()

    # Slim-manifest decorator — `n` (name), `t` (type), `r` (rarity/tier)
    # keys mirror web/scripts/bake-slim-manifest.mjs. Falls back gracefully
    # when a hash isn't in the slim set (e.g. some vendor decorative items).
    def decorate_item(item: dict) -> dict:
        m = manifest.get(str(item.get("hash"))) or {}
        return {
            **item,
            "name": m.get("n") or f"#{item.get('hash', '?')}",
            "type": m.get("t") or "",
            "tier": m.get("r") or "",
        }

    def decorate_cost(cost: list) -> str:
        if not cost:
            return ""
        parts = []
        for c in cost:
            ch = c.get("currency_hash")
            name = (manifest.get(str(ch)) or {}).get("n") or f"hash:{ch}"
            parts.append(f"{c.get('quantity', 0):,} {name}")
        return " + ".join(parts)

    # ── Single-vendor deep dive ──────────────────────────────
    if vendor_key:
        if vendor_key not in _VENDOR_KEYS:
            await interaction.followup.send(
                f"Unknown vendor `{vendor_key}`. Try one of: {', '.join(_VENDOR_KEYS)}.",
                ephemeral=True,
            )
            return
        v = vendors.get(vendor_key)
        if not v:
            await interaction.followup.send(
                f"{_VENDOR_EMOJI[vendor_key]} **{vendor_key}** — no data this week.",
            )
            return
        emb = discord.Embed(
            title=f"{_VENDOR_EMOJI[vendor_key]} {v.get('display_name', vendor_key)}",
            color=0x6a3aa6,
        )
        if v.get("location"):
            loc = v["location"]
            emb.add_field(
                name="📍 Location",
                value=f"{loc.get('name', '?')} · {loc.get('planet', '?')}",
                inline=False,
            )
        if not v.get("available", True):
            emb.description = (
                v.get("notes")
                or f"Returns in {_format_refresh(v.get('refresh_in_seconds', 0))}."
            )
        else:
            emb.description = v.get("notes", "")
            items_raw = v.get("items", []) or []
            items = [decorate_item(it) for it in items_raw]
            # Tier emoji prefix: exotic items get 🟡, legendaries 🟣.
            def tier_prefix(tier: str) -> str:
                return {"Exotic": "🟡 ", "Legendary": "🟣 ", "Rare": "🔵 "}.get(tier, "• ")
            lines = []
            for it in items[:12]:
                head = f"{tier_prefix(it['tier'])}**{it['name']}**"
                if it["type"]:
                    head += f" — _{it['type']}_"
                cost_line = decorate_cost(it.get("cost") or [])
                if cost_line:
                    head += f"\n   {cost_line}"
                lines.append(head)
            if lines:
                emb.add_field(
                    name=f"Inventory ({len(items)} items, showing first 12)",
                    value="\n".join(lines) or "—",
                    inline=False,
                )
            if len(items) > 12:
                emb.set_footer(
                    text=f"+{len(items) - 12} more items. Full list at "
                    f"clarencestephen.com/this-week.",
                )
        emb.add_field(
            name="Refresh",
            value=_format_refresh(v.get("refresh_in_seconds", 0)),
            inline=True,
        )
        await interaction.followup.send(embed=emb)
        return

    # ── All-vendor + activity summary ────────────────────────
    emb = discord.Embed(
        title="🗓️ This Week",
        description=(
            "Kyber-parity vendor + activity rotation feed.\n"
            "Use `/this-week vendor:<name>` for one vendor's full inventory."
        ),
        color=0x6a3aa6,
    )

    # Vendors
    for key in _VENDOR_KEYS:
        v = vendors.get(key)
        emoji = _VENDOR_EMOJI[key]
        if not v:
            emb.add_field(
                name=f"{emoji} {key}",
                value="*(no data)*",
                inline=False,
            )
            continue
        avail = "✅ open" if v.get("available", True) else "❌ unavailable"
        loc = ""
        if v.get("location"):
            loc = f" · 📍 {v['location'].get('name', '?')}"
        line1 = f"**{v.get('display_name', key)}** — {avail}{loc}"
        n_items = len(v.get("items", []) or [])
        refresh = _format_refresh(v.get("refresh_in_seconds", 0))
        line2 = f"{n_items} items · refresh {refresh}"
        emb.add_field(
            name=f"{emoji} {key}",
            value=f"{line1}\n{line2}",
            inline=False,
        )

    # Activities (Phase 3 — milestones)
    milestones = data.get("milestones", []) or []
    if milestones:
        active = [m for m in milestones if m.get("available")]
        off    = [m for m in milestones if not m.get("available")]
        active_lines = [
            f"• **{m.get('display_name', '?')}** ({m.get('category', '?')})"
            for m in active
        ]
        off_lines = [
            f"• ~~{m.get('display_name', '?')}~~ ({m.get('category', '?')})"
            for m in off
        ]
        body = "\n".join(active_lines)
        if off_lines:
            body += "\n\n*Off-rotation:* " + ", ".join(
                m.get("display_name", "?") for m in off
            )
        emb.add_field(
            name="📅 Activities",
            value=body or "*(no milestone data)*",
            inline=False,
        )

    # News (Phase 4 — latest 3 from Bungie RSS)
    news = data.get("news", []) or []
    if news:
        news_lines = []
        for n in news[:3]:
            label = n.get("category", "news").upper()
            title = n.get("title", "(untitled)")
            url   = n.get("url", "")
            if url:
                news_lines.append(f"• [{label}] [{title}]({url})")
            else:
                news_lines.append(f"• [{label}] {title}")
        emb.add_field(
            name="📰 News",
            value="\n".join(news_lines),
            inline=False,
        )

    emb.set_footer(
        text=(
            "Vendors 60min · activities 15min · news 6h · "
            "Phase 1+2+3+4 (vendors + milestones + news)."
        )
    )
    await interaction.followup.send(embed=emb)


# ============================================================
# Direct vendor / activity shortcuts — /xur, /ada1, /banshee, etc.
#
# These bypass the /this-week summary and jump straight to the
# vendor's full inventory embed (same shape as the deep-dive view
# from `/this-week vendor:xur`). Quicker UX for the "I just want to
# know what Xur has this week" path.
# ============================================================

_VENDOR_ALIASES = {
    "xur":       "xur",
    "xûr":       "xur",
    "ada":       "ada1",
    "ada1":      "ada1",
    "ada-1":     "ada1",
    "banshee":   "banshee",
    "banshee44": "banshee",
    "banshee-44": "banshee",
    "rahool":    "rahool",
    "eververse": "eververse",
    "tess":      "eververse",
}

_ACTIVITY_ALIASES = {
    "trials":          "trials",
    "trials-of-osiris":"trials",
    "iron-banner":     "iron-banner",
    "ironbanner":      "iron-banner",
    "ib":              "iron-banner",
    "lost-sector":     "lost-sector",
    "lostsector":      "lost-sector",
    "weekly-reset":    "weekly-reset",
    "weeklyreset":     "weekly-reset",
    "reset":           "weekly-reset",
    "vex-incursion":   "vex-incursion",
    "vex":             "vex-incursion",
    "raid-challenge":  "raid-challenge",
    "dungeon-rotator": "dungeon-rotator",
    "featured-dungeon":"dungeon-rotator",
}

_ACTIVITY_EMOJI = {
    "weekly-reset":    "🔄",
    "raid-challenge":  "⚔️",
    "dungeon-rotator": "🏰",
    "iron-banner":     "🛡️",
    "trials":          "🏆",
    "vex-incursion":   "🌀",
    "lost-sector":     "🗝️",
}


async def _fetch_this_week_bundle(interaction: discord.Interaction):
    """Common front-half of every shortcut command. Returns
    (data, manifest) on success or sends an error followup + None
    on failure. Caller should `return` if None.
    """
    discord_id = str(interaction.user.id)
    link = await _resolve_bungie_id(discord_id)
    if not link:
        await interaction.followup.send(
            "⚠️ You haven't linked a Bungie account yet. Run `/link-bungie` first.",
            ephemeral=True,
        )
        return None
    bungie_id = link.get("bungie_id")
    try:
        import asyncio
        data, manifest = await asyncio.gather(
            _bot_internal_post("/api/internal/this-week", {"bungie_id": bungie_id}),
            _fetch_json("/manifest.json"),
        )
    except Exception as e:
        await interaction.followup.send(
            f"⚠️ This-week fetch failed: `{e}`", ephemeral=True,
        )
        return None
    return data, manifest


def _build_vendor_embed(vendor_key: str, v: dict | None, manifest: dict) -> discord.Embed:
    """Render a vendor's deep-dive embed. Identical output shape to
    `/this-week vendor:<key>`. v=None handles the "no data" case."""
    emoji = _VENDOR_EMOJI.get(vendor_key, "🛍️")
    if not v:
        return discord.Embed(
            title=f"{emoji} {vendor_key}",
            description="No data this week.",
            color=0x6a3aa6,
        )
    emb = discord.Embed(
        title=f"{emoji} {v.get('display_name', vendor_key)}",
        color=0x6a3aa6,
    )
    if v.get("location"):
        loc = v["location"]
        emb.add_field(
            name="📍 Location",
            value=f"{loc.get('name', '?')} · {loc.get('planet', '?')}",
            inline=False,
        )
    if not v.get("available", True):
        emb.description = (
            v.get("notes")
            or f"Returns in {_format_refresh(v.get('refresh_in_seconds', 0))}."
        )
    else:
        emb.description = v.get("notes", "")
        items_raw = v.get("items", []) or []

        def name_of(h):
            return (manifest.get(str(h)) or {}).get("n") or f"#{h}"

        def cost_text(cost):
            if not cost:
                return ""
            return " + ".join(
                f"{c.get('quantity', 0):,} {name_of(c.get('currency_hash'))}"
                for c in cost
            )

        def tier_prefix(tier):
            return {"Exotic": "🟡 ", "Legendary": "🟣 ", "Rare": "🔵 "}.get(tier, "• ")

        lines = []
        for it in items_raw[:12]:
            m = manifest.get(str(it.get("hash"))) or {}
            name = m.get("n") or f"#{it.get('hash', '?')}"
            itype = m.get("t") or ""
            tier = m.get("r") or ""
            head = f"{tier_prefix(tier)}**{name}**"
            if itype:
                head += f" — _{itype}_"
            cl = cost_text(it.get("cost") or [])
            if cl:
                head += f"\n   {cl}"
            lines.append(head)
        if lines:
            emb.add_field(
                name=f"Inventory ({len(items_raw)} items, showing first 12)",
                value="\n".join(lines) or "—",
                inline=False,
            )
        if len(items_raw) > 12:
            emb.set_footer(
                text=f"+{len(items_raw) - 12} more items. Full list at "
                f"clarencestephen.com/this-week.",
            )
    emb.add_field(
        name="Refresh",
        value=_format_refresh(v.get("refresh_in_seconds", 0)),
        inline=True,
    )
    return emb


def _build_activity_embed(activity_key: str, milestones: list) -> discord.Embed:
    """Render one milestone's detail card."""
    emoji = _ACTIVITY_EMOJI.get(activity_key, "📅")
    match = next((m for m in milestones if m.get("activity") == activity_key), None)
    if not match:
        return discord.Embed(
            title=f"{emoji} {activity_key}",
            description="No data this week.",
            color=0x6a3aa6,
        )
    emb = discord.Embed(
        title=f"{emoji} {match.get('display_name', activity_key)}",
        description=match.get("description", ""),
        color=0x6a3aa6,
    )
    emb.add_field(
        name="Category",
        value=match.get("category", "?"),
        inline=True,
    )
    emb.add_field(
        name="Active",
        value="✅ active" if match.get("available") else "❌ off-rotation",
        inline=True,
    )
    rewards = match.get("rewards") or []
    if rewards:
        emb.add_field(
            name="Rewards",
            value="\n".join(f"• {r}" for r in rewards),
            inline=False,
        )
    if match.get("notes"):
        emb.add_field(name="Notes", value=match["notes"], inline=False)
    if match.get("end_time"):
        emb.set_footer(text=f"Ends {match['end_time']}")
    return emb


async def _send_vendor_card(interaction: discord.Interaction, vendor_key: str):
    bundle = await _fetch_this_week_bundle(interaction)
    if not bundle:
        return
    data, manifest = bundle
    vendors = data.get("vendors", {}) or {}
    emb = _build_vendor_embed(vendor_key, vendors.get(vendor_key), manifest)
    await interaction.followup.send(embed=emb)


async def _send_activity_card(interaction: discord.Interaction, activity_key: str):
    bundle = await _fetch_this_week_bundle(interaction)
    if not bundle:
        return
    data, _manifest = bundle
    emb = _build_activity_embed(activity_key, data.get("milestones", []) or [])
    await interaction.followup.send(embed=emb)


# ── Vendor shortcuts ─────────────────────────────────────────

@bot.tree.command(name="xur", description="This week's Xûr — location + exotic inventory")
async def cmd_xur(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_vendor_card(interaction, "xur")


@bot.tree.command(name="ada1", description="Ada-1's armor mod rotation this week")
async def cmd_ada1(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_vendor_card(interaction, "ada1")


@bot.tree.command(name="banshee", description="Banshee-44's weekly weapon stock + focusing")
async def cmd_banshee(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_vendor_card(interaction, "banshee")


@bot.tree.command(name="rahool", description="Master Rahool's engram focusing rotation")
async def cmd_rahool(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_vendor_card(interaction, "rahool")


@bot.tree.command(name="eververse", description="Eververse / Tess Everis weekly Bright Dust + Silver")
async def cmd_eververse(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_vendor_card(interaction, "eververse")


# ── Activity shortcuts ───────────────────────────────────────

@bot.tree.command(name="trials", description="Trials of Osiris — current map + rewards")
async def cmd_trials(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_activity_card(interaction, "trials")


@bot.tree.command(name="iron-banner", description="Iron Banner — current week mode + rewards")
async def cmd_iron_banner(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_activity_card(interaction, "iron-banner")


@bot.tree.command(name="lost-sector", description="Daily Lost Sector — current exotic armor slot rotator")
async def cmd_lost_sector(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_activity_card(interaction, "lost-sector")


@bot.tree.command(name="weekly-reset", description="Weekly reset milestones — featured raid / dungeon / pinnacles")
async def cmd_weekly_reset(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_activity_card(interaction, "weekly-reset")


@bot.tree.command(name="vex-incursion", description="Vex Incursion (Neomuna) — strand-themed activity")
async def cmd_vex_incursion(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_activity_card(interaction, "vex-incursion")


# ============================================================
# Foundry shortcuts — /hakke, /suros, /tex-mechanica
#
# Unlike vendors / activities, foundries have NO Bungie API. Kyber's
# #foundry-X channels track community-curated weapon spotlights +
# god-roll callouts that shift per Episode. The bot reads a hand-
# curated JSON (web/public/foundries.json) and renders the same
# featured-weapon list. Refresh that JSON each Episode.
# ============================================================

_FOUNDRY_ALIASES = {
    "hakke":             "hakke",
    "häkke":             "hakke",
    "suros":             "suros",
    "tex-mechanica":     "tex-mechanica",
    "tex":               "tex-mechanica",
    "texmechanica":      "tex-mechanica",
}

_FOUNDRY_EMOJI = {
    "hakke":         "⚙️",
    "suros":         "🔴",
    "tex-mechanica": "🤠",
}


async def _send_foundry_card(interaction: discord.Interaction, foundry_key: str):
    """Render the hand-curated foundry-highlights card."""
    try:
        data = await _fetch_json("/foundries.json")
    except Exception as e:
        await interaction.followup.send(
            f"⚠️ Couldn't load foundries.json: `{e}`", ephemeral=True,
        )
        return
    f = (data.get("foundries", {}) or {}).get(foundry_key)
    emoji = _FOUNDRY_EMOJI.get(foundry_key, "🔫")
    if not f:
        await interaction.followup.send(
            f"{emoji} **{foundry_key}** — not in foundries.json.",
        )
        return
    emb = discord.Embed(
        title=f"{emoji} {f.get('display_name', foundry_key)}",
        description=f.get("tagline", ""),
        color=0x6a3aa6,
        url=f.get("external_link"),
    )
    if f.get("weapon_style"):
        emb.add_field(name="Weapon Style", value=f["weapon_style"], inline=False)
    weapons = f.get("featured_weapons", []) or []
    if weapons:
        lines = []
        for w in weapons[:6]:
            head = f"**{w.get('name', '?')}** — _{w.get('type', '')}_"
            elem = w.get("element")
            if elem:
                head += f" · {elem}"
            ctx = w.get("context")
            if ctx:
                head += f"\n   {ctx}"
            lines.append(head)
        emb.add_field(
            name=f"Featured Weapons (curated {data.get('last_curated', '?')})",
            value="\n\n".join(lines),
            inline=False,
        )
    if f.get("external_link"):
        emb.set_footer(text="See more god rolls at light.gg (link in title).")
    await interaction.followup.send(embed=emb)


@bot.tree.command(name="hakke", description="Häkke foundry — featured weapons + god rolls")
async def cmd_hakke(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_foundry_card(interaction, "hakke")


@bot.tree.command(name="suros", description="Suros foundry — featured weapons + god rolls")
async def cmd_suros(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_foundry_card(interaction, "suros")


@bot.tree.command(name="tex-mechanica", description="Tex Mechanica foundry — featured weapons + god rolls")
async def cmd_tex_mechanica(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=False, thinking=True)
    await _send_foundry_card(interaction, "tex-mechanica")


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
