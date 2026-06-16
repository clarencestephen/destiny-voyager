/**
 * web/src/lib/recommend.ts — the build-coherence recommender.
 *
 * Uses the synergy/keyword graph (synergy.json) to assemble a build whose
 * pieces reinforce one theme (e.g. scorch Warlock → Incandescent weapons +
 * Ember fragments + a reload/boss-damage set), at three scopes: weapons-only,
 * armor-only, or the full build. Synergy scoring is data-backed + explainable;
 * the statistical blend (build-CF / usage / wishlists / Clarity quality) layers
 * on top of these base scores.
 *
 * Pure + framework-agnostic — data is passed in so it can be unit-tested.
 */

export interface SynergyData {
  aspects: Array<{ hash: number; n: string; el: string; cls?: string; desc: string; keywords: string[] }>;
  fragments: Array<{ hash: number; n: string; el: string; desc: string; keywords: string[] }>;
  perkKeywords: Record<string, string[]>;
  setKeywords: Record<string, string[]>;
  artifact?: { name: string; perks: Array<{ hash: number; n: string; tier: number; keywords: string[] }> };
}
export interface WeaponLite {
  hash: string; n: string; t: string; el: string; ammo: string; slot: string;
  exotic: boolean; columns: Array<Array<{ h: number; n: string; c: boolean }>>;
}
export interface ArmorData { sets: Record<string, { n: string; perks: Array<{ count: number; n: string; d: string }> }> }

export interface RecContext {
  cls: string;          // "Titan" | "Hunter" | "Warlock"
  element: string;      // "solar" | "void" | "arc" | "stasis" | "strand" | "prismatic"
  theme?: string[];     // explicit keyword theme; otherwise derived from element + goal
  goal?: string;        // free text, e.g. "boss damage", "faster reload", "grenade spam"
  weaponType?: string;  // favor an archetype, e.g. "grenade launcher"
}

export interface Pick<T> { item: T; score: number; why: string }
export interface BuildRec {
  theme: string[];
  goalKeywords: string[];
  aspects: Pick<SynergyData["aspects"][number]>[];
  fragments: Pick<SynergyData["fragments"][number]>[];
  weapons: Pick<WeaponLite>[];   // flat ranked list (kept for compat)
  /** Per-slot weapon picks (ranked), with the ≤1-Exotic rule enforced on the top
   *  pick of each slot — so the leading "loadout" is always legally equippable. */
  weaponLoadout: { kinetic: Pick<WeaponLite>[]; energy: Pick<WeaponLite>[]; heavy: Pick<WeaponLite>[] };
  sets: Pick<{ hash: string; n: string; perks: any[] }>[];
  exotics: Pick<{ n: string }>[];   // exotic armor that co-occurs in real builds
  artifact: { name: string; picks: Pick<{ n: string; tier: number }>[] };  // seasonal artifact mods for the build
}

// ── Build-basket collaborative filtering ──────────────────────────────────
// Mines builds.json: each build is a basket of items run together for a given
// class+subclass. The co-occurrence index lets us boost weapons/exotics that
// actually appear together — item-to-item CF, keyed by class|element.
export interface BuildTemplate {
  class: string; subclass: string;
  exotic_armor?: { options?: string[] };
  weapons?: { kinetic?: string[]; energy?: string[]; heavy?: string[] };
  tags?: string[];
}
export type CFIndex = Record<string, { weapons: Record<string, number>; exotics: Record<string, number> }>;

const SUBCLASS_ELEMENT: Record<string, string> = {
  voidwalker: "void", sentinel: "void", nightstalker: "void",
  dawnblade: "solar", sunbreaker: "solar", gunslinger: "solar",
  stormcaller: "arc", striker: "arc", arcstrider: "arc",
  shadebinder: "stasis", behemoth: "stasis", revenant: "stasis",
  broodweaver: "strand", berserker: "strand", threadrunner: "strand",
  prismatic: "prismatic",
};
const ELEMENTS = ["solar", "void", "arc", "stasis", "strand", "prismatic"];

