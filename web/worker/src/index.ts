/**
 * Destiny Voyager — Worker API
 *
 * Routes:
 *   GET  /api/health             → liveness
 *   GET  /api/auth/login         → returns Bungie OAuth URL
 *   GET  /api/auth/callback      → handles OAuth callback, sets session cookie
 *   POST /api/auth/logout        → clear session
 *   GET  /api/me                 → current user (requires session)
 *   GET  /api/inventory          → vault + equipped + character inventory
 *   PUT  /api/tags               → set/clear tag on an item
 *
 * KV schema (binding: DV_KV):
 *   session:<sid>          → { bungie_id, expires_at }
 *   user:<bungie_id>       → { refresh_token, access_token, expires_at,
 *                              membership_type, membership_id,
 *                              primary_class, build_focus, item_tags }
 *   oauth_state:<state>    → { code_verifier, created_at }   (5min TTL)
 */

import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import {
  buildAuthRedirect,
  exchangeCode,
  refreshAccessToken,
  type StoredUser,
} from "./auth";
import { bungieGet, bungiePost } from "./bungie";
import { transferAndEquip } from "./equipFlow";
import { getThisWeek } from "./this-week";

export interface Env {
  DV_KV: KVNamespace;
  ENV: string;
  BUNGIE_API_KEY: string;
  BUNGIE_CLIENT_ID: string;
  BUNGIE_CLIENT_SECRET?: string;
  BUNGIE_OAUTH_AUTHORIZE_URL: string;
  BUNGIE_OAUTH_TOKEN_URL: string;
  BUNGIE_API_BASE: string;
  PUBLIC_BASE_URL: string;
  OAUTH_REDIRECT_PATH: string;
  SESSION_SECRET: string;
  // Python backend (FastAPI on Hostinger VPS or local dev)
  BACKEND_BASE_URL: string;
  // Shared secret with Darth Bot (Discord) for /api/internal/* routes.
  // Lets the bot call Bungie on a Discord user's behalf using the
  // Worker's KV-stored access token (set via /api/auth/callback).
  BOT_SHARED_SECRET?: string;
}

const app = new Hono<{ Bindings: Env; Variables: { user: StoredUser } }>();

app.use(
  "*",
  cors({
    origin: (origin) =>
      origin?.endsWith(".clarencestephen.com") ||
      origin?.endsWith(".pages.dev") ||
      origin === "http://localhost:5173"
        ? origin
        : "",
    credentials: true,
  }),
);

// ============================================================
// Health
// ============================================================
app.get("/api/health", (c) =>
  c.json({ status: "ok", version: "0.1.0", env: c.env.ENV }),
);

