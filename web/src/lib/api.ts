/**
 * Tiny client for the Destiny Voyager Worker API.
 * All requests go through /api/* which is proxied to the Worker in dev
 * and served by the same domain in prod (Cloudflare Pages + Workers route).
 */

export interface CharacterSummary {
  id: string;
  class: "hunter" | "titan" | "warlock";
  equipped_power: number;
  emblem_path: string | null;
  emblem_background_path: string | null;
  date_last_played?: string;
}

export interface UserProfile {
  bungie_name: string;
  membership_id: string;
  primary_class: "hunter" | "titan" | "warlock";
  power: number;
  build_focus?: {
    /** Armor 3.0 piece archetype (Edge of Fate, 2025). Each governs
     *  which 2 stats roll primary + secondary on a piece. See
     *  https://www.bungie.net for Bungie's reference. */
    archetype: ArmorArchetype;
    goals: string[];
    target_stats: string[];
  };
  characters?: CharacterSummary[];
}

/** Armor 3.0 piece archetypes (Edge of Fate, 2025). Each governs
 *  which two of the six stats roll as primary (+30 max) and secondary
 *  (+25 max), plus a random tertiary (+20 max) from the remaining four. */
export type ArmorArchetype =
  | "Paragon"      // Super primary + Melee secondary
  | "Grenadier"    // Grenade primary + Super secondary
  | "Specialist"   // Class primary + Weapons secondary
  | "Brawler"      // Melee primary + Health secondary
  | "Bulwark"      // Health primary + Class secondary
  | "Gunner";      // Weapons primary + Grenade secondary

/** The six armor stats — Armor 3.0 names (Edge of Fate, 2025).
 *  Pre-EoF: Mobility/Resilience/Recovery/Discipline/Intellect/Strength.
 *  Hashes unchanged; only the names + semantics changed.
 *  Stat hashes map to these keys in the Worker.
 */
export interface ArmorStats {
  weapons: number;
  health:  number;
  class:   number;
  grenade: number;
  super:   number;
  melee:   number;
}
export const STAT_KEYS: (keyof ArmorStats)[] = [
  "weapons", "health", "class", "grenade", "super", "melee",
];
export const STAT_LABEL: Record<keyof ArmorStats, string> = {
  weapons: "Weapons",
  health:  "Health",
  class:   "Class",
  grenade: "Grenade",
  super:   "Super",
  melee:   "Melee",
};

/** Lean shape returned by /api/inventory — Worker no longer decorates */
export interface LeanItem {
  instance_id: string;
  hash: number;
  power: number;
  location: string;
  tag?: "favorite" | "keep" | "infuse" | "junk" | "archive";
  /** Per-armor base stats. Present only for armor pieces with non-zero stats. */
  stats?: ArmorStats;
  /** Active plug hashes (component 305). For armor, plug[0] is the archetype perk. */
  plug_hashes?: number[];
}

/** Decorated shape — Worker hash → manifest lookup → fully populated client-side */
export interface Item extends LeanItem {
  name: string;
  tier: string;
  type: string;
  slot: string;
  element: string;
  /** "Titan" | "Hunter" | "Warlock" | "Any" — which class can equip this item */
  class: string;
  isExotic: boolean;
  /** Full https URL to the item thumbnail on Bungie's CDN. Empty if missing. */
  iconUrl: string;
  /** Armor set / theme name (e.g. "Wild Anthem"). Empty for non-set pieces. */
  set: string;
  /** Post-EoF armor archetype derived from plug_hashes (Brawler / Bulwark / Grenadier / Gunner / Paragon / Specialist). Empty if none. */
  archetype: string;
}

/** All known post-EoF armor archetypes — used for /optimizer's filter chips.
 *  Mirrors the {@link ArmorArchetype} union above. */
export const ARMOR_ARCHETYPES: ArmorArchetype[] = [
  "Brawler", "Bulwark", "Grenadier", "Gunner", "Paragon", "Specialist",
];

/** Detect a post-EoF armor archetype from a piece's active plug names.
 *  Looks for an exact match against the known six archetype names in any
 *  of the plug `n` fields. Returns "" when nothing matches (pre-EoF or
 *  non-armor). */