export function buildCFIndex(builds: BuildTemplate[]): CFIndex {
  const idx: CFIndex = {};
  for (const b of builds) {
    const cls = (b.class || "").toLowerCase();
    let el = SUBCLASS_ELEMENT[(b.subclass || "").toLowerCase()] || "";
    if (!el) el = (b.tags || []).map((t) => t.toLowerCase()).find((t) => ELEMENTS.includes(t)) || "";
    if (!cls || !el) continue;
    const e = (idx[`${cls}|${el}`] ??= { weapons: {}, exotics: {} });
    for (const slot of ["kinetic", "energy", "heavy"] as const)
      for (const w of b.weapons?.[slot] || []) e.weapons[w] = (e.weapons[w] || 0) + 1;
    for (const x of b.exotic_armor?.options || []) e.exotics[x] = (e.exotics[x] || 0) + 1;
  }
  return idx;
}

// Each element's signature keywords — the default theme when none is given.
const ELEMENT_THEME: Record<string, string[]> = {
  solar: ["scorch", "ignition", "radiant", "restoration"],
  void: ["volatile", "weaken", "devour", "invisible", "overshield"],
  arc: ["jolt", "blind", "amplified", "ionic-trace"],
  stasis: ["slow", "freeze", "shatter", "frost-armor"],
  strand: ["sever", "suspend", "unravel", "woven-mail", "threadling"],
  prismatic: ["transcendence", "scorch", "jolt", "volatile", "freeze", "unravel"],
};

// Map free-text goals to keyword tags (reuses the synergy vocabulary).
const GOAL_PATTERNS: Array<[RegExp, string[]]> = [
  [/reload/, ["reload"]],
  [/boss|major|dps|burst|damage to|boss damage|melt/, ["surge"]],
  [/grenade/, ["grenade", "ability-energy"]],
  [/melee/, ["melee"]],
  [/super/, ["super"]],
  [/heal|surviv|tank|resist|sustain/, ["heal", "damage-resist"]],
  [/ability|regen|uptime/, ["ability-energy"]],
  [/orb/, ["orbs"]],
];

export function parseGoal(goal?: string): string[] {
  if (!goal) return [];
  const g = goal.toLowerCase();
  const out = new Set<string>();
  for (const [re, kws] of GOAL_PATTERNS) if (re.test(g)) kws.forEach((k) => out.add(k));
  return [...out];
}