// ============================================================
// /fireteam — look up multiple players by Bungie name, return their
// publicly-equipped gear. No per-user OAuth needed; only the Worker's
// BUNGIE_API_KEY. Used by the /fireteam page (engram.blue-style viewer).
// ============================================================
//
// Body: { bungie_names: ["Name#1234", "Other#5678"] }
// Each name is split on '#': pre-# = displayName, post-# = displayNameCode.
//
// Returns:
// {
//   members: [
//     {
//       bungie_name: "Darth_Bankai#1234",
//       display_name: "Darth_Bankai",
//       membership_id: "...",
//       membership_type: 1,
//       characters: [
//         { id, class, light, emblem_path, emblem_background_path,
//           equipped: [{ instance_id, hash, slot_bucket_hash, power }] }
//       ],
//       error?: "not found" | "profile private" | "..."
//     }
//   ]
// }
//
// Bungie endpoints used:
//   POST /Destiny2/SearchDestinyPlayerByBungieName/-1/  (membershipType -1 = All)
//   GET  /Destiny2/{type}/Profile/{id}/?components=200,205,300
app.post("/api/fireteam", async (c) => {
  type FtReq = { bungie_names: string[] };
  const body = await c.req.json<FtReq>();
  if (!Array.isArray(body.bungie_names) || body.bungie_names.length === 0) {
    return c.json({ error: "bungie_names required" }, 400);
  }
  if (body.bungie_names.length > 12) {
    return c.json({ error: "max 12 names per request" }, 400);
  }

  const classNames: Record<number, "titan" | "hunter" | "warlock"> = {
    0: "titan", 1: "hunter", 2: "warlock",
  };

  // Bucket hashes → slot label (same mapping as bake-slim-manifest.mjs).
  // We surface these so the frontend can render the engram.blue-style grid
  // without round-tripping the slim manifest just for slot info.
  const BUCKET_SLOT: Record<string, string> = {
    "1498876634": "Kinetic",
    "2465295065": "Energy",
    "953998645":  "Heavy",
    "3448274439": "Helmet",
    "3551918588": "Gauntlets",
    "14239492":   "Chest",
    "20886954":   "Legs",
    "1585787867": "Class",
    "4023194814": "Ghost",
    "284967655":  "Ship",
    "2025709351": "Sparrow",
    "3284755031": "Subclass",
    "4274335291": "Emblem",
    "3683254069": "Finisher",
  };

  // Given a Destiny membershipId (from ProfileTransitoryData partyMembers),
  // resolve to the cross-save primary destinyMembership so we know which
  // membershipType to use for the Profile call.
  async function resolveMembership(destinyMembershipId: string): Promise<any | null> {
    try {
      // /User/GetMembershipsById/{id}/{type}/ accepts type=-1 = All for the search
      const r = await fetch(
        `${c.env.BUNGIE_API_BASE}/User/GetMembershipsById/${destinyMembershipId}/-1/`,
        { headers: { "X-API-Key": c.env.BUNGIE_API_KEY } },
      );
      const json = await r.json<any>();
      if (json.ErrorCode !== 1) return null;
      const destinyMemberships = json.Response?.destinyMemberships ?? [];
      if (!destinyMemberships.length) return null;
      const primary =
        destinyMemberships.find((m: any) => m.crossSaveOverride === m.membershipType) ??
        destinyMemberships.find((m: any) => String(m.membershipId) === destinyMembershipId) ??
        destinyMemberships[0];
      return primary;
    } catch {
      return null;
    }
  }

  // Build a fireteam-member result given an already-resolved membership.
  // Same shape as the lookupOne() success branch.
  async function fetchEquipment(primary: any, bungieNameHint?: string): Promise<any> {
    let profile: any;
    try {
      // Components:
      //   100 = Profiles (userInfo for Bungie name code)
      //   200 = Characters (class, light, emblem)
      //   205 = CharacterEquipment (currently equipped)
      //   300 = ItemInstances (primary stat — armor power, weapon power)
      //   304 = ItemStats (per-instance stat sheet — weapon Range/Stab/etc.,
      //                    armor 6-stat sheet)
      //   305 = ItemSockets (mods/perks/aspects/fragments plug hashes)
      profile = await bungieGet(
        c.env,
        `/Destiny2/${primary.membershipType}/Profile/${primary.membershipId}/?components=100,200,205,300,304,305`,
      );
    } catch (e: any) {
      return { bungie_name: bungieNameHint ?? primary.displayName ?? "?", error: `profile fetch: ${e.message ?? e}` };
    }
    const chars = profile?.characters?.data ?? {};
    const equipped = profile?.characterEquipment?.data ?? {};
    const instances = profile?.itemComponents?.instances?.data ?? {};
    const sockets = profile?.itemComponents?.sockets?.data ?? {};
    const itemStats = profile?.itemComponents?.stats?.data ?? {};
    const userInfo = profile?.profile?.data?.userInfo ?? {};
    if (!Object.keys(chars).length) {
      return {
        bungie_name: bungieNameHint ?? primary.displayName ?? "?",
        error: "profile has no characters (private?)",
      };
    }

    const characters = (Object.entries(chars) as Array<[string, any]>).map(
      ([id, ch]) => {
        const eq = equipped[id]?.items ?? [];
        return {
          id,
          class: classNames[ch.classType] ?? "warlock",
          light: ch.light ?? 0,
          emblem_path: ch.emblemPath ? `https://www.bungie.net${ch.emblemPath}` : null,
          emblem_background_path: ch.emblemBackgroundPath
            ? `https://www.bungie.net${ch.emblemBackgroundPath}`
            : null,
          date_last_played: ch.dateLastPlayed,
          equipped: eq.map((it: any) => {
            const iid = String(it.itemInstanceId ?? "");
            // Active mod/perk plug hashes from this item's sockets. We
            // return all visible, enabled plugs — the frontend uses
            // the slim manifest's `t` (itemTypeDisplayName) to bucket
            // each plug as Intrinsic / Barrel / Magazine / Trait / Mod /
            // Aspect / Fragment / etc.
            const sk = sockets[iid]?.sockets ?? [];
            const plug_hashes: number[] = [];
            for (const s of sk) {
              if (s?.plugHash && s.isEnabled !== false && s.isVisible !== false) {
                plug_hashes.push(s.plugHash);
              }
            }
            // Per-instance stat sheet (component 304). For weapons this
            // is Range/Stability/Reload/Handling/Aim Assistance/etc. —
            // each stat hash → value. We pass the whole sheet through;
            // the frontend resolves stat names from the manifest.
            const statSheet: Record<string, number> = {};
            const rawStats = itemStats[iid]?.stats ?? {};
            for (const [statHash, sv] of Object.entries(rawStats) as Array<[string, any]>) {
              if (sv?.value !== undefined) statSheet[statHash] = sv.value;
            }
            return {
              instance_id: iid,
              hash: it.itemHash,
              slot: BUCKET_SLOT[String(it.bucketHash)] ?? "",
              slot_bucket_hash: it.bucketHash,
              power: instances[iid]?.primaryStat?.value ?? 0,
              plug_hashes,
              item_stats: statSheet,
            };
          }),
        };
      },
    );
    characters.sort((a, b) => (b.light || 0) - (a.light || 0));

    // Bungie name = userInfo.bungieGlobalDisplayName + #code if available
    const dn = userInfo.bungieGlobalDisplayName ?? primary.displayName ?? "?";
    const code = userInfo.bungieGlobalDisplayNameCode;
    const bungieName = code != null
      ? `${dn}#${String(code).padStart(4, "0")}`
      : (bungieNameHint ?? dn);

    return {
      bungie_name: bungieName,
      display_name: dn,
      membership_id: primary.membershipId,
      membership_type: primary.membershipType,
      characters,
    };
  }

  async function lookupOne(rawName: string): Promise<any> {
    const trimmed = rawName.trim();
    if (!trimmed) return { bungie_name: rawName, error: "empty name" };
    // Split on #. Bungie names look like "Foo#1234". The code is required —
    // names without a code can collide across multiple platforms.
    const hashIdx = trimmed.lastIndexOf("#");
    if (hashIdx < 0) {
      return { bungie_name: trimmed, error: "missing #code (use Name#1234)" };
    }
    const displayName = trimmed.slice(0, hashIdx);
    const codeStr = trimmed.slice(hashIdx + 1);
    const code = parseInt(codeStr, 10);
    if (!Number.isInteger(code)) {
      return { bungie_name: trimmed, error: "invalid #code (must be a number)" };
    }

    // 1. Resolve name → memberships
    let memberships: any[];
    try {
      const r = await fetch(
        `${c.env.BUNGIE_API_BASE}/Destiny2/SearchDestinyPlayerByBungieName/-1/`,
        {
          method: "POST",
          headers: {
            "X-API-Key": c.env.BUNGIE_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName, displayNameCode: code }),
        },
      );
      const json = await r.json<any>();
      if (json.ErrorCode !== 1) {
        return { bungie_name: trimmed, error: `search failed: ${json.Message ?? json.ErrorStatus}` };
      }
      memberships = json.Response ?? [];
    } catch (e: any) {
      return { bungie_name: trimmed, error: `search exception: ${e.message ?? e}` };
    }
    if (!memberships.length) {
      return { bungie_name: trimmed, error: "no Destiny memberships under this Bungie name" };
    }
    // Pick the cross-save primary, else first
    const primary =
      memberships.find((m: any) => m.crossSaveOverride === m.membershipType) ??
      memberships[0];

    // 2. Fetch /Profile with public components — delegated to helper
    return fetchEquipment(primary, trimmed);
  }

  // If exactly one name was given, ALSO try to expand the fireteam via
  // ProfileTransitoryData (component 1000). Mirrors engram.blue's
  // single-input fireteam lookup. Falls back to single-member if the
  // user has transitory data set to private.
  async function expandFireteam(seed: any): Promise<any[]> {
    // seed = result from lookupOne. We need that user's membershipId/type
    // to fetch component 1000.
    if (!seed.membership_id || !seed.membership_type) return [seed];
    let trans: any;
    try {
      const profile = await bungieGet(
        c.env,
        `/Destiny2/${seed.membership_type}/Profile/${seed.membership_id}/?components=1000`,
      );
      trans = profile?.profileTransitoryData?.data;
    } catch {
      return [seed];
    }
    const members = trans?.partyMembers ?? [];
    if (!members.length) return [seed];
    // Resolve each party-member membershipId → primary destinyMembership.
    // Skip the seed itself (we already have it).
    const seedId = String(seed.membership_id);
    const expansions = await Promise.all(
      members.map(async (m: any): Promise<any | null> => {
        const id = String(m.membershipId);
        if (id === seedId) return null;
        const primary = await resolveMembership(id);
        if (!primary) return null;
        return fetchEquipment(primary);
      }),
    );
    const expanded = expansions.filter((x): x is any => x !== null);
    return [seed, ...expanded];
  }

  // Lookups run in parallel.
  const seedResults = await Promise.all(body.bungie_names.map(lookupOne));

  // If single-name input AND we got a successful result, auto-expand.
  let finalMembers = seedResults;
  if (
    body.bungie_names.length === 1 &&
    seedResults[0] &&
    !("error" in seedResults[0])
  ) {
    finalMembers = await expandFireteam(seedResults[0]);
  }
  return c.json({ members: finalMembers });
});

// ============================================================
// Auth — OAuth with Bungie
// ============================================================
app.get("/api/auth/login", async (c) => {
  const { url, state, codeVerifier } = await buildAuthRedirect(c.env);
  await c.env.DV_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ code_verifier: codeVerifier, created_at: Date.now() }),
    { expirationTtl: 300 },
  );
  return c.json({ url });
});

