/**
 * web/src/lib/mods.ts — the optimizer's mod-selection engine.
 *
 * Pure, deterministic, side-effect-free. Given a build intent (subclass
 * element, the weapon you deal damage with, the encounter's incoming
 * damage profile, and any stat mods the armor couldn't reach on its own)
 * it returns a concrete per-armor-slot mod loadout: actual plug hashes,
 * not "+50 Health" suggestions.
 *
 * Anti-cross-pollination is the core rule. A single armor piece never
 * mixes elements within its combat-style mod, and each slot is assigned
 * the family that belongs there:
 *
 *   Legs   → Weapon Surge   (OFFENSE  — boosts matching-element weapon dmg)
 *   Chest  → Resistance / Concussive Dampener (DEFENSE — anti incoming dmg)
 *   Arms   → Loader         (RELOAD   — faster matching-element reloads)
 *   Helmet → Siphon         (ORBS     — orb generation on matching kills)
 *   Class  → utility        (Bomber / Distribution / Reaper …)
 *   <general socket on every piece> → Stat mods (Health/Weapons/…)
 *
 * `Harmonic` mods automatically match the equipped subclass element, so
 * they are the cross-pollination-proof default whenever we only know the
 * subclass (not a specific weapon element).
 *
 * The catalog is web/public/mods.json, baked by scripts/bake-mods.mjs.
 */

export type Element =
  | "Kinetic" | "Arc" | "Solar" | "Void" | "Stasis" | "Strand" | "Harmonic" | "";

export type ModSlot = "Helmet" | "Arms" | "Chest" | "Legs" | "Class" | "General";

export type ModFamily =
  | "surge" | "loader" | "siphon" | "resist" | "concussive"
  | "holster" | "dexterity" | "targeting" | "unflinch" | "ammo"
  | "survivability" | "stat" | "other";

export type StatKey =
  | "weapons" | "health" | "class" | "grenade" | "super" | "melee";

/** One entry of mods.json (keyed by hash string). */
export interface ModEntry {
  n: string;
  slot: ModSlot;
  fam: ModFamily;
  el: Element;
  cost: number;
  i?: string;
  stat?: StatKey;
  mag?: number;
}

export type ModCatalog = Record<string, ModEntry>;

/** A resolved mod = catalog entry + its hash. */
export interface Mod extends ModEntry {
  hash: number;
}

export interface StatModRequest {
  stat: StatKey;
  mag: 10 | 5;
}

export interface ModSelectionInput {
  /** Equipped subclass element — drives Loader / Siphon and the Harmonic fallback. */
  subclassElement: Element;
  /** Element(s) of the weapon(s) you do damage with — drive the offense Surge(s)
   *  on Legs. Multiple → one surge per element (split-damage builds), up to the
   *  3 leg sockets + energy budget. Defaults to subclassElement when empty. */
  dpsWeaponElements?: Element[];
  /** Encounter / activity incoming damage to resist (from the raid KB's
   *  recommended_defensive_mods.elemental). Each → an elemental Resistance on
   *  Chest (multiple allowed), alongside Concussive / Melee. */
  incomingElements?: Element[];
  /** Encounter is explosive / area-burst heavy → add Concussive Dampener (chest). */
  concussive?: boolean;
  /** Heavy incoming MELEE damage → add Melee Damage Resistance (chest). */
  meleeResist?: boolean;
  /** Stat mods the armor couldn't reach on its own (from the optimizer's
   *  stat planner). Distributed one-per-piece across the general sockets. */
  statMods?: StatModRequest[];
  /** Per-piece energy budget. Modern armor = 10. */
  energyBudget?: number;
  /** Bias when energy is scarce. */
  goal?: "offense" | "survival" | "balanced";
}

export interface SlotPlan {
  slot: ModSlot;
  /** Ordered: the slot's combat-style mod first, then the general/stat mod. */
  mods: Mod[];
  energyUsed: number;
  energyBudget: number;
  rationale: string;
}

export interface ModLoadout {
  /** One plan per equippable armor slot. */
  slots: Record<Exclude<ModSlot, "General">, SlotPlan>;
  warnings: string[];
}

const ARMOR_SLOTS: Exclude<ModSlot, "General">[] = ["Helmet", "Arms", "Chest", "Legs", "Class"];

/** Index the catalog once for fast family/element/slot lookups. */
export function indexCatalog(catalog: ModCatalog): Mod[] {
  return Object.entries(catalog).map(([hash, e]) => ({ hash: Number(hash), ...e }));
}

/**
 * Pick the single best mod for a (slot, family, element) intent.
 *  - exact element match wins
 *  - else a Harmonic mod (auto-matches subclass) — cross-pollination-proof
 *  - else the element-agnostic member of the family (e.g. Concussive Dampener)
 *  - cheapest energy breaks ties so more fits in the budget
 */
