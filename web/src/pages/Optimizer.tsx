import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api, sumStats, loadManifest, STAT_KEYS, STAT_LABEL, ARMOR_SLOTS, ARMOR_ARCHETYPES,
  type ArmorStats, type ArmorSlot, type CharacterSummary, type Item, type UserProfile,
  type SlimManifest,
} from "@/lib/api";
import { loadBuilds, buildsForClass, type BuildTemplate } from "@/lib/builds";
import {
  selectMods, type ModCatalog, type ModLoadout,
  type Element as ModElement, type StatModRequest,
} from "@/lib/mods";
import { buildEquipPlan, buildEvictionPlan, type EquipPlan, type EvictionItem } from "@/lib/equipPlan";

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

// Stretch target by selection count. Hard floor is always 100.
const STRETCH_BY_COUNT: Record<number, number> = { 1: 200, 2: 200, 3: 125, 4: 100 };

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

/** Armor stat mod plan — assignment of stat mods to the 5 piece slots.
 *  Each piece has 1 mod socket; +10 (major) and +5 (minor) both fit. */
type ModPlan = {
  /** Number of +10 mods per stat. */
  plus10: Partial<Record<StatKey, number>>;
  /** Number of +5 mods per stat. */
  plus5:  Partial<Record<StatKey, number>>;
  /** Total mod slots consumed (sum across plus10 + plus5). */
  used: number;
};

const MOD_BUDGET = 5;  // 5 armor pieces, 1 stat mod socket each
const PLUS10 = 10;
const PLUS5  = 5;

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
 * Plan armor stat mods to hit the score targets for selected stats.
 *
 * Strategy (5 slot budget, one stat mod per armor piece):
 *  1. For each selected stat under 100: allocate +10 mods to reach 100,
 *     using +5 only when a single +5 closes the last gap (avoids
 *     "wasting" a slot on +10 when +5 suffices).
 *  2. Remaining slots: if stretch target > 100, push each selected
 *     stat toward stretch — +10 first, fall back to +5 if needed.
 *  3. Hard cap at 5 mod slots; we stop allocating once full.
 *
 * Returns a plan that may be UNDER-satisfying (some stats below 100)
 * if 5 slots can't cover all selected. The scoreCombo then evaluates
 * post-mod totals — combos that get more activations win.
 */
function planMods(totals: ArmorStats, selected: StatKey[], stretch: number): ModPlan {
  const plan: ModPlan = { plus10: {}, plus5: {}, used: 0 };
  const proj: Record<string, number> = { ...totals };

  function addPlus10(s: StatKey): boolean {
    if (plan.used >= MOD_BUDGET) return false;
    plan.plus10[s] = (plan.plus10[s] ?? 0) + 1;
    plan.used += 1;
    proj[s] += PLUS10;
    return true;
  }
  function addPlus5(s: StatKey): boolean {
    if (plan.used >= MOD_BUDGET) return false;
    plan.plus5[s] = (plan.plus5[s] ?? 0) + 1;
    plan.used += 1;
    proj[s] += PLUS5;
    return true;
  }

  // Phase 1: hit floor 100 on each selected stat, cheaper-first.
  for (const s of selected) {
    while (proj[s] < 100 && plan.used < MOD_BUDGET) {
      const gap = 100 - proj[s];
      if (gap <= PLUS5 && gap > 0) {
        addPlus5(s);
      } else {
        addPlus10(s);
      }
    }
  }

  // Phase 2: if stretch target > 100 and slots left, push toward stretch.
  // Prefer +10 first (more efficient), fall back to +5 for tight gaps.
  if (stretch > 100 && plan.used < MOD_BUDGET) {
    for (const s of selected) {
      while (proj[s] < stretch && plan.used < MOD_BUDGET) {
        const gap = stretch - proj[s];
        if (gap <= PLUS5 && gap > 0) {
          addPlus5(s);
        } else {
          addPlus10(s);
        }
      }
    }
  }
  return plan;
}

function applyModPlan(totals: ArmorStats, plan: ModPlan): ArmorStats {
  const out = { ...totals };
  for (const [s, n] of Object.entries(plan.plus10)) {
    out[s as StatKey] += (n ?? 0) * PLUS10;
  }
  for (const [s, n] of Object.entries(plan.plus5)) {
    out[s as StatKey] += (n ?? 0) * PLUS5;
  }
  return out;
}