app.get("/api/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("Missing code or state", 400);

  const raw = await c.env.DV_KV.get(`oauth_state:${state}`);
  if (!raw) return c.text("State expired or unknown — try signing in again.", 400);
  const { code_verifier } = JSON.parse(raw);
  await c.env.DV_KV.delete(`oauth_state:${state}`);

  let tokens;
  try {
    tokens = await exchangeCode(c.env, code, code_verifier);
  } catch (e: any) {
    return c.text(`Token exchange failed: ${e.message}`, 500);
  }

  // Fetch membership info
  const userResp = await bungieGet(
    c.env,
    "/User/GetMembershipsForCurrentUser/",
    tokens.access_token,
  );
  const memberships = userResp?.destinyMemberships ?? [];
  const primary =
    memberships.find((m: any) => m.crossSaveOverride === m.membershipType) ??
    memberships[0];
  if (!primary) return c.text("No Destiny memberships on this account.", 400);

  const stored: StoredUser = {
    bungie_id: tokens.membership_id,
    membership_type: primary.membershipType,
    membership_id: primary.membershipId,
    display_name: primary.displayName,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in - 60),
    refresh_expires_at:
      Math.floor(Date.now() / 1000) + (tokens.refresh_expires_in - 3600),
    created_at: Date.now(),
    item_tags: {},
  };
  await c.env.DV_KV.put(`user:${stored.bungie_id}`, JSON.stringify(stored));

  // Issue a session cookie
  const sid = crypto.randomUUID();
  await c.env.DV_KV.put(
    `session:${sid}`,
    JSON.stringify({ bungie_id: stored.bungie_id, expires_at: Date.now() + 30 * 86400_000 }),
    { expirationTtl: 30 * 86400 },
  );
  setCookie(c, "dv_sid", sid, {
    httpOnly: true,
    secure: c.env.ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86400,
  });

  // Redirect to the app
  return c.redirect(`${c.env.PUBLIC_BASE_URL}/app`);
});

app.post("/api/auth/logout", async (c) => {
  const sid = getCookie(c, "dv_sid");
  if (sid) await c.env.DV_KV.delete(`session:${sid}`);
  deleteCookie(c, "dv_sid");
  return c.json({ ok: true });
});

// ============================================================
// Session middleware — populates c.var.user for authed endpoints
// ============================================================
app.use("/api/me", requireSession);
app.use("/api/inventory", requireSession);
app.use("/api/tags", requireSession);
app.use("/api/equip", requireSession);
app.use("/api/this-week", requireSession);
app.use("/api/library", requireSession);
app.use("/api/loadouts", requireSession);
app.use("/api/loadouts/*", requireSession);
app.use("/api/fragment-stats", requireSession);
app.use("/api/usage", requireSession);

// ============================================================
// /library — per-user wishlists + saved builds (KV: library:<bungie_id>)
// ============================================================
app.get("/api/library", async (c) => {
  const u = c.get("user");
  const raw = await c.env.DV_KV.get(`library:${u.bungie_id}`);
  return c.json(raw ? JSON.parse(raw) : { builds: [], weaponWishlist: [], armorWishlist: [], wishSpace: null });
});

// The free-form Wishlist page (sections + scratchpad). Tied to the Bungie
// login via the per-user library key. Structural sanitize only — the content
// itself is the user's own free text.
function sanitizeWishSpace(w: any) {
  if (!w || typeof w !== "object" || !Array.isArray(w.sections)) return null;
  const S = (v: any, n: number) => String(v ?? "").slice(0, n);
  return {
    sections: w.sections.slice(0, 50).map((s: any) => ({
      id: S(s?.id, 40),
      title: S(s?.title, 120),
      items: Array.isArray(s?.items)
        ? s.items.slice(0, 300).map((it: any) => ({
            id: S(it?.id, 40),
            name: S(it?.name, 200),
            source: S(it?.source, 300),
            link: S(it?.link, 500),
            note: S(it?.note, 500),
            done: !!it?.done,
          }))
        : [],
    })),
    notes: S(w.notes, 20000),
    updatedAt: Date.now(),
  };
}

app.put("/api/library", async (c) => {
  const u = c.get("user");
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "bad_body" }, 400);
  const lib = {
    builds: Array.isArray(body.builds) ? body.builds.slice(0, 200) : [],
    weaponWishlist: Array.isArray(body.weaponWishlist) ? body.weaponWishlist.slice(0, 2000) : [],
    armorWishlist: Array.isArray(body.armorWishlist) ? body.armorWishlist.slice(0, 2000) : [],
    loadouts: Array.isArray(body.loadouts) ? body.loadouts.slice(0, 200) : [],
    wishSpace: sanitizeWishSpace(body.wishSpace),
    updatedAt: Date.now(),
  };
  const json = JSON.stringify(lib);
  if (json.length > 512_000) return c.json({ error: "too_large" }, 413);
  await c.env.DV_KV.put(`library:${u.bungie_id}`, json);
  return c.json({ ok: true, updatedAt: lib.updatedAt });
});

// ============================================================
// /loadouts — the in-game Loadout slots (component 206) + Bungie loadout
// actions (Snapshot / Equip / Clear / Update identifiers). 20 slots/character.
// SnapshotLoadout REQUIRES the name/color/icon identifier hashes in the body.
// ============================================================
app.get("/api/loadouts", async (c) => {
  const u = c.get("user");
  const profile = await bungieGet(
    c.env,
    `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=200,206`,
    u.access_token,
  );
  const chars = profile?.characters?.data ?? {};
  const loadouts = profile?.characterLoadouts?.data ?? {};
  const out = Object.entries(chars).map(([cid, ch]: [string, any]) => ({
    character_id: cid,
    class: ["Titan", "Hunter", "Warlock"][ch.classType] ?? "Guardian",
    light: ch.light,
    emblemPath: ch.emblemPath,
    dateLastPlayed: ch.dateLastPlayed,
    slots: (loadouts[cid]?.loadouts ?? []).map((s: any, i: number) => ({
      index: i,
      nameHash: s.nameHash,
      colorHash: s.colorHash,
      iconHash: s.iconHash,
      itemCount: (s.items ?? []).filter((it: any) => String(it.itemInstanceId ?? "0") !== "0").length,
    })),
  }));
  out.sort((a, b) => (a.dateLastPlayed > b.dateLastPlayed ? -1 : 1)); // active (last-played) first
  return c.json({ characters: out });
});

type LoadoutActionBody = {
  character_id: string; loadoutIndex: number;
  nameHash?: number; colorHash?: number; iconHash?: number;
};
async function loadoutAction(c: any, endpoint: string, withIds: boolean) {
  const u = c.get("user");
  const b = await c.req.json<LoadoutActionBody>();
  if (!b.character_id || b.loadoutIndex == null) return c.json({ error: "missing character_id or loadoutIndex" }, 400);
  const base: any = { loadoutIndex: b.loadoutIndex, characterId: b.character_id, membershipType: u.membership_type };
  if (withIds) { base.colorHash = b.colorHash; base.iconHash = b.iconHash; base.nameHash = b.nameHash; }
  try {
    await bungiePost(c.env, `/Destiny2/Actions/Loadouts/${endpoint}/`, u.access_token, base);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: `${endpoint}_failed`, detail: e?.message ?? String(e) }, 502);
  }
}
app.post("/api/loadouts/snapshot",    (c) => loadoutAction(c, "SnapshotLoadout", true));
app.post("/api/loadouts/identifiers", (c) => loadoutAction(c, "UpdateLoadoutIdentifiers", true));
app.post("/api/loadouts/equip",       (c) => loadoutAction(c, "EquipLoadout", false));
app.post("/api/loadouts/clear",       (c) => loadoutAction(c, "ClearLoadout", false));

