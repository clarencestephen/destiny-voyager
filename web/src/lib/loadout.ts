/**
 * Helpers for categorizing socket plugs (mods, perks, aspects, fragments,
 * abilities) on equipped items in the /fireteam viewer.
 *
 * Bungie returns a flat plug_hashes[] per item — to render the loadout the
 * way humans read it (weapon roll columns, subclass aspects/fragments,
 * armor mods), we bucket each plug by its manifest itemTypeDisplayName
 * (the `t` field on the slim manifest entry).
 */
import type { SlimManifest } from "./api";

export interface ResolvedPlug {
  hash: number;
  name: string;
  type: string;   // itemTypeDisplayName, e.g. "Aspect", "Trait", "Magazine"
  icon: string;   // full URL
  isExotic: boolean;
}

export interface LoadoutBuckets {
  /** Weapon roll columns — frame, barrel, magazine, traits, masterwork, mod. */
  intrinsic: ResolvedPlug[];
  barrel:    ResolvedPlug[];   // Barrel / Sight / Scope / Bowstring etc.
  magazine:  ResolvedPlug[];   // Magazine / Battery / Arrow
  traits:    ResolvedPlug[];   // Trait (the perk1 + perk2 columns)
  masterwork: ResolvedPlug[];
  weaponMod: ResolvedPlug[];
  /** Subclass blocks. */
  super:     ResolvedPlug[];
  abilities: ResolvedPlug[];   // Grenade / Melee / Class Ability / Movement
  aspects:   ResolvedPlug[];
  fragments: ResolvedPlug[];
  /** Armor mod block (catch-all for armor plugs). */
  armorMods: ResolvedPlug[];
  /** Anything we didn't classify — useful for debugging. */
  other:     ResolvedPlug[];
}

const BUNGIE_CDN = "https://www.bungie.net";

function resolve(hash: number, m: SlimManifest): ResolvedPlug | null {
  const e = m[String(hash)];
  if (!e || !e.n) return null;
  return {
    hash,
    name: e.n,
    type: e.t || "",
    icon: e.i ? BUNGIE_CDN + e.i : "",
    isExotic: e.x === true,
  };
}

function bucketName(t: string): keyof LoadoutBuckets | "other" {
  const x = (t || "").toLowerCase();
  if (!x) return "other";
  if (x.includes("intrinsic"))                                return "intrinsic";
  if (x.includes("super"))                                    return "super";
  if (x === "aspect")                                         return "aspects";
  if (x === "fragment")                                       return "fragments";
  if (x === "grenade" || x === "melee" || x === "class ability" || x === "movement")
                                                              return "abilities";
  if (x.includes("masterwork"))                               return "masterwork";
  if (x.includes("ornament"))                                 return "other";  // skip cosmetic
  if (x === "trait" || x === "weapon trait" || x === "enhanced trait")
                                                              return "traits";
  if (x.includes("barrel") || x.includes("sight") || x.includes("scope")
      || x.includes("bowstring") || x.includes("launcher") || x.includes("hammer forged")
      || x.includes("guard"))                                 return "barrel";
  if (x.includes("magazine") || x.includes("battery") || x.includes("arrow")
      || x.includes("blade") || x.includes("payload"))        return "magazine";
  if (x.includes("weapon mod"))                               return "weaponMod";
  if (x.includes("armor mod") || x.includes("armor charge") || x.includes("seasonal mod")
      || x.includes("artifice"))                              return "armorMods";
  return "other";
}

/**
 * Bucket a flat list of plug hashes into the human-readable groups
 * a loadout displays in (weapon perk columns / subclass blocks /
 * armor mods).
 */
export function bucketPlugs(plug_hashes: number[], m: SlimManifest): LoadoutBuckets {
  const out: LoadoutBuckets = {
    intrinsic: [], barrel: [], magazine: [], traits: [],
    masterwork: [], weaponMod: [],
    super: [], abilities: [], aspects: [], fragments: [],
    armorMods: [], other: [],
  };
  for (const h of plug_hashes) {
    const p = resolve(h, m);
    if (!p) continue;
    const b = bucketName(p.type);
    if (b === "other") {
      out.other.push(p);
    } else {
      (out[b] as ResolvedPlug[]).push(p);
    }
  }
  return out;
}

// ============================================================
// Weapon stat names — used to render the per-weapon stat sheet.
// Hashes from Bungie's DestinyStatDefinition; resolved by name so
// we don't need to load the stat manifest table client-side.
// ============================================================
export const WEAPON_STAT_LABELS: Record<string, string> = {
  "1240592695":  "Range",
  "155624089":   "Stability",
  "4188031367":  "Reload Speed",
  "943549884":   "Handling",
  "3614673599":  "Blast Radius",
  "2523465841":  "Velocity",
  "2837207746":  "Swing Speed",
  "447667954":   "Draw Time",
  "1591432999":  "Accuracy",
  "1842278586":  "Shield Duration",
  "2961396640":  "Charge Time",
  "1931675084":  "Inventory Size",
  "1345609583":  "Aim Assistance",
  "2715839340":  "Recoil Direction",
  "1480404414":  "Attack",
  "925767036":   "Ammo Capacity",
  "3871231066":  "Magazine",
  "4043523819":  "Impact",
  "4284893193":  "Rounds Per Minute",
  "209426660":   "Defense Energy",
  "3555269338":  "Zoom",
  "1931296004":  "Charge Rate",
  "2762071195":  "Guard Resistance",
};
