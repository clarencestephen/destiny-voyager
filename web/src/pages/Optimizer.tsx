import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api, sumStats, loadManifest, STAT_KEYS, STAT_LABEL, ARMOR_SLOTS, ARMOR_ARCHETYPES,
  type ArmorStats, type ArmorSlot, type CharacterSummary, type Item, type UserProfile,
  type SlimManifest,
} from "@/lib/api";
import { loadBuilds, buildsForClass, type BuildTemplate } from "@/lib/builds";
import {
  type ModCatalog, type ModLoadout, type Mod,
  type Element as ModElement,
} from "@/lib/mods";
import { buildEquipPlan, buildEvictionPlan, type EquipPlan, type EvictionItem, type ArmorSockets } from "@/lib/equipPlan";

// Map a build's subclass to the mod-engine element (Prismatic → Harmonic).
const SUBCLASS_TO_ELEMENT: Record<string, ModElement> = {
  Arc: "Arc", Solar: "Solar", Void: "Void", Stasis: "Stasis", Strand: "Strand",
};
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const CLASS_COLOR: Record<string, string> = {
  hunter: "text-hunter",
  titan:  "text-titan",
  warlock:"text-warlock",
};

// Subclass elements drive Loader/Siphon + the Harmonic fallback; weapon
// elements (incl. Kinetic) drive the Surge. Colours echo the in-game damage types.
const SUBCLASS_ELEMENTS: ModElement[] = ["Arc", "Solar", "Void", "Stasis", "Strand"];
const WEAPON_ELEMENTS:   ModElement[] = ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"];
const EL_COLOR: Record<string, string> = {
  Kinetic: "text-zinc-200", Arc: "text-cyan-300", Solar: "text-orange-400",
  Void: "text-violet-400", Stasis: "text-sky-300", Strand: "text-green-400",
  Harmonic: "text-saber", "": "text-muted",
};
// Optimizer uses "Gauntlets"; the mod engine uses "Arms".
const SLOT_TO_MOD: Record<string, keyof ModLoadout["slots"]> = {
  Helmet: "Helmet", Gauntlets: "Arms", Chest: "Chest", Legs: "Legs", Class: "Class",
};

// Default mod template — the FIXED utility mods (Mods 3/4/5) per slot, from the
// user's standard loadout screenshot. Mod 1 (+10 stat) is planned by the
// optimizer; Mod 2 (tuning) is planned + shown but slotted in the in-game tuning
// UI (the tuning socket isn't API-insertable). Editable in the Defaults panel
// and persisted per-device. Hashes resolved from the live manifest (mods.json).
type TemplateSlot = keyof ModLoadout["slots"];   // "Helmet" | "Arms" | "Chest" | "Legs" | "Class"
type ModTemplate = Record<TemplateSlot, number[]>;
const TEMPLATE_SLOTS: TemplateSlot[] = ["Helmet", "Arms", "Chest", "Legs", "Class"];
const DEFAULT_MOD_TEMPLATE: ModTemplate = {
  Helmet: [2595839237, 554409585, 3832366019],   // Special Ammo Finder · Heavy Ammo Finder · Harmonic Siphon
  Arms:   [2657604783, 1677180919, 1781551382],  // Harmonic Loader · Harmonic Dexterity · Grenade Font
  Chest:  [3410844187, 3719981603, 686455429],   // Void Resistance · Concussive Dampener · Health Font
  Legs:   [3467460423, 3994043492, 1133590731],  // Void Weapon Surge · Stacks on Stacks · Enhanced Athletics
  Class:  [4081595582, 1755737153, 1193713026],  // Proximity Ward · Time Dilation · Class Font
};
const MOD_TEMPLATE_KEY = "dv_mod_template_v1";

function loadModTemplate(): ModTemplate {
  try {
    const raw = localStorage.getItem(MOD_TEMPLATE_KEY);
    if (!raw) return DEFAULT_MOD_TEMPLATE;
    const t = JSON.parse(raw);
    // Validate shape; fall back to defaults for any missing slot.
    const out = {} as ModTemplate;
    for (const s of TEMPLATE_SLOTS) out[s] = Array.isArray(t[s]) ? t[s].slice(0, 3) : DEFAULT_MOD_TEMPLATE[s];
    return out;
  } catch { return DEFAULT_MOD_TEMPLATE; }
}

// Per-encounter mod hints baked from the raid KB (web/public/encounters.json,
// via raid_context/bake_encounters.py). Selecting an encounter pre-sets the
// chest resist / Concussive context — Phase 3 encounter-aware mods.
interface EncounterHint {
  slug: string; name: string; order: number;
  incoming_elements: ModElement[]; concussive: boolean;
  surges: ModElement[]; champions: string[];
}
interface ActivityHint {
  slug: string; name: string; type: string; encounters: EncounterHint[];
}

/** User-entered per-stat targets — the value to optimize each stat toward.
 *  A stat absent from this map (blank input) is ignored entirely. */
type StatTargets = Partial<Record<StatKey, number>>;

// Per-slot top-K prune before the cartesian product. K=12 → 12^5 = ~248k
// combos worst-case; the exotic filter knocks it down further. Fast on
// modern hardware; tune up if results feel sparse.
const TOP_K_PER_SLOT = 12;

// ============================================================
// Helpers
// ============================================================

type StatKey = keyof ArmorStats;
type Combo = {
  pieces: Item[];
  /** Raw stat totals from the 5 armor pieces (pre-mod). */
  totals: ArmorStats;
  /** Per-stat count of +10 mods + per-stat count of +5 mods. */
  modPlan: ModPlan;
  /** Stat totals AFTER applying the mod plan. */
  withMods: ArmorStats;
  /** Lexicographic score tuple — see scoreCombo */
  score: number[];
  activations: number;
  stretchHits: number;
  surplus: number;
  rawSum: number;
  totalPower: number;
  /** Mod slots consumed by the plan (out of 5). */
  modsUsed: number;
};

/** One tuning mod (the Mod-2 socket on a piece). `minus` present → flexible
 *  +5/−5 redistribution; `minus` absent → balanced +3 (net positive). */
type TuningMod = { plus: StatKey; minus?: StatKey };

/** Armor stat mod plan across the two stat-affecting sockets every EoF piece has:
 *  Mod 1 (general) = a +10/+5 stat mod, Mod 2 = a tuning mod. Mods 3/4/5 are the
 *  fixed utility template and don't touch stats, so they're not planned here. */
type ModPlan = {
  /** Mod-1 sockets: number of +10 mods per stat. */
  plus10: Partial<Record<StatKey, number>>;
  /** Mod-1 sockets: number of +5 mods per stat. */
  plus5:  Partial<Record<StatKey, number>>;
  /** Mod-2 sockets: one tuning mod per entry (≤5). */
  tuning: TuningMod[];
  /** Which tuning style won this combo: "flex" (+5/−5), "balanced" (+3), or null (no tuning helped). */
  tuningStyle: "flex" | "balanced" | null;
  /** Mod-1 sockets consumed (sum of plus10 + plus5). */
  used: number;
  /** Mod-2 sockets consumed (tuning.length). */
  tuningUsed: number;
};

const MOD_BUDGET = 5;  // 5 armor pieces, 1 of each socket type (general + tuning) per piece
const PLUS10 = 10;
const PLUS5  = 5;
const TUNE_FLEX = 5;   // flexible tuning mod: +5 to one stat, −5 from another
const TUNE_BAL  = 3;   // balanced tuning mod: +3 toward a short stat (no subtraction)

function isArmor(item: Item): boolean {
  return !!item.stats && ARMOR_SLOTS.includes(item.slot as ArmorSlot);
}

function selStatSum(item: Item, selected: StatKey[]): number {
  if (!item.stats) return 0;
  let s = 0;
  for (const k of selected) s += item.stats[k] ?? 0;
  return s;
}

function sumArmorStats(pieces: Item[]): ArmorStats {
  return pieces.reduce<ArmorStats>(
    (acc, p) => sumStats(acc, p.stats),
    { weapons: 0, health: 0, class: 0, grenade: 0, super: 0, melee: 0 },
  );
}

/**
 * TRUE base armor stats = the live (component-304) sheet MINUS the stats
 * contributed by the piece's CURRENTLY-equipped stat mods. The live sheet is
 * post-mod, so optimizing on it double-counts: the optimizer adds its OWN stat
 * mods on top of mods already there, and the projected totals don't match what
 * you actually get in-game (which clears mods first). We strip the equipped
 * stat mods (the +5/+10 "[stat] Mod"s in the catalog) to recover the base roll.
 */