// Per-character NON-ARMOR stat delta = character total (component 200) minus the
// sum of equipped-armor stat sheets (304). This captures subclass FRAGMENT stat
// bonuses/penalties (e.g. Void fragments giving -10 class / -10 grenade) that the
// optimizer's armor-only math otherwise misses. The optimizer folds this into the
// combo baseline so projected totals match the in-game character screen.
app.get("/api/fragment-stats", async (c) => {
  const u = c.get("user");
  const profile = await bungieGet(
    c.env,
    `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=200,205,304`,
    u.access_token,
  );
  const chars = profile?.characters?.data ?? {};
  const equipped = profile?.characterEquipment?.data ?? {};
  const stats = profile?.itemComponents?.stats?.data ?? {};
  const SH: Record<string, number> = { weapons: 2996146975, health: 392767087, class: 1943323491, grenade: 1735777505, super: 144602215, melee: 4244567218 };
  const ARMOR = new Set([3448274439, 3551918588, 14239492, 20886954, 1585787867]);
  const deltas: Record<string, any> = {};
  for (const [cid, ch] of Object.entries(chars) as Array<[string, any]>) {
    const armor: Record<string, number> = { weapons: 0, health: 0, class: 0, grenade: 0, super: 0, melee: 0 };
    for (const it of equipped[cid]?.items ?? []) {
      if (!ARMOR.has(it.bucketHash)) continue;
      const s = stats[String(it.itemInstanceId)]?.stats ?? {};
      for (const k of Object.keys(SH)) armor[k] += s[String(SH[k])]?.value ?? 0;
    }
    const d: Record<string, number> = {};
    for (const k of Object.keys(SH)) d[k] = (ch.stats?.[String(SH[k])] ?? 0) - armor[k];
    deltas[cid] = d;
  }
  return c.json({ deltas });
});

// Per-weapon LIFETIME usage (kills) from GetUniqueWeaponHistory, summed across the
// user's characters — the honest "Charlemagne-like" usage signal (Bungie has no
// global usage endpoint, but this gives real per-weapon usage per account). Cached
// in KV per user and refreshed at most weekly. Also folds the snapshot into the
// shared `usage:community` WEEKLY BATCH (each 7-day window is a fresh batch — no
// time-series, no carry-over) so the recommender can weight by what the linked
// players run that week. Returns usage by weapon HASH (client maps → names).
app.get("/api/usage", async (c) => {
  const u = c.get("user");
  const key = `usage:${u.bungie_id}`;
  const WEEK = 7 * 24 * 3600 * 1000;
  const cachedRaw = await c.env.DV_KV.get(key);
  if (cachedRaw) {
    const j = JSON.parse(cachedRaw);
    if (j.updatedAt && Date.now() - j.updatedAt < WEEK) {
      const comm = await c.env.DV_KV.get("usage:community");
      return c.json({ ...j, community: comm ? JSON.parse(comm).weapons : {} });
    }
  }
  const prof = await bungieGet(c.env, `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=200`, u.access_token);
  const chars = Object.keys(prof?.characters?.data ?? {});
  const weapons: Record<string, number> = {};
  for (const cid of chars) {
    try {
      const uw = await bungieGet(c.env, `/Destiny2/${u.membership_type}/Account/${u.membership_id}/Character/${cid}/Stats/UniqueWeapons/`, u.access_token);
      for (const w of uw?.weapons ?? []) {
        const ref = w?.referenceId;
        const kills = w?.values?.uniqueWeaponKills?.basic?.value ?? 0;
        if (ref && kills) weapons[String(ref)] = (weapons[String(ref)] ?? 0) + kills;
      }
    } catch { /* skip a character that errors */ }
  }
  const out = { weapons, updatedAt: Date.now() };
  await c.env.DV_KV.put(key, JSON.stringify(out));

  // Community popularity as a WEEKLY BATCH — each 7-day window is a fresh batch; a
  // user contributes their snapshot at most once per window. No time-series diffing
  // and no carry-over: every week is just a new batch.
  try {
    const week = Math.floor(Date.now() / WEEK);
    const commRaw = await c.env.DV_KV.get("usage:community");
    let comm = commRaw ? JSON.parse(commRaw) : null;
    if (!comm || comm.week !== week) comm = { week, weapons: {}, contributed: {} };  // new week → new batch
    if (!comm.contributed[u.bungie_id]) {
      for (const [h, k] of Object.entries(weapons)) comm.weapons[h] = (comm.weapons[h] || 0) + (k as number);
      comm.contributed[u.bungie_id] = true;
    }
    await c.env.DV_KV.put("usage:community", JSON.stringify(comm));
    return c.json({ ...out, community: comm.weapons });
  } catch {
    return c.json({ ...out, community: {} });
  }
});

async function requireSession(c: any, next: any) {
  const sid = getCookie(c, "dv_sid");
  if (!sid) return c.json({ error: "not_signed_in" }, 401);
  const sessRaw = await c.env.DV_KV.get(`session:${sid}`);
  if (!sessRaw) return c.json({ error: "session_expired" }, 401);
  const { bungie_id } = JSON.parse(sessRaw);
  const userRaw = await c.env.DV_KV.get(`user:${bungie_id}`);
  if (!userRaw) return c.json({ error: "user_missing" }, 401);
  let user: StoredUser = JSON.parse(userRaw);

  // Refresh access token if near expiry
  if (user.access_expires_at < Math.floor(Date.now() / 1000) + 60) {
    try {
      const tokens = await refreshAccessToken(c.env, user.refresh_token);
      user.access_token = tokens.access_token;
      user.access_expires_at =
        Math.floor(Date.now() / 1000) + (tokens.expires_in - 60);
      if (tokens.refresh_token) user.refresh_token = tokens.refresh_token;
      await c.env.DV_KV.put(`user:${bungie_id}`, JSON.stringify(user));
    } catch (e: any) {
      return c.json({ error: "refresh_failed", detail: e.message }, 401);
    }
  }

  c.set("user", user);
  await next();
}

