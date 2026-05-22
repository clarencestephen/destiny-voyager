#!/usr/bin/env node
/**
 * web/scripts/bake-slim-manifest.mjs
 * =================================
 * Reads the local Bungie manifest cache (~168 MB) and writes a slim
 * client-side lookup table to web/public/manifest.json (~3-4 MB).
 *
 * v0.2 (2026-05-21) — was emitting only 12,724 items; expanded to ~31k.
 * Changes from v0.1:
 *   • Drop the name+type DEDUPE — was actively losing legitimate hashes.
 *     Manifest is keyed by hash, lookup is by hash, every named hash
 *     should be addressable.
 *   • Drop the KEEP_TYPES whitelist — include EVERYTHING with a real
 *     display name (shaders, emblems, emotes, ornaments, ghost shells,
 *     vehicles, ships, quest steps, mods — DIM + light.gg show them all).
 *   • Respect Bungie's own `redacted: true` flag (42 items).
 *   • Skip `"Classified"` and empty display names (~2.1k).
 *
 * Schema of output:
 *   { "<hash>": { n, t, r, s, e, c, x, i } }
 *     n = display name
 *     t = itemTypeDisplayName (e.g. "Hand Cannon", "Helmet", "Shader")
 *     r = tier name (Exotic / Legendary / Rare / Common / Basic)
 *     s = slot bucket (Kinetic / Helmet / Class / "" if non-equippable)
 *     e = element/damage (Solar / Arc / Void / Stasis / Strand / "")
 *     c = class restriction (Titan / Hunter / Warlock / Any)
 *     x = boolean: is exotic
 *     i = icon path (relative, e.g. /common/destiny2_content/icons/abc.jpg)
 *         frontend prepends https://www.bungie.net
 *
 * Run after a Bungie patch (manifest changes ~weekly):
 *   node web/scripts/bake-slim-manifest.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_CANDIDATES = [
  "/home/cs/workspace/Destiny 2/manifest_cache/DestinyInventoryItemDefinition.json",
  "/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit/manifest_cache/DestinyInventoryItemDefinition.json",
];
const OUT = path.resolve(__dirname, "../public/manifest.json");

// Bucket hashes we recognise — every other bucket is left as "" (slot agnostic)
const SLOT = {
  1498876634: "Kinetic",
  2465295065: "Energy",
  953998645:  "Heavy",
  3448274439: "Helmet",
  3551918588: "Gauntlets",
  14239492:   "Chest",
  20886954:   "Legs",
  1585787867: "Class",
  4023194814: "Ghost",
  284967655:  "Ship",
  2025709351: "Sparrow",
  3284755031: "Subclass",
  3313201758: "Modifications",   // mod slot
  4274335291: "Emblem",
  3683254069: "Finisher",
  2746694985: "Quest",
};

const DAMAGE = { 0: "", 1: "Kinetic", 2: "Arc", 3: "Solar", 4: "Void", 6: "Stasis", 7: "Strand" };
const TIER = { 2: "Basic", 3: "Common", 4: "Rare", 5: "Legendary", 6: "Exotic" };
const CLS  = { 0: "Titan", 1: "Hunter", 2: "Warlock", 3: "Any" };

function findSrc() {
  for (const p of SRC_CANDIDATES) if (fs.existsSync(p)) return p;
  console.error("ERROR: manifest cache not found. Checked:");
  SRC_CANDIDATES.forEach((p) => console.error("  " + p));
  process.exit(1);
}

const src = findSrc();
const srcMB = (fs.statSync(src).size / 1024 / 1024).toFixed(1);
console.log(`Reading ${src} (~${srcMB} MB)...`);
const items = JSON.parse(fs.readFileSync(src, "utf8"));
console.log(`  ${Object.keys(items).length.toLocaleString()} raw item definitions`);

const slim = {};
let kept = 0;
let skipped_empty = 0;
let skipped_redacted = 0;
let skipped_classified = 0;

for (const [hash, defn] of Object.entries(items)) {
  const dp = defn.displayProperties || {};
  const name = (dp.name || "").trim();

  // Filter: empty names
  if (!name) {
    skipped_empty++;
    continue;
  }

  // Filter: Bungie's own redacted flag (these are pre-release placeholders
  // that haven't been revealed yet, e.g. unreleased exotics)
  if (defn.redacted === true) {
    skipped_redacted++;
    continue;
  }

  // Filter: placeholder names Bungie uses for items they haven't unlocked yet
  if (name === "Classified" || name === "REDACTED") {
    skipped_classified++;
    continue;
  }

  const inv = defn.inventory || {};
  const tierType = inv.tierType || 0;

  // Icon — only store if present + non-default. Bungie's default missing-icon
  // sentinel is the empty mark "/common/destiny2_content/icons/0fc92480..." —
  // we still keep it so the UI can fall back gracefully via onerror.
  const icon = (dp.icon || "").trim();

  slim[hash] = {
    n: name,
    t: defn.itemTypeDisplayName || "",
    r: TIER[tierType] || "",
    s: SLOT[inv.bucketTypeHash] || "",
    e: DAMAGE[defn.defaultDamageType] || "",
    c: CLS[defn.classType ?? 3] || "Any",
    x: tierType === 6,
    ...(icon ? { i: icon } : {}),
  };
  kept++;
}

const outDir = path.dirname(OUT);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(slim));
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);

console.log(``);
console.log(`✓ wrote ${OUT}`);
console.log(`  size:  ${sizeMB} MB`);
console.log(`  kept:  ${kept.toLocaleString()} items`);
console.log(`  skipped: ${skipped_empty.toLocaleString()} (empty name) · `
          + `${skipped_redacted.toLocaleString()} (Bungie redacted) · `
          + `${skipped_classified.toLocaleString()} (Classified/REDACTED placeholder)`);