function baseStats(item: Item, catalog: ModCatalog | null): ArmorStats | undefined {
  if (!item.stats || !catalog) return item.stats;
  const s: ArmorStats = { ...item.stats };
  for (const h of item.plug_hashes ?? []) {
    const m = catalog[String(h)];
    if (m?.fam === "stat" && m.stat && m.mag) {
      const k = m.stat as keyof ArmorStats;
      s[k] = Math.max(0, (s[k] ?? 0) - m.mag);
    }
  }
  return s;
}

// When the 5-slot budget can't satisfy every target, fill the highest-priority
// stats first. EoF meta: abilities were nerfed → Super, Weapons and especially
// Health (shield-recharge timing) matter most; bias scarce slots toward them.
const STAT_PRIORITY: Record<StatKey, number> = {
  health: 5, super: 4, weapons: 4, grenade: 3, class: 3, melee: 3,
};

// Per-stat target chips — tap a number instead of typing one. EoF stat model:
// only 100 and 200 are meaningful breakpoints (reach 200 when achievable, else
// 100+); Health consistently aims ~125; 150 is offered because Grenade scales
// with the stat on turret builds (Helion) and users asked for the option.
const STAT_CHIPS: Record<StatKey, number[]> = {
  health:  [100, 125, 150, 200],
  super:   [100, 150, 200],
  weapons: [100, 150, 200],
  grenade: [100, 150, 200],
  class:   [100, 150, 200],
  melee:   [100, 150, 200],
};

// One-tap goal profiles so a whole build target is a single click, not six
// inputs. "Balanced" is the everyday default (Health 125, the rest 100); the
// chips above fine-tune individual stats (e.g. push Super to 200, Grenade 150).
const GOAL_PRESETS: { label: string; hint: string; targets: StatTargets }[] = [
  { label: "Balanced", hint: "Health 125 · everything else 100", targets: { health: 125, super: 100, weapons: 100, grenade: 100, class: 100, melee: 100 } },
  { label: "All 100",  hint: "every stat to 100",                 targets: { health: 100, super: 100, weapons: 100, grenade: 100, class: 100, melee: 100 } },
];

// Highest-priority targeted stat still short of its target (tie → biggest gap).
// Returns null when every target is met.
function neediestStat(proj: ArmorStats, targets: StatTargets): StatKey | null {
  let best: StatKey | null = null, bestKey = -Infinity;
  for (const [s, t] of Object.entries(targets) as [StatKey, number][]) {
    if (!(t > 0) || proj[s] >= t) continue;
    const key = STAT_PRIORITY[s] * 1000 + (t - proj[s]);   // priority first, gap as tiebreak
    if (key > bestKey) { bestKey = key; best = s; }
  }
  return best;
}

/**
 * Plan the Mod-1 (general) sockets to reach each USER-SPECIFIED target. No
 * breakpoint logic — we just hit the numbers the user set (untargeted stats are
 * ignored). Cheapest-first (+5 only to close a ≤5 gap), highest-priority stats
 * first so a tight 5-slot budget favors the stats that matter most.
 */
function planMods(totals: ArmorStats, targets: StatTargets): ModPlan {
  const plan: ModPlan = { plus10: {}, plus5: {}, tuning: [], tuningStyle: null, used: 0, tuningUsed: 0 };
  const proj: Record<string, number> = { ...totals };

  function addPlus10(s: StatKey) { plan.plus10[s] = (plan.plus10[s] ?? 0) + 1; plan.used += 1; proj[s] += PLUS10; }
  function addPlus5(s: StatKey)  { plan.plus5[s]  = (plan.plus5[s] ?? 0)  + 1; plan.used += 1; proj[s] += PLUS5; }

  const entries = (Object.entries(targets) as [StatKey, number][])
    .filter(([, t]) => t > 0)
    .sort((a, b) => STAT_PRIORITY[b[0]] - STAT_PRIORITY[a[0]]);
  for (const [s, t] of entries) {
    while (proj[s] < t && plan.used < MOD_BUDGET) {
      const gap = t - proj[s];
      gap <= PLUS5 && gap > 0 ? addPlus5(s) : addPlus10(s);
    }
  }
  return plan;
}

/** Flexible tuning: each mod moves +5 to the neediest stat and −5 from a donor
 *  that can spare it (untargeted, or surplus ≥5 above its own target). Net-zero
 *  per mod — only helps when there's a stat to rob. */
function planTuningFlex(proj: ArmorStats, targets: StatTargets): TuningMod[] {
  const tuning: TuningMod[] = [];
  while (tuning.length < MOD_BUDGET) {
    const recipient = neediestStat(proj, targets);
    if (!recipient) break;
    // Pick the donor with the most spare headroom: untargeted stats can give down
    // to 0; targeted stats only down to their target. Most-spare first.
    let donor: StatKey | null = null, bestSpare = -Infinity;
    for (const s of STAT_KEYS) {
      if (s === recipient) continue;
      const floor = (targets[s] ?? 0) > 0 ? targets[s]! : 0;
      const spare = (proj[s] ?? 0) - floor;
      if (spare >= TUNE_FLEX && spare > bestSpare) { bestSpare = spare; donor = s; }
    }
    if (!donor) break;   // no legal donor → flex can't help further
    proj[recipient] += TUNE_FLEX;
    proj[donor]     -= TUNE_FLEX;
    tuning.push({ plus: recipient, minus: donor });
  }
  return tuning;
}

/** Balanced tuning: each mod adds +3 to the neediest stat (no subtraction).
 *  In-game this mod buffs your lowest stats; for targeting we steer the +3 to
 *  whichever targeted stat is shortest. */
function planTuningBalanced(proj: ArmorStats, targets: StatTargets): TuningMod[] {
  const tuning: TuningMod[] = [];
  while (tuning.length < MOD_BUDGET) {
    const recipient = neediestStat(proj, targets);
    if (!recipient) break;
    proj[recipient] += TUNE_BAL;
    tuning.push({ plus: recipient });
  }
  return tuning;
}

function applyTuning(totals: ArmorStats, tuning: TuningMod[]): ArmorStats {
  const out: ArmorStats = { ...totals };
  for (const t of tuning) {
    out[t.plus] += t.minus ? TUNE_FLEX : TUNE_BAL;
    if (t.minus) out[t.minus] -= TUNE_FLEX;
  }
  return out;
}

function applyModPlan(totals: ArmorStats, plan: ModPlan): ArmorStats {
  const out: ArmorStats = { ...totals };
  for (const [s, n] of Object.entries(plan.plus10)) out[s as StatKey] += (n ?? 0) * PLUS10;
  for (const [s, n] of Object.entries(plan.plus5))  out[s as StatKey] += (n ?? 0) * PLUS5;
  return applyTuning(out, plan.tuning);
}

/** {hits, deficit} of a projected stat sheet against the targets. */
function evalTargets(proj: ArmorStats, targets: StatTargets) {
  let hits = 0, deficit = 0, overshoot = 0;
  for (const [s, t] of Object.entries(targets) as [StatKey, number][]) {
    if (!(t > 0)) continue;
    const v = proj[s] ?? 0;
    if (v >= t) hits++; else deficit += t - v;
    overshoot += Math.max(0, v - t);
  }
  return { hits, deficit, overshoot };
}

function scoreCombo(totals: ArmorStats, pieces: Item[], targets: StatTargets) {
  // 1) Plan the +10/+5 general mods. 2) On top of that, try BOTH tuning styles
  //    and keep whichever scores better (more hits, then smaller deficit, then
  //    fewer tuning mods). 3) Score the final post-mod sheet.
  const modPlan = planMods(totals, targets);
  const after10 = applyModPlan(totals, { ...modPlan, tuning: [] });  // +10 layer only

  const flex = planTuningFlex({ ...after10 }, targets);
  const bal  = planTuningBalanced({ ...after10 }, targets);
  const eFlex = evalTargets(applyTuning(after10, flex), targets);
  const eBal  = evalTargets(applyTuning(after10, bal), targets);
  // Prefer more hits, then less deficit, then fewer tuning mods used.
  const flexWins =
    eFlex.hits !== eBal.hits ? eFlex.hits > eBal.hits
    : eFlex.deficit !== eBal.deficit ? eFlex.deficit < eBal.deficit
    : flex.length <= bal.length;
  const winner = flexWins ? flex : bal;
  modPlan.tuning = winner;
  modPlan.tuningUsed = winner.length;
  modPlan.tuningStyle = winner.length === 0 ? null : (flexWins ? "flex" : "balanced");

  const withMods = applyModPlan(totals, modPlan);
  const { hits, deficit, overshoot } = evalTargets(withMods, targets);
  let rawSum = 0;
  for (const [s, t] of Object.entries(targets) as [StatKey, number][]) {
    if (t > 0) rawSum += withMods[s] ?? 0;
  }
  const totalPower = pieces.reduce((p, x) => p + (x.power ?? 0), 0);
  // Score tuple (descending): most targets hit, then closest on the rest, then
  // fewest mods (general + tuning), then least overshoot, raw sum, armor power.
  return {
    score: [hits, -deficit, -(modPlan.used + modPlan.tuningUsed), -overshoot, rawSum, totalPower],
    activations: hits, stretchHits: 0, surplus: overshoot, rawSum, totalPower,
    modPlan, withMods, modsUsed: modPlan.used + modPlan.tuningUsed,
  };
}