export function deriveTheme(ctx: RecContext): string[] {
  if (ctx.theme?.length) return ctx.theme;
  const base = ELEMENT_THEME[ctx.element.toLowerCase()] || [];
  return [...new Set([...base, ...parseGoal(ctx.goal)])];
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

/** Score how well a weapon's perk pool feeds the theme. */
function weaponSynergy(w: WeaponLite, syn: SynergyData, theme: string[]): { score: number; perks: string[] } {
  let score = 0; const hits: string[] = [];
  for (const col of w.columns || []) {
    for (const perk of col) {
      const kws = syn.perkKeywords[perk.h] || syn.perkKeywords[String(perk.h)] || [];
      const o = overlap(kws, theme);
      if (o) { score += o; if (!hits.includes(perk.n)) hits.push(perk.n); }
    }
  }
  return { score, perks: hits.slice(0, 4) };
}

const fmt = (kws: string[]) => kws.map((k) => k.replace(/-/g, " ")).join(", ");

export function recommendBuild(ctx: RecContext, syn: SynergyData, weapons: WeaponLite[], armor: ArmorData, cf?: CFIndex): BuildRec {
  const theme = deriveTheme(ctx);
  const goalKw = parseGoal(ctx.goal);
  const cls = ctx.cls.toLowerCase();
  const el = ctx.element.toLowerCase();
  const wantType = ctx.weaponType?.toLowerCase();
  const cfBucket = cf?.[`${cls}|${el}`];

  // Fragments (this element) ranked by theme overlap.
  const fragments = syn.fragments
    .filter((f) => f.el === el)
    .map((f) => ({ item: f, score: overlap(f.keywords, theme) * 2 + overlap(f.keywords, goalKw), why: fmt(f.keywords) }))
    .sort((a, b) => b.score - a.score)
    .filter((p) => p.score > 0)
    .slice(0, 4);

  // Aspects (this class + element) ranked the same way.
  const aspects = syn.aspects
    .filter((a) => a.el === el && (!a.cls || a.cls === cls))
    .map((a) => ({ item: a, score: overlap(a.keywords, theme) * 2 + overlap(a.keywords, goalKw), why: fmt(a.keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  // Weapons: element/type fit + perk-pool synergy with the theme.
  const scored = weapons
    .map((w) => {
      const syn2 = weaponSynergy(w, syn, theme);
      // DPS element should align with the subclass — subclass-matched surge/
      // scavenger mods are cheaper than damage-type-specific ones. Strong default:
      // match = big boost, Kinetic = neutral, off-element = penalty (override only
      // for very synergistic specific builds).
      const wEl = w.el.toLowerCase();
      const elMatch = wEl === el ? 6 : wEl === "kinetic" ? 1 : -2;
      const typeMatch = wantType && w.t.toLowerCase().includes(wantType) ? 4 : 0;
      const cfCount = cfBucket?.weapons[w.n] || 0;       // co-occurs in real builds
      const score = elMatch + typeMatch + syn2.score + cfCount * 2;
      const why = [syn2.perks.length ? `rolls ${syn2.perks.join(", ")}` : `${w.el} ${w.t}`]
        .concat(wEl === el ? ["matches subclass — cheaper mods"] : [])
        .concat(cfCount ? [`in ${cfCount} build${cfCount > 1 ? "s" : ""}`] : []).join(" · ");
      return { item: w, score, why };
    })
    .filter((p) => p.score >= 3)
    .sort((a, b) => b.score - a.score);
  // Collapse Adept / Timelost / base variants of the same weapon to the best-scored one.
  const dseen = new Set<string>();
  const dedup = scored.filter((p) => {
    const k = p.item.n.toLowerCase();
    if (dseen.has(k)) return false;
    dseen.add(k); return true;
  });
  const weaponPicks = dedup.slice(0, 5);   // flat top-5 (cap)

  // Per-slot picks (top 3 each), then enforce the ≤1-Exotic rule on the LEAD pick
  // of each slot so the headline loadout is always legally equippable.
  const weaponLoadout = {
    kinetic: dedup.filter((p) => p.item.slot === "Kinetic").slice(0, 3),
    energy:  dedup.filter((p) => p.item.slot === "Energy").slice(0, 3),
    heavy:   dedup.filter((p) => p.item.slot === "Power").slice(0, 3),
  };
  const exoticLed = (["kinetic", "energy", "heavy"] as const).filter((k) => weaponLoadout[k][0]?.item.exotic);
  if (exoticLed.length > 1) {
    // keep the highest-scored Exotic lead; the others lead with their best Legendary.
    const keep = [...exoticLed].sort((a, b) => weaponLoadout[b][0].score - weaponLoadout[a][0].score)[0];
    for (const k of exoticLed) {
      if (k === keep) continue;
      const arr = weaponLoadout[k];
      const li = arr.findIndex((p) => !p.item.exotic);
      if (li > 0) { const [leg] = arr.splice(li, 1); arr.unshift(leg); }
    }
  }

  // Armor sets ranked by how well their bonus matches the goal (then theme).
  const sets = Object.entries(armor.sets)
    .map(([hash, s]) => {
      const kws = syn.setKeywords[hash] || [];
      const score = overlap(kws, goalKw) * 3 + overlap(kws, theme);
      return { item: { hash, n: s.n, perks: s.perks }, score, why: fmt(kws) || s.perks.map((p) => p.n).join(" / ") };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Exotic armor that co-occurs in real builds for this class+subclass.
  const exotics = Object.entries(cfBucket?.exotics || {})
    .map(([n, count]) => ({ item: { n }, score: count, why: `in ${count} build${count > 1 ? "s" : ""}` }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // Seasonal artifact mods matching the build's weapon types + element/goal —
  // e.g. the champion mod for the weapon you're running, or a surge mod.
  const wTypes = new Set(
    [wantType, ...weaponPicks.slice(0, 6).map((p) => p.item.t)]
      .filter(Boolean).map((t) => t!.toLowerCase().replace(/\s+/g, "-")),
  );
  const artifactPicks = (syn.artifact?.perks || [])
    .map((p) => {
      const typeHit = overlap(p.keywords, [...wTypes]) * 3;
      const themeHit = overlap(p.keywords, [...theme, ...goalKw]);
      return { item: p, score: typeHit + themeHit, why: fmt(p.keywords) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    theme, goalKeywords: goalKw, aspects, fragments, weapons: weaponPicks, weaponLoadout, sets, exotics,
    artifact: { name: syn.artifact?.name || "", picks: artifactPicks },
  };
}
