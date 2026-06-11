/**
 * web/src/lib/search.ts — DIM-style structured filters + a fuzzy, cross-field
 * free-text search over the baked weapon/armor databases.
 *
 * Structured operators (DIM subset, https://github.com/DestinyItemManager/DIM, MIT
 * — see /credits): `is:`/`not:` flags, `keyword:value` filters (value may be
 * "quoted"), leading `-` to negate. Examples: `is:exotic`, `source:trials`,
 * `season:>20`, `slot:chest class:titan`.
 *
 * Bare words are a FUZZY, typo-tolerant search across name + archetype + element
 * + ammo + slot + frame + every perk in the pool (so "rampage" finds weapons that
 * roll Rampage, "eeger edge" still finds Eager Edge, "martley" → The Martlet).
 * Results are ranked by relevance. Pure + framework-agnostic.
 */

export type SearchItem = Record<string, any>;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const has = (s: unknown, v: string) => String(s ?? "").toLowerCase().includes(v.toLowerCase());

const perkMatch = (it: SearchItem, v: string) =>
  Array.isArray(it.columns) &&
  it.columns.some((col: any[]) => Array.isArray(col) && col.some((p) => has(p?.n, v)));

function rangeMatch(field: number | null | undefined, v: string): boolean {
  if (field == null) return false;
  const m = v.match(/^(<=|>=|<|>|=)?\s*(\d+)$/);
  if (!m) return false;
  const op = m[1] || "=", n = Number(m[2]);
  switch (op) {
    case ">": return field > n;
    case "<": return field < n;
    case ">=": return field >= n;
    case "<=": return field <= n;
    default: return field === n;
  }
}

const KV: Record<string, (v: string, it: SearchItem) => boolean> = {
  type: (v, it) => norm(it.t).includes(norm(v)),
  element: (v, it) => norm(it.el) === norm(v),
  source: (v, it) => has(it.source, v),
  season: (v, it) => rangeMatch(it.season, v),
  name: (v, it) => has(it.n, v),
  ammo: (v, it) => norm(it.ammo) === norm(v),
  frame: (v, it) => has(it.frame, v),
  perk: (v, it) => perkMatch(it, v),
  slot: (v, it) => norm(it.slot) === norm(v),
  class: (v, it) => norm(it.cls) === norm(v),
};

const FLAGS: Record<string, (it: SearchItem) => boolean> = {
  exotic: (it) => it.r === "Exotic", legendary: (it) => it.r === "Legendary",
  craftable: (it) => !!it.craftable, random: (it) => !!it.random, randomroll: (it) => !!it.random,
  set: (it) => it.set != null,
  arc: (it) => norm(it.el) === "arc", solar: (it) => norm(it.el) === "solar",
  void: (it) => norm(it.el) === "void", stasis: (it) => norm(it.el) === "stasis",
  strand: (it) => norm(it.el) === "strand", kinetic: (it) => norm(it.el) === "kinetic",
  primary: (it) => norm(it.ammo) === "primary", special: (it) => norm(it.ammo) === "special",
  heavy: (it) => norm(it.ammo) === "heavy",
  titan: (it) => norm(it.cls) === "titan", hunter: (it) => norm(it.cls) === "hunter",
  warlock: (it) => norm(it.cls) === "warlock",
};

// ── Fuzzy free-text matching ───────────────────────────────────────────────

// Bounded Levenshtein — returns max+1 once the distance provably exceeds max.
function lev(a: string, b: string, max: number): number {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[bl];
}

// All searchable words for an item (name + archetype + element + ammo + slot +
// frame + class + every perk name). Memoised per item object.
const _wordCache = new WeakMap<object, string[]>();
function itemWords(it: SearchItem): string[] {
  const cached = _wordCache.get(it);
  if (cached) return cached;
  const set = new Set<string>();
  const add = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).forEach((t) => t.length >= 2 && set.add(t));
  add(it.n); add(it.t); add(it.el); add(it.ammo); add(it.slot); add(it.frame); add(it.cls);
  if (Array.isArray(it.columns)) for (const col of it.columns) if (Array.isArray(col)) for (const p of col) add(p?.n);
  const out = [...set];
  _wordCache.set(it, out);
  return out;
}

