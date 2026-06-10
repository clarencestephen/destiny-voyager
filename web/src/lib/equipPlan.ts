/**
 * web/src/lib/equipPlan.ts — turn a selectMods() loadout into a concrete,
 * socket-indexed mod plan the Worker can apply via /api/equip-with-mods.
 *
 * The Worker inserts mods by (instance_id, socketIndex, plugItemHash), where
 * socketIndex is the position in the piece's plug_hashes array (Bungie socket
 * order). To place a chosen mod we must find the socket on that piece whose
 * category matches the mod (a Leg Weapon Surge → the piece's Leg-armor-mod
 * socket; a stat mod → the General socket). We read the category of each
 * currently-socketed plug from the baked mod catalog first, then the slim
 * manifest's itemTypeDisplayName. Sockets we can't classify are reported as
 * unplaceable rather than guessed — a wrong insert just fails harmlessly, but
 * we'd rather tell the user to set those by hand.
 */
import type { ModLoadout, ModCatalog } from "./mods";
import type { Item, SlimManifest } from "./api";

export interface ModSocket { socketIndex: number; plugItemHash: number; }
export interface ModPlanEntry { instance_id: string; sockets: ModSocket[]; }

export interface EquipPlan {
  /** Ready to POST to /api/equip-with-mods. */
  modPlan: ModPlanEntry[];
  placed: Array<{ slot: string; mod: string }>;
  unplaceable: Array<{ slot: string; mod: string; reason: string }>;
}

const TYPE_TO_SLOT: Record<string, string> = {
  "helmet armor mod": "Helmet",
  "arms armor mod": "Arms",
  "chest armor mod": "Chest",
  "leg armor mod": "Legs",
  "class item armor mod": "Class",
  "general armor mod": "General",
};

/** Which socket category a currently-socketed plug belongs to (or null). */
function socketCategory(plugHash: number, catalog: ModCatalog, manifest: SlimManifest): string | null {
  const cat = catalog[String(plugHash)];
  if (cat) return cat.slot;
  const t = (manifest[String(plugHash)]?.t || "").toLowerCase();
  return TYPE_TO_SLOT[t] ?? null;
}

/**
 * Build the socket-indexed mod plan for a 5-piece combo.
 * @param slotToMod maps the optimizer's piece slot ("Gauntlets") to the engine
 *        slot ("Arms"). Combat mods target that engine slot's socket; stat mods
 *        target the General socket.
 */
export function buildEquipPlan(
  pieces: Item[],
  loadout: ModLoadout,
  catalog: ModCatalog,
  manifest: SlimManifest,
  slotToMod: Record<string, keyof ModLoadout["slots"]>,
): EquipPlan {
  const modPlan: ModPlanEntry[] = [];
  const placed: EquipPlan["placed"] = [];
  const unplaceable: EquipPlan["unplaceable"] = [];

  for (const piece of pieces) {
    const engineSlot = slotToMod[piece.slot];
    if (!engineSlot) continue;
    const plan = loadout.slots[engineSlot];
    if (!plan || plan.mods.length === 0) continue;

    const plugs = piece.plug_hashes ?? [];
    const socketCats = plugs.map((h) => socketCategory(h, catalog, manifest));
    const used = new Set<number>();
    const sockets: ModSocket[] = [];

    for (const mod of plan.mods) {
      const targetCat = mod.fam === "stat" ? "General" : engineSlot;
      const idx = socketCats.findIndex((c, i) => c === targetCat && !used.has(i));
      if (idx < 0) {
        unplaceable.push({
          slot: piece.slot, mod: mod.n,
          reason: `no free ${targetCat} mod socket detected on ${piece.name || piece.slot}`,
        });
        continue;
      }
      used.add(idx);
      sockets.push({ socketIndex: idx, plugItemHash: mod.hash });
      placed.push({ slot: piece.slot, mod: mod.n });
    }
    if (sockets.length) modPlan.push({ instance_id: piece.instance_id, sockets });
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
