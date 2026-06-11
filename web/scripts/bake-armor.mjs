#!/usr/bin/env node
/**
 * web/scripts/bake-armor.mjs
 * ==========================
 * Bakes the armor database → web/public/armor.json for the Armor + Build pages.
 * Per piece: slot, class, tier, element, archetype, set membership, source,
 * season, icon. Plus a `sets` map with each set's 2pc/4pc SET-BONUS perks
 * (resolved from DestinyEquipableItemSetDefinition + DestinySandboxPerkDefinition).
 *
 * Credits (see /credits): Bungie manifest; DIM (MIT) for season enums.
 *   node web/scripts/bake-armor.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC = "/home/cs/workspace/Destiny 2/manifest_cache";
const DIM = "/home/cs/workspace/Destiny 2/Destiny Item Manager/d2-additional-info/output";
const OUT = path.resolve(__dirname, "../public/armor.json");
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tryLoad = (p) => (fs.existsSync(p) ? load(p) : null);

console.log("loading manifest tables…");
const items = load(`${MC}/DestinyInventoryItemDefinition.json`);
const plugSets = load(`${MC}/DestinyPlugSetDefinition.json`);
const setDefs = load(`${MC}/DestinyEquipableItemSetDefinition.json`);
const perks = load(`${MC}/DestinySandboxPerkDefinition.json`);
const damage = load(`${MC}/DestinyDamageTypeDefinition.json`);
const collectibles = load(`${MC}/DestinyCollectibleDefinition.json`);
const watermarkToSeason = tryLoad(`${DIM}/watermark-to-season.json`) || {};
const seasonsByHash = tryLoad(`${DIM}/seasons.json`) || {};

const TIER = { 6: "Exotic", 5: "Legendary" };
const SLOT = { 3448274439: "Helmet", 3551918588: "Gauntlets", 14239492: "Chest", 20886954: "Legs", 1585787867: "Class" };
const CLS = { 0: "Titan", 1: "Hunter", 2: "Warlock", 3: "Any" };
const ARCHETYPES = new Set(["Brawler", "Bulwark", "Grenadier", "Gunner", "Paragon", "Specialist"]);
const name = (h) => (items[h]?.displayProperties?.name || "").trim();

// sets: { setHash: { n, perks:[{count,n,d}] } } + item->set lookup
const sets = {};
const setOfItem = {};
for (const [hash, s] of Object.entries(setDefs)) {
  if (s.redacted || s.blacklisted) continue;
  const nm = (s.displayProperties?.name || "").trim();
  if (!nm) continue;
  sets[hash] = {
    n: nm,
    perks: (s.setPerks || []).map((p) => {
      const pk = perks[p.sandboxPerkHash]?.displayProperties || {};
      return { count: p.requiredSetCount, n: (pk.name || "").trim(), d: (pk.description || "").trim() };
    }),
  };
  for (const ih of s.setItems || []) setOfItem[ih] = Number(hash);
}

function seasonOf(it) {
  const wm = it.iconWatermark || it.quality?.displayVersionWatermarkIcons?.[it.quality?.currentVersion ?? 0];
  if (wm && watermarkToSeason[wm] != null) return watermarkToSeason[wm];
  return seasonsByHash[it.hash] ?? null;
}

// Modern EoF armor has an ARCHETYPE socket whose pool is the six archetypes
// (the actual archetype is chosen per-instance — read from owned plug_hashes in
// the inventory view). This flags archetype-capable armor vs legacy.
function isEofArmor(it) {
  for (const e of it.sockets?.socketEntries || []) {
    const pool = e.reusablePlugSetHash || e.randomizedPlugSetHash;
    if (pool && plugSets[pool]) {
      for (const p of plugSets[pool].reusablePlugItems || []) {
        if (ARCHETYPES.has(name(p.plugItemHash))) return true;
      }
    }
  }
  return false;
}

const out = {};
let kept = 0, inSets = 0;
for (const [hash, it] of Object.entries(items)) {
  if (it.itemType !== 2 || it.redacted) continue;            // 2 = Armor
  const nm = (it.displayProperties?.name || "").trim();
  if (!nm) continue;
  const tier = TIER[it.inventory?.tierType];
  if (!tier) continue;                                       // Legendary/Exotic only
  const slot = SLOT[it.inventory?.bucketTypeHash];
  if (!slot) continue;                                       // real armor slots only

  const setHash = setOfItem[Number(hash)] ?? null;
  if (setHash) inSets++;

  out[hash] = {
    n: nm,
    slot,
    cls: CLS[it.classType ?? 3] || "Any",
    r: tier,
    el: damage[it.defaultDamageTypeHash]?.displayProperties?.name || "",
    eof: isEofArmor(it),                                     // archetype-capable (modern) armor
    set: setHash,
    season: seasonOf(it),
    source: it.collectibleHash ? (collectibles[it.collectibleHash]?.sourceString || "") : "",
    icon: it.displayProperties?.icon || "",
    watermark: it.iconWatermark || "",
    exotic: tier === "Exotic",
  };
  kept++;
}

const payload = { sets, items: out };
fs.writeFileSync(OUT, JSON.stringify(payload));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
console.log(`\n✓ wrote ${OUT}`);
const eofCount = Object.values(out).filter((d) => d.eof).length;
console.log(`  armor pieces: ${kept} (${inSets} in named sets, ${eofCount} EoF archetype-capable) · ${Object.keys(sets).length} sets w/ bonuses`);
console.log(`  size: ${mb} MB`);