export function detectArchetype(plug_hashes: number[] | undefined, manifest: SlimManifest): string {
  if (!plug_hashes?.length) return "";
  for (const h of plug_hashes) {
    const e = manifest[String(h)];
    if (!e?.n) continue;
    const n = e.n.trim();
    for (const a of ARMOR_ARCHETYPES) {
      if (n === a || n.startsWith(`${a} `) || n.endsWith(` ${a}`)) return a;
    }
  }
  return "";
}

/** Sum of two ArmorStats objects (or null-safe). */
export function sumStats(a?: ArmorStats, b?: ArmorStats): ArmorStats {
  return {
    weapons: (a?.weapons ?? 0) + (b?.weapons ?? 0),
    health:  (a?.health  ?? 0) + (b?.health  ?? 0),
    class:   (a?.class   ?? 0) + (b?.class   ?? 0),
    grenade: (a?.grenade ?? 0) + (b?.grenade ?? 0),
    super:   (a?.super   ?? 0) + (b?.super   ?? 0),
    melee:   (a?.melee   ?? 0) + (b?.melee   ?? 0),
  };
}

/** Is this slot one of the 5 armor slots used by the optimizer? */
export const ARMOR_SLOTS = ["Helmet", "Gauntlets", "Chest", "Legs", "Class"] as const;
export type ArmorSlot = typeof ARMOR_SLOTS[number];

/** Slim manifest entry — keys mirror bake-slim-manifest.mjs */
export interface ManifestEntry {
  n: string;   // name
  t: string;   // type
  r: string;   // tier (rarity)
  s: string;   // slot
  e: string;   // element
  c: string;   // class
  x: boolean;  // is exotic
  i?: string;  // icon path (relative — prepend bungie.net)
  st?: string; // armor set name (e.g. "Wild Anthem")
}

export const BUNGIE_CDN = "https://www.bungie.net";
export type SlimManifest = Record<string, ManifestEntry>;

let _manifestCache: SlimManifest | null = null;
let _manifestPromise: Promise<SlimManifest> | null = null;
export async function loadManifest(): Promise<SlimManifest> {
  if (_manifestCache) return _manifestCache;
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = fetch("/manifest.json", { credentials: "omit" })
    .then((r) => {
      if (!r.ok) throw new Error(`manifest.json HTTP ${r.status}`);
      return r.json() as Promise<SlimManifest>;
    })
    .then((m) => {
      _manifestCache = m;
      return m;
    });
  return _manifestPromise;
}

