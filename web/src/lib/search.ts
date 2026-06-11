/**
 * web/src/lib/search.ts — DIM-style declarative search over the baked weapon
 * and armor databases (weapons.json / armor.json).
 *
 * The query grammar is a subset of DIM's (https://github.com/DestinyItemManager/DIM,
 * MIT — see /credits): space-separated terms, ANDed together; `is:`/`not:` flags,
 * `keyword:value` filters (value may be "quoted"), a leading `-` to negate, and
 * bare words match the item name. Examples:
 *   is:exotic hand cannon
 *   perk:rampage is:craftable
 *   source:trials season:>20
 *   slot:chest class:titan is:set            (armor)
 *
 * Pure + framework-agnostic so it can be unit-tested and run in a Web Worker.
 */

export type SearchItem = Record<string, any>;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const has = (s: unknown, v: string) => String(s ?? "").toLowerCase().includes(v.toLowerCase());

// Any perk in any column whose name matches (weapons).
const perkMatch = (it: SearchItem, v: string) =>
  Array.isArray(it.columns) &&
  it.columns.some((col: any[]) => Array.isArray(col) && col.some((p) => has(p?.n, v)));

// Numeric comparator for `season:>20`, `season:<=5`, `season:11`.
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

// keyword:value filters. Each returns whether the item matches the value.
const KV: Record<string, (v: string, it: SearchItem) => boolean> = {
  // weapons + armor
  type: (v, it) => norm(it.t).includes(norm(v)),                 // "Hand Cannon"
  element: (v, it) => norm(it.el) === norm(v),
  source: (v, it) => has(it.source, v),
  season: (v, it) => rangeMatch(it.season, v),
  name: (v, it) => has(it.n, v),
  // weapons
  ammo: (v, it) => norm(it.ammo) === norm(v),
  frame: (v, it) => has(it.frame, v),
  perk: (v, it) => perkMatch(it, v),
  // armor
  slot: (v, it) => norm(it.slot) === norm(v),
  class: (v, it) => norm(it.cls) === norm(v),
};

// is:X / not:X boolean flags.
const FLAGS: Record<string, (it: SearchItem) => boolean> = {
  exotic: (it) => it.r === "Exotic",
  legendary: (it) => it.r === "Legendary",
  craftable: (it) => !!it.craftable,
  random: (it) => !!it.random,
  randomroll: (it) => !!it.random,
  set: (it) => it.set != null,                                   // armor in a named set
  // elements
  arc: (it) => norm(it.el) === "arc", solar: (it) => norm(it.el) === "solar",
  void: (it) => norm(it.el) === "void", stasis: (it) => norm(it.el) === "stasis",
  strand: (it) => norm(it.el) === "strand", kinetic: (it) => norm(it.el) === "kinetic",
  // ammo
  primary: (it) => norm(it.ammo) === "primary", special: (it) => norm(it.ammo) === "special",
  heavy: (it) => norm(it.ammo) === "heavy",
  // classes (armor)
  titan: (it) => norm(it.cls) === "titan", hunter: (it) => norm(it.cls) === "hunter",
  warlock: (it) => norm(it.cls) === "warlock",
};

type Term = { negate: boolean; test: (it: SearchItem) => boolean };

// Split a query into terms, respecting "quoted phrases".
function tokenize(query: string): string[] {
  const out: string[] = [];
  const re = /[^\s"]+:"[^"]*"|"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) out.push(m[0]);
  return out;
}

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  for (let tok of tokenize(query.trim())) {
    let negate = false;
    if (tok.startsWith("-")) { negate = true; tok = tok.slice(1); }
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const key = tok.slice(0, colon).toLowerCase();
      let val = tok.slice(colon + 1).replace(/^"|"$/g, "");
      if ((key === "is" || key === "not") && FLAGS[val.toLowerCase()]) {
        const f = FLAGS[val.toLowerCase()];
        terms.push({ negate: negate !== (key === "not"), test: f });
        continue;
      }
      if (KV[key]) { terms.push({ negate, test: (it) => KV[key](val, it) }); continue; }
      // unknown key → treat the whole token as a name search
    }
    // Bare term. A "quoted phrase" is a name search; an unquoted word is a
    // flag (solar/exotic/craftable…) if known, else a name-OR-type substring
    // (so "hand cannon" matches the type, "rampage" matches a name, etc.).
    const quoted = tok.startsWith('"') && tok.endsWith('"');
    const bare = tok.replace(/^"|"$/g, "");
    if (!quoted) {
      const flag = FLAGS[bare.toLowerCase()];
      if (flag) { terms.push({ negate, test: flag }); continue; }
    }
    terms.push({
      negate,
      test: quoted ? (it) => has(it.n, bare) : (it) => has(it.n, bare) || has(it.t, bare),
    });
  }
  return terms;
}

/** Filter a list of items (object map or array) by a query string. */
export function search<T extends SearchItem>(query: string, items: T[]): T[] {
  const terms = parseQuery(query);
  if (!terms.length) return items;
  return items.filter((it) => terms.every((t) => (t.negate ? !t.test(it) : t.test(it))));
}
