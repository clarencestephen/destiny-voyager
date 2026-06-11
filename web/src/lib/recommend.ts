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
  weapons: Pick<WeaponLite>[];
  sets: Pick<{ hash: string; n: string; perks: any[] }>[];
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

export function recommendBuild(ctx: RecContext, syn: SynergyData, weapons: WeaponLite[], armor: ArmorData): BuildRec {
  const theme = deriveTheme(ctx);
  const goalKw = parseGoal(ctx.goal);
  const cls = ctx.cls.toLowerCase();
  const el = ctx.element.toLowerCase();
  const wantType = ctx.weaponType?.toLowerCase();

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
  const weaponPicks = weapons
    .map((w) => {
      const syn2 = weaponSynergy(w, syn, theme);
      const elMatch = w.el.toLowerCase() === el ? 3 : 0;
      const typeMatch = wantType && w.t.toLowerCase().includes(wantType) ? 4 : 0;
      const score = elMatch + typeMatch + syn2.score;
      return { item: w, score, why: syn2.perks.length ? `rolls ${syn2.perks.join(", ")}` : `${w.el} ${w.t}` };
    })
    .filter((p) => p.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

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

  return { theme, goalKeywords: goalKw, aspects, fragments, weapons: weaponPicks, sets };
}