// ============================================================
// /me
// ============================================================
app.get("/api/me", async (c) => {
  const u = c.get("user");
  try {
    // component 200 = Characters (gives us .light = equipped power)
    const profile = await bungieGet(
      c.env,
      `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=200`,
      u.access_token,
    );
    const chars = profile?.characters?.data ?? {};
    const classMap: Record<number, "titan" | "hunter" | "warlock"> = {
      0: "titan", 1: "hunter", 2: "warlock",
    };
    const characters = (Object.entries(chars) as Array<[string, any]>).map(
      ([id, char]) => ({
        id,
        class: classMap[char.classType] ?? "warlock",
        equipped_power: char.light ?? 0,
        emblem_path: char.emblemPath
          ? `https://www.bungie.net${char.emblemPath}`
          : null,
        emblem_background_path: char.emblemBackgroundPath
          ? `https://www.bungie.net${char.emblemBackgroundPath}`
          : null,
        date_last_played: char.dateLastPlayed,
      }),
    );
    characters.sort((a, b) => (b.equipped_power || 0) - (a.equipped_power || 0));
    const top = characters[0];
    return c.json({
      bungie_name: u.display_name,
      membership_id: u.membership_id,
      // primary_class still returned for backward compat — first character
      primary_class: top?.class ?? "warlock",
      power: top?.equipped_power ?? 0,
      build_focus: u.build_focus,
      characters,  // [{id, class, equipped_power, emblem_*, date_last_played}]
    });
  } catch (e: any) {
    return c.json({ error: "profile_fetch_failed", detail: e.message }, 502);
  }
});

// ============================================================
// /inventory  — full Bungie /Profile fetch + flatten.
// Returns a lean shape; the frontend decorates names/types/tiers from
// public/manifest.json (baked offline by scripts/bake-slim-manifest.mjs).
// ============================================================
app.get("/api/inventory", async (c) => {
  const u = c.get("user");
  try {
    // 102 = ProfileInventory (vault)
    // 200 = Characters (for class lookup per character)
    // 201 = CharacterInventories (per-char items)
    // 205 = CharacterEquipment (currently equipped)
    // 300 = ItemInstances (power, primaryStat)
    // 304 = ItemStats (per-armor stat values — mob/res/rec/dis/int/str)
    // 305 = ItemSockets (intrinsic perk = archetype, mods, etc.)
    // 310 = ItemReusablePlugs (per-socket AVAILABLE plugs — how we learn each
    //       Tier-5 piece's rolled Tuned stat: legendaries only offer the five
    //       "+TunedStat / -X" tuning mods; exotics offer all 30)
    const profile = await bungieGet(
      c.env,
      `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=102,200,201,205,300,304,305,310`,
      u.access_token,
    );

    const instances = profile?.itemComponents?.instances?.data ?? {};
    const itemStats = profile?.itemComponents?.stats?.data ?? {};
    const itemSockets = profile?.itemComponents?.sockets?.data ?? {};
    const itemReusable = profile?.itemComponents?.reusablePlugs?.data ?? {};
    const chars = profile?.characters?.data ?? {};
    const charInv = profile?.characterInventories?.data ?? {};
    const equipped = profile?.characterEquipment?.data ?? {};
    const vault = profile?.profileInventory?.data?.items ?? [];

    const classNames: Record<number, string> = {
      0: "Titan", 1: "Hunter", 2: "Warlock",
    };

    // Canonical armor stat hashes (Bungie manifest). Same six hashes
    // since D2 launch — Edge of Fate (2025) renamed the stats and
    // changed semantics (Mobility → Weapons, Resilience → Health,
    // Recovery → Class, Discipline → Grenade, Intellect → Super,
    // Strength → Melee) but the hashes themselves are unchanged.
    const STAT_HASH = {
      weapons: 2996146975,   // was: Mobility
      health:  392767087,    // was: Resilience
      class:   1943323491,   // was: Recovery
      grenade: 1735777505,   // was: Discipline
      super:   144602215,    // was: Intellect
      melee:   4244567218,   // was: Strength
    } as const;

    type ArmorStats = {
      weapons: number; health: number; class: number;
      grenade: number; super: number; melee: number;
    };
    type LeanItem = {
      instance_id: string;
      hash: number;
      power: number;
      location: string;
      tag?: string;
      stats?: ArmorStats;  // present for armor pieces with component-304 data
      /** Active plug hashes (component 305). For armor, plug 0 is the
       *  archetype perk — frontend resolves "Brawler" / "Bulwark" /
       *  "Grenadier" / "Gunner" / "Paragon" / "Specialist" via the slim
       *  manifest. */
      plug_hashes?: number[];
      /** Tier-5 tuning socket (from component 310). `tuned` = the piece's
       *  rolled Tuned stat (legendary: the only +5 its tuning mods offer);
       *  `tune_free` = exotic, any +5/−5 combination allowed. `tuning_idx` =
       *  live socket index for InsertSocketPlugFree (index varies per item and
       *  isn't always present in the static item definition). */
      tuned?: keyof ArmorStats;
      tune_free?: boolean;
      tuning_idx?: number;
      /** EoF gear tier 1–5 (component 300). 0/absent = legacy (pre-EoF) armor.
       *  Drives the "assume masterworked" projection: EoF cap = +tier to all
       *  six stats; legacy cap = +2. */
      gear_tier?: number;
    };
    const out: LeanItem[] = [];
    const tags = u.item_tags || {};

    // Tuning plug hash → the stat its +5 goes to. Names verified against
    // investmentStats 2026-07-22 (they agree). Balanced Tuning (+1 all) and
    // the Empty plug are intentionally absent — only "+X / -Y" mods reveal
    // the piece's Tuned stat.
    const TUNING_PLUS: Record<number, keyof ArmorStats> = {
      309000506: "grenade", 311164277: "melee", 323635379: "class", 388618952: "health",
      455024236: "grenade", 534630542: "melee", 673231129: "super", 691392383: "weapons",
      891771298: "weapons", 957763733: "class", 1510949672: "class", 1672416975: "grenade",
      1879022254: "class", 1918710127: "weapons", 1922571986: "grenade", 2125798995: "health",
      2244422610: "super", 3121760799: "weapons", 3284443097: "weapons", 3310526732: "health",
      3554800389: "super", 3681082702: "health", 3946669007: "super", 4020349587: "melee",
      4026414261: "super", 4030660414: "class", 4088823605: "health", 4116389173: "grenade",
      4164883102: "melee", 4210715468: "melee",
    };
    const TUNING_EMPTY = 2121121504;   // "Empty Tuning Mod Socket"
    const TUNING_BALANCED = 3122197216;

    /** Derive {tuned | tune_free, tuning_idx} for one instance. Primary source:
     *  component 310 (available plugs per socket). Fallback when 310 is absent:
     *  a "+X / -Y" mod (or the empty tuning plug) currently socketed via 305 —
     *  for legendaries the plugged mod's +5 stat IS the Tuned stat, since only
     *  aligned mods are insertable. */
    const extractTuning = (instId: string): Pick<LeanItem, "tuned" | "tune_free" | "tuning_idx"> | undefined => {
      const bySocket = itemReusable[instId]?.plugs;
      if (bySocket) {
        for (const [idxStr, plugs] of Object.entries(bySocket) as Array<[string, any[]]>) {
          const plusStats = new Set<string>();
          let sawTuning = false;
          for (const p of plugs ?? []) {
            const h = p?.plugItemHash;
            if (h === TUNING_BALANCED) { sawTuning = true; continue; }
            const st = TUNING_PLUS[h];
            if (st) { sawTuning = true; plusStats.add(st); }
          }
          if (!sawTuning) continue;
          const tuning_idx = Number(idxStr);
          if (plusStats.size >= 6) return { tune_free: true, tuning_idx };
          if (plusStats.size >= 1) return { tuned: [...plusStats][0] as keyof ArmorStats, tuning_idx };
          return { tuning_idx };
        }
      }
      const socks = itemSockets[instId]?.sockets;
      if (socks) {
        for (let i = 0; i < socks.length; i++) {
          const h = socks[i]?.plugHash;
          if (h === TUNING_EMPTY || h === TUNING_BALANCED) return { tuning_idx: i };
          const st = TUNING_PLUS[h];
          if (st) return { tuned: st, tuning_idx: i };
        }
      }
      return undefined;
    };

    const extractStats = (instId: string): ArmorStats | undefined => {
      const raw = itemStats[instId]?.stats;
      if (!raw) return undefined;
      const get = (h: number) => (raw[h]?.value ?? 0) as number;
      const s: ArmorStats = {
        weapons: get(STAT_HASH.weapons),
        health:  get(STAT_HASH.health),
        class:   get(STAT_HASH.class),
        grenade: get(STAT_HASH.grenade),
        super:   get(STAT_HASH.super),
        melee:   get(STAT_HASH.melee),
      };
      // Only emit a stats block if at least one stat is non-zero —
      // weapons, ghosts, etc. shouldn't carry the field.
      const total = s.weapons + s.health + s.class + s.grenade + s.super + s.melee;
      return total > 0 ? s : undefined;
    };

    const extractPlugs = (instId: string): number[] | undefined => {
      const sk = itemSockets[instId]?.sockets;
      if (!sk) return undefined;
      const out: number[] = [];
      for (const s of sk) {
        if (s?.plugHash && s.isEnabled !== false && s.isVisible !== false) {
          out.push(s.plugHash);
        }
      }
      return out.length ? out : undefined;
    };

    const push = (rawItem: any, location: string) => {
      const instId = rawItem.itemInstanceId ?? "";
      const inst = instances[instId];
      const stats = instId ? extractStats(String(instId)) : undefined;
      const item: LeanItem = {
        instance_id: String(instId),
        hash: rawItem.itemHash,
        power: inst?.primaryStat?.value ?? 0,
        location,
        tag: tags[String(instId)],
      };
      if (stats) item.stats = stats;
      // Only include plugs when the item has stats (i.e. it's armor) —
      // saves payload size since weapons would otherwise inflate this.
      if (stats && instId) {
        const plugs = extractPlugs(String(instId));
        if (plugs) item.plug_hashes = plugs;
        const tuning = extractTuning(String(instId));
        if (tuning) Object.assign(item, tuning);
        const gt = inst?.gearTier;
        if (typeof gt === "number" && gt > 0) item.gear_tier = gt;
      }
      out.push(item);
    };

    // Vault
    for (const it of vault) push(it, "VAULT");

    // Per-character inventory + equipped
    for (const [charId, char] of Object.entries(chars) as Array<[string, any]>) {
      const cls = classNames[char.classType] ?? "?";
      const light = char.light ?? "?";
      const tag = `${cls.toUpperCase()} ${light}`;
      const inv = charInv[charId]?.items ?? [];
      for (const it of inv) push(it, tag);
      const eq = equipped[charId]?.items ?? [];
      for (const it of eq) push(it, `${cls.toUpperCase()} EQUIPPED`);
    }

    return c.json({ items: out, count: out.length });
  } catch (e: any) {
    return c.json({ error: "inventory_fetch_failed", detail: e.message }, 502);
  }
});

