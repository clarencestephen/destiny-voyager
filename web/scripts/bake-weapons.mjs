#!/usr/bin/env node
/**
 * web/scripts/bake-weapons.mjs
 * ============================
 * Bakes the full weapon database → web/public/weapons.json for the Weapons page
 * + Darth Bot's Crayon-mirror commands. Reads the local manifest_cache tables
 * (refresh them with the manifest download step) and DIM's d2-additional-info
 * for season/source enums.
 *
 * Per weapon: identity (name/type/tier/ammo/element/icon/watermark), intrinsic
 * frame, the random-roll PERK COLUMNS (+ curated), base stats, season (via DIM
 * watermark map), and the collectible source string.
 *
 * Data credits (see /credits): Bungie manifest; DIM (MIT) for the season/source
 * enums; perk descriptions come from Clarity at runtime (separate bake).
 *
 *   node web/scripts/bake-weapons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC = "/home/cs/workspace/Destiny 2/manifest_cache";
const DIM = "/home/cs/workspace/Destiny 2/Destiny Item Manager/d2-additional-info/output";
const OUT = path.resolve(__dirname, "../public/weapons.json");

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tryLoad = (p) => (fs.existsSync(p) ? load(p) : null);

console.log("loading manifest tables…");
const items = load(`${MC}/DestinyInventoryItemDefinition.json`);
const plugSets = load(`${MC}/DestinyPlugSetDefinition.json`);
const damage = load(`${MC}/DestinyDamageTypeDefinition.json`);
const stats = load(`${MC}/DestinyStatDefinition.json`);
const collectibles = load(`${MC}/DestinyCollectibleDefinition.json`);
// DIM season data (optional — bake still works without it)
const watermarkToSeason = tryLoad(`${DIM}/watermark-to-season.json`) || {};
const seasonsByHash = tryLoad(`${DIM}/seasons.json`) || {};

const TIER = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Common", 2: "Basic" };
const AMMO = { 1: "Primary", 2: "Special", 3: "Heavy" };
const SLOT = { 1498876634: "Kinetic", 2465295065: "Energy", 953998645: "Power" };
const CAT_WEAPON_PERKS = 4241085061;
const CAT_INTRINSIC = 3956125808;

const name = (h) => (items[h]?.displayProperties?.name || "").trim();

// plugSetHash -> [{h, c}] — ALL plugs that ever rolled (c = currently can roll).
// We keep retired perks (light.gg-style full history) and flag which still drop.
function plugsOf(plugSetHash) {
  const ps = plugSets[plugSetHash];
  if (!ps) return [];
  return (ps.reusablePlugItems || []).map((p) => ({ h: p.plugItemHash, c: p.currentlyCanRoll !== false }));
}

// Resolve a weapon-perks socket entry to its column of possible perks.
function columnFor(entry) {
  let raw = [];
  if (entry.randomizedPlugSetHash) raw = plugsOf(entry.randomizedPlugSetHash);
  else if (entry.reusablePlugSetHash) raw = plugsOf(entry.reusablePlugSetHash);
  else if (entry.reusablePlugItems?.length) raw = entry.reusablePlugItems.map((p) => ({ h: p.plugItemHash, c: true }));
  else if (entry.singleInitialItemHash) raw = [{ h: entry.singleInitialItemHash, c: true }];
  const out = [];
  const seen = new Set();
  for (const { h, c } of raw) {
    const n = name(h);
    // drop empties + the tracker socket (it lives in the perks category too)
    if (!n || n === "Empty Mod Socket" || /Tracker$/.test(n) || seen.has(h)) continue;
    seen.add(h);
    out.push({ h, n, c });
  }
  return out;
}

function seasonOf(it) {
  const wm = it.iconWatermark
    || it.quality?.displayVersionWatermarkIcons?.[it.quality?.currentVersion ?? 0]
    || it.quality?.displayVersionWatermarkIcons?.[0];
  if (wm && watermarkToSeason[wm] != null) return watermarkToSeason[wm];
  if (seasonsByHash[it.hash] != null) return seasonsByHash[it.hash];
  return null;
}

const out = {};
let kept = 0, craftable = 0, withRolls = 0;
for (const [hash, it] of Object.entries(items)) {
  if (it.itemType !== 3 || it.redacted) continue;            // 3 = Weapon
  const nm = (it.displayProperties?.name || "").trim();
  if (!nm) continue;

  const tier = TIER[it.inventory?.tierType] || "";
  if (tier !== "Legendary" && tier !== "Exotic") continue;   // searchable god-roll set

  // sockets → intrinsic frame + perk columns
  const cats = it.sockets?.socketCategories || [];
  const entries = it.sockets?.socketEntries || [];
  const idxOf = (catHash) => cats.find((c) => c.socketCategoryHash === catHash)?.socketIndexes || [];
  const intrinsicIdx = idxOf(CAT_INTRINSIC)[0];
  const intrinsic = intrinsicIdx != null ? name(entries[intrinsicIdx]?.singleInitialItemHash) : "";
  const columns = [];
  for (const i of idxOf(CAT_WEAPON_PERKS)) {
    const col = columnFor(entries[i] || {});
    if (col.length) columns.push(col);
  }
  const isRandom = idxOf(CAT_WEAPON_PERKS).some((i) => entries[i]?.randomizedPlugSetHash);

  // base stats (name -> value)
  const st = {};
  for (const [sh, s] of Object.entries(it.stats?.stats || {})) {
    const sn = stats[sh]?.displayProperties?.name;
    if (sn && s.value) st[sn] = s.value;
  }

  const src = it.collectibleHash ? (collectibles[it.collectibleHash]?.sourceString || "") : "";
  const crafted = !!it.inventory?.recipeItemHash;
  if (crafted) craftable++;
  if (isRandom) withRolls++;

  out[hash] = {
    n: nm,
    t: it.itemTypeDisplayName || "",                         // "Hand Cannon"
    r: tier,
    ammo: AMMO[it.equippingBlock?.ammoType] || "",
    slot: SLOT[it.inventory?.bucketTypeHash] || "",            // Kinetic / Energy / Power
    el: damage[it.defaultDamageTypeHash]?.displayProperties?.name || "",
    frame: intrinsic,
    random: isRandom,
    craftable: crafted,
    season: seasonOf(it),
    source: src,
    icon: it.displayProperties?.icon || "",
    watermark: it.iconWatermark || "",
    stats: st,
    columns,                                                 // [[{h,n}...], ...]
    exotic: tier === "Exotic",
  };
  kept++;
}

fs.writeFileSync(OUT, JSON.stringify(out));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
console.log(`\n✓ wrote ${OUT}`);
console.log(`  weapons: ${kept} (Legendary+Exotic) · ${withRolls} random-roll · ${craftable} craftable`);
console.log(`  size: ${mb} MB`);
console.log(`  DIM season map: ${Object.keys(watermarkToSeason).length ? "loaded" : "MISSING (season=null)"}`);
