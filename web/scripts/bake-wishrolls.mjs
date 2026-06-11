#!/usr/bin/env node
/**
 * web/scripts/bake-wishrolls.mjs
 * ==============================
 * Bakes the DIM community god-roll wishlist (voltron.txt) → web/public/wishrolls.json:
 *   { rolls: { <itemHash>: { pve:[perkHash…], pvp:[perkHash…] } }, perkPop: { <perkHash>: count } }
 *
 * - rolls: the set of god-roll perks per weapon, by mode — powers /godroll and
 *   marks "god-roll" perks in the perk pools.
 * - perkPop: global perk popularity (how many god rolls each perk appears in) —
 *   a perk-popularity signal for the recommender.
 *
 * Filtered to weapons that exist in weapons.json (keeps it lean + relevant).
 * Source: DIM community wishlist "voltron" (48klocs/dim-wish-list-sources),
 * aggregated from many community contributors. CREDIT: DIM + the wishlist authors
 * (see /credits). MIT-spirit community data.
 *
 *   node web/scripts/bake-wishrolls.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = "/home/cs/workspace/Destiny 2/Destiny Item Manager/dim-wish-list-sources/voltron.txt";
const OUT = path.resolve(__dirname, "../public/wishrolls.json");

const weaponHashes = new Set(Object.keys(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/weapons.json"), "utf8"))));

console.log("parsing voltron.txt…");
const lines = fs.readFileSync(SRC, "utf8").split("\n");
const rolls = {};        // itemHash -> { pve:Set, pvp:Set }
const perkPop = {};      // perkHash -> count
let tags = [];

for (const line of lines) {
  if (line.includes("|tags:")) {
    tags = (line.split("|tags:")[1] || "").toLowerCase().split(/\s+/).filter(Boolean);
    continue;
  }
  const m = line.match(/^dimwishlist:item=(\d+)&perks=([\d,]+)/);  // \d+ skips block markers (item=-69420)
  if (!m) continue;
  const item = m[1];
  if (!weaponHashes.has(item)) continue;                          // only weapons we serve
  const mode = tags.some((t) => t.startsWith("pvp")) ? "pvp" : "pve";
  const e = rolls[item] || (rolls[item] = { pve: new Set(), pvp: new Set() });
  for (const p of m[2].split(",")) {
    e[mode].add(p);
    perkPop[p] = (perkPop[p] || 0) + 1;
  }
}

const out = {};
for (const [h, e] of Object.entries(rolls)) out[h] = { pve: [...e.pve], pvp: [...e.pvp] };
fs.writeFileSync(OUT, JSON.stringify({ rolls: out, perkPop }));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
console.log(`✓ wrote ${OUT}`);
console.log(`  weapons with god rolls: ${Object.keys(out).length} · perks ranked: ${Object.keys(perkPop).length} · ${mb} MB`);