// Resolve a planned stat mod ({stat,mag}) to its concrete catalog mod.
function findStatMod(catalog: ModCatalog, stat: StatKey, mag: number): Mod | null {
  for (const [h, e] of Object.entries(catalog)) {
    if (e.fam === "stat" && e.stat === stat && e.mag === mag) return { hash: Number(h), ...e };
  }
  return null;
}

/**
 * Build the equip mod loadout from the user's fixed template + the optimizer's
 * planned +10/+5 stat mods. Each piece's General socket gets one stat mod (Mod 1,
 * distributed one-per-piece, biggest first); its slot sockets get the template's
 * Mods 3/4/5. Mod 2 (tuning) is NOT placed here — the tuning socket isn't
 * API-insertable, so it stays a recommendation slotted in-game. Feeds straight
 * into buildEquipPlan (stat → General, the rest → slot sockets in order).
 */
function buildTemplateLoadout(modPlan: ModPlan, template: ModTemplate, catalog: ModCatalog): ModLoadout {
  // Flatten planned stat mods (≤5; +10s before +5s, highest-priority stat first).
  const statMods: Mod[] = [];
  const ordered = STAT_KEYS.slice().sort((a, b) => STAT_PRIORITY[b] - STAT_PRIORITY[a]);
  for (const s of ordered) for (let k = 0; k < (modPlan.plus10[s] ?? 0); k++) { const m = findStatMod(catalog, s, 10); if (m) statMods.push(m); }
  for (const s of ordered) for (let k = 0; k < (modPlan.plus5[s] ?? 0); k++)  { const m = findStatMod(catalog, s, 5);  if (m) statMods.push(m); }

  const slots = {} as ModLoadout["slots"];
  TEMPLATE_SLOTS.forEach((slot, i) => {
    const mods: Mod[] = [];
    const stat = statMods[i];                       // one stat mod per piece (General socket)
    if (stat) mods.push(stat);
    for (const h of template[slot] ?? []) {         // Mods 3/4/5 (slot sockets)
      const e = catalog[String(h)];
      if (e) mods.push({ hash: h, ...e });
    }
    const energyUsed = mods.reduce((a, m) => a + (m.cost ?? 0), 0);
    slots[slot] = { slot, mods, energyUsed, energyBudget: 10, rationale: "your default template" };
  });
  return { slots, warnings: [] };
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];  // desc
  }
  return 0;
}

// ============================================================
// Optimizer core
// ============================================================

/**
 * Theme lock entry — user says "I want N pieces of set X in the combo."
 * Multiple themes may be specified; the sum of counts must be ≤ 5.
 * Any remaining slots are unconstrained.
 */
export interface ThemeLock {
  setName: string;
  count: number;
}

const ZERO_STATS: ArmorStats = { weapons: 0, health: 0, class: 0, grenade: 0, super: 0, melee: 0 };

function optimize(
  items: Item[],
  cls: "Warlock" | "Hunter" | "Titan",
  targets: StatTargets,
  lockedExoticId: string | null,
  themeLocks: ThemeLock[] = [],
  archetypeFilter: string[] = [],
  fragmentDelta: ArmorStats = ZERO_STATS,
): { combos: Combo[]; pruned: Record<ArmorSlot, number> } {
  const selected = STAT_KEYS.filter((s) => (targets[s] ?? 0) > 0);  // stats with a target
  const themeReq = themeLocks.filter((t) => t.setName && t.count > 0);

  // Build per-slot pools. Only armor for this class (or class-neutral
  // class-items, which are class-locked but tagged as class-specific
  // by the manifest anyway).
  const pool: Record<ArmorSlot, Item[]> = {
    Helmet: [], Gauntlets: [], Chest: [], Legs: [], Class: [],
  };
  for (const it of items) {
    if (!isArmor(it)) continue;
    if (it.class !== cls && it.class !== "Any") continue;
    // Archetype filter — when the user has picked one or more archetypes,
    // only allow non-exotic pieces with a matching archetype. Exotics are
    // always allowed (they're a fixed slot — locking the exotic OR the
    // archetype, not both).
    if (archetypeFilter.length > 0 && it.tier !== "Exotic") {
      if (!it.archetype || !archetypeFilter.includes(it.archetype)) continue;
    }
    pool[it.slot as ArmorSlot]?.push(it);
  }

  // If an exotic is locked, isolate it. The locked piece must be in
  // pool; the OTHER slots get filtered to non-exotic only.
  const locked = lockedExoticId
    ? items.find((i) => i.instance_id === lockedExoticId) ?? null
    : null;
  const lockedSlot = locked ? (locked.slot as ArmorSlot) : null;

  for (const slot of ARMOR_SLOTS) {
    if (locked && lockedSlot === slot) {
      pool[slot] = [locked];
      continue;
    }
    if (locked && lockedSlot !== slot) {
      // Other slots: exclude exotics (only one allowed)
      pool[slot] = pool[slot].filter((p) => p.tier !== "Exotic");
    }
    // Prune to top-K by selected-stat sum
    pool[slot].sort((a, b) => selStatSum(b, selected) - selStatSum(a, selected));
    pool[slot] = pool[slot].slice(0, TOP_K_PER_SLOT);
  }

  // Pruned counts for diagnostics
  const pruned: Record<ArmorSlot, number> = {
    Helmet: pool.Helmet.length, Gauntlets: pool.Gauntlets.length,
    Chest: pool.Chest.length, Legs: pool.Legs.length, Class: pool.Class.length,
  };

  // Bail if any slot is empty
  for (const slot of ARMOR_SLOTS) {
    if (pool[slot].length === 0) {
      return { combos: [], pruned };
    }
  }

  // Cartesian product with at-most-one-exotic constraint
  const combos: Combo[] = [];
  for (const h of pool.Helmet)
    for (const g of pool.Gauntlets)
      for (const c of pool.Chest)
        for (const l of pool.Legs)
          for (const cl of pool.Class) {
            const pieces = [h, g, c, l, cl];
            // At most one exotic (unless locked exotic already in there)
            const exoticCount = pieces.filter((p) => p.tier === "Exotic").length;
            if (exoticCount > 1) continue;
            // If an exotic is locked, ensure it's actually present
            if (locked && !pieces.includes(locked)) continue;
            // Theme lock — combo must include ≥N pieces of each named set
            if (themeReq.length) {
              let ok = true;
              for (const t of themeReq) {
                const have = pieces.filter((p) => p.set === t.setName).length;
                if (have < t.count) { ok = false; break; }
              }
              if (!ok) continue;
            }
            // Baseline = armor base + equipped subclass FRAGMENT delta, so the
            // pre-mod totals (and mod planning) match the in-game character sheet.
            const totals = sumStats(sumArmorStats(pieces), fragmentDelta);
            const s = scoreCombo(totals, pieces, targets);
            combos.push({ pieces, totals, ...s });
          }

  combos.sort((a, b) => compareScore(a.score, b.score));
  return { combos: combos.slice(0, 5), pruned };
}

// ============================================================
// Page
// ============================================================