function scoreCombo(totals: ArmorStats, pieces: Item[], selected: StatKey[], stretch: number) {
  // Plan mods first, then score using POST-MOD totals.
  const modPlan = planMods(totals, selected, stretch);
  const withMods = applyModPlan(totals, modPlan);

  let activations = 0;
  let stretchHits = 0;
  let surplus = 0;
  let rawSum = 0;
  for (const s of selected) {
    const v = withMods[s] ?? 0;
    if (v >= 100) activations++;
    if (v >= stretch) stretchHits++;
    surplus += Math.max(0, v - 100);
    rawSum += v;
  }
  const totalPower = pieces.reduce((p, x) => p + (x.power ?? 0), 0);
  // Score tuple (descending):
  //  1. activations after mods
  //  2. stretch hits after mods
  //  3. NEGATIVE mods-used  (fewer mods = better — more flexibility for utility mods)
  //  4. surplus above 100 across selected stats
  //  5. raw sum of selected stats
  //  6. total armor power
  return {
    score: [activations, stretchHits, -modPlan.used, surplus, rawSum, totalPower],
    activations, stretchHits, surplus, rawSum, totalPower,
    modPlan, withMods, modsUsed: modPlan.used,
  };
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

function optimize(
  items: Item[],
  cls: "Warlock" | "Hunter" | "Titan",
  selected: StatKey[],
  lockedExoticId: string | null,
  themeLocks: ThemeLock[] = [],
  archetypeFilter: string[] = [],
): { combos: Combo[]; stretch: number; pruned: Record<ArmorSlot, number> } {
  const stretch = STRETCH_BY_COUNT[selected.length] ?? 100;
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
      return { combos: [], stretch, pruned };
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
            const totals = sumArmorStats(pieces);
            const s = scoreCombo(totals, pieces, selected, stretch);
            combos.push({ pieces, totals, ...s });
          }

  combos.sort((a, b) => compareScore(a.score, b.score));
  return { combos: combos.slice(0, 5), stretch, pruned };
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
  const [selected, setSelected] = useState<StatKey[]>([]);
  const [lockedExoticId, setLockedExoticId] = useState<string | null>(null);
  const [themeLocks, setThemeLocks] = useState<ThemeLock[]>([]);
  const [archetypeFilter, setArchetypeFilter] = useState<string[]>([]);
  const [results, setResults] = useState<Combo[]>([]);
  const [stretchTarget, setStretchTarget] = useState<number>(100);
  const [optimizing, setOptimizing] = useState(false);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);

  // Mod selection context (Phase 2 — non-destructive preview).
  const [modCatalog, setModCatalog] = useState<ModCatalog | null>(null);
  const [manifest, setManifest] = useState<SlimManifest | null>(null);  // for socket mapping (Phase 4)
  const [subclassEl, setSubclassEl] = useState<ModElement>("");   // "" → Harmonic
  const [dpsEl, setDpsEl] = useState<ModElement>("");             // "" → follow subclass
  const [incomingEl, setIncomingEl] = useState<ModElement>("");   // chest resist target
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
      const picks = (Object.keys(b.target_stats) as StatKey[])
        .filter((k) => (b.target_stats?.[k] ?? 0) > 0)
        .slice(0, 4);
      if (picks.length) setSelected(picks);
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

  // Available exotics for the class
  const exoticOptions = useMemo(() => {
    if (!cls) return [];
    return items
      .filter((i) => isArmor(i) && i.tier === "Exotic" && (i.class === cls || i.class === "Any"))
      .sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
  }, [items, cls]);

  // Sets the user actually owns pieces of, with the piece count.
  // Show only sets where the user has ≥2 pieces (anything less can't
  // hit a meaningful theme-bonus threshold).
  const setsOwned = useMemo(() => {
    if (!cls) return [];
    const counts: Record<string, number> = {};
    for (const it of items) {
      if (!isArmor(it)) continue;
      if (it.class !== cls && it.class !== "Any") continue;
      if (!it.set) continue;
      counts[it.set] = (counts[it.set] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([setName, count]) => ({ setName, ownedCount: count }));
  }, [items, cls]);

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

  function toggleStat(s: StatKey) {
    setSelected((cur) => {
      if (cur.includes(s)) return cur.filter((x) => x !== s);
      if (cur.length >= 4) return cur;  // hard cap
      return [...cur, s];
    });
  }

  const activity = encData.find((a) => a.slug === activitySlug) ?? null;
  const encounter = activity?.encounters.find((e) => e.slug === encounterSlug) ?? null;

  // Selecting an encounter pre-sets the chest resist context from the raid KB.
  // Prefer a specific incoming element; fall back to Concussive. The user can
  // still override any of it below. Legs surge stays weapon-driven.
  function pickEncounter(slug: string) {
    setEncounterSlug(slug);
    const enc = activity?.encounters.find((e) => e.slug === slug);
    if (!enc) return;
    if (enc.incoming_elements[0]) { setIncomingEl(enc.incoming_elements[0]); setConcussive(false); }
    else if (enc.concussive) { setConcussive(true); setIncomingEl(""); }
    if (enc.surges[0]) setDpsEl(enc.surges[0]);
  }

  function runOptimize() {
    if (!cls || selected.length === 0) return;
    setOptimizing(true);
    // Defer to next tick so the spinner can paint before the synchronous search
    setTimeout(() => {
      try {
        const activeLocks = themeLocks.filter((t) => t.setName && t.count > 0);
        const { combos, stretch } = optimize(
          items, cls, selected, lockedExoticId, activeLocks, archetypeFilter,
        );
        setResults(combos);
        setStretchTarget(stretch);
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
          Pick 1-4 stats. The optimizer prioritizes hitting the hard <strong className="text-saber">100 activation floor</strong> on each
          selected stat (99 does not activate), then maximizes the stretch target (200 for 1-2 stats, 125 for 3, 100 for 4).
          Higher armor power level breaks ties.
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

        {/* Stats */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="text-muted w-20">Stats:</span>
          {STAT_KEYS.map((s) => {
            const on = selected.includes(s);
            const disabled = !on && selected.length >= 4;
            return (
              <button
                key={s}
                disabled={disabled}
                onClick={() => toggleStat(s)}
                className={`px-3 py-1 rounded border transition-colors ${
                  on
                    ? "text-saber border-saber"
                    : disabled
                      ? "border-border text-muted/40 cursor-not-allowed"
                      : "border-border text-muted hover:text-foreground"
                }`}
              >
                {STAT_LABEL[s]}
              </button>
            );
          })}
          <span className="text-muted ml-2">{selected.length}/4</span>
          {selected.length > 0 && (
            <span className="text-saber ml-2 normal-case tracking-normal text-[11px]">
              floor 100 · stretch {STRETCH_BY_COUNT[selected.length]}
            </span>
          )}
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
                onClick={() => setDpsEl((cur) => (cur === e ? "" : e))}
                className={`px-3 py-1 rounded border transition-colors ${
                  dpsEl === e ? `${EL_COLOR[e]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
            <span className="text-muted normal-case tracking-normal text-[11px] ml-1">
              {(dpsEl || subclassEl) ? `${dpsEl || subclassEl} Weapon Surge (legs)` : "Surge follows subclass"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Incoming:</span>
            {WEAPON_ELEMENTS.map((e) => (
              <button
                key={e}
                onClick={() => { setIncomingEl((cur) => (cur === e ? "" : e)); if (e) setConcussive(false); }}
                className={`px-3 py-1 rounded border transition-colors ${
                  incomingEl === e && !concussive ? `${EL_COLOR[e]} border-current` : "border-border text-muted hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
            <button
              onClick={() => { setConcussive((c) => !c); if (!concussive) setIncomingEl(""); }}
              className={`px-3 py-1 rounded border transition-colors ${
                concussive ? "text-amber-300 border-amber-300" : "border-border text-muted hover:text-foreground"
              }`}
            >
              Concussive
            </button>
            <span className="text-muted normal-case tracking-normal text-[11px] ml-1">
              {concussive ? "Concussive Dampener (chest)"
                : incomingEl ? `${incomingEl} Resistance (chest)`
                : "chest = subclass-matched resist"}
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
          const sel = lockedExoticId ? items.find((i) => i.instance_id === lockedExoticId) : null;
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
            unconstrained. Each row's "Set" dropdown lists sets where the
            user owns ≥2 pieces (anything less can't reach a theme bonus). */}
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
            const ownedPicked = setsOwned.find((s) => s.setName === t.setName);
            const maxForThis = Math.min(5, (ownedPicked?.ownedCount ?? 5));
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
                  {setsOwned.map((s) => (
                    <option key={s.setName} value={s.setName}>
                      {s.setName} ({s.ownedCount} owned)
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
          {themeTotal < 5 && setsOwned.length > 0 && (
            <button
              onClick={addTheme}
              className="ml-[5rem] font-mono text-[10px] uppercase tracking-[0.2em] text-saber hover:underline"
            >
              + add theme
            </button>
          )}
          {setsOwned.length === 0 && cls && (
            <div className="ml-[5rem] font-mono text-[10px] tracking-[0.2em] uppercase text-muted/60">
              (no owned sets with ≥2 pieces yet)
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
          {selected.length === 0 ? "Pick 1-4 stats to begin." : "Hit Optimize."}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {results.map((combo, i) => (
          <ComboCard
            key={i}
            combo={combo}
            rank={i + 1}
            selected={selected}
            stretch={stretchTarget}
            activeCharId={activeCharId}
            characters={me?.characters ?? []}
            modCatalog={modCatalog}
            manifest={manifest}
            allItems={items}
            cls={cls}
            subclassEl={subclassEl}
            dpsEl={dpsEl}
            incomingEl={incomingEl}
            concussive={concussive}
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
  combo, rank, selected, stretch, activeCharId, characters,
  modCatalog, manifest, allItems, cls, subclassEl, dpsEl, incomingEl, concussive,
}: {
  combo: Combo; rank: number; selected: StatKey[]; stretch: number;
  activeCharId: string | null; characters: CharacterSummary[];
  modCatalog: ModCatalog | null; manifest: SlimManifest | null;
  allItems: Item[]; cls: "Hunter" | "Titan" | "Warlock" | null;
  subclassEl: ModElement; dpsEl: ModElement; incomingEl: ModElement; concussive: boolean;
}) {
  // Resolve the concrete, anti-cross-pollination mod loadout for this combo.
  // Stat mods come from the combo's own stat plan (one per piece, biggest first).
  const loadout = useMemo<ModLoadout | null>(() => {
    if (!modCatalog) return null;
    const statMods: StatModRequest[] = [];
    for (const s of STAT_KEYS) {
      for (let k = 0; k < (combo.modPlan.plus10[s] ?? 0); k++) statMods.push({ stat: s, mag: 10 });
      for (let k = 0; k < (combo.modPlan.plus5[s] ?? 0); k++)  statMods.push({ stat: s, mag: 5 });
    }
    return selectMods({
      subclassElement: subclassEl || "Harmonic",
      dpsWeaponElement: dpsEl || undefined,
      incomingElements: incomingEl ? [incomingEl] : [],
      concussive,
      statMods,
      energyBudget: 10,
    }, modCatalog);
  }, [modCatalog, subclassEl, dpsEl, incomingEl, concussive, combo]);
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
    const plan = buildEquipPlan(combo.pieces, loadout, modCatalog, manifest, SLOT_TO_MOD);
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
            {combo.activations}/{selected.length} activated
          </span>
          {combo.stretchHits > 0 && stretch > 100 && (
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-emerald-400 ml-2">
              +{combo.stretchHits} at {stretch}+
            </span>
          )}
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
          const base = combo.totals[s];           // pre-mod
          const delta = v - base;
          const sel = selected.includes(s);
          const activated = sel && v >= 100;
          const stretchHit = sel && v >= stretch && stretch > 100;
          return (
            <div
              key={s}
              className={`rounded border p-2 ${
                stretchHit ? "border-emerald-400 text-emerald-400"
                : activated ? "border-saber text-saber"
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
              <div className="font-mono text-[9px] text-muted mt-0.5">base {base}</div>
              {sel && !activated && (
                <div className="font-mono text-[9px] mt-1">+{100 - v} to activate</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mod loadout — the actual element-matched mods to socket per piece.
          Legs=Surge (DPS-weapon element) · Chest=Resist/Concussive (encounter)
          · Arms=Loader · Helmet=Siphon (build element) · +stat mod per piece.
          Anti-cross-pollination guaranteed by selectMods(). */}
      {loadout ? (
        <div className="mb-4 rounded border border-saber/30 bg-saber/5 p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-saber">
              Mod loadout
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">
              legs surge · chest resist · arms loader · helmet siphon
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
            Preview — auto-insert on equip ships with the one-click pipeline.
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
