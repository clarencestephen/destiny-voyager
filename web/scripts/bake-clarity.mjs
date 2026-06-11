#!/usr/bin/env node
/**
 * web/scripts/bake-clarity.mjs
 * ============================
 * Bakes Clarity community perk/weapon descriptions → web/public/perks.json,
 * keyed by perk/item hash, for the Weapons page detail view + Darth Bot's
 * Crayon-mirror /perk command.
 *
 * Source: Database-Clarity / Live-Clarity-Database (MIT). Reads the local clone;
 * to refresh, `git pull` it (or fetch the raw clarity.json from GitHub).
 * CREDIT (see /credits): Database-Clarity — https://www.d2clarity.com/
 *
 *   node web/scripts/bake-clarity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_CANDIDATES = [
  "/home/cs/workspace/Destiny 2/Database-Clarity/Live-Clarity-Database/descriptions/clarity.json",
];
const OUT = path.resolve(__dirname, "../public/perks.json");

const src = SRC_CANDIDATES.find((p) => fs.existsSync(p));
if (!src) {
  console.error("Clarity clarity.json not found. Checked:\n  " + SRC_CANDIDATES.join("\n  "));
  process.exit(1);
}
console.log(`reading ${src}…`);
const db = JSON.parse(fs.readFileSync(src, "utf8"));

/** Flatten a Clarity description (en locale) to plain text. */
function flatten(descriptions) {
  const en = descriptions?.en || [];
  const lines = [];
  for (const block of en) {
    if (Array.isArray(block.linesContent)) {
      const line = block.linesContent.map((l) => l.text || "").join("").trim();
      if (line) lines.push(line);
    }
  }
  return lines.join("\n");
}

const out = {};
let kept = 0;
for (const [hash, e] of Object.entries(db)) {
  const d = flatten(e.descriptions);
  if (!d) continue;
  out[hash] = { n: (e.name || "").trim(), t: e.type || "", d };
  kept++;
}

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\n✓ wrote ${OUT}`);
console.log(`  ${kept} perk/weapon descriptions · ${kb} KB`);