export function pickMod(
  mods: Mod[],
  slot: ModSlot,
  fam: ModFamily,
  element?: Element,
): Mod | null {
  const family = mods.filter((m) => m.slot === slot && m.fam === fam);
  if (family.length === 0) return null;

  const tiers: Array<(m: Mod) => boolean> = [];
  if (element && element !== "Harmonic") tiers.push((m) => m.el === element);
  tiers.push((m) => m.el === "Harmonic");
  if (element && element !== "Harmonic") tiers.push((m) => m.el === "Harmonic"); // explicit
  tiers.push((m) => m.el === "");          // element-agnostic (concussive, survivability)

  for (const pred of tiers) {
    const hit = family.filter(pred).sort((a, b) => a.cost - b.cost);
    if (hit.length) return hit[0];
  }
  // last resort: cheapest in family
  return [...family].sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/** Pick a specific mod by exact name within a slot (e.g. "Melee Damage
 *  Resistance"), cheapest copy first. Used for element-agnostic resists. */
function pickModByName(mods: Mod[], slot: ModSlot, name: string): Mod | null {
  const hits = mods.filter((m) => m.slot === slot && m.n === name);
  return hits.sort((a, b) => a.cost - b.cost)[0] ?? null;
}

function pickStatMod(mods: Mod[], req: StatModRequest): Mod | null {
  const hits = mods.filter(
    (m) => m.slot === "General" && m.fam === "stat" && m.stat === req.stat && m.mag === req.mag,
  );
  // Prefer the lowest energy (minor = 1, full = 3) canonical copy.
  return hits.sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/**
 * Build a concrete, anti-cross-pollination mod loadout for a five-piece set.
 *
 * The combat-style mod for each slot is chosen by rule; a stat mod (if any
 * were requested) is dropped into that piece's general socket as long as the
 * 10-energy budget allows, biggest stat-needs first.
 */
export function selectMods(input: ModSelectionInput, catalog: ModCatalog): ModLoadout {
  const mods = indexCatalog(catalog);
  const budget = input.energyBudget ?? 10;
  const subEl = input.subclassElement || "Harmonic";
  const dpsEls = (input.dpsWeaponElements ?? []).filter(Boolean) as Element[];
  const warnings: string[] = [];

  // 1) Combat-mod intents per slot. Legs (Surge) and Chest (Resistance) can each
  //    hold MULTIPLE — one per selected DPS element / incoming damage source —
  //    up to the piece's 3 slot sockets + energy budget. The rest are single.
  type Intent = { fam: ModFamily; el?: Element; name?: string; why: string };
  const incoming = (input.incomingElements ?? []).filter(Boolean) as Element[];

  const legIntents: Intent[] = dpsEls.length
    ? dpsEls.map((el) => ({ fam: "surge", el, why: `${el} Weapon Surge (your DPS weapon)` }))
    : [{ fam: "surge", el: subEl, why: `${subEl} Weapon Surge (follows subclass)` }];

  const chestIntents: Intent[] = [];
  if (input.concussive) chestIntents.push({ fam: "concussive", why: "Concussive Dampener (explosive/area-burst)" });
  for (const el of incoming) chestIntents.push({ fam: "resist", el, why: `${el} Resistance (incoming ${el})` });
  if (input.meleeResist) chestIntents.push({ fam: "resist", name: "Melee Damage Resistance", why: "Melee Damage Resistance (incoming melee)" });
  if (!chestIntents.length) chestIntents.push({ fam: "resist", el: subEl, why: `subclass-matched ${subEl} Resistance` });

  const intents: Record<Exclude<ModSlot, "General">, Intent[]> = {
    Legs:   legIntents,
    Chest:  chestIntents,
    Arms:   [{ fam: "loader",        el: subEl, why: `${subEl} Loader (build element)` }],
    Helmet: [{ fam: "siphon",        el: subEl, why: `${subEl} Siphon (subclass-matched)` }],
    Class:  [{ fam: "survivability", why: "class-item utility (Bomber / Distribution)" }],
  };

  // 2) Order stat mods biggest-first so the most valuable ones get a socket.
  const statQueue = [...(input.statMods ?? [])].sort((a, b) => b.mag - a.mag);
  const MAX_COMBAT = 3;   // slot-specific sockets per piece (general socket holds the stat mod)

  const slots = {} as Record<Exclude<ModSlot, "General">, SlotPlan>;
  for (const slot of ARMOR_SLOTS) {
    const chosen: Mod[] = [];
    let energyUsed = 0;
    const reasons: string[] = [];

    for (const intent of intents[slot].slice(0, MAX_COMBAT)) {
      const mod = intent.name
        ? pickModByName(mods, slot, intent.name)
        : pickMod(mods, slot, intent.fam, intent.el);
      if (!mod) { warnings.push(`No ${intent.name ?? intent.fam} mod found for ${slot}.`); continue; }
      if (energyUsed + mod.cost > budget) { warnings.push(`${mod.n} (${mod.cost}e) over budget on ${slot}.`); continue; }
      chosen.push(mod);
      energyUsed += mod.cost;
      reasons.push(intent.why);
    }

    // Drop the next-most-wanted stat mod into this piece's general socket.
    if (statQueue.length) {
      const req = statQueue[0];
      const statMod = pickStatMod(mods, req);
      if (statMod && energyUsed + statMod.cost <= budget) {
        chosen.push(statMod);
        energyUsed += statMod.cost;
        reasons.push(`+${req.mag} ${req.stat}`);
        statQueue.shift();
      }
    }

    slots[slot] = {
      slot,
      mods: chosen,
      energyUsed,
      energyBudget: budget,
      rationale: reasons.join(" · "),
    };
  }

  if (statQueue.length) {
    warnings.push(
      `${statQueue.length} stat mod(s) couldn't be placed within the energy budget: ` +
      statQueue.map((s) => `+${s.mag} ${s.stat}`).join(", "),
    );
  }

  return { slots, warnings };
}