// ============================================================
// /tags
// ============================================================
app.put("/api/tags", async (c) => {
  const u = c.get("user");
  const body = await c.req.json<{ instance_id: string; tag: string | null }>();
  if (body.tag === null) delete u.item_tags[body.instance_id];
  else u.item_tags[body.instance_id] = body.tag;
  await c.env.DV_KV.put(`user:${u.bungie_id}`, JSON.stringify(u));
  return c.json({ ok: true });
});

// ============================================================
// /equip — equip a set of items onto a character.
// ============================================================
// Body: { character_id, item_instance_ids: string[], item_hashes?: number[] }
// Behavior:
//   1. For each item, find its current location via /Profile.
//   2. If in vault → transfer to target character.
//   3. If equipped on a different character → pull-from-equip there,
//      transfer to vault, then transfer to target character.
//   4. Batch-equip all items on target character via EquipItems.
// Returns { equipped: string[], skipped: {instance_id, reason}[] }.
// ============================================================
// /api/this-week — Kyber-Community-parity weekly rotation feed
// Returns a single aggregate JSON with every vendor section.
// KV-cached per-user (60min TTL); see worker/src/this-week.ts.
// ============================================================
app.get("/api/this-week", async (c) => {
  const u = c.get("user");
  try {
    const data = await getThisWeek(c.env, u);
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: `this-week fetch failed: ${e.message ?? e}` }, 500);
  }
});

//
// Bungie endpoints used (via equipFlow.transferAndEquip):
//   POST /Destiny2/Actions/Items/TransferItem/   (move between vault ↔ char)
//   POST /Destiny2/Actions/Items/EquipItems/     (batch equip on one char)
// The pipeline auto-vaults the weakest unfavorited piece when a target
// bucket is at the 9-item cap, and frees pieces equipped on OTHER
// characters by equipping a spare there first — so equip works from any
// starting location instead of dying on DestinyNoRoomInDestination.
app.post("/api/equip", async (c) => {
  const u = c.get("user");
  type EquipReq = {
    character_id: string;
    item_instance_ids: string[];
    item_hashes?: number[];  // legacy parallel array — no longer needed
  };
  const body = await c.req.json<EquipReq>();
  if (!body.character_id || !body.item_instance_ids?.length) {
    return c.json({ error: "missing character_id or item_instance_ids" }, 400);
  }

  try {
    const out = await transferAndEquip(c.env, u, body.character_id, body.item_instance_ids);
    return c.json({ ok: true, ...out });
  } catch (e: any) {
    return c.json({ error: "equip failed", detail: e.message ?? String(e) }, 502);
  }
});

// ============================================================
// /api/transfer-to-vault — move (unequipped) items from a character to the
// vault. Used by the optimizer to evict the weakest-stat piece(s) and make
// room before equipping a new set, so the Guardian has no downtime. Equipped
// items can't be transferred (Bungie rejects) — reported in `skipped`.
// ============================================================
app.post("/api/transfer-to-vault", async (c) => {
  const u = c.get("user");
  type VaultReq = {
    character_id: string;
    item_instance_ids: string[];
    item_hashes: number[];   // parallel to item_instance_ids — TransferItem needs the hash
  };
  const body = await c.req.json<VaultReq>();
  if (!body.character_id || !body.item_instance_ids?.length) {
    return c.json({ error: "missing character_id or item_instance_ids" }, 400);
  }
  const hashes = body.item_hashes ?? [];
  const skipped: Array<{ instance_id: string; reason: string }> = [];
  let transferred = 0;
  for (let i = 0; i < body.item_instance_ids.length; i++) {
    const iid = body.item_instance_ids[i];
    const hash = hashes[i];
    if (!hash) { skipped.push({ instance_id: iid, reason: "missing item hash" }); continue; }
    try {
      await bungiePost(c.env, "/Destiny2/Actions/Items/TransferItem/", u.access_token, {
        itemReferenceHash: hash,
        stackSize: 1,
        transferToVault: true,
        itemId: iid,
        characterId: body.character_id,
        membershipType: u.membership_type,
      });
      transferred++;
    } catch (e: any) {
      skipped.push({ instance_id: iid, reason: `transfer failed: ${e.message ?? e}` });
    }
  }
  return c.json({ ok: true, transferred_count: transferred, skipped });
});

