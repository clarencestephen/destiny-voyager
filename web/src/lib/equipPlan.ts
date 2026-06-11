/**
 * web/src/lib/equipPlan.ts — turn a selectMods() loadout into a concrete,
 * socket-indexed mod plan the Worker applies via /api/equip-with-mods.
 *
 * Sockets are resolved DETERMINISTICALLY from the baked armor socket layout
 * (armor_sockets.json): per armor item, the General mod socket (stat / general
 * mods) and the slot-specific mod sockets (surge / loader / resist / siphon).
 * The energy + tuning sockets are excluded (inserting a mod there → Bungie
 * DestinyItemActionForbidden). We CLEAR every mod socket to its empty plug
 * first (frees armor energy), then apply the chosen mods — so a vault piece
 * that already holds mods swaps cleanly instead of failing
 * DestinyFailedPlugInsertionRules.
 */
import type { ModLoadout } from "./mods";
import type { Item } from "./api";

export interface ModSocket { socketIndex: number; plugItemHash: number; clear?: boolean; }
export interface ModPlanEntry { instance_id: string; sockets: ModSocket[]; }

export interface EquipPlan {
  /** Ready to POST to /api/equip-with-mods. sockets are ordered: clears, then applies. */
  modPlan: ModPlanEntry[];
  placed: Array<{ slot: string; mod: string }>;
  unplaceable: Array<{ slot: string; mod: string; reason: string }>;
}

/** Baked armor socket layout: itemHash → mod-socket indices + empty plugs. */
export type ArmorSockets = Record<string, {
  general: number | null;
  slots: number[];
  empties: Record<string, number>;
}>;

/**
 * Build the clear-then-apply mod plan for a 5-piece combo. Stat/general mods go
 * to the piece's General socket; slot-specific mods to its slot mod sockets (in
 * order). Every mod socket is cleared to empty first so the apply always fits.
 * @param slotToMod maps the optimizer's piece slot ("Gauntlets") to the engine
 *        slot ("Arms").
 */
export function buildEquipPlan(
  pieces: Item[],
  loadout: ModLoadout,
  slotToMod: Record<string, keyof ModLoadout["slots"]>,
  armorSockets: ArmorSockets,
): EquipPlan {
  const modPlan: ModPlanEntry[] = [];
  const placed: EquipPlan["placed"] = [];
  const unplaceable: EquipPlan["unplaceable"] = [];

  for (const piece of pieces) {
    const engineSlot = slotToMod[piece.slot];
    if (!engineSlot) continue;
    const plan = loadout.slots[engineSlot];
    if (!plan || plan.mods.length === 0) continue;

    const layout = armorSockets[String(piece.hash)];
    if (!layout || (layout.general == null && layout.slots.length === 0)) {
      for (const mod of plan.mods) {
        unplaceable.push({ slot: piece.slot, mod: mod.n, reason: `no mod sockets found on ${piece.name || piece.slot}` });
      }
      continue;
    }

    // 1. Clear every mod socket to its empty plug (frees energy → clean swap).
    const clears: ModSocket[] = [];
    for (const i of [layout.general, ...layout.slots]) {
      if (i == null) continue;
      const e = layout.empties[String(i)];
      if (e) clears.push({ socketIndex: i, plugItemHash: e, clear: true });
    }

    // 2. Assign mods: stat → General socket; everything else → slot sockets.
    const applies: ModSocket[] = [];
    let slotCursor = 0;
    for (const mod of plan.mods) {
      const idx = mod.fam === "stat" ? layout.general : layout.slots[slotCursor++];
      if (idx == null) {
        unplaceable.push({ slot: piece.slot, mod: mod.n, reason: `no free ${mod.fam === "stat" ? "General" : engineSlot} socket` });
        continue;
      }
      applies.push({ socketIndex: idx, plugItemHash: mod.hash });
      placed.push({ slot: piece.slot, mod: mod.n });
    }

    if (applies.length) modPlan.push({ instance_id: piece.instance_id, sockets: [...clears, ...applies] });
  }

  return { modPlan, placed, unplaceable };
}

export interface EvictionItem {
  instance_id: string; hash: number; slot: string; name: string; total: number;
}

/**
 * Plan vault evictions so a new set can be equipped with zero downtime.
 * For each target slot whose incoming piece is coming from the VAULT, if the
 * active character's unequipped stock in that slot is at the bucket cap, the
 * weakest-total-stat non-exotic, non-favorited piece is evicted to make room.
 * `location` is class-scoped ("VAULT" | "<CLASS> <light>" | "<CLASS> EQUIPPED").
 */
export function buildEvictionPlan(
  pieces: Item[],
  allItems: Item[],
  activeClass: string,
  slotCap = 9,
): EvictionItem[] {
  const cls = (activeClass || "").toUpperCase();
  const total = (i: Item) =>
    i.stats ? Object.values(i.stats).reduce((a, b) => a + b, 0) : 0;
  const unequippedOnChar = (i: Item) => {
    const loc = (i.location || "").toUpperCase();
    return !!i.stats && loc !== "VAULT" && !loc.endsWith("EQUIPPED") && loc.startsWith(cls);
  };

  const out: EvictionItem[] = [];
  for (const slot of ["Helmet", "Gauntlets", "Chest", "Legs", "Class"]) {
    const incoming = pieces.find((p) => p.slot === slot);
    if (!incoming) continue;
    if ((incoming.location || "").toUpperCase() !== "VAULT") continue;  // already on-character → no room needed
    const stock = allItems.filter(
      (i) => i.slot === slot && i.instance_id !== incoming.instance_id && unequippedOnChar(i),
    );
    if (stock.length < slotCap) continue;
    const weakest = stock
      .filter((i) => i.tier !== "Exotic" && i.tag !== "favorite" && i.tag !== "keep")
      .sort((a, b) => total(a) - total(b))[0];
    if (weakest) {
      out.push({
        instance_id: weakest.instance_id, hash: weakest.hash,
        slot, name: weakest.name, total: total(weakest),
      });
    }
  }
  return out;
}