export function decorate(lean: LeanItem, manifest: SlimManifest): Item {
  const m = manifest[String(lean.hash)];
  return {
    ...lean,
    name:     m?.n ?? `#${lean.hash}`,
    type:     m?.t ?? "",
    tier:     m?.r ?? "",
    slot:     m?.s ?? "",
    element:  m?.e ?? "",
    class:    m?.c ?? "Any",
    isExotic: m?.x ?? false,
    iconUrl:  m?.i ? BUNGIE_CDN + m.i : "",
    set:      m?.st ?? "",
    archetype: detectArchetype(lean.plug_hashes, manifest),
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  category?: string;
}

export interface ChatResponse {
  answer: string;
  category: string;
  used_inventory: boolean;
  used_kb: boolean;
  used_search: boolean;
  used_manifest: boolean;
}

export interface MetaState {
  generated_at?: string;
  expansion: { current: string; year: number; current_episode?: string };
  power_levels: Record<string, unknown>;
  current_raid: { name: string; released_with?: string };
  recent_patches: Array<{
    date: string;
    title: string;
    category: string;
    url: string;
    summary: string;
  }>;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const api = {
  health: () => jsonFetch<{ status: string; version: string }>("/api/health"),

  me: () => jsonFetch<UserProfile>("/api/me"),

  /** Raw lean items from the Worker — decorate via loadManifest() + decorate() */
  inventory: () => jsonFetch<{ items: LeanItem[]; count: number }>("/api/inventory"),

  /** Convenience: fetch + decorate in one call. Manifest is browser-cached forever. */
  async inventoryDecorated(): Promise<Item[]> {
    const [{ items }, manifest] = await Promise.all([
      this.inventory(),
      loadManifest(),
    ]);
    return items.map((i) => decorate(i, manifest));
  },

  setTag: (instance_id: string, tag: Item["tag"] | null) =>
    jsonFetch<{ ok: true }>("/api/tags", {
      method: "PUT",
      body: JSON.stringify({ instance_id, tag }),
    }),

  /** Equip a set of items onto a character. Worker handles vault → char
   *  transfers automatically. Returns counts + per-item skip reasons.
   *  Items currently equipped on a different character are skipped — the
   *  user has to unequip those manually first (v1 limitation). */
  equip: (character_id: string, item_instance_ids: string[]) =>
    jsonFetch<{
      ok: true;
      equipped_count: number;
      transferred_count: number;
      skipped: Array<{ instance_id: string; reason: string }>;
    }>("/api/equip", {
      method: "POST",
      body: JSON.stringify({ character_id, item_instance_ids }),
    }),

  /** Equip a loadout AND copy a mod plan socket-by-socket. Used by the
   *  /fireteam "Load" button when the user wants to mirror an entire
   *  loadout including armor mods. The mod_plan is a list of
   *  {instance_id, sockets:[{socketIndex, plugItemHash}]} entries — one
   *  per armor piece, with the leader's plug hashes at the socket
   *  indices that hold mod-type plugs. */
  equipWithMods: (
    character_id: string,
    item_instance_ids: string[],
    mod_plan: Array<{
      instance_id: string;
      sockets: Array<{ socketIndex: number; plugItemHash: number }>;
    }>,
  ) =>
    jsonFetch<{
      ok: true;
      equipped_count: number;
      transferred_count: number;
      skipped: Array<{ instance_id: string; reason: string }>;
      mod_results: Array<{
        instance_id: string;
        socketIndex: number;
        plugItemHash: number;
        ok: boolean;
        error?: string;
      }>;
      mods_inserted: number;
      mods_failed: number;
    }>("/api/equip-with-mods", {
      method: "POST",
      body: JSON.stringify({ character_id, item_instance_ids, mod_plan }),
    }),

  /** Move unequipped items from a character to the vault — used to evict the
   *  weakest-stat piece(s) and make room before equipping a new set (zero
   *  downtime). Equipped items can't be transferred and come back in `skipped`. */
  transferToVault: (
    character_id: string,
    item_instance_ids: string[],
    item_hashes: number[],
  ) =>
    jsonFetch<{
      ok: true;
      transferred_count: number;
      skipped: Array<{ instance_id: string; reason: string }>;
    }>("/api/transfer-to-vault", {
      method: "POST",
      body: JSON.stringify({ character_id, item_instance_ids, item_hashes }),
    }),

  /** Look up multiple players by Bungie name (e.g. "Name#1234"). Public
   *  Bungie API; no per-user OAuth required. */
  fireteam: (bungie_names: string[]) =>
    jsonFetch<{
      members: Array<
        | {
            bungie_name: string;
            display_name: string;
            membership_id: string;
            membership_type: number;
            characters: Array<{
              id: string;
              class: "hunter" | "titan" | "warlock";
              light: number;
              emblem_path: string | null;
              emblem_background_path: string | null;
              date_last_played?: string;
              equipped: Array<{
                instance_id: string;
                hash: number;
                slot: string;
                slot_bucket_hash: number;
                power: number;
                /** Active mod/perk plug hashes from the item's sockets (component 305). */
                plug_hashes?: number[];
                /** Per-instance stat sheet (component 304): statHash → value. */
                item_stats?: Record<string, number>;
              }>;
            }>;
          }
        | { bungie_name: string; error: string }
      >;
    }>("/api/fireteam", {
      method: "POST",
      body: JSON.stringify({ bungie_names }),
    }),

  authUrl: () =>
    jsonFetch<{ url: string }>("/api/auth/login"),

  logout: () =>
    jsonFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // Chat — proxied by the Worker to the Python backend (FastAPI /chat)
  chat: (question: string) =>
    jsonFetch<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  // Meta state — current expansion, power caps, recent patches
  metaState: () =>
    jsonFetch<{ state: MetaState; prompt_block: string }>("/api/meta/state"),

  // Discord ↔ Bungie account link completion
  linkComplete: (code: string, bungie_id: string, display_name?: string) =>
    jsonFetch<{ discord_id: string; bungie_id: string; linked_at: number }>(
      "/api/link/complete",
      {
        method: "POST",
        body: JSON.stringify({ code, bungie_id, display_name }),
      },
    ),
};