// Score a token against an item's words. 0 = no match. Higher = better.
function tokenScore(tok: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === tok) return 1;
    if (w.startsWith(tok)) best = Math.max(best, 0.9);
    else if (w.includes(tok)) best = Math.max(best, 0.7);
  }
  if (best < 0.7 && tok.length >= 4) {                       // typo tolerance
    for (const w of words) {
      if (Math.abs(w.length - tok.length) > 2) continue;
      const d = lev(tok, w, 2);
      if (d <= 2) { best = Math.max(best, 1 - d * 0.25); if (best >= 0.75) break; }
    }
  }
  return best;
}

// ALL free tokens must match (AND); returns the summed relevance, or -1 to drop.
function freeScore(words: string[], tokens: string[]): number {
  let total = 0;
  for (const tok of tokens) {
    const s = tokenScore(tok, words);
    if (s === 0) return -1;
    total += s;
  }
  return total;
}

type Term = { negate: boolean; test: (it: SearchItem) => boolean };

function tokenize(query: string): string[] {
  const out: string[] = [];
  const re = /[^\s"]+:"[^"]*"|"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) out.push(m[0]);
  return out;
}

// ── Natural-language interpretation layer ──────────────────────────────────
// Maps free-form phrases + abbreviations to filters BEFORE retrieval, so users
// type plainly ("exo hc w/ ramp craftable trials") instead of DIM syntax.

const STOP = new Set("with and that thats from the a an in on for is of can or i we want show me all any weapon weapons gun guns named please give gimme need looking but to my".split(" "));
// archetype phrase / abbreviation → itemTypeDisplayName substring
const ARCHETYPE: Record<string, string> = {
  "hand cannon": "hand cannon", hc: "hand cannon", handcannon: "hand cannon",
  scout: "scout", "scout rifle": "scout",
  pulse: "pulse", "pulse rifle": "pulse",
  auto: "auto rifle", "auto rifle": "auto rifle", ar: "auto rifle",
  smg: "submachine", submachine: "submachine", "submachine gun": "submachine",
  sidearm: "sidearm",
  sniper: "sniper", "sniper rifle": "sniper", snipe: "sniper",
  shotgun: "shotgun", shotty: "shotgun",
  fusion: "fusion rifle", "fusion rifle": "fusion rifle",
  linear: "linear fusion", lfr: "linear fusion", "linear fusion": "linear fusion",
  sword: "sword", bow: "bow", glaive: "glaive",
  "grenade launcher": "grenade launcher", gl: "grenade launcher", "nade launcher": "grenade launcher",
  rocket: "rocket launcher", "rocket launcher": "rocket launcher", rl: "rocket launcher",
  "machine gun": "machine gun", lmg: "machine gun", mg: "machine gun",
  trace: "trace rifle", "trace rifle": "trace rifle",
};
const TIERMAP: Record<string, string> = {
  exotic: "exotic", exo: "exotic", exotics: "exotic",
  legendary: "legendary", leg: "legendary", lego: "legendary", legendaries: "legendary", purple: "legendary",
};
const ELSET = new Set(["solar", "void", "arc", "stasis", "strand", "kinetic"]);
const CRAFT = new Set(["craftable", "craftible", "shaped", "craftin", "crafting", "craftability"]);
const AMMOSET = new Set(["primary", "special", "heavy"]);
// source phrase → sourceString substring
const SOURCEMAP: Record<string, string> = {
  trials: "trials", "trials of osiris": "trials", "iron banner": "iron banner", ib: "iron banner",
  nightfall: "nightfall", nf: "nightfall", gm: "nightfall", grandmaster: "nightfall",
  raid: "raid", dungeon: "dungeon", crucible: "crucible", gambit: "gambit",
  vanguard: "vanguard", strike: "strike", strikes: "strike", dawning: "dawning",
};

export interface Interpretation { terms: Term[]; free: string[]; labels: string[] }

/** Interpret a natural-language query into structured filters + fuzzy tokens. */
export function interpret(query: string): Interpretation {
  const terms: Term[] = [];
  const free: string[] = [];
  const labels: string[] = [];
  const q = query.toLowerCase().replace(/\bw\/\s*/g, " with ").replace(/,/g, " ");
  const toks = tokenize(q.trim());
  const strip = (s: string) => s.replace(/[.,;!?]+$/, "");
  for (let i = 0; i < toks.length; i++) {
    let t = strip(toks[i]);
    let negate = false;
    if (t.startsWith("-")) { negate = true; t = t.slice(1); }
    if (!t) continue;

    // DIM operators still work for power users.
    const colon = t.indexOf(":");
    if (colon > 0 && !t.startsWith('"')) {
      const key = t.slice(0, colon), val = t.slice(colon + 1).replace(/^"|"$/g, "");
      if ((key === "is" || key === "not") && FLAGS[val]) {
        terms.push({ negate: negate !== (key === "not"), test: FLAGS[val] }); labels.push(val); continue;
      }
      if (KV[key]) { terms.push({ negate, test: (it) => KV[key](val, it) }); labels.push(`${key}:${val}`); continue; }
    }
    if (t.startsWith('"') && t.endsWith('"')) {
      const ph = t.slice(1, -1); terms.push({ negate, test: (it) => has(it.n, ph) }); labels.push(`"${ph}"`); continue;
    }

    const next = i + 1 < toks.length ? strip(toks[i + 1]) : "";
    const two = next ? `${t} ${next}` : "";
    if (two && ARCHETYPE[two]) { terms.push({ negate, test: (it) => KV.type(ARCHETYPE[two], it) }); labels.push(ARCHETYPE[two]); i++; continue; }
    if (two && SOURCEMAP[two]) { terms.push({ negate, test: (it) => KV.source(SOURCEMAP[two], it) }); labels.push(`from ${SOURCEMAP[two]}`); i++; continue; }

    if (ARCHETYPE[t]) { terms.push({ negate, test: (it) => KV.type(ARCHETYPE[t], it) }); labels.push(ARCHETYPE[t]); continue; }
    if (TIERMAP[t]) { const f = TIERMAP[t]; terms.push({ negate, test: FLAGS[f] }); labels.push(f); continue; }
    if (ELSET.has(t)) { terms.push({ negate, test: FLAGS[t] }); labels.push(t); continue; }
    if (CRAFT.has(t)) { terms.push({ negate, test: FLAGS.craftable }); labels.push("craftable"); continue; }
    if (AMMOSET.has(t)) { terms.push({ negate, test: FLAGS[t] }); labels.push(t); continue; }
    if (SOURCEMAP[t]) { terms.push({ negate, test: (it) => KV.source(SOURCEMAP[t], it) }); labels.push(`from ${SOURCEMAP[t]}`); continue; }
    if (STOP.has(t)) continue;

    const bare = t.replace(/"/g, "");
    if (!bare) continue;
    if (negate) { terms.push({ negate: true, test: (it) => tokenScore(bare, itemWords(it)) > 0 }); labels.push(`not ${bare}`); }
    else { free.push(bare); labels.push(`“${bare}”`); }
  }
  return { terms, free, labels };
}

/** Interpret + filter + fuzzy-rank items by a natural-language query. */
export function search<T extends SearchItem>(query: string, items: T[]): T[] {
  const { terms, free } = interpret(query);
  let result = items.filter((it) => terms.every((t) => (t.negate ? !t.test(it) : t.test(it))));
  if (free.length) {
    const scored: Array<[T, number]> = [];
    for (const it of result) {
      const s = freeScore(itemWords(it), free);
      if (s >= 0) scored.push([it, s]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    result = scored.map((x) => x[0]);
  }
  return result;
}
