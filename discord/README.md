# Discord server setup — Order 66 / "The Way of the Sith"

Files in this folder:

| File | Purpose |
|---|---|
| `server_layout.json` | Full structure (roles, categories, channels) for the server. Star Wars themed names. Target server ID: `1471072707524296767`. |
| `setup_server.py` | One-shot Discord bot script. Reads the JSON and creates everything via discord.py. Idempotent — safe to re-run. |
| `pick_roles_messages.md` | Reaction-role message text to paste into `#recruitment-roles` after the server is built. |

---

## End-to-end setup (~15 minutes)

### Step 1 — Build the structure with `setup_server.py`

1. **Create a Discord bot** at https://discord.com/developers/applications → **New Application**
   - Name: "Order 66 Setup Bot" (or anything)
   - Go to **Bot** tab → **Reset Token** → copy the token
   - Under **Privileged Gateway Intents**: none needed for this script
2. **Generate an invite URL**: OAuth2 → URL Generator
   - Scopes: `bot` + `applications.commands`
   - Bot Permissions: **Administrator** (simplest) — or specifically: Manage Roles, Manage Channels, Manage Messages, Add Reactions, Send Messages, View Channels
3. **Invite the bot** to your server using the generated URL
4. **Run the script**:
   ```bash
   pip install discord.py
   export DISCORD_BOT_TOKEN="<your_token_here>"
   python3 discord/setup_server.py
   ```
   The script reads `discord/server_layout.json` (target server ID is baked in but can be overridden with `DISCORD_GUILD_ID=...` env var).

The script will:
- Create the roles in priority order (Emperor at top, Unverified at bottom)
- Create every category + channel
- Apply view-permission restrictions to: `⚔️ Imperial Troopers` (clan only), `💀 Death Star Command` (mods only), `🚀 The Imperial Armory` (verified only), `📣 Imperial Declarations` (read-only for members)
- Print next-step reminders when done

### Step 2 — Invite TicketTool.xyz

For the `🎫 Galactic Senate / #bounty-office` channel:

1. Go to https://tickettool.xyz/
2. Click **Invite TicketTool** → pick your server → authorize
3. In `#bounty-office` run `/setup` (or whatever TicketTool's current setup command is — check their site)
4. Configure the panel to drop into `#bounty-office`

### Step 3 — Invite + configure your reaction-role bot

You already have **MEE6**, **FlaviBot**, and **Sapphire** options. Pick one:

| Bot | Reaction roles? | Notes |
|---|---|---|
| **Sapphire** | ✅ Yes | The bot Badass Clan uses. Free, easy dashboard. https://sapphirebot.dev |
| **MEE6** | ✅ Yes (Premium tier for advanced) | https://mee6.xyz |
| **FlaviBot** | ✅ Yes | https://flavibot.xyz |

1. Open `discord/pick_roles_messages.md` — it has 8 messages with their emoji → role mappings
2. Post each message into `#recruitment-roles` (one per Discord message)
3. In your chosen bot's dashboard, find each posted message and map the emoji → role per the tables in `pick_roles_messages.md`
4. Test by reacting on yourself
5. Pin all 8 messages in `#recruitment-roles`
6. Restrict "Send Messages" in `#recruitment-roles` to `@Death Star Command` only so the channel doesn't fill with chat

### Step 4 — Use Xenon to back up the result

After everything looks right:

1. Invite Xenon: https://xenon.bot
2. In your server: `/backup create`
3. Save the backup ID somewhere safe — you can `/backup load <id>` to re-create the structure if anything is ever destroyed

### Step 5 — Set Carbonite Chamber as AFK

The script creates a voice channel called `💤 Carbonite Chamber`. To make Discord auto-move idle members there:

**Server Settings → Overview → Inactive Channel** → pick `💤 Carbonite Chamber` → set timeout (5/15/30 min)

---

## Re-running the script

`setup_server.py` is idempotent: existing roles, categories, and channels are detected by name and skipped. So you can:

- Edit `server_layout.json` (add a new channel, new role) → re-run the script → only the new items are added
- Reorganize manually in Discord → re-run the script → it'll only add what's missing, won't overwrite

It will NOT delete things you removed from the JSON. To delete, do it manually in Discord.

---

## Customizing the layout

`server_layout.json` is just JSON — edit freely:

- Add a category: append a new object to `categories[]`
- Add a channel: append to a category's `channels[]`
- Add a role: append to `roles[]`
- Change a name: edit the `name` field; on re-run the bot can't auto-rename (it'll skip because the old name still exists). To rename: do it in Discord manually, then update the JSON to match for future re-runs.

If you want to rename "Order 66" to something else in the future, search-and-replace across this folder and the project root.

---

## Troubleshooting

**"Bot is not in guild X"**  
Bot wasn't invited. Use the OAuth URL Generator (step 1.2 above) and re-invite.

**"Missing Permissions"**  
Bot's role is lower than the role you're trying to manage, OR it doesn't have Manage Roles / Manage Channels. After running, drag the bot's auto-generated role above all custom roles you want it to manage.

**"Forbidden 50013"**  
Same — permissions issue. The bot can't manage a role that sits above its own in the hierarchy.

**Reactions don't assign roles**  
You posted the messages but didn't wire them up in MEE6/Sapphire's dashboard. Each message needs to be registered individually.
