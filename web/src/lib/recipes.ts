/**
 * Per-encounter weapon recipes (kinetic/energy/heavy) for the /play wizard.
 * Schema in web/public/weapon-recipes.json.
 *
 * Match is name-based against the user's decorated inventory — same pattern
 * as builds.ts. Each slot's `options` list is tried in priority order; the
 * first one the user owns is the match.
 */
import type { Item } from "./api";

export type Role = "DPS" | "Add-clear" | "Support" | "Anti-Champion" | "Survival" | string;

export interface WeaponRecipe {
  id: string;
  raid: string;          // raid or dungeon name
  encounter: string;
  role: Role;
  weapons: {
    kinetic: string[];
    energy: string[];
    heavy: string[];
  };
  rationale: string;
  tags?: string[];
  _confidence?: "high" | "medium" | "low";
}

export interface RecipesManifest {
  version: string;
  generated: string;
  _notes?: string;
  recipes: WeaponRecipe[];
}

export type RecipeSlotStatus =
  | { status: "owned"; item: Item; matchedOption: string; alternatives: string[] }
  | { status: "missing"; wantedOptions: string[] };

export interface RecipeFit {
  recipe: WeaponRecipe;
  kinetic: RecipeSlotStatus;
  energy:  RecipeSlotStatus;
  heavy:   RecipeSlotStatus;
  /** Number of the 3 weapon slots the user owns from this recipe. */
  ownedSlots: number;
  fitPct: number;
}

// ============================================================
// Loader (cached per page load)
// ============================================================
let _cache: RecipesManifest | null = null;
let _promise: Promise<RecipesManifest> | null = null;

export async function loadRecipes(): Promise<RecipesManifest> {
  if (_cache) return _cache;
  if (_promise) return _promise;
  _promise = fetch("/weapon-recipes.json", { credentials: "omit" })
    .then((r) => {
      if (!r.ok) throw new Error(`weapon-recipes.json HTTP ${r.status}`);
      return r.json() as Promise<RecipesManifest>;
    })
    .then((m) => { _cache = m; return m; });
  return _promise;
}

// ============================================================
// Fit logic
// ============================================================
const norm = (s: string) => s.toLowerCase().trim();

function findOwned(options: string[], items: Item[]): { item: Item; matchedOption: string } | null {
  for (const opt of options ?? []) {
    const target = norm(opt);
    const match = items.find((i) => norm(i.name) === target);
    if (match) return { item: match, matchedOption: opt };
  }
  return null;
}

function fitSlot(options: string[], items: Item[]): RecipeSlotStatus {
  const hit = findOwned(options, items);
  if (hit) {
    return {
      status: "owned",
      item: hit.item,
      matchedOption: hit.matchedOption,
      alternatives: options.filter((o) => o !== hit.matchedOption),
    };
  }
  return { status: "missing", wantedOptions: options ?? [] };
}

export function fitRecipe(recipe: WeaponRecipe, items: Item[]): RecipeFit {
  const k = fitSlot(recipe.weapons.kinetic, items);
  const e = fitSlot(recipe.weapons.energy,  items);
  const h = fitSlot(recipe.weapons.heavy,   items);
  const owned = [k, e, h].filter((s) => s.status === "owned").length;
  return {
    recipe,
    kinetic: k,
    energy:  e,
    heavy:   h,
    ownedSlots: owned,
    fitPct: owned / 3,
  };
}

/**
 * Find recipes matching a (raid, encounter, role?) situation. If role is
 * omitted, all role variants are returned. Returns fit-evaluated entries
 * sorted by ownership descending.
 */
export function matchRecipes(
  recipes: WeaponRecipe[],
  items: Item[],
  match: { raid?: string; encounter?: string; role?: string },
): RecipeFit[] {
  const filtered = recipes.filter((r) => {
    if (match.raid && r.raid !== match.raid) return false;
    if (match.encounter && r.encounter !== match.encounter) return false;
    if (match.role && r.role !== match.role) return false;
    return true;
  });
  return filtered
    .map((r) => fitRecipe(r, items))
    .sort((a, b) => b.fitPct - a.fitPct);
}

/** All unique roles found in the recipes manifest. */
export function rolesFromRecipes(recipes: WeaponRecipe[]): string[] {
  return Array.from(new Set(recipes.map((r) => r.role))).sort();
}
