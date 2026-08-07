/**
 * web/src/lib/equipPlan.ts — turn a selectMods() loadout into a concrete,
 * socket-indexed mod plan the Worker applies via /api/equip-with-mods.
 *
 * Sockets are resolved DETERMINISTICALLY from the baked armor socket layout
 * (armor_sockets.json): per armor item, the General mod socket (stat / general
 * mods) and the slot-specific mod sockets (surge / loader / resist / siphon).
 * The energy socket is excluded. The TUNING socket (Tier-5) IS insertable —
 * verified live 2026-07-22 via InsertSocketPlugFree — and is targeted through
 * the per-instance `tuning_idx` the Worker derives from component 310 (the
 * socket index isn't always present in the static item definition, e.g. older
 * exotics). We CLEAR every mod socket to its empty plug first (frees armor
 * energy), then apply the chosen mods — so a vault piece that already holds
 * mods swaps cleanly instead of failing DestinyFailedPlugInsertionRules.
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
  /** Phase-3 tuning assignment: instance_id → tuning plug to insert into the
   *  piece's live tuning socket (piece.tuning_idx). */
  tuningPlan?: Record<string, { plugHash: number; name: string }>,
): EquipPlan {
  const modPlan: ModPlanEntry[] = [];
  const placed: EquipPlan["placed"] = [];
  const unplaceable: EquipPlan["unplaceable"] = [];

  for (const piece of pieces) {
    const engineSlot = slotToMod[piece.slot];
    if (!engineSlot) continue;
    const plan = loadout.slots[engineSlot];
    const tuning = tuningPlan?.[piece.instance_id];
    if ((!plan || plan.mods.length === 0) && !tuning) continue;

    const layout = armorSockets[String(piece.hash)];
    if (!layout || (layout.general == null && layout.slots.length === 0)) {
      for (const mod of plan?.mods ?? []) {
        unplaceable.push({ slot: piece.slot, mod: mod.n, reason: `no mod sockets found on ${piece.name || piece.slot}` });
      }
    }

    // 1. Clear every mod socket to its empty plug (frees energy → clean swap).
    const clears: ModSocket[] = [];
    if (layout) {
      for (const i of [layout.general, ...layout.slots]) {
        if (i == null) continue;
        const e = layout.empties[String(i)];
        if (e) clears.push({ socketIndex: i, plugItemHash: e, clear: true });
      }
    }

    // 2. Assign mods: stat → General socket; everything else → slot sockets.
    const applies: ModSocket[] = [];
    if (layout) {
      let slotCursor = 0;
      for (const mod of plan?.mods ?? []) {
        const idx = mod.fam === "stat" ? layout.general : layout.slots[slotCursor++];
        if (idx == null) {
          unplaceable.push({ slot: piece.slot, mod: mod.n, reason: `no free ${mod.fam === "stat" ? "General" : engineSlot} socket` });
          continue;
        }
        applies.push({ socketIndex: idx, plugItemHash: mod.hash });
        placed.push({ slot: piece.slot, mod: mod.n });
      }
    }

    // 3. Tuning socket (no clear needed — InsertSocketPlugFree overwrites, 0e).
    if (tuning) {
      if (piece.tuning_idx != null) {
        applies.push({ socketIndex: piece.tuning_idx, plugItemHash: tuning.plugHash });
        placed.push({ slot: piece.slot, mod: tuning.name });
      } else {
        unplaceable.push({ slot: piece.slot, mod: tuning.name, reason: "tuning socket index unknown — slot in-game" });
      }
    }

    if (applies.length) modPlan.push({ instance_id: piece.instance_id, sockets: [...clears, ...applies] });
  }

  return { modPlan, placed, unplaceable };
}

// (Client-side eviction planning was removed — the Worker's equip pipeline
// now auto-vaults the weakest unfavorited piece server-side when a target
// bucket is at the 9-item cap, and frees pieces equipped on other
// characters. See worker/src/equipFlow.ts.)
