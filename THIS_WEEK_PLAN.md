# "This Week" feature — Kyber-Community-parity weekly rotation surface

Goal: surface every weekly-rotation channel from Kyber Community's
`Destiny 2 Resources` section (Xur, Ada-1, Banshee, foundries, weekly
reset, lost sector, vex incursion, trials, iron banner, TWID, etc.)
directly inside Darth Bot (Discord) and the Destiny Voyager web app,
with live data from the Bungie API and zero manual upkeep.

## Architecture

```
                                          ┌────────────────────────┐
   Discord  ──/this-week──►  Darth Bot ──►│                        │
                                          │  Worker /api/this-week │──►  Bungie API
   Web /this-week  ────────►   Web app  ──►│                        │     (vendor / milestone)
                                          │      KV cache (1h)     │
                                          └────────────────────────┘
                                                     │
                                                     └──►  TWID scraper output (data/scrape/)
```

- **One endpoint to rule them all**: `GET /api/this-week` returns an
  aggregate JSON with sections for vendors / activities / news.
- **KV-cached at the Worker** (TTL 60 min for vendors, 15 min for
  milestones since milestone hour-of-day matters less).
- **Per-user cache** (vendor data requires the user's OAuth token).
- **Bot and Web share the endpoint** — single source of truth, no
  divergence between Discord and web.

## Phase 1 (this session) — Foundation + Xur

- New Worker module: `worker/src/this-week.ts`
- New endpoint: `app.get("/api/this-week", ...)` in `worker/src/index.ts`
- KV cache helper
- Manifest joins for item names / descriptions / costs
- **Xur** (vendor hash `2190858386`) — first complete vendor

## Phase 2 (this session) — Other vendors

- **Ada-1**           (`350061650`)   — Armor mods rotation (Banshee-style)
- **Banshee-44**      (`672118013`)   — Weekly weapon stock + focusing
- **Rahool**          (`2255782930`)  — Cryptarch / engram focusing rotation
- **Eververse**       (`3361454721`)  — Weekly bright-dust + silver featured

Output shape per vendor:
```ts
type VendorWeek = {
  vendor: "xur" | "ada1" | "banshee" | "rahool" | "eververse",
  display_name: string,
  available: boolean,                  // false if not in cycle (Xur Wed-Thu)
  location?: { name: string, planet: string },
  refresh_in_seconds: number,
  items: VendorItem[],
};

type VendorItem = {
  hash: number,
  name: string,
  type: string,                        // "Hand Cannon" / "Helmet" / "Engram"
  tier: string,                        // "Exotic" / "Legendary" / "Rare"
  icon_url: string,
  description?: string,
  cost?: Array<{currency_hash: number, name: string, quantity: number}>,
  // For weapons/armor: instance stats + plug rolls
  stats?: ArmorStats | WeaponStats,
  plugs?: Array<{name: string, kind: "perk1" | "perk2" | ...}>,
};
```

## Phase 3 (✅ SHIPPED) — Activities

The Milestones / Activities API (`/Destiny2/Milestones/`) covers:

- **weekly-reset**        — All weekly milestones (raid challenge, dungeon
                            challenge, weekly story missions, pinnacle resets)
- **vex-incursion**       — Activity availability in Neomuna
- **iron-banner**         — IB rotation week (mode + map)
- **trials**              — Trials of Osiris (map + reward)
- **lost-sector**         — Today's master/legend Lost Sector exotic
                            (NOTE: needs community fallback — Bungie's
                            milestone for this is sparse)
- **planet-specific**     — Per-destination weekly challenges

Output shape per activity:
```ts
type ActivityWeek = {
  activity: "raid-challenge" | "dungeon-challenge" | "trials" | ...,
  display_name: string,
  description: string,
  rewards: string[],
  end_time?: string,                   // ISO datetime when this rotation ends
  available: boolean,
};
```

## Phase 4 (future session) — News + static + multi-tab UI

- **twid**                — TWID scraper output (already in
                            `darth-bot/data/scrape/`). Parse latest post
                            into structured sections.
- **seasonal-content**    — Current season's rotators + episode story
                            progression. Mostly static + TWID-derived.
- **the-sieve**           — Activity-specific seasonal modifier (per
                            episode); TWID-derived.
- **armor-3point0**       — Static reference (already covered in
                            `raids/SCHEMA.md` Armor 3.0 stat names).
- **court-projects**      — Custom builds / community projects
                            (curated; manual).
- **foundry-hakke/suros/tex-mechanica** — Foundry weapon news + god
                            rolls. Not directly Bungie-API-fetchable;
                            mostly TWID-derived + community-curated.
- **gunsmith / armor-3point0 / planet-specific** — Static reference docs

Web UI: 3-tab layout
- **Vendors** (Phase 1+2 deliverables — Xur / Ada-1 / Banshee / Rahool / Eververse)
- **Activities** (Phase 3 — Milestones / Trials / Iron Banner / Lost Sector)
- **News** (Phase 4 — TWID / Seasonal / Foundries)

## Discord output format

`/this-week` (no args) — single embed with one field per section
showing 2-line summaries (Xur location + top exotic, top Ada mod,
etc.) and a "use `/this-week <vendor>` for detail" hint.

`/this-week xur` — full Xur inventory: legendary weapons + armor +
exotic engram + costs.

`/this-week ada` / `banshee` / `rahool` / `eververse` / `trials` /
`iron-banner` / `lost-sector` / `twid` — vendor- or
activity-specific deep dives.

## Cache strategy

- **Vendor data**: TTL 1 hour. Refresh is global (Bungie's daily/weekly
  reset is the only meaningful refresh; intra-day vendor data doesn't
  change).
- **Milestones**: TTL 15 min. The milestone list includes "completion
  state" which can change per character within a week.
- **TWID / News**: TTL 6 hours. New blog posts land at most once a day.

Cache keys:
```
twk:vendor:<user_id>:<vendor_hash>      → VendorWeek JSON
twk:milestones:<user_id>                → ActivityWeek[] JSON
twk:twid:latest                          → TWIDPost JSON (global, not per-user)
```

## OAuth scope

Vendor data requires the user's OAuth token. The Worker already
stores it in KV from the `/api/auth/callback` flow. No new scopes
needed; vendor reads are covered by `ReadBasicUserProfile` (already
granted in the existing OAuth flow).

For Darth Bot's `/this-week` command in Discord, the bot will look
up the Discord user's linked Bungie account via the existing
`/api/internal/inventory` shared-secret flow, then call the Worker's
`/api/this-week` endpoint with that user's token.

## Discord rate limits

Bungie API has a per-key rate limit (250/sec sustained). Each vendor
fetch is 1 API call. 5 vendors × N concurrent users → rate limit
becomes a concern only at scale (>50 concurrent users). The per-user
60-min KV cache mitigates this — same user hitting `/this-week`
twice in an hour costs 0 Bungie API calls.

## Open questions (for future sessions)

1. **Foundry channels** (Hakke / Suros / Tex Mechanica): community
   curated content; how to source? Probably TWID + light.gg foundry
   pages, manual curation per season.
2. **Lost Sector**: Bungie's milestone endpoint is unreliable for
   the daily rotator's exotic table. Community sites
   (today.destiny.tools, light.gg) are more authoritative.
3. **Eververse silver-vs-bright-dust filter**: Eververse vendor
   returns ALL items including silver-only. Need to filter to
   bright-dust-only for the typical use case.
4. **Notification on reset**: bot could post to a designated channel
   when Tuesday reset hits. Out of scope for Phase 1-4; consider
   later.

---

**Status:** Phase 1+2+3 shipped. Phase 4 (TWID + multi-tab UI) queued.
