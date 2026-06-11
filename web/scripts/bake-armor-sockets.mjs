#!/usr/bin/env node
/**
 * web/scripts/bake-armor-sockets.mjs → web/public/armor_sockets.json
 * ==================================================================
 * The armor-mod socket LAYOUT per armor item, so the equip-with-mods flow can
 * target exact sockets (not guess) and CLEAR them before applying (frees energy).
 *
 * EoF (Armor 3.0) layout — socketCategory 590099826 = ARMOR MODS:
 *   index 0 (socketType 1718047805) → GENERAL socket (stat + general armor mods)
 *   indexes 1..3                    → SLOT-SPECIFIC mod sockets (surge/loader/resist/siphon)
 *   singleInitialItemHash of each   → that socket's EMPTY plug (clear target)
 *
 * Output: { <itemHash>: { general: <idx|null>, slots: [<idx>...], empties: { <idx>: <emptyPlugHash> } } }
 *
 *   node web/scripts/bake-armor-sockets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC = "/home/cs/workspace/Destiny 2/manifest_cache";
const OUT = path.resolve(__dirname, "../public/armor_sockets.json");
const items = JSON.parse(fs.readFileSync(`${MC}/DestinyInventoryItemDefinition.json`, "utf8"));

const ARMOR_MODS_CAT = 590099826;
const GENERAL_TYPE = 1718047805;                              // stat + general armor mods
// slot-specific armor-mod socket types (helmet/arms/chest/legs/class). The
// "armor mods" category ALSO contains the energy socket (1843767421, "Upgrade
// Armor") and a tuning socket (1444083081) — both EXCLUDED (inserting a mod
// there → DestinyItemActionForbidden).
const SLOT_TYPES = new Set([968742181, 1108765570, 959256494, 3219375296, 2512726577]);
const TIER = { 5: 1, 6: 1 };

const out = {};
let n = 0;
for (const [hash, it] of Object.entries(items)) {
  if (it.itemType !== 2 || it.redacted) continue;             // armor
  if (!TIER[it.inventory?.tierType]) continue;                // Legendary/Exotic
  const socks = it.sockets;
  if (!socks) continue;
  const cat = (socks.socketCategories || []).find((c) => c.socketCategoryHash === ARMOR_MODS_CAT);
  if (!cat) continue;
  const entries = socks.socketEntries || [];
  const rec = { general: null, slots: [], empties: {} };
  for (const i of cat.socketIndexes) {
    const e = entries[i];
    if (!e) continue;
    if (e.socketTypeHash === GENERAL_TYPE) {
      rec.general = i;
      rec.empties[i] = e.singleInitialItemHash;
    } else if (SLOT_TYPES.has(e.socketTypeHash)) {
      rec.slots.push(i);
      rec.empties[i] = e.singleInitialItemHash;
    }
    // else: energy / tuning / cosmetic — not a mod socket, skip
  }
  out[hash] = rec;
  n++;
}

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✓ wrote ${OUT}`);
console.log(`  ${n} armor pieces · ${kb} KB`);