// ============================================================
// /api/equip-with-mods — equip + insert armor mods socket-by-socket
// ============================================================
// After the standard equip flow, also call Bungie's InsertSocketPlug
// for each (instance_id, socketIndex, plugItemHash) tuple. Used by the
// /fireteam modal's "Load this loadout" button to also apply the
// leader's armor mods onto the user's matched pieces.
//
// Body: {
//   character_id,
//   item_instance_ids: string[],         // same as /api/equip
//   mod_plan: Array<{
//     instance_id: string,
//     sockets: Array<{ socketIndex: number, plugItemHash: number }>,
//   }>,
// }
//
// Returns: equip result + per-socket {ok, error} list.
//
// Bungie ref: POST /Destiny2/Actions/Items/InsertSocketPlug/
//   body: { actionToken?, itemInstanceId, plug{socketIndex, socketArrayType, plugItemHash},
//           characterId, membershipType }
//   socketArrayType: 0 = Default (mods), 1 = Intrinsic
// ============================================================
app.post("/api/equip-with-mods", async (c) => {
  // Session-gated path — reuse the existing session middleware. (We don't
  // mount middleware on /api/equip-with-mods directly because Hono routes
  // are flat; mirror the requireSession logic inline.)
  const sid = getCookie(c, "dv_sid");
  if (!sid) return c.json({ error: "not_signed_in" }, 401);
  const sessRaw = await c.env.DV_KV.get(`session:${sid}`);
  if (!sessRaw) return c.json({ error: "session_expired" }, 401);
  const { bungie_id } = JSON.parse(sessRaw);
  const userRaw = await c.env.DV_KV.get(`user:${bungie_id}`);
  if (!userRaw) return c.json({ error: "user_missing" }, 401);
  let u: StoredUser = JSON.parse(userRaw);
  if (u.access_expires_at < Math.floor(Date.now() / 1000) + 60) {
    try {
      const tokens = await refreshAccessToken(c.env, u.refresh_token);
      u.access_token = tokens.access_token;
      u.access_expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in - 60);
      if (tokens.refresh_token) u.refresh_token = tokens.refresh_token;
      await c.env.DV_KV.put(`user:${bungie_id}`, JSON.stringify(u));
    } catch (e: any) {
      return c.json({ error: "refresh_failed", detail: e.message }, 401);
    }
  }

  type Body = {
    character_id: string;
    item_instance_ids: string[];
    mod_plan: Array<{
      instance_id: string;
      sockets: Array<{ socketIndex: number; plugItemHash: number; clear?: boolean }>;
    }>;
  };
  const body = await c.req.json<Body>();
  if (!body.character_id || !body.item_instance_ids?.length) {
    return c.json({ error: "missing character_id or item_instance_ids" }, 400);
  }

  // 1. Run the shared equip pipeline (bucket-full eviction, cross-character
  //    frees, exotics-last ordering — see equipFlow.ts).
  let equipOut: Awaited<ReturnType<typeof transferAndEquip>>;
  try {
    equipOut = await transferAndEquip(c.env, u, body.character_id, body.item_instance_ids);
  } catch (e: any) {
    return c.json({ error: "equip failed", detail: e.message ?? String(e) }, 502);
  }
  const target = body.character_id;
  const equippedCount = equipOut.equipped_count;
  const skipped = equipOut.skipped;

  // 2. Apply the mod plan IN ORDER. The client builds it as clears-then-applies
  //    with EXACT socket indices from the baked armor socket layout, so we insert
  //    at the given socketIndex directly (no resolution — the empty plug is shared
  //    across mod sockets, so searching by plug hash would mis-target). We SKIP
  //    sockets already holding the desired plug and use InsertSocketPlugFree
  //    (overwrites; no action token). Clearing each mod socket first frees armor
  //    energy so applies can't fail DestinyFailedPlugInsertionRules.
  type SocketResult = {
    instance_id: string; socketIndex: number; plugItemHash: number;
    ok: boolean; skipped?: boolean; clear?: boolean; error?: string;
  };
  const modResults: SocketResult[] = [];

  let socketsData: Record<string, any> = {};
  if ((body.mod_plan ?? []).length) {
    try {
      const sp = await bungieGet(
        c.env,
        `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=305`,
        u.access_token,
      );
      socketsData = sp?.itemComponents?.sockets?.data ?? {};
    } catch { /* skip-if-correct just won't trigger */ }
  }

  for (const piece of body.mod_plan ?? []) {
    const iid = piece.instance_id;
    const cur: number[] = (socketsData[iid]?.sockets ?? []).map((s: any) => s.plugHash);
    for (const slot of piece.sockets) {
      const idx = slot.socketIndex;
      const base = { instance_id: iid, socketIndex: idx, plugItemHash: slot.plugItemHash, clear: slot.clear };
      if (idx < 0) { modResults.push({ ...base, ok: false, error: "no socket index" }); continue; }
      if (cur[idx] === slot.plugItemHash) { modResults.push({ ...base, ok: true, skipped: true }); continue; }
      try {
        await bungiePost(c.env, "/Destiny2/Actions/Items/InsertSocketPlugFree/", u.access_token, {
          plug: { socketIndex: idx, socketArrayType: 0, plugItemHash: slot.plugItemHash },
          itemId: iid,
          characterId: target,
          membershipType: u.membership_type,
        });
        cur[idx] = slot.plugItemHash;
        modResults.push({ ...base, ok: true });
      } catch (e: any) {
        const emsg = e?.message ?? String(e);
        // The socket already holds this exact plug → desired state met, not a failure.
        if (/DestinySocketAlreadyHasPlug/.test(emsg)) modResults.push({ ...base, ok: true, skipped: true });
        else modResults.push({ ...base, ok: false, error: emsg });
      }
    }
  }

  return c.json({
    ok: true,
    equipped_count: equippedCount,
    transferred_count: equipOut.transferred_count,
    vaulted: equipOut.vaulted,
    swapped: equipOut.swapped,
    skipped,
    mod_results: modResults,
    // Counts cover the real mod APPLIES, not the socket clears (plumbing).
    mods_inserted: modResults.filter((m) => m.ok && !m.skipped && !m.clear).length,
    mods_skipped: modResults.filter((m) => m.ok && m.skipped && !m.clear).length,
    mods_failed: modResults.filter((m) => !m.ok).length,
  });
});

// ============================================================
// /api/internal/* — bot-side endpoints, shared-secret authenticated.
// Lets Darth Bot (Discord) trigger equips on the Discord user's behalf,
// using the access_token the user authorized via the web OAuth flow.
//
// Auth: header `X-Internal-Bot-Secret: <env.BOT_SHARED_SECRET>`.
// All routes take `bungie_id` (resolved by the bot via the backend's
// link DB, /link/discord/<id>) so we can look up the right KV record.
// ============================================================