export default function Optimizer() {
  const [params] = useSearchParams();
  const buildId = params.get("build");
  const [me, setMe] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cls, setCls] = useState<"Hunter" | "Titan" | "Warlock" | null>(null);
  const [targets, setTargets] = useState<StatTargets>({});   // per-stat goal; blank = ignore
  const selected = useMemo(() => STAT_KEYS.filter((s) => (targets[s] ?? 0) > 0), [targets]);
  const [lockedExoticId, setLockedExoticId] = useState<string | null>(null);
  const [themeLocks, setThemeLocks] = useState<ThemeLock[]>([]);
  const [archetypeFilter, setArchetypeFilter] = useState<string[]>([]);
  const [results, setResults] = useState<Combo[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);

  // Mod selection context (Phase 2 — non-destructive preview).
  const [fragmentDeltas, setFragmentDeltas] = useState<Record<string, ArmorStats>>({});
  const [modCatalog, setModCatalog] = useState<ModCatalog | null>(null);
  const [manifest, setManifest] = useState<SlimManifest | null>(null);  // for socket mapping (Phase 4)
  const [armorSockets, setArmorSockets] = useState<ArmorSockets>({});   // baked mod-socket layout for equip
  // Full armor-set catalog (all 56 named sets + 2pc/4pc perks) so the theme
  // picker lists EVERY set, not just ones the user owns. ~5KB.
  const [setsCatalog, setSetsCatalog] = useState<{ n: string; perks: { count: number; n: string }[] }[]>([]);
  // Fixed Mods 3/4/5 template (per slot), defaulting to the user's screenshot.
  const [modTemplate, setModTemplate] = useState<ModTemplate>(() => loadModTemplate());
  const [showDefaults, setShowDefaults] = useState(false);
  function setTemplateMod(slot: TemplateSlot, idx: number, hash: number) {
    setModTemplate((cur) => {
      const next = { ...cur, [slot]: [...(cur[slot] ?? [])] };
      next[slot][idx] = hash;
      try { localStorage.setItem(MOD_TEMPLATE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function resetTemplate() {
    setModTemplate(DEFAULT_MOD_TEMPLATE);
    try { localStorage.removeItem(MOD_TEMPLATE_KEY); } catch { /* ignore */ }
  }
  // Candidate utility mods per slot for the Defaults dropdowns (everything that
  // fits that slot's mod sockets — excludes the General/stat-socket mods).
  const modsBySlot = useMemo(() => {
    const out = { Helmet: [], Arms: [], Chest: [], Legs: [], Class: [] } as Record<TemplateSlot, { hash: number; n: string; cost: number; fam: string }[]>;
    if (modCatalog) {
      for (const [h, e] of Object.entries(modCatalog)) {
        if ((TEMPLATE_SLOTS as string[]).includes(e.slot) && e.fam !== "stat") {
          out[e.slot as TemplateSlot].push({ hash: Number(h), n: e.n, cost: e.cost, fam: e.fam });
        }
      }
      for (const s of TEMPLATE_SLOTS) out[s].sort((a, b) => a.fam.localeCompare(b.fam) || a.n.localeCompare(b.n));
    }
    return out;
  }, [modCatalog]);
  const [subclassEl, setSubclassEl] = useState<ModElement>("");   // "" → Harmonic
  const [dpsEls, setDpsEls] = useState<ModElement[]>([]);         // [] → follow subclass; multi = split surges
  const [incomingEls, setIncomingEls] = useState<ModElement[]>([]); // chest elemental resist targets (multi)
  const [meleeResist, setMeleeResist] = useState(false);          // Melee Damage Resistance (chest)
  const [concussive, setConcussive] = useState(false);
  // Encounter-aware context (Phase 3) — drives the chest resist from the raid KB.
  const [encData, setEncData] = useState<ActivityHint[]>([]);
  const [activitySlug, setActivitySlug] = useState<string>("");
  const [encounterSlug, setEncounterSlug] = useState<string>("");
  // Builds-around-an-exotic (Phase 5).
  const [builds, setBuilds] = useState<BuildTemplate[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string>("");

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [profile, decorated] = await Promise.all([
          api.me(),
          api.inventoryDecorated(),
        ]);
        setMe(profile);
        setItems(decorated);
        // Mod catalog is static + small (~46KB) — load once, ignore failure
        // (the optimizer still works without the mod preview).
        fetch("/mods.json").then((r) => r.json()).then(setModCatalog).catch(() => {});
        api.getFragmentStats().then((d) => setFragmentDeltas(d.deltas as Record<string, ArmorStats>)).catch(() => {});
        fetch("/armor_sockets.json").then((r) => r.json()).then(setArmorSockets).catch(() => {});
        fetch("/armor_sets.json").then((r) => r.json()).then(setSetsCatalog).catch(() => {});
        fetch("/encounters.json").then((r) => r.json())
          .then((d) => setEncData(d.activities ?? [])).catch(() => {});
        loadManifest().then(setManifest).catch(() => {});
        loadBuilds().then((m) => setBuilds(m.builds)).catch(() => {});
        const pc = profile.primary_class;
        if (pc) setCls(pc.charAt(0).toUpperCase() + pc.slice(1) as any);
        // Default active character = top-of-the-list (highest equipped power)
        if (profile.characters?.length) {
          const cached = localStorage.getItem("dv_active_char");
          const found = profile.characters.find((c) => c.id === cached);
          setActiveCharId(found ? found.id : profile.characters[0].id);
        }
      } catch (e: any) {
        setErr(`Sign in required: ${e?.message ?? e}`);
      }
    })();
  }, []);

  // Build-around-an-exotic (Phase 5): lock the exotic, set the subclass element
  // + target stats from a curated build. Applied from the dropdown or ?build=.
  function applyBuild(b: BuildTemplate) {
    setSelectedBuildId(b.id);
    if (b.class !== "Any") setCls(b.class as any);
    if (b.subclass && SUBCLASS_TO_ELEMENT[b.subclass]) setSubclassEl(SUBCLASS_TO_ELEMENT[b.subclass]);
    if (b.target_stats) {
      const t: StatTargets = {};
      for (const k of Object.keys(b.target_stats) as StatKey[]) {
        const v = b.target_stats?.[k] ?? 0;
        if (v > 0) t[k] = Math.min(200, v);
      }
      if (Object.keys(t).length) setTargets(t);
    }
    // Lock whichever of the build's exotic options the user actually owns.
    const owned = items.find(
      (i) => i.tier === "Exotic" && i.slot === b.exotic_armor.slot &&
        b.exotic_armor.options.some((o) => o.toLowerCase() === i.name.toLowerCase()),
    );
    setLockedExoticId(owned ? owned.instance_id : null);
  }

  // Apply ?build=<id> once builds + inventory have loaded (once only).
  useEffect(() => {
    if (!buildId || !builds.length || !items.length || selectedBuildId === buildId) return;
    const b = builds.find((x) => x.id === buildId);
    if (b) applyBuild(b);
  }, [buildId, builds, items, selectedBuildId]);

  // Inventory with TRUE base stats (equipped stat mods stripped) — everything the
  // optimizer reasons about uses this so pre-equipped mods aren't double-counted.
  const baseItems = useMemo(
    () => items.map((it) => (isArmor(it) ? { ...it, stats: baseStats(it, modCatalog) } : it)),
    [items, modCatalog],
  );

  // Available exotics for the class
  const exoticOptions = useMemo(() => {
    if (!cls) return [];
    return baseItems
      .filter((i) => isArmor(i) && i.tier === "Exotic" && (i.class === cls || i.class === "Any"))
      .sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
  }, [baseItems, cls]);

  // EVERY named set (complete catalog), each annotated with how many pieces the
  // user owns (0 = not owned yet). Owned sets float to the top; the rest stay
  // selectable so you can plan a build around a set you don't own all of yet.
  const allSets = useMemo(() => {
    const ownedBy: Record<string, number> = {};
    for (const it of items) {
      if (!isArmor(it) || (it.class !== cls && it.class !== "Any") || !it.set) continue;
      ownedBy[it.set] = (ownedBy[it.set] ?? 0) + 1;
    }
    const names = new Set<string>(setsCatalog.map((s) => s.n));
    for (const n of Object.keys(ownedBy)) names.add(n);
    return [...names]
      .map((setName) => ({ setName, ownedCount: ownedBy[setName] ?? 0 }))
      .sort((a, b) => b.ownedCount - a.ownedCount || a.setName.localeCompare(b.setName));
  }, [setsCatalog, items, cls]);

  const themeTotal = themeLocks.reduce((s, t) => s + (t.count || 0), 0);

  function addTheme() {
    if (themeTotal >= 5) return;
    setThemeLocks((cur) => [...cur, { setName: "", count: 2 }]);
  }
  function updateTheme(i: number, patch: Partial<ThemeLock>) {
    setThemeLocks((cur) => cur.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function removeTheme(i: number) {
    setThemeLocks((cur) => cur.filter((_, idx) => idx !== i));
  }

  function pickCharacter(id: string) {
    setActiveCharId(id);
    localStorage.setItem("dv_active_char", id);
    // Snap class to the picked character's class (drives the armor pool).
    const ch = me?.characters?.find((c) => c.id === id);
    if (ch) setCls(ch.class.charAt(0).toUpperCase() + ch.class.slice(1) as any);
  }

  // Tap a chip to set one stat's target; pass null (the "—" chip) to ignore it.
  function setStatTarget(s: StatKey, val: number | null) {
    setTargets((cur) => {
      const next = { ...cur };
      if (val == null || val <= 0) delete next[s];
      else next[s] = Math.min(200, val);   // clamp to the 200 cap
      return next;
    });
  }
  // Goal preset = fill the whole target profile in one tap (replace, don't merge).
  const applyGoalPreset = (t: StatTargets) => setTargets({ ...t });
  const clearTargets = () => setTargets({});

  const activity = encData.find((a) => a.slug === activitySlug) ?? null;
  const encounter = activity?.encounters.find((e) => e.slug === encounterSlug) ?? null;

  // Selecting an encounter pre-sets the chest resist context from the raid KB.
  // Prefer a specific incoming element; fall back to Concussive. The user can
  // still override any of it below. Legs surge stays weapon-driven.
  function pickEncounter(slug: string) {
    setEncounterSlug(slug);
    const enc = activity?.encounters.find((e) => e.slug === slug);
    if (!enc) return;
    if (enc.incoming_elements.length) { setIncomingEls(enc.incoming_elements); setConcussive(false); }
    else if (enc.concussive) { setConcussive(true); setIncomingEls([]); }
    if (enc.surges.length) setDpsEls(enc.surges);
  }

  function runOptimize() {
    if (!cls || selected.length === 0) return;
    setOptimizing(true);
    // Defer to next tick so the spinner can paint before the synchronous search
    setTimeout(() => {
      try {
        const activeLocks = themeLocks.filter((t) => t.setName && t.count > 0);
        const delta = (activeCharId && fragmentDeltas[activeCharId]) || ZERO_STATS;
        const { combos } = optimize(
          baseItems, cls, targets, lockedExoticId, activeLocks, archetypeFilter, delta,
        );
        setResults(combos);
      } finally {
        setOptimizing(false);
      }
    }, 30);
  }

  // ============================================================
  // Render
  // ============================================================
  if (err) {
    return (
      <section className="container py-20 max-w-2xl">
        <h1 className="font-display text-3xl text-saber mb-3">Access required.</h1>
        <p className="text-muted font-ui mb-6">{err}</p>
        <Button onClick={() => (location.href = "/")}>Sign in with Bungie</Button>
      </section>
    );
  }

  return (
    <section className="container py-10 flex flex-col gap-6 max-w-6xl">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
          ▲ Armor Combination Search
        </span>
        <h1 className="font-display text-3xl tracking-[0.18em] font-black text-signature">
          OPTIMIZER
        </h1>
        <p className="font-ui text-sm text-muted-foreground max-w-2xl">
          Type a <strong className="text-saber">target</strong> for each stat you care about; leave the rest blank.
          The optimizer finds the 5-piece set + plans the +5/+10 stat mods to hit your targets — favoring the most
          important stats when the 5 mod slots can't cover everything. Higher armor power breaks ties.
        </p>
      </header>

      {/* Controls */}
      <Card className="p-5 space-y-5">
        {/* Active character — drives both class pool AND equip target */}
        {me?.characters && me.characters.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Guardian:</span>
            {me.characters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => pickCharacter(ch.id)}
                className={`px-3 py-1 rounded border transition-colors ${
                  activeCharId === ch.id ? `${CLASS_COLOR[ch.class]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {ch.class} · pw {ch.equipped_power}
              </button>
            ))}
          </div>
        )}

        {/* Class */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20">Class:</span>
          {(["Hunter", "Titan", "Warlock"] as const).map((c) => (
            <button
              key={c}
              onClick={() => { setCls(c); setLockedExoticId(null); }}
              className={`px-3 py-1 rounded border transition-colors ${
                cls === c ? `${CLASS_COLOR[c.toLowerCase()]} border-current` : "border-border text-muted hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Build — center the optimizer on a curated exotic build (Phase 5).
            Sets the locked exotic, subclass element, and target stats in one pick. */}
        {builds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Build:</span>
            <select
              value={selectedBuildId}
              onChange={(e) => {
                const b = builds.find((x) => x.id === e.target.value);
                if (b) applyBuild(b);
                else { setSelectedBuildId(""); setLockedExoticId(null); }
              }}
              className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs normal-case tracking-normal min-w-[320px]"
            >
              <option value="">— none (manual) —</option>
              {buildsForClass(builds, cls).map((b) => (
                <option key={b.id} value={b.id}>{b.name} · {b.subclass}</option>
              ))}
            </select>
            {selectedBuildId && (() => {
              const b = builds.find((x) => x.id === selectedBuildId);
              if (!b) return null;
              return (
                <span className="text-muted normal-case tracking-normal text-[11px]">
                  {b.exotic_armor.options[0]} ({b.exotic_armor.slot})
                  {lockedExoticId ? <span className="text-saber"> · locked ✓</span> : <span className="text-amber-400"> · not owned</span>}
                </span>
              );
            })()}
          </div>
        )}

        {/* Goal presets — one tap fills the entire target profile so you don't
            input six numbers. Tweak any individual stat with the chips below. */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20">Goal:</span>
          {GOAL_PRESETS.map((p) => {
            const active = STAT_KEYS.every((k) => (targets[k] ?? 0) === (p.targets[k] ?? 0));
            return (
              <button
                key={p.label}
                onClick={() => applyGoalPreset(p.targets)}
                title={p.hint}
                className={`px-3 py-1 rounded border transition-colors normal-case tracking-normal ${
                  active ? "border-saber text-saber bg-saber/10" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            onClick={clearTargets}
            className="px-3 py-1 rounded border border-border text-muted hover:text-saber transition-colors normal-case tracking-normal"
          >
            Clear
          </button>
          <span className="text-muted ml-1 normal-case tracking-normal text-[11px]">
            Pick a goal, then fine-tune below. Mods are auto-planned to hit your targets.
          </span>
        </div>

        {/* Per-stat target chips — tap a number instead of typing. "—" ignores the
            stat. EoF model: 100 / 200 are the breakpoints (Health also 125). */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20 pt-1">Target:</span>
          {STAT_KEYS.map((s) => {
            const cur = targets[s] ?? 0;
            return (
              <div key={s} className="flex flex-col items-center gap-1">
                <span className={cur > 0 ? "text-saber" : "text-muted"}>{STAT_LABEL[s]}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setStatTarget(s, null)}
                    className={`w-6 py-1 rounded border text-center transition-colors ${
                      cur === 0 ? "border-saber/60 text-saber" : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    —
                  </button>
                  {STAT_CHIPS[s].map((v) => (
                    <button
                      key={v}
                      onClick={() => setStatTarget(s, cur === v ? null : v)}
                      className={`w-8 py-1 rounded border text-center transition-colors ${
                        cur === v ? "border-saber text-saber bg-saber/10" : "border-border text-muted hover:text-foreground"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="ml-[5rem] -mt-2 font-mono text-[11px] normal-case tracking-normal text-muted">
          {selected.length
            ? `Optimizing ${selected.length} stat${selected.length === 1 ? "" : "s"} to your targets — mods auto-planned last to hit them.`
            : "Pick a goal preset or tap a target per stat to begin."}
        </div>

        {/* Encounter — pre-sets the chest resist context from the raid KB
            (Phase 3). Optional; pick an activity + encounter and the defensive
            mods snap to that fight, then tweak below. */}
        {encData.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase border-t border-border/60 pt-4">
            <span className="text-muted w-20">Encounter:</span>
            <select
              value={activitySlug}
              onChange={(e) => { setActivitySlug(e.target.value); setEncounterSlug(""); }}
              className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs normal-case tracking-normal min-w-[200px]"
            >
              <option value="">— any activity —</option>
              {["raid", "dungeon"].map((t) => (
                <optgroup key={t} label={t === "raid" ? "Raids" : "Dungeons"}>
                  {encData.filter((a) => a.type === t).map((a) => (
                    <option key={a.slug} value={a.slug}>{a.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={encounterSlug}
              onChange={(e) => pickEncounter(e.target.value)}
              disabled={!activity}
              className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs normal-case tracking-normal min-w-[220px] disabled:opacity-40"
            >
              <option value="">— pick encounter —</option>
              {activity?.encounters.map((enc) => (
                <option key={enc.slug} value={enc.slug}>{enc.order}. {enc.name}</option>
              ))}
            </select>
            {encounter && (
              <span className="text-muted normal-case tracking-normal text-[11px]">
                {encounter.incoming_elements.length ? `incoming ${encounter.incoming_elements.join("/")}` : "no incoming data"}
                {encounter.concussive ? " · explosive" : ""}
                {encounter.champions.length ? ` · ${encounter.champions.map((c) => `anti-${c}`).join("/")}` : ""}
              </span>
            )}
          </div>
        )}

        {/* Mods — element context for the mod-loadout preview. Subclass
            element drives Loader/Siphon (build-matched, or Harmonic when
            unset); the DPS-weapon element drives the offensive Surge; the
            incoming-damage element (+ Concussive) drives the chest resist.
            Anti-cross-pollination is enforced by the selectMods() engine. */}
        <div className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Subclass:</span>
            {SUBCLASS_ELEMENTS.map((e) => (
              <button
                key={e}
                onClick={() => setSubclassEl((cur) => (cur === e ? "" : e))}
                className={`px-3 py-1 rounded border transition-colors ${
                  subclassEl === e ? `${EL_COLOR[e]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
            <span className="text-muted normal-case tracking-normal text-[11px] ml-1">
              {subclassEl ? `${subclassEl} Loader · ${subclassEl} Siphon` : "Harmonic (auto-matches subclass)"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">DPS weapon:</span>
            {WEAPON_ELEMENTS.map((e) => (
              <button
                key={e}
                onClick={() => setDpsEls((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))}
                className={`px-3 py-1 rounded border transition-colors ${
                  dpsEls.includes(e) ? `${EL_COLOR[e]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
            <span className="text-muted normal-case tracking-normal text-[11px] ml-1">
              {dpsEls.length ? `${dpsEls.join(" + ")} Weapon Surge (legs)`
                : subclassEl ? `${subclassEl} Weapon Surge (legs)` : "Surge follows subclass — pick 1+ for split surges"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Incoming:</span>
            {SUBCLASS_ELEMENTS.map((e) => (
              <button
                key={e}
                onClick={() => setIncomingEls((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))}
                className={`px-3 py-1 rounded border transition-colors ${
                  incomingEls.includes(e) ? `${EL_COLOR[e]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
            <button
              onClick={() => setMeleeResist((m) => !m)}
              className={`px-3 py-1 rounded border transition-colors ${
                meleeResist ? "text-rose-300 border-rose-300" : "border-border text-muted hover:text-foreground"
              }`}
            >
              Melee
            </button>
            <button
              onClick={() => setConcussive((c) => !c)}
              className={`px-3 py-1 rounded border transition-colors ${
                concussive ? "text-amber-300 border-amber-300" : "border-border text-muted hover:text-foreground"
              }`}
            >
              Concussive
            </button>
            <span className="text-muted normal-case tracking-normal text-[11px] ml-1">
              {[concussive && "Concussive Dampener", ...incomingEls.map((e) => `${e} Resist`), meleeResist && "Melee Resist"]
                .filter(Boolean).join(" · ") || "chest = subclass-matched resist"}
            </span>
          </div>
        </div>

        {/* Archetype filter — restrict non-exotic pieces to one or more
            archetypes. Exotics ignore this filter (they're locked by the
            row below). When the user owns mostly pre-EoF gear with no
            archetype label, picking a filter will starve the pool. */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20">Archetype:</span>
          {ARMOR_ARCHETYPES.map((a) => {
            const on = archetypeFilter.includes(a);
            return (
              <button
                key={a}
                onClick={() => setArchetypeFilter((cur) =>
                  cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
                )}
                className={`px-3 py-1 rounded border transition-colors ${
                  on
                    ? "text-saber border-saber"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {a}
              </button>
            );
          })}
          {archetypeFilter.length > 0 && (
            <button
              onClick={() => setArchetypeFilter([])}
              className="ml-2 normal-case tracking-normal text-[11px] text-muted hover:text-saber"
            >
              clear
            </button>
          )}
        </div>

        {/* Locked exotic */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20">Exotic:</span>
          <select
            value={lockedExoticId ?? ""}
            onChange={(e) => setLockedExoticId(e.target.value || null)}
            className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs normal-case tracking-normal min-w-[280px]"
          >
            <option value="">— none locked —</option>
            {exoticOptions.map((it) => (
              <option key={it.instance_id} value={it.instance_id}>
                {it.slot}: {it.name} (pw {it.power})
              </option>
            ))}
          </select>
        </div>

        {/* Duplicate-exotic roll comparison — when you own the locked exotic in
            multiple copies, compare each instance's stat spread + archetype +
            mods side-by-side and lock the best roll (not just the first owned). */}
        {(() => {
          const sel = lockedExoticId ? baseItems.find((i) => i.instance_id === lockedExoticId) : null;
          if (!sel) return null;
          const copies = exoticOptions.filter((i) => i.name === sel.name && i.slot === sel.slot);
          if (copies.length < 2) return null;
          const modsOf = (it: Item) =>
            (it.plug_hashes ?? [])
              .map((h) => modCatalog?.[String(h)]?.n || manifest?.[String(h)]?.n || "")
              .filter((n) => n && !/^empty|^default|shader|ornament|^tier \d|upgrade armor|kill tracker/i.test(n));
          return (
            <div className="flex flex-wrap items-start gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
              <span className="text-muted w-20 pt-1">Compare:</span>
              <div className="flex-1 normal-case tracking-normal">
                <div className="text-muted text-[11px] mb-1.5">You own {copies.length} × {sel.name} — pick the best roll:</div>
                <div className="flex flex-wrap gap-2">
                  {copies.map((it) => {
                    const total = it.stats ? Object.values(it.stats).reduce((a, b) => a + b, 0) : 0;
                    const locked = it.instance_id === lockedExoticId;
                    const mods = modsOf(it);
                    return (
                      <button key={it.instance_id} onClick={() => setLockedExoticId(it.instance_id)}
                        className={`px-2.5 py-2 rounded border text-left transition-colors ${locked ? "border-saber bg-saber/10" : "border-border hover:border-saber/50"}`}>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs text-saber">{total}</span>
                          <span className="font-ui text-[11px] text-foreground">{it.archetype || "—"}</span>
                          <span className="font-mono text-[9px] text-muted">pw {it.power}</span>
                          {locked && <span className="text-[9px] text-saber">✓ locked</span>}
                        </div>
                        {it.stats && (
                          <div className="grid grid-cols-6 gap-x-2 mt-1 font-mono text-[10px] text-center">
                            {STAT_KEYS.map((k) => (
                              <div key={k} title={STAT_LABEL[k]}>
                                <div className="text-muted/60 text-[8px] uppercase">{STAT_LABEL[k].slice(0, 3)}</div>
                                <div className="text-foreground">{it.stats![k]}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {mods.length > 0 && (
                          <div className="font-ui text-[9px] text-muted mt-1 max-w-[200px] truncate" title={mods.join(" · ")}>
                            {mods.join(" · ")}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Theme / set lock — lock N pieces of one or more armor sets.
            Total count across rows is capped at 5; remaining slots are
            unconstrained. The dropdown lists the COMPLETE set catalog (owned
            sets first, with piece counts); unowned sets stay selectable so you
            can plan a build toward a set you don't own all of yet. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Themes:</span>
            <span className="text-muted normal-case tracking-normal text-[11px]">
              Lock N pieces of an armor set. Total ≤ 5 (any extra slots are free).
            </span>
            <span className="ml-auto text-saber">
              {themeTotal}/5 locked
            </span>
          </div>
          {themeLocks.map((t, i) => {
            const picked = allSets.find((s) => s.setName === t.setName);
            // Cap the count by owned pieces when the set is owned; leave the full
            // 1–5 range available for sets you don't own yet (plan-ahead).
            const maxForThis = Math.min(5, picked && picked.ownedCount > 0 ? picked.ownedCount : 5);
            const otherTotal = themeLocks
              .filter((_, idx) => idx !== i)
              .reduce((s, x) => s + (x.count || 0), 0);
            const maxAllowedByBudget = 5 - otherTotal;
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 ml-[5rem]">
                <select
                  value={t.setName}
                  onChange={(e) => updateTheme(i, { setName: e.target.value })}
                  className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs min-w-[200px]"
                >
                  <option value="">— pick a set —</option>
                  {allSets.map((s) => (
                    <option key={s.setName} value={s.setName}>
                      {s.setName}{s.ownedCount ? ` (${s.ownedCount} owned)` : " (not owned)"}
                    </option>
                  ))}
                </select>
                <select
                  value={t.count}
                  onChange={(e) => updateTheme(i, { count: parseInt(e.target.value, 10) })}
                  disabled={!t.setName}
                  className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option
                      key={n}
                      value={n}
                      disabled={n > Math.min(maxForThis, maxAllowedByBudget)}
                    >
                      {n} {n === 1 ? "piece" : "pieces"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeTheme(i)}
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted hover:text-saber px-2"
                >
                  ✕ remove
                </button>
              </div>
            );
          })}
          {themeTotal < 5 && allSets.length > 0 && (
            <button
              onClick={addTheme}
              className="ml-[5rem] font-mono text-[10px] uppercase tracking-[0.2em] text-saber hover:underline"
            >
              + add theme
            </button>
          )}
          {allSets.length === 0 && cls && (
            <div className="ml-[5rem] font-mono text-[10px] tracking-[0.2em] uppercase text-muted/60">
              (set catalog still loading…)
            </div>
          )}
        </div>

        {/* Default mods — the fixed Mods 3/4/5 per slot (your standard utility
            loadout). Mod 1 (+10 stat) is planned by the optimizer; Mod 2 (tuning)
            is shown per result and slotted in-game. Defaults to your screenshot;
            edits persist on this device and auto-apply on Optimize & Equip. */}
        <div className="border-t border-border/60 pt-4">
          <button
            onClick={() => setShowDefaults((v) => !v)}
            className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] uppercase text-saber hover:underline"
          >
            <span className="w-3">{showDefaults ? "▾" : "▸"}</span> Default mods · Mods 3–5
            <span className="text-muted normal-case tracking-normal text-[11px]">— set once, auto-applied on equip</span>
          </button>
          {showDefaults && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-ui text-[11px] text-muted">
                  Mod 1 = +10 stat (optimizer) · Mod 2 = tuning (slot in-game) · Mods 3–5 below auto-equip.
                </span>
                <button
                  onClick={resetTemplate}
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted hover:text-saber"
                >
                  reset to screenshot defaults
                </button>
              </div>
              {!modCatalog && <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted/60">mod catalog loading…</div>}
              {modCatalog && TEMPLATE_SLOTS.map((slot) => {
                const energy = (modTemplate[slot] ?? []).reduce((a, h) => a + (modCatalog[String(h)]?.cost ?? 0), 0);
                return (
                  <div key={slot} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted w-20">{slot}</span>
                    {[0, 1, 2].map((idx) => (
                      <select
                        key={idx}
                        value={modTemplate[slot]?.[idx] ?? 0}
                        onChange={(e) => setTemplateMod(slot, idx, Number(e.target.value))}
                        className="bg-void/40 border border-border rounded px-2 py-1 font-ui text-xs min-w-[180px]"
                      >
                        {modsBySlot[slot].map((m) => (
                          <option key={m.hash} value={m.hash}>{m.n} ({m.cost}e)</option>
                        ))}
                      </select>
                    ))}
                    <span className="font-mono text-[10px] text-muted">+ Mod 1 stat · {energy}e utility</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-2 flex items-center gap-3">
          <Button
            onClick={runOptimize}
            disabled={!cls || selected.length === 0 || optimizing}
          >
            {optimizing ? "Searching…" : "Optimize"}
          </Button>
          {results.length > 0 && (
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
              Top {results.length} of {results.length === 5 ? "many" : "all"} combos
            </span>
          )}
        </div>
      </Card>

      {/* Results */}
      {results.length === 0 && !optimizing && (
        <div className="text-muted text-sm font-ui text-center py-8">
          {selected.length === 0 ? "Set a stat target to begin." : "Hit Optimize."}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {results.map((combo, i) => (
          <ComboCard
            key={i}
            combo={combo}
            rank={i + 1}
            selected={selected}
            targets={targets}
            activeCharId={activeCharId}
            characters={me?.characters ?? []}
            modCatalog={modCatalog}
            manifest={manifest}
            allItems={items}
            cls={cls}
            modTemplate={modTemplate}
            armorSockets={armorSockets}
          />
        ))}
      </div>

      {results.length > 0 && (
        <Link
          to="/builds"
          className="text-xs font-mono uppercase tracking-[0.25em] text-saber hover:underline mt-2"
        >
          ← back to builds
        </Link>
      )}
    </section>
  );
}

// ============================================================
// Result card
// ============================================================

function ComboCard({
  combo, rank, selected, targets, activeCharId, characters,
  modCatalog, manifest, allItems, cls, modTemplate, armorSockets,
}: {
  combo: Combo; rank: number; selected: StatKey[]; targets: StatTargets;
  activeCharId: string | null; characters: CharacterSummary[];
  modCatalog: ModCatalog | null; manifest: SlimManifest | null;
  allItems: Item[]; cls: "Hunter" | "Titan" | "Warlock" | null;
  modTemplate: ModTemplate; armorSockets: ArmorSockets;
}) {
  // The mod loadout = the optimizer's planned +10/+5 stat mods (Mod 1, General
  // socket) + the user's fixed utility template (Mods 3/4/5, slot sockets). This
  // is both the preview and what gets equipped — edit defaults in the panel above.
  const loadout = useMemo<ModLoadout | null>(() => {
    if (!modCatalog) return null;
    return buildTemplateLoadout(combo.modPlan, modTemplate, modCatalog);
  }, [modCatalog, modTemplate, combo]);
  const [equipState, setEquipState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; msg: string; skipped: Array<{ instance_id: string; reason: string }> }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  async function equipNow() {
    if (!activeCharId) {
      setEquipState({ kind: "error", msg: "no active guardian selected" });
      return;
    }
    setEquipState({ kind: "working" });
    try {
      const ids = combo.pieces.map((p) => p.instance_id).filter(Boolean);
      const res = await api.equip(activeCharId, ids);
      const msg = `equipped ${res.equipped_count}/${ids.length}`;
      setEquipState({ kind: "done", msg, skipped: res.skipped });
    } catch (e: any) {
      setEquipState({ kind: "error", msg: e?.message ?? "equip failed" });
    }
  }

  // One-click Optimize & Equip (Phase 4) — equips the set AND inserts the
  // element-matched mods. Two-step: build a plan, confirm, then apply. Every
  // operation is a reversible Destiny inventory action; per-socket failures
  // are reported, never fatal.
  const [armState, setArmState] = useState<
    | { kind: "idle" }
    | { kind: "confirm"; plan: EquipPlan; eviction: EvictionItem[] }
    | { kind: "working" }
    | { kind: "done"; msg: string; inserted: number; skipped: number; failed: number; detail?: string }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  function prepareEquipMods() {
    if (!loadout || !modCatalog || !manifest) {
      setArmState({ kind: "error", msg: "mod data still loading — try again in a moment" });
      return;
    }
    const plan = buildEquipPlan(combo.pieces, loadout, SLOT_TO_MOD, armorSockets);
    const eviction = cls ? buildEvictionPlan(combo.pieces, allItems, cls) : [];
    setArmState({ kind: "confirm", plan, eviction });
  }

  async function confirmEquipMods(plan: EquipPlan, eviction: EvictionItem[]) {
    if (!activeCharId) { setArmState({ kind: "error", msg: "no active guardian selected" }); return; }
    setArmState({ kind: "working" });
    try {
      // Zero-downtime: evict the weakest-stat pieces to the vault first so the
      // incoming set has room, then equip + insert mods.
      if (eviction.length) {
        await api.transferToVault(activeCharId, eviction.map((e) => e.instance_id), eviction.map((e) => e.hash));
      }
      const ids = combo.pieces.map((p) => p.instance_id).filter(Boolean);
      const res = await api.equipWithMods(activeCharId, ids, plan.modPlan);
      setArmState({
        kind: "done",
        msg: `equipped ${res.equipped_count}/${ids.length}` + (eviction.length ? ` · vaulted ${eviction.length}` : ""),
        inserted: res.mods_inserted,
        skipped: res.mods_skipped,
        failed: res.mods_failed,
        detail: res.mod_results.find((m) => !m.ok)?.error,
      });
    } catch (e: any) {
      setArmState({ kind: "error", msg: e?.message ?? "equip failed" });
    }
  }

  return (
    <Card className="p-4 border-saber/30">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">#{rank}</span>
          <span className="font-display text-lg tracking-wide">
            {combo.activations}/{selected.length} targets hit
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
            power {combo.totalPower}
          </span>
          {activeCharId && loadout && (
            <Button
              onClick={prepareEquipMods}
              disabled={armState.kind === "working"}
              variant="primary"
            >
              {armState.kind === "working" ? "Equipping…" : "Optimize & Equip"}
            </Button>
          )}
          {activeCharId && (
            <Button
              onClick={equipNow}
              disabled={equipState.kind === "working"}
              variant={loadout ? "outline" : "primary"}
            >
              {equipState.kind === "working" ? "Equipping…" : "Pieces only"}
            </Button>
          )}
        </div>
      </div>

      {/* One-click Optimize & Equip — confirm + result (Phase 4) */}
      {armState.kind === "confirm" && (
        <div className="mb-3 px-3 py-2 rounded border border-saber/40 bg-saber/5 font-ui text-xs">
          <div className="text-saber mb-1">
            Equip these 5 pieces and insert {armState.plan.placed.length} mod
            {armState.plan.placed.length === 1 ? "" : "s"}?
          </div>
          {armState.plan.unplaceable.length > 0 && (
            <div className="text-amber-300 mb-1">
              {armState.plan.unplaceable.length} mod(s) had no detectable socket — set by hand:{" "}
              {armState.plan.unplaceable.map((u) => `${u.mod} (${u.slot})`).join(", ")}
            </div>
          )}
          {armState.eviction.length > 0 && (
            <div className="text-muted mb-1">
              Will vault {armState.eviction.length} weak piece(s) to make room:{" "}
              {armState.eviction.map((e) => `${e.name} (${e.slot}, ${e.total})`).join(", ")}
            </div>
          )}
          <div className="text-muted mb-2">
            Changes your equipped loadout. Reversible, but it touches your account.
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => confirmEquipMods(armState.plan, armState.eviction)} variant="primary">Confirm</Button>
            <button
              onClick={() => setArmState({ kind: "idle" })}
              className="text-muted hover:text-saber text-[10px] uppercase tracking-[0.25em]"
            >
              cancel
            </button>
          </div>
        </div>
      )}
      {armState.kind === "done" && (
        <div className="mb-3 px-3 py-2 rounded border border-emerald-400/40 bg-emerald-400/5 font-ui text-xs text-emerald-300">
          ✓ {armState.msg}
          <div className="mt-1 text-muted">
            Mods: {armState.inserted} inserted
            {armState.skipped > 0 ? `, ${armState.skipped} already set` : ""}
            {armState.failed > 0 ? `, ${armState.failed} failed` : ""}.
          </div>
          {armState.failed > 0 && (
            <div className="mt-1 text-amber-300">
              {armState.failed} mod(s) couldn't be inserted — usually means you don't own/haven't unlocked that mod, or the piece lacks the armor energy.
            </div>
          )}
          {armState.detail && (
            <div className="mt-1 font-mono text-[10px] text-red-300/90 break-all">Bungie says: {armState.detail}</div>
          )}
        </div>
      )}
      {armState.kind === "error" && (
        <div className="mb-3 px-3 py-2 rounded border border-red-400/40 bg-red-400/5 font-ui text-xs text-red-300">
          ⚠ {armState.msg}
        </div>
      )}
      {equipState.kind === "done" && (
        <div className="mb-3 px-3 py-2 rounded border border-emerald-400/40 bg-emerald-400/5 font-ui text-xs text-emerald-300">
          ✓ {equipState.msg}
          {equipState.skipped.length > 0 && (
            <div className="mt-1 text-amber-300">
              skipped: {equipState.skipped.map((s) => s.reason).join(" · ")}
            </div>
          )}
        </div>
      )}
      {equipState.kind === "error" && (
        <div className="mb-3 px-3 py-2 rounded border border-red-400/40 bg-red-400/5 font-ui text-xs text-red-300">
          ⚠ {equipState.msg}
        </div>
      )}

      {/* Stat totals — highlight selected. Shows POST-MOD totals as the
          big number, with a small subscript showing the pre-mod base
          (so you see how much the mod plan added). */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
        {STAT_KEYS.map((s) => {
          const v = combo.withMods[s];            // post-mod
          const base = combo.totals[s];           // pre-mod (incl. fragment delta)
          const delta = v - base;
          const target = targets[s] ?? 0;
          const sel = target > 0;
          const hit = sel && v >= target;
          return (
            <div
              key={s}
              className={`rounded border p-2 ${
                hit ? "border-saber text-saber"
                : sel ? "border-amber-400/60 text-amber-400"
                : "border-border text-muted"
              }`}
            >
              <div className="font-mono text-[9px] tracking-[0.2em] uppercase">
                {STAT_LABEL[s]}
              </div>
              <div className="font-display text-lg leading-none mt-0.5">
                {v}
                {delta > 0 && (
                  <span className="font-mono text-[9px] text-emerald-400/80 ml-1 align-top">
                    (+{delta})
                  </span>
                )}
              </div>
              <div className="font-mono text-[9px] text-muted mt-0.5">base {base}{sel ? ` · goal ${target}` : ""}</div>
              {sel && !hit && (
                <div className="font-mono text-[9px] mt-1">+{target - v} to goal</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tuning plan (Mod-2 sockets) — best-of-both result: the optimizer scored
          flexible +5/−5 and balanced +3 tuning and kept the better. Each chip is
          one tuning mod to slot on a piece. The big stat numbers above already
          include these. */}
      {combo.modPlan.tuning.length > 0 && (
        <div className="mb-3 rounded border border-cyan-400/30 bg-cyan-400/5 p-2.5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-cyan-300">
              Tuning · {combo.modPlan.tuningStyle === "flex" ? "flexible +5 / −5" : "balanced +3"}
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">
              {combo.modPlan.tuningUsed} of 5 tuning slots
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {combo.modPlan.tuning.map((t, i) => (
              <span key={i} className="font-mono text-[10px] rounded border border-cyan-400/30 px-1.5 py-0.5 text-cyan-200">
                +{t.minus ? TUNE_FLEX : TUNE_BAL} {STAT_LABEL[t.plus]}
                {t.minus && <span className="text-rose-300"> · −{TUNE_FLEX} {STAT_LABEL[t.minus]}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mod loadout — Mod 1 (+10 stat, from the optimizer) into each General
          socket, + your fixed Mods 3/4/5 utility template into the slot sockets.
          This is exactly what Optimize & Equip applies. Edit the template in the
          Defaults panel above. */}
      {loadout ? (
        <div className="mb-4 rounded border border-saber/30 bg-saber/5 p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-saber">
              Mod loadout
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">
              Mod 1 stat + your default Mods 3–5
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {(["Helmet", "Gauntlets", "Chest", "Legs", "Class"] as const).map((pslot) => {
              const plan = loadout.slots[SLOT_TO_MOD[pslot]];
              if (!plan) return null;
              return (
                <div key={pslot} className="rounded border border-border p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">{pslot}</span>
                    <span className="font-mono text-[9px] text-muted">{plan.energyUsed}/{plan.energyBudget}e</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {plan.mods.length === 0 && <li className="text-[11px] text-muted/50">—</li>}
                    {plan.mods.map((m) => (
                      <li
                        key={m.hash}
                        className={`text-[11px] leading-tight ${
                          m.fam === "stat" ? "text-saber"
                          : m.fam === "concussive" ? "text-amber-300"
                          : EL_COLOR[m.el] ?? "text-foreground"
                        }`}
                      >
                        {m.n} <span className="text-muted">· {m.cost}e</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {loadout.warnings.length > 0 && (
            <div className="mt-2 font-ui text-[10px] text-amber-300/90">
              {loadout.warnings.join(" · ")}
            </div>
          )}
          <div className="mt-2 font-ui text-[10px] text-muted">
            Auto-inserted on Optimize &amp; Equip (Mod 1 + Mods 3–5). Mod 2 tuning is slotted in-game.
          </div>
        </div>
      ) : (combo.modsUsed > 0) && (
        <div className="mb-4 px-3 py-2 rounded border border-saber/30 bg-saber/5 font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
          mod catalog loading… ({combo.modsUsed}/5 stat slots)
        </div>
      )}

      {/* Pieces */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-ui text-sm">
        {combo.pieces.map((p) => (
          <div key={p.instance_id} className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">
              {p.slot}
            </span>
            <span className={p.tier === "Exotic" ? "text-amber-300" : ""}>{p.name}</span>
            {p.archetype && (
              <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded border border-fuchsia-400/40 text-fuchsia-300/90">
                {p.archetype}
              </span>
            )}
            {p.set && (
              <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded border border-saber/40 text-saber/80">
                {p.set}
              </span>
            )}
            <span className="text-muted text-xs ml-auto">pw {p.power}</span>
          </div>
        ))}
      </div>
      {/* Set bonus summary — count pieces per set in this combo */}
      {(() => {
        const setCounts: Record<string, number> = {};
        for (const p of combo.pieces) {
          if (p.set) setCounts[p.set] = (setCounts[p.set] ?? 0) + 1;
        }
        const entries = Object.entries(setCounts).filter(([, n]) => n >= 2);
        if (entries.length === 0) return null;
        return (
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase">
            <span className="text-muted">Set bonus:</span>
            {entries.map(([name, n]) => (
              <span
                key={name}
                className={`px-2 py-1 rounded border ${
                  n >= 4 ? "border-emerald-400 text-emerald-400"
                  : n >= 2 ? "border-saber text-saber"
                  : "border-border text-muted"
                }`}
              >
                {n}× {name}
              </span>
            ))}
          </div>
        );
      })()}
    </Card>
  );
}
