/**
 * Encounter taxonomy used by the /play wizard.
 *
 * Sourced from meta_state.json (raids) + hand-curated dungeon list.
 * Each encounter is just a label — the recommendation logic sorts builds
 * by fit% against the user's inventory; the encounter context is for the
 * user to interpret (a future v2 will add encounter-tag matching).
 */

export type Activity = "PvE" | "PvP" | "Custom";

export type PvEMode =
  | "raid"
  | "dungeon"
  | "strike"
  | "playlist-ops"
  | "add-clear"
  | "gm";

export type PvPMode =
  | "control"
  | "competitive"
  | "trials"
  | "iron-banner"
  | "ffa";

export type CustomChallenge =
  | "bows-only"
  | "swords-only"
  | "new-archetypes-only"
  | "primaries-only"
  | "specials-only";

export interface ActivityEntry {
  name: string;
  encounters: string[];
}

/** Raids — encounter lists mirror darth-bot/data/meta_state.json. */
export const RAIDS: ActivityEntry[] = [
  { name: "Desert Perpetual",     encounters: [] },  // pending — newest raid
  { name: "Salvation's Edge",     encounters: ["Substratum", "Dissipation", "Repository", "Verity", "The Witness"] },
  { name: "Crota's End",          encounters: ["Abyss", "Bridge", "Ir Yut, the Deathsinger", "Crota, Son of Oryx"] },
  { name: "Root of Nightmares",   encounters: ["Cataclysm", "Scission", "Macrocosm", "Nezarec"] },
  { name: "King's Fall",          encounters: ["Basilica (Annihilator Totems)", "Warpriest", "Golgoroth", "Daughters of Oryx", "Oryx, the Taken King"] },
  { name: "Vow of the Disciple",  encounters: ["Acquisition", "Caretaker", "Exhibition", "Rhulk, Disciple of the Witness"] },
  { name: "Vault of Glass",       encounters: ["Confluxes", "Oracles", "Templar", "Gorgons (jumping puzzle)", "Gatekeepers", "Atheon, Time's Conflux"] },
  { name: "Deep Stone Crypt",     encounters: ["Sparrow descent", "Crypt Security", "Atraks-1, Fallen Exo", "Descent", "Taniks, the Abomination"] },
  { name: "Garden of Salvation",  encounters: ["Evade the Consecrated Mind", "Summon the Consecrated Mind", "Undying Mind", "Sanctified Mind"] },
  { name: "Last Wish",            encounters: ["Kalli, the Corrupted", "Shuro Chi, the Corrupted", "Morgeth, the Spirekeeper", "The Vault", "Riven of a Thousand Voices", "Queenswalk"] },
];

/** Dungeons — encounter lists from common community knowledge. */
export const DUNGEONS: ActivityEntry[] = [
  { name: "Equilibrium",          encounters: ["First Encounter", "Final Boss"] },
  { name: "Sundered Doctrine",    encounters: ["Trials", "Phylaks", "Final Boss"] },
  { name: "Warlord's Ruin",       encounters: ["Hefnd's Vengeance", "Balladry of Pain", "Locus of Wailing Grief"] },
  { name: "Ghosts of the Deep",   encounters: ["Ecthar, Shield of Savathûn", "Šimmumah ur-Nokru"] },
  { name: "Spire of the Watcher", encounters: ["Path of Burdens", "Akelous, the Siren's Current", "Persys, Primordial Ruin"] },
  { name: "Duality",              encounters: ["Gahlran's Deception", "Caitl, Sovereign Hand", "Caiatl, Empress of the Cabal"] },
  { name: "Grasp of Avarice",     encounters: ["Loot Cave", "Captain Avarokk, the Covetous", "Phry'zhia, the Insatiable"] },
  { name: "Prophecy",             encounters: ["Phalanx Echo", "Cube", "Kell Echo"] },
  { name: "Pit of Heresy",        encounters: ["Knight Hangings", "Necropolis", "Zulmak, Instrument of Torment"] },
  { name: "Shattered Throne",     encounters: ["The Labyrinth", "Vorgeth, the Boundless Hunger", "Dûl Incaru, the Eternal Return"] },
  { name: "Vesper's Host",        encounters: ["Operator + Scanner Glyphs", "Raneiks Unified", "Atraks Sovereign"] },
];

/** Strikes / Nightfall — strike-tier missions. v1 just lists generic categories. */
export const STRIKES: ActivityEntry[] = [
  { name: "Nightfall (this week)",  encounters: [] },
  { name: "Grandmaster Nightfall",  encounters: [] },
  { name: "Vanguard Ops playlist",  encounters: [] },
];

export const PVE_MODES_OTHER = [
  "playlist-ops",
  "add-clear",
] as const;

export const PVP_MODES: PvPMode[] = [
  "control", "competitive", "trials", "iron-banner", "ffa",
];

export const PVP_MODE_LABEL: Record<PvPMode, string> = {
  "control": "Control",
  "competitive": "Competitive",
  "trials": "Trials of Osiris",
  "iron-banner": "Iron Banner",
  "ffa": "Free-for-All",
};

export const CUSTOM_CHALLENGES: CustomChallenge[] = [
  "bows-only",
  "swords-only",
  "new-archetypes-only",
  "primaries-only",
  "specials-only",
];

export const CUSTOM_CHALLENGE_LABEL: Record<CustomChallenge, string> = {
  "bows-only": "Bows only",
  "swords-only": "Swords only",
  "new-archetypes-only": "New archetypes only",
  "primaries-only": "Primaries only",
  "specials-only": "Specials only",
};

/** Full picked-situation shape. */
export interface Situation {
  activity: Activity;
  // PvE
  pveMode?: PvEMode;
  pveActivity?: string;     // raid / dungeon / strike name
  encounter?: string;
  // PvP
  pvpMode?: PvPMode;
  // Custom
  challenge?: CustomChallenge;
}
