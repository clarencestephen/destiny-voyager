#!/usr/bin/env node
/**
 * web/scripts/bake-synergy.mjs
 * ============================
 * Bakes subclass aspects + fragments → web/public/subclass.json, each tagged
 * with the Destiny buff/keyword vocabulary it touches (Scorch, Ignition, Jolt,
 * Volatile, grenade, reload…). Tags are extracted from the description text
 * (Clarity preferred, manifest fallback) — the synergy graph the recommender
 * uses to assemble coherent builds.
 *
 * Aspects:  plugCategoryIdentifier = <class>.<element>.aspects
 * Fragments: plugCategoryIdentifier = shared.<element>.fragments
 *
 * Credits (see /credits): Bungie manifest + Clarity (effect descriptions).
 *   node web/scripts/bake-synergy.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC = "/home/cs/workspace/Destiny 2/manifest_cache";
const OUT = path.resolve(__dirname, "../public/synergy.json");
const items = JSON.parse(fs.readFileSync(`${MC}/DestinyInventoryItemDefinition.json`, "utf8"));
const sandbox = JSON.parse(fs.readFileSync(`${MC}/DestinySandboxPerkDefinition.json`, "utf8"));
const clarity = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/perks.json"), "utf8")); } catch { return {}; } })();
const armor = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/armor.json"), "utf8")); } catch { return { sets: {} }; } })();

// canonical keyword → match patterns (substring, lowercased). Distinctive stems
// are safe as substrings; short/common words use a word boundary.
const KW = {
  // Solar
  scorch: [/scorch/], ignition: [/ignit/], radiant: [/radiant/], restoration: [/restorat/],
  cure: [/\bcure[ds]?\b/], firesprite: [/firesprite/],
  // Arc
  jolt: [/jolt/], blind: [/\bblind/], amplified: [/amplif/], "ionic-trace": [/ionic trace/], "bolt-charge": [/bolt charge/],
  // Void
  volatile: [/volatile/], weaken: [/weaken/], suppress: [/suppress/], invisible: [/invisib/], devour: [/devour/], overshield: [/overshield/],
  // Stasis
  slow: [/\bslow/], freeze: [/freeze|frozen/], shatter: [/shatter/], "frost-armor": [/frost armor/], "stasis-crystal": [/stasis crystal/],
  // Strand
  sever: [/sever/], suspend: [/suspend/], unravel: [/unravel/], tangle: [/tangle/], "woven-mail": [/woven mail/], threadling: [/threadling/],
  // Prismatic / general
  transcendence: [/transcend/],
  // effect categories
  grenade: [/grenade/], melee: [/\bmelee/], super: [/\bsuper\b/], "class-ability": [/class ability|rift|barricade|dodge/],
  reload: [/reload/], surge: [/\bsurge|weapon damage|\bdamage to\b/], orbs: [/orb of power|orbs of power/],
  finisher: [/finisher/], "ability-energy": [/ability energy|ability regen|grenade energy|melee energy/],
  heal: [/\bheal|cure|restorat/], "damage-resist": [/damage resist|reduce.*damage/],
  // champions (artifact mods)
  barrier: [/anti-barrier|barrier champion/], overload: [/overload/], unstoppable: [/unstoppable/],
  // weapon types (for artifact/mod favoring)
  "grenade-launcher": [/grenade launcher/], rocket: [/rocket launcher/], sword: [/\bsword/], bow: [/\bbow\b/], glaive: [/glaive/],
  "hand-cannon": [/hand cannon/], "pulse-rifle": [/pulse rifle/], "scout-rifle": [/scout rifle/],
  "auto-rifle": [/auto rifle/], smg: [/submachine gun/], sidearm: [/sidearm/], shotgun: [/shotgun/],
  "sniper-rifle": [/sniper rifle/], "machine-gun": [/\bmachine gun/], "trace-rifle": [/trace rifle/], "linear-fusion": [/linear fusion/],
};

// All effect text for keyword extraction: Clarity + manifest desc + the linked
// sandbox-perk descriptions (where aspects actually store their effect text).
function fullText(hash, d) {
  const parts = [];
  if (clarity[hash]?.d) parts.push(clarity[hash].d);
  if (d.displayProperties?.description) parts.push(d.displayProperties.description);
  for (const p of d.perks || []) {
    const sd = sandbox[p.perkHash]?.displayProperties?.description;
    if (sd) parts.push(sd);
  }
  return parts.join(" ").toLowerCase();
}
function bestDesc(d) {
  return (d.displayProperties?.description
    || sandbox[d.perks?.[0]?.perkHash]?.displayProperties?.description
    || "").trim();
}
function tagsFor(text) {
  const tags = [];
  for (const [kw, pats] of Object.entries(KW)) {
    if (pats.some((re) => re.test(text))) tags.push(kw);
  }
  return tags;
}

const aspects = [];
const fragments = [];
for (const [hash, d] of Object.entries(items)) {
  if (d.redacted) continue;
  const pid = d.plug?.plugCategoryIdentifier || "";
  const nm = (d.displayProperties?.name || "").trim();
  if (!nm || nm.startsWith("Empty ")) continue;
  const isAspect = pid.endsWith(".aspects");
  const isFragment = pid.endsWith(".fragments");
  if (!isAspect && !isFragment) continue;

  const parts = pid.split(".");                              // warlock.solar.aspects / shared.solar.fragments
  let el = isAspect ? parts[1] : parts[1];                   // solar / void / prism / arc / strand
  if (el === "prism") el = "prismatic";
  const desc = bestDesc(d);
  const tags = tagsFor(fullText(hash, d));
  const rec = { hash: Number(hash), n: nm, el, desc, keywords: tags };
  if (isAspect) { rec.cls = parts[0]; aspects.push(rec); }
  else fragments.push(rec);
}

// Weapon-perk keyword tags (Clarity descriptions) — e.g. Incandescence → scorch.
const perkKeywords = {};
for (const [h, p] of Object.entries(clarity)) {
  const t = tagsFor((p.d || "").toLowerCase());
  if (t.length) perkKeywords[h] = t;
}
// Armor set-bonus keyword tags (e.g. reload, surge/boss-damage) from the 2pc/4pc text.
const setKeywords = {};
for (const [sh, s] of Object.entries(armor.sets || {})) {
  const text = (s.perks || []).map((p) => p.d || "").join(" ").toLowerCase();
  const t = tagsFor(text);
  if (t.length) setKeywords[sh] = t;
}

// Current seasonal artifact perks (highest-index artifact). Effect text is in the
// name (e.g. "Anti-Barrier Hand Cannon"), so tag from name + any sandbox text.
const arts = (() => { try { return JSON.parse(fs.readFileSync(`${MC}/DestinyArtifactDefinition.json`, "utf8")); } catch { return {}; } })();
let artifact = { name: "", perks: [] };
const artVals = Object.values(arts);
if (artVals.length) {
  const cur = artVals.reduce((a, b) => ((b.index || 0) > (a.index || 0) ? b : a));
  artifact.name = (cur.displayProperties?.name || "").trim();
  (cur.tiers || []).forEach((t, ti) => {
    for (const it of t.items || []) {
      const pi = items[it.itemHash];
      const nm = (pi?.displayProperties?.name || "").trim();
      if (!nm) continue;
      const kws = tagsFor((nm + " " + fullText(it.itemHash, pi)).toLowerCase());
      artifact.perks.push({ hash: it.itemHash, n: nm, tier: ti + 1, keywords: kws });
    }
  });
}

const payload = { aspects, fragments, perkKeywords, setKeywords, artifact };
fs.writeFileSync(OUT, JSON.stringify(payload));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✓ wrote ${OUT}`);
console.log(`  ${aspects.length} aspects · ${fragments.length} fragments · ${kb} KB`);
console.log(`  perk tags: ${Object.keys(perkKeywords).length} · set tags: ${Object.keys(setKeywords).length}`);
console.log(`  artifact "${artifact.name}": ${artifact.perks.length} perks`);