async function requireBotSecret(c: any): Promise<{ user: StoredUser } | Response> {
  const secret = c.req.header("X-Internal-Bot-Secret");
  if (!c.env.BOT_SHARED_SECRET) {
    return c.json({ error: "internal auth not configured on Worker" }, 503);
  }
  if (!secret || secret !== c.env.BOT_SHARED_SECRET) {
    return c.json({ error: "bad internal secret" }, 401);
  }
  return { user: null as any };  // caller still has to load the user by bungie_id
}

async function loadUserByBungieId(c: any, bungie_id: string): Promise<StoredUser | null> {
  if (!bungie_id) return null;
  const raw = await c.env.DV_KV.get(`user:${bungie_id}`);
  if (!raw) return null;
  const user = JSON.parse(raw) as StoredUser;
  // Refresh access token if near expiry — mirror the requireSession logic.
  if (user.access_expires_at < Math.floor(Date.now() / 1000) + 60) {
    try {
      const tokens = await refreshAccessToken(c.env, user.refresh_token);
      user.access_token = tokens.access_token;
      user.access_expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in - 60);
      if (tokens.refresh_token) user.refresh_token = tokens.refresh_token;
      await c.env.DV_KV.put(`user:${bungie_id}`, JSON.stringify(user));
    } catch {
      return null;
    }
  }
  return user;
}

// Lean inventory snapshot for a Discord-linked user. Used by the bot
// to build the "this is what you own" view + map build-template names
// to instance IDs before equip.
app.post("/api/internal/inventory", async (c) => {
  const auth = await requireBotSecret(c);
  if (auth instanceof Response) return auth;
  const body = await c.req.json<{ bungie_id: string }>();
  const u = await loadUserByBungieId(c, body.bungie_id);
  if (!u) return c.json({ error: "user not in KV (link expired?)" }, 404);

  const profile = await bungieGet(
    c.env,
    `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=102,200,201,205,300`,
    u.access_token,
  );
  const chars = profile?.characters?.data ?? {};
  const charInv = profile?.characterInventories?.data ?? {};
  const equipped = profile?.characterEquipment?.data ?? {};
  const vault = profile?.profileInventory?.data?.items ?? [];
  const instances = profile?.itemComponents?.instances?.data ?? {};
  const classNames: Record<number, string> = { 0: "Titan", 1: "Hunter", 2: "Warlock" };

  const items: Array<{
    instance_id: string;
    hash: number;
    power: number;
    location: string;
  }> = [];
  const push = (it: any, location: string) => {
    if (!it.itemInstanceId) return;
    items.push({
      instance_id: String(it.itemInstanceId),
      hash: it.itemHash,
      power: instances[String(it.itemInstanceId)]?.primaryStat?.value ?? 0,
      location,
    });
  };
  for (const it of vault) push(it, "VAULT");
  for (const [cid, ch] of Object.entries(chars) as Array<[string, any]>) {
    const cls = classNames[ch.classType] ?? "?";
    for (const it of charInv[cid]?.items ?? []) push(it, `${cls.toUpperCase()}`);
    for (const it of equipped[cid]?.items ?? []) push(it, `${cls.toUpperCase()} EQUIPPED`);
  }
  const characters = (Object.entries(chars) as Array<[string, any]>).map(([id, ch]) => ({
    id,
    class: classNames[ch.classType] ?? "?",
    light: ch.light ?? 0,
  }));
  characters.sort((a, b) => (b.light || 0) - (a.light || 0));

  return c.json({
    bungie_id: body.bungie_id,
    display_name: u.display_name,
    membership_type: u.membership_type,
    membership_id: u.membership_id,
    characters,
    items,
  });
});

// Bot-side "this week" lookup — calls the same getThisWeek() aggregator
// the session-authed /api/this-week uses, but authenticates via shared
// secret + explicit bungie_id so Darth Bot can serve /this-week to
// Discord users.
app.post("/api/internal/this-week", async (c) => {
  const auth = await requireBotSecret(c);
  if (auth instanceof Response) return auth;
  const body = await c.req.json<{ bungie_id: string }>();
  const u = await loadUserByBungieId(c, body.bungie_id);
  if (!u) return c.json({ error: "user not in KV (link expired?)" }, 404);
  try {
    const data = await getThisWeek(c.env, u);
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: `this-week fetch failed: ${e.message ?? e}` }, 500);
  }
});

// Equip a set of items onto a character — same logic as /api/equip but
// authenticated via shared secret + explicit bungie_id rather than session.
app.post("/api/internal/equip", async (c) => {
  const auth = await requireBotSecret(c);
  if (auth instanceof Response) return auth;
  type Body = {
    bungie_id: string;
    character_id: string;
    item_instance_ids: string[];
  };
  const body = await c.req.json<Body>();
  if (!body.bungie_id || !body.character_id || !body.item_instance_ids?.length) {
    return c.json({ error: "missing fields" }, 400);
  }
  const u = await loadUserByBungieId(c, body.bungie_id);
  if (!u) return c.json({ error: "user not in KV" }, 404);

  try {
    const out = await transferAndEquip(c.env, u, body.character_id, body.item_instance_ids);
    return c.json({ ok: true, ...out });
  } catch (e: any) {
    return c.json({ error: "equip failed", detail: e.message ?? String(e) }, 502);
  }
});

// ============================================================
// Backend proxy — forwards LLM/KB/manifest calls to the Python FastAPI
// service on the VPS. The web frontend hits /api/* on the same origin
// (no CORS), the Worker adds session context, and the backend trusts
// us (network-level boundary). See backend/README.md.
// ============================================================
async function proxyToBackend(
  c: any,
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<Response> {
  const backend = c.env.BACKEND_BASE_URL;
  if (!backend) {
    return c.json({ error: "backend_not_configured" }, 503);
  }
  const url = backend.replace(/\/$/, "") + path;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Forwarded-By": "destiny-voyager-worker",
  };
  // Forward session id if the user is logged in — backend can resolve
  // it to a bungie_id via KV lookup we'll wire later. (Cookie name
  // matches the auth flow above.)
  const sid = getCookie(c, "dv_sid");
  if (sid) headers["X-Session-Id"] = sid;
  const body = init.method && init.method !== "GET" ? await c.req.text() : undefined;
  try {
    const r = await fetch(url, { method: init.method ?? "GET", headers, body });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (e: any) {
    return c.json({ error: "backend_unreachable", detail: e.message }, 502);
  }
}

// Public — no session required
app.post("/api/chat", (c) => proxyToBackend(c, "/chat", { method: "POST" }));
app.get("/api/meta/state", (c) => proxyToBackend(c, "/meta/state"));
app.get("/api/meta/twab", (c) => proxyToBackend(c, "/meta/twab"));
app.get("/api/manifest/lookup", (c) => {
  const q = c.req.query("q") ?? "";
  return proxyToBackend(c, `/manifest/lookup?q=${encodeURIComponent(q)}`);
});

// Session-gated — link/complete needs an authenticated user; the proxy
// forwards X-Session-Id which the backend resolves against the KV (or
// later, against the link DB).
app.post("/api/link/complete", (c) => proxyToBackend(c, "/link/complete", { method: "POST" }));

// ============================================================
// 404
// ============================================================
app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

export default app;
